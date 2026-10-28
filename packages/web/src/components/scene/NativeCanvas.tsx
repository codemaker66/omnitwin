import {
  Component, useCallback, useEffect, useLayoutEffect, useRef, useState,
  type ReactElement, type ReactNode,
} from "react";
import { Canvas, useFrame, type CanvasProps, type RootState } from "@react-three/fiber";
import { WebGPURenderer } from "three/webgpu";
import { Color, Scene } from "three";
import { ActivityStatus } from "../shared/Activity.js";
import { usePlannerWork } from "./planner-work.js";
import { reportFailure } from "../../observability/failure-reports.js";
import { installNativeMaterialClipping } from "../../lib/native-material-clipping.js";
import {
  applyNativeRendererSettings, detachNativeWebGLBackend, isNativeWebGLBackend, readNativeRendererSettings,
  registerNativeSceneRenderer, releaseLostWebGLRenderer, replaceStoreRenderer, withNativeComposedFrame, withNativeRenderScope,
  type NativeRendererSettings,
} from "../../lib/native-renderer.js";
import { createNativeFramePacer, type NativeFramePacer } from "../../lib/native-frame-pacer.js";
import { noteMainDraw } from "../../lib/main-draw-clock.js";
import { nativeFrameComposer } from "../../lib/native-frame-composer.js";
import { createNativeGpuWorkTicket } from "../../lib/native-gpu-completion.js";
import { nativeSceneCapturePending, nativeSceneDrawnSplats, nativeScenePerfStats } from "../../lib/native-splat-scene.js";
import {
  beginGpuProfile, endGpuProfile, recordRenderedFrame, registerProfilerRenderer,
  sampleDrawnSplats, shouldProfileFrames, type GpuProfileToken,
} from "../../lib/perf-runtime.js";
import {
  createNativeRendererLifecycle, nativeRendererError, type NativeRendererLifecycle,
} from "../../lib/native-renderer-lifecycle.js";
import {
  NATIVE_RECOVERY_LOSS_WINDOW_MS, createNativeRendererRecovery, type NativeLossApi, type NativeRecoveryPhase,
  type NativeRendererRecovery, type NativeRestoreMode,
} from "../../lib/native-renderer-recovery.js";
import { readGraphicsResetDrill, startGraphicsResetDrill } from "../../lib/graphics-reset-drill.js";
import { createNativeGpuErrorWatch, type NativeGpuErrorWatch } from "../../lib/native-gpu-error-watch.js";
import { clearNativePrecompiles, nativePrecompilePending, runNativePrecompiles, subscribeNativePrecompile } from "../../lib/native-precompile.js";
export { isNativeRenderer } from "../../lib/native-renderer.js";

export interface NativeCanvasOptions {
  readonly antialias?: boolean;
  readonly alpha?: boolean;
  readonly powerPreference?: "default" | "high-performance" | "low-power";
}

/**
 * Whose work the view holds, which decides what a stopped or restoring view
 * may promise: a planner shows someone's layout; a walk (a landing, a room)
 * holds none.
 */
export type NativeCanvasSurface = "planner" | "walk";

export interface NativeCanvasProps extends Omit<CanvasProps, "gl"> {
  readonly gl?: NativeCanvasOptions;
  /** Development qualification of Three's native WebGL2 backend. */
  readonly forceWebGL?: boolean;
  /** Defaults to "planner" inside the editor's PlannerWorkContext, otherwise "walk". */
  readonly surface?: NativeCanvasSurface;
  /**
   * The view landed on its couldn't-start or stopped card. Anything the page
   * shows over the view as still opening (the planner's arrival) must step
   * aside, or the card and its way on stay hidden under a false "Opening…".
   */
  readonly onUnavailable?: () => void;
}

/** What a failure says, whatever was thrown (a boundary catches anything thrown while the scene renders). */
function failureDetail(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause);
}

/** The graphics backend a renderer draws with, as a failure report names it. */
function rendererBackend(native: WebGPURenderer | null): string {
  if (native === null) return "none";
  return isNativeWebGLBackend(native.backend) ? "webgl2" : "webgpu";
}

