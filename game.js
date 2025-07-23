// Game State Management
class GameState {
    constructor() {
        this.board = this.initializeBoard();
        this.players = [
            { id: 0, name: 'Player 1', position: { x: 4, y: 0 }, walls: 10, isAI: false },
            { id: 1, name: 'Player 2', position: { x: 4, y: 8 }, walls: 10, isAI: false }
        ];
        this.currentPlayer = 0;
        this.gameMode = 'offline-human';
        this.gameStatus = 'waiting'; // waiting, playing, paused, finished
        this.moveHistory = [];
        this.startTime = null;
        this.elapsedTime = 0;
        this.settings = this.loadSettings();
        this.statistics = this.loadStatistics();
        this.currentAction = null; // 'move' or 'wall'
        this.wallOrientation = 'horizontal';
        this.undoStack = [];
        this.maxUndos = 3;
    }

    initializeBoard() {
        return {
            cells: Array(9).fill().map(() => Array(9).fill(null)),
            horizontalWalls: Array(8).fill().map(() => Array(9).fill(false)),
            verticalWalls: Array(9).fill().map(() => Array(8).fill(false))
        };
    }

    loadSettings() {
        const defaultSettings = {
            soundEnabled: true,
            musicEnabled: true,
            hintsEnabled: true,
            animationSpeed: 'normal',
            boardTheme: 'classic'
        };
        
        const saved = localStorage.getItem('quoridor-settings');
        return saved ? { ...defaultSettings, ...JSON.parse(saved) } : defaultSettings;
    }

    saveSettings() {
        localStorage.setItem('quoridor-settings', JSON.stringify(this.settings));
    }

    loadStatistics() {
        const defaultStats = {
            totalGames: 0,
            gamesWon: 0,
            totalMoves: 0,
            totalPlayTime: 0,
            bestTime: null,
            winStreak: 0,
            maxWinStreak: 0
        };
        
        const saved = localStorage.getItem('quoridor-statistics');
        return saved ? { ...defaultStats, ...JSON.parse(saved) } : defaultStats;
    }

    saveStatistics() {
        localStorage.setItem('quoridor-statistics', JSON.stringify(this.statistics));
    }

    resetStatistics() {
        this.statistics = {
            totalGames: 0,
            gamesWon: 0,
            totalMoves: 0,
            totalPlayTime: 0,
            bestTime: null,
            winStreak: 0,
            maxWinStreak: 0
        };
        this.saveStatistics();
    }

    startGame(mode, difficulty = null) {
        this.gameMode = mode;
        this.gameStatus = 'playing';
        this.startTime = Date.now();
        this.moveHistory = [];
        this.undoStack = [];
        this.currentPlayer = 0;
        
        // Reset board and players
        this.board = this.initializeBoard();
        this.players = [
            { id: 0, name: 'Player 1', position: { x: 4, y: 0 }, walls: 10, isAI: false },
            { id: 1, name: 'Player 2', position: { x: 4, y: 8 }, walls: 10, isAI: false }
        ];

        if (mode === 'offline-ai') {
            this.players[1].isAI = true;
            this.players[1].name = `AI (${difficulty})`;
            this.players[1].difficulty = difficulty;
        }

        this.updateUI();
        this.startTimer();
        
        if (this.settings.soundEnabled) {
            this.playSound('gameStart');
        }
    }

    pauseGame() {
        if (this.gameStatus === 'playing') {
            this.gameStatus = 'paused';
            this.stopTimer();
        }
    }

    resumeGame() {
        if (this.gameStatus === 'paused') {
            this.gameStatus = 'playing';
            this.startTimer();
        }
    }

    endGame(winner) {
        this.gameStatus = 'finished';
        this.stopTimer();
        
        // Update statistics
        this.statistics.totalGames++;
        this.statistics.totalMoves += this.moveHistory.length;
        this.statistics.totalPlayTime += this.elapsedTime;
        
        if (winner === 0) { // Human player won
            this.statistics.gamesWon++;
            this.statistics.winStreak++;
            this.statistics.maxWinStreak = Math.max(this.statistics.maxWinStreak, this.statistics.winStreak);
            
            if (!this.statistics.bestTime || this.elapsedTime < this.statistics.bestTime) {
                this.statistics.bestTime = this.elapsedTime;
            }
        } else {
            this.statistics.winStreak = 0;
        }
        
        this.saveStatistics();
        
        if (this.settings.soundEnabled) {
            this.playSound(winner === 0 ? 'victory' : 'defeat');
        }
        
        this.showGameOverModal(winner);
    }

