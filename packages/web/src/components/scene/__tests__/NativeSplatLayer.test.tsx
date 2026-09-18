import { cleanup, render, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { BufferAttribute, BufferGeometry, PerspectiveCamera, Scene } from "three";
import type { NativeSourceRegistration } from "../../../lib/native-splat-scene.js";

const state = vi.hoisted(() => ({
  scene: {} as Scene,
  camera: {} as PerspectiveCamera,
  gl: { isWebGPURenderer: true },
  invalidate: vi.fn(),
}));
const runtime = vi.hoisted(() => ({
  attach: vi.fn(() => vi.fn()), configure: vi.fn(), frame: vi.fn(), firstFrame: vi.fn(() => vi.fn()),
  registration: null as NativeSourceRegistration | null,
  setGeometry: vi.fn(), dispose: vi.fn(),
}));
const loader = vi.hoisted(() => ({ load: vi.fn<(url: string, options: { signal: AbortSignal }) => Promise<BufferGeometry>>() }));
vi.mock("@react-three/fiber", () => ({
  useThree: (selector: (value: typeof state) => unknown) => selector(state),
  useFrame: vi.fn(),
}));
vi.mock("../../../lib/native-splat-scene.js", () => ({ nativeSplatScene: () => ({
  ...runtime,
  register: (registration: NativeSourceRegistration) => {
    runtime.registration = registration;
    return { setGeometry: runtime.setGeometry, dispose: runtime.dispose };
  },
}) }));
vi.mock("../../../lib/native-splat-loader.js", () => ({ loadNativeSplatGeometry: loader.load }));

import { NativeSplatLayer } from "../NativeSplatLayer.js";

function geometry(): BufferGeometry {
  const result = new BufferGeometry();
  result.setAttribute("position", new BufferAttribute(new Float32Array([1, 2, 3]), 3));
  result.computeBoundingBox();
  return result;
}

beforeEach(() => {
  vi.clearAllMocks();
  state.scene = new Scene(); state.camera = new PerspectiveCamera(); runtime.registration = null;
  loader.load.mockImplementation(() => new Promise<BufferGeometry>(() => undefined));
  vi.spyOn(console, "error").mockImplementation(() => undefined);
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

describe("native splat source boundary", () => {
  it("reports decoded count/bounds and registers the source with the shared native host", async () => {
    const loaded = geometry(); loader.load.mockResolvedValue(loaded);
    const onLoad = vi.fn();
    const { unmount } = render(<NativeSplatLayer url="/room.sog" onLoad={onLoad} residencyGroup="detail" />);
    await waitFor(() => { expect(onLoad).toHaveBeenCalledOnce(); });
    expect(onLoad).toHaveBeenCalledWith({ url: "/room.sog", splatCount: 1, localBounds: { min: [1, 2, 3], max: [1, 2, 3] } });
    expect(runtime.setGeometry).toHaveBeenCalledWith(loaded);
    expect(runtime.registration?.residencyGroup()).toBe("detail");
    expect(runtime.attach).toHaveBeenCalledWith(state.gl, state.camera, state.invalidate);
    unmount(); expect(runtime.dispose).toHaveBeenCalledOnce();
  });

  it("aborts work on removal, disposes late results and never reports stale success", async () => {
    let resolve: ((value: BufferGeometry) => void) | undefined;
    loader.load.mockImplementation(() => new Promise((done) => { resolve = done; }));
    const onLoad = vi.fn();
    const { unmount } = render(<NativeSplatLayer url="/room.sog" onLoad={onLoad} includeRendererHost={false} />);
    await waitFor(() => { expect(loader.load).toHaveBeenCalledOnce(); });
    const signal = loader.load.mock.calls[0]?.[1].signal;
    unmount(); expect(signal?.aborted).toBe(true);
    const loaded = geometry(), dispose = vi.spyOn(loaded, "dispose");
    resolve?.(loaded);
    await waitFor(() => { expect(dispose).toHaveBeenCalledOnce(); });
    expect(onLoad).not.toHaveBeenCalled();
    expect(runtime.attach).not.toHaveBeenCalled();
  });

  it("keeps a source loaded when callback/profile identities change and applies the live SH cap", async () => {
    loader.load.mockResolvedValue(geometry());
    const first = vi.fn(), next = vi.fn();
    const profile = { minSortIntervalMs: 0, maxStdDev: 2, lod: false, lodSplatCount: 1000, maxSh: 3 };
    const { rerender } = render(<NativeSplatLayer url="/room.sog" runtime={profile} onLoad={first} />);
    await waitFor(() => { expect(first).toHaveBeenCalledOnce(); });
    rerender(<NativeSplatLayer url="/room.sog" runtime={{ ...profile, maxSh: 1 }} onLoad={next} />);
    expect(loader.load).toHaveBeenCalledOnce();
    expect(runtime.registration?.maxSh()).toBe(1);
    expect(next).not.toHaveBeenCalled();
  });

  it("reports a real decode error without a successful load", async () => {
    const error = new Error("Malformed SOG"); loader.load.mockRejectedValue(error);
    const onError = vi.fn(), onLoad = vi.fn();
    render(<NativeSplatLayer url="/room.sog" onError={onError} onLoad={onLoad} />);
    await waitFor(() => { expect(onError).toHaveBeenCalledWith({ url: "/room.sog", error }); });
    expect(onLoad).not.toHaveBeenCalled();
  });
});
