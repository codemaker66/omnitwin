// ---------------------------------------------------------------------------
// The slate's room switch (QoL D-X3). Opening another room keeps the same
// planner page: /plan/<layout> becomes /plan?space=<room>. The page's
// bootstrap only opens a room's layout when no layout is open, so on its own
// the switch changed the address and nothing else. The switch therefore says,
// in the navigation's state, which layout it is leaving: the page closes that
// one (its unsaved work has already had its chance to save) and the bootstrap
// opens the room. Only that layout is closed: the one the bootstrap then opens
// at the same address stays.
// ---------------------------------------------------------------------------

export interface RoomSwitchState {
  readonly leavingLayout: string;
}

export function roomSwitchState(leavingLayout: string): RoomSwitchState {
  return { leavingLayout };
}

/** The layout a room switch is leaving, from a navigation's state; null for any other navigation. */
export function layoutLeftByRoomSwitch(state: unknown): string | null {
  if (typeof state !== "object" || state === null) return null;
  const leaving: unknown = Reflect.get(state, "leavingLayout");
  return typeof leaving === "string" && leaving.length > 0 ? leaving : null;
}
