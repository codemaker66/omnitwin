import { afterEach, describe, expect, it, vi } from "vitest";
import { Group, Mesh, PerspectiveCamera, Scene, type Camera, type Object3D } from "three";
import {
  clearNativePrecompiles, compileEach, compileWithin, nativePrecompilePending, requestNativePrecompile, runNativePrecompiles,
  subscribeNativePrecompile,
} from "../native-precompile.js";

function deferred(): { readonly promise: Promise<void>; readonly resolve: () => void } {
  let resolve: () => void = () => undefined;
  const promise = new Promise<void>((done) => { resolve = done; });
  return { promise, resolve };
}

describe("the native precompile queue", () => {
  afterEach(() => { vi.useRealTimers(); });

  it("holds a renderer pending from the first job queued until the last has run, one at a time", async () => {
    const renderer = {};
    const order: string[] = [];
    const first = deferred();
    const told: boolean[] = [];
    const stop = subscribeNativePrecompile(renderer, () => { told.push(nativePrecompilePending(renderer)); });

    const firstDone = requestNativePrecompile(renderer, async () => { order.push("first:start"); await first.promise; order.push("first:end"); });
    const secondDone = requestNativePrecompile(renderer, () => { order.push("second"); return Promise.resolve(); });
    expect(nativePrecompilePending(renderer)).toBe(true);

    const running = runNativePrecompiles(renderer);
    // A second runner leaves the queue to the first: nothing runs twice or side by side.
    await runNativePrecompiles(renderer);
    expect(order).toEqual(["first:start"]);
    first.resolve();
    await running;
    await Promise.all([firstDone, secondDone]);

    expect(order).toEqual(["first:start", "first:end", "second"]);
    expect(nativePrecompilePending(renderer)).toBe(false);
    expect(told.at(-1)).toBe(false);
    stop();
  });

  it("runs a job queued while another runs in the same pass", async () => {
    const renderer = {};
    const order: string[] = [];
    void requestNativePrecompile(renderer, () => {
      order.push("first");
      void requestNativePrecompile(renderer, () => { order.push("late"); return Promise.resolve(); });
      return Promise.resolve();
    });
    await runNativePrecompiles(renderer);
    expect(order).toEqual(["first", "late"]);
    expect(nativePrecompilePending(renderer)).toBe(false);
  });

  it("lets the frames go after a failed job", async () => {
    const renderer = {};
    const failed = requestNativePrecompile(renderer, () => Promise.reject(new Error("device lost")));
    await runNativePrecompiles(renderer);
    await expect(failed).resolves.toBeUndefined();
    expect(nativePrecompilePending(renderer)).toBe(false);
  });

  it("fails open: a job that never settles is aborted at its limit, reported, and the frames go", async () => {
    const renderer = {};
    let aborted = false;
    const stuck = requestNativePrecompile(renderer, (signal) => {
      signal.addEventListener("abort", () => { aborted = true; });
      return new Promise<void>(() => undefined);
    });
    const after = requestNativePrecompile(renderer, () => Promise.resolve());
    const timeouts: number[] = [];
    await runNativePrecompiles(renderer, { limitMs: 5, onTimeout: () => { timeouts.push(1); } });
    await expect(stuck).resolves.toBeUndefined();
    await expect(after).resolves.toBeUndefined();
    expect(aborted, "the job is told to put the renderer back").toBe(true);
    expect(timeouts).toHaveLength(1);
    expect(nativePrecompilePending(renderer), "nothing holds the frames").toBe(false);
  });

  it("drops the waiting jobs of a view torn down, and lets a running one finish", async () => {
    const renderer = {};
    const running = deferred();
    let ranLater = false;
    void requestNativePrecompile(renderer, () => running.promise);
    const waiting = requestNativePrecompile(renderer, () => { ranLater = true; return Promise.resolve(); });
    const pass = runNativePrecompiles(renderer);
    clearNativePrecompiles(renderer);
    await expect(waiting).resolves.toBeUndefined();
    expect(nativePrecompilePending(renderer), "the running job still holds the frames").toBe(true);
    running.resolve();
    await pass;
    expect(ranLater).toBe(false);
    expect(nativePrecompilePending(renderer)).toBe(false);
  });

  it("keeps each renderer's queue its own", async () => {
    const one = {};
    const other = {};
    void requestNativePrecompile(one, () => Promise.resolve());
    expect(nativePrecompilePending(one)).toBe(true);
    expect(nativePrecompilePending(other)).toBe(false);
    await runNativePrecompiles(one);
  });
});

