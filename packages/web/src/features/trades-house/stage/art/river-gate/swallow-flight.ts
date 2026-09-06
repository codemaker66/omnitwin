// -----------------------------------------------------------------------------
// swallow-flight — where the swallow is, pure over the scene's pokes and the
// clock. It hunts high over the town in a path built from incommensurate
// sines so it never visibly repeats; it leaves on its first poke; it comes
// back once, low over the water, on the manifest's "distinctProps:3" row,
// which the reaction layer fires on a poke of the swallow's own button once
// three different things in the room have been touched. After that it stays.
//
// The rule the drawing follows, so the plane and the reducer agree:
//   count 0                                            crossing
//   count >= 1, fewer than 3 distinct props touched    gone
//   count >= 2, 3 or more distinct props touched       back, and stays
// Provenance: Pr, drawn by code, 2026-09-06.
// -----------------------------------------------------------------------------
import type { PokeableState } from "../../../react/react-types.js";
import { byteLength } from "./viewbox.js";

/** The body and forked tail, local units, facing +x. */
export const SWALLOW_BODY_PATH = "M 5 0 Q 2 -1.4 -2 -0.8 L -7 -3.2 L -4 -0.2 L -7 3 L -2 0.8 Q 2 1.4 5 0 Z";
/** One swept wing; the other is its mirror. Seen from below, both project from the body line. */
export const SWALLOW_WING_PATH = "M 0 -0.7 Q 2 -4 7 -9 Q 1 -6 -3 -1.2 Z";
export const SWALLOW_BYTES = byteLength(SWALLOW_BODY_PATH, SWALLOW_WING_PATH);

export const SWALLOW_RETURNS_AT_DISTINCT_PROPS = 3;
export const SWALLOW_LEAVE_MS = 1600;
export const SWALLOW_RETURN_MS = 1600;
/** Where it holds under reduced motion. */
export const SWALLOW_STILL_POSE = { x: 760, y: 210 } as const;

export interface SwallowPose {
  readonly visible: boolean;
  readonly x: number;
  readonly y: number;
  /** 1 facing east, -1 facing west. */
  readonly facing: 1 | -1;
  /** 0 wings folded to the body line, 1 fully spread. */
  readonly wingSpread: number;
}

const HIDDEN: SwallowPose = { visible: false, x: 0, y: 0, facing: 1, wingSpread: 1 };

/** How many different things in the room have been touched. */
export function distinctPropsTouched(pokes: Readonly<Record<string, PokeableState>>): number {
  let touched = 0;
  for (const state of Object.values(pokes)) {
    if (state.count > 0) touched += 1;
  }
  return touched;
}

/** The hunting path over the town: bounded inside x 470..1170, y 157..253. */
export function swallowPathPoint(nowMs: number): { readonly x: number; readonly y: number; readonly facing: 1 | -1 } {
  const x = 820 + 260 * Math.sin(nowMs / 7900) + 90 * Math.sin(nowMs / 3100 + 1.3);
  const y = 205 + 36 * Math.sin(nowMs / 4300 + 0.4) + 12 * Math.sin(nowMs / 1500);
  const dx = (260 / 7900) * Math.cos(nowMs / 7900) + (90 / 3100) * Math.cos(nowMs / 3100 + 1.3);
  return { x, y, facing: dx >= 0 ? 1 : -1 };
}

/** Bursts of beats and glides between them, as a swallow flies. */
export function swallowWingSpread(nowMs: number): number {
  const beating = Math.sin(nowMs / 2300) > 0.15;
  if (!beating) return 0.85;
  return 0.35 + 0.65 * Math.abs(Math.sin(nowMs / 45));
}

const easeOut = (t: number): number => 1 - (1 - t) * (1 - t);

export function swallowPose(
  pokes: Readonly<Record<string, PokeableState>>,
  nowMs: number,
  reducedMotion: boolean,
): SwallowPose {
  const own = pokes["swallow"];
  const count = own?.count ?? 0;
  const lastPokeMs = own?.lastPokeMs ?? null;
  const returned = count >= 2 && distinctPropsTouched(pokes) >= SWALLOW_RETURNS_AT_DISTINCT_PROPS;

  if (reducedMotion) {
    if (count === 0 || returned) {
      return { visible: true, x: SWALLOW_STILL_POSE.x, y: SWALLOW_STILL_POSE.y, facing: 1, wingSpread: 0.85 };
    }
    return HIDDEN;
  }

  const path = swallowPathPoint(nowMs);
  const spread = swallowWingSpread(nowMs);

  if (count === 0) {
    return { visible: true, x: path.x, y: path.y, facing: path.facing, wingSpread: spread };
  }

  if (returned) {
    // Back in from the nearer edge, low over the water, rising to rejoin its path.
    const elapsed = lastPokeMs === null ? SWALLOW_RETURN_MS : nowMs - lastPokeMs;
    const t = Math.max(0, Math.min(1, elapsed / SWALLOW_RETURN_MS));
    const eased = easeOut(t);
    const edgeX = path.x < 800 ? -40 : 1640;
    return {
      visible: true,
      x: edgeX + (path.x - edgeX) * eased,
      y: path.y + (1 - eased) * 240,
      facing: path.x < 800 ? 1 : -1,
      wingSpread: 0.35 + 0.65 * Math.abs(Math.sin(nowMs / 45)),
    };
  }

  // Leaving: from where it was at the poke, faster and faster, up and away over the town.
  if (lastPokeMs === null) return HIDDEN;
  const elapsed = nowMs - lastPokeMs;
  if (elapsed < 0 || elapsed >= SWALLOW_LEAVE_MS) return HIDDEN;
  const t = elapsed / SWALLOW_LEAVE_MS;
  const at = swallowPathPoint(lastPokeMs);
  return {
    visible: true,
    x: at.x + at.facing * t * t * 900,
    y: at.y - t * 140,
    facing: at.facing,
    wingSpread: 0.35 + 0.65 * Math.abs(Math.sin(nowMs / 45)),
  };
}
