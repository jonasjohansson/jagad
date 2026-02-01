// Capture Effects module
// Visual effects when a fugitive is captured

const activeEffects = [];

export function createCaptureEffect(THREE, scene, position, chaserColor) {
  const effects = [];

  // Grid pulse effect
  const gridSize = 2;
  const gridGeometry = new THREE.PlaneGeometry(gridSize, gridSize, 10, 10);
  const gridMaterial = new THREE.MeshBasicMaterial({
    color: chaserColor,
    wireframe: true,
    transparent: true,
    opacity: 1,
    side: THREE.DoubleSide,
  });
  const grid = new THREE.Mesh(gridGeometry, gridMaterial);
  grid.rotation.x = -Math.PI / 2;
  grid.position.copy(position);
  grid.position.y += 0.01;
  scene.add(grid);

  effects.push({
    type: "grid",
    mesh: grid,
    startTime: performance.now(),
    duration: 800,
    startScale: 0.1,
    endScale: 3,
  });

  // Particle burst
  const particleCount = 20;
  const particleGeometry = new THREE.BufferGeometry();
  const positions = new Float32Array(particleCount * 3);
  const velocities = [];

  for (let i = 0; i < particleCount; i++) {
    positions[i * 3] = position.x;
    positions[i * 3 + 1] = position.y + 0.5;
    positions[i * 3 + 2] = position.z;

    // Random velocity
    const angle = Math.random() * Math.PI * 2;
    const speed = 2 + Math.random() * 3;
    const upSpeed = 3 + Math.random() * 2;
    velocities.push({
      x: Math.cos(angle) * speed,
      y: upSpeed,
      z: Math.sin(angle) * speed,
    });
  }

  particleGeometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));

  const particleMaterial = new THREE.PointsMaterial({
    color: chaserColor,
    size: 0.15,
    transparent: true,
    opacity: 1,
  });

  const particles = new THREE.Points(particleGeometry, particleMaterial);
  scene.add(particles);

  effects.push({
    type: "particles",
    mesh: particles,
    velocities,
    startTime: performance.now(),
    duration: 1000,
    gravity: 10,
  });

  // Flash effect
  const flashGeometry = new THREE.SphereGeometry(0.5, 16, 16);
  const flashMaterial = new THREE.MeshBasicMaterial({
    color: 0xffffff,
    transparent: true,
    opacity: 1,
  });
  const flash = new THREE.Mesh(flashGeometry, flashMaterial);
  flash.position.copy(position);
  flash.position.y += 0.5;
  scene.add(flash);

  effects.push({
    type: "flash",
    mesh: flash,
    startTime: performance.now(),
    duration: 200,
    startScale: 0.1,
    endScale: 2,
  });

  // Store in active effects array
  for (const effect of effects) {
    activeEffects.push(effect);
  }

  return effects;
}

export function updateCaptureEffects(scene) {
  const now = performance.now();

  for (let i = activeEffects.length - 1; i >= 0; i--) {
    const effect = activeEffects[i];
    const elapsed = now - effect.startTime;
    const progress = Math.min(elapsed / effect.duration, 1);

    if (progress >= 1) {
      // Remove effect
      scene.remove(effect.mesh);
      if (effect.mesh.geometry) effect.mesh.geometry.dispose();
      if (effect.mesh.material) effect.mesh.material.dispose();
      activeEffects.splice(i, 1);
      continue;
    }

    switch (effect.type) {
      case "grid": {
        const scale = effect.startScale + (effect.endScale - effect.startScale) * progress;
        effect.mesh.scale.set(scale, scale, 1);
        effect.mesh.material.opacity = 1 - progress;
        break;
      }

      case "particles": {
        const positions = effect.mesh.geometry.attributes.position.array;
        const dt = 0.016; // Approximate delta time

        for (let j = 0; j < effect.velocities.length; j++) {
          const vel = effect.velocities[j];
          vel.y -= effect.gravity * dt;

          positions[j * 3] += vel.x * dt;
          positions[j * 3 + 1] += vel.y * dt;
          positions[j * 3 + 2] += vel.z * dt;
        }

        effect.mesh.geometry.attributes.position.needsUpdate = true;
        effect.mesh.material.opacity = 1 - progress;
        break;
      }

      case "flash": {
        const scale = effect.startScale + (effect.endScale - effect.startScale) * progress;
        effect.mesh.scale.set(scale, scale, scale);
        effect.mesh.material.opacity = 1 - progress;
        break;
      }
    }
  }
}

export function clearCaptureEffects(scene) {
  for (const effect of activeEffects) {
    scene.remove(effect.mesh);
    if (effect.mesh.geometry) effect.mesh.geometry.dispose();
    if (effect.mesh.material) effect.mesh.material.dispose();
  }
  activeEffects.length = 0;
}

export function getActiveEffects() {
  return activeEffects;
}