    makeMove(playerId, move) {
        if (this.gameStatus !== 'playing' || this.currentPlayer !== playerId) {
            return false;
        }

        const player = this.players[playerId];
        const isValid = this.isValidMove(player.position, move);
        
        if (!isValid) {
            this.showToast('Invalid move!', 'error');
            return false;
        }

        // Save state for undo
        this.saveStateForUndo();

        // Make the move
        const oldPosition = { ...player.position };
        player.position = move;
        
        // Add to move history
        this.moveHistory.push({
            player: playerId,
            type: 'move',
            from: oldPosition,
            to: move,
            timestamp: Date.now() - this.startTime
        });

        // Check for win condition
        if (this.checkWinCondition(playerId)) {
            this.endGame(playerId);
            return true;
        }

        // Switch turns
        this.currentPlayer = (this.currentPlayer + 1) % 2;
        this.currentAction = null;
        
        this.updateUI();
        this.createMoveEffect(move);
        
        if (this.settings.soundEnabled) {
            this.playSound('move');
        }

        // AI turn
        if (this.players[this.currentPlayer].isAI && this.gameStatus === 'playing') {
            setTimeout(() => this.makeAIMove(), 1000);
        }

        return true;
    }

    placeWall(playerId, wall) {
        if (this.gameStatus !== 'playing' || this.currentPlayer !== playerId) {
            return false;
        }

        const player = this.players[playerId];
        
        if (player.walls <= 0) {
            this.showToast('No walls remaining!', 'error');
            return false;
        }

        if (!this.isValidWallPlacement(wall)) {
            this.showToast('Invalid wall placement!', 'error');
            return false;
        }

        // Save state for undo
        this.saveStateForUndo();

        // Place the wall
        this.placeWallOnBoard(wall);
        player.walls--;
        
        // Add to move history
        this.moveHistory.push({
            player: playerId,
            type: 'wall',
            wall: wall,
            timestamp: Date.now() - this.startTime
        });

        // Switch turns
        this.currentPlayer = (this.currentPlayer + 1) % 2;
        this.currentAction = null;
        
        this.updateUI();
        this.createWallEffect(wall);
        
        if (this.settings.soundEnabled) {
            this.playSound('wallPlace');
        }

        // AI turn
        if (this.players[this.currentPlayer].isAI && this.gameStatus === 'playing') {
            setTimeout(() => this.makeAIMove(), 1000);
        }

        return true;
    }

    isValidMove(from, to) {
        // Check bounds
        if (to.x < 0 || to.x > 8 || to.y < 0 || to.y > 8) {
            return false;
        }

        // Check if target cell is occupied
        if (this.isCellOccupied(to)) {
            return false;
        }

        const dx = Math.abs(to.x - from.x);
        const dy = Math.abs(to.y - from.y);

        // Adjacent move
        if ((dx === 1 && dy === 0) || (dx === 0 && dy === 1)) {
            return !this.isWallBetween(from, to);
        }

        // Jump move
        if ((dx === 2 && dy === 0) || (dx === 0 && dy === 2)) {
            const midPoint = {
                x: from.x + (to.x - from.x) / 2,
                y: from.y + (to.y - from.y) / 2
            };
            
            // Check if there's an opponent at the midpoint
            if (!this.isCellOccupied(midPoint)) {
                return false;
            }
            
            // Check if there are no walls blocking the jump
            return !this.isWallBetween(from, midPoint) && !this.isWallBetween(midPoint, to);
        }

        // Diagonal jump (when straight jump is blocked)
        if (dx === 1 && dy === 1) {
            // Find the opponent position
            const opponentPos = this.findOpponentAdjacentTo(from);
            if (!opponentPos) return false;
            
            // Check if the straight jump is blocked by a wall
            const straightJump = {
                x: from.x + (opponentPos.x - from.x) * 2,
                y: from.y + (opponentPos.y - from.y) * 2
            };
            
            if (straightJump.x >= 0 && straightJump.x <= 8 && 
                straightJump.y >= 0 && straightJump.y <= 8 && 
                !this.isCellOccupied(straightJump) && 
                !this.isWallBetween(opponentPos, straightJump)) {
                return false; // Straight jump is available, diagonal not allowed
            }
            
            return !this.isWallBetween(from, opponentPos) && !this.isWallBetween(opponentPos, to);
        }

        return false;
    }

