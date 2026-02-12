// Volumetric Fog - 3D Noise Texture generation

import * as THREE from "../lib/three/three.module.js";

export function createNoiseTexture3D() {
  const size = 64;
  const data = new Uint8Array(size * size * size);

  // Simple 3D noise approximation
  let i = 0;
  for (let z = 0; z < size; z++) {
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        // Layered sine waves for pseudo-noise
        const nx = x / size * 5;
        const ny = y / size * 5;
        const nz = z / size * 5;

        let noise = Math.sin(nx * 4) * Math.cos(ny * 4) * Math.sin(nz * 4);
        noise += Math.sin(nx * 8 + 1) * Math.cos(ny * 8 + 2) * Math.sin(nz * 8 + 3) * 0.5;
        noise += Math.sin(nx * 16 + 4) * Math.cos(ny * 16 + 5) * Math.sin(nz * 16 + 6) * 0.25;

        data[i] = Math.floor((noise + 1) * 0.5 * 255);
        i++;
      }
    }
  }

  const texture = new THREE.Data3DTexture(data, size, size, size);
  texture.format = THREE.RedFormat;
  texture.minFilter = THREE.LinearFilter;
  texture.magFilter = THREE.LinearFilter;
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.wrapR = THREE.RepeatWrapping;
  texture.needsUpdate = true;

  return texture;
}
