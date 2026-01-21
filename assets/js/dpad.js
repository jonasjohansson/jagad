// Shared D-pad component for controller and www pages
// Usage: import { initDpad } from './shared/dpad.js';
// Then call: initDpad(joystickBaseId, joystickHandleId, onDirectionChange, options)

const INPUT_THROTTLE = 50;
const JOYSTICK_THRESHOLD = 30;
const JOYSTICK_OFFSET = 40;
const KEY_TO_DIR = {
  w: "up",
  s: "down",
  a: "left",
  d: "right"
};

let joystickBase = null;
let joystickHandle = null;
let onDirectionChange = null;
let joystickActive = false;
let currentDir = null;
let activeTouch = null;
let lastInputTime = 0;
const keys = {};
let options = {
  throttle: INPUT_THROTTLE,
  threshold: JOYSTICK_THRESHOLD,
  offset: JOYSTICK_OFFSET
};

// Helper functions
function calculateDirection(deltaX, deltaY, threshold = options.threshold) {
  // Prevent diagonal movement by only allowing one axis at a time
  // Require that one axis is clearly dominant (at least 1.2x the other)
  const absX = Math.abs(deltaX);
  const absY = Math.abs(deltaY);
  
  // If both axes are below threshold, no direction
  if (absX < threshold && absY < threshold) {
    return null;
  }
  
  // If both axes are above threshold, only allow the dominant one
  // Require the dominant axis to be at least 1.2x the other to prevent diagonal
  if (absX > threshold && absY > threshold) {
    if (absX > absY * 1.2) {
      // X is clearly dominant
      if (deltaX > 0) return "right";
      if (deltaX < 0) return "left";
    } else if (absY > absX * 1.2) {
      // Y is clearly dominant
      if (deltaY > 0) return "down";
      if (deltaY < 0) return "up";
    } else {
      // Too close to diagonal, don't allow movement
      return null;
    }
  }
  
  // Only one axis is above threshold
  if (absX > absY) {
    if (deltaX > threshold) return "right";
    if (deltaX < -threshold) return "left";
  } else {
    if (deltaY > threshold) return "down";
    if (deltaY < -threshold) return "up";
  }
  
  return null;
}

function getJoystickCenter() {
  const rect = joystickBase.getBoundingClientRect();
  return {
    x: rect.left + rect.width / 2,
    y: rect.top + rect.height / 2,
    maxDistance: Math.min(rect.width, rect.height) / 2 - options.offset
  };
}

function resetJoystick() {
  if (!joystickHandle) return;
  joystickHandle.style.transform = "translate(-50%, -50%)";
  joystickHandle.classList.remove("active");
  currentDir = null;
  joystickActive = false;
  if (onDirectionChange) {
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

// Input handlers
function handleKeyDown(e) {
  const dir = KEY_TO_DIR[e.key.toLowerCase()];
  if (!dir) return;
  
  e.preventDefault();
  e.stopPropagation();
  keys[e.key.toLowerCase()] = true;
  updateJoystickFromKey(dir);
}

function handleKeyUp(e) {
  const key = e.key.toLowerCase();
  if (!KEY_TO_DIR[key]) return;
  
  e.preventDefault();
  e.stopPropagation();
  keys[key] = false;
  
  // Find next active direction
  const activeKey = Object.keys(keys).find(k => keys[k] && KEY_TO_DIR[k]);
  if (activeKey) {
    updateJoystickFromKey(KEY_TO_DIR[activeKey]);
  } else {
    resetJoystick();
  }
}

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
  
  const touch = Array.from(e.touches).find(t => t.identifier === activeTouch);
  if (!touch) return;
  
  updateJoystick(touch.clientX, touch.clientY);
}

function handleTouchEnd(e) {
  e.preventDefault();
  if (activeTouch !== null) {
    const touch = Array.from(e.changedTouches).find(t => t.identifier === activeTouch);
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
  if (customOptions.offset) options.offset = customOptions.offset;
  
  if (!joystickBase || !joystickHandle) {
    console.error("D-pad: Could not find joystick elements");
    return;
  }
  
  // Set up event listeners
  document.addEventListener("keydown", handleKeyDown, true);
  document.addEventListener("keyup", handleKeyUp, true);
  
  // Continuous input while key is held
  setInterval(() => {
    const activeKey = Object.entries(keys).find(([k, pressed]) => pressed && KEY_TO_DIR[k])?.[0];
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
  
  // Touch events - use capture phase and passive: false to ensure preventDefault works
  // Listen on both base and handle for touchstart
  joystickBase.addEventListener("touchstart", handleTouchStart, { passive: false });
  joystickHandle.addEventListener("touchstart", handleTouchStart, { passive: false });
  
  // Listen on document for touchmove/touchend to capture touches that move outside the joystick
  document.addEventListener("touchmove", handleTouchMove, { passive: false });
  document.addEventListener("touchend", handleTouchEnd, { passive: false });
  document.addEventListener("touchcancel", handleTouchCancel, { passive: false });
  
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
