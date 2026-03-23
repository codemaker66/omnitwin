// ---------------------------------------------------------------------------
// Role-aware default route — admin/hallkeeper → dashboard, others → editor
// ---------------------------------------------------------------------------

export function getDefaultRoute(role: string): string {
  if (role === "admin" || role === "hallkeeper") return "/dashboard";
  return "/editor";
}
