const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const path = require('path');

// Enhanced server configuration
const app = express();
const server = http.createServer(app);

// More robust Socket.IO configuration
const io = socketIo(server, {
    cors: {
        origin: "*",
        methods: ["GET", "POST"]
    },
    pingTimeout: 60000,
    pingInterval: 25000,
    transports: ['websocket', 'polling'],
    allowUpgrades: true,
    perMessageDeflate: {
        threshold: 1024,
        concurrencyLimit: 10,
        zlibDeflateOptions: {
            chunkSize: 16 * 1024
        }
    },
    maxHttpBufferSize: 1e8,
    serveClient: false,
    connectionStateRecovery: {
        maxDisconnectionDuration: 2 * 60 * 1000, // 2 minutes
        skipMiddlewares: true
    }
});

// Serve static files with cache control
app.use(express.static(path.join(__dirname), {
    maxAge: '1d',
    etag: true,
    lastModified: true,
    setHeaders: (res, path) => {
        if (path.endsWith('.html')) {
            res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
        }
    }
}));

// Serve index.html for root route
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

// Enhanced health check endpoint
app.get('/health', (req, res) => {
    const healthData = {
        status: 'OK',
        timestamp: new Date().toISOString(),
        uptime: process.uptime(),
        memoryUsage: process.memoryUsage(),
        gamesCount: games.size,
        playersCount: playerRooms.size,
        loadAvg: process.cpuUsage()
    };
    res.json(healthData);
});

// Add keep-alive endpoint
app.get('/keepalive', (req, res) => {
    res.status(204).end();
});

// Game state storage with enhanced data structure
const games = new Map();
const playerRooms = new Map();
const playerSockets = new Map(); // Track socket instances for each player

// Helper functions with additional validation
function generateRoomCode() {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // Avoid ambiguous characters
    let code;
    do {
        code = '';
        for (let i = 0; i < 6; i++) {
            code += chars.charAt(Math.floor(Math.random() * chars.length));
        }
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
        lastActivity: Date.now(),
        reconnectionTokens: new Map() // Store tokens for reconnecting players
    };
}

// Enhanced move validation
function isValidMove(game, playerId, newPosition) {
    try {
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
    } catch (error) {
        console.error('Error in isValidMove:', error);
        return false;
    }
}

// Enhanced wall placement validation
function isValidWallPlacement(game, playerId, wall) {
    try {
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
    } catch (error) {
        console.error('Error in isValidWallPlacement:', error);
        return false;
    }
}

