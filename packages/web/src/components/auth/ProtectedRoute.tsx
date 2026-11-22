import { Link, Navigate, useLocation, useNavigate } from "react-router-dom";
import { Component, lazy, Suspense } from "react";
import { useAuthStore, type AuthUser } from "../../stores/auth-store.js";
import type { ReactNode } from "react";
import { ActivityIndicator } from "../shared/Activity.js";
import { authRouteWithReturnTo } from "../../lib/auth-return.js";
import { isE2EAuthBypassEnabled } from "../../lib/e2e-auth-bypass.js";
import { useAskBeforeSignOut, useInStaffShell, useShellFrame } from "../dashboard/staff-shell.js";
import type { ExitButtonProps } from "./ClerkExitButton.js";

// The router imports this guard, so whatever it imports statically ships to
// every visitor. Clerk's sign-out is needed only on the refusal screen, so it
// loads there (see ClerkExitButton.tsx) and the front door skips the chunk.
const ClerkExitButton = lazy(() => import("./ClerkExitButton.js").then((module) => ({ default: module.ClerkExitButton })));

/**
 * The sign-out button's chunk can fail to load: its hashed file 404s after a
 * deploy, or the visitor is offline. The refusal screen must survive that, so a
 * failed load becomes a plain link to the sign-in page, which signs the wrong
 * account out in its own way, instead of an error page that takes the screen's
 * other exit with it.
 */
class ExitButtonBoundary extends Component<{ readonly children: ReactNode }, { readonly failed: boolean }> {
  constructor(props: { readonly children: ReactNode }) {
    super(props);
    this.state = { failed: false };
  }

  static getDerivedStateFromError(): { readonly failed: boolean } {
    return { failed: true };
  }

  override render(): ReactNode {
    if (this.state.failed) return <Link className="vv-button primary" to="/login">Use another account</Link>;
    return this.props.children;
  }
}

/**
 * A refusal is not a dead end. Whoever reads this screen is signed in as
 * somebody — usually the wrong somebody — so both ways out are offered: the
 * other account they meant to use, and the way back to the public site.
 */
function LocalExitButton({ onLocalSignOut, askFirst }: ExitButtonProps): React.ReactElement {
  const navigate = useNavigate();
  return (
    <button type="button" className="vv-button primary"
      onClick={() => { askFirst(() => { onLocalSignOut(); void navigate("/login"); }); }}>
      Use another account
    </button>
  );
}

function DenialActions(): React.ReactElement {
  const logout = useAuthStore((state) => state.logout);
  const askFirst = useAskBeforeSignOut();
  return (
    <div className="vv-state-actions">
      {isE2EAuthBypassEnabled()
        ? <LocalExitButton onLocalSignOut={logout} askFirst={askFirst} />
        : (
          <ExitButtonBoundary>
            <Suspense fallback={<button type="button" className="vv-button primary" disabled aria-busy="true">Use another account</button>}>
              <ClerkExitButton onLocalSignOut={logout} askFirst={askFirst} />
            </Suspense>
          </ExitButtonBoundary>
        )}
      <Link className="vv-button" to="/">Back to Venviewer</Link>
    </div>
  );
}

/**
 * A guard's own state. On its own it is a page; under the persistent staff
 * shell it is a panel in the workspace, which takes its name, so the page
 * never holds a second main landmark.
 */
function RouteState({ label, children }: { readonly label: string; readonly children: ReactNode }): React.ReactElement {
  const framed = useInStaffShell();
  useShellFrame({ mainLabel: label });
  if (framed) return <div className="vv-route-state vv-route-state--framed">{children}</div>;
  return <main className="vv-route-state" aria-label={label}>{children}</main>;
}

// ---------------------------------------------------------------------------
// ProtectedRoute — guards routes by auth + role
// ---------------------------------------------------------------------------

interface ProtectedRouteProps {
  readonly children: ReactNode;
  readonly allowedRoles?: readonly string[];
  /** Who the page admits, when that is more than a role list (a platform
   *  admin as well): the same rule its navigation offers the page by. */
  readonly admits?: (user: AuthUser) => boolean;
  readonly requiredPlatformRole?: "admin" | "operator";
}

export function ProtectedRoute({ children, allowedRoles, admits, requiredPlatformRole }: ProtectedRouteProps): React.ReactElement {
  const { isAuthenticated, isLoading, user } = useAuthStore();
  const location = useLocation();

  if (isLoading) {
    return (
      <RouteState label="Workspace access check">
        <section className="vv-state-panel" role="status" aria-live="polite">
          <ActivityIndicator size={48} />
          <h1>Checking access…</h1>
        </section>
      </RouteState>
    );
  }

  if (!isAuthenticated) {
    return <Navigate to={authRouteWithReturnTo("/login", location.pathname + location.search + location.hash)} replace />;
  }

  if (user !== null && ((allowedRoles !== undefined && !allowedRoles.includes(user.role)) || (admits !== undefined && !admits(user)))) {
    return (
      <RouteState label="Workspace access denied">
        <section className="vv-state-panel" role="alert">
          <h1>Access needed</h1>
          <p>Ask your venue admin to grant access.</p>
          <DenialActions />
        </section>
      </RouteState>
    );
  }

  if (requiredPlatformRole !== undefined && user !== null && user.platformRole !== requiredPlatformRole) {
    return (
      <RouteState label="Workspace access denied">
        <section className="vv-state-panel" role="alert">
          <h1>Platform access needed</h1>
          <p>Ask a Venviewer platform admin to grant access.</p>
          <DenialActions />
        </section>
      </RouteState>
    );
  }

  return <>{children}</>;
}
