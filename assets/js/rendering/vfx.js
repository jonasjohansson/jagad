// Cyberpunk VFX Shader module
// Custom post-processing effects for cyberpunk aesthetic

export function createCyberpunkShader() {
  return {
    uniforms: {
      tDiffuse: { value: null },
      resolution: { value: null },
      vignetteIntensity: { value: 0.3 },
      chromaticAberration: { value: 0.003 },
      colorTint: { value: null },
      colorIntensity: { value: 0.1 },
      saturation: { value: 1.2 },
      contrast: { value: 1.1 },
    },

    vertexShader: /* glsl */ `
      varying vec2 vUv;
      void main() {
        vUv = uv;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,

    fragmentShader: /* glsl */ `
      uniform sampler2D tDiffuse;
      uniform vec2 resolution;
      uniform float vignetteIntensity;
      uniform float chromaticAberration;
      uniform vec3 colorTint;
      uniform float colorIntensity;
      uniform float saturation;
      uniform float contrast;

      varying vec2 vUv;

      void main() {
        vec2 uv = vUv;
        vec2 center = vec2(0.5);

        // Chromatic aberration
        float dist = distance(uv, center);
        vec2 dir = normalize(uv - center) * chromaticAberration * dist;

        float r = texture2D(tDiffuse, uv + dir).r;
        float g = texture2D(tDiffuse, uv).g;
        float b = texture2D(tDiffuse, uv - dir).b;
        vec3 color = vec3(r, g, b);

        // Vignette
        float vignette = 1.0 - dist * vignetteIntensity * 2.0;
        vignette = clamp(vignette, 0.0, 1.0);
        color *= vignette;

        // Color grading - tint
        color = mix(color, color * colorTint, colorIntensity);

        // Saturation
        float gray = dot(color, vec3(0.299, 0.587, 0.114));
        color = mix(vec3(gray), color, saturation);

        // Contrast
        color = (color - 0.5) * contrast + 0.5;

        gl_FragColor = vec4(color, 1.0);
      }
    `,
  };
}

export function updateCyberpunkUniforms(cyberpunkPass, settings) {
  if (!cyberpunkPass || !cyberpunkPass.uniforms) return;

  const uniforms = cyberpunkPass.uniforms;

  if (settings.vignetteEnabled) {
    uniforms.vignetteIntensity.value = settings.vignetteIntensity;
  } else {
    uniforms.vignetteIntensity.value = 0;
  }

  uniforms.chromaticAberration.value = settings.chromaticAberration;

  if (settings.colorGradingEnabled) {
    // Parse hex color to RGB
    const hex = settings.colorGradingTint.replace("#", "");
    const r = parseInt(hex.substring(0, 2), 16) / 255;
    const g = parseInt(hex.substring(2, 4), 16) / 255;
    const b = parseInt(hex.substring(4, 6), 16) / 255;
    uniforms.colorTint.value = { x: r, y: g, z: b };
    uniforms.colorIntensity.value = settings.colorGradingIntensity;
    uniforms.saturation.value = settings.colorGradingSaturation;
    uniforms.contrast.value = settings.colorGradingContrast;
  } else {
    uniforms.colorIntensity.value = 0;
    uniforms.saturation.value = 1;
    uniforms.contrast.value = 1;
  }
}
