// Helicopter system — loading, movement, light cone, bounds
// Extracted from main.js

import * as THREE from "../lib/three/three.module.js";
import { GLTFLoader } from "../lib/three/addons/loaders/GLTFLoader.js";
import { PATHS } from "../game/constants.js";

// Module-internal state
let helicopter = null;
let helicopterLightHelper = null;
let helicopterBoundsHelper = null;

// Reusable temp objects (per-module, avoids per-frame allocations)
const _tempVec3A = new THREE.Vector3();
const _tempQuat = new THREE.Quaternion();
const _defaultDownDir = new THREE.Vector3(0, -1, 0);

export function getHelicopter() { return helicopter; }
export function getHelicopterLightHelper() { return helicopterLightHelper; }
export function getHelicopterBoundsHelper() { return helicopterBoundsHelper; }

export function loadHelicopter(scene, settings, STATE, LAYERS, ktx2Loader, loadingProgress, DEBUG) {
  if (!PATHS.models.helicopter) return;

  const loader = new GLTFLoader();
  loader.setKTX2Loader(ktx2Loader);
  loader.load(PATHS.models.helicopter, (gltf) => {
    loadingProgress.complete();
    const mesh = gltf.scene;

    // Scale helicopter
    const box = new THREE.Box3().setFromObject(mesh);
    const size = new THREE.Vector3();
    box.getSize(size);
    const maxDim = Math.max(size.x, size.y, size.z);
    const baseScaleRatio = 2 / maxDim; // Store base ratio for dynamic scaling
    const scale = settings.helicopterScale * baseScaleRatio;
    mesh.scale.setScalar(scale);
    mesh.userData.baseScaleRatio = baseScaleRatio; // Store for later use
    if (DEBUG) console.log("Helicopter size:", size, "maxDim:", maxDim, "scale:", scale);

    // Position above the level - start near chaser spawn area
    const center = STATE.levelCenter || new THREE.Vector3(0, 0, 0);
    const levelRadius = STATE.horizontalSize ? STATE.horizontalSize / 2 : 10;
    // Start at a random position within the level
    const startX = center.x + (Math.random() - 0.5) * levelRadius;
    const startZ = center.z + (Math.random() - 0.5) * levelRadius;
    mesh.position.set(startX, settings.helicopterHeight, startZ);
    if (DEBUG) console.log("Helicopter position:", mesh.position, "center:", center, "levelRadius:", levelRadius);

    // Add spotlight facing down
    const angleRad = (settings.helicopterLightAngle * Math.PI) / 180;
    const light = new THREE.SpotLight(
      settings.helicopterLightColor,
      settings.helicopterLightIntensity,
      settings.helicopterLightDistance || 50,
      angleRad,
      0.5,
      1
    );
    light.position.set(0, 0, 0);
    light.castShadow = true;
    light.shadow.mapSize.width = 2048;
    light.shadow.mapSize.height = 2048;
    light.shadow.bias = -0.002;
    light.shadow.normalBias = 0.05;

    // Create target below helicopter
    const lightTarget = new THREE.Object3D();
    lightTarget.position.set(0, -10, 0);
    mesh.add(lightTarget);
    light.target = lightTarget;
    mesh.add(light);

    // Volumetric light cone - small at top (helicopter), wide at bottom (ground)
    // Multiple nested layers for fuzzy volumetric effect
    const coneHeight = settings.helicopterConeHeight;
    const topRadius = settings.helicopterConeTopRadius;
    const bottomRadius = settings.helicopterConeBottomRadius;
    const coneOffsetY = settings.helicopterConeOffsetY;

    // Create a group to hold multiple cone layers - pivot point at top
    const lightCone = new THREE.Group();
    lightCone.position.set(0, -coneOffsetY, 0);

    // Create multiple layers for fuzzy effect
    const layerCount = 5;
    const coneLayers = [];

    for (let layer = 0; layer < layerCount; layer++) {
      // Each layer slightly smaller, creating soft edges
      const layerScale = 1 - (layer * 0.15);
      const layerTopRadius = topRadius * layerScale;
      const layerBottomRadius = bottomRadius * layerScale;

      // More segments for smoother appearance
      const coneGeo = new THREE.CylinderGeometry(layerTopRadius, layerBottomRadius, coneHeight, 48, 24, true);

      // Vertex colors with soft falloff
      const colors = [];
      const positions = coneGeo.attributes.position;
      for (let i = 0; i < positions.count; i++) {
        const x = positions.getX(i);
        const y = positions.getY(i);
        const z = positions.getZ(i);

        // Vertical fade: t = 1 at top, 0 at bottom
        const t = (y + coneHeight / 2) / coneHeight;
        // Softer exponential falloff
        const verticalFade = Math.pow(t, 0.3);

        // Edge fade based on distance from center
        const radiusAtHeight = layerTopRadius + (layerBottomRadius - layerTopRadius) * (1 - t);
        const distFromCenter = Math.sqrt(x * x + z * z);
        const edgeT = radiusAtHeight > 0 ? distFromCenter / radiusAtHeight : 0;
        // Soft gaussian-like edge falloff
        const edgeFade = Math.exp(-edgeT * edgeT * 2);

        const brightness = verticalFade * edgeFade;
        colors.push(brightness, brightness, brightness);
      }
      coneGeo.setAttribute("color", new THREE.Float32BufferAttribute(colors, 3));

      // Inner layers are brighter, outer layers dimmer
      const layerOpacity = settings.helicopterVolumetricOpacity * (1 - layer * 0.15);

      const coneMat = new THREE.MeshBasicMaterial({
        color: settings.helicopterLightColor,
        transparent: true,
        opacity: layerOpacity,
        side: THREE.DoubleSide,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        vertexColors: true
      });

      const layerMesh = new THREE.Mesh(coneGeo, coneMat);
      layerMesh.position.y = -coneHeight / 2; // Offset down so pivot is at top
      layerMesh.castShadow = false;
      layerMesh.receiveShadow = false;
      lightCone.add(layerMesh);
      coneLayers.push({ mesh: layerMesh, material: coneMat });
    }

    // Store layers for later updates
    lightCone.userData.layers = coneLayers;
    mesh.add(lightCone);

    const helicopterMaterials = [];
    mesh.traverse((child) => {
      // Skip the lightCone - it should not cast/receive shadows
      if (child === lightCone) return;
      if (child.isMesh) {
        child.castShadow = true;
        child.receiveShadow = true;
        // Apply helicopter color
        if (child.material) {
          const mat = child.material;
          mat.color.set(settings.helicopterColor);
          if (mat.emissive) {
            mat.emissive.set(settings.helicopterColor);
            mat.emissiveIntensity = 0.3;
          }
          helicopterMaterials.push(mat);
        }
      }
    });
    mesh.userData.materials = helicopterMaterials;

    // Assign GLB layer for selective pixelation
    mesh.traverse(child => {
      if (child.isMesh) child.layers.set(LAYERS.GLB_MODELS);
    });
    // Keep light cone on default layer (volumetric effect should not be pixelated)
    lightCone.traverse(child => child.layers.set(LAYERS.DEFAULT));

    scene.add(mesh);

    helicopter = {
      mesh,
      light,
      lightTarget,
      lightCone,
      angle: 0,
      rotorAngle: 0,
      targetX: startX,
      targetZ: startZ,
      waypointTimer: 2,
      baseScaleRatio,
    };

    // Find rotor parts to animate
    mesh.traverse((child) => {
      if (child.name && child.name.toLowerCase().includes("rotor")) {
        if (!helicopter.rotors) helicopter.rotors = [];
        helicopter.rotors.push(child);
      }
    });

    // Rebuild cone to ensure consistent appearance
    rebuildHelicopterCone(settings);

    if (DEBUG) console.log("Helicopter loaded");
  }, undefined, (err) => {
    console.warn("Failed to load helicopter:", err);
  });
}

