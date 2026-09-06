import { afterEach, describe, expect, it, vi } from "vitest";
import { Color, Euler, Scene, Texture, TextureLoader, PMREMGenerator, WebGLRenderer, WebGLRenderTarget, SRGBColorSpace, EquirectangularReflectionMapping } from "three";
import {
  createReflectionResourceCache, loadFurnitureReflectionResource,
  mountFurnitureReflectionExperiment, resolveFurnitureReflectionExperiment,
  type FurnitureReflectionLedger, type ReflectionResource,
} from "../furniture-reflection-experiment.js";

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: Error) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
const tick = async () => { for (let n = 0; n < 8; n += 1) await Promise.resolve(); };
const resource = (): ReflectionResource => ({ texture: new Texture(), width: 768, height: 1024, buildMs: 12, dispose: vi.fn() });
function renderer(): WebGLRenderer {
  // CPU boundary fixture, as in spark-renderer-lifecycle.test. GPU filtering is
  // explicitly spied below; this does not pretend to create a WebGL context.
  const result = Object.create(WebGLRenderer.prototype) as WebGLRenderer;
  Object.assign(result, { compile: vi.fn(), getRenderTarget: () => null,
    getActiveCubeFace: () => 0, getActiveMipmapLevel: () => 0, setRenderTarget: vi.fn(),
    xr: { enabled: true }, autoClear: true,
  });
  return result;
}
const ledger = (scene: Scene) => scene.userData["furnitureReflectionExperiment"] as FurnitureReflectionLedger;
afterEach(() => { vi.restoreAllMocks(); });

describe("reflection experiment boundaries", () => {
  it("requires the exact DEV flag, staged captured Grand Hall, Splat and no preview", () => {
    const valid = { development: true, search: "?furniture-reflections=panorama", roomSlug: "grand-hall", captureSource: "staged", splatActive: true, layerMode: "splat", timelinePreviewActive: false };
    expect(resolveFurnitureReflectionExperiment(valid)).toBe(true);
    for (const invalid of [
      { development: false }, { search: "" }, { search: "?furniture-reflections=1" }, { search: "?furniture-reflections=PANORAMA" },
      { roomSlug: null }, { roomSlug: "saloon" }, { captureSource: "package" }, { captureSource: "none" },
      { layerMode: "mesh" }, { layerMode: "hybrid" }, { splatActive: false }, { timelinePreviewActive: true },
    ]) expect(resolveFurnitureReflectionExperiment({ ...valid, ...invalid })).toBe(false);
  });

  it("keeps the prior environment while loading and restores it without changing background, exposure or scene objects", async () => {
    const scene = new Scene();
    scene.environment = new Texture();
    scene.environmentRotation.set(.2, -.4, .1, "YXZ");
    scene.environmentIntensity = .8;
    scene.background = new Color("#998877");
    const original = { environment: scene.environment, rotation: scene.environmentRotation.clone(), background: scene.background, children: [...scene.children] };
    const pending = deferred<ReflectionResource>();
    const release = vi.fn();
    const invalidate = vi.fn();
    const stop = mountFurnitureReflectionExperiment(scene, renderer(), invalidate, () => ({ ready: pending.promise, release }));
    expect(ledger(scene).status).toBe("loading");
    expect(scene.environment).toBe(original.environment);
    const result = resource();
    pending.resolve(result);
    await tick();
    expect(scene.environment).toBe(result.texture);
    expect(scene.environmentRotation.equals(new Euler())).toBe(true);
    expect(ledger(scene)).toMatchObject({ status: "ready", textureUuid: result.texture.uuid, derivativeBytes: 178608, buildMs: 12, acceptedRegistration: false, radiometricallyCalibrated: false });
    stop(); stop();
    expect(scene.environment).toBe(original.environment);
    expect(scene.environmentRotation.equals(original.rotation)).toBe(true);
    expect(scene.environmentIntensity).toBe(.8);
    expect(scene.background).toBe(original.background);
    expect(scene.children).toEqual(original.children);
    expect(release).toHaveBeenCalledTimes(1);
    expect(invalidate).toHaveBeenCalledTimes(2);
    expect(ledger(scene).status).toBe("cancelled");
  });

  it("cannot install a late texture or overwrite the replacement session's ledger after unmount", async () => {
    const scene = new Scene();
    const old = deferred<ReflectionResource>();
    const next = deferred<ReflectionResource>();
    const stopOld = mountFurnitureReflectionExperiment(scene, renderer(), vi.fn(), () => ({ ready: old.promise, release: vi.fn() }));
    stopOld();
    const stopNext = mountFurnitureReflectionExperiment(scene, renderer(), vi.fn(), () => ({ ready: next.promise, release: vi.fn() }));
    old.resolve(resource());
    await tick();
    expect(scene.environment).toBeNull();
    expect(ledger(scene).status).toBe("loading");
    const current = resource();
    next.resolve(current);
    await tick();
    expect(scene.environment).toBe(current.texture);
    stopNext();
  });

  it.each(["loading", "ready"])("does not overwrite a newer external environment during %s", async (phase) => {
    const scene = new Scene();
    const pending = deferred<ReflectionResource>();
    const stop = mountFurnitureReflectionExperiment(scene, renderer(), vi.fn(), () => ({ ready: pending.promise, release: vi.fn() }));
    if (phase === "ready") { pending.resolve(resource()); await tick(); }
    const external = new Texture();
    scene.environment = external;
    scene.environmentRotation.set(.1, .2, .3);
    if (phase === "loading") { pending.resolve(resource()); await tick(); expect(ledger(scene).status).toBe("superseded"); }
    stop();
    expect(scene.environment).toBe(external);
    expect(scene.environmentRotation.toArray()).toEqual([.1, .2, .3, "XYZ"]);
  });

  it("reports failed loading truthfully while leaving the previous environment intact", async () => {
    const scene = new Scene();
    scene.environment = new Texture();
    const original = scene.environment;
    const pending = deferred<ReflectionResource>();
    const stop = mountFurnitureReflectionExperiment(scene, renderer(), vi.fn(), () => ({ ready: pending.promise, release: vi.fn() }));
    pending.reject(new Error("Image unavailable"));
    await tick();
    expect(scene.environment).toBe(original);
    expect(ledger(scene)).toMatchObject({ status: "error", error: "Image unavailable" });
    stop();
  });
});

