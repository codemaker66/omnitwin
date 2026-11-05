// ---------------------------------------------------------------------------
// The slate's room switch (QoL D-X3). Opening another room keeps the same
// planner page: /plan/<layout> becomes /plan?space=<room>. The page's
// bootstrap only opens a room's layout when no layout is open, so on its own
// the switch changed the address and nothing else. The switch therefore says,
// in the navigation's state, which layout it is leaving, and the page closes
// that one (the bootstrap then opens the room). Only that layout is closed:
// the one the bootstrap opens at the same address stays.
//
// The slate settles the leaving layout's work before it navigates (saved,
// kept on this device, or the person chose to go without it), and approves
// its own navigation once. Arriving at that history entry any other way (Back,
// then Forward, while the room was still opening) is not approved: the page
// gives the open layout's work its chance to save first, as the slate would.
// ---------------------------------------------------------------------------

export interface RoomSwitchState {
  readonly leavingLayout: string;
  readonly approval: string;
}

let pendingApproval: string | null = null;
let approvals = 0;

/** The state for the slate's room switch; its navigation is approved once. */
export function roomSwitchState(leavingLayout: string): RoomSwitchState {
  approvals += 1;
  const approval = `${leavingLayout}#${String(approvals)}`;
  pendingApproval = approval;
  return { leavingLayout, approval };
}

/** The room switch a navigation's state carries; null for any other navigation. */
export function roomSwitchFrom(state: unknown): RoomSwitchState | null {
  if (typeof state !== "object" || state === null) return null;
  const leaving: unknown = Reflect.get(state, "leavingLayout");
  const approval: unknown = Reflect.get(state, "approval");
  if (typeof leaving !== "string" || leaving.length === 0) return null;
  return { leavingLayout: leaving, approval: typeof approval === "string" ? approval : "" };
}

/** True once for the slate's own navigation, whose work it already settled. */
export function takeRoomSwitchApproval(switchState: RoomSwitchState): boolean {
  if (pendingApproval === null || pendingApproval !== switchState.approval) return false;
  pendingApproval = null;
  return true;
}
