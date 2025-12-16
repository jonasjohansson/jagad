// Simple Pacman Game
// Map: 0 = path, 1 = wall, 2 = teleport
const MAP = [
  [1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1],
  [1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1],
  [1, 0, 1, 1, 1, 1, 0, 1, 1, 1, 1, 1, 0, 1, 1, 0, 1, 1, 1, 1, 1, 0, 1, 1, 1, 1, 0, 1],
  [1, 0, 1, 1, 1, 1, 0, 1, 1, 1, 1, 1, 0, 1, 1, 0, 1, 1, 1, 1, 1, 0, 1, 1, 1, 1, 0, 1],
  [1, 0, 1, 1, 1, 1, 0, 1, 1, 1, 1, 1, 0, 1, 1, 0, 1, 1, 1, 1, 1, 0, 1, 1, 1, 1, 0, 1],
  [1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1],
  [1, 0, 1, 1, 1, 1, 0, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 0, 1, 1, 1, 1, 0, 1],
  [1, 0, 1, 1, 1, 1, 0, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 0, 1, 1, 1, 1, 0, 1],
  [1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1],
  [1, 1, 1, 1, 1, 1, 0, 1, 1, 1, 1, 1, 0, 1, 1, 0, 1, 1, 1, 1, 1, 0, 1, 1, 1, 1, 1, 1],
  [1, 1, 1, 1, 1, 1, 0, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 0, 1, 1, 1, 1, 1, 1],
  [1, 1, 1, 1, 1, 1, 0, 1, 1, 0, 1, 1, 1, 1, 1, 1, 1, 1, 0, 1, 1, 0, 1, 1, 1, 1, 1, 1],
  [1, 1, 1, 1, 1, 1, 0, 1, 1, 0, 1, 1, 1, 1, 1, 1, 1, 1, 0, 1, 1, 0, 1, 1, 1, 1, 1, 1],
  [2, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 1, 1, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 2],
  [1, 1, 1, 1, 1, 1, 0, 1, 1, 0, 1, 1, 1, 1, 1, 1, 1, 1, 0, 1, 1, 0, 1, 1, 1, 1, 1, 1],
  [1, 1, 1, 1, 1, 1, 0, 1, 1, 0, 1, 1, 1, 1, 1, 1, 1, 1, 0, 1, 1, 0, 1, 1, 1, 1, 1, 1],
  [1, 1, 1, 1, 1, 1, 0, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 0, 1, 1, 1, 1, 1, 1],
  [1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1],
  [1, 0, 1, 1, 1, 1, 0, 1, 1, 1, 1, 1, 0, 1, 1, 0, 1, 1, 1, 1, 1, 0, 1, 1, 1, 1, 0, 1],
  [1, 0, 1, 1, 1, 1, 0, 1, 1, 1, 1, 1, 0, 1, 1, 0, 1, 1, 1, 1, 1, 0, 1, 1, 1, 1, 0, 1],
  [1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1],
  [1, 1, 1, 0, 1, 1, 0, 1, 1, 0, 1, 1, 1, 1, 1, 1, 1, 1, 0, 1, 1, 0, 1, 1, 0, 1, 1, 1],
  [1, 1, 1, 0, 1, 1, 0, 1, 1, 0, 1, 1, 1, 1, 1, 1, 1, 1, 0, 1, 1, 0, 1, 1, 0, 1, 1, 1],
  [1, 0, 0, 0, 0, 0, 0, 1, 1, 0, 0, 0, 0, 1, 1, 0, 0, 0, 0, 1, 1, 0, 0, 0, 0, 0, 0, 1],
  [1, 0, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 0, 1, 1, 0, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 0, 1],
  [1, 0, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 0, 1, 1, 0, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 0, 1],
  [1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1],
  [1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1],
];

const COLS = MAP[0].length;
const ROWS = MAP.length;
const CELL_SIZE = 20;
const CHARACTER_SIZE = 16;
const CHARACTER_OFFSET = (CELL_SIZE - CHARACTER_SIZE) / 2;
const BASE_MOVE_SPEED = 0.15; // base pixels per frame (smooth movement)
const TUNNEL_ROW = 13;

