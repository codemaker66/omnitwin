import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { Color, Group, RenderTarget, Scene } from "three";
import { mrt, output as passOutput, vec4 } from "three/tsl";
import { WebGPURenderer } from "three/webgpu";
import { afterEach, describe, expect, it, vi } from "vitest";
import { PLAN_THUMBNAIL, THUMBNAIL_MAX_LENGTH, captureOrthographic, copyNativeCapturePixels, isUniformImage } from "../ortho-capture.js";
import { registerNativeSceneRenderer } from "../native-renderer.js";

function deferred<T>(): { promise: Promise<T>; resolve: (value: T) => void } {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((yes) => { resolve = yes; });
  return { promise, resolve };
}

/** A 2x2 WebGPU readback (256-byte rows) whose pixels differ: a capture that drew something. */
function drawnPixels(): Uint8Array {
  const pixels = new Uint8Array(264);
  pixels.set([200, 180, 150, 255, 40, 30, 20, 255], 0);
  pixels.set([90, 90, 90, 255, 10, 200, 10, 255], 256);
  return pixels;
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
    readRenderTargetPixelsAsync: vi.fn(() => Promise.resolve(drawnPixels())),
    xr: { enabled: true }, autoClear: false,
  });
  const unregister = registerNativeSceneRenderer(scene, renderer);
  const image: ImageData = { data: new Uint8ClampedArray(16), width: 2, height: 2, colorSpace: "srgb" };
  const putImageData = vi.fn();
  const context: Pick<CanvasRenderingContext2D, "createImageData" | "putImageData"> = {
    createImageData: () => image, putImageData,
  };
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(context as CanvasRenderingContext2D);
  const encode = vi.spyOn(HTMLCanvasElement.prototype, "toDataURL").mockReturnValue("data:image/png;base64,capture");
  return { scene, background, labels, previousTarget, renderer, unregister, putImageData, encode };
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
    pending.resolve(drawnPixels());
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

  it("gives no image for a capture that drew nothing (every pixel the same)", async () => {
    const fixture = captureFixture();
    // WebGPU rows sit 256 bytes apart: each 8-byte row of one colour, then zero padding the guard must not see.
    const readback = new Uint8Array(264);
    readback.fill(7, 0, 8);
    readback.fill(7, 256, 264);
    fixture.renderer.readRenderTargetPixelsAsync.mockResolvedValue(readback);
    expect(await captureOrthographic(fixture.scene, 20, 30, { width: 2, height: 2 })).toBeNull();
    expect(fixture.putImageData).not.toHaveBeenCalled();
    expect(fixture.encode).not.toHaveBeenCalled();
    expect(isUniformImage(new Uint8ClampedArray(16))).toBe(true);
    fixture.unregister();
  });

  it("encodes the plan thumbnail as JPEG at 0.85, lower only to fit the API's cap", async () => {
    const fixture = captureFixture();
    const asked: unknown[] = [];
    fixture.encode.mockImplementation((type?: string, quality?: unknown) => {
      asked.push([type, quality]);
      return `data:image/jpeg;base64,${"A".repeat(quality === 0.65 ? 1000 : THUMBNAIL_MAX_LENGTH)}`;
    });
    const thumbnail = await captureOrthographic(fixture.scene, 20, 30, { ...PLAN_THUMBNAIL, width: 2, height: 2 });
    expect(asked).toEqual([["image/jpeg", 0.85], ["image/jpeg", 0.75], ["image/jpeg", 0.65]]);
    expect(thumbnail?.length).toBeLessThanOrEqual(THUMBNAIL_MAX_LENGTH);
    fixture.unregister();
  });

  it("sends no thumbnail the API would refuse, whatever the quality", async () => {
    const fixture = captureFixture();
    fixture.encode.mockReturnValue(`data:image/jpeg;base64,${"A".repeat(THUMBNAIL_MAX_LENGTH)}`);
    expect(await captureOrthographic(fixture.scene, 20, 30, { ...PLAN_THUMBNAIL, width: 2, height: 2 })).toBeNull();
    expect(fixture.encode).toHaveBeenCalledTimes(4);
    fixture.unregister();
  });

  it("keeps the thumbnail within the cap the API enforces, as a JPEG it accepts", () => {
    const route = readFileSync(resolve(import.meta.dirname, "../../../../api/src/routes/public-configs.ts"), "utf8");
    const cap = /MAX_THUMBNAIL_STRING_LEN = ([\d_]+);/.exec(route)?.[1];
    expect(Number(cap?.replaceAll("_", ""))).toBe(THUMBNAIL_MAX_LENGTH);
    expect(route).toContain("data:image/jpeg;base64,");
    expect(PLAN_THUMBNAIL).toMatchObject({ width: 800, height: 533, type: "image/jpeg", maxLength: THUMBNAIL_MAX_LENGTH });
  });

  it.each([false, true])("draws without the outputs a precompile job holds, and hands them back (draw fails: %s)", async (fails) => {
    // A job holds the scene pass's outputs while it compiles (lib/native-precompile.ts); the plan's
    // target names none of them, and drawn with them every material wrote nothing (4 Nov 2026).
    const fixture = captureFixture();
    const held = mrt({ output: passOutput, normal: vec4(0, 0, 0, 1) });
    fixture.renderer.setMRT(held);
    fixture.renderer.render.mockImplementation(() => {
      expect(fixture.renderer.getMRT()).toBeNull();
      if (fails) throw new Error("GPU draw failed");
    });
    const capture = await captureOrthographic(fixture.scene, 20, 30, { width: 2, height: 2 });
    expect(capture === null).toBe(fails);
    expect(fixture.renderer.render).toHaveBeenCalledOnce();
    expect(fixture.renderer.getMRT()).toBe(held);
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
