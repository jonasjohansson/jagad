// Template Variable Replacement — text templates for glass overlay
// Extracted from main.js

let _settings = null;
let _STATE = null;
let _getFugitiveCount = null;

export function initTemplateVars(settings, STATE, getFugitiveCount) {
  _settings = settings;
  _STATE = STATE;
  _getFugitiveCount = getFugitiveCount;
}

function getEndStatus() {
  const highScores = _settings.highScores.slice();
  for (let i = 0; i < highScores.length; i++) {
    if (_STATE.playerScore > highScores[i].score) return "NEWHIGHSCORE!";
  }
  return "GAMEOVER";
}

function getHighScoreString(position) {
  const highScores = _settings.highScores.slice();
  if (position >= 0 && position < highScores.length) {
    const hs = highScores[position];
    const initials = (hs.initials || "???").substring(0, 3).padEnd(3, "?");
    const score = String(hs.score).padStart(3, "0");
    return `${initials}${score}`;
  }
  return "";
}

function getHighScoreInitials(position) {
  const highScores = _settings.highScores.slice();
  if (position >= 0 && position < highScores.length) {
    return (highScores[position].initials || "???").substring(0, 3).padEnd(3, "?");
  }
  return "___";
}

function getHighScoreScore(position) {
  const highScores = _settings.highScores.slice();
  if (position >= 0 && position < highScores.length) {
    return String(highScores[position].score);
  }
  return "0";
}

function getCountdownText() {
  if (_STATE.countdownValue > 0) return String(_STATE.countdownValue);
  if (_STATE.countdownValue === 0) return "GO!";
  return "";
}

export function replaceTemplateVars(text) {
  if (!text) return "";
  // Flash current position when entering high score
  let initials;
  if (_STATE.highScoreInitials) {
    const blink = Math.floor(Date.now() / 400) % 2 === 0;
    initials = _STATE.highScoreInitials.map((c, i) => {
      if (_STATE.enteringHighScore && i === _STATE.highScorePosition) {
        return blink ? c : "_";
      }
      return c;
    }).join("");
  } else {
    initials = "___";
  }
  const paddedScore = String(_STATE.playerScore || 0).padStart(3, "0");
  const fugitiveCount = _getFugitiveCount ? _getFugitiveCount() : 4;
  return text
    .replace(/\$\{score\}/g, paddedScore)
    .replace(/\$\{time\}/g, String(Math.floor(_STATE.gameTimerRemaining || 0)))
    .replace(/\$\{caught\}/g, String(_STATE.capturedCount || 0))
    .replace(/\$\{total\}/g, String(fugitiveCount || 4))
    .replace(/\$\{status\}/g, getEndStatus())
    .replace(/\$\{initials\}/g, initials)
    .replace(/\$\{countdown\}/g, getCountdownText())
    .replace(/\$\{s1\}/g, getHighScoreString(0))
    .replace(/\$\{s2\}/g, getHighScoreString(1))
    .replace(/\$\{s3\}/g, getHighScoreString(2))
    .replace(/\$\{hs1i\}/g, getHighScoreInitials(0))
    .replace(/\$\{hs2i\}/g, getHighScoreInitials(1))
    .replace(/\$\{hs3i\}/g, getHighScoreInitials(2))
    .replace(/\$\{hs1s\}/g, getHighScoreScore(0))
    .replace(/\$\{hs2s\}/g, getHighScoreScore(1))
    .replace(/\$\{hs3s\}/g, getHighScoreScore(2));
}

export function applyStartingText() {
  _settings.glassTextRow1 = replaceTemplateVars(_settings.startingTextRow1);
  _settings.glassTextRow2 = replaceTemplateVars(_settings.startingTextRow2);
  _settings.glassTextRow3 = replaceTemplateVars(_settings.startingTextRow3);
  _settings.glassTextRow4 = replaceTemplateVars(_settings.startingTextRow4);
}

export function applyPlayingText() {
  _settings.glassTextRow1 = replaceTemplateVars(_settings.playingTextRow1);
  _settings.glassTextRow2 = replaceTemplateVars(_settings.playingTextRow2);
  _settings.glassTextRow3 = replaceTemplateVars(_settings.playingTextRow3);
  _settings.glassTextRow4 = replaceTemplateVars(_settings.playingTextRow4);
}

export function applyHighScoreText() {
  _settings.glassTextRow1 = replaceTemplateVars(_settings.highScoreTextRow1);
  _settings.glassTextRow2 = replaceTemplateVars(_settings.highScoreTextRow2);
  _settings.glassTextRow3 = replaceTemplateVars(_settings.highScoreTextRow3);
  _settings.glassTextRow4 = replaceTemplateVars(_settings.highScoreTextRow4);
}

export function applyGameOverText() {
  _settings.glassTextRow1 = replaceTemplateVars(_settings.gameOverTextRow1);
  _settings.glassTextRow2 = replaceTemplateVars(_settings.gameOverTextRow2);
  _settings.glassTextRow3 = replaceTemplateVars(_settings.gameOverTextRow3);
  _settings.glassTextRow4 = replaceTemplateVars(_settings.gameOverTextRow4);
}
