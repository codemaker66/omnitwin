import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type { PricingAdvice, PricingAdviceItem } from "@omnitwin/types";
import type { DeskRule, PricingDesk as Desk } from "../../../../api/pricing-desk.js";
import { PricingDesk } from "../PricingDesk.js";

// ---------------------------------------------------------------------------
// The Pricing desk (Blake, 17 October 2026): the venue's own price list with
// who changed each rate and when; edit controls and suggestions only for
// those who set prices; what saving does said before Save; a suggestion
// that opens the form filled in and changes nothing by itself.
// ---------------------------------------------------------------------------

const VENUE = "v1";
const HALL = "aaaaaaaa-0000-4000-8000-000000000001";
const EVENING = "bbbbbbbb-0000-4000-8000-000000000001";
const KEY = `${EVENING}:2027-06-12:raise`;

const mocks = vi.hoisted(() => ({
  getPricingDesk: vi.fn(),
  getPricingAdvice: vi.fn(),
  dismissPricingAdvice: vi.fn(),
  restorePricingAdvice: vi.fn(),
  createPricingRule: vi.fn(),
  updatePricingRule: vi.fn(),
  deletePricingRule: vi.fn(),
  restorePricingRule: vi.fn(),
}));

vi.mock("../../../../api/pricing-desk.js", () => ({
  getPricingDesk: mocks.getPricingDesk,
  getPricingAdvice: mocks.getPricingAdvice,
  dismissPricingAdvice: mocks.dismissPricingAdvice,
  restorePricingAdvice: mocks.restorePricingAdvice,
}));

vi.mock("../../../../api/pricing.js", () => ({
  createPricingRule: mocks.createPricingRule,
  updatePricingRule: mocks.updatePricingRule,
  deletePricingRule: mocks.deletePricingRule,
  restorePricingRule: mocks.restorePricingRule,
}));

const authState = vi.hoisted(() => ({
  user: { id: "u1", role: "manager", platformRole: "none" as const, venueId: "v1" as string | null, email: "m@test.com", name: "Callum Reid" },
}));

vi.mock("../../../../stores/auth-store.js", () => ({
  useAuthStore: Object.assign(
    (selector: (state: { user: typeof authState.user | null }) => unknown): unknown => selector({ user: authState.user }),
    { getState: (): { user: typeof authState.user | null } => ({ user: authState.user }) },
  ),
}));

function wideDesk(): void {
  vi.spyOn(window, "matchMedia").mockImplementation((query: string): MediaQueryList => ({
    matches: query === "(min-width: 1180px)",
    media: query,
    onchange: null,
    addListener: () => undefined,
    removeListener: () => undefined,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
    dispatchEvent: () => false,
  }));
}

function rule(overrides: Partial<DeskRule> = {}): DeskRule {
  return {
    id: EVENING, venueId: VENUE, spaceId: HALL, name: "Grand Hall — Evening", type: "flat_rate", amount: "2800.00", currency: "GBP",
    minHours: null, minGuests: null, tiers: null, dayOfWeekModifiers: null, seasonalModifiers: null,
    appliesFrom: "19:00:00", appliesUntil: "00:30:00", isActive: true, validFrom: null, validTo: null,
    createdAt: "2026-01-05T10:00:00.000Z", updatedAt: "2026-10-17T13:32:00.000Z", deletedAt: null,
    history: [{ action: "updated", at: "2026-10-17T13:32:00.000Z", by: "Moira Stewart", summary: "Changed \"Grand Hall — Evening\": amount." }],
    ...overrides,
  };
}

function desk(overrides: Partial<Desk> = {}): Desk {
  return {
    venue: { id: VENUE, name: "Trades Hall", timezone: "Europe/London" },
    rooms: [{ id: HALL, name: "Grand Hall" }],
    rules: [rule(), rule({ id: "bbbbbbbb-0000-4000-8000-000000000002", name: "Grand Hall — Late licence", amount: "400.00", isActive: false, history: [] })],
    retired: [],
    setters: ["Callum Reid", "Moira Stewart"],
    canSetPrices: true,
    ...overrides,
  };
}

function item(overrides: Partial<PricingAdviceItem> = {}): PricingAdviceItem {
  return {
    key: KEY, kind: "raise", ruleId: EVENING, ruleName: "Grand Hall — Evening", spaceId: HALL, roomName: "Grand Hall",
    date: "2027-06-12", dayPart: "Evening, 19:00–00:30", per: "booking", currency: "GBP", currentMinor: 280_000,
    lowMinor: 300_000, highMinor: 335_000, suggestedMinor: 315_000,
    reasons: [
      { text: "A 2nd option is pencilled: two parties want this date.", direction: "up", records: 2 },
      { text: "Saturday evenings in June: 8 of 8 booked in the venue's record.", direction: "up", records: 8 },
    ],
    records: 10, leadDays: 238, accept: "add_dated", ...overrides,
  };
}

