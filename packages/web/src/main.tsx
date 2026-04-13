import { Component, StrictMode } from "react";
import type { ErrorInfo, ReactNode } from "react";
import { createRoot } from "react-dom/client";
import { ClerkProvider } from "@clerk/clerk-react";
import { RouterProvider } from "react-router-dom";
import { router } from "./router.js";
import { ClerkAuthBridge } from "./components/auth/ClerkAuthBridge.js";

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
// Error boundary — catches render errors and shows recovery UI
// ---------------------------------------------------------------------------

interface ErrorBoundaryState {
  readonly hasError: boolean;
  readonly error: Error | null;
}

class AppErrorBoundary extends Component<{ children: ReactNode }, ErrorBoundaryState> {
  constructor(props: { children: ReactNode }) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { hasError: true, error };
  }

  override componentDidCatch(error: Error, info: ErrorInfo): void {
    // eslint-disable-next-line no-console
    console.error("OMNITWIN uncaught error:", error, info.componentStack);
  }

  override render(): ReactNode {
    if (this.state.hasError) {
      return (
        <div style={{
          minHeight: "100vh", display: "flex", flexDirection: "column",
          alignItems: "center", justifyContent: "center", gap: 16,
          fontFamily: "'Inter', system-ui, sans-serif", color: "#333", background: "#f5f5f0",
        }}>
          <h1 style={{ fontSize: 24, fontWeight: 700, margin: 0 }}>Something went wrong</h1>
          <p style={{ fontSize: 14, color: "#666", maxWidth: 400, textAlign: "center" }}>
            {this.state.error?.message ?? "An unexpected error occurred."}
          </p>
          <button
            type="button"
            onClick={() => { window.location.reload(); }}
            style={{
              padding: "10px 24px", fontSize: 14, fontWeight: 600,
              background: "#1a1a2e", color: "#fff", border: "none",
              borderRadius: 8, cursor: "pointer",
            }}
          >
            Reload Page
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}

// ---------------------------------------------------------------------------
// AppRoot — Clerk provider wraps the entire app
// ---------------------------------------------------------------------------

function AppRoot(): React.ReactElement {
  return (
    <ClerkProvider publishableKey={CLERK_KEY ?? ""} afterSignOutUrl="/editor">
      <ClerkAuthBridge />
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
