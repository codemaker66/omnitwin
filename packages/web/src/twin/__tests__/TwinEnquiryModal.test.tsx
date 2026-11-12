import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import {
  GUEST_ENQUIRY_LATEST_EVENT_DATE,
  GUEST_ENQUIRY_LIMITS,
  GuestEnquirySchema,
  TRADES_HALL_ENQUIRY_VENUE_SLUG,
} from "@omnitwin/types";
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
  // shows with no field named. The fields take no more than the API accepts;
  // the message is held at Send instead (below).
  it("takes no more in any field than the API accepts", () => {
    renderModal();
    const limits: readonly [string, number][] = [
      ["Your name", screen.getByRole<HTMLInputElement>("textbox", { name: "Your name" }).maxLength],
      ["Phone", screen.getByRole<HTMLInputElement>("textbox", { name: "Phone" }).maxLength],
      ["Guests", Number(screen.getByRole<HTMLInputElement>("spinbutton", { name: "Guests" }).max)],
    ];
    expect(limits).toEqual([
      ["Your name", GUEST_ENQUIRY_LIMITS.nameLength],
      ["Phone", GUEST_ENQUIRY_LIMITS.phoneLength],
      ["Guests", GUEST_ENQUIRY_LIMITS.guestCount],
    ]);
  });

  // Review of #405, F5. A maxlength message field cut a longer paste at the
  // API's limit without a word, and the events team got a brief that stopped
  // mid-sentence. The field keeps everything; Send holds the enquiry, says
  // why in the alert the email's problem uses, and takes the guest there.
  it("keeps a long pasted message and holds Send, saying how long it is", () => {
    renderModal();
    fireEvent.change(screen.getByLabelText(/^email/i), { target: { value: "guest@example.com" } });
    const message = screen.getByRole<HTMLTextAreaElement>("textbox", { name: "Anything else?" });
    expect(message.hasAttribute("maxlength"), "a maxlength field cuts a paste without a word").toBe(false);
    const brief = "b".repeat(3214);
    fireEvent.change(message, { target: { value: brief } });
    fireEvent.click(screen.getByRole("button", { name: "Send to the events team" }));
    expect(submitMock).not.toHaveBeenCalled();
    expect(screen.getByRole("alert").textContent).toBe("Messages can be up to 2,000 characters. Yours is 3,214.");
    expect(document.activeElement, "focus after Send").toBe(message);
    expect(message.value).toBe(brief);
  });

  // Counted as the API counts, or a message one past the limit is sent and
  // refused, or one at it is held for nothing: what is posted (trimmed), in
  // Unicode code points, as zod 4 reads a string's length. An emoji outside
  // the basic plane is one, though it is two UTF-16 units.
  it("holds a message one past the API's limit and sends one at it, counting as the API does", async () => {
    const limit = GUEST_ENQUIRY_LIMITS.messageLength;
    const onePast = `${"a".repeat(limit)}🎻`;
    const atLimit = ` \n${"a".repeat(limit - 1)}🎻\n `;
    expect(atLimit.trim().length, "UTF-16 units: a count of these would hold it").toBe(limit + 1);
    const apiTakes = (text: string): boolean => GuestEnquirySchema.safeParse({
      venueSlug: TRADES_HALL_ENQUIRY_VENUE_SLUG, email: "guest@example.com", message: text,
    }).success;
    renderModal();
    fireEvent.change(screen.getByLabelText(/^email/i), { target: { value: "guest@example.com" } });
    const message = screen.getByRole<HTMLTextAreaElement>("textbox", { name: "Anything else?" });
    const send = screen.getByRole("button", { name: "Send to the events team" });

    fireEvent.change(message, { target: { value: onePast } });
    fireEvent.click(send);
    expect(submitMock).not.toHaveBeenCalled();
    expect(screen.getByRole("alert").textContent).toBe("Messages can be up to 2,000 characters. Yours is 2,001.");
    expect(apiTakes(onePast.trim()), "the API refuses it too").toBe(false);

    fireEvent.change(message, { target: { value: atLimit } });
    fireEvent.click(send);
    await waitFor(() => {
      expect(submitMock).toHaveBeenCalledWith(expect.objectContaining({ message: atLimit.trim() }));
    });
    expect(apiTakes(atLimit.trim()), "the API takes it").toBe(true);
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
