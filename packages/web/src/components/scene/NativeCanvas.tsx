import {
  Component, useCallback, useEffect, useRef, useState,
  type ReactElement, type ReactNode,
} from "react";
import { Canvas, useFrame, type CanvasProps, type RootState } from "@react-three/fiber";
import { WebGPURenderer } from "three/webgpu";
import { Scene, Texture } from "three";
import { ActivityStatus } from "../shared/Activity.js";
import { installNativeMaterialClipping } from "../../lib/native-material-clipping.js";
import {
  applyNativeRendererSettings, detachNativeWebGLBackend, isNativeWebGLBackend, readNativeRendererSettings,
  registerNativeSceneRenderer, replaceStoreRenderer, withNativeRenderScope, type NativeRendererSettings,
} from "../../lib/native-renderer.js";
import { createNativeFramePacer, type NativeFramePacer } from "../../lib/native-frame-pacer.js";
import { noteMainDraw } from "../../lib/main-draw-clock.js";
import { nativeFrameComposer } from "../../lib/native-frame-composer.js";
import { createNativeGpuWorkTicket } from "../../lib/native-gpu-completion.js";
import { nativeSceneDrawnSplats, nativeScenePerfStats } from "../../lib/native-splat-scene.js";
import {
  beginGpuProfile, endGpuProfile, recordRenderedFrame, registerProfilerRenderer,
  sampleDrawnSplats, shouldProfileFrames, type GpuProfileToken,
} from "../../lib/perf-runtime.js";
import {
  createNativeRendererLifecycle, nativeRendererError, type NativeRendererLifecycle,
} from "../../lib/native-renderer-lifecycle.js";
import {
  createNativeRendererRecovery, type NativeLossApi, type NativeRecoveryPhase,
  type NativeRendererRecovery, type NativeRestoreMode,
} from "../../lib/native-renderer-recovery.js";
import { readGraphicsResetDrill, startGraphicsResetDrill } from "../../lib/graphics-reset-drill.js";
export { isNativeRenderer } from "../../lib/native-renderer.js";

export interface NativeCanvasOptions {
  readonly antialias?: boolean;
  readonly alpha?: boolean;
  readonly powerPreference?: "default" | "high-performance" | "low-power";
}

/** Whose work the view holds, which decides what a stopped or restoring view may promise. */
export type NativeCanvasSurface = "planner" | "walk";

export interface NativeCanvasProps extends Omit<CanvasProps, "gl"> {
  readonly gl?: NativeCanvasOptions;
  /** Development qualification of Three's native WebGL2 backend. */
  readonly forceWebGL?: boolean;
  readonly surface?: NativeCanvasSurface;
}

const SURFACE_COPY: Record<NativeCanvasSurface, {
  readonly restoring: string;
  readonly stopped: string;
  readonly cannotStart: string;
  readonly fallback: { readonly href: string; readonly label: string } | null;
}> = {
  planner: {
    restoring: "The browser reset this page’s graphics. Your layout is safe.",
    stopped: "The 3D view stopped. Your layout is safe; nothing you placed was lost. Try again, or continue in the 2D planner.",
    cannotStart: "The 3D view couldn’t start. Try again, or continue in the 2D planner.",
    fallback: { href: "/blueprint", label: "Open the 2D planner" },
  },
  walk: {
    restoring: "The browser reset this page’s graphics.",
    stopped: "The 3D view stopped. Try again in a moment.",
    cannotStart: "The 3D view couldn’t start. Try again in a moment.",
    fallback: null,
  },
};

/**
 * How long a swap waits for the lost renderer to finish releasing. Three's
 * disposal can await GPU readbacks a lost device never settles; that must not
 * keep a person from their room.
 */
const RETIRE_WAIT_MS = 1_500;

// TypeScript 5.7's DOM library predates the browser WebGPU types. Describe only
// the standard negotiation calls used here; Three's own device input is opaque.
interface NativeGraphicsDevice {
  destroy(): void;
  readonly lost: PromiseLike<{ readonly reason?: unknown }>;
}
interface NativeGraphicsAdapter {
  readonly features: ReadonlySet<string>;
  readonly limits: { readonly maxStorageBufferBindingSize: number; readonly maxBufferSize: number };
  requestDevice(options: {
    requiredFeatures: string[];
    requiredLimits: { maxStorageBufferBindingSize: number; maxBufferSize: number };
  }): Promise<NativeGraphicsDevice>;
}
interface NativeGraphicsApi {
  requestAdapter(options: { powerPreference?: "low-power" | "high-performance" }): Promise<NativeGraphicsAdapter | null>;
}
function isNativeGraphicsApi(value: unknown): value is NativeGraphicsApi {
  return typeof value === "object" && value !== null && "requestAdapter" in value
    && typeof value.requestAdapter === "function";
}

