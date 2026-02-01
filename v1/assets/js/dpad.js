// Shared D-pad (joystick) component for controller and other views
// Usage: import { initDpad } from "./dpad.js";
// initDpad("joystick-base", "joystick-handle", onDirectionChange, options?)

const INPUT_THROTTLE = 50;
const JOYSTICK_THRESHOLD = 30;

const KEY_TO_DIR = {
  w: "up",
  s: "down",
  a: "left",
  d: "right",
  ArrowUp: "up",
  ArrowDown: "down",
  ArrowLeft: "left",
  ArrowRight: "right",
};

let joystickBase = null;
let joystickHandle = null;
let onDirectionChange = null;
let joystickActive = false;
let currentDir = null;
let activeTouch = null;
const keys = {};
let lastInputTime = 0;

let options = {
  throttle: INPUT_THROTTLE,
  threshold: JOYSTICK_THRESHOLD,
};

// Helper: map deltas to direction
function calculateDirection(deltaX, deltaY, threshold = options.threshold) {
  if (Math.abs(deltaX) < threshold && Math.abs(deltaY) < threshold) {
    return null;
  }
  if (Math.abs(deltaX) > Math.abs(deltaY)) {
    return deltaX > 0 ? "right" : "left";
  } else {
    return deltaY > 0 ? "down" : "up";
  }
}

function getJoystickCenter() {
  const rect = joystickBase.getBoundingClientRect();
  return {
    x: rect.left + rect.width / 2,
    y: rect.top + rect.height / 2,
    maxDistance: Math.min(rect.width, rect.height) / 2 - 20,
  };
}

function resetJoystick() {
  if (!joystickHandle) return;
  joystickHandle.style.transform = "translate(-50%, -50%)";
  joystickHandle.classList.remove("active");
  const prevDir = currentDir;
  currentDir = null;
  joystickActive = false;
  if (onDirectionChange && prevDir !== null) {
    onDirectionChange(null);
  }
}

function updateJoystick(x, y) {
  if (!joystickBase || !joystickHandle) return;

  const center = getJoystickCenter();
  const deltaX = x - center.x;
  const deltaY = y - center.y;
  const dir = calculateDirection(deltaX, deltaY);

  if (dir) {
    const moveX = Math.max(-center.maxDistance, Math.min(center.maxDistance, deltaX));
    const moveY = Math.max(-center.maxDistance, Math.min(center.maxDistance, deltaY));
    joystickHandle.style.transform = `translate(calc(-50% + ${moveX}px), calc(-50% + ${moveY}px))`;
    joystickHandle.classList.add("active");

    if (dir !== currentDir) {
      currentDir = dir;
      if (onDirectionChange) {
        onDirectionChange(dir);
      }
    }
  } else {
    if (currentDir !== null) {
      resetJoystick();
    }
  }
}

function updateJoystickFromKey(dir) {
  if (!joystickHandle) return;

  if (!dir) {
    resetJoystick();
    return;
  }

  const center = getJoystickCenter();
  const moveX = dir === "left" ? -center.maxDistance : dir === "right" ? center.maxDistance : 0;
  const moveY = dir === "up" ? -center.maxDistance : dir === "down" ? center.maxDistance : 0;

  joystickHandle.style.transform = `translate(calc(-50% + ${moveX}px), calc(-50% + ${moveY}px))`;
  joystickHandle.classList.add("active");

  if (dir !== currentDir) {
    currentDir = dir;
    if (onDirectionChange) {
      onDirectionChange(dir);
    }
  }
}

// Keyboard handlers
function handleKeyDown(e) {
  const dir = KEY_TO_DIR[e.key] || KEY_TO_DIR[e.key.toLowerCase()];
  if (!dir) return;

  e.preventDefault();
  e.stopPropagation();
  keys[e.key] = true;
  updateJoystickFromKey(dir);
}

function handleKeyUp(e) {
  const key = e.key;
  if (!KEY_TO_DIR[key] && !KEY_TO_DIR[key.toLowerCase()]) return;

  e.preventDefault();
  e.stopPropagation();
  keys[key] = false;

  const activeKey = Object.keys(keys).find((k) => keys[k] && (KEY_TO_DIR[k] || KEY_TO_DIR[k.toLowerCase()]));
  if (activeKey) {
    const dir = KEY_TO_DIR[activeKey] || KEY_TO_DIR[activeKey.toLowerCase()];
    updateJoystickFromKey(dir);
  } else {
    resetJoystick();
  }
}

// Touch handlers
function handleTouchStart(e) {
  e.preventDefault();
  if (e.touches.length > 0) {
    activeTouch = e.touches[0].identifier;
    const touch = e.touches[0];
    joystickActive = true;
    updateJoystick(touch.clientX, touch.clientY);
  }
}

function handleTouchMove(e) {
  e.preventDefault();
  if (activeTouch === null) return;

  const touch = Array.from(e.touches).find((t) => t.identifier === activeTouch);
  if (!touch) return;

  updateJoystick(touch.clientX, touch.clientY);
}

function handleTouchEnd(e) {
  e.preventDefault();
  if (activeTouch !== null) {
    const touch = Array.from(e.changedTouches).find((t) => t.identifier === activeTouch);
    if (touch) {
      resetJoystick();
      activeTouch = null;
    }
  }
}

function handleTouchCancel(e) {
  e.preventDefault();
  resetJoystick();
  activeTouch = null;
}

// Mouse handlers
function handleMouseDown(e) {
  e.preventDefault();
  joystickActive = true;
  updateJoystick(e.clientX, e.clientY);
}

function handleMouseMove(e) {
  if (!joystickActive) return;
  updateJoystick(e.clientX, e.clientY);
}

function handleMouseUp(e) {
  if (joystickActive) {
    resetJoystick();
    joystickActive = false;
  }
}

// Public API
export function initDpad(baseId, handleId, directionCallback, customOptions = {}) {
  joystickBase = document.getElementById(baseId);
  joystickHandle = document.getElementById(handleId);
  onDirectionChange = directionCallback;

  if (customOptions.throttle) options.throttle = customOptions.throttle;
  if (customOptions.threshold) options.threshold = customOptions.threshold;

  if (!joystickBase || !joystickHandle) {
    console.error("D-pad: Could not find joystick elements");
    return;
  }

  document.addEventListener("keydown", handleKeyDown, true);
  document.addEventListener("keyup", handleKeyUp, true);

  // Continuous input while key is held
  setInterval(() => {
    const activeKey = Object.entries(keys).find(([k, pressed]) => pressed && (KEY_TO_DIR[k] || KEY_TO_DIR[k.toLowerCase()]))?.[0];
    if (activeKey && currentDir) {
      const now = Date.now();
      if (now - lastInputTime >= options.throttle) {
        lastInputTime = now;
        if (onDirectionChange) {
          onDirectionChange(currentDir);
        }
      }
    }
  }, options.throttle);

  // Touch events
  joystickBase.addEventListener("touchstart", handleTouchStart, { passive: false });
  joystickBase.addEventListener("touchmove", handleTouchMove, { passive: false });
  joystickBase.addEventListener("touchend", handleTouchEnd, { passive: false });
  joystickBase.addEventListener("touchcancel", handleTouchCancel, { passive: false });

  // Mouse events
  joystickBase.addEventListener("mousedown", handleMouseDown);
  document.addEventListener("mousemove", handleMouseMove);
  document.addEventListener("mouseup", handleMouseUp);
  document.addEventListener("contextmenu", (e) => e.preventDefault());
}

export function getCurrentDirection() {
  return currentDir;
}

export function resetDpad() {
  resetJoystick();
}

