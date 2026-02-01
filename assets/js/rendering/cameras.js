// Camera system module
// Handles camera setup and switching

let orthoCamera = null;
let perspCamera = null;
let activeCamera = null;

export function setupCameras(THREE, STATE, settings) {
  const aspect = window.innerWidth / window.innerHeight;
  const levelCenter = STATE.levelCenter;

  // Orthographic camera
  const orthoSize = STATE.horizontalSize * 0.6 * settings.orthoZoom;
  orthoCamera = new THREE.OrthographicCamera(
    -orthoSize * aspect,
    orthoSize * aspect,
    orthoSize,
    -orthoSize,
    0.1,
    1000
  );
  orthoCamera.position.set(levelCenter.x, levelCenter.y + 50, levelCenter.z);
  orthoCamera.lookAt(levelCenter);
  orthoCamera.up.set(0, 0, -1);

  // Perspective camera
  perspCamera = new THREE.PerspectiveCamera(
    settings.perspFov,
    aspect,
    settings.perspNear,
    settings.perspFar
  );
  perspCamera.position.set(
    levelCenter.x + settings.perspPosX,
    settings.perspPosY,
    levelCenter.z + settings.perspPosZ
  );
  perspCamera.lookAt(levelCenter);

  // Set active camera based on settings
  activeCamera = settings.cameraType === "ortho" ? orthoCamera : perspCamera;

  return { orthoCamera, perspCamera, activeCamera };
}

export function switchCamera(settings) {
  activeCamera = settings.cameraType === "ortho" ? orthoCamera : perspCamera;
  return activeCamera;
}

export function getActiveCamera() {
  return activeCamera;
}

export function getOrthoCamera() {
  return orthoCamera;
}

export function getPerspCamera() {
  return perspCamera;
}

export function updateCameraOnResize(aspect, STATE, settings) {
  if (orthoCamera) {
    const orthoSize = STATE.horizontalSize * 0.6 * settings.orthoZoom;
    orthoCamera.left = -orthoSize * aspect;
    orthoCamera.right = orthoSize * aspect;
    orthoCamera.top = orthoSize;
    orthoCamera.bottom = -orthoSize;
    orthoCamera.updateProjectionMatrix();
  }

  if (perspCamera) {
    perspCamera.aspect = aspect;
    perspCamera.fov = settings.perspFov;
    perspCamera.near = settings.perspNear;
    perspCamera.far = settings.perspFar;
    perspCamera.updateProjectionMatrix();
  }
}

export function updateCameraPosition(STATE, settings) {
  const levelCenter = STATE.levelCenter;

  if (orthoCamera) {
    const aspect = window.innerWidth / window.innerHeight;
    const orthoSize = STATE.horizontalSize * 0.6 * settings.orthoZoom;
    orthoCamera.left = -orthoSize * aspect;
    orthoCamera.right = orthoSize * aspect;
    orthoCamera.top = orthoSize;
    orthoCamera.bottom = -orthoSize;
    orthoCamera.position.set(levelCenter.x, levelCenter.y + 50, levelCenter.z);
    orthoCamera.lookAt(levelCenter);
    orthoCamera.updateProjectionMatrix();
  }

  if (perspCamera) {
    perspCamera.position.set(
      levelCenter.x + settings.perspPosX,
      settings.perspPosY,
      levelCenter.z + settings.perspPosZ
    );
    perspCamera.lookAt(levelCenter);
    perspCamera.fov = settings.perspFov;
    perspCamera.near = settings.perspNear;
    perspCamera.far = settings.perspFar;
    perspCamera.updateProjectionMatrix();
  }
}
