import { act, cleanup, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PerspectiveCamera, Vector3 } from "three";
import type { OrbitControls as OrbitControlsImpl } from "three-stdlib";
import type { RootState } from "@react-three/fiber";
import type { ReactElement } from "react";
import type { CameraBookmark } from "../../lib/camera-animation.js";
import type { FloorFootprint } from "../../lib/camera-rig.js";
import { useBookmarkStore } from "../../stores/bookmark-store.js";
import { useCockpitStore } from "../../stores/cockpit-store.js";

// ---------------------------------------------------------------------------
// T-724: every pan holds the orbit target inside the room's bounds and moves
// the camera by the same correction, so the view keeps its offset and angle;
// what code places is never held. The real three-stdlib controls receive real
// pointer events, and frames run as drei and R3F run them: the controls' own
// update at priority -1, then the rig's frames.
// ---------------------------------------------------------------------------

interface FrameSubscriber {
  readonly priority: number;
  readonly callback: (state: RootState, delta: number) => void;
}

const harness = vi.hoisted(() => ({
  camera: null as PerspectiveCamera | null,
  canvas: null as HTMLCanvasElement | null,
  size: { width: 1600, height: 1000 },
  controls: null as OrbitControlsImpl | null,
  /** Every frame callback, kept in R3F's order: ascending priority, then subscription. */
  frames: [] as FrameSubscriber[],
  subscribe(subscriber: FrameSubscriber): () => void {
    this.frames.push(subscriber);
    this.frames.sort((a, b) => a.priority - b.priority);
    return () => {
      const index = this.frames.indexOf(subscriber);
      if (index >= 0) this.frames.splice(index, 1);
    };
  },
  invalidate: vi.fn(),
}));
vi.mock("@react-three/fiber", async () => {
  const React = await import("react");
  return {
    useThree: <T,>(selector?: (state: { camera: PerspectiveCamera | null; gl: { domElement: HTMLCanvasElement | null }; controls: OrbitControlsImpl | null; invalidate: () => void; size: { width: number; height: number } }) => T) => {
      const state = { camera: harness.camera, gl: { domElement: harness.canvas },
        controls: harness.controls, invalidate: harness.invalidate, size: harness.size };
      return selector === undefined ? state : selector(state);
    },
    useFrame: (callback: (state: RootState, delta: number) => void, priority = 0) => {
      React.useEffect(() => harness.subscribe({ priority, callback }), [callback, priority]);
    },
  };
});
// The real three-stdlib controls, wired as drei 9.122 wires them: updated each
// frame they are enabled, "change" invalidating and calling onChange, "start"
// and "end" calling onStart and onEnd, and each prop applied when its value
// changes (R3F never re-applies an unchanged primitive prop on a re-render).
vi.mock("@react-three/drei", async () => {
  const React = await import("react");
  const { OrbitControls } = await import("three-stdlib");
  interface ControlProps {
    readonly target?: [number, number, number]; readonly enabled?: boolean;
    readonly enableDamping: boolean; readonly dampingFactor: number;
    readonly enableZoom?: boolean; readonly enablePan?: boolean; readonly enableRotate?: boolean;
    readonly minPolarAngle?: number; readonly maxPolarAngle?: number;
    readonly mouseButtons?: OrbitControlsImpl["mouseButtons"];
    readonly minDistance: number; readonly maxDistance: number;
    readonly onChange?: () => void; readonly onStart?: () => void; readonly onEnd?: () => void;
  }
  return { OrbitControls: React.forwardRef<OrbitControlsImpl, ControlProps>((props, ref) => {
    const controls = React.useMemo(() => {
      if (harness.camera === null || harness.canvas === null) throw new Error("Missing camera fixture");
      return new OrbitControls(harness.camera, harness.canvas);
    }, []);
    React.useImperativeHandle(ref, () => controls, [controls]);
    const appliedTarget = React.useRef<string | null>(null);
    React.useLayoutEffect(() => {
      const key = props.target === undefined ? null : props.target.join(",");
      if (props.target !== undefined && key !== appliedTarget.current) controls.target.fromArray(props.target);
      appliedTarget.current = key;
    }, [controls, props.target]);
    React.useLayoutEffect(() => {
      if (props.enabled !== undefined) controls.enabled = props.enabled;
    }, [controls, props.enabled]);
    React.useLayoutEffect(() => {
      controls.enableDamping = props.enableDamping;
      controls.dampingFactor = props.dampingFactor;
    }, [controls, props.enableDamping, props.dampingFactor]);
    React.useLayoutEffect(() => {
      controls.minDistance = props.minDistance;
      controls.maxDistance = props.maxDistance;
    }, [controls, props.minDistance, props.maxDistance]);
    React.useLayoutEffect(() => {
      if (props.minPolarAngle !== undefined) controls.minPolarAngle = props.minPolarAngle;
      if (props.maxPolarAngle !== undefined) controls.maxPolarAngle = props.maxPolarAngle;
    }, [controls, props.minPolarAngle, props.maxPolarAngle]);
    React.useLayoutEffect(() => {
      if (props.enableZoom !== undefined) controls.enableZoom = props.enableZoom;
    }, [controls, props.enableZoom]);
    React.useLayoutEffect(() => {
      if (props.enablePan !== undefined) controls.enablePan = props.enablePan;
    }, [controls, props.enablePan]);
    React.useLayoutEffect(() => {
      if (props.enableRotate !== undefined) controls.enableRotate = props.enableRotate;
    }, [controls, props.enableRotate]);
    React.useLayoutEffect(() => {
      if (props.mouseButtons !== undefined) controls.mouseButtons = props.mouseButtons;
    }, [controls, props.mouseButtons]);
    React.useLayoutEffect(() => { harness.controls = controls; }, [controls]);
    // drei's own frame: the controls update each frame they are enabled, at priority -1.
    React.useEffect(() => harness.subscribe({
      priority: -1,
      callback: () => { if (controls.enabled) controls.update(); },
    }), [controls]);
    React.useEffect(() => {
      const onChange = (): void => { harness.invalidate(); props.onChange?.(); };
      const onStart = (): void => { props.onStart?.(); };
      const onEnd = (): void => { props.onEnd?.(); };
      controls.addEventListener("change", onChange);
      controls.addEventListener("start", onStart);
      controls.addEventListener("end", onEnd);
      return () => {
        controls.removeEventListener("change", onChange);
        controls.removeEventListener("start", onStart);
        controls.removeEventListener("end", onEnd);
      };
    }, [controls, props.onChange, props.onStart, props.onEnd]);
    React.useEffect(() => () => { controls.dispose(); harness.controls = null; }, [controls]);
    return null;
  }) };
});

