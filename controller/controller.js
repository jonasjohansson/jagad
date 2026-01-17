// Constants
const REMOTE_SERVER_ADDRESS = "https://pacman-server-239p.onrender.com";
const LOCAL_SERVER_ADDRESS = "http://localhost:3000";
const INPUT_THROTTLE = 50;
const JOYSTICK_THRESHOLD = 30;
const JOYSTICK_OFFSET = 40;

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

// Key to direction mapping
const KEY_TO_DIR = {
  w: "up",
  s: "down",
  a: "left",
  d: "right"
};

// State
let ws = null;
let myPlayerId = null;
let myColorIndex = null;
let gameStarted = false;
let connectedPlayers = new Map();
let availableChasers = [0, 1, 2, 3];
let lastInputTime = 0;
let currentDir = null;
let joystickActive = false;
let isFirstPlayer = false;
let activeTouch = null;
const keys = {};

// DOM elements (cached) - initialized after DOM is ready
let elements = {};

// Utility functions
function getServerAddress() {
  return getServerFromURL();
}

function getInitials() {
  const initials = elements.initialsInput.value.toUpperCase().replace(/[^A-Z]/g, "").slice(0, 3);
  return initials || "JGD";
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
  if (!ws || ws.readyState !== WebSocket.OPEN) return;
  if (!myPlayerId || myColorIndex === null || !gameStarted) return;

  const now = Date.now();
  if (now - lastInputTime < INPUT_THROTTLE) return;
  
  lastInputTime = now;
  currentDir = dir;
  
  ws.send(JSON.stringify({ type: "input", input: { dir } }));
}

// WebSocket
function initWebSocket() {
  const wsUrl = getServerAddress().replace(/^https?:/, (m) => m === "https:" ? "wss:" : "ws:");

  try {
    ws = new WebSocket(wsUrl);

    ws.onopen = () => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: "gameState" }));
      }
    };

    ws.onmessage = (event) => {
      try {
        handleServerMessage(JSON.parse(event.data));
      } catch (error) {
        console.error("Error parsing message:", error);
      }
    };

    ws.onerror = (error) => console.error("WebSocket error:", error);
    ws.onclose = () => setTimeout(initWebSocket, 3000);
  } catch (error) {
    console.error("Error connecting:", error);
  }
}

function handleServerMessage(data) {
  switch (data.type) {
    case "connected":
      myPlayerId = data.playerId;
      break;
    case "joined":
      myColorIndex = data.colorIndex;
      updateUI();
      break;
    case "gameState":
      if (data.players) {
        connectedPlayers.clear();
        let playerCount = 0;
        data.players.forEach((player) => {
          if (player.connected) {
            playerCount++;
            connectedPlayers.set(player.playerId, {
              type: player.type,
              colorIndex: player.colorIndex,
              stats: player.stats || null,
            });
          }
        });
        isFirstPlayer = playerCount === 1 && myPlayerId && connectedPlayers.has(myPlayerId);
        updateScoreDisplay();
      }
      if (data.availableColors?.chaser) {
        availableChasers = data.availableColors.chaser;
        updateChaserButtons();
      }
      updateStartButton();
      break;
    case "gameStarted":
      gameStarted = true;
      updateUI();
      elements.chaserSelect?.classList.add("game-started");
      break;
    case "gameRestarted":
      gameStarted = false;
      updateUI();
      elements.chaserSelect?.classList.remove("game-started");
      break;
    case "gameEnd":
      // Game ended - show alert with score
      if (myColorIndex !== null) {
        const timeSeconds = (data.gameTime / 1000).toFixed(1);
        const message = data.allCaught
          ? `All Fugitives Caught!\n\nTime: ${timeSeconds}s\nTotal Score: ${data.score}\nFugitives Caught: ${data.fugitivesCaught}/${data.totalFugitives}`
          : `Time's Up!\n\nTime: ${timeSeconds}s\nTotal Score: ${data.score}\nFugitives Caught: ${data.fugitivesCaught}/${data.totalFugitives}`;
        alert(message);
        // Reload page after alert
        setTimeout(() => {
          window.location.reload();
        }, 100);
      }
      break;
    case "gameReset":
      gameStarted = false;
      myColorIndex = null;
      isFirstPlayer = false;
      updateChaserButtons();
      updateUI();
      elements.chaserSelect?.classList.remove("game-started");
      break;
  }
}

// UI Updates
function updateUI() {
  updateStartButton();
  updateInitialsInput();
}

