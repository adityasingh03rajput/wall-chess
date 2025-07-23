// AI Player Implementation
class AI {
    static getBestMove(gameState, playerId, difficulty = 'medium') {
        const player = gameState.players[playerId];
        const opponent = gameState.players[1 - playerId];
        
        switch (difficulty) {
            case 'easy':
                return this.getEasyMove(gameState, playerId);
            case 'medium':
                return this.getMediumMove(gameState, playerId);
            case 'hard':
                return this.getHardMove(gameState, playerId);
            default:
                return this.getMediumMove(gameState, playerId);
        }
    }

    static getEasyMove(gameState, playerId) {
        // Easy AI: Random valid moves with slight preference for moving forward
        const validMoves = gameState.getValidMoves(playerId);
        const validWalls = gameState.getValidWallPlacements(playerId);
        
        // 70% chance to move, 30% chance to place wall (if available)
        const shouldPlaceWall = Math.random() < 0.3 && 
                               gameState.players[playerId].walls > 0 && 
                               validWalls.length > 0;
        
        if (shouldPlaceWall) {
            const randomWall = validWalls[Math.floor(Math.random() * validWalls.length)];
            return { type: 'wall', wall: randomWall };
        } else if (validMoves.length > 0) {
            // Prefer moves that get closer to goal
            const player = gameState.players[playerId];
            const goalY = playerId === 0 ? 8 : 0;
            
            const movesWithScore = validMoves.map(move => ({
                move,
                score: this.calculateMoveScore(player.position, move, goalY)
            }));
            
            // Add some randomness to easy AI
            movesWithScore.forEach(item => {
                item.score += Math.random() * 2 - 1; // Random factor between -1 and 1
            });
            
            movesWithScore.sort((a, b) => b.score - a.score);
            return { type: 'move', position: movesWithScore[0].move };
        }
        
        return null;
    }

    static getMediumMove(gameState, playerId) {
        // Medium AI: Strategic thinking with some tactical awareness
        const player = gameState.players[playerId];
        const opponent = gameState.players[1 - playerId];
        
        // Calculate distances to goal
        const playerDistance = this.calculateDistanceToGoal(gameState, player.position, playerId);
        const opponentDistance = this.calculateDistanceToGoal(gameState, opponent.position, 1 - playerId);
        
        // Decision making based on game state
        const shouldBlock = opponentDistance <= 3 && opponentDistance < playerDistance;
        const shouldRush = playerDistance <= 3 && playerDistance <= opponentDistance;
        
        if (shouldBlock && player.walls > 0) {
            const blockingWall = this.findBestBlockingWall(gameState, playerId);
            if (blockingWall) {
                return { type: 'wall', wall: blockingWall };
            }
        }
        
        if (shouldRush) {
            const bestMove = this.findBestMove(gameState, playerId);
            if (bestMove) {
                return { type: 'move', position: bestMove };
            }
        }
        
        // Default strategy: balance between moving and strategic wall placement
        const validMoves = gameState.getValidMoves(playerId);
        const validWalls = gameState.getValidWallPlacements(playerId);
        
        // Evaluate best move
        let bestMoveScore = -Infinity;
        let bestMove = null;
        
        for (let move of validMoves) {
            const score = this.evaluateMove(gameState, playerId, move);
            if (score > bestMoveScore) {
                bestMoveScore = score;
                bestMove = move;
            }
        }
        
        // Evaluate best wall placement
        let bestWallScore = -Infinity;
        let bestWall = null;
        
        if (player.walls > 0) {
            for (let wall of validWalls.slice(0, 20)) { // Limit evaluation for performance
                const score = this.evaluateWallPlacement(gameState, playerId, wall);
                if (score > bestWallScore) {
                    bestWallScore = score;
                    bestWall = wall;
                }
            }
        }
        
        // Choose between move and wall
        if (bestWall && bestWallScore > bestMoveScore + 1) {
            return { type: 'wall', wall: bestWall };
        } else if (bestMove) {
            return { type: 'move', position: bestMove };
        }
        
        return null;
    }

    static getHardMove(gameState, playerId) {
        // Hard AI: Advanced minimax with alpha-beta pruning
        const depth = 4;
        const result = this.minimax(gameState, depth, -Infinity, Infinity, true, playerId);
        return result.move;
    }

