// Input handling module
// Manages keyboard input and control mapping

import { CHASER_CONTROLS } from "./constants.js";

const keys = {};
const HIGH_SCORE_CHARS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";

export function initInput(STATE, settings, callbacks) {
  const { setGameState, playAudio } = callbacks;

  // Track pressed keys
  window.addEventListener("keydown", (e) => {
    const key = e.key.toLowerCase();
    keys[key] = true;

    // Start audio on first interaction
    playAudio();

    // High score entry mode
    if (STATE.enteringHighScore) {
      handleHighScoreInput(e, STATE, callbacks);
      return;
    }

    // Check for capture trigger (spacebar or enter)
    if (key === " " || key === "enter") {
      callbacks.triggerCapture?.();
    }

    // In PRE_GAME state, any movement key starts the game
    if (STATE.gameState === "PRE_GAME" && STATE.loaded) {
      const isMovementKey = isAnyMovementKey(key);
      if (isMovementKey) {
        setGameState("STARTING");
      }
    }
  });

  window.addEventListener("keyup", (e) => {
    keys[e.key.toLowerCase()] = false;
  });
}

function handleHighScoreInput(e, STATE, callbacks) {
  const key = e.key.toLowerCase();

  if (key === "w" || key === "arrowup") {
    // Cycle character forward
    STATE.highScoreCharIndex = (STATE.highScoreCharIndex + 1) % HIGH_SCORE_CHARS.length;
    STATE.highScoreInitials[STATE.highScorePosition] = HIGH_SCORE_CHARS[STATE.highScoreCharIndex];
    callbacks.updateHighScoreDisplay?.();
  } else if (key === "s" || key === "arrowdown") {
    // Cycle character backward
    STATE.highScoreCharIndex = (STATE.highScoreCharIndex - 1 + HIGH_SCORE_CHARS.length) % HIGH_SCORE_CHARS.length;
    STATE.highScoreInitials[STATE.highScorePosition] = HIGH_SCORE_CHARS[STATE.highScoreCharIndex];
    callbacks.updateHighScoreDisplay?.();
  } else if (key === "d" || key === "arrowright") {
    // Move to next position
    if (STATE.highScorePosition < 2) {
      STATE.highScorePosition++;
      STATE.highScoreCharIndex = HIGH_SCORE_CHARS.indexOf(STATE.highScoreInitials[STATE.highScorePosition]);
      if (STATE.highScoreCharIndex < 0) STATE.highScoreCharIndex = 0;
      callbacks.updateHighScoreDisplay?.();
    }
  } else if (key === "a" || key === "arrowleft") {
    // Move to previous position
    if (STATE.highScorePosition > 0) {
      STATE.highScorePosition--;
      STATE.highScoreCharIndex = HIGH_SCORE_CHARS.indexOf(STATE.highScoreInitials[STATE.highScorePosition]);
      if (STATE.highScoreCharIndex < 0) STATE.highScoreCharIndex = 0;
      callbacks.updateHighScoreDisplay?.();
    }
  } else if (key === "enter" || key === " ") {
    // Confirm high score entry
    callbacks.confirmHighScore?.();
  }
}

function isAnyMovementKey(key) {
  // Check all chaser control keys
  for (const controls of CHASER_CONTROLS) {
    if (key === controls.up || key === controls.down ||
        key === controls.left || key === controls.right) {
      return true;
    }
  }
  return false;
}

export function isKeyPressed(key) {
  return keys[key.toLowerCase()] === true;
}

export function getChaserInputDirection(chaserIndex) {
  const controls = CHASER_CONTROLS[chaserIndex];
  if (!controls) return { x: 0, z: 0 };

  let dx = 0, dz = 0;
  if (isKeyPressed(controls.up)) dz = -1;
  if (isKeyPressed(controls.down)) dz = 1;
  if (isKeyPressed(controls.left)) dx = -1;
  if (isKeyPressed(controls.right)) dx = 1;

  return { x: dx, z: dz };
}

export function isChaserActive(chaserIndex) {
  const controls = CHASER_CONTROLS[chaserIndex];
  if (!controls) return false;

  return isKeyPressed(controls.up) || isKeyPressed(controls.down) ||
         isKeyPressed(controls.left) || isKeyPressed(controls.right);
}
