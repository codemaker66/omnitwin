import { useCallback, useEffect, useMemo, useRef, type ReactElement } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import {
  BufferAttribute,
  BufferGeometry,
  LineBasicMaterial,
  LineSegments,
  Mesh,
  MeshBasicMaterial,
  SphereGeometry,
} from "three";
import {
  INK_GOLD,
  INK_GOLD_BRIGHT,
  buildFirstTableStrokes,
  drawnSegments,
  penHead,
  strokesToInkGeometry,
} from "./gold-ink.js";
import { useSectionScrollProgress } from "./useSectionScrollProgress.js";

// -----------------------------------------------------------------------------
// GoldInkTable — the drafting pen performing the storyboard.
//
// One LineSegments whose drawRange is the pen's odometer: scroll through the
// Dressing act and the first table draws itself, stroke by stroke, at
// constant pen speed; scroll back and it un-draws. The nib — a 1.5cm bright
// point, the page's only permitted glint — rides the last drawn segment and
// leaves when the drawing is done. World-space (Y-up): mounted OUTSIDE the
// Z-up splat group. Scroll progress lives in a ref; its onChange invalidates
// the demand loop and useFrame applies the odometer before each render.
// -----------------------------------------------------------------------------

export const DRESSING_SECTION_ID = "the-dressing";

export function GoldInkTable(): ReactElement {
  const invalidate = useThree((state) => state.invalidate);
  const progressRef = useSectionScrollProgress(
    DRESSING_SECTION_ID,
    useCallback(() => {
      invalidate();
    }, [invalidate]),
  );

  const ink = useMemo(() => strokesToInkGeometry(buildFirstTableStrokes()), []);

  const objects = useMemo(() => {
    const geometry = new BufferGeometry();
    geometry.setAttribute("position", new BufferAttribute(ink.positions, 3));
    geometry.setDrawRange(0, 0);
    const lines = new LineSegments(
      geometry,
      new LineBasicMaterial({ color: INK_GOLD, transparent: true, opacity: 0.95 }),
    );
    lines.frustumCulled = false; // drawRange animates; keep the whole table drawable
    const nib = new Mesh(
      new SphereGeometry(0.0075, 8, 8),
      new MeshBasicMaterial({ color: INK_GOLD_BRIGHT }),
    );
    nib.visible = false;
    return { geometry, lines, nib };
  }, [ink]);

  const lastCount = useRef(-1);

  useFrame(() => {
    const count = drawnSegments(ink, progressRef.current);
    if (count === lastCount.current) return;
    lastCount.current = count;
    objects.geometry.setDrawRange(0, count * 2);
    const head = penHead(ink, count);
    const drawing = count > 0 && count < ink.segmentCount;
    objects.nib.visible = drawing && head !== null;
    if (head !== null) objects.nib.position.set(head[0], head[1], head[2]);
  });

  useEffect(() => {
    return () => {
      objects.geometry.dispose();
      objects.lines.material.dispose();
      objects.nib.geometry.dispose();
      objects.nib.material.dispose();
    };
  }, [objects]);

  return (
    <>
      <primitive object={objects.lines} />
      <primitive object={objects.nib} />
    </>
  );
}
