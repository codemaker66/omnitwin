import { isPlatformAdmin, type JwtUser } from "../middleware/auth.js";

// ---------------------------------------------------------------------------
// Ownership & permission helpers
// ---------------------------------------------------------------------------

/**
 * Returns true if the user can manage a resource belonging to the given venue.
 * Venviewer platform admins can manage any venue. Customer venue roles can
 * manage only their assigned venue.
 */
export function canManageVenue(user: JwtUser, venueId: string): boolean {
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
