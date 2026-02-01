// Collision detection module
// Simple sphere-based collision detection

export function checkCollision(pos1, pos2, radius1, radius2) {
  const dx = pos1.x - pos2.x;
  const dz = pos1.z - pos2.z;
  const distSq = dx * dx + dz * dz;
  const radiusSum = radius1 + radius2;
  return distSq < radiusSum * radiusSum;
}

export function checkActorCollision(actor1, actor2, radius) {
  if (!actor1.mesh || !actor2.mesh) return false;
  return checkCollision(actor1.mesh.position, actor2.mesh.position, radius, radius);
}

export function getDistance(pos1, pos2) {
  const dx = pos1.x - pos2.x;
  const dz = pos1.z - pos2.z;
  return Math.sqrt(dx * dx + dz * dz);
}

export function getDistanceSq(pos1, pos2) {
  const dx = pos1.x - pos2.x;
  const dz = pos1.z - pos2.z;
  return dx * dx + dz * dz;
}

export function normalizeDirection(dx, dz) {
  const len = Math.sqrt(dx * dx + dz * dz);
  if (len === 0) return { x: 0, z: 0 };
  return { x: dx / len, z: dz / len };
}

export function dotProduct(v1, v2) {
  return v1.x * v2.x + v1.z * v2.z;
}
