import { act, cleanup, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PerspectiveCamera, Vector3 } from "three";
import { CANONICAL_LAYOUT_SNAPSHOT_V0_FIXTURE } from "@omnitwin/types";
import { frozenLayoutRoomModel } from "../../lib/frozen-layout-room.js";
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
  size: { width: 1200, height: 750 },
}));

vi.mock("@react-three/fiber", async () => {
  const React = await import("react");
  return {
    useThree: () => ({ camera: harness.camera, gl: { domElement: harness.canvas },
      controls: harness.controls, invalidate: harness.invalidate, size: harness.size }),
    useFrame: (callback: (state: RootState, delta: number) => void) => {
      React.useEffect(() => { harness.frames.add(callback); return () => { harness.frames.delete(callback); }; }, [callback]);
    },
  };
});
vi.mock("@react-three/drei", async () => {
  const React = await import("react");
  const { OrbitControls } = await import("three-stdlib");
  interface ControlProps { readonly target?: [number, number, number]; readonly enabled?: boolean; readonly enableDamping: boolean;
    readonly minPolarAngle: number; readonly maxPolarAngle: number; readonly minDistance: number; readonly maxDistance: number }
  return { OrbitControls: React.forwardRef<OrbitControlsImpl, ControlProps>((props, ref) => {
    const controls = React.useMemo(() => {
      if (harness.camera === null || harness.canvas === null) throw new Error("Missing harness camera");
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
const { FrozenLayoutPreviewCamera, fitFrozenLayoutPreviewCamera, readFrozenPreviewViewport } = await import("../editor/FrozenLayoutPreviewCamera.js");
const frozenRoom = frozenLayoutRoomModel(CANONICAL_LAYOUT_SNAPSHOT_V0_FIXTURE.venueRuntime);
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
  harness.size = { width: 1200, height: 750 };
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
  it("suspends live input and stale commands, fits frozen bounds, then restores the live lens and pose", () => {
    const view = render(<><CameraRig dimensions={dimensions} /><FrozenLayoutPreviewCamera active={false} room={null} /></>);
    const camera = harness.camera;
    const controls = harness.controls;
    if (camera === null || controls === null || harness.canvas === null) throw new Error("Missing camera");
    camera.position.set(0.4, 1.6, 7.5);
    camera.rotation.set(0.0784, 0.0286, 0, "YXZ");
    camera.fov = 61;
    camera.zoom = 1.2;
    camera.filmOffset = 0.4;
    camera.updateProjectionMatrix();
    controls.target.set(0.17, 2.23, -0.47);
    const original = camera.clone();
    const originalTarget = controls.target.clone();
    act(() => { useCockpitStore.getState().setWalkMode(true); });
    startCapturedTour();
    view.rerender(<><CameraRig dimensions={dimensions} suspended /><FrozenLayoutPreviewCamera active room={frozenRoom} /></>);
    expect(useBookmarkStore.getState().tour).toBeNull();
    const overview = camera.position.clone();
    expect(overview.y).toBeGreaterThan(frozenRoom.geometry.ceilingHeight);
    act(() => {
      harness.canvas?.dispatchEvent(new WheelEvent("wheel", { deltaY: 100 }));
      window.dispatchEvent(new KeyboardEvent("keydown", { code: "KeyW" }));
      useBookmarkStore.setState({ pendingNavigationId: "stale", tour: buildPlannerShowcaseTour({
        dimensions, configId: "demo", spaceId: "hall", roomSlug: "grand-hall", layerMode: "splat", sceneSource: source,
      }) });
    });
    tick();
    expect(camera.position.equals(overview)).toBe(true);
    expect(useBookmarkStore.getState().tour).toBeNull();
    expect(useBookmarkStore.getState().pendingNavigationId).toBeNull();
    expect(controls.enabled).toBe(false);
    view.rerender(<><CameraRig dimensions={dimensions} /><FrozenLayoutPreviewCamera active={false} room={null} /></>);
    expect(camera.position.distanceTo(original.position)).toBeLessThan(1e-10);
    expect(camera.quaternion.angleTo(original.quaternion)).toBeLessThan(1e-7);
    expect(controls.target.equals(originalTarget)).toBe(true);
    expect(camera.fov).toBe(61);
    expect(camera.zoom).toBe(1.2);
    expect(camera.filmOffset).toBe(0.4);
    tick();
    expect(camera.position.distanceTo(original.position)).toBeLessThan(1e-10);
  });

  it("keeps a null gap blank, reframes on resize and restores without a live-room default-pose reset", () => {
    const view = render(<><CameraRig dimensions={dimensions} /><FrozenLayoutPreviewCamera active={false} room={null} /></>);
    const camera = harness.camera;
    if (camera === null) throw new Error("Missing camera");
    const original = camera.clone();
    view.rerender(<><CameraRig dimensions={dimensions} suspended /><FrozenLayoutPreviewCamera active room={null} /></>);
    expect(camera.position.distanceTo(original.position)).toBeLessThan(1e-10);
    harness.size = { width: 390, height: 844 };
    view.rerender(<><CameraRig dimensions={dimensions} suspended /><FrozenLayoutPreviewCamera active room={frozenRoom} /></>);
    for (const [x, z] of frozenRoom.geometry.wallPolygon) for (const y of [0, frozenRoom.geometry.ceilingHeight]) {
      const projected = new Vector3(x, y, z).project(camera);
      expect(Math.abs(projected.x)).toBeLessThan(1);
      expect(Math.abs(projected.y)).toBeLessThan(1);
      expect(projected.z).toBeGreaterThan(-1);
      expect(projected.z).toBeLessThan(1);
    }
    view.rerender(<><CameraRig dimensions={dimensions} /><FrozenLayoutPreviewCamera active={false} room={null} /></>);
    expect(camera.position.distanceTo(original.position)).toBeLessThan(1e-10);
    expect(camera.aspect).toBeCloseTo(390 / 844);
    expect(camera.fov).toBe(original.fov);
  });

  it("fits the actual polygon when declared dimensions understate its envelope", () => {
    const camera = new PerspectiveCamera(45, 390 / 844, 0.1, 200);
    const room = { ...frozenRoom, geometry: { ...frozenRoom.geometry,
      wallPolygon: [[-50, -2], [50, -2], [50, 2], [-50, 2]] as const } };
    fitFrozenLayoutPreviewCamera(camera, room);
    for (const [x, z] of room.geometry.wallPolygon) for (const y of [0, room.geometry.ceilingHeight]) {
      const projected = new Vector3(x, y, z).project(camera);
      expect(Math.abs(projected.x)).toBeLessThan(1);
      expect(Math.abs(projected.y)).toBeLessThan(1);
    }
  });

  it("places frozen bounds inside the measured visible canvas between docks and timeline", () => {
    const canvas = harness.canvas;
    if (canvas === null) throw new Error("Missing canvas");
    const shell = document.createElement("div");
    shell.className = "cockpit-shell";
    document.body.appendChild(shell);
    shell.appendChild(canvas);
    const width = 1327, height = 747;
    vi.spyOn(canvas, "getBoundingClientRect").mockReturnValue(new DOMRect(0, 0, width, height));
    function dock(className: string, x: number, y: number, w: number, h: number): HTMLElement {
      const element = document.createElement("div");
      element.className = className;
      vi.spyOn(element, "getBoundingClientRect").mockReturnValue(new DOMRect(x, y, w, h));
      shell.appendChild(element);
      return element;
    }
    dock("reference-left-dock", 12, 14, 260, 400);
    const inspector = dock("reference-inspector-dock", 1065, 14, 248, 330);
    dock("cockpit-bottom", 12, 441, 1301, 292);
    dock("planner-tool-pill", 440, 21, 450, 48);
    const caption = dock("layout-timeline-preview-caption", 400, height - 16 - 48, 500, 48);
    try {
      const viewport = readFrozenPreviewViewport(canvas, width, height);
      expect(viewport).toMatchObject({ left: 280, top: 77, width: 777, height: 356 });
      const camera = new PerspectiveCamera(45, width / height, 0.1, 200);
      fitFrozenLayoutPreviewCamera(camera, frozenRoom, viewport);
      for (const [x, z] of frozenRoom.geometry.wallPolygon) for (const y of [0, frozenRoom.geometry.ceilingHeight]) {
        const point = new Vector3(x, y, z).project(camera);
        const screenX = (point.x + 1) * width / 2;
        const screenY = (1 - point.y) * height / 2;
        expect(screenX).toBeGreaterThan(viewport.left);
        expect(screenX).toBeLessThan(viewport.left + viewport.width);
        expect(screenY).toBeGreaterThan(viewport.top);
        expect(screenY).toBeLessThan(viewport.top + viewport.height);
      }
      inspector.style.display = "none";
      expect(readFrozenPreviewViewport(canvas, width, height).width).toBe(width - viewport.left);
      vi.spyOn(caption, "getBoundingClientRect").mockReturnValue(new DOMRect(400, 380, 500, 48));
      expect(readFrozenPreviewViewport(canvas, width, height)).toMatchObject({ top: 77, height: 295 });
    } finally { document.body.appendChild(canvas); shell.remove(); }
  });

  it.each([false, true])("reconciles live walkMode changed from %s during suspension", (initialWalk) => {
    const view = render(<><CameraRig dimensions={dimensions} /><FrozenLayoutPreviewCamera active={false} room={null} /></>);
    const camera = harness.camera;
    if (camera === null) throw new Error("Missing camera");
    const plannerPosition = camera.position.clone();
    if (initialWalk) {
      act(() => { useCockpitStore.getState().setWalkMode(true); });
      camera.position.set(0.4, 1.6, 7.5);
    }
    view.rerender(<><CameraRig dimensions={dimensions} suspended /><FrozenLayoutPreviewCamera active room={frozenRoom} /></>);
    act(() => { useCockpitStore.getState().setWalkMode(!initialWalk); });
    const previewPosition = camera.position.clone();
    tick();
    expect(camera.position.equals(previewPosition)).toBe(true);
    view.rerender(<><CameraRig dimensions={dimensions} /><FrozenLayoutPreviewCamera active={false} room={null} /></>);
    tick();
    expect(harness.controls?.enabled).toBe(initialWalk);
    expect(camera.position.distanceTo(plannerPosition)).toBeLessThan(1e-8);
  });

  it("restores on unmount but never restores another live configuration's old camera", () => {
    const camera = harness.camera;
    if (camera === null) throw new Error("Missing camera");
    camera.position.set(0.4, 1.6, 7.5);
    const initial = camera.position.clone();
    const first = render(<FrozenLayoutPreviewCamera active room={frozenRoom} />);
    first.unmount();
    expect(camera.position.equals(initial)).toBe(true);
    const second = render(<FrozenLayoutPreviewCamera active room={frozenRoom} />);
    act(() => { useEditorStore.setState({ configId: "another-document" }); });
    camera.position.set(10, 20, 30);
    second.rerender(<FrozenLayoutPreviewCamera active={false} room={null} />);
    expect(camera.position.toArray()).toEqual([10, 20, 30]);
  });

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
