// Simple Pacman Game
// Map and grid dimensions are shared via PACMAN_MAP (see map.js)
const { MAP, COLS, ROWS, TUNNEL_ROW } = PACMAN_MAP;
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
  ghost.survivalTime = 0; // Reset survival timer on respawn
  ghost.lastSurvivalPoint = 0; // Reset survival point timer

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
let survivalTimeThreshold = 30; // seconds - ghost gets point after surviving this long
let gameStarted = false;
let lastTime = 0;
let animationId = null;
let gui = null;

// Multiplayer state
const REMOTE_SERVER_ADDRESS = "https://pacman-server-239p.onrender.com";
const LOCAL_SERVER_ADDRESS = "http://localhost:3000";
let useLocalServer = false;
let ws = null;
let myPlayerId = null;
let myCharacterType = null; // 'pacman' or 'ghost'
let myColorIndex = null;
let connectedPlayers = new Map(); // Map of playerId -> { type, colorIndex }
let multiplayerMode = false;
let lastPositionUpdate = 0;
const POSITION_UPDATE_INTERVAL = 16; // Send position updates every ~16ms (60fps)
let reconnectTimeoutId = null;

function getServerAddress() {
  return useLocalServer ? LOCAL_SERVER_ADDRESS : REMOTE_SERVER_ADDRESS;
}

// Client-side movement intent for my controlled character
// This stores the last direction key pressed so movement can continue
// Pacman-style until blocked by a wall.
let inputDirX = 0;
let inputDirY = 0;

// Game control functions
function startGame() {
  if (multiplayerMode && ws && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify({ type: "startGame" }));
  } else {
  }
}

function restartGame() {
  if (multiplayerMode && ws && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify({ type: "restartGame" }));
  } else {
  }
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
  } else if (type === "ghost" && ghosts[colorIndex]) {
    currentGhost = colorIndex;
    currentPacman = 0;
    playerType = "ghost";
    ghosts[colorIndex].element?.classList.add("selected");
  }
}

// Initialize WebSocket connection
function initWebSocket() {
  const serverAddress = getServerAddress();
  // Convert http/https to ws/wss for WebSocket
  const wsUrl = serverAddress.replace("https://", "wss://").replace("http://", "ws://");

  if (reconnectTimeoutId) {
    clearTimeout(reconnectTimeoutId);
    reconnectTimeoutId = null;
  }

  try {
    ws = new WebSocket(wsUrl);

    ws.onopen = () => {
      multiplayerMode = true;
      // Request initial game state (auto-join will be handled when it arrives)
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: "gameState" }));
      }
    };

    ws.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        handleServerMessage(data);
      } catch (error) {}
    };

    ws.onerror = (error) => {
      multiplayerMode = false;
    };

    ws.onclose = () => {
      multiplayerMode = false;
      // Try to reconnect after 3 seconds
      reconnectTimeoutId = setTimeout(initWebSocket, 3000);
    };
  } catch (error) {
    multiplayerMode = false;
  }
}

// Switch between remote Render server and local server
function switchServer(useLocal) {
  useLocalServer = useLocal;

  // Reset multiplayer identity so we don't keep stale IDs when switching backends
  myPlayerId = null;
  myCharacterType = null;
  myColorIndex = null;
  connectedPlayers.clear();
  multiplayerMode = false;

  // Stop any pending auto-reconnect from the previous connection
  if (reconnectTimeoutId) {
    clearTimeout(reconnectTimeoutId);
    reconnectTimeoutId = null;
  }

  // Cleanly close current socket without triggering its auto-reconnect logic
  if (ws) {
    try {
      ws.onclose = null;
      ws.close();
    } catch (e) {
      // ignore
    }
    ws = null;
  }

  // Immediately connect to the newly selected server
  initWebSocket();
}

