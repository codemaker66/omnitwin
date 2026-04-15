import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { ClerkProvider } from "@clerk/clerk-react";
import { RouterProvider } from "react-router-dom";
import { router } from "./router.js";
import { ClerkAuthBridge } from "./components/auth/ClerkAuthBridge.js";
import { useAuthStore, type AuthUser } from "./stores/auth-store.js";
import { AppErrorBoundary } from "./error-boundary.js";

// ---------------------------------------------------------------------------
// E2E auth seeding — dev/test-only bypass for Clerk
//
// Playwright tests cannot produce a real Clerk session. To test protected
// routes end-to-end, tests set `window.__OMNITWIN_E2E__ = true` and an
// `__OMNITWIN_SEED_USER__` payload via `page.addInitScript` before the app
// mounts. When that flag is present (and only in dev builds), main.tsx:
//   1. Seeds the auth store synchronously from the payload
//   2. Skips ClerkAuthBridge so Clerk's real (unauthenticated) state does
//      not overwrite the seeded user
//
// `import.meta.env.DEV` is `false` in production Vite builds, so the entire
// branch is dead-code-eliminated from prod bundles. This is not a runtime
// attack surface.
// ---------------------------------------------------------------------------

interface E2EWindow extends Window {
  readonly __OMNITWIN_E2E__?: boolean;
  readonly __OMNITWIN_SEED_USER__?: AuthUser | null;
}

const E2E_ENABLED: boolean = import.meta.env.DEV && (window as E2EWindow).__OMNITWIN_E2E__ === true;

if (E2E_ENABLED) {
  const seed = (window as E2EWindow).__OMNITWIN_SEED_USER__ ?? null;
  useAuthStore.getState().setUser(seed);
}

// ---------------------------------------------------------------------------
// Clerk publishable key — fail fast if missing in production builds
// ---------------------------------------------------------------------------

const CLERK_KEY = import.meta.env["VITE_CLERK_PUBLISHABLE_KEY"];

if ((CLERK_KEY === undefined || CLERK_KEY === "") && import.meta.env.PROD) {
  throw new Error(
    "VITE_CLERK_PUBLISHABLE_KEY is required in production builds. " +
    "Set it in your .env or deployment environment.",
  );
}

// ---------------------------------------------------------------------------
// AppRoot — Clerk provider wraps the entire app
// ---------------------------------------------------------------------------

function AppRoot(): React.ReactElement {
  return (
    <ClerkProvider publishableKey={CLERK_KEY ?? ""} afterSignOutUrl="/editor">
      {E2E_ENABLED ? null : <ClerkAuthBridge />}
      <RouterProvider router={router} />
    </ClerkProvider>
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
