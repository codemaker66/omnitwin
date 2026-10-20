import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { TradesHallVenueStatus } from "../../../../hooks/use-trades-hall-venue.js";
import type { CatalogueItem } from "../../../../lib/catalogue.js";
import type { PlacedItem } from "../../../../lib/placement.js";

const venue = vi.hoisted(() => ({ status: "trades-hall" as TradesHallVenueStatus }));
vi.mock("../../../../hooks/use-trades-hall-venue.js", () => ({
  useTradesHallVenueStatus: () => venue.status,
  useTradesHallVenue: () => venue.status === "trades-hall",
}));

const { GuestsLensPanel } = await import("../GuestsLensPanel.js");
const { usePlacementStore } = await import("../../../../stores/placement-store.js");
const { useRoomDimensionsStore } = await import("../../../../stores/room-dimensions-store.js");
const { useCockpitStore } = await import("../../../../stores/cockpit-store.js");
const { CATALOGUE_ITEMS } = await import("../../../../lib/catalogue.js");
const fixtures = await import("./planner-truth-fixtures.js");

function find(predicate: (item: CatalogueItem) => boolean, label: string): CatalogueItem {
  const item = CATALOGUE_ITEMS.find(predicate);
  if (item === undefined) throw new Error(`No catalogue item for ${label}`);
  return item;
}
const roundTable = (): CatalogueItem => find((c) => c.category === "table" && c.tableShape === "round", "round table");
const chair = (): CatalogueItem => find((c) => c.category === "chair", "chair");
const blackCloth = (): CatalogueItem => find((c) => c.slug === "black-table-cloth", "black table cloth");

function place(item: CatalogueItem, n: number): PlacedItem[] {
  return Array.from({ length: n }, (_unused, index) => ({
    id: `${item.slug}-${String(index)}`,
    catalogueItemId: item.id,
    x: 0, y: 0, z: 0, rotationY: 0,
    clothed: false, clothStyle: null, tableSetting: null, chairStyle: null, centerpiece: null, groupId: null,
  }));
}
const withChairs = (chairs: number): PlacedItem[] => [...place(roundTable(), 8), ...place(chair(), chairs)];

beforeEach(() => {
  venue.status = "trades-hall";
  usePlacementStore.setState({ placedItems: [] });
  useCockpitStore.getState().reset();
  // The Grand Hall's real floor: 21 × 10.5 m = 220.5 m².
  useRoomDimensionsStore.getState().setDimensions({ width: 21, length: 10.5, height: 7 });
  fixtures.resetPlannerTruth();
  fixtures.openRoom(fixtures.plannerRoom());
});

afterEach(() => { cleanup(); fixtures.resetPlannerTruth(); });

