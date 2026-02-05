import {
	WebGLRenderTarget,
	MeshNormalMaterial,
	ShaderMaterial,
	Vector2,
	Vector4,
	DepthTexture,
	NearestFilter,
	HalfFloatType,
	UnsignedIntType,
	DepthFormat
} from 'three';
import { Pass, FullScreenQuad } from './Pass.js';

/**
 * SelectivePixelPass - Applies pixelation only to objects on a specific layer (GLB models)
 * while rendering other objects (UI, particles, effects) normally.
 * Composites both layers using depth comparison.
 */
class SelectivePixelPass extends Pass {

	constructor( pixelSize, scene, camera, options = {} ) {

		super();

		this.pixelSize = pixelSize;
		this.scene = scene;
		this.camera = camera;
		this.normalEdgeStrength = options.normalEdgeStrength || 0.3;
		this.depthEdgeStrength = options.depthEdgeStrength || 0.4;
		this.glbLayer = options.glbLayer !== undefined ? options.glbLayer : 1;
		this.pixelationEnabled = options.pixelationEnabled !== undefined ? options.pixelationEnabled : true;

		this._resolution = new Vector2();
		this._renderResolution = new Vector2();

		this._normalMaterial = new MeshNormalMaterial();

		// Render target for pixelated GLB layer (low resolution)
		this._pixelBeautyTarget = new WebGLRenderTarget();
		this._pixelBeautyTarget.texture.minFilter = NearestFilter;
		this._pixelBeautyTarget.texture.magFilter = NearestFilter;
		this._pixelBeautyTarget.texture.type = HalfFloatType;
		this._pixelBeautyTarget.depthTexture = new DepthTexture();

		// Render target for pixelated normal pass
		this._pixelNormalTarget = new WebGLRenderTarget();
		this._pixelNormalTarget.texture.minFilter = NearestFilter;
		this._pixelNormalTarget.texture.magFilter = NearestFilter;
		this._pixelNormalTarget.texture.type = HalfFloatType;

		// Render target for normal layer (full resolution, with depth)
		this._normalLayerTarget = new WebGLRenderTarget();
		this._normalLayerTarget.texture.minFilter = NearestFilter;
		this._normalLayerTarget.texture.magFilter = NearestFilter;
		this._normalLayerTarget.texture.type = HalfFloatType;
		this._normalLayerTarget.depthTexture = new DepthTexture();

		// Create materials
		this._pixelatedMaterial = this._createPixelatedMaterial();
		this._compositeMaterial = this._createCompositeMaterial();

		this._pixelQuad = new FullScreenQuad( this._pixelatedMaterial );
		this._compositeQuad = new FullScreenQuad( this._compositeMaterial );

		// Intermediate target for pixelated result at full resolution
		this._pixelOutputTarget = new WebGLRenderTarget();
		this._pixelOutputTarget.texture.minFilter = NearestFilter;
		this._pixelOutputTarget.texture.magFilter = NearestFilter;
		this._pixelOutputTarget.texture.type = HalfFloatType;
		this._pixelOutputTarget.depthTexture = new DepthTexture();

	}

	dispose() {

		this._pixelBeautyTarget.dispose();
		this._pixelNormalTarget.dispose();
		this._normalLayerTarget.dispose();
		this._pixelOutputTarget.dispose();

		this._pixelatedMaterial.dispose();
		this._compositeMaterial.dispose();
		this._normalMaterial.dispose();

		this._pixelQuad.dispose();
		this._compositeQuad.dispose();

	}

	setSize( width, height ) {

		this._resolution.set( width, height );
		this._renderResolution.set( ( width / this.pixelSize ) | 0, ( height / this.pixelSize ) | 0 );

		const { x, y } = this._renderResolution;

		// Pixelated targets at low resolution
		this._pixelBeautyTarget.setSize( x, y );
		this._pixelNormalTarget.setSize( x, y );

		// Normal layer and output at full resolution
		this._normalLayerTarget.setSize( width, height );
		this._pixelOutputTarget.setSize( width, height );

		// Update pixelated material uniforms
		this._pixelatedMaterial.uniforms.resolution.value.set( x, y, 1 / x, 1 / y );

		// Update composite material uniforms
		this._compositeMaterial.uniforms.resolution.value.set( width, height );

	}

	setPixelSize( pixelSize ) {

		this.pixelSize = pixelSize;
		this.setSize( this._resolution.x, this._resolution.y );

	}

