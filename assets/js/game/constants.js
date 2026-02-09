// Game constants and paths

export const PATHS = {
  models: {
    level: "assets/models/BuildingV20.glb",
    roads: "assets/models/roads.glb",
    cars: [
      "assets/models/car-Red Car.glb",
      "assets/models/car-Jeep.glb",
      "assets/models/car-Mazda RX-7.glb",
      "assets/models/car-cartoon banana car.glb",
    ],
    helicopter: "assets/models/bell_huey_helicopter.glb",
  },
  images: {
    building: "assets/images/building.png",
    faces: "assets/images/faces/",
    leftScreen: "assets/images/left_screen.jpg",
    rightScreen: "assets/images/right_screen.jpg",
    cloud: "assets/images/cloud.png",
  },
  audio: {
    "triumph-hill": "assets/audio/triumph-hill.mp3",
  },
  sfx: {
    capture: "assets/sounds/SFX_5_CaptureEnemy.wav",
    helicopter: "assets/sounds/SFX_6_Helicopter.mp3",
    countdown: "assets/sounds/SFX_3_3-2-1-GO!.wav",
    playerSelect: "assets/sounds/SFX_1_PlayerSelect.wav",
    gameStart: "assets/sounds/SFX_4_GamePlayStarts.wav",
    gameWin: "assets/sounds/SFX_7_GameEnd(Win).wav",
    gameLose: "assets/sounds/SFX_8_GameEnd(Loose).wav",
  },
  video: {
    windowAmbience: "assets/video/Jagad_Window_Ambience_v1.mp4",
  },
};

// Face texture pairs for each fugitive [primary, alternate]
export const FACE_TEXTURES = [
  ["F1-Samir.png", "F1-Viktor.png"],
  ["F2-Maria.png", "F2-Sara.png"],
  ["F3-Glenn.png", "F3-Hasse.png"],
  ["F4-Anja.png", "F4-Filippa.png"],
];

// Keyboard controls for each chaser
// C1: WASD, C2: TFGH, C3: IJKL, C4: Arrow keys
export const CHASER_CONTROLS = [
  { up: "w", down: "s", left: "a", right: "d" },
  { up: "t", down: "g", left: "f", right: "h" },
  { up: "i", down: "k", left: "j", right: "l" },
  { up: "arrowup", down: "arrowdown", left: "arrowleft", right: "arrowright" },
];

// Cardinal directions for pathfinding
export const CARDINAL_DIRS = [
  { x: 0, z: -1, name: "N" },
  { x: 0, z: 1, name: "S" },
  { x: 1, z: 0, name: "E" },
  { x: -1, z: 0, name: "W" },
];
