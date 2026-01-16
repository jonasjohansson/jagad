// 3D rendering module using Three.js
// Renders the game in 3D with voxel-based level design

import * as THREE from "./three/three.module.js";

const { MAP, COLS, ROWS, TUNNEL_ROW } = PACMAN_MAP;
const CELL_SIZE = 20;
const CHARACTER_SIZE = 16;
const CHARACTER_OFFSET = (CELL_SIZE - CHARACTER_SIZE) / 2;
const VOXEL_SIZE = 4;
const VOXEL_HEIGHT = 16; // Walls are twice as high

const COLORS = ["red", "green", "blue", "yellow"];

let scene, camera, renderer;
let orthographicCamera, perspectiveCamera;
let useOrthographic = true; // Default to orthographic
let cameraZoom = 1.2; // Camera zoom level
let baseViewSize = 0; // Base view size (calculated on init)
let fugitives3D = [];
let chasers3D = [];
let mazeVoxels = [];
let fugitiveLights = []; // Point lights for fugitives
let chaserLights = []; // Point lights for chasers
let ambientLight3D, directionalLight3D; // Global lights for intensity control
let innerWallMaterial3D, outerWallMaterial3D, floorMaterial3D, teleportMaterial3D; // Materials for color control
let colorOverrides = [null, null, null, null]; // Color overrides for each color index (red, green, blue, yellow)
let teamImages = [null, null, null, null]; // Team images for each color index (red, green, blue, yellow)

// Initialize 3D rendering
function init3D() {
  // Scene
  scene = new THREE.Scene();
  scene.background = null; // Transparent background so building image is visible

  // Create both orthographic and perspective cameras
  baseViewSize = Math.max(COLS * CELL_SIZE, ROWS * CELL_SIZE) * 1.0;
  const viewSize = baseViewSize * cameraZoom;
  const aspect = window.innerWidth / window.innerHeight;

  // Orthographic camera
  let left, right, top, bottom;
  if (aspect >= 1) {
    left = (-viewSize * aspect) / 2;
    right = (viewSize * aspect) / 2;
    top = viewSize / 2;
    bottom = -viewSize / 2;
  } else {
    left = -viewSize / 2;
    right = viewSize / 2;
    top = viewSize / aspect / 2;
    bottom = -viewSize / aspect / 2;
  }

  orthographicCamera = new THREE.OrthographicCamera(left, right, top, bottom, 0.1, 1000);
  orthographicCamera.position.set((COLS * CELL_SIZE) / 2, 200, (ROWS * CELL_SIZE) / 2);
  orthographicCamera.lookAt((COLS * CELL_SIZE) / 2, 0, (ROWS * CELL_SIZE) / 2);

  // Perspective camera - zoomed out to see the whole level
  const levelWidth = COLS * CELL_SIZE;
  const levelHeight = ROWS * CELL_SIZE;
  const levelDiagonal = Math.sqrt(levelWidth * levelWidth + levelHeight * levelHeight);

  // Calculate camera distance to fit the entire level in view
  // Using a wider field of view and positioning camera higher and further back
  perspectiveCamera = new THREE.PerspectiveCamera(60, aspect, 0.1, 2000);
  perspectiveCamera.zoom = cameraZoom;

  // Position camera high and at an angle to see the whole level
  const cameraHeight = levelDiagonal * 0.8; // Higher up
  const cameraDistance = levelDiagonal * 0.6; // Further back
  perspectiveCamera.position.set(
    (COLS * CELL_SIZE) / 2 + cameraDistance * 0.5,
    cameraHeight,
    (ROWS * CELL_SIZE) / 2 + cameraDistance * 0.5
  );
  perspectiveCamera.lookAt((COLS * CELL_SIZE) / 2, 0, (ROWS * CELL_SIZE) / 2);

  // Start with orthographic
  camera = orthographicCamera;
  useOrthographic = true;

  // Renderer
  const canvas = document.getElementById("webgl-canvas");
  if (!canvas) {
    console.error("Canvas element not found");
    return;
  }
  renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true, powerPreference: "high-performance" });
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2)); // Cap at 2x for performance
  renderer.setClearColor(0x000000, 0); // Transparent background
  // Shadows disabled for better performance (characters don't cast shadows anyway)
  renderer.shadowMap.enabled = false;

  // Lights - minimal ambient so point lights are clearly visible
  ambientLight3D = new THREE.AmbientLight(0xffffff, 0.1);
  scene.add(ambientLight3D);

  // Reduced directional light so point lights stand out
  directionalLight3D = new THREE.DirectionalLight(0xffffff, 0.3);
  directionalLight3D.position.set(50, 100, 50);
  directionalLight3D.castShadow = false; // Directional light doesn't need shadows
  scene.add(directionalLight3D);

  // Create voxel-based maze
  createMazeVoxels();

  // Handle window resize
  window.addEventListener("resize", onWindowResize3D);
}