function advice(items: readonly PricingAdviceItem[] = [item()]): PricingAdvice {
  return {
    computedAt: "2026-10-17T12:00:00.000Z", timezone: "Europe/London", from: "2026-10-18", through: "2028-04-17",
    recordsBegin: "2025-06-07", basis: { bookings: 10, enquiries: 3, acceptedQuoteLines: 0 }, conversion: null,
    checked: 2_000, rateHolds: 400, tooLittleHistory: 1_599, dismissed: 0, total: items.length, items: [...items],
  };
}

beforeEach(() => {
  wideDesk();
  authState.user = { ...authState.user, role: "manager", venueId: VENUE };
  mocks.getPricingDesk.mockResolvedValue(desk());
  mocks.getPricingAdvice.mockResolvedValue(advice());
  mocks.dismissPricingAdvice.mockResolvedValue(undefined);
  mocks.restorePricingAdvice.mockResolvedValue(undefined);
  mocks.createPricingRule.mockImplementation((_venue: string, body: { name: string }) => Promise.resolve(rule({ id: "new-rule", name: body.name })));
  mocks.updatePricingRule.mockResolvedValue(rule({ amount: "2900.00" }));
  mocks.deletePricingRule.mockResolvedValue(undefined);
  mocks.restorePricingRule.mockResolvedValue(rule());
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  for (const mock of Object.values(mocks)) mock.mockReset();
});

async function openDesk(): Promise<void> {
  render(<PricingDesk />);
  await screen.findByRole("button", { name: /^Grand Hall — Evening, £2,800/u });
}

