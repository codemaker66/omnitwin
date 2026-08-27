import {
  Suspense,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
  type MutableRefObject,
  type ReactElement,
} from "react";
import { useSearchParams } from "react-router-dom";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { OrbitControls } from "@react-three/drei";
import {
  Euler,
  Mesh,
  PerspectiveCamera,
  Raycaster,
  Vector2,
  Vector3,
  type Camera,
  type Texture,
  type Intersection,
  type Object3D,
  type Plane,
} from "three";
import type { TwinManifest, TwinScanNode } from "@omnitwin/types";
import {
  DOLLHOUSE_DOT_RADIUS_M,
  DollhouseStage,
  preloadDollhouse,
} from "./DollhouseStage.js";
import {
  FIRST_LIGHT_FAILSAFE_MS,
  FIRST_LIGHT_FOV_OFFSET_DEG,
  FIRST_LIGHT_OVERLAY_MAX_OPACITY,
  FIRST_LIGHT_PITCH_OFFSET_RAD,
  FIRST_LIGHT_SPRING,
  FIRST_LIGHT_YAW_OFFSET_RAD,
  firstLightEligible,
  firstLightSeen,
  markFirstLightSeen,
} from "./first-light.js";
import { NavMarkers } from "./NavMarkers.js";
import {
  PlanAnnotations,
  PlanLabelProjector,
  type PlanLabelScreen,
} from "./PlanAnnotations.js";
import { PlanHud } from "./PlanHud.js";
import { PlanRig } from "./PlanRig.js";
import { planCutY, planFrame, planRoomLabels, storeysFromNodes } from "./plan-mode.js";
import {
  NEIGHBOUR_WARM_SLICE_MS,
  NEIGHBOUR_WARM_TIMEOUT_MS,
  planNeighbourWarm,
  runNeighbourWarmQueue,
  type IdleDeadlineLike,
  type WarmCandidate,
} from "./neighbour-warm.js";
import { ParallaxStage } from "./ParallaxStage.js";
import { TravelControls } from "./TravelControls.js";
import { PanoStage } from "./PanoStage.js";
import { stepSpring, type SpringState } from "../lib/springs.js";
import { e57PointToThree, e57QuatToThree } from "./twin-basis.js";
import { decodeTwinLook, encodeTwinLook, type TwinLook } from "./twin-look.js";
import { MAX_USHER_HOPS, shortestRoute } from "./travel-route.js";
import { FloorConstellation } from "./shell/FloorConstellation.js";
import { QuickActions } from "./shell/QuickActions.js";
import { RoomDossier } from "./shell/RoomDossier.js";
import { RoomSelector } from "./shell/RoomSelector.js";
import {
  MeasureLayer,
  type MeasurePoint,
  type MeasureScreenPoint,
} from "./measure/MeasureLayer.js";
import { MEASURE_GROUP_LABEL } from "./measure/measure-copy.js";
import type { MeasureVec3 } from "./measure/measure-math.js";
// The measure TRIGGER is painted while MeasureLayer is unmounted, so its
// stylesheet cannot arrive with the layer. See measure.css's header.
import "./measure/measure.css";
import {
  TWIN_DISCLOSURE,
  TWIN_MODE_DOLLHOUSE_LABEL,
  TWIN_MODE_GROUP_LABEL,
  TWIN_MODE_PLAN_LABEL,
  TWIN_MODE_WALK_LABEL,
  TWIN_SURFACE_LABEL,
  TWIN_VIEWER_ROLE,
  twinNodeLabel,
  twinViewerLabel,
  twinViewpointAnnouncement,
} from "./twin-copy.js";
import { prefersReducedMotion } from "./reduced-motion.js";
import { TwinCoachHint } from "./TwinCoachHint.js";
import { TwinViewerControls } from "./TwinViewerControls.js";
import { useDive, type DiveDirection } from "./useDive.js";
import { useTwinMode, type TwinMode } from "./useTwinMode.js";
import { warmEquirectBase } from "./useEquirectTexture.js";
import { useTwinPrefetch } from "./useTwinPrefetch.js";
import { useTwinGlide } from "./useTwinGlide.js";
import { lookStateFromCamera, WalkControls } from "./WalkControls.js";

// -----------------------------------------------------------------------------
// TwinViewer — the walkable pano viewer (Twin Phase 1, Task 9).
//
// Composes the demand-frameloop Canvas: WalkControls (look/zoom springs), one
// PanoStage per live node — the current node fading out (1 − progress) and
// the hop target fading in (progress), keyed by node id so the settled
// target's textures survive the swap — plus the gold NavMarkers (hidden while
// a hop is in flight) and a CameraDolly that lerps the camera between the two
// node positions each frame from a ref, never React state.
//
// Outside the Canvas live the HUD pieces: the node label, the claim-safe
// disclosure line, the room dossier, the quick-action rail, and — bottom right
// — one mode-appropriate tool pill.
//
// THE MINIMAP IS GONE, and its removal is the point of this pass rather than a
// side effect. It drew all 149 scan positions as identical cream dots above two
// buttons reading "Floor 0" and "Floor -1". Three things were wrong with that.
// The dots are the same mark whatever they stand for, so 149 of them say
// nothing. It held 149 tab stops. And the storey labels were the SCANNER's
// vocabulary printed at a wedding customer: manifest floor 0 is the building's
// first floor (the Grand Hall, the Saloon) and floor −1 is the GROUND floor, the
// entrance — so a guest standing in the front door was told they were on floor
// minus one. shell/RoomSelector.tsx replaces it: four validated rooms, grouped
// by storey and named RELATIONALLY ("On this level", "One level down"), which is
// true at all 149 viewpoints without claiming a storey nobody scanned.
//
// TwinMinimap.tsx itself still sits in the tree, unmounted — its own test file
// belongs to another lane, so deleting it is not this lane's change to make. It
// renders nowhere, so no guest is told anything about a floor minus one.
//
// YawProbe survives the minimap it was written for: it still mirrors the full
// camera pose into `liveLookRef` every frame, which is what mints the "stand
// where I'm standing" share link. What it no longer does is lift yaw into React
// state — nothing consumed that once the view cone left.
//
// shell/ViewpointPlan.tsx IS DELIBERATELY NOT MOUNTED, and this is the record of
// that decision rather than an oversight to be found later. It is a good
// component — a plan view drawn off the real E57 poses, storey-filtered, with a
// view cone. But this HUD already has a PLAN: a top-level segment in the mode
// switcher that renders the actual building mesh from overhead at full stage
// size, with orbit, zoom and now the measure tool on it. ViewpointPlan would put
// a second overhead map on the same screen, at 260px, showing scan positions —
// which is the dot cloud the customer rejected in the first place, redrawn more
// carefully. Two controls doing one job is its own defect, and the smaller,
// less truthful of the two is not the one to keep. The room-level question it
// might have answered ("what else is there, and can I go") is now the Rooms
// panel's, answered in words and published figures rather than in dots.
//
// If it earns a mount later it belongs INSIDE plan mode as an overlay on the
// real overhead view, not as a third HUD panel competing with it.
//
// Phase 2 (Task 5) adds the mode machine: a segmented control (top-right,
// only when the bundle carries a mesh) switches walk ⇄ dollhouse ⇄ plan.
// Walk renders the Phase-1 content unchanged; the mesh modes render
// DollhouseStage under OrbitControls (target = node-extent centroid). Plan
// mode currently shares the dollhouse stage with an overhead vantage — the
// true orthographic floorplan with per-floor slicing is the plan's Task 7.
// The minimap shows in walk mode only.
//
// Plan: docs/superpowers/plans/2026-07-02-twin-phase1-walk.md (Tasks 9–10)
// and …/2026-07-02-twin-phase2-dollhouse.md (Tasks 4–5).
// -----------------------------------------------------------------------------

interface DollyState {
  from: readonly [number, number, number];
  to: readonly [number, number, number];
  progress: number;
  /** Yaw (three YXZ) to face while travelling; null outside rides. */
  travelYaw: number | null;
  /** True while the continuous glide owns movement: yaw rides a persistent
   *  spring toward the route tangent (corners round in the LOOK, since the
   *  position must stay on the scan-centre polyline), fov never surges, and
   *  the segment roll-over carries no per-hop re-capture. */
  glide: boolean;
}

/** Glide heading spring (ζ ≈ 1.02) — the camera operator leading the turn by
 *  about half a second, which is what rounds a square corner into a pan. */
const GLIDE_YAW_SPRING = { stiffness: 24, damping: 10 } as const;

/** Shortest signed angular distance a→b (radians). */
function shortestYawDelta(a: number, b: number): number {
  const raw = (b - a) % (Math.PI * 2);
  if (raw > Math.PI) {
    return raw - Math.PI * 2;
  }
  if (raw < -Math.PI) {
    return raw + Math.PI * 2;
  }
  return raw;
}

/** Scratch Euler for the dolly's travel turn — no per-frame allocation. */
const dollyEuler = new Euler(0, 0, 0, "YXZ");

/**
 * Camera position = lerp(from, to, fraction), read from refs each frame so
 * per-frame motion never re-renders React. While a ride is travelling the
 * dolly also owns orientation: the heading rides ONE persistent spring toward
 * the live route tangent (corners round in the LOOK — the position must stay
 * on the scan-centre polyline for the crossfade to stay optically honest),
 * pitch is captured at ride entry and held (gazing up at the dome stays
 * gazing up), and the fov is never touched — Street View and Matterport
 * breathe none while travelling, and neither do we. WalkControls is disabled
 * during rides and re-adopts the camera's pose when it re-engages at settle.
 *
 * The per-hop smoothstep/fov-surge machinery this replaced is gone WITH the
 * discrete hops themselves: every travel path — tap, hold, Usher — now moves
 * through the glide walker, so a "hop that is not a glide" cannot occur
 * (review finding: the branch was unreachable).
 */
