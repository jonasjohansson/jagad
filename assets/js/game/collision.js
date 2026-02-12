// Collision detection — exact copy from main.js

export function checkCollision(a, b, radius) {
  const da = a.position;
  const db = b.position;
  const dx = da.x - db.x;
  const dy = da.y - db.y;
  const dz = da.z - db.z;
  const distSq = dx * dx + dy * dy + dz * dz;
  const r = radius * 2;
  return distSq < r * r;
}
