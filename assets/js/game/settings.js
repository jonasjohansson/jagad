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
  chaserLightAngle: 65,
  chaserLightPenumbra: 1,
  chaserLightOffset: 0.05,
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
  environmentIntensity: 1.0,
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
  wireHeight: 0.3,
  wireGravity: 0.15,
  wireFriction: 0.92,
  wireIterations: 3,
  wireCubeSize: 2,
  billboardBrightness: 0.6,
  billboardCenterPull: 0.01,
  billboardMaxDistance: 0,
  showNavmesh: false,
  buildingEnabled: true,
  buildingScaleX: 1.15,
  buildingScaleY: 1.12,
  buildingOffsetX: 0.11,
  buildingOffsetY: -0.5,
  buildingOffsetZ: 0.65,
  buildingOpacity: 1.0,
  bloomEnabled: true,
  bloomThreshold: 0.5,
  bloomStrength: 0.2,
  bloomRadius: 1.0,
  fxaaEnabled: false,
  // Cyberpunk VFX
  vignetteEnabled: true,
  vignetteIntensity: 0.2,
  chromaticAberration: 0,
  colorGradingEnabled: true,
  colorGradingTint: "#ff00ff",
  colorGradingIntensity: 0,
  colorGradingSaturation: 1.2,
  colorGradingContrast: 1.1,
  // Atmosphere
  fogEnabled: true,
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
  glassEnabled: true,
  glassOpacity: 0.8,
  glassVideoEnabled: true,
  glassVideoOpacity: 0.25,
  glassVideoBrightness: 1.0,
  // Glass text builder
  glassTextRow1: "JAGAD",
  glassTextRow2: "THE CHASE IS ON",
  glassTextRow3: "CATCH THEM ALL",
  glassTextRow4: "LIVE NOW",
  glassTextFontSize: 70,
  glassTextLineHeight: 2.1,
  glassTextFont: "BankGothic",
  glassTextColor: "#ffffff",
  glassTextAlign: "center",
  glassTextOffsetX: -47,
  glassTextOffsetY: -254.1,
  glassTextLetterSpacing: 0,
  glassTextMonospace: true,
  glassTextCharWidth: 92,
  glassTextMarquee: false,
  glassTextMarqueeSpeed: 10,
  glassTextRowDelay: 200,
  glassTextShuffle: false,
  glassTextShuffleSpeed: 0.3,
  // Iframe Planes
  leftPanelEnabled: true,
  // 4 independent corners (counter-clockwise from top-left)
  leftPanelC1X: -5.11,
  leftPanelC1Z: 3.7,
  leftPanelC2X: -1.15,
  leftPanelC2Z: 3.66,
  leftPanelC3X: -1.16,
  leftPanelC3Z: 4.55,
  leftPanelC4X: -5.13,
  leftPanelC4Z: 4.57,
  rightPanelEnabled: true,
  // 4 independent corners (counter-clockwise from top-left)
  rightPanelC1X: 0.25,
  rightPanelC1Z: 3.66,
  rightPanelC2X: 5.09,
  rightPanelC2Z: 3.7,
  rightPanelC3X: 5.13,
  rightPanelC3Z: 4.49,
  rightPanelC4X: 0.26,
  rightPanelC4Z: 4.5,
  // Audio
  audioVolume: 0.5,
  audioTrack: "triumph-hill",
  // Helicopter
  helicopterEnabled: true,
  helicopterHeight: 4,
  helicopterSpeed: 0.5,
  helicopterRadius: 6,
  helicopterScale: 0.5,
  helicopterLightIntensity: 500,
  helicopterLightColor: "#ffffff",
  helicopterLightAngle: 10,
  helicopterVolumetric: true,
  helicopterVolumetricOpacity: 0.5,
  helicopterConeOffsetY: 0.5,
  helicopterConeHeight: 30,
  helicopterConeTopRadius: 0.1,
  helicopterConeBottomRadius: 5,
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

  // Mobile
  mobileEnabled: false,
  mobileOrthoZoom: 0.5,
  mobileOrthoOffsetZ: 0.6,

  // Game States
  gameState: "PRE_GAME", // PRE_GAME, STARTING, PLAYING, GAME_OVER

  // Pre-game state text
  preGameTextRow1: "",
  preGameTextRow2: "JAGAD",
  preGameTextRow3: "4MARS",
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

  // Game Over state text (supports ${score}, ${time}, ${caught}, ${total}, ${status}, ${initials}, ${s1}, ${s2}, ${s3})
  gameOverTextRow1: "  ${initials}${score} ",
  gameOverTextRow2: "${s1} ",
  gameOverTextRow3: "${s2} ",
  gameOverTextRow4: "${s3} ",

  // State projection images
  preGameImage: "pre-game.png",
  startingImage: "",
  playingImage: "",
  gameOverImage: "",
  projectionOpacity: 1,
  projectionScale: 0.28,
  projectionOffsetX: 0,
  projectionOffsetY: 0.3,
  projectionOffsetZ: 1,

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
