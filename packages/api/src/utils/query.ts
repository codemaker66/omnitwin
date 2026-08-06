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

// ---------------------------------------------------------------------------
// Event write policy (T-540)
//
// `canAccessResource` answers "may this user SEE the resource", and its
// ownership branch grants access to whoever created the row. That is the
// right question for a read and the wrong one for a write: a user whose
// venueId later changes would keep writing to their former venue's events
// forever, purely because they created them.
//
// Event writes ask a narrower question — are you staff/admin AT THIS VENUE.
// Hallkeeper is deliberately excluded, mirroring the diary's
// DIARY_WRITE_ROLES policy where it is a read-facing ops role.
// ---------------------------------------------------------------------------

const EVENT_WRITE_ROLES: ReadonlySet<string> = new Set(["staff", "admin"]);

/**
 * Returns true if the user's ROLE may write events, ignoring venue scope.
 *
 * Venue-blind on purpose: routes that resolve an event by id use this to
 * refuse a read-only role before paying for the row load, so a refusal costs
 * no database work and leaks nothing about which events exist.
 */
export function isEventWriteRole(user: Pick<JwtUser, "role" | "platformRole">): boolean {
  if (isPlatformAdmin(user)) return true;
  return EVENT_WRITE_ROLES.has(user.role);
}

/**
 * Returns true if the user may write events belonging to the given venue.
 *
 * Strictly narrower than `canManageVenue`: a hallkeeper manages their venue
 * but does not write its events. Diverges from `canWriteBookings` in one
 * respect — platform admins keep the global escape hatch, because the rest
 * of the event surface already grants it via `canManageVenue`.
 */
export function canWriteEvents(
  user: Pick<JwtUser, "role" | "venueId" | "platformRole">,
  venueId: string,
): boolean {
  if (isPlatformAdmin(user)) return true;
  return EVENT_WRITE_ROLES.has(user.role) && user.venueId === venueId;
}
