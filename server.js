const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = socketIo(server, {
    cors: {
        origin: "*",
        methods: ["GET", "POST"]
    },
    pingTimeout: 60000,
    pingInterval: 25000,
    transports: ['websocket', 'polling']
});

// Serve static files
app.use(express.static(path.join(__dirname)));

// Serve index.html for root route
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

// Health check endpoint
app.get('/health', (req, res) => {
    res.json({ status: 'OK', timestamp: new Date().toISOString() });
});

// Game state storage
const games = new Map();
const playerRooms = new Map(); // Track which room each player is in

// Helper functions
function generateRoomCode() {
    let code;
    do {
        code = Math.random().toString(36).substring(2, 8).toUpperCase();
    } while (games.has(code));
    return code;
}

function initializeBoard() {
    return {
        horizontalWalls: Array(8).fill().map(() => Array(9).fill(false)),
        verticalWalls: Array(9).fill().map(() => Array(8).fill(false))
    };
}

function createNewGame(roomCode, firstPlayer) {
    return {
        id: roomCode,
        players: [firstPlayer],
        board: initializeBoard(),
        currentTurn: 0,
        status: 'waiting',
        createdAt: Date.now(),
        lastActivity: Date.now()
    };
}

function isValidMove(game, playerId, newPosition) {
    const player = game.players[playerId];
    if (!player) return false;
    
    const currentPos = player.position;

    // Check bounds
    if (newPosition.x < 0 || newPosition.x > 8 || newPosition.y < 0 || newPosition.y > 8) {
        return false;
    }

    // Check if target is occupied
    const isOccupied = game.players.some(p => 
        p.position.x === newPosition.x && p.position.y === newPosition.y
    );
    if (isOccupied) return false;

    const dx = Math.abs(newPosition.x - currentPos.x);
    const dy = Math.abs(newPosition.y - currentPos.y);

    // Adjacent move
    if ((dx === 1 && dy === 0) || (dx === 0 && dy === 1)) {
        return !isWallBetween(game.board, currentPos, newPosition);
    }

    // Jump move
    if ((dx === 2 && dy === 0) || (dx === 0 && dy === 2)) {
        const midPoint = {
            x: currentPos.x + (newPosition.x - currentPos.x) / 2,
            y: currentPos.y + (newPosition.y - currentPos.y) / 2
        };
        
        // Check if opponent is at midpoint
        const opponentAtMid = game.players.some(p => 
            p.position.x === midPoint.x && p.position.y === midPoint.y
        );
        if (!opponentAtMid) return false;
        
        return !isWallBetween(game.board, currentPos, midPoint) && 
               !isWallBetween(game.board, midPoint, newPosition);
    }

    // Diagonal jump
    if (dx === 1 && dy === 1) {
        // Find adjacent opponent
        const directions = [
            { x: 0, y: 1 }, { x: 0, y: -1 }, { x: 1, y: 0 }, { x: -1, y: 0 }
        ];
        
        let opponentPos = null;
        for (let dir of directions) {
            const checkPos = { x: currentPos.x + dir.x, y: currentPos.y + dir.y };
            const opponent = game.players.find(p => 
                p.position.x === checkPos.x && p.position.y === checkPos.y
            );
            if (opponent) {
                opponentPos = checkPos;
                break;
            }
        }
        
        if (!opponentPos) return false;
        
        // Check if straight jump is blocked
        const straightJump = {
            x: currentPos.x + (opponentPos.x - currentPos.x) * 2,
            y: currentPos.y + (opponentPos.y - currentPos.y) * 2
        };
        
        if (straightJump.x >= 0 && straightJump.x <= 8 && 
            straightJump.y >= 0 && straightJump.y <= 8) {
            const straightBlocked = game.players.some(p => 
                p.position.x === straightJump.x && p.position.y === straightJump.y
            ) || isWallBetween(game.board, opponentPos, straightJump);
            
            if (!straightBlocked) return false; // Must use straight jump if available
        }
        
        return !isWallBetween(game.board, currentPos, opponentPos) && 
               !isWallBetween(game.board, opponentPos, newPosition);
    }

    return false;
}

