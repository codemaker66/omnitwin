import { create } from "zustand";

// ---------------------------------------------------------------------------
// The rail as a drop target (T-671 C0; card-dock spec §3 and §8.1, Q-15).
//
// A contract between lanes: the rail (components/planner-chrome/Rail.tsx)
// publishes where it stands and which target it is showing; whatever moves a
// placed piece (SelectionSystem) only reads isNearRail and isOverRail. Points
// are client CSS pixels, as pointer events give them.
//
// Within 96 px the rail becomes the return target; further away a move is
// ordinary, so moving tables near the bottom of the room stays ordinary. Once
// the rail has lifted as the return target, a release on it or within 16 px
// of it puts the piece back.
// ---------------------------------------------------------------------------

/** How near a moved piece must come before the rail becomes the return target. */
export const RAIL_RETURN_REACH_PX = 96;

/** How far beyond the lifted rail a release still lands on it. */
export const RAIL_DROP_MARGIN_PX = 16;

export interface RailRect {
  readonly left: number;
  readonly top: number;
  readonly right: number;
  readonly bottom: number;
}

/** What the rail is showing: nothing, "Put back" (a piece being moved), or Replace (a card over a selected piece). */
export type RailTarget = "none" | "return" | "replace";

interface RailDropState {
  /** Where the rail stands now, or null while it is not on screen. */
  readonly rect: RailRect | null;
  readonly target: RailTarget;
  readonly setRect: (rect: RailRect | null) => void;
  readonly setTarget: (target: RailTarget) => void;
  readonly reset: () => void;
}

export const useRailDropStore = create<RailDropState>()((set) => ({
  rect: null,
  target: "none",
  setRect: (rect) => { set({ rect }); },
  setTarget: (target) => { set({ target }); },
  reset: () => { set({ rect: null, target: "none" }); },
}));

/** How far a point lies outside a rect (0 inside it). */
function distanceTo(rect: RailRect, x: number, y: number): number {
  const dx = Math.max(rect.left - x, 0, x - rect.right);
  const dy = Math.max(rect.top - y, 0, y - rect.bottom);
  return Math.hypot(dx, dy);
}

/** Whether a piece moved to this point is near enough to make the rail the return target. */
export function isNearRail(x: number, y: number): boolean {
  const { rect } = useRailDropStore.getState();
  return rect !== null && distanceTo(rect, x, y) <= RAIL_RETURN_REACH_PX;
}

/** Whether a release at this point lands on the rail (and, once it has lifted, its 16 px margin). */
export function isOverRail(x: number, y: number): boolean {
  const { rect, target } = useRailDropStore.getState();
  if (rect === null) return false;
  const margin = target === "return" ? RAIL_DROP_MARGIN_PX : 0;
  return distanceTo(rect, x, y) <= margin;
}
