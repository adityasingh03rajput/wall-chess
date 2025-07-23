// UI Management
class UI {
    static currentScreen = 'mainMenu';
    static tutorialStep = 1;
    static maxTutorialSteps = 4;

    static init() {
        this.setupEventListeners();
        this.createParticles();
        this.loadSettings();
        this.updateStatistics();
    }

    static setupEventListeners() {
        // Keyboard events
        document.addEventListener('keydown', (e) => {
            if (game.gameStatus === 'playing' && game.currentAction === 'wall') {
                if (e.key.toLowerCase() === 'r') {
                    this.rotateWall();
                }
            }
            
            if (e.key === 'Escape') {
                if (game.gameStatus === 'playing') {
                    showPauseMenu();
                } else {
                    this.closeAllModals();
                }
            }
        });

        // Settings event listeners
        document.getElementById('soundToggle').addEventListener('change', (e) => {
            game.settings.soundEnabled = e.target.checked;
            game.saveSettings();
        });

        document.getElementById('musicToggle').addEventListener('change', (e) => {
            game.settings.musicEnabled = e.target.checked;
            game.saveSettings();
        });

        document.getElementById('hintsToggle').addEventListener('change', (e) => {
            game.settings.hintsEnabled = e.target.checked;
            game.saveSettings();
        });

        document.getElementById('animationSpeed').addEventListener('change', (e) => {
            game.settings.animationSpeed = e.target.value;
            game.saveSettings();
            this.updateAnimationSpeed();
        });

        document.getElementById('boardTheme').addEventListener('change', (e) => {
            game.settings.boardTheme = e.target.value;
            game.saveSettings();
            this.updateBoardTheme();
        });
    }

    static createParticles() {
        const particles = document.getElementById('particles');
        
        // Create floating particles
        for (let i = 0; i < 50; i++) {
            const particle = document.createElement('div');
            particle.style.position = 'absolute';
            particle.style.width = Math.random() * 4 + 2 + 'px';
            particle.style.height = particle.style.width;
            particle.style.background = `rgba(255, 255, 255, ${Math.random() * 0.3 + 0.1})`;
            particle.style.borderRadius = '50%';
            particle.style.left = Math.random() * 100 + '%';
            particle.style.top = Math.random() * 100 + '%';
            particle.style.animation = `particleFloat ${Math.random() * 20 + 10}s ease-in-out infinite`;
            particle.style.animationDelay = Math.random() * 20 + 's';
            particles.appendChild(particle);
        }
    }

    static showScreen(screenId) {
        // Hide all screens
        document.querySelectorAll('.screen').forEach(screen => {
            screen.classList.remove('active');
        });
        
        // Show target screen
        const targetScreen = document.getElementById(screenId);
        if (targetScreen) {
            targetScreen.classList.add('active');
            this.currentScreen = screenId;
        }
    }

    static showModal(modalId) {
        const modal = document.getElementById(modalId);
        if (modal) {
            modal.classList.add('active');
        }
    }

    static hideModal(modalId) {
        const modal = document.getElementById(modalId);
        if (modal) {
            modal.classList.remove('active');
        }
    }

    static closeAllModals() {
        document.querySelectorAll('.modal').forEach(modal => {
            modal.classList.remove('active');
        });
    }

    static showToast(message, type = 'info', duration = 3000) {
        const toast = document.getElementById('toast');
        toast.textContent = message;
        toast.className = `toast ${type}`;
        toast.classList.add('show');
        
        setTimeout(() => {
            toast.classList.remove('show');
        }, duration);
    }

    static showLoading(text = 'Loading...') {
        const loadingScreen = document.getElementById('loadingScreen');
        const loadingText = document.getElementById('loadingText');
        loadingText.textContent = text;
        loadingScreen.classList.add('active');
    }

    static hideLoading() {
        const loadingScreen = document.getElementById('loadingScreen');
        loadingScreen.classList.remove('active');
    }

