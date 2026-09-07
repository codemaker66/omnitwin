// ---------------------------------------------------------------------------
// Role-aware default route — hallkeepers land on their Day Board, other staff
// on /dashboard, and clients on /plan. (The /editor URL is the public marketing
// landing page; clients should never land there from the auth flow.)
// ---------------------------------------------------------------------------

export function getDefaultRoute(role: string): string {
  if (role === "hallkeeper") return "/hallkeeper/today";
  if (role === "admin" || role === "planner" || role === "staff" || role === "executive") return "/dashboard";
  return "/plan";
}