const COLORS = ["red", "green", "blue", "yellow"];
const DIRECTIONS = [
  { dir: "up", x: 0, y: -1 },
  { dir: "down", x: 0, y: 1 },
  { dir: "left", x: -1, y: 0 },
  { dir: "right", x: 1, y: 0 },
];
const OPPOSITE_DIR = {
  up: "down",
  down: "up",
  left: "right",
  right: "left",
};

// Pre-calculate teleport positions
const teleportPositions = [];
for (let y = 0; y < ROWS; y++) {
  for (let x = 0; x < COLS; x++) {
    if (MAP[y][x] === 2) {
      teleportPositions.push({ x, y });
    }
  }
}

// Game state
let pacmen = [];
let ghosts = [];
let currentPacman = 0;
let aiDifficulty = 0.8; // 0 = easy, 1 = hard
let pacmanSpeed = 1.0; // multiplier for pacman speed
let ghostSpeed = 1.0; // multiplier for ghost speed
let gameStarted = false;
let lastTime = 0;
let animationId = null;
let gui = null;

// Game control functions
function startGame() {
  if (!gameStarted) {
    gameStarted = true;
    console.log("%cGame Started!", "color: green; font-weight: bold;");
    // Start game loop if not already running
    if (!animationId) {
      lastTime = 0;
      animationId = requestAnimationFrame(gameLoop);
    }
  }
}

function restartGame() {
  gameStarted = false;
  // Reset all characters to starting positions
  pacmen.forEach((pacman, i) => {
    const pos = [
      { x: 1, y: 1 },
      { x: 26, y: 1 },
      { x: 1, y: 26 },
      { x: 26, y: 26 },
    ][i];
    pacman.x = pos.x;
    pacman.y = pos.y;
    pacman.px = pos.x * CELL_SIZE + CHARACTER_OFFSET;
    pacman.py = pos.y * CELL_SIZE + CHARACTER_OFFSET;
    pacman.targetX = pos.x;
    pacman.targetY = pos.y;
  });
  
  ghosts.forEach((ghost, i) => {
    const pos = [
      { x: 5, y: 13 },
      { x: 6, y: 13 },
      { x: 20, y: 13 },
      { x: 21, y: 13 },
    ][i];
    ghost.x = pos.x;
    ghost.y = pos.y;
    ghost.px = pos.x * CELL_SIZE + CHARACTER_OFFSET;
    ghost.py = pos.y * CELL_SIZE + CHARACTER_OFFSET;
    
    // Find initial direction
    for (const dir of DIRECTIONS) {
      const newX = pos.x + dir.x;
      const newY = pos.y + dir.y;
      if (newX >= 0 && newX < COLS && newY >= 0 && newY < ROWS && (MAP[newY][newX] === 0 || MAP[newY][newX] === 2)) {
        ghost.targetX = newX;
        ghost.targetY = newY;
        ghost.lastDirX = dir.x;
        ghost.lastDirY = dir.y;
        break;
      }
    }
    ghost.moveTimer = 0;
  });
  
  console.log("%cGame Restarted!", "color: orange; font-weight: bold;");
}

function selectPacman(colorName) {
  const colorIndex = COLORS.indexOf(colorName.toLowerCase());
  if (colorIndex !== -1 && pacmen[colorIndex]) {
    currentPacman = colorIndex;
    console.log(`%cNow controlling ${colorName} pacman`, `color: ${COLORS[colorIndex]}; font-weight: bold;`);
  }
}

