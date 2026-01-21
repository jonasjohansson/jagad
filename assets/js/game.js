// Jagad Game
// Map and grid dimensions are shared via PACMAN_MAP (see map.js)
const { MAP, COLS, ROWS, TUNNEL_ROW } = PACMAN_MAP;
const CELL_SIZE = 20;
const CHARACTER_SIZE = 16;
const CHARACTER_OFFSET = (CELL_SIZE - CHARACTER_SIZE) / 2;
// Base movement speed (tuned to feel closer to the original client-side movement)
// Higher = faster movement across the grid
const BASE_MOVE_SPEED = 0.25;
const TARGET_FPS = 60; // Used to normalize movement speed by frame time

const COLORS = ["red", "green", "blue", "yellow"];
const DIRECTIONS = [
  { dir: "up", x: 0, y: -1 },
  { dir: "down", x: 0, y: 1 },
  { dir: "left", x: -1, y: 0 },
  { dir: "right", x: 1, y: 0 },
];
const DIRECTION_MAP = {
  up: { x: 0, y: -1 },
  down: { x: 0, y: 1 },
  left: { x: -1, y: 0 },
  right: { x: 1, y: 0 },
};
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

// Pre-calculate chaser spawn positions
const chaserSpawnPositions = [];
for (let y = 0; y < ROWS; y++) {
  for (let x = 0; x < COLS; x++) {
    if (MAP[y][x] === 3) {
      chaserSpawnPositions.push({ x, y });
    }
  }
}
// Sort spawn positions to match server order: red, green, blue, yellow
// Order: top-left, top-right, bottom-left, bottom-right
chaserSpawnPositions.sort((a, b) => {
  if (a.y !== b.y) return a.y - b.y; // Sort by row first (top to bottom)
  return a.x - b.x; // Then by column (left to right)
});

// Pre-calculate fugitive spawn positions (from map: value 4)
// Map shows: Row 1 (y=1): x=1 and x=41, Row 22 (y=22): x=1 and x=41
const fugitiveSpawnPositions = [
  { x: 1, y: 1 }, // top-left
  { x: 41, y: 1 }, // top-right
  { x: 1, y: 22 }, // bottom-left
  { x: 41, y: 22 }, // bottom-right
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
  // Position updates handled in 3D rendering
}

function respawnChaser(chaser, spawnPos) {
  respawnCharacter(chaser, spawnPos);
  chaser.positionHistory = [];
  chaser.lastDirX = 0;
  chaser.lastDirY = 0;
}

// Game state
let fugitives = [];
let chasers = [];
let currentFugitive = null; // null means no character selected
let currentChaser = null; // null means no character selected
let playerType = "fugitive"; // "fugitive" or "chaser"
let aiDifficulty = 0.8; // 0 = easy, 1 = hard
// Removed: survivalTimeThreshold - not used in new game mode
let gameStarted = false;
let chaserSelections = new Map(); // colorIndex -> playerName (for chasers selected but not yet joined)
let playerNames = new Map(); // colorIndex -> playerName (for joined players)
let lastTime = 0;
let animationId = null;
let gui = null;

// Multiplayer state
const REMOTE_SERVER_ADDRESS = "https://pacman-server-239p.onrender.com";
const LOCAL_SERVER_ADDRESS = "http://localhost:3000";
let ws = null;
let myPlayerId = null;
let myCharacterType = null; // 'fugitive' or 'chaser'
let myColorIndex = null;
// Expose to window for 3D rendering to access
window.myCharacterType = myCharacterType;
window.myColorIndex = myColorIndex;
let connectedPlayers = new Map(); // Map of playerId -> { type, colorIndex }
let multiplayerMode = false;
let lastPositionUpdate = 0;
const POSITION_UPDATE_INTERVAL = 16; // Send position updates every ~16ms (60fps)
let reconnectTimeoutId = null;

// Get server address from URL parameter or default
function getServerFromURL() {
  const params = new URLSearchParams(window.location.search);
  const serverParam = params.get("server");
  
  if (serverParam) {
    // If it's a full URL, use it directly
    if (serverParam.startsWith("http://") || serverParam.startsWith("https://")) {
      return serverParam;
    }
    // If it's "local" or "localhost", use local server
    if (serverParam.toLowerCase() === "local" || serverParam.toLowerCase() === "localhost") {
      return LOCAL_SERVER_ADDRESS;
    }
    // If it's "remote" or "render", use remote server
    if (serverParam.toLowerCase() === "remote" || serverParam.toLowerCase() === "render") {
      return REMOTE_SERVER_ADDRESS;
    }
  }
  
  // Default: use remote server
  return REMOTE_SERVER_ADDRESS;
}

function getServerAddress() {
  return getServerFromURL();
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

function endGame() {
  // End the game manually
  if (multiplayerMode && ws && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify({ type: "endGame" }));
  }
}

