import { lazy, Suspense, type ReactElement } from "react";
import { createBrowserRouter, Navigate, useLocation } from "react-router-dom";
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

// The cockpit and legacy pages set their type in Inter + Playfair Display;
// the homepage doesn't use either, so that stylesheet must not render-block
// the front door. cockpitImport() attaches it alongside the first chunk that
// actually needs it (display=swap keeps the first cockpit paint readable).
const COCKPIT_FONTS_HREF =
  "https://fonts.googleapis.com/css2?family=Inter:wght@200;300;400;500;600&family=Playfair+Display:wght@400;500;600;700&display=swap";
let cockpitFontsRequested = false;
function cockpitImport<T>(factory: () => Promise<T>): Promise<T> {
  if (!cockpitFontsRequested) {
    cockpitFontsRequested = true;
    const link = document.createElement("link");
    link.rel = "stylesheet";
    link.href = COCKPIT_FONTS_HREF;
    document.head.append(link);
  }
  return factory();
}

const LoginPage = lazy(() =>
  cockpitImport(() => import("./pages/LoginPage.js").then((m) => ({ default: m.LoginPage }))),
);
const RegisterPage = lazy(() =>
  cockpitImport(() => import("./pages/RegisterPage.js").then((m) => ({ default: m.RegisterPage }))),
);
const OAuthConsentPage = lazy(() =>
  cockpitImport(() => import("./pages/OAuthConsentPage.js").then((m) => ({ default: m.OAuthConsentPage }))),
);
const ClerkRouteProvider = lazy(() =>
  cockpitImport(() => import("./components/auth/ClerkRouteProvider.js").then((m) => ({ default: m.ClerkRouteProvider }))),
);
const EditorPage = lazy(() =>
  cockpitImport(() => import("./pages/EditorPage.js").then((m) => ({ default: m.EditorPage }))),
);
const BlueprintPage = lazy(() =>
  cockpitImport(() => import("./pages/BlueprintPage.js").then((m) => ({ default: m.BlueprintPage }))),
);
const SpotlightLandingPage = lazy(() =>
  cockpitImport(() => import("./pages/spotlight/SpotlightLandingPage.js").then((m) => ({
    default: m.SpotlightLandingPage,
  }))),
);
const LandingPage = lazy(() =>
  cockpitImport(() => import("./pages/LandingPage.js").then((m) => ({ default: m.LandingPage }))),
);
const DashboardPage = lazy(() =>
  cockpitImport(() => import("./pages/DashboardPage.js").then((m) => ({ default: m.DashboardPage }))),
);
const HallkeeperPage = lazy(() =>
  cockpitImport(() => import("./pages/HallkeeperPage.js").then((m) => ({ default: m.HallkeeperPage }))),
);
const PrivacyPage = lazy(() =>
  cockpitImport(() => import("./pages/LegalPage.js").then((m) => ({ default: () => m.LegalPage({ type: "privacy" }) }))),
);
const TermsPage = lazy(() =>
  cockpitImport(() => import("./pages/LegalPage.js").then((m) => ({ default: () => m.LegalPage({ type: "terms" }) }))),
);
const AccessibilityPage = lazy(() =>
  cockpitImport(() => import("./pages/LegalPage.js").then((m) => ({ default: () => m.LegalPage({ type: "accessibility" }) }))),
);
const PricingPage = lazy(() =>
  cockpitImport(() => import("./pages/PricingPage.js").then((m) => ({ default: m.PricingPage }))),
);
const SplatFixturePage = lazy(() =>
  cockpitImport(() => import("./pages/SplatFixturePage.js").then((m) => ({ default: m.SplatFixturePage }))),
);
const TradesHallVisualPage = lazy(() =>
  cockpitImport(() => import("./pages/TradesHallVisualPage.js").then((m) => ({ default: m.TradesHallVisualPage }))),
);
const TradesHallAssetStatusPage = lazy(() =>
  cockpitImport(() => import("./pages/TradesHallAssetStatusPage.js").then((m) => ({ default: m.TradesHallAssetStatusPage }))),
);
const ProposalPage = lazy(() =>
  cockpitImport(() => import("./pages/ProposalPage.js").then((m) => ({ default: m.ProposalPage }))),
);
const SupplierPortalPage = lazy(() =>
  cockpitImport(() => import("./pages/SupplierPortalPage.js").then((m) => ({ default: m.SupplierPortalPage }))),
);
const OpsHandoffPage = lazy(() =>
  cockpitImport(() => import("./pages/OpsHandoffPage.js").then((m) => ({ default: m.OpsHandoffPage }))),
);
const EventDayOpsPage = lazy(() =>
  cockpitImport(() => import("./pages/EventDayOpsPage.js").then((m) => ({ default: m.EventDayOpsPage }))),
);
const RoomShowcasePage = lazy(() =>
  cockpitImport(() => import("./pages/RoomShowcasePage.js").then((m) => ({ default: m.RoomShowcasePage }))),
);
const FreshPage = lazy(() =>
  // The homepage: never triggers the cockpit font load.
  import("./pages/fresh/FreshPage.js").then((m) => ({ default: m.FreshPage })),
);
const LivingHallPage = lazy(() =>
  cockpitImport(() => import("./pages/living-hall/LivingHallPage.js").then((m) => ({
    default: m.LivingHallPage,
  }))),
);
const TwinPage = lazy(() =>
  cockpitImport(() => import("./pages/TwinPage.js").then((m) => ({ default: m.TwinPage }))),
);

