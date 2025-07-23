const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = socketIo(server);

// Serve static files
app.use(express.static(path.join(__dirname, 'public')));

// Game state
const games = {};

// Socket.io connection handling
io.on('connection', (socket) => {
  console.log('New client connected:', socket.id);

  // Join a room with room code
  socket.on('joinRoom', (data) => {
    const roomCode = data.roomCode;
    let game = games[roomCode];

    if (!game) {
      // Create new game room
      games[roomCode] = {
        id: roomCode,
        players: [{ id: socket.id, walls: 10, position: { x: 4, y: 0 } }],
        board: initializeBoard(),
        currentTurn: 0,
        status: 'waiting'
      };

      socket.join(roomCode);
      socket.emit('roomJoined', { roomCode, playerId: 0 });
      console.log(`Room created: ${roomCode} by ${socket.id}`);
    } else if (game.players.length === 1) {
      // Join existing room
      game.players.push({
        id: socket.id,
        walls: 10,
        position: { x: 4, y: 8 }
      });

      socket.join(roomCode);
      socket.emit('roomJoined', { roomCode, playerId: 1 });

      // Start the game
      game.status = 'playing';
      io.to(roomCode).emit('gameStarted', game);
      console.log(`Player joined room: ${roomCode}`);
    } else {
      socket.emit('error', { message: 'Room is full' });
    }
  });

  // Player moves
  socket.on('movePawn', (data) => {
    const { roomCode, playerId, position } = data;
    const game = games[roomCode];

    if (!game || game.status !== 'playing') return;
    if (game.currentTurn !== playerId) return;

    // Validate move
    if (isValidMove(game, playerId, position)) {
      game.players[playerId].position = position;

      // Check win condition
      if (checkWinCondition(game, playerId)) {
        game.status = 'finished';
        io.to(roomCode).emit('gameOver', { winner: playerId });
      } else {
        // Next player's turn
        game.currentTurn = (game.currentTurn + 1) % game.players.length;
        io.to(roomCode).emit('gameUpdated', game);
      }
    }
  });

  // Place wall
  socket.on('placeWall', (data) => {
    const { roomCode, playerId, wall } = data;
    const game = games[roomCode];

    if (!game || game.status !== 'playing') return;
    if (game.currentTurn !== playerId) return;

    // Validate wall placement
    if (isValidWallPlacement(game, playerId, wall)) {
      // Update walls on the board
      placeWallOnBoard(game.board, wall);

      // Decrease player's wall count
      game.players[playerId].walls--;

      // Next player's turn
      game.currentTurn = (game.currentTurn + 1) % game.players.length;
      io.to(roomCode).emit('gameUpdated', game);
    }
  });

  // Handle disconnection
  socket.on('disconnect', () => {
    console.log('Client disconnected:', socket.id);

    // Find and handle any games this player was in
    for (const gameId in games) {
      const game = games[gameId];
      const playerIndex = game.players.findIndex(p => p.id === socket.id);

      if (playerIndex !== -1) {
        if (game.status === 'playing') {
          game.status = 'abandoned';
          io.to(gameId).emit('playerLeft', { playerId: playerIndex });
        } else if (game.status === 'waiting') {
          delete games[gameId];
        }
      }
    }
  });
});

// Helper functions
function generateGameId() {
  return Math.random().toString(36).substring(2, 8);
}

function initializeBoard() {
  // Create a 9x9 board with no walls
  const board = {
    cells: Array(9).fill().map(() => Array(9).fill(0)),
    horizontalWalls: Array(8).fill().map(() => Array(9).fill(false)),
    verticalWalls: Array(9).fill().map(() => Array(8).fill(false))
  };
  return board;
}

function isValidMove(game, playerId, newPosition) {
  const player = game.players[playerId];
  const currentPos = player.position;

  // Check if move is within bounds
  if (newPosition.x < 0 || newPosition.x > 8 || newPosition.y < 0 || newPosition.y > 8) {
    return false;
  }

  // Check if it's a valid adjacent move
  const isAdjacent = (
    (Math.abs(newPosition.x - currentPos.x) === 1 && newPosition.y === currentPos.y) ||
    (Math.abs(newPosition.y - currentPos.y) === 1 && newPosition.x === currentPos.x)
  );

  if (!isAdjacent) {
    // Check if it's a valid jump move
    const isJump = checkJumpMove(game, currentPos, newPosition);
    if (!isJump) return false;
  }

  // Check if there's a wall blocking the move
  if (isWallBetween(game.board, currentPos, newPosition)) {
    return false;
  }

  return true;
}

