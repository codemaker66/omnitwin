// ---------------------------------------------------------------------------
// Role-aware default route — staff roles → dashboard, others → editor
// ---------------------------------------------------------------------------

export function getDefaultRoute(role: string): string {
  if (role === "admin" || role === "hallkeeper" || role === "planner") return "/dashboard";
  return "/editor";
}
