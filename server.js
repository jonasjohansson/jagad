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
    fugitive: [0, 1, 2, 3],
    chaser: [0, 1, 2, 3],
  },
  gameStarted: true, // Game is always running
  aiDifficulty: 0.8,
  // Global speed multipliers for all fugitives and all chasers (default a bit slower)
  fugitiveSpeed: 0.4,
  chaserSpeed: 0.4,
  survivalTimeThreshold: 10, // Seconds required to survive a round (default 10)
  chaserSpeedIncreasePerRound: 0.02, // Speed increase per round (2% = 0.02)
  itemsEnabled: false, // Toggle for yellow dots/items
  fugitives: [],
  chasers: [],
  items: [], // Collectible items on the map { x, y, collected: boolean }
  lastUpdate: Date.now(),
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

  // Initialize chasers in the exact order of chaserSpawnPositions
  // This ensures: index 0 = red (first spawn), 1 = green (second spawn), 2 = blue (third spawn), 3 = yellow (fourth spawn)
  gameState.chasers = chaserSpawnPositions.slice(0, 4).map((pos, i) => {
    // Start chasers at their spawn position without moving initially
    // They will start moving when AI takes over or player provides input
    return {
      x: pos.x,
      y: pos.y,
      px: pos.x * CELL_SIZE + CHARACTER_OFFSET,
      py: pos.y * CELL_SIZE + CHARACTER_OFFSET,
      targetX: pos.x, // Start at spawn position
      targetY: pos.y, // Start at spawn position
      color: COLORS[i], // Color assignment: 0=red, 1=green, 2=blue, 3=yellow
      // Keep chasers at base speed; overridden by global chaserSpeed multiplier
      roundsCompleted: 0, // Track rounds for speed increase
      speedMultiplier: 1.0, // Speed multiplier starts at 1.0, becomes 1.02 after first round (with 2% increase)
      speed: 1.0,
      spawnPos: { ...pos },
      moveTimer: 0,
      lastDirX: 0, // No initial direction
      lastDirY: 0, // No initial direction
      positionHistory: [],
    };
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

// Simple AI for fugitives: choose a direction that tends to increase distance from the same-colored chaser
function moveFugitiveAI(fugitive, index) {
  const chaser = gameState.chasers[index];
  const possibleMoves = getPossibleMoves(fugitive);
  if (possibleMoves.length === 0) return;

  // If there's no corresponding chaser, just pick a random move
  if (!chaser) {
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

  // Choose the move that maximizes distance from this fugitive's matching chaser
  let bestMove = possibleMoves[0];
  let bestDistance = -Infinity;
  const chaserPos = { x: chaser.x, y: chaser.y };

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

  const targetPacman = gameState.fugitives.find((p) => p && p.color === chaser.color);
  const possibleMoves = getPossibleMoves(chaser);
  if (possibleMoves.length === 0) {
    chaser.positionHistory = [];
    return;
  }

  const chosenMove = !targetPacman
    ? possibleMoves[Math.floor(Math.random() * possibleMoves.length)]
    : Math.random() < gameState.aiDifficulty
    ? determineBestMove(chaser, possibleMoves, targetPacman)
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
  gameState.fugitives.forEach((fugitive, fugitiveIndex) => {
    if (!fugitive) return;
    gameState.chasers.forEach((chaser, chaserIndex) => {
      if (!chaser) return;
      if (fugitive.color === chaser.color && fugitive.x === chaser.x && fugitive.y === chaser.y) {
        // Capture happened - end round for both players
        const chaserPlayer = Array.from(gameState.players.entries()).find(
          ([id, p]) => p.type === "chaser" && p.colorIndex === chaserIndex && p.connected
        );
        const fugitivePlayer = Array.from(gameState.players.entries()).find(
          ([id, p]) => p.type === "fugitive" && p.colorIndex === fugitiveIndex && p.connected
        );

        // Update chaser score: add time to catch
        if (chaserPlayer && fugitivePlayer) {
          const [chaserPlayerId, chaserPlayerData] = chaserPlayer;
          const [fugitivePlayerId, fugitivePlayerData] = fugitivePlayer;

          // Calculate capture time (time since round started)
          if (chaserPlayerData.stats.currentRoundStartTime) {
            const captureTime = Date.now() - chaserPlayerData.stats.currentRoundStartTime;
            chaserPlayerData.stats.totalCaptureTime += captureTime;
          }
          // Chaser gets 1 point for each catch
          chaserPlayerData.stats.catches = (chaserPlayerData.stats.catches || 0) + 1;
          chaserPlayerData.stats.chaserScore = chaserPlayerData.stats.catches;

          // Update fugitive score: add items collected this round
          // Note: When caught, fugitive doesn't get survival point, only items
          if (fugitivePlayerData.stats && fugitive.itemsCollected !== undefined) {
            fugitivePlayerData.stats.itemsCollected += fugitive.itemsCollected;
            // Fugitive score = survival points (rounds survived) + items collected
            fugitivePlayerData.stats.fugitiveScore = fugitivePlayerData.stats.rounds + fugitivePlayerData.stats.itemsCollected;
          }
        }

        // End round for both players
        if (chaserPlayer) {
          const [playerId, player] = chaserPlayer;
          player.stats.rounds++;

          // Increase chaser speed by configurable percentage per round
          const chaser = gameState.chasers[chaserIndex];
          if (chaser) {
            chaser.roundsCompleted = (chaser.roundsCompleted || 0) + 1;
            // Speed multiplier: 1.0 + (roundsCompleted * chaserSpeedIncreasePerRound)
            // After first round: 1.0 + 1 * 0.02 = 1.02 (2% faster)
            // This multiplies the base chaserSpeed (0.4), so final speed = 0.4 * 1.02 = 0.408
            chaser.speedMultiplier = 1.0 + chaser.roundsCompleted * gameState.chaserSpeedIncreasePerRound;
            console.log(
              `[SPEED] Chaser ${chaserIndex} (${chaser.color}) - CATCH: roundsCompleted=${chaser.roundsCompleted}, increasePerRound=${
                gameState.chaserSpeedIncreasePerRound
              }, multiplier=${chaser.speedMultiplier.toFixed(2)}, baseSpeed=${gameState.chaserSpeed}, finalSpeed=${(
                gameState.chaserSpeed * chaser.speedMultiplier
              ).toFixed(3)}`
            );
          }

          // Send round end flash event to both players
          if (chaserPlayer) {
            const [chaserPlayerId, chaserPlayerData] = chaserPlayer;
            chaserPlayerData.ws.send(
              JSON.stringify({
                type: "roundEnd",
                chaserColorIndex: chaserIndex,
                fugitiveColorIndex: fugitiveIndex,
              })
            );
          }
          if (fugitivePlayer) {
            const [fugitivePlayerId, fugitivePlayerData] = fugitivePlayer;
            fugitivePlayerData.ws.send(
              JSON.stringify({
                type: "roundEnd",
                chaserColorIndex: chaserIndex,
                fugitiveColorIndex: fugitiveIndex,
              })
            );
          }

          if (player.stats.rounds >= 10) {
            player.stats.currentRoundStartTime = null;
            player.ws.send(
              JSON.stringify({
                type: "roundsComplete",
                chaserScore: player.stats.chaserScore,
                fugitiveScore: player.stats.fugitiveScore || 0,
                totalRounds: player.stats.rounds,
              })
            );
            kickPlayerFromCharacter(playerId);
          } else {
            // Start new round
            player.stats.currentRoundStartTime = Date.now();
          }
        }

        if (fugitivePlayer) {
          const [playerId, player] = fugitivePlayer;
          player.stats.rounds++;

          if (player.stats.rounds >= 10) {
            player.stats.currentRoundStartTime = null;
            player.ws.send(
              JSON.stringify({
                type: "roundsComplete",
                chaserScore: player.stats.chaserScore || 0,
                fugitiveScore: player.stats.fugitiveScore,
                totalRounds: player.stats.rounds,
              })
            );
            kickPlayerFromCharacter(playerId);
          } else {
            // Start new round
            player.stats.currentRoundStartTime = Date.now();
          }
        }

        // Reset survival tracking and items for new round
        fugitive.survivalStartTime = Date.now();
        fugitive.lastSurvivalPointTime = null;
        fugitive.itemsCollected = 0;
        // Respawn all items for new round (only if items are enabled)
        if (gameState.itemsEnabled) {
          gameState.items.forEach((item) => (item.collected = false));
        }

        respawnCharacter(fugitive, fugitive.spawnPos);
        // Log before respawn to verify multiplier is set
        if (chaser) {
          console.log(
            `[SPEED] BEFORE RESPAWN: chaser.roundsCompleted=${chaser.roundsCompleted}, chaser.speedMultiplier=${chaser.speedMultiplier}`
          );
        }
        respawnChaser(chaser, chaser.spawnPos);
        // Log after respawn to verify multiplier is preserved
        if (chaser) {
          console.log(
            `[SPEED] AFTER RESPAWN: chaser.roundsCompleted=${chaser.roundsCompleted}, chaser.speedMultiplier=${chaser.speedMultiplier}`
          );
        }
      }
    });
  });
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

  // Move fugitives (always, even before game starts)
  gameState.fugitives.forEach((pacman, index) => {
    if (!pacman) return;

    const isPlayerControlledPacman = Array.from(gameState.players.values()).some(
      (p) => (p.type === "fugitive" || p.type === "pacman") && p.colorIndex === index && p.connected
    );

    // Initialize round tracking when player joins
    if (isPlayerControlledPacman) {
      const pacmanPlayer = Array.from(gameState.players.entries()).find(
        ([id, p]) => (p.type === "fugitive" || p.type === "pacman") && p.colorIndex === index && p.connected
      );
      if (pacmanPlayer) {
        const [playerId, player] = pacmanPlayer;
        // Initialize round start time if not set
        if (!player.stats.currentRoundStartTime) {
          player.stats.currentRoundStartTime = Date.now();
          pacman.survivalStartTime = Date.now();
          pacman.itemsCollected = 0;
        }

        // Check if survival time threshold has passed (round ends at threshold OR capture)
        if (player.stats.currentRoundStartTime) {
          const roundTime = (Date.now() - player.stats.currentRoundStartTime) / 1000;
          // Log every second to see if time is progressing
          if (Math.floor(roundTime) !== (pacman.lastLoggedSecond || -1)) {
            pacman.lastLoggedSecond = Math.floor(roundTime);
            if (roundTime < gameState.survivalTimeThreshold) {
              console.log(
                `[ROUND] Fugitive ${index} (${pacman.color}) round time: ${roundTime.toFixed(1)}s / ${gameState.survivalTimeThreshold}s`
              );
            }
          }
          if (roundTime >= gameState.survivalTimeThreshold) {
            console.log(
              `[ROUND] Fugitive ${index} (${pacman.color}) survived ${roundTime.toFixed(1)}s (threshold: ${
                gameState.survivalTimeThreshold
              }s) - ROUND ENDING`
            );
            // Round ended by time - fugitive survived
            // Award point for surviving the round + items collected this round
            player.stats.itemsCollected += pacman.itemsCollected || 0;
            // Fugitive score = survival points (1 per round survived) + items collected
            player.stats.fugitiveScore = player.stats.rounds + 1 + player.stats.itemsCollected;
            player.stats.rounds++;

            // Find matching chaser for flash effect and speed increase
            const matchingChaser = gameState.chasers.find((c) => c && c.color === pacman.color);
            const chaserIndex = matchingChaser ? gameState.chasers.indexOf(matchingChaser) : -1;
            const fugitiveIndex = index;

            // Increase chaser speed when fugitive survives (round ends by time)
            if (chaserIndex >= 0 && matchingChaser) {
              const oldRounds = matchingChaser.roundsCompleted || 0;
              matchingChaser.roundsCompleted = oldRounds + 1;
              matchingChaser.speedMultiplier = 1.0 + matchingChaser.roundsCompleted * gameState.chaserSpeedIncreasePerRound;
              console.log(
                `[SPEED] Chaser ${chaserIndex} (${matchingChaser.color}) - FUGITIVE SURVIVED: oldRounds=${oldRounds}, newRounds=${
                  matchingChaser.roundsCompleted
                }, increasePerRound=${gameState.chaserSpeedIncreasePerRound}, multiplier=${matchingChaser.speedMultiplier.toFixed(
                  2
                )}, baseSpeed=${gameState.chaserSpeed}, finalSpeed=${(gameState.chaserSpeed * matchingChaser.speedMultiplier).toFixed(3)}`
              );
              // Verify the multiplier is set BEFORE respawn
              console.log(
                `[SPEED] BEFORE RESPAWN: chaser.roundsCompleted=${matchingChaser.roundsCompleted}, chaser.speedMultiplier=${matchingChaser.speedMultiplier}`
              );
            } else {
              console.log(
                `[SPEED] WARNING: Could not find matching chaser for fugitive ${index} (${pacman.color}), chaserIndex=${chaserIndex}`
              );
            }

            // Send round end flash event
            player.ws.send(
              JSON.stringify({
                type: "roundEnd",
                chaserColorIndex: chaserIndex,
                fugitiveColorIndex: fugitiveIndex,
              })
            );

            // Also send to matching chaser if they exist
            if (chaserIndex >= 0) {
              const chaserPlayer = Array.from(gameState.players.entries()).find(
                ([id, p]) => p.type === "chaser" && p.colorIndex === chaserIndex && p.connected
              );
              if (chaserPlayer) {
                const [chaserPlayerId, chaserPlayerData] = chaserPlayer;
                chaserPlayerData.ws.send(
                  JSON.stringify({
                    type: "roundEnd",
                    chaserColorIndex: chaserIndex,
                    fugitiveColorIndex: fugitiveIndex,
                  })
                );
              }
            }

            // Check if player completed 10 rounds
            if (player.stats.rounds >= 10) {
              player.stats.currentRoundStartTime = null;
              player.ws.send(
                JSON.stringify({
                  type: "roundsComplete",
                  chaserScore: player.stats.chaserScore || 0,
                  fugitiveScore: player.stats.fugitiveScore,
                  totalRounds: player.stats.rounds,
                })
              );
              kickPlayerFromCharacter(playerId);
            } else {
              // Start new round
              player.stats.currentRoundStartTime = Date.now();
              pacman.survivalStartTime = Date.now();
              pacman.itemsCollected = 0;
              // Respawn all items for new round (only if items are enabled)
              if (gameState.itemsEnabled) {
                gameState.items.forEach((item) => (item.collected = false));
              }
            }
          }
        }
      }
    }

    // Also check for chaser (ghost) survival time threshold rounds
    const isPlayerControlledGhost = Array.from(gameState.players.values()).some(
      (p) => p.type === "ghost" && p.colorIndex === index && p.connected
    );
    if (isPlayerControlledGhost) {
      const ghostPlayer = Array.from(gameState.players.entries()).find(
        ([id, p]) => p.type === "ghost" && p.colorIndex === index && p.connected
      );
      if (ghostPlayer) {
        const [playerId, player] = ghostPlayer;
        if (player.stats.currentRoundStartTime) {
          const roundTime = (Date.now() - player.stats.currentRoundStartTime) / 1000;
          if (roundTime >= gameState.survivalTimeThreshold) {
            // Round ended by time - fugitive survived, chaser didn't catch
            // Chaser gets penalty (add survival threshold time to total time)
            player.stats.totalCaptureTime += gameState.survivalTimeThreshold * 1000;
            // Chaser score is number of catches (no point added for this round)
            player.stats.chaserScore = player.stats.catches || 0;
            player.stats.rounds++;

            // Increase chaser speed for next round
            const chaser = gameState.chasers[index];
            if (chaser) {
              chaser.roundsCompleted = (chaser.roundsCompleted || 0) + 1;
              // Speed multiplier: 1.0 + (roundsCompleted * chaserSpeedIncreasePerRound)
              // After first round: 1.0 + 1 * 0.02 = 1.02 (2% faster)
              chaser.speedMultiplier = 1.0 + chaser.roundsCompleted * gameState.chaserSpeedIncreasePerRound;
              console.log(
                `[SPEED] Chaser ${index} (${chaser.color}) - TIME END: roundsCompleted=${chaser.roundsCompleted}, increasePerRound=${
                  gameState.chaserSpeedIncreasePerRound
                }, multiplier=${chaser.speedMultiplier.toFixed(2)}, baseSpeed=${gameState.chaserSpeed}, finalSpeed=${(
                  gameState.chaserSpeed * chaser.speedMultiplier
                ).toFixed(3)}`
              );
            }

            // Find matching fugitive for flash effect
            const matchingFugitive = gameState.fugitives.find((f) => f && f.color === chaser.color);
            const fugitiveIndex = matchingFugitive ? gameState.fugitives.indexOf(matchingFugitive) : -1;
            const chaserIndex = index;

            // Send round end flash event
            player.ws.send(
              JSON.stringify({
                type: "roundEnd",
                chaserColorIndex: chaserIndex,
                fugitiveColorIndex: fugitiveIndex,
              })
            );

            // Also send to matching fugitive if they exist
            if (fugitiveIndex >= 0) {
              const fugitivePlayer = Array.from(gameState.players.entries()).find(
                ([id, p]) => p.type === "fugitive" && p.colorIndex === fugitiveIndex && p.connected
              );
              if (fugitivePlayer) {
                const [fugitivePlayerId, fugitivePlayerData] = fugitivePlayer;
                fugitivePlayerData.ws.send(
                  JSON.stringify({
                    type: "roundEnd",
                    chaserColorIndex: chaserIndex,
                    fugitiveColorIndex: fugitiveIndex,
                  })
                );
              }
            }

            // Check if player completed 10 rounds
            if (player.stats.rounds >= 10) {
              player.stats.currentRoundStartTime = null;
              player.ws.send(
                JSON.stringify({
                  type: "roundsComplete",
                  chaserScore: player.stats.chaserScore,
                  fugitiveScore: player.stats.fugitiveScore || 0,
                  totalRounds: player.stats.rounds,
                })
              );
              kickPlayerFromCharacter(playerId);
            } else {
              // Start new round
              player.stats.currentRoundStartTime = Date.now();
            }
          }
        }
      }
    }

    // Check for item collection (fugitives collect items) - only if items are enabled
    if (gameState.itemsEnabled && isPlayerControlledPacman) {
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
      if (!gameState.gameStarted || isPlayerControlledPacman) {
        // Human-controlled or pre-start pacmen: Pacman-style continuous movement.
        // When we reach the center of a tile, first try to turn to the desired direction,
        // otherwise continue straight in the current direction until a wall.
        let usedDesired = false;

        // Try to apply queued direction first (allows buffered turns)
        if (pacman.nextDirX || pacman.nextDirY) {
          const desiredX = pacman.x + pacman.nextDirX;
          const desiredY = pacman.y + pacman.nextDirY;
          if (desiredX >= 0 && desiredX < COLS && desiredY >= 0 && desiredY < ROWS && isPath(desiredX, desiredY)) {
            pacman.dirX = pacman.nextDirX;
            pacman.dirY = pacman.nextDirY;
            pacman.targetX = desiredX;
            pacman.targetY = desiredY;
            usedDesired = true;
          }
        }

        // If desired direction isn't possible, try to continue straight
        if (!usedDesired && (pacman.dirX || pacman.dirY)) {
          const forwardX = pacman.x + pacman.dirX;
          const forwardY = pacman.y + pacman.dirY;
          if (forwardX >= 0 && forwardX < COLS && forwardY >= 0 && forwardY < ROWS && isPath(forwardX, forwardY)) {
            pacman.targetX = forwardX;
            pacman.targetY = forwardY;
          } else {
            // Hit a wall; stop until a new valid direction is given
            pacman.dirX = 0;
            pacman.dirY = 0;
          }
        }
      } else {
        // Game started and this pacman is NOT player-controlled: let AI move it
        moveFugitiveAI(pacman, index);
      }
    }
  });

  // Chaser movement, survival, and collisions
  gameState.chasers.forEach((chaser, index) => {
    if (!chaser) return;
    const isPlayerControlled = Array.from(gameState.players.values()).some(
      (p) => (p.type === "chaser" || p.type === "ghost") && p.colorIndex === index && p.connected
    );

    // All chasers move with global chaser speed, multiplied by rounds completed
    const speedMultiplier = chaser.speedMultiplier || 1.0;
    const finalSpeed = gameState.chaserSpeed * speedMultiplier;
    // Debug log (only log occasionally to avoid spam)
    if (Math.random() < 0.001) {
      // Log ~0.1% of the time
      console.log(
        `[SPEED] Chaser ${index} (${chaser.color}) moving: roundsCompleted=${chaser.roundsCompleted || 0}, increasePerRound=${
          gameState.chaserSpeedIncreasePerRound
        }, multiplier=${speedMultiplier.toFixed(2)}, baseSpeed=${gameState.chaserSpeed}, finalSpeed=${finalSpeed.toFixed(3)}`
      );
    }
    moveCharacter(chaser, finalSpeed);

    if (!isAtTarget(chaser)) {
      return;
    }

    // At tile center: human-controlled chasers use continuous movement like fugitives,
    // others use existing chaser AI (only when the game is started).
    if (isPlayerControlled) {
      let usedDesired = false;

      if (chaser.nextDirX || chaser.nextDirY) {
        const desiredX = chaser.x + chaser.nextDirX;
        const desiredY = chaser.y + chaser.nextDirY;
        if (desiredX >= 0 && desiredX < COLS && desiredY >= 0 && desiredY < ROWS && isPath(desiredX, desiredY)) {
          chaser.dirX = chaser.nextDirX;
          chaser.dirY = chaser.nextDirY;
          chaser.targetX = desiredX;
          chaser.targetY = desiredY;
          usedDesired = true;
        }
      }

      if (!usedDesired && (chaser.dirX || chaser.dirY)) {
        const forwardX = chaser.x + chaser.dirX;
        const forwardY = chaser.y + chaser.dirY;
        if (forwardX >= 0 && forwardX < COLS && forwardY >= 0 && forwardY < ROWS && isPath(forwardX, forwardY)) {
          chaser.targetX = forwardX;
          chaser.targetY = forwardY;
        } else {
          chaser.dirX = 0;
          chaser.dirY = 0;
        }
      }
    } else if (gameState.gameStarted) {
      // AI chasers only move with intelligence when the game has started
      chaser.x = chaser.targetX;
      chaser.y = chaser.targetY;
      if ((chaser.lastDirX === 0 && chaser.lastDirY === 0) || (chaser.targetX === chaser.x && chaser.targetY === chaser.y)) {
        moveChaserAI(chaser);
      } else {
        chaser.moveTimer += deltaTime;
        const moveInterval = Math.max(50, 300 - gameState.aiDifficulty * 250);
        if (chaser.moveTimer >= moveInterval) {
          chaser.moveTimer = 0;
          moveChaserAI(chaser);
        } else {
          const prevTargetX = chaser.targetX;
          const prevTargetY = chaser.targetY;
          continueInCurrentDirection(chaser);
          if (chaser.targetX === prevTargetX && chaser.targetY === prevTargetY) {
            moveChaserAI(chaser);
          }
        }
      }
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
          gameState.gameStarted = true;
          // Initialize survival tracking for all player-controlled pacmen
          gameState.players.forEach((player, playerId) => {
            if (player.connected && (player.type === "fugitive" || player.type === "pacman") && gameState.fugitives[player.colorIndex]) {
              const pacman = gameState.fugitives[player.colorIndex];
              pacman.survivalStartTime = Date.now();
              pacman.lastSurvivalPointTime = null;
              if (player.stats) {
                player.stats.currentRoundStartTime = Date.now();
              }
            }
          });
          // Force ghosts to get new directions immediately
          gameState.chasers.forEach((ghost) => {
            if (ghost && isAtTarget(ghost)) {
              moveChaserAI(ghost);
            }
          });
          broadcast({ type: "gameStarted" });
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

  // Normalize character type for availableColors lookup
  const normalizedTypeForColors =
    characterType === "chasee" || characterType === "pacman"
      ? "fugitive"
      : characterType === "chaser" || characterType === "ghost"
      ? "chaser"
      : characterType;
  const availableColors = gameState.availableColors[normalizedTypeForColors];
  if (!availableColors || !availableColors.includes(colorIndex)) {
    ws.send(JSON.stringify({ type: "joinFailed", reason: "Color already taken" }));
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
  const isFugitive = characterType === "fugitive" || characterType === "pacman";
  const isChaser = characterType === "chaser" || characterType === "ghost";
  const normalizedType = isFugitive ? "fugitive" : isChaser ? "chaser" : characterType;

  gameState.players.set(playerId, {
    type: normalizedType,
    colorIndex: colorIndex,
    connected: true,
    ws: ws,
    pendingInput: null,
    stats: playerStats,
    playerName: playerName, // 3-letter initials
  });

  // Start a new round when joining
  playerStats.currentRoundStartTime = Date.now();

  // Move character to starting position and reset tracking
  if (isFugitive && gameState.fugitives[colorIndex]) {
    const fugitive = gameState.fugitives[colorIndex];
    respawnCharacter(fugitive, fugitive.spawnPos);
    fugitive.survivalStartTime = Date.now();
    fugitive.lastSurvivalPointTime = null;
    fugitive.itemsCollected = 0;
  } else if (isChaser && gameState.chasers[colorIndex]) {
    const chaser = gameState.chasers[colorIndex];
    respawnChaser(chaser, chaser.spawnPos);
    chaser.positionHistory = [];
    chaser.roundsCompleted = 0;
    chaser.speedMultiplier = 1.0;
  }

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
        fugitives: gameState.fugitives.map((p) => ({
          x: p.x,
          y: p.y,
          px: p.px,
          py: p.py,
          targetX: p.targetX,
          targetY: p.targetY,
          color: p.color,
        })),
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
        pacmen: gameState.fugitives.map((p) => ({
          x: p.x,
          y: p.y,
          px: p.px,
          py: p.py,
          targetX: p.targetX,
          targetY: p.targetY,
          color: p.color,
        })),
        ghosts: gameState.chasers.map((g) => ({
          x: g.x,
          y: g.y,
          px: g.px,
          py: g.py,
          targetX: g.targetX,
          targetY: g.targetY,
          color: g.color,
        })),
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
      fugitives: gameState.fugitives.map((p) => ({
        x: p.x,
        y: p.y,
        px: p.px,
        py: p.py,
        targetX: p.targetX,
        targetY: p.targetY,
        color: p.color,
      })),
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
      pacmen: gameState.fugitives.map((p) => ({
        x: p.x,
        y: p.y,
        px: p.px,
        py: p.py,
        targetX: p.targetX,
        targetY: p.targetY,
        color: p.color,
      })),
      ghosts: gameState.chasers.map((g) => ({
        x: g.x,
        y: g.y,
        px: g.px,
        py: g.py,
        targetX: g.targetX,
        targetY: g.targetY,
        color: g.color,
      })),
    },
  });
}

// ========== START SERVER ==========
initItems();
initCharacters();
setInterval(gameLoop, 16); // ~60fps game loop

server.listen(PORT, () => {});