const SURFACE_COPY: Record<NativeCanvasSurface, {
  readonly restoring: string | null;
  readonly stopped: string;
  readonly cannotStart: string;
  /** Whether the planner's own 2D view may stand in, where the editor offers one. */
  readonly offers2d: boolean;
}> = {
  planner: {
    restoring: "Your layout is safe; nothing you placed was lost.",
    stopped: "The 3D view stopped. Your layout is safe; nothing you placed was lost.",
    cannotStart: "The 3D view couldn’t start.",
    offers2d: true,
  },
  walk: {
    restoring: null,
    stopped: "The 3D view stopped.",
    cannotStart: "The 3D view couldn’t start.",
    offers2d: false,
  },
};

/** The ground the scene is drawn on, for a cover that stands in for it. */
interface StageTone {
  readonly ground: string;
  readonly tone: "dark" | "light";
}

const DEFAULT_STAGE = { ground: "var(--vv-ivory)", ink: "var(--vv-forest)", tone: "light" } as const;
/** The planner's dark stage, its drawn hall's own background (PlannerScene). */
const DARK_STAGE: StageTone = { ground: "#120e0b", tone: "dark" };

/** Whether a captured room's splats are drawn in this scene now. */
function sceneShowsCapture(scene: Scene): boolean {
  return (nativeScenePerfStats(scene, performance.now())?.splats ?? 0) > 0;
}

function stageToneOf(scene: Scene): StageTone | null {
  // A captured room fills the view (at eye level, all of it) over the light
  // shell's clear colour: what a person sees is the warm, dark room, and a
  // light cover would flash over it.
  if (sceneShowsCapture(scene)) return DARK_STAGE;
  const background = scene.background;
  if (!(background instanceof Color)) return null;
  // Working-space (linear) luminance; the planner's grounds are the dark hall
  // (#120e0b) and the light room shell (#eee9de), far either side of this.
  const luminance = 0.2126 * background.r + 0.7152 * background.g + 0.0722 * background.b;
  return { ground: `#${background.getHexString()}`, tone: luminance < 0.18 ? "dark" : "light" };
}

function stageStyle(stage: StageTone | null): { backgroundColor: string; color: string } {
  if (stage === null) return { backgroundColor: DEFAULT_STAGE.ground, color: DEFAULT_STAGE.ink };
  return { backgroundColor: stage.ground, color: stage.tone === "dark" ? "var(--house-text-1)" : "var(--vv-forest)" };
}

/** Three r186 passes `{ api, type, message }` for an uncaptured WebGPU error. */
function describeGpuError(event: unknown): string {
  if (typeof event !== "object" || event === null) return String(event);
  const message = "message" in event && typeof event.message === "string" ? event.message : "Unknown GPU error";
  return "type" in event && typeof event.type === "string" ? `${event.type}: ${message}` : message;
}

/**
 * How long a swap waits for the lost renderer to finish releasing. Three's
 * disposal can await GPU readbacks a lost device never settles; that must not
 * keep a person from their room.
 */
const RETIRE_WAIT_MS = 1_500;

/**
 * After a swap, a captured room is back only once the new device draws its
 * own splat snapshot, seconds after the first frame (rebuilt from the sources
 * the scene still holds). The cover waits for it, but never longer than this:
 * a capture that cannot come back must not keep the room covered.
 */
