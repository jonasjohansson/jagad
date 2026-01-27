// 3D Demo Viewer - View 3D models on top of the building
import * as THREE from "../assets/lib/three/three.module.js";
import { GLTFLoader } from "../assets/lib/three/addons/loaders/GLTFLoader.js";
import { OBJLoader } from "../assets/lib/three/addons/loaders/OBJLoader.js";
import { OrbitControls } from "../assets/lib/three/addons/controls/OrbitControls.js";
import { EffectComposer } from "../assets/lib/three/addons/postprocessing/EffectComposer.js";
import { RenderPass } from "../assets/lib/three/addons/postprocessing/RenderPass.js";
import { UnrealBloomPass } from "../assets/lib/three/addons/postprocessing/UnrealBloomPass.js";
import { OutputPass } from "../assets/lib/three/addons/postprocessing/OutputPass.js";
import { ShaderPass } from "../assets/lib/three/addons/postprocessing/ShaderPass.js";
import { FXAAShader } from "../assets/lib/three/addons/shaders/FXAAShader.js";

// Scene setup
let scene, camera, renderer, controls;
let loadedModel = null;
let guiLeft = null;
let guiRight = null;
let composer = null;

// Building platform - sized to match the building image dimensions
const BUILDING_WIDTH = 300;
const BUILDING_DEPTH = 300;
const BUILDING_HEIGHT = 10;

// Camera settings
const cameraSettings = {
  // Default: almost top-down, perspective but ortho-like
  distance: 0,      // directly above center
  height: 50,       // closer to the building by default
  angle: 0,         // kept for potential future use
  fov: 30,          // narrower FOV for more ortho-like look
};

// Model settings
const modelSettings = {
  positionX: -0.9,
  positionY: 0,
  positionZ: -0.9,
  rotationX: -90, // look straight down by default
  rotationY: 0,
  rotationZ: 0,
  scale: 6,
  color: '#ff0000',
  wireframe: false,
  visible: true
};

// Lighting settings
const lightingSettings = {
  ambientIntensity: 1,
  ambientColor: '#ffffff',
  directionalIntensity: 0,
  directionalColor: '#ffffff',
  directionalX: 100,
  directionalY: 200,
  directionalZ: 100,
  hemisphereIntensity: 0.5,
  hemisphereSkyColor: '#87ceeb',
  hemisphereGroundColor: '#545454'
};

// Post-processing settings
const postSettings = {
  bloomEnabled: false,
  bloomThreshold: 0.5,
  bloomStrength: 0.4,
  bloomRadius: 1.0,
  fxaaEnabled: false
};

// Canvas blending settings (CSS mix-blend-mode for the WebGL canvas)
const canvasSettings = {
  blendMode: 'hard-light', // matches default in CSS
};

// Helper visibility settings
const helperSettings = {
  showGrid: false,
  showAxes: false,
};

// Cursor light settings (point light that follows the cursor)
const cursorLightSettings = {
  enabled: true,
  color: '#ffffff',
  intensity: 2.0,
  distance: 200,
};

// Lights
let ambientLight, directionalLight, hemisphereLight, cursorLight;
// Helpers
let gridHelper, axesHelper;
// Cursor-following light helpers
let roadY = BUILDING_HEIGHT; // Y plane where the road (and cursor light) lives
const raycaster = new THREE.Raycaster();
const mouse = new THREE.Vector2();
let renderPass, bloomPass, fxaaPass, outputPass;

