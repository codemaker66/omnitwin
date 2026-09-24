import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Enquiry, EnquiryListQuery, EnquiryPage } from "../../../api/enquiries.js";
import { EnquiriesView } from "../EnquiriesView.js";

// ---------------------------------------------------------------------------
// The staff Enquiries list: newest first, paged with an honest count, and
// immune to responses that arrive for a list the reader has already left.
// ---------------------------------------------------------------------------

const { mocks } = vi.hoisted(() => ({
  mocks: {
    addToast: vi.fn(),
    createOpportunityFromEnquiry: vi.fn(),
    getEnquiry: vi.fn(),
    getEnquiryHistory: vi.fn(),
    listEnquiryPage: vi.fn(),
    transitionEnquiry: vi.fn(),
  },
}));

vi.mock("../../../api/enquiries.js", () => ({
  getEnquiry: mocks.getEnquiry,
  getEnquiryHistory: mocks.getEnquiryHistory,
  listEnquiryPage: mocks.listEnquiryPage,
  transitionEnquiry: mocks.transitionEnquiry,
}));

vi.mock("../../../api/crm.js", () => ({
  createOpportunityFromEnquiry: mocks.createOpportunityFromEnquiry,
}));

vi.mock("../../../stores/toast-store.js", () => ({
  useToastStore: (
    selector: (state: { readonly addToast: typeof mocks.addToast }) => unknown,
  ): unknown => selector({ addToast: mocks.addToast }),
}));

vi.mock("../../ai/AIDraftPanel.js", () => ({
  AIDraftPanel: () => <div>AI draft</div>,
}));

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

function cardNames(): string[] {
  return screen.queryAllByRole("button", { name: /^Client \d+/u })
    .map((card) => /^Client \d+/u.exec(card.textContent ?? "")?.[0] ?? "");
}

const names = (rows: readonly Enquiry[]): string[] => rows.map((row) => row.name);
const countNote = (): string => screen.getByTestId("enquiry-list-count").textContent ?? "";

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getEnquiryHistory.mockResolvedValue([]);
});

afterEach(() => {
  cleanup();
});

