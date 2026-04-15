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
const PrivacyPage = lazy(() =>
  import("./pages/LegalPage.js").then((m) => ({ default: () => m.LegalPage({ type: "privacy" }) })),
);
const TermsPage = lazy(() =>
  import("./pages/LegalPage.js").then((m) => ({ default: () => m.LegalPage({ type: "terms" }) })),
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
    // Venue-scoped editor entry (B2). Opt-in multi-venue routing — when a
    // known slug is present, SpacePicker loads that venue's spaces instead
    // of defaulting to the first venue. Unknown slugs fall back silently,
    // so stale bookmarks don't 404. When a SaaS onboarding flow lands,
    // this becomes the primary URL; `/editor` stays as the single-tenant
    // shortcut for the flagship customer.
    path: "/v/:venueSlug/editor",
    element: withSuspense(<EditorPage />),
  },
  {
    // Hallkeeper sheets expose PII (enquiry contact details, event info) and
    // the API enforces auth on both /data and /sheet endpoints. The frontend
    // route guard matches that policy — unauthenticated users redirect to
    // /login rather than hitting the page and getting a 401 from the fetch.
    path: "/hallkeeper/:configId",
    element: (
      <ProtectedRoute allowedRoles={["admin", "hallkeeper", "planner"]}>
        {withSuspense(<HallkeeperPage />)}
      </ProtectedRoute>
    ),
  },
  {
    path: "/dashboard",
    element: (
      <ProtectedRoute allowedRoles={["admin", "hallkeeper", "planner"]}>
        {withSuspense(<DashboardPage />)}
      </ProtectedRoute>
    ),
  },
  {
    path: "/privacy",
    element: withSuspense(<PrivacyPage />),
  },
  {
    path: "/terms",
    element: withSuspense(<TermsPage />),
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
