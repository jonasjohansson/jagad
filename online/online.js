// Import shared D-pad component
import { initDpad, getCurrentDirection } from "../shared/dpad.js";

// Online solo game - client-side only
const { MAP, COLS, ROWS, TUNNEL_ROW } = PACMAN_MAP;
const CELL_SIZE = 20;
const CHARACTER_SIZE = 16;
const CHARACTER_OFFSET = (CELL_SIZE - CHARACTER_SIZE) / 2;
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

// Game state
let pacmen = [];
let ghosts = [];
let gameStarted = false;
let gameStartTime = null;
let gameDuration = 90; // seconds
let aiDifficulty = 0.8;
let fugitiveSpeed = 0.4;
let chaserSpeed = 0.41;
let caughtFugitives = new Set();
let catchScores = [];
let currentScore = 0;
let playerInitials = "";
let view3D = true; // Start in 3D like /game/
let gui = null;
let lastInputTime = 0;

// Get server address from URL or default
function getServerFromURL() {
  const params = new URLSearchParams(window.location.search);
  const serverParam = params.get("server");
  if (serverParam === "local") {
    return "http://localhost:3000";
  } else if (serverParam === "remote") {
    return "https://pacman-server-239p.onrender.com";
  }
  return "https://pacman-server-239p.onrender.com";
}

// Helper functions
function isPath(x, y) {
  if (x < 0 || x >= COLS || y < 0 || y >= ROWS) return false;
  const cell = MAP[y][x];
  return cell === 0 || cell === 2 || cell === 3 || cell === 4;
}

function shouldCreateBorder(x, y) {
  if (x < 0 || x >= COLS || y < 0 || y >= ROWS) return false;
  const cell = MAP[y][x];
  return cell === 0 || cell === 2 || cell === 3 || cell === 4;
}

function getTargetPixelPos(x, y) {
  return {
    x: x * CELL_SIZE + CHARACTER_OFFSET,
    y: y * CELL_SIZE + CHARACTER_OFFSET,
  };
}

function updatePosition(element, x, y) {
  if (element) {
    element.style.left = x + "px";
    element.style.top = y + "px";
  }
}

function createCharacter(type, color, x, y) {
  const element = document.createElement("div");
  element.className = type === "pacman" ? `pacman ${color}` : `ghost ${color}`;
  const pos = getTargetPixelPos(x, y);
  updatePosition(element, pos.x, pos.y);
  const gameContainer = document.getElementById("game-container");
  if (gameContainer) {
    gameContainer.appendChild(element);
  }
  return element;
}

function respawnCharacter(character, spawnPos) {
  character.x = spawnPos.x;
  character.y = spawnPos.y;
  const pos = getTargetPixelPos(spawnPos.x, spawnPos.y);
  character.px = pos.x;
  character.py = pos.y;
  character.targetX = spawnPos.x;
  character.targetY = spawnPos.y;
  updatePosition(character.element, character.px, character.py);
}

// Calculate scale to fit game in center column
function calculateGameScale() {
  const gameCenter = document.querySelector(".game-center");
  if (!gameCenter) return 1;
  
  const availableWidth = gameCenter.clientWidth;
  const availableHeight = gameCenter.clientHeight;
  const gameWidth = COLS * CELL_SIZE;
  const gameHeight = ROWS * CELL_SIZE;
  
  const scaleX = availableWidth / gameWidth;
  const scaleY = availableHeight / gameHeight;
  const scale = Math.min(scaleX, scaleY, 1); // Don't scale up, only down
  
  return scale;
}

// Apply scale to game container
function updateGameScale() {
  const gameContainer = document.getElementById("game-container");
  const canvas = document.getElementById("webgl-canvas");
  const buildingImage = document.getElementById("building-image");
  const buildingRealImage = document.getElementById("building-real-image");
  
  const scale = calculateGameScale();
  
  if (gameContainer) {
    gameContainer.style.transform = `scale(${scale})`;
    gameContainer.style.transformOrigin = "center center";
  }
  
  // Scale canvas and building images to match
  if (canvas) {
    canvas.style.width = COLS * CELL_SIZE + "px";
    canvas.style.height = ROWS * CELL_SIZE + "px";
    canvas.style.transform = `translate(-50%, -50%) scale(${scale})`;
  }
  
  if (buildingImage) {
    buildingImage.style.width = COLS * CELL_SIZE + "px";
    buildingImage.style.height = ROWS * CELL_SIZE + "px";
    buildingImage.style.transform = `translate(-50%, -50%) scale(${scale})`;
  }
  
  if (buildingRealImage) {
    buildingRealImage.style.width = COLS * CELL_SIZE + "px";
    buildingRealImage.style.height = ROWS * CELL_SIZE + "px";
    // Building real transform includes position and scale from GUI
    const guiParams = window.guiParams || {};
    const translate = `translate(calc(-50% + ${(guiParams.buildingRealX || 9) * scale}px), calc(-50% + ${(guiParams.buildingRealY || 9) * scale}px))`;
    buildingRealImage.style.transform = `${translate} scale(${(guiParams.buildingRealScale || 1.1) * scale})`;
  }
}

