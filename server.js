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
const ghostSpawnPositions = [];
for (let y = 0; y < ROWS; y++) {
  for (let x = 0; x < COLS; x++) {
    if (MAP[y][x] === 2) teleportPositions.push({ x, y });
    if (MAP[y][x] === 3) ghostSpawnPositions.push({ x, y });
  }
}
const pacmanSpawnPositions = [
  { x: 1, y: 1 },
  { x: 30, y: 1 },
  { x: 1, y: 14 },
  { x: 30, y: 14 },
];

// ========== GAME STATE ==========
const gameState = {
  players: new Map(), // playerId -> { type, colorIndex, connected, ws, pendingInput }
  nextPlayerId: 0,
  availableColors: {
    pacman: [0, 1, 2, 3],
    ghost: [0, 1, 2, 3],
  },
  gameStarted: false,
  aiDifficulty: 0.8,
  // Global speed multipliers for all pacmen and all ghosts (default a bit slower)
  pacmanSpeed: 0.4,
  ghostSpeed: 0.4,
  pacmen: [],
  ghosts: [],
  lastUpdate: Date.now(),
};

// Debug counters
let debugTickCounter = 0;

function isPacmanPlayerControlled(index) {
  return Array.from(gameState.players.values()).some((p) => p.type === "pacman" && p.colorIndex === index && p.connected);
}

// Initialize lastUpdate
gameState.lastUpdate = Date.now();

// Initialize characters
function initCharacters() {
  gameState.pacmen = pacmanSpawnPositions.map((pos, i) => ({
    x: pos.x,
    y: pos.y,
    px: pos.x * CELL_SIZE + CHARACTER_OFFSET,
    py: pos.y * CELL_SIZE + CHARACTER_OFFSET,
    targetX: pos.x,
    targetY: pos.y,
    color: COLORS[i],
    // Default pacman speed (kept in sync with global pacmanSpeed)
    speed: 1.0,
    spawnPos: { ...pos },
    // Direction-based movement: current direction the pacman is actually moving
    dirX: 0,
    dirY: 0,
    // Queued direction from the last input (may be applied at the next junction)
    nextDirX: 0,
    nextDirY: 0,
    lastDirX: 0,
    lastDirY: 0,
    positionHistory: [],
  }));

  gameState.ghosts = ghostSpawnPositions.slice(0, 4).map((pos, i) => {
    // Find initial direction
    let initialTargetX = pos.x;
    let initialTargetY = pos.y;
    let initialDirX = 0;
    let initialDirY = 0;
    for (const dir of DIRECTIONS) {
      const newX = pos.x + dir.x;
      const newY = pos.y + dir.y;
      if (isPath(newX, newY)) {
        initialTargetX = newX;
        initialTargetY = newY;
        initialDirX = dir.x;
        initialDirY = dir.y;
        break;
      }
    }
    return {
      x: pos.x,
      y: pos.y,
      px: pos.x * CELL_SIZE + CHARACTER_OFFSET,
      py: pos.y * CELL_SIZE + CHARACTER_OFFSET,
      targetX: initialTargetX,
      targetY: initialTargetY,
      color: COLORS[i],
      // Keep ghosts at base speed; overridden by global ghostSpeed multiplier
      speed: 1.0,
      spawnPos: { ...pos },
      moveTimer: 0,
      lastDirX: initialDirX,
      lastDirY: initialDirY,
      positionHistory: [],
    };
  });
}