export function updateHelicopter(dt, settings, STATE) {
  if (!helicopter || !helicopter.mesh) return;
  if (!settings.helicopterEnabled) {
    helicopter.mesh.visible = false;
    return;
  }
  helicopter.mesh.visible = true;

  const center = STATE.levelCenter || new THREE.Vector3(0, 0, 0);
  const levelRadius = STATE.horizontalSize ? STATE.horizontalSize / 2 : 10;
  const patrolRadius = Math.min(settings.helicopterRadius, levelRadius * 0.8);
  const time = performance.now() * 0.001;

  // Smooth figure-8 / lemniscate pattern over the level
  const speed = settings.helicopterSpeed * 0.3;
  helicopter.angle += speed * dt;

  // Create smooth hovering path using sine waves, clamped to bounds
  const rawX = center.x + Math.sin(helicopter.angle) * patrolRadius * 0.8;
  const rawZ = center.z + Math.sin(helicopter.angle * 2) * patrolRadius * 0.4;
  const targetX = Math.max(settings.helicopterBoundsMinX, Math.min(settings.helicopterBoundsMaxX, rawX));
  const targetZ = Math.max(settings.helicopterBoundsMinZ, Math.min(settings.helicopterBoundsMaxZ, rawZ));

  // Smoothly interpolate position (no sudden jumps)
  const lerpSpeed = 1.5 * dt;
  helicopter.mesh.position.x += (targetX - helicopter.mesh.position.x) * lerpSpeed;
  helicopter.mesh.position.z += (targetZ - helicopter.mesh.position.z) * lerpSpeed;

  // Gentle height bobbing
  helicopter.mesh.position.y = settings.helicopterHeight + Math.sin(time * 0.8) * 0.15;

  // Calculate velocity for facing direction
  if (!helicopter.lastX) helicopter.lastX = helicopter.mesh.position.x;
  if (!helicopter.lastZ) helicopter.lastZ = helicopter.mesh.position.z;

  const velX = helicopter.mesh.position.x - helicopter.lastX;
  const velZ = helicopter.mesh.position.z - helicopter.lastZ;

  helicopter.lastX = helicopter.mesh.position.x;
  helicopter.lastZ = helicopter.mesh.position.z;

  // Only update rotation if actually moving
  if (Math.abs(velX) > 0.0001 || Math.abs(velZ) > 0.0001) {
    const targetRotation = Math.atan2(velX, velZ);

    // Very smooth rotation interpolation
    let rotDiff = targetRotation - helicopter.mesh.rotation.y;
    while (rotDiff > Math.PI) rotDiff -= Math.PI * 2;
    while (rotDiff < -Math.PI) rotDiff += Math.PI * 2;
    helicopter.mesh.rotation.y += rotDiff * 2 * dt;
  }

  // Gentle banking based on turning
  helicopter.mesh.rotation.z = Math.sin(helicopter.angle * 2) * 0.05;
  helicopter.mesh.rotation.x = 0.03;

  // Spin rotors
  if (helicopter.rotors) {
    helicopter.rotorAngle += dt * 20;
    for (const rotor of helicopter.rotors) {
      rotor.rotation.y = helicopter.rotorAngle;
    }
  }

  // Update light settings
  if (helicopter.light) {
    helicopter.light.intensity = settings.helicopterLightIntensity;
    helicopter.light.color.set(settings.helicopterLightColor);
    helicopter.light.angle = (settings.helicopterLightAngle * Math.PI) / 180;
    helicopter.light.distance = settings.helicopterLightDistance || 50;
    helicopter.light.position.set(
      settings.helicopterLightOffsetX || 0,
      settings.helicopterLightOffsetY || 0,
      settings.helicopterLightOffsetZ || 0
    );
  }

  // Update helicopter spotlight helper
  if (helicopterLightHelper) helicopterLightHelper.update();

  // Animate searchlight sway
  const swayAmount = settings.helicopterSearchlightSway || 0;
  const swaySpeed = settings.helicopterSearchlightSpeed || 0.5;
  const swayX = Math.sin(time * swaySpeed) * swayAmount;
  const swayZ = Math.cos(time * swaySpeed * 1.3) * swayAmount * 0.7;

  // Move the spotlight target
  if (helicopter.lightTarget) {
    helicopter.lightTarget.position.set(swayX, -10, swayZ);
  }

  // Update light cone appearance and rotation to follow searchlight
  if (helicopter.lightCone) {
    helicopter.lightCone.visible = settings.helicopterVolumetric;

    // Point cone toward the light target direction (reuse temp objects)
    _tempVec3A.set(swayX, -10, swayZ).normalize();
    _tempQuat.setFromUnitVectors(_defaultDownDir, _tempVec3A);
    helicopter.lightCone.quaternion.copy(_tempQuat);

    // Update all layers
    if (helicopter.lightCone.userData.layers) {
      helicopter.lightCone.userData.layers.forEach((layer, i) => {
        layer.material.opacity = settings.helicopterVolumetricOpacity * (1 - i * 0.15);
        layer.material.color.set(settings.helicopterLightColor);
      });
    }
  }

  // Update boundary helper visibility
  if (helicopterBoundsHelper) {
    helicopterBoundsHelper.visible = settings.helicopterShowBounds;
  }
}

