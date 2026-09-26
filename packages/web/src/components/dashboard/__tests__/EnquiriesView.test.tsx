import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Enquiry, EnquiryListQuery, EnquiryPage, EnquiryStageCounts } from "../../../api/enquiries.js";
import type { Space, VenueDetail } from "../../../api/spaces.js";
import { ApiError } from "../../../api/client.js";
import { EnquiriesView } from "../EnquiriesView.js";

// ---------------------------------------------------------------------------
// The staff Enquiries desk: pipeline counts that filter, a newest-first list
// paged with an honest count, a decision panel that says what each decision
// sends, and keyboard triage. Responses for a list or enquiry the reader has
// already left never land.
// ---------------------------------------------------------------------------

const { mocks } = vi.hoisted(() => ({
  mocks: {
    addToast: vi.fn(),
    aiDraftsAvailable: vi.fn<() => boolean | undefined>(),
    countEnquiryStages: vi.fn(),
    createOpportunityFromEnquiry: vi.fn(),
    getEnquiry: vi.fn(),
    getEnquiryHistory: vi.fn(),
    getVenue: vi.fn(),
    listEnquiryPage: vi.fn(),
    transitionEnquiry: vi.fn(),
  },
}));

vi.mock("../../../api/enquiries.js", () => ({
  COUNTED_ENQUIRY_STATES: ["submitted", "under_review", "approved", "rejected", "withdrawn"],
  countEnquiryStages: mocks.countEnquiryStages,
  getEnquiry: mocks.getEnquiry,
  getEnquiryHistory: mocks.getEnquiryHistory,
  listEnquiryPage: mocks.listEnquiryPage,
  transitionEnquiry: mocks.transitionEnquiry,
}));

vi.mock("../../../api/spaces.js", () => ({
  getVenue: mocks.getVenue,
}));

vi.mock("../../../api/crm.js", () => ({
  createOpportunityFromEnquiry: mocks.createOpportunityFromEnquiry,
}));

vi.mock("../../../stores/toast-store.js", () => ({
  useToastStore: (
    selector: (state: { readonly addToast: typeof mocks.addToast }) => unknown,
  ): unknown => selector({ addToast: mocks.addToast }),
}));

vi.mock("../../../stores/auth-store.js", () => ({
  useAuthStore: (
    selector: (state: { readonly user: { readonly name: string } }) => unknown,
  ): unknown => selector({ user: { name: "Elaine MacGregor" } }),
}));

vi.mock("../../ai/AIDraftPanel.js", () => ({
  AIDraftPanel: () => <div>AI draft</div>,
}));

vi.mock("../../../hooks/use-ai-drafts-available.js", () => ({
  useAIDraftsAvailable: () => mocks.aiDraftsAvailable(),
}));

// Thursday 24 September 2026, 15:00 in Glasgow.
const NOW = Date.parse("2026-09-24T14:00:00.000Z");

function enquiry(n: number, state = "submitted"): Enquiry {
  return {
    id: `enquiry-${String(n)}`, venueId: "venue-1", spaceId: "space-1", configurationId: null, userId: "user-1",
    guestEmail: null, guestPhone: null, guestName: null, state, name: `Client ${String(n)}`,
    email: `client${String(n)}@example.com`, preferredDate: null, eventType: null, estimatedGuests: null,
    message: null, createdAt: new Date(Date.UTC(2026, 6, 1) + n * 86_400_000).toISOString(),
    updatedAt: "2026-07-01T00:00:00.000Z",
  };
}

/** The server's newest-first list: enquiry `newest` down to 1. */
function serverList(newest: number, state = "submitted"): Enquiry[] {
  return Array.from({ length: newest }, (_, index) => enquiry(newest - index, state));
}

function page(
  rows: readonly Enquiry[],
  window: { readonly offset?: number; readonly limit?: number },
  order: EnquiryPage["order"] = "created_desc",
): EnquiryPage {
  const offset = window.offset ?? 0;
  const limit = window.limit ?? 20;
  return { rows: rows.slice(offset, offset + limit), total: rows.length, limit, offset, order };
}

function stageCounts(
  byState: Partial<EnquiryStageCounts["byState"]> = {},
  longestWaiting: Enquiry | null = null,
): EnquiryStageCounts {
  const counts = { submitted: 0, under_review: 0, approved: 0, rejected: 0, withdrawn: 0, ...byState };
  return { all: Object.values(counts).reduce((sum, count) => sum + count, 0), byState: counts, longestWaiting };
}

const GRAND_HALL: Space = {
  id: "space-1", venueId: "venue-1", name: "Grand Hall", slug: "grand-hall",
  widthM: "21", lengthM: "10.5", heightM: "7", floorPlanOutline: [],
};

function venue(slug: string): VenueDetail {
  return {
    id: "venue-1", name: "Trades Hall Glasgow", slug, address: "85 Glassford Street", logoUrl: null, brandColour: null,
    spaces: [GRAND_HALL],
  };
}

interface Deferred<T> {
  readonly promise: Promise<T>;
  readonly resolve: (value: T) => void;
  readonly reject: (reason: unknown) => void;
}

function deferred<T>(): Deferred<T> {
  let resolvePromise: ((value: T) => void) | undefined;
  let rejectPromise: ((reason: unknown) => void) | undefined;
  const promise = new Promise<T>((resolve, reject) => { resolvePromise = resolve; rejectPromise = reject; });
  return {
    promise,
    resolve: (value) => { resolvePromise?.(value); },
    reject: (reason) => { rejectPromise?.(reason); },
  };
}

interface PageCall {
  readonly query: EnquiryListQuery;
  readonly signal: AbortSignal;
  readonly response: Deferred<EnquiryPage>;
}

