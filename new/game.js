// Chaser vs Fugitive game using BuildingV08_JJ.glb
// - Uses mesh named "ROADS" as walkable area
// - Spawns fugitives at Fugitive1-4 markers, chasers at Chaser marker
// - Grid-based Pac-Man style movement

import * as THREE from "../assets/lib/three/three.module.js";
import { GLTFLoader } from "../assets/lib/three/addons/loaders/GLTFLoader.js";
import { EffectComposer } from "../assets/lib/three/addons/postprocessing/EffectComposer.js";
import { RenderPass } from "../assets/lib/three/addons/postprocessing/RenderPass.js";
import { UnrealBloomPass } from "../assets/lib/three/addons/postprocessing/UnrealBloomPass.js";
import { OutputPass } from "../assets/lib/three/addons/postprocessing/OutputPass.js";
import { ShaderPass } from "../assets/lib/three/addons/postprocessing/ShaderPass.js";
import { FXAAShader } from "../assets/lib/three/addons/shaders/FXAAShader.js";

// lil-gui loaded via CDN in index.html
const GUI = window.lil.GUI;

(() => {
  const canvas = document.getElementById("game-canvas");

  // Status element helper (no-op if element doesn't exist)
  const statusEl = {
    set textContent(val) {
      console.log("[Status]", val);
    }
  };

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x000000); // Black background

  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setClearColor(0x000000, 0); // Transparent clear color
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;

  // Building plane (in same scene, below level)
  let buildingPlane = null;

  // Camera setup - will switch between perspective and orthographic
  let camera;
  let orthoCamera;
  let perspCamera;
  const glbCameras = []; // Cameras found in the GLB file

  // Create a default camera so rendering doesn't fail before GLB loads
  const defaultCamera = new THREE.PerspectiveCamera(55, window.innerWidth / window.innerHeight, 0.1, 5000);
  defaultCamera.position.set(0, 100, 100);
  camera = defaultCamera;

  // Arrays for actors
  const fugitives = [];
  const chasers = [];


  // Post-processing
  let composer = null;
  let renderPass = null;
  let bloomPass = null;
  let fxaaPass = null;
  let outputPass = null;

  // Settings storage key
  const STORAGE_KEY = "chaserVsFugitiveSettings";

  // Default settings (used for reset)
  const defaultSettings = {
    fugitiveSpeed: 1.0,
    chaserSpeed: 1,
    fugitiveIntelligence: 0.9,
    chaserIntelligence: 0.5,
    actorScale: 1.0,
    fugitive1Color: "#facc15",
    fugitive2Color: "#22c55e",
    fugitive3Color: "#38bdf8",
    fugitive4Color: "#a855f7",
    fugitiveLightIntensity: 1.2,
    chaserColor: "#ffffff",
    chaserLightIntensity: 50,
    cameraType: "orthographic",
    orthoZoom: 1,
    perspFov: 55,
    perspNear: 0.1,
    perspFar: 5000,
    perspPosX: 0,
    perspPosY: 100,
    perspPosZ: 100,
    perspLookX: 0,
    perspLookY: 0,
    perspLookZ: 0,
    ambientIntensity: 0.36,
    ambientColor: "#ffffff",
    wireEnabled: true,
    wireSegments: 12,
    wireHeight: 8,
    wireGravity: 0.15,
    wireFriction: 0.92,
    wireIterations: 5,
    wireColor: "#ffffff",
    wireThickness: 0.08,
    wireCubeSize: 2,
    showNavmesh: false,
    // Building plane (3D, in same scene)
    buildingEnabled: true,
    buildingScaleX: 1.14,
    buildingScaleY: 1.12,
    buildingOffsetX: 0.1,
    buildingOffsetY: -1,
    buildingOffsetZ: 0.939999999999998,
    buildingOpacity: 1.0,
    // Level (3D model) appearance
    levelOpacity: 1.0,
    levelBlendMode: "Normal",
    // Canvas blending (CSS)
    canvasBlendMode: "normal",
    canvasOpacity: 1.0,
    // Post-processing
    bloomEnabled: false,
    bloomThreshold: 0.5,
    bloomStrength: 0.4,
    bloomRadius: 1.0,
    fxaaEnabled: false,
  };

  // Load saved settings from localStorage
  function loadSettings() {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (saved) {
        const parsed = JSON.parse(saved);
        return { ...defaultSettings, ...parsed };
      }
    } catch (e) {
      console.warn("Failed to load settings:", e);
    }
    return { ...defaultSettings };
  }

  // Game settings - load saved values, then add functions
  const settings = {
    // Game state (not saved)
    gameStarted: false,

    // Load saved values (or defaults)
    ...loadSettings(),

    // Functions (not saved)
    startGame: function() {
      if (!STATE.loaded) return;
      settings.gameStarted = true;
      STATE.gameOver = false;
      statusEl.textContent = "Game started! Escape the chasers!";
    },
    saveSettings: function() {
      const toSave = {};
      for (const key of Object.keys(defaultSettings)) {
        toSave[key] = settings[key];
      }
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(toSave));
        statusEl.textContent = "Settings saved!";
        setTimeout(() => {
          if (STATE.loaded && !settings.gameStarted) {
            statusEl.textContent = "Ready! Click 'Start Game' in the GUI.";
          }
        }, 2000);
      } catch (e) {
        console.error("Failed to save settings:", e);
        statusEl.textContent = "Failed to save settings.";
      }
    },
    clearSettings: function() {
      try {
        localStorage.removeItem(STORAGE_KEY);
        statusEl.textContent = "Settings cleared! Reload to apply defaults.";
      } catch (e) {
        console.error("Failed to clear settings:", e);
      }
    },
  };

  // Store GUI references for refreshing
  let guiLeft = null;

  const STATE = {
    loaded: false,
    gameOver: false,
    lastTime: 0,
    levelCenter: new THREE.Vector3(),
    horizontalSize: 100,
    levelContainer: null,
  };

  // Keyboard input - track all keys for chaser controls
  const keys = new Set();
  window.addEventListener("keydown", (e) => {
    // Prevent default for all control keys
    const controlKeys = [
      "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight",
      "w", "a", "s", "d",
      "t", "f", "g", "h",
      "i", "j", "k", "l"
    ];
    if (controlKeys.includes(e.key) || controlKeys.includes(e.key.toLowerCase())) {
      e.preventDefault();
    }
    keys.add(e.key.toLowerCase());
  });
  window.addEventListener("keyup", (e) => keys.delete(e.key.toLowerCase()));

  // Key mappings for each chaser
  // C1: WASD, C2: TFGH, C3: IJKL, C4: Arrow keys
  const CHASER_CONTROLS = [
    { up: "w", down: "s", left: "a", right: "d" },      // C1 - WASD
    { up: "t", down: "g", left: "f", right: "h" },      // C2 - TFGH
    { up: "i", down: "k", left: "j", right: "l" },      // C3 - IJKL
    { up: "arrowup", down: "arrowdown", left: "arrowleft", right: "arrowright" }, // C4 - Arrows
  ];

  // Get movement direction for a chaser based on key input
  function getChaserInputDirection(chaserIndex) {
    if (chaserIndex >= CHASER_CONTROLS.length) return { x: 0, z: 0, hasInput: false };
    const ctrl = CHASER_CONTROLS[chaserIndex];

    let dx = 0;
    let dz = 0;

    if (keys.has(ctrl.up)) dz = -1;     // Up on screen (-Z)
    if (keys.has(ctrl.down)) dz = 1;    // Down on screen (+Z)
    if (keys.has(ctrl.left)) dx = -1;   // West (-X)
    if (keys.has(ctrl.right)) dx = 1;   // East (+X)

    // Only allow cardinal directions (no diagonal)
    // Prioritize vertical over horizontal if both pressed
    if (dz !== 0) dx = 0;

    const hasInput = dx !== 0 || dz !== 0;
    return { x: dx, z: dz, hasInput };
  }

  // Lights
  const ambientLight = new THREE.AmbientLight(settings.ambientColor, settings.ambientIntensity);
  scene.add(ambientLight);

  // Setup cameras
  function setupCameras(levelCenter, horizontalSize) {
    const aspect = window.innerWidth / window.innerHeight;
    const distance = horizontalSize * 1.2;

    // Set default perspective camera settings based on level
    settings.perspPosX = levelCenter.x + distance * 0.5;
    settings.perspPosY = levelCenter.y + distance * 0.9;
    settings.perspPosZ = levelCenter.z + distance * 0.5;
    settings.perspLookX = levelCenter.x;
    settings.perspLookY = levelCenter.y;
    settings.perspLookZ = levelCenter.z;

    // Perspective camera
    perspCamera = new THREE.PerspectiveCamera(settings.perspFov, aspect, settings.perspNear, settings.perspFar);
    perspCamera.position.set(settings.perspPosX, settings.perspPosY, settings.perspPosZ);
    perspCamera.lookAt(settings.perspLookX, settings.perspLookY, settings.perspLookZ);

    // Orthographic camera - fixed top-down view
    const frustumSize = horizontalSize * 1.5;
    orthoCamera = new THREE.OrthographicCamera(
      frustumSize * aspect / -2,
      frustumSize * aspect / 2,
      frustumSize / 2,
      frustumSize / -2,
      0.1,
      5000
    );
    // Position camera directly above level center, looking straight down
    orthoCamera.position.set(levelCenter.x, levelCenter.y + distance, levelCenter.z);
    orthoCamera.lookAt(levelCenter);
    orthoCamera.zoom = settings.orthoZoom;
    orthoCamera.updateProjectionMatrix();

    // Set initial camera
    camera = settings.cameraType === "orthographic" ? orthoCamera : perspCamera;
  }

  function switchCamera(type) {
    settings.cameraType = type;
    if (type === "orthographic") {
      camera = orthoCamera;
    } else if (type === "perspective") {
      camera = perspCamera;
    } else {
      // Check if it's a GLB camera
      const glbCam = glbCameras.find(c => c.name === type);
      if (glbCam) {
        camera = glbCam.camera;
        // Update aspect ratio for the GLB camera
        if (camera.isPerspectiveCamera) {
          camera.aspect = window.innerWidth / window.innerHeight;
          camera.updateProjectionMatrix();
        }
      }
    }
  }

  // Resize handling
  function onResize() {
    const width = window.innerWidth;
    const height = window.innerHeight;
    renderer.setSize(width, height);

    if (perspCamera) {
      perspCamera.aspect = width / height;
      perspCamera.updateProjectionMatrix();
    }

    if (orthoCamera) {
      const frustumSize = STATE.horizontalSize * 1.5;
      const aspect = width / height;
      orthoCamera.left = frustumSize * aspect / -2;
      orthoCamera.right = frustumSize * aspect / 2;
      orthoCamera.top = frustumSize / 2;
      orthoCamera.bottom = frustumSize / -2;
      orthoCamera.updateProjectionMatrix();
    }

    // Update composer size
    if (composer) {
      composer.setSize(width, height);
      if (fxaaPass) {
        const pixelRatio = renderer.getPixelRatio();
        fxaaPass.material.uniforms['resolution'].value.x = 1 / (width * pixelRatio);
        fxaaPass.material.uniforms['resolution'].value.y = 1 / (height * pixelRatio);
      }
    }
  }
  window.addEventListener("resize", onResize);

  // Setup GUI panels
  function setupGUI() {
    // Left GUI - Camera & Transforms
    guiLeft = new GUI({ title: "Camera & Transforms" });
    guiLeft.domElement.style.position = "absolute";
    guiLeft.domElement.style.left = "10px";
    guiLeft.domElement.style.top = "0px";

    const cameraFolder = guiLeft.addFolder("Camera");
    cameraFolder.add(settings, "cameraType", ["orthographic", "perspective"])
      .name("Type")
      .onChange((v) => switchCamera(v));

    const orthoFolder = cameraFolder.addFolder("Orthographic");
    orthoFolder.add(settings, "orthoZoom", 0.1, 3, 0.1).name("Zoom").onChange((v) => {
      if (orthoCamera) {
        orthoCamera.zoom = v;
        orthoCamera.updateProjectionMatrix();
      }
    });

    const perspFolder = cameraFolder.addFolder("Perspective");
    perspFolder.add(settings, "perspFov", 20, 120, 1).name("FOV").onChange((v) => {
      if (perspCamera) {
        perspCamera.fov = v;
        perspCamera.updateProjectionMatrix();
      }
    });

    function updatePerspCameraPos() {
      if (perspCamera) {
        perspCamera.position.set(settings.perspPosX, settings.perspPosY, settings.perspPosZ);
        perspCamera.lookAt(settings.perspLookX, settings.perspLookY, settings.perspLookZ);
      }
    }

    perspFolder.add(settings, "perspPosX", -500, 500, 5).name("Pos X").onChange(updatePerspCameraPos);
    perspFolder.add(settings, "perspPosY", 0, 500, 5).name("Pos Y").onChange(updatePerspCameraPos);
    perspFolder.add(settings, "perspPosZ", -500, 500, 5).name("Pos Z").onChange(updatePerspCameraPos);
    perspFolder.add(settings, "perspLookX", -500, 500, 5).name("Look X").onChange(updatePerspCameraPos);
    perspFolder.add(settings, "perspLookY", -500, 500, 5).name("Look Y").onChange(updatePerspCameraPos);
    perspFolder.add(settings, "perspLookZ", -500, 500, 5).name("Look Z").onChange(updatePerspCameraPos);

    // Game controls (in left GUI)
    const gameFolder = guiLeft.addFolder("Game");
    gameFolder.add(settings, "startGame").name("▶ Start Game");
    gameFolder.add(settings, "fugitiveSpeed", 0.1, 15, 0.1).name("Fugitive Speed").onChange((v) => {
      for (const f of fugitives) f.speed = v;
    });
    gameFolder.add(settings, "chaserSpeed", 0.1, 15, 0.1).name("Chaser Speed").onChange((v) => {
      for (const c of chasers) c.speed = v;
    });
    gameFolder.add(settings, "fugitiveIntelligence", 0.5, 1, 0.05).name("Fugitive AI");
    gameFolder.add(settings, "showNavmesh").name("Show Navmesh").onChange((v) => {
      const navmeshDebug = scene.getObjectByName("NavmeshDebug");
      if (navmeshDebug) navmeshDebug.visible = v;
    });
    gameFolder.add(settings, "actorScale", 0.5, 2, 0.05).name("Actor Scale (reload)");

    // Settings management (in left GUI)
    const settingsFolder = guiLeft.addFolder("Settings Storage");
    settingsFolder.add(settings, "saveSettings").name("💾 Save Settings");
    settingsFolder.add(settings, "clearSettings").name("🗑️ Clear Settings");

    // Right GUI - FX & Lights
    const guiRight = new GUI({ title: "FX & Lights" });
    guiRight.domElement.style.position = "absolute";
    guiRight.domElement.style.right = "10px";
    guiRight.domElement.style.top = "10px";

    // Fugitive lights
    const fugitiveLightFolder = guiRight.addFolder("Fugitive Lights");
    fugitiveLightFolder.addColor(settings, "fugitive1Color").name("Fugitive 1").onChange(updateFugitiveLights);
    fugitiveLightFolder.addColor(settings, "fugitive2Color").name("Fugitive 2").onChange(updateFugitiveLights);
    fugitiveLightFolder.addColor(settings, "fugitive3Color").name("Fugitive 3").onChange(updateFugitiveLights);
    fugitiveLightFolder.addColor(settings, "fugitive4Color").name("Fugitive 4").onChange(updateFugitiveLights);
    fugitiveLightFolder.add(settings, "fugitiveLightIntensity", 0, 10, 0.1).name("Intensity").onChange(updateFugitiveLights);

    // Chaser lights
    const chaserLightFolder = guiRight.addFolder("Chaser Lights");
    chaserLightFolder.addColor(settings, "chaserColor").name("Color").onChange(updateChaserLights);
    chaserLightFolder.add(settings, "chaserLightIntensity", 0, 100, 1).name("Intensity").onChange(updateChaserLights);

    // Ambient light
    const ambientFolder = guiRight.addFolder("Ambient Light");
    ambientFolder.addColor(settings, "ambientColor").name("Color").onChange((v) => {
      ambientLight.color.set(v);
    });
    ambientFolder.add(settings, "ambientIntensity", 0, 5, 0.1).name("Intensity").onChange((v) => {
      ambientLight.intensity = v;
    });

    // Wire/Rope settings (fugitives only)
    const wireFolder = guiRight.addFolder("Fugitive Wires");
    wireFolder.add(settings, "wireEnabled").name("Enabled");
    wireFolder.add(settings, "wireHeight", 2, 20, 0.5).name("Height");
    wireFolder.add(settings, "wireGravity", 0, 0.5, 0.01).name("Gravity");
    wireFolder.add(settings, "wireFriction", 0.8, 0.99, 0.01).name("Friction");
    wireFolder.add(settings, "wireCubeSize", 0.2, 4, 0.1).name("Billboard Size").onChange(updateWireBillboards);

    // Building plane (3D, in same scene)
    const gameCanvas = document.getElementById("game-canvas");

    function updateBuildingPlane() {
      if (!buildingPlane || !STATE.levelCenter || !STATE.horizontalSize) return;

      // Update plane geometry based on scale
      const sizeX = STATE.horizontalSize * settings.buildingScaleX;
      const sizeY = STATE.horizontalSize * settings.buildingScaleY;
      buildingPlane.geometry.dispose();
      buildingPlane.geometry = new THREE.PlaneGeometry(sizeX, sizeY);

      // Update position with offsets
      buildingPlane.position.set(
        STATE.levelCenter.x + settings.buildingOffsetX,
        (STATE.streetY || 0) + settings.buildingOffsetY,
        STATE.levelCenter.z + settings.buildingOffsetZ
      );

      // Update opacity
      buildingPlane.material.opacity = settings.buildingOpacity;
      buildingPlane.material.transparent = settings.buildingOpacity < 1;
      buildingPlane.visible = settings.buildingEnabled;
    }

    const backdropFolder = guiRight.addFolder("Building Plane");
    backdropFolder.add(settings, "buildingEnabled").name("Enabled").onChange(updateBuildingPlane);
    backdropFolder.add(settings, "buildingScaleX", 0.1, 3, 0.01).name("Scale X").onChange(updateBuildingPlane);
    backdropFolder.add(settings, "buildingScaleY", 0.1, 3, 0.01).name("Scale Y").onChange(updateBuildingPlane);
    backdropFolder.add(settings, "buildingOffsetX", -50, 50, 0.01).name("Offset X").onChange(updateBuildingPlane);
    backdropFolder.add(settings, "buildingOffsetY", -50, 10, 0.01).name("Offset Y (Depth)").onChange(updateBuildingPlane);
    backdropFolder.add(settings, "buildingOffsetZ", -50, 50, 0.01).name("Offset Z").onChange(updateBuildingPlane);
    backdropFolder.add(settings, "buildingOpacity", 0, 1, 0.05).name("Opacity").onChange(updateBuildingPlane);

    // Store for use after level loads
    STATE.updateBuildingPlane = updateBuildingPlane;

    // Level appearance (opacity and blending)
    const levelAppearanceFolder = guiRight.addFolder("Level Appearance");

    function updateLevelOpacity(opacity) {
      if (!STATE.levelContainer) return;
      STATE.levelContainer.traverse((obj) => {
        if (obj.isMesh && obj.material) {
          obj.material.transparent = opacity < 1;
          obj.material.opacity = opacity;
          obj.material.needsUpdate = true;
        }
      });
    }

    function updateLevelBlendMode(mode) {
      if (!STATE.levelContainer) return;
      STATE.levelContainer.traverse((obj) => {
        if (obj.isMesh && obj.material) {
          switch (mode) {
            case "Normal":
              obj.material.blending = THREE.NormalBlending;
              break;
            case "Additive":
              obj.material.blending = THREE.AdditiveBlending;
              break;
            case "Subtractive":
              obj.material.blending = THREE.SubtractiveBlending;
              break;
            case "Multiply":
              obj.material.blending = THREE.MultiplyBlending;
              break;
            case "Screen":
              obj.material.blending = THREE.CustomBlending;
              obj.material.blendEquation = THREE.AddEquation;
              obj.material.blendSrc = THREE.OneFactor;
              obj.material.blendDst = THREE.OneMinusSrcColorFactor;
              break;
            case "Overlay":
              // Approximation using custom blending
              obj.material.blending = THREE.CustomBlending;
              obj.material.blendEquation = THREE.AddEquation;
              obj.material.blendSrc = THREE.DstColorFactor;
              obj.material.blendDst = THREE.SrcColorFactor;
              break;
            case "Lighten":
              obj.material.blending = THREE.CustomBlending;
              obj.material.blendEquation = THREE.MaxEquation;
              obj.material.blendSrc = THREE.OneFactor;
              obj.material.blendDst = THREE.OneFactor;
              break;
            case "Darken":
              obj.material.blending = THREE.CustomBlending;
              obj.material.blendEquation = THREE.MinEquation;
              obj.material.blendSrc = THREE.OneFactor;
              obj.material.blendDst = THREE.OneFactor;
              break;
          }
          obj.material.needsUpdate = true;
        }
      });
    }

    // Store functions so they can be called after level loads
    STATE.updateLevelOpacity = updateLevelOpacity;
    STATE.updateLevelBlendMode = updateLevelBlendMode;

    const blendModes = ["Normal", "Additive", "Subtractive", "Multiply", "Screen", "Overlay", "Lighten", "Darken"];
    levelAppearanceFolder.add(settings, "levelOpacity", 0, 1, 0.01).name("Opacity").onChange(updateLevelOpacity);
    levelAppearanceFolder.add(settings, "levelBlendMode", blendModes).name("Blend Mode").onChange(updateLevelBlendMode);

    // Canvas blending (CSS-based)
    const canvasFolder = guiRight.addFolder("Canvas Blending");
    const cssBlendModes = [
      "normal", "multiply", "screen", "overlay", "darken", "lighten",
      "color-dodge", "color-burn", "hard-light", "soft-light",
      "difference", "exclusion", "hue", "saturation", "color", "luminosity"
    ];
    canvasFolder.add(settings, "canvasBlendMode", cssBlendModes).name("Blend Mode").onChange((v) => {
      if (gameCanvas) gameCanvas.style.mixBlendMode = v;
    });
    canvasFolder.add(settings, "canvasOpacity", 0, 1, 0.05).name("Opacity").onChange((v) => {
      if (gameCanvas) gameCanvas.style.opacity = v;
    });

    // Apply initial canvas styles
    if (gameCanvas) {
      gameCanvas.style.mixBlendMode = settings.canvasBlendMode;
      gameCanvas.style.opacity = settings.canvasOpacity;
    }


    // Post-processing folder
    const postFolder = guiRight.addFolder("Post-Processing");

    const bloomFolder = postFolder.addFolder("Bloom (Glow)");
    bloomFolder.add(settings, "bloomEnabled").name("Enable Bloom").onChange(updatePostProcessing);
    bloomFolder.add(settings, "bloomThreshold", 0, 1, 0.01).name("Threshold").onChange((v) => {
      if (bloomPass) bloomPass.threshold = v;
    });
    bloomFolder.add(settings, "bloomStrength", 0, 3, 0.1).name("Strength").onChange((v) => {
      if (bloomPass) bloomPass.strength = v;
    });
    bloomFolder.add(settings, "bloomRadius", 0, 2, 0.01).name("Radius").onChange((v) => {
      if (bloomPass) bloomPass.radius = v;
    });

    postFolder.add(settings, "fxaaEnabled").name("FXAA Anti-Aliasing").onChange(updatePostProcessing);
  }

  // Store references to GLB mesh parts for GUI control
  const glbParts = new Map();
  let glbPartsGUI = null;

  function setupGLBPartsGUI() {
    if (!STATE.levelContainer) return;

    // Collect unique named meshes from the level
    STATE.levelContainer.traverse((obj) => {
      if (obj.isMesh && obj.name && obj.material) {
        // Skip if already added or if it's a marker/spawn object
        if (glbParts.has(obj.name)) return;
        if (obj.name.match(/^(F\d|C\d|Fugitive|Chaser)/i)) return;

        glbParts.set(obj.name, {
          mesh: obj,
          originalColor: obj.material.color ? obj.material.color.clone() : new THREE.Color(1, 1, 1),
          originalOpacity: obj.material.opacity || 1
        });
      }
    });

    if (glbParts.size === 0) return;

    // Create GUI folder for GLB parts
    glbPartsGUI = new GUI({ title: "GLB Parts" });
    glbPartsGUI.domElement.style.position = "absolute";
    glbPartsGUI.domElement.style.left = "250px";
    glbPartsGUI.domElement.style.top = "0px";

    // Create a subfolder for each part
    glbParts.forEach((data, name) => {
      const partSettings = {
        color: "#" + data.originalColor.getHexString(),
        opacity: data.originalOpacity,
        visible: true
      };

      const folder = glbPartsGUI.addFolder(name);
      folder.addColor(partSettings, "color").name("Color").onChange((v) => {
        if (data.mesh.material) {
          data.mesh.material.color.set(v);
          if (data.mesh.material.emissive) {
            data.mesh.material.emissive.set(v);
          }
          data.mesh.material.needsUpdate = true;
        }
      });
      folder.add(partSettings, "opacity", 0, 1, 0.05).name("Opacity").onChange((v) => {
        if (data.mesh.material) {
          data.mesh.material.transparent = v < 1;
          data.mesh.material.opacity = v;
          data.mesh.material.needsUpdate = true;
        }
      });
      folder.add(partSettings, "visible").name("Visible").onChange((v) => {
        data.mesh.visible = v;
      });
      folder.close(); // Start closed to save space
    });

    console.log(`Created GUI controls for ${glbParts.size} GLB parts`);
  }

  // Post-processing initialization
  function initPostProcessing() {
    const width = window.innerWidth;
    const height = window.innerHeight;

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
      settings.bloomStrength,
      settings.bloomRadius,
      settings.bloomThreshold
    );

    fxaaPass = new ShaderPass(FXAAShader);
    const pixelRatio = renderer.getPixelRatio();
    fxaaPass.material.uniforms['resolution'].value.x = 1 / (width * pixelRatio);
    fxaaPass.material.uniforms['resolution'].value.y = 1 / (height * pixelRatio);

    outputPass = new OutputPass();
    composer.addPass(outputPass);

    updatePostProcessing();
    console.log("Post-processing initialized");
  }

  // Update post-processing passes based on settings
  function updatePostProcessing() {
    if (!composer) return;

    // Remove all passes except renderPass
    while (composer.passes.length > 1) {
      composer.passes.pop();
    }

    // Re-add passes based on settings
    if (settings.bloomEnabled) {
      bloomPass.threshold = settings.bloomThreshold;
      bloomPass.strength = settings.bloomStrength;
      bloomPass.radius = settings.bloomRadius;
      composer.addPass(bloomPass);
    }

    if (settings.fxaaEnabled) {
      composer.addPass(fxaaPass);
    }

    composer.addPass(outputPass);
  }

  function updateFugitiveLights() {
    const colors = [settings.fugitive1Color, settings.fugitive2Color, settings.fugitive3Color, settings.fugitive4Color];
    for (let i = 0; i < fugitives.length; i++) {
      const f = fugitives[i];
      if (f.light) {
        f.light.color.set(colors[i] || colors[0]);
        f.light.intensity = settings.fugitiveLightIntensity;
      }
      if (f.mesh && f.mesh.material) {
        f.mesh.material.color.set(colors[i] || colors[0]);
        f.mesh.material.emissive.set(colors[i] || colors[0]);
        f.mesh.material.emissiveIntensity = 0.3;
      }
    }
  }

  function updateChaserLights() {
    for (const c of chasers) {
      if (c.light) {
        c.light.color.set(settings.chaserColor);
        c.light.intensity = settings.chaserLightIntensity;
      }
      if (c.mesh && c.mesh.material) {
        c.mesh.material.color.set(settings.chaserColor);
        c.mesh.material.emissive.set(settings.chaserColor);
        c.mesh.material.emissiveIntensity = 0.3;
      }
    }
  }

  // Load GLB level and roads navmesh
  const loader = new GLTFLoader();

  // Load both files: main level and separate roads navmesh
  Promise.all([
    new Promise((resolve, reject) => {
      loader.load("Jagad.glb", resolve, undefined, reject);
    }),
    new Promise((resolve, reject) => {
      loader.load("roads.glb", resolve, undefined, reject);
    })
  ]).then(([levelGltf, roadsGltf]) => {
    const gltf = levelGltf;
    const roadsRoot = roadsGltf.scene;
      const root = gltf.scene;

      root.traverse((obj) => {
        if (obj.isMesh) {
          obj.castShadow = true;
          obj.receiveShadow = true;
        }
        // Find cameras in the GLB
        if (obj.isCamera) {
          glbCameras.push({ name: obj.name || `GLB Camera ${glbCameras.length + 1}`, camera: obj });
          console.log(`Found camera in GLB: ${obj.name}`, obj);
        }
      });

      // Create a container for the level
      const levelContainer = new THREE.Group();
      levelContainer.add(root);
      scene.add(levelContainer);
      STATE.levelContainer = levelContainer;

      // Apply saved level appearance settings
      if (STATE.updateLevelOpacity) {
        STATE.updateLevelOpacity(settings.levelOpacity);
      }
      if (STATE.updateLevelBlendMode) {
        STATE.updateLevelBlendMode(settings.levelBlendMode);
      }

      // Update world matrices so getWorldPosition works correctly
      levelContainer.updateMatrixWorld(true);

      // Find spawn markers and transform their positions to world space
      // (accounting for the rotation of the levelContainer)
      const fugitiveSpawns = [];
      const chaserSpawns = [];

      // Fugitive spawns: F1, F2, F3, F4 (remove markers after getting positions)
      for (let i = 1; i <= 4; i++) {
        const marker = levelContainer.getObjectByName(`F${i}`);
        if (marker) {
          const worldPos = new THREE.Vector3();
          marker.getWorldPosition(worldPos);
          fugitiveSpawns.push(worldPos);
          marker.parent.remove(marker); // Remove from scene
          console.log(`Found F${i} at:`, worldPos.x.toFixed(2), worldPos.y.toFixed(2), worldPos.z.toFixed(2));
        } else {
          console.warn(`Fugitive spawn marker F${i} not found in GLB`);
        }
      }

      // Chaser spawns: C1, C2, C3, C4
      for (let i = 1; i <= 4; i++) {
        const marker = levelContainer.getObjectByName(`C${i}`);
        if (marker) {
          const worldPos = new THREE.Vector3();
          marker.getWorldPosition(worldPos);
          chaserSpawns.push(worldPos);
          marker.visible = false;
          console.log(`Found C${i} at:`, worldPos.x.toFixed(2), worldPos.y.toFixed(2), worldPos.z.toFixed(2));
        } else {
          console.warn(`Chaser spawn marker C${i} not found in GLB`);
        }
      }

      // Use roads.glb for navmesh (separate file with just the street geometry)
      const roadsContainer = new THREE.Group();
      roadsContainer.add(roadsRoot);
      roadsContainer.updateMatrixWorld(true);

      // Don't add roads to scene visually - just use for navmesh
      // (Uncomment to debug: scene.add(roadsContainer);)

      let roadsMeshes = [];
      roadsRoot.traverse((obj) => {
        if (obj.isMesh) {
          roadsMeshes.push(obj);
          console.log(`Found road mesh in roads.glb: "${obj.name}"`);
        }
      });

      // Log what we found
      console.log(`Loaded ${roadsMeshes.length} meshes from roads.glb for navmesh`);
      for (const m of roadsMeshes) {
        const box = new THREE.Box3().setFromObject(m);
        console.log(`  - Road mesh: "${m.name}", Y range: ${box.min.y.toFixed(2)} to ${box.max.y.toFixed(2)}`);
      }

      // List all mesh names from main GLB for debugging
      console.log("All meshes in main GLB (Jagad.glb):");
      levelContainer.traverse((obj) => {
        if (obj.isMesh) {
          const box = new THREE.Box3().setFromObject(obj);
          const size = new THREE.Vector3();
          box.getSize(size);
          console.log(`  Mesh: "${obj.name}" - size: ${size.x.toFixed(1)} x ${size.y.toFixed(1)} x ${size.z.toFixed(1)}, Y range: ${box.min.y.toFixed(2)} to ${box.max.y.toFixed(2)}`);
        }
      });

      if (roadsMeshes.length > 0) {
        statusEl.textContent = `Level loaded. Found ${roadsMeshes.length} road meshes from roads.glb, ${fugitiveSpawns.length} fugitive spawns, ${chaserSpawns.length} chaser spawns.`;
      } else {
        statusEl.textContent = "No meshes found in roads.glb!";
      }

      // Compute walkable bounds from roads.glb
      // Also compute full level bounds to ensure spawn markers are within grid
      const roadsBbox = roadsMeshes.length > 0
        ? new THREE.Box3().setFromObject(roadsContainer)
        : new THREE.Box3().setFromObject(root);

      // Compute a bbox that includes spawn markers
      const spawnBbox = new THREE.Box3();
      for (const sp of fugitiveSpawns) spawnBbox.expandByPoint(sp);
      for (const sp of chaserSpawns) spawnBbox.expandByPoint(sp);

      // Use the union of roads and spawn positions for the grid
      const bbox = roadsBbox.clone();
      if (!spawnBbox.isEmpty()) {
        bbox.union(spawnBbox);
      }

      console.log("Roads bbox:", roadsBbox.min.x.toFixed(2), roadsBbox.min.z.toFixed(2), "to", roadsBbox.max.x.toFixed(2), roadsBbox.max.z.toFixed(2));
      console.log("Combined bbox:", bbox.min.x.toFixed(2), bbox.min.z.toFixed(2), "to", bbox.max.x.toFixed(2), bbox.max.z.toFixed(2));

      const size = new THREE.Vector3();
      bbox.getSize(size);
      const horizontalSize = Math.max(size.x, size.z);
      const levelCenter = new THREE.Vector3();
      bbox.getCenter(levelCenter);

      STATE.levelCenter.copy(levelCenter);
      STATE.horizontalSize = horizontalSize;

      // Use Roads geometry directly as navmesh via point-in-triangle tests
      const streetY = roadsBbox.min.y;

      console.log("Building navmesh from roads.glb geometry...");

      // Extract all triangles from road meshes in world XZ coordinates
      const navTriangles = [];
      for (const roadMesh of roadsMeshes) {
        const geometry = roadMesh.geometry;
        if (!geometry || !geometry.attributes || !geometry.attributes.position) continue;

        const posAttr = geometry.attributes.position;
        const index = geometry.index;
        roadMesh.updateMatrixWorld(true);
        const worldMatrix = roadMesh.matrixWorld;

        const triangleCount = index ? index.count / 3 : posAttr.count / 3;

        for (let t = 0; t < triangleCount; t++) {
          let i0, i1, i2;
          if (index) {
            i0 = index.getX(t * 3);
            i1 = index.getX(t * 3 + 1);
            i2 = index.getX(t * 3 + 2);
          } else {
            i0 = t * 3;
            i1 = t * 3 + 1;
            i2 = t * 3 + 2;
          }

          const v0 = new THREE.Vector3().fromBufferAttribute(posAttr, i0).applyMatrix4(worldMatrix);
          const v1 = new THREE.Vector3().fromBufferAttribute(posAttr, i1).applyMatrix4(worldMatrix);
          const v2 = new THREE.Vector3().fromBufferAttribute(posAttr, i2).applyMatrix4(worldMatrix);

          // Store triangle with bounding box for fast rejection
          const minX = Math.min(v0.x, v1.x, v2.x);
          const maxX = Math.max(v0.x, v1.x, v2.x);
          const minZ = Math.min(v0.z, v1.z, v2.z);
          const maxZ = Math.max(v0.z, v1.z, v2.z);

          navTriangles.push({
            ax: v0.x, az: v0.z,
            bx: v1.x, bz: v1.z,
            cx: v2.x, cz: v2.z,
            minX, maxX, minZ, maxZ
          });
        }
      }

      console.log(`Navmesh built: ${navTriangles.length} triangles from ${roadsMeshes.length} meshes`);

      // Point-in-triangle test using barycentric coordinates
      function pointInTriangle(px, pz, ax, az, bx, bz, cx, cz) {
        const v0x = cx - ax;
        const v0z = cz - az;
        const v1x = bx - ax;
        const v1z = bz - az;
        const v2x = px - ax;
        const v2z = pz - az;

        const dot00 = v0x * v0x + v0z * v0z;
        const dot01 = v0x * v1x + v0z * v1z;
        const dot02 = v0x * v2x + v0z * v2z;
        const dot11 = v1x * v1x + v1z * v1z;
        const dot12 = v1x * v2x + v1z * v2z;

        const denom = dot00 * dot11 - dot01 * dot01;
        if (Math.abs(denom) < 0.0001) return false;

        const invDenom = 1 / denom;
        const u = (dot11 * dot02 - dot01 * dot12) * invDenom;
        const v = (dot00 * dot12 - dot01 * dot02) * invDenom;

        return (u >= 0) && (v >= 0) && (u + v <= 1);
      }

      // Check if a point (x, z) is on the navmesh
      function isOnRoad(x, z) {
        for (const tri of navTriangles) {
          if (x < tri.minX || x > tri.maxX || z < tri.minZ || z > tri.maxZ) {
            continue;
          }
          if (pointInTriangle(x, z, tri.ax, tri.az, tri.bx, tri.bz, tri.cx, tri.cz)) {
            return true;
          }
        }
        return false;
      }

      // Get actor size from C1 marker (the spawn marker cubes define the road width)
      // Make actors fill the road width for Pac-Man style movement
      let actorSize = 1; // Default fallback
      const c1Marker = levelContainer.getObjectByName("C1");
      if (c1Marker) {
        const markerBox = new THREE.Box3().setFromObject(c1Marker);
        const markerSize = new THREE.Vector3();
        markerBox.getSize(markerSize);
        // Use the smallest horizontal dimension at full size to fill the road
        actorSize = Math.min(markerSize.x, markerSize.z);
        console.log(`Actor size from C1 marker: ${actorSize.toFixed(2)} (100% of road width)`);
      } else {
        // Fallback: use a fraction of the level size
        const baseUnit = horizontalSize || 100;
        actorSize = baseUnit / 150;
        console.log(`Actor size fallback: ${actorSize.toFixed(2)}`);
      }
      // Apply user scale adjustment
      actorSize *= settings.actorScale;
      console.log(`Final actor size with scale ${settings.actorScale}: ${actorSize.toFixed(2)}`);

      // Check if point is on road with a margin (for actor collision)
      // This shrinks the effective navmesh by the actor's radius
      function isOnRoadWithMargin(x, z, margin) {
        // Check the center point and points around it at the margin distance
        if (!isOnRoad(x, z)) return false;

        // Check 8 points around the actor at margin distance
        const angles = [0, Math.PI/4, Math.PI/2, 3*Math.PI/4, Math.PI, 5*Math.PI/4, 3*Math.PI/2, 7*Math.PI/4];
        for (const angle of angles) {
          const testX = x + Math.cos(angle) * margin;
          const testZ = z + Math.sin(angle) * margin;
          if (!isOnRoad(testX, testZ)) {
            return false;
          }
        }
        return true;
      }

      // Try to move from current position in a direction, returns new valid position
      // Uses actor margin to keep actors away from navmesh edges
      function tryMove(currentX, currentZ, dirX, dirZ, distance, margin = 0) {
        // If we're not on road, don't move (should find nearest road point first)
        if (!isOnRoad(currentX, currentZ)) {
          return { x: currentX, z: currentZ };
        }

        const stepSize = 0.1;
        const steps = Math.max(1, Math.ceil(distance / stepSize));
        const actualStep = distance / steps;

        let x = currentX;
        let z = currentZ;

        // Use margin-aware check if margin > 0, otherwise just use basic check
        const checkFn = margin > 0
          ? (px, pz) => isOnRoadWithMargin(px, pz, margin)
          : isOnRoad;

        for (let i = 0; i < steps; i++) {
          const newX = x + dirX * actualStep;
          const newZ = z + dirZ * actualStep;

          if (checkFn(newX, newZ)) {
            x = newX;
            z = newZ;
          } else {
            // Try sliding along edges - test perpendicular movements
            const slideX1 = x + dirX * actualStep;
            const slideZ1 = z;
            const slideX2 = x;
            const slideZ2 = z + dirZ * actualStep;

            if (checkFn(slideX1, slideZ1)) {
              x = slideX1;
              z = slideZ1;
            } else if (checkFn(slideX2, slideZ2)) {
              x = slideX2;
              z = slideZ2;
            } else {
              // Can't move at all in this direction
              break;
            }
          }
        }

        return { x, z };
      }

      // Find nearest point on road from a given position
      function findNearestRoadPoint(x, z) {
        if (isOnRoad(x, z)) {
          console.log(`  Point (${x.toFixed(2)}, ${z.toFixed(2)}) is already on road`);
          return { x, z };
        }

        // Spiral search outward with finer steps
        for (let radius = 0.2; radius < 150; radius += 0.3) {
          for (let angle = 0; angle < Math.PI * 2; angle += Math.PI / 32) {
            const testX = x + Math.cos(angle) * radius;
            const testZ = z + Math.sin(angle) * radius;
            if (isOnRoad(testX, testZ)) {
              console.log(`  Found road at (${testX.toFixed(2)}, ${testZ.toFixed(2)}) - radius ${radius.toFixed(1)}`);
              return { x: testX, z: testZ };
            }
          }
        }

        console.warn(`Could not find road point near (${x.toFixed(2)}, ${z.toFixed(2)})`);
        return { x, z };
      }

      // Debug: test a few points
      const testPoints = [
        { x: levelCenter.x, z: levelCenter.z },
        { x: roadsBbox.min.x + 5, z: roadsBbox.min.z + 5 },
        { x: roadsBbox.max.x - 5, z: roadsBbox.max.z - 5 },
      ];
      console.log("Testing navmesh at sample points:");
      for (const p of testPoints) {
        console.log(`  (${p.x.toFixed(2)}, ${p.z.toFixed(2)}): ${isOnRoad(p.x, p.z) ? "ON ROAD" : "off road"}`);
      }

      // Debug: log first triangle coordinates
      if (navTriangles.length > 0) {
        const t = navTriangles[0];
        console.log(`First triangle: (${t.ax.toFixed(2)}, ${t.az.toFixed(2)}) -> (${t.bx.toFixed(2)}, ${t.bz.toFixed(2)}) -> (${t.cx.toFixed(2)}, ${t.cz.toFixed(2)})`);
        console.log(`  bounds: X[${t.minX.toFixed(2)}, ${t.maxX.toFixed(2)}], Z[${t.minZ.toFixed(2)}, ${t.maxZ.toFixed(2)}]`);
      }

      // Debug visualization: draw navmesh outline
      const navmeshDebug = new THREE.Group();
      navmeshDebug.name = "NavmeshDebug";
      const debugMat = new THREE.LineBasicMaterial({ color: 0x00ff00, transparent: true, opacity: 0.5 });

      for (let i = 0; i < Math.min(navTriangles.length, 500); i++) {
        const tri = navTriangles[i];
        const points = [
          new THREE.Vector3(tri.ax, streetY + 0.1, tri.az),
          new THREE.Vector3(tri.bx, streetY + 0.1, tri.bz),
          new THREE.Vector3(tri.cx, streetY + 0.1, tri.cz),
          new THREE.Vector3(tri.ax, streetY + 0.1, tri.az),
        ];
        const geo = new THREE.BufferGeometry().setFromPoints(points);
        const line = new THREE.Line(geo, debugMat);
        navmeshDebug.add(line);
      }
      scene.add(navmeshDebug);
      navmeshDebug.visible = settings.showNavmesh; // Off by default
      console.log("Added navmesh debug visualization (green wireframe, toggle in GUI)");

      function projectYOnRoad(pos) {
        pos.y = streetY + actorSize * 0.5;
      }

      // Setup cameras after we know level size
      setupCameras(levelCenter, horizontalSize);
      onResize();

      // Store streetY for building plane positioning
      STATE.streetY = streetY;

      // Create building plane in the same scene, below the level
      console.log("Creating building plane...", "streetY:", streetY, "levelCenter:", levelCenter);
      const sizeX = horizontalSize * settings.buildingScaleX;
      const sizeY = horizontalSize * settings.buildingScaleY;
      const planeGeo = new THREE.PlaneGeometry(sizeX, sizeY);

      // Start with a colored material, then load texture
      const planeMat = new THREE.MeshBasicMaterial({
        color: 0x333366,
        transparent: true,
        opacity: settings.buildingOpacity,
        side: THREE.DoubleSide
      });
      buildingPlane = new THREE.Mesh(planeGeo, planeMat);
      buildingPlane.rotation.x = -Math.PI / 2; // Face upward
      buildingPlane.position.set(
        levelCenter.x + settings.buildingOffsetX,
        streetY + settings.buildingOffsetY,
        levelCenter.z + settings.buildingOffsetZ
      );
      buildingPlane.visible = settings.buildingEnabled;
      scene.add(buildingPlane);
      console.log("Building plane added at:", buildingPlane.position);

      // Now load the texture
      const textureLoader = new THREE.TextureLoader();
      textureLoader.load("building.png",
        (texture) => {
          console.log("Building texture loaded, applying to plane");
          buildingPlane.material.map = texture;
          buildingPlane.material.color.set(0xffffff);
          buildingPlane.material.needsUpdate = true;
        },
        undefined,
        (error) => {
          console.error("Failed to load building.png:", error);
        }
      );

      // Create fugitives
      const fugitiveGeo = new THREE.BoxGeometry(actorSize, actorSize, actorSize);
      const fugitiveColors = [settings.fugitive1Color, settings.fugitive2Color, settings.fugitive3Color, settings.fugitive4Color];

      for (let i = 0; i < fugitiveSpawns.length; i++) {
        const color = fugitiveColors[i] || fugitiveColors[0];
        const material = new THREE.MeshStandardMaterial({
          color: color,
          emissive: color,
          emissiveIntensity: 0.3
        });
        const mesh = new THREE.Mesh(fugitiveGeo, material);
        mesh.castShadow = true;
        mesh.receiveShadow = true;

        const light = new THREE.PointLight(color, settings.fugitiveLightIntensity, 100);
        light.position.set(0, 0, 0);
        light.castShadow = true;
        light.shadow.mapSize.width = 512;
        light.shadow.mapSize.height = 512;
        light.shadow.camera.near = 0.1;
        light.shadow.camera.far = 50;
        light.shadow.bias = -0.001;
        mesh.add(light);

        const spawnPos = fugitiveSpawns[i];
        // Find nearest point on road mesh
        const roadPoint = findNearestRoadPoint(spawnPos.x, spawnPos.z);
        console.log(`Fugitive ${i+1}: spawn(${spawnPos.x.toFixed(2)}, ${spawnPos.z.toFixed(2)}) -> road(${roadPoint.x.toFixed(2)}, ${roadPoint.z.toFixed(2)})`);

        mesh.position.set(roadPoint.x, 0, roadPoint.z);
        projectYOnRoad(mesh.position);
        scene.add(mesh);

        // Random initial cardinal direction
        const cardinalDirs = [[0, 1], [0, -1], [1, 0], [-1, 0]];
        const randomCardinal = cardinalDirs[Math.floor(Math.random() * 4)];
        fugitives.push({
          mesh,
          light,
          speed: settings.fugitiveSpeed,
          dirX: randomCardinal[0],
          dirZ: randomCardinal[1],
          captured: false,
          index: i,
          lastIntersectionX: roadPoint.x,  // Track last intersection to avoid re-deciding
          lastIntersectionZ: roadPoint.z,
        });

        // Create wire for this fugitive (pass index i for texture F1.png, F2.png, etc.)
        const wire = new ActorWire(fugitives[fugitives.length - 1], actorSize, settings.fugitiveColor, false, i);
        fugitiveWires.push(wire);
      }

      // Create chasers at individual spawn points (C1-C4)
      // Use cubes like fugitives
      const chaserGeo = new THREE.BoxGeometry(actorSize, actorSize, actorSize);

      for (let i = 0; i < chaserSpawns.length; i++) {
        const material = new THREE.MeshStandardMaterial({
          color: settings.chaserColor,
          emissive: settings.chaserColor,
          emissiveIntensity: 0.3,
        });
        const mesh = new THREE.Mesh(chaserGeo, material);
        mesh.castShadow = true;
        mesh.receiveShadow = true;

        const light = new THREE.PointLight(settings.chaserColor, settings.chaserLightIntensity, 100);
        light.position.set(0, 0, 0);
        light.castShadow = true;
        light.shadow.mapSize.width = 512;
        light.shadow.mapSize.height = 512;
        light.shadow.camera.near = 0.1;
        light.shadow.camera.far = 50;
        light.shadow.bias = -0.001;
        mesh.add(light);

        const spawnPos = chaserSpawns[i];
        // Find nearest point on road mesh
        const roadPoint = findNearestRoadPoint(spawnPos.x, spawnPos.z);
        console.log(`Chaser ${i+1}: spawn(${spawnPos.x.toFixed(2)}, ${spawnPos.z.toFixed(2)}) -> road(${roadPoint.x.toFixed(2)}, ${roadPoint.z.toFixed(2)})`);

        mesh.position.set(roadPoint.x, 0, roadPoint.z);
        projectYOnRoad(mesh.position);
        mesh.visible = false; // Hidden until player activates

        const chaserObj = {
          mesh,
          light,
          speed: settings.chaserSpeed,
          dirX: 0,
          dirZ: 0,
          queuedDirX: 0,  // Queued direction for Pac-Man style movement
          queuedDirZ: 0,
          active: false, // Activated when player presses movement key
        };
        scene.add(mesh);
        chasers.push(chaserObj);
      }

      // Attach to state
      STATE.isOnRoad = isOnRoad;
      STATE.tryMove = tryMove;
      STATE.findNearestRoadPoint = findNearestRoadPoint;
      STATE.projectYOnRoad = projectYOnRoad;
      STATE.actorSize = actorSize;
      STATE.actorRadius = actorSize * 0.5;
      STATE.roadsMeshes = roadsMeshes;
      STATE.loaded = true;

      // Setup GUI after everything is loaded
      setupGUI();

      // Initialize post-processing
      initPostProcessing();

      // Create GUI controls for GLB parts (colors and opacity)
      setupGLBPartsGUI();

      statusEl.textContent = "Ready! Click 'Start Game' in the GUI.";
  }).catch((err) => {
    console.error("Error loading GLB files", err);
    statusEl.textContent = "Failed to load GLB files (see console).";
  });

  // === Wire/Rope Physics System ===

  // 3D Point for rope simulation
  class RopePoint {
    constructor(x, y, z) {
      this.pos = new THREE.Vector3(x, y, z);
      this.oldPos = new THREE.Vector3(x, y, z);
      this.pinned = false;
    }

    update(gravity, friction) {
      if (this.pinned) return;

      const vx = (this.pos.x - this.oldPos.x) * friction;
      const vy = (this.pos.y - this.oldPos.y) * friction;
      const vz = (this.pos.z - this.oldPos.z) * friction;

      this.oldPos.copy(this.pos);

      this.pos.x += vx;
      this.pos.y += vy - gravity;
      this.pos.z += vz;
    }

    setPos(x, y, z) {
      this.pos.set(x, y, z);
      this.oldPos.set(x, y, z);
    }
  }

  // Rope segment constraint
  class RopeStick {
    constructor(p1, p2, length) {
      this.p1 = p1;
      this.p2 = p2;
      this.length = length;
    }

    update() {
      const dx = this.p2.pos.x - this.p1.pos.x;
      const dy = this.p2.pos.y - this.p1.pos.y;
      const dz = this.p2.pos.z - this.p1.pos.z;
      const distance = Math.sqrt(dx * dx + dy * dy + dz * dz);

      if (distance === 0) return;

      const diff = (this.length - distance) / distance / 2;
      const offsetX = dx * diff;
      const offsetY = dy * diff;
      const offsetZ = dz * diff;

      if (!this.p1.pinned) {
        this.p1.pos.x -= offsetX;
        this.p1.pos.y -= offsetY;
        this.p1.pos.z -= offsetZ;
      }
      if (!this.p2.pinned) {
        this.p2.pos.x += offsetX;
        this.p2.pos.y += offsetY;
        this.p2.pos.z += offsetZ;
      }
    }
  }

  // Wire system for actors (chasers and fugitives)
  class ActorWire {
    constructor(actor, actorSize, color, isChaser = true, index = 0) {
      this.actor = actor;
      this.actorSize = actorSize;
      this.color = color;
      this.isChaser = isChaser;
      this.index = index; // Index for loading F1.png, F2.png, etc.
      this.points = [];
      this.sticks = [];
      this.line = null;
      this.cube = null;
      this.cubeLight = null;

      this.initWire();
    }

    initWire() {
      const segmentCount = settings.wireSegments;
      const totalHeight = settings.wireHeight * this.actorSize;
      const segmentLength = totalHeight / segmentCount;

      // Get actor position
      const actorPos = this.actor.mesh.position;

      // Create points from actor up to the cube
      this.points = [];
      this.sticks = [];

      for (let i = 0; i <= segmentCount; i++) {
        const t = i / segmentCount;
        const y = actorPos.y + t * totalHeight;
        const p = new RopePoint(actorPos.x, y, actorPos.z);
        this.points.push(p);

        if (i > 0) {
          this.sticks.push(new RopeStick(this.points[i - 1], this.points[i], segmentLength));
        }
      }

      // Pin the first point (attached to actor)
      this.points[0].pinned = true;
      // Pin the last point (the cube floats)
      this.points[this.points.length - 1].pinned = true;

      // Create line geometry
      const positions = new Float32Array((segmentCount + 1) * 3);
      const geometry = new THREE.BufferGeometry();
      geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));

      const material = new THREE.LineBasicMaterial({
        color: this.color,
        linewidth: 2
      });

      this.line = new THREE.Line(geometry, material);
      scene.add(this.line);

      // Create the floating billboard (faces upward for future image)
      const billboardSize = settings.wireCubeSize * this.actorSize * 2;
      const billboardGeo = new THREE.PlaneGeometry(billboardSize, billboardSize);
      const billboardMat = new THREE.MeshBasicMaterial({
        color: 0xffffff,
        side: THREE.DoubleSide,
        transparent: true
      });
      this.billboard = new THREE.Mesh(billboardGeo, billboardMat);
      this.billboard.rotation.x = -Math.PI / 2; // Face upward
      this.billboard.castShadow = true;
      scene.add(this.billboard);

      // Load texture for fugitive billboards
      if (!this.isChaser) {
        const textureLoader = new THREE.TextureLoader();
        // Map index to actual filenames
        const textureNames = [
          "F1_Jaget_Lineup_Master_FACE_Samir_Viktor.png",
          "F2_Jaget_Lineup_Master_FACE_Maria_Sara.png",
          "F3_Jaget_Lineup_Master_FACE_Glenn_Hasse.png",
          "F4_Jaget_Lineup_Master_FACE_Anja_Filippa.png"
        ];
        const textureName = textureNames[this.index] || textureNames[0];
        textureLoader.load(textureName,
          (texture) => {
            console.log(`Loaded billboard texture: ${textureName}`);
            this.billboard.material.map = texture;
            this.billboard.material.needsUpdate = true;
          },
          undefined,
          (error) => {
            console.warn(`Could not load ${textureName}, using color fallback`);
            this.billboard.material.color.set(this.color);
          }
        );
      } else {
        // Chasers use color
        this.billboard.material.color.set(this.color);
      }
    }

    isVisible() {
      if (!settings.wireEnabled) return false;
      if (this.isChaser) {
        return this.actor.active;
      } else {
        // Fugitive: visible if not captured
        return !this.actor.captured;
      }
    }

    update() {
      if (!this.isVisible()) {
        if (this.line) this.line.visible = false;
        if (this.billboard) this.billboard.visible = false;
        return;
      }

      if (this.line) this.line.visible = true;
      if (this.billboard) this.billboard.visible = true;

      const actorPos = this.actor.mesh.position;
      const totalHeight = settings.wireHeight * this.actorSize;

      // Update anchor point (attached to actor)
      this.points[0].setPos(actorPos.x, actorPos.y, actorPos.z);

      // Update top point (billboard position) - allow slight drift for organic feel
      const topPoint = this.points[this.points.length - 1];
      const time = performance.now() * 0.001;
      const swayX = Math.sin(time * 1.5 + this.actorSize * 10) * 0.3 * this.actorSize;
      const swayZ = Math.cos(time * 1.2 + this.actorSize * 5) * 0.3 * this.actorSize;
      topPoint.setPos(actorPos.x + swayX, actorPos.y + totalHeight, actorPos.z + swayZ);

      // Physics simulation with organic movement
      const gravity = settings.wireGravity * this.actorSize;
      const friction = settings.wireFriction;

      for (const p of this.points) {
        // Add slight random wind force for organic movement
        if (!p.pinned) {
          const windX = (Math.random() - 0.5) * 0.02 * this.actorSize;
          const windZ = (Math.random() - 0.5) * 0.02 * this.actorSize;
          p.pos.x += windX;
          p.pos.z += windZ;
        }
        p.update(gravity, friction);
      }

      // Constraint iterations
      for (let i = 0; i < settings.wireIterations; i++) {
        for (const stick of this.sticks) {
          stick.update();
        }
      }

      // Update line geometry
      const positions = this.line.geometry.attributes.position.array;
      for (let i = 0; i < this.points.length; i++) {
        positions[i * 3] = this.points[i].pos.x;
        positions[i * 3 + 1] = this.points[i].pos.y;
        positions[i * 3 + 2] = this.points[i].pos.z;
      }
      this.line.geometry.attributes.position.needsUpdate = true;

      // Update billboard position (keeps facing up)
      const lastPoint = this.points[this.points.length - 1];
      this.billboard.position.copy(lastPoint.pos);
    }

    dispose() {
      if (this.line) {
        scene.remove(this.line);
        this.line.geometry.dispose();
        this.line.material.dispose();
      }
      if (this.billboard) {
        scene.remove(this.billboard);
        this.billboard.geometry.dispose();
        this.billboard.material.dispose();
      }
    }
  }

  // Store wire instances
  const fugitiveWires = [];

  function updateWireBillboards() {
    for (const wire of fugitiveWires) {
      if (wire.billboard) {
        const billboardSize = settings.wireCubeSize * wire.actorSize * 2;
        wire.billboard.geometry.dispose();
        wire.billboard.geometry = new THREE.PlaneGeometry(billboardSize, billboardSize);
      }
    }
  }

  // Collision check
  function checkCollision(a, b, radius) {
    const da = a.position;
    const db = b.position;
    const dx = da.x - db.x;
    const dy = da.y - db.y;
    const dz = da.z - db.z;
    const distSq = dx * dx + dy * dy + dz * dz;
    const r = radius * 2;
    return distSq < r * r;
  }

  // Game loop
  function animate(timestamp) {
    requestAnimationFrame(animate);
    const t = timestamp / 1000;
    const dt = STATE.lastTime ? Math.min(t - STATE.lastTime, 0.05) : 0;
    STATE.lastTime = t;

    if (STATE.loaded && settings.gameStarted && !STATE.gameOver) {
      updateGame(dt);
    }

    // Update wires (always, even before game starts)
    if (STATE.loaded) {
      for (const wire of fugitiveWires) {
        wire.update();
      }
    }

    // Render main scene with or without post-processing
    if (composer && (settings.bloomEnabled || settings.fxaaEnabled)) {
      // Update render pass camera in case it changed
      if (renderPass) renderPass.camera = camera;
      composer.render();
    } else {
      renderer.render(scene, camera);
    }
  }

  function updateGame(dt) {
    if (!STATE.loaded) return;

    const { tryMove, projectYOnRoad } = STATE;

    // Count active chasers and calculate speed bonuses
    const activeChaserCount = chasers.filter(c => c.active).length;
    let chaserSpeedBonus = 0;
    let fugitiveSpeedBonus = 0;

    if (activeChaserCount === 1) {
      chaserSpeedBonus = 0.1;
    } else if (activeChaserCount === 2) {
      chaserSpeedBonus = 0.05;
    } else if (activeChaserCount === 3) {
      fugitiveSpeedBonus = 0.1;
    } else if (activeChaserCount >= 4) {
      fugitiveSpeedBonus = 0.2;
    }

    // Update fugitives (AI escape behavior)
    for (const f of fugitives) {
      if (f.captured) continue;
      f.speed = settings.fugitiveSpeed + fugitiveSpeedBonus;
      updateFugitiveMovement(f, dt);
    }

    // Update chasers (player-controlled via keyboard)
    for (let i = 0; i < chasers.length; i++) {
      const chaser = chasers[i];

      // Check if player pressed any movement key to activate this chaser
      const inputDir = getChaserInputDirection(i);
      if (!chaser.active && inputDir.hasInput) {
        chaser.active = true;
        chaser.mesh.visible = true;
      }

      // Only update active chasers
      if (!chaser.active) continue;

      // Apply speed bonus based on active chaser count
      chaser.speed = settings.chaserSpeed + chaserSpeedBonus;

      updateChaserMovement(chaser, dt, i);

      // Check collision with fugitives
      for (const f of fugitives) {
        if (f.captured) continue;
        if (checkCollision(chaser.mesh, f.mesh, STATE.actorRadius || 2.5)) {
          f.captured = true;
          scene.remove(f.mesh);
          statusEl.textContent = `Fugitive ${f.index + 1} captured!`;
        }
      }
    }

    // Check if all fugitives captured
    const remaining = fugitives.filter(f => !f.captured).length;
    if (remaining === 0) {
      STATE.gameOver = true;
      statusEl.textContent = "All fugitives captured! Chasers win!";
    }
  }

  // Cardinal directions only: North (+Z), South (-Z), East (+X), West (-X)
  const CARDINAL_DIRS = [
    { x: 0, z: 1, name: "N" },   // North
    { x: 0, z: -1, name: "S" },  // South
    { x: 1, z: 0, name: "E" },   // East
    { x: -1, z: 0, name: "W" },  // West
  ];

  // Look ahead to see how far we can travel in a direction (for pathfinding)
  function measurePathLength(startX, startZ, dir, maxDist, isOnRoad) {
    let dist = 0;
    const step = 0.5;
    let x = startX;
    let z = startZ;

    while (dist < maxDist) {
      const nextX = x + dir.x * step;
      const nextZ = z + dir.z * step;
      if (!isOnRoad(nextX, nextZ)) break;
      x = nextX;
      z = nextZ;
      dist += step;
    }
    return dist;
  }

  // Check which directions are available from a position
  function getAvailableDirections(x, z, isOnRoad, minDist = 0.5) {
    const available = [];
    for (const dir of CARDINAL_DIRS) {
      const testX = x + dir.x * minDist;
      const testZ = z + dir.z * minDist;
      if (isOnRoad(testX, testZ)) {
        available.push(dir);
      }
    }
    return available;
  }

  // Score a direction based on target goal with look-ahead pathfinding
  function scoreDirection(startX, startZ, dir, targetX, targetZ, isOnRoad, lookAhead = 15) {
    // Measure how far we can go in this direction
    const pathLen = measurePathLength(startX, startZ, dir, lookAhead, isOnRoad);
    if (pathLen < 0.5) return -1000; // Can't move this way

    // Calculate position after moving in this direction
    const endX = startX + dir.x * pathLen;
    const endZ = startZ + dir.z * pathLen;

    // Check what directions are available at the end of this path
    const futureOptions = getAvailableDirections(endX, endZ, isOnRoad);

    // Distance to target from end position
    const distToTarget = Math.sqrt((targetX - endX) ** 2 + (targetZ - endZ) ** 2);

    // Direct alignment with target (dot product)
    const dx = targetX - startX;
    const dz = targetZ - startZ;
    const targetDist = Math.sqrt(dx * dx + dz * dz);
    const alignment = targetDist > 0.1 ? (dir.x * dx + dir.z * dz) / targetDist : 0;

    // Score: prioritize alignment, then path length, then future options
    // Higher alignment = better (moving toward target)
    // Longer paths = slightly better (fewer turns needed)
    // More future options = better (not getting trapped)
    return alignment * 10 - distToTarget * 0.5 + pathLen * 0.3 + futureOptions.length * 2;
  }

  // Fugitive AI: escape from chasers, only decide at intersections
  function updateFugitiveMovement(actor, dt) {
    const { tryMove, projectYOnRoad, isOnRoad, findNearestRoadPoint } = STATE;
    const intelligence = settings.fugitiveIntelligence;

    const pos = actor.mesh.position;
    const moveDistance = actor.speed * dt;

    // Safety check: if actor is off-road, snap back to nearest road point
    if (!isOnRoad(pos.x, pos.z)) {
      const roadPoint = findNearestRoadPoint(pos.x, pos.z);
      pos.x = roadPoint.x;
      pos.z = roadPoint.z;
      projectYOnRoad(pos);
      return;
    }

    // Try to move in current direction first
    const newPos = tryMove(pos.x, pos.z, actor.dirX, actor.dirZ, moveDistance, 0);
    const moved = Math.abs(newPos.x - pos.x) > 0.001 || Math.abs(newPos.z - pos.z) > 0.001;

    if (moved) {
      pos.x = newPos.x;
      pos.z = newPos.z;
      projectYOnRoad(pos);
    }

    // Get available directions at current position
    const available = getAvailableDirections(pos.x, pos.z, isOnRoad);
    if (available.length === 0) return;

    // Check if we're at an intersection (more than 2 directions, or different from just forward/back)
    const currentDir = CARDINAL_DIRS.find(d => d.x === actor.dirX && d.z === actor.dirZ);
    const reverseDir = CARDINAL_DIRS.find(d => d.x === -actor.dirX && d.z === -actor.dirZ);
    const hasNewOptions = available.some(d => d !== currentDir && d !== reverseDir);
    const isIntersection = available.length >= 3 || (available.length === 2 && hasNewOptions);

    // Check if we're far enough from last decision point
    const distFromLastDecision = Math.sqrt(
      Math.pow(pos.x - actor.lastIntersectionX, 2) +
      Math.pow(pos.z - actor.lastIntersectionZ, 2)
    );
    const canDecide = distFromLastDecision > 2.0; // Minimum distance before new decision

    // Decide on new direction only when: blocked OR at a new intersection
    const needsNewDirection = !moved || (isIntersection && canDecide);

    if (needsNewDirection) {
      // Mark this as our decision point
      actor.lastIntersectionX = pos.x;
      actor.lastIntersectionZ = pos.z;

      // Calculate threat from chasers
      let threatX = 0;
      let threatZ = 0;
      let closestChaserDist = Infinity;

      for (const c of chasers) {
        if (!c.active) continue;
        const dx = pos.x - c.mesh.position.x;
        const dz = pos.z - c.mesh.position.z;
        const dist = Math.sqrt(dx * dx + dz * dz);
        if (dist < closestChaserDist) closestChaserDist = dist;
        if (dist > 0.1) {
          const weight = 1 / (dist * dist + 0.1);
          threatX += (dx / dist) * weight;
          threatZ += (dz / dist) * weight;
        }
      }

      const threatLen = Math.sqrt(threatX * threatX + threatZ * threatZ);
      const hasThreat = threatLen > 0.01 && closestChaserDist < 30;

      let chosenDir;

      if (hasThreat) {
        // Escape mode: pick best direction away from threat
        threatX /= threatLen;
        threatZ /= threatLen;
        const escapeTargetX = pos.x + threatX * 50;
        const escapeTargetZ = pos.z + threatZ * 50;

        const scored = available.map(dir => ({
          dir,
          score: scoreDirection(pos.x, pos.z, dir, escapeTargetX, escapeTargetZ, isOnRoad, 20)
        }));
        scored.sort((a, b) => b.score - a.score);

        // Smart choice with some randomness based on intelligence
        const randomChance = 1 - intelligence;
        if (Math.random() < randomChance && scored.length > 1) {
          chosenDir = scored[Math.floor(Math.random() * Math.min(2, scored.length))].dir;
        } else {
          chosenDir = scored[0].dir;
        }
      } else {
        // Wander mode: explore the map organically
        const canContinue = currentDir && available.includes(currentDir);

        if (canContinue && !moved) {
          // We're blocked going forward, must turn
          const otherDirs = available.filter(d => d !== currentDir);
          chosenDir = otherDirs[Math.floor(Math.random() * otherDirs.length)] || available[0];
        } else if (available.length >= 3) {
          // At a real intersection (3+ choices) - more likely to explore/turn
          const nonReverse = available.filter(d => d !== reverseDir);
          if (Math.random() < 0.4 && canContinue) {
            // 40% continue forward
            chosenDir = currentDir;
          } else {
            // 60% pick a new direction to explore
            const newDirs = nonReverse.filter(d => d !== currentDir);
            chosenDir = newDirs.length > 0
              ? newDirs[Math.floor(Math.random() * newDirs.length)]
              : nonReverse[Math.floor(Math.random() * nonReverse.length)];
          }
        } else if (canContinue) {
          // In a corridor - mostly continue forward
          chosenDir = currentDir;
        } else {
          // Dead end or only turn available - pick any non-reverse direction
          const nonReverse = available.filter(d => d !== reverseDir);
          const choices = nonReverse.length > 0 ? nonReverse : available;
          chosenDir = choices[Math.floor(Math.random() * choices.length)];
        }
      }

      actor.dirX = chosenDir.x;
      actor.dirZ = chosenDir.z;
    }
  }

  // Chaser movement: Pac-Man style with queued turns
  // C1: WASD, C2: TFGH, C3: IJKL, C4: Arrow keys
  function updateChaserMovement(actor, dt, chaserIndex) {
    const { tryMove, projectYOnRoad, isOnRoad, findNearestRoadPoint } = STATE;

    const pos = actor.mesh.position;
    const moveDistance = actor.speed * dt;

    // Safety check: if actor is off-road, snap back to nearest road point
    if (!isOnRoad(pos.x, pos.z)) {
      const roadPoint = findNearestRoadPoint(pos.x, pos.z);
      pos.x = roadPoint.x;
      pos.z = roadPoint.z;
      projectYOnRoad(pos);
      return;
    }

    // Get input direction for this chaser from keyboard
    const inputDir = getChaserInputDirection(chaserIndex);

    // Queue the desired direction when player presses a key
    if (inputDir.hasInput) {
      actor.queuedDirX = inputDir.x;
      actor.queuedDirZ = inputDir.z;
    }

    // Helper: check if we can move in a direction using simple point check (no margin)
    function canMoveInDirection(dx, dz, distance) {
      // Check if the target point is on road
      const targetX = pos.x + dx * distance;
      const targetZ = pos.z + dz * distance;
      return isOnRoad(targetX, targetZ);
    }

    // Try to execute the queued direction if we have one
    if (actor.queuedDirX !== 0 || actor.queuedDirZ !== 0) {
      // Check if we can move in the queued direction
      if (canMoveInDirection(actor.queuedDirX, actor.queuedDirZ, moveDistance * 3)) {
        actor.dirX = actor.queuedDirX;
        actor.dirZ = actor.queuedDirZ;
        actor.queuedDirX = 0;
        actor.queuedDirZ = 0;
      }
    }

    // Always move in current direction (continuous movement, no margin)
    if (actor.dirX !== 0 || actor.dirZ !== 0) {
      const newPos = tryMove(pos.x, pos.z, actor.dirX, actor.dirZ, moveDistance, 0);

      // Check if we actually moved
      const moved = Math.abs(newPos.x - pos.x) > 0.001 || Math.abs(newPos.z - pos.z) > 0.001;

      if (moved) {
        pos.x = newPos.x;
        pos.z = newPos.z;
        projectYOnRoad(pos);
      }
      // If blocked, just wait - the queued direction will execute when possible
    }
  }

  animate(0);
})();
