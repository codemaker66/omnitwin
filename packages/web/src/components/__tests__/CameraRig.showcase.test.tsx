import { act, cleanup, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PerspectiveCamera } from "three";
import type { OrbitControls as OrbitControlsImpl } from "three-stdlib";
import type { RootState } from "@react-three/fiber";
import { useBookmarkStore } from "../../stores/bookmark-store.js";
import { useCockpitStore } from "../../stores/cockpit-store.js";
import { useEditorStore } from "../../stores/editor-store.js";
import { buildPlannerShowcaseTour } from "../../lib/planner-showcase.js";
import { advanceCameraTour } from "../../lib/camera-tour.js";
import { GRAND_HALL_ARRIVAL } from "../../lib/planner-room-arrival.js";

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
    useThree: () => ({ camera: harness.camera, gl: { domElement: harness.canvas },
      invalidate: harness.invalidate, size: { width: 1200, height: 750 } }),
    useFrame: (callback: (state: RootState, delta: number) => void) => {
      React.useEffect(() => { harness.frames.add(callback); return () => { harness.frames.delete(callback); }; }, [callback]);
    },
  };
});
vi.mock("@react-three/drei", async () => {
  const React = await import("react");
  const { OrbitControls } = await import("three-stdlib");
  interface ControlProps { readonly target: [number, number, number]; readonly enableDamping: boolean;
    readonly minPolarAngle: number; readonly maxPolarAngle: number; readonly minDistance: number; readonly maxDistance: number }
  return { OrbitControls: React.forwardRef<OrbitControlsImpl, ControlProps>((props, ref) => {
    const controls = React.useMemo(() => {
      if (harness.camera === null || harness.canvas === null) throw new Error("Missing harness camera");
      return new OrbitControls(harness.camera, harness.canvas);
    }, []);
    React.useImperativeHandle(ref, () => controls, [controls]);
    React.useLayoutEffect(() => {
      controls.target.fromArray(props.target);
      controls.enableDamping = props.enableDamping;
      controls.minPolarAngle = props.minPolarAngle;
      controls.maxPolarAngle = props.maxPolarAngle;
      controls.minDistance = props.minDistance;
      controls.maxDistance = props.maxDistance;
      harness.controls = controls;
    }, [controls, props]);
    React.useEffect(() => () => { controls.dispose(); harness.controls = null; }, [controls]);
    return null;
  }) };
});

const { CameraRig } = await import("../CameraRig.js");
const dimensions = { width: 21, length: 10.5, height: 7 };
const source = { configId: "demo", spaceId: "hall", layerMode: "splat" as const,
  captureSource: "staged" as const, loadedChunks: 12, totalChunks: 12, proceduralGeometryVisible: false };

function tick(delta = 1 / 60): void {
  act(() => {
    // Mirrors Drei's earlier priority: enabled controls update before the rig.
    if (harness.controls?.enabled === true) harness.controls.update();
    for (const callback of harness.frames) callback({} as RootState, delta);
  });
}

beforeEach(() => {
  useCockpitStore.getState().reset();
  useEditorStore.getState().reset();
  useEditorStore.setState({ configId: "demo", space: { id: "hall", venueId: "venue",
    name: "Grand Hall", slug: "grand-hall", widthM: "21", lengthM: "10.5", heightM: "7", floorPlanOutline: [] } });
  useBookmarkStore.setState({ tour: null, transition: null, pendingNavigationId: null, activeReferenceId: null });
  useCockpitStore.setState({ sceneSource: source, layerMode: "splat" });
  harness.camera = new PerspectiveCamera(55, 1.6, 0.1, 200);
  harness.canvas = document.createElement("canvas");
  document.body.appendChild(harness.canvas);
  harness.frames.clear();
});
afterEach(() => { cleanup(); harness.canvas?.remove(); harness.frames.clear(); });

function startCapturedTour() {
  const tour = buildPlannerShowcaseTour({ dimensions, configId: "demo", spaceId: "hall",
    roomSlug: "grand-hall", layerMode: "splat", sceneSource: source });
  if (tour === null) throw new Error("Missing captured tour");
  act(() => { useBookmarkStore.getState().startTour(tour); });
  return tour;
}

describe("CameraRig Showcase owner handoff", () => {
  it("finishes at the interior arrival and keeps controls disabled through the next frame", () => {
    render(<CameraRig dimensions={dimensions} />);
    const tour = startCapturedTour();
    tick();
    for (const axis of [0, 1, 2] as const) expect(harness.camera?.position.getComponent(axis)).toBeCloseTo(GRAND_HALL_ARRIVAL.position[axis], 10);
    act(() => { useBookmarkStore.setState({ tour: advanceCameraTour(tour, tour.totalSec) }); });
    tick();
    expect(useBookmarkStore.getState().tour).toBeNull();
    expect(useCockpitStore.getState().walkMode).toBe(true);
    expect(harness.controls?.enabled).toBe(false);
    tick();
    for (const axis of [0, 1, 2] as const) expect(harness.camera?.position.getComponent(axis)).toBeCloseTo(GRAND_HALL_ARRIVAL.position[axis], 10);
    expect(harness.controls?.enabled).toBe(false);
  });

  it("Escape clears playback and yields to Interior; capture failure does not restore an unavailable owner", () => {
    render(<CameraRig dimensions={dimensions} />);
    startCapturedTour();
    tick();
    act(() => { window.dispatchEvent(new KeyboardEvent("keydown", { code: "Escape", bubbles: true })); });
    expect(useBookmarkStore.getState().tour).toBeNull();
    expect(useCockpitStore.getState().walkMode).toBe(true);
    tick();
    expect(harness.controls?.enabled).toBe(false);
    act(() => { useCockpitStore.getState().setWalkMode(false); });
    startCapturedTour();
    act(() => { useCockpitStore.setState({ sceneSource: { ...source, captureSource: "none" } }); });
    tick();
    expect(useBookmarkStore.getState().tour).toBeNull();
    expect(useCockpitStore.getState().walkMode).toBe(false);
  });
});