function checkJumpMove(game, currentPos, newPosition) {
  // Find if there's an opponent between current position and new position
  const opponentPos = game.players.find(p =>
    p.position.x === (currentPos.x + newPosition.x) / 2 &&
    p.position.y === (currentPos.y + newPosition.y) / 2
  )?.position;

  if (!opponentPos) return false;

  // Check if the jump is valid (2 squares in same direction)
  const isValidJump = (
    (Math.abs(newPosition.x - currentPos.x) === 2 && newPosition.y === currentPos.y) ||
    (Math.abs(newPosition.y - currentPos.y) === 2 && newPosition.x === currentPos.x)
  );

  return isValidJump && !isWallBetween(game.board, currentPos, opponentPos) &&
    !isWallBetween(game.board, opponentPos, newPosition);
}

function isWallBetween(board, pos1, pos2) {
  // Check horizontal walls
  if (pos1.y === pos2.y && Math.abs(pos1.x - pos2.x) === 1) {
    const minX = Math.min(pos1.x, pos2.x);
    return board.verticalWalls[minX][pos1.y];
  }

  // Check vertical walls
  if (pos1.x === pos2.x && Math.abs(pos1.y - pos2.y) === 1) {
    const minY = Math.min(pos1.y, pos2.y);
    return board.horizontalWalls[pos1.x][minY];
  }

  return false;
}

function isValidWallPlacement(game, playerId, wall) {
  const player = game.players[playerId];

  // Check if player has walls left
  if (player.walls <= 0) return false;

  const { x, y, orientation } = wall;

  // Check if wall is within bounds
  if (orientation === 'horizontal') {
    if (x < 0 || x > 7 || y < 0 || y > 8) return false;

    // Check if wall overlaps with existing walls
    if (game.board.horizontalWalls[x][y] || game.board.horizontalWalls[x + 1][y]) return false;

    // Check for intersecting walls
    if (y > 0 && y < 8 && game.board.verticalWalls[x][y - 1] && game.board.verticalWalls[x][y]) return false;
  } else { // vertical
    if (x < 0 || x > 8 || y < 0 || y > 7) return false;

    // Check if wall overlaps with existing walls
    if (game.board.verticalWalls[x][y] || game.board.verticalWalls[x][y + 1]) return false;

    // Check for intersecting walls
    if (x > 0 && x < 8 && game.board.horizontalWalls[x - 1][y] && game.board.horizontalWalls[x][y]) return false;
  }

  // Check if wall placement blocks all paths to goal
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
  } else { // vertical
    board.verticalWalls[x][y] = true;
    board.verticalWalls[x][y + 1] = true;
  }
}

function hasPathToGoal(board, position, playerId) {
  // Use BFS to check if there's a path to the goal
  const visited = Array(9).fill().map(() => Array(9).fill(false));
  const queue = [position];
  visited[position.x][position.y] = true;

  const goalY = playerId === 0 ? 8 : 0;

  while (queue.length > 0) {
    const pos = queue.shift();

    // Check if reached goal
    if (pos.y === goalY) return true;

    // Try all four directions
    const directions = [
      { x: 0, y: 1 }, // down
      { x: 0, y: -1 }, // up
      { x: 1, y: 0 }, // right
      { x: -1, y: 0 } // left
    ];

    for (const dir of directions) {
      const newPos = { x: pos.x + dir.x, y: pos.y + dir.y };

      // Check if new position is valid
      if (newPos.x < 0 || newPos.x > 8 || newPos.y < 0 || newPos.y > 8) continue;
      if (visited[newPos.x][newPos.y]) continue;

      // Check if there's a wall blocking
      if (isWallBetween(board, pos, newPos)) continue;

      visited[newPos.x][newPos.y] = true;
      queue.push(newPos);
    }
  }

  return false;
}

function checkWinCondition(game, playerId) {
  const player = game.players[playerId];

  // Player 0 wins by reaching the bottom row
  if (playerId === 0 && player.position.y === 8) return true;

  // Player 1 wins by reaching the top row
  if (playerId === 1 && player.position.y === 0) return true;

  return false;
}

// Start the server
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
