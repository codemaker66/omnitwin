// ---------------------------------------------------------------------------
// HallStage — holds the Grand Hall as one picture (hall-stage.ts)
//
// Mounted after the camera rig, for a planner screen that asked for the stage
// (hall-view-store `stage`), and fetched only then (components/planner-hud/
// hud-scene.ts). It owns three things the rig does not: the lens
// (its field of view and its fall across the camera, lib/lens-shift.ts), the
// camera squaring itself up as it comes to rest on the stage, and letting go
// the instant a hand takes the room.
//
//   - A glide carries the lens with it: from the lens it left to the one its
//     view is seen through, at the glide's own pace.
//   - Landed on the stage, the camera levels over a third of a second while
//     the lens falls to keep the picture where it is: only the uprights move.
//   - A wheel, a drag or a pan lets go. The camera is tilted back at the
//     middle of the floor through the lens that shows the same picture, in
//     that one frame, so the hand finds an ordinary orbit and nothing jumps.
//     A click of the right button is not a drag: it puts the card in hand
//     down (lib/right-click-put-down.ts), and the picture does not stir.
//
// The orbit's own limits are left alone but one: level is past its lowest
// angle, so that limit is opened while the stage is held and closed again as
// it is let go.
// ---------------------------------------------------------------------------

import { useEffect, useRef } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import { PerspectiveCamera, type Vector3 } from "three";
import { MAX_POLAR_ANGLE } from "../../lib/camera-rig.js";
import { clearLensShift, lensShift, setLensShift } from "../../lib/lens-shift.js";
import { prefersReducedMotion } from "../../lib/reduced-motion.js";
import { DRAG_THRESHOLD_PX, screenDistance } from "../../lib/selection.js";
import { isSpringSettled, SPRING_PRESETS, stepSpring, type SpringState } from "../../lib/springs.js";
import { useBookmarkStore } from "../../stores/bookmark-store.js";
import { useCockpitStore } from "../../stores/cockpit-store.js";
import { useHallViewStore } from "../../stores/hall-view-store.js";
import { useTouchGestureStore } from "../../stores/touch-gesture-store.js";
import { hallStageFraming, mixLens, stageLens, stagePoseAt, type HallStageFraming, type StageLens } from "./hall-stage.js";
import { HALL_VIEW_POSES } from "./HallViewDirector.js";

type Vec3 = readonly [number, number, number];

/** The part of the orbit the stage sets: where it looks, how low it may go, and its own settling. */
interface Orbit {
  readonly target: Vector3;
  maxPolarAngle: number;
  enableDamping: boolean;
  readonly update: () => unknown;
}

function isOrbit(value: unknown): value is Orbit {
  return typeof value === "object" && value !== null && "target" in value && "maxPolarAngle" in value && "update" in value;
}

/** free: an ordinary orbit. arriving: gliding to the stage. squaring: levelling on it. held: the picture. walk: inside the room. */
type Mode = "free" | "arriving" | "squaring" | "held" | "walk";

/** A glide's lens: the one it left, the one it lands on, and where it lands. */
interface LensTrip {
  readonly key: Vec3;
  readonly from: StageLens;
  readonly to: StageLens;
  readonly toPosition: Vec3;
}

/** The planner's lens wherever the stage is not: the canvas's own. */
const PLAIN_LENS: StageLens = { fov: 55, shiftY: 0 };
/** Level is a hair past a right angle for the orbit, so rounding never trips its limit. */
const LEVEL_POLAR = Math.PI / 2 + 1e-4;
/** Metres within which the camera is where it was put. */
const IN_PLACE_M = 1e-3;
/** The longest step the squaring takes in one frame, seconds. */
const MAX_STEP_S = 1 / 30;
/** MouseEvent.buttons for the buttons that turn or slide the camera: the right and the middle. */
const CAMERA_BUTTONS = 2 | 4;

function near(point: Vector3, at: Vec3): boolean {
  return Math.abs(point.x - at[0]) < IN_PLACE_M && Math.abs(point.y - at[1]) < IN_PLACE_M && Math.abs(point.z - at[2]) < IN_PLACE_M;
}

function lensOf(camera: PerspectiveCamera): StageLens {
  return { fov: camera.fov, shiftY: lensShift(camera).y };
}

function setLens(camera: PerspectiveCamera, lens: StageLens): void {
  camera.fov = lens.fov;
  if (lens.shiftY === 0) clearLensShift(camera);
  else setLensShift(camera, { x: 0, y: lens.shiftY });
}

