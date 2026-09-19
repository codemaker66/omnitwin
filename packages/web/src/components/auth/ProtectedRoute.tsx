import { Link, Navigate, useLocation, useNavigate } from "react-router-dom";
import { useState } from "react";
import { useClerk } from "@clerk/react";
import { useAuthStore } from "../../stores/auth-store.js";
import type { ReactNode } from "react";
import { ActivityIndicator } from "../shared/Activity.js";
import { authRouteWithReturnTo } from "../../lib/auth-return.js";
import { isE2EAuthBypassEnabled } from "../../lib/e2e-auth-bypass.js";

/**
 * A refusal is not a dead end. Whoever reads this screen is signed in as
 * somebody — usually the wrong somebody — so both ways out are offered: the
 * other account they meant to use, and the way back to the public site.
 *
 * Clerk's hook is reached through a child that only mounts when the provider
 * is really there. ClerkRouteProvider returns its children bare under the E2E
 * auth bypass, so calling useClerk() at this level would throw and take the
 * whole refusal screen with it — a guard that renders nothing is worse than
 * the dead end it was meant to fix.
 */
function ClerkExitButton({ onLocalSignOut }: { readonly onLocalSignOut: () => void }): React.ReactElement {
  const { signOut } = useClerk();
  const [signingOut, setSigningOut] = useState(false);
  const [signOutError, setSignOutError] = useState<string | null>(null);

  const handleSignOut = async (): Promise<void> => {
    setSigningOut(true);
    setSignOutError(null);
    try {
      onLocalSignOut();
      await signOut({ redirectUrl: "/login" });
    } catch {
      setSignOutError("Sign out did not finish. Please try again.");
    } finally {
      setSigningOut(false);
    }
  };

  return (
    <>
      <button type="button" className="vv-button primary" disabled={signingOut} aria-busy={signingOut}
        onClick={() => { void handleSignOut(); }}>
        {signingOut && <ActivityIndicator size={18} />}
        {signingOut ? "Signing out…" : "Use another account"}
      </button>
      {signOutError !== null && <p role="alert">{signOutError}</p>}
    </>
  );
}

function LocalExitButton({ onLocalSignOut }: { readonly onLocalSignOut: () => void }): React.ReactElement {
  const navigate = useNavigate();
  return (
    <button type="button" className="vv-button primary"
      onClick={() => { onLocalSignOut(); void navigate("/login"); }}>
      Use another account
    </button>
  );
}

function DenialActions(): React.ReactElement {
  const logout = useAuthStore((state) => state.logout);
  return (
    <div className="vv-state-actions">
      {isE2EAuthBypassEnabled()
        ? <LocalExitButton onLocalSignOut={logout} />
        : <ClerkExitButton onLocalSignOut={logout} />}
      <Link className="vv-button" to="/">Back to Venviewer</Link>
    </div>
  );
}

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
  const location = useLocation();

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
    return <Navigate to={authRouteWithReturnTo("/login", location.pathname + location.search + location.hash)} replace />;
  }

  if (allowedRoles !== undefined && user !== null && !allowedRoles.includes(user.role)) {
    return (
      <main className="vv-route-state" aria-label="Workspace access denied">
        <section className="vv-state-panel" role="alert">
          <h1>Access needed</h1>
          <p>Ask your venue admin to grant access.</p>
          <DenialActions />
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
          <DenialActions />
        </section>
      </main>
    );
  }

  return <>{children}</>;
}
