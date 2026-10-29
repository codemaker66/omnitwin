import { act, cleanup, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PerspectiveCamera, Vector3 } from "three";
import type { OrbitControls as OrbitControlsImpl } from "three-stdlib";
import type { RootState } from "@react-three/fiber";
import { useBookmarkStore } from "../../stores/bookmark-store.js";
import { useCockpitStore } from "../../stores/cockpit-store.js";
import { buildShowcaseTour } from "../../lib/camera-tour.js";
import type { CameraBookmark } from "../../lib/camera-animation.js";
import type { ReactElement } from "react";

// ---------------------------------------------------------------------------
// A view glide (a view button, a bookmark) hands the camera over to whoever
// reaches for it: a wheel or a camera drag stops the glide where it is and
// acts at once, instead of being swallowed until the glide lands. A tour, a
// flight into a saved viewpoint and a suspended rig keep the camera.
// ---------------------------------------------------------------------------

const harness = vi.hoisted(() => ({
  camera: null as PerspectiveCamera | null,
  canvas: null as HTMLCanvasElement | null,
  size: { width: 1600, height: 1000 },
  controls: null as OrbitControlsImpl | null,
  frames: new Set<(state: RootState, delta: number) => void>(),
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
    useFrame: (callback: (state: RootState, delta: number) => void) => {
      React.useEffect(() => { harness.frames.add(callback); return () => { harness.frames.delete(callback); }; }, [callback]);
    },
  };
});
// The real three-stdlib controls, wired as drei wires them.
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

function frame(): void {
  act(() => { for (const callback of harness.frames) callback({} as RootState, 1 / 60); });
}

function framesUntilRest(limit: number): void {
  for (let run = 0; run < limit; run++) {
    harness.invalidate.mockClear();
    frame();
    if (harness.invalidate.mock.calls.length === 0) return;
  }
}

function controls(): OrbitControlsImpl {
  if (harness.controls === null) throw new Error("Missing controls");
  return harness.controls;
}

function canvas(): HTMLCanvasElement {
  if (harness.canvas === null) throw new Error("Missing canvas");
  return harness.canvas;
}

/** The glide's end: straight above the hall, far from where the camera starts. */
const ABOVE: CameraBookmark = { id: "above", name: "Above", position: [0, 30, 0.1], target: [0, 0, 0] };

function startGlide(bookmark: CameraBookmark): void {
  const camera = harness.camera;
  if (camera === null) throw new Error("Missing camera");
  const { x, y, z } = controls().target;
  act(() => {
    useBookmarkStore.getState().startTransition(bookmark, [camera.position.x, camera.position.y, camera.position.z], [x, y, z]);
  });
  // Under way: the glide holds the camera and the controls are off.
  for (let index = 0; index < 4; index++) frame();
  expect(useBookmarkStore.getState().transition).not.toBeNull();
  expect(controls().enabled).toBe(false);
}

function mount(element: ReactElement = <CameraRig dimensions={dimensions} />): void {
  render(element);
  framesUntilRest(400);
}

/** Whether the controls were on when the press itself reached the canvas (as OrbitControls hears it). */
function pressAndRead(init: PointerEventInit): boolean {
  let enabledWhenHeard = false;
  const hear = (): void => { enabledWhenHeard = controls().enabled; };
  canvas().addEventListener("pointerdown", hear);
  act(() => { canvas().dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, cancelable: true, pointerId: 7, clientX: 800, clientY: 500, ...init })); });
  canvas().removeEventListener("pointerdown", hear);
  act(() => { canvas().dispatchEvent(new PointerEvent("pointerup", { bubbles: true, pointerId: 7, clientX: 800, clientY: 500, ...init })); });
  return enabledWhenHeard;
}

beforeEach(() => {
  useCockpitStore.getState().reset();
  useBookmarkStore.setState({ tour: null, transition: null, pendingNavigationId: null, activeReferenceId: null });
  harness.size = { width: 1600, height: 1000 };
  harness.camera = new PerspectiveCamera(55, 1600 / 1000, 0.1, 200);
  harness.camera.position.set(0, 14, 18);
  harness.canvas = document.createElement("canvas");
  const captured = new Set<number>();
  harness.canvas.setPointerCapture = (id) => { captured.add(id); };
  harness.canvas.hasPointerCapture = (id) => captured.has(id);
  harness.canvas.releasePointerCapture = (id) => { captured.delete(id); };
  document.body.appendChild(harness.canvas);
  harness.frames.clear();
  harness.invalidate.mockClear();
});
afterEach(() => {
  cleanup();
  harness.canvas?.remove();
  harness.frames.clear();
  useBookmarkStore.setState({ tour: null, transition: null, pendingNavigationId: null, activeReferenceId: null });
});

