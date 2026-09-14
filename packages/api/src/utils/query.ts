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