const { CameraRig } = await import("../CameraRig.js");
const dimensions = { width: 21, length: 10.5, height: 7 };
/**
 * The room's bounds (computePanBounds): the floor plan with a fifth of each
 * side as margin, and as far below the floor and above the ceiling as that
 * reaches across the room (14.7 m from its centre).
 */
const BOUNDS = { minX: -14.7, maxX: 14.7, minY: -14.7, maxY: 21.7, minZ: -7.35, maxZ: 7.35 };
/** A held target stands on its bound, to the float error of the bound's own sum. */
const AT_BOUND = 1e-9;
/** OrbitControls reports ("change") only a move of the camera over a millimetre. */
const UNREPORTED = 1e-3;

/** One frame of the render loop, as R3F runs it: every callback in ascending priority (drei's controls at -1). */
function frame(): void {
  act(() => {
    for (const { callback } of [...harness.frames]) callback({} as RootState, 1 / 60);
  });
}

/** Runs frames for as long as the last one asked for another (at most `limit`); returns how many ran. */
function framesUntilRest(limit: number): number {
  let run = 0;
  while (run < limit) {
    harness.invalidate.mockClear();
    frame();
    run += 1;
    if (harness.invalidate.mock.calls.length === 0) break;
  }
  return run;
}

function controls(): OrbitControlsImpl {
  if (harness.controls === null) throw new Error("Missing controls");
  return harness.controls;
}