function isNativeGraphicsDevice(value: unknown): value is NativeGraphicsDevice {
  return typeof value === "object" && value !== null
    && "destroy" in value && typeof value.destroy === "function"
    && "lost" in value && typeof value.lost === "object" && value.lost !== null
    && "then" in value.lost && typeof value.lost.then === "function";
}

/** The WebGPU device the backend draws with, whoever requested it; null on WebGL. */
function nativeBackendDevice(backend: object): NativeGraphicsDevice | null {
  return "device" in backend && isNativeGraphicsDevice(backend.device) ? backend.device : null;
}

function hasNativeBackendDisposal(backend: object): backend is { dispose(): Promise<void> | void } {
  return "dispose" in backend && typeof backend.dispose === "function";
}

function isProfilerScene(value: unknown): value is Scene { return value instanceof Scene; }

/**
 * PMREM keeps its result per source texture rather than per renderer, so the
 * filtered environment a lost device held would never be rebuilt for the new
 * one. Effects that bake their own environment rebuild it from the renderer.
 */
function markEnvironmentForRebuild(scene: Scene): void {
  for (const texture of [scene.environment, scene.background]) {
    if (texture instanceof Texture) texture.needsPMREMUpdate = true;
  }
}

function settleWithin(work: Promise<void>, ms: number): Promise<void> {
  return new Promise<void>((resolve) => {
    const timer = setTimeout(resolve, ms);
    void work.finally(() => { clearTimeout(timer); resolve(); });
  });
}

interface FailureBoundaryProps {
  readonly children: ReactNode;
  readonly onError: (error: Error) => void;
}

class NativeCanvasFailureBoundary extends Component<FailureBoundaryProps, { failed: boolean }> {
  override state = { failed: false };
  static getDerivedStateFromError(): { failed: boolean } { return { failed: true }; }
  override componentDidCatch(error: Error): void { this.props.onError(error); }
  override render(): ReactNode { return this.state.failed ? null : this.props.children; }
}

function NativeAutomaticFrames({ renderFrame }: { readonly renderFrame: (state: RootState) => void }): null {
  // Positive priority takes ownership of R3F's automatic draw after ordinary
  // scene/camera callbacks. Explicit renderer calls and exports stay immediate.
  useFrame(renderFrame, 1);
  return null;
}

/** The renderer a device or context was taken from, until a replacement draws. */
interface LostRenderer {
  readonly native: WebGPURenderer;
  readonly settings: NativeRendererSettings;
  readonly pixelRatio: number;
  readonly backend: "webgpu" | "webgl2";
}

interface LaunchOptions {
  /** A new canvas: tell the caller, which may reset what it built on the old one. A swap is not. */
  readonly created: boolean;
  /** Runs first once the backend is ready, before the renderer is registered and paced. */
  readonly prepare?: () => void;
  readonly onActive?: () => void;
  readonly onFailed: (error: Error) => void;
}

/**
 * R3F 8's runtime accepts a renderer with render/setSize/setPixelRatio, but its
 * store's GL type predates WebGPURenderer and its factory is synchronous. Keep
 * React 18 and the established Canvas event/context/resize behavior, withhold
 * scene children and frames until the native backend has actually initialized.
 *
 * When the browser takes the graphics device away after the view has drawn (a
 * driver reset, the OS reclaiming memory, a backgrounded phone), the view comes
 * back without losing anything: a fresh renderer is put on the same canvas and
 * handed to R3F's store, so the scene graph, camera, walk, selection and every
 * decoded splat stay exactly as they were and only GPU resources are rebuilt
 * (lib/native-renderer-recovery.ts owns when and how often).
 */
