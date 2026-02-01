// Simple WebSocket server for Jagad multiplayer game
// Server-authoritative: server maintains game state and runs game loop

const http = require("http");
const path = require("path");
const fs = require("fs");
const { WebSocketServer } = require("ws");
const { MAP, COLS, ROWS, TUNNEL_ROW } = require("./assets/lib/map");

const PORT = process.env.PORT || 3000;

// ========== GAME CONSTANTS ==========
const CELL_SIZE = 20;
const CHARACTER_SIZE = 16;
const CHARACTER_OFFSET = (CELL_SIZE - CHARACTER_SIZE) / 2;
// Base movement speed (tuned to feel closer to the original client-side movement)
// Higher = faster movement across the grid (increased for snappier feel)
const BASE_MOVE_SPEED = 0.35; // Increased from 0.3 for faster movement
const COLORS = ["red", "green", "blue", "yellow"];
const DIRECTIONS = [
  { dir: "up", x: 0, y: -1 },
  { dir: "down", x: 0, y: 1 },
  { dir: "left", x: -1, y: 0 },
  { dir: "right", x: 1, y: 0 },
];
// Fast direction lookup map for input processing
const DIRECTION_MAP = {
  up: { x: 0, y: -1 },
  down: { x: 0, y: 1 },
  left: { x: -1, y: 0 },
  right: { x: 1, y: 0 },
};
const OPPOSITE_DIR = { up: "down", down: "up", left: "right", right: "left" };

// Pre-calculate positions
const teleportPositions = [];
const chaserSpawnPositions = [];
const fugitiveSpawnPositions = [];

// Collect spawn positions in order: red, green, blue, yellow
// For fugitives: value 4 in order (top-left, top-right, bottom-left, bottom-right)
// For chasers: value 3 in order (same pattern)
for (let y = 0; y < ROWS; y++) {
  for (let x = 0; x < COLS; x++) {
    if (MAP[y][x] === 2) teleportPositions.push({ x, y });
    if (MAP[y][x] === 3) chaserSpawnPositions.push({ x, y });
    if (MAP[y][x] === 4) fugitiveSpawnPositions.push({ x, y });
  }
}

// Sort spawn positions to ensure consistent order: red, green, blue, yellow
// Order: top-left, top-right, bottom-left, bottom-right
// For chasers: they spawn in the middle rows, so we sort by row then column
chaserSpawnPositions.sort((a, b) => {
  if (a.y !== b.y) return a.y - b.y; // Sort by row first (top to bottom)
  return a.x - b.x; // Then by column (left to right)
});

// For fugitives: they spawn in corners, so we sort by row then column
fugitiveSpawnPositions.sort((a, b) => {
  if (a.y !== b.y) return a.y - b.y; // Sort by row first (top to bottom)
  return a.x - b.x; // Then by column (left to right)
});

// Ensure we only use the first 4 spawn positions for each type
// This ensures consistent color assignment: index 0 = red, 1 = green, 2 = blue, 3 = yellow
if (chaserSpawnPositions.length > 4) {
  chaserSpawnPositions.length = 4;
}
if (fugitiveSpawnPositions.length > 4) {
  fugitiveSpawnPositions.length = 4;
}

// ========== GAME STATE ==========
const gameState = {
  players: new Map(), // playerId -> { type, colorIndex, connected, ws, pendingInput }
  nextPlayerId: 0,
  availableColors: {
    fugitive: [], // Players cannot join as fugitives (AI-controlled only)
    chaser: [0, 1, 2, 3], // All 4 chaser slots are joinable
  },
  gameStarted: false, // Game starts when first player joins
  gameStartTime: null, // When the current game started (90 seconds timer)
  gameDuration: 90, // Game lasts 90 seconds
  aiDifficulty: 0.8,
  // Global speed multipliers for all fugitives and all chasers
  fugitiveSpeed: 0.4,
  chaserSpeed: 0.41, // Slightly faster than fugitives
  fugitives: [],
  chasers: [],
  lastUpdate: Date.now(),
  caughtFugitives: new Set(), // Track which fugitives have been caught
  firstPlayerId: null, // Player ID who started the game
  firstPlayerName: null, // Name of player who started the game
  isTeamGame: false, // Whether multiple chasers are playing
  chaserSelections: new Map(), // colorIndex -> { playerId, playerName } - tracks selections before joining
  gameCode: null, // 2-digit code (00-99) for joining games
};

// Debug counters
let debugTickCounter = 0;

function isFugitivePlayerControlled(index) {
  return Array.from(gameState.players.values()).some((p) => p.type === "fugitive" && p.colorIndex === index && p.connected);
}

// Initialize lastUpdate
gameState.lastUpdate = Date.now();

// Items system removed - not used in this game mode

// Initialize characters
function initCharacters() {
  gameState.fugitives = fugitiveSpawnPositions.map((pos, i) => ({
    x: pos.x,
    y: pos.y,
    px: pos.x * CELL_SIZE + CHARACTER_OFFSET,
    py: pos.y * CELL_SIZE + CHARACTER_OFFSET,
    targetX: pos.x,
    targetY: pos.y,
    color: COLORS[i],
    // Default fugitive speed (kept in sync with global fugitiveSpeed)
    speed: 1.0,
    spawnPos: { ...pos },
    // Direction-based movement: current direction the fugitive is actually moving
    dirX: 0,
    dirY: 0,
    // Queued direction from the last input (may be applied at the next junction)
    nextDirX: 0,
    nextDirY: 0,
    lastDirX: 0,
    lastDirY: 0,
    positionHistory: [],
  }));

  // Initialize all chaser slots (all chasers are visible from start at spawn positions)
  chaserSpawnPositions.forEach((pos, index) => {
    if (index < 4) {
      gameState.chasers[index] = {
        x: pos.x,
        y: pos.y,
        px: pos.x * CELL_SIZE + CHARACTER_OFFSET,
        py: pos.y * CELL_SIZE + CHARACTER_OFFSET,
        targetX: pos.x,
        targetY: pos.y,
        color: "white",
        speed: 1.0,
        spawnPos: { ...pos },
        moveTimer: 0,
        lastDirX: 0,
        lastDirY: 0,
        positionHistory: [],
        dirX: 0,
        dirY: 0,
        nextDirX: 0,
        nextDirY: 0,
      };
    }
  });
}

// ========== GAME LOGIC FUNCTIONS ==========
function isPath(x, y) {
  if (x < 0 || x >= COLS || y < 0 || y >= ROWS) return false;
  const cell = MAP[y][x];
  // Treat 0 (path), 2 (teleport), 3 (chaser spawn), and 4 (fugitive spawn) as walkable paths
  return cell === 0 || cell === 2 || cell === 3 || cell === 4;
}

function getTargetPixelPos(gridX, gridY) {
  return {
    x: gridX * CELL_SIZE + CHARACTER_OFFSET,
    y: gridY * CELL_SIZE + CHARACTER_OFFSET,
  };
}

function isAtTarget(character) {
  const target = getTargetPixelPos(character.targetX, character.targetY);
  return Math.abs(character.px - target.x) < 0.5 && Math.abs(character.py - target.y) < 0.5;
}