function camera(): PerspectiveCamera {
  if (harness.camera === null) throw new Error("Missing camera");
  return harness.camera;
}

function canvas(): HTMLCanvasElement {
  if (harness.canvas === null) throw new Error("Missing canvas");
  return harness.canvas;
}

/** The camera's offset from its orbit target: what a pan must keep. */
function offset(): Vector3 {
  return camera().position.clone().sub(controls().target);
}

/** How far the orbit target stands past the bounds, in metres (0 inside them). */
function outside(): number {
  const { x, y, z } = controls().target;
  return Math.max(0, x - BOUNDS.maxX, BOUNDS.minX - x, y - BOUNDS.maxY, BOUNDS.minY - y, z - BOUNDS.maxZ, BOUNDS.minZ - z);
}

function expectInBounds(where: string): void {
  expect(outside(), `${where}: metres past a bound`).toBeLessThanOrEqual(AT_BOUND);
}

type Axis = "x" | "y" | "z";

/**
 * A push past the bounds ended on them: the target stands inside, on a face
 * of the box across one of `axes` (a later leg names the axes it pushes on, so
 * an earlier leg's face cannot answer for it).
 */
function expectOnABound(where: string, axes: readonly Axis[] = ["x", "y", "z"]): void {
  expectInBounds(where);
  const target = controls().target;
  const faces: Record<Axis, readonly [number, number]> = {
    x: [BOUNDS.minX, BOUNDS.maxX], y: [BOUNDS.minY, BOUNDS.maxY], z: [BOUNDS.minZ, BOUNDS.maxZ],
  };
  const nearest = Math.min(...axes.flatMap((axis) => faces[axis].map((face) => Math.abs(target[axis] - face))));
  expect(nearest, `${where}: the pan carried the target to a bound across ${axes.join(" or ")}`).toBeLessThanOrEqual(AT_BOUND);
}

interface PointerInit {
  readonly pointerId: number;
  readonly pointerType: "mouse" | "touch";
  readonly button: number;
  readonly buttons: number;
  readonly shiftKey?: boolean;
}

/** A pointer event at (x, y). happy-dom leaves pageX and pageY at 0; OrbitControls' touch pan reads them. */
function pointer(type: string, init: PointerInit, x: number, y: number): PointerEvent {
  const event = new PointerEvent(type, {
    pointerId: init.pointerId, pointerType: init.pointerType, button: init.button, buttons: init.buttons,
    shiftKey: init.shiftKey ?? false, clientX: x, clientY: y, bubbles: true, cancelable: true,
  });
  Object.defineProperty(event, "pageX", { configurable: true, value: x });
  Object.defineProperty(event, "pageY", { configurable: true, value: y });
  return event;
}

/** The mouse's pan: the middle button held. */
const MIDDLE: PointerInit = { pointerId: 1, pointerType: "mouse", button: 1, buttons: 4 };
/** OrbitControls' other mouse pan: shift held with the button that turns the view. */
const SHIFT_RIGHT: PointerInit = { pointerId: 1, pointerType: "mouse", button: 2, buttons: 2, shiftKey: true };
/** The right button alone turns the view. */
const RIGHT: PointerInit = { pointerId: 1, pointerType: "mouse", button: 2, buttons: 2 };

/**
 * A mouse drag from (x, y) by (dx, dy) in `steps` moves, a frame drawn after
 * each move as a browser draws them; calls `during` after every frame.
 */
function mouseDrag(init: PointerInit, dx: number, dy: number, steps = 30, during?: () => void): void {
  const [x0, y0] = [800, 500];
  act(() => { canvas().dispatchEvent(pointer("pointerdown", init, x0, y0)); });
  for (let step = 1; step <= steps; step++) {
    const at: [number, number] = [x0 + (dx * step) / steps, y0 + (dy * step) / steps];
    act(() => { document.dispatchEvent(pointer("pointermove", init, at[0], at[1])); });
    frame();
    during?.();
  }
  act(() => { document.dispatchEvent(pointer("pointerup", { ...init, buttons: 0 }, x0 + dx, y0 + dy)); });
}

