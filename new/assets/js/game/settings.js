// Game settings configuration

export const STORAGE_KEY = "jagadSettings";

export const defaultSettings = {
  fugitiveSpeed: 1.0,
  chaserSpeed: 1,
  fugitiveIntelligence: 0.9,
  chaserIntelligence: 0.5,
  actorScale: 1.0,
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
  cameraType: "orthographic",
  orthoZoom: 1,
  perspFov: 20,
  perspNear: 0.1,
  perspFar: 5000,
  perspPosX: 0,
  perspPosY: 100,
  perspPosZ: 100,
  perspLookX: 0,
  perspLookY: 0,
  perspLookZ: 0,
  // Lighting
  toneMapping: "Neutral",
  exposure: 1.5,
  environmentIntensity: 1.0,
  punctualLights: true,
  ambientIntensity: 2.0,
  ambientColor: "#ffffff",
  directIntensity: 2.0,
  directColor: "#ffffff",
  directPosX: 5,
  directPosY: 10,
  directPosZ: 5,
  hemiIntensity: 1.0,
  hemiSkyColor: "#ffffff",
  hemiGroundColor: "#444444",
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
  buildingEnabled: true,
  buildingScaleX: 1.15,
  buildingScaleY: 1.12,
  buildingOffsetX: 0.11,
  buildingOffsetY: -0.5,
  buildingOffsetZ: 0.91,
  buildingOpacity: 1.0,
  levelOpacity: 1.0,
  levelBlendMode: "Normal",
  levelOffsetX: 0,
  levelOffsetY: 0,
  levelOffsetZ: 0,
  bloomEnabled: false,
  bloomThreshold: 0.5,
  bloomStrength: 0.4,
  bloomRadius: 1.0,
  fxaaEnabled: true,
  glassEnabled: true,
  glassOpacity: 0.8,
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
  glassTextMarquee: false,
  glassTextMarqueeSpeed: 100,
  glassTextRowDelay: 200,
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
