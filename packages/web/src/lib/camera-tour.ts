// ---------------------------------------------------------------------------
// camera-tour — cinematic "Showcase" fly-through of the planned venue.
//
// A multi-keyframe camera path: an aerial establishing shot high over the hall,
// a sweeping descent, and a glide down to a guest's eye level. It rides the
// same eased-interpolation primitives as the bookmark transition system
// (easeInOutCubic + lerpPosition), so the motion matches the rest of the app,
// and is consumed per-frame by CameraRig exactly like a transition — which
// already suspends the RTS controls during playback and restores them after.
//
// Pure and deterministic: `buildShowcaseTour` turns room dimensions into a leg
// sequence, `advanceCameraTour` ticks elapsed time, and `sampleCameraTour`
// returns the interpolated camera pose. Coordinates follow the planner scene
// convention — X/Z in render-space (room centred at the origin), Y in metres.
// ---------------------------------------------------------------------------

import type { SpaceDimensions } from "@omnitwin/types";
import { computeDefaultBookmarks, easeInOutCubic, lerpPosition } from "./camera-animation.js";

export interface CameraPose {
  readonly position: readonly [number, number, number];
  readonly target: readonly [number, number, number];
}

export interface CameraTourLeg {
  readonly from: CameraPose;
  readonly to: CameraPose;
  /** Seconds spent moving from `from` to `to`. */
  readonly durationSec: number;
  /** Seconds held at `to` before the next leg (lets a hero shot breathe). */
  readonly holdSec: number;
}

export interface CameraTour {
  readonly legs: readonly CameraTourLeg[];
  /** Total elapsed time across the whole tour, seconds. */
  readonly elapsedSec: number;
  /** Sum of every leg's duration + hold, seconds. */
  readonly totalSec: number;
}

export interface CameraTourSample {
  readonly position: readonly [number, number, number];
  readonly target: readonly [number, number, number];
  readonly done: boolean;
  /** Index of the leg currently playing (clamped to the last leg at the end). */
  readonly legIndex: number;
}

/** Per-leg travel time and the breath held on the final hero pose, seconds. */
const LEG_DURATION_SEC = 3;
const FINAL_HOLD_SEC = 1.2;

function totalDuration(legs: readonly CameraTourLeg[]): number {
  return legs.reduce((sum, leg) => sum + leg.durationSec + leg.holdSec, 0);
}

/** Build legs from a list of poses: consecutive pairs become moving legs. The
 *  last leg gets the final hold so the tour ends on a held shot. */
export function buildTourFromPoses(
  poses: readonly CameraPose[],
  legDurationSec: number = LEG_DURATION_SEC,
  finalHoldSec: number = FINAL_HOLD_SEC,
): CameraTour {
  const legs: CameraTourLeg[] = [];
  for (let i = 0; i < poses.length - 1; i += 1) {
    const from = poses[i];
    const to = poses[i + 1];
    if (from === undefined || to === undefined) continue;
    const isLast = i === poses.length - 2;
    legs.push({ from, to, durationSec: legDurationSec, holdSec: isLast ? finalHoldSec : 0 });
  }
  return { legs, elapsedSec: 0, totalSec: totalDuration(legs) };
}

/**
 * Compose a cinematic tour for a room: an aerial corner establishing shot, then
 * the three canonical planner viewpoints (overhead reveal → stage end → guest
 * entrance eye level). Reuses the proven default-bookmark poses so the
 * destinations match the manual camera bookmarks.
 */
export function buildShowcaseTour(dimensions: SpaceDimensions): CameraTour {
  const { width, length } = dimensions;
  const maxDim = Math.max(width, length);
  const defaults = computeDefaultBookmarks(dimensions);
  const overhead = defaults.find((b) => b.id === "default-overhead");
  const stage = defaults.find((b) => b.id === "default-stage");
  const entrance = defaults.find((b) => b.id === "default-entrance");

  // High aerial corner looking down at the room centre — the opening reveal.
  const aerial: CameraPose = {
    position: [(width / 2) * 0.85, maxDim * 0.95, (length / 2) * 0.85],
    target: [0, 1.2, 0],
  };

  const poses: CameraPose[] = [aerial];
  for (const bookmark of [overhead, stage, entrance]) {
    if (bookmark !== undefined) poses.push({ position: bookmark.position, target: bookmark.target });
  }

  return buildTourFromPoses(poses);
}

/** Advance the tour clock by `deltaSec`, clamped to the total duration. */
export function advanceCameraTour(tour: CameraTour, deltaSec: number): CameraTour {
  const elapsedSec = Math.min(tour.totalSec, tour.elapsedSec + Math.max(0, deltaSec));
  return { ...tour, elapsedSec };
}

/**
 * Interpolated camera pose at the tour's current elapsed time. Within a leg's
 * travel phase the pose eases from `from` to `to`; during a hold it rests at
 * `to`. `done` becomes true once the whole tour has elapsed.
 */
export function sampleCameraTour(tour: CameraTour): CameraTourSample {
  const { legs } = tour;
  if (legs.length === 0) {
    return { position: [0, 0, 0], target: [0, 0, 0], done: true, legIndex: 0 };
  }

  const done = tour.elapsedSec >= tour.totalSec;
  let cursor = tour.elapsedSec;

  for (let i = 0; i < legs.length; i += 1) {
    const leg = legs[i];
    if (leg === undefined) continue;
    const legSpan = leg.durationSec + leg.holdSec;

    if (cursor < legSpan || i === legs.length - 1) {
      // During the moving phase, ease; during the hold (or past the end), rest at `to`.
      const moveT = leg.durationSec > 0 ? Math.min(1, cursor / leg.durationSec) : 1;
      const eased = easeInOutCubic(moveT);
      return {
        position: lerpPosition(leg.from.position, leg.to.position, eased),
        target: lerpPosition(leg.from.target, leg.to.target, eased),
        done,
        legIndex: i,
      };
    }

    cursor -= legSpan;
  }

  // Unreachable (the last leg always returns above), but satisfies the compiler.
  const last = legs[legs.length - 1];
  return {
    position: last?.to.position ?? [0, 0, 0],
    target: last?.to.target ?? [0, 0, 0],
    done: true,
    legIndex: legs.length - 1,
  };
}
