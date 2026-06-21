import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { runGuestFlowReplayV0, type GuestFlowReplayArtifact } from "@omnitwin/types";

vi.mock("../../../../hooks/use-cockpit-replay.js", () => ({ useCockpitReplay: vi.fn() }));

const replay = vi.mocked(await import("../../../../hooks/use-cockpit-replay.js"));
const { buildGuestFlowReplayInputFromLayout } = await import("../../../../lib/guest-flow-layout-input.js");
const { FlowLensPanel } = await import("../FlowLensPanel.js");
const { useCockpitStore } = await import("../../../../stores/cockpit-store.js");

const ARTIFACT: GuestFlowReplayArtifact = runGuestFlowReplayV0(
  buildGuestFlowReplayInputFromLayout({ roomWidthM: 21, roomLengthM: 10.5, placedItems: [], plannedGuestCount: 50 }),
);

beforeEach(() => {
  replay.useCockpitReplay.mockReturnValue({ artifact: ARTIFACT, bounds: ARTIFACT.navmesh.roomBounds, status: "ready" });
});
afterEach(() => { cleanup(); vi.clearAllMocks(); useCockpitStore.getState().reset(); });

describe("FlowLensPanel", () => {
  it("renders the live simulation summary with the SAFE disclosure", () => {
    render(<FlowLensPanel />);
    expect(screen.getByTestId("flow-lens-panel")).toBeTruthy();
    expect(screen.getByText("Simulated agents")).toBeTruthy();
    expect(screen.getByText("Simulated")).toBeTruthy(); // status chip
    expect(screen.getByText(/human review required/i)).toBeTruthy();
  });

  it("guest-count control writes the planned count into the store (re-simulates)", () => {
    render(<FlowLensPanel />);
    const input = screen.getByTestId("flow-guest-count");
    fireEvent.change(input, { target: { value: "120" } });
    expect(useCockpitStore.getState().plannedGuestCount).toBe(120);
  });

  it("clearing the guest-count field falls back to the default assumption (null)", () => {
    useCockpitStore.getState().setPlannedGuestCount(120);
    render(<FlowLensPanel />);
    fireEvent.change(screen.getByTestId("flow-guest-count"), { target: { value: "" } });
    expect(useCockpitStore.getState().plannedGuestCount).toBeNull();
  });

  it("arrival-window control writes the duration into the store", () => {
    render(<FlowLensPanel />);
    fireEvent.change(screen.getByTestId("flow-arrival-minutes"), { target: { value: "45" } });
    expect(useCockpitStore.getState().flowArrivalMinutes).toBe(45);
  });

  it("shows a simulating hint while the replay is loading", () => {
    replay.useCockpitReplay.mockReturnValue({ artifact: null, bounds: null, status: "loading" });
    render(<FlowLensPanel />);
    expect(screen.getByText(/simulating guest flow/i)).toBeTruthy();
  });
});
