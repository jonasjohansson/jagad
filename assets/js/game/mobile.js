// Mobile performance optimization module
// Defines performance overrides, touch input, and save/restore for mobile mode

/**
 * Detect mobile/touch device
 */
export function isMobileDevice() {
  return ("ontouchstart" in window || navigator.maxTouchPoints > 0);
}

/**
 * Performance overrides applied in mobile mode
 * These disable GPU-heavy features to target 30-60 FPS on mobile
 */
export const MOBILE_OVERRIDES = {
  renderScale: 1,              // was 2 — 4x fewer pixels
  bloomEnabled: true,          // multi-pass blur
  punctualLights: true,        // actor SpotLights
  colorGradingEnabled: true,   // shader pass
  helicopterEnabled: true,     // extra model + SpotLight
  pulseWaveParticles: true,    // 120 particles per capture
  carAudioReactive: true,      // per-frame emissive updates
  textBPMPulse: true,          // per-frame text brightness
  shadowsEnabled: true,        // shadow maps
  chaserSpeed: 1.2,            // solo mobile boost (+0.2)
};

// Snapshot of desktop values for keys in MOBILE_OVERRIDES
let _savedDesktopSettings = null;

/**
 * Snapshot the current values of overridden keys before applying mobile mode
 */
export function saveDesktopSettings(settings) {
  _savedDesktopSettings = {};
  for (const key of Object.keys(MOBILE_OVERRIDES)) {
    _savedDesktopSettings[key] = settings[key];
  }
}

/**
 * Write MOBILE_OVERRIDES onto the settings object
 */
export function applyMobileOverrides(settings) {
  for (const [key, value] of Object.entries(MOBILE_OVERRIDES)) {
    settings[key] = value;
  }
}

/**
 * Restore previously saved desktop values onto the settings object
 * Returns true if restore succeeded, false if no snapshot exists
 */
export function restoreDesktopSettings(settings) {
  if (!_savedDesktopSettings) return false;
  for (const [key, value] of Object.entries(_savedDesktopSettings)) {
    settings[key] = value;
  }
  _savedDesktopSettings = null;
  return true;
}

/**
 * Initialize touch input — swipe-to-WASD for Chaser 1
 * Extracted from main.js inline touch handlers
 */
export function initTouchInput(canvas, keys, STATE, markChaserReady, onUserGesture) {
  const TOUCH_DEAD_ZONE = 20;
  const DOUBLE_TAP_MS = 300;
  let touchStartX = 0;
  let touchStartY = 0;
  let touchActiveKey = null;
  let lastTapTime = 0;
  let gestureUnlocked = false;

  canvas.addEventListener("touchstart", (e) => {
    e.preventDefault();
    const touch = e.touches[0];
    touchStartX = touch.clientX;
    touchStartY = touch.clientY;
  }, { passive: false });

  canvas.addEventListener("touchmove", (e) => {
    e.preventDefault();
    const touch = e.touches[0];
    const dx = touch.clientX - touchStartX;
    const dy = touch.clientY - touchStartY;

    // Clear previous touch direction
    if (touchActiveKey) {
      keys.delete(touchActiveKey);
      touchActiveKey = null;
    }

    // Check dead zone
    if (Math.abs(dx) < TOUCH_DEAD_ZONE && Math.abs(dy) < TOUCH_DEAD_ZONE) return;

    // Determine primary direction
    let newKey;
    if (Math.abs(dy) >= Math.abs(dx)) {
      newKey = dy < 0 ? "w" : "s";
    } else {
      newKey = dx < 0 ? "a" : "d";
    }

    // Dispatch keydown for high score entry (fires once per direction change)
    if (newKey !== touchActiveKey && STATE.enteringHighScore) {
      window.dispatchEvent(new KeyboardEvent("keydown", { key: newKey, bubbles: true }));
    }

    touchActiveKey = newKey;
    keys.add(newKey);
  }, { passive: false });

  canvas.addEventListener("touchend", (e) => {
    e.preventDefault();

    // Unlock audio/video on first tap (touchend is a user activation event)
    if (!gestureUnlocked && onUserGesture) {
      gestureUnlocked = true;
      onUserGesture();
    }

    // Double-tap → boost (dispatch Chaser 1 enter key "e")
    const now = Date.now();
    if (now - lastTapTime < DOUBLE_TAP_MS) {
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "e", bubbles: true }));
    }
    lastTapTime = now;

    // Tap readies Chaser 1 in PRE_GAME/STARTING
    if (STATE.loaded && (STATE.gameState === "PRE_GAME" || STATE.gameState === "STARTING")) {
      markChaserReady(0);
    }

    if (touchActiveKey) {
      keys.delete(touchActiveKey);
      touchActiveKey = null;
    }
  }, { passive: false });

  canvas.addEventListener("touchcancel", (e) => {
    e.preventDefault();
    if (touchActiveKey) {
      keys.delete(touchActiveKey);
      touchActiveKey = null;
    }
  }, { passive: false });
}