function createMazeVoxels() {
  // Clear existing voxels
  mazeVoxels.forEach((voxel) => scene.remove(voxel));
  mazeVoxels = [];

  // Initialize materials if not already created
  if (!innerWallMaterial3D) {
    innerWallMaterial3D = new THREE.MeshStandardMaterial({
      color: 0xffffff, // White default
      roughness: 0.5,
      metalness: 0.2,
      emissive: 0x000000, // No emissive - should reflect point lights
    });
  }

  if (!outerWallMaterial3D) {
    outerWallMaterial3D = new THREE.MeshStandardMaterial({
      color: 0xffffff, // White default
      roughness: 0.5,
      metalness: 0.2,
      emissive: 0x000000, // No emissive - should reflect point lights
    });
  }

  // Track which cells have been processed
  const processed = Array(ROWS)
    .fill(null)
    .map(() => Array(COLS).fill(false));

  // Create floors first
  for (let y = 0; y < ROWS; y++) {
    for (let x = 0; x < COLS; x++) {
      const cellType = MAP[y][x];
      // Treat 0 (path), 2 (teleport), 3 (chaser spawn), and 4 (fugitive spawn) as paths
      if (cellType === 0 || cellType === 2 || cellType === 3 || cellType === 4) {
        // Path, teleport, or spawn - create floor voxels
        const worldX = x * CELL_SIZE;
        const worldZ = y * CELL_SIZE;
        createFloorVoxels(worldX, worldZ, cellType === 2);
      }
    }
  }

  // Merge walls: find horizontal and vertical runs of walls
  for (let y = 0; y < ROWS; y++) {
    for (let x = 0; x < COLS; x++) {
      if (processed[y][x] || MAP[y][x] !== 1) continue;

      const isOuterWall = x === 0 || x === COLS - 1 || y === 0 || y === ROWS - 1;

      // Try to find a horizontal run first
      let width = 1;
      while (
        x + width < COLS &&
        MAP[y][x + width] === 1 &&
        !processed[y][x + width] &&
        (x + width === 0 || x + width === COLS - 1 || y === 0 || y === ROWS - 1) === isOuterWall
      ) {
        width++;
      }

      // Try to extend vertically if we can form a rectangle
      let height = 1;
      let canExtendVertically = true;
      while (canExtendVertically && y + height < ROWS) {
        // Check if entire row can be extended
        for (let w = 0; w < width; w++) {
          if (MAP[y + height][x + w] !== 1 || processed[y + height][x + w]) {
            canExtendVertically = false;
            break;
          }
          // Check if wall type matches (outer vs inner)
          const cellIsOuter = x + w === 0 || x + w === COLS - 1 || y + height === 0 || y + height === ROWS - 1;
          if (cellIsOuter !== isOuterWall) {
            canExtendVertically = false;
            break;
          }
        }
        if (canExtendVertically) {
          height++;
        }
      }

      // Create merged wall block
      const worldX = x * CELL_SIZE;
      const worldZ = y * CELL_SIZE;
      const blockWidth = width * CELL_SIZE;
      const blockDepth = height * CELL_SIZE;

      const wallGeometry = new THREE.BoxGeometry(blockWidth, VOXEL_HEIGHT, blockDepth);
      const wallMaterial = isOuterWall ? outerWallMaterial3D : innerWallMaterial3D;
      const wall = new THREE.Mesh(wallGeometry, wallMaterial);
      // Position at the center of the merged block
      wall.position.set(worldX + blockWidth / 2, VOXEL_HEIGHT / 2, worldZ + blockDepth / 2);
      wall.castShadow = true;
      wall.receiveShadow = true;
      scene.add(wall);
      mazeVoxels.push(wall);

      // Mark cells as processed
      for (let h = 0; h < height; h++) {
        for (let w = 0; w < width; w++) {
          processed[y + h][x + w] = true;
        }
      }
    }
  }
}

