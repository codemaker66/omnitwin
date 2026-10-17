// ---------------------------------------------------------------------------
// Furniture motion — transient spring motion for placed furniture.
//
// The store is truth: on move release the SNAPPED position is written
// immediately (undo, autosave and the footprint engines all see the final
// value at once). What animates is purely visual, carried on the outer
// `furniture-<id>` group (React manages the inner mesh's position and never
// writes the outer group's, so the motion can be applied imperatively without
// fighting reconciliation — the same division of labour the splat dissolve
// engine uses):
//
// - the grid settle: the difference between where the hand left an object
//   and where it snapped, decaying to zero through the gridSettle spring;
// - the carry: while a hand moves a piece it leans a little back from the
//   way it travels, as anything carried lags behind its handle;
// - the landing: let go, it swings through upright and settles in a couple
//   of soft rocks, and gives a small squash as it sets its weight down;
// - the drop-in: a newly placed piece comes down from a hand's width above
//   the floor and lands the same way.
//
// The lean pivots on the piece's base and the squash keeps its volume, so it
// never lifts off or sinks through the floor. Interruption rule: grabbing an
// object mid-settle clears its settle offset first, snapping the visual to
// store truth before the grab offset is measured; its lean carries on.
// ---------------------------------------------------------------------------

import { Matrix4, Quaternion, Vector3 } from "three";
import { SPRING_PRESETS, isSpringSettled, stepSpring, type SpringState } from "./springs.js";

interface MotionChannel {
  /** Grid settle offset, metres, decaying to zero. */
  readonly x: SpringState;
  readonly z: SpringState;
  /** Height above the floor while dropping in, metres. */
  readonly lift: SpringState;
  /** Vertical squash: −0.05 is five per cent lower (and wider). */
  readonly squash: SpringState;
  /** How far the top leans, radians, toward +x and +z. */
  readonly leanX: SpringState;
  readonly leanZ: SpringState;
  leanTargetX: number;
  leanTargetZ: number;
  /** Seconds since the hand last moved it: a paused hand lets it stand up again. */
  sinceCarry: number;
  /** A drop-in that has not yet touched down. */
  dropping: boolean;
}

/** The lean while carried, radians per metre a second, and its most (about 4°) in any direction. */
const LEAN_PER_SPEED = 0.04;
const LEAN_MOST = 0.07;
/** The squash's downward speed as a piece is set down (a peak of about 3.5 per cent). */
const SET_DOWN_SQUASH = 1.35;
/** A new piece starts this high above the floor, metres. */
const DROP_HEIGHT = 0.14;
/** Below this a drop-in has landed, metres. */
const LANDED = 0.004;
/** A motion's first step, seconds: one display frame. */
const FIRST_STEP = 1 / 60;
/** The longest step a moving piece takes, seconds: a dropped frame, never a pause. */
const LONGEST_STEP = 0.1;

const channels = new Map<string, MotionChannel>();
/** Whether the last step left anything moving; if not, the frame loop may have slept since. */
let movedLastStep = false;

function channel(id: string): MotionChannel {
  const existing = channels.get(id);
  if (existing !== undefined) return existing;
  const created: MotionChannel = {
    x: { value: 0, velocity: 0 },
    z: { value: 0, velocity: 0 },
    lift: { value: 0, velocity: 0 },
    squash: { value: 0, velocity: 0 },
    leanX: { value: 0, velocity: 0 },
    leanZ: { value: 0, velocity: 0 },
    leanTargetX: 0,
    leanTargetZ: 0,
    sinceCarry: 0,
    dropping: false,
  };
  channels.set(id, created);
  return created;
}

/**
 * Begin a settle: the object is visually at store-position + offset and the
 * spring carries the offset to zero. Re-seeding an id retargets in place —
 * velocity survives, which is what makes rapid re-drags feel continuous.
 */
export function beginFurnitureSettle(id: string, offsetX: number, offsetZ: number): void {
  const motion = channel(id);
  motion.x.value += offsetX;
  motion.z.value += offsetZ;
}

/**
 * A hand is carrying these pieces at (velocityX, velocityZ) metres a second:
 * their tops lean back from the way they travel. Call on each move.
 */
export function carryFurniture(ids: Iterable<string>, velocityX: number, velocityZ: number): void {
  const speed = Math.hypot(velocityX, velocityZ);
  const scale = speed * LEAN_PER_SPEED > LEAN_MOST ? LEAN_MOST / speed : LEAN_PER_SPEED;
  for (const id of ids) {
    const motion = channel(id);
    motion.leanTargetX = -velocityX * scale;
    motion.leanTargetZ = -velocityZ * scale;
    motion.sinceCarry = 0;
  }
}

