// Browser view - local single-player game
import { initLocalGame, initLocalCharacters, sendLocalInput, getLocalGameState } from "./game.js";

// Local game state
let gameStarted = false;
let playerName = null;
let renderLoopId = null;
let swipeStartX = null;
let swipeStartY = null;
const SWIPE_THRESHOLD = 30; // pixels

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

// Initialize keyboard controls (WASD)
function initKeyboardControls() {
  console.log("[browser] Initializing keyboard controls...");
  
  const keyMap = {
    'w': 'up',
    'a': 'left',
    's': 'down',
    'd': 'right',
    'W': 'up',
    'A': 'left',
    'S': 'down',
    'D': 'right',
    'ArrowUp': 'up',
    'ArrowLeft': 'left',
    'ArrowDown': 'down',
    'ArrowRight': 'right'
  };

  let keysPressed = new Set();

  document.addEventListener('keydown', (e) => {
    if (!gameStarted) return;
    
    const dir = keyMap[e.key];
    if (dir && !keysPressed.has(e.key)) {
      keysPressed.add(e.key);
      console.log("[browser] Key pressed:", e.key, "-> direction:", dir);
      sendLocalInput(dir);
    }
  });

  document.addEventListener('keyup', (e) => {
    keysPressed.delete(e.key);
  });
}

// Initialize swipe controls on the game canvas
function initSwipeControls(canvas) {
  console.log("[browser] Initializing swipe controls...");

  const getDirectionFromDelta = (dx, dy) => {
    if (Math.abs(dx) < SWIPE_THRESHOLD && Math.abs(dy) < SWIPE_THRESHOLD) {
      return null;
    }
    if (Math.abs(dx) > Math.abs(dy)) {
      return dx > 0 ? "right" : "left";
    } else {
      return dy > 0 ? "down" : "up";
    }
  };

  let lastTouchDir = null;

  canvas.addEventListener("touchstart", (e) => {
    if (!gameStarted) return;
    const touch = e.touches[0];
    swipeStartX = touch.clientX;
    swipeStartY = touch.clientY;
    lastTouchDir = null;
  }, { passive: true });

  canvas.addEventListener("touchmove", (e) => {
    if (!gameStarted || swipeStartX === null || swipeStartY === null) return;
    const touch = e.touches[0];
    const dx = touch.clientX - swipeStartX;
    const dy = touch.clientY - swipeStartY;
    const dir = getDirectionFromDelta(dx, dy);
    if (dir && dir !== lastTouchDir) {
      console.log("[browser] Touch move direction:", dir);
      lastTouchDir = dir;
      sendLocalInput(dir);
    }
  }, { passive: true });

  canvas.addEventListener("touchend", (e) => {
    if (!gameStarted || swipeStartX === null || swipeStartY === null) return;
    const touch = e.changedTouches[0];
    const dx = touch.clientX - swipeStartX;
    const dy = touch.clientY - swipeStartY;
    swipeStartX = null;
    swipeStartY = null;
    lastTouchDir = null;

    const dir = getDirectionFromDelta(dx, dy);
    if (dir) {
      console.log("[browser] Swipe direction:", dir);
      sendLocalInput(dir);
    }
  }, { passive: true });

  // Optional: mouse support for desktop testing
  let mouseDown = false;
  let mouseStartX = null;
  let mouseStartY = null;
  let lastMouseDir = null;

  canvas.addEventListener("mousedown", (e) => {
    if (!gameStarted) return;
    mouseDown = true;
    mouseStartX = e.clientX;
    mouseStartY = e.clientY;
  });

  canvas.addEventListener("mouseup", (e) => {
    if (!gameStarted || !mouseDown) return;
    mouseDown = false;
    const dx = e.clientX - mouseStartX;
    const dy = e.clientY - mouseStartY;
    mouseStartX = null;
    mouseStartY = null;
    lastMouseDir = null;

    const dir = getDirectionFromDelta(dx, dy);
    if (dir) {
      console.log("[browser] Mouse swipe direction:", dir);
      sendLocalInput(dir);
    }
  });

  canvas.addEventListener("mousemove", (e) => {
    if (!gameStarted || !mouseDown) return;
    const dx = e.clientX - mouseStartX;
    const dy = e.clientY - mouseStartY;
    const dir = getDirectionFromDelta(dx, dy);
    if (dir && dir !== lastMouseDir) {
      console.log("[browser] Mouse move direction:", dir);
      lastMouseDir = dir;
      sendLocalInput(dir);
    }
  });
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
      
      // Listen for viewport changes (when address bar shows/hides)
      if (window.visualViewport) {
        window.visualViewport.addEventListener('resize', () => {
          setTimeout(() => {
            if (window.render3D && window.render3D.onResize) {
              window.render3D.onResize();
            }
            fitLevelToCanvas();
          }, 100);
        });
      }
      
      // Start render loop
      startRenderLoop();
      
      // Initialize characters and make them visible (before game starts)
      setTimeout(() => {
        initLocalCharacters();
      }, 300);
      
      // Initialize controller
      initLocalController();
      
      // Initialize keyboard controls
      initKeyboardControls();

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

  // Use visualViewport if available (excludes address bar on mobile), otherwise use viewport height
  const viewportHeight = window.visualViewport?.height || window.innerHeight;
  const viewportWidth = window.visualViewport?.width || window.innerWidth;
  
  // Get actual canvas dimensions (which should be 100vh based on CSS)
  const canvasRect = canvas.getBoundingClientRect();
  const containerWidth = canvasRect.width || viewportWidth;
  const containerHeight = canvasRect.height || viewportHeight;
  
  if (!containerWidth || !containerHeight) return;

  const levelWidth = window.PACMAN_MAP.COLS * 20;
  const levelHeight = window.PACMAN_MAP.ROWS * 20;
  const aspect = containerWidth / containerHeight;

  // baseViewSize mirrors 3d.js: max(levelWidth, levelHeight)
  const baseViewSize = Math.max(levelWidth, levelHeight);
  // Prefer fitting by HEIGHT so the full level height is visible
  const desiredHeight = levelHeight + 80; // small margin
  const zoom = desiredHeight / baseViewSize;

  // Clamp zoom to reasonable range
  const clamped = Math.min(Math.max(zoom, 0.6), 1.3);
  window.render3D.setCameraZoom(clamped);
  console.log("[browser] Fit zoom", clamped.toFixed(3), "aspect", aspect.toFixed(2), "viewport:", viewportWidth, "x", viewportHeight);
}

