import { act, cleanup, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PerspectiveCamera, Vector3 } from "three";
import type { OrbitControls as OrbitControlsImpl } from "three-stdlib";
import type { RootState } from "@react-three/fiber";
import { CANONICAL_LAYOUT_SNAPSHOT_V0_FIXTURE } from "@omnitwin/types";
import { frozenLayoutRoomModel } from "../../lib/frozen-layout-room.js";
import { GRAND_HALL_ARRIVAL } from "../../lib/planner-room-arrival.js";
import { useBookmarkStore } from "../../stores/bookmark-store.js";
import { useCockpitStore } from "../../stores/cockpit-store.js";
import { useEditorStore } from "../../stores/editor-store.js";
import { useRoomDimensionsStore } from "../../stores/room-dimensions-store.js";
import { useLayoutTimelinePreviewStore } from "../../stores/layout-timeline-preview-store.js";

const harness = vi.hoisted(() => ({
  camera: null as PerspectiveCamera | null,
  canvas: null as HTMLCanvasElement | null,
  controls: null as OrbitControlsImpl | null,
  frames: new Set<(state: RootState, delta: number) => void>(),
  invalidate: vi.fn(),
  size: { width: 390, height: 844 },
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
vi.mock("@react-three/drei", async () => {
  const React = await import("react");
  const { OrbitControls } = await import("three-stdlib");
  interface ControlProps {
    readonly target?: [number, number, number]; readonly enabled?: boolean; readonly enableDamping: boolean;
    readonly minPolarAngle: number; readonly maxPolarAngle: number; readonly minDistance: number; readonly maxDistance: number;
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
const { CockpitPlanningCamera } = await import("../editor/CockpitPlanningCamera.js");
const { FrozenLayoutPreviewCamera } = await import("../editor/FrozenLayoutPreviewCamera.js");
const dimensions = { width: 21, length: 10.5, height: 7 };
const frozenRoom = frozenLayoutRoomModel(CANONICAL_LAYOUT_SNAPSHOT_V0_FIXTURE.venueRuntime);

// Matches PlannerScene: the Flow owner stays mounted while preview suspends it.
function CameraOwners({ preview = false, failed = false }: { readonly preview?: boolean; readonly failed?: boolean }) {
  return <>
    <CockpitPlanningCamera dimensionsOverride={dimensions} suspended={preview} />
    <CameraRig dimensions={dimensions} suspended={preview} captureUnavailableKey={failed ? "hall:failed" : null} />
    <FrozenLayoutPreviewCamera active={preview} room={preview ? frozenRoom : null} />
  </>;
}
function tick(): void {
  act(() => {
    if (harness.controls?.enabled === true) harness.controls.update();
    for (const callback of harness.frames) callback({} as RootState, 1 / 60);
  });
}
function assertRoomFramed(): void {
  const camera = harness.camera;
  if (camera === null) throw new Error("Missing camera fixture");
  camera.updateMatrixWorld();
  for (const x of [-dimensions.width / 2, dimensions.width / 2]) {
    for (const y of [0, dimensions.height]) {
      for (const z of [-dimensions.length / 2, dimensions.length / 2]) {
        const corner = new Vector3(x, y, z).project(camera);
        expect(Math.abs(corner.x), `Room corner ${String(x)},${String(y)},${String(z)}: horizontal framing`).toBeLessThan(0.81);
        expect(Math.abs(corner.y), `Room corner ${String(x)},${String(y)},${String(z)}: vertical framing`).toBeLessThan(0.81);
      }
    }
  }
}
beforeEach(() => {
  useLayoutTimelinePreviewStore.getState().clear();
  useCockpitStore.getState().reset();
  useEditorStore.getState().reset();
  useEditorStore.setState({ configId: "flow-recovery", space: { id: "hall", venueId: "venue",
    name: "Grand Hall", slug: "grand-hall", widthM: "21", lengthM: "10.5", heightM: "7", floorPlanOutline: [] } });
  useBookmarkStore.setState({ tour: null, transition: null, pendingNavigationId: null, activeReferenceId: null });
  useCockpitStore.setState({ layerMode: "splat" });
  useRoomDimensionsStore.getState().setDimensions(dimensions);
  harness.camera = new PerspectiveCamera(55, 390 / 844, 0.1, 200);
  harness.canvas = document.createElement("canvas");
  document.body.appendChild(harness.canvas);
  harness.frames.clear();
});
afterEach(() => {
  cleanup();
  harness.canvas?.remove();
  harness.frames.clear();
  useLayoutTimelinePreviewStore.getState().clear();
});

describe("capture fallback with all planner camera owners", () => {
  it("keeps the whole room framed after a failed Interior capture and a frozen-preview return", () => {
    const view = render(<CameraOwners />);
    act(() => { useCockpitStore.getState().setWalkMode(true); });
    harness.camera?.position.fromArray(GRAND_HALL_ARRIVAL.position);
    act(() => { useCockpitStore.getState().setMode("flow"); });
    expect(useCockpitStore.getState().walkMode).toBe(true);
    act(() => { useLayoutTimelinePreviewStore.getState().showScheduleGap("Room change"); });
    view.rerender(<CameraOwners preview />);
    const frozenPosition = harness.camera?.position.clone();
    view.rerender(<CameraOwners preview failed />);
    expect(useCockpitStore.getState().walkMode).toBe(false);
    expect(harness.camera?.position.equals(frozenPosition ?? new Vector3())).toBe(true);
    act(() => { useLayoutTimelinePreviewStore.getState().clear(); });
    view.rerender(<CameraOwners failed />);
    // Check both the handoff and later frames for an unintended lens camera replay.
    assertRoomFramed();
    for (let frame = 0; frame < 180; frame++) tick();
    assertRoomFramed();
    expect(harness.controls?.enabled).toBe(true);
  });
  it("restores an ordinary Interior preview without moving an unchanged Flow lens", () => {
    const view = render(<CameraOwners />);
    act(() => { useCockpitStore.getState().setWalkMode(true); });
    harness.camera?.position.fromArray(GRAND_HALL_ARRIVAL.position);
    act(() => { useCockpitStore.getState().setMode("flow"); });
    const interiorPosition = harness.camera?.position.clone();
    act(() => { useLayoutTimelinePreviewStore.getState().showScheduleGap("Room change"); });
    view.rerender(<CameraOwners preview />);
    act(() => { useLayoutTimelinePreviewStore.getState().clear(); });
    view.rerender(<CameraOwners />);
    for (let frame = 0; frame < 180; frame++) tick();
    expect(useCockpitStore.getState().walkMode).toBe(true);
    expect(harness.camera?.position.equals(interiorPosition ?? new Vector3())).toBe(true);
    expect(harness.controls?.enabled).toBe(false);
  });
  it("consumes Flow selected during preview and honours a fresh Flow choice afterwards", () => {
    const view = render(<CameraOwners />);
    tick(); // Let ordinary OrbitControls settle before saving the pre-Interior pose.
    const ordinaryPosition = harness.camera?.position.clone();
    act(() => { useCockpitStore.getState().setWalkMode(true); });
    harness.camera?.position.fromArray(GRAND_HALL_ARRIVAL.position);
    act(() => { useLayoutTimelinePreviewStore.getState().showScheduleGap("Room change"); });
    view.rerender(<CameraOwners preview />);
    view.rerender(<CameraOwners preview failed />);
    act(() => { useCockpitStore.getState().setMode("flow"); });
    act(() => { useLayoutTimelinePreviewStore.getState().clear(); });
    view.rerender(<CameraOwners failed />);
    for (let frame = 0; frame < 180; frame++) tick();
    expect(harness.camera?.position.distanceTo(ordinaryPosition ?? new Vector3())).toBeLessThan(1e-8);
    const restoredPosition = harness.camera?.position.clone();
    act(() => { useCockpitStore.getState().setMode("design"); });
    act(() => { useCockpitStore.getState().setMode("flow"); });
    for (let frame = 0; frame < 180; frame++) tick();
    expect(useCockpitStore.getState().walkMode).toBe(false);
    expect(harness.camera?.position.distanceTo(restoredPosition ?? new Vector3())).toBeGreaterThan(1);
    expect(harness.camera?.position.y).toBeGreaterThan(dimensions.height);
  });
});
