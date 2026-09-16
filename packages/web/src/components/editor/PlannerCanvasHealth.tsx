import { useEffect, type ReactElement } from "react";
import { useThree } from "@react-three/fiber";
import { useCockpitStore } from "../../stores/cockpit-store.js";
import { plannerPixelRatioForMotion } from "../../lib/planner-resolution-policy.js";
import { ActivityStatus } from "../shared/Activity.js";

// ---------------------------------------------------------------------------
// Keeping the planner's canvas alive and affordable.
//
// Two jobs that belong to the renderer rather than to the scene graph: what
// resolution to draw at while the camera is moving, and what to do when the
// browser takes the WebGL context away.
// ---------------------------------------------------------------------------

/**
 * Drop resolution while the camera moves; restore it the moment it settles.
 *
 * Resolution is the cheapest thing in the frame to give up mid-motion and the
 * most expensive to keep: detail nobody can resolve during an orbit costs the
 * same gaussian sorting and fill as detail they are studying. The ratio is
 * written straight onto the renderer rather than through the Canvas `dpr`
 * prop, because that prop is a React input and changing it twice per drag
 * would reconcile the whole planner tree on exactly the frames that can least
 * afford it.
 *
 * Two signals feed it. `cameraInteractionActive` is the planner's own truth,
 * set on pointer-down and cleared once damping has settled, and it covers
 * orbit, pan and wheel. R3F's `performance.current` covers everything that
 * calls `regress()`, including OrbitControls' pinch on touch. Either counts.
 */
export function PlannerAdaptiveResolution({ restingRatio }: {
  readonly restingRatio: number;
}): null {
  const gl = useThree((state) => state.gl);
  const invalidate = useThree((state) => state.invalidate);
  const performanceCurrent = useThree((state) => state.performance.current);
  const cameraInteractionActive = useCockpitStore((state) => state.cameraInteractionActive);
  const moving = cameraInteractionActive || performanceCurrent < 1;

  useEffect(() => {
    const next = plannerPixelRatioForMotion(restingRatio, moving);
    if (gl.getPixelRatio() === next) return;
    gl.setPixelRatio(next);
    // Restoring resolution has to WAKE the demand loop: the settle that
    // triggered it is, by definition, the moment the camera stopped asking
    // for frames. Without this the sharp frame arrives on some later
    // unrelated interaction, which reads as the room staying soft after
    // every drag.
    invalidate();
  }, [gl, invalidate, moving, restingRatio]);

  return null;
}

/**
 * Watch for the browser taking the WebGL context away, and for giving it back.
 *
 * A context lost after mount throws nothing, so `PlannerCanvasBoundary` — a
 * React error boundary — never sees it. What the user sees is the room simply
 * vanishing: a blank canvas, every control still live, no explanation. It
 * happens for reasons that have nothing to do with this code (a driver reset,
 * the OS reclaiming memory, a laptop switching graphics card, too many live
 * contexts across tabs) and it is usually recoverable.
 *
 * `preventDefault` on the loss event is what makes it recoverable: without it
 * the browser never sends `webglcontextrestored` at all. Scene resources are
 * restored by three.js and by Spark's renderer; this component only reports
 * the state so the planner can say what happened, and invalidates on restore
 * so a demand loop with nothing else to react to still redraws.
 */
export function PlannerContextLossWatch({ onLost, onRestored }: {
  readonly onLost: () => void;
  readonly onRestored: () => void;
}): null {
  const gl = useThree((state) => state.gl);
  const invalidate = useThree((state) => state.invalidate);

  useEffect(() => {
    const canvas = gl.domElement;

    function handleLost(event: Event): void {
      event.preventDefault();
      onLost();
    }
    function handleRestored(): void {
      onRestored();
      invalidate();
    }

    canvas.addEventListener("webglcontextlost", handleLost);
    canvas.addEventListener("webglcontextrestored", handleRestored);
    return () => {
      canvas.removeEventListener("webglcontextlost", handleLost);
      canvas.removeEventListener("webglcontextrestored", handleRestored);
    };
  }, [gl, invalidate, onLost, onRestored]);

  return null;
}

/**
 * What the room's absence looks like while the context is gone.
 *
 * Deliberately not a dialog and deliberately not destructive: the layout is
 * untouched in the store, the canvas stays mounted, and everything the user
 * placed is still there waiting. So this covers the canvas, says so, and keeps
 * the 2D plan one tap away for anyone who cannot wait for the driver.
 */
export function PlannerContextLossNotice(): ReactElement {
  return (
    <div
      data-testid="planner-context-lost"
      style={{
        position: "absolute", inset: 0, zIndex: 30,
        display: "flex", alignItems: "center", justifyContent: "center",
        padding: 24, background: "rgba(238,233,222,0.94)",
        fontFamily: "'Inter', system-ui, sans-serif",
      }}
    >
      <div style={{ maxWidth: 420, textAlign: "center" }}>
        <ActivityStatus variant="panel">
          Restoring the 3D view — your layout is safe
        </ActivityStatus>
        <p style={{ fontSize: 14, lineHeight: 1.6, color: "#5a5a5a", margin: "14px 0 18px" }}>
          The browser released this page&rsquo;s graphics context. Nothing you placed
          has been lost; the room comes back on its own once the graphics driver
          is ready.
        </p>
        <a
          href="/blueprint"
          style={{
            display: "inline-block", padding: "11px 20px", fontSize: 14,
            fontWeight: 600, borderRadius: 10, background: "#2a2a2a",
            color: "#fff", textDecoration: "none",
          }}
        >
          Keep planning in 2D
        </a>
      </div>
    </div>
  );
}
