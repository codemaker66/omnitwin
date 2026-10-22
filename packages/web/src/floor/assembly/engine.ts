// ---------------------------------------------------------------------------
// Grand Assembly playback: the choreography graph run on springs.
//
// Every moving quantity is a spring from lib/springs.ts (the one spring core),
// stepped on the playback's own fixed clock of 240 ticks a second, never on
// the frame's delta: a time t is always reached by the same round(t * 240)
// steps, so a layout and seed give the same transforms at the same time at
// any frame rate, and a capture can step time exactly. A spring may drive a
// scalar progress that a direction maps to a path (an arc, a route through a
// door); nothing is eased by a curve.
//
// The poses are presentation only. Once a piece's springs have settled it is
// done and reports its saved transform exactly; skip and cancel make every
// piece done at once; under reduced motion the playback starts done.
// ---------------------------------------------------------------------------

import { isSpringSettled, stepSpring, type SpringConfig, type SpringState } from "../../lib/springs.js";
import {
  buildChoreography,
  type AssemblyDirection,
  type AssemblyPiece,
  type ChoreographyGraph,
  type SeatOrder,
  type TableSchedule,
  type WaveTiming,
} from "./choreography.js";

export const ASSEMBLY_TICK_RATE = 240;
export const ASSEMBLY_TICK = 1 / ASSEMBLY_TICK_RATE;

export type Vec3 = readonly [number, number, number];

/** A piece as it is drawn this tick. At rest it equals the saved transform. */
export interface PiecePose {
  visible: boolean;
  /** Base position (the piece's floor point), metres. */
  x: number;
  y: number;
  z: number;
  /** Turn about the vertical, radians (the saved rotationY at rest). */
  yaw: number;
  /** Lean of the top toward +x and +z about the base, radians. */
  leanX: number;
  leanZ: number;
  /** Tip about a horizontal axis (unit x, z) through (0, rollPivot, 0) above the base, radians. */
  roll: number;
  rollAxisX: number;
  rollAxisZ: number;
  rollPivot: number;
  /** Scale in the piece's own frame about (0, pivotY, 0), on top of its saved scale. */
  sx: number;
  sy: number;
  sz: number;
  pivotY: number;
  /** Gold tint, 0 (none) to 1. */
  tint: number;
  /** Contact shadow strength, 0 to 1. */
  shadow: number;
}

export function restPose(piece: AssemblyPiece, out: PiecePose): PiecePose {
  out.visible = true;
  out.x = piece.x;
  out.y = piece.y;
  out.z = piece.z;
  out.yaw = piece.rotationY;
  out.leanX = 0;
  out.leanZ = 0;
  out.roll = 0;
  out.rollAxisX = 1;
  out.rollAxisZ = 0;
  out.rollPivot = 0;
  out.sx = 1;
  out.sy = 1;
  out.sz = 1;
  out.pivotY = 0;
  out.tint = 0;
  out.shadow = 1;
  return out;
}

export function emptyPose(): PiecePose {
  return {
    visible: false, x: 0, y: 0, z: 0, yaw: 0, leanX: 0, leanZ: 0, roll: 0, rollAxisX: 1, rollAxisZ: 0,
    rollPivot: 0, sx: 1, sy: 1, sz: 1, pivotY: 0, tint: 0, shadow: 0,
  };
}

function spring(value: number): SpringState {
  return { value, velocity: 0 };
}

