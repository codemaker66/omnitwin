import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { RouterProvider } from "react-router-dom";
import { router } from "./router.js";
import { JackieLarkinHeart } from "./components/JackieLarkinHeart.js";
import { useAuthStore, type AuthUser } from "./stores/auth-store.js";
import { setTokenGetter } from "./api/auth-bridge.js";
import { AppErrorBoundary } from "./error-boundary.js";
import { initBrowserSentry } from "./observability/sentry.js";
import { isE2EAuthBypassEnabled } from "./lib/e2e-auth-bypass.js";
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

await initBrowserSentry();

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
    </>
  );
}

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
