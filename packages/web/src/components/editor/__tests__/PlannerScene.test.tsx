import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, render, waitFor } from "@testing-library/react";
import { readFile } from "node:fs/promises";
import { CANONICAL_LAYOUT_SNAPSHOT_V0_FIXTURE } from "@omnitwin/types";
import type { Space } from "../../../api/spaces.js";
import { frozenLayoutRoomModel } from "../../../lib/frozen-layout-room.js";

type CanvasMockProps = Readonly<{
  dpr?: unknown;
  frameloop?: unknown;
}>;

// Mock the R3F Canvas to render an empty host div: the scene children are
// constructed as React elements but never mounted, so their useThree/useFrame
// hooks don't run outside a real Canvas. This keeps the test a structural
// smoke test that PlannerScene mounts its canvas host.
vi.mock("@react-three/fiber", () => ({
  Canvas: ({ dpr, frameloop }: CanvasMockProps) => (
    <div
      data-testid="r3f-canvas"
      data-dpr={JSON.stringify(dpr)}
      data-frameloop={typeof frameloop === "string" ? frameloop : ""}
    />
  ),
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
} = {}): void {
  splatHookMock.useRoomRuntimeSplat.mockReturnValue({
    splatUrls: overrides.splatUrls ?? [],
    transform: IDENTITY_TRANSFORM,
    hasAsset: overrides.hasAsset ?? false,
    status: overrides.status ?? "none",
  });
}

const {
  PlannerScene,
  plannerAdaptiveResolutionForViewportWidth,
  plannerCanvasDprForViewportWidth,
  plannerCanvasGlForViewportWidth,
  plannerRoomDetailForViewportWidth,
  plannerRuntimeRendererRequested,
  plannerSceneWarmupMode,
  shouldRenderPlannerSceneOverlays,
  shouldMountLiveRuntimeSplat,
  shouldUseSmoothPlannerControls,
} = await import("../PlannerScene.js");
const { useCockpitStore } = await import("../../../stores/cockpit-store.js");
const { useEditorStore } = await import("../../../stores/editor-store.js");
const { useLayoutTimelinePreviewStore } = await import("../../../stores/layout-timeline-preview-store.js");
const { useRoomDimensionsStore } = await import("../../../stores/room-dimensions-store.js");

const DRIFTED_LIVE_SPACE: Space = {
  id: "current-space",
  venueId: "current-venue",
  name: "Current Drift Room",
  slug: "current-drift-room",
  widthM: "8",
  lengthM: "6",
  heightM: "3",
  floorPlanOutline: [
    { x: 100, y: 200 },
    { x: 108, y: 200 },
    { x: 108, y: 206 },
    { x: 100, y: 206 },
  ],
};

beforeEach(() => {
  useCockpitStore.getState().reset();
  useEditorStore.setState({ space: null });
  useLayoutTimelinePreviewStore.getState().clear();
  mockSplat();
});

afterEach(() => {
  cleanup();
  useLayoutTimelinePreviewStore.getState().clear();
  useEditorStore.setState({ space: null });
  vi.clearAllMocks();
});

describe("PlannerScene", () => {
  it("mounts an R3F canvas host", () => {
    const { container, getByTestId } = render(<PlannerScene />);
    expect(container.querySelector(".planner-scene-canvas-host")).not.toBeNull();
    expect(getByTestId("r3f-canvas")).toBeTruthy();
  });

  it("caps planner canvas DPR across mobile, tablet, and desktop viewports", () => {
    expect(plannerCanvasDprForViewportWidth(390)).toEqual([0.75, 0.75]);
    expect(plannerCanvasDprForViewportWidth(768)).toEqual([0.75, 0.75]);
    expect(plannerCanvasDprForViewportWidth(1024)).toEqual([0.75, 0.75]);
    expect(plannerCanvasDprForViewportWidth(1440)).toEqual([0.75, 0.75]);
  });

  it("keeps adaptive DPR disabled during planner camera movement to avoid renderer resize stalls", () => {
    expect(plannerAdaptiveResolutionForViewportWidth(390)).toEqual({
      enabled: false,
      minDpr: 0.75,
      maxDpr: 0.75,
    });
    expect(plannerAdaptiveResolutionForViewportWidth(768)).toEqual({
      enabled: false,
      minDpr: 0.75,
      maxDpr: 0.75,
    });
    expect(plannerAdaptiveResolutionForViewportWidth(1440)).toEqual({
      enabled: false,
      minDpr: 0.75,
      maxDpr: 0.75,
    });
  });

  it("disables planner canvas antialiasing on mobile and tablet viewports", () => {
    expect(plannerCanvasGlForViewportWidth(390)).toEqual({
      antialias: false,
      powerPreference: "high-performance",
    });
    expect(plannerCanvasGlForViewportWidth(768)).toEqual({
      antialias: false,
      powerPreference: "high-performance",
    });
    expect(plannerCanvasGlForViewportWidth(1024)).toEqual({
      antialias: false,
      powerPreference: "high-performance",
    });
    expect(plannerCanvasGlForViewportWidth(1440)).toEqual({
      antialias: true,
      powerPreference: "high-performance",
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
    expect(source).toContain("asynchronous={!timelinePreviewActive}");
    expect(source).toContain("if (!asynchronous)");
  });

  it("keeps one shader warm-up identity across active timeline modes", () => {
    expect(plannerSceneWarmupMode("inactive")).toBe("live");
    expect(plannerSceneWarmupMode("keyframe")).toBe("timeline-preview");
    expect(plannerSceneWarmupMode("transition")).toBe("timeline-preview");
    expect(plannerSceneWarmupMode("unavailable")).toBe("timeline-preview");
    expect(plannerSceneWarmupMode("schedule-gap")).toBe("timeline-preview");
  });

  it("publishes frozen canvas readiness only after a demand-rendered preview frame", async () => {
    const source = await readFile("src/components/editor/PlannerScene.tsx", "utf8");

    expect(source).toContain("function TimelinePreviewRenderReadiness");
    expect(source).toContain('setAttribute("data-timeline-preview-render-ready", "false")');
    expect(source).toContain('setAttribute("data-timeline-preview-render-ready", "true")');
    expect(source).toContain("window.requestAnimationFrame");
    expect(source).toContain("runtimePresentationReady");
    expect(source).toContain("historicalRuntimeBindingId === expectedHistoricalRuntime.bindingId");
    expect(source).toContain("renderPhase={authoritativeFrozenPreview ? timelinePreviewMode : null}");
  });

  it("snaps architectural ink during frozen timeline previews instead of scheduling a render loop", async () => {
    const source = await readFile("src/components/editor/PlannerScene.tsx", "utf8");

    expect(source).toContain("instant={timelinePreviewActive}");
  });

  it("keeps saved furniture mounted but disables mutation layers during timeline preview", async () => {
    const source = await readFile("src/components/editor/PlannerScene.tsx", "utf8");

    expect(source).toContain("name={SAVED_LAYOUT_FURNITURE_GROUP}");
    expect(source).toContain("visible={!timelinePreviewActive}");
    expect(source).toContain("<TimelinePreviewFurniture />");
    expect(source).toContain("{!timelinePreviewActive && <PlacementGhost />}");
    expect(source).toContain("{!timelinePreviewActive && <SelectionSystem />}");
    expect(source).toContain("{!timelinePreviewActive && <MeasurementTool />}");
  });

  it("selects frozen room bounds and centring instead of a drifted current space", () => {
    const runtime = CANONICAL_LAYOUT_SNAPSHOT_V0_FIXTURE.venueRuntime;
    const frozen = frozenLayoutRoomModel(runtime);
    const liveStoreDimensions = { width: 16, length: 12, height: 3 };
    useEditorStore.setState({ space: DRIFTED_LIVE_SPACE });
    useRoomDimensionsStore.getState().setDimensions(liveStoreDimensions);
    useLayoutTimelinePreviewStore.getState().settle({
      id: "event-a:phase-dinner",
      eventId: "event-a",
      eventName: "Wedding Dinner",
      phaseId: "phase-dinner",
      phaseName: "Dinner service",
      startsAt: "2026-07-18T19:00:00.000Z",
      endsAt: "2026-07-18T21:15:00.000Z",
      historicalRuntime: null,
      venueRuntime: runtime,
    }, []);

    const { container } = render(<PlannerScene />);
    const host = container.querySelector(".planner-scene-canvas-host");
    expect(host?.getAttribute("data-room-authority")).toBe("frozen");
    expect(host?.getAttribute("data-room-render-dimensions")).toBe("42,21,7");
    expect(host?.getAttribute("data-room-furniture-offset")).toBe("-21,0,-10.5");
    expect(host?.getAttribute("data-room-envelope-key")).toBe(frozen.envelopeKey);
    expect(host?.getAttribute("data-current-splat-suppressed")).toBe("true");
    expect(host?.getAttribute("data-room-presentation-source")).toBe("synthetic-stand-in");
    expect(host?.getAttribute("data-synthetic-grand-hall-stand-in")).toBe("true");
    expect(useRoomDimensionsStore.getState().dimensions).toEqual(liveStoreDimensions);
  });

  it("keeps the panorama-calibrated hall detailed on desktop while mobile stays lean", () => {
    expect(plannerRoomDetailForViewportWidth(390)).toBe("lean");
    expect(plannerRoomDetailForViewportWidth(1024)).toBe("lean");
    expect(plannerRoomDetailForViewportWidth(1440)).toBe("detailed");
  });

  it("does not borrow Grand Hall dressing for a different frozen room", () => {
    useLayoutTimelinePreviewStore.getState().settle({
      id: "event-a:phase-saloon",
      eventId: "event-a",
      eventName: "Wedding Dinner",
      phaseId: "phase-saloon",
      phaseName: "Saloon reception",
      startsAt: null,
      endsAt: null,
      historicalRuntime: null,
      venueRuntime: {
        ...CANONICAL_LAYOUT_SNAPSHOT_V0_FIXTURE.venueRuntime,
        spaceSlug: "saloon",
        spaceName: "Saloon",
      },
    }, []);

    const { container } = render(<PlannerScene />);
    const host = container.querySelector(".planner-scene-canvas-host");
    expect(host?.getAttribute("data-room-authority")).toBe("frozen");
    expect(host?.getAttribute("data-room-presentation-source")).toBe("procedural-shell");
    expect(host?.getAttribute("data-synthetic-grand-hall-stand-in")).toBe("false");
  });

  it("suppresses latest room assets and drives both camera paths from frozen bounds", async () => {
    const source = await readFile("src/components/editor/PlannerScene.tsx", "utf8");

    expect(shouldMountLiveRuntimeSplat(true, false)).toBe(true);
    expect(shouldMountLiveRuntimeSplat(true, true)).toBe(false);
    expect(source).toContain("shouldMountLiveRuntimeSplat(hasAsset, timelinePreviewActive)");
    expect(source).toContain("<CameraRig dimensions={dimensions}");
    expect(source).toContain("<CockpitPlanningCamera dimensionsOverride={authoritativeFrozenPreview ? dimensions : undefined}");
    expect(source).toContain("<group position={furnitureOffset}>");
    expect(source).toContain("{runtimeRendererRequested && (");
    expect(source).toContain("{expectedHistoricalRuntime !== null && (");
    expect(source.match(/<LazySparkRendererHost\s*\/>/gu)).toHaveLength(1);
    expect(source).toContain("includeRendererHost={false}");
  });

  it("does not churn Spark for no-capture previews and retains one requested host through exit", () => {
    let requested = plannerRuntimeRendererRequested(false, false, false);
    expect(requested).toBe(false);
    requested = plannerRuntimeRendererRequested(requested, false, false);
    expect(requested).toBe(false);

    requested = plannerRuntimeRendererRequested(requested, false, true);
    expect(requested).toBe(true);
    requested = plannerRuntimeRendererRequested(requested, false, false);
    expect(requested).toBe(true);
  });

  it("fails closed for pending, unavailable, and schedule-gap previews, then restores live room on exit", () => {
    useEditorStore.setState({ space: DRIFTED_LIVE_SPACE });
    const { container } = render(<PlannerScene />);
    const authority = (): string | null => container
      .querySelector(".planner-scene-canvas-host")
      ?.getAttribute("data-room-authority") ?? null;
    expect(authority()).toBe("live");

    act(() => {
      useCockpitStore.getState().requestFocus(8, 4);
      useCockpitStore.getState().setBeam({ anchor: [8, 0, 4], label: "Live conflict", tone: "review" });
    });
    act(() => { useLayoutTimelinePreviewStore.getState().showPending("Loading timeline…"); });
    expect(authority()).toBe("unavailable");
    expect(container.querySelector(".planner-scene-canvas-host")?.getAttribute("data-room-presentation-source")).toBe("none");
    expect(useCockpitStore.getState().focusRequest).toBeNull();
    expect(useCockpitStore.getState().beam).toBeNull();

    act(() => {
      useLayoutTimelinePreviewStore.getState().showUnavailable({
        id: "event-a:phase-missing",
        eventId: "event-a",
        eventName: "Wedding Dinner",
        phaseId: "phase-missing",
        phaseName: "Missing layout",
        startsAt: null,
        endsAt: null,
        historicalRuntime: null,
        venueRuntime: null,
      }, "No frozen layout.");
    });
    expect(authority()).toBe("unavailable");
    expect(container.querySelector(".planner-scene-canvas-host")?.getAttribute("data-synthetic-grand-hall-stand-in")).toBe("false");

    act(() => { useLayoutTimelinePreviewStore.getState().showScheduleGap("No phase scheduled."); });
    expect(authority()).toBe("unavailable");

    act(() => { useLayoutTimelinePreviewStore.getState().clear(); });
    expect(authority()).toBe("live");
  });

});

// CARD A2: the resolve choreography — PlannerScene derives the phase from the
// runtime-splat state plus chunk arrivals and publishes it to the cockpit
// store for the caption and the stage's honesty attribute.
describe("PlannerScene resolve phase wiring", () => {
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
