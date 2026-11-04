import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, render, screen, within } from "@testing-library/react";
import { setPlannerFeaturesForTesting } from "../../../../lib/planner-features.js";
import { useAuthStore } from "../../../../stores/auth-store.js";
import { useCockpitStore } from "../../../../stores/cockpit-store.js";

// Blake's decision 5 end to end in the cockpit: a lens this viewer cannot see
// never mounts its panel (the desktop dock, the phone sheet), the stage and
// the rail show Design instead, the store lets go of it, and no caller can
// open it again. The real dock and sheet choose the panel; the panels are
// stand-ins that count their renders, so "never rendered" is measured.

const renders = vi.hoisted(() => ({ rigging: 0, costs: 0, ops: 0 }));

vi.mock("../../../../App.js", () => ({ App: () => <div data-testid="mock-editor-3d" /> }));
vi.mock("../ReferenceRoomHeader.js", () => ({ ReferenceRoomHeader: () => <header data-testid="reference-room-header-mock" /> }));
vi.mock("../CockpitBottom.js", () => ({ CockpitBottom: () => <footer data-testid="cockpit-bottom-mock" /> }));
vi.mock("../WhenRibbon.js", () => ({ WhenRibbon: () => <aside data-testid="when-ribbon-mock" /> }));
vi.mock("../../../../lib/reduced-motion.js", () => ({ prefersReducedMotion: () => true }));
vi.mock("../FlowLensPanel.js", () => ({ FlowLensPanel: () => <div data-testid="flow-panel-mock" /> }));
vi.mock("../CostsLensPanel.js", () => ({
  CostsLensPanel: () => { renders.costs += 1; return <div data-testid="costs-panel-mock" />; },
}));
vi.mock("../ShareLensPanel.js", () => ({ ShareLensPanel: () => <div data-testid="share-panel-mock" /> }));
vi.mock("../GuestsLensPanel.js", () => ({ GuestsLensPanel: () => <div data-testid="guests-panel-mock" /> }));
vi.mock("../OpsLensPanel.js", () => ({
  OpsLensPanel: () => { renders.ops += 1; return <div data-testid="ops-panel-mock" />; },
}));
vi.mock("../EvidenceLensPanel.js", () => ({ EvidenceLensPanel: () => <div data-testid="evidence-panel-mock" /> }));
vi.mock("../LightingLensPanel.js", () => ({ LightingLensPanel: () => <div data-testid="lighting-panel-mock" /> }));
vi.mock("../PowerLensPanel.js", () => ({ PowerLensPanel: () => <div data-testid="power-panel-mock" /> }));
vi.mock("../RiggingLensPanel.js", () => ({
  RiggingLensPanel: () => { renders.rigging += 1; return <div data-testid="rigging-panel-mock" />; },
}));
vi.mock("../AVLensPanel.js", () => ({ AVLensPanel: () => <div data-testid="av-panel-mock" /> }));
vi.mock("../CockpitTruthRail.js", () => ({ CockpitTruthRail: () => <div data-testid="truth-rail-mock" /> }));

const { PlannerCockpit } = await import("../PlannerCockpit.js");

function signIn(role: string): void {
  useAuthStore.getState().setUser({ id: "viewer", email: "viewer@example.test", role, platformRole: "none", venueId: "venue", name: "Viewer" });
}

function stageMode(): string | null {
  return document.querySelector(".cockpit-stage")?.getAttribute("data-cockpit-mode") ?? null;
}

function pressedLens(): string[] {
  return within(screen.getByRole("navigation", { name: "Planner lenses" })).getAllByRole("button")
    .filter((button) => button.getAttribute("aria-pressed") === "true")
    .map((button) => button.getAttribute("aria-label") ?? "");
}

beforeEach(() => {
  renders.rigging = 0;
  renders.costs = 0;
  renders.ops = 0;
});

afterEach(() => {
  cleanup();
  setPlannerFeaturesForTesting(null);
  useCockpitStore.getState().reset();
  useAuthStore.getState().logout();
});

