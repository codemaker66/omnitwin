// ---------------------------------------------------------------------------
// Which lenses each viewer of the planner sees (Blake's decision 5, CB-25).
//
// Two keys in planner-features.ts shape the rail, both off until Blake picks:
//
//   lensesByRole   clients and guests (an anonymous visitor to a shared /plan
//                  link, and anyone whose identity is still being checked)
//                  see Design, Guests, Costs and Share; the hallkeeper sees
//                  Design, Guests, Ops and Evidence; the venue team sees all
//                  eleven. Every lens shows its name under its icon.
//   lensesDivider  whoever sees the technical lenses gets the client's four
//                  first, then a "Venue tools" divider over the other seven,
//                  every lens named.
//
// With both on, the role filter runs first: the divider appears only where
// venue tools remain, so the hallkeeper's own four stand undivided. With both
// off the rail is today's: eleven unnamed icons in COCKPIT_MODES order.
//
// Pure and React-free, like cockpit-modes.ts, so the store's guard and the
// rail read one answer. Every rail is a constant, so a caller comparing rails
// by identity (a store selector, an effect's dependency) sees no change until
// the answer changes.
// ---------------------------------------------------------------------------

import { COCKPIT_MODES, type CockpitMode } from "./cockpit-modes.js";
import { hasRole, VENUE_MEMBER_ROLES } from "./role-capabilities.js";
import type { PlannerFeatures } from "./planner-features.js";

/** One lens as the rail draws it: its id and its name. */
export type CockpitLens = (typeof COCKPIT_MODES)[number];

/**
 * Whom the rail is for. `client-side` is everyone outside the venue team:
 * client, planner, caterer, an anonymous visitor, an unknown role, and an
 * identity not yet confirmed (least privilege, as canReadInternalEventData
 * refuses a pending identity). `venue-team` is the venue's floor and
 * commercial team apart from the hallkeeper (admin, manager, staff, sales),
 * and a platform administrator, who passes every venue gate.
 */
export type LensAudience = "client-side" | "hallkeeper" | "venue-team";

/** The auth store's shape, as far as the rail reads it. */
export interface LensViewer {
  readonly isLoading: boolean;
  readonly isAuthenticated: boolean;
  readonly user: { readonly role: string; readonly platformRole: string } | null;
}

export type LensKeys = Pick<PlannerFeatures, "lensesByRole" | "lensesDivider">;

/** A run of lenses; a labelled one sits under a divider bearing its label. */
export interface LensRailSection {
  readonly label: string | null;
  readonly lenses: readonly CockpitLens[];
}

export interface LensRail {
  /** Whether each lens shows its name under its icon. */
  readonly named: boolean;
  /** Every lens this viewer may open, in rail order. Design is always one. */
  readonly modes: readonly CockpitMode[];
  readonly sections: readonly LensRailSection[];
}

export const VENUE_TOOLS_LABEL = "Venue tools";

const CLIENT_SIDE_LENSES = ["design", "guests", "costs", "share"] as const satisfies readonly CockpitMode[];
const HALLKEEPER_LENSES = ["design", "guests", "ops", "evidence"] as const satisfies readonly CockpitMode[];
const VENUE_TOOL_LENSES = ["flow", "evidence", "lighting", "power", "rigging", "av", "ops"] as const satisfies readonly CockpitMode[];

function lensesOf(modes: readonly CockpitMode[]): readonly CockpitLens[] {
  return modes.map((id) => {
    const lens = COCKPIT_MODES.find((entry) => entry.id === id);
    if (lens === undefined) throw new Error(`Unknown cockpit lens: ${id}`);
    return lens;
  });
}

function rail(named: boolean, sections: readonly LensRailSection[]): LensRail {
  return {
    named,
    modes: sections.flatMap((section) => section.lenses.map((lens) => lens.id)),
    sections,
  };
}

/** Both keys off: today's rail. */
const TODAY_RAIL = rail(false, [{ label: null, lenses: COCKPIT_MODES }]);
/** lensesByRole alone, for the venue team: all eleven in today's order, named. */
const NAMED_RAIL = rail(true, [{ label: null, lenses: COCKPIT_MODES }]);
const CLIENT_SIDE_RAIL = rail(true, [{ label: null, lenses: lensesOf(CLIENT_SIDE_LENSES) }]);
const HALLKEEPER_RAIL = rail(true, [{ label: null, lenses: lensesOf(HALLKEEPER_LENSES) }]);
const DIVIDED_RAIL = rail(true, [
  { label: null, lenses: lensesOf(CLIENT_SIDE_LENSES) },
  { label: VENUE_TOOLS_LABEL, lenses: lensesOf(VENUE_TOOL_LENSES) },
]);

/** Whom the rail is for, from the auth store's state. */
export function lensAudienceOf(viewer: LensViewer): LensAudience {
  if (viewer.isLoading || !viewer.isAuthenticated || viewer.user === null) return "client-side";
  if (viewer.user.platformRole === "admin") return "venue-team";
  if (viewer.user.role === "hallkeeper") return "hallkeeper";
  return hasRole(VENUE_MEMBER_ROLES, viewer.user.role) ? "venue-team" : "client-side";
}

/** The rail this viewer sees under these keys. */
export function lensesFor(viewer: LensViewer, keys: LensKeys): LensRail {
  const audience = lensAudienceOf(viewer);
  if (keys.lensesByRole && audience === "client-side") return CLIENT_SIDE_RAIL;
  if (keys.lensesByRole && audience === "hallkeeper") return HALLKEEPER_RAIL;
  if (keys.lensesDivider) return DIVIDED_RAIL;
  return keys.lensesByRole ? NAMED_RAIL : TODAY_RAIL;
}

/** The lens the cockpit shows: the active one if this rail offers it, else Design. */
export function shownLens(active: CockpitMode, lensRail: LensRail): CockpitMode {
  return lensRail.modes.includes(active) ? active : "design";
}
