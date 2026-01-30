// Jagad - Chase Game
// Main entry point

import * as THREE from "./lib/three/three.module.js";
import { GLTFLoader } from "./lib/three/addons/loaders/GLTFLoader.js";
import { EffectComposer } from "./lib/three/addons/postprocessing/EffectComposer.js";
import { RenderPass } from "./lib/three/addons/postprocessing/RenderPass.js";
import { UnrealBloomPass } from "./lib/three/addons/postprocessing/UnrealBloomPass.js";
import { OutputPass } from "./lib/three/addons/postprocessing/OutputPass.js";
import { ShaderPass } from "./lib/three/addons/postprocessing/ShaderPass.js";
import { FXAAShader } from "./lib/three/addons/shaders/FXAAShader.js";
// CSS3DRenderer not needed - using canvas texture approach instead

import { STORAGE_KEY, defaultSettings, loadSettings, saveSettings, clearSettings } from "./game/settings.js";
import { PATHS, FACE_TEXTURES, CHASER_CONTROLS, CARDINAL_DIRS } from "./game/constants.js";

// lil-gui loaded via script tag in index.html
const GUI = window.lil.GUI;

(() => {
  // ============================================
  // CORE SETUP
  // ============================================

  const canvas = document.getElementById("game-canvas");

  const statusEl = {
    set textContent(val) {
      console.log("[Status]", val);
    }
  };

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x000000);

  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setClearColor(0x000000, 0);
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;


  // ============================================
  // STATE
  // ============================================

  let buildingPlane = null;
  let camera;
  let orthoCamera;
  let perspCamera;
  const glbCameras = [];

  const defaultCamera = new THREE.PerspectiveCamera(55, window.innerWidth / window.innerHeight, 0.1, 5000);
  defaultCamera.position.set(0, 100, 100);
  camera = defaultCamera;

  const fugitives = [];
  const chasers = [];

  let composer = null;
  let renderPass = null;
  let bloomPass = null;
  let fxaaPass = null;
  let outputPass = null;

  const settings = {
    gameStarted: false,
    ...loadSettings(),
    startGame: function() {
      if (!STATE.loaded) return;
      settings.gameStarted = true;
      STATE.gameOver = false;
      statusEl.textContent = "Game started! Escape the chasers!";
    },
    saveSettings: function() {
      if (saveSettings(settings)) {
        statusEl.textContent = "Settings saved!";
      } else {
        statusEl.textContent = "Failed to save settings.";
      }
    },
    clearSettings: function() {
      if (clearSettings()) {
        statusEl.textContent = "Settings cleared! Reload to apply defaults.";
      }
    },
  };

  let guiLeft = null;

  const STATE = {
    loaded: false,
    gameOver: false,
    lastTime: 0,
    levelCenter: new THREE.Vector3(),
    horizontalSize: 100,
    levelContainer: null,
  };

  // ============================================
  // GLASS OVERLAY (Canvas texture on GLASS mesh)
  // ============================================

  let glassMeshes = [];
  let glassCanvas = null;
  let glassContext = null;
  let glassTexture = null;
  let marqueeOffset = 0;
  let lastMarqueeTime = 0;

  // Preload fonts for canvas usage
  async function preloadFonts() {
    const fonts = [
      { family: "BankGothic", weight: "bold" },
      { family: "BankGothic Md BT", weight: "500" },
      { family: "Bank Gothic", weight: "300" },
    ];

    for (const font of fonts) {
      try {
        await document.fonts.load(`${font.weight} 48px "${font.family}"`);
        console.log(`Font loaded: ${font.family}`);
      } catch (e) {
        console.warn(`Could not load font: ${font.family}`);
      }
    }
  }

  // Create offscreen canvas for rendering text
  function initGlassCanvas() {
    glassCanvas = document.createElement("canvas");
    glassCanvas.width = 1024;
    glassCanvas.height = 1024;
    glassContext = glassCanvas.getContext("2d");
    glassTexture = new THREE.CanvasTexture(glassCanvas);
    glassTexture.minFilter = THREE.LinearFilter;
    glassTexture.magFilter = THREE.LinearFilter;

    // Preload fonts then update canvas
    preloadFonts().then(() => {
      lastMarqueeTime = performance.now();
      updateGlassCanvas(lastMarqueeTime);
    });
  }

  function updateGlassCanvas(timestamp = 0) {
    if (!glassContext) return;

    const ctx = glassContext;
    const w = glassCanvas.width;
    const h = glassCanvas.height;

    // Clear canvas
    ctx.clearRect(0, 0, w, h);

    // Flip vertically to correct upside-down text
    ctx.save();
    ctx.translate(0, h);
    ctx.scale(1, -1);

    // Draw background
    ctx.fillStyle = `rgba(0, 0, 0, ${settings.glassOpacity})`;
    ctx.fillRect(0, 0, w, h);

    // Get text rows
    const rows = [
      settings.glassTextRow1,
      settings.glassTextRow2,
      settings.glassTextRow3,
      settings.glassTextRow4,
    ].filter(row => row && row.trim() !== "");

    if (rows.length === 0) {
      ctx.restore();
      if (glassTexture) glassTexture.needsUpdate = true;
      return;
    }

    // Setup text style
    const fontSize = settings.glassTextFontSize;
    const lineHeight = fontSize * settings.glassTextLineHeight;
    const fontFamily = settings.glassTextFont || "BankGothic";
    ctx.fillStyle = settings.glassTextColor;
    ctx.font = `bold ${fontSize}px "${fontFamily}", Arial, sans-serif`;
    ctx.textBaseline = "middle";

    // Calculate total height of text block
    const totalHeight = rows.length * lineHeight;
    const startY = (h - totalHeight) / 2 + lineHeight / 2;

    // Handle marquee animation - organic letter-by-letter wrapping
    if (settings.glassTextMarquee) {
      // Update marquee offset based on time
      const dt = timestamp - lastMarqueeTime;
      lastMarqueeTime = timestamp;
      if (dt > 0 && dt < 100) {
        marqueeOffset += (settings.glassTextMarqueeSpeed * dt) / 1000;
      }

      ctx.textAlign = "left";

      for (let i = 0; i < rows.length; i++) {
        const y = startY + i * lineHeight;
        const text = rows[i];
        // Apply row delay offset (each row starts further back)
        const rowOffset = marqueeOffset - (i * settings.glassTextRowDelay);

        // Measure each character and draw individually with wrapping
        let xAccum = 0;
        const charWidths = [];
        for (let c = 0; c < text.length; c++) {
          charWidths.push(ctx.measureText(text[c]).width);
        }
        const totalTextWidth = charWidths.reduce((a, b) => a + b, 0);

        // Draw each character with organic wrapping
        for (let c = 0; c < text.length; c++) {
          // Calculate this character's base position (scrolling right to left)
          let charX = w - rowOffset + xAccum;

          // Wrap character position organically within canvas bounds
          // When a letter goes too far right, wrap it to the left
          // When it goes too far left, wrap it to the right
          while (charX > w + charWidths[c]) {
            charX -= (w + totalTextWidth);
          }
          while (charX < -totalTextWidth) {
            charX += (w + totalTextWidth);
          }

          // Only draw if character is visible on canvas
          if (charX > -charWidths[c] && charX < w + charWidths[c]) {
            ctx.fillText(text[c], charX, y);
          }

          xAccum += charWidths[c];
        }
      }
    } else {
      // Static text
      ctx.textAlign = settings.glassTextAlign;
      let xPos;
      switch (settings.glassTextAlign) {
        case "left": xPos = 50; break;
        case "right": xPos = w - 50; break;
        default: xPos = w / 2; break;
      }

      for (let i = 0; i < rows.length; i++) {
        const y = startY + i * lineHeight;
        ctx.fillText(rows[i], xPos, y);
      }
    }

    // Restore canvas state (undo the flip)
    ctx.restore();

    // Update texture
    if (glassTexture) {
      glassTexture.needsUpdate = true;
    }
  }

  // Public API to update the glass content (sets all 4 rows at once)
  window.setGlassContent = function(row1 = "", row2 = "", row3 = "", row4 = "") {
    settings.glassTextRow1 = row1;
    settings.glassTextRow2 = row2;
    settings.glassTextRow3 = row3;
    settings.glassTextRow4 = row4;
    updateGlassCanvas();
  };

  // Public API to update a single row
  window.setGlassRow = function(rowNum, text) {
    if (rowNum >= 1 && rowNum <= 4) {
      settings[`glassTextRow${rowNum}`] = text;
      updateGlassCanvas();
    }
  };

  // Public API to draw custom content on the glass
  window.drawOnGlass = function(callback) {
    if (glassContext) {
      callback(glassContext, glassCanvas.width, glassCanvas.height);
      if (glassTexture) {
        glassTexture.needsUpdate = true;
      }
    }
  };

  function setupGlassMeshes(meshes) {
    glassMeshes = meshes;
    initGlassCanvas();

    for (const mesh of glassMeshes) {
      // Replace the material with one that uses our canvas texture
      const glassMaterial = new THREE.MeshBasicMaterial({
        map: glassTexture,
        transparent: true,
        opacity: 1.0,
        side: THREE.DoubleSide,
        depthWrite: false,
      });

      mesh.material = glassMaterial;
      mesh.renderOrder = 999; // Render on top

      console.log(`Applied glass texture to mesh: "${mesh.name}"`);
    }
  }

  // ============================================
  // INPUT
  // ============================================

  const keys = new Set();
  window.addEventListener("keydown", (e) => {
    const controlKeys = [
      "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight",
      "w", "a", "s", "d", "t", "f", "g", "h", "i", "j", "k", "l"
    ];
    if (controlKeys.includes(e.key) || controlKeys.includes(e.key.toLowerCase())) {
      e.preventDefault();
    }
    keys.add(e.key.toLowerCase());
  });
  window.addEventListener("keyup", (e) => keys.delete(e.key.toLowerCase()));

  function getChaserInputDirection(chaserIndex) {
    if (chaserIndex >= CHASER_CONTROLS.length) return { x: 0, z: 0, hasInput: false };
    const ctrl = CHASER_CONTROLS[chaserIndex];

    let dx = 0;
    let dz = 0;

    if (keys.has(ctrl.up)) dz = -1;
    if (keys.has(ctrl.down)) dz = 1;
    if (keys.has(ctrl.left)) dx = -1;
    if (keys.has(ctrl.right)) dx = 1;

    if (dz !== 0) dx = 0;

    const hasInput = dx !== 0 || dz !== 0;
    return { x: dx, z: dz, hasInput };
  }

  // ============================================
  // LIGHTS
  // ============================================

  const ambientLight = new THREE.AmbientLight(settings.ambientColor, settings.ambientIntensity);
  scene.add(ambientLight);

  // ============================================
  // CAMERAS
  // ============================================

  function setupCameras(levelCenter, horizontalSize) {
    const aspect = window.innerWidth / window.innerHeight;
    const distance = horizontalSize * 1.2;

    settings.perspPosX = levelCenter.x;
    settings.perspPosY = levelCenter.y + distance * 2.5;
    settings.perspPosZ = levelCenter.z;
    settings.perspLookX = levelCenter.x;
    settings.perspLookY = levelCenter.y;
    settings.perspLookZ = levelCenter.z;

    perspCamera = new THREE.PerspectiveCamera(settings.perspFov, aspect, settings.perspNear, settings.perspFar);
    perspCamera.position.set(settings.perspPosX, settings.perspPosY, settings.perspPosZ);
    perspCamera.lookAt(settings.perspLookX, settings.perspLookY, settings.perspLookZ);

    const frustumSize = horizontalSize * 1.5;
    orthoCamera = new THREE.OrthographicCamera(
      frustumSize * aspect / -2,
      frustumSize * aspect / 2,
      frustumSize / 2,
      frustumSize / -2,
      0.1,
      5000
    );
    orthoCamera.position.set(levelCenter.x, levelCenter.y + distance, levelCenter.z);
    orthoCamera.lookAt(levelCenter);
    orthoCamera.zoom = settings.orthoZoom;
    orthoCamera.updateProjectionMatrix();

    camera = settings.cameraType === "orthographic" ? orthoCamera : perspCamera;
  }

  function switchCamera(type) {
    settings.cameraType = type;
    if (type === "orthographic") {
      camera = orthoCamera;
    } else if (type === "perspective") {
      camera = perspCamera;
    } else {
      const glbCam = glbCameras.find(c => c.name === type);
      if (glbCam) {
        camera = glbCam.camera;
        if (camera.isPerspectiveCamera) {
          camera.aspect = window.innerWidth / window.innerHeight;
          camera.updateProjectionMatrix();
        }
      }
    }
  }

  // ============================================
  // RESIZE
  // ============================================

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

  // ============================================
  // GUI
  // ============================================

  function setupGUI() {
    // Single unified GUI
    guiLeft = new GUI({ title: "Controls" });
    guiLeft.domElement.style.position = "absolute";
    guiLeft.domElement.style.left = "10px";
    guiLeft.domElement.style.top = "0px";

    const gameCanvas = document.getElementById("game-canvas");

    // ==================== GAME ====================
    const gameFolder = guiLeft.addFolder("Game");
    gameFolder.add(settings, "startGame").name("Start Game");
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
    gameFolder.add(settings, "faceSwapDuration", 0, 120, 1).name("Face Swap (sec)");
    gameFolder.add(settings, "faceSwapFade").name("Face Swap Fade");
    gameFolder.add(settings, "faceSwapFadeDuration", 0.1, 3, 0.1).name("Fade Duration (sec)");
    gameFolder.close();

    // ==================== CAMERA ====================
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
    orthoFolder.close();

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

    perspFolder.add(settings, "perspPosX", -500, 500, 0.01).name("Pos X").onChange(updatePerspCameraPos);
    perspFolder.add(settings, "perspPosY", 0, 500, 0.01).name("Pos Y").onChange(updatePerspCameraPos);
    perspFolder.add(settings, "perspPosZ", -500, 500, 0.01).name("Pos Z").onChange(updatePerspCameraPos);
    perspFolder.add(settings, "perspLookX", -500, 500, 0.01).name("Look X").onChange(updatePerspCameraPos);
    perspFolder.add(settings, "perspLookY", -500, 500, 0.01).name("Look Y").onChange(updatePerspCameraPos);
    perspFolder.add(settings, "perspLookZ", -500, 500, 0.01).name("Look Z").onChange(updatePerspCameraPos);
    perspFolder.close();
    cameraFolder.close();

    // ==================== LIGHTS ====================
    const lightsFolder = guiLeft.addFolder("Lights");

    const fugitiveLightFolder = lightsFolder.addFolder("Fugitive Lights");
    fugitiveLightFolder.addColor(settings, "fugitive1Color").name("Fugitive 1").onChange(updateFugitiveLights);
    fugitiveLightFolder.addColor(settings, "fugitive2Color").name("Fugitive 2").onChange(updateFugitiveLights);
    fugitiveLightFolder.addColor(settings, "fugitive3Color").name("Fugitive 3").onChange(updateFugitiveLights);
    fugitiveLightFolder.addColor(settings, "fugitive4Color").name("Fugitive 4").onChange(updateFugitiveLights);
    fugitiveLightFolder.add(settings, "fugitiveLightIntensity", 0, 10, 0.1).name("Intensity").onChange(updateFugitiveLights);
    fugitiveLightFolder.close();

    const chaserLightFolder = lightsFolder.addFolder("Chaser Lights");
    chaserLightFolder.addColor(settings, "chaserColor").name("Color").onChange(updateChaserLights);
    chaserLightFolder.add(settings, "chaserLightIntensity", 0, 100, 1).name("Intensity").onChange(updateChaserLights);
    chaserLightFolder.close();

    const ambientFolder = lightsFolder.addFolder("Ambient Light");
    ambientFolder.addColor(settings, "ambientColor").name("Color").onChange((v) => {
      ambientLight.color.set(v);
    });
    ambientFolder.add(settings, "ambientIntensity", 0, 5, 0.1).name("Intensity").onChange((v) => {
      ambientLight.intensity = v;
    });
    ambientFolder.close();
    lightsFolder.close();

    // ==================== FUGITIVE WIRES ====================
    const wireFolder = guiLeft.addFolder("Fugitive Wires");
    wireFolder.add(settings, "wireEnabled").name("Enabled");
    wireFolder.add(settings, "wireHeight", 2, 20, 0.5).name("Height");
    wireFolder.add(settings, "wireGravity", 0, 0.5, 0.01).name("Gravity");
    wireFolder.add(settings, "wireFriction", 0.8, 0.99, 0.01).name("Friction");
    wireFolder.add(settings, "wireCubeSize", 0.2, 4, 0.1).name("Billboard Size").onChange(updateWireBillboards);
    wireFolder.close();

    // ==================== BUILDING PLANE ====================
    function updateBuildingPlane() {
      if (!buildingPlane || !STATE.levelCenter || !STATE.horizontalSize) return;

      const sizeX = STATE.horizontalSize * settings.buildingScaleX;
      const sizeY = STATE.horizontalSize * settings.buildingScaleY;
      buildingPlane.geometry.dispose();
      buildingPlane.geometry = new THREE.PlaneGeometry(sizeX, sizeY);

      buildingPlane.position.set(
        STATE.levelCenter.x + settings.buildingOffsetX,
        (STATE.streetY || 0) + settings.buildingOffsetY,
        STATE.levelCenter.z + settings.buildingOffsetZ
      );

      buildingPlane.material.opacity = settings.buildingOpacity;
      buildingPlane.material.transparent = settings.buildingOpacity < 1;
      buildingPlane.visible = settings.buildingEnabled;
    }

    const backdropFolder = guiLeft.addFolder("Building Plane");
    backdropFolder.add(settings, "buildingEnabled").name("Enabled").onChange(updateBuildingPlane);
    backdropFolder.add(settings, "buildingScaleX", 0.1, 3, 0.01).name("Scale X").onChange(updateBuildingPlane);
    backdropFolder.add(settings, "buildingScaleY", 0.1, 3, 0.01).name("Scale Y").onChange(updateBuildingPlane);
    backdropFolder.add(settings, "buildingOffsetX", -50, 50, 0.01).name("Offset X").onChange(updateBuildingPlane);
    backdropFolder.add(settings, "buildingOffsetY", -50, 10, 0.01).name("Offset Y (Depth)").onChange(updateBuildingPlane);
    backdropFolder.add(settings, "buildingOffsetZ", -50, 50, 0.01).name("Offset Z").onChange(updateBuildingPlane);
    backdropFolder.add(settings, "buildingOpacity", 0, 1, 0.05).name("Opacity").onChange(updateBuildingPlane);
    STATE.updateBuildingPlane = updateBuildingPlane;
    backdropFolder.close();

    // ==================== LEVEL APPEARANCE ====================
    const levelAppearanceFolder = guiLeft.addFolder("Level Appearance");

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

    STATE.updateLevelOpacity = updateLevelOpacity;
    STATE.updateLevelBlendMode = updateLevelBlendMode;

    const blendModes = ["Normal", "Additive", "Subtractive", "Multiply", "Screen", "Overlay", "Lighten", "Darken"];
    levelAppearanceFolder.add(settings, "levelOpacity", 0, 1, 0.01).name("Opacity").onChange(updateLevelOpacity);
    levelAppearanceFolder.add(settings, "levelBlendMode", blendModes).name("Blend Mode").onChange(updateLevelBlendMode);
    levelAppearanceFolder.close();

    // ==================== CANVAS BLENDING ====================
    const canvasFolder = guiLeft.addFolder("Canvas Blending");
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

    if (gameCanvas) {
      gameCanvas.style.mixBlendMode = settings.canvasBlendMode;
      gameCanvas.style.opacity = settings.canvasOpacity;
    }
    canvasFolder.close();

    // ==================== POST-PROCESSING ====================
    const postFolder = guiLeft.addFolder("Post-Processing");

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
    bloomFolder.close();

    postFolder.add(settings, "fxaaEnabled").name("FXAA Anti-Aliasing").onChange(updatePostProcessing);
    postFolder.close();

    // ==================== GLASS OVERLAY ====================
    const glassFolder = guiLeft.addFolder("Glass Overlay");
    glassFolder.add(settings, "glassEnabled").name("Enabled").onChange((v) => {
      for (const mesh of glassMeshes) {
        mesh.visible = v;
      }
    });
    glassFolder.add(settings, "glassOpacity", 0, 1, 0.05).name("Background Opacity").onChange((v) => {
      updateGlassCanvas();
    });

    const textRowsFolder = glassFolder.addFolder("Text Rows");
    textRowsFolder.add(settings, "glassTextRow1").name("Row 1").onChange(() => updateGlassCanvas());
    textRowsFolder.add(settings, "glassTextRow2").name("Row 2").onChange(() => updateGlassCanvas());
    textRowsFolder.add(settings, "glassTextRow3").name("Row 3").onChange(() => updateGlassCanvas());
    textRowsFolder.add(settings, "glassTextRow4").name("Row 4").onChange(() => updateGlassCanvas());
    textRowsFolder.close();

    const textStyleFolder = glassFolder.addFolder("Text Style");
    textStyleFolder.add(settings, "glassTextFont", ["BankGothic", "BankGothic Md BT", "Bank Gothic", "Arial", "Impact", "Georgia"]).name("Font").onChange(() => updateGlassCanvas());
    textStyleFolder.add(settings, "glassTextFontSize", 20, 200, 5).name("Font Size").onChange(() => updateGlassCanvas());
    textStyleFolder.add(settings, "glassTextLineHeight", 1, 3, 0.1).name("Line Height").onChange(() => updateGlassCanvas());
    textStyleFolder.addColor(settings, "glassTextColor").name("Color").onChange(() => updateGlassCanvas());
    textStyleFolder.add(settings, "glassTextAlign", ["left", "center", "right"]).name("Align").onChange(() => updateGlassCanvas());
    textStyleFolder.close();

    const marqueeFolder = glassFolder.addFolder("Marquee Animation");
    marqueeFolder.add(settings, "glassTextMarquee").name("Enable Marquee").onChange((v) => {
      if (v) {
        marqueeOffset = 0;
        lastMarqueeTime = performance.now();
      }
      updateGlassCanvas();
    });
    marqueeFolder.add(settings, "glassTextMarqueeSpeed", 0, 500, 5).name("Speed (px/s)");
    marqueeFolder.add(settings, "glassTextRowDelay", 0, 500, 10).name("Row Delay (px)");
    marqueeFolder.close();
    glassFolder.close();

    // ==================== SETTINGS STORAGE ====================
    const settingsFolder = guiLeft.addFolder("Settings Storage");
    settingsFolder.add(settings, "saveSettings").name("Save Settings");
    settingsFolder.add(settings, "clearSettings").name("Clear Settings");
    settingsFolder.close();

    // Store reference for GLB parts to add to later
    STATE.mainGUI = guiLeft;
  }

  // ============================================
  // GLB PARTS GUI
  // ============================================

  const glbParts = new Map();

  function setupGLBPartsGUI() {
    if (!STATE.levelContainer || !STATE.mainGUI) return;

    STATE.levelContainer.traverse((obj) => {
      if (obj.isMesh && obj.name && obj.material) {
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

    // Add GLB Parts folder to main GUI
    const glbPartsFolder = STATE.mainGUI.addFolder("GLB Parts");

    glbParts.forEach((data, name) => {
      const partSettings = {
        color: "#" + data.originalColor.getHexString(),
        opacity: data.originalOpacity,
        visible: true
      };

      const folder = glbPartsFolder.addFolder(name);
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
      folder.close();
    });

    glbPartsFolder.close();
    console.log(`Created GUI controls for ${glbParts.size} GLB parts`);
  }

  // ============================================
  // POST-PROCESSING
  // ============================================

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

  function updatePostProcessing() {
    if (!composer) return;

    while (composer.passes.length > 1) {
      composer.passes.pop();
    }

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

  // ============================================
  // LIGHT UPDATES
  // ============================================

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

  // ============================================
  // ROPE PHYSICS
  // ============================================

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

  // ============================================
  // ACTOR WIRE (BILLBOARD) SYSTEM
  // ============================================

  class ActorWire {
    constructor(actor, actorSize, color, isChaser = true, index = 0) {
      this.actor = actor;
      this.actorSize = actorSize;
      this.color = color;
      this.isChaser = isChaser;
      this.index = index;
      this.points = [];
      this.sticks = [];
      this.line = null;
      this.cube = null;
      this.cubeLight = null;

      // Fade state
      this.isFading = false;
      this.fadeProgress = 1.0;
      this.fadeDirection = 0;
      this.pendingTextureSwap = false;

      this.initWire();
    }

    initWire() {
      const segmentCount = settings.wireSegments;
      const totalHeight = settings.wireHeight * this.actorSize;
      const segmentLength = totalHeight / segmentCount;

      const actorPos = this.actor.mesh.position;

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

      this.points[0].pinned = true;
      this.points[this.points.length - 1].pinned = true;

      const positions = new Float32Array((segmentCount + 1) * 3);
      const geometry = new THREE.BufferGeometry();
      geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));

      const material = new THREE.LineBasicMaterial({
        color: this.color,
        linewidth: 2
      });

      this.line = new THREE.Line(geometry, material);
      scene.add(this.line);

      const billboardSize = settings.wireCubeSize * this.actorSize * 2;
      const billboardGeo = new THREE.PlaneGeometry(billboardSize, billboardSize);
      const billboardMat = new THREE.MeshBasicMaterial({
        color: 0xffffff,
        side: THREE.DoubleSide,
        transparent: true
      });
      this.billboard = new THREE.Mesh(billboardGeo, billboardMat);
      this.billboard.rotation.x = -Math.PI / 2;
      this.billboard.castShadow = true;
      scene.add(this.billboard);

      if (!this.isChaser) {
        const textureLoader = new THREE.TextureLoader();
        const pair = FACE_TEXTURES[this.index] || FACE_TEXTURES[0];
        this.textures = [null, null];
        this.currentTextureIndex = 0;

        const facePath = PATHS.images.faces;
        textureLoader.load(facePath + pair[0],
          (texture) => {
            console.log(`Loaded billboard texture A: ${pair[0]}`);
            this.textures[0] = texture;
            this.billboard.material.map = texture;
            this.billboard.material.needsUpdate = true;
          },
          undefined,
          (error) => {
            console.warn(`Could not load ${pair[0]}, using color fallback`);
            this.billboard.material.color.set(this.color);
          }
        );
        textureLoader.load(facePath + pair[1],
          (texture) => {
            console.log(`Loaded billboard texture B: ${pair[1]}`);
            this.textures[1] = texture;
          },
          undefined,
          (error) => {
            console.warn(`Could not load ${pair[1]}`);
          }
        );
      } else {
        this.billboard.material.color.set(this.color);
      }
    }

    swapTexture() {
      if (this.isChaser || !this.textures) return;

      if (settings.faceSwapFade && settings.faceSwapFadeDuration > 0) {
        // Start fade out
        this.isFading = true;
        this.fadeDirection = -1; // -1 = fading out, 1 = fading in
        this.fadeProgress = 1.0;
        this.pendingTextureSwap = true;
      } else {
        // Instant swap
        this.currentTextureIndex = 1 - this.currentTextureIndex;
        const newTexture = this.textures[this.currentTextureIndex];
        if (newTexture) {
          this.billboard.material.map = newTexture;
          this.billboard.material.needsUpdate = true;
        }
      }
    }

    updateFade(dt) {
      if (!this.isFading) return;

      const fadeSpeed = 1.0 / settings.faceSwapFadeDuration;
      this.fadeProgress += this.fadeDirection * fadeSpeed * dt;

      if (this.fadeDirection === -1 && this.fadeProgress <= 0) {
        // Fully faded out - swap texture and start fading in
        this.fadeProgress = 0;
        if (this.pendingTextureSwap) {
          this.currentTextureIndex = 1 - this.currentTextureIndex;
          const newTexture = this.textures[this.currentTextureIndex];
          if (newTexture) {
            this.billboard.material.map = newTexture;
            this.billboard.material.needsUpdate = true;
          }
          this.pendingTextureSwap = false;
        }
        this.fadeDirection = 1; // Start fading in
      } else if (this.fadeDirection === 1 && this.fadeProgress >= 1) {
        // Fully faded in - done
        this.fadeProgress = 1;
        this.isFading = false;
      }

      // Apply opacity
      this.billboard.material.opacity = this.fadeProgress;
      this.billboard.material.needsUpdate = true;
    }

    isVisible() {
      if (!settings.wireEnabled) return false;
      if (this.isChaser) {
        return this.actor.active;
      } else {
        return !this.actor.captured;
      }
    }

    update(dt = 0.016) {
      // Update fade animation
      this.updateFade(dt);

      if (!this.isVisible()) {
        if (this.line) this.line.visible = false;
        if (this.billboard) this.billboard.visible = false;
        return;
      }

      if (this.line) this.line.visible = true;
      if (this.billboard) this.billboard.visible = true;

      const actorPos = this.actor.mesh.position;
      const totalHeight = settings.wireHeight * this.actorSize;

      this.points[0].setPos(actorPos.x, actorPos.y, actorPos.z);

      const topPoint = this.points[this.points.length - 1];
      const time = performance.now() * 0.001;
      const swayX = Math.sin(time * 1.5 + this.actorSize * 10) * 0.3 * this.actorSize;
      const swayZ = Math.cos(time * 1.2 + this.actorSize * 5) * 0.3 * this.actorSize;
      topPoint.setPos(actorPos.x + swayX, actorPos.y + totalHeight, actorPos.z + swayZ);

      const gravity = settings.wireGravity * this.actorSize;
      const friction = settings.wireFriction;

      for (const p of this.points) {
        if (!p.pinned) {
          const windX = (Math.random() - 0.5) * 0.02 * this.actorSize;
          const windZ = (Math.random() - 0.5) * 0.02 * this.actorSize;
          p.pos.x += windX;
          p.pos.z += windZ;
        }
        p.update(gravity, friction);
      }

      for (let i = 0; i < settings.wireIterations; i++) {
        for (const stick of this.sticks) {
          stick.update();
        }
      }

      const positions = this.line.geometry.attributes.position.array;
      for (let i = 0; i < this.points.length; i++) {
        positions[i * 3] = this.points[i].pos.x;
        positions[i * 3 + 1] = this.points[i].pos.y;
        positions[i * 3 + 2] = this.points[i].pos.z;
      }
      this.line.geometry.attributes.position.needsUpdate = true;

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

  const fugitiveWires = [];
  let lastFaceSwapTime = 0;

  function updateWireBillboards() {
    for (const wire of fugitiveWires) {
      if (wire.billboard) {
        const billboardSize = settings.wireCubeSize * wire.actorSize * 2;
        wire.billboard.geometry.dispose();
        wire.billboard.geometry = new THREE.PlaneGeometry(billboardSize, billboardSize);
      }
    }
  }

  // ============================================
  // COLLISION
  // ============================================

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

  // ============================================
  // PATHFINDING
  // ============================================

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

  function scoreDirection(startX, startZ, dir, targetX, targetZ, isOnRoad, lookAhead = 15) {
    const pathLen = measurePathLength(startX, startZ, dir, lookAhead, isOnRoad);
    if (pathLen < 0.5) return -1000;

    const endX = startX + dir.x * pathLen;
    const endZ = startZ + dir.z * pathLen;

    const futureOptions = getAvailableDirections(endX, endZ, isOnRoad);

    const distToTarget = Math.sqrt((targetX - endX) ** 2 + (targetZ - endZ) ** 2);

    const dx = targetX - startX;
    const dz = targetZ - startZ;
    const targetDist = Math.sqrt(dx * dx + dz * dz);
    const alignment = targetDist > 0.1 ? (dir.x * dx + dir.z * dz) / targetDist : 0;

    return alignment * 10 - distToTarget * 0.5 + pathLen * 0.3 + futureOptions.length * 2;
  }

  // ============================================
  // MOVEMENT
  // ============================================

  function updateFugitiveMovement(actor, dt) {
    const { tryMove, projectYOnRoad, isOnRoad, findNearestRoadPoint } = STATE;
    const intelligence = settings.fugitiveIntelligence;

    const pos = actor.mesh.position;
    const moveDistance = actor.speed * dt;

    if (!isOnRoad(pos.x, pos.z)) {
      const roadPoint = findNearestRoadPoint(pos.x, pos.z);
      pos.x = roadPoint.x;
      pos.z = roadPoint.z;
      projectYOnRoad(pos);
      return;
    }

    const newPos = tryMove(pos.x, pos.z, actor.dirX, actor.dirZ, moveDistance, 0);
    const moved = Math.abs(newPos.x - pos.x) > 0.001 || Math.abs(newPos.z - pos.z) > 0.001;

    if (moved) {
      pos.x = newPos.x;
      pos.z = newPos.z;
      projectYOnRoad(pos);
    }

    const available = getAvailableDirections(pos.x, pos.z, isOnRoad);
    if (available.length === 0) return;

    const currentDir = CARDINAL_DIRS.find(d => d.x === actor.dirX && d.z === actor.dirZ);
    const reverseDir = CARDINAL_DIRS.find(d => d.x === -actor.dirX && d.z === -actor.dirZ);
    const hasNewOptions = available.some(d => d !== currentDir && d !== reverseDir);
    const isIntersection = available.length >= 3 || (available.length === 2 && hasNewOptions);

    const distFromLastDecision = Math.sqrt(
      Math.pow(pos.x - actor.lastIntersectionX, 2) +
      Math.pow(pos.z - actor.lastIntersectionZ, 2)
    );
    const canDecide = distFromLastDecision > 2.0;

    const needsNewDirection = !moved || (isIntersection && canDecide);

    if (needsNewDirection) {
      actor.lastIntersectionX = pos.x;
      actor.lastIntersectionZ = pos.z;

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
        threatX /= threatLen;
        threatZ /= threatLen;
        const escapeTargetX = pos.x + threatX * 50;
        const escapeTargetZ = pos.z + threatZ * 50;

        const scored = available.map(dir => ({
          dir,
          score: scoreDirection(pos.x, pos.z, dir, escapeTargetX, escapeTargetZ, isOnRoad, 20)
        }));
        scored.sort((a, b) => b.score - a.score);

        const randomChance = 1 - intelligence;
        if (Math.random() < randomChance && scored.length > 1) {
          chosenDir = scored[Math.floor(Math.random() * Math.min(2, scored.length))].dir;
        } else {
          chosenDir = scored[0].dir;
        }
      } else {
        const canContinue = currentDir && available.includes(currentDir);

        if (canContinue && !moved) {
          const otherDirs = available.filter(d => d !== currentDir);
          chosenDir = otherDirs[Math.floor(Math.random() * otherDirs.length)] || available[0];
        } else if (available.length >= 3) {
          const nonReverse = available.filter(d => d !== reverseDir);
          if (Math.random() < 0.4 && canContinue) {
            chosenDir = currentDir;
          } else {
            const newDirs = nonReverse.filter(d => d !== currentDir);
            chosenDir = newDirs.length > 0
              ? newDirs[Math.floor(Math.random() * newDirs.length)]
              : nonReverse[Math.floor(Math.random() * nonReverse.length)];
          }
        } else if (canContinue) {
          chosenDir = currentDir;
        } else {
          const nonReverse = available.filter(d => d !== reverseDir);
          const choices = nonReverse.length > 0 ? nonReverse : available;
          chosenDir = choices[Math.floor(Math.random() * choices.length)];
        }
      }

      actor.dirX = chosenDir.x;
      actor.dirZ = chosenDir.z;
    }
  }

  function updateChaserMovement(actor, dt, chaserIndex) {
    const { tryMove, projectYOnRoad, isOnRoad, findNearestRoadPoint } = STATE;

    const pos = actor.mesh.position;
    const moveDistance = actor.speed * dt;

    if (!isOnRoad(pos.x, pos.z)) {
      const roadPoint = findNearestRoadPoint(pos.x, pos.z);
      pos.x = roadPoint.x;
      pos.z = roadPoint.z;
      projectYOnRoad(pos);
      return;
    }

    const inputDir = getChaserInputDirection(chaserIndex);

    // Queue the direction when player presses a key
    if (inputDir.hasInput) {
      // Check if this is a 180-degree turn (reverse) - allow immediately
      const isReverse = (inputDir.x === -actor.dirX && inputDir.z === -actor.dirZ);
      if (isReverse && (actor.dirX !== 0 || actor.dirZ !== 0)) {
        actor.dirX = inputDir.x;
        actor.dirZ = inputDir.z;
        actor.queuedDirX = 0;
        actor.queuedDirZ = 0;
      } else {
        // Queue the direction - it will be executed when a path becomes available
        actor.queuedDirX = inputDir.x;
        actor.queuedDirZ = inputDir.z;
      }
    }

    // Check if we can move in a direction (look ahead a bit)
    function canMoveInDirection(dx, dz) {
      // Check multiple distances to find if there's a path nearby
      const checkDistances = [0.5, 1.0, 1.5, 2.0];
      for (const dist of checkDistances) {
        const targetX = pos.x + dx * dist;
        const targetZ = pos.z + dz * dist;
        if (isOnRoad(targetX, targetZ)) {
          return true;
        }
      }
      return false;
    }

    // Try to execute the queued direction
    if (actor.queuedDirX !== 0 || actor.queuedDirZ !== 0) {
      if (canMoveInDirection(actor.queuedDirX, actor.queuedDirZ)) {
        actor.dirX = actor.queuedDirX;
        actor.dirZ = actor.queuedDirZ;
        actor.queuedDirX = 0;
        actor.queuedDirZ = 0;
      }
      // Keep the queued direction until it becomes valid or player changes it
    }

    // Move in current direction
    if (actor.dirX !== 0 || actor.dirZ !== 0) {
      const newPos = tryMove(pos.x, pos.z, actor.dirX, actor.dirZ, moveDistance, 0);

      const moved = Math.abs(newPos.x - pos.x) > 0.001 || Math.abs(newPos.z - pos.z) > 0.001;

      if (moved) {
        pos.x = newPos.x;
        pos.z = newPos.z;
        projectYOnRoad(pos);
      }
    }
  }

  // ============================================
  // GAME LOOP
  // ============================================

  function animate(timestamp) {
    requestAnimationFrame(animate);
    const t = timestamp / 1000;
    const dt = STATE.lastTime ? Math.min(t - STATE.lastTime, 0.05) : 0;
    STATE.lastTime = t;

    if (STATE.loaded && settings.gameStarted && !STATE.gameOver) {
      updateGame(dt);
    }

    if (STATE.loaded) {
      for (const wire of fugitiveWires) {
        wire.update(dt);
      }

      if (settings.faceSwapDuration > 0) {
        if (t - lastFaceSwapTime >= settings.faceSwapDuration) {
          lastFaceSwapTime = t;
          for (const wire of fugitiveWires) {
            wire.swapTexture();
          }
        }
      }

      // Update glass canvas for marquee animation
      if (settings.glassTextMarquee && glassCanvas) {
        updateGlassCanvas(timestamp);
      }
    }

    if (composer && (settings.bloomEnabled || settings.fxaaEnabled)) {
      if (renderPass) renderPass.camera = camera;
      composer.render();
    } else {
      renderer.render(scene, camera);
    }
  }

  function updateGame(dt) {
    if (!STATE.loaded) return;

    const { tryMove, projectYOnRoad } = STATE;

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

    for (const f of fugitives) {
      if (f.captured) continue;
      f.speed = settings.fugitiveSpeed + fugitiveSpeedBonus;
      updateFugitiveMovement(f, dt);
    }

    for (let i = 0; i < chasers.length; i++) {
      const chaser = chasers[i];

      const inputDir = getChaserInputDirection(i);
      if (!chaser.active && inputDir.hasInput) {
        chaser.active = true;
        chaser.mesh.visible = true;
      }

      if (!chaser.active) continue;

      chaser.speed = settings.chaserSpeed + chaserSpeedBonus;

      updateChaserMovement(chaser, dt, i);

      for (const f of fugitives) {
        if (f.captured) continue;
        if (checkCollision(chaser.mesh, f.mesh, STATE.actorRadius || 2.5)) {
          f.captured = true;
          scene.remove(f.mesh);
          statusEl.textContent = `Fugitive ${f.index + 1} captured!`;
        }
      }
    }

    const remaining = fugitives.filter(f => !f.captured).length;
    if (remaining === 0) {
      STATE.gameOver = true;
      statusEl.textContent = "All fugitives captured! Chasers win!";
    }
  }

  // ============================================
  // LOAD LEVEL
  // ============================================

  const loader = new GLTFLoader();

  // Load only jagad.glb - use ROADS mesh from within it for navmesh
  new Promise((resolve, reject) => {
    loader.load(PATHS.models.level, resolve, undefined, reject);
  }).then((levelGltf) => {
    const gltf = levelGltf;
    const root = gltf.scene;

    root.traverse((obj) => {
      if (obj.isMesh) {
        obj.castShadow = true;
        obj.receiveShadow = true;
      }
      if (obj.isCamera) {
        glbCameras.push({ name: obj.name || `GLB Camera ${glbCameras.length + 1}`, camera: obj });
        console.log(`Found camera in GLB: ${obj.name}`, obj);
      }
    });

    const levelContainer = new THREE.Group();
    levelContainer.add(root);
    scene.add(levelContainer);
    STATE.levelContainer = levelContainer;

    if (STATE.updateLevelOpacity) {
      STATE.updateLevelOpacity(settings.levelOpacity);
    }
    if (STATE.updateLevelBlendMode) {
      STATE.updateLevelBlendMode(settings.levelBlendMode);
    }

    levelContainer.updateMatrixWorld(true);

    const fugitiveSpawns = [];
    const chaserSpawns = [];

    for (let i = 1; i <= 4; i++) {
      const marker = levelContainer.getObjectByName(`F${i}`);
      if (marker) {
        const worldPos = new THREE.Vector3();
        marker.getWorldPosition(worldPos);
        fugitiveSpawns.push(worldPos);
        marker.parent.remove(marker);
        console.log(`Found F${i} at:`, worldPos.x.toFixed(2), worldPos.y.toFixed(2), worldPos.z.toFixed(2));
      } else {
        console.warn(`Fugitive spawn marker F${i} not found in GLB`);
      }
    }

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

    // Find ROADS mesh within jagad.glb (same scale as markers)
    let roadsMeshes = [];
    levelContainer.traverse((obj) => {
      if (obj.isMesh && obj.name && obj.name.toUpperCase().includes("ROAD")) {
        roadsMeshes.push(obj);
        const scale = obj.scale;
        const worldScale = new THREE.Vector3();
        obj.matrixWorld.decompose(new THREE.Vector3(), new THREE.Quaternion(), worldScale);
        console.log(`Found road mesh in jagad.glb: "${obj.name}", local scale: (${scale.x}, ${scale.y}, ${scale.z}), world scale: (${worldScale.x.toFixed(2)}, ${worldScale.y.toFixed(2)}, ${worldScale.z.toFixed(2)})`);
      }
    });

    console.log(`Found ${roadsMeshes.length} ROADS meshes in jagad.glb for navmesh`);

    // Find all GLASS meshes for HTML overlay
    let foundGlassMeshes = [];
    levelContainer.traverse((obj) => {
      if (obj.isMesh && obj.name && obj.name.toUpperCase().includes("GLASS")) {
        foundGlassMeshes.push(obj);
        console.log(`Found GLASS mesh: "${obj.name}"`);
      }
    });

    if (foundGlassMeshes.length > 0) {
      setupGlassMeshes(foundGlassMeshes);
      console.log(`Set up ${foundGlassMeshes.length} GLASS mesh(es) with canvas texture`);
    } else {
      console.warn("No GLASS mesh found in jagad.glb");
      // List all mesh names for debugging
      console.log("Available meshes in jagad.glb:");
      levelContainer.traverse((obj) => {
        if (obj.isMesh && obj.name) {
          console.log(`  - "${obj.name}"`);
        }
      });
    }

    if (roadsMeshes.length > 0) {
      statusEl.textContent = `Level loaded. Found ${roadsMeshes.length} road meshes, ${fugitiveSpawns.length} fugitive spawns, ${chaserSpawns.length} chaser spawns.`;
    } else {
      console.warn("No ROADS mesh found in jagad.glb! Looking for any mesh with 'road' in name...");
      // List all mesh names for debugging
      levelContainer.traverse((obj) => {
        if (obj.isMesh) {
          console.log(`  Mesh in jagad.glb: "${obj.name}"`);
        }
      });
      statusEl.textContent = "No ROADS mesh found in jagad.glb!";
    }

    const roadsBbox = roadsMeshes.length > 0
      ? new THREE.Box3().setFromObject(roadsMeshes[0])
      : new THREE.Box3().setFromObject(root);

    const spawnBbox = new THREE.Box3();
    for (const sp of fugitiveSpawns) spawnBbox.expandByPoint(sp);
    for (const sp of chaserSpawns) spawnBbox.expandByPoint(sp);

    const bbox = roadsBbox.clone();
    if (!spawnBbox.isEmpty()) {
      bbox.union(spawnBbox);
    }

    const size = new THREE.Vector3();
    bbox.getSize(size);
    const horizontalSize = Math.max(size.x, size.z);
    const levelCenter = new THREE.Vector3();
    bbox.getCenter(levelCenter);

    STATE.levelCenter.copy(levelCenter);
    STATE.horizontalSize = horizontalSize;

    const streetY = roadsBbox.min.y;

    console.log("Building navmesh from ROADS mesh in jagad.glb...");

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

    // Analyze path widths from triangles
    const triangleSizes = navTriangles.map(tri => {
      const width = tri.maxX - tri.minX;
      const height = tri.maxZ - tri.minZ;
      return { width, height, max: Math.max(width, height), min: Math.min(width, height) };
    });
    const avgWidth = triangleSizes.reduce((sum, t) => sum + t.min, 0) / triangleSizes.length;
    const maxWidth = Math.max(...triangleSizes.map(t => t.min));
    const minWidth = Math.min(...triangleSizes.map(t => t.min));
    console.log(`Path analysis - Avg triangle min dimension: ${avgWidth.toFixed(2)}, Range: ${minWidth.toFixed(2)} to ${maxWidth.toFixed(2)}`);

    // Measure actual corridor width by sampling from center of navmesh
    function measureCorridorWidth(x, z, dirX, dirZ) {
      // Measure perpendicular to direction
      const perpX = -dirZ;
      const perpZ = dirX;
      let leftDist = 0;
      let rightDist = 0;

      // Measure left
      for (let d = 0.01; d < 5; d += 0.01) {
        if (!pointInTriangleAny(x + perpX * d, z + perpZ * d)) break;
        leftDist = d;
      }
      // Measure right
      for (let d = 0.01; d < 5; d += 0.01) {
        if (!pointInTriangleAny(x - perpX * d, z - perpZ * d)) break;
        rightDist = d;
      }
      return leftDist + rightDist;
    }

    function pointInTriangleAny(px, pz) {
      for (const tri of navTriangles) {
        if (px < tri.minX || px > tri.maxX || pz < tri.minZ || pz > tri.maxZ) continue;
        if (pointInTriangle(px, pz, tri.ax, tri.az, tri.bx, tri.bz, tri.cx, tri.cz)) return true;
      }
      return false;
    }

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

    let actorSize = 1;
    const c1Marker = levelContainer.getObjectByName("C1");
    if (c1Marker) {
      // Check levelContainer scale
      const containerScale = new THREE.Vector3();
      levelContainer.matrixWorld.decompose(new THREE.Vector3(), new THREE.Quaternion(), containerScale);
      console.log(`Level container world scale: (${containerScale.x.toFixed(2)}, ${containerScale.y.toFixed(2)}, ${containerScale.z.toFixed(2)})`);

      // Get marker's world bounding box
      const markerBox = new THREE.Box3().setFromObject(c1Marker);
      const markerSize = new THREE.Vector3();
      markerBox.getSize(markerSize);

      // Also check the marker's own geometry if it's a mesh
      let geometrySize = null;
      c1Marker.traverse((child) => {
        if (child.isMesh && child.geometry) {
          child.geometry.computeBoundingBox();
          const geoBox = child.geometry.boundingBox;
          const geoSize = new THREE.Vector3();
          geoBox.getSize(geoSize);
          // Apply world scale
          const childWorldScale = new THREE.Vector3();
          child.matrixWorld.decompose(new THREE.Vector3(), new THREE.Quaternion(), childWorldScale);
          geometrySize = {
            local: geoSize.clone(),
            world: geoSize.clone().multiply(childWorldScale)
          };
          console.log(`C1 mesh geometry size (local): (${geoSize.x.toFixed(3)}, ${geoSize.y.toFixed(3)}, ${geoSize.z.toFixed(3)})`);
          console.log(`C1 mesh world scale: (${childWorldScale.x.toFixed(2)}, ${childWorldScale.y.toFixed(2)}, ${childWorldScale.z.toFixed(2)})`);
          console.log(`C1 mesh geometry size (world): (${geometrySize.world.x.toFixed(3)}, ${geometrySize.world.y.toFixed(3)}, ${geometrySize.world.z.toFixed(3)})`);
        }
      });

      console.log(`C1 marker bounding box size: (${markerSize.x.toFixed(3)}, ${markerSize.y.toFixed(3)}, ${markerSize.z.toFixed(3)})`);

      // Use geometry world size if available, otherwise bounding box
      if (geometrySize && geometrySize.world) {
        actorSize = Math.min(geometrySize.world.x, geometrySize.world.z);
        console.log(`Actor size from C1 geometry (world): ${actorSize.toFixed(3)}`);
      } else {
        actorSize = Math.min(markerSize.x, markerSize.z);
        console.log(`Actor size from C1 bounding box: ${actorSize.toFixed(3)}`);
      }
    } else {
      const baseUnit = horizontalSize || 100;
      actorSize = baseUnit / 150;
      console.log(`Actor size fallback: ${actorSize.toFixed(2)}`);
    }
    actorSize *= settings.actorScale;
    console.log(`Final actor size with scale ${settings.actorScale}: ${actorSize.toFixed(2)}`);

    // Measure actual corridor widths for debugging
    if (chaserSpawns.length > 0) {
      const measurements = [];
      for (const sp of chaserSpawns) {
        const widthX = measureCorridorWidth(sp.x, sp.z, 1, 0);
        const widthZ = measureCorridorWidth(sp.x, sp.z, 0, 1);
        measurements.push(Math.min(widthX, widthZ));
      }
      const measuredPathWidth = Math.min(...measurements);
      console.log(`Measured corridor widths: ${measurements.map(m => m.toFixed(2)).join(", ")}`);
      console.log(`Minimum corridor width: ${measuredPathWidth.toFixed(3)}`);
      console.log(`Corridor/Actor ratio: ${(measuredPathWidth / actorSize).toFixed(2)}x`);
    }
    console.log(`Final actor size: ${actorSize.toFixed(3)}`);

    function isOnRoadWithMargin(x, z, margin) {
      if (!isOnRoad(x, z)) return false;

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

    function tryMove(currentX, currentZ, dirX, dirZ, distance, margin = 0) {
      if (!isOnRoad(currentX, currentZ)) {
        return { x: currentX, z: currentZ };
      }

      const stepSize = 0.1;
      const steps = Math.max(1, Math.ceil(distance / stepSize));
      const actualStep = distance / steps;

      let x = currentX;
      let z = currentZ;

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
          break;
        }
      }

      return { x, z };
    }

    function findNearestRoadPoint(x, z) {
      if (isOnRoad(x, z)) {
        return { x, z };
      }

      for (let radius = 0.2; radius < 150; radius += 0.3) {
        for (let angle = 0; angle < Math.PI * 2; angle += Math.PI / 32) {
          const testX = x + Math.cos(angle) * radius;
          const testZ = z + Math.sin(angle) * radius;
          if (isOnRoad(testX, testZ)) {
            return { x: testX, z: testZ };
          }
        }
      }

      console.warn(`Could not find road point near (${x.toFixed(2)}, ${z.toFixed(2)})`);
      return { x, z };
    }

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
    navmeshDebug.visible = settings.showNavmesh;

    function projectYOnRoad(pos) {
      pos.y = streetY + actorSize * 0.5;
    }

    setupCameras(levelCenter, horizontalSize);
    onResize();

    STATE.streetY = streetY;

    console.log("Creating building plane...");
    const sizeX = horizontalSize * settings.buildingScaleX;
    const sizeY = horizontalSize * settings.buildingScaleY;
    const planeGeo = new THREE.PlaneGeometry(sizeX, sizeY);

    const planeMat = new THREE.MeshBasicMaterial({
      color: 0x333366,
      transparent: true,
      opacity: settings.buildingOpacity,
      side: THREE.DoubleSide
    });
    buildingPlane = new THREE.Mesh(planeGeo, planeMat);
    buildingPlane.rotation.x = -Math.PI / 2;
    buildingPlane.position.set(
      levelCenter.x + settings.buildingOffsetX,
      streetY + settings.buildingOffsetY,
      levelCenter.z + settings.buildingOffsetZ
    );
    buildingPlane.visible = settings.buildingEnabled;
    scene.add(buildingPlane);

    const textureLoader = new THREE.TextureLoader();
    textureLoader.load(PATHS.images.building,
      (texture) => {
        console.log("Building texture loaded");
        buildingPlane.material.map = texture;
        buildingPlane.material.color.set(0xffffff);
        buildingPlane.material.needsUpdate = true;
      },
      undefined,
      (error) => {
        console.error("Failed to load building.png:", error);
      }
    );

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
      const roadPoint = findNearestRoadPoint(spawnPos.x, spawnPos.z);

      mesh.position.set(roadPoint.x, 0, roadPoint.z);
      projectYOnRoad(mesh.position);
      scene.add(mesh);

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
        lastIntersectionX: roadPoint.x,
        lastIntersectionZ: roadPoint.z,
      });

      const wire = new ActorWire(fugitives[fugitives.length - 1], actorSize, fugitiveColors[i] || fugitiveColors[0], false, i);
      fugitiveWires.push(wire);
    }

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
      const roadPoint = findNearestRoadPoint(spawnPos.x, spawnPos.z);

      mesh.position.set(roadPoint.x, 0, roadPoint.z);
      projectYOnRoad(mesh.position);
      mesh.visible = false;

      const chaserObj = {
        mesh,
        light,
        speed: settings.chaserSpeed,
        dirX: 0,
        dirZ: 0,
        queuedDirX: 0,
        queuedDirZ: 0,
        active: false,
      };
      scene.add(mesh);
      chasers.push(chaserObj);
    }

    STATE.isOnRoad = isOnRoad;
    STATE.tryMove = tryMove;
    STATE.findNearestRoadPoint = findNearestRoadPoint;
    STATE.projectYOnRoad = projectYOnRoad;
    STATE.actorSize = actorSize;
    STATE.actorRadius = actorSize * 0.5;
    STATE.roadsMeshes = roadsMeshes;
    STATE.loaded = true;

    setupGUI();
    initPostProcessing();
    setupGLBPartsGUI();

    statusEl.textContent = "Ready! Click 'Start Game' in the GUI.";
  }).catch((err) => {
    console.error("Error loading GLB files", err);
    statusEl.textContent = "Failed to load GLB files (see console).";
  });

  animate(0);
})();
