// Jagad - Chase Game
// Main entry point

const DEBUG = false; // Set to true for console logging

import * as THREE from "./lib/three/three.module.js";
import { GLTFLoader } from "./lib/three/addons/loaders/GLTFLoader.js";
import { EffectComposer } from "./lib/three/addons/postprocessing/EffectComposer.js";
import { RenderPass } from "./lib/three/addons/postprocessing/RenderPass.js";
import { UnrealBloomPass } from "./lib/three/addons/postprocessing/UnrealBloomPass.js";
import { OutputPass } from "./lib/three/addons/postprocessing/OutputPass.js";
import { ShaderPass } from "./lib/three/addons/postprocessing/ShaderPass.js";
import { RenderPixelatedPass } from "./lib/three/addons/postprocessing/RenderPixelatedPass.js";
import { SelectivePixelPass } from "./lib/three/addons/postprocessing/SelectivePixelPass.js";

import { KTX2Loader } from "./lib/three/addons/loaders/KTX2Loader.js";
import { defaultSettings, loadSettings, saveSettings, exportSettings, importSettings } from "./game/settings.js?v=17";
import { PATHS, FACE_TEXTURES, CHASER_CONTROLS } from "./game/constants.js?v=8";
import { createBoostState, triggerBoost, updateBoosts, getBoostMultiplier, resetBoosts, addBoostGUI } from "./gui/index.js?v=1";
import { isMobileDevice, saveDesktopSettings, applyMobileOverrides, restoreDesktopSettings, initTouchInput } from "./game/mobile.js?v=4";

// lil-gui loaded via script tag in index.html
const GUI = window.lil.GUI;

// Layer constants for selective pixelation
const LAYERS = {
  DEFAULT: 0,      // Effects, particles, billboards, UI
  GLB_MODELS: 1    // Pixelated: helicopter, level, cars
};

// Loading progress tracker
const loadingProgress = {
  total: 0,
  loaded: 0,
  register(count = 1) {
    this.total += count;
    this.update();
  },
  complete(count = 1) {
    this.loaded += count;
    this.update();
  },
  update() {
    if (this.total === 0) return;
    const percent = Math.round((this.loaded / this.total) * 100);
    if (percent < 100) {
      document.title = `Jagad ${percent}%`;
    } else {
      document.title = "Jagad";
    }
  },
  finish() {
    document.title = "Jagad";
  }
};