describe("PlannerCockpit: a lens the viewer cannot see (lensesByRole)", () => {
  it("shows a client Design, never the Rigging panel, when Rigging was left active", () => {
    setPlannerFeaturesForTesting({ lensesByRole: true });
    signIn("client");
    useCockpitStore.setState({ activeMode: "rigging" });
    render(<PlannerCockpit />);
    expect(renders.rigging).toBe(0);
    expect(screen.queryByTestId("rigging-panel-mock")).toBeNull();
    expect(screen.getByRole("complementary", { name: "Furniture inspector" })).toBeTruthy();
    expect(stageMode()).toBe("design");
    expect(pressedLens()).toEqual(["Design"]);
    // The store lets go of it too, so the scene's own lens readers agree.
    expect(useCockpitStore.getState().activeMode).toBe("design");
    expect(useCockpitStore.getState().offeredModes).toEqual(["design", "guests", "costs", "share"]);
  });

  it("refuses the lens to any later caller: a shortcut or another surface's setMode", () => {
    setPlannerFeaturesForTesting({ lensesByRole: true });
    render(<PlannerCockpit />);
    act(() => { useCockpitStore.getState().setMode("rigging"); });
    expect(useCockpitStore.getState().activeMode).toBe("design");
    expect(renders.rigging).toBe(0);
    act(() => { useCockpitStore.getState().setMode("costs"); });
    expect(screen.getByTestId("costs-panel-mock")).toBeTruthy();
    expect(stageMode()).toBe("costs");
  });

  it("puts the lens back to Design when its viewer signs out", () => {
    setPlannerFeaturesForTesting({ lensesByRole: true });
    signIn("staff");
    render(<PlannerCockpit />);
    act(() => { useCockpitStore.getState().setMode("rigging"); });
    expect(screen.getByTestId("rigging-panel-mock")).toBeTruthy();
    const whileStaff = renders.rigging;
    act(() => { useAuthStore.getState().logout(); });
    expect(screen.queryByTestId("rigging-panel-mock")).toBeNull();
    expect(renders.rigging).toBe(whileStaff);
    expect(useCockpitStore.getState().activeMode).toBe("design");
    expect(stageMode()).toBe("design");
  });

  it("keeps the hallkeeper's Ops, and drops a lens the hallkeeper is not offered", () => {
    setPlannerFeaturesForTesting({ lensesByRole: true, lensesDivider: true });
    signIn("staff");
    render(<PlannerCockpit />);
    act(() => { useCockpitStore.getState().setMode("costs"); });
    act(() => { signIn("hallkeeper"); });
    expect(useCockpitStore.getState().activeMode).toBe("design");
    act(() => { useCockpitStore.getState().setMode("ops"); });
    expect(screen.getByTestId("ops-panel-mock")).toBeTruthy();
    expect(pressedLens()).toEqual(["Ops"]);
  });

  it("raises no phone sheet for a lens the viewer cannot see, and still raises one it can", () => {
    setPlannerFeaturesForTesting({ lensesByRole: true });
    signIn("planner");
    useCockpitStore.setState({ activeMode: "rigging" });
    render(<PlannerCockpit mobile />);
    expect(renders.rigging).toBe(0);
    expect(screen.queryByTestId("lens-sheet")).toBeNull();
    expect(useCockpitStore.getState().activeMode).toBe("design");
    act(() => { useCockpitStore.getState().setMode("costs"); });
    const sheet = screen.getByTestId("lens-sheet");
    expect(sheet.getAttribute("data-lens")).toBe("costs");
    expect(within(sheet).getByTestId("costs-panel-mock")).toBeTruthy();
  });
});

describe("PlannerCockpit with both keys off", () => {
  it("leaves every lens open to everyone, as today", () => {
    signIn("client");
    useCockpitStore.setState({ activeMode: "rigging" });
    render(<PlannerCockpit />);
    expect(screen.getByTestId("rigging-panel-mock")).toBeTruthy();
    expect(stageMode()).toBe("rigging");
    expect(useCockpitStore.getState().activeMode).toBe("rigging");
  });
});
