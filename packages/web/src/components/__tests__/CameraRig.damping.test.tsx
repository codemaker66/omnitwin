import { act, cleanup, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PerspectiveCamera } from "three";
import type { OrbitControls as OrbitControlsImpl } from "three-stdlib";
import type { RootState } from "@react-three/fiber";
import { useBookmarkStore } from "../../stores/bookmark-store.js";
import { useCockpitStore } from "../../stores/cockpit-store.js";

// ---------------------------------------------------------------------------
// The orbit camera's damping settles on frames it asks for, and only while
// they still move the camera. A change that leaves nothing to damp (a pose set
// in code, a glide that has landed) must let the render loop rest: on a
// software-rendered device every needless frame costs a quarter of a second.
// ---------------------------------------------------------------------------

const harness = vi.hoisted(() => ({
  camera: null as PerspectiveCamera | null,
  canvas: null as HTMLCanvasElement | null,
  controls: null as OrbitControlsImpl | null,
  frames: new Set<(state: RootState, delta: number) => void>(),
  invalidate: vi.fn(),
}));
vi.mock("@react-three/fiber", async () => {
  const React = await import("react");
  return {
    useThree: <T,>(selector?: (state: { camera: PerspectiveCamera | null; gl: { domElement: HTMLCanvasElement | null }; controls: OrbitControlsImpl | null; invalidate: () => void; size: { width: number; height: number } }) => T) => {
      const state = { camera: harness.camera, gl: { domElement: harness.canvas },
        controls: harness.controls, invalidate: harness.invalidate, size: { width: 1600, height: 1000 } };
      return selector === undefined ? state : selector(state);
    },
    useFrame: (callback: (state: RootState, delta: number) => void) => {
      React.useEffect(() => { harness.frames.add(callback); return () => { harness.frames.delete(callback); }; }, [callback]);
    },
  };
});
// The real three-stdlib controls, wired as drei wires them: a camera move
// fires "change", which invalidates and calls onChange.
vi.mock("@react-three/drei", async () => {
  const React = await import("react");
  const { OrbitControls } = await import("three-stdlib");
  interface ControlProps {
    readonly target?: [number, number, number]; readonly enabled?: boolean; readonly enableDamping: boolean; readonly dampingFactor: number;
    readonly enableZoom?: boolean;
    readonly mouseButtons?: OrbitControlsImpl["mouseButtons"];
    readonly minDistance: number; readonly maxDistance: number; readonly onChange?: () => void;
  }
  return { OrbitControls: React.forwardRef<OrbitControlsImpl, ControlProps>((props, ref) => {
    const controls = React.useMemo(() => {
      if (harness.camera === null || harness.canvas === null) throw new Error("Missing camera fixture");
      return new OrbitControls(harness.camera, harness.canvas);
    }, []);
    React.useImperativeHandle(ref, () => controls, [controls]);
    React.useLayoutEffect(() => {
      if (props.target !== undefined) controls.target.fromArray(props.target);
      if (props.enabled !== undefined) controls.enabled = props.enabled;
      controls.enableDamping = props.enableDamping;
      controls.dampingFactor = props.dampingFactor;
      controls.minDistance = props.minDistance;
      controls.maxDistance = props.maxDistance;
      harness.controls = controls;
    }, [controls, props]);
    // R3F applies a primitive's prop when its value changes, never again on a re-render.
    React.useLayoutEffect(() => {
      if (props.enableZoom !== undefined) controls.enableZoom = props.enableZoom;
    }, [controls, props.enableZoom]);
    React.useLayoutEffect(() => {
      if (props.mouseButtons !== undefined) controls.mouseButtons = props.mouseButtons;
    }, [controls, props.mouseButtons]);
    React.useEffect(() => {
      const onChange = (): void => { harness.invalidate(); props.onChange?.(); };
      controls.addEventListener("change", onChange);
      return () => { controls.removeEventListener("change", onChange); };
    }, [controls, props.onChange]);
    React.useEffect(() => () => { controls.dispose(); harness.controls = null; }, [controls]);
    return null;
  }) };
});

const { CameraRig } = await import("../CameraRig.js");
const dimensions = { width: 21, length: 10.5, height: 7 };

/** One frame of the render loop, as R3F runs it while something asked for it. */
function frame(): void {
  act(() => { for (const callback of harness.frames) callback({} as RootState, 1 / 60); });
}

/** Runs frames for as long as the last one asked for another (at most `limit`). */
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