/** Puts the camera (where given) and what it looks at, clear of the tail of an earlier drag's settling. */
function setPose(camera: PerspectiveCamera, orbit: Orbit, position: Vec3 | null, target: Vec3): void {
  const damping = orbit.enableDamping;
  orbit.enableDamping = false;
  orbit.update();
  if (position !== null) camera.position.set(position[0], position[1], position[2]);
  orbit.target.set(target[0], target[1], target[2]);
  orbit.update();
  orbit.enableDamping = damping;
}

function holding(mode: Mode): boolean {
  return mode === "held" || mode === "squaring";
}

/** What the stage remembers between frames. */
interface StageState {
  mode: Mode;
  framing: HallStageFraming | null;
  trip: LensTrip | null;
  squared: SpringState;
  /** The planner has opened on the stage once (a later canvas size is not an arrival). */
  opened: boolean;
  walkEnded: boolean;
  /** The camera and orbit the stage last set, so leaving restores exactly those. */
  rig: { readonly camera: PerspectiveCamera; readonly orbit: Orbit } | null;
}

/** The camera stands on the stage, level, at once. */
function hold(state: StageState, camera: PerspectiveCamera, orbit: Orbit, stage: HallStageFraming): void {
  orbit.maxPolarAngle = LEVEL_POLAR;
  setPose(camera, orbit, stage.position, stage.heldTarget);
  setLens(camera, stageLens(stage, 0));
  state.mode = "held";
  state.trip = null;
  useHallViewStore.getState().setStagePhase("held");
}

/** From the stage to an ordinary orbit showing the same picture, in one step. */
function letGo(state: StageState, camera: PerspectiveCamera, orbit: Orbit): void {
  const stage = state.framing;
  if (holding(state.mode) && stage !== null) {
    // Squaring up, the camera is part-way level; held, it is level, and may have been panned (the arrow keys move it
    // and what it looks at together). Either way it is aimed at the floor again from where it stands, keeping any such
    // move: through the tilted lens, that is the picture it was showing. A camera something else has turned keeps its aim.
    const level = Math.abs(orbit.target.y - camera.position.y) < IN_PLACE_M;
    if (state.mode === "squaring" || level) {
      const dx = camera.position.x - stage.position[0];
      const dz = camera.position.z - stage.position[2];
      setPose(camera, orbit, null, [stage.freeTarget[0] + dx, stage.freeTarget[1], stage.freeTarget[2] + dz]);
    }
    setLens(camera, stageLens(stage, stage.freePitch));
  }
  state.mode = "free";
  orbit.maxPolarAngle = MAX_POLAR_ANGLE;
  useHallViewStore.getState().setStagePhase("off");
}

