// Lighting system — scene lights, tone mapping, PBR environment
// Extracted from main.js

import * as THREE from "../lib/three/three.module.js";

export const toneMappingOptions = {
  "None": THREE.NoToneMapping,
  "Linear": THREE.LinearToneMapping,
  "Reinhard": THREE.ReinhardToneMapping,
  "Cineon": THREE.CineonToneMapping,
  "ACESFilmic": THREE.ACESFilmicToneMapping,
  "AgX": THREE.AgXToneMapping,
  "Neutral": THREE.NeutralToneMapping,
};

export function setupLights(scene, renderer, settings) {
  const ambientLight = new THREE.AmbientLight(settings.ambientColor, settings.ambientIntensity);
  scene.add(ambientLight);

  const directionalLight = new THREE.DirectionalLight(settings.directColor, settings.directIntensity);
  directionalLight.position.set(settings.directPosX, settings.directPosY, settings.directPosZ);
  directionalLight.castShadow = true;
  directionalLight.shadow.mapSize.width = 4096;
  directionalLight.shadow.mapSize.height = 4096;
  directionalLight.shadow.camera.near = 0.1;
  directionalLight.shadow.camera.far = 50;
  directionalLight.shadow.camera.left = -15;
  directionalLight.shadow.camera.right = 15;
  directionalLight.shadow.camera.top = 15;
  directionalLight.shadow.camera.bottom = -15;
  directionalLight.shadow.bias = -0.002;
  directionalLight.shadow.normalBias = 0.05;
  scene.add(directionalLight);

  // Apply initial tone mapping
  renderer.toneMapping = toneMappingOptions[settings.toneMapping] || THREE.LinearToneMapping;
  renderer.toneMappingExposure = settings.exposure;

  // Generate neutral environment for PBR materials
  const pmremGenerator = new THREE.PMREMGenerator(renderer);
  pmremGenerator.compileEquirectangularShader();

  const envScene = new THREE.Scene();
  envScene.background = new THREE.Color(0.5, 0.5, 0.5);

  const light1 = new THREE.DirectionalLight(0xffffff, 1);
  light1.position.set(1, 1, 1);
  envScene.add(light1);

  const light2 = new THREE.DirectionalLight(0xffffff, 0.5);
  light2.position.set(-1, 0.5, -1);
  envScene.add(light2);

  const ambLight = new THREE.AmbientLight(0xffffff, 0.4);
  envScene.add(ambLight);

  const neutralEnvMap = pmremGenerator.fromScene(envScene, 0.04).texture;
  pmremGenerator.dispose();

  scene.environment = neutralEnvMap;
  scene.environmentIntensity = settings.environmentIntensity;

  return { ambientLight, directionalLight };
}