    isValidWallPlacement(wall) {
        const { x, y, orientation } = wall;

        // Check bounds
        if (orientation === 'horizontal') {
            if (x < 0 || x > 7 || y < 1 || y > 8) return false;
        } else {
            if (x < 1 || x > 8 || y < 0 || y > 7) return false;
        }

        // Check if wall already exists
        if (orientation === 'horizontal') {
            if (this.board.horizontalWalls[x][y] || this.board.horizontalWalls[x + 1][y]) {
                return false;
            }
        } else {
            if (this.board.verticalWalls[x][y] || this.board.verticalWalls[x][y + 1]) {
                return false;
            }
        }

        // Check for wall intersections
        if (orientation === 'horizontal' && y > 0 && y < 8) {
            if (this.board.verticalWalls[x + 1][y - 1] && this.board.verticalWalls[x + 1][y]) {
                return false;
            }
        } else if (orientation === 'vertical' && x > 0 && x < 8) {
            if (this.board.horizontalWalls[x - 1][y + 1] && this.board.horizontalWalls[x][y + 1]) {
                return false;
            }
        }

        // Check if wall blocks all paths (temporarily place wall and test)
        const tempBoard = JSON.parse(JSON.stringify(this.board));
        this.placeWallOnTempBoard(tempBoard, wall);
        
        for (let player of this.players) {
            if (!this.hasPathToGoal(tempBoard, player.position, player.id)) {
                return false;
            }
        }

        return true;
    }

    placeWallOnBoard(wall) {
        const { x, y, orientation } = wall;
        
        if (orientation === 'horizontal') {
            this.board.horizontalWalls[x][y] = true;
            this.board.horizontalWalls[x + 1][y] = true;
        } else {
            this.board.verticalWalls[x][y] = true;
            this.board.verticalWalls[x][y + 1] = true;
        }
    }

    placeWallOnTempBoard(board, wall) {
        const { x, y, orientation } = wall;
        
        if (orientation === 'horizontal') {
            board.horizontalWalls[x][y] = true;
            board.horizontalWalls[x + 1][y] = true;
        } else {
            board.verticalWalls[x][y] = true;
            board.verticalWalls[x][y + 1] = true;
        }
    }

    isWallBetween(pos1, pos2) {
        if (pos1.x === pos2.x) {
            // Vertical movement
            const x = pos1.x;
            const minY = Math.min(pos1.y, pos2.y);
            return this.board.horizontalWalls[x][minY + 1];
        } else if (pos1.y === pos2.y) {
            // Horizontal movement
            const y = pos1.y;
            const minX = Math.min(pos1.x, pos2.x);
            return this.board.verticalWalls[minX + 1][y];
        }
        return false;
    }

    isCellOccupied(pos) {
        return this.players.some(player => 
            player.position.x === pos.x && player.position.y === pos.y
        );
    }

    findOpponentAdjacentTo(pos) {
        const directions = [
            { x: 0, y: 1 }, { x: 0, y: -1 },
            { x: 1, y: 0 }, { x: -1, y: 0 }
        ];
        
        for (let dir of directions) {
            const checkPos = { x: pos.x + dir.x, y: pos.y + dir.y };
            if (this.isCellOccupied(checkPos)) {
                return checkPos;
            }
        }
        return null;
    }

    hasPathToGoal(board, position, playerId) {
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
            
            for (let dir of directions) {
                const newPos = { x: pos.x + dir.x, y: pos.y + dir.y };
                
                if (newPos.x < 0 || newPos.x > 8 || newPos.y < 0 || newPos.y > 8) continue;
                if (visited[newPos.x][newPos.y]) continue;
                if (this.isWallBetweenOnBoard(board, pos, newPos)) continue;
                
                visited[newPos.x][newPos.y] = true;
                queue.push(newPos);
            }
        }
        