// This function is no longer used - walls are now merged in createMazeVoxels()
// Keeping it for reference but it's been replaced by the merging algorithm

function createFloorVoxels(worldX, worldZ, isTeleport = false) {
  // Optimize: Create a single plane per cell instead of multiple voxels
  // Use shared materials for floors (created once, reused)
  if (isTeleport) {
    if (!teleportMaterial3D) {
      teleportMaterial3D = new THREE.MeshStandardMaterial({
        color: 0x4444ff,
        roughness: 0.6,
        metalness: 0.1,
        emissive: 0x000000, // No emissive - should reflect point lights
      });
    }
  } else {
    if (!floorMaterial3D) {
      floorMaterial3D = new THREE.MeshStandardMaterial({
        color: 0x777777, // Gray default (#777777)
        roughness: 0.6,
        metalness: 0.1,
        emissive: 0x000000, // No emissive - should reflect point lights
      });
    }
  }

  const floorGeometry = new THREE.PlaneGeometry(CELL_SIZE, CELL_SIZE);
  const floorMaterial = isTeleport ? teleportMaterial3D : floorMaterial3D;
  const floor = new THREE.Mesh(floorGeometry, floorMaterial);
  floor.rotation.x = -Math.PI / 2;
  // Position floor at the center of the cell (not the corner)
  floor.position.set(worldX + CELL_SIZE / 2, 0, worldZ + CELL_SIZE / 2);
  floor.castShadow = false; // Floors don't cast shadows
  floor.receiveShadow = true; // Floors receive shadows from walls and characters
  scene.add(floor);
  mazeVoxels.push(floor);
}