describe("GuestsLensPanel — the venue's published figures lead", () => {
  it("leads with the Grand Hall's published figures and who stated them", () => {
    render(<GuestsLensPanel />);
    expect(screen.getByTestId("guests-published-dinner").textContent).toContain("180");
    expect(screen.getByTestId("guests-published-reception").textContent).toContain("250");
    expect(screen.getByTestId("guests-published-theatre").textContent).toContain("250");
    expect(screen.getByTestId("guests-published-classroom").textContent).toContain("80");
    expect(screen.getByTestId("guests-published-source").textContent).toBe("Published guide · Trades Hall · 9 Jul 2026");
  });

  it("puts the published figures first, before anything the planner types", () => {
    render(<GuestsLensPanel />);
    const labels = Array.from(screen.getByTestId("guests-lens-panel").querySelectorAll(".lens-panel__section-label"))
      .map((label) => label.textContent);
    expect(labels[0]).toBe("Published capacity");
  });

  it("reads standing poseur tables as the planner's cocktail style, against the reception figure", () => {
    const poseur = find((c) => c.slug.startsWith("poseur-table"), "poseur table");
    usePlacementStore.setState({ placedItems: place(poseur, 30) });
    render(<GuestsLensPanel />);
    expect(screen.getByTestId("guests-published-reception").getAttribute("aria-current")).toBe("true");
    expect(screen.getByTestId("guests-published-reception").textContent).toContain("250");
  });

  it("reads round tables as dinner and marks that published figure as the layout's", () => {
    usePlacementStore.setState({ placedItems: withChairs(80) });
    render(<GuestsLensPanel />);
    const dinner = screen.getByTestId("guests-published-dinner");
    expect(dinner.getAttribute("aria-current")).toBe("true");
    expect(dinner.textContent).toContain("Your layout");
    expect(screen.getByTestId("guests-published-reception").getAttribute("aria-current")).toBeNull();
  });

  it("shows another room's own published figures", () => {
    fixtures.openRoom(fixtures.plannerRoom("saloon", "Saloon"));
    render(<GuestsLensPanel />);
    expect(screen.getByTestId("guests-published-dinner").textContent).toContain("60");
    expect(screen.getByTestId("guests-published-reception").textContent).toContain("80");
  });

  it("asks the events team when the guest count is above the published figure", () => {
    usePlacementStore.setState({ placedItems: withChairs(200) });
    useCockpitStore.getState().setPlannedGuestCount(200);
    render(<GuestsLensPanel />);
    expect(screen.getByTestId("guests-above-published").textContent).toContain("200 guests is more than the published 180 for dinner.");
    const ask = screen.getByTestId("guests-above-published-ask");
    expect(ask.textContent).toBe("Ask the events team");
    expect(ask.getAttribute("href")).toMatch(/^mailto:info@tradeshallglasgow\.co\.uk\?/);
  });

  it("offers staff the hallkeeper for a count above the published figure", () => {
    fixtures.viewAsStaff();
    usePlacementStore.setState({ placedItems: withChairs(200) });
    useCockpitStore.getState().setPlannedGuestCount(200);
    render(<GuestsLensPanel />);
    expect(screen.getByTestId("guests-above-published-ask").textContent).toBe("Ask the hallkeeper");
  });

  it("says nothing about a count at or below the published figure", () => {
    usePlacementStore.setState({ placedItems: withChairs(150) });
    useCockpitStore.getState().setPlannedGuestCount(150);
    render(<GuestsLensPanel />);
    expect(screen.queryByTestId("guests-above-published")).toBeNull();
  });

  it("never borrows Trades Hall's figures for another venue's room of the same name", () => {
    venue.status = "other";
    fixtures.openRoom(fixtures.plannerRoom("grand-hall", "Grand Hall", "venue-elsewhere"));
    render(<GuestsLensPanel />);
    expect(screen.queryByTestId("guests-published")).toBeNull();
    expect(screen.getByTestId("guests-published-missing").textContent).toContain("Not recorded");
  });

  it("shows honest work while the venue is being read", () => {
    venue.status = "reading";
    render(<GuestsLensPanel />);
    expect(screen.getByTestId("guests-published-reading").textContent).toContain("Reading the venue");
    expect(screen.getByTestId("guests-published-reading").querySelector("[data-activity-indicator]")).not.toBeNull();
  });

  it("shows honest work while the room itself is being read", () => {
    fixtures.roomPending();
    render(<GuestsLensPanel />);
    expect(screen.getByTestId("guests-published-reading").textContent).toContain("Reading the venue");
  });

  it("stops working and offers the events team when the room could not be read", () => {
    fixtures.roomPending(fixtures.TRADES_HALL_VENUE_ID, true);
    render(<GuestsLensPanel />);
    expect(screen.queryByTestId("guests-published-reading")).toBeNull();
    expect(screen.getByTestId("guests-published-missing-status").textContent).toBe("Not recorded");
    expect(screen.getByTestId("guests-published-missing-ask").textContent).toBe("Ask the events team");
  });
});

