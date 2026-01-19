// Shared utility functions for all client-side code

// Server configuration
export const REMOTE_SERVER_ADDRESS = "https://pacman-server-239p.onrender.com";
export const LOCAL_SERVER_ADDRESS = "http://localhost:3000";

/**
 * Get server address from URL parameter or default
 * @returns {string} Server address (WebSocket or HTTP)
 */
export function getServerFromURL() {
  const params = new URLSearchParams(window.location.search);
  const serverParam = params.get("server");
  
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

/**
 * Get HTTP server address (for API calls)
 * @returns {string} HTTP server address
 */
export function getHTTPServerAddress() {
  const serverAddress = getServerFromURL();
  
  // If we're on localhost, default to local server for API
  if (window.location.origin === "http://localhost" || window.location.origin.startsWith("http://localhost:")) {
    return LOCAL_SERVER_ADDRESS;
  }
  
  return serverAddress;
}

/**
 * Convert HTTP/HTTPS address to WebSocket address
 * @param {string} httpAddress - HTTP/HTTPS address
 * @returns {string} WebSocket address
 */
export function getWebSocketAddress(httpAddress) {
  const wsProtocol = httpAddress.startsWith("https") ? "wss" : "ws";
  const wsUrl = httpAddress.replace(/^https?:\/\//, "").replace(/^http:\/\//, "");
  return `${wsProtocol}://${wsUrl}`;
}

/**
 * Throttle function calls
 * @param {Function} func - Function to throttle
 * @param {number} delay - Delay in milliseconds
 * @returns {Function} Throttled function
 */
export function throttle(func, delay) {
  let lastCall = 0;
  return function(...args) {
    const now = Date.now();
    if (now - lastCall >= delay) {
      lastCall = now;
      return func.apply(this, args);
    }
  };
}

/**
 * Debounce function calls
 * @param {Function} func - Function to debounce
 * @param {number} delay - Delay in milliseconds
 * @returns {Function} Debounced function
 */
export function debounce(func, delay) {
  let timeoutId;
  return function(...args) {
    clearTimeout(timeoutId);
    timeoutId = setTimeout(() => func.apply(this, args), delay);
  };
}

/**
 * Validate and sanitize initials input
 * @param {string} input - User input
 * @returns {string|null} Sanitized initials or null if invalid
 */
export function sanitizeInitials(input) {
  if (!input || typeof input !== "string") return null;
  const sanitized = input.toUpperCase().replace(/[^A-Z]/g, "").slice(0, 3);
  return sanitized.length > 0 ? sanitized : null;
}

/**
 * Prompt for player initials with validation
 * @returns {string|null} Player initials or null if cancelled
 */
export function promptForInitials() {
  let initials = "";
  while (!initials || initials.length === 0) {
    const input = prompt("Enter your 3-letter initials:");
    if (input === null) {
      // User cancelled
      return null;
    }
    initials = sanitizeInitials(input);
    if (!initials) {
      alert("Please enter at least one letter.");
    }
  }
  return initials;
}
