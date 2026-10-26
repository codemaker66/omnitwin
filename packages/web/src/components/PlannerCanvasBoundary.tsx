import { Component, type ReactNode } from "react";
import { usePlannerWork } from "./scene/planner-work.js";

// ---------------------------------------------------------------------------
// PlannerCanvasBoundary — graceful fallback when the 3D canvas can't start.
//
// The planner's R3F <Canvas> needs WebGL. On devices/browsers where WebGL is
// unavailable or disabled (locked-down corporate machines, software rendering
// blocked, GPU blocklisted, context lost on mount), the Canvas throws during
// mount and — unwrapped — white-screens the entire planner.
//
// This boundary confines that failure and offers the editor's own 2D view of
// the same layout instead (PlannerWorkContext), which is pure SVG and needs no
// WebGL, so the user can still plan their whole layout. It only renders the
// fallback on an actual error, so in tests (where the Canvas is mocked and
// never throws) it is inert and adds no DOM.
// ---------------------------------------------------------------------------

interface PlannerCanvasBoundaryProps {
  readonly children: ReactNode;
}

interface PlannerCanvasBoundaryState {
  readonly hasError: boolean;
}

export class PlannerCanvasBoundary extends Component<
  PlannerCanvasBoundaryProps,
  PlannerCanvasBoundaryState
> {
  constructor(props: PlannerCanvasBoundaryProps) {
    super(props);
    this.state = { hasError: false };
  }

  static getDerivedStateFromError(): PlannerCanvasBoundaryState {
    return { hasError: true };
  }

  override componentDidCatch(error: Error): void {
    // eslint-disable-next-line no-console
    console.warn(
      "VenViewer: the 3D planner canvas failed to start; offering the 2D planner instead.",
      error,
    );
  }

  private readonly handleRetry = (): void => {
    this.setState({ hasError: false });
  };

  override render(): ReactNode {
    if (this.state.hasError) {
      return <PlannerCanvasFallback onRetry={this.handleRetry} />;
    }
    return this.props.children;
  }
}

function PlannerCanvasFallback({ onRetry }: { readonly onRetry: () => void }): React.ReactElement {
  // The editor's own 2D view of this layout, where it allows one now.
  const continueIn2d = usePlannerWork()?.continueIn2d ?? null;
  return (
    <section
      role="alert"
      aria-labelledby="planner-canvas-fallback-title"
      style={{
        position: "absolute",
        inset: 0,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 24,
        background: "var(--vv-ivory)",
        fontFamily: "'Inter', system-ui, sans-serif",
      }}
    >
      <div style={{ maxWidth: 420, textAlign: "center" }}>
        <h2
          id="planner-canvas-fallback-title"
          style={{ fontSize: 20, fontWeight: 700, color: "var(--vv-forest)", margin: "0 0 10px" }}
        >
          3D view couldn&rsquo;t start
        </h2>
        <p style={{ fontSize: 14, lineHeight: 1.6, color: "var(--vv-forest-soft)", margin: "0 0 20px" }}>
          {continueIn2d !== null
            ? "Your layout is safe. Continue in 2D, or try the 3D view again."
            : "Your layout is safe. Try the 3D view again in a moment."}
        </p>
        <div style={{ display: "flex", gap: 10, justifyContent: "center", flexWrap: "wrap" }}>
          {continueIn2d !== null && (
            <button type="button" className="vv-button primary" onClick={continueIn2d}>
              Continue in 2D
            </button>
          )}
          <button type="button" className={continueIn2d !== null ? "vv-button" : "vv-button primary"} onClick={onRetry}>
            Try 3D again
          </button>
        </div>
      </div>
    </section>
  );
}