        return false;
    }

    isWallBetweenOnBoard(board, pos1, pos2) {
        if (pos1.x === pos2.x) {
            const x = pos1.x;
            const minY = Math.min(pos1.y, pos2.y);
            return board.horizontalWalls[x][minY + 1];
        } else if (pos1.y === pos2.y) {
            const y = pos1.y;
            const minX = Math.min(pos1.x, pos2.x);
            return board.verticalWalls[minX + 1][y];
        }
        return false;
    }

    checkWinCondition(playerId) {
        const player = this.players[playerId];
        return (playerId === 0 && player.position.y === 8) || 
               (playerId === 1 && player.position.y === 0);
    }

    getValidMoves(playerId) {
        const player = this.players[playerId];
        const moves = [];
        
        // Check all possible moves
        for (let x = 0; x < 9; x++) {
            for (let y = 0; y < 9; y++) {
                const move = { x, y };
                if (this.isValidMove(player.position, move)) {
                    moves.push(move);
                }
            }
        }
        
        return moves;
    }

    getValidWallPlacements(playerId) {
        const walls = [];
        
        // Check horizontal walls
        for (let x = 0; x < 8; x++) {
            for (let y = 1; y < 9; y++) {
                const wall = { x, y, orientation: 'horizontal' };
                if (this.isValidWallPlacement(wall)) {
                    walls.push(wall);
                }
            }
        }
        
        // Check vertical walls
        for (let x = 1; x < 9; x++) {
            for (let y = 0; y < 8; y++) {
                const wall = { x, y, orientation: 'vertical' };
                if (this.isValidWallPlacement(wall)) {
                    walls.push(wall);
                }
            }
        }
        
        return walls;
    }

    saveStateForUndo() {
        if (this.undoStack.length >= this.maxUndos) {
            this.undoStack.shift();
        }
        
        this.undoStack.push({
            board: JSON.parse(JSON.stringify(this.board)),
            players: JSON.parse(JSON.stringify(this.players)),
            currentPlayer: this.currentPlayer,
            moveHistory: [...this.moveHistory]
        });
    }

    undoMove() {
        if (this.undoStack.length === 0 || this.gameStatus !== 'playing') {
            this.showToast('No moves to undo!', 'warning');
            return false;
        }
        
        const previousState = this.undoStack.pop();
        this.board = previousState.board;
        this.players = previousState.players;
        this.currentPlayer = previousState.currentPlayer;
        this.moveHistory = previousState.moveHistory;
        this.currentAction = null;
        
        this.updateUI();
        
        if (this.settings.soundEnabled) {
            this.playSound('undo');
        }
        
        this.showToast('Move undone!', 'info');
        return true;
    }

    makeAIMove() {
        if (this.gameStatus !== 'playing' || !this.players[this.currentPlayer].isAI) {
            return;
        }

        const aiPlayer = this.players[this.currentPlayer];
        const move = AI.getBestMove(this, this.currentPlayer, aiPlayer.difficulty);
        
        if (move.type === 'move') {
            this.makeMove(this.currentPlayer, move.position);
        } else if (move.type === 'wall') {
            this.placeWall(this.currentPlayer, move.wall);
        }
    }

    startTimer() {
        this.timerInterval = setInterval(() => {
            if (this.gameStatus === 'playing') {
                this.elapsedTime = Date.now() - this.startTime;
                this.updateTimer();
            }
        }, 1000);
    }

    stopTimer() {
        if (this.timerInterval) {
            clearInterval(this.timerInterval);
            this.timerInterval = null;
        }
    }

    updateTimer() {
        const minutes = Math.floor(this.elapsedTime / 60000);
        const seconds = Math.floor((this.elapsedTime % 60000) / 1000);
        const timeString = `${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
        
        const timerElement = document.getElementById('gameTimer');
        if (timerElement) {
            timerElement.textContent = timeString;
        }
    }

    createMoveEffect(position) {
        const effectsLayer = document.getElementById('effectsLayer');
        const effect = document.createElement('div');
        effect.className = 'move-effect';
        
        const cellSize = parseInt(getComputedStyle(document.documentElement).getPropertyValue('--cell-size'));
        const left = position.x * (cellSize + 4) + cellSize / 2;
        const top = position.y * (cellSize + 4) + cellSize / 2;
        
        effect.style.left = `${left}px`;
        effect.style.top = `${top}px`;
        
        effectsLayer.appendChild(effect);
        
        setTimeout(() => {
            if (effect.parentNode) {
                effect.parentNode.removeChild(effect);
            }
        }, 600);
    }

    createWallEffect(wall) {
        const effectsLayer = document.getElementById('effectsLayer');
        const effect = document.createElement('div');
        effect.className = 'wall-effect';
        
        const cellSize = parseInt(getComputedStyle(document.documentElement).getPropertyValue('--cell-size'));
        
        if (wall.orientation === 'horizontal') {
            const left = wall.x * (cellSize + 4) + cellSize;
            const top = wall.y * (cellSize + 4) - 4;
            effect.style.left = `${left}px`;
            effect.style.top = `${top}px`;
            effect.style.width = `${cellSize * 2 + 4}px`;
            effect.style.height = '20px';
        } else {
            const left = wall.x * (cellSize + 4) - 4;
            const top = wall.y * (cellSize + 4) + cellSize;
            effect.style.left = `${left}px`;
            effect.style.top = `${top}px`;
            effect.style.width = '20px';
            effect.style.height = `${cellSize * 2 + 4}px`;
        }
        
        effectsLayer.appendChild(effect);
        
        setTimeout(() => {
            if (effect.parentNode) {
                effect.parentNode.removeChild(effect);
            }
        }, 800);
    }

    playSound(soundName) {
        // Sound implementation would go here
        // For now, we'll just log the sound that would be played
        console.log(`Playing sound: ${soundName}`);
    }

    showToast(message, type = 'info') {
        UI.showToast(message, type);
    }

    showGameOverModal(winner) {
        UI.showGameOverModal(winner, this);
    }

    updateUI() {
        UI.updateGameState(this);
    }
}

// Initialize game
const game = new GameState();