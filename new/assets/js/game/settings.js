// Game settings configuration

export const STORAGE_KEY = "jagadSettings";

export const defaultSettings = {
  fugitiveSpeed: 1.0,
  chaserSpeed: 1,
  actorScale: 1.0,
  fugitiveIntelligence: 0.85,
  fugitiveColor: "#ffffff",
  fugitiveLightIntensity: 1.2,
  faceSwapDuration: 30,
  faceSwapFade: false,
  faceSwapFadeDuration: 1.0,
  chaser1Color: "#FF2FD4",
  chaser2Color: "#FF7A00",
  chaser3Color: "#216BFF",
  chaser4Color: "#FDFF4A",
  chaserLightIntensity: 50,
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
  exposure: 1.5,
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
  wireHeight: 3.5,
  wireGravity: 0.15,
  wireFriction: 0.92,
  wireIterations: 3,
  wireCubeSize: 2,
  billboardBrightness: 0.6,
  showNavmesh: false,
  buildingEnabled: true,
  buildingScaleX: 1.15,
  buildingScaleY: 1.12,
  buildingOffsetX: 0.11,
  buildingOffsetY: -0.5,
  buildingOffsetZ: 0.91,
  buildingOpacity: 1.0,
  bloomEnabled: false,
  bloomThreshold: 0.5,
  bloomStrength: 0.4,
  bloomRadius: 1.0,
  fxaaEnabled: true,
  glassEnabled: true,
  glassOpacity: 0.8,
  glassVideoEnabled: true,
  glassVideoOpacity: 1.0,
  glassVideoBrightness: 1.0,
  // Glass text builder
  glassTextRow1: "JAGAD",
  glassTextRow2: "THE CHASE IS ON",
  glassTextRow3: "CATCH THEM ALL",
  glassTextRow4: "LIVE NOW",
  glassTextFontSize: 80,
  glassTextLineHeight: 1.8,
  glassTextFont: "BankGothic",
  glassTextColor: "#ffffff",
  glassTextAlign: "center",
  glassTextOffsetY: -250,
  glassTextLetterSpacing: 0,
  glassTextMarquee: true,
  glassTextMarqueeSpeed: 10,
  glassTextRowDelay: 200,
  // Audio
  audioVolume: 0.5,
  audioTrack: "triumph-hill",
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
