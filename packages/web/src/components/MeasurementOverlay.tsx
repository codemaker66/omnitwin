import { useEffect } from "react";
import { useMeasurementStore } from "../stores/measurement-store.js";
import { useIsCoarsePointer, useIsNarrowViewport } from "../hooks/use-media-query.js";

// ---------------------------------------------------------------------------
// Styles
// ---------------------------------------------------------------------------

const barStyle: React.CSSProperties = {
  position: "absolute",
  top: 12,
  left: "50%",
  transform: "translateX(-50%)",
  padding: "6px 16px",
  background: "rgba(30, 30, 30, 0.85)",
  color: "white",
  fontSize: 13,
  fontFamily: "system-ui, -apple-system, sans-serif",
  fontWeight: 500,
  borderRadius: 6,
  boxShadow: "0 2px 8px rgba(0,0,0,0.25)",
  zIndex: 20,
  pointerEvents: "none",
  userSelect: "none",
  display: "flex",
  alignItems: "center",
  gap: 8,
  whiteSpace: "nowrap" as const,
};

const dotIndicator: React.CSSProperties = {
  width: 8,
  height: 8,
  borderRadius: "50%",
  background: "#22cc44",
  flexShrink: 0,
};

const kbdStyle: React.CSSProperties = {
  padding: "1px 5px",
  fontSize: 11,
  background: "rgba(255,255,255,0.15)",
  borderRadius: 3,
  fontFamily: "monospace",
};

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

/**
 * HTML overlay for the measurement tool.
 *
 * Shows a status bar at the top of the viewport when the tool is active,
 * indicating the current state (waiting for first click, or waiting for second click).
 * Also sets the cursor to crosshair on the canvas while active.
 */
export function MeasurementOverlay(): React.ReactElement | null {
  const active = useMeasurementStore((s) => s.active);
  const pendingPoint = useMeasurementStore((s) => s.pendingPoint);
  const measurementCount = useMeasurementStore((s) => s.measurements.length);
  const isTouch = useIsCoarsePointer();
  const isNarrow = useIsNarrowViewport();

  // Set crosshair cursor on the canvas when active
  useEffect(() => {
    const canvas = document.querySelector("canvas");
    if (!canvas) return;
    if (active) {
      canvas.style.cursor = "crosshair";
    } else {
      canvas.style.cursor = "";
    }
    return () => { canvas.style.cursor = ""; };
  }, [active]);

  if (!active) return null;

  const touchMode = isTouch || isNarrow;
  const hint = pendingPoint !== null
    ? touchMode ? "Tap second point to complete measurement" : "Click second point to complete measurement"
    : touchMode ? "Tap a surface to place first point" : "Click a surface to place first point";

  return (
    <div
      style={{
        ...barStyle,
        ...(touchMode ? {
          top: "calc(env(safe-area-inset-top) + 58px)",
          maxWidth: "calc(100vw - 24px)",
          boxSizing: "border-box" as const,
          whiteSpace: "normal" as const,
          textAlign: "center" as const,
        } : {}),
      }}
      role="status"
      aria-live="polite"
      aria-label="Measurement tool status"
    >
      <span style={dotIndicator} aria-hidden="true" />
      <span>Measure</span>
      <span style={{ opacity: 0.6 }}>—</span>
      <span style={{ opacity: 0.8 }}>{hint}</span>
      {measurementCount > 0 && (
        <span style={{ opacity: 0.5 }}>({String(measurementCount)})</span>
      )}
      {!touchMode && (
        <span style={{ opacity: 0.4 }}>
          <span style={kbdStyle}>Esc</span> cancel
          <span style={{ margin: "0 4px" }}>/</span>
          <span style={kbdStyle}>M</span> close
        </span>
      )}
    </div>
  );
}
