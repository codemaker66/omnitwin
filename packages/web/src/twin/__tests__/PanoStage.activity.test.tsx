import { act, cleanup, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PerspectiveCamera, Texture } from "three";
import { PanoStage } from "../PanoStage.js";
import { __resetEquirectRegistryForTests } from "../useEquirectTexture.js";

const bridge = vi.hoisted(() => ({ state: vi.fn<() => unknown>() }));
vi.mock("@react-three/fiber", () => ({
  useFrame: (): void => undefined,
  useThree: (select: (state: unknown) => unknown): unknown => select(bridge.state()),
}));

class MockImage {
  static instances: MockImage[] = [];
  crossOrigin: string | null = null;
  onload: (() => void) | null = null;
  onerror: (() => void) | null = null;
  src = "";
  constructor() { MockImage.instances.push(this); }
}

const uploads = vi.fn<(texture: Texture) => void>();
const idle = new Map<number, IdleRequestCallback>();
let idleId = 0;
const props = {
  nodeId: "scan_000", assetBase: "/twin/test", imagery: "equirect" as const,
  position: [0, 0, 0] as const, quaternion: [0, 0, 0, 1] as const, opacity: 1,
};

async function imageResult(lod: number, success: boolean): Promise<void> {
  await act(async () => {
    for (const image of MockImage.instances.filter((entry) => entry.src.endsWith(`_${String(lod)}.webp`))) {
      if (success) image.onload?.(); else image.onerror?.();
    }
    await Promise.resolve();
  });
}

function runIdle(): void {
  act(() => {
    const callbacks = [...idle.values()];
    idle.clear();
    for (const callback of callbacks) callback({ didTimeout: false, timeRemaining: () => 50 });
  });
}

beforeEach(() => {
  __resetEquirectRegistryForTests();
  MockImage.instances = [];
  idle.clear();
  uploads.mockReset();
  bridge.state.mockReturnValue({
    invalidate: vi.fn(), camera: new PerspectiveCamera(75),
    gl: { initTexture: uploads, capabilities: { maxTextureSize: 4096 } },
  });
  vi.stubGlobal("Image", MockImage);
  vi.stubGlobal("createImageBitmap", undefined);
  vi.stubGlobal("requestIdleCallback", (callback: IdleRequestCallback) => {
    const id = ++idleId; idle.set(id, callback); return id;
  });
  vi.stubGlobal("cancelIdleCallback", (id: number) => { idle.delete(id); });
});

