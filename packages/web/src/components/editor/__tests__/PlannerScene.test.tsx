import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, render, waitFor } from "@testing-library/react";
import { readFile } from "node:fs/promises";
import { CANONICAL_LAYOUT_SNAPSHOT_V0_FIXTURE, SpaceSchema } from "@omnitwin/types";
import { Children, isValidElement, type ReactElement, type ReactNode } from "react";

type CanvasMockProps = Readonly<{
  dpr?: unknown;
  frameloop?: unknown;
  children?: ReactNode;
}>;
const canvasChildren = vi.hoisted(() => ({ current: null as ReactNode }));

// Mock the R3F Canvas to render an empty host div: the scene children are
// constructed as React elements but never mounted, so their useThree/useFrame
// hooks don't run outside a real Canvas. This keeps the test a structural
// smoke test that PlannerScene mounts its canvas host.
vi.mock("@react-three/fiber", () => ({
  Canvas: ({ dpr, frameloop, children }: CanvasMockProps) => {
    canvasChildren.current = children;
    return (
    <div
      data-testid="r3f-canvas"
      data-dpr={JSON.stringify(dpr)}
      data-frameloop={typeof frameloop === "string" ? frameloop : ""}
    />
    );
  },
}));

// CockpitSplatLayer pulls in @sparkjsdev/spark, which instantiates a WASM
// module at import time and rejects under Node's test environment. Mock it so
// the splat renderer is never imported. (It sits inside the mocked Canvas and
// never mounts here — chunk-arrival semantics are covered by
// use-chunk-arrivals.test.ts, and the real callback plumbing by the
// plan-room-resolve e2e, which streams actual chunks.)
vi.mock("../CockpitSplatLayer.js", () => ({ CockpitSplatLayer: () => null }));

const splatHookMock = vi.hoisted(() => ({ useRoomRuntimeSplat: vi.fn() }));
vi.mock("../../../hooks/use-room-runtime-splat.js", () => splatHookMock);
const arrivals = vi.hoisted(() => ({ loadedCount: 0, failedCount: 0, markLoaded: vi.fn(), markFailed: vi.fn() }));
vi.mock("../../../hooks/use-chunk-arrivals.js", () => ({ useChunkArrivals: () => arrivals }));

const IDENTITY_TRANSFORM = {
  position: [0, 0, 0] as const,
  rotation: [0, 0, 0] as const,
  scale: 1,
  note: "identity",
};

function mockSplat(overrides: {
  splatUrls?: readonly string[];
  hasAsset?: boolean;
  status?: "none" | "loading" | "loaded";
  roomSlug?: string;
  source?: "staged" | "package" | "none";
} = {}): void {
  splatHookMock.useRoomRuntimeSplat.mockReturnValue({
    splatUrls: overrides.splatUrls ?? [],
    transform: IDENTITY_TRANSFORM,
    hasAsset: overrides.hasAsset ?? false,
    status: overrides.status ?? "none",
    roomSlug: overrides.roomSlug ?? null,
    source: overrides.source ?? (overrides.hasAsset === true ? "staged" : "none"),
  });
}

const {
  PlannerScene,
  plannerCanvasGlOptions,
  shouldRenderPlannerSceneOverlays,
  shouldUseSmoothPlannerControls,
} = await import("../PlannerScene.js");
const { useCockpitStore } = await import("../../../stores/cockpit-store.js");
const { useEditorStore } = await import("../../../stores/editor-store.js");
const { useBookmarkStore } = await import("../../../stores/bookmark-store.js");
const { recordPlannerArrivalChoice } = await import("../../../lib/planner-room-arrival.js");
const { useLayoutTimelinePreviewStore } = await import("../../../stores/layout-timeline-preview-store.js");
const { frozenLayoutRoomModel } = await import("../../../lib/frozen-layout-room.js");

function sceneElements(children: ReactNode = canvasChildren.current): ReactElement<Record<string, unknown>>[] {
  return Children.toArray(children).flatMap((child) => {
    if (!isValidElement<Record<string, unknown>>(child)) return [];
    return [child, ...sceneElements((child.props.children ?? null) as ReactNode)];
  });
}
function sceneComponent(name: string): ReactElement<Record<string, unknown>> | undefined {
  return sceneElements().find((child) => typeof child.type === "function" && child.type.name === name);
}
function namedSceneNode(name: string): ReactElement<Record<string, unknown>> | undefined {
  return sceneElements().find((child) => child.props.name === name);
}

