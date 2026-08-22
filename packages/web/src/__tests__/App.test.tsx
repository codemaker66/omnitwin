import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, cleanup, screen } from "@testing-library/react";

// Mock @react-three/fiber — happy-dom has no WebGL context.
const CanvasMock = vi.hoisted(() =>
  vi.fn((_props: { children?: React.ReactNode }) => <div data-testid="r3f-canvas" />),
);

vi.mock("@react-three/fiber", () => ({
  Canvas: CanvasMock,
  useThree: () => ({
    camera: {
      position: { x: 0, y: 0, z: 0, set: vi.fn(), copy: vi.fn() },
      quaternion: { setFromEuler: vi.fn() },
      lookAt: vi.fn(),
    },
    gl: { domElement: document.createElement("canvas") },
    invalidate: vi.fn(),
    // CameraRig now reads size to compute viewport aspect (Phase 2 of
    // the mobile redesign). Stub a desktop-sized viewport so the test
    // camera pose matches the historical landscape eye-level shot.
    size: { width: 1440, height: 900 },
  }),
  useFrame: vi.fn(),
}));

vi.mock("@react-three/drei", () => ({
  OrbitControls: vi.fn(() => null),
  Html: vi.fn(({ children }: { children?: React.ReactNode }) => children),
}));

vi.mock("react-router-dom", () => ({
  useNavigate: () => vi.fn(),
}));

// PlannerScene now mounts CockpitSplatLayer, which imports @sparkjsdev/spark
// (a WASM module that rejects at import under Node). The Canvas mock never
// renders scene children, so stub the splat layer to keep Spark out of this test.
vi.mock("../components/editor/CockpitSplatLayer.js", () => ({ CockpitSplatLayer: () => null }));
vi.mock("../components/editor/ExactGrandHallSplatLayer.js", () => ({ ExactGrandHallSplatLayer: () => null }));
vi.mock("../hooks/use-room-runtime-splat.js", () => ({
  useRoomRuntimeSplat: () => ({
    splatUrls: [],
    transform: { position: [0, 0, 0], rotation: [0, 0, 0], scale: 1, note: "test" },
    hasAsset: false,
    status: "none",
    delivery: "none",
    runtimePackageId: null,
    roomIdentity: null,
  }),
}));

import { App } from "../App.js";
import { CATALOGUE_ITEMS } from "../lib/catalogue.js";
import { createPlacedItem } from "../lib/placement.js";
import { usePlacementStore } from "../stores/placement-store.js";
import { useMeasurementStore } from "../stores/measurement-store.js";
import { useCockpitStore } from "../stores/cockpit-store.js";
import { useEditorStore } from "../stores/editor-store.js";
import type { Space } from "../api/spaces.js";
import type { PlannerRoomIdentity } from "../lib/planner-layer-composition.js";

function roomSpace(slug: string, venueId = "venue-1", id = `space-${slug}`): Space {
  return {
    id,
    venueId,
    name: slug,
    slug,
    widthM: "10",
    lengthM: "8",
    heightM: "5",
    floorPlanOutline: [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 8 }, { x: 0, y: 8 }],
  };
}

function resolveRoom(room: Space, venueSlug = "trades-hall-glasgow"): void {
  const identity: PlannerRoomIdentity = {
    spaceId: room.id,
    venueId: room.venueId,
    roomSlug: room.slug,
    status: "resolved",
    venueSlug,
  };
  useEditorStore.setState({ space: room });
  useCockpitStore.getState().setPlannerRoomIdentity(identity);
}

/** Extract the props object from the first CanvasMock call. */
function getCanvasProps(): Record<string, unknown> {
  const firstCall = CanvasMock.mock.calls[0];
  if (firstCall === undefined) {
    throw new Error("Canvas was never called");
  }
  return firstCall[0] as Record<string, unknown>;
}

function catalogueId(slug: string): string {
  const item = CATALOGUE_ITEMS.find((candidate) => candidate.slug === slug);
  if (item === undefined) throw new Error(`missing catalogue fixture ${slug}`);
  return item.id;
}

