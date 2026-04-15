import { Component } from "react";
import type { ErrorInfo, ReactNode } from "react";

// ---------------------------------------------------------------------------
// AppErrorBoundary — top-level recovery UI
//
// Two error classes get different CTAs because they have different remedies:
//   - network errors (fetch / TypeError "Failed to fetch") → "Try again";
//     the page reload won't help if the API is down — the user should check
//     connectivity first
//   - render errors (anything else thrown during React render) → "Reload"
//     because a remount is the most reliable recovery
//
// classifyError is exported and pure so the heuristic is testable without
// rendering React.
// ---------------------------------------------------------------------------

export type AppErrorKind = "network" | "render";

export function classifyError(error: Error | null): AppErrorKind {
  if (error === null) return "render";
  // Browsers throw TypeError("Failed to fetch") for network failures from
  // fetch(). Some polyfills throw with "NetworkError" in the message.
  const msg = error.message.toLowerCase();
  if (error.name === "TypeError" && (msg.includes("fetch") || msg.includes("network"))) {
    return "network";
  }
  if (msg.includes("networkerror")) return "network";
  return "render";
}

interface ErrorBoundaryState {
  readonly hasError: boolean;
  readonly error: Error | null;
}

export class AppErrorBoundary extends Component<{ children: ReactNode }, ErrorBoundaryState> {
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
      const kind = classifyError(this.state.error);
      const heading = kind === "network" ? "Couldn't reach the server" : "Something went wrong";
      const body = kind === "network"
        ? "Check your internet connection, then try again."
        : (this.state.error?.message ?? "An unexpected error occurred.");
      const cta = kind === "network" ? "Try again" : "Reload Page";
      return (
        <div
          role="alert"
          data-testid={`error-boundary-${kind}`}
          style={{
            minHeight: "100vh", display: "flex", flexDirection: "column",
            alignItems: "center", justifyContent: "center", gap: 16,
            fontFamily: "'Inter', system-ui, sans-serif", color: "#333", background: "#f5f5f0",
          }}
        >
          <h1 style={{ fontSize: 24, fontWeight: 700, margin: 0 }}>{heading}</h1>
          <p style={{ fontSize: 14, color: "#666", maxWidth: 400, textAlign: "center" }}>
            {body}
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
            {cta}
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}
