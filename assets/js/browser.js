// Browser view - local single-player game
import { initLocalGame, initLocalCharacters, sendLocalInput, getLocalGameState } from "./game.js";
import { initDpad } from "./dpad.js";

// Local game state
let gameStarted = false;
let playerName = null;
let renderLoopId = null;

function init3DView() {
  const canvas = document.getElementById("webgl-canvas");
  const buildingRealImage = document.getElementById("building-real-image");

  // Show 3D canvas
  if (canvas && canvas.style) canvas.style.display = "block";
  // Keep building real image visible
  if (buildingRealImage && buildingRealImage.style) buildingRealImage.style.display = "block";

  // Initialize 3D if not already initialized
  if (window.render3D && !window.render3D.initialized) {
    console.log("[browser] Initializing 3D renderer...");
    window.render3D.init();
    window.render3D.initialized = true;
    console.log("[browser] 3D renderer initialized");
    
    // Force resize to ensure correct canvas dimensions
    setTimeout(() => {
      if (window.render3D && window.render3D.onResize) {
        window.render3D.onResize();
      }
    }, 100);
  }
}

function startRenderLoop() {
  console.log("[browser] Starting render loop...");
  function renderLoop() {
    if (window.render3D && window.render3D.render) {
      window.render3D.render();
    } else {
      console.warn("[browser] Render3D not available:", !!window.render3D, !!window.render3D?.render);
    }
    renderLoopId = requestAnimationFrame(renderLoop);
  }
  renderLoop();
}

// Initialize browser view
function initBrowser() {
  console.log("[browser] Initializing local browser view...");

  // Initialize 3D view
  init3DView();

  // Wait for 3D rendering to be ready
  const check3DReady = setInterval(() => {
    if (window.render3D && window.render3D.initialized) {
      clearInterval(check3DReady);
      console.log("[browser] 3D rendering ready");
      
      // Force resize to ensure correct dimensions after layout
      setTimeout(() => {
        if (window.render3D && window.render3D.onResize) {
          window.render3D.onResize();
        }
        // Fit the level to the available canvas space
        fitLevelToCanvas();
      }, 200);
      
      // Start render loop
      startRenderLoop();
      
      // Initialize characters and make them visible (before game starts)
      setTimeout(() => {
        initLocalCharacters();
      }, 300);
      
      // Initialize controller
      initLocalController();

      // Initialize game UI
      initGameUI();
    }
  }, 100);

  // Timeout after 5 seconds
  setTimeout(() => {
    clearInterval(check3DReady);
    if (!window.render3D || !window.render3D.initialized) {
      console.error("[browser] 3D rendering failed to initialize");
      // Still initialize other components
      initLocalController();
      initGameUI();
    }
  }, 5000);
}

// Fit level width to canvas, leaving space for overlay
function fitLevelToCanvas() {
  if (!window.render3D || !window.render3D.setCameraZoom || !window.PACMAN_MAP) return;
  const canvas = document.getElementById("webgl-canvas");
  if (!canvas) return;

  const container = canvas.parentElement;
  const containerWidth = container ? container.clientWidth : window.innerWidth;
  const containerHeight = container ? container.clientHeight : window.innerHeight;
  if (!containerWidth || !containerHeight) return;

  const levelWidth = window.PACMAN_MAP.COLS * 20;
  const levelHeight = window.PACMAN_MAP.ROWS * 20;
  const aspect = containerWidth / containerHeight;

  // baseViewSize mirrors 3d.js: max(levelWidth, levelHeight)
  const baseViewSize = Math.max(levelWidth, levelHeight);
  // We want the visible width to be roughly levelWidth + small margin
  const desiredWidth = levelWidth + 80; // margin for overlay breathing room
  const zoom = desiredWidth / (baseViewSize * aspect);

  // Clamp zoom to reasonable range
  const clamped = Math.min(Math.max(zoom, 0.6), 1.3);
  window.render3D.setCameraZoom(clamped);
  console.log("[browser] Fit zoom", clamped.toFixed(3), "aspect", aspect.toFixed(2));
}

