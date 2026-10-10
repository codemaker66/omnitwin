import { isPlatformAdmin, type JwtUser } from "../middleware/auth.js";

// ---------------------------------------------------------------------------
// Ownership & permission helpers
// ---------------------------------------------------------------------------

/**
 * Returns true if the user can manage a resource belonging to the given venue.
 * Venviewer platform admins can manage any venue. Customer venue roles can
 * manage only their assigned venue. Accepts the structural subset it reads
 * (the isPlatformAdmin precedent) so non-HTTP actors — the /ws/diary command
 * channel's MutationActor — can be checked without fabricating a JwtUser.
 *
 * This is the base "works this venue's floor" capability: internal events,
 * planning data, room state, uploads, the action log. Manager belongs here
 * because it is senior to both staff and hallkeeper — without it a manager
 * could edit the venue record (canAdministerVenue) while being unable to read
 * an internal event a hallkeeper can see. Sales and caterer are deliberately
 * absent: sales works the pipeline through canManageCommercial, and a caterer
 * is event-scoped and reaches a venue only through a share.
 */
const VENUE_FLOOR_ROLES: ReadonlySet<string> = new Set(["admin", "manager", "staff", "hallkeeper"]);

/** Whether a venue role reads the venue's internal events, and so the notices
 *  that belong to an event. */
export function roleReadsInternalEvents(role: string): boolean {
  return VENUE_FLOOR_ROLES.has(role);
}

export function canManageVenue(
  user: Pick<JwtUser, "role" | "venueId" | "platformRole">,
  venueId: string,
): boolean {
  if (isPlatformAdmin(user)) return true;
  return VENUE_FLOOR_ROLES.has(user.role) && user.venueId === venueId;
}

// Internal events contain staff notes, operating tasks and commercial data.
// Current venue authority is required; historical createdBy provenance is
// not an enduring grant after a role or venue change.
export function canAccessInternalEvent(
  user: Pick<JwtUser, "role" | "venueId" | "platformRole">,
  venueId: string,
): boolean {
  return canManageVenue(user, venueId);
}

// A room-wide timeline spans other customers' events. Both customer role
// names (client and legacy planner) use their scoped event projection instead.
export function canReadVenuePlanningData(
  user: Pick<JwtUser, "role" | "venueId" | "platformRole">,
  venueId: string,
): boolean {
  return canManageVenue(user, venueId);
}

/**
 * Returns true if the user is the owner of a resource OR has admin/hallkeeper
 * permissions for the venue.
 */
export function canAccessResource(
  user: JwtUser,
  ownerId: string | null,
  venueId: string,
): boolean {
  if (ownerId !== null && user.id === ownerId) return true;
  return canManageVenue(user, venueId);
}

// Event mutations intentionally exclude owner-only and hallkeeper access.
// A loaded row's venue is always the authority for the scope decision.
// Manager is here for the same reason it is on the venue floor: a role that
// may administer the venue and own its pipeline but not create an event in it
// is senior on paper and junior in practice. Sales is absent — it sells the
// room, the venue team runs the day.
const EVENT_WRITE_ROLES: ReadonlySet<string> = new Set(["staff", "admin", "manager"]);

export function isEventWriteRole(
  user: Pick<JwtUser, "role" | "platformRole">,
): boolean {
  if (isPlatformAdmin(user)) return true;
  return EVENT_WRITE_ROLES.has(user.role);
}

export function canWriteEvents(
  user: Pick<JwtUser, "role" | "venueId" | "platformRole">,
  venueId: string,
): boolean {
  if (isPlatformAdmin(user)) return true;
  return EVENT_WRITE_ROLES.has(user.role) && user.venueId === venueId;
}

// ---------------------------------------------------------------------------
// Capability sets — one definition per capability
//
// Routes used to re-derive these sets locally (crm.ts, opportunities.ts,
// integrations, the inventory routes), which is how a venue's own admin ended
// up 403ing on that venue's pipeline. Every gate now names a capability here
// instead of spelling out role strings, so adding a role is one edit.
//
// A capability is venue-scoped: the actor must hold the role AT that venue.
// Venviewer platform admins pass every venue gate (the isPlatformAdmin
// precedent already set by canManageVenue above).
// ---------------------------------------------------------------------------

/** Editing the venue record, its spaces and its pricing rules. */
const VENUE_ADMINISTRATION_ROLES: ReadonlySet<string> = new Set(["admin", "manager", "staff"]);

/** Enquiries, opportunities, CRM, proposals, quotes and revenue. */
const COMMERCIAL_ROLES: ReadonlySet<string> = new Set(["admin", "manager", "staff", "sales"]);

/** Seeing what stock the venue holds — no prices, no adjustment. */
const INVENTORY_READ_ROLES: ReadonlySet<string> = new Set(["admin", "manager", "staff", "hallkeeper", "planner"]);

/** Adjusting counted stock. Narrow on purpose: this moves real numbers. */
const INVENTORY_WRITE_ROLES: ReadonlySet<string> = new Set(["admin", "manager"]);

function holdsVenueRole(
  user: Pick<JwtUser, "role" | "venueId" | "platformRole">,
  venueId: string,
  roles: ReadonlySet<string>,
): boolean {
  if (isPlatformAdmin(user)) return true;
  return roles.has(user.role) && user.venueId === venueId;
}

/**
 * Venue administration: the venue record, its spaces, its pricing rules.
 * Hallkeepers run the room; they do not edit the venue's commercial record
 * (goal 18 §6 decision 6b), so they are deliberately absent here while
 * canManageVenue still admits them for read and room-state surfaces.
 */
