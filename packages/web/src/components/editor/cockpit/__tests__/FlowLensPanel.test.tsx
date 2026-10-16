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
    expect(screen.getByRole("status").textContent).toContain("Simulating");
    expect(screen.getByRole("status").querySelector("[data-activity-indicator]")).not.toBeNull();
  });

  it("keeps activity visible during a refresh with an existing simulation", () => {
    replay.useCockpitReplay.mockReturnValue({ artifact: ARTIFACT, bounds: ARTIFACT.navmesh.roomBounds, status: "loading" });
    render(<FlowLensPanel />);
    expect(screen.getByText("Simulated agents")).toBeTruthy();
    expect(screen.getByRole("status").textContent).toContain("Simulating");
  });
});

describe("FlowLensPanel — doors nobody recorded (redteam fix-first 2)", () => {
  it("gives no bottleneck score for doors placed mid-wall, and asks for the doors", () => {
    render(<FlowLensPanel />);
    expect(screen.queryByText("Bottleneck score")).toBeNull();
    expect(screen.getByTestId("flow-doors-unrecorded-status").textContent).toBe("Not recorded");
    // No venue is open in this suite, so there is no address to write to:
    // the panel names who to ask instead of a dead link.
    expect(screen.getByTestId("flow-doors-unrecorded-next").textContent).toBe("Ask the venue's events team when you send your enquiry.");
    expect(screen.queryByText("No simulated route conflicts.")).toBeNull();
    expect(screen.getByTestId("flow-lens-panel").textContent).not.toMatch(/\b(pass|fits|valid|compliant)\b/i);
  });

  it("states the bottleneck score once every door position was given", () => {
    const door = { id: "door-west", label: "West door", xM: -10, zM: 0, widthM: 1.8 };
    const surveyed = runGuestFlowReplayV0(buildGuestFlowReplayInputFromLayout({
      roomWidthM: 21, roomLengthM: 10.5, placedItems: [], plannedGuestCount: 50,
      entrances: [door], exits: [{ ...door, id: "door-east", label: "East door", xM: 10 }],
    }));
    replay.useCockpitReplay.mockReturnValue({ artifact: surveyed, bounds: surveyed.navmesh.roomBounds, status: "ready" });
    render(<FlowLensPanel />);
    expect(screen.getByText("Bottleneck score")).toBeTruthy();
    expect(screen.queryByTestId("flow-doors-unrecorded")).toBeNull();
  });
});
