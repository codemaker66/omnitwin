import { Navigate } from "react-router-dom";
import { useAuthStore } from "../../stores/auth-store.js";
import type { ReactNode } from "react";
import { ActivityIndicator } from "../shared/Activity.js";

// ---------------------------------------------------------------------------
// ProtectedRoute — guards routes by auth + role
// ---------------------------------------------------------------------------

interface ProtectedRouteProps {
  readonly children: ReactNode;
  readonly allowedRoles?: readonly string[];
  readonly requiredPlatformRole?: "admin" | "operator";
}

export function ProtectedRoute({ children, allowedRoles, requiredPlatformRole }: ProtectedRouteProps): React.ReactElement {
  const { isAuthenticated, isLoading, user } = useAuthStore();

  if (isLoading) {
    return (
      <main className="vv-route-state" aria-label="Workspace access check">
        <section className="vv-state-panel" role="status" aria-live="polite">
          <ActivityIndicator size={48} />
          <h1>Checking access…</h1>
        </section>
      </main>
    );
  }

  if (!isAuthenticated) {
    return <Navigate to="/login" replace />;
  }

  if (allowedRoles !== undefined && user !== null && !allowedRoles.includes(user.role)) {
    return (
      <main className="vv-route-state" aria-label="Workspace access denied">
        <section className="vv-state-panel" role="alert">
          <h1>Access needed</h1>
          <p>Ask your venue admin to grant access.</p>
        </section>
      </main>
    );
  }

  if (requiredPlatformRole !== undefined && user !== null && user.platformRole !== requiredPlatformRole) {
    return (
      <main className="vv-route-state" aria-label="Workspace access denied">
        <section className="vv-state-panel" role="alert">
          <h1>Platform access needed</h1>
          <p>Ask a Venviewer platform admin to grant access.</p>
        </section>
      </main>
    );
  }

  return <>{children}</>;
}
