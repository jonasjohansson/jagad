// Import shared D-pad component
import { initDpad, getCurrentDirection } from "./dpad.js";

// Constants
const REMOTE_SERVER_ADDRESS = "https://pacman-server-239p.onrender.com";
const LOCAL_SERVER_ADDRESS = "http://localhost:3000";
const INPUT_THROTTLE = 50; // Throttle input to prevent excessive messages
const DEBUG = false; // Set to true to enable debug logging

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

// State
let ws = null;
let myPlayerId = null;
let myColorIndex = null; // The chaser we're actually joined as
let selectedChaserIndex = null; // The chaser we've selected but not yet joined
let selectedChaserName = null; // The name for the selected chaser
let pendingStartGame = false; // Whether we're waiting to start the game after joining
let gameStarted = false;
let connectedPlayers = new Map();
let availableChasers = [0, 1, 2, 3];
let playerNames = new Map(); // colorIndex -> playerName
let takenChasers = new Set(); // colorIndex -> Set of chasers taken by other players (selected or joined)
let lastInputTime = 0;
let currentDir = null; // Current direction being sent to server
let isFirstPlayer = false;
// Track previous state to avoid unnecessary updates
let previousAvailableChasers = [];
let previousPlayerNames = new Map();
let previousMyColorIndex = null;
let previousGameStarted = false;
let previousSelectedChaserIndex = null;

// DOM elements (cached) - initialized after DOM is ready
let elements = {};

// Utility functions
function getServerAddress() {
  return getServerFromURL();
}

function promptForInitials() {
  console.log("[promptForInitials] Starting prompt...");
  let initials = "";
  while (!initials || initials.length === 0) {
    console.log("[promptForInitials] Showing prompt dialog...");
    const input = prompt("Enter your 3-letter initials:");
    console.log("[promptForInitials] User entered:", input);
    if (input === null) {
      // User cancelled
      console.log("[promptForInitials] User cancelled");
      return null;
    }
    initials = input.toUpperCase().replace(/[^A-Z]/g, "").slice(0, 3);
    if (initials.length === 0) {
      alert("Please enter at least one letter.");
    }
  }
  console.log("[promptForInitials] Returning initials:", initials);
  return initials || null;
}

function calculateDirection(deltaX, deltaY, threshold = JOYSTICK_THRESHOLD) {
  if (Math.abs(deltaX) > Math.abs(deltaY)) {
    if (deltaX > threshold) return "right";
    if (deltaX < -threshold) return "left";
  } else {
    if (deltaY > threshold) return "down";
    if (deltaY < -threshold) return "up";
  }
  return null;
}

function getJoystickCenter() {
  const rect = elements.joystickBase.getBoundingClientRect();
  return {
    x: rect.left + rect.width / 2,
    y: rect.top + rect.height / 2,
    maxDistance: Math.min(rect.width, rect.height) / 2 - JOYSTICK_OFFSET
  };
}

function sendInput(dir) {
  // Don't send null directions - only send actual direction changes
  if (!dir) {
    return;
  }

  if (!ws || ws.readyState !== WebSocket.OPEN) {
    console.log("[sendInput] Blocked - WebSocket not ready:", ws?.readyState);
    return;
  }
  
  if (!myPlayerId) {
    console.log("[sendInput] Blocked - no player ID");
    return;
  }
  
  if (myColorIndex === null) {
    console.log("[sendInput] Blocked - not joined as chaser (myColorIndex is null)");
    return;
  }
  
  if (!gameStarted) {
    console.log("[sendInput] Blocked - game not started yet");
    return;
  }

  const now = Date.now();
  if (now - lastInputTime < INPUT_THROTTLE) {
    return;
  }
  
  lastInputTime = now;
  currentDir = dir;
  
  console.log("[sendInput] ✓ Sending input", dir, "for chaser", myColorIndex);
  ws.send(JSON.stringify({ type: "input", input: { dir } }));
}

