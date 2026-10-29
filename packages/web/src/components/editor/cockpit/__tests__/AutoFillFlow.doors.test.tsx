import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, within, type BoundFunctions, type queries } from "@testing-library/react";
import type { TradesHallVenueStatus } from "../../../../hooks/use-trades-hall-venue.js";

// ---------------------------------------------------------------------------
// Auto-fill in the Grand Hall with its doors kept clear (Blake, 27 Oct 2026:
// "Keep them clear automatically (Recommended)"). The prompt says, before
// anything is placed, how many fit with the doors kept clear of the guests
// asked, and places exactly that. Worked by hand (auto-fill-doors.test): ten
// 6 ft rounds of ten clear the four doors' spaces, where fourteen fit without.
// Each flow runs in the desktop dock and inside the phone's lens sheet.
// ---------------------------------------------------------------------------

const venue = vi.hoisted(() => ({ status: "trades-hall" as TradesHallVenueStatus }));
vi.mock("../../../../hooks/use-trades-hall-venue.js", () => ({
  useTradesHallVenueStatus: () => venue.status,
  useTradesHallVenue: () => venue.status === "trades-hall",
}));

const { GuestsLensPanel } = await import("../GuestsLensPanel.js");
const { LensSheet } = await import("../LensSheet.js");
const { usePlacementStore } = await import("../../../../stores/placement-store.js");
const { useRoomDimensionsStore } = await import("../../../../stores/room-dimensions-store.js");
const { useCockpitStore } = await import("../../../../stores/cockpit-store.js");
const { useAutoFillRequestStore } = await import("../../../../stores/auto-fill-request-store.js");
const { useDoorClearSpaceStore } = await import("../../../../stores/door-clear-space-store.js");
const { GRAND_HALL_DOOR_CLEAR_SPACES } = await import("../../../../lib/door-clear-spaces.js");
const { doorBlockers } = await import("../../../../lib/keep-doors-clear.js");
const { seatingCountsFromPlacedItems } = await import("../../../../lib/seating-counts.js");
const { createTableGroup } = await import("../../../../lib/table-group.js");
const { getCatalogueItemBySlug } = await import("../../../../lib/catalogue.js");
const fixtures = await import("./planner-truth-fixtures.js");

const ROUND = getCatalogueItemBySlug("round-table-6ft-white")?.id ?? "missing-round";

const VIEWPORTS = [
  { label: "desktop dock", width: 1280, phone: false },
  { label: "phone lens sheet", width: 375, phone: true },
] as const;

let restoreWidth: (() => void) | null = null;
function setViewportWidth(width: number): void {
  const previous = Object.getOwnPropertyDescriptor(window, "innerWidth");
  Object.defineProperty(window, "innerWidth", { configurable: true, value: width });
  restoreWidth = () => { if (previous !== undefined) Object.defineProperty(window, "innerWidth", previous); };
}

function openGuests(phone: boolean): BoundFunctions<typeof queries> {
  if (!phone) {
    render(<GuestsLensPanel />);
    return within(screen.getByTestId("guests-lens-panel"));
  }
  useCockpitStore.getState().setMode("guests");
  render(<LensSheet />);
  return within(screen.getByRole("dialog", { name: "Guests" }));
}

beforeEach(() => {
  venue.status = "trades-hall";
  usePlacementStore.setState({ placedItems: [] });
  useCockpitStore.getState().reset();
  useAutoFillRequestStore.setState({ requested: null });
  useRoomDimensionsStore.getState().setDimensions({ width: 21, length: 10.5, height: 7 });
  useDoorClearSpaceStore.getState().setRoomSpaces(GRAND_HALL_DOOR_CLEAR_SPACES);
  fixtures.resetPlannerTruth();
  fixtures.openRoom(fixtures.plannerRoom());
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  restoreWidth?.();
  restoreWidth = null;
  useCockpitStore.getState().reset();
  useDoorClearSpaceStore.getState().setRoomSpaces(null);
  fixtures.resetPlannerTruth();
});

describe.each(VIEWPORTS)("auto-fill keeps the Grand Hall's doors clear ($label)", ({ width, phone }) => {
  beforeEach(() => { setViewportWidth(width); });

  it("says how many fit with the doors kept clear before placing, then places exactly that", () => {
    const lens = openGuests(phone);
    fireEvent.click(lens.getByTestId("guests-build-dinner-rounds"));
    fireEvent.change(lens.getByTestId("auto-fill-guests"), { target: { value: "120" } });

    expect(lens.getByTestId("auto-fill-place").textContent).toBe("Place 10 tables and 100 chairs");
    expect(lens.getByTestId("auto-fill-basis").textContent).toBe("Rounds of 10, with 0.6 m clear behind every chair and the doors kept clear.");
    expect(lens.getByTestId("auto-fill-short").textContent)
      .toBe("Room for 100 of the 120 guests with the doors kept clear; the venue publishes 180 for a seated dinner.");
    expect(usePlacementStore.getState().placedItems).toHaveLength(0);

    fireEvent.click(lens.getByTestId("auto-fill-place"));
    const placed = usePlacementStore.getState().placedItems;
    expect(seatingCountsFromPlacedItems(placed)).toEqual({ roundTables: 10, banquetTables: 0, chairs: 100 });
    expect(doorBlockers(placed, GRAND_HALL_DOOR_CLEAR_SPACES)).toEqual([]);
    expect(lens.getByTestId("auto-fill-result-short").textContent)
      .toBe("Room for 100 of the 120 guests with the doors kept clear; the venue publishes 180 for a seated dinner.");
  });

  it("says when the doors are what leave no room for the tables a guest count needs", () => {
    // One round of ten for 20 guests, in a room whose only free floor is in front of its doors.
    useDoorClearSpaceStore.getState().setRoomSpaces([
      { id: "door-test", name: "the door", rect: { minX: -10.5, maxX: 10.5, minZ: -5.25, maxZ: 5.25 }, inward: [0, -1] },
    ]);
    usePlacementStore.setState({ placedItems: [...createTableGroup(ROUND, 0, -0.75, 0, 10)] });
    useCockpitStore.getState().setPlannedGuestCount(20);
    const lens = openGuests(phone);
    expect(lens.getByTestId("guests-seat-fix-no-room").textContent)
      .toContain("The tables are full, and there is no room for another at this spacing with the doors kept clear.");
  });
});
