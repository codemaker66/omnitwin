import { Navigate } from "react-router-dom";
import { useAuthStore } from "../../stores/auth-store.js";
import type { ReactNode } from "react";

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
          <p className="vv-state-kicker">Checking access</p>
          <h1>Opening your workspace</h1>
          <p>We are confirming your Venviewer session before loading this internal route.</p>
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
          <p className="vv-state-kicker">Permission needed</p>
          <h1>This workspace is not available to your role</h1>
          <p>You are signed in as {user.role}. Ask an admin to update access if you need this route for venue work.</p>
          <span className="vv-status-chip">Access not granted</span>
        </section>
      </main>
    );
  }

  if (requiredPlatformRole !== undefined && user !== null && user.platformRole !== requiredPlatformRole) {
    return (
      <main className="vv-route-state" aria-label="Workspace access denied">
        <section className="vv-state-panel" role="alert">
          <p className="vv-state-kicker">Platform permission needed</p>
          <h1>This workspace is reserved for Venviewer platform admins</h1>
          <p>You are signed in as {user.role}. Ask a Venviewer platform admin to grant platform access if you need this route.</p>
          <span className="vv-status-chip">Platform access not granted</span>
        </section>
      </main>
    );
  }

  return <>{children}</>;
}