// WebSocket
function initWebSocket() {
  const wsUrl = getServerAddress().replace(/^https?:/, (m) => m === "https:" ? "wss:" : "ws:");

  try {
    ws = new WebSocket(wsUrl);

    ws.onopen = () => {
      console.log("[WebSocket] Connection opened");
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: "gameState" }));
      }
    };

    ws.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        // Log all important messages for debugging
        if (data.type === "gameEnd") {
          console.log("[WebSocket] ===== GAME END MESSAGE RECEIVED IN ONMESSAGE =====", data);
        } else if (data.type === "joined" || data.type === "gameStarted" || data.type === "joinFailed") {
          console.log("[WebSocket] Received message type:", data.type, data);
        } else if (data.type !== "gameState") {
          // Log other messages except gameState
          console.log("[WebSocket] Received message type:", data.type);
        }
        handleServerMessage(data);
      } catch (error) {
        console.error("Error parsing message:", error, event.data);
      }
    };

    ws.onerror = (error) => {
      console.error("[WebSocket] Error:", error);
    };
    ws.onclose = () => {
      console.log("[WebSocket] Connection closed, reconnecting in 3 seconds...");
      setTimeout(initWebSocket, 3000);
    };
  } catch (error) {
    console.error("Error connecting:", error);
  }
}