export function NativeCanvas({
  children, gl: options = {}, forceWebGL = false, frameloop = "always", onCreated, surface = "planner", style, ...props
}: NativeCanvasProps): ReactElement {
  const [attempt, setAttempt] = useState(0);
  const [status, setStatus] = useState<"initializing" | "ready" | "error">("initializing");
  const [error, setError] = useState<Error | null>(null);
  // A view that was running and then lost its device for good is a different
  // moment from one that never started: the person has work on screen and
  // needs to hear that it is safe.
  const running = useRef(false);
  const [stoppedWhileRunning, setStoppedWhileRunning] = useState(false);
  const [recoveryPhase, setRecoveryPhase] = useState<NativeRecoveryPhase>({ kind: "running" });
  const mounted = useRef(true);
  const renderer = useRef<WebGPURenderer | null>(null);
  const failedRenderer = useRef<WebGPURenderer | null>(null);
  const initialize = useRef<(() => Promise<void>) | null>(null);
  const dispose = useRef<((initialized: boolean) => Promise<void>) | null>(null);
  const lifecycle = useRef<NativeRendererLifecycle | null>(null);
  const framePacer = useRef<{ native: WebGPURenderer; pacer: NativeFramePacer } | null>(null);
  const root = useRef<RootState | null>(null);
  const recovery = useRef<NativeRendererRecovery | null>(null);
  /** Each renderer's settings from before any scene effect layered its own. */
  const baseSettings = useRef(new WeakMap<WebGPURenderer, NativeRendererSettings>());
  /** WebGL renderers whose canvas another renderer draws on: never through r186's dispose(). */
  const sharedCanvas = useRef(new WeakSet<WebGPURenderer>());
  const lost = useRef<LostRenderer | null>(null);
  const remounting = useRef<{ resolve(): void; reject(error: Error): void } | null>(null);
  const restorations = useRef(0);
  /** This view, for the once-per-view ?graphicsReset drill. */
  const drillOwner = useRef({});
  const callbacks = useRef({ onCreated, options, forceWebGL });
  callbacks.current = { onCreated, options, forceWebGL };

  const fail = useCallback((cause: Error): void => {
    framePacer.current?.pacer.dispose();
    framePacer.current = null;
    // Stop further frames synchronously, before React removes the failed Canvas.
    if (renderer.current !== null && failedRenderer.current === renderer.current) return;
    failedRenderer.current = renderer.current;
    if (!mounted.current) return;
    const pendingRemount = remounting.current;
    if (pendingRemount !== null) {
      // A recovery's new canvas that could not start: the recovery decides what follows.
      remounting.current = null;
      pendingRemount.reject(cause);
      return;
    }
    setStoppedWhileRunning(running.current);
    running.current = false;
    setError(cause);
    setStatus("error");
    lifecycle.current?.cancel();
  }, []);

  /** Recovery is exhausted: the view stopped while it held someone's work. */
  const giveUp = useCallback((cause: Error): void => {
    framePacer.current?.pacer.dispose();
    framePacer.current = null;
    lost.current = null;
    remounting.current = null;
    if (renderer.current !== null) failedRenderer.current = renderer.current;
    running.current = false;
    if (!mounted.current) return;
    setStoppedWhileRunning(true);
    setError(cause);
    setStatus("error");
    lifecycle.current?.cancel();
  }, []);

  const lose = useCallback((native: WebGPURenderer, api: NativeLossApi, message: string): void => {
    if (!mounted.current || renderer.current !== native || failedRenderer.current === native) return;
    const settings = baseSettings.current.get(native);
    if (!running.current || settings === undefined || root.current === null) {
      // Lost before it ever drew: a start that failed, not a view to restore.
      fail(nativeRendererError(message));
      return;
    }
    // Nothing more is drawn or fenced on the lost device; the scene stays.
    framePacer.current?.pacer.dispose();
    framePacer.current = null;
    failedRenderer.current = native;
    running.current = false;
    lost.current = {
      native, settings, pixelRatio: native.getPixelRatio(),
      backend: isNativeWebGLBackend(native.backend) ? "webgl2" : "webgpu",
    };
    recovery.current?.lost(api);
  }, [fail]);

  const buildRenderer = useCallback((
    canvas: HTMLCanvasElement | OffscreenCanvas, reuse: LostRenderer["backend"] | null,
  ): WebGPURenderer => {
    const configuration = callbacks.current;
    const parameters: ConstructorParameters<typeof WebGPURenderer>[0] = {
      canvas,
      antialias: false,
      alpha: true,
      ...configuration.options,
      powerPreference: configuration.options.powerPreference === "low-power" ? "low-power" : "high-performance",
      // A canvas keeps its context type for life: a reused WebGL canvas can never draw WebGPU.
      forceWebGL: reuse === "webgl2" || (import.meta.env.DEV && (
        configuration.forceWebGL || new URLSearchParams(window.location.search).get("nativeWebGL") === "1"
      )),
    };
    const native = new WebGPURenderer(parameters);
    const draw = native.render.bind(native);
    let renderDepth = 0;
    const isCurrentRenderer = (): boolean => mounted.current && renderer.current === native && failedRenderer.current !== native;
    native.render = (...args: Parameters<WebGPURenderer["render"]>): ReturnType<WebGPURenderer["render"]> => {
      const offscreen = native.getRenderTarget() !== null;
      if (!mounted.current || renderer.current !== native || failedRenderer.current === native) {
        if (offscreen) throw new Error("The native renderer is no longer available for capture");
        return;
      }
      let startedAt: number | null = null;
      let gpuProfile: GpuProfileToken | null = null;
      if (!offscreen && renderDepth === 0) {
        try {
          if (shouldProfileFrames(native)) {
            gpuProfile = beginGpuProfile(native, performance.now());
            startedAt = performance.now();
          }
        } catch { /* Diagnostics must never prevent the scene draw. */ }
      }
      let successful = false;
      renderDepth += 1;
      try {
        withNativeRenderScope(native, args[0], args[1], () => { draw(...args); });
        successful = isCurrentRenderer();
      } catch (cause) {
        // Capture owns its failure result; swallowing this would export a blank
        // image as success. Main-frame errors instead use the recoverable UI.
        if (offscreen) throw cause;
        fail(nativeRendererError(cause));
      } finally {
        renderDepth -= 1;
        if (startedAt !== null) {
          try {
            if (successful) {
              const finishedAt = performance.now();
              const scene = isProfilerScene(args[0]) ? args[0] : null;
              const stats = scene === null ? null : nativeScenePerfStats(scene, finishedAt);
              recordRenderedFrame({
                timestampMs: startedAt, cpuSubmitMs: finishedAt - startedAt,
                drawCalls: native.info.render.drawCalls, triangles: native.info.render.triangles,
                rendererBytes: native.info.memory.total, ...stats,
              }, native);
              if (scene !== null && stats !== null) sampleDrawnSplats(native, startedAt, () => nativeSceneDrawnSplats(scene, native));
            }
          } catch { /* Missing diagnostics cannot turn a successful draw into an error. */ }
        }
        if (gpuProfile !== null) {
          try { endGpuProfile(gpuProfile, successful); } catch { /* Preserve renderer failure ownership. */ }
        }
      }
    };
    let releaseDevice: (() => void) | null = null;
    let releasing = false;
    // r186's backend copies constructor options and reads its own parameters
    // during init. Supply the negotiated device to that copy before init, so
    // supported storage limits reach the device that actually draws the scene.
    initialize.current = async () => {
      const gpu = typeof navigator !== "undefined" && "gpu" in navigator ? navigator.gpu : null;
      if (parameters.forceWebGL !== true && isNativeGraphicsApi(gpu)) {
        try {
          const adapter = await gpu.requestAdapter({ powerPreference: parameters.powerPreference });
          if (adapter !== null) {
            const device = await adapter.requestDevice({
              requiredFeatures: [...adapter.features],
              requiredLimits: {
                maxStorageBufferBindingSize: Math.min(adapter.limits.maxStorageBufferBindingSize, 268_435_456),
                maxBufferSize: Math.min(adapter.limits.maxBufferSize, 536_870_912),
              },
            });
            releaseDevice = () => { device.destroy(); };
            if (!("parameters" in native.backend) || typeof native.backend.parameters !== "object"
              || native.backend.parameters === null) {
              throw new Error("The native renderer has no backend device configuration");
            }
            Object.assign(native.backend.parameters, { device });
          }
        } catch {
          // Let Three perform its own backend negotiation and WebGL2 fallback.
        }
      }
      await native.init();
      // Three reports every loss of its device except one whose reason is
      // "destroyed", which is how it reads its own disposal. Anything else that
      // destroys the device (whoever requested it) has still taken the view's
      // graphics away.
      const device = nativeBackendDevice(native.backend);
      if (device !== null) {
        void device.lost.then((info) => {
          if (!releasing && info.reason === "destroyed") lose(native, "WebGPU", "The graphics device was destroyed");
        });
      }
    };
    dispose.current = async (initialized) => {
      releasing = true;
      if (framePacer.current?.native === native) {
        framePacer.current.pacer.dispose();
        framePacer.current = null;
      }
      try {
        if (sharedCanvas.current.has(native)) detachNativeWebGLBackend(native);
        else if (initialized) await native.dispose();
        // Renderer.dispose() after failed init attempts init again through
        // setAnimationLoop. Release partial backend resources directly instead.
        else if (hasNativeBackendDisposal(native.backend)) {
          await native.backend.dispose();
        }
      } finally {
        releaseDevice?.();
      }
    };
    installNativeMaterialClipping(native);
    native.onDeviceLost = (info) => {
      lose(native, info.api === "WebGL" ? "WebGL" : "WebGPU", info.message);
    };
    native.onError = (event: unknown): void => {
      if (renderer.current !== native) return;
      const message = typeof event === "object" && event !== null && "message" in event
        ? event.message : event;
      fail(nativeRendererError(message));
    };
    if (reuse === "webgl2") sharedCanvas.current.add(native);
    renderer.current = native;
    // R3F8's factory accepts its structural Renderer contract (render), so the
    // native object needs no cast. Its legacy RootState.gl annotation remains
    // narrower; backend-specific consumers must use isNativeRenderer.
    return native;
  }, [fail, lose]);

  const createRenderer = useCallback(
    (canvas: HTMLCanvasElement | OffscreenCanvas): WebGPURenderer => buildRenderer(canvas, null),
    [buildRenderer],
  );

  const launch = useCallback((native: WebGPURenderer, state: RootState, {
    created, prepare, onActive, onFailed,
  }: LaunchOptions): NativeRendererLifecycle => {
    const initializeNative = initialize.current;
    const disposeNative = dispose.current;
    let unregisterScene: (() => void) | null = null;
    let unregisterProfiler: (() => void) | null = null;
    let stopRestoreWatch: (() => void) | null = null;
    let stopDrill: (() => void) | null = null;
    return createNativeRendererLifecycle({
      initialize: async () => { if (initializeNative !== null) await initializeNative(); },
      dispose: async (initialized) => {
        stopDrill?.();
        stopRestoreWatch?.();
        unregisterScene?.();
        try { unregisterProfiler?.(); } catch { /* Profiling must not prevent GPU resource disposal. */ }
        await disposeNative?.(initialized);
      },
      onReady: () => {
        if (!mounted.current || renderer.current !== native) return;
        try {
          prepare?.();
          const backend = native.backend;
          const backendName = "isWebGPUBackend" in backend ? "webgpu" : "webgl2";
          const canvas = native.domElement;
          if (canvas instanceof HTMLCanvasElement) {
            canvas.dataset["renderer"] = "three-native";
            canvas.dataset["backend"] = backendName;
          }
          if (created) callbacks.current.onCreated?.(state);
          if (!baseSettings.current.has(native)) baseSettings.current.set(native, readNativeRendererSettings(native));
          unregisterScene = registerNativeSceneRenderer(state.scene, native);
          try {
            unregisterProfiler = registerProfilerRenderer(native, native.domElement, backendName);
          } catch { /* The optional profiler does not own renderer readiness. */ }
          if (backendName === "webgl2") {
            // A lost WebGL canvas can be drawn on again only once the browser restores its context.
            const restored = (): void => { if (lost.current?.native === native) recovery.current?.contextRestored(); };
            canvas.addEventListener("webglcontextrestored", restored);
            stopRestoreWatch = () => { canvas.removeEventListener("webglcontextrestored", restored); };
          }
          const drill = typeof window === "undefined" ? null : readGraphicsResetDrill(window.location.search);
          if (drill !== null) {
            stopDrill = startGraphicsResetDrill(drillOwner.current, drill, {
              device: nativeBackendDevice(backend),
              canvas: canvas instanceof HTMLCanvasElement ? canvas : null,
            });
          }
          framePacer.current?.pacer.dispose();
          const current = (): boolean => mounted.current && renderer.current === native
            && failedRenderer.current !== native;
          framePacer.current = {
            native,
            pacer: createNativeFramePacer({
              createTicket: (signal) => createNativeGpuWorkTicket(native, signal),
              invalidate: () => { if (current()) state.get().invalidate(); },
              onError: (cause) => { if (current()) fail(cause); },
            }),
          };
          running.current = true;
          setStatus("ready");
          onActive?.();
        } catch (cause) {
          onFailed(nativeRendererError(cause));
        }
      },
      onError: onFailed,
    });
  }, [fail]);

  const startRenderer = useCallback((state: RootState): void => {
    const native = renderer.current;
    if (native === null || lifecycle.current !== null) return;
    root.current = state;
    lifecycle.current = launch(native, state, {
      created: true,
      onActive: () => {
        const pendingRemount = remounting.current;
        remounting.current = null;
        pendingRemount?.resolve();
      },
      onFailed: fail,
    });
  }, [fail, launch]);

  /** A fresh renderer on the same canvas; the scene, camera and React tree stay. */
  const swap = useCallback(async (): Promise<void> => {
    const retired = lost.current;
    const state = root.current;
    if (retired === null || state === null) throw new Error("There is no lost view to restore");
    if (retired.backend === "webgl2") sharedCanvas.current.add(retired.native);
    // The canvas's previous renderer (the lost one, or a replacement that could
    // not start) releases its device and registrations before another draws there.
    const previous = lifecycle.current;
    lifecycle.current = null;
    if (previous !== null) await settleWithin(previous.retire(), RETIRE_WAIT_MS);
    if (!mounted.current || lost.current !== retired) throw new Error("The view closed while it was restoring");
    const next = buildRenderer(retired.native.domElement, retired.backend);
    baseSettings.current.set(next, retired.settings);
    await new Promise<void>((resolve, reject) => {
      lifecycle.current = launch(next, state, {
        created: false,
        prepare: () => {
          applyNativeRendererSettings(next, retired.settings);
          next.setPixelRatio(retired.pixelRatio);
          const { size, scene } = state.get();
          next.setSize(size.width, size.height, false);
          markEnvironmentForRebuild(scene);
          // Every renderer-keyed effect in the scene runs again against the new device.
          replaceStoreRenderer(state, next);
        },
        onActive: () => {
          sharedCanvas.current.delete(next);
          lost.current = null;
          restorations.current += 1;
          if (next.domElement instanceof HTMLCanvasElement) next.domElement.dataset["restorations"] = String(restorations.current);
          state.get().invalidate();
          resolve();
        },
        onFailed: (cause) => {
          // A replacement that could not start is not a stopped view: the recovery decides what follows.
          failedRenderer.current = next;
          reject(cause);
        },
      });
    });
  }, [buildRenderer, launch]);

  /** A new canvas: the last way back, from a context the browser never returns. */
  const remount = useCallback((): Promise<void> => new Promise<void>((resolve, reject) => {
    remounting.current = { resolve, reject };
    lost.current = null;
    framePacer.current?.pacer.dispose();
    framePacer.current = null;
    lifecycle.current?.cancel();
    lifecycle.current = null;
    renderer.current = null;
    initialize.current = null;
    dispose.current = null;
    root.current = null;
    running.current = false;
    setStatus("initializing");
    setAttempt((current) => current + 1);
  }), []);

  const restore = useRef<(mode: NativeRestoreMode) => Promise<void>>(swap);
  restore.current = (mode) => (mode === "swap" ? swap() : remount());

  useEffect(() => {
    const controller = createNativeRendererRecovery({
      restore: (mode) => restore.current(mode),
      onPhase: (phase) => {
        if (!mounted.current) return;
        setRecoveryPhase(phase);
        if (phase.kind === "failed") giveUp(phase.error);
      },
    });
    recovery.current = controller;
    return () => {
      controller.dispose();
      if (recovery.current === controller) recovery.current = null;
    };
  }, [giveUp]);

  const renderAutomaticFrame = useCallback((state: RootState): void => {
    const owner = framePacer.current;
    if (owner === null || !mounted.current || renderer.current !== owner.native
      || failedRenderer.current === owner.native) return;
    const native = owner.native;
    // The automatic main view is paced. A caller intentionally rendering into
    // another target retains Three's normal immediate render behavior.
    if (native.getRenderTarget() !== null) {
      native.render(state.scene, state.camera);
      return;
    }
    owner.pacer.request(() => {
      const startedAt = performance.now();
      // A registered pipeline draws the whole frame (its own scene passes and
      // the final output) through the same render wrapper.
      const composer = nativeFrameComposer(native);
      if (composer !== null) composer();
      else native.render(state.scene, state.camera);
      // The render wrapper reports main-frame errors through fail() and returns.
      // Never fence that failed draw or a renderer replaced during a callback.
      const drawn = mounted.current && renderer.current === native && failedRenderer.current !== native;
      // The frames a viewer sees, for the frame-rate governor (main-draw-clock.ts).
      if (drawn) noteMainDraw(startedAt);
      return drawn;
    });
  }, []);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      // React StrictMode rehearses effect cleanup/setup on the same renderer.
      // A real unmount stays detached; pending init still belongs to its owner.
      queueMicrotask(() => { if (!mounted.current) lifecycle.current?.cancel(); });
    };
  }, []);

  const retry = (): void => {
    recovery.current?.reset();
    lost.current = null;
    remounting.current = null;
    framePacer.current?.pacer.dispose();
    framePacer.current = null;
    lifecycle.current?.cancel();
    lifecycle.current = null;
    renderer.current = null;
    initialize.current = null;
    dispose.current = null;
    setError(null);
    setStoppedWhileRunning(false);
    setStatus("initializing");
    setAttempt((current) => current + 1);
  };

  const recovering = recoveryPhase.kind !== "running" && recoveryPhase.kind !== "failed";
  const copy = SURFACE_COPY[surface];
  return (
    <div data-graphics-recovery={recoveryPhase.kind} style={{ position: "relative", width: "100%", height: "100%", ...style }}>
      {status !== "error" && (
        <NativeCanvasFailureBoundary key={attempt} onError={fail}>
          <Canvas
            {...props}
            gl={createRenderer}
            onCreated={startRenderer}
            frameloop={status === "ready" && !recovering ? frameloop : "never"}
            style={{ width: "100%", height: "100%" }}
          >
            {status === "ready" ? <>{children}<NativeAutomaticFrames renderFrame={renderAutomaticFrame} /></> : null}
          </Canvas>
        </NativeCanvasFailureBoundary>
      )}
      {status === "initializing" && !recovering && (
        <div style={{ position: "absolute", inset: 0, display: "grid", placeItems: "center", pointerEvents: "none" }}>
          <ActivityStatus variant="panel">Opening the 3D view…</ActivityStatus>
        </div>
      )}
      {recovering && status !== "error" && (
        <div style={{
          // The lost canvas shows nothing true; cover it, and take the gestures meant for it.
          position: "absolute", inset: 0, zIndex: 20,
          display: "grid", placeItems: "safe center", padding: 24,
          boxSizing: "border-box", textAlign: "center",
          background: "#f5f1e8", color: "#183b32",
        }}>
          <div style={{ width: "100%", maxWidth: 440, lineHeight: 1.5 }}>
            <ActivityStatus variant="panel">Restoring the 3D view…</ActivityStatus>
            <p style={{ margin: "14px 0 0" }}>{copy.restoring}</p>
          </div>
        </div>
      )}
      {status === "error" && (
        <section role="alert" style={{
          // Keep recovery above scene HUDs, within the failed canvas's bounds.
          position: "absolute", inset: 0, zIndex: 20,
          display: "grid", placeItems: "safe center", padding: 24,
          overflow: "auto", boxSizing: "border-box",
          background: "#f5f1e8", color: "#183b32",
        }}>
          <div style={{ width: "100%", maxWidth: 440, lineHeight: 1.5 }}>
            <p>{stoppedWhileRunning ? copy.stopped : copy.cannotStart}</p>
            <button type="button" onClick={retry}>Try 3D again</button>
            {copy.fallback !== null && <>{" "}<a href={copy.fallback.href}>{copy.fallback.label}</a></>}
            {import.meta.env.DEV && error !== null && <pre style={{ whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}>{error.message}</pre>}
          </div>
        </section>
      )}
    </div>
  );
}