describe("EnquiriesView newest-first paging", () => {
  it("asks for the newest enquiries one page at a time and says how many exist", async () => {
    const calls = controlPages();
    const server = serverList(57);
    render(<EnquiriesView />);

    await waitFor(() => { expect(calls).toHaveLength(1); });
    expect(calls[0]?.query).toEqual({ order: "created_desc", offset: 0, limit: 20 });
    expect(screen.getByRole("status").textContent).toContain("Loading enquiries…");

    await settle(calls[0], page(server, { offset: 0, limit: 20 }));
    expect(cardNames()).toEqual(names(server.slice(0, 20)));
    expect(countNote()).toBe("Showing 20 of 57 enquiries, newest first");
    expect(screen.queryByRole("status")).toBeNull();
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

  it("keeps the status filter newest first and starts its paging afresh", async () => {
    const calls = controlPages();
    const all = serverList(57);
    render(<EnquiriesView />);
    await waitFor(() => { expect(calls).toHaveLength(1); });
    await settle(calls[0], page(all, { offset: 0, limit: 20 }));
    fireEvent.click(screen.getByRole("button", { name: "Show 20 more" }));
    await waitFor(() => { expect(calls).toHaveLength(2); });
    await settle(calls[1], page(all, { offset: 15, limit: 25 }));

    fireEvent.click(screen.getByRole("button", { name: "Under Review" }));
    await waitFor(() => { expect(calls).toHaveLength(3); });
    expect(calls[2]?.query).toEqual({ status: "under_review", order: "created_desc", offset: 0, limit: 20 });
    // The previous filter's rows and count are not presented as this filter's.
    expect(cardNames()).toEqual([]);
    expect(countNote()).toBe("");

    const reviewing = serverList(23, "under_review");
    await settle(calls[2], page(reviewing, { offset: 0, limit: 20 }));
    expect(cardNames()).toEqual(names(reviewing.slice(0, 20)));
    expect(countNote()).toBe("Showing 20 of 23 enquiries under review, newest first");
    fireEvent.click(screen.getByRole("button", { name: "Show 3 more" }));
    await waitFor(() => { expect(calls).toHaveLength(4); });
    expect(calls[3]?.query).toEqual({ status: "under_review", order: "created_desc", offset: 15, limit: 25 });
  });

  it("discards a slow first page that resolves after the filter changed", async () => {
    const calls = controlPages();
    render(<EnquiriesView />);
    await waitFor(() => { expect(calls).toHaveLength(1); });

    fireEvent.click(screen.getByRole("button", { name: "Submitted" }));
    await waitFor(() => { expect(calls).toHaveLength(2); });
    expect(calls[0]?.signal.aborted).toBe(true);

    await settle(calls[1], page([enquiry(3)], { offset: 0, limit: 20 }));
    await settle(calls[0], page(serverList(57, "approved"), { offset: 0, limit: 20 }));

    expect(cardNames()).toEqual(["Client 3"]);
    expect(countNote()).toBe("Showing 1 submitted enquiry, newest first");
  });

  it("never appends a show-more that resolves after the filter changed", async () => {
    const calls = controlPages();
    const all = serverList(57);
    render(<EnquiriesView />);
    await waitFor(() => { expect(calls).toHaveLength(1); });
    await settle(calls[0], page(all, { offset: 0, limit: 20 }));
    fireEvent.click(screen.getByRole("button", { name: "Show 20 more" }));
    await waitFor(() => { expect(calls).toHaveLength(2); });

    fireEvent.click(screen.getByRole("button", { name: "Submitted" }));
    await waitFor(() => { expect(calls).toHaveLength(3); });
    expect(calls[1]?.signal.aborted).toBe(true);
    const submitted = serverList(2);
    await settle(calls[2], page(submitted, { offset: 0, limit: 20 }));
    // The stale page resolves anyway (a transport may ignore the abort).
    await settle(calls[1], page(all, { offset: 15, limit: 25 }));

    expect(cardNames()).toEqual(names(submitted));
    expect(countNote()).toBe("Showing all 2 submitted enquiries, newest first");
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
    expect(screen.getByRole("status").textContent)
      .toBe("Enquiries changed while this list was open, so it may be incomplete or out of date.");

    fireEvent.click(screen.getByRole("button", { name: "Reload list" }));
    await waitFor(() => { expect(calls).toHaveLength(3); });
    expect(calls[2]?.query).toEqual({ order: "created_desc", offset: 0, limit: 20 });
    // The rows stay usable while the same filter reloads.
    expect(cardNames()).toHaveLength(45);
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
    expect(screen.queryByText("No enquiries found.")).toBeNull();
    expect(screen.queryByRole("status")).toBeNull();

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

  it("drops an enquiry that leaves the status filter and keeps later pages aligned", async () => {
    const calls = controlPages();
    const submitted = serverList(31);
    const reviewed = { ...enquiry(29), state: "under_review" };
    mocks.transitionEnquiry.mockResolvedValue(reviewed);
    render(<EnquiriesView />);
    await waitFor(() => { expect(calls).toHaveLength(1); });
    fireEvent.click(screen.getByRole("button", { name: "Submitted" }));
    await waitFor(() => { expect(calls).toHaveLength(2); });
    await settle(calls[1], page(submitted, { offset: 0, limit: 20 }));

    fireEvent.click(screen.getByRole("button", { name: /^Client 29/u }));
    fireEvent.click(screen.getByRole("button", { name: "Start Review" }));
    fireEvent.click(screen.getByRole("button", { name: "Under Review" }));
    // The detail view stays on the enquiry with its new status.
    expect(await screen.findByRole("button", { name: "Approve" })).toBeDefined();
    expect(screen.getByRole("heading", { name: "Client 29" })).toBeDefined();

    fireEvent.click(screen.getByRole("button", { name: "← Back to list" }));
    expect(cardNames()).not.toContain("Client 29");
    expect(cardNames()).toHaveLength(19);
    expect(countNote()).toBe("Showing 19 of 30 submitted enquiries, newest first");

    fireEvent.click(screen.getByRole("button", { name: "Show 11 more" }));
    await waitFor(() => { expect(calls).toHaveLength(3); });
    expect(calls[2]?.query).toEqual({ status: "submitted", order: "created_desc", offset: 14, limit: 25 });
    const remaining = submitted.filter((row) => row.id !== reviewed.id);
    await settle(calls[2], page(remaining, { offset: 14, limit: 25 }));
    expect(cardNames()).toEqual(names(remaining));
    expect(countNote()).toBe("Showing all 30 submitted enquiries, newest first");
    expect(screen.queryByText(/changed while this list was open/u)).toBeNull();
  });

  it("keeps an enquiry with its new status in the unfiltered list", async () => {
    const calls = controlPages();
    const reviewed = { ...enquiry(5), state: "under_review" };
    mocks.transitionEnquiry.mockResolvedValue(reviewed);
    render(<EnquiriesView />);
    await waitFor(() => { expect(calls).toHaveLength(1); });
    await settle(calls[0], page(serverList(6), { offset: 0, limit: 20 }));

    fireEvent.click(screen.getByRole("button", { name: /^Client 5/u }));
    fireEvent.click(screen.getByRole("button", { name: "Start Review" }));
    fireEvent.click(screen.getByRole("button", { name: "Under Review" }));
    expect(await screen.findByRole("button", { name: "Approve" })).toBeDefined();
    fireEvent.click(screen.getByRole("button", { name: "← Back to list" }));

    expect(cardNames()).toEqual(names(serverList(6)));
    expect(screen.getByRole("button", { name: /^Client 5/u }).textContent).toContain("under review");
    expect(countNote()).toBe("Showing all 6 enquiries, newest first");
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
    expect(await screen.findByRole("heading", { name: "Client 2" })).toBeDefined();

    fireEvent.click(screen.getByRole("button", { name: "← Back to profile" }));
    expect(onDetailClose).toHaveBeenCalledTimes(1);
  });
});