/** Every spring a direction may use for one piece. Directions use the ones they need. */
export interface PieceMotion {
  readonly piece: AssemblyPiece;
  /** Seconds from the start of the reveal. */
  readonly start: number;
  started: boolean;
  done: boolean;
  /** Seconds since the piece started. */
  elapsed: number;
  /** Progress along its route, 0 to 1, and the spring that leads it (a cascade starts gently). */
  readonly lead: SpringState;
  readonly travel: SpringState;
  readonly yaw: SpringState;
  yawTarget: number;
  readonly leanX: SpringState;
  readonly leanZ: SpringState;
  leanTargetX: number;
  leanTargetZ: number;
  readonly squash: SpringState;
  readonly sy: SpringState;
  syTarget: number;
  readonly radial: SpringState;
  radialTarget: number;
  readonly roll: SpringState;
  rollTarget: number;
  rollAxisX: number;
  rollAxisZ: number;
  readonly tint: SpringState;
  tintTarget: number;
  /** The blueprint footprint under it (the Unfolding): glow and scale. */
  readonly ring: SpringState;
  ringTarget: number;
  readonly ringScale: SpringState;
  /** Set by the direction on touchdown, release and so on. */
  landed: boolean;
  released: boolean;
  /** Where the route put it on the last tick, and how fast it went, metres a second. */
  px: number;
  py: number;
  pz: number;
  vx: number;
  vy: number;
  vz: number;
}

export function createMotion(piece: AssemblyPiece, start: number): PieceMotion {
  return {
    piece,
    start,
    started: false,
    done: false,
    elapsed: 0,
    lead: spring(0),
    travel: spring(0),
    yaw: spring(piece.rotationY),
    yawTarget: piece.rotationY,
    leanX: spring(0),
    leanZ: spring(0),
    leanTargetX: 0,
    leanTargetZ: 0,
    squash: spring(0),
    sy: spring(1),
    syTarget: 1,
    radial: spring(1),
    radialTarget: 1,
    roll: spring(0),
    rollTarget: 0,
    rollAxisX: 1,
    rollAxisZ: 0,
    tint: spring(0),
    tintTarget: 0,
    ring: spring(0),
    ringTarget: 0,
    ringScale: spring(1),
    landed: false,
    released: false,
    px: piece.x,
    py: piece.y,
    pz: piece.z,
    vx: 0,
    vy: 0,
    vz: 0,
  };
}

/** One tick of a spring toward its target (dt is always the fixed tick). */
export function tick(state: SpringState, target: number, config: SpringConfig, dt: number): void {
  stepSpring(state, target, dt, config);
}

/** Settled to within `epsilon` of its target and nearly still. */
export function rests(state: SpringState, target: number, epsilon = 1e-4): boolean {
  return isSpringSettled(state, target, epsilon) && Math.abs(state.velocity) < epsilon * 10;
}

/** Candles on one table: the wax rises, the flames catch, their light spreads. 1 at rest. */
export interface DressingPose {
  wax: number;
  flame: number;
  glow: number;
}

interface DressingRun {
  readonly tableId: string;
  readonly start: number;
  started: boolean;
  done: boolean;
  readonly wax: SpringState;
  readonly flame: SpringState;
  readonly glow: SpringState;
  lit: boolean;
}

/** The gold blueprint drawn on the floor (the Unfolding). */
export interface BlueprintPose {
  /** How much of the usable-floor outline is traced, 0 to 1. */
  perimeter: number;
  /** How much of the main aisle is traced, 0 to 1. */
  aisle: number;
  /** Overall brightness of the outline and aisle, 0 to 1. */
  lines: number;
}

export interface CameraKey {
  /** From this time the camera heads for this pose. */
  readonly at: number;
  readonly position: Vec3;
  readonly target: Vec3;
}

/** The camera as a cascade: a lead spring chases the current key, the camera chases the lead. */
export interface CameraScript {
  readonly keys: readonly CameraKey[];
  readonly lead: SpringConfig;
  readonly follow: SpringConfig;
}

export interface CameraPose {
  readonly position: [number, number, number];
  readonly target: [number, number, number];
}

/** What a direction supplies: its timing, its routes and how its pieces move. */
export interface DirectionModel {
  readonly direction: AssemblyDirection;
  readonly timing: WaveTiming;
  readonly schedule?: TableSchedule;
  readonly seatOrder?: SeatOrder;
  /** The length of the clip for this direction, seconds (motion plus the held ending). */
  readonly clipSeconds: number;
  readonly camera: CameraScript;
  /** Whether it draws the gold blueprint. */
  readonly blueprint: boolean;
  /** Set up a piece's route and first values; called once, before it starts. */
  init(motion: PieceMotion, graph: ChoreographyGraph): void;
  /** Advance one started piece by one tick. */
  step(motion: PieceMotion, dt: number): void;
  /** Write its pose while moving. */
  pose(motion: PieceMotion, out: PiecePose): void;
  /** True once every spring it uses has come to rest at its target. */
  settled(motion: PieceMotion): boolean;
}

