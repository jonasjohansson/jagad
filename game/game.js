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
  ghost.positionHistory = [];
  ghost.lastDirX = 0;
  ghost.lastDirY = 0;
}

// Game state
let pacmen = [];
let ghosts = [];
let currentPacman = null; // null means no character selected
let currentGhost = null; // null means no character selected
let playerType = "pacman"; // "pacman" or "ghost"
let aiDifficulty = 0.8; // 0 = easy, 1 = hard
// Removed: survivalTimeThreshold - not used in new game mode
let gameStarted = false;
let view3D = true; // Toggle for 3D view
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
let myCharacterType = null; // 'pacman' or 'ghost'
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
      if (myCharacterType === "chaser" || myCharacterType === "ghost") {
        selectCharacter("ghost", "white");
        // Immediately update opacity to 100% for the chaser we joined
        if (ghosts[newColorIndex] && ghosts[newColorIndex].element) {
          ghosts[newColorIndex].element.style.opacity = "1";
        }
        // Also update 3D opacity if 3D view is enabled
        if (view3D && window.render3D && window.render3D.updateChaserOpacity) {
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
    case "view3DChanged":
      if (data.view3D !== undefined) {
        view3D = data.view3D;
        toggle3DView(data.view3D);
      }
      break;
    case "camera3DChanged":
      if (data.cameraType !== undefined && view3D && window.render3D && window.render3D.setCameraType) {
        const shouldBeOrthographic = data.cameraType === "Orthographic";
        window.render3D.setCameraType(shouldBeOrthographic);
      }
      break;
    case "cameraZoomChanged":
      if (data.zoom !== undefined && view3D && window.render3D && window.render3D.setCameraZoom) {
        window.render3D.setCameraZoom(data.zoom);
      }
      break;
    case "ambientLightChanged":
      if (data.intensity !== undefined && view3D && window.render3D && window.render3D.setAmbientLight) {
        window.render3D.setAmbientLight(data.intensity);
      }
      break;
    case "directionalLightChanged":
      if (data.intensity !== undefined && view3D && window.render3D && window.render3D.setDirectionalLight) {
        window.render3D.setDirectionalLight(data.intensity);
      }
      break;
    case "pointLightChanged":
      if (data.intensity !== undefined && view3D && window.render3D && window.render3D.setPointLightIntensity) {
        window.render3D.setPointLightIntensity(data.intensity);
      }
      break;
    case "pathColorChanged":
      if (data.color !== undefined && view3D && window.render3D && window.render3D.setPathColor) {
        window.render3D.setPathColor(data.color);
      }
      break;
    case "innerWallColorChanged":
      if (data.color !== undefined) {
        document.documentElement.style.setProperty("--color-inner-wall-border", data.color);
        if (view3D && window.render3D && window.render3D.setInnerWallColor) {
          window.render3D.setInnerWallColor(data.color);
        }
      }
      break;
    case "outerWallColorChanged":
      if (data.color !== undefined) {
        document.documentElement.style.setProperty("--color-outer-wall-border", data.color);
        if (view3D && window.render3D && window.render3D.setOuterWallColor) {
          window.render3D.setOuterWallColor(data.color);
        }
      }
      break;
    case "bodyBgColorChanged":
      if (data.color !== undefined) {
        document.body.style.backgroundColor = data.color;
      }
      break;
    case "mazeOpacityChanged":
      if (data.opacity !== undefined) {
        const maze = document.getElementById("maze");
        if (maze) {
          maze.style.opacity = data.opacity;
        }
      }
      break;
    case "buildingOpacityChanged":
      if (data.opacity !== undefined) {
        const buildingImage = document.getElementById("building-image");
        if (buildingImage) {
          buildingImage.style.opacity = data.opacity;
        }
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
    case "buildingRealScaleChanged":
      if (data.scale !== undefined) {
        const buildingRealImage = document.getElementById("building-real-image");
        if (buildingRealImage) {
          const translate = `translate(calc(-50% + 9px), calc(-50% + 9px))`;
          buildingRealImage.style.transform = `${translate} scale(${data.scale})`;
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
      
      // Update game code display
      if (data.gameCode) {
        const gameCodeDisplay = document.getElementById("game-code-display");
        if (gameCodeDisplay) {
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
      // Clear visual selection
      [...pacmen, ...ghosts].forEach((char) => {
        if (char?.element) char.element.classList.remove("selected");
      });
      currentPacman = null;
      currentGhost = null;
      // Reset all chaser opacities to 20% (not player-controlled)
      ghosts.forEach((ghost) => {
        if (ghost && ghost.element) {
          ghost.element.style.opacity = "0.2";
        }
      });
      // Also update 3D opacities
      if (view3D && window.render3D && window.render3D.updateChaserOpacity) {
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

  // Track which fugitive indices are currently active (not caught)
  const activeFugitiveIndices = new Set();

  // Apply positions from server for ALL characters (server is authoritative)
  if (positions.pacmen && Array.isArray(positions.pacmen)) {
    for (let index = 0; index < positions.pacmen.length; index++) {
      const pos = positions.pacmen[index];
      if (pacmen[index] && pos) {
        activeFugitiveIndices.add(index);
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
  
  // Also check the new "fugitives" array name
  if (positions.fugitives && Array.isArray(positions.fugitives)) {
    for (let index = 0; index < positions.fugitives.length; index++) {
      const pos = positions.fugitives[index];
      if (pacmen[index] && pos) {
        activeFugitiveIndices.add(index);
        // Always update pixel positions directly from server (no interpolation for server updates)
        if (pos.px !== undefined) pacmen[index].px = pos.px;
        if (pos.py !== undefined) pacmen[index].py = pos.py;

        // Update target positions
        if (pos.targetX !== undefined) pacmen[index].targetX = pos.targetX;
        if (pos.targetY !== undefined) pacmen[index].targetY = pos.targetY;

        // Update grid positions
        if (pos.x !== undefined) pacmen[index].x = pos.x;
        if (pos.y !== undefined) pacmen[index].y = pos.y;
      }
    }
  }
  
  // Remove/hide fugitives that are no longer active (caught and removed from game)
  pacmen.forEach((fugitive, index) => {
    if (fugitive && !activeFugitiveIndices.has(index)) {
      // Hide the fugitive element (it's been caught and removed)
      // Keep the color/appearance intact so it's preserved when shown again
      if (fugitive.element) {
        fugitive.element.style.display = "none";
      }
    } else if (fugitive && activeFugitiveIndices.has(index)) {
      // Show the fugitive element if it's active again (after game reset)
      // Restore appearance to ensure color is preserved
      if (fugitive.element) {
        fugitive.element.style.display = "";
        // Restore appearance to ensure color and styling are preserved
        updateCharacterAppearance(fugitive);
      }
    }
  });

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
  
  if (positions.ghosts && Array.isArray(positions.ghosts)) {
    for (let index = 0; index < positions.ghosts.length; index++) {
      const pos = positions.ghosts[index];
      if (ghosts[index] && pos) {
        activeChaserIndices.add(index);
        // Track player-controlled chasers
        if (pos.isPlayerControlled === true) {
          playerControlledChaserIndices.add(index);
        }
        // Always update pixel positions directly from server (no interpolation for server updates)
        if (pos.px !== undefined) ghosts[index].px = pos.px;
        if (pos.py !== undefined) ghosts[index].py = pos.py;

        // Update target positions
        if (pos.targetX !== undefined) ghosts[index].targetX = pos.targetX;
        if (pos.targetY !== undefined) ghosts[index].targetY = pos.targetY;

        // Update grid positions
        if (pos.x !== undefined) ghosts[index].x = pos.x;
        if (pos.y !== undefined) ghosts[index].y = pos.y;
        
        // Update opacity based on player control (20% if not controlled, 100% if controlled)
        // Check both server flag and local player identity
        if (ghosts[index].element) {
          const isPlayerControlled = pos.isPlayerControlled === true;
          const isMyChaser = (myCharacterType === "chaser" || myCharacterType === "ghost") && myColorIndex === index;
          const shouldBeFullOpacity = isPlayerControlled || isMyChaser;
          ghosts[index].element.style.opacity = shouldBeFullOpacity ? "1" : "0.2";
        }

        // Do not update DOM here; renderLoop will interpolate and render
        // This avoids fighting between server updates and client-side smoothing
      }
    }
  }
  
  // Also check the new "chasers" array name
  if (positions.chasers && Array.isArray(positions.chasers)) {
    positions.chasers.forEach((pos) => {
      const index = pos.index !== undefined ? pos.index : positions.chasers.indexOf(pos);
      if (ghosts[index] && pos) {
        activeChaserIndices.add(index);
        // Track player-controlled chasers
        if (pos.isPlayerControlled === true) {
          playerControlledChaserIndices.add(index);
        }
        // Always update pixel positions directly from server
        if (pos.px !== undefined) ghosts[index].px = pos.px;
        if (pos.py !== undefined) ghosts[index].py = pos.py;

        // Update target positions
        if (pos.targetX !== undefined) ghosts[index].targetX = pos.targetX;
        if (pos.targetY !== undefined) ghosts[index].targetY = pos.targetY;

        // Update grid positions
        if (pos.x !== undefined) ghosts[index].x = pos.x;
        if (pos.y !== undefined) ghosts[index].y = pos.y;
        
        // Update opacity based on player control (20% if not controlled, 100% if controlled)
        // Check both server flag and local player identity
        if (ghosts[index].element) {
          const isPlayerControlled = pos.isPlayerControlled === true;
          const isMyChaser = (myCharacterType === "chaser" || myCharacterType === "ghost") && myColorIndex === index;
          const shouldBeFullOpacity = isPlayerControlled || isMyChaser;
          ghosts[index].element.style.opacity = shouldBeFullOpacity ? "1" : "0.2";
        }
      }
    });
  }
  
  // Check if there are more than 1 player-controlled chaser - if so, set chaser speed to 0.4
  // Also check connectedPlayers map and local player for accurate count
  connectedPlayers.forEach((player) => {
    if ((player.type === "chaser" || player.type === "ghost") && player.colorIndex !== null && player.colorIndex !== undefined) {
      playerControlledChaserIndices.add(player.colorIndex);
    }
  });
  // Also check if local player is a chaser (might not be in positions yet)
  if ((myCharacterType === "chaser" || myCharacterType === "ghost") && myColorIndex !== null) {
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
    if (!ghosts[i]) {
      // Create ghost element if it doesn't exist
      const spawnPos = ghostSpawnPositions[i] || { x: 11 + i, y: 11 };
      const px = spawnPos.x * CELL_SIZE + CHARACTER_OFFSET;
      const py = spawnPos.y * CELL_SIZE + CHARACTER_OFFSET;
      ghosts[i] = {
        x: spawnPos.x,
        y: spawnPos.y,
        px,
        py,
        targetX: spawnPos.x,
        targetY: spawnPos.y,
        color: "white",
        speed: 1.0,
        spawnPos: { ...spawnPos },
        element: createCharacter("ghost", "white", spawnPos.x, spawnPos.y),
        dirX: 0,
        dirY: 0,
        nextDirX: 0,
        nextDirY: 0,
        lastDirX: 0,
        lastDirY: 0,
        positionHistory: [],
      };
      updateCharacterAppearance(ghosts[i]);
      // Set initial opacity - check if this is the player's chaser
      if (ghosts[i].element) {
        const isMyChaser = (myCharacterType === "chaser" || myCharacterType === "ghost") && myColorIndex === i;
        ghosts[i].element.style.opacity = isMyChaser ? "1" : "0.2";
      }
    } else if (!activeChaserIndices.has(i) && ghosts[i].element) {
      // Chaser exists but not in active list - check if it's the player's chaser
      const isMyChaser = (myCharacterType === "chaser" || myCharacterType === "ghost") && myColorIndex === i;
      ghosts[i].element.style.opacity = isMyChaser ? "1" : "0.2";
    } else if (ghosts[i].element) {
      // Chaser is in active list - ensure opacity is correct (double-check it's not the player's chaser)
      const isMyChaser = (myCharacterType === "chaser" || myCharacterType === "ghost") && myColorIndex === i;
      if (isMyChaser) {
        ghosts[i].element.style.opacity = "1";
      }
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
        // Legacy support
        pacmanSpeed: fugitiveSpeed,
        ghostSpeed: chaserSpeed,
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
    if ((player.type === "chaser" || player.type === "ghost") && player.stats) {
      teamChaserScore = player.stats.chaserScore || 0;
    }
  });

  // If we're a chaser, also check our own stats
  if (myPlayerId) {
    const myPlayer = connectedPlayers.get(myPlayerId);
    if (myPlayer && (myPlayer.type === "chaser" || myPlayer.type === "ghost") && myPlayer.stats) {
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
  
  if (myColorIndex !== null && ghosts[myColorIndex]) {
    const ghost = ghosts[myColorIndex];
    html += `Position: (${ghost.x}, ${ghost.y})<br>`;
    html += `Target: (${ghost.targetX}, ${ghost.targetY})<br>`;
    html += `Pixel: (${Math.round(ghost.px)}, ${Math.round(ghost.py)})<br>`;
  }
  
  debugDiv.innerHTML = html;
  
  if (false) { // Debug display removed
    setTimeout(updateDebugDisplay, 100); // Update every 100ms
  }
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
  
  if (myColorIndex !== null && ghosts[myColorIndex]) {
    const ghost = ghosts[myColorIndex];
    html += `Position: (${ghost.x}, ${ghost.y})<br>`;
    html += `Target: (${ghost.targetX}, ${ghost.targetY})<br>`;
    html += `Pixel: (${Math.round(ghost.px)}, ${Math.round(ghost.py)})<br>`;
  }
  
  debugDiv.innerHTML = html;
  
  if (false) { // Debug display removed
    setTimeout(updateDebugDisplay, 100); // Update every 100ms
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
        
        // For chasers (ghost type), check both availability and selections
        if (type === "ghost") {
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
          // For fugitives (pacman type), just check availability
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

// Queue system removed - not used

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
    
    // Update renderer size when canvas becomes visible
    // Use a small delay to ensure canvas dimensions are available
    setTimeout(() => {
      if (window.render3D && window.render3D.onResize) {
        window.render3D.onResize();
      }
    }, 0);

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

  // Initialize default settings
  view3D = true;
  aiDifficulty = 0.8;
  
  // Initialize GUI for 2D/3D, Style, and Building settings only
  if (typeof lil !== "undefined" && typeof lil.GUI !== "undefined") {
    const guiContainer = document.getElementById("gui-container");
    const GUI = lil.GUI;
    if (gui) gui.destroy(); // Destroy existing GUI if any
    gui = new GUI({ container: guiContainer });

    // Make guiParams global so it can be accessed by updateCharacterAppearance
    window.guiParams = {
      view3D: true, // Toggle for 3D view
      camera3D: "Orthographic", // Camera type for 3D view
      cameraZoom: 1.56, // Camera zoom level (0.5 to 2.0)
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
    };

    // Create 2D/3D folder
    const view3DFolder = gui.addFolder("2D/3D");
    view3DFolder.close(); // Closed by default

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

    // 3D lighting controls (only visible when 3D view is enabled)
    const ambientLightCtrl = view3DFolder
      .add(guiParams, "ambientLightIntensity", 0, 2, 0.1)
      .name("Ambient Light")
      .onChange((value) => {
        if (view3D && window.render3D && window.render3D.setAmbientLight) {
          window.render3D.setAmbientLight(value);
        }
      });

    const directionalLightCtrl = view3DFolder
      .add(guiParams, "directionalLightIntensity", 0, 2, 0.1)
      .name("Directional Light")
      .onChange((value) => {
        if (view3D && window.render3D && window.render3D.setDirectionalLight) {
          window.render3D.setDirectionalLight(value);
        }
      });

    const pointLightCtrl = view3DFolder
      .add(guiParams, "pointLightIntensity", 0, 400, 1)
      .name("Point Light Intensity")
      .onChange((value) => {
        if (view3D && window.render3D && window.render3D.setPointLightIntensity) {
          window.render3D.setPointLightIntensity(value);
        }
      });

    // Create Style folder for grouped controls
    const styleFolder = gui.addFolder("Style");
    styleFolder.close(); // Closed by default

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
    buildingFolder.close(); // Closed by default

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

    // Apply team images from config to existing characters after GUI is initialized
    if (window.teamConfig && window.teamConfig.teams) {
      window.teamConfig.teams.forEach((team) => {
        if (team.image && team.image.trim() !== "" && pacmen[team.colorIndex] && pacmen[team.colorIndex].element) {
          pacmen[team.colorIndex].element.style.backgroundImage = `url(${team.image})`;
          pacmen[team.colorIndex].element.style.backgroundSize = "cover";
          pacmen[team.colorIndex].element.style.backgroundPosition = "center";
          pacmen[team.colorIndex].element.style.backgroundRepeat = "no-repeat";
        }
      });
    }

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

  // Set initial opacity to 20% for all chasers (they become fully opaque when controlled)
  ghosts.forEach((ghost) => {
    if (ghost.element) {
      ghost.element.style.opacity = "0.2";
    }
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

    // 2D rendering with client-side prediction for my character
    const OTHER_SMOOTHING = 0.5; // Smooth interpolation for other players
    const SNAP_DISTANCE = 40; // pixels – snap if too far to avoid long slides
    const CLIENT_MOVE_SPEED = 0.08; // Local movement speed per frame (adjust for smoothness)

    pacmen.forEach((pacman, index) => {
      if (!pacman || !pacman.element) return;

      const isMine = myCharacterType === "pacman" && myColorIndex === index;

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
          pacman.renderX += dx * OTHER_SMOOTHING;
          pacman.renderY += dy * OTHER_SMOOTHING;
        }
      }

      updatePosition(pacman.element, pacman.renderX, pacman.renderY);
    });

    ghosts.forEach((ghost, index) => {
      if (!ghost || !ghost.element) return;

      const isMine = (myCharacterType === "ghost" || myCharacterType === "chaser") && myColorIndex === index;

      if (ghost.renderX === undefined) {
        ghost.renderX = ghost.px;
        ghost.renderY = ghost.py;
      }

      // For MY character: move smoothly toward target, server corrections blend in
      // For OTHER characters: interpolate toward server position
      if (isMine) {
        // Move toward target position based on current direction
        const targetPixel = getTargetPixelPos(ghost.targetX, ghost.targetY);
        const toTargetX = targetPixel.x - ghost.renderX;
        const toTargetY = targetPixel.y - ghost.renderY;
        const distToTarget = Math.sqrt(toTargetX * toTargetX + toTargetY * toTargetY);
        
        if (distToTarget > 1) {
          // Move toward target
          ghost.renderX += (toTargetX / distToTarget) * CLIENT_MOVE_SPEED * CELL_SIZE;
          ghost.renderY += (toTargetY / distToTarget) * CLIENT_MOVE_SPEED * CELL_SIZE;
        }
        
        // Blend with server position (gentle correction)
        const toServerX = ghost.px - ghost.renderX;
        const toServerY = ghost.py - ghost.renderY;
        const distToServer = Math.sqrt(toServerX * toServerX + toServerY * toServerY);
        
        if (distToServer > SNAP_DISTANCE) {
          // Too far from server, snap to it
          ghost.renderX = ghost.px;
          ghost.renderY = ghost.py;
        } else if (distToServer > 2) {
          // Gentle correction toward server position (10% blend)
          ghost.renderX += toServerX * 0.1;
          ghost.renderY += toServerY * 0.1;
        }
      } else {
        // Other players: interpolate toward server position
        const dx = ghost.px - ghost.renderX;
        const dy = ghost.py - ghost.renderY;
        const dist = Math.sqrt(dx * dx + dy * dy);
        if (dist > SNAP_DISTANCE) {
          ghost.renderX = ghost.px;
          ghost.renderY = ghost.py;
        } else {
          ghost.renderX += dx * OTHER_SMOOTHING;
          ghost.renderY += dy * OTHER_SMOOTHING;
        }
      }

      updatePosition(ghost.element, ghost.renderX, ghost.renderY);
    });

    animationId = requestAnimationFrame(renderLoop);
  }

  // Handle player input - send direction to server
  // WASD controls whichever chaser the player is currently controlling
  document.addEventListener("keydown", (e) => {
    keys[e.key] = true;
    
    // Only accept WASD keys (not arrow keys)
    let dir = null;
    if (e.key === "a" || e.key === "A") dir = "left";
    else if (e.key === "d" || e.key === "D") dir = "right";
    else if (e.key === "w" || e.key === "W") dir = "up";
    else if (e.key === "s" || e.key === "S") dir = "down";
    
    // Only process WASD movement keys
    if (!dir) {
      return;
    }

    if (!multiplayerMode || !myPlayerId) return;
    
    // If already controlling a chaser (any chaser 0-3), send input for that chaser
    if ((myCharacterType === "chaser" || myCharacterType === "ghost") && myColorIndex !== null && myColorIndex >= 0 && myColorIndex <= 3) {
      sendInput({ dir });
      return;
    }
    
    // If not controlling any chaser, auto-join chaser 0 as default
    if (myCharacterType !== "chaser" && myCharacterType !== "ghost") {
      joinAsCharacter("chaser", 0, guiParams.playerInitials);
      // Wait a moment for the join to process, then send input
      setTimeout(() => {
        if ((myCharacterType === "chaser" || myCharacterType === "ghost") && myColorIndex === 0) {
          sendInput({ dir });
        }
      }, 50);
      return;
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

  // Update image - check for team image from config first, then character.image
  let imageToUse = null;
  if (isPacman && character.color) {
    const colorIndex = COLORS.indexOf(character.color.toLowerCase());
    if (colorIndex >= 0 && window.teamConfig && window.teamConfig.teams) {
      const team = window.teamConfig.teams.find(t => t.colorIndex === colorIndex);
      if (team && team.image && team.image.trim() !== "") {
        imageToUse = team.image;
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
  const flashColor = defaultColors[chaserColorIndex];

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
