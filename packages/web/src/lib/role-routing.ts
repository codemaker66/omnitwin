import { hasRole, WORKSPACE_ROLES } from "./role-capabilities.js";

// ---------------------------------------------------------------------------
// Role-aware default route — hallkeepers land on their Day Board, other venue
// roles on /dashboard, and clients on /plan. (The /editor URL is the public
// marketing landing page; clients should never land there from the auth flow.)
//
// Caterers are event-scoped: they hold no venue-wide surface, so they land on
// /plan with the other guests until an event share takes them further.
// ---------------------------------------------------------------------------

export function getDefaultRoute(role: string, platformRole?: string): string {
  if (platformRole === "admin") return "/dashboard?view=onboarding";
  if (role === "hallkeeper") return "/hallkeeper/today";
  // Everyone the dashboard route admits lands there; the hallkeeper is taken
  // to their own day first, above.
  if (hasRole(WORKSPACE_ROLES, role)) return "/dashboard";
  return "/plan";
}
