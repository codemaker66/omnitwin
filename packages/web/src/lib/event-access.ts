import type { AuthUser } from "../stores/auth-store.js";

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
  return auth.user.platformRole === "admin"
    || auth.user.role === "staff" || auth.user.role === "admin" || auth.user.role === "hallkeeper";
}

export function customerEventPath(eventId: string): string {
  return `/events/${encodeURIComponent(eventId)}`;
}
