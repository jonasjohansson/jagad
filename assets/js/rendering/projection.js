// Projection system module
// Handles state-based image projection onto the game level

let projectionPlane = null;
let projectionTextures = {};

export function initProjectionPlane(THREE, scene, STATE, settings) {
  if (projectionPlane) return; // Already initialized

  // Create a large plane above the level for projection
  const size = STATE.horizontalSize * 2 || 30;
  const geometry = new THREE.PlaneGeometry(size, size);
  const material = new THREE.MeshBasicMaterial({
    transparent: true,
    opacity: settings.projectionOpacity,
    side: THREE.DoubleSide,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });

  projectionPlane = new THREE.Mesh(geometry, material);
  projectionPlane.rotation.x = -Math.PI / 2; // Horizontal plane
  projectionPlane.position.set(
    STATE.levelCenter.x + settings.projectionOffsetX,
    STATE.levelCenter.y + settings.projectionOffsetY,
    STATE.levelCenter.z + settings.projectionOffsetZ
  );
  projectionPlane.renderOrder = 10;
  projectionPlane.visible = false;

  scene.add(projectionPlane);

  // Preload textures for each state
  preloadProjectionTextures(THREE, STATE, settings);

  return projectionPlane;
}

export function preloadProjectionTextures(THREE, STATE, settings) {
  const textureLoader = new THREE.TextureLoader();
  const imagePath = "assets/images/";

  const stateImages = {
    PRE_GAME: settings.preGameImage,
    STARTING: settings.startingImage,
    PLAYING: settings.playingImage,
    GAME_OVER: settings.gameOverImage,
  };

  for (const [state, imageName] of Object.entries(stateImages)) {
    if (imageName && imageName.trim() !== "") {
      textureLoader.load(
        imagePath + imageName,
        (texture) => {
          texture.colorSpace = THREE.SRGBColorSpace;
          projectionTextures[state] = texture;
          // If this is the current state, update the projection
          if (STATE.gameState === state) {
            updateProjectionForState(state, STATE, settings);
          }
        },
        undefined,
        (err) => {
          console.warn(`Failed to load projection image for ${state}:`, imageName);
        }
      );
    }
  }
}

export function updateProjectionForState(state, STATE, settings) {
  if (!projectionPlane) return;

  const stateImageSettings = {
    PRE_GAME: settings.preGameImage,
    STARTING: settings.startingImage,
    PLAYING: settings.playingImage,
    GAME_OVER: settings.gameOverImage,
  };

  const imageName = stateImageSettings[state];

  if (imageName && imageName.trim() !== "" && projectionTextures[state]) {
    const texture = projectionTextures[state];
    projectionPlane.material.map = texture;
    projectionPlane.material.needsUpdate = true;
    projectionPlane.visible = true;

    // Adjust scale based on image aspect ratio
    const img = texture.image;
    if (img && img.width && img.height) {
      const aspect = img.width / img.height;
      projectionPlane.scale.set(
        settings.projectionScale * aspect,
        settings.projectionScale,
        1
      );
    } else {
      projectionPlane.scale.setScalar(settings.projectionScale);
    }
  } else {
    projectionPlane.visible = false;
  }

  // Update projection properties
  projectionPlane.material.opacity = settings.projectionOpacity;
  projectionPlane.position.x = STATE.levelCenter.x + settings.projectionOffsetX;
  projectionPlane.position.y = STATE.levelCenter.y + settings.projectionOffsetY;
  projectionPlane.position.z = STATE.levelCenter.z + settings.projectionOffsetZ;
}

export function loadProjectionImage(THREE, state, imageName, STATE, settings) {
  if (!imageName || imageName.trim() === "") {
    projectionTextures[state] = null;
    if (STATE.gameState === state) {
      updateProjectionForState(state, STATE, settings);
    }
    return;
  }

  const textureLoader = new THREE.TextureLoader();
  textureLoader.load(
    "assets/images/" + imageName,
    (texture) => {
      texture.colorSpace = THREE.SRGBColorSpace;
      projectionTextures[state] = texture;
      if (STATE.gameState === state) {
        updateProjectionForState(state, STATE, settings);
      }
    },
    undefined,
    (err) => {
      console.warn(`Failed to load projection image for ${state}:`, imageName);
    }
  );
}

export function getProjectionPlane() {
  return projectionPlane;
}
