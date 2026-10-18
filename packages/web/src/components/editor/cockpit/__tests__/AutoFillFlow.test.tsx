import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within, type BoundFunctions, type queries } from "@testing-library/react";
import type { TradesHallVenueStatus } from "../../../../hooks/use-trades-hall-venue.js";
import type { PlacedItem } from "../../../../lib/placement.js";

// ---------------------------------------------------------------------------
// The planner's first ten seconds, the part that places furniture (redteam
// fix-first 15): auto-fill asks "How many guests?" first, says plainly when
// the room is full at its spacing, and a seat shortfall gets one tap. Each
// flow runs in the desktop dock and inside the phone's lens sheet at 375 px.
// ---------------------------------------------------------------------------

const venue = vi.hoisted(() => ({ status: "trades-hall" as TradesHallVenueStatus }));
vi.mock("../../../../hooks/use-trades-hall-venue.js", () => ({
  useTradesHallVenueStatus: () => venue.status,
  useTradesHallVenue: () => venue.status === "trades-hall",
}));

const { GuestsLensPanel } = await import("../GuestsLensPanel.js");
const { LensSheet } = await import("../LensSheet.js");
const { ShareLensPanel } = await import("../ShareLensPanel.js");
const { usePlacementStore } = await import("../../../../stores/placement-store.js");
const { useRoomDimensionsStore } = await import("../../../../stores/room-dimensions-store.js");
const { useCockpitStore } = await import("../../../../stores/cockpit-store.js");
const { useAutoFillRequestStore } = await import("../../../../stores/auto-fill-request-store.js");
const { getCatalogueItemBySlug } = await import("../../../../lib/catalogue.js");
const { createTableGroup } = await import("../../../../lib/table-group.js");
const { seatingCountsFromPlacedItems } = await import("../../../../lib/seating-counts.js");
const { planAutoFill } = await import("../../../../lib/auto-fill.js");
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

function reduceMotion(): void {
  vi.spyOn(window, "matchMedia").mockImplementation((query: string): MediaQueryList => ({
    matches: query.includes("prefers-reduced-motion"),
    media: query,
    onchange: null,
    addListener: () => undefined,
    removeListener: () => undefined,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
    dispatchEvent: () => false,
  }));
}

/** The Guests lens as the viewport shows it: the dock on a desk, the sheet on a phone. */
function openGuests(phone: boolean): BoundFunctions<typeof queries> {
  if (!phone) {
    render(<GuestsLensPanel />);
    return within(screen.getByTestId("guests-lens-panel"));
  }
  useCockpitStore.getState().setMode("guests");
  render(<LensSheet />);
  return within(screen.getByRole("dialog", { name: "Guests" }));
}

function counts(): ReturnType<typeof seatingCountsFromPlacedItems> {
  return seatingCountsFromPlacedItems(usePlacementStore.getState().placedItems);
}

function roundsAt(positions: readonly (readonly [number, number])[], chairs: number): PlacedItem[] {
  return positions.flatMap(([x, z]) => [...createTableGroup(ROUND, x, z, 0, chairs)]);
}

const EIGHT_ROUNDS = [-6.435, -2.145, 2.145, 6.435].flatMap((x) => [[x, -2.145], [x, 2.145]] as const);

function fullHall(): PlacedItem[] {
  const plan = planAutoFill("dinner-rounds", 0, 21, 10.5);
  if (plan === null || plan.style !== "dinner-rounds") throw new Error("no fill");
  return roundsAt(plan.tables.map((t) => [t.xM, t.zM] as const), 10);
}

beforeEach(() => {
  venue.status = "trades-hall";
  usePlacementStore.setState({ placedItems: [] });
  useCockpitStore.getState().reset();
  useAutoFillRequestStore.setState({ requested: null });
  // The Grand Hall's real floor: 21 × 10.5 m.
  useRoomDimensionsStore.getState().setDimensions({ width: 21, length: 10.5, height: 7 });
  fixtures.resetPlannerTruth();
  fixtures.openRoom(fixtures.plannerRoom());
  reduceMotion();
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  restoreWidth?.();
  restoreWidth = null;
  useCockpitStore.getState().reset();
  fixtures.resetPlannerTruth();
});