beforeEach(() => {
  useCockpitStore.getState().reset();
  useBookmarkStore.setState({ tour: null, transition: null, pendingNavigationId: null, activeReferenceId: null });
  harness.camera = new PerspectiveCamera(55, 1600 / 1000, 0.1, 200);
  harness.camera.position.set(0, 14, 18);
  harness.canvas = document.createElement("canvas");
  document.body.appendChild(harness.canvas);
  harness.frames.clear();
  harness.invalidate.mockClear();
});
afterEach(() => {
  cleanup();
  harness.canvas?.remove();
  harness.frames.clear();
});

describe("the orbit camera's damping", () => {
  it("lets the render loop rest when a change leaves nothing to damp", () => {
    render(<CameraRig dimensions={dimensions} />);
    // Settle whatever the first mount set in motion.
    framesUntilRest(400);
    // A pose set in code: the camera moves ("change" fires), nothing coasts.
    harness.invalidate.mockClear();
    act(() => { harness.camera?.position.setX((harness.camera.position.x) + 1); controls().update(); });
    expect(harness.invalidate, "the move itself asked for a frame").toHaveBeenCalled();
    harness.invalidate.mockClear();
    frame();
    expect(harness.invalidate, "a frame that moved nothing asks for no more").not.toHaveBeenCalled();
  });

  it("keeps asking for frames while an orbit coasts, and stops once it has landed", () => {
    render(<CameraRig dimensions={dimensions} />);
    framesUntilRest(400);
    // The controls read their angles on update(); bring them up to the pose.
    act(() => { controls().update(); });
    framesUntilRest(400);
    const goal = controls().getAzimuthalAngle() + 0.6;
    act(() => { controls().setAzimuthalAngle(goal); });
    const run = framesUntilRest(400);
    expect(run, "the coast takes many frames").toBeGreaterThan(10);
    expect(run, "and then the loop rests").toBeLessThan(400);
    expect(controls().getAzimuthalAngle()).toBeCloseTo(goal, 2);
  });
});

describe("the orbit camera's zoom", () => {
  function finger(type: string, pointerId: number): PointerEvent {
    return new PointerEvent(type, { pointerType: "touch", pointerId });
  }

  it("leaves every wheel to the inertial zoom and zooms the controls only while a finger is down", () => {
    render(<CameraRig dimensions={dimensions} />);
    expect(controls().enableZoom, "no finger: the controls never zoom a wheel").toBe(false);

    act(() => { window.dispatchEvent(finger("pointerdown", 1)); window.dispatchEvent(finger("pointerdown", 2)); });
    expect(controls().enableZoom, "two fingers down: the pinch dollies").toBe(true);

    act(() => { window.dispatchEvent(finger("pointerup", 1)); window.dispatchEvent(finger("pointerup", 2)); });
    expect(controls().enableZoom, "the last finger lifted").toBe(false);
  });
});

describe("the orbit camera's mouse", () => {
  /** A mouse drag of 120 px across the canvas with one button held; returns how far the view turned (rad). */
  function mouseDrag(button: number): number {
    const canvas = harness.canvas;
    if (canvas === null) throw new Error("Missing canvas");
    const before = controls().getAzimuthalAngle();
    const at = (type: string, x: number, buttons: number): PointerEvent =>
      new PointerEvent(type, { pointerType: "mouse", pointerId: 1, button, buttons, clientX: x, clientY: 400, bubbles: true });
    act(() => {
      canvas.dispatchEvent(at("pointerdown", 600, 1 << (button === 2 ? 1 : 0)));
      document.dispatchEvent(at("pointermove", 720, 1 << (button === 2 ? 1 : 0)));
      document.dispatchEvent(at("pointerup", 720, 0));
    });
    framesUntilRest(400);
    act(() => { controls().update(); });
    return Math.abs(controls().getAzimuthalAngle() - before);
  }

  // A wide window runs smooth controls; a compact one (1099 px or narrower) runs lean ones.
  it.each([["a wide window", true], ["a compact window", false]])("looks around on a right-drag in %s, and a left-drag stays the marquee's", (_width, smooth) => {
    // happy-dom lays nothing out; OrbitControls turns by the drag over the canvas height.
    Object.defineProperty(harness.canvas, "clientHeight", { configurable: true, value: 1000 });
    render(<CameraRig dimensions={dimensions} smoothControls={smooth} />);
    framesUntilRest(400);
    act(() => { controls().update(); });

    expect(mouseDrag(0), "the left button turns nothing").toBeLessThan(1e-6);
    expect(mouseDrag(2), "the right button looks around").toBeGreaterThan(0.2);
  });
});
