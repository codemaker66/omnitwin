import { useLayoutEffect, useMemo, useRef, type ReactElement } from "react";
import { useThree } from "@react-three/fiber";
import { OrbitControls, OrthographicCamera } from "@react-three/drei";
import { MOUSE, TOUCH, type OrthographicCamera as ThreeOrthographicCamera } from "three";
import { planFitZoom, type PlanFrame } from "./plan-mode.js";

// -----------------------------------------------------------------------------
// PlanRig — the orthographic camera and CAD-grade controls for plan mode.
//
// A plan is drawn to scale or it is not a plan: the perspective orbit the mode
// launched with foreshortened everything it showed (its own comment called the
// true orthographic floorplan "the plan's Task 7" — this is that task). The
// rig mounts a top-down OrthographicCamera as the scene default and restricts
// the controls to PAN and ZOOM only. No tilt, no orbit: the drawing plane
// stays a drawing.
//
// Conventions:
// - Straight down, up = scene −z, so the building sits the way the minimap
//   and ViewpointPlan geometry always drew it. The slight camera-y epsilon the
//   perspective boot needed is unnecessary — `up` is set explicitly.
// - LEFT drag PANS (the CAD grammar; there is nothing to rotate), wheel and
//   pinch zoom, two-finger touch pans.
// - Zoom is px-per-metre exactly (drei's ortho frustum is viewport-sized, so
//   camera.zoom IS the scale). Every zoom change is reported so the HUD's
//   scale bar can restate it as a measured length; the report rides the
//   controls' own change event, throttled to animation frames by the demand
//   loop itself.
// - Re-fit on storey switch: each storey frames its own footprint.
// -----------------------------------------------------------------------------

/** How far above the frame centre the camera stands. Any height works for an
 *  orthographic projection; standing well above the roof keeps near/far
 *  planes trivially safe. */
const PLAN_CAMERA_HEIGHT_M = 80;

/** Zoom rails, as multiples of the storey's fit zoom. */
const PLAN_MIN_ZOOM_FACTOR = 0.5;
const PLAN_MAX_ZOOM_FACTOR = 60;

export interface PlanRigProps {
  /** The active storey's horizontal frame — pans/fit are derived from it. */
  readonly frame: PlanFrame;
  /** Identity of the active storey — a change re-fits the view. */
  readonly storeyKey: number;
  /** Reports the live scale (px per metre) for the HUD's scale bar. */
  readonly onScale: (pxPerMetre: number) => void;
}

export function PlanRig({ frame, storeyKey, onScale }: PlanRigProps): ReactElement {
  const size = useThree((state) => state.size);
  const invalidate = useThree((state) => state.invalidate);
  const cameraRef = useRef<ThreeOrthographicCamera | null>(null);

  const fitZoom = useMemo(
    () => planFitZoom(size.width, size.height, frame),
    [size.width, size.height, frame],
  );
  // The boot effect below must see the freshest fit without re-running on
  // resize — a resize mid-session must not yank a view the visitor panned.
  const fitZoomRef = useRef(fitZoom);
  fitZoomRef.current = fitZoom;
  const frameRef = useRef(frame);
  frameRef.current = frame;
  const onScaleRef = useRef(onScale);
  onScaleRef.current = onScale;

  // Boot / re-fit: on storey entry the camera stands over the storey's centre
  // at its fit zoom. Layout-phase, so the scale bar's first paint already
  // shows THIS storey's figure — an instrument must not open on a stale
  // reading (review finding).
  useLayoutEffect(() => {
    const camera = cameraRef.current;
    if (camera === null) {
      return;
    }
    const target = frameRef.current;
    camera.position.set(target.centerX, PLAN_CAMERA_HEIGHT_M, target.centerZ);
    camera.zoom = fitZoomRef.current;
    camera.updateProjectionMatrix();
    camera.lookAt(target.centerX, 0, target.centerZ);
    onScaleRef.current(camera.zoom);
    invalidate();
  }, [storeyKey, invalidate]);

  return (
    <>
      <OrthographicCamera
        ref={cameraRef}
        makeDefault
        position={[frame.centerX, PLAN_CAMERA_HEIGHT_M, frame.centerZ]}
        zoom={fitZoom}
        near={0.1}
        far={PLAN_CAMERA_HEIGHT_M * 4}
        // Straight-down view: up must be a horizontal axis or the projection
        // is undefined; −z puts the building the way the plan drawings do.
        up={[0, 0, -1]}
      />
      <OrbitControls
        makeDefault
        enableRotate={false}
        screenSpacePanning
        enableDamping
        target={[frame.centerX, 0, frame.centerZ]}
        minZoom={fitZoom * PLAN_MIN_ZOOM_FACTOR}
        maxZoom={fitZoom * PLAN_MAX_ZOOM_FACTOR}
        mouseButtons={{ LEFT: MOUSE.PAN, MIDDLE: MOUSE.DOLLY, RIGHT: MOUSE.PAN }}
        touches={{ ONE: TOUCH.PAN, TWO: TOUCH.DOLLY_PAN }}
        onChange={() => {
          const camera = cameraRef.current;
          if (camera !== null) {
            onScaleRef.current(camera.zoom);
          }
          invalidate();
        }}
      />
    </>
  );
}
