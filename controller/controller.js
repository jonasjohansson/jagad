const REMOTE_SERVER_ADDRESS = "https://pacman-server-239p.onrender.com";
const LOCAL_SERVER_ADDRESS = "http://localhost:3000";
const useLocalServer = window.location.hostname === "localhost" || window.location.hostname === "127.0.0.1";

function getServerAddress() {
  return useLocalServer ? LOCAL_SERVER_ADDRESS : REMOTE_SERVER_ADDRESS;
}

let ws = null;
let myPlayerId = null;
let myColorIndex = null;
let gameStarted = false;
let connectedPlayers = new Map();
let availableChasers = [0, 1, 2, 3];
let lastInputTime = 0;
const INPUT_THROTTLE = 50;
let currentDir = null;
let joystickActive = false;
let isFirstPlayer = false;

const joystickContainer = document.getElementById("joystick-container");
const joystickBase = document.getElementById("joystick-base");
const joystickHandle = document.getElementById("joystick-handle");
const chaserButtons = document.querySelectorAll(".chaser-btn[data-index]");
const startBtn = document.getElementById("start-btn");
const chaserSelect = document.getElementById("chaser-select");
const initialsInput = document.getElementById("initials-input");
const scoreDisplay = document.getElementById("score-display");
const scoreValue = document.getElementById("score-value");

function getInitials() {
  const initials = initialsInput.value.toUpperCase().replace(/[^A-Z]/g, "").slice(0, 3);
  return initials || "JGD";
}

function initWebSocket() {
  const serverAddress = getServerAddress();
  const wsUrl = serverAddress.replace("https://", "wss://").replace("http://", "ws://");

  try {
    ws = new WebSocket(wsUrl);

    ws.onopen = () => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: "gameState" }));
      }
    };

    ws.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        handleServerMessage(data);
      } catch (error) {
        console.error("Error parsing message:", error);
      }
    };

    ws.onerror = (error) => {
      console.error("WebSocket error:", error);
    };

    ws.onclose = () => {
      setTimeout(() => initWebSocket(), 3000);
    };
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
      updateChaserButtons();
      updateStartButton();
      updateInitialsInput();
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
        // Check if we're the first player (only one connected player)
        isFirstPlayer = playerCount === 1 && myPlayerId && connectedPlayers.has(myPlayerId);
        updateScoreDisplay();
      }
      if (data.availableColors && data.availableColors.chaser) {
        availableChasers = data.availableColors.chaser;
        updateChaserButtons();
      }
      updateStartButton();
      break;
    case "gameStarted":
      gameStarted = true;
      updateStartButton();
      updateInitialsInput();
      if (chaserSelect) {
        chaserSelect.classList.add("game-started");
      }
      break;
    case "gameRestarted":
      gameStarted = false;
      updateStartButton();
      updateInitialsInput();
      if (chaserSelect) {
        chaserSelect.classList.remove("game-started");
      }
      break;
    case "gameReset":
      gameStarted = false;
      myColorIndex = null;
      isFirstPlayer = false;
      updateChaserButtons();
      updateStartButton();
      updateInitialsInput();
      if (chaserSelect) {
        chaserSelect.classList.remove("game-started");
      }
      break;
  }
}

