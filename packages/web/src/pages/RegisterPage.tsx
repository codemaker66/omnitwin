import { useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { ClerkLoaded, ClerkLoading, SignUp } from "@clerk/react";
import { useAuthStore } from "../stores/auth-store.js";
import { getDefaultRoute } from "../lib/role-routing.js";

export function RegisterPage(): React.ReactElement {
  const navigate = useNavigate();
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);
  const user = useAuthStore((s) => s.user);

  useEffect(() => {
    document.title = "Create account - Venviewer";
  }, []);

  useEffect(() => {
    if (isAuthenticated && user !== null) {
      void navigate(getDefaultRoute(user.role), { replace: true });
    }
  }, [isAuthenticated, user, navigate]);

  return (
    <div style={{
      minHeight: "100vh", display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 320px), 480px))",
      alignItems: "center", justifyContent: "center", gap: 48,
      fontFamily: "'Inter', sans-serif", background: "#f5f5f0", padding: 32,
    }}>
      <section aria-label="Venviewer account context" style={{ color: "#1d1712" }}>
        <div style={{ fontSize: 13, letterSpacing: 3, textTransform: "uppercase", color: "#8a6f2f", fontWeight: 700 }}>
          Venviewer
        </div>
        <h1 style={{ fontFamily: "Georgia, serif", fontSize: "clamp(34px, 7vw, 46px)", lineHeight: 1.05, margin: "14px 0 16px", fontWeight: 500 }}>
          Create your planning workspace.
        </h1>
        <p style={{ fontSize: 16, lineHeight: 1.65, color: "#5d5247", margin: 0 }}>
          Start with a draft, invite your venue team, and keep client layouts in one place.
        </p>
      </section>
      <section
        aria-label="Secure account creation form"
        style={{
          minHeight: 422,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          borderRadius: 8,
          background: "#fffdf8",
          border: "1px solid rgba(29,23,18,0.08)",
          boxShadow: "0 18px 55px rgba(29,23,18,0.08)",
          padding: 24,
        }}
      >
        <ClerkLoading>
          <div role="status" style={{ textAlign: "center", color: "#5d5247", lineHeight: 1.6 }}>
            <div style={{ fontSize: 15, fontWeight: 700, color: "#1d1712" }}>Loading secure account creation.</div>
            <p style={{ margin: "8px 0 0", fontSize: 14 }}>Keep this page open while the account form connects.</p>
          </div>
        </ClerkLoading>
        <ClerkLoaded>
          <SignUp routing="hash" signInUrl="/login" />
        </ClerkLoaded>
      </section>
    </div>
  );
}
