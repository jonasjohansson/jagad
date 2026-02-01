// Lighting system module
// Handles scene lighting setup and updates

let ambientLight = null;
let directionalLight = null;

export function setupLights(THREE, scene, settings) {
  // Ambient light
  ambientLight = new THREE.AmbientLight(
    new THREE.Color(settings.ambientColor),
    settings.ambientIntensity
  );
  scene.add(ambientLight);

  // Directional light
  directionalLight = new THREE.DirectionalLight(
    new THREE.Color(settings.directColor),
    settings.directIntensity
  );
  directionalLight.position.set(
    settings.directPosX,
    settings.directPosY,
    settings.directPosZ
  );
  directionalLight.castShadow = true;
  directionalLight.shadow.mapSize.width = 2048;
  directionalLight.shadow.mapSize.height = 2048;
  directionalLight.shadow.camera.near = 0.1;
  directionalLight.shadow.camera.far = 100;
  directionalLight.shadow.camera.left = -30;
  directionalLight.shadow.camera.right = 30;
  directionalLight.shadow.camera.top = 30;
  directionalLight.shadow.camera.bottom = -30;
  scene.add(directionalLight);

  return { ambientLight, directionalLight };
}

export function updateAmbientLight(settings) {
  if (ambientLight) {
    ambientLight.color.set(settings.ambientColor);
    ambientLight.intensity = settings.ambientIntensity;
  }
}

export function updateDirectionalLight(settings) {
  if (directionalLight) {
    directionalLight.color.set(settings.directColor);
    directionalLight.intensity = settings.directIntensity;
    directionalLight.position.set(
      settings.directPosX,
      settings.directPosY,
      settings.directPosZ
    );
  }
}

export function updateFugitiveLights(fugitives, settings) {
  for (const f of fugitives) {
    if (f.light) {
      f.light.color.set(settings.fugitiveColor);
      f.light.intensity = settings.fugitiveLightIntensity;
    }
  }
}

export function updateChaserLights(chasers, settings) {
  const colors = [
    settings.chaser1Color,
    settings.chaser2Color,
    settings.chaser3Color,
    settings.chaser4Color,
  ];

  for (let i = 0; i < chasers.length; i++) {
    const c = chasers[i];
    if (c.spotlight) {
      c.spotlight.color.set(colors[i] || "#ffffff");
      c.spotlight.intensity = settings.chaserLightIntensity;
      c.spotlight.distance = settings.chaserLightDistance;
      c.spotlight.angle = THREE.MathUtils.degToRad(settings.chaserLightAngle);
      c.spotlight.penumbra = settings.chaserLightPenumbra;
      if (c.spotlight.target) {
        c.spotlight.target.position.set(0, -1, 0);
      }
    }
  }
}

export function setupToneMapping(THREE, renderer, scene, settings) {
  // Set tone mapping
  const toneMappings = {
    None: THREE.NoToneMapping,
    Linear: THREE.LinearToneMapping,
    Reinhard: THREE.ReinhardToneMapping,
    Cineon: THREE.CineonToneMapping,
    ACES: THREE.ACESFilmicToneMapping,
    Neutral: THREE.NeutralToneMapping,
  };

  renderer.toneMapping = toneMappings[settings.toneMapping] || THREE.NeutralToneMapping;
  renderer.toneMappingExposure = settings.exposure;

  // Create neutral environment for PBR
  if (settings.punctualLights) {
    const pmremGenerator = new THREE.PMREMGenerator(renderer);
    pmremGenerator.compileEquirectangularShader();

    const neutralEnvTexture = pmremGenerator.fromScene(
      new THREE.Scene(),
      0,
      0.1,
      1000
    ).texture;

    scene.environment = neutralEnvTexture;
    scene.environmentIntensity = settings.environmentIntensity;

    pmremGenerator.dispose();
  }
}

export function getAmbientLight() {
  return ambientLight;
}

export function getDirectionalLight() {
  return directionalLight;
}