export interface PlaybackOptions {
  /** Complete at once: no motion, the camera left where it is. */
  readonly reducedMotion?: boolean;
}

export interface AssemblyPlayback {
  readonly direction: AssemblyDirection;
  readonly seed: number;
  readonly graph: ChoreographyGraph;
  readonly pieces: readonly AssemblyPiece[];
  readonly clipSeconds: number;
  readonly blueprint: boolean;
  /** Seconds of playback reached (a whole number of ticks). */
  time(): number;
  /** Every piece, candle, line and the camera at rest. */
  done(): boolean;
  /** When everything came to rest, or null. */
  settledAt(): number | null;
  /** Step forward to `seconds`; an earlier time replays from the start (same result). */
  advanceTo(seconds: number): void;
  /** Everything to its true state, the camera to its final pose. */
  skip(): void;
  /** Everything to its true state, the camera left where it is. */
  cancel(): void;
  pose(id: string, out: PiecePose): boolean;
  isDone(id: string): boolean;
  dressing(tableId: string, out: DressingPose): boolean;
  lines(out: BlueprintPose): boolean;
  /** Ring glow and scale under a piece (the Unfolding). */
  ring(id: string): { glow: number; scale: number } | null;
  /** The camera this tick, or null to leave the camera alone. */
  camera(): CameraPose | null;
  /** Ids still in motion (started, not done). */
  live(): string[];
}

/** The wax rising from the linen: ζ = 0.7. */
const DRESSING_WAX: SpringConfig = { stiffness: 100, damping: 14 };
/** A wick catching: quick and under-damped (ζ = 0.45), a small flare before it steadies. */
const DRESSING_FLAME: SpringConfig = { stiffness: 196, damping: 12.6 };
/** Its light spreading: critically damped. */
const DRESSING_GLOW: SpringConfig = { stiffness: 49, damping: 14 };
/** The blueprint's outline and aisle trace as a cascade (ζ = 1 each). */
const LINE_TRACE: SpringConfig = { stiffness: 9, damping: 6 };
/** The outline and aisle fading: critically damped. */
const LINE_FADE: SpringConfig = { stiffness: 20.25, damping: 9 };

/**
 * What counts as at rest. Below these a residue is under a third of a pixel
 * at the studies' framing (1080 lines, 55° of view, pieces 5-15 m away), so
 * snapping it to the exact value is invisible: metres, radians, unit scale,
 * and brightness (one level in 255).
 */
export const REST = {
  metres: 0.002,
  radians: 0.001,
  scale: 0.002,
  light: 0.004,
} as const;

export interface BlueprintTiming {
  readonly perimeterAt: number;
  readonly aisleAt: number;
  readonly fadeAt: number;
}