/** Every list request stays pending until the test settles it. */
function controlPages(): PageCall[] {
  const calls: PageCall[] = [];
  mocks.listEnquiryPage.mockImplementation((query: EnquiryListQuery, signal: AbortSignal) => {
    const response = deferred<EnquiryPage>();
    calls.push({ query, signal, response });
    return response.promise;
  });
  return calls;
}

async function settle(call: PageCall | undefined, value: EnquiryPage): Promise<void> {
  if (call === undefined) throw new Error("Expected a list request");
  await act(async () => { call.response.resolve(value); await call.response.promise; });
}

async function fail(call: PageCall | undefined): Promise<void> {
  if (call === undefined) throw new Error("Expected a list request");
  await act(async () => { call.response.reject(new Error("Unavailable")); await call.response.promise.catch(() => undefined); });
}

const listedRows = (): HTMLButtonElement[] => [...document.querySelectorAll<HTMLButtonElement>("button[data-enquiry-id]")];
const cardNames = (): string[] => listedRows().map((row) => row.querySelector(".enq-row__title")?.textContent ?? "");
const names = (rows: readonly Enquiry[]): string[] => rows.map((row) => row.name);
const countNote = (): string => screen.getByTestId("enquiry-list-count").textContent ?? "";
const escapeRegExp = (text: string): string => text.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");

/** A listed enquiry's row; its accessible name starts with the client's name. */
function row(name: string): HTMLElement {
  return screen.getByRole("button", { name: new RegExp(`^${escapeRegExp(name)},`, "u") });
}

/** A stage filter, before or after its count is known. */
function stage(label: string): HTMLElement {
  return screen.getByRole("button", { name: new RegExp(`^${escapeRegExp(label)}(, [\\d,]+)?$`, "u") });
}

function summaryText(): string {
  return document.querySelector(".enq-summary p")?.textContent ?? "";
}

function activeElement(): Element | null {
  return document.activeElement;
}

