import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, render, waitFor } from "@testing-library/react";
import { readFile } from "node:fs/promises";
import { SpaceSchema } from "@omnitwin/types";

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
} = {}): void {
  splatHookMock.useRoomRuntimeSplat.mockReturnValue({
    splatUrls: overrides.splatUrls ?? [],
    transform: IDENTITY_TRANSFORM,
    hasAsset: overrides.hasAsset ?? false,
    status: overrides.status ?? "none",
    roomSlug: overrides.roomSlug ?? null,
  });
}

const {
  PlannerScene,
  plannerAdaptiveResolutionForViewportWidth,
  plannerCanvasDprForViewportWidth,
  plannerCanvasGlForViewportWidth,
  shouldRenderPlannerSceneOverlays,
  shouldUseSmoothPlannerControls,
} = await import("../PlannerScene.js");
const { useCockpitStore } = await import("../../../stores/cockpit-store.js");
const { useEditorStore } = await import("../../../stores/editor-store.js");
const { useBookmarkStore } = await import("../../../stores/bookmark-store.js");
const { recordPlannerArrivalChoice } = await import("../../../lib/planner-room-arrival.js");

beforeEach(() => {
  useCockpitStore.getState().reset();
  useEditorStore.setState({ space: null, configId: null });
  useBookmarkStore.setState({ pendingNavigationId: null, activeReferenceId: null, transition: null, tour: null });
  arrivals.loadedCount = 0;
  arrivals.failedCount = 0;
  mockSplat();
});

afterEach(() => {
  cleanup();
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
    // preserveDrawingBuffer is the C2 dev-only capture aid (?capture=1);
    // outside that flag it is always the explicit false below.
    expect(plannerCanvasGlForViewportWidth(390)).toEqual({
      antialias: false,
      powerPreference: "high-performance",
      preserveDrawingBuffer: false,
    });
    expect(plannerCanvasGlForViewportWidth(768)).toEqual({
      antialias: false,
      powerPreference: "high-performance",
      preserveDrawingBuffer: false,
    });
    expect(plannerCanvasGlForViewportWidth(1024)).toEqual({
      antialias: false,
      powerPreference: "high-performance",
      preserveDrawingBuffer: false,
    });
    expect(plannerCanvasGlForViewportWidth(1440)).toEqual({
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
