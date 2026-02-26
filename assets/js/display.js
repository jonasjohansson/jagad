// --- Server address ---
function getHTTPServerAddress() {
  const params = new URLSearchParams(window.location.search);
  const serverParam = params.get("server");

  const LOCAL = "http://localhost:3000";
  const REMOTE = "https://pacman-server-239p.onrender.com";

  if (serverParam) {
    if (serverParam.startsWith("http://") || serverParam.startsWith("https://")) return serverParam;
    if (serverParam === "local" || serverParam === "localhost") return LOCAL;
    if (serverParam === "remote" || serverParam === "render") return REMOTE;
  }

  if (window.location.origin === "http://localhost" || window.location.origin.startsWith("http://localhost:")) {
    return LOCAL;
  }
  return REMOTE;
}

function getWSAddress() {
  const http = getHTTPServerAddress();
  return http.replace(/^http/, "ws");
}

// --- DOM refs ---
const col1 = document.getElementById("col1");
const col2 = document.getElementById("col2");
const banner = document.getElementById("event-banner");
const contentEl = document.getElementById("display-right-content");

const TAGLINE = "KAN DU FÅNGA RYMMARNA?";
const TAGLINE_DURATION = 10000;
const PAGE_DURATION = 6000;
const PAGE_SIZE = 3;
const SHUFFLE_CHARS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
const SHUFFLE_DURATION = 600;
const SHUFFLE_INTERVAL = 40;

let scores = [];
let cycleTimer = null;
let activeShuffleIntervals = [];

function cancelAllShuffles() {
  activeShuffleIntervals.forEach(id => clearInterval(id));
  activeShuffleIntervals = [];
}

// --- Shuffle text effect (per-character, fixed-width spans) ---
function shuffleTransition(targetText, el, onDone, { keepFixed = false } = {}) {
  const len = targetText.length;
  const stagger = 30; // ms delay per character
  const charDuration = SHUFFLE_DURATION;
  const startTime = performance.now();

  el.innerHTML = "";
  const charSpans = [];
  for (let i = 0; i < len; i++) {
    const span = document.createElement("span");
    if (keepFixed) span.className = "shuffle-char";
    span.textContent = targetText[i] === " " ? "\u00A0" : SHUFFLE_CHARS[Math.floor(Math.random() * SHUFFLE_CHARS.length)];
    el.appendChild(span);
    charSpans.push({ span, target: targetText[i], resolved: false, start: stagger * i });
  }

  const interval = setInterval(() => {
    const now = performance.now() - startTime;
    let allDone = true;

    for (const ch of charSpans) {
      if (ch.resolved) continue;
      const elapsed = now - ch.start;
      if (elapsed >= charDuration) {
        ch.span.textContent = ch.target === " " ? "\u00A0" : ch.target;
        ch.resolved = true;
      } else if (elapsed > 0) {
        ch.span.textContent = ch.target === " " ? "\u00A0" : SHUFFLE_CHARS[Math.floor(Math.random() * SHUFFLE_CHARS.length)];
        allDone = false;
      } else {
        allDone = false;
      }
    }

    if (allDone) {
      clearInterval(interval);
      activeShuffleIntervals = activeShuffleIntervals.filter(id => id !== interval);
      if (!keepFixed) el.textContent = targetText;
      if (onDone) onDone();
    }
  }, SHUFFLE_INTERVAL);

  activeShuffleIntervals.push(interval);
}

// --- Build highscore HTML for a page ---
function buildHighscoreHTML(pageScores) {
  return pageScores.map(({ rank, playerName, score }) =>
    `<span class="highscore-entry">` +
    `<span class="rank">${rank}</span>` +
    `<span class="name">${playerName || "???"}</span>` +
    `<span class="score">${score.toLocaleString()}</span>` +
    `</span>`
  ).join("");
}

function getHighscorePages() {
  const capped = scores.slice(0, 9);
  const pages = [];
  for (let i = 0; i < capped.length; i += PAGE_SIZE) {
    pages.push(capped.slice(i, i + PAGE_SIZE).map((entry, j) => ({
      rank: i + j + 1,
      playerName: entry.playerName,
      score: entry.score
    })));
  }
  return pages;
}

// --- Fit text to container ---
function fitToContainer(el) {
  el.style.transform = "";
  el.style.transformOrigin = "center center";
  const containerWidth = contentEl.clientWidth;
  const textWidth = el.scrollWidth;
  if (textWidth > containerWidth) {
    el.style.transform = `scaleX(${containerWidth / textWidth})`;
  }
}

// --- Display cycle ---
function getTextEl() {
  return contentEl.querySelector("#display-text");
}