function updateChaserButtons() {
  elements.chaserButtons.forEach((btn) => {
    const indexStr = btn.dataset.index;
    if (indexStr === "start") return;
    
    const index = parseInt(indexStr, 10);
    if (isNaN(index)) return;
    
    const isAvailable = availableChasers.includes(index);
    const isSelected = myColorIndex === index;
    
    btn.classList.remove("available", "taken", "selected");
    
    if (isSelected) {
      btn.classList.add("selected");
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
  
  // Check if there are available chasers
  const hasAvailableChasers = availableChasers.length > 0;
  
  if (isFirstPlayer && !gameStarted) {
    // First player can start the game
    elements.startBtn.textContent = "Start";
    elements.startBtn.disabled = false;
    elements.startBtn.classList.remove("disabled");
  } else if (gameStarted && hasAvailableChasers && myColorIndex === null) {
    // Game is active and there are free spots - show "Join"
    elements.startBtn.textContent = "Join";
    elements.startBtn.disabled = false;
    elements.startBtn.classList.remove("disabled");
  } else {
    // Default: show "Select" when game hasn't started and not first player
    elements.startBtn.textContent = "Select";
    elements.startBtn.disabled = !hasAvailableChasers || myColorIndex !== null;
    elements.startBtn.classList.toggle("disabled", !hasAvailableChasers || myColorIndex !== null);
  }
}

function updateInitialsInput() {
  if (!elements.initialsInput) return;
  
  const isLocked = myColorIndex !== null && gameStarted;
  elements.initialsInput.disabled = isLocked;
  elements.initialsInput.readOnly = isLocked;
}

function updateScoreDisplay() {
  let teamScore = 0;
  for (const player of connectedPlayers.values()) {
    if ((player.type === "chaser" || player.type === "ghost") && player.stats?.chaserScore) {
      teamScore = player.stats.chaserScore;
      break;
    }
  }
  if (elements.scoreValue) {
    elements.scoreValue.textContent = teamScore;
  }
}

function joinAsChaser(colorIndex) {
  if (!ws || ws.readyState !== WebSocket.OPEN) return;
  if (!availableChasers.includes(colorIndex)) return;

  ws.send(JSON.stringify({
    type: "join",
    characterType: "chaser",
    colorIndex,
    playerName: getInitials(),
  }));
}

// Joystick
function resetJoystick() {
  elements.joystickHandle.style.transform = "translate(-50%, -50%)";
  elements.joystickHandle.classList.remove("active");
  currentDir = null;
  joystickActive = false;
}

function updateJoystick(x, y) {
  const center = getJoystickCenter();
  const deltaX = x - center.x;
  const deltaY = y - center.y;
  const dir = calculateDirection(deltaX, deltaY);

  if (dir) {
    const moveX = Math.max(-center.maxDistance, Math.min(center.maxDistance, deltaX));
    const moveY = Math.max(-center.maxDistance, Math.min(center.maxDistance, deltaY));
    elements.joystickHandle.style.transform = `translate(calc(-50% + ${moveX}px), calc(-50% + ${moveY}px))`;
    elements.joystickHandle.classList.add("active");
    currentDir = dir;
    sendInput(dir);
  } else {
    resetJoystick();
  }
}

function updateJoystickFromKey(dir) {
  if (!dir) {
    resetJoystick();
    return;
  }
  
  const center = getJoystickCenter();
  const moveX = dir === "left" ? -center.maxDistance : dir === "right" ? center.maxDistance : 0;
  const moveY = dir === "up" ? -center.maxDistance : dir === "down" ? center.maxDistance : 0;
  
  elements.joystickHandle.style.transform = `translate(calc(-50% + ${moveX}px), calc(-50% + ${moveY}px))`;
  elements.joystickHandle.classList.add("active");
  currentDir = dir;
}

// Input handlers
function handleKeyDown(e) {
  if (document.activeElement === elements.initialsInput) return;
  
  const dir = KEY_TO_DIR[e.key.toLowerCase()];
  if (!dir) return;
  
  e.preventDefault();
  e.stopPropagation();
  keys[e.key.toLowerCase()] = true;
  updateJoystickFromKey(dir);
  sendInput(dir);
}

function handleKeyUp(e) {
  if (document.activeElement === elements.initialsInput) return;
  
  const key = e.key.toLowerCase();
  if (!KEY_TO_DIR[key]) return;
  
  e.preventDefault();
  e.stopPropagation();
  keys[key] = false;
  
  // Find next active direction
  const dir = Object.entries(keys).find(([k, pressed]) => pressed && KEY_TO_DIR[k])?.[0];
  if (dir) {
    updateJoystickFromKey(KEY_TO_DIR[dir]);
  } else {
    resetJoystick();
  }
}

function handleTouchStart(e) {
  e.preventDefault();
  if (e.touches.length > 0) {
    activeTouch = e.touches[0].identifier;
    const touch = e.touches[0];
    joystickActive = true;
    updateJoystick(touch.clientX, touch.clientY);
  }
}

function handleTouchMove(e) {
  e.preventDefault();
  if (activeTouch === null) return;
  
  const touch = Array.from(e.touches).find(t => t.identifier === activeTouch);
  if (!touch) return;
  
  updateJoystick(touch.clientX, touch.clientY);
  
  // Send input continuously while dragging
  const center = getJoystickCenter();
  const dir = calculateDirection(touch.clientX - center.x, touch.clientY - center.y);
  if (dir) {
    const now = Date.now();
    if (now - lastInputTime >= INPUT_THROTTLE) {
      sendInput(dir);
    }
  }
}

function handleTouchEnd(e) {
  e.preventDefault();
  if (activeTouch !== null) {
    const touch = Array.from(e.changedTouches).find(t => t.identifier === activeTouch);
    if (touch) {
      resetJoystick();
      activeTouch = null;
    }
  }
}

function handleTouchCancel(e) {
  e.preventDefault();
  resetJoystick();
  activeTouch = null;
}

function handleMouseDown(e) {
  e.preventDefault();
  joystickActive = true;
  updateJoystick(e.clientX, e.clientY);
}

function handleMouseMove(e) {
  if (!joystickActive) return;
  
  updateJoystick(e.clientX, e.clientY);
  
  // Send input continuously while dragging
  const center = getJoystickCenter();
  const dir = calculateDirection(e.clientX - center.x, e.clientY - center.y);
  if (dir && currentDir === dir) {
    const now = Date.now();
    if (now - lastInputTime >= INPUT_THROTTLE) {
      sendInput(dir);
    }
  }
}

function handleMouseUp(e) {
  if (joystickActive) {
    resetJoystick();
    joystickActive = false;
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
    initialsInput: document.getElementById("initials-input"),
    scoreValue: document.getElementById("score-value")
  };
}

// Initialize event listeners
function initEventListeners() {
  if (!elements.joystickBase) return;

  elements.chaserButtons.forEach((btn) => {
    btn.addEventListener("click", () => {
      const indexStr = btn.dataset.index;
      if (indexStr === "start") {
        if (isFirstPlayer && !gameStarted && ws?.readyState === WebSocket.OPEN) {
          // First player starts the game
          ws.send(JSON.stringify({ type: "startGame" }));
        } else if (gameStarted && availableChasers.length > 0 && myColorIndex === null && ws?.readyState === WebSocket.OPEN) {
          // Join as first available chaser when game is active
          const firstAvailable = availableChasers[0];
          joinAsChaser(firstAvailable);
        } else if (!gameStarted && availableChasers.length > 0 && myColorIndex === null && ws?.readyState === WebSocket.OPEN) {
          // Select first available chaser when game hasn't started
          const firstAvailable = availableChasers[0];
          joinAsChaser(firstAvailable);
        }
      } else {
        const index = parseInt(indexStr, 10);
        if (!isNaN(index) && availableChasers.includes(index) && myColorIndex !== index) {
          joinAsChaser(index);
        }
      }
    });
  });

  if (elements.initialsInput) {
    elements.initialsInput.addEventListener("input", (e) => {
      e.target.value = e.target.value.toUpperCase().replace(/[^A-Z]/g, "").slice(0, 3);
    });
  }

  document.addEventListener("keydown", handleKeyDown, true);
  document.addEventListener("keyup", handleKeyUp, true);

  // Continuous input while key is held
  setInterval(() => {
    if (!gameStarted || !myPlayerId || myColorIndex === null) return;
    
    const activeKey = Object.entries(keys).find(([k, pressed]) => pressed && KEY_TO_DIR[k])?.[0];
    if (activeKey) {
      sendInput(KEY_TO_DIR[activeKey]);
    }
  }, INPUT_THROTTLE);

  elements.joystickBase.addEventListener("touchstart", handleTouchStart);
  elements.joystickBase.addEventListener("touchmove", handleTouchMove);
  elements.joystickBase.addEventListener("touchend", handleTouchEnd);
  elements.joystickBase.addEventListener("touchcancel", handleTouchCancel);
  elements.joystickBase.addEventListener("mousedown", handleMouseDown);
  document.addEventListener("mousemove", handleMouseMove);
  document.addEventListener("mouseup", handleMouseUp);
  document.addEventListener("contextmenu", (e) => e.preventDefault());
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
