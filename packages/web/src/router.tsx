import { lazy, Suspense, type ReactElement } from "react";
import { createBrowserRouter, Navigate } from "react-router-dom";
import { ProtectedRoute } from "./components/auth/ProtectedRoute.js";
import { RoleAwareRedirect } from "./components/auth/RoleAwareRedirect.js";

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
const BlueprintPage = lazy(() =>
  import("./pages/BlueprintPage.js").then((m) => ({ default: m.BlueprintPage })),
);
const LandingPage = lazy(() =>
  import("./pages/LandingPage.js").then((m) => ({ default: m.LandingPage })),
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
const PricingPage = lazy(() =>
  import("./pages/PricingPage.js").then((m) => ({ default: m.PricingPage })),
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
    // Alias kept so any stale bookmarks of `/landing` still work.
    // Canonical path for the marketing homepage is `/` (see the bottom
    // of this route list).
    path: "/landing",
    element: withSuspense(<LandingPage />),
  },
  {
    path: "/login",
    element: withSuspense(<LoginPage />),
  },
  {
    path: "/register",
    element: withSuspense(<RegisterPage />),
  },
  {
    // `/editor` is the URL Trades Hall already shares publicly (on flyers,
    // on their own website, in email signatures). We render the marketing
    // LandingPage there so visitors see the new design, not the planner
    // app's login wall. The actual planner moved to `/plan` (below).
    path: "/editor",
    element: withSuspense(<LandingPage />),
  },
  {
    // `/plan` is the new home of the planner app. `/editor` used to live
    // here; it now renders the landing page. Takes optional configId for
    // deep-link.
    path: "/plan",
    element: withSuspense(<EditorPage />),
  },
  {
    // The `:code` param matches either a legacy UUID or a guest shortcode.
    // No loader here — EditorPage reads `params.code` directly and treats
    // it as the configId. UUID→canonical redirect is not applied at load
    // time (user stays on whatever URL they visited); the resolver still
    // runs server-side for /api/layouts/resolve calls if anything else
    // needs canonical lookups. Dropping the loader keeps E2E tests fast
    // (they don't mock /api/layouts/resolve) and removes a single point
    // of failure when the API is unreachable.
    path: "/plan/:code",
    element: withSuspense(<EditorPage />),
  },
  {
    // 2D top-down blueprint editor. Mounted alongside the 3D planner — both
    // views share the same underlying scene data; the blueprint is the
    // planner's flat-paper draft, the 3D view is the photoreal walkthrough.
    // Takes optional configId for deep-link.
    path: "/blueprint",
    element: withSuspense(<BlueprintPage />),
  },
  {
    path: "/blueprint/:configId",
    element: withSuspense(<BlueprintPage />),
  },
  {
    // Venue-scoped planner entry (B2). Opt-in multi-venue routing — when a
    // known slug is present, SpacePicker loads that venue's spaces instead
    // of defaulting to the first venue. Unknown slugs fall back silently,
    // so stale bookmarks don't 404. When a SaaS onboarding flow lands,
    // this becomes the primary URL; `/plan` stays as the single-tenant
    // shortcut for the flagship customer.
    path: "/v/:venueSlug/plan",
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
      <ProtectedRoute allowedRoles={["admin", "hallkeeper", "planner", "staff"]}>
        {withSuspense(<DashboardPage />)}
      </ProtectedRoute>
    ),
  },
  {
    // Public SaaS pricing page. Entry point for prospective venues;
    // CTAs deep-link to /onboard?tier=... once the Stripe+onboarding
    // phases ship. Linked from LandingPage TopNav.
    path: "/pricing",
    element: withSuspense(<PricingPage />),
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
    // Public marketing homepage — ported from the Claude Design handoff
    // (trades-house-landing-page, Apr 2026). Anonymous visitors see the
    // hero + planner preview + rooms gallery + quote here, then click
    // through to /editor to actually plan.
    path: "/",
    element: withSuspense(<LandingPage />),
  },
  {
    // Role-aware post-sign-in destination. Used by the in-app "OMNITWIN"
    // logo click: signed-in staff land on their dashboard, admins on admin,
    // planners on /editor. Kept off `/` so the public landing isn't
    // bypassed for unauthenticated visitors.
    path: "/app",
    element: <RoleAwareRedirect />,
  },
  {
    path: "*",
    element: <Navigate to="/" replace />,
  },
]);