	render( renderer, writeBuffer ) {

		const scene = this.scene;
		const camera = this.camera;

		// Store original camera layer mask
		const originalCameraMask = camera.layers.mask;

		// If pixelation is disabled, render everything normally
		if ( !this.pixelationEnabled ) {

			// Render all layers normally
			camera.layers.mask = 0xFFFFFFFF; // All layers

			if ( this.renderToScreen ) {

				renderer.setRenderTarget( null );

			} else {

				renderer.setRenderTarget( writeBuffer );
				if ( this.clear ) renderer.clear();

			}

			renderer.render( scene, camera );
			camera.layers.mask = originalCameraMask;
			return;

		}

		// === Pass 1: Render GLB layer with pixelation ===

		// Set camera to only see GLB layer
		camera.layers.set( this.glbLayer );

		// Render beauty pass at low resolution
		renderer.setRenderTarget( this._pixelBeautyTarget );
		renderer.clear();
		renderer.render( scene, camera );

		// Render normal pass at low resolution
		const overrideMaterial_old = scene.overrideMaterial;
		renderer.setRenderTarget( this._pixelNormalTarget );
		renderer.clear();
		scene.overrideMaterial = this._normalMaterial;
		renderer.render( scene, camera );
		scene.overrideMaterial = overrideMaterial_old;

		// Apply pixelation effect and output to full resolution target
		const pixelUniforms = this._pixelatedMaterial.uniforms;
		pixelUniforms.normalEdgeStrength.value = this.normalEdgeStrength;
		pixelUniforms.depthEdgeStrength.value = this.depthEdgeStrength;
		pixelUniforms.tDiffuse.value = this._pixelBeautyTarget.texture;
		pixelUniforms.tDepth.value = this._pixelBeautyTarget.depthTexture;
		pixelUniforms.tNormal.value = this._pixelNormalTarget.texture;

		renderer.setRenderTarget( this._pixelOutputTarget );
		renderer.clear();
		this._pixelQuad.render( renderer );

		// Copy depth from low-res to high-res (we need this for compositing)
		// The depth will be sampled from pixelBeautyTarget in composite shader

		// === Pass 2: Render default layer normally ===

		// Set camera to only see default layer (layer 0)
		camera.layers.set( 0 );

		renderer.setRenderTarget( this._normalLayerTarget );
		renderer.clear();
		renderer.render( scene, camera );

		// === Pass 3: Composite with depth comparison ===

		const compUniforms = this._compositeMaterial.uniforms;
		compUniforms.tPixelated.value = this._pixelOutputTarget.texture;
		compUniforms.tNormal.value = this._normalLayerTarget.texture;
		compUniforms.tPixelatedDepth.value = this._pixelBeautyTarget.depthTexture;
		compUniforms.tNormalDepth.value = this._normalLayerTarget.depthTexture;

		if ( this.renderToScreen ) {

			renderer.setRenderTarget( null );

		} else {

			renderer.setRenderTarget( writeBuffer );
			if ( this.clear ) renderer.clear();

		}

		this._compositeQuad.render( renderer );

		// Restore camera layer mask
		camera.layers.mask = originalCameraMask;

	}