function createFugitive3D(color, x, y, px, py) {
  // Create a group to hold both the mesh and light
  const group = new THREE.Group();

  // Create fugitive as a simple sphere
  const geometry = new THREE.SphereGeometry(CHARACTER_SIZE / 2, 16, 16);
  // Find color index and use override if set, otherwise use individual color
  const colorIndex = COLORS.indexOf(color.toLowerCase());
  const colorHex =
    colorIndex >= 0 && colorOverrides[colorIndex] !== null ? new THREE.Color(colorOverrides[colorIndex]).getHex() : getColorHex(color);

  // Create material with optional texture
  let material;
  if (colorIndex >= 0 && teamImages[colorIndex] !== null && teamImages[colorIndex].trim() !== "") {
    const textureLoader = new THREE.TextureLoader();
    const texture = textureLoader.load(teamImages[colorIndex]);
    material = new THREE.MeshStandardMaterial({
      map: texture,
      color: 0xffffff, // Use white to show texture colors properly
      emissive: colorHex, // Match light color for better blending
      emissiveIntensity: 1.0, // Full emissive to eliminate dark halo
      roughness: 0.1, // Very low roughness for bright, smooth surface
      metalness: 0.0, // No metalness for softer appearance
    });
  } else {
    material = new THREE.MeshStandardMaterial({
      color: colorHex,
      emissive: colorHex, // Match light color for better blending
      emissiveIntensity: 1.0, // Full emissive to eliminate dark halo
      roughness: 0.1, // Very low roughness for bright, smooth surface
      metalness: 0.0, // No metalness for softer appearance
    });
  }
  const fugitive = new THREE.Mesh(geometry, material);
  fugitive.position.set(0, 0, 0); // Position relative to group
  fugitive.castShadow = false; // Don't cast shadows on floor to avoid artifacts
  fugitive.receiveShadow = false; // Don't receive shadows
  group.add(fugitive);

  // Create a point light as a child of the character group
  // Position light at center of character for even illumination
  const pointLight = new THREE.PointLight(colorHex, 100, 200);
  pointLight.position.set(0, 0, 0); // Position at center for even lighting
  pointLight.castShadow = false; // Don't cast shadows from avatars
  pointLight.intensity = 80; // Slightly reduced intensity since emissive provides glow
  pointLight.distance = 200; // Long range
  pointLight.decay = 1; // No decay (constant intensity)
  group.add(pointLight);

  // Set group position - in 3D, center characters on the floor tiles
  // Convert server's px/py (which use CHARACTER_OFFSET) to centered position
  // Or calculate from grid coordinates centered on the cell
  let posX, posZ;
  if (px !== undefined && py !== undefined) {
    // Server sends px/py with CHARACTER_OFFSET, convert to center of cell
    // px = x * CELL_SIZE + CHARACTER_OFFSET, we want x * CELL_SIZE + CELL_SIZE / 2
    // So: posX = px - CHARACTER_OFFSET + CELL_SIZE / 2
    posX = px - CHARACTER_OFFSET + CELL_SIZE / 2;
    posZ = py - CHARACTER_OFFSET + CELL_SIZE / 2;
  } else {
    // Calculate from grid coordinates, centered on cell
    posX = x * CELL_SIZE + CELL_SIZE / 2;
    posZ = y * CELL_SIZE + CELL_SIZE / 2;
  }
  group.position.set(posX, CHARACTER_SIZE / 2, posZ);
  scene.add(group);

  // Store the group (which contains both mesh and light)
  return { mesh: group, light: pointLight };
}

function createChaser3D(color, x, y, px, py) {
  // Create a group to hold both the mesh and light
  const group = new THREE.Group();

  // Create chaser as a simple cube
  const geometry = new THREE.BoxGeometry(CHARACTER_SIZE, CHARACTER_SIZE, CHARACTER_SIZE);
  // All chasers are white
  const colorHex = 0xffffff; // White
  const material = new THREE.MeshStandardMaterial({
    color: colorHex,
    emissive: colorHex, // Match light color for better blending
    emissiveIntensity: 0.3, // Subtle glow
    roughness: 0.4,
    metalness: 0.1,
  });
  const chaser = new THREE.Mesh(geometry, material);
  chaser.position.set(0, 0, 0); // Position relative to group
  chaser.castShadow = false; // Don't cast shadows on floor to avoid artifacts
  chaser.receiveShadow = false; // Don't receive shadows
  group.add(chaser);

  // Create a point light as a child of the character group (white light)
  // Position light slightly above the character to avoid being inside the mesh
  const pointLight = new THREE.PointLight(colorHex, 100, 200);
  pointLight.position.set(0, CHARACTER_SIZE / 2 + 2, 0); // Position above the character mesh
  pointLight.castShadow = false; // Don't cast shadows from avatars
  pointLight.intensity = 100; // Default intensity
  pointLight.distance = 200; // Long range
  pointLight.decay = 1; // No decay (constant intensity)
  group.add(pointLight);

  // Set group position - in 3D, center characters on the floor tiles
  // Convert server's px/py (which use CHARACTER_OFFSET) to centered position
  // Or calculate from grid coordinates centered on the cell
  let posX, posZ;
  if (px !== undefined && py !== undefined) {
    // Server sends px/py with CHARACTER_OFFSET, convert to center of cell
    // px = x * CELL_SIZE + CHARACTER_OFFSET, we want x * CELL_SIZE + CELL_SIZE / 2
    // So: posX = px - CHARACTER_OFFSET + CELL_SIZE / 2
    posX = px - CHARACTER_OFFSET + CELL_SIZE / 2;
    posZ = py - CHARACTER_OFFSET + CELL_SIZE / 2;
  } else {
    // Calculate from grid coordinates, centered on cell
    posX = x * CELL_SIZE + CELL_SIZE / 2;
    posZ = y * CELL_SIZE + CELL_SIZE / 2;
  }
  group.position.set(posX, CHARACTER_SIZE / 2, posZ);
  scene.add(group);

  // Store the group (which contains both mesh and light)
  return { mesh: group, light: pointLight };
}