describe.each(VIEWPORTS)("auto-fill asks for the guest count first ($label)", ({ width, phone }) => {
  beforeEach(() => { setViewportWidth(width); });

  it("asks before placing anything, beside the published figure and who stated it", async () => {
    const lens = openGuests(phone);
    fireEvent.click(lens.getByTestId("guests-build-dinner-rounds"));

    const prompt = lens.getByTestId("auto-fill-prompt");
    expect(within(prompt).getByText("How many guests?")).toBeTruthy();
    const input = lens.getByTestId<HTMLInputElement>("auto-fill-guests");
    expect(input.value).toBe("");
    await waitFor(() => { expect(document.activeElement).toBe(input); });
    expect(lens.getByTestId("auto-fill-published").textContent)
      .toBe("The venue publishes 180 for a seated dinner.Published guide · Trades Hall · 9 Jul 2026");
    const place = lens.getByTestId<HTMLButtonElement>("auto-fill-place");
    expect(place.disabled).toBe(true);
    expect(place.textContent).toBe("Lay out the room");
    expect(usePlacementStore.getState().placedItems).toHaveLength(0);
    // No modal on a modal: on a phone the question lives in the lens sheet.
    expect(screen.queryAllByRole("dialog")).toHaveLength(phone ? 1 : 0);
  });

  it("prefills the guest count already set", () => {
    useCockpitStore.getState().setPlannedGuestCount(120);
    const lens = openGuests(phone);
    fireEvent.click(lens.getByTestId("guests-build-dinner-rounds"));
    expect(lens.getByTestId<HTMLInputElement>("auto-fill-guests").value).toBe("120");
    expect(lens.getByTestId("auto-fill-place").textContent).toBe("Place 12 tables and 120 chairs");
    expect(lens.getByTestId("auto-fill-basis").textContent).toBe("Rounds of 10, with 0.6 m clear behind every chair.");
    expect(lens.queryByTestId("auto-fill-short")).toBeNull();
  });

  it("for 220 in the Grand Hall, says the room is full at this spacing, then places 14 rounds of ten", async () => {
    const lens = openGuests(phone);
    fireEvent.click(lens.getByTestId("guests-build-dinner-rounds"));
    fireEvent.change(lens.getByTestId("auto-fill-guests"), { target: { value: "220" } });

    expect(lens.getByTestId("auto-fill-place").textContent).toBe("Place 14 tables and 140 chairs");
    expect(lens.getByTestId("auto-fill-short").textContent)
      .toBe("Room for 140 at this spacing; the venue publishes 180 for a seated dinner.");
    expect(usePlacementStore.getState().placedItems).toHaveLength(0);

    fireEvent.click(lens.getByTestId("auto-fill-place"));
    expect(counts()).toEqual({ roundTables: 14, banquetTables: 0, chairs: 140 });
    expect(useCockpitStore.getState().plannedGuestCount).toBe(220);
    const result = lens.getByTestId("auto-fill-result");
    expect(lens.getByTestId("auto-fill-placed").textContent).toBe("Placed 14 round tables and 140 chairs.");
    expect(lens.getByTestId("auto-fill-result-short").textContent)
      .toBe("Room for 140 at this spacing; the venue publishes 180 for a seated dinner.");
    await waitFor(() => { expect(document.activeElement).toBe(result); });
    // The published section still carries the venue's way forward above 180.
    expect(lens.getByTestId("guests-above-published-ask")).toBeTruthy();
  });

  it("goes back to the two choices without placing anything", async () => {
    const lens = openGuests(phone);
    fireEvent.click(lens.getByTestId("guests-build-dinner-rounds"));
    fireEvent.click(lens.getByTestId("auto-fill-back"));
    expect(lens.queryByTestId("auto-fill-prompt")).toBeNull();
    const choice = lens.getByTestId("guests-build-dinner-rounds");
    await waitFor(() => { expect(document.activeElement).toBe(choice); });
    expect(usePlacementStore.getState().placedItems).toHaveLength(0);
  });

  it("will not place for a count it cannot use", () => {
    const lens = openGuests(phone);
    fireEvent.click(lens.getByTestId("guests-build-dinner-rounds"));
    fireEvent.change(lens.getByTestId("auto-fill-guests"), { target: { value: "0" } });
    expect(lens.getByTestId("auto-fill-invalid").textContent).toBe("Enter a number of guests from 1 to 500.");
    expect(lens.getByTestId<HTMLButtonElement>("auto-fill-place").disabled).toBe(true);
    fireEvent.submit(lens.getByTestId("auto-fill-prompt"));
    expect(usePlacementStore.getState().placedItems).toHaveLength(0);
  });

  it("asks the same question for theatre, against the theatre figure", () => {
    const lens = openGuests(phone);
    fireEvent.click(lens.getByTestId("guests-build-theatre"));
    fireEvent.change(lens.getByTestId("auto-fill-guests"), { target: { value: "220" } });
    expect(lens.getByTestId("auto-fill-published").textContent).toContain("The venue publishes 250 for theatre.");
    expect(lens.getByTestId("auto-fill-place").textContent).toBe("Place 224 chairs in 16 rows");
    fireEvent.click(lens.getByTestId("auto-fill-place"));
    expect(counts()).toEqual({ roundTables: 0, banquetTables: 0, chairs: 224 });
  });
});