// ========== GAME LOGIC FUNCTIONS ==========
function isPath(x, y) {
  if (x < 0 || x >= COLS || y < 0 || y >= ROWS) return false;
  const cell = MAP[y][x];
  return cell === 0 || cell === 2 || cell === 3;
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

function getPossibleMoves(ghost) {
  const possibleMoves = [];
  const currentX = ghost.x;
  const currentY = ghost.y;

  DIRECTIONS.forEach(({ dir, x: dx, y: dy }) => {
    const newX = currentX + dx;
    const newY = currentY + dy;
    // No manual wrap-around here; we rely on teleport tiles (MAP === 2) and teleportCharacter()
    if (newX >= 0 && newX < COLS && newY >= 0 && newY < ROWS && isPath(newX, newY)) {
      possibleMoves.push({ dir, x: dx, y: dy, newX, newY });
    }
  });

  let currentDir = null;
  if (ghost.x === ghost.targetX && ghost.y === ghost.targetY) {
    if (ghost.lastDirX === 0 && ghost.lastDirY === -1) currentDir = "up";
    else if (ghost.lastDirX === 0 && ghost.lastDirY === 1) currentDir = "down";
    else if (ghost.lastDirX === -1 && ghost.lastDirY === 0) currentDir = "left";
    else if (ghost.lastDirX === 1 && ghost.lastDirY === 0) currentDir = "right";
  } else {
    const dx = ghost.targetX - ghost.x;
    const dy = ghost.targetY - ghost.y;
    if (Math.abs(dx) > Math.abs(dy)) {
      currentDir = dx > 0 ? "right" : "left";
    } else if (dy !== 0) {
      currentDir = dy > 0 ? "down" : "up";
    }
  }

  let filteredMoves = possibleMoves.filter((move) => !currentDir || move.dir !== OPPOSITE_DIR[currentDir]);
  if (filteredMoves.length === 0) filteredMoves = possibleMoves;

  if (ghost.positionHistory?.length > 0) {
    const recentPositions = ghost.positionHistory.slice(-4);
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

function determineBestMove(ghost, possibleMoves, targetPacman) {
  if (!targetPacman || possibleMoves.length === 0) return possibleMoves[0];
  let bestMove = null;
  let bestScore = -Infinity;
  const targetPos = { x: targetPacman.x, y: targetPacman.y };

  possibleMoves.forEach((move) => {
    const movePos = { x: move.newX, y: move.newY };
    const distance = calculateDistanceWithWrap(movePos, targetPos);
    let score = -distance;
    if (ghost.lastDirX === move.x && ghost.lastDirY === move.y) score += 0.5;
    if (ghost.positionHistory) {
      const recentPositions = ghost.positionHistory.slice(-2);
      const isRecent = recentPositions.some((pos) => pos.x === move.newX && pos.y === move.newY);
      if (isRecent) score -= 2.0;
    }
    const currentDistance = calculateDistanceWithWrap({ x: ghost.x, y: ghost.y }, targetPos);
    if (distance < currentDistance) score += 1.0;
    if (score > bestScore) {
      bestScore = score;
      bestMove = move;
    }
  });

  return bestMove || possibleMoves[0];
}

// Simple AI for pacmen: choose a direction that tends to increase distance from the same-colored ghost
function movePacmanAI(pacman, index) {
  const ghost = gameState.ghosts[index];
  const possibleMoves = getPossibleMoves(pacman);
  if (possibleMoves.length === 0) return;

  // If there's no corresponding ghost, just pick a random move
  if (!ghost) {
    const move = possibleMoves[Math.floor(Math.random() * possibleMoves.length)];
    if (move) {
      pacman.targetX = move.newX;
      pacman.targetY = move.newY;
      pacman.dirX = move.x;
      pacman.dirY = move.y;
      pacman.lastDirX = move.x;
      pacman.lastDirY = move.y;
    }
    return;
  }

  // Choose the move that maximizes distance from this pacman's matching ghost
  let bestMove = possibleMoves[0];
  let bestDistance = -Infinity;
  const ghostPos = { x: ghost.x, y: ghost.y };

  possibleMoves.forEach((move) => {
    const movePos = { x: move.newX, y: move.newY };
    const distance = calculateDistanceWithWrap(movePos, ghostPos);
    if (distance > bestDistance) {
      bestDistance = distance;
      bestMove = move;
    }
  });

  if (bestMove) {
    pacman.targetX = bestMove.newX;
    pacman.targetY = bestMove.newY;
    pacman.dirX = bestMove.x;
    pacman.dirY = bestMove.y;
    pacman.lastDirX = bestMove.x;
    pacman.lastDirY = bestMove.y;
  }
}

function moveGhostAI(ghost) {
  ghost.x = ghost.targetX;
  ghost.y = ghost.targetY;
  if (!ghost.positionHistory) ghost.positionHistory = [];
  ghost.positionHistory.push({ x: ghost.x, y: ghost.y });
  if (ghost.positionHistory.length > 6) ghost.positionHistory.shift();

  const targetPacman = gameState.pacmen.find((p) => p && p.color === ghost.color);
  const possibleMoves = getPossibleMoves(ghost);
  if (possibleMoves.length === 0) {
    ghost.positionHistory = [];
    return;
  }

  const chosenMove = !targetPacman
    ? possibleMoves[Math.floor(Math.random() * possibleMoves.length)]
    : Math.random() < gameState.aiDifficulty
    ? determineBestMove(ghost, possibleMoves, targetPacman)
    : (() => {
        const nonRecentMoves = possibleMoves.filter((move) => {
          if (!ghost.positionHistory?.length) return true;
          const recent = ghost.positionHistory.slice(-2);
          return !recent.some((pos) => pos.x === move.newX && pos.y === move.newY);
        });
        return nonRecentMoves.length > 0
          ? nonRecentMoves[Math.floor(Math.random() * nonRecentMoves.length)]
          : possibleMoves[Math.floor(Math.random() * possibleMoves.length)];
      })();

  if (chosenMove) {
    ghost.targetX = chosenMove.newX;
    ghost.targetY = chosenMove.newY;
    ghost.lastDirX = chosenMove.x;
    ghost.lastDirY = chosenMove.y;
  }
}

function continueInCurrentDirection(ghost) {
  const newX = ghost.targetX + ghost.lastDirX;
  const newY = ghost.targetY + ghost.lastDirY;
  // No manual wrap-around; tunnel behavior is handled via teleport tiles
  if (newX >= 0 && newX < COLS && newY >= 0 && newY < ROWS && isPath(newX, newY)) {
    ghost.targetX = newX;
    ghost.targetY = newY;
    return;
  }
  moveGhostAI(ghost);
}

function checkCollisions() {
  gameState.pacmen.forEach((pacman) => {
    if (!pacman) return;
    gameState.ghosts.forEach((ghost) => {
      if (!ghost) return;
      if (pacman.color === ghost.color && pacman.x === ghost.x && pacman.y === ghost.y) {
        respawnCharacter(pacman, pacman.spawnPos);
        respawnGhost(ghost, ghost.spawnPos);
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

function respawnGhost(ghost, spawnPos) {
  respawnCharacter(ghost, spawnPos);
  ghost.moveTimer = 0;
  ghost.positionHistory = [];
  ghost.lastDirX = 0;
  ghost.lastDirY = 0;
  ghost.survivalTime = 0;
  ghost.lastSurvivalPoint = 0;
  for (const dir of DIRECTIONS) {
    const newX = spawnPos.x + dir.x;
    const newY = spawnPos.y + dir.y;
    if (isPath(newX, newY)) {
      ghost.targetX = newX;
      ghost.targetY = newY;
      ghost.lastDirX = dir.x;
      ghost.lastDirY = dir.y;
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

    if (player.type === "pacman") {
      const pacman = gameState.pacmen[player.colorIndex];
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
    } else if (player.type === "ghost") {
      const ghost = gameState.ghosts[player.colorIndex];
      if (!ghost) return;

      // Direction-based input for ghosts, same continuous style as pacmen
      if (input.dir) {
        const dirDef = DIRECTIONS.find((d) => d.dir === input.dir);
        if (!dirDef) return;
        const dx = dirDef.x;
        const dy = dirDef.y;

        // Store desired direction; applied at next tile center
        ghost.nextDirX = dx;
        ghost.nextDirY = dy;

        // If currently stopped, try to start immediately
        if (!ghost.dirX && !ghost.dirY) {
          const startX = ghost.x + dx;
          const startY = ghost.y + dy;
          if (startX >= 0 && startX < COLS && startY >= 0 && startY < ROWS && isPath(startX, startY)) {
            ghost.dirX = dx;
            ghost.dirY = dy;
            ghost.targetX = startX;
            ghost.targetY = startY;
          }
        }
      }
    }
  });

  // Move pacmen (always, even before game starts)
  gameState.pacmen.forEach((pacman, index) => {
    if (!pacman) return;

    const isPlayerControlledPacman = isPacmanPlayerControlled(index);

    // Move pacman toward its current target using global pacman speed
    moveCharacter(pacman, gameState.pacmanSpeed);

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
        movePacmanAI(pacman, index);
      }
    }
  });

  // Ghost movement, survival, and collisions
  gameState.ghosts.forEach((ghost, index) => {
    if (!ghost) return;
    const isPlayerControlled = Array.from(gameState.players.values()).some(
      (p) => p.type === "ghost" && p.colorIndex === index && p.connected
    );

    // All ghosts move with global ghost speed
    moveCharacter(ghost, gameState.ghostSpeed);

    if (!isAtTarget(ghost)) {
      return;
    }

    // At tile center: human-controlled ghosts use continuous movement like pacman,
    // others use existing ghost AI (only when the game is started).
    if (isPlayerControlled) {
      let usedDesired = false;

      if (ghost.nextDirX || ghost.nextDirY) {
        const desiredX = ghost.x + ghost.nextDirX;
        const desiredY = ghost.y + ghost.nextDirY;
        if (desiredX >= 0 && desiredX < COLS && desiredY >= 0 && desiredY < ROWS && isPath(desiredX, desiredY)) {
          ghost.dirX = ghost.nextDirX;
          ghost.dirY = ghost.nextDirY;
          ghost.targetX = desiredX;
          ghost.targetY = desiredY;
          usedDesired = true;
        }
      }

      if (!usedDesired && (ghost.dirX || ghost.dirY)) {
        const forwardX = ghost.x + ghost.dirX;
        const forwardY = ghost.y + ghost.dirY;
        if (forwardX >= 0 && forwardX < COLS && forwardY >= 0 && forwardY < ROWS && isPath(forwardX, forwardY)) {
          ghost.targetX = forwardX;
          ghost.targetY = forwardY;
        } else {
          ghost.dirX = 0;
          ghost.dirY = 0;
        }
      }
    } else if (gameState.gameStarted) {
      // AI ghosts only move with intelligence when the game has started
      ghost.x = ghost.targetX;
      ghost.y = ghost.targetY;
      if ((ghost.lastDirX === 0 && ghost.lastDirY === 0) || (ghost.targetX === ghost.x && ghost.targetY === ghost.y)) {
        moveGhostAI(ghost);
      } else {
        ghost.moveTimer += deltaTime;
        const moveInterval = Math.max(50, 300 - gameState.aiDifficulty * 250);
        if (ghost.moveTimer >= moveInterval) {
          ghost.moveTimer = 0;
          moveGhostAI(ghost);
        } else {
          const prevTargetX = ghost.targetX;
          const prevTargetY = ghost.targetY;
          continueInCurrentDirection(ghost);
          if (ghost.targetX === prevTargetX && ghost.targetY === prevTargetY) {
            moveGhostAI(ghost);
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
        case "startGame":
          gameState.gameStarted = true;
          // Force ghosts to get new directions immediately
          gameState.ghosts.forEach((ghost) => {
            if (ghost && isAtTarget(ghost)) {
              moveGhostAI(ghost);
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
    } catch (error) {
    }
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

  const availableColors = gameState.availableColors[characterType];
  if (!availableColors || !availableColors.includes(colorIndex)) {
    ws.send(JSON.stringify({ type: "joinFailed", reason: "Color already taken" }));
    return;
  }

  // If this player was already controlling a character, free up their old color now that the new join is valid
  const existing = gameState.players.get(playerId);
  if (existing) {
    const prevList = gameState.availableColors[existing.type];
    if (prevList && !prevList.includes(existing.colorIndex)) {
      prevList.push(existing.colorIndex);
      prevList.sort();
    }
  }

  gameState.players.set(playerId, {
    type: characterType,
    colorIndex: colorIndex,
    connected: true,
    ws: ws,
    pendingInput: null,
  });

  const colorIdx = availableColors.indexOf(colorIndex);
  if (colorIdx > -1) {
    availableColors.splice(colorIdx, 1);
  }

  // If joining as a ghost, clear any AI state to stop AI control immediately
  if (characterType === "ghost" && gameState.ghosts[colorIndex]) {
    const ghost = gameState.ghosts[colorIndex];
    ghost.positionHistory = [];
  }

  ws.send(JSON.stringify({ type: "joined", playerId: playerId, characterType: characterType, colorIndex: colorIndex }));
  broadcastGameState();
}

function handleSetSpeeds(data) {
  const { pacmanSpeed, ghostSpeed } = data;
  if (typeof pacmanSpeed === "number") {
    gameState.pacmanSpeed = Math.max(0.2, Math.min(3, pacmanSpeed));
  }
  if (typeof ghostSpeed === "number") {
    gameState.ghostSpeed = Math.max(0.2, Math.min(3, ghostSpeed));
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
  }));

  ws.send(
    JSON.stringify({
      type: "gameState",
      players: players,
      availableColors: {
        pacman: [...gameState.availableColors.pacman],
        ghost: [...gameState.availableColors.ghost],
      },
      gameStarted: gameState.gameStarted,
      positions: {
        pacmen: gameState.pacmen.map((p) => ({
          x: p.x,
          y: p.y,
          px: p.px,
          py: p.py,
          targetX: p.targetX,
          targetY: p.targetY,
          color: p.color,
        })),
        ghosts: gameState.ghosts.map((g) => ({
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
  }));

  broadcast({
    type: "gameState",
    players: players,
    availableColors: {
      pacman: [...gameState.availableColors.pacman],
      ghost: [...gameState.availableColors.ghost],
    },
    gameStarted: gameState.gameStarted,
    positions: {
      pacmen: gameState.pacmen.map((p) => ({
        x: p.x,
        y: p.y,
        px: p.px,
        py: p.py,
        targetX: p.targetX,
        targetY: p.targetY,
        color: p.color,
      })),
      ghosts: gameState.ghosts.map((g) => ({
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
initCharacters();
setInterval(gameLoop, 16); // ~60fps game loop

server.listen(PORT, () => {
});
