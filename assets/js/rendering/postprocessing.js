// Post-processing module
// Manages EffectComposer and post-processing passes

import { createCyberpunkShader, updateCyberpunkUniforms } from "./vfx.js";

let composer = null;
let bloomPass = null;
let cyberpunkPass = null;
let fxaaPass = null;

export function initPostProcessing(
  THREE,
  EffectComposer,
  RenderPass,
  UnrealBloomPass,
  ShaderPass,
  FXAAPass,
  OutputPass,
  renderer,
  scene,
  camera,
  settings
) {
  composer = new EffectComposer(renderer);

  // Render pass
  const renderPass = new RenderPass(scene, camera);
  composer.addPass(renderPass);

  // Bloom pass
  bloomPass = new UnrealBloomPass(
    new THREE.Vector2(window.innerWidth, window.innerHeight),
    settings.bloomStrength,
    settings.bloomRadius,
    settings.bloomThreshold
  );
  bloomPass.enabled = settings.bloomEnabled;
  composer.addPass(bloomPass);

  // Cyberpunk VFX pass
  const cyberpunkShader = createCyberpunkShader();
  cyberpunkPass = new ShaderPass(cyberpunkShader);
  cyberpunkPass.uniforms.resolution.value = new THREE.Vector2(
    window.innerWidth,
    window.innerHeight
  );
  cyberpunkPass.uniforms.colorTint.value = new THREE.Vector3(1, 0, 1);
  updateCyberpunkUniforms(cyberpunkPass, settings);
  composer.addPass(cyberpunkPass);

  // FXAA pass
  fxaaPass = new FXAAPass();
  fxaaPass.material.uniforms["resolution"].value.set(
    1 / window.innerWidth,
    1 / window.innerHeight
  );
  fxaaPass.enabled = settings.fxaaEnabled;
  composer.addPass(fxaaPass);

  // Output pass
  const outputPass = new OutputPass();
  composer.addPass(outputPass);

  return { composer, bloomPass, cyberpunkPass, fxaaPass };
}

export function updatePostProcessing(settings) {
  if (bloomPass) {
    bloomPass.enabled = settings.bloomEnabled;
    bloomPass.threshold = settings.bloomThreshold;
    bloomPass.strength = settings.bloomStrength;
    bloomPass.radius = settings.bloomRadius;
  }

  if (cyberpunkPass) {
    updateCyberpunkUniforms(cyberpunkPass, settings);
  }

  if (fxaaPass) {
    fxaaPass.enabled = settings.fxaaEnabled;
  }
}

export function resizePostProcessing(width, height) {
  if (composer) {
    composer.setSize(width, height);
  }

  if (cyberpunkPass && cyberpunkPass.uniforms.resolution) {
    cyberpunkPass.uniforms.resolution.value.set(width, height);
  }

  if (fxaaPass && fxaaPass.material) {
    fxaaPass.material.uniforms["resolution"].value.set(1 / width, 1 / height);
  }
}

export function getComposer() {
  return composer;
}

export function getBloomPass() {
  return bloomPass;
}

export function getCyberpunkPass() {
  return cyberpunkPass;
}

export function getFxaaPass() {
  return fxaaPass;
}
