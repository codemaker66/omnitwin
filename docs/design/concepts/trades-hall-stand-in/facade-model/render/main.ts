import * as THREE from "three";
import {
  configureTradesHallFacadeStandInRenderer,
  createTradesHallFacadeStandInEnvironment,
  createTradesHallFacadeStandInLookDevLights,
  createTradesHallFacadeStandInModel,
  frameTradesHallFacadeStandInCamera,
} from "../src/createObjectModel";

declare global {
  interface Window {
    __FACADE_READY__?: boolean;
    __FACADE_DEBUG__?: {
      bounds: { min: number[]; max: number[] };
      camera: number[];
      meshCount: number;
    };
  }
}

const app = document.querySelector<HTMLDivElement>("#app");
if (!app) throw new Error("Facade review mount not found");

const params = new URLSearchParams(window.location.search);
const view = params.get("view") ?? "front";
const evaluationMode = params.get("evaluation") === "1";
const lightMode = params.get("light") === "grazing" ? "grazing" : params.get("light") === "reference" ? "reference" : "neutral";
if (evaluationMode) document.querySelector(".label")?.remove();

const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false, preserveDrawingBuffer: true });
// Keep the deterministic review bitmap at CSS-pixel resolution. The in-app
// capture surface otherwise crops a high-DPI drawing buffer instead of
// resampling it, which invalidates silhouette diagnostics.
renderer.setPixelRatio(1);
const reviewPixelRatio = Math.max(1, window.devicePixelRatio);
const reviewWidth = Math.round(window.innerWidth / reviewPixelRatio);
const reviewHeight = Math.round(window.innerHeight / reviewPixelRatio);
renderer.setSize(reviewWidth, reviewHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.toneMappingExposure = 1.05;
configureTradesHallFacadeStandInRenderer(renderer);
app.appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x111416);
scene.fog = new THREE.Fog(0x111416, 34, 58);
scene.environment = createTradesHallFacadeStandInEnvironment(renderer);

const camera = new THREE.PerspectiveCamera(34, reviewWidth / reviewHeight, 0.1, 100);
const model = createTradesHallFacadeStandInModel({
  castShadow: true,
  receiveShadow: true,
  textureSize: 512,
  textureAnisotropy: 8,
  qualityPriority: "balanced",
});
if ((params.get("pass") ?? "blockout") === "blockout") {
  const clay = new THREE.MeshStandardMaterial({ color: 0xb79a6a, roughness: 0.82, metalness: 0 });
  model.traverse((object) => {
    if (object instanceof THREE.Mesh && object.name !== "root") object.material = clay;
  });
}
scene.add(model);
scene.add(createTradesHallFacadeStandInLookDevLights(lightMode));

const ground = new THREE.Mesh(
  new THREE.PlaneGeometry(38, 28),
  new THREE.MeshStandardMaterial({ color: 0x171a1c, roughness: 0.96, metalness: 0 }),
);
if (!evaluationMode) {
  ground.rotation.x = -Math.PI / 2;
  ground.position.y = -0.04;
  ground.receiveShadow = true;
  scene.add(ground);
}

const azimuth = view === "left" ? -32 : view === "right" ? 32 : 0;
const elevation = view === "low" ? -5 : 7;
const frameMargin = evaluationMode ? 0.72 : 1.22;
frameTradesHallFacadeStandInCamera(camera, model, { margin: frameMargin, azimuthDeg: azimuth, elevationDeg: elevation });

const debugBounds = new THREE.Box3().setFromObject(model);
let debugMeshCount = 0;
model.traverse((object) => {
  if (object instanceof THREE.Mesh) debugMeshCount += 1;
});
window.__FACADE_DEBUG__ = {
  bounds: { min: debugBounds.min.toArray(), max: debugBounds.max.toArray() },
  camera: camera.position.toArray(),
  meshCount: debugMeshCount,
};
document.body.dataset.facadeDebug = JSON.stringify(window.__FACADE_DEBUG__);
document.body.dataset.facadeViewport = `${String(window.innerWidth)}x${String(window.innerHeight)}@${String(window.devicePixelRatio)}`;

function render(): void {
  renderer.render(scene, camera);
}

render();
window.__FACADE_READY__ = true;

window.addEventListener("resize", () => {
  const nextWidth = Math.round(window.innerWidth / Math.max(1, window.devicePixelRatio));
  const nextHeight = Math.round(window.innerHeight / Math.max(1, window.devicePixelRatio));
  camera.aspect = nextWidth / nextHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(nextWidth, nextHeight);
  frameTradesHallFacadeStandInCamera(camera, model, { margin: frameMargin, azimuthDeg: azimuth, elevationDeg: elevation });
  render();
});
