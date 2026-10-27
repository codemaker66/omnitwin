// ---------------------------------------------------------------------------
// The touch arbiter (spec-card-dock §10.1, law 12)
//
// One state machine decides what each touch on the room is, so a finger is
// never the camera's and a piece's at once:
//
//   idle --first finger--> pending
//   pending  a second finger (any time)            -> two     walk and zoom; nothing placed or lifted
//            moved past the slop before a hold      -> orbit   look round, even with a card in hand
//            lifted within the slop before a hold   -> tap     place under the finger, or select
//            armed, held 150 ms within the slop     -> place   the ghost rises above the finger
//            unarmed on a piece, held 300 ms        -> lift    the piece rises and follows
//   place    lifted: placed where the ghost was seen; a second finger places nothing
//   lift     lifted: dropped; a second finger returns the piece where it was
//
// It is pure: times are the events' own timestamps, so a page too busy to run
// its timers on time still reads a held press as held. The planner's handlers
// (components/SelectionSystem.tsx) feed it and act on what it decides.
// ---------------------------------------------------------------------------

/** A finger that travels no further than this is holding still, CSS px. */
export const TOUCH_SLOP_PX = 8;
/** An armed press held this long raises the ghost, ms. */
export const PLACE_HOLD_MS = 150;
/** A press on a placed piece held this long lifts it, ms. */
export const LIFT_HOLD_MS = 300;
/** The hold ring appears this long into a press that could lift, and fills until the lift, ms. */
export const HOLD_RING_DELAY_MS = 100;
/** The ghost and a lifted piece sit this far above the finger, so the finger never hides them, CSS px. */
export const GHOST_RAISE_PX = 64;
/** On a phone under 700 px tall. */
export const GHOST_RAISE_SHORT_PX = 56;
/** A lift places the ghost as it was this long before: the finger rolls as it leaves the glass, ms. */
export const LIFT_OFF_JITTER_MS = 40;

/** How far above the finger the ghost sits on a view `viewportHeight` CSS px tall. */
export function ghostRaisePx(viewportHeight: number): number {
  return viewportHeight < 700 ? GHOST_RAISE_SHORT_PX : GHOST_RAISE_PX;
}

export type TouchMode = "idle" | "pending" | "orbit" | "two" | "place" | "lift";

export interface TouchPress {
  readonly pointerId: number;
  /** The event's timestamp, ms. */
  readonly at: number;
  readonly x: number;
  readonly y: number;
  /** Whether a card or piece is in hand. */
  readonly armed: boolean;
  /** Whether the press landed on a placed piece. */
  readonly onPiece: boolean;
}

/** What a gesture came to when its last finger left. */
export type TouchOutcome =
  | { readonly kind: "none" }
  | { readonly kind: "tap"; readonly armed: boolean; readonly x: number; readonly y: number }
  | { readonly kind: "place"; readonly at: number }
  | { readonly kind: "drop" };

const NONE: TouchOutcome = { kind: "none" };

export class TouchArbiter {
  private current: TouchMode = "idle";
  private first: TouchPress | null = null;
  private readonly down = new Set<number>();
  private latest: { x: number; y: number } | null = null;
  private returned = false;

  /** What the touch on the room is now. */
  get mode(): TouchMode {
    return this.current;
  }

  /** Whether no finger is on the room. */
  get idle(): boolean {
    return this.current === "idle";
  }

  /** Fingers still on the glass. */
  get fingers(): number {
    return this.down.size;
  }

  /** Where the first finger is, CSS px, while the gesture lasts. */
  get finger(): { readonly x: number; readonly y: number } | null {
    return this.latest;
  }

  /** Whether the lifted piece went back where it was (a second finger, or a cancelled touch). */
  get liftCancelled(): boolean {
    return this.returned;
  }

