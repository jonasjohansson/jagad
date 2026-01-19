// Import shared utilities
import { initDpad, getCurrentDirection } from "./dpad.js";
import { getServerFromURL, getWebSocketAddress, promptForInitials } from "./utils.js";

// Constants
const INPUT_THROTTLE = 50; // Throttle input to prevent excessive messages
const DEBUG = false; // Set to true to enable debug logging

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
// Removed gameEndHandled flag - each controller is independent

// DOM elements (cached) - initialized after DOM is ready
let elements = {};

// Utility functions
function getServerAddress() {
  return getServerFromURL();
}

// Removed duplicate functions - now using dpad.js module

function sendInput(dir) {
  if (!ws || ws.readyState !== WebSocket.OPEN || !myPlayerId || myColorIndex === null || !gameStarted) {
    return;
  }

  const now = Date.now();
  if (now - lastInputTime < INPUT_THROTTLE) return;
  
  lastInputTime = now;
  currentDir = dir;
  
  if (DEBUG) console.log("[sendInput] Sending input", dir, "for chaser", myColorIndex);
  ws.send(JSON.stringify({ type: "input", input: { dir } }));
}

// WebSocket
function initWebSocket() {
  const serverAddress = getServerAddress();
  const wsUrl = getWebSocketAddress(serverAddress);

  try {
    ws = new WebSocket(wsUrl);

    ws.onopen = () => {
      if (DEBUG) console.log("[WebSocket] Connection opened");
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: "gameState" }));
      }
    };

    ws.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        // Always log gameEnd messages for debugging
        if (data.type === "gameEnd") {
          console.log("[WebSocket] Received gameEnd message:", data);
        } else if (DEBUG && data.type !== "gameState") {
          console.log("[WebSocket] Received:", data.type);
        }
        handleServerMessage(data);
      } catch (error) {
        console.error("[WebSocket] Error parsing message:", error);
      }
    };

    ws.onerror = (error) => {
      console.error("[WebSocket] Error:", error);
    };
    ws.onclose = () => {
      if (DEBUG) console.log("[WebSocket] Connection closed, reconnecting...");
      setTimeout(initWebSocket, 3000);
    };
  } catch (error) {
    console.error("Error connecting:", error);
  }
}

function handleServerMessage(data) {
  // Always log gameEnd messages for debugging
  if (data.type === "gameEnd") {
    console.log("[handleServerMessage] ===== ENTERING gameEnd HANDLER =====", data);
  }
  switch (data.type) {
    case "connected":
      myPlayerId = data.playerId;
      break;
    case "joined":
      if (DEBUG) console.log("[joined] Player joined as chaser", data.colorIndex);
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
      
      // If we were trying to start the game, do it now that we're joined
      if (pendingStartGame && !gameStarted && ws?.readyState === WebSocket.OPEN) {
        pendingStartGame = false;
        ws.send(JSON.stringify({ type: "startGame" }));
      }
      break;
    case "joinFailed":
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
      }
      break;
    case "gameStarted":
      gameStarted = true;
      previousGameStarted = true;
      pendingStartGame = false;
      elements.chaserSelect?.classList.add("game-started");
      updateStartButton();
      updateChaserButtons();
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
        welcomeMsgRestart.textContent = "Welcome to the Jagad game, play alone or up to 4 players. Your goal is to catch the Jagad fugitives as fast as possible. Click 'Play' to join. If a game is already playing, you can join, or wait until it's over to start a new game. Each game is 90 seconds.";
      }
      break;
    case "gameEnd":
      // Game ended - show alert with score and reload page
      console.log("[gameEnd] Handler called with data:", data);
      
      // Immediately update state
      gameStarted = false;
      previousGameStarted = false;
      
      // Show alert with score information
      const timeSeconds = ((data.gameTime || 0) / 1000).toFixed(1);
      const score = data.score || 0;
      const fugitivesCaught = data.fugitivesCaught || 0;
      const totalFugitives = data.totalFugitives || 0;
      
      let message;
      if (data.allCaught) {
        message = `GAME OVER - ALL FUGITIVES CAUGHT\n\n` +
                  `Score: ${score.toLocaleString()}\n` +
                  `Time: ${timeSeconds} seconds\n` +
                  `Fugitives Caught: ${fugitivesCaught} of ${totalFugitives}\n\n` +
                  `Click OK to play again.`;
      } else {
        message = `GAME OVER - TIME'S UP\n\n` +
                  `Score: ${score.toLocaleString()}\n` +
                  `Time: ${timeSeconds} seconds\n` +
                  `Fugitives Caught: ${fugitivesCaught} of ${totalFugitives}\n\n` +
                  `Click OK to play again.`;
      }
      
      console.log("[gameEnd] About to show alert with message:", message);
      console.log("[gameEnd] Controller ID:", myPlayerId, "Color Index:", myColorIndex);
      
      // Show alert immediately - each controller should show its own alert
      // Use setTimeout to ensure it's in the event loop, but with minimal delay
      setTimeout(() => {
        try {
          console.log("[gameEnd] Showing alert now...");
          // Show alert - alert() is a blocking call, so execution pauses here
          // until the user clicks OK. Only then will the code continue to reload.
          alert(message);
          console.log("[gameEnd] Alert dismissed, reloading page...");
          
          // This line only executes AFTER the user clicks OK on the alert
          // Reload the page ONLY after alert is dismissed
          window.location.reload();
        } catch (error) {
          console.error("[gameEnd] Error showing alert:", error);
          // Fallback: show simple alert and reload
          alert("Game Over! Your score: " + (data.score || 0));
          window.location.reload();
        }
      }, 50); // Minimal delay to ensure message processing
      break;
    case "gameReset":
    case "gameRestarted":
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
        welcomeMsg.textContent = "Welcome to the Jagad game, play alone or up to 4 players. Your goal is to catch the Jagad fugitives as fast as possible. Click 'Play' to join. If a game is already playing, you can join, or wait until it's over to start a new game. Each game is 90 seconds.";
      }
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
      welcomeMsg.textContent = "Welcome to the Jagad game, play alone or up to 4 players. Your goal is to catch the Jagad fugitives as fast as possible. Click 'Play' to join. If a game is already playing, you can join, or wait until it's over to start a new game. Each game is 90 seconds.";
    }
  }
}