function handleServerMessage(data) {
  // Only log gameEnd messages for debugging
  if (data.type === "gameEnd") {
    console.log("[handleServerMessage] ===== ENTERING gameEnd HANDLER =====", data);
  }
  switch (data.type) {
    case "connected":
      myPlayerId = data.playerId;
      break;
    case "joined":
      console.log("[controller] Joined message received:", data);
      myColorIndex = data.colorIndex;
      previousMyColorIndex = data.colorIndex;
      // Clear selection since we're now joined
      if (selectedChaserIndex === data.colorIndex) {
        selectedChaserIndex = null;
        selectedChaserName = null;
      }
      // Store our own name
      if (data.playerName) {
        playerNames.set(data.colorIndex, data.playerName);
      }
      updateUI();
      updateChaserButtons();
      updateStartButton();
      updateJoystickState();
      
      // If we were trying to start the game, do it now that we're joined
      console.log("[controller] Checking if should start game - pendingStartGame:", pendingStartGame, "gameStarted:", gameStarted, "ws ready:", ws?.readyState);
      if (pendingStartGame && !gameStarted && ws?.readyState === WebSocket.OPEN) {
        console.log("[controller] Sending startGame message");
        pendingStartGame = false;
        ws.send(JSON.stringify({ type: "startGame" }));
      }
      break;
    case "joinFailed":
      console.log("[controller] Join failed:", data.reason);
      alert(data.reason || "Failed to join game. Please try again.");
      break;
    case "gameState":
      let playerNamesChanged = false;
      let availableChasersChanged = false;
      
      if (data.players) {
        connectedPlayers.clear();
        const newPlayerNames = new Map();
        let playerCount = 0;
        // Check if this client's player is in the list and update myColorIndex
        let foundMyPlayer = false;
        data.players.forEach((player) => {
          if (player.connected) {
            playerCount++;
            connectedPlayers.set(player.playerId, {
              type: player.type,
              colorIndex: player.colorIndex,
              stats: player.stats || null,
            });
            // Store player names by colorIndex (for joined players)
            if (player.colorIndex !== null && player.colorIndex !== undefined && player.playerName) {
              newPlayerNames.set(player.colorIndex, player.playerName);
            }
            // If this is our player, update myColorIndex
            if (player.playerId === myPlayerId) {
              myColorIndex = player.colorIndex;
              foundMyPlayer = true;
            }
          }
        });
        // If we didn't find our player in the list, reset myColorIndex
        if (!foundMyPlayer && myPlayerId) {
          myColorIndex = null;
        }
        isFirstPlayer = playerCount === 1 && myPlayerId && connectedPlayers.has(myPlayerId);
        
        // Track which chasers are taken (by other players) and process selections
        const newTakenChasers = new Set();
        
        // Process players and selections in a single pass where possible
        data.players.forEach((player) => {
          if (player.connected && player.colorIndex != null) {
            // Mark as taken if it's not our own chaser
            if (player.playerId !== myPlayerId) {
              newTakenChasers.add(player.colorIndex);
            }
          }
        });
        
        // Process chaser selections
        if (data.chaserSelections) {
          for (const [colorIndexStr, selection] of Object.entries(data.chaserSelections)) {
            const colorIndex = parseInt(colorIndexStr, 10);
            if (isNaN(colorIndex) || !selection.playerName) continue;
            
            // Only add if not already joined
            if (!newPlayerNames.has(colorIndex)) {
              newPlayerNames.set(colorIndex, selection.playerName);
            }
            // Mark as taken if it's not our own selection
            if (selectedChaserIndex !== colorIndex) {
              newTakenChasers.add(colorIndex);
            }
          }
        }
        
        // Update taken chasers
        takenChasers = newTakenChasers;
        
        // Check if player names changed (optimized comparison)
        playerNamesChanged = 
          newPlayerNames.size !== previousPlayerNames.size ||
          (newPlayerNames.size > 0 && Array.from(newPlayerNames.entries()).some(([key, val]) => previousPlayerNames.get(key) !== val));
        
        if (playerNamesChanged) {
          playerNames = newPlayerNames;
          previousPlayerNames = new Map(newPlayerNames);
        }
        
        updateScoreDisplay();
      }
      
      // Update gameStarted state from server
      if (data.gameStarted !== undefined) {
        gameStarted = data.gameStarted;
        if (gameStarted !== previousGameStarted) {
          previousGameStarted = gameStarted;
        }
      }
      
      if (data.availableColors?.chaser) {
        const newAvailableChasers = data.availableColors.chaser;
        // Only update if available chasers changed
        availableChasersChanged = 
          newAvailableChasers.length !== previousAvailableChasers.length ||
          !newAvailableChasers.every((val, idx) => val === previousAvailableChasers[idx]);
        
        if (availableChasersChanged) {
          availableChasers = newAvailableChasers;
          previousAvailableChasers = [...newAvailableChasers];
        }
      }
      
      // Only update buttons if something actually changed
      if (availableChasersChanged || playerNamesChanged) {
        updateChaserButtons();
      }
      
      // Update previous values and check if state changed
      const myColorIndexChanged = myColorIndex !== previousMyColorIndex;
      const gameStartedChanged = gameStarted !== previousGameStarted;
      const selectedChaserIndexChanged = selectedChaserIndex !== previousSelectedChaserIndex;
      
      if (myColorIndexChanged) {
        previousMyColorIndex = myColorIndex;
      }
      if (gameStartedChanged) {
        previousGameStarted = gameStarted;
      }
      if (selectedChaserIndexChanged) {
        previousSelectedChaserIndex = selectedChaserIndex;
      }
      
      // Only update start button if relevant state changed
      if (myColorIndexChanged || gameStartedChanged || selectedChaserIndexChanged) {
        updateStartButton();
        updateJoystickState();
      }
      break;
    case "gameStarted":
      console.log("[controller] gameStarted message received");
      gameStarted = true;
      previousGameStarted = true;
      pendingStartGame = false;
      elements.chaserSelect?.classList.add("game-started");
      updateStartButton();
      updateChaserButtons();
      updateJoystickState();
      // Request latest game state to get updated available chasers
      if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: "gameState" }));
      }
      break;
    case "gameRestarted":
      gameStarted = false;
      previousGameStarted = false;
      updateUI();
      elements.chaserSelect?.classList.remove("game-started");
      // Reset welcome message
      const welcomeMsgRestart = document.getElementById("welcome-message");
      if (welcomeMsgRestart) {
        welcomeMsgRestart.textContent = "Welcome to the Jagad game, play alone or up to 4 players. Your goal is to catch the Jagad fugitives as fast as possible. Click 'Play' to join. If a game is already playing, you can join, or wait until it's over to start a new game. Each game is 90 seconds. Use the joystick to control your chaser: move left, right, up, and down.";
      }
      updateJoystickState();
      break;
    case "gameEnd":
      // Game ended - show alert with score and reload page
      try {
        gameStarted = false;
        previousGameStarted = false;
        
        // Show alert with score information
        const timeSeconds = ((data.gameTime || 0) / 1000).toFixed(1);
        const score = data.score || 0;
        const fugitivesCaught = data.fugitivesCaught || 0;
        const totalFugitives = data.totalFugitives || 0;
        
        let message;
        if (data.allCaught) {
          message = `🎮 GAME OVER - ALL FUGITIVES CAUGHT!\n\n` +
                    `Your Score: ${score.toLocaleString()}\n` +
                    `Time: ${timeSeconds}s\n` +
                    `Fugitives Caught: ${fugitivesCaught}/${totalFugitives}\n\n` +
                    `Great job! Click OK to play again.`;
        } else {
          message = `🎮 GAME OVER - TIME'S UP!\n\n` +
                    `Your Score: ${score.toLocaleString()}\n` +
                    `Time: ${timeSeconds}s\n` +
                    `Fugitives Caught: ${fugitivesCaught}/${totalFugitives}\n\n` +
                    `Click OK to play again.`;
        }
        
        // Show alert - alert() is a blocking call, so execution pauses here
        // until the user clicks OK. Only then will the code continue to reload.
        alert(message);
        
        // This line only executes AFTER the user clicks OK on the alert
        // Reload the page ONLY after alert is dismissed
        window.location.reload();
      } catch (error) {
        console.error("[gameEnd] Error handling game end:", error);
        // Fallback: show simple alert and reload
        alert("Game Over! Your score: " + (data.score || 0));
        window.location.reload();
      }
      break;
    case "gameReset":
      gameStarted = false;
      previousGameStarted = false;
      myColorIndex = null;
      previousMyColorIndex = null;
      selectedChaserIndex = null;
      selectedChaserName = null;
      pendingStartGame = false;
      isFirstPlayer = false;
      // Reset score display to show current score
      updateScoreDisplay();
      updateChaserButtons();
      updateUI();
      elements.chaserSelect?.classList.remove("game-started");
      // Reset welcome message
      const welcomeMsg = document.getElementById("welcome-message");
      if (welcomeMsg) {
        welcomeMsg.textContent = "Welcome to the Jagad game, play alone or up to 4 players. Your goal is to catch the Jagad fugitives as fast as possible. Click 'Play' to join. If a game is already playing, you can join, or wait until it's over to start a new game. Each game is 90 seconds. Use the joystick to control your chaser: move left, right, up, and down.";
      }
      updateJoystickState();
      break;
    default:
      // Log any unhandled message types for debugging
      if (data.type && data.type !== "playerLeft" && data.type !== "fugitiveCaught") {
        console.log("[handleServerMessage] Unhandled message type:", data.type, data);
      }
      break;
  }
}

