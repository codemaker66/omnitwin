import type { WebGPURenderer } from "three/webgpu";
import { Color, type Camera, type Object3D, type Scene } from "three";
import type { RootState } from "@react-three/fiber";
import { waitForNativeGpuWork } from "./native-gpu-completion.js";
import { getGpuRenderer, type GpuRendererContext } from "./device-tier.js";

const sceneRenderers = new WeakMap<Scene, WebGPURenderer>();

interface NativeRenderScope {
  readonly scene: Object3D;
  readonly camera: Camera;
  readonly canvas: boolean;
  readonly completions: { start: () => void; fail: (reason: unknown) => void }[];
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
  const scope: NativeRenderScope = { scene, camera, canvas: previous === undefined && renderer.getRenderTarget() === null, completions: [] };
  renderScopes.set(renderer, scope);
  try {
    draw();
  } catch (reason: unknown) {
    for (const completion of scope.completions) completion.fail(reason);
    throw reason;
  } finally {
    if (previous === undefined) renderScopes.delete(renderer);
    else renderScopes.set(renderer, previous);
  }
  // WebGPU submits its command buffer at the end of render, after object callbacks.
  // Internal/nested renders cannot acknowledge the enclosing main frame early.
  for (const completion of scope.completions) completion.start();
}

/** Register only during a matching main draw; wait starts after the whole draw succeeds. */
export function afterNativeCanvasGpuWork(
  renderer: WebGPURenderer,
  scene: Object3D,
  camera: Camera,
  signal: AbortSignal,
  complete: () => void,
  failed: (reason: unknown) => void,
): boolean {
  const scope = renderScopes.get(renderer);
  if (scope?.canvas !== true || scope.scene !== scene || scope.camera !== camera || signal.aborted) return false;
  const dispatch = (callback: () => void): void => {
    try { callback(); } catch (reason: unknown) {
      const message = reason instanceof Error ? reason.message : String(reason);
      // Async readiness failures use the same recoverable renderer boundary as
      // synchronous drawing. Never leave callback exceptions as rejected promises.
      try { renderer.onError(`Native GPU readiness callback failed: ${message}`); }
      catch (reportingError: unknown) { globalThis.reportError(reportingError); }
    }
  };
  scope.completions.push({
    start: () => { void waitForNativeGpuWork(renderer, signal).then(() => { dispatch(complete); }, (reason: unknown) => { dispatch(() => { failed(reason); }); }); },
    fail: (reason: unknown) => { dispatch(() => { failed(reason); }); },
  });
  return true;
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

/**
 * What R3F and NativeCanvas give a renderer before any scene effect layers its
 * own values on top. A replacement renderer starts from these; the effects
 * keyed on the renderer (tone mapping, exposure, clipping, resolution) then set
 * theirs again, and remember the right value to restore.
 */
export interface NativeRendererSettings {
  readonly toneMapping: WebGPURenderer["toneMapping"];
  readonly toneMappingExposure: number;
  readonly outputColorSpace: WebGPURenderer["outputColorSpace"];
  readonly sortObjects: boolean;
  readonly autoClear: boolean;
  readonly autoClearColor: boolean;
  readonly autoClearDepth: boolean;
  readonly autoClearStencil: boolean;
  readonly shadowMap: Readonly<Pick<WebGPURenderer["shadowMap"], "enabled" | "transmitted" | "type">>;
  readonly clearColor: Color;
  readonly clearAlpha: number;
  readonly infoAutoReset: boolean;
}

type SettingsRenderer = Pick<WebGPURenderer,
  "toneMapping" | "toneMappingExposure" | "outputColorSpace" | "sortObjects" | "autoClear" | "autoClearColor"
  | "autoClearDepth" | "autoClearStencil" | "shadowMap" | "info" | "getClearColor" | "getClearAlpha" | "setClearColor">;

export function readNativeRendererSettings(renderer: SettingsRenderer): NativeRendererSettings {
  return {
    toneMapping: renderer.toneMapping,
    toneMappingExposure: renderer.toneMappingExposure,
    outputColorSpace: renderer.outputColorSpace,
    sortObjects: renderer.sortObjects,
    autoClear: renderer.autoClear,
    autoClearColor: renderer.autoClearColor,
    autoClearDepth: renderer.autoClearDepth,
    autoClearStencil: renderer.autoClearStencil,
    shadowMap: { enabled: renderer.shadowMap.enabled, transmitted: renderer.shadowMap.transmitted, type: renderer.shadowMap.type },
    clearColor: renderer.getClearColor(new Color()),
    clearAlpha: renderer.getClearAlpha(),
    infoAutoReset: renderer.info.autoReset,
  };
}

export function applyNativeRendererSettings(renderer: SettingsRenderer, settings: NativeRendererSettings): void {
  renderer.toneMapping = settings.toneMapping;
  renderer.toneMappingExposure = settings.toneMappingExposure;
  renderer.outputColorSpace = settings.outputColorSpace;
  renderer.sortObjects = settings.sortObjects;
  renderer.autoClear = settings.autoClear;
  renderer.autoClearColor = settings.autoClearColor;
  renderer.autoClearDepth = settings.autoClearDepth;
  renderer.autoClearStencil = settings.autoClearStencil;
  Object.assign(renderer.shadowMap, settings.shadowMap);
  renderer.setClearColor(settings.clearColor, settings.clearAlpha);
  renderer.info.autoReset = settings.infoAutoReset;
}

/**
 * R3F's store, as NativeCanvas uses it. R3F 8 annotates `gl` as WebGLRenderer,
 * but its runtime holds whatever renderer the Canvas factory returned (see
 * NativeCanvas's createRenderer), and consumers read it back through
 * `getNativeRenderer`. The setter's argument is R3F's own, widened by exactly
 * the native renderer; a RootState is one of these stores without assertion.
 */
interface NativeRendererStore {
  set(partial: Parameters<RootState["set"]>[0] | { readonly gl: WebGPURenderer }): void;
}

/**
 * Hand R3F's store a replacement renderer, so every `useThree((s) => s.gl)`
 * consumer re-runs its renderer-keyed effects against it.
 */
export function replaceStoreRenderer(store: NativeRendererStore, renderer: WebGPURenderer): void {
  store.set({ gl: renderer });
}

function isEventListener(value: unknown): value is EventListener {
  return typeof value === "function";
}

export function isNativeWebGLBackend(backend: object): boolean {
  return "isWebGLBackend" in backend && backend.isWebGLBackend === true;
}

/**
 * Let go of a WebGL backend whose canvas a replacement renderer will draw on.
 * r186's WebGLBackend.dispose() calls WEBGL_lose_context.loseContext(), which
 * would take the context away from that replacement; this only removes the
 * backend's own loss listener so the canvas no longer holds it. Its GPU objects
 * belonged to the context that was lost.
 */
export function detachNativeWebGLBackend(renderer: Pick<WebGPURenderer, "backend" | "domElement">): void {
  const backend: object = renderer.backend;
  if (!("_onContextLost" in backend) || !isEventListener(backend._onContextLost)) return;
  renderer.domElement.removeEventListener("webglcontextlost", backend._onContextLost);
}

export function isNativeRenderer(renderer: object): renderer is WebGPURenderer {
  return "isWebGPURenderer" in renderer && renderer.isWebGPURenderer === true;
}

export function getNativeRenderer(renderer: object): WebGPURenderer | null {
  return isNativeRenderer(renderer) ? renderer : null;
}

function isGpuRendererContext(value: unknown): value is GpuRendererContext {
  return typeof value === "object" && value !== null
    && "getExtension" in value && typeof value.getExtension === "function"
    && "getParameter" in value && typeof value.getParameter === "function";
}

/**
 * The GPU's renderer string, read from the native WebGL2 backend's own context
 * (no probe context is created). Null on the WebGPU backend, or where the
 * browser withholds it.
 */
export function nativeRendererGpuString(renderer: { readonly backend: object }): string | null {
  const backend: object = renderer.backend;
  if (!("isWebGLBackend" in backend) || backend.isWebGLBackend !== true || !("gl" in backend)) return null;
  return isGpuRendererContext(backend.gl) ? getGpuRenderer(backend.gl) : null;
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