    static createBoard() {
        const board = document.getElementById('gameBoard');
        board.innerHTML = '';
        
        for (let y = 0; y < 9; y++) {
            for (let x = 0; x < 9; x++) {
                const cell = document.createElement('div');
                cell.className = 'cell';
                cell.dataset.x = x;
                cell.dataset.y = y;
                cell.setAttribute('tabindex', '0');
                cell.setAttribute('role', 'button');
                cell.setAttribute('aria-label', `Cell ${x}, ${y}`);
                
                cell.addEventListener('click', () => this.handleCellClick(x, y));
                cell.addEventListener('keydown', (e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault();
                        this.handleCellClick(x, y);
                    }
                });
                
                board.appendChild(cell);
            }
        }
    }

    static handleCellClick(x, y) {
        if (game.gameStatus !== 'playing' || game.currentPlayer !== 0) {
            return;
        }

        if (game.currentAction === 'move') {
            const move = { x, y };
            if (game.makeMove(0, move)) {
                this.clearHighlights();
                game.currentAction = null;
                this.updateActionButtons();
            }
        }
    }

    static updateGameState(gameState) {
        this.updatePlayerInfo(gameState);
        this.updateBoard(gameState);
        this.updateWalls(gameState);
        this.updateTurnIndicator(gameState);
        this.updateActionButtons();
        this.updateMoveHistory(gameState);
        
        if (game.currentAction === 'move' && game.settings.hintsEnabled) {
            this.highlightValidMoves();
        }
        
        if (game.currentAction === 'wall') {
            this.showWallPreviews();
        }
    }

    static updatePlayerInfo(gameState) {
        // Update player names
        document.getElementById('player1Name').textContent = gameState.players[0].name;
        document.getElementById('player2Name').textContent = gameState.players[1].name;
        
        // Update wall counts
        document.getElementById('player1Walls').textContent = gameState.players[0].walls;
        document.getElementById('player2Walls').textContent = gameState.players[1].walls;
        
        // Update active player indicator
        const player1Avatar = document.querySelector('.player-avatar.p1');
        const player2Avatar = document.querySelector('.player-avatar.p2');
        
        player1Avatar.classList.toggle('active', gameState.currentPlayer === 0);
        player2Avatar.classList.toggle('active', gameState.currentPlayer === 1);
    }

    static updateBoard(gameState) {
        // Clear existing pawns
        document.querySelectorAll('.pawn').forEach(pawn => pawn.remove());
        
        // Add pawns
        gameState.players.forEach((player, index) => {
            const cell = document.querySelector(`[data-x="${player.position.x}"][data-y="${player.position.y}"]`);
            if (cell) {
                const pawn = document.createElement('div');
                pawn.className = `pawn p${index + 1}`;
                pawn.textContent = index + 1;
                pawn.setAttribute('aria-label', `${player.name} pawn`);
                cell.appendChild(pawn);
            }
        });
    }

    static updateWalls(gameState) {
        const wallsLayer = document.getElementById('wallsLayer');
        
        // Clear existing walls (except previews)
        wallsLayer.querySelectorAll('.wall:not(.preview)').forEach(wall => wall.remove());
        
        const cellSize = parseInt(getComputedStyle(document.documentElement).getPropertyValue('--cell-size'));
        const gap = 4;
        
        // Add horizontal walls
        for (let x = 0; x < 8; x++) {
            for (let y = 0; y < 9; y++) {
                if (gameState.board.horizontalWalls[x][y]) {
                    const wall = document.createElement('div');
                    wall.className = 'wall horizontal placing';
                    
                    const left = x * (cellSize + gap) + cellSize / 2;
                    const top = y * (cellSize + gap) - 4;
                    
                    wall.style.left = `${left}px`;
                    wall.style.top = `${top}px`;
                    
                    wallsLayer.appendChild(wall);
                    
                    // Remove placing animation class after animation completes
                    setTimeout(() => wall.classList.remove('placing'), 300);
                }
            }
        }
        
        // Add vertical walls
        for (let x = 0; x < 9; x++) {
            for (let y = 0; y < 8; y++) {
                if (gameState.board.verticalWalls[x][y]) {
                    const wall = document.createElement('div');
                    wall.className = 'wall vertical placing';
                    
                    const left = x * (cellSize + gap) - 4;
                    const top = y * (cellSize + gap) + cellSize / 2;
                    
                    wall.style.left = `${left}px`;
                    wall.style.top = `${top}px`;
                    
                    wallsLayer.appendChild(wall);
                    
                    // Remove placing animation class after animation completes
                    setTimeout(() => wall.classList.remove('placing'), 300);
                }
            }
        }
    }

    static updateTurnIndicator(gameState) {
        const turnIndicator = document.getElementById('turnIndicator');
        const currentPlayer = gameState.players[gameState.currentPlayer];
        
        if (gameState.gameStatus === 'playing') {
            if (currentPlayer.isAI) {
                turnIndicator.textContent = `${currentPlayer.name} is thinking...`;
            } else {
                turnIndicator.textContent = `${currentPlayer.name}'s Turn`;
            }
        } else if (gameState.gameStatus === 'paused') {
            turnIndicator.textContent = 'Game Paused';
        }
    }

    static updateActionButtons() {
        const moveBtn = document.getElementById('moveBtn');
        const wallBtn = document.getElementById('wallBtn');
        const undoBtn = document.getElementById('undoBtn');
        const hintBtn = document.getElementById('hintBtn');
        
        const isPlayerTurn = game.gameStatus === 'playing' && 
                           game.currentPlayer === 0 && 
                           !game.players[0].isAI;
        
        moveBtn.disabled = !isPlayerTurn;
        wallBtn.disabled = !isPlayerTurn || game.players[0].walls <= 0;
        undoBtn.disabled = !isPlayerTurn || game.undoStack.length === 0;
        hintBtn.disabled = !isPlayerTurn;
        
        // Update active states
        moveBtn.classList.toggle('active', game.currentAction === 'move');
        wallBtn.classList.toggle('active', game.currentAction === 'wall');
    }

    static updateMoveHistory(gameState) {
        const historyList = document.getElementById('historyList');
        historyList.innerHTML = '';
        
        gameState.moveHistory.forEach((move, index) => {
            const item = document.createElement('div');
            item.className = 'history-item';
            
            const moveNumber = document.createElement('span');
            moveNumber.className = 'move-number';
            moveNumber.textContent = `${index + 1}.`;
            
            const moveType = document.createElement('span');
            moveType.className = 'move-type';
            
            if (move.type === 'move') {
                moveType.textContent = `P${move.player + 1} → (${move.to.x},${move.to.y})`;
            } else {
                moveType.textContent = `P${move.player + 1} Wall ${move.wall.orientation[0].toUpperCase()}`;
            }
            
            item.appendChild(moveNumber);
            item.appendChild(moveType);
            historyList.appendChild(item);
        });
        
        // Scroll to bottom
        historyList.scrollTop = historyList.scrollHeight;
    }

    static highlightValidMoves() {
        this.clearHighlights();
        
        const validMoves = game.getValidMoves(0);
        validMoves.forEach(move => {
            const cell = document.querySelector(`[data-x="${move.x}"][data-y="${move.y}"]`);
            if (cell) {
                // Check if it's a jump move
                const player = game.players[0];
                const dx = Math.abs(move.x - player.position.x);
                const dy = Math.abs(move.y - player.position.y);
                const isJump = dx === 2 || dy === 2 || (dx === 1 && dy === 1);
                
                cell.classList.add(isJump ? 'valid-jump' : 'valid-move');
            }
        });
    }

    static clearHighlights() {
        document.querySelectorAll('.valid-move, .valid-jump').forEach(cell => {
            cell.classList.remove('valid-move', 'valid-jump');
        });
    }

    static showWallPreviews() {
        this.clearWallPreviews();
        
        const validWalls = game.getValidWallPlacements(0);
        const cellSize = parseInt(getComputedStyle(document.documentElement).getPropertyValue('--cell-size'));
        const gap = 4;
        const wallsLayer = document.getElementById('wallsLayer');
        
        // Limit previews for performance
        validWalls.slice(0, 30).forEach(wall => {
            const preview = document.createElement('div');
            preview.className = `wall preview ${wall.orientation}`;
            
            let left, top;
            
            if (wall.orientation === 'horizontal') {
                left = wall.x * (cellSize + gap) + cellSize / 2;
                top = wall.y * (cellSize + gap) - 4;
            } else {
                left = wall.x * (cellSize + gap) - 4;
                top = wall.y * (cellSize + gap) + cellSize / 2;
            }
            
            preview.style.left = `${left}px`;
            preview.style.top = `${top}px`;
            
            preview.addEventListener('click', () => {
                if (game.placeWall(0, wall)) {
                    this.clearWallPreviews();
                    game.currentAction = null;
                    this.updateActionButtons();
                }
            });
            
            wallsLayer.appendChild(preview);
        });
    }

    static clearWallPreviews() {
        document.querySelectorAll('.wall.preview').forEach(preview => preview.remove());
    }

    static rotateWall() {
        game.wallOrientation = game.wallOrientation === 'horizontal' ? 'vertical' : 'horizontal';
        if (game.currentAction === 'wall') {
            this.showWallPreviews();
        }
        this.showToast(`Wall orientation: ${game.wallOrientation}`, 'info', 1000);
    }

    static showGameOverModal(winner, gameState) {
        const modal = document.getElementById('gameOverModal');
        const title = document.getElementById('gameOverTitle');
        const message = document.getElementById('gameOverMessage');
        const stats = document.getElementById('gameStats');
        const animation = document.getElementById('winnerAnimation');
        
        const winnerName = gameState.players[winner].name;
        const isPlayerWin = winner === 0 && !gameState.players[0].isAI;
        
        title.textContent = isPlayerWin ? 'Victory!' : 'Game Over';
        message.textContent = `${winnerName} wins!`;
        
        // Set winner animation
        animation.textContent = isPlayerWin ? '🏆' : '🤖';
        
        // Update game stats
        const minutes = Math.floor(gameState.elapsedTime / 60000);
        const seconds = Math.floor((gameState.elapsedTime % 60000) / 1000);
        const timeString = `${minutes}:${seconds.toString().padStart(2, '0')}`;
        
        stats.innerHTML = `
            <div class="stat-item">
                <div class="stat-value">${gameState.moveHistory.length}</div>
                <div class="stat-label">Total Moves</div>
            </div>
            <div class="stat-item">
                <div class="stat-value">${timeString}</div>
                <div class="stat-label">Game Time</div>
            </div>
            <div class="stat-item">
                <div class="stat-value">${gameState.players[0].walls}</div>
                <div class="stat-label">Walls Left</div>
            </div>
        `;
        
        this.showModal('gameOverModal');
    }

    static showTutorial() {
        this.tutorialStep = 1;
        this.updateTutorialStep();
        this.showModal('tutorialModal');
    }

    static updateTutorialStep() {
        // Hide all steps
        document.querySelectorAll('.tutorial-step').forEach(step => {
            step.classList.remove('active');
        });
        
        // Show current step
        const currentStep = document.querySelector(`[data-step="${this.tutorialStep}"]`);
        if (currentStep) {
            currentStep.classList.add('active');
        }
        
        // Update navigation
        document.getElementById('prevStep').disabled = this.tutorialStep === 1;
        document.getElementById('nextStep').disabled = this.tutorialStep === this.maxTutorialSteps;
        
        // Update step indicators
        const indicators = document.getElementById('stepIndicators');
        indicators.innerHTML = '';
        
        for (let i = 1; i <= this.maxTutorialSteps; i++) {
            const indicator = document.createElement('div');
            indicator.className = 'step-indicator';
            if (i === this.tutorialStep) {
                indicator.classList.add('active');
            }
            indicator.addEventListener('click', () => {
                this.tutorialStep = i;
                this.updateTutorialStep();
            });
            indicators.appendChild(indicator);
        }
    }

    static nextTutorialStep() {
        if (this.tutorialStep < this.maxTutorialSteps) {
            this.tutorialStep++;
            this.updateTutorialStep();
        }
    }

    static previousTutorialStep() {
        if (this.tutorialStep > 1) {
            this.tutorialStep--;
            this.updateTutorialStep();
        }
    }

    static loadSettings() {
        document.getElementById('soundToggle').checked = game.settings.soundEnabled;
        document.getElementById('musicToggle').checked = game.settings.musicEnabled;
        document.getElementById('hintsToggle').checked = game.settings.hintsEnabled;
        document.getElementById('animationSpeed').value = game.settings.animationSpeed;
        document.getElementById('boardTheme').value = game.settings.boardTheme;
        
        this.updateAnimationSpeed();
        this.updateBoardTheme();
    }

    static updateAnimationSpeed() {
        const speed = game.settings.animationSpeed;
        const root = document.documentElement;
        
        switch (speed) {
            case 'slow':
                root.style.setProperty('--animation-fast', '0.3s');
                root.style.setProperty('--animation-normal', '0.6s');
                root.style.setProperty('--animation-slow', '1s');
                break;
            case 'fast':
                root.style.setProperty('--animation-fast', '0.1s');
                root.style.setProperty('--animation-normal', '0.2s');
                root.style.setProperty('--animation-slow', '0.3s');
                break;
            default: // normal
                root.style.setProperty('--animation-fast', '0.15s');
                root.style.setProperty('--animation-normal', '0.3s');
                root.style.setProperty('--animation-slow', '0.5s');
        }
    }

    static updateBoardTheme() {
        const theme = game.settings.boardTheme;
        document.body.className = `theme-${theme}`;
    }

    static updateStatistics() {
        const stats = game.statistics;
        
        document.getElementById('totalGames').textContent = stats.totalGames;
        document.getElementById('gamesWon').textContent = stats.gamesWon;
        
        const winRate = stats.totalGames > 0 ? Math.round((stats.gamesWon / stats.totalGames) * 100) : 0;
        document.getElementById('winRate').textContent = `${winRate}%`;
        
        const avgMoves = stats.totalGames > 0 ? Math.round(stats.totalMoves / stats.totalGames) : 0;
        document.getElementById('avgMoves').textContent = avgMoves;
        
        if (stats.bestTime) {
            const minutes = Math.floor(stats.bestTime / 60000);
            const seconds = Math.floor((stats.bestTime % 60000) / 1000);
            document.getElementById('bestTime').textContent = `${minutes}:${seconds.toString().padStart(2, '0')}`;
        } else {
            document.getElementById('bestTime').textContent = '--:--';
        }
        
        const totalHours = Math.floor(stats.totalPlayTime / 3600000);
        const totalMinutes = Math.floor((stats.totalPlayTime % 3600000) / 60000);
        document.getElementById('totalPlayTime').textContent = `${totalHours}h ${totalMinutes}m`;
    }
}

