// ---------------------------------------------------------------------------
// Role-aware default route — staff roles land on /dashboard, everyone else
// goes into the planner at /plan. (The /editor URL is the public marketing
// landing page; clients should never land there from the auth flow.)
// ---------------------------------------------------------------------------

export function getDefaultRoute(role: string, platformRole?: string): string {
  if (platformRole === "admin") return "/dashboard?view=onboarding";
  if (role === "admin" || role === "hallkeeper" || role === "planner" || role === "staff" || role === "executive") return "/dashboard";
  return "/plan";
}
