import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, render } from "@testing-library/react";
import { MOUSE, PerspectiveCamera, Vector3 } from "three";
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

/** One event of a mouse button on the room (or on `target`), as a browser sends it. */
function pointer(type: string, init: PointerEventInit, target: EventTarget = scene().gl.domElement): void {
  act(() => { target.dispatchEvent(new PointerEvent(type, { bubbles: true, cancelable: true, pointerId: 1, pointerType: "mouse", ...init })); });
}

/** Lets go of the stage with a wheel, then glides back to it as the director sends the camera, and lands. */
function landOnTheStage(): void {
  const { camera, controls, gl } = scene();
  const framing = stage();
  act(() => { gl.domElement.dispatchEvent(new WheelEvent("wheel", { bubbles: true })); });
  act(() => {
    useHallViewStore.setState({ activePreset: "room" });
    useHallViewStore.getState().setStagePhase("arriving");
    useBookmarkStore.getState().startTransition(
      { id: "hall-view-room", name: "Room", position: framing.position, target: framing.freeTarget, kind: "default" },
      [camera.position.x, camera.position.y, camera.position.z], [controls.target.x, controls.target.y, controls.target.z],
    );
  });
  act(() => { useBookmarkStore.setState({ transition: null }); });
}

beforeEach(() => {
  const canvas = document.createElement("canvas");
  // The orbit turns by a drag's share of the canvas's height.
  Object.defineProperties(canvas, { clientWidth: { value: WIDTH }, clientHeight: { value: HEIGHT } });
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
  // The rig's buttons: the left selects, the middle slides the camera and the right turns it.
  controls.mouseButtons = { LEFT: -1 as MOUSE, MIDDLE: MOUSE.PAN, RIGHT: MOUSE.ROTATE };
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
  useHallViewStore.setState({ stage: null, stagePhase: "off", stagePoses: null, activePreset: "room" });
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

  it("says where its camera stands for Room and for Plan, for the views' director to send it there", () => {
    render(<HallStage />);
    const framing = stage();
    expect(useHallViewStore.getState().stagePoses).toEqual({
      room: { position: framing.position, target: framing.freeTarget },
      plan: { position: framing.plan.position, target: framing.plan.target },
    });
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

  it("lets go at a drag that turns the camera, not at a press that selects or a right click that puts a card down", () => {
    render(<HallStage />);
    const { camera, controls, gl } = scene();
    const framing = stage();
    // What reaches the room's own listeners (the orbit's among them) of each move: they hear after the window's capture.
    const heard: number[] = [];
    const hear = (event: Event): void => { if (event instanceof PointerEvent) heard.push(event.clientX); };
    gl.domElement.addEventListener("pointermove", hear);

    // The left button selects, however far it travels.
    pointer("pointerdown", { button: 0, buttons: 1, clientX: 400, clientY: 300 });
    pointer("pointermove", { buttons: 1, clientX: 460, clientY: 300 });
    pointer("pointerup", { button: 0, clientX: 460, clientY: 300 });
    frame();
    expect(useHallViewStore.getState().stagePhase).toBe("held");
    expect(heard).toEqual([460]);

    // A right click, with the small shake of a hand: it puts the card in hand down, and the picture does not stir.
    pointer("pointerdown", { button: 2, buttons: 2, clientX: 400, clientY: 300 });
    pointer("pointermove", { buttons: 2, clientX: 403, clientY: 301 });
    pointer("pointerup", { button: 2, clientX: 403, clientY: 301 });
    frame();
    expect(useHallViewStore.getState().stagePhase).toBe("held");
    expect(useHallViewStore.getState().activePreset).toBe("room");
    expectAt(camera.position, framing.position);
    expect(pitch(camera)).toBeCloseTo(0, 9);
    // The orbit never heard the shake, so it turned nothing.
    expect(heard).toEqual([460]);

    // A drag elsewhere on the page is not on the room.
    pointer("pointerdown", { button: 2, buttons: 2, clientX: 400, clientY: 300 }, document.body);
    pointer("pointermove", { buttons: 2, clientX: 460, clientY: 300 }, document.body);
    pointer("pointerup", { button: 2, clientX: 460, clientY: 300 }, document.body);
    expect(useHallViewStore.getState().stagePhase).toBe("held");

    // A right drag turns the camera: the stage lets go as it becomes one, and the orbit takes the drag from there.
    pointer("pointerdown", { button: 2, buttons: 2, clientX: 400, clientY: 300 });
    pointer("pointermove", { buttons: 2, clientX: 402, clientY: 300 });
    expect(useHallViewStore.getState().stagePhase).toBe("held");
    pointer("pointermove", { buttons: 2, clientX: 430, clientY: 300 });
    expect(useHallViewStore.getState().stagePhase).toBe("off");
    expect(useHallViewStore.getState().activePreset).toBeNull();
    expect(heard).toEqual([460, 430]);
    // An ordinary orbit about the middle of the floor, turned by the drag.
    expectAt(controls.target, framing.freeTarget);
    expect(Math.abs(camera.position.x)).toBeGreaterThan(0.1);
    pointer("pointerup", { button: 2, clientX: 430, clientY: 300 });
    gl.domElement.removeEventListener("pointermove", hear);
  });

  it("forgets a press whose release it never heard, so a pointer coming back over the room is not a drag", () => {
    render(<HallStage />);
    pointer("pointerdown", { button: 2, buttons: 2, clientX: 400, clientY: 300 });
    // Released outside the window: the next move arrives with no button down.
    pointer("pointermove", { buttons: 0, clientX: 600, clientY: 300 });
    pointer("pointermove", { buttons: 0, clientX: 700, clientY: 300 });
    expect(useHallViewStore.getState().stagePhase).toBe("held");
  });

  it("lets go while it is still squaring up on the same picture: the camera is aimed at the floor again", () => {
    render(<HallStage />);
    const { camera, controls, gl } = scene();
    const framing = stage();
    landOnTheStage();
    frame();
    frame();
    frame();
    // Part-way level.
    expect(useHallViewStore.getState().stagePhase).toBe("arriving");
    expect(pitch(camera)).toBeGreaterThan(0.01);
    expect(pitch(camera)).toBeLessThan(framing.freePitch - 0.01);
    act(() => { gl.domElement.dispatchEvent(new WheelEvent("wheel", { bubbles: true })); });
    // Tilted at the middle of the floor through the tilted camera's lens: the picture it was showing.
    expectAt(camera.position, framing.position);
    expectAt(controls.target, framing.freeTarget);
    expect(pitch(camera)).toBeCloseTo(framing.freePitch, 6);
    const lens = stageLens(framing, framing.freePitch);
    expect(camera.fov).toBeCloseTo(lens.fov, 9);
    expect(lensShift(camera).y).toBeCloseTo(lens.shiftY, 9);
    expect(controls.maxPolarAngle).toBe(MAX_POLAR_ANGLE);
    expect(useHallViewStore.getState().stagePhase).toBe("off");
  });

  it("takes back the word that it is arriving when no glide is, so Room can be asked for again", () => {
    render(<HallStage />);
    const { gl } = scene();
    act(() => { gl.domElement.dispatchEvent(new WheelEvent("wheel", { bubbles: true })); });
    // Said by the director for a glide this never heard begin.
    act(() => { useHallViewStore.getState().setStagePhase("arriving"); });
    frame();
    expect(useHallViewStore.getState().stagePhase).toBe("off");
  });

  it("drops a glide's lens when the canvas no longer holds a stage", () => {
    const view = render(<HallStage />);
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
    // The window is stood on its end while the camera is on its way.
    scene().size = { width: 390, height: 560 };
    view.rerender(<HallStage />);
    camera.position.set(2, 10, 14);
    frame();
    expect(camera.fov).toBe(55);
    expect(lensShift(camera)).toEqual({ x: 0, y: 0 });
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
    // No stage here, so the views are the ordinary ones.
    expect(useHallViewStore.getState().stagePoses).toBeNull();
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
    expect(useHallViewStore.getState().stagePoses).toBeNull();
  });
});