/** Lays the desk out as a wide screen does: the list and the panel side by side. */
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

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(NOW);
  mocks.getEnquiryHistory.mockResolvedValue([]);
  mocks.countEnquiryStages.mockResolvedValue(stageCounts({ submitted: 57 }));
  mocks.getVenue.mockResolvedValue(venue("trades-hall"));
  mocks.aiDraftsAvailable.mockReturnValue(true);
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("EnquiriesView newest-first paging", () => {
  it("asks for the newest enquiries one page at a time and says how many exist", async () => {
    const calls = controlPages();
    const server = serverList(57);
    render(<EnquiriesView />);

    await waitFor(() => { expect(calls).toHaveLength(1); });
    expect(calls[0]?.query).toEqual({ order: "created_desc", offset: 0, limit: 20 });
    expect(screen.getByText("Loading enquiries…").closest("[role='status']")).not.toBeNull();

    await settle(calls[0], page(server, { offset: 0, limit: 20 }));
    expect(cardNames()).toEqual(names(server.slice(0, 20)));
    expect(countNote()).toBe("Showing 20 of 57 enquiries, newest first");
    expect(screen.queryByText("Loading enquiries…")).toBeNull();
    expect(screen.getByRole("button", { name: "Show 20 more" })).toBeDefined();
  });

  it("appends further pages without repeating rows until every enquiry is listed", async () => {
    const calls = controlPages();
    const server = serverList(57);
    render(<EnquiriesView />);
    await waitFor(() => { expect(calls).toHaveLength(1); });
    await settle(calls[0], page(server, { offset: 0, limit: 20 }));

    fireEvent.click(screen.getByRole("button", { name: "Show 20 more" }));
    await waitFor(() => { expect(calls).toHaveLength(2); });
    // The window re-reads five listed rows to prove where the list continues.
    expect(calls[1]?.query).toEqual({ order: "created_desc", offset: 15, limit: 25 });
    const busy = screen.getByTestId("enquiry-list-more");
    expect(busy.textContent).toBe("Loading more…");
    expect(busy.hasAttribute("disabled")).toBe(true);
    expect(busy.getAttribute("aria-busy")).toBe("true");
    expect(busy.querySelector("svg[data-activity-indicator]")).not.toBeNull();

    await settle(calls[1], page(server, { offset: 15, limit: 25 }));
    expect(cardNames()).toEqual(names(server.slice(0, 40)));
    expect(countNote()).toBe("Showing 40 of 57 enquiries, newest first");

    fireEvent.click(screen.getByRole("button", { name: "Show 17 more" }));
    await waitFor(() => { expect(calls).toHaveLength(3); });
    expect(calls[2]?.query).toEqual({ order: "created_desc", offset: 35, limit: 25 });
    await settle(calls[2], page(server, { offset: 35, limit: 25 }));

    expect(cardNames()).toEqual(names(server));
    expect(countNote()).toBe("Showing all 57 enquiries, newest first");
    expect(screen.queryByTestId("enquiry-list-more")).toBeNull();
    expect(screen.queryByText(/changed while this list was open/u)).toBeNull();
  });

  it("keeps a stage filter newest first and starts its paging afresh", async () => {
    const calls = controlPages();
    const all = serverList(57);
    render(<EnquiriesView />);
    await waitFor(() => { expect(calls).toHaveLength(1); });
    await settle(calls[0], page(all, { offset: 0, limit: 20 }));
    fireEvent.click(screen.getByRole("button", { name: "Show 20 more" }));
    await waitFor(() => { expect(calls).toHaveLength(2); });
    await settle(calls[1], page(all, { offset: 15, limit: 25 }));

    fireEvent.click(stage("In review"));
    await waitFor(() => { expect(calls).toHaveLength(3); });
    expect(calls[2]?.query).toEqual({ status: "under_review", order: "created_desc", offset: 0, limit: 20 });
    expect(stage("In review").getAttribute("aria-pressed")).toBe("true");
    // The previous filter's rows and count are not presented as this filter's.
    expect(cardNames()).toEqual([]);
    expect(countNote()).toBe("");

    const reviewing = serverList(23, "under_review");
    await settle(calls[2], page(reviewing, { offset: 0, limit: 20 }));
    expect(cardNames()).toEqual(names(reviewing.slice(0, 20)));
    expect(countNote()).toBe("Showing 20 of 23 enquiries in review, newest first");
    fireEvent.click(screen.getByRole("button", { name: "Show 3 more" }));
    await waitFor(() => { expect(calls).toHaveLength(4); });
    expect(calls[3]?.query).toEqual({ status: "under_review", order: "created_desc", offset: 15, limit: 25 });
  });

  it("discards a slow first page that resolves after the filter changed", async () => {
    const calls = controlPages();
    render(<EnquiriesView />);
    await waitFor(() => { expect(calls).toHaveLength(1); });

    fireEvent.click(stage("New"));
    await waitFor(() => { expect(calls).toHaveLength(2); });
    expect(calls[0]?.signal.aborted).toBe(true);

    await settle(calls[1], page([enquiry(3)], { offset: 0, limit: 20 }));
    await settle(calls[0], page(serverList(57, "approved"), { offset: 0, limit: 20 }));

    expect(cardNames()).toEqual(["Client 3"]);
    expect(countNote()).toBe("Showing 1 new enquiry, newest first");
  });

  it("never appends a show-more that resolves after the filter changed", async () => {
    const calls = controlPages();
    const all = serverList(57);
    render(<EnquiriesView />);
    await waitFor(() => { expect(calls).toHaveLength(1); });
    await settle(calls[0], page(all, { offset: 0, limit: 20 }));
    fireEvent.click(screen.getByRole("button", { name: "Show 20 more" }));
    await waitFor(() => { expect(calls).toHaveLength(2); });

    fireEvent.click(stage("New"));
    await waitFor(() => { expect(calls).toHaveLength(3); });
    expect(calls[1]?.signal.aborted).toBe(true);
    const submitted = serverList(2);
    await settle(calls[2], page(submitted, { offset: 0, limit: 20 }));
    // The stale page resolves anyway (a transport may ignore the abort).
    await settle(calls[1], page(all, { offset: 15, limit: 25 }));

    expect(cardNames()).toEqual(names(submitted));
    expect(countNote()).toBe("Showing all 2 new enquiries, newest first");
    expect(screen.queryByTestId("enquiry-list-more")).toBeNull();
  });

  it("joins the next page without a repeat when a new enquiry arrived meanwhile", async () => {
    const calls = controlPages();
    render(<EnquiriesView />);
    await waitFor(() => { expect(calls).toHaveLength(1); });
    await settle(calls[0], page(serverList(57), { offset: 0, limit: 20 }));

    fireEvent.click(screen.getByRole("button", { name: "Show 20 more" }));
    await waitFor(() => { expect(calls).toHaveLength(2); });
    await settle(calls[1], page(serverList(58), { offset: 15, limit: 25 }));

    const shown = cardNames();
    expect(shown).toEqual(names(serverList(57).slice(0, 39)));
    expect(new Set(shown).size).toBe(shown.length);
    expect(countNote()).toBe("Showing 39 of 58 enquiries, newest first");
    expect(screen.queryByText(/changed while this list was open/u)).toBeNull();
  });

  it("says when a later page cannot be joined to the list and reloads it on request", async () => {
    const calls = controlPages();
    render(<EnquiriesView />);
    await waitFor(() => { expect(calls).toHaveLength(1); });
    await settle(calls[0], page(serverList(57), { offset: 0, limit: 20 }));

    fireEvent.click(screen.getByRole("button", { name: "Show 20 more" }));
    await waitFor(() => { expect(calls).toHaveLength(2); });
    // Six listed enquiries left the list elsewhere: the window holds none of the listed rows.
    const shrunk = serverList(51);
    await settle(calls[1], page(shrunk, { offset: 15, limit: 25 }));
    const notice = screen.getByText("Enquiries changed while this list was open, so it may be incomplete or out of date.");
    expect(notice.getAttribute("role")).toBe("status");

    fireEvent.click(screen.getByRole("button", { name: "Reload list" }));
    await waitFor(() => { expect(calls).toHaveLength(3); });
    expect(calls[2]?.query).toEqual({ order: "created_desc", offset: 0, limit: 20 });
    // The rows stay usable while the same filter reloads, and the counts are read again.
    expect(cardNames()).toHaveLength(45);
    await waitFor(() => { expect(mocks.countEnquiryStages).toHaveBeenCalledTimes(2); });
    await settle(calls[2], page(shrunk, { offset: 0, limit: 20 }));
    expect(cardNames()).toEqual(names(shrunk.slice(0, 20)));
    expect(screen.queryByText(/changed while this list was open/u)).toBeNull();
    expect(countNote()).toBe("Showing 20 of 51 enquiries, newest first");
  });

  it("says so when the finished list holds fewer enquiries than now exist", async () => {
    const calls = controlPages();
    render(<EnquiriesView />);
    await waitFor(() => { expect(calls).toHaveLength(1); });
    await settle(calls[0], page(serverList(25), { offset: 0, limit: 20 }));

    fireEvent.click(screen.getByRole("button", { name: "Show 5 more" }));
    await waitFor(() => { expect(calls).toHaveLength(2); });
    // Three enquiries arrived at the top meanwhile; the last page ends the list.
    await settle(calls[1], page(serverList(28), { offset: 15, limit: 25 }));

    expect(cardNames()).toEqual(names(serverList(25)));
    expect(countNote()).toBe("Showing 25 of 28 enquiries, newest first");
    expect(screen.queryByTestId("enquiry-list-more")).toBeNull();
    expect(screen.getByRole("button", { name: "Reload list" })).toBeDefined();
  });

  it("keeps the list and offers another try when a further page fails", async () => {
    const calls = controlPages();
    const server = serverList(57);
    render(<EnquiriesView />);
    await waitFor(() => { expect(calls).toHaveLength(1); });
    await settle(calls[0], page(server, { offset: 0, limit: 20 }));

    fireEvent.click(screen.getByRole("button", { name: "Show 20 more" }));
    await waitFor(() => { expect(calls).toHaveLength(2); });
    await fail(calls[1]);
    expect(screen.getByRole("alert").textContent).toBe("More enquiries could not be loaded. Try again.");
    expect(cardNames()).toEqual(names(server.slice(0, 20)));

    fireEvent.click(screen.getByRole("button", { name: "Show 20 more" }));
    await waitFor(() => { expect(calls).toHaveLength(3); });
    expect(calls[2]?.query).toEqual(calls[1]?.query);
    await settle(calls[2], page(server, { offset: 15, limit: 25 }));
    expect(screen.queryByRole("alert")).toBeNull();
    expect(cardNames()).toEqual(names(server.slice(0, 40)));
  });

  it("reports a failed first page instead of an empty list, then retries", async () => {
    const calls = controlPages();
    render(<EnquiriesView />);
    await waitFor(() => { expect(calls).toHaveLength(1); });
    await fail(calls[0]);

    expect(mocks.addToast).toHaveBeenCalledWith("Failed to load enquiries", "error");
    const alert = screen.getByRole("alert");
    expect(alert.textContent).toContain("Enquiries could not be loaded.");
    expect(screen.queryByText("No enquiries yet")).toBeNull();
    expect(screen.queryByText("Loading enquiries…")).toBeNull();

    fireEvent.click(within(alert).getByRole("button", { name: "Try again" }));
    await waitFor(() => { expect(calls).toHaveLength(2); });
    await settle(calls[1], page(serverList(4), { offset: 0, limit: 20 }));
    expect(screen.queryByRole("alert")).toBeNull();
    expect(cardNames()).toEqual(names(serverList(4)));
  });

  it("claims no order against an API that predates ordering, and still pages", async () => {
    const calls = controlPages();
    const legacy = serverList(57).reverse();
    render(<EnquiriesView />);
    await waitFor(() => { expect(calls).toHaveLength(1); });
    await settle(calls[0], page(legacy, { offset: 0, limit: 20 }, null));

    expect(countNote()).toBe("Showing 20 of 57 enquiries");
    fireEvent.click(screen.getByRole("button", { name: "Show 20 more" }));
    await waitFor(() => { expect(calls).toHaveLength(2); });
    expect(calls[1]?.query).toEqual({ order: "created_desc", offset: 15, limit: 25 });
    await settle(calls[1], page(legacy, { offset: 15, limit: 25 }, null));
    expect(cardNames()).toEqual(names(legacy.slice(0, 40)));
    expect(screen.queryByText(/changed while this list was open/u)).toBeNull();
  });

  it("drops an enquiry that leaves the stage filter and keeps later pages aligned", async () => {
    const calls = controlPages();
    const submitted = serverList(31);
    const reviewed = { ...enquiry(29), state: "under_review" };
    mocks.transitionEnquiry.mockResolvedValue(reviewed);
    render(<EnquiriesView />);
    await waitFor(() => { expect(calls).toHaveLength(1); });
    fireEvent.click(stage("New"));
    await waitFor(() => { expect(calls).toHaveLength(2); });
    await settle(calls[1], page(submitted, { offset: 0, limit: 20 }));

    fireEvent.click(row("Client 29"));
    fireEvent.click(screen.getByRole("button", { name: "Start review" }));
    // Starting a review sends nothing, so it needs no confirmation; the panel
    // stays on the enquiry with its new status and next step.
    expect(await screen.findByRole("button", { name: "Approve…" })).toBeDefined();
    expect(mocks.transitionEnquiry).toHaveBeenCalledWith("enquiry-29", "under_review", undefined);
    expect(screen.getByRole("heading", { name: "Client 29" })).toBeDefined();

    fireEvent.click(screen.getByRole("button", { name: "Back to enquiries" }));
    expect(cardNames()).not.toContain("Client 29");
    expect(cardNames()).toHaveLength(19);
    expect(countNote()).toBe("Showing 19 of 30 new enquiries, newest first");

    fireEvent.click(screen.getByRole("button", { name: "Show 11 more" }));
    await waitFor(() => { expect(calls).toHaveLength(3); });
    expect(calls[2]?.query).toEqual({ status: "submitted", order: "created_desc", offset: 14, limit: 25 });
    const remaining = submitted.filter((item) => item.id !== reviewed.id);
    await settle(calls[2], page(remaining, { offset: 14, limit: 25 }));
    expect(cardNames()).toEqual(names(remaining));
    expect(countNote()).toBe("Showing all 30 new enquiries, newest first");
    expect(screen.queryByText(/changed while this list was open/u)).toBeNull();
  });

  it("keeps an enquiry with its new status in the unfiltered list", async () => {
    const calls = controlPages();
    const reviewed = { ...enquiry(5), state: "under_review" };
    mocks.transitionEnquiry.mockResolvedValue(reviewed);
    render(<EnquiriesView />);
    await waitFor(() => { expect(calls).toHaveLength(1); });
    await settle(calls[0], page(serverList(6), { offset: 0, limit: 20 }));

    fireEvent.click(row("Client 5"));
    fireEvent.click(screen.getByRole("button", { name: "Start review" }));
    expect(await screen.findByRole("button", { name: "Approve…" })).toBeDefined();
    fireEvent.click(screen.getByRole("button", { name: "Back to enquiries" }));

    expect(cardNames()).toEqual(names(serverList(6)));
    expect(row("Client 5").getAttribute("aria-label")).toContain("Client 5, In review");
    expect(row("Client 5").textContent).toContain("In review");
    expect(countNote()).toBe("Showing all 6 enquiries, newest first");
  });

  it("follows on with the next page when working through a stage empties it", async () => {
    const calls = controlPages();
    render(<EnquiriesView />);
    await waitFor(() => { expect(calls).toHaveLength(1); });
    // The listed rows are gone while five more wait on the server.
    await settle(calls[0], { rows: [], total: 5, limit: 20, offset: 0, order: "created_desc" });

    await waitFor(() => { expect(calls).toHaveLength(2); });
    expect(calls[1]?.query).toEqual({ order: "created_desc", offset: 0, limit: 20 });
    expect(screen.queryByText("No enquiries yet")).toBeNull();
    await settle(calls[1], page(serverList(5), { offset: 0, limit: 20 }));
    expect(cardNames()).toEqual(names(serverList(5)));
  });

  it("still opens a pre-selected enquiry that the first page does not hold", async () => {
    const calls = controlPages();
    const target = enquiry(2);
    mocks.getEnquiry.mockResolvedValue(target);
    const onDetailClose = vi.fn();
    render(<EnquiriesView initialSelectedId={target.id} onDetailClose={onDetailClose} />);

    await waitFor(() => { expect(calls).toHaveLength(1); });
    expect(mocks.getEnquiry).toHaveBeenCalledWith(target.id, expect.any(AbortSignal));
    await settle(calls[0], page(serverList(57), { offset: 0, limit: 20 }));
    const heading = await screen.findByRole("heading", { name: "Client 2" });
    expect(activeElement()).toBe(heading);

    fireEvent.click(screen.getByRole("button", { name: "Back to profile" }));
    expect(onDetailClose).toHaveBeenCalledTimes(1);
  });
});

