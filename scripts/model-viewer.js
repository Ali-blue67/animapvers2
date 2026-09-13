import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { floorLevels } from './campus-data.js';

const container = document.getElementById('model-canvas-container');
const statusEl = document.getElementById('model-status');
const levelListEl = document.getElementById('model-level-switcher');

const scene = new THREE.Scene();

const camera = new THREE.PerspectiveCamera(
  50,
  container.clientWidth / container.clientHeight,
  0.01,
  1000
);
camera.position.set(3, 3, 3);

// alpha:true + a fully transparent clear colour is what makes the
// model's background match the page behind it
const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
renderer.setClearColor(0x000000, 0);
renderer.setSize(container.clientWidth, container.clientHeight);
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
container.appendChild(renderer.domElement);

// Without this, mobile browsers try to scroll/zoom the whole page
// when you drag on the canvas instead of letting OrbitControls
// handle the gesture.
renderer.domElement.style.touchAction = 'none';

const ambientLight = new THREE.AmbientLight(0xffffff, 0.8);
scene.add(ambientLight);

const keyLight = new THREE.DirectionalLight(0xffffff, 1.1);
keyLight.position.set(5, 10, 7);
scene.add(keyLight);

const fillLight = new THREE.DirectionalLight(0xffffff, 0.4);
fillLight.position.set(-5, 2, -5);
scene.add(fillLight);

// OrbitControls already supports touch out of the box: one-finger
// drag rotates, pinch zooms, two-finger drag pans - nothing extra
// needed to get that on phones/tablets.
const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
controls.dampingFactor = 0.06;

const loader = new GLTFLoader();
let currentModel = null;
let isFirstLoad = true;

function frameCameraToObject(object) {
  const box = new THREE.Box3().setFromObject(object);
  const size = box.getSize(new THREE.Vector3());
  const center = box.getCenter(new THREE.Vector3());

  const maxDimension = Math.max(size.x, size.y, size.z) || 1;
  const fovInRadians = (camera.fov * Math.PI) / 180;
  let distance = maxDimension / (2 * Math.tan(fovInRadians / 2));
  distance *= 1.8;

  camera.position.set(
    center.x + distance * 0.6,
    center.y + distance * 0.5,
    center.z + distance * 0.6
  );
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
      materials.forEach((material) => material.dispose());
    }
  });
}

// One .glb per level, named to match the level id - e.g. the "Ground
// Floor" level (id: "ground") expects models/ground.glb.
function modelPathFor(levelId) {
  return `models/${levelId}.glb`;
}

function loadLevel(levelId) {
  const level = floorLevels.find((l) => l.id === levelId);
  if (!level) return;

  statusEl.textContent = `Loading ${level.label.toLowerCase()}\u2026`;
  document.querySelectorAll('#model-level-switcher button').forEach((btn) => {
    btn.classList.toggle('active', btn.dataset.levelId === levelId);
  });

  loader.load(
    modelPathFor(levelId),

    (gltf) => {
      if (currentModel) {
        scene.remove(currentModel);
        disposeObject(currentModel);
      }
      currentModel = gltf.scene;
      scene.add(currentModel);
      frameCameraToObject(currentModel);
      statusEl.textContent = 'Drag to rotate \u00b7 pinch or scroll to zoom \u00b7 two fingers to pan';

      if (isFirstLoad && window.finishLoading) {
        window.finishLoading();
        isFirstLoad = false;
      }
    },

    (event) => {
      if (isFirstLoad && event.lengthComputable && window.setLoadingProgress) {
        window.setLoadingProgress((event.loaded / event.total) * 100);
      }
    },

    (error) => {
      console.error(`Could not load ${modelPathFor(levelId)}:`, error);
      statusEl.textContent = `Could not load ${level.label.toLowerCase()} - check the console for details.`;

      if (isFirstLoad && window.finishLoading) {
        window.finishLoading();
        isFirstLoad = false;
      }
    }
  );
}

floorLevels.forEach((level) => {
  const button = document.createElement('button');
  button.textContent = level.label;
  button.dataset.levelId = level.id;
  button.addEventListener('click', () => loadLevel(level.id));
  levelListEl.appendChild(button);
});

loadLevel(floorLevels[0].id);

// Keeps the canvas matched to its container's size, which changes
// whenever the window resizes or the sidebar opens/closes.
const resizeObserver = new ResizeObserver(() => {
  camera.aspect = container.clientWidth / container.clientHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(container.clientWidth, container.clientHeight);
});
resizeObserver.observe(container);

function animate() {
  requestAnimationFrame(animate);
  controls.update();
  renderer.render(scene, camera);
}
animate();