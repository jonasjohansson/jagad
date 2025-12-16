// Simple WebSocket server for Pacman multiplayer game
// No Express - uses Node.js built-in modules

const http = require("http");
const fs = require("fs");
const path = require("path");
const { WebSocketServer } = require("ws");

const PORT = process.env.PORT || 3000;

// Game state
const gameState = {
  players: new Map(), // Map of playerId -> { type: 'pacman'|'ghost', colorIndex: 0-3, connected: true }
  nextPlayerId: 0,
  availableColors: {
    pacman: [0, 1, 2, 3], // Available color indices for pacmen
    ghost: [0, 1, 2, 3], // Available color indices for ghosts
  },
};

// Create HTTP server to serve static files
const server = http.createServer((req, res) => {
  // Set CORS headers to allow connections from GitHub Pages or any origin
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  // Handle preflight requests
  if (req.method === "OPTIONS") {
    res.writeHead(200);
    res.end();
    return;
  }

  let filePath = "." + req.url;
  if (filePath === "./") {
    filePath = "./index.html";
  }

  const extname = String(path.extname(filePath)).toLowerCase();
  const mimeTypes = {
    ".html": "text/html",
    ".js": "text/javascript",
    ".css": "text/css",
    ".json": "application/json",
    ".png": "image/png",
    ".jpg": "image/jpg",
    ".gif": "image/gif",
    ".svg": "image/svg+xml",
    ".wav": "audio/wav",
    ".mp4": "video/mp4",
    ".woff": "application/font-woff",
    ".ttf": "application/font-ttf",
    ".eot": "application/vnd.ms-fontobject",
    ".otf": "application/font-otf",
    ".wasm": "application/wasm",
  };

  const contentType = mimeTypes[extname] || "application/octet-stream";

  fs.readFile(filePath, (error, content) => {
    if (error) {
      if (error.code == "ENOENT") {
        res.writeHead(404, { "Content-Type": "text/html" });
        res.end("<h1>404 - File Not Found</h1>", "utf-8");
      } else {
        res.writeHead(500);
        res.end(`Server Error: ${error.code}`, "utf-8");
      }
    } else {
      res.writeHead(200, { "Content-Type": contentType });
      res.end(content, "utf-8");
    }
  });
});

// Create WebSocket server with CORS support
const wss = new WebSocketServer({ 
  server,
  // Allow connections from any origin (for GitHub Pages deployment)
  verifyClient: (info) => {
    // Accept all connections - you can add origin checking here if needed
    return true;
  }
});

// Handle WebSocket connections
wss.on("connection", (ws, req) => {
  const playerId = `player_${gameState.nextPlayerId++}`;
  console.log(`New connection: ${playerId}`);

  // Send initial connection confirmation
  ws.send(
    JSON.stringify({
      type: "connected",
      playerId: playerId,
    })
  );

  // Handle incoming messages
  ws.on("message", (message) => {
    try {
      const data = JSON.parse(message.toString());

      switch (data.type) {
        case "join":
          handleJoin(ws, playerId, data);
          break;
        case "input":
          handleInput(playerId, data);
          break;
        case "gameState":
          // Client requesting current game state
          broadcastGameState();
          break;
        case "disconnect":
          handleDisconnect(playerId);
          break;
        default:
          console.log(`Unknown message type: ${data.type}`);
      }
    } catch (error) {
      console.error("Error parsing message:", error);
    }
  });

  // Handle disconnect
  ws.on("close", () => {
    handleDisconnect(playerId);
  });

  ws.on("error", (error) => {
    console.error(`WebSocket error for ${playerId}:`, error);
    handleDisconnect(playerId);
  });
});

// Handle player joining
function handleJoin(ws, playerId, data) {
  const { characterType, colorIndex } = data; // characterType: 'pacman' or 'ghost'

  // Check if color is available
  const availableColors = gameState.availableColors[characterType];
  if (!availableColors || !availableColors.includes(colorIndex)) {
    ws.send(
      JSON.stringify({
        type: "joinFailed",
        reason: "Color already taken",
      })
    );
    return;
  }

  // Assign player
  gameState.players.set(playerId, {
    type: characterType,
    colorIndex: colorIndex,
    connected: true,
    ws: ws,
  });

  // Remove color from available
  const colorIdx = availableColors.indexOf(colorIndex);
  if (colorIdx > -1) {
    availableColors.splice(colorIdx, 1);
  }

  console.log(`${playerId} joined as ${characterType} color ${colorIndex}`);

  // Confirm join
  ws.send(
    JSON.stringify({
      type: "joined",
      playerId: playerId,
      characterType: characterType,
      colorIndex: colorIndex,
    })
  );

  // Broadcast updated player list
  broadcastGameState();
}

// Handle player input
function handleInput(playerId, data) {
  const player = gameState.players.get(playerId);
  if (!player || !player.connected) return;

  // Broadcast input to all clients
  broadcast({
    type: "playerInput",
    playerId: playerId,
    characterType: player.type,
    colorIndex: player.colorIndex,
    input: data.input, // { keys: {...}, targetX, targetY, etc }
  });
}

// Handle player disconnect
function handleDisconnect(playerId) {
  const player = gameState.players.get(playerId);
  if (player) {
    console.log(`${playerId} disconnected (${player.type} color ${player.colorIndex})`);

    // Return color to available pool
    gameState.availableColors[player.type].push(player.colorIndex);
    gameState.availableColors[player.type].sort();

    // Remove player
    gameState.players.delete(playerId);

    // Broadcast updated state
    broadcast({
      type: "playerLeft",
      playerId: playerId,
      characterType: player.type,
      colorIndex: player.colorIndex,
    });

    broadcastGameState();
  }
}

// Broadcast message to all connected clients
function broadcast(message) {
  const data = JSON.stringify(message);
  wss.clients.forEach((client) => {
    if (client.readyState === 1) {
      // WebSocket.OPEN
      client.send(data);
    }
  });
}

// Broadcast current game state
function broadcastGameState() {
  const players = Array.from(gameState.players.entries()).map(([id, player]) => ({
    playerId: id,
    type: player.type,
    colorIndex: player.colorIndex,
    connected: player.connected,
  }));

  broadcast({
    type: "gameState",
    players: players,
    availableColors: {
      pacman: [...gameState.availableColors.pacman],
      ghost: [...gameState.availableColors.ghost],
    },
  });
}

// Start server
server.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
  console.log(`WebSocket server ready for connections`);
});

