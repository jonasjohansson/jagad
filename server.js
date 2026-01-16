// Simple WebSocket server for Pacman multiplayer game
// Server-authoritative: server maintains game state and runs game loop

const http = require("http");
const fs = require("fs");
const path = require("path");
const { WebSocketServer } = require("ws");
const { MAP, COLS, ROWS, TUNNEL_ROW } = require("./public/map");

const PORT = process.env.PORT || 3000;

// ========== GAME CONSTANTS ==========
const CELL_SIZE = 20;
const CHARACTER_SIZE = 16;
const CHARACTER_OFFSET = (CELL_SIZE - CHARACTER_SIZE) / 2;
// Base movement speed (tuned to feel closer to the original client-side movement)
// Higher = faster movement across the grid
const BASE_MOVE_SPEED = 0.25;
const COLORS = ["red", "green", "blue", "yellow"];
const DIRECTIONS = [
  { dir: "up", x: 0, y: -1 },
  { dir: "down", x: 0, y: 1 },
  { dir: "left", x: -1, y: 0 },
  { dir: "right", x: 1, y: 0 },
];
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
    chaser: [1, 2, 3], // Chaser 0 is always AI-controlled, players can join 1, 2, or 3
  },
  gameStarted: false, // Game starts when first player joins
  gameStartTime: null, // When the current game started (90 seconds timer)
  gameDuration: 90, // Game lasts 90 seconds
  aiDifficulty: 0.8,
  // Global speed multipliers for all fugitives and all chasers
  fugitiveSpeed: 0.4,
  chaserSpeed: 0.6, // Increased for more responsive movement
  survivalTimeThreshold: 10, // Not used in new game mode
  chaserSpeedIncreasePerRound: 0.01, // Not used in new game mode
  itemsEnabled: false, // Toggle for yellow dots/items
  fugitives: [],
  chasers: [],
  items: [], // Collectible items on the map { x, y, collected: boolean }
  lastUpdate: Date.now(),
  caughtFugitives: new Set(), // Track which fugitives have been caught
};

// Debug counters
let debugTickCounter = 0;

function isFugitivePlayerControlled(index) {
  return Array.from(gameState.players.values()).some((p) => p.type === "fugitive" && p.colorIndex === index && p.connected);
}

// Initialize lastUpdate
gameState.lastUpdate = Date.now();

// Initialize collectible items on the map
function initItems() {
  gameState.items = [];
  if (!gameState.itemsEnabled) return; // Don't create items if disabled

  // Place items on all path tiles (excluding spawn positions and teleports)
  for (let y = 0; y < ROWS; y++) {
    for (let x = 0; x < COLS; x++) {
      const cellType = MAP[y][x];
      // Place items on regular paths (0), but not on teleports (2) or spawns (3, 4)
      if (cellType === 0) {
        // Skip spawn positions
        const isSpawn =
          fugitiveSpawnPositions.some((pos) => pos.x === x && pos.y === y) ||
          chaserSpawnPositions.some((pos) => pos.x === x && pos.y === y);
        if (!isSpawn) {
          gameState.items.push({ x, y, collected: false });
        }
      }
    }
  }
}

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
    // Survival time tracking for scoring
    survivalStartTime: null, // When the current survival period started
    lastSurvivalPointTime: null, // When we last awarded a survival point
    itemsCollected: 0, // Number of collectible items collected this round
  }));

  // Initialize only the first chaser (index 0) - present from start but not moving
  // Other chasers (1, 2, 3) will be created when players join them
  if (chaserSpawnPositions.length > 0) {
    const pos = chaserSpawnPositions[0];
    gameState.chasers[0] = {
      x: pos.x,
      y: pos.y,
      px: pos.x * CELL_SIZE + CHARACTER_OFFSET,
      py: pos.y * CELL_SIZE + CHARACTER_OFFSET,
      targetX: pos.x, // Start at spawn position
      targetY: pos.y, // Start at spawn position
      color: "white", // All chasers are white
      speed: 1.0,
      spawnPos: { ...pos },
      moveTimer: 0,
      lastDirX: 0, // No initial direction - won't move until player controls it
      lastDirY: 0, // No initial direction
      positionHistory: [],
      dirX: 0, // No movement direction
      dirY: 0, // No movement direction
      nextDirX: 0, // No queued direction
      nextDirY: 0, // No queued direction
    };
  }
  
  // Initialize other chaser slots as null (will be created when players join)
  gameState.chasers[1] = null;
  gameState.chasers[2] = null;
  gameState.chasers[3] = null;
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
  const target = getTargetPixelPos(character.targetX, character.targetY);
  const dx = target.x - character.px;
  const dy = target.y - character.py;
  const distance = Math.sqrt(dx * dx + dy * dy);

  // Move until we exactly reach the tile center; avoid a "dead zone" where
  // distance is small but we never snap to the target.
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