function CameraDolly({
  dolly,
  progressRef,
}: {
  readonly dolly: MutableRefObject<DollyState>;
  /** The walker's live segment fraction — per-frame position during a glide
   *  comes from here, not from React-rendered state. */
  readonly progressRef: { readonly current: number };
}): null {
  const camera = useThree((state) => state.camera);
  const invalidate = useThree((state) => state.invalidate);
  // The glide's persistent heading: one spring living across every segment of
  // a ride, adopted from the camera on entry, stepped toward the live route
  // tangent each frame. Pitch is captured once and held — the visitor's gaze
  // height is theirs; only the heading is the camera operator's.
  const glideLook = useRef<{ yaw: SpringState; pitch: number } | null>(null);

  useFrame((_, delta) => {
    const { from, to, progress, travelYaw, glide } = dolly.current;
    const p = glide ? progressRef.current : progress;
    const x = from[0] + (to[0] - from[0]) * p;
    const y = from[1] + (to[1] - from[1]) * p;
    const z = from[2] + (to[2] - from[2]) * p;
    if (camera.position.x !== x || camera.position.y !== y || camera.position.z !== z) {
      camera.position.set(x, y, z);
      invalidate();
    }

    if (glide) {
      if (glideLook.current === null) {
        dollyEuler.setFromQuaternion(camera.quaternion, "YXZ");
        glideLook.current = {
          yaw: { value: dollyEuler.y, velocity: 0 },
          pitch: dollyEuler.x,
        };
      }
      const look = glideLook.current;
      if (travelYaw !== null) {
        // Spring the HEADING, not the shortest-delta result: unwrap the
        // target next to the spring's current value so a tangent crossing
        // the ±π seam never spins the long way round.
        const target = look.yaw.value + shortestYawDelta(look.yaw.value, travelYaw);
        stepSpring(look.yaw, target, Math.min(delta, 1 / 20), GLIDE_YAW_SPRING);
      }
      camera.quaternion.setFromEuler(dollyEuler.set(look.pitch, look.yaw.value, 0, "YXZ"));
      invalidate();
      return;
    }
    if (glideLook.current !== null) {
      // Ride over: drop the heading spring; WalkControls re-adopts the pose.
      glideLook.current = null;
    }
  });

  return null;
}

interface DiveFlight {
  from: readonly [number, number, number];
  to: readonly [number, number, number];
  progress: number;
  fovFrom: number;
  fovTo: number;
  look: readonly [number, number, number];
}

/**
 * The dive's camera path: a quadratic bezier through a raised midpoint (the
 * camera swoops, never sinks), fov easing between the orbit's 50° and the
 * walk's 75°, gaze held on `look`. Reads a ref each frame — no React state.
 */
function DiveCamera({ flight }: { readonly flight: MutableRefObject<DiveFlight> }): null {
  const camera = useThree((state) => state.camera);
  const invalidate = useThree((state) => state.invalidate);

  useFrame(() => {
    const { from, to, progress, fovFrom, fovTo, look } = flight.current;
    const t = progress;
    const inv = 1 - t;
    const midX = (from[0] + to[0]) / 2;
    const midY = (from[1] + to[1]) / 2 + 2.5;
    const midZ = (from[2] + to[2]) / 2;
    camera.position.set(
      inv * inv * from[0] + 2 * inv * t * midX + t * t * to[0],
      inv * inv * from[1] + 2 * inv * t * midY + t * t * to[1],
      inv * inv * from[2] + 2 * inv * t * midZ + t * t * to[2],
    );
    camera.lookAt(look[0], look[1], look[2]);
    if (camera instanceof PerspectiveCamera) {
      camera.fov = fovFrom + (fovTo - fovFrom) * t;
      camera.updateProjectionMatrix();
    }
    invalidate();
  });

  return null;
}

/** Writes the live camera position into a ref (mesh modes) so a dot click
 *  can start the dive from exactly where the visitor is orbiting. */
function CameraProbe({
  position,
}: {
  readonly position: MutableRefObject<[number, number, number]>;
}): null {
  const camera = useThree((state) => state.camera);
  useFrame(() => {
    position.current[0] = camera.position.x;
    position.current[1] = camera.position.y;
    position.current[2] = camera.position.z;
  });
  return null;
}

/** Live camera pose for event-time reads (the share link) — a ref, never state. */
interface LiveLook {
  yawRad: number;
  pitchRad: number;
  fovDeg: number;
}

/**
 * Mirrors the full camera pose (yaw / pitch / fov) into `lookRef` every frame —
 * a plain ref write, read only at share-click time to mint the exact-view link.
 *
 * It USED to also lift yaw into React state, throttled to ~10 Hz and gated on a
 * 0.05 rad delta, to turn the minimap's view cone. The minimap is gone and
 * nothing else ever read that value, so the state, the throttle and its two
 * tuning constants went with it. Keeping a ~10 Hz setState alive for no consumer
 * would have been a re-render per look-drag paid for nothing.
 */
function YawProbe({ lookRef }: { readonly lookRef: MutableRefObject<LiveLook> }): null {
  const camera = useThree((state) => state.camera);

  useFrame(() => {
    if (!(camera instanceof PerspectiveCamera)) {
      return;
    }
    const { yaw, pitch } = lookStateFromCamera(camera);
    lookRef.current.yawRad = yaw;
    lookRef.current.pitchRad = pitch;
    lookRef.current.fovDeg = camera.fov;
  });

  return null;
}

// -----------------------------------------------------------------------------
// THE MEASURE PICK — where a click becomes a point in the building.
//
// MeasureLayer deliberately does no raycasting: the host owns the camera and the
// geometry, so the host is the only thing that can turn a click into a world
// point. This is the host half, and it is the piece that was missing — the layer
// has been built and tested since August and has never once been on screen.
//
// WHERE IT IS ARMED, AND WHY NOT IN WALK MODE. A pano is a sphere painted with a
// photograph, drawn AROUND the camera. A click on it yields a direction and no
// depth whatsoever, so two clicks in walk mode would produce an angle dressed up
// as a distance — the single worst thing a measuring tool can do. The mesh modes
// put the co-registered building geometry itself on screen, so a click there
// lands on a real wall at a real distance. The tool is therefore offered in
// Dollhouse and Plan and is honestly absent in Walk.
//
// ParallaxStage does carry the same mesh during walk hops, but it is `visible`
// only mid-hop and its BatchedMesh culls every instance outside the hop
// corridor, so it is not a collider anyone could pick against at rest. Mounting
// a second, hidden copy purely to enable a pick would mean a second 7 MB decode
// under a different drei cache key. That is the honest limit of this pass.
// -----------------------------------------------------------------------------

/** The name DollhouseStage gives the basis-conversion group that wraps the real
 *  geometry. Looked up rather than passed down: the mesh arrives through
 *  Suspense inside a component this file does not own, so there is no ref to
 *  thread — and a name lookup that finds nothing is exactly the "no geometry
 *  yet, take no pick" answer we want. */
const MEASURE_MESH_ROOT = "twin-mesh-root";

/** How far a pointer may travel between down and up and still count as a pick
 *  rather than an orbit drag. Orbiting is the primary gesture in these modes, so
 *  a tool that fired on every mouse-up would make the camera unusable. */
const MEASURE_DRAG_SLOP_PX = 5;

/** How far a projected point must move, as a fraction of the stage, before the
 *  overlay is re-rendered. Two points at 60 Hz is a cheap setState, but a
 *  sub-pixel one is a free one not taken. */
const MEASURE_PROJECT_EPSILON = 0.0015;

/** A tape drawn on the diagonal, with end caps and two graduations. 13px sits
 *  level with the 0.72rem uppercase label — the Rooms pill's own pairing, since
 *  the two share a slot and must read as one control changing job. */
const ICON_MEASURE: ReactElement = (
  <svg
    className="vv-twin-measure-trigger-icon"
    viewBox="0 0 24 24"
    width={13}
    height={13}
    fill="none"
    stroke="currentColor"
    strokeWidth="1.6"
    strokeLinecap="round"
    aria-hidden
  >
    <path d="M4.5 19.5 19.5 4.5" />
    <path d="M2.5 17.5 6.5 21.5M17.5 2.5l4 4" />
    <path d="m8.5 15.5 1.6 1.6M12.5 11.5l1.6 1.6" />
  </svg>
);

/** Scratch, module-scope, in the `dollyEuler` idiom — no per-pick allocation. */
const measureRaycaster = new Raycaster();
const measurePointer = new Vector2();
const measureProjection = new Vector3();

/**
 * Is this hit on a face the cutaway has clipped away?
 *
 * Dollhouse mode slices the shell open with clipping planes so the visitor can
 * see inside. Clipping is a RASTER operation — the raycaster knows nothing about
 * it — so without this filter the first hit is routinely the roof the visitor
 * cannot see, and the tool would measure to a surface that is not on screen.
 *
 * The planes are read off the hit material rather than recomputed from the
 * cutaway parameters. A second derivation would be a second thing to keep in
 * step with dollhouse-cutaway.ts; the material is the ground truth the GPU
 * itself uses, so this cannot drift from what the visitor sees.
 */
