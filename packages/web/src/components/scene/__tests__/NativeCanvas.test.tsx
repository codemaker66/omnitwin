import { StrictMode, type ReactNode } from "react";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PerspectiveCamera, RenderTarget, Scene, type Camera, type Object3D } from "three";
import { useFrame } from "@react-three/fiber";
import type { NativeGpuWorkResult } from "../../../lib/native-gpu-completion.js";

interface FiberState {
  readonly gl: object;
  readonly scene: Scene;
  camera: Camera;
  invalidate(): void;
  get(): FiberState;
}

const fiber = vi.hoisted(() => ({
  state: null as FiberState | null,
  invalidate: vi.fn(),
  frames: new Set<{ callback: (state: FiberState) => void; priority: number }>(),
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
  class Renderer {
    readonly domElement: HTMLCanvasElement;
    readonly backend: {
      isWebGPUBackend: boolean;
      parameters: { canvas: HTMLCanvasElement; device?: object };
      dispose: ReturnType<typeof vi.fn>;
    };
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
      return this.pending;
    });
    readonly pending: Promise<void>;
    resolve = (): void => { throw new Error("Not initialized"); };
    reject = (_cause: Error): void => { throw new Error("Not initialized"); };
    onDeviceLost = (_event: { message: string }): void => undefined;
    onError = (_event: { message: string }): void => undefined;
    constructor(options: { canvas: HTMLCanvasElement }) {
      this.domElement = options.canvas;
      // Match r186 Backend: it copies the options before async initialization.
      this.backend = {
        isWebGPUBackend: true, parameters: { ...options }, dispose: vi.fn(() => Promise.resolve()),
      };
      this.pending = new Promise<void>((resolve, reject) => { this.resolve = resolve; this.reject = reject; });
      instances.push(this);
    }
  }
  return { instances, Renderer };
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
          get: () => {
            if (state.current === null) throw new Error("Missing current R3F state");
            return state.current;
          },
        };
        fiber.state = state.current;
        onCreated(state.current);
      }, [gl, onCreated]);
      return <div data-testid="fiber-canvas" data-frameloop={frameloop}>{children}</div>;
    },
  };
});

import { NativeCanvas } from "../NativeCanvas.js";
import { isNativeCanvasRender } from "../../../lib/native-renderer.js";

beforeEach(() => {
  native.instances.length = 0;
  fiber.frames.clear();
  fiber.state = null;
  fiber.invalidate.mockReset();
  gpuCompletion.tickets.length = 0;
  gpuCompletion.create.mockClear();
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

function automaticFrame(): void {
  const state = fiber.state;
  if (state === null) throw new Error("No R3F root state");
  act(() => {
    for (const subscription of [...fiber.frames].sort((a, b) => a.priority - b.priority)) subscription.callback(state);
  });
}

describe("NativeCanvas", () => {
  it.each([
    [134_217_728, 268_435_456, 134_217_728, 268_435_456],
    [536_870_912, 1_073_741_824, 268_435_456, 536_870_912],
  ])("initializes with the negotiated device at supported limits %i/%i", async (storage, buffer, requestedStorage, requestedBuffer) => {
    const device = { destroy: vi.fn() };
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

  it("releases an initialized device when the backend is lost", async () => {
    render(<NativeCanvas><span>Room geometry</span></NativeCanvas>);
    const instance = native.instances[0];
    await act(() => { instance?.resolve(); return Promise.resolve(); });
    act(() => { instance?.onDeviceLost({ message: "Device lost" }); });
    expect(screen.getByRole("alert")).toBeDefined();
    expect(instance?.dispose).toHaveBeenCalledOnce();
    instance?.render(new Scene(), new PerspectiveCamera());
    expect(instance?.rawRender).not.toHaveBeenCalled();
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