describe("GuestsLensPanel — computed counts are staff-only and never a verdict", () => {
  it("shows a visitor no computed count at all", () => {
    render(<GuestsLensPanel />);
    expect(screen.queryByTestId("guests-estimates")).toBeNull();
    const text = screen.getByTestId("guests-lens-panel").textContent ?? "";
    expect(text).not.toContain("339");
    expect(text).not.toContain("147");
  });

  it("shows a client no computed count either", () => {
    fixtures.viewAsClient();
    render(<GuestsLensPanel />);
    expect(screen.queryByTestId("guests-estimates")).toBeNull();
  });

  it("shows staff the generic-spacing arithmetic, labelled as an estimate", () => {
    fixtures.viewAsStaff();
    render(<GuestsLensPanel />);
    expect(screen.getByText("Estimate at generic spacing")).toBeTruthy();
    expect(screen.getByTestId("guests-estimate-cocktail").textContent).toContain("339");
    expect(screen.getByTestId("guests-estimate-dinner-rounds").textContent).toContain("147");
    expect(screen.getByTestId("guests-estimate-theatre").textContent).toContain("275");
    expect(screen.getByTestId("guests-estimates-basis").textContent).toContain("not the venue's figure");
  });

  it("has no fits, tight or over chips for anyone", () => {
    fixtures.viewAsStaff();
    useCockpitStore.getState().setPlannedGuestCount(300);
    usePlacementStore.setState({ placedItems: withChairs(80) });
    render(<GuestsLensPanel />);
    const text = screen.getByTestId("guests-lens-panel").textContent ?? "";
    expect(text).not.toMatch(/\b(fits|tight|over capacity|comfortable)\b/i);
    expect(screen.queryByTestId("guests-comfort-chip")).toBeNull();
    expect(screen.queryByTestId("guests-style-fit-theatre")).toBeNull();
  });
});

describe("GuestsLensPanel — seats and building the room", () => {
  it.each(["dinner-rounds", "theatre"])("builds new %s layouts with supplied chair models", (style) => {
    useCockpitStore.getState().setPlannedGuestCount(16);
    render(<GuestsLensPanel />);
    fireEvent.click(screen.getByTestId(`guests-build-${style}`));
    // It asks how many guests first; nothing is placed until the answer.
    expect(usePlacementStore.getState().placedItems).toHaveLength(0);
    fireEvent.click(screen.getByTestId("auto-fill-place"));
    const items = usePlacementStore.getState().placedItems;
    const turini = find((item) => item.slug === "burgess-turini-18-3", "Turini");
    const whiteRound = find((item) => item.slug === "round-table-6ft-white", "white round");
    expect(items.length).toBeGreaterThan(0);
    expect(items.filter((item) => item.catalogueItemId === turini.id).length).toBeGreaterThan(0);
    expect(items.every((item) => item.catalogueItemId === turini.id || (style === "dinner-rounds" && item.catalogueItemId === whiteRound.id))).toBe(true);
  });

  it("prompts for a guest count when none is set", () => {
    usePlacementStore.setState({ placedItems: withChairs(80) });
    render(<GuestsLensPanel />);
    expect(screen.getByText("Guests & seating")).toBeTruthy();
    expect(screen.getByTestId("guests-seat-chip").textContent).toBe("No guest count");
  });

  it("writes the shared guest count and reports exact seating", () => {
    usePlacementStore.setState({ placedItems: withChairs(80) });
    render(<GuestsLensPanel />);
    fireEvent.change(screen.getByTestId("guests-count"), { target: { value: "80" } });
    expect(useCockpitStore.getState().plannedGuestCount).toBe(80);
    expect(screen.getByTestId("guests-seat-chip").textContent).toBe("Every guest seated");
    expect(screen.getByTestId("guests-seat-summary").textContent).toMatch(/Exactly 80 seats for 80 guests/);
  });

  it("flags a seat shortfall when guests exceed placed seats", () => {
    usePlacementStore.setState({ placedItems: withChairs(80) });
    useCockpitStore.getState().setPlannedGuestCount(120);
    render(<GuestsLensPanel />);
    expect(screen.getByTestId("guests-seat-chip").textContent).toBe("Short 40");
    expect(screen.getByTestId("guests-seat-summary").textContent).toMatch(/Short 40 seats for 120 guests/);
  });

  it("retains a leaked applicator without treating it as furniture on the floor", () => {
    const leaked = place(blackCloth(), 1);
    usePlacementStore.setState({ placedItems: leaked });
    render(<GuestsLensPanel />);
    expect(usePlacementStore.getState().placedItems).toEqual(leaked);
    expect(screen.getByTestId("guests-build-dinner-rounds")).toBeTruthy();
    expect(screen.queryByTestId("guests-build-blocked")).toBeNull();
  });
});
