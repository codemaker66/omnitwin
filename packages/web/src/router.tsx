import { createBrowserRouter, Navigate } from "react-router-dom";
import { LoginPage } from "./pages/LoginPage.js";
import { RegisterPage } from "./pages/RegisterPage.js";
import { EditorPage } from "./pages/EditorPage.js";
import { DashboardPage } from "./pages/DashboardPage.js";
import { ProtectedRoute } from "./components/auth/ProtectedRoute.js";

// ---------------------------------------------------------------------------
// Application routes — editor is PUBLIC (no auth required)
// Clerk handles login/register UI via its own components
// ---------------------------------------------------------------------------

export const router = createBrowserRouter([
  {
    path: "/login",
    element: <LoginPage />,
  },
  {
    path: "/register",
    element: <RegisterPage />,
  },
  {
    path: "/editor",
    element: <EditorPage />,
  },
  {
    path: "/editor/:configId",
    element: <EditorPage />,
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
    element: <Navigate to="/editor" replace />,
  },
  {
    path: "*",
    element: <Navigate to="/editor" replace />,
  },
]);