// Global UI Functions
function showMainMenu() {
    UI.showScreen('mainMenu');
}

function showGameModes() {
    UI.showScreen('gameModeMenu');
}

function showOnlineMenu() {
    UI.showScreen('onlineMenu');
}

function showTutorial() {
    UI.showTutorial();
}

function closeTutorial() {
    UI.hideModal('tutorialModal');
}

function nextTutorialStep() {
    UI.nextTutorialStep();
}

function previousTutorialStep() {
    UI.previousTutorialStep();
}

function showSettings() {
    UI.showModal('settingsModal');
}

function closeSettings() {
    UI.hideModal('settingsModal');
}

function showStats() {
    UI.updateStatistics();
    UI.showModal('statsModal');
}

function closeStats() {
    UI.hideModal('statsModal');
}

function resetStats() {
    if (confirm('Are you sure you want to reset all statistics? This cannot be undone.')) {
        game.resetStatistics();
        UI.updateStatistics();
        UI.showToast('Statistics reset!', 'success');
    }
}

function startGame(mode) {
    if (mode === 'offline-ai') {
        UI.showScreen('aiDifficultyMenu');
    } else {
        game.startGame(mode);
        UI.showScreen('gameScreen');
        UI.createBoard();
        UI.updateGameState(game);
    }
}

