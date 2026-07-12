import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, waitFor } from "@testing-library/react";
import { readFile } from "node:fs/promises";

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
  shouldRenderPlannerSceneOverlays,
  shouldUseSmoothPlannerControls,
} = await import("../PlannerScene.js");
const { useCockpitStore } = await import("../../../stores/cockpit-store.js");

beforeEach(() => {
  useCockpitStore.getState().reset();
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
