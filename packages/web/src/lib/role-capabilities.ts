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
 * Proposals is `ProposalsView` → `api/proposals.js`, and after #19 every
 * proposals route gates on `canManageCommercial` (`routes/proposals.ts`), so
 * the whole set may open the tab. #24 does not narrow it.
 */
export const COMMERCIAL_ROLES = ["admin", "manager", "staff", "sales"] as const;

/**
 * The Analytics tab — narrower than the route that serves it, on purpose.
 *
 * What the tab opens is `ExecutiveAnalyticsView`, whose only call is
 * `getVenueDashboardAnalytics()` → `GET /analytics/venue-dashboard`. At this
 * head that route reads `canManageCommercial`
 * (`routes/revenue-analytics.ts:313`, changed by #19), so it admits admin,
 * manager, staff AND sales, and refuses the hallkeeper — the priced half of
 * decision 6b. Lane 7's #24 makes the same split by payload ("priced" →
 * `canManageCommercial`, room utilisation → `canManageVenue`), so the two
 * branches agree on the answer.
 *
 * `sales` is nevertheless held back until #24 lands, at Lane 7's request on
 * its re-review of this branch. A narrower offer is never a dead end — the
 * rule is nav-offer ⊆ route-admit — so the hold costs a sales user one tab
 * between #19 and #24 and nothing else. The un-hide is one line, below.
 *
 * No web surface calls `/analytics/room-utilisation` on its own; the rows
 * arrive inside the venue-dashboard payload, so it needs no nav gate.
 */
export const ANALYTICS_ROLES = ["admin", "manager", "staff"] as const;

/**
 * Client search and the client profile behind it. All four `/clients` routes
 * gate on `canManageVenue` (`routes/clients.ts:36,145,231,293`), so sales and
 * planner are refused — both were being offered the tab.
 */
export const CLIENT_SEARCH_ROLES = VENUE_FLOOR_ROLES;

/**
 * The pending-review queue. Mirrors `VENUE_REVIEW_ROLES` in the API's
 * `state-machines/config-review.ts`, which now gates both the ten review
 * transitions and `GET /configurations/reviews/pending` — one set, so a role
 * that may approve a review can also list it. Hallkeeper, planner and sales
 * are refused there and are no longer offered the tab.
 */
export const REVIEW_QUEUE_ROLES = ["admin", "manager", "staff"] as const;

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
 * straight after this branch.
 *
 * PATCH TO APPLY WHEN #24 LANDS — two lines, and the values are exactly what
 * the routes admit once it has:
 *
 *     export const CRM_PIPELINE_ROLES = COMMERCIAL_ROLES;
 *       // routes/crm.ts and routes/opportunities.ts move from
 *       // `user.role === "staff"` to canManageCommercial:
 *       // admin, manager, staff, sales.
 *     export const ANALYTICS_ROLES = COMMERCIAL_ROLES;
 *       // the priced analytics routes (/analytics/pipeline-summary and
 *       // /analytics/venue-dashboard) admit canManageCommercial: admin,
 *       // manager, staff, sales. /analytics/room-utilisation stays on
 *       // canManageVenue (admin, manager, staff, hallkeeper) and has no tab.
 *
 * Nothing else moves: Proposals is already COMMERCIAL_ROLES, Client Search
 * stays on canManageVenue, and the review queue stays on REVIEW_QUEUE_ROLES.
 * `role-capabilities.test.ts` keeps nav-offer ⊆ route-admit honest either way,
 * so the change is safe to make the moment #24 lands.
 */
export const CRM_PIPELINE_ROLES = ["staff"] as const;

/** A caterer is event-scoped: it reaches an event through a share, never a venue surface. */
export const EVENT_SCOPED_ROLES = ["caterer"] as const;

export function hasRole(roles: readonly string[], role: string | null | undefined): boolean {
  return role !== null && role !== undefined && roles.includes(role);
}