	_createPixelatedMaterial() {

		return new ShaderMaterial( {
			uniforms: {
				tDiffuse: { value: null },
				tDepth: { value: null },
				tNormal: { value: null },
				resolution: { value: new Vector4() },
				normalEdgeStrength: { value: 0 },
				depthEdgeStrength: { value: 0 }
			},
			vertexShader: `
				varying vec2 vUv;

				void main() {

					vUv = uv;
					gl_Position = projectionMatrix * modelViewMatrix * vec4( position, 1.0 );

				}
			`,
			fragmentShader: `
				uniform sampler2D tDiffuse;
				uniform sampler2D tDepth;
				uniform sampler2D tNormal;
				uniform vec4 resolution;
				uniform float normalEdgeStrength;
				uniform float depthEdgeStrength;
				varying vec2 vUv;

				float getDepth(int x, int y) {

					return texture2D( tDepth, vUv + vec2(x, y) * resolution.zw ).r;

				}

				vec3 getNormal(int x, int y) {

					return texture2D( tNormal, vUv + vec2(x, y) * resolution.zw ).rgb * 2.0 - 1.0;

				}

				float depthEdgeIndicator(float depth, vec3 normal) {

					float diff = 0.0;
					diff += clamp(getDepth(1, 0) - depth, 0.0, 1.0);
					diff += clamp(getDepth(-1, 0) - depth, 0.0, 1.0);
					diff += clamp(getDepth(0, 1) - depth, 0.0, 1.0);
					diff += clamp(getDepth(0, -1) - depth, 0.0, 1.0);
					return floor(smoothstep(0.01, 0.02, diff) * 2.) / 2.;

				}

				float neighborNormalEdgeIndicator(int x, int y, float depth, vec3 normal) {

					float depthDiff = getDepth(x, y) - depth;
					vec3 neighborNormal = getNormal(x, y);

					vec3 normalEdgeBias = vec3(1., 1., 1.);
					float normalDiff = dot(normal - neighborNormal, normalEdgeBias);
					float normalIndicator = clamp(smoothstep(-.01, .01, normalDiff), 0.0, 1.0);

					float depthIndicator = clamp(sign(depthDiff * .25 + .0025), 0.0, 1.0);

					return (1.0 - dot(normal, neighborNormal)) * depthIndicator * normalIndicator;

				}

				float normalEdgeIndicator(float depth, vec3 normal) {

					float indicator = 0.0;

					indicator += neighborNormalEdgeIndicator(0, -1, depth, normal);
					indicator += neighborNormalEdgeIndicator(0, 1, depth, normal);
					indicator += neighborNormalEdgeIndicator(-1, 0, depth, normal);
					indicator += neighborNormalEdgeIndicator(1, 0, depth, normal);

					return step(0.1, indicator);

				}

				void main() {

					vec4 texel = texture2D( tDiffuse, vUv );

					float depth = 0.0;
					vec3 normal = vec3(0.0);

					if (depthEdgeStrength > 0.0 || normalEdgeStrength > 0.0) {

						depth = getDepth(0, 0);
						normal = getNormal(0, 0);

					}

					float dei = 0.0;
					if (depthEdgeStrength > 0.0)
						dei = depthEdgeIndicator(depth, normal);

					float nei = 0.0;
					if (normalEdgeStrength > 0.0)
						nei = normalEdgeIndicator(depth, normal);

					float Strength = dei > 0.0 ? (1.0 - depthEdgeStrength * dei) : (1.0 + normalEdgeStrength * nei);

					gl_FragColor = texel * Strength;

				}
			`
		} );

	}

	_createCompositeMaterial() {

		return new ShaderMaterial( {
			uniforms: {
				tPixelated: { value: null },
				tNormal: { value: null },
				tPixelatedDepth: { value: null },
				tNormalDepth: { value: null },
				resolution: { value: new Vector2() }
			},
			vertexShader: `
				varying vec2 vUv;

				void main() {

					vUv = uv;
					gl_Position = projectionMatrix * modelViewMatrix * vec4( position, 1.0 );

				}
			`,
			fragmentShader: `
				uniform sampler2D tPixelated;
				uniform sampler2D tNormal;
				uniform sampler2D tPixelatedDepth;
				uniform sampler2D tNormalDepth;
				uniform vec2 resolution;
				varying vec2 vUv;

				void main() {

					vec4 pixelColor = texture2D( tPixelated, vUv );
					vec4 normalColor = texture2D( tNormal, vUv );
					float pixelDepth = texture2D( tPixelatedDepth, vUv ).r;
					float normalDepth = texture2D( tNormalDepth, vUv ).r;

					// Background detection (depth = 1.0 means nothing was rendered)
					bool pixelIsBackground = pixelDepth >= 0.9999;
					bool normalIsBackground = normalDepth >= 0.9999;

					// If both are background, show black
					if ( pixelIsBackground && normalIsBackground ) {
						gl_FragColor = vec4( 0.0, 0.0, 0.0, 1.0 );
						return;
					}

					// If only pixelated is background, show normal
					if ( pixelIsBackground ) {
						gl_FragColor = normalColor;
						return;
					}

					// If only normal is background, show pixelated
					if ( normalIsBackground ) {
						gl_FragColor = pixelColor;
						return;
					}

					// Both have content - use depth to determine which is in front
					// Smaller depth = closer to camera
					gl_FragColor = pixelDepth <= normalDepth ? pixelColor : normalColor;

				}
			`
		} );

	}

}

export { SelectivePixelPass };
