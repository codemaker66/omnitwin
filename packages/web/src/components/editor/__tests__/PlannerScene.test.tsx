import { describe, expect, it, vi } from "vitest";
import { render } from "@testing-library/react";

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
// the splat renderer is never imported into this structural smoke test.
vi.mock("../CockpitSplatLayer.js", () => ({ CockpitSplatLayer: () => null }));

const {
  PlannerScene,
  plannerAdaptiveResolutionForViewportWidth,
  plannerCanvasDprForViewportWidth,
  plannerCanvasGlForViewportWidth,
  shouldRenderPlannerSceneOverlays,
  shouldUseSmoothPlannerControls,
} = await import("../PlannerScene.js");

describe("PlannerScene", () => {
  it("mounts an R3F canvas host", () => {
    const { getByTestId } = render(<PlannerScene />);
    expect(getByTestId("r3f-canvas")).toBeTruthy();
  });

  it("caps planner canvas DPR across mobile, tablet, and desktop viewports", () => {
    expect(plannerCanvasDprForViewportWidth(390)).toEqual([1, 1]);
    expect(plannerCanvasDprForViewportWidth(768)).toEqual([0.75, 0.75]);
    expect(plannerCanvasDprForViewportWidth(1024)).toEqual([0.75, 0.75]);
    expect(plannerCanvasDprForViewportWidth(1440)).toEqual([1, 1]);
  });

  it("keeps adaptive DPR disabled on fixed lean planner viewports", () => {
    expect(plannerAdaptiveResolutionForViewportWidth(390)).toEqual({
      enabled: false,
      minDpr: 1,
      maxDpr: 1,
    });
    expect(plannerAdaptiveResolutionForViewportWidth(768)).toEqual({
      enabled: false,
      minDpr: 0.75,
      maxDpr: 0.75,
    });
    expect(plannerAdaptiveResolutionForViewportWidth(1440)).toEqual({
      enabled: true,
      minDpr: 0.5,
      maxDpr: 1,
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
});