describe("renderer-local PMREM cache", () => {
  it("deduplicates simultaneous users and StrictMode replay, disposing only after the final owner leaves", async () => {
    const pending = deferred<ReflectionResource>();
    const create = vi.fn(() => pending.promise);
    const acquire = createReflectionResourceCache(create);
    const key = {};
    const first = acquire(key);
    first.release();
    const second = acquire(key);
    const third = acquire(key);
    await tick();
    expect(create).toHaveBeenCalledTimes(1);
    const result = resource();
    pending.resolve(result);
    await tick();
    second.release(); second.release();
    await tick();
    expect(result.dispose).not.toHaveBeenCalled();
    third.release();
    await tick();
    expect(result.dispose).toHaveBeenCalledTimes(1);
  });

  it("disposes abandoned late resources and gives a remount its own resource", async () => {
    const old = deferred<ReflectionResource>();
    const current = resource();
    const create = vi.fn().mockImplementationOnce(() => old.promise).mockResolvedValue(current);
    const acquire = createReflectionResourceCache(create);
    const key = {};
    const oldLease = acquire(key);
    await tick();
    oldLease.release();
    await tick();
    const currentLease = acquire(key);
    await tick();
    const abandoned = resource();
    old.resolve(abandoned);
    await tick();
    expect(abandoned.dispose).toHaveBeenCalledTimes(1);
    expect(await currentLease.ready).toBe(current);
    expect(current.dispose).not.toHaveBeenCalled();
    currentLease.release();
    await tick();
    expect(current.dispose).toHaveBeenCalledTimes(1);
  });

  it("isolates renderer contexts and retries a failed load without retaining a rejected cache entry", async () => {
    const create = vi.fn().mockRejectedValueOnce(new Error("decode failed")).mockImplementation(() => Promise.resolve(resource()));
    const acquire = createReflectionResourceCache(create);
    const firstKey = {}, secondKey = {};
    const failed = acquire(firstKey);
    await expect(failed.ready).rejects.toThrow("decode failed");
    const retry = acquire(firstKey), separate = acquire(secondKey);
    const [a, b] = await Promise.all([retry.ready, separate.ready]);
    expect(a.texture).not.toBe(b.texture);
    expect(create).toHaveBeenCalledTimes(3);
    failed.release(); retry.release(); separate.release();
    await tick();
    expect(a.dispose).toHaveBeenCalledTimes(1);
    expect(b.dispose).toHaveBeenCalledTimes(1);
  });

  it("never begins work for an effect that leaves before the first microtask", async () => {
    const create = vi.fn(() => Promise.resolve(resource()));
    const lease = createReflectionResourceCache(create)({});
    lease.release();
    await tick();
    expect(create).not.toHaveBeenCalled();
  });
});

