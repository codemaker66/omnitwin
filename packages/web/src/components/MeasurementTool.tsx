import { useEffect, useMemo, useCallback } from "react";
import { useThree } from "@react-three/fiber";
import { Html } from "@react-three/drei";
import { BufferGeometry, Float32BufferAttribute, Raycaster, Vector2 } from "three";
import { useMeasurementStore, type Measurement } from "../stores/measurement-store.js";
import {
  type Point3,
  formatDistance,
  getMeasurementColor,
  computeMidpoint,
  isBelowFireExit,
} from "../lib/measurement.js";

// ---------------------------------------------------------------------------
// Styles
// ---------------------------------------------------------------------------

const labelStyle: React.CSSProperties = {
  padding: "3px 8px",
  fontSize: 12,
  fontFamily: "system-ui, -apple-system, sans-serif",
  fontWeight: 600,
  borderRadius: 4,
  whiteSpace: "nowrap" as const,
  pointerEvents: "none",
  userSelect: "none",
  lineHeight: 1.3,
};

const dotStyle: React.CSSProperties = {
  width: 8,
  height: 8,
  borderRadius: "50%",
  border: "2px solid white",
  boxShadow: "0 1px 4px rgba(0,0,0,0.3)",
  pointerEvents: "none",
};

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

/** Renders a single completed measurement: line + midpoint label + endpoint dots. */
function MeasurementLine({ measurement }: { readonly measurement: Measurement }): React.ReactElement {
  const { pointA, pointB, distance } = measurement;
  const color = getMeasurementColor(distance);
  const midpoint = computeMidpoint(pointA, pointB);
  const warning = isBelowFireExit(distance);

  const geometry = useMemo(() => {
    const geo = new BufferGeometry();
    geo.setAttribute("position", new Float32BufferAttribute([
      pointA[0], pointA[1], pointA[2],
      pointB[0], pointB[1], pointB[2],
    ], 3));
    return geo;
  }, [pointA, pointB]);

  return (
    <group name={`measurement-${String(measurement.id)}`}>
      {/* Distance line */}
      <lineSegments geometry={geometry}>
        <lineBasicMaterial color={color} linewidth={2} depthTest={false} />
      </lineSegments>

      {/* Endpoint dots */}
      <EndpointDot position={pointA} color={color} />
      <EndpointDot position={pointB} color={color} />

      {/* Distance label at midpoint */}
      <group position={[midpoint[0], midpoint[1], midpoint[2]]}>
        <Html center style={{ pointerEvents: "none" }}>
          <div style={{
            ...labelStyle,
            background: warning ? "rgba(220, 30, 30, 0.9)" : "rgba(30, 30, 30, 0.85)",
            color: "white",
            boxShadow: warning
              ? "0 2px 8px rgba(220,30,30,0.4)"
              : "0 2px 8px rgba(0,0,0,0.2)",
          }}>
            {formatDistance(distance)}
            {warning && " ⚠"}
          </div>
        </Html>
      </group>
    </group>
  );
}

/** Small dot at a measurement endpoint. */
function EndpointDot({ position, color }: {
  readonly position: Point3;
  readonly color: string;
}): React.ReactElement {
  return (
    <group position={[position[0], position[1], position[2]]}>
      <Html center style={{ pointerEvents: "none" }}>
        <div style={{ ...dotStyle, background: color }} />
      </Html>
    </group>
  );
}

/** Dot showing the pending first point. */
function PendingDot({ position }: { readonly position: Point3 }): React.ReactElement {
  return (
    <group position={[position[0], position[1], position[2]]}>
      <Html center style={{ pointerEvents: "none" }}>
        <div style={{
          ...dotStyle,
          background: "#ffcc00",
          width: 10,
          height: 10,
          animation: "pulse 1s ease-in-out infinite",
        }} />
      </Html>
    </group>
  );
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

/**
 * Measurement tool — R3F component (must be inside Canvas).
 *
 * When active (M key toggles):
 * - Left-click on any surface → places a measurement point
 * - First click sets the start point (yellow dot)
 * - Second click completes the measurement (line + label)
 * - Escape cancels pending point
 * - Green line if distance >= 1.05m, red if below fire exit minimum
 *
 * All completed measurements persist until cleared.
 */
export function MeasurementTool(): React.ReactElement {
  const { camera, gl, scene, invalidate } = useThree();
  const measurements = useMeasurementStore((s) => s.measurements);
  const pendingPoint = useMeasurementStore((s) => s.pendingPoint);
  const active = useMeasurementStore((s) => s.active);

  const raycaster = useMemo(() => new Raycaster(), []);
  const pointer = useMemo(() => new Vector2(), []);

  const handleClick = useCallback((event: MouseEvent) => {
    if (!useMeasurementStore.getState().active) return;
    // Only left-click
    if (event.button !== 0) return;

    const rect = gl.domElement.getBoundingClientRect();
    pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
    pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;

    raycaster.setFromCamera(pointer, camera);
    const intersects = raycaster.intersectObjects(scene.children, true);

    // Find the first intersection that's not a measurement line or helper
    for (const hit of intersects) {
      const name = hit.object.name;
      if (name.startsWith("measurement-")) continue;

      const point: Point3 = [hit.point.x, hit.point.y, hit.point.z];
      useMeasurementStore.getState().placePoint(point);
      invalidate();
      break;
    }
  }, [camera, gl, scene, raycaster, pointer, invalidate]);

  // Invalidate when store changes externally (e.g. toolbar button)
  useEffect(() => {
    return useMeasurementStore.subscribe(() => { invalidate(); });
  }, [invalidate]);

  // Click handler on the canvas
  useEffect(() => {
    if (!active) return;
    const canvas = gl.domElement;
    canvas.addEventListener("click", handleClick);
    return () => { canvas.removeEventListener("click", handleClick); };
  }, [active, gl, handleClick]);

  // Keyboard shortcuts: M to toggle, Escape to cancel pending
  useEffect(() => {
    function onKeyDown(event: KeyboardEvent): void {
      const target = event.target;
      if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement) return;

      if (event.code === "KeyM") {
        useMeasurementStore.getState().toggle();
        invalidate();
      } else if (event.code === "Escape") {
        useMeasurementStore.getState().cancelPending();
        invalidate();
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => { window.removeEventListener("keydown", onKeyDown); };
  }, [invalidate]);

  return (
    <group name="measurement-tool">
      {/* Completed measurements */}
      {measurements.map((m) => (
        <MeasurementLine key={m.id} measurement={m} />
      ))}

      {/* Pending first point */}
      {pendingPoint !== null && <PendingDot position={pendingPoint} />}
    </group>
  );
}
