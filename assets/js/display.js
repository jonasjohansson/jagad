// --- Debug overlay ---
const debugEl = document.createElement("div");
debugEl.id = "debug-log";
debugEl.style.cssText = "position:fixed;bottom:0;left:0;width:100%;max-height:25vh;overflow-y:auto;background:rgba(0,0,0,0.85);color:#0f0;font:11px/1.4 monospace;padding:6px 10px;z-index:9999;pointer-events:none;display:none;";
document.body.appendChild(debugEl);

const debugLines = [];
function debugLog(...args) {
  const msg = args.map(a => typeof a === "object" ? JSON.stringify(a) : String(a)).join(" ");
  const time = new Date().toLocaleTimeString();
  const line = `[${time}] ${msg}`;
  debugLines.push(line);
  if (debugLines.length > 30) debugLines.shift();
  debugEl.textContent = debugLines.join("\n");
  debugEl.scrollTop = debugEl.scrollHeight;
  console.log(...args);
  // Also send via WS if connected
  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify({ type: "displayLog", message: msg }));
  }
}

// --- Score debug panel (bottom-right) ---
const scoreDebugEl = document.createElement("div");
scoreDebugEl.id = "score-debug";
scoreDebugEl.style.cssText = "position:fixed;bottom:8px;right:8px;background:rgba(0,0,0,0.8);color:#0f0;font:10px/1.3 monospace;padding:6px 8px;z-index:9999;pointer-events:none;white-space:pre;border-radius:4px;max-width:300px;";
scoreDebugEl.style.display = "none";
document.body.appendChild(scoreDebugEl);
const ua = navigator.userAgent;
const chromeMatch = ua.match(/Chrome\/(\d+)/);
scoreDebugEl.textContent = "scores: loading...\n" + (chromeMatch ? "Chrome/" + chromeMatch[1] : ua);

let currentPhaseLabel = "init";
function updateScoreDebug() {
  let text = `phase: ${currentPhaseLabel}\n`;
  if (!scores.length) {
    text += "scores: [] (empty)";
  } else {
    const lines = scores.map((s, i) =>
      `${i + 1}. ${s.playerName || "???"} ${s.score}`
    );
    text += `scores: ${scores.length}\n${lines.join("\n")}`;
  }
  scoreDebugEl.textContent = text;
}

// --- WebSocket ref (hoisted so debugLog can use it) ---
let ws = null;

debugLog("[display] script loaded, origin:", window.location.origin);

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

// --- Shuffle text effect (tick-based, with safety timeout) ---
function shuffleTransition(targetText, el, onDone) {
  var len = targetText.length;
  var ticksPerChar = Math.ceil(SHUFFLE_DURATION / SHUFFLE_INTERVAL);
  var staggerTicks = Math.max(1, Math.round(30 / SHUFFLE_INTERVAL));
  var maxTicks = ticksPerChar + staggerTicks * len + 10; // safety cap
  var tick = 0;
  var done = false;

  function finish() {
    if (done) return;
    done = true;
    clearInterval(interval);
    activeShuffleIntervals = activeShuffleIntervals.filter(function(id) { return id !== interval; });
    el.textContent = targetText;
    if (onDone) onDone();
  }

  el.innerHTML = "";
  var charSpans = [];
  for (var i = 0; i < len; i++) {
    var span = document.createElement("span");
    span.textContent = targetText[i] === " " ? "\u00A0" : SHUFFLE_CHARS[Math.floor(Math.random() * SHUFFLE_CHARS.length)];
    el.appendChild(span);
    charSpans.push({ span: span, target: targetText[i], resolved: false, startTick: staggerTicks * i });
  }

  var interval = setInterval(function() {
    tick++;
    if (tick > maxTicks) { finish(); return; }

    var allDone = true;
    for (var j = 0; j < charSpans.length; j++) {
      var ch = charSpans[j];
      if (ch.resolved) continue;
      var elapsed = tick - ch.startTick;
      if (elapsed >= ticksPerChar) {
        ch.span.textContent = ch.target === " " ? "\u00A0" : ch.target;
        ch.resolved = true;
      } else if (elapsed >= 0) {
        ch.span.textContent = ch.target === " " ? "\u00A0" : SHUFFLE_CHARS[Math.floor(Math.random() * SHUFFLE_CHARS.length)];
        allDone = false;
      } else {
        allDone = false;
      }
    }

    if (allDone) finish();
  }, SHUFFLE_INTERVAL);

  activeShuffleIntervals.push(interval);

  // Hard safety: force-resolve after 2 seconds no matter what
  setTimeout(finish, 2000);
}

