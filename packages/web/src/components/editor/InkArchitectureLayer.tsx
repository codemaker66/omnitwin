import { useEffect, useMemo, useRef, type ReactElement } from "react";
import { useThree } from "@react-three/fiber";
import { BufferGeometry, Float32BufferAttribute, LineBasicMaterial, LineSegments } from "three";
import { toRenderSpace } from "../../constants/scale.js";
import { GRID_COLOR } from "../../constants/colors.js";
import { prefersReducedMotion } from "../../lib/reduced-motion.js";
import { sectionClipPlanes } from "../SectionPlane.js";

// ---------------------------------------------------------------------------
// InkArchitectureLayer — the blueprint linework that paints first (CARD A2,
// 01 §13 / 02 §6 signature move 1: "the room resolves"). Floor loop, ceiling
// loop, and corner verticals drawn in the established floor-grid ink. Fades
// down as the captured splat develops over it; stays up in the atelier
// fallback (clay + ink). Seeds the Plan-band ink system (C2).
// ---------------------------------------------------------------------------

/** Lift the floor loop just above the slab grid (GRID_Y = 0.002) so the ink
 *  never z-fights the floor or its grid lines. */
export const INK_FLOOR_LIFT = 0.004;

const INK_EASE = 0.16;
const INK_SNAP = 0.012;

/**
 * Pure segment builder: wall polygon (metres) + ceiling height (metres) →
 * render-space LineSegments positions. Degenerate polygons (< 3 points)
 * produce no linework rather than broken loops.
 */
export function buildInkSegments(
  polygon: readonly (readonly [number, number])[],
  ceilingHeightM: number,
): Float32Array {
  if (polygon.length < 3) return new Float32Array(0);
  const ceilingY = toRenderSpace(ceilingHeightM);
  const floats: number[] = [];
  for (let i = 0; i < polygon.length; i++) {
    const a = polygon[i];
    const b = polygon[(i + 1) % polygon.length];
    if (a === undefined || b === undefined) continue;
    const ax = toRenderSpace(a[0]);
    const az = toRenderSpace(a[1]);
    const bx = toRenderSpace(b[0]);
    const bz = toRenderSpace(b[1]);
    // Floor edge, ceiling edge, and the vertical rising from corner `a`.
    floats.push(ax, INK_FLOOR_LIFT, az, bx, INK_FLOOR_LIFT, bz);
    floats.push(ax, ceilingY, az, bx, ceilingY, bz);
    floats.push(ax, INK_FLOOR_LIFT, az, ax, ceilingY, az);
  }
  return new Float32Array(floats);
}

export interface InkArchitectureLayerProps {
  readonly polygon: readonly (readonly [number, number])[];
  readonly ceilingHeightM: number;
  /** Where the ink should settle: 1 = full blueprint, 0 = resolved away. */
  readonly targetOpacity: number;
}

export function InkArchitectureLayer({
  polygon,
  ceilingHeightM,
  targetOpacity,
}: InkArchitectureLayerProps): ReactElement | null {
  const invalidate = useThree((state) => state.invalidate);

  const lines = useMemo(() => {
    const positions = buildInkSegments(polygon, ceilingHeightM);
    if (positions.length === 0) return null;
    const geometry = new BufferGeometry();
    geometry.setAttribute("position", new Float32BufferAttribute(positions, 3));
    const material = new LineBasicMaterial({
      color: GRID_COLOR,
      transparent: true,
      opacity: 0,
      depthWrite: false,
      clippingPlanes: sectionClipPlanes,
    });
    const segments = new LineSegments(geometry, material);
    segments.frustumCulled = false;
    return segments;
  }, [ceilingHeightM, polygon]);

  useEffect(() => () => {
    if (lines === null) return;
    lines.geometry.dispose();
    (lines.material).dispose();
  }, [lines]);

  const opacityRef = useRef(0);

  // A recreated LineSegments constructs its material at opacity 0 — reset the
  // ease's start point so the new room's ink rises cleanly from 0 instead of
  // resuming from the previous room's mid-fade value (reviewer MEDIUM
  // finding). Runs before the ease effect below (effect order).
  useEffect(() => {
    opacityRef.current = 0;
  }, [lines]);

  useEffect(() => {
    if (lines === null) return undefined;
    const material = lines.material;
    const target = Math.min(Math.max(targetOpacity, 0), 1);

    const apply = (value: number): void => {
      opacityRef.current = value;
      material.opacity = value;
      lines.visible = value > 0.002;
      invalidate();
    };

    if (prefersReducedMotion()) {
      apply(target);
      return undefined;
    }

    let raf = 0;
    let last = performance.now();
    const step = (now: number): void => {
      const dt = Math.min(Math.max((now - last) / 1000, 0), 0.1);
      last = now;
      const current = opacityRef.current;
      const delta = target - current;
      if (Math.abs(delta) <= INK_SNAP) {
        apply(target);
        return;
      }
      apply(current + delta * (1 - Math.pow(1 - INK_EASE, dt * 60)));
      raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => { cancelAnimationFrame(raf); };
  }, [invalidate, lines, targetOpacity]);

  if (lines === null) return null;
  return <primitive object={lines} />;
}
