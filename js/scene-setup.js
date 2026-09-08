// Renderer, camera, lights and a small procedural studio environment map.
import * as THREE from 'three';
import { COLORS, LAYOUT } from './config.js';
import { quality } from './quality.js';

export const isMobile = /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent) || (navigator.maxTouchPoints > 1 && window.innerWidth < 900);

export function createRenderer(canvas) {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: false, powerPreference: 'high-performance', preserveDrawingBuffer: false });
  renderer.setPixelRatio(quality.pixelRatio); // main.js keeps this in step with AdaptiveResolution
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 0.94;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFShadowMap;
  renderer.setClearColor(new THREE.Color(COLORS.background), 1);
  return renderer;
}

export function createScene() {
  const scene = new THREE.Scene();
  const bg = new THREE.Color(COLORS.background);
  scene.background = bg;
  scene.fog = new THREE.Fog(bg, 12, 30);
  return scene;
}

export function createCamera() {
  const camera = new THREE.PerspectiveCamera(LAYOUT.fov, 1, 0.1, 60);
  camera.position.set(LAYOUT.cameraPos.x, LAYOUT.cameraPos.y, LAYOUT.cameraPos.z);
  camera.lookAt(LAYOUT.cameraLookAt.x, LAYOUT.cameraLookAt.y, LAYOUT.cameraLookAt.z);
  return camera;
}

export function createLights(scene) {
  const hemi = new THREE.HemisphereLight(new THREE.Color('#FFF6E8'), new THREE.Color('#D9B48C'), 0.75);
  scene.add(hemi);

  // Key light: warm, from the front-right and above, the only shadow caster.
  const key = new THREE.DirectionalLight(new THREE.Color('#FFF1DC'), 2.0);
  key.position.set(3.2, 6.5, 3.8);
  key.castShadow = true;
  key.shadow.mapSize.set(isMobile ? 1024 : 2048, isMobile ? 1024 : 2048);
  key.shadow.camera.near = 1;
  key.shadow.camera.far = 20;
  key.shadow.camera.left = -3.6; key.shadow.camera.right = 3.6;
  key.shadow.camera.top = 3.6; key.shadow.camera.bottom = -3.6;
  key.shadow.bias = -0.0004;
  key.shadow.normalBias = 0.02;
  key.shadow.radius = 3;
  key.target.position.set(0.6, 0, 0.2);
  scene.add(key, key.target);

  // Fill: cool cream from the left, no shadows.
  const fill = new THREE.DirectionalLight(new THREE.Color('#F3EDFF'), 0.55);
  fill.position.set(-5, 3.5, 2.5);
  scene.add(fill);

  // Rim: from behind-left, separates the dumplings from the cream.
  const rim = new THREE.DirectionalLight(new THREE.Color('#FFE9CC'), 0.9);
  rim.position.set(-2.5, 4.5, -5);
  scene.add(rim);

  return { hemi, key, fill, rim };
}

/** A tiny procedural studio: warm cream dome with two soft box lights, baked to a PMREM environment. */
export function createEnvironment(renderer, scene) {
  const env = new THREE.Scene();
  const dome = new THREE.Mesh(
    new THREE.SphereGeometry(10, 32, 16),
    new THREE.MeshBasicMaterial({ color: new THREE.Color('#E8D9C3'), side: THREE.BackSide }),
  );
  env.add(dome);
  const softbox = (w, h, x, y, z, intensity) => {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshBasicMaterial({ color: new THREE.Color('#FFFFFF').multiplyScalar(intensity), side: THREE.DoubleSide }));
    m.position.set(x, y, z);
    m.lookAt(0, 0, 0);
    env.add(m);
  };
  softbox(6, 4, 4, 6, 5, 4.0);    // key softbox
  softbox(5, 3, -6, 4, 2, 1.6);   // fill
  softbox(4, 2, -2, 5, -6, 2.2);  // rim
  const floor = new THREE.Mesh(new THREE.CircleGeometry(9, 32), new THREE.MeshBasicMaterial({ color: new THREE.Color('#D8C3A5') }));
  floor.rotation.x = -Math.PI / 2; floor.position.y = -3;
  env.add(floor);

  const pmrem = new THREE.PMREMGenerator(renderer);
  const target = pmrem.fromScene(env, 0.04);
  scene.environment = target.texture;
  scene.environmentIntensity = 0.55;
  pmrem.dispose();
  dome.geometry.dispose(); dome.material.dispose(); floor.geometry.dispose(); floor.material.dispose();
  return target.texture;
}
