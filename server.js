const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const cors = require('cors');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = socketIo(server, {
    cors: {
        origin: "*",
        methods: ["GET", "POST"],
        credentials: true
    },
    transports: ['websocket', 'polling'],
    allowEIO3: true
});

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname)));

// Trust proxy for production
if (process.env.NODE_ENV === 'production') {
    app.set('trust proxy', 1);
}

// In-memory storage (in production, use a proper database)
const gameRooms = new Map();
const players = new Map();
const matchmakingQueue = [];
const userStats = new Map();

// Game room class
class GameRoom {
    constructor(roomId, creator) {
        this.id = roomId;
        this.players = [creator];
        this.spectators = [];
        this.gameState = 'waiting'; // waiting, playing, finished
        this.currentPlayer = 1;
        this.board = {
            player1: { x: 4, y: 0, walls: 10 },
            player2: { x: 4, y: 8, walls: 10 }
        };
        this.walls = [];
        this.moveHistory = [];
        this.gameTime = 0;
        this.turnTime = 30;
        this.createdAt = Date.now();
        this.chatMessages = [];
    }

    addPlayer(player) {
        if (this.players.length < 2) {
            this.players.push(player);
            return true;
        }
        return false;
    }

    addSpectator(player) {
        this.spectators.push(player);
    }

    removePlayer(playerId) {
        this.players = this.players.filter(p => p.id !== playerId);
        this.spectators = this.spectators.filter(p => p.id !== playerId);
    }

    isFull() {
        return this.players.length >= 2;
    }

    canStart() {
        return this.players.length === 2;
    }

    getPlayerNumber(playerId) {
        const index = this.players.findIndex(p => p.id === playerId);
        return index === -1 ? null : index + 1;
    }

    makeMove(playerId, moveData) {
        const playerNumber = this.getPlayerNumber(playerId);
        if (!playerNumber || playerNumber !== this.currentPlayer) {
            return { success: false, error: 'Not your turn' };
        }

        if (moveData.type === 'move') {
            // Validate and execute pawn move
            if (this.isValidMove(playerNumber, moveData.x, moveData.y)) {
                this.moveHistory.push({
                    type: 'move',
                    player: playerNumber,
                    from: { ...this.board[`player${playerNumber}`] },
                    to: { x: moveData.x, y: moveData.y },
                    timestamp: Date.now()
                });
                
                this.board[`player${playerNumber}`].x = moveData.x;
                this.board[`player${playerNumber}`].y = moveData.y;
                
                if (this.checkWin(playerNumber)) {
                    this.gameState = 'finished';
                    return { success: true, gameEnded: true, winner: playerNumber };
                }
                
                this.nextTurn();
                return { success: true };
            }
        } else if (moveData.type === 'wall') {
            // Validate and place wall
            if (this.board[`player${playerNumber}`].walls > 0 && 
                this.isValidWallPlacement(moveData.x, moveData.y, moveData.orientation)) {
                
                this.walls.push({
                    x: moveData.x,
                    y: moveData.y,
                    orientation: moveData.orientation,
                    player: playerNumber
                });
                
                this.board[`player${playerNumber}`].walls--;
                
                this.moveHistory.push({
                    type: 'wall',
                    player: playerNumber,
                    x: moveData.x,
                    y: moveData.y,
                    orientation: moveData.orientation,
                    timestamp: Date.now()
                });
                
                this.nextTurn();
                return { success: true };
            }
        }
        
        return { success: false, error: 'Invalid move' };
    }

    isValidMove(player, x, y) {
        const currentPos = this.board[`player${player}`];
        
        // Check boundaries
        if (x < 0 || x >= 9 || y < 0 || y >= 9) return false;
        
        // Check if position is occupied by same player
        if (currentPos.x === x && currentPos.y === y) return false;
        
        const dx = x - currentPos.x;
        const dy = y - currentPos.y;
        const distance = Math.abs(dx) + Math.abs(dy);
        
        // Basic adjacent move
        if (distance === 1) {
            if (this.isPathBlocked(currentPos.x, currentPos.y, x, y)) return false;
            
            // Check if destination is occupied by opponent
            const opponent = player === 1 ? 2 : 1;
            const opponentPos = this.board[`player${opponent}`];
            if (opponentPos.x === x && opponentPos.y === y) return false;
            
            return true;
        }
        
        // Jump over opponent
        if (distance === 2) {
            const opponent = player === 1 ? 2 : 1;
            const opponentPos = this.board[`player${opponent}`];
            
            const middleX = currentPos.x + dx / 2;
            const middleY = currentPos.y + dy / 2;
            
            if (opponentPos.x === middleX && opponentPos.y === middleY) {
                if (this.isPathBlocked(currentPos.x, currentPos.y, middleX, middleY)) return false;
                if (this.isPathBlocked(middleX, middleY, x, y)) return false;
                return true;
            }
        }
        
        return false;
    }

