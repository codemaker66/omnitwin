import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { findUnsupportedProposalClaim } from "@omnitwin/types";
import { GuestEnquiryModal } from "../GuestEnquiryModal.js";
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