// Initialize the scene
function init() {
  // Scene
  scene = new THREE.Scene();
  scene.background = null; // Transparent to show building image

  // Get container dimensions
  const container = document.getElementById("game-view-container");
  const width = container.clientWidth;
  const height = container.clientHeight;
  const aspect = width / height;

  // Camera - positioned to view from above at an angle
  camera = new THREE.PerspectiveCamera(cameraSettings.fov, aspect, 1, 3000);
  updateCameraPosition();

  // Renderer
  const canvas = document.getElementById("webgl-canvas");
  renderer = new THREE.WebGLRenderer({ 
    canvas, 
    antialias: true, 
    alpha: true,
    powerPreference: "high-performance"
  });
  renderer.setSize(width, height);
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setClearColor(0x000000, 0); // Transparent
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;

  // Apply initial canvas blend mode (CSS mix-blend-mode)
  updateCanvasBlendMode();

  // OrbitControls for free camera movement
  controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  controls.dampingFactor = 0.05;
  controls.target.set(0, BUILDING_HEIGHT + 30, 0);
  controls.minDistance = 100;
  controls.maxDistance = 1000;
  controls.maxPolarAngle = Math.PI / 2.1; // Don't go too far below

  // Lights
  ambientLight = new THREE.AmbientLight(
    lightingSettings.ambientColor, 
    lightingSettings.ambientIntensity
  );
  scene.add(ambientLight);

  directionalLight = new THREE.DirectionalLight(
    lightingSettings.directionalColor,
    lightingSettings.directionalIntensity
  );
  directionalLight.position.set(
    lightingSettings.directionalX,
    lightingSettings.directionalY,
    lightingSettings.directionalZ
  );
  directionalLight.castShadow = true;
  directionalLight.shadow.mapSize.width = 2048;
  directionalLight.shadow.mapSize.height = 2048;
  directionalLight.shadow.camera.near = 10;
  directionalLight.shadow.camera.far = 1000;
  directionalLight.shadow.camera.left = -300;
  directionalLight.shadow.camera.right = 300;
  directionalLight.shadow.camera.top = 300;
  directionalLight.shadow.camera.bottom = -300;
  scene.add(directionalLight);

  hemisphereLight = new THREE.HemisphereLight(
    lightingSettings.hemisphereSkyColor,
    lightingSettings.hemisphereGroundColor,
    lightingSettings.hemisphereIntensity
  );
  scene.add(hemisphereLight);

  // Cursor-following point light (starts at road height, updated later from model)
  cursorLight = new THREE.PointLight(
    cursorLightSettings.color,
    cursorLightSettings.intensity,
    cursorLightSettings.distance
  );
  cursorLight.position.set(0, roadY, 0);
  cursorLight.castShadow = true;
  cursorLight.visible = cursorLightSettings.enabled;
  scene.add(cursorLight);

  // Create building platform
  createBuilding();

  // Post-processing
  initPostProcessing();

  // GUI
  initGUI();

  // File drop handling
  setupFileHandling();

  // Resize handler
  window.addEventListener('resize', onWindowResize);

  // Try to load default demo model on startup (will fail if server forbids .gltf URLs)
  loadDefaultModel();

  // Animation loop
  animate();
}

function createBuilding() {
  // Building platform (top of the building) - invisible but receives shadows
  const geometry = new THREE.BoxGeometry(BUILDING_WIDTH, BUILDING_HEIGHT, BUILDING_DEPTH);
  const material = new THREE.MeshStandardMaterial({
    color: 0x333333,
    roughness: 0.9,
    metalness: 0.1,
    transparent: true,
    opacity: 0.3 // Semi-transparent so we can see the building image through it
  });
  const building = new THREE.Mesh(geometry, material);
  building.position.y = BUILDING_HEIGHT / 2;
  building.receiveShadow = true;
  building.castShadow = false;
  scene.add(building);

  // Grid helper on top of building for reference
  gridHelper = new THREE.GridHelper(
    BUILDING_WIDTH * 1.1, 
    30, 
    0x00ff00, 
    0x444444
  );
  gridHelper.position.y = BUILDING_HEIGHT + 0.5;
  scene.add(gridHelper);

  // Axes helper for orientation
  axesHelper = new THREE.AxesHelper(80);
  axesHelper.position.y = BUILDING_HEIGHT;
  scene.add(axesHelper);

  // Apply initial helper visibility based on default settings
  updateHelpersVisibility();
}

function createTestCube() {
  // Create a simple rotating cube as a test object
  const geometry = new THREE.BoxGeometry(40, 60, 40);
  const material = new THREE.MeshStandardMaterial({
    color: modelSettings.color,
    roughness: 0.5,
    metalness: 0.3
  });
  
  loadedModel = new THREE.Mesh(geometry, material);
  loadedModel.position.set(
    modelSettings.positionX,
    BUILDING_HEIGHT + 30, // Place on top of building
    modelSettings.positionZ
  );
  loadedModel.castShadow = true;
  loadedModel.receiveShadow = true;
  
  scene.add(loadedModel);
  
  console.log('Test cube created on building');
}