// Initialize maze
function initMaze() {
  const maze = document.getElementById("maze");
  if (!maze) return;
  
  maze.style.width = COLS * CELL_SIZE + "px";
  maze.style.height = ROWS * CELL_SIZE + "px";
  
  const fragment = document.createDocumentFragment();
  
  for (let y = 0; y < ROWS; y++) {
    for (let x = 0; x < COLS; x++) {
      const cellType = MAP[y][x];
      
      if (cellType === 1) {
        const hasPathTop = shouldCreateBorder(x, y - 1);
        const hasPathRight = shouldCreateBorder(x + 1, y);
        const hasPathBottom = shouldCreateBorder(x, y + 1);
        const hasPathLeft = shouldCreateBorder(x - 1, y);
        
        const isEdgeTop = y === 0;
        const isEdgeRight = x === COLS - 1;
        const isEdgeBottom = y === ROWS - 1;
        const isEdgeLeft = x === 0;
        const isEdge = isEdgeTop || isEdgeRight || isEdgeBottom || isEdgeLeft;
        
        if (!hasPathTop && !hasPathRight && !hasPathBottom && !hasPathLeft && !isEdge) {
          continue;
        }
        
        const cell = document.createElement("div");
        cell.className = "cell wall";
        cell.style.left = x * CELL_SIZE + "px";
        cell.style.top = y * CELL_SIZE + "px";
        
        const classes = [];
        if (hasPathTop) classes.push("border-top");
        if (hasPathRight) classes.push("border-right");
        if (hasPathBottom) classes.push("border-bottom");
        if (hasPathLeft) classes.push("border-left");
        if (isEdgeTop) classes.push("edge-top");
        if (isEdgeRight) classes.push("edge-right");
        if (isEdgeBottom) classes.push("edge-bottom");
        if (isEdgeLeft) classes.push("edge-left");
        if (isEdge) classes.push("outer-wall");
        if (hasPathTop && hasPathRight) classes.push("corner-top-right");
        if (hasPathTop && hasPathLeft) classes.push("corner-top-left");
        if (hasPathBottom && hasPathRight) classes.push("corner-bottom-right");
        if (hasPathBottom && hasPathLeft) classes.push("corner-bottom-left");
        
        if (classes.length > 0) {
          cell.className += " " + classes.join(" ");
        }
        fragment.appendChild(cell);
      } else {
        const cell = document.createElement("div");
        cell.className = "cell " + (cellType === 2 ? "teleport" : "path");
        cell.style.left = x * CELL_SIZE + "px";
        cell.style.top = y * CELL_SIZE + "px";
        fragment.appendChild(cell);
      }
    }
  }
  maze.appendChild(fragment);
}

// Initialize characters
function initCharacters() {
  // Create 4 fugitives (pacmen) in corners
  const pacmanSpawnPositions = [
    { x: 1, y: 1 },
    { x: 30, y: 1 },
    { x: 1, y: 14 },
    { x: 30, y: 14 },
  ];
  
  pacmen = [];
  pacmanSpawnPositions.forEach((pos, i) => {
    const pos_px = getTargetPixelPos(pos.x, pos.y);
    const pacman = {
      x: pos.x,
      y: pos.y,
      px: pos_px.x,
      py: pos_px.y,
      targetX: pos.x,
      targetY: pos.y,
      color: COLORS[i],
      speed: fugitiveSpeed,
      spawnPos: { ...pos },
      element: createCharacter("pacman", COLORS[i], pos.x, pos.y),
      lastDirX: 0,
      lastDirY: 0,
    };
    pacmen.push(pacman);
  });
  
  // Create 1 chaser (ghost) - player controlled
  const chaserSpawnPos = { x: 11, y: 11 };
  const chaserPos = getTargetPixelPos(chaserSpawnPos.x, chaserSpawnPos.y);
  ghosts = [{
    x: chaserSpawnPos.x,
    y: chaserSpawnPos.y,
    px: chaserPos.x,
    py: chaserPos.y,
    targetX: chaserSpawnPos.x,
    targetY: chaserSpawnPos.y,
    color: "white",
    speed: chaserSpeed,
    spawnPos: { ...chaserSpawnPos },
    element: createCharacter("ghost", "white", chaserSpawnPos.x, chaserSpawnPos.y),
    dirX: 0,
    dirY: 0,
    lastDirX: 0,
    lastDirY: 0,
  }];
}

