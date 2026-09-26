import type { AuthUser } from "../stores/auth-store.js";
import { hasRole, VENUE_FLOOR_ROLES } from "./role-capabilities.js";

/** Customers plan their own events; venue calendars remain staff workspaces. */
export function isCustomerRole(role: string | null | undefined): boolean {
  return role === "client" || role === "planner";
}

/** A pending, missing or unknown identity must never mount internal readers. */
export function canReadInternalEventData(auth: {
  readonly isLoading: boolean;
  readonly isAuthenticated: boolean;
  readonly user: Pick<AuthUser, "role" | "platformRole"> | null;
}): boolean {
  if (auth.isLoading || !auth.isAuthenticated || auth.user === null) return false;
  // Mirrors the API's canAccessInternalEvent, which is canManageVenue: the
  // venue floor, manager included. Refusing a manager here while the API
  // admits it would hide data the account is entitled to.
  return auth.user.platformRole === "admin" || hasRole(VENUE_FLOOR_ROLES, auth.user.role);
}

export function customerEventPath(eventId: string): string {
  return `/events/${encodeURIComponent(eventId)}`;
}