function measureHitIsClipped(hit: Intersection): boolean {
  if (!(hit.object instanceof Mesh)) {
    return false;
  }
  // Read through an explicit shape rather than through `Mesh.material`.
  // @types/three 0.180 ships one bundled single-line declaration file and the
  // material property resolves to `any` at this call site, which
  // no-unsafe-assignment rightly refuses: an `any` here would silently swallow a
  // renamed `clippingPlanes`, the one property this whole filter reads. Naming
  // the shape gets the same narrowing with the type written down where a reader
  // can check it. A material can be one or many — three permits both, and the
  // dollhouse scene really does carry multi-material primitives.
  const source: unknown = (hit.object as { readonly material?: unknown }).material;
  const carriers: readonly unknown[] = Array.isArray(source)
    ? (source as readonly unknown[])
    : [source];
  return carriers.some((carrier) => {
    const planes = (carrier as { readonly clippingPlanes?: readonly Plane[] | null })
      .clippingPlanes;
    if (planes === undefined || planes === null) {
      return false;
    }
    return planes.some((plane) => plane.distanceToPoint(hit.point) < 0);
  });
}

/**
 * The nearest VISIBLE point of the building under normalised device coordinates
 * (x, y ∈ [−1, 1]), or null when the ray meets nothing pickable — no mesh
 * mounted yet, or the visitor clicked the sky.
 *
 * Exported and free of React so the clip rule can be tested against synthetic
 * hits without a renderer, which is the only way this branch gets covered:
 * happy-dom has no WebGL and therefore no real intersections at all.
 */
export function measurePickFrom(
  scene: Object3D,
  camera: Camera,
  ndcX: number,
  ndcY: number,
): MeasureVec3 | null {
  const root = scene.getObjectByName(MEASURE_MESH_ROOT);
  if (root === undefined) {
    return null;
  }
  measurePointer.set(ndcX, ndcY);
  measureRaycaster.setFromCamera(measurePointer, camera);
  for (const hit of measureRaycaster.intersectObject(root, true)) {
    if (!measureHitIsClipped(hit)) {
      return [hit.point.x, hit.point.y, hit.point.z];
    }
  }
  return null;
}

/**
 * Where a world point currently appears on the stage, as a fraction of its
 * width and height — or null when it is behind the camera, which is the layer's
 * cue to keep the figures and draw no line.
 */
function measureProject(world: MeasureVec3, camera: Camera): MeasureScreenPoint | null {
  measureProjection.set(world[0], world[1], world[2]).project(camera);
  if (measureProjection.z > 1) {
    return null;
  }
  return {
    x: (measureProjection.x + 1) / 2,
    y: (1 - measureProjection.y) / 2,
  };
}

/**
 * The in-Canvas half of the measure tool: turns clicks into world points, and
 * keeps the overlay's drawing registered to the camera as it orbits.
 *
 * Listens on the canvas element rather than through R3F's own pointer events
 * because the mesh is mounted by a component this file does not own — there is
 * no `onClick` to attach to without editing DollhouseStage. Down/up with a slop
 * threshold, so an orbit drag that happens to end over a wall is not a pick.
 */
function MeasurePicker({
  points,
  onPick,
  onProject,
  pickAtCentreRef,
}: {
  readonly points: readonly MeasureVec3[];
  readonly onPick: (world: MeasureVec3) => void;
  readonly onProject: (screens: readonly (MeasureScreenPoint | null)[]) => void;
  /** Filled with the centre-pick action while mounted, so the DOM panel's
   *  keyboard-reachable button can reach into the scene without a second
   *  raycaster living outside the Canvas. */
  readonly pickAtCentreRef: MutableRefObject<(() => void) | null>;
}): null {
  const camera = useThree((state) => state.camera);
  const scene = useThree((state) => state.scene);
  const gl = useThree((state) => state.gl);
  const invalidate = useThree((state) => state.invalidate);
  const lastProjected = useRef<readonly (MeasureScreenPoint | null)[]>([]);

  useEffect(() => {
    const element = gl.domElement;
    const down = { x: 0, y: 0 };

    const onPointerDown = (event: PointerEvent): void => {
      down.x = event.clientX;
      down.y = event.clientY;
    };
    const onPointerUp = (event: PointerEvent): void => {
      if (Math.hypot(event.clientX - down.x, event.clientY - down.y) > MEASURE_DRAG_SLOP_PX) {
        return; // an orbit drag, not a pick
      }
      const rect = element.getBoundingClientRect();
      if (rect.width === 0 || rect.height === 0) {
        return;
      }
      const world = measurePickFrom(
        scene,
        camera,
        ((event.clientX - rect.left) / rect.width) * 2 - 1,
        -((event.clientY - rect.top) / rect.height) * 2 + 1,
      );
      if (world !== null) {
        onPick(world);
        // The demand loop is asleep at rest, and the projection below runs in a
        // frame. Without this the first point has no dot until the next orbit.
        invalidate();
      }
    };

    element.addEventListener("pointerdown", onPointerDown);
    element.addEventListener("pointerup", onPointerUp);
    return () => {
      element.removeEventListener("pointerdown", onPointerDown);
      element.removeEventListener("pointerup", onPointerUp);
    };
  }, [gl, scene, camera, onPick, invalidate]);

  useEffect(() => {
    pickAtCentreRef.current = (): void => {
      const world = measurePickFrom(scene, camera, 0, 0);
      if (world !== null) {
        onPick(world);
        invalidate();
      }
    };
    return () => {
      pickAtCentreRef.current = null;
    };
  }, [pickAtCentreRef, scene, camera, onPick, invalidate]);

  useFrame(() => {
    const next = points.map((world) => measureProject(world, camera));
    const previous = lastProjected.current;
    const moved =
      next.length !== previous.length ||
      next.some((screen, index) => {
        const was = previous[index] ?? null;
        if (screen === null || was === null) {
          return screen !== was;
        }
        return (
          Math.abs(screen.x - was.x) > MEASURE_PROJECT_EPSILON ||
          Math.abs(screen.y - was.y) > MEASURE_PROJECT_EPSILON
        );
      });
    if (moved) {
      lastProjected.current = next;
      onProject(next);
    }
  });

  return null;
}

/** Scratch Euler for the First-Light crane (module-scope, like dollyEuler). */
const firstLightEuler = new Euler(0, 0, 0, "YXZ");

/**
 * FirstLightRig — drives the establishing reveal (SS++ phase 1).
 *
 * One critically-damped spring 0→1 carries the whole overture: the camera
 * cranes down from a small lifted offset onto the resting hero frame, the fov
 * relaxes a few degrees, and the cool iris overlay (a DOM sibling, written by
 * ref) opens to nothing — all riding the SAME spring value so nothing can
 * drift. WalkControls is disabled while this runs and re-adopts the camera at
 * the end (its enable effect reads the live pose), so the handover is
 * seamless. Deactivation mid-flight (visitor interacts) simply stops the rig:
 * WalkControls adopts wherever the crane was — no snap.
 */
function FirstLightRig({
  active,
  overlayRef,
  onDone,
}: {
  readonly active: boolean;
  readonly overlayRef: MutableRefObject<HTMLDivElement | null>;
  readonly onDone: () => void;
}): null {
  const camera = useThree((state) => state.camera);
  const invalidate = useThree((state) => state.invalidate);
  const flightRef = useRef<{
    spring: SpringState;
    rest: { yaw: number; pitch: number; fov: number };
  } | null>(null);

  useFrame((_, delta) => {
    if (!active || !(camera instanceof PerspectiveCamera)) {
      return;
    }
    if (flightRef.current === null) {
      // First active frame: the current pose IS the authored resting frame.
      const { yaw, pitch } = lookStateFromCamera(camera);
      flightRef.current = {
        spring: { value: 0, velocity: 0 },
        rest: { yaw, pitch, fov: camera.fov },
      };
    }
    const flight = flightRef.current;
    stepSpring(flight.spring, 1, Math.min(delta, 1 / 20), FIRST_LIGHT_SPRING);
    const p = Math.min(flight.spring.value, 1);
    const away = 1 - p;
    camera.quaternion.setFromEuler(
      firstLightEuler.set(
        flight.rest.pitch + FIRST_LIGHT_PITCH_OFFSET_RAD * away,
        flight.rest.yaw + FIRST_LIGHT_YAW_OFFSET_RAD * away,
        0,
        "YXZ",
      ),
    );
    camera.fov = flight.rest.fov + FIRST_LIGHT_FOV_OFFSET_DEG * away;
    camera.updateProjectionMatrix();
    const overlay = overlayRef.current;
    if (overlay !== null) {
      overlay.style.opacity = String(FIRST_LIGHT_OVERLAY_MAX_OPACITY * away);
    }
    invalidate();
    if (p >= 0.995) {
      // Land exactly on the rest frame; WalkControls adopts it on re-enable.
      camera.quaternion.setFromEuler(
        firstLightEuler.set(flight.rest.pitch, flight.rest.yaw, 0, "YXZ"),
      );
      camera.fov = flight.rest.fov;
      camera.updateProjectionMatrix();
      onDone();
    }
  });

  return null;
}

/**
 * Seed the camera from a valid ?look= param, exactly once. Mounted BEFORE
 * WalkControls in the walk fragment: React runs sibling effects in mount
 * order, so this pose is on the camera by the time WalkControls' enable
 * effect adopts it as spring rest — the recipient simply IS standing where
 * the sender stood. (Canvas onCreated is NOT reliable for this: it can fire
 * after child effects, letting WalkControls adopt the default pose first and
 * spring straight back over the seed.)
 */