function selectCharacter(type, colorName) {
  const colorIndex = COLORS.indexOf(colorName.toLowerCase());
  if (colorIndex === -1) return;

  // Selection is handled in 3D rendering - no DOM manipulation needed

  if (type === "fugitive" && fugitives[colorIndex]) {
    currentFugitive = colorIndex;
    currentChaser = null;
    playerType = "fugitive";
    // Selection handled in 3D rendering
  } else if (type === "chaser" && chasers[colorIndex]) {
    currentChaser = colorIndex;
    currentFugitive = null;
    playerType = "chaser";
    // Selection handled in 3D rendering
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

// Switch server (kept for backward compatibility, but server is now set via URL parameter)
function switchServer(useLocal) {
  // Server is now determined by URL parameter, so this function is deprecated
  // Reset multiplayer identity
  myPlayerId = null;
  myCharacterType = null;
  myColorIndex = null;
  window.myCharacterType = null;
  window.myColorIndex = null;
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
      // Update window variables for 3D rendering
      window.myCharacterType = myCharacterType;
      window.myColorIndex = myColorIndex;

      // Auto-select the character we joined as so the GUI and local selection match the server
      // All chasers are white, so use white for selection
      if (myCharacterType === "chaser") {
        selectCharacter("chaser", "white");
        // Immediately update opacity to 100% for the chaser we joined
        // Opacity handled in 3D rendering
        // Also update 3D opacity
        if (window.render3D && window.render3D.updateChaserOpacity) {
          window.render3D.updateChaserOpacity(newColorIndex, 1.0);
        }
      }
      // Game starts when "Start game cycle" button is pressed (handled by server)
      break;
    }
    case "joinFailed":
      break;
    case "aiDifficultyChanged":
      if (data.difficulty !== undefined) {
        aiDifficulty = data.difficulty;
      }
      break;
    case "camera3DChanged":
      if (data.cameraType !== undefined && window.render3D && window.render3D.setCameraType) {
        const shouldBeOrthographic = data.cameraType === "Orthographic";
        window.render3D.setCameraType(shouldBeOrthographic);
      }
      break;
    case "cameraZoomChanged":
      if (data.zoom !== undefined && window.render3D && window.render3D.setCameraZoom) {
        window.render3D.setCameraZoom(data.zoom);
      }
      break;
    case "ambientLightChanged":
      if (data.intensity !== undefined && window.render3D && window.render3D.setAmbientLight) {
        window.render3D.setAmbientLight(data.intensity);
      }
      break;
    case "directionalLightChanged":
      if (data.intensity !== undefined && window.render3D && window.render3D.setDirectionalLight) {
        window.render3D.setDirectionalLight(data.intensity);
      }
      break;
    case "pointLightChanged":
      if (data.intensity !== undefined && window.render3D && window.render3D.setPointLightIntensity) {
        window.render3D.setPointLightIntensity(data.intensity);
      }
      break;
    case "pathColorChanged":
      if (data.color !== undefined && window.render3D && window.render3D.setPathColor) {
        window.render3D.setPathColor(data.color);
      }
      break;
    case "innerWallColorChanged":
      if (data.color !== undefined) {
        document.documentElement.style.setProperty("--color-inner-wall-border", data.color);
        if (window.render3D && window.render3D.setInnerWallColor) {
          window.render3D.setInnerWallColor(data.color);
        }
      }
      break;
    case "outerWallColorChanged":
      if (data.color !== undefined) {
        document.documentElement.style.setProperty("--color-outer-wall-border", data.color);
        if (window.render3D && window.render3D.setOuterWallColor) {
          window.render3D.setOuterWallColor(data.color);
        }
      }
      break;
    case "bodyBgColorChanged":
      if (data.color !== undefined) {
        document.body.style.backgroundColor = data.color;
      }
      break;
    case "buildingRealOpacityChanged":
      if (data.opacity !== undefined) {
        const buildingRealImage = document.getElementById("building-real-image");
        if (buildingRealImage) {
          buildingRealImage.style.opacity = data.opacity;
        }
      }
      break;
    case "buildingRealBlendModeChanged":
      if (data.blendMode !== undefined) {
        const buildingRealImage = document.getElementById("building-real-image");
        if (buildingRealImage) {
          buildingRealImage.style.mixBlendMode = data.blendMode;
        }
      }
      break;
    case "gameState":
      // Update connected players map
      connectedPlayers.clear();
      playerNames.clear();
      if (data.players) {
        data.players.forEach((player) => {
          if (player.connected) {
            connectedPlayers.set(player.playerId, {
              type: player.type,
              colorIndex: player.colorIndex,
              stats: player.stats || null,
            });
            // Store player names for joined players
            if (player.colorIndex !== null && player.colorIndex !== undefined && player.playerName) {
              playerNames.set(player.colorIndex, player.playerName);
            }
          }
        });
        // Update score display if we have stats
        updateScoreDisplay();
      }
      
      // Update game code display only if it changed
      if (data.gameCode) {
        const gameCodeDisplay = document.getElementById("game-code-display");
        if (gameCodeDisplay && gameCodeDisplay.textContent !== data.gameCode) {
          gameCodeDisplay.textContent = data.gameCode;
        }
      }

      // Update chaser selections (players who selected but haven't joined yet)
      if (data.chaserSelections) {
        chaserSelections.clear();
        Object.entries(data.chaserSelections).forEach(([colorIndexStr, selection]) => {
          const colorIndex = parseInt(colorIndexStr, 10);
          if (!isNaN(colorIndex) && selection.playerName) {
            // Only add if not already joined
            if (!playerNames.has(colorIndex)) {
              chaserSelections.set(colorIndex, selection.playerName);
            }
          }
        });
      }
      
      // Update GUI with available colors and names
      if (data.availableColors) {
        // Chaser selection is now handled via controller, not game GUI
      }
      // Apply server's authoritative game state (positions)
      if (data.positions) {
        applyServerPositions(data.positions);

        // Update 3D view
        if (window.render3D) {
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
    case "gameEnd":
      // Game ended - update UI (alert is shown on controller, not here)
      gameStarted = false;
      // Update score display
      updateScoreDisplay();
      break;
    case "fugitiveCaught":
      // A fugitive was caught - update score display
      updateScoreDisplay();
      break;
    case "gameReset":
      // Game was reset - clear caught state and player selection
      gameStarted = false;
      // Clear chaser selections and player names
      chaserSelections.clear();
      playerNames.clear();
      // Send reset speed config to server
      sendSpeedConfig(0.4, 0.41);
      // Clear our character selection (players lose selection when game resets)
      myCharacterType = null;
      myColorIndex = null;
      window.myCharacterType = null;
      window.myColorIndex = null;
      // Selection handled in 3D rendering
      currentFugitive = null;
      currentChaser = null;
      // Opacity handled in 3D rendering
      // Also update 3D opacities
      if (window.render3D && window.render3D.updateChaserOpacity) {
        for (let i = 0; i < 4; i++) {
          window.render3D.updateChaserOpacity(i, 0.2);
        }
      }
      break;
  }
}

// Apply input from remote player
function applyRemoteInput(data) {
  const { characterType, colorIndex, input } = data;
  const character = characterType === "fugitive" ? fugitives[colorIndex] : chasers[colorIndex];
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

  // Track which fugitive indices are currently active (not caught)
  const activeFugitiveIndices = new Set();

  // Apply positions from server for ALL characters (server is authoritative)
  if (positions.fugitives && Array.isArray(positions.fugitives)) {
    for (let index = 0; index < positions.fugitives.length; index++) {
      const pos = positions.fugitives[index];
      if (fugitives[index] && pos) {
        activeFugitiveIndices.add(index);
        // Always update pixel positions directly from server (no interpolation for server updates)
        if (pos.px !== undefined) fugitives[index].px = pos.px;
        if (pos.py !== undefined) fugitives[index].py = pos.py;

        // Update target positions
        if (pos.targetX !== undefined) fugitives[index].targetX = pos.targetX;
        if (pos.targetY !== undefined) fugitives[index].targetY = pos.targetY;

        // Update grid positions
        if (pos.x !== undefined) fugitives[index].x = pos.x;
        if (pos.y !== undefined) fugitives[index].y = pos.y;

        // Do not update DOM here; renderLoop will interpolate and render
        // This avoids fighting between server updates and client-side smoothing
      }
    }
  }
  
    // Fugitive visibility is handled in 3D rendering

  // Update display-only fugitive speed and AI skill
  // Update current fugitive speed display
  // Speed display removed - settings now in admin page

  // Check if only 1 fugitive is left - if so, set AI skill to max (1.0)
  const activeFugitiveCount = activeFugitiveIndices.size;
  if (activeFugitiveCount === 1 && gameStarted) {
    // Set AI skill to max when only 1 fugitive remains
    aiDifficulty = 1.0;
    if (window.guiParams) {
      window.guiParams.currentAISkill = 1.0;
    }
  } else {
    // Otherwise use the current difficulty setting
    if (window.guiParams) {
      window.guiParams.currentAISkill = aiDifficulty;
    }
  }

  // Track which chaser indices are currently active
  const activeChaserIndices = new Set();
  // Track player-controlled chasers
  const playerControlledChaserIndices = new Set();
  
  if (positions.chasers && Array.isArray(positions.chasers)) {
    for (let index = 0; index < positions.chasers.length; index++) {
      const pos = positions.chasers[index];
      if (chasers[index] && pos) {
        activeChaserIndices.add(index);
        // Track player-controlled chasers
        if (pos.isPlayerControlled === true) {
          playerControlledChaserIndices.add(index);
        }
        // Always update pixel positions directly from server (no interpolation for server updates)
        if (pos.px !== undefined) chasers[index].px = pos.px;
        if (pos.py !== undefined) chasers[index].py = pos.py;

        // Update target positions
        if (pos.targetX !== undefined) chasers[index].targetX = pos.targetX;
        if (pos.targetY !== undefined) chasers[index].targetY = pos.targetY;

        // Update grid positions
        if (pos.x !== undefined) chasers[index].x = pos.x;
        if (pos.y !== undefined) chasers[index].y = pos.y;
        
        // Opacity is handled in 3D rendering

        // Do not update DOM here; renderLoop will interpolate and render
        // This avoids fighting between server updates and client-side smoothing
      }
    }
  }
  
  // Check if there are more than 1 player-controlled chaser - if so, set chaser speed to 0.4
  // Also check connectedPlayers map and local player for accurate count
  connectedPlayers.forEach((player) => {
    if (player.type === "chaser" && player.colorIndex !== null && player.colorIndex !== undefined) {
      playerControlledChaserIndices.add(player.colorIndex);
    }
  });
  // Also check if local player is a chaser (might not be in positions yet)
  if (myCharacterType === "chaser" && myColorIndex !== null) {
    playerControlledChaserIndices.add(myColorIndex);
  }
  const totalChaserCount = playerControlledChaserIndices.size;
  
  if (totalChaserCount > 1 && gameStarted) {
    // Set chaser speed to 0.4 when there are more than 1 chaser
    const targetChaserSpeed = 0.4;
    if (Math.abs(guiParams.chaserSpeed - targetChaserSpeed) > 0.001) {
      guiParams.chaserSpeed = targetChaserSpeed;
      // Update GUI slider
      if (window.chaserSpeedController) {
        window.chaserSpeedController.setValue(targetChaserSpeed);
      }
      // Send speed config to server
      sendSpeedConfig(guiParams.fugitiveSpeed, targetChaserSpeed);
    }
  }
  
  // Ensure all chasers are visible (create missing ones if needed)
  for (let i = 0; i < 4; i++) {
    if (!chasers[i]) {
      // Create chaser element if it doesn't exist
      const spawnPos = chaserSpawnPositions[i] || { x: 11 + i, y: 11 };
      const px = spawnPos.x * CELL_SIZE + CHARACTER_OFFSET;
      const py = spawnPos.y * CELL_SIZE + CHARACTER_OFFSET;
      chasers[i] = {
        x: spawnPos.x,
        y: spawnPos.y,
        px,
        py,
        targetX: spawnPos.x,
        targetY: spawnPos.y,
        color: "white",
        speed: 1.0,
        spawnPos: { ...spawnPos },
        element: createCharacter("chaser", "white", spawnPos.x, spawnPos.y),
        dirX: 0,
        dirY: 0,
        nextDirX: 0,
        nextDirY: 0,
        lastDirX: 0,
        lastDirY: 0,
        positionHistory: [],
      };
      // Appearance and opacity handled in 3D rendering
    }
  }
}

// Send global speed configuration to server
function sendSpeedConfig(fugitiveSpeed, chaserSpeed) {
  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.send(
      JSON.stringify({
        type: "setSpeeds",
        fugitiveSpeed,
        chaserSpeed,
      })
    );
  }
}

// Send game duration to server
function sendGameDuration(duration) {
  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.send(
      JSON.stringify({
        type: "setGameDuration",
        duration: duration,
      })
    );
  }
}