describe("reading the price list", () => {
  it("shows a working state, then each rate with who changed it and when", async () => {
    let answer: (value: Desk) => void = () => undefined;
    mocks.getPricingDesk.mockReturnValue(new Promise<Desk>((resolve) => { answer = resolve; }));
    render(<PricingDesk />);
    expect(screen.getByText("Reading the price list…")).toBeTruthy();
    answer(desk());
    const row = await screen.findByRole("button", { name: /^Grand Hall — Evening, £2,800/u });
    expect(row.getAttribute("aria-label")).toMatch(/Changed by Moira Stewart, 17 Oct 2026, 14:32\.$/u);
    expect(screen.queryByText("Reading the price list…")).toBeNull();
    expect(screen.getByTestId("pricing-summary").textContent).toContain("1 rate in use across 1 room.");
  });

  it("says when the list cannot be read, and reads it again on request", async () => {
    mocks.getPricingDesk.mockRejectedValueOnce(new Error("offline"));
    render(<PricingDesk />);
    expect(await screen.findByText("The price list could not be read. Nothing has changed.")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(await screen.findByRole("button", { name: /^Grand Hall — Evening, £2,800/u })).toBeTruthy();
  });
});

describe("for someone who does not set prices", () => {
  beforeEach(() => {
    authState.user = { ...authState.user, role: "sales" };
    mocks.getPricingDesk.mockResolvedValue(desk({ canSetPrices: false }));
  });

  it("shows the prices with no way to change them, and names who can", async () => {
    await openDesk();
    expect(screen.queryByRole("button", { name: "Add a rate" })).toBeNull();
    expect(screen.queryByRole("button", { name: /^Suggestions/u })).toBeNull();
    expect(mocks.getPricingAdvice).not.toHaveBeenCalled();
    expect(screen.getByTestId("pricing-summary").textContent).toContain("Prices are set by Callum Reid or Moira Stewart.");

    fireEvent.click(screen.getByRole("button", { name: /^Grand Hall — Evening, £2,800/u }));
    const panel = await screen.findByRole("complementary", { name: "Rate: Grand Hall — Evening" });
    expect(within(panel).queryByRole("button", { name: "Change this rate" })).toBeNull();
    expect(within(panel).queryByRole("button", { name: "Retire…" })).toBeNull();
    expect(within(panel).getByText("Prices are set by Callum Reid or Moira Stewart. To change this rate, ask them.")).toBeTruthy();
    expect(within(panel).getByText("Changed by Moira Stewart, 17 Oct 2026, 14:32")).toBeTruthy();
  });
});

describe("for someone who sets prices", () => {
  it("says what a change does before it is saved, and sends only what changed", async () => {
    await openDesk();
    fireEvent.click(screen.getByRole("button", { name: /^Grand Hall — Evening, £2,800/u }));
    fireEvent.click(await screen.findByRole("button", { name: "Change this rate" }));
    const form = await screen.findByRole("form", { name: "Grand Hall — Evening" });
    expect(within(form).getByRole<HTMLButtonElement>("button", { name: "Save change" }).disabled).toBe(true);
    fireEvent.change(within(form).getByLabelText("Price, £"), { target: { value: "2900" } });
    expect(within(form).getByText("£2,800 becomes £2,900.")).toBeTruthy();
    expect(within(form).getByText("Quotes made from now, and enquiry estimates, use this rate. Quotes already made keep theirs.")).toBeTruthy();
    fireEvent.click(within(form).getByRole("button", { name: "Save change" }));
    await waitFor(() => { expect(mocks.updatePricingRule).toHaveBeenCalledWith(VENUE, EVENING, { amount: 2900 }); });
    expect(await screen.findByText("Saved “Grand Hall — Evening”.")).toBeTruthy();
  });

  it("keeps the form open with the reason when a save is refused", async () => {
    mocks.updatePricingRule.mockRejectedValueOnce(new Error("Prices are set by an administrator or a manager at the venue. Ask them to make this change."));
    await openDesk();
    fireEvent.click(screen.getByRole("button", { name: /^Grand Hall — Evening, £2,800/u }));
    fireEvent.click(await screen.findByRole("button", { name: "Change this rate" }));
    const form = await screen.findByRole("form", { name: "Grand Hall — Evening" });
    fireEvent.change(within(form).getByLabelText("Price, £"), { target: { value: "2900" } });
    fireEvent.click(within(form).getByRole("button", { name: "Save change" }));
    expect((await within(form).findByRole("alert")).textContent).toContain("Prices are set by an administrator or a manager at the venue.");
    expect(within(form).getByLabelText<HTMLInputElement>("Price, £").value).toBe("2900");
  });

  it("says what retiring does first, and offers the way back", async () => {
    await openDesk();
    fireEvent.click(screen.getByRole("button", { name: /^Grand Hall — Evening, £2,800/u }));
    fireEvent.click(await screen.findByRole("button", { name: "Retire…" }));
    expect(screen.getByText("“Grand Hall — Evening” leaves the price list. Quotes made from now cannot use it; quotes already made keep it. You can bring it back from Retired.")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Retire" }));
    await waitFor(() => { expect(mocks.deletePricingRule).toHaveBeenCalledWith(VENUE, EVENING); });
    expect(await screen.findByText("Retired “Grand Hall — Evening”.")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Undo" }));
    await waitFor(() => { expect(mocks.restorePricingRule).toHaveBeenCalledWith(VENUE, EVENING, true); });
  });
});

describe("suggestions", () => {
  it("show the figure, the reasons and the records, and open a rate for that date filled in", async () => {
    await openDesk();
    fireEvent.click(await screen.findByRole("button", { name: "Suggestions, 1" }));
    expect(screen.getByText(/Competitors' prices are not used\./u)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /^Sat 12 Jun 2027, Grand Hall — Evening\. Raise, £3,000–£3,350/u }));
    const panel = await screen.findByRole("complementary", { name: "Suggestion for Grand Hall — Evening on Sat 12 Jun 2027" });
    expect(within(panel).getByText("£3,000–£3,350")).toBeTruthy();
    expect(within(panel).getByText("Raise to about £3,150")).toBeTruthy();
    expect(within(panel).getByText("A 2nd option is pencilled: two parties want this date.")).toBeTruthy();
    expect(within(panel).getByText("Rests on 10 records from the venue's own book.")).toBeTruthy();
    // Advice only: nothing has been written.
    expect(mocks.createPricingRule).not.toHaveBeenCalled();
    expect(mocks.updatePricingRule).not.toHaveBeenCalled();

    fireEvent.click(within(panel).getByRole("button", { name: "Add a rate for this date at £3,150…" }));
    const form = await screen.findByRole("form", { name: "Add a rate" });
    expect(within(form).getByText("From a suggestion for Sat 12 Jun 2027")).toBeTruthy();
    expect(within(form).getByLabelText<HTMLInputElement>("Price, £").value).toBe("3150");
    expect(within(form).getByText("On Sat 12 Jun 2027 it takes the place of “Grand Hall — Evening” (£2,800).")).toBeTruthy();
    expect(mocks.createPricingRule).not.toHaveBeenCalled();

    fireEvent.click(within(form).getByRole("button", { name: "Save rate" }));
    await waitFor(() => { expect(mocks.createPricingRule).toHaveBeenCalledTimes(1); });
    expect(mocks.createPricingRule).toHaveBeenCalledWith(VENUE, expect.objectContaining({
      name: "Grand Hall — Evening, 12 Jun 2027", amount: 3150, spaceId: HALL, appliesFrom: "19:00", appliesUntil: "00:30",
      validFrom: "2027-06-12", validTo: "2027-06-12", isActive: true, adviceKey: KEY,
    }));
  });

  it("keep the everyday rate's day and month adjustments on a rate added from a suggestion, and say they apply", async () => {
    const adjusted = rule({ dayOfWeekModifiers: { saturday: 1.2 }, seasonalModifiers: null });
    mocks.getPricingDesk.mockResolvedValue(desk({ rules: [adjusted] }));
    await openDesk();
    fireEvent.click(screen.getByRole("button", { name: /^Grand Hall — Evening, £2,800/u }));
    const ratePanel = await screen.findByRole("complementary", { name: "Rate: Grand Hall — Evening" });
    expect(within(ratePanel).getByText("Adjusted on top of that price: Saturdays 20% more.")).toBeTruthy();

    fireEvent.click(await screen.findByRole("button", { name: "Suggestions, 1" }));
    fireEvent.click(screen.getByRole("button", { name: /^Sat 12 Jun 2027, Grand Hall — Evening\. Raise/u }));
    const panel = await screen.findByRole("complementary", { name: "Suggestion for Grand Hall — Evening on Sat 12 Jun 2027" });
    expect(within(panel).getByText("These figures are before the rate's adjustments (Saturdays 20% more), which still apply.")).toBeTruthy();
    fireEvent.click(within(panel).getByRole("button", { name: "Add a rate for this date at £3,150…" }));
    const form = await screen.findByRole("form", { name: "Add a rate" });
    expect(within(form).getByText("It keeps the same adjustments: Saturdays 20% more.")).toBeTruthy();
    fireEvent.click(within(form).getByRole("button", { name: "Save rate" }));
    await waitFor(() => { expect(mocks.createPricingRule).toHaveBeenCalledTimes(1); });
    expect(mocks.createPricingRule).toHaveBeenCalledWith(VENUE, expect.objectContaining({
      amount: 3150, validFrom: "2027-06-12", validTo: "2027-06-12", dayOfWeekModifiers: { saturday: 1.2 }, adviceKey: KEY,
    }));
  });

  it("say there is too little history rather than guess a figure", async () => {
    mocks.getPricingAdvice.mockResolvedValue(advice([item({
      key: `${EVENING}:2027-06-12:too_little_history`, kind: "too_little_history", lowMinor: null, highMinor: null, suggestedMinor: null, records: 2,
    })]));
    await openDesk();
    fireEvent.click(await screen.findByRole("button", { name: "Suggestions, 1" }));
    fireEvent.click(screen.getByRole("button", { name: /Too little history/u }));
    const panel = await screen.findByRole("complementary", { name: /^Suggestion for/u });
    expect(within(panel).getByText("Too little history to suggest a change")).toBeTruthy();
    expect(within(panel).queryByRole("button", { name: /Add a rate for this date/u })).toBeNull();
  });

  it("can be dismissed, and the dismissal undone", async () => {
    await openDesk();
    fireEvent.click(await screen.findByRole("button", { name: "Suggestions, 1" }));
    fireEvent.click(screen.getByRole("button", { name: /^Sat 12 Jun 2027/u }));
    fireEvent.click(await screen.findByRole("button", { name: "Dismiss" }));
    await waitFor(() => { expect(mocks.dismissPricingAdvice).toHaveBeenCalledWith(VENUE, KEY); });
    expect(await screen.findByText("Dismissed the suggestion for Sat 12 Jun 2027.")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Undo" }));
    await waitFor(() => { expect(mocks.restorePricingAdvice).toHaveBeenCalledWith(VENUE, KEY); });
  });

  it("say when they cannot be worked out, and try again", async () => {
    mocks.getPricingAdvice.mockRejectedValueOnce(new Error("timeout"));
    await openDesk();
    fireEvent.click(await screen.findByRole("button", { name: /^Suggestions/u }));
    expect(await screen.findByText("The suggestions could not be worked out. The price list is unaffected.")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(await screen.findByRole("button", { name: /^Sat 12 Jun 2027/u })).toBeTruthy();
  });
});
