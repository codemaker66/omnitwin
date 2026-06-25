import { useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { ClerkFailed, ClerkLoaded, ClerkLoading, SignUp } from "@clerk/react";
import { isClerkGoogleSignInEnabled, VENVIEWER_CLERK_APPEARANCE } from "../components/auth/clerk-appearance.js";
import { useAuthStore } from "../stores/auth-store.js";
import { getDefaultRoute } from "../lib/role-routing.js";
import "./AuthPage.css";

export function RegisterPage(): React.ReactElement {
  const navigate = useNavigate();
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);
  const user = useAuthStore((s) => s.user);
  const authPageClassName = isClerkGoogleSignInEnabled()
    ? "auth-page auth-page--social-enabled"
    : "auth-page auth-page--social-disabled";

  useEffect(() => {
    document.title = "Create account - Venviewer";
  }, []);

  useEffect(() => {
    if (isAuthenticated && user !== null) {
      void navigate(getDefaultRoute(user.role), { replace: true });
    }
  }, [isAuthenticated, user, navigate]);

  return (
    <main className={authPageClassName} aria-label="Account access">
      <section className="auth-page__context" aria-label="Venviewer account context">
        <div className="auth-page__brand">
          Venviewer
        </div>
        <h1 className="auth-page__title">
          Create your planning workspace.
        </h1>
        <p className="auth-page__copy">
          Start with a draft, invite your venue team, and keep client layouts in one place.
        </p>
        <div className="auth-page__proof-grid" aria-label="Workspace capabilities">
          <span>Venue records</span>
          <span>Staff roles</span>
          <span>Planning evidence</span>
        </div>
      </section>
      <section className="auth-page__form-shell" aria-label="Secure account creation form">
        <ClerkLoading>
          <div className="auth-page__loading" role="status">
            <div>Loading secure account creation.</div>
            <p>Keep this page open while the account form connects.</p>
          </div>
        </ClerkLoading>
        <ClerkFailed>
          <div className="auth-page__loading auth-page__loading--failed" role="alert">
            <div>Secure account creation is unavailable.</div>
            <p>Refresh this page. If it still fails, the Clerk production domain needs attention.</p>
          </div>
        </ClerkFailed>
        <ClerkLoaded>
          <SignUp appearance={VENVIEWER_CLERK_APPEARANCE} routing="hash" signInUrl="/login" />
        </ClerkLoaded>
      </section>
    </main>
  );
}
