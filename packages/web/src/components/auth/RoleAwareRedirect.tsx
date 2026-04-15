import type { ReactElement } from "react";
import { Navigate } from "react-router-dom";
import { useAuthStore } from "../../stores/auth-store.js";
import { getDefaultRoute } from "../../lib/role-routing.js";

// ---------------------------------------------------------------------------
// RoleAwareRedirect — the `/` landing decision.
//
// Why not a static `<Navigate to="/editor">` like before: clicking the
// OMNITWIN logo as an admin used to dump them into the public editor,
// then the dashboard sidebar button, then the actual page they wanted.
// Three navigations to do one thing. This component reads the auth store
// and sends the user to the role-appropriate landing in one hop.
//
// Why a component (not a router loader): auth state is async — Clerk's
// session resolves in a `useEffect` after first render. While `isLoading`
// is true we render a thin loading view rather than committing to a
// guess; once it resolves we navigate exactly once. The catch-all `*`
// route stays as a flat redirect to `/editor` because a 404 is by
// definition a wrong URL — there's no role-appropriate destination.
// ---------------------------------------------------------------------------

function LoadingView(): ReactElement {
  return (
    <div style={{
      minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center",
      fontFamily: "'Inter', sans-serif", color: "#999", background: "#f5f5f0",
    }}>
      Loading...
    </div>
  );
}

export function RoleAwareRedirect(): ReactElement {
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);
  const isLoading = useAuthStore((s) => s.isLoading);
  const user = useAuthStore((s) => s.user);

  if (isLoading) return <LoadingView />;
  if (!isAuthenticated || user === null) return <Navigate to="/editor" replace />;
  return <Navigate to={getDefaultRoute(user.role)} replace />;
}