function InitialLookRig({ look }: { readonly look: TwinLook | null }): null {
  const camera = useThree((state) => state.camera);
  const invalidate = useThree((state) => state.invalidate);
  const appliedRef = useRef(false);

  useEffect(() => {
    if (appliedRef.current || look === null || !(camera instanceof PerspectiveCamera)) {
      return;
    }
    appliedRef.current = true;
    camera.quaternion.setFromEuler(
      firstLightEuler.set(
        (look.pitchDeg * Math.PI) / 180,
        (look.yawDeg * Math.PI) / 180,
        0,
        "YXZ",
      ),
    );
    camera.fov = look.fovDeg;
    camera.updateProjectionMatrix();
    invalidate();
  }, [camera, invalidate, look]);

  return null;
}

/** Does this engine schedule real idle work? Decided once, so a slice and its
 *  cancellation can never disagree about which handle space they are in. */
const HAS_IDLE_CALLBACK =
  typeof requestIdleCallback === "function" && typeof cancelIdleCallback === "function";
/** Slice cadence where requestIdleCallback is missing (Safari < 17, happy-dom). */
const WARM_FALLBACK_SLICE_MS = 350;

/** Ask for one warm slice. The fallback grants a nominal budget so the queue's
 *  deadline gate stays meaningful on engines with no real IdleDeadline. */
function requestWarmSlice(run: (deadline: IdleDeadlineLike) => void): number {
  if (HAS_IDLE_CALLBACK) {
    return requestIdleCallback(run, { timeout: NEIGHBOUR_WARM_TIMEOUT_MS });
  }
  return window.setTimeout(() => {
    run({ didTimeout: false, timeRemaining: () => NEIGHBOUR_WARM_SLICE_MS });
  }, WARM_FALLBACK_SLICE_MS);
}

function cancelWarmSlice(handle: number): void {
  if (HAS_IDLE_CALLBACK) {
    cancelIdleCallback(handle);
    return;
  }
  window.clearTimeout(handle);
}

/**
 * At rest, decode AND GPU-upload the nearest neighbours' base panos (shared
 * texture registry), so the NEXT hop starts sharp on both sides — the walk
 * never shows a loading photograph.
 *
 * The queue policy — which neighbours, in what order, how many — lives in
 * neighbour-warm.ts, where the cap and the deadline gate are unit-tested
 * without a GPU. This component is only the wiring: it turns nav-graph
 * adjacency into ranked candidates, and turns "acquire" and "upload" into the
 * two real operations. Crucially the initTexture upload is NOT run in the
 * acquire's promise continuation (which lands long after the idle window has
 * closed) but stashed and performed in its own later slice, behind a live
 * deadline check. The previous neighbour set's registry refs are released as
 * the walk moves on.
 */
function NeighborWarmer({
  neighbors,
  currentNode,
  nodesById,
  assetBase,
}: {
  readonly neighbors: readonly string[];
  readonly currentNode: TwinScanNode;
  readonly nodesById: ReadonlyMap<string, TwinScanNode>;
  readonly assetBase: string;
}): null {
  const gl = useThree((state) => state.gl);
  const queue = useMemo(() => {
    const candidates: WarmCandidate[] = [];
    for (const id of neighbors) {
      const node = nodesById.get(id);
      if (node !== undefined) {
        candidates.push({ id, position: e57PointToThree(node.pose.t) });
      }
    }
    return planNeighbourWarm(e57PointToThree(currentNode.pose.t), candidates);
  }, [neighbors, nodesById, currentNode]);

  useEffect(
    () =>
      runNeighbourWarmQueue<Texture>({
        ids: queue,
        acquire: async (id) => {
          // warmEquirectBase hands the texture to its callback synchronously
          // once decoded; stash it rather than uploading, so the ~33.5 MB
          // initTexture can be spent inside a slice that has time for it.
          const slot: { texture: Texture | null } = { texture: null };
          const release = await warmEquirectBase(id, assetBase, (texture) => {
            slot.texture = texture;
          });
          const texture = slot.texture;
          if (texture === null) {
            release();
            return null;
          }
          return { texture, release };
        },
        upload: (texture) => {
          gl.initTexture(texture);
        },
        requestSlice: requestWarmSlice,
        cancelSlice: cancelWarmSlice,
      }),
    [queue, assetBase, gl],
  );
  return null;
}

/** Orbit tilt limit for the dollhouse — never under the floor plane. */
const DOLLHOUSE_MAX_POLAR_RAD = (85 * Math.PI) / 180;
/** Never let the orbit camera dolly closer than this (metres). */
const ORBIT_MIN_DISTANCE_M = 2;
/** Smallest orbit radius — tiny bundles still get a readable dollhouse. */
const ORBIT_MIN_RADIUS_M = 4;
/** Visual-gate value for the Trades Hall camera-facing dollhouse section. */
export const TRADES_HALL_DOLLHOUSE_CUTAWAY_INSET_M = 4;

/** Keep the presentation treatment venue-scoped until another scan is reviewed. */
export function dollhouseCutawayInsetForVenue(venueSlug: string): number | undefined {
  return venueSlug === "trades-hall" ? TRADES_HALL_DOLLHOUSE_CUTAWAY_INSET_M : undefined;
}

/**
 * Section boundary between the current storey and the nearest storey below.
 * Scan poses sit at camera height. The lowest pose classified on the current
 * storey is a conservative lower bound for occupied current-floor content.
 * One marker radius of clearance keeps the lowest current-floor dot visible.
 */
export function lowerFloorSectionMinimumY(
  nodes: readonly TwinScanNode[],
  currentFloor: number,
): number | undefined {
  let nearestLowerFloor = Number.NEGATIVE_INFINITY;
  let currentMinimumY = Number.POSITIVE_INFINITY;
  for (const node of nodes) {
    if (node.floor === currentFloor) {
      currentMinimumY = Math.min(currentMinimumY, node.pose.t[2]);
    } else if (node.floor < currentFloor) {
      nearestLowerFloor = Math.max(nearestLowerFloor, node.floor);
    }
  }
  if (!Number.isFinite(currentMinimumY) || !Number.isFinite(nearestLowerFloor)) {
    return undefined;
  }
  return currentMinimumY - DOLLHOUSE_DOT_RADIUS_M;
}

interface NodeExtent {
  readonly center: [number, number, number];
  readonly radius: number;
}

/** Centroid + bounding radius of the node poses in three space. */
function nodeExtent(nodes: readonly TwinScanNode[]): NodeExtent {
  let minX = Infinity;
  let minY = Infinity;
  let minZ = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  let maxZ = -Infinity;
  for (const node of nodes) {
    const [x, y, z] = e57PointToThree(node.pose.t);
    minX = Math.min(minX, x);
    minY = Math.min(minY, y);
    minZ = Math.min(minZ, z);
    maxX = Math.max(maxX, x);
    maxY = Math.max(maxY, y);
    maxZ = Math.max(maxZ, z);
  }
  if (!Number.isFinite(minX)) {
    return { center: [0, 0, 0], radius: ORBIT_MIN_RADIUS_M };
  }
  const radius =
    Math.max(maxX - minX, maxY - minY, maxZ - minZ, ORBIT_MIN_RADIUS_M * 2) / 2;
  return {
    center: [(minX + maxX) / 2, (minY + maxY) / 2, (minZ + maxZ) / 2],
    radius,
  };
}

/**
 * Orbit rig for DOLLHOUSE mode: boots the camera to the three-quarter
 * vantage on mode entry, then hands control to drei's OrbitControls around
 * the node-extent centroid. The demand loop is woken by the house
 * `onChange={() => { invalidate(); }}` pattern. Plan mode has its own rig —
 * PlanRig, the orthographic drawing camera.
 */
function MeshOrbitRig({
  extent,
  enabled,
}: {
  readonly extent: NodeExtent;
  /** False while a dive flight owns the camera. */
  readonly enabled: boolean;
}): ReactElement {
  const camera = useThree((state) => state.camera);
  const invalidate = useThree((state) => state.invalidate);

  useEffect(() => {
    if (!enabled) {
      return; // the DiveCamera owns the camera; it lands ON the boot vantage
    }
    const [cx, cy, cz] = extent.center;
    camera.position.set(
      cx + extent.radius * 1.15,
      cy + extent.radius * 0.95,
      cz + extent.radius * 1.15,
    );
    camera.lookAt(cx, cy, cz);
    invalidate();
  }, [camera, extent, invalidate, enabled]);

  return (
    <OrbitControls
      makeDefault
      enabled={enabled}
      enableDamping
      target={extent.center}
      maxPolarAngle={DOLLHOUSE_MAX_POLAR_RAD}
      minDistance={ORBIT_MIN_DISTANCE_M}
      maxDistance={extent.radius * 5}
      onChange={() => {
        invalidate();
      }}
    />
  );
}

/** The dollhouse-mode boot vantage — also the surfacing flight's destination,
 *  so the rig's re-boot after a dive up is a visual no-op. */
function orbitVantage(extent: NodeExtent): [number, number, number] {
  return [
    extent.center[0] + extent.radius * 1.15,
    extent.center[1] + extent.radius * 0.95,
    extent.center[2] + extent.radius * 1.15,
  ];
}

const TWIN_MODE_OPTIONS: readonly { readonly id: TwinMode; readonly label: string }[] = [
  { id: "walk", label: TWIN_MODE_WALK_LABEL },
  { id: "dollhouse", label: TWIN_MODE_DOLLHOUSE_LABEL },
  { id: "plan", label: TWIN_MODE_PLAN_LABEL },
];