(async () => {
  // Suppress Three.js texture unit warnings
  const originalWarn = console.warn;
  console.warn = function(...args) {
    const msg = args[0];
    if (typeof msg === "string" && msg.includes("texture units")) {
      return;
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
  scene.background = new THREE.Color(0x191928);

  // ============================================
  // SERVER CONNECTION (fire-and-forget, game works offline)
  // ============================================

  const isFacadeMode = new URLSearchParams(window.location.search).has("facade");

  let serverWS = null;

  function getServerAddress() {
    const params = new URLSearchParams(window.location.search);
    const s = params.get("server");
    const LOCAL = "http://localhost:3000";
    const REMOTE = "https://pacman-server-239p.onrender.com";
    if (s) {
      if (s.startsWith("http://") || s.startsWith("https://")) return s;
      if (s === "local" || s === "localhost") return LOCAL;
      if (s === "remote" || s === "render") return REMOTE;
    }
    if (window.location.origin === "http://localhost" || window.location.origin.startsWith("http://localhost:")) return LOCAL;
    return REMOTE;
  }

  function connectToServer() {
    try {
      const url = getServerAddress().replace(/^http/, "ws");
      console.log("Game WS connecting to", url);
      serverWS = new WebSocket(url);
      serverWS.addEventListener("open", () => {
        console.log("Game WS connected");
      });
      serverWS.addEventListener("close", () => {
        console.log("Game WS disconnected, retrying in 5s");
        serverWS = null;
        setTimeout(connectToServer, 5000);
      });
      serverWS.addEventListener("error", () => serverWS.close());
    } catch { serverWS = null; }
  }

  function sendServerEvent(event) {
    if (serverWS && serverWS.readyState === WebSocket.OPEN) {
      serverWS.send(JSON.stringify(event));
    }
  }

  function postHighScore(data) {
    return fetch(`${getServerAddress()}/api/highscore`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data),
    }).catch(() => {});
  }

  connectToServer();

  // WebGL Renderer
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
  renderer.setPixelRatio(window.devicePixelRatio * (defaultSettings.renderScale || 1));
  renderer.setClearColor(0x191928, 0);
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.toneMapping = THREE.NeutralToneMapping;
  renderer.toneMappingExposure = 1;

  // KTX2 texture loader (GPU-compressed textures in GLB)
  const ktx2Loader = new KTX2Loader();
  ktx2Loader.setTranscoderPath("assets/js/lib/three/addons/libs/basis/");
  ktx2Loader.detectSupport(renderer);

  // Post-processing (WebGL EffectComposer)
  let composer = null;

  // ============================================
  // STATE
  // ============================================

  let buildingPlane = null;
  let projectionPlane = null;
  let projectionTextures = {};
  let projectionVideo = null;
  let projectionVideoTexture = null;
  let gameAnimationVideo = null;
  let gameAnimationVideoTexture = null;
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
  let helicopterBoundsHelper = null;
  let searchlights = null;
  let searchlightHelpers = [];
  let helicopterLightHelper = null;
  let chaserLightHelpers = [];

  // Reusable temp objects to avoid per-frame allocations
  const _tempVec3A = new THREE.Vector3();
  const _tempVec3B = new THREE.Vector3();
  const _tempQuat = new THREE.Quaternion();
  const _defaultDownDir = new THREE.Vector3(0, -1, 0);

  const settings = {
    gameStarted: false,
    ...defaultSettings,
    startGame: function() {
      if (!STATE.loaded) return;
      settings.gameStarted = true;
      STATE.gameOver = false;
      statusEl.textContent = "Game started! Escape the chasers!";
    },
    exportSettings: function() {
      exportSettings(settings);
      statusEl.textContent = "Settings exported!";
    },
    importSettings: function() {
      importSettings((imported) => {
        // Apply each setting and trigger onChange handlers
        if (guiLeft) {
          guiLeft.controllersRecursive().forEach(c => {
            const prop = c.property;
            if (prop && imported[prop] !== undefined) {
              c.setValue(imported[prop]);
            }
          });
        }
        // Also directly assign any settings not in GUI
        Object.assign(settings, imported);
        statusEl.textContent = "Settings imported!";
      });
    },
  };

  const boostStates = createBoostState(4, settings);

  let guiLeft = null;

  // ============================================
  // FPS / PERFORMANCE STATS
  // ============================================

  const statsPanel = (() => {
    const el = document.createElement("div");
    el.id = "stats-panel";
    Object.assign(el.style, {
      position: "fixed",
      top: "10px",
      right: "10px",
      zIndex: "9999",
      background: "rgba(0,0,0,0.7)",
      color: "#0f0",
      fontFamily: "monospace",
      fontSize: "12px",
      padding: "8px 10px",
      borderRadius: "4px",
      lineHeight: "1.5",
      pointerEvents: "none",
      minWidth: "140px",
      display: "none",
    });
    document.body.appendChild(el);

    let frames = 0;
    let lastSec = performance.now();
    let fps = 0;
    let frameTime = 0;
    let minFps = Infinity;
    let maxFps = 0;

    return {
      el,
      begin() {
        this._start = performance.now();
      },
      end() {
        const now = performance.now();
        frameTime = now - this._start;
        frames++;
        if (now - lastSec >= 1000) {
          fps = frames;
          if (fps < minFps) minFps = fps;
          if (fps > maxFps) maxFps = fps;
          frames = 0;
          lastSec = now;
          const mem = performance.memory ? `${(performance.memory.usedJSHeapSize / 1048576).toFixed(1)} MB` : "N/A";
          const calls = renderer.info.render.calls;
          const tris = renderer.info.render.triangles;
          el.innerHTML =
            `<b>${fps}</b> FPS (${frameTime.toFixed(1)} ms)` +
            `<br>min ${minFps} / max ${maxFps}` +
            `<br>draw calls: ${calls}` +
            `<br>triangles: ${(tris / 1000).toFixed(1)}k` +
            `<br>mem: ${mem}`;
        }
      },
    };
  })();

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
    activeChaserCount: 0, // Cached count to avoid filter() every frame
    // Game states system
    gameState: "PRE_GAME", // PRE_GAME, STARTING, PLAYING, GAME_OVER
    countdownValue: 3,     // 3, 2, 1, 0 (GO)
    countdownTimer: 0,     // Time accumulator for countdown
    playerScore: 0,        // Current game score
    fugitiveValue: 250,    // Points per fugitive (decreases over time)
    // High score entry
    enteringHighScore: false,
    highScoreInitials: ["A", "A", "A"],
    highScorePosition: 0,  // Which initial being edited (0-2)
    highScoreCharIndex: 0, // Current character A-Z, 0-9
    newHighScoreRank: -1,  // Position in high scores list (0, 1, or 2)
    firstPlayerIndex: -1,  // Index of the first player who joined
    highScoreInitialsColor: null, // Color for high score initials (first player's color)
  };

  // Helper to get level center (avoids creating new Vector3)
  const getLevelCenter = () => STATE.levelCenter;

  // ============================================
  // AUDIO WITH ANALYZER
  // ============================================

  let audioElement = null;
  let audioContext = null;
  let audioAnalyser = null;
  let audioSource = null;
  let audioFrequencyData = null;

  function initAudio() {
    const trackPath = PATHS.audio[settings.audioTrack];
    if (trackPath) {
      audioElement = new Audio(trackPath);
      audioElement.loop = true;
      audioElement.volume = settings.audioVolume;
      audioElement.crossOrigin = "anonymous";
    }
  }

  function setupAudioAnalyser() {
    if (audioAnalyser || !audioContext || !audioElement) return;
    if (audioContext.state !== "running") return;
    try {
      audioAnalyser = audioContext.createAnalyser();
      audioAnalyser.fftSize = 256;
      audioAnalyser.smoothingTimeConstant = 0.8;
      audioSource = audioContext.createMediaElementSource(audioElement);
      audioSource.connect(audioAnalyser);
      audioAnalyser.connect(audioContext.destination);
      audioFrequencyData = new Uint8Array(audioAnalyser.frequencyBinCount);
    } catch (e) {
      console.warn("Failed to setup audio analyser:", e);
    }
  }

  function getAudioFrequency(bandIndex, numBands) {
    if (!audioAnalyser || !audioFrequencyData) return 0;
    audioAnalyser.getByteFrequencyData(audioFrequencyData);
    const binCount = audioFrequencyData.length;
    const bandSize = Math.floor(binCount / numBands);
    const start = bandIndex * bandSize;
    const end = Math.min(start + bandSize, binCount);
    let sum = 0;
    for (let i = start; i < end; i++) {
      sum += audioFrequencyData[i];
    }
    return sum / (end - start) / 255; // Normalize to 0-1
  }

  function playAudio() {
    if (!audioElement) return;
    if (audioContext && audioContext.state === "suspended") {
      audioContext.resume().then(() => audioElement.play().catch(() => {}));
    } else {
      audioElement.play().catch(() => {});
    }
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
  // SOUND EFFECTS
  // ============================================

  let helicopterAudio = null;
  const preloadedSFX = {};

  function initSFX() {
    // Preload all SFX for immediate playback
    if (PATHS.sfx) {
      for (const [name, path] of Object.entries(PATHS.sfx)) {
        if (name === "helicopter") {
          // Helicopter is looping, handle separately
          helicopterAudio = new Audio(path);
          helicopterAudio.loop = true;
          helicopterAudio.volume = 0.3;
        } else {
          // Preload other SFX
          const audio = new Audio(path);
          audio.volume = 0.5;
          audio.preload = "auto";
          preloadedSFX[name] = audio;
        }
      }
    }
  }

  // Tone.js modulated SFX: per-player pitch variation
  const MODULATED_SFX = ["playerSelect", "honk", "capture", "nitro"]; // SFX that get pitch modulation
  const PLAYER_PITCH_OFFSETS = [-5, 0, 4, 7]; // lower 4th, root, major 3rd, 5th (semitones)
  const tonePlayers = {}; // "sfxName_playerIndex" -> pre-created Tone.Player

  function initToneSFX() {
    if (typeof Tone === "undefined") return;
    // Pre-create a player for each SFX + player combination
    for (const name of MODULATED_SFX) {
      const path = PATHS.sfx[name];
      if (!path) continue;
      for (let i = 0; i < 4; i++) {
        const semitones = PLAYER_PITCH_OFFSETS[i % PLAYER_PITCH_OFFSETS.length] || 0;
        const rate = Math.pow(2, semitones / 12);
        const player = new Tone.Player(path).toDestination();
        player.playbackRate = rate;
        player.volume.value = -6;
        tonePlayers[`${name}_${i}`] = player;
      }
    }
  }

  function playSFX(sfxName, playerIndex) {
    // Try Tone.js player first (pitch-modulated), only if context is running
    if (playerIndex != null && typeof Tone !== "undefined" && Tone.context.state === "running") {
      const player = tonePlayers[`${sfxName}_${playerIndex}`];
      if (player && player.loaded) {
        try {
          player.stop();
          player.start();
          return;
        } catch (e) {
          // Fall through to standard playback
        }
      }
    }
    // Standard HTML Audio playback (works in user gesture even before Tone is ready)
    if (!preloadedSFX[sfxName]) return;
    const sfx = preloadedSFX[sfxName];
    sfx.currentTime = 0;
    sfx.play().catch(() => {});
  }

  function playHelicopterSound() {
    if (helicopterAudio && helicopterAudio.paused) {
      helicopterAudio.play().catch(() => {});
    }
  }

  function stopHelicopterSound() {
    if (helicopterAudio) {
      helicopterAudio.pause();
      helicopterAudio.currentTime = 0;
    }
  }

  // Unlock audio on first user interaction (required by mobile browsers)
  let audioUnlocked = false;
  function unlockAudio() {
    if (audioUnlocked) return;
    audioUnlocked = true;
    // Create AudioContext during user gesture, then wire up analyser once running
    if (!audioContext && audioElement) {
      try {
        audioContext = new (window.AudioContext || window.webkitAudioContext)();
      } catch (e) {
        console.warn("Failed to create AudioContext:", e);
      }
    }
    if (audioContext && audioContext.state === "suspended") {
      audioContext.resume().then(() => setupAudioAnalyser());
    } else {
      setupAudioAnalyser();
    }
    // Load Tone.js dynamically on first gesture (avoids AudioContext warning at page load)
    if (typeof Tone === "undefined") {
      const script = document.createElement("script");
      script.src = "./assets/js/lib/Tone.js";
      script.onload = () => {
        Tone.start().then(() => initToneSFX()).catch(() => {});
      };
      document.head.appendChild(script);
    } else {
      Tone.start().then(() => initToneSFX()).catch(() => {});
    }
  }
  document.addEventListener("touchstart", unlockAudio, { once: true });
  document.addEventListener("click", unlockAudio, { once: true });
  document.addEventListener("keydown", unlockAudio, { once: true });

  // ============================================
  // VOLUMETRIC FOG (3D Noise Texture)
  // ============================================

  function createNoiseTexture3D() {
    const size = 64;
    const data = new Uint8Array(size * size * size);

    // Simple 3D noise approximation
    let i = 0;
    for (let z = 0; z < size; z++) {
      for (let y = 0; y < size; y++) {
        for (let x = 0; x < size; x++) {
          // Layered sine waves for pseudo-noise
          const nx = x / size * 5;
          const ny = y / size * 5;
          const nz = z / size * 5;

          let noise = Math.sin(nx * 4) * Math.cos(ny * 4) * Math.sin(nz * 4);
          noise += Math.sin(nx * 8 + 1) * Math.cos(ny * 8 + 2) * Math.sin(nz * 8 + 3) * 0.5;
          noise += Math.sin(nx * 16 + 4) * Math.cos(ny * 16 + 5) * Math.sin(nz * 16 + 6) * 0.25;

          data[i] = Math.floor((noise + 1) * 0.5 * 255);
          i++;
        }
      }
    }

    const texture = new THREE.Data3DTexture(data, size, size, size);
    texture.format = THREE.RedFormat;
    texture.minFilter = THREE.LinearFilter;
    texture.magFilter = THREE.LinearFilter;
    texture.wrapS = THREE.RepeatWrapping;
    texture.wrapT = THREE.RepeatWrapping;
    texture.wrapR = THREE.RepeatWrapping;
    texture.needsUpdate = true;

    return texture;
  }

  // ============================================
  // HELICOPTER
  // ============================================

  function loadHelicopter() {
    if (!PATHS.models.helicopter) return;

    const loader = new GLTFLoader();
    loader.setKTX2Loader(ktx2Loader);
    loader.load(PATHS.models.helicopter, (gltf) => {
      loadingProgress.complete();
      const mesh = gltf.scene;

      // Scale helicopter
      const box = new THREE.Box3().setFromObject(mesh);
      const size = new THREE.Vector3();
      box.getSize(size);
      const maxDim = Math.max(size.x, size.y, size.z);
      const baseScaleRatio = 2 / maxDim; // Store base ratio for dynamic scaling
      const scale = settings.helicopterScale * baseScaleRatio;
      mesh.scale.setScalar(scale);
      mesh.userData.baseScaleRatio = baseScaleRatio; // Store for later use
      if (DEBUG) console.log("Helicopter size:", size, "maxDim:", maxDim, "scale:", scale);

      // Position above the level - start near chaser spawn area
      const center = STATE.levelCenter || new THREE.Vector3(0, 0, 0);
      const levelRadius = STATE.horizontalSize ? STATE.horizontalSize / 2 : 10;
      // Start at a random position within the level
      const startX = center.x + (Math.random() - 0.5) * levelRadius;
      const startZ = center.z + (Math.random() - 0.5) * levelRadius;
      mesh.position.set(startX, settings.helicopterHeight, startZ);
      if (DEBUG) console.log("Helicopter position:", mesh.position, "center:", center, "levelRadius:", levelRadius);

      // Add spotlight facing down
      const angleRad = (settings.helicopterLightAngle * Math.PI) / 180;
      const light = new THREE.SpotLight(
        settings.helicopterLightColor,
        settings.helicopterLightIntensity,
        settings.helicopterLightDistance || 50,
        angleRad,
        0.5,
        1
      );
      light.position.set(0, 0, 0);
      light.castShadow = true;
      light.shadow.mapSize.width = 2048;
      light.shadow.mapSize.height = 2048;
      light.shadow.bias = -0.002;
      light.shadow.normalBias = 0.05;

      // Create target below helicopter
      const lightTarget = new THREE.Object3D();
      lightTarget.position.set(0, -10, 0);
      mesh.add(lightTarget);
      light.target = lightTarget;
      mesh.add(light);

      // Volumetric light cone - small at top (helicopter), wide at bottom (ground)
      // Multiple nested layers for fuzzy volumetric effect
      const coneHeight = settings.helicopterConeHeight;
      const topRadius = settings.helicopterConeTopRadius;
      const bottomRadius = settings.helicopterConeBottomRadius;
      const coneOffsetY = settings.helicopterConeOffsetY;

      // Create a group to hold multiple cone layers - pivot point at top
      const lightCone = new THREE.Group();
      lightCone.position.set(0, -coneOffsetY, 0);

      // Create multiple layers for fuzzy effect
      const layerCount = 5;
      const coneLayers = [];

      for (let layer = 0; layer < layerCount; layer++) {
        // Each layer slightly smaller, creating soft edges
        const layerScale = 1 - (layer * 0.15);
        const layerTopRadius = topRadius * layerScale;
        const layerBottomRadius = bottomRadius * layerScale;

        // More segments for smoother appearance
        const coneGeo = new THREE.CylinderGeometry(layerTopRadius, layerBottomRadius, coneHeight, 48, 24, true);

        // Vertex colors with soft falloff
        const colors = [];
        const positions = coneGeo.attributes.position;
        for (let i = 0; i < positions.count; i++) {
          const x = positions.getX(i);
          const y = positions.getY(i);
          const z = positions.getZ(i);

          // Vertical fade: t = 1 at top, 0 at bottom
          const t = (y + coneHeight / 2) / coneHeight;
          // Softer exponential falloff
          const verticalFade = Math.pow(t, 0.3);

          // Edge fade based on distance from center
          const radiusAtHeight = layerTopRadius + (layerBottomRadius - layerTopRadius) * (1 - t);
          const distFromCenter = Math.sqrt(x * x + z * z);
          const edgeT = radiusAtHeight > 0 ? distFromCenter / radiusAtHeight : 0;
          // Soft gaussian-like edge falloff
          const edgeFade = Math.exp(-edgeT * edgeT * 2);

          const brightness = verticalFade * edgeFade;
          colors.push(brightness, brightness, brightness);
        }
        coneGeo.setAttribute("color", new THREE.Float32BufferAttribute(colors, 3));

        // Inner layers are brighter, outer layers dimmer
        const layerOpacity = settings.helicopterVolumetricOpacity * (1 - layer * 0.15);

        const coneMat = new THREE.MeshBasicMaterial({
          color: settings.helicopterLightColor,
          transparent: true,
          opacity: layerOpacity,
          side: THREE.DoubleSide,
          depthWrite: false,
          blending: THREE.AdditiveBlending,
          vertexColors: true
        });

        const layerMesh = new THREE.Mesh(coneGeo, coneMat);
        layerMesh.position.y = -coneHeight / 2; // Offset down so pivot is at top
        layerMesh.castShadow = false;
        layerMesh.receiveShadow = false;
        lightCone.add(layerMesh);
        coneLayers.push({ mesh: layerMesh, material: coneMat });
      }

      // Store layers for later updates
      lightCone.userData.layers = coneLayers;
      mesh.add(lightCone);

      const helicopterMaterials = [];
      mesh.traverse((child) => {
        // Skip the lightCone - it should not cast/receive shadows
        if (child === lightCone) return;
        if (child.isMesh) {
          child.castShadow = true;
          child.receiveShadow = true;
          // Apply helicopter color
          if (child.material) {
            const mat = child.material;
            mat.color.set(settings.helicopterColor);
            if (mat.emissive) {
              mat.emissive.set(settings.helicopterColor);
              mat.emissiveIntensity = 0.3;
            }
            helicopterMaterials.push(mat);
          }
        }
      });
      mesh.userData.materials = helicopterMaterials;

      // Assign GLB layer for selective pixelation
      mesh.traverse(child => {
        if (child.isMesh) child.layers.set(LAYERS.GLB_MODELS);
      });
      // Keep light cone on default layer (volumetric effect should not be pixelated)
      lightCone.traverse(child => child.layers.set(LAYERS.DEFAULT));

      scene.add(mesh);

      helicopter = {
        mesh,
        light,
        lightTarget,
        lightCone,
        angle: 0,
        rotorAngle: 0,
        targetX: startX,
        targetZ: startZ,
        waypointTimer: 2,
        baseScaleRatio,
      };

      // Find rotor parts to animate
      mesh.traverse((child) => {
        if (child.name && child.name.toLowerCase().includes("rotor")) {
          if (!helicopter.rotors) helicopter.rotors = [];
          helicopter.rotors.push(child);
        }
      });

      // Rebuild cone to ensure consistent appearance
      rebuildHelicopterCone();

      if (DEBUG) console.log("Helicopter loaded");
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

    // Create smooth hovering path using sine waves, clamped to bounds
    const rawX = center.x + Math.sin(helicopter.angle) * patrolRadius * 0.8;
    const rawZ = center.z + Math.sin(helicopter.angle * 2) * patrolRadius * 0.4;
    const targetX = Math.max(settings.helicopterBoundsMinX, Math.min(settings.helicopterBoundsMaxX, rawX));
    const targetZ = Math.max(settings.helicopterBoundsMinZ, Math.min(settings.helicopterBoundsMaxZ, rawZ));

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
      helicopter.light.distance = settings.helicopterLightDistance || 50;
      helicopter.light.position.set(
        settings.helicopterLightOffsetX || 0,
        settings.helicopterLightOffsetY || 0,
        settings.helicopterLightOffsetZ || 0
      );
    }

    // Update helicopter spotlight helper
    if (helicopterLightHelper) helicopterLightHelper.update();

    // Animate searchlight sway
    const swayAmount = settings.helicopterSearchlightSway || 0;
    const swaySpeed = settings.helicopterSearchlightSpeed || 0.5;
    const swayX = Math.sin(time * swaySpeed) * swayAmount;
    const swayZ = Math.cos(time * swaySpeed * 1.3) * swayAmount * 0.7;

    // Move the spotlight target
    if (helicopter.lightTarget) {
      helicopter.lightTarget.position.set(swayX, -10, swayZ);
    }

    // Update light cone appearance and rotation to follow searchlight
    if (helicopter.lightCone) {
      helicopter.lightCone.visible = settings.helicopterVolumetric;

      // Point cone toward the light target direction (reuse temp objects)
      _tempVec3A.set(swayX, -10, swayZ).normalize();
      _tempQuat.setFromUnitVectors(_defaultDownDir, _tempVec3A);
      helicopter.lightCone.quaternion.copy(_tempQuat);

      // Update all layers
      if (helicopter.lightCone.userData.layers) {
        helicopter.lightCone.userData.layers.forEach((layer, i) => {
          layer.material.opacity = settings.helicopterVolumetricOpacity * (1 - i * 0.15);
          layer.material.color.set(settings.helicopterLightColor);
        });
      }
    }

    // Update boundary helper visibility
    if (helicopterBoundsHelper) {
      helicopterBoundsHelper.visible = settings.helicopterShowBounds;
    }
  }

  function rebuildHelicopterCone() {
    if (!helicopter || !helicopter.mesh || !helicopter.lightCone) return;

    // Remove old cone group from parent
    helicopter.mesh.remove(helicopter.lightCone);

    // Dispose old layers
    if (helicopter.lightCone.userData.layers) {
      for (const layer of helicopter.lightCone.userData.layers) {
        layer.mesh.geometry.dispose();
        layer.material.dispose();
      }
    }

    // Create new geometry with updated dimensions
    const coneHeight = settings.helicopterConeHeight;
    const topRadius = settings.helicopterConeTopRadius;
    const bottomRadius = settings.helicopterConeBottomRadius;
    const coneOffsetY = settings.helicopterConeOffsetY;

    // Create new group - pivot point at top
    const lightCone = new THREE.Group();
    lightCone.position.set(0, -coneOffsetY, 0);

    const layerCount = 5;
    const coneLayers = [];

    for (let layer = 0; layer < layerCount; layer++) {
      const layerScale = 1 - (layer * 0.15);
      const layerTopRadius = topRadius * layerScale;
      const layerBottomRadius = bottomRadius * layerScale;

      const coneGeo = new THREE.CylinderGeometry(layerTopRadius, layerBottomRadius, coneHeight, 48, 24, true);

      const colors = [];
      const positions = coneGeo.attributes.position;
      for (let i = 0; i < positions.count; i++) {
        const x = positions.getX(i);
        const y = positions.getY(i);
        const z = positions.getZ(i);

        const t = (y + coneHeight / 2) / coneHeight;
        const verticalFade = Math.pow(t, 0.3);

        const radiusAtHeight = layerTopRadius + (layerBottomRadius - layerTopRadius) * (1 - t);
        const distFromCenter = Math.sqrt(x * x + z * z);
        const edgeT = radiusAtHeight > 0 ? distFromCenter / radiusAtHeight : 0;
        const edgeFade = Math.exp(-edgeT * edgeT * 2);

        const brightness = verticalFade * edgeFade;
        colors.push(brightness, brightness, brightness);
      }
      coneGeo.setAttribute("color", new THREE.Float32BufferAttribute(colors, 3));

      const layerOpacity = settings.helicopterVolumetricOpacity * (1 - layer * 0.15);

      const coneMat = new THREE.MeshBasicMaterial({
        color: settings.helicopterLightColor,
        transparent: true,
        opacity: layerOpacity,
        side: THREE.DoubleSide,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        vertexColors: true
      });

      const layerMesh = new THREE.Mesh(coneGeo, coneMat);
      layerMesh.position.y = -coneHeight / 2; // Offset down so pivot is at top
      layerMesh.castShadow = false;
      layerMesh.receiveShadow = false;
      lightCone.add(layerMesh);
      coneLayers.push({ mesh: layerMesh, material: coneMat });
    }

    lightCone.userData.layers = coneLayers;
    helicopter.lightCone = lightCone;
    helicopter.mesh.add(lightCone);
  }

  function updateHelicopterColor() {
    if (!helicopter || !helicopter.mesh) return;
    const materials = helicopter.mesh.userData.materials;
    if (!materials) return;
    for (const mat of materials) {
      mat.color.set(settings.helicopterColor);
      if (mat.emissive) {
        mat.emissive.set(settings.helicopterColor);
        mat.emissiveIntensity = settings.helicopterBrightness || 1.0;
      }
    }
  }

  function updateHelicopterScale() {
    if (!helicopter || !helicopter.mesh || !helicopter.baseScaleRatio) return;
    const scale = settings.helicopterScale * helicopter.baseScaleRatio;
    helicopter.mesh.scale.setScalar(scale);
  }

  function setupSearchlights() {
    const center = STATE.levelCenter || new THREE.Vector3(0, 0, 0);
    const height = settings.searchlightHeight;
    const angleRad = THREE.MathUtils.degToRad(settings.searchlightAngle);

    const lights = [];
    for (let i = 0; i < 2; i++) {
      const spot = new THREE.SpotLight(
        settings.searchlightColor,
        settings.searchlightIntensity,
        settings.searchlightDistance,
        angleRad,
        settings.searchlightPenumbra,
        1
      );
      // Position at opposite corners, high above the board
      const offsetX = i === 0 ? -8 : 8;
      const offsetZ = i === 0 ? -6 : 6;
      spot.position.set(center.x + offsetX, height, center.z + offsetZ);
      spot.castShadow = true;
      spot.shadow.mapSize.width = 1024;
      spot.shadow.mapSize.height = 1024;
      spot.shadow.bias = -0.002;
      spot.shadow.normalBias = 0.05;

      const target = new THREE.Object3D();
      target.position.copy(center);
      scene.add(target);
      spot.target = target;
      scene.add(spot);

      // Random wandering state
      const goalX = center.x + (Math.random() - 0.5) * settings.searchlightSway * 2;
      const goalZ = center.z + (Math.random() - 0.5) * settings.searchlightSway * 2;
      lights.push({ spot, target, goalX, goalZ });
    }

    searchlights = lights;
    if (!settings.searchlightsEnabled) {
      for (const sl of searchlights) sl.spot.visible = false;
    }
  }

  function updateSearchlights(dt) {
    if (!searchlights) return;
    const enabled = settings.searchlightsEnabled;
    for (const sl of searchlights) {
      sl.spot.visible = enabled;
    }
    if (!enabled) return;

    const center = STATE.levelCenter || new THREE.Vector3(0, 0, 0);
    const speed = settings.searchlightSpeed;
    const sway = settings.searchlightSway;

    for (const sl of searchlights) {
      // Update light properties
      sl.spot.intensity = settings.searchlightIntensity;
      sl.spot.color.set(settings.searchlightColor);
      sl.spot.angle = THREE.MathUtils.degToRad(settings.searchlightAngle);
      sl.spot.distance = settings.searchlightDistance;
      sl.spot.penumbra = settings.searchlightPenumbra;
      sl.spot.position.y = settings.searchlightHeight;

      // Smoothly move toward random goal point
      const lerpSpeed = speed * dt;
      sl.target.position.x += (sl.goalX - sl.target.position.x) * lerpSpeed;
      sl.target.position.z += (sl.goalZ - sl.target.position.z) * lerpSpeed;

      // Pick a new random goal when close enough to the current one
      const dx = sl.goalX - sl.target.position.x;
      const dz = sl.goalZ - sl.target.position.z;
      if (dx * dx + dz * dz < 0.5) {
        sl.goalX = center.x + (Math.random() - 0.5) * sway * 2;
        sl.goalZ = center.z + (Math.random() - 0.5) * sway * 2;
      }
    }

    // Update debug helpers
    for (const helper of searchlightHelpers) {
      helper.update();
    }
  }

  function toggleSearchlightHelpers(show) {
    // Remove existing helpers
    for (const helper of searchlightHelpers) {
      scene.remove(helper);
      helper.dispose();
    }
    searchlightHelpers = [];

    if (show && searchlights) {
      for (const sl of searchlights) {
        const helper = new THREE.SpotLightHelper(sl.spot);
        scene.add(helper);
        searchlightHelpers.push(helper);
      }
    }
  }

  function updateLamps() {
    if (!STATE.lampMeshes || STATE.lampMeshes.length === 0) return;

    // Get audio frequency if audio-reactive is enabled
    let audioBoost = 0;
    if (settings.lampAudioReactive && audioAnalyser) {
      // Use low-mid frequencies for lamp pulsing
      const bass = getAudioFrequency(0, 8);
      const mid = getAudioFrequency(2, 8);
      audioBoost = (bass * 0.6 + mid * 0.4) * settings.lampAudioSensitivity;
    }

    const globalMult = settings.globalEmissiveMultiplier || 1.0;
    const baseIntensity = (settings.lampEmissiveIntensity || 2.0) * globalMult;
    const finalIntensity = baseIntensity + audioBoost;

    for (const mesh of STATE.lampMeshes) {
      if (mesh.material && mesh.material.emissiveIntensity !== undefined) {
        mesh.material.emissiveIntensity = finalIntensity;
      }
    }
  }

  let carBeatTime = 0;

  function updateCarsAudio() {
    if (!chasers || chasers.length === 0) return;
    if (!settings.carAudioReactive) return;

    // BPM-based pulsing
    const bpm = settings.carAudioBPM || 95;
    const beatInterval = 60000 / bpm; // ms per beat
    const now = performance.now();
    const beatPhase = (now % beatInterval) / beatInterval; // 0 to 1

    // Create a pulse that peaks at the beat and fades
    // Using a sharp attack and smooth decay
    const pulse = Math.pow(1 - beatPhase, 3); // Exponential decay from beat
    const audioBoost = pulse * (settings.carAudioIntensity || 0.5);

    const chaserColors = [settings.chaser1Color, settings.chaser2Color, settings.chaser3Color, settings.chaser4Color];

    for (let i = 0; i < chasers.length; i++) {
      const chaser = chasers[i];
      if (chaser.isCarModel && chaser.cachedMaterials) {
        const chaserColor = chaserColors[i] || "#ffffff";
        const isSelected = chaser.ready || chaser.active;
        const baseEmissive = isSelected ? 0.3 : 0.05;
        // Only selected/ready chasers pulsate to the beat
        const intensity = isSelected ? baseEmissive + audioBoost : baseEmissive;

        for (const mat of chaser.cachedMaterials) {
          // Initialize emissive color once
          if (!mat._emissiveInitialized) {
            if (!mat.emissive) {
              mat.emissive = new THREE.Color(chaserColor);
            } else {
              mat.emissive.set(chaserColor);
            }
            mat._emissiveInitialized = true;
          }
          mat.emissiveIntensity = intensity;
        }
      }
    }
  }

  function updateTextBPMPulse() {
    if (!settings.textBPMPulse || glassMaterials.length === 0) return;

    // BPM-based pulsing (same timing as cars)
    const bpm = settings.carAudioBPM || 95;
    const beatInterval = 60000 / bpm; // ms per beat
    const now = performance.now();
    const beatPhase = (now % beatInterval) / beatInterval; // 0 to 1

    // Create a pulse that peaks at the beat and fades
    const pulse = Math.pow(1 - beatPhase, 3); // Exponential decay from beat
    const pulseBoost = pulse * (settings.textBPMIntensity || 0.5);

    const baseBrightness = settings.glassTextBrightness || 1;
    const finalBrightness = baseBrightness + pulseBoost * baseBrightness;

    for (const mat of glassMaterials) {
      mat.color.setRGB(finalBrightness, finalBrightness, finalBrightness);
    }
  }

  function updateAllEmissives() {
    const globalMult = settings.globalEmissiveMultiplier || 1.0;

    // Update windows
    if (STATE.windowMeshes) {
      const intensity = (settings.windowEmissiveIntensity || 2.0) * globalMult;
      for (const mesh of STATE.windowMeshes) {
        if (mesh.material && mesh.material.emissiveIntensity !== undefined) {
          mesh.material.emissiveIntensity = intensity;
        }
      }
    }

    // Update lamps
    if (STATE.lampMeshes) {
      const intensity = (settings.lampEmissiveIntensity || 2.0) * globalMult;
      for (const mesh of STATE.lampMeshes) {
        if (mesh.material && mesh.material.emissiveIntensity !== undefined) {
          mesh.material.emissiveIntensity = intensity;
        }
      }
    }

    // Update roads
    if (STATE.roadMeshes) {
      const intensity = (settings.roadEmissiveIntensity || 1.0) * globalMult;
      for (const mesh of STATE.roadMeshes) {
        if (mesh.material && mesh.material.emissiveIntensity !== undefined) {
          mesh.material.emissiveIntensity = intensity;
        }
      }
    }

    // Update paths
    if (STATE.pathMeshes) {
      const intensity = (settings.pathEmissiveIntensity || 1.0) * globalMult;
      for (const mesh of STATE.pathMeshes) {
        if (mesh.material && mesh.material.emissiveIntensity !== undefined) {
          mesh.material.emissiveIntensity = intensity;
        }
      }
    }

    // Update other emissive meshes
    if (STATE.otherEmissiveMeshes) {
      const intensity = (settings.otherEmissiveIntensity || 1.0) * globalMult;
      for (const mesh of STATE.otherEmissiveMeshes) {
        if (mesh.material && mesh.material.emissiveIntensity !== undefined) {
          mesh.material.emissiveIntensity = intensity;
        }
      }
    }
  }

  function updateHelicopterBoundsHelper() {
    // Remove old helper
    if (helicopterBoundsHelper) {
      scene.remove(helicopterBoundsHelper);
      helicopterBoundsHelper.geometry.dispose();
      helicopterBoundsHelper.material.dispose();
      helicopterBoundsHelper = null;
    }

    // Create new bounds visualization as a wireframe box
    const minX = settings.helicopterBoundsMinX;
    const maxX = settings.helicopterBoundsMaxX;
    const minZ = settings.helicopterBoundsMinZ;
    const maxZ = settings.helicopterBoundsMaxZ;
    const height = settings.helicopterHeight;

    const width = maxX - minX;
    const depth = maxZ - minZ;
    const boxHeight = 4;

    const geometry = new THREE.BoxGeometry(width, boxHeight, depth);
    const edges = new THREE.EdgesGeometry(geometry);
    const material = new THREE.LineBasicMaterial({ color: 0x00ff00, transparent: true, opacity: 0.5 });
    helicopterBoundsHelper = new THREE.LineSegments(edges, material);
    helicopterBoundsHelper.position.set((minX + maxX) / 2, height, (minZ + maxZ) / 2);
    helicopterBoundsHelper.visible = settings.helicopterShowBounds;
    scene.add(helicopterBoundsHelper);
  }

  // ============================================
  // GLASS OVERLAY (Canvas texture on GLASS mesh)
  // ============================================

  let glassMeshes = [];
  let glassMaterials = [];
  let glassCanvas = null;
  let glassContext = null;
  let glassTexture = null;
  let marqueeOffset = 0;
  let lastMarqueeTime = 0;
  let glassVideo = null;
  let glassVideoReady = false;

  // Text shuffle effect - similar to domedreaming.com
  // Each character has its own scramble state with startTime and duration
  const textShuffleState = {
    rows: [{}, {}, {}, {}], // State for each row
    lastTexts: ["", "", "", ""], // Track previous text to detect changes
    lastFlickerTime: 0, // Throttle random char updates
    flickerChars: {}, // Cached random chars per row
    activeCount: 0, // Track active shuffle count to avoid iteration
  };

  const SCRAMBLE_CHARS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";

  // Check if character is a letter (A-Z)
  function isLetter(char) {
    return char >= "A" && char <= "Z";
  }

  function initShuffleRow(rowIndex, targetText, previousText) {
    const state = textShuffleState.rows[rowIndex];
    state.target = targetText;
    state.chars = []; // Per-character state: { active, startTime }

    const now = performance.now();
    const duration = settings.glassTextShuffleCharDelay || 500; // Duration each char scrambles
    const stagger = 30; // Stagger start time between characters

    // Initialize per-character state
    for (let i = 0; i < targetText.length; i++) {
      const oldChar = (previousText || "")[i] || "";
      const newChar = targetText[i] || "";
      // Only scramble letters that changed
      const isChanged = oldChar !== newChar && isLetter(newChar);

      state.chars.push({
        active: isChanged,
        startTime: now + (i * stagger), // Stagger each character
        duration: duration,
      });
      if (isChanged) textShuffleState.activeCount++;
    }
  }

  // Trigger random scramble on a letter in a row
  function triggerRandomScramble(rowIndex) {
    const state = textShuffleState.rows[rowIndex];
    if (!state.target || !state.chars) return;

    const now = performance.now();
    const duration = settings.glassTextShuffleCharDelay || 500;

    // Find available letter characters (not already scrambling)
    const availableIndices = [];
    for (let i = 0; i < state.target.length; i++) {
      const char = state.target[i];
      const charState = state.chars[i];
      if (isLetter(char) && charState && !charState.active) {
        availableIndices.push(i);
      }
    }

    // Scramble one random available letter
    if (availableIndices.length > 0) {
      const randomIdx = availableIndices[Math.floor(Math.random() * availableIndices.length)];
      state.chars[randomIdx].active = true;
      state.chars[randomIdx].startTime = now;
      state.chars[randomIdx].duration = duration;
      textShuffleState.activeCount++;
    }
  }

  function getShuffledText(rowIndex, targetText, dt) {
    // Skip shuffle if disabled or during high score entry
    if (!settings.glassTextShuffle || STATE.enteringHighScore) {
      textShuffleState.lastTexts[rowIndex] = targetText;
      return targetText;
    }

    // Check if text changed
    if (textShuffleState.lastTexts[rowIndex] !== targetText) {
      const previousText = textShuffleState.lastTexts[rowIndex];
      textShuffleState.lastTexts[rowIndex] = targetText;
      initShuffleRow(rowIndex, targetText, previousText);
    }

    const state = textShuffleState.rows[rowIndex];
    if (!state.target || !state.chars) return targetText;

    const now = performance.now();

    // Throttle random char updates (every 150ms for slower, readable flicker)
    const flickerInterval = 150;
    if (now - textShuffleState.lastFlickerTime >= flickerInterval) {
      textShuffleState.lastFlickerTime = now;

      // Randomly trigger scrambles on letters (5% chance per row per interval)
      for (let r = 0; r < 4; r++) {
        if (Math.random() < 0.05) {
          triggerRandomScramble(r);
        }
      }

      // Generate new random chars for all rows
      for (let r = 0; r < 4; r++) {
        textShuffleState.flickerChars[r] = {};
        const rowState = textShuffleState.rows[r];
        if (rowState.target) {
          for (let i = 0; i < rowState.target.length; i++) {
            textShuffleState.flickerChars[r][i] = SCRAMBLE_CHARS[Math.floor(Math.random() * SCRAMBLE_CHARS.length)];
          }
        }
      }
    }

    // Build result string
    let result = "";

    for (let i = 0; i < state.target.length; i++) {
      const char = state.target[i];
      const charState = state.chars[i];

      if (!charState || !charState.active) {
        result += char;
      } else {
        const elapsed = now - charState.startTime;
        if (elapsed >= charState.duration) {
          // Scramble complete - lock to final char
          charState.active = false;
          textShuffleState.activeCount--;
          result += char;
        } else if (elapsed < 0) {
          // Not started yet (staggered) - show space
          result += " ";
        } else {
          // Still scrambling - show cached random char
          result += textShuffleState.flickerChars[rowIndex]?.[i] || char;
        }
      }
    }

    return result;
  }

  function isShuffleActive() {
    if (!settings.glassTextShuffle) return false;
    return textShuffleState.activeCount > 0;
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
      updateGlassCanvas();
    });
  }

  function updateGlassCanvas(timestamp = 0) {
    if (!glassContext) return;

    // Re-apply high score text each frame during high score entry for blinking initials
    if (STATE.enteringHighScore) {
      applyHighScoreText();
    }

    const ctx = glassContext;
    const w = glassCanvas.width;
    const h = glassCanvas.height;

    // Clear canvas
    ctx.clearRect(0, 0, w, h);

    // Flip vertically to correct upside-down text
    ctx.save();
    ctx.translate(0, h);
    ctx.scale(1, -1);

    // Compensation factor for text brightness (darken background so material brightness only boosts text)
    const textBrightness = settings.glassTextBrightness || 1;
    const bgCompensation = textBrightness > 1 ? 1 - (1 / textBrightness) : 0;

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

      // Compensate for text brightness boost (darken background)
      if (bgCompensation > 0) {
        ctx.fillStyle = `rgba(0, 0, 0, ${bgCompensation})`;
        ctx.fillRect(0, 0, w, h);
      }
    } else {
      // Fallback solid background - only draw if opacity > 0
      if (settings.glassOpacity > 0) {
        // Combined opacity includes brightness compensation
        const combinedOpacity = Math.min(1, settings.glassOpacity + bgCompensation);
        ctx.fillStyle = `rgba(0, 0, 0, ${combinedOpacity})`;
        ctx.fillRect(0, 0, w, h);
      }
      // When glassOpacity is 0, keep background transparent (no compensation needed)
    }

    // Calculate dt for shuffle effect
    const shuffleDt = timestamp - lastMarqueeTime > 0 && timestamp - lastMarqueeTime < 100
      ? (timestamp - lastMarqueeTime) / 1000
      : 0.016;

    // Skip text rendering if disabled
    if (!settings.glassTextEnabled) {
      ctx.restore();
      if (glassTexture) {
        glassTexture.needsUpdate = true;
      }
      return;
    }

    // Get text rows with shuffle effect applied
    const rawRows = [
      settings.glassTextRow1,
      settings.glassTextRow2,
      settings.glassTextRow3,
      settings.glassTextRow4,
    ];
    // Keep all 4 rows (empty or not) for consistent positioning
    const rows = rawRows.map((row, i) => row && row.trim() !== "" ? getShuffledText(i, row, shuffleDt) : "");

    // Check if all rows are empty
    const hasContent = rows.some(row => row !== "");
    if (!hasContent) {
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

    // Calculate total height assuming 4 rows (consistent positioning)
    const totalHeight = 4 * lineHeight;
    const startY = (h - totalHeight) / 2 + lineHeight / 2 + (settings.glassTextOffsetY || 0);
    const letterSpacing = settings.glassTextLetterSpacing || 0;

    // Monospace settings
    const monospace = settings.glassTextMonospace || false;
    const charWidth = settings.glassTextCharWidth || 50;

    // Helper function to draw text with letter spacing (and optional monospace)
    function drawTextWithSpacing(text, x, y, align = "left") {
      if (monospace) {
        // Monospace mode: each character gets fixed width, centered in cell
        ctx.textAlign = "center";
        const totalWidth = text.length * charWidth;
        let startX = x;

        // Adjust starting position for alignment
        if (align === "center") {
          startX = x - totalWidth / 2 + charWidth / 2;
        } else if (align === "right") {
          startX = x - totalWidth + charWidth / 2;
        } else {
          startX = x + charWidth / 2;
        }

        for (let i = 0; i < text.length; i++) {
          const char = text[i];
          const charX = startX + i * charWidth;
          ctx.fillText(char, charX, y);
        }
        return;
      }

      // Variable width mode with letter spacing
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

    // Helper to measure text width with letter spacing (or monospace)
    function measureTextWithSpacing(text) {
      if (monospace) {
        return text.length * charWidth;
      }
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
        const text = rows[i];
        if (!text) continue; // Skip empty rows
        const y = startY + i * lineHeight;
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
      const offsetX = settings.glassTextOffsetX || 0;
      switch (settings.glassTextAlign) {
        case "left": xPos = 50 + offsetX; break;
        case "right": xPos = w - 50 + offsetX; break;
        default: xPos = w / 2 + offsetX; break;
      }

      for (let i = 0; i < rows.length; i++) {
        const text = rows[i];
        if (!text) continue; // Skip empty rows but keep position
        const y = startY + i * lineHeight;
        // Initials row: white text with colored glow during high score entry
        if (STATE.enteringHighScore && STATE.highScoreInitialsColor && i === 1) {
          ctx.save();
          ctx.shadowColor = STATE.highScoreInitialsColor;
          ctx.shadowBlur = 20;
          ctx.shadowOffsetX = 0;
          ctx.shadowOffsetY = 0;
          ctx.fillStyle = "#ffffff";
          // Draw multiple times to intensify the glow
          drawTextWithSpacing(text, xPos, y, settings.glassTextAlign);
          drawTextWithSpacing(text, xPos, y, settings.glassTextAlign);
          ctx.restore();
          ctx.fillStyle = settings.glassTextColor;
        } else {
          drawTextWithSpacing(text, xPos, y, settings.glassTextAlign);
        }
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

    // Pick up GLB material color as default glass tint (skip black/very dark)
    for (const mesh of meshes) {
      if (mesh.material && mesh.material.color) {
        const c = mesh.material.color;
        if ((c.r + c.g + c.b) > 0.1 && (c.r !== 1 || c.g !== 1 || c.b !== 1)) {
          settings.glassColor = "#" + c.getHexString();
          break;
        }
      }
    }

    glassMaterials = [];
    const brightness = settings.glassTextBrightness || 1;
    const tint = new THREE.Color(settings.glassColor);
    for (const mesh of glassMeshes) {
      // Store original positions and rotation for offset calculations
      mesh.userData.originalX = mesh.position.x;
      mesh.userData.originalY = mesh.position.y;
      mesh.userData.originalZ = mesh.position.z;
      mesh.userData.originalRotX = mesh.rotation.x;

      // Use BasicMaterial with toneMapped:false to allow brightness > 1
      const glassMaterial = new THREE.MeshBasicMaterial({
        map: glassTexture,
        color: tint.clone().multiplyScalar(brightness),
        transparent: true,
        opacity: settings.glassMaterialOpacity ?? 1.0,
        side: THREE.DoubleSide,
        depthWrite: false,
        toneMapped: false,
      });

      mesh.material = glassMaterial;
      mesh.castShadow = false; // Don't block light (helicopter spotlight shines through)
      mesh.renderOrder = 999; // Render on top
      glassMaterials.push(glassMaterial);
    }

    // Apply initial position offsets
    updateGlassPosition();
  }

  function updateGlassPosition() {
    for (const mesh of glassMeshes) {
      if (mesh.userData.originalX !== undefined) {
        mesh.position.x = mesh.userData.originalX + (settings.glassPosX || 0);
      }
      if (mesh.userData.originalY !== undefined) {
        mesh.position.y = mesh.userData.originalY + (settings.glassPosY || 0);
      }
      if (mesh.userData.originalZ !== undefined) {
        mesh.position.z = mesh.userData.originalZ + (settings.glassPosZ || 0);
      }
      // Apply rotation offset (in degrees, converted to radians)
      if (mesh.userData.originalRotX !== undefined) {
        mesh.rotation.x = mesh.userData.originalRotX + (settings.glassRotX || 0) * Math.PI / 180;
      }
    }
  }

  function updateGlassMaterialOpacity() {
    const opacity = settings.glassMaterialOpacity ?? 1.0;
    for (const mat of glassMaterials) {
      mat.opacity = opacity;
    }
  }

  function updateGlassColor() {
    const brightness = settings.glassTextBrightness || 1;
    const tint = new THREE.Color(settings.glassColor);
    for (const mat of glassMaterials) {
      mat.color.copy(tint).multiplyScalar(brightness);
    }
    updateGlassCanvas();
  }

  function updateGlassBrightness() {
    updateGlassColor();
  }

  // ============================================
  // INPUT
  // ============================================

  const keys = new Set();
  const chaserControlKeys = [
    "arrowup", "arrowdown", "arrowleft", "arrowright",
    "w", "a", "s", "d", "e", "t", "f", "g", "h", "y", "i", "j", "k", "l", "o", "enter"
  ];

  // Character set for high score initials
  const HIGH_SCORE_CHARS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";

  // Blocked words for high score initials
  let blockedWords = [];
  fetch("assets/data/blocked-words.txt")
    .then(r => r.text())
    .then(text => {
      blockedWords = text.split("\n").map(w => w.trim().toUpperCase()).filter(w => w.length > 0);
    })
    .catch(() => {});

  function wouldFormBlockedWord(initials, position, char) {
    const test = [...initials];
    test[position] = char;
    const word = test.join("").toUpperCase();
    return blockedWords.some(blocked => word.includes(blocked));
  }

  function cycleChar(direction) {
    let attempts = 0;
    do {
      STATE.highScoreCharIndex = (STATE.highScoreCharIndex + direction + HIGH_SCORE_CHARS.length) % HIGH_SCORE_CHARS.length;
      attempts++;
    } while (
      attempts < HIGH_SCORE_CHARS.length &&
      wouldFormBlockedWord(STATE.highScoreInitials, STATE.highScorePosition, HIGH_SCORE_CHARS[STATE.highScoreCharIndex])
    );
    STATE.highScoreInitials[STATE.highScorePosition] = HIGH_SCORE_CHARS[STATE.highScoreCharIndex];
    updateHighScoreDisplay();
  }

  window.addEventListener("keydown", (e) => {
    const keyLower = e.key.toLowerCase();

    // Toggle GUI + stats panel with CMD/CTRL+G
    if (keyLower === "g" && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      if (guiLeft) {
        const show = guiLeft.domElement.style.display === "none";
        guiLeft.domElement.style.display = show ? "" : "none";
        statsPanel.el.style.display = show ? "" : "none";
      }
      return;
    }

    // High score entry mode — only first player controls the initials
    if (STATE.enteringHighScore) {
      const fpIdx = STATE.firstPlayerIndex >= 0 ? STATE.firstPlayerIndex : 0;
      const fpCtrl = CHASER_CONTROLS[fpIdx];
      e.preventDefault();
      if (keyLower === fpCtrl.up) {
        cycleChar(1);
      } else if (keyLower === fpCtrl.down) {
        cycleChar(-1);
      } else if (keyLower === fpCtrl.right) {
        // Move to next initial
        if (STATE.highScorePosition < 2) {
          STATE.highScorePosition++;
          STATE.highScoreCharIndex = HIGH_SCORE_CHARS.indexOf(STATE.highScoreInitials[STATE.highScorePosition]);
          if (STATE.highScoreCharIndex < 0) STATE.highScoreCharIndex = 0;
          updateHighScoreDisplay();
        }
      } else if (keyLower === fpCtrl.left) {
        // Move to previous initial
        if (STATE.highScorePosition > 0) {
          STATE.highScorePosition--;
          STATE.highScoreCharIndex = HIGH_SCORE_CHARS.indexOf(STATE.highScoreInitials[STATE.highScorePosition]);
          if (STATE.highScoreCharIndex < 0) STATE.highScoreCharIndex = 0;
          updateHighScoreDisplay();
        }
      } else if (keyLower === fpCtrl.enter) {
        // Confirm high score entry (first player's enter key only)
        confirmHighScoreEntry();
      }
      keys.add(keyLower);
      return;
    }

    if (chaserControlKeys.includes(keyLower)) {
      e.preventDefault();
      // Prevent GUI elements from stealing focus (Enter can activate lil-gui controls)
      if (document.activeElement && document.activeElement !== document.body) {
        document.activeElement.blur();
      }
      // In PRE_GAME or STARTING state, mark the chaser as ready (lights up car fully)
      if (STATE.loaded && (STATE.gameState === "PRE_GAME" || STATE.gameState === "STARTING")) {
        const chaserIndex = getChaserIndexForKey(keyLower);
        if (chaserIndex >= 0) {
          markChaserReady(chaserIndex);
        }
      }
      // Boost: trigger on player's enter key during gameplay
      if (STATE.gameState === "PLAYING") {
        for (let i = 0; i < CHASER_CONTROLS.length; i++) {
          if (keyLower === CHASER_CONTROLS[i].enter) {
            const boosted = triggerBoost(boostStates, i, settings);
            if (boosted) {
              playSFX("nitro", i);
            } else {
              playSFX("honk", i);
            }
            break;
          }
        }
      }
    }

    // Debug capture triggers: 1-4 triggers capture of F1-F4 by C1-C4
    if (e.key >= "1" && e.key <= "4") {
      const index = parseInt(e.key) - 1;
      triggerCapture(index, index);
    }

    // Force timer to run out (use near-zero so next frame triggers GAME_OVER)
    if (e.key === "5" && STATE.gameState === "PLAYING" && STATE.gameTimerStarted) {
      STATE.gameTimerRemaining = 0.001;
    }

    // Toggle glass opacity between default and 1 (facade mode only)
    if (e.key === "6" && isFacadeMode) {
      const defaultOpacity = settings.glassMaterialOpacity;
      if (defaultOpacity < 1) {
        STATE._savedGlassOpacity = defaultOpacity;
        settings.glassMaterialOpacity = 1;
      } else {
        settings.glassMaterialOpacity = STATE._savedGlassOpacity ?? 0;
      }
      updateGlassMaterialOpacity();
    }

    keys.add(keyLower);
  });
  window.addEventListener("keyup", (e) => keys.delete(e.key.toLowerCase()));

  // Touch input (mobile swipe controls for Chaser 1)
  initTouchInput(canvas, keys, STATE, markChaserReady, () => {
    unlockAudio(); // Unlock audio/Tone.js on first touch
  });

  function triggerCapture(fugitiveIndex, chaserIndex) {
    if (!STATE.loaded) return;
    if (STATE.gameState !== "PLAYING") return; // Only allow captures during PLAYING state
    if (fugitiveIndex >= fugitives.length) return;

    const f = fugitives[fugitiveIndex];
    if (f.captured) return;

    // Mark as captured
    f.captured = true;
    STATE.capturedCount = (STATE.capturedCount || 0) + 1;
    playSFX("capture", chaserIndex);

    // Add score based on current fugitive value
    const points = Math.max(0, Math.floor(STATE.fugitiveValue));
    STATE.playerScore += points;
    sendServerEvent({ type: "fugitiveCaught", chaserIndex, fugitiveIndex, points, score: STATE.playerScore, capturedCount: STATE.capturedCount });

    // Get chaser color for the effect
    const chaserColors = [settings.chaser1Color, settings.chaser2Color, settings.chaser3Color, settings.chaser4Color];
    const chaserColor = chaserColors[chaserIndex] || "#ffffff";

    // Get billboard before hiding
    const wire = fugitiveWires[f.index];
    const billboard = wire ? wire.billboard : null;

    // Create capture effect at fugitive position
    createCaptureEffect(f.mesh.position.clone(), chaserColor, billboard);

    // Hide fugitive
    f.mesh.position.y = -1000;
    if (f.light) f.light.intensity = 0;

    if (wire) {
      if (wire.billboard) wire.billboard.scale.setScalar(0);
      if (wire.billboardLight) wire.billboardLight.intensity = 0;
    }

    // Check if all captured
    if (STATE.capturedCount >= fugitives.length && !STATE.gameOver) {
      setGameState("GAME_OVER");
    }
  }

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

  function getChaserIndexForKey(key) {
    for (let i = 0; i < CHASER_CONTROLS.length; i++) {
      const ctrl = CHASER_CONTROLS[i];
      if (key === ctrl.up || key === ctrl.down || key === ctrl.left || key === ctrl.right || key === ctrl.enter) {
        return i;
      }
    }
    return -1;
  }

  function markChaserReady(chaserIndex) {
    if (chaserIndex < 0 || chaserIndex >= chasers.length) return;
    const chaser = chasers[chaserIndex];
    if (chaser.ready) return; // Already ready

    chaser.ready = true;

    // Track first player to join
    if (STATE.firstPlayerIndex < 0) {
      STATE.firstPlayerIndex = chaserIndex;
    }

    playSFX("playerSelect", chaserIndex);

    // Create pulse wave from chaser position in their color
    const chaserColors = [settings.chaser1Color, settings.chaser2Color, settings.chaser3Color, settings.chaser4Color];
    const chaserColor = chaserColors[chaserIndex] || "#ffffff";
    if (chaser.mesh) {
      createCaptureEffect(chaser.mesh.position.clone(), chaserColor, null);
    }

    // Light up the car fully (like when active/moving)
    if (chaser.isCarModel && chaser.mesh) {
      chaser.mesh.traverse((child) => {
        if (child.isMesh && child.material) {
          const mat = child.material;
          mat.transparent = true;
          mat.opacity = 1;
          mat.depthWrite = true;
          if (mat.emissive) {
            mat.emissiveIntensity = 0.3;
          }
          mat.needsUpdate = true;
        }
      });
    } else if (chaser.material) {
      chaser.material.transparent = true;
      chaser.material.opacity = 1;
      chaser.material.depthWrite = true;
      if (chaser.material.emissive) {
        chaser.material.emissiveIntensity = 0.3;
      }
      chaser.material.needsUpdate = true;
    }

    // Turn on headlights
    if (chaser.light) {
      chaser.light.intensity = settings.chaserLightIntensity;
    }
    if (DEBUG) console.log(`Chaser ${chaserIndex} is ready!`);
    sendServerEvent({ type: "chaserSelected", chaserIndex, playerName: `Player ${chaserIndex + 1}` });

    // Check if this is the first ready chaser - start countdown
    const readyCount = chasers.filter(c => c.ready).length;
    if (readyCount === 1) {
      setGameState("STARTING");
    }
  }

  // ============================================
  // GAME STATE MANAGEMENT
  // ============================================

  function loadHighScores() {
    return settings.highScores.slice(); // Return copy from cache
  }

  function saveHighScores(scores) {
    settings.highScores = scores;
    if (STATE.updateStateDisplay) STATE.updateStateDisplay();
  }

  // Fetch highscores from server into local cache
  function fetchServerHighScores() {
    fetch(`${getServerAddress()}/api/highscore`)
      .then(r => r.ok ? r.json() : null)
      .then(data => {
        if (Array.isArray(data) && data.length > 0) {
          // Map server format (playerName) to local format (initials)
          settings.highScores = data.map(e => ({
            initials: (e.playerName || "???").substring(0, 3),
            score: e.score,
          }));
          if (STATE.updateStateDisplay) STATE.updateStateDisplay();
        }
      })
      .catch(() => {});
  }

  fetchServerHighScores();

  // Set all chasers to low or full opacity
  function setChasersOpacity(opacity) {
    const isLowOpacity = opacity < 1;
    for (const c of chasers) {
      // Respect ready state - ready chasers stay fully lit
      const effectiveOpacity = (isLowOpacity && c.ready) ? 1 : opacity;
      const effectiveEmissive = (isLowOpacity && c.ready) ? 0.3 : (isLowOpacity ? 0.05 : 0.3);
      const effectiveDepthWrite = (isLowOpacity && c.ready) ? true : !isLowOpacity;

      // Use cached materials if available (car models)
      if (c.cachedMaterials && c.cachedMaterials.length > 0) {
        for (const mat of c.cachedMaterials) {
          mat.transparent = true;
          mat.opacity = effectiveOpacity;
          mat.depthWrite = effectiveDepthWrite;
          if (mat.emissive) {
            mat.emissiveIntensity = effectiveEmissive;
          }
          mat.needsUpdate = true;
        }
      } else if (c.material) {
        c.material.transparent = true;
        c.material.opacity = effectiveOpacity;
        c.material.depthWrite = effectiveDepthWrite;
        if (c.material.emissive) {
          c.material.emissiveIntensity = effectiveEmissive;
        }
        c.material.needsUpdate = true;
      }
      if (c.light) {
        if (isLowOpacity) {
          // Respect ready state - ready chasers get full brightness, others get 10%
          c.light.intensity = c.ready
            ? settings.chaserLightIntensity
            : settings.chaserLightIntensity * 0.1;
        } else {
          c.light.intensity = settings.chaserLightIntensity;
        }
      }
    }
  }

  function setGameState(newState) {
    const oldState = STATE.gameState;
    STATE.gameState = newState;
    settings.gameState = newState;

    if (DEBUG) console.log(`Game state: ${oldState} -> ${newState}`);

    switch (newState) {
      case "PRE_GAME":
        stopHelicopterSound(); // Stop helicopter loop
        // Play game animation video when restarting (coming from GAME_OVER)
        if (oldState === "GAME_OVER" && gameAnimationVideo && gameAnimationVideoTexture) {
          STATE.gameAnimationPlaying = true;
          gameAnimationVideo.currentTime = 0;
          gameAnimationVideo.play().catch(() => {});
          if (projectionPlane && projectionPlane.material) {
            projectionPlane.material.map = gameAnimationVideoTexture;
            projectionPlane.material.opacity = settings.projectionOpacity;
            projectionPlane.material.needsUpdate = true;
          }
          // Hide projection when animation ends
          const hideProjection = () => {
            STATE.gameAnimationPlaying = false;
            if (projectionPlane) projectionPlane.material.opacity = 0;
            gameAnimationVideo.removeEventListener("ended", hideProjection);
          };
          gameAnimationVideo.addEventListener("ended", hideProjection);
        }
        // Clear glass text in PRE_GAME (intro image replaces text)
        settings.glassTextRow1 = "";
        settings.glassTextRow2 = "";
        settings.glassTextRow3 = "";
        settings.glassTextRow4 = "";
        settings.gameStarted = false;
        STATE.gameOver = false;
        STATE.firstPlayerIndex = -1;
        // Reset all chasers to visible but dimmed
        for (const c of chasers) {
          if (c.mesh) c.mesh.visible = true;
          if (c.light) c.light.visible = true;
          c.ready = false;
          c.active = false;
        }
        setChasersOpacity(0.1);
        // Hide fugitive billboards
        for (const wire of fugitiveWires) {
          if (!wire.isChaser) {
            wire.hideWireAndBillboard();
          }
        }
        break;

      case "STARTING":
        sendServerEvent({ type: "gameStarted" });
        settings.gameStarted = true; // Mark as started but input blocked
        setChasersOpacity(0.1);
        // Pre-set non-ready chaser materials to transparent to avoid shader recompilation at PLAYING
        for (const c of chasers) {
          if (!c.ready) {
            if (c.isCarModel && c.mesh) {
              c.mesh.traverse((child) => {
                if (child.isMesh && child.material) {
                  child.material.transparent = true;
                  child.material.needsUpdate = true;
                }
              });
            } else if (c.material) {
              c.material.transparent = true;
              c.material.needsUpdate = true;
            }
          }
        }
        playAudio();
        // Start intro video from beginning — game starts on video end
        if (projectionVideo) {
          projectionVideo.muted = false;
          projectionVideo.currentTime = 0;
          projectionVideo.play().catch(() => {});
        }
        break;

      case "PLAYING":
        // Frame 0: minimal state setup only
        STATE.gameTimerStarted = true;
        STATE.gameTimerRemaining = 90;
        STATE.fugitiveValue = 250;
        STATE.playerScore = 0;
        STATE.capturedCount = 0;

        // Make non-ready chasers fully transparent (shaders pre-warmed in STARTING)
        for (const c of chasers) {
          if (!c.ready) {
            if (c.light) c.light.visible = false;
            if (c.isCarModel && c.mesh) {
              c.mesh.traverse((child) => {
                if (child.isMesh && child.material) {
                  child.material.opacity = 0;
                }
              });
            } else if (c.material) {
              c.material.opacity = 0;
            }
          }
        }

        // Start fugitive light fade-in
        for (const f of fugitives) {
          if (f.light) f.light.intensity = 0;
        }
        STATE.fugitiveLightFadeStart = performance.now();

        // Spread remaining work across frames to avoid single-frame stutter
        // Frame 1: text + projection swap
        requestAnimationFrame(() => {
          applyPlayingText();
          updateProjectionForState("PLAYING");
        });
        // Frame 2: audio
        setTimeout(() => {
          playSFX("gameStart");
          playAudio();
          playHelicopterSound();
        }, 50);
        // Frame 3+: stagger billboard pop-ins
        { let popDelay = 200;
        for (const wire of fugitiveWires) {
          if (!wire.isChaser) {
            setTimeout(() => wire.startPopIn(), popDelay);
            popDelay += 200;
          }
        } }
        break;

      case "GAME_OVER":
        sendServerEvent({ type: "gameEnd", score: STATE.playerScore, capturedCount: STATE.capturedCount, gameTime: Math.round(90 - (STATE.gameTimerRemaining || 0)), allCaught: STATE.capturedCount >= fugitives.length });
        stopHelicopterSound(); // Stop helicopter loop
        STATE.gameOver = true;
        STATE.gameTimerStarted = false;
        setChasersOpacity(0.1);
        // Turn off fugitive lights and billboards
        for (const f of fugitives) {
          if (f.light) f.light.intensity = 0;
        }
        for (const wire of fugitiveWires) {
          if (!wire.isChaser) {
            wire.hideWireAndBillboard();
          }
        }
        showGameScore();
        // Play win/lose SFX based on high score
        const isHighScore = checkHighScore(STATE.playerScore) >= 0;
        playSFX(isHighScore ? "gameWin" : "gameLose");
        // Reset to PRE_GAME after 10 seconds (unless entering high score)
        setTimeout(() => {
          if (STATE.gameState === "GAME_OVER" && !STATE.enteringHighScore) {
            setGameState("PRE_GAME");
          }
        }, 10000);
        break;
    }

    // Update the glass canvas and projection (deferred for PLAYING to avoid frame stutter)
    if (newState !== "PLAYING" && !STATE.gameAnimationPlaying) {
      if (typeof updateGlassCanvas === "function") {
        updateGlassCanvas();
      }
      updateProjectionForState(newState);
    }

    // Update GUI state display
    if (STATE.updateStateDisplay) STATE.updateStateDisplay();
  }

  // ============================================
  // TEMPLATE VARIABLE REPLACEMENT
  // ============================================

  function getEndStatus() {
    // Check if player got a new high score
    const highScorePosition = checkHighScore(STATE.playerScore);
    if (highScorePosition >= 0) return "NEWHIGHSCORE!";
    return "GAMEOVER";
  }

  function getHighScoreString(position) {
    const highScores = loadHighScores();
    if (position >= 0 && position < highScores.length) {
      const hs = highScores[position];
      // Ensure initials are exactly 3 characters
      const initials = (hs.initials || "???").substring(0, 3).padEnd(3, "?");
      const score = String(hs.score).padStart(3, "0");
      return `${initials}${score}`;
    }
    return "";
  }

  function getHighScoreInitials(position) {
    const highScores = loadHighScores();
    if (position >= 0 && position < highScores.length) {
      // Ensure initials are exactly 3 characters
      return (highScores[position].initials || "???").substring(0, 3).padEnd(3, "?");
    }
    return "___";
  }

  function getHighScoreScore(position) {
    const highScores = loadHighScores();
    if (position >= 0 && position < highScores.length) {
      return String(highScores[position].score);
    }
    return "0";
  }

  function getCountdownText() {
    if (STATE.countdownValue > 0) return String(STATE.countdownValue);
    if (STATE.countdownValue === 0) return "GO!";
    return "";
  }

  function replaceTemplateVars(text) {
    if (!text) return "";
    // Flash current position when entering high score
    let initials;
    if (STATE.highScoreInitials) {
      const blink = Math.floor(Date.now() / 400) % 2 === 0; // Toggle every 400ms
      initials = STATE.highScoreInitials.map((c, i) => {
        if (STATE.enteringHighScore && i === STATE.highScorePosition) {
          // Blink the current position being edited
          return blink ? c : "_";
        }
        return c;
      }).join("");
    } else {
      initials = "___";
    }
    // Pad score to 4 characters so "SCORE:" doesn't shift
    const paddedScore = String(STATE.playerScore || 0).padStart(3, "0");
    return text
      .replace(/\$\{score\}/g, paddedScore)
      .replace(/\$\{time\}/g, String(Math.floor(STATE.gameTimerRemaining || 0)))
      .replace(/\$\{caught\}/g, String(STATE.capturedCount || 0))
      .replace(/\$\{total\}/g, String(fugitives.length || 4))
      .replace(/\$\{status\}/g, getEndStatus())
      .replace(/\$\{initials\}/g, initials)
      .replace(/\$\{countdown\}/g, getCountdownText())
      // High scores: ${s1}, ${s2}, ${s3} = "AAA 999" format
      .replace(/\$\{s1\}/g, getHighScoreString(0))
      .replace(/\$\{s2\}/g, getHighScoreString(1))
      .replace(/\$\{s3\}/g, getHighScoreString(2))
      // High score initials: ${hs1i}, ${hs2i}, ${hs3i}
      .replace(/\$\{hs1i\}/g, getHighScoreInitials(0))
      .replace(/\$\{hs2i\}/g, getHighScoreInitials(1))
      .replace(/\$\{hs3i\}/g, getHighScoreInitials(2))
      // High score scores: ${hs1s}, ${hs2s}, ${hs3s}
      .replace(/\$\{hs1s\}/g, getHighScoreScore(0))
      .replace(/\$\{hs2s\}/g, getHighScoreScore(1))
      .replace(/\$\{hs3s\}/g, getHighScoreScore(2));
  }

  function applyStartingText() {
    settings.glassTextRow1 = replaceTemplateVars(settings.startingTextRow1);
    settings.glassTextRow2 = replaceTemplateVars(settings.startingTextRow2);
    settings.glassTextRow3 = replaceTemplateVars(settings.startingTextRow3);
    settings.glassTextRow4 = replaceTemplateVars(settings.startingTextRow4);
  }

  function applyPlayingText() {
    settings.glassTextRow1 = replaceTemplateVars(settings.playingTextRow1);
    settings.glassTextRow2 = replaceTemplateVars(settings.playingTextRow2);
    settings.glassTextRow3 = replaceTemplateVars(settings.playingTextRow3);
    settings.glassTextRow4 = replaceTemplateVars(settings.playingTextRow4);
  }

  function applyHighScoreText() {
    settings.glassTextRow1 = replaceTemplateVars(settings.highScoreTextRow1);
    settings.glassTextRow2 = replaceTemplateVars(settings.highScoreTextRow2);
    settings.glassTextRow3 = replaceTemplateVars(settings.highScoreTextRow3);
    settings.glassTextRow4 = replaceTemplateVars(settings.highScoreTextRow4);
  }

  function applyGameOverText() {
    settings.glassTextRow1 = replaceTemplateVars(settings.gameOverTextRow1);
    settings.glassTextRow2 = replaceTemplateVars(settings.gameOverTextRow2);
    settings.glassTextRow3 = replaceTemplateVars(settings.gameOverTextRow3);
    settings.glassTextRow4 = replaceTemplateVars(settings.gameOverTextRow4);
  }

  // ============================================
  // STATE PROJECTION IMAGES
  // ============================================

  function initProjectionPlane() {
    if (projectionPlane) return; // Already initialized

    // Create a large plane above the level for projection
    const size = STATE.horizontalSize * 2 || 30;
    const geometry = new THREE.PlaneGeometry(size, size);
    const material = new THREE.MeshBasicMaterial({
      transparent: true,
      opacity: settings.projectionOpacity,
      side: THREE.DoubleSide,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });

    projectionPlane = new THREE.Mesh(geometry, material);
    projectionPlane.rotation.x = -Math.PI / 2; // Horizontal plane
    projectionPlane.position.set(
      STATE.levelCenter.x + settings.projectionOffsetX,
      STATE.levelCenter.y + settings.projectionOffsetY,
      STATE.levelCenter.z + settings.projectionOffsetZ
    );
    projectionPlane.renderOrder = 10;
    projectionPlane.visible = true;
    projectionPlane.material.opacity = 0;

    scene.add(projectionPlane);

    // Preload textures for each state
    preloadProjectionTextures();

    // Create countdown intro video for projection
    if (PATHS.video && PATHS.video.countdownIntro) {
      projectionVideo = document.createElement("video");
      projectionVideo.src = PATHS.video.countdownIntro;
      projectionVideo.loop = false;
      projectionVideo.muted = true;
      projectionVideo.playsInline = true;
      projectionVideo.crossOrigin = "anonymous";
      projectionVideo.addEventListener("canplaythrough", () => {
        if (!projectionVideoTexture) {
          projectionVideoTexture = new THREE.VideoTexture(projectionVideo);
          projectionVideoTexture.colorSpace = THREE.SRGBColorSpace;
        }
      }, { once: true });
      // When video ends, transition to PLAYING
      // Use timeupdate to detect near-end and avoid browser delay on "ended" event
      projectionVideo.addEventListener("timeupdate", () => {
        if (STATE.gameState === "STARTING" && projectionVideo.duration - projectionVideo.currentTime < 1) {
          setGameState("PLAYING");
        }
      });
      projectionVideo.addEventListener("ended", () => {
        if (STATE.gameState === "STARTING") {
          setGameState("PLAYING");
        }
      });
      projectionVideo.load();
    }

    // Create game animation video (plays when returning to PRE_GAME after a game)
    if (PATHS.video && PATHS.video.gameAnimation) {
      gameAnimationVideo = document.createElement("video");
      gameAnimationVideo.src = PATHS.video.gameAnimation;
      gameAnimationVideo.loop = false;
      gameAnimationVideo.muted = true;
      gameAnimationVideo.playsInline = true;
      gameAnimationVideo.crossOrigin = "anonymous";
      gameAnimationVideo.addEventListener("canplaythrough", () => {
        if (!gameAnimationVideoTexture) {
          gameAnimationVideoTexture = new THREE.VideoTexture(gameAnimationVideo);
          gameAnimationVideoTexture.colorSpace = THREE.SRGBColorSpace;
        }
      }, { once: true });
      gameAnimationVideo.load();
    }
  }

  function preloadProjectionTextures() {
    const textureLoader = new THREE.TextureLoader();
    const imagePath = "assets/images/";

    const stateImages = {
      PRE_GAME: settings.preGameImage,
      STARTING: settings.startingImage || settings.preGameImage,
      PLAYING: settings.playingImage,
      GAME_OVER: settings.gameOverImage,
    };

    for (const [state, imageName] of Object.entries(stateImages)) {
      if (imageName && imageName.trim() !== "") {
        textureLoader.load(
          imagePath + imageName,
          (texture) => {
            texture.colorSpace = THREE.SRGBColorSpace;
            projectionTextures[state] = texture;
            // If this is the current state, update the projection
            if (STATE.gameState === state) {
              updateProjectionForState(state);
            }
          },
          undefined,
          (err) => {
            console.warn(`Failed to load projection image for ${state}:`, imageName, err);
          }
        );
      }
    }
  }

  function updateProjectionForState(state) {
    if (!projectionPlane) {
      return;
    }

    // Use video for STARTING state (intro plays until video ends)
    const useVideo = state === "STARTING" && projectionVideoTexture;

    if (useVideo) {
      if (projectionPlane.material.map !== projectionVideoTexture) {
        projectionPlane.material.map = projectionVideoTexture;
        projectionPlane.material.needsUpdate = true;
      }
      projectionPlane.material.opacity = settings.projectionOpacity;
      projectionVideo.play().catch(() => {});

      // Use actual video dimensions for aspect ratio
      const vw = projectionVideo.videoWidth;
      const vh = projectionVideo.videoHeight;
      const aspect = (vw && vh) ? vw / vh : 1;
      projectionPlane.scale.set(
        settings.projectionScale * aspect,
        settings.projectionScale,
        1
      );
    } else {
      // Pause video when leaving PRE_GAME/STARTING
      if (projectionVideo) {
        projectionVideo.pause();
      }

      const stateImageSettings = {
        PRE_GAME: settings.preGameImage,
        STARTING: settings.startingImage || settings.preGameImage,
        PLAYING: settings.playingImage,
        GAME_OVER: settings.gameOverImage,
      };

      const imageName = stateImageSettings[state];
      let texture = projectionTextures[state];
      if (!texture && state === "STARTING") {
        texture = projectionTextures["PRE_GAME"];
      }

      if (texture) {
        if (projectionPlane.material.map !== texture) {
          projectionPlane.material.map = texture;
          projectionPlane.material.needsUpdate = true;
        }
        projectionPlane.material.opacity = settings.projectionOpacity;

        const img = texture.image;
        if (img && img.width && img.height) {
          const aspect = img.width / img.height;
          projectionPlane.scale.set(
            settings.projectionScale * aspect,
            settings.projectionScale,
            1
          );
        } else {
          projectionPlane.scale.setScalar(settings.projectionScale);
        }
      } else {
        // Hide by setting opacity to 0 instead of toggling visible (avoids shader recompilation)
        projectionPlane.material.opacity = 0;
      }
    }

    // Update projection position
    projectionPlane.position.x = STATE.levelCenter.x + settings.projectionOffsetX;
    projectionPlane.position.y = STATE.levelCenter.y + settings.projectionOffsetY;
    projectionPlane.position.z = STATE.levelCenter.z + settings.projectionOffsetZ;
  }

  function loadProjectionImage(state, imageName) {
    if (!imageName || imageName.trim() === "") {
      projectionTextures[state] = null;
      if (STATE.gameState === state) {
        updateProjectionForState(state);
      }
      return;
    }

    const textureLoader = new THREE.TextureLoader();
    textureLoader.load(
      "assets/images/" + imageName,
      (texture) => {
        texture.colorSpace = THREE.SRGBColorSpace;
        projectionTextures[state] = texture;
        if (STATE.gameState === state) {
          updateProjectionForState(state);
        }
      },
      undefined,
      (err) => {
        console.warn(`Failed to load projection image for ${state}:`, imageName);
      }
    );
  }

  // Projection pump effect for countdown beats
  let projectionPumpTime = 0;
  const PROJECTION_PUMP_DURATION = 0.3; // seconds for pump to decay
  const PROJECTION_PUMP_STRENGTH = 0.15; // scale boost (fraction of projectionScale)

  function triggerProjectionPump() {
    projectionPumpTime = PROJECTION_PUMP_DURATION;
  }

  function updateProjectionPump(dt) {
    if (projectionPumpTime <= 0 || !projectionPlane || !projectionPlane.visible) return;

    projectionPumpTime = Math.max(0, projectionPumpTime - dt);
    const t = projectionPumpTime / PROJECTION_PUMP_DURATION; // 1 -> 0
    const ease = t * t; // quadratic ease-out (fast attack, smooth decay)
    const boost = 1 + PROJECTION_PUMP_STRENGTH * ease;

    const baseScale = settings.projectionScale;
    const texture = projectionPlane.material.map;
    const img = texture && texture.image;
    const aspect = (img && img.width && img.height) ? img.width / img.height : 1;

    projectionPlane.scale.set(
      baseScale * aspect * boost,
      baseScale * boost,
      1
    );
  }

  function updateCountdown(dt) {
    if (STATE.gameState !== "STARTING") return;

    STATE.countdownTimer += dt;

    if (STATE.countdownTimer >= 1.0) {
      STATE.countdownTimer -= 1.0;
      STATE.countdownValue--;

      if (STATE.countdownValue >= 0) {
        // Show 3, 2, 1, GO!
        applyStartingText();
        updateGlassCanvas();
        triggerProjectionPump();
      } else {
        // Countdown finished, start playing
        setGameState("PLAYING");
      }
    }
  }

  function checkHighScore(score) {
    const highScores = loadHighScores();
    for (let i = 0; i < highScores.length; i++) {
      if (score > highScores[i].score) {
        return i; // Return position (0, 1, or 2)
      }
    }
    return -1; // Not a high score
  }

  function startHighScoreEntry(position) {
    STATE.enteringHighScore = true;
    STATE.highScorePosition = 0;
    // Keep previous initials as starting point, sync char index to first initial
    STATE.highScoreCharIndex = Math.max(0, HIGH_SCORE_CHARS.indexOf(STATE.highScoreInitials[0]));
    STATE.newHighScoreRank = position;
    // Set initials color to first player's color
    const chaserColors = [settings.chaser1Color, settings.chaser2Color, settings.chaser3Color, settings.chaser4Color];
    STATE.highScoreInitialsColor = STATE.firstPlayerIndex >= 0 ? chaserColors[STATE.firstPlayerIndex] : null;
    updateHighScoreDisplay();

    // Auto-confirm after 30 seconds
    STATE.highScoreTimeout = setTimeout(() => {
      if (STATE.enteringHighScore) {
        confirmHighScoreEntry();
      }
    }, 30000);
  }

  function updateHighScoreDisplay() {
    // Use configured high score text with template variables
    applyHighScoreText();
    updateGlassCanvas();
  }

  function confirmHighScoreEntry() {
    // Clear auto-confirm timeout if manually confirmed
    if (STATE.highScoreTimeout) {
      clearTimeout(STATE.highScoreTimeout);
      STATE.highScoreTimeout = null;
    }
    // Ensure initials are exactly 3 characters
    const initials = STATE.highScoreInitials.join("").substring(0, 3).padEnd(3, "A");
    const score = STATE.playerScore;
    const position = STATE.newHighScoreRank;

    // Update local cache optimistically
    const highScores = loadHighScores();
    highScores.splice(position, 0, { initials, score });
    if (highScores.length > 10) highScores.length = 10;
    saveHighScores(highScores);

    // Post to server and refresh cache from response
    postHighScore({ score, playerName: initials })
      .then(() => fetchServerHighScores());

    STATE.enteringHighScore = false;

    // Staggered pulse waves from each ready chaser
    const chaserColors = [settings.chaser1Color, settings.chaser2Color, settings.chaser3Color, settings.chaser4Color];
    const readyChasers = chasers.filter(c => c.ready && c.mesh);
    let delay = 0;
    for (const c of readyChasers) {
      const idx = chasers.indexOf(c);
      setTimeout(() => {
        createCaptureEffect(c.mesh.position.clone(), chaserColors[idx] || "#ffffff", null);
        playSFX("capture", idx);
      }, delay);
      delay += 300;
    }

    // Clear glass text and restart after last pulse
    setTimeout(() => {
      settings.glassTextRow1 = "";
      settings.glassTextRow2 = "";
      settings.glassTextRow3 = "";
      settings.glassTextRow4 = "";
      updateGlassCanvas();
      resetGame();
    }, delay + 2000);
  }

  function displayHighScores() {
    // Use configured high score text with template variables
    applyHighScoreText();
    updateGlassCanvas();

    // Start reset timer
    STATE.showingScore = true;
    STATE.scoreDisplayTime = 5;
  }

  // ============================================
  // LIGHTS
  // ============================================

  const ambientLight = new THREE.AmbientLight(settings.ambientColor, settings.ambientIntensity);
  scene.add(ambientLight);

  const directionalLight = new THREE.DirectionalLight(settings.directColor, settings.directIntensity);
  directionalLight.position.set(settings.directPosX, settings.directPosY, settings.directPosZ);
  directionalLight.castShadow = true;
  directionalLight.shadow.mapSize.width = 4096;
  directionalLight.shadow.mapSize.height = 4096;
  directionalLight.shadow.camera.near = 0.1;
  directionalLight.shadow.camera.far = 50;
  directionalLight.shadow.camera.left = -15;
  directionalLight.shadow.camera.right = 15;
  directionalLight.shadow.camera.top = 15;
  directionalLight.shadow.camera.bottom = -15;
  directionalLight.shadow.bias = -0.002;
  directionalLight.shadow.normalBias = 0.05;
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
    perspCamera.position.set(settings.perspPosX + (settings.perspPanX || 0), settings.perspPosY, settings.perspPosZ + (settings.perspPanZ || 0));
    perspCamera.lookAt(levelCenter.x + (settings.perspPanX || 0), levelCenter.y, levelCenter.z + (settings.perspPanZ || 0));

    const frustumSize = horizontalSize * 1.5;
    const orthoDistance = horizontalSize * 1.2;
    const oLeft = aspect >= 1 ? frustumSize * aspect / -2 : frustumSize / -2;
    const oRight = aspect >= 1 ? frustumSize * aspect / 2 : frustumSize / 2;
    const oTop = aspect >= 1 ? frustumSize / 2 : frustumSize / aspect / 2;
    const oBottom = aspect >= 1 ? frustumSize / -2 : frustumSize / aspect / -2;
    orthoCamera = new THREE.OrthographicCamera(oLeft, oRight, oTop, oBottom, 0.1, 5000);
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
      if (glbCam && glbCam.camera.isPerspectiveCamera) {
        // Copy GLB camera settings onto perspCamera so GUI tweaks still work
        const src = glbCam.camera;
        perspCamera.position.copy(src.getWorldPosition(new THREE.Vector3()));
        perspCamera.quaternion.copy(src.getWorldQuaternion(new THREE.Quaternion()));
        perspCamera.fov = src.fov;
        perspCamera.near = src.near;
        perspCamera.far = src.far;
        perspCamera.aspect = window.innerWidth / window.innerHeight;
        perspCamera.updateProjectionMatrix();
        // Update settings to reflect GLB values
        settings.perspFov = src.fov;
        settings.perspNear = src.near;
        settings.perspFar = src.far;
        settings.perspPosX = perspCamera.position.x;
        settings.perspPosY = perspCamera.position.y;
        settings.perspPosZ = perspCamera.position.z;
        camera = perspCamera;
      } else if (glbCam) {
        camera = glbCam.camera;
      }
    }

    // Update selective pixel pass camera
    if (composer && composer.selectivePixelPass) {
      composer.selectivePixelPass.camera = camera;
    }
  }

  // ============================================
  // MOBILE MODE
  // ============================================

  const portraitOverlay = document.getElementById("portrait-overlay");

  // Show portrait overlay immediately on mobile if in portrait mode
  if (portraitOverlay && isMobileDevice() && window.innerHeight > window.innerWidth) {
    portraitOverlay.style.display = "flex";
  }

  function applyMobileMode(enabled) {
    if (enabled) {
      // 1. Snapshot desktop values, then apply mobile overrides
      saveDesktopSettings(settings);
      applyMobileOverrides(settings);

      // 2. Apply runtime effects that need API calls
      // Render scale
      renderer.setPixelRatio(window.devicePixelRatio * settings.renderScale);
      if (composer) {
        composer.setPixelRatio(window.devicePixelRatio * settings.renderScale);
        composer.setSize(window.innerWidth, window.innerHeight);
      }

      // Shadows
      renderer.shadowMap.enabled = false;
      renderer.shadowMap.needsUpdate = true;

      // Post-processing (bloom, color grading)
      updatePostProcessing();

      // Apply actor lights from override
      for (const f of fugitives) { if (f.light) f.light.visible = settings.punctualLights; }
      for (const c of chasers) { if (c.light) c.light.visible = settings.punctualLights; }

      // Apply helicopter from override
      if (helicopter && helicopter.mesh) helicopter.mesh.visible = settings.helicopterEnabled;

      // Chaser speed boost
      for (const c of chasers) c.speed = settings.chaserSpeed;

      // 3. Camera + building + portrait
      if (isFacadeMode) {
        // Facade: top-down orthographic for projection mapping
        settings.cameraType = "orthographic";
        switchCamera("orthographic");

        if (orthoCamera) {
          const aspect = window.innerWidth / window.innerHeight;
          const orthoSize = STATE.horizontalSize * 0.6 * settings.mobileOrthoZoom;
          orthoCamera.left = -orthoSize * aspect;
          orthoCamera.right = orthoSize * aspect;
          orthoCamera.top = orthoSize;
          orthoCamera.bottom = -orthoSize;
          orthoCamera.position.z = STATE.levelCenter.z + settings.mobileOrthoOffsetZ;
          orthoCamera.lookAt(new THREE.Vector3(STATE.levelCenter.x, STATE.levelCenter.y, STATE.levelCenter.z + settings.mobileOrthoOffsetZ));
          orthoCamera.updateProjectionMatrix();
        }
      }
      // Mobile/desktop without facade: keep perspective camera (GLB MainCamera)

      settings.buildingEnabled = false;
      if (buildingPlane) buildingPlane.visible = false;

      // Use device-specific intro image for non-facade mode
      if (!isFacadeMode) {
        settings.preGameImage = isMobileDevice() ? "introMobile.png" : "introDesktop.png";
        loadProjectionImage("PRE_GAME", settings.preGameImage);
      }

      // Portrait check only on actual mobile/touch devices
      if (isMobileDevice()) {
        checkPortraitMode();
      }
    } else {
      // 1. Restore desktop settings
      restoreDesktopSettings(settings);

      // 2. Re-apply restored values to runtime objects
      // Render scale
      renderer.setPixelRatio(window.devicePixelRatio * settings.renderScale);
      if (composer) {
        composer.setPixelRatio(window.devicePixelRatio * settings.renderScale);
        composer.setSize(window.innerWidth, window.innerHeight);
      }

      // Shadows
      renderer.shadowMap.enabled = true;
      renderer.shadowMap.needsUpdate = true;

      // Post-processing
      updatePostProcessing();

      // Restore actor lights
      if (settings.punctualLights) {
        for (const f of fugitives) { if (f.light) f.light.visible = true; }
        for (const c of chasers) { if (c.light) c.light.visible = true; }
      }

      // Restore helicopter visibility (handled by update loop via helicopterEnabled)
      if (helicopter && helicopter.mesh) helicopter.mesh.visible = settings.helicopterEnabled;

      // Restore chaser speed
      for (const c of chasers) c.speed = settings.chaserSpeed;

      // Hide portrait overlay
      if (portraitOverlay) portraitOverlay.style.display = "none";
    }
  }

  function checkPortraitMode() {
    if (!portraitOverlay || !isMobileDevice()) return;

    const isPortrait = window.innerHeight > window.innerWidth;
    portraitOverlay.style.display = isPortrait ? "flex" : "none";
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
      const aspect = width / height;
      if (settings.mobileEnabled && isFacadeMode) {
        // Facade mode: use mobile ortho zoom
        const orthoSize = STATE.horizontalSize * 0.6 * settings.mobileOrthoZoom;
        orthoCamera.left = -orthoSize * aspect;
        orthoCamera.right = orthoSize * aspect;
        orthoCamera.top = orthoSize;
        orthoCamera.bottom = -orthoSize;
      } else {
        const frustumSize = STATE.horizontalSize * 1.5;
        if (aspect >= 1) {
          // Landscape: fixed vertical, expand horizontal
          orthoCamera.left = frustumSize * aspect / -2;
          orthoCamera.right = frustumSize * aspect / 2;
          orthoCamera.top = frustumSize / 2;
          orthoCamera.bottom = frustumSize / -2;
        } else {
          // Portrait/narrow: fixed horizontal, expand vertical
          orthoCamera.left = frustumSize / -2;
          orthoCamera.right = frustumSize / 2;
          orthoCamera.top = frustumSize / aspect / 2;
          orthoCamera.bottom = frustumSize / aspect / -2;
        }
      }
      orthoCamera.updateProjectionMatrix();
    }

    // Resize post-processing
    if (composer) {
      composer.setSize(width, height);
    }

    // Check portrait mode for mobile
    checkPortraitMode();
  }
  window.addEventListener("resize", onResize);
  window.addEventListener("orientationchange", () => {
    // Small delay to let orientation settle
    setTimeout(checkPortraitMode, 100);
  });

  // ============================================
  // GUI
  // ============================================

  function setupGUI() {
    // Single unified GUI
    guiLeft = new GUI({ title: "Jagad Controls" });
    guiLeft.domElement.style.position = "absolute";
    guiLeft.domElement.style.left = "10px";
    guiLeft.domElement.style.top = "0px";

    // Settings controls at the top
    guiLeft.add(settings, "exportSettings").name("💾 Export Settings");
    guiLeft.add(settings, "importSettings").name("📂 Import Settings");
    guiLeft.add({ clearCache: async function() {
      if (confirm("Clear all browser cache, storage, and reload?")) {
        try {
          // Clear Cache Storage
          if ('caches' in window) {
            const cacheNames = await caches.keys();
            await Promise.all(cacheNames.map(name => caches.delete(name)));
          }
          // Unregister service workers
          if ('serviceWorker' in navigator) {
            const registrations = await navigator.serviceWorker.getRegistrations();
            await Promise.all(registrations.map(reg => reg.unregister()));
          }
          // Force reload bypassing cache
          window.location.reload(true);
        } catch (e) {
          console.error("Failed to clear cache:", e);
          window.location.reload(true);
        }
      }
    }}, "clearCache").name("🔄 Clear Cache");
    // ==================== GAME ====================
    const gameFolder = guiLeft.addFolder("🎮 Game");
    gameFolder.add(settings, "fugitiveSpeed", 0.1, 4, 0.1).name("Fugitive Speed").onChange((v) => {
      for (const f of fugitives) f.speed = v;
    });
    gameFolder.add(settings, "chaserSpeed", 0.1, 4, 0.1).name("Chaser Speed").onChange((v) => {
      for (const c of chasers) c.speed = v;
    });
    gameFolder.add(settings, "fugitiveIntelligence", 0.5, 1, 0.05).name("Fugitive AI");
    const difficultyFolder = gameFolder.addFolder("Multi-Player Difficulty");
    difficultyFolder.add(settings, "multiPlayerThreshold", 2, 4, 1).name("Player Threshold");
    difficultyFolder.add(settings, "multiPlayerFugitiveIntelligence", 0.5, 1, 0.05).name("Fugitive AI Override");
    difficultyFolder.add(settings, "multiPlayerChaserSpeedPenalty", 0, 0.5, 0.05).name("Chaser Speed Penalty");
    difficultyFolder.close();
    addBoostGUI(gameFolder, settings);

    // ==================== MOBILE ====================
    const mobileFolder = guiLeft.addFolder("📱 Mobile");
    mobileFolder.add(settings, "mobileEnabled").name("Enable Mobile Mode").onChange((v) => {
      applyMobileMode(v);
    });
    mobileFolder.add(settings, "mobileOrthoZoom", 0.1, 1, 0.1).name("Ortho Zoom").onChange((v) => {
      if (settings.mobileEnabled && orthoCamera) {
        const aspect = window.innerWidth / window.innerHeight;
        const orthoSize = STATE.horizontalSize * 0.6 * v;
        orthoCamera.left = -orthoSize * aspect;
        orthoCamera.right = orthoSize * aspect;
        orthoCamera.top = orthoSize;
        orthoCamera.bottom = -orthoSize;
        orthoCamera.updateProjectionMatrix();
      }
    });
    mobileFolder.add(settings, "mobileOrthoOffsetZ", -10, 10, 0.1).name("View Z Offset").onChange((v) => {
      if (settings.mobileEnabled && orthoCamera) {
        orthoCamera.position.z = STATE.levelCenter.z + v;
        orthoCamera.lookAt(new THREE.Vector3(STATE.levelCenter.x, STATE.levelCenter.y, STATE.levelCenter.z + v));
      }
    });
    mobileFolder.add(settings, "mobileSvgOffset", 0, 200, 1).name("SVG Offset (px)");
    mobileFolder.add(settings, "mobileBoardScale", 0.5, 2, 0.05).name("Board Scale");

    // ---- Performance subfolder (per-feature mobile toggles) ----
    const perfFolder = mobileFolder.addFolder("Performance");

    perfFolder.add(settings, "renderScale", 0.5, 2, 0.25).name("Render Scale").listen().onChange((v) => {
      const dpr = window.devicePixelRatio;
      renderer.setPixelRatio(dpr * v);
      if (composer) {
        composer.setPixelRatio(dpr * v);
        composer.setSize(window.innerWidth, window.innerHeight);
      }
    });

    perfFolder.add(settings, "bloomEnabled").name("Bloom").listen().onChange(() => {
      updatePostProcessing();
    });

    perfFolder.add(settings, "punctualLights").name("Actor Lights").listen().onChange((v) => {
      for (const f of fugitives) { if (f.light) f.light.visible = v; }
      for (const c of chasers) { if (c.light) c.light.visible = v; }
    });

    perfFolder.add(settings, "colorGradingEnabled").name("Color Grading").listen().onChange(() => {
      updatePostProcessing();
    });

    perfFolder.add(settings, "helicopterEnabled").name("Helicopter").listen().onChange((v) => {
      if (helicopter && helicopter.mesh) helicopter.mesh.visible = v;
    });

    perfFolder.add(settings, "pulseWaveParticles").name("Pulse Particles").listen();


    perfFolder.add(settings, "carAudioReactive").name("Car BPM Pulse").listen();

    perfFolder.add(settings, "textBPMPulse").name("Text BPM Pulse").listen();

    perfFolder.add(settings, "chaserSpeed", 0.5, 3, 0.1).name("Chaser Speed").listen().onChange((v) => {
      for (const c of chasers) c.speed = v;
    });

    perfFolder.close();

    mobileFolder.close();

    // ==================== STATES (under Game) ====================
    const statesFolder = gameFolder.addFolder("States");

    // Current state display (read-only)
    const stateDisplay = { current: STATE.gameState };
    const stateController = statesFolder.add(stateDisplay, "current", ["PRE_GAME", "STARTING", "PLAYING", "GAME_OVER"]).name("Current State").listen();
    stateController.domElement.style.pointerEvents = "none"; // Make read-only
    statesFolder.add(settings, "countdownDuration", 1, 30, 1).name("Countdown (sec)");

    // Pre-game settings (text + image)
    const preGameFolder = statesFolder.addFolder("Pre-Game");
    const updatePreGameText = () => {
      if (STATE.gameState === "PRE_GAME") {
        settings.glassTextRow1 = settings.preGameTextRow1;
        settings.glassTextRow2 = settings.preGameTextRow2;
        settings.glassTextRow3 = settings.preGameTextRow3;
        settings.glassTextRow4 = settings.preGameTextRow4;
        updateGlassCanvas();
      }
    };
    preGameFolder.add(settings, "preGameTextRow1").name("Text Row 1").onChange(updatePreGameText);
    preGameFolder.add(settings, "preGameTextRow2").name("Text Row 2").onChange(updatePreGameText);
    preGameFolder.add(settings, "preGameTextRow3").name("Text Row 3").onChange(updatePreGameText);
    preGameFolder.add(settings, "preGameTextRow4").name("Text Row 4").onChange(updatePreGameText);
    preGameFolder.add(settings, "preGameImage").name("Image").onChange((v) => {
      loadProjectionImage("PRE_GAME", v);
    });
    preGameFolder.close();

    // Starting settings (text supports ${countdown})
    const startingFolder = statesFolder.addFolder("Starting");
    const updateStartingText = () => {
      if (STATE.gameState === "STARTING") {
        applyStartingText();
        updateGlassCanvas();
      }
    };
    startingFolder.add(settings, "startingTextRow1").name("Text Row 1").onChange(updateStartingText);
    startingFolder.add(settings, "startingTextRow2").name("Text Row 2").onChange(updateStartingText);
    startingFolder.add(settings, "startingTextRow3").name("Text Row 3").onChange(updateStartingText);
    startingFolder.add(settings, "startingTextRow4").name("Text Row 4").onChange(updateStartingText);
    startingFolder.add(settings, "startingImage").name("Image").onChange((v) => {
      loadProjectionImage("STARTING", v);
    });
    startingFolder.close();

    // Playing settings (text + image)
    const playingFolder = statesFolder.addFolder("Playing");
    const updatePlayingText = () => {
      if (STATE.gameState === "PLAYING") {
        applyPlayingText();
        updateGlassCanvas();
      }
    };
    playingFolder.add(settings, "playingTextRow1").name("Text Row 1").onChange(updatePlayingText);
    playingFolder.add(settings, "playingTextRow2").name("Text Row 2").onChange(updatePlayingText);
    playingFolder.add(settings, "playingTextRow3").name("Text Row 3").onChange(updatePlayingText);
    playingFolder.add(settings, "playingTextRow4").name("Text Row 4").onChange(updatePlayingText);
    playingFolder.add(settings, "playingImage").name("Image").onChange((v) => {
      loadProjectionImage("PLAYING", v);
    });
    playingFolder.close();

    // High Score entry settings
    const highScoreFolder = statesFolder.addFolder("High Score");
    const updateHighScoreTextGUI = () => {
      if (STATE.gameState === "GAME_OVER" && STATE.enteringHighScore) {
        applyHighScoreText();
        updateGlassCanvas();
      }
    };
    highScoreFolder.add(settings, "highScoreTextRow1").name("Text Row 1").onChange(updateHighScoreTextGUI);
    highScoreFolder.add(settings, "highScoreTextRow2").name("Text Row 2").onChange(updateHighScoreTextGUI);
    highScoreFolder.add(settings, "highScoreTextRow3").name("Text Row 3").onChange(updateHighScoreTextGUI);
    highScoreFolder.add(settings, "highScoreTextRow4").name("Text Row 4").onChange(updateHighScoreTextGUI);
    highScoreFolder.close();

    // Game Over settings (no high score)
    const gameOverFolder = statesFolder.addFolder("Game Over");
    const updateGameOverText = () => {
      if (STATE.gameState === "GAME_OVER" && !STATE.enteringHighScore) {
        applyGameOverText();
        updateGlassCanvas();
      }
    };
    gameOverFolder.add(settings, "gameOverTextRow1").name("Text Row 1").onChange(updateGameOverText);
    gameOverFolder.add(settings, "gameOverTextRow2").name("Text Row 2").onChange(updateGameOverText);
    gameOverFolder.add(settings, "gameOverTextRow3").name("Text Row 3").onChange(updateGameOverText);
    gameOverFolder.add(settings, "gameOverTextRow4").name("Text Row 4").onChange(updateGameOverText);
    gameOverFolder.add(settings, "gameOverImage").name("Image").onChange((v) => {
      loadProjectionImage("GAME_OVER", v);
    });
    gameOverFolder.close();

    // High scores display
    const highScoresFolder = statesFolder.addFolder("High Scores");
    const highScores = loadHighScores();
    const highScoreDisplay = {
      score1: `#1: ${highScores[0].initials} - ${highScores[0].score}`,
      score2: `#2: ${highScores[1].initials} - ${highScores[1].score}`,
      score3: `#3: ${highScores[2].initials} - ${highScores[2].score}`,
    };
    highScoresFolder.add(highScoreDisplay, "score1").name("").listen();
    highScoresFolder.add(highScoreDisplay, "score2").name("").listen();
    highScoresFolder.add(highScoreDisplay, "score3").name("").listen();
    highScoresFolder.add({ reset: function() {
      if (confirm("Reset high scores to defaults?")) {
        saveHighScores([
          { initials: "AAA", score: 999 },
          { initials: "BBB", score: 500 },
          { initials: "CCC", score: 100 }
        ]);
        const hs = loadHighScores();
        highScoreDisplay.score1 = `#1: ${hs[0].initials} - ${hs[0].score}`;
        highScoreDisplay.score2 = `#2: ${hs[1].initials} - ${hs[1].score}`;
        highScoreDisplay.score3 = `#3: ${hs[2].initials} - ${hs[2].score}`;
      }
    }}, "reset").name("Reset Scores");
    highScoresFolder.close();

    statesFolder.close();
    gameFolder.close();

    // Update state display - called when state/scores change (not on interval)
    STATE.updateStateDisplay = () => {
      stateDisplay.current = STATE.gameState;
      const hs = settings.highScores;
      highScoreDisplay.score1 = `#1: ${hs[0].initials} - ${hs[0].score}`;
      highScoreDisplay.score2 = `#2: ${hs[1].initials} - ${hs[1].score}`;
      highScoreDisplay.score3 = `#3: ${hs[2].initials} - ${hs[2].score}`;
    };
    STATE.updateStateDisplay(); // Initial update

    // ==================== PROJECTION ====================
    const projectionFolder = guiLeft.addFolder("🎥 Projection");
    projectionFolder.add(settings, "projectionOpacity", 0, 1, 0.05).name("Opacity").onChange(() => {
      updateProjectionForState(STATE.gameState);
    });
    projectionFolder.add(settings, "projectionScale", 0.1, 5, 0.01).name("Scale").onChange(() => {
      updateProjectionForState(STATE.gameState);
    });
    projectionFolder.add(settings, "projectionOffsetX", -10, 10, 0.1).name("Offset X").onChange(() => {
      updateProjectionForState(STATE.gameState);
    });
    projectionFolder.add(settings, "projectionOffsetY", -1, 1, 0.01).name("Offset Y").onChange(() => {
      updateProjectionForState(STATE.gameState);
    });
    projectionFolder.add(settings, "projectionOffsetZ", -10, 10, 0.1).name("Offset Z").onChange(() => {
      updateProjectionForState(STATE.gameState);
    });
    projectionFolder.close();

    // ==================== ACTORS ====================
    const actorsFolder = guiLeft.addFolder("👥 Actors");

    const fugitiveFolder = actorsFolder.addFolder("Fugitives");
    fugitiveFolder.addColor(settings, "fugitiveColor").name("Light Color").onChange(updateFugitiveLights);
    fugitiveFolder.add(settings, "fugitiveLightIntensity", 0, 50, 0.1).name("Light Intensity").onChange(updateFugitiveLights);
    fugitiveFolder.add(settings, "faceSwapDuration", 0, 120, 1).name("Face Swap (sec)");

    const billboardFolder = fugitiveFolder.addFolder("Face Billboards");
    billboardFolder.add(settings, "wireCubeSize", 0.2, 4, 0.1).name("Billboard Size").onChange(updateWireBillboards);
    billboardFolder.add(settings, "billboardBrightness", 0, 5, 0.1).name("Brightness").onChange((v) => {
      for (const wire of fugitiveWires) {
        if (wire.billboard && wire.billboard.material) {
          wire.billboard.material.color.setRGB(v, v, v);
        }
      }
    });
    billboardFolder.add(settings, "billboardContrast", 0.5, 3, 0.1).name("Contrast").onChange((v) => {
      for (const wire of fugitiveWires) {
        if (wire.billboard && wire.billboard.material && wire.billboard.material.userData) {
          wire.billboard.material.userData.contrast = v;
          wire.billboard.material.needsUpdate = true;
        }
      }
    });
    billboardFolder.add(settings, "billboardCenterPull", 0, 1, 0.05).name("Center Pull");
    billboardFolder.add(settings, "billboardLightIntensity", 0, 20, 0.5).name("Light Intensity");
    billboardFolder.add(settings, "billboardLightDistance", 0, 10, 0.5).name("Light Distance");
    billboardFolder.close();

    fugitiveFolder.close();

    const chaserFolder = actorsFolder.addFolder("Chasers");
    chaserFolder.addColor(settings, "chaser1Color").name("Chaser 1 Color").onChange(updateChaserLights);
    chaserFolder.addColor(settings, "chaser2Color").name("Chaser 2 Color").onChange(updateChaserLights);
    chaserFolder.addColor(settings, "chaser3Color").name("Chaser 3 Color").onChange(updateChaserLights);
    chaserFolder.addColor(settings, "chaser4Color").name("Chaser 4 Color").onChange(updateChaserLights);
    chaserFolder.add(settings, "chaserHeightOffset", -0.5, 0.5, 0.01).name("Height Offset");
    chaserFolder.close();

    actorsFolder.close();

    // ==================== TEXT ====================
    const textFolder = guiLeft.addFolder("📝 Text");
    textFolder.addColor(settings, "glassColor").name("Glass Color").onChange(() => updateGlassColor());
    textFolder.add(settings, "glassEnabled").name("Glass Enabled").onChange((v) => {
      for (const mesh of glassMeshes) mesh.visible = v;
    });
    textFolder.add(settings, "glassTextEnabled").name("Show Text").onChange(() => updateGlassCanvas());
    textFolder.add(settings, "glassOpacity", 0, 1, 0.05).name("Background Opacity").onChange(() => updateGlassCanvas());
    if (settings.glassMaterialOpacity === undefined) settings.glassMaterialOpacity = 1.0;
    textFolder.add(settings, "glassMaterialOpacity", 0, 1, 0.05).name("Glass Opacity").onChange(() => updateGlassMaterialOpacity());
    textFolder.add(settings, "glassPosX", -10, 10, 0.01).name("Glass 3D X").onChange(() => updateGlassPosition());
    textFolder.add(settings, "glassPosY", -10, 10, 0.01).name("Glass 3D Y").onChange(() => updateGlassPosition());
    textFolder.add(settings, "glassPosZ", -10, 10, 0.01).name("Glass 3D Z").onChange(() => updateGlassPosition());
    textFolder.add(settings, "glassRotX", -90, 90, 1).name("Glass Rot X").onChange(() => updateGlassPosition());
    textFolder.add(settings, "glassTextFont", ["BankGothic", "BankGothic Md BT", "Bank Gothic", "Arial", "Impact", "Georgia"]).name("Font").onChange(() => updateGlassCanvas());
    textFolder.add(settings, "glassTextFontSize", 20, 200, 5).name("Font Size").onChange(() => updateGlassCanvas());
    textFolder.add(settings, "glassTextLineHeight", 1, 5, 0.1).name("Line Height").onChange(() => updateGlassCanvas());
    textFolder.addColor(settings, "glassTextColor").name("Color").onChange(() => updateGlassCanvas());
    textFolder.add(settings, "glassTextBrightness", 1, 10, 0.5).name("Brightness").onChange(() => updateGlassBrightness());
    textFolder.add(settings, "glassTextAlign", ["left", "center", "right"]).name("Align").onChange(() => updateGlassCanvas());
    textFolder.add(settings, "glassTextOffsetX", -500, 500, 0.1).name("Offset X").onChange(() => updateGlassCanvas());
    textFolder.add(settings, "glassTextOffsetY", -500, 500, 0.1).name("Offset Y").onChange(() => updateGlassCanvas());
    textFolder.add(settings, "glassTextLetterSpacing", -20, 50, 1).name("Letter Spacing").onChange(() => updateGlassCanvas());
    textFolder.add(settings, "glassTextMonospace").name("Monospace").onChange(() => updateGlassCanvas());
    textFolder.add(settings, "glassTextCharWidth", 20, 200, 1).name("Char Width").onChange(() => updateGlassCanvas());
    textFolder.add(settings, "glassTextShuffle").name("Shuffle Effect");
    textFolder.add(settings, "glassTextShuffleSpeed", 0.1, 2, 0.1).name("Shuffle Speed");
    textFolder.add(settings, "glassTextShuffleChars").name("Shuffle Chars");
    textFolder.add(settings, "glassTextShuffleCharDelay", 0, 200, 5).name("Char Delay (ms)");
    textFolder.close();

    // ==================== ADDONS ====================
    const addonsFolder = guiLeft.addFolder("🧩 Addons");

    // Headlights (chaser spotlights)
    const headlightsFolder = addonsFolder.addFolder("Headlights");
    headlightsFolder.add(settings, "chaserLightIntensity", 0, 500, 1).name("Intensity").onChange(updateChaserLights);
    headlightsFolder.add(settings, "chaserLightDistance", 1, 100, 1).name("Distance").onChange(updateChaserLights);
    headlightsFolder.add(settings, "chaserLightAngle", 1, 90, 1).name("Angle (deg)").onChange(updateChaserLights);
    headlightsFolder.add(settings, "chaserLightPenumbra", 0, 1, 0.05).name("Penumbra").onChange(updateChaserLights);
    headlightsFolder.add(settings, "chaserLightHeight", -1, 1, 0.01).name("Height (Y)").onChange(updateChaserLights);
    headlightsFolder.add(settings, "chaserLightOffset", -1, 1, 0.01).name("Offset (Z)").onChange(updateChaserLights);
    if (settings.chaserLightOffsetX === undefined) settings.chaserLightOffsetX = 0;
    headlightsFolder.add(settings, "chaserLightOffsetX", -1, 1, 0.01).name("Offset (X)").onChange(updateChaserLights);
    if (settings.chaserLightTargetX === undefined) settings.chaserLightTargetX = 0;
    if (settings.chaserLightTargetY === undefined) settings.chaserLightTargetY = 0;
    if (settings.chaserLightTargetZ === undefined) settings.chaserLightTargetZ = -5;
    headlightsFolder.add(settings, "chaserLightTargetX", -10, 10, 0.1).name("Aim X").onChange(updateChaserLights);
    headlightsFolder.add(settings, "chaserLightTargetY", -10, 10, 0.1).name("Aim Y").onChange(updateChaserLights);
    headlightsFolder.add(settings, "chaserLightTargetZ", -10, 10, 0.1).name("Aim Z").onChange(updateChaserLights);
    headlightsFolder.add({ debug: false }, "debug").name("Show Helpers").onChange((v) => {
      // Remove existing helpers
      for (const h of chaserLightHelpers) {
        scene.remove(h);
        h.dispose();
      }
      chaserLightHelpers = [];
      if (v) {
        for (const c of chasers) {
          if (c.light) {
            const helper = new THREE.SpotLightHelper(c.light);
            scene.add(helper);
            chaserLightHelpers.push(helper);
          }
        }
      }
    });
    headlightsFolder.close();

    // Glass Overlay (video background)
    const windowOverlayFolder = addonsFolder.addFolder("Glass Overlay");
    windowOverlayFolder.add(settings, "glassVideoEnabled").name("Enabled").onChange((v) => {
      if (glassVideo) {
        if (v) {
          glassVideo.play().catch(() => {});
        } else {
          glassVideo.pause();
        }
      }
      updateGlassCanvas();
    });
    windowOverlayFolder.add(settings, "glassVideoOpacity", 0, 1, 0.05).name("Opacity");
    windowOverlayFolder.add(settings, "glassVideoBrightness", 0, 2, 0.05).name("Brightness");
    windowOverlayFolder.close();

    // Helicopter
    const helicopterFolder = addonsFolder.addFolder("Helicopter");
    helicopterFolder.add(settings, "helicopterEnabled").name("Enabled");
    helicopterFolder.addColor(settings, "helicopterColor").name("Color").onChange(() => updateHelicopterColor());
    helicopterFolder.add(settings, "helicopterBrightness", 0, 5, 0.1).name("Brightness").onChange(() => updateHelicopterColor());
    helicopterFolder.add(settings, "helicopterHeight", 2, 20, 0.5).name("Fly Height");
    helicopterFolder.add(settings, "helicopterSpeed", 0.1, 2, 0.1).name("Drift Speed");
    helicopterFolder.add(settings, "helicopterRadius", 2, 15, 0.5).name("Drift Range");
    helicopterFolder.add(settings, "helicopterScale", 0.1, 2, 0.1).name("Scale").onChange(() => updateHelicopterScale());
    helicopterFolder.add(settings, "helicopterLightIntensity", 0, 2000, 10).name("Spotlight Intensity");
    helicopterFolder.addColor(settings, "helicopterLightColor").name("Light Color");
    helicopterFolder.add(settings, "helicopterLightAngle", 1, 60, 1).name("Spotlight Angle");
    if (settings.helicopterLightDistance === undefined) settings.helicopterLightDistance = 50;
    helicopterFolder.add(settings, "helicopterLightDistance", 10, 200, 5).name("Spotlight Distance");
    if (settings.helicopterLightOffsetX === undefined) settings.helicopterLightOffsetX = 0;
    if (settings.helicopterLightOffsetY === undefined) settings.helicopterLightOffsetY = 0;
    if (settings.helicopterLightOffsetZ === undefined) settings.helicopterLightOffsetZ = 0;
    helicopterFolder.add(settings, "helicopterLightOffsetX", -5, 5, 0.1).name("Light X");
    helicopterFolder.add(settings, "helicopterLightOffsetY", -5, 5, 0.1).name("Light Y");
    helicopterFolder.add(settings, "helicopterLightOffsetZ", -5, 5, 0.1).name("Light Z");
    helicopterFolder.add({ debug: false }, "debug").name("Show Light Helper").onChange((v) => {
      if (helicopterLightHelper) {
        scene.remove(helicopterLightHelper);
        helicopterLightHelper.dispose();
        helicopterLightHelper = null;
      }
      if (v && helicopter && helicopter.light) {
        helicopterLightHelper = new THREE.SpotLightHelper(helicopter.light);
        scene.add(helicopterLightHelper);
      }
    });
    helicopterFolder.add(settings, "helicopterSearchlightSway", 0, 5, 0.1).name("Searchlight Sway");
    helicopterFolder.add(settings, "helicopterSearchlightSpeed", 0.1, 2, 0.1).name("Sway Speed");
    helicopterFolder.add(settings, "helicopterVolumetric").name("Show Light Cone");
    helicopterFolder.add(settings, "helicopterVolumetricOpacity", 0, 1, 0.01).name("Cone Opacity").onChange((v) => {
      if (helicopter && helicopter.lightCone && helicopter.lightCone.userData.layers) {
        helicopter.lightCone.userData.layers.forEach((layer, i) => {
          layer.material.opacity = v * (1 - i * 0.15);
        });
      }
    });
    helicopterFolder.add(settings, "helicopterConeOffsetY", 0, 3, 0.1).name("Cone Y Offset").onChange(rebuildHelicopterCone);
    helicopterFolder.add(settings, "helicopterConeHeight", 1, 40, 0.5).name("Cone Height").onChange(rebuildHelicopterCone);
    helicopterFolder.add(settings, "helicopterConeTopRadius", 0, 2, 0.05).name("Cone Top Radius").onChange(rebuildHelicopterCone);
    helicopterFolder.add(settings, "helicopterConeBottomRadius", 0.5, 10, 0.5).name("Cone Bottom Radius").onChange(rebuildHelicopterCone);
    // Boundary limits
    const boundsFolder = helicopterFolder.addFolder("Bounds");
    boundsFolder.add(settings, "helicopterBoundsMinX", -15, 15, 0.1).name("Min X").onChange(updateHelicopterBoundsHelper);
    boundsFolder.add(settings, "helicopterBoundsMaxX", -15, 15, 0.1).name("Max X").onChange(updateHelicopterBoundsHelper);
    boundsFolder.add(settings, "helicopterBoundsMinZ", -15, 15, 0.1).name("Min Z").onChange(updateHelicopterBoundsHelper);
    boundsFolder.add(settings, "helicopterBoundsMaxZ", -15, 15, 0.1).name("Max Z").onChange(updateHelicopterBoundsHelper);
    boundsFolder.add(settings, "helicopterShowBounds").name("Show Bounds").onChange((v) => {
      if (!helicopterBoundsHelper) updateHelicopterBoundsHelper();
      if (helicopterBoundsHelper) helicopterBoundsHelper.visible = v;
    });
    boundsFolder.close();
    helicopterFolder.close();

    // Searchlights
    const searchlightsFolder = addonsFolder.addFolder("Searchlights");
    searchlightsFolder.add(settings, "searchlightsEnabled").name("Enabled");
    searchlightsFolder.add(settings, "searchlightIntensity", 0, 1000, 1).name("Intensity");
    searchlightsFolder.addColor(settings, "searchlightColor").name("Color");
    searchlightsFolder.add(settings, "searchlightAngle", 5, 60, 1).name("Angle (deg)");
    searchlightsFolder.add(settings, "searchlightDistance", 5, 50, 1).name("Distance");
    searchlightsFolder.add(settings, "searchlightPenumbra", 0, 1, 0.05).name("Penumbra");
    searchlightsFolder.add(settings, "searchlightHeight", 3, 30, 0.5).name("Height");
    searchlightsFolder.add(settings, "searchlightSpeed", 0.05, 1, 0.05).name("Speed");
    searchlightsFolder.add(settings, "searchlightSway", 1, 15, 0.5).name("Sway Range");
    searchlightsFolder.add({ debug: false }, "debug").name("Show Helpers").onChange(toggleSearchlightHelpers);
    searchlightsFolder.close();

    // Pulse Wave (capture effect)
    const pulseWaveFolder = addonsFolder.addFolder("Pulse Wave");
    if (settings.pulseWaveEnabled === undefined) settings.pulseWaveEnabled = true;
    if (settings.pulseWaveSpeed === undefined) settings.pulseWaveSpeed = 3.5;
    if (settings.pulseWaveWidth === undefined) settings.pulseWaveWidth = 1.5;
    if (settings.pulseWaveDuration === undefined) settings.pulseWaveDuration = 5.0;
    if (settings.pulseWaveIntensity === undefined) settings.pulseWaveIntensity = 0.8;
    if (settings.pulseWaveTubeHeight === undefined) settings.pulseWaveTubeHeight = 0.12;
    if (settings.pulseWaveEasing === undefined) settings.pulseWaveEasing = "easeOut";
    if (settings.pulseWaveGlow === undefined) settings.pulseWaveGlow = 3.0;
    if (settings.pulseWaveParticles === undefined) settings.pulseWaveParticles = true;
    if (settings.pulseWaveFlash === undefined) settings.pulseWaveFlash = true;
    pulseWaveFolder.add(settings, "pulseWaveEnabled").name("Enabled");
    pulseWaveFolder.add(settings, "pulseWaveSpeed", 1, 20, 0.5).name("Speed");
    pulseWaveFolder.add(settings, "pulseWaveWidth", 0.5, 5, 0.1).name("Wave Width");
    pulseWaveFolder.add(settings, "pulseWaveDuration", 1, 10, 0.5).name("Duration");
    pulseWaveFolder.add(settings, "pulseWaveIntensity", 0.1, 2, 0.1).name("Intensity");
    pulseWaveFolder.add(settings, "pulseWaveTubeHeight", 0.05, 0.5, 0.01).name("Tube Height");
    pulseWaveFolder.add(settings, "pulseWaveGlow", 1, 10, 0.5).name("Glow");
    pulseWaveFolder.add(settings, "pulseWaveEasing", ["linear", "easeOut", "easeIn", "easeInOut"]).name("Easing");
    pulseWaveFolder.add(settings, "pulseWaveParticles").name("Particles");
    pulseWaveFolder.add(settings, "pulseWaveFlash").name("Flash");
    pulseWaveFolder.close();

    // Building Plane
    const buildingPlaneFolderGUI = addonsFolder.addFolder("Building Plane");
    buildingPlaneFolderGUI.add(settings, "buildingEnabled").name("Enabled").onChange((v) => {
      if (buildingPlane) buildingPlane.visible = v;
    });
    buildingPlaneFolderGUI.add(settings, "buildingOpacity", 0, 1, 0.05).name("Opacity").onChange((v) => {
      if (buildingPlane && buildingPlane.material) {
        buildingPlane.material.opacity = v;
      }
    });
    buildingPlaneFolderGUI.add(settings, "buildingOffsetX", -2, 2, 0.01).name("Offset X").onChange(() => {
      if (buildingPlane) {
        buildingPlane.position.x = STATE.levelCenter.x + settings.buildingOffsetX;
      }
    });
    buildingPlaneFolderGUI.add(settings, "buildingOffsetY", -2, 2, 0.01).name("Offset Y").onChange(() => {
      if (buildingPlane) {
        buildingPlane.position.y = (STATE.streetY || 0) + settings.buildingOffsetY;
      }
    });
    buildingPlaneFolderGUI.add(settings, "buildingOffsetZ", -2, 2, 0.01).name("Offset Z").onChange(() => {
      if (buildingPlane) {
        buildingPlane.position.z = STATE.levelCenter.z + settings.buildingOffsetZ;
      }
    });
    buildingPlaneFolderGUI.close();

    addonsFolder.close();

    // ==================== SCENE ====================
    const sceneFolder = guiLeft.addFolder("🌆 Scene");

    const cameraFolder = sceneFolder.addFolder("Camera");
    cameraFolder.add(settings, "cameraType", ["orthographic", "perspective"]).name("Type").onChange((v) => switchCamera(v));

    function updatePerspCameraPos() {
      if (perspCamera) {
        const panX = settings.perspPanX || 0;
        const panZ = settings.perspPanZ || 0;
        perspCamera.position.set(settings.perspPosX + panX, settings.perspPosY, settings.perspPosZ + panZ);
        perspCamera.lookAt(STATE.levelCenter.x + panX, STATE.levelCenter.y, STATE.levelCenter.z + panZ);
      }
    }
    cameraFolder.add(settings, "orthoZoom", 0.1, 3, 0.1).name("Ortho Zoom").onChange((v) => {
      if (orthoCamera) { orthoCamera.zoom = v; orthoCamera.updateProjectionMatrix(); }
    });
    cameraFolder.add(settings, "perspFov", 5, 120, 1).name("Persp FOV").onChange((v) => {
      if (perspCamera) { perspCamera.fov = v; perspCamera.updateProjectionMatrix(); }
    });
    cameraFolder.add(settings, "perspPosY", 0, 500, 0.1).name("Persp Height").onChange(updatePerspCameraPos);
    cameraFolder.add(settings, "perspPosZ", -50, 50, 0.1).name("Persp Distance").onChange(updatePerspCameraPos);
    cameraFolder.add(settings, "perspPanX", -5, 5, 0.01).name("Pan X").onChange(updatePerspCameraPos);
    cameraFolder.add(settings, "perspPanZ", -5, 5, 0.01).name("Pan Y").onChange(updatePerspCameraPos);
    cameraFolder.add(settings, "renderScale", 0.5, 2, 0.25).name("Render Scale").onChange((v) => {
      renderer.setPixelRatio(window.devicePixelRatio * v);
      if (composer) {
        composer.setPixelRatio(window.devicePixelRatio * v);
        composer.setSize(window.innerWidth, window.innerHeight);
      }
    });
    cameraFolder.close();

    const lightsFolder = sceneFolder.addFolder("Lighting");
    lightsFolder.add(settings, "toneMapping", Object.keys(toneMappingOptions)).name("Tone Mapping").onChange((v) => {
      renderer.toneMapping = toneMappingOptions[v];
    });
    lightsFolder.add(settings, "exposure", 0, 3, 0.01).name("Exposure").onChange((v) => {
      renderer.toneMappingExposure = v;
    });
    lightsFolder.add(settings, "ambientIntensity", 0, 10, 0.1).name("Ambient").onChange((v) => {
      ambientLight.intensity = v;
    });
    lightsFolder.add(settings, "directIntensity", 0, 50, 0.1).name("Directional").onChange((v) => {
      directionalLight.intensity = v;
    });
    lightsFolder.add(settings, "directPosX", -20, 20, 0.5).name("Dir Pos X").onChange((v) => {
      directionalLight.position.x = v;
    });
    lightsFolder.add(settings, "directPosY", 0, 30, 0.5).name("Dir Pos Y").onChange((v) => {
      directionalLight.position.y = v;
    });
    lightsFolder.add(settings, "directPosZ", -20, 20, 0.5).name("Dir Pos Z").onChange((v) => {
      directionalLight.position.z = v;
    });
    lightsFolder.add(settings, "environmentIntensity", 0, 50, 0.1).name("Environment").onChange((v) => {
      scene.environmentIntensity = v;
    });
    // Emissive controls subfolder
    const emissiveFolder = lightsFolder.addFolder("Emissive");
    if (settings.globalEmissiveMultiplier === undefined) settings.globalEmissiveMultiplier = 1.0;
    emissiveFolder.add(settings, "globalEmissiveMultiplier", 0, 5, 0.1).name("Global Multiplier").onChange(() => {
      updateAllEmissives();
    });
    emissiveFolder.add(settings, "windowEmissiveIntensity", 0, 50, 0.5).name("Windows").onChange(() => {
      updateAllEmissives();
    });
    emissiveFolder.add(settings, "lampEmissiveIntensity", 0, 50, 0.5).name("Lamps").onChange(() => {
      updateAllEmissives();
    });
    emissiveFolder.add(settings, "roadEmissiveIntensity", 0, 50, 0.5).name("Roads").onChange(() => {
      updateAllEmissives();
    });
    emissiveFolder.add(settings, "roadNormalMap").name("Road Normal Map").onChange((v) => {
      if (STATE.roadMeshes) {
        for (const mesh of STATE.roadMeshes) {
          const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
          for (const mat of mats) {
            if (v) {
              if (mat._savedNormalMap) mat.normalMap = mat._savedNormalMap;
            } else {
              if (mat.normalMap) mat._savedNormalMap = mat.normalMap;
              mat.normalMap = null;
            }
            mat.needsUpdate = true;
          }
        }
      }
    });
    emissiveFolder.add(settings, "pathEmissiveIntensity", 0, 50, 0.5).name("Paths").onChange(() => {
      updateAllEmissives();
    });
    emissiveFolder.add(settings, "otherEmissiveIntensity", 0, 50, 0.5).name("Other").onChange(() => {
      updateAllEmissives();
    });
    // Audio reactive controls
    emissiveFolder.add(settings, "lampAudioReactive").name("Lamp Audio Reactive");
    emissiveFolder.add(settings, "lampAudioSensitivity", 0, 10, 0.5).name("Lamp Audio Sens.");
    emissiveFolder.add(settings, "carAudioReactive").name("Car BPM Pulse");
    emissiveFolder.add(settings, "carAudioBPM", 60, 180, 1).name("BPM");
    emissiveFolder.add(settings, "carAudioIntensity", 0, 10, 0.1).name("Car Pulse Intensity");
    emissiveFolder.add(settings, "textBPMPulse").name("Text BPM Pulse");
    emissiveFolder.add(settings, "textBPMIntensity", 0, 2, 0.1).name("Text Pulse Intensity");
    emissiveFolder.close();
    lightsFolder.add(settings, "punctualLights").name("Actor Lights").onChange((v) => {
      for (const f of fugitives) { if (f.light) f.light.visible = v; }
      for (const c of chasers) { if (c.light) c.light.visible = v; }
    });
    lightsFolder.close();

    sceneFolder.close();

    // ==================== VFX ====================
    const vfxFolder = guiLeft.addFolder("✨ VFX");

    // Environment
    const atmosphereFolder = vfxFolder.addFolder("Environment");
    atmosphereFolder.add(settings, "fogEnabled").name("Fog").onChange(updatePostProcessing);
    atmosphereFolder.addColor(settings, "fogColor").name("Fog Color").onChange(updatePostProcessing);
    atmosphereFolder.add(settings, "fogNear", 1, 50, 1).name("Fog Near").onChange(updatePostProcessing);
    atmosphereFolder.add(settings, "fogFar", 10, 100, 1).name("Fog Far").onChange(updatePostProcessing);
    atmosphereFolder.close();

    const bloomFolder = vfxFolder.addFolder("Bloom");
    bloomFolder.add(settings, "bloomEnabled").name("Enabled").onChange(updatePostProcessing);
    bloomFolder.add(settings, "bloomStrength", 0, 3, 0.1).name("Strength").onChange(updatePostProcessing);
    bloomFolder.add(settings, "bloomThreshold", 0, 1, 0.01).name("Threshold").onChange(updatePostProcessing);
    bloomFolder.add(settings, "bloomRadius", 0, 2, 0.01).name("Radius").onChange(updatePostProcessing);
    bloomFolder.close();

    const gradeFolder = vfxFolder.addFolder("Color Grading");
    gradeFolder.add(settings, "colorGradingEnabled").name("Enabled").onChange(updatePostProcessing);
    gradeFolder.add(settings, "vignetteEnabled").name("Vignette").onChange(updatePostProcessing);
    gradeFolder.add(settings, "vignetteIntensity", 0, 1, 0.05).name("Vignette Amount").onChange(updatePostProcessing);
    gradeFolder.add(settings, "colorGradingSaturation", 0, 3, 0.05).name("Saturation").onChange(updatePostProcessing);
    gradeFolder.add(settings, "colorGradingContrast", 0.5, 2, 0.05).name("Contrast").onChange(updatePostProcessing);
    gradeFolder.add(settings, "colorGradingBrightness", 0, 3, 0.05).name("Brightness").onChange(updatePostProcessing);
    gradeFolder.add(settings, "colorGradingGamma", 0.2, 3, 0.05).name("Gamma").onChange(updatePostProcessing);
    gradeFolder.add(settings, "colorGradingGainR", 0, 2, 0.05).name("Red").onChange(updatePostProcessing);
    gradeFolder.add(settings, "colorGradingGainG", 0, 2, 0.05).name("Green").onChange(updatePostProcessing);
    gradeFolder.add(settings, "colorGradingGainB", 0, 2, 0.05).name("Blue").onChange(updatePostProcessing);
    gradeFolder.add(settings, "colorGradingLiftR", -0.5, 0.5, 0.01).name("Lift R").onChange(updatePostProcessing);
    gradeFolder.add(settings, "colorGradingLiftG", -0.5, 0.5, 0.01).name("Lift G").onChange(updatePostProcessing);
    gradeFolder.add(settings, "colorGradingLiftB", -0.5, 0.5, 0.01).name("Lift B").onChange(updatePostProcessing);
    gradeFolder.close();

    const pixelFolder = vfxFolder.addFolder("Pixelation");
    pixelFolder.add(settings, "pixelationEnabled").name("Enabled").onChange(updatePostProcessing);
    pixelFolder.add(settings, "pixelationSize", 1, 16, 1).name("Pixel Size").onChange(updatePostProcessing);
    pixelFolder.add(settings, "pixelationNormalEdge", 0, 2, 0.05).name("Normal Edge").onChange(updatePostProcessing);
    pixelFolder.add(settings, "pixelationDepthEdge", 0, 1, 0.05).name("Depth Edge").onChange(updatePostProcessing);
    pixelFolder.close();

    vfxFolder.close();

    // ==================== AUDIO ====================
    const audioFolder = guiLeft.addFolder("🔊 Audio");
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

    // SFX display (read-only info)
    const sfxFolder = audioFolder.addFolder("Sound Effects");
    const sfxInfo = {
      capture: PATHS.sfx?.capture?.split('/').pop() || "N/A",
      helicopter: PATHS.sfx?.helicopter?.split('/').pop() || "N/A",
      countdown: PATHS.sfx?.countdown?.split('/').pop() || "N/A",
      playerSelect: PATHS.sfx?.playerSelect?.split('/').pop() || "N/A",
      gameStart: PATHS.sfx?.gameStart?.split('/').pop() || "N/A",
    };
    sfxFolder.add(sfxInfo, "capture").name("Capture").disable();
    sfxFolder.add(sfxInfo, "helicopter").name("Helicopter").disable();
    sfxFolder.add(sfxInfo, "countdown").name("Countdown").disable();
    sfxFolder.add(sfxInfo, "playerSelect").name("Player Select").disable();
    sfxFolder.add(sfxInfo, "gameStart").name("Game Start").disable();
    sfxFolder.close();

    audioFolder.close();

    // Store reference for GLB parts to add to later
    STATE.mainGUI = guiLeft;

    // Hide GUI by default (toggle with CMD/CTRL+G)
    guiLeft.domElement.style.display = "none";
  }

  // ============================================
  // GLB PARTS GUI
  // ============================================

  const glbParts = new Map();

  // Get default settings for a part based on name patterns
  function getGLBPartDefaults(name, meshDefaults) {
    const nameLower = name.toLowerCase();
    const defaults = settings.glbParts._defaults || {};
    const result = { ...meshDefaults };

    // Check each default pattern
    for (const [pattern, overrides] of Object.entries(defaults)) {
      if (nameLower.includes(pattern.toLowerCase())) {
        Object.assign(result, overrides);
      }
    }

    // Check for exact match override (e.g., "building-building")
    if (defaults[nameLower]) {
      Object.assign(result, defaults[nameLower]);
    }

    // Apply any saved per-part settings
    if (settings.glbParts[name]) {
      Object.assign(result, settings.glbParts[name]);
    }

    return result;
  }

  // Save GLB part setting to settings
  function saveGLBPartSetting(name, key, value) {
    if (!settings.glbParts[name]) {
      settings.glbParts[name] = {};
    }
    settings.glbParts[name][key] = value;
  }

  function setupGLBPartsGUI() {
    if (!STATE.levelContainer || !STATE.mainGUI) return;

    // Ensure glbParts object exists in settings
    if (!settings.glbParts) {
      settings.glbParts = { _defaults: {} };
    }

    STATE.levelContainer.traverse((obj) => {
      if (obj.isMesh && obj.name && obj.material) {
        if (glbParts.has(obj.name)) return;
        if (obj.name.match(/^(F\d|C\d|Fugitive|Chaser)/i)) return;

        const mat = obj.material;
        glbParts.set(obj.name, {
          mesh: obj,
          meshColor: mat.color ? "#" + mat.color.getHexString() : "#ffffff",
          meshOpacity: mat.opacity || 1,
          meshRoughness: mat.roughness,
          meshMetalness: mat.metalness
        });
      }
    });

    if (glbParts.size === 0) return;

    // Add GLB Parts folder to main GUI
    const glbPartsFolder = STATE.mainGUI.addFolder("GLB");

    // Display current GLB file name
    const glbFileName = PATHS.models.level.split('/').pop();
    glbPartsFolder.add({ file: glbFileName }, "file").name("Current").disable();

    // Create Nav subfolder for navigation-related parts
    const navFolder = glbPartsFolder.addFolder("Nav");

    // Helper to add part controls to a folder
    function addPartControls(parentFolder, data, name) {
      const mat = data.mesh.material;
      if (!mat) return;

      // Get defaults from settings (pattern-based + per-part overrides)
      const partDefaults = getGLBPartDefaults(name, {
        color: data.meshColor,
        opacity: data.meshOpacity,
        visible: true,
        roughness: data.meshRoughness,
        metalness: data.meshMetalness,
        wireframe: false
      });

      // Apply settings to material
      if (mat.color && partDefaults.color) {
        mat.color.set(partDefaults.color);
        if (mat.emissive) mat.emissive.set(partDefaults.color);
      }
      if (partDefaults.opacity !== undefined) {
        mat.transparent = partDefaults.opacity < 1;
        mat.opacity = partDefaults.opacity;
      }
      if (partDefaults.roughness !== undefined && mat.roughness !== undefined) {
        mat.roughness = partDefaults.roughness;
      }
      if (partDefaults.metalness !== undefined && mat.metalness !== undefined) {
        mat.metalness = partDefaults.metalness;
      }
      if (partDefaults.wireframe !== undefined && mat.wireframe !== undefined) {
        mat.wireframe = partDefaults.wireframe;
      }
      data.mesh.visible = partDefaults.visible !== false;
      mat.needsUpdate = true;

      // Create GUI controls
      const partSettings = {
        color: partDefaults.color || "#ffffff",
        opacity: partDefaults.opacity !== undefined ? partDefaults.opacity : 1,
        visible: partDefaults.visible !== false
      };

      const folder = parentFolder.addFolder(name);

      folder.addColor(partSettings, "color").name("Color").onChange((v) => {
        if (mat.color) {
          mat.color.set(v);
          if (mat.emissive) mat.emissive.set(v);
          mat.needsUpdate = true;
        }
        saveGLBPartSetting(name, "color", v);
      });

      folder.add(partSettings, "opacity", 0, 1, 0.05).name("Opacity").onChange((v) => {
        mat.transparent = v < 1;
        mat.opacity = v;
        mat.needsUpdate = true;
        saveGLBPartSetting(name, "opacity", v);
      });

      folder.add(partSettings, "visible").name("Visible").onChange((v) => {
        data.mesh.visible = v;
        saveGLBPartSetting(name, "visible", v);
      });

      if (mat.roughness !== undefined) {
        const roughnessCtrl = { roughness: partDefaults.roughness !== undefined ? partDefaults.roughness : mat.roughness };
        folder.add(roughnessCtrl, "roughness", 0, 1, 0.01).name("Roughness").onChange((v) => {
          mat.roughness = v;
          saveGLBPartSetting(name, "roughness", v);
        });
      }

      if (mat.metalness !== undefined) {
        const metalnessCtrl = { metalness: partDefaults.metalness !== undefined ? partDefaults.metalness : mat.metalness };
        folder.add(metalnessCtrl, "metalness", 0, 1, 0.01).name("Metalness").onChange((v) => {
          mat.metalness = v;
          saveGLBPartSetting(name, "metalness", v);
        });
      }

      if (mat.wireframe !== undefined) {
        const wireframeCtrl = { wireframe: partDefaults.wireframe || false };
        folder.add(wireframeCtrl, "wireframe").name("Wireframe").onChange((v) => {
          mat.wireframe = v;
          saveGLBPartSetting(name, "wireframe", v);
        });
      }

      folder.close();
    }

    glbParts.forEach((data, name) => {
      const nameLower = name.toLowerCase();
      // Put Nav items in their own subfolder
      if (nameLower.startsWith("nav")) {
        addPartControls(navFolder, data, name);
      } else {
        addPartControls(glbPartsFolder, data, name);
      }
    });

    navFolder.close();
    glbPartsFolder.close();
  }

  // ============================================
  // CYBERPUNK VFX SHADER
  // ============================================

  const CyberpunkShader = {
    uniforms: {
      'tDiffuse': { value: null },
      'vignetteIntensity': { value: 0.4 },
      'chromaticAberration': { value: 0.003 },
      'tintColor': { value: new THREE.Color(0xff00ff) },
      'tintIntensity': { value: 0.15 },
      'saturation': { value: 1.2 },
      'contrast': { value: 1.1 },
      'brightness': { value: 1.0 },
      'gain': { value: new THREE.Vector3(1, 1, 1) },
      'lift': { value: new THREE.Vector3(0, 0, 0) },
      'gamma': { value: 1.0 },
      'time': { value: 0 }
    },
    vertexShader: `
      varying vec2 vUv;
      void main() {
        vUv = uv;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: `
      uniform sampler2D tDiffuse;
      uniform float vignetteIntensity;
      uniform float chromaticAberration;
      uniform vec3 tintColor;
      uniform float tintIntensity;
      uniform float saturation;
      uniform float contrast;
      uniform float brightness;
      uniform vec3 gain;
      uniform vec3 lift;
      uniform float gamma;
      uniform float time;
      varying vec2 vUv;

      void main() {
        vec2 uv = vUv;
        vec2 center = uv - 0.5;
        float dist = length(center);

        // Chromatic aberration
        float aberration = chromaticAberration * dist;
        float r = texture2D(tDiffuse, uv + vec2(aberration, 0.0)).r;
        float g = texture2D(tDiffuse, uv).g;
        float b = texture2D(tDiffuse, uv - vec2(aberration, 0.0)).b;
        vec3 color = vec3(r, g, b);

        // Brightness
        color *= brightness;

        // RGB channel gain (multiply per channel)
        color *= gain;

        // Lift (add to shadows — applied before gamma so it mainly affects darks)
        color += lift;

        // Gamma correction
        float invGamma = 1.0 / gamma;
        color = pow(max(color, vec3(0.0)), vec3(invGamma));

        // Saturation
        float luminance = dot(color, vec3(0.299, 0.587, 0.114));
        color = mix(vec3(luminance), color, saturation);

        // Contrast
        color = (color - 0.5) * contrast + 0.5;

        // Color tint (additive cyberpunk glow)
        color += tintColor * tintIntensity * (0.5 + 0.5 * sin(time * 0.5));

        // Vignette
        float vignette = 1.0 - dist * vignetteIntensity * 2.0;
        vignette = clamp(vignette, 0.0, 1.0);
        vignette = smoothstep(0.0, 1.0, vignette);
        color *= vignette;

        gl_FragColor = vec4(color, 1.0);
      }
    `
  };


  // ============================================
  // ATMOSPHERE SYSTEMS
  // ============================================

  function initAtmosphere() {
    // Initialize fog
    if (settings.fogEnabled) {
      scene.fog = new THREE.Fog(settings.fogColor, settings.fogNear, settings.fogFar);
    }
  }

  function updateAtmosphere(dt) {
    // Update cyberpunk shader time
    if (composer && composer.cyberpunkPass) {
      composer.cyberpunkPass.uniforms['time'].value = performance.now() * 0.001;
    }
  }

  // ============================================
  // POST-PROCESSING (WebGL EffectComposer)
  // ============================================

  function initPostProcessing() {
    composer = new EffectComposer(renderer);

    // Selective pixel pass - renders GLB models with pixelation, other elements normally
    const selectivePixelPass = new SelectivePixelPass(
      settings.pixelationSize || 4,
      scene,
      camera,
      {
        normalEdgeStrength: settings.pixelationNormalEdge || 0.3,
        depthEdgeStrength: settings.pixelationDepthEdge || 0.4,
        glbLayer: LAYERS.GLB_MODELS,
        pixelationEnabled: settings.pixelationEnabled
      }
    );
    composer.addPass(selectivePixelPass);

    // Bloom pass
    const bloomPass = new UnrealBloomPass(
      new THREE.Vector2(window.innerWidth, window.innerHeight),
      settings.bloomStrength,
      settings.bloomRadius,
      settings.bloomThreshold
    );
    bloomPass.enabled = settings.bloomEnabled;
    composer.addPass(bloomPass);

    // Cyberpunk shader pass (vignette, chromatic aberration, color grading)
    const cyberpunkPass = new ShaderPass(CyberpunkShader);
    cyberpunkPass.uniforms['vignetteIntensity'].value = settings.vignetteEnabled ? settings.vignetteIntensity : 0;
    cyberpunkPass.uniforms['chromaticAberration'].value = 0;
    cyberpunkPass.uniforms['tintColor'].value.set("#ffffff");
    cyberpunkPass.uniforms['tintIntensity'].value = 0;
    cyberpunkPass.uniforms['saturation'].value = settings.colorGradingEnabled ? settings.colorGradingSaturation : 1.0;
    cyberpunkPass.uniforms['contrast'].value = settings.colorGradingEnabled ? settings.colorGradingContrast : 1.0;
    cyberpunkPass.uniforms['brightness'].value = settings.colorGradingEnabled ? settings.colorGradingBrightness : 1.0;
    cyberpunkPass.uniforms['gain'].value.set(
      settings.colorGradingEnabled ? settings.colorGradingGainR : 1,
      settings.colorGradingEnabled ? settings.colorGradingGainG : 1,
      settings.colorGradingEnabled ? settings.colorGradingGainB : 1
    );
    cyberpunkPass.uniforms['lift'].value.set(
      settings.colorGradingEnabled ? settings.colorGradingLiftR : 0,
      settings.colorGradingEnabled ? settings.colorGradingLiftG : 0,
      settings.colorGradingEnabled ? settings.colorGradingLiftB : 0
    );
    cyberpunkPass.uniforms['gamma'].value = settings.colorGradingEnabled ? settings.colorGradingGamma : 1.0;
    composer.addPass(cyberpunkPass);

    // Output pass for tone mapping
    const outputPass = new OutputPass();
    composer.addPass(outputPass);

    // Store references for updates
    composer.bloomPass = bloomPass;
    composer.cyberpunkPass = cyberpunkPass;
    composer.selectivePixelPass = selectivePixelPass;
  }

  function updatePostProcessing() {
    if (!composer) return;

    if (composer.bloomPass) {
      composer.bloomPass.enabled = settings.bloomEnabled;
      composer.bloomPass.threshold = settings.bloomThreshold;
      composer.bloomPass.strength = settings.bloomStrength;
      composer.bloomPass.radius = settings.bloomRadius;
    }

    if (composer.cyberpunkPass) {
      composer.cyberpunkPass.uniforms['vignetteIntensity'].value = settings.vignetteEnabled ? settings.vignetteIntensity : 0;
      composer.cyberpunkPass.uniforms['chromaticAberration'].value = 0;
      composer.cyberpunkPass.uniforms['tintColor'].value.set("#ffffff");
      composer.cyberpunkPass.uniforms['tintIntensity'].value = 0;
      composer.cyberpunkPass.uniforms['saturation'].value = settings.colorGradingEnabled ? settings.colorGradingSaturation : 1.0;
      composer.cyberpunkPass.uniforms['contrast'].value = settings.colorGradingEnabled ? settings.colorGradingContrast : 1.0;
      composer.cyberpunkPass.uniforms['brightness'].value = settings.colorGradingEnabled ? settings.colorGradingBrightness : 1.0;
      const en = settings.colorGradingEnabled;
      composer.cyberpunkPass.uniforms['gain'].value.set(
        en ? settings.colorGradingGainR : 1, en ? settings.colorGradingGainG : 1, en ? settings.colorGradingGainB : 1
      );
      composer.cyberpunkPass.uniforms['lift'].value.set(
        en ? settings.colorGradingLiftR : 0, en ? settings.colorGradingLiftG : 0, en ? settings.colorGradingLiftB : 0
      );
      composer.cyberpunkPass.uniforms['gamma'].value = en ? settings.colorGradingGamma : 1.0;
    }

    // Update selective pixelation
    if (composer.selectivePixelPass) {
      composer.selectivePixelPass.pixelationEnabled = settings.pixelationEnabled;
      composer.selectivePixelPass.setPixelSize(settings.pixelationSize || 4);
      composer.selectivePixelPass.normalEdgeStrength = settings.pixelationNormalEdge || 0.3;
      composer.selectivePixelPass.depthEdgeStrength = settings.pixelationDepthEdge || 0.4;
    }

    // Update fog
    if (settings.fogEnabled) {
      if (!scene.fog) {
        scene.fog = new THREE.Fog(settings.fogColor, settings.fogNear, settings.fogFar);
      }
      scene.fog.color.set(settings.fogColor);
      scene.fog.near = settings.fogNear;
      scene.fog.far = settings.fogFar;
    } else {
      scene.fog = null;
    }
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
    // Also update the billboard lights (the visible ones)
    for (const wire of fugitiveWires) {
      if (wire.billboardLight) {
        wire.billboardLight.color.set(color);
        wire.billboardLight.intensity = settings.fugitiveLightIntensity;
      }
      wire.color = color;
    }
  }

  function updateChaserLights() {
    const colors = [settings.chaser1Color, settings.chaser2Color, settings.chaser3Color, settings.chaser4Color];
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
        c.light.shadow.camera.far = settings.chaserLightDistance || 50;
        // Account for mesh scale when setting light position
        const meshScale = c.mesh.scale.y || 1;
        c.light.position.x = (settings.chaserLightOffsetX || 0) / meshScale;
        c.light.position.y = settings.chaserLightHeight / meshScale;
        c.light.position.z = -settings.chaserLightOffset / meshScale; // Front offset (negative due to car flip)
        // Update light target direction
        if (c.lightTarget) {
          c.lightTarget.position.set(
            (settings.chaserLightTargetX || 0) / meshScale,
            (settings.chaserLightTargetY || 0) / meshScale,
            (settings.chaserLightTargetZ !== undefined ? settings.chaserLightTargetZ : -5) / meshScale
          );
        }
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
    // Update debug helpers
    for (const h of chaserLightHelpers) h.update();
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

      // Pop-in animation state
      this.isPopping = false;
      this.popProgress = 0;
      this.popDuration = 0.6; // seconds
      this.popScale = 0;
      this.showWireAndBillboard = false; // Only show when game is playing

      this.initWire();
    }

    initWire() {
      const segmentCount = 12; // Fixed value since wire is removed
      const totalHeight = 3.2 * this.actorSize; // Fixed height for billboard positioning
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

      const billboardSize = settings.wireCubeSize * this.actorSize * 2;
      const billboardGeo = new THREE.PlaneGeometry(billboardSize, billboardSize);
      const brightness = settings.billboardBrightness;
      const billboardMat = new THREE.MeshBasicMaterial({
        color: new THREE.Color(brightness, brightness, brightness),
        side: THREE.DoubleSide,
        transparent: true,
        depthWrite: false,
        depthTest: true, // Enable depth test so billboards render behind helicopter
      });

      // Add contrast adjustment via shader modification
      billboardMat.userData.contrast = settings.billboardContrast;
      billboardMat.onBeforeCompile = (shader) => {
        shader.uniforms.contrast = { value: settings.billboardContrast };
        billboardMat.userData.shader = shader;

        // Inject contrast uniform
        shader.fragmentShader = shader.fragmentShader.replace(
          'void main() {',
          'uniform float contrast;\nvoid main() {'
        );

        // Apply contrast to the final color
        shader.fragmentShader = shader.fragmentShader.replace(
          '#include <dithering_fragment>',
          `gl_FragColor.rgb = (gl_FragColor.rgb - 0.5) * contrast + 0.5;
          #include <dithering_fragment>`
        );
      };

      // Update contrast uniform when material needs update
      const originalOnBeforeRender = billboardMat.onBeforeRender;
      billboardMat.onBeforeRender = function() {
        if (this.userData.shader) {
          this.userData.shader.uniforms.contrast.value = settings.billboardContrast;
        }
        if (originalOnBeforeRender) originalOnBeforeRender.apply(this, arguments);
      };
      this.billboard = new THREE.Mesh(billboardGeo, billboardMat);
      this.billboard.rotation.x = -Math.PI / 2;
      this.billboard.castShadow = false;
      this.billboard.renderOrder = 100; // Render above wire but respect depth
      scene.add(this.billboard);

      // Add point light for billboard emission (chasers only, fugitive lights disabled for performance)
      if (this.isChaser) {
        this.billboardLight = new THREE.PointLight(
          this.color,
          settings.billboardLightIntensity,
          settings.billboardLightDistance
        );
        this.billboardLight.castShadow = false;
        scene.add(this.billboardLight);
      } else {
        this.billboardLight = null;
      }

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
            // Pre-upload texture to GPU to avoid stall on first render
            renderer.initTexture(texture);
          },
          undefined,
          () => this.billboard.material.color.set(this.color)
        );
        textureLoader.load(facePath + pair[1],
          (texture) => {
            this.textures[1] = texture;
            renderer.initTexture(texture);
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
      if (this.isChaser) {
        return this.actor.active;
      } else {
        // Fugitive billboards only show when game is playing and showWireAndBillboard is true
        return !this.actor.captured && this.showWireAndBillboard;
      }
    }

    startPopIn() {
      this.isPopping = true;
      this.popProgress = 0;
      this.popScale = 0;
      this.showWireAndBillboard = true;
    }

    hideWireAndBillboard() {
      this.showWireAndBillboard = false;
      this.isPopping = false;
      this.popScale = 0;
      if (this.billboard) this.billboard.scale.setScalar(0);
    }

    // Elastic easing function (overshoot and settle)
    elasticOut(t) {
      const p = 0.3;
      return Math.pow(2, -10 * t) * Math.sin((t - p / 4) * (2 * Math.PI) / p) + 1;
    }

    update(dt = 0.016) {
      // Update fade animation
      this.updateFade(dt);

      // Update pop-in animation
      if (this.isPopping) {
        this.popProgress += dt / this.popDuration;
        if (this.popProgress >= 1) {
          this.popProgress = 1;
          this.isPopping = false;
        }
        this.popScale = this.elasticOut(this.popProgress);
      }

      if (!this.isVisible()) {
        // Keep visible at scale 0 to avoid shader recompilation on show
        if (this.billboard) this.billboard.scale.setScalar(0);
        return;
      }

      if (this.billboard) {
        // Apply pop scale
        this.billboard.scale.setScalar(this.popScale);
      }

      const actorPos = this.actor.mesh.position;
      const totalHeight = 3.2 * this.actorSize; // Hardcoded (wire removed)

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

      const gravity = 0.15 * this.actorSize; // Hardcoded (wire removed)
      const friction = 0.92; // Hardcoded (wire removed)

      for (const p of this.points) {
        if (!p.pinned) {
          const windX = (Math.random() - 0.5) * 0.02 * this.actorSize;
          const windZ = (Math.random() - 0.5) * 0.02 * this.actorSize;
          p.pos.x += windX;
          p.pos.z += windZ;
        }
        p.update(gravity, friction);
      }

      for (let i = 0; i < 3; i++) { // Hardcoded iterations (wire removed)
        for (const stick of this.sticks) {
          stick.update();
        }
      }

      // Wire line removed - only billboard remains

      // Billboard position: pull toward center based on centerPull setting
      const toCenterX = center.x - actorPos.x;
      const toCenterZ = center.z - actorPos.z;
      let billboardX = actorPos.x + toCenterX * centerPull;
      let billboardZ = actorPos.z + toCenterZ * centerPull;

      // Optionally limit distance from actor if maxDist > 0
      if (maxDist > 0) {
        const dx = billboardX - actorPos.x;
        const dz = billboardZ - actorPos.z;
        const dist = Math.sqrt(dx * dx + dz * dz);
        if (dist > maxDist) {
          const scale = maxDist / dist;
          billboardX = actorPos.x + dx * scale;
          billboardZ = actorPos.z + dz * scale;
        }
      }

      this.billboard.position.set(billboardX, actorPos.y + totalHeight, billboardZ);

      // Update billboard light position and settings
      // Use intensity=0 instead of visible=false to avoid shader recompilation
      if (this.billboardLight) {
        this.billboardLight.position.copy(this.billboard.position);
        const baseIntensity = this.isChaser ? settings.billboardLightIntensity : settings.fugitiveLightIntensity;
        this.billboardLight.intensity = this.showWireAndBillboard ? baseIntensity : 0;
        this.billboardLight.distance = settings.billboardLightDistance;
      }
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
      if (this.billboardLight) {
        scene.remove(this.billboardLight);
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
    return `${Math.floor(seconds)}`;
  }

  function updateTimerDisplay() {
    if (STATE.showingScore) return;
    if (STATE.gameState !== "PLAYING") return;

    if (STATE.gameTimerStarted && !STATE.gameOver) {
      applyPlayingText();
      updateGlassCanvas();
    }
  }

  function showGameScore() {
    // Check for high score
    const highScorePosition = checkHighScore(STATE.playerScore);
    if (highScorePosition >= 0) {
      // Player made the high score list - show high score text, then start entry
      applyHighScoreText();
      updateGlassCanvas();
      setTimeout(() => {
        if (STATE.gameState === "GAME_OVER") {
          startHighScoreEntry(highScorePosition);
        }
      }, 1500);
    } else {
      // No high score - show GAMEOVER
      settings.glassTextRow1 = "";
      settings.glassTextRow2 = " GAMEOVER";
      settings.glassTextRow3 = "";
      settings.glassTextRow4 = "";
      updateGlassCanvas();
      // Force a second render after shuffle settles
      setTimeout(() => updateGlassCanvas(), 500);
      postHighScore({ score: STATE.playerScore, playerName: "???" })
        .then(() => fetchServerHighScores());
      STATE.showingScore = true;
      STATE.scoreDisplayTime = 5;
    }
  }

  function resetGame() {
    // Reset state
    STATE.gameOver = false;
    STATE.gameTimerStarted = false;
    STATE.gameTimerRemaining = 90;
    STATE.showingScore = false;
    STATE.scoreDisplayTime = 0;
    STATE.capturedCount = 0;
    STATE.activeChaserCount = 0;
    STATE.playerScore = 0;
    STATE.fugitiveValue = 250;
    STATE.enteringHighScore = false;
    STATE.highScorePosition = 0;
    STATE.highScoreCharIndex = 0;
    STATE.highScoreInitialsColor = null;
    STATE.countdownValue = 3;
    STATE.countdownTimer = 0;
    settings.gameStarted = false;
    resetBoosts(boostStates, settings);

    // Clear any active capture effects
    for (const effect of captureEffects) {
      if (effect.coreMesh) { scene.remove(effect.coreMesh); effect.coreMat.dispose(); }
      if (effect.glowMesh) { scene.remove(effect.glowMesh); effect.glowMat.dispose(); }
      // Dispose alpha attribute buffers only (positions are shared from cache)
      if (effect.coreGeo) { effect.coreGeo.deleteAttribute('alpha'); effect.coreGeo.dispose(); }
      if (effect.glowGeo) { effect.glowGeo.deleteAttribute('alpha'); effect.glowGeo.dispose(); }
      scene.remove(effect.particles);
      effect.particles.geometry.dispose();
      effect.particleMat.dispose();
      if (effect.flash) {
        scene.remove(effect.flash);
        // Don't dispose flash geometry — it's shared (_sharedFlashGeo)
        effect.flashMat.dispose();
      }
    }
    captureEffects.length = 0;

    // Reset fugitives
    for (const f of fugitives) {
      f.captured = false;
      f.mesh.visible = false; // Keep cube hidden, only show wire and billboard
      if (f.light) {
        f.light.visible = true;
        f.light.intensity = settings.fugitiveLightIntensity;
      }

      // Reset to spawn position
      f.mesh.position.x = f.spawnX;
      f.mesh.position.z = f.spawnZ;
      STATE.projectYOnRoad(f.mesh.position);

      // Re-initialize on path
      initActorOnPath(f);

      // Re-show billboard and wire
      const wire = fugitiveWires[f.index];
      if (wire) {
        if (wire.billboard) wire.billboard.visible = true;
        // Intensity is managed per-frame based on billboard visibility; just ensure billboard is shown
        if (wire.billboardLight) wire.billboardLight.intensity = settings.fugitiveLightIntensity;
      }
    }

    // Reset chasers
    for (const c of chasers) {
      c.active = false;
      c.ready = false;
      c.isMoving = false;
      c.queuedDirX = 0;
      c.queuedDirZ = 0;
      c.currentEdge = null;

      // Turn off headlights
      if (c.light) {
        c.light.intensity = 0;
      }

      // Reset to spawn position and rotation
      c.mesh.position.x = c.spawnX;
      c.mesh.position.z = c.spawnZ;
      STATE.projectYOnRoad(c.mesh.position);
      c.mesh.position.y += settings.chaserHeightOffset;
      c.mesh.rotation.y = c.spawnRotationY || 0;

      // Re-initialize on path
      initActorOnPath(c);
    }

    // Set back to PRE_GAME state (this will also set chaser opacity to 0.1)
    setGameState("PRE_GAME");
  }

  // ============================================
  // CAPTURE EFFECTS
  // ============================================

  const captureEffects = [];

  // Pre-built tube geometry cache — built once when path graph is ready
  let _tubeCache = null;

  function buildTubeCache() {
    if (!STATE.pathGraph || !STATE.pathGraph.edges) return null;
    const tubeHeight = settings.pulseWaveTubeHeight || 0.15;
    const tubeRadius = tubeHeight * 0.4;
    const glowScale = settings.pulseWaveGlow || 3.0;
    const edges = STATE.pathGraph.edges;
    const segs = 6;

    const templateCore = new THREE.CylinderGeometry(tubeRadius, tubeRadius, 1, segs, 1, true);
    const templateGlow = new THREE.CylinderGeometry(tubeRadius * glowScale, tubeRadius * glowScale, 1, segs, 1, true);
    templateCore.rotateX(Math.PI / 2);
    templateGlow.rotateX(Math.PI / 2);

    const vertsPerTube = templateCore.attributes.position.count;

    // Pre-calculate per-edge geometry data
    const edgeCenters = []; // {x, z} per edge
    const corePositions = [];
    const glowPositions = [];

    for (const edge of edges) {
      const dx = edge.x2 - edge.x1;
      const dz = edge.z2 - edge.z1;
      const length = Math.sqrt(dx * dx + dz * dz);
      const angle = Math.atan2(dx, dz);
      const centerX = (edge.x1 + edge.x2) / 2;
      const centerZ = (edge.z1 + edge.z2) / 2;
      const cosA = Math.cos(angle);
      const sinA = Math.sin(angle);
      edgeCenters.push({ x: centerX, z: centerZ });

      for (let v = 0; v < vertsPerTube; v++) {
        let lx = templateCore.attributes.position.getX(v);
        let ly = templateCore.attributes.position.getY(v);
        let lz = templateCore.attributes.position.getZ(v) * length;
        const rx = lx * cosA + lz * sinA;
        const rz = -lx * sinA + lz * cosA;
        corePositions.push(rx + centerX, ly + tubeHeight / 2, rz + centerZ);

        lx = templateGlow.attributes.position.getX(v);
        ly = templateGlow.attributes.position.getY(v);
        lz = templateGlow.attributes.position.getZ(v) * length;
        const grx = lx * cosA + lz * sinA;
        const grz = -lx * sinA + lz * cosA;
        glowPositions.push(grx + centerX, ly + tubeHeight / 2, grz + centerZ);
      }
    }

    // Build shared index buffer
    const templateIndex = templateCore.index.array;
    const indices = [];
    for (let e = 0; e < edges.length; e++) {
      const offset = e * vertsPerTube;
      for (let j = 0; j < templateIndex.length; j++) {
        indices.push(templateIndex[j] + offset);
      }
    }

    templateCore.dispose();
    templateGlow.dispose();

    return {
      corePositions: new Float32Array(corePositions),
      glowPositions: new Float32Array(glowPositions),
      indices,
      edgeCenters,
      vertsPerTube,
      edgeCount: edges.length
    };
  }

  function getTubeCache() {
    if (!_tubeCache) _tubeCache = buildTubeCache();
    return _tubeCache;
  }

  // Shared flash + particle geometry (created once, reused)
  let _sharedFlashGeo = null;

  function createCaptureEffect(position, chaserColor, billboard) {
    if (!settings.pulseWaveEnabled) return;

    const color = new THREE.Color(chaserColor);
    const originX = position.x;
    const originZ = position.z;

    let coreMesh = null, glowMesh = null;
    let coreGeo = null, glowGeo = null;
    let coreMat = null, glowMat = null;
    let edgeDistances = [];
    let vertsPerTube = 0;

    const cache = getTubeCache();
    if (cache) {
      // Compute per-edge distances from this capture origin
      for (let e = 0; e < cache.edgeCount; e++) {
        const ec = cache.edgeCenters[e];
        edgeDistances.push(Math.sqrt((ec.x - originX) ** 2 + (ec.z - originZ) ** 2));
      }
      vertsPerTube = cache.vertsPerTube;

      // Reuse shared position/index data, only create fresh alpha attributes
      const totalVerts = cache.edgeCount * vertsPerTube;

      coreGeo = new THREE.BufferGeometry();
      coreGeo.setAttribute('position', new THREE.Float32BufferAttribute(cache.corePositions, 3));
      coreGeo.setAttribute('alpha', new THREE.Float32BufferAttribute(new Float32Array(totalVerts), 1));
      coreGeo.setIndex(cache.indices);

      glowGeo = new THREE.BufferGeometry();
      glowGeo.setAttribute('position', new THREE.Float32BufferAttribute(cache.glowPositions, 3));
      glowGeo.setAttribute('alpha', new THREE.Float32BufferAttribute(new Float32Array(totalVerts), 1));
      glowGeo.setIndex(cache.indices);

      const shaderVert = `
        attribute float alpha;
        varying float vAlpha;
        void main() {
          vAlpha = alpha;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
      `;
      const shaderFrag = `
        uniform vec3 uColor;
        uniform float uOpacity;
        varying float vAlpha;
        void main() {
          gl_FragColor = vec4(uColor, vAlpha * uOpacity);
        }
      `;

      coreMat = new THREE.ShaderMaterial({
        uniforms: { uColor: { value: new THREE.Color(0xffffff) }, uOpacity: { value: 1.0 } },
        vertexShader: shaderVert, fragmentShader: shaderFrag,
        transparent: true, depthWrite: false, depthTest: false,
        blending: THREE.AdditiveBlending, side: THREE.DoubleSide
      });
      coreMesh = new THREE.Mesh(coreGeo, coreMat);
      scene.add(coreMesh);

      glowMat = new THREE.ShaderMaterial({
        uniforms: { uColor: { value: color.clone() }, uOpacity: { value: 1.0 } },
        vertexShader: shaderVert, fragmentShader: shaderFrag,
        transparent: true, depthWrite: false, depthTest: false,
        blending: THREE.AdditiveBlending, side: THREE.DoubleSide
      });
      glowMesh = new THREE.Mesh(glowGeo, glowMat);
      scene.add(glowMesh);
    }

    // Create particle burst from billboard position
    const particleCount = settings.pulseWaveParticles ? 60 : 0;
    const particlePositions = new Float32Array(particleCount * 3);
    const particleVelocities = [];
    const particleColors = new Float32Array(particleCount * 3);

    const billboardPos = position.clone();
    billboardPos.y = position.y + 0.3;

    for (let i = 0; i < particleCount; i++) {
      particlePositions[i * 3] = billboardPos.x + (Math.random() - 0.5) * 0.3;
      particlePositions[i * 3 + 1] = billboardPos.y + (Math.random() - 0.5) * 0.3;
      particlePositions[i * 3 + 2] = billboardPos.z + (Math.random() - 0.5) * 0.3;

      const angle = Math.random() * Math.PI * 2;
      const speed = Math.random() * 1.5 + 0.5;
      const upSpeed = Math.random() * 2 + 0.5;
      particleVelocities.push({
        x: Math.cos(angle) * speed,
        y: upSpeed,
        z: Math.sin(angle) * speed
      });

      const t = Math.random();
      const brightness = 1 + Math.random() * 0.5;
      particleColors[i * 3] = Math.min(1, brightness * (1 * (1 - t) + color.r * t));
      particleColors[i * 3 + 1] = Math.min(1, brightness * (1 * (1 - t) + color.g * t));
      particleColors[i * 3 + 2] = Math.min(1, brightness * (1 * (1 - t) + color.b * t));
    }

    const particleGeo = new THREE.BufferGeometry();
    particleGeo.setAttribute('position', new THREE.BufferAttribute(particlePositions, 3));
    particleGeo.setAttribute('color', new THREE.BufferAttribute(particleColors, 3));

    const particleMat = new THREE.PointsMaterial({
      size: 0.25, vertexColors: true, transparent: true, opacity: 1.0,
      blending: THREE.AdditiveBlending, depthWrite: false, sizeAttenuation: true
    });

    const particles = new THREE.Points(particleGeo, particleMat);
    scene.add(particles);

    // Flash at capture point (reuse shared geometry)
    let flash = null;
    let flashMat = null;
    if (settings.pulseWaveFlash !== false) {
      if (!_sharedFlashGeo) _sharedFlashGeo = new THREE.SphereGeometry(0.5, 16, 16);
      flashMat = new THREE.MeshBasicMaterial({
        color: 0xffffff, transparent: true, opacity: 1.0,
        blending: THREE.AdditiveBlending, depthWrite: false
      });
      flash = new THREE.Mesh(_sharedFlashGeo, flashMat);
      flash.position.copy(billboardPos);
      scene.add(flash);
    }

    captureEffects.push({
      coreMesh, glowMesh, coreGeo, glowGeo, coreMat, glowMat,
      edgeDistances, vertsPerTube,
      particles, particleMat, particleVelocities,
      flash, flashMat,
      originX, originZ,
      time: 0,
      duration: settings.pulseWaveDuration || 5.0,
      pulseSpeed: settings.pulseWaveSpeed || 3.5,
      pulseWidth: settings.pulseWaveWidth || 1.5,
      intensity: settings.pulseWaveIntensity || 0.8,
      easing: settings.pulseWaveEasing || "easeOut"
    });
  }

  // Easing functions for pulse wave
  function applyEasing(t, easing) {
    switch (easing) {
      case "easeOut":
        return 1 - Math.pow(1 - t, 3); // Cubic ease out - starts fast, slows down
      case "easeIn":
        return Math.pow(t, 3); // Cubic ease in - starts slow, speeds up
      case "easeInOut":
        return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
      case "linear":
      default:
        return t;
    }
  }

  function updateCaptureEffects(dt) {
    for (let i = captureEffects.length - 1; i >= 0; i--) {
      const effect = captureEffects[i];
      effect.time += dt;
      const t = effect.time / effect.duration;

      if (t >= 1) {
        // Remove effect — positions are cached, only dispose alpha + materials
        if (effect.coreMesh) { scene.remove(effect.coreMesh); effect.coreMat.dispose(); }
        if (effect.glowMesh) { scene.remove(effect.glowMesh); effect.glowMat.dispose(); }
        if (effect.coreGeo) { effect.coreGeo.deleteAttribute('alpha'); effect.coreGeo.dispose(); }
        if (effect.glowGeo) { effect.glowGeo.deleteAttribute('alpha'); effect.glowGeo.dispose(); }
        scene.remove(effect.particles);
        effect.particles.geometry.dispose();
        effect.particleMat.dispose();
        if (effect.flash) {
          scene.remove(effect.flash);
          effect.flashMat.dispose();
        }
        captureEffects.splice(i, 1);
        continue;
      }

      // Apply easing to the animation progress
      const easedT = applyEasing(t, effect.easing);
      const maxRadius = effect.pulseSpeed * effect.duration;
      const pulseRadius = easedT * maxRadius;
      const fadeOut = t > 0.7 ? (t - 0.7) / 0.3 : 0;

      // Update per-vertex alpha on the batched meshes
      if (effect.coreGeo && effect.edgeDistances.length > 0) {
        const coreAlphas = effect.coreGeo.attributes.alpha.array;
        const glowAlphas = effect.glowGeo.attributes.alpha.array;
        const vpte = effect.vertsPerTube;

        for (let e = 0; e < effect.edgeDistances.length; e++) {
          const distFromPulse = Math.abs(effect.edgeDistances[e] - pulseRadius);
          let coreA = 0, glowA = 0;
          if (distFromPulse < effect.pulseWidth) {
            const normalizedDist = distFromPulse / effect.pulseWidth;
            const smoothFalloff = Math.exp(-normalizedDist * normalizedDist * 4);
            const opacity = smoothFalloff * effect.intensity * (1 - fadeOut);
            coreA = Math.min(1, opacity);
            glowA = Math.min(0.4, opacity * 0.4);
          }
          const base = e * vpte;
          for (let v = 0; v < vpte; v++) {
            coreAlphas[base + v] = coreA;
            glowAlphas[base + v] = glowA;
          }
        }
        effect.coreGeo.attributes.alpha.needsUpdate = true;
        effect.glowGeo.attributes.alpha.needsUpdate = true;
      }

      // Animate particles with physics
      const positions = effect.particles.geometry.attributes.position.array;
      for (let j = 0; j < effect.particleVelocities.length; j++) {
        const vel = effect.particleVelocities[j];
        positions[j * 3] += vel.x * dt;
        positions[j * 3 + 1] += vel.y * dt;
        positions[j * 3 + 2] += vel.z * dt;
        // Light gravity
        vel.y -= 3 * dt;
        // Strong air resistance to keep particles close
        vel.x *= 0.95;
        vel.y *= 0.97;
        vel.z *= 0.95;
      }
      effect.particles.geometry.attributes.position.needsUpdate = true;
      effect.particleMat.opacity = Math.max(0, 1 - t * 1.2);
      effect.particleMat.size = 0.25 * (1 - t * 0.3);

      // Animate flash - quick bright flash that fades
      if (effect.flash) {
        const flashT = Math.min(1, effect.time * 5);
        effect.flashMat.opacity = Math.max(0, 1 - flashT);
        effect.flash.scale.setScalar(1 + flashT * 2);
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

    // Mid-edge juke: small chance of reversing direction when a chaser is close
    const midEdgeJukeChance = settings.fugitiveMidEdgeJukeChance || 0.03;
    if (midEdgeJukeChance > 0 && actor.edgeT > 0.1 && actor.edgeT < 0.9) {
      let nearestChaserDist = Infinity;
      for (const c of chasers) {
        if (!c.active) continue;
        const dx = pos.x - c.mesh.position.x;
        const dz = pos.z - c.mesh.position.z;
        nearestChaserDist = Math.min(nearestChaserDist, Math.sqrt(dx * dx + dz * dz));
      }
      const dangerRadius = settings.fugitiveDangerRadius || 4;
      if (nearestChaserDist < dangerRadius && Math.random() < midEdgeJukeChance * dt) {
        actor.edgeDir *= -1;
        actor.dirX *= -1;
        actor.dirZ *= -1;
      }
    }

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
    const intelligence = STATE.fugitiveIntelligenceOverride != null ? STATE.fugitiveIntelligenceOverride : settings.fugitiveIntelligence;
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
      // Unpredictable juke: occasionally pick a random non-worst direction
      const jukeChance = settings.fugitiveJukeChance || 0.15;
      if (available.length > 1 && Math.random() < jukeChance) {
        const scored = available.map(dir => ({
          dir,
          score: dir.dirX * threatX + dir.dirZ * threatZ
        })).sort((a, b) => b.score - a.score);
        const jukeOptions = scored.slice(0, -1);
        chosen = jukeOptions[Math.floor(Math.random() * jukeOptions.length)].dir;
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
    statsPanel.begin();
    const t = timestamp / 1000;
    const dt = STATE.lastTime ? Math.min(t - STATE.lastTime, 0.05) : 0;
    STATE.lastTime = t;

    // Handle projection pump during STARTING state
    if (STATE.loaded && STATE.gameState === "STARTING") {
      updateProjectionPump(dt);
    }

    // Fugitive light fade-in during PLAYING
    if (STATE.fugitiveLightFadeStart && STATE.gameState === "PLAYING") {
      const elapsed = (performance.now() - STATE.fugitiveLightFadeStart) / 1000;
      const fadeDuration = 3; // seconds
      const t = Math.min(elapsed / fadeDuration, 1);
      const target = settings.fugitiveLightIntensity;
      for (const f of fugitives) {
        if (f.light && f.light.visible) f.light.intensity = target * t;
      }
      if (t >= 1) STATE.fugitiveLightFadeStart = null;
    }

    // Handle gameplay during PLAYING state
    if (STATE.loaded && STATE.gameState === "PLAYING" && !STATE.gameOver) {
      // Update game timer
      if (STATE.gameTimerStarted && STATE.gameTimerRemaining > 0) {
        STATE.gameTimerRemaining -= dt;

        // Decrease fugitive value over time (250 points over ~100 seconds = 2.5/sec)
        STATE.fugitiveValue = Math.max(0, STATE.fugitiveValue - 2.5 * dt);

        updateTimerDisplay();

        // Time's up!
        if (STATE.gameTimerRemaining <= 0) {
          STATE.gameTimerRemaining = 0;
          setGameState("GAME_OVER");
        }
      }

      updateBoosts(boostStates, dt);
      updateGame(dt);
    }

    // Handle score display countdown and reset (only if not entering high score)
    if (STATE.showingScore && !STATE.enteringHighScore) {
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

      // Update helicopter, lamps, cars audio, text pulse, atmosphere and capture effects
      updateHelicopter(dt);
      updateSearchlights(dt);
      updateLamps();
      updateCarsAudio();
      updateTextBPMPulse();
      updateCaptureEffects(dt);
      updateAtmosphere(dt);

      // Update glass canvas for video/marquee/shuffle animation/high score entry/game over
      if (settings.glassEnabled && glassCanvas && (settings.glassTextMarquee || (settings.glassVideoEnabled && glassVideoReady) || isShuffleActive() || STATE.enteringHighScore || STATE.gameOver)) {
        updateGlassCanvas(timestamp);
      }
    }

    // Update chaser light debug helpers
    for (const h of chaserLightHelpers) h.update();

    // Render with post-processing (EffectComposer)
    if (composer) {
      composer.render();
    } else {
      renderer.render(scene, camera);
    }

    statsPanel.end();
  }

  function updateGame(dt) {
    if (!STATE.loaded) return;

    const activeChaserCount = STATE.activeChaserCount;
    const readyCount = chasers.filter(c => c.ready).length;
    let chaserSpeedBonus = 0;
    let fugitiveSpeedBonus = 0;
    let fugitiveIntelligenceOverride = null;

    if (activeChaserCount === 1) {
      chaserSpeedBonus = 0.1;
    } else if (activeChaserCount === 2) {
      chaserSpeedBonus = 0.05;
    } else if (activeChaserCount === 3) {
      fugitiveSpeedBonus = 0.1;
    } else if (activeChaserCount >= 4) {
      fugitiveSpeedBonus = 0.2;
    }

    // Multi-player difficulty scaling: when enough players, max out fugitive AI and slow chasers
    if (readyCount >= settings.multiPlayerThreshold) {
      fugitiveIntelligenceOverride = settings.multiPlayerFugitiveIntelligence;
      chaserSpeedBonus -= settings.multiPlayerChaserSpeedPenalty;
    }
    STATE.fugitiveIntelligenceOverride = fugitiveIntelligenceOverride;

    for (const f of fugitives) {
      if (f.captured) continue;
      f.speed = settings.fugitiveSpeed + fugitiveSpeedBonus;
      // Proximity speed boost when a chaser is within danger radius
      let nearestChaserDist = Infinity;
      for (const c of chasers) {
        if (!c.active) continue;
        const dx = f.mesh.position.x - c.mesh.position.x;
        const dz = f.mesh.position.z - c.mesh.position.z;
        nearestChaserDist = Math.min(nearestChaserDist, Math.sqrt(dx * dx + dz * dz));
      }
      if (nearestChaserDist < (settings.fugitiveDangerRadius || 4) && Math.random() < 0.3) {
        f.speed *= settings.fugitiveDangerSpeedMultiplier || 1.4;
      }
      if (f.currentEdge) {
        updateFugitiveMovementPath(f, dt);
      }
    }

    for (let i = 0; i < chasers.length; i++) {
      const chaser = chasers[i];

      const inputDir = getChaserInputDirection(i);
      if (!chaser.active && inputDir.hasInput) {
        if (DEBUG) console.log(`Chaser ${i} activated by input:`, inputDir);
        chaser.active = true;
        STATE.activeChaserCount++;

        // Initialize on path when first activated
        if (!chaser.currentEdge) {
          initActorOnPath(chaser);
        }

        // Set full opacity when activated (material is already configured for transparency)
        if (chaser.light) chaser.light.visible = true;

        if (chaser.isCarModel && chaser.mesh) {
          chaser.mesh.traverse((child) => {
            if (child.isMesh && child.material) {
              child.material.opacity = 1.0;
              child.material.depthWrite = true;
            }
          });
        } else if (chaser.material) {
          chaser.material.opacity = 1.0;
          chaser.material.depthWrite = true;
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

      const boostMul = getBoostMultiplier(boostStates, i, settings);
      chaser.speed = (settings.chaserSpeed + chaserSpeedBonus) * boostMul;

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
          // Mark as captured
          f.captured = true;
          STATE.capturedCount = (STATE.capturedCount || 0) + 1;
          playSFX("capture", i);

          // Add score based on current fugitive value
          const points = Math.max(0, Math.floor(STATE.fugitiveValue));
          STATE.playerScore += points;

          // Get chaser color for the effect
          const chaserColors = [settings.chaser1Color, settings.chaser2Color, settings.chaser3Color, settings.chaser4Color];
          const chaserColor = chaserColors[i] || "#ffffff";

          // Get billboard before hiding
          const wire = fugitiveWires[f.index];
          const billboard = wire ? wire.billboard : null;

          // Create capture effect at fugitive position
          createCaptureEffect(f.mesh.position.clone(), chaserColor, billboard);

          // Hide fugitive
          f.mesh.position.y = -1000;
          if (f.light) f.light.intensity = 0;

          if (wire) {
            if (wire.billboard) wire.billboard.visible = false;
          }
          break; // One capture per chaser per frame
        }
      }
    }

    if (STATE.capturedCount >= fugitives.length && !STATE.gameOver) {
      setGameState("GAME_OVER");
    }
  }

  // ============================================
  // LOAD LEVEL
  // ============================================

  const loader = new GLTFLoader();
  loader.setKTX2Loader(ktx2Loader);

  // Register loading items: level, building texture, cars, helicopter
  const carPaths = PATHS.models.cars || [];
  loadingProgress.register(3 + carPaths.length);

  // Load level GLB - use ROADS mesh from within it for navmesh
  new Promise((resolve, reject) => {
    loader.load(PATHS.models.level, resolve, undefined, reject);
  }).then((levelGltf) => {
    loadingProgress.complete();
    const gltf = levelGltf;
    const root = gltf.scene;

    // Store window and lamp meshes for emissive control
    const windowMeshes = [];
    const lampMeshes = [];

    const roadMeshes = [];
    const pathMeshes = [];
    const otherEmissiveMeshes = [];

    root.traverse((obj) => {
      if (obj.isMesh) {
        const nameUpper = (obj.name || "").toUpperCase();
        // Glass meshes don't cast shadows so helicopter light shines through
        const isGlass = nameUpper.includes("GLASS");
        const isWindow = nameUpper.includes("WINDOW");
        const isLamp = nameUpper.includes("LAMP");
        const isRoad = nameUpper.includes("ROAD");
        const isPath = nameUpper.includes("PATH");
        const isLeaf = nameUpper.includes("LEAF") || nameUpper.includes("LEAVES");
        obj.castShadow = true;
        obj.receiveShadow = !isGlass;
        if (isLeaf && obj.material) {
          const mats = Array.isArray(obj.material) ? obj.material : [obj.material];
          for (const mat of mats) {
            mat.side = THREE.DoubleSide;
            mat.transparent = true;
            mat.opacity = 0.95;
          }
        }

        const globalMult = settings.globalEmissiveMultiplier || 1.0;

        // Categorize emissive meshes
        if (isWindow && obj.material) {
          windowMeshes.push(obj);
          const mat = obj.material;
          if (mat.emissive) {
            mat.emissiveIntensity = (settings.windowEmissiveIntensity || 2.0) * globalMult;
          }
        } else if (isLamp && obj.material) {
          lampMeshes.push(obj);
          const mat = obj.material;
          if (mat.emissive) {
            // Resolve lamp color through full glbParts chain (defaults + per-part overrides)
            const resolved = getGLBPartDefaults(obj.name, { color: "#ffffaa" });
            mat.emissive.set(resolved.color);
            if (mat.color) mat.color.set(resolved.color);
            mat.emissiveIntensity = (settings.lampEmissiveIntensity || 2.0) * globalMult;
          }
        } else if (isRoad && obj.material) {
          roadMeshes.push(obj);
          const mat = obj.material;
          if (mat.emissive) {
            mat.emissiveIntensity = (settings.roadEmissiveIntensity || 1.0) * globalMult;
          }
          // Strip normal map at load if toggled off
          if (!settings.roadNormalMap && mat.normalMap) {
            mat._savedNormalMap = mat.normalMap;
            mat.normalMap = null;
            mat.needsUpdate = true;
          }
        } else if (isPath && obj.material) {
          pathMeshes.push(obj);
          const mat = obj.material;
          if (mat.emissive) {
            mat.emissiveIntensity = (settings.pathEmissiveIntensity || 1.0) * globalMult;
          }
        } else if (obj.material && obj.material.emissive && obj.material.emissiveIntensity > 0) {
          // Catch any other emissive meshes
          otherEmissiveMeshes.push(obj);
          obj.material.emissiveIntensity = (settings.otherEmissiveIntensity || 1.0) * globalMult;
        }
      }
      if (obj.isCamera) {
        glbCameras.push({ name: obj.name || `GLB Camera ${glbCameras.length + 1}`, camera: obj });
      }
    });

    // Also check gltf.cameras (GLTFLoader may not add cameras to the scene graph)
    if (gltf.cameras) {
      for (const cam of gltf.cameras) {
        if (!glbCameras.find(c => c.camera === cam)) {
          glbCameras.push({ name: cam.name || `GLB Camera ${glbCameras.length + 1}`, camera: cam });
        }
      }
    }

    STATE.windowMeshes = windowMeshes;
    STATE.lampMeshes = lampMeshes;
    STATE.roadMeshes = roadMeshes;
    STATE.pathMeshes = pathMeshes;
    STATE.otherEmissiveMeshes = otherEmissiveMeshes;

    if (DEBUG) console.log("Emissive meshes found - Windows:", windowMeshes.length, "Lamps:", lampMeshes.length, "Roads:", roadMeshes.length, "Paths:", pathMeshes.length, "Other:", otherEmissiveMeshes.length);

    const levelContainer = new THREE.Group();
    levelContainer.add(root);
    scene.add(levelContainer);
    STATE.levelContainer = levelContainer;

    // Assign GLB layer for selective pixelation and apply anisotropic filtering to textures
    const maxAnisotropy = renderer.capabilities.getMaxAnisotropy();
    levelContainer.traverse(child => {
      if (child.isMesh) {
        child.layers.set(LAYERS.GLB_MODELS);
        // Apply anisotropic filtering to all textures for sharper roads/ground at angles
        if (child.material) {
          const mats = Array.isArray(child.material) ? child.material : [child.material];
          for (const mat of mats) {
            if (mat.map) mat.map.anisotropy = maxAnisotropy;
            if (mat.normalMap) mat.normalMap.anisotropy = maxAnisotropy;
            if (mat.roughnessMap) mat.roughnessMap.anisotropy = maxAnisotropy;
            if (mat.metalnessMap) mat.metalnessMap.anisotropy = maxAnisotropy;
          }
        }
      }
    });

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
        if (DEBUG) console.log(`Found chaser spawn C${i}:`, worldPos);
      } else {
        console.warn(`Missing chaser spawn marker C${i} in GLB!`);
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
      if (obj.isMesh && obj.name) {
        if (obj.name.toUpperCase().includes("GLASS")) {
          foundGlassMeshes.push(obj);
        }
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
      if (DEBUG) console.log(`Found ${navNodes.length} Nav nodes for path grid`);
    } else {
      if (DEBUG) console.log("No Nav nodes found - add objects with names starting with 'Nav' in Blender");
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
    STATE.levelSizeX = size.x;
    STATE.levelSizeZ = size.z;

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

      if (DEBUG) console.log(`Spawn-based path: ${nodes.length} nodes, ${edges.length} edges`);
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

      if (DEBUG) console.log(`Nav grid: ${nodes.length} nodes, ${edges.length} edges`);
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

      if (DEBUG) console.log(`Path visualization: ${source.toUpperCase()} - ${pathGraph.edges.length} edges, ${pathGraph.nodes.length} nodes`);

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

      if (DEBUG) console.log(`Path graph updated: ${pathGraph.nodes.length} nodes, ${pathGraph.edges.length} edges`);
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

    // If GLB contains cameras, add them to the GUI dropdown and use MainCamera if found
    if (glbCameras.length > 0) {
      const cameraOptions = ["orthographic", "perspective", ...glbCameras.map(c => c.name)];
      // Update GUI dropdown if it exists
      if (guiLeft) {
        const ctrl = guiLeft.controllersRecursive().find(c => c.property === "cameraType");
        if (ctrl) {
          ctrl._values = cameraOptions;
          ctrl.options(cameraOptions);
        }
      }
      // Default to MainCamera if available
      const mainCam = glbCameras.find(c => c.name.toUpperCase() === "MAINCAMERA");
      if (mainCam) {
        switchCamera(mainCam.name);
      }
    }

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
        loadingProgress.complete();
        buildingPlane.material.map = texture;
        buildingPlane.material.color.set(0xffffff);
        buildingPlane.material.needsUpdate = true;
      },
      undefined,
      (error) => {
        loadingProgress.complete();
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
      mesh.visible = false; // Hide the cube, only show wire and billboard
      mesh.castShadow = false;
      mesh.receiveShadow = false;

      const light = null; // Fugitive lights disabled for performance

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
        spawnX: roadPoint.x,
        spawnZ: roadPoint.z,
      });

      const wire = new ActorWire(fugitives[fugitives.length - 1], actorSize, fugitiveColor, false, i);
      fugitiveWires.push(wire);
    }

    const chaserColors = [settings.chaser1Color, settings.chaser2Color, settings.chaser3Color, settings.chaser4Color];

    // Load car models for chasers
    const carPaths = PATHS.models.cars || [];
    if (DEBUG) console.log("Car paths to load:", carPaths);
    const carPromises = carPaths.map(path =>
      new Promise((resolve) => {
        loader.load(path,
          (gltf) => {
            loadingProgress.complete();
            if (DEBUG) console.log("Loaded car:", path);
            resolve(gltf.scene);
          },
          undefined,
          (err) => {
            loadingProgress.complete();
            console.error("Failed to load car:", path, err);
            resolve(null);
          }
        );
      })
    );

    Promise.all(carPromises).then((carModels) => {
      if (DEBUG) console.log("Car models loaded:", carModels.filter(m => m !== null).length, "of", carModels.length);

      for (let i = 0; i < chaserSpawns.length; i++) {
        const color = chaserColors[i] || chaserColors[0];

        let mesh;
        // Use a different car model for each chaser, cycling if fewer models than chasers
        const carModel = carModels.length > 0 ? carModels[i % carModels.length] : null;

        if (carModel) {
          mesh = carModel.clone();
          // Scale car to fit actor size
          const box = new THREE.Box3().setFromObject(mesh);
          const size = new THREE.Vector3();
          box.getSize(size);
          const maxDim = Math.max(size.x, size.y, size.z);
          const scale = (actorSize * 2) / maxDim; // Make car 2x actor size for visibility
          mesh.scale.setScalar(scale);
          if (DEBUG) console.log(`Chaser ${i}: using car model, scale=${scale.toFixed(3)}, size=${maxDim.toFixed(2)}`);

          // Apply color to all meshes in the car
          mesh.traverse((child) => {
            child.visible = true;
            if (child.isMesh) {
              child.castShadow = false; // Don't cast shadows so lights pass through other chasers
              child.receiveShadow = true;
              // Assign GLB layer for selective pixelation
              child.layers.set(LAYERS.GLB_MODELS);
              // Store original material for reference
              child.userData.originalMaterial = child.material;
              child.material = new THREE.MeshStandardMaterial({
                color: color,
                emissive: color,
                emissiveIntensity: 0.05,
                transparent: true,
                opacity: 0.1,
                depthWrite: false,
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
            emissiveIntensity: 0.05,
            transparent: true,
            opacity: 0.1,
            depthWrite: false,
          });
          mesh = new THREE.Mesh(chaserGeo, material);
          mesh.castShadow = true;
          mesh.receiveShadow = true;
          // Assign GLB layer for selective pixelation
          mesh.layers.set(LAYERS.GLB_MODELS);
        }

        // Create spotlight as headlight at the front of the car
        const angleRad = (settings.chaserLightAngle * Math.PI) / 180;
        const light = new THREE.SpotLight(color, 0, settings.chaserLightDistance, angleRad, settings.chaserLightPenumbra, 1);
        const meshScale = mesh.scale.y || 1;
        // Position at front of car (local Z-) and at set height (negative due to car flip)
        light.position.set((settings.chaserLightOffsetX || 0) / meshScale, settings.chaserLightHeight / meshScale, -settings.chaserLightOffset / meshScale);
        light.castShadow = true;
        light.shadow.mapSize.width = 1024;
        light.shadow.mapSize.height = 1024;
        light.shadow.camera.near = 0.1;
        light.shadow.camera.far = settings.chaserLightDistance || 50;
        light.shadow.bias = -0.001;

        // Create target for spotlight - point forward from the car (negative Z due to car flip)
        const lightTarget = new THREE.Object3D();
        lightTarget.position.set(
          (settings.chaserLightTargetX || 0) / meshScale,
          (settings.chaserLightTargetY || 0) / meshScale,
          (settings.chaserLightTargetZ !== undefined ? settings.chaserLightTargetZ : -5) / meshScale
        );
        mesh.add(lightTarget);
        light.target = lightTarget;
        mesh.add(light);

        const spawnPos = chaserSpawns[i];
        const roadPoint = findNearestRoadPoint(spawnPos.x, spawnPos.z);

        mesh.position.set(roadPoint.x, 0, roadPoint.z);
        projectYOnRoad(mesh.position);
        mesh.position.y += settings.chaserHeightOffset;
        // Set initial facing direction: C1, C3 face left; C2, C4 face right
        mesh.rotation.y = (i === 0 || i === 2) ? Math.PI / 2 : -Math.PI / 2;
        mesh.visible = true;

        // Cache materials for efficient per-frame updates
        const cachedMaterials = [];
        mesh.traverse((child) => {
          if (child.isMesh && child.material) {
            cachedMaterials.push(child.material);
          }
        });

        const chaserObj = {
          mesh,
          light,
          lightTarget,
          material: null, // Materials are on child meshes now
          cachedMaterials, // Cached for efficient per-frame updates
          speed: settings.chaserSpeed,
          dirX: 0,
          dirZ: 0,
          queuedDirX: 0,
          queuedDirZ: 0,
          active: false,
          ready: false, // Player has pressed keys to indicate they're ready
          isMoving: false,
          isCarModel: !!carModel,
          spawnX: roadPoint.x,
          spawnZ: roadPoint.z,
          spawnRotationY: mesh.rotation.y,
        };
        scene.add(mesh);
        chasers.push(chaserObj);
      }

      // Set initial low opacity for all chasers (PRE_GAME state)
      setChasersOpacity(0.1);
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
    loadingProgress.finish();

    setupGUI();
    initPostProcessing();
    initAtmosphere();
    initAudio();
    initSFX();
    loadHelicopter();
    updateHelicopterBoundsHelper();
    setupSearchlights();


    // Load path graph from GLB and initialize actors
    rebuildPathGraph();
    if (DEBUG) console.log("Path graph ready");
    setupGLBPartsGUI();

    // Ensure glass text is always enabled and static (no marquee)
    settings.glassEnabled = true;
    settings.glassTextMarquee = false;
    settings.glassTextShuffle = true; // Enable shuffle effect when text changes
    for (const mesh of glassMeshes) {
      mesh.visible = true;
    }

    // Initialize projection plane
    initProjectionPlane();

    // Pre-warm shaders: temporarily render all billboards to force GPU compilation
    // This avoids lag spikes when fugitives first appear during gameplay
    for (const wire of fugitiveWires) {
      if (wire.billboard) wire.billboard.scale.setScalar(0.001);
    }
    renderer.compile(scene, camera);
    renderer.render(scene, camera);
    for (const wire of fugitiveWires) {
      if (wire.billboard) wire.billboard.scale.setScalar(0);
    }

    // Initialize game state to PRE_GAME
    setGameState("PRE_GAME");

    // Apply performance overrides and mobile overlay when not in facade mode
    if (!isFacadeMode) {
      applyMobileMode(true);
    }

    // Ensure text renders after fonts are loaded (slight delay for safety)
    setTimeout(() => {
      if (STATE.gameState === "PRE_GAME") {
        setGameState("PRE_GAME"); // Re-apply to ensure text is visible
      }
    }, 100);

    statusEl.textContent = "Ready! Press any movement key to start.";
  }).catch((err) => {
    console.error("Error loading GLB files", err);
    statusEl.textContent = "Failed to load GLB files (see console).";
  });

  animate(0);
})();
