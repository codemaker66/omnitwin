import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { BufferAttribute, BufferGeometry, Group, Matrix4, Object3D, PerspectiveCamera, RenderTarget, Scene, Vector3, type Material, type Mesh, type InstancedBufferGeometry } from "three";
import { WebGPURenderer } from "three/webgpu";
import { NativeSplatScene } from "../native-splat-scene.js";
import { withNativeRenderScope } from "../native-renderer.js";

const evidence = vi.hoisted(() => ({ created: 0, disposed: 0, radii: [] as number[], opacityArrays: [] as unknown[][], inputs: [] as BufferGeometry[] }));
vi.mock("three/tsl", async (importOriginal) => {
  const actual = await importOriginal<typeof import("three/tsl")>();
  return { ...actual, uniformArray: (values: unknown[], type: string) => {
    if (type === "float") evidence.opacityArrays.push(values);
    return actual.uniformArray(values, type);
  } };
});
vi.mock("three/addons/objects/GaussianSplat.js", async () => {
  const { Mesh, InstancedBufferGeometry, NodeMaterial } = await import("three/webgpu");
  return { GaussianSplat: class extends Mesh {
    minSortIntervalMs = 0;
    constructor(source: BufferGeometry, options: { kernelRadius: number }) {
      const draw = new InstancedBufferGeometry();
      draw.instanceCount = source.getAttribute("position").count;
      super(draw, new NodeMaterial());
      evidence.created++;
      evidence.radii.push(options.kernelRadius);
      evidence.inputs.push(source);
    }
    updateSort(): boolean { return true; }
    updateSphericalHarmonics(): boolean { return true; }
    dispose(): void { evidence.disposed++; this.geometry.dispose(); if (!Array.isArray(this.material)) this.material.dispose(); }
  } };
});

function geometry(count = 1): BufferGeometry {
  const result = new BufferGeometry();
  result.setAttribute("position", new BufferAttribute(new Float32Array(count * 3), 3));
  result.setAttribute("covariance", new BufferAttribute(new Float32Array(count * 6).fill(0.1), 6));
  result.setAttribute("color", new BufferAttribute(new Uint8Array(count * 4).fill(255), 4, true));
  return result;
}

function setup() {
  const scene = new Scene(), camera = new PerspectiveCamera();
  const renderer = new WebGPURenderer({ forceWebGL: true });
  const compile = vi.spyOn(renderer, "compileAsync").mockResolvedValue(undefined);
  const gpu = {
    SYNC_GPU_COMMANDS_COMPLETE: 37143, ALREADY_SIGNALED: 37146, CONDITION_SATISFIED: 37148, TIMEOUT_EXPIRED: 37147,
    fenceSync: vi.fn(() => ({})), deleteSync: vi.fn(), flush: vi.fn(), isContextLost: vi.fn(() => false),
    clientWaitSync: vi.fn(() => 37146),
  };
  vi.spyOn(renderer, "getContext").mockReturnValue(gpu);
  const runtime = new NativeSplatScene(scene);
  const invalidate = vi.fn();
  const detach = runtime.attach(renderer, camera, invalidate);
  const add = (count: number, readOpacity = () => 1, group?: string) => {
    const anchor = new Object3D(); scene.add(anchor);
    const error = vi.fn(), rendered = vi.fn();
    const handle = runtime.register({ anchor, opacity: readOpacity, maxSh: () => 3, residencyGroup: () => group, onError: error, onRendered: rendered });
    handle.setGeometry(geometry(count));
    return { ...handle, error, rendered, anchor };
  };
  const draw = () => scene.children.find((object) => "isMesh" in object) as Mesh<InstancedBufferGeometry, Material> | undefined;
  const render = (): void => {
    const object = draw();
    if (object === undefined) throw new Error("Expected native draw");
    withNativeRenderScope(renderer, scene, camera, () => {
      Reflect.apply(object.onAfterRender.bind(object), object, [renderer, scene, camera, object.geometry, object.material, new Group()]);
    });
  };
  return { scene, camera, renderer, runtime, compile, detach, add, draw, gpu, render, invalidate };
}

