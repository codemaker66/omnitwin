import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type { MarketContext, PricingAdvice } from "@omnitwin/types";
import type { PricingDesk as Desk } from "../../../../api/pricing-desk.js";
import { PricingDesk } from "../PricingDesk.js";
import { ART_CLUB, VOCO, capture, competitor, watch } from "./competitor-watch-fixtures.js";

// ---------------------------------------------------------------------------
// The competitor watch on the Pricing desk (Blake approved the proposal on
// 17 October 2026): the set for those who set prices, the suggested set in
// one step, figures recorded only from a venue's own page or brochure with
// what saving does said first, the page check only once both are ticked,
// and the market context beside a suggestion: closed until asked, dated,
// sourced, never averaged, ranked or offered to match.
// ---------------------------------------------------------------------------

const VENUE = "v1";
const HALL = "aaaaaaaa-0000-4000-8000-000000000001";
const EVENING = "bbbbbbbb-0000-4000-8000-000000000001";

const mocks = vi.hoisted(() => ({
  getPricingDesk: vi.fn(),
  getPricingAdvice: vi.fn(),
  getCompetitorWatch: vi.fn(),
  getMarketContext: vi.fn(),
  startSuggestedSet: vi.fn(),
  addCompetitor: vi.fn(),
  changeCompetitor: vi.fn(),
  removeCompetitor: vi.fn(),
  markReviewed: vi.fn(),
  allowPageCheck: vi.fn(),
  stopPageCheck: vi.fn(),
  dismissPageChange: vi.fn(),
  recordCapture: vi.fn(),
  markSourceGone: vi.fn(),
  checkPagesNow: vi.fn(),
  uploadFile: vi.fn(),
}));

vi.mock("../../../../api/pricing-desk.js", () => ({
  getPricingDesk: mocks.getPricingDesk,
  getPricingAdvice: mocks.getPricingAdvice,
  dismissPricingAdvice: vi.fn(),
  restorePricingAdvice: vi.fn(),
}));

vi.mock("../../../../api/pricing.js", () => ({
  createPricingRule: vi.fn(), updatePricingRule: vi.fn(), deletePricingRule: vi.fn(), restorePricingRule: vi.fn(),
}));

vi.mock("../../../../api/competitor-watch.js", () => ({
  getCompetitorWatch: mocks.getCompetitorWatch,
  getMarketContext: mocks.getMarketContext,
  startSuggestedSet: mocks.startSuggestedSet,
  addCompetitor: mocks.addCompetitor,
  changeCompetitor: mocks.changeCompetitor,
  removeCompetitor: mocks.removeCompetitor,
  markReviewed: mocks.markReviewed,
  allowPageCheck: mocks.allowPageCheck,
  stopPageCheck: mocks.stopPageCheck,
  dismissPageChange: mocks.dismissPageChange,
  recordCapture: mocks.recordCapture,
  markSourceGone: mocks.markSourceGone,
  checkPagesNow: mocks.checkPagesNow,
}));

vi.mock("../../../../api/uploads.js", () => ({ uploadFile: mocks.uploadFile }));

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

function desk(canSetPrices = true): Desk {
  return {
    venue: { id: VENUE, name: "Trades Hall", timezone: "Europe/London" },
    rooms: [{ id: HALL, name: "Grand Hall" }],
    rules: [{
      id: EVENING, venueId: VENUE, spaceId: HALL, name: "Grand Hall — Evening", type: "flat_rate", amount: "2800.00", currency: "GBP",
      minHours: null, minGuests: null, tiers: null, dayOfWeekModifiers: null, seasonalModifiers: null,
      appliesFrom: "19:00:00", appliesUntil: "00:30:00", isActive: true, validFrom: null, validTo: null,
      createdAt: "2026-01-05T10:00:00.000Z", updatedAt: "2026-10-17T13:32:00.000Z", deletedAt: null, history: [],
    }],
    retired: [],
    setters: ["Callum Reid"],
    canSetPrices,
  };
}

