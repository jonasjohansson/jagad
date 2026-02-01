// Game constants and paths

export const PATHS = {
  models: {
    level: "assets/models/BuildingV11.glb",
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
  video: {
    windowAmbience: "assets/video/Jagad_Window_Ambience_v1.mp4",
  },
};

// Face texture pairs for each fugitive [primary, alternate]
export const FACE_TEXTURES = [
  ["F1-Jaget_Lineup_Master_FACE_Samir_V01.png", "F1-Jaget_Lineup_Master_FACE_Viktor_V01.png"],
  ["F2-Jaget_Lineup_Master_FACE_Maria_V02.png", "F2-Jaget_Lineup_Master_FACE_Sara_V03.png"],
  ["F3-Jaget_Lineup_Master_FACE_Glenn_V01.png", "F3-Jaget_Lineup_Master_FACE_Hasse_V01.png"],
  ["F4-Jaget_Lineup_Master_FACE_Anja_V02.png", "F4-Jaget_Lineup_Master_FACE_Filippa_V02.png"],
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