export function rebuildHelicopterCone(settings) {
  if (!helicopter || !helicopter.mesh || !helicopter.lightCone) return;

  // Remove old cone group from parent
  helicopter.mesh.remove(helicopter.lightCone);

  // Dispose old layers
  if (helicopter.lightCone.userData.layers) {
    for (const layer of helicopter.lightCone.userData.layers) {
      layer.mesh.geometry.dispose();
      layer.material.dispose();
    }
  }

  // Create new geometry with updated dimensions
  const coneHeight = settings.helicopterConeHeight;
  const topRadius = settings.helicopterConeTopRadius;
  const bottomRadius = settings.helicopterConeBottomRadius;
  const coneOffsetY = settings.helicopterConeOffsetY;

  // Create new group - pivot point at top
  const lightCone = new THREE.Group();
  lightCone.position.set(0, -coneOffsetY, 0);

  const layerCount = 5;
  const coneLayers = [];

  for (let layer = 0; layer < layerCount; layer++) {
    const layerScale = 1 - (layer * 0.15);
    const layerTopRadius = topRadius * layerScale;
    const layerBottomRadius = bottomRadius * layerScale;

    const coneGeo = new THREE.CylinderGeometry(layerTopRadius, layerBottomRadius, coneHeight, 48, 24, true);

    const colors = [];
    const positions = coneGeo.attributes.position;
    for (let i = 0; i < positions.count; i++) {
      const x = positions.getX(i);
      const y = positions.getY(i);
      const z = positions.getZ(i);

      const t = (y + coneHeight / 2) / coneHeight;
      const verticalFade = Math.pow(t, 0.3);

      const radiusAtHeight = layerTopRadius + (layerBottomRadius - layerTopRadius) * (1 - t);
      const distFromCenter = Math.sqrt(x * x + z * z);
      const edgeT = radiusAtHeight > 0 ? distFromCenter / radiusAtHeight : 0;
      const edgeFade = Math.exp(-edgeT * edgeT * 2);

      const brightness = verticalFade * edgeFade;
      colors.push(brightness, brightness, brightness);
    }
    coneGeo.setAttribute("color", new THREE.Float32BufferAttribute(colors, 3));

    const layerOpacity = settings.helicopterVolumetricOpacity * (1 - layer * 0.15);

    const coneMat = new THREE.MeshBasicMaterial({
      color: settings.helicopterLightColor,
      transparent: true,
      opacity: layerOpacity,
      side: THREE.DoubleSide,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      vertexColors: true
    });

    const layerMesh = new THREE.Mesh(coneGeo, coneMat);
    layerMesh.position.y = -coneHeight / 2; // Offset down so pivot is at top
    layerMesh.castShadow = false;
    layerMesh.receiveShadow = false;
    lightCone.add(layerMesh);
    coneLayers.push({ mesh: layerMesh, material: coneMat });
  }

  lightCone.userData.layers = coneLayers;
  helicopter.lightCone = lightCone;
  helicopter.mesh.add(lightCone);
}