// Move character
function moveCharacter(character, speedMultiplier) {
  if (character.x === character.targetX && character.y === character.targetY) {
    return;
  }
  
  const target = getTargetPixelPos(character.targetX, character.targetY);
  const dx = target.x - character.px;
  const dy = target.y - character.py;
  const distance = Math.sqrt(dx * dx + dy * dy);
  
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
}

function teleportCharacter(character) {
  const teleportPositions = [];
  for (let y = 0; y < ROWS; y++) {
    for (let x = 0; x < COLS; x++) {
      if (MAP[y][x] === 2) {
        teleportPositions.push({ x, y });
      }
    }
  }
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

// AI for fugitives
function moveFugitiveAI(fugitive, index) {
  if (caughtFugitives.has(index)) return;
  
  const possibleMoves = [];
  const currentX = fugitive.x;
  const currentY = fugitive.y;
  
  DIRECTIONS.forEach(({ dir, x: dx, y: dy }) => {
    const newX = currentX + dx;
    const newY = currentY + dy;
    if (newX >= 0 && newX < COLS && newY >= 0 && newY < ROWS && isPath(newX, newY)) {
      possibleMoves.push({ dir, x: dx, y: dy, newX, newY });
    }
  });
  
  if (possibleMoves.length === 0) return;
  
  // Find closest chaser
  let closestChaser = null;
  let closestDistance = Infinity;
  ghosts.forEach((chaser) => {
    if (!chaser) return;
    const dx = Math.abs(fugitive.x - chaser.x);
    const dy = Math.abs(fugitive.y - chaser.y);
    const distance = Math.sqrt(dx * dx + dy * dy);
    if (distance < closestDistance) {
      closestDistance = distance;
      closestChaser = chaser;
    }
  });
  
  // Choose move that increases distance from chaser (with AI difficulty)
  let bestMove = possibleMoves[0];
  if (closestChaser) {
    const movesWithDistance = possibleMoves.map((move) => {
      const dx = Math.abs(move.newX - closestChaser.x);
      const dy = Math.abs(move.newY - closestChaser.y);
      const distance = Math.sqrt(dx * dx + dy * dy);
      return { ...move, distance };
    });
    
    // Sort by distance (further = better, but add randomness based on difficulty)
    movesWithDistance.sort((a, b) => {
      const randomFactor = Math.random() * (1 - aiDifficulty);
      return (b.distance - a.distance) + (randomFactor * 2 - 1);
    });
    bestMove = movesWithDistance[0];
  }
  
  if (bestMove) {
    fugitive.targetX = bestMove.newX;
    fugitive.targetY = bestMove.newY;
    fugitive.lastDirX = bestMove.x;
    fugitive.lastDirY = bestMove.y;
  }
}

// Check collisions
function checkCollisions() {
  if (!gameStarted) return;
  
  pacmen.forEach((fugitive, fugitiveIndex) => {
    if (caughtFugitives.has(fugitiveIndex)) return;
    ghosts.forEach((chaser) => {
      if (!chaser) return;
      if (fugitive.x === chaser.x && fugitive.y === chaser.y) {
        caughtFugitives.add(fugitiveIndex);
        
        const catchTime = Date.now() - gameStartTime;
        const catchTimeSeconds = catchTime / 1000;
        const catchScore = Math.max(0, 1000 - Math.floor(catchTimeSeconds * 10));
        catchScores.push(catchScore);
        currentScore = catchScores.reduce((sum, score) => sum + score, 0);
        updateScoreDisplay();
        
        // Hide caught fugitive
        if (fugitive.element) {
          fugitive.element.style.display = "none";
        }
        
        // Check if all caught
        if (caughtFugitives.size >= pacmen.length) {
          endGame(true);
        }
      }
    });
  });
}

// Update score display
function updateScoreDisplay() {
  const scoreValue = document.getElementById("score-value");
  if (scoreValue) {
    scoreValue.textContent = currentScore.toLocaleString();
  }
}

// End game
function endGame(allCaught) {
  gameStarted = false;
  const gameTime = Date.now() - gameStartTime;
  
  // Calculate final score
  let finalScore = currentScore;
  if (allCaught) {
    const totalTimeSeconds = gameTime / 1000;
    const timeBonus = Math.max(0, 2000 - Math.floor(totalTimeSeconds * 5));
    finalScore += timeBonus;
  } else {
    const caughtCount = caughtFugitives.size;
    const totalCount = pacmen.length;
    const caughtPercentage = caughtCount / totalCount;
    finalScore = Math.floor(finalScore * caughtPercentage);
  }
  
  // Send score to server
  sendScoreToServer(finalScore, playerInitials);
  
  // Update info text
  const infoText = document.getElementById("info-text");
  if (infoText) {
    const timeSeconds = (gameTime / 1000).toFixed(1);
    if (allCaught) {
      infoText.textContent = `Game Over! All fugitives caught! Your score: ${finalScore.toLocaleString()}. Time: ${timeSeconds}s. Click "Play" to play again.`;
    } else {
      infoText.textContent = `Game Over! Time's up! Your score: ${finalScore.toLocaleString()}. Caught: ${caughtFugitives.size}/${pacmen.length}. Click "Play" to play again.`;
    }
  }
  
  // Show play button again
  const playBtn = document.getElementById("play-btn");
  if (playBtn) {
    playBtn.style.display = "block";
    playBtn.textContent = "Play Again";
  }
  
  // Hide score display
  const scoreDisplay = document.getElementById("score-display");
  if (scoreDisplay) {
    scoreDisplay.style.display = "none";
  }
}

// Send score to server
async function sendScoreToServer(score, playerName) {
  try {
    const serverAddress = getServerFromURL();
    const response = await fetch(`${serverAddress}/api/highscore`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        score: score,
        playerName: playerName + " (www)",
        isTeamGame: false,
      }),
    });
    
    if (!response.ok) {
      console.error("Failed to save score:", response.status);
    }
  } catch (error) {
    console.error("Error sending score to server:", error);
  }
}

