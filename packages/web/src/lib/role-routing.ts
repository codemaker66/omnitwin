// ---------------------------------------------------------------------------
// Role-aware default route — staff roles land on /dashboard, everyone else
// goes into the planner at /plan. (The /editor URL is the public marketing
// landing page; clients should never land there from the auth flow.)
// ---------------------------------------------------------------------------

export function getDefaultRoute(role: string): string {
  if (role === "admin" || role === "hallkeeper" || role === "planner") return "/dashboard";
  return "/plan";
}
