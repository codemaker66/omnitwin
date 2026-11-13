// ---------------------------------------------------------------------------
// Grand Assembly playback: the choreography graph run on springs.
//
// Every moving quantity is a spring from lib/springs.ts (the one spring core),
// stepped on the playback's own fixed clock of 240 ticks a second, never on
// the frame's delta: a time t is always reached by the same round(t * 240)
// steps, so a layout and seed give the same transforms at the same time at
// any frame rate, and a capture can step time exactly. A spring may drive a
// scalar progress that a direction maps to a path (an arc, a fall); nothing
// is eased by a curve.
//
// The poses are presentation only. Once a piece's springs have settled it is
// done and reports its saved transform exactly; skip and cancel make every
// piece done at once; under reduced motion the playback starts done.
// ---------------------------------------------------------------------------

import { isSpringSettled, stepSpring, type SpringConfig, type SpringState } from "../../lib/springs.js";
import { buildChoreography, type AssemblyPiece, type ChoreographyGraph, type SeatOrder, type WaveTiming } from "./choreography.js";

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
  /** Tilt as a rotation vector (radians about world x and z) through (0, pivot, 0) above the base. */
  tiltX: number;
  tiltZ: number;
  /** Height above the base that the piece grows and tilts about, metres. */
  pivot: number;
  /** Uniform growth on top of the saved scale, about the pivot: 1 at rest. */
  grow: number;
  /** Vertical squash about the base with its volume kept: 0 at rest. */
  squash: number;
  /** Contact shadow weight, 0 to 1, and how far it spreads (1 as placed). */
  shadow: number;
  shadowSpread: number;
}

export function restPose(piece: AssemblyPiece, out: PiecePose): PiecePose {
  out.visible = true;
  out.x = piece.x;
  out.y = piece.y;
  out.z = piece.z;
  out.yaw = piece.rotationY;
  out.leanX = 0;
  out.leanZ = 0;
  out.tiltX = 0;
  out.tiltZ = 0;
  out.pivot = 0;
  out.grow = 1;
  out.squash = 0;
  out.shadow = 1;
  out.shadowSpread = 1;
  return out;
}