// D-pad callback - called when direction changes
function onDpadDirectionChange(dir) {
  if (dir) {
    const now = Date.now();
    if (now - lastInputTime < 50) return; // Throttle
    lastInputTime = now;
    handleChaserInput(dir);
  }
}

// Handle chaser input
function handleChaserInput(dir) {
  if (!gameStarted || !dir || ghosts.length === 0) return;
  
  const chaser = ghosts[0];
  if (!chaser) return;
  
  // Only process input if chaser is at a grid position
  if (chaser.x === chaser.targetX && chaser.y === chaser.targetY) {
    const dirMap = {
      up: { x: 0, y: -1 },
      down: { x: 0, y: 1 },
      left: { x: -1, y: 0 },
      right: { x: 1, y: 0 },
    };
    
    const moveDir = dirMap[dir];
    if (moveDir) {
      const newX = chaser.x + moveDir.x;
      const newY = chaser.y + moveDir.y;
      
      if (isPath(newX, newY)) {
        chaser.targetX = newX;
        chaser.targetY = newY;
        chaser.lastDirX = moveDir.x;
        chaser.lastDirY = moveDir.y;
      }
    }
  }
}

// Game loop
function gameLoop() {
  if (!gameStarted) {
    requestAnimationFrame(gameLoop);
    return;
  }
  
  // Check timer
  const elapsed = (Date.now() - gameStartTime) / 1000;
  if (elapsed >= gameDuration) {
    endGame(false);
    requestAnimationFrame(gameLoop);
    return;
  }
  
  // Note: handleChaserInput is called from joystick handlers, not here
  
  // Move chaser
  ghosts.forEach((chaser) => {
    if (chaser) {
      moveCharacter(chaser, chaserSpeed);
    }
  });
  
  // Move fugitives (AI)
  pacmen.forEach((fugitive, index) => {
    if (fugitive && !caughtFugitives.has(index)) {
      if (fugitive.x === fugitive.targetX && fugitive.y === fugitive.targetY) {
        moveFugitiveAI(fugitive, index);
      }
      moveCharacter(fugitive, fugitiveSpeed);
    }
  });
  
  // Check collisions
  checkCollisions();
  
  // Update AI difficulty if only 1 fugitive left
  if (pacmen.length - caughtFugitives.size === 1 && gameStarted) {
    aiDifficulty = 1.0;
  }
  
  // Render
  if (view3D && window.render3D && window.render3D.initialized) {
    // Update 3D positions - format matches what 3d.js expects
    const positions = {
      fugitives: pacmen.map((p, index) => ({
        x: p.x,
        y: p.y,
        px: p.px,
        py: p.py,
        color: COLORS[index] || "red",
      })),
      chasers: ghosts.map((g, index) => ({
        x: g.x,
        y: g.y,
        px: g.px,
        py: g.py,
        color: g.color || "white",
      })),
      // Also include legacy names for compatibility
      pacmen: pacmen.map((p, index) => ({
        x: p.x,
        y: p.y,
        px: p.px,
        py: p.py,
        color: COLORS[index] || "red",
      })),
      ghosts: ghosts.map((g, index) => ({
        x: g.x,
        y: g.y,
        px: g.px,
        py: g.py,
        color: g.color || "white",
      })),
    };
    if (window.render3D.updatePositions) {
      window.render3D.updatePositions(positions);
    }
    if (window.render3D.render) {
      window.render3D.render();
    }
  } else {
    // Render 2D
    pacmen.forEach((pacman) => {
      if (pacman && pacman.element) {
        updatePosition(pacman.element, pacman.px, pacman.py);
      }
    });
    
    ghosts.forEach((ghost) => {
      if (ghost && ghost.element) {
        updatePosition(ghost.element, ghost.px, ghost.py);
      }
    });
  }
  
  requestAnimationFrame(gameLoop);
}

