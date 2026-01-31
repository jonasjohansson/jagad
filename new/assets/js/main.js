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

import { STORAGE_KEY, defaultSettings, loadSettings, saveSettings, clearSettings } from "./game/settings.js";
import { PATHS, FACE_TEXTURES, CHASER_CONTROLS } from "./game/constants.js?v=3";

// lil-gui loaded via script tag in index.html
const GUI = window.lil.GUI;

(() => {
  // Suppress repeated Three.js texture unit warnings
  const warnedMessages = new Set();
  const originalWarn = console.warn;
  console.warn = function(...args) {
    const msg = args[0];
    if (typeof msg === "string" && msg.includes("texture units")) {
      if (warnedMessages.has(msg)) return;
      warnedMessages.add(msg);
    }
    originalWarn.apply(console, args);
  };

  // ============================================
  // CORE SETUP
  // ============================================

  const canvas = document.getElementById("game-canvas");

  const statusEl = {
    set textContent(val) {
      // Silent - remove console logging
    }
  };

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x000000);

  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setClearColor(0x000000, 0);
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.outputColorSpace = THREE.SRGBColorSpace;

  // Debug axis helper (corner inset)
  const axisScene = new THREE.Scene();
  const axisCamera = new THREE.PerspectiveCamera(50, 1, 0.1, 100);
  axisCamera.position.set(0, 2, 3);
  axisCamera.lookAt(0, 0, 0);
  const axisHelper = new THREE.AxesHelper(1.5);
  axisScene.add(axisHelper);
  // Add labels
  const axisLabels = new THREE.Group();
  const createLabel = (text, color, pos) => {
    const canvas = document.createElement("canvas");
    canvas.width = 64;
    canvas.height = 64;
    const ctx = canvas.getContext("2d");
    ctx.fillStyle = color;
    ctx.font = "bold 48px Arial";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(text, 32, 32);
    const texture = new THREE.CanvasTexture(canvas);
    const material = new THREE.SpriteMaterial({ map: texture });
    const sprite = new THREE.Sprite(material);
    sprite.position.copy(pos);
    sprite.scale.set(0.5, 0.5, 1);
    return sprite;
  };
  axisLabels.add(createLabel("X", "#ff0000", new THREE.Vector3(2, 0, 0)));
  axisLabels.add(createLabel("Y", "#00ff00", new THREE.Vector3(0, 2, 0)));
  axisLabels.add(createLabel("Z", "#0000ff", new THREE.Vector3(0, 0, 2)));
  axisScene.add(axisLabels);
  let showAxisHelper = true;


  // ============================================
  // STATE
  // ============================================

  let buildingPlane = null;
  let camera;
  let orthoCamera;
  let perspCamera;
  const glbCameras = [];

  // Initial placeholder camera, replaced by setupCameras() after level loads
  camera = new THREE.PerspectiveCamera(55, window.innerWidth / window.innerHeight, 0.1, 5000);
  camera.position.set(0, 100, 100);

  const fugitives = [];
  const chasers = [];
  let helicopter = null;
  let clouds = [];

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
    // Game timer
    gameTimerStarted: false,
    gameTimerRemaining: 90,
    showingScore: false,
    scoreDisplayTime: 0,
  };

  // ============================================
  // AUDIO
  // ============================================

  let audioElement = null;

  function initAudio() {
    const trackPath = PATHS.audio[settings.audioTrack];
    if (trackPath) {
      audioElement = new Audio(trackPath);
      audioElement.loop = true;
      audioElement.volume = settings.audioVolume;
    }
  }

  function playAudio() {
    if (!audioElement) return;
    audioElement.play().catch(() => {});
  }

  function stopAudio() {
    if (audioElement) {
      audioElement.pause();
    }
  }

  function setAudioTrack(trackName) {
    const trackPath = PATHS.audio[trackName];
    if (trackPath && audioElement) {
      const wasPlaying = !audioElement.paused;
      audioElement.src = trackPath;
      if (wasPlaying) {
        audioElement.play().catch(() => {});
      }
    }
  }

  // ============================================
  // HELICOPTER
  // ============================================

  function loadHelicopter() {
    if (!PATHS.models.helicopter) return;

    const loader = new GLTFLoader();
    loader.load(PATHS.models.helicopter, (gltf) => {
      const mesh = gltf.scene;

      // Scale helicopter
      const box = new THREE.Box3().setFromObject(mesh);
      const size = new THREE.Vector3();
      box.getSize(size);
      const maxDim = Math.max(size.x, size.y, size.z);
      const scale = (settings.helicopterScale * 2) / maxDim;
      mesh.scale.setScalar(scale);
      console.log("Helicopter size:", size, "maxDim:", maxDim, "scale:", scale);

      // Position above the level - start near chaser spawn area
      const center = STATE.levelCenter || new THREE.Vector3(0, 0, 0);
      const levelRadius = STATE.horizontalSize ? STATE.horizontalSize / 2 : 10;
      // Start at a random position within the level
      const startX = center.x + (Math.random() - 0.5) * levelRadius;
      const startZ = center.z + (Math.random() - 0.5) * levelRadius;
      mesh.position.set(startX, settings.helicopterHeight, startZ);
      console.log("Helicopter position:", mesh.position, "center:", center, "levelRadius:", levelRadius);

      // Add spotlight facing down
      const angleRad = (settings.helicopterLightAngle * Math.PI) / 180;
      const light = new THREE.SpotLight(
        settings.helicopterLightColor,
        settings.helicopterLightIntensity,
        50,
        angleRad,
        0.5,
        1
      );
      light.position.set(0, 0, 0);
      light.castShadow = true;
      light.shadow.mapSize.width = 1024;
      light.shadow.mapSize.height = 1024;

      // Create target below helicopter
      const lightTarget = new THREE.Object3D();
      lightTarget.position.set(0, -10, 0);
      mesh.add(lightTarget);
      light.target = lightTarget;
      mesh.add(light);

      mesh.traverse((child) => {
        if (child.isMesh) {
          child.castShadow = true;
          child.receiveShadow = true;
        }
      });

      scene.add(mesh);

      // Add debug arrow to show facing direction (bright green, larger)
      const arrowDir = new THREE.Vector3(0, 0, 1);
      const arrowOrigin = new THREE.Vector3(0, 0.5, 0);
      const arrowHelper = new THREE.ArrowHelper(arrowDir, arrowOrigin, 3, 0x00ff00, 0.8, 0.5);
      mesh.add(arrowHelper);

      helicopter = {
        mesh,
        light,
        lightTarget,
        angle: 0,
        rotorAngle: 0,
        debugArrow: arrowHelper,
        // Random patrol waypoint system - start with current position as target
        targetX: startX,
        targetZ: startZ,
        waypointTimer: 2, // Start moving after 2 seconds
      };

      // Find rotor parts to animate
      mesh.traverse((child) => {
        if (child.name && child.name.toLowerCase().includes("rotor")) {
          if (!helicopter.rotors) helicopter.rotors = [];
          helicopter.rotors.push(child);
        }
      });

      console.log("Helicopter loaded");
    }, undefined, (err) => {
      console.warn("Failed to load helicopter:", err);
    });
  }

  function updateHelicopter(dt) {
    if (!helicopter || !helicopter.mesh) return;
    if (!settings.helicopterEnabled) {
      helicopter.mesh.visible = false;
      return;
    }
    helicopter.mesh.visible = true;

    const center = STATE.levelCenter || new THREE.Vector3(0, 0, 0);
    const levelRadius = STATE.horizontalSize ? STATE.horizontalSize / 2 : 10;
    const patrolRadius = Math.min(settings.helicopterRadius, levelRadius * 0.8);
    const time = performance.now() * 0.001;

    // Smooth figure-8 / lemniscate pattern over the level
    const speed = settings.helicopterSpeed * 0.3;
    helicopter.angle += speed * dt;

    // Create smooth hovering path using sine waves
    const targetX = center.x + Math.sin(helicopter.angle) * patrolRadius * 0.8;
    const targetZ = center.z + Math.sin(helicopter.angle * 2) * patrolRadius * 0.4;

    // Smoothly interpolate position (no sudden jumps)
    const lerpSpeed = 1.5 * dt;
    helicopter.mesh.position.x += (targetX - helicopter.mesh.position.x) * lerpSpeed;
    helicopter.mesh.position.z += (targetZ - helicopter.mesh.position.z) * lerpSpeed;

    // Gentle height bobbing
    helicopter.mesh.position.y = settings.helicopterHeight + Math.sin(time * 0.8) * 0.15;

    // Calculate velocity for facing direction
    if (!helicopter.lastX) helicopter.lastX = helicopter.mesh.position.x;
    if (!helicopter.lastZ) helicopter.lastZ = helicopter.mesh.position.z;

    const velX = helicopter.mesh.position.x - helicopter.lastX;
    const velZ = helicopter.mesh.position.z - helicopter.lastZ;

    helicopter.lastX = helicopter.mesh.position.x;
    helicopter.lastZ = helicopter.mesh.position.z;

    // Only update rotation if actually moving
    if (Math.abs(velX) > 0.0001 || Math.abs(velZ) > 0.0001) {
      const targetRotation = Math.atan2(velX, velZ);

      // Very smooth rotation interpolation
      let rotDiff = targetRotation - helicopter.mesh.rotation.y;
      while (rotDiff > Math.PI) rotDiff -= Math.PI * 2;
      while (rotDiff < -Math.PI) rotDiff += Math.PI * 2;
      helicopter.mesh.rotation.y += rotDiff * 2 * dt;
    }

    // Gentle banking based on turning
    helicopter.mesh.rotation.z = Math.sin(helicopter.angle * 2) * 0.05;
    helicopter.mesh.rotation.x = 0.03;

    // Spin rotors
    if (helicopter.rotors) {
      helicopter.rotorAngle += dt * 20;
      for (const rotor of helicopter.rotors) {
        rotor.rotation.y = helicopter.rotorAngle;
      }
    }

    // Update light settings
    if (helicopter.light) {
      helicopter.light.intensity = settings.helicopterLightIntensity;
      helicopter.light.color.set(settings.helicopterLightColor);
      helicopter.light.angle = (settings.helicopterLightAngle * Math.PI) / 180;
    }
  }

  // ============================================
  // CLOUDS
  // ============================================

  const BLEND_MODES = {
    "Normal": THREE.NormalBlending,
    "Additive": THREE.AdditiveBlending,
    "Multiply": THREE.MultiplyBlending,
    "Screen": THREE.CustomBlending,
  };

  function loadClouds() {
    console.log("Loading clouds, path:", PATHS.images.cloud);
    if (!PATHS.images.cloud) {
      console.warn("No cloud path defined");
      return;
    }

    const textureLoader = new THREE.TextureLoader();
    textureLoader.load(PATHS.images.cloud, (texture) => {
      console.log("Cloud texture loaded:", texture);

      // Store texture for spawning new clouds later
      STATE.cloudTexture = texture;
      spawnClouds();

      console.log("Clouds system initialized");
    }, undefined, (err) => {
      console.warn("Failed to load cloud texture:", err);
    });
  }

  function spawnClouds() {
    if (!STATE.cloudTexture) return;

    // Clear existing clouds
    for (const cloud of clouds) {
      scene.remove(cloud.mesh);
      cloud.material.dispose();
      cloud.mesh.geometry.dispose();
    }
    clouds.length = 0;

    const center = STATE.levelCenter || new THREE.Vector3(0, 0, 0);
    const cloudCount = settings.cloudCount;

    for (let i = 0; i < cloudCount; i++) {
      const geometry = new THREE.PlaneGeometry(1, 1);
      const material = new THREE.MeshBasicMaterial({
        map: STATE.cloudTexture,
        transparent: true,
        opacity: 0, // Start invisible, fade in
        blending: BLEND_MODES[settings.cloudBlending] || THREE.NormalBlending,
        depthWrite: false,
        side: THREE.DoubleSide,
      });

      const mesh = new THREE.Mesh(geometry, material);

      // Rotate to be horizontal and face upward (visible from camera above)
      mesh.rotation.x = Math.PI / 2;

      // Random scale within range
      const scale = settings.cloudScaleMin + Math.random() * (settings.cloudScaleMax - settings.cloudScaleMin);
      mesh.scale.set(scale, scale * 0.6, 1);

      // Random height within range
      const height = settings.cloudHeightMin + Math.random() * (settings.cloudHeightMax - settings.cloudHeightMin);

      // Random speed within range
      const speed = settings.cloudSpeedMin + Math.random() * (settings.cloudSpeedMax - settings.cloudSpeedMin);

      // Spread clouds across the level, starting from different X positions
      const spreadX = 25;
      const startX = center.x - spreadX + (Math.random() * spreadX * 2);
      const levelRadius = STATE.horizontalSize ? STATE.horizontalSize / 2 : 10;
      const z = center.z + (Math.random() - 0.5) * levelRadius * 1.5; // Wide Z variation across level

      mesh.position.set(startX, height, z);

      scene.add(mesh);
      clouds.push({
        mesh,
        material,
        speed,
        height,
        scale,
        zOffset: z - center.z,
        index: i,
      });
    }

    console.log("Spawned", cloudCount, "clouds");
  }

  function updateClouds(dt) {
    if (!settings.cloudsEnabled) {
      for (const cloud of clouds) {
        cloud.mesh.visible = false;
      }
      return;
    }

    const center = STATE.levelCenter || new THREE.Vector3(0, 0, 0);
    const resetX = center.x - 15;
    const endX = center.x + 15;

    for (const cloud of clouds) {
      cloud.mesh.visible = true;

      // Move cloud from left to right
      cloud.mesh.position.x += cloud.speed * dt;
      cloud.mesh.position.y = cloud.height; // Use individual cloud height
      cloud.mesh.position.z = center.z + cloud.zOffset; // Keep Z offset

      // Reset when cloud moves off the right side (respawn on left with new random properties)
      if (cloud.mesh.position.x > endX) {
        cloud.mesh.position.x = resetX - Math.random() * 5;
        // Randomize properties on respawn
        cloud.height = settings.cloudHeightMin + Math.random() * (settings.cloudHeightMax - settings.cloudHeightMin);
        cloud.speed = settings.cloudSpeedMin + Math.random() * (settings.cloudSpeedMax - settings.cloudSpeedMin);
        cloud.scale = settings.cloudScaleMin + Math.random() * (settings.cloudScaleMax - settings.cloudScaleMin);
        const levelRadius = STATE.horizontalSize ? STATE.horizontalSize / 2 : 10;
      cloud.zOffset = (Math.random() - 0.5) * levelRadius * 1.5;
      }

      // Calculate opacity based on position (fade in/out at edges)
      const distFromCenter = Math.abs(cloud.mesh.position.x - center.x);
      const maxDist = 12;
      const edgeFade = Math.max(0, 1 - (distFromCenter / maxDist));
      cloud.material.opacity = settings.cloudOpacity * edgeFade;

      // Update scale and blending
      cloud.mesh.scale.set(cloud.scale, cloud.scale * 0.6, 1);
      cloud.material.blending = BLEND_MODES[settings.cloudBlending] || THREE.NormalBlending;
    }
  }

  // ============================================
  // GLASS OVERLAY (Canvas texture on GLASS mesh)
  // ============================================

  let glassMeshes = [];
  let glassCanvas = null;
  let glassContext = null;
  let glassTexture = null;
  let marqueeOffset = 0;
  let lastMarqueeTime = 0;
  let glassVideo = null;
  let glassVideoReady = false;

  // Text shuffle effect
  const SHUFFLE_CHARS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789!@#$%&*<>[]{}";
  const textShuffleState = {
    rows: [{}, {}, {}, {}], // State for each row
    lastTexts: ["", "", "", ""], // Track previous text to detect changes
  };

  function initShuffleRow(rowIndex, targetText) {
    const state = textShuffleState.rows[rowIndex];
    state.target = targetText;
    state.current = "";
    state.lockedChars = 0;
    state.shuffleTime = 0;
    state.charDelays = [];
    // Each character has a random delay before it locks in (adjusted by speed setting)
    const baseDelay = 100 / Math.max(0.1, settings.glassTextShuffleSpeed);
    const stagger = 60 / Math.max(0.1, settings.glassTextShuffleSpeed);
    for (let i = 0; i < targetText.length; i++) {
      state.charDelays.push(baseDelay + Math.random() * baseDelay + i * stagger);
    }
  }

  function updateShuffleRow(rowIndex, dt) {
    const state = textShuffleState.rows[rowIndex];
    if (!state.target) return state.target || "";

    state.shuffleTime += dt * 1000 * settings.glassTextShuffleSpeed; // Convert to ms, adjusted by speed

    let result = "";
    for (let i = 0; i < state.target.length; i++) {
      if (state.shuffleTime >= state.charDelays[i]) {
        // Character is locked
        result += state.target[i];
      } else {
        // Character is still shuffling
        if (state.target[i] === " ") {
          result += " ";
        } else {
          result += SHUFFLE_CHARS[Math.floor(Math.random() * SHUFFLE_CHARS.length)];
        }
      }
    }
    state.current = result;
    return result;
  }

  function getShuffledText(rowIndex, targetText, dt) {
    // Skip shuffle if disabled
    if (!settings.glassTextShuffle) {
      textShuffleState.lastTexts[rowIndex] = targetText;
      return targetText;
    }

    // Check if text changed
    if (textShuffleState.lastTexts[rowIndex] !== targetText) {
      textShuffleState.lastTexts[rowIndex] = targetText;
      initShuffleRow(rowIndex, targetText);
    }

    const state = textShuffleState.rows[rowIndex];
    if (!state.target) return targetText;

    // Check if shuffle is complete
    const maxDelay = Math.max(...(state.charDelays || [0]));
    if (state.shuffleTime >= maxDelay) {
      return targetText;
    }

    return updateShuffleRow(rowIndex, dt);
  }

  function isShuffleActive() {
    if (!settings.glassTextShuffle) return false;
    for (let i = 0; i < 4; i++) {
      const state = textShuffleState.rows[i];
      if (state.target && state.charDelays) {
        const maxDelay = Math.max(...state.charDelays);
        if (state.shuffleTime < maxDelay) return true;
      }
    }
    return false;
  }

  // Video planes
  let videoPlane1 = null;
  let videoPlane2 = null;

  function initVideoPlanes() {
    const textureLoader = new THREE.TextureLoader();

    // Create plane 1 (left screen)
    const geo1 = new THREE.PlaneGeometry(1, 1);
    const mat1 = new THREE.MeshBasicMaterial({
      color: 0xffffff,
      side: THREE.DoubleSide,
      transparent: true
    });
    videoPlane1 = new THREE.Mesh(geo1, mat1);
    videoPlane1.rotation.x = -Math.PI / 2; // Lay flat
    videoPlane1.visible = settings.videoPlane1Enabled;
    updateVideoPlane1();
    scene.add(videoPlane1);

    // Load left screen texture
    textureLoader.load(PATHS.images.leftScreen, (texture) => {
      videoPlane1.material.map = texture;
      videoPlane1.material.needsUpdate = true;
    });

    // Create plane 2 (right screen)
    const geo2 = new THREE.PlaneGeometry(1, 1);
    const mat2 = new THREE.MeshBasicMaterial({
      color: 0xffffff,
      side: THREE.DoubleSide,
      transparent: true
    });
    videoPlane2 = new THREE.Mesh(geo2, mat2);
    videoPlane2.rotation.x = -Math.PI / 2; // Lay flat
    videoPlane2.visible = settings.videoPlane2Enabled;
    updateVideoPlane2();
    scene.add(videoPlane2);

    // Load right screen texture
    textureLoader.load(PATHS.images.rightScreen, (texture) => {
      videoPlane2.material.map = texture;
      videoPlane2.material.needsUpdate = true;
    });
  }

  function updateVideoPlane1() {
    if (!videoPlane1) return;
    videoPlane1.position.set(settings.videoPlane1PosX, settings.videoPlane1PosY, settings.videoPlane1PosZ);
    videoPlane1.scale.set(settings.videoPlane1ScaleX, settings.videoPlane1ScaleY, settings.videoPlane1ScaleZ);
  }

  function updateVideoPlane2() {
    if (!videoPlane2) return;
    videoPlane2.position.set(settings.videoPlane2PosX, settings.videoPlane2PosY, settings.videoPlane2PosZ);
    videoPlane2.scale.set(settings.videoPlane2ScaleX, settings.videoPlane2ScaleY, settings.videoPlane2ScaleZ);
  }

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

    // Initialize video background
    if (PATHS.video && PATHS.video.windowAmbience) {
      glassVideo = document.createElement("video");
      glassVideo.src = PATHS.video.windowAmbience;
      glassVideo.loop = true;
      glassVideo.muted = true;
      glassVideo.playsInline = true;
      glassVideo.crossOrigin = "anonymous";
      glassVideo.addEventListener("canplaythrough", () => {
        glassVideoReady = true;
        glassVideo.play().catch(() => {});
      });
      glassVideo.load();
    }

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

    // Draw video background if available and enabled, otherwise solid color
    if (settings.glassVideoEnabled && glassVideo && glassVideoReady && glassVideo.readyState >= 2) {
      // Draw video frame scaled to fill canvas
      const vw = glassVideo.videoWidth;
      const vh = glassVideo.videoHeight;
      if (vw && vh) {
        const scale = Math.max(w / vw, h / vh);
        const sw = vw * scale;
        const sh = vh * scale;
        const sx = (w - sw) / 2;
        const sy = (h - sh) / 2;

        // Apply video opacity
        ctx.globalAlpha = settings.glassVideoOpacity;
        ctx.drawImage(glassVideo, sx, sy, sw, sh);
        ctx.globalAlpha = 1.0;

        // Apply brightness (darken if < 1, lighten if > 1)
        const brightness = settings.glassVideoBrightness;
        if (brightness < 1) {
          ctx.fillStyle = `rgba(0, 0, 0, ${1 - brightness})`;
          ctx.fillRect(0, 0, w, h);
        } else if (brightness > 1) {
          ctx.fillStyle = `rgba(255, 255, 255, ${(brightness - 1) * 0.5})`;
          ctx.fillRect(0, 0, w, h);
        }
      }
      // Darkening overlay for text readability
      ctx.fillStyle = `rgba(0, 0, 0, ${settings.glassOpacity * 0.5})`;
      ctx.fillRect(0, 0, w, h);
    } else {
      // Fallback solid background
      ctx.fillStyle = `rgba(0, 0, 0, ${settings.glassOpacity})`;
      ctx.fillRect(0, 0, w, h);
    }

    // Calculate dt for shuffle effect
    const shuffleDt = timestamp - lastMarqueeTime > 0 && timestamp - lastMarqueeTime < 100
      ? (timestamp - lastMarqueeTime) / 1000
      : 0.016;

    // Get text rows with shuffle effect applied
    const rawRows = [
      settings.glassTextRow1,
      settings.glassTextRow2,
      settings.glassTextRow3,
      settings.glassTextRow4,
    ];
    const rows = rawRows
      .map((row, i) => row && row.trim() !== "" ? getShuffledText(i, row, shuffleDt) : "")
      .filter(row => row !== "");

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
    const startY = (h - totalHeight) / 2 + lineHeight / 2 + (settings.glassTextOffsetY || 0);
    const letterSpacing = settings.glassTextLetterSpacing || 0;

    // Helper function to draw text with letter spacing
    function drawTextWithSpacing(text, x, y, align = "left") {
      if (letterSpacing === 0) {
        ctx.textAlign = align;
        ctx.fillText(text, x, y);
        return;
      }

      // Draw each character with spacing
      ctx.textAlign = "left";
      let currentX = x;

      // Adjust starting position for alignment
      if (align === "center" || align === "right") {
        let totalWidth = 0;
        for (const char of text) {
          totalWidth += ctx.measureText(char).width + letterSpacing;
        }
        totalWidth -= letterSpacing; // Remove last spacing
        if (align === "center") currentX = x - totalWidth / 2;
        else if (align === "right") currentX = x - totalWidth;
      }

      for (const char of text) {
        ctx.fillText(char, currentX, y);
        currentX += ctx.measureText(char).width + letterSpacing;
      }
    }

    // Helper to measure text width with letter spacing
    function measureTextWithSpacing(text) {
      if (letterSpacing === 0) return ctx.measureText(text).width;
      let totalWidth = 0;
      for (const char of text) {
        totalWidth += ctx.measureText(char).width + letterSpacing;
      }
      return totalWidth - letterSpacing; // Remove last spacing
    }

    // Handle marquee animation - text scrolls fully off before reappearing
    if (settings.glassTextMarquee) {
      // Update marquee offset based on time
      const dt = timestamp - lastMarqueeTime;
      lastMarqueeTime = timestamp;
      if (dt > 0 && dt < 100) {
        marqueeOffset += (settings.glassTextMarqueeSpeed * dt) / 1000;
      }

      // Find the longest text width for resetting the loop
      let maxTextWidth = 0;
      for (const text of rows) {
        maxTextWidth = Math.max(maxTextWidth, measureTextWithSpacing(text));
      }
      // Total distance: start off-right (w) + scroll across + exit off-left (maxTextWidth)
      const totalScrollDistance = w + maxTextWidth + (rows.length - 1) * settings.glassTextRowDelay;

      // Reset marquee when all text has scrolled off
      if (marqueeOffset > totalScrollDistance) {
        marqueeOffset = 0;
      }

      for (let i = 0; i < rows.length; i++) {
        const y = startY + i * lineHeight;
        const text = rows[i];
        const textWidth = measureTextWithSpacing(text);
        // Apply row delay offset (each row starts further back)
        const rowOffset = marqueeOffset - (i * settings.glassTextRowDelay);

        // Text starts at right edge (w) and scrolls left
        const x = w - rowOffset;

        // Only draw if text is visible on canvas
        if (x > -textWidth && x < w) {
          drawTextWithSpacing(text, x, y, "left");
        }
      }
    } else {
      // Static text
      let xPos;
      switch (settings.glassTextAlign) {
        case "left": xPos = 50; break;
        case "right": xPos = w - 50; break;
        default: xPos = w / 2; break;
      }

      for (let i = 0; i < rows.length; i++) {
        const y = startY + i * lineHeight;
        drawTextWithSpacing(rows[i], xPos, y, settings.glassTextAlign);
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
    }
  }

  // ============================================
  // INPUT
  // ============================================

  const keys = new Set();
  const chaserControlKeys = [
    "arrowup", "arrowdown", "arrowleft", "arrowright",
    "w", "a", "s", "d", "t", "f", "g", "h", "i", "j", "k", "l"
  ];
  window.addEventListener("keydown", (e) => {
    const keyLower = e.key.toLowerCase();
    if (chaserControlKeys.includes(keyLower)) {
      e.preventDefault();
      // Auto-start game when any chaser movement key is pressed
      if (STATE.loaded && !settings.gameStarted && !STATE.gameOver) {
        settings.gameStarted = true;
      }
    }
    keys.add(keyLower);
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

  const directionalLight = new THREE.DirectionalLight(settings.directColor, settings.directIntensity);
  directionalLight.position.set(settings.directPosX, settings.directPosY, settings.directPosZ);
  directionalLight.castShadow = true;
  directionalLight.shadow.mapSize.width = 2048;
  directionalLight.shadow.mapSize.height = 2048;
  directionalLight.shadow.camera.near = 0.1;
  directionalLight.shadow.camera.far = 50;
  directionalLight.shadow.camera.left = -15;
  directionalLight.shadow.camera.right = 15;
  directionalLight.shadow.camera.top = 15;
  directionalLight.shadow.camera.bottom = -15;
  scene.add(directionalLight);

  // Apply initial tone mapping settings
  const toneMappingOptions = {
    "None": THREE.NoToneMapping,
    "Linear": THREE.LinearToneMapping,
    "Reinhard": THREE.ReinhardToneMapping,
    "Cineon": THREE.CineonToneMapping,
    "ACESFilmic": THREE.ACESFilmicToneMapping,
    "AgX": THREE.AgXToneMapping,
    "Neutral": THREE.NeutralToneMapping,
  };
  renderer.toneMapping = toneMappingOptions[settings.toneMapping] || THREE.LinearToneMapping;
  renderer.toneMappingExposure = settings.exposure;

  // Generate neutral environment for PBR materials
  function createNeutralEnvironment() {
    const pmremGenerator = new THREE.PMREMGenerator(renderer);
    pmremGenerator.compileEquirectangularShader();

    // Create a simple neutral environment scene
    const envScene = new THREE.Scene();
    envScene.background = new THREE.Color(0.5, 0.5, 0.5);

    // Add soft lights to the environment scene
    const light1 = new THREE.DirectionalLight(0xffffff, 1);
    light1.position.set(1, 1, 1);
    envScene.add(light1);

    const light2 = new THREE.DirectionalLight(0xffffff, 0.5);
    light2.position.set(-1, 0.5, -1);
    envScene.add(light2);

    const ambLight = new THREE.AmbientLight(0xffffff, 0.4);
    envScene.add(ambLight);

    const envMap = pmremGenerator.fromScene(envScene, 0.04).texture;
    pmremGenerator.dispose();

    return envMap;
  }

  // Apply neutral environment
  const neutralEnvMap = createNeutralEnvironment();
  scene.environment = neutralEnvMap;
  scene.environmentIntensity = settings.environmentIntensity;

  // ============================================
  // CAMERAS
  // ============================================

  function setupCameras(levelCenter, horizontalSize) {
    const aspect = window.innerWidth / window.innerHeight;

    perspCamera = new THREE.PerspectiveCamera(settings.perspFov, aspect, settings.perspNear, settings.perspFar);
    perspCamera.position.set(settings.perspPosX, settings.perspPosY, settings.perspPosZ);
    perspCamera.lookAt(levelCenter);

    const frustumSize = horizontalSize * 1.5;
    const orthoDistance = horizontalSize * 1.2;
    orthoCamera = new THREE.OrthographicCamera(
      frustumSize * aspect / -2,
      frustumSize * aspect / 2,
      frustumSize / 2,
      frustumSize / -2,
      0.1,
      5000
    );
    orthoCamera.position.set(levelCenter.x, levelCenter.y + orthoDistance, levelCenter.z);
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

    // Settings controls at the top
    guiLeft.add(settings, "saveSettings").name("Save Settings");
    guiLeft.add(settings, "clearSettings").name("Clear Settings");

    // ==================== GAME ====================
    const gameFolder = guiLeft.addFolder("Game");
    gameFolder.add(settings, "startGame").name("Start Game");
    gameFolder.add(settings, "fugitiveSpeed", 0.1, 15, 0.1).name("Fugitive Speed").onChange((v) => {
      for (const f of fugitives) f.speed = v;
    });
    gameFolder.add(settings, "chaserSpeed", 0.1, 15, 0.1).name("Chaser Speed").onChange((v) => {
      for (const c of chasers) c.speed = v;
    });
    gameFolder.add(settings, "chaserHeightOffset", -0.5, 0.5, 0.01).name("Chaser Height");
    gameFolder.add(settings, "fugitiveIntelligence", 0.5, 1, 0.05).name("Fugitive AI");
    gameFolder.add(settings, "showNavmesh").name("Show Path Debug").onChange((v) => {
      const pathGraphDebug = scene.getObjectByName("PathGraphDebug");
      if (pathGraphDebug) pathGraphDebug.visible = v;
    });
    gameFolder.add(settings, "actorScale", 0.5, 2.5, 0.1).name("Actor Scale (reload)");
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
        perspCamera.lookAt(STATE.levelCenter);
      }
    }

    perspFolder.add(settings, "perspPosX", -500, 500, 0.01).name("Pos X").onChange(updatePerspCameraPos);
    perspFolder.add(settings, "perspPosY", 0, 500, 0.01).name("Pos Y").onChange(updatePerspCameraPos);
    perspFolder.add(settings, "perspPosZ", -500, 500, 0.01).name("Pos Z").onChange(updatePerspCameraPos);
    perspFolder.close();
    cameraFolder.close();

    // ==================== LIGHTING ====================
    const lightsFolder = guiLeft.addFolder("Lighting");

    lightsFolder.add(settings, "toneMapping", Object.keys(toneMappingOptions)).name("Tone Mapping").onChange((v) => {
      renderer.toneMapping = toneMappingOptions[v];
    });
    lightsFolder.add(settings, "exposure", 0, 3, 0.01).name("Exposure").onChange((v) => {
      renderer.toneMappingExposure = v;
    });
    lightsFolder.add(settings, "environmentIntensity", 0, 3, 0.1).name("Environment").onChange((v) => {
      scene.environmentIntensity = v;
    });
    lightsFolder.add(settings, "punctualLights").name("Punctual Lights").onChange((v) => {
      // Toggle fugitive and chaser lights
      for (const f of fugitives) {
        if (f.light) f.light.visible = v;
      }
      for (const c of chasers) {
        if (c.light) c.light.visible = v;
      }
    });

    const ambientFolder = lightsFolder.addFolder("Ambient Light");
    ambientFolder.add(settings, "ambientIntensity", 0, 5, 0.1).name("Intensity").onChange((v) => {
      ambientLight.intensity = v;
    });
    ambientFolder.addColor(settings, "ambientColor").name("Color").onChange((v) => {
      ambientLight.color.set(v);
    });
    ambientFolder.close();

    const directFolder = lightsFolder.addFolder("Directional Light");
    directFolder.add(settings, "directIntensity", 0, 5, 0.1).name("Intensity").onChange((v) => {
      directionalLight.intensity = v;
    });
    directFolder.addColor(settings, "directColor").name("Color").onChange((v) => {
      directionalLight.color.set(v);
    });

    function updateDirectLightPos() {
      directionalLight.position.set(settings.directPosX, settings.directPosY, settings.directPosZ);
    }
    directFolder.add(settings, "directPosX", -20, 20, 0.5).name("Pos X").onChange(updateDirectLightPos);
    directFolder.add(settings, "directPosY", 0, 30, 0.5).name("Pos Y").onChange(updateDirectLightPos);
    directFolder.add(settings, "directPosZ", -20, 20, 0.5).name("Pos Z").onChange(updateDirectLightPos);
    directFolder.close();

    const fugitiveLightFolder = lightsFolder.addFolder("Fugitive Lights");
    fugitiveLightFolder.addColor(settings, "fugitiveColor").name("Color").onChange(updateFugitiveLights);
    fugitiveLightFolder.add(settings, "fugitiveLightIntensity", 0, 10, 0.1).name("Intensity").onChange(updateFugitiveLights);
    fugitiveLightFolder.close();

    const chaserLightFolder = lightsFolder.addFolder("Chaser Lights");
    chaserLightFolder.addColor(settings, "chaser1Color").name("Chaser 1").onChange(updateChaserLights);
    chaserLightFolder.addColor(settings, "chaser2Color").name("Chaser 2").onChange(updateChaserLights);
    chaserLightFolder.addColor(settings, "chaser3Color").name("Chaser 3").onChange(updateChaserLights);
    chaserLightFolder.addColor(settings, "chaser4Color").name("Chaser 4").onChange(updateChaserLights);
    chaserLightFolder.add(settings, "chaserLightIntensity", 0, 100, 1).name("Intensity").onChange(updateChaserLights);
    chaserLightFolder.add(settings, "chaserLightHeight", 0, 10, 0.1).name("Height").onChange(updateChaserLights);
    chaserLightFolder.add(settings, "chaserLightDistance", 10, 200, 5).name("Distance").onChange(updateChaserLights);
    chaserLightFolder.add(settings, "chaserLightAngle", 10, 90, 1).name("Angle (°)").onChange(updateChaserLights);
    chaserLightFolder.add(settings, "chaserLightPenumbra", 0, 1, 0.05).name("Penumbra").onChange(updateChaserLights);
    chaserLightFolder.add(settings, "chaserLightOffset", 0, 0.2, 0.01).name("Offset").onChange(updateChaserLights);
    chaserLightFolder.close();

    lightsFolder.close();

    // ==================== FUGITIVE WIRES ====================
    const wireFolder = guiLeft.addFolder("Fugitive Wires");
    wireFolder.add(settings, "wireEnabled").name("Enabled");
    wireFolder.add(settings, "wireHeight", 0.1, 5, 0.1).name("Height");
    wireFolder.add(settings, "wireGravity", 0, 0.5, 0.01).name("Gravity");
    wireFolder.add(settings, "wireFriction", 0.8, 0.99, 0.01).name("Friction");
    wireFolder.add(settings, "wireCubeSize", 0.2, 4, 0.1).name("Billboard Size").onChange(updateWireBillboards);
    wireFolder.add(settings, "billboardBrightness", 0, 1, 0.05).name("Billboard Brightness").onChange((v) => {
      for (const wire of fugitiveWires) {
        if (wire.billboard && wire.billboard.material) {
          wire.billboard.material.color.setRGB(v, v, v);
        }
      }
    });
    wireFolder.add(settings, "billboardCenterPull", 0, 1, 0.05).name("Center Pull");
    wireFolder.add(settings, "billboardMaxDistance", 0, 5, 0.01).name("Max Distance");
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
    const glassFolder = guiLeft.addFolder("Text");
    glassFolder.add(settings, "glassEnabled").name("Enabled").onChange((v) => {
      for (const mesh of glassMeshes) {
        mesh.visible = v;
      }
    });
    glassFolder.add(settings, "glassOpacity", 0, 1, 0.05).name("Background Opacity").onChange((v) => {
      updateGlassCanvas();
    });
    glassFolder.add(settings, "glassVideoEnabled").name("Video Background").onChange((v) => {
      if (glassVideo) {
        if (v) {
          glassVideo.play().catch(() => {});
        } else {
          glassVideo.pause();
        }
      }
      updateGlassCanvas();
    });
    glassFolder.add(settings, "glassVideoOpacity", 0, 1, 0.05).name("Video Opacity");
    glassFolder.add(settings, "glassVideoBrightness", 0, 2, 0.05).name("Video Brightness");

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
    textStyleFolder.add(settings, "glassTextOffsetY", -500, 500, 10).name("Offset Y").onChange(() => updateGlassCanvas());
    textStyleFolder.add(settings, "glassTextLetterSpacing", -20, 50, 1).name("Letter Spacing").onChange(() => updateGlassCanvas());
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
    marqueeFolder.add(settings, "glassTextShuffle").name("Text Shuffle Effect");
    marqueeFolder.add(settings, "glassTextShuffleSpeed", 0.2, 3, 0.1).name("Shuffle Speed");
    marqueeFolder.close();
    glassFolder.close();

    // ==================== AUDIO ====================
    const audioFolder = guiLeft.addFolder("Audio");
    const audioControls = {
      play: function() {
        if (audioElement) {
          audioElement.volume = settings.audioVolume;
          audioElement.play().catch(() => {});
        }
      },
      stop: function() {
        stopAudio();
      }
    };
    audioFolder.add(audioControls, "play").name("▶ Play");
    audioFolder.add(audioControls, "stop").name("■ Stop");
    audioFolder.add(settings, "audioVolume", 0, 1, 0.05).name("Volume").onChange((v) => {
      if (audioElement) audioElement.volume = v;
    });
    audioFolder.add(settings, "audioTrack", Object.keys(PATHS.audio)).name("Track").onChange((v) => {
      setAudioTrack(v);
    });
    audioFolder.close();

    // ==================== HELICOPTER ====================
    const helicopterFolder = guiLeft.addFolder("Helicopter");
    helicopterFolder.add(settings, "helicopterEnabled").name("Enabled");
    helicopterFolder.add(settings, "helicopterHeight", 2, 20, 0.5).name("Height");
    helicopterFolder.add(settings, "helicopterSpeed", 0.1, 2, 0.1).name("Drift Speed");
    helicopterFolder.add(settings, "helicopterRadius", 2, 15, 0.5).name("Drift Range");
    helicopterFolder.add(settings, "helicopterScale", 0.1, 2, 0.1).name("Scale");
    helicopterFolder.add(settings, "helicopterLightIntensity", 0, 500, 10).name("Light Intensity");
    helicopterFolder.addColor(settings, "helicopterLightColor").name("Light Color");
    helicopterFolder.add(settings, "helicopterLightAngle", 1, 60, 1).name("Light Angle");
    helicopterFolder.close();

    // ==================== CLOUDS ====================
    const cloudsFolder = guiLeft.addFolder("Clouds");
    cloudsFolder.add(settings, "cloudsEnabled").name("Enabled");
    cloudsFolder.add(settings, "cloudCount", 1, 5, 1).name("Count").onChange(() => spawnClouds());
    cloudsFolder.add(settings, "cloudOpacity", 0, 1, 0.05).name("Opacity");
    cloudsFolder.add(settings, "cloudScaleMin", 1, 10, 0.5).name("Scale Min");
    cloudsFolder.add(settings, "cloudScaleMax", 1, 15, 0.5).name("Scale Max");
    cloudsFolder.add(settings, "cloudHeightMin", 3, 15, 0.5).name("Height Min");
    cloudsFolder.add(settings, "cloudHeightMax", 5, 20, 0.5).name("Height Max");
    cloudsFolder.add(settings, "cloudSpeedMin", 0.1, 1, 0.05).name("Speed Min");
    cloudsFolder.add(settings, "cloudSpeedMax", 0.2, 2, 0.05).name("Speed Max");
    cloudsFolder.add(settings, "cloudBlending", ["Normal", "Additive", "Multiply", "Screen"]).name("Blending");
    cloudsFolder.add({ respawn: () => spawnClouds() }, "respawn").name("Respawn Clouds");
    cloudsFolder.close();

    // ==================== VIDEO PLANES ====================
    const videoPlanesFolder = guiLeft.addFolder("Video Planes");

    const plane1Folder = videoPlanesFolder.addFolder("Left Screen");
    plane1Folder.add(settings, "videoPlane1Enabled").name("Enabled").onChange((v) => {
      if (videoPlane1) videoPlane1.visible = v;
    });
    plane1Folder.add(settings, "videoPlane1PosX", -50, 50, 0.1).name("Pos X").onChange(updateVideoPlane1);
    plane1Folder.add(settings, "videoPlane1PosY", -50, 50, 0.1).name("Pos Y").onChange(updateVideoPlane1);
    plane1Folder.add(settings, "videoPlane1PosZ", -50, 50, 0.1).name("Pos Z").onChange(updateVideoPlane1);
    plane1Folder.add(settings, "videoPlane1ScaleX", 0.1, 50, 0.1).name("Scale X").onChange(updateVideoPlane1);
    plane1Folder.add(settings, "videoPlane1ScaleY", 0.1, 50, 0.1).name("Scale Y").onChange(updateVideoPlane1);
    plane1Folder.close();

    const plane2Folder = videoPlanesFolder.addFolder("Right Screen");
    plane2Folder.add(settings, "videoPlane2Enabled").name("Enabled").onChange((v) => {
      if (videoPlane2) videoPlane2.visible = v;
    });
    plane2Folder.add(settings, "videoPlane2PosX", -50, 50, 0.1).name("Pos X").onChange(updateVideoPlane2);
    plane2Folder.add(settings, "videoPlane2PosY", -50, 50, 0.1).name("Pos Y").onChange(updateVideoPlane2);
    plane2Folder.add(settings, "videoPlane2PosZ", -50, 50, 0.1).name("Pos Z").onChange(updateVideoPlane2);
    plane2Folder.add(settings, "videoPlane2ScaleX", 0.1, 50, 0.1).name("Scale X").onChange(updateVideoPlane2);
    plane2Folder.add(settings, "videoPlane2ScaleY", 0.1, 50, 0.1).name("Scale Y").onChange(updateVideoPlane2);
    plane2Folder.close();

    videoPlanesFolder.close();

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
    const glbPartsFolder = STATE.mainGUI.addFolder("GLB");

    // Parts that should have 0 opacity by default
    const hiddenByDefault = ["building-building", "pavement-paths"];

    glbParts.forEach((data, name) => {
      // Check if this part should be hidden by default
      const nameLower = name.toLowerCase();
      const shouldHide = hiddenByDefault.some(h => nameLower.includes(h.toLowerCase()));
      const defaultOpacity = shouldHide ? 0 : data.originalOpacity;

      // Apply default opacity to mesh
      if (shouldHide) {
        data.mesh.material.transparent = true;
        data.mesh.material.opacity = 0;
        data.mesh.material.needsUpdate = true;
      }

      const partSettings = {
        color: "#" + data.originalColor.getHexString(),
        opacity: defaultOpacity,
        visible: true
      };

      const folder = glbPartsFolder.addFolder(name);
      const mat = data.mesh.material;

      // Basic properties
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

      // Material properties (simplified)
      if (mat) {
        if (mat.roughness !== undefined) {
          folder.add(mat, "roughness", 0, 1, 0.01).name("Roughness");
        }
        if (mat.metalness !== undefined) {
          folder.add(mat, "metalness", 0, 1, 0.01).name("Metalness");
        }
        if (mat.wireframe !== undefined) {
          folder.add(mat, "wireframe").name("Wireframe");
        }
      }

      folder.close();
    });

    glbPartsFolder.close();
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
    const color = settings.fugitiveColor;
    for (const f of fugitives) {
      if (f.light) {
        f.light.color.set(color);
        f.light.intensity = settings.fugitiveLightIntensity;
      }
      if (f.mesh && f.mesh.material) {
        f.mesh.material.color.set(color);
        f.mesh.material.emissive.set(color);
        f.mesh.material.emissiveIntensity = 0.3;
      }
    }
  }

  function updateChaserLights() {
    const colors = [settings.chaser1Color, settings.chaser2Color, settings.chaser3Color, settings.chaser4Color];
    console.log(`Updating ${chasers.length} chaser lights, height=${settings.chaserLightHeight}`);
    for (let i = 0; i < chasers.length; i++) {
      const c = chasers[i];
      const color = colors[i] || colors[0];
      if (c.light) {
        c.light.color.set(color);
        // Keep dimmed if not active
        c.light.intensity = c.active ? settings.chaserLightIntensity : settings.chaserLightIntensity * 0.1;
        c.light.distance = settings.chaserLightDistance;
        c.light.angle = (settings.chaserLightAngle * Math.PI) / 180; // Convert degrees to radians
        c.light.penumbra = settings.chaserLightPenumbra;
        // Account for mesh scale when setting light position
        const meshScale = c.mesh.scale.y || 1;
        c.light.position.y = settings.chaserLightHeight / meshScale;
        c.light.position.z = -settings.chaserLightOffset / meshScale; // Front offset (negative due to car flip)
      }
      // Update materials (handle both box and car models)
      if (c.isCarModel) {
        c.mesh.traverse((child) => {
          if (child.isMesh && child.material) {
            child.material.color.set(color);
            child.material.emissive.set(color);
            child.material.emissiveIntensity = c.active ? 0.3 : 0.05;
          }
        });
      } else if (c.mesh && c.mesh.material) {
        c.mesh.material.color.set(color);
        c.mesh.material.emissive.set(color);
        c.mesh.material.emissiveIntensity = c.active ? 0.3 : 0.05;
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
        linewidth: 2,
        transparent: true,
        depthWrite: false,
        depthTest: false
      });

      this.line = new THREE.Line(geometry, material);
      this.line.renderOrder = 1000;
      scene.add(this.line);

      const billboardSize = settings.wireCubeSize * this.actorSize * 2;
      const billboardGeo = new THREE.PlaneGeometry(billboardSize, billboardSize);
      const brightness = settings.billboardBrightness;
      const billboardMat = new THREE.MeshBasicMaterial({
        color: new THREE.Color(brightness, brightness, brightness),
        side: THREE.DoubleSide,
        transparent: true,
        depthWrite: false,
        depthTest: false
      });
      this.billboard = new THREE.Mesh(billboardGeo, billboardMat);
      this.billboard.rotation.x = -Math.PI / 2;
      this.billboard.castShadow = false;
      this.billboard.renderOrder = 1001; // Render on top of wire and glass
      scene.add(this.billboard);

      if (!this.isChaser) {
        const textureLoader = new THREE.TextureLoader();
        const pair = FACE_TEXTURES[this.index] || FACE_TEXTURES[0];
        this.textures = [null, null];
        this.currentTextureIndex = 0;

        const facePath = PATHS.images.faces;
        textureLoader.load(facePath + pair[0],
          (texture) => {
            this.textures[0] = texture;
            this.billboard.material.map = texture;
            this.billboard.material.needsUpdate = true;
          },
          undefined,
          () => this.billboard.material.color.set(this.color)
        );
        textureLoader.load(facePath + pair[1],
          (texture) => {
            this.textures[1] = texture;
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
      if (!this.isFading || !this.billboard) return;
      // Skip fade updates for captured fugitives
      if (!this.isChaser && this.actor.captured) {
        this.isFading = false;
        return;
      }

      const fadeSpeed = 1.0 / settings.faceSwapFadeDuration;
      this.fadeProgress += this.fadeDirection * fadeSpeed * dt;

      if (this.fadeDirection === -1 && this.fadeProgress <= 0) {
        // Fully faded out - swap texture and start fading in
        this.fadeProgress = 0;
        if (this.pendingTextureSwap) {
          this.currentTextureIndex = 1 - this.currentTextureIndex;
          const newTexture = this.textures[this.currentTextureIndex];
          if (newTexture && this.billboard.material) {
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
      if (this.billboard.material) {
        this.billboard.material.opacity = this.fadeProgress;
        this.billboard.material.needsUpdate = true;
      }
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

      // Pull billboard toward center of level
      const center = STATE.levelCenter || { x: 0, z: 0 };
      const centerPull = settings.billboardCenterPull;
      let targetX = actorPos.x + (center.x - actorPos.x) * centerPull + swayX;
      let targetZ = actorPos.z + (center.z - actorPos.z) * centerPull + swayZ;

      // Limit distance from actor
      const maxDist = settings.billboardMaxDistance;
      const dx = targetX - actorPos.x;
      const dz = targetZ - actorPos.z;
      const dist = Math.sqrt(dx * dx + dz * dz);
      if (dist > maxDist) {
        const scale = maxDist / dist;
        targetX = actorPos.x + dx * scale;
        targetZ = actorPos.z + dz * scale;
      }

      topPoint.setPos(targetX, actorPos.y + totalHeight, targetZ);

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

      // Billboard position: start at actor, offset toward center (clamped by maxDist)
      let billboardX = actorPos.x;
      let billboardZ = actorPos.z;

      // Calculate offset toward center
      const toCenterX = center.x - actorPos.x;
      const toCenterZ = center.z - actorPos.z;
      const toCenterDist = Math.sqrt(toCenterX * toCenterX + toCenterZ * toCenterZ);

      if (toCenterDist > 0.01 && maxDist > 0) {
        // Offset toward center, limited by maxDist
        const pullStrength = Math.min(maxDist, toCenterDist * centerPull);
        billboardX = actorPos.x + (toCenterX / toCenterDist) * pullStrength;
        billboardZ = actorPos.z + (toCenterZ / toCenterDist) * pullStrength;
      }

      this.billboard.position.set(billboardX, actorPos.y + totalHeight, billboardZ);
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
  // GAME TIMER & RESET
  // ============================================

  function formatTimer(seconds) {
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins}:${secs.toString().padStart(2, "0")}`;
  }

  function updateTimerDisplay() {
    if (STATE.showingScore) return;

    if (STATE.gameTimerStarted && !STATE.gameOver) {
      settings.glassTextRow4 = `TIME ${formatTimer(STATE.gameTimerRemaining)}`;
    }
  }

  function showGameScore() {
    STATE.showingScore = true;
    STATE.scoreDisplayTime = 5; // Show score for 5 seconds

    const caught = STATE.capturedCount || 0;
    const total = fugitives.length;
    const timeUsed = 90 - Math.max(0, STATE.gameTimerRemaining);

    settings.glassTextRow1 = "GAME OVER";
    settings.glassTextRow2 = `CAUGHT ${caught} OF ${total}`;
    settings.glassTextRow3 = `TIME ${formatTimer(timeUsed)}`;
    settings.glassTextRow4 = "";
  }

  function resetGame() {
    // Reset state
    STATE.gameOver = false;
    STATE.gameTimerStarted = false;
    STATE.gameTimerRemaining = 90;
    STATE.showingScore = false;
    STATE.scoreDisplayTime = 0;
    STATE.capturedCount = 0;
    settings.gameStarted = false;

    // Reset text rows
    settings.glassTextRow1 = defaultSettings.glassTextRow1;
    settings.glassTextRow2 = defaultSettings.glassTextRow2;
    settings.glassTextRow3 = defaultSettings.glassTextRow3;
    settings.glassTextRow4 = defaultSettings.glassTextRow4;

    // Reset fugitives
    for (const f of fugitives) {
      f.captured = false;
      f.mesh.visible = true;
      if (f.light) f.light.visible = true;

      // Re-initialize on path
      initActorOnPath(f);

      // Re-show billboard and wire
      const wire = fugitiveWires[f.index];
      if (wire) {
        if (wire.billboard) wire.billboard.visible = true;
        if (wire.line) wire.line.visible = true;
      }
    }

    // Reset chasers
    for (const c of chasers) {
      c.active = false;
      c.isMoving = false;
      c.queuedDirX = 0;
      c.queuedDirZ = 0;
      c.currentEdge = null;

      // Re-initialize position
      initActorOnPath(c);

      // Set to passive appearance
      if (c.isCarModel) {
        c.mesh.traverse((child) => {
          if (child.isMesh && child.material) {
            child.material.opacity = 0.5;
            child.material.transparent = true;
          }
        });
      } else if (c.material) {
        c.material.opacity = 0.3;
        c.material.transparent = true;
      }
      if (c.light) {
        c.light.intensity = settings.chaserLightIntensity * 0.1;
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
  // PATH-BASED MOVEMENT
  // ============================================

  // Initialize actor on path graph
  function initActorOnPath(actor) {
    const { pathGraph, findNearestEdgePoint, projectYOnRoad } = STATE;
    if (!pathGraph || pathGraph.edges.length === 0) return;

    const pos = actor.mesh.position;
    const nearest = findNearestEdgePoint(pos.x, pos.z, pathGraph);

    if (nearest.edge) {
      actor.currentEdge = nearest.edge;
      actor.edgeT = nearest.t; // 0-1 position along edge
      actor.edgeDir = 1; // +1 = toward node2, -1 = toward node1

      // Snap to edge
      pos.x = nearest.point.x;
      pos.z = nearest.point.z;
      projectYOnRoad(pos);

      // Set direction based on edge
      const dx = actor.currentEdge.x2 - actor.currentEdge.x1;
      const dz = actor.currentEdge.z2 - actor.currentEdge.z1;
      actor.dirX = Math.sign(dx) || 0;
      actor.dirZ = Math.sign(dz) || 0;
    }
  }

  // Get position on edge from t value
  function getEdgePosition(edge, t) {
    return {
      x: edge.x1 + (edge.x2 - edge.x1) * t,
      z: edge.z1 + (edge.z2 - edge.z1) * t
    };
  }

  // Find edge at node going in specified direction (uses dot product for best match)
  function findEdgeInDirection(node, dirX, dirZ, pathGraph, excludeEdge = null) {
    let bestMatch = null;
    let bestDot = -Infinity;

    for (const edgeId of node.edges) {
      if (excludeEdge && edgeId === excludeEdge.id) continue;

      const edge = pathGraph.edges[edgeId];
      let edgeDirX, edgeDirZ;

      if (edge.node1 === node.id) {
        edgeDirX = edge.x2 - edge.x1;
        edgeDirZ = edge.z2 - edge.z1;
      } else {
        edgeDirX = edge.x1 - edge.x2;
        edgeDirZ = edge.z1 - edge.z2;
      }

      // Normalize edge direction
      const len = Math.sqrt(edgeDirX * edgeDirX + edgeDirZ * edgeDirZ);
      if (len < 0.001) continue;
      edgeDirX /= len;
      edgeDirZ /= len;

      // Dot product with requested direction
      const dot = edgeDirX * dirX + edgeDirZ * dirZ;

      // Only consider edges going roughly in the right direction (dot > 0.5 = within ~60 degrees)
      if (dot > 0.5 && dot > bestDot) {
        bestDot = dot;
        bestMatch = { edge, startFromNode1: edge.node1 === node.id };
      }
    }
    return bestMatch;
  }

  // Get all available directions at a node
  function getAvailableDirectionsAtNode(node, pathGraph) {
    const directions = [];
    for (const edgeId of node.edges) {
      const edge = pathGraph.edges[edgeId];
      let dirX, dirZ, startFromNode1;

      if (edge.node1 === node.id) {
        dirX = edge.x2 - edge.x1;
        dirZ = edge.z2 - edge.z1;
        startFromNode1 = true;
      } else {
        dirX = edge.x1 - edge.x2;
        dirZ = edge.z1 - edge.z2;
        startFromNode1 = false;
      }

      // Normalize direction
      const len = Math.sqrt(dirX * dirX + dirZ * dirZ);
      if (len > 0.001) {
        dirX /= len;
        dirZ /= len;
      }

      directions.push({ edge, dirX, dirZ, startFromNode1 });
    }
    return directions;
  }

  function updateFugitiveMovementPath(actor, dt) {
    const { pathGraph, projectYOnRoad } = STATE;
    if (!pathGraph || !actor.currentEdge) return;

    const pos = actor.mesh.position;
    const moveDistance = actor.speed * dt;

    // Move along current edge
    const edgeLength = actor.currentEdge.length;
    const tDelta = (moveDistance / edgeLength) * actor.edgeDir;
    actor.edgeT += tDelta;

    // Check if reached a node
    if (actor.edgeT >= 1) {
      actor.edgeT = 1;
      const nodeId = actor.currentEdge.node2;
      handleFugitiveAtNode(actor, pathGraph.nodes[nodeId], pathGraph);
    } else if (actor.edgeT <= 0) {
      actor.edgeT = 0;
      const nodeId = actor.currentEdge.node1;
      handleFugitiveAtNode(actor, pathGraph.nodes[nodeId], pathGraph);
    }

    // Update position
    const newPos = getEdgePosition(actor.currentEdge, actor.edgeT);
    pos.x = newPos.x;
    pos.z = newPos.z;
    projectYOnRoad(pos);
  }

  function handleFugitiveAtNode(actor, node, pathGraph) {
    const intelligence = settings.fugitiveIntelligence;
    const available = getAvailableDirectionsAtNode(node, pathGraph);

    if (available.length === 0) return;

    // Calculate threat direction from chasers
    let threatX = 0, threatZ = 0;
    let closestDist = Infinity;

    for (const c of chasers) {
      if (!c.active) continue;
      const dx = actor.mesh.position.x - c.mesh.position.x;
      const dz = actor.mesh.position.z - c.mesh.position.z;
      const dist = Math.sqrt(dx * dx + dz * dz);
      if (dist < closestDist) closestDist = dist;
      if (dist > 0.1) {
        const weight = 1 / (dist * dist + 0.1);
        threatX += (dx / dist) * weight;
        threatZ += (dz / dist) * weight;
      }
    }

    // Calculate separation from other fugitives
    let separationX = 0, separationZ = 0;
    const separationRange = 5; // Distance within which fugitives repel each other

    for (const f of fugitives) {
      if (f === actor) continue;
      const dx = actor.mesh.position.x - f.mesh.position.x;
      const dz = actor.mesh.position.z - f.mesh.position.z;
      const dist = Math.sqrt(dx * dx + dz * dz);
      if (dist > 0.1 && dist < separationRange) {
        // Stronger repulsion when closer
        const weight = 1 / (dist * dist + 0.1);
        separationX += (dx / dist) * weight;
        separationZ += (dz / dist) * weight;
      }
    }

    const threatLen = Math.sqrt(threatX * threatX + threatZ * threatZ);
    const hasThreat = threatLen > 0.01 && closestDist < 30;

    const separationLen = Math.sqrt(separationX * separationX + separationZ * separationZ);
    const hasSeparation = separationLen > 0.01;

    let chosen;

    if (hasThreat && Math.random() < intelligence) {
      // Escape: choose direction most aligned with escape
      threatX /= threatLen;
      threatZ /= threatLen;

      // Blend in separation if fugitives are close
      if (hasSeparation) {
        separationX /= separationLen;
        separationZ /= separationLen;
        // Chasers are more important (0.7) but separation also matters (0.3)
        threatX = threatX * 0.7 + separationX * 0.3;
        threatZ = threatZ * 0.7 + separationZ * 0.3;
        const blendLen = Math.sqrt(threatX * threatX + threatZ * threatZ);
        if (blendLen > 0.01) {
          threatX /= blendLen;
          threatZ /= blendLen;
        }
      }

      let bestScore = -Infinity;
      for (const dir of available) {
        const score = dir.dirX * threatX + dir.dirZ * threatZ;
        if (score > bestScore) {
          bestScore = score;
          chosen = dir;
        }
      }
    } else if (hasSeparation && Math.random() < 0.6) {
      // No chaser threat but fugitives nearby: move away from them
      separationX /= separationLen;
      separationZ /= separationLen;

      let bestScore = -Infinity;
      for (const dir of available) {
        const score = dir.dirX * separationX + dir.dirZ * separationZ;
        if (score > bestScore) {
          bestScore = score;
          chosen = dir;
        }
      }
    } else {
      // Random: prefer not reversing
      const currentDirX = actor.dirX;
      const currentDirZ = actor.dirZ;
      const nonReverse = available.filter(d =>
        !(d.dirX === -currentDirX && d.dirZ === -currentDirZ)
      );
      const choices = nonReverse.length > 0 ? nonReverse : available;
      chosen = choices[Math.floor(Math.random() * choices.length)];
    }

    if (chosen) {
      actor.currentEdge = chosen.edge;
      actor.edgeT = chosen.startFromNode1 ? 0 : 1;
      actor.edgeDir = chosen.startFromNode1 ? 1 : -1;
      actor.dirX = chosen.dirX;
      actor.dirZ = chosen.dirZ;
    }
  }

  function updateChaserMovementPath(actor, dt, chaserIndex) {
    const { pathGraph, projectYOnRoad } = STATE;
    if (!pathGraph || !actor.currentEdge || !actor.active) {
      return;
    }

    const pos = actor.mesh.position;
    const moveDistance = actor.speed * dt;

    // Move along current edge
    const edgeLength = actor.currentEdge.length;
    const tDelta = (moveDistance / edgeLength) * actor.edgeDir;
    actor.edgeT += tDelta;

    // Check if reached a node
    if (actor.edgeT >= 1) {
      const overshoot = actor.edgeT - 1;
      actor.edgeT = 1;
      const nodeId = actor.currentEdge.node2;
      handleChaserAtNode(actor, pathGraph.nodes[nodeId], pathGraph);
      // Apply overshoot to new edge
      if (actor.edgeT === 0) actor.edgeT = overshoot * (edgeLength / actor.currentEdge.length);
    } else if (actor.edgeT <= 0) {
      const overshoot = -actor.edgeT;
      actor.edgeT = 0;
      const nodeId = actor.currentEdge.node1;
      handleChaserAtNode(actor, pathGraph.nodes[nodeId], pathGraph);
      // Apply overshoot to new edge
      if (actor.edgeT === 1) actor.edgeT = 1 - overshoot * (edgeLength / actor.currentEdge.length);
    }

    // Update position
    const newPos = getEdgePosition(actor.currentEdge, actor.edgeT);
    pos.x = newPos.x;
    pos.z = newPos.z;
    projectYOnRoad(pos);
    // Apply chaser height offset
    pos.y += settings.chaserHeightOffset;

    // Rotate to face movement direction (headlight rotates with car automatically)
    const edge = actor.currentEdge;
    const travelDirX = (edge.x2 - edge.x1) * actor.edgeDir;
    const travelDirZ = (edge.z2 - edge.z1) * actor.edgeDir;
    if (Math.abs(travelDirX) > 0.01 || Math.abs(travelDirZ) > 0.01) {
      const targetRotation = Math.atan2(travelDirX, travelDirZ) + Math.PI;
      // Smooth rotation interpolation
      let currentRotation = actor.mesh.rotation.y;
      let diff = targetRotation - currentRotation;
      // Handle angle wrapping (-PI to PI)
      while (diff > Math.PI) diff -= Math.PI * 2;
      while (diff < -Math.PI) diff += Math.PI * 2;
      // Lerp towards target (adjust speed with multiplier)
      const rotationSpeed = 10;
      actor.mesh.rotation.y += diff * Math.min(1, rotationSpeed * dt);
    }
  }

  function handleChaserAtNode(actor, node, pathGraph) {
    if (!node) return;

    // Get current cardinal direction (edges are strictly H or V)
    const curEdge = actor.currentEdge;
    const travelDirX = Math.sign(curEdge.x2 - curEdge.x1) * actor.edgeDir;
    const travelDirZ = Math.sign(curEdge.z2 - curEdge.z1) * actor.edgeDir;

    // Collect available edges with their cardinal directions
    const options = [];
    for (const edgeId of node.edges) {
      if (edgeId === actor.currentEdge.id) continue;

      const edge = pathGraph.edges[edgeId];
      const startFromNode1 = edge.node1 === node.id;
      const dirX = startFromNode1 ? edge.dirX : -edge.dirX;
      const dirZ = startFromNode1 ? edge.dirZ : -edge.dirZ;

      options.push({ edge, startFromNode1, dirX, dirZ });
    }

    // Dead end - stop moving
    if (options.length === 0) {
      actor.isMoving = false;
      return;
    }

    // Priority 1: Match queued input exactly (cardinal)
    if (actor.queuedDirX !== 0 || actor.queuedDirZ !== 0) {
      const match = options.find(o => o.dirX === actor.queuedDirX && o.dirZ === actor.queuedDirZ);
      if (match) {
        actor.currentEdge = match.edge;
        actor.edgeT = match.startFromNode1 ? 0 : 1;
        actor.edgeDir = match.startFromNode1 ? 1 : -1;
        actor.queuedDirX = 0;
        actor.queuedDirZ = 0;
        return;
      }
    }

    // Priority 2: Continue straight if possible
    const straight = options.find(o => o.dirX === travelDirX && o.dirZ === travelDirZ);
    if (straight) {
      actor.currentEdge = straight.edge;
      actor.edgeT = straight.startFromNode1 ? 0 : 1;
      actor.edgeDir = straight.startFromNode1 ? 1 : -1;
      return;
    }

    // No straight path and no queued turn - stop at intersection
    actor.isMoving = false;
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
      // Update game timer
      if (STATE.gameTimerStarted && STATE.gameTimerRemaining > 0) {
        STATE.gameTimerRemaining -= dt;
        updateTimerDisplay();

        // Time's up!
        if (STATE.gameTimerRemaining <= 0) {
          STATE.gameTimerRemaining = 0;
          STATE.gameOver = true;
          showGameScore();
        }
      }

      updateGame(dt);
    }

    // Handle score display countdown and reset
    if (STATE.showingScore) {
      STATE.scoreDisplayTime -= dt;
      if (STATE.scoreDisplayTime <= 0) {
        resetGame();
      }
    }

    if (STATE.loaded) {
      for (let i = 0; i < fugitiveWires.length; i++) {
        const wire = fugitiveWires[i];
        // Skip wire updates for captured fugitives
        if (fugitives[i] && fugitives[i].captured) continue;
        wire.update(dt);
      }

      if (settings.faceSwapDuration > 0) {
        if (t - lastFaceSwapTime >= settings.faceSwapDuration) {
          lastFaceSwapTime = t;
          for (let i = 0; i < fugitiveWires.length; i++) {
            // Skip face swap for captured fugitives
            if (fugitives[i] && fugitives[i].captured) continue;
            fugitiveWires[i].swapTexture();
          }
        }
      }

      // Update helicopter and clouds
      updateHelicopter(dt);
      updateClouds(dt);

      // Update glass canvas for video/marquee/shuffle animation
      if (glassCanvas && (settings.glassTextMarquee || (settings.glassVideoEnabled && glassVideoReady) || isShuffleActive())) {
        updateGlassCanvas(timestamp);
      }
    }

    if (composer && (settings.bloomEnabled || settings.fxaaEnabled)) {
      if (renderPass) renderPass.camera = camera;
      composer.render();
    } else {
      renderer.render(scene, camera);
    }

    // Render axis helper in corner
    if (showAxisHelper) {
      const size = 120;
      const margin = 10;
      renderer.setViewport(window.innerWidth - size - margin, margin, size, size);
      renderer.setScissor(window.innerWidth - size - margin, margin, size, size);
      renderer.setScissorTest(true);
      renderer.setClearColor(0x222222, 0.8);
      renderer.clear();
      renderer.render(axisScene, axisCamera);
      renderer.setScissorTest(false);
      renderer.setViewport(0, 0, window.innerWidth, window.innerHeight);
    }
  }

  function updateGame(dt) {
    if (!STATE.loaded) return;

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
      if (f.currentEdge) {
        updateFugitiveMovementPath(f, dt);
      }
    }

    for (let i = 0; i < chasers.length; i++) {
      const chaser = chasers[i];

      const inputDir = getChaserInputDirection(i);
      if (!chaser.active && inputDir.hasInput) {
        console.log(`Chaser ${i} activated by input:`, inputDir);
        chaser.active = true;

        // Start game timer when first chaser activates
        if (!STATE.gameTimerStarted) {
          STATE.gameTimerStarted = true;
          STATE.gameTimerRemaining = 90;
        }

        // Initialize on path when first activated
        if (!chaser.currentEdge) {
          initActorOnPath(chaser);
        }

        // Set full opacity when activated
        if (chaser.isCarModel) {
          chaser.mesh.traverse((child) => {
            if (child.isMesh && child.material) {
              child.material.opacity = 1.0;
              child.material.transparent = false;
            }
          });
        } else if (chaser.material) {
          chaser.material.opacity = 1.0;
          chaser.material.transparent = false;
        }
        if (chaser.light) {
          chaser.light.intensity = settings.chaserLightIntensity;
        }
        // Set initial direction based on first input
        if (chaser.currentEdge) {
          const edge = chaser.currentEdge;
          const isHorizontal = Math.abs(edge.dirZ) < 0.1;
          const isVertical = Math.abs(edge.dirX) < 0.1;

          if (isVertical && inputDir.z !== 0) {
            // Vertical edge: match input Z direction
            // If input is up (z=-1) and edge goes down (dirZ=1), go backward (edgeDir=-1)
            chaser.edgeDir = (inputDir.z * edge.dirZ) > 0 ? 1 : -1;
          } else if (isHorizontal && inputDir.x !== 0) {
            // Horizontal edge: match input X direction
            chaser.edgeDir = (inputDir.x * edge.dirX) > 0 ? 1 : -1;
          }
        }
      }

      if (!chaser.active) continue;

      chaser.speed = settings.chaserSpeed + chaserSpeedBonus;

      // Handle input for path-based movement
      if (inputDir.hasInput && chaser.currentEdge) {
        // Start moving when input is given
        chaser.isMoving = true;

        // Get current travel direction
        const edge = chaser.currentEdge;
        let travelDirX = (edge.x2 - edge.x1) * chaser.edgeDir;
        let travelDirZ = (edge.z2 - edge.z1) * chaser.edgeDir;
        const travelLen = Math.sqrt(travelDirX * travelDirX + travelDirZ * travelDirZ);
        if (travelLen > 0.001) {
          travelDirX /= travelLen;
          travelDirZ /= travelLen;
        }

        // Check if input is roughly opposite to travel direction (180 turn)
        const dotWithTravel = inputDir.x * travelDirX + inputDir.z * travelDirZ;
        if (dotWithTravel < -0.3) {
          // Reverse direction immediately
          chaser.edgeDir *= -1;
          chaser.queuedDirX = 0;
          chaser.queuedDirZ = 0;
        } else {
          // Queue the turn for next intersection
          chaser.queuedDirX = inputDir.x;
          chaser.queuedDirZ = inputDir.z;
        }
      }

      // Path-based movement - keep moving once started
      if (chaser.currentEdge && chaser.isMoving) {
        updateChaserMovementPath(chaser, dt, i);
      }

      for (const f of fugitives) {
        if (f.captured) continue;
        if (checkCollision(chaser.mesh, f.mesh, STATE.actorRadius || 2.5)) {
          f.captured = true;
          // Hide and move far away to avoid draw call issues
          f.mesh.visible = false;
          f.mesh.position.y = -1000;
          if (f.light) {
            f.light.visible = false;
            f.light.intensity = 0;
          }
          const wire = fugitiveWires[f.index];
          if (wire) {
            if (wire.billboard) wire.billboard.visible = false;
            if (wire.line) wire.line.visible = false;
          }
          STATE.capturedCount = (STATE.capturedCount || 0) + 1;
        }
      }
    }

    if (STATE.capturedCount >= fugitives.length && !STATE.gameOver) {
      STATE.gameOver = true;
      showGameScore();
    }
  }

  // ============================================
  // LOAD LEVEL
  // ============================================

  const loader = new GLTFLoader();

  // Load level GLB - use ROADS mesh from within it for navmesh
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
      }
    });

    const levelContainer = new THREE.Group();
    levelContainer.add(root);
    scene.add(levelContainer);
    STATE.levelContainer = levelContainer;

    levelContainer.updateMatrixWorld(true);

    const fugitiveSpawns = [];
    const chaserSpawns = [];
    let baseActorSize = null;

    for (let i = 1; i <= 4; i++) {
      const marker = levelContainer.getObjectByName(`F${i}`);
      if (marker) {
        const worldPos = new THREE.Vector3();
        marker.getWorldPosition(worldPos);
        fugitiveSpawns.push(worldPos);

        // Get actor size from F1 marker (matches road width)
        if (i === 1 && !baseActorSize) {
          marker.traverse((child) => {
            if (child.isMesh && child.geometry) {
              child.geometry.computeBoundingBox();
              const geoBox = child.geometry.boundingBox;
              const geoSize = new THREE.Vector3();
              geoBox.getSize(geoSize);
              const childWorldScale = new THREE.Vector3();
              child.matrixWorld.decompose(new THREE.Vector3(), new THREE.Quaternion(), childWorldScale);
              const worldSize = geoSize.clone().multiply(childWorldScale);
              baseActorSize = Math.min(worldSize.x, worldSize.z);
            }
          });
        }

        marker.parent.remove(marker);
      }
    }

    for (let i = 1; i <= 4; i++) {
      const marker = levelContainer.getObjectByName(`C${i}`);
      if (marker) {
        const worldPos = new THREE.Vector3();
        marker.getWorldPosition(worldPos);
        chaserSpawns.push(worldPos);
        marker.visible = false;
      }
    }

    // Find ROADS mesh within level GLB (same scale as markers)
    let roadsMeshes = [];
    levelContainer.traverse((obj) => {
      if (obj.isMesh && obj.name && obj.name.toUpperCase().includes("ROAD")) {
        roadsMeshes.push(obj);
      }
    });

    // Find all GLASS meshes for HTML overlay
    let foundGlassMeshes = [];
    levelContainer.traverse((obj) => {
      if (obj.isMesh && obj.name && obj.name.toUpperCase().includes("GLASS")) {
        foundGlassMeshes.push(obj);
      }
    });

    if (foundGlassMeshes.length > 0) {
      setupGlassMeshes(foundGlassMeshes);
    }

    // Find Nav nodes for path grid (objects with names starting with "Nav")
    let navNodes = [];
    levelContainer.traverse((obj) => {
      if (obj.name && obj.name.toLowerCase().startsWith("nav")) {
        const worldPos = new THREE.Vector3();
        obj.getWorldPosition(worldPos);
        navNodes.push({ name: obj.name, x: worldPos.x, z: worldPos.z });
        obj.visible = false;
      }
    });
    if (navNodes.length > 0) {
      console.log(`Found ${navNodes.length} Nav nodes for path grid`);
    } else {
      console.log("No Nav nodes found - add objects with names starting with 'Nav' in Blender");
    }

    if (roadsMeshes.length === 0) {
      statusEl.textContent = "No ROADS mesh found in level GLB!";
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

    // ==================== PATH GRAPH GENERATION ====================
    // Generate a graph of nodes (intersections) and edges (path segments)
    // for Pac-Man style movement


    // Find nearest point on the path graph
    function findNearestEdgePoint(x, z, pathGraph) {
      let nearestEdge = null;
      let nearestDist = Infinity;
      let nearestPoint = { x, z };
      let nearestT = 0;

      for (const edge of pathGraph.edges) {
        // Project point onto edge line segment
        const dx = edge.x2 - edge.x1;
        const dz = edge.z2 - edge.z1;
        const len2 = dx * dx + dz * dz;

        if (len2 < 0.0001) continue;

        let t = ((x - edge.x1) * dx + (z - edge.z1) * dz) / len2;
        t = Math.max(0, Math.min(1, t));

        const projX = edge.x1 + t * dx;
        const projZ = edge.z1 + t * dz;

        const dist = Math.sqrt((x - projX) ** 2 + (z - projZ) ** 2);

        if (dist < nearestDist) {
          nearestDist = dist;
          nearestEdge = edge;
          nearestPoint = { x: projX, z: projZ };
          nearestT = t;
        }
      }

      return { edge: nearestEdge, point: nearestPoint, t: nearestT, distance: nearestDist };
    }

    // Get available directions at a node
    function getNodeDirections(node, pathGraph) {
      const directions = [];
      for (const edgeId of node.edges) {
        const edge = pathGraph.edges[edgeId];
        let dirX, dirZ;
        if (edge.node1 === node.id) {
          dirX = Math.sign(edge.x2 - edge.x1) || edge.dirX;
          dirZ = Math.sign(edge.z2 - edge.z1) || edge.dirZ;
        } else {
          dirX = Math.sign(edge.x1 - edge.x2) || -edge.dirX;
          dirZ = Math.sign(edge.z1 - edge.z2) || -edge.dirZ;
        }
        directions.push({ edgeId, dirX, dirZ });
      }
      return directions;
    }

    // Use F1 marker size (matches road width) for Pac-Man style movement
    let actorSize = baseActorSize || 1;
    if (!baseActorSize) {
      const baseUnit = horizontalSize || 100;
      actorSize = baseUnit / 150;
    }
    actorSize *= settings.actorScale;

    // Path graph will be loaded/generated after setup
    let pathGraph = { nodes: [], edges: [], gridStep: actorSize };

    // Build path graph from spawn points - creates a simple Pac-Man grid
    function buildPathGraphFromSpawns() {
      const nodes = [];
      const edges = [];
      const nodeMap = new Map();

      // Get all spawn positions to determine the grid bounds
      const allSpawns = [...fugitiveSpawns, ...chaserSpawns];
      if (allSpawns.length === 0) return null;

      // Find grid bounds from spawns
      let minX = Infinity, maxX = -Infinity;
      let minZ = Infinity, maxZ = -Infinity;
      for (const sp of allSpawns) {
        minX = Math.min(minX, sp.x);
        maxX = Math.max(maxX, sp.x);
        minZ = Math.min(minZ, sp.z);
        maxZ = Math.max(maxZ, sp.z);
      }

      // Use spawn positions to create nodes
      const gridStep = actorSize * 1.2; // Spacing between grid lines

      function getOrCreateNode(x, z) {
        // Snap to grid
        const sx = Math.round(x / gridStep) * gridStep;
        const sz = Math.round(z / gridStep) * gridStep;
        const key = `${sx.toFixed(2)},${sz.toFixed(2)}`;

        if (nodeMap.has(key)) return nodeMap.get(key);

        const idx = nodes.length;
        nodes.push({ id: idx, x: sx, z: sz, edges: [] });
        nodeMap.set(key, idx);
        return idx;
      }

      function addEdge(n1Idx, n2Idx) {
        if (n1Idx === n2Idx) return;

        // Check if edge exists
        for (const eid of nodes[n1Idx].edges) {
          const e = edges[eid];
          if ((e.node1 === n1Idx && e.node2 === n2Idx) ||
              (e.node1 === n2Idx && e.node2 === n1Idx)) return;
        }

        const n1 = nodes[n1Idx];
        const n2 = nodes[n2Idx];
        const dx = n2.x - n1.x;
        const dz = n2.z - n1.z;
        const length = Math.sqrt(dx * dx + dz * dz);

        const edge = {
          id: edges.length,
          node1: n1Idx,
          node2: n2Idx,
          x1: n1.x, z1: n1.z,
          x2: n2.x, z2: n2.z,
          length,
          dirX: Math.sign(dx),
          dirZ: Math.sign(dz)
        };
        edges.push(edge);
        n1.edges.push(edge.id);
        n2.edges.push(edge.id);
      }

      // Create nodes at each spawn point
      for (const sp of allSpawns) {
        getOrCreateNode(sp.x, sp.z);
      }

      // Connect nodes that are aligned horizontally or vertically
      for (let i = 0; i < nodes.length; i++) {
        for (let j = i + 1; j < nodes.length; j++) {
          const n1 = nodes[i];
          const n2 = nodes[j];
          const dx = Math.abs(n2.x - n1.x);
          const dz = Math.abs(n2.z - n1.z);

          // Only connect if aligned (H or V) and reasonably close
          const isHorizontal = dz < gridStep * 0.5;
          const isVertical = dx < gridStep * 0.5;

          if ((isHorizontal || isVertical) && (dx + dz) < gridStep * 8) {
            addEdge(i, j);
          }
        }
      }

      console.log(`Spawn-based path: ${nodes.length} nodes, ${edges.length} edges`);
      return { nodes, edges, gridStep, source: 'spawns' };
    }

    // Build grid from Nav nodes placed in Blender
    function buildGridFromNavNodes() {
      if (!navNodes || navNodes.length < 2) {
        return null;
      }

      const nodes = navNodes.map((n, idx) => ({
        id: idx,
        x: n.x,
        z: n.z,
        edges: []
      }));

      const edges = [];
      const maxEdgeDist = actorSize * 15; // Max distance for an edge
      const checkStep = actorSize * 0.5; // Step size for obstacle checking

      // Check if path between two points is clear (no obstacles)
      function isPathClear(x1, z1, x2, z2) {
        const dx = x2 - x1;
        const dz = z2 - z1;
        const dist = Math.sqrt(dx * dx + dz * dz);
        const steps = Math.ceil(dist / checkStep);

        for (let s = 1; s < steps; s++) {
          const t = s / steps;
          const testX = x1 + dx * t;
          const testZ = z1 + dz * t;
          if (!isOnRoad(testX, testZ)) {
            return false;
          }
        }
        return true;
      }

      function addEdge(n1, n2) {
        if (n1 === n2) return;
        // Check duplicate
        for (const eid of nodes[n1].edges) {
          const e = edges[eid];
          if ((e.node1 === n1 && e.node2 === n2) || (e.node1 === n2 && e.node2 === n1)) return;
        }

        const node1 = nodes[n1];
        const node2 = nodes[n2];
        const dx = node2.x - node1.x;
        const dz = node2.z - node1.z;

        // Only cardinal directions (H or V, not diagonal)
        const isHorizontal = Math.abs(dz) < actorSize * 0.5;
        const isVertical = Math.abs(dx) < actorSize * 0.5;
        if (!isHorizontal && !isVertical) return;

        const length = Math.sqrt(dx * dx + dz * dz);
        const eid = edges.length;
        edges.push({
          id: eid,
          node1: n1,
          node2: n2,
          x1: node1.x,
          z1: node1.z,
          x2: node2.x,
          z2: node2.z,
          length: length,
          dirX: isHorizontal ? Math.sign(dx) : 0,
          dirZ: isVertical ? Math.sign(dz) : 0
        });
        nodes[n1].edges.push(eid);
        nodes[n2].edges.push(eid);
      }

      // Connect each node to its nearest aligned neighbors
      for (let i = 0; i < nodes.length; i++) {
        const node = nodes[i];

        let nearestRight = null, nearestRightDist = Infinity;
        let nearestLeft = null, nearestLeftDist = Infinity;
        let nearestDown = null, nearestDownDist = Infinity;
        let nearestUp = null, nearestUpDist = Infinity;

        for (let j = 0; j < nodes.length; j++) {
          if (i === j) continue;
          const other = nodes[j];
          const dx = other.x - node.x;
          const dz = other.z - node.z;

          // Horizontal alignment
          if (Math.abs(dz) < actorSize * 0.5 && Math.abs(dx) < maxEdgeDist) {
            // Check if path is clear before considering this neighbor
            if (isPathClear(node.x, node.z, other.x, other.z)) {
              if (dx > 0 && dx < nearestRightDist) {
                nearestRight = j;
                nearestRightDist = dx;
              } else if (dx < 0 && -dx < nearestLeftDist) {
                nearestLeft = j;
                nearestLeftDist = -dx;
              }
            }
          }

          // Vertical alignment
          if (Math.abs(dx) < actorSize * 0.5 && Math.abs(dz) < maxEdgeDist) {
            // Check if path is clear before considering this neighbor
            if (isPathClear(node.x, node.z, other.x, other.z)) {
              if (dz > 0 && dz < nearestDownDist) {
                nearestDown = j;
                nearestDownDist = dz;
              } else if (dz < 0 && -dz < nearestUpDist) {
                nearestUp = j;
                nearestUpDist = -dz;
              }
            }
          }
        }

        if (nearestRight !== null) addEdge(i, nearestRight);
        if (nearestLeft !== null) addEdge(i, nearestLeft);
        if (nearestDown !== null) addEdge(i, nearestDown);
        if (nearestUp !== null) addEdge(i, nearestUp);
      }

      console.log(`Nav grid: ${nodes.length} nodes, ${edges.length} edges`);
      return { nodes, edges, gridStep: actorSize, source: 'nav' };
    }

    // Function to load path graph
    function loadPathGraph() {
      // Use Nav nodes from Blender
      const navGraph = buildGridFromNavNodes();
      if (navGraph && navGraph.edges.length >= 1) {
        return navGraph;
      }

      console.warn("No Nav nodes found in model - add Nav parent with child objects in Blender");
      return { nodes: [], edges: [], gridStep: actorSize, source: 'empty' };
    }

    // Function to rebuild path graph and update visualization
    function rebuildPathGraph() {
      pathGraph = loadPathGraph();
      STATE.pathGraph = pathGraph;

      // Update debug visualization
      const oldDebug = scene.getObjectByName("PathGraphDebug");
      if (oldDebug) {
        oldDebug.parent.remove(oldDebug);
      }

      const pathGraphDebug = new THREE.Group();
      pathGraphDebug.name = "PathGraphDebug";

      // Different colors for different sources
      // GLB: green, SVG: cyan, Generated: yellow
      const source = pathGraph.source || 'generated';
      let edgeColor, nodeColor;
      if (source === 'glb') {
        edgeColor = 0x00ff00; // Green for GLB
        nodeColor = 0x00ff88;
      } else if (source === 'svg') {
        edgeColor = 0x00ffff; // Cyan for SVG
        nodeColor = 0xff00ff;
      } else {
        edgeColor = 0xffff00; // Yellow for generated
        nodeColor = 0xff0000;
      }

      // Create tube geometry for edges (more visible than lines)
      const edgeMat = new THREE.MeshBasicMaterial({ color: edgeColor });
      const tubeRadius = actorSize * 0.08;

      for (const edge of pathGraph.edges) {
        const start = new THREE.Vector3(edge.x1, STATE.streetY + 0.3, edge.z1);
        const end = new THREE.Vector3(edge.x2, STATE.streetY + 0.3, edge.z2);
        const dir = new THREE.Vector3().subVectors(end, start);
        const length = dir.length();

        if (length > 0.01) {
          const tubeGeo = new THREE.CylinderGeometry(tubeRadius, tubeRadius, length, 6);
          const tube = new THREE.Mesh(tubeGeo, edgeMat);

          // Position at midpoint
          tube.position.copy(start).add(end).multiplyScalar(0.5);

          // Rotate to align with edge direction
          tube.quaternion.setFromUnitVectors(
            new THREE.Vector3(0, 1, 0),
            dir.normalize()
          );

          pathGraphDebug.add(tube);
        }
      }

      // Bigger spheres for nodes
      const nodeMat = new THREE.MeshBasicMaterial({ color: nodeColor });
      const nodeGeo = new THREE.SphereGeometry(actorSize * 0.3, 12, 12);
      for (const node of pathGraph.nodes) {
        const sphere = new THREE.Mesh(nodeGeo, nodeMat);
        sphere.position.set(node.x, STATE.streetY + 0.3, node.z);
        pathGraphDebug.add(sphere);
      }

      console.log(`Path visualization: ${source.toUpperCase()} - ${pathGraph.edges.length} edges, ${pathGraph.nodes.length} nodes`);

      scene.add(pathGraphDebug);
      pathGraphDebug.visible = settings.showNavmesh;

      // Re-initialize actors on new path graph
      for (const f of fugitives) {
        initActorOnPath(f);
      }
      // Only re-initialize active chasers
      for (const c of chasers) {
        if (c.active) {
          initActorOnPath(c);
        }
      }

      console.log(`Path graph updated: ${pathGraph.nodes.length} nodes, ${pathGraph.edges.length} edges`);
    }

    // Store rebuild function in STATE for GUI access
    STATE.rebuildPathGraph = rebuildPathGraph;

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

    function projectYOnRoad(pos) {
      pos.y = streetY + actorSize * 0.5;
    }

    setupCameras(levelCenter, horizontalSize);
    onResize();

    STATE.streetY = streetY;

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
    const fugitiveColor = settings.fugitiveColor;

    for (let i = 0; i < fugitiveSpawns.length; i++) {
      const material = new THREE.MeshStandardMaterial({
        color: fugitiveColor,
        emissive: fugitiveColor,
        emissiveIntensity: 0.3
      });
      const mesh = new THREE.Mesh(fugitiveGeo, material);
      mesh.castShadow = true;
      mesh.receiveShadow = true;

      const light = new THREE.PointLight(fugitiveColor, settings.fugitiveLightIntensity, 100);
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

      const wire = new ActorWire(fugitives[fugitives.length - 1], actorSize, fugitiveColor, false, i);
      fugitiveWires.push(wire);
    }

    const chaserColors = [settings.chaser1Color, settings.chaser2Color, settings.chaser3Color, settings.chaser4Color];

    // Load car models for chasers
    const carPaths = PATHS.models.cars || [];
    console.log("Car paths to load:", carPaths);
    const carPromises = carPaths.map(path =>
      new Promise((resolve) => {
        loader.load(path,
          (gltf) => {
            console.log("Loaded car:", path);
            resolve(gltf.scene);
          },
          undefined,
          (err) => {
            console.error("Failed to load car:", path, err);
            resolve(null);
          }
        );
      })
    );

    Promise.all(carPromises).then((carModels) => {
      console.log("Car models loaded:", carModels.filter(m => m !== null).length, "of", carModels.length);

      for (let i = 0; i < chaserSpawns.length; i++) {
        const color = chaserColors[i] || chaserColors[0];

        let mesh;
        // Use the first car model for all chasers
        const carModel = carModels.length > 0 ? carModels[0] : null;

        if (carModel) {
          mesh = carModel.clone();
          // Scale car to fit actor size
          const box = new THREE.Box3().setFromObject(mesh);
          const size = new THREE.Vector3();
          box.getSize(size);
          const maxDim = Math.max(size.x, size.y, size.z);
          const scale = (actorSize * 2) / maxDim; // Make car 2x actor size for visibility
          mesh.scale.setScalar(scale);
          console.log(`Chaser ${i}: using car model, scale=${scale.toFixed(3)}, size=${maxDim.toFixed(2)}`);

          // Apply color to all meshes in the car
          mesh.traverse((child) => {
            child.visible = true;
            if (child.isMesh) {
              child.castShadow = false; // Don't cast shadows so lights pass through other chasers
              child.receiveShadow = true;
              // Store original material for reference
              child.userData.originalMaterial = child.material;
              child.material = new THREE.MeshStandardMaterial({
                color: color,
                emissive: color,
                emissiveIntensity: 0.3,
                transparent: true,
                opacity: 0.5,
              });
            }
          });
          mesh.visible = true;
        } else {
          // Fallback to box if car model failed to load
          const chaserGeo = new THREE.BoxGeometry(actorSize, actorSize, actorSize);
          const material = new THREE.MeshStandardMaterial({
            color: color,
            emissive: color,
            emissiveIntensity: 0.3,
            transparent: true,
            opacity: 0.1,
          });
          mesh = new THREE.Mesh(chaserGeo, material);
          mesh.castShadow = true;
          mesh.receiveShadow = true;
        }

        // Create spotlight as headlight at the front of the car
        const angleRad = (settings.chaserLightAngle * Math.PI) / 180;
        const light = new THREE.SpotLight(color, 0, settings.chaserLightDistance, angleRad, settings.chaserLightPenumbra, 1);
        const meshScale = mesh.scale.y || 1;
        // Position at front of car (local Z-) and at set height (negative due to car flip)
        light.position.set(0, settings.chaserLightHeight / meshScale, -settings.chaserLightOffset / meshScale);
        light.castShadow = true;
        light.shadow.mapSize.width = 512;
        light.shadow.mapSize.height = 512;
        light.shadow.camera.near = 0.1;
        light.shadow.camera.far = 50;
        light.shadow.bias = -0.001;

        // Create target for spotlight - point forward from the car (negative Z due to car flip)
        const lightTarget = new THREE.Object3D();
        lightTarget.position.set(0, 0, -5 / meshScale); // Point far ahead in local -Z
        mesh.add(lightTarget);
        light.target = lightTarget;
        mesh.add(light);

        const spawnPos = chaserSpawns[i];
        const roadPoint = findNearestRoadPoint(spawnPos.x, spawnPos.z);

        mesh.position.set(roadPoint.x, 0, roadPoint.z);
        projectYOnRoad(mesh.position);
        mesh.position.y += settings.chaserHeightOffset;
        mesh.visible = true;

        const chaserObj = {
          mesh,
          light,
          lightTarget,
          material: null, // Materials are on child meshes now
          speed: settings.chaserSpeed,
          dirX: 0,
          dirZ: 0,
          queuedDirX: 0,
          queuedDirZ: 0,
          active: false,
          isMoving: false,
          isCarModel: !!carModel,
        };
        scene.add(mesh);
        chasers.push(chaserObj);
      }

      // Don't initialize chasers on path yet - wait until they're activated
    });

    STATE.findNearestRoadPoint = findNearestRoadPoint;
    STATE.projectYOnRoad = projectYOnRoad;
    STATE.pathGraph = pathGraph;
    STATE.findNearestEdgePoint = findNearestEdgePoint;
    STATE.getNodeDirections = getNodeDirections;
    STATE.actorSize = actorSize;
    STATE.actorRadius = actorSize * 0.5;
    STATE.roadsMeshes = roadsMeshes;
    STATE.loaded = true;

    setupGUI();
    initPostProcessing();
    initAudio();
    loadHelicopter();
    loadClouds();

    // Load path graph from GLB and initialize actors
    rebuildPathGraph();
    console.log("Path graph ready");
    initVideoPlanes();
    setupGLBPartsGUI();

    // Apply initial settings after GUI is set up

    statusEl.textContent = "Ready! Click 'Start Game' in the GUI.";
  }).catch((err) => {
    console.error("Error loading GLB files", err);
    statusEl.textContent = "Failed to load GLB files (see console).";
  });

  animate(0);
})();