/** Two fingers 200 px apart moved together by (dx, dy) in `steps`: OrbitControls' two-finger pan. */
function twoFingerPan(dx: number, dy: number, steps = 30): void {
  const one: PointerInit = { pointerId: 11, pointerType: "touch", button: 0, buttons: 1 };
  const two: PointerInit = { pointerId: 12, pointerType: "touch", button: 0, buttons: 1 };
  const [x0, y0] = [700, 500];
  act(() => {
    canvas().dispatchEvent(pointer("pointerdown", one, x0, y0));
    canvas().dispatchEvent(pointer("pointerdown", two, x0 + 200, y0));
  });
  for (let step = 1; step <= steps; step++) {
    const [mx, my] = [(dx * step) / steps, (dy * step) / steps];
    act(() => {
      document.dispatchEvent(pointer("pointermove", one, x0 + mx, y0 + my));
      document.dispatchEvent(pointer("pointermove", two, x0 + 200 + mx, y0 + my));
    });
    frame();
  }
  act(() => {
    document.dispatchEvent(pointer("pointerup", { ...one, buttons: 0 }, x0 + dx, y0 + dy));
    document.dispatchEvent(pointer("pointerup", { ...two, buttons: 0 }, x0 + 200 + dx, y0 + dy));
  });
}

/** Holds an arrow key down for `frames` frames, calling `during` after each. */
function pressArrow(key: "ArrowRight" | "ArrowLeft", frames: number, during?: () => void): void {
  act(() => { window.dispatchEvent(new KeyboardEvent("keydown", { code: key, key, bubbles: true })); });
  for (let index = 0; index < frames; index++) {
    frame();
    during?.();
  }
  act(() => { window.dispatchEvent(new KeyboardEvent("keyup", { code: key, key, bubbles: true })); });
}

/** Glides to `bookmark` as the planner's saved views do (the controls off), lands, and lets the frames rest. */
function glideTo(bookmark: CameraBookmark): void {
  const { x, y, z } = controls().target;
  const at = camera().position;
  act(() => { useBookmarkStore.getState().startTransition(bookmark, [at.x, at.y, at.z], [x, y, z]); });
  for (let index = 0; index < 600 && useBookmarkStore.getState().transition !== null; index++) frame();
  expect(useBookmarkStore.getState().transition, "the glide landed").toBeNull();
  framesUntilRest(400);
}

function mount(smooth = true, footprint: FloorFootprint | null = null, room = dimensions): (ui: ReactElement) => void {
  const { rerender } = render(<CameraRig dimensions={room} footprint={footprint} smoothControls={smooth} />);
  framesUntilRest(400);
  // The controls read their angles on update(); bring them up to the opening pose.
  act(() => { controls().update(); });
  framesUntilRest(400);
  return rerender;
}

beforeEach(() => {
  useCockpitStore.getState().reset();
  useBookmarkStore.setState({ tour: null, transition: null, pendingNavigationId: null, activeReferenceId: null });
  harness.size = { width: 1600, height: 1000 };
  harness.camera = new PerspectiveCamera(55, 1600 / 1000, 0.1, 200);
  harness.camera.position.set(0, 14, 18);
  harness.canvas = document.createElement("canvas");
  // happy-dom lays nothing out; OrbitControls pans by the drag over the element's height.
  Object.defineProperty(harness.canvas, "clientHeight", { configurable: true, value: 1000 });
  Object.defineProperty(harness.canvas, "clientWidth", { configurable: true, value: 1600 });
  document.body.appendChild(harness.canvas);
  harness.frames.length = 0;
  harness.invalidate.mockClear();
});
afterEach(() => {
  cleanup();
  harness.canvas?.remove();
  harness.frames.length = 0;
});