// Send input to server (optimized - minimal payload)
let lastInputDir = null;
let lastInputTime = 0;
const INPUT_THROTTLE = 30; // ms - throttle duplicate direction spam

// Direction vectors for client-side prediction
const DIR_VECTORS = {
  up: { x: 0, y: -1 },
  down: { x: 0, y: 1 },
  left: { x: -1, y: 0 },
  right: { x: 1, y: 0 },
};

// Debug timing variables
let pingStartTime = 0;
let lastPingTime = 0;
let avgPing = 0;
let pingCount = 0;
let inputSentTime = 0;
let inputResponseTime = 0;
let lastServerUpdateTime = Date.now();
let serverUpdateInterval = 0;

function sendInput(input) {
  if (!ws || ws.readyState !== WebSocket.OPEN || !myPlayerId) return;
  
  const now = Date.now();
  
  // Send all direction changes immediately (no throttling for my character)
  // Only throttle if it's the exact same direction sent very recently
  if (input.dir === lastInputDir && now - lastInputTime < 100) {
    return; // Ignore very rapid duplicate inputs (less than 100ms)
  }
  
  lastInputDir = input.dir;
  lastInputTime = now;
  
  // DEBUG: Track input timing
  inputSentTime = now;
  if (false) { // Debug display removed
    console.log(`[INPUT] Sent ${input.dir} at ${now}`);
  }
  
  ws.send(JSON.stringify({ type: "input", input: input }));
}

// Update GUI with available colors from server
function updateScoreDisplay() {
  if (!window.scoreDisplay) return;

  // Find the team chaser score (should be the same for all chasers)
  let teamChaserScore = 0;
  
  // Check all connected chaser players to get the team score
  connectedPlayers.forEach((player) => {
    if (player.type === "chaser" && player.stats) {
      teamChaserScore = player.stats.chaserScore || 0;
    }
  });

  // If we're a chaser, also check our own stats
  if (myPlayerId) {
    const myPlayer = connectedPlayers.get(myPlayerId);
    if (myPlayer && myPlayer.type === "chaser" && myPlayer.stats) {
      teamChaserScore = myPlayer.stats.chaserScore || 0;
    }
  }

  // Update the display with the team score
  window.scoreDisplay.chaserScore.setValue(teamChaserScore);
}

// Debug display functions
function createDebugDisplay() {
  removeDebugDisplay(); // Remove existing if any
  
  const debugDiv = document.createElement("div");
  debugDiv.id = "debug-display";
  debugDiv.style.position = "fixed";
  debugDiv.style.top = "10px";
  debugDiv.style.left = "10px";
  debugDiv.style.backgroundColor = "rgba(0, 0, 0, 0.8)";
  debugDiv.style.color = "#0f0";
  debugDiv.style.fontFamily = "monospace";
  debugDiv.style.fontSize = "12px";
  debugDiv.style.padding = "10px";
  debugDiv.style.borderRadius = "5px";
  debugDiv.style.zIndex = "10000";
  debugDiv.style.pointerEvents = "none";
  document.body.appendChild(debugDiv);
  
  // Start update loop
  updateDebugDisplay();
}

function removeDebugDisplay() {
  const debugDiv = document.getElementById("debug-display");
  if (debugDiv) {
    debugDiv.remove();
  }
}

function updateDebugDisplay() {
  const debugDiv = document.getElementById("debug-display");
  if (!debugDiv || !guiParams.showDebug) return;
  
  const now = Date.now();
  const fps = animationId ? Math.round(1000 / 16) : 0; // Approximate
  
  // Calculate ping (simulate with round-trip)
  const ping = inputResponseTime > 0 ? Math.round(inputResponseTime / 2) : 0;
  
  let html = `<strong>DEBUG INFO</strong><br>`;
  html += `─────────────────────<br>`;
  html += `FPS: ${fps}<br>`;
  html += `Ping: ${ping}ms<br>`;
  html += `Server Update: ${serverUpdateInterval}ms<br>`;
  html += `Input Response: ${inputResponseTime}ms<br>`;
  html += `─────────────────────<br>`;
  html += `Connected: ${multiplayerMode ? "Yes" : "No"}<br>`;
  html += `Player ID: ${myPlayerId || "None"}<br>`;
  html += `Character: ${myCharacterType || "None"}<br>`;
  html += `Color Index: ${myColorIndex !== null ? myColorIndex : "None"}<br>`;
  html += `─────────────────────<br>`;
  
  if (myColorIndex !== null && chasers[myColorIndex]) {
    const chaser = chasers[myColorIndex];
    html += `Position: (${chaser.x}, ${chaser.y})<br>`;
    html += `Target: (${chaser.targetX}, ${chaser.targetY})<br>`;
    html += `Pixel: (${Math.round(chaser.px)}, ${Math.round(chaser.py)})<br>`;
  }
  
  debugDiv.innerHTML = html;
  
  if (false) { // Debug display removed
    setTimeout(updateDebugDisplay, 100); // Update every 100ms
  }
}

