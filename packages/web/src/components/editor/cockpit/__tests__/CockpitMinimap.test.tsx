import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import {
  GuestFlowReplayArtifactSchema,
  runGuestFlowReplayV0,
  type GuestFlowReplayArtifact,
  type RouteConflict,
} from "@omnitwin/types";
import { getCatalogueItemBySlug } from "../../../../lib/catalogue.js";
import { createPlacedItem } from "../../../../lib/placement.js";
import { usePlacementStore } from "../../../../stores/placement-store.js";
import { useCockpitStore } from "../../../../stores/cockpit-store.js";
import { TRADES_HALL_GUEST_FLOW_REPLAY_INPUT } from "../../../../lib/trades-hall-visual-demo-state.js";
import { useCockpitReplay } from "../../../../hooks/use-cockpit-replay.js";
import { CockpitMinimap } from "../CockpitMinimap.js";

vi.mock("../../../../hooks/use-cockpit-replay.js", () => ({ useCockpitReplay: vi.fn() }));

const mockReplay = vi.mocked(useCockpitReplay);

const REAL_ARTIFACT: GuestFlowReplayArtifact = GuestFlowReplayArtifactSchema.parse(
  runGuestFlowReplayV0(TRADES_HALL_GUEST_FLOW_REPLAY_INPUT),
);

function reviewConflict(): RouteConflict {
  const { minX, minY, maxX, maxY } = REAL_ARTIFACT.navmesh.roomBounds;
  return {
    id: "conflict-review-1",
    conflictType: "route_crossing",
    severity: "review",
    point: { x: (minX + maxX) / 2, y: (minY + maxY) / 2 },
    involvedAgentIds: ["a", "b"],
    message: "Simulated route crossing — human review required.",
  };
}

function resetStores(): void {
  usePlacementStore.setState({ placedItems: [] });
  useCockpitStore.getState().reset();
}

beforeEach(() => {
  resetStores();
  mockReplay.mockReturnValue({ artifact: null, bounds: null, status: "idle" });
});
afterEach(() => {
  cleanup();
  resetStores();
  window.localStorage.clear();
  vi.clearAllMocks();
});

describe("CockpitMinimap", () => {
  it("renders the plan-view inset with the SAFE planning-overview note", () => {
    render(<CockpitMinimap />);
    expect(screen.getByText("Plan view")).toBeTruthy();
    expect(screen.getByText(/Planning overview · click to recentre/)).toBeTruthy();
  });

  it("plots a dot for each placed item", () => {
    const table = getCatalogueItemBySlug("round-table-6ft");
    if (table === undefined) throw new Error("fixture round table missing");
    usePlacementStore.setState({
      placedItems: [createPlacedItem(table.id, 0, 0, 0), createPlacedItem(table.id, 4, 0, 0)],
    });
    const { container } = render(<CockpitMinimap />);
    expect(container.querySelectorAll(".cockpit-minimap__dot")).toHaveLength(2);
  });

  it("requests a camera recentre when the plan is clicked", () => {
    render(<CockpitMinimap />);
    expect(useCockpitStore.getState().focusRequest).toBeNull();
    fireEvent.click(screen.getByLabelText(/Recentre the planner camera/), { clientX: 10, clientY: 12 });
    const focus = useCockpitStore.getState().focusRequest;
    expect(focus).not.toBeNull();
    expect(focus?.nonce).toBe(1);
    expect(Number.isFinite(focus?.x ?? NaN)).toBe(true);
    expect(Number.isFinite(focus?.z ?? NaN)).toBe(true);
  });

  it("shows no review markers in the Design lens", () => {
    const { container } = render(<CockpitMinimap />);
    expect(container.querySelectorAll(".cockpit-minimap__conflict")).toHaveLength(0);
  });

  it("plots simulated review markers as an evidence radar in the Evidence lens", () => {
    mockReplay.mockReturnValue({
      artifact: { ...REAL_ARTIFACT, routeConflicts: [reviewConflict()] },
      bounds: REAL_ARTIFACT.navmesh.roomBounds,
      status: "ready",
    });
    useCockpitStore.getState().setMode("evidence");
    const { container } = render(<CockpitMinimap />);
    expect(container.querySelectorAll(".cockpit-minimap__conflict")).toHaveLength(1);
    expect(screen.getByText(/1 simulated review marker · click to recentre/)).toBeTruthy();
  });
});