// A wide window runs smooth (damped) controls; a compact one (1099 px or narrower) runs lean ones.
describe.each([["a wide window", true], ["a compact window", false]])("every pan in %s", (_window, smooth) => {
  it.each([
    ["the middle button", MIDDLE],
    ["shift and the right button", SHIFT_RIGHT],
  ])("stops the target on the room's bounds on a drag with %s, the camera keeping its offset", (_input, init) => {
    mount(smooth);
    const before = offset();
    mouseDrag(init, -6000, 0);
    framesUntilRest(400);
    expectOnABound("after a long sideways drag");
    expect(offset().distanceTo(before), "the camera moved by the target's correction").toBeLessThan(1e-6);
    mouseDrag(init, 0, -6000);
    framesUntilRest(400);
    expectOnABound("after a long drag up the screen", ["y", "z"]);
    mouseDrag(init, 0, 6000);
    framesUntilRest(400);
    expectOnABound("after a long drag down the screen", ["y", "z"]);
    expect(offset().distanceTo(before), "and still keeps its offset").toBeLessThan(1e-6);
  });

  it("stops the target on the room's bounds on a two-finger pan, the camera keeping its offset", () => {
    mount(smooth);
    const before = offset();
    twoFingerPan(-6000, 0);
    framesUntilRest(400);
    expectOnABound("after a long two-finger pan");
    twoFingerPan(0, 6000);
    framesUntilRest(400);
    expectOnABound("after a long two-finger pan down the screen", ["y", "z"]);
    expect(offset().distanceTo(before), "two fingers moved together pan without a pinch").toBeLessThan(1e-3);
  });
});

describe("the arrow keys' pan", () => {
  it("stops the target on the room's bounds, the camera moving by the same step", () => {
    mount();
    const before = offset();
    let worst = 0;
    pressArrow("ArrowRight", 900, () => { worst = Math.max(worst, outside()); });
    framesUntilRest(400);
    expect(worst, "no step carried the target past a bound").toBeLessThanOrEqual(AT_BOUND);
    expectOnABound("after fifteen seconds on the arrow");
    expect(offset().distanceTo(before), "the camera stopped with its target, keeping the view").toBeLessThan(1e-6);
  });
});

