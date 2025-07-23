import express from 'express';
import http from 'http';
import { Server } from 'socket.io';
import path from 'path';
import { fileURLToPath } from 'url';
import cors from 'cors';
import fetch from 'node-fetch';

// --- Server Configuration ---
const app = express();
const server = http.createServer(app);

// --- Get the directory name ---
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// --- Socket.IO Configuration ---
const io = new Server(server, {
    cors: {
        origin: "*", // Allow all origins for simplicity, can be restricted in production
        methods: ["GET", "POST"]
    },
    pingTimeout: 60000,
    pingInterval: 25000,
    transports: ['websocket', 'polling'],
    connectionStateRecovery: {
        maxDisconnectionDuration: 2 * 60 * 1000, // 2 minutes
        skipMiddlewares: true
    }
});

// --- Middleware ---
// Serve static files from the root directory
app.use(express.static(path.join(__dirname)));

// --- Routes ---
// Serve index.html for the root route
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

// Health check endpoint
app.get('/health', (req, res) => {
    res.status(200).json({
        status: 'OK',
        timestamp: new Date().toISOString(),
        uptime: process.uptime(),
        gamesCount: games.size,
        playersCount: playerRooms.size
    });
});

// Keep-alive endpoint to prevent the server from sleeping
app.get('/keepalive', (req, res) => {
    res.status(204).send(); // 204 No Content is a good response for this
});

// --- Game State Management ---
const games = new Map();
const playerRooms = new Map();

// --- Helper Functions ---
function generateRoomCode() {
    let code;
    do {
        // Generates a 6-character alphanumeric code
        code = Math.random().toString(36).substring(2, 8).toUpperCase();
    } while (games.has(code));
    return code;
}

function initializeBoard() {
    return {
        horizontalWalls: Array(8).fill(null).map(() => Array(9).fill(false)),
        verticalWalls: Array(9).fill(null).map(() => Array(8).fill(false))
    };
}

function createNewGame(roomCode, firstPlayer) {
    const game = {
        id: roomCode,
        players: [firstPlayer],
        board: initializeBoard(),
        currentTurn: 0,
        status: 'waiting', // waiting, playing, finished
        createdAt: Date.now(),
        lastActivity: Date.now()
    };
    games.set(roomCode, game);
    return game;
}

function checkWinCondition(game, playerId) {
    const player = game.players[playerId];
    if (!player) return false;
    const goalY = playerId === 0 ? 8 : 0;
    return player.position.y === goalY;
}

// --- Socket.IO Connection Handling ---
io.on('connection', (socket) => {
    console.log(`✅ Client connected: ${socket.id}`);

    socket.on('joinRoom', (data) => {
        try {
            const playerName = data.playerName || 'Anonymous';
            let roomCode = data.roomCode;
            let game;

            if (roomCode) {
                game = games.get(roomCode);
                if (!game || (game.players.length >= 2 && game.status !== 'waiting')) {
                    socket.emit('error', { message: 'Room is full or does not exist.' });
                    return;
                }
            } else {
                roomCode = generateRoomCode();
                const firstPlayer = {
                    id: socket.id,
                    name: playerName,
                    position: { x: 4, y: 0 },
                    walls: 10
                };
                game = createNewGame(roomCode, firstPlayer);
                 console.log(`🚪 Room created: ${roomCode} by ${socket.id}`);
            }

            socket.join(roomCode);
            playerRooms.set(socket.id, roomCode);

            const playerIndex = game.players.findIndex(p => p.id === socket.id);

            // If player is not in the game and there's space, add them
            if (playerIndex === -1 && game.players.length < 2) {
                 const newPlayer = {
                    id: socket.id,
                    name: playerName,
                    position: { x: 4, y: 8 }, // Player 2 starts at the bottom
                    walls: 10
                };
                game.players.push(newPlayer);
            }

            const newPlayerIndex = game.players.findIndex(p => p.id === socket.id);
            socket.emit('roomJoined', { roomCode, playerId: newPlayerIndex });

            if (game.players.length === 2 && game.status === 'waiting') {
                game.status = 'playing';
                game.lastActivity = Date.now();
                io.to(roomCode).emit('gameStarted', game);
                console.log(`🎉 Game started in room: ${roomCode}`);
            }

        } catch (error) {
            console.error('Error in joinRoom:', error);
            socket.emit('error', { message: 'Failed to join room' });
        }
    });

    socket.on('movePawn', ({ roomCode, playerId, position }) => {
        const game = games.get(roomCode);
        if (game && game.currentTurn === playerId) {
            game.players[playerId].position = position;
            game.lastActivity = Date.now();

            if (checkWinCondition(game, playerId)) {
                io.to(roomCode).emit('gameOver', { winner: playerId });
                games.delete(roomCode); // Clean up finished game
            } else {
                game.currentTurn = 1 - playerId; // Switch turns
                io.to(roomCode).emit('gameUpdated', game);
            }
        }
    });

    socket.on('placeWall', ({ roomCode, playerId, wall }) => {
        const game = games.get(roomCode);
        if (game && game.currentTurn === playerId && game.players[playerId].walls > 0) {
            // NOTE: Add your full wall validation logic here
            if (wall.orientation === 'horizontal') {
                game.board.horizontalWalls[wall.x][wall.y] = true;
            } else {
                game.board.verticalWalls[wall.x][wall.y] = true;
            }
            game.players[playerId].walls--;
            game.currentTurn = 1 - playerId; // Switch turns
            game.lastActivity = Date.now();
            io.to(roomCode).emit('gameUpdated', game);
        }
    });

    socket.on('disconnect', () => {
        console.log(`❌ Client disconnected: ${socket.id}`);
        const roomCode = playerRooms.get(socket.id);
        if (roomCode) {
            const game = games.get(roomCode);
            if (game) {
                 const playerIndex = game.players.findIndex(p => p.id === socket.id);
                if (playerIndex !== -1) {
                    io.to(roomCode).emit('playerLeft', { playerId: playerIndex });
                    // Instead of deleting the game, you might want to handle it differently
                    // For now, we'll just log it. In a real app, you might pause it.
                    console.log(`Player ${playerIndex} left room ${roomCode}.`);
                }
            }
            playerRooms.delete(socket.id);
        }
    });
});

// --- Server Keep-Alive ---
// The URL of your deployed Render app
const APP_URL = "https://wall-chess.onrender.com";

const keepAlive = () => {
    fetch(`${APP_URL}/keepalive`).then(res => {
        if (res.ok) {
            console.log(`Ping successful at ${new Date().toLocaleTimeString()}`);
        } else {
            console.error(`Ping failed with status: ${res.status}`);
        }
    }).catch(error => {
        console.error('Error during keep-alive ping:', error);
    });
};

// Ping the server every 14 minutes (840,000 milliseconds) to prevent sleeping
setInterval(keepAlive, 840000);

// --- Start Server ---
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`🚀 Server is running on port ${PORT}`);
    // Initial ping to start the keep-alive process immediately
    keepAlive();
});

// --- Graceful Shutdown ---
function gracefulShutdown() {
    console.log('Initiating graceful shutdown...');
    io.emit('serverMaintenance', { message: 'Server is restarting. Please reconnect shortly.' });
    server.close(() => {
        console.log('Server closed.');
        process.exit(0);
    });
}

process.on('SIGTERM', gracefulShutdown);
process.on('SIGINT', gracefulShutdown);

process.on('uncaughtException', (error) => {
    console.error('🚨 Uncaught Exception:', error);
});

process.on('unhandledRejection', (reason, promise) => {
    console.error('🚨 Unhandled Rejection at:', promise, 'reason:', reason);
});
