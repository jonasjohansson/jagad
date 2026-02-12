// Game constants and paths

export const PATHS = {
  models: {
    level: "assets/models/buildingV25.glb",
    roads: "assets/models/roads.glb",
    cars: [
      "assets/models/carRedCar.glb",
    ],
    helicopter: "assets/models/bellHueyHelicopter.glb",
  },
  images: {
    building: "assets/images/building.png",
    faces: "assets/images/faces/",
  },
  audio: {
    triumphHill: "assets/audio/triumphHill.mp3",
  },
  sfx: {
    capture: "assets/sounds/capture.mp3",
    helicopter: "assets/sounds/helicopter.mp3",
    countdown: "assets/sounds/countdown.mp3",
    playerSelect: "assets/sounds/playerSelect.mp3",
    gameStart: "assets/sounds/gameStart.mp3",
    gameWin: "assets/sounds/gameWin.mp3",
    gameLose: "assets/sounds/gameLose.mp3",
    nitro: "assets/sounds/nitro.mp3",
    honk: "assets/sounds/honk.mp3",
  },
  video: {
    countdownIntro: "assets/video/countdownIntro.mp4",
  },
};

// Face texture pairs for each fugitive [primary, alternate]
export const FACE_TEXTURES = [
  ["f1Samir.png", "f1Viktor.png"],
  ["f2Maria.png", "f2Sara.png"],
  ["f3Glenn.png", "f3Hasse.png"],
  ["f4Anja.png", "f4Filippa.png"],
];

// Keyboard controls for each chaser
// C1: WASD, C2: TFGH, C3: IJKL, C4: Arrow keys
export const CHASER_CONTROLS = [
  { up: "w", down: "s", left: "a", right: "d", enter: "e" },
  { up: "t", down: "g", left: "f", right: "h", enter: "y" },
  { up: "i", down: "k", left: "j", right: "l", enter: "o" },
  { up: "arrowup", down: "arrowdown", left: "arrowleft", right: "arrowright", enter: "enter" },
];
