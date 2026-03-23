import { createBrowserRouter, Navigate } from "react-router-dom";
import { AuthLayout } from "./components/auth/AuthLayout.js";
import { LoginPage } from "./pages/LoginPage.js";
import { RegisterPage } from "./pages/RegisterPage.js";
import { EditorPage } from "./pages/EditorPage.js";
import { DashboardPage } from "./pages/DashboardPage.js";
import { ProtectedRoute } from "./components/auth/ProtectedRoute.js";
import { useAuthStore } from "./stores/auth-store.js";
import { getDefaultRoute } from "./lib/role-routing.js";

// ---------------------------------------------------------------------------
// Role-aware root redirect
// ---------------------------------------------------------------------------

function RootRedirect(): React.ReactElement {
  const user = useAuthStore((s) => s.user);
  const target = user !== null ? getDefaultRoute(user.role) : "/login";
  return <Navigate to={target} replace />;
}

// ---------------------------------------------------------------------------
// Application routes
// ---------------------------------------------------------------------------

export const router = createBrowserRouter([
  {
    path: "/login",
    element: <AuthLayout><LoginPage /></AuthLayout>,
  },
  {
    path: "/register",
    element: <AuthLayout><RegisterPage /></AuthLayout>,
  },
  {
    path: "/editor",
    element: (
      <ProtectedRoute allowedRoles={["admin", "hallkeeper", "planner"]}>
        <EditorPage />
      </ProtectedRoute>
    ),
  },
  {
    path: "/dashboard",
    element: (
      <ProtectedRoute allowedRoles={["admin", "hallkeeper"]}>
        <DashboardPage />
      </ProtectedRoute>
    ),
  },
  {
    path: "/",
    element: <RootRedirect />,
  },
  {
    path: "*",
    element: <Navigate to="/" replace />,
  },
]);
