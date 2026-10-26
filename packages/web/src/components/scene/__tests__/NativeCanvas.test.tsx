import { StrictMode, type ReactNode } from "react";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from "vitest";
import { useEffect } from "react";
import { Color, PerspectiveCamera, RenderTarget, Scene, type Camera, type Object3D } from "three";
import { useFrame } from "@react-three/fiber";
import type { NativeGpuWorkResult } from "../../../lib/native-gpu-completion.js";
import type { GpuProfileToken } from "../../../lib/perf-runtime.js";
import type { RenderedFrameSample } from "../../../lib/perf-profiler.js";
import type { NativeScenePerfStats } from "../../../lib/native-splat-scene.js";

interface FiberState {
  gl: object;
  readonly scene: Scene;
  camera: Camera;
  readonly size: { readonly width: number; readonly height: number };
  invalidate(): void;
  get(): FiberState;
  set(partial: { readonly gl?: object }): void;
}

const fiber = vi.hoisted(() => ({
  state: null as FiberState | null,
  invalidate: vi.fn(),
  frames: new Set<{ callback: (state: FiberState) => void; priority: number }>(),
}));

const profiling = vi.hoisted(() => ({
  enabled: vi.fn(() => false), begin: vi.fn((): GpuProfileToken | null => null), end: vi.fn(),
  record: vi.fn<(sample: RenderedFrameSample, renderer: object) => void>(),
  release: vi.fn(), register: vi.fn(),
  sceneStats: vi.fn((): NativeScenePerfStats | null => ({ splats: 123, sortTimeMs: 4, sortAgeMs: 20, sortBacklog: 1 })),
  sampleDrawn: vi.fn(), drawn: vi.fn(() => Promise.resolve(45)),
  capturePending: vi.fn((_scene: object, _renderer: object) => false),
}));
vi.mock("../../../lib/perf-runtime.js", () => ({
  shouldProfileFrames: profiling.enabled, beginGpuProfile: profiling.begin,
  endGpuProfile: profiling.end, recordRenderedFrame: profiling.record,
  registerProfilerRenderer: profiling.register, sampleDrawnSplats: profiling.sampleDrawn,
}));
vi.mock("../../../lib/native-splat-scene.js", () => ({
  nativeScenePerfStats: profiling.sceneStats, nativeSceneDrawnSplats: profiling.drawn, nativeSceneCapturePending: profiling.capturePending,
}));

const gpuCompletion = vi.hoisted(() => {
  class Ticket {
    result: NativeGpuWorkResult = { status: "pending" };
    readonly completion: Promise<void>;
    readonly poll = vi.fn(() => this.result);
    resolve = (): void => { throw new Error("Ticket not initialized"); };
    reject = (_cause: Error): void => { throw new Error("Ticket not initialized"); };
    constructor(readonly signal: AbortSignal) {
      this.completion = new Promise<void>((resolve, reject) => { this.resolve = resolve; this.reject = reject; });
      signal.addEventListener("abort", () => { this.fail(new DOMException("Cancelled", "AbortError")); }, { once: true });
    }
    finish(): void { this.result = { status: "complete", completedAt: performance.now() }; this.resolve(); }
    fail(error: Error): void { this.result = { status: "failed", error }; this.reject(error); }
  }
  const tickets: Ticket[] = [];
  return { tickets, create: vi.fn((_renderer: object, signal: AbortSignal) => {
    const ticket = new Ticket(signal);
    tickets.push(ticket);
    return ticket;
  }) };
});

vi.mock("../../../lib/native-gpu-completion.js", async (importOriginal) => ({
  ...await importOriginal<typeof import("../../../lib/native-gpu-completion.js")>(),
  createNativeGpuWorkTicket: gpuCompletion.create,
}));

const native = vi.hoisted(() => {
  const instances: Renderer[] = [];
  /** Which backend the next renderer negotiates, as Three would, and the device Three requests itself when given none. */
  const negotiation = { backend: "webgpu" as "webgpu" | "webgl2", ownDevice: null as object | null };
  class Renderer {
    readonly domElement: HTMLCanvasElement;
    readonly info = { render: { drawCalls: 3, triangles: 8 }, memory: { total: 4096 }, autoReset: true };
    readonly backend: {
      isWebGPUBackend?: true;
      isWebGLBackend?: true;
      parameters: { canvas: HTMLCanvasElement; device?: object };
      device?: object;
      /** r186 WebGLExtensions' lookup cache. */
      extensions?: { extensions: Record<string, unknown> };
      dispose: ReturnType<typeof vi.fn>;
    };
    // The renderer settings a replacement must inherit (r186 Renderer fields).
    pixelRatio = 1;
    readonly getPixelRatio = vi.fn(() => this.pixelRatio);
    // As r186's CanvasTarget does, these resize the canvas itself; NativeCanvas guards them.
    readonly rawSetPixelRatio = vi.fn((ratio: number) => { this.pixelRatio = ratio; });
    setPixelRatio = this.rawSetPixelRatio;
    readonly rawSetSize = vi.fn((_width: number, _height: number, _updateStyle?: boolean): void => undefined);
    setSize = this.rawSetSize;
    readonly rawSetDrawingBufferSize = vi.fn((_width: number, _height: number, _ratio: number): void => undefined);
    setDrawingBufferSize = this.rawSetDrawingBufferSize;
    toneMapping = 0;
    toneMappingExposure = 1;
    outputColorSpace = "srgb";
    sortObjects = true;
    autoClear = true;
    autoClearColor = true;
    autoClearDepth = true;
    autoClearStencil = true;
    readonly shadowMap = { enabled: false, type: 1 };
    readonly clearColor = new Color(0x000000);
    clearAlpha = 0;
    readonly getClearColor = vi.fn((target: Color) => target.copy(this.clearColor));
    readonly getClearAlpha = vi.fn(() => this.clearAlpha);
    readonly setClearColor = vi.fn((color: Color, alpha: number) => { this.clearColor.copy(color); this.clearAlpha = alpha; });
    readonly dispose = vi.fn(() => Promise.resolve());
    readonly setRenderObjectFunction = vi.fn();
    readonly renderObject = vi.fn();
    readonly compileAsync = vi.fn((_scene: Object3D, _camera: Camera) => Promise.resolve());
    readonly rawRender = vi.fn((_scene: Object3D, _camera: Camera): void => undefined);
    render = this.rawRender;
    renderTarget: RenderTarget | null = null;
    readonly getRenderTarget = vi.fn(() => this.renderTarget);
    initializedDevice: object | undefined;
    readonly init = vi.fn(() => {
      this.initializedDevice = this.backend.parameters.device;
      // r186 WebGPUBackend.init keeps the device it was given, or the one it requested.
      if (this.backend.isWebGPUBackend === true) this.backend.device = this.backend.parameters.device ?? negotiation.ownDevice ?? undefined;
      return this.pending;
    });
    readonly pending: Promise<void>;
    resolve = (): void => { throw new Error("Not initialized"); };
    reject = (_cause: Error): void => { throw new Error("Not initialized"); };
    onDeviceLost = (_event: { api?: "WebGL" | "WebGPU"; message: string }): void => undefined;
    // r186 reports uncaptured GPU errors as an object; the app reports its own failures as a message.
    onError = (_event: { message: string; type?: string } | string): void => undefined;
    constructor(options: { canvas: HTMLCanvasElement }) {
      this.domElement = options.canvas;
      // Match r186 Backend: it copies the options before async initialization.
      this.backend = {
        ...(negotiation.backend === "webgpu"
          ? { isWebGPUBackend: true as const }
          : { isWebGLBackend: true as const, extensions: { extensions: {} } }),
        parameters: { ...options }, dispose: vi.fn(() => Promise.resolve()),
      };
      this.pending = new Promise<void>((resolve, reject) => { this.resolve = resolve; this.reject = reject; });
      instances.push(this);
    }
  }
  return { instances, Renderer, negotiation };
});

