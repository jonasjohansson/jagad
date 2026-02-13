// Server connection module
// WebSocket + REST API for game events and high scores

let serverWS = null;

export function getServerAddress() {
  const params = new URLSearchParams(window.location.search);
  const s = params.get("server");
  const LOCAL = "http://localhost:3000";
  const REMOTE = "https://pacman-server-239p.onrender.com";
  if (s) {
    if (s.startsWith("http://") || s.startsWith("https://")) return s;
    if (s === "local" || s === "localhost") return LOCAL;
    if (s === "remote" || s === "render") return REMOTE;
  }
  if (window.location.origin === "http://localhost" || window.location.origin.startsWith("http://localhost:")) return LOCAL;
  return REMOTE;
}

export function connectToServer() {
  try {
    const url = getServerAddress().replace(/^http/, "ws");
    console.log("Game WS connecting to", url);
    serverWS = new WebSocket(url);
    serverWS.addEventListener("open", () => {
      console.log("Game WS connected");
    });
    serverWS.addEventListener("close", () => {
      console.log("Game WS disconnected, retrying in 5s");
      serverWS = null;
      setTimeout(connectToServer, 5000);
    });
    serverWS.addEventListener("error", () => serverWS.close());
  } catch { serverWS = null; }
}

export function sendServerEvent(event) {
  if (serverWS && serverWS.readyState === WebSocket.OPEN) {
    console.log("Game WS sending:", event.type);
    serverWS.send(JSON.stringify(event));
  }
}

export function postHighScore(data) {
  return fetch(`${getServerAddress()}/api/highscore`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data),
  }).catch(() => {});
}
