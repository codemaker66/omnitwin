import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";

// Stand in for the real panels so this stays a routing test, not a render test.
vi.mock("../FlowLensPanel.js", () => ({ FlowLensPanel: () => <div data-testid="flow-panel-mock" /> }));
vi.mock("../CostsLensPanel.js", () => ({ CostsLensPanel: () => <div data-testid="costs-panel-mock" /> }));
vi.mock("../ShareLensPanel.js", () => ({ ShareLensPanel: () => <div data-testid="share-panel-mock" /> }));
vi.mock("../GuestsLensPanel.js", () => ({ GuestsLensPanel: () => <div data-testid="guests-panel-mock" /> }));
vi.mock("../OpsLensPanel.js", () => ({ OpsLensPanel: () => <div data-testid="ops-panel-mock" /> }));
vi.mock("../EvidenceLensPanel.js", () => ({ EvidenceLensPanel: () => <div data-testid="evidence-panel-mock" /> }));
vi.mock("../LightingLensPanel.js", () => ({ LightingLensPanel: () => <div data-testid="lighting-panel-mock" /> }));
vi.mock("../CockpitTruthRail.js", () => ({ CockpitTruthRail: () => <div data-testid="truth-rail-mock" /> }));

const { CockpitRightDock, panelForMode } = await import("../CockpitRightDock.js");
const { useCockpitStore } = await import("../../../../stores/cockpit-store.js");

afterEach(() => { cleanup(); useCockpitStore.getState().reset(); });

describe("panelForMode (registry)", () => {
  it("returns a panel for a registered lens and null otherwise", () => {
    expect(panelForMode("flow")).not.toBeNull();
    expect(panelForMode("costs")).not.toBeNull();
    expect(panelForMode("share")).not.toBeNull();
    expect(panelForMode("guests")).not.toBeNull();
    expect(panelForMode("ops")).not.toBeNull();
    expect(panelForMode("evidence")).not.toBeNull();
    expect(panelForMode("lighting")).not.toBeNull();
    expect(panelForMode("design")).toBeNull();
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

  it("renders the Share panel for the share lens", () => {
    useCockpitStore.getState().setMode("share");
    render(<CockpitRightDock />);
    expect(screen.getByTestId("share-panel-mock")).toBeTruthy();
  });

  it("renders the Guests panel for the guests lens", () => {
    useCockpitStore.getState().setMode("guests");
    render(<CockpitRightDock />);
    expect(screen.getByTestId("guests-panel-mock")).toBeTruthy();
  });

  it("renders the Ops panel for the ops lens", () => {
    useCockpitStore.getState().setMode("ops");
    render(<CockpitRightDock />);
    expect(screen.getByTestId("ops-panel-mock")).toBeTruthy();
  });

  it("renders the Evidence panel for the evidence lens", () => {
    useCockpitStore.getState().setMode("evidence");
    render(<CockpitRightDock />);
    expect(screen.getByTestId("evidence-panel-mock")).toBeTruthy();
  });

  it("renders the Lighting panel for the lighting lens", () => {
    useCockpitStore.getState().setMode("lighting");
    render(<CockpitRightDock />);
    expect(screen.getByTestId("lighting-panel-mock")).toBeTruthy();
  });
});
