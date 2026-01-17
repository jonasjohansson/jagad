// Import shared D-pad component
import { initDpad, getCurrentDirection } from "../shared/dpad.js";

// Constants
const REMOTE_SERVER_ADDRESS = "https://pacman-server-239p.onrender.com";
const LOCAL_SERVER_ADDRESS = "http://localhost:3000";
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
  let initials = "";
  while (!initials || initials.length === 0) {
    const input = prompt("Enter your 3-letter initials:");
    if (input === null) {
      // User cancelled
      return null;
    }
    initials = input.toUpperCase().replace(/[^A-Z]/g, "").slice(0, 3);
    if (initials.length === 0) {
      alert("Please enter at least one letter.");
    }
  }
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
        // Only log important messages (not gameState which is sent frequently)
        if (data.type === "gameEnd") {
          console.log("[WebSocket] ===== GAME END MESSAGE RECEIVED IN ONMESSAGE =====", data);
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
  const hasJoined = myColorIndex !== null;
  const hasSelection = selectedChaserIndex !== null;
  
  elements.chaserButtons.forEach((btn) => {
    const indexStr = btn.dataset.index;
    if (indexStr === "start") return;
    
    const index = parseInt(indexStr, 10);
    if (isNaN(index)) return;
    
    const isAvailable = availableChasers.includes(index);
    const isJoined = myColorIndex === index;
    const isSelected = selectedChaserIndex === index;
    const isTakenByOthers = takenChasers.has(index);
    const playerName = playerNames.get(index);
    
    // Update button text
    btn.textContent = playerName ? `${index + 1}: ${playerName}` : `${index + 1}`;
    
    // Determine button state (optimized order: most restrictive first)
    btn.classList.remove("available", "taken", "selected");
    
    if (isJoined || hasJoined) {
      // Player has joined (this or another chaser) - disable all buttons
      btn.classList.add(isJoined ? "selected" : "taken");
      btn.disabled = true;
    } else if (isSelected) {
      // Player has selected this chaser but not yet joined
      btn.classList.add("selected");
      btn.disabled = false;
    } else if (isTakenByOthers || (hasSelection && !isAvailable)) {
      // Taken by others or unavailable when player has a selection
      btn.classList.add("taken");
      btn.disabled = true;
    } else if (isAvailable) {
      btn.classList.add("available");
      btn.disabled = false;
    } else {
      btn.classList.add("taken");
      btn.disabled = true;
    }
  });
}

function updateStartButton() {
  if (!elements.startBtn) return;
  
  // Simple logic: Always show "Play"
  // - Enabled if:
  //   - Player has selected a chaser (selectedChaserIndex !== null) AND
  //   - Player hasn't joined yet (myColorIndex === null)
  // - Disabled if:
  //   - Player hasn't selected a chaser
  //   - Player has already joined (myColorIndex !== null)
  
  elements.startBtn.textContent = "Play";
  
  if (selectedChaserIndex !== null && myColorIndex === null) {
    // Player has selected a chaser and hasn't joined yet - can click "Play" (even if game has started)
    elements.startBtn.disabled = false;
    elements.startBtn.classList.remove("disabled");
  } else {
    // Player hasn't selected a chaser OR player has already joined - disable button
    elements.startBtn.disabled = true;
    elements.startBtn.classList.add("disabled");
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

function selectChaser(colorIndex) {
  if (!availableChasers.includes(colorIndex)) return;
  if (selectedChaserIndex === colorIndex) return; // Already selected

  // Prompt for initials when selecting a chaser
  const initials = promptForInitials();
  if (!initials) return; // User cancelled

  selectedChaserIndex = colorIndex;
  selectedChaserName = initials;
  
  // Update playerNames immediately so button shows name right away
  playerNames.set(colorIndex, initials);
  
  // Send selection to server to broadcast to other players
  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify({
      type: "selectChaser",
      colorIndex: colorIndex,
      playerName: initials,
    }));
  }
  
  // Update UI to show selection with name immediately
  updateChaserButtons();
  updateStartButton();
}

function joinAsChaser() {
  if (!ws || ws.readyState !== WebSocket.OPEN) return;
  if (selectedChaserIndex === null) return;
  if (!availableChasers.includes(selectedChaserIndex)) return;

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
    colorIndex: selectedChaserIndex,
    playerName: selectedChaserName,
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
  elements.chaserButtons.forEach((btn) => {
    btn.addEventListener("click", () => {
      const indexStr = btn.dataset.index;
      if (indexStr === "start") {
        if (selectedChaserIndex !== null && myColorIndex === null && ws?.readyState === WebSocket.OPEN) {
          // Player has selected a chaser and hasn't joined yet - click "Play"
          if (!gameStarted) {
            // Game hasn't started - join and start the game
            pendingStartGame = true;
            joinAsChaser();
          } else {
            // Game has already started - just join
            joinAsChaser();
          }
        }
      } else {
        const index = parseInt(indexStr, 10);
        // Only allow selecting if all conditions are met
        if (!isNaN(index) && availableChasers.includes(index) && selectedChaserIndex !== index && myColorIndex === null && !takenChasers.has(index)) {
          selectChaser(index);
        }
      }
    });
  });

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

// Test function to verify alert works - can be called from console: testAlert()
window.testAlert = function() {
  console.log("[TEST] Testing alert function...");
  alert("Test alert - if you see this, alerts work!");
  console.log("[TEST] Alert was shown and dismissed");
};