function isValidWallPlacement(game, playerId, wall) {
    const player = game.players[playerId];
    if (!player || player.walls <= 0) return false;

    const { x, y, orientation } = wall;

    // Check bounds
    if (orientation === 'horizontal') {
        if (x < 0 || x > 7 || y < 1 || y > 8) return false;
        if (game.board.horizontalWalls[x][y] || game.board.horizontalWalls[x + 1][y]) return false;
    } else {
        if (x < 1 || x > 8 || y < 0 || y > 7) return false;
        if (game.board.verticalWalls[x][y] || game.board.verticalWalls[x][y + 1]) return false;
    }

    // Check intersections
    if (orientation === 'horizontal' && y > 0 && y < 8) {
        if (game.board.verticalWalls[x + 1][y - 1] && game.board.verticalWalls[x + 1][y]) return false;
    } else if (orientation === 'vertical' && x > 0 && x < 8) {
        if (game.board.horizontalWalls[x - 1][y + 1] && game.board.horizontalWalls[x][y + 1]) return false;
    }

    // Check if wall blocks all paths
    const tempBoard = JSON.parse(JSON.stringify(game.board));
    placeWallOnBoard(tempBoard, wall);
    
    for (let i = 0; i < game.players.length; i++) {
        if (!hasPathToGoal(tempBoard, game.players[i].position, i)) {
            return false;
        }
    }

    return true;
}

function placeWallOnBoard(board, wall) {
    const { x, y, orientation } = wall;
    
    if (orientation === 'horizontal') {
        board.horizontalWalls[x][y] = true;
        board.horizontalWalls[x + 1][y] = true;
    } else {
        board.verticalWalls[x][y] = true;
        board.verticalWalls[x][y + 1] = true;
    }
}

function isWallBetween(board, pos1, pos2) {
    if (pos1.x === pos2.x) {
        // Vertical movement
        const x = pos1.x;
        const minY = Math.min(pos1.y, pos2.y);
        return board.horizontalWalls[x] && board.horizontalWalls[x][minY + 1];
    } else if (pos1.y === pos2.y) {
        // Horizontal movement
        const y = pos1.y;
        const minX = Math.min(pos1.x, pos2.x);
        return board.verticalWalls[minX + 1] && board.verticalWalls[minX + 1][y];
    }
    return false;
}

function hasPathToGoal(board, position, playerId) {
    const visited = Array(9).fill().map(() => Array(9).fill(false));
    const queue = [position];
    visited[position.x][position.y] = true;

    const goalY = playerId === 0 ? 8 : 0;

    while (queue.length > 0) {
        const pos = queue.shift();

        if (pos.y === goalY) return true;

        const directions = [
            { x: 0, y: 1 }, { x: 0, y: -1 },
            { x: 1, y: 0 }, { x: -1, y: 0 }
        ];

        for (const dir of directions) {
            const newPos = { x: pos.x + dir.x, y: pos.y + dir.y };

            if (newPos.x < 0 || newPos.x > 8 || newPos.y < 0 || newPos.y > 8) continue;
            if (visited[newPos.x][newPos.y]) continue;
            if (isWallBetween(board, pos, newPos)) continue;

            visited[newPos.x][newPos.y] = true;
            queue.push(newPos);
        }
    }

    return false;
}

function checkWinCondition(game, playerId) {
    const player = game.players[playerId];
    if (!player) return false;
    
    return (playerId === 0 && player.position.y === 8) || 
           (playerId === 1 && player.position.y === 0);
}

function updateGameActivity(roomCode) {
    const game = games.get(roomCode);
    if (game) {
        game.lastActivity = Date.now();
    }
}

