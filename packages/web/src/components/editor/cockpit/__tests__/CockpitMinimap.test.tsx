import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import {
  GuestFlowReplayArtifactSchema,
  CANONICAL_LAYOUT_SNAPSHOT_V0_FIXTURE,
  runGuestFlowReplayV0,
  type GuestFlowReplayArtifact,
  type RouteConflict,
} from "@omnitwin/types";
import { getCatalogueItemBySlug } from "../../../../lib/catalogue.js";
import { createPlacedItem } from "../../../../lib/placement.js";
import { usePlacementStore } from "../../../../stores/placement-store.js";
import { useCockpitStore } from "../../../../stores/cockpit-store.js";
import { useLayoutTimelinePreviewStore } from "../../../../stores/layout-timeline-preview-store.js";
import { TRADES_HALL_GUEST_FLOW_REPLAY_INPUT } from "../../../../lib/trades-hall-visual-demo-state.js";
import { useCockpitReplay } from "../../../../hooks/use-cockpit-replay.js";
import { CockpitMinimap } from "../CockpitMinimap.js";
import { timelinePreviewMinimapPoint } from "../CockpitMinimap.js";
import { frozenLayoutRoomModel } from "../../../../lib/frozen-layout-room.js";
import { minimapLayout } from "../../../../lib/cockpit-minimap-model.js";
import { toRenderSpace } from "../../../../constants/scale.js";

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
  useLayoutTimelinePreviewStore.getState().clear();
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

  it("plots current phase-preview items without showing saved-plan dots", () => {
    const table = getCatalogueItemBySlug("round-table-6ft");
    if (table === undefined) throw new Error("fixture round table missing");
    usePlacementStore.setState({ placedItems: [createPlacedItem(table.id, 0, 0, 0)] });
    useLayoutTimelinePreviewStore.getState().settle({
      id: "event-a:phase-dinner",
      eventId: "event-a",
      eventName: "Wedding Dinner",
      phaseId: "phase-dinner",
      phaseName: "Dinner service",
      startsAt: null,
      endsAt: null,
      historicalRuntime: null,
      venueRuntime: CANONICAL_LAYOUT_SNAPSHOT_V0_FIXTURE.venueRuntime,
    }, [createPlacedItem(table.id, 0, 0, 0), createPlacedItem(table.id, 4, 0, 0)]);

    const { container } = render(<CockpitMinimap />);
    expect(container.querySelectorAll(".cockpit-minimap__dot")).toHaveLength(0);
    expect(container.querySelector(".cockpit-minimap__preview-canvas")?.getAttribute("data-preview-object-count")).toBe("2");
    expect(screen.getByText(/Phase preview · saved plan unchanged/)).toBeTruthy();
  });

  it("projects shifted frozen coordinates through the same centred room offset", () => {
    const baseRuntime = CANONICAL_LAYOUT_SNAPSHOT_V0_FIXTURE.venueRuntime;
    const shiftedRuntime = {
      ...baseRuntime,
      floorPlanOutline: baseRuntime.floorPlanOutline.map((point) => ({
        x: point.x + 100,
        y: point.y + 200,
      })),
    };
    const frozen = frozenLayoutRoomModel(shiftedRuntime);
    const layout = minimapLayout(frozen.renderDimensions, 132);
    const roomCentreItem = {
      x: toRenderSpace(110.5),
      z: toRenderSpace(205.25),
    };

    expect(timelinePreviewMinimapPoint(
      roomCentreItem,
      layout,
      frozen.furnitureOffset,
    )).toEqual({ left: layout.width / 2, top: layout.height / 2 });

    useLayoutTimelinePreviewStore.getState().settle({
      id: "event-a:phase-shifted",
      eventId: "event-a",
      eventName: "Wedding Dinner",
      phaseId: "phase-shifted",
      phaseName: "Shifted room",
      startsAt: null,
      endsAt: null,
      historicalRuntime: null,
      venueRuntime: shiftedRuntime,
    }, []);
    const { container } = render(<CockpitMinimap />);
    const previewCanvas = container.querySelector(".cockpit-minimap__preview-canvas");
    expect(previewCanvas?.getAttribute("data-preview-furniture-offset"))
      .toBe(frozen.furnitureOffset.join(","));
    expect(previewCanvas?.getAttribute("data-preview-room-dimensions")).toBe("42,21");
    expect(container.querySelector(".cockpit-minimap__heritage")).toBeNull();
    expect(mockReplay).toHaveBeenCalledWith(false);
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

  it("shows a dimensionless unavailable state when preview has no frozen room authority", () => {
    useLayoutTimelinePreviewStore.getState().showPending("Loading timeline…");
    const { container } = render(<CockpitMinimap />);

    expect(screen.getByTestId("cockpit-minimap-unavailable").textContent)
      .toBe("No room preview available");
    expect(container.querySelector(".cockpit-minimap__plate")).toBeNull();
    expect(container.querySelector(".cockpit-minimap__heritage")).toBeNull();
    expect(screen.queryByRole("button", { name: /Recentre the planner camera/i })).toBeNull();
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