describe("actual loader/PMREM boundary", () => {
  it("marks the LDR texture sRGB and disposes decoded input and PMREM working resources", async () => {
    const input = new Texture();
    const inputDispose = vi.spyOn(input, "dispose");
    vi.spyOn(TextureLoader.prototype, "loadAsync").mockResolvedValue(input);
    const target = new WebGLRenderTarget(768, 1024);
    const targetDispose = vi.spyOn(target, "dispose");
    const filter = vi.spyOn(PMREMGenerator.prototype, "fromEquirectangular").mockReturnValue(target);
    const generatorDispose = vi.spyOn(PMREMGenerator.prototype, "dispose");
    const result = await loadFurnitureReflectionResource(renderer(), () => true);
    expect(input.colorSpace).toBe(SRGBColorSpace);
    expect(input.mapping).toBe(EquirectangularReflectionMapping);
    expect(filter).toHaveBeenCalledWith(input);
    expect(inputDispose).toHaveBeenCalledTimes(1);
    expect(generatorDispose).toHaveBeenCalledTimes(1);
    expect(targetDispose).not.toHaveBeenCalled();
    result.dispose();
    expect(targetDispose).toHaveBeenCalledTimes(1);
  });

  it("does not run GPU filtering after unmount during image loading", async () => {
    const input = new Texture();
    const inputDispose = vi.spyOn(input, "dispose");
    vi.spyOn(TextureLoader.prototype, "loadAsync").mockResolvedValue(input);
    const filter = vi.spyOn(PMREMGenerator.prototype, "fromEquirectangular");
    await expect(loadFurnitureReflectionResource(renderer(), () => false)).rejects.toThrow("cancelled");
    expect(filter).not.toHaveBeenCalled();
    expect(inputDispose).toHaveBeenCalledTimes(1);
  });

  it("disposes input and working resources if PMREM generation fails", async () => {
    const input = new Texture();
    const inputDispose = vi.spyOn(input, "dispose");
    vi.spyOn(TextureLoader.prototype, "loadAsync").mockResolvedValue(input);
    const gl = renderer();
    const setTarget = vi.spyOn(gl, "setRenderTarget");
    const previousTarget = new WebGLRenderTarget(20, 10);
    vi.spyOn(gl, "getRenderTarget").mockReturnValue(previousTarget);
    vi.spyOn(PMREMGenerator.prototype, "fromEquirectangular").mockImplementation(() => {
      gl.xr.enabled = false; gl.autoClear = false;
      throw new Error("GPU filter failed");
    });
    const generatorDispose = vi.spyOn(PMREMGenerator.prototype, "dispose");
    await expect(loadFurnitureReflectionResource(gl, () => true)).rejects.toThrow("GPU filter failed");
    expect(inputDispose).toHaveBeenCalledTimes(1);
    expect(generatorDispose).toHaveBeenCalledTimes(1);
    expect(gl.xr.enabled).toBe(true);
    expect(gl.autoClear).toBe(true);
    expect(setTarget).toHaveBeenLastCalledWith(previousTarget, 0, 0);
  });
});
