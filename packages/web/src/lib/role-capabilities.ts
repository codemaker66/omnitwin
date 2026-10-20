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

/** Mirrors `canAdministerVenue` — the venue record and its spaces. Pricing-rule
 *  writes are narrower (`PRICING_WRITE_ROLES` below: admin and manager). */
export const VENUE_ADMIN_ROLES = ["admin", "manager", "staff"] as const;

/**
 * Mirrors `canManageCommercial` — proposals, quotes, enquiries, revenue.
 *
 * Proposals is `ProposalsDesk` → `api/proposals.js`, and after #19 every
 * proposals route gates on `canManageCommercial` (`routes/proposals.ts`), so
 * the whole set may open the tab. #24 does not narrow it.
 */
export const COMMERCIAL_ROLES = ["admin", "manager", "staff", "sales"] as const;

/**
 * The Pricing tab: `GET /venues/:venueId/pricing-desk` reads
 * `canManageCommercial` (`routes/pricing-desk.ts`), so the commercial team
 * reads the price list and who changed each rate; the hallkeeper, who does
 * not see prices (goal 18 decision 6b), is not offered it.
 */
export const PRICING_READ_ROLES = COMMERCIAL_ROLES;

/**
 * Who sets a price, sees the desk's edit controls and its suggestions: the
 * API's `PRICING_WRITE_ROLES` (`canWritePricing`), read from the one list in
 * @omnitwin/types so the two cannot drift. Everyone else on the desk is told
 * who can.
 */
export { PRICING_WRITE_ROLES } from "@omnitwin/types";

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
 * The Clients desk. Mirrors `canReadClients` (`utils/query.ts`): its search,
 * recent and upcoming lists and the client and guest profiles admit the venue
 * floor and sales (People Book design §6.7, approved 18 October 2026); planner,
 * client and caterer are refused. The commercial record inside it (contacts,
 * organisations, deals, proposals) is further limited to the roles
 * `canManageCommercial` admits, so a hallkeeper still finds none of it.
 */
export const CLIENT_SEARCH_ROLES = ["admin", "manager", "staff", "hallkeeper", "sales"] as const;

/**
 * The pending-review queue. Mirrors `VENUE_REVIEW_ROLES` in the API's
 * `state-machines/config-review.ts`, which now gates both the ten review
 * transitions and `GET /configurations/reviews/pending` — one set, so a role
 * that may approve a review can also list it. Hallkeeper, planner and sales
 * are refused there and are no longer offered the tab.
 */
export const REVIEW_QUEUE_ROLES = ["admin", "manager", "staff"] as const;

/**
 * Mirrors `canWriteEvents` / `isEventWriteRole` (`utils/query.ts`): creating
 * and changing events, freezing a phase's layout (`routes/phase-layout-
 * snapshots.ts`) and guest-flow replays. Sales sells the room; the venue team
 * runs the day.
 */
export const EVENT_WRITE_ROLES = ["admin", "manager", "staff"] as const;

/**
 * Mirrors `DIARY_WRITE_ROLES` (`services/booking-mutations.ts`, and the
 * booking state machine's transition roles): creating, moving, editing and
 * deciding bookings, on the Diary and on the planner's When ribbon. The
 * hallkeeper reads the Diary but never writes it; a Diary control offered
 * outside this set ends in a 403.
 */
export const DIARY_WRITE_ROLES = ["admin", "staff"] as const;

/** The client's side of an event: the people the venue plans for, admitted to
 *  an event by its live link rather than by a venue role (goal 19 D2). */
export const CLIENT_SIDE_ROLES = ["client", "planner"] as const;

/** Who keeps a venue's inventory (its stock, reservations and internal
 *  requests): the server's `INVENTORY_ADJUSTER_ROLES`, held equal by test. */
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
 * Pipeline tab, and the Enquiries desk's "Create opportunity", are offered to
 * exactly that set: admin, manager, staff and sales.
 */
export const CRM_PIPELINE_ROLES = COMMERCIAL_ROLES;

/** A caterer is event-scoped: it reaches an event through a share, never a venue surface. */
export const EVENT_SCOPED_ROLES = ["caterer"] as const;

export function hasRole(roles: readonly string[], role: string | null | undefined): boolean {
  return role !== null && role !== undefined && roles.includes(role);
}

/** The roles that work at a venue: its floor and its commercial team. */
export const VENUE_MEMBER_ROLES: readonly string[] = [...new Set<string>([...VENUE_FLOOR_ROLES, ...COMMERCIAL_ROLES])];

/**
 * An account that works at a venue but is not connected to one yet (an
 * approved domain with no venue, or an invitation that named none). Every
 * venue gate in the API (`canManageVenue`, `canManageCommercial`) refuses it,
 * so the dashboard says so rather than showing a refusal as a failure. A
 * platform admin reads every venue, and customers (planner, client) have no
 * venue by design: neither is waiting for one.
 */
export function awaitsVenue(user: { readonly role: string; readonly venueId: string | null; readonly platformRole: string } | null): boolean {
  return user !== null && user.venueId === null && user.platformRole !== "admin" && hasRole(VENUE_MEMBER_ROLES, user.role);
}

/**
 * The venue whose Diary this person reads from the staff desks: their own, for
 * the Diary's readers and a platform admin; null for anyone else. Find's day
 * answer and the Enquiries desk's Diary fact both follow it, so neither asks
 * for a Diary the API (`canReadDiary`) would refuse.
 */
export function diaryVenueOf(user: { readonly role: string; readonly venueId: string | null; readonly platformRole: string } | null): string | null {
  if (user === null || awaitsVenue(user)) return null;
  return user.platformRole === "admin" || hasRole(DIARY_ROLES, user.role) ? user.venueId : null;
}

/**
 * Who is offered the general AI draft panel (T-656): someone who works at a
 * venue and is connected to it. `POST /ai/drafts` charges every draft to the
 * venue of the person asking and holds it to that venue's monthly AI
 * allowance, so it answers only the venue's floor and commercial team (a
 * platform admin through the venue it is connected to) and refuses everyone
 * else with 403: a planner or client is a customer, and a caterer is
 * event-scoped. Offering them the panel would be offering a refusal.
 */
export function canDraftWithAI(user: { readonly role: string; readonly venueId: string | null; readonly platformRole: string } | null): boolean {
  if (user === null || user.venueId === null) return false;
  return user.platformRole === "admin" || hasRole(VENUE_MEMBER_ROLES, user.role);
}

// ---------------------------------------------------------------------------
// The staff rota (T-637 slice B). A block of its own, with its own drift test
// (__tests__/rota-capabilities.test.ts), because the rota answers three ways
// and each way mirrors a different gate in `routes/rota.ts`.
// ---------------------------------------------------------------------------

/** Mirrors `canAdministerVenue` on the rota's writes: people, shifts, leave, publishing. */
export const ROTA_MANAGE_ROLES = VENUE_ADMIN_ROLES;

/** Mirrors `canManageVenue` on `GET /venues/:venueId/rota/week`: the published week. */
export const ROTA_READ_ROLES = VENUE_FLOOR_ROLES;

/**
 * Who is offered the Rota tab: the venue's own team, its floor and its
 * commercial side, the API's `isVenueTeamRole`. The API answers every one of
 * them: the floor reads the week, and anyone else in the team reads their own
 * shifts, which is what a person linked to an account always sees. Customers
 * and caterers are not offered it; they are never linked to a person on it.
 */
export const ROTA_TAB_ROLES: readonly string[] = [...new Set<string>([...VENUE_FLOOR_ROLES, ...COMMERCIAL_ROLES])];