// Start game
function startGame() {
  // Prompt for initials
  const initials = prompt("Enter your 3 initials:");
  if (!initials || initials.trim().length === 0) {
    return;
  }
  
  playerInitials = initials.trim().toUpperCase().slice(0, 3);
  
  // Reset game state
  caughtFugitives.clear();
  catchScores = [];
  currentScore = 0;
  gameStartTime = Date.now();
  gameStarted = true;
  
  // Reset characters
  pacmen.forEach((pacman) => {
    if (pacman) {
      respawnCharacter(pacman, pacman.spawnPos);
      if (pacman.element) {
        pacman.element.style.display = "block";
      }
    }
  });
  
  ghosts.forEach((ghost) => {
    if (ghost) {
      respawnCharacter(ghost, ghost.spawnPos);
    }
  });
  
  // Update UI
  const infoText = document.getElementById("info-text");
  if (infoText) {
    infoText.textContent = `Game started! Catch all fugitives as fast as possible. Time limit: ${gameDuration} seconds.`;
  }
  
  const playBtn = document.getElementById("play-btn");
  if (playBtn) {
    playBtn.style.display = "none";
  }
  
  const scoreDisplay = document.getElementById("score-display");
  if (scoreDisplay) {
    scoreDisplay.style.display = "block";
  }
  
  updateScoreDisplay();
}

// Toggle between 2D and 3D view (same as game.js)
function toggle3DView(enabled) {
  const gameContainer = document.getElementById("game-container");
  const canvas = document.getElementById("webgl-canvas");
  const buildingImage = document.getElementById("building-image");
  const buildingRealImage = document.getElementById("building-real-image");

  if (enabled) {
    if (gameContainer) gameContainer.style.display = "none";
    if (canvas) canvas.style.display = "block";
    if (buildingImage) buildingImage.style.display = "block";
    if (buildingRealImage) buildingRealImage.style.display = "block";

    if (window.render3D && !window.render3D.initialized) {
      window.render3D.init();
      window.render3D.initialized = true;
    }

    // Initialize 3D wall colors and path color from current GUI params
    if (window.render3D && window.guiParams) {
      if (window.render3D.setInnerWallColor) {
        window.render3D.setInnerWallColor(window.guiParams.innerWallColor);
      }
      if (window.render3D.setOuterWallColor) {
        window.render3D.setOuterWallColor(window.guiParams.outerWallColor);
      }
      if (window.render3D.setPathColor) {
        window.render3D.setPathColor(window.guiParams.pathColor);
      }
      // Initialize camera zoom
      if (window.render3D.setCameraZoom) {
        window.render3D.setCameraZoom(window.guiParams.cameraZoom);
      }
      // Initialize camera type
      if (window.render3D.setCameraType) {
        window.render3D.setCameraType(window.guiParams.camera3D === "Orthographic");
      }
      // Initialize lighting
      if (window.render3D.setAmbientLight) {
        window.render3D.setAmbientLight(window.guiParams.ambientLightIntensity);
      }
      if (window.render3D.setDirectionalLight) {
        window.render3D.setDirectionalLight(window.guiParams.directionalLightIntensity);
      }
      if (window.render3D.setPointLightIntensity) {
        window.render3D.setPointLightIntensity(window.guiParams.pointLightIntensity);
      }
    }
  } else {
    if (gameContainer) gameContainer.style.display = "block";
    if (canvas) canvas.style.display = "none";
    if (buildingImage) buildingImage.style.display = "block";
    if (buildingRealImage) buildingRealImage.style.display = "block";
  }
}

