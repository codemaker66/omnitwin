import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { findUnsupportedProposalClaim } from "@omnitwin/types";
import type { VenueDetail } from "../../../api/spaces.js";

const mocks = vi.hoisted(() => ({ getVenue: vi.fn(), submit: vi.fn() }));
vi.mock("../../../api/spaces.js", () => ({ getVenue: mocks.getVenue }));
vi.mock("../../../api/configurations.js", () => ({ submitGuestEnquiry: mocks.submit }));

const { GuestEnquiryModal } = await import("../GuestEnquiryModal.js");
import { useEditorStore } from "../../../stores/editor-store.js";
import { usePlacementStore } from "../../../stores/placement-store.js";
import { useRoomDimensionsStore } from "../../../stores/room-dimensions-store.js";
import { GRAND_HALL_RENDER_DIMENSIONS } from "../../../constants/scale.js";
import { CATALOGUE_ITEMS } from "../../../lib/catalogue.js";
import type { PlacedItem } from "../../../lib/placement.js";
import * as plannerTruthFixtures from "../cockpit/__tests__/planner-truth-fixtures.js";

/** Round tables on the floor, which the venue's figures read as a dinner. */
function withRounds(count: number): PlacedItem[] {
  const round = CATALOGUE_ITEMS.find((item) => item.category === "table" && item.tableShape === "round");
  if (round === undefined) throw new Error("No round table in the catalogue");
  return Array.from({ length: count }, (_unused, index) => ({
    id: `round-${String(index)}`,
    catalogueItemId: round.id,
    x: 0, y: 0, z: 0, rotationY: 0,
    clothed: false, clothStyle: null, tableSetting: null, chairStyle: null, centerpiece: null, groupId: null,
  }));
}

function resetStores(): void {
  usePlacementStore.setState({
    placedItems: [],
    ghostPosition: null,
    ghostRotation: 0,
    ghostValid: false,
    ghostInvalidReason: null,
    snapEnabled: true,
  });
  useRoomDimensionsStore.setState({ dimensions: GRAND_HALL_RENDER_DIMENSIONS });
}