function placeWallOnBoard(board, wall) {
    const { x, y, orientation } = wall;
    
    if (orientation === 'horizontal') {
        board.horizontalWalls[x][y] = true;
        if (x + 1 <= 7) board.horizontalWalls[x + 1][y] = true;
    } else {
        board.verticalWalls[x][y] = true;
        if (y + 1 <= 7) board.verticalWalls[x][y + 1] = true;
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

// Enhanced pathfinding with memoization
const pathCache = new Map();
function hasPathToGoal(board, position, playerId) {
    const cacheKey = `${JSON.stringify(board)}-${position.x},${position.y}-${playerId}`;
    if (pathCache.has(cacheKey)) {
        return pathCache.get(cacheKey);
    }

    const visited = Array(9).fill().map(() => Array(9).fill(false));
    const queue = [position];
    visited[position.x][position.y] = true;

    const goalY = playerId === 0 ? 8 : 0;

    while (queue.length > 0) {
        const pos = queue.shift();

        if (pos.y === goalY) {
            pathCache.set(cacheKey, true);
            return true;
        }

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

    pathCache.set(cacheKey, false);
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
        // Clear path cache when game state changes
        pathCache.clear();
    }
}

function generateReconnectionToken() {
    return Math.random().toString(36).substring(2, 15) + Math.random().toString(36).substring(2, 15);
}

// Enhanced player cleanup with reconnection support
function cleanupPlayer(socketId) {
    const roomCode = playerRooms.get(socketId);
    if (roomCode) {
        const game = games.get(roomCode);
        if (game) {
            const playerIndex = game.players.findIndex(p => p.id === socketId);
            
            if (playerIndex !== -1) {
                if (game.status === 'playing') {
                    // Generate reconnection token
                    const token = generateReconnectionToken();
                    game.reconnectionTokens.set(socketId, {
                        token,
                        expires: Date.now() + 120000 // 2 minutes
                    });
                    
                    // Notify other players
                    io.to(roomCode).emit('playerDisconnected', { 
                        playerId: playerIndex,
                        reconnectionTimeout: 120000
                    });
                    
                    // Set temporary status
                    game.status = 'paused';
                    
                    // Set timeout for full cleanup
                    setTimeout(() => {
                        if (games.has(roomCode)) {
                            const currentGame = games.get(roomCode);
                            if (currentGame.status === 'paused' && 
                                currentGame.players[playerIndex].id === socketId) {
                                currentGame.status = 'abandoned';
                                io.to(roomCode).emit('playerLeft', { playerId: playerIndex });
                                
                                // Final cleanup after additional delay
                                setTimeout(() => {
                                    if (games.has(roomCode) {
                                        games.delete(roomCode);
                                        console.log(`Cleaned up abandoned game: ${roomCode}`);
                                    }
                                }, 30000);
                            }
                        }
                    }, 120000);
                } else if (game.status === 'waiting') {
                    // Remove waiting game immediately
                    games.delete(roomCode);
                    console.log(`Removed waiting game: ${roomCode}`);
                }
            }
        }
        playerRooms.delete(socketId);
        playerSockets.delete(socketId);
    }
}

// Socket.io connection handling with enhanced features
io.on('connection', (socket) => {
    console.log('New client connected:', socket.id);
    playerSockets.set(socket.id, socket);

    // Handle reconnection attempts
    socket.on('restoreSession', (data) => {
        try {
            const { roomCode, playerId, token } = data;
            const game = games.get(roomCode);
            
            if (!game || game.status !== 'paused') {
                socket.emit('restoreFailed', { message: 'Game not available for restoration' });
                return;
            }
            
            const playerData = game.players[playerId];
            if (!playerData || playerData.id !== socket.id) {
                socket.emit('restoreFailed', { message: 'Invalid player data' });
                return;
            }
            
            const storedToken = game.reconnectionTokens.get(socket.id);
            if (!storedToken || storedToken.token !== token || storedToken.expires < Date.now()) {
                socket.emit('restoreFailed', { message: 'Invalid or expired token' });
                return;
            }
            
            // Successful reconnection
            game.reconnectionTokens.delete(socket.id);
            game.status = 'playing';
            playerRooms.set(socket.id, roomCode);
            socket.join(roomCode);
            
            const gameData = {
                players: game.players.map(p => ({ 
                    name: p.name, 
                    position: p.position, 
                    walls: p.walls 
                })),
                board: game.board,
                currentTurn: game.currentTurn
            };
            
            socket.emit('sessionRestored', { 
                gameData,
                playerId,
                message: 'Successfully reconnected to game'
            });
            
            io.to(roomCode).emit('playerReconnected', { playerId });
            console.log(`Player reconnected: ${socket.id} to game ${roomCode}`);
            
        } catch (error) {
            console.error('Error in restoreSession:', error);
            socket.emit('restoreFailed', { message: 'Failed to restore session' });
        }
    });

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
                    walls: 10,
                    lastPing: Date.now()
                };
                
                game = createNewGame(roomCode, newPlayer);
                games.set(roomCode, game);
                
                socket.join(roomCode);
                playerRooms.set(socket.id, roomCode);
                socket.emit('roomJoined', { 
                    roomCode, 
                    playerId: 0,
                    reconnectionToken: generateReconnectionToken()
                });
                
                console.log(`Room created: ${roomCode} by ${socket.id}`);
            } else if (game.players.length === 1 && game.status === 'waiting') {
                // Join existing room
                const newPlayer = {
                    id: socket.id,
                    name: playerName,
                    position: { x: 4, y: 8 },
                    walls: 10,
                    lastPing: Date.now()
                };
                
                game.players.push(newPlayer);
                socket.join(roomCode);
                playerRooms.set(socket.id, roomCode);
                socket.emit('roomJoined', { 
                    roomCode, 
                    playerId: 1,
                    reconnectionToken: generateReconnectionToken()
                });

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
            game.players[playerId].lastPing = Date.now();
            updateGameActivity(roomCode);

            // Check win condition
            if (checkWinCondition(game, playerId)) {
                game.status = 'finished';
                io.to(roomCode).emit('gameOver', { winner: playerId });
                console.log(`Game ${roomCode} finished, winner: ${playerId}`);
                
                // Clean up finished game after a delay
                setTimeout(() => {
                    if (games.has(roomCode)) {
                        games.delete(roomCode);
                        console.log(`Cleaned up finished game: ${roomCode}`);
                    }
                }, 60000);
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
            game.players[playerId].lastPing = Date.now();
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

    // Ping handler for connection health monitoring
    socket.on('ping', () => {
        const roomCode = playerRooms.get(socket.id);
        if (roomCode) {
            const game = games.get(roomCode);
            if (game) {
                const player = game.players.find(p => p.id === socket.id);
                if (player) {
                    player.lastPing = Date.now();
                }
            }
        }
        socket.emit('pong');
    });

    socket.on('disconnect', (reason) => {
        console.log('Client disconnected:', socket.id, 'Reason:', reason);
        cleanupPlayer(socket.id);
    });

    socket.on('error', (error) => {
        console.error('Socket error:', error);
    });
});

// Enhanced game cleanup with ping checks
setInterval(() => {
    const now = Date.now();
    const GAME_TIMEOUT = 30 * 60 * 1000; // 30 minutes
    const WAITING_TIMEOUT = 10 * 60 * 1000; // 10 minutes for waiting games
    const PING_TIMEOUT = 30000; // 30 seconds
    
    // Clean up expired reconnection tokens
    for (const [roomCode, game] of games.entries()) {
        for (const [playerId, tokenData] of game.reconnectionTokens.entries()) {
            if (tokenData.expires < now) {
                game.reconnectionTokens.delete(playerId);
            }
        }
    }
    
    // Check for inactive players in active games
    for (const [roomCode, game] of games.entries()) {
        if (game.status === 'playing') {
            for (const player of game.players) {
                if (player.lastPing && (now - player.lastPing) > PING_TIMEOUT) {
                    const socket = playerSockets.get(player.id);
                    if (socket) {
                        socket.disconnect(true);
                        console.log(`Disconnected inactive player: ${player.id}`);
                    }
                }
            }
        }
    }
    
    // Clean up old games
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
        } else if (game.status === 'paused') {
            // Check if all reconnection tokens are expired
            const allTokensExpired = Array.from(game.reconnectionTokens.values())
                .every(token => token.expires < now);
            shouldDelete = allTokensExpired && timeSinceActivity > 120000; // 2 minutes
        }
        
        if (shouldDelete) {
            // Clean up player room mappings
            game.players.forEach(player => {
                playerRooms.delete(player.id);
                playerSockets.delete(player.id);
            });
            
            games.delete(roomCode);
            console.log(`Cleaned up game: ${roomCode} (status: ${game.status})`);
        }
    }
    
    console.log(`Active games: ${games.size}, Active player mappings: ${playerRooms.size}`);
}, 30000); // Check every 30 seconds

// Enhanced server keep-alive mechanism
setInterval(() => {
    // This helps prevent the server from being closed due to inactivity
    console.log('Keep-alive ping');
}, 300000); // Every 5 minutes

// Graceful shutdown with enhanced cleanup
function gracefulShutdown() {
    console.log('Shutdown signal received, initiating graceful shutdown');
    
    // Notify all clients
    io.emit('serverMaintenance', { message: 'Server is restarting, please reconnect shortly' });
    
    // Disconnect all sockets
    io.sockets.sockets.forEach(socket => {
        socket.disconnect(true);
    });
    
    // Close server after short delay
    setTimeout(() => {
        server.close(() => {
            console.log('Server closed');
            process.exit(0);
        });
    }, 5000);
}

process.on('SIGTERM', gracefulShutdown);
process.on('SIGINT', gracefulShutdown);

// Enhanced error handling
process.on('uncaughtException', (error) => {
    console.error('Uncaught Exception:', error);
    // Don't exit for uncaught exceptions - keep the server running
});

process.on('unhandledRejection', (reason, promise) => {
    console.error('Unhandled Rejection at:', promise, 'reason:', reason);
});

// Start server with enhanced configuration
const PORT = process.env.PORT || 3000;
server.listen(PORT, '0.0.0.0', () => {
    console.log(`Quoridor server running on port ${PORT}`);
    console.log(`Server URL: https://wall-chess.onrender.com`);
    console.log(`Health check: https://wall-chess.onrender.com/health`);
    
    // Enable keep-alive for all connections
    server.keepAliveTimeout = 60000; // 60 seconds
    server.headersTimeout = 65000; // 65 seconds
});

// Prevent server from closing on connection errors
server.on('clientError', (err, socket) => {
    console.error('Client connection error:', err);
    socket.end('HTTP/1.1 400 Bad Request\r\n\r\n');
});
