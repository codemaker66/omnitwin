import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { RouterProvider } from "react-router-dom";
import { router } from "./router.js";
import { JackieLarkinHeart } from "./components/JackieLarkinHeart.js";
import { PerfOverlay } from "./components/PerfOverlay.js";
import { useAuthStore, type AuthUser } from "./stores/auth-store.js";
import { setTokenGetter } from "./api/auth-bridge.js";
import { AppErrorBoundary } from "./error-boundary.js";
import { initBrowserSentry } from "./observability/sentry.js";
import { webVitalsSampleRate } from "./observability/web-vitals-rate.js";
import { isE2EAuthBypassEnabled } from "./lib/e2e-auth-bypass.js";
import { registerPushWorker } from "./lib/push-worker.js";
import { appendFontBuildStyle, fontBuildFor } from "./lib/self-hosted-fonts.js";
import siteFontsFirefoxWindows from "./styles/fonts/site-slim.firefox-windows.css?inline";
import "./global.css";

// ---------------------------------------------------------------------------
// E2E auth seeding — dev/test-only bypass for Clerk
//
// Playwright tests cannot produce a real Clerk session. To test protected
// routes end-to-end, tests set `window.__OMNITWIN_E2E__ = true` and an
// `__OMNITWIN_SEED_USER__` payload via `page.addInitScript` before the app
// mounts. When that flag is present (and only in dev builds or an explicitly
// flagged production-preview E2E build), main.tsx:
//   1. Seeds the auth store synchronously from the payload
//   2. Skips ClerkAuthBridge so Clerk's real (unauthenticated) state does
//      not overwrite the seeded user
//
// Real production builds do not set VITE_ENABLE_E2E_AUTH_BYPASS, so this is
// unavailable unless the build was made specifically for Playwright preview
// parity.
// ---------------------------------------------------------------------------

interface E2EWindow extends Window {
  readonly __OMNITWIN_E2E__?: boolean;
  readonly __OMNITWIN_SEED_USER__?: AuthUser | null;
}

const E2E_ENABLED = isE2EAuthBypassEnabled();

if (E2E_ENABLED) {
  const seed = (window as E2EWindow).__OMNITWIN_SEED_USER__ ?? null;
  useAuthStore.getState().setUser(seed);
  setTokenGetter(seed === null ? null : () => Promise.resolve(JSON.stringify({
    id: seed.id,
    email: seed.email,
    role: seed.role,
    platformRole: seed.platformRole,
    venueId: seed.venueId,
  })));
}

// ---------------------------------------------------------------------------
// AppRoot — public routes stay auth-provider-free. Routes that need Clerk are
// wrapped lazily in router.tsx so client-facing planning surfaces do not pay
// the Clerk script/long-task cost.
// ---------------------------------------------------------------------------

function AppRoot(): React.ReactElement {
  return (
    <>
      <RouterProvider router={router} />
      <JackieLarkinHeart />
      <PerfOverlay />
    </>
  );
}

// index.html links the default build of the site's faces. Where Google Fonts
// served this browser a different build, its rules must win before the app
// renders (see lib/self-hosted-fonts.ts).
appendFontBuildStyle({ "firefox-windows": siteFontsFirefoxWindows }, fontBuildFor(navigator.userAgent), document);

const rootElement = document.getElementById("root");
if (rootElement === null) {
  throw new Error("Root element #root not found");
}

createRoot(rootElement).render(
  <StrictMode>
    <AppErrorBoundary>
      <AppRoot />
    </AppErrorBoundary>
  </StrictMode>,
);

// Monitoring is optional and its SDK is a large deferred chunk. Start it only
// after React owns the root so a slow import can never hold the first screen
// blank. The error boundary shares the same idempotent initializer.
void initBrowserSentry();

// Field web vitals (goal 07): only a build that samples page loads loads the
// reporter at all, and it measures the route this page load landed on.
if (webVitalsSampleRate(import.meta.env) > 0) {
  const routePaths = router.state.matches.map((match) => match.route.path);
  void import("./observability/web-vitals.js").then(({ startWebVitals }) => startWebVitals({ env: import.meta.env, routePaths }));
}

// The push worker (goal 19 S7): registered after the root is up, harmless
// where the browser has no push. It caches nothing and answers no fetch.
registerPushWorker();

// Planner work kept on this device past its age goes, for everyone who uses
// this browser, including drafts whose layouts are never opened again. It
// runs a while after the page has settled, from its own module, so no route's
// first load carries the planner's draft code (the walkable twin's byte
// budget, e2e/twin-performance). Reading a draft checks its age too, so a
// stale one is never restored in the meantime.
const PLANNER_DRAFT_SWEEP_DELAY_MS = 30_000;
window.setTimeout(() => {
  void import("./lib/planner-draft-storage.js").then(({ sweepExpiredPlannerDrafts }) => { sweepExpiredPlannerDrafts(); });
}, PLANNER_DRAFT_SWEEP_DELAY_MS);