function startAIGame(difficulty) {
    game.startGame('offline-ai', difficulty);
    UI.showScreen('gameScreen');
    UI.createBoard();
    UI.updateGameState(game);
}

function setAction(action) {
    if (game.gameStatus !== 'playing' || game.currentPlayer !== 0) {
        return;
    }
    
    if (game.currentAction === action) {
        // Toggle off
        game.currentAction = null;
        UI.clearHighlights();
        UI.clearWallPreviews();
    } else {
        // Set new action
        game.currentAction = action;
        UI.clearHighlights();
        UI.clearWallPreviews();
        
        if (action === 'move' && game.settings.hintsEnabled) {
            UI.highlightValidMoves();
        } else if (action === 'wall') {
            UI.showWallPreviews();
        }
    }
    
    UI.updateActionButtons();
}

function undoMove() {
    game.undoMove();
}

function showHint() {
    if (game.gameStatus !== 'playing' || game.currentPlayer !== 0) {
        return;
    }
    
    const hint = AI.getBestMove(game, 0, 'medium');
    
    if (hint.type === 'move') {
        UI.showToast(`Hint: Move to (${hint.position.x}, ${hint.position.y})`, 'info', 4000);
        
        // Briefly highlight the suggested move
        const cell = document.querySelector(`[data-x="${hint.position.x}"][data-y="${hint.position.y}"]`);
        if (cell) {
            cell.style.boxShadow = '0 0 20px #06d6a0';
            setTimeout(() => {
                cell.style.boxShadow = '';
            }, 2000);
        }
    } else if (hint.type === 'wall') {
        UI.showToast(`Hint: Place ${hint.wall.orientation} wall at (${hint.wall.x}, ${hint.wall.y})`, 'info', 4000);
    }
}

function showPauseMenu() {
    game.pauseGame();
    UI.showModal('pauseMenu');
}

function resumeGame() {
    game.resumeGame();
    UI.hideModal('pauseMenu');
}

function restartGame() {
    UI.closeAllModals();
    game.startGame(game.gameMode, game.players[1].difficulty);
    UI.updateGameState(game);
}

function quitGame() {
    UI.closeAllModals();
    game.gameStatus = 'waiting';
    game.stopTimer();
    showMainMenu();
}

// Initialize UI when page loads
document.addEventListener('DOMContentLoaded', () => {
    UI.init();
});