describe("EnquiriesView pipeline", () => {
  it("shows each stage's count as its filter and says what is waiting", async () => {
    const oldest = { ...enquiry(1), createdAt: "2026-09-18T07:55:00.000Z" };
    mocks.countEnquiryStages.mockResolvedValue(stageCounts({ submitted: 4, under_review: 3, approved: 3, rejected: 1, withdrawn: 1 }, oldest));
    mocks.listEnquiryPage.mockResolvedValue(page(serverList(3), {}));
    render(<EnquiriesView />);

    expect(await screen.findByRole("button", { name: "New, 4" })).toBeDefined();
    expect(screen.getByRole("button", { name: "In review, 3" })).toBeDefined();
    expect(screen.getByRole("button", { name: "Declined, 1" })).toBeDefined();
    expect(screen.getByRole("button", { name: "All, 12" }).getAttribute("aria-pressed")).toBe("true");
    expect(summaryText()).toBe(
      "4 new enquiries are waiting for a first look; the longest-waiting arrived 6 days ago. 3 enquiries in review are waiting for a decision.",
    );
    expect(screen.getByText("Thursday 24 September")).toBeDefined();
    expect(screen.getByText("Good afternoon, Elaine")).toBeDefined();
  });

  it("says when the counts cannot be read and counts again on request", async () => {
    mocks.countEnquiryStages.mockRejectedValueOnce(new Error("Unavailable"));
    mocks.listEnquiryPage.mockResolvedValue(page(serverList(3), {}));
    render(<EnquiriesView />);

    expect(await screen.findByText("The stage counts could not be loaded.")).toBeDefined();
    // The list still works without them, and no stage shows a made-up number.
    expect(stage("New").getAttribute("aria-label")).toBe("New");
    expect(cardNames()).toEqual(names(serverList(3)));

    fireEvent.click(screen.getByRole("button", { name: "Count again" }));
    expect(await screen.findByRole("button", { name: "New, 57" })).toBeDefined();
    expect(summaryText()).toBe("57 new enquiries are waiting for a first look.");
  });

  it("moves the counts with each change made here, then reads them again", async () => {
    mocks.countEnquiryStages.mockResolvedValueOnce(stageCounts({ submitted: 4, under_review: 3 }));
    const refreshed = deferred<EnquiryStageCounts>();
    mocks.countEnquiryStages.mockReturnValueOnce(refreshed.promise);
    mocks.listEnquiryPage.mockResolvedValue(page(serverList(4), {}));
    mocks.transitionEnquiry.mockResolvedValue({ ...enquiry(4), state: "under_review" });
    render(<EnquiriesView />);
    expect(await screen.findByRole("button", { name: "New, 4" })).toBeDefined();

    fireEvent.click(row("Client 4"));
    fireEvent.click(screen.getByRole("button", { name: "Start review" }));
    expect(await screen.findByRole("button", { name: "Approve…" })).toBeDefined();
    fireEvent.click(screen.getByRole("button", { name: "Back to enquiries" }));

    expect(stage("New").getAttribute("aria-label")).toBe("New, 3");
    expect(stage("In review").getAttribute("aria-label")).toBe("In review, 4");
    expect(mocks.countEnquiryStages).toHaveBeenCalledTimes(2);
    await act(async () => { refreshed.resolve(stageCounts({ submitted: 5, under_review: 4 })); await refreshed.promise; });
    // Someone else's new enquiry arrived meanwhile; the server's count wins.
    expect(stage("New").getAttribute("aria-label")).toBe("New, 5");
  });

  it("says a finished stage is finished", async () => {
    const calls = controlPages();
    mocks.countEnquiryStages.mockResolvedValue(stageCounts({ approved: 2 }));
    render(<EnquiriesView />);
    await waitFor(() => { expect(calls).toHaveLength(1); });
    fireEvent.click(stage("New"));
    await waitFor(() => { expect(calls).toHaveLength(2); });
    await settle(calls[1], page([], {}));

    expect(screen.getByRole("heading", { name: "Nothing new to answer" })).toBeDefined();
    expect(summaryText()).toBe("All caught up: nothing is waiting for a first look or a decision.");
  });

  it("groups the list by when each enquiry arrived", async () => {
    const today = { ...enquiry(3), createdAt: "2026-09-24T08:10:00.000Z" };
    const yesterday = { ...enquiry(2), createdAt: "2026-09-23T16:20:00.000Z" };
    const august = { ...enquiry(1), createdAt: "2026-08-14T12:00:00.000Z" };
    mocks.listEnquiryPage.mockResolvedValue(page([today, yesterday, august], {}));
    render(<EnquiriesView />);

    const headings = await screen.findAllByRole("heading", { level: 2 });
    expect(headings.map((heading) => heading.textContent)).toEqual(["Today, 1", "Yesterday, 1", "August 2026, 1"]);
    // The room name arrives with the venue's rooms, after the rows.
    await waitFor(() => {
      expect(row("Client 3").getAttribute("aria-label")).toBe("Client 3, New, event date to be confirmed, Grand Hall, received 5 hours ago");
    });
  });
});