function LoadingFallback(): ReactElement {
  return (
    <div className="vv-route-state">
      <section className="vv-state-panel" role="status" aria-live="polite">
        <p className="vv-state-kicker">Venviewer</p>
        <h1>Preparing the room workspace</h1>
        <p>Loading the route shell, controls, and current planning context.</p>
        <span className="vv-status-chip" data-tone="review">Human review required for operational decisions</span>
      </section>
    </div>
  );
}

function withSuspense(node: ReactElement): ReactElement {
  return <Suspense fallback={<LoadingFallback />}>{node}</Suspense>;
}

function withClerk(node: ReactElement): ReactElement {
  return withSuspense(<ClerkRouteProvider>{node}</ClerkRouteProvider>);
}

function OnboardRedirect(): ReactElement {
  const location = useLocation();
  return <Navigate to={`/register${location.search}`} replace />;
}

export const router = createBrowserRouter([
  {
    // The Rite (the previous scroll-dramaturgy homepage) lives on here for
    // comparison and stale bookmarks. The homepage at `/` is now the
    // spotlight-reveal hero (see the bottom of this route list).
    path: "/landing",
    element: withSuspense(<LandingPage />),
  },
  {
    // Alias of `/` from the spotlight page's first review round — links
    // already shared to /welcome keep working.
    path: "/welcome",
    element: withSuspense(<SpotlightLandingPage />),
  },
  {
    // /fresh — pictures-only prototype (2026 grammar: kinetic variable type,
    // organic shapes, light/dark theming, a11y-first). Preview route for
    // Blake's verdict; not linked from anywhere.
    path: "/fresh",
    element: withSuspense(<FreshPage />),
  },
  {
    // The Living Hall — P0 DOM-first document (spec:
    // docs/superpowers/specs/2026-07-09-living-hall-landing-plan.md).
    // Dev/preview route while the 3D tiers are built; intended to take `/`
    // when the minimum-viable narrative ships.
    path: "/living-hall",
    element: withSuspense(<LivingHallPage />),
  },
  {
    path: "/login",
    element: withClerk(<LoginPage />),
  },
  {
    path: "/register",
    element: withClerk(<RegisterPage />),
  },
  {
    // Clerk OAuth application consent screen. Keep this route minimal:
    // no app nav, no account menu, and no custom consent logic that can
    // hide scopes, redirect warnings, or the deny action.
    path: "/oauth-consent",
    element: withClerk(<OAuthConsentPage />),
  },
  {
    // Temporary acquisition path until a dedicated billing/onboarding flow lands.
    // Pricing CTAs must not fall through to the homepage.
    path: "/onboard",
    element: <OnboardRedirect />,
  },
  {
    // `/editor` is the URL Trades Hall already shares publicly (on flyers,
    // on their own website, in email signatures). It renders the current
    // marketing homepage so visitors see the new design, not the planner
    // app's login wall. The actual planner moved to `/plan` (below).
    path: "/editor",
    element: withSuspense(<FreshPage />),
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
    // planner's flat-paper draft, the 3D view is the spatial walkthrough.
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
    // known slug is present, EditorPage opens that venue's spaces instead of
    // defaulting to the first venue. Unknown or unauthorized slugs show an
    // explicit safe state. When a SaaS onboarding flow lands, this becomes
    // the primary URL; `/plan` stays as the single-tenant shortcut for the
    // flagship customer.
    path: "/v/:venueSlug/plan",
    element: withSuspense(<EditorPage />),
  },
  {
    // Hallkeeper sheets expose PII (enquiry contact details, event info) and
    // the API enforces auth on both /data and /sheet endpoints. The frontend
    // route guard matches that policy — unauthenticated users redirect to
    // /login rather than hitting the page and getting a 401 from the fetch.
    path: "/hallkeeper/:configId",
    element: withClerk(
      <ProtectedRoute allowedRoles={["admin", "hallkeeper", "planner"]}>
        <HallkeeperPage />
      </ProtectedRoute>,
    ),
  },
  {
    path: "/dashboard",
    element: withClerk(
      <ProtectedRoute allowedRoles={["admin", "hallkeeper", "planner", "staff", "executive"]}>
        <DashboardPage />
      </ProtectedRoute>,
    ),
  },
  {
    path: "/ops/handoff/:handoffPackId",
    element: withClerk(
      <ProtectedRoute allowedRoles={["admin", "hallkeeper", "planner", "staff"]}>
        <OpsHandoffPage />
      </ProtectedRoute>,
    ),
  },
  {
    path: "/ops/events/:eventId",
    element: withClerk(
      <ProtectedRoute allowedRoles={["admin", "hallkeeper", "planner", "staff"]}>
        <EventDayOpsPage />
      </ProtectedRoute>,
    ),
  },
  {
    // Public SaaS pricing page. Entry point for prospective venues;
    // CTAs route to registration until the Stripe+onboarding phases ship.
    path: "/pricing",
    element: withSuspense(<PricingPage />),
  },
  {
    // Dev smoke route for T-087: proves the production renderer stack imports
    // Spark 2.0 with Three.js 0.180 without reaching for drei's <Splat />.
    path: "/dev/splat-fixture",
    element: withSuspense(<SplatFixturePage />),
  },
  {
    // Internal P0 visual-layer route. It loads registered room runtime packages
    // when present and keeps procedural fallback copy explicit when absent.
    path: "/dev/trades-hall-visual",
    element: withSuspense(<TradesHallVisualPage />),
  },
  {
    // Internal operator asset status view. Protected because it reflects
    // capture/package registration state and links into dev runtime routes.
    path: "/dev/assets/rooms",
    element: withClerk(
      <ProtectedRoute allowedRoles={["admin"]} requiredPlatformRole="admin">
        <TradesHallAssetStatusPage />
      </ProtectedRoute>,
    ),
  },
  {
    // Public walkable twin (Twin Phase 1). Placed above the room showcase
    // route so /venues/:venueSlug/twin can never fall through to the
    // :roomSlug matcher. The R3F viewer is its own lazy chunk behind this
    // page shell; marketing routes never pay for Three.js.
    path: "/venues/:venueSlug/twin",
    element: withSuspense(<TwinPage />),
  },
  {
    // Memorable public entry to the flagship walkthrough — printable,
    // sayable on the phone, and the address bar KEEPS this short URL
    // (TwinPage defaults to the flagship venue when no :venueSlug).
    // /twin is NOT usable here: that path proxies the tile bucket.
    path: "/tour",
    element: withSuspense(<TwinPage />),
  },
  {
    // Public room showcase. Uses only the client-safe room visual endpoint and
    // planning-grade copy; internal package/debug data stays out of the route.
    path: "/venues/:venueSlug/rooms/:roomSlug",
    element: withSuspense(<RoomShowcasePage />),
  },
  {
    // Client-facing proposal share link (T-427 phase 3). Public — the share
    // code is the capability; the page renders only the client-safe shape.
    path: "/proposal/:shareCode",
    element: withSuspense(<ProposalPage />),
  },
  {
    // Commercial-spine share token route. Public — the token is resolved by
    // the API through a stored hash and returns only client-safe proposal data.
    path: "/proposal-share/:token",
    element: withSuspense(<ProposalPage />),
  },
  {
    // Supplier coordination share token route. Public — the token is resolved
    // by the API through a stored hash and returns only supplier-scoped data.
    path: "/supplier-share/:token",
    element: withSuspense(<SupplierPortalPage />),
  },
  {
    path: "/privacy",
    element: withSuspense(<PrivacyPage />),
  },
  {
    path: "/legal/privacy",
    element: withSuspense(<PrivacyPage />),
  },
  {
    path: "/terms",
    element: withSuspense(<TermsPage />),
  },
  {
    path: "/legal/terms",
    element: withSuspense(<TermsPage />),
  },
  {
    path: "/accessibility",
    element: withSuspense(<AccessibilityPage />),
  },
  {
    path: "/legal/accessibility",
    element: withSuspense(<AccessibilityPage />),
  },
  {
    // Public marketing homepage — the photography-first page (June shoot,
    // Trades House artwork). Prior designs remain reachable: spotlight at
    // /welcome, the Rite at /landing, the Living Hall at /living-hall.
    path: "/",
    element: withSuspense(<FreshPage />),
  },
  {
    // Role-aware post-sign-in destination. Used by the in-app Venviewer
    // logo click: signed-in staff land on their dashboard, admins on admin,
    // planners on /editor. Kept off `/` so the public landing isn't
    // bypassed for unauthenticated visitors.
    path: "/app",
    element: withClerk(<RoleAwareRedirect />),
  },
  {
    path: "*",
    element: <Navigate to="/" replace />,
  },
]);
