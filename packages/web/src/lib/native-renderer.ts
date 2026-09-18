import type { WebGPURenderer } from "three/webgpu";
import type { Camera, Object3D, Scene } from "three";

const sceneRenderers = new WeakMap<Scene, WebGPURenderer>();

interface NativeRenderScope {
  readonly scene: Object3D;
  readonly camera: Camera;
  readonly canvas: boolean;
}
const renderScopes = new WeakMap<object, NativeRenderScope>();

/** Record the caller's target before Three selects its internal output target.
 * Nested renders restore their parent's scope; compilation has no render scope. */
export function withNativeRenderScope(
  renderer: Pick<WebGPURenderer, "getRenderTarget">,
  scene: Object3D,
  camera: Camera,
  draw: () => void,
): void {
  const previous = renderScopes.get(renderer);
  renderScopes.set(renderer, { scene, camera, canvas: renderer.getRenderTarget() === null });
  try {
    draw();
  } finally {
    if (previous === undefined) renderScopes.delete(renderer);
    else renderScopes.set(renderer, previous);
  }
}

/** True only inside an explicit main-canvas render of this scene and camera. */
export function isNativeCanvasRender(renderer: object, scene: Object3D, camera: Camera): boolean {
  const scope = renderScopes.get(renderer);
  return scope?.canvas === true && scope.scene === scene && scope.camera === camera;
}

/** Export captures share the live device so native splat sort/SH buffers stay valid. */
export function registerNativeSceneRenderer(scene: Scene, renderer: WebGPURenderer): () => void {
  sceneRenderers.set(scene, renderer);
  return () => {
    if (sceneRenderers.get(scene) === renderer) sceneRenderers.delete(scene);
  };
}

export function nativeRendererForScene(scene: Scene): WebGPURenderer | null {
  return sceneRenderers.get(scene) ?? null;
}

export function isNativeRenderer(renderer: object): renderer is WebGPURenderer {
  return "isWebGPURenderer" in renderer && renderer.isWebGPURenderer === true;
}

export function getNativeRenderer(renderer: object): WebGPURenderer | null {
  return isNativeRenderer(renderer) ? renderer : null;
}

/** Actual negotiated WebGPU limit; null means the native WebGL2 backend. */
export function nativeRendererStorageLimit(renderer: WebGPURenderer): number | null {
  const backend = renderer.backend;
  if (!("device" in backend) || typeof backend.device !== "object" || backend.device === null) return null;
  const device = backend.device;
  if (!("limits" in device) || typeof device.limits !== "object" || device.limits === null) return null;
  const limits = device.limits;
  if (!("maxStorageBufferBindingSize" in limits) || typeof limits.maxStorageBufferBindingSize !== "number") return null;
  return limits.maxStorageBufferBindingSize;
}