export function HallStage(): null {
  const camera = useThree((state) => state.camera);
  const controls = useThree((state) => state.controls);
  const canvas = useThree((state) => state.gl.domElement);
  const invalidate = useThree((state) => state.invalidate);
  const width = useThree((state) => state.size.width);
  const height = useThree((state) => state.size.height);
  const skyPx = useHallViewStore((state) => state.stage?.skyPx ?? null);

  const stageState = useRef<StageState>({
    mode: "free", framing: null, trip: null, squared: { value: 0, velocity: 0 }, opened: false, walkEnded: false, rig: null,
  });
  const own = stageState.current;

  useEffect(() => {
    if (!(camera instanceof PerspectiveCamera) || !isOrbit(controls)) return undefined;
    const orbit = controls;
    own.rig = { camera, orbit };

    /** A hand on the camera: the stage lets go, and no named view is the view any more. */
    const hand = (): void => {
      if (holding(own.mode)) { letGo(own, camera, orbit); invalidate(); }
      const hall = useHallViewStore.getState();
      if (hall.activePreset !== null && !useCockpitStore.getState().walkMode) hall.setActivePreset(null);
    };
    const onWheel = (event: WheelEvent): void => { if (event.target === canvas) hand(); };

    // A press of a button that turns or slides the camera is not yet a hand on it: a right click with no drag puts
    // the card in hand down, and the picture must not stir for that. It is a hand once it has travelled a drag's
    // distance. Until then the orbit is kept from following it, so the held picture does not turn by a hair; the
    // orbit saw the press begin, and catches up from there once the drag is let through.
    let press: { readonly pointerId: number; readonly x: number; readonly y: number } | null = null;
    const onPointerDown = (event: PointerEvent): void => {
      // A finger is the touch arbiter's to read, and the left button selects.
      press = event.target === canvas && event.pointerType !== "touch" && event.button !== 0
        ? { pointerId: event.pointerId, x: event.clientX, y: event.clientY }
        : null;
    };
    const onPointerMove = (event: PointerEvent): void => {
      if (press === null || event.pointerId !== press.pointerId) return;
      // The button came up where no release was heard (outside the window).
      if ((event.buttons & CAMERA_BUTTONS) === 0) { press = null; return; }
      if (screenDistance(press.x, press.y, event.clientX, event.clientY) <= DRAG_THRESHOLD_PX) {
        if (holding(own.mode)) event.stopPropagation();
        return;
      }
      press = null;
      hand();
    };
    const onPointerEnd = (event: PointerEvent): void => {
      if (press !== null && event.pointerId === press.pointerId) press = null;
    };
    window.addEventListener("wheel", onWheel, { capture: true, passive: true });
    window.addEventListener("pointerdown", onPointerDown, { capture: true });
    window.addEventListener("pointermove", onPointerMove, { capture: true });
    window.addEventListener("pointerup", onPointerEnd, { capture: true });
    window.addEventListener("pointercancel", onPointerEnd, { capture: true });
    const offTouch = useTouchGestureStore.subscribe((next, previous) => {
      if ((next.mode === "orbit" || next.mode === "two") && next.mode !== previous.mode) hand();
    });

    // The director leaves the stage for another view by saying so (stagePhase
    // "off"): the camera is let go before the glide reads where it starts.
    const offHall = useHallViewStore.subscribe((next, previous) => {
      if (next.stagePhase === "off" && previous.stagePhase !== "off" && holding(own.mode)) letGo(own, camera, orbit);
    });

    // A glide begins: it carries the lens to the one its view is seen through.
    const offGlide = useBookmarkStore.subscribe((next, previous) => {
      const glide = next.transition;
      if (glide === null || glide.fromPosition === previous.transition?.fromPosition) return;
      const stage = own.framing;
      const hall = useHallViewStore.getState();
      const from = lensOf(camera);
      let to = from;
      if (stage !== null && hall.stagePhase === "arriving") {
        to = stageLens(stage, stage.freePitch);
        own.mode = "arriving";
      } else {
        // A glide the stage was not asked about (a saved viewpoint) still ends its hold.
        if (holding(own.mode)) {
          if (stage !== null) to = stageLens(stage, stage.freePitch);
          orbit.maxPolarAngle = MAX_POLAR_ANGLE;
          hall.setStagePhase("off");
        }
        if (own.mode !== "walk") own.mode = "free";
        if (stage !== null && hall.activePreset === "plan") to = stage.plan.lens;
      }
      own.trip = { key: glide.fromPosition, from, to, toPosition: glide.toPosition };
    });

    // A walk is seen through the planner's plain lens; coming back, the next frame decides (below).
    const offWalk = useCockpitStore.subscribe((next, previous) => {
      if (next.walkMode === previous.walkMode) return;
      if (next.walkMode) {
        if (holding(own.mode)) letGo(own, camera, orbit);
        own.mode = "walk";
        own.trip = null;
        setLens(camera, PLAIN_LENS);
      } else {
        if (own.mode === "walk") own.mode = "free";
        own.walkEnded = true;
      }
      invalidate();
    });

    // The stage for this canvas, and where it puts the camera: the views' director sends Room and Plan there.
    const stage = skyPx === null ? null : hallStageFraming(width, height, skyPx);
    useHallViewStore.getState().setStagePoses(stage === null ? null : {
      room: { position: stage.position, target: stage.freeTarget },
      plan: { position: stage.plan.position, target: stage.plan.target },
    });
    const walking = useCockpitStore.getState().walkMode;
    const bookmarks = useBookmarkStore.getState();
    if (stage === null) {
      // No stage on this canvas (held upright, say): an ordinary orbit through the plain lens.
      if (own.mode !== "walk") letGo(own, camera, orbit);
      own.framing = null;
      // A glide still under way lands through the plain lens too.
      own.trip = null;
      if (!walking) setLens(camera, PLAIN_LENS);
    } else {
      const standing = holding(own.mode) || own.mode === "arriving";
      own.framing = stage;
      if (standing) {
        // A new canvas size is a new picture: the camera stands in it at once.
        if (bookmarks.transition !== null) useBookmarkStore.setState({ transition: null });
        hold(own, camera, orbit, stage);
      } else if (!own.opened && !walking && bookmarks.transition === null && bookmarks.tour === null
        && useHallViewStore.getState().activePreset === "room") {
        // Arriving in the Room view, the planner opens on the stage.
        hold(own, camera, orbit, stage);
      }
    }
    own.opened = true;
    invalidate();

    return () => {
      window.removeEventListener("wheel", onWheel, { capture: true });
      window.removeEventListener("pointerdown", onPointerDown, { capture: true });
      window.removeEventListener("pointermove", onPointerMove, { capture: true });
      window.removeEventListener("pointerup", onPointerEnd, { capture: true });
      window.removeEventListener("pointercancel", onPointerEnd, { capture: true });
      offTouch();
      offHall();
      offGlide();
      offWalk();
    };
  }, [own, camera, controls, canvas, invalidate, width, height, skyPx]);

  // Leaving the screen that asked for the stage: an ordinary orbit through the plain lens again, and the ordinary views.
  useEffect(() => () => {
    useHallViewStore.getState().setStagePoses(null);
    const last = own.rig;
    if (last === null) return;
    if (own.mode !== "walk") letGo(own, last.camera, last.orbit);
    setLens(last.camera, PLAIN_LENS);
    own.mode = "free";
  }, [own]);

  useFrame((_state, delta) => {
    if (!(camera instanceof PerspectiveCamera) || !isOrbit(controls)) return;
    const stage = own.framing;
    const glide = useBookmarkStore.getState().transition;

    // Under way: the lens goes as far as the camera has.
    const carried = own.trip;
    if (carried !== null) {
      if (glide !== null && glide.fromPosition === carried.key) {
        const whole = Math.hypot(carried.toPosition[0] - carried.key[0], carried.toPosition[1] - carried.key[1], carried.toPosition[2] - carried.key[2]);
        const gone = Math.hypot(camera.position.x - carried.key[0], camera.position.y - carried.key[1], camera.position.z - carried.key[2]);
        const timed = glide.duration > 0 ? glide.elapsed / glide.duration : 1;
        setLens(camera, mixLens(carried.from, carried.to, whole > IN_PLACE_M ? gone / whole : timed));
        return;
      }
      // Landed, it has its view's lens; stopped by a hand, it keeps the lens it had reached.
      own.trip = null;
      if (near(camera.position, carried.toPosition)) setLens(camera, carried.to);
    }
    if (glide !== null || stage === null) return;

    // The director calls the stage "arriving" before its glide begins, and leaves Room alone until the stage is "off"
    // again. With no glide under way and nothing held or arriving here, nobody is on the way: say so, or Room is dead.
    if (own.mode === "free" || own.mode === "walk") useHallViewStore.getState().setStagePhase("off");

    if (own.walkEnded) {
      own.walkEnded = false;
      // The rig has put the orbit back where the walk began: on the stage, or wherever a hand had left it.
      if (own.mode === "free") {
        if (near(camera.position, stage.position) && near(controls.target, stage.heldTarget)) {
          hold(own, camera, controls, stage);
          useHallViewStore.getState().setActivePreset("room");
        } else {
          setLens(camera, stageLens(stage, stage.freePitch));
        }
        invalidate();
      }
    }

    // The rig opens on its own Room view for each arrival in the room: the stage takes it.
    if ((own.mode === "free" || own.mode === "held")
      && near(camera.position, HALL_VIEW_POSES.room.position) && near(controls.target, HALL_VIEW_POSES.room.target)) {
      hold(own, camera, controls, stage);
      useHallViewStore.getState().setActivePreset("room");
      invalidate();
      return;
    }

    if (own.mode === "arriving") {
      if (!near(camera.position, stage.position) || !near(controls.target, stage.freeTarget)) {
        // A hand stopped the glide on its way.
        own.mode = "free";
        useHallViewStore.getState().setStagePhase("off");
        return;
      }
      controls.maxPolarAngle = LEVEL_POLAR;
      own.squared = { value: prefersReducedMotion() ? 1 : 0, velocity: 0 };
      own.mode = "squaring";
    }
    if (own.mode === "squaring") {
      const spring = own.squared;
      if (spring.value < 1) stepSpring(spring, 1, Math.min(delta, MAX_STEP_S), SPRING_PRESETS.sheetSettle);
      if (spring.value >= 1 || isSpringSettled(spring, 1)) {
        hold(own, camera, controls, stage);
      } else {
        const pose = stagePoseAt(stage, spring.value);
        controls.target.set(pose.target[0], pose.target[1], pose.target[2]);
        controls.update();
        setLens(camera, pose.lens);
      }
      invalidate();
      return;
    }
    if (own.mode === "held" && (!near(camera.position, stage.position) || !near(controls.target, stage.heldTarget))) {
      // Something moved the camera without a press on the room (the arrow keys pan it).
      letGo(own, camera, controls);
      const hall = useHallViewStore.getState();
      if (hall.activePreset !== null) hall.setActivePreset(null);
      invalidate();
    }
  });

  return null;
}