// UI Updates
function updateUI() {
  updateStartButton();
  updateJoystickState();
}

function updateJoystickState() {
  // Enable joystick only if player has joined and game has started
  if (elements.joystickContainer) {
    if (myColorIndex !== null && gameStarted) {
      elements.joystickContainer.classList.remove("disabled");
    } else {
      elements.joystickContainer.classList.add("disabled");
    }
  }
}

function updateChaserButtons() {
  // Hide chaser selection buttons - auto-assignment is used instead
  elements.chaserButtons.forEach((btn) => {
    const indexStr = btn.dataset.index;
    if (indexStr === "start") return;
    
    // Hide the chaser selection buttons
    btn.style.display = "none";
  });
}

function updateStartButton() {
  if (!elements.startBtn) return;
  
  // Enable "Play" if:
  //   - Player hasn't joined yet (myColorIndex === null)
  //   - There are available chasers
  // Disable if:
  //   - Player has already joined (myColorIndex !== null)
  //   - All chasers are taken
  
  elements.startBtn.textContent = "Play";
  
  if (myColorIndex !== null) {
    // Player has already joined - disable button
    elements.startBtn.disabled = true;
    elements.startBtn.classList.add("disabled");
  } else if (availableChasers.length === 0 || availableChasers.every(index => takenChasers.has(index))) {
    // All chasers are taken - disable and show wait message
    elements.startBtn.disabled = true;
    elements.startBtn.classList.add("disabled");
    // Show wait message in welcome message
    const welcomeMsg = document.getElementById("welcome-message");
    if (welcomeMsg) {
      welcomeMsg.textContent = "All chasers are occupied. Please wait for the current game to end, then you can join.";
    }
  } else {
    // There are available chasers - enable button
    elements.startBtn.disabled = false;
    elements.startBtn.classList.remove("disabled");
    // Reset welcome message
    const welcomeMsg = document.getElementById("welcome-message");
    if (welcomeMsg) {
      welcomeMsg.textContent = "Welcome to the Jagad game, play alone or up to 4 players. Your goal is to catch the Jagad fugitives as fast as possible. Click 'Play' to join. If a game is already playing, you can join, or wait until it's over to start a new game. Each game is 90 seconds. Use the joystick to control your chaser: move left, right, up, and down.";
    }
  }
}


function updateScoreDisplay() {
  if (!elements.scoreValue) return;
  
  // Find first chaser's score (all chasers share the same team score)
  for (const player of connectedPlayers.values()) {
    if (player.type === "chaser" && player.stats?.chaserScore != null) {
      elements.scoreValue.textContent = player.stats.chaserScore;
      return;
    }
  }
  // Default to 0 if no score found
  elements.scoreValue.textContent = 0;
}

