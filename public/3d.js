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
let fugitives3D = [];
let chasers3D = [];
let items3D = [];
let mazeVoxels = [];
let fugitiveLights = []; // Point lights for fugitives
let chaserLights = []; // Point lights for chasers
let ambientLight3D, directionalLight3D; // Global lights for intensity control
let innerWallMaterial3D, outerWallMaterial3D, floorMaterial3D, teleportMaterial3D; // Materials for color control

// Initialize 3D rendering
function init3D() {
  // Scene
  scene = new THREE.Scene();
  scene.background = new THREE.Color(0x000000);

  // Create both orthographic and perspective cameras
  const viewSize = Math.max(COLS * CELL_SIZE, ROWS * CELL_SIZE) * 1.2;
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
  renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.shadowMap.enabled = true; // Enable shadows so lights are blocked by walls
  renderer.shadowMap.type = THREE.PCFSoftShadowMap; // Soft shadows

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
      if (cellType === 0 || cellType === 2) {
        // Path or teleport - create floor voxels
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
  floor.position.set(worldX, 0, worldZ);
  floor.castShadow = false; // Floors don't cast shadows
  floor.receiveShadow = true; // Floors receive shadows from walls and characters
  scene.add(floor);
  mazeVoxels.push(floor);
}

function createFugitive3D(color, x, y) {
  // Create a group to hold both the mesh and light
  const group = new THREE.Group();

  // Create fugitive as a simple sphere
  const geometry = new THREE.SphereGeometry(CHARACTER_SIZE / 2, 16, 16);
  const colorHex = getColorHex(color);
  const material = new THREE.MeshStandardMaterial({
    color: colorHex,
    emissive: 0x000000, // No emissive - rely on lights
    roughness: 0.4,
    metalness: 0.1,
  });
  const fugitive = new THREE.Mesh(geometry, material);
  fugitive.position.set(0, 0, 0); // Position relative to group
  fugitive.castShadow = false; // Don't cast shadows on floor to avoid artifacts
  fugitive.receiveShadow = false; // Don't receive shadows
  group.add(fugitive);

  // Create a point light as a child of the character group
  const pointLight = new THREE.PointLight(colorHex, 40, 200);
  pointLight.position.set(0, CHARACTER_SIZE / 2 + 2, 0); // Position relative to group, closer to character
  pointLight.castShadow = true; // Enable shadows so light is blocked by walls
  pointLight.shadow.mapSize.width = 2048; // Higher shadow map resolution for better quality
  pointLight.shadow.mapSize.height = 2048;
  pointLight.shadow.camera.near = 0.5; // Increased near plane to avoid self-shadowing
  pointLight.shadow.camera.far = 200;
  pointLight.shadow.bias = 0.001; // Increased bias to prevent shadow acne
  pointLight.shadow.normalBias = 0.05; // Increased normal bias
  pointLight.shadow.radius = 8; // Larger soft shadow radius
  pointLight.intensity = 40; // Default intensity
  pointLight.distance = 200; // Long range
  pointLight.decay = 1; // No decay (constant intensity)
  group.add(pointLight);

  // Set group position
  group.position.set(x * CELL_SIZE + CHARACTER_OFFSET, CHARACTER_SIZE / 2, y * CELL_SIZE + CHARACTER_OFFSET);
  scene.add(group);

  // Store the group (which contains both mesh and light)
  return { mesh: group, light: pointLight };
}

function createChaser3D(color, x, y) {
  // Create a group to hold both the mesh and light
  const group = new THREE.Group();

  // Create chaser as a simple cube
  const geometry = new THREE.BoxGeometry(CHARACTER_SIZE, CHARACTER_SIZE, CHARACTER_SIZE);
  const colorHex = getColorHex(color);
  const material = new THREE.MeshStandardMaterial({
    color: colorHex,
    emissive: 0x000000, // No emissive - rely on lights
    roughness: 0.4,
    metalness: 0.1,
  });
  const chaser = new THREE.Mesh(geometry, material);
  chaser.position.set(0, 0, 0); // Position relative to group
  chaser.castShadow = false; // Don't cast shadows on floor to avoid artifacts
  chaser.receiveShadow = false; // Don't receive shadows
  group.add(chaser);

  // Create a point light as a child of the character group
  const pointLight = new THREE.PointLight(colorHex, 40, 200);
  pointLight.position.set(0, CHARACTER_SIZE / 2 + 2, 0); // Position relative to group, closer to character
  pointLight.castShadow = true; // Enable shadows so light is blocked by walls
  pointLight.shadow.mapSize.width = 2048; // Higher shadow map resolution for better quality
  pointLight.shadow.mapSize.height = 2048;
  pointLight.shadow.camera.near = 0.5; // Increased near plane to avoid self-shadowing
  pointLight.shadow.camera.far = 200;
  pointLight.shadow.bias = 0.001; // Increased bias to prevent shadow acne
  pointLight.shadow.normalBias = 0.05; // Increased normal bias
  pointLight.shadow.radius = 8; // Larger soft shadow radius
  pointLight.intensity = 40; // Default intensity
  pointLight.distance = 200; // Long range
  pointLight.decay = 1; // No decay (constant intensity)
  group.add(pointLight);

  // Set group position
  group.position.set(x * CELL_SIZE + CHARACTER_OFFSET, CHARACTER_SIZE / 2, y * CELL_SIZE + CHARACTER_OFFSET);
  scene.add(group);

  // Store the group (which contains both mesh and light)
  return { mesh: group, light: pointLight };
}

function createItem3D(x, y) {
  // Create item as a small voxel cube
  const itemSize = 3;
  const voxelGeometry = new THREE.BoxGeometry(itemSize, itemSize, itemSize);
  const voxelMaterial = new THREE.MeshStandardMaterial({
    color: 0xffff00,
    emissive: 0xffff00,
    emissiveIntensity: 1.0,
  });
  const item = new THREE.Mesh(voxelGeometry, voxelMaterial);
  item.position.set(x * CELL_SIZE + CHARACTER_OFFSET, itemSize / 2 + 2, y * CELL_SIZE + CHARACTER_OFFSET);
  scene.add(item);
  return item;
}

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
  fugitivePositions.forEach((pos, index) => {
    if (!fugitives3D[index]) {
      fugitives3D[index] = createFugitive3D(pos.color, pos.x, pos.y);
    } else {
      // Update group position (light moves automatically as child)
      fugitives3D[index].mesh.position.x = pos.px;
      fugitives3D[index].mesh.position.z = pos.py;
    }
  });

  // Update chasers (server may still use "ghosts" name)
  const chaserPositions = positions.chasers || positions.ghosts || [];
  chaserPositions.forEach((pos, index) => {
    if (!chasers3D[index]) {
      chasers3D[index] = createChaser3D(pos.color, pos.x, pos.y);
    } else {
      // Update group position (light moves automatically as child)
      chasers3D[index].mesh.position.x = pos.px;
      chasers3D[index].mesh.position.z = pos.py;
    }
  });
}

function updateItems3D(itemsData) {
  // Remove old items
  items3D.forEach((item) => scene.remove(item));
  items3D = [];

  // Create new items
  if (itemsData) {
    itemsData.forEach((itemData) => {
      if (!itemData.collected) {
        const item = createItem3D(itemData.x, itemData.y);
        items3D.push(item);
      }
    });
  }
}

function onWindowResize3D() {
  if (!camera || !renderer) return;

  const aspect = window.innerWidth / window.innerHeight;

  if (useOrthographic && orthographicCamera) {
    // Update orthographic camera bounds
    const viewSize = Math.max(COLS * CELL_SIZE, ROWS * CELL_SIZE) * 1.2;
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
    perspectiveCamera.updateProjectionMatrix();
  }

  renderer.setSize(window.innerWidth, window.innerHeight);
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
  items3D.forEach((item) => scene.remove(item));
  mazeVoxels.forEach((voxel) => scene.remove(voxel));

  fugitives3D = [];
  chasers3D = [];
  items3D = [];
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

// Export functions for use in game.js
window.render3D = {
  init: init3D,
  updatePositions: updatePositions3D,
  updateItems: updateItems3D,
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
  useOrthographic: () => useOrthographic,
  initialized: false,
};