// Initialize GUI (same as game.js)
function initGUI() {
  if (typeof lil === "undefined" || typeof lil.GUI === "undefined") return;
  
  const guiContainer = document.getElementById("gui-container");
  if (!guiContainer) return;
  
  const GUI = lil.GUI;
  if (gui) gui.destroy();
  gui = new GUI({ container: guiContainer });

  window.guiParams = {
    view3D: true,
    camera3D: "Orthographic",
    cameraZoom: 1.2,
    ambientLightIntensity: 0.1,
    directionalLightIntensity: 0.3,
    pointLightIntensity: 100,
    pathColor: "#dddddd",
    innerWallColor: "#ffffff",
    outerWallColor: "#ffffff",
    bodyBackgroundColor: "#555555",
    buildingOpacity: 0.0,
    buildingRealOpacity: 1.0,
    buildingRealScale: 1.1,
    buildingRealX: 9,
    buildingRealY: 9,
    buildingRealBlendMode: "soft-light",
    mazeOpacity: 1.0,
  };

  const view3DFolder = gui.addFolder("2D/3D");
  view3DFolder.close();

  view3DFolder.add(guiParams, "view3D").name("3D View").onChange((value) => {
    view3D = value;
    toggle3DView(value);
  });

  view3DFolder.add(guiParams, "camera3D", ["Orthographic", "Perspective"]).name("3D Camera").onChange((value) => {
    if (view3D && window.render3D && window.render3D.setCameraType) {
      window.render3D.setCameraType(value === "Orthographic");
    }
  });

  view3DFolder.add(guiParams, "cameraZoom", 0.5, 2.0, 0.01).name("Camera Zoom").onChange((value) => {
    if (view3D && window.render3D && window.render3D.setCameraZoom) {
      window.render3D.setCameraZoom(value);
    }
  });

  view3DFolder.add(guiParams, "ambientLightIntensity", 0, 2, 0.1).name("Ambient Light").onChange((value) => {
    if (view3D && window.render3D && window.render3D.setAmbientLight) {
      window.render3D.setAmbientLight(value);
    }
  });

  view3DFolder.add(guiParams, "directionalLightIntensity", 0, 2, 0.1).name("Directional Light").onChange((value) => {
    if (view3D && window.render3D && window.render3D.setDirectionalLight) {
      window.render3D.setDirectionalLight(value);
    }
  });

  view3DFolder.add(guiParams, "pointLightIntensity", 0, 400, 1).name("Point Light Intensity").onChange((value) => {
    if (view3D && window.render3D && window.render3D.setPointLightIntensity) {
      window.render3D.setPointLightIntensity(value);
    }
  });

  const styleFolder = gui.addFolder("Style");
  styleFolder.close();

  styleFolder.addColor(guiParams, "pathColor").name("Path Color").onChange((value) => {
    if (view3D && window.render3D && window.render3D.setPathColor) {
      window.render3D.setPathColor(value);
    }
  });

  styleFolder.addColor(guiParams, "innerWallColor").name("Inner Wall Color").onChange((value) => {
    if (view3D && window.render3D && window.render3D.setInnerWallColor) {
      window.render3D.setInnerWallColor(value);
    }
  });

  styleFolder.addColor(guiParams, "outerWallColor").name("Outer Wall Color").onChange((value) => {
    if (view3D && window.render3D && window.render3D.setOuterWallColor) {
      window.render3D.setOuterWallColor(value);
    }
  });

  styleFolder.addColor(guiParams, "bodyBackgroundColor").name("Background Color").onChange((value) => {
    document.body.style.backgroundColor = value;
  });

  styleFolder.add(guiParams, "mazeOpacity", 0, 1, 0.01).name("Maze Opacity").onChange((value) => {
    const maze = document.getElementById("maze");
    if (maze) maze.style.opacity = value;
  });

  const buildingFolder = gui.addFolder("Building");
  buildingFolder.close();

  buildingFolder.add(guiParams, "buildingOpacity", 0, 1, 0.01).name("Building Opacity").onChange((value) => {
    const img = document.getElementById("building-image");
    if (img) img.style.opacity = value;
  });

  buildingFolder.add(guiParams, "buildingRealOpacity", 0, 1, 0.01).name("Building Real Opacity").onChange((value) => {
    const img = document.getElementById("building-real-image");
    if (img) img.style.opacity = value;
  });

  buildingFolder.add(guiParams, "buildingRealScale", 0.1, 3.0, 0.01).name("Building Real Scale").onChange((value) => {
    updateGameScale(); // Recalculate scale with new building scale
  });

  buildingFolder.add(guiParams, "buildingRealX", -50, 50, 1).name("Building Real X").onChange(() => {
    updateGameScale(); // Recalculate scale with new position
  });

  buildingFolder.add(guiParams, "buildingRealY", -50, 50, 1).name("Building Real Y").onChange(() => {
    updateGameScale(); // Recalculate scale with new position
  });

  buildingFolder.add(guiParams, "buildingRealBlendMode", ["normal", "multiply", "screen", "overlay", "soft-light", "hard-light"]).name("Building Real Blend").onChange((value) => {
    const img = document.getElementById("building-real-image");
    if (img) img.style.mixBlendMode = value;
  });

  // Apply initial values
  document.body.style.backgroundColor = guiParams.bodyBackgroundColor;
  
  // Set initial opacity values
  const buildingImage = document.getElementById("building-image");
  if (buildingImage) {
    buildingImage.style.opacity = guiParams.buildingOpacity;
  }
  const buildingRealImage = document.getElementById("building-real-image");
  if (buildingRealImage) {
    buildingRealImage.style.opacity = guiParams.buildingRealOpacity;
    buildingRealImage.style.mixBlendMode = guiParams.buildingRealBlendMode;
    // Initial scale will be set by updateGameScale()
  }
  const maze = document.getElementById("maze");
  if (maze) {
    maze.style.opacity = guiParams.mazeOpacity;
  }
  
  // Initialize 3D view with all settings applied
  toggle3DView(view3D);
}