function updateAvailableColors(availableColors) {
  // Update character selection controllers (radio-like) based on availability
  if (window.characterControllers) {
    ["fugitive", "chaser"].forEach((type) => {
      const controllers = window.characterControllers[type] || [];
      for (let i = 0; i < controllers.length; i++) {
        const ctrl = controllers[i];
        if (!ctrl) continue;
        
        // For chasers, check both availability and selections
        if (type === "chaser") {
          const isAvailable = availableColors[type] && availableColors[type].includes(i);
          const isSelected = chaserSelections.has(i); // Selected but not yet joined
          const isJoined = playerNames.has(i); // Already joined
          const isTaken = isSelected || isJoined; // Taken by someone (selected or joined)
          
          // Update button name to show player name if selected or joined
          const playerName = playerNames.get(i) || chaserSelections.get(i);
          if (playerName) {
            ctrl.name(`Chaser ${i + 1}: ${playerName}`);
          } else {
            ctrl.name(`Chaser ${i + 1}`);
          }
          
          // Disable if taken, enable if available and not taken
          if (isTaken || !isAvailable) {
            ctrl.disable();
          } else {
            ctrl.enable();
          }
        } else {
          // For fugitives, just check availability
          const isAvailable = availableColors[type] && availableColors[type].includes(i);
          if (isAvailable) {
            ctrl.enable();
          } else {
            ctrl.disable();
          }
        }
      }
    });
  }

  // Check if all slots are full (queue needed)
  const allFugitivesFull = !availableColors.fugitive || availableColors.fugitive.length === 0;
  const allChasersFull = !availableColors.chaser || availableColors.chaser.length === 0;
  const allSlotsFull = allFugitivesFull && allChasersFull;

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

// Queue system removed - not used

// Initialize 3D view (always enabled)
function init3DView() {
  const canvas = document.getElementById("webgl-canvas");
  const buildingRealImage = document.getElementById("building-real-image");

  // Show 3D canvas
  if (canvas && canvas.style) canvas.style.display = "block";
  // Keep building real image visible
  if (buildingRealImage && buildingRealImage.style) buildingRealImage.style.display = "block";

  // Initialize 3D if not already initialized
  if (window.render3D && !window.render3D.initialized) {
    window.render3D.init();
    window.render3D.initialized = true;
  }
  
  // Update renderer size when canvas becomes visible
  // Use a small delay to ensure canvas dimensions are available
  setTimeout(() => {
    if (window.render3D && window.render3D.onResize) {
      window.render3D.onResize();
    }
  }, 0);

  // Initialize 3D wall colors and path color from current GUI params
  if (window.render3D && window.guiParams) {
    if (window.render3D.setInnerWallColor) {
      window.render3D.setInnerWallColor(window.guiParams.innerWallColor);
    }
    if (window.render3D.setOuterWallColor) {
      window.render3D.setOuterWallColor(window.guiParams.outerWallColor);
    }
    if (window.render3D.setPathColor) {
      window.render3D.setPathColor(window.guiParams.pathColor);
    }
    // Initialize team images from config
    COLORS.forEach((colorName, colorIndex) => {
      if (window.teamConfig && window.teamConfig.teams) {
        const team = window.teamConfig.teams.find(t => t.colorIndex === colorIndex);
        if (team && team.image && team.image.trim() !== "" && window.render3D.setTeamImage) {
          window.render3D.setTeamImage(colorIndex, team.image);
        }
      }
    });
    // Initialize camera zoom
    if (window.render3D.setCameraZoom) {
      window.render3D.setCameraZoom(window.guiParams.cameraZoom);
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

// Local mode flag - when true, game runs entirely client-side without server
// Check if we're in browser view (has browser-controls-overlay element)
let localMode = typeof document !== 'undefined' && document.getElementById('controller-panel')?.classList.contains('browser-controls-overlay');
let localGameLoopId = null;
let localGameState = {
  fugitives: [],
  chasers: [],
  gameStarted: false,
  gameStartTime: null,
  gameDuration: 90,
  caughtFugitives: new Set(),
  score: 0,
  fugitiveSpeed: 0.4,
  chaserSpeed: 0.45, // Slightly faster than fugitives
  aiDifficulty: 0.8,
};
let localPlayerInput = null;
let localLastInputTime = 0;

// Initialize game
function init() {
  try {
    // Skip initialization if already in local mode (browser view handles its own initialization)
    if (localMode) {
      console.log("[game] Skipping init() - already in local mode");
      return;
    }
    
    // Only initialize WebSocket if not in local mode
    if (!localMode) {
      initWebSocket();
    }

  // Initialize default settings
  aiDifficulty = 0.8;
  
  // Initialize default guiParams (needed for 3D initialization even without GUI)
  if (!window.guiParams) {
    window.guiParams = {
      camera3D: "Orthographic",
      cameraZoom: 0.98,
      ambientLightIntensity: 0.6,
      directionalLightIntensity: 0.3,
      pointLightIntensity: 100,
      pathColor: "#dddddd",
      innerWallColor: "#ffffff",
      outerWallColor: "#ffffff",
      bodyBackgroundColor: "#555555",
      cameraPosX: 0,
      cameraPosY: 0,
      cameraPosZ: 0,
      // Orthographic camera frustum (useCustomOrtho = false means auto-calculated)
      useCustomOrtho: false,
      orthoLeft: -500,
      orthoRight: 500,
      orthoTop: 500,
      orthoBottom: -500,
      orthoNear: 0.1,
      orthoFar: 1000,
      // LookAt point (useCustomLookAt = false means center of level)
      useCustomLookAt: false,
      lookAtX: 420,
      lookAtY: 0,
      lookAtZ: 220,
      buildingRealOpacity: 1.0,
      buildingRealX: 0,
      buildingRealY: 0,
      buildingRealBlendMode: "normal",
      canvasBlendMode: "hard-light",
      canvasX: -14,
      canvasY: -13,
    };
  }
  
  // Initialize GUI for 2D/3D, Style, and Building settings only
  // Skip GUI in local mode or if gui-container doesn't exist
  if (!localMode && typeof lil !== "undefined" && typeof lil.GUI !== "undefined") {
    const guiContainer = document.getElementById("gui-container");
    if (guiContainer) {
      const GUI = lil.GUI;
      if (gui) gui.destroy(); // Destroy existing GUI if any
      gui = new GUI({ container: guiContainer });


    // 3D camera type toggle
    gui
      .add(guiParams, "camera3D", ["Orthographic", "Perspective"])
      .name("3D Camera")
      .onChange((value) => {
        if (window.render3D && window.render3D.setCameraType) {
          // Set camera type based on selection
          const shouldBeOrthographic = value === "Orthographic";
          window.render3D.setCameraType(shouldBeOrthographic);
        }
      });

    // Camera zoom slider (only visible when 3D view is enabled)
    const cameraZoomCtrl = gui
      .add(guiParams, "cameraZoom", 0.5, 2.0, 0.01)
      .name("Camera Zoom")
      .onChange((value) => {
        if (window.render3D && window.render3D.setCameraZoom) {
          window.render3D.setCameraZoom(value);
        }
      });

    // Camera position controls
    const cameraFolder = gui.addFolder("Camera Position");
    const updateCameraPosition = () => {
      if (window.render3D && window.render3D.setCameraPosition) {
        window.render3D.setCameraPosition(
          guiParams.cameraPosX,
          guiParams.cameraPosY,
          guiParams.cameraPosZ
        );
      }
    };
    cameraFolder
      .add(guiParams, "cameraPosX", -500, 500, 1)
      .name("Cam X")
      .onChange(updateCameraPosition);
    cameraFolder
      .add(guiParams, "cameraPosY", -500, 500, 1)
      .name("Cam Y")
      .onChange(updateCameraPosition);
    cameraFolder
      .add(guiParams, "cameraPosZ", -500, 500, 1)
      .name("Cam Z")
      .onChange(updateCameraPosition);

    // Orthographic camera frustum controls
    const orthoFolder = gui.addFolder("Orthographic Frustum");
    const updateOrthoFrustum = () => {
      if (window.render3D && window.render3D.setOrthographicFrustum) {
        if (guiParams.useCustomOrtho) {
          window.render3D.setOrthographicFrustum(
            guiParams.orthoLeft,
            guiParams.orthoRight,
            guiParams.orthoTop,
            guiParams.orthoBottom,
            guiParams.orthoNear,
            guiParams.orthoFar
          );
        } else {
          // Reset to auto-calculated
          window.render3D.setOrthographicFrustum(null, null, null, null, guiParams.orthoNear, guiParams.orthoFar);
        }
      }
    };
    orthoFolder
      .add(guiParams, "useCustomOrtho")
      .name("Use Custom Frustum")
      .onChange(updateOrthoFrustum);
    orthoFolder
      .add(guiParams, "orthoLeft", -2000, 2000, 1)
      .name("Left")
      .onChange(updateOrthoFrustum);
    orthoFolder
      .add(guiParams, "orthoRight", -2000, 2000, 1)
      .name("Right")
      .onChange(updateOrthoFrustum);
    orthoFolder
      .add(guiParams, "orthoTop", -2000, 2000, 1)
      .name("Top")
      .onChange(updateOrthoFrustum);
    orthoFolder
      .add(guiParams, "orthoBottom", -2000, 2000, 1)
      .name("Bottom")
      .onChange(updateOrthoFrustum);
    orthoFolder
      .add(guiParams, "orthoNear", 0.01, 100, 0.01)
      .name("Near")
      .onChange(updateOrthoFrustum);
    orthoFolder
      .add(guiParams, "orthoFar", 100, 10000, 10)
      .name("Far")
      .onChange(updateOrthoFrustum);

    // LookAt point controls
    const lookAtFolder = gui.addFolder("Look At Point");
    const updateLookAt = () => {
      if (window.render3D && window.render3D.setLookAtPoint) {
        if (guiParams.useCustomLookAt) {
          window.render3D.setLookAtPoint(
            guiParams.lookAtX,
            guiParams.lookAtY,
            guiParams.lookAtZ
          );
        } else {
          // Reset to center of level
          window.render3D.setLookAtPoint(null, 0, null);
        }
      }
    };
    lookAtFolder
      .add(guiParams, "useCustomLookAt")
      .name("Use Custom Look At")
      .onChange(updateLookAt);
    lookAtFolder
      .add(guiParams, "lookAtX", -2000, 2000, 1)
      .name("Look At X")
      .onChange(updateLookAt);
    lookAtFolder
      .add(guiParams, "lookAtY", -500, 500, 1)
      .name("Look At Y")
      .onChange(updateLookAt);
    lookAtFolder
      .add(guiParams, "lookAtZ", -2000, 2000, 1)
      .name("Look At Z")
      .onChange(updateLookAt);

    // 3D lighting controls (only visible when 3D view is enabled)
    const ambientLightCtrl = gui
      .add(guiParams, "ambientLightIntensity", 0, 2, 0.1)
      .name("Ambient Light")
      .onChange((value) => {
        if (window.render3D && window.render3D.setAmbientLight) {
          window.render3D.setAmbientLight(value);
        }
      });

    const directionalLightCtrl = gui
      .add(guiParams, "directionalLightIntensity", 0, 2, 0.1)
      .name("Directional Light")
      .onChange((value) => {
        if (window.render3D && window.render3D.setDirectionalLight) {
          window.render3D.setDirectionalLight(value);
        }
      });

    const pointLightCtrl = gui
      .add(guiParams, "pointLightIntensity", 0, 400, 1)
      .name("Point Light Intensity")
      .onChange((value) => {
        if (window.render3D && window.render3D.setPointLightIntensity) {
          window.render3D.setPointLightIntensity(value);
        }
      });

    // Inner wall color control (affects both 2D borders and 3D materials)
    gui
      .addColor(guiParams, "innerWallColor")
      .name("Inner Wall Color")
      .onChange((value) => {
        // Update 2D border color
        document.documentElement.style.setProperty("--color-inner-wall-border", value);
        // Update 3D material color
        if (window.render3D && window.render3D.setInnerWallColor) {
          window.render3D.setInnerWallColor(value);
        }
      });

    // Outer wall color control (affects both 2D borders and 3D materials)
    gui
      .addColor(guiParams, "outerWallColor")
      .name("Outer Wall Color")
      .onChange((value) => {
        // Update 2D border color
        document.documentElement.style.setProperty("--color-outer-wall-border", value);
        // Update 3D material color
        if (window.render3D && window.render3D.setOuterWallColor) {
          window.render3D.setOuterWallColor(value);
        }
      });

    // Body background color control
    gui
      .addColor(guiParams, "bodyBackgroundColor")
      .name("Body Background Color")
      .onChange((value) => {
        document.body.style.backgroundColor = value;
      });

    // Path color control (only visible when 3D view is enabled)
    const pathColorCtrl = gui
      .addColor(guiParams, "pathColor")
      .name("Path Color")
      .onChange((value) => {
        if (window.render3D && window.render3D.setPathColor) {
          window.render3D.setPathColor(value);
        }
      });


    // Building real image opacity slider
    gui
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
        // Only apply transform if position is not 0,0
        if (guiParams.buildingRealX !== 0 || guiParams.buildingRealY !== 0) {
          const translate = `translate(${guiParams.buildingRealX}px, ${guiParams.buildingRealY}px)`;
          buildingRealImage.style.transform = translate;
        } else {
          buildingRealImage.style.transform = 'none';
        }
      }
    };


    // Building real image X position slider
    const buildingRealXCtrl = gui
      .add(guiParams, "buildingRealX", -500, 500, 1)
      .name("Building Real X")
      .onChange(() => {
        updateBuildingRealTransform();
      });
    buildingRealXCtrl.hide(); // Hidden from GUI

    // Building real image Y position slider
    const buildingRealYCtrl = gui
      .add(guiParams, "buildingRealY", -500, 500, 1)
      .name("Building Real Y")
      .onChange(() => {
        updateBuildingRealTransform();
      });
    buildingRealYCtrl.hide(); // Hidden from GUI

    // Helper function to update canvas position
    const updateCanvasPosition = () => {
      const canvas = document.getElementById("webgl-canvas");
      if (canvas && canvas.style && guiParams) {
        const x = guiParams.canvasX || 0;
        const y = guiParams.canvasY || 0;
        if (x !== 0 || y !== 0) {
          canvas.style.transform = `translate(${x}px, ${y}px)`;
        } else {
          canvas.style.transform = 'none';
        }
      }
    };

    // Canvas blend mode selector
    gui
      .add(guiParams, "canvasBlendMode", [
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
      .name("Canvas Blend Mode")
      .onChange((value) => {
        const canvas = document.getElementById("webgl-canvas");
        if (canvas) {
          canvas.style.mixBlendMode = value;
        }
      });

    // Canvas X position slider
    gui
      .add(guiParams, "canvasX", -500, 500, 1)
      .name("Canvas X")
      .onChange(() => {
        updateCanvasPosition();
      });

    // Canvas Y position slider
    gui
      .add(guiParams, "canvasY", -500, 500, 1)
      .name("Canvas Y")
      .onChange(() => {
        updateCanvasPosition();
      });

    // Set initial body background color
    if (document.body && document.body.style && guiParams) {
      document.body.style.backgroundColor = guiParams.bodyBackgroundColor || "#555555";
    }

    // Set initial opacity values
    const buildingRealImage = document.getElementById("building-real-image");
    if (buildingRealImage && buildingRealImage.style && guiParams) {
      buildingRealImage.style.opacity = guiParams.buildingRealOpacity || 1.0;
      // Ensure no transforms or blend modes are applied
      buildingRealImage.style.transform = 'none';
      buildingRealImage.style.mixBlendMode = 'normal';
      buildingRealImage.style.scale = '1';
    }
    const canvas = document.getElementById("webgl-canvas");
    if (canvas && canvas.style && guiParams) {
      canvas.style.mixBlendMode = guiParams.canvasBlendMode || "hard-light";
      updateCanvasPosition();
    }

    // Set initial wall color values for 2D
    if (guiParams && document.documentElement && document.documentElement.style) {
      document.documentElement.style.setProperty("--color-inner-wall-border", guiParams.innerWallColor);
      document.documentElement.style.setProperty("--color-outer-wall-border", guiParams.outerWallColor);
    }

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

    // Initialize 3D view on startup
    init3DView();
    }
  } else {
    // In local mode or when GUI is not available, still initialize 3D view
    if (localMode) {
      init3DView();
    }
  }

  // Create 4 fugitives in corners
  fugitiveSpawnPositions.forEach((pos, i) => {
    const px = pos.x * CELL_SIZE + CHARACTER_OFFSET;
    const py = pos.y * CELL_SIZE + CHARACTER_OFFSET;
    const fugitive = {
      x: pos.x,
      y: pos.y,
      px,
      py,
      targetX: pos.x,
      targetY: pos.y,
      color: COLORS[i],
      // Default fugitive speed (kept in sync with server)
      speed: 1.0,
      spawnPos: { ...pos },
      element: createCharacter("fugitive", COLORS[i], pos.x, pos.y),
    };
    fugitives.push(fugitive);
  });

  // No initial character selection - player must manually select

  // Create 4 chasers at spawn positions (marked with 3 in the map)
  // Use the pre-calculated chaser spawn positions
  const chaserPositions = [];
  for (let i = 0; i < 4 && i < chaserSpawnPositions.length; i++) {
    chaserPositions.push(chaserSpawnPositions[i]);
  }

  // Fill remaining positions if needed
  const defaultPositions = [
    { x: 11, y: 11 },
    { x: 12, y: 11 },
    { x: 13, y: 11 },
    { x: 14, y: 11 },
  ];
  for (let i = chaserPositions.length; i < 4; i++) {
    chaserPositions.push(defaultPositions[i - chaserPositions.length]);
  }

  chaserPositions.forEach((pos, i) => {
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

    const chaser = {
      x: pos.x,
      y: pos.y,
      px,
      py,
      targetX: initialTargetX,
      targetY: initialTargetY,
      color: COLORS[i],
      speed: 1.0,
      spawnPos: { ...pos },
      element: createCharacter("chaser", COLORS[i], pos.x, pos.y),
      moveTimer: 0,
      lastDirX: initialDirX,
      lastDirY: initialDirY,
      positionHistory: [],
    };
    chasers.push(chaser);
  });

  // Opacity handled in 3D rendering

  // Team images are handled in 3D rendering (see 3d.js)

  // (Per-color pair GUI controls and scoring have been removed for now)

  // Render loop - smooths visual positions toward server state
  // Server sends authoritative pixel positions; we interpolate for smoother motion
  let renderCallCount = 0;
  function renderLoop() {
    // Render 3D if enabled
    if (window.render3D && window.render3D.render) {
      window.render3D.render();
      renderCallCount++;
      if (renderCallCount % 60 === 0) {
        console.log("[game] Render called", renderCallCount, "times. Scene children:", window.render3D.scene?.children?.length || "unknown");
      }
      animationId = requestAnimationFrame(renderLoop);
      return;
    } else if (!window.render3D) {
      console.warn("[game] Render3D not available yet");
    }

    // 2D rendering removed - all rendering is handled by WebGL/3D

    animationId = requestAnimationFrame(renderLoop);
  }

  // Handle player input - send direction to server
  // WASD controls whichever chaser the player is currently controlling
  document.addEventListener("keydown", (e) => {
    // Only accept WASD keys (not arrow keys)
    const key = e.key.toLowerCase();
    let dir = null;
    if (key === "a") dir = "left";
    else if (key === "d") dir = "right";
    else if (key === "w") dir = "up";
    else if (key === "s") dir = "down";
    
    // Only process WASD movement keys
    if (!dir) {
      return;
    }

    if (!multiplayerMode || !myPlayerId) return;
    
    // If already controlling a chaser (any chaser 0-3), send input for that chaser
    if (myCharacterType === "chaser" && myColorIndex !== null && myColorIndex >= 0 && myColorIndex <= 3) {
      sendInput({ dir });
      return;
    }
    
    // If not controlling any chaser, auto-join chaser 0 as default
    if (myCharacterType !== "chaser") {
      joinAsCharacter("chaser", 0, guiParams.playerInitials);
      // Wait a moment for the join to process, then send input
      setTimeout(() => {
        if (myCharacterType === "chaser" && myColorIndex === 0) {
          sendInput({ dir });
        }
      }, 50);
      return;
    }
  });

  // Start the render loop
  animationId = requestAnimationFrame(renderLoop);
  } catch (error) {
    console.error("Error in init function:", error);
    console.error("Stack trace:", error.stack);
  }
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

function moveCharacter(character, speedMultiplier = 1.0, deltaSeconds = 1 / TARGET_FPS) {
  if (!character) return;

  const target = getTargetPixelPos(character.targetX, character.targetY);
  let dx = target.x - character.px;
  let dy = target.y - character.py;
  let distance = Math.sqrt(dx * dx + dy * dy);

  // Move until we exactly reach the tile center; avoid a "dead zone" where
  // distance is small but we never snap to the target.
  if (distance > 0) {
    // Scale by deltaSeconds to keep speed consistent regardless of frame rate
    const moveDistance = BASE_MOVE_SPEED * CELL_SIZE * speedMultiplier * (deltaSeconds * TARGET_FPS);
    // For local mode characters, enforce strictly axis-aligned movement
    // based on their current direction, to avoid any visual diagonal motion.
    let stepX = character.dirX || 0;
    let stepY = character.dirY || 0;

    if (stepX !== 0 || stepY !== 0) {
      // Use the direction vector directly (only one axis should be non-zero)
      const axisDistance = Math.abs(stepX !== 0 ? dx : dy);
      if (axisDistance > moveDistance) {
        character.px += stepX * moveDistance;
        character.py += stepY * moveDistance;
      } else {
        character.px = target.x;
        character.py = target.y;
        character.x = character.targetX;
        character.y = character.targetY;
        if (MAP[character.y][character.x] === 2) {
          teleportCharacter(character);
        }
      }
    } else {
      // Fallback: use normalized vector (e.g., during teleports or setup)
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

  // Position updates handled in 3D rendering
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
  // Character DOM elements are not needed - we use WebGL/3D rendering only
  return null;
}

// Character appearance is handled in 3D rendering - no DOM manipulation needed
function updateCharacterAppearance(character) {
  // No-op: appearance is handled by WebGL/3D rendering
}

// Position updates are handled in 3D rendering - no DOM manipulation needed
function updatePosition(element, px, py) {
  // No-op: positions are handled by WebGL/3D rendering
}

// Flash effect would be handled in 3D rendering if needed
function flashCharacters(chaserColorIndex, fugitiveColorIndex) {
  // No-op: visual effects are handled by WebGL/3D rendering
}

// Collision detection is handled server-side (server-authoritative)

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

// ========== LOCAL MODE FUNCTIONS ==========
// These functions enable client-side-only single-player gameplay

// Local game loop (runs entirely client-side)
let localLastUpdate = Date.now();
function localGameLoop() {
  const now = Date.now();
  const deltaTime = now - localLastUpdate;
  const deltaSeconds = deltaTime / 1000;
  localLastUpdate = now;

  if (!localGameState.gameStarted) {
    localGameLoopId = requestAnimationFrame(localGameLoop);
    return;
  }

  // Check game timer
  if (localGameState.gameStartTime) {
    const elapsed = (now - localGameState.gameStartTime) / 1000;
    if (elapsed >= localGameState.gameDuration) {
      localEndGame(false);
      return;
    }
  }

  // Process player input
  if (localPlayerInput && localGameState.chasers[0]) {
    const chaser = localGameState.chasers[0];
    const dirDef = DIRECTION_MAP[localPlayerInput];
    if (dirDef) {
      // Ensure only one axis is set (prevent diagonal movement)
      // DIRECTION_MAP should already ensure this, but double-check
      const hasX = dirDef.x !== 0;
      const hasY = dirDef.y !== 0;
      if (!((hasX && !hasY) || (!hasX && hasY))) {
        // Invalid direction (diagonal or no direction), ignore
        localPlayerInput = null;
      } else {
        chaser.nextDirX = dirDef.x;
        chaser.nextDirY = dirDef.y;

        // If stopped, try to start immediately
        if (chaser.dirX === 0 && chaser.dirY === 0) {
          const startX = chaser.x + dirDef.x;
          const startY = chaser.y + dirDef.y;
          if (isPath(startX, startY)) {
            chaser.dirX = dirDef.x;
            chaser.dirY = dirDef.y;
            chaser.targetX = startX;
            chaser.targetY = startY;
          }
        }
      }
    }
    localPlayerInput = null;
  }

  // Move fugitives
  localGameState.fugitives.forEach((fugitive, index) => {
    if (localGameState.caughtFugitives.has(index)) return;

    moveCharacter(fugitive, localGameState.fugitiveSpeed, deltaSeconds);

    if (isAtTarget(fugitive)) {
      localMoveFugitiveAI(fugitive, index);
      
      // Apply queued direction
      if (fugitive.nextDirX || fugitive.nextDirY) {
        const desiredX = fugitive.x + fugitive.nextDirX;
        const desiredY = fugitive.y + fugitive.nextDirY;
        if (isPath(desiredX, desiredY)) {
          fugitive.dirX = fugitive.nextDirX;
          fugitive.dirY = fugitive.nextDirY;
          fugitive.targetX = desiredX;
          fugitive.targetY = desiredY;
          fugitive.lastDirX = fugitive.dirX;
          fugitive.lastDirY = fugitive.dirY;
          fugitive.nextDirX = 0;
          fugitive.nextDirY = 0;
        }
      }
    }
  });

  // Move chaser
  const chaser = localGameState.chasers[0];
  if (chaser) {
    moveCharacter(chaser, localGameState.chaserSpeed, deltaSeconds);

    if (isAtTarget(chaser)) {
      // Apply queued direction
      if (chaser.nextDirX || chaser.nextDirY) {
        const desiredX = chaser.x + chaser.nextDirX;
        const desiredY = chaser.y + chaser.nextDirY;
        if (isPath(desiredX, desiredY)) {
          chaser.dirX = chaser.nextDirX;
          chaser.dirY = chaser.nextDirY;
          chaser.targetX = desiredX;
          chaser.targetY = desiredY;
          chaser.lastDirX = chaser.dirX;
          chaser.lastDirY = chaser.dirY;
          chaser.nextDirX = 0;
          chaser.nextDirY = 0;
        } else {
          // Can't move in desired direction, try to continue
          const continueX = chaser.x + chaser.dirX;
          const continueY = chaser.y + chaser.dirY;
          if (isPath(continueX, continueY)) {
            chaser.targetX = continueX;
            chaser.targetY = continueY;
          } else {
            chaser.dirX = 0;
            chaser.dirY = 0;
          }
        }
      } else {
        // No input, try to continue
        const continueX = chaser.x + chaser.dirX;
        const continueY = chaser.y + chaser.dirY;
        if (isPath(continueX, continueY)) {
          chaser.targetX = continueX;
          chaser.targetY = continueY;
        } else {
          chaser.dirX = 0;
          chaser.dirY = 0;
        }
      }
    }
  }

  // Check collisions
  localCheckCollisions();

  // Update 3D rendering
  if (window.render3D && window.render3D.updatePositions) {
    const positions = {
      // Only send fugitives that haven't been caught
      fugitives: localGameState.fugitives
        .map((f, i) => ({
          index: i,
          px: f.px,
          py: f.py,
          x: f.x,
          y: f.y,
          targetX: f.targetX,
          targetY: f.targetY,
          color: f.color,
          isPlayerControlled: false,
        }))
        .filter((f, i) => !localGameState.caughtFugitives.has(i)),
      chasers: localGameState.chasers.map((c, i) => ({
        index: i,
        px: c.px,
        py: c.py,
        x: c.x,
        y: c.y,
        targetX: c.targetX,
        targetY: c.targetY,
        color: c.color,
        isPlayerControlled: true,
      })),
    };
    window.render3D.updatePositions(positions);
  }

  localGameLoopId = requestAnimationFrame(localGameLoop);
}

// Local AI for fugitives (with randomness)
function localMoveFugitiveAI(fugitive, index) {
  if (localGameState.caughtFugitives.has(index)) return;

  const chaser = localGameState.chasers[0];
  if (!chaser) return;

  const possibleMoves = [];
  for (const dir of DIRECTIONS) {
    const newX = fugitive.x + dir.x;
    const newY = fugitive.y + dir.y;
    if (isPath(newX, newY)) {
      const isReversing = (dir.x === -fugitive.lastDirX && dir.y === -fugitive.lastDirY);
      possibleMoves.push({ dir, newX, newY, isReversing });
    }
  }

  if (possibleMoves.length === 0) return;

  const nonReversingMoves = possibleMoves.filter(m => !m.isReversing);
  const movesToConsider = nonReversingMoves.length > 0 ? nonReversingMoves : possibleMoves;
  
  if (Math.random() < 0.3 && movesToConsider.length > 0) {
    const randomMove = movesToConsider[Math.floor(Math.random() * movesToConsider.length)];
    fugitive.nextDirX = randomMove.dir.x;
    fugitive.nextDirY = randomMove.dir.y;
    return;
  }

  let bestDir = null;
  let bestScore = -Infinity;

  for (const move of possibleMoves) {
    const newDx = move.newX - chaser.x;
    const newDy = move.newY - chaser.y;
    const newDistance = Math.sqrt(newDx * newDx + newDy * newDy);
    const randomFactor = 0.8 + Math.random() * 0.4;
    let score = newDistance * randomFactor;
    
    if (move.isReversing) {
      score *= 0.7;
    }

    if (score > bestScore) {
      bestScore = score;
      bestDir = move.dir;
    }
  }

  if (bestDir) {
    fugitive.nextDirX = bestDir.x;
    fugitive.nextDirY = bestDir.y;
  }
}

function localCheckCollisions() {
  const chaser = localGameState.chasers[0];
  if (!chaser) return;

  localGameState.fugitives.forEach((fugitive, index) => {
    if (localGameState.caughtFugitives.has(index)) return;

    // Check if chaser and fugitive are on the same grid cell (matching server logic)
    if (chaser.x === fugitive.x && chaser.y === fugitive.y) {
      localCatchFugitive(index);
    }
  });
}

function localCatchFugitive(index) {
  if (localGameState.caughtFugitives.has(index)) return;

  localGameState.caughtFugitives.add(index);
  
  const elapsed = (Date.now() - localGameState.gameStartTime) / 1000;
  const remaining = localGameState.fugitives.length - localGameState.caughtFugitives.size;
  const timeBonus = Math.max(0, localGameState.gameDuration - elapsed);
  const catchScore = Math.floor(1000 * (1 + timeBonus / 10) * (1 + remaining));
  
  localGameState.score += catchScore;

  if (window.updateLocalScore) {
    window.updateLocalScore(localGameState.score);
  }

  // Ensure chaser doesn't get stuck - if chaser has no direction, try to continue in last direction
  const chaser = localGameState.chasers[0];
  if (chaser && chaser.dirX === 0 && chaser.dirY === 0) {
    // If stopped, try to continue in last direction if valid
    if (chaser.lastDirX !== 0 || chaser.lastDirY !== 0) {
      const continueX = chaser.x + chaser.lastDirX;
      const continueY = chaser.y + chaser.lastDirY;
      if (isPath(continueX, continueY)) {
        chaser.dirX = chaser.lastDirX;
        chaser.dirY = chaser.lastDirY;
        chaser.targetX = continueX;
        chaser.targetY = continueY;
      }
    }
  }

  if (localGameState.caughtFugitives.size >= localGameState.fugitives.length) {
    localEndGame(true);
  }
}

function localEndGame(allCaught) {
  localGameState.gameStarted = false;
  
  if (window.onLocalGameEnd) {
    window.onLocalGameEnd({
      score: localGameState.score,
      allCaught,
      gameTime: Date.now() - localGameState.gameStartTime,
      fugitivesCaught: localGameState.caughtFugitives.size,
      totalFugitives: localGameState.fugitives.length,
    });
  }
}

function localInitCharacters() {
  localGameState.fugitives = fugitiveSpawnPositions.slice(0, 4).map((pos, i) => ({
    x: pos.x,
    y: pos.y,
    px: pos.x * CELL_SIZE + CHARACTER_OFFSET,
    py: pos.y * CELL_SIZE + CHARACTER_OFFSET,
    targetX: pos.x,
    targetY: pos.y,
    color: COLORS[i],
    speed: localGameState.fugitiveSpeed,
    spawnPos: { ...pos },
    dirX: 0,
    dirY: 0,
    nextDirX: 0,
    nextDirY: 0,
    lastDirX: 0,
    lastDirY: 0,
    positionHistory: [],
  }));

  const chaserPos = chaserSpawnPositions[0];
  localGameState.chasers = [{
    x: chaserPos.x,
    y: chaserPos.y,
    px: chaserPos.x * CELL_SIZE + CHARACTER_OFFSET,
    py: chaserPos.y * CELL_SIZE + CHARACTER_OFFSET,
    targetX: chaserPos.x,
    targetY: chaserPos.y,
    color: "white",
    speed: localGameState.chaserSpeed,
    spawnPos: { ...chaserPos },
    dirX: 0,
    dirY: 0,
    nextDirX: 0,
    nextDirY: 0,
    lastDirY: 0,
    positionHistory: [],
  }];
}

// Public API for local mode
// Initialize characters and make them visible (but don't start game loop)
export function initLocalCharacters() {
  console.log("[game] Initializing local characters...");
  
  if (!window.render3D || !window.render3D.initialized) {
    console.error("[game] 3D rendering not initialized!");
    return;
  }

  // Set local mode first to prevent auto-init from running
  localMode = true;

  // Only initialize if not already initialized
  if (localGameState.fugitives.length > 0 && localGameState.chasers.length > 0) {
    console.log("[game] Characters already initialized, skipping");
    return;
  }
  localInitCharacters();
  
  // Send positions to 3D renderer to make characters visible
  if (window.render3D && window.render3D.updatePositions) {
    const positions = {
      fugitives: localGameState.fugitives.map((f, i) => ({
        index: i,
        px: f.px,
        py: f.py,
        x: f.x,
        y: f.y,
        targetX: f.targetX,
        targetY: f.targetY,
        color: f.color,
        isPlayerControlled: false,
      })),
      chasers: localGameState.chasers.map((c, i) => ({
        index: i,
        px: c.px,
        py: c.py,
        x: c.x,
        y: c.y,
        targetX: c.targetX,
        targetY: c.targetY,
        color: c.color,
        isPlayerControlled: true,
      })),
    };
    window.render3D.updatePositions(positions);
    console.log("[game] Characters initialized and visible");
  }
}

export function initLocalGame() {
  console.log("[game] Starting local game...");
  
  if (!window.render3D || !window.render3D.initialized) {
    console.error("[game] 3D rendering not initialized!");
    return;
  }

  // Characters should already be initialized, but ensure they exist
  if (localGameState.fugitives.length === 0 || localGameState.chasers.length === 0) {
    localInitCharacters();
  }
  
  // Reset game state
  localGameState.gameStarted = true;
  localGameState.gameStartTime = Date.now();
  localGameState.score = 0;
  localGameState.caughtFugitives.clear();
  
  // Reset fugitives to spawn positions
  localGameState.fugitives.forEach((f, i) => {
    const pos = fugitiveSpawnPositions[i];
    f.x = pos.x;
    f.y = pos.y;
    f.px = pos.x * CELL_SIZE + CHARACTER_OFFSET;
    f.py = pos.y * CELL_SIZE + CHARACTER_OFFSET;
    f.targetX = pos.x;
    f.targetY = pos.y;
    f.dirX = 0;
    f.dirY = 0;
    f.nextDirX = 0;
    f.nextDirY = 0;
    f.lastDirX = 0;
    f.lastDirY = 0;
  });

  // Reset chaser to spawn position
  const chaserPos = chaserSpawnPositions[0];
  if (localGameState.chasers[0]) {
    localGameState.chasers[0].x = chaserPos.x;
    localGameState.chasers[0].y = chaserPos.y;
    localGameState.chasers[0].px = chaserPos.x * CELL_SIZE + CHARACTER_OFFSET;
    localGameState.chasers[0].py = chaserPos.y * CELL_SIZE + CHARACTER_OFFSET;
    localGameState.chasers[0].targetX = chaserPos.x;
    localGameState.chasers[0].targetY = chaserPos.y;
    localGameState.chasers[0].dirX = 0;
    localGameState.chasers[0].dirY = 0;
    localGameState.chasers[0].nextDirX = 0;
    localGameState.chasers[0].nextDirY = 0;
  }

  // Update 3D positions (characters should already exist, just update their positions)
  if (window.render3D && window.render3D.updatePositions) {
    const positions = {
      fugitives: localGameState.fugitives.map((f, i) => ({
        index: i,
        px: f.px,
        py: f.py,
        x: f.x,
        y: f.y,
        targetX: f.targetX,
        targetY: f.targetY,
        color: f.color,
        isPlayerControlled: false,
      })),
      chasers: localGameState.chasers.map((c, i) => ({
        index: i,
        px: c.px,
        py: c.py,
        x: c.x,
        y: c.y,
        targetX: c.targetX,
        targetY: c.targetY,
        color: c.color,
        isPlayerControlled: true,
      })),
    };
    window.render3D.updatePositions(positions);
  }

  localLastUpdate = Date.now();
  if (localGameLoopId) cancelAnimationFrame(localGameLoopId);
  localGameLoop();
}

export function sendLocalInput(dir) {
  const now = Date.now();
  if (now - localLastInputTime < 30) return;
  localLastInputTime = now;
  localPlayerInput = dir;
}

export function getLocalGameState() {
  return {
    score: localGameState.score,
    gameStarted: localGameState.gameStarted,
    caughtFugitives: localGameState.caughtFugitives.size,
    totalFugitives: localGameState.fugitives.length,
  };
}

// Start game when everything is loaded
// Export initialization function for module usage
export function initGameModule(containerSelector = "body") {
  const container = typeof containerSelector === "string" 
    ? document.querySelector(containerSelector) 
    : containerSelector;
  
  if (!container) {
    console.error("Game module: Container not found:", containerSelector);
    return;
  }

  // Initialize the game
  init();
  
  // Setup dome entry handler
  setTimeout(setupDomeEntry, 200);
  // Setup canvas drag and drop
  setTimeout(setupCanvasDragDrop, 200);
}

// Auto-initialize if running standalone (not imported as module)
// Skip auto-init if we're in browser view (local mode will be set before this runs)
if (!localMode) {
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
}
