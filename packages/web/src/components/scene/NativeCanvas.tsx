import {
  Component, useCallback, useEffect, useRef, useState,
  type ReactElement, type ReactNode,
} from "react";
import { Canvas, type CanvasProps, type RootState } from "@react-three/fiber";
import { WebGPURenderer } from "three/webgpu";
import { ActivityStatus } from "../shared/Activity.js";
import { installNativeMaterialClipping } from "../../lib/native-material-clipping.js";
import { registerNativeSceneRenderer, withNativeRenderScope } from "../../lib/native-renderer.js";
import {
  createNativeRendererLifecycle, nativeRendererError, type NativeRendererLifecycle,
} from "../../lib/native-renderer-lifecycle.js";
export { isNativeRenderer } from "../../lib/native-renderer.js";

export interface NativeCanvasOptions {
  readonly antialias?: boolean;
  readonly alpha?: boolean;
  readonly powerPreference?: "default" | "high-performance" | "low-power";
}

export interface NativeCanvasProps extends Omit<CanvasProps, "gl"> {
  readonly gl?: NativeCanvasOptions;
  /** Development qualification of Three's native WebGL2 backend. */
  readonly forceWebGL?: boolean;
}

// TypeScript 5.7's DOM library predates the browser WebGPU types. Describe only
// the standard negotiation calls used here; Three's own device input is opaque.
interface NativeGraphicsDevice { destroy(): void }
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

function hasNativeBackendDisposal(backend: object): backend is { dispose(): Promise<void> | void } {
  return "dispose" in backend && typeof backend.dispose === "function";
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

/**
 * R3F 8's runtime accepts a renderer with render/setSize/setPixelRatio, but its
 * store's GL type predates WebGPURenderer and its factory is synchronous. Keep
 * React 18 and the established Canvas event/context/resize behavior, withhold
 * scene children and frames until the native backend has actually initialized.
 */
export function NativeCanvas({
  children, gl: options = {}, forceWebGL = false, frameloop = "always", onCreated, style, ...props
}: NativeCanvasProps): ReactElement {
  const [attempt, setAttempt] = useState(0);
  const [status, setStatus] = useState<"initializing" | "ready" | "error">("initializing");
  const [error, setError] = useState<Error | null>(null);
  const mounted = useRef(true);
  const renderer = useRef<WebGPURenderer | null>(null);
  const failedRenderer = useRef<WebGPURenderer | null>(null);
  const initialize = useRef<(() => Promise<void>) | null>(null);
  const dispose = useRef<((initialized: boolean) => Promise<void>) | null>(null);
  const lifecycle = useRef<NativeRendererLifecycle | null>(null);
  const callbacks = useRef({ onCreated, options, forceWebGL });
  callbacks.current = { onCreated, options, forceWebGL };

  const fail = useCallback((cause: Error): void => {
    // Stop further frames synchronously, before React removes the failed Canvas.
    failedRenderer.current = renderer.current;
    if (!mounted.current) return;
    setError(cause);
    setStatus("error");
    lifecycle.current?.cancel();
  }, []);

  const createRenderer = useCallback((canvas: HTMLCanvasElement | OffscreenCanvas): WebGPURenderer => {
    const configuration = callbacks.current;
    const parameters: ConstructorParameters<typeof WebGPURenderer>[0] = {
      canvas,
      antialias: false,
      alpha: true,
      ...configuration.options,
      powerPreference: configuration.options.powerPreference === "low-power" ? "low-power" : "high-performance",
      forceWebGL: import.meta.env.DEV && (
        configuration.forceWebGL || new URLSearchParams(window.location.search).get("nativeWebGL") === "1"
      ),
    };
    const native = new WebGPURenderer(parameters);
    const draw = native.render.bind(native);
    native.render = (...args: Parameters<WebGPURenderer["render"]>): ReturnType<WebGPURenderer["render"]> => {
      const offscreen = native.getRenderTarget() !== null;
      if (!mounted.current || renderer.current !== native || failedRenderer.current === native) {
        if (offscreen) throw new Error("The native renderer is no longer available for capture");
        return;
      }
      try {
        withNativeRenderScope(native, args[0], args[1], () => { draw(...args); });
      } catch (cause) {
        // Capture owns its failure result; swallowing this would export a blank
        // image as success. Main-frame errors instead use the recoverable UI.
        if (offscreen) throw cause;
        fail(nativeRendererError(cause));
      }
    };
    let releaseDevice: (() => void) | null = null;
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
    };
    dispose.current = async (initialized) => {
      try {
        if (initialized) await native.dispose();
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
    const backendFailed = (event: unknown): void => {
      if (renderer.current !== native) return;
      const message = typeof event === "object" && event !== null && "message" in event
        ? event.message : event;
      fail(nativeRendererError(message));
    };
    native.onDeviceLost = backendFailed;
    native.onError = backendFailed;
    renderer.current = native;
    // R3F8's factory accepts its structural Renderer contract (render), so the
    // native object needs no cast. Its legacy RootState.gl annotation remains
    // narrower; backend-specific consumers must use isNativeRenderer.
    return native;
  }, [fail]);

  const startRenderer = useCallback((state: RootState): void => {
    const native = renderer.current;
    if (native === null || lifecycle.current !== null) return;
    const initializeNative = initialize.current;
    const disposeNative = dispose.current;
    let unregisterScene: (() => void) | null = null;
    lifecycle.current = createNativeRendererLifecycle({
      initialize: async () => { if (initializeNative !== null) await initializeNative(); },
      dispose: async (initialized) => {
        unregisterScene?.();
        await disposeNative?.(initialized);
      },
      onReady: () => {
        if (!mounted.current || renderer.current !== native) return;
        try {
          const backend = native.backend;
          if (native.domElement instanceof HTMLCanvasElement) {
            native.domElement.dataset["renderer"] = "three-native";
            native.domElement.dataset["backend"] = "isWebGPUBackend" in backend ? "webgpu" : "webgl2";
          }
          callbacks.current.onCreated?.(state);
          unregisterScene = registerNativeSceneRenderer(state.scene, native);
          setStatus("ready");
        } catch (cause) {
          fail(nativeRendererError(cause));
        }
      },
      onError: fail,
    });
  }, [fail]);

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
    lifecycle.current?.cancel();
    lifecycle.current = null;
    renderer.current = null;
    initialize.current = null;
    dispose.current = null;
    setError(null);
    setStatus("initializing");
    setAttempt((current) => current + 1);
  };

  return (
    <div style={{ position: "relative", width: "100%", height: "100%", ...style }}>
      {status !== "error" && (
        <NativeCanvasFailureBoundary key={attempt} onError={fail}>
          <Canvas
            {...props}
            gl={createRenderer}
            onCreated={startRenderer}
            frameloop={status === "ready" ? frameloop : "never"}
            style={{ width: "100%", height: "100%" }}
          >
            {status === "ready" ? children : null}
          </Canvas>
        </NativeCanvasFailureBoundary>
      )}
      {status === "initializing" && (
        <div style={{ position: "absolute", inset: 0, display: "grid", placeItems: "center", pointerEvents: "none" }}>
          <ActivityStatus variant="panel">Opening the 3D view…</ActivityStatus>
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
            <p>The 3D view couldn’t start. Try again, or continue in the 2D planner.</p>
            <button type="button" onClick={retry}>Try 3D again</button>{" "}
            <a href="/blueprint">Open the 2D planner</a>
            {import.meta.env.DEV && error !== null && <pre style={{ whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}>{error.message}</pre>}
          </div>
        </section>
      )}
    </div>
  );
}
