import { lazy, Suspense, useEffect, type ReactElement } from "react";
import { useAuthStore } from "./stores/auth-store.js";
import { createBrowserRouter, Navigate, Outlet, useLocation, useMatches, type RouteObject } from "react-router-dom";
import { hasLikelyClerkSession } from "./lib/clerk-session-hint.js";
import {
  DIARY_ROLES, hasRole, VENUE_DAY_ROLES, VENUE_ROOM_ROLES, WORKSPACE_ROLES,
} from "./lib/role-capabilities.js";
import { ProtectedRoute } from "./components/auth/ProtectedRoute.js";
import { InternalEventRoute } from "./components/auth/InternalEventRoute.js";
import { RoleAwareRedirect } from "./components/auth/RoleAwareRedirect.js";
import { RouteArrival } from "./components/shared/RouteArrival.js";
import { gaussianSplatsAvailable } from "./lib/splat-access.js";
import { lazyWithPreload, type Preloadable } from "./lib/lazy-with-preload.js";
import { fontBuildFor, fontStylesheetHrefs, type FontStylesheets } from "./lib/self-hosted-fonts.js";
import { SplatsWorkInProgressPage } from "./pages/SplatsWorkInProgressPage.js";
import cockpitFontsHref from "./styles/fonts/cockpit.css?url";
import cockpitFontsFirefoxWindowsHref from "./styles/fonts/cockpit.firefox-windows.css?url";
import quizFontsHref from "./styles/fonts/quiz.css?url";
import quizFontsFirefoxWindowsHref from "./styles/fonts/quiz.firefox-windows.css?url";
import quizFontsMacosHref from "./styles/fonts/quiz.macos.css?url";

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
// Pages behind that check use lazyWithPreload so their chunk downloads while
// the check runs (see withClerk); the check alone still decides rendering.
// ---------------------------------------------------------------------------

// The cockpit and legacy pages set their type in Inter + Playfair Display;
// the homepage doesn't use either, so that stylesheet must not render-block
// the front door. cockpitImport() attaches it alongside the first chunk that
// actually needs it (font-display: swap keeps the first cockpit paint readable).
const COCKPIT_FONTS: FontStylesheets = {
  href: cockpitFontsHref,
  overrides: { "firefox-windows": cockpitFontsFirefoxWindowsHref },
};
// The craft quiz's heraldic faces. Requested here rather than by an @import in
// its route CSS: an @import failure fails that stylesheet's <link>, Vite then
// rejects the route import, and the quiz crashed whenever the (then remote)
// fonts were unreachable. Injected, the stylesheet never blocks the route;
// font-display: swap keeps the Georgia fallbacks until the faces arrive.
const QUIZ_FONTS: FontStylesheets = {
  href: quizFontsHref,
  overrides: { "firefox-windows": quizFontsFirefoxWindowsHref, macos: quizFontsMacosHref },
};
const requestedStylesheets = new Set<string>();
function requestStylesheet(href: string): void {
  if (requestedStylesheets.has(href)) return;
  requestedStylesheets.add(href);
  const link = document.createElement("link");
  link.rel = "stylesheet";
  link.href = href;
  document.head.append(link);
}
/** A family's self-hosted faces, with this browser's build appended last. */
function requestFonts(stylesheets: FontStylesheets): void {
  for (const href of fontStylesheetHrefs(stylesheets, fontBuildFor(navigator.userAgent))) requestStylesheet(href);
}
function cockpitImport<T>(factory: () => Promise<T>): Promise<T> {
  requestFonts(COCKPIT_FONTS);
  return factory();
}