afterEach(() => {
  cleanup();
  __resetEquirectRegistryForTests();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("PanoStage texture completion", () => {
  it("keeps working after a preview GPU failure while the equirect base is in flight", async () => {
    const onFailure = vi.fn();
    const onTier = vi.fn();
    uploads.mockImplementationOnce(() => { throw new Error("Preview upload failed"); });
    render(<PanoStage {...props} onFailure={onFailure} onTier={onTier} />);
    await imageResult(512, true);
    expect(onFailure).not.toHaveBeenCalled();
    await imageResult(4096, true);
    expect(onFailure).not.toHaveBeenCalled();
    runIdle();
    expect(onTier).toHaveBeenCalledWith("scan_000", "base");
    expect(onFailure).not.toHaveBeenCalled();
  });

  it("keeps working after a cube preview upload failure and reports the successful base", async () => {
    const context = { translate: vi.fn(), rotate: vi.fn(), scale: vi.fn(), drawImage: vi.fn() };
    const getContext: unknown = () => context;
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockImplementation(
      getContext as typeof HTMLCanvasElement.prototype.getContext,
    );
    const onFailure = vi.fn();
    const onTier = vi.fn();
    uploads.mockImplementationOnce(() => { throw new Error("Preview upload failed"); });
    render(<PanoStage {...props} imagery="cube-faces" onFailure={onFailure} onTier={onTier} />);
    await imageResult(256, true);
    expect(onFailure).not.toHaveBeenCalled();
    await imageResult(1024, true);
    expect(onTier).toHaveBeenCalledWith("scan_000", "base");
    expect(onFailure).not.toHaveBeenCalled();
  });

  it("reports base only after its scheduled GPU upload and retains preview until then", async () => {
    const onTier = vi.fn();
    const dispose = vi.spyOn(Texture.prototype, "dispose");
    render(<PanoStage {...props} onTier={onTier} />);
    await imageResult(512, true);
    const preview = uploads.mock.calls[0]?.[0];
    expect(onTier).toHaveBeenCalledWith("scan_000", "preview");
    await imageResult(4096, true);
    expect(onTier).not.toHaveBeenCalledWith("scan_000", "base");
    expect(dispose.mock.contexts).not.toContain(preview);
    runIdle();
    expect(onTier).toHaveBeenCalledWith("scan_000", "base");
    expect(uploads).toHaveBeenCalledTimes(2);
    expect(dispose.mock.contexts).toContain(preview);
  });

  it("reports a failed base with a retained preview and permits a real retry", async () => {
    const onFailure = vi.fn();
    const onTier = vi.fn();
    const dispose = vi.spyOn(Texture.prototype, "dispose");
    const { rerender } = render(<PanoStage {...props} onFailure={onFailure} onTier={onTier} />);
    await imageResult(512, true);
    const preview = uploads.mock.calls[0]?.[0];
    await imageResult(4096, false);
    expect(onFailure).toHaveBeenCalledWith("scan_000", true);
    expect(dispose.mock.contexts).not.toContain(preview);
    rerender(<PanoStage {...props} onFailure={onFailure} onTier={onTier} retryKey={1} />);
    await imageResult(4096, true);
    runIdle();
    expect(onTier).toHaveBeenCalledWith("scan_000", "base");
  });

  it("reports total image failure but does not label a movement preview hold as failure", async () => {
    const onFailure = vi.fn();
    const { rerender } = render(<PanoStage {...props} onFailure={onFailure} hopping />);
    await imageResult(512, false);
    expect(onFailure).not.toHaveBeenCalled();
    rerender(<PanoStage {...props} onFailure={onFailure} hopping={false} />);
    await imageResult(512, false);
    await imageResult(4096, false);
    expect(onFailure).toHaveBeenCalledWith("scan_000", false);
  });

  it("reports failure when an unusable GPU preview is followed by a missing base", async () => {
    const onFailure = vi.fn();
    uploads.mockImplementationOnce(() => { throw new Error("Preview upload failed"); });
    render(<PanoStage {...props} onFailure={onFailure} />);
    await imageResult(512, true);
    expect(onFailure).not.toHaveBeenCalled();
    await imageResult(4096, false);
    expect(onFailure).toHaveBeenCalledWith("scan_000", false);
  });

  it("keeps its displayed preview on GPU failure and retries the actual upload", async () => {
    const onFailure = vi.fn();
    const onTier = vi.fn();
    const dispose = vi.spyOn(Texture.prototype, "dispose");
    const { rerender } = render(<PanoStage {...props} onFailure={onFailure} onTier={onTier} />);
    await imageResult(512, true);
    const preview = uploads.mock.calls[0]?.[0];
    await imageResult(4096, true);
    uploads.mockImplementationOnce(() => { throw new Error("GPU upload failed"); });
    runIdle();
    expect(onTier).not.toHaveBeenCalledWith("scan_000", "base");
    expect(onFailure).toHaveBeenCalledWith("scan_000", true);
    expect(dispose.mock.contexts).not.toContain(preview);
    rerender(<PanoStage {...props} onFailure={onFailure} onTier={onTier} retryKey={1} />);
    runIdle();
    expect(onTier).toHaveBeenCalledWith("scan_000", "base");
  });

  it("cancels a queued upload and suppresses late success after unmount", async () => {
    const onTier = vi.fn();
    const { unmount } = render(<PanoStage {...props} onTier={onTier} />);
    await imageResult(512, true);
    await imageResult(4096, true);
    const queued = [...idle.values()];
    unmount();
    act(() => { for (const callback of queued) callback({ didTimeout: false, timeRemaining: () => 50 }); });
    expect(onTier).not.toHaveBeenCalledWith("scan_000", "base");
    expect(uploads).toHaveBeenCalledTimes(1);
  });
});
