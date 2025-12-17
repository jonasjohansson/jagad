// Simple WebSocket server for Pacman multiplayer game
// Server-authoritative: server maintains game state and runs game loop

const http = require("http");
const fs = require("fs");
const path = require("path");
const { WebSocketServer } = require("ws");

const PORT = process.env.PORT || 3000;

// ========== GAME CONSTANTS ==========
// Map: 0 = path, 1 = wall, 2 = teleport, 3 = ghost spawn
const MAP = [
  [1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1],
  [1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1],
  [1, 0, 1, 1, 1, 1, 0, 1, 1, 1, 1, 1, 0, 1, 1, 0, 1, 1, 1, 1, 1, 0, 1, 1, 1, 1, 0, 1, 1, 1, 1, 1],
  [1, 0, 1, 1, 1, 1, 0, 1, 1, 1, 1, 1, 0, 1, 1, 0, 1, 1, 1, 1, 1, 0, 1, 1, 1, 1, 0, 1, 1, 1, 1, 1],
  [1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1],
  [1, 0, 1, 1, 1, 1, 0, 1, 1, 0, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 0, 1, 1, 0, 1, 1, 0, 1, 1, 1, 1, 1],
  [1, 0, 0, 0, 0, 0, 0, 1, 1, 0, 0, 0, 0, 1, 1, 0, 0, 1, 1, 0, 0, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 1],
  [1, 1, 1, 1, 1, 1, 0, 1, 1, 1, 1, 1, 0, 1, 1, 0, 0, 1, 1, 0, 1, 1, 1, 1, 0, 1, 1, 1, 1, 1, 1, 1],
  [2, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 3, 3, 0, 0, 3, 3, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 2],
  [1, 1, 1, 1, 1, 1, 0, 1, 1, 1, 1, 1, 0, 1, 1, 0, 0, 1, 1, 0, 1, 1, 1, 1, 0, 1, 1, 1, 1, 1, 1, 1],
  [1, 0, 0, 0, 0, 0, 0, 1, 1, 0, 0, 0, 0, 1, 1, 0, 0, 1, 1, 0, 0, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 1],
  [1, 0, 1, 1, 1, 1, 0, 1, 1, 0, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 0, 1, 1, 0, 1, 1, 0, 1, 1, 1, 1, 1],
  [1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1],
  [1, 0, 1, 1, 1, 1, 0, 1, 1, 1, 1, 1, 0, 1, 1, 0, 1, 1, 1, 1, 1, 0, 1, 1, 1, 1, 0, 1, 1, 1, 1, 1],
  [1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1],
  [1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1],
];