function initLocalController() {
  const startBtn = document.getElementById("start-btn");
  const scoreValue = document.getElementById("score-value");
  const joystickBase = document.getElementById("joystick-base");
  const joystickHandle = document.getElementById("joystick-handle");

  // Update score display
  window.updateLocalScore = (score) => {
    if (scoreValue) {
      scoreValue.textContent = score;
    }
  };

  // Start game button
  if (startBtn) {
    startBtn.addEventListener("click", () => {
      if (gameStarted) return;

      // Get player name
      const name = prompt("Enter your 3-letter initials:");
      if (!name || name.trim().length === 0) return;

      playerName = name.trim().toUpperCase().slice(0, 3);
      gameStarted = true;
      startBtn.disabled = true;
      startBtn.textContent = "Playing...";
      startBtn.classList.add("disabled");

    // Welcome message removed - no longer in HTML

      // Enable joystick
      const joystickContainer = document.getElementById("joystick-container");
      if (joystickContainer) {
        joystickContainer.classList.remove("disabled");
      }

      // Initialize and start local game (with small delay to ensure 3D is ready)
      console.log("[browser] Starting local game...");
      setTimeout(() => {
        console.log("[browser] Calling initLocalGame...");
        initLocalGame();
      }, 100);
    });
  }

  // Initialize joystick
  if (joystickBase && joystickHandle) {
    initDpad("joystick-base", "joystick-handle", (dir) => {
      if (gameStarted && dir) {
        sendLocalInput(dir);
      }
    });
  }
}

function initGameUI() {
  // Set up game end handler
  window.onLocalGameEnd = async (gameResult) => {
    gameStarted = false;
    
    const startBtn = document.getElementById("start-btn");
    const joystickContainer = document.getElementById("joystick-container");

    if (startBtn) {
      startBtn.disabled = false;
      startBtn.textContent = "Play Again";
      startBtn.classList.remove("disabled");
    }

    if (joystickContainer) {
      joystickContainer.classList.add("disabled");
    }

    // Show game over message
    let message = "";
    if (gameResult.allCaught) {
      message = `🎮 GAME OVER - ALL FUGITIVES CAUGHT!\n\n` +
                `Your Score: ${gameResult.score.toLocaleString()}\n` +
                `Time: ${(gameResult.gameTime / 1000).toFixed(1)}s\n` +
                `Fugitives Caught: ${gameResult.fugitivesCaught}/${gameResult.totalFugitives}\n\n` +
                `Great job!`;
    } else {
      message = `🎮 GAME OVER - TIME'S UP!\n\n` +
                `Your Score: ${gameResult.score.toLocaleString()}\n` +
                `Time: ${(gameResult.gameTime / 1000).toFixed(1)}s\n` +
                `Fugitives Caught: ${gameResult.fugitivesCaught}/${gameResult.totalFugitives}`;
    }

    alert(message);

    // Submit score to server
    await submitScore(gameResult.score, playerName, false);
  };
}

async function submitScore(score, playerName, isTeamGame) {
  try {
    // Get server address (use same logic as highscore)
    const params = new URLSearchParams(window.location.search);
    const serverParam = params.get("server");
    
    const LOCAL_SERVER_ADDRESS = "http://localhost:3000";
    const REMOTE_SERVER_ADDRESS = "https://pacman-server-239p.onrender.com";
    
    let serverAddress = REMOTE_SERVER_ADDRESS;
    if (serverParam) {
      if (serverParam.startsWith("http://") || serverParam.startsWith("https://")) {
        serverAddress = serverParam;
      } else if (serverParam.toLowerCase() === "local" || serverParam.toLowerCase() === "localhost") {
        serverAddress = LOCAL_SERVER_ADDRESS;
      }
    } else if (window.location.origin === "http://localhost" || window.location.origin.startsWith("http://localhost:")) {
      serverAddress = LOCAL_SERVER_ADDRESS;
    }

    const response = await fetch(`${serverAddress}/api/highscore`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        score: score,
        playerName: playerName || "LOC",
        isTeamGame: isTeamGame,
      }),
    });

    if (response.ok) {
      console.log("[browser] Score submitted successfully");
    } else {
      console.error("[browser] Failed to submit score:", response.status);
    }
  } catch (error) {
    console.error("[browser] Error submitting score:", error);
  }
}

// Wait for DOM to be ready
if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", initBrowser);
} else {
  // DOM is already ready
  initBrowser();
}