// Initialize
document.addEventListener("DOMContentLoaded", () => {
  initMaze();
  initCharacters();
  
  // Initialize GUI first (sets up 3D view)
  initGUI();
  
  // Calculate and apply initial scale
  updateGameScale();
  
  // Update scale on window resize
  window.addEventListener("resize", () => {
    updateGameScale();
    // Also update 3D renderer if needed
    if (window.render3D && window.render3D.onResize) {
      window.render3D.onResize();
    }
  });
  
  // Initialize shared D-pad component
  initDpad("joystick-base", "joystick-handle", onDpadDirectionChange);
  
  const playBtn = document.getElementById("play-btn");
  if (playBtn) {
    playBtn.addEventListener("click", startGame);
  }
  
  // Initialize 3D positions for initial render
  if (view3D && window.render3D && window.render3D.initialized) {
    const positions = {
      fugitives: pacmen.map((p, index) => ({
        x: p.x,
        y: p.y,
        px: p.px,
        py: p.py,
        color: COLORS[index] || "red",
      })),
      chasers: ghosts.map((g, index) => ({
        x: g.x,
        y: g.y,
        px: g.px,
        py: g.py,
        color: g.color || "white",
      })),
      pacmen: pacmen.map((p, index) => ({
        x: p.x,
        y: p.y,
        px: p.px,
        py: p.py,
        color: COLORS[index] || "red",
      })),
      ghosts: ghosts.map((g, index) => ({
        x: g.x,
        y: g.y,
        px: g.px,
        py: g.py,
        color: g.color || "white",
      })),
    };
    if (window.render3D.updatePositions) {
      window.render3D.updatePositions(positions);
    }
  }
  
  // Start game loop
  gameLoop();
});
