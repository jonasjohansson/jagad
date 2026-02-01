import {
	Color,
	ShaderMaterial,
	UniformsUtils,
	Vector2,
	Vector3,
	WebGLRenderTarget,
	LinearFilter,
	RGBAFormat,
	HalfFloatType
} from 'three';
import { Pass, FullScreenQuad } from './Pass.js';

/**
 * God Rays (Light Scattering) Post-Processing Pass
 *
 * Creates volumetric light shafts radiating from a light source position.
 * Based on the radial blur technique from GPU Gems 3.
 */

const GodRaysShader = {
	uniforms: {
		'tDiffuse': { value: null },
		'tOcclusion': { value: null },
		'lightPositionOnScreen': { value: new Vector2(0.5, 0.5) },
		'exposure': { value: 0.3 },
		'decay': { value: 0.95 },
		'density': { value: 0.8 },
		'weight': { value: 0.4 },
		'samples': { value: 60 }
	},

	vertexShader: /* glsl */`
		varying vec2 vUv;
		void main() {
			vUv = uv;
			gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
		}
	`,

	fragmentShader: /* glsl */`
		uniform sampler2D tDiffuse;
		uniform sampler2D tOcclusion;
		uniform vec2 lightPositionOnScreen;
		uniform float exposure;
		uniform float decay;
		uniform float density;
		uniform float weight;
		uniform int samples;

		varying vec2 vUv;

		void main() {
			vec2 deltaTextCoord = vUv - lightPositionOnScreen;
			deltaTextCoord *= 1.0 / float(samples) * density;

			vec2 coord = vUv;
			float illuminationDecay = 1.0;
			vec4 godRays = vec4(0.0);

			for (int i = 0; i < 100; i++) {
				if (i >= samples) break;
				coord -= deltaTextCoord;
				vec4 texSample = texture2D(tOcclusion, coord);
				texSample *= illuminationDecay * weight;
				godRays += texSample;
				illuminationDecay *= decay;
			}

			godRays *= exposure;

			vec4 original = texture2D(tDiffuse, vUv);
			gl_FragColor = original + godRays;
		}
	`
};

// Shader to generate occlusion map (light source mask)
const OcclusionShader = {
	uniforms: {
		'tDiffuse': { value: null },
		'lightPositionOnScreen': { value: new Vector2(0.5, 0.5) },
		'lightRadius': { value: 0.15 },
		'lightColor': { value: new Color(1, 1, 1) },
		'lightIntensity': { value: 1.0 }
	},

	vertexShader: /* glsl */`
		varying vec2 vUv;
		void main() {
			vUv = uv;
			gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
		}
	`,

	fragmentShader: /* glsl */`
		uniform sampler2D tDiffuse;
		uniform vec2 lightPositionOnScreen;
		uniform float lightRadius;
		uniform vec3 lightColor;
		uniform float lightIntensity;

		varying vec2 vUv;

		void main() {
			// Create a soft circular light source
			float dist = distance(vUv, lightPositionOnScreen);
			float falloff = 1.0 - smoothstep(0.0, lightRadius, dist);
			falloff = pow(falloff, 2.0);

			// Sample scene for bright areas (optional occlusion)
			vec4 scene = texture2D(tDiffuse, vUv);
			float brightness = dot(scene.rgb, vec3(0.299, 0.587, 0.114));

			// Combine light source with bright scene areas
			vec3 light = lightColor * falloff * lightIntensity;

			gl_FragColor = vec4(light, 1.0);
		}
	`
};

class GodRaysPass extends Pass {

	constructor(lightPosition = new Vector3(0, 50, 0), camera = null) {
		super();

		this.camera = camera;
		this.lightPosition = lightPosition;
		this.lightPositionScreen = new Vector2();

		// Settings
		this.exposure = 0.3;
		this.decay = 0.95;
		this.density = 0.8;
		this.weight = 0.4;
		this.samples = 60;
		this.lightRadius = 0.08;
		this.lightColor = new Color(0xffffff);
		this.lightIntensity = 1.0;

		// Occlusion material (creates light source mask)
		this.occlusionMaterial = new ShaderMaterial({
			uniforms: UniformsUtils.clone(OcclusionShader.uniforms),
			vertexShader: OcclusionShader.vertexShader,
			fragmentShader: OcclusionShader.fragmentShader
		});

		// God rays material (radial blur)
		this.godRaysMaterial = new ShaderMaterial({
			uniforms: UniformsUtils.clone(GodRaysShader.uniforms),
			vertexShader: GodRaysShader.vertexShader,
			fragmentShader: GodRaysShader.fragmentShader
		});

		this.fsQuad = new FullScreenQuad(null);

		// Render targets
		this.occlusionRenderTarget = null;
	}