function initPostProcessing() {
  const container = document.getElementById("game-view-container");
  const width = container.clientWidth;
  const height = container.clientHeight;

  const renderTarget = new THREE.WebGLRenderTarget(width, height, {
    type: THREE.HalfFloatType,
    samples: 4
  });

  composer = new EffectComposer(renderer, renderTarget);

  renderPass = new RenderPass(scene, camera);
  composer.addPass(renderPass);

  const resolution = new THREE.Vector2(width, height);
  bloomPass = new UnrealBloomPass(
    resolution,
    postSettings.bloomStrength,
    postSettings.bloomRadius,
    postSettings.bloomThreshold
  );

  fxaaPass = new ShaderPass(FXAAShader);
  const pixelRatio = renderer.getPixelRatio();
  fxaaPass.material.uniforms['resolution'].value.x = 1 / (width * pixelRatio);
  fxaaPass.material.uniforms['resolution'].value.y = 1 / (height * pixelRatio);

  outputPass = new OutputPass();
  composer.addPass(outputPass);

  updatePostProcessing();
}

function updatePostProcessing() {
  if (!composer) return;

  // Remove all passes except renderPass
  while (composer.passes.length > 1) {
    composer.passes.pop();
  }

  // Re-add based on settings
  if (postSettings.bloomEnabled) {
    bloomPass.threshold = postSettings.bloomThreshold;
    bloomPass.strength = postSettings.bloomStrength;
    bloomPass.radius = postSettings.bloomRadius;
    composer.addPass(bloomPass);
  }

  if (postSettings.fxaaEnabled) {
    composer.addPass(fxaaPass);
  }

  composer.addPass(outputPass);
}

