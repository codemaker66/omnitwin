import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, render } from "@testing-library/react";
import { PerspectiveCamera, Vector3 } from "three";
import { OrbitControls } from "three-stdlib";
import { MAX_POLAR_ANGLE, MIN_POLAR_ANGLE } from "../../../lib/camera-rig.js";
import { lensShift } from "../../../lib/lens-shift.js";
import { useBookmarkStore } from "../../../stores/bookmark-store.js";
import { useCockpitStore } from "../../../stores/cockpit-store.js";
import { useHallViewStore } from "../../../stores/hall-view-store.js";
import { hallStageFraming, mixLens, stageLens, type HallStageFraming } from "../hall-stage.js";

type Frame = (state: unknown, delta: number) => void;
interface Scene {
  camera: PerspectiveCamera;
  controls: OrbitControls;
  gl: { domElement: HTMLCanvasElement };
  invalidate: () => void;
  size: { width: number; height: number };
}
const three = vi.hoisted(() => ({ state: null as unknown, frame: null as unknown }));
vi.mock("@react-three/fiber", () => ({
  useThree: (select: (state: unknown) => unknown) => select(three.state),
  useFrame: (callback: unknown) => { three.frame = callback; },
}));
const { HallStage } = await import("../HallStage.js");
const { HALL_VIEW_POSES } = await import("../HallViewDirector.js");

const SKY = 48;
const [WIDTH, HEIGHT] = [1440, 748];

function scene(): Scene { return three.state as Scene; }
function frame(delta = 1 / 60): void { act(() => { (three.frame as Frame)(null, delta); }); }

function stage(): HallStageFraming {
  const framing = hallStageFraming(WIDTH, HEIGHT, SKY);
  if (framing === null) throw new Error("no stage");
  return framing;
}

/** How far below level the camera looks, radians. */
function pitch(camera: PerspectiveCamera): number {
  return -Math.asin(camera.getWorldDirection(new Vector3()).y);
}

function expectAt(point: Vector3, at: readonly [number, number, number]): void {
  expect(point.x).toBeCloseTo(at[0], 6);
  expect(point.y).toBeCloseTo(at[1], 6);
  expect(point.z).toBeCloseTo(at[2], 6);
}

beforeEach(() => {
  const canvas = document.createElement("canvas");
  document.body.append(canvas);
  const camera = new PerspectiveCamera(55, WIDTH / HEIGHT, 0.1, 200);
  // Where the rig opens the Grand Hall, and with its limits.
  camera.position.set(...HALL_VIEW_POSES.room.position);
  const controls = new OrbitControls(camera, canvas);
  controls.target.set(...HALL_VIEW_POSES.room.target);
  controls.minPolarAngle = MIN_POLAR_ANGLE;
  controls.maxPolarAngle = MAX_POLAR_ANGLE;
  controls.minDistance = 1.5;
  controls.maxDistance = 33.8;
  controls.enableDamping = true;
  // The rig zooms by its own wheel; the orbit's is off but for a pinch.
  controls.enableZoom = false;
  controls.update();
  three.state = { camera, controls, gl: { domElement: canvas }, invalidate: () => undefined, size: { width: WIDTH, height: HEIGHT } } satisfies Scene;
  useCockpitStore.getState().reset();
  useBookmarkStore.setState({ transition: null, pendingNavigationId: null, activeReferenceId: null, tour: null });
  useHallViewStore.setState({ viewRequest: null, activePreset: "room", stage: { skyPx: SKY }, stagePhase: "off" });
});

afterEach(() => {
  cleanup();
  scene().controls.dispose();
  scene().gl.domElement.remove();
  useHallViewStore.setState({ stage: null, stagePhase: "off", activePreset: "room" });
});

