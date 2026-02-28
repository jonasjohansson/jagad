// Camera Shake — subtle position offset on capture & turbo

const activeShakes = [];
let appliedX = 0;
let appliedZ = 0;

export function triggerShake(intensity, duration) {
  activeShakes.push({ intensity, duration, elapsed: 0 });
}

export function updateShake(camera, dt) {
  // Undo previous frame's offset
  camera.position.x -= appliedX;
  camera.position.z -= appliedZ;
  appliedX = 0;
  appliedZ = 0;

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

  // Clamp to prevent extreme displacement
  const MAX_OFFSET = 0.5;
  offsetX = Math.max(-MAX_OFFSET, Math.min(MAX_OFFSET, offsetX));
  offsetZ = Math.max(-MAX_OFFSET, Math.min(MAX_OFFSET, offsetZ));

  appliedX = offsetX;
  appliedZ = offsetZ;
  camera.position.x += offsetX;
  camera.position.z += offsetZ;
}
