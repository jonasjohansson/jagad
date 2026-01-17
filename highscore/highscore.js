// Get HTTP server address from URL parameter or default
function getHTTPServerAddress() {
  const params = new URLSearchParams(window.location.search);
  const serverParam = params.get("server");
  
  const LOCAL_SERVER_ADDRESS = "http://localhost:3000";
  const REMOTE_SERVER_ADDRESS = "https://pacman-3d.onrender.com";
  
  if (serverParam) {
    // If it's a full URL, use it directly
    if (serverParam.startsWith("http://") || serverParam.startsWith("https://")) {
      return serverParam;
    }
    // If it's "local" or "localhost", use local server
    if (serverParam.toLowerCase() === "local" || serverParam.toLowerCase() === "localhost") {
      return LOCAL_SERVER_ADDRESS;
    }
    // If it's "remote" or "render", use remote server
    if (serverParam.toLowerCase() === "remote" || serverParam.toLowerCase() === "render") {
      return REMOTE_SERVER_ADDRESS;
    }
  }
  
  // Default: use remote server
  return REMOTE_SERVER_ADDRESS;
}

async function loadHighscore() {
  const loadingEl = document.getElementById("loading");
  const contentEl = document.getElementById("highscore-content");
  const noHighscoreEl = document.getElementById("no-highscore");
  
  try {
    const serverAddress = getHTTPServerAddress();
    const response = await fetch(`${serverAddress}/api/highscore`, {
      method: "GET",
      headers: {
        "Content-Type": "application/json",
      },
    });
    
    if (!response.ok) {
      // If 404, the endpoint might not be deployed yet
      if (response.status === 404) {
        loadingEl.textContent = "Highscore endpoint not available. Server may need to be updated.";
        return;
      }
      throw new Error(`HTTP error! status: ${response.status}`);
    }
    
    const data = await response.json();
    
    loadingEl.style.display = "none";
    
    if (data && data.score !== undefined && data.score > 0) {
      contentEl.style.display = "block";
      noHighscoreEl.style.display = "none";
      
      contentEl.innerHTML = `
        <div class="highscore-item">
          <div class="score">${data.score.toLocaleString()}</div>
          <div class="player-name">${data.playerName || "Unknown"}</div>
          <div class="game-type">${data.isTeamGame ? "Team Game" : "Solo Game"}</div>
        </div>
      `;
      contentEl.style.display = "grid";
    } else {
      contentEl.style.display = "none";
      noHighscoreEl.style.display = "block";
    }
  } catch (error) {
    console.error("Error loading highscore:", error);
    loadingEl.style.display = "block";
    loadingEl.textContent = `Error loading highscore: ${error.message}. Make sure the server is running and has the latest code deployed.`;
  }
}

// Load highscore on page load
document.addEventListener("DOMContentLoaded", () => {
  loadHighscore();
  
  // Refresh every 5 seconds
  setInterval(loadHighscore, 5000);
});