describe("the boundary", () => {
  it("stops a damped pan without a bounce: no frame shows the target past it or the camera off its offset", () => {
    mount(true);
    const before = offset();
    let worst = 0;
    const check = (): void => {
      worst = Math.max(worst, outside());
      expect(offset().distanceTo(before), "every frame keeps the camera's offset").toBeLessThan(1e-6);
    };
    // A fast push into the wall, released while still moving: the damping coast carries on into it,
    // its last steps under a millimetre, which OrbitControls does not report.
    mouseDrag(MIDDLE, -6000, 600, 12, check);
    let run = 0;
    for (; run < 400; run++) {
      harness.invalidate.mockClear();
      frame();
      check();
      if (harness.invalidate.mock.calls.length === 0) break;
    }
    expect(worst, "no frame draws the target past a bound").toBeLessThanOrEqual(AT_BOUND);
    expect(run, "the coast settles and the loop rests").toBeLessThan(400);
  });

  it("is held before anything hears the controls' change: every listener reads the held target", () => {
    mount(true);
    let heard = 0;
    let worst = 0;
    const listen = (): void => {
      heard += 1;
      worst = Math.max(worst, outside());
    };
    controls().addEventListener("change", listen);
    mouseDrag(MIDDLE, -6000, 600, 12);
    framesUntilRest(400);
    controls().removeEventListener("change", listen);
    expect(heard, "the push into the wall was reported").toBeGreaterThan(10);
    expect(worst, "no listener read a target past a bound").toBeLessThanOrEqual(AT_BOUND);
  });

  it("lets a drag up the screen follow the cursor on below the floor's level: the floor is no bound", () => {
    mount(true);
    // The Grand Hall's Room view (HALL_VIEW_POSES.room), looking down the room at about 54 degrees: from here
    // a drag up the screen lowers the target more than it carries it across the room.
    glideTo({ id: "room", name: "Room", position: [10.2, 12.6, 13.2], target: [0, 0.6, 0] });
    const start = controls().target.clone();
    const before = offset();
    // OrbitControls pans a perspective camera, for each pixel of drag, by twice the target's distance times
    // tan(fov / 2) over the element's height, along the camera's up, which lowers the target by sin(polar).
    const perPx = (2 * before.length() * Math.tan((camera().fov * Math.PI) / 360)) / 1000;
    const lowers = Math.sin(Math.acos(before.y / before.length()));
    const px = Math.round((start.y + 2) / lowers / perPx);
    mouseDrag(MIDDLE, 0, -px);
    framesUntilRest(400);
    act(() => { for (let index = 0; index < 400; index++) controls().update(); });
    expect(controls().target.y, "the target went on to 2 m below the floor's level").toBeCloseTo(-2, 1);
    expect(controls().target.distanceTo(start) / (px * perPx), "the pan followed the cursor in full").toBeCloseTo(1, 3);
    expect(offset().distanceTo(before), "the camera kept its offset").toBeLessThan(1e-6);
  });

  it("lets the pan slide along a wall it has reached", () => {
    mount(true);
    mouseDrag(MIDDLE, -6000, 0);
    framesUntilRest(400);
    const atWall = controls().target.clone();
    // Along the wall: the camera looks down the room, so a drag up the screen moves the target along it.
    mouseDrag(MIDDLE, -600, -400);
    framesUntilRest(400);
    const slid = controls().target.clone();
    expect(slid.distanceTo(atWall), "the pan still moves the target along the wall").toBeGreaterThan(0.5);
    expectInBounds("after sliding along the wall");
  });

  it("keeps a held view across a resize to a portrait window: the target restored is the bounded one", () => {
    const rerender = mount(true);
    mouseDrag(MIDDLE, -6000, 0);
    framesUntilRest(400);
    act(() => { for (let index = 0; index < 400; index++) controls().update(); });
    const held = controls().target.clone();
    const at = camera().position.clone();
    // Narrower than 1.2:1 the rig aims at another target, which R3F writes into the
    // controls; the rig then puts back the view's own, as of its last "change".
    harness.size = { width: 900, height: 1000 };
    rerender(<CameraRig dimensions={dimensions} smoothControls />);
    framesUntilRest(400);
    expect(controls().target.distanceTo(held), "the resize keeps the bounded target").toBeLessThan(UNREPORTED);
    expect(camera().position.distanceTo(at), "and the camera where it stood").toBeLessThan(UNREPORTED);
    expectInBounds("after the resize");
  });
});

