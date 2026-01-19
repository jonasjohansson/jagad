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

function updateButtonStates() {
  const startBtn = document.getElementById("start-game-btn");
  const endBtn = document.getElementById("end-game-btn");
  const resetBtn = document.getElementById("reset-game-btn");
  
  if (gameStarted) {
    startBtn.disabled = true;
    endBtn.disabled = false;
    resetBtn.disabled = true;
  } else {
    startBtn.disabled = false;
    endBtn.disabled = true;
    resetBtn.disabled = false;
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
      pacmanSpeed: fugitiveSpeed,
      ghostSpeed: chaserSpeed,
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
  // Game control buttons
  document.getElementById("start-game-btn").addEventListener("click", startGame);
  document.getElementById("end-game-btn").addEventListener("click", endGame);
  document.getElementById("reset-game-btn").addEventListener("click", resetGame);
  
  // Game settings
  const aiSkillInput = document.getElementById("ai-skill");
  const aiSkillValue = document.getElementById("ai-skill-value");
  aiSkillInput.addEventListener("input", (e) => {
    const value = parseFloat(e.target.value);
    aiSkillValue.textContent = value.toFixed(1);
    sendAIDifficulty(value);
  });
  
  const fugitiveSpeedInput = document.getElementById("fugitive-speed");
  const fugitiveSpeedValue = document.getElementById("fugitive-speed-value");
  fugitiveSpeedInput.addEventListener("input", (e) => {
    const value = parseFloat(e.target.value);
    fugitiveSpeedValue.textContent = value.toFixed(2);
    sendSpeedConfig(value, parseFloat(document.getElementById("chaser-speed").value));
  });
  
  const chaserSpeedInput = document.getElementById("chaser-speed");
  const chaserSpeedValue = document.getElementById("chaser-speed-value");
  chaserSpeedInput.addEventListener("input", (e) => {
    const value = parseFloat(e.target.value);
    chaserSpeedValue.textContent = value.toFixed(2);
    sendSpeedConfig(parseFloat(document.getElementById("fugitive-speed").value), value);
  });
  
  const gameDurationInput = document.getElementById("game-duration");
  const gameDurationValue = document.getElementById("game-duration-value");
  gameDurationInput.addEventListener("input", (e) => {
    const value = parseInt(e.target.value);
    gameDurationValue.textContent = value;
    sendGameDuration(value);
  });
  
  // Initialize WebSocket
  initWebSocket();
  
  // Initial button states
  updateButtonStates();
});