describe.each(VIEWPORTS)("a seat shortfall offers one tap ($label)", ({ width, phone }) => {
  beforeEach(() => { setViewportWidth(width); });

  it("adds the 16 chairs 80 guests need at eight rounds of eight", () => {
    usePlacementStore.setState({ placedItems: roundsAt(EIGHT_ROUNDS, 8) });
    useCockpitStore.getState().setPlannedGuestCount(80);
    const lens = openGuests(phone);
    expect(lens.getByTestId("guests-seat-summary").textContent).toMatch(/Short 16 seats for 80 guests/);
    const action = lens.getByTestId("guests-seat-fix-action");
    expect(action.textContent).toBe("Add 16 chairs at the tables");
    expect(lens.getByTestId("guests-seat-fix-detail").textContent).toBe("Spread over 8 tables, up to 10 at each.");

    fireEvent.click(action);
    expect(counts().chairs).toBe(80);
    expect(lens.getByTestId("guests-seat-fix-done").textContent).toBe("Added 16 chairs at 8 tables.");
    expect(lens.getByTestId("guests-seat-fix-done").getAttribute("role")).toBe("status");
    expect(lens.queryByTestId("guests-seat-fix-action")).toBeNull();
    expect(lens.getByTestId("guests-seat-chip").textContent).toBe("Every guest seated");
  });

  it("adds tables for the rest once the tables are full", () => {
    usePlacementStore.setState({ placedItems: roundsAt([[0, 0]], 10) });
    useCockpitStore.getState().setPlannedGuestCount(26);
    const lens = openGuests(phone);
    const action = lens.getByTestId("guests-seat-fix-action");
    expect(action.textContent).toBe("Add tables for 16");
    fireEvent.click(action);
    expect(counts()).toEqual({ roundTables: 3, banquetTables: 0, chairs: 26 });
    expect(lens.getByTestId("guests-seat-fix-done").textContent).toBe("Added 2 tables and 16 chairs.");
  });

  it("says when the hall is full at this spacing, leaving the venue's ask to the published section above 180", () => {
    usePlacementStore.setState({ placedItems: fullHall() });
    useCockpitStore.getState().setPlannedGuestCount(220);
    const lens = openGuests(phone);
    expect(lens.queryByTestId("guests-seat-fix-action")).toBeNull();
    expect(lens.getByTestId("guests-seat-fix-no-room").textContent)
      .toBe("The tables are full, and there is no room for another at this spacing. The venue publishes 180 for a seated dinner.");
    expect(lens.queryByTestId("guests-seat-fix-ask")).toBeNull();
    expect(lens.getByTestId("guests-above-published-ask")).toBeTruthy();
  });

  it("offers the events team when the hall is full at this spacing below the published figure", () => {
    usePlacementStore.setState({ placedItems: fullHall() });
    useCockpitStore.getState().setPlannedGuestCount(170);
    const lens = openGuests(phone);
    const ask = lens.getByTestId("guests-seat-fix-ask");
    expect(ask.textContent).toBe("Ask the events team");
    const href = ask.getAttribute("href") ?? "";
    expect(href.startsWith("mailto:")).toBe(true);
    expect(decodeURIComponent(href)).toContain("We are planning 170 guests for a seated dinner in the Grand Hall. The plan has 140 seats, with no room for another table at the online planner's spacing.");
    expect(decodeURIComponent(href)).not.toMatch(/\bfits?\b/);
  });

  it("gives the Share lens the same way forward when the hall is full at this spacing", () => {
    usePlacementStore.setState({ placedItems: fullHall() });
    useCockpitStore.getState().setPlannedGuestCount(170);
    render(<ShareLensPanel />);
    const share = within(screen.getByTestId("share-lens-panel"));
    expect(share.getByTestId("share-layout-summary").textContent).toContain("30 seats short of 170 guests");
    expect(share.queryByTestId("share-seat-fix-statement")).toBeNull();
    expect(share.queryByTestId("share-seat-fix-action")).toBeNull();
    expect(share.getByTestId("share-seat-fix-no-room").textContent)
      .toBe("The tables are full, and there is no room for another at this spacing.");
    const ask = share.getByTestId("share-seat-fix-ask");
    expect(ask.textContent).toBe("Ask the events team");
    expect(decodeURIComponent(ask.getAttribute("href") ?? "")).toContain("The plan has 140 seats, with no room for another table at the online planner's spacing.");
  });
});

describe("the command deck's Auto-fill asks in the Guests lens", () => {
  it("opens the question for banquet rounds and takes the request once", () => {
    useAutoFillRequestStore.getState().request("dinner-rounds");
    render(<GuestsLensPanel />);
    expect(screen.getByTestId("auto-fill-prompt").getAttribute("data-style")).toBe("dinner-rounds");
    expect(useAutoFillRequestStore.getState().requested).toBeNull();
    expect(usePlacementStore.getState().placedItems).toHaveLength(0);
  });

  it("does not ask over furniture already on the floor", () => {
    usePlacementStore.setState({ placedItems: roundsAt([[0, 0]], 10) });
    useAutoFillRequestStore.getState().request("dinner-rounds");
    render(<GuestsLensPanel />);
    expect(screen.queryByTestId("auto-fill-prompt")).toBeNull();
    expect(useAutoFillRequestStore.getState().requested).toBeNull();
  });
});
