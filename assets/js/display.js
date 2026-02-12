// --- Server address (same logic as highscore.js) ---
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
const loadingEl = document.getElementById("loading");
const contentEl = document.getElementById("highscore-content");
const noHighscoreEl = document.getElementById("no-highscore");

// --- Highscore fetching ---
async function fetchHighscore() {
  try {
    const res = await fetch(`${getHTTPServerAddress()}/api/highscore`);
    if (!res.ok) {
      if (res.status === 404) {
        loadingEl.textContent = "Highscore endpoint not available.";
        return;
      }
      throw new Error(`HTTP ${res.status}`);
    }

    const data = await res.json();
    loadingEl.style.display = "none";

    const scores = Array.isArray(data) ? data : (data && data.score !== undefined ? [data] : []);

    if (scores.length > 0) {
      contentEl.style.display = "grid";
      noHighscoreEl.style.display = "none";
      contentEl.innerHTML = scores.map((entry, i) => `
        <div class="highscore-item">
          <div class="rank">${i + 1}</div>
          <div class="player-name">${entry.playerName || "Unknown"}</div>
          <div class="score">${entry.score.toLocaleString()}</div>
        </div>
      `).join("");
    } else {
      contentEl.style.display = "none";
      noHighscoreEl.style.display = "flex";
    }
  } catch (err) {
    console.error("Highscore fetch error:", err);
    loadingEl.style.display = "flex";
    loadingEl.textContent = `Error: ${err.message}`;
  }
}

// --- Visual effects ---
function applyEffect(el, className) {
  el.classList.remove(className);
  // Force reflow so re-adding the class restarts the animation
  void el.offsetWidth;
  el.classList.add(className);
  el.addEventListener("animationend", () => el.classList.remove(className), { once: true });
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
  ws = new WebSocket(url);

  ws.addEventListener("open", () => {
    console.log("Display WS connected");
  });

  ws.addEventListener("message", (event) => {
    let msg;
    try { msg = JSON.parse(event.data); } catch { return; }

    switch (msg.type) {
      case "chaserSelected":
        applyEffect(col1, "flash-white");
        applyEffect(col2, "flash-white");
        break;

      case "gameStarted":
        applyEffect(col1, "flash-green");
        applyEffect(col2, "flash-green");
        showBanner("Game started!");
        break;

      case "fugitiveCaught":
        applyEffect(col2, "flash-red");
        applyEffect(col2, "shake");
        showBanner("Fugitive caught!");
        fetchHighscore();
        break;

      case "gameEnd":
        applyEffect(col1, "flash-white");
        applyEffect(col2, "flash-white");
        applyEffect(col1, "shake");
        applyEffect(col2, "shake");
        showBanner("Game over!", 5000);
        setTimeout(fetchHighscore, 1000);
        break;

      case "gameReset":
        fetchHighscore();
        break;
    }
  });

  ws.addEventListener("close", () => {
    console.log("Display WS closed, reconnecting in 3s...");
    setTimeout(connectWS, 3000);
  });

  ws.addEventListener("error", () => {
    ws.close();
  });
}

// --- Init ---
fetchHighscore();
setInterval(fetchHighscore, 5000);
connectWS();