// Items system removed - not used

function getColorHex(colorName) {
  const colorMap = {
    red: 0xff0000,
    green: 0x00ff00,
    blue: 0x0000ff,
    yellow: 0xffff00,
  };
  return colorMap[colorName.toLowerCase()] || 0xffffff;
}

function updatePositions3D(positions) {
  // Update fugitives (server may still use "pacmen" name)
  const fugitivePositions = positions.fugitives || positions.pacmen || [];

  // Track which fugitive indices are currently active (not caught)
  const activeFugitiveIndices = new Set();

  fugitivePositions.forEach((pos, arrayIndex) => {
    // Use index from server if provided, otherwise use array index
    const index = pos.index !== undefined ? pos.index : arrayIndex;
    activeFugitiveIndices.add(index);

    if (!fugitives3D[index]) {
      // Use pixel coordinates if available for accurate positioning
      fugitives3D[index] = createFugitive3D(pos.color, pos.x, pos.y, pos.px, pos.py);
    } else {
      // Update group position - convert server's px/py (with CHARACTER_OFFSET) to centered position
      if (pos.px !== undefined && pos.py !== undefined) {
        fugitives3D[index].mesh.position.x = pos.px - CHARACTER_OFFSET + CELL_SIZE / 2;
        fugitives3D[index].mesh.position.z = pos.py - CHARACTER_OFFSET + CELL_SIZE / 2;
      } else {
        // Fallback to grid coordinates, centered
        fugitives3D[index].mesh.position.x = pos.x * CELL_SIZE + CELL_SIZE / 2;
        fugitives3D[index].mesh.position.z = pos.y * CELL_SIZE + CELL_SIZE / 2;
      }
    }
  });

  // Remove fugitives that are no longer active (caught and removed from game)
  fugitives3D.forEach((fugitive, index) => {
    if (fugitive && !activeFugitiveIndices.has(index)) {
      // Remove from scene
      if (fugitive.mesh) scene.remove(fugitive.mesh);
      // Clean up
      fugitives3D[index] = null;
    }
  });

  // Update chasers (server may still use "ghosts" name)
  // All chasers are white
  const chaserPositions = positions.chasers || positions.ghosts || [];

  // Track which chaser indices are currently active
  const activeChaserIndices = new Set();

  chaserPositions.forEach((pos, arrayIndex) => {
    // Use index from server if provided, otherwise use array index (for backward compatibility)
    const index = pos.index !== undefined ? pos.index : arrayIndex;
    activeChaserIndices.add(index);

    if (!chasers3D[index]) {
      // Use pixel coordinates if available for accurate positioning
      chasers3D[index] = createChaser3D("white", pos.x, pos.y, pos.px, pos.py);
    } else {
      // Update group position - convert server's px/py (with CHARACTER_OFFSET) to centered position
      if (pos.px !== undefined && pos.py !== undefined) {
        chasers3D[index].mesh.position.x = pos.px - CHARACTER_OFFSET + CELL_SIZE / 2;
        chasers3D[index].mesh.position.z = pos.py - CHARACTER_OFFSET + CELL_SIZE / 2;
      } else {
        // Fallback to grid coordinates, centered
        chasers3D[index].mesh.position.x = pos.x * CELL_SIZE + CELL_SIZE / 2;
        chasers3D[index].mesh.position.z = pos.y * CELL_SIZE + CELL_SIZE / 2;
      }
    }

    // Update opacity based on player control (20% if not controlled, 100% if controlled)
    // Check both server flag and local player identity (need to access myCharacterType and myColorIndex from game.js)
    const isPlayerControlled = pos.isPlayerControlled === true;
    // Get local player info from window (set by game.js)
    const isMyChaser =
      window.myCharacterType &&
      (window.myCharacterType === "chaser" || window.myCharacterType === "ghost") &&
      window.myColorIndex === index;
    const shouldBeFullOpacity = isPlayerControlled || isMyChaser;
    if (chasers3D[index] && chasers3D[index].mesh) {
      chasers3D[index].mesh.traverse((child) => {
        if (child instanceof THREE.Mesh && child.material) {
          child.material.opacity = shouldBeFullOpacity ? 1.0 : 0.2;
          child.material.transparent = true;
        }
      });
      // Also update point light intensity based on control
      if (chasers3D[index].mesh.children) {
        chasers3D[index].mesh.children.forEach((child) => {
          if (child instanceof THREE.PointLight) {
            child.intensity = shouldBeFullOpacity ? 100 : 20; // 20% of light intensity when not controlled
          }
        });
      }
    }
  });

  // Ensure all chasers are visible in 3D (create missing ones if needed)
  for (let i = 0; i < 4; i++) {
    if (!chasers3D[i] && !activeChaserIndices.has(i)) {
      // Create chaser at spawn position if it doesn't exist
      // Use default spawn positions (same as server uses)
      const defaultSpawnPositions = [
        { x: 11, y: 11 },
        { x: 12, y: 11 },
        { x: 13, y: 11 },
        { x: 14, y: 11 },
      ];
      const spawnPos = defaultSpawnPositions[i] || { x: 11 + i, y: 11 };
      chasers3D[i] = createChaser3D(
        "white",
        spawnPos.x,
        spawnPos.y,
        spawnPos.x * CELL_SIZE + CHARACTER_OFFSET,
        spawnPos.y * CELL_SIZE + CHARACTER_OFFSET
      );
      // Set initial opacity to 20% (not player-controlled)
      if (chasers3D[i] && chasers3D[i].mesh) {
        chasers3D[i].mesh.traverse((child) => {
          if (child instanceof THREE.Mesh && child.material) {
            child.material.opacity = 0.2;
            child.material.transparent = true;
          }
        });
        // Set light intensity to 20%
        if (chasers3D[i].mesh.children) {
          chasers3D[i].mesh.children.forEach((child) => {
            if (child instanceof THREE.PointLight) {
              child.intensity = 20;
            }
          });
        }
      }
    } else if (chasers3D[i] && !activeChaserIndices.has(i)) {
      // Chaser exists but not in active list - set to 20% opacity
      if (chasers3D[i].mesh) {
        chasers3D[i].mesh.traverse((child) => {
          if (child instanceof THREE.Mesh && child.material) {
            child.material.opacity = 0.2;
            child.material.transparent = true;
          }
        });
        if (chasers3D[i].mesh.children) {
          chasers3D[i].mesh.children.forEach((child) => {
            if (child instanceof THREE.PointLight) {
              child.intensity = 20;
            }
          });
        }
      }
    }
  }

  // Remove chasers that are no longer active (not selected by anyone)
  chasers3D.forEach((chaser, index) => {
    if (chaser && !activeChaserIndices.has(index)) {
      // Remove from scene
      if (chaser.mesh) scene.remove(chaser.mesh);
      // Clean up
      chasers3D[index] = null;
    }
  });
}