/** The carrying hand's smoothed speed, metres a second, and when it last moved, ms. */
export interface CarrySpeed {
  /** The last move's time (performance.now), or null before the drag's first move. */
  readonly at: number | null;
  readonly vx: number;
  readonly vz: number;
  /** False until a move has been timed against the one before it. */
  readonly measured: boolean;
}

/** A drag that has not moved yet. */
export const CARRY_AT_REST: CarrySpeed = { at: null, vx: 0, vz: 0, measured: false };

/**
 * The hand's speed after it moved the pieces (dx, dz) metres at `nowMs`.
 * A drag's first move carries all the travel since the press, the drag
 * threshold and more, over no known time, so it only starts the clock. The
 * next move is the first true reading and seeds the speed outright; later
 * ones blend in, which steadies the jitter of pointer events.
 */
export function measureCarry(previous: CarrySpeed, dx: number, dz: number, nowMs: number): CarrySpeed {
  if (previous.at === null) return { at: nowMs, vx: 0, vz: 0, measured: false };
  const elapsed = Math.min(0.1, Math.max(0.004, (nowMs - previous.at) / 1000));
  const blend = previous.measured ? 0.35 : 1;
  return {
    at: nowMs,
    vx: previous.vx + (dx / elapsed - previous.vx) * blend,
    vz: previous.vz + (dz / elapsed - previous.vz) * blend,
    measured: true,
  };
}

/** The hand has let go: the pieces swing upright and set their weight down. */
export function releaseFurniture(ids: Iterable<string>): void {
  for (const id of ids) {
    const motion = channel(id);
    motion.leanTargetX = 0;
    motion.leanTargetZ = 0;
    motion.squash.velocity -= SET_DOWN_SQUASH;
  }
}

/** A newly placed piece comes down onto the floor; `height` defaults to a hand's width. */
export function dropInFurniture(id: string, height: number = DROP_HEIGHT): void {
  const motion = channel(id);
  motion.lift.value = height;
  motion.lift.velocity = 0;
  motion.dropping = true;
}

/** Drop one object's settle (grab-interrupt) — visual snaps to store truth; its lean carries on. */
export function clearFurnitureSettle(id: string): void {
  const motion = channels.get(id);
  if (motion === undefined) return;
  motion.x.value = 0;
  motion.x.velocity = 0;
  motion.z.value = 0;
  motion.z.velocity = 0;
  if (atRest(motion)) channels.delete(id);
}

/** Drop everything (room change, scene unmount). */
export function clearAllFurnitureSettles(): void {
  channels.clear();
  movedLastStep = false;
}

export function activeFurnitureSettleCount(): number {
  return channels.size;
}

/** Current settle offset for an id, or null once at rest or absent. */
export function furnitureSettleOffset(id: string): { x: number; z: number } | null {
  const motion = channels.get(id);
  if (motion === undefined) return null;
  return { x: motion.x.value, z: motion.z.value };
}

export interface FurnitureMotionPose {
  readonly x: number;
  readonly z: number;
  readonly lift: number;
  readonly squash: number;
  readonly leanX: number;
  readonly leanZ: number;
}

/** The whole visual motion of an id, or null once at rest or absent. */
export function furnitureMotionPose(id: string): FurnitureMotionPose | null {
  const motion = channels.get(id);
  if (motion === undefined) return null;
  return {
    x: motion.x.value,
    z: motion.z.value,
    lift: motion.lift.value,
    squash: motion.squash.value,
    leanX: motion.leanX.value,
    leanZ: motion.leanZ.value,
  };
}

const lean = new Quaternion();
const leanAxis = new Vector3();
const scaled = new Vector3();
const origin = new Vector3();
const pivot = new Matrix4();

/**
 * The motion as a matrix about the piece's base at (baseX, baseY, baseZ):
 * moved by the settle offset and lift, leaned on its base, squashed with
 * its volume kept. Written into `target`, which is returned.
 */
export function composeFurnitureMotion(pose: FurnitureMotionPose, baseX: number, baseY: number, baseZ: number, target: Matrix4): Matrix4 {
  // The top moves along (leanX, leanZ): rotate about up × that direction.
  const angle = Math.hypot(pose.leanX, pose.leanZ);
  if (angle > 1e-7) lean.setFromAxisAngle(leanAxis.set(pose.leanZ / angle, 0, -pose.leanX / angle), angle);
  else lean.identity();
  const spread = 1 - pose.squash * 0.5;
  scaled.set(spread, 1 + pose.squash, spread);
  target.compose(origin.set(0, 0, 0), lean, scaled);
  // About the base: T(base + offset) · R · S · T(−base).
  pivot.makeTranslation(-baseX, -baseY, -baseZ);
  target.multiply(pivot);
  pivot.makeTranslation(baseX + pose.x, baseY + pose.lift, baseZ + pose.z);
  return target.premultiply(pivot);
}

