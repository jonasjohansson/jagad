// Admin page JavaScript
const REMOTE_SERVER_ADDRESS = "https://pacman-server-239p.onrender.com";
const LOCAL_SERVER_ADDRESS = "http://localhost:3000";

// Get server address from URL parameter or default
function getServerFromURL() {
  const params = new URLSearchParams(window.location.search);
  const serverParam = params.get("server");
  
  if (serverParam) {
    if (serverParam === "local") {
      return LOCAL_SERVER_ADDRESS;
    } else if (serverParam === "remote") {
      return REMOTE_SERVER_ADDRESS;
    } else {
      // Assume it's a full URL
      return serverParam;
    }
  }
  
  return REMOTE_SERVER_ADDRESS; // Default to remote
}

let ws = null;
let gameStarted = false;

// Initialize WebSocket connection
function initWebSocket() {
  const serverAddress = getServerFromURL();
  const wsProtocol = serverAddress.startsWith("https") ? "wss" : "ws";
  const wsUrl = serverAddress.replace(/^https?:\/\//, "").replace(/^http:\/\//, "");
  const wsAddress = `${wsProtocol}://${wsUrl}`;
  
  console.log("[Admin] Connecting to:", wsAddress);
  
  ws = new WebSocket(wsAddress);
  
  ws.onopen = () => {
    console.log("[Admin] WebSocket connected");
    // Request current game state
    ws.send(JSON.stringify({ type: "gameState" }));
  };
  
  ws.onmessage = (event) => {
    try {
      const data = JSON.parse(event.data);
      handleServerMessage(data);
    } catch (error) {
      console.error("[Admin] Error parsing message:", error);
    }
  };
  
  ws.onerror = (error) => {
    console.error("[Admin] WebSocket error:", error);
  };
  
  ws.onclose = () => {
    console.log("[Admin] WebSocket closed, reconnecting...");
    setTimeout(initWebSocket, 3000);
  };
}

function handleServerMessage(data) {
  switch (data.type) {
    case "gameState":
      if (data.gameStarted !== undefined) {
        gameStarted = data.gameStarted;
        updateButtonStates();
      }
      break;
    case "gameStarted":
      gameStarted = true;
      updateButtonStates();
      break;
    case "gameReset":
    case "gameEnd":
      gameStarted = false;
      updateButtonStates();
      break;
    default:
      break;
  }
}

// Cache DOM elements
let cachedElements = null;

function getCachedElements() {
  if (!cachedElements) {
    cachedElements = {
      startBtn: document.getElementById("start-game-btn"),
      endBtn: document.getElementById("end-game-btn"),
      resetBtn: document.getElementById("reset-game-btn"),
      aiSkillInput: document.getElementById("ai-skill"),
      aiSkillValue: document.getElementById("ai-skill-value"),
      fugitiveSpeedInput: document.getElementById("fugitive-speed"),
      fugitiveSpeedValue: document.getElementById("fugitive-speed-value"),
      chaserSpeedInput: document.getElementById("chaser-speed"),
      chaserSpeedValue: document.getElementById("chaser-speed-value"),
      gameDurationInput: document.getElementById("game-duration"),
      gameDurationValue: document.getElementById("game-duration-value"),
    };
  }
  return cachedElements;
}

function updateButtonStates() {
  const elements = getCachedElements();
  
  if (gameStarted) {
    elements.startBtn.disabled = true;
    elements.endBtn.disabled = false;
    elements.resetBtn.disabled = true;
  } else {
    elements.startBtn.disabled = false;
    elements.endBtn.disabled = true;
    elements.resetBtn.disabled = false;
  }
}

// Game control functions
function startGame() {
  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify({ type: "startGame" }));
  }
}

function endGame() {
  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify({ type: "endGame" }));
  }
}

function resetGame() {
  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify({ type: "restartGame" }));
  }
}

// Settings functions
function sendAIDifficulty(value) {
  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify({ type: "setAIDifficulty", difficulty: value }));
  }
}

function sendSpeedConfig(fugitiveSpeed, chaserSpeed) {
  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify({
      type: "setSpeeds",
      fugitiveSpeed,
      chaserSpeed,
    }));
  }
}

function sendGameDuration(duration) {
  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify({ type: "setGameDuration", duration }));
  }
}

// 2D/3D, Style, and Building settings are now handled in /game/ via lil-gui

// Initialize event listeners
document.addEventListener("DOMContentLoaded", () => {
  const elements = getCachedElements();
  
  // Game control buttons
  elements.startBtn.addEventListener("click", startGame);
  elements.endBtn.addEventListener("click", endGame);
  elements.resetBtn.addEventListener("click", resetGame);
  
  // Game settings
  elements.aiSkillInput.addEventListener("input", (e) => {
    const value = parseFloat(e.target.value);
    elements.aiSkillValue.textContent = value.toFixed(1);
    sendAIDifficulty(value);
  });
  
  elements.fugitiveSpeedInput.addEventListener("input", (e) => {
    const value = parseFloat(e.target.value);
    elements.fugitiveSpeedValue.textContent = value.toFixed(2);
    sendSpeedConfig(value, parseFloat(elements.chaserSpeedInput.value));
  });
  
  elements.chaserSpeedInput.addEventListener("input", (e) => {
    const value = parseFloat(e.target.value);
    elements.chaserSpeedValue.textContent = value.toFixed(2);
    sendSpeedConfig(parseFloat(elements.fugitiveSpeedInput.value), value);
  });
  
  elements.gameDurationInput.addEventListener("input", (e) => {
    const value = parseInt(e.target.value);
    elements.gameDurationValue.textContent = value;
    sendGameDuration(value);
  });
  
  // Initialize WebSocket
  initWebSocket();
  
  // Initial button states
  updateButtonStates();
});
