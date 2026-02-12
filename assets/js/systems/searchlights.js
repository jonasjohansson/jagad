// Searchlights — two roaming spotlights over the level
// Extracted from main.js

import * as THREE from "../lib/three/three.module.js";

let searchlights = null;
let searchlightHelpers = [];

export function getSearchlights() { return searchlights; }

export function setupSearchlights(scene, settings, STATE) {
  const center = STATE.levelCenter || new THREE.Vector3(0, 0, 0);
  const height = settings.searchlightHeight;
  const angleRad = THREE.MathUtils.degToRad(settings.searchlightAngle);

  const lights = [];
  for (let i = 0; i < 2; i++) {
    const spot = new THREE.SpotLight(
      settings.searchlightColor,
      settings.searchlightIntensity,
      settings.searchlightDistance,
      angleRad,
      settings.searchlightPenumbra,
      1
    );
    // Position at opposite corners, high above the board
    const offsetX = i === 0 ? -8 : 8;
    const offsetZ = i === 0 ? -6 : 6;
    spot.position.set(center.x + offsetX, height, center.z + offsetZ);
    spot.castShadow = true;
    spot.shadow.mapSize.width = 1024;
    spot.shadow.mapSize.height = 1024;
    spot.shadow.bias = -0.002;
    spot.shadow.normalBias = 0.05;

    const target = new THREE.Object3D();
    target.position.copy(center);
    scene.add(target);
    spot.target = target;
    scene.add(spot);

    // Random wandering state
    const goalX = center.x + (Math.random() - 0.5) * settings.searchlightSway * 2;
    const goalZ = center.z + (Math.random() - 0.5) * settings.searchlightSway * 2;
    lights.push({ spot, target, goalX, goalZ });
  }

  searchlights = lights;
  if (!settings.searchlightsEnabled) {
    for (const sl of searchlights) sl.spot.visible = false;
  }
}

export function updateSearchlights(dt, settings, STATE) {
  if (!searchlights) return;
  const enabled = settings.searchlightsEnabled;
  for (const sl of searchlights) {
    sl.spot.visible = enabled;
  }
  if (!enabled) return;

  const center = STATE.levelCenter || new THREE.Vector3(0, 0, 0);
  const speed = settings.searchlightSpeed;
  const sway = settings.searchlightSway;

  for (const sl of searchlights) {
    // Update light properties
    sl.spot.intensity = settings.searchlightIntensity;
    sl.spot.color.set(settings.searchlightColor);
    sl.spot.angle = THREE.MathUtils.degToRad(settings.searchlightAngle);
    sl.spot.distance = settings.searchlightDistance;
    sl.spot.penumbra = settings.searchlightPenumbra;
    sl.spot.position.y = settings.searchlightHeight;

    // Smoothly move toward random goal point
    const lerpSpeed = speed * dt;
    sl.target.position.x += (sl.goalX - sl.target.position.x) * lerpSpeed;
    sl.target.position.z += (sl.goalZ - sl.target.position.z) * lerpSpeed;

    // Pick a new random goal when close enough to the current one
    const dx = sl.goalX - sl.target.position.x;
    const dz = sl.goalZ - sl.target.position.z;
    if (dx * dx + dz * dz < 0.5) {
      sl.goalX = center.x + (Math.random() - 0.5) * sway * 2;
      sl.goalZ = center.z + (Math.random() - 0.5) * sway * 2;
    }
  }

  // Update debug helpers
  for (const helper of searchlightHelpers) {
    helper.update();
  }
}

export function toggleSearchlightHelpers(show, scene) {
  // Remove existing helpers
  for (const helper of searchlightHelpers) {
    scene.remove(helper);
    helper.dispose();
  }
  searchlightHelpers = [];

  if (show && searchlights) {
    for (const sl of searchlights) {
      const helper = new THREE.SpotLightHelper(sl.spot);
      scene.add(helper);
      searchlightHelpers.push(helper);
    }
  }
}
