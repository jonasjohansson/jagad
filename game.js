// Simple Pacman Game
// Map: 0 = path, 1 = wall, 2 = teleport, 3 = ghost spawn (treated as path for movement, just marks spawn location)
// Map: 32 columns wide, 16 rows high - Classic Pacman style
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
const BASE_MOVE_SPEED = 0.15; // base pixels per frame (smooth movement)
const TUNNEL_ROW = 8; // Row 8 (0-indexed) has teleport tiles

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

// Pre-calculate ghost spawn positions
const ghostSpawnPositions = [];
for (let y = 0; y < ROWS; y++) {
  for (let x = 0; x < COLS; x++) {
    if (MAP[y][x] === 3) {
      ghostSpawnPositions.push({ x, y });
    }
  }
}

// Game state
let pacmen = [];
let ghosts = [];
let currentPacman = 0;
let currentGhost = null; // null means controlling a pacman, otherwise index of controlled ghost
let playerType = "pacman"; // "pacman" or "ghost"
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
      { x: 30, y: 1 },
      { x: 1, y: 14 },
      { x: 30, y: 14 },
    ][i];
    pacman.x = pos.x;
    pacman.y = pos.y;
    pacman.px = pos.x * CELL_SIZE + CHARACTER_OFFSET;
    pacman.py = pos.y * CELL_SIZE + CHARACTER_OFFSET;
    pacman.targetX = pos.x;
    pacman.targetY = pos.y;
  });

  ghosts.forEach((ghost, i) => {
    // Use spawn positions from map, or fallback to default positions
    const pos =
      i < ghostSpawnPositions.length
        ? ghostSpawnPositions[i]
        : [
            { x: 11, y: 11 },
            { x: 12, y: 11 },
            { x: 13, y: 11 },
            { x: 14, y: 11 },
          ][i - ghostSpawnPositions.length] || { x: 13, y: 13 };
    ghost.x = pos.x;
    ghost.y = pos.y;
    ghost.px = pos.x * CELL_SIZE + CHARACTER_OFFSET;
    ghost.py = pos.y * CELL_SIZE + CHARACTER_OFFSET;

    // Find initial direction
    for (const dir of DIRECTIONS) {
      const newX = pos.x + dir.x;
      const newY = pos.y + dir.y;
      if (
        newX >= 0 &&
        newX < COLS &&
        newY >= 0 &&
        newY < ROWS &&
        (MAP[newY][newX] === 0 || MAP[newY][newX] === 2 || MAP[newY][newX] === 3)
      ) {
        ghost.targetX = newX;
        ghost.targetY = newY;
        ghost.lastDirX = dir.x;
        ghost.lastDirY = dir.y;
        break;
      }
    }
    ghost.moveTimer = 0;
    // Reset position history to prevent old history from affecting restarted game
    if (!ghost.positionHistory) {
      ghost.positionHistory = [];
    } else {
      ghost.positionHistory = [];
    }
  });

  // Re-apply selection highlight after restart
  if (playerType === "pacman" && pacmen[currentPacman]) {
    pacmen[currentPacman].element.classList.add("selected");
  } else if (playerType === "ghost" && currentGhost !== null && ghosts[currentGhost]) {
    ghosts[currentGhost].element.classList.add("selected");
  }

  console.log("%cGame Restarted!", "color: orange; font-weight: bold;");
}