beforeEach(() => { vi.useFakeTimers(); evidence.created = 0; evidence.disposed = 0; evidence.radii.length = 0; evidence.opacityArrays.length = 0; evidence.inputs.length = 0; });
afterEach(() => { vi.clearAllTimers(); vi.useRealTimers(); });

describe("native complete draw lifecycle", () => {
  it("does not report submitted work as ready and coalesces repeated frames until GPU completion", async () => {
    const state = setup(), source = state.add(2), first = vi.fn();
    state.runtime.firstFrame({ camera: state.camera, minimumSources: 1, callback: first });
    state.gpu.clientWaitSync.mockReturnValue(state.gpu.TIMEOUT_EXPIRED);
    await vi.advanceTimersByTimeAsync(50);
    state.render(); state.render();
    expect(source.rendered).not.toHaveBeenCalled();
    expect(first).not.toHaveBeenCalled();
    expect(state.gpu.fenceSync).toHaveBeenCalledOnce();
    await vi.advanceTimersByTimeAsync(32);
    expect(source.rendered).not.toHaveBeenCalled();
    state.gpu.clientWaitSync.mockReturnValue(state.gpu.ALREADY_SIGNALED);
    await vi.advanceTimersByTimeAsync(16);
    expect(source.rendered).toHaveBeenCalledOnce();
    expect(first).toHaveBeenCalledOnce();
    expect(state.gpu.deleteSync).toHaveBeenCalledOnce();
    state.render(); state.render();
    expect(state.gpu.fenceSync).toHaveBeenCalledOnce();
  });

  it("uses the opacity submitted for the draw, not a reveal advanced after the host poll", async () => {
    const state = setup();
    let opacity = 0.5;
    const source = state.add(2, () => opacity);
    await vi.advanceTimersByTimeAsync(50);
    opacity = 1;
    state.render();
    await vi.advanceTimersByTimeAsync(16);
    expect(source.rendered).not.toHaveBeenCalled();
    expect(state.gpu.fenceSync).not.toHaveBeenCalled();
    state.runtime.frame(1); state.render();
    await vi.advanceTimersByTimeAsync(16);
    expect(source.rendered).toHaveBeenCalledOnce();
  });

  it("cancels a removed snapshot's wait and never attributes its completion to a replacement source", async () => {
    const state = setup(), old = state.add(2);
    state.gpu.clientWaitSync.mockReturnValue(state.gpu.TIMEOUT_EXPIRED);
    await vi.advanceTimersByTimeAsync(50); state.render();
    old.dispose();
    expect(state.gpu.deleteSync).toHaveBeenCalledOnce();
    const replacement = state.add(2);
    state.gpu.clientWaitSync.mockReturnValue(state.gpu.ALREADY_SIGNALED);
    await vi.advanceTimersByTimeAsync(50);
    expect(old.rendered).not.toHaveBeenCalled();
    expect(replacement.rendered).not.toHaveBeenCalled();
    state.render(); await vi.advanceTimersByTimeAsync(16);
    expect(replacement.rendered).toHaveBeenCalledOnce();
    expect(old.error).not.toHaveBeenCalled();
  });

  it("does not acknowledge a source hidden during the GPU wait", async () => {
    const state = setup();
    let opacity = 1;
    const source = state.add(2, () => opacity);
    state.gpu.clientWaitSync.mockReturnValue(state.gpu.TIMEOUT_EXPIRED);
    await vi.advanceTimersByTimeAsync(50); state.render();
    opacity = 0; state.runtime.frame(1);
    state.gpu.clientWaitSync.mockReturnValue(state.gpu.ALREADY_SIGNALED);
    await vi.advanceTimersByTimeAsync(16);
    expect(source.rendered).not.toHaveBeenCalled();
    opacity = 1; state.runtime.frame(2); state.render();
    await vi.advanceTimersByTimeAsync(16);
    expect(source.rendered).toHaveBeenCalledOnce();
  });

  it("aborts pending work on renderer detach and requires a new generation's own completion", async () => {
    const state = setup(), source = state.add(2);
    state.gpu.clientWaitSync.mockReturnValue(state.gpu.TIMEOUT_EXPIRED);
    await vi.advanceTimersByTimeAsync(50); state.render();
    state.detach(); await vi.advanceTimersByTimeAsync(1);
    expect(state.gpu.deleteSync).toHaveBeenCalledOnce();
    state.runtime.attach(state.renderer, state.camera, vi.fn());
    state.gpu.clientWaitSync.mockReturnValue(state.gpu.ALREADY_SIGNALED);
    await vi.advanceTimersByTimeAsync(50);
    expect(source.rendered).not.toHaveBeenCalled();
    state.render(); await vi.advanceTimersByTimeAsync(16);
    expect(source.rendered).toHaveBeenCalledOnce();
  });

  it("wakes demand rendering when another source becomes eligible during the pending fence", async () => {
    const state = setup();
    let opacity = 0.5;
    const first = state.add(1), second = state.add(1, () => opacity);
    state.gpu.clientWaitSync.mockReturnValue(state.gpu.TIMEOUT_EXPIRED);
    await vi.advanceTimersByTimeAsync(50); state.render();
    opacity = 1; state.runtime.frame(1); state.render();
    expect(state.gpu.fenceSync).toHaveBeenCalledOnce();
    state.invalidate.mockClear();
    state.gpu.clientWaitSync.mockReturnValue(state.gpu.ALREADY_SIGNALED);
    await vi.advanceTimersByTimeAsync(16);
    expect(first.rendered).toHaveBeenCalledOnce();
    expect(second.rendered).not.toHaveBeenCalled();
    expect(state.invalidate).toHaveBeenCalledOnce();
    state.render(); await vi.advanceTimersByTimeAsync(16);
    expect(second.rendered).toHaveBeenCalledOnce();
    expect(state.gpu.fenceSync).toHaveBeenCalledTimes(2);
  });

  it("requires the replacement snapshot's own GPU completion after a partial draw is superseded", async () => {
    const state = setup(), first = state.add(2), ready = vi.fn();
    state.runtime.firstFrame({ camera: state.camera, minimumSources: 2, callback: ready });
    state.gpu.clientWaitSync.mockReturnValue(state.gpu.TIMEOUT_EXPIRED);
    await vi.advanceTimersByTimeAsync(50); state.render();
    const second = state.add(3);
    await vi.advanceTimersByTimeAsync(50);
    expect(state.draw()?.geometry.instanceCount).toBe(5);
    expect(state.gpu.deleteSync).toHaveBeenCalledOnce();
    state.gpu.clientWaitSync.mockReturnValue(state.gpu.ALREADY_SIGNALED);
    await vi.advanceTimersByTimeAsync(16);
    expect(first.rendered).not.toHaveBeenCalled();
    expect(second.rendered).not.toHaveBeenCalled();
    state.render(); await vi.advanceTimersByTimeAsync(16);
    expect(first.rendered).toHaveBeenCalledOnce();
    expect(second.rendered).toHaveBeenCalledOnce();
    expect(ready).toHaveBeenCalledOnce();
  });

  it("keeps a cancelled first-frame subscription silent while acknowledging its drawn source", async () => {
    const state = setup(), source = state.add(2), ready = vi.fn();
    const cancel = state.runtime.firstFrame({ camera: state.camera, minimumSources: 1, callback: ready });
    await vi.advanceTimersByTimeAsync(50); state.render(); cancel();
    await vi.advanceTimersByTimeAsync(16);
    expect(ready).not.toHaveBeenCalled();
    expect(source.rendered).toHaveBeenCalledOnce();
  });

  it("rechecks ownership after a source callback detaches the renderer", async () => {
    const state = setup(), first = state.add(1), second = state.add(1), ready = vi.fn();
    state.runtime.firstFrame({ camera: state.camera, minimumSources: 2, callback: ready });
    first.rendered.mockImplementationOnce(() => { state.detach(); });
    await vi.advanceTimersByTimeAsync(50); state.render();
    await vi.advanceTimersByTimeAsync(16);
    expect(first.rendered).toHaveBeenCalledOnce();
    expect(second.rendered).not.toHaveBeenCalled();
    expect(ready).not.toHaveBeenCalled();
  });

  it("does not dispatch later listeners when an earlier listener removes the drawn source", async () => {
    const state = setup(), source = state.add(1), first = vi.fn(() => { source.dispose(); }), second = vi.fn();
    state.runtime.firstFrame({ camera: state.camera, minimumSources: 1, callback: first });
    state.runtime.firstFrame({ camera: state.camera, minimumSources: 1, callback: second });
    await vi.advanceTimersByTimeAsync(50); state.render();
    await vi.advanceTimersByTimeAsync(16);
    expect(first).toHaveBeenCalledOnce();
    expect(second).not.toHaveBeenCalled();
  });

  it("surfaces context loss once and does not retry the failed snapshot each frame", async () => {
    const state = setup(), source = state.add(2);
    await vi.advanceTimersByTimeAsync(50); state.render();
    state.gpu.isContextLost.mockReturnValue(true);
    await vi.advanceTimersByTimeAsync(16);
    expect(source.rendered).not.toHaveBeenCalled();
    expect(source.error).toHaveBeenCalledWith(expect.objectContaining({ message: expect.stringContaining("context was lost") }));
    state.render(); state.render();
    expect(source.error).toHaveBeenCalledOnce();
    expect(state.gpu.fenceSync).toHaveBeenCalledOnce();
  });

  it("bakes into the Scene's frame once, preserves nested transforms and avoids rebuilds for Scene-only changes", async () => {
    const state = setup();
    state.scene.position.set(10, 20, -30);
    state.scene.rotation.set(0.3, 0.6, -0.2);
    state.scene.scale.set(2, 3, 4);
    const parent = new Group();
    parent.position.set(7, -4, 2); parent.rotation.y = 0.5; parent.scale.set(1.2, 0.8, 1.5);
    const anchor = new Object3D();
    anchor.position.set(-2, 1, 3); anchor.rotation.z = 0.2; anchor.scale.set(0.5, 1, 2);
    state.scene.add(parent); parent.add(anchor);
    const source = geometry();
    source.getAttribute("position").setXYZ(0, 1, 2, 3);
    const onError = vi.fn();
    const handle = state.runtime.register({ anchor, opacity: () => 1, maxSh: () => 0, residencyGroup: () => undefined, onError });
    handle.setGeometry(source);
    const scenePoint = new Vector3(1, 2, 3).applyMatrix4(new Matrix4().multiplyMatrices(parent.matrix, anchor.matrix));
    // This room cut is defined in Scene coordinates, independently of the Scene's placement.
    const clip = { center: scenePoint.toArray(), halfExtent: [0.1, 0.1, 0.1] as const, softEdge: 0 };
    state.runtime.setClip({}, clip);
    await vi.advanceTimersByTimeAsync(50);
    expect(onError).not.toHaveBeenCalled();
    const merged = evidence.inputs[0];
    const draw = state.draw();
    if (merged === undefined || draw === undefined) throw new Error("Expected merged native scene");
    const mergedPoint = new Vector3().fromBufferAttribute(merged.getAttribute("position"), 0);
    expect(mergedPoint.distanceTo(scenePoint)).toBeLessThan(1e-5);
    expect(mergedPoint.clone().sub(new Vector3(...clip.center)).length()).toBeLessThan(clip.halfExtent[0]);
    draw.updateWorldMatrix(true, false);
    expect(mergedPoint.clone().applyMatrix4(draw.matrixWorld).distanceTo(anchor.localToWorld(new Vector3(1, 2, 3)))).toBeLessThan(1e-4);

    state.scene.position.set(-30, 8, 15);
    state.scene.rotation.set(-0.6, 0.4, 0.1);
    state.scene.scale.set(3, 2, 1.5);
    state.runtime.frame(1);
    await vi.advanceTimersByTimeAsync(50);
    expect(evidence.created).toBe(1);
    draw.updateWorldMatrix(true, false);
    expect(mergedPoint.clone().applyMatrix4(draw.matrixWorld).distanceTo(anchor.localToWorld(new Vector3(1, 2, 3)))).toBeLessThan(1e-4);

    parent.position.x += 2;
    state.runtime.frame(2);
    await vi.advanceTimersByTimeAsync(50);
    expect(evidence.created).toBe(2);
    const replacement = evidence.inputs[1];
    if (replacement === undefined) throw new Error("Expected transformed source replacement");
    expect(replacement.getAttribute("position").getX(0)).toBeCloseTo(scenePoint.x + 2, 5);
    handle.dispose(); state.detach();
  });

  it("merges visible sources globally and reuses cached motion/detail draws without sorting inactive sources", async () => {
    const state = setup();
    let motion = false;
    state.add(1); // A shared environment does not make either complete level redundant.
    state.add(2, () => motion ? 1 : 0, "motion");
    state.add(5, () => motion ? 0 : 1, "detail");
    await vi.advanceTimersByTimeAsync(100);
    expect(state.draw()?.geometry.instanceCount).toBe(6);
    expect(evidence.radii[0]).toBe(Math.sqrt(8));
    expect(evidence.created).toBe(2);
    motion = true;
    state.runtime.frame(1);
    expect(state.draw()?.geometry.instanceCount).toBe(3);
    motion = false;
    state.runtime.frame(2);
    expect(state.draw()?.geometry.instanceCount).toBe(6);
    await vi.advanceTimersByTimeAsync(100);
    expect(evidence.created).toBe(2);
    expect(evidence.disposed).toBe(0);
    state.detach(); await Promise.resolve();
    expect(evidence.disposed).toBe(2);
  });

  it("releases the superseded partial draw only after its larger replacement compiles", async () => {
    const state = setup();
    state.add(2);
    await vi.advanceTimersByTimeAsync(50);
    const previous = state.draw();
    const previousGeometry = evidence.inputs[0];
    if (previousGeometry === undefined) throw new Error("Expected the first partial draw");
    const disposeGeometry = vi.fn();
    previousGeometry.addEventListener("dispose", disposeGeometry);
    let release: (() => void) | undefined;
    state.compile.mockImplementationOnce(() => new Promise<void>((resolve) => { release = resolve; }));
    state.add(3);
    await vi.advanceTimersByTimeAsync(20);
    expect(state.draw()).toBe(previous);
    expect(evidence.disposed).toBe(0);
    expect(disposeGeometry).not.toHaveBeenCalled();
    release?.(); await vi.advanceTimersByTimeAsync(1);
    expect(state.draw()).not.toBe(previous);
    expect(state.draw()?.geometry.instanceCount).toBe(5);
    expect(evidence.disposed).toBe(1);
    expect(disposeGeometry).toHaveBeenCalledOnce();
    state.detach(); await Promise.resolve();
    expect(evidence.disposed).toBe(2);
    expect(disposeGeometry).toHaveBeenCalledOnce();
  });

  it("retains the partial draw when compilation of its larger replacement fails", async () => {
    const state = setup();
    state.add(2);
    await vi.advanceTimersByTimeAsync(50);
    const previous = state.draw();
    const previousGeometry = evidence.inputs[0];
    if (previousGeometry === undefined) throw new Error("Expected the first partial draw");
    const disposeGeometry = vi.fn();
    previousGeometry.addEventListener("dispose", disposeGeometry);
    state.compile.mockRejectedValueOnce(new Error("larger draw failed"));
    const added = state.add(3);
    await vi.advanceTimersByTimeAsync(100);
    expect(added.error).toHaveBeenCalledWith(expect.objectContaining({ message: "larger draw failed" }));
    expect(state.draw()).toBe(previous);
    expect(state.draw()?.geometry.instanceCount).toBe(2);
    expect(disposeGeometry).not.toHaveBeenCalled();
    expect(evidence.created).toBe(2);
    expect(evidence.disposed).toBe(1); // Only the failed replacement was released.
    state.detach(); await Promise.resolve();
    expect(disposeGeometry).toHaveBeenCalledOnce();
  });

  it("preserves a complete named level when a mixed-level handover contains all its sources", async () => {
    const state = setup();
    let motionVisible = false, detailVisible = true;
    state.add(1);
    state.add(2, () => motionVisible ? 1 : 0, "motion");
    state.add(5, () => detailVisible ? 1 : 0, "detail");
    await vi.advanceTimersByTimeAsync(100);
    expect(evidence.created).toBe(2);
    motionVisible = true;
    state.runtime.frame(1);
    await vi.advanceTimersByTimeAsync(50);
    expect(state.draw()?.geometry.instanceCount).toBe(8);
    expect(evidence.created).toBe(3);
    expect(evidence.disposed).toBe(1); // The two-entry cache evicts the older detail draw.
    detailVisible = false;
    state.runtime.frame(2);
    expect(state.draw()?.geometry.instanceCount).toBe(3);
    await vi.advanceTimersByTimeAsync(100);
    expect(evidence.created).toBe(3); // The named motion subset remained cached.
    state.detach(); await Promise.resolve();
    expect(evidence.disposed).toBe(3);
  });

  it("does not leave an old room visible when its URL/source is removed, including a failed replacement", async () => {
    const state = setup();
    const old = state.add(2);
    await vi.advanceTimersByTimeAsync(50);
    expect(state.draw()).toBeDefined();
    old.dispose();
    expect(state.draw()).toBeUndefined();
    state.compile.mockRejectedValueOnce(new Error("shader failed"));
    const replacement = state.add(3);
    await vi.advanceTimersByTimeAsync(50);
    expect(replacement.error).toHaveBeenCalledWith(expect.objectContaining({ message: "shader failed" }));
    expect(state.draw()).toBeUndefined();
  });

  it("rejects stale asynchronous builds and releases their resources", async () => {
    const state = setup();
    let release: (() => void) | undefined;
    state.compile.mockImplementationOnce(() => new Promise<void>((resolve) => { release = resolve; }));
    const source = state.add(3);
    await vi.advanceTimersByTimeAsync(20);
    source.dispose();
    release?.(); await vi.advanceTimersByTimeAsync(30);
    expect(state.draw()).toBeUndefined();
    expect(evidence.disposed).toBe(1);
  });

  it("zeros a removed source even if a persistent environment remains and replacement compilation fails", async () => {
    const state = setup();
    const removed = state.add(2);
    state.add(1);
    await vi.advanceTimersByTimeAsync(50);
    expect(evidence.opacityArrays[0]).toEqual([1, 1]);
    const previous = state.draw();
    state.compile.mockRejectedValueOnce(new Error("replacement failed"));
    removed.dispose();
    state.runtime.frame(1);
    await vi.advanceTimersByTimeAsync(50);
    expect(state.draw()).toBe(previous);
    expect(evidence.opacityArrays[0]).toEqual([0, 1]);
  });

  it("honors opacity-only hiding while retaining the fallback draw after replacement failure", async () => {
    const state = setup();
    let opacity = 1;
    state.add(2, () => opacity);
    const persistent = state.add(1);
    await vi.advanceTimersByTimeAsync(50);
    const previous = state.draw();
    state.compile.mockRejectedValueOnce(new Error("replacement failed"));
    opacity = 0;
    state.runtime.frame(1);
    expect(evidence.opacityArrays[0]).toEqual([0, 1]);
    await vi.advanceTimersByTimeAsync(50);
    expect(persistent.error).toHaveBeenCalledWith(expect.objectContaining({ message: "replacement failed" }));
    expect(state.draw()).toBe(previous);
    expect(evidence.opacityArrays[0]).toEqual([0, 1]);
    opacity = 1;
    state.runtime.frame(2);
    expect(state.draw()).toBe(previous);
    expect(evidence.opacityArrays[0]).toEqual([1, 1]);
  });

  it("reports first frame only for the scoped main draw after enough sources finish their fade", async () => {
    const state = setup();
    let opacity = 0.5;
    const firstSource = state.add(1), secondSource = state.add(1, () => opacity);
    const callback = vi.fn();
    state.runtime.firstFrame({ camera: state.camera, callback, minimumSources: 2 });
    await vi.advanceTimersByTimeAsync(50);
    const draw = state.draw();
    if (draw === undefined) throw new Error("Expected native draw");
    const render = (camera: PerspectiveCamera, renderer = state.renderer): void => {
      withNativeRenderScope(renderer, state.scene, camera, () => {
        Reflect.apply(draw.onAfterRender.bind(draw), draw, [renderer, state.scene, camera, draw.geometry, draw.material, new Group()]);
      });
    };
    render(state.camera); expect(callback).not.toHaveBeenCalled();
    expect(firstSource.rendered).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(16);
    expect(firstSource.rendered).toHaveBeenCalledOnce();
    expect(secondSource.rendered).not.toHaveBeenCalled();
    opacity = 1; state.runtime.frame(1);
    render(new PerspectiveCamera()); expect(callback).not.toHaveBeenCalled();
    render(state.camera, new WebGPURenderer({ forceWebGL: true }));
    expect(callback).not.toHaveBeenCalled();
    expect(secondSource.rendered).not.toHaveBeenCalled();
    render(state.camera); render(state.camera);
    expect(callback).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(16);
    expect(callback).toHaveBeenCalledOnce();
    expect(secondSource.rendered).toHaveBeenCalledOnce();
  });

  it("counts Three's internal main output target but excludes explicit offscreen renders and unscoped callbacks", async () => {
    const state = setup();
    const source = state.add(1);
    const callback = vi.fn();
    state.runtime.firstFrame({ camera: state.camera, callback, minimumSources: 1 });
    await vi.advanceTimersByTimeAsync(50);
    const draw = state.draw();
    if (draw === undefined) throw new Error("Expected native draw");
    const afterRender = (): void => {
      Reflect.apply(draw.onAfterRender.bind(draw), draw, [state.renderer, state.scene, state.camera, draw.geometry, draw.material, new Group()]);
    };
    afterRender();
    expect(source.rendered).not.toHaveBeenCalled();
    const outputTarget = new RenderTarget(1, 1);
    state.renderer.setRenderTarget(outputTarget);
    withNativeRenderScope(state.renderer, state.scene, state.camera, () => {
      state.renderer.setRenderTarget(null);
      afterRender();
    });
    expect(source.rendered).not.toHaveBeenCalled();
    expect(callback).not.toHaveBeenCalled();
    withNativeRenderScope(state.renderer, state.scene, state.camera, () => {
      state.renderer.setRenderTarget(outputTarget);
      afterRender();
    });
    expect(source.rendered).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(16);
    expect(source.rendered).toHaveBeenCalledOnce();
    expect(callback).toHaveBeenCalledOnce();
    state.renderer.setRenderTarget(null);
    outputTarget.dispose();
  });
});