// Initialize game
function init() {
  // Initialize GUI
  if (typeof lil !== "undefined" && typeof lil.GUI !== "undefined") {
    const guiContainer = document.getElementById("gui-container");
    const GUI = lil.GUI;
    if (gui) gui.destroy(); // Destroy existing GUI if any
    gui = new GUI({ container: guiContainer });
    
    const guiParams = {
      difficulty: 0.8,
      playerColor: "Red",
      pacmanSpeed: 1.0,
      ghostSpeed: 1.0,
      start: () => startGame(),
      restart: () => restartGame(),
    };
    
    gui.add(guiParams, "start").name("Start");
    gui.add(guiParams, "restart").name("Restart");
    gui.add(guiParams, "playerColor", ["Red", "Green", "Blue", "Yellow"])
      .name("Player")
      .onChange((value) => {
        selectPacman(value);
      });
    gui.add(guiParams, "difficulty", 0, 1, 0.1)
      .name("AI Skill")
      .onChange((value) => {
        aiDifficulty = value;
      });
    gui.add(guiParams, "pacmanSpeed", 0.1, 3, 0.1)
      .name("Pacman Speed")
      .onChange((value) => {
        pacmanSpeed = value;
      });
    gui.add(guiParams, "ghostSpeed", 0.1, 3, 0.1)
      .name("Ghost Speed")
      .onChange((value) => {
        ghostSpeed = value;
      });
  }
  const maze = document.getElementById("maze");
  maze.style.width = COLS * CELL_SIZE + "px";
  maze.style.height = ROWS * CELL_SIZE + "px";

  // Helper function to check if a cell is a path (0 or 2) - optimized
  const isPath = (x, y) => {
    if (x < 0 || x >= COLS || y < 0 || y >= ROWS) return false;
    const cell = MAP[y][x];
    return cell === 0 || cell === 2;
  };

  // Draw maze using document fragment for better performance
  // Only create divs for paths, teleports, and walls that have borders
  const fragment = document.createDocumentFragment();

  for (let y = 0; y < ROWS; y++) {
    for (let x = 0; x < COLS; x++) {
      const cellType = MAP[y][x];

      // For walls, check if they have any borders first
      if (cellType === 1) {
        const hasPathTop = isPath(x, y - 1);
        const hasPathRight = isPath(x + 1, y);
        const hasPathBottom = isPath(x, y + 1);
        const hasPathLeft = isPath(x - 1, y);

        // Skip walls that don't have any borders (completely surrounded by other walls)
        if (!hasPathTop && !hasPathRight && !hasPathBottom && !hasPathLeft) {
          continue;
        }

        // Create wall div with borders
        const cell = document.createElement("div");
        cell.className = "cell wall";
        cell.style.left = x * CELL_SIZE + "px";
        cell.style.top = y * CELL_SIZE + "px";

        const classes = [];
        if (hasPathTop) classes.push("border-top");
        if (hasPathRight) classes.push("border-right");
        if (hasPathBottom) classes.push("border-bottom");
        if (hasPathLeft) classes.push("border-left");

        // Add rounded corner classes where two borders meet
        if (hasPathTop && hasPathRight) classes.push("corner-top-right");
        if (hasPathTop && hasPathLeft) classes.push("corner-top-left");
        if (hasPathBottom && hasPathRight) classes.push("corner-bottom-right");
        if (hasPathBottom && hasPathLeft) classes.push("corner-bottom-left");

        if (classes.length > 0) {
          cell.className += " " + classes.join(" ");
        }
        fragment.appendChild(cell);
      } else {
        // Create path or teleport div
        const cell = document.createElement("div");
        cell.className = "cell " + (cellType === 2 ? "teleport" : "path");
        cell.style.left = x * CELL_SIZE + "px";
        cell.style.top = y * CELL_SIZE + "px";
        fragment.appendChild(cell);
      }
    }
  }
  maze.appendChild(fragment);

  // Create 4 pacmen in corners
  const pacmanPositions = [
    { x: 1, y: 1 }, // top-left
    { x: 26, y: 1 }, // top-right
    { x: 1, y: 26 }, // bottom-left
    { x: 26, y: 26 }, // bottom-right
  ];

  pacmanPositions.forEach((pos, i) => {
    const px = pos.x * CELL_SIZE + CHARACTER_OFFSET;
    const py = pos.y * CELL_SIZE + CHARACTER_OFFSET;
    const pacman = {
      x: pos.x,
      y: pos.y,
      px,
      py,
      targetX: pos.x,
      targetY: pos.y,
      color: COLORS[i],
      element: createCharacter("pacman", COLORS[i], pos.x, pos.y),
    };
    pacmen.push(pacman);
  });

  // Create 4 ghosts in center (valid path positions on row 13)
  // Row 13 has paths at columns 1-9 and 18-26
  const ghostPositions = [
    { x: 5, y: 13 }, // left side of center
    { x: 6, y: 13 },
    { x: 20, y: 13 }, // right side of center
    { x: 21, y: 13 },
  ];

  ghostPositions.forEach((pos, i) => {
    // Give each ghost an initial direction to move
    const initialDirections = [
      { x: 1, y: 0 }, // right
      { x: -1, y: 0 }, // left
      { x: 0, y: 1 }, // down
      { x: 0, y: -1 }, // up
    ];

    // Find a valid initial direction
    let initialTargetX = pos.x;
    let initialTargetY = pos.y;
    let initialDirX = 0;
    let initialDirY = 0;
    for (const dir of initialDirections) {
      const newX = pos.x + dir.x;
      const newY = pos.y + dir.y;
      if (newX >= 0 && newX < COLS && newY >= 0 && newY < ROWS && (MAP[newY][newX] === 0 || MAP[newY][newX] === 2)) {
        initialTargetX = newX;
        initialTargetY = newY;
        initialDirX = dir.x;
        initialDirY = dir.y;
        break;
      }
    }

    const px = pos.x * CELL_SIZE + CHARACTER_OFFSET;
    const py = pos.y * CELL_SIZE + CHARACTER_OFFSET;
    const ghost = {
      x: pos.x,
      y: pos.y,
      px,
      py,
      targetX: initialTargetX,
      targetY: initialTargetY,
      color: COLORS[i],
      element: createCharacter("ghost", COLORS[i], pos.x, pos.y),
      moveTimer: 0,
      lastDirX: initialDirX,
      lastDirY: initialDirY,
    };
    ghosts.push(ghost);
  });

  // Keyboard controls
  const keys = {};
  document.addEventListener("keydown", (e) => {
    keys[e.key] = true;
  });
  document.addEventListener("keyup", (e) => {
    keys[e.key] = false;
  });

  // Game loop
  function gameLoop(currentTime) {
    if (!lastTime) lastTime = currentTime;
    const deltaTime = currentTime - lastTime;
    lastTime = currentTime;

    // Handle player input (only if game started)
    if (gameStarted) {
      const pacman = pacmen[currentPacman];
      if (pacman && isAtTarget(pacman)) {
        let newX = pacman.x;
        let newY = pacman.y;

        if (keys["ArrowLeft"]) newX--;
        if (keys["ArrowRight"]) newX++;
        if (keys["ArrowUp"]) newY--;
        if (keys["ArrowDown"]) newY++;

        // Check if valid move
        if (newX >= 0 && newX < COLS && newY >= 0 && newY < ROWS && (MAP[newY][newX] === 0 || MAP[newY][newX] === 2)) {
          pacman.targetX = newX;
          pacman.targetY = newY;
        }
      }

      // Move characters smoothly
      moveCharacter(pacmen[currentPacman], pacmanSpeed);
      
      // Move ghosts
      ghosts.forEach((ghost) => {
        moveCharacter(ghost, ghostSpeed);
      });
    } else {
      // Game not started, just draw characters in place
      pacmen.forEach((pacman) => moveCharacter(pacman, 0));
      ghosts.forEach((ghost) => moveCharacter(ghost, 0));
    }

    // Ghost AI - always ensure they have a target (only if game started)
    if (gameStarted) {
      ghosts.forEach((ghost) => {
        // After movement, check if ghost reached target and give it a new one immediately
        if (isAtTarget(ghost)) {
          ghost.moveTimer += deltaTime;
          // Faster decisions at higher difficulty, but always make decisions when at target
          const moveInterval = Math.max(50, 300 - aiDifficulty * 250);
          
          // Always recalculate if timer expired, or if we can't continue in current direction
          if (ghost.moveTimer >= moveInterval) {
            ghost.moveTimer = 0;
            moveGhostAI(ghost);
          } else {
            // Try to continue, but if blocked, recalculate immediately
            const prevTargetX = ghost.targetX;
            const prevTargetY = ghost.targetY;
            continueInCurrentDirection(ghost);
            // If continueInCurrentDirection didn't change target, we're blocked - recalculate
            if (ghost.targetX === prevTargetX && ghost.targetY === prevTargetY) {
              moveGhostAI(ghost);
            }
          }
        }
      });
    }

    // Always continue the loop (for rendering), but only update if started
    animationId = requestAnimationFrame(gameLoop);
  }

  // Start the game loop (it will wait for start button to begin gameplay)
  animationId = requestAnimationFrame(gameLoop);
}