/**
 * The segmented view-mode control (WAI-ARIA radio group): click or arrow-key
 * between Walk / Dollhouse / Plan. Roving tabindex — the active segment is
 * the group's single tab stop, arrows move both selection and focus.
 */
function TwinModeControl({
  mode,
  setMode,
  onWarmMesh,
}: {
  readonly mode: TwinMode;
  readonly setMode: (mode: TwinMode) => void;
  /** Fired on hover/focus of the control — intent to view the mesh. */
  readonly onWarmMesh?: () => void;
}): ReactElement {
  const buttonsRef = useRef(new Map<TwinMode, HTMLButtonElement | null>());

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>): void => {
    const step =
      event.key === "ArrowRight" || event.key === "ArrowDown"
        ? 1
        : event.key === "ArrowLeft" || event.key === "ArrowUp"
          ? -1
          : 0;
    if (step === 0) {
      return;
    }
    event.preventDefault();
    const index = TWIN_MODE_OPTIONS.findIndex((option) => option.id === mode);
    const next =
      TWIN_MODE_OPTIONS[(index + step + TWIN_MODE_OPTIONS.length) % TWIN_MODE_OPTIONS.length];
    if (next !== undefined) {
      setMode(next.id);
      buttonsRef.current.get(next.id)?.focus();
    }
  };

  return (
    <div
      className="vv-twin-mode"
      role="radiogroup"
      aria-label={TWIN_MODE_GROUP_LABEL}
      data-testid="twin-mode-control"
      onKeyDown={onKeyDown}
      onPointerEnter={onWarmMesh}
      onFocus={onWarmMesh}
    >
      {TWIN_MODE_OPTIONS.map(({ id, label }) => (
        <button
          key={id}
          ref={(element) => {
            buttonsRef.current.set(id, element);
          }}
          type="button"
          role="radio"
          aria-checked={mode === id}
          tabIndex={mode === id ? 0 : -1}
          className={
            mode === id ? "vv-twin-mode-option vv-twin-mode-option--active" : "vv-twin-mode-option"
          }
          onClick={() => {
            setMode(id);
          }}
        >
          {label}
        </button>
      ))}
    </div>
  );
}

/**
 * The initial-load shimmer's phases: "loading" while the FIRST node streams
 * toward its base tier, "fading" while the hairline fades out, "done" once
 * unmounted. Hops never re-arm it — the shimmer belongs to the opening
 * moment only.
 */
export type TwinShimmerPhase = "loading" | "fading" | "done";

/** Milliseconds the fading shimmer stays mounted for its CSS fade. */
export const SHIMMER_FADE_MS = 450;

/**
 * Pure transition for the shimmer: a base-tier arrival on the initial node
 * ends it, as does ANY tier report from a different node (the visitor walked
 * on — the opening moment is over). Preview tiers on the initial node keep
 * it shimmering. Exported for unit tests.
 */
export function shimmerPhaseAfterTier(
  phase: TwinShimmerPhase,
  reportedNodeId: string,
  initialNodeId: string,
  tier: "preview" | "base",
): TwinShimmerPhase {
  if (phase !== "loading") {
    return phase;
  }
  if (reportedNodeId !== initialNodeId) {
    return "fading";
  }
  return tier === "base" ? "fading" : phase;
}

export interface TwinViewerProps {
  readonly manifest: TwinManifest;
  /** Bundle base URL including the venue segment, e.g. `/twin/trades-hall`. */
  readonly assetBase: string;
}