    isValidWallPlacement(x, y, orientation) {
        // Check boundaries
        if (orientation === 'horizontal') {
            if (y < 0 || y >= 8 || x < 0 || x >= 8) return false;
        } else {
            if (x < 0 || x >= 8 || y < 0 || y >= 8) return false;
        }
        
        // Check for existing walls
        for (const wall of this.walls) {
            if (wall.x === x && wall.y === y && wall.orientation === orientation) {
                return false;
            }
        }
        
        // Check for intersecting walls
        if (orientation === 'horizontal') {
            for (const wall of this.walls) {
                if (wall.orientation === 'vertical') {
                    if ((wall.x === x && wall.y === y) || (wall.x === x + 1 && wall.y === y)) {
                        return false;
                    }
                }
            }
        } else {
            for (const wall of this.walls) {
                if (wall.orientation === 'horizontal') {
                    if ((wall.x === x && wall.y === y) || (wall.x === x && wall.y === y + 1)) {
                        return false;
                    }
                }
            }
        }
        
        // Check if wall would block any player's path to goal
        const tempWalls = [...this.walls, { x, y, orientation }];
        return this.hasPathToGoal(1, tempWalls) && this.hasPathToGoal(2, tempWalls);
    }

    isPathBlocked(x1, y1, x2, y2) {
        for (const wall of this.walls) {
            if (wall.orientation === 'horizontal') {
                if (y1 !== y2 && Math.min(y1, y2) === wall.y && 
                    x1 >= wall.x && x1 <= wall.x + 1) {
                    return true;
                }
            } else {
                if (x1 !== x2 && Math.min(x1, x2) === wall.x && 
                    y1 >= wall.y && y1 <= wall.y + 1) {
                    return true;
                }
            }
        }
        return false;
    }

    hasPathToGoal(player, walls = this.walls) {
        const targetY = player === 1 ? 8 : 0;
        const playerPos = this.board[`player${player}`];
        const visited = new Set();
        const queue = [{ x: playerPos.x, y: playerPos.y }];
        
        while (queue.length > 0) {
            const { x, y } = queue.shift();
            const key = `${x},${y}`;
            
            if (visited.has(key)) continue;
            visited.add(key);
            
            if (y === targetY) return true;
            
            const moves = [
                { x: x, y: y - 1 },
                { x: x, y: y + 1 },
                { x: x - 1, y: y },
                { x: x + 1, y: y }
            ];
            
            for (const move of moves) {
                if (move.x >= 0 && move.x < 9 && move.y >= 0 && move.y < 9 && 
                    !visited.has(`${move.x},${move.y}`) &&
                    !this.isPathBlockedByWalls(x, y, move.x, move.y, walls)) {
                    queue.push(move);
                }
            }
        }
        return false;
    }

    isPathBlockedByWalls(x1, y1, x2, y2, walls) {
        const dx = x2 - x1;
        const dy = y2 - y1;
        
        for (const wall of walls) {
            if (wall.orientation === 'horizontal') {
                if (dy !== 0) {
                    const wallY = wall.y;
                    const wallX1 = wall.x;
                    const wallX2 = wall.x + 1;
                    
                    if (dy > 0) {
                        if (wallY === y1 && x1 >= wallX1 && x1 <= wallX2) {
                            return true;
                        }
                    } else {
                        if (wallY === y1 - 1 && x1 >= wallX1 && x1 <= wallX2) {
                            return true;
                        }
                    }
                }
            } else {
                if (dx !== 0) {
                    const wallX = wall.x;
                    const wallY1 = wall.y;
                    const wallY2 = wall.y + 1;
                    
                    if (dx > 0) {
                        if (wallX === x1 && y1 >= wallY1 && y1 <= wallY2) {
                            return true;
                        }
                    } else {
                        if (wallX === x1 - 1 && y1 >= wallY1 && y1 <= wallY2) {
                            return true;
                        }
                    }
                }
            }
        }
        return false;
    }

