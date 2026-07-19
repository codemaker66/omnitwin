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