vi.mock("three/webgpu", async (importOriginal) => ({
  ...await importOriginal<typeof import("three/webgpu")>(),
  WebGPURenderer: native.Renderer,
}));

vi.mock("@react-three/fiber", async () => {
  const React = await import("react");
  return {
    useFrame: (callback: (state: FiberState) => void, priority = 0) => {
      const latest = React.useRef(callback);
      React.useLayoutEffect(() => { latest.current = callback; });
      React.useLayoutEffect(() => {
        const subscription = { callback: (state: FiberState) => { latest.current(state); }, priority };
        fiber.frames.add(subscription);
        return () => { fiber.frames.delete(subscription); };
      }, [priority]);
    },
    Canvas: ({ children, gl, onCreated, frameloop }: {
      children?: ReactNode;
      gl: (canvas: HTMLCanvasElement) => object;
      onCreated: (state: object) => void;
      frameloop: string;
    }) => {
      const renderer = React.useRef<object | null>(null);
      const state = React.useRef<FiberState | null>(null);
      React.useLayoutEffect(() => {
        renderer.current ??= gl(document.createElement("canvas"));
        state.current ??= {
          gl: renderer.current, scene: new Scene(), camera: new PerspectiveCamera(), invalidate: fiber.invalidate,
          size: { width: 800, height: 600 },
          get: () => {
            if (state.current === null) throw new Error("Missing current R3F state");
            return state.current;
          },
          set: (partial) => {
            if (state.current !== null && partial.gl !== undefined) state.current.gl = partial.gl;
          },
        };
        fiber.state = state.current;
        onCreated(state.current);
      }, [gl, onCreated]);
      return <div data-testid="fiber-canvas" data-frameloop={frameloop}>{children}</div>;
    },
  };
});

import { NATIVE_CAPTURE_RETURN_WAIT_MS, NativeCanvas } from "../NativeCanvas.js";
import { PlannerWorkContext } from "../planner-work.js";
import { isNativeCanvasRender } from "../../../lib/native-renderer.js";
import { onGpuMemoryPressure } from "../../../lib/gpu-memory-pressure.js";
import { NATIVE_GPU_ERROR_GRACE_MS } from "../../../lib/native-gpu-error-watch.js";

