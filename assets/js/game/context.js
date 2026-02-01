// Shared game context - central state and dependencies
// All modules receive this context to access shared resources

export function createContext(THREE) {
  return {
    // Core Three.js objects (set during initialization)
    THREE,
    scene: null,
    renderer: null,
    camera: null,
    composer: null,

    // Cameras
    orthoCamera: null,
    perspCamera: null,
    glbCameras: [],

    // Game entities
    fugitives: [],
    chasers: [],
    helicopter: null,

    // Level data
    levelContainer: null,
    roadsMeshes: [],
    glassMeshes: [],
    navNodes: [],
    buildingPlane: null,

    // Projection system
    projectionPlane: null,
    projectionTextures: {},

    // Iframe panels
    leftPanel: null,
    rightPanel: null,
    leftPanelIframe: null,
    rightPanelIframe: null,

    // Glass overlay
    glassCanvas: null,
    glassContext: null,
    glassTexture: null,

    // Audio
    audioElement: null,
    audioInitialized: false,

    // Effects arrays
    captureEffects: [],
    dustParticles: null,
    rainSystem: null,
    cloudShadowPlane: null,
    clouds: [],

    // State flags
    loaded: false,
    gameOver: false,
    lastTime: 0,

    // Level geometry
    levelCenter: null,
    horizontalSize: 100,
    actorSize: 0.4,
    actorRadius: 0.2,

    // Game state
    gameState: "PRE_GAME",
    countdownValue: 3,
    countdownTimer: 0,
    gameTimerStarted: false,
    gameTimerRemaining: 90,

    // Scoring
    playerScore: 0,
    fugitiveValue: 250,
    capturedCount: 0,

    // High score entry
    enteringHighScore: false,
    highScoreInitials: ["_", "_", "_"],
    highScorePosition: 0,
    highScoreCharIndex: 0,
    newHighScoreRank: -1,
    showingScore: false,
    scoreDisplayTime: 0,

    // Pathfinding
    pathGraph: null,
    projectYOnRoad: null,
    findNearestEdgePoint: null,
    getNodeDirections: null,
  };
}
