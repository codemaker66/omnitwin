// -----------------------------------------------------------------------------
// turn — the mode-change from captured truth to planning truth, as pure math.
//
// The Turn never pretends the capture can be relit or replaced: the room
// recedes into drafting night (a scrim over the splat) while the planner's
// sheet materialises in the same space, then hands back before the act ends.
// The sheet's boundary derives from the CAPTURE's walked extent — not from
// the planner's room polygon, which is not yet registered to the splat frame
// — and prints no numeric dimensions for exactly that reason: no numbers we
// cannot back (see the living-hall plan's claim doctrine).
// -----------------------------------------------------------------------------

/** Floor rectangle for the sheet and the sandbox clamp, world metres.
 *  Derived from the scan trajectory's extent (x −6.58…3.97, z −0.66…12.44),
 *  inset to observed floor. Visual + clamp only — never printed as a size. */
export const TURN_FLOOR_BOUNDS = {
  minX: -6.0,
  maxX: 3.4,
  minZ: 0.6,
  maxZ: 11.8,
  floorY: -1.6,
} as const;

/** Hermite smoothstep on [edge0, edge1]. */
function smoothstep(edge0: number, edge1: number, x: number): number {
  const t = Math.min(1, Math.max(0, (x - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
}

/** The Turn's engagement over its act progress: night rises early (the act
 *  IS the mode change), holds while the visitor works the sheet, and hands
 *  the photoreal room back before the act ends. Scroll is the only clock. */
export function turnWeight(actProgress: number): number {
  return smoothstep(0.05, 0.3, actProgress) * (1 - smoothstep(0.85, 1.0, actProgress));
}

export interface YourTablePosition {
  readonly x: number;
  readonly z: number;
}

/** Keep the visitor's table on the observed floor, with margin for its own
 *  radius + chair ring so no part of it leaves the sheet. */
export function clampToFloorBounds(
  x: number,
  z: number,
  margin = 1.5,
): YourTablePosition {
  return {
    x: Math.min(TURN_FLOOR_BOUNDS.maxX - margin, Math.max(TURN_FLOOR_BOUNDS.minX + margin, x)),
    z: Math.min(TURN_FLOOR_BOUNDS.maxZ - margin, Math.max(TURN_FLOOR_BOUNDS.minZ + margin, z)),
  };
}

/** Where the visitor's table stands before they touch it. */
export const YOUR_TABLE_DEFAULT: YourTablePosition = { x: -2.0, z: 9.3 };

const STORAGE_KEY = "lh-your-table.v1";

/** The endowment persists: the table the visitor placed is still theirs on
 *  the next visit. Storage failures are silent — the feature degrades to
 *  session-only, never to an error. */
export function saveYourTable(position: YourTablePosition, room = "reception-room"): void {
  try {
    window.localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ v: 1, room, x: position.x, z: position.z }),
    );
  } catch {
    // Private mode / storage denied — session-only endowment.
  }
}

export function loadYourTable(room = "reception-room"): YourTablePosition | null {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (raw === null) return null;
    const parsed: unknown = JSON.parse(raw);
    if (
      typeof parsed !== "object" ||
      parsed === null ||
      (parsed as { v?: unknown }).v !== 1 ||
      (parsed as { room?: unknown }).room !== room
    ) {
      return null;
    }
    const x = (parsed as { x?: unknown }).x;
    const z = (parsed as { z?: unknown }).z;
    if (typeof x !== "number" || typeof z !== "number" || !Number.isFinite(x) || !Number.isFinite(z)) {
      return null;
    }
    return clampToFloorBounds(x, z);
  } catch {
    return null;
  }
}