export function createAssemblyPlayback(
  pieces: readonly AssemblyPiece[],
  model: DirectionModel,
  seed: number,
  options: PlaybackOptions = {},
  blueprintTiming: BlueprintTiming = { perimeterAt: 0.2, aisleAt: 0.9, fadeAt: 4.0 },
): AssemblyPlayback {
  const graph = buildChoreography(pieces, seed, { timing: model.timing, schedule: model.schedule, seatOrder: model.seatOrder });
  const byId = new Map(pieces.map((piece) => [piece.id, piece]));
  const finalKey = model.camera.keys[model.camera.keys.length - 1] ?? null;
  const firstKey = model.camera.keys[0] ?? null;

  let ticks = 0;
  let motions = new Map<string, PieceMotion>();
  let dressings = new Map<string, DressingRun>();
  let lead: SpringState[] = [];
  let cam: SpringState[] = [];
  let cameraDone = false;
  let cameraHeld = false;
  let lineState = { perimeterLead: spring(0), perimeter: spring(0), aisleLead: spring(0), aisle: spring(0), lines: spring(1), done: !model.blueprint };
  let settled: number | null = null;
  let finished = false;

  const reset = (): void => {
    ticks = 0;
    motions = new Map();
    for (const node of graph.nodes) {
      const piece = byId.get(node.pieceId);
      if (piece === undefined) continue;
      const motion = createMotion(piece, node.start);
      model.init(motion, graph);
      motions.set(piece.id, motion);
    }
    dressings = new Map();
    for (const [tableId, start] of graph.dressing) {
      dressings.set(tableId, { tableId, start, started: false, done: false, wax: spring(0), flame: spring(0), glow: spring(0), lit: false });
    }
    const values = firstKey === null ? [0, 0, 0, 0, 0, 0] : [...firstKey.position, ...firstKey.target];
    lead = values.map((value) => spring(value));
    cam = values.map((value) => spring(value));
    cameraDone = firstKey === null;
    cameraHeld = false;
    lineState = { perimeterLead: spring(0), perimeter: spring(0), aisleLead: spring(0), aisle: spring(0), lines: spring(1), done: !model.blueprint };
    settled = null;
    finished = false;
  };

  const finishAll = (cameraToEnd: boolean): void => {
    for (const motion of motions.values()) { motion.started = true; motion.done = true; }
    for (const run of dressings.values()) { run.started = true; run.done = true; }
    lineState.done = true;
    if (cameraToEnd) {
      const values = finalKey === null ? null : [...finalKey.position, ...finalKey.target];
      if (values !== null) {
        values.forEach((value, index) => {
          const a = lead[index];
          const b = cam[index];
          if (a !== undefined) { a.value = value; a.velocity = 0; }
          if (b !== undefined) { b.value = value; b.velocity = 0; }
        });
      }
      cameraDone = true;
    } else {
      cameraHeld = true;
      cameraDone = true;
    }
    finished = true;
    settled ??= ticks / ASSEMBLY_TICK_RATE;
  };

  const stepTick = (): void => {
    ticks += 1;
    const now = ticks / ASSEMBLY_TICK_RATE;
    const dt = ASSEMBLY_TICK;
    let busy = false;
    for (const motion of motions.values()) {
      if (motion.done) continue;
      if (!motion.started) {
        if (now + 1e-9 < motion.start) { busy = true; continue; }
        motion.started = true;
      }
      motion.elapsed += dt;
      model.step(motion, dt);
      if (model.settled(motion)) motion.done = true;
      else busy = true;
    }
    for (const run of dressings.values()) {
      if (run.done) continue;
      if (!run.started) {
        if (now + 1e-9 < run.start) { busy = true; continue; }
        run.started = true;
      }
      tick(run.wax, 1, DRESSING_WAX, dt);
      if (!run.lit && run.wax.value > 0.9) run.lit = true;
      if (run.lit) {
        tick(run.flame, 1, DRESSING_FLAME, dt);
        tick(run.glow, 1, DRESSING_GLOW, dt);
      }
      if (run.lit && rests(run.wax, 1, REST.scale) && rests(run.flame, 1, REST.scale) && rests(run.glow, 1, REST.light)) run.done = true;
      else busy = true;
    }
    if (!lineState.done) {
      if (now >= blueprintTiming.perimeterAt) {
        tick(lineState.perimeterLead, 1, LINE_TRACE, dt);
        tick(lineState.perimeter, lineState.perimeterLead.value, LINE_TRACE, dt);
      }
      if (now >= blueprintTiming.aisleAt) {
        tick(lineState.aisleLead, 1, LINE_TRACE, dt);
        tick(lineState.aisle, lineState.aisleLead.value, LINE_TRACE, dt);
      }
      if (now >= blueprintTiming.fadeAt) tick(lineState.lines, 0, LINE_FADE, dt);
      if (now >= blueprintTiming.fadeAt && rests(lineState.lines, 0, REST.light)) lineState.done = true;
      else busy = true;
    }
    if (!cameraDone && finalKey !== null) {
      let key = model.camera.keys[0];
      for (const candidate of model.camera.keys) if (candidate.at <= now + 1e-9) key = candidate;
      if (key !== undefined) {
        const goal = [...key.position, ...key.target];
        let still = key === finalKey;
        goal.forEach((value, index) => {
          const a = lead[index];
          const b = cam[index];
          if (a === undefined || b === undefined) return;
          tick(a, value, model.camera.lead, dt);
          tick(b, a.value, model.camera.follow, dt);
          if (!rests(a, value, REST.metres) || !rests(b, value, REST.metres)) still = false;
        });
        if (still) {
          // Land exactly on the final pose.
          goal.forEach((value, index) => {
            const a = lead[index];
            const b = cam[index];
            if (a !== undefined) { a.value = value; a.velocity = 0; }
            if (b !== undefined) { b.value = value; b.velocity = 0; }
          });
          cameraDone = true;
        } else {
          busy = true;
        }
      }
    }
    if (!busy && !finished) {
      finished = true;
      settled = now;
    }
  };

  reset();
  if (options.reducedMotion === true) finishAll(false);

  const playback: AssemblyPlayback = {
    direction: model.direction,
    seed,
    graph,
    pieces,
    clipSeconds: model.clipSeconds,
    blueprint: model.blueprint,
    time: () => ticks / ASSEMBLY_TICK_RATE,
    done: () => finished,
    settledAt: () => settled,
    advanceTo: (seconds) => {
      const target = Math.max(0, Math.round(seconds * ASSEMBLY_TICK_RATE));
      if (target < ticks) {
        const reduced = options.reducedMotion === true;
        reset();
        if (reduced) finishAll(false);
      }
      while (ticks < target) {
        if (finished) { ticks = target; break; }
        stepTick();
      }
    },
    skip: () => { finishAll(true); },
    cancel: () => { finishAll(false); },
    pose: (id, out) => {
      const motion = motions.get(id);
      if (motion === undefined) return false;
      if (motion.done) { restPose(motion.piece, out); return true; }
      if (!motion.started) {
        restPose(motion.piece, out);
        out.visible = false;
        out.shadow = 0;
        return true;
      }
      restPose(motion.piece, out);
      model.pose(motion, out);
      return true;
    },
    isDone: (id) => motions.get(id)?.done ?? true,
    dressing: (tableId, out) => {
      const run = dressings.get(tableId);
      if (run === undefined) return false;
      if (run.done) { out.wax = 1; out.flame = 1; out.glow = 1; return true; }
      out.wax = Math.max(0, run.wax.value);
      out.flame = Math.max(0, run.flame.value);
      out.glow = Math.max(0, run.glow.value);
      return true;
    },
    lines: (out) => {
      if (!model.blueprint) return false;
      if (lineState.done) { out.perimeter = 1; out.aisle = 1; out.lines = 0; return true; }
      out.perimeter = Math.min(1, Math.max(0, lineState.perimeter.value));
      out.aisle = Math.min(1, Math.max(0, lineState.aisle.value));
      out.lines = Math.min(1, Math.max(0, lineState.lines.value));
      return true;
    },
    ring: (id) => {
      if (!model.blueprint) return null;
      const motion = motions.get(id);
      if (motion === undefined || motion.done) return { glow: 0, scale: 1 };
      return { glow: Math.max(0, motion.ring.value), scale: motion.ringScale.value };
    },
    camera: () => {
      if (cameraHeld || finalKey === null) return null;
      const value = (index: number): number => cam[index]?.value ?? 0;
      return { position: [value(0), value(1), value(2)], target: [value(3), value(4), value(5)] };
    },
    live: () => {
      const ids: string[] = [];
      for (const motion of motions.values()) if (motion.started && !motion.done) ids.push(motion.piece.id);
      return ids;
    },
  };
  return playback;
}