function selectCharacter(type, colorName) {
  const colorIndex = COLORS.indexOf(colorName.toLowerCase());

  if (type === "pacman") {
    // Remove selected class from all characters
    pacmen.forEach((pacman) => {
      if (pacman && pacman.element) {
        pacman.element.classList.remove("selected");
      }
    });
    ghosts.forEach((ghost) => {
      if (ghost && ghost.element) {
        ghost.element.classList.remove("selected");
      }
    });

    if (colorIndex !== -1 && pacmen[colorIndex]) {
      currentPacman = colorIndex;
      currentGhost = null;
      playerType = "pacman";
      if (pacmen[colorIndex] && pacmen[colorIndex].element) {
        pacmen[colorIndex].element.classList.add("selected");
      }
      console.log(`%cNow controlling ${colorName} pacman`, `color: ${COLORS[colorIndex]}; font-weight: bold;`);
    }
  } else if (type === "ghost") {
    // Remove selected class from all characters
    pacmen.forEach((pacman) => {
      if (pacman && pacman.element) {
        pacman.element.classList.remove("selected");
      }
    });
    ghosts.forEach((ghost) => {
      if (ghost && ghost.element) {
        ghost.element.classList.remove("selected");
      }
    });

    if (colorIndex !== -1 && ghosts[colorIndex]) {
      currentGhost = colorIndex;
      currentPacman = 0; // Reset pacman selection
      playerType = "ghost";
      if (ghosts[colorIndex] && ghosts[colorIndex].element) {
        ghosts[colorIndex].element.classList.add("selected");
      }
      console.log(`%cNow controlling ${colorName} ghost`, `color: ${COLORS[colorIndex]}; font-weight: bold;`);
    }
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
      playerType: "Pacman",
      playerColor: "Red",
      pacmanSpeed: 1.0,
      ghostSpeed: 1.0,
      borderStyle: "double",
      borderColor: "#ffffff",
      pathBgColor: "#000000",
      wallBgColor: "transparent",
      start: () => startGame(),
      restart: () => restartGame(),
    };

    gui.add(guiParams, "start").name("Start");
    gui.add(guiParams, "restart").name("Restart");
    gui
      .add(guiParams, "playerType", ["Pacman", "Ghost"])
      .name("Control")
      .onChange((value) => {
        const type = value.toLowerCase();
        selectCharacter(type, guiParams.playerColor);
      });
    gui
      .add(guiParams, "playerColor", ["Red", "Green", "Blue", "Yellow"])
      .name("Color")
      .onChange((value) => {
        selectCharacter(guiParams.playerType.toLowerCase(), value);
      });

    gui
      .add(guiParams, "difficulty", 0, 1, 0.1)
      .name("AI Skill")
      .onChange((value) => {
        aiDifficulty = value;
      });
    gui
      .add(guiParams, "pacmanSpeed", 0.1, 3, 0.1)
      .name("Pacman Speed")
      .onChange((value) => {
        pacmanSpeed = value;
      });
    gui
      .add(guiParams, "ghostSpeed", 0.1, 3, 0.1)
      .name("Ghost Speed")
      .onChange((value) => {
        ghostSpeed = value;
      });

    // Visual settings
    gui
      .add(guiParams, "borderStyle", ["solid", "dashed", "dotted", "double"])
      .name("Border Style")
      .onChange((value) => {
        document.documentElement.style.setProperty("--border-style", value);
      });

    gui
      .addColor(guiParams, "borderColor")
      .name("Border Color")
      .onChange((value) => {
        document.documentElement.style.setProperty("--color-wall-border", value);
      });

    gui
      .addColor(guiParams, "pathBgColor")
      .name("Path Background")
      .onChange((value) => {
        document.documentElement.style.setProperty("--color-path-bg", value);
      });

    gui
      .addColor(guiParams, "wallBgColor")
      .name("Wall Background")
      .onChange((value) => {
        document.documentElement.style.setProperty("--color-wall-bg", value);
      });
  }
  const maze = document.getElementById("maze");
  // Sizes already set in updateSizes(), but ensure they're correct
  maze.style.width = COLS * CELL_SIZE + "px";
  maze.style.height = ROWS * CELL_SIZE + "px";

  // Helper function to check if a cell is a path (0, 2, or 3) - optimized
  // Note: 3 (spawn) is treated as a valid path for all movement purposes
  const isPath = (x, y) => {
    if (x < 0 || x >= COLS || y < 0 || y >= ROWS) return false;
    const cell = MAP[y][x];
    return cell === 0 || cell === 2 || cell === 3; // 3 is a valid path
  };

  // Helper function to check if a cell should create borders (only 0 and 2, not 3)
  // This is separate from isPath because spawn positions (3) don't create visual borders
  const shouldCreateBorder = (x, y) => {
    if (x < 0 || x >= COLS || y < 0 || y >= ROWS) return false;
    const cell = MAP[y][x];
    return cell === 0 || cell === 2; // Exclude 3 (spawn positions don't create borders, but are still paths)
  };

  // Draw maze using document fragment for better performance
  // Only create divs for paths, teleports, and walls that have borders
  const fragment = document.createDocumentFragment();

  for (let y = 0; y < ROWS; y++) {
    for (let x = 0; x < COLS; x++) {
      const cellType = MAP[y][x];

      // For walls, check if they have any borders first
      if (cellType === 1) {
        const hasPathTop = shouldCreateBorder(x, y - 1);
        const hasPathRight = shouldCreateBorder(x + 1, y);
        const hasPathBottom = shouldCreateBorder(x, y + 1);
        const hasPathLeft = shouldCreateBorder(x - 1, y);

        // Check if this wall is on the edge of the map
        const isEdgeTop = y === 0;
        const isEdgeRight = x === COLS - 1;
        const isEdgeBottom = y === ROWS - 1;
        const isEdgeLeft = x === 0;
        const isEdge = isEdgeTop || isEdgeRight || isEdgeBottom || isEdgeLeft;

        // Skip walls that don't have any borders AND are not on the edge
        if (!hasPathTop && !hasPathRight && !hasPathBottom && !hasPathLeft && !isEdge) {
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

        // Add borders to edge walls (outskirts) - these are walls on the map boundaries
        if (isEdgeTop) classes.push("edge-top");
        if (isEdgeRight) classes.push("edge-right");
        if (isEdgeBottom) classes.push("edge-bottom");
        if (isEdgeLeft) classes.push("edge-left");

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
        // Create path, teleport, or spawn div (all rendered as paths/teleports)
        // Note: 3 (spawn) is rendered as a regular path - it's just a spawn marker
        const cell = document.createElement("div");
        cell.className = "cell " + (cellType === 2 ? "teleport" : "path");
        cell.style.left = x * CELL_SIZE + "px";
        cell.style.top = y * CELL_SIZE + "px";
        fragment.appendChild(cell);
      }
    }
  }
  maze.appendChild(fragment);

  // Create 4 pacmen in corners (map is 32 columns wide, 16 rows high)
  const pacmanPositions = [
    { x: 1, y: 1 }, // top-left
    { x: 30, y: 1 }, // top-right (32 - 2)
    { x: 1, y: 14 }, // bottom-left (16 - 2)
    { x: 30, y: 14 }, // bottom-right
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

  // Set initial player (after pacmen are created)
  selectCharacter("pacman", "Red");

  // Create 4 ghosts at spawn positions (marked with 3 in the map)
  // Use the pre-calculated ghost spawn positions
  const ghostPositions = [];
  for (let i = 0; i < 4 && i < ghostSpawnPositions.length; i++) {
    ghostPositions.push(ghostSpawnPositions[i]);
  }

  // If there are fewer than 4 spawn positions, fill the rest with default positions
  if (ghostPositions.length < 4) {
    const defaultPositions = [
      { x: 11, y: 11 },
      { x: 12, y: 11 },
      { x: 13, y: 11 },
      { x: 14, y: 11 },
    ];
    for (let i = ghostPositions.length; i < 4; i++) {
      ghostPositions.push(defaultPositions[i - ghostPositions.length]);
    }
  }

  ghostPositions.forEach((pos, i) => {
    // Give each ghost an initial direction to move
    const initialDirections = [
      { x: 1, y: 0 }, // right
      { x: -1, y: 0 }, // left
      { x: 0, y: 1 }, // down
      { x: 0, y: -1 }, // up
    ];

    // Find a valid initial direction - try all directions
    let initialTargetX = pos.x;
    let initialTargetY = pos.y;
    let initialDirX = 0;
    let initialDirY = 0;
    const validMoves = [];

    for (const dir of initialDirections) {
      const newX = pos.x + dir.x;
      const newY = pos.y + dir.y;
      if (
        newX >= 0 &&
        newX < COLS &&
        newY >= 0 &&
        newY < ROWS &&
        (MAP[newY][newX] === 0 || MAP[newY][newX] === 2 || MAP[newY][newX] === 3)
      ) {
        validMoves.push({ x: newX, y: newY, dirX: dir.x, dirY: dir.y });
      }
    }

    // If we found valid moves, use the first one
    if (validMoves.length > 0) {
      const move = validMoves[0];
      initialTargetX = move.x;
      initialTargetY = move.y;
      initialDirX = move.dirX;
      initialDirY = move.dirY;
    } else {
      // If no valid moves found, try to find any adjacent path (shouldn't happen, but safety check)
      console.warn(`Ghost at (${pos.x}, ${pos.y}) has no valid initial moves!`);
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
      positionHistory: [], // Track recent positions to avoid loops
      lastDecisionTime: 0, // Track when last decision was made
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
      if (playerType === "pacman") {
        const pacman = pacmen[currentPacman];
        if (pacman && isAtTarget(pacman)) {
          let newX = pacman.x;
          let newY = pacman.y;

          if (keys["ArrowLeft"]) newX--;
          if (keys["ArrowRight"]) newX++;
          if (keys["ArrowUp"]) newY--;
          if (keys["ArrowDown"]) newY++;

          // Handle wrap-around for player
          if (pacman.y === TUNNEL_ROW) {
            if (newX < 0) newX = COLS - 1;
            else if (newX >= COLS) newX = 0;
          }

          // Check if valid move
          if (
            newX >= 0 &&
            newX < COLS &&
            newY >= 0 &&
            newY < ROWS &&
            (MAP[newY][newX] === 0 || MAP[newY][newX] === 2 || MAP[newY][newX] === 3)
          ) {
            pacman.targetX = newX;
            pacman.targetY = newY;
          }
        }
      } else if (playerType === "ghost" && currentGhost !== null) {
        const ghost = ghosts[currentGhost];
        if (ghost && isAtTarget(ghost)) {
          let newX = ghost.x;
          let newY = ghost.y;

          if (keys["ArrowLeft"]) newX--;
          if (keys["ArrowRight"]) newX++;
          if (keys["ArrowUp"]) newY--;
          if (keys["ArrowDown"]) newY++;

          // Handle wrap-around for tunnel row
          if (ghost.y === TUNNEL_ROW) {
            if (newX < 0) newX = COLS - 1;
            else if (newX >= COLS) newX = 0;
          }

          // Check if valid move
          if (
            newX >= 0 &&
            newX < COLS &&
            newY >= 0 &&
            newY < ROWS &&
            (MAP[newY][newX] === 0 || MAP[newY][newX] === 2 || MAP[newY][newX] === 3)
          ) {
            ghost.targetX = newX;
            ghost.targetY = newY;
            // Update direction for smooth movement (normalize to -1, 0, or 1)
            const dx = newX - ghost.x;
            const dy = newY - ghost.y;
            ghost.lastDirX = dx === 0 ? 0 : dx > 0 ? 1 : -1;
            ghost.lastDirY = dy === 0 ? 0 : dy > 0 ? 1 : -1;
          }
        }
      }

      // Move characters smoothly
      if (playerType === "pacman") {
        moveCharacter(pacmen[currentPacman], pacmanSpeed);
      } else if (playerType === "ghost" && currentGhost !== null) {
        moveCharacter(ghosts[currentGhost], ghostSpeed);
      }

      // Move ghosts (skip player-controlled ghost, already moved above)
      ghosts.forEach((ghost, index) => {
        if (playerType === "ghost" && index === currentGhost) {
          return; // Already moved above
        }
        moveCharacter(ghost, ghostSpeed);
      });
    } else {
      // Game not started, just draw characters in place
      pacmen.forEach((pacman) => moveCharacter(pacman, 0));
      ghosts.forEach((ghost) => moveCharacter(ghost, 0));
    }

    // Ghost AI - always ensure they have a target (only if game started and not player-controlled)
    if (gameStarted) {
      ghosts.forEach((ghost, index) => {
        // Skip AI for player-controlled ghost
        if (playerType === "ghost" && index === currentGhost) {
          return;
        }

        // After movement, check if ghost reached target and give it a new one immediately
        if (isAtTarget(ghost)) {
          // Ensure grid position is synced
          ghost.x = ghost.targetX;
          ghost.y = ghost.targetY;

          // If ghost has no direction stored OR if target equals current position (stuck at spawn), get a new one immediately
          if ((ghost.lastDirX === 0 && ghost.lastDirY === 0) || (ghost.targetX === ghost.x && ghost.targetY === ghost.y)) {
            moveGhostAI(ghost);
          } else {
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
        }
      });
    }

    if (gameStarted) {
      checkCollisions();
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
    if (cell === 0 || cell === 2 || cell === 3) {
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
  // Use current grid position (ensure it's synced)
  const currentX = ghost.x;
  const currentY = ghost.y;
  const isTunnelRow = currentY === TUNNEL_ROW;

  DIRECTIONS.forEach(({ dir, x: dx, y: dy }) => {
    let newX = currentX + dx;
    let newY = currentY + dy;

    // Handle wrap-around for tunnel row
    if (isTunnelRow) {
      if (newX < 0) newX = COLS - 1;
      else if (newX >= COLS) newX = 0;
    }

    // Check if valid move (not a wall)
    if (newX >= 0 && newX < COLS && newY >= 0 && newY < ROWS) {
      const cell = MAP[newY][newX];
      if (cell === 0 || cell === 2 || cell === 3) {
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
  let filteredMoves = possibleMoves.filter((move) => !currentDir || move.dir !== OPPOSITE_DIR[currentDir]);

  // If filtering removed all moves, allow turning around (ghost is stuck otherwise)
  if (filteredMoves.length === 0) {
    filteredMoves = possibleMoves;
  }

  // Filter out moves that would take us to recently visited positions (prevent loops)
  // Keep only last 4 positions in history to avoid short loops
  if (ghost.positionHistory && ghost.positionHistory.length > 0) {
    const recentPositions = ghost.positionHistory.slice(-4); // Last 4 positions
    filteredMoves = filteredMoves.filter((move) => {
      return !recentPositions.some((pos) => pos.x === move.newX && pos.y === move.newY);
    });

    // If filtering removed all moves, allow revisiting (better than being stuck)
    if (filteredMoves.length === 0) {
      filteredMoves = possibleMoves;
    }
  }

  return filteredMoves;
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
  let bestScore = -Infinity;
  const targetPos = { x: targetPacman.x, y: targetPacman.y };

  possibleMoves.forEach((move) => {
    const movePos = { x: move.newX, y: move.newY };
    const distance = calculateDistanceWithWrap(movePos, targetPos);

    // Score based on distance (closer is better)
    let score = -distance;

    // Bonus for continuing in the same direction (reduces oscillation)
    if (ghost.lastDirX === move.x && ghost.lastDirY === move.y) {
      score += 0.5;
    }

    // Penalty for moves that lead to recently visited positions
    if (ghost.positionHistory) {
      const recentPositions = ghost.positionHistory.slice(-2);
      const isRecent = recentPositions.some((pos) => pos.x === move.newX && pos.y === move.newY);
      if (isRecent) {
        score -= 2.0; // Strong penalty for revisiting
      }
    }

    // Prefer moves that get us closer to target
    const currentDistance = calculateDistanceWithWrap({ x: ghost.x, y: ghost.y }, targetPos);
    if (distance < currentDistance) {
      score += 1.0; // Bonus for getting closer
    }

    if (score > bestScore) {
      bestScore = score;
      bestMove = move;
    }
  });

  return bestMove || possibleMoves[0];
}

function moveGhostAI(ghost) {
  // Ensure grid position is synced before calculating moves
  ghost.x = ghost.targetX;
  ghost.y = ghost.targetY;

  // Update position history to prevent loops
  if (!ghost.positionHistory) {
    ghost.positionHistory = [];
  }

  // Add current position to history
  ghost.positionHistory.push({ x: ghost.x, y: ghost.y });

  // Keep only last 6 positions to prevent loops
  if (ghost.positionHistory.length > 6) {
    ghost.positionHistory.shift();
  }

  // Find the target pacman (same color) - use current grid position
  const targetPacman = pacmen.find((p) => p && p.color === ghost.color);

  // Get possible moves (avoiding walls, not turning around, and avoiding recent positions)
  const possibleMoves = getPossibleMoves(ghost);

  if (possibleMoves.length === 0) {
    // No valid moves - this shouldn't happen, but if it does, try to find any valid adjacent cell
    console.warn(`Ghost at (${ghost.x}, ${ghost.y}) has no valid moves!`);
    // Clear history to allow escape
    ghost.positionHistory = [];
    return;
  }

  let chosenMove;

  if (!targetPacman) {
    // No target, pick random move (but avoid recent positions)
    chosenMove = possibleMoves[Math.floor(Math.random() * possibleMoves.length)];
  } else {
    // Use aiDifficulty as probability: if random < difficulty, choose best move, otherwise random
    if (Math.random() < aiDifficulty) {
      // Always chase when skill is high
      chosenMove = determineBestMove(ghost, possibleMoves, targetPacman);
    } else {
      // Random move at lower skill levels, but still prefer moves that don't revisit
      const nonRecentMoves = possibleMoves.filter((move) => {
        if (!ghost.positionHistory || ghost.positionHistory.length === 0) return true;
        const recent = ghost.positionHistory.slice(-2);
        return !recent.some((pos) => pos.x === move.newX && pos.y === move.newY);
      });

      const movesToChooseFrom = nonRecentMoves.length > 0 ? nonRecentMoves : possibleMoves;
      chosenMove = movesToChooseFrom[Math.floor(Math.random() * movesToChooseFrom.length)];
    }
  }

  if (chosenMove) {
    ghost.targetX = chosenMove.newX;
    ghost.targetY = chosenMove.newY;
    ghost.lastDirX = chosenMove.x;
    ghost.lastDirY = chosenMove.y;
  } else {
    // Fallback: pick first available move
    const fallbackMove = possibleMoves[0];
    ghost.targetX = fallbackMove.newX;
    ghost.targetY = fallbackMove.newY;
    ghost.lastDirX = fallbackMove.x;
    ghost.lastDirY = fallbackMove.y;
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