function moveCharacter(character, speedMultiplier = 1.0) {
  if (!character) return;

  // Validate target is grid-aligned (only one tile away in one direction)
  const deltaX = character.targetX - character.x;
  const deltaY = character.targetY - character.y;

  // If both are non-zero, we have a diagonal target (BUG!)
  if (deltaX !== 0 && deltaY !== 0) {
    console.error(
      `DIAGONAL TARGET DETECTED! Current: (${character.x}, ${character.y}), Target: (${character.targetX}, ${character.targetY})`
    );
    // Fix by only moving in one direction (prioritize current direction)
    if (character.dirX !== 0) {
      character.targetY = character.y; // Keep same row
    } else {
      character.targetX = character.x; // Keep same column
    }
  }

  const target = getTargetPixelPos(character.targetX, character.targetY);
  const dx = target.x - character.px;
  const dy = target.y - character.py;
  const distance = Math.sqrt(dx * dx + dy * dy);

  // Move until we exactly reach the tile center
  if (distance > 0) {
    const moveDistance = BASE_MOVE_SPEED * CELL_SIZE * speedMultiplier;
    if (distance > moveDistance) {
      character.px += (dx / distance) * moveDistance;
      character.py += (dy / distance) * moveDistance;
    } else {
      character.px = target.x;
      character.py = target.y;
      character.x = character.targetX;
      character.y = character.targetY;
      if (MAP[character.y][character.x] === 2) {
        teleportCharacter(character);
      }
    }
  }
}

function teleportCharacter(character) {
  const otherTeleport = teleportPositions.find((pos) => pos.x !== character.x || pos.y !== character.y);
  if (otherTeleport) {
    character.x = otherTeleport.x;
    character.y = otherTeleport.y;
    character.targetX = otherTeleport.x;
    character.targetY = otherTeleport.y;
    const pos = getTargetPixelPos(otherTeleport.x, otherTeleport.y);
    character.px = pos.x;
    character.py = pos.y;
  }
}

function getPossibleMoves(chaser) {
  const possibleMoves = [];
  const currentX = chaser.x;
  const currentY = chaser.y;

  DIRECTIONS.forEach(({ dir, x: dx, y: dy }) => {
    const newX = currentX + dx;
    const newY = currentY + dy;
    // No manual wrap-around here; we rely on teleport tiles (MAP === 2) and teleportCharacter()
    if (newX >= 0 && newX < COLS && newY >= 0 && newY < ROWS && isPath(newX, newY)) {
      possibleMoves.push({ dir, x: dx, y: dy, newX, newY });
    }
  });

  let currentDir = null;
  if (chaser.x === chaser.targetX && chaser.y === chaser.targetY) {
    if (chaser.lastDirX === 0 && chaser.lastDirY === -1) currentDir = "up";
    else if (chaser.lastDirX === 0 && chaser.lastDirY === 1) currentDir = "down";
    else if (chaser.lastDirX === -1 && chaser.lastDirY === 0) currentDir = "left";
    else if (chaser.lastDirX === 1 && chaser.lastDirY === 0) currentDir = "right";
  } else {
    const dx = chaser.targetX - chaser.x;
    const dy = chaser.targetY - chaser.y;
    if (Math.abs(dx) > Math.abs(dy)) {
      currentDir = dx > 0 ? "right" : "left";
    } else if (dy !== 0) {
      currentDir = dy > 0 ? "down" : "up";
    }
  }

  let filteredMoves = possibleMoves.filter((move) => !currentDir || move.dir !== OPPOSITE_DIR[currentDir]);
  if (filteredMoves.length === 0) filteredMoves = possibleMoves;

  if (chaser.positionHistory?.length > 0) {
    const recentPositions = chaser.positionHistory.slice(-4);
    filteredMoves = filteredMoves.filter((move) => !recentPositions.some((pos) => pos.x === move.newX && pos.y === move.newY));
    if (filteredMoves.length === 0) filteredMoves = possibleMoves;
  }

  return filteredMoves;
}

function calculateDistanceWithWrap(pos1, pos2) {
  let dx = Math.abs(pos1.x - pos2.x);
  let dy = Math.abs(pos1.y - pos2.y);
  if (pos1.y === TUNNEL_ROW && pos2.y === TUNNEL_ROW) {
    dx = Math.min(dx, COLS - dx);
  }
  return Math.sqrt(dx * dx + dy * dy);
}

// Chaser AI removed - all chasers are player-controlled

// Simple AI for fugitives: choose a direction that tends to increase distance from the closest chaser
function moveFugitiveAI(fugitive, index) {
  const possibleMoves = getPossibleMoves(fugitive);
  if (possibleMoves.length === 0) return;

  // Find the closest chaser (any chaser can catch any fugitive)
  let closestChaser = null;
  let closestDistance = Infinity;
  gameState.chasers.forEach((chaser) => {
    if (!chaser) return;
    const distance = calculateDistanceWithWrap({ x: fugitive.x, y: fugitive.y }, { x: chaser.x, y: chaser.y });
    if (distance < closestDistance) {
      closestDistance = distance;
      closestChaser = chaser;
    }
  });

  // If there's no chaser, just pick a random move
  if (!closestChaser) {
    const move = possibleMoves[Math.floor(Math.random() * possibleMoves.length)];
    if (move) {
      fugitive.targetX = move.newX;
      fugitive.targetY = move.newY;
      fugitive.dirX = move.x;
      fugitive.dirY = move.y;
      fugitive.lastDirX = move.x;
      fugitive.lastDirY = move.y;
    }
    return;
  }

  // 30% chance to pick a random valid move for more unpredictable behavior
  if (Math.random() < 0.3 && possibleMoves.length > 0) {
    const randomMove = possibleMoves[Math.floor(Math.random() * possibleMoves.length)];
    if (randomMove) {
      fugitive.targetX = randomMove.newX;
      fugitive.targetY = randomMove.newY;
      fugitive.dirX = randomMove.x;
      fugitive.dirY = randomMove.y;
      fugitive.lastDirX = randomMove.x;
      fugitive.lastDirY = randomMove.y;
    }
    return;
  }

  // Otherwise, choose based on distance but add randomness to scoring
  let bestMove = possibleMoves[0];
  let bestScore = -Infinity;
  const chaserPos = { x: closestChaser.x, y: closestChaser.y };

  possibleMoves.forEach((move) => {
    const movePos = { x: move.newX, y: move.newY };
    const distance = calculateDistanceWithWrap(movePos, chaserPos);
    
    // Add randomness to score (±20% variation) to make behavior less predictable
    const randomFactor = 0.8 + Math.random() * 0.4; // 0.8 to 1.2
    const score = distance * randomFactor;
    
    if (score > bestScore) {
      bestScore = score;
      bestMove = move;
    }
  });

  if (bestMove) {
    fugitive.targetX = bestMove.newX;
    fugitive.targetY = bestMove.newY;
    fugitive.dirX = bestMove.x;
    fugitive.dirY = bestMove.y;
    fugitive.lastDirX = bestMove.x;
    fugitive.lastDirY = bestMove.y;
  }
}

// Chaser AI removed - all chasers are player-controlled