function initLocalController() {
  const startBtn = document.getElementById("start-btn");
  const scoreValue = document.getElementById("score-value");

  // Update score display
  window.updateLocalScore = (score) => {
    if (scoreValue) {
      scoreValue.textContent = score;
    }
  };

  // Start game button
  if (startBtn) {
    const handleStartGame = (e) => {
      e.preventDefault();
      e.stopPropagation();
      console.log("[browser] Start button clicked/touched", e.type);
      
      if (gameStarted) {
        console.log("[browser] Game already started, ignoring");
        return;
      }

      // Get player name
      const name = prompt("Enter your 3-letter initials:");
      if (!name || name.trim().length === 0) {
        console.log("[browser] No name entered, cancelling");
        return;
      }

      playerName = name.trim().toUpperCase().slice(0, 3);
      gameStarted = true;
      startBtn.disabled = true;
      startBtn.textContent = "Playing...";
      startBtn.classList.add("disabled");

      // Initialize and start local game (with small delay to ensure 3D is ready)
      console.log("[browser] Starting local game...");
      setTimeout(() => {
        console.log("[browser] Calling initLocalGame...");
        initLocalGame();
      }, 100);
    };
    
    // Add both click and touchstart listeners for mobile compatibility
    startBtn.addEventListener("click", handleStartGame);
    startBtn.addEventListener("touchend", handleStartGame, { passive: false });
    startBtn.addEventListener("touchstart", (e) => {
      e.preventDefault(); // Prevent double-firing
    }, { passive: false });
  }

  // Initialize swipe controls on the canvas
  const canvas = document.getElementById("webgl-canvas");
  if (canvas) {
    initSwipeControls(canvas);
  }
}

function initGameUI() {
  // Set up game end handler
  window.onLocalGameEnd = async (gameResult) => {
    gameStarted = false;
    
    const startBtn = document.getElementById("start-btn");

    if (startBtn) {
      startBtn.disabled = false;
      startBtn.textContent = "Play Again";
      startBtn.classList.remove("disabled");
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
  };
}

// Wait for DOM to be ready
if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", initBrowser);
} else {
  // DOM is already ready
  initBrowser();
}
