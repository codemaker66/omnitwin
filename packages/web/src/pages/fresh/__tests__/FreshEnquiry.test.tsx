import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { TRADES_HALL_ENQUIRY_VENUE_SLUG } from "@omnitwin/types";

const mocks = vi.hoisted(() => ({
  submitGuestEnquiry: vi.fn<(input: unknown) => Promise<unknown>>(),
}));
vi.mock("../../../api/configurations.js", () => ({ submitGuestEnquiry: mocks.submitGuestEnquiry }));

const { FreshEnquiry } = await import("../FreshEnquiry.js");
const { FRESH_ENQUIRY_CRAFT_PREFIX } = await import("../fresh-copy.js");

// ---------------------------------------------------------------------------
// The composer's POST — what reaches the events team from the front door and
// /fresh. The page draws the message before it is sent; this pins that what
// is posted is that same message, addressed the way the API resolves it.
// ---------------------------------------------------------------------------

afterEach(() => {
  cleanup();
  mocks.submitGuestEnquiry.mockReset();
  window.history.replaceState({}, "", "/");
});

function send(email = "couple@example.test"): void {
  const field = screen.getByLabelText("Your email");
  fireEvent.change(field, { target: { value: email } });
  fireEvent.click(screen.getByRole("button", { name: "Send enquiry" }));
}

describe("FreshEnquiry — the enquiry it posts", () => {
  it("posts the drafted enquiry on the venue path as a website enquiry, then confirms it", async () => {
    mocks.submitGuestEnquiry.mockResolvedValueOnce({ enquiryId: "enq-1" });
    render(<FreshEnquiry />);
    const draft = document.querySelector(".fr-enq-body")?.textContent ?? "";
    send();
    expect(await screen.findByText("Enquiry sent")).toBeTruthy();
    expect(mocks.submitGuestEnquiry).toHaveBeenCalledTimes(1);
    expect(mocks.submitGuestEnquiry).toHaveBeenCalledWith({
      venueSlug: TRADES_HALL_ENQUIRY_VENUE_SLUG,
      source: "website",
      email: "couple@example.test",
      name: undefined,
      phone: undefined,
      eventDate: undefined,
      eventType: "wedding",
      guestCount: 100,
      message: draft,
    });
  });

  it("carries the quiz's Craft in the message it posts, exactly as the visitor read it", async () => {
    window.history.replaceState({}, "", "/?craft=THE%20MALTMEN#enquire");
    mocks.submitGuestEnquiry.mockResolvedValueOnce({ enquiryId: "enq-2" });
    render(<FreshEnquiry />);
    const draft = document.querySelector(".fr-enq-body")?.textContent ?? "";
    expect(draft.endsWith(`${FRESH_ENQUIRY_CRAFT_PREFIX} The Maltmen.`)).toBe(true);
    send();
    expect(await screen.findByText("Enquiry sent")).toBeTruthy();
    expect(mocks.submitGuestEnquiry.mock.calls[0]?.[0]).toMatchObject({ message: draft });
  });

  it("asks for an email before posting anything", () => {
    render(<FreshEnquiry />);
    fireEvent.click(screen.getByRole("button", { name: "Send enquiry" }));
    expect(mocks.submitGuestEnquiry).not.toHaveBeenCalled();
    expect(screen.getByText("Enter your email address.")).toBeTruthy();
  });

  it("keeps the draft and the telephone when the post fails", async () => {
    mocks.submitGuestEnquiry.mockRejectedValueOnce(new Error("offline"));
    render(<FreshEnquiry />);
    send();
    expect((await screen.findByRole("alert")).textContent).toBe("Enquiry not sent. Try again, or call the hall.");
    expect(screen.getByRole("button", { name: "Send enquiry" })).toBeTruthy();
    expect(document.querySelector('a[href^="tel:"]')).toBeTruthy();
    expect(document.querySelector('a[href^="mailto:"]')).toBeNull();
  });
});