function initGUI() {
  guiLeft = new lil.GUI({ container: document.getElementById('gui-left') });
  guiLeft.title('Camera & Model');

  guiRight = new lil.GUI({ container: document.getElementById('gui-right') });
  guiRight.title('Lighting & FX');

  // Camera folder (left)
  const cameraFolder = guiLeft.addFolder('Camera');
  cameraFolder.add(cameraSettings, 'distance', 100, 800).name('Distance').onChange(updateCameraPosition);
  cameraFolder.add(cameraSettings, 'height', 50, 500).name('Height').onChange(updateCameraPosition);
  cameraFolder.add(cameraSettings, 'angle', 0, 360).name('Angle (deg)').onChange(updateCameraPosition);
  cameraFolder.add(cameraSettings, 'fov', 20, 120).name('FOV').onChange(() => {
    camera.fov = cameraSettings.fov;
    camera.updateProjectionMatrix();
  });
  cameraFolder.add({ reset: resetCamera }, 'reset').name('Reset Camera');
  cameraFolder.open();

  // Model folder (left)
  const modelFolder = guiLeft.addFolder('Model Transform');
  modelFolder.add(modelSettings, 'positionX', -150, 150).name('Position X').onChange(updateModel);
  modelFolder.add(modelSettings, 'positionY', 0, 300).name('Position Y').onChange(updateModel);
  modelFolder.add(modelSettings, 'positionZ', -150, 150).name('Position Z').onChange(updateModel);
  modelFolder.add(modelSettings, 'rotationX', -360, 360).name('Rotation X (deg)').onChange(updateModel);
  modelFolder.add(modelSettings, 'rotationY', -360, 360).name('Rotation Y (deg)').onChange(updateModel);
  modelFolder.add(modelSettings, 'rotationZ', -360, 360).name('Rotation Z (deg)').onChange(updateModel);
  modelFolder.add(modelSettings, 'scale', 0.01, 100).name('Scale').onChange(updateModel);
  modelFolder.addColor(modelSettings, 'color').name('Color').onChange(updateModelColor);
  modelFolder.add(modelSettings, 'wireframe').name('Wireframe').onChange(updateModelMaterial);
  modelFolder.add(modelSettings, 'visible').name('Visible').onChange(updateModel);
  modelFolder.add({ center: centerModel }, 'center').name('Center on Building');
  modelFolder.add({ clear: clearModel }, 'clear').name('Clear Model');
  modelFolder.open();
  
  // Lighting folder (right)
  const lightingFolder = guiRight.addFolder('Lighting');
  
  const ambientFolder = lightingFolder.addFolder('Ambient Light');
  ambientFolder.add(lightingSettings, 'ambientIntensity', 0, 2).name('Intensity').onChange((value) => {
    ambientLight.intensity = value;
  });
  ambientFolder.addColor(lightingSettings, 'ambientColor').name('Color').onChange((value) => {
    ambientLight.color.set(value);
  });
  
  const directionalFolder = lightingFolder.addFolder('Directional Light');
  directionalFolder.add(lightingSettings, 'directionalIntensity', 0, 3).name('Intensity').onChange((value) => {
    directionalLight.intensity = value;
  });
  directionalFolder.addColor(lightingSettings, 'directionalColor').name('Color').onChange((value) => {
    directionalLight.color.set(value);
  });
  directionalFolder.add(lightingSettings, 'directionalX', -300, 300).name('Position X').onChange((value) => {
    directionalLight.position.x = value;
  });
  directionalFolder.add(lightingSettings, 'directionalY', 50, 500).name('Position Y').onChange((value) => {
    directionalLight.position.y = value;
  });
  directionalFolder.add(lightingSettings, 'directionalZ', -300, 300).name('Position Z').onChange((value) => {
    directionalLight.position.z = value;
  });
  
  const hemisphereFolder = lightingFolder.addFolder('Hemisphere Light');
  hemisphereFolder.add(lightingSettings, 'hemisphereIntensity', 0, 2).name('Intensity').onChange((value) => {
    hemisphereLight.intensity = value;
  });
  hemisphereFolder.addColor(lightingSettings, 'hemisphereSkyColor').name('Sky Color').onChange((value) => {
    hemisphereLight.color.set(value);
  });
  hemisphereFolder.addColor(lightingSettings, 'hemisphereGroundColor').name('Ground Color').onChange((value) => {
    hemisphereLight.groundColor.set(value);
  });
  
  lightingFolder.open();

  // Post-processing folder (right)
  const postFolder = guiRight.addFolder('Post-Processing');
  
  const bloomFolder = postFolder.addFolder('Bloom (Glow)');
  bloomFolder.add(postSettings, 'bloomEnabled').name('Enable Bloom').onChange(updatePostProcessing);
  bloomFolder.add(postSettings, 'bloomThreshold', 0, 1, 0.01).name('Threshold').onChange((value) => {
    if (bloomPass) bloomPass.threshold = value;
  });
  bloomFolder.add(postSettings, 'bloomStrength', 0, 3, 0.1).name('Strength').onChange((value) => {
    if (bloomPass) bloomPass.strength = value;
  });
  bloomFolder.add(postSettings, 'bloomRadius', 0, 1, 0.01).name('Radius').onChange((value) => {
    if (bloomPass) bloomPass.radius = value;
  });
  
  postFolder.add(postSettings, 'fxaaEnabled').name('FXAA Anti-Aliasing').onChange(updatePostProcessing);

  // Cursor light folder (right)
  const cursorLightFolder = guiRight.addFolder('Cursor Light');
  cursorLightFolder.add(cursorLightSettings, 'enabled').name('Enabled').onChange(updateCursorLightFromSettings);
  cursorLightFolder.addColor(cursorLightSettings, 'color').name('Color').onChange(updateCursorLightFromSettings);
  cursorLightFolder.add(cursorLightSettings, 'intensity', 0, 110).name('Intensity').onChange(updateCursorLightFromSettings);
  cursorLightFolder.add(cursorLightSettings, 'distance', 10, 500).name('Distance').onChange(updateCursorLightFromSettings);
  cursorLightFolder.open();

  // Helper visibility folder (grid & axes, right)
  const helperFolder = guiRight.addFolder('Helpers');
  helperFolder.add(helperSettings, 'showGrid').name('Show Grid').onChange(updateHelpersVisibility);
  helperFolder.add(helperSettings, 'showAxes').name('Show Axes').onChange(updateHelpersVisibility);
  helperFolder.open();

  // Canvas blending folder (CSS mix-blend-mode, right)
  const blendFolder = guiRight.addFolder('Canvas Blending');
  blendFolder.add(canvasSettings, 'blendMode', [
    'normal',
    'multiply',
    'screen',
    'overlay',
    'soft-light',
    'hard-light',
    'difference',
    'exclusion',
    'color-burn',
    'color-dodge',
    'lighten',
    'darken'
  ]).name('Blend Mode').onChange(updateCanvasBlendMode);
  blendFolder.open();
}