export function TwinViewer({ manifest, assetBase }: TwinViewerProps): ReactElement | null {
  const walk = useTwinGlide(manifest);
  const hasMesh = manifest.mesh !== undefined;
  const { mode, setMode } = useTwinMode(hasMesh);
  // The element the fullscreen button takes fullscreen — the viewer root, so
  // the canvas AND the HUD stay inside the fullscreen surface.
  const viewerRef = useRef<HTMLDivElement>(null);
  // Dollhouse warm gating (finding [33]): only desktops with memory headroom
  // pay the ~7 MB glb speculatively; everyone else waits for intent so a
  // walk-only mobile visitor never downloads it.
  const [warmMesh, setWarmMesh] = useState(false);
  const desktopCanWarm = useMemo(() => {
    if (typeof window === "undefined" || typeof window.matchMedia !== "function") {
      return false;
    }
    const mem = (navigator as { deviceMemory?: number }).deviceMemory;
    return (mem === undefined || mem >= 4) && window.matchMedia("(pointer: fine)").matches;
  }, []);

  // The opening: the canvas holds black until the first pano texture is on
  // stage, then fades in (CSS, ~500 ms; reduced motion cuts straight in).
  // The shimmer under the node label runs for the initial node's stream only.
  const [stageLive, setStageLive] = useState(false);
  const [shimmerPhase, setShimmerPhase] = useState<TwinShimmerPhase>("loading");
  const initialNodeIdRef = useRef(walk.currentId);

  // — the exact-view deep link (?look=): decoded ONCE from the pristine URL.
  // Applied only when it names the node the walk actually opened on (the share
  // button writes ?node= and &look= consistently; a tampered mismatch or a
  // malformed value is simply ignored — never a broken load).
  const [searchParams] = useSearchParams();
  const initialLookRef = useRef(
    (() => {
      const look = decodeTwinLook(searchParams.get("look"));
      if (look !== null && look.nodeId === walk.currentId) {
        return look;
      }
      // No shared view: open on the AUTHORED hero frame. The first frame is
      // the product — it faces the room's best view (the dome), never
      // whatever direction the scanner happened to call north.
      if (manifest.entryLook !== undefined && walk.currentId === manifest.entryNodeId) {
        return { nodeId: walk.currentId, ...manifest.entryLook };
      }
      return null;
    })(),
  );

  // Live camera pose, mirrored by YawProbe each frame — read at share-click
  // time to mint the "stand where I'm standing" link.
  const liveLookRef = useRef<LiveLook>({ yawRad: 0, pitchRad: 0, fovDeg: 75 });

  // — First Light: the once-per-session establishing reveal. Decided from the
  // PRISTINE first render (before useTwinWalk canonicalises ?node= into the
  // URL): arrivals with intent (?node=/?look=/?mode=), reduced motion, and
  // repeat visits this session all skip straight to "done".
  const [firstLight, setFirstLight] = useState<"waiting" | "running" | "done">(() =>
    firstLightEligible({
      hasNodeParam: searchParams.get("node") !== null,
      hasLookParam: searchParams.get("look") !== null,
      hasModeParam: searchParams.get("mode") !== null,
      reducedMotion: prefersReducedMotion(),
      seenThisSession: firstLightSeen(),
    })
      ? "waiting"
      : "done",
  );
  const firstLightOverlayRef = useRef<HTMLDivElement | null>(null);

  // The Usher rides the glide directly now (walk.glideAlong) — the old
  // queue-of-hops state and its consumer effect are gone with the cadence
  // they existed to paper over.

  const onPanoTier = useCallback((nodeId: string, tier: "preview" | "base") => {
    setStageLive(true);
    setShimmerPhase((phase) =>
      shimmerPhaseAfterTier(phase, nodeId, initialNodeIdRef.current, tier),
    );
    // First Light arms only once the HERO's base tier is on stage — the
    // overture never cranes over a soft preview.
    if (tier === "base" && nodeId === initialNodeIdRef.current) {
      setFirstLight((status) => {
        if (status !== "waiting") {
          return status;
        }
        markFirstLightSeen();
        return "running";
      });
    }
  }, []);

  // Any interaction dismisses the overture instantly — the visitor's intent
  // always wins. WalkControls re-adopts the camera wherever the crane was
  // (its enable effect reads the live pose), so there is never a snap.
  useEffect(() => {
    if (firstLight === "done") {
      return;
    }
    const cancel = (): void => {
      markFirstLightSeen();
      setFirstLight("done");
    };
    window.addEventListener("pointerdown", cancel);
    window.addEventListener("keydown", cancel);
    window.addEventListener("wheel", cancel);
    return () => {
      window.removeEventListener("pointerdown", cancel);
      window.removeEventListener("keydown", cancel);
      window.removeEventListener("wheel", cancel);
    };
  }, [firstLight]);

  // Never hold a slow connection hostage to choreography: if the hero base
  // hasn't landed in time, skip the overture and just be a viewer.
  useEffect(() => {
    if (firstLight !== "waiting") {
      return;
    }
    const timer = window.setTimeout(() => {
      markFirstLightSeen();
      setFirstLight("done");
    }, FIRST_LIGHT_FAILSAFE_MS);
    return () => {
      window.clearTimeout(timer);
    };
  }, [firstLight]);

  // Mesh modes paint their own stage — never hold the canvas dark for them
  // (?mode=dollhouse deep links mount without any pano tier report).
  useEffect(() => {
    if (mode !== "walk") {
      setStageLive(true);
      // No pano tier ever reports in a mesh mode, so the opening shimmer would
      // spin forever (finding [21]); retire it the same way walking off the
      // initial node does — advance loading → fading and let it play out.
      setShimmerPhase((phase) => (phase === "loading" ? "fading" : phase));
      // Leaving the walk lands any ride on its release-rule node NOW — the
      // mesh modes must not inherit a walker still advancing off stage.
      walk.settleInstantly();
    }
    // The dep is the stable callback, not the walk object: this effect means
    // "on mode transitions", and the walk's identity changes per segment
    // commit (review finding).
  }, [mode, walk.settleInstantly]);

  // Walking off the initial node ends the opening even without a base tier
  // (teleports and reduced-motion swaps land with no travelling report).
  useEffect(() => {
    if (walk.currentId !== initialNodeIdRef.current) {
      setShimmerPhase((phase) => (phase === "loading" ? "fading" : phase));
    }
  }, [walk.currentId]);

  // The fading shimmer unmounts once its CSS fade has played out.
  useEffect(() => {
    if (shimmerPhase !== "fading") {
      return;
    }
    const timer = window.setTimeout(() => {
      setShimmerPhase("done");
    }, SHIMMER_FADE_MS);
    return () => {
      window.clearTimeout(timer);
    };
  }, [shimmerPhase]);

  // Hop smoothness: neighbours' full panos are cache-warmed while the
  // visitor lingers, so travel sharpens from disk, not the network.
  useTwinPrefetch(manifest.imagery === "equirect" ? walk.neighbors : [], assetBase);

  // The dive (Phase 2, Task 6): down = dollhouse → node (arrive lands the
  // walk there); up = surfacing (mode already dollhouse; flight ends on the
  // orbit boot vantage so the rig re-boot is a visual no-op).
  const dive = useDive({
    onArrive: (nodeId, direction: DiveDirection) => {
      if (direction === "down") {
        walk.hopTo(nodeId, { teleport: true });
        setMode("walk");
      }
    },
  });
  const orbitPosRef = useRef<[number, number, number]>([0, 0, 0]);
  const flightRef = useRef<DiveFlight>({
    from: [0, 0, 0],
    to: [0, 0, 0],
    progress: 0,
    fovFrom: 50,
    fovTo: 75,
    look: [0, 0, 0],
  });

  const meshUrl = manifest.mesh === undefined ? null : `${assetBase}/${manifest.mesh.path}`;
  const extent = useMemo(() => nodeExtent(manifest.nodes), [manifest]);
  const dollhouseCutawayInsetM = dollhouseCutawayInsetForVenue(manifest.venueSlug);

  // — the plan (the CAD drawing): storeys, the active one, and its frame.
  // The choice is per-visit: entering plan opens on the storey underfoot, and
  // leaving forgets the override so the next entry is grounded again.
  const storeys = useMemo(() => storeysFromNodes(manifest.nodes), [manifest]);
  const [planFloorChoice, setPlanFloorChoice] = useState<number | null>(null);
  const [planScale, setPlanScale] = useState(0);
  useEffect(() => {
    if (mode !== "plan") {
      setPlanFloorChoice(null);
    }
  }, [mode]);

  // Warm the dollhouse so a Surface dive never flies through an unloaded void.
  // Intent (a hover/focus on the mesh affordances) warms immediately; a capable
  // desktop also warms speculatively after a beat so its dive is always instant
  // — but a mobile / low-memory walk-only visitor never pays the 7 MB unless
  // they reach for the mesh (finding [33]). The walk's own first paint still
  // never competes with the fetch (the 2.5 s delay).
  useEffect(() => {
    if (meshUrl === null || !(desktopCanWarm || warmMesh)) {
      return;
    }
    const timer = window.setTimeout(
      () => {
        preloadDollhouse(meshUrl);
      },
      warmMesh ? 0 : 2500,
    );
    return () => {
      window.clearTimeout(timer);
    };
  }, [meshUrl, desktopCanWarm, warmMesh]);

  const nodesById = useMemo(
    () => new Map<string, TwinScanNode>(manifest.nodes.map((node) => [node.id, node])),
    [manifest],
  );

  const currentNode = nodesById.get(walk.currentId);
  const targetNode = walk.targetId === null ? undefined : nodesById.get(walk.targetId);
  // The plan opens on the storey underfoot unless the visitor chose another.
  const currentFloorForPlan = nodesById.get(walk.restId)?.floor;
  const activePlanStorey =
    storeys.find((storey) => storey.floor === (planFloorChoice ?? currentFloorForPlan)) ??
    storeys[0];
  const activePlanFrame = useMemo(
    () => planFrame(manifest.nodes, activePlanStorey?.floor),
    [manifest, activePlanStorey?.floor],
  );
  const planLabels = useMemo(
    () =>
      activePlanStorey === undefined
        ? []
        : planRoomLabels(manifest.nodes, activePlanStorey),
    [manifest, activePlanStorey],
  );
  const [planLabelScreens, setPlanLabelScreens] = useState<readonly PlanLabelScreen[]>(
    [],
  );
  const dollhouseCutawayMinimumY =
    dollhouseCutawayInsetM === undefined || currentNode === undefined
      ? undefined
      : lowerFloorSectionMinimumY(manifest.nodes, currentNode.floor);
  const hopping = targetNode !== undefined;
  // Parallax hops (the moonshot): mount the projective mesh stage only on a
  // fine-pointer device, and only once the stage is live AND the browser has
  // idled — the ~7 MB dollhouse glb must never compete with the panos for
  // first paint (finding [33] still holds: no speculative download before the
  // visitor is actually walking).
  const [parallaxReady, setParallaxReady] = useState(false);
  useEffect(() => {
    if (!stageLive || parallaxReady) {
      return;
    }
    if (
      typeof window === "undefined" ||
      typeof window.matchMedia !== "function" ||
      !window.matchMedia("(pointer: fine)").matches
    ) {
      return;
    }
    if (typeof requestIdleCallback === "function") {
      const handle = requestIdleCallback(() => {
        setParallaxReady(true);
      });
      return () => {
        if (typeof cancelIdleCallback === "function") {
          cancelIdleCallback(handle);
        }
      };
    }
    const timer = window.setTimeout(() => {
      setParallaxReady(true);
    }, 1500);
    return () => {
      window.clearTimeout(timer);
    };
  }, [stageLive, parallaxReady]);
  // "In motion" holds true through the sub-frame gaps BETWEEN chained hops, so
  // the arriving pano keeps deferring its heavy base upload for the whole walk —
  // not just one hop — and fires it only once you actually stop (~250 ms after
  // the last hop). Without this, a continuous hold-to-walk sneaks a ~50 ms base
  // upload into each hop the instant `hopping` flickers false, re-introducing
  // the stutter (finding [32]).
  const [inMotion, setInMotion] = useState(false);
  useEffect(() => {
    if (hopping) {
      setInMotion(true);
      return;
    }
    const timer = window.setTimeout(() => {
      setInMotion(false);
    }, 250);
    return () => {
      window.clearTimeout(timer);
    };
  }, [hopping]);

  const diveNode = dive.target === null ? undefined : nodesById.get(dive.target);

  // Refresh the flight ref after every commit; DiveCamera reads it per frame.
  useEffect(() => {
    if (diveNode === undefined) {
      return;
    }
    const nodePos = e57PointToThree(diveNode.pose.t);
    const flight = flightRef.current;
    flight.progress = dive.progress;
    flight.from = dive.from;
    if (dive.direction === "down") {
      flight.to = nodePos;
      flight.fovFrom = 50;
      flight.fovTo = 75;
      // Gaze: through the destination, extended along the flight's horizontal
      // direction so arrival looks INTO the room, not at a point underfoot.
      flight.look = [
        nodePos[0] + (nodePos[0] - dive.from[0]) * 0.35,
        nodePos[1],
        nodePos[2] + (nodePos[2] - dive.from[2]) * 0.35,
      ];
    } else {
      flight.to = orbitVantage(extent);
      flight.fovFrom = 75;
      flight.fovTo = 50;
      flight.look = extent.center;
    }
  });

  // The dolly ref is refreshed after every commit; CameraDolly's useFrame
  // reads it on the next painted frame.
  const dollyRef = useRef<DollyState>({
    from: [0, 0, 0],
    to: [0, 0, 0],
    progress: 0,
    travelYaw: null,
    glide: false,
  });
  useEffect(() => {
    if (currentNode === undefined) {
      return;
    }
    const from = e57PointToThree(currentNode.pose.t);
    dollyRef.current.from = from;
    if (targetNode === undefined) {
      dollyRef.current.to = from;
      dollyRef.current.progress = 0;
      dollyRef.current.travelYaw = null;
      dollyRef.current.glide = false;
    } else {
      const to = e57PointToThree(targetNode.pose.t);
      dollyRef.current.to = to;
      dollyRef.current.progress = walk.progress;
      dollyRef.current.glide = true;
      // Heading target: the walker's live route tangent (already the active
      // segment's direction, which the yaw spring rounds through corners).
      // A stair's vertical segment reports no horizontal tangent — hold the
      // previous heading rather than aim at noise.
      const tangent = walk.tangentRef.current;
      if (tangent !== null && (tangent[0] !== 0 || tangent[1] !== 0)) {
        // three YXZ yaw facing the horizontal travel direction (-Z forward).
        dollyRef.current.travelYaw = Math.atan2(-tangent[0], -tangent[1]);
      }
    }
  });

  // The share link carries the exact view (SS++ "the irresistible link"):
  // ?node= keeps the walk's source of truth, &look= adds the camera, so the
  // recipient lands standing where the sender stood, gazing at the same dome.
  // Mesh modes share the plain location (a look param is a walk concept).
  const shareUrl = useCallback((): string => {
    const url = new URL(window.location.href);
    if (mode === "walk") {
      // restId: a share minted mid-glide names the last STILL frame — the
      // camera pose being copied belongs to a standing view, not to a node
      // the ride happens to be sweeping past.
      const live = liveLookRef.current;
      url.searchParams.set("node", walk.restId);
      url.searchParams.set(
        "look",
        encodeTwinLook({
          nodeId: walk.restId,
          yawDeg: (live.yawRad * 180) / Math.PI,
          pitchDeg: (live.pitchRad * 180) / Math.PI,
          fovDeg: live.fovDeg,
        }),
      );
    }
    return url.toString();
  }, [mode, walk.restId]);

  // The Usher, as one function rather than two copies. The minimap and the
  // quick-action rail must behave identically — a room reached by naming it
  // should glide exactly as a room reached by pointing at it — and the fallback
  // ladder below is subtle enough that two hand-maintained versions would drift.
  const usherTo = useCallback(
    (id: string): void => {
      // Reduced motion keeps the instant teleport: a chain of instant swaps
      // would strobe, which is the very thing the preference asks us not to do.
      if (prefersReducedMotion()) {
        walk.hopTo(id, { teleport: true });
        return;
      }
      // A second pick mid-ride short-circuits to that target rather than
      // queueing behind the journey the visitor has just changed their mind
      // about.
      if (walk.gliding) {
        walk.hopTo(id, { teleport: true });
        return;
      }
      const route = shortestRoute(walk.currentId, id, manifest.edges);
      // Unreachable or marathon routes teleport instead of trapping the visitor
      // in a two-minute walk they cannot cancel.
      if (route === null || route.length === 0 || route.length > MAX_USHER_HOPS) {
        walk.hopTo(id, { teleport: true });
        return;
      }
      // One continuous ride over the whole corridor route — the Usher finally
      // glides the way its name always promised.
      walk.glideAlong(route);
    },
    [manifest.edges, walk],
  );

  // — the measure tool.
  //
  // The rooms the rail used to offer as "Walk to <room>" chips now live in the
  // Rooms panel, which states each room's published figures beside its name and
  // groups them by storey. Passing them BOTH would give a screen-reader user two
  // identically named controls going to the same place, and it is also what
  // makes the left column overflow: the slot model in RoomSelector.test.tsx
  // proves the four-chip rail rises through its own neighbours. So the rail
  // keeps only the capability the panel does not have — the plan view.
  const [measuring, setMeasuring] = useState(false);
  const [measurePicks, setMeasurePicks] = useState<readonly MeasureVec3[]>([]);
  const [measureScreens, setMeasureScreens] = useState<
    readonly (MeasureScreenPoint | null)[]
  >([]);
  const measurePickAtCentreRef = useRef<(() => void) | null>(null);
  // Armed only where a click can land on real geometry. See the picker's header.
  const measureArmed = measuring && hasMesh && mode !== "walk";

  const onMeasurePick = useCallback((world: MeasureVec3): void => {
    // A third pick starts a fresh measurement rather than being ignored. A tool
    // that goes inert after two points makes the visitor hunt for Clear before
    // they can measure the next thing, which is the whole interaction.
    setMeasurePicks((was) => (was.length >= 2 ? [world] : [...was, world]));
  }, []);

  const clearMeasure = useCallback((): void => {
    setMeasurePicks([]);
    setMeasureScreens([]);
  }, []);

  const dismissMeasure = useCallback((): void => {
    setMeasuring(false);
    setMeasurePicks([]);
    setMeasureScreens([]);
  }, []);

  // Leaving the mesh modes puts the tool away. Left armed, its Escape listener
  // would outlive the geometry it measures and swallow Escape for the enquiry
  // modal and the fullscreen control while doing nothing visible.
  useEffect(() => {
    if (mode === "walk") {
      setMeasuring(false);
      setMeasurePicks([]);
      setMeasureScreens([]);
    }
  }, [mode]);

  const measurePoints = useMemo<readonly MeasurePoint[]>(
    () =>
      measurePicks.map((world, index) => ({
        world,
        screen: measureScreens[index] ?? null,
      })),
    [measurePicks, measureScreens],
  );

  const onPickAtCentre = useCallback((): void => {
    measurePickAtCentreRef.current?.();
  }, []);

  if (currentNode === undefined) {
    // Unreachable in practice: the walk only yields ids from this manifest.
    return null;
  }

  // Crossfade with NO black flash: the departing pano stays fully opaque
  // UNDERNEATH (renderOrder 0) while the arriving pano fades in ON TOP
  // (renderOrder 1). Once both textures are loaded this is identical to a
  // cross-dissolve (opaque base + alpha-`progress` overlay = progress blend);
  // but if the arriving node's texture is still streaming over the network the
  // opaque departing pano keeps filling the view, so a hop can never flash black
  // between nodes the way a symmetric 1−progress / progress fade did.
  const stages: {
    node: TwinScanNode;
    opacity: number;
    renderOrder: number;
    /** The arriving stage rides the walker's live fraction; the departing
     *  stage stays a constant 1 underneath. */
    opacityRef?: { readonly current: number };
  }[] = [{ node: currentNode, opacity: 1, renderOrder: 0 }];
  if (targetNode !== undefined) {
    stages.push({
      node: targetNode,
      opacity: walk.progress,
      renderOrder: 1,
      opacityRef: walk.progressRef,
    });
  }

  return (
    <div
      ref={viewerRef}
      className={stageLive ? "vv-twin-viewer vv-twin-viewer--live" : "vv-twin-viewer"}
      // Named, described interactive region so a screen-reader user meets a
      // real walkthrough — not an anonymous <canvas> (finding [12]). WASD /
      // arrow travel already works by keyboard, which the application role
      // signals; keyboard look/zoom is the remaining gap (finding [9]).
      role="application"
      aria-label={twinViewerLabel(manifest.name)}
      aria-roledescription={TWIN_VIEWER_ROLE}
    >
      {/* Polite arrival announcement — where the walk just STOPPED (finding
          [10]). restId, deliberately: a glide sweeps nodes at walking pace and
          announcing each would read the room out loud like a train timetable. */}
      <p className="vv-sr-only" aria-live="polite" data-testid="twin-live-region">
        {twinViewpointAnnouncement(walk.restId, manifest.nodes.length)}
      </p>
      <Canvas
        frameloop="demand"
        dpr={[1, 2]}
        gl={{ powerPreference: "high-performance" }}
        camera={{ fov: 75, near: 0.1, far: 200 }}
      >
        {mode === "walk" ? (
          <>
            {/* Order matters: the look seed must land before WalkControls
                adopts the camera as its spring rest. */}
            <InitialLookRig look={initialLookRef.current} />
            <WalkControls enabled={!hopping && firstLight !== "running"} />
            <CameraDolly dolly={dollyRef} progressRef={walk.progressRef} />
            <FirstLightRig
              active={firstLight === "running"}
              overlayRef={firstLightOverlayRef}
              onDone={() => {
                setFirstLight("done");
              }}
            />
            <TravelControls
              enabled
              hopping={hopping}
              currentNode={currentNode}
              neighbors={walk.neighbors}
              neighborsOf={walk.neighborsOf}
              nodesById={nodesById}
              onTravel={walk.hopTo}
              onHoldChange={walk.setHeld}
              registerNextPicker={walk.registerNextPicker}
            />
            {stages.map(({ node, opacity, renderOrder, opacityRef }) => (
              <PanoStage
                key={node.id}
                nodeId={node.id}
                position={e57PointToThree(node.pose.t)}
                quaternion={e57QuatToThree(node.pose.q)}
                assetBase={assetBase}
                opacity={opacity}
                {...(opacityRef === undefined ? {} : { opacityRef })}
                renderOrder={renderOrder}
                hopping={inMotion}
                exposure={node.exposure}
                imagery={manifest.imagery}
                onTier={onPanoTier}
              />
            ))}
            {/* The moonshot: during hops the panos are projected onto the real
                building geometry, so movement carries TRUE parallax instead of
                a sliding crossfade. Invisible at rest (the spheres remain the
                optically-perfect photograph); pixel-identical at both hop
                endpoints by construction, so there is no seam to hide. */}
            {parallaxReady && (
              <NeighborWarmer
                neighbors={walk.neighbors}
                currentNode={currentNode}
                nodesById={nodesById}
                assetBase={assetBase}
              />
            )}
            {parallaxReady && meshUrl !== null && (
              <Suspense fallback={null}>
                <ParallaxStage
                  meshUrl={meshUrl}
                  assetBase={assetBase}
                  currentNode={currentNode}
                  targetNode={targetNode}
                  progress={walk.progress}
                  progressRef={walk.progressRef}
                />
              </Suspense>
            )}
            {/* The building's own navigation graph, drawn on the floor it
                describes. Mounted BEFORE the nav rings so the rings paint over
                it: the constellation is the map, the rings are the affordance,
                and the map must never be the brighter of the two. Hidden during
                a hop, like the rings — a graph sliding under a moving camera
                reads as an artefact rather than as ground. */}
            {!hopping && (
              <FloorConstellation
                nodes={manifest.nodes}
                edges={manifest.edges}
                currentId={walk.currentId}
              />
            )}
            {!hopping && (
              <NavMarkers
                neighbors={walk.neighbors}
                nodesById={nodesById}
                onHop={walk.hopTo}
              />
            )}
            <YawProbe lookRef={liveLookRef} />
          </>
        ) : (
          meshUrl !== null && (
            <>
              <Suspense fallback={null}>
                <DollhouseStage
                  meshUrl={meshUrl}
                  nodes={manifest.nodes}
                  currentId={walk.currentId}
                  cutaway={
                    dollhouseCutawayInsetM === undefined
                      ? undefined
                      : {
                          enabled: mode === "dollhouse" && !dive.diving,
                          target: extent.center,
                          insetM: dollhouseCutawayInsetM,
                          ...(dollhouseCutawayMinimumY === undefined
                            ? {}
                            : { minimumY: dollhouseCutawayMinimumY }),
                        }
                  }
                  {...(mode === "plan" && activePlanStorey !== undefined
                    ? {
                        planSection: { cutY: planCutY(activePlanStorey) },
                        dotFloor: activePlanStorey.floor,
                      }
                    : {})}
                  onDive={(id) => {
                    // A dot press while measuring would fly the visitor into
                    // the walk mid-measurement, taking the geometry the picks
                    // were made against off stage with it.
                    if (measureArmed) {
                      return;
                    }
                    if (mode === "plan") {
                      // From a DRAWING you go to a place, you don't fly to
                      // it: the dive's swoop is choreographed for the
                      // perspective orbit, and rendering it orthographic
                      // reads as the building scaling, not the camera
                      // moving. A plan click steps straight into the walk.
                      walk.hopTo(id, { teleport: true });
                      setMode("walk");
                      return;
                    }
                    dive.dive(id, {
                      position: [...orbitPosRef.current],
                      direction: "down",
                    });
                  }}
                />
              </Suspense>
              {mode === "plan" && activePlanStorey !== undefined ? (
                <>
                  <PlanRig
                    frame={activePlanFrame}
                    storeyKey={activePlanStorey.floor}
                    onScale={setPlanScale}
                  />
                  <PlanLabelProjector
                    labels={planLabels}
                    onProject={setPlanLabelScreens}
                  />
                </>
              ) : (
                <MeshOrbitRig extent={extent} enabled={!dive.diving} />
              )}
              <CameraProbe position={orbitPosRef} />
              {measureArmed && (
                <MeasurePicker
                  points={measurePicks}
                  onPick={onMeasurePick}
                  onProject={setMeasureScreens}
                  pickAtCentreRef={measurePickAtCentreRef}
                />
              )}
              {/* Never in plan: the flight writes walking-height poses and
                  lookAt rotations onto the scene's default camera, and in
                  plan that is the orthographic drawing camera (review
                  finding — belt to the mode-switch guard's braces). */}
              {dive.diving && mode !== "plan" && <DiveCamera flight={flightRef} />}
              {/* The dive's crossfade: descending, the target pano closes in
                  late (the camera flies through the real mesh interior);
                  surfacing, the departed pano releases early. */}
              {diveNode !== undefined && dive.direction === "down" && dive.progress > 0.45 && (
                <PanoStage
                  nodeId={diveNode.id}
                  position={e57PointToThree(diveNode.pose.t)}
                  quaternion={e57QuatToThree(diveNode.pose.q)}
                  assetBase={assetBase}
                  opacity={(dive.progress - 0.45) / 0.55}
                  exposure={diveNode.exposure}
                  imagery={manifest.imagery}
                />
              )}
              {diveNode !== undefined && dive.direction === "up" && dive.progress < 0.55 && (
                <PanoStage
                  nodeId={diveNode.id}
                  position={e57PointToThree(diveNode.pose.t)}
                  quaternion={e57QuatToThree(diveNode.pose.q)}
                  assetBase={assetBase}
                  opacity={1 - dive.progress / 0.55}
                  exposure={diveNode.exposure}
                  imagery={manifest.imagery}
                />
              )}
            </>
          )
        )}
      </Canvas>

      {/* Settle vignette — deepens a few percent in motion, relaxes on arrival.
          Kept static at rest under reduced motion (never breathes). */}
      <div
        aria-hidden
        className={
          inMotion && !prefersReducedMotion()
            ? "vv-twin-vignette vv-twin-vignette--motion"
            : "vv-twin-vignette"
        }
      />

      {/* First Light's iris — a cool wash the rig opens to nothing as the
          camera cranes onto the hero frame. Mounted only while the overture
          is pending or playing; the rig writes its opacity by ref. */}
      {firstLight !== "done" && (
        <div
          ref={firstLightOverlayRef}
          aria-hidden
          data-testid="twin-first-light"
          className="vv-twin-first-light"
        />
      )}

      <div className="vv-twin-node-label" data-testid="twin-node-label">
        {/* Keyed span: node changes remount the text through a 200 ms fade.
            restId, like every other surface that names a place: a glide
            crosses a node each ~1.7 s, and a label remount-fading per
            crossing is a flip-book, not a readout (review finding). */}
        <span key={walk.restId} className="vv-twin-node-label-text">
          {twinNodeLabel(walk.restId, manifest.name)}
        </span>
        {shimmerPhase !== "done" && (
          <span
            aria-hidden
            data-testid="twin-load-shimmer"
            className={
              shimmerPhase === "fading"
                ? "vv-twin-load-shimmer vv-twin-load-shimmer--out"
                : "vv-twin-load-shimmer"
            }
          />
        )}
      </div>
      {hasMesh && (
        <TwinModeControl
          mode={mode}
          // A dive is not interruptible (useDive's own rule), so neither is
          // the mode: switching to plan mid-flight would hand the plan's
          // orthographic camera to DiveCamera's walking-height bezier — two
          // uncoordinated writers on one camera (review finding). The flight
          // lasts ~1.2 s; the click simply waits its turn.
          setMode={(next) => {
            if (!dive.diving) {
              setMode(next);
            }
          }}
          // Reaching for the view-mode switch is intent to see the mesh — warm
          // the dollhouse now so the switch/dive is instant (finding [33]).
          onWarmMesh={() => {
            setWarmMesh(true);
          }}
        />
      )}
      {hasMesh && mode === "walk" && !hopping && (
        <button
          type="button"
          className="vv-twin-surface"
          onPointerEnter={() => {
            setWarmMesh(true);
          }}
          onFocus={() => {
            setWarmMesh(true);
          }}
          onClick={() => {
            // Surfacing: same flight, reversed — the mode flips first so the
            // mesh is on stage, then the spring carries the camera up to the
            // orbit vantage while the pano releases.
            const position = e57PointToThree(currentNode.pose.t);
            setMode("dollhouse");
            dive.dive(walk.currentId, { position, direction: "up" });
          }}
        >
          {TWIN_SURFACE_LABEL} <span aria-hidden>↑</span>
        </button>
      )}
      <TwinViewerControls
        venueName={manifest.name}
        viewerRef={viewerRef}
        shareUrl={shareUrl}
      />
      {/* The first place the twin is allowed to name a room. It renders only at
          the handful of viewpoints whose room a human validated against
          ground-truth photography (shell/twin-rooms.ts) and is silent
          everywhere else — the manifest's roomSlug is null on every node, and a
          guest told they are in the Grand Hall while looking at the Saloon has
          been lied to about the most basic claim the product makes. */}
      {mode === "walk" && (
        <RoomDossier currentId={walk.restId} venueName={manifest.name} />
      )}

      {/* Offered next moves — now ONE, and the subtraction is deliberate. The
          rail used to carry a "Walk to <room>" chip per validated room; those
          moved into the Rooms panel, where each one arrives with the room's
          published figures beside it and grouped onto its storey. Leaving them
          here as well would put two identically named controls on screen going
          to the same place, and would keep the left column overflowing at
          landscape-phone heights. The plan view is the one capability the panel
          does not have, so it is the one chip that stays. */}
      {mode === "walk" && (
        <QuickActions
          onSeeThePlan={
            hasMesh
              ? () => {
                  setWarmMesh(true);
                  setMode("plan");
                }
              : undefined
          }
          onWalkTo={usherTo}
        />
      )}

      <p className="vv-twin-disclosure vv-twin-viewer-disclosure">{TWIN_DISCLOSURE}</p>
      {/* The coach waits in the wings until the overture has played. */}
      {mode === "walk" && firstLight === "done" && <TwinCoachHint />}

      {/* — the bottom-right slot: exactly one occupant, chosen by mode —
          Rooms while walking, the tape once there is geometry to lay it on.
          The two never coexist because the mode machine admits one mode, which
          is a stronger disjointness guarantee than any arithmetic. */}
      {mode === "walk" && (
        <RoomSelector
          nodes={manifest.nodes}
          currentId={walk.restId}
          // The Usher, not a teleport: a room reached by naming it glides the
          // real corridor route, exactly like a room reached by pointing at it.
          onWalkTo={usherTo}
        />
      )}
      {mode === "plan" && activePlanStorey !== undefined && (
        <>
          {/* The annotation layer sits under the HUD chrome in the stacking
              order and over the canvas: names belong to the drawing, the
              pills belong to the tool. */}
          <PlanAnnotations screens={planLabelScreens} />
          <PlanHud
            storeys={storeys}
            activeFloor={activePlanStorey.floor}
            onSelectFloor={setPlanFloorChoice}
            pxPerMetre={planScale}
          />
        </>
      )}
      {hasMesh && mode !== "walk" && !measuring && (
        <button
          type="button"
          className="vv-twin-measure-trigger"
          onClick={() => {
            setMeasuring(true);
          }}
          data-testid="twin-measure-trigger"
        >
          {ICON_MEASURE}
          <span className="vv-twin-measure-trigger-label">{MEASURE_GROUP_LABEL}</span>
        </button>
      )}
      {measureArmed && (
        <MeasureLayer
          points={measurePoints}
          onDismiss={dismissMeasure}
          onClear={clearMeasure}
          onPickAtCentre={onPickAtCentre}
        />
      )}
    </div>
  );
}
