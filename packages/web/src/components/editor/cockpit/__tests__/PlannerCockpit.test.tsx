import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { useCockpitStore } from "../../../../stores/cockpit-store.js";

vi.mock("../../PlannerScene.js", () => ({ PlannerScene: () => <div data-testid="planner-scene" /> }));
vi.mock("../../VerticalToolbox.js", () => ({ VerticalToolbox: () => <div data-testid="vertical-toolbox" /> }));

const { PlannerCockpit } = await import("../PlannerCockpit.js");

afterEach(() => { cleanup(); useCockpitStore.getState().reset(); });

describe("PlannerCockpit", () => {
  it("renders the grid regions, the live scene, and the nav rail", () => {
    render(<PlannerCockpit />);
    expect(screen.getByTestId("cockpit-shell")).toBeTruthy();
    expect(screen.getByTestId("planner-scene")).toBeTruthy();
    expect(screen.getByTestId("cockpit-rail")).toBeTruthy();
  });

  it("shows the tool toolbox in Design and hides it in other lenses", () => {
    render(<PlannerCockpit />);
    expect(screen.getByTestId("vertical-toolbox")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /flow/i }));
    expect(screen.queryByTestId("vertical-toolbox")).toBeNull();
  });

  it("docks the toolbox inside the stage region, not the viewport edge", () => {
    const { container } = render(<PlannerCockpit />);
    const stage = container.querySelector(".cockpit-stage");
    expect(stage).not.toBeNull();
    expect(stage?.querySelector('[data-testid="vertical-toolbox"]')).not.toBeNull();
  });
});