// Handle messages from server
function handleServerMessage(data) {
  switch (data.type) {
    case "connected":
      myPlayerId = data.playerId;
      break;
    case "joined": {
      const newType = data.characterType;
      const newColorIndex = data.colorIndex;

      // If this joined message is identical to our current state, just log and ignore
      if (myCharacterType === newType && myColorIndex === newColorIndex) {
        break;
      }

      // Otherwise, accept the server as source of truth and update our local identity
      myCharacterType = newType;
      myColorIndex = newColorIndex;
      window.autoJoinAttempted = false; // reset flag on successful join

      // Auto-select the character we joined as so the GUI and local selection match the server
      const colorName = COLORS[myColorIndex].charAt(0).toUpperCase() + COLORS[myColorIndex].slice(1);
      if (myCharacterType === "pacman") {
        selectCharacter("pacman", colorName);
      } else {
        selectCharacter("ghost", colorName);
      }
      break;
    }
    case "joinFailed":
      // allow auto-join to try again on next gameState
      window.autoJoinAttempted = false;
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
      // Update GUI with available colors
      if (data.availableColors) {
        updateAvailableColors(data.availableColors);
      }
      // Apply server's authoritative game state (positions)
      if (data.positions) {
        applyServerPositions(data.positions);
      }
      // Update game started state
      if (data.gameStarted !== undefined) {
        gameStarted = data.gameStarted;
      }
      // Auto-join if not already joined (only once per state update)
      if (!myCharacterType && data.availableColors && !window.autoJoinAttempted) {
        window.autoJoinAttempted = true; // prevent spamming join requests
        const availablePacmen = data.availableColors.pacman || [];
        const availableGhosts = data.availableColors.ghost || [];

        // Prefer pacman, fall back to ghost
        if (availablePacmen.length > 0) {
          setTimeout(() => {
            if (!myCharacterType) {
              joinAsCharacter("pacman", availablePacmen[0]);
            }
          }, 200);
        } else if (availableGhosts.length > 0) {
          setTimeout(() => {
            if (!myCharacterType) {
              joinAsCharacter("ghost", availableGhosts[0]);
            }
          }, 200);
        } else {
          window.autoJoinAttempted = false; // allow retry when availability changes
        }
      }
      break;
    case "gameStarted":
      gameStarted = true;
      break;
    case "gameRestarted":
      gameStarted = false;
      break;
    case "playerInput":
      // Handle input from other players (for future sync)
      if (data.playerId !== myPlayerId) {
        // Apply other player's input
        applyRemoteInput(data);
      }
      break;
    case "positionUpdate":
      // Legacy: position updates are now in gameState
      if (data.positions) {
        applyServerPositions(data.positions);
      }
      break;
    case "playerLeft":
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

// Apply server's authoritative positions (for all characters)
function applyServerPositions(positions) {
  if (!positions) {
    return;
  }

  // Apply positions from server for ALL characters (server is authoritative)
  if (positions.pacmen && Array.isArray(positions.pacmen)) {
    for (let index = 0; index < positions.pacmen.length; index++) {
      const pos = positions.pacmen[index];
      if (pacmen[index] && pos) {
        // Always update pixel positions directly from server (no interpolation for server updates)
        if (pos.px !== undefined) pacmen[index].px = pos.px;
        if (pos.py !== undefined) pacmen[index].py = pos.py;

        // Update target positions
        if (pos.targetX !== undefined) pacmen[index].targetX = pos.targetX;
        if (pos.targetY !== undefined) pacmen[index].targetY = pos.targetY;

        // Update grid positions
        if (pos.x !== undefined) pacmen[index].x = pos.x;
        if (pos.y !== undefined) pacmen[index].y = pos.y;

        // Do not update DOM here; renderLoop will interpolate and render
        // This avoids fighting between server updates and client-side smoothing
      }
    }
  }

  if (positions.ghosts && Array.isArray(positions.ghosts)) {
    for (let index = 0; index < positions.ghosts.length; index++) {
      const pos = positions.ghosts[index];
      if (ghosts[index] && pos) {
        // Always update pixel positions directly from server (no interpolation for server updates)
        if (pos.px !== undefined) ghosts[index].px = pos.px;
        if (pos.py !== undefined) ghosts[index].py = pos.py;

        // Update target positions
        if (pos.targetX !== undefined) ghosts[index].targetX = pos.targetX;
        if (pos.targetY !== undefined) ghosts[index].targetY = pos.targetY;

        // Update grid positions
        if (pos.x !== undefined) ghosts[index].x = pos.x;
        if (pos.y !== undefined) ghosts[index].y = pos.y;

        // Do not update DOM here; renderLoop will interpolate and render
        // This avoids fighting between server updates and client-side smoothing
      }
    }
  }
}

// Send global speed configuration to server
function sendSpeedConfig(pacmanSpeed, ghostSpeed) {
  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.send(
      JSON.stringify({
        type: "setSpeeds",
        pacmanSpeed,
        ghostSpeed,
      })
    );
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

// Update GUI with available colors from server
function updateAvailableColors(availableColors) {
  // Update character selection controllers (radio-like) based on availability
  if (window.characterControllers) {
    ["pacman", "ghost"].forEach((type) => {
      const controllers = window.characterControllers[type] || [];
      for (let i = 0; i < controllers.length; i++) {
        const ctrl = controllers[i];
        if (!ctrl) continue;
        const isAvailable = availableColors[type] && availableColors[type].includes(i);
        if (isAvailable) {
          ctrl.enable();
        } else {
          ctrl.disable();
        }
      }
    });
  }
}

// Position updates are no longer sent - server is authoritative

// Join as a character
function joinAsCharacter(characterType, colorIndex) {
  // If we're already this character, don't re-join
  if (myCharacterType === characterType && myColorIndex === colorIndex) {
    return;
  }

  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.send(
      JSON.stringify({
        type: "join",
        characterType: characterType,
        colorIndex: colorIndex,
      })
    );
  } else {
    window.autoJoinAttempted = false;
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
      serverTarget: "Render",
      difficulty: 0.8,
      pacmanSpeed: 0.4,
      ghostSpeed: 0.4,
      playerType: "Pacman",
      playerColor: "Red",
      start: () => startGame(),
      restart: () => restartGame(),
    };

    // Main controls at root (no folders)
    gui.add(guiParams, "start").name("Start");
    gui.add(guiParams, "restart").name("Restart");

    gui
      .add(guiParams, "serverTarget", ["Render", "Local"])
      .name("Server")
      .onChange((value) => {
        switchServer(value === "Local");
      });

    // Auto-join is now handled via character selection UI and server availability

    gui
      .add(guiParams, "difficulty", 0, 1, 0.1)
      .name("AI Skill")
      .onChange((value) => {
        aiDifficulty = value;
      });

    // Global speed controls
    gui
      .add(guiParams, "pacmanSpeed", 0.2, 3, 0.1)
      .name("Pacman Speed")
      .onChange((value) => {
        sendSpeedConfig(value, guiParams.ghostSpeed);
      });

    gui
      .add(guiParams, "ghostSpeed", 0.2, 3, 0.1)
      .name("Ghost Speed")
      .onChange((value) => {
        sendSpeedConfig(guiParams.pacmanSpeed, value);
      });

    // Character selection: one entry per pacman/ghost/color at root
    const joinActions = {};
    window.characterControllers = { pacman: [], ghost: [] };

    COLORS.forEach((color, i) => {
      const colorName = color.charAt(0).toUpperCase() + color.slice(1);
      const pacmanKey = `Pacman ${colorName}`;
      const ghostKey = `Ghost ${colorName}`;

      joinActions[pacmanKey] = () => {
        joinAsCharacter("pacman", i);
      };
      joinActions[ghostKey] = () => {
        joinAsCharacter("ghost", i);
      };

      const pacCtrl = gui.add(joinActions, pacmanKey);
      const ghostCtrl = gui.add(joinActions, ghostKey);
      window.characterControllers.pacman[i] = pacCtrl;
      window.characterControllers.ghost[i] = ghostCtrl;
    });
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
      // Default pacman speed (kept in sync with server)
      speed: 1.0,
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
      survivalTime: 0, // Time since last respawn in seconds
      lastSurvivalPoint: 0, // Last time a survival point was awarded
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

  // (Per-color pair GUI controls and scoring have been removed for now)

  // Keyboard controls
  const keys = {};
  document.addEventListener("keydown", (e) => {
    keys[e.key] = true;
  });
  document.addEventListener("keyup", (e) => {
    keys[e.key] = false;
  });

  // Render loop - smooths visual positions toward server state
  // Server sends authoritative pixel positions; we interpolate for smoother motion
  function renderLoop() {
    // Smoothing factors
    const OTHER_SMOOTHING = 0.25;
    // My own character follows the server almost exactly to minimize input latency
    const MY_SMOOTHING = 1.0;
    const SNAP_DISTANCE = 40; // pixels – snap if too far to avoid long slides

    pacmen.forEach((pacman, index) => {
      if (!pacman || !pacman.element) return;

      const isMine = myCharacterType === "pacman" && myColorIndex === index;
      // Use slightly higher smoothing for others; my own character follows the server a bit more tightly
      const smoothing = isMine ? MY_SMOOTHING : OTHER_SMOOTHING;

      if (pacman.renderX === undefined) {
        pacman.renderX = pacman.px;
        pacman.renderY = pacman.py;
      } else {
        const dx = pacman.px - pacman.renderX;
        const dy = pacman.py - pacman.renderY;
        const dist = Math.sqrt(dx * dx + dy * dy);
        if (dist > SNAP_DISTANCE) {
          pacman.renderX = pacman.px;
          pacman.renderY = pacman.py;
        } else {
          pacman.renderX += dx * smoothing;
          pacman.renderY += dy * smoothing;
        }
      }

      updatePosition(pacman.element, pacman.renderX, pacman.renderY);
    });

    ghosts.forEach((ghost, index) => {
      if (!ghost || !ghost.element) return;

      const isMine = myCharacterType === "ghost" && myColorIndex === index;
      const smoothing = isMine ? MY_SMOOTHING : OTHER_SMOOTHING;

      if (ghost.renderX === undefined) {
        ghost.renderX = ghost.px;
        ghost.renderY = ghost.py;
      } else {
        const dx = ghost.px - ghost.renderX;
        const dy = ghost.py - ghost.renderY;
        const dist = Math.sqrt(dx * dx + dy * dy);
        if (dist > SNAP_DISTANCE) {
          ghost.renderX = ghost.px;
          ghost.renderY = ghost.py;
        } else {
          ghost.renderX += dx * smoothing;
          ghost.renderY += dy * smoothing;
        }
      }

      updatePosition(ghost.element, ghost.renderX, ghost.renderY);
    });

    animationId = requestAnimationFrame(renderLoop);
  }

  // Handle player input - send direction to server
  document.addEventListener("keydown", (e) => {
    keys[e.key] = true;
    // Only process arrow keys
    if (!["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(e.key)) {
      return;
    }

    const canMove = multiplayerMode && myPlayerId && myCharacterType && myColorIndex !== null;
    if (!canMove) return;

    let dir = null;
    if (e.key === "ArrowLeft") dir = "left";
    else if (e.key === "ArrowRight") dir = "right";
    else if (e.key === "ArrowUp") dir = "up";
    else if (e.key === "ArrowDown") dir = "down";

    if (dir) {
      sendInput({ dir });
    }
  });
  document.addEventListener("keyup", (e) => {
    keys[e.key] = false;
  });

  // Start the render loop
  animationId = requestAnimationFrame(renderLoop);
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
        // Award point to ghost (chaser)
        ghost.score++;
        if (ghost.scoreObj) {
          ghost.scoreObj.ghostScore = ghost.score;
        }

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