describe("EnquiriesView decisions", () => {
  function reviewing(): Enquiry {
    return {
      ...enquiry(5, "under_review"), guestEmail: "priya@lumen.example", configurationId: "config-1",
      eventType: "Product launch", estimatedGuests: 60, preferredDate: "2026-11-05",
    };
  }

  it("names what an approval sends before sending it, and keeps the note for the timeline", async () => {
    const enquiryInReview = reviewing();
    mocks.listEnquiryPage.mockResolvedValue(page([enquiryInReview], {}));
    mocks.transitionEnquiry.mockResolvedValue({ ...enquiryInReview, state: "approved" });
    render(<EnquiriesView />);

    fireEvent.click(await screen.findByRole("button", { name: /^Client 5,/u }));
    expect(screen.getByText("5 Nov 2026")).toBeDefined();
    expect(screen.getByText("Thursday, in 6 weeks")).toBeDefined();
    fireEvent.click(screen.getByRole("button", { name: "Approve…" }));

    const confirm = screen.getByRole("group", { name: "Approve Client 5’s enquiry?" });
    expect(within(confirm).getByText(
      "Approving emails priya@lumen.example to say the enquiry is approved, with a link to their layout.",
    )).toBeDefined();
    expect(mocks.transitionEnquiry).not.toHaveBeenCalled();
    fireEvent.change(within(confirm).getByRole("textbox", { name: "Note for the timeline (optional, not in the email)" }),
      { target: { value: "  Deposit invoice sent.  " } });
    fireEvent.click(within(confirm).getByRole("button", { name: "Approve and email" }));

    await waitFor(() => {
      expect(mocks.transitionEnquiry).toHaveBeenCalledWith("enquiry-5", "approved", "Deposit invoice sent.");
    });
    expect(await screen.findByText("Approved.")).toBeDefined();
    expect(screen.queryByRole("group", { name: /^Approve/u })).toBeNull();
    // Once approved, the opportunity is the next step.
    expect(screen.getByTestId("create-opportunity-from-enquiry").textContent).toContain("Create opportunity");
    expect(document.querySelector(".enq-panel .enq-chip--stamped")?.textContent).toBe("Approved");
  });

  it("says a decline note reaches the client, cancels on Escape and closes on a second", async () => {
    mocks.listEnquiryPage.mockResolvedValue(page([reviewing()], {}));
    render(<EnquiriesView />);

    fireEvent.click(await screen.findByRole("button", { name: /^Client 5,/u }));
    fireEvent.click(screen.getByRole("button", { name: "Decline…" }));
    const confirm = screen.getByRole("group", { name: "Decline Client 5’s enquiry?" });
    expect(within(confirm).getByText(/^Declining emails priya@lumen\.example/u)).toBeDefined();
    const note = within(confirm).getByRole("textbox", {
      name: "Note to the client (optional, shown in the email as “Note from the events team”)",
    });

    fireEvent.keyDown(note, { key: "Escape" });
    expect(screen.queryByRole("group", { name: /^Decline/u })).toBeNull();
    expect(mocks.transitionEnquiry).not.toHaveBeenCalled();
    expect(activeElement()).toBe(screen.getByRole("button", { name: "Decline…" }));

    fireEvent.keyDown(screen.getByRole("button", { name: "Decline…" }), { key: "Escape" });
    expect(screen.queryByRole("heading", { name: "Client 5", level: 2 })).toBeNull();
    expect(activeElement()).toBe(row("Client 5"));
  });

  it("sends an empty note as none", async () => {
    const enquiryInReview = reviewing();
    mocks.listEnquiryPage.mockResolvedValue(page([enquiryInReview], {}));
    mocks.transitionEnquiry.mockResolvedValue({ ...enquiryInReview, state: "rejected" });
    render(<EnquiriesView />);

    fireEvent.click(await screen.findByRole("button", { name: /^Client 5,/u }));
    fireEvent.click(screen.getByRole("button", { name: "Decline…" }));
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "   " } });
    fireEvent.click(screen.getByRole("button", { name: "Decline and email" }));

    await waitFor(() => { expect(mocks.transitionEnquiry).toHaveBeenCalledWith("enquiry-5", "rejected", undefined); });
    expect(await screen.findByText("Declined. There is nothing more to do here.")).toBeDefined();
  });

  it("starts a review with a note when asked for one", async () => {
    const fresh = enquiry(3);
    mocks.listEnquiryPage.mockResolvedValue(page([fresh], {}));
    mocks.transitionEnquiry.mockResolvedValue({ ...fresh, state: "under_review" });
    render(<EnquiriesView />);

    fireEvent.click(await screen.findByRole("button", { name: /^Client 3,/u }));
    fireEvent.click(screen.getByRole("button", { name: "Start review with a note" }));
    const confirm = screen.getByRole("group", { name: "Start reviewing Client 3’s enquiry?" });
    fireEvent.change(within(confirm).getByRole("textbox"), { target: { value: "Called; AV list to follow." } });
    fireEvent.click(within(confirm).getByRole("button", { name: "Start review" }));

    await waitFor(() => {
      expect(mocks.transitionEnquiry).toHaveBeenCalledWith("enquiry-3", "under_review", "Called; AV list to follow.");
    });
  });

  it("shows where an enquiry is when someone else already moved it on", async () => {
    const enquiryInReview = reviewing();
    mocks.listEnquiryPage.mockResolvedValue(page([enquiryInReview], {}));
    mocks.transitionEnquiry.mockRejectedValue(new ApiError(422, "Cannot transition", "INVALID_TRANSITION"));
    mocks.getEnquiry.mockResolvedValue({ ...enquiryInReview, state: "approved" });
    render(<EnquiriesView />);

    fireEvent.click(await screen.findByRole("button", { name: /^Client 5,/u }));
    fireEvent.click(screen.getByRole("button", { name: "Decline…" }));
    fireEvent.click(screen.getByRole("button", { name: "Decline and email" }));

    expect((await screen.findByRole("alert")).textContent).toBe("This enquiry had already moved on. It is approved now.");
    expect(document.querySelector(".enq-panel .enq-chip")?.textContent).toBe("Approved");
    expect(screen.queryByRole("button", { name: "Decline…" })).toBeNull();
    expect(mocks.addToast).not.toHaveBeenCalled();
  });

  it("keeps the enquiry open with a way to try again when a change fails", async () => {
    const saving = deferred<Enquiry>();
    mocks.listEnquiryPage.mockResolvedValue(page([enquiry(3)], {}));
    mocks.transitionEnquiry.mockReturnValue(saving.promise);
    render(<EnquiriesView />);

    fireEvent.click(await screen.findByRole("button", { name: /^Client 3,/u }));
    fireEvent.click(screen.getByRole("button", { name: "Start review" }));
    const working = screen.getByRole("button", { name: "Starting review…" });
    expect(working.hasAttribute("disabled")).toBe(true);
    expect(working.getAttribute("aria-busy")).toBe("true");
    expect(working.querySelector("svg[data-activity-indicator]")).not.toBeNull();

    await act(async () => { saving.reject(new Error("Unavailable")); await saving.promise.catch(() => undefined); });
    expect(screen.getByRole("alert").textContent).toBe("The status could not be changed. Try again.");
    expect(screen.getByRole("button", { name: "Start review" }).hasAttribute("disabled")).toBe(false);
    expect(mocks.addToast).not.toHaveBeenCalled();
  });

  it("mounts the AI drafting panels only once they are asked for", async () => {
    mocks.listEnquiryPage.mockResolvedValue(page([enquiry(3)], {}));
    render(<EnquiriesView />);

    fireEvent.click(await screen.findByRole("button", { name: /^Client 3,/u }));
    expect(screen.queryByText("AI draft")).toBeNull();
    const drafts = screen.getByText("Draft with AI").closest("details");
    if (drafts === null) throw new Error("Expected the drafting disclosure");
    drafts.open = true;
    fireEvent(drafts, new Event("toggle"));
    expect(screen.getAllByText("AI draft")).toHaveLength(2);
  });

  it("offers AI drafting only where a provider is configured", async () => {
    mocks.listEnquiryPage.mockResolvedValue(page([enquiry(3)], {}));
    for (const answer of [false, undefined]) {
      mocks.aiDraftsAvailable.mockReturnValue(answer);
      render(<EnquiriesView />);
      fireEvent.click(await screen.findByRole("button", { name: /^Client 3,/u }));
      expect(await screen.findByRole("heading", { name: "Client 3" })).toBeTruthy();
      expect(screen.queryByText("Draft with AI")).toBeNull();
      cleanup();
    }
  });

  it("names the room from the venue's rooms, read once, and says when it is not known", async () => {
    const calls = controlPages();
    render(<EnquiriesView />);
    await waitFor(() => { expect(calls).toHaveLength(1); });
    await settle(calls[0], page(serverList(25), { offset: 0, limit: 20 }));
    await waitFor(() => { expect(listedRows()[0]?.textContent).toContain("Grand Hall"); });

    fireEvent.click(screen.getByRole("button", { name: "Show 5 more" }));
    await waitFor(() => { expect(calls).toHaveLength(2); });
    await settle(calls[1], page(serverList(25), { offset: 15, limit: 25 }));
    expect(mocks.getVenue).toHaveBeenCalledTimes(1);
    expect(mocks.getVenue).toHaveBeenCalledWith("venue-1");

    cleanup();
    mocks.getVenue.mockRejectedValue(new Error("Unavailable"));
    mocks.listEnquiryPage.mockResolvedValue(page([enquiry(3)], {}));
    render(<EnquiriesView />);
    fireEvent.click(await screen.findByRole("button", { name: /^Client 3,/u }));
    expect(await screen.findByText("Not known")).toBeDefined();
  });

  it("pictures the requested room only with the venue's own photographs", async () => {
    mocks.listEnquiryPage.mockResolvedValue(page([enquiry(3)], {}));
    render(<EnquiriesView />);
    fireEvent.click(await screen.findByRole("button", { name: /^Client 3,/u }));
    await waitFor(() => { expect(document.querySelector(".enq-room-photo img")).not.toBeNull(); });
    const photo = document.querySelector(".enq-room-photo img");
    expect(photo?.getAttribute("src")).toBe("/images/venue/ladder/grand-hall-room-768.webp");
    expect(photo?.getAttribute("srcset")).toContain("grand-hall-room-1535.webp 1535w");
    expect(photo?.getAttribute("alt")).toBe("");

    cleanup();
    // Another venue's Grand Hall is not Trades Hall's.
    mocks.getVenue.mockResolvedValue(venue("another-venue"));
    render(<EnquiriesView />);
    fireEvent.click(await screen.findByRole("button", { name: /^Client 3,/u }));
    expect(await screen.findByText("Grand Hall")).toBeDefined();
    expect(document.querySelector(".enq-room-photo")).toBeNull();
  });
});

