import { Color, Group, RenderTarget, Scene } from "three";
import { WebGPURenderer } from "three/webgpu";
import { afterEach, describe, expect, it, vi } from "vitest";
import { captureOrthographic, copyNativeCapturePixels } from "../ortho-capture.js";
import { registerNativeSceneRenderer } from "../native-renderer.js";

function deferred<T>(): { promise: Promise<T>; resolve: (value: T) => void } {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((yes) => { resolve = yes; });
  return { promise, resolve };
}

function captureFixture() {
  const scene = new Scene();
  const background = new Color("#fff0dd");
  scene.background = background;
  const labels = new Group();
  labels.name = "diagram-labels";
  labels.visible = false;
  scene.add(labels);
  const previousTarget = new RenderTarget(10, 10);
  const renderer = Object.assign(new WebGPURenderer(), {
    backend: { isWebGPUBackend: true },
    getRenderTarget: () => previousTarget,
    getActiveCubeFace: () => 2,
    getActiveMipmapLevel: () => 1,
    setRenderTarget: vi.fn(),
    render: vi.fn((_scene: Scene) => undefined),
    readRenderTargetPixelsAsync: vi.fn(() => Promise.resolve(new Uint8Array(264))),
    xr: { enabled: true }, autoClear: false,
  });
  const unregister = registerNativeSceneRenderer(scene, renderer);
  const image: ImageData = { data: new Uint8ClampedArray(16), width: 2, height: 2, colorSpace: "srgb" };
  const putImageData = vi.fn();
  const context: Pick<CanvasRenderingContext2D, "createImageData" | "putImageData"> = {
    createImageData: () => image, putImageData,
  };
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(context as CanvasRenderingContext2D);
  vi.spyOn(HTMLCanvasElement.prototype, "toDataURL").mockReturnValue("data:image/png;base64,capture");
  return { scene, background, labels, previousTarget, renderer, unregister, putImageData };
}

afterEach(() => { vi.restoreAllMocks(); });

describe("native orthographic capture", () => {
  it("restores the live framebuffer and scene before awaiting GPU readback", async () => {
    const fixture = captureFixture();
    const pending = deferred<Uint8Array>();
    fixture.renderer.readRenderTargetPixelsAsync.mockReturnValue(pending.promise);
    fixture.renderer.render.mockImplementation((scene) => {
      expect(scene).toBe(fixture.scene);
      expect(fixture.labels.visible).toBe(true);
      expect(fixture.renderer.xr.enabled).toBe(false);
      expect(fixture.renderer.autoClear).toBe(true);
    });
    const dispose = vi.spyOn(RenderTarget.prototype, "dispose");
    const capture = captureOrthographic(fixture.scene, 20, 30, { width: 2, height: 2 });
    expect(fixture.labels.visible).toBe(false);
    expect(fixture.scene.background).toBe(fixture.background);
    expect(fixture.renderer.xr.enabled).toBe(true);
    expect(fixture.renderer.autoClear).toBe(false);
    expect(fixture.renderer.setRenderTarget).toHaveBeenLastCalledWith(fixture.previousTarget, 2, 1);
    expect(dispose).not.toHaveBeenCalled();
    pending.resolve(new Uint8Array(264));
    expect(await capture).toBe("data:image/png;base64,capture");
    expect(dispose).toHaveBeenCalledOnce();
    expect(fixture.putImageData).toHaveBeenCalledOnce();
    fixture.unregister();
  });

  it("restores labels and renderer state and disposes target after a rendering failure", async () => {
    const fixture = captureFixture();
    fixture.renderer.render.mockImplementation(() => { throw new Error("GPU draw failed"); });
    const dispose = vi.spyOn(RenderTarget.prototype, "dispose");
    expect(await captureOrthographic(fixture.scene, 20, 30, { width: 2, height: 2 })).toBeNull();
    expect(fixture.labels.visible).toBe(false);
    expect(fixture.scene.background).toBe(fixture.background);
    expect(fixture.renderer.autoClear).toBe(false);
    expect(fixture.renderer.xr.enabled).toBe(true);
    expect(fixture.renderer.setRenderTarget).toHaveBeenLastCalledWith(fixture.previousTarget, 2, 1);
    expect(dispose).toHaveBeenCalledOnce();
    fixture.unregister();
  });

  it("returns no image when the live native renderer is unavailable", async () => {
    expect(await captureOrthographic(new Scene(), 20, 30)).toBeNull();
  });

  it("normalizes WebGPU and WebGL readback row origins", () => {
    const data = new Uint8Array([10, 0, 0, 255, 20, 0, 0, 255]);
    const output = new Uint8ClampedArray(8);
    copyNativeCapturePixels(data, output, 1, 2, false);
    expect([...output]).toEqual([...data]);
    copyNativeCapturePixels(data, output, 1, 2, true);
    expect([...output]).toEqual([20, 0, 0, 255, 10, 0, 0, 255]);
  });

  it("removes WebGPU's 256-byte row padding without copying it into the image", () => {
    const data = new Uint8Array(260).fill(99);
    data.set([10, 20, 30, 255], 0);
    data.set([40, 50, 60, 255], 256);
    const output = new Uint8ClampedArray(8);
    copyNativeCapturePixels(data, output, 1, 2, false, 256);
    expect([...output]).toEqual([10, 20, 30, 255, 40, 50, 60, 255]);
  });
});
