// Game timer and scoring module
// Handles game timer display and score calculations

export function formatTimer(seconds) {
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  if (mins > 0) {
    return `${mins}:${secs.toString().padStart(2, "0")}`;
  }
  return `${secs}`;
}

export function formatScore(score, maxDigits = 3) {
  return String(Math.min(score, Math.pow(10, maxDigits) - 1)).padStart(maxDigits, "0");
}

export function calculateScore(capturedCount, fugitiveValue, timeBonus = 0) {
  return Math.floor(capturedCount * fugitiveValue + timeBonus);
}

export function updateGameTimer(STATE, dt) {
  if (!STATE.gameTimerStarted || STATE.gameOver) return false;

  if (STATE.gameTimerRemaining > 0) {
    STATE.gameTimerRemaining -= dt;

    // Decrease fugitive value over time (250 points over ~100 seconds = 2.5/sec)
    STATE.fugitiveValue = Math.max(0, STATE.fugitiveValue - 2.5 * dt);

    if (STATE.gameTimerRemaining <= 0) {
      STATE.gameTimerRemaining = 0;
      return true; // Timer expired
    }
  }

  return false;
}

export function addCaptureScore(STATE) {
  const points = Math.floor(STATE.fugitiveValue);
  STATE.playerScore += points;
  STATE.capturedCount++;
  return points;
}

export function resetScore(STATE) {
  STATE.playerScore = 0;
  STATE.capturedCount = 0;
  STATE.fugitiveValue = 250;
  STATE.gameTimerRemaining = 90;
  STATE.gameTimerStarted = false;
}
