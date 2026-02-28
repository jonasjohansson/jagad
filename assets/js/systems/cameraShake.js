// Camera Shake — subtle position offset on capture & turbo

const activeShakes = [];

export function triggerShake(intensity, duration) {
  activeShakes.push({ intensity, duration, elapsed: 0 });
}

export function updateShake(camera, dt) {
  if (activeShakes.length === 0) return;

  let offsetX = 0;
  let offsetZ = 0;

  for (let i = activeShakes.length - 1; i >= 0; i--) {
    const shake = activeShakes[i];
    shake.elapsed += dt;
    if (shake.elapsed >= shake.duration) {
      activeShakes.splice(i, 1);
      continue;
    }
    const t = 1 - shake.elapsed / shake.duration;
    const strength = shake.intensity * t;
    offsetX += (Math.random() * 2 - 1) * strength;
    offsetZ += (Math.random() * 2 - 1) * strength;
  }

  camera.position.x += offsetX;
  camera.position.z += offsetZ;
}
