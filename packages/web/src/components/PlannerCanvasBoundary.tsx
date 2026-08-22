import { Component, type ReactNode } from "react";

// ---------------------------------------------------------------------------
// PlannerCanvasBoundary — graceful fallback when the 3D canvas can't start.
//
// The planner's R3F <Canvas> needs WebGL. On devices/browsers where WebGL is
// unavailable or disabled (locked-down corporate machines, software rendering
// blocked, GPU blocklisted, context lost on mount), the Canvas throws during
// mount and — unwrapped — white-screens the entire planner.
//
// This boundary confines that failure and offers the 2D floor planner instead,
// which is pure SVG and needs no WebGL, so the user can still plan their whole
// layout. It only renders the fallback on an actual error, so in tests (where
// the Canvas is mocked and never throws) it is inert and adds no DOM.
// ---------------------------------------------------------------------------

interface PlannerCanvasBoundaryProps {
  readonly children: ReactNode;
  /**
   * A source-only room has no authorised 2D substitute. If WebGL fails, the
   * boundary must preserve that absence instead of linking to blueprint
   * geometry that is not grounded in the captured source.
   */
  readonly sourceOnly?: boolean;
  /** Invalidates any mounted-source claim after the Canvas subtree detaches. */
  readonly onSourceOnlyError?: () => void;
  /** Starts a fresh pending attempt before the same Canvas subtree remounts. */
  readonly onSourceOnlyRetry?: () => void;
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
    if (this.props.sourceOnly === true) {
      this.props.onSourceOnlyError?.();
    }
    // eslint-disable-next-line no-console
    console.warn(
      this.props.sourceOnly === true
        ? "VenViewer: the source-only 3D room failed to start; no substitute geometry was offered."
        : "VenViewer: the 3D planner canvas failed to start; offering the 2D planner instead.",
      error,
    );
  }

  private readonly handleRetry = (): void => {
    if (this.props.sourceOnly === true) {
      this.props.onSourceOnlyRetry?.();
    }
    this.setState({ hasError: false });
  };

  override render(): ReactNode {
    if (this.state.hasError) {
      return (
        <PlannerCanvasFallback
          onRetry={this.handleRetry}
          sourceOnly={this.props.sourceOnly === true}
        />
      );
    }
    return this.props.children;
  }
}

function PlannerCanvasFallback({
  onRetry,
  sourceOnly,
}: {
  readonly onRetry: () => void;
  readonly sourceOnly: boolean;
}): React.ReactElement {
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
        background: "#eee9de",
        fontFamily: "'Inter', system-ui, sans-serif",
      }}
    >
      <div style={{ maxWidth: 420, textAlign: "center" }}>
        <h2
          id="planner-canvas-fallback-title"
          style={{ fontSize: 20, fontWeight: 700, color: "#2a2a2a", margin: "0 0 10px" }}
        >
          {sourceOnly ? "3D source unavailable" : "3D view couldn’t start"}
        </h2>
        <p style={{ fontSize: 14, lineHeight: 1.6, color: "#5a5a5a", margin: "0 0 20px" }}>
          {sourceOnly
            ? "The captured room source could not be displayed because WebGL did not start. No substitute room geometry is shown."
            : (
              <>
                Your browser or device couldn&rsquo;t start the 3D planner &mdash; this usually means
                WebGL (3D graphics) is unavailable or disabled. You can plan your whole
                layout in the 2D floor planner instead; it has the same rooms and furniture.
              </>
            )}
        </p>
        <div style={{ display: "flex", gap: 10, justifyContent: "center", flexWrap: "wrap" }}>
          {!sourceOnly ? (
            <a
              href="/blueprint"
              style={{
                display: "inline-block",
                padding: "11px 20px",
                fontSize: 14,
                fontWeight: 600,
                borderRadius: 10,
                background: "#2a2a2a",
                color: "#fff",
                textDecoration: "none",
              }}
            >
              Open the 2D planner
            </a>
          ) : null}
          <button
            type="button"
            onClick={onRetry}
            style={{
              padding: "11px 20px",
              fontSize: 14,
              fontWeight: 600,
              borderRadius: 10,
              background: "transparent",
              color: "#2a2a2a",
              border: "1px solid rgba(0,0,0,0.2)",
              cursor: "pointer",
            }}
          >
            Try 3D again
          </button>
        </div>
      </div>
    </section>
  );
}