beforeEach(() => {
  useCockpitStore.getState().reset();
  useEditorStore.setState({ space: null, configId: null });
  useBookmarkStore.setState({ pendingNavigationId: null, activeReferenceId: null, transition: null, tour: null });
  useLayoutTimelinePreviewStore.getState().clear();
  arrivals.loadedCount = 0;
  arrivals.failedCount = 0;
  mockSplat();
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("PlannerScene", () => {
  it("starts at native device resolution on a compact viewport", () => {
    const oldDpr = window.devicePixelRatio;
    const oldWidth = window.innerWidth;
    Object.defineProperty(window, "devicePixelRatio", { value: 3, configurable: true });
    Object.defineProperty(window, "innerWidth", { value: 390, configurable: true });
    try {
      const { getByTestId } = render(<PlannerScene />);
      expect(getByTestId("r3f-canvas").getAttribute("data-dpr")).toBe("3");
    } finally {
      Object.defineProperty(window, "devicePixelRatio", { value: oldDpr, configurable: true });
      Object.defineProperty(window, "innerWidth", { value: oldWidth, configurable: true });
    }
  });

  it("mounts an R3F canvas host", () => {
    const { container, getByTestId } = render(<PlannerScene />);
    expect(container.querySelector(".planner-scene-canvas-host")).not.toBeNull();
    expect(getByTestId("r3f-canvas")).toBeTruthy();
  });

  it("enables planner canvas antialiasing independent of viewport width", () => {
    // preserveDrawingBuffer is the C2 dev-only capture aid (?capture=1);
    // outside that flag it is always the explicit false below.
    expect(plannerCanvasGlOptions()).toEqual({
      antialias: true,
      powerPreference: "high-performance",
      preserveDrawingBuffer: false,
    });
  });

  it("disables smooth planner camera controls on mobile and tablet viewports", () => {
    expect(shouldUseSmoothPlannerControls(390)).toBe(false);
    expect(shouldUseSmoothPlannerControls(768)).toBe(false);
    expect(shouldUseSmoothPlannerControls(1024)).toBe(false);
    expect(shouldUseSmoothPlannerControls(1440)).toBe(true);
  });

  it("omits animated cockpit scene overlays on mobile and tablet planner viewports", () => {
    expect(shouldRenderPlannerSceneOverlays(390)).toBe(false);
    expect(shouldRenderPlannerSceneOverlays(768)).toBe(false);
    expect(shouldRenderPlannerSceneOverlays(1024)).toBe(false);
    expect(shouldRenderPlannerSceneOverlays(1440)).toBe(true);
  });

  it("precompiles the planner scene so shader setup stays in the load window", async () => {
    const source = await readFile("src/components/editor/PlannerScene.tsx", "utf8");

    expect(source).toContain("function PlannerScenePrecompiler");
    expect(source).toContain("await gl.compileAsync(scene, camera)");
    expect(source).toContain("gl.compile(scene, camera)");
    expect(source).toContain("<PlannerScenePrecompiler signature={sceneWarmupSignature} />");
  });

});

// CARD A2: the resolve choreography — PlannerScene derives the phase from the
// runtime-splat state plus chunk arrivals and publishes it to the cockpit
// store for the caption and the stage's honesty attribute.
describe("PlannerScene resolve phase wiring", () => {
  it("replaces current architecture with the frozen coordinate frame and restores the live scene on exit", () => {
    chooseGrandHall(); readyGrandHall();
    arrivals.loadedCount = 1;
    render(<PlannerScene />);
    const originalSpace = useEditorStore.getState().space;
    const runtime = CANONICAL_LAYOUT_SNAPSHOT_V0_FIXTURE.venueRuntime;
    const frame = { id: "frozen", eventId: "event", eventName: "Event", phaseId: "phase", phaseName: "Ceremony", startsAt: null, endsAt: null, venueRuntime: runtime };
    expect(namedSceneNode("live-room-capture")?.props.visible).toBe(true);
    act(() => { useLayoutTimelinePreviewStore.getState().settle(frame, []); });
    expect(sceneComponent("FrozenLayoutRoom")?.props.room).toEqual(frozenLayoutRoomModel(runtime));
    expect(namedSceneNode("planner-furniture-frame")?.props.position).toEqual([-10.5, 0, -5.25]);
    expect(namedSceneNode("live-room-capture")?.props.visible).toBe(false);
    expect(sceneComponent("CockpitSplatLayer")?.props.active).toBe(false);
    expect(sceneComponent("CameraRig")?.props.suspended).toBe(true);
    expect(sceneComponent("FrozenLayoutPreviewCamera")?.props).toMatchObject({ active: true, room: frozenLayoutRoomModel(runtime) });
    for (const name of ["RoomMesh", "GrandHallRoom", "InkArchitectureLayer", "SectionPlane", "SelectionSystem", "PlannerMotionOverlayLayers", "PlacementGhost", "CockpitCameraFocus", "CockpitPlanningCamera"]) {
      expect(sceneComponent(name), name).toBeUndefined();
    }
    expect(useCockpitStore.getState().sceneSource).toMatchObject({ captureSource: "none", loadedChunks: 0, totalChunks: 0, proceduralGeometryVisible: true });
    expect(useEditorStore.getState().space).toBe(originalSpace);
    act(() => { useLayoutTimelinePreviewStore.getState().clear(); });
    expect(sceneComponent("FrozenLayoutRoom")).toBeUndefined();
    expect(sceneComponent("CameraRig")?.props.suspended).toBe(false);
    expect(namedSceneNode("planner-furniture-frame")?.props.position).toEqual([0, 0, 0]);
    expect(namedSceneNode("live-room-capture")?.props.visible).toBe(true);
    expect(sceneComponent("SelectionSystem")).toBeDefined();
    expect(useCockpitStore.getState().sceneSource).toMatchObject({ captureSource: "staged", loadedChunks: 1 });
  });

  it.each(["schedule-gap", "unavailable"])("shows no current or frozen room for a %s", (mode) => {
    chooseGrandHall(); readyGrandHall();
    render(<PlannerScene />);
    act(() => {
      if (mode === "schedule-gap") useLayoutTimelinePreviewStore.getState().showScheduleGap("Room flip");
      else useLayoutTimelinePreviewStore.getState().showPending("Frozen layout unavailable");
    });
    expect(sceneComponent("FrozenLayoutRoom")).toBeUndefined();
    expect(sceneComponent("RoomMesh")).toBeUndefined();
    expect(sceneComponent("InkArchitectureLayer")).toBeUndefined();
    expect(namedSceneNode("live-room-capture")?.props.visible).toBe(false);
    expect(useCockpitStore.getState().sceneSource).toMatchObject({ captureSource: "none", loadedChunks: 0, totalChunks: 0, proceduralGeometryVisible: false });
  });

  it("publishes current capture visibility only after arrival, withdraws hidden/failed layers, and clears on canvas unmount", () => {
    mockSplat({ status: "loaded", hasAsset: true, splatUrls: ["/a.sog", "/b.sog"], source: "staged" });
    useEditorStore.setState({ configId: "demo-source" });
    useCockpitStore.getState().setLayerMode("splat");
    const { rerender, unmount } = render(<PlannerScene />);
    expect(useCockpitStore.getState().sceneSource?.loadedChunks).toBe(0);
    arrivals.loadedCount = 1;
    rerender(<PlannerScene />);
    expect(useCockpitStore.getState().sceneSource).toMatchObject({ configId: "demo-source", captureSource: "staged", loadedChunks: 1 });
    act(() => { useCockpitStore.getState().setLayerMode("mesh"); });
    expect(useCockpitStore.getState().sceneSource).toMatchObject({ captureSource: "none", proceduralGeometryVisible: true });
    act(() => { useCockpitStore.getState().setLayerMode("splat"); });
    arrivals.loadedCount = 0;
    arrivals.failedCount = 2;
    rerender(<PlannerScene />);
    expect(useCockpitStore.getState().sceneSource).toMatchObject({ captureSource: "none", loadedChunks: 0, proceduralGeometryVisible: true });
    unmount();
    expect(useCockpitStore.getState().sceneSource).toBeNull();
  });

  it("publishes 'ink' while the runtime package registry is resolving", async () => {
    mockSplat({ status: "loading" });
    render(<PlannerScene />);
    await waitFor(() => {
      expect(useCockpitStore.getState().roomResolve.phase).toBe("ink");
    });
  });

  it("publishes 'fallback' when resolution settles without a captured layer", async () => {
    mockSplat({ status: "none", hasAsset: false });
    render(<PlannerScene />);
    await waitFor(() => {
      expect(useCockpitStore.getState().roomResolve.phase).toBe("fallback");
    });
  });

  it("publishes 'developing' with honest chunk totals when a captured layer mounts", async () => {
    mockSplat({ status: "loaded", hasAsset: true, splatUrls: ["/a.sog", "/b.sog"] });
    render(<PlannerScene />);

    await waitFor(() => {
      expect(useCockpitStore.getState().roomResolve).toEqual({
        phase: "developing",
        loadedChunks: 0,
        totalChunks: 2,
      });
    });
  });
});

let arrivalFixtureId = 0;
function chooseGrandHall(): void {
  arrivalFixtureId += 1;
  const id = `00000000-0000-4000-8000-${String(arrivalFixtureId).padStart(12, "0")}`;
  useEditorStore.setState({ configId: id, space: SpaceSchema.parse({
    id, venueId: "00000000-0000-4000-8000-000000000099", name: "Grand Hall", slug: "grand-hall",
    description: null, widthM: "10", lengthM: "21", heightM: "7",
    floorPlanOutline: [{ x: -5, y: -10.5 }, { x: 5, y: -10.5 }, { x: 5, y: 10.5 }, { x: -5, y: 10.5 }],
    meshUrl: null, thumbnailUrl: null, sortOrder: 0,
    createdAt: "2026-09-06T00:00:00.000Z", updatedAt: "2026-09-06T00:00:00.000Z",
  }) });
}
function readyGrandHall(): void {
  mockSplat({ roomSlug: "grand-hall", status: "loaded", hasAsset: true, splatUrls: ["/a.sog"] });
}

describe("PlannerScene interior arrival", () => {
  it("keeps native resolution across camera motion, layer changes, progress and remount", () => {
    const oldDpr = window.devicePixelRatio;
    Object.defineProperty(window, "devicePixelRatio", { value: 2, configurable: true });
    try {
      chooseGrandHall(); readyGrandHall();
      const mounted = render(<PlannerScene />);
      expect(mounted.getByTestId("r3f-canvas").getAttribute("data-dpr")).toBe("2");
      act(() => { useCockpitStore.getState().setWalkMode(false); });
      act(() => { useCockpitStore.getState().setCameraInteractionActive(true); });
      act(() => { useCockpitStore.getState().setLayerMode("hybrid"); });
      arrivals.loadedCount = 1;
      mounted.rerender(<PlannerScene />);
      expect(mounted.getByTestId("r3f-canvas").getAttribute("data-dpr")).toBe("2");
      mounted.unmount();
      const remounted = render(<PlannerScene />);
      expect(remounted.getByTestId("r3f-canvas").getAttribute("data-dpr")).toBe("2");
      // A display-density change is deliberate and is distinct from a camera transition.
      act(() => {
        Object.defineProperty(window, "devicePixelRatio", { value: 1.25, configurable: true });
        window.dispatchEvent(new Event("resize"));
      });
      expect(remounted.getByTestId("r3f-canvas").getAttribute("data-dpr")).toBe("1.25");
    } finally {
      Object.defineProperty(window, "devicePixelRatio", { value: oldDpr, configurable: true });
    }
  });

  it("enters captured interior once after capability, preserving explicit choice through progress/remount", () => {
    chooseGrandHall();
    mockSplat({ roomSlug: "grand-hall", status: "loading" });
    const { rerender, unmount } = render(<PlannerScene />);
    expect(useCockpitStore.getState().walkMode).toBe(false);
    readyGrandHall();
    rerender(<PlannerScene />);
    expect(useCockpitStore.getState().walkMode).toBe(true);
    expect(useCockpitStore.getState().layerMode).toBe("splat");
    act(() => { useCockpitStore.getState().setWalkMode(false); });
    arrivals.loadedCount = 1;
    rerender(<PlannerScene />);
    expect(useCockpitStore.getState().walkMode).toBe(false);
    unmount();
    render(<PlannerScene />);
    expect(useCockpitStore.getState().walkMode).toBe(false);
  });

  it("honours even a same-valued explicit Hybrid choice during loading", () => {
    chooseGrandHall();
    mockSplat({ roomSlug: "grand-hall", status: "loading" });
    const { rerender } = render(<PlannerScene />);
    recordPlannerArrivalChoice();
    readyGrandHall();
    rerender(<PlannerScene />);
    expect(useCockpitStore.getState().walkMode).toBe(false);
    expect(useCockpitStore.getState().layerMode).toBe("hybrid");
  });

  it("honours a requested planning focus before capture capability arrives", () => {
    chooseGrandHall();
    mockSplat({ roomSlug: "grand-hall", status: "loading" });
    const { rerender } = render(<PlannerScene />);
    act(() => { useCockpitStore.getState().requestFocus(2, 3); });
    readyGrandHall();
    rerender(<PlannerScene />);
    expect(useCockpitStore.getState().walkMode).toBe(false);
  });

  it("keeps missing capture in planning and returns to fallback when all chunks fail", () => {
    chooseGrandHall();
    mockSplat({ roomSlug: "grand-hall", status: "none" });
    const { rerender } = render(<PlannerScene />);
    expect(useCockpitStore.getState().walkMode).toBe(false);
    readyGrandHall();
    rerender(<PlannerScene />);
    expect(useCockpitStore.getState().walkMode).toBe(true);
    arrivals.failedCount = 1;
    rerender(<PlannerScene />);
    expect(useCockpitStore.getState().walkMode).toBe(false);
    expect(useCockpitStore.getState().roomResolve.phase).toBe("fallback");
  });

  it("hands interior ownership back before a regular bookmark starts", () => {
    chooseGrandHall(); readyGrandHall();
    render(<PlannerScene />);
    expect(useCockpitStore.getState().walkMode).toBe(true);
    act(() => { useBookmarkStore.setState({ pendingNavigationId: "regular-bookmark" }); });
    expect(useCockpitStore.getState().walkMode).toBe(false);
  });
});