    static minimax(gameState, depth, alpha, beta, maximizingPlayer, originalPlayerId) {
        if (depth === 0 || gameState.gameStatus === 'finished') {
            return {
                score: this.evaluateGameState(gameState, originalPlayerId),
                move: null
            };
        }
        
        const currentPlayerId = gameState.currentPlayer;
        const validMoves = gameState.getValidMoves(currentPlayerId);
        const validWalls = gameState.getValidWallPlacements(currentPlayerId);
        
        let bestMove = null;
        
        if (maximizingPlayer) {
            let maxScore = -Infinity;
            
            // Evaluate moves
            for (let move of validMoves) {
                const newState = this.simulateMove(gameState, currentPlayerId, move);
                const result = this.minimax(newState, depth - 1, alpha, beta, false, originalPlayerId);
                
                if (result.score > maxScore) {
                    maxScore = result.score;
                    bestMove = { type: 'move', position: move };
                }
                
                alpha = Math.max(alpha, result.score);
                if (beta <= alpha) break; // Alpha-beta pruning
            }
            
            // Evaluate wall placements (limited for performance)
            if (gameState.players[currentPlayerId].walls > 0) {
                for (let wall of validWalls.slice(0, 10)) {
                    const newState = this.simulateWallPlacement(gameState, currentPlayerId, wall);
                    const result = this.minimax(newState, depth - 1, alpha, beta, false, originalPlayerId);
                    
                    if (result.score > maxScore) {
                        maxScore = result.score;
                        bestMove = { type: 'wall', wall: wall };
                    }
                    
                    alpha = Math.max(alpha, result.score);
                    if (beta <= alpha) break; // Alpha-beta pruning
                }
            }
            
            return { score: maxScore, move: bestMove };
        } else {
            let minScore = Infinity;
            
            // Evaluate moves
            for (let move of validMoves) {
                const newState = this.simulateMove(gameState, currentPlayerId, move);
                const result = this.minimax(newState, depth - 1, alpha, beta, true, originalPlayerId);
                
                if (result.score < minScore) {
                    minScore = result.score;
                    bestMove = { type: 'move', position: move };
                }
                
                beta = Math.min(beta, result.score);
                if (beta <= alpha) break; // Alpha-beta pruning
            }
            
            // Evaluate wall placements (limited for performance)
            if (gameState.players[currentPlayerId].walls > 0) {
                for (let wall of validWalls.slice(0, 10)) {
                    const newState = this.simulateWallPlacement(gameState, currentPlayerId, wall);
                    const result = this.minimax(newState, depth - 1, alpha, beta, true, originalPlayerId);
                    
                    if (result.score < minScore) {
                        minScore = result.score;
                        bestMove = { type: 'wall', wall: wall };
                    }
                    
                    beta = Math.min(beta, result.score);
                    if (beta <= alpha) break; // Alpha-beta pruning
                }
            }
            
            return { score: minScore, move: bestMove };
        }
    }

    static simulateMove(gameState, playerId, move) {
        const newState = JSON.parse(JSON.stringify(gameState));
        newState.players[playerId].position = move;
        newState.currentPlayer = (newState.currentPlayer + 1) % 2;
        return newState;
    }

    static simulateWallPlacement(gameState, playerId, wall) {
        const newState = JSON.parse(JSON.stringify(gameState));
        
        // Place wall on simulated board
        const { x, y, orientation } = wall;
        if (orientation === 'horizontal') {
            newState.board.horizontalWalls[x][y] = true;
            newState.board.horizontalWalls[x + 1][y] = true;
        } else {
            newState.board.verticalWalls[x][y] = true;
            newState.board.verticalWalls[x][y + 1] = true;
        }
        
        newState.players[playerId].walls--;
        newState.currentPlayer = (newState.currentPlayer + 1) % 2;
        return newState;
    }

    static evaluateGameState(gameState, playerId) {
        const player = gameState.players[playerId];
        const opponent = gameState.players[1 - playerId];
        
        // Check for win/loss conditions
        if (gameState.checkWinCondition(playerId)) return 1000;
        if (gameState.checkWinCondition(1 - playerId)) return -1000;
        
        // Calculate distances to goal
        const playerDistance = this.calculateDistanceToGoal(gameState, player.position, playerId);
        const opponentDistance = this.calculateDistanceToGoal(gameState, opponent.position, 1 - playerId);
        
        // Base score: closer to goal is better
        let score = (opponentDistance - playerDistance) * 10;
        
        // Wall advantage
        score += (player.walls - opponent.walls) * 2;
        
        // Positional advantages
        score += this.evaluatePosition(gameState, player.position, playerId);
        score -= this.evaluatePosition(gameState, opponent.position, 1 - playerId);
        
        return score;
    }

    static calculateDistanceToGoal(gameState, position, playerId) {
        // Use BFS to find shortest path to goal
        const visited = Array(9).fill().map(() => Array(9).fill(false));
        const queue = [{ pos: position, distance: 0 }];
        visited[position.x][position.y] = true;
        
        const goalY = playerId === 0 ? 8 : 0;
        
        while (queue.length > 0) {
            const { pos, distance } = queue.shift();
            
            if (pos.y === goalY) return distance;
            
            const directions = [
                { x: 0, y: 1 }, { x: 0, y: -1 },
                { x: 1, y: 0 }, { x: -1, y: 0 }
            ];
            
            for (let dir of directions) {
                const newPos = { x: pos.x + dir.x, y: pos.y + dir.y };
                
                if (newPos.x < 0 || newPos.x > 8 || newPos.y < 0 || newPos.y > 8) continue;
                if (visited[newPos.x][newPos.y]) continue;
                if (gameState.isWallBetweenOnBoard(gameState.board, pos, newPos)) continue;
                
                visited[newPos.x][newPos.y] = true;
                queue.push({ pos: newPos, distance: distance + 1 });
            }
        }
        
        return Infinity; // No path found
    }

