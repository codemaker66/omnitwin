import { afterEach, describe, expect, it, vi } from "vitest";
import { DirectionalLight, Group, Mesh, PerspectiveCamera, Scene, type Camera, type Object3D } from "three";
import {
  clearNativePrecompiles, compileEach, compileWithin, drawAhead, nativePrecompilePending, requestNativePrecompile, runNativePrecompiles,
  subscribeNativePrecompile, withoutShadowMapDraws,
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

  it("fails open: past its limit a pass aborts its job, drops those waiting, reports, and the frames go", async () => {
    const renderer = {};
    let aborted = false;
    const late = deferred();
    const stuck = requestNativePrecompile(renderer, async (signal) => {
      signal.addEventListener("abort", () => { aborted = true; });
      await late.promise;
    });
    let ranAfter = false;
    const after = requestNativePrecompile(renderer, () => { ranAfter = true; return Promise.resolve(); });
    const timeouts: number[] = [];
    let redrawn = 0;
    await runNativePrecompiles(renderer, { limitMs: 5, onTimeout: () => { timeouts.push(1); }, onLateSettle: () => { redrawn += 1; } });
    await expect(stuck).resolves.toBeUndefined();
    await expect(after).resolves.toBeUndefined();
    expect(aborted, "the job is told to put the renderer back").toBe(true);
    expect(ranAfter, "a job waiting past the limit is dropped").toBe(false);
    expect(timeouts).toHaveLength(1);
    expect(nativePrecompilePending(renderer), "nothing holds the frames").toBe(false);
    // The aborted job's pipelines are built when it settles: the view draws again to show them.
    expect(redrawn).toBe(0);
    late.resolve();
    await new Promise<void>((resolve) => { setTimeout(resolve, 0); });
    expect(redrawn).toBe(1);
  });

  it("holds the frames one limit for the whole pass, not one a job", async () => {
    const renderer = {};
    const slow = (): Promise<void> => new Promise<void>((resolve) => { setTimeout(resolve, 60); });
    let secondAborted = false;
    void requestNativePrecompile(renderer, slow);
    void requestNativePrecompile(renderer, async (signal) => {
      signal.addEventListener("abort", () => { secondAborted = true; });
      await slow();
    });
    const timeouts: number[] = [];
    // Each job alone is within the limit; the two together are not.
    await runNativePrecompiles(renderer, { limitMs: 100, onTimeout: () => { timeouts.push(1); } });
    expect(secondAborted).toBe(true);
    expect(timeouts).toHaveLength(1);
  });

  it("lets the frames go when a job throws as it starts", async () => {
    const renderer = {};
    const thrown = requestNativePrecompile(renderer, () => { throw new Error("not an async job"); });
    let ranAfter = false;
    void requestNativePrecompile(renderer, () => { ranAfter = true; return Promise.resolve(); });
    await runNativePrecompiles(renderer);
    await expect(thrown).resolves.toBeUndefined();
    expect(ranAfter).toBe(true);
    expect(nativePrecompilePending(renderer)).toBe(false);
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

describe("drawAhead", () => {
  /** r186's Pipelines in miniature: the draw path's updateForRender builds a pipeline synchronously; getForRender builds it into `promises` when given them. */
  class Pipelines {
    readonly built: { readonly subject: string; readonly async: boolean }[] = [];
    readonly compiles: (() => void)[] = [];
    getForRender(subject: string, promises: Promise<void>[] | null = null): void {
      this.built.push({ subject, async: promises !== null });
      if (promises !== null) promises.push(new Promise<void>((resolve) => { this.compiles.push(resolve); }));
    }
    updateForRender(subject: string): void {
      this.getForRender(subject);
    }
  }

  function renderer(): { readonly _pipelines: Pipelines; draw(subject: string): void } {
    const pipelines = new Pipelines();
    return { _pipelines: pipelines, draw(subject) { pipelines.updateForRender(subject); } };
  }

  it("builds the frame's pipelines asynchronously, resolves once they are built, and gives the draw path back", async () => {
    const native = renderer();
    let settled = false;
    const done = drawAhead(native, () => { native.draw("bloom"); native.draw("resolve"); }).then(() => { settled = true; });
    expect(native._pipelines.built).toEqual([{ subject: "bloom", async: true }, { subject: "resolve", async: true }]);
    native.draw("final");
    expect(native._pipelines.built.at(-1), "after the frame, the draw path builds as three's does").toEqual({ subject: "final", async: false });

    native._pipelines.compiles[0]?.();
    await Promise.resolve();
    expect(settled).toBe(false);
    native._pipelines.compiles[1]?.();
    await done;
    expect(settled).toBe(true);
  });

  it("gives the draw path back when the frame throws", async () => {
    const native = renderer();
    await expect(drawAhead(native, () => { native.draw("bloom"); throw new Error("lost"); })).rejects.toThrow("lost");
    native.draw("final");
    expect(native._pipelines.built).toEqual([{ subject: "bloom", async: true }, { subject: "final", async: false }]);
  });

  it("draws ahead again on a renderer it has drawn ahead on before", async () => {
    const native = renderer();
    const first = drawAhead(native, () => { native.draw("bloom"); });
    native._pipelines.compiles[0]?.();
    await first;
    const second = drawAhead(native, () => { native.draw("resolve"); });
    native._pipelines.compiles[1]?.();
    await second;
    expect(native._pipelines.built).toEqual([{ subject: "bloom", async: true }, { subject: "resolve", async: true }]);
  });

  it("routes three r186's own draw path", async () => {
    const specifier = "three/src/renderers/common/Pipelines.js";
    const loaded: unknown = await import(/* @vite-ignore */ specifier);
    if (typeof loaded !== "object" || loaded === null || !("default" in loaded) || typeof loaded.default !== "function") {
      throw new Error("three no longer ships its Pipelines where drawAhead expects it");
    }
    const pipelines: unknown = Reflect.construct(loaded.default, [{}, {}, { destroyProgram: (): void => undefined }]);
    if (typeof pipelines !== "object" || pipelines === null) throw new Error("three's Pipelines changed shape");
    const built: boolean[] = [];
    // Only whether the draw path asks for promises is of interest, not three's build.
    Object.defineProperty(pipelines, "getForRender", {
      configurable: true, writable: true,
      value: (_renderObject: object, promises: Promise<unknown>[] | null = null): void => { built.push(promises !== null); },
    });
    const draw = (): void => {
      const update: unknown = Reflect.get(pipelines, "updateForRender");
      if (typeof update !== "function") throw new Error("three's Pipelines has no updateForRender");
      Reflect.apply(update, pipelines, [{}]);
    };
    await drawAhead({ _pipelines: pipelines }, draw);
    draw();
    expect(built, "ahead: asynchronously; after: as three builds").toEqual([true, false]);
  });

  it("leaves a draw path that is not r186's alone, and draws nothing ahead", async () => {
    class Later extends Pipelines {
      override updateForRender(subject: string): void {
        this.getForRender(subject, null);
      }
    }
    const pipelines = new Later();
    let drew = false;
    await drawAhead({ _pipelines: pipelines }, () => { drew = true; });
    expect(drew).toBe(false);
    pipelines.updateForRender("final");
    expect(pipelines.built).toEqual([{ subject: "final", async: false }]);
  });

  it("stops waiting the moment it is aborted", async () => {
    const native = renderer();
    const controller = new AbortController();
    const done = drawAhead(native, () => { native.draw("stuck"); }, controller.signal);
    controller.abort();
    await expect(done).resolves.toBeUndefined();
  });

  it("draws nothing ahead on a renderer without r186's draw path", async () => {
    let drew = false;
    await drawAhead({}, () => { drew = true; });
    expect(drew).toBe(false);
  });
});

describe("withoutShadowMapDraws", () => {
  it("holds each on-request map's pending draw through the frame and hands it back", () => {
    const scene = new Scene();
    const sun = new DirectionalLight();
    sun.shadow.autoUpdate = false;
    sun.shadow.needsUpdate = true;
    const lamp = new DirectionalLight();
    lamp.shadow.autoUpdate = false;
    lamp.shadow.needsUpdate = false;
    const live = new DirectionalLight();
    live.shadow.needsUpdate = true;
    scene.add(sun, lamp, live);

    const during = withoutShadowMapDraws(scene, () => [sun.shadow.needsUpdate, lamp.shadow.needsUpdate, live.shadow.needsUpdate]);
    expect(during, "only a pending on-request map is held").toEqual([false, false, true]);
    expect([sun.shadow.needsUpdate, lamp.shadow.needsUpdate, live.shadow.needsUpdate]).toEqual([true, false, true]);
  });
});
