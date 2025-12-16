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

// Pre-calculate pacman spawn positions
const pacmanSpawnPositions = [
  { x: 1, y: 1 }, // top-left
  { x: 30, y: 1 }, // top-right
  { x: 1, y: 14 }, // bottom-left
  { x: 30, y: 14 }, // bottom-right
];

// Helper functions
function isPath(x, y) {
  if (x < 0 || x >= COLS || y < 0 || y >= ROWS) return false;
  const cell = MAP[y][x];
  return cell === 0 || cell === 2 || cell === 3;
}

function shouldCreateBorder(x, y) {
  if (x < 0 || x >= COLS || y < 0 || y >= ROWS) return false;
  const cell = MAP[y][x];
  return cell === 0 || cell === 2;
}

function respawnCharacter(character, spawnPos) {
  character.x = spawnPos.x;
  character.y = spawnPos.y;
  character.px = spawnPos.x * CELL_SIZE + CHARACTER_OFFSET;
  character.py = spawnPos.y * CELL_SIZE + CHARACTER_OFFSET;
  character.targetX = spawnPos.x;
  character.targetY = spawnPos.y;
  updatePosition(character.element, character.px, character.py);
}

function respawnGhost(ghost, spawnPos) {
  respawnCharacter(ghost, spawnPos);
  ghost.moveTimer = 0;
  ghost.positionHistory = [];
  ghost.lastDirX = 0;
  ghost.lastDirY = 0;

  // Find initial direction
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

// Game state
let pacmen = [];
let ghosts = [];
let currentPacman = 0;
let currentGhost = null; // null means controlling a pacman, otherwise index of controlled ghost
let playerType = "pacman"; // "pacman" or "ghost"
let aiDifficulty = 0.8; // 0 = easy, 1 = hard
let gameStarted = false;
let lastTime = 0;
let animationId = null;
let gui = null;

// Multiplayer state
let ws = null;
let myPlayerId = null;
let myCharacterType = null; // 'pacman' or 'ghost'
let myColorIndex = null;
let connectedPlayers = new Map(); // Map of playerId -> { type, colorIndex }
let multiplayerMode = false;

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
  pacmen.forEach((pacman) => {
    if (pacman && pacman.spawnPos) {
      respawnCharacter(pacman, pacman.spawnPos);
    }
  });

  ghosts.forEach((ghost) => {
    if (ghost && ghost.spawnPos) {
      respawnGhost(ghost, ghost.spawnPos);
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
  if (colorIndex === -1) return;

  // Remove selected class from all characters
  [...pacmen, ...ghosts].forEach((char) => {
    if (char?.element) char.element.classList.remove("selected");
  });

  if (type === "pacman" && pacmen[colorIndex]) {
    currentPacman = colorIndex;
    currentGhost = null;
    playerType = "pacman";
    pacmen[colorIndex].element?.classList.add("selected");
    console.log(`%cNow controlling ${colorName} pacman`, `color: ${COLORS[colorIndex]}; font-weight: bold;`);
  } else if (type === "ghost" && ghosts[colorIndex]) {
    currentGhost = colorIndex;
    currentPacman = 0;
    playerType = "ghost";
    ghosts[colorIndex].element?.classList.add("selected");
    console.log(`%cNow controlling ${colorName} ghost`, `color: ${COLORS[colorIndex]}; font-weight: bold;`);
  }
}

// Initialize WebSocket connection
function initWebSocket() {
  // Use the deployed server address
  const serverAddress = "https://pacman-fiit.onrender.com";
  // Convert https to wss for WebSocket
  const wsUrl = serverAddress.replace("https://", "wss://").replace("http://", "ws://");

  try {
    ws = new WebSocket(wsUrl);

    ws.onopen = () => {
      console.log("%cConnected to server", "color: green; font-weight: bold;");
      multiplayerMode = true;
    };

    ws.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        handleServerMessage(data);
      } catch (error) {
        console.error("Error parsing server message:", error);
      }
    };

    ws.onerror = (error) => {
      console.error("WebSocket error:", error);
      multiplayerMode = false;
    };

    ws.onclose = () => {
      console.log("%cDisconnected from server", "color: orange; font-weight: bold;");
      multiplayerMode = false;
      // Try to reconnect after 3 seconds
      setTimeout(initWebSocket, 3000);
    };
  } catch (error) {
    console.warn("WebSocket not available, running in single-player mode:", error);
    multiplayerMode = false;
  }
}

// Handle messages from server
function handleServerMessage(data) {
  switch (data.type) {
    case "connected":
      myPlayerId = data.playerId;
      console.log(`%cConnected as ${myPlayerId}`, "color: green; font-weight: bold;");
      break;
    case "joined":
      myCharacterType = data.characterType;
      myColorIndex = data.colorIndex;
      console.log(`%cJoined as ${myCharacterType} color ${myColorIndex}`, "color: green; font-weight: bold;");
      // Auto-select the character we joined as
      if (myCharacterType === "pacman") {
        selectCharacter("pacman", COLORS[myColorIndex].charAt(0).toUpperCase() + COLORS[myColorIndex].slice(1));
      } else {
        selectCharacter("ghost", COLORS[myColorIndex].charAt(0).toUpperCase() + COLORS[myColorIndex].slice(1));
      }
      break;
    case "joinFailed":
      console.error(`%cJoin failed: ${data.reason}`, "color: red; font-weight: bold;");
      break;
    case "gameState":
      // Update connected players map
      connectedPlayers.clear();
      if (data.players) {
        data.players.forEach((player) => {
          if (player.connected) {
            connectedPlayers.set(player.playerId, {
              type: player.type,
              colorIndex: player.colorIndex,
            });
          }
        });
      }
      break;
    case "playerInput":
      // Handle input from other players (for future sync)
      if (data.playerId !== myPlayerId) {
        // Apply other player's input
        applyRemoteInput(data);
      }
      break;
    case "playerLeft":
      console.log(`%cPlayer ${data.playerId} left`, "color: orange; font-weight: bold;");
      break;
  }
}

// Apply input from remote player
function applyRemoteInput(data) {
  const { characterType, colorIndex, input } = data;
  const character = characterType === "pacman" ? pacmen[colorIndex] : ghosts[colorIndex];
  if (character && input) {
    if (input.targetX !== undefined && input.targetY !== undefined) {
      character.targetX = input.targetX;
      character.targetY = input.targetY;
    }
  }
}

// Send input to server
function sendInput(input) {
  if (ws && ws.readyState === WebSocket.OPEN && myPlayerId) {
    ws.send(
      JSON.stringify({
        type: "input",
        input: input,
      })
    );
  }
}

// Join as a character
function joinAsCharacter(characterType, colorIndex) {
  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.send(
      JSON.stringify({
        type: "join",
        characterType: characterType,
        colorIndex: colorIndex,
      })
    );
  } else {
    console.warn("Not connected to server, cannot join");
  }
}