const COLS = MAP[0].length;
const ROWS = MAP.length;
const CELL_SIZE = 20;
const CHARACTER_SIZE = 16;
const CHARACTER_OFFSET = (CELL_SIZE - CHARACTER_SIZE) / 2;
// Base movement speed (tuned to feel closer to the original client-side movement)
// Higher = faster movement across the grid
const BASE_MOVE_SPEED = 0.25;
const TUNNEL_ROW = 8;
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
  survivalTimeThreshold: 30,
  pacmen: [],
  ghosts: [],
  lastUpdate: Date.now(),
};

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
    // Slightly faster base speed for pacmen so they feel more responsive
    speed: 1.3,
    score: 0,
    spawnPos: { ...pos },
    lastDirX: 0,
    lastDirY: 0,
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
      // Keep ghosts at base speed; pacmen are a bit faster
      speed: 1.0,
      score: 0,
      survivalTime: 0,
      lastSurvivalPoint: 0,
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

  if (distance > 0.5) {
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
        ghost.score++;
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
  character.lastDirX = 0;
  character.lastDirY = 0;
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

  // Process player input (pacmen and ghosts always)
  gameState.players.forEach((player) => {
    if (!player.connected || !player.pendingInput) return;
    const input = player.pendingInput;
    player.pendingInput = null;

    if (player.type === "pacman") {
      const pacman = gameState.pacmen[player.colorIndex];
      if (pacman && input.targetX !== undefined && input.targetY !== undefined) {
        if (isPath(input.targetX, input.targetY)) {
          // Set the next tile and update movement direction
          const dx = input.targetX - pacman.x;
          const dy = input.targetY - pacman.y;
          pacman.targetX = input.targetX;
          pacman.targetY = input.targetY;
          pacman.lastDirX = dx === 0 ? 0 : dx > 0 ? 1 : -1;
          pacman.lastDirY = dy === 0 ? 0 : dy > 0 ? 1 : -1;
        }
      }
    } else if (player.type === "ghost") {
      const ghost = gameState.ghosts[player.colorIndex];
      if (ghost && input.targetX !== undefined && input.targetY !== undefined) {
        if (isPath(input.targetX, input.targetY)) {
          ghost.targetX = input.targetX;
          ghost.targetY = input.targetY;
          const dx = input.targetX - ghost.x;
          const dy = input.targetY - ghost.y;
          ghost.lastDirX = dx === 0 ? 0 : dx > 0 ? 1 : -1;
          ghost.lastDirY = dy === 0 ? 0 : dy > 0 ? 1 : -1;
        }
      }
    }
  });

  // Move pacmen (always, even before game starts)
  gameState.pacmen.forEach((pacman) => {
    if (!pacman) return;

    // Move pacman toward its current target
    moveCharacter(pacman, pacman.speed);

    // Pacman-style continuous movement:
    // if we've reached the current target tile and have a direction,
    // automatically queue the next tile in that direction (unless it's a wall).
    if (isAtTarget(pacman) && (pacman.lastDirX || pacman.lastDirY)) {
      const nextX = pacman.x + pacman.lastDirX;
      const nextY = pacman.y + pacman.lastDirY;
      if (nextX >= 0 && nextX < COLS && nextY >= 0 && nextY < ROWS && isPath(nextX, nextY)) {
        pacman.targetX = nextX;
        pacman.targetY = nextY;
      }
    }
  });

  // Ghost movement, survival, and collisions
  gameState.ghosts.forEach((ghost, index) => {
    if (!ghost) return;
    const isPlayerControlled = Array.from(gameState.players.values()).some(
      (p) => p.type === "ghost" && p.colorIndex === index && p.connected
    );

    if (isPlayerControlled) {
      // Always allow player-controlled ghosts to move, even before the game starts
      moveCharacter(ghost, ghost.speed);
    } else if (gameState.gameStarted) {
      // AI ghosts only move when the game has started
      moveCharacter(ghost, ghost.speed);
      if (isAtTarget(ghost)) {
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
    }
  });

  if (gameState.gameStarted) {
    // Update survival timers only while the game is running
    gameState.ghosts.forEach((ghost, index) => {
      if (!ghost) return;
      const isPlayerControlled = Array.from(gameState.players.values()).some(
        (p) => p.type === "ghost" && p.colorIndex === index && p.connected
      );
      if (!isPlayerControlled) {
        ghost.survivalTime += deltaSeconds;
        if (ghost.survivalTime >= gameState.survivalTimeThreshold) {
          const pointsEarned =
            Math.floor(ghost.survivalTime / gameState.survivalTimeThreshold) -
            Math.floor(ghost.lastSurvivalPoint / gameState.survivalTimeThreshold);
          if (pointsEarned > 0) {
            ghost.score += pointsEarned;
            ghost.lastSurvivalPoint = ghost.survivalTime;
          }
        }
      }
    });

    // Check collisions only when the game is running
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

  let filePath = "." + req.url;
  if (filePath === "./") {
    filePath = "./index.html";
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
  console.log(`New connection: ${playerId}`);

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
          console.log(`Unknown message type: ${data.type}`);
      }
    } catch (error) {
      console.error("Error parsing message:", error);
    }
  });

  ws.on("close", () => {
    handleDisconnect(playerId);
  });

  ws.on("error", (error) => {
    console.error(`WebSocket error for ${playerId}:`, error);
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
    console.log(`Player ${playerId} took control of ghost ${colorIndex}, AI stopped`);
  }

  console.log(`${playerId} joined as ${characterType} color ${colorIndex}`);
  ws.send(JSON.stringify({ type: "joined", playerId: playerId, characterType: characterType, colorIndex: colorIndex }));
  broadcastGameState();
}

function handleInput(playerId, data) {
  const player = gameState.players.get(playerId);
  if (!player || !player.connected) return;
  player.pendingInput = data.input;
}

function handleDisconnect(playerId) {
  const player = gameState.players.get(playerId);
  if (player) {
    console.log(`${playerId} disconnected (${player.type} color ${player.colorIndex})`);
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
          score: p.score,
        })),
        ghosts: gameState.ghosts.map((g) => ({
          x: g.x,
          y: g.y,
          px: g.px,
          py: g.py,
          targetX: g.targetX,
          targetY: g.targetY,
          color: g.color,
          score: g.score,
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
        score: p.score,
      })),
      ghosts: gameState.ghosts.map((g) => ({
        x: g.x,
        y: g.y,
        px: g.px,
        py: g.py,
        targetX: g.targetX,
        targetY: g.targetY,
        color: g.color,
        score: g.score,
      })),
    },
  });
}

// ========== START SERVER ==========
initCharacters();
setInterval(gameLoop, 16); // ~60fps game loop

server.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
  console.log(`WebSocket server ready for connections`);
});
