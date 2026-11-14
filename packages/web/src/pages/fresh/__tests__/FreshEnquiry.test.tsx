import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { GUEST_ENQUIRY_LATEST_EVENT_DATE, GUEST_ENQUIRY_LIMITS, TRADES_HALL_ENQUIRY_VENUE_SLUG } from "@omnitwin/types";
import { pressEnterIn } from "../../../test/implicit-submit.js";
import { expectOutOfReach, hiddenTrapIn } from "../../../test/enquiry-trap.js";

const mocks = vi.hoisted(() => ({
  submitGuestEnquiry: vi.fn<(input: unknown) => Promise<unknown>>(),
}));
vi.mock("../../../api/configurations.js", () => ({ submitGuestEnquiry: mocks.submitGuestEnquiry }));

const { FreshEnquiry } = await import("../FreshEnquiry.js");
const {
  FRESH_ENQUIRY_CRAFT_PREFIX,
  FRESH_ENQUIRY_DATE_AFTER_LAST,
  FRESH_ENQUIRY_DATE_BEFORE_TODAY,
  FRESH_ENQUIRY_DATE_LABEL,
  FRESH_ENQUIRY_DATE_NOT_A_DATE,
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
      // The hidden trap's two readings: its field, empty, and how long the form was open.
      trap: "",
      openMs: expect.any(Number) as number,
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

// Blake, 13 and 14 November 2026: the front door refuses an event date before
// the guest's own today, in his words, "Choose a date from today onwards."
// The form checks its own fields (noValidate), so Send is held and focus goes
// to the date field, marked invalid with the reason attached, as the email's
// problem is. The review of #405 (Q3), as the release lead ruled: a date past
// the last the API takes, and one that is not a calendar date, are held too,
// each in the owner's own words of 14 November (fresh-copy.ts). A date not on
// the calendar is named first (it cannot be compared with today), then a year
// past the last, then a date before today.
describe("FreshEnquiry — a date from today", () => {
  const zone = process.env["TZ"];
  beforeEach(() => {
    // West of Greenwich, where the UTC date is tomorrow by the evening.
    process.env["TZ"] = "America/Los_Angeles";
    vi.useFakeTimers({ toFake: ["Date"] });
  });
  afterEach(() => {
    vi.useRealTimers();
    if (zone === undefined) Reflect.deleteProperty(process.env, "TZ");
    else process.env["TZ"] = zone;
  });

  function dateField(): HTMLInputElement {
    const field = screen.getByTestId("enquiry-composer").querySelector<HTMLInputElement>("input[type='date']");
    if (field === null) throw new Error("No date field");
    return field;
  }

  /** A browser that keeps what a guest typed in the date field, where
   *  happy-dom clears what is not a date of four-digit year. */
  function typedIntoDate(field: HTMLInputElement, typed: string): void {
    Object.defineProperty(field, "value", { configurable: true, get: () => typed, set: () => undefined });
    fireEvent.input(field);
  }

  /** Send held on the date: nothing posted, focus on the field, which is
   *  marked invalid with `reason` beside it, said once as Send finds it. */
  function expectHeldOnTheDate(field: HTMLInputElement, reason: string): void {
    expect(mocks.submitGuestEnquiry).not.toHaveBeenCalled();
    expect(document.activeElement, "focus after Send").toBe(field);
    expect(field.getAttribute("aria-invalid")).toBe("true");
    const described = document.getElementById(field.getAttribute("aria-describedby") ?? "");
    expect(described?.textContent, "the reason beside the field").toBe(reason);
    expect(screen.getByRole("alert").textContent, "the reason said once, at Send").toBe(reason);
  }

  it("names its three refusals apart, each in the owner's words", () => {
    expect([FRESH_ENQUIRY_DATE_BEFORE_TODAY, FRESH_ENQUIRY_DATE_AFTER_LAST, FRESH_ENQUIRY_DATE_NOT_A_DATE]).toEqual([
      "Choose a date from today onwards.",
      "Choose a year with four digits.",
      "Choose a date from the calendar.",
    ]);
  });

  it("holds Send for a date before the guest's own today, and takes focus to the date with the reason", () => {
    // 22:30 on 30 April in California, 05:30 on 1 May in UTC.
    vi.setSystemTime(new Date("2027-05-01T05:30:00Z"));
    render(<FreshEnquiry />);
    const date = dateField();
    expect(date.min, "the picker's earliest day is the guest's today").toBe("2027-04-30");
    fireEvent.change(date, { target: { value: "2027-04-29" } });
    send();
    expectHeldOnTheDate(date, "Choose a date from today onwards.");
  });

  it("sends the guest's own today, though the UTC date is already tomorrow", async () => {
    vi.setSystemTime(new Date("2027-05-01T05:30:00Z"));
    mocks.submitGuestEnquiry.mockResolvedValueOnce({ enquiryId: "enq-today" });
    render(<FreshEnquiry />);
    fireEvent.change(dateField(), { target: { value: "2027-04-30" } });
    send();
    await waitFor(() => {
      expect(mocks.submitGuestEnquiry).toHaveBeenCalledWith(expect.objectContaining({ eventDate: "2027-04-30" }));
    });
  });

  it("reads today when Send is pressed: a form left open past midnight holds yesterday and sends the new day", async () => {
    // 23:59:30 on 30 April, local.
    vi.setSystemTime(new Date("2027-05-01T06:59:30Z"));
    mocks.submitGuestEnquiry.mockResolvedValueOnce({ enquiryId: "enq-midnight" });
    render(<FreshEnquiry />);
    const date = dateField();
    fireEvent.change(date, { target: { value: "2027-04-30" } });
    // 00:00:30 on 1 May, local.
    vi.setSystemTime(new Date("2027-05-01T07:00:30Z"));
    send();
    expectHeldOnTheDate(date, "Choose a date from today onwards.");
    fireEvent.change(date, { target: { value: "2027-05-01" } });
    send();
    await waitFor(() => {
      expect(mocks.submitGuestEnquiry).toHaveBeenCalledWith(expect.objectContaining({ eventDate: "2027-05-01" }));
    });
  });

  // A browser that lets a fifth year digit through even with max set
  // (Chromium caps the year; Firefox and Safari were not measured) posts
  // "20277-05-01", which the API refuses, and the guest could only be told
  // to try again. It is a day on the calendar, and after today, so it is
  // named for its year, never "from today onwards".
  it("holds Send for a year past the last the API takes: \"Choose a year with four digits.\"", () => {
    vi.setSystemTime(new Date("2027-05-01T05:30:00Z"));
    render(<FreshEnquiry />);
    const date = dateField();
    typedIntoDate(date, "20277-05-01");
    send();
    expectHeldOnTheDate(date, "Choose a year with four digits.");
  });

  // A day the calendar does not have cannot be compared with today, so it is
  // named first, even in a year that is also past the last or before today.
  it.each([
    ["30 February", "2027-02-30"],
    ["29 February in a year with none", "2027-02-29"],
    ["a thirteenth month", "2027-13-01"],
    ["the year 0000, before any the API takes", "0000-05-01"],
    ["30 February of a year past the last", "20277-02-30"],
  ])("holds Send for a date not on the calendar (%s): \"Choose a date from the calendar.\"", (_case, typed) => {
    vi.setSystemTime(new Date("2027-05-01T05:30:00Z"));
    render(<FreshEnquiry />);
    const date = dateField();
    typedIntoDate(date, typed);
    send();
    expectHeldOnTheDate(date, "Choose a date from the calendar.");
  });

  it("says the reason quietly once the guest changes the date, and drops it for a date from today", () => {
    vi.setSystemTime(new Date("2027-05-01T05:30:00Z"));
    render(<FreshEnquiry />);
    const date = dateField();
    fireEvent.change(date, { target: { value: "2027-04-29" } });
    send();
    expectHeldOnTheDate(date, "Choose a date from today onwards.");
    fireEvent.change(date, { target: { value: "2027-04-28" } });
    expect(screen.queryByRole("alert"), "no alert while the guest picks again").toBeNull();
    expect(date.getAttribute("aria-invalid")).toBe("true");
    expect(screen.getByText("Choose a date from today onwards.")).toBeTruthy();
    fireEvent.change(date, { target: { value: "2027-05-02" } });
    expect(date.getAttribute("aria-invalid")).toBe("false");
    expect(date.hasAttribute("aria-describedby")).toBe(false);
    expect(screen.queryByText("Choose a date from today onwards.")).toBeNull();
  });
});

// Blake, 12 November 2026: a hidden trap on the public forms. The front door
// sends what its hidden field holds and how long the form was open before
// Send; the API judges a hit, keeps the enquiry and emails nobody.
describe("FreshEnquiry — its hidden trap", () => {
  beforeEach(() => { vi.useFakeTimers({ toFake: ["Date", "performance"] }); });
  afterEach(() => { vi.useRealTimers(); });

  it("sends an empty hidden field and how long the form was open before Send", async () => {
    mocks.submitGuestEnquiry.mockResolvedValueOnce({ enquiryId: "enq-trap" });
    render(<FreshEnquiry />);
    act(() => { vi.advanceTimersByTime(12_500); });
    send();
    await waitFor(() => {
      expect(mocks.submitGuestEnquiry).toHaveBeenCalledWith(expect.objectContaining({ email: "couple@example.test", trap: "", openMs: 12_500 }));
    });
  });

  it("sends whatever a script put in the hidden field, whether or not it said so", async () => {
    mocks.submitGuestEnquiry.mockResolvedValueOnce({ enquiryId: "enq-trap" });
    render(<FreshEnquiry />);
    hiddenTrapIn(screen.getByTestId("enquiry-composer")).value = "https://example.test/offer";
    send();
    await waitFor(() => {
      expect(mocks.submitGuestEnquiry).toHaveBeenCalledWith(expect.objectContaining({ trap: "https://example.test/offer", openMs: 0 }));
    });
  });

  it("keeps the hidden field out of a person's reach, by eye, keyboard, screen reader or autofill", () => {
    render(<FreshEnquiry />);
    const form = screen.getByTestId("enquiry-composer");
    expectOutOfReach(hiddenTrapIn(form), form);
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