	setSize(width, height) {
		// Use lower resolution for occlusion (performance)
		const scale = 0.5;
		const w = Math.floor(width * scale);
		const h = Math.floor(height * scale);

		if (this.occlusionRenderTarget) {
			this.occlusionRenderTarget.dispose();
		}

		this.occlusionRenderTarget = new WebGLRenderTarget(w, h, {
			minFilter: LinearFilter,
			magFilter: LinearFilter,
			format: RGBAFormat,
			type: HalfFloatType
		});
	}

	updateLightPositionScreen(renderer) {
		if (!this.camera) return false;

		// Project 3D light position to screen space
		const pos = this.lightPosition.clone();
		pos.project(this.camera);

		// Check if light is behind camera
		if (pos.z > 1) {
			return false;
		}

		// Convert to UV coordinates (0-1)
		this.lightPositionScreen.x = (pos.x + 1) / 2;
		this.lightPositionScreen.y = (pos.y + 1) / 2;

		return true;
	}

	render(renderer, writeBuffer, readBuffer /*, deltaTime, maskActive */) {
		// Update light screen position
		const lightVisible = this.updateLightPositionScreen(renderer);

		if (!lightVisible || !this.enabled) {
			// Just copy input to output if light not visible
			this.fsQuad.material = this.godRaysMaterial;
			this.godRaysMaterial.uniforms['tDiffuse'].value = readBuffer.texture;
			this.godRaysMaterial.uniforms['tOcclusion'].value = null;
			this.godRaysMaterial.uniforms['exposure'].value = 0;

			if (this.renderToScreen) {
				renderer.setRenderTarget(null);
			} else {
				renderer.setRenderTarget(writeBuffer);
			}
			this.fsQuad.render(renderer);
			return;
		}

		// Ensure render target exists
		if (!this.occlusionRenderTarget) {
			this.setSize(readBuffer.width, readBuffer.height);
		}

		// Pass 1: Generate occlusion/light source mask
		this.fsQuad.material = this.occlusionMaterial;
		this.occlusionMaterial.uniforms['tDiffuse'].value = readBuffer.texture;
		this.occlusionMaterial.uniforms['lightPositionOnScreen'].value.copy(this.lightPositionScreen);
		this.occlusionMaterial.uniforms['lightRadius'].value = this.lightRadius;
		this.occlusionMaterial.uniforms['lightColor'].value.copy(this.lightColor);
		this.occlusionMaterial.uniforms['lightIntensity'].value = this.lightIntensity;

		renderer.setRenderTarget(this.occlusionRenderTarget);
		this.fsQuad.render(renderer);

		// Pass 2: Apply god rays (radial blur)
		this.fsQuad.material = this.godRaysMaterial;
		this.godRaysMaterial.uniforms['tDiffuse'].value = readBuffer.texture;
		this.godRaysMaterial.uniforms['tOcclusion'].value = this.occlusionRenderTarget.texture;
		this.godRaysMaterial.uniforms['lightPositionOnScreen'].value.copy(this.lightPositionScreen);
		this.godRaysMaterial.uniforms['exposure'].value = this.exposure;
		this.godRaysMaterial.uniforms['decay'].value = this.decay;
		this.godRaysMaterial.uniforms['density'].value = this.density;
		this.godRaysMaterial.uniforms['weight'].value = this.weight;
		this.godRaysMaterial.uniforms['samples'].value = this.samples;

		if (this.renderToScreen) {
			renderer.setRenderTarget(null);
		} else {
			renderer.setRenderTarget(writeBuffer);
		}

		this.fsQuad.render(renderer);
	}

	dispose() {
		this.occlusionMaterial.dispose();
		this.godRaysMaterial.dispose();
		this.fsQuad.dispose();
		if (this.occlusionRenderTarget) {
			this.occlusionRenderTarget.dispose();
		}
	}

}

export { GodRaysPass };