function checkCollisions() {
  if (!gameState.gameStarted || !gameState.gameStartTime) return; // Only check collisions when game is running

  gameState.fugitives.forEach((fugitive, fugitiveIndex) => {
    if (!fugitive || gameState.caughtFugitives.has(fugitiveIndex)) return; // Skip already caught fugitives
    gameState.chasers.forEach((chaser, chaserIndex) => {
      if (!chaser) return;
      // Any chaser can catch any fugitive (no color matching)
      if (fugitive.x === chaser.x && fugitive.y === chaser.y) {
        // Mark fugitive as caught
        gameState.caughtFugitives.add(fugitiveIndex);

        // Calculate time to catch (from game start)
        const catchTime = Date.now() - gameState.gameStartTime;
        const catchTimeSeconds = catchTime / 1000;

        // Calculate score for this catch: faster catches = higher score
        // Formula: 1000 points base, minus time penalty (10 points per second)
        // This rewards faster individual catches
        const catchScore = Math.max(0, 1000 - Math.floor(catchTimeSeconds * 10));

        // Update all chaser players' scores (team score - all chasers share the same score)
        // Track individual catch times for final scoring
        let teamScore = 0;
        gameState.players.forEach((player, playerId) => {
          if (player.connected && player.type === "chaser") {
            // Track total catch time for final scoring
            player.stats.totalCaptureTime = (player.stats.totalCaptureTime || 0) + catchTime;
            player.stats.catches = (player.stats.catches || 0) + 1;
            // Track individual catch scores
            player.stats.catchScores = player.stats.catchScores || [];
            player.stats.catchScores.push(catchScore);
            // Calculate cumulative team score (sum of all catch scores)
            teamScore = player.stats.catchScores.reduce((sum, score) => sum + score, 0);
          }
        });

        // Set the same team score for all chasers
        gameState.players.forEach((player, playerId) => {
          if (player.connected && player.type === "chaser") {
            player.stats.chaserScore = teamScore;
          }
        });

        // Send catch event to all players
        broadcast({
          type: "fugitiveCaught",
          fugitiveIndex: fugitiveIndex,
          catchTime: catchTime,
        });

        // Check if all fugitives are caught
        if (gameState.caughtFugitives.size >= gameState.fugitives.length) {
          endGame(true); // All fugitives caught
        }
      }
    });
  });
}

function endGame(allCaught) {
  console.log("[endGame] Called with allCaught:", allCaught, "gameStarted:", gameState.gameStarted);
  if (!gameState.gameStarted) {
    console.log("[endGame] Game not started, returning early");
    return;
  }

  gameState.gameStarted = false;
  const gameTime = Date.now() - gameState.gameStartTime;
  console.log("[endGame] Game time:", gameTime, "ms");

  // Calculate final team score (all chasers share the same score)
  // Use the cumulative score from individual catches, with bonus for completing all
  let teamScore = 0;
  gameState.players.forEach((player, playerId) => {
    if (player.connected && player.type === "chaser") {
      // Sum up all individual catch scores
      if (player.stats.catchScores && player.stats.catchScores.length > 0) {
        teamScore = player.stats.catchScores.reduce((sum, score) => sum + score, 0);
      }
    }
  });

  // Add completion bonus if all fugitives were caught
  if (allCaught) {
    // Bonus based on total time: faster completion = higher bonus
    const totalTimeSeconds = gameTime / 1000;
    const timeBonus = Math.max(0, 2000 - Math.floor(totalTimeSeconds * 5));
    teamScore += timeBonus;
  } else {
    // Partial completion: reduce score based on how many were caught
    const caughtCount = gameState.caughtFugitives.size;
    const totalCount = gameState.fugitives.length;
    const caughtPercentage = caughtCount / totalCount;
    teamScore = Math.floor(teamScore * caughtPercentage);
  }

  // Set the same team score for all chasers
  gameState.players.forEach((player, playerId) => {
    if (player.connected && player.type === "chaser") {
      player.stats.chaserScore = teamScore;
    }
  });

  // Broadcast game end message to all connected clients (including controllers)
  const gameEndMessage = {
    type: "gameEnd",
    allCaught: allCaught,
    gameTime: gameTime,
    score: teamScore,
    fugitivesCaught: gameState.caughtFugitives.size,
    totalFugitives: gameState.fugitives.length,
  };
  console.log("[endGame] Broadcasting gameEnd message:", gameEndMessage);
  broadcast(gameEndMessage);

  // Save highscore if this is a new record
  // Collect all chaser player names for team games
  let playerNames = gameState.firstPlayerName || "Unknown";
  if (gameState.isTeamGame) {
    const chaserNames = [];
    const firstPlayerName = gameState.firstPlayerName;
    
    gameState.players.forEach((player, playerId) => {
      if (player.connected && player.type === "chaser" && player.playerName) {
        chaserNames.push(player.playerName);
      }
    });
    
    // If we have multiple chasers, prioritize first player's name, then others with commas
    if (chaserNames.length > 1) {
      // Separate first player from others
      const firstPlayerIndex = chaserNames.findIndex(name => name === firstPlayerName);
      let orderedNames = [];
      
      if (firstPlayerIndex !== -1) {
        // First player's name first
        orderedNames.push(chaserNames[firstPlayerIndex]);
        // Then add other players' names
        chaserNames.forEach((name, index) => {
          if (index !== firstPlayerIndex) {
            orderedNames.push(name);
          }
        });
      } else {
        // If first player name not found, use original order
        orderedNames = chaserNames;
      }
      
      playerNames = orderedNames.join(", ");
    } else if (chaserNames.length === 1) {
      playerNames = chaserNames[0];
    }
  }
  saveHighscore(teamScore, playerNames, gameState.isTeamGame);

  // Regenerate game code for the next game session
  gameState.gameCode = generateGameCode();
  console.log(`[endGame] Generated new game code for next session: ${gameState.gameCode}`);

  // Reset game state after a short delay to show final scores
  setTimeout(() => {
    resetGame();
  }, 3000); // 3 second delay before reset
}

// Generate a random 2-digit code (00-99)
function generateGameCode() {
  return Math.floor(Math.random() * 100).toString().padStart(2, '0');
}