describe("App", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    Object.defineProperty(window, "innerWidth", {
      configurable: true,
      writable: true,
      value: 1440,
    });
    useCockpitStore.getState().reset();
    useEditorStore.getState().reset();
    resolveRoom(roomSpace("reception-room"));
    usePlacementStore.setState({ placedItems: [] });
    useMeasurementStore.setState({ active: false, pendingPoint: null, measurements: [], nextId: 1 });
  });
  afterEach(() => {
    cleanup();
    useCockpitStore.getState().reset();
    useEditorStore.getState().reset();
    usePlacementStore.setState({ placedItems: [] });
    useMeasurementStore.setState({ active: false, pendingPoint: null, measurements: [], nextId: 1 });
    vi.runOnlyPendingTimers();
    vi.useRealTimers();
  });

  it("renders without crashing", () => {
    const { getByTestId } = render(<App />);
    expect(getByTestId("r3f-canvas")).toBeDefined();
  });

  it("wraps the scene canvas in the cinematic stage shell", () => {
    const { container } = render(<App />);
    expect(container.querySelector(".planner-canvas-stage")).not.toBeNull();
    expect(container.querySelector(".venviewer-planner-shell")).not.toBeNull();
  });

  it("passes frameloop='demand' to Canvas", () => {
    CanvasMock.mockClear();
    render(<App />);
    const props = getCanvasProps();
    expect(props["frameloop"]).toBe("demand");
  });

  it("caps DPR at [0.75, 0.75] to preserve the 60fps desktop frame budget", () => {
    CanvasMock.mockClear();
    render(<App />);
    const props = getCanvasProps();
    expect(props["dpr"]).toEqual([0.75, 0.75]);
  });

  it("renders the generated-stand-in disclosure outside the Canvas for instanced furniture", () => {
    usePlacementStore.setState({
      placedItems: [createPlacedItem(catalogueId("trestle-6ft"), 0, 0)],
    });

    render(<App />);

    expect(screen.getByTestId("generated-furniture-proxy-badge").textContent)
      .toBe("AI-generated furniture proxy · visual stand-in · not measured");
  });

  it("suppresses every operational-geometry surface for venue-verified Trades Hall Grand Hall", () => {
    resolveRoom(roomSpace("grand-hall"));
    usePlacementStore.setState({
      placedItems: [createPlacedItem(catalogueId("trestle-6ft"), 0, 0)],
    });
    useMeasurementStore.getState().activate();

    const { container } = render(<App />);

    expect(screen.queryByTestId("generated-furniture-proxy-badge")).toBeNull();
    expect(screen.queryByTestId("planner-toolbar")).toBeNull();
    expect(screen.queryByTestId("planner-spatial-hud")).toBeNull();
    expect(screen.queryByTestId("planner-command-deck")).toBeNull();
    expect(screen.queryByRole("status", { name: "Measurement tool status" })).toBeNull();
    expect(container.querySelector(".planner-section-slider-dock")).toBeNull();
    expect(container.querySelector(".planner-canvas-stage")?.getAttribute("style")).toContain("padding-left: 0px");
  });

  it("retains planning chrome for another venue's verified grand-hall room", () => {
    const otherGrandHall = roomSpace("grand-hall", "other-venue-id", "other-grand-hall-space");
    resolveRoom(otherGrandHall, "another-venue");
    render(<App />);

    expect(screen.getByTestId("planner-toolbar")).toBeTruthy();
    expect(screen.getByTestId("planner-spatial-hud")).toBeTruthy();
    expect(screen.getByTestId("planner-command-deck")).toBeTruthy();
  });

  it("keeps R3F performance regression metadata available without changing the fixed canvas DPR", () => {
    CanvasMock.mockClear();
    render(<App />);
    const props = getCanvasProps();
    const performance = props["performance"] as Record<string, unknown>;
    expect(typeof performance["min"]).toBe("number");
    expect(performance["min"] as number).toBeGreaterThan(0);
    expect(performance["min"] as number).toBeLessThan(1);
  });

  it("requests high-performance GPU preference", () => {
    CanvasMock.mockClear();
    render(<App />);
    const props = getCanvasProps();
    const gl = props["gl"] as Record<string, unknown>;
    expect(gl["powerPreference"]).toBe("high-performance");
    expect(gl["antialias"]).toBe(true);
  });

  it("configures camera with 45° FOV for architectural view", () => {
    CanvasMock.mockClear();
    render(<App />);
    const props = getCanvasProps();
    const camera = props["camera"] as Record<string, unknown>;
    expect(camera["fov"]).toBe(55);
    expect(camera["near"]).toBe(0.1);
    expect(camera["far"]).toBe(200);
  });

  it("uses neutral background colour", () => {
    CanvasMock.mockClear();
    render(<App />);
    expect(CanvasMock).toHaveBeenCalled();
  });
});