export function canAdministerVenue(
  user: Pick<JwtUser, "role" | "venueId" | "platformRole">,
  venueId: string,
): boolean {
  return holdsVenueRole(user, venueId, VENUE_ADMINISTRATION_ROLES);
}

/**
 * The commercial surface: CRM, opportunities, proposals, quotes, revenue.
 * Venue admins are included everywhere venue staff is — the per-route helpers
 * this replaces omitted them and 403'd a venue's own administrator.
 */
export function canManageCommercial(
  user: Pick<JwtUser, "role" | "venueId" | "platformRole">,
  venueId: string,
): boolean {
  return holdsVenueRole(user, venueId, COMMERCIAL_ROLES);
}

/**
 * Reading the Diary: the venue floor, and sales, who pencils the holds. The
 * same people as DIARY_READ_ROLES on the live channel (ws/diary-live.ts), and
 * every role booking-mutations.ts lets write; a writer who could not read the
 * board would meet a 403 on opening it.
 */
export function canReadDiary(
  user: Pick<JwtUser, "role" | "venueId" | "platformRole">,
  venueId: string,
): boolean {
  return canManageVenue(user, venueId) || canManageCommercial(user, venueId);
}

/** Reading venue inventory levels. Never a price. */
export function canReadInventory(
  user: Pick<JwtUser, "role" | "venueId" | "platformRole">,
  venueId: string,
): boolean {
  return holdsVenueRole(user, venueId, INVENTORY_READ_ROLES);
}

/** Adjusting venue inventory stock counts. */
export function canWriteInventory(
  user: Pick<JwtUser, "role" | "venueId" | "platformRole">,
  venueId: string,
): boolean {
  return holdsVenueRole(user, venueId, INVENTORY_WRITE_ROLES);
}

// ---------------------------------------------------------------------------
// Goal 19 D2 — the living timetable's capabilities, beside the sets above.
//
// Three verbs, not three roles. Proposing a window is weaker than inking one
// (a hold on the ladder, never ink), so everyone who may ink may propose, and
// the client's side may propose on an event they hold a live link to — the
// LINK is checked by the caller against the row (client-event-schedule's
// rule), never inferred from the role. Raising a request is the floor plus
// the client's side on their own event; handling one (acknowledge, take,
// hand over, resolve) is the floor only. None of these is an approval gate:
// a quantity beyond the release, a time or a price goes to the decision
// object, and canManageVenue stays a read scope.
// ---------------------------------------------------------------------------

/** The client's side of the house: the people who plan a room and propose. */
const CLIENT_SIDE_ROLES: ReadonlySet<string> = new Set(["client", "planner"]);

/** Who may pencil a hold linked to a plan at the venue: everyone who may ink
 *  (booking-mutations' DIARY_WRITE_ROLES, restated here so this leaf has no
 *  service import) — the client's side is admitted by the event link. */
const WINDOW_PROPOSER_VENUE_ROLES: ReadonlySet<string> = new Set(["staff", "admin", "manager", "sales"]);

/** Who may raise a request on the floor; the client's side raises on their
 *  own event, by the link. */
const REQUEST_RAISER_VENUE_ROLES: ReadonlySet<string> = VENUE_FLOOR_ROLES;

/** Who may acknowledge, take, hand over and resolve a request. */
const REQUEST_HANDLER_ROLES: ReadonlySet<string> = new Set(["hallkeeper", "staff", "admin", "manager"]);

export function isClientSideRole(role: string): boolean {
  return CLIENT_SIDE_ROLES.has(role);
}

/**
 * Propose a window: create or move a HOLD linked to a plan (never ink). For
 * the client's side this answers only the role half; the caller must also
 * prove the live event link (`holdsEventLink`). Nothing here admits a
 * hallkeeper or a caterer.
 */
export function canProposeWindow(
  user: Pick<JwtUser, "role" | "venueId" | "platformRole">,
  venueId: string,
  holdsEventLink = false,
): boolean {
  if (isPlatformAdmin(user)) return true;
  if (CLIENT_SIDE_ROLES.has(user.role)) return holdsEventLink;
  return WINDOW_PROPOSER_VENUE_ROLES.has(user.role) && user.venueId === venueId;
}

/** Raise a request: the floor at the venue, or the client's side on an event
 *  they hold a live link to. */
export function canRaiseRequest(
  user: Pick<JwtUser, "role" | "venueId" | "platformRole">,
  venueId: string,
  holdsEventLink = false,
): boolean {
  if (isPlatformAdmin(user)) return true;
  if (CLIENT_SIDE_ROLES.has(user.role)) return holdsEventLink;
  return REQUEST_RAISER_VENUE_ROLES.has(user.role) && user.venueId === venueId;
}

/** Acknowledge, take, hand over or resolve a request: the floor only. A
 *  client may reopen their own, which the request core decides by the row. */
export function canHandleRequests(
  user: Pick<JwtUser, "role" | "venueId" | "platformRole">,
  venueId: string,
): boolean {
  return holdsVenueRole(user, venueId, REQUEST_HANDLER_ROLES);
}

/** Record what the room is doing (set, doors open, live, flipping, done,
 *  cleaned): the floor only, the same people who handle a request (goal 19
 *  S5). A fact about the room is never a time on the booking. */
export function canRecordObservation(
  user: Pick<JwtUser, "role" | "venueId" | "platformRole">,
  venueId: string,
): boolean {
  return holdsVenueRole(user, venueId, REQUEST_HANDLER_ROLES);
}