describe("EnquiriesView keyboard triage", () => {
  it("moves through the list with the arrow keys, j and k, Home and End", async () => {
    mocks.listEnquiryPage.mockResolvedValue(page(serverList(4), {}));
    render(<EnquiriesView />);
    await screen.findByRole("button", { name: /^Client 4,/u });

    const rows = listedRows();
    // Only one row is in the tab order; the keys move between the rest.
    expect(rows.filter((item) => item.tabIndex === 0)).toHaveLength(1);
    const [first, second, third, fourth] = rows;
    if (first === undefined || second === undefined || third === undefined || fourth === undefined) throw new Error("Expected four rows");
    first.focus();
    fireEvent.keyDown(first, { key: "ArrowDown" });
    expect(activeElement()).toBe(second);
    fireEvent.keyDown(second, { key: "j" });
    expect(activeElement()).toBe(third);
    fireEvent.keyDown(third, { key: "k" });
    expect(activeElement()).toBe(second);
    fireEvent.keyDown(second, { key: "End" });
    expect(activeElement()).toBe(fourth);
    fireEvent.keyDown(fourth, { key: "Home" });
    expect(activeElement()).toBe(first);
    expect(second.tabIndex).toBe(-1);
    expect(first.tabIndex).toBe(0);
  });

  it("keeps the list beside the open enquiry on a wide screen, steps with j and closes to its row", async () => {
    wideDesk();
    mocks.listEnquiryPage.mockResolvedValue(page(serverList(3), {}));
    render(<EnquiriesView />);

    fireEvent.click(await screen.findByRole("button", { name: /^Client 3,/u }));
    const opened = screen.getByRole("heading", { name: "Client 3", level: 2 });
    expect(activeElement()).toBe(opened);
    expect(screen.getByRole("heading", { name: "Enquiries", level: 1 })).toBeDefined();
    expect(row("Client 3").getAttribute("aria-current")).toBe("true");
    expect(screen.getByRole("button", { name: "Previous" }).hasAttribute("disabled")).toBe(true);

    fireEvent.keyDown(opened, { key: "j" });
    const next = screen.getByRole("heading", { name: "Client 2", level: 2 });
    expect(activeElement()).toBe(next);
    expect(row("Client 2").getAttribute("aria-current")).toBe("true");

    fireEvent.keyDown(next, { key: "Escape" });
    expect(screen.queryByRole("heading", { name: "Client 2", level: 2 })).toBeNull();
    expect(activeElement()).toBe(row("Client 2"));
    expect(screen.getByRole("complementary", { name: "Desk overview" })).toBeDefined();
  });

  it("steps on from where a moved enquiry was once it has left the filter", async () => {
    wideDesk();
    const calls = controlPages();
    mocks.transitionEnquiry.mockResolvedValue({ ...enquiry(3), state: "under_review" });
    render(<EnquiriesView />);
    await waitFor(() => { expect(calls).toHaveLength(1); });
    fireEvent.click(stage("New"));
    await waitFor(() => { expect(calls).toHaveLength(2); });
    await settle(calls[1], page(serverList(3), {}));

    fireEvent.click(row("Client 3"));
    fireEvent.click(screen.getByRole("button", { name: "Start review" }));
    expect(await screen.findByRole("button", { name: "Approve…" })).toBeDefined();
    expect(cardNames()).toEqual(["Client 2", "Client 1"]);

    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    expect(screen.getByRole("heading", { name: "Client 2", level: 2 })).toBeDefined();
  });

  it("offers the longest-waiting enquiry as the next move, and rests when nothing waits", async () => {
    wideDesk();
    const oldest = { ...enquiry(1), createdAt: "2026-09-18T07:55:00.000Z" };
    mocks.countEnquiryStages.mockResolvedValue(stageCounts({ submitted: 3 }, oldest));
    mocks.listEnquiryPage.mockResolvedValue(page(serverList(3), {}));
    render(<EnquiriesView />);

    const overview = await screen.findByRole("complementary", { name: "Desk overview" });
    expect(await within(overview).findByRole("heading", { name: "Client 1" })).toBeDefined();
    expect(within(overview).getByText("Next up · arrived 6 days ago")).toBeDefined();
    expect(within(overview).getByText("2 new enquiries after this one.")).toBeDefined();
    fireEvent.click(within(overview).getByRole("button", { name: "Open the longest-waiting enquiry" }));
    expect(screen.getByRole("heading", { name: "Client 1", level: 2 })).toBeDefined();
    expect(row("Client 1").getAttribute("aria-current")).toBe("true");

    cleanup();
    mocks.countEnquiryStages.mockResolvedValue(stageCounts({ approved: 3 }));
    render(<EnquiriesView />);
    expect(await screen.findByRole("heading", { name: "All caught up" })).toBeDefined();
  });
});