// Items system removed - not used

function onWindowResize3D() {
  if (!camera || !renderer) return;

  const aspect = window.innerWidth / window.innerHeight;

  if (useOrthographic && orthographicCamera) {
    // Update orthographic camera bounds
    const viewSize = baseViewSize * cameraZoom;
    if (aspect >= 1) {
      orthographicCamera.left = (-viewSize * aspect) / 2;
      orthographicCamera.right = (viewSize * aspect) / 2;
      orthographicCamera.top = viewSize / 2;
      orthographicCamera.bottom = -viewSize / 2;
    } else {
      orthographicCamera.left = -viewSize / 2;
      orthographicCamera.right = viewSize / 2;
      orthographicCamera.top = viewSize / aspect / 2;
      orthographicCamera.bottom = -viewSize / aspect / 2;
    }
    orthographicCamera.updateProjectionMatrix();
  } else if (perspectiveCamera) {
    perspectiveCamera.aspect = aspect;
    perspectiveCamera.zoom = cameraZoom;
    perspectiveCamera.updateProjectionMatrix();
  }

  renderer.setSize(window.innerWidth, window.innerHeight);
}

function setCameraZoom(zoom) {
  cameraZoom = zoom;
  onWindowResize3D(); // Update camera with new zoom
}

function toggleCamera() {
  useOrthographic = !useOrthographic;
  if (useOrthographic) {
    camera = orthographicCamera;
  } else {
    camera = perspectiveCamera;
  }
  onWindowResize3D(); // Update camera settings
  return useOrthographic;
}

