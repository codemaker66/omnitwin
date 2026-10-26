// ---------------------------------------------------------------------------
// Precompiling a native view's pipelines before it draws them (F-01)
//
// three r186 creates a render pipeline synchronously the first time it draws
// an object, and Chrome compiles a synchronous pipeline on the GPU process's
// own thread, the one that presents every frame. The planner's arrival made
// 67 of them (the room for its reflection capture, the room again for the
// scene pass, the post passes) and the screen presented nothing for 3.7 s on
// the RTX 4090 (D:/claude/planner-p5-20261026/F-01-notes.md).
//
// A job here compiles ahead with `compileAsync`, whose pipelines Chrome builds
// off that thread. While it runs, nothing else may draw: r186 reads the
// renderer's render target and MRT while it builds each shader, so the job
// sets them for its whole run. NativeCanvas therefore holds its frame loop
// ("never") while any job is pending and runs the jobs one at a time, after
// the hold has taken effect; the frames resume once the queue is empty. What
// compileAsync cannot reach (the post passes' materials, built by their chain
// as it draws its first frame) a job draws one frame ahead of, into a target
// of its own, its pipelines built off that thread (drawAhead). A job
// that has not settled by PRECOMPILE_JOB_LIMIT_MS (a device lost mid-compile,
// a driver hang) is aborted: it puts the renderer's target and MRT back, and
// the view draws on, compiling what is left as it draws (slowly, not never).
// ---------------------------------------------------------------------------

import type { Camera, LightShadow, Object3D, Scene } from "three";

/**
 * Compiles one set of pipelines; resolves when they are built (or given up).
 * `signal` aborts at the job's limit: the job must then leave the renderer as
 * it found it at once (compileWithin does).
 */
export type NativePrecompileJob = (signal: AbortSignal) => Promise<void>;

/** The longest one job may hold the frame loop, ms: past it the view draws again, compiling the rest as before. */
export const PRECOMPILE_JOB_LIMIT_MS = 8_000;

interface Entry {
  readonly job: NativePrecompileJob;
  readonly done: () => void;
}

interface Queue {
  readonly jobs: Entry[];
  running: Entry | null;
  readonly listeners: Set<() => void>;
}

const queues = new WeakMap<object, Queue>();

function queueFor(renderer: object): Queue {
  let queue = queues.get(renderer);
  if (queue === undefined) {
    queue = { jobs: [], running: null, listeners: new Set() };
    queues.set(renderer, queue);
  }
  return queue;
}

function notify(queue: Queue): void {
  for (const listener of [...queue.listeners]) listener();
}

/**
 * Queues `job` for `renderer`'s view; resolves once it has run (whatever its
 * outcome: a precompile is a warm-up, and the frames after it compile what it
 * missed). A renderer without a NativeCanvas running its queue never runs it.
 */
export function requestNativePrecompile(renderer: object, job: NativePrecompileJob): Promise<void> {
  const queue = queueFor(renderer);
  return new Promise<void>((resolve) => {
    queue.jobs.push({ job, done: resolve });
    notify(queue);
  });
}

/** Whether `renderer` has precompile jobs waiting or running (its frame loop is then held). */
export function nativePrecompilePending(renderer: object): boolean {
  const queue = queues.get(renderer);
  return queue !== undefined && (queue.running !== null || queue.jobs.length > 0);
}

/** Calls `listener` whenever `renderer`'s queue changes; returns the unsubscribe. */
export function subscribeNativePrecompile(renderer: object, listener: () => void): () => void {
  const queue = queueFor(renderer);
  queue.listeners.add(listener);
  return () => { queue.listeners.delete(listener); };
}

export interface NativePrecompileRun {
  /** The longest one job may hold the frames, ms. */
  readonly limitMs?: number;
  /** Told of a job aborted at its limit (the view reports it: observability). */
  readonly onTimeout?: () => void;
}

/**
 * Runs `renderer`'s queued jobs in order, each to completion or to its limit,
 * until none are left (NativeCanvas, with its frame loop held). Jobs queued
 * meanwhile run in the same pass; a call while one is already running leaves
 * the queue to it.
 */