function determineBestMove(chaser, possibleMoves, targetFugitive) {
  if (!targetFugitive || possibleMoves.length === 0) return possibleMoves[0];
  let bestMove = null;
  let bestScore = -Infinity;
  const targetPos = { x: targetFugitive.x, y: targetFugitive.y };

  possibleMoves.forEach((move) => {
    const movePos = { x: move.newX, y: move.newY };
    const distance = calculateDistanceWithWrap(movePos, targetPos);
    let score = -distance;
    if (chaser.lastDirX === move.x && chaser.lastDirY === move.y) score += 0.5;
    if (chaser.positionHistory) {
      const recentPositions = chaser.positionHistory.slice(-2);
      const isRecent = recentPositions.some((pos) => pos.x === move.newX && pos.y === move.newY);
      if (isRecent) score -= 2.0;
    }
    const currentDistance = calculateDistanceWithWrap({ x: chaser.x, y: chaser.y }, targetPos);
    if (distance < currentDistance) score += 1.0;
    if (score > bestScore) {
      bestScore = score;
      bestMove = move;
    }
  });

  return bestMove || possibleMoves[0];
}

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

  // Choose the move that maximizes distance from the closest chaser
  let bestMove = possibleMoves[0];
  let bestDistance = -Infinity;
  const chaserPos = { x: closestChaser.x, y: closestChaser.y };

  possibleMoves.forEach((move) => {
    const movePos = { x: move.newX, y: move.newY };
    const distance = calculateDistanceWithWrap(movePos, chaserPos);
    if (distance > bestDistance) {
      bestDistance = distance;
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

function moveChaserAI(chaser) {
  chaser.x = chaser.targetX;
  chaser.y = chaser.targetY;
  if (!chaser.positionHistory) chaser.positionHistory = [];
  chaser.positionHistory.push({ x: chaser.x, y: chaser.y });
  if (chaser.positionHistory.length > 6) chaser.positionHistory.shift();

  // Find the closest uncatched fugitive (any color)
  let targetFugitive = null;
  let closestDistance = Infinity;
  gameState.fugitives.forEach((fugitive, index) => {
    if (!fugitive || gameState.caughtFugitives.has(index)) return;
    const distance = calculateDistanceWithWrap({ x: chaser.x, y: chaser.y }, { x: fugitive.x, y: fugitive.y });
    if (distance < closestDistance) {
      closestDistance = distance;
      targetFugitive = fugitive;
    }
  });

  const possibleMoves = getPossibleMoves(chaser);
  if (possibleMoves.length === 0) {
    chaser.positionHistory = [];
    return;
  }

  const chosenMove = !targetFugitive
    ? possibleMoves[Math.floor(Math.random() * possibleMoves.length)]
    : Math.random() < gameState.aiDifficulty
    ? determineBestMove(chaser, possibleMoves, targetFugitive)
    : (() => {
        const nonRecentMoves = possibleMoves.filter((move) => {
          if (!chaser.positionHistory?.length) return true;
          const recent = chaser.positionHistory.slice(-2);
          return !recent.some((pos) => pos.x === move.newX && pos.y === move.newY);
        });
        return nonRecentMoves.length > 0
          ? nonRecentMoves[Math.floor(Math.random() * nonRecentMoves.length)]
          : possibleMoves[Math.floor(Math.random() * possibleMoves.length)];
      })();

  if (chosenMove) {
    chaser.targetX = chosenMove.newX;
    chaser.targetY = chosenMove.newY;
    chaser.lastDirX = chosenMove.x;
    chaser.lastDirY = chosenMove.y;
  }
}

function continueInCurrentDirection(chaser) {
  const newX = chaser.targetX + chaser.lastDirX;
  const newY = chaser.targetY + chaser.lastDirY;
  // No manual wrap-around; tunnel behavior is handled via teleport tiles
  if (newX >= 0 && newX < COLS && newY >= 0 && newY < ROWS && isPath(newX, newY)) {
    chaser.targetX = newX;
    chaser.targetY = newY;
    return;
  }
  moveChaserAI(chaser);
}

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
        
        // Update all chaser players' scores (lower time = better score)
        // Score is based on how fast all fugitives are caught
        gameState.players.forEach((player, playerId) => {
          if (player.connected && player.type === "chaser") {
            // Track total catch time for scoring
            player.stats.totalCaptureTime = (player.stats.totalCaptureTime || 0) + catchTime;
            player.stats.catches = (player.stats.catches || 0) + 1;
            // Score = number of catches (will be finalized at game end)
            player.stats.chaserScore = player.stats.catches;
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
  if (!gameState.gameStarted) return;
  
  gameState.gameStarted = false;
  const gameTime = Date.now() - gameState.gameStartTime;
  
  // Calculate final scores for all chaser players
  gameState.players.forEach((player, playerId) => {
    if (player.connected && player.type === "chaser") {
      let finalScore = 0;
      
      if (allCaught) {
        // Score based on how fast all fugitives were caught (lower time = higher score)
        // Formula: 10000 - (total time in seconds * 10)
        // This gives higher scores for faster completions
        const totalTimeSeconds = gameTime / 1000;
        finalScore = Math.max(0, 10000 - Math.floor(totalTimeSeconds * 10));
      } else {
        // Didn't catch all fugitives - lower score based on how many were caught
        const caughtCount = gameState.caughtFugitives.size;
        const totalCount = gameState.fugitives.length;
        const caughtPercentage = caughtCount / totalCount;
        // Score = percentage of fugitives caught * 5000 (max score if all caught but slower)
        finalScore = Math.floor(caughtPercentage * 5000);
      }
      
      player.stats.chaserScore = finalScore;
      
      // Send game end message
      player.ws.send(
        JSON.stringify({
          type: "gameEnd",
          allCaught: allCaught,
          gameTime: gameTime,
          score: finalScore,
          fugitivesCaught: gameState.caughtFugitives.size,
          totalFugitives: gameState.fugitives.length,
        })
      );
    }
  });
  
  // Reset game state after a short delay to show final scores
  setTimeout(() => {
    resetGame();
  }, 3000); // 3 second delay before reset
}

function resetGame() {
  gameState.gameStarted = false;
  gameState.gameStartTime = null;
  gameState.caughtFugitives.clear();
  
  // Clear all player selections - players lose their chaser selection when game resets
  // Free up all chaser slots (except 0 which is always present)
  gameState.availableColors.chaser = [1, 2, 3];
  
  // Remove chasers 1, 2, 3 (they only exist when players join)
  gameState.chasers[1] = null;
  gameState.chasers[2] = null;
  gameState.chasers[3] = null;
  
  // Disconnect all players from their chasers
  gameState.players.forEach((player, playerId) => {
    if (player.type === "chaser" && player.colorIndex > 0) {
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
  chaser.moveTimer = 0;
  chaser.positionHistory = [];
  chaser.lastDirX = 0;
  chaser.lastDirY = 0;
  chaser.survivalTime = 0;
  chaser.lastSurvivalPoint = 0;
  for (const dir of DIRECTIONS) {
    const newX = spawnPos.x + dir.x;
    const newY = spawnPos.y + dir.y;
    if (isPath(newX, newY)) {
      chaser.targetX = newX;
      chaser.targetY = newY;
      chaser.lastDirX = dir.x;
      chaser.lastDirY = dir.y;
      break;
    }
  }
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

  // Process player input (pacmen and ghosts always)
  gameState.players.forEach((player, playerId) => {
    if (!player.connected || !player.pendingInput) return;
    const input = player.pendingInput;
    player.pendingInput = null;

    if (player.type === "fugitive" || player.type === "pacman") {
      const pacman = gameState.fugitives[player.colorIndex];
      if (!pacman) return;

      // Direction-based input: input.dir is 'left' | 'right' | 'up' | 'down'
      if (input.dir) {
        const dirDef = DIRECTIONS.find((d) => d.dir === input.dir);
        if (!dirDef) return;
        const dx = dirDef.x;
        const dy = dirDef.y;

        // Store desired direction; it will be applied when possible (at next tile center)
        pacman.nextDirX = dx;
        pacman.nextDirY = dy;

        // If currently stopped, try to start immediately in this direction
        if (pacman.dirX === 0 && pacman.dirY === 0) {
          const startX = pacman.x + dx;
          const startY = pacman.y + dy;
          if (startX >= 0 && startX < COLS && startY >= 0 && startY < ROWS && isPath(startX, startY)) {
            pacman.dirX = dx;
            pacman.dirY = dy;
            pacman.targetX = startX;
            pacman.targetY = startY;
          }
        }
      }
    } else if (player.type === "chaser" || player.type === "ghost") {
      const chaser = gameState.chasers[player.colorIndex];
      if (!chaser) return;

      // Direction-based input for chasers, same continuous style as fugitives
      if (input.dir) {
        const dirDef = DIRECTIONS.find((d) => d.dir === input.dir);
        if (!dirDef) return;
        const dx = dirDef.x;
        const dy = dirDef.y;

        // Store desired direction; applied at next tile center
        chaser.nextDirX = dx;
        chaser.nextDirY = dy;

        // If currently stopped, try to start immediately
        if (!chaser.dirX && !chaser.dirY) {
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

  // Move fugitives (always AI-controlled, even before game starts)
  gameState.fugitives.forEach((pacman, index) => {
    if (!pacman || gameState.caughtFugitives.has(index)) return; // Skip caught fugitives

    // Fugitives are always AI-controlled, never player-controlled
    // Check for item collection (fugitives collect items) - only if items are enabled
    if (gameState.itemsEnabled) {
      // Check if pacman is on a tile with an item
      const item = gameState.items.find((item) => !item.collected && item.x === pacman.x && item.y === pacman.y);
      if (item) {
        item.collected = true;
        pacman.itemsCollected = (pacman.itemsCollected || 0) + 1;
      }
    }

    // Move fugitive toward its current target using global fugitive speed
    moveCharacter(pacman, gameState.fugitiveSpeed);

    if (isAtTarget(pacman)) {
      // Fugitives are always AI-controlled
      moveFugitiveAI(pacman, index);
    }
  });

  // Chaser movement, survival, and collisions
  // All chasers are player-controlled only - no AI movement
  gameState.chasers.forEach((chaser, index) => {
    if (!chaser) return;
    const isPlayerControlled = Array.from(gameState.players.values()).some(
      (p) => (p.type === "chaser" || p.type === "ghost") && p.colorIndex === index && p.connected
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

    // At tile center: chasers only move when player provides input
    if (chaser.nextDirX || chaser.nextDirY) {
      const desiredX = chaser.x + chaser.nextDirX;
      const desiredY = chaser.y + chaser.nextDirY;
      if (desiredX >= 0 && desiredX < COLS && desiredY >= 0 && desiredY < ROWS && isPath(desiredX, desiredY)) {
        chaser.dirX = chaser.nextDirX;
        chaser.dirY = chaser.nextDirY;
        chaser.targetX = desiredX;
        chaser.targetY = desiredY;
        chaser.lastDirX = chaser.dirX;
        chaser.lastDirY = chaser.dirY;
        // Clear the queued direction after using it
        chaser.nextDirX = 0;
        chaser.nextDirY = 0;
      } else {
        // Invalid direction, clear it
        chaser.nextDirX = 0;
        chaser.nextDirY = 0;
        chaser.dirX = 0;
        chaser.dirY = 0;
      }
    } else {
      // No input, stop moving
      chaser.dirX = 0;
      chaser.dirY = 0;
    }
  });

  if (gameState.gameStarted) {
    // Only check collisions while the game is running
    checkCollisions();
  }

  // Broadcast game state to all clients
  broadcastGameState();
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
        case "join":
          handleJoin(ws, playerId, data);
          break;
        case "input":
          handleInput(playerId, data);
          break;
        case "setSpeeds":
          handleSetSpeeds(data);
          break;
        case "setItemsEnabled":
          handleSetItemsEnabled(data);
          break;
        case "startGame":
          if (!gameState.gameStarted) {
            gameState.gameStarted = true;
            gameState.gameStartTime = Date.now();
            gameState.caughtFugitives.clear();
            broadcast({ type: "gameStarted" });
          }
          break;
        case "restartGame":
          gameState.gameStarted = false;
          initCharacters();
          broadcast({ type: "gameRestarted" });
          break;
        case "gameState":
          sendGameState(ws);
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
  const { characterType, colorIndex } = data;

  // Players can only join as chasers (fugitives are AI-controlled)
  const isFugitive = characterType === "fugitive" || characterType === "pacman";
  if (isFugitive) {
    ws.send(JSON.stringify({ type: "joinFailed", reason: "Players can only join as chasers" }));
    return;
  }

  // Normalize character type for availableColors lookup
  const normalizedTypeForColors = characterType === "chaser" || characterType === "ghost" ? "chaser" : characterType;
  const availableColors = gameState.availableColors[normalizedTypeForColors];
  if (!availableColors || !availableColors.includes(colorIndex)) {
    ws.send(JSON.stringify({ type: "joinFailed", reason: "Chaser slot already taken" }));
    return;
  }

  // If this player was already controlling a character, free up their old color now that the new join is valid
  const existing = gameState.players.get(playerId);
  let playerStats = {
    chaserScore: 0, // Number of catches (points)
    catches: 0, // Number of times chaser caught fugitive
    fugitiveScore: 0, // Points based on evasion + items collected
    rounds: 0, // Total rounds completed
    currentRoundStartTime: null, // When current round started
    totalCaptureTime: 0, // Total time spent capturing (for tracking, not scoring)
    itemsCollected: 0, // Total items collected across all rounds
  };
  if (existing) {
    // Normalize character type for availableColors lookup
    const existingNormalizedType =
      existing.type === "chasee" || existing.type === "pacman"
        ? "fugitive"
        : existing.type === "chaser" || existing.type === "ghost"
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
    }
  }

  // Get player initials/name from data
  const playerName = data.playerName || "AI"; // Default to "AI" if not provided

  // Support both new names (fugitive/chaser) and legacy names (pacman/ghost)
  const isChaser = characterType === "chaser" || characterType === "ghost";
  const normalizedType = "chaser"; // All players are chasers

  gameState.players.set(playerId, {
    type: normalizedType,
    colorIndex: colorIndex,
    connected: true,
    ws: ws,
    pendingInput: null,
    stats: playerStats,
    playerName: playerName, // 3-letter initials
  });

  // Create chaser if it doesn't exist (for chasers 1, 2, 3)
  if (isChaser && !gameState.chasers[colorIndex] && colorIndex > 0) {
    const spawnPos = chaserSpawnPositions[colorIndex];
    if (spawnPos) {
      gameState.chasers[colorIndex] = {
        x: spawnPos.x,
        y: spawnPos.y,
        px: spawnPos.x * CELL_SIZE + CHARACTER_OFFSET,
        py: spawnPos.y * CELL_SIZE + CHARACTER_OFFSET,
        targetX: spawnPos.x,
        targetY: spawnPos.y,
        color: "white",
        speed: 1.0,
        spawnPos: { ...spawnPos },
        moveTimer: 0,
        lastDirX: 0,
        lastDirY: 0,
        positionHistory: [],
        dirX: 0,
        dirY: 0,
        nextDirX: 0,
        nextDirY: 0,
      };
      respawnChaser(gameState.chasers[colorIndex], spawnPos);
    }
  } else if (isChaser && gameState.chasers[colorIndex]) {
    // Chaser already exists, just respawn it
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

  ws.send(JSON.stringify({ type: "joined", playerId: playerId, characterType: characterType, colorIndex: colorIndex }));
  broadcastGameState();
}

function handleSetSpeeds(data) {
  const { pacmanSpeed, ghostSpeed, fugitiveSpeed, chaserSpeed, survivalTimeThreshold, chaserSpeedIncreasePerRound } = data;
  // Support both new and legacy names
  if (typeof fugitiveSpeed === "number") {
    gameState.fugitiveSpeed = Math.max(0.2, Math.min(3, fugitiveSpeed));
  } else if (typeof pacmanSpeed === "number") {
    gameState.fugitiveSpeed = Math.max(0.2, Math.min(3, pacmanSpeed));
  }
  if (typeof chaserSpeed === "number") {
    gameState.chaserSpeed = Math.max(0.2, Math.min(3, chaserSpeed));
  } else if (typeof ghostSpeed === "number") {
    gameState.chaserSpeed = Math.max(0.2, Math.min(3, ghostSpeed));
  }
  if (typeof survivalTimeThreshold === "number") {
    gameState.survivalTimeThreshold = Math.max(1, Math.min(120, survivalTimeThreshold));
  }
  if (typeof chaserSpeedIncreasePerRound === "number") {
    gameState.chaserSpeedIncreasePerRound = Math.max(0, Math.min(0.05, chaserSpeedIncreasePerRound));
    console.log(`[SPEED] Updated chaserSpeedIncreasePerRound to ${gameState.chaserSpeedIncreasePerRound}`);
  }
}

function handleSetItemsEnabled(data) {
  const { enabled } = data;
  if (typeof enabled === "boolean") {
    gameState.itemsEnabled = enabled;
    if (enabled) {
      initItems(); // Initialize items if enabling
    } else {
      gameState.items = []; // Clear items if disabling
    }
    broadcastGameState(); // Broadcast the change
  }
}

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

function kickPlayerFromCharacter(playerId) {
  // Kick a player out of their character (used when they complete 10 rounds)
  const player = gameState.players.get(playerId);
  if (player) {
    // Free up the color
    // Normalize character type for availableColors lookup
    const playerNormalizedTypeForColors =
      player.type === "chasee" || player.type === "pacman"
        ? "fugitive"
        : player.type === "chaser" || player.type === "ghost"
        ? "chaser"
        : player.type;
    const colorList = gameState.availableColors[playerNormalizedTypeForColors];
    if (colorList && !colorList.includes(player.colorIndex)) {
      colorList.push(player.colorIndex);
      colorList.sort();
    }
    // Remove player from controlling the character
    gameState.players.delete(playerId);
    broadcast({ type: "playerLeft", playerId: playerId });
    broadcastGameState();
  }
}

function handleDisconnect(playerId) {
  const player = gameState.players.get(playerId);
  if (player) {
    gameState.availableColors[player.type].push(player.colorIndex);
    gameState.availableColors[player.type].sort();
    gameState.players.delete(playerId);
    broadcast({ type: "playerLeft", playerId: playerId });
    broadcastGameState();
  }
}

function broadcast(message) {
  const data = JSON.stringify(message);
  wss.clients.forEach((client) => {
    if (client.readyState === 1) {
      client.send(data);
    }
  });
}

function sendGameState(ws) {
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

  ws.send(
    JSON.stringify({
      type: "gameState",
      players: players,
      availableColors: {
        fugitive: [...gameState.availableColors.fugitive],
        chaser: [...gameState.availableColors.chaser],
        // Legacy support
        pacman: [...gameState.availableColors.fugitive],
        ghost: [...gameState.availableColors.chaser],
      },
      gameStarted: gameState.gameStarted,
      itemsEnabled: gameState.itemsEnabled,
      items: gameState.itemsEnabled ? gameState.items.map((item) => ({ x: item.x, y: item.y, collected: item.collected })) : [],
      positions: {
        fugitives: gameState.fugitives
          .map((p, index) => {
            // Don't send caught fugitives
            if (gameState.caughtFugitives.has(index)) return null;
            return {
              x: p.x,
              y: p.y,
              px: p.px,
              py: p.py,
              targetX: p.targetX,
              targetY: p.targetY,
              color: p.color,
            };
          })
          .filter((p) => p !== null),
        chasers: gameState.chasers.map((g) => ({
          x: g.x,
          y: g.y,
          px: g.px,
          py: g.py,
          targetX: g.targetX,
          targetY: g.targetY,
          color: g.color,
        })),
        // Legacy support
        pacmen: gameState.fugitives
          .map((p, index) => {
            // Don't send caught fugitives
            if (gameState.caughtFugitives.has(index)) return null;
            return {
              x: p.x,
              y: p.y,
              px: p.px,
              py: p.py,
              targetX: p.targetX,
              targetY: p.targetY,
              color: p.color,
            };
          })
          .filter((p) => p !== null),
        ghosts: gameState.chasers
          .map((g) => {
            if (!g) return null; // Don't send chasers that don't exist yet
            return {
              x: g.x,
              y: g.y,
              px: g.px,
              py: g.py,
              targetX: g.targetX,
              targetY: g.targetY,
              color: g.color,
            };
          })
          .filter((g) => g !== null),
      },
    })
  );
}

function broadcastGameState() {
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

  broadcast({
    type: "gameState",
    players: players,
    availableColors: {
      fugitive: [...gameState.availableColors.fugitive],
      chaser: [...gameState.availableColors.chaser],
      // Legacy support
      pacman: [...gameState.availableColors.fugitive],
      ghost: [...gameState.availableColors.chaser],
    },
    gameStarted: gameState.gameStarted,
    itemsEnabled: gameState.itemsEnabled,
    items: gameState.itemsEnabled ? gameState.items.map((item) => ({ x: item.x, y: item.y, collected: item.collected })) : [],
    positions: {
      fugitives: gameState.fugitives
        .map((p, index) => {
          // Don't send caught fugitives
          if (gameState.caughtFugitives.has(index)) return null;
          return {
            x: p.x,
            y: p.y,
            px: p.px,
            py: p.py,
            targetX: p.targetX,
            targetY: p.targetY,
            color: p.color,
          };
        })
        .filter((p) => p !== null),
      chasers: gameState.chasers
        .map((g) => {
          if (!g) return null; // Don't send chasers that don't exist yet
          return {
            x: g.x,
            y: g.y,
            px: g.px,
            py: g.py,
            targetX: g.targetX,
            targetY: g.targetY,
            color: g.color,
          };
        })
        .filter((g) => g !== null),
      // Legacy support
      pacmen: gameState.fugitives
        .map((p, index) => {
          // Don't send caught fugitives
          if (gameState.caughtFugitives.has(index)) return null;
          return {
            x: p.x,
            y: p.y,
            px: p.px,
            py: p.py,
            targetX: p.targetX,
            targetY: p.targetY,
            color: p.color,
          };
        })
        .filter((p) => p !== null),
      ghosts: gameState.chasers
        .map((g) => {
          if (!g) return null; // Don't send chasers that don't exist yet
          return {
            x: g.x,
            y: g.y,
            px: g.px,
            py: g.py,
            targetX: g.targetX,
            targetY: g.targetY,
            color: g.color,
          };
        })
        .filter((g) => g !== null),
    },
  });
}

// ========== START SERVER ==========
initItems();
initCharacters();
setInterval(gameLoop, 16); // ~60fps game loop

server.listen(PORT, () => {});