function resetGame() {
  gameState.gameStarted = false;
  gameState.gameStartTime = null;
  gameState.caughtFugitives.clear();
  gameState.firstPlayerId = null;
  gameState.firstPlayerName = null;
  gameState.isTeamGame = false;
  // Keep the same game code (already regenerated in endGame)
  
  // Clear all chaser selections when game resets
  if (gameState.chaserSelections) {
    gameState.chaserSelections.clear();
  }
  
  // Reset speed settings to defaults
  gameState.fugitiveSpeed = 0.4;
  gameState.chaserSpeed = 0.41;

  // Clear all player selections - players lose their chaser selection when game resets
  // Free up all chaser slots
  gameState.availableColors.chaser = [0, 1, 2, 3];

  // Remove all chasers (they only exist when players join)
  gameState.chasers[0] = null;
  gameState.chasers[1] = null;
  gameState.chasers[2] = null;
  gameState.chasers[3] = null;

  // Disconnect all players from their chasers
  gameState.players.forEach((player, playerId) => {
    if (player.type === "chaser") {
      // Free up the chaser slot
      if (!gameState.availableColors.chaser.includes(player.colorIndex)) {
        gameState.availableColors.chaser.push(player.colorIndex);
        gameState.availableColors.chaser.sort();
      }
      // Remove player from controlling the chaser
      gameState.players.delete(playerId);
    }
  });

  // Reset all characters to spawn positions
  initCharacters();

  // Reset all chaser movement states
  gameState.chasers.forEach((chaser, index) => {
    if (chaser) {
      chaser.dirX = 0;
      chaser.dirY = 0;
      chaser.nextDirX = 0;
      chaser.nextDirY = 0;
      chaser.lastDirX = 0;
      chaser.lastDirY = 0;
      chaser.positionHistory = [];
    }
  });

  // Reset all fugitive movement states
  gameState.fugitives.forEach((fugitive) => {
    if (fugitive) {
      fugitive.dirX = 0;
      fugitive.dirY = 0;
      fugitive.nextDirX = 0;
      fugitive.nextDirY = 0;
      fugitive.lastDirX = 0;
      fugitive.lastDirY = 0;
      fugitive.positionHistory = [];
    }
  });

  broadcast({ type: "gameReset" });
  broadcastGameState();
}

function respawnCharacter(character, spawnPos) {
  character.x = spawnPos.x;
  character.y = spawnPos.y;
  const pos = getTargetPixelPos(spawnPos.x, spawnPos.y);
  character.px = pos.x;
  character.py = pos.y;
  character.targetX = spawnPos.x;
  character.targetY = spawnPos.y;
  // Stop continuous movement after respawn; new direction will be set by input/AI
  if ("dirX" in character) {
    character.dirX = 0;
    character.dirY = 0;
    character.nextDirX = 0;
    character.nextDirY = 0;
  }
  if ("lastDirX" in character) {
    character.lastDirX = 0;
    character.lastDirY = 0;
  }
}

function respawnChaser(chaser, spawnPos) {
  respawnCharacter(chaser, spawnPos);
  chaser.positionHistory = [];
  chaser.lastDirX = 0;
  chaser.lastDirY = 0;
}

// ========== GAME LOOP ==========
function gameLoop() {
  const now = Date.now();
  const deltaTime = now - gameState.lastUpdate;
  const deltaSeconds = deltaTime / 1000;
  gameState.lastUpdate = now;

  // Check if 90 seconds have passed
  if (gameState.gameStarted && gameState.gameStartTime) {
    const elapsed = (now - gameState.gameStartTime) / 1000;
    if (elapsed >= gameState.gameDuration) {
      endGame(false); // Time ran out
      return;
    }
  }

  // Log a lightweight heartbeat about once per second
  debugTickCounter++;
  if (debugTickCounter % 60 === 0) {
  }

  // Process player input (fugitives and chasers always)
  gameState.players.forEach((player, playerId) => {
    if (!player.connected || !player.pendingInput) return;
    const input = player.pendingInput;
    player.pendingInput = null;

    if (player.type === "fugitive") {
      const fugitive = gameState.fugitives[player.colorIndex];
      if (!fugitive) return;

      // Direction-based input: input.dir is 'left' | 'right' | 'up' | 'down'
      if (input.dir) {
        const dirDef = DIRECTION_MAP[input.dir];
        if (!dirDef) return;
        const dx = dirDef.x;
        const dy = dirDef.y;

        // Store desired direction; it will be applied when possible (at next tile center)
        fugitive.nextDirX = dx;
        fugitive.nextDirY = dy;

        // If currently stopped, try to start immediately in this direction
        if (fugitive.dirX === 0 && fugitive.dirY === 0) {
          const startX = fugitive.x + dx;
          const startY = fugitive.y + dy;
          if (startX >= 0 && startX < COLS && startY >= 0 && startY < ROWS && isPath(startX, startY)) {
            fugitive.dirX = dx;
            fugitive.dirY = dy;
            fugitive.targetX = startX;
            fugitive.targetY = startY;
          }
        }
      }
    } else if (player.type === "chaser") {
      const chaser = gameState.chasers[player.colorIndex];
      if (!chaser) return;

      // Direction-based input for chasers, same continuous style as fugitives
      if (input.dir) {
        const dirDef = DIRECTION_MAP[input.dir];
        if (!dirDef) return;
        const dx = dirDef.x;
        const dy = dirDef.y;

        // Store desired direction; applied at next tile center
        // Important: Only store one direction at a time (no diagonal movement)
        chaser.nextDirX = dx;
        chaser.nextDirY = dy;

        // If currently stopped, try to start immediately
        if (chaser.dirX === 0 && chaser.dirY === 0) {
          const startX = chaser.x + dx;
          const startY = chaser.y + dy;
          if (startX >= 0 && startX < COLS && startY >= 0 && startY < ROWS && isPath(startX, startY)) {
            chaser.dirX = dx;
            chaser.dirY = dy;
            chaser.targetX = startX;
            chaser.targetY = startY;
          }
        }
      }
    }
  });

  // Move fugitives only when game is started
  if (gameState.gameStarted) {
    gameState.fugitives.forEach((fugitive, index) => {
      if (!fugitive || gameState.caughtFugitives.has(index)) return; // Skip caught fugitives

      // Fugitives are always AI-controlled, never player-controlled
      // Move fugitive toward its current target using global fugitive speed
      moveCharacter(fugitive, gameState.fugitiveSpeed);

      if (isAtTarget(fugitive)) {
        // Fugitives are always AI-controlled
        moveFugitiveAI(fugitive, index);
      }
    });
  }

  // Chaser movement, survival, and collisions
  // All chasers are player-controlled only - no AI movement
  // Only move chasers when game is started
  if (gameState.gameStarted) {
    gameState.chasers.forEach((chaser, index) => {
      if (!chaser) return;
      const isPlayerControlled = Array.from(gameState.players.values()).some(
        (p) => p.type === "chaser" && p.colorIndex === index && p.connected
      );

      // Only move chasers that are player-controlled
      if (!isPlayerControlled) {
        return; // Don't move chasers that aren't controlled by players
      }

      // All chasers move with global chaser speed
      moveCharacter(chaser, gameState.chaserSpeed);

      if (!isAtTarget(chaser)) {
        return;
      }

      // At tile center: chasers continue in current direction or change based on input
      if (chaser.nextDirX || chaser.nextDirY) {
        // Player provided new input - try to change direction
        const desiredX = chaser.x + chaser.nextDirX;
        const desiredY = chaser.y + chaser.nextDirY;
        if (desiredX >= 0 && desiredX < COLS && desiredY >= 0 && desiredY < ROWS && isPath(desiredX, desiredY)) {
          // Direction is valid - apply it
          chaser.dirX = chaser.nextDirX;
          chaser.dirY = chaser.nextDirY;
          chaser.targetX = desiredX;
          chaser.targetY = desiredY;
          chaser.lastDirX = chaser.dirX;
          chaser.lastDirY = chaser.dirY;
          // Clear the queued direction after successfully using it
          chaser.nextDirX = 0;
          chaser.nextDirY = 0;
        } else {
          // Direction not valid yet - KEEP IT QUEUED, continue in current direction
          // Don't clear nextDirX/nextDirY - it will be tried again at the next tile center
          if (chaser.dirX !== 0 || chaser.dirY !== 0) {
            const continueX = chaser.x + chaser.dirX;
            const continueY = chaser.y + chaser.dirY;
            if (continueX >= 0 && continueX < COLS && continueY >= 0 && continueY < ROWS && isPath(continueX, continueY)) {
              chaser.targetX = continueX;
              chaser.targetY = continueY;
            } else {
              // Can't continue in current direction, try the queued direction as last resort
              if (desiredX >= 0 && desiredX < COLS && desiredY >= 0 && desiredY < ROWS && isPath(desiredX, desiredY)) {
                chaser.dirX = chaser.nextDirX;
                chaser.dirY = chaser.nextDirY;
                chaser.targetX = desiredX;
                chaser.targetY = desiredY;
                chaser.nextDirX = 0;
                chaser.nextDirY = 0;
              } else {
                // Can't move in either direction, stop
                chaser.dirX = 0;
                chaser.dirY = 0;
              }
            }
          }
        }
      } else if (chaser.dirX !== 0 || chaser.dirY !== 0) {
        // No new input, but already moving - continue in current direction
        const continueX = chaser.x + chaser.dirX;
        const continueY = chaser.y + chaser.dirY;
        if (continueX >= 0 && continueX < COLS && continueY >= 0 && continueY < ROWS && isPath(continueX, continueY)) {
          chaser.targetX = continueX;
          chaser.targetY = continueY;
        } else {
          // Can't continue, stop
          chaser.dirX = 0;
          chaser.dirY = 0;
        }
      }
    });
  }

  if (gameState.gameStarted) {
    // Only check collisions while the game is running
    checkCollisions();
  }

  // Broadcast game state to all clients
  broadcastGameState();
}