    checkWin(player) {
        const pos = this.board[`player${player}`];
        return (player === 1 && pos.y === 8) || (player === 2 && pos.y === 0);
    }

    nextTurn() {
        this.currentPlayer = this.currentPlayer === 1 ? 2 : 1;
        this.turnTime = 30;
    }

    addChatMessage(playerId, message) {
        const player = this.players.find(p => p.id === playerId) || 
                      this.spectators.find(p => p.id === playerId);
        
        if (player) {
            const chatMessage = {
                id: Date.now(),
                playerId,
                playerName: player.name,
                message: message.substring(0, 100), // Limit message length
                timestamp: Date.now()
            };
            
            this.chatMessages.push(chatMessage);
            
            // Keep only last 50 messages
            if (this.chatMessages.length > 50) {
                this.chatMessages = this.chatMessages.slice(-50);
            }
            
            return chatMessage;
        }
        return null;
    }
}

// Utility functions
function generateRoomCode() {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
    let result = '';
    for (let i = 0; i < 6; i++) {
        result += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return result;
}

function findOrCreatePlayer(socket, userData) {
    let player = players.get(socket.id);
    if (!player) {
        player = {
            id: socket.id,
            name: userData.name || `Player${Math.floor(Math.random() * 1000)}`,
            email: userData.email || '',
            coins: 500,
            stats: {
                wins: 0,
                losses: 0,
                gamesPlayed: 0,
                rank: 'Novice',
                points: 0
            },
            currentRoom: null,
            isGuest: userData.isGuest || false,
            connectedAt: Date.now()
        };
        players.set(socket.id, player);
    }
    return player;
}

// Socket.IO connection handling
io.on('connection', (socket) => {
    console.log(`Player connected: ${socket.id} from ${socket.handshake.address}`);

    // Player authentication/registration
    socket.on('player:login', (userData, callback) => {
        try {
            const player = findOrCreatePlayer(socket, userData);
            
            // Load existing stats if available
            if (userStats.has(userData.email) && userData.email) {
                player.stats = userStats.get(userData.email);
            }
            
            callback({ success: true, player });
        } catch (error) {
            callback({ success: false, error: error.message });
        }
    });

    // Quick match - join matchmaking queue
    socket.on('game:quickMatch', (callback) => {
        try {
            const player = players.get(socket.id);
            if (!player) {
                callback({ success: false, error: 'Player not found' });
                return;
            }

            // Check if already in queue
            if (matchmakingQueue.find(p => p.id === socket.id)) {
                callback({ success: false, error: 'Already in matchmaking queue' });
                return;
            }

            matchmakingQueue.push(player);

            // Try to match with another player
            if (matchmakingQueue.length >= 2) {
                const player1 = matchmakingQueue.shift();
                const player2 = matchmakingQueue.shift();

                // Create new room
                const roomId = generateRoomCode();
                const room = new GameRoom(roomId, player1);
                room.addPlayer(player2);
                gameRooms.set(roomId, room);

                // Update player room references
                player1.currentRoom = roomId;
                player2.currentRoom = roomId;

                // Join socket rooms
                io.sockets.sockets.get(player1.id)?.join(roomId);
                io.sockets.sockets.get(player2.id)?.join(roomId);

                // Notify both players
                io.to(roomId).emit('game:matchFound', {
                    roomId,
                    players: room.players,
                    gameState: room
                });

                callback({ success: true, roomId, matched: true });
            } else {
                callback({ success: true, queued: true, position: matchmakingQueue.length });
            }
        } catch (error) {
            callback({ success: false, error: error.message });
        }
    });

    // Create room
    socket.on('room:create', (callback) => {
        try {
            const player = players.get(socket.id);
            if (!player) {
                callback({ success: false, error: 'Player not found' });
                return;
            }

            const roomId = generateRoomCode();
            const room = new GameRoom(roomId, player);
            gameRooms.set(roomId, room);
            
            player.currentRoom = roomId;
            socket.join(roomId);

            callback({ success: true, roomId, room: room });
        } catch (error) {
            callback({ success: false, error: error.message });
        }
    });

    // Join room
    socket.on('room:join', (data, callback) => {
        try {
            const { roomId, asSpectator } = data;
            const player = players.get(socket.id);
            const room = gameRooms.get(roomId);

            if (!player) {
                callback({ success: false, error: 'Player not found' });
                return;
            }

            if (!room) {
                callback({ success: false, error: 'Room not found' });
                return;
            }

            if (asSpectator) {
                room.addSpectator(player);
                player.currentRoom = roomId;
                socket.join(roomId);
                
                // Notify room about new spectator
                socket.to(roomId).emit('room:spectatorJoined', {
                    spectator: player,
                    spectatorCount: room.spectators.length
                });
                
                callback({ success: true, room, isSpectator: true });
            } else {
                if (room.isFull()) {
                    callback({ success: false, error: 'Room is full' });
                    return;
                }

                room.addPlayer(player);
                player.currentRoom = roomId;
                socket.join(roomId);

                // Notify room about new player
                io.to(roomId).emit('room:playerJoined', {
                    player,
                    room,
                    canStart: room.canStart()
                });

                callback({ success: true, room });
            }
        } catch (error) {
            callback({ success: false, error: error.message });
        }
    });

    // Start game
    socket.on('game:start', (callback) => {
        try {
            const player = players.get(socket.id);
            const room = gameRooms.get(player?.currentRoom);

            if (!room || !room.canStart()) {
                callback({ success: false, error: 'Cannot start game' });
                return;
            }

            room.gameState = 'playing';
            room.currentPlayer = 1;

            io.to(room.id).emit('game:started', {
                gameState: room,
                players: room.players
            });

            callback({ success: true });
        } catch (error) {
            callback({ success: false, error: error.message });
        }
    });

    // Make move
    socket.on('game:move', (moveData, callback) => {
        try {
            const player = players.get(socket.id);
            const room = gameRooms.get(player?.currentRoom);

            if (!room || room.gameState !== 'playing') {
                callback({ success: false, error: 'Game not active' });
                return;
            }

            const result = room.makeMove(socket.id, moveData);
            
            if (result.success) {
                // Broadcast move to all players in room
                io.to(room.id).emit('game:moveUpdate', {
                    move: moveData,
                    gameState: room,
                    currentPlayer: room.currentPlayer
                });

                if (result.gameEnded) {
                    // Update player stats
                    const winner = room.players[result.winner - 1];
                    const loser = room.players[result.winner === 1 ? 1 : 0];
                    
                    winner.stats.wins++;
                    winner.stats.gamesPlayed++;
                    winner.stats.points += 25;
                    winner.coins += 100;
                    
                    loser.stats.losses++;
                    loser.stats.gamesPlayed++;
                    loser.stats.points = Math.max(0, loser.stats.points - 10);
                    loser.coins += 25;

                    // Save stats
                    if (winner.email) userStats.set(winner.email, winner.stats);
                    if (loser.email) userStats.set(loser.email, loser.stats);

                    io.to(room.id).emit('game:ended', {
                        winner: result.winner,
                        gameState: room,
                        stats: {
                            winner: winner.stats,
                            loser: loser.stats
                        }
                    });
                }
            }

            callback(result);
        } catch (error) {
            callback({ success: false, error: error.message });
        }
    });

    // Chat message
    socket.on('chat:message', (data, callback) => {
        try {
            const player = players.get(socket.id);
            const room = gameRooms.get(player?.currentRoom);

            if (!room) {
                callback({ success: false, error: 'Not in a room' });
                return;
            }

            const chatMessage = room.addChatMessage(socket.id, data.message);
            
            if (chatMessage) {
                io.to(room.id).emit('chat:newMessage', chatMessage);
                callback({ success: true });
            } else {
                callback({ success: false, error: 'Failed to send message' });
            }
        } catch (error) {
            callback({ success: false, error: error.message });
        }
    });

    // Leave room
    socket.on('room:leave', (callback) => {
        try {
            const player = players.get(socket.id);
            const room = gameRooms.get(player?.currentRoom);

            if (room) {
                room.removePlayer(socket.id);
                socket.leave(room.id);
                
                // Notify others in room
                socket.to(room.id).emit('room:playerLeft', {
                    playerId: socket.id,
                    playerName: player.name
                });

                // Clean up empty rooms
                if (room.players.length === 0 && room.spectators.length === 0) {
                    gameRooms.delete(room.id);
                }
            }

            if (player) {
                player.currentRoom = null;
            }

            callback({ success: true });
        } catch (error) {
            callback({ success: false, error: error.message });
        }
    });

    // Disconnect handling
    socket.on('disconnect', (reason) => {
        console.log(`Player disconnected: ${socket.id}, reason: ${reason}`);
        
        const player = players.get(socket.id);
        if (player) {
            // Remove from matchmaking queue
            const queueIndex = matchmakingQueue.findIndex(p => p.id === socket.id);
            if (queueIndex !== -1) {
                matchmakingQueue.splice(queueIndex, 1);
            }

            // Handle room cleanup
            const room = gameRooms.get(player.currentRoom);
            if (room) {
                room.removePlayer(socket.id);
                
                // Notify others in room
                socket.to(room.id).emit('room:playerLeft', {
                    playerId: socket.id,
                    playerName: player.name,
                    disconnected: true
                });

                // Clean up empty rooms
                if (room.players.length === 0 && room.spectators.length === 0) {
                    gameRooms.delete(room.id);
                }
            }

            players.delete(socket.id);
        }
    });
});

// REST API endpoints
app.get('/api/stats', (req, res) => {
    try {
        const stats = {
            totalPlayers: players.size,
            activeRooms: gameRooms.size,
            playersInQueue: matchmakingQueue.length,
            totalGames: Array.from(gameRooms.values()).filter(r => r.gameState === 'finished').length,
            serverUptime: process.uptime(),
            memoryUsage: process.memoryUsage()
        };
        res.json(stats);
    } catch (error) {
        console.error('Error fetching stats:', error);
        res.status(500).json({ error: 'Failed to fetch stats' });
    }
});

app.get('/api/leaderboard', (req, res) => {
    try {
        const leaderboard = Array.from(userStats.entries())
            .map(([email, stats]) => ({
                name: email ? email.replace(/(.{2}).*(@.*)/, '$1***$2') : 'Anonymous', // Mask email for privacy
                ...stats
            }))
            .sort((a, b) => b.points - a.points)
            .slice(0, 10);
        
        res.json(leaderboard);
    } catch (error) {
        console.error('Error fetching leaderboard:', error);
        res.status(500).json({ error: 'Failed to fetch leaderboard' });
    }
});

app.get('/api/rooms', (req, res) => {
    try {
        const publicRooms = Array.from(gameRooms.values())
            .filter(room => room.gameState === 'waiting' && !room.isFull())
            .map(room => ({
                id: room.id,
                playerCount: room.players.length,
                spectatorCount: room.spectators.length,
                createdAt: room.createdAt
            }));
        
        res.json(publicRooms);
    } catch (error) {
        console.error('Error fetching rooms:', error);
        res.status(500).json({ error: 'Failed to fetch rooms' });
    }
});

// Serve the main HTML file
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'adionwar - Copy.html'));
});

