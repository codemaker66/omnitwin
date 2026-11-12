import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { GUEST_ENQUIRY_LATEST_EVENT_DATE, GUEST_ENQUIRY_LIMITS, TRADES_HALL_ENQUIRY_VENUE_SLUG } from "@omnitwin/types";
import { TwinEnquiryModal } from "../TwinEnquiryModal.js";

// -----------------------------------------------------------------------------
// TwinEnquiryModal — the one-click, stay-in-the-twin enquiry (finding [2]).
//
// Renders under happy-dom; the network call is mocked. We pin the contract that
// matters: a valid submit posts a VENUE-anchored enquiry (venueSlug, not a
// config) and reaches the success state; an invalid email is blocked before any
// network call.
//
// The slug assertion is load-bearing. This test previously asserted the ASSET
// slug ("trades-hall"), which is not a row in `venues` — so it ratified the very
// bug that made every walkthrough enquiry 404. Asserting the exported constant
// (rather than a literal) is what stops the two namespaces drifting again.
// -----------------------------------------------------------------------------

const { submitMock } = vi.hoisted(() => ({ submitMock: vi.fn() }));
vi.mock("../../api/configurations.js", () => ({ submitGuestEnquiry: submitMock }));

function renderModal(): void {
  render(
    <TwinEnquiryModal
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
        expect.objectContaining({
          venueSlug: TRADES_HALL_ENQUIRY_VENUE_SLUG,
          email: "guest@example.com",
        }),
      );
    });
    expect(await screen.findByText(/enquiry sent/i)).toBeTruthy();
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

  // enquiries-crm-2: the API refuses a long name, telephone or message, or a
  // guest count past its limit, as "Validation failed", which this form then
  // shows with no field named. The fields take no more than the API accepts.
  it("takes no more in any field than the API accepts", () => {
    renderModal();
    const limits: readonly [string, number][] = [
      ["Your name", screen.getByRole<HTMLInputElement>("textbox", { name: "Your name" }).maxLength],
      ["Phone", screen.getByRole<HTMLInputElement>("textbox", { name: "Phone" }).maxLength],
      ["Anything else?", screen.getByRole<HTMLTextAreaElement>("textbox", { name: "Anything else?" }).maxLength],
      ["Guests", Number(screen.getByRole<HTMLInputElement>("spinbutton", { name: "Guests" }).max)],
    ];
    expect(limits).toEqual([
      ["Your name", GUEST_ENQUIRY_LIMITS.nameLength],
      ["Phone", GUEST_ENQUIRY_LIMITS.phoneLength],
      ["Anything else?", GUEST_ENQUIRY_LIMITS.messageLength],
      ["Guests", GUEST_ENQUIRY_LIMITS.guestCount],
    ]);
  });

  // Review of #405, F2: a date field with no max takes a year of five digits
  // (a doubled key), which the API refuses as "Validation failed".
  it("takes no year in the date field that the API refuses", () => {
    renderModal();
    const date = screen.getByLabelText<HTMLInputElement>("Event date");
    expect(date.type).toBe("date");
    expect(date.max).toBe(GUEST_ENQUIRY_LATEST_EVENT_DATE);
  });

  it("does not post a guest count past what the API accepts", () => {
    renderModal();
    fireEvent.change(screen.getByLabelText(/^email/i), { target: { value: "guest@example.com" } });
    const guests = screen.getByRole<HTMLInputElement>("spinbutton", { name: "Guests" });
    fireEvent.change(guests, { target: { value: String(GUEST_ENQUIRY_LIMITS.guestCount + 1) } });
    fireEvent.click(screen.getByRole("button", { name: "Send to the events team" }));
    expect(submitMock).not.toHaveBeenCalled();
    expect(guests.checkValidity()).toBe(false);
  });

  it("shows work during submission and removes it on failure", async () => {
    let rejectRequest: ((reason: Error) => void) | undefined;
    submitMock.mockImplementation(() => new Promise((_resolve, reject) => { rejectRequest = reject; }));
    renderModal();
    fireEvent.change(screen.getByLabelText(/^email/i), { target: { value: "guest@example.com" } });
    fireEvent.submit(screen.getByTestId("twin-enquiry-form"));
    const working = screen.getByRole("button", { name: /sending/i });
    expect(working.getAttribute("aria-busy")).toBe("true");
    expect(working.querySelector("[data-activity-indicator]")).not.toBeNull();
    await act(async () => { rejectRequest?.(new Error("Offline")); await Promise.resolve(); });
    expect(screen.getByRole("alert")).toBeTruthy();
    expect(screen.queryByRole("button", { name: /sending/i })).toBeNull();
    expect(screen.getByTestId("twin-enquiry-form").querySelector("[data-activity-indicator]")).toBeNull();
  });
});