function updateCameraPosition() {
  if (!camera) return;
  
  const angleRad = (cameraSettings.angle * Math.PI) / 180;
  const x = Math.cos(angleRad) * cameraSettings.distance;
  const z = Math.sin(angleRad) * cameraSettings.distance;
  camera.position.set(x, cameraSettings.height, z);
  
  // Controls are created after the first call from init()
  if (controls) {
    controls.target.set(0, BUILDING_HEIGHT + 30, 0);
    controls.update();
  }
}

function resetCamera() {
  // Reset to default top-down, perspective-but-ortho-like view
  cameraSettings.distance = 0;
  cameraSettings.height = 800;
  cameraSettings.angle = 0;
  cameraSettings.fov = 30;
  camera.fov = cameraSettings.fov;
  camera.updateProjectionMatrix();
  updateCameraPosition();
  
  // Update GUI
  [guiLeft, guiRight].forEach(g => {
    if (g) g.controllersRecursive().forEach(controller => controller.updateDisplay());
  });
}

function setupFileHandling() {
  const dropZone = document.getElementById('drop-zone');
  const fileInput = document.getElementById('file-input');

  // Click to open file dialog
  dropZone.addEventListener('click', () => {
    fileInput.click();
  });

  // File input change
  fileInput.addEventListener('change', (e) => {
    const file = e.target.files[0];
    if (file) {
      loadModelFile(file);
    }
  });

  // Drag and drop
  dropZone.addEventListener('dragover', (e) => {
    e.preventDefault();
    dropZone.classList.add('dragover');
  });

  dropZone.addEventListener('dragleave', () => {
    dropZone.classList.remove('dragover');
  });

  dropZone.addEventListener('drop', (e) => {
    e.preventDefault();
    dropZone.classList.remove('dragover');
    
    const file = e.dataTransfer.files[0];
    if (file) {
      loadModelFile(file);
    }
  });

  // Cursor movement over canvas to move the cursor light
  const canvas = document.getElementById('webgl-canvas');
  if (canvas) {
    canvas.addEventListener('mousemove', onCanvasPointerMove);
  }
}

function loadModelFile(file) {
  const fileName = file.name.toLowerCase();
  const extension = fileName.split('.').pop();

  console.log('Loading file:', fileName);

  const reader = new FileReader();
  reader.onload = (e) => {
    const data = e.target.result;
    
    // Hide drop zone
    document.getElementById('drop-zone').classList.add('hidden');

    // Load based on file type
    if (extension === 'glb' || extension === 'gltf') {
      loadGLTF(data);
    } else if (extension === 'obj') {
      loadOBJ(data);
    } else {
      alert('Unsupported file format: ' + extension + '. Supported: GLB, GLTF, OBJ');
      document.getElementById('drop-zone').classList.remove('hidden');
    }
  };

  if (extension === 'glb') {
    reader.readAsArrayBuffer(file);
  } else {
    reader.readAsText(file);
  }
}

function loadGLTF(data) {
  const loader = new GLTFLoader();
  
  loader.parse(data, '', (gltf) => {
    // Remove any existing model but keep the scene state
    removeModelOnly();
    loadedModel = gltf.scene;
    loadedModel.position.set(
      modelSettings.positionX,
      modelSettings.positionY,
      modelSettings.positionZ
    );
    
    // Enable shadows
    loadedModel.traverse((child) => {
      if (child.isMesh) {
        child.castShadow = true;
        child.receiveShadow = true;
      }
    });
    
    scene.add(loadedModel);
    centerModel();
    updateRoadHeightFromModel();

    // Hide drop zone after successful load
    const dropZone = document.getElementById('drop-zone');
    if (dropZone) {
      dropZone.classList.add('hidden');
    }

    console.log('GLTF loaded successfully');
  }, (error) => {
    console.error('Error loading GLTF:', error);
    alert('Error loading model. Check console for details.');
    document.getElementById('drop-zone').classList.remove('hidden');
  });
}