function isAtTarget(character) {
  const targetPx = character.targetX * CELL_SIZE + CHARACTER_OFFSET;
  const targetPy = character.targetY * CELL_SIZE + CHARACTER_OFFSET;
  return Math.abs(character.px - targetPx) < 0.5 && Math.abs(character.py - targetPy) < 0.5;
}

function moveCharacter(character, speedMultiplier = 1.0) {
  if (!character) return;

  const targetPx = character.targetX * CELL_SIZE + CHARACTER_OFFSET;
  const targetPy = character.targetY * CELL_SIZE + CHARACTER_OFFSET;

  // Smooth interpolation
  const dx = targetPx - character.px;
  const dy = targetPy - character.py;
  const distance = Math.sqrt(dx * dx + dy * dy);

  if (distance > 0.5) {
    const moveDistance = BASE_MOVE_SPEED * CELL_SIZE * speedMultiplier;
    if (distance > moveDistance) {
      character.px += (dx / distance) * moveDistance;
      character.py += (dy / distance) * moveDistance;
    } else {
      character.px = targetPx;
      character.py = targetPy;
      character.x = character.targetX;
      character.y = character.targetY;

      // Check for teleport
      if (MAP[character.y][character.x] === 2) {
        teleportCharacter(character);
      }
    }
  }

  updatePosition(character.element, character.px, character.py);
}