// ========== HIGHSCORE MANAGEMENT ==========
const HIGHSCORE_FILE = path.join(__dirname, "highscore.json");

function loadHighscore() {
  try {
    if (fs.existsSync(HIGHSCORE_FILE)) {
      const data = fs.readFileSync(HIGHSCORE_FILE, "utf8");
      const parsed = JSON.parse(data);
      // Handle legacy format (single score object)
      if (parsed.score !== undefined && !Array.isArray(parsed)) {
        return [parsed];
      }
      // Return array of scores (top 10)
      return Array.isArray(parsed) ? parsed : [];
    }
  } catch (error) {
    console.error("Error loading highscore:", error);
  }
  // Return empty array if no highscore file exists (will be initialized with test data)
  return [];
}

function saveHighscore(score, playerName, isTeamGame) {
  try {
    let highscores = loadHighscore();
    
    // Handle legacy format (single score object)
    if (!Array.isArray(highscores) && highscores.score !== undefined) {
      highscores = [highscores];
    }
    
    // Ensure highscores is an array
    if (!Array.isArray(highscores)) {
      highscores = [];
    }
    
    // Create new score entry
    const newScore = {
      score: score,
      playerName: playerName || "Unknown",
      isTeamGame: isTeamGame,
      date: new Date().toISOString(),
    };
    
    // Add new score to array
    highscores.push(newScore);
    
    // Sort by score (descending) and keep only top 10
    highscores.sort((a, b) => b.score - a.score);
    highscores = highscores.slice(0, 10);
    
    // Find the rank of the newly added score
    const rank = highscores.findIndex(s => s.score === score && s.playerName === (playerName || "Unknown")) + 1;
    
    // Save to file
    fs.writeFileSync(HIGHSCORE_FILE, JSON.stringify(highscores, null, 2), "utf8");
    console.log(`Highscore saved: ${score} by ${playerName} (${isTeamGame ? "Team" : "Solo"}) - Rank ${rank}`);
  } catch (error) {
    console.error("Error saving highscore:", error);
  }
}

// ========== HTTP SERVER ==========
const server = http.createServer((req, res) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") {
    res.writeHead(200);
    res.end();
    return;
  }

  // API endpoint for highscore
  // POST endpoint to save highscore (for online solo games)
  if (req.url === "/api/highscore" && req.method === "POST") {
    let body = "";
    req.on("data", (chunk) => {
      body += chunk.toString();
    });
    req.on("end", () => {
      try {
        const data = JSON.parse(body);
        const { score, playerName, isTeamGame } = data;
        if (typeof score === "number" && playerName) {
          saveHighscore(score, playerName, isTeamGame);
          res.writeHead(200, {
            "Content-Type": "application/json",
            "Access-Control-Allow-Origin": "*",
          });
          res.end(JSON.stringify({ success: true }));
        } else {
          res.writeHead(400, {
            "Content-Type": "application/json",
            "Access-Control-Allow-Origin": "*",
          });
          res.end(JSON.stringify({ success: false, error: "Invalid data" }));
        }
      } catch (error) {
        res.writeHead(500, {
          "Content-Type": "application/json",
          "Access-Control-Allow-Origin": "*",
        });
        res.end(JSON.stringify({ success: false, error: error.message }));
      }
    });
    return;
  }

  if (req.url === "/api/highscore" && req.method === "GET") {
    const highscore = loadHighscore();
    res.writeHead(200, {
      "Content-Type": "application/json",
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
    });
    res.end(JSON.stringify(highscore), "utf-8");
    return;
  }

  // Handle favicon requests
  if (req.url === "/favicon.ico") {
    res.writeHead(204, { "Content-Type": "image/x-icon" });
    res.end();
    return;
  }

  let filePath;
  if (req.url === "/" || req.url === "") {
    filePath = "./index.html";
  } else {
    // Serve static assets like /public/style.css, /public/game.js, etc.
    filePath = "." + req.url;
  }

  const extname = String(path.extname(filePath)).toLowerCase();
  const mimeTypes = {
    ".html": "text/html",
    ".js": "text/javascript",
    ".mjs": "text/javascript",
    ".css": "text/css",
    ".json": "application/json",
    ".png": "image/png",
    ".jpg": "image/jpg",
    ".gif": "image/gif",
    ".svg": "image/svg+xml",
    ".wav": "audio/wav",
    ".mp4": "video/mp4",
    ".woff": "application/font-woff",
    ".ttf": "application/font-ttf",
    ".eot": "application/vnd.ms-fontobject",
    ".otf": "application/font-otf",
    ".wasm": "application/wasm",
  };

  const contentType = mimeTypes[extname] || "application/octet-stream";

  fs.readFile(filePath, (error, content) => {
    if (error) {
      if (error.code == "ENOENT") {
        res.writeHead(404, { "Content-Type": "text/html" });
        res.end("<h1>404 - File Not Found</h1>", "utf-8");
      } else {
        res.writeHead(500);
        res.end(`Server Error: ${error.code}`, "utf-8");
      }
    } else {
      res.writeHead(200, { "Content-Type": contentType });
      res.end(content, "utf-8");
    }
  });
});

// ========== WEBSOCKET SERVER ==========
const wss = new WebSocketServer({
  server,
  verifyClient: () => true,
});

