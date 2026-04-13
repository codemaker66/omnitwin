import { useEffect, useMemo, useCallback } from "react";
import { useThree } from "@react-three/fiber";
import { Html } from "@react-three/drei";
import {
  BufferGeometry,
  Float32BufferAttribute,
  LineDashedMaterial,
  Raycaster,
  Vector2,
} from "three";
import { useGuidelineStore } from "../stores/guideline-store.js";
import type { GuidelineData } from "../lib/guideline.js";
import {
  detectWallHit,
  formatGuidelineLabel,
  GUIDELINE_COLOR,
  GUIDELINE_DASH,
  GUIDELINE_GAP,
} from "../lib/guideline.js";
import type { Point3 } from "../lib/measurement.js";
import { computeMidpoint } from "../lib/measurement.js";

// ---------------------------------------------------------------------------
// Styles
// ---------------------------------------------------------------------------

const labelStyle: React.CSSProperties = {
  padding: "3px 8px",
  fontSize: 11,
  fontFamily: "system-ui, -apple-system, sans-serif",
  fontWeight: 600,
  borderRadius: 4,
  whiteSpace: "nowrap",
  pointerEvents: "none",
  userSelect: "none",
  lineHeight: 1.3,
  background: "rgba(50, 80, 120, 0.85)",
  color: "white",
  boxShadow: "0 2px 8px rgba(0,0,0,0.2)",
};

const dismissBtnStyle: React.CSSProperties = {
  position: "absolute",
  top: -8,
  right: -8,
  width: 16,
  height: 16,
  borderRadius: "50%",
  border: "none",
  background: "rgba(200, 50, 50, 0.9)",
  color: "white",
  fontSize: 10,
  lineHeight: "16px",
  textAlign: "center",
  cursor: "pointer",
  padding: 0,
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  pointerEvents: "auto",
};

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

/** Renders a single dashed guideline with a distance label. */
function GuidelineLine({ guideline }: { readonly guideline: GuidelineData }): React.ReactElement {
  const { start, end, realDistance, id } = guideline;
  const midpoint = computeMidpoint(start, end);

  const geometry = useMemo(() => {
    const geo = new BufferGeometry();
    geo.setAttribute("position", new Float32BufferAttribute([
      start[0], start[1], start[2],
      end[0], end[1], end[2],
    ], 3));
    // computeLineDistances is required for dashed lines to work
    const dx = end[0] - start[0];
    const dy = end[1] - start[1];
    const dz = end[2] - start[2];
    const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);
    geo.setAttribute("lineDistance", new Float32BufferAttribute([0, dist], 1));
    return geo;
  }, [start, end]);

  const material = useMemo(
    () => new LineDashedMaterial({
      color: GUIDELINE_COLOR,
      dashSize: GUIDELINE_DASH,
      gapSize: GUIDELINE_GAP,
      depthTest: false,
      transparent: true,
      opacity: 0.8,
    }),
    [],
  );

  const handleDismiss = useCallback(() => {
    useGuidelineStore.getState().removeGuideline(id);
  }, [id]);

  return (
    <group name={`guideline-${String(id)}`}>
      <lineSegments geometry={geometry} material={material} renderOrder={1} />

      {/* Distance label at midpoint */}
      <group position={[midpoint[0], midpoint[1] + 0.3, midpoint[2]]}>
        <Html center>
          <div style={{ position: "relative" }}>
            <div style={labelStyle}>
              {formatGuidelineLabel(realDistance)}
            </div>
            <button
              type="button"
              style={dismissBtnStyle}
              onClick={handleDismiss}
              title="Remove guideline"
              aria-label="Remove guideline"
            >
              ×
            </button>
          </div>
        </Html>
      </group>
    </group>
  );
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

/**
 * Tape Measure tool — R3F component (must be inside Canvas).
 *
 * When active (T key toggles):
 * - Left-click on a wall → places a dashed guideline across the floor
 * - Guideline runs perpendicular to the clicked wall, spanning the full room
 * - Distance label at the midpoint shows real-world metres
 * - Each guideline has an × dismiss button
 * - Escape clears all guidelines
 *
 * Guidelines persist until individually dismissed or all cleared.
 */
export function TapeMeasure(): React.ReactElement {
  const { camera, gl, scene, invalidate } = useThree();
  const guidelines = useGuidelineStore((s) => s.guidelines);
  const active = useGuidelineStore((s) => s.active);

  const raycaster = useMemo(() => new Raycaster(), []);
  const pointer = useMemo(() => new Vector2(), []);

  const handleClick = useCallback((event: MouseEvent) => {
    if (!useGuidelineStore.getState().active) return;
    if (event.button !== 0) return;

    const rect = gl.domElement.getBoundingClientRect();
    pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
    pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;

    raycaster.setFromCamera(pointer, camera);
    const intersects = raycaster.intersectObjects(scene.children, true);

    for (const hit of intersects) {
      const name = hit.object.name;
      // Skip guidelines and measurement objects
      if (name.startsWith("guideline-") || name.startsWith("measurement-")) continue;

      const point: Point3 = [hit.point.x, hit.point.y, hit.point.z];
      const wallHit = detectWallHit(point, name);

      if (wallHit !== null) {
        useGuidelineStore.getState().placeGuideline(wallHit);
        invalidate();
        break;
      }
    }
  }, [camera, gl, scene, raycaster, pointer, invalidate]);

  // Invalidate when store changes externally (e.g. toolbar button, dismiss)
  useEffect(() => {
    return useGuidelineStore.subscribe(() => { invalidate(); });
  }, [invalidate]);

  // Click handler on the canvas
  useEffect(() => {
    if (!active) return;
    const canvas = gl.domElement;
    canvas.addEventListener("click", handleClick);
    return () => { canvas.removeEventListener("click", handleClick); };
  }, [active, gl, handleClick]);

  // Keyboard shortcuts: T to toggle, Escape to clear all
  useEffect(() => {
    function onKeyDown(event: KeyboardEvent): void {
      const target = event.target;
      if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement) return;

      if (event.code === "KeyT") {
        useGuidelineStore.getState().toggle();
        invalidate();
      } else if (event.code === "Escape" && useGuidelineStore.getState().active) {
        useGuidelineStore.getState().clearAll();
        invalidate();
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => { window.removeEventListener("keydown", onKeyDown); };
  }, [invalidate]);

  return (
    <group name="tape-measure-tool">
      {guidelines.map((g) => (
        <GuidelineLine key={g.id} guideline={g} />
      ))}
    </group>
  );
}
