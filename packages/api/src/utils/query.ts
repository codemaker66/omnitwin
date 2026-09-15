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
 */
export function canManageVenue(
  user: Pick<JwtUser, "role" | "venueId" | "platformRole">,
  venueId: string,
): boolean {
  if (isPlatformAdmin(user)) return true;
  if ((user.role === "admin" || user.role === "staff" || user.role === "hallkeeper") && user.venueId === venueId) return true;
  return false;
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
const EVENT_WRITE_ROLES: ReadonlySet<string> = new Set(["staff", "admin"]);

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