function advice(): PricingAdvice {
  return {
    computedAt: "2026-10-17T12:00:00.000Z", timezone: "Europe/London", from: "2026-10-18", through: "2028-04-17",
    recordsBegin: "2025-06-07", basis: { bookings: 10, enquiries: 3, acceptedQuoteLines: 0 }, conversion: null,
    checked: 2_000, rateHolds: 400, tooLittleHistory: 1_599, dismissed: 0, total: 1,
    items: [{
      key: `${EVENING}:2027-06-12:raise`, kind: "raise", ruleId: EVENING, ruleName: "Grand Hall — Evening", spaceId: HALL, roomName: "Grand Hall",
      date: "2027-06-12", dayPart: "Evening, 19:00–00:30", per: "booking", currency: "GBP", currentMinor: 280_000,
      lowMinor: 300_000, highMinor: 335_000, suggestedMinor: 315_000,
      reasons: [{ text: "A 2nd option is pencilled: two parties want this date.", direction: "up", records: 2 }],
      records: 10, leadDays: 238, accept: "add_dated",
    }],
  };
}

const ART = competitor({
  id: ART_CLUB, name: "Glasgow Art Club", tier: "secondary", website: "https://www.glasgowartclub.co.uk", pricePageUrl: null,
  reason: "A small, intimate heritage rival to the rooms that seat 60 for dinner.",
});

beforeEach(() => {
  wideDesk();
  authState.user = { ...authState.user, role: "manager", venueId: VENUE };
  mocks.getPricingDesk.mockResolvedValue(desk());
  mocks.getPricingAdvice.mockResolvedValue(advice());
  mocks.getCompetitorWatch.mockResolvedValue(watch({ competitors: [competitor({ captures: [capture()] }), ART] }));
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  for (const mock of Object.values(mocks)) mock.mockReset();
});

async function openWatch(count: number): Promise<void> {
  render(<PricingDesk />);
  fireEvent.click(await screen.findByRole("button", { name: `Competitors, ${String(count)}` }));
}

