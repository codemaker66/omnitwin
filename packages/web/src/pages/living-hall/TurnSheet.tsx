import { useCallback, useEffect, useMemo, type ReactElement } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import {
  BufferAttribute,
  BufferGeometry,
  LineBasicMaterial,
  LineSegments,
  Mesh,
  MeshBasicMaterial,
  PlaneGeometry,
} from "three";
import { INK_GOLD, planSheetStrokes, strokesToInkGeometry } from "./gold-ink.js";
import { TURN_FLOOR_BOUNDS, turnWeight } from "./turn.js";
import { useSectionScrollProgress } from "./useSectionScrollProgress.js";

// -----------------------------------------------------------------------------
// TurnSheet — the room recedes into drafting night; the planner's sheet rises.
//
// The scrim is a camera-parented quad (always filling the frustum) drawn
// after the splat and before the ink: the capture dims, the drawn plan holds
// its light — the mode change IS the message, and it reverses on the way
// out. The sheet is the observed floor's boundary and a hairline grid; it
// carries no dimension figures (the capture frame and the planner's room
// polygon are not yet registered — we print nothing we cannot back).
// -----------------------------------------------------------------------------

export const PLAN_SECTION_ID = "the-plan";

/** Render order contract for the Turn: splat 0 → scrim 5 → ink 10. */
export const TURN_RENDER_ORDER = { scrim: 5, ink: 10 } as const;

const SCRIM_MAX_OPACITY = 0.72;
const SHEET_MAX_OPACITY = 0.55;

export function TurnSheet(): ReactElement {
  const camera = useThree((state) => state.camera);
  const invalidate = useThree((state) => state.invalidate);
  const progressRef = useSectionScrollProgress(
    PLAN_SECTION_ID,
    useCallback(() => {
      invalidate();
    }, [invalidate]),
  );

  const objects = useMemo(() => {
    // Frustum-filling quad half a metre ahead of the lens: at fov 62 the
    // half-height is tan(31°)·0.5 ≈ 0.30m — 2.4×1.2 covers any aspect.
    const scrim = new Mesh(
      new PlaneGeometry(2.4, 1.2),
      new MeshBasicMaterial({
        color: 0x030707,
        transparent: true,
        opacity: 0,
        depthTest: false,
        depthWrite: false,
      }),
    );
    scrim.position.set(0, 0, -0.5);
    scrim.renderOrder = TURN_RENDER_ORDER.scrim;
    scrim.visible = false;

    const ink = strokesToInkGeometry(planSheetStrokes(TURN_FLOOR_BOUNDS));
    const geometry = new BufferGeometry();
    geometry.setAttribute("position", new BufferAttribute(ink.positions, 3));
    const sheet = new LineSegments(
      geometry,
      new LineBasicMaterial({ color: INK_GOLD, transparent: true, opacity: 0, depthTest: false }),
    );
    sheet.renderOrder = TURN_RENDER_ORDER.ink;
    sheet.frustumCulled = false;
    sheet.visible = false;
    return { scrim, sheet, geometry };
  }, []);

  useFrame(() => {
    const w = turnWeight(progressRef.current);
    const on = w > 0.001;
    objects.scrim.visible = on;
    objects.sheet.visible = on;
    objects.scrim.material.opacity = SCRIM_MAX_OPACITY * w;
    objects.sheet.material.opacity = SHEET_MAX_OPACITY * w;
  });

  useEffect(() => {
    camera.add(objects.scrim);
    return () => {
      camera.remove(objects.scrim);
      objects.scrim.geometry.dispose();
      objects.scrim.material.dispose();
      objects.geometry.dispose();
      objects.sheet.material.dispose();
    };
  }, [camera, objects]);

  return <primitive object={objects.sheet} />;
}
