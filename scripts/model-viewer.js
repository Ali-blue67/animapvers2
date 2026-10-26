import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { floorLevels } from './campus-data.js';
import { createIcon } from './icons.js';

const container = document.getElementById('model-canvas-container');
const statusEl = document.getElementById('model-status');
const levelListEl = document.getElementById('model-level-switcher');

const HINT = 'Drag to rotate \u00b7 pinch or scroll to zoom \u00b7 two fingers to pan';

const scene = new THREE.Scene();

const camera = new THREE.PerspectiveCamera(50, container.clientWidth / container.clientHeight, 0.01, 1000);
camera.position.set(3, 3, 3);

// alpha:true + a fully transparent clear colour lets the page behind
// the canvas show through, so the model sits on the card's own white.
const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
renderer.setClearColor(0x000000, 0);
renderer.setSize(container.clientWidth, container.clientHeight);
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
container.appendChild(renderer.domElement);

const canvas = renderer.domElement;
canvas.style.touchAction = 'none'; // let OrbitControls own touch gestures instead of the page scrolling
canvas.tabIndex = 0;
canvas.setAttribute('role', 'img');
canvas.setAttribute('aria-label', '3D model of the selected level. Arrow keys pan, drag rotates, scroll or pinch zooms.');

scene.add(new THREE.AmbientLight(0xffffff, 0.8));

const keyLight = new THREE.DirectionalLight(0xffffff, 1.1);
keyLight.position.set(5, 10, 7);
scene.add(keyLight);

const fillLight = new THREE.DirectionalLight(0xffffff, 0.4);
fillLight.position.set(-5, 2, -5);
scene.add(fillLight);

// OrbitControls handles mouse and touch out of the box (one finger
// rotates, pinch zooms, two fingers pan); this adds keyboard panning.
const controls = new OrbitControls(camera, canvas);
controls.enableDamping = true;
controls.dampingFactor = 0.06;
controls.listenToKeyEvents(canvas);

const loader = new GLTFLoader();
let currentModel = null;
let isFirstLoad = true;
let loadToken = 0; // ignores a slow load that finishes after a newer one was requested
let emptyEl = null;

function frameCameraToObject(object) {
  const box = new THREE.Box3().setFromObject(object);
  const size = box.getSize(new THREE.Vector3());
  const center = box.getCenter(new THREE.Vector3());

  const maxDimension = Math.max(size.x, size.y, size.z) || 1;
  const fov = (camera.fov * Math.PI) / 180;
  const distance = (maxDimension / (2 * Math.tan(fov / 2))) * 1.8;

  camera.position.set(center.x + distance * 0.6, center.y + distance * 0.5, center.z + distance * 0.6);
  camera.near = maxDimension / 100;
  camera.far = maxDimension * 100;
  camera.updateProjectionMatrix();

  controls.target.copy(center);
  controls.update();
}

function disposeObject(object) {
  object.traverse((child) => {
    if (child.geometry) child.geometry.dispose();
    if (child.material) {
      const materials = Array.isArray(child.material) ? child.material : [child.material];
      materials.forEach((m) => m.dispose());
    }
  });
}

function removeCurrentModel() {
  if (!currentModel) return;
  scene.remove(currentModel);
  disposeObject(currentModel);
  currentModel = null;
}

function hideEmpty() {
  if (emptyEl) emptyEl.remove();
  emptyEl = null;
}

function showEmpty(level) {
  hideEmpty();
  const icon = document.createElement('span');
  icon.className = 'empty-icon';
  icon.appendChild(createIcon('cube', { size: 26 }));

  const title = document.createElement('h3');
  title.textContent = `${level.label} isn\u2019t available in 3D yet`;

  const body = document.createElement('p');
  body.textContent = 'Try another level, or use 2D navigation to find your way.';

  emptyEl = document.createElement('div');
  emptyEl.className = 'model-empty';
  emptyEl.append(icon, title, body);
  container.appendChild(emptyEl);
}

// One .glb per level, named after the level id (e.g. models/ground.glb).
const modelPathFor = (levelId) => `models/${levelId}.glb`;

function finishFirstLoad() {
  if (isFirstLoad && window.finishLoading) window.finishLoading();
  isFirstLoad = false;
}

function loadLevel(levelId) {
  const level = floorLevels.find((l) => l.id === levelId);
  if (!level) return;

  const token = ++loadToken;
  statusEl.textContent = `Loading ${level.label}\u2026`;
  levelListEl.querySelectorAll('button').forEach((btn) => {
    btn.setAttribute('aria-pressed', String(btn.dataset.levelId === levelId));
  });

  loader.load(
    modelPathFor(levelId),
    (gltf) => {
      if (token !== loadToken) return;
      removeCurrentModel();
      hideEmpty();
      currentModel = gltf.scene;
      scene.add(currentModel);
      frameCameraToObject(currentModel);
      statusEl.textContent = HINT;
      finishFirstLoad();
    },
    (event) => {
      if (token === loadToken && isFirstLoad && event.lengthComputable && window.setLoadingProgress) {
        window.setLoadingProgress((event.loaded / event.total) * 100);
      }
    },
    (error) => {
      if (token !== loadToken) return;
      console.error(`Could not load ${modelPathFor(levelId)}:`, error);
      removeCurrentModel(); // never leave the previous level showing under a new label
      showEmpty(level);
      statusEl.textContent = `No 3D model for ${level.label} yet.`;
      finishFirstLoad();
    }
  );
}

floorLevels.forEach((level) => {
  const button = document.createElement('button');
  button.type = 'button';
  button.textContent = level.label;
  button.dataset.levelId = level.id;
  button.setAttribute('aria-pressed', 'false');
  button.addEventListener('click', () => loadLevel(level.id));
  levelListEl.appendChild(button);
});

loadLevel(floorLevels[0].id);

// Keep the canvas matched to its container (window resize, sidebar toggle).
new ResizeObserver(() => {
  camera.aspect = container.clientWidth / container.clientHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(container.clientWidth, container.clientHeight);
}).observe(container);

function animate() {
  requestAnimationFrame(animate);
  controls.update();
  renderer.render(scene, camera);
}
animate();