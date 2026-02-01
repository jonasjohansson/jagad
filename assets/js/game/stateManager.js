// Game State Manager
// Handles state transitions, high scores, and template variables

const HIGH_SCORES_KEY = "jagadHighScores";

// ============================================
// HIGH SCORE MANAGEMENT
// ============================================

export function loadHighScores() {
  try {
    const saved = localStorage.getItem(HIGH_SCORES_KEY);
    if (saved) {
      return JSON.parse(saved);
    }
  } catch (e) {
    console.warn("Failed to load high scores:", e);
  }
  return [
    { initials: "AAA", score: 999 },
    { initials: "BBB", score: 500 },
    { initials: "CCC", score: 100 },
  ];
}

export function saveHighScores(scores) {
  try {
    localStorage.setItem(HIGH_SCORES_KEY, JSON.stringify(scores));
    return true;
  } catch (e) {
    console.error("Failed to save high scores:", e);
    return false;
  }
}

export function checkHighScore(score) {
  const highScores = loadHighScores();
  for (let i = 0; i < highScores.length; i++) {
    if (score > highScores[i].score) {
      return i; // Return position (0, 1, or 2)
    }
  }
  return -1; // Not a high score
}

export function insertHighScore(initials, score, position) {
  const highScores = loadHighScores();
  highScores.splice(position, 0, { initials, score });
  highScores.length = 3; // Keep only top 3
  saveHighScores(highScores);
  return highScores;
}

// ============================================
// TEMPLATE VARIABLE REPLACEMENT
// ============================================

export function replaceTemplateVars(text, state) {
  if (!text) return "";
  return text
    .replace(/\$\{score\}/g, String(state.playerScore || 0))
    .replace(/\$\{time\}/g, String(Math.floor(state.gameTimerRemaining || 0)))
    .replace(/\$\{caught\}/g, String(state.capturedCount || 0));
}

export function applyPlayingText(settings, state) {
  settings.glassTextRow1 = replaceTemplateVars(settings.playingTextRow1, state);
  settings.glassTextRow2 = replaceTemplateVars(settings.playingTextRow2, state);
  settings.glassTextRow3 = replaceTemplateVars(settings.playingTextRow3, state);
  settings.glassTextRow4 = replaceTemplateVars(settings.playingTextRow4, state);
}

export function applyGameOverText(settings, state) {
  settings.glassTextRow1 = replaceTemplateVars(settings.gameOverTextRow1, state);
  settings.glassTextRow2 = replaceTemplateVars(settings.gameOverTextRow2, state);
  settings.glassTextRow3 = replaceTemplateVars(settings.gameOverTextRow3, state);
  settings.glassTextRow4 = replaceTemplateVars(settings.gameOverTextRow4, state);
}

// ============================================
// STATE TRANSITIONS
// ============================================

export function createStateManager(STATE, settings, callbacks) {
  const {
    setChasersOpacity,
    updateGlassCanvas,
    updateProjectionForState,
    showGameScore,
  } = callbacks;

  function setGameState(newState) {
    const oldState = STATE.gameState;
    STATE.gameState = newState;

    switch (newState) {
      case "PRE_GAME":
        // Reset to pre-game state
        settings.glassTextRow1 = settings.preGameTextRow1;
        settings.glassTextRow2 = settings.preGameTextRow2;
        settings.glassTextRow3 = settings.preGameTextRow3;
        settings.glassTextRow4 = settings.preGameTextRow4;
        settings.gameStarted = false;
        STATE.gameOver = false;
        setChasersOpacity(0.1);
        break;

      case "STARTING":
        // Begin countdown
        STATE.countdownValue = 3;
        STATE.countdownTimer = 0;
        settings.glassTextRow1 = "";
        settings.glassTextRow2 = "3";
        settings.glassTextRow3 = "";
        settings.glassTextRow4 = "";
        settings.gameStarted = true;
        setChasersOpacity(0.1);
        break;

      case "PLAYING":
        // Set playing text and start timer
        applyPlayingText(settings, STATE);
        STATE.gameTimerStarted = true;
        STATE.gameTimerRemaining = 90;
        STATE.fugitiveValue = 250;
        STATE.playerScore = 0;
        STATE.capturedCount = 0;
        break;

      case "GAME_OVER":
        STATE.gameOver = true;
        STATE.gameTimerStarted = false;
        setChasersOpacity(0.1);
        applyGameOverText(settings, STATE);
        showGameScore();
        // Reset to PRE_GAME after 10 seconds
        setTimeout(() => {
          if (STATE.gameState === "GAME_OVER") {
            setGameState("PRE_GAME");
          }
        }, 10000);
        break;
    }

    // Update the glass canvas to reflect text changes
    if (typeof updateGlassCanvas === "function") {
      updateGlassCanvas();
    }

    // Update projection image for this state
    updateProjectionForState(newState);
  }

  function updateCountdown(dt) {
    if (STATE.gameState !== "STARTING") return;

    STATE.countdownTimer += dt;

    if (STATE.countdownTimer >= 1.0) {
      STATE.countdownTimer -= 1.0;
      STATE.countdownValue--;

      if (STATE.countdownValue > 0) {
        // Show 3, 2, 1
        settings.glassTextRow2 = String(STATE.countdownValue);
        updateGlassCanvas();
      } else if (STATE.countdownValue === 0) {
        // Show GO!
        settings.glassTextRow2 = "GO!";
        updateGlassCanvas();
      } else {
        // Countdown finished, start playing
        setGameState("PLAYING");
      }
    }
  }

  return {
    setGameState,
    updateCountdown,
  };
}