function updateScoreDisplay() {
  if (!elements.scoreValue) return;
  
  // Find first chaser's score (all chasers share the same team score)
  for (const player of connectedPlayers.values()) {
    if ((player.type === "chaser" || player.type === "ghost") && player.stats?.chaserScore != null) {
      elements.scoreValue.textContent = player.stats.chaserScore;
      return;
    }
  }
  // Default to 0 if no score found
  elements.scoreValue.textContent = 0;
}

function autoAssignChaser() {
  // Find first available chaser that's not taken
  const availableChaser = availableChasers.find(index => !takenChasers.has(index));
  
  if (availableChaser === undefined) {
    // No available chasers
    alert("All chasers are occupied. Please wait for the current game to end.");
    return null;
  }
  
  // Prompt for initials
  const initials = promptForInitials();
  if (!initials) return null; // User cancelled
  
  return { colorIndex: availableChaser, playerName: initials };
}

function joinAsChaser(colorIndex, playerName) {
  if (!ws || ws.readyState !== WebSocket.OPEN) return;
  if (colorIndex === null || colorIndex === undefined) return;
  if (!availableChasers.includes(colorIndex)) return;

  // Prompt for game code
  const gameCode = prompt("Enter the 2-digit game code:");
  if (!gameCode) {
    // User cancelled or entered nothing
    return;
  }
  
  // Validate and normalize the code (ensure 2 digits, pad with 0 if needed)
  const normalizedCode = gameCode.trim().padStart(2, '0').slice(0, 2);
  if (!/^\d{2}$/.test(normalizedCode)) {
    alert("Invalid code. Please enter a 2-digit number (00-99).");
    return;
  }

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
  if (dir) {
    sendInput(dir);
  }
}

// Initialize DOM elements
function initElements() {
  elements = {
    joystickBase: document.getElementById("joystick-base"),
    joystickHandle: document.getElementById("joystick-handle"),
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
    elements.startBtn.addEventListener("click", () => {
      if (myColorIndex !== null) return; // Already joined
      if (!ws || ws.readyState !== WebSocket.OPEN) return;
      
      // Auto-assign a chaser
      const assignment = autoAssignChaser();
      if (!assignment) return; // No available chaser or user cancelled
      
      // Join with the auto-assigned chaser
      if (!gameStarted) {
        // Game hasn't started - join and start the game
        pendingStartGame = true;
        selectedChaserIndex = assignment.colorIndex;
        selectedChaserName = assignment.playerName;
        joinAsChaser(assignment.colorIndex, assignment.playerName);
      } else {
        // Game has already started - just join
        selectedChaserIndex = assignment.colorIndex;
        selectedChaserName = assignment.playerName;
        joinAsChaser(assignment.colorIndex, assignment.playerName);
      }
    });
  }

  // Initialize shared D-pad component
  if (elements.joystickBase && elements.joystickHandle) {
    initDpad("joystick-base", "joystick-handle", onDpadDirectionChange);
  }
}

// Initialize when DOM is ready
if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", () => {
    initElements();
    initEventListeners();
    updateUI();
    initWebSocket();
  });
} else {
  initElements();
  initEventListeners();
  updateUI();
  initWebSocket();
}

// Removed test function
