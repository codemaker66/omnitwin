import { lazy, Suspense, type ReactElement } from "react";
import { createBrowserRouter, Navigate } from "react-router-dom";
import { ProtectedRoute } from "./components/auth/ProtectedRoute.js";

// ---------------------------------------------------------------------------
// Application routes — punch list #16: every page is lazy-loaded so the
// initial download for non-editor routes (login, register, dashboard,
// hallkeeper) doesn't have to ship the entire Three.js + R3F + drei stack.
// The editor is the only route that needs the 3D bundle; pulling it eagerly
// for everyone was the dominant cause of the 1.5MB main chunk.
//
// The `then(m => ({ default: m.X }))` form lets each page keep its existing
// named export so no other consumer needs to change. ProtectedRoute stays
// static — it's tiny and runs the auth check before the lazy page mounts.
// ---------------------------------------------------------------------------

const LoginPage = lazy(() =>
  import("./pages/LoginPage.js").then((m) => ({ default: m.LoginPage })),
);
const RegisterPage = lazy(() =>
  import("./pages/RegisterPage.js").then((m) => ({ default: m.RegisterPage })),
);
const EditorPage = lazy(() =>
  import("./pages/EditorPage.js").then((m) => ({ default: m.EditorPage })),
);
const DashboardPage = lazy(() =>
  import("./pages/DashboardPage.js").then((m) => ({ default: m.DashboardPage })),
);
const HallkeeperPage = lazy(() =>
  import("./pages/HallkeeperPage.js").then((m) => ({ default: m.HallkeeperPage })),
);

function LoadingFallback(): ReactElement {
  return (
    <div style={{
      minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center",
      fontFamily: "'Inter', sans-serif", color: "#999", background: "#f5f5f0",
    }}>
      Loading...
    </div>
  );
}

function withSuspense(node: ReactElement): ReactElement {
  return <Suspense fallback={<LoadingFallback />}>{node}</Suspense>;
}

export const router = createBrowserRouter([
  {
    path: "/login",
    element: withSuspense(<LoginPage />),
  },
  {
    path: "/register",
    element: withSuspense(<RegisterPage />),
  },
  {
    path: "/editor",
    element: withSuspense(<EditorPage />),
  },
  {
    path: "/editor/:configId",
    element: withSuspense(<EditorPage />),
  },
  {
    path: "/hallkeeper/:configId",
    element: withSuspense(<HallkeeperPage />),
  },
  {
    path: "/dashboard",
    element: (
      <ProtectedRoute allowedRoles={["admin", "hallkeeper"]}>
        {withSuspense(<DashboardPage />)}
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
