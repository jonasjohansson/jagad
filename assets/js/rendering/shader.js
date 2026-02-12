// Cyberpunk VFX Shader
// Color grading, vignette, chromatic aberration, per-channel gain/lift/gamma

import * as THREE from "../lib/three/three.module.js";

export const CyberpunkShader = {
  uniforms: {
    'tDiffuse': { value: null },
    'vignetteIntensity': { value: 0.4 },
    'chromaticAberration': { value: 0.003 },
    'tintColor': { value: new THREE.Color(0xff00ff) },
    'tintIntensity': { value: 0.15 },
    'saturation': { value: 1.2 },
    'contrast': { value: 1.1 },
    'brightness': { value: 1.0 },
    'gain': { value: new THREE.Vector3(1, 1, 1) },
    'lift': { value: new THREE.Vector3(0, 0, 0) },
    'gamma': { value: 1.0 },
    'time': { value: 0 }
  },
  vertexShader: `
    varying vec2 vUv;
    void main() {
      vUv = uv;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
  `,
  fragmentShader: `
    uniform sampler2D tDiffuse;
    uniform float vignetteIntensity;
    uniform float chromaticAberration;
    uniform vec3 tintColor;
    uniform float tintIntensity;
    uniform float saturation;
    uniform float contrast;
    uniform float brightness;
    uniform vec3 gain;
    uniform vec3 lift;
    uniform float gamma;
    uniform float time;
    varying vec2 vUv;

    void main() {
      vec2 uv = vUv;
      vec2 center = uv - 0.5;
      float dist = length(center);

      // Chromatic aberration
      float aberration = chromaticAberration * dist;
      float r = texture2D(tDiffuse, uv + vec2(aberration, 0.0)).r;
      float g = texture2D(tDiffuse, uv).g;
      float b = texture2D(tDiffuse, uv - vec2(aberration, 0.0)).b;
      vec3 color = vec3(r, g, b);

      // Brightness
      color *= brightness;

      // RGB channel gain (multiply per channel)
      color *= gain;

      // Lift (add to shadows — applied before gamma so it mainly affects darks)
      color += lift;

      // Gamma correction
      float invGamma = 1.0 / gamma;
      color = pow(max(color, vec3(0.0)), vec3(invGamma));

      // Saturation
      float luminance = dot(color, vec3(0.299, 0.587, 0.114));
      color = mix(vec3(luminance), color, saturation);

      // Contrast
      color = (color - 0.5) * contrast + 0.5;

      // Color tint (additive cyberpunk glow)
      color += tintColor * tintIntensity * (0.5 + 0.5 * sin(time * 0.5));

      // Vignette
      float vignette = 1.0 - dist * vignetteIntensity * 2.0;
      vignette = clamp(vignette, 0.0, 1.0);
      vignette = smoothstep(0.0, 1.0, vignette);
      color *= vignette;

      gl_FragColor = vec4(color, 1.0);
    }
  `
};