describe("the stage's hold on the camera", () => {
  it("opens the planner on the stage: level, through the fallen lens, and says so", () => {
    render(<HallStage />);
    const { camera, controls } = scene();
    const framing = stage();
    expectAt(camera.position, framing.position);
    expectAt(controls.target, framing.heldTarget);
    expect(pitch(camera)).toBeCloseTo(0, 9);
    const lens = stageLens(framing, 0);
    expect(camera.fov).toBeCloseTo(lens.fov, 9);
    expect(lensShift(camera).y).toBeCloseTo(lens.shiftY, 9);
    expect(lens.shiftY).toBeGreaterThan(0.3);
    expect(useHallViewStore.getState().stagePhase).toBe("held");
  });

  it("stays level through the orbit's own settling, whose limit stops short of level", () => {
    render(<HallStage />);
    const { camera, controls } = scene();
    for (let step = 0; step < 30; step++) controls.update();
    frame();
    expectAt(camera.position, stage().position);
    expect(pitch(camera)).toBeCloseTo(0, 9);
    expect(useHallViewStore.getState().stagePhase).toBe("held");
  });

  it("lets go at a wheel on the room: the same camera, tilted at the middle of the floor, and no view is the view", () => {
    render(<HallStage />);
    const { camera, controls, gl } = scene();
    const framing = stage();
    act(() => { gl.domElement.dispatchEvent(new WheelEvent("wheel", { bubbles: true, deltaY: -100 })); });
    expectAt(camera.position, framing.position);
    expectAt(controls.target, framing.freeTarget);
    expect(pitch(camera)).toBeCloseTo(framing.freePitch, 6);
    const lens = stageLens(framing, framing.freePitch);
    expect(camera.fov).toBeCloseTo(lens.fov, 9);
    expect(lensShift(camera).y).toBeCloseTo(lens.shiftY, 9);
    expect(controls.maxPolarAngle).toBe(MAX_POLAR_ANGLE);
    expect(useHallViewStore.getState().stagePhase).toBe("off");
    expect(useHallViewStore.getState().activePreset).toBeNull();
  });

  it("lets go at a press that turns the camera, not at one that selects", () => {
    render(<HallStage />);
    const { gl } = scene();
    act(() => { gl.domElement.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, button: 0, pointerType: "mouse" })); });
    expect(useHallViewStore.getState().stagePhase).toBe("held");
    // A press elsewhere on the page is not on the room.
    act(() => { document.body.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, button: 2, pointerType: "mouse" })); });
    expect(useHallViewStore.getState().stagePhase).toBe("held");
    act(() => { gl.domElement.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, button: 2, pointerType: "mouse" })); });
    expect(useHallViewStore.getState().stagePhase).toBe("off");
  });

  it("lets go when the director leaves for another view, before the glide reads where it starts", () => {
    render(<HallStage />);
    const { controls } = scene();
    act(() => { useHallViewStore.getState().setStagePhase("off"); });
    expectAt(controls.target, stage().freeTarget);
    expect(controls.maxPolarAngle).toBe(MAX_POLAR_ANGLE);
    // The named view is the director's to change, not the stage's.
    expect(useHallViewStore.getState().activePreset).toBe("room");
  });

  it("lets go, keeping the move, when the arrow keys pan the camera and what it looks at", () => {
    render(<HallStage />);
    const { camera, controls } = scene();
    const framing = stage();
    camera.position.x += 1.5;
    controls.target.x += 1.5;
    frame();
    expectAt(controls.target, [framing.freeTarget[0] + 1.5, framing.freeTarget[1], framing.freeTarget[2]]);
    expectAt(camera.position, [framing.position[0] + 1.5, framing.position[1], framing.position[2]]);
    expect(useHallViewStore.getState().stagePhase).toBe("off");
    expect(useHallViewStore.getState().activePreset).toBeNull();
  });

  it("carries the lens with a glide, lands tilted, then squares the camera up", () => {
    render(<HallStage />);
    const { camera, controls, gl } = scene();
    const framing = stage();
    // Away to Plan, as the director sends it.
    act(() => {
      useHallViewStore.setState({ activePreset: "plan" });
      useHallViewStore.getState().setStagePhase("off");
      useBookmarkStore.getState().startTransition(
        { id: "hall-view-plan", name: "Plan", position: framing.plan.position, target: framing.plan.target, kind: "default" },
        [camera.position.x, camera.position.y, camera.position.z], [controls.target.x, controls.target.y, controls.target.z],
      );
    });
    const free = stageLens(framing, framing.freePitch);
    // Half way there, the lens is half way too.
    camera.position.set(framing.position[0], (framing.position[1] + framing.plan.position[1]) / 2, (framing.position[2] + framing.plan.position[2]) / 2);
    frame();
    const halfway = mixLens(free, framing.plan.lens, 0.5);
    expect(camera.fov).toBeCloseTo(halfway.fov, 6);
    expect(lensShift(camera).y).toBeCloseTo(halfway.shiftY, 6);
    // Landed: Plan's own lens.
    camera.position.set(...framing.plan.position);
    controls.target.set(...framing.plan.target);
    act(() => { useBookmarkStore.setState({ transition: null }); });
    frame();
    expect(camera.fov).toBeCloseTo(framing.plan.lens.fov, 9);
    expect(lensShift(camera).y).toBeCloseTo(framing.plan.lens.shiftY, 9);

    // Back to the stage.
    act(() => {
      useHallViewStore.setState({ activePreset: "room" });
      useHallViewStore.getState().setStagePhase("arriving");
      useBookmarkStore.getState().startTransition(
        { id: "hall-view-room", name: "Room", position: framing.position, target: framing.freeTarget, kind: "default" },
        [camera.position.x, camera.position.y, camera.position.z], [controls.target.x, controls.target.y, controls.target.z],
      );
    });
    camera.position.set(...framing.position);
    controls.target.set(...framing.freeTarget);
    controls.update();
    act(() => { useBookmarkStore.setState({ transition: null }); });
    frame();
    // Squaring up: between tilted and level, still on its way.
    expect(useHallViewStore.getState().stagePhase).toBe("arriving");
    expect(pitch(camera)).toBeGreaterThan(0);
    expect(pitch(camera)).toBeLessThan(framing.freePitch);
    for (let step = 0; step < 90 && useHallViewStore.getState().stagePhase !== "held"; step++) frame();
    expect(useHallViewStore.getState().stagePhase).toBe("held");
    expect(pitch(camera)).toBeCloseTo(0, 9);
    expectAt(controls.target, framing.heldTarget);
    expect(lensShift(camera).y).toBeCloseTo(stageLens(framing, 0).shiftY, 9);
    // A hand on the room while it squares up would have let it go; none came.
    expect(gl.domElement.isConnected).toBe(true);
  });

  it("gives up the stage when a hand stops the glide on its way", () => {
    render(<HallStage />);
    const { camera, controls, gl } = scene();
    const framing = stage();
    act(() => { gl.domElement.dispatchEvent(new WheelEvent("wheel", { bubbles: true })); });
    camera.position.set(4, 9, 12);
    controls.update();
    act(() => {
      useHallViewStore.getState().setStagePhase("arriving");
      useBookmarkStore.getState().startTransition(
        { id: "hall-view-room", name: "Room", position: framing.position, target: framing.freeTarget, kind: "default" },
        [4, 9, 12], [0, 0, 0],
      );
    });
    frame();
    // Stopped where it is (the rig clears the glide at a press on the room).
    act(() => { useBookmarkStore.setState({ transition: null }); });
    frame();
    expect(useHallViewStore.getState().stagePhase).toBe("off");
    expect(controls.maxPolarAngle).toBe(MAX_POLAR_ANGLE);
  });

  it("walks through the plain lens, and stands on the stage again when the walk hands back its place", () => {
    render(<HallStage />);
    const { camera, controls } = scene();
    const framing = stage();
    act(() => { useCockpitStore.getState().setWalkMode(true); });
    expect(camera.fov).toBe(55);
    expect(lensShift(camera)).toEqual({ x: 0, y: 0 });
    expect(useHallViewStore.getState().stagePhase).toBe("off");
    // The rig restores the orbit as the walk began; here, as the stage held it.
    act(() => { useCockpitStore.getState().setWalkMode(false); });
    camera.position.set(...framing.position);
    controls.target.set(...framing.heldTarget);
    frame();
    expect(useHallViewStore.getState().stagePhase).toBe("held");
    expect(lensShift(camera).y).toBeCloseTo(stageLens(framing, 0).shiftY, 9);
  });

  it("takes the rig's own opening for a new arrival in the room", () => {
    render(<HallStage />);
    const { camera, controls, gl } = scene();
    act(() => { gl.domElement.dispatchEvent(new WheelEvent("wheel", { bubbles: true })); });
    camera.position.set(...HALL_VIEW_POSES.room.position);
    controls.target.set(...HALL_VIEW_POSES.room.target);
    frame();
    expect(useHallViewStore.getState().stagePhase).toBe("held");
    expect(useHallViewStore.getState().activePreset).toBe("room");
    expectAt(camera.position, stage().position);
  });

  it("offers no stage on an upright canvas: an ordinary orbit through the plain lens", () => {
    scene().size = { width: 390, height: 560 };
    render(<HallStage />);
    const { camera, controls } = scene();
    expectAt(camera.position, HALL_VIEW_POSES.room.position);
    expect(camera.fov).toBe(55);
    expect(lensShift(camera)).toEqual({ x: 0, y: 0 });
    expect(controls.maxPolarAngle).toBe(MAX_POLAR_ANGLE);
    expect(useHallViewStore.getState().stagePhase).toBe("off");
  });

  it("hands back an ordinary orbit and the plain lens when the screen that asked for it leaves", () => {
    const view = render(<HallStage />);
    const { camera, controls } = scene();
    view.unmount();
    expect(camera.fov).toBe(55);
    expect(lensShift(camera)).toEqual({ x: 0, y: 0 });
    expect(Object.hasOwn(camera, "updateProjectionMatrix")).toBe(false);
    expect(controls.maxPolarAngle).toBe(MAX_POLAR_ANGLE);
    expectAt(controls.target, stage().freeTarget);
    expect(useHallViewStore.getState().stagePhase).toBe("off");
  });
});
