import {
	WebGLRenderTarget,
	MeshNormalMaterial,
	ShaderMaterial,
	Vector2,
	Vector4,
	DepthTexture,
	NearestFilter,
	HalfFloatType
} from 'three';
import { Pass, FullScreenQuad } from './Pass.js';

class RenderPixelatedPass extends Pass {

	constructor( pixelSize, scene, camera, options = {} ) {

		super();

		this.pixelSize = pixelSize;
		this.scene = scene;
		this.camera = camera;
		this.normalEdgeStrength = options.normalEdgeStrength || 0.3;
		this.depthEdgeStrength = options.depthEdgeStrength || 0.4;
		this.pixelatedMaterial = this._createPixelatedMaterial();

		this._resolution = new Vector2();
		this._renderResolution = new Vector2();

		this._normalMaterial = new MeshNormalMaterial();

		this._beautyRenderTarget = new WebGLRenderTarget();
		this._beautyRenderTarget.texture.minFilter = NearestFilter;
		this._beautyRenderTarget.texture.magFilter = NearestFilter;
		this._beautyRenderTarget.texture.type = HalfFloatType;
		this._beautyRenderTarget.depthTexture = new DepthTexture();

		this._normalRenderTarget = new WebGLRenderTarget();
		this._normalRenderTarget.texture.minFilter = NearestFilter;
		this._normalRenderTarget.texture.magFilter = NearestFilter;
		this._normalRenderTarget.texture.type = HalfFloatType;

		this._fsQuad = new FullScreenQuad( this.pixelatedMaterial );

	}

	dispose() {

		this._beautyRenderTarget.dispose();
		this._normalRenderTarget.dispose();

		this.pixelatedMaterial.dispose();
		this._normalMaterial.dispose();

		this._fsQuad.dispose();

	}

	setSize( width, height ) {

		this._resolution.set( width, height );
		this._renderResolution.set( ( width / this.pixelSize ) | 0, ( height / this.pixelSize ) | 0 );
		const { x, y } = this._renderResolution;
		this._beautyRenderTarget.setSize( x, y );
		this._normalRenderTarget.setSize( x, y );
		this._fsQuad.material.uniforms.resolution.value.set( x, y, 1 / x, 1 / y );

	}

	setPixelSize( pixelSize ) {

		this.pixelSize = pixelSize;
		this.setSize( this._resolution.x, this._resolution.y );

	}

	render( renderer, writeBuffer ) {

		const uniforms = this._fsQuad.material.uniforms;
		uniforms.normalEdgeStrength.value = this.normalEdgeStrength;
		uniforms.depthEdgeStrength.value = this.depthEdgeStrength;

		renderer.setRenderTarget( this._beautyRenderTarget );
		renderer.render( this.scene, this.camera );

		const overrideMaterial_old = this.scene.overrideMaterial;
		renderer.setRenderTarget( this._normalRenderTarget );
		this.scene.overrideMaterial = this._normalMaterial;
		renderer.render( this.scene, this.camera );
		this.scene.overrideMaterial = overrideMaterial_old;

		uniforms.tDiffuse.value = this._beautyRenderTarget.texture;
		uniforms.tDepth.value = this._beautyRenderTarget.depthTexture;
		uniforms.tNormal.value = this._normalRenderTarget.texture;

		if ( this.renderToScreen ) {

			renderer.setRenderTarget( null );

		} else {

			renderer.setRenderTarget( writeBuffer );

			if ( this.clear ) renderer.clear();

		}

		this._fsQuad.render( renderer );

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

}

export { RenderPixelatedPass };