function autoAssignChaser() {
  console.log("[autoAssignChaser] availableChasers:", availableChasers, "takenChasers:", Array.from(takenChasers));
  
  // Ensure we have some chasers to work with
  if (availableChasers.length === 0) {
    console.log("[autoAssignChaser] No chasers in availableChasers, using defaults");
    availableChasers = [0, 1, 2, 3];
  }
  
  // Find first available chaser that's not taken
  const availableChaser = availableChasers.find(index => !takenChasers.has(index));
  
  if (availableChaser === undefined) {
    // No available chasers - try using first chaser anyway if all are taken
    console.log("[autoAssignChaser] No available chasers found, trying first chaser");
    if (availableChasers.length > 0) {
      const firstChaser = availableChasers[0];
      console.log("[autoAssignChaser] Using first chaser as fallback:", firstChaser);
      // Still prompt for initials even if chaser might be taken - server will handle it
      const initials = promptForInitials();
      if (!initials) {
        return null;
      }
      return { colorIndex: firstChaser, playerName: initials };
    }
    alert("All chasers are occupied. Please wait for the current game to end.");
    return null;
  }
  
  console.log("[autoAssignChaser] Found available chaser:", availableChaser);
  // Prompt for initials
  console.log("[autoAssignChaser] About to show prompt for initials...");
  const initials = promptForInitials();
  console.log("[autoAssignChaser] Got initials:", initials);
  if (!initials) {
    console.log("[autoAssignChaser] User cancelled initials prompt");
    return null; // User cancelled
  }
  
  console.log("[autoAssignChaser] Returning assignment:", { colorIndex: availableChaser, playerName: initials });
  return { colorIndex: availableChaser, playerName: initials };
}

function joinAsChaser(colorIndex, playerName) {
  console.log("[joinAsChaser] Called with colorIndex:", colorIndex, "playerName:", playerName);
  if (!ws || ws.readyState !== WebSocket.OPEN) {
    console.log("[joinAsChaser] WebSocket not ready");
    return;
  }
  if (colorIndex === null || colorIndex === undefined) {
    console.log("[joinAsChaser] Invalid colorIndex");
    return;
  }
  if (!availableChasers.includes(colorIndex)) {
    console.log("[joinAsChaser] ColorIndex not in availableChasers:", availableChasers);
    return;
  }

  // Prompt for game code
  console.log("[joinAsChaser] About to show prompt for game code...");
  const gameCode = prompt("Enter the 2-digit game code:");
  console.log("[joinAsChaser] User entered game code:", gameCode);
  if (!gameCode) {
    // User cancelled or entered nothing
    console.log("[joinAsChaser] User cancelled game code prompt");
    return;
  }
  
  // Validate and normalize the code (ensure 2 digits, pad with 0 if needed)
  const normalizedCode = gameCode.trim().padStart(2, '0').slice(0, 2);
  if (!/^\d{2}$/.test(normalizedCode)) {
    alert("Invalid code. Please enter a 2-digit number (00-99).");
    console.log("[joinAsChaser] Invalid game code entered");
    return;
  }

  console.log("[joinAsChaser] Sending join message with code:", normalizedCode);
  ws.send(JSON.stringify({
    type: "join",
    characterType: "chaser",
    colorIndex: colorIndex,
    playerName: playerName,
    gameCode: normalizedCode,
  }));
}

// D-pad callback - called when direction changes
function onDpadDirectionChange(dir) {
  console.log("[onDpadDirectionChange] Direction changed:", dir, "gameStarted:", gameStarted, "myColorIndex:", myColorIndex);
  if (dir) {
    sendInput(dir);
  }
  // When dir is null, we don't send anything - the server will stop movement
  // when no new input is received (handled by the game loop)
}

// Initialize DOM elements
function initElements() {
  elements = {
    joystickBase: document.getElementById("joystick-base"),
    joystickHandle: document.getElementById("joystick-handle"),
    joystickContainer: document.getElementById("joystick-container"),
    chaserButtons: document.querySelectorAll(".chaser-btn[data-index]"),
    startBtn: document.getElementById("start-btn"),
    chaserSelect: document.getElementById("chaser-select"),
    scoreValue: document.getElementById("score-value")
  };
}

