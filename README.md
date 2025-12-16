# Multiplayer Pacman Game

A multiplayer Pacman game with WebSocket support for real-time gameplay.

## Setup

1. Install dependencies:
```bash
npm install
```

2. Start the server:
```bash
npm start
```

The server will start on `http://localhost:3000` (or the port specified in the `PORT` environment variable).

## How It Works

- The server hosts the game files and provides WebSocket connections for multiplayer
- When a player visits the game, they can select to join as either a Pacman or Ghost
- Each color (Red, Green, Blue, Yellow) can only have one player
- If a character is not controlled by a player, it uses AI
- Players control their characters with arrow keys
- The game works in both single-player (when server is not available) and multiplayer modes

## Deployment

For GitHub Pages or static hosting, you can:
1. Deploy the static files (HTML, CSS, JS) to your hosting
2. Run the server separately (e.g., on Heroku, Railway, or a VPS)
3. Update the WebSocket URL in `game.js` if needed

## Environment Variables

- `PORT`: Server port (default: 3000)

