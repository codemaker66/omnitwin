// ---------------------------------------------------------------------------
// The Grand Assembly's capture handle (development only).
//
// GrandAssembly installs it in development builds as `window.__assembly`, so
// a capture harness (scripts/assembly-capture.mjs) can drive the production
// Assembly in fixed steps with the frame loop frozen: every frame is then
// reproducible, and a frame's cost can be measured. Production builds never
// import this module.
// ---------------------------------------------------------------------------

import { advance, type RootState } from "@react-three/fiber";
import { InstancedMesh, Vector3, type Object3D } from "three";
import { usePlacementStore } from "../../stores/placement-store.js";
import { useSelectionStore } from "../../stores/selection-store.js";
import { useHallViewStore } from "../../stores/hall-view-store.js";
import { useHallTimeStore } from "../../stores/hall-time-store.js";
import { useRenderGovernorStore } from "../../stores/render-governor-store.js";
import { getNativeRenderer } from "../../lib/native-renderer.js";
import type { HallMoodName } from "../../components/grand-hall/hall-mood.js";
import { grandHallDinner180 } from "./fixture.js";
import type { AssemblyDirector } from "./GrandAssembly.js";

export interface AssemblyFrameReport {
  /** Wall time of the last drawn frame: playback, every frame callback, the draw and the GPU, ms. */
  readonly ms: number;
  /** Of which the playback step and writing the poses, ms. */
  readonly applyMs: number;
  /** Frames the canvas drew since the previous report. */
  readonly drawn: number;
  /** The renderer's node frame number after the frame (its temporal effects key on it). */
  readonly frameId: number | null;
  /** Draws the canvas's frame pacer held back and that were drawn again. */
  readonly skipped: number;
}

export interface AssemblyMeasure {
  readonly frames: number;
  readonly meanMs: number;
  readonly p50Ms: number;
  readonly p95Ms: number;
  readonly maxMs: number;
  readonly applyP95Ms: number;
  readonly applyMaxMs: number;
  readonly gpuP95Ms: number | null;
  readonly gpuMeanMs: number | null;
}

export interface AssemblyStateReport {
  readonly seed: number | null;
  readonly time: number;
  readonly done: boolean;
  readonly settledAt: number | null;
  readonly pieces: number;
  readonly placed: number;
  readonly live: number;
  readonly clipSeconds: number;
  readonly anchorId: string | null;
}

export interface AssemblyCaptureApi {
  /** Loads the 180-seat dinner into the planner; returns the item count. */
  load(): number;
  /** Sets the hall's mood and hour (ISO time). */
  scene(mood: HallMoodName, at: string): void;
  /** A show over the layout as placed, at its first tick, driven by setTime. */
  prepare(seed: number, options?: { readonly reducedMotion?: boolean; readonly portrait?: boolean }): AssemblyStateReport;
  setTime(seconds: number): void;
  skip(): void;
  cancel(): void;
  state(): AssemblyStateReport;
  /** Frame loop "never": only frame() draws. */
  freeze(on: boolean): void;
  /** Draws the show at `seconds` (after `subframes - 1` frames at 60 fps before it) and waits for the GPU. */
  frame(seconds: number, subframes?: number, gapMs?: number): Promise<AssemblyFrameReport>;
  /** Frame cost over the whole show at 60 fps steps. */
  measure(options?: { readonly gpu?: boolean; readonly seconds?: number }): Promise<AssemblyMeasure>;
  /** Rebuilds the post-processing pipeline (fresh temporal history) and waits for it. */
  resetPipeline(): Promise<void>;
  /** Restarts the temporal anti-aliasing's jitter and history from the next frame. */
  alignTemporal(): Promise<{ readonly frameId: number | null; readonly restarted: number }>;
  /** A hash of every furniture, shadow and candle instance matrix and the camera, as drawn now. */
  transformHash(): string;
  /** Places the camera (position, target). */
  look(position: readonly [number, number, number], target: readonly [number, number, number]): void;
  camera(): { readonly position: [number, number, number]; readonly target: [number, number, number] | null };
  /** Ends any show and returns the frame loop to demand. */
  release(): void;
}

