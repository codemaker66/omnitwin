import { useEffect } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { ClerkFailed, ClerkLoaded, ClerkLoading, SignIn } from "@clerk/react";
import { isClerkGoogleSignInEnabled, VENVIEWER_ACCOUNT_APPEARANCE as VENVIEWER_CLERK_APPEARANCE } from "../components/auth/clerk-appearance.js";
import { useAuthStore } from "../stores/auth-store.js";
import { getDefaultRoute } from "../lib/role-routing.js";
import { ActivityStatus } from "../components/shared/Activity.js";
import { authRouteWithReturnTo, getAuthReturnTo } from "../lib/auth-return.js";
import "./AuthPage.css";

export function LoginPage(): React.ReactElement {
  const navigate = useNavigate();
  const location = useLocation();
  const returnTo = getAuthReturnTo(location.search);
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);
  const user = useAuthStore((s) => s.user);
  const authPageClassName = isClerkGoogleSignInEnabled()
    ? "auth-page auth-page--social-enabled"
    : "auth-page auth-page--social-disabled";

  useEffect(() => {
    document.title = "Sign in - Venviewer";
  }, []);

  useEffect(() => {
    if (isAuthenticated && user !== null) {
      void navigate(returnTo ?? getDefaultRoute(user.role, user.platformRole), { replace: true });
    }
  }, [isAuthenticated, user, navigate, returnTo]);

  return (
    <main className={authPageClassName} aria-label="Account access">
      <section className="auth-page__context" aria-label="Venviewer sign in context">
        <div className="auth-page__brand">
          Venviewer
        </div>
        <h1 className="auth-page__title">
          Sign in.
        </h1>
      </section>
      <section className="auth-page__form-shell" aria-label="Secure sign in form">
        <ClerkLoading>
          <div className="auth-page__loading">
            <ActivityStatus>Loading secure sign-in.</ActivityStatus>
          </div>
        </ClerkLoading>
        <ClerkFailed>
          <div className="auth-page__loading auth-page__loading--failed" role="alert">
            <div>Secure sign-in is unavailable.</div>
            <p>Refresh the page to try again.</p>
          </div>
        </ClerkFailed>
        <ClerkLoaded>
          <SignIn appearance={VENVIEWER_CLERK_APPEARANCE} routing="hash"
            signUpUrl={returnTo === null ? "/register" : authRouteWithReturnTo("/register", returnTo)}
            fallbackRedirectUrl={returnTo ?? "/app"} />
        </ClerkLoaded>
      </section>
    </main>
  );
}
