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

// Planning-data reads are deliberately broader than venue management. A
// planner assigned to the venue needs the room timeline to prepare an event,
// but that grant must not leak into mutation-capable management helpers.
const VENUE_PLANNING_READ_ROLES: ReadonlySet<string> = new Set([
  "planner",
  "staff",
  "hallkeeper",
  "admin",
]);

export function canReadVenuePlanningData(
  user: Pick<JwtUser, "role" | "venueId" | "platformRole">,
  venueId: string,
): boolean {
  if (isPlatformAdmin(user)) return true;
  return user.venueId === venueId && VENUE_PLANNING_READ_ROLES.has(user.role);
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