describe("the competitor set", () => {
  it("is offered only to those who set prices, and never read for anyone else", async () => {
    authState.user = { ...authState.user, role: "staff" };
    mocks.getPricingDesk.mockResolvedValue(desk(false));
    render(<PricingDesk />);
    await screen.findByRole("button", { name: /^Grand Hall — Evening, £2,800/u });
    expect(screen.queryByRole("button", { name: /^Competitors/u })).toBeNull();
    expect(mocks.getCompetitorWatch).not.toHaveBeenCalled();
  });

  it("shows a working state, says plainly when it cannot be read, and reads it again", async () => {
    mocks.getCompetitorWatch.mockRejectedValueOnce(new Error("Unavailable"));
    render(<PricingDesk />);
    fireEvent.click(await screen.findByRole("button", { name: "Competitors" }));
    expect(await screen.findByText("The competitor watch could not be read. The price list is unaffected.")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(await screen.findByRole("button", { name: /^voco Grand Central\. £130 a head/u })).toBeTruthy();
  });

  it("starts from the suggested set in one step, saying first what it adds", async () => {
    mocks.getCompetitorWatch.mockResolvedValue(watch({ suggestedSetOffered: true }));
    mocks.startSuggestedSet.mockResolvedValue(watch({ competitors: [competitor(), ART] }));
    await openWatch(0);
    const overview = within(screen.getByRole("complementary", { name: "The competitor watch" }));
    expect(overview.getByText(/Adds these ten, each with the reason it is in the set/u)).toBeTruthy();
    expect(overview.getByText("The Merchants House of Glasgow")).toBeTruthy();
    expect(overview.getByText("Glasgow Art Club")).toBeTruthy();
    fireEvent.click(overview.getByRole("button", { name: "Start from the suggested set" }));
    await waitFor(() => { expect(mocks.startSuggestedSet).toHaveBeenCalledWith(VENUE); });
    expect(await screen.findByText("Added the suggested set: 2 venues, each with its reason.")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Competitors, 2" })).toBeTruthy();
  });

  it("says under the counts, in the server's words, when the suggested set could not be added", async () => {
    mocks.getCompetitorWatch.mockResolvedValue(watch({ suggestedSetOffered: true }));
    mocks.startSuggestedSet.mockRejectedValue(new Error("The set has already been started. Add or change venues one at a time."));
    await openWatch(0);
    fireEvent.click(within(screen.getByRole("complementary", { name: "The competitor watch" })).getByRole("button", { name: "Start from the suggested set" }));
    expect(await screen.findByText("The set has already been started. Add or change venues one at a time.")).toBeTruthy();
  });

  it("lists each venue with its newest dated figure and what needs a person, primary first", async () => {
    mocks.getCompetitorWatch.mockResolvedValue(watch({ competitors: [
      competitor({ captures: [capture()], reviewDue: true, pageCheck: { ...competitor().pageCheck, allowedAt: "2026-10-17T09:00:00.000Z", changedAt: "2026-10-18T06:00:00.000Z" } }),
      ART,
    ] }));
    await openWatch(2);
    const row = await screen.findByRole("button", { name: /^voco Grand Central\. £130 a head, at least 150 guests, Grand Central Package\. Seen 17 Oct 2026 by Callum Reid · Current\./u });
    expect(row.getAttribute("aria-label")).toContain("Page changed: re-capture");
    expect(row.getAttribute("aria-label")).toContain("Review due");
    expect(screen.getByRole("heading", { name: /^Primary set/u })).toBeTruthy();
    expect(screen.getByRole("heading", { name: /^Secondary set/u })).toBeTruthy();
    expect(screen.getByRole("button", { name: /^Glasgow Art Club\. No figure recorded yet/u })).toBeTruthy();
  });

  it("says what removing a venue keeps before it removes it", async () => {
    mocks.removeCompetitor.mockResolvedValue(watch({ competitors: [ART] }));
    await openWatch(2);
    fireEvent.click(await screen.findByRole("button", { name: /^voco Grand Central\./u }));
    fireEvent.click(screen.getByRole("button", { name: "Remove…" }));
    expect(screen.getByText("It leaves the set and the market context. Its figures and the deals lost to it are kept, under its name.")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Remove" }));
    await waitFor(() => { expect(mocks.removeCompetitor).toHaveBeenCalledWith(VENUE, VOCO); });
    expect(await screen.findByText("Removed voco Grand Central from the set. Its figures are kept.")).toBeTruthy();
  });
});

describe("recording a figure", () => {
  it("refuses a listing site with the reason, and saves only what was seen, with what saving does said first", async () => {
    mocks.recordCapture.mockResolvedValue({ id: "cccccccc-3333-4333-8333-000000000001", watch: watch({ competitors: [competitor({ captures: [capture()] }), ART] }) });
    await openWatch(2);
    fireEvent.click(await screen.findByRole("button", { name: /^Glasgow Art Club\./u }));
    fireEvent.click(screen.getByRole("button", { name: "Record a figure" }));
    const form = within(screen.getByRole("complementary", { name: "Record a figure" }));
    expect(form.getByText(/It is never edited afterwards; a newer figure replaces it\./u)).toBeTruthy();

    fireEvent.change(form.getByLabelText("The page's address"), { target: { value: "https://www.tagvenue.com/venues/glasgow/art-club" } });
    fireEvent.change(form.getByLabelText("Package, as they name it"), { target: { value: "Dinner in the gallery" } });
    fireEvent.change(form.getByLabelText("Price, £"), { target: { value: "75" } });
    fireEvent.change(form.getByLabelText("The year it is for"), { target: { value: "2027" } });
    fireEvent.click(form.getByLabelText("Catering"));
    fireEvent.click(form.getByLabelText("Plus VAT"));
    fireEvent.click(form.getByRole("button", { name: "Save the figure" }));
    expect(form.getByRole("alert").textContent).toBe("That address is on tagvenue.com, a site that lists many venues. Record the figure from the venue's own page or brochure, and use the listing only to find it.");
    expect(mocks.recordCapture).not.toHaveBeenCalled();

    fireEvent.change(form.getByLabelText("The page's address"), { target: { value: "https://www.glasgowartclub.co.uk/hire" } });
    fireEvent.click(form.getByRole("button", { name: "Save the figure" }));
    await waitFor(() => {
      expect(mocks.recordCapture).toHaveBeenCalledWith(VENUE, ART_CLUB, {
        sourceUrl: "https://www.glasgowartclub.co.uk/hire", sourceKind: "own_page", seenOn: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/u) as string,
        packageName: "Dinner in the gallery", amountMinor: 7_500, currency: "GBP", priceBasis: "per_head", guests: null, priceYear: 2027,
        includes: ["catering"], includesNote: null, vat: "excluded", evidenceFileId: null, note: null, supersedesId: null,
      });
    });
    expect(mocks.uploadFile).not.toHaveBeenCalled();
    expect(await screen.findByText("Recorded Dinner in the gallery for Glasgow Art Club.")).toBeTruthy();
  });

  it("asks for the year, or that the page gives none, and names the figure it replaces", async () => {
    mocks.recordCapture.mockResolvedValue({ id: "cccccccc-3333-4333-8333-000000000002", watch: watch({ competitors: [competitor({ captures: [capture()] }), ART] }) });
    await openWatch(2);
    fireEvent.click(await screen.findByRole("button", { name: /^voco Grand Central\./u }));
    fireEvent.click(screen.getAllByRole("button", { name: "Record a newer figure" })[0] as HTMLElement);
    const form = within(screen.getByRole("complementary", { name: "Record a newer figure" }));
    expect(form.getByText(/It replaces the figure seen 17 Oct 2026\./u)).toBeTruthy();
    fireEvent.change(form.getByLabelText("Price, £"), { target: { value: "135" } });
    fireEvent.click(form.getByLabelText("The page gives no year"));
    fireEvent.click(form.getByRole("button", { name: "Save the figure" }));
    await waitFor(() => { expect(mocks.recordCapture).toHaveBeenCalledTimes(1); });
    expect(mocks.recordCapture.mock.calls[0]?.[2]).toMatchObject({ amountMinor: 13_500, priceYear: null, supersedesId: capture().id, vat: "not_stated" });
  });
});

describe("the weekly page check", () => {
  it("turns on only once the terms and robots.txt are both recorded as read", async () => {
    mocks.allowPageCheck.mockResolvedValue(watch({ competitors: [competitor({ pageCheck: { ...competitor().pageCheck, allowedAt: "2026-10-17T11:00:00.000Z", allowedByName: "Callum Reid" } }), ART] }));
    await openWatch(2);
    fireEvent.click(await screen.findByRole("button", { name: /^voco Grand Central\./u }));
    const allow = screen.getByRole("button", { name: "Allow the weekly check" });
    expect((allow as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByText(/It never reads a price\. Your name and the date are recorded\./u)).toBeTruthy();
    fireEvent.click(screen.getByLabelText("I have read the site's terms, and they allow an automated check"));
    expect((allow as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getByLabelText("I have read its robots.txt, and it allows this page"));
    expect((allow as HTMLButtonElement).disabled).toBe(false);
    fireEvent.click(allow);
    await waitFor(() => { expect(mocks.allowPageCheck).toHaveBeenCalledWith(VENUE, VOCO); });
    expect(await screen.findByText("The weekly page check for voco Grand Central is on, under your name.")).toBeTruthy();
  });

  it("checks the allowed pages on request and says what it did", async () => {
    const allowed = competitor({ pageCheck: { ...competitor().pageCheck, allowedAt: "2026-10-17T09:00:00.000Z", allowedByName: "Callum Reid" } });
    mocks.getCompetitorWatch.mockResolvedValue(watch({ competitors: [allowed, ART] }));
    mocks.checkPagesNow.mockResolvedValue({
      run: { checkedAt: "2026-10-17T12:00:00.000Z", results: [
        { competitorId: VOCO, outcome: "changed", nextCheckAfter: "2026-10-24T12:00:00.000Z" },
        { competitorId: ART_CLUB, outcome: "not_allowed", nextCheckAfter: null },
      ] },
      watch: watch({ competitors: [competitor({ pageCheck: { ...allowed.pageCheck, changedAt: "2026-10-17T12:00:00.000Z" } }), ART] }),
    });
    await openWatch(2);
    const overview = within(screen.getByRole("complementary", { name: "The competitor watch" }));
    fireEvent.click(overview.getByRole("button", { name: "Check the pages now" }));
    await waitFor(() => { expect(mocks.checkPagesNow).toHaveBeenCalledWith(VENUE); });
    expect(await screen.findByText("Checked 1 page: 1 changed. 1 with the check off.")).toBeTruthy();
  });
});

describe("beside a suggestion", () => {
  function context(): MarketContext {
    return {
      year: 2027, today: "2026-10-17", more: 0, checkDue: 2,
      lines: [{
        captureId: capture().id, competitorId: VOCO, competitorName: "voco Grand Central", tier: "primary",
        packageName: "Grand Central Package", amountMinor: 13_000, currency: "GBP", priceBasis: "per_head", guests: 150,
        priceYear: 2027, includes: ["room_hire", "catering"], includesNote: null, vat: "not_stated", seenOn: "2026-10-17",
        capturedByName: "Callum Reid", sourceUrl: "https://grandcentral.vocohotels.com/wedding-packages/", sourceKind: "own_page",
      }],
    };
  }

  it("keeps the market context closed until asked, then shows dated, sourced figures as context only", async () => {
    mocks.getMarketContext.mockResolvedValue(context());
    render(<PricingDesk />);
    fireEvent.click(await screen.findByRole("button", { name: "Suggestions, 1" }));
    fireEvent.click(await screen.findByRole("button", { name: /^Sat 12 Jun 2027, Grand Hall — Evening/u }));
    expect(screen.getByText("Context only. Not used to set the suggestion.")).toBeTruthy();
    expect(mocks.getMarketContext).not.toHaveBeenCalled();

    const disclosure = screen.getByRole("button", { name: /^Market context/u });
    expect(disclosure.getAttribute("aria-expanded")).toBe("false");
    fireEvent.click(disclosure);
    await waitFor(() => { expect(mocks.getMarketContext).toHaveBeenCalledWith(VENUE, 2027, expect.any(AbortSignal)); });
    expect(await screen.findByText("£130 a head, at least 150 guests")).toBeTruthy();
    expect(screen.getByText(/^Seen 17 Oct 2026 by Callum Reid · Own site, grandcentral\.vocohotels\.com/u)).toBeTruthy();
    expect(screen.getByText("This rate is charged a booking. Each figure below keeps its own basis; none is converted, averaged or ranked.")).toBeTruthy();
    expect(screen.getByText("2 due a check are not shown.")).toBeTruthy();
    expect(screen.getByRole("link", { name: /^Open the source/u }).getAttribute("rel")).toBe("noopener noreferrer");
    // Never a way to match, undercut or average.
    expect(screen.queryByRole("button", { name: /match|undercut|average/iu })).toBeNull();
    expect(screen.queryByText(/average of|undercut/iu)).toBeNull();
  });

  it("says when the figures cannot be read, and that the suggestion is unaffected", async () => {
    mocks.getMarketContext.mockRejectedValueOnce(new Error("Unavailable")).mockResolvedValueOnce(context());
    render(<PricingDesk />);
    fireEvent.click(await screen.findByRole("button", { name: "Suggestions, 1" }));
    fireEvent.click(await screen.findByRole("button", { name: /^Sat 12 Jun 2027, Grand Hall — Evening/u }));
    fireEvent.click(screen.getByRole("button", { name: /^Market context/u }));
    expect(await screen.findByText("The figures could not be read. The suggestion is unaffected.")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(await screen.findByText("£130 a head, at least 150 guests")).toBeTruthy();
  });
});