  /** A finger landed on the room. */
  press(press: TouchPress): TouchMode {
    this.down.add(press.pointerId);
    if (this.current === "idle") {
      this.first = press;
      this.latest = { x: press.x, y: press.y };
      this.returned = false;
      this.current = "pending";
      return this.current;
    }
    if (this.current === "lift") this.returned = true;
    this.current = "two";
    return this.current;
  }

  /** A hold timer fired at `at` (ms): a press still waiting may now be a hold. */
  tick(at: number): TouchMode {
    this.advance(at);
    return this.current;
  }

  /** A finger moved, at its event's `at` (ms). Only the first finger steers. */
  move(pointerId: number, at: number, x: number, y: number): TouchMode {
    const first = this.first;
    if (first === null || pointerId !== first.pointerId || !this.down.has(pointerId)) return this.current;
    this.advance(at);
    if (this.current === "pending" && Math.hypot(x - first.x, y - first.y) > TOUCH_SLOP_PX) this.current = "orbit";
    if (this.current !== "orbit" && this.current !== "two") this.latest = { x, y };
    return this.current;
  }

  /** A finger left the glass. The gesture ends when the last one does. */
  release(pointerId: number, at: number, x: number, y: number): TouchOutcome {
    if (!this.down.delete(pointerId)) return NONE;
    if (this.current === "two") {
      if (this.down.size === 0) this.reset();
      return NONE;
    }
    const first = this.first;
    if (first === null || pointerId !== first.pointerId) return NONE;
    this.advance(at);
    const ended = this.current;
    this.down.clear();
    this.reset();
    if (ended === "pending") return { kind: "tap", armed: first.armed, x, y };
    if (ended === "place") return { kind: "place", at };
    if (ended === "lift") return { kind: "drop" };
    return NONE;
  }

  /** The browser took the touch away (a cancel, a lost window): nothing placed, a lifted piece returned. */
  cancel(): void {
    if (this.current === "lift") this.returned = true;
    this.down.clear();
    this.reset();
  }

  /**
   * How full the hold ring is at `at` (ms), 0 to 1, or null when it is not
   * shown: only on a still press on a piece that could lift, after 100 ms.
   */
  holdProgress(at: number): number | null {
    const first = this.first;
    if (this.current !== "pending" || first === null || first.armed || !first.onPiece) return null;
    const held = at - first.at - HOLD_RING_DELAY_MS;
    if (held < 0) return null;
    return Math.min(1, held / (LIFT_HOLD_MS - HOLD_RING_DELAY_MS));
  }

  private advance(at: number): void {
    const first = this.first;
    if (this.current !== "pending" || first === null) return;
    const held = at - first.at;
    if (first.armed && held >= PLACE_HOLD_MS) this.current = "place";
    else if (!first.armed && first.onPiece && held >= LIFT_HOLD_MS) this.current = "lift";
  }

  private reset(): void {
    this.current = "idle";
    this.first = null;
    this.latest = null;
  }
}

/** Points kept: about a second of a finger reporting at 60 Hz. */
const TRAIL_POINTS = 64;

/**
 * Where a finger has been, so a lift can place the ghost where it was seen
 * rather than where the finger rolled to as it left the glass.
 */
export class FingerTrail {
  private readonly points: { at: number; x: number; y: number }[] = [];

  /** Points held. */
  get size(): number {
    return this.points.length;
  }

  /** The finger was at (`x`, `y`) at `at` (ms). */
  record(at: number, x: number, y: number): void {
    this.points.push({ at, x, y });
    if (this.points.length > TRAIL_POINTS) this.points.shift();
  }

  /** Where the finger was at `at` (ms): the last point at or before it, else the first; null when empty. */
  at(at: number): { readonly x: number; readonly y: number } | null {
    let found = this.points[0];
    for (const point of this.points) {
      if (point.at > at) break;
      found = point;
    }
    return found === undefined ? null : { x: found.x, y: found.y };
  }

  clear(): void {
    this.points.length = 0;
  }
}