export async function runNativePrecompiles(renderer: object, { limitMs = PRECOMPILE_JOB_LIMIT_MS, onTimeout }: NativePrecompileRun = {}): Promise<void> {
  const queue = queueFor(renderer);
  if (queue.running !== null) return;
  for (let entry = queue.jobs.shift(); entry !== undefined; entry = queue.jobs.shift()) {
    queue.running = entry;
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const settled = await Promise.race([
        entry.job(controller.signal).then(() => true, () => true),
        new Promise<false>((resolve) => { timer = setTimeout(() => { resolve(false); }, limitMs); }),
      ]);
      if (!settled) {
        controller.abort();
        onTimeout?.();
      }
    } finally {
      clearTimeout(timer);
      queue.running = null;
      entry.done();
      notify(queue);
    }
  }
}

/** Drops `renderer`'s waiting jobs (a view torn down), resolving them unrun; a running job finishes. */
export function clearNativePrecompiles(renderer: object): void {
  const queue = queues.get(renderer);
  if (queue === undefined) return;
  const waiting = queue.jobs.splice(0);
  for (const entry of waiting) entry.done();
  notify(queue);
}

interface CompilingRenderer {
  compileAsync(scene: Object3D, camera: Camera, targetScene?: Scene | null): Promise<unknown>;
}

interface TargetingRenderer<Target, Outputs> {
  getRenderTarget(): Target;
  setRenderTarget(target: Target): void;
  getMRT(): Outputs;
  setMRT(outputs: Outputs): void;
}

/**
 * Runs `work` with `target` and `outputs` (MRT) set on the renderer, and puts
 * the renderer's own back when it settles or as soon as `signal` aborts,
 * whichever comes first: a job past its limit must not leave the next frame
 * drawing into its pass.
 */
export async function compileWithin<Target, Outputs>(
  renderer: TargetingRenderer<Target, Outputs>, target: Target, outputs: Outputs, signal: AbortSignal | null, work: () => Promise<void>,
): Promise<void> {
  const previousTarget = renderer.getRenderTarget();
  const previousOutputs = renderer.getMRT();
  let restored = false;
  const restore = (): void => {
    if (restored) return;
    restored = true;
    renderer.setRenderTarget(previousTarget);
    renderer.setMRT(previousOutputs);
  };
  renderer.setRenderTarget(target);
  renderer.setMRT(outputs);
  signal?.addEventListener("abort", restore, { once: true });
  try {
    await work();
  } finally {
    signal?.removeEventListener("abort", restore);
    restore();
  }
}

function isRenderable(object: Object3D): boolean {
  const kind = object as { readonly isMesh?: boolean; readonly isLine?: boolean; readonly isPoints?: boolean; readonly isSprite?: boolean };
  return kind.isMesh === true || kind.isLine === true || kind.isPoints === true || kind.isSprite === true;
}

/**
 * Compiles every visible renderable under `root` for the renderer's current
 * target and MRT, each in its own compileAsync, all at once. r186 builds one
 * object's pipeline after another within a call, so a room compiled in one
 * call took 5.7 s on the RTX 4090; separate calls overlap, and Chrome builds
 * asynchronous pipelines on its worker threads together. Each object's
 * frustum culling is off while its call projects it (synchronously, as the
 * call starts), so it compiles wherever the camera looks. `targetScene` is
 * the scene it is drawn in: its lights and its cache. Call `issued` once all
 * the calls have started (before any is awaited), to undo what had to hold
 * for their projection.
 */
export async function compileEach(
  renderer: CompilingRenderer, root: Object3D, camera: Camera, targetScene: Scene,
  signal: AbortSignal | null = null, issued: (() => void) | null = null,
): Promise<void> {
  const objects: Object3D[] = [];
  root.traverseVisible((object) => { if (isRenderable(object)) objects.push(object); });
  const compiles: Promise<unknown>[] = [];
  try {
    for (const object of objects) {
      if (signal?.aborted === true) break;
      const culled = object.frustumCulled;
      object.frustumCulled = false;
      try {
        compiles.push(renderer.compileAsync(object, camera, targetScene).catch(() => undefined));
      } finally {
        object.frustumCulled = culled;
      }
    }
  } finally {
    issued?.();
  }
  await Promise.all(compiles);
}