declare global {
  interface Window {
    __assembly?: AssemblyCaptureApi;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function hashArrays(arrays: readonly ArrayLike<number>[]): string {
  let hash = 0x811c9dc5;
  for (const values of arrays) {
    const bytes = new Uint8Array(Float32Array.from(values).buffer);
    for (const byte of bytes) {
      hash ^= byte;
      hash = Math.imul(hash, 0x01000193);
    }
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

function percentile(values: readonly number[], p: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1))] ?? 0;
}

function round(value: number): number {
  return Math.round(value * 100) / 100;
}

/** three's node manager: the frame counter temporal effects key on, and the built node states. */
function nodeManager(renderer: object): Record<string, unknown> | null {
  const nodes = (renderer as Record<string, unknown>)["_nodes"];
  return isRecord(nodes) ? nodes : null;
}

function rendererFrameId(renderer: object): number | null {
  const frame = nodeManager(renderer)?.["nodeFrame"];
  const id = isRecord(frame) ? frame["frameId"] : undefined;
  return typeof id === "number" ? id : null;
}

/** The temporal anti-aliasing nodes the renderer has built (they carry a jitter index). */
function jitterNodes(renderer: object): Record<string, unknown>[] {
  const cache = nodeManager(renderer)?.["nodeBuilderCache"];
  const found = new Set<Record<string, unknown>>();
  if (!(cache instanceof Map)) return [];
  for (const state of cache.values()) {
    const before: unknown = isRecord(state) ? state["updateBeforeNodes"] : undefined;
    if (!Array.isArray(before)) continue;
    for (const node of before) if (isRecord(node) && node["isTRAANode"] === true && typeof node["_jitterIndex"] === "number") found.add(node);
  }
  return [...found];
}

function orbitTarget(controls: unknown): Vector3 | null {
  if (!isRecord(controls)) return null;
  const target = controls["target"];
  return target instanceof Vector3 ? target : null;
}

interface GpuQueue { readonly queue: { onSubmittedWorkDone(): Promise<void> } }
interface TimestampBackend { trackTimestamp: boolean }

function isGpuQueue(value: unknown): value is GpuQueue {
  return isRecord(value) && "queue" in value;
}

function isTimestampBackend(value: unknown): value is TimestampBackend {
  return isRecord(value) && "trackTimestamp" in value;
}

const DRAWN_INSTANCES = new Set([
  "furniture-contact-shadows", "table-candles", "table-candle-flames", "table-candle-linen-glow", "table-candle-floor-pool",
]);

/** Every instance buffer the Assembly draws through: the furniture pools, the shadows and the candles. */
function drawnInstances(scene: Object3D): ArrayLike<number>[] {
  const arrays = new Set<ArrayLike<number>>();
  scene.getObjectByName("instanced-furniture")?.traverse((object) => {
    if (object instanceof InstancedMesh) arrays.add(object.instanceMatrix.array);
  });
  scene.traverse((object) => {
    if (object instanceof InstancedMesh && DRAWN_INSTANCES.has(object.name)) arrays.add(object.instanceMatrix.array);
  });
  return [...arrays];
}

/** Installs `window.__assembly`; returns the uninstall. */
export function installAssemblyBridge(director: AssemblyDirector, get: () => RootState): () => void {
  let reported = director.frames();
  let skipped = 0;

  const device = (): GpuQueue | null => {
    const backend: unknown = getNativeRenderer(get().gl)?.backend;
    return isRecord(backend) && isGpuQueue(backend["device"]) ? backend["device"] : null;
  };

  const report = (): AssemblyStateReport => {
    const show = director.show();
    const placed = usePlacementStore.getState().placedItems.length;
    if (show === null) {
      return { seed: null, time: 0, done: true, settledAt: null, pieces: 0, placed, live: 0, clipSeconds: 0, anchorId: null };
    }
    return {
      seed: show.playback.seed,
      time: show.playback.time(),
      done: show.done(),
      settledAt: show.playback.settledAt(),
      pieces: show.pieces.length,
      placed,
      live: show.playback.live().length,
      clipSeconds: show.playback.clipSeconds,
      anchorId: show.playback.graph.anchorId,
    };
  };

  const drawFrame = async (seconds: number, subframes: number, gapMs: number): Promise<AssemblyFrameReport> => {
    let ms = 0;
    const native = getNativeRenderer(get().gl);
    for (let k = Math.max(1, subframes) - 1; k >= 0; k--) {
      director.setTime(Math.max(0, seconds - k / 60));
      // The canvas's frame pacer may hold a draw back while the previous
      // frame's GPU work has not retired; the frame number then does not move,
      // and the same pose is drawn again a moment later.
      for (let attempt = 0; attempt < 6; attempt++) {
        const state = get();
        if (state.frameloop !== "never") state.setFrameloop("never");
        const before = native === null ? null : rendererFrameId(native);
        const started = performance.now();
        advance(state.clock.elapsedTime + 1 / 60, true, state);
        await device()?.queue.onSubmittedWorkDone();
        ms = performance.now() - started;
        const after = native === null ? null : rendererFrameId(native);
        if (before === null || after !== before) break;
        skipped += 1;
        await new Promise((resolve) => { window.setTimeout(resolve, 20); });
      }
      if (gapMs > 0 && k > 0) await new Promise((resolve) => { window.setTimeout(resolve, gapMs); });
    }
    const frames = director.frames();
    const result: AssemblyFrameReport = {
      ms,
      applyMs: director.lastApplyMs(),
      drawn: frames - reported,
      skipped,
      frameId: native === null ? null : rendererFrameId(native),
    };
    reported = frames;
    skipped = 0;
    return result;
  };

  const api: AssemblyCaptureApi = {
    load: () => {
      useSelectionStore.getState().clearSelection();
      usePlacementStore.setState({ placedItems: grandHallDinner180() });
      return usePlacementStore.getState().placedItems.length;
    },
    scene: (mood, at) => {
      useHallViewStore.getState().setMood(mood);
      useHallTimeStore.getState().setTime(Date.parse(at));
      get().invalidate();
    },
    prepare: (seed, options = {}) => {
      director.play({ seed, manual: true, reducedMotion: options.reducedMotion, portrait: options.portrait });
      return report();
    },
    setTime: (seconds) => { director.setTime(seconds); },
    skip: () => { director.skip(); },
    cancel: () => { director.cancel(); },
    state: report,
    freeze: (on) => {
      get().setFrameloop(on ? "never" : "demand");
      if (!on) get().invalidate();
    },
    frame: (seconds, subframes = 1, gapMs = 0) => drawFrame(seconds, subframes, gapMs),
    measure: async (options = {}) => {
      const seconds = options.seconds ?? director.show()?.playback.clipSeconds ?? 8;
      const native = getNativeRenderer(get().gl);
      const backend: unknown = native?.backend;
      const timestamps = options.gpu === true && native !== null && isTimestampBackend(backend) && native.hasFeature("timestamp-query");
      if (timestamps && isTimestampBackend(backend)) backend.trackTimestamp = true;
      const times: number[] = [];
      const apply: number[] = [];
      const gpu: number[] = [];
      try {
        for (let frame = 0; frame <= Math.round(seconds * 60); frame++) {
          const result = await drawFrame(frame / 60, 1, 0);
          times.push(result.ms);
          apply.push(result.applyMs);
          if (timestamps) {
            const duration = await native.resolveTimestampsAsync("render");
            if (duration !== undefined && Number.isFinite(duration)) gpu.push(duration);
          }
        }
      } finally {
        if (timestamps && isTimestampBackend(backend)) backend.trackTimestamp = false;
      }
      const mean = times.reduce((sum, value) => sum + value, 0) / Math.max(1, times.length);
      return {
        frames: times.length,
        meanMs: round(mean),
        p50Ms: round(percentile(times, 50)),
        p95Ms: round(percentile(times, 95)),
        maxMs: round(Math.max(0, ...times)),
        applyP95Ms: round(percentile(apply, 95)),
        applyMaxMs: round(Math.max(0, ...apply)),
        gpuP95Ms: gpu.length > 0 ? round(percentile(gpu, 95)) : null,
        gpuMeanMs: gpu.length > 0 ? round(gpu.reduce((sum, value) => sum + value, 0) / gpu.length) : null,
      };
    },
    resetPipeline: async () => {
      // Giving up a rung and taking it back rebuilds PlannerRenderPipeline:
      // fresh temporal history and jitter, so a capture starts from nothing.
      const given = useRenderGovernorStore.getState().given;
      const wait = (ms: number): Promise<void> => new Promise((resolve) => { window.setTimeout(resolve, ms); });
      useRenderGovernorStore.getState().setGiven([...given, "bloom"]);
      await wait(80);
      useRenderGovernorStore.getState().setGiven(given);
      await wait(80);
    },
    alignTemporal: async () => {
      const native = getNativeRenderer(get().gl);
      if (native === null) return { frameId: null, restarted: 0 };
      // A rebuilt pipeline's nodes are registered once its build has landed, a few frames in.
      for (let frame = 0; frame < 60 && jitterNodes(native).length === 0; frame++) {
        await drawFrame(director.show()?.playback.time() ?? 0, 1, 0);
      }
      const nodes = jitterNodes(native);
      for (const node of nodes) {
        node["_jitterIndex"] = 0;
        // A size it does not have makes the next frame restart its history from that frame alone.
        const resize = node["setSize"];
        if (typeof resize === "function") resize.call(node, 1, 1);
      }
      return { frameId: rendererFrameId(native), restarted: nodes.length };
    },
    transformHash: () => {
      const state = get();
      const arrays = drawnInstances(state.scene);
      arrays.push([...state.camera.position.toArray(), ...state.camera.quaternion.toArray()]);
      return hashArrays(arrays);
    },
    look: (position, target) => {
      const state = get();
      state.camera.position.set(...position);
      orbitTarget(state.controls)?.set(...target);
      state.camera.lookAt(...target);
      state.camera.updateMatrixWorld();
      state.invalidate();
    },
    camera: () => {
      const state = get();
      const target = orbitTarget(state.controls);
      return {
        position: [state.camera.position.x, state.camera.position.y, state.camera.position.z],
        target: target === null ? null : [target.x, target.y, target.z],
      };
    },
    release: () => {
      director.cancel();
      get().setFrameloop("demand");
      get().invalidate();
    },
  };
  window.__assembly = api;
  return () => {
    if (window.__assembly === api) delete window.__assembly;
  };
}