function updateChaserButtons() {
  chaserButtons.forEach((btn) => {
    const indexStr = btn.dataset.index;
    if (indexStr === "start") return; // Skip start button
    
    const index = parseInt(indexStr);
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
  if (!startBtn) return;
  
  if (isFirstPlayer && !gameStarted) {
    startBtn.textContent = "Start";
    startBtn.disabled = false;
    startBtn.classList.remove("disabled");
  } else {
    startBtn.textContent = "Select";
    startBtn.disabled = true;
    startBtn.classList.add("disabled");
  }
}

function startGame() {
  if (!ws || ws.readyState !== WebSocket.OPEN) return;
  if (!isFirstPlayer) return;
  
  ws.send(JSON.stringify({ type: "startGame" }));
}

function updateInitialsInput() {
  if (!initialsInput) return;
  
  // Lock the input if a chaser is selected and the game has started
  if (myColorIndex !== null && gameStarted) {
    initialsInput.disabled = true;
    initialsInput.readOnly = true;
  } else {
    initialsInput.disabled = false;
    initialsInput.readOnly = false;
  }
}

function joinAsChaser(colorIndex) {
  if (!ws || ws.readyState !== WebSocket.OPEN) {
    return;
  }

  if (!availableChasers.includes(colorIndex)) {
    return;
  }

  const initials = getInitials();
  ws.send(JSON.stringify({
    type: "join",
    characterType: "chaser",
    colorIndex: colorIndex,
    playerName: initials,
  }));
}

function sendInput(dir) {
  if (!ws || ws.readyState !== WebSocket.OPEN) {
    return;
  }

  if (!myPlayerId || myColorIndex === null) {
    return;
  }

  if (!gameStarted) {
    return;
  }

  const now = Date.now();
  if (now - lastInputTime < INPUT_THROTTLE) {
    return;
  }
  lastInputTime = now;

  // Update current direction
  currentDir = dir;
  
  ws.send(JSON.stringify({
    type: "input",
    input: { dir: dir }
  }));
}

function updateScoreDisplay() {
  let teamScore = 0;
  connectedPlayers.forEach((player) => {
    if ((player.type === "chaser" || player.type === "ghost") && player.stats) {
      teamScore = player.stats.chaserScore || 0;
    }
  });
  scoreValue.textContent = teamScore;
}

function resetJoystick() {
  joystickHandle.style.transform = "translate(-50%, -50%)";
  joystickHandle.classList.remove("active");
  currentDir = null;
  joystickActive = false;
}

function updateJoystick(x, y) {
  const rect = joystickBase.getBoundingClientRect();
  const centerX = rect.left + rect.width / 2;
  const centerY = rect.top + rect.height / 2;
  const deltaX = x - centerX;
  const deltaY = y - centerY;
  const threshold = 30;
  const maxDistance = Math.min(rect.width, rect.height) / 2 - 40;

  let dir = null;
  let moveX = 0;
  let moveY = 0;

  if (Math.abs(deltaX) > Math.abs(deltaY)) {
    if (deltaX > threshold) {
      dir = "right";
      moveX = Math.min(deltaX, maxDistance);
    } else if (deltaX < -threshold) {
      dir = "left";
      moveX = Math.max(deltaX, -maxDistance);
    }
  } else {
    if (deltaY > threshold) {
      dir = "down";
      moveY = Math.min(deltaY, maxDistance);
    } else if (deltaY < -threshold) {
      dir = "up";
      moveY = Math.max(deltaY, -maxDistance);
    }
  }

  if (dir) {
    joystickHandle.style.transform = `translate(calc(-50% + ${moveX}px), calc(-50% + ${moveY}px))`;
    joystickHandle.classList.add("active");
    currentDir = dir;
    sendInput(dir);
  } else {
    resetJoystick();
  }
}

chaserButtons.forEach((btn) => {
  btn.addEventListener("click", () => {
    const indexStr = btn.dataset.index;
    if (indexStr === "start") {
      startGame();
    } else {
      const index = parseInt(indexStr);
      if (!isNaN(index) && availableChasers.includes(index) && myColorIndex !== index) {
        joinAsChaser(index);
      }
    }
  });
});

initialsInput.addEventListener("input", (e) => {
  const value = e.target.value.toUpperCase().replace(/[^A-Z]/g, "").slice(0, 3);
  e.target.value = value;
});

// WASD keyboard support
const keys = {};

function updateJoystickFromKey(dir) {
  if (!dir) {
    resetJoystick();
    return;
  }
  
  const rect = joystickBase.getBoundingClientRect();
  const maxDistance = Math.min(rect.width, rect.height) / 2 - 40;
  let moveX = 0;
  let moveY = 0;
  
  if (dir === "left") moveX = -maxDistance;
  else if (dir === "right") moveX = maxDistance;
  else if (dir === "up") moveY = -maxDistance;
  else if (dir === "down") moveY = maxDistance;
  
  joystickHandle.style.transform = `translate(calc(-50% + ${moveX}px), calc(-50% + ${moveY}px))`;
  joystickHandle.classList.add("active");
  currentDir = dir;
}

function handleKeyDown(e) {
  // If the initials input is focused, allow typing WASD normally
  if (document.activeElement === initialsInput) {
    return;
  }
  
  const key = e.key.toLowerCase();
  let dir = null;
  
  if (key === "a") dir = "left";
  else if (key === "d") dir = "right";
  else if (key === "w") dir = "up";
  else if (key === "s") dir = "down";
  
  if (dir) {
    e.preventDefault();
    e.stopPropagation();
    keys[key] = true;
    updateJoystickFromKey(dir);
    sendInput(dir);
  }
}

function handleKeyUp(e) {
  // If the initials input is focused, allow typing WASD normally
  if (document.activeElement === initialsInput) {
    return;
  }
  
  const key = e.key.toLowerCase();
  if (key === "a" || key === "d" || key === "w" || key === "s") {
    e.preventDefault();
    e.stopPropagation();
    keys[key] = false;
    
    // Check if any key is still pressed
    let dir = null;
    if (keys["w"]) dir = "up";
    else if (keys["s"]) dir = "down";
    else if (keys["a"]) dir = "left";
    else if (keys["d"]) dir = "right";
    
    if (dir) {
      updateJoystickFromKey(dir);
    } else {
      resetJoystick();
    }
  }
}

document.addEventListener("keydown", handleKeyDown, true);
document.addEventListener("keyup", handleKeyUp, true);

// Send input continuously while key is held
setInterval(() => {
  if (!gameStarted || !myPlayerId || myColorIndex === null) return;
  
  let dir = null;
  if (keys["w"]) dir = "up";
  else if (keys["s"]) dir = "down";
  else if (keys["a"]) dir = "left";
  else if (keys["d"]) dir = "right";
  
  if (dir) {
    sendInput(dir);
  }
}, INPUT_THROTTLE);

let activeTouch = null;

joystickBase.addEventListener("touchstart", (e) => {
  e.preventDefault();
  if (e.touches.length > 0) {
    activeTouch = e.touches[0].identifier;
    const touch = e.touches[0];
    joystickActive = true;
    updateJoystick(touch.clientX, touch.clientY);
  }
});

joystickBase.addEventListener("touchmove", (e) => {
  e.preventDefault();
  if (activeTouch !== null) {
    const touch = Array.from(e.touches).find(t => t.identifier === activeTouch);
    if (touch) {
      updateJoystick(touch.clientX, touch.clientY);
      // Send input continuously while dragging
      const rect = joystickBase.getBoundingClientRect();
      const centerX = rect.left + rect.width / 2;
      const centerY = rect.top + rect.height / 2;
      const deltaX = touch.clientX - centerX;
      const deltaY = touch.clientY - centerY;
      const threshold = 30;
      let dir = null;
      if (Math.abs(deltaX) > Math.abs(deltaY)) {
        if (deltaX > threshold) dir = "right";
        else if (deltaX < -threshold) dir = "left";
      } else {
        if (deltaY > threshold) dir = "down";
        else if (deltaY < -threshold) dir = "up";
      }
      if (dir) {
        const now = Date.now();
        if (now - lastInputTime >= INPUT_THROTTLE) {
          sendInput(dir);
        }
      }
    }
  }
});

joystickBase.addEventListener("touchend", (e) => {
  e.preventDefault();
  if (activeTouch !== null) {
    const touch = Array.from(e.changedTouches).find(t => t.identifier === activeTouch);
    if (touch) {
      resetJoystick();
      activeTouch = null;
    }
  }
});

joystickBase.addEventListener("touchcancel", (e) => {
  e.preventDefault();
  resetJoystick();
  activeTouch = null;
});

joystickBase.addEventListener("mousedown", (e) => {
  e.preventDefault();
  joystickActive = true;
  updateJoystick(e.clientX, e.clientY);
});

document.addEventListener("mousemove", (e) => {
  if (joystickActive) {
    updateJoystick(e.clientX, e.clientY);
    // Send input continuously while dragging
    const rect = joystickBase.getBoundingClientRect();
    const centerX = rect.left + rect.width / 2;
    const centerY = rect.top + rect.height / 2;
    const deltaX = e.clientX - centerX;
    const deltaY = e.clientY - centerY;
    const threshold = 30;
    let dir = null;
    if (Math.abs(deltaX) > Math.abs(deltaY)) {
      if (deltaX > threshold) dir = "right";
      else if (deltaX < -threshold) dir = "left";
    } else {
      if (deltaY > threshold) dir = "down";
      else if (deltaY < -threshold) dir = "up";
    }
    if (dir && currentDir === dir) {
      // Send input periodically while holding same direction
      const now = Date.now();
      if (now - lastInputTime >= INPUT_THROTTLE) {
        sendInput(dir);
      }
    }
  }
});

document.addEventListener("mouseup", (e) => {
  if (joystickActive) {
    resetJoystick();
    joystickActive = false;
  }
});

document.addEventListener("contextmenu", (e) => e.preventDefault());

// Initialize UI
updateStartButton();
updateInitialsInput();

initWebSocket();
