import { useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { ClerkLoaded, ClerkLoading, SignIn } from "@clerk/react";
import { useAuthStore } from "../stores/auth-store.js";
import { getDefaultRoute } from "../lib/role-routing.js";
import "./AuthPage.css";

export function LoginPage(): React.ReactElement {
  const navigate = useNavigate();
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);
  const user = useAuthStore((s) => s.user);

  useEffect(() => {
    document.title = "Sign in - Venviewer";
  }, []);

  useEffect(() => {
    if (isAuthenticated && user !== null) {
      void navigate(getDefaultRoute(user.role), { replace: true });
    }
  }, [isAuthenticated, user, navigate]);

  return (
    <main className="auth-page" aria-label="Account access">
      <section className="auth-page__context" aria-label="Venviewer sign in context">
        <div className="auth-page__brand">
          Venviewer
        </div>
        <h1 className="auth-page__title">
          Sign in to your planning workspace.
        </h1>
        <p className="auth-page__copy">
          Continue to saved layouts, venue reviews, and hallkeeper handoff tools.
        </p>
        <div className="auth-page__proof-grid" aria-label="Workspace capabilities">
          <span>Review gates</span>
          <span>Runtime evidence</span>
          <span>Ops handoff</span>
        </div>
      </section>
      <section className="auth-page__form-shell" aria-label="Secure sign in form">
        <ClerkLoading>
          <div className="auth-page__loading" role="status">
            <div>Loading secure sign-in.</div>
            <p>Keep this page open while the account form connects.</p>
          </div>
        </ClerkLoading>
        <ClerkLoaded>
          <SignIn routing="hash" signUpUrl="/register" />
        </ClerkLoaded>
      </section>
    </main>
  );
}