function atRest(motion: MotionChannel): boolean {
  return isSpringSettled(motion.x, 0) && isSpringSettled(motion.z, 0)
    && isSpringSettled(motion.lift, 0) && isSpringSettled(motion.squash, 0, 0.0005)
    && motion.leanTargetX === 0 && motion.leanTargetZ === 0
    && isSpringSettled(motion.leanX, 0, 0.0005) && isSpringSettled(motion.leanZ, 0, 0.0005);
}

/**
 * Advance every live motion by one frame of `frameDeltaSeconds`, the frame
 * loop's delta. Motions at rest are pruned so the demand loop can go back to
 * sleep. Returns the ids that still move this frame (the caller applies them,
 * then invalidates while any remain).
 *
 * The on-demand loop's waking frame reports the whole idle gap as its delta:
 * stepped as given, a drop-in or a set-down would spend most of its motion
 * before it was ever drawn, and a hand just starting to carry would count as
 * paused. So the first step after nothing moved is one display frame, and
 * later steps take the real delta, capped as a dropped frame.
 */
export function stepFurnitureSettles(frameDeltaSeconds: number): readonly string[] {
  if (channels.size === 0) {
    movedLastStep = false;
    return [];
  }
  const dtSeconds = movedLastStep ? Math.min(frameDeltaSeconds, LONGEST_STEP) : FIRST_STEP;
  const live: string[] = [];
  for (const [id, motion] of channels) {
    // A hand that has paused lets the piece stand up again.
    motion.sinceCarry += dtSeconds;
    if (motion.sinceCarry > 0.08 && (motion.leanTargetX !== 0 || motion.leanTargetZ !== 0)) {
      const fade = Math.exp(-dtSeconds * 9);
      motion.leanTargetX = Math.abs(motion.leanTargetX) < 1e-4 ? 0 : motion.leanTargetX * fade;
      motion.leanTargetZ = Math.abs(motion.leanTargetZ) < 1e-4 ? 0 : motion.leanTargetZ * fade;
    }
    stepSpring(motion.x, 0, dtSeconds, SPRING_PRESETS.gridSettle);
    stepSpring(motion.z, 0, dtSeconds, SPRING_PRESETS.gridSettle);
    stepSpring(motion.leanX, motion.leanTargetX, dtSeconds, SPRING_PRESETS.furnitureLean);
    stepSpring(motion.leanZ, motion.leanTargetZ, dtSeconds, SPRING_PRESETS.furnitureLean);
    stepSpring(motion.squash, 0, dtSeconds, SPRING_PRESETS.furnitureSquash);
    if (motion.dropping) {
      stepSpring(motion.lift, 0, dtSeconds, SPRING_PRESETS.furnitureDrop);
      if (motion.lift.value < LANDED) {
        // Touchdown: the weight arrives, and a whisper of a rock.
        motion.dropping = false;
        motion.squash.velocity -= SET_DOWN_SQUASH * Math.min(1, Math.abs(motion.lift.velocity) / 0.6);
        motion.lift.value = 0;
        motion.lift.velocity = 0;
        motion.leanX.velocity += 0.12;
        motion.leanZ.velocity -= 0.08;
      }
    }
    if (atRest(motion)) channels.delete(id);
    else live.push(id);
  }
  movedLastStep = live.length > 0;
  return live;
}

/** Receives the ids that carry motion this frame. */
export type FurnitureSettleFrameListener = (live: readonly string[]) => void;

const settleFrameListeners = new Set<FurnitureSettleFrameListener>();
let lastFrameHadSettles = false;

/**
 * Follow the motion as it is applied, for furniture drawn outside its
 * `furniture-<id>` group (instanced models). Listeners hear each frame that
 * carries motion, then one frame without any, so they can return to store
 * truth. Returns the unsubscribe.
 */
export function subscribeFurnitureSettleFrames(listener: FurnitureSettleFrameListener): () => void {
  settleFrameListeners.add(listener);
  return () => { settleFrameListeners.delete(listener); };
}

/**
 * The applier calls this once per frame, straight after writing this frame's
 * motion, so every listener draws the same spring state before the render.
 */
export function publishFurnitureSettleFrame(live: readonly string[]): void {
  if (live.length === 0 && !lastFrameHadSettles) return;
  lastFrameHadSettles = live.length > 0;
  for (const listener of settleFrameListeners) listener(live);
}