// Health check endpoint for Render.com
app.get('/health', (req, res) => {
    res.status(200).json({ 
        status: 'healthy', 
        timestamp: new Date().toISOString(),
        uptime: process.uptime(),
        players: players.size,
        rooms: gameRooms.size
    });
});

// Cleanup old rooms periodically
setInterval(() => {
    const now = Date.now();
    const roomsToDelete = [];
    
    for (const [roomId, room] of gameRooms.entries()) {
        // Delete rooms older than 2 hours with no activity
        if (now - room.createdAt > 2 * 60 * 60 * 1000 && 
            room.players.length === 0 && room.spectators.length === 0) {
            roomsToDelete.push(roomId);
        }
    }
    
    roomsToDelete.forEach(roomId => {
        gameRooms.delete(roomId);
        console.log(`Cleaned up old room: ${roomId}`);
    });
}, 30 * 60 * 1000); // Run every 30 minutes

const PORT = process.env.PORT || 3000;
const HOST = process.env.HOST || '0.0.0.0';

// Global error handlers
process.on('uncaughtException', (error) => {
    console.error('Uncaught Exception:', error);
    process.exit(1);
});

process.on('unhandledRejection', (reason, promise) => {
    console.error('Unhandled Rejection at:', promise, 'reason:', reason);
});

// Graceful shutdown
process.on('SIGTERM', () => {
    console.log('SIGTERM received, shutting down gracefully');
    server.close(() => {
        console.log('Process terminated');
        process.exit(0);
    });
});

server.listen(PORT, HOST, () => {
    console.log(`🎮 Adion War Server running on ${HOST}:${PORT}`);
    console.log(`🌐 Game available at: http://localhost:${PORT}`);
    console.log(`📊 Environment: ${process.env.NODE_ENV || 'development'}`);
});