// Initialize event listeners
function initEventListeners() {
  // Only handle the Play button click
  if (elements.startBtn) {
    const handlePlayClick = (e) => {
      e.preventDefault();
      e.stopPropagation();
      console.log("[Play button] Clicked - myColorIndex:", myColorIndex, "ws:", !!ws, "readyState:", ws?.readyState, "disabled:", elements.startBtn.disabled);
      
      // Check if button is disabled
      if (elements.startBtn.disabled) {
        console.log("[Play button] Button is disabled");
        if (myColorIndex !== null) {
          alert("You have already joined the game!");
        } else if (availableChasers.length === 0 || availableChasers.every(index => takenChasers.has(index))) {
          alert("All chasers are occupied. Please wait for the current game to end.");
        }
        return;
      }
      
      if (myColorIndex !== null) {
        console.log("[Play button] Already joined, ignoring click");
        alert("You have already joined the game!");
        return; // Already joined
      }
      if (!ws || ws.readyState !== WebSocket.OPEN) {
        console.log("[Play button] WebSocket not ready");
        alert("Connecting to server... Please wait a moment and try again.");
        return;
      }
      
      console.log("[Play button] Auto-assigning chaser...");
      // Auto-assign a chaser
      const assignment = autoAssignChaser();
      if (!assignment) {
        console.log("[Play button] No assignment (user cancelled or no chasers available)");
        // Don't show alert here - autoAssignChaser already shows one if needed
        return; // No available chaser or user cancelled
      }
      
      console.log("[Play button] Assignment:", assignment, "gameStarted:", gameStarted);
      // Join with the auto-assigned chaser
      if (!gameStarted) {
        // Game hasn't started - join and start the game
        console.log("[Play button] Game not started, setting pendingStartGame and joining");
        pendingStartGame = true;
        selectedChaserIndex = assignment.colorIndex;
        selectedChaserName = assignment.playerName;
        joinAsChaser(assignment.colorIndex, assignment.playerName);
      } else {
        // Game has already started - just join
        console.log("[Play button] Game already started, just joining");
        selectedChaserIndex = assignment.colorIndex;
        selectedChaserName = assignment.playerName;
        joinAsChaser(assignment.colorIndex, assignment.playerName);
      }
    };
    
    // Add both click and touch handlers for mobile compatibility
    elements.startBtn.addEventListener("click", handlePlayClick);
    elements.startBtn.addEventListener("touchend", (e) => {
      e.preventDefault();
      handlePlayClick(e);
    }, { passive: false });
  }

  // Initialize shared D-pad component
  if (elements.joystickBase && elements.joystickHandle) {
    initDpad("joystick-base", "joystick-handle", onDpadDirectionChange);
  }
}

// Export initialization function for module usage
export function initControllerModule(containerSelector = "body") {
  const container = typeof containerSelector === "string" 
    ? document.querySelector(containerSelector) 
    : containerSelector;
  
  if (!container) {
    console.error("Controller module: Container not found:", containerSelector);
    return;
  }

  console.log("[controller] Initializing module in container:", containerSelector);
  initElements();
  initEventListeners();
  updateUI();
  initWebSocket();
}

// Auto-initialize if running standalone (not imported as module)
if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", () => {
    console.log("[controller] DOM loaded, initializing...");
    initElements();
    initEventListeners();
    updateUI();
    initWebSocket();
  });
} else {
  console.log("[controller] DOM already ready, initializing...");
  initElements();
  initEventListeners();
  updateUI();
  initWebSocket();
}

// Test function to verify alert works - can be called from console: testAlert()
window.testAlert = function() {
  console.log("[TEST] Testing alert function...");
  alert("Test alert - if you see this, alerts work!");
  console.log("[TEST] Alert was shown and dismissed");
};

// Test function to verify prompt works - can be called from console: testPrompt()
window.testPrompt = function() {
  console.log("[TEST] Testing prompt function...");
  const result = prompt("Test prompt - enter something:");
  console.log("[TEST] Prompt result:", result);
  return result;
};

// Test function to manually trigger play button logic
window.testPlayButton = function() {
  console.log("[TEST] Testing play button logic...");
  if (!elements.startBtn) {
    console.error("[TEST] Start button element not found!");
    return;
  }
  console.log("[TEST] Button found, triggering click handler...");
  const event = new Event('click', { bubbles: true, cancelable: true });
  elements.startBtn.dispatchEvent(event);
};