// --- Build highscore HTML for a page ---
function buildHighscoreHTML(pageScores) {
  return pageScores.map(({ rank, playerName, score }) =>
    `<div class="highscore-entry">` +
    `<div class="rank">${rank}</div>` +
    `<div class="name">${playerName || "???"}</div>` +
    `<div class="score">${score}</div>` +
    `</div>`
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
  currentPhaseLabel = "tagline";
  updateScoreDebug();
  contentEl.innerHTML = `<span id="display-text"></span>`;
  shuffleTransition(TAGLINE, getTextEl(), function() {
    cycleTimer = setTimeout(nextFn, TAGLINE_DURATION);
  });
}

var cycleInterval = null;
var pageIndex = 0;

function showCurrentPage() {
  var pages = getHighscorePages();

  if (pages.length === 0) {
    contentEl.innerHTML = '<span id="display-text">NO SCORES</span>';
    return;
  }

  if (pageIndex >= pages.length) {
    pageIndex = 0;
  }

  debugLog("[cycle] page", pageIndex + 1, "of", pages.length);
  contentEl.innerHTML = buildHighscoreHTML(pages[pageIndex]);
  pageIndex++;
}

function startDisplayCycle() {
  if (cycleInterval) clearInterval(cycleInterval);
  debugLog("[cycle] starting cycle");
  showCurrentPage();
  cycleInterval = setInterval(showCurrentPage, PAGE_DURATION);
}

// --- Highscore fetching ---
async function fetchHighscore() {
  const url = `${getHTTPServerAddress()}/api/highscore`;
  debugLog("[display] fetching", url);
  try {
    const res = await fetch(url);
    if (!res.ok) {
      debugLog("[display] fetch failed, status:", res.status);
      return;
    }

    const data = await res.json();
    scores = Array.isArray(data) ? data : (data && data.score !== undefined ? [data] : []);
    debugLog("[display] scores loaded:", scores.length, "entries");
    updateScoreDebug();
  } catch (err) {
    debugLog("[display] fetch error:", err.message);
    console.error("Highscore fetch error:", err);
    scoreDebugEl.textContent = "scores: ERROR\n" + err.message;
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
function connectWS() {
  const url = getWSAddress();
  console.log("Display WS connecting to", url);
  ws = new WebSocket(url);

  ws.addEventListener("open", () => {
    console.log("Display WS connected");
    debugLog("[display] connected, server:", getHTTPServerAddress());
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

      case "toggleDebug":
        const show = debugEl.style.display === "none";
        debugEl.style.display = show ? "" : "none";
        scoreDebugEl.style.display = show ? "" : "none";
        document.getElementById("display-text").style.display = show ? "" : "none";
        break;

      case "forceReload":
        // Unregister service workers and clear caches, then hard reload
        (async () => {
          if ("serviceWorker" in navigator) {
            const regs = await navigator.serviceWorker.getRegistrations();
            await Promise.all(regs.map(r => r.unregister()));
          }
          if ("caches" in window) {
            const keys = await caches.keys();
            await Promise.all(keys.map(k => caches.delete(k)));
          }
          var url = window.location.href.split("?")[0] + "?reload=" + Date.now();
          window.location.replace(url);
        })();
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
debugLog("[init] server:", getHTTPServerAddress());
debugLog("[init] fetching initial scores...");
fetchHighscore().then(() => {
  debugLog("[init] initial fetch done, scores:", scores.length);
  startDisplayCycle();
}).catch(err => {
  debugLog("[init] initial fetch failed:", err.message);
  startDisplayCycle();
});
// Poll for new scores every 30s (cycle will pick up changes naturally
// since getHighscorePages reads from the live scores array)
setInterval(() => fetchHighscore(), 30000);
connectWS();