function teleportCharacter(character) {
  // Find the other teleport position
  const otherTeleport = teleportPositions.find((pos) => pos.x !== character.x || pos.y !== character.y);
  if (otherTeleport) {
    character.x = otherTeleport.x;
    character.y = otherTeleport.y;
    character.targetX = otherTeleport.x;
    character.targetY = otherTeleport.y;
    character.px = otherTeleport.x * CELL_SIZE + CHARACTER_OFFSET;
    character.py = otherTeleport.y * CELL_SIZE + CHARACTER_OFFSET;
  }
}

function continueInCurrentDirection(ghost) {
  // Use stored direction to continue
  let newX = ghost.targetX + ghost.lastDirX;
  const newY = ghost.targetY + ghost.lastDirY;

  // Handle wrap-around for tunnel row
  if (ghost.targetY === TUNNEL_ROW) {
    if (newX < 0) newX = COLS - 1;
    else if (newX >= COLS) newX = 0;
  }

  if (newX >= 0 && newX < COLS && newY >= 0 && newY < ROWS) {
    const cell = MAP[newY][newX];
    if (cell === 0 || cell === 2) {
      ghost.targetX = newX;
      ghost.targetY = newY;
      return;
    }
  }

  // If can't continue, pick a new direction immediately
  moveGhostAI(ghost);
}

function getPossibleMoves(ghost) {
  const possibleMoves = [];
  const isTunnelRow = ghost.y === TUNNEL_ROW;

  DIRECTIONS.forEach(({ dir, x: dx, y: dy }) => {
    let newX = ghost.x + dx;
    let newY = ghost.y + dy;

    // Handle wrap-around for tunnel row
    if (isTunnelRow) {
      if (newX < 0) newX = COLS - 1;
      else if (newX >= COLS) newX = 0;
    }

    // Check if valid move (not a wall)
    if (newX >= 0 && newX < COLS && newY >= 0 && newY < ROWS) {
      const cell = MAP[newY][newX];
      if (cell === 0 || cell === 2) {
        possibleMoves.push({ dir, x: dx, y: dy, newX, newY });
      }
    }
  });

  // Determine current direction from last movement
  // If at target, use the direction we're moving toward
  let currentDir = null;
  if (ghost.x === ghost.targetX && ghost.y === ghost.targetY) {
    // At target, use stored direction
    if (ghost.lastDirX === 0 && ghost.lastDirY === -1) currentDir = "up";
    else if (ghost.lastDirX === 0 && ghost.lastDirY === 1) currentDir = "down";
    else if (ghost.lastDirX === -1 && ghost.lastDirY === 0) currentDir = "left";
    else if (ghost.lastDirX === 1 && ghost.lastDirY === 0) currentDir = "right";
  } else {
    // Moving toward target, calculate direction
    const dx = ghost.targetX - ghost.x;
    const dy = ghost.targetY - ghost.y;
    if (Math.abs(dx) > Math.abs(dy)) {
      currentDir = dx > 0 ? "right" : "left";
    } else if (dy !== 0) {
      currentDir = dy > 0 ? "down" : "up";
    }
  }

  // Filter out turning around, but if that leaves no moves, allow it (better than being stuck)
  const filteredMoves = possibleMoves.filter((move) => !currentDir || move.dir !== OPPOSITE_DIR[currentDir]);

  // If filtering removed all moves, allow turning around (ghost is stuck otherwise)
  return filteredMoves.length > 0 ? filteredMoves : possibleMoves;
}