function render3D() {
  if (renderer && scene && camera) {
    renderer.render(scene, camera);
  }
}

function cleanup3D() {
  // Remove all 3D objects
  fugitives3D.forEach((fugitive) => {
    if (fugitive && fugitive.mesh) scene.remove(fugitive.mesh);
    if (fugitive && fugitive.light) scene.remove(fugitive.light);
  });
  chasers3D.forEach((chaser) => {
    if (chaser && chaser.mesh) scene.remove(chaser.mesh);
    if (chaser && chaser.light) scene.remove(chaser.light);
  });
  mazeVoxels.forEach((voxel) => scene.remove(voxel));

  fugitives3D = [];
  chasers3D = [];
  mazeVoxels = [];

  if (renderer) {
    renderer.dispose();
    renderer = null;
  }

  scene = null;
  camera = null;
}

// Light intensity control functions
function setAmbientLightIntensity(intensity) {
  if (ambientLight3D) {
    ambientLight3D.intensity = intensity;
  }
}

function setDirectionalLightIntensity(intensity) {
  if (directionalLight3D) {
    directionalLight3D.intensity = intensity;
  }
}

function setPointLightIntensity(intensity) {
  // Update all fugitive lights
  fugitives3D.forEach((fugitive) => {
    if (fugitive && fugitive.light) {
      fugitive.light.intensity = intensity;
    }
  });
  // Update all chaser lights
  chasers3D.forEach((chaser) => {
    if (chaser && chaser.light) {
      chaser.light.intensity = intensity;
    }
  });
}

function setInnerWallColor(colorHex) {
  if (innerWallMaterial3D) {
    innerWallMaterial3D.color.set(colorHex);
  }
}

function setOuterWallColor(colorHex) {
  if (outerWallMaterial3D) {
    outerWallMaterial3D.color.set(colorHex);
  }
}

function setPathColor(colorHex) {
  if (floorMaterial3D) {
    floorMaterial3D.color.set(colorHex);
  }
}

function setTeamImage(colorIndex, imagePath) {
  // Store team image for this color index (empty string means no image)
  if (colorIndex >= 0 && colorIndex < 4) {
    teamImages[colorIndex] = imagePath;

    // Update existing fugitive of this color
    if (fugitives3D[colorIndex] && fugitives3D[colorIndex].mesh) {
      const fugitive = fugitives3D[colorIndex];
      fugitive.mesh.children.forEach((child) => {
        if (child instanceof THREE.Mesh && child.material) {
          if (imagePath && imagePath.trim() !== "") {
            // Load and apply texture
            const textureLoader = new THREE.TextureLoader();
            const texture = textureLoader.load(imagePath);
            child.material.map = texture;
            child.material.color.setHex(0xffffff); // Use white to show texture colors
            child.material.needsUpdate = true;
          } else {
            // Remove texture, use color
            child.material.map = null;
            const colorHex =
              colorOverrides[colorIndex] !== null ? new THREE.Color(colorOverrides[colorIndex]).getHex() : getColorHex(COLORS[colorIndex]);
            child.material.color.setHex(colorHex);
            child.material.needsUpdate = true;
          }
        }
      });
    }
  }
}