export const NATIVE_CAPTURE_RETURN_WAIT_MS = 15_000;

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
  /** The GPU error it was given up for (its device still alive), or null for a real loss. */
  readonly errorMessage: string | null;
  /** A captured room was drawn when it went: the restored view must draw it again. */
  readonly captureShown: boolean;
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
  children, gl: options = {}, forceWebGL = false, frameloop = "always", onCreated, surface: surfaceProp, onUnavailable,
  style, ...props
}: NativeCanvasProps): ReactElement {
  const plannerWork = usePlannerWork();
  const surface = surfaceProp ?? (plannerWork === null ? "walk" : "planner");
  // Failures reach Sentry tagged with the view they stopped (observability/failure-reports.ts).
  const surfaceRef = useRef(surface);
  surfaceRef.current = surface;
  const [attempt, setAttempt] = useState(0);
  const [status, setStatus] = useState<"initializing" | "ready" | "error">("initializing");
  const [error, setError] = useState<Error | null>(null);
  // A view that was running and then lost its device for good is a different
  // moment from one that never started: the person has work on screen and
  // needs to hear that it is safe.
  const running = useRef(false);
  const [stoppedWhileRunning, setStoppedWhileRunning] = useState(false);
  const [recoveryPhase, setRecoveryPhase] = useState<NativeRecoveryPhase>({ kind: "running" });
  // A recovered view is not back until its new device has drawn: the first
  // frame compiles every pipeline again (seconds on a phone), and the cover
  // stays over the canvas until then.
  const [awaitingFirstFrame, setAwaitingFirstFrame] = useState(false);
  const firstFramePending = useRef(false);
  /** The replacement whose capture the cover still waits for, and the bound on that wait. */
  const captureReturn = useRef<{ readonly native: WebGPURenderer; readonly timer: ReturnType<typeof setTimeout> } | null>(null);
  // A cover over a lost view stands in for its scene: the ground it was drawn
  // on, not a flash of another colour over the dark hall.
  const [stage, setStage] = useState<StageTone | null>(null);
  const gpuErrors = useRef<NativeGpuErrorWatch | null>(null);
  /**
   * Replacements for a renderer whose GPU errors never stopped, with that
   * error and how long it counts: the same errors soon after, on a fresh
   * device, are the scene's own. Anything else gets the usual recovery, whose
   * three-losses-a-minute limit already ends a loop.
   */
  const errorReplacements = useRef(new WeakMap<WebGPURenderer, { readonly message: string; readonly until: number }>());
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
  /** The replacement a swap is starting, until it draws or fails. */
  const swapping = useRef<{ readonly native: WebGPURenderer; reject(error: Error): void } | null>(null);
  const remounting = useRef<{ resolve(): void; reject(error: Error): void } | null>(null);
  const restorations = useRef(0);
  /** This view, for the once-per-view ?graphicsReset drill. */
  const drillOwner = useRef({});
  const callbacks = useRef({ onCreated, onUnavailable, options, forceWebGL });
  callbacks.current = { onCreated, onUnavailable, options, forceWebGL };

  const coverUntilFirstFrame = useCallback((covered: boolean): void => {
    if (!covered && captureReturn.current !== null) {
      clearTimeout(captureReturn.current.timer);
      captureReturn.current = null;
    }
    firstFramePending.current = covered;
    if (mounted.current) setAwaitingFirstFrame(covered);
  }, []);

  const fail = useCallback((cause: Error): void => {
    framePacer.current?.pacer.dispose();
    framePacer.current = null;
    // A view still waiting for its capture shows the stage from the loss; the scene no longer does.
    const awaitingCapture = captureReturn.current !== null && captureReturn.current.native === renderer.current;
    if (firstFramePending.current) coverUntilFirstFrame(false);
    // Stop further frames synchronously, before React removes the failed Canvas.
    if (renderer.current !== null && failedRenderer.current === renderer.current) return;
    failedRenderer.current = renderer.current;
    if (!mounted.current) return;
    // A recovery's replacement that could not start (lost again, or failing,
    // while it initialized) is one failed attempt, not a stopped view: the
    // recovery decides what follows.
    const pendingSwap = swapping.current;
    if (pendingSwap !== null && pendingSwap.native === renderer.current) {
      swapping.current = null;
      pendingSwap.reject(cause);
      return;
    }
    const pendingRemount = remounting.current;
    if (pendingRemount !== null) {
      remounting.current = null;
      pendingRemount.reject(cause);
      return;
    }
    if (lost.current !== null) {
      // The view stops here: no recovery may keep building on it.
      lost.current = null;
      recovery.current?.reset();
    }
    if (running.current && root.current !== null && !awaitingCapture) setStage(stageToneOf(root.current.scene));
    reportFailure(running.current ? "view-stopped" : "renderer-failed", {
      surface: surfaceRef.current, backend: rendererBackend(renderer.current), detail: failureDetail(cause),
    });
    setStoppedWhileRunning(running.current);
    running.current = false;
    setError(cause);
    setStatus("error");
    lifecycle.current?.cancel();
  }, [coverUntilFirstFrame]);

  /** Recovery is exhausted: the view stopped while it held someone's work. */
  const giveUp = useCallback((cause: Error): void => {
    framePacer.current?.pacer.dispose();
    framePacer.current = null;
    lost.current = null;
    remounting.current = null;
    if (renderer.current !== null) failedRenderer.current = renderer.current;
    running.current = false;
    if (!mounted.current) return;
    reportFailure("view-stopped", {
      surface: surfaceRef.current, backend: rendererBackend(failedRenderer.current), detail: failureDetail(cause), restorations: restorations.current,
    });
    coverUntilFirstFrame(false);
    setStoppedWhileRunning(true);
    setError(cause);
    setStatus("error");
    lifecycle.current?.cancel();
  }, [coverUntilFirstFrame]);

  const lose = useCallback((
    native: WebGPURenderer, api: NativeLossApi, message: string, errorMessage: string | null = null,
  ): void => {
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
    // Lost again while the cover still waits for the capture: the replacement's
    // splat host has already let the old snapshot go, so the scene no longer
    // shows what the person last saw. Keep the capture and the stage from the first loss.
    const awaitingCapture = captureReturn.current?.native === native;
    if (firstFramePending.current) coverUntilFirstFrame(false);
    if (!awaitingCapture) setStage(stageToneOf(root.current.scene));
    const backend = isNativeWebGLBackend(native.backend) ? "webgl2" : "webgpu";
    reportFailure("device-lost", { surface: surfaceRef.current, backend, detail: errorMessage ?? message });
    lost.current = {
      native, settings, pixelRatio: native.getPixelRatio(), backend, errorMessage,
      captureShown: awaitingCapture || sceneShowsCapture(root.current.scene),
    };
    if (backend === "webgl2") {
      // Now, while its GL calls are silent no-ops (see releaseLostWebGLRenderer);
      // its later lifecycle disposal must then leave the shared canvas alone.
      sharedCanvas.current.add(native);
      void releaseLostWebGLRenderer(native).catch(() => {
        // A lost context may refuse its own clean-up; nothing on screen depends on it.
      });
    }
    recovery.current?.lost(api);
  }, [coverUntilFirstFrame, fail]);

  /** GPU errors outlasted their grace with no frame getting through. */
  const breakOnGpuErrors = useCallback((message: string): void => {
    const native = renderer.current;
    if (!mounted.current || native === null || failedRenderer.current === native) return;
    // A fresh device clears whatever the old one held (fragmented memory, a
    // resource left invalid). The same errors soon after on a fresh device, or
    // on a view not yet drawing, are the scene's own: stop rather than loop.
    const replaced = errorReplacements.current.get(native);
    const repeated = replaced !== undefined && replaced.message === message && performance.now() < replaced.until;
    if (running.current && !repeated) lose(native, "WebGPU", message, message);
    else fail(nativeRendererError(message));
  }, [fail, lose]);

  useEffect(() => {
    const watch = createNativeGpuErrorWatch({
      onBroken: breakOnGpuErrors,
      redraw: () => { root.current?.invalidate(); },
      // A view holding its frames for a precompile draws nothing, so nothing
      // can get through: the grace waits, as for a hidden page.
      isHidden: () => document.visibilityState === "hidden"
        || (renderer.current !== null && nativePrecompilePending(renderer.current)),
    });
    gpuErrors.current = watch;
    return () => {
      watch.dispose();
      if (gpuErrors.current === watch) gpuErrors.current = null;
    };
  }, [breakOnGpuErrors]);

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
    // A lost renderer still answers the effect cleanups that captured it (the
    // walk's camera restores the ratio it found on mount), and r186 resizes the
    // canvas element itself on these: the canvas its replacement now draws on.
    // A mismatched canvas is a WebGPU validation error on the next frame.
    const setPixelRatio = native.setPixelRatio.bind(native);
    native.setPixelRatio = (value?: number): void => { if (isCurrentRenderer()) setPixelRatio(value); };
    const setSize = native.setSize.bind(native);
    native.setSize = (width: number, height: number, updateStyle?: boolean): void => {
      if (isCurrentRenderer()) setSize(width, height, updateStyle);
    };
    const setDrawingBufferSize = native.setDrawingBufferSize.bind(native);
    native.setDrawingBufferSize = (width: number, height: number, pixelRatio: number): void => {
      if (isCurrentRenderer()) setDrawingBufferSize(width, height, pixelRatio);
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
    // An uncaptured error is not a lost device: Three r186 documents onError as
    // non-escalating, and one bad upload or draw is usually followed by good
    // frames. The watch decides when errors mean the view is broken.
    native.onError = (event: unknown): void => {
      if (renderer.current !== native || failedRenderer.current === native) return;
      // The app's own failures (a resident splat sort that died, a GPU readiness
      // callback that threw; lib/native-splat-scene.ts, lib/native-renderer.ts)
      // arrive as a message and stop the view at once, as they always have.
      // Three reports GPU errors as { api, type, message }.
      if (typeof event === "string") {
        fail(nativeRendererError(event));
        return;
      }
      const message = describeGpuError(event);
      if (gpuErrors.current?.error(message) === true) {
        reportFailure("gpu-error", { surface: surfaceRef.current, backend: rendererBackend(native), detail: message });
        // eslint-disable-next-line no-console
        console.warn("VenViewer: the graphics device reported an error; the 3D view keeps drawing.", message);
      }
    };
    if (reuse === "webgl2") sharedCanvas.current.add(native);
    renderer.current = native;
    gpuErrors.current?.reset();
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
        if (pendingRemount === null) return;
        remounting.current = null;
        coverUntilFirstFrame(true);
        pendingRemount.resolve();
      },
      onFailed: fail,
    });
  }, [coverUntilFirstFrame, fail, launch]);

  /** A fresh renderer on the same canvas; the scene, camera and React tree stay. */
  const swap = useCallback(async (): Promise<void> => {
    const retired = lost.current;
    const state = root.current;
    if (retired === null || state === null) throw new Error("There is no lost view to restore");
    // The canvas's previous renderer (the lost one, or a replacement that could
    // not start) releases its device and registrations before another draws there.
    const previous = lifecycle.current;
    lifecycle.current = null;
    if (previous !== null) await settleWithin(previous.retire(), RETIRE_WAIT_MS);
    if (!mounted.current || lost.current !== retired) throw new Error("The view closed while it was restoring");
    const next = buildRenderer(retired.native.domElement, retired.backend);
    baseSettings.current.set(next, retired.settings);
    if (retired.errorMessage !== null) {
      errorReplacements.current.set(next, { message: retired.errorMessage, until: performance.now() + NATIVE_RECOVERY_LOSS_WINDOW_MS });
    }
    await new Promise<void>((resolve, reject) => {
      const failed = (cause: Error): void => {
        // A replacement that could not start is not a stopped view: the recovery decides what follows.
        failedRenderer.current = next;
        if (swapping.current?.native === next) swapping.current = null;
        reject(cause);
      };
      swapping.current = { native: next, reject: failed };
      lifecycle.current = launch(next, state, {
        created: false,
        prepare: () => {
          applyNativeRendererSettings(next, retired.settings);
          next.setPixelRatio(retired.pixelRatio);
          const { size } = state.get();
          next.setSize(size.width, size.height, false);
          // Every renderer-keyed effect in the scene runs again against the new device.
          replaceStoreRenderer(state, next);
        },
        onActive: () => {
          swapping.current = null;
          sharedCanvas.current.delete(next);
          lost.current = null;
          // Let the lost renderer go; it is no longer current, which is what keeps it silent.
          failedRenderer.current = null;
          restorations.current += 1;
          if (next.domElement instanceof HTMLCanvasElement) next.domElement.dataset["restorations"] = String(restorations.current);
          // The first frame needs no request: the frame loop restarting with the
          // recovery's "running" phase invalidates the root. It lifts the cover,
          // or, for a captured room, the first frame once its capture is drawn
          // again or can no longer come (nativeSceneCapturePending).
          coverUntilFirstFrame(true);
          if (retired.captureShown) {
            const timer = setTimeout(() => {
              if (captureReturn.current?.native !== next) return;
              captureReturn.current = null;
              // The capture did not come back in time; the next frame lifts the cover.
              if (mounted.current) state.get().invalidate();
            }, NATIVE_CAPTURE_RETURN_WAIT_MS);
            captureReturn.current = { native: next, timer };
          }
          resolve();
        },
        onFailed: failed,
      });
    });
  }, [buildRenderer, coverUntilFirstFrame, launch]);

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
      // the final output) through the same render wrapper; its scene pass is
      // this frame's main draw of the scene (withNativeComposedFrame).
      const composer = nativeFrameComposer(native);
      if (composer !== null) withNativeComposedFrame(native, state.scene, state.camera, composer);
      else native.render(state.scene, state.camera);
      // The render wrapper reports main-frame errors through fail() and returns.
      // Never fence that failed draw or a renderer replaced during a callback.
      const drawn = mounted.current && renderer.current === native && failedRenderer.current !== native;
      // The frames a viewer sees, for the frame-rate governor (main-draw-clock.ts).
      if (drawn) {
        noteMainDraw(startedAt);
        // While errors are being judged, this frame counts once its own GPU work has completed.
        gpuErrors.current?.drawn(() => createNativeGpuWorkTicket(native, new AbortController().signal).completion);
        const awaitedCapture = captureReturn.current?.native === native;
        if (firstFramePending.current && (!awaitedCapture || !nativeSceneCapturePending(state.scene, native))) {
          coverUntilFirstFrame(false);
        }
      }
      return drawn;
    });
  }, [coverUntilFirstFrame]);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      // React StrictMode rehearses effect cleanup/setup on the same renderer.
      // A real unmount stays detached; pending init still belongs to its owner.
      queueMicrotask(() => {
        if (mounted.current) return;
        lifecycle.current?.cancel();
        if (captureReturn.current !== null) clearTimeout(captureReturn.current.timer);
        captureReturn.current = null;
      });
    };
  }, []);

  const retry = (): void => {
    recovery.current?.reset();
    lost.current = null;
    remounting.current = null;
    coverUntilFirstFrame(false);
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

  useEffect(() => {
    if (status === "error") callbacks.current.onUnavailable?.();
  }, [status]);

  const recovering = recoveryPhase.kind !== "running" && recoveryPhase.kind !== "failed";

  // Pipelines compiled ahead of their first draw (lib/native-precompile.ts):
  // the frame loop holds while they build, as each job sets the renderer's
  // target and MRT for its whole run. The scene queues its jobs from effects
  // in R3F's own root, whose commit does not wait for this one: the hold is
  // set on R3F's live store as the queue fills, and the jobs start at once.
  // The frame loop below reads the queue too, so no render between undoes it.
  const [, setPrecompileTurn] = useState(0);
  useLayoutEffect(() => {
    const native = renderer.current;
    const state = root.current;
    if (status !== "ready" || native === null || state === null) return undefined;
    let held = false;
    const update = (): void => {
      const pending = nativePrecompilePending(native);
      if (pending && !held) {
        held = true;
        const live = state.get();
        live.setFrameloop("never");
        // A frame owed from before the hold would still draw under R3F 8's
        // "never" (it renders while frames are owed): none is owed now.
        live.internal.frames = 0;
        void runNativePrecompiles(native, {
          onTimeout: () => {
            // eslint-disable-next-line no-console
            console.warn("VenViewer: compiling the view's pipelines ahead took too long; it draws on and compiles as it goes.");
            reportFailure("precompile-timeout", { surface: surfaceRef.current, backend: rendererBackend(native) });
          },
          // What the aborted job started is built now; a still view draws to show it.
          onLateSettle: () => { state.get().invalidate(); },
        });
      } else if (!pending) {
        held = false;
      }
      // Re-render: the Canvas takes its frame loop back once the queue is empty.
      if (mounted.current) setPrecompileTurn((turn) => turn + 1);
    };
    update();
    const stop = subscribeNativePrecompile(native, update);
    return () => {
      stop();
      clearNativePrecompiles(native);
    };
  }, [status, attempt, recovering]);
  const precompiling = renderer.current !== null && nativePrecompilePending(renderer.current);
  const wasPrecompiling = useRef(false);
  useLayoutEffect(() => {
    // The Canvas below has set its frame loop by now (a child's layout effect
    // runs first): once a hold ends, draw what its jobs prepared.
    if (wasPrecompiling.current && !precompiling) root.current?.get().invalidate();
    wasPrecompiling.current = precompiling;
  }, [precompiling]);
  const copy = SURFACE_COPY[surface];
  const continueIn2d = copy.offers2d ? plannerWork?.continueIn2d ?? null : null;
  // A view that never drew has no scene ground to stand in for.
  const cardStage = stoppedWhileRunning ? stage : null;
  return (
    <div
      data-graphics-recovery={recoveryPhase.kind}
      data-graphics-attempt={recoveryPhase.kind === "restoring" ? recoveryPhase.attempt : undefined}
      style={{ position: "relative", width: "100%", height: "100%", ...style }}
    >
      {status !== "error" && (
        <NativeCanvasFailureBoundary key={attempt} onError={fail}>
          <Canvas
            {...props}
            gl={createRenderer}
            onCreated={startRenderer}
            frameloop={status === "ready" && !recovering && !precompiling ? frameloop : "never"}
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
      {(recovering || awaitingFirstFrame) && status !== "error" && (
        <div data-graphics-cover={stage?.tone ?? DEFAULT_STAGE.tone} style={{
          // The lost canvas shows nothing true; cover it, and take the gestures meant for it.
          position: "absolute", inset: 0, zIndex: 20,
          display: "grid", placeItems: "safe center", padding: 24,
          boxSizing: "border-box", textAlign: "center",
          ...stageStyle(stage),
        }}>
          <div style={{ width: "100%", maxWidth: 440, lineHeight: 1.5 }}>
            <ActivityStatus variant="panel">Restoring the 3D view…</ActivityStatus>
            {copy.restoring !== null && <p style={{ margin: "14px 0 0" }}>{copy.restoring}</p>}
          </div>
        </div>
      )}
      {status === "error" && (
        <section role="alert" style={{
          // Keep recovery above scene HUDs, within the failed canvas's bounds.
          position: "absolute", inset: 0, zIndex: 20,
          display: "grid", placeItems: "safe center", padding: 24,
          overflow: "auto", boxSizing: "border-box", textAlign: "center",
          ...stageStyle(cardStage),
        }}>
          <div style={{ width: "100%", maxWidth: 440, lineHeight: 1.5 }}>
            <p style={{ margin: "0 0 16px" }}>
              {stoppedWhileRunning ? copy.stopped : copy.cannotStart}{" "}
              {continueIn2d !== null ? "Try again, or continue in 2D." : "Try again in a moment."}
            </p>
            <div style={{ display: "flex", gap: 10, justifyContent: "center", flexWrap: "wrap" }}>
              {continueIn2d !== null && (
                <button type="button" className="vv-button primary" onClick={continueIn2d}>Continue in 2D</button>
              )}
              <button type="button" className={continueIn2d !== null ? "vv-button" : "vv-button primary"} onClick={retry}>
                Try 3D again
              </button>
            </div>
            {import.meta.env.DEV && error !== null && <pre style={{ whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}>{error.message}</pre>}
          </div>
        </section>
      )}
    </div>
  );
}