export function updateHelicopterColor(settings) {
  if (!helicopter || !helicopter.mesh) return;
  const materials = helicopter.mesh.userData.materials;
  if (!materials) return;
  for (const mat of materials) {
    mat.color.set(settings.helicopterColor);
    if (mat.emissive) {
      mat.emissive.set(settings.helicopterColor);
      mat.emissiveIntensity = settings.helicopterBrightness || 1.0;
    }
  }
}

export function updateHelicopterScale(settings) {
  if (!helicopter || !helicopter.mesh || !helicopter.baseScaleRatio) return;
  const scale = settings.helicopterScale * helicopter.baseScaleRatio;
  helicopter.mesh.scale.setScalar(scale);
}

export function updateHelicopterBoundsHelper(scene, settings) {
  // Remove old helper
  if (helicopterBoundsHelper) {
    scene.remove(helicopterBoundsHelper);
    helicopterBoundsHelper.geometry.dispose();
    helicopterBoundsHelper.material.dispose();
    helicopterBoundsHelper = null;
  }

  // Create new bounds visualization as a wireframe box
  const minX = settings.helicopterBoundsMinX;
  const maxX = settings.helicopterBoundsMaxX;
  const minZ = settings.helicopterBoundsMinZ;
  const maxZ = settings.helicopterBoundsMaxZ;
  const height = settings.helicopterHeight;

  const width = maxX - minX;
  const depth = maxZ - minZ;
  const boxHeight = 4;

  const geometry = new THREE.BoxGeometry(width, boxHeight, depth);
  const edges = new THREE.EdgesGeometry(geometry);
  const material = new THREE.LineBasicMaterial({ color: 0x00ff00, transparent: true, opacity: 0.5 });
  helicopterBoundsHelper = new THREE.LineSegments(edges, material);
  helicopterBoundsHelper.position.set((minX + maxX) / 2, height, (minZ + maxZ) / 2);
  helicopterBoundsHelper.visible = settings.helicopterShowBounds;
  scene.add(helicopterBoundsHelper);
}

export function setHelicopterLightHelper(helper) {
  helicopterLightHelper = helper;
}
