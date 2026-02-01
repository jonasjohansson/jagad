// Rope Physics module
// Verlet integration for rope/wire simulation

export class RopePoint {
  constructor(x, y, z, pinned = false) {
    this.pos = { x, y, z };
    this.oldPos = { x, y, z };
    this.pinned = pinned;
  }

  update(gravity, friction) {
    if (this.pinned) return;

    const vx = (this.pos.x - this.oldPos.x) * friction;
    const vy = (this.pos.y - this.oldPos.y) * friction;
    const vz = (this.pos.z - this.oldPos.z) * friction;

    this.oldPos.x = this.pos.x;
    this.oldPos.y = this.pos.y;
    this.oldPos.z = this.pos.z;

    this.pos.x += vx;
    this.pos.y += vy - gravity;
    this.pos.z += vz;
  }

  setPosition(x, y, z) {
    this.pos.x = x;
    this.pos.y = y;
    this.pos.z = z;
    if (this.pinned) {
      this.oldPos.x = x;
      this.oldPos.y = y;
      this.oldPos.z = z;
    }
  }
}

export class RopeStick {
  constructor(p1, p2, length) {
    this.p1 = p1;
    this.p2 = p2;
    this.length = length;
  }

  solve() {
    const dx = this.p2.pos.x - this.p1.pos.x;
    const dy = this.p2.pos.y - this.p1.pos.y;
    const dz = this.p2.pos.z - this.p1.pos.z;

    const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);
    if (dist === 0) return;

    const diff = (this.length - dist) / dist;
    const offsetX = dx * 0.5 * diff;
    const offsetY = dy * 0.5 * diff;
    const offsetZ = dz * 0.5 * diff;

    if (!this.p1.pinned) {
      this.p1.pos.x -= offsetX;
      this.p1.pos.y -= offsetY;
      this.p1.pos.z -= offsetZ;
    }
    if (!this.p2.pinned) {
      this.p2.pos.x += offsetX;
      this.p2.pos.y += offsetY;
      this.p2.pos.z += offsetZ;
    }
  }
}

export function createRope(startPos, endPos, segments, settings) {
  const points = [];
  const sticks = [];
  const segmentLength = Math.sqrt(
    Math.pow(endPos.x - startPos.x, 2) +
    Math.pow(endPos.y - startPos.y, 2) +
    Math.pow(endPos.z - startPos.z, 2)
  ) / segments;

  for (let i = 0; i <= segments; i++) {
    const t = i / segments;
    const x = startPos.x + (endPos.x - startPos.x) * t;
    const y = startPos.y + (endPos.y - startPos.y) * t;
    const z = startPos.z + (endPos.z - startPos.z) * t;
    const pinned = i === 0 || i === segments;
    points.push(new RopePoint(x, y, z, pinned));
  }

  for (let i = 0; i < points.length - 1; i++) {
    sticks.push(new RopeStick(points[i], points[i + 1], segmentLength));
  }

  return { points, sticks, segmentLength };
}

export function updateRope(rope, settings) {
  const { points, sticks } = rope;
  const gravity = settings.wireGravity || 0.15;
  const friction = settings.wireFriction || 0.92;
  const iterations = settings.wireIterations || 3;

  // Update points (Verlet integration)
  for (const point of points) {
    point.update(gravity, friction);
  }

  // Solve constraints
  for (let i = 0; i < iterations; i++) {
    for (const stick of sticks) {
      stick.solve();
    }
  }
}