wss.on("connection", (ws, req) => {
  const playerId = `player_${gameState.nextPlayerId++}`;

  ws.send(
    JSON.stringify({
      type: "connected",
      playerId: playerId,
    })
  );

  ws.on("message", (message) => {
    try {
      const data = JSON.parse(message.toString());
      switch (data.type) {
        case "selectChaser":
          handleSelectChaser(ws, playerId, data);
          break;
        case "join":
          handleJoin(ws, playerId, data);
          break;
        case "input":
          handleInput(playerId, data);
          break;
        case "setSpeeds":
          handleSetSpeeds(data);
          break;
        case "setGameDuration":
          handleSetGameDuration(data);
          break;
        case "setAIDifficulty":
          if (data.difficulty !== undefined) {
            gameState.aiDifficulty = data.difficulty;
            broadcast({ type: "aiDifficultyChanged", difficulty: data.difficulty });
          }
          break;
        case "setCamera3D":
          if (data.cameraType !== undefined) {
            broadcast({ type: "camera3DChanged", cameraType: data.cameraType });
          }
          break;
        case "setCameraZoom":
          if (data.zoom !== undefined) {
            broadcast({ type: "cameraZoomChanged", zoom: data.zoom });
          }
          break;
        case "setAmbientLight":
          if (data.intensity !== undefined) {
            broadcast({ type: "ambientLightChanged", intensity: data.intensity });
          }
          break;
        case "setDirectionalLight":
          if (data.intensity !== undefined) {
            broadcast({ type: "directionalLightChanged", intensity: data.intensity });
          }
          break;
        case "setPointLight":
          if (data.intensity !== undefined) {
            broadcast({ type: "pointLightChanged", intensity: data.intensity });
          }
          break;
        case "setPathColor":
          if (data.color !== undefined) {
            broadcast({ type: "pathColorChanged", color: data.color });
          }
          break;
        case "setInnerWallColor":
          if (data.color !== undefined) {
            broadcast({ type: "innerWallColorChanged", color: data.color });
          }
          break;
        case "setOuterWallColor":
          if (data.color !== undefined) {
            broadcast({ type: "outerWallColorChanged", color: data.color });
          }
          break;
        case "setBodyBgColor":
          if (data.color !== undefined) {
            broadcast({ type: "bodyBgColorChanged", color: data.color });
          }
          break;
        case "setMazeOpacity":
          if (data.opacity !== undefined) {
            broadcast({ type: "mazeOpacityChanged", opacity: data.opacity });
          }
          break;
        case "setBuildingRealOpacity":
          if (data.opacity !== undefined) {
            broadcast({ type: "buildingRealOpacityChanged", opacity: data.opacity });
          }
          break;
        case "setBuildingRealBlendMode":
          if (data.blendMode !== undefined) {
            broadcast({ type: "buildingRealBlendModeChanged", blendMode: data.blendMode });
          }
          break;
        case "startGame":
          if (!gameState.gameStarted) {
            console.log("[server] Starting game - initializing characters");
            // Initialize/reset characters when game starts
            initCharacters();
            
            gameState.gameStarted = true;
            gameState.gameStartTime = Date.now();
            
            // Keep the same game code for the entire server session (don't regenerate on start)
            
            // Track first player (the one who clicked start)
            gameState.firstPlayerId = playerId;
            const firstPlayer = gameState.players.get(playerId);
            gameState.firstPlayerName = firstPlayer ? (firstPlayer.playerName || "Unknown") : "Unknown";
            
            // Count connected chasers to determine if team game or solo
            let chaserCount = 0;
            gameState.players.forEach((player) => {
              if (player.connected && player.type === "chaser") {
                chaserCount++;
                // Respawn chasers to their spawn positions when game starts
                if (gameState.chasers[player.colorIndex]) {
                  const chaser = gameState.chasers[player.colorIndex];
                  respawnChaser(chaser, chaser.spawnPos);
                  chaser.positionHistory = [];
                  chaser.dirX = 0;
                  chaser.dirY = 0;
                  chaser.nextDirX = 0;
                  chaser.nextDirY = 0;
                }
              }
            });
            gameState.isTeamGame = chaserCount > 1;
            
            // Reset all chaser stats when game starts
            gameState.players.forEach((player, playerId) => {
              if (player.connected && player.type === "chaser") {
                player.stats.chaserScore = 0;
                player.stats.catches = 0;
                player.stats.catchScores = [];
                player.stats.totalCaptureTime = 0;
              }
            });
            gameState.caughtFugitives.clear();
            console.log("[server] Broadcasting gameStarted message");
            broadcast({ type: "gameStarted" });
          }
          break;
        case "restartGame":
          gameState.gameStarted = false;
          initCharacters();
          broadcast({ type: "gameRestarted" });
          break;
        case "endGame":
          // Manually end the game (same as natural end)
          console.log("[server] Received endGame message from player", playerId);
          if (gameState.gameStarted) {
            console.log("[server] Ending game manually...");
            endGame(false); // false = not all caught, time's up
          } else {
            console.log("[server] Cannot end game - game not started");
          }
          break;
        case "gameState":
          sendGameState(ws);
          break;
        case "updatePlayerName":
          // Update player name (for highscore purposes)
          const player = gameState.players.get(playerId);
          if (player && data.playerName) {
            player.playerName = data.playerName;
            // If this is the first player, update firstPlayerName for highscore
            if (playerId === gameState.firstPlayerId) {
              gameState.firstPlayerName = data.playerName;
            }
          }
          break;
        default:
      }
    } catch (error) {}
  });

  ws.on("close", () => {
    handleDisconnect(playerId);
  });

  ws.on("error", (error) => {
    handleDisconnect(playerId);
  });
});

