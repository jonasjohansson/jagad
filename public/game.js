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
// Sort spawn positions to match server order: red, green, blue, yellow
// Order: top-left, top-right, bottom-left, bottom-right
ghostSpawnPositions.sort((a, b) => {
  if (a.y !== b.y) return a.y - b.y; // Sort by row first (top to bottom)
  return a.x - b.x; // Then by column (left to right)
});

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
  // Treat 0 (path), 2 (teleport), 3 (chaser spawn), and 4 (fugitive spawn) as walkable paths
  return cell === 0 || cell === 2 || cell === 3 || cell === 4;
}

function shouldCreateBorder(x, y) {
  if (x < 0 || x >= COLS || y < 0 || y >= ROWS) return false;
  const cell = MAP[y][x];
  // Treat 0 (path), 2 (teleport), 3 (chaser spawn), and 4 (fugitive spawn) as paths for border rendering
  return cell === 0 || cell === 2 || cell === 3 || cell === 4;
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
let currentPacman = null; // null means no character selected
let currentGhost = null; // null means no character selected
let playerType = "pacman"; // "pacman" or "ghost"
let aiDifficulty = 0.8; // 0 = easy, 1 = hard
let survivalTimeThreshold = 30; // seconds - ghost gets point after surviving this long
let gameStarted = false;
let view3D = true; // Toggle for 3D view
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
  // Start the game cycle
  if (multiplayerMode && ws && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify({ type: "startGame" }));
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
    currentPacman = null;
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
      // Request initial game state
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

      // Auto-select the character we joined as so the GUI and local selection match the server
      // All chasers are white, so use white for selection
      if (myCharacterType === "chaser" || myCharacterType === "ghost") {
        selectCharacter("ghost", "white");
      }
      // Game starts when "Start game cycle" button is pressed (handled by server)
      break;
    }
    case "joinFailed":
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
              stats: player.stats || null,
            });
          }
        });
        // Update score display if we have stats
        updateScoreDisplay();
      }
      // Update GUI with available colors
      if (data.availableColors) {
        updateAvailableColors(data.availableColors);
      }
      // Apply server's authoritative game state (positions)
      if (data.positions) {
        applyServerPositions(data.positions);

        // Update 3D view if enabled
        if (view3D && window.render3D) {
          window.render3D.updatePositions(data.positions);
        }
      }

      // Update game started state
      if (data.gameStarted !== undefined) {
        gameStarted = data.gameStarted;
      }
      // No auto-join - player must manually select a character
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
    case "roundEnd":
      // Flash effect when a round ends
      if (data.chaserColorIndex >= 0 && data.fugitiveColorIndex >= 0) {
        flashCharacters(data.chaserColorIndex, data.fugitiveColorIndex);
      }
      break;
    case "roundsComplete":
      // Show alert when current player completes 10 rounds
      // The server sends this message directly to the player's WebSocket, so if we receive it, it's for us
      alert(
        `You've completed 10 rounds!\n\nChaser Score: ${data.chaserScore}\nFugitive Score: ${data.fugitiveScore}\nTotal Rounds: ${data.totalRounds}`
      );
      // Clear our character selection (we've been kicked out)
      myCharacterType = null;
      myColorIndex = null;
      // Clear visual selection
      [...pacmen, ...ghosts].forEach((char) => {
        if (char?.element) char.element.classList.remove("selected");
      });
      currentPacman = null;
      currentGhost = null;
      // Update score display
      updateScoreDisplay();
      break;
    case "gameEnd":
      // Game ended - show final score
      const timeSeconds = (data.gameTime / 1000).toFixed(1);
      const message = data.allCaught
        ? `Game Over - All Fugitives Caught!\n\nTime: ${timeSeconds}s\nScore: ${data.score}\nFugitives Caught: ${data.fugitivesCaught}/${data.totalFugitives}`
        : `Game Over - Time's Up!\n\nTime: ${timeSeconds}s\nScore: ${data.score}\nFugitives Caught: ${data.fugitivesCaught}/${data.totalFugitives}`;
      alert(message);
      // Update score display
      updateScoreDisplay();
      break;
    case "fugitiveCaught":
      // A fugitive was caught - could show visual feedback here
      break;
    case "gameReset":
      // Game was reset - clear caught state and player selection
      gameStarted = false;
      // Clear our character selection (players lose selection when game resets)
      myCharacterType = null;
      myColorIndex = null;
      // Clear visual selection
      [...pacmen, ...ghosts].forEach((char) => {
        if (char?.element) char.element.classList.remove("selected");
      });
      currentPacman = null;
      currentGhost = null;
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
function sendSpeedConfig(fugitiveSpeed, chaserSpeed, survivalTimeThreshold, chaserSpeedIncreasePerRound) {
  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.send(
      JSON.stringify({
        type: "setSpeeds",
        fugitiveSpeed,
        chaserSpeed,
        survivalTimeThreshold,
        chaserSpeedIncreasePerRound,
        // Legacy support
        pacmanSpeed: fugitiveSpeed,
        ghostSpeed: chaserSpeed,
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
function updateScoreDisplay() {
  if (!window.scoreDisplay || !myPlayerId) return;

  const myPlayer = connectedPlayers.get(myPlayerId);
  if (myPlayer && myPlayer.stats) {
    window.scoreDisplay.chaserScore.setValue(myPlayer.stats.chaserScore || 0);
    window.scoreDisplay.fugitiveScore.setValue(myPlayer.stats.fugitiveScore || 0);
    window.scoreDisplay.rounds.setValue(myPlayer.stats.rounds || 0);
  }
}

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

  // Check if all slots are full (queue needed)
  const allPacmenFull = !availableColors.pacman || availableColors.pacman.length === 0;
  const allGhostsFull = !availableColors.ghost || availableColors.ghost.length === 0;
  const allSlotsFull = allPacmenFull && allGhostsFull;

  // Show/hide Join Queue button based on availability
  if (window.joinQueueController) {
    if (allSlotsFull) {
      window.joinQueueController.show();
    } else {
      window.joinQueueController.hide();
    }
  }
}

// Position updates are no longer sent - server is authoritative

// Join as a character
function joinAsCharacter(characterType, colorIndex, playerName = "AI") {
  // If we're already this character, don't re-join
  if (myCharacterType === characterType && myColorIndex === colorIndex) {
    return;
  }

  // Validate and sanitize player name (3 uppercase letters)
  const sanitized =
    playerName
      .toUpperCase()
      .replace(/[^A-Z]/g, "")
      .slice(0, 3) || "AI";

  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.send(
      JSON.stringify({
        type: "join",
        characterType: characterType,
        colorIndex: colorIndex,
        playerName: sanitized,
      })
    );
  }
}

// Join queue after completing 10 rounds
function joinQueue() {
  // Queue system: wait for an available slot
  // For now, just show a message - full queue system to be implemented
  if (ws && ws.readyState === WebSocket.OPEN) {
    // Request current game state to check availability
    ws.send(JSON.stringify({ type: "gameState" }));
    alert("You're in the queue! Waiting for an available slot...");
  }
}

// Toggle between 2D and 3D view
function toggle3DView(enabled) {
  const gameContainer = document.getElementById("game-container");
  const canvas = document.getElementById("webgl-canvas");
  const buildingImage = document.getElementById("building-image");
  const buildingRealImage = document.getElementById("building-real-image");

  if (enabled) {
    // Hide 2D view, show 3D canvas
    if (gameContainer) gameContainer.style.display = "none";
    if (canvas) canvas.style.display = "block";
    // Keep building images visible in 3D mode
    if (buildingImage) buildingImage.style.display = "block";
    if (buildingRealImage) buildingRealImage.style.display = "block";

    // Initialize 3D if not already initialized
    if (window.render3D && !window.render3D.initialized) {
      window.render3D.init();
      window.render3D.initialized = true;
    }

    // Show lighting and color controls
    if (window.lightControllers) {
      window.lightControllers.ambient.show();
      window.lightControllers.directional.show();
      window.lightControllers.point.show();
      window.lightControllers.pathColor.show();
      window.lightControllers.cameraZoom.show();
    }
    // Hide 2D-only controls
    if (window.view2DControllers) {
      window.view2DControllers.mazeOpacity.hide();
    }

    // Initialize 3D wall colors and path color from current GUI params
    if (window.render3D) {
      if (window.render3D.setInnerWallColor) {
        window.render3D.setInnerWallColor(guiParams.innerWallColor);
      }
      if (window.render3D.setOuterWallColor) {
        window.render3D.setOuterWallColor(guiParams.outerWallColor);
      }
      if (window.render3D.setPathColor) {
        window.render3D.setPathColor(guiParams.pathColor);
      }
      // Initialize color overrides if set (only if different from default)
      const defaultColors = ["#ff0000", "#00ff00", "#0000ff", "#ffff00"];
      COLORS.forEach((colorName, colorIndex) => {
        const colorKey = `${colorName}Color`;
        const overrideColor = guiParams[colorKey];
        if (overrideColor && overrideColor !== defaultColors[colorIndex] && window.render3D.setColorOverride) {
          window.render3D.setColorOverride(colorIndex, overrideColor);
        }
        // Initialize team images
        const imageKey = `team${colorIndex + 1}Image`;
        const teamImage = guiParams[imageKey];
        if (teamImage && teamImage.trim() !== "" && window.render3D.setTeamImage) {
          window.render3D.setTeamImage(colorIndex, teamImage);
        }
      });
      // Initialize camera zoom
      if (window.render3D.setCameraZoom) {
        window.render3D.setCameraZoom(guiParams.cameraZoom);
      }
    }
  } else {
    // Show 2D view, hide 3D canvas
    if (gameContainer) gameContainer.style.display = "block";
    if (canvas) canvas.style.display = "none";
    // Keep building images visible in 2D mode
    if (buildingImage) buildingImage.style.display = "block";
    if (buildingRealImage) buildingRealImage.style.display = "block";

    // Hide lighting and color controls
    if (window.lightControllers) {
      window.lightControllers.ambient.hide();
      window.lightControllers.directional.hide();
      window.lightControllers.point.hide();
      window.lightControllers.pathColor.hide();
      window.lightControllers.cameraZoom.hide();
    }
    // Show 2D-only controls
    if (window.view2DControllers) {
      window.view2DControllers.mazeOpacity.show();
    }

    // Cleanup 3D if needed
    if (window.render3D && window.render3D.initialized) {
      window.render3D.cleanup();
      window.render3D.initialized = false;
    }
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

    // Make guiParams global so it can be accessed by updateCharacterAppearance
    window.guiParams = {
      serverTarget: "Render",
      difficulty: 0.8,
      fugitiveSpeed: 0.4,
      chaserSpeed: 0.4,
      playerInitials: "ABC", // 3-letter initials
      survivalTimeThreshold: 10, // Seconds required to survive a round (default 10)
      chaserSpeedIncreasePerRound: 0.01, // Chaser speed increase per round (1% = 0.01)
      view3D: true, // Toggle for 3D view
      camera3D: "Orthographic", // Camera type for 3D view
      cameraZoom: 1.2, // Camera zoom level (0.5 to 2.0)
      ambientLightIntensity: 0.1, // Global ambient light intensity
      directionalLightIntensity: 0.3, // Global directional light intensity
      pointLightIntensity: 100, // Point light intensity for characters (0-400 range)
      pathColor: "#dddddd", // Path/floor color in hex (light gray)
      innerWallColor: "#ffffff", // Inner wall color in hex (white)
      outerWallColor: "#ffffff", // Outer wall color in hex (white)
      bodyBackgroundColor: "#555555", // Body background color in hex
      buildingOpacity: 0.0, // Building image opacity (0-1)
      buildingRealOpacity: 1.0, // Building real image opacity (0-1)
      buildingRealScale: 1.1, // Building real image scale (0.1-3.0)
      buildingRealX: 9, // Building real image X position offset (px)
      buildingRealY: 9, // Building real image Y position offset (px)
      buildingRealBlendMode: "soft-light", // Building real image blend mode
      mazeOpacity: 1.0, // Maze opacity (0-1)
      redColor: "#ff0000", // Red color override
      greenColor: "#00ff00", // Green color override
      blueColor: "#0000ff", // Blue color override
      yellowColor: "#ffff00", // Yellow color override
      team1Image: "assets/team1.jpg", // Team 1 image path (empty = no image)
      team2Image: "assets/team2.jpg", // Team 2 image path (empty = no image)
      team3Image: "assets/team3.jpg", // Team 3 image path (empty = no image)
      team4Image: "assets/team4.jpg", // Team 4 image path (empty = no image)
      startGameCycle: () => startGame(),
      resetGameCycle: () => restartGame(),
      joinQueue: () => joinQueue(),
    };

    // Main controls at root (no folders)
    gui
      .add(guiParams, "playerInitials")
      .name("Initials (3 letters)")
      .onChange((value) => {
        // Validate and sanitize to 3 uppercase letters
        const sanitized = value
          .toUpperCase()
          .replace(/[^A-Z]/g, "")
          .slice(0, 3);
        guiParams.playerInitials = sanitized;
        if (value !== sanitized) {
          // Update the GUI control if value was changed
          const controllers = gui.controllers;
          const initialsCtrl = controllers.find((c) => c.property === "playerInitials");
          if (initialsCtrl) initialsCtrl.updateDisplay();
        }
      });

    // Game cycle controls
    gui.add(guiParams, "startGameCycle").name("Start game cycle");
    gui.add(guiParams, "resetGameCycle").name("Reset game cycle");

    // Server control
    gui
      .add(guiParams, "serverTarget", ["Render", "Local"])
      .name("Server")
      .onChange((value) => {
        switchServer(value === "Local");
      });

    // Create 2D/3D folder
    const view3DFolder = gui.addFolder("2D/3D");
    view3DFolder.open(); // Open by default

    // 3D view toggle
    view3DFolder
      .add(guiParams, "view3D")
      .name("3D View")
      .onChange((value) => {
        view3D = value;
        toggle3DView(value);
      });

    // 3D camera type toggle
    view3DFolder
      .add(guiParams, "camera3D", ["Orthographic", "Perspective"])
      .name("3D Camera")
      .onChange((value) => {
        if (view3D && window.render3D && window.render3D.setCameraType) {
          // Set camera type based on selection
          const shouldBeOrthographic = value === "Orthographic";
          window.render3D.setCameraType(shouldBeOrthographic);
        }
      });

    // Camera zoom slider (only visible when 3D view is enabled)
    const cameraZoomCtrl = view3DFolder
      .add(guiParams, "cameraZoom", 0.5, 2.0, 0.01)
      .name("Camera Zoom")
      .onChange((value) => {
        if (view3D && window.render3D && window.render3D.setCameraZoom) {
          window.render3D.setCameraZoom(value);
        }
      });
    cameraZoomCtrl.hide(); // Hidden from GUI

    // 3D lighting controls (only visible when 3D view is enabled)
    const ambientLightCtrl = view3DFolder
      .add(guiParams, "ambientLightIntensity", 0, 2, 0.1)
      .name("Ambient Light")
      .onChange((value) => {
        if (view3D && window.render3D && window.render3D.setAmbientLight) {
          window.render3D.setAmbientLight(value);
        }
      });
    ambientLightCtrl.hide(); // Hidden by default

    const directionalLightCtrl = view3DFolder
      .add(guiParams, "directionalLightIntensity", 0, 2, 0.1)
      .name("Directional Light")
      .onChange((value) => {
        if (view3D && window.render3D && window.render3D.setDirectionalLight) {
          window.render3D.setDirectionalLight(value);
        }
      });
    directionalLightCtrl.hide(); // Hidden by default

    const pointLightCtrl = view3DFolder
      .add(guiParams, "pointLightIntensity", 0, 400, 1)
      .name("Point Light Intensity")
      .onChange((value) => {
        if (view3D && window.render3D && window.render3D.setPointLightIntensity) {
          window.render3D.setPointLightIntensity(value);
        }
      });
    pointLightCtrl.hide(); // Hidden by default

    // Create Style folder for grouped controls
    const styleFolder = gui.addFolder("Style");
    styleFolder.open(); // Open by default

    // Inner wall color control (affects both 2D borders and 3D materials)
    styleFolder
      .addColor(guiParams, "innerWallColor")
      .name("Inner Wall Color")
      .onChange((value) => {
        // Update 2D border color
        document.documentElement.style.setProperty("--color-inner-wall-border", value);
        // Update 3D material color
        if (view3D && window.render3D && window.render3D.setInnerWallColor) {
          window.render3D.setInnerWallColor(value);
        }
      });

    // Outer wall color control (affects both 2D borders and 3D materials)
    styleFolder
      .addColor(guiParams, "outerWallColor")
      .name("Outer Wall Color")
      .onChange((value) => {
        // Update 2D border color
        document.documentElement.style.setProperty("--color-outer-wall-border", value);
        // Update 3D material color
        if (view3D && window.render3D && window.render3D.setOuterWallColor) {
          window.render3D.setOuterWallColor(value);
        }
      });

    // Body background color control
    styleFolder
      .addColor(guiParams, "bodyBackgroundColor")
      .name("Body Background Color")
      .onChange((value) => {
        document.body.style.backgroundColor = value;
      });

    // Path color control (only visible when 3D view is enabled)
    const pathColorCtrl = styleFolder
      .addColor(guiParams, "pathColor")
      .name("Path Color")
      .onChange((value) => {
        if (view3D && window.render3D && window.render3D.setPathColor) {
          window.render3D.setPathColor(value);
        }
      });
    pathColorCtrl.hide(); // Hidden by default

    // Maze opacity slider (only visible in 2D mode)
    const mazeOpacityCtrl = styleFolder
      .add(guiParams, "mazeOpacity", 0, 1, 0.01)
      .name("Maze Opacity")
      .onChange((value) => {
        const maze = document.getElementById("maze");
        if (maze) {
          maze.style.opacity = value;
        }
      });
    // Visible by default (2D mode is default)

    // Create Building folder for building image controls
    const buildingFolder = gui.addFolder("Building");
    buildingFolder.open(); // Open by default

    // Building image opacity slider
    buildingFolder
      .add(guiParams, "buildingOpacity", 0, 1, 0.01)
      .name("Building Opacity")
      .onChange((value) => {
        const buildingImage = document.getElementById("building-image");
        if (buildingImage) {
          buildingImage.style.opacity = value;
        }
      });

    // Building real image opacity slider
    buildingFolder
      .add(guiParams, "buildingRealOpacity", 0, 1, 0.01)
      .name("Building Real Opacity")
      .onChange((value) => {
        const buildingRealImage = document.getElementById("building-real-image");
        if (buildingRealImage) {
          buildingRealImage.style.opacity = value;
        }
      });

    // Helper function to update building-real transform
    const updateBuildingRealTransform = () => {
      const buildingRealImage = document.getElementById("building-real-image");
      if (buildingRealImage) {
        const translate = `translate(calc(-50% + ${guiParams.buildingRealX}px), calc(-50% + ${guiParams.buildingRealY}px))`;
        buildingRealImage.style.transform = `${translate} scale(${guiParams.buildingRealScale})`;
      }
    };

    // Building real image scale slider
    buildingFolder
      .add(guiParams, "buildingRealScale", 0.1, 3.0, 0.01)
      .name("Building Real Scale")
      .onChange(() => {
        updateBuildingRealTransform();
      });

    // Building real image X position slider
    const buildingRealXCtrl = buildingFolder
      .add(guiParams, "buildingRealX", -500, 500, 1)
      .name("Building Real X")
      .onChange(() => {
        updateBuildingRealTransform();
      });
    buildingRealXCtrl.hide(); // Hidden from GUI

    // Building real image Y position slider
    const buildingRealYCtrl = buildingFolder
      .add(guiParams, "buildingRealY", -500, 500, 1)
      .name("Building Real Y")
      .onChange(() => {
        updateBuildingRealTransform();
      });
    buildingRealYCtrl.hide(); // Hidden from GUI

    // Building real image blend mode selector
    buildingFolder
      .add(guiParams, "buildingRealBlendMode", [
        "normal",
        "multiply",
        "screen",
        "overlay",
        "darken",
        "lighten",
        "color-dodge",
        "color-burn",
        "hard-light",
        "soft-light",
        "difference",
        "exclusion",
        "hue",
        "saturation",
        "color",
        "luminosity",
      ])
      .name("Building Real Blend Mode")
      .onChange((value) => {
        const buildingRealImage = document.getElementById("building-real-image");
        if (buildingRealImage) {
          buildingRealImage.style.mixBlendMode = value;
        }
      });

    // Set initial body background color
    document.body.style.backgroundColor = guiParams.bodyBackgroundColor;

    // Set initial opacity values
    const buildingImage = document.getElementById("building-image");
    if (buildingImage) {
      buildingImage.style.opacity = guiParams.buildingOpacity;
    }
    const buildingRealImage = document.getElementById("building-real-image");
    if (buildingRealImage) {
      buildingRealImage.style.opacity = guiParams.buildingRealOpacity;
      // Set initial transform with scale and position
      const translate = `translate(calc(-50% + ${guiParams.buildingRealX}px), calc(-50% + ${guiParams.buildingRealY}px))`;
      buildingRealImage.style.transform = `${translate} scale(${guiParams.buildingRealScale})`;
      // Set initial blend mode
      buildingRealImage.style.mixBlendMode = guiParams.buildingRealBlendMode;
    }
    const maze = document.getElementById("maze");
    if (maze) {
      maze.style.opacity = guiParams.mazeOpacity;
    }

    // Set initial wall color values for 2D
    document.documentElement.style.setProperty("--color-inner-wall-border", guiParams.innerWallColor);
    document.documentElement.style.setProperty("--color-outer-wall-border", guiParams.outerWallColor);

    // Initialize 3D wall colors (will be applied when 3D mode is enabled)
    // This ensures colors are set correctly when switching to 3D mode

    // Store controllers for showing/hiding
    window.lightControllers = {
      ambient: ambientLightCtrl,
      directional: directionalLightCtrl,
      point: pointLightCtrl,
      pathColor: pathColorCtrl,
      cameraZoom: cameraZoomCtrl,
    };
    window.view2DControllers = {
      mazeOpacity: mazeOpacityCtrl,
    };

    // Join Queue button (only shown when all slots are full)
    window.joinQueueController = gui.add(guiParams, "joinQueue").name("Join Queue");
    window.joinQueueController.hide(); // Hidden by default

    // Auto-join is now handled via character selection UI and server availability

    // Create Characters & Scoring folder
    const charactersFolder = gui.addFolder("Characters & Scoring");
    charactersFolder.close(); // Closed by default

    // AI Skill control
    charactersFolder
      .add(guiParams, "difficulty", 0, 1, 0.1)
      .name("AI Skill")
      .onChange((value) => {
        aiDifficulty = value;
      });

    // Global speed controls
    charactersFolder
      .add(guiParams, "fugitiveSpeed", 0.2, 3, 0.1)
      .name("Fugitive Speed")
      .onChange((value) => {
        sendSpeedConfig(value, guiParams.chaserSpeed, guiParams.survivalTimeThreshold, guiParams.chaserSpeedIncreasePerRound);
      });

    charactersFolder
      .add(guiParams, "chaserSpeed", 0.2, 3, 0.1)
      .name("Chaser Speed")
      .onChange((value) => {
        sendSpeedConfig(guiParams.fugitiveSpeed, value, guiParams.survivalTimeThreshold, guiParams.chaserSpeedIncreasePerRound);
      });

    // Survival time threshold control
    charactersFolder
      .add(guiParams, "survivalTimeThreshold", 1, 120, 1)
      .name("Survival Duration (seconds)")
      .onChange((value) => {
        sendSpeedConfig(guiParams.fugitiveSpeed, guiParams.chaserSpeed, value, guiParams.chaserSpeedIncreasePerRound);
      });

    // Chaser speed increase per round control
    charactersFolder
      .add(guiParams, "chaserSpeedIncreasePerRound", 0, 0.05, 0.01)
      .name("Chaser Speed Increase Per Round")
      .onChange((value) => {
        sendSpeedConfig(guiParams.fugitiveSpeed, guiParams.chaserSpeed, guiParams.survivalTimeThreshold, value);
      });

    // Character selection: one entry per pacman/ghost/color
    const joinActions = {};
    window.characterControllers = { pacman: [], ghost: [] };

    // Names for each fugitive color
    const fugitiveNames = [
      "Viktor & Samir", // Red (index 0)
      "Maria & Sara", // Green (index 1)
      "Anja & Filippa", // Blue (index 2)
      "Hasse & Glenn", // Yellow (index 3)
    ];

    // Players can only join as chasers (fugitives are AI-controlled)
    // Add chasers (all are white and can catch any fugitive)
    // Chaser 0 is always present but not available for players, so only show 1, 2, 3
    for (let i = 1; i < 4; i++) {
      const chaserKey = `Chaser ${i}`;

      joinActions[chaserKey] = () => {
        joinAsCharacter("chaser", i, guiParams.playerInitials);
      };

      const chaserCtrl = charactersFolder.add(joinActions, chaserKey);
      window.characterControllers.ghost[i] = chaserCtrl;
    }

    // Color controls for each team (Team 1, Team 2, Team 3, Team 4)
    COLORS.forEach((colorName, colorIndex) => {
      const colorKey = `${colorName}Color`;
      const teamNumber = colorIndex + 1;
      const displayName = `Team ${teamNumber} Color`;

      const defaultColors = ["#ff0000", "#00ff00", "#0000ff", "#ffff00"];
      const colorCtrl = charactersFolder
        .addColor(guiParams, colorKey)
        .name(displayName)
        .onChange((value) => {
          // Check if value is the default color (means user wants to use default)
          const isDefault = value === defaultColors[colorIndex];

          // Update 3D characters of this color (both fugitive and chaser)
          if (view3D && window.render3D && window.render3D.setColorOverride) {
            window.render3D.setColorOverride(colorIndex, isDefault ? null : value);
          }

          // Update 2D fugitive of this color
          if (pacmen[colorIndex] && pacmen[colorIndex].element) {
            if (isDefault) {
              // Reset to default color
              updateCharacterAppearance(pacmen[colorIndex]);
            } else {
              pacmen[colorIndex].element.style.background = value;
              pacmen[colorIndex].element.style.borderColor = value;
              // Remove predefined color classes
              COLORS.forEach((c) => pacmen[colorIndex].element.classList.remove(c));
            }
          }

          // Update 2D chaser of this color
          if (ghosts[colorIndex] && ghosts[colorIndex].element) {
            if (isDefault) {
              // Reset to default color
              updateCharacterAppearance(ghosts[colorIndex]);
            } else {
              ghosts[colorIndex].element.style.borderColor = value;
              // Remove predefined color classes
              COLORS.forEach((c) => ghosts[colorIndex].element.classList.remove(c));
            }
          }
        });

      // Team image control (for fugitives only)
      const imageKey = `team${teamNumber}Image`;
      charactersFolder
        .add(guiParams, imageKey)
        .name(`Team ${teamNumber} Image`)
        .onChange((value) => {
          // Update 2D fugitive image
          if (pacmen[colorIndex] && pacmen[colorIndex].element) {
            if (value && value.trim() !== "") {
              pacmen[colorIndex].element.style.backgroundImage = `url(${value})`;
              pacmen[colorIndex].element.style.backgroundSize = "cover";
              pacmen[colorIndex].element.style.backgroundPosition = "center";
              pacmen[colorIndex].element.style.backgroundRepeat = "no-repeat";
            } else {
              pacmen[colorIndex].element.style.backgroundImage = "";
              pacmen[colorIndex].element.style.backgroundSize = "";
              pacmen[colorIndex].element.style.backgroundPosition = "";
              pacmen[colorIndex].element.style.backgroundRepeat = "";
              updateCharacterAppearance(pacmen[colorIndex]);
            }
          }

          // Update 3D fugitive image
          if (view3D && window.render3D && window.render3D.setTeamImage) {
            window.render3D.setTeamImage(colorIndex, value);
          }
        });
    });

    // Score display
    window.scoreDisplay = {
      chaserScore: charactersFolder.add({ value: 0 }, "value").name("Chaser Score").disable(),
      fugitiveScore: charactersFolder.add({ value: 0 }, "value").name("Fugitive Score").disable(),
      rounds: charactersFolder.add({ value: 0 }, "value").name("Rounds").disable(),
    };

    // Apply team images to existing characters after GUI is initialized
    COLORS.forEach((colorName, colorIndex) => {
      const imageKey = `team${colorIndex + 1}Image`;
      const teamImage = guiParams[imageKey];
      if (teamImage && teamImage.trim() !== "" && pacmen[colorIndex] && pacmen[colorIndex].element) {
        pacmen[colorIndex].element.style.backgroundImage = `url(${teamImage})`;
        pacmen[colorIndex].element.style.backgroundSize = "cover";
        pacmen[colorIndex].element.style.backgroundPosition = "center";
        pacmen[colorIndex].element.style.backgroundRepeat = "no-repeat";
      }
    });

    // Send initial speed config to server (including chaserSpeedIncreasePerRound)
    sendSpeedConfig(guiParams.fugitiveSpeed, guiParams.chaserSpeed, guiParams.survivalTimeThreshold, guiParams.chaserSpeedIncreasePerRound);

    // Enable 3D view on startup if default is true
    if (guiParams.view3D) {
      toggle3DView(true);
    }
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

        // Mark outer walls (walls on the border of the map)
        if (isEdge) {
          classes.push("outer-wall");
        }

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

  // No initial character selection - player must manually select

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
    // Render 3D if enabled
    if (view3D && window.render3D) {
      window.render3D.render();
      animationId = requestAnimationFrame(renderLoop);
      return;
    }

    // 2D rendering
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
    
    // Map keys to directions (support both arrow keys and WASD)
    let dir = null;
    if (e.key === "ArrowLeft" || e.key === "a" || e.key === "A") dir = "left";
    else if (e.key === "ArrowRight" || e.key === "d" || e.key === "D") dir = "right";
    else if (e.key === "ArrowUp" || e.key === "w" || e.key === "W") dir = "up";
    else if (e.key === "ArrowDown" || e.key === "s" || e.key === "S") dir = "down";
    
    // Only process movement keys
    if (!dir) {
      return;
    }

    const canMove = multiplayerMode && myPlayerId && myCharacterType && myColorIndex !== null;
    if (!canMove) return;

    sendInput({ dir });
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

  // Check for color overrides first
  if (character.color) {
    const colorIndex = COLORS.indexOf(character.color.toLowerCase());
    if (colorIndex >= 0 && window.guiParams) {
      const colorKey = `${COLORS[colorIndex]}Color`;
      const overrideColor = window.guiParams[colorKey];
      const defaultColors = ["#ff0000", "#00ff00", "#0000ff", "#ffff00"];
      // Only apply override if it's different from default
      if (overrideColor && overrideColor !== defaultColors[colorIndex]) {
        if (isPacman) {
          el.style.background = overrideColor;
          el.style.borderColor = overrideColor;
        } else if (isGhost) {
          el.style.borderColor = overrideColor;
        }
        // Remove predefined color classes
        COLORS.forEach((c) => el.classList.remove(c));
        return;
      }
    }
  }

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

  // Update image - check for team image first, then character.image
  let imageToUse = null;
  if (isPacman && character.color) {
    const colorIndex = COLORS.indexOf(character.color.toLowerCase());
    if (colorIndex >= 0 && window.guiParams) {
      const imageKey = `team${colorIndex + 1}Image`;
      const teamImage = window.guiParams[imageKey];
      if (teamImage && teamImage.trim() !== "") {
        imageToUse = teamImage;
      }
    }
  }

  // Fall back to character.image if no team image is set
  if (!imageToUse && character.image && character.image.trim() !== "") {
    imageToUse = character.image;
  }

  if (imageToUse) {
    if (isPacman) {
      el.style.backgroundImage = `url(${imageToUse})`;
      el.style.backgroundSize = "cover";
      el.style.backgroundPosition = "center";
      el.style.backgroundRepeat = "no-repeat";
      // If custom color, use it as fallback
      if (character.color && !COLORS.includes(character.color.toLowerCase())) {
        el.style.backgroundColor = character.color;
      }
    } else if (isGhost) {
      el.style.backgroundImage = `url(${imageToUse})`;
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

function flashCharacters(chaserColorIndex, fugitiveColorIndex) {
  // Get the chaser and fugitive elements
  const chaser = ghosts[chaserColorIndex];
  const fugitive = pacmen[fugitiveColorIndex];

  if (!chaser || !chaser.element || !fugitive || !fugitive.element) return;

  // Get the color for the flash
  const colorName = COLORS[chaserColorIndex];
  const defaultColors = ["#ff0000", "#00ff00", "#0000ff", "#ffff00"];
  let flashColor = defaultColors[chaserColorIndex];

  // Check for color override
  if (window.guiParams) {
    const colorKey = `${colorName}Color`;
    const overrideColor = window.guiParams[colorKey];
    if (overrideColor && overrideColor !== defaultColors[chaserColorIndex]) {
      flashColor = overrideColor;
    }
  }

  // Create flash effect using box-shadow
  const flashDuration = 300; // milliseconds
  const originalBoxShadow = chaser.element.style.boxShadow;
  const originalBoxShadowFugitive = fugitive.element.style.boxShadow;

  // Apply flash to chaser
  chaser.element.style.boxShadow = `0 0 20px ${flashColor}, 0 0 40px ${flashColor}, 0 0 60px ${flashColor}`;
  chaser.element.style.transition = `box-shadow ${flashDuration}ms ease-out`;

  // Apply flash to fugitive
  fugitive.element.style.boxShadow = `0 0 20px ${flashColor}, 0 0 40px ${flashColor}, 0 0 60px ${flashColor}`;
  fugitive.element.style.transition = `box-shadow ${flashDuration}ms ease-out`;

  // Remove flash after duration
  setTimeout(() => {
    if (chaser.element) {
      chaser.element.style.boxShadow = originalBoxShadow;
      chaser.element.style.transition = "";
    }
    if (fugitive.element) {
      fugitive.element.style.boxShadow = originalBoxShadowFugitive;
      fugitive.element.style.transition = "";
    }
  }, flashDuration);
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
