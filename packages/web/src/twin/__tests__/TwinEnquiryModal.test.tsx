import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { TwinEnquiryModal } from "../TwinEnquiryModal.js";

// -----------------------------------------------------------------------------
// TwinEnquiryModal — the one-click, stay-in-the-twin enquiry (finding [2]).
//
// Renders under happy-dom; the network call is mocked. We pin the contract that
// matters: a valid submit posts a VENUE-anchored enquiry (venueSlug, not a
// config) and reaches the success state; an invalid email is blocked before any
// network call.
// -----------------------------------------------------------------------------

const { submitMock } = vi.hoisted(() => ({ submitMock: vi.fn() }));
vi.mock("../../api/configurations.js", () => ({ submitGuestEnquiry: submitMock }));

function renderModal(): void {
  render(
    <TwinEnquiryModal
      venueSlug="trades-hall"
      venueName="Trades Hall Glasgow"
      onClose={vi.fn()}
    />,
  );
}

describe("TwinEnquiryModal", () => {
  beforeEach(() => {
    submitMock.mockReset();
    submitMock.mockResolvedValue({ enquiryId: "e1", message: "ok" });
  });

  afterEach(() => {
    cleanup();
  });

  it("posts a venue-anchored enquiry and shows the success state", async () => {
    renderModal();
    fireEvent.change(screen.getByLabelText(/^email/i), {
      target: { value: "guest@example.com" },
    });
    fireEvent.submit(screen.getByTestId("twin-enquiry-form"));
    await waitFor(() => {
      expect(submitMock).toHaveBeenCalledWith(
        expect.objectContaining({ venueSlug: "trades-hall", email: "guest@example.com" }),
      );
    });
    expect(await screen.findByText(/your enquiry is on its way/i)).toBeTruthy();
  });

  it("blocks submit on an invalid email — no network call", () => {
    renderModal();
    fireEvent.change(screen.getByLabelText(/^email/i), {
      target: { value: "not-an-email" },
    });
    fireEvent.submit(screen.getByTestId("twin-enquiry-form"));
    expect(submitMock).not.toHaveBeenCalled();
    expect(screen.getByRole("alert")).toBeTruthy();
  });
});
