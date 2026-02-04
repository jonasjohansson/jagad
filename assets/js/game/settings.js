// Game settings configuration

export const STORAGE_KEY = "jagadSettings";

export const defaultSettings = {
  fugitiveSpeed: 1.0,
  chaserSpeed: 1,
  actorScale: 1.0,
  fugitiveIntelligence: 0.85,
  fugitiveColor: "#ffffff",
  fugitiveLightIntensity: 6,
  faceSwapDuration: 30,
  faceSwapFade: false,
  faceSwapFadeDuration: 1.0,
  chaser1Color: "#FF2FD4",
  chaser2Color: "#FF7A00",
  chaser3Color: "#216BFF",
  chaser4Color: "#FDFF4A",
  chaserLightIntensity: 200,
  chaserLightHeight: 0.1,
  chaserLightDistance: 50,
  chaserLightAngle: 35,
  chaserLightPenumbra: 1,
  chaserLightOffset: 0.1,
  chaserHeightOffset: -0.03,
  cameraType: "perspective",
  orthoZoom: 1,
  perspFov: 20,
  perspNear: 0.1,
  perspFar: 5000,
  perspPosX: 0.04,
  perspPosY: 33,
  perspPosZ: 10,
  // Lighting
  toneMapping: "Neutral",
  exposure: 0.5,
  environmentIntensity: 10,
  punctualLights: true,
  ambientIntensity: 2.0,
  ambientColor: "#ffffff",
  directIntensity: 5,
  directColor: "#ffffff",
  directPosX: 2,
  directPosY: 15,
  directPosZ: 5,
  wireEnabled: true,
  wireSegments: 12,
  wireHeight: 3,
  wireGravity: 0.15,
  wireFriction: 0.92,
  wireIterations: 3,
  wireCubeSize: 2,
  billboardBrightness: 1.0,
  billboardContrast: 1.8,
  billboardCenterPull: 0.01,
  billboardMaxDistance: 0,
  billboardLightIntensity: 5,
  billboardLightDistance: 3,
  showNavmesh: false,
  buildingEnabled: true,
  buildingScaleX: 1.15,
  buildingScaleY: 1.12,
  buildingOffsetX: 0.11,
  buildingOffsetY: -0.01,
  buildingOffsetZ: 0.65,
  buildingOpacity: 1.0,
  bloomEnabled: true,
  bloomThreshold: 0.5,
  bloomStrength: 0.2,
  bloomRadius: 1.0,
  fxaaEnabled: false,
  // Pixelation
  pixelationEnabled: false,
  pixelationSize: 4,
  pixelationNormalEdge: 0.3,
  pixelationDepthEdge: 0.4,
  // Cyberpunk VFX
  vignetteEnabled: false,
  vignetteIntensity: 0.2,
  chromaticAberration: 0,
  colorGradingEnabled: true,
  colorGradingTint: "#ff00ff",
  colorGradingIntensity: 0,
  colorGradingSaturation: 1.2,
  colorGradingContrast: 1.1,
  // Atmosphere
  fogEnabled: false,
  fogColor: "#1a0a2e",
  fogNear: 15,
  fogFar: 60,
  dustEnabled: false,
  dustCount: 200,
  dustOpacity: 0.4,
  // Rain
  rainEnabled: false,
  rainCount: 1000,
  rainSpeed: 15,
  rainOpacity: 0.4,
  // Cloud shadows
  cloudShadowsEnabled: true,
  cloudShadowsSpeed: 0.3,
  cloudShadowsOpacity: 0.3,
  cloudShadowsScale: 15,
  // Motion trails
  motionTrailsEnabled: false,
  motionTrailsLength: 5,
  motionTrailsOpacity: 0.3,
  motionTrailsSize: 0.15,
  windowEmissiveIntensity: 2.0,
  lampEmissiveIntensity: 2.0,
  roadEmissiveIntensity: 1.0,
  pathEmissiveIntensity: 1.0,
  otherEmissiveIntensity: 1.0,
  globalEmissiveMultiplier: 1.0,
  lampAudioReactive: false,
  lampAudioSensitivity: 3.0,
  carAudioReactive: true,
  carAudioBPM: 95,
  carAudioIntensity: 10,
  textBPMPulse: true,
  textBPMIntensity: 0.5,
  glassEnabled: true,
  glassOpacity: 0.8,
  glassMaterialOpacity: 0.5,
  glassPosX: 0,
  glassPosY: 0,
  glassPosZ: 0,
  glassRotX: 0,
  glassVideoEnabled: false,
  glassVideoOpacity: 0.2,
  glassVideoBrightness: 1.0,
  // Glass text builder
  glassTextEnabled: true,
  glassTextRow1: "JAGAD",
  glassTextRow2: "THE CHASE IS ON",
  glassTextRow3: "CATCH THEM ALL",
  glassTextRow4: "LIVE NOW",
  glassTextFontSize: 60,
  glassTextLineHeight: 2.5,
  glassTextFont: "BankGothic",
  glassTextColor: "#ffffff",
  glassTextBrightness: 2,
  glassTextAlign: "center",
  glassTextOffsetX: -47,
  glassTextOffsetY: -254.1,
  glassTextLetterSpacing: 0,
  glassTextMonospace: true,
  glassTextCharWidth: 91,
  glassTextMarquee: false,
  glassTextMarqueeSpeed: 10,
  glassTextRowDelay: 200,
  glassTextShuffle: true,
  glassTextShuffleSpeed: 1.5,
  glassTextShuffleChars: "ABCDEFGHIJKLMNOPQRSTUVWXYZ@#$%&*!?",
  glassTextShuffleCharDelay: 500,
  // Iframe Planes
  leftPanelEnabled: true,
  // 4 independent corners (counter-clockwise from top-left)
  leftPanelC1X: -5.24,
  leftPanelC1Z: 3.43,
  leftPanelC2X: -1.15,
  leftPanelC2Z: 3.38,
  leftPanelC3X: -1.16,
  leftPanelC3Z: 4.34,
  leftPanelC4X: -5.25,
  leftPanelC4Z: 4.36,
  rightPanelEnabled: true,
  // 4 independent corners (counter-clockwise from top-left)
  rightPanelC1X: 0.24,
  rightPanelC1Z: 3.4,
  rightPanelC2X: 5.21,
  rightPanelC2Z: 3.42,
  rightPanelC3X: 5.21,
  rightPanelC3Z: 4.29,
  rightPanelC4X: 0.24,
  rightPanelC4Z: 4.28,
  // Audio
  audioVolume: 0.5,
  audioTrack: "triumph-hill",
  // Helicopter
  helicopterEnabled: true,
  helicopterColor: "#57ff81",
  helicopterHeight: 4,
  helicopterSpeed: 0.5,
  helicopterRadius: 6,
  helicopterScale: 0.5,
  helicopterLightIntensity: 500,
  helicopterLightColor: "#ffffff",
  helicopterLightAngle: 10,
  helicopterLightDistance: 50,
  helicopterVolumetric: true,
  helicopterVolumetricOpacity: 0.5,
  helicopterConeOffsetY: 0.5,
  helicopterConeHeight: 30,
  helicopterConeTopRadius: 0.1,
  helicopterConeBottomRadius: 5,
  helicopterSearchlightSway: 1.5,
  helicopterSearchlightSpeed: 0.7,
  // Helicopter boundary limits
  helicopterBoundsMinX: -4.5,
  helicopterBoundsMaxX: 4.5,
  helicopterBoundsMinZ: -1.2,
  helicopterBoundsMaxZ: 2.8,
  helicopterShowBounds: false,
  // Clouds
  cloudsEnabled: true,
  cloudCount: 3,
  cloudOpacity: 0.6,
  cloudScaleMin: 2,
  cloudScaleMax: 5,
  cloudHeightMin: 5,
  cloudHeightMax: 10,
  cloudSpeedMin: 0.3,
  cloudSpeedMax: 0.8,
  cloudBlending: "Normal",

  // Pulse Wave (capture effect)
  pulseWaveEnabled: true,
  pulseWaveSpeed: 3.5,
  pulseWaveWidth: 1.5,
  pulseWaveDuration: 5.0,
  pulseWaveIntensity: 0.8,
  pulseWaveTubeHeight: 0.12,
  pulseWaveEasing: "easeOut",
  pulseWaveGlow: 3.0,
  pulseWaveParticles: true,
  pulseWaveFlash: true,

  // Mobile
  mobileEnabled: false,
  mobileOrthoZoom: 0.5,
  mobileOrthoOffsetZ: 0.6,

  // Game States
  gameState: "PRE_GAME", // PRE_GAME, STARTING, PLAYING, GAME_OVER
  countdownDuration: 3, // Seconds for countdown before game starts

  // Pre-game state text
  preGameTextRow1: "",
  preGameTextRow2: "",
  preGameTextRow3: "JAGAD",
  preGameTextRow4: "",

  // Starting state text (supports ${countdown} for 3, 2, 1, GO!)
  startingTextRow1: "",
  startingTextRow2: "${countdown}",
  startingTextRow3: "",
  startingTextRow4: "",

  // Playing state text (supports ${score}, ${time}, ${caught}, ${total}, ${status})
  playingTextRow1: "",
  playingTextRow2: "TIME:${time}",
  playingTextRow3: "SCORE:${score}",
  playingTextRow4: "",

  // Game Over state text (supports ${score}, ${time}, ${caught}, ${total}, ${status}, ${initials}, ${s1}, ${s2}, ${s3}, ${hs1i}, ${hs1s}, ${hs2i}, ${hs2s}, ${hs3i}, ${hs3s})
  gameOverTextRow1: "${initials} ${score}",
  gameOverTextRow2: "${s1}",
  gameOverTextRow3: "${s2}",
  gameOverTextRow4: "${s3}",

  // State projection images
  preGameImage: "pre-game.png",
  startingImage: "",
  playingImage: "",
  gameOverImage: "",
  projectionOpacity: 0.55,
  projectionScale: 0.25,
  projectionOffsetX: 0,
  projectionOffsetY: 0.02,
  projectionOffsetZ: 0.3,

  // High Scores (array of {initials: "AAA", score: 0})
  highScores: [
    { initials: "AAA", score: 999 },
    { initials: "BBB", score: 500 },
    { initials: "CCC", score: 100 }
  ],
};

export function loadSettings() {
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

export function saveSettings(settings) {
  const toSave = {};
  for (const key of Object.keys(defaultSettings)) {
    toSave[key] = settings[key];
  }
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(toSave));
    return true;
  } catch (e) {
    console.error("Failed to save settings:", e);
    return false;
  }
}

export function clearSettings() {
  try {
    localStorage.removeItem(STORAGE_KEY);
    return true;
  } catch (e) {
    console.error("Failed to clear settings:", e);
    return false;
  }
}

export function exportSettings(settings) {
  const toExport = {};
  for (const key of Object.keys(defaultSettings)) {
    toExport[key] = settings[key];
  }
  const json = JSON.stringify(toExport, null, 2);
  const blob = new Blob([json], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "jagad-settings.json";
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

export function importSettings(callback) {
  const input = document.createElement("input");
  input.type = "file";
  input.accept = ".json";
  input.onchange = (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (event) => {
      try {
        const imported = JSON.parse(event.target.result);
        const merged = { ...defaultSettings, ...imported };
        callback(merged);
      } catch (err) {
        console.error("Failed to import settings:", err);
        alert("Failed to import settings: Invalid JSON file");
      }
    };
    reader.readAsText(file);
  };
  input.click();
}