describe("the room's bounds", () => {
  /** The target after four long pushes, one each way along the screen. */
  function pushEachWay(): Vector3[] {
    const reached: Vector3[] = [];
    for (const [dx, dy] of [[-6000, 0], [6000, 0], [0, -6000], [0, 6000]] as const) {
      mouseDrag(MIDDLE, dx, dy);
      framesUntilRest(400);
      reached.push(controls().target.clone());
    }
    return reached;
  }

  it("follow an outline drawn off the room's origin, so its far side stays within reach", () => {
    // The same room drawn from (0, 0) to (21, 10.5): its bounds are its own box with a fifth of each side.
    mount(true, { minX: 0, maxX: 21, minZ: 0, maxZ: 10.5 });
    const reached = pushEachWay();
    const xs = reached.map((target) => target.x);
    const zs = reached.map((target) => target.z);
    expect(Math.max(...xs), "the far side, past the width a centred box would stop at").toBeCloseTo(25.2, 9);
    expect(Math.min(...xs)).toBeCloseTo(-4.2, 9);
    expect(Math.max(...zs)).toBeCloseTo(12.6, 9);
    expect(Math.min(...zs)).toBeCloseTo(-2.1, 9);
  });

  it("follow the room: once the room changes under the rig, a pan is held to the new room's bounds", () => {
    const rerender = mount(true);
    mouseDrag(MIDDLE, -6000, 0);
    framesUntilRest(400);
    // A smaller room, 10 by 8 by 3 m: across it the bounds are x within 7 m and z within 5.6 m of its centre.
    rerender(<CameraRig dimensions={{ width: 10, length: 8, height: 3 }} smoothControls />);
    framesUntilRest(400);
    const reached = pushEachWay();
    for (const target of reached) {
      expect(Math.abs(target.x), "held across the small room's width").toBeLessThanOrEqual(7 + AT_BOUND);
      expect(Math.abs(target.z), "and its length").toBeLessThanOrEqual(5.6 + AT_BOUND);
    }
    expect(Math.max(...reached.map((target) => Math.abs(target.x))), "a push reaches the small room's bound").toBeCloseTo(7, 9);
  });

  it("let a drag up the screen in a low room follow the cursor deeper than the room is high", () => {
    // About the Robert Adam Room: 2.18 m high, its floor plan 11.4 by 12.7 m, so 8.89 m of slack below the floor.
    mount(true, null, { width: 11.4, length: 12.7, height: 2.18 });
    glideTo({ id: "low", name: "Low", position: [6, 7, 8], target: [0, 0.3, 0] });
    const start = controls().target.clone();
    const before = offset();
    const perPx = (2 * before.length() * Math.tan((camera().fov * Math.PI) / 360)) / 1000;
    const lowers = Math.sin(Math.acos(before.y / before.length()));
    const px = Math.round((start.y + 5) / lowers / perPx);
    mouseDrag(MIDDLE, 0, -px);
    framesUntilRest(400);
    act(() => { for (let index = 0; index < 400; index++) controls().update(); });
    expect(controls().target.y, "the target went on to 5 m below the floor, more than twice the room's height").toBeCloseTo(-5, 1);
    expect(controls().target.distanceTo(start) / (px * perPx), "the pan followed the cursor in full").toBeCloseTo(1, 3);
  });
});

