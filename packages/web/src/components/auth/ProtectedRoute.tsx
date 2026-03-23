import { Navigate } from "react-router-dom";
import { useAuthStore } from "../../stores/auth-store.js";
import type { ReactNode } from "react";

// ---------------------------------------------------------------------------
// ProtectedRoute — guards routes by auth + role
// ---------------------------------------------------------------------------

interface ProtectedRouteProps {
  readonly children: ReactNode;
  readonly allowedRoles?: readonly string[];
}

const forbiddenStyle: React.CSSProperties = {
  minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center",
  flexDirection: "column", fontFamily: "'Inter', sans-serif", color: "#666",
};

export function ProtectedRoute({ children, allowedRoles }: ProtectedRouteProps): React.ReactElement {
  const { isAuthenticated, isLoading, user } = useAuthStore();

  if (isLoading) {
    return (
      <div style={{ ...forbiddenStyle, color: "#999" }}>
        <p>Loading…</p>
      </div>
    );
  }

  if (!isAuthenticated) {
    return <Navigate to="/login" replace />;
  }

  if (allowedRoles !== undefined && user !== null && !allowedRoles.includes(user.role)) {
    return (
      <div style={forbiddenStyle}>
        <h1 style={{ fontSize: 48, fontWeight: 700, color: "#dc2626", margin: 0 }}>403</h1>
        <p style={{ fontSize: 16, marginTop: 8 }}>You don&apos;t have permission to access this page.</p>
        <p style={{ fontSize: 13, marginTop: 4 }}>Your role: {user.role}</p>
      </div>
    );
  }

  return <>{children}</>;
}