// Check if a character is player-controlled (has a connected player)
function isPlayerControlled(characterType, colorIndex) {
  if (!multiplayerMode) return false;

  // Check if this character is controlled by any connected player
  for (const [playerId, player] of connectedPlayers.entries()) {
    if (player.type === characterType && player.colorIndex === colorIndex) {
      return true;
    }
  }
  return false;
}

// Check if this is MY character
function isMyCharacter(characterType, colorIndex) {
  return multiplayerMode && myCharacterType === characterType && myColorIndex === colorIndex;
}

// Initialize game
function init() {
  // Initialize WebSocket connection
  initWebSocket();

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
      borderStyle: "double",
      borderColor: "#ffffff",
      pathBgColor: "#000000",
      wallBgColor: "transparent",
      start: () => startGame(),
      restart: () => restartGame(),
    };

    // Main controls folder - kept open
    const controlsFolder = gui.addFolder("Controls");

    controlsFolder.add(guiParams, "start").name("Start");
    controlsFolder.add(guiParams, "restart").name("Restart");
    controlsFolder
      .add(guiParams, "playerType", ["Pacman", "Ghost"])
      .name("Control")
      .onChange((value) => {
        const type = value.toLowerCase();
        selectCharacter(type, guiParams.playerColor);
      });
    controlsFolder
      .add(guiParams, "playerColor", ["Red", "Green", "Blue", "Yellow"])
      .name("Color")
      .onChange((value) => {
        selectCharacter(guiParams.playerType.toLowerCase(), value);
        // If multiplayer, try to join as this character
        if (multiplayerMode && ws && ws.readyState === WebSocket.OPEN) {
          const colorIndex = COLORS.indexOf(value.toLowerCase());
          const characterType = guiParams.playerType.toLowerCase();
          joinAsCharacter(characterType, colorIndex);
        }
      });

    controlsFolder
      .add(guiParams, "difficulty", 0, 1, 0.1)
      .name("AI Skill")
      .onChange((value) => {
        aiDifficulty = value;
      });

    // Visual settings folder - closed by default
    const visualFolder = controlsFolder.addFolder("Visual Settings");
    visualFolder
      .add(guiParams, "borderStyle", ["solid", "dashed", "dotted", "double"])
      .name("Border Style")
      .onChange((value) => {
        document.documentElement.style.setProperty("--border-style", value);
      });

    visualFolder
      .addColor(guiParams, "borderColor")
      .name("Border Color")
      .onChange((value) => {
        document.documentElement.style.setProperty("--color-wall-border", value);
      });

    visualFolder
      .addColor(guiParams, "pathBgColor")
      .name("Path Background")
      .onChange((value) => {
        document.documentElement.style.setProperty("--color-path-bg", value);
      });

    visualFolder
      .addColor(guiParams, "wallBgColor")
      .name("Wall Background")
      .onChange((value) => {
        document.documentElement.style.setProperty("--color-wall-bg", value);
      });

    // Close visual settings folder by default
    visualFolder.close();
  }
  const maze = document.getElementById("maze");
  maze.style.width = COLS * CELL_SIZE + "px";
  maze.style.height = ROWS * CELL_SIZE + "px";

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

  // Create 4 pacmen in corners
  pacmanSpawnPositions.forEach((pos, i) => {
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
      speed: 1.0, // Individual speed multiplier
      image: "", // Individual image URL
      spawnPos: { ...pos },
      element: createCharacter("pacman", COLORS[i], pos.x, pos.y),
    };
    pacmen.push(pacman);
    updateCharacterAppearance(pacman);
  });

  // Set initial player (after pacmen are created)
  selectCharacter("pacman", "Red");

  // Create 4 ghosts at spawn positions (marked with 3 in the map)
  // Use the pre-calculated ghost spawn positions
  const ghostPositions = [];
  for (let i = 0; i < 4 && i < ghostSpawnPositions.length; i++) {
    ghostPositions.push(ghostSpawnPositions[i]);
  }

  // Fill remaining positions if needed
  const defaultPositions = [
    { x: 11, y: 11 },
    { x: 12, y: 11 },
    { x: 13, y: 11 },
    { x: 14, y: 11 },
  ];
  for (let i = ghostPositions.length; i < 4; i++) {
    ghostPositions.push(defaultPositions[i - ghostPositions.length]);
  }

  ghostPositions.forEach((pos, i) => {
    const px = pos.x * CELL_SIZE + CHARACTER_OFFSET;
    const py = pos.y * CELL_SIZE + CHARACTER_OFFSET;

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

    const ghost = {
      x: pos.x,
      y: pos.y,
      px,
      py,
      targetX: initialTargetX,
      targetY: initialTargetY,
      color: COLORS[i],
      speed: 1.0,
      image: "",
      spawnPos: { ...pos },
      element: createCharacter("ghost", COLORS[i], pos.x, pos.y),
      moveTimer: 0,
      lastDirX: initialDirX,
      lastDirY: initialDirY,
      positionHistory: [],
    };
    ghosts.push(ghost);
    updateCharacterAppearance(ghost);
  });

  // Add individual character controls to GUI after characters are created
  // Colors are paired - changing one updates both pacman and ghost
  if (gui) {
    // Create color pair objects that sync both characters
    const colorPairs = COLORS.map((color, i) => {
      const colorName = color.charAt(0).toUpperCase() + color.slice(1);
      return {
        name: colorName,
        pacman: pacmen[i],
        ghost: ghosts[i],
        color: COLORS[i], // Shared color property - synced between pair
        pacmanSpeed: 1.0,
        ghostSpeed: 1.0,
        pacmanImage: "",
        ghostImage: "",
      };
    });

    // Create folders for each color pair
    COLORS.forEach((color, i) => {
      if (!pacmen[i] || !ghosts[i]) return;
      const pair = colorPairs[i];
      const colorName = color.charAt(0).toUpperCase() + color.slice(1);
      const pairFolder = gui.addFolder(`${colorName} Pair`);

      // Shared color control - updates both characters together
      pairFolder
        .addColor(pair, "color")
        .name("Color")
        .onChange((value) => {
          // Update both characters with the same color
          pair.pacman.color = value;
          pair.ghost.color = value;
          updateCharacterAppearance(pair.pacman);
          updateCharacterAppearance(pair.ghost);
        });

      // Individual speeds
      pairFolder
        .add(pair, "pacmanSpeed", 0.1, 3, 0.1)
        .name("Pacman Speed")
        .onChange((value) => {
          pair.pacman.speed = value;
        });

      pairFolder
        .add(pair, "ghostSpeed", 0.1, 3, 0.1)
        .name("Ghost Speed")
        .onChange((value) => {
          pair.ghost.speed = value;
        });

      // Individual images
      pairFolder
        .add(pair, "pacmanImage")
        .name("Pacman Image URL")
        .onChange((value) => {
          pair.pacman.image = value;
          updateCharacterAppearance(pair.pacman);
        });

      pairFolder
        .add(pair, "ghostImage")
        .name("Ghost Image URL")
        .onChange((value) => {
          pair.ghost.image = value;
          updateCharacterAppearance(pair.ghost);
        });

      // Initialize values from characters
      pair.pacmanSpeed = pair.pacman.speed;
      pair.ghostSpeed = pair.ghost.speed;
      pair.pacmanImage = pair.pacman.image;
      pair.ghostImage = pair.ghost.image;

      // Close the folder by default
      pairFolder.close();
    });
  }

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
          if (newX >= 0 && newX < COLS && newY >= 0 && newY < ROWS && isPath(newX, newY)) {
            pacman.targetX = newX;
            pacman.targetY = newY;
            // Send input to server if multiplayer
            if (multiplayerMode) {
              sendInput({ targetX: newX, targetY: newY });
            }
          }
        }
      } else if (playerType === "ghost" && currentGhost !== null) {
        const ghost = ghosts[currentGhost];
        // Only control if it's our character (local or multiplayer)
        const isControlling = !multiplayerMode || isMyCharacter("ghost", currentGhost);
        if (ghost && isAtTarget(ghost) && isControlling) {
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
          if (newX >= 0 && newX < COLS && newY >= 0 && newY < ROWS && isPath(newX, newY)) {
            ghost.targetX = newX;
            ghost.targetY = newY;
            // Update direction for smooth movement
            const dx = newX - ghost.x;
            const dy = newY - ghost.y;
            ghost.lastDirX = dx === 0 ? 0 : dx > 0 ? 1 : -1;
            ghost.lastDirY = dy === 0 ? 0 : dy > 0 ? 1 : -1;
            // Send input to server if multiplayer
            if (multiplayerMode) {
              sendInput({ targetX: newX, targetY: newY });
            }
          }
        }
      }

      // Move characters smoothly using individual speeds
      if (playerType === "pacman" && pacmen[currentPacman]) {
        moveCharacter(pacmen[currentPacman], pacmen[currentPacman].speed);
      } else if (playerType === "ghost" && currentGhost !== null && ghosts[currentGhost]) {
        moveCharacter(ghosts[currentGhost], ghosts[currentGhost].speed);
      }

      // Move all pacmen (skip player-controlled, already moved above)
      pacmen.forEach((pacman, index) => {
        // Skip if this is the local player controlling it (and not multiplayer)
        if (!multiplayerMode && playerType === "pacman" && index === currentPacman) return;
        // Skip if this pacman is controlled by a multiplayer player
        if (multiplayerMode && isPlayerControlled("pacman", index)) return;
        if (pacman) moveCharacter(pacman, pacman.speed);
      });

      // Move ghosts (skip player-controlled ghost, already moved above)
      ghosts.forEach((ghost, index) => {
        // Skip if this is the local player controlling it (and not multiplayer)
        if (!multiplayerMode && playerType === "ghost" && index === currentGhost) return;
        // Skip if this ghost is controlled by a multiplayer player
        if (multiplayerMode && isPlayerControlled("ghost", index)) return;
        if (ghost) moveCharacter(ghost, ghost.speed);
      });
    } else {
      // Game not started, just draw characters in place
      pacmen.forEach((pacman) => moveCharacter(pacman, 0));
      ghosts.forEach((ghost) => moveCharacter(ghost, 0));
    }

    // Ghost AI - always ensure they have a target (only if game started and not player-controlled)
    if (gameStarted) {
      ghosts.forEach((ghost, index) => {
        // Skip AI for player-controlled ghost (local or multiplayer)
        if (playerType === "ghost" && index === currentGhost && !multiplayerMode) {
          return;
        }
        // Skip AI if this ghost is controlled by a player (multiplayer)
        if (multiplayerMode && isPlayerControlled("ghost", index)) {
          return;
        }

        // After movement, check if ghost reached target and give it a new one immediately
        if (isAtTarget(ghost)) {
          // Ensure grid position is synced
          ghost.x = ghost.targetX;
          ghost.y = ghost.targetY;

          // If stuck or no direction, get new direction immediately
          if ((ghost.lastDirX === 0 && ghost.lastDirY === 0) || (ghost.targetX === ghost.x && ghost.targetY === ghost.y)) {
            moveGhostAI(ghost);
          } else {
            ghost.moveTimer += deltaTime;
            const moveInterval = Math.max(50, 300 - aiDifficulty * 250);

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
  const target = getTargetPixelPos(character.targetX, character.targetY);
  return Math.abs(character.px - target.x) < 0.5 && Math.abs(character.py - target.y) < 0.5;
}

function getTargetPixelPos(gridX, gridY) {
  return {
    x: gridX * CELL_SIZE + CHARACTER_OFFSET,
    y: gridY * CELL_SIZE + CHARACTER_OFFSET,
  };
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

  updatePosition(character.element, character.px, character.py);
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

function continueInCurrentDirection(ghost) {
  // Use stored direction to continue
  let newX = ghost.targetX + ghost.lastDirX;
  const newY = ghost.targetY + ghost.lastDirY;

  // Handle wrap-around for tunnel row
  if (ghost.targetY === TUNNEL_ROW) {
    if (newX < 0) newX = COLS - 1;
    else if (newX >= COLS) newX = 0;
  }

  if (newX >= 0 && newX < COLS && newY >= 0 && newY < ROWS && isPath(newX, newY)) {
    ghost.targetX = newX;
    ghost.targetY = newY;
    return;
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

    // Check if valid move
    if (newX >= 0 && newX < COLS && newY >= 0 && newY < ROWS && isPath(newX, newY)) {
      possibleMoves.push({ dir, x: dx, y: dy, newX, newY });
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

  // Filter out recently visited positions to prevent loops
  if (ghost.positionHistory?.length > 0) {
    const recentPositions = ghost.positionHistory.slice(-4);
    filteredMoves = filteredMoves.filter((move) => !recentPositions.some((pos) => pos.x === move.newX && pos.y === move.newY));
    if (filteredMoves.length === 0) filteredMoves = possibleMoves;
  }

  return filteredMoves;
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
      score += 1.0;
    }

    if (score > bestScore) {
      bestScore = score;
      bestMove = move;
    }
  });

  return bestMove || possibleMoves[0];
}

function moveGhostAI(ghost) {
  // Sync grid position
  ghost.x = ghost.targetX;
  ghost.y = ghost.targetY;

  // Update position history to prevent loops
  if (!ghost.positionHistory) ghost.positionHistory = [];
  ghost.positionHistory.push({ x: ghost.x, y: ghost.y });
  if (ghost.positionHistory.length > 6) ghost.positionHistory.shift();

  // Find the target pacman (same color) - use current grid position
  const targetPacman = pacmen.find((p) => p && p.color === ghost.color);

  // Get possible moves (avoiding walls, not turning around, and avoiding recent positions)
  const possibleMoves = getPossibleMoves(ghost);

  if (possibleMoves.length === 0) {
    console.warn(`Ghost at (${ghost.x}, ${ghost.y}) has no valid moves!`);
    ghost.positionHistory = [];
    return;
  }

  const chosenMove = !targetPacman
    ? possibleMoves[Math.floor(Math.random() * possibleMoves.length)]
    : Math.random() < aiDifficulty
    ? determineBestMove(ghost, possibleMoves, targetPacman)
    : (() => {
        const nonRecentMoves = possibleMoves.filter((move) => {
          if (!ghost.positionHistory?.length) return true;
          const recent = ghost.positionHistory.slice(-2);
          return !recent.some((pos) => pos.x === move.newX && pos.y === move.newY);
        });
        const movesToChooseFrom = nonRecentMoves.length > 0 ? nonRecentMoves : possibleMoves;
        return movesToChooseFrom[Math.floor(Math.random() * movesToChooseFrom.length)];
      })();

  if (chosenMove) {
    ghost.targetX = chosenMove.newX;
    ghost.targetY = chosenMove.newY;
    ghost.lastDirX = chosenMove.x;
    ghost.lastDirY = chosenMove.y;
  } else {
    const fallback = possibleMoves[0];
    ghost.targetX = fallback.newX;
    ghost.targetY = fallback.newY;
    ghost.lastDirX = fallback.x;
    ghost.lastDirY = fallback.y;
  }
}

function createCharacter(type, color, x, y) {
  const el = document.createElement("div");
  el.className = type;
  updatePosition(el, x * CELL_SIZE + CHARACTER_OFFSET, y * CELL_SIZE + CHARACTER_OFFSET);
  document.getElementById("maze").appendChild(el);
  return el;
}

function updateCharacterAppearance(character) {
  if (!character || !character.element) return;

  const el = character.element;
  const isPacman = el.classList.contains("pacman");
  const isGhost = el.classList.contains("ghost");

  // Remove old color classes
  COLORS.forEach((c) => el.classList.remove(c));

  // Update color
  if (character.color) {
    const colorLower = character.color.toLowerCase();
    // Check if it's a predefined color name
    if (COLORS.includes(colorLower)) {
      el.classList.add(colorLower);
      // Clear inline styles for predefined colors
      if (isPacman) el.style.background = "";
      if (isGhost) el.style.borderColor = "";
    } else {
      // Custom color (hex or CSS color) - apply directly via style
      if (isPacman) {
        el.style.background = character.color;
      } else if (isGhost) {
        el.style.borderColor = character.color;
      }
    }
  }

  // Update image
  if (character.image && character.image.trim() !== "") {
    if (isPacman) {
      el.style.backgroundImage = `url(${character.image})`;
      el.style.backgroundSize = "cover";
      el.style.backgroundPosition = "center";
      el.style.backgroundRepeat = "no-repeat";
      // If custom color, use it as fallback
      if (character.color && !COLORS.includes(character.color.toLowerCase())) {
        el.style.backgroundColor = character.color;
      }
    } else if (isGhost) {
      el.style.backgroundImage = `url(${character.image})`;
      el.style.backgroundSize = "cover";
      el.style.backgroundPosition = "center";
      el.style.backgroundRepeat = "no-repeat";
    }
  } else {
    el.style.backgroundImage = "";
    el.style.backgroundSize = "";
    el.style.backgroundPosition = "";
    el.style.backgroundRepeat = "";
  }
}

function updatePosition(element, px, py) {
  element.style.left = px + "px";
  element.style.top = py + "px";
}

function checkCollisions() {
  pacmen.forEach((pacman) => {
    if (!pacman) return;
    ghosts.forEach((ghost) => {
      if (!ghost) return;
      // Check if they're on the same grid position and same color
      if (pacman.color === ghost.color && pacman.x === ghost.x && pacman.y === ghost.y) {
        console.log(`%c${pacman.color} ghost caught ${pacman.color} pacman! Respawned.`, `color: ${pacman.color}; font-weight: bold;`);
        // Respawn both characters
        if (pacman.spawnPos) {
          respawnCharacter(pacman, pacman.spawnPos);
        }
        if (ghost.spawnPos) {
          respawnGhost(ghost, ghost.spawnPos);
        }
      }
    });
  });
}

// Handle "Enter the Dome" button click
function setupDomeEntry() {
  // Try multiple selectors to find the enter button
  const enterButtonSelectors = ["#enter-dome-button", ".enter-dome-button", "button[data-enter-dome]", "[data-enter-dome]"];

  let enterButton = null;
  for (const selector of enterButtonSelectors) {
    try {
      enterButton = document.querySelector(selector);
      if (enterButton) break;
    } catch (e) {
      // Invalid selector, try next
    }
  }

  // Also try finding by text content
  if (!enterButton) {
    const buttons = document.querySelectorAll('button, a, [role="button"]');
    buttons.forEach((btn) => {
      const text = btn.textContent?.toLowerCase() || "";
      if (text.includes("enter") && text.includes("dome")) {
        enterButton = btn;
      }
    });
  }

  if (enterButton) {
    enterButton.addEventListener("click", (e) => {
      e.preventDefault();

      // Fade out signup elements
      const signupSelectors = ["#signup", ".signup", "[data-signup]"];
      signupSelectors.forEach((sel) => {
        const elements = document.querySelectorAll(sel);
        elements.forEach((el) => el.classList.add("fade-out"));
      });

      // Fade out "try out the dome" text
      const tryOutSelectors = ["#try-out-dome", ".try-out-dome", "[data-try-out]"];
      tryOutSelectors.forEach((sel) => {
        const elements = document.querySelectorAll(sel);
        elements.forEach((el) => el.classList.add("fade-out"));
      });

      // Fade out the enter button itself
      enterButton.classList.add("fade-out");

      // Make canvas full viewport height
      const canvas = document.getElementById("webgl-canvas");
      if (canvas) {
        canvas.classList.add("full-height");
        canvas.style.height = "100vh";
      }

      // Also make body/html full height
      document.body.style.height = "100vh";
      document.documentElement.style.height = "100vh";
      document.body.style.overflow = "hidden";
    });
  }
}

// Setup drag and drop for canvas
function setupCanvasDragDrop() {
  const canvas = document.getElementById("webgl-canvas");
  if (!canvas) return;

  // Prevent default drag behaviors
  ["dragenter", "dragover", "dragleave", "drop"].forEach((eventName) => {
    canvas.addEventListener(eventName, (e) => {
      e.preventDefault();
      e.stopPropagation();
    });
  });

  // Visual feedback on drag over
  canvas.addEventListener("dragenter", () => {
    canvas.classList.add("drag-over");
  });

  canvas.addEventListener("dragover", () => {
    canvas.classList.add("drag-over");
  });

  canvas.addEventListener("dragleave", () => {
    canvas.classList.remove("drag-over");
  });

  // Handle drop
  canvas.addEventListener("drop", (e) => {
    e.preventDefault();
    e.stopPropagation();
    canvas.classList.remove("drag-over");

    const files = e.dataTransfer.files;
    if (files.length > 0) {
      // Dispatch custom event with files for WebGL handling
      const dropEvent = new CustomEvent("canvasDrop", {
        detail: { files: Array.from(files) },
      });
      canvas.dispatchEvent(dropEvent);

      console.log(`%cDropped ${files.length} file(s) on canvas`, "color: green; font-weight: bold;");
    }
  });
}

// Start game when everything is loaded
if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", () => {
    // Wait a bit for lil-gui to load
    setTimeout(init, 100);
    // Setup dome entry handler
    setTimeout(setupDomeEntry, 200);
    // Setup canvas drag and drop
    setTimeout(setupCanvasDragDrop, 200);
  });
} else {
  setTimeout(init, 100);
  setTimeout(setupDomeEntry, 200);
  setTimeout(setupCanvasDragDrop, 200);
}
