import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { GUEST_ENQUIRY_LATEST_EVENT_DATE, GUEST_ENQUIRY_LIMITS, TRADES_HALL_ENQUIRY_VENUE_SLUG } from "@omnitwin/types";
import { pressEnterIn } from "../../../test/implicit-submit.js";

const mocks = vi.hoisted(() => ({
  submitGuestEnquiry: vi.fn<(input: unknown) => Promise<unknown>>(),
}));
vi.mock("../../../api/configurations.js", () => ({ submitGuestEnquiry: mocks.submitGuestEnquiry }));

const { FreshEnquiry } = await import("../FreshEnquiry.js");
const {
  FRESH_ENQUIRY_CRAFT_PREFIX,
  FRESH_ENQUIRY_DATE_LABEL,
  FRESH_ENQUIRY_EMAIL_INVALID,
  FRESH_ENQUIRY_EMAIL_REQUIRED,
  FRESH_ENQUIRY_SENT_LINE,
  FRESH_ENQUIRY_SENT_TITLE,
} = await import("../fresh-copy.js");

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

  // enquiries-crm-2: the API refuses a name over its limit or a telephone over
  // 30 characters as "Validation failed", and this page then says only "Try
  // again", which can never work. The fields take no more than it accepts.
  it("takes no more name or telephone than the API accepts", () => {
    render(<FreshEnquiry />);
    const name = screen.getByRole<HTMLInputElement>("textbox", { name: /^Your name/u });
    const phone = screen.getByRole<HTMLInputElement>("textbox", { name: /^Phone/u });
    expect(name.maxLength, "Your name").toBe(GUEST_ENQUIRY_LIMITS.nameLength);
    expect(phone.maxLength, "Phone").toBe(GUEST_ENQUIRY_LIMITS.phoneLength);
  });

  // Review of #405, F2: a date field with no max takes a year of five digits
  // (a doubled key), which the API refuses, and the page can only say "Try
  // again". The form sets noValidate, so this max bounds the year a browser
  // lets the guest type rather than refusing a Send.
  it("takes no year in the date field that the API refuses", () => {
    render(<FreshEnquiry />);
    const date = screen.getByLabelText<HTMLInputElement>(FRESH_ENQUIRY_DATE_LABEL);
    expect(date.type).toBe("date");
    expect(date.max).toBe(GUEST_ENQUIRY_LATEST_EVENT_DATE);
  });

  // public-claims-6: the API checks an email with zod's rule, which wants a
  // top-level domain of two letters or more and fewer symbols before the @.
  // The composer took these, the API refused them, and the page could only
  // say "Try again", which fails the same way every time.
  it.each(["jane@gmail.c", "o!brien@example.com"])("asks again for an email the API would refuse: %s", (address) => {
    mocks.submitGuestEnquiry.mockResolvedValue({ enquiryId: "enq-never" });
    render(<FreshEnquiry />);
    send(address);
    expect(mocks.submitGuestEnquiry).not.toHaveBeenCalled();
    const field = screen.getByRole("textbox", { name: /^Your email/u, description: "Enter a valid email address." });
    expect(field.getAttribute("aria-invalid")).toBe("true");
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

// a11y-2: a keyboard or screen-reader visitor must hear what the page says.
// The email's problem appeared beside a field they were not on, with focus
// left on Send, so nothing was spoken; a sent enquiry unmounted the focused
// Send button, dropping focus to the page, and its confirmation arrived in a
// status region created with its words already in it.
describe("FreshEnquiry — what a keyboard and a screen reader are told", () => {
  it.each([
    ["no address", "", FRESH_ENQUIRY_EMAIL_REQUIRED],
    ["an address that is not one", "jane@", FRESH_ENQUIRY_EMAIL_INVALID],
  ])("takes focus to the email field, which names its problem, when Send finds %s", (_case, address, problem) => {
    render(<FreshEnquiry />);
    if (address !== "") fireEvent.change(screen.getByLabelText("Your email"), { target: { value: address } });
    const sendButton = screen.getByRole("button", { name: "Send enquiry" });
    sendButton.focus();
    fireEvent.click(sendButton);
    expect(mocks.submitGuestEnquiry).not.toHaveBeenCalled();
    const field = screen.getByRole("textbox", { name: /^Your email/u, description: problem });
    expect(document.activeElement, "focus after Send").toBe(field);
    expect(field.getAttribute("aria-invalid")).toBe("true");
  });

  // Review of #405, F1. Enter in the email field sends the form with focus
  // already in that field, so moving focus there says nothing. The problem
  // line is an alert when Send finds it, a new one each Send, so a repeated
  // Enter is heard again.
  it("says the email's problem when Enter in the field finds it, and again on the next Enter", () => {
    render(<FreshEnquiry />);
    const field = screen.getByLabelText<HTMLInputElement>("Your email");
    pressEnterIn(field);
    expect(mocks.submitGuestEnquiry).not.toHaveBeenCalled();
    expect(document.activeElement, "focus stays in the field").toBe(field);
    const first = screen.getByRole("alert");
    expect(first.textContent).toBe(FRESH_ENQUIRY_EMAIL_REQUIRED);
    pressEnterIn(field);
    const again = screen.getByRole("alert");
    expect(again.textContent).toBe(FRESH_ENQUIRY_EMAIL_REQUIRED);
    expect(again, "a new alert, so a screen reader hears it again").not.toBe(first);
  });

  it("does not interrupt: the problem is no alert when the guest leaves the field, or types again after Send", () => {
    render(<FreshEnquiry />);
    const field = screen.getByLabelText<HTMLInputElement>("Your email");
    fireEvent.blur(field);
    expect(screen.getByText(FRESH_ENQUIRY_EMAIL_REQUIRED)).toBeTruthy();
    expect(screen.queryByRole("alert"), "on leaving the field").toBeNull();
    pressEnterIn(field);
    expect(screen.getByRole("alert").textContent).toBe(FRESH_ENQUIRY_EMAIL_REQUIRED);
    fireEvent.change(field, { target: { value: "jane@" } });
    expect(screen.getByText(FRESH_ENQUIRY_EMAIL_INVALID)).toBeTruthy();
    expect(screen.queryByRole("alert"), "while typing after Send").toBeNull();
  });

  it("takes focus to the confirmation once the enquiry is sent, named by the words on it", async () => {
    mocks.submitGuestEnquiry.mockResolvedValueOnce({ enquiryId: "enq-3" });
    render(<FreshEnquiry />);
    fireEvent.change(screen.getByLabelText("Your email"), { target: { value: "couple@example.test" } });
    const sendButton = screen.getByRole("button", { name: "Send enquiry" });
    sendButton.focus();
    fireEvent.click(sendButton);
    const confirmation = await screen.findByRole("status");
    await waitFor(() => {
      expect(document.activeElement, "focus after sending").toBe(confirmation);
    });
    expect(screen.getByRole("status", { name: FRESH_ENQUIRY_SENT_TITLE })).toBe(confirmation);
    expect(confirmation.textContent).toContain(FRESH_ENQUIRY_SENT_LINE);
  });
});
