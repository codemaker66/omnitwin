import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";

// Stand in for the real panels so this stays a routing test, not a render test.
vi.mock("../FlowLensPanel.js", () => ({ FlowLensPanel: () => <div data-testid="flow-panel-mock" /> }));
vi.mock("../CostsLensPanel.js", () => ({ CostsLensPanel: () => <div data-testid="costs-panel-mock" /> }));
vi.mock("../CockpitTruthRail.js", () => ({ CockpitTruthRail: () => <div data-testid="truth-rail-mock" /> }));

const { CockpitRightDock, panelForMode } = await import("../CockpitRightDock.js");
const { useCockpitStore } = await import("../../../../stores/cockpit-store.js");

afterEach(() => { cleanup(); useCockpitStore.getState().reset(); });

describe("panelForMode (registry)", () => {
  it("returns a panel for a registered lens and null otherwise", () => {
    expect(panelForMode("flow")).not.toBeNull();
    expect(panelForMode("costs")).not.toBeNull();
    expect(panelForMode("design")).toBeNull();
    expect(panelForMode("guests")).toBeNull();
  });
});

describe("CockpitRightDock", () => {
  it("falls back to the Truth rail when the active lens has no panel", () => {
    useCockpitStore.getState().setMode("design");
    render(<CockpitRightDock />);
    expect(screen.getByTestId("truth-rail-mock")).toBeTruthy();
    expect(screen.queryByTestId("flow-panel-mock")).toBeNull();
  });

  it("renders the registered panel for the flow lens", () => {
    useCockpitStore.getState().setMode("flow");
    render(<CockpitRightDock />);
    expect(screen.getByTestId("flow-panel-mock")).toBeTruthy();
    expect(screen.queryByTestId("truth-rail-mock")).toBeNull();
  });

  it("renders the Costs panel for the costs lens", () => {
    useCockpitStore.getState().setMode("costs");
    render(<CockpitRightDock />);
    expect(screen.getByTestId("costs-panel-mock")).toBeTruthy();
  });

  it("keeps the Truth rail for Evidence (no panel registered yet)", () => {
    useCockpitStore.getState().setMode("evidence");
    render(<CockpitRightDock />);
    expect(screen.getByTestId("truth-rail-mock")).toBeTruthy();
  });
});