// ========== MESSAGE HANDLERS ==========
function handleJoin(ws, playerId, data) {
  // Validate game code if provided
  if (data.gameCode !== undefined) {
    // Ensure gameState.gameCode is initialized (fallback only - should already be set on server startup)
    if (!gameState.gameCode) {
      gameState.gameCode = generateGameCode();
      console.log(`[handleJoin] Generated initial game code for server session: ${gameState.gameCode}`);
    }
    
    // Normalize both codes to strings and compare
    const serverCode = String(gameState.gameCode).trim().padStart(2, '0');
    const clientCode = String(data.gameCode).trim().padStart(2, '0');
    
    console.log(`[handleJoin] Code validation - Server: "${serverCode}" (type: ${typeof serverCode}), Client: "${clientCode}" (type: ${typeof data.gameCode}), Match: ${serverCode === clientCode}`);
    
    if (serverCode !== clientCode) {
      ws.send(JSON.stringify({ 
        type: "joinFailed", 
        reason: `Invalid game code. Expected: ${serverCode}, Got: ${clientCode}` 
      }));
      return;
    }
  } else {
    // Require game code for joining
    ws.send(JSON.stringify({ 
      type: "joinFailed", 
      reason: "Game code required. Please enter the 2-digit code." 
    }));
    return;
  }
  const { characterType, colorIndex } = data;

  // Players can only join as chasers (fugitives are AI-controlled)
  if (characterType === "fugitive") {
    ws.send(JSON.stringify({ type: "joinFailed", reason: "Players can only join as chasers" }));
    return;
  }

  // Normalize character type for availableColors lookup
  const normalizedTypeForColors = characterType === "chaser" ? "chaser" : characterType;
  const availableColors = gameState.availableColors[normalizedTypeForColors];
  if (!availableColors || !availableColors.includes(colorIndex)) {
    ws.send(JSON.stringify({ type: "joinFailed", reason: "Chaser slot already taken" }));
    return;
  }

  // If this player was already controlling a character, free up their old color now that the new join is valid
  const existing = gameState.players.get(playerId);
  let playerStats = {
    chaserScore: 0, // Team score (shared by all chasers)
    catches: 0, // Number of times chaser caught fugitive
    catchScores: [], // Array of individual catch scores (for cumulative scoring)
    totalCaptureTime: 0, // Total time spent catching all fugitives
  };
  if (existing) {
    // Normalize character type for availableColors lookup
    const existingNormalizedType =
      existing.type === "fugitive"
        ? "fugitive"
        : existing.type === "chaser"
        ? "chaser"
        : existing.type;
    const prevList = gameState.availableColors[existingNormalizedType];
    if (prevList && !prevList.includes(existing.colorIndex)) {
      prevList.push(existing.colorIndex);
      prevList.sort();
    }
    // Preserve stats when switching characters
    if (existing.stats) {
      playerStats = existing.stats;
      // Ensure catchScores array exists
      if (!playerStats.catchScores) {
        playerStats.catchScores = [];
      }
    }
  }

  // Get player initials/name from data
  const playerName = data.playerName || "AI"; // Default to "AI" if not provided

  // All players are chasers
  const normalizedType = "chaser";

  gameState.players.set(playerId, {
    type: normalizedType,
    colorIndex: colorIndex,
    connected: true,
    ws: ws,
    pendingInput: null,
    stats: playerStats,
    playerName: playerName, // 3-letter initials
  });

  // Chaser already exists (all chasers are initialized at game start)
  // Just respawn it to spawn position when player joins
  if (normalizedType === "chaser" && gameState.chasers[colorIndex]) {
    const chaser = gameState.chasers[colorIndex];
    respawnChaser(chaser, chaser.spawnPos);
    chaser.positionHistory = [];
    // Ensure movement directions are cleared
    chaser.dirX = 0;
    chaser.dirY = 0;
    chaser.nextDirX = 0;
    chaser.nextDirY = 0;
  }

  // Don't start game automatically - wait for "Start game" button

  const colorIdx = availableColors.indexOf(colorIndex);
  if (colorIdx > -1) {
    availableColors.splice(colorIdx, 1);
  }

  ws.send(JSON.stringify({ type: "joined", playerId: playerId, characterType: characterType, colorIndex: colorIndex, playerName: playerName }));
  
  // Remove selection when player actually joins
  if (gameState.chaserSelections && gameState.chaserSelections.has(colorIndex)) {
    const selection = gameState.chaserSelections.get(colorIndex);
    if (selection.playerId === playerId) {
      gameState.chaserSelections.delete(colorIndex);
    }
  }
  
  broadcastGameState();
}

function handleSelectChaser(ws, playerId, data) {
  const { colorIndex, playerName } = data;
  
  // Check if this chaser slot is available
  const availableColors = gameState.availableColors.chaser;
  if (!availableColors || !availableColors.includes(colorIndex)) {
    ws.send(JSON.stringify({ type: "selectChaserFailed", reason: "Chaser slot not available" }));
    return;
  }
  
  // Remove any previous selection by this player
  if (gameState.chaserSelections) {
    gameState.chaserSelections.forEach((selection, idx) => {
      if (selection.playerId === playerId) {
        gameState.chaserSelections.delete(idx);
      }
    });
  }
  
  // Add new selection
  if (!gameState.chaserSelections) {
    gameState.chaserSelections = new Map();
  }
  gameState.chaserSelections.set(colorIndex, {
    playerId: playerId,
    playerName: playerName || "AI"
  });
  
  // Broadcast the selection to all players
  broadcastGameState();
}

function handleSetSpeeds(data) {
  const { fugitiveSpeed, chaserSpeed } = data;
  if (typeof fugitiveSpeed === "number") {
    gameState.fugitiveSpeed = Math.max(0.3, Math.min(1, fugitiveSpeed));
  }
  if (typeof chaserSpeed === "number") {
    gameState.chaserSpeed = Math.max(0.3, Math.min(1, chaserSpeed));
  }
}

function handleSetGameDuration(data) {
  const { duration } = data;
  if (typeof duration === "number") {
    gameState.gameDuration = Math.max(10, Math.min(120, duration)); // 10 seconds to 120 seconds
    console.log(`[GAME] Game duration set to ${gameState.gameDuration} seconds`);
  }
}

// Items system removed - not used

function handleInput(playerId, data) {
  const player = gameState.players.get(playerId);
  if (!player) {
    return;
  }
  if (!player.connected) {
    return;
  }
  player.pendingInput = data.input;
}

// Rounds system removed - not used

function handleDisconnect(playerId) {
  // Remove any chaser selections by this player
  if (gameState.chaserSelections) {
    gameState.chaserSelections.forEach((selection, idx) => {
      if (selection.playerId === playerId) {
        gameState.chaserSelections.delete(idx);
      }
    });
  }
  
  const player = gameState.players.get(playerId);
  if (player) {
    // Check if this is the last chaser player (before removing them)
    const chaserPlayers = Array.from(gameState.players.values()).filter((p) => p.type === "chaser" && p.connected);
    const isLastChaser = chaserPlayers.length === 1 && player.type === "chaser";

    // Check if there's only 1 player total (before removing this one)
    const totalPlayers = Array.from(gameState.players.values()).filter((p) => p.connected);
    const isOnlyPlayer = totalPlayers.length === 1;

    // Free up the chaser slot
    if (player.type === "chaser") {
      if (!gameState.availableColors.chaser.includes(player.colorIndex)) {
        gameState.availableColors.chaser.push(player.colorIndex);
        gameState.availableColors.chaser.sort();
      }
      // Don't remove the chaser object - it should remain visible at 20% opacity
      // gameState.chasers[player.colorIndex] = null;
    } else {
      // For other types, use the old logic
      const normalizedType = player.type === "fugitive" ? "fugitive" : player.type;
      if (gameState.availableColors[normalizedType]) {
        if (!gameState.availableColors[normalizedType].includes(player.colorIndex)) {
          gameState.availableColors[normalizedType].push(player.colorIndex);
          gameState.availableColors[normalizedType].sort();
        }
      }
    }
    gameState.players.delete(playerId);
    broadcast({ type: "playerLeft", playerId: playerId });

    // If this was the only player or the last chaser, reset the game
    if ((isOnlyPlayer || isLastChaser) && gameState.gameStarted) {
      resetGame();
    } else {
      broadcastGameState();
    }
  }
}