// Load the built-in demo model from URL (for quick default view)
function loadDefaultModel() {
  const url = '../assets/models/BuildingV03.gltf';
  console.log('Loading default model from URL:', url);

  const loader = new GLTFLoader();
  loader.load(
    url,
    (gltf) => {
      removeModelOnly();
      loadedModel = gltf.scene;
      loadedModel.position.set(
        modelSettings.positionX,
        modelSettings.positionY,
        modelSettings.positionZ
      );

      // Enable shadows
      loadedModel.traverse((child) => {
        if (child.isMesh) {
          child.castShadow = true;
          child.receiveShadow = true;
        }
      });

      scene.add(loadedModel);
      centerModel();
      updateRoadHeightFromModel();

      // Hide drop zone once default model is loaded
      const dropZone = document.getElementById('drop-zone');
      if (dropZone) {
        dropZone.classList.add('hidden');
      }

      console.log('Default GLTF (BuildingV03) loaded successfully');
    },
    undefined,
    (error) => {
      console.error('Error loading default GLTF (BuildingV03):', error);
      // If this fails (e.g. 403), we just fall back to drag & drop
    }
  );
}

function loadOBJ(data) {
  const loader = new OBJLoader();
  
  try {
    // Remove any existing model but keep the scene state
    removeModelOnly();
    loadedModel = loader.parse(data);
    loadedModel.position.set(
      modelSettings.positionX,
      modelSettings.positionY,
      modelSettings.positionZ
    );
    
    // Add material if not present
    loadedModel.traverse((child) => {
      if (child.isMesh) {
        if (!child.material) {
          child.material = new THREE.MeshStandardMaterial({
            color: modelSettings.color,
            roughness: 0.5,
            metalness: 0.2
          });
        }
        child.castShadow = true;
        child.receiveShadow = true;
      }
    });
    
    scene.add(loadedModel);
    centerModel();
    updateRoadHeightFromModel();

    // Hide drop zone after successful load
    const dropZone = document.getElementById('drop-zone');
    if (dropZone) {
      dropZone.classList.add('hidden');
    }

    console.log('OBJ loaded successfully');
  } catch (error) {
    console.error('Error loading OBJ:', error);
    alert('Error loading model. Check console for details.');
    document.getElementById('drop-zone').classList.remove('hidden');
  }
}

function updateModel() {
  if (!loadedModel) return;

  loadedModel.position.set(
    modelSettings.positionX,
    modelSettings.positionY,
    modelSettings.positionZ
  );

  loadedModel.rotation.set(
    (modelSettings.rotationX * Math.PI) / 180,
    (modelSettings.rotationY * Math.PI) / 180,
    (modelSettings.rotationZ * Math.PI) / 180
  );

  loadedModel.scale.setScalar(modelSettings.scale);
  loadedModel.visible = modelSettings.visible;
}

function updateModelColor() {
  if (!loadedModel) return;

  loadedModel.traverse((child) => {
    if (child.isMesh && child.material) {
      if (Array.isArray(child.material)) {
        child.material.forEach(mat => {
          mat.color.set(modelSettings.color);
        });
      } else {
        child.material.color.set(modelSettings.color);
      }
    }
  });
}

function updateModelMaterial() {
  if (!loadedModel) return;

  loadedModel.traverse((child) => {
    if (child.isMesh && child.material) {
      if (Array.isArray(child.material)) {
        child.material.forEach(mat => {
          mat.wireframe = modelSettings.wireframe;
        });
      } else {
        child.material.wireframe = modelSettings.wireframe;
      }
    }
  });
}