const LoginPage = lazyWithPreload(() =>
  cockpitImport(() => import("./pages/LoginPage.js").then((m) => ({ default: m.LoginPage }))),
);
const RegisterPage = lazyWithPreload(() =>
  cockpitImport(() => import("./pages/RegisterPage.js").then((m) => ({ default: m.RegisterPage }))),
);
const OAuthConsentPage = lazyWithPreload(() =>
  cockpitImport(() => import("./pages/OAuthConsentPage.js").then((m) => ({ default: m.OAuthConsentPage }))),
);
const ClerkRouteProvider = lazyWithPreload(() =>
  cockpitImport(() => import("./components/auth/ClerkRouteProvider.js").then((m) => ({ default: m.ClerkRouteProvider }))),
);
const EditorPage = lazyWithPreload(() =>
  cockpitImport(() => import("./pages/EditorPage.js").then((m) => ({ default: m.EditorPage }))),
);
const ClientEventPage = lazyWithPreload(() =>
  cockpitImport(() => import("./pages/ClientEventPage.js").then((m) => ({ default: m.ClientEventPage }))),
);
const BlueprintPage = lazy(() =>
  cockpitImport(() => import("./pages/BlueprintPage.js").then((m) => ({ default: m.BlueprintPage }))),
);
const DemoShowcasePage = lazyWithPreload(() => import("./pages/demo/DemoShowcasePage.js").then(m => ({ default: m.DemoShowcasePage })));
const NotFoundPage = lazy(() => import("./pages/NotFoundPage.js").then((m) => ({ default: m.NotFoundPage })));
const DashboardPage = lazyWithPreload(() =>
  cockpitImport(() => import("./pages/DashboardPage.js").then((m) => ({ default: m.DashboardPage }))),
);
const HallkeeperPage = lazyWithPreload(() =>
  cockpitImport(() => import("./pages/HallkeeperPage.js").then((m) => ({ default: m.HallkeeperPage }))),
);
const HallkeeperRoomPlansPage = lazyWithPreload(() =>
  cockpitImport(() => import("./pages/hallkeeper/HallkeeperRoomPlansPage.js").then((m) => ({ default: m.HallkeeperRoomPlansPage }))),
);
// The board with the requests provider around it (DayBoardRoute.tsx).
const DayBoardRoute = lazyWithPreload(() =>
  import("./pages/hallkeeper/DayBoardRoute.js").then((m) => ({ default: m.DayBoardRoute })),
);
const HallkeeperWalkthroughPage = lazyWithPreload(() =>
  cockpitImport(() => import("./pages/hallkeeper/HallkeeperWalkthroughPage.js").then((m) => ({ default: m.HallkeeperWalkthroughPage }))),
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
const PricingPage = lazyWithPreload(() =>
  cockpitImport(() => import("./pages/PricingPage.js").then((m) => ({ default: m.PricingPage }))),
);
const TradesHallVisualPage = lazy(() =>
  cockpitImport(() => import("./pages/TradesHallVisualPage.js").then((m) => ({ default: m.TradesHallVisualPage }))),
);
const TradesHouseLeafletPage = lazy(() =>
  import("./pages/TradesHouseLeafletPage.js").then((m) => ({ default: m.TradesHouseLeafletPage })),
);
const TradesHouseCraftQuizPage = lazy(() => {
  requestFonts(QUIZ_FONTS);
  return import("./pages/TradesHouseCraftQuizPage.js").then((m) => ({ default: m.TradesHouseCraftQuizPage }));
});
const RoomsHomePage = lazy(() =>
  // Fraunces, Newsreader and Geist (site.css): never the cockpit faces.
  import("./pages/RoomsHomePage.js").then((m) => ({ default: m.RoomsHomePage })),
);
const RoomWalkPage = lazy(() =>
  cockpitImport(() => import("./pages/RoomWalkPage.js").then((m) => ({ default: m.RoomWalkPage }))),
);
const RoomCapturesPage = lazy(() =>
  cockpitImport(() => import("./pages/RoomCapturesPage.js").then((m) => ({ default: m.RoomCapturesPage }))),
);
const TradesHallAssetStatusPage = lazyWithPreload(() =>
  cockpitImport(() => import("./pages/TradesHallAssetStatusPage.js").then((m) => ({ default: m.TradesHallAssetStatusPage }))),
);
const CaptureIntakePage = lazyWithPreload(() =>
  import("./pages/CaptureIntakePage.js").then((m) => ({ default: m.CaptureIntakePage })),
);
const ProposalPage = lazy(() =>
  cockpitImport(() => import("./pages/ProposalPage.js").then((m) => ({ default: m.ProposalPage }))),
);
const SupplierPortalPage = lazy(() =>
  cockpitImport(() => import("./pages/SupplierPortalPage.js").then((m) => ({ default: m.SupplierPortalPage }))),
);
const OpsHandoffPage = lazyWithPreload(() =>
  cockpitImport(() => import("./pages/OpsHandoffPage.js").then((m) => ({ default: m.OpsHandoffPage }))),
);
const EventDayOpsPage = lazyWithPreload(() =>
  cockpitImport(() => import("./pages/EventDayOpsPage.js").then((m) => ({ default: m.EventDayOpsPage }))),
);
const EventArchitectPage = lazyWithPreload(() =>
  import("./pages/EventArchitectPage.js").then((m) => ({ default: m.EventArchitectPage })),
);
const FreshPage = lazy(() =>
  // The about-and-enquiry page: never triggers the cockpit font load.
  import("./pages/fresh/FreshPage.js").then((m) => ({ default: m.FreshPage })),
);
// Living Hall preview/preflight routes return WITH their pages when that
// feature commits (in flight; see docs/sessions/2026-07-17.md, T-526).
const TwinPage = lazy(() =>
  cockpitImport(() => import("./pages/TwinPage.js").then((m) => ({ default: m.TwinPage }))),
);
const DiaryBoardPage = lazyWithPreload(() =>
  import("./pages/diary/DiaryBoardPage.js").then((m) => ({ default: m.DiaryBoardPage })),
);
// The staff pages' persistent shell (roadmap N2): one header under every
// staff page, drawn once.
const PersistentStaffShell = lazyWithPreload(() =>
  cockpitImport(() => import("./components/dashboard/DashboardLayout.js").then((m) => ({ default: m.PersistentStaffShell }))),
);

function LoadingFallback(): ReactElement {
  return <RouteArrival />;
}

function withSuspense(node: ReactElement): ReactElement {
  return <Suspense fallback={<LoadingFallback />}>{node}</Suspense>;
}

function withSplatAccess(node: ReactElement): ReactElement {
  return gaussianSplatsAvailable() ? withSuspense(node) : <SplatsWorkInProgressPage />;
}

/** Requests route code while rendering, before any lazy provider or guard below resolves. */
function PreloadRouteCode({ code, children }: {
  readonly code: readonly Preloadable[];
  readonly children: ReactElement;
}): ReactElement {
  for (const chunk of code) chunk.preload();
  return children;
}

// A page nested in the provider and a guard used to request its chunk only
// after the provider chunk, Clerk and /auth/me had all resolved. Naming the
// page here requests the provider chunk and then the page chunk as soon as the
// route matches — the same order, so the same stylesheet order, as before. The
// guard inside alone still decides whether the page renders or fetches.
function withClerk(node: ReactElement, page?: Preloadable): ReactElement {
  const provided = <ClerkRouteProvider>{node}</ClerkRouteProvider>;
  if (page === undefined) return withSuspense(provided);
  return withSuspense(<PreloadRouteCode code={[ClerkRouteProvider, page]}>{provided}</PreloadRouteCode>);
}

/** What a staff page's route carries: the page's code, for the shell to ask for. */
interface StaffPageHandle { readonly staffPage: Preloadable }

function isStaffPageHandle(handle: unknown): handle is StaffPageHandle {
  return typeof handle === "object" && handle !== null && "staffPage" in handle;
}

/** Asks for Clerk's code, the shell's and the matched staff page's at once, as
 *  withClerk does for a page of its own, so the page's chunk never waits for
 *  the provider's. */
function PreloadStaffRoute({ children }: { readonly children: ReactElement }): ReactElement {
  const matches = useMatches();
  ClerkRouteProvider.preload();
  PersistentStaffShell.preload();
  for (const match of matches) {
    if (isStaffPageHandle(match.handle)) match.handle.staffPage.preload();
  }
  return children;
}

/**
 * The staff pages' parent route (roadmap N2). A workspace member or platform
 * admin gets the persistent shell. Until someone is signed in, and for anyone
 * else, each page's own guard shows its states or sends them to sign in, and
 * a page it admits wears its own layout, as it always has; none of them waits
 * for the shell's code.
 */
function StaffShellRoute(): ReactElement {
  const member = useAuthStore((state) => state.user !== null
    && (state.user.platformRole === "admin" || hasRole(WORKSPACE_ROLES, state.user.role)));
  if (!member) return withSuspense(<Outlet />);
  return <PersistentStaffShell />;
}

/** A staff page under the persistent shell: its guard and page open beneath
 *  the header, which stays as the pages change. */
function staffPage(path: string, page: Preloadable, node: ReactElement): RouteObject {
  return { path, handle: { staffPage: page } satisfies StaffPageHandle, element: node };
}

// Planner routes stay Clerk-free for guests (no script cost) but mount the
// provider for returning signed-in users, whose staff surfaces (the
// layout-timeline dock, phase-snapshot freeze, review submit) call
// authenticated endpoints. Detection is cookie-only — see
// lib/clerk-session-hint.ts for the full rationale.
export function PlannerAuthBoundary({ children, page }: {
  readonly children: ReactElement;
  /** The lazy planner page; requested now rather than after the provider. */
  readonly page?: Preloadable;
}): ReactElement {
  const hasHydratedSession = useAuthStore((state) => state.isAuthenticated || state.user !== null || state.accessStatus !== "signed_out");
  const needsClerk = hasHydratedSession || hasLikelyClerkSession();
  if (page !== undefined) {
    // Provider first, as the nested imports used to order it for signed-in
    // planners; a guest renders the page at once, so this changes nothing.
    if (needsClerk) ClerkRouteProvider.preload();
    page.preload();
  }

  useEffect(() => {
    if (needsClerk) return;
    // No Clerk bridge mounts for guests, so this boundary must settle their
    // initial loading state. Recheck before writing: never clear a session
    // that hydrated after render, and leave membership decisions to Clerk.
    const current = useAuthStore.getState();
    if (!hasLikelyClerkSession() && !current.isAuthenticated && current.user === null && current.accessStatus === "signed_out" && current.isLoading) {
      current.setLoading(false);
    }
  }, [needsClerk]);

  if (!needsClerk) return children;
  return <ClerkRouteProvider>{children}</ClerkRouteProvider>;
}

function withPlannerAuth(node: ReactElement, page: Preloadable): ReactElement {
  return withSuspense(<PlannerAuthBoundary page={page}>{node}</PlannerAuthBoundary>);
}

// ---------------------------------------------------------------------------
// Dev-only fixture routes.
//
// These two render internal engineering fixtures with no client-facing value:
// /dev/splat-fixture is the native Three r186 Gaussian smoke probe (it writes a
// `window.__splatFixture` bridge for headless checks), and /dev/evidence-chips
// is the CARD A4 storybook of every chip state. Both were reachable in
// production — `venviewer.com/dev/splat-fixture` returned 200 — because they
// were registered with a plain withSuspense() and no guard.
//
// They are declared inside this function, not at module scope, so the gate is
// a *build-time* one rather than a runtime redirect: Vite replaces
// `import.meta.env.DEV` with the literal `false` in every production build,
// Rollup folds `false ? devFixtureRoutes() : []` to `[]`, and the now-unused
// function — with the two dynamic import()s inside it — is tree-shaken before
// chunking. The production bundle therefore emits no SplatFixturePage or
// EvidenceChipFixturePage chunk at all, and the paths fall through to the `*`
// route at the bottom of the table. Keeping the lazy() calls at module scope
// would defeat this: Rollup cannot prove a top-level lazy(...) call is
// side-effect free, so it would retain the declarations and still emit both
// chunks.
//
// Called once, at module evaluation — never during render — so each lazy
// component keeps a stable identity for the life of the app.
// ---------------------------------------------------------------------------
function devFixtureRoutes(): readonly RouteObject[] {
  const SplatFixturePage = lazy(() =>
    cockpitImport(() => import("./pages/SplatFixturePage.js").then((m) => ({ default: m.SplatFixturePage }))),
  );
  const EvidenceChipFixturePage = lazy(() =>
    import("./pages/EvidenceChipFixturePage.js").then((m) => ({ default: m.EvidenceChipFixturePage })),
  );
  const TimeMachineFixturePage = lazy(() =>
    import("./pages/TimeMachineFixturePage.js").then((m) => ({ default: m.TimeMachineFixturePage })),
  );

  return [
    {
      // Dev smoke route for T-087: proves the production renderer stack imports
      // the first-party Three.js r186 Gaussian addon and its native renderer.
      path: "/dev/splat-fixture",
      element: withSuspense(<SplatFixturePage />),
    },
    {
      // CARD A4 fixture: every evidence-chip state and provenance badge on one
      // page, for visual regression and manual review of the chip grammar.
      path: "/dev/evidence-chips",
      element: withSuspense(<EvidenceChipFixturePage />),
    },
    {
      // G4 fixture: the Time Machine in real lens chrome on a seeded trail,
      // anchored vs unanchored. The populated state is unreachable from a
      // guest draft, so this is where it gets reviewed.
      path: "/dev/time-machine",
      element: withSuspense(<TimeMachineFixturePage />),
    },
  ];
}

function OnboardRedirect(): ReactElement {
  const location = useLocation();
  return <Navigate to={`/register${location.search}`} replace />;
}

export const router = createBrowserRouter([
  {
    path: "/work-in-progress",
    element: <SplatsWorkInProgressPage />,
  },
  {
    path: "/splats/*",
    element: <SplatsWorkInProgressPage />,
  },
  {
    // T-616, Blake's decision of 26 September 2026: the older home page
    // designs leave public addresses and their code stays. The Rite (/landing),
    // Spotlight (/welcome) and the Living Hall (/living-hall) redirect to the
    // one front door at `/`, so a stale bookmark still lands on a real page.
    path: "/landing",
    element: <Navigate to="/" replace />,
  },
  {
    // An internal sales deck that was public and crawlable: admin-only now.
    path: "/demo",
    element: withClerk(
      <ProtectedRoute allowedRoles={["admin"]}>
        <DemoShowcasePage />
      </ProtectedRoute>,
      DemoShowcasePage,
    ),
  },
  {
    path: "/welcome",
    element: <Navigate to="/" replace />,
  },
  {
    // /fresh survives as the about-and-enquiry page the front door links to;
    // it renders the same composer as `/` (pages/fresh/FreshEnquiry.tsx).
    path: "/fresh",
    element: withSuspense(<FreshPage />),
  },
  {
    path: "/living-hall",
    element: <Navigate to="/" replace />,
  },
  {
    path: "/login",
    element: withClerk(<LoginPage />, LoginPage),
  },
  {
    path: "/register",
    element: withClerk(<RegisterPage />, RegisterPage),
  },
  {
    // Clerk OAuth application consent screen. Keep this route minimal:
    // no app nav, no account menu, and no custom consent logic that can
    // hide scopes, redirect warnings, or the deny action.
    path: "/oauth-consent",
    element: withClerk(<OAuthConsentPage />, OAuthConsentPage),
  },
  {
    // Temporary acquisition path until a dedicated billing/onboarding flow lands.
    // Pricing CTAs must not fall through to the homepage.
    path: "/onboard",
    element: <OnboardRedirect />,
  },
  {
    // `/editor` is the URL Trades Hall already shares publicly (on flyers,
    // on their own website, in email signatures), so it must land somewhere
    // real: the front door, rather than a second copy of it (T-616). The
    // planner itself moved to `/plan` (below).
    path: "/editor",
    element: <Navigate to="/" replace />,
  },
  {
    // `/plan` is the new home of the planner app. `/editor` used to live
    // here; it now redirects to the front door. Takes optional configId for
    // deep-link.
    path: "/plan",
    element: withPlannerAuth(<EditorPage />, EditorPage),
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
    element: withPlannerAuth(<EditorPage />, EditorPage),
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
    element: withPlannerAuth(<EditorPage />, EditorPage),
  },
  {
    // The staff pages share one shell (roadmap N2): the header is drawn once
    // and stays while the pages beneath it change. Each page keeps its own
    // guard, which alone decides whether it renders or fetches.
    element: withSuspense(
      <PreloadStaffRoute>
        <ClerkRouteProvider><StaffShellRoute /></ClerkRouteProvider>
      </PreloadStaffRoute>,
    ),
    children: [
      // The header's Hallkeeper link: forwarded under the shell, so the
      // header stays on the way to the Day Board.
      { path: "/hallkeeper", element: <Navigate to="/hallkeeper/today" replace /> },
      // The workflow walkthrough is a FICTIONAL demonstration (Hillside House),
      // so it moved under /dev, admin-only (Lane 6's hand-off, PR #21; Blake's
      // decision of 26 September 2026). The old address forwards there, so a
      // link Blake presented from still opens it for an admin, and nobody lands
      // on a hallkeeper sheet for a configuration called "walkthrough".
      { path: "/hallkeeper/walkthrough", element: <Navigate to="/dev/hallkeeper-walkthrough" replace /> },
      // The Day Board (Day Board S1): the hallkeeper's live view of today —
      // a projection of GET /calendar with the countdown/LIVE/exception state
      // machine. v7 route ranking prefers this static segment to
      // /hallkeeper/:configId.
      staffPage("/hallkeeper/today", DayBoardRoute,
        <ProtectedRoute allowedRoles={VENUE_DAY_ROLES}><DayBoardRoute /></ProtectedRoute>),
      staffPage("/hallkeeper/rooms", HallkeeperRoomPlansPage,
        <ProtectedRoute allowedRoles={VENUE_ROOM_ROLES}><HallkeeperRoomPlansPage /></ProtectedRoute>),
      staffPage("/dev/hallkeeper-walkthrough", HallkeeperWalkthroughPage,
        <ProtectedRoute allowedRoles={["admin"]}><HallkeeperWalkthroughPage /></ProtectedRoute>),
      // The Diary Board (T-493): staff/admin move bookings; hallkeeper reads.
      // The API enforces the same write split server-side.
      staffPage("/diary", DiaryBoardPage,
        <ProtectedRoute allowedRoles={DIARY_ROLES}><DiaryBoardPage /></ProtectedRoute>),
      staffPage("/dashboard", DashboardPage,
        <ProtectedRoute allowedRoles={WORKSPACE_ROLES}><DashboardPage /></ProtectedRoute>),
      staffPage("/ops/handoff/:handoffPackId", OpsHandoffPage,
        <ProtectedRoute allowedRoles={VENUE_ROOM_ROLES}><OpsHandoffPage /></ProtectedRoute>),
      staffPage("/ops/events/:eventId", EventDayOpsPage,
        <InternalEventRoute><EventDayOpsPage /></InternalEventRoute>),
      staffPage("/event-architect", EventArchitectPage,
        <InternalEventRoute><EventArchitectPage /></InternalEventRoute>),
      staffPage("/event-architect/runs/:runId", EventArchitectPage,
        <InternalEventRoute><EventArchitectPage /></InternalEventRoute>),
      staffPage("/dev/capture-intake", CaptureIntakePage,
        <ProtectedRoute allowedRoles={["admin"]} requiredPlatformRole="admin"><CaptureIntakePage /></ProtectedRoute>),
      // Legacy room-level registry remains available during Foundry migration;
      // the Runtime Foundry dashboard links to it as a named compatibility tool.
      staffPage("/dev/assets/rooms", TradesHallAssetStatusPage,
        <ProtectedRoute allowedRoles={["admin"]} requiredPlatformRole="admin"><TradesHallAssetStatusPage /></ProtectedRoute>),
    ],
  },
  {
    // Hallkeeper sheets expose PII (enquiry contact details, event info) and
    // the API enforces auth on both /data and /sheet endpoints. The frontend
    // route guard matches that policy — unauthenticated users redirect to
    // /login rather than hitting the page and getting a 401 from the fetch.
    path: "/hallkeeper/:configId",
    element: withClerk(
      <ProtectedRoute allowedRoles={VENUE_ROOM_ROLES}>
        <HallkeeperPage />
      </ProtectedRoute>,
      HallkeeperPage,
    ),
  },
  {
    path: "/events/:eventId",
    element: withClerk(
      <ProtectedRoute>
        <ClientEventPage />
      </ProtectedRoute>,
      ClientEventPage,
    ),
  },
  {
    // The Venviewer subscription page. Admin-only until billing exists
    // (Blake, 26 September 2026): it sells a tier nothing can yet bill, so it
    // is off the public site, the sitemap and the crawl (robots.txt).
    path: "/pricing",
    element: withClerk(
      <ProtectedRoute allowedRoles={["admin"]}>
        <PricingPage />
      </ProtectedRoute>,
      PricingPage,
    ),
  },
  {
    // T-483 campaign preview. This is venue collateral and deliberately
    // remains separate from the T-091 captured-runtime evidence routes.
    path: "/trades-house",
    element: <Navigate to="/trades-house/leaflet" replace />,
  },
  {
    path: "/trades-hall-leaflet",
    element: <Navigate to="/trades-house/leaflet" replace />,
  },
  // /dev/splat-fixture and /dev/evidence-chips — dev builds only. In a
  // production build this spread is a literal empty array and both paths fall
  // through to the `*` route below. See devFixtureRoutes() for why the lazy()
  // calls live inside that function.
  ...(import.meta.env.DEV ? devFixtureRoutes() : []),
  {
    // Founder hold: local development only, including the internal viewer.
    path: "/dev/trades-hall-visual",
    element: withSplatAccess(<TradesHallVisualPage />),
  },
  {
    path: "/trades-house/leaflet",
    element: withSuspense(<TradesHouseLeafletPage />),
  },
  {
    path: "/trades-house/discover-your-craft",
    element: withSuspense(<TradesHouseCraftQuizPage />),
  },
  {
    // The short shareable door to the same room — venviewer.com/quiz.
    path: "/quiz",
    element: withSuspense(<TradesHouseCraftQuizPage />),
  },
  {
    // Room captures — the internal review console for every staged XGRIDS
    // capture, all rooms, whatever their alignment. Admin-gated in production
    // because it is a review surface. It is NOT what keeps a misaligned room
    // from the public: /room/:roomSlug below is public and opens a room only
    // when data/room-walk-exposure.ts says its walk box can hold it.
    // Placed above /venues/:venueSlug/rooms/:roomSlug so it can never fall
    // through to the retired showcase address.
    path: "/venues/:venueSlug/captures/:roomSlug?",
    element: withSplatAccess(<RoomCapturesPage />),
  },
  {
    // Short internal door to the same room, for typing and sharing in ops.
    path: "/captures/:roomSlug?",
    element: withSplatAccess(<RoomCapturesPage />),
  },
  {
    // Public room walkthrough — where a poster on the front door leads.
    // Streams one room; the front door never streams eight at once. Rooms
    // closed in data/room-walk-exposure.ts render a closed door, not a scene.
    path: "/room/:roomSlug",
    element: withSplatAccess(<RoomWalkPage />),
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
    // The old public room showcase, retired with the older home pages (T-616):
    // it was linked from nowhere and only ever rendered the API's fallback
    // copy. The rooms live on `/` (the rail, the capacity table and the
    // composer) and at /room/:roomSlug. RoomShowcasePage's code stays.
    path: "/venues/:venueSlug/rooms/:roomSlug",
    element: <Navigate to="/" replace />,
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
    // The one public front door (T-616): the Grand Hall and the captured
    // rooms, then capacities by layout, the wedding rates and the enquiry
    // composer. /fresh is its about-and-enquiry sibling; the older designs
    // redirect here.
    path: "/",
    element: withSuspense(<RoomsHomePage />),
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
    // A wrong or expired link meets a designed page that says so, with the
    // ways on, instead of silently becoming the homepage (T-616).
    path: "*",
    element: withSuspense(<NotFoundPage />),
  },
]);
