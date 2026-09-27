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

describe("GuestEnquiryModal capacity guidance (T-429)", () => {
  beforeEach(resetStores);
  afterEach(() => {
    cleanup();
    resetStores();
  });

  it("shows no capacity guidance until a guest count is entered", () => {
    render(<GuestEnquiryModal configId="cfg-1" onClose={() => { /* noop */ }} />);
    expect(screen.queryByTestId("enquiry-capacity-guidance")).toBeNull();
  });

  it("surfaces planning-grade guidance keyed to the typed guest count", () => {
    render(<GuestEnquiryModal configId="cfg-1" onClose={() => { /* noop */ }} />);

    fireEvent.change(screen.getByLabelText("Guest count"), { target: { value: "120" } });

    const guidance = screen.getByTestId("enquiry-capacity-guidance");
    expect(guidance.textContent).toContain("For 120 guests:");
    expect(guidance.textContent).toContain("this room is comfortable for around");
    expect(guidance.textContent).toContain("human review required");
  });

  it("uses only SAFE, claim-guard-safe wording", () => {
    render(<GuestEnquiryModal configId="cfg-1" onClose={() => { /* noop */ }} />);
    fireEvent.change(screen.getByLabelText("Guest count"), { target: { value: "500" } });

    const guidance = screen.getByTestId("enquiry-capacity-guidance");
    expect(findUnsupportedProposalClaim(guidance.textContent ?? "")).toBeNull();
    expect(guidance.textContent ?? "").not.toMatch(/fire approved|approved for occupancy|legally compliant/i);
  });

  it("clears the guidance again when the guest count is emptied", () => {
    render(<GuestEnquiryModal configId="cfg-1" onClose={() => { /* noop */ }} />);
    const input = screen.getByLabelText("Guest count");

    fireEvent.change(input, { target: { value: "120" } });
    expect(screen.getByTestId("enquiry-capacity-guidance")).toBeTruthy();

    fireEvent.change(input, { target: { value: "" } });
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
