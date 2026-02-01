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
 * Creates volumetric light shafts in a cone shape pointing downward.
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
		'samples': { value: 60 },
		'coneAngle': { value: 0.3 }
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
		uniform float coneAngle;

		varying vec2 vUv;

		void main() {
			// Direction from current pixel toward light (upward toward helicopter)
			vec2 toLight = lightPositionOnScreen - vUv;
			float distToLight = length(toLight);

			// Only apply rays below the light source (downward cone)
			if (vUv.y > lightPositionOnScreen.y) {
				gl_FragColor = texture2D(tDiffuse, vUv);
				return;
			}

			// Check if pixel is within the cone angle
			vec2 toLightNorm = normalize(toLight);
			float horizontalOffset = abs(vUv.x - lightPositionOnScreen.x);
			float verticalDist = lightPositionOnScreen.y - vUv.y;
			float coneWidth = verticalDist * coneAngle;

			// Fade at cone edges
			float coneFade = 1.0 - smoothstep(coneWidth * 0.5, coneWidth, horizontalOffset);

			if (coneFade <= 0.0) {
				gl_FragColor = texture2D(tDiffuse, vUv);
				return;
			}

			// Sample toward the light source
			vec2 deltaTextCoord = toLight * (1.0 / float(samples)) * density;

			vec2 coord = vUv;
			float illuminationDecay = 1.0;
			vec4 godRays = vec4(0.0);

			for (int i = 0; i < 100; i++) {
				if (i >= samples) break;
				coord += deltaTextCoord;
				vec4 texSample = texture2D(tOcclusion, coord);
				texSample *= illuminationDecay * weight;
				godRays += texSample;
				illuminationDecay *= decay;
			}

			godRays *= exposure * coneFade;

			vec4 original = texture2D(tDiffuse, vUv);
			gl_FragColor = original + godRays;
		}
	`
};

// Shader to generate occlusion map (cone-shaped light source)
const OcclusionShader = {
	uniforms: {
		'tDiffuse': { value: null },
		'lightPositionOnScreen': { value: new Vector2(0.5, 0.5) },
		'lightRadius': { value: 0.15 },
		'lightColor': { value: new Color(1, 1, 1) },
		'lightIntensity': { value: 1.0 },
		'coneAngle': { value: 0.3 },
		'coneLength': { value: 0.5 }
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
		uniform float coneAngle;
		uniform float coneLength;

		varying vec2 vUv;

		void main() {
			// Only draw below the light source
			if (vUv.y > lightPositionOnScreen.y) {
				gl_FragColor = vec4(0.0);
				return;
			}

			// Distance below the light
			float verticalDist = lightPositionOnScreen.y - vUv.y;
			float horizontalOffset = abs(vUv.x - lightPositionOnScreen.x);

			// Cone width at this depth
			float coneWidth = verticalDist * coneAngle;

			// Check if inside cone
			if (horizontalOffset > coneWidth) {
				gl_FragColor = vec4(0.0);
				return;
			}

			// Vertical falloff (fade with distance from light)
			float verticalFalloff = 1.0 - smoothstep(0.0, coneLength, verticalDist);

			// Horizontal falloff (brighter in center)
			float horizontalFalloff = 1.0 - (horizontalOffset / coneWidth);
			horizontalFalloff = pow(horizontalFalloff, 0.5);

			// Small bright spot at the light source
			float dist = distance(vUv, lightPositionOnScreen);
			float spotFalloff = 1.0 - smoothstep(0.0, lightRadius, dist);
			spotFalloff = pow(spotFalloff, 2.0);

			float intensity = max(spotFalloff, verticalFalloff * horizontalFalloff) * lightIntensity;

			gl_FragColor = vec4(lightColor * intensity, 1.0);
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
		this.coneAngle = 0.5;
		this.coneLength = 0.6;

		// Occlusion material (creates cone-shaped light source mask)
		this.occlusionMaterial = new ShaderMaterial({
			uniforms: UniformsUtils.clone(OcclusionShader.uniforms),
			vertexShader: OcclusionShader.vertexShader,
			fragmentShader: OcclusionShader.fragmentShader
		});

		// God rays material (directional blur)
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

		const pos = this.lightPosition.clone();
		pos.project(this.camera);

		if (pos.z > 1) {
			return false;
		}

		this.lightPositionScreen.x = (pos.x + 1) / 2;
		this.lightPositionScreen.y = (pos.y + 1) / 2;

		return true;
	}

	render(renderer, writeBuffer, readBuffer) {
		const lightVisible = this.updateLightPositionScreen(renderer);

		if (!lightVisible || !this.enabled) {
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

		if (!this.occlusionRenderTarget) {
			this.setSize(readBuffer.width, readBuffer.height);
		}

		// Pass 1: Generate cone-shaped occlusion mask
		this.fsQuad.material = this.occlusionMaterial;
		this.occlusionMaterial.uniforms['tDiffuse'].value = readBuffer.texture;
		this.occlusionMaterial.uniforms['lightPositionOnScreen'].value.copy(this.lightPositionScreen);
		this.occlusionMaterial.uniforms['lightRadius'].value = this.lightRadius;
		this.occlusionMaterial.uniforms['lightColor'].value.copy(this.lightColor);
		this.occlusionMaterial.uniforms['lightIntensity'].value = this.lightIntensity;
		this.occlusionMaterial.uniforms['coneAngle'].value = this.coneAngle;
		this.occlusionMaterial.uniforms['coneLength'].value = this.coneLength;

		renderer.setRenderTarget(this.occlusionRenderTarget);
		this.fsQuad.render(renderer);

		// Pass 2: Apply god rays with cone-shaped blur
		this.fsQuad.material = this.godRaysMaterial;
		this.godRaysMaterial.uniforms['tDiffuse'].value = readBuffer.texture;
		this.godRaysMaterial.uniforms['tOcclusion'].value = this.occlusionRenderTarget.texture;
		this.godRaysMaterial.uniforms['lightPositionOnScreen'].value.copy(this.lightPositionScreen);
		this.godRaysMaterial.uniforms['exposure'].value = this.exposure;
		this.godRaysMaterial.uniforms['decay'].value = this.decay;
		this.godRaysMaterial.uniforms['density'].value = this.density;
		this.godRaysMaterial.uniforms['weight'].value = this.weight;
		this.godRaysMaterial.uniforms['samples'].value = this.samples;
		this.godRaysMaterial.uniforms['coneAngle'].value = this.coneAngle;

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