function broadcast(message) {
  const data = JSON.stringify(message); // Stringify once, reuse for all clients
  let clientCount = 0;
  let errorCount = 0;
  wss.clients.forEach((client) => {
    if (client.readyState === 1) {
      clientCount++;
      try {
        client.send(data);
      } catch (error) {
        errorCount++;
        console.error("[broadcast] Error sending to client:", error);
      }
    } else {
      console.log(`[broadcast] Skipping client with readyState: ${client.readyState}`);
    }
  });
  if (message.type === "gameEnd") {
    console.log(`[broadcast] Sent gameEnd message to ${clientCount} connected clients (${errorCount} errors)`);
    console.log(`[broadcast] Total WebSocket clients: ${wss.clients.size}`);
  }
}

function sendGameState(ws) {
  // Pre-compute player-controlled chasers (do this once instead of per-chaser)
  const playerControlledChasers = new Set();
  gameState.players.forEach((player) => {
    if (player.type === "chaser" && player.connected) {
      playerControlledChasers.add(player.colorIndex);
    }
  });

  const players = Array.from(gameState.players.entries()).map(([id, player]) => ({
    playerId: id,
    type: player.type,
    colorIndex: player.colorIndex,
    connected: player.connected,
    playerName: player.playerName || "AI",
    stats: player.stats
      ? {
          chaserScore: player.stats.chaserScore,
          fugitiveScore: player.stats.fugitiveScore,
          rounds: player.stats.rounds,
        }
      : null,
  }));

  // Build fugitive positions (only active ones)
  const fugitivePositions = [];
  for (let index = 0; index < gameState.fugitives.length; index++) {
    if (gameState.caughtFugitives.has(index)) continue;
    const p = gameState.fugitives[index];
    fugitivePositions.push({
      index: index,
      x: p.x,
      y: p.y,
      px: p.px,
      py: p.py,
      color: p.color,
    });
  }

  // Build chaser positions (use cached isPlayerControlled)
  const chaserPositions = [];
  for (let index = 0; index < gameState.chasers.length; index++) {
    const g = gameState.chasers[index];
    if (!g) continue;
    chaserPositions.push({
      index: index,
      x: g.x,
      y: g.y,
      px: g.px,
      py: g.py,
      color: g.color,
      isPlayerControlled: playerControlledChasers.has(index),
    });
  }

  // Build chaser selections map
  const chaserSelections = {};
  if (gameState.chaserSelections) {
    gameState.chaserSelections.forEach((selection, colorIndex) => {
      chaserSelections[colorIndex] = {
        playerName: selection.playerName
      };
    });
  }

  ws.send(
    JSON.stringify({
      type: "gameState",
      players: players,
      availableColors: {
        fugitive: gameState.availableColors.fugitive,
        chaser: gameState.availableColors.chaser,
      },
      chaserSelections: chaserSelections, // Selections before joining
      gameStarted: gameState.gameStarted,
      gameCode: gameState.gameCode, // 2-digit code for joining
      positions: {
        fugitives: fugitivePositions,
        chasers: chaserPositions,
      },
    })
  );
}

function broadcastGameState() {
  // Pre-compute player-controlled chasers (do this once instead of per-chaser)
  const playerControlledChasers = new Set();
  gameState.players.forEach((player) => {
    if (player.type === "chaser" && player.connected) {
      playerControlledChasers.add(player.colorIndex);
    }
  });

  const players = Array.from(gameState.players.entries()).map(([id, player]) => ({
    playerId: id,
    type: player.type,
    colorIndex: player.colorIndex,
    connected: player.connected,
    playerName: player.playerName || "AI",
    stats: player.stats
      ? {
          chaserScore: player.stats.chaserScore,
          fugitiveScore: player.stats.fugitiveScore,
          rounds: player.stats.rounds,
        }
      : null,
  }));

  // Build fugitive positions (only active ones)
  const fugitivePositions = [];
  for (let index = 0; index < gameState.fugitives.length; index++) {
    if (gameState.caughtFugitives.has(index)) continue;
    const p = gameState.fugitives[index];
    fugitivePositions.push({
      index: index,
      x: p.x,
      y: p.y,
      px: p.px,
      py: p.py,
      color: p.color,
    });
  }

  // Build chaser positions (use cached isPlayerControlled)
  const chaserPositions = [];
  for (let index = 0; index < gameState.chasers.length; index++) {
    const g = gameState.chasers[index];
    if (!g) continue;
    chaserPositions.push({
      index: index,
      x: g.x,
      y: g.y,
      px: g.px,
      py: g.py,
      color: g.color,
      isPlayerControlled: playerControlledChasers.has(index),
    });
  }

  // Build chaser selections map
  const chaserSelections = {};
  if (gameState.chaserSelections) {
    gameState.chaserSelections.forEach((selection, colorIndex) => {
      chaserSelections[colorIndex] = {
        playerName: selection.playerName
      };
    });
  }

  broadcast({
    type: "gameState",
    players: players,
      availableColors: {
        fugitive: gameState.availableColors.fugitive,
        chaser: gameState.availableColors.chaser,
      },
    chaserSelections: chaserSelections, // Selections before joining
    gameStarted: gameState.gameStarted,
    gameCode: gameState.gameCode, // 2-digit code for joining
    positions: {
      fugitives: fugitivePositions,
      chasers: chaserPositions,
      // Legacy support (reference same arrays)
    },
  });
}

// ========== INITIALIZE TEST HIGHSCORE ==========
// Initialize highscore file with test data if it doesn't exist or is empty
function initializeHighscore() {
  try {
    const current = loadHighscore();
    // If no highscore exists or array is empty, initialize with test data
    if (!current || current.length === 0) {
      // Create realistic but low test scores with JGD initials (all solo games)
      const testHighscores = [
        { score: 1250, playerName: "JGD", isTeamGame: false, date: new Date().toISOString() },
        { score: 1180, playerName: "JGD", isTeamGame: false, date: new Date().toISOString() },
        { score: 1120, playerName: "JGD", isTeamGame: false, date: new Date().toISOString() },
        { score: 1050, playerName: "JGD", isTeamGame: false, date: new Date().toISOString() },
        { score: 980, playerName: "JGD", isTeamGame: false, date: new Date().toISOString() },
        { score: 920, playerName: "JGD", isTeamGame: false, date: new Date().toISOString() },
        { score: 850, playerName: "JGD", isTeamGame: false, date: new Date().toISOString() },
        { score: 780, playerName: "JGD", isTeamGame: false, date: new Date().toISOString() },
        { score: 720, playerName: "JGD", isTeamGame: false, date: new Date().toISOString() },
        { score: 650, playerName: "JGD", isTeamGame: false, date: new Date().toISOString() },
      ];
      fs.writeFileSync(HIGHSCORE_FILE, JSON.stringify(testHighscores, null, 2), "utf8");
      console.log("Initialized highscore file with 10 test scores (JGD)");
    }
  } catch (error) {
    console.error("Error initializing highscore file:", error);
  }
}

// ========== START SERVER ==========
initializeHighscore();
// Initialize game code on server startup
if (!gameState.gameCode) {
  gameState.gameCode = generateGameCode();
  console.log(`[Server] Initialized game code: ${gameState.gameCode}`);
}
initCharacters();
setInterval(gameLoop, 16); // ~60fps game loop (smoother updates)

server.listen(PORT, () => {});