function calculateDistance(pos1, pos2) {
  return Math.sqrt(Math.pow(pos1.x - pos2.x, 2) + Math.pow(pos1.y - pos2.y, 2));
}

function calculateDistanceWithWrap(pos1, pos2) {
  // Calculate distance accounting for wrap-around in tunnel row
  let dx = Math.abs(pos1.x - pos2.x);
  let dy = Math.abs(pos1.y - pos2.y);

  // If both are in tunnel row, consider wrap-around distance
  if (pos1.y === TUNNEL_ROW && pos2.y === TUNNEL_ROW) {
    const wrapDx = Math.min(dx, COLS - dx);
    dx = wrapDx;
  }

  return Math.sqrt(dx * dx + dy * dy);
}

function determineBestMove(ghost, possibleMoves, targetPacman) {
  if (!targetPacman || possibleMoves.length === 0) {
    return possibleMoves[0];
  }

  let bestMove = null;
  let bestDistance = Infinity;
  const targetPos = { x: targetPacman.x, y: targetPacman.y };

  possibleMoves.forEach((move) => {
    const movePos = { x: move.newX, y: move.newY };
    const distance = calculateDistanceWithWrap(movePos, targetPos);

    if (distance < bestDistance) {
      bestDistance = distance;
      bestMove = move;
    }
  });

  return bestMove || possibleMoves[0];
}

function moveGhostAI(ghost) {
  // Find the target pacman (same color) - use current grid position
  const targetPacman = pacmen.find((p) => p && p.color === ghost.color);

  if (!targetPacman) {
    // No target, pick random move
    const possibleMoves = getPossibleMoves(ghost);
    if (possibleMoves.length > 0) {
      const randomMove = possibleMoves[Math.floor(Math.random() * possibleMoves.length)];
      ghost.targetX = randomMove.newX;
      ghost.targetY = randomMove.newY;
      ghost.lastDirX = randomMove.x;
      ghost.lastDirY = randomMove.y;
    }
    return;
  }

  // Get possible moves (avoiding walls and not turning around)
  const possibleMoves = getPossibleMoves(ghost);

  if (possibleMoves.length === 0) {
    return; // No valid moves
  }

  let chosenMove;

  // Use aiDifficulty as probability: if random < difficulty, choose best move, otherwise random
  if (Math.random() < aiDifficulty) {
    // Always chase when skill is high
    chosenMove = determineBestMove(ghost, possibleMoves, targetPacman);
  } else {
    // Random move at lower skill levels
    chosenMove = possibleMoves[Math.floor(Math.random() * possibleMoves.length)];
  }

  if (chosenMove) {
    ghost.targetX = chosenMove.newX;
    ghost.targetY = chosenMove.newY;
    ghost.lastDirX = chosenMove.x;
    ghost.lastDirY = chosenMove.y;
  }
}

function createCharacter(type, color, x, y) {
  const el = document.createElement("div");
  el.className = `${type} ${color}`;
  updatePosition(el, x * CELL_SIZE + CHARACTER_OFFSET, y * CELL_SIZE + CHARACTER_OFFSET);
  document.getElementById("maze").appendChild(el);
  return el;
}

function updatePosition(element, px, py) {
  element.style.left = px + "px";
  element.style.top = py + "px";
}

function checkCollisions() {
  pacmen.forEach((pacman, i) => {
    ghosts.forEach((ghost, j) => {
      // Check if they're on the same grid position
      if (pacman && ghost && pacman.color === ghost.color && pacman.x === ghost.x && pacman.y === ghost.y) {
        console.log(`${pacman.color} ghost caught ${pacman.color} pacman!`);
        // Remove both
        pacman.element.remove();
        ghost.element.remove();
        pacmen.splice(i, 1);
        ghosts.splice(j, 1);
      }
    });
  });
}

// Start game when everything is loaded
if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", () => {
    // Wait a bit for lil-gui to load
    setTimeout(init, 100);
  });
} else {
  setTimeout(init, 100);
}