describe("a view that code places", () => {
  /** Far above and in front of the hall, where the facade study's far views look from. */
  const FAR: CameraBookmark = { id: "far", name: "Far", position: [0, 60, -80], target: [0, 40, -60] };

  it("outside the bounds is left where the glide put it, and turning the view there does not pull it in", () => {
    mount(true);
    glideTo(FAR);
    expect(controls().target.distanceTo(new Vector3(0, 40, -60)), "the glide lands where it was sent").toBeLessThan(1e-6);
    mouseDrag(RIGHT, 160, 0);
    framesUntilRest(400);
    expect(controls().target.distanceTo(new Vector3(0, 40, -60)), "a turn leaves the target alone").toBeLessThan(1e-6);
  });

  /** At the bound on +x, the camera looking along -z: a drag to the left, or the right arrow, carries the target out along +x. */
  const AT_EDGE: CameraBookmark = { id: "edge", name: "Edge", position: [14.7, 12, 12], target: [14.7, 0.7, 0] };

  /** Glides to `bookmark` and stops on the frame that lands it: nothing runs between the landing and what follows. */
  function landOn(bookmark: CameraBookmark): void {
    const { x, y, z } = controls().target;
    const at = camera().position;
    act(() => { useBookmarkStore.getState().startTransition(bookmark, [at.x, at.y, at.z], [x, y, z]); });
    for (let index = 0; index < 600 && useBookmarkStore.getState().transition !== null; index++) frame();
    expect(useBookmarkStore.getState().transition, "the glide landed").toBeNull();
  }

  it("on a bound holds a drag that starts the moment a glide lands there, from its first move", () => {
    mount(true);
    landOn(AT_EDGE);
    let worst = 0;
    mouseDrag(MIDDLE, -6000, 0, 30, () => { worst = Math.max(worst, outside()); });
    framesUntilRest(400);
    expect(worst, "not one move carried the target past the bound").toBeLessThanOrEqual(AT_BOUND);
    expectOnABound("after the drag");
  });

  it("on a bound holds an arrow pan that starts the moment a glide lands there, from its first step", () => {
    mount(true);
    landOn(AT_EDGE);
    let worst = 0;
    pressArrow("ArrowRight", 60, () => { worst = Math.max(worst, outside()); });
    framesUntilRest(400);
    expect(worst, "not one step carried the target past the bound").toBeLessThanOrEqual(AT_BOUND);
    expectOnABound("after the arrow");
  });

  it("outside the bounds can be panned back towards the room but no further out", () => {
    mount(true);
    glideTo(FAR);
    const start = controls().target.clone();
    for (const [dx, dy] of [[-6000, 0], [6000, 0], [0, 6000], [0, -6000]] as const) {
      mouseDrag(MIDDLE, dx, dy);
      framesUntilRest(400);
      const { x, y, z } = controls().target;
      expect(x).toBeGreaterThanOrEqual(BOUNDS.minX - AT_BOUND);
      expect(x).toBeLessThanOrEqual(BOUNDS.maxX + AT_BOUND);
      expect(y, "no higher than the glide left it").toBeLessThanOrEqual(start.y + AT_BOUND);
      expect(y).toBeGreaterThanOrEqual(BOUNDS.minY - AT_BOUND);
      expect(z, "no further in front than the glide left it").toBeGreaterThanOrEqual(start.z - AT_BOUND);
      expect(z).toBeLessThanOrEqual(BOUNDS.maxZ + AT_BOUND);
    }
    expect(controls().target.distanceTo(start), "the pans brought it back towards the room").toBeGreaterThan(1);
  });

  /** A pose above the bounds, placed as the hall's stage places its own: with the controls on. */
  const ABOVE = { position: new Vector3(0, 34, 16.3), target: new Vector3(0, 30, -5.3) };

  /** HallStage's setPose: damping off, an update to finish any coast, the pose, an update. */
  function placeWithTheControlsOn(position: Vector3, target: Vector3): void {
    act(() => {
      const orbit = controls();
      const damping = orbit.enableDamping;
      orbit.enableDamping = false;
      orbit.update();
      camera().position.copy(position);
      orbit.target.copy(target);
      orbit.update();
      orbit.enableDamping = damping;
    });
  }

  it("with the controls on is never held, however far outside; a pan from there goes no further out", () => {
    mount(true);
    expect(controls().enabled, "the controls are on").toBe(true);
    placeWithTheControlsOn(ABOVE.position, ABOVE.target);
    framesUntilRest(400);
    expect(camera().position.distanceTo(ABOVE.position), "the camera stands where code put it").toBeLessThan(1e-9);
    expect(controls().target.distanceTo(ABOVE.target), "and looks where code aimed it").toBeLessThan(1e-9);
    // Code turning the view a step a frame with the controls on, as the stage squares up: each step stands.
    for (let step = 1; step <= 10; step++) {
      const aim = new Vector3(0, 30 + step * 0.2, -5.3);
      act(() => {
        controls().target.copy(aim);
        controls().update();
      });
      frame();
      expect(controls().target.distanceTo(aim), `step ${String(step)} stands where code aimed it`).toBeLessThan(1e-9);
    }
    const from = controls().target.clone();
    // Near level, a drag down the screen lifts the target: held where code left it, never higher.
    mouseDrag(MIDDLE, 0, 6000);
    framesUntilRest(400);
    expect(controls().target.y, "no higher than code left it").toBeLessThanOrEqual(from.y + AT_BOUND);
    // A drag up the screen lowers it back towards the room.
    mouseDrag(MIDDLE, 0, -6000);
    framesUntilRest(400);
    expect(controls().target.y, "a pan brings it back down").toBeLessThan(from.y - 1);
  });
});

describe("the rig's hold on the controls' update", () => {
  it("is let go when the rig unmounts", () => {
    mount(true);
    const orbit = controls();
    const held = orbit.update;
    cleanup();
    expect(orbit.update, "the controls' own update is back").not.toBe(held);
  });
});
