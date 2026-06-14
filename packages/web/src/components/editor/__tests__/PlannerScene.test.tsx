import { describe, expect, it, vi } from "vitest";
import { render } from "@testing-library/react";

// Mock the R3F Canvas to render an empty host div: the scene children are
// constructed as React elements but never mounted, so their useThree/useFrame
// hooks don't run outside a real Canvas. This keeps the test a structural
// smoke test that PlannerScene mounts its canvas host.
vi.mock("@react-three/fiber", () => ({
  Canvas: () => <div data-testid="r3f-canvas" />,
}));

const { PlannerScene } = await import("../PlannerScene.js");

describe("PlannerScene", () => {
  it("mounts an R3F canvas host", () => {
    const { getByTestId } = render(<PlannerScene />);
    expect(getByTestId("r3f-canvas")).toBeTruthy();
  });
});