export function emptyPose(): PiecePose {
  return {
    visible: false, x: 0, y: 0, z: 0, yaw: 0, leanX: 0, leanZ: 0, tiltX: 0, tiltZ: 0,
    pivot: 0, grow: 1, squash: 0, shadow: 0, shadowSpread: 1,
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
  /** Height of its base above the floor, metres, and where that height is heading. */
  readonly alt: SpringState;
  altTarget: number;
  /** Sideways drift across its route, metres (a falling leaf's swing). */
  readonly sway: SpringState;
  /** Growth out of the light it came from, 0 to 1. */
  readonly grow: SpringState;
  readonly yaw: SpringState;
  yawTarget: number;
  readonly leanX: SpringState;
  readonly leanZ: SpringState;
  leanTargetX: number;
  leanTargetZ: number;
  /** Tilt toward the viewer, radians. */
  readonly pitch: SpringState;
  pitchTarget: number;
  readonly squash: SpringState;
  /** Direction-defined stage of its flight. */
  phase: number;
  landed: boolean;
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
    alt: spring(piece.y),
    altTarget: piece.y,
    sway: spring(0),
    grow: spring(1),
    yaw: spring(piece.rotationY),
    yawTarget: piece.rotationY,
    leanX: spring(0),
    leanZ: spring(0),
    leanTargetX: 0,
    leanTargetZ: 0,
    pitch: spring(0),
    pitchTarget: 0,
    squash: spring(0),
    phase: 0,
    landed: false,
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

/** A light the reveal raises for a while (a window the pieces come through), 0 to 1. */
export interface RevealLight {
  readonly id: string;
  /** Rising from this time... */
  readonly on: number;
  /** ...and fading from this one. */
  readonly off: number;
}

interface LightRun {
  readonly light: RevealLight;
  readonly level: SpringState;
  done: boolean;
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

/** A direction's own plan: when each piece starts, when each table is dressed, which lights rise. */
export interface DirectionPlan {
  readonly graph: ChoreographyGraph;
  readonly lights: readonly RevealLight[];
}

/** What a direction supplies: its timing, its routes and how its pieces move. */
export interface DirectionModel {
  readonly timing: WaveTiming;
  readonly seatOrder?: SeatOrder;
  /** The length of the clip for this direction, seconds (motion plus the held ending). */
  readonly clipSeconds: number;
  readonly camera: CameraScript;
  /** The spring a reveal light rises and fades on. */
  readonly light?: SpringConfig;
  /** Refine the generic wave graph into the direction's own schedule. */
  plan?(base: ChoreographyGraph, pieces: readonly AssemblyPiece[]): DirectionPlan;
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
  readonly seed: number;
  readonly graph: ChoreographyGraph;
  readonly pieces: readonly AssemblyPiece[];
  readonly lights: readonly RevealLight[];
  readonly clipSeconds: number;
  /** Seconds of playback reached (a whole number of ticks). */
  time(): number;
  /** Every piece, candle, light and the camera at rest. */
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
  /** A reveal light's level, 0 to 1 (0 once done or for an unknown id). */
  light(id: string): number;
  /** The camera this tick, or null to leave the camera alone. */
  camera(): CameraPose | null;
  /** The camera's final pose, or null when the direction has none. */
  finalCamera(): CameraPose | null;
  /** Ids still in motion (started, not done). */
  live(): string[];
}

/** The wax rising from the linen: ζ = 0.8, ω = 12. */
const DRESSING_WAX: SpringConfig = { stiffness: 144, damping: 19.2 };
/** A wick catching: quick and under-damped (ζ = 0.5, ω = 16), a small flare before it steadies. */
const DRESSING_FLAME: SpringConfig = { stiffness: 256, damping: 16 };
/** Its light spreading: critically damped, ω = 12. */
const DRESSING_GLOW: SpringConfig = { stiffness: 144, damping: 24 };
/** A reveal light without its own spring: critically damped, ω = 4. */
const REVEAL_LIGHT: SpringConfig = { stiffness: 16, damping: 8 };

/**
 * What counts as at rest. Below these a residue is under a third of a pixel
 * at the reveal's framing (1080 lines, 55° of view, pieces 5-15 m away), so
 * snapping it to the exact value is invisible: metres, radians, unit scale,
 * and brightness (one level in 255).
 */
export const REST = {
  metres: 0.002,
  radians: 0.001,
  scale: 0.002,
  light: 0.004,
} as const;

export function createAssemblyPlayback(
  pieces: readonly AssemblyPiece[],
  model: DirectionModel,
  seed: number,
  options: PlaybackOptions = {},
): AssemblyPlayback {
  const base = buildChoreography(pieces, seed, { timing: model.timing, seatOrder: model.seatOrder });
  const planned = model.plan?.(base, pieces) ?? { graph: base, lights: [] };
  const { graph, lights } = planned;
  const byId = new Map(pieces.map((piece) => [piece.id, piece]));
  const finalKey = model.camera.keys[model.camera.keys.length - 1] ?? null;
  const firstKey = model.camera.keys[0] ?? null;
  const lightSpring = model.light ?? REVEAL_LIGHT;

  let ticks = 0;
  let motions = new Map<string, PieceMotion>();
  let dressings = new Map<string, DressingRun>();
  let lightRuns = new Map<string, LightRun>();
  let lead: SpringState[] = [];
  let cam: SpringState[] = [];
  let cameraDone = false;
  let cameraHeld = false;
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
    lightRuns = new Map(lights.map((light) => [light.id, { light, level: spring(0), done: false }]));
    const values = firstKey === null ? [0, 0, 0, 0, 0, 0] : [...firstKey.position, ...firstKey.target];
    lead = values.map((value) => spring(value));
    cam = values.map((value) => spring(value));
    cameraDone = firstKey === null;
    cameraHeld = false;
    settled = null;
    finished = false;
  };

  const finishAll = (cameraToEnd: boolean): void => {
    for (const motion of motions.values()) { motion.started = true; motion.done = true; }
    for (const run of dressings.values()) { run.started = true; run.done = true; }
    for (const run of lightRuns.values()) { run.done = true; run.level.value = 0; run.level.velocity = 0; }
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
      if (!run.lit && run.wax.value > 0.8) run.lit = true;
      if (run.lit) {
        tick(run.flame, 1, DRESSING_FLAME, dt);
        tick(run.glow, 1, DRESSING_GLOW, dt);
      }
      if (run.lit && rests(run.wax, 1, REST.scale) && rests(run.flame, 1, REST.scale) && rests(run.glow, 1, REST.light)) run.done = true;
      else busy = true;
    }
    for (const run of lightRuns.values()) {
      if (run.done) continue;
      const up = now + 1e-9 >= run.light.on && now < run.light.off;
      tick(run.level, up ? 1 : 0, lightSpring, dt);
      if (now >= run.light.off && rests(run.level, 0, REST.light)) {
        run.level.value = 0;
        run.level.velocity = 0;
        run.done = true;
      } else {
        busy = true;
      }
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

  const finalPose = (): CameraPose | null => (finalKey === null
    ? null
    : { position: [...finalKey.position], target: [...finalKey.target] });

  return {
    seed,
    graph,
    pieces,
    lights,
    clipSeconds: model.clipSeconds,
    time: () => ticks / ASSEMBLY_TICK_RATE,
    done: () => finished,
    settledAt: () => settled,
    advanceTo: (seconds) => {
      const target = Math.max(0, Math.round(seconds * ASSEMBLY_TICK_RATE));
      if (target < ticks) {
        reset();
        if (options.reducedMotion === true) finishAll(false);
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
      restPose(motion.piece, out);
      if (motion.done) return true;
      if (!motion.started) {
        out.visible = false;
        out.shadow = 0;
        return true;
      }
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
    light: (id) => {
      const run = lightRuns.get(id);
      if (run === undefined || run.done) return 0;
      return Math.min(1, Math.max(0, run.level.value));
    },
    camera: () => {
      if (cameraHeld || finalKey === null) return null;
      const value = (index: number): number => cam[index]?.value ?? 0;
      return { position: [value(0), value(1), value(2)], target: [value(3), value(4), value(5)] };
    },
    finalCamera: finalPose,
    live: () => {
      const ids: string[] = [];
      for (const motion of motions.values()) if (motion.started && !motion.done) ids.push(motion.piece.id);
      return ids;
    },
  };
}
