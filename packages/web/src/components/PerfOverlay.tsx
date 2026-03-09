import { useEffect } from "react";
import { usePerfStore } from "../stores/perf-store.js";
import {
  formatFps,
  formatFrameTime,
  formatDrawCalls,
  formatTriangles,
  RATING_COLORS,
  TOGGLE_KEY,
} from "../lib/perf.js";

// ---------------------------------------------------------------------------
// Styles — inline to avoid CSS file dependency
// ---------------------------------------------------------------------------

const OVERLAY_STYLE: React.CSSProperties = {
  position: "fixed",
  top: 8,
  left: 8,
  padding: "6px 10px",
  background: "rgba(0, 0, 0, 0.75)",
  color: "#fff",
  fontFamily: "monospace",
  fontSize: "12px",
  lineHeight: "1.4",
  borderRadius: "4px",
  zIndex: 9999,
  pointerEvents: "none",
  userSelect: "none",
};

/**
 * Performance overlay — renders outside Canvas as fixed-position HTML.
 *
 * Shows FPS, frame time, draw calls, and triangle count with a
 * colour-coded rating indicator (green/amber/red).
 *
 * Toggle visibility with the backtick (`) key.
 * Only rendered in dev mode (conditional in App.tsx).
 */
export function PerfOverlay(): React.ReactElement | null {
  const visible = usePerfStore((s) => s.visible);
  const metrics = usePerfStore((s) => s.metrics);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.code === TOGGLE_KEY) {
        usePerfStore.getState().toggle();
      }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
    };
  }, []);

  if (!visible) return null;

  const color = RATING_COLORS[metrics.rating];

  return (
    <div style={{ ...OVERLAY_STYLE, borderLeft: `3px solid ${color}` }} data-testid="perf-overlay">
      <span style={{ color }}>●</span>
      {" "}
      {formatFps(metrics.fps)} FPS
      {" | "}
      {formatFrameTime(metrics.frameTimeMs)}
      {" | "}
      {formatDrawCalls(metrics.drawCalls)} draws
      {" | "}
      {formatTriangles(metrics.triangles)} tris
    </div>
  );
}