function setColorOverride(colorIndex, colorHex) {
  // Store color override for this color index (null means use individual colors)
  if (colorIndex >= 0 && colorIndex < 4) {
    colorOverrides[colorIndex] = colorHex;

    // Convert hex string to THREE.Color if not null
    const color = colorHex !== null ? new THREE.Color(colorHex) : null;
    const targetColorName = COLORS[colorIndex];

    // Update all existing fugitives of this color
    // We need to check positions to find which fugitive has this color
    // For now, update by index (index should match color index based on spawn order)
    if (fugitives3D[colorIndex] && fugitives3D[colorIndex].mesh) {
      const fugitive = fugitives3D[colorIndex];
      fugitive.mesh.children.forEach((child) => {
        if (child instanceof THREE.Mesh && child.material) {
          // Only update color if not using texture
          if (!child.material.map) {
            if (color) {
              child.material.color.copy(color);
            } else {
              // Reset to original color
              const originalColor = getColorHex(targetColorName);
              child.material.color.setHex(originalColor);
            }
          }
        }
        if (child instanceof THREE.PointLight) {
          if (color) {
            child.color.copy(color);
          } else {
            // Reset to original color
            const originalColor = getColorHex(targetColorName);
            child.color.setHex(originalColor);
          }
        }
      });
    }

    // Update all existing chasers of this color
    if (chasers3D[colorIndex] && chasers3D[colorIndex].mesh) {
      const chaser = chasers3D[colorIndex];
      chaser.mesh.children.forEach((child) => {
        if (child instanceof THREE.Mesh && child.material) {
          if (color) {
            child.material.color.copy(color);
          } else {
            // Reset to original color
            const originalColor = getColorHex(targetColorName);
            child.material.color.setHex(originalColor);
          }
        }
        if (child instanceof THREE.PointLight) {
          if (color) {
            child.color.copy(color);
          } else {
            // Reset to original color
            const originalColor = getColorHex(targetColorName);
            child.color.setHex(originalColor);
          }
        }
      });
    }
  }
}

// Export functions for use in game.js
window.render3D = {
  init: init3D,
  updatePositions: updatePositions3D,
  updateChaserOpacity: (chaserIndex, opacity) => {
    if (chasers3D[chaserIndex] && chasers3D[chaserIndex].mesh) {
      chasers3D[chaserIndex].mesh.traverse((child) => {
        if (child instanceof THREE.Mesh && child.material) {
          child.material.opacity = opacity;
          child.material.transparent = true;
        }
      });
      // Also update point light intensity based on opacity
      if (chasers3D[chaserIndex].mesh.children) {
        chasers3D[chaserIndex].mesh.children.forEach((child) => {
          if (child instanceof THREE.PointLight) {
            child.intensity = opacity === 1.0 ? 100 : 20;
          }
        });
      }
    }
  },
  render: render3D,
  cleanup: cleanup3D,
  onResize: onWindowResize3D,
  toggleCamera: toggleCamera,
  setCameraType: (isOrthographic) => {
    if (isOrthographic !== useOrthographic) {
      useOrthographic = isOrthographic;
      if (useOrthographic) {
        camera = orthographicCamera;
      } else {
        camera = perspectiveCamera;
      }
      onWindowResize3D();
    }
  },
  setAmbientLight: setAmbientLightIntensity,
  setDirectionalLight: setDirectionalLightIntensity,
  setPointLightIntensity: setPointLightIntensity,
  setInnerWallColor: setInnerWallColor,
  setOuterWallColor: setOuterWallColor,
  setPathColor: setPathColor,
  setColorOverride: setColorOverride,
  setTeamImage: setTeamImage,
  setCameraZoom: setCameraZoom,
  useOrthographic: () => useOrthographic,
  initialized: false,
};