describe("compileEach", () => {
  interface Call { readonly subject: Object3D; readonly culled: boolean; readonly target: Scene | null }

  /** A renderer whose compiles wait until released, noting what each was given as it started. */
  function holding(): { readonly calls: Call[]; readonly release: () => void; readonly renderer: { compileAsync(subject: Object3D, camera: Camera, target?: Scene | null): Promise<void> } } {
    const calls: Call[] = [];
    const gate = deferred();
    return {
      calls,
      release: gate.resolve,
      renderer: {
        compileAsync(subject, _camera, target = null) {
          calls.push({ subject, culled: subject.frustumCulled, target });
          return gate.promise;
        },
      },
    };
  }

  function room(): { readonly root: Group; readonly floor: Mesh; readonly wall: Mesh; readonly hidden: Mesh } {
    const root = new Group();
    const floor = new Mesh();
    const wall = new Mesh();
    const hidden = new Mesh();
    hidden.visible = false;
    root.add(floor, wall, hidden, new Group());
    return { root, floor, wall, hidden };
  }

  it("starts one compile per visible piece, all before any is awaited, culling off while each projects", async () => {
    const { calls, release, renderer } = holding();
    const { root, floor, wall } = room();
    const stage = new Scene();
    let issuedWith = -1;
    const done = compileEach(renderer, root, new PerspectiveCamera(), stage, null, () => { issuedWith = calls.length; });
    expect(calls.map(({ subject }) => subject)).toEqual([floor, wall]);
    expect(issuedWith, "told once every compile has started").toBe(2);
    expect(calls.every(({ culled, target }) => !culled && target === stage)).toBe(true);
    expect(floor.frustumCulled && wall.frustumCulled, "culling back as it was").toBe(true);
    release();
    await done;
  });

  it("starts nothing more once aborted, and still undoes what held for the projection", async () => {
    const { calls, release, renderer } = holding();
    const controller = new AbortController();
    controller.abort();
    let issued = false;
    const done = compileEach(renderer, room().root, new PerspectiveCamera(), new Scene(), controller.signal, () => { issued = true; });
    expect(calls).toHaveLength(0);
    expect(issued).toBe(true);
    release();
    await done;
  });

  it("lets one failed compile go without failing the rest", async () => {
    const { root } = room();
    let started = 0;
    const renderer = { compileAsync(): Promise<void> { started += 1; return started === 1 ? Promise.reject(new Error("lost")) : Promise.resolve(); } };
    await expect(compileEach(renderer, root, new PerspectiveCamera(), new Scene())).resolves.toBeUndefined();
    expect(started).toBe(2);
  });
});

describe("compileWithin", () => {
  function renderer(): { target: string | null; outputs: string | null; getRenderTarget(): string | null; setRenderTarget(value: string | null): void; getMRT(): string | null; setMRT(value: string | null): void } {
    return {
      target: "canvas", outputs: null,
      getRenderTarget() { return this.target; },
      setRenderTarget(value) { this.target = value; },
      getMRT() { return this.outputs; },
      setMRT(value) { this.outputs = value; },
    };
  }

  it("holds the pass's target and MRT for the work, and puts the renderer's own back after", async () => {
    const native = renderer();
    let during: [string | null, string | null] = [null, null];
    await compileWithin(native, "pass", "outputs", null, () => { during = [native.target, native.outputs]; return Promise.resolve(); });
    expect(during).toEqual(["pass", "outputs"]);
    expect([native.target, native.outputs]).toEqual(["canvas", null]);
  });

  it("puts them back the moment it is aborted, before the work settles", async () => {
    const native = renderer();
    const controller = new AbortController();
    const work = deferred();
    const done = compileWithin(native, "pass", "outputs", controller.signal, () => work.promise);
    expect(native.target).toBe("pass");
    controller.abort();
    expect([native.target, native.outputs], "the next frame draws where it should").toEqual(["canvas", null]);
    // A late settle changes nothing.
    native.setRenderTarget("elsewhere");
    work.resolve();
    await done;
    expect(native.target).toBe("elsewhere");
  });
});
