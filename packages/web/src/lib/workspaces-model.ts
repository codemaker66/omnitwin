import type { CockpitMode } from "./cockpit-modes.js";
import { hasRole } from "./role-capabilities.js";

// ---------------------------------------------------------------------------
// The staff workspaces (T-674, v2 slice 18; approved spec 4.6, 6.15, 4.2).
//
// v1's eleven lenses become five workspaces, each with one name: Design,
// Guests, Flow, Production and Costs. Run of show moves to Event details and
// Share to the next step, so neither is a workspace; v1's Ops lens (crew
// effort under the title "Run of show", finding C-17) is not one either.
// Production holds lighting, power, rigging and AV as parts of one panel.
//
// Pure: the names, the one line each row says, the Ctrl digit, which v1 lens
// mode the scene's overlays follow, and who may see any of it.
// ---------------------------------------------------------------------------

export const WORKSPACE_IDS = ["design", "guests", "flow", "production", "costs"] as const;
export type WorkspaceId = (typeof WORKSPACE_IDS)[number];

export const PRODUCTION_PARTS = ["lighting", "power", "rigging", "av"] as const;
export type ProductionPart = (typeof PRODUCTION_PARTS)[number];

export interface WorkspaceEntry {
  readonly id: WorkspaceId;
  /** The menu's name, the key's name and the panel's title: one name (F-32). */
  readonly name: string;
  /** What it holds, in one line. */
  readonly line: string;
  /** Ctrl and this digit choose it. */
  readonly digit: 1 | 2 | 3 | 4 | 5;
}

/**
 * The five, in the menu's order. The lines say only what the bodies show:
 * Guests has no dietary needs to show and Costs works from rates the person
 * enters, so neither row promises more (the frame's "and their needs" and
 * "What this layout costs" did).
 */
export const WORKSPACES: readonly WorkspaceEntry[] = [
  { id: "design", name: "Design", line: "Snap, guides and overlays", digit: 1 },
  { id: "guests", name: "Guests", line: "Guests, seats and what the room holds", digit: 2 },
  { id: "flow", name: "Flow", line: "Arrivals, exits and the evidence", digit: 3 },
  { id: "production", name: "Production", line: "Lighting, power, rigging and AV", digit: 4 },
  { id: "costs", name: "Costs", line: "Costs at the rates you enter", digit: 5 },
];

export const PRODUCTION_PART_NAMES: Readonly<Record<ProductionPart, string>> = {
  lighting: "Lighting",
  power: "Power",
  rigging: "Rigging",
  av: "AV",
};

export function workspaceEntry(id: WorkspaceId): WorkspaceEntry {
  const entry = WORKSPACES.find((candidate) => candidate.id === id);
  if (entry === undefined) throw new Error(`Unknown workspace ${id}`);
  return entry;
}

/**
 * The v1 lens mode the room's overlays and the map follow while a workspace
 * is open: flow paths draw in Flow, light levels in Production's Lighting.
 * With no workspace open the room is in Design.
 */
export function cockpitModeFor(workspace: WorkspaceId | null, part: ProductionPart): CockpitMode {
  if (workspace === null) return "design";
  if (workspace === "production") return part;
  return workspace;
}

/**
 * Who sees the workspace menu, its keys and its panel (spec 4.6): the venue's
 * floor, the API's `canManageVenue` (admin, manager, staff, hallkeeper), the
 * same set that reads internal event data (`lib/event-access.ts`), so no body
 * here asks the API for something it would refuse. A platform administrator
 * sees them too. Clients, planners, caterers and guests never do.
 *
 * Sales stays on the client view until Blake answers decision D4 (spec 16:
 * "See the staff planner (workspaces, costs, Send to the client); changes who
 * reads internal event data"; L3 asked him on 26 Oct 2026). If he says yes,
 * add "sales" here and to `canReadInternalEventData` together, with the
 * access-control test at the API boundary that slice 18 names.
 */
export const STAFF_WORKSPACE_ROLES = ["admin", "manager", "staff", "hallkeeper"] as const;

export interface WorkspaceViewerAuth {
  readonly isLoading: boolean;
  readonly isAuthenticated: boolean;
  readonly user: {
    readonly role: string;
    readonly platformRole: string;
    readonly venueId: string | null;
  } | null;
}

/**
 * Whether this person sees the workspaces on this plan: one of the roles above
 * at the plan's own venue (a floor member of another venue opening this plan
 * is a visitor here), or a platform administrator. With the plan's venue not
 * known yet, nobody does, so the client's view shows first and never flashes.
 */
export function canUseWorkspaces(auth: WorkspaceViewerAuth, planVenueId: string | null): boolean {
  if (auth.isLoading || !auth.isAuthenticated || auth.user === null) return false;
  if (auth.user.platformRole === "admin") return true;
  if (!hasRole(STAFF_WORKSPACE_ROLES, auth.user.role)) return false;
  return auth.user.venueId !== null && planVenueId !== null && auth.user.venueId === planVenueId;
}