describe("a view glide hands the camera to whoever reaches for it", () => {
  it("stops where it is at a wheel, and the wheel's zoom plays from there", () => {
    mount();
    startGlide(ABOVE);
    const camera = harness.camera;
    if (camera === null) throw new Error("Missing camera");
    const stoppedAt = camera.position.clone();
    act(() => { canvas().dispatchEvent(new WheelEvent("wheel", { bubbles: true, cancelable: true, deltaY: -120 })); });
    expect(useBookmarkStore.getState().transition).toBeNull();
    expect(controls().enabled).toBe(true);
    const range = camera.position.distanceTo(controls().target);
    framesUntilRest(400);
    // The wheel was heard, not swallowed until a landing ...
    expect(Math.abs(camera.position.distanceTo(controls().target) - range)).toBeGreaterThan(0.05);
    // ... and the camera never went on to the glide's end.
    expect(camera.position.distanceTo(stoppedAt)).toBeLessThan(camera.position.distanceTo(controls().target) * 2);
    expect(camera.position.y).toBeLessThan(28);
  });

  it("stops at any press, left, middle or right, with the controls already on for that same press", () => {
    // The left button too: a click lands on what was aimed at, never on something still gliding past.
    for (const button of [0, 1, 2]) {
      mount();
      startGlide(ABOVE);
      expect(pressAndRead({ pointerType: "mouse", button, buttons: [1, 4, 2][button] ?? 1 }), `button ${String(button)}`).toBe(true);
      expect(useBookmarkStore.getState().transition).toBeNull();
      cleanup();
      harness.frames.clear();
    }
  });

  it("stops at a finger, at the touch itself (OrbitControls follows only a gesture it saw begin)", () => {
    mount();
    startGlide(ABOVE);
    expect(pressAndRead({ pointerType: "touch", button: 0, buttons: 1 })).toBe(true);
    expect(useBookmarkStore.getState().transition).toBeNull();
  });

  it("does not swing the view at a takeover: the direction and target are the glide's own", () => {
    mount();
    startGlide(ABOVE);
    const camera = harness.camera;
    if (camera === null) throw new Error("Missing camera");
    const looking = camera.getWorldDirection(new Vector3());
    const target = controls().target.clone();
    pressAndRead({ pointerType: "mouse", button: 0, buttons: 1 });
    // The next update the controls make (the one that would swing to a stale target).
    act(() => { controls().update(); });
    expect(camera.getWorldDirection(new Vector3()).angleTo(looking)).toBeLessThan(1e-3);
    expect(controls().target.distanceTo(target)).toBeLessThan(1e-6);

    // A wheel's zoom then dollies along that same line of sight.
    act(() => { canvas().dispatchEvent(new WheelEvent("wheel", { bubbles: true, cancelable: true, deltaY: -120 })); });
    framesUntilRest(400);
    expect(camera.getWorldDirection(new Vector3()).angleTo(looking)).toBeLessThan(1e-3);
  });

  it("goes on at a wheel aimed anywhere but the room", () => {
    mount();
    startGlide(ABOVE);
    act(() => { document.body.dispatchEvent(new WheelEvent("wheel", { bubbles: true, deltaY: -120 })); });
    expect(useBookmarkStore.getState().transition).not.toBeNull();
  });
});

describe("what keeps the camera", () => {
  it("a flight into a saved viewpoint", () => {
    mount();
    startGlide({ ...ABOVE, id: "saved", kind: "reference" });
    act(() => { canvas().dispatchEvent(new WheelEvent("wheel", { bubbles: true, cancelable: true, deltaY: -120 })); });
    expect(pressAndRead({ pointerType: "mouse", button: 2, buttons: 2 })).toBe(false);
    expect(useBookmarkStore.getState().transition).not.toBeNull();
  });

  it("a tour", () => {
    mount();
    act(() => { useBookmarkStore.getState().startTour(buildShowcaseTour(dimensions)); });
    frame();
    const tour = useBookmarkStore.getState().tour;
    expect(tour).not.toBeNull();
    act(() => { canvas().dispatchEvent(new WheelEvent("wheel", { bubbles: true, cancelable: true, deltaY: -120 })); });
    expect(useBookmarkStore.getState().tour).not.toBeNull();
  });

  it("a suspended rig", () => {
    mount(<CameraRig dimensions={dimensions} suspended />);
    act(() => {
      useBookmarkStore.setState({ transition: { fromPosition: [0, 14, 18], fromTarget: [0, 0, 0], toPosition: [0, 30, 0.1], toTarget: [0, 0, 0], duration: 1, elapsed: 0 } });
    });
    act(() => { canvas().dispatchEvent(new WheelEvent("wheel", { bubbles: true, cancelable: true, deltaY: -120 })); });
    // A suspended rig clears pending moves itself; the wheel adds nothing of its own.
    expect(controls().enabled).toBe(false);
  });
});
