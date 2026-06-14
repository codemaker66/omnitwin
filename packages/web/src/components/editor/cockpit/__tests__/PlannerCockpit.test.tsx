import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { useCockpitStore } from "../../../../stores/cockpit-store.js";

// The cockpit hosts the full editor (App) in its stage; mock it to a stand-in
// so the test stays a structural shell test (no WebGL). The top bar reads
// router + store context of its own, so mock it too for this shell test.
vi.mock("../../../../App.js", () => ({ App: () => <div data-testid="mock-editor-3d" /> }));
vi.mock("../CockpitTopBar.js", () => ({ CockpitTopBar: () => <header data-testid="cockpit-topbar-mock" /> }));

const { PlannerCockpit } = await import("../PlannerCockpit.js");

afterEach(() => { cleanup(); useCockpitStore.getState().reset(); });

describe("PlannerCockpit", () => {
  it("renders the grid regions, the live editor, and the nav rail", () => {
    render(<PlannerCockpit />);
    expect(screen.getByTestId("cockpit-shell")).toBeTruthy();
    expect(screen.getByTestId("mock-editor-3d")).toBeTruthy();
    expect(screen.getByTestId("cockpit-rail")).toBeTruthy();
  });

  it("hosts the editor inside the stage region", () => {
    const { container } = render(<PlannerCockpit />);
    const stage = container.querySelector(".cockpit-stage");
    expect(stage).not.toBeNull();
    expect(stage?.querySelector('[data-testid="mock-editor-3d"]')).not.toBeNull();
  });

  it("marks the stage with the active lens (Design by default) so CSS shows tools only in Design", () => {
    const { container } = render(<PlannerCockpit />);
    expect(container.querySelector(".cockpit-stage")?.getAttribute("data-cockpit-mode")).toBe("design");
    fireEvent.click(screen.getByRole("button", { name: /flow/i }));
    expect(container.querySelector(".cockpit-stage")?.getAttribute("data-cockpit-mode")).toBe("flow");
  });
});