beforeEach(() => {
  native.instances.length = 0;
  native.negotiation.backend = "webgpu";
  native.negotiation.ownDevice = null;
  fiber.frames.clear();
  fiber.state = null;
  fiber.invalidate.mockReset();
  gpuCompletion.tickets.length = 0;
  gpuCompletion.create.mockClear();
  profiling.enabled.mockReset().mockReturnValue(false);
  profiling.begin.mockReset().mockReturnValue(null);
  profiling.end.mockReset();
  profiling.record.mockReset();
  profiling.release.mockReset();
  profiling.register.mockReset().mockReturnValue(profiling.release);
  profiling.capturePending.mockReset().mockReturnValue(false);
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

type FakeRenderer = (typeof native.instances)[number];

function renderer(index: number): FakeRenderer {
  const instance = native.instances[index];
  if (instance === undefined) throw new Error(`Renderer ${String(index)} was never created`);
  return instance;
}

async function start(index: number): Promise<FakeRenderer> {
  const instance = renderer(index);
  await act(() => { instance.resolve(); return Promise.resolve(); });
  return instance;
}

/** Let promise chains (negotiation, disposal, recovery attempts) run to rest. */
async function flush(): Promise<void> {
  await act(async () => { for (let turn = 0; turn < 12; turn++) await Promise.resolve(); });
}

function MountProbe({ mounts }: { readonly mounts: { count: number } }): ReactNode {
  useEffect(() => { mounts.count += 1; }, [mounts]);
  return <span>Room geometry</span>;
}

interface FakeDevice { readonly destroy: Mock<() => void>; readonly lost: Promise<{ reason: string; message: string }> }

/** A device whose `lost` resolves "destroyed" when destroyed, as a real one does. */
function fakeDevice(): FakeDevice {
  let lose = (_reason: string): void => undefined;
  const lost = new Promise<{ reason: string; message: string }>((resolve) => { lose = (reason) => { resolve({ reason, message: "" }); }; });
  return { destroy: vi.fn(() => { lose("destroyed"); }), lost };
}

function fakeDevices(count: number): FakeDevice[] {
  return Array.from({ length: count }, fakeDevice);
}

/** A WebGPU device per request, negotiated by NativeCanvas itself. */
function stubWebGpuDevices(): FakeDevice[] {
  const devices: FakeDevice[] = [];
  const requestDevice = vi.fn(() => {
    const device = fakeDevice();
    devices.push(device);
    return Promise.resolve(device);
  });
  vi.stubGlobal("navigator", { gpu: { requestAdapter: vi.fn(() => Promise.resolve({
    features: new Set<string>(), limits: { maxStorageBufferBindingSize: 134_217_728, maxBufferSize: 268_435_456 }, requestDevice,
  })) } });
  return devices;
}

function automaticFrame(): void {
  const state = fiber.state;
  if (state === null) throw new Error("No R3F root state");
  act(() => {
    for (const subscription of [...fiber.frames].sort((a, b) => a.priority - b.priority)) subscription.callback(state);
  });
}

describe("NativeCanvas", () => {
  it("profiles successful main draws, including native telemetry, but never skipped callbacks or exports", async () => {
    profiling.enabled.mockReturnValue(true);
    const view = render(<NativeCanvas />);
    const instance = native.instances[0];
    if (instance === undefined) throw new Error("Missing renderer");
    await act(() => { instance.resolve(); return Promise.resolve(); });
    expect(profiling.register).toHaveBeenCalledExactlyOnceWith(instance, instance.domElement, "webgpu");
    automaticFrame(); automaticFrame(); automaticFrame();
    expect(profiling.record).toHaveBeenCalledTimes(2);
    expect(profiling.record).toHaveBeenLastCalledWith(expect.objectContaining({
      drawCalls: 3, triangles: 8, rendererBytes: 4096, splats: 123, sortTimeMs: 4,
    }), instance);
    expect(profiling.record.mock.calls[0]?.[0].cpuSubmitMs).toBeGreaterThanOrEqual(0);
    instance.renderTarget = new RenderTarget(1, 1);
    instance.render(new Scene(), new PerspectiveCamera());
    expect(profiling.record).toHaveBeenCalledTimes(2);
    instance.renderTarget.dispose();
    instance.renderTarget = null;
    view.unmount();
    await act(() => Promise.resolve());
    expect(profiling.release).toHaveBeenCalledOnce();
  });

  it("counts a nested main render only once and isolates diagnostic failures", async () => {
    profiling.enabled.mockReturnValue(true);
    render(<NativeCanvas />);
    const instance = native.instances[0];
    if (instance === undefined) throw new Error("Missing renderer");
    await act(() => { instance.resolve(); return Promise.resolve(); });
    instance.rawRender.mockImplementationOnce((scene, camera) => { instance.render(scene, camera); });
    instance.render(new Scene(), new PerspectiveCamera());
    expect(instance.rawRender).toHaveBeenCalledTimes(2);
    expect(profiling.record).toHaveBeenCalledOnce();
    profiling.record.mockImplementationOnce(() => { throw new Error("Sampler unavailable"); });
    expect(() => { instance.render(new Scene(), new PerspectiveCamera()); }).not.toThrow();
    expect(screen.queryByRole("alert")).toBeNull();
    profiling.begin.mockImplementationOnce(() => { throw new Error("Timestamp unavailable"); });
    expect(() => { instance.render(new Scene(), new PerspectiveCamera()); }).not.toThrow();
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("does not publish a failed draw as a profiled frame", async () => {
    profiling.enabled.mockReturnValue(true);
    const token: GpuProfileToken = {
      backend: { trackTimestamp: true, hasTimestamp: true, timestampQueryPool: {}, resolveTimestampsAsync: () => Promise.resolve() },
      owner: { pending: true, sampledAt: 0 }, timestampMs: 0, generation: 0,
    };
    profiling.begin.mockReturnValue(token);
    render(<NativeCanvas />);
    const instance = native.instances[0];
    if (instance === undefined) throw new Error("Missing renderer");
    await act(() => { instance.resolve(); return Promise.resolve(); });
    instance.rawRender.mockImplementationOnce(() => { throw new Error("Draw failed"); });
    automaticFrame();
    expect(profiling.record).not.toHaveBeenCalled();
    expect(profiling.end).toHaveBeenCalledExactlyOnceWith(token, false);
    expect(screen.getByRole("alert").textContent).toContain("Draw failed");
  });

  it("keeps drawing through an uncaptured GPU error, reports it once and asks for the frame that proves it", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    try {
      render(<NativeCanvas frameloop="demand"><span>Room geometry</span></NativeCanvas>);
      const instance = await start(0);
      automaticFrame();
      fiber.invalidate.mockClear();
      act(() => {
        instance.onError({ message: "Invalid texture view" });
        instance.onError({ message: "Invalid texture view" });
      });
      expect(screen.queryByRole("alert")).toBeNull();
      expect(screen.queryByRole("status")).toBeNull();
      expect(screen.getByTestId("fiber-canvas").getAttribute("data-frameloop")).toBe("demand");
      expect(warn).toHaveBeenCalledOnce();
      expect(warn.mock.calls[0]?.join(" ")).toContain("Invalid texture view");
      expect(fiber.invalidate).toHaveBeenCalled();
      automaticFrame();
      expect(instance.rawRender).toHaveBeenCalledTimes(2);
      expect(screen.getByText("Room geometry")).toBeDefined();
    } finally {
      warn.mockRestore();
    }
  });
  it("frees memory at once when the device runs out of it, and keeps drawing", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    try {
      render(<NativeCanvas frameloop="demand"><span>Room geometry</span></NativeCanvas>);
      const instance = await start(0);
      automaticFrame();
      const pressed = vi.fn();
      const stop = onGpuMemoryPressure(instance, pressed);
      act(() => {
        instance.onError({ type: "GPUValidationError", message: "Invalid texture view" });
        instance.onError({ type: "GPUOutOfMemoryError", message: "Not enough memory left" });
      });
      expect(pressed).toHaveBeenCalledOnce();
      expect(screen.queryByRole("alert")).toBeNull();
      expect(screen.getByTestId("fiber-canvas").getAttribute("data-frameloop")).toBe("demand");
      stop();
    } finally {
      warn.mockRestore();
    }
  });

  it("stops at once for the app's own failures, which arrive as a message rather than a GPU error", async () => {
    render(<NativeCanvas><span>Room geometry</span></NativeCanvas>);
    const instance = await start(0);
    automaticFrame();
    // As NativeSplatScene reports a resident sort that died, and the GPU readiness bridge a failed callback.
    act(() => { instance.onError("Native splat sorting failed: resident worker crashed"); });
    expect(screen.getByRole("alert").textContent).toContain("The 3D view stopped.");
    expect(screen.getByRole("alert").textContent).toContain("Native splat sorting failed");
    expect(native.instances).toHaveLength(1);
  });

  it.each([
    [134_217_728, 268_435_456, 134_217_728, 268_435_456],
    [536_870_912, 1_073_741_824, 268_435_456, 536_870_912],
  ])("initializes with the negotiated device at supported limits %i/%i", async (storage, buffer, requestedStorage, requestedBuffer) => {
    const device = { destroy: vi.fn(), lost: new Promise<never>(() => undefined) };
    const requestDevice = vi.fn(() => Promise.resolve(device));
    const requestAdapter = vi.fn(() => Promise.resolve({
      features: new Set(["float32-filterable"]),
      limits: { maxStorageBufferBindingSize: storage, maxBufferSize: buffer },
      requestDevice,
    }));
    vi.stubGlobal("navigator", { gpu: { requestAdapter } });
    const view = render(<NativeCanvas />);
    await act(() => Promise.resolve());
    expect(requestAdapter).toHaveBeenCalledOnce();
    expect(requestDevice).toHaveBeenCalledWith({
      requiredFeatures: ["float32-filterable"],
      requiredLimits: { maxStorageBufferBindingSize: requestedStorage, maxBufferSize: requestedBuffer },
    });
    const instance = native.instances[0];
    expect(instance?.initializedDevice).toBe(device);
    expect(instance?.backend.parameters.device).toBe(device);
    expect(instance?.init).toHaveBeenCalledOnce();
    await act(() => { instance?.resolve(); return Promise.resolve(); });
    view.unmount();
    await act(() => Promise.resolve());
    expect(device.destroy).toHaveBeenCalledOnce();
  });

  it("withholds both scene and frame loop until native initialization resolves", async () => {
    const onCreated = vi.fn();
    render(<NativeCanvas frameloop="demand" onCreated={onCreated}><span>Room geometry</span></NativeCanvas>);
    expect(screen.getByRole("status").textContent).toContain("Opening the 3D view");
    expect(screen.queryByText("Room geometry")).toBeNull();
    expect(screen.getByTestId("fiber-canvas").getAttribute("data-frameloop")).toBe("never");
    expect(onCreated).not.toHaveBeenCalled();
    await act(() => { native.instances[0]?.resolve(); return Promise.resolve(); });
    expect(screen.queryByRole("status")).toBeNull();
    expect(screen.getByText("Room geometry")).toBeDefined();
    expect(screen.getByTestId("fiber-canvas").getAttribute("data-frameloop")).toBe("demand");
    expect(onCreated).toHaveBeenCalledOnce();
  });

  it("owns automatic drawing after scene updates and coalesces work without retaining an old camera", async () => {
    let updates = 0;
    function CameraUpdates(): null {
      useFrame((state) => { state.camera.position.x = ++updates; });
      return null;
    }
    render(<NativeCanvas frameloop="demand"><CameraUpdates /></NativeCanvas>);
    expect(fiber.frames.size).toBe(0);
    const instance = native.instances[0];
    if (instance === undefined) throw new Error("Missing renderer");
    await act(() => { instance.resolve(); return Promise.resolve(); });
    expect([...fiber.frames].map(frame => frame.priority).sort()).toEqual([0, 1]);
    const presentedPositions: number[] = [];
    instance.rawRender.mockImplementation((_scene, camera) => { presentedPositions.push(camera.position.x); });
    automaticFrame();
    automaticFrame();
    automaticFrame();
    automaticFrame();
    expect(updates).toBe(4);
    expect(presentedPositions).toEqual([1, 2]);
    expect(gpuCompletion.tickets).toHaveLength(2);
    expect(fiber.invalidate).not.toHaveBeenCalled();
    await act(() => { gpuCompletion.tickets[0]?.finish(); return Promise.resolve(); });
    expect(fiber.invalidate).toHaveBeenCalledOnce();
    const state = fiber.state;
    if (state === null) throw new Error("Missing root");
    const camera = new PerspectiveCamera();
    state.camera = camera;
    automaticFrame();
    expect(presentedPositions).toEqual([1, 2, 5]);
    expect(instance.rawRender).toHaveBeenLastCalledWith(state.scene, camera);
    expect(gpuCompletion.tickets).toHaveLength(3);
  });

  it("leaves explicit main, nested, offscreen and compile calls immediate while automatic work is full", async () => {
    render(<NativeCanvas />);
    const instance = native.instances[0];
    if (instance === undefined) throw new Error("Missing renderer");
    await act(() => { instance.resolve(); return Promise.resolve(); });
    automaticFrame();
    automaticFrame();
    automaticFrame();
    expect(instance.rawRender).toHaveBeenCalledTimes(2);
    const scene = new Scene(), camera = new PerspectiveCamera();
    instance.render(scene, camera);
    instance.rawRender.mockImplementationOnce(() => { instance.render(scene, camera); });
    instance.render(scene, camera);
    const target = new RenderTarget(2, 2);
    instance.renderTarget = target;
    instance.render(scene, camera);
    await instance.compileAsync(scene, camera);
    expect(instance.rawRender).toHaveBeenCalledTimes(6);
    expect(instance.compileAsync).toHaveBeenCalledExactlyOnceWith(scene, camera);
    expect(gpuCompletion.tickets).toHaveLength(2);
    instance.renderTarget = null;
    target.dispose();
  });

  it("does not create a completion ticket after an automatic draw fails inside the recoverable wrapper", async () => {
    render(<NativeCanvas />);
    const instance = native.instances[0];
    if (instance === undefined) throw new Error("Missing renderer");
    await act(() => { instance.resolve(); return Promise.resolve(); });
    instance.rawRender.mockImplementationOnce(() => { throw new Error("Rejected automatic frame"); });
    automaticFrame();
    expect(screen.getByRole("alert").textContent).toContain("Rejected automatic frame");
    expect(instance.rawRender).toHaveBeenCalledOnce();
    expect(gpuCompletion.create).not.toHaveBeenCalled();
    expect(instance.dispose).toHaveBeenCalledOnce();
    expect(fiber.frames.size).toBe(0);
  });

  it("cancels pending pacing on a fence failure and cannot wake the replacement renderer from old work", async () => {
    render(<NativeCanvas />);
    const first = native.instances[0];
    if (first === undefined) throw new Error("Missing renderer");
    await act(() => { first.resolve(); return Promise.resolve(); });
    automaticFrame();
    automaticFrame();
    automaticFrame();
    const stale = [...gpuCompletion.tickets];
    await act(() => { stale[0]?.fail(new Error("GPU pacing fence failed")); return Promise.resolve(); });
    expect(screen.getByRole("alert").textContent).toContain("GPU pacing fence failed");
    expect(stale.every(ticket => ticket.signal.aborted)).toBe(true);
    expect(first.dispose).toHaveBeenCalledOnce();
    fireEvent.click(screen.getByRole("button", { name: "Try 3D again" }));
    const second = native.instances[1];
    if (second === undefined) throw new Error("Missing replacement renderer");
    await act(() => { second.resolve(); return Promise.resolve(); });
    await act(() => { for (const ticket of stale) ticket.finish(); return Promise.resolve(); });
    expect(fiber.invalidate).not.toHaveBeenCalled();
    automaticFrame();
    expect(second.rawRender).toHaveBeenCalledOnce();
    expect(first.rawRender).toHaveBeenCalledTimes(2);
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("aborts pending draws at unmount without producing a late root invalidation", async () => {
    const view = render(<NativeCanvas />);
    await act(() => { native.instances[0]?.resolve(); return Promise.resolve(); });
    automaticFrame();
    automaticFrame();
    automaticFrame();
    const stale = [...gpuCompletion.tickets];
    view.unmount();
    await act(() => Promise.resolve());
    expect(stale.every(ticket => ticket.signal.aborted)).toBe(true);
    await act(() => { for (const ticket of stale) ticket.finish(); return Promise.resolve(); });
    expect(fiber.invalidate).not.toHaveBeenCalled();
    expect(fiber.frames.size).toBe(0);
    expect(native.instances[0]?.dispose).toHaveBeenCalledOnce();
  });

  it("shows a recoverable init error, releases failed resources and retries a new renderer", async () => {
    render(<NativeCanvas><span>Room geometry</span></NativeCanvas>);
    const first = native.instances[0];
    await act(() => { first?.reject(new Error("No graphics adapter")); return Promise.resolve(); });
    expect(screen.getByRole("alert")).toBeDefined();
    expect(screen.queryByRole("status")).toBeNull();
    expect(first?.backend.dispose).toHaveBeenCalledOnce();
    expect(first?.dispose).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Try 3D again" }));
    expect(native.instances).toHaveLength(2);
    await act(() => { native.instances[1]?.resolve(); return Promise.resolve(); });
    expect(screen.getByText("Room geometry")).toBeDefined();
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("scopes main draws by their entry target despite internal output targets and excludes explicit exports", async () => {
    render(<NativeCanvas />);
    const instance = native.instances[0];
    if (instance === undefined) throw new Error("No native renderer was created");
    await act(() => { instance.resolve(); return Promise.resolve(); });
    const scene = new Scene(), camera = new PerspectiveCamera();
    const internalTarget = new RenderTarget(1, 1);
    instance.rawRender.mockImplementationOnce(() => {
      instance.renderTarget = internalTarget;
      expect(isNativeCanvasRender(instance, scene, camera)).toBe(true);
    });
    instance.render(scene, camera);
    expect(isNativeCanvasRender(instance, scene, camera)).toBe(false);
    instance.rawRender.mockImplementationOnce(() => {
      instance.renderTarget = null;
      expect(isNativeCanvasRender(instance, scene, camera)).toBe(false);
    });
    instance.render(scene, camera);
    expect(isNativeCanvasRender(instance, scene, camera)).toBe(false);
    internalTarget.dispose();
  });

  describe("when the browser takes the graphics device away", () => {
    it("puts a fresh renderer on the same canvas and keeps the scene, its state and onCreated untouched", async () => {
      const onCreated = vi.fn();
      const mounts = { count: 0 };
      render(<NativeCanvas frameloop="demand" onCreated={onCreated}><MountProbe mounts={mounts} /></NativeCanvas>);
      const lost = await start(0);
      automaticFrame();
      expect(lost.rawRender).toHaveBeenCalledOnce();

      act(() => { lost.onDeviceLost({ api: "WebGPU", message: "Device lost" }); });
      expect(screen.getByRole("status").textContent).toContain("Restoring the 3D view");
      expect(screen.queryByRole("alert")).toBeNull();
      expect(screen.getByText("Room geometry")).toBeDefined();
      expect(screen.getByTestId("fiber-canvas").getAttribute("data-frameloop")).toBe("never");
      automaticFrame();
      expect(lost.rawRender).toHaveBeenCalledOnce();

      await flush();
      const fresh = renderer(1);
      expect(fresh.domElement).toBe(lost.domElement);
      expect(lost.dispose).toHaveBeenCalledOnce();
      await start(1);
      await flush();
      expect(fiber.state?.gl).toBe(fresh);
      // Frames resume so the new device can compile and draw; the room is not
      // back until it has, so the cover stays until that first frame.
      expect(screen.getByTestId("fiber-canvas").getAttribute("data-frameloop")).toBe("demand");
      expect(screen.getByRole("status").textContent).toContain("Restoring the 3D view");
      automaticFrame();
      expect(fresh.rawRender).toHaveBeenCalledOnce();
      expect(lost.rawRender).toHaveBeenCalledOnce();
      expect(screen.queryByRole("status")).toBeNull();
      expect(mounts.count).toBe(1);
      expect(onCreated).toHaveBeenCalledOnce();
    });

    it("gives the replacement the renderer's own settings and the current resolution, not values a scene effect layered on", async () => {
      render(<NativeCanvas><span>Room geometry</span></NativeCanvas>);
      const lost = renderer(0);
      // As R3F configures the renderer before NativeCanvas activates it.
      lost.toneMapping = 4;
      lost.outputColorSpace = "srgb-linear";
      lost.shadowMap.enabled = true;
      lost.shadowMap.type = 2;
      lost.clearColor.set(0x123456);
      lost.clearAlpha = 1;
      await start(0);
      // Scene effects keyed on the renderer set these, and set them again on the replacement.
      lost.toneMapping = 0;
      lost.toneMappingExposure = 0.6;
      // The render governor writes resolution straight onto the renderer.
      lost.pixelRatio = 1.5;

      act(() => { lost.onDeviceLost({ api: "WebGPU", message: "Device lost" }); });
      await flush();
      const fresh = await start(1);
      await flush();
      expect(fresh.toneMapping).toBe(4);
      expect(fresh.toneMappingExposure).toBe(1);
      expect(fresh.outputColorSpace).toBe("srgb-linear");
      expect(fresh.shadowMap).toEqual({ enabled: true, type: 2 });
      expect(fresh.clearColor.getHex()).toBe(0x123456);
      expect(fresh.clearAlpha).toBe(1);
      expect(fresh.rawSetPixelRatio).toHaveBeenLastCalledWith(1.5);
      expect(fresh.rawSetSize).toHaveBeenLastCalledWith(800, 600, false);
    });

    it("lets a lost renderer no longer resize the canvas its replacement draws on", async () => {
      render(<NativeCanvas><span>Room geometry</span></NativeCanvas>);
      const lost = await start(0);
      act(() => { lost.onDeviceLost({ api: "WebGPU", message: "Device lost" }); });
      await flush();
      const fresh = await start(1);
      await flush();
      lost.rawSetPixelRatio.mockClear();
      lost.rawSetSize.mockClear();
      // A renderer-keyed effect's cleanup restores what it found on the renderer it captured
      // (InteriorCamera's mount ratio): r186 would rewrite the shared canvas's size.
      lost.setPixelRatio(1);
      lost.setSize(10, 10, false);
      lost.setDrawingBufferSize(10, 10, 1);
      expect(lost.rawSetPixelRatio).not.toHaveBeenCalled();
      expect(lost.rawSetSize).not.toHaveBeenCalled();
      expect(lost.rawSetDrawingBufferSize).not.toHaveBeenCalled();
      fresh.setPixelRatio(1.25);
      expect(fresh.rawSetPixelRatio).toHaveBeenLastCalledWith(1.25);
    });

    it.each(["onDeviceLost", "onError"] as const)(
      "treats a replacement that fails as it starts (%s) as one failed attempt, not a stopped view",
      async (failure) => {
        vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
        try {
          render(<NativeCanvas><span>Room geometry</span></NativeCanvas>);
          const lost = await start(0);
          act(() => { lost.onDeviceLost({ api: "WebGPU", message: "Device lost" }); });
          await flush();
          const failing = renderer(1);
          act(() => {
            if (failure === "onDeviceLost") failing.onDeviceLost({ api: "WebGPU", message: "Lost again while starting" });
            else failing.onError({ message: "Validation failed while starting" });
          });
          // An error, unlike a loss, counts once it has outlasted its grace with nothing drawn.
          if (failure === "onError") await act(async () => { await vi.advanceTimersByTimeAsync(NATIVE_GPU_ERROR_GRACE_MS); });
          await flush();
          expect(screen.queryByRole("alert")).toBeNull();
          expect(screen.getByRole("status").textContent).toContain("Restoring the 3D view");
          expect(screen.getByText("Room geometry")).toBeDefined();
          // The backoff, then the bounded wait for the failed replacement's still-pending init.
          await act(async () => { await vi.advanceTimersByTimeAsync(2_500); });
          await flush();
          const fresh = await start(2);
          await flush();
          expect(fresh.domElement).toBe(lost.domElement);
          expect(fiber.state?.gl).toBe(fresh);
          expect(screen.queryByRole("alert")).toBeNull();
          automaticFrame();
          expect(fresh.rawRender).toHaveBeenCalledOnce();
          expect(screen.queryByRole("status")).toBeNull();
        } finally {
          vi.useRealTimers();
        }
      },
    );

    it("treats a device destroyed by anything but its own release as lost, a reason Three ignores", async () => {
      const devices = stubWebGpuDevices();
      render(<NativeCanvas><span>Room geometry</span></NativeCanvas>);
      await flush();
      await start(0);
      devices[0]?.destroy();
      await flush();
      expect(screen.getByRole("status").textContent).toContain("Restoring the 3D view");
      await flush();
      const fresh = await start(1);
      await flush();
      expect(fiber.state?.gl).toBe(fresh);
      expect(fresh.initializedDevice).toBe(devices[1]);
      expect(native.instances).toHaveLength(2);
      automaticFrame();
      expect(screen.queryByRole("status")).toBeNull();
    });

    it("watches a device Three requested itself, which Three also stops reporting once destroyed", async () => {
      const [threeDevice] = fakeDevices(1);
      native.negotiation.ownDevice = threeDevice ?? null;
      render(<NativeCanvas><span>Room geometry</span></NativeCanvas>);
      await start(0);
      await flush();
      threeDevice?.destroy();
      await flush();
      expect(renderer(1).domElement).toBe(renderer(0).domElement);
    });

    it("takes the graphics away once on ?graphicsReset, so a real phone can be checked without an inspector", async () => {
      vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
      window.history.replaceState({}, "", "/plan?graphicsReset=2");
      try {
        const [first, second] = fakeDevices(2);
        native.negotiation.ownDevice = first ?? null;
        const view = render(<NativeCanvas><span>Room geometry</span></NativeCanvas>);
        await start(0);
        await flush();
        // The replacement Three negotiates gets its own, live device.
        native.negotiation.ownDevice = second ?? null;
        await act(async () => { await vi.advanceTimersByTimeAsync(1_999); });
        expect(first?.destroy).not.toHaveBeenCalled();
        await act(async () => { await vi.advanceTimersByTimeAsync(1); });
        expect(first?.destroy).toHaveBeenCalledOnce();
        await flush();
        const fresh = await start(1);
        await flush();
        expect(fresh.initializedDevice ?? fresh.backend.device).toBe(second);
        expect(fiber.state?.gl).toBe(fresh);
        expect(screen.queryByRole("alert")).toBeNull();
        expect(view.container.querySelector("[data-graphics-recovery]")?.getAttribute("data-graphics-recovery")).toBe("running");
        // Once per view: the restored view is never taken away again.
        await act(async () => { await vi.advanceTimersByTimeAsync(10_000); });
        expect(second?.destroy).not.toHaveBeenCalled();
        expect(native.instances).toHaveLength(2);
      } finally {
        window.history.replaceState({}, "", "/");
        vi.useRealTimers();
      }
    });

    it("does not mistake releasing its own device for a loss", async () => {
      const devices = stubWebGpuDevices();
      const view = render(<NativeCanvas />);
      await flush();
      await start(0);
      view.unmount();
      await flush();
      expect(devices[0]?.destroy).toHaveBeenCalledOnce();
      expect(native.instances).toHaveLength(1);
    });

    it("swaps onto a WebGL2 canvas only once the browser hands the context back, and never loses that shared context", async () => {
      native.negotiation.backend = "webgl2";
      render(<NativeCanvas><span>Room geometry</span></NativeCanvas>);
      const lost = await start(0);
      act(() => { lost.onDeviceLost({ api: "WebGL", message: "Context lost" }); });
      await flush();
      expect(native.instances).toHaveLength(1);
      expect(screen.getByRole("status").textContent).toContain("Restoring the 3D view");
      // Released while the context is lost, when its GL calls are silent no-ops, so its
      // listeners never delete lost objects on the restored context; and without the
      // loseContext() r186 WebGLBackend.dispose() ends with.
      expect(lost.dispose).toHaveBeenCalledOnce();
      expect(lost.backend.extensions?.extensions["WEBGL_lose_context"]).toBeNull();

      act(() => { lost.domElement.dispatchEvent(new Event("webglcontextrestored")); });
      await flush();
      const fresh = renderer(1);
      expect(fresh.domElement).toBe(lost.domElement);
      expect(lost.dispose).toHaveBeenCalledOnce();
      expect(lost.backend.dispose).not.toHaveBeenCalled();
      await start(1);
      await flush();
      expect(fiber.state?.gl).toBe(fresh);
      automaticFrame();
      expect(screen.queryByRole("status")).toBeNull();
    });

    it("remounts a new canvas when a WebGL context never comes back, and the new canvas counts as created", async () => {
      vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
      try {
        native.negotiation.backend = "webgl2";
        const onCreated = vi.fn();
        render(<NativeCanvas onCreated={onCreated}><span>Room geometry</span></NativeCanvas>);
        const lost = await start(0);
        act(() => { lost.onDeviceLost({ api: "WebGL", message: "Context lost" }); });
        await flush();
        await act(async () => { await vi.advanceTimersByTimeAsync(4_000); });
        await flush();
        const remounted = renderer(1);
        expect(remounted.domElement).not.toBe(lost.domElement);
        expect(screen.getByRole("status").textContent).toContain("Restoring the 3D view");
        await start(1);
        await flush();
        automaticFrame();
        expect(screen.queryByRole("status")).toBeNull();
        expect(screen.getByText("Room geometry")).toBeDefined();
        expect(onCreated).toHaveBeenCalledTimes(2);
      } finally {
        vi.useRealTimers();
      }
    });

    it("waits until a backgrounded page is shown again before asking for a device", async () => {
      let visibility: DocumentVisibilityState = "hidden";
      Object.defineProperty(document, "visibilityState", { configurable: true, get: () => visibility });
      try {
        render(<NativeCanvas><span>Room geometry</span></NativeCanvas>);
        const lost = await start(0);
        act(() => { lost.onDeviceLost({ api: "WebGPU", message: "Device lost" }); });
        await flush();
        expect(native.instances).toHaveLength(1);
        visibility = "visible";
        act(() => { document.dispatchEvent(new Event("visibilitychange")); });
        await flush();
        expect(renderer(1).domElement).toBe(lost.domElement);
      } finally {
        Reflect.deleteProperty(document, "visibilityState");
      }
    });

    it("ignores late errors and losses reported by the renderer it already gave up on", async () => {
      render(<NativeCanvas><span>Room geometry</span></NativeCanvas>);
      const lost = await start(0);
      act(() => { lost.onDeviceLost({ api: "WebGPU", message: "Device lost" }); });
      await flush();
      act(() => {
        lost.onError({ message: "A late error from the lost device" });
        lost.onDeviceLost({ api: "WebGPU", message: "Reported again" });
      });
      expect(screen.queryByRole("alert")).toBeNull();
      await start(1);
      await flush();
      act(() => { lost.onDeviceLost({ api: "WebGPU", message: "Reported after the swap" }); });
      await flush();
      expect(native.instances).toHaveLength(2);
      automaticFrame();
      expect(screen.queryByRole("status")).toBeNull();
    });

    it("tells someone whose view stopped for good that their layout is safe, then speaks about starting on a failed retry", async () => {
      vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
      try {
        // The editor during a timeline preview: someone's layout, with no 2D view allowed.
        render(<PlannerWorkContext.Provider value={{ continueIn2d: null }}><NativeCanvas><span>Room geometry</span></NativeCanvas></PlannerWorkContext.Provider>);
        const lost = await start(0);
        act(() => { lost.onDeviceLost({ api: "WebGPU", message: "Device lost" }); });
        await flush();
        await act(() => { renderer(1).reject(new Error("No adapter yet")); return Promise.resolve(); });
        await act(async () => { await vi.advanceTimersByTimeAsync(1_000); });
        await flush();
        expect(renderer(2).domElement).toBe(lost.domElement);
        await act(() => { renderer(2).reject(new Error("No adapter yet")); return Promise.resolve(); });
        await act(async () => { await vi.advanceTimersByTimeAsync(3_000); });
        await flush();
        const remounted = renderer(3);
        expect(remounted.domElement).not.toBe(lost.domElement);
        await act(() => { remounted.reject(new Error("Still no adapter")); return Promise.resolve(); });
        await flush();
        const alert = screen.getByRole("alert");
        expect(alert.textContent).toContain("The 3D view stopped. Your layout is safe");
        expect(alert.textContent).not.toContain("couldn’t start");
        expect(screen.queryByRole("status")).toBeNull();

        fireEvent.click(screen.getByRole("button", { name: "Try 3D again" }));
        await act(() => { renderer(4).reject(new Error("No graphics adapter")); return Promise.resolve(); });
        expect(screen.getByRole("alert").textContent).toContain("The 3D view couldn’t start.");
      } finally {
        vi.useRealTimers();
      }
    });

    it("gives a view whose GPU errors never stop one fresh device, then stops it with the stopped words", async () => {
      vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
      const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
      try {
        render(<PlannerWorkContext.Provider value={{ continueIn2d: null }}><NativeCanvas><span>Room geometry</span></NativeCanvas></PlannerWorkContext.Provider>);
        const failing = await start(0);
        automaticFrame();
        act(() => { failing.onError({ message: "Invalid bind group" }); });
        await act(async () => { await vi.advanceTimersByTimeAsync(NATIVE_GPU_ERROR_GRACE_MS - 1); });
        expect(screen.queryByRole("status")).toBeNull();
        await act(async () => { await vi.advanceTimersByTimeAsync(1); });
        expect(screen.getByRole("status").textContent).toContain("Restoring the 3D view");
        await flush();
        const fresh = renderer(1);
        expect(fresh.domElement).toBe(failing.domElement);
        expect(failing.dispose).toHaveBeenCalledOnce();
        await start(1);
        await flush();
        automaticFrame();
        expect(screen.queryByRole("status")).toBeNull();
        expect(screen.getByText("Room geometry")).toBeDefined();

        // The same errors on a fresh device are the scene's own: another device would not help.
        act(() => { fresh.onError({ message: "Invalid bind group" }); });
        await act(async () => { await vi.advanceTimersByTimeAsync(NATIVE_GPU_ERROR_GRACE_MS); });
        await flush();
        expect(screen.getByRole("alert").textContent).toContain("The 3D view stopped. Your layout is safe");
        expect(native.instances).toHaveLength(2);
        expect(warn).toHaveBeenCalledOnce();
      } finally {
        warn.mockRestore();
        vi.useRealTimers();
      }
    });

    it("keeps the cover over a recovered capture until the new device draws it, and no longer than its bound", async () => {
      vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
      try {
        render(<NativeCanvas frameloop="demand"><span>Room geometry</span></NativeCanvas>);
        const lost = await start(0);
        // The capture was drawn when the device went (the profiling stats report its splats).
        profiling.capturePending.mockReturnValue(true);
        act(() => { lost.onDeviceLost({ api: "WebGPU", message: "Device lost" }); });
        await flush();
        const fresh = await start(1);
        await flush();
        automaticFrame();
        expect(fresh.rawRender).toHaveBeenCalledOnce();
        // The room has drawn, but its capture is still being rebuilt for the new device.
        expect(screen.getByRole("status").textContent).toContain("Restoring the 3D view");
        expect(profiling.capturePending).toHaveBeenLastCalledWith(expect.any(Scene), fresh);
        profiling.capturePending.mockReturnValue(false);
        automaticFrame();
        expect(screen.queryByRole("status")).toBeNull();

        // A capture that cannot come back must not keep the room covered.
        profiling.capturePending.mockReturnValue(true);
        act(() => { fresh.onDeviceLost({ api: "WebGPU", message: "Device lost again" }); });
        await act(async () => { await vi.advanceTimersByTimeAsync(1_000); });
        await flush();
        await start(2);
        await flush();
        automaticFrame();
        expect(screen.getByRole("status").textContent).toContain("Restoring the 3D view");
        fiber.invalidate.mockClear();
        await act(async () => { await vi.advanceTimersByTimeAsync(NATIVE_CAPTURE_RETURN_WAIT_MS); });
        expect(fiber.invalidate).toHaveBeenCalled();
        automaticFrame();
        expect(screen.queryByRole("status")).toBeNull();
      } finally {
        vi.useRealTimers();
      }
    });

    it("keeps the capture and the dark stage for a view lost again while its cover waits for the capture", async () => {
      vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
      try {
        render(<NativeCanvas frameloop="demand"><span>Room geometry</span></NativeCanvas>);
        const lost = await start(0);
        const state = fiber.state;
        if (state === null) throw new Error("No R3F root state");
        // The eye-level walk: a light clear colour behind the capture that fills the view.
        state.scene.background = new Color("#eee9de");
        profiling.capturePending.mockReturnValue(true);
        act(() => { lost.onDeviceLost({ api: "WebGPU", message: "Device lost" }); });
        await flush();
        const fresh = await start(1);
        await flush();
        automaticFrame();
        expect(screen.getByRole("status").textContent).toContain("Restoring the 3D view");
        // The replacement's splat host has let the lost snapshot go: the scene shows no capture now.
        profiling.sceneStats.mockReturnValue(null);
        act(() => { fresh.onDeviceLost({ api: "WebGPU", message: "Device lost again" }); });
        const cover = screen.getByRole("status").closest<HTMLElement>("[data-graphics-cover]");
        expect(cover?.dataset["graphicsCover"]).toBe("dark");
        await act(async () => { await vi.advanceTimersByTimeAsync(1_000); });
        await flush();
        await start(2);
        await flush();
        automaticFrame();
        // Still the captured room it has to bring back.
        expect(screen.getByRole("status").textContent).toContain("Restoring the 3D view");
        profiling.capturePending.mockReturnValue(false);
        automaticFrame();
        expect(screen.queryByRole("status")).toBeNull();
      } finally {
        profiling.sceneStats.mockReturnValue({ splats: 123, sortTimeMs: 4, sortAgeMs: 20, sortBacklog: 1 });
        vi.useRealTimers();
      }
    });

    it("gives a fresh device that breaks on a different error the usual recovery, not the stopped card", async () => {
      vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
      const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
      try {
        render(<NativeCanvas><span>Room geometry</span></NativeCanvas>);
        const failing = await start(0);
        automaticFrame();
        act(() => { failing.onError({ message: "Invalid bind group" }); });
        await act(async () => { await vi.advanceTimersByTimeAsync(NATIVE_GPU_ERROR_GRACE_MS); });
        await flush();
        const fresh = await start(1);
        await flush();
        automaticFrame();
        act(() => { fresh.onError({ message: "Out of memory" }); });
        await act(async () => { await vi.advanceTimersByTimeAsync(NATIVE_GPU_ERROR_GRACE_MS); });
        await flush();
        expect(screen.queryByRole("alert")).toBeNull();
        expect(screen.getByRole("status").textContent).toContain("Restoring the 3D view");
        expect(native.instances).toHaveLength(3);
      } finally {
        warn.mockRestore();
        vi.useRealTimers();
      }
    });

    it("covers a dark hall in its own ground while it restores, not a cream flash", async () => {
      render(<NativeCanvas><span>Room geometry</span></NativeCanvas>);
      const lost = await start(0);
      const state = fiber.state;
      if (state === null) throw new Error("No R3F root state");
      state.scene.background = new Color("#120e0b");
      act(() => { lost.onDeviceLost({ api: "WebGPU", message: "Device lost" }); });
      const cover = screen.getByRole("status").closest<HTMLElement>("[data-graphics-cover]");
      expect(cover?.dataset["graphicsCover"]).toBe("dark");
      expect(new Color(cover?.style.backgroundColor ?? "").getHexString()).toBe("120e0b");
    });

    it("covers a captured room in the dark stage, though the colour behind its splats is light", async () => {
      // The eye-level walk: the capture fills the view over the light shell's clear colour.
      render(<NativeCanvas><span>Room geometry</span></NativeCanvas>);
      const lost = await start(0);
      const state = fiber.state;
      if (state === null) throw new Error("No R3F root state");
      state.scene.background = new Color("#eee9de");
      profiling.sceneStats.mockReturnValueOnce({ splats: 6_030_980, sortTimeMs: null, sortAgeMs: null, sortBacklog: null });
      act(() => { lost.onDeviceLost({ api: "WebGPU", message: "Device lost" }); });
      const cover = screen.getByRole("status").closest<HTMLElement>("[data-graphics-cover]");
      expect(cover?.dataset["graphicsCover"]).toBe("dark");
      expect(new Color(cover?.style.backgroundColor ?? "").getHexString()).toBe("120e0b");
    });

    it("covers a light room with no capture in its own ground", async () => {
      render(<NativeCanvas><span>Room geometry</span></NativeCanvas>);
      const lost = await start(0);
      const state = fiber.state;
      if (state === null) throw new Error("No R3F root state");
      state.scene.background = new Color("#eee9de");
      profiling.sceneStats.mockReturnValueOnce(null);
      act(() => { lost.onDeviceLost({ api: "WebGPU", message: "Device lost" }); });
      const cover = screen.getByRole("status").closest<HTMLElement>("[data-graphics-cover]");
      expect(cover?.dataset["graphicsCover"]).toBe("light");
      expect(new Color(cover?.style.backgroundColor ?? "").getHexString()).toBe("eee9de");
    });

    it("stops after repeated resets and tells a visitor on a walk only what is true for them", async () => {
      // A walk has no 2D view of its own, whatever page it sits in.
      render(<PlannerWorkContext.Provider value={{ continueIn2d: vi.fn() }}>
        <NativeCanvas surface="walk"><span>Room geometry</span></NativeCanvas>
      </PlannerWorkContext.Provider>);
      for (let loss = 0; loss < 2; loss++) {
        const current = await start(loss);
        act(() => { current.onDeviceLost({ api: "WebGPU", message: "Device lost" }); });
        await flush();
      }
      const third = await start(2);
      await flush();
      act(() => { third.onDeviceLost({ api: "WebGPU", message: "Device lost" }); });
      await flush();
      expect(native.instances).toHaveLength(3);
      const alert = screen.getByRole("alert");
      expect(alert.textContent).toContain("The 3D view stopped.");
      expect(alert.textContent).not.toContain("layout");
      expect(alert.textContent).not.toContain("2D");
      expect(screen.queryByRole("button", { name: "Continue in 2D" })).toBeNull();
      expect(screen.getByRole("button", { name: "Try 3D again" })).toBeDefined();
    });
  });

  describe("when the view cannot draw", () => {
    it("offers the planner's own 2D view of this layout, not a demonstration plan", async () => {
      const continueIn2d = vi.fn();
      render(<PlannerWorkContext.Provider value={{ continueIn2d }}>
        <NativeCanvas><span>Room geometry</span></NativeCanvas>
      </PlannerWorkContext.Provider>);
      await act(() => { renderer(0).reject(new Error("No graphics adapter")); return Promise.resolve(); });
      expect(screen.getByRole("alert").textContent).toContain("continue in 2D");
      expect(screen.queryByRole("link")).toBeNull();
      fireEvent.click(screen.getByRole("button", { name: "Continue in 2D" }));
      expect(continueIn2d).toHaveBeenCalledOnce();
    });

    it("promises no 2D view where the page has none", async () => {
      render(<NativeCanvas><span>Room geometry</span></NativeCanvas>);
      await act(() => { renderer(0).reject(new Error("No graphics adapter")); return Promise.resolve(); });
      expect(screen.getByRole("alert").textContent).not.toContain("2D");
      expect(screen.queryByRole("button", { name: "Continue in 2D" })).toBeNull();
      expect(screen.queryByRole("link")).toBeNull();
      expect(screen.getByRole("button", { name: "Try 3D again" })).toBeDefined();
    });

    it("tells the page each time the view lands on its card, so nothing still says it is opening over it", async () => {
      const onUnavailable = vi.fn();
      render(<NativeCanvas onUnavailable={onUnavailable}><span>Room geometry</span></NativeCanvas>);
      await act(() => { renderer(0).reject(new Error("No graphics adapter")); return Promise.resolve(); });
      expect(onUnavailable).toHaveBeenCalledOnce();
      fireEvent.click(screen.getByRole("button", { name: "Try 3D again" }));
      const retried = await start(1);
      expect(onUnavailable).toHaveBeenCalledOnce();
      automaticFrame();
      act(() => { retried.onError("Native splat sorting failed: resident worker crashed"); });
      expect(onUnavailable).toHaveBeenCalledTimes(2);
    });

    it("makes no promise about a layout on a page that holds none", async () => {
      render(<NativeCanvas><span>Room geometry</span></NativeCanvas>);
      const lost = await start(0);
      act(() => { lost.onDeviceLost({ api: "WebGPU", message: "Device lost" }); });
      const cover = screen.getByRole("status").closest("[data-graphics-cover]");
      expect(cover?.textContent).toContain("Restoring the 3D view");
      expect(cover?.textContent).not.toContain("layout");
    });
  });

  it("says a view that never started couldn't start", async () => {
    render(<NativeCanvas><span>Room geometry</span></NativeCanvas>);
    await act(() => { native.instances[0]?.reject(new Error("No graphics adapter")); return Promise.resolve(); });
    const alert = screen.getByRole("alert");
    expect(alert.textContent).toContain("The 3D view couldn’t start.");
    expect(alert.textContent).not.toContain("Your layout is safe");
  });

  it("recovers from a synchronous main-frame failure without drawing the failed or stale renderer again", async () => {
    const view = render(<NativeCanvas><span>Room geometry</span></NativeCanvas>);
    const first = native.instances[0];
    if (first === undefined) throw new Error("No native renderer was created");
    await act(() => { first.resolve(); return Promise.resolve(); });
    const scene = new Scene();
    const camera = new PerspectiveCamera();
    first.rawRender.mockImplementation(() => { throw new Error("GPU queue rejected the frame"); });

    act(() => {
      expect(() => { first.render(scene, camera); }).not.toThrow();
      // A second scheduled frame can run before React removes the Canvas.
      expect(() => { first.render(scene, camera); }).not.toThrow();
    });
    expect(first.rawRender).toHaveBeenCalledExactlyOnceWith(scene, camera);
    expect(screen.getByRole("alert").textContent).toContain("GPU queue rejected the frame");
    expect(first.dispose).toHaveBeenCalledOnce();

    fireEvent.click(screen.getByRole("button", { name: "Try 3D again" }));
    const second = native.instances[1];
    if (second === undefined) throw new Error("Retry did not create a native renderer");
    await act(() => { second.resolve(); return Promise.resolve(); });
    act(() => {
      second.render(scene, camera);
      first.render(scene, camera);
      first.onError({ message: "A late error from the old renderer" });
    });
    expect(second.rawRender).toHaveBeenCalledExactlyOnceWith(scene, camera);
    expect(first.rawRender).toHaveBeenCalledOnce();
    expect(first.dispose).toHaveBeenCalledOnce();
    first.renderTarget = new RenderTarget(1, 1);
    expect(() => { first.render(scene, camera); }).toThrow("no longer available for capture");
    first.renderTarget.dispose();
    first.renderTarget = null;
    expect(screen.queryByRole("alert")).toBeNull();
    expect(screen.getByText("Room geometry")).toBeDefined();
    view.unmount();
    await act(() => Promise.resolve());
    expect(second.dispose).toHaveBeenCalledOnce();
  });

  it("propagates offscreen draw failures so capture cannot report a successful blank image", async () => {
    render(<NativeCanvas><span>Room geometry</span></NativeCanvas>);
    const instance = native.instances[0];
    if (instance === undefined) throw new Error("No native renderer was created");
    await act(() => { instance.resolve(); return Promise.resolve(); });
    const scene = new Scene();
    const camera = new PerspectiveCamera();
    const cause = new Error("Offscreen frame could not be rendered");
    instance.renderTarget = new RenderTarget(1, 1);
    instance.rawRender.mockImplementationOnce(() => { throw cause; });

    expect(() => { instance.render(scene, camera); }).toThrow(cause);
    expect(instance.dispose).not.toHaveBeenCalled();
    expect(screen.queryByRole("alert")).toBeNull();
    instance.renderTarget.dispose();
    instance.renderTarget = null;
    instance.render(scene, camera);
    expect(instance.rawRender).toHaveBeenCalledTimes(2);
  });

  it("does not resurrect a view removed while native initialization was pending", async () => {
    const onCreated = vi.fn();
    const view = render(<NativeCanvas onCreated={onCreated}><span>Room geometry</span></NativeCanvas>);
    const instance = native.instances[0];
    view.unmount();
    await act(() => { instance?.resolve(); return Promise.resolve(); });
    expect(instance?.dispose).toHaveBeenCalledOnce();
    expect(onCreated).not.toHaveBeenCalled();
  });

  it("survives StrictMode's effect rehearsal with one initialization and one final disposal", async () => {
    const view = render(<StrictMode><NativeCanvas><span>Room geometry</span></NativeCanvas></StrictMode>);
    const instance = native.instances[0];
    await act(() => { instance?.resolve(); return Promise.resolve(); });
    expect(instance?.init).toHaveBeenCalledOnce();
    expect(instance?.dispose).not.toHaveBeenCalled();
    expect(screen.getByText("Room geometry")).toBeDefined();
    expect(fiber.frames.size).toBe(1);
    automaticFrame();
    expect(instance?.rawRender).toHaveBeenCalledOnce();
    expect(gpuCompletion.tickets).toHaveLength(1);
    view.unmount();
    await act(() => Promise.resolve());
    expect(instance?.dispose).toHaveBeenCalledOnce();
    expect(gpuCompletion.tickets[0]?.signal.aborted).toBe(true);
    expect(fiber.frames.size).toBe(0);
  });
});