function cleanupPlayer(socketId) {
    const roomCode = playerRooms.get(socketId);
    if (roomCode) {
        const game = games.get(roomCode);
        if (game) {
            const playerIndex = game.players.findIndex(p => p.id === socketId);
            
            if (playerIndex !== -1) {
                if (game.status === 'playing') {
                    // Notify other players
                    io.to(roomCode).emit('playerLeft', { playerId: playerIndex });
                    game.status = 'abandoned';
                    
                    // Keep the game for a short while in case player reconnects
                    setTimeout(() => {
                        if (games.has(roomCode) && games.get(roomCode).status === 'abandoned') {
                            games.delete(roomCode);
                            console.log(`Cleaned up abandoned game: ${roomCode}`);
                        }
                    }, 30000); // 30 seconds
                } else if (game.status === 'waiting') {
                    // Remove waiting game immediately
                    games.delete(roomCode);
                    console.log(`Removed waiting game: ${roomCode}`);
                }
            }
        }
        playerRooms.delete(socketId);
    }
}

// Socket.io connection handling
io.on('connection', (socket) => {
    console.log('New client connected:', socket.id);

    socket.on('joinRoom', (data) => {
        try {
            let roomCode = data.roomCode;
            const playerName = data.playerName || 'Anonymous';
            
            // Clean up any existing room association
            cleanupPlayer(socket.id);
            
            // If no room code provided, generate one
            if (!roomCode) {
                roomCode = generateRoomCode();
            }
            
            let game = games.get(roomCode);

            if (!game) {
                // Create new game
                const newPlayer = {
                    id: socket.id,
                    name: playerName,
                    position: { x: 4, y: 0 },
                    walls: 10
                };
                
                game = createNewGame(roomCode, newPlayer);
                games.set(roomCode, game);
                
                socket.join(roomCode);
                playerRooms.set(socket.id, roomCode);
                socket.emit('roomJoined', { roomCode, playerId: 0 });
                
                console.log(`Room created: ${roomCode} by ${socket.id}`);
            } else if (game.players.length === 1 && game.status === 'waiting') {
                // Join existing room
                const newPlayer = {
                    id: socket.id,
                    name: playerName,
                    position: { x: 4, y: 8 },
                    walls: 10
                };
                
                game.players.push(newPlayer);
                socket.join(roomCode);
                playerRooms.set(socket.id, roomCode);
                socket.emit('roomJoined', { roomCode, playerId: 1 });

                // Start the game
                game.status = 'playing';
                game.lastActivity = Date.now();
                
                const gameData = {
                    players: game.players.map(p => ({ 
                        name: p.name, 
                        position: p.position, 
                        walls: p.walls 
                    })),
                    board: game.board,
                    currentTurn: game.currentTurn
                };
                
                io.to(roomCode).emit('gameStarted', gameData);
                console.log(`Player joined room: ${roomCode}, game started`);
            } else {
                socket.emit('error', { message: 'Room is full or game in progress' });
            }
        } catch (error) {
            console.error('Error in joinRoom:', error);
            socket.emit('error', { message: 'Failed to join room' });
        }
    });

    socket.on('movePawn', (data) => {
        try {
            const { roomCode, playerId, position } = data;
            const game = games.get(roomCode);

            if (!game || game.status !== 'playing') {
                socket.emit('error', { message: 'Game not found or not in progress' });
                return;
            }

            if (game.currentTurn !== playerId) {
                socket.emit('error', { message: 'Not your turn' });
                return;
            }

            if (!isValidMove(game, playerId, position)) {
                socket.emit('error', { message: 'Invalid move' });
                return;
            }

            // Execute move
            game.players[playerId].position = position;
            updateGameActivity(roomCode);

            // Check win condition
            if (checkWinCondition(game, playerId)) {
                game.status = 'finished';
                io.to(roomCode).emit('gameOver', { winner: playerId });
                console.log(`Game ${roomCode} finished, winner: ${playerId}`);
                
                // Clean up finished game after a delay
                setTimeout(() => {
                    games.delete(roomCode);
                    console.log(`Cleaned up finished game: ${roomCode}`);
                }, 60000); // 1 minute
            } else {
                // Next turn
                game.currentTurn = (game.currentTurn + 1) % 2;
                
                const gameData = {
                    players: game.players.map(p => ({ 
                        position: p.position, 
                        walls: p.walls 
                    })),
                    board: game.board,
                    currentTurn: game.currentTurn
                };
                
                io.to(roomCode).emit('gameUpdated', gameData);
            }
        } catch (error) {
            console.error('Error in movePawn:', error);
            socket.emit('error', { message: 'Failed to process move' });
        }
    });

    socket.on('placeWall', (data) => {
        try {
            const { roomCode, playerId, wall } = data;
            const game = games.get(roomCode);

            if (!game || game.status !== 'playing') {
                socket.emit('error', { message: 'Game not found or not in progress' });
                return;
            }

            if (game.currentTurn !== playerId) {
                socket.emit('error', { message: 'Not your turn' });
                return;
            }

            if (!isValidWallPlacement(game, playerId, wall)) {
                socket.emit('error', { message: 'Invalid wall placement' });
                return;
            }

            // Place wall
            placeWallOnBoard(game.board, wall);
            game.players[playerId].walls--;
            updateGameActivity(roomCode);

            // Next turn
            game.currentTurn = (game.currentTurn + 1) % 2;
            
            const gameData = {
                players: game.players.map(p => ({ 
                    position: p.position, 
                    walls: p.walls 
                })),
                board: game.board,
                currentTurn: game.currentTurn
            };
            
            io.to(roomCode).emit('gameUpdated', gameData);
        } catch (error) {
            console.error('Error in placeWall:', error);
            socket.emit('error', { message: 'Failed to place wall' });
        }
    });

    socket.on('disconnect', (reason) => {
        console.log('Client disconnected:', socket.id, 'Reason:', reason);
        cleanupPlayer(socket.id);
    });

    socket.on('error', (error) => {
        console.error('Socket error:', error);
    });
});