interface DrawPipelines {
  getForRender(renderObject: object, promises?: Promise<unknown>[] | null): unknown;
}

/** Where a routed draw path sends the pipelines it lacks: null builds them as three does. */
interface DrawRoute {
  pending: Promise<unknown>[] | null;
}

const routes = new WeakMap<object, DrawRoute>();

/** r186's draw path, minified or not: `updateForRender(renderObject) { this.getForRender(renderObject); }`. */
const R186_UPDATE_FOR_RENDER = /\.getForRender\(\s*[\w$]+\s*\)/u;

/**
 * Routes `pipelines`' updateForRender through a DrawRoute, once and for good:
 * a property added and deleted again around each frame drawn ahead would turn
 * an object every draw reads into a slow dictionary in V8. Outside a frame
 * drawn ahead the route builds as three's own line does. Null when the draw
 * path is not r186's one line (a three bump): nothing is then drawn ahead.
 */
function drawRoute(pipelines: DrawPipelines): DrawRoute | null {
  const update: unknown = Reflect.get(pipelines, "updateForRender");
  if (typeof update !== "function" || !R186_UPDATE_FOR_RENDER.test(Function.prototype.toString.call(update))) return null;
  const route: DrawRoute = { pending: null };
  Object.defineProperty(pipelines, "updateForRender", {
    configurable: true,
    writable: true,
    value: (renderObject: object): void => { pipelines.getForRender(renderObject, route.pending); },
  });
  routes.set(pipelines, route);
  return route;
}

/** The routed draw path of three r186's private Pipelines (drawRoute); null without one. */
function routedDrawPath(renderer: object): DrawRoute | null {
  const pipelines: unknown = Reflect.get(renderer, "_pipelines");
  if (typeof pipelines !== "object" || pipelines === null || typeof Reflect.get(pipelines, "getForRender") !== "function") return null;
  return routes.get(pipelines) ?? drawRoute(pipelines as DrawPipelines);
}

/**
 * Draws one frame ahead: runs `draw` (a frame's renders, synchronously) with
 * the renderer's draw path building each pipeline it lacks as compileAsync
 * does, off the GPU process's main thread. r186 draws an object only once
 * its pipeline is ready (Renderer._renderObjectDirect), so those draws are
 * skipped and the frame is not one to show: draw it into a target of its
 * own. Resolves once the pipelines are built, or as soon as `signal` aborts.
 * This reaches what compileAsync cannot: the post passes' materials, which
 * their chain builds only as its first frame draws. A renderer without
 * r186's draw path draws nothing ahead; its frames compile as they draw.
 */
export async function drawAhead(renderer: object, draw: () => void, signal: AbortSignal | null = null): Promise<void> {
  const route = routedDrawPath(renderer);
  if (route === null || signal?.aborted === true) return;
  const pending: Promise<unknown>[] = [];
  route.pending = pending;
  try {
    draw();
  } finally {
    route.pending = null;
  }
  const built = Promise.all(pending.map((compile) => compile.catch(() => undefined))).then(() => undefined);
  if (signal === null) {
    await built;
    return;
  }
  let settle: () => void = () => undefined;
  const aborted = new Promise<void>((resolve) => { settle = resolve; });
  signal.addEventListener("abort", settle, { once: true });
  try {
    await Promise.race([built, aborted]);
  } finally {
    signal.removeEventListener("abort", settle);
  }
}

/**
 * Runs `draw` with each shadow map that draws on request (autoUpdate off)
 * holding its pending request, and hands the requests back after. A frame
 * drawn ahead skips its draws, so a map it drew would be left empty and its
 * request spent (the hall sun's, hall-sun.ts); maps that draw every frame
 * draw again in the next.
 */
export function withoutShadowMapDraws<T>(root: Object3D, draw: () => T): T {
  const held: LightShadow[] = [];
  root.traverse((object) => {
    const shadow = (object as { readonly shadow?: LightShadow }).shadow;
    if (shadow === undefined || shadow.autoUpdate || !shadow.needsUpdate) return;
    shadow.needsUpdate = false;
    held.push(shadow);
  });
  try {
    return draw();
  } finally {
    for (const shadow of held) shadow.needsUpdate = true;
  }
}