function centerModel() {
  if (!loadedModel) return;

  // Do NOT change position/scale automatically anymore.
  // Just re-apply the current modelSettings to the loaded model.
  updateModel();
  [guiLeft, guiRight].forEach(g => {
    if (g) g.controllersRecursive().forEach(controller => controller.updateDisplay());
  });

  console.log('centerModel called – using manual transform:', {
    x: modelSettings.positionX,
    y: modelSettings.positionY,
    z: modelSettings.positionZ,
    scale: modelSettings.scale,
  });
}

// Remove the current model but do NOT touch drop zone or test cube
function removeModelOnly() {
  if (loadedModel) {
    scene.remove(loadedModel);
    loadedModel.traverse((child) => {
      if (child.isMesh) {
        child.geometry.dispose();
        if (child.material) {
          if (Array.isArray(child.material)) {
            child.material.forEach(mat => mat.dispose());
          } else {
            child.material.dispose();
          }
        }
      }
    });
    loadedModel = null;
  }
}

// Clear model and reset viewer state (used by GUI "clear" button)
function clearModel() {
  removeModelOnly();

  // Show drop zone again
  const dropZone = document.getElementById('drop-zone');
  if (dropZone) {
    dropZone.classList.remove('hidden');
  }
}

function onWindowResize() {
  const container = document.getElementById("game-view-container");
  const width = container.clientWidth;
  const height = container.clientHeight;
  
  camera.aspect = width / height;
  camera.updateProjectionMatrix();
  renderer.setSize(width, height);
  
  if (composer) {
    composer.setSize(width, height);
    
    if (fxaaPass) {
      const pixelRatio = renderer.getPixelRatio();
      fxaaPass.material.uniforms['resolution'].value.x = 1 / (width * pixelRatio);
      fxaaPass.material.uniforms['resolution'].value.y = 1 / (height * pixelRatio);
    }
  }
}

// Update CSS blend mode for the WebGL canvas
function updateCanvasBlendMode() {
  const canvas = document.getElementById("webgl-canvas");
  if (!canvas) return;
  canvas.style.mixBlendMode = canvasSettings.blendMode;
}

// Update visibility of grid and axes helpers
function updateHelpersVisibility() {
  if (gridHelper) {
    gridHelper.visible = helperSettings.showGrid;
  }
  if (axesHelper) {
    axesHelper.visible = helperSettings.showAxes;
  }
}

// Update cursor-following light when settings change
function updateCursorLightFromSettings() {
  if (!cursorLight) return;
  cursorLight.visible = cursorLightSettings.enabled;
  cursorLight.intensity = cursorLightSettings.intensity;
  cursorLight.distance = cursorLightSettings.distance;
  cursorLight.color.set(cursorLightSettings.color);
}

// Update road height from the loaded model by looking for an object named "Roads"
function updateRoadHeightFromModel() {
  if (!loadedModel) return;

  const roads = loadedModel.getObjectByName('Roads');
  if (!roads) {
    console.warn('[demo] No object named "Roads" found in model. Using default roadY:', roadY);
    return;
  }

  const box = new THREE.Box3().setFromObject(roads);
  roadY = box.max.y;
  if (cursorLight) {
    cursorLight.position.y = roadY;
  }

  console.log('[demo] Road height updated from model "Roads":', roadY);
}

// Move cursor light along the road plane under the mouse cursor
function onCanvasPointerMove(event) {
  if (!cursorLight || !cursorLightSettings.enabled) return;

  const canvas = event.currentTarget;
  const rect = canvas.getBoundingClientRect();

  // Normalized device coordinates (-1 to +1)
  mouse.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
  mouse.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;

  raycaster.setFromCamera(mouse, camera);

  // Intersection with horizontal plane at y = roadY
  const plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), -roadY);
  const intersectionPoint = new THREE.Vector3();

  if (raycaster.ray.intersectPlane(plane, intersectionPoint)) {
    cursorLight.position.set(intersectionPoint.x, roadY, intersectionPoint.z);
  }
}

function animate() {
  requestAnimationFrame(animate);

  controls.update();
  
  // Render with or without post-processing
  if (postSettings.bloomEnabled || postSettings.fxaaEnabled) {
    composer.render();
  } else {
    renderer.render(scene, camera);
  }
}

// Start the application
init();
