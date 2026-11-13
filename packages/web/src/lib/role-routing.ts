import { CLIENT_SIDE_ROLES, hasRole, WORKSPACE_ROLES } from "./role-capabilities.js";

// ---------------------------------------------------------------------------
// Role-aware default route — everyone lands on their own work.
//
// Hallkeepers land on their Day Board and the venue's other roles on
// /dashboard. The client's side (client, and the planner who plans for one)
// lands on /events: the events the venue has linked them to and the plans
// they saved, or a calm page saying what will appear there (fix-first 12).
// The planner is still admitted to /dashboard, but it is the venue's desk,
// not theirs, so it is not where they arrive. (The /editor URL is the public
// marketing landing page; nobody lands there from the auth flow.)
//
// Caterers are event-scoped: they hold no venue-wide surface and no plans of
// their own, so they land on /plan with the guests until an event share
// takes them further.
// ---------------------------------------------------------------------------

/** The client's own home: their events and plans. */
export const CLIENT_HOME_ROUTE = "/events";

export function getDefaultRoute(role: string, platformRole?: string): string {
  if (platformRole === "admin") return "/dashboard?view=onboarding";
  if (role === "hallkeeper") return "/hallkeeper/today";
  // Before the workspace check: the planner is in both sets, and its own
  // work comes first.
  if (hasRole(CLIENT_SIDE_ROLES, role)) return CLIENT_HOME_ROUTE;
  // Everyone else the dashboard route admits lands there.
  if (hasRole(WORKSPACE_ROLES, role)) return "/dashboard";
  return "/plan";
}
