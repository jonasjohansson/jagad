const http = require("http");
const path = require("path");
const fs = require("fs");
const { WebSocketServer } = require("ws");

const PORT = process.env.PORT || 3000;
const HIGHSCORE_FILE = path.join(__dirname, "highscore.json");
const STATIC_ROOT = path.join(__dirname, "..");

// ========== HIGHSCORE STORAGE ==========

const SEED_DATA = [
  { score: 999, playerName: "AAA", date: new Date().toISOString() },
  { score: 500, playerName: "BBB", date: new Date().toISOString() },
  { score: 100, playerName: "CCC", date: new Date().toISOString() },
];

function loadHighscore() {
  try {
    if (fs.existsSync(HIGHSCORE_FILE)) {
      const data = fs.readFileSync(HIGHSCORE_FILE, "utf8");
      const parsed = JSON.parse(data);
      return Array.isArray(parsed) ? parsed : [];
    }
  } catch (error) {
    console.error("Error loading highscore:", error);
  }
  // Seed default data
  saveHighscoreRaw(SEED_DATA);
  return SEED_DATA;
}

function saveHighscoreRaw(scores) {
  try {
    fs.writeFileSync(HIGHSCORE_FILE, JSON.stringify(scores, null, 2), "utf8");
  } catch (error) {
    console.error("Error saving highscore:", error);
  }
}

function addHighscore(entry) {
  let scores = loadHighscore();
  scores.push({
    score: Math.min(entry.score, 999),
    playerName: (entry.playerName || "???").substring(0, 3),
    date: new Date().toISOString(),
  });
  scores.sort((a, b) => b.score - a.score);
  scores = scores.slice(0, 10);
  saveHighscoreRaw(scores);
  return scores;
}

// ========== MIME TYPES ==========

const MIME_TYPES = {
  ".html": "text/html",
  ".js": "text/javascript",
  ".mjs": "text/javascript",
  ".css": "text/css",
  ".json": "application/json",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".gif": "image/gif",
  ".svg": "image/svg+xml",
  ".wav": "audio/wav",
  ".mp3": "audio/mpeg",
  ".mp4": "video/mp4",
  ".webm": "video/webm",
  ".glb": "model/gltf-binary",
  ".gltf": "model/gltf+json",
  ".woff": "application/font-woff",
  ".woff2": "font/woff2",
  ".ttf": "application/font-ttf",
  ".eot": "application/vnd.ms-fontobject",
  ".otf": "application/font-otf",
  ".wasm": "application/wasm",
  ".ktx2": "image/ktx2",
};

// ========== HTTP SERVER ==========

const server = http.createServer((req, res) => {
  // CORS headers on all responses
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") {
    res.writeHead(200);
    res.end();
    return;
  }

  // API: GET highscores
  if (req.url === "/api/highscore" && req.method === "GET") {
    const scores = loadHighscore();
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify(scores));
    return;
  }

  // API: POST highscore
  if (req.url === "/api/highscore" && req.method === "POST") {
    let body = "";
    req.on("data", (chunk) => (body += chunk));
    req.on("end", () => {
      try {
        const entry = JSON.parse(body);
        if (typeof entry.score !== "number") {
          res.writeHead(400, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: "Invalid score" }));
          return;
        }
        const scores = addHighscore(entry);
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify(scores));
      } catch (error) {
        res.writeHead(400, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "Invalid JSON" }));
      }
    });
    return;
  }

  // Favicon
  if (req.url === "/favicon.ico") {
    res.writeHead(204);
    res.end();
    return;
  }

  // Static file serving from project root
  let filePath = path.join(STATIC_ROOT, req.url === "/" ? "index.html" : req.url);

  // Trim query strings
  filePath = filePath.split("?")[0];

  // Directory requests → index.html
  if (filePath.endsWith("/")) {
    filePath += "index.html";
  }

  // Security: prevent path traversal
  if (!filePath.startsWith(STATIC_ROOT)) {
    res.writeHead(403);
    res.end("Forbidden");
    return;
  }

  const extname = path.extname(filePath).toLowerCase();
  const contentType = MIME_TYPES[extname] || "application/octet-stream";

  fs.readFile(filePath, (error, content) => {
    if (error) {
      if (error.code === "ENOENT") {
        res.writeHead(404, { "Content-Type": "text/html" });
        res.end("<h1>404 - Not Found</h1>");
      } else {
        res.writeHead(500);
        res.end(`Server Error: ${error.code}`);
      }
    } else {
      res.writeHead(200, { "Content-Type": contentType });
      res.end(content);
    }
  });
});

// ========== WEBSOCKET RELAY ==========

const wss = new WebSocketServer({ server });

wss.on("connection", (ws) => {
  ws.on("message", (data) => {
    // Relay to all OTHER connected clients
    const msg = data.toString();
    for (const client of wss.clients) {
      if (client !== ws && client.readyState === 1) {
        client.send(msg);
      }
    }
  });
});

// ========== START ==========

server.listen(PORT, () => {
  console.log(`Jagad server running on http://localhost:${PORT}`);
  console.log(`Display page: http://localhost:${PORT}/display/`);
});
