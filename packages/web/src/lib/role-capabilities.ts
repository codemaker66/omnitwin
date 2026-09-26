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
 * The Analytics tab. What it opens is `ExecutiveAnalyticsView`, whose only
 * call is `getVenueDashboardAnalytics()` → `GET /analytics/venue-dashboard`,
 * and that route reads `canManageCommercial` (`routes/revenue-analytics.ts`):
 * admin, manager, staff and sales, never the hallkeeper — the priced half of
 * decision 6b. Room utilisation keeps `canManageVenue`, but no web surface
 * calls `/analytics/room-utilisation` on its own; its rows arrive inside the
 * venue-dashboard payload, so it needs no nav gate.
 */
export const ANALYTICS_ROLES = COMMERCIAL_ROLES;

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
 * The CRM pipeline: `GET /crm/pipeline`, `/crm/pipeline/value`,
 * `POST /crm/from-enquiry/:id` and the `/opportunities` routes all read
 * `canManageCommercial` (`routes/crm.ts`, `routes/opportunities.ts`), so the
 * Pipeline tab is offered to exactly that set: admin, manager, staff and sales.
 */
export const CRM_PIPELINE_ROLES = COMMERCIAL_ROLES;

/** A caterer is event-scoped: it reaches an event through a share, never a venue surface. */
export const EVENT_SCOPED_ROLES = ["caterer"] as const;

export function hasRole(roles: readonly string[], role: string | null | undefined): boolean {
  return role !== null && role !== undefined && roles.includes(role);
}
