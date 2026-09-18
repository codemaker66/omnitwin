import { PerspectiveCamera, RenderTarget, Scene, Vector2 } from "three";
import { WebGPURenderer } from "three/webgpu";
import { afterEach, describe, expect, it, vi } from "vitest";
import { captureNativeCurrentView } from "../native-current-view-capture.js";
import { registerNativeSceneRenderer } from "../native-renderer.js";

const ROW_ONE = [10, 20, 30, 255, 40, 50, 60, 255];
const ROW_TWO = [70, 80, 90, 255, 100, 110, 120, 255];

function captureFixture(webgl = false) {
  const scene = new Scene();
  const camera = new PerspectiveCamera(70, 1, 0.1, 100);
  camera.position.set(3, 2, 5);
  camera.lookAt(0, 2, 0);
  const previousTarget = new RenderTarget(10, 10);
  const pixels = new Uint8Array(webgl ? 16 : 264);
  pixels.set(ROW_ONE);
  pixels.set(ROW_TWO, webgl ? 8 : 256);
  const renderer = Object.assign(new WebGPURenderer(), {
    backend: { isWebGLBackend: webgl },
    getDrawingBufferSize: (target: Vector2) => target.set(2, 2),
    getRenderTarget: () => previousTarget,
    getActiveCubeFace: () => 2,
    getActiveMipmapLevel: () => 1,
    setRenderTarget: vi.fn(),
    render: vi.fn((_scene: Scene, _camera: PerspectiveCamera) => undefined),
    readRenderTargetPixelsAsync: vi.fn(() => Promise.resolve(pixels)),
    xr: { enabled: true }, autoClear: false,
  });
  const unregister = registerNativeSceneRenderer(scene, renderer);
  const image: ImageData = { data: new Uint8ClampedArray(16), width: 2, height: 2, colorSpace: "srgb" };
  const putImageData = vi.fn();
  const context: Pick<CanvasRenderingContext2D, "createImageData" | "putImageData"> = {
    createImageData: () => image, putImageData,
  };
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(context as CanvasRenderingContext2D);
  const encode = vi.spyOn(HTMLCanvasElement.prototype, "toDataURL").mockReturnValue("data:image/jpeg;base64,/9j/2Q==");
  return { scene, camera, previousTarget, renderer, pixels, unregister, image, putImageData, encode };
}

afterEach(() => { vi.restoreAllMocks(); });

describe("native current-view poster capture", () => {
  it.each([false, true])("preserves the live camera and actual buffer dimensions with WebGL=%s", async (webgl) => {
    const fixture = captureFixture(webgl);
    const pose = fixture.camera.matrixWorld.clone();
    const dispose = vi.spyOn(RenderTarget.prototype, "dispose");
    fixture.renderer.render.mockImplementation((scene, camera) => {
      expect(scene).toBe(fixture.scene);
      expect(camera).toBe(fixture.camera);
      expect(fixture.renderer.autoClear).toBe(true);
      expect(fixture.renderer.xr.enabled).toBe(false);
    });
    expect(await captureNativeCurrentView(fixture.scene, fixture.camera)).toEqual({
      width: 2, height: 2, dataUrl: "data:image/jpeg;base64,/9j/2Q==",
    });
    expect(fixture.camera.matrixWorld.equals(pose)).toBe(true);
    expect([...fixture.image.data]).toEqual(webgl ? [...ROW_TWO, ...ROW_ONE] : [...ROW_ONE, ...ROW_TWO]);
    expect(fixture.renderer.setRenderTarget).toHaveBeenLastCalledWith(fixture.previousTarget, 2, 1);
    expect(fixture.renderer.autoClear).toBe(false);
    expect(fixture.renderer.xr.enabled).toBe(true);
    expect(fixture.encode).toHaveBeenCalledWith("image/jpeg", 0.86);
    expect(dispose).toHaveBeenCalledOnce();
    fixture.unregister();
  });

  it("restores live render state before asynchronous readback completes", async () => {
    const fixture = captureFixture();
    let finish!: (pixels: Uint8Array) => void;
    fixture.renderer.readRenderTargetPixelsAsync.mockReturnValue(new Promise((resolve) => { finish = resolve; }));
    const dispose = vi.spyOn(RenderTarget.prototype, "dispose");
    const pending = captureNativeCurrentView(fixture.scene, fixture.camera);
    expect(fixture.renderer.setRenderTarget).toHaveBeenLastCalledWith(fixture.previousTarget, 2, 1);
    expect(fixture.renderer.autoClear).toBe(false);
    expect(fixture.renderer.xr.enabled).toBe(true);
    expect(dispose).not.toHaveBeenCalled();
    finish(fixture.pixels);
    await pending;
    expect(dispose).toHaveBeenCalledOnce();
    fixture.unregister();
  });

  it.each(["transparent", "uniform", "truncated"])("rejects a %s readback without encoding success", async (kind) => {
    const fixture = captureFixture();
    if (kind === "truncated") fixture.renderer.readRenderTargetPixelsAsync.mockResolvedValue(new Uint8Array(16));
    else fixture.pixels.fill(kind === "uniform" ? 255 : 0);
    const dispose = vi.spyOn(RenderTarget.prototype, "dispose");
    await expect(captureNativeCurrentView(fixture.scene, fixture.camera)).rejects.toThrow(/blank|incomplete/);
    expect(fixture.encode).not.toHaveBeenCalled();
    expect(dispose).toHaveBeenCalledOnce();
    fixture.unregister();
  });

  it.each(["draw", "readback"])("propagates %s failure, restores state and disposes the temporary target", async (phase) => {
    const fixture = captureFixture();
    if (phase === "draw") fixture.renderer.render.mockImplementation(() => { throw new Error("GPU failure"); });
    else fixture.renderer.readRenderTargetPixelsAsync.mockRejectedValue(new Error("GPU failure"));
    const dispose = vi.spyOn(RenderTarget.prototype, "dispose");
    await expect(captureNativeCurrentView(fixture.scene, fixture.camera)).rejects.toThrow("GPU failure");
    expect(fixture.renderer.setRenderTarget).toHaveBeenLastCalledWith(fixture.previousTarget, 2, 1);
    expect(fixture.renderer.autoClear).toBe(false);
    expect(fixture.renderer.xr.enabled).toBe(true);
    expect(fixture.encode).not.toHaveBeenCalled();
    expect(dispose).toHaveBeenCalledOnce();
    fixture.unregister();
  });

  it("rejects a capture after the scene's device is removed", async () => {
    const fixture = captureFixture();
    fixture.unregister();
    await expect(captureNativeCurrentView(fixture.scene, fixture.camera)).rejects.toThrow("no initialized native renderer");
  });
});