// ---------------------------------------------------------------------------
// The venue's published figure, never floor area ÷ generic spacing (redteam
// fix-first 1): the form once told a visitor "comfortable for around 339" in
// a Grand Hall the venue publishes at 250 standing.
// ---------------------------------------------------------------------------
describe("GuestEnquiryModal states the venue's published capacity", () => {
  const tradesHall: VenueDetail = {
    id: plannerTruthFixtures.TRADES_HALL_VENUE_ID, name: "Trades Hall", slug: "trades-hall-glasgow",
    address: "85 Glassford Street", logoUrl: null, brandColour: null, spaces: [],
  };

  beforeEach(() => {
    resetStores();
    mocks.getVenue.mockReset();
    mocks.getVenue.mockResolvedValue(tradesHall);
    plannerTruthFixtures.openRoom(plannerTruthFixtures.plannerRoom());
  });
  afterEach(() => {
    cleanup();
    resetStores();
    useEditorStore.getState().reset();
  });

  it("shows nothing until a guest count is entered", async () => {
    render(<GuestEnquiryModal configId="cfg-1" onClose={() => { /* noop */ }} />);
    await screen.findByText(/shared only with the/u);
    expect(screen.queryByTestId("enquiry-capacity-guidance")).toBeNull();
  });

  it("states every published figure, with who stated it and when, before a layout is drawn", async () => {
    render(<GuestEnquiryModal configId="cfg-1" onClose={() => { /* noop */ }} />);
    fireEvent.change(screen.getByLabelText("Guest count"), { target: { value: "120" } });

    const guidance = await screen.findByTestId("enquiry-capacity-guidance");
    expect(guidance.textContent).toContain(
      "The venue publishes 250 for theatre, 80 for classroom, 180 for dinner and 250 for reception in the Grand Hall.",
    );
    expect(screen.getByTestId("enquiry-capacity-source").textContent).toBe("Published guide · Trades Hall · 9 Jul 2026");
  });

  it("reads round tables as dinner and says what happens above the published figure", async () => {
    usePlacementStore.setState({ placedItems: withRounds(25) });
    render(<GuestEnquiryModal configId="cfg-1" onClose={() => { /* noop */ }} />);
    fireEvent.change(screen.getByLabelText("Guest count"), { target: { value: "200" } });

    const guidance = await screen.findByTestId("enquiry-capacity-guidance");
    expect(guidance.textContent).toContain("The venue publishes 180 for dinner in the Grand Hall.");
    expect(guidance.textContent).toContain("200 guests is more than the published 180 for dinner.");
    expect(guidance.textContent).toContain("The events team will say what is possible when they reply.");
  });

  it("never states a computed count or a comfort verdict", async () => {
    render(<GuestEnquiryModal configId="cfg-1" onClose={() => { /* noop */ }} />);
    fireEvent.change(screen.getByLabelText("Guest count"), { target: { value: "500" } });

    const guidance = await screen.findByTestId("enquiry-capacity-guidance");
    const text = guidance.textContent ?? "";
    expect(text).not.toMatch(/\b(339|275|147|comfortable|within|fits)\b/iu);
    expect(findUnsupportedProposalClaim(text)).toBeNull();
  });

  it("clears again when the guest count is emptied", async () => {
    render(<GuestEnquiryModal configId="cfg-1" onClose={() => { /* noop */ }} />);
    const input = screen.getByLabelText("Guest count");

    fireEvent.change(input, { target: { value: "120" } });
    expect(await screen.findByTestId("enquiry-capacity-guidance")).toBeTruthy();

    fireEvent.change(input, { target: { value: "" } });
    expect(screen.queryByTestId("enquiry-capacity-guidance")).toBeNull();
  });

  it("states no figure for another venue's room of the same name", async () => {
    const elsewhere: VenueDetail = { ...tradesHall, id: "venue-grand-elsewhere", name: "Elsewhere", slug: "elsewhere" };
    mocks.getVenue.mockResolvedValue(elsewhere);
    plannerTruthFixtures.openRoom(plannerTruthFixtures.plannerRoom("grand-hall", "Grand Hall", elsewhere.id));
    render(<GuestEnquiryModal configId="cfg-1" onClose={() => { /* noop */ }} />);
    fireEvent.change(screen.getByLabelText("Guest count"), { target: { value: "120" } });

    expect(await screen.findByText("Your details are shared only with the Elsewhere events team.")).toBeTruthy();
    expect(screen.queryByTestId("enquiry-capacity-guidance")).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// The layout's own venue, never a hard-coded one (T-635 N5, item 1). The form
// told every venue's guests that "Trades Hall will reply" and that their
// details went to "the Trades Hall events team".
// ---------------------------------------------------------------------------
describe("GuestEnquiryModal names the layout's own venue", () => {
  const cityRooms: VenueDetail = {
    id: "venue-city", name: "City Rooms", slug: "city-rooms", address: "1 Example Street",
    logoUrl: null, brandColour: null, spaces: [],
  };

  beforeEach(() => {
    resetStores();
    mocks.getVenue.mockReset();
    mocks.submit.mockReset();
  });
  afterEach(() => {
    cleanup();
    resetStores();
    useEditorStore.getState().reset();
  });

  it("says whose team gets the details and who replies", async () => {
    mocks.getVenue.mockResolvedValue(cityRooms);
    mocks.submit.mockResolvedValue({});
    useEditorStore.setState({ venueId: cityRooms.id });
    render(<GuestEnquiryModal configId="cfg-1" onClose={() => { /* noop */ }} />);

    expect(await screen.findByText("Your details are shared only with the City Rooms events team.")).toBeTruthy();
    fireEvent.change(screen.getByLabelText(/email/iu), { target: { value: "guest@example.test" } });
    fireEvent.click(screen.getByRole("button", { name: "Send to Events Team" }));
    expect(await screen.findByText("City Rooms will reply to")).toBeTruthy();
    expect(document.body.textContent ?? "").not.toMatch(/Trades Hall/u);
  });

  it("names no venue until it knows which, and never a placeholder", async () => {
    mocks.getVenue.mockRejectedValue(new Error("offline"));
    useEditorStore.setState({ venueId: cityRooms.id });
    render(<GuestEnquiryModal configId="cfg-1" onClose={() => { /* noop */ }} />);

    expect(await screen.findByText("Your details are shared only with this venue's events team.")).toBeTruthy();
    expect(document.body.textContent ?? "").not.toMatch(/Venue unavailable|Trades Hall/u);
  });
});