function showTagline(nextFn) {
  contentEl.innerHTML = `<span id="display-text"></span>`;
  shuffleTransition(TAGLINE, getTextEl(), () => {
    cycleTimer = setTimeout(nextFn, TAGLINE_DURATION);
  });
}

function showPage(page, nextFn) {
  contentEl.innerHTML = `<div class="highscore-row">${buildHighscoreHTML(page)}</div>`;

  const spans = contentEl.querySelectorAll(".highscore-entry .rank, .highscore-entry .name, .highscore-entry .score");
  let pending = spans.length;
  if (pending === 0) { cycleTimer = setTimeout(nextFn, PAGE_DURATION); return; }

  spans.forEach(span => {
    const target = span.textContent;
    span.textContent = "";
    shuffleTransition(target, span, () => {
      pending--;
      if (pending === 0) {
        cycleTimer = setTimeout(nextFn, PAGE_DURATION);
      }
    }, { keepFixed: true });
  });
}

function startDisplayCycle() {
  if (cycleTimer) clearTimeout(cycleTimer);
  cancelAllShuffles();

  const pages = getHighscorePages();
  let phase = 0;

  function nextPhase() {
    if (phase === 0) {
      phase = 1;
      if (pages.length > 0) {
        nextPhase();
      } else {
        showTagline(nextPhase);
      }
      return;
    }

    const pageIndex = phase - 1;
    if (pageIndex < pages.length) {
      phase++;
      showPage(pages[pageIndex], nextPhase);
    } else {
      phase = 0;
      showTagline(nextPhase);
    }
  }

  showTagline(nextPhase);
}

// --- Highscore fetching ---
async function fetchHighscore() {
  try {
    const res = await fetch(`${getHTTPServerAddress()}/api/highscore`);
    if (!res.ok) return;

    const data = await res.json();
    scores = Array.isArray(data) ? data : (data && data.score !== undefined ? [data] : []);
  } catch (err) {
    console.error("Highscore fetch error:", err);
  }
}

// --- Visual effects ---
function applyEffect(el, className) {
  el.classList.remove(className);
  void el.offsetWidth;
  el.classList.add(className);
  el.addEventListener("animationend", () => el.classList.remove(className), { once: true });
}

function flashColor(el, color, duration = 500) {
  const overlay = document.createElement("div");
  overlay.style.cssText = `position:absolute;inset:0;pointer-events:none;z-index:100;background:${color};opacity:0.6;`;
  el.appendChild(overlay);
  overlay.animate([
    { opacity: 0.6 },
    { opacity: 0 }
  ], { duration, easing: "ease-out" }).onfinish = () => overlay.remove();
}

function showBanner(text, durationMs = 3000) {
  banner.textContent = text;
  banner.classList.add("active");
  setTimeout(() => {
    banner.classList.remove("active");
    banner.textContent = "";
  }, durationMs);
}

// --- WebSocket ---
let ws = null;

function connectWS() {
  const url = getWSAddress();
  console.log("Display WS connecting to", url);
  ws = new WebSocket(url);

  ws.addEventListener("open", () => {
    console.log("Display WS connected");
  });

  ws.addEventListener("message", (event) => {
    let msg;
    try { msg = JSON.parse(event.data); } catch { return; }
    console.log("Display WS received:", msg.type);

    switch (msg.type) {
      case "chaserSelected":
        flashColor(col1, msg.color || "#ffffff");
        flashColor(col2, msg.color || "#ffffff");
        break;

      case "gameStarted":
        applyEffect(col1, "flash-green");
        applyEffect(col2, "flash-green");
        break;

      case "fugitiveCaught":
        flashColor(col1, msg.color || "#ff0000");
        flashColor(col2, msg.color || "#ff0000");
        applyEffect(col2, "shake");
        fetchHighscore();
        break;

      case "gameEnd":
        flashColor(col1, msg.color || "#ffffff");
        flashColor(col2, msg.color || "#ffffff");
        applyEffect(col1, "shake");
        applyEffect(col2, "shake");
        fetchHighscore();
        break;

      case "gameReset":
        fetchHighscore();
        break;

      case "forceReload":
        window.location.reload();
        break;
    }
  });

  ws.addEventListener("close", () => {
    console.log("Display WS disconnected, reconnecting in 3s...");
    setTimeout(connectWS, 3000);
  });

  ws.addEventListener("error", () => {
    ws.close();
  });
}

// --- Init ---
fetchHighscore().then(() => startDisplayCycle());
setInterval(() => fetchHighscore(), 30000);
connectWS();