    static evaluatePosition(gameState, position, playerId) {
        let score = 0;
        
        // Center preference (slightly)
        const centerDistance = Math.abs(position.x - 4);
        score -= centerDistance * 0.5;
        
        // Forward progress
        const goalY = playerId === 0 ? 8 : 0;
        const progress = playerId === 0 ? position.y : (8 - position.y);
        score += progress * 2;
        
        return score;
    }

    static calculateMoveScore(currentPos, move, goalY) {
        // Simple scoring based on distance to goal
        const currentDistance = Math.abs(currentPos.y - goalY);
        const newDistance = Math.abs(move.y - goalY);
        return currentDistance - newDistance;
    }

    static findBestMove(gameState, playerId) {
        const validMoves = gameState.getValidMoves(playerId);
        let bestMove = null;
        let bestScore = -Infinity;
        
        for (let move of validMoves) {
            const score = this.evaluateMove(gameState, playerId, move);
            if (score > bestScore) {
                bestScore = score;
                bestMove = move;
            }
        }
        
        return bestMove;
    }

    static evaluateMove(gameState, playerId, move) {
        const player = gameState.players[playerId];
        const goalY = playerId === 0 ? 8 : 0;
        
        // Distance improvement
        const currentDistance = Math.abs(player.position.y - goalY);
        const newDistance = Math.abs(move.y - goalY);
        let score = (currentDistance - newDistance) * 10;
        
        // Center preference
        const centerDistance = Math.abs(move.x - 4);
        score -= centerDistance * 0.5;
        
        // Avoid edges slightly
        if (move.x === 0 || move.x === 8) score -= 1;
        
        return score;
    }

    static findBestBlockingWall(gameState, playerId) {
        const opponent = gameState.players[1 - playerId];
        const validWalls = gameState.getValidWallPlacements(playerId);
        
        let bestWall = null;
        let maxDistanceIncrease = 0;
        
        for (let wall of validWalls.slice(0, 15)) { // Limit for performance
            // Simulate wall placement
            const tempState = JSON.parse(JSON.stringify(gameState));
            const { x, y, orientation } = wall;
            
            if (orientation === 'horizontal') {
                tempState.board.horizontalWalls[x][y] = true;
                tempState.board.horizontalWalls[x + 1][y] = true;
            } else {
                tempState.board.verticalWalls[x][y] = true;
                tempState.board.verticalWalls[x][y + 1] = true;
            }
            
            const newDistance = this.calculateDistanceToGoal(tempState, opponent.position, 1 - playerId);
            const currentDistance = this.calculateDistanceToGoal(gameState, opponent.position, 1 - playerId);
            const distanceIncrease = newDistance - currentDistance;
            
            if (distanceIncrease > maxDistanceIncrease) {
                maxDistanceIncrease = distanceIncrease;
                bestWall = wall;
            }
        }
        
        return bestWall;
    }

    static evaluateWallPlacement(gameState, playerId, wall) {
        const opponent = gameState.players[1 - playerId];
        
        // Simulate wall placement
        const tempState = JSON.parse(JSON.stringify(gameState));
        const { x, y, orientation } = wall;
        
        if (orientation === 'horizontal') {
            tempState.board.horizontalWalls[x][y] = true;
            tempState.board.horizontalWalls[x + 1][y] = true;
        } else {
            tempState.board.verticalWalls[x][y] = true;
            tempState.board.verticalWalls[x][y + 1] = true;
        }
        
        // Calculate impact on opponent's path
        const currentOpponentDistance = this.calculateDistanceToGoal(gameState, opponent.position, 1 - playerId);
        const newOpponentDistance = this.calculateDistanceToGoal(tempState, opponent.position, 1 - playerId);
        
        // Calculate impact on own path
        const player = gameState.players[playerId];
        const currentPlayerDistance = this.calculateDistanceToGoal(gameState, player.position, playerId);
        const newPlayerDistance = this.calculateDistanceToGoal(tempState, player.position, playerId);
        
        // Score based on how much it helps us vs hurts us
        let score = (newOpponentDistance - currentOpponentDistance) * 5;
        score -= (newPlayerDistance - currentPlayerDistance) * 3;
        
        // Prefer walls closer to opponent
        const wallCenterX = orientation === 'horizontal' ? x + 0.5 : x;
        const wallCenterY = orientation === 'vertical' ? y + 0.5 : y;
        const distanceToOpponent = Math.abs(wallCenterX - opponent.position.x) + 
                                  Math.abs(wallCenterY - opponent.position.y);
        score -= distanceToOpponent * 0.5;
        
        return score;
    }
}