// Clean up old games periodically
setInterval(() => {
    const now = Date.now();
    const GAME_TIMEOUT = 30 * 60 * 1000; // 30 minutes
    const WAITING_TIMEOUT = 10 * 60 * 1000; // 10 minutes for waiting games
    
    for (const [roomCode, game] of games.entries()) {
        const timeSinceActivity = now - game.lastActivity;
        const timeSinceCreation = now - game.createdAt;
        
        let shouldDelete = false;
        
        if (game.status === 'abandoned') {
            shouldDelete = timeSinceActivity > 60000; // 1 minute for abandoned games
        } else if (game.status === 'waiting') {
            shouldDelete = timeSinceCreation > WAITING_TIMEOUT;
        } else if (game.status === 'playing') {
            shouldDelete = timeSinceActivity > GAME_TIMEOUT;
        } else if (game.status === 'finished') {
            shouldDelete = timeSinceActivity > 60000; // 1 minute for finished games
        }
        
        if (shouldDelete) {
            // Clean up player room mappings
            game.players.forEach(player => {
                playerRooms.delete(player.id);
            });
            
            games.delete(roomCode);
            console.log(`Cleaned up game: ${roomCode} (status: ${game.status})`);
        }
    }
    
    console.log(`Active games: ${games.size}, Active player mappings: ${playerRooms.size}`);
}, 60000); // Check every minute

// Graceful shutdown
process.on('SIGTERM', () => {
    console.log('SIGTERM received, shutting down gracefully');
    server.close(() => {
        console.log('Server closed');
        process.exit(0);
    });
});

process.on('SIGINT', () => {
    console.log('SIGINT received, shutting down gracefully');
    server.close(() => {
        console.log('Server closed');
        process.exit(0);
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`Quoridor server running on port ${PORT}`);
    console.log(`Server URL: https://wall-chess.onrender.com`);
    console.log(`Health check: https://wall-chess.onrender.com/health`);
});

// Handle uncaught exceptions
process.on('uncaughtException', (error) => {
    console.error('Uncaught Exception:', error);
});

process.on('unhandledRejection', (reason, promise) => {
    console.error('Unhandled Rejection at:', promise, 'reason:', reason);
});