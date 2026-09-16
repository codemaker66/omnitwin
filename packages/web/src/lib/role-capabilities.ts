// ---------------------------------------------------------------------------
// Role capabilities — the one place the web decides what a role may reach
//
// Every set here mirrors a named gate in the API, and the comment above it
// says which. That pairing is the point: a navigation entry the API refuses is
// a dead end, and a route gate wider than its API is a 403 the user walked
// into. role-capabilities.test.ts holds the two together.
//
// Before this module the same matrix lived in five places — DashboardLayout,
// DashboardPage, router.tsx, role-routing.ts and event-access.ts — and had
// already drifted apart in four of them.
//
// Platform administrators are a different axis: `platformRole` is separate
// from the venue role (see packages/types/src/user.ts), so each consumer
// checks it alongside these sets rather than finding it inside them.
// ---------------------------------------------------------------------------

/** Mirrors `canManageVenue` — the base "works this venue's floor" capability. */
export const VENUE_FLOOR_ROLES = ["admin", "manager", "staff", "hallkeeper"] as const;

/** Mirrors `canAdministerVenue` — the venue record, its spaces, its pricing. */
export const VENUE_ADMIN_ROLES = ["admin", "manager", "staff"] as const;

/**
 * Mirrors `canManageCommercial` — proposals, quotes, enquiries, revenue.
 *
 * This covers the Analytics tab too, and it needs no "apply when #24 lands"
 * patch: ExecutiveAnalyticsView calls only `getVenueDashboardAnalytics()` →
 * `GET /analytics/venue-dashboard`, and THIS branch is the change that moves
 * that route from `canAccessInternalEvent` to `canManageCommercial`. So sales
 * is admitted the moment #19 merges, and the hallkeeper is refused — the
 * priced half of decision 6b. (Room utilisation, which carries no price,
 * stays on `canManageVenue`, but it arrives inside the same dashboard payload
 * rather than as a separate call, so it needs no separate nav gate.)
 */
export const COMMERCIAL_ROLES = ["admin", "manager", "staff", "sales"] as const;

/** Mirrors `canWriteInventory` — adjusting counted stock. */
export const INVENTORY_WRITE_ROLES = ["admin", "manager"] as const;

/** Mirrors `DIARY_READ_ROLES` in `ws/diary-live.ts`. */
export const DIARY_ROLES = ["admin", "manager", "staff", "hallkeeper", "sales"] as const;

/** The hallkeeper's day: `/hallkeeper/today`, the Day Board. */
export const VENUE_DAY_ROLES = ["admin", "manager", "staff", "hallkeeper"] as const;

/** Room plans, walkthrough, hallkeeper sheets, ops handoff. */
export const VENUE_ROOM_ROLES = ["admin", "manager", "staff", "hallkeeper", "planner"] as const;

/** Who may open the planner corridor. */
export const PLANNER_ROLES = ["admin", "manager", "staff", "planner"] as const;

/** Who may reach `/dashboard` at all. */
export const WORKSPACE_ROLES = ["admin", "manager", "staff", "sales", "hallkeeper", "planner"] as const;

/**
 * The CRM pipeline is NOT yet `canManageCommercial`.
 *
 * This module states the DEPLOYED route truth, and on release/r1 today
 * `routes/crm.ts:31` and `routes/opportunities.ts:38` still read
 * `user.role === "staff"` — they refuse a venue's own admin, and manager and
 * sales with it. So the Pipeline tab is offered to `staff` alone: a missing
 * tab is a better R1 than a tab that answers 403.
 *
 * Lane 7 (PR #24) widens both routes to `canManageCommercial` and merges
 * straight after this branch. The un-hide is then exactly one line here:
 *
 *     export const CRM_PIPELINE_ROLES = COMMERCIAL_ROLES;
 *
 * and `role-capabilities.test.ts` keeps nav-offer ⊆ route-admit honest either
 * way, so the change is safe to make the moment #24 lands.
 */
export const CRM_PIPELINE_ROLES = ["staff"] as const;

/** A caterer is event-scoped: it reaches an event through a share, never a venue surface. */
export const EVENT_SCOPED_ROLES = ["caterer"] as const;

export function hasRole(roles: readonly string[], role: string | null | undefined): boolean {
  return role !== null && role !== undefined && roles.includes(role);
}
