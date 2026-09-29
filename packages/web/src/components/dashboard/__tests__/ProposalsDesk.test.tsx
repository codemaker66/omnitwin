import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { StrictMode } from "react";
import { ApiError } from "../../../api/client.js";
import { ProposalsDesk } from "../ProposalsDesk.js";
import { forgetProposalMemory } from "../proposals/proposal-memory.js";

// ---------------------------------------------------------------------------
// The Proposals desk (roadmap X1): proposals grouped as a booker works them,
// one proposal in the forest panel with the one next step its status allows,
// the next version starting from the last one, and the conversation and
// history kept to the proposal they belong to. Every behaviour of the view it
// replaced is held here too: the address, paging, the claim guard, exact
// money, asking before withdrawing, capacity guidance.
// ---------------------------------------------------------------------------

const mocks = vi.hoisted(() => ({
  listProposalDesk: vi.fn(),
  getDeskProposal: vi.fn(),
  getLatestProposalVersion: vi.fn(),
  getProposalNextVersion: vi.fn(),
  getProposalHistory: vi.fn(),
  getProposalComments: vi.fn(),
  postProposalComment: vi.fn(),
  createProposal: vi.fn(),
  createProposalShareToken: vi.fn(),
  createProposalVersion: vi.fn(),
  createQuote: vi.fn(),
  deleteQuote: vi.fn(),
  transitionProposal: vi.fn(),
  listSpaces: vi.fn(),
}));

vi.mock("../../../api/proposals.js", async (importOriginal) => ({
  ...await importOriginal<typeof import("../../../api/proposals.js")>(),
  listProposalDesk: mocks.listProposalDesk,
  getDeskProposal: mocks.getDeskProposal,
  getLatestProposalVersion: mocks.getLatestProposalVersion,
  getProposalNextVersion: mocks.getProposalNextVersion,
  getProposalHistory: mocks.getProposalHistory,
  getProposalComments: mocks.getProposalComments,
  postProposalComment: mocks.postProposalComment,
  createProposal: mocks.createProposal,
  createProposalShareToken: mocks.createProposalShareToken,
  createProposalVersion: mocks.createProposalVersion,
  createQuote: mocks.createQuote,
  deleteQuote: mocks.deleteQuote,
  transitionProposal: mocks.transitionProposal,
}));
vi.mock("../../../api/spaces.js", () => ({ listSpaces: mocks.listSpaces }));

const authState = vi.hoisted(() => ({
  user: { id: "u1", role: "staff", platformRole: "none" as const, venueId: "v1" as string | null, email: "staff@test.com", name: "Catherine Tait" },
}));

vi.mock("../../../stores/auth-store.js", () => ({
  useAuthStore: Object.assign(
    (selector: (state: { user: typeof authState.user | null }) => unknown): unknown => selector({ user: authState.user }),
    { getState: (): { user: typeof authState.user | null } => ({ user: authState.user }) },
  ),
}));

/** 11:00 in Glasgow on Friday 2 October 2026. */
const NOW = "2026-10-02T10:00:00.000Z";

/** What the start line adds while its check cannot be made (here, by default,
 *  against an API from before the check). */
const UNCHECKED = " Whether the layout or the event's details have changed could not be checked.";

function proposal(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: "p1", venueId: "v1", opportunityId: null, enquiryId: null, configurationId: null, title: "Autumn gala", status: "draft",
    currentVersion: 0, shareCode: null, sentAt: null, createdBy: "u1", createdAt: "2026-09-20T09:00:00.000Z",
    updatedAt: "2026-09-30T09:00:00.000Z", deletedAt: null, dealTitle: null, clientName: "Elaine Crawford", eventDate: "2026-11-20",
    guestCount: 120, eventType: "wedding", latestTotalMinor: null, latestCurrency: null,
    ...overrides,
  };
}

function version(n: number, payload: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: `version-${String(n)}`, proposalId: "p1", version: n, sourceHash: "a".repeat(64), createdBy: "u1", createdAt: "2026-09-30T09:00:00.000Z",
    payload: {
      schemaVersion: "venviewer.proposal-version.v1", title: "Autumn gala", clientMessage: null, configurationId: null,
      layoutRevision: null, capacityNote: null, quote: null, ...payload,
    },
  };
}

function quoteSnapshot(lines: readonly { description: string; quantity: number; unitAmountMinor: number }[]): Record<string, unknown> {
  const items = lines.map((line) => ({ ...line, lineTotalMinor: line.quantity * line.unitAmountMinor }));
  const total = items.reduce((sum, item) => sum + item.lineTotalMinor, 0);
  return { quoteId: "33333333-3333-4333-8333-333333333333", currency: "GBP", lineItems: items, subtotalMinor: total, totalMinor: total };
}

function clientComment(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: "comment-client", kind: "comment", authorType: "client", authorName: "Elaine", body: "Could we review a later finish time?",
    isClientVisible: true, createdAt: "2026-09-30T12:00:00.000Z", ...overrides,
  };
}

function historyEntry(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: "history1", proposalId: "p1", fromStatus: "draft", toStatus: "sent", changedBy: "u1", note: "Shared with the client",
    createdAt: "2026-09-29T09:00:00.000Z", ...overrides,
  };
}

const GROUPS: Readonly<Record<string, readonly string[]>> = {
  waiting: ["changes_requested"], drafts: ["draft"], with_client: ["sent"], accepted: ["accepted"],
  closed: ["declined", "withdrawn", "expired", "archived"],
};

/** The proposals that exist; the mocked API pages and groups over them. */
let existing: Record<string, unknown>[] = [];

function counts(rows: readonly Record<string, unknown>[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const row of rows) out[String(row["status"])] = (out[String(row["status"])] ?? 0) + 1;
  return out;
}

function wideDesk(): void {
  vi.spyOn(window, "matchMedia").mockImplementation((query: string): MediaQueryList => ({
    matches: query === "(min-width: 1180px)" || query === "(pointer: fine)",
    media: query, onchange: null,
    addListener: () => undefined, removeListener: () => undefined,
    addEventListener: () => undefined, removeEventListener: () => undefined, dispatchEvent: () => false,
  }));
}

function row(id: string): HTMLElement {
  return screen.getByTestId(`proposal-row-${id}`);
}

async function openProposal(id = "p1", title = "Autumn gala"): Promise<HTMLElement> {
  fireEvent.click(await screen.findByTestId(`proposal-row-${id}`));
  const heading = await screen.findByRole("heading", { level: 2, name: title });
  const panel = heading.closest("section");
  if (panel === null) throw new Error("No panel");
  return panel;
}

/** Whether the page asks before a reload, as it does while words are unsaved. */
function reloadHeld(): boolean {
  const event = new Event("beforeunload", { cancelable: true });
  window.dispatchEvent(event);
  return event.defaultPrevented;
}

beforeEach(() => {
  for (const fn of Object.values(mocks)) fn.mockReset();
  // What the booker wrote lives for the page; each test is a fresh page.
  forgetProposalMemory();
  authState.user = { ...authState.user, id: "u1", name: "Catherine Tait", venueId: "v1" };
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(NOW);
  existing = [proposal()];
  mocks.listProposalDesk.mockImplementation((query: { readonly limit: number; readonly offset: number; readonly group?: string }) => {
    const group = query.group;
    const listed = group === undefined ? existing : existing.filter((row) => (GROUPS[group] ?? []).includes(String(row["status"])));
    return Promise.resolve({ rows: listed.slice(query.offset, query.offset + query.limit), total: listed.length, statusCounts: counts(existing) });
  });
  mocks.getDeskProposal.mockImplementation((id: string) => {
    const found = existing.find((row) => row["id"] === id);
    return found === undefined ? Promise.reject(new ApiError(404, "Proposal not found", "NOT_FOUND")) : Promise.resolve(found);
  });
  mocks.getLatestProposalVersion.mockImplementation((id: string) => {
    const found = existing.find((row) => row["id"] === id);
    return Promise.resolve(version(Number(found?.["currentVersion"] ?? 1)));
  });
  // As an API from before the check: the composer says what is typed, and
  // that the rest could not be checked.
  mocks.getProposalNextVersion.mockRejectedValue(new ApiError(404, "Not found", "NOT_FOUND"));
  mocks.getProposalHistory.mockResolvedValue([]);
  mocks.getProposalComments.mockResolvedValue([]);
  mocks.listSpaces.mockResolvedValue([]);
  mocks.postProposalComment.mockResolvedValue(clientComment({ id: "comment-staff", authorType: "staff", authorName: "Venue team" }));
  wideDesk();
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

// ---------------------------------------------------------------------------

describe("a proposal named by the address (the Clients desk and the pipeline open one here)", () => {
  it("opens it once it is read, even under React's development double run, and says which is open", async () => {
    existing = [proposal(), proposal({ id: "p2", title: "Winter dinner" })];
    const shown = vi.fn();
    render(<StrictMode><ProposalsDesk proposalId="p2" onProposalShown={shown} /></StrictMode>);

    expect(await screen.findByRole("heading", { level: 2, name: "Winter dinner" })).toBeDefined();
    expect(mocks.getDeskProposal).toHaveBeenCalledWith("p2");
    await waitFor(() => { expect(shown).toHaveBeenLastCalledWith("p2"); });
    expect(row("p2").getAttribute("aria-current")).toBe("true");
    fireEvent.click(row("p1"));
    await waitFor(() => { expect(shown).toHaveBeenLastCalledWith("p1"); });
  });

  it("says plainly when the proposal is not there, and offers another try when it could not be read", async () => {
    render(<ProposalsDesk proposalId="p9" />);
    expect((await screen.findByTestId("proposal-link-failure")).textContent).toBe("This proposal is not here any more. It may have been removed.");

    cleanup();
    mocks.getDeskProposal.mockRejectedValueOnce(new Error("offline"));
    render(<ProposalsDesk proposalId="p1" />);
    expect((await screen.findByTestId("proposal-link-failure")).textContent).toBe("The proposal could not be opened.");
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(await screen.findByRole("heading", { level: 2, name: "Autumn gala" })).toBeDefined();
  });
});

describe("the ledger", () => {
  it("groups proposals as a booker works them, each with who, when and what it comes to", async () => {
    existing = [
      proposal({ id: "p1", title: "Sent ball", status: "sent", currentVersion: 2, sentAt: "2026-09-29T10:00:00.000Z", latestTotalMinor: 1_840_000, latestCurrency: "GBP" }),
      proposal({ id: "p2", title: "Draft lunch", status: "draft", currentVersion: 1, clientName: null, eventDate: null }),
      proposal({ id: "p3", title: "Changes dinner", status: "changes_requested", currentVersion: 1, updatedAt: "2026-10-01T09:00:00.000Z" }),
      proposal({ id: "p4", title: "Accepted wedding", status: "accepted", currentVersion: 3 }),
      proposal({ id: "p5", title: "Declined party", status: "declined", currentVersion: 1 }),
    ];
    render(<ProposalsDesk />);
    await screen.findByTestId("proposal-row-p1");
    expect(mocks.listProposalDesk).toHaveBeenCalledWith({ limit: 50, offset: 0 });
    expect([...document.querySelectorAll(".enq-group")].map((heading) => heading.firstChild?.textContent))
      .toEqual(["Waiting on you", "Drafts", "With the client", "Accepted", "Closed"]);
    expect(row("p1").getAttribute("aria-label"))
      .toBe("Sent ball, With the client, event Friday 20 November 2026, Elaine Crawford, Wedding, 120 guests, £18,400, sent 3 days ago, not opened yet");
    expect(row("p3").getAttribute("aria-label")).toContain("Changes asked for, event Friday 20 November 2026");
    expect(row("p3").getAttribute("aria-label")).toContain("version 1, changed yesterday");
    expect(row("p2").getAttribute("aria-label")).toBe("Draft lunch, Draft, no event date, Wedding, 120 guests, version 1, changed 2 days ago");
  });

  it("says what is waiting on the booker and what is with clients, from the whole list's counts", async () => {
    existing = [
      proposal({ id: "p1", status: "changes_requested", currentVersion: 1 }), proposal({ id: "p2", status: "changes_requested", currentVersion: 1 }),
      proposal({ id: "p3", status: "draft" }), proposal({ id: "p4", status: "sent", currentVersion: 1 }),
    ];
    render(<ProposalsDesk />);
    expect((await screen.findByTestId("proposals-summary")).textContent)
      .toBe("2 clients asked for changes, and 1 draft is yours to finish. 1 proposal is with a client.");
  });

  it("shows one group from the plane, each count taken over the whole list", async () => {
    existing = [proposal({ id: "p1", status: "sent", currentVersion: 1 }), proposal({ id: "p2", status: "sent", currentVersion: 1 }), proposal({ id: "p3" })];
    render(<ProposalsDesk />);
    await screen.findByTestId("proposal-row-p3");
    fireEvent.click(screen.getByRole("button", { name: "With the client, 2" }));
    await waitFor(() => { expect(mocks.listProposalDesk).toHaveBeenLastCalledWith({ limit: 50, offset: 0, group: "with_client" }); });
    await waitFor(() => { expect(screen.queryByTestId("proposal-row-p3")).toBeNull(); });
    expect(screen.getByRole("button", { name: "Drafts, 1" })).toBeDefined();
    expect(screen.getByRole("button", { name: "All, 3" })).toBeDefined();
  });

  it("says when there are none, and keeps a failed read retryable rather than a dead panel", async () => {
    existing = [];
    render(<ProposalsDesk />);
    expect(await screen.findByText("No proposals yet")).toBeDefined();

    cleanup();
    existing = [proposal()];
    mocks.listProposalDesk.mockRejectedValueOnce(new Error("offline"));
    render(<ProposalsDesk />);
    expect((await screen.findByTestId("proposal-list-error")).textContent).toContain("The proposals could not be read.");
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(await screen.findByTestId("proposal-row-p1")).toBeDefined();
  });
});

describe("paging", () => {
  function many(count: number): Record<string, unknown>[] {
    return Array.from({ length: count }, (_unused, index) => proposal({ id: `p${String(index + 1)}`, title: `Proposal ${String(index + 1)}` }));
  }

  it("says how many it shows of how many, and fetches the rest", async () => {
    existing = many(60);
    render(<ProposalsDesk />);
    await screen.findByTestId("proposal-row-p50");
    expect(screen.queryByTestId("proposal-row-p51")).toBeNull();
    expect(screen.getByTestId("proposals-more").textContent).toContain("Showing 50 of 60.");
    fireEvent.click(screen.getByRole("button", { name: "Show more (10 more)" }));
    expect(await screen.findByTestId("proposal-row-p60")).toBeDefined();
    expect(mocks.listProposalDesk).toHaveBeenLastCalledWith({ limit: 50, offset: 50 });
    expect(screen.queryByTestId("proposals-more")).toBeNull();
  });

  it("keeps what it shows when the next page fails, and says so", async () => {
    existing = many(55);
    render(<ProposalsDesk />);
    await screen.findByTestId("proposal-row-p50");
    mocks.listProposalDesk.mockRejectedValueOnce(new Error("offline"));
    fireEvent.click(screen.getByRole("button", { name: "Show more (5 more)" }));
    expect((await screen.findByRole("alert")).textContent).toBe("The next proposals could not be read. Those shown are as they were.");
    expect(screen.getByTestId("proposal-row-p50")).toBeDefined();
    expect(screen.getByRole("button", { name: "Show more (5 more)" })).toBeDefined();
  });

  it("does not offer the next page while the list is read again, and lets that read drop a page still on its way", async () => {
    existing = many(55).map((row, index) => index === 0 ? { ...row, status: "sent", currentVersion: 1 } : row);
    mocks.transitionProposal.mockImplementation(() => {
      existing = existing.map((row, index) => index === 0 ? { ...row, status: "withdrawn" } : row);
      return Promise.resolve(existing[0]);
    });
    render(<ProposalsDesk />);
    const panel = within(await openProposal("p1", "Proposal 1"));
    let releasePage: (page: unknown) => void = () => undefined;
    const nextPage = new Promise((resolve) => { releasePage = resolve; });
    mocks.listProposalDesk.mockImplementationOnce(() => nextPage);
    fireEvent.click(screen.getByRole("button", { name: "Show more (5 more)" }));
    expect(screen.getByRole("button", { name: "Reading more…" })).toBeDefined();

    let releaseList: (page: unknown) => void = () => undefined;
    const reread = new Promise((resolve) => { releaseList = resolve; });
    mocks.listProposalDesk.mockImplementationOnce(() => reread);
    fireEvent.click(panel.getByTestId("withdraw-button"));
    fireEvent.click(panel.getByTestId("withdraw-confirm-button"));
    await waitFor(() => { expect(mocks.transitionProposal).toHaveBeenCalledWith("p1", "withdrawn"); });
    await screen.findByText("Reading the proposals again…");
    expect(screen.getByRole<HTMLButtonElement>("button", { name: "Show more (5 more)" }).disabled).toBe(true);

    await act(async () => {
      releaseList({ rows: existing.slice(0, 50), total: 55, statusCounts: counts(existing) });
      await reread;
    });
    expect(screen.queryByText("Reading the proposals again…")).toBeNull();
    expect(screen.getByRole<HTMLButtonElement>("button", { name: "Show more (5 more)" }).disabled).toBe(false);
    // The dropped page, landing late, changes nothing.
    await act(async () => { releasePage({ rows: existing.slice(50), total: 55, statusCounts: counts(existing) }); await nextPage; });
    expect(screen.queryByTestId("proposal-row-p51")).toBeNull();
  });
});

describe("the open proposal", () => {
  it.each(["resolve", "reject"] as const)("keeps another proposal's conversation and history out when an older read %ss late", async (settlement) => {
    existing = [proposal(), proposal({ id: "p2", title: "Winter dinner" })];
    let resolveOld: ((value: unknown[]) => void) | undefined;
    let rejectOld: ((reason: Error) => void) | undefined;
    const oldResponse = new Promise<unknown[]>((resolve, reject) => { resolveOld = resolve; rejectOld = reject; });
    mocks.getProposalComments.mockImplementation((id: string) => id === "p1" ? oldResponse : Promise.resolve([clientComment({ id: "b", body: "The second client's words" })]));
    mocks.getProposalHistory.mockImplementation((id: string) => id === "p1" ? oldResponse : Promise.resolve([historyEntry({ id: "b-history", note: "Second proposal history" })]));
    render(<ProposalsDesk />);
    await openProposal("p1");
    await openProposal("p2", "Winter dinner");
    await screen.findByText("The second client's words");
    await act(async () => {
      if (settlement === "resolve") resolveOld?.([clientComment({ body: "The first client's words" })]);
      else rejectOld?.(new Error("old failed"));
      await oldResponse.catch(() => undefined);
    });
    expect(screen.getByText("The second client's words")).toBeDefined();
    expect(screen.getByText("Second proposal history")).toBeDefined();
    expect(screen.queryByText("The first client's words")).toBeNull();
    expect(screen.queryByTestId("conversation-load-error")).toBeNull();
    expect(screen.queryByTestId("history-load-error")).toBeNull();
  });

  it("clears the last proposal's conversation and history at once when another opens", async () => {
    existing = [proposal(), proposal({ id: "p2", title: "Winter dinner" })];
    mocks.getProposalComments.mockResolvedValueOnce([clientComment()]).mockReturnValueOnce(new Promise(() => undefined));
    mocks.getProposalHistory.mockResolvedValueOnce([historyEntry()]).mockReturnValueOnce(new Promise(() => undefined));
    render(<ProposalsDesk />);
    await openProposal("p1");
    await screen.findByText("Could we review a later finish time?");
    await openProposal("p2", "Winter dinner");
    expect(screen.queryByText("Could we review a later finish time?")).toBeNull();
    expect(screen.queryByText("Shared with the client")).toBeNull();
  });

  it("does not reopen a proposal when its quiet re-read answers after another was opened", async () => {
    existing = [proposal({ status: "sent", currentVersion: 1 }), proposal({ id: "p2", title: "Winter dinner" })];
    let release: ((value: unknown) => void) | undefined;
    const reread = new Promise<unknown>((resolve) => { release = resolve; });
    mocks.transitionProposal.mockResolvedValue(proposal({ status: "withdrawn", currentVersion: 1 }));
    render(<ProposalsDesk />);
    const panel = within(await openProposal("p1"));
    mocks.getDeskProposal.mockImplementationOnce(() => reread);
    fireEvent.click(panel.getByTestId("withdraw-button"));
    fireEvent.click(panel.getByTestId("withdraw-confirm-button"));
    await waitFor(() => { expect(mocks.getDeskProposal).toHaveBeenLastCalledWith("p1"); });
    await openProposal("p2", "Winter dinner");
    await act(async () => { release?.(proposal({ status: "withdrawn" })); await reread; });
    expect(screen.getByRole("heading", { level: 2, name: "Winter dinner" })).toBeDefined();
    expect(screen.queryByText("Refreshing the proposal…")).toBeNull();
  });

  it("gives its facts, the deal it is for, and its latest quote", async () => {
    existing = [proposal({
      opportunityId: "o1", dealTitle: "Crawford gala", status: "sent", currentVersion: 2, sentAt: "2026-09-29T10:00:00.000Z",
      latestTotalMinor: 1_840_050, latestCurrency: "GBP",
    })];
    mocks.getLatestProposalVersion.mockResolvedValue(version(2, {
      quote: quoteSnapshot([{ description: "Grand Hall hire", quantity: 1, unitAmountMinor: 400_050 }, { description: "Dinner", quantity: 120, unitAmountMinor: 12_000 }]),
    }));
    const openDeal = vi.fn();
    render(<ProposalsDesk onOpenDeal={openDeal} />);
    const panel = within(await openProposal());
    expect(panel.getByText("Proposal · Crawford gala")).toBeDefined();
    expect(panel.getByText("£18,400.50", { selector: "dd" })).toBeDefined();
    expect(panel.getByText("Elaine Crawford", { selector: "dd" })).toBeDefined();
    expect((await panel.findByTestId("latest-quote-total")).textContent).toBe("£18,400.50");
    expect(panel.getByRole("heading", { name: "Version 2's quote" })).toBeDefined();
    fireEvent.click(panel.getByRole("button", { name: "Open the deal in the pipeline" }));
    expect(openDeal).toHaveBeenCalledWith("o1");
  });

  it("closes with Escape and returns the reader to the proposal's row, and steps with j and k", async () => {
    existing = [proposal(), proposal({ id: "p2", title: "Winter dinner", updatedAt: "2026-09-29T09:00:00.000Z" })];
    render(<ProposalsDesk />);
    await openProposal("p1");
    const heading = screen.getByRole("heading", { level: 2, name: "Autumn gala" });
    await waitFor(() => { expect(document.activeElement).toBe(heading); });
    fireEvent.keyDown(heading, { key: "j" });
    expect(await screen.findByRole("heading", { level: 2, name: "Winter dinner" })).toBeDefined();
    fireEvent.keyDown(screen.getByRole("heading", { level: 2, name: "Winter dinner" }), { key: "Escape" });
    await waitFor(() => { expect(screen.queryByRole("heading", { level: 2, name: "Winter dinner" })).toBeNull(); });
    await waitFor(() => { expect(document.activeElement).toBe(row("p2")); });
  });
});

describe("the next step", () => {
  it("offers no link before there is a version, and says to write one", async () => {
    render(<ProposalsDesk />);
    const panel = within(await openProposal());
    expect(panel.queryByTestId("send-open")).toBeNull();
    expect(panel.getByText("Write the first version below, then send it.")).toBeDefined();
  });

  it("asks before a draft's first link, saying it marks the proposal sent, then shows the link", async () => {
    existing = [proposal({ currentVersion: 1 })];
    mocks.createProposalShareToken.mockImplementation(() => {
      existing = [proposal({ currentVersion: 1, status: "sent", sentAt: NOW })];
      return Promise.resolve({ token: "client-token", shareUrl: "/proposal-share/client-token", tokenPrefix: "client-t", proposal: existing[0] });
    });
    render(<ProposalsDesk />);
    const panel = within(await openProposal());
    fireEvent.click(panel.getByRole("button", { name: "Send to the client…" }));
    expect(panel.getByText("Send version 1 to Elaine Crawford?")).toBeDefined();
    expect(panel.getByTestId("send-consequence").textContent).toBe("Making the link marks the proposal Sent. Nothing is emailed; you send the link.");
    expect(mocks.createProposalShareToken).not.toHaveBeenCalled();
    fireEvent.click(panel.getByRole("button", { name: "Make the link" }));
    // The version the booker was asked about is the one sent.
    await waitFor(() => { expect(mocks.createProposalShareToken).toHaveBeenCalledWith("p1", 1); });
    // Shown to copy, never as a link a booker might follow and so seem to open.
    const link = await panel.findByTestId("share-link");
    expect(link.textContent).toBe(`${window.location.origin}/proposal-share/client-token`);
    expect(link.closest("a")).toBeNull();
    expect(panel.getByTestId("share-link-note").textContent).toBe("Not emailed. Copy it into your message to the client.");
    await waitFor(() => { expect(panel.getByText("With the client", { selector: ".enq-chip" })).toBeDefined(); });
  });

  it("keeps words not yet saved when a send takes the composer away, says both apart, and gives focus to copying the link", async () => {
    existing = [proposal({ currentVersion: 1 })];
    mocks.createProposalShareToken.mockImplementation(() => {
      existing = [proposal({ currentVersion: 1, status: "sent", sentAt: NOW })];
      return Promise.resolve({ token: "client-token", shareUrl: "/proposal-share/client-token", tokenPrefix: "client-t", proposal: existing[0] });
    });
    render(<ProposalsDesk />);
    const panel = within(await openProposal());
    fireEvent.change(await panel.findByTestId("composer-message"), { target: { value: "A later finish, as asked." } });
    fireEvent.click(panel.getByRole("button", { name: "Send to the client…" }));
    const send = panel.getByRole("button", { name: "Make the link" });
    send.focus();
    fireEvent.click(send);
    const kept = within(await panel.findByTestId("kept-version"));
    expect(kept.getByRole("heading", { name: "What you were writing" })).toBeDefined();
    expect(kept.getByTestId("kept-version-why").textContent).toBe("It is with the client now, so a new version cannot be written.");
    expect(kept.getByText("A later finish, as asked.")).toBeDefined();
    // The send says itself; the words are said apart, without the reason the send just gave.
    expect(screen.getByText("The client's link is made. Copy it into your message to them.")).toBeDefined();
    expect(panel.getByTestId("kept-note").textContent).toBe("What you wrote is kept here to copy.");
    await waitFor(() => { expect(document.activeElement).toBe(panel.getByRole("button", { name: "Copy the link" })); });
  });

  it("says a withdrawal once, and keeps words not yet saved", async () => {
    existing = [proposal({ status: "changes_requested", currentVersion: 1, sentVersion: 1, sentAt: NOW })];
    mocks.transitionProposal.mockImplementation(() => {
      existing = [proposal({ status: "withdrawn", currentVersion: 1, sentVersion: 1, sentAt: NOW })];
      return Promise.resolve(existing[0]);
    });
    render(<ProposalsDesk />);
    const panel = within(await openProposal());
    fireEvent.change(await panel.findByTestId("composer-message"), { target: { value: "A later finish, as asked." } });
    fireEvent.click(panel.getByTestId("withdraw-button"));
    fireEvent.click(panel.getByTestId("withdraw-confirm-button"));
    const kept = within(await panel.findByTestId("kept-version"));
    expect(kept.getByTestId("kept-version-why").textContent).toBe("It has been withdrawn, so a new version cannot be written.");
    expect(screen.getByText("The proposal is withdrawn.")).toBeDefined();
    expect(panel.getByTestId("kept-note").textContent).toBe("What you wrote is kept here to copy.");
  });

  it("gives a sent proposal a new link, saying the one the client has keeps working", async () => {
    existing = [proposal({ status: "sent", currentVersion: 2, sentVersion: 2, sentAt: NOW })];
    mocks.createProposalShareToken.mockResolvedValue({
      token: "fresh-token", shareUrl: "/proposal-share/fresh-token", tokenPrefix: "fresh-to", proposal: existing[0],
    });
    render(<ProposalsDesk />);
    const panel = within(await openProposal());
    // It says why no link is on screen rather than simply showing none.
    expect(panel.getByTestId("share-link-unavailable")).toBeDefined();
    fireEvent.click(panel.getByRole("button", { name: "Issue a new link…" }));
    expect(panel.getByTestId("send-consequence").textContent).toContain("Links the client already has keep working.");
    fireEvent.click(panel.getByRole("button", { name: "Issue the link" }));
    expect((await panel.findByTestId("share-link")).textContent).toContain("/proposal-share/fresh-token");
    expect(mocks.createProposalShareToken).toHaveBeenCalledWith("p1", 2);
  });

  it("says a new link sends a version saved since, and shows the row the send answers with before the desk reads it again", async () => {
    // A platform administrator saved version 3 while version 2 was out.
    existing = [proposal({ status: "sent", currentVersion: 3, sentVersion: 2, sentAt: NOW, linkOpenedAt: "2026-10-05T13:10:00.000Z" })];
    // The API answers with the proposal as its desk row now reads.
    mocks.createProposalShareToken.mockResolvedValue({
      token: "fresh-token", shareUrl: "/proposal-share/fresh-token", tokenPrefix: "fresh-to",
      proposal: proposal({ status: "sent", currentVersion: 3, sentVersion: 3, sentAt: NOW, lastSentAt: NOW, linkOpenedAt: null }),
    });
    render(<ProposalsDesk />);
    const panel = within(await openProposal());
    expect(panel.getByTestId("link-opened").textContent).toBe("The link was last opened Mon 5 Oct, 14:10.");
    fireEvent.click(panel.getByRole("button", { name: "Issue a new link…" }));
    expect(panel.getByText("Send version 3 in a new link?")).toBeDefined();
    expect(panel.getByTestId("send-consequence").textContent)
      .toBe("Links the client already has will show version 3 too. Nothing is emailed; you send the link.");
    // The quiet read after the send never arrives: the panel still says what
    // the send established.
    mocks.getDeskProposal.mockImplementation(() => new Promise(() => undefined));
    fireEvent.click(panel.getByRole("button", { name: "Issue the link" }));
    expect((await panel.findByTestId("share-link")).textContent).toContain("/proposal-share/fresh-token");
    expect(mocks.createProposalShareToken).toHaveBeenCalledWith("p1", 3);
    expect(panel.getByTestId("link-opened").textContent).not.toContain("last opened");
    expect(panel.queryByText(/the client's link shows version 2/u)).toBeNull();
  });

  it("says whether the link has been opened since it was sent, and offers the client's view in a tab of its own", async () => {
    existing = [proposal({ status: "sent", currentVersion: 2, sentVersion: 2, sentAt: NOW, linkOpenedAt: "2026-10-05T13:10:00.000Z" })];
    render(<ProposalsDesk />);
    const panel = within(await openProposal());
    expect(panel.getByTestId("link-opened").textContent).toBe("The link was last opened Mon 5 Oct, 14:10.");
    const preview = panel.getByTestId("preview-link");
    expect(preview.getAttribute("href")).toBe("/proposal-preview/p1");
    expect(preview.getAttribute("target")).toBe("_blank");
    expect(preview.getAttribute("rel")).toContain("noopener");
    expect(preview.textContent).toContain("Preview as the client");
    cleanup();

    existing = [proposal({ status: "sent", currentVersion: 2, sentVersion: 2, sentAt: NOW })];
    render(<ProposalsDesk />);
    const unopened = within(await openProposal());
    expect(unopened.getByTestId("link-opened").textContent).toBe("The link has not been opened since it was sent.");
  });

  it("says when the client's link shows an older version than the one saved", async () => {
    existing = [proposal({ status: "changes_requested", currentVersion: 3, sentVersion: 2, sentAt: NOW })];
    render(<ProposalsDesk />);
    const panel = within(await openProposal());
    expect(await panel.findByText(/the client's link shows version 2/u)).toBeDefined();
  });

  it("says a closed link showed a version, the figure the client was sent, and that without a link nothing records opens", async () => {
    existing = [proposal({ status: "withdrawn", currentVersion: 3, sentVersion: 2, linkOpen: false, latestTotalMinor: 1_000_000, latestCurrency: "GBP" })];
    render(<ProposalsDesk />);
    const closed = within(await openProposal());
    expect(await closed.findByText(/the client's link, which showed version 2, no longer opens/u)).toBeDefined();
    expect(closed.getByText("£10,000, as sent in version 2", { selector: "dd" })).toBeDefined();
    cleanup();

    existing = [proposal({ status: "sent", currentVersion: 1, sentVersion: 1, sentAt: NOW, hasLink: false })];
    render(<ProposalsDesk />);
    const older = within(await openProposal());
    expect(older.getByTestId("link-opened").textContent).toBe("It has no link that records being opened. Issue a new link if the client needs one.");
  });

  it("takes the row a withdrawal answers with, so its link and figure are true before the desk reads it again", async () => {
    // Version 3 is the booker's, in hand; version 2 was sent, at £10,000.
    existing = [proposal({ status: "changes_requested", currentVersion: 3, sentVersion: 2, sentAt: NOW, latestTotalMinor: 1_200_000, latestCurrency: "GBP" })];
    mocks.getLatestProposalVersion.mockResolvedValue(version(3));
    mocks.transitionProposal.mockResolvedValue(proposal({
      status: "withdrawn", currentVersion: 3, sentVersion: 2, sentAt: NOW, latestTotalMinor: 1_000_000, latestCurrency: "GBP", linkOpen: false,
    }));
    render(<ProposalsDesk />);
    const panel = within(await openProposal());
    // The quiet read after the move never arrives.
    mocks.getDeskProposal.mockImplementation(() => new Promise(() => undefined));
    fireEvent.click(panel.getByTestId("withdraw-button"));
    fireEvent.click(panel.getByTestId("withdraw-confirm-button"));
    expect(await panel.findByText(/the client's link, which showed version 2, no longer opens/u)).toBeDefined();
    expect(panel.getByText("£10,000, as sent in version 2", { selector: "dd" })).toBeDefined();
  });

  it("offers archive, and no link, composer or withdrawal, once a proposal is settled", async () => {
    existing = [proposal({ status: "accepted", currentVersion: 3, sentAt: NOW })];
    render(<ProposalsDesk />);
    const panel = within(await openProposal());
    expect(panel.getByTestId("archive-button")).toBeDefined();
    expect(panel.queryByTestId("send-open")).toBeNull();
    expect(panel.queryByTestId("composer-save")).toBeNull();
    expect(panel.queryByTestId("withdraw-button")).toBeNull();
    expect(panel.queryByTestId("share-link-unavailable")).toBeNull();
  });

  it("asks before withdrawing, naming what it ends", async () => {
    existing = [proposal({ status: "sent", currentVersion: 1 })];
    mocks.transitionProposal.mockResolvedValue(proposal({ status: "withdrawn", currentVersion: 1 }));
    render(<ProposalsDesk />);
    const panel = within(await openProposal());
    fireEvent.click(panel.getByTestId("withdraw-button"));
    expect(panel.getByTestId("withdraw-confirm").textContent).toContain("Withdraw this proposal? The client's link will stop working.");
    // The button stays where it was, so keyboard focus is not dropped.
    expect(panel.getByTestId("withdraw-button").getAttribute("aria-expanded")).toBe("true");
    fireEvent.click(panel.getByRole("button", { name: "Keep it" }));
    expect(panel.queryByTestId("withdraw-confirm")).toBeNull();
    expect(mocks.transitionProposal).not.toHaveBeenCalled();
    fireEvent.click(panel.getByTestId("withdraw-button"));
    fireEvent.click(panel.getByTestId("withdraw-confirm-button"));
    await waitFor(() => { expect(mocks.transitionProposal).toHaveBeenCalledWith("p1", "withdrawn"); });
    expect(await panel.findByText("Withdrawn", { selector: ".enq-chip" })).toBeDefined();
  });

  it("says what is and is not true when a step fails", async () => {
    existing = [proposal({ status: "sent", currentVersion: 1 })];
    mocks.transitionProposal.mockRejectedValue(new Error("offline"));
    render(<ProposalsDesk />);
    const panel = within(await openProposal());
    fireEvent.click(panel.getByTestId("withdraw-button"));
    fireEvent.click(panel.getByTestId("withdraw-confirm-button"));
    expect((await panel.findByRole("alert")).textContent).toBe("That did not go through. The proposal is as it was.");
    expect(panel.getByTestId("withdraw-confirm")).toBeDefined();
  });

  it("says the proposal moved first, and shows where it now stands, when the client answered before a withdrawal arrived", async () => {
    existing = [proposal({ status: "sent", currentVersion: 1 })];
    mocks.transitionProposal.mockImplementation(() => {
      // The client accepted a moment before the booker's withdrawal reached the API.
      existing = [proposal({ status: "accepted", currentVersion: 1 })];
      return Promise.reject(new ApiError(409, "The proposal changed", "PROPOSAL_STATUS_CHANGED"));
    });
    render(<ProposalsDesk />);
    const panel = within(await openProposal());
    fireEvent.click(panel.getByTestId("withdraw-button"));
    fireEvent.click(panel.getByTestId("withdraw-confirm-button"));
    expect((await panel.findByRole("alert")).textContent)
      .toBe("It changed before that arrived, so nothing was done. It now shows where it stands.");
    expect(await panel.findByText("Accepted", { selector: ".enq-chip" })).toBeDefined();
    // The ledger is read again too, so the row moves to Accepted.
    await waitFor(() => { expect(screen.getByTestId("proposals-summary").textContent).toBe("Nothing is waiting on you."); });
  });
});

describe("the ledger and the open proposal", () => {
  // When one has moved on without the other, whichever is behind is read
  // again, once, and never while a read that would settle it is on its way.
  const LATER = "2026-10-01T09:00:00.000Z";

  it("reads the proposal again, not the list, when its row has moved on past it", async () => {
    existing = [proposal({ status: "changes_requested", currentVersion: 2 })];
    render(<ProposalsDesk />);
    const panel = within(await openProposal());
    await panel.findByTestId("composer-message");
    const proposalReads = mocks.getDeskProposal.mock.calls.length;
    // A colleague saved version 3; the list, read for a stage, sees it first.
    existing = [proposal({ status: "changes_requested", currentVersion: 3, updatedAt: LATER })];
    fireEvent.click(screen.getByRole("button", { name: "Waiting on you, 1" }));
    await waitFor(() => { expect(mocks.getDeskProposal.mock.calls.length).toBe(proposalReads + 1); });
    await waitFor(() => { expect(panel.getByTestId("composer-start").textContent).toMatch(/^Starts from version 3\./u); });
    const listReads = mocks.listProposalDesk.mock.calls.length;
    await act(async () => { await Promise.resolve(); });
    expect(mocks.listProposalDesk.mock.calls.length).toBe(listReads);
  });

  it("does not read the list twice when a refused step's list answers before its proposal", async () => {
    existing = [proposal({ status: "sent", currentVersion: 1 })];
    mocks.transitionProposal.mockImplementation(() => {
      existing = [proposal({ status: "accepted", currentVersion: 1, updatedAt: LATER })];
      return Promise.reject(new ApiError(409, "The proposal changed", "PROPOSAL_STATUS_CHANGED"));
    });
    render(<ProposalsDesk />);
    const panel = within(await openProposal());
    let answer: (row: unknown) => void = () => undefined;
    mocks.getDeskProposal.mockReturnValueOnce(new Promise((resolve) => { answer = resolve; }));
    const listReads = mocks.listProposalDesk.mock.calls.length;
    const proposalReads = mocks.getDeskProposal.mock.calls.length;
    fireEvent.click(panel.getByTestId("withdraw-button"));
    fireEvent.click(panel.getByTestId("withdraw-confirm-button"));
    await panel.findByRole("alert");
    await waitFor(() => { expect(screen.getByTestId("proposals-summary").textContent).toBe("Nothing is waiting on you."); });
    await act(async () => { await Promise.resolve(); });
    expect(mocks.listProposalDesk.mock.calls.length).toBe(listReads + 1);
    // Nor the proposal twice: the refusal's own read of it is on its way, and said.
    expect(mocks.getDeskProposal.mock.calls.length).toBe(proposalReads + 1);
    expect(panel.getByText("Refreshing the proposal…")).toBeDefined();
    await act(async () => { answer(existing[0]); await Promise.resolve(); });
    expect(await panel.findByText("Accepted", { selector: ".enq-chip" })).toBeDefined();
    expect(mocks.listProposalDesk.mock.calls.length).toBe(listReads + 1);
    expect(panel.queryByText("Refreshing the proposal…")).toBeNull();
  });

  it("stops saying it is refreshing the proposal when a step's read of it fails", async () => {
    existing = [proposal({ status: "sent", currentVersion: 1 })];
    mocks.transitionProposal.mockImplementation(() => {
      existing = [proposal({ status: "withdrawn", currentVersion: 1 })];
      return Promise.resolve(existing[0]);
    });
    render(<ProposalsDesk />);
    const panel = within(await openProposal());
    let fail: (error: unknown) => void = () => undefined;
    mocks.getDeskProposal.mockImplementationOnce(() => new Promise((_resolve, reject) => { fail = reject; }));
    const reads = mocks.getDeskProposal.mock.calls.length;
    fireEvent.click(panel.getByTestId("withdraw-button"));
    fireEvent.click(panel.getByTestId("withdraw-confirm-button"));
    expect(await panel.findByText("Refreshing the proposal…")).toBeDefined();
    // Said as soon as it is asked for; failed once it has gone out.
    await waitFor(() => { expect(mocks.getDeskProposal.mock.calls.length).toBe(reads + 1); });
    await act(async () => { fail(new Error("offline")); await Promise.resolve(); });
    await waitFor(() => { expect(panel.queryByText("Refreshing the proposal…")).toBeNull(); });
    // The proposal stays as the step left it.
    expect(panel.getByText("Withdrawn", { selector: ".enq-chip" })).toBeDefined();
  });

  it("waits for a list read on its way before reading the list again for the open proposal", async () => {
    existing = [proposal({ status: "changes_requested", currentVersion: 1 })];
    render(<ProposalsDesk />);
    const panel = within(await openProposal());
    await panel.findByTestId("composer-message");
    const list = mocks.listProposalDesk.getMockImplementation();
    let listed: () => void = () => undefined;
    mocks.listProposalDesk.mockImplementationOnce((query: { readonly limit: number; readonly offset: number; readonly group?: string }) =>
      new Promise((resolve) => { listed = () => { resolve(list?.(query)); }; }));
    const listReads = mocks.listProposalDesk.mock.calls.length;
    // A colleague saves version 2: coming back reads it, and the ledger is read for its row.
    existing = [proposal({ status: "changes_requested", currentVersion: 2, updatedAt: LATER })];
    act(() => { document.dispatchEvent(new Event("visibilitychange")); });
    await waitFor(() => { expect(mocks.listProposalDesk.mock.calls.length).toBe(listReads + 1); });
    // Then version 3, found by Check again while that list read is still on its way.
    existing = [proposal({ status: "changes_requested", currentVersion: 3, updatedAt: "2026-10-01T12:00:00.000Z" })];
    fireEvent.click(await panel.findByTestId("composer-check-again"));
    await waitFor(() => { expect(panel.getByTestId("composer-start").textContent).toMatch(/^Starts from version 3\./u); });
    await act(async () => { await Promise.resolve(); });
    // The list on its way will say so: it is not asked for again.
    expect(mocks.listProposalDesk.mock.calls.length).toBe(listReads + 1);
    await act(async () => { listed(); await Promise.resolve(); });
    await waitFor(() => { expect(row("p1").textContent).toMatch(/Version 3/u); });
    expect(mocks.listProposalDesk.mock.calls.length).toBe(listReads + 1);
  });

  it("waits for more rows on their way before reading the list for the open proposal, and keeps them", async () => {
    existing = Array.from({ length: 60 }, (_unused, index) => proposal({
      id: `p${String(index + 1)}`, title: `Proposal ${String(index + 1)}`, status: "changes_requested", currentVersion: 1,
    }));
    render(<ProposalsDesk />);
    const panel = within(await openProposal("p1", "Proposal 1"));
    await panel.findByTestId("composer-message");
    let page: (value: unknown) => void = () => undefined;
    mocks.listProposalDesk.mockImplementationOnce(() => new Promise((resolve) => { page = resolve; }));
    fireEvent.click(screen.getByRole("button", { name: "Show more (10 more)" }));
    // Meanwhile, coming back reads the open proposal as moved on past its row.
    const moved = proposal({ id: "p1", title: "Proposal 1", status: "changes_requested", currentVersion: 2, updatedAt: LATER });
    existing = [moved, ...existing.slice(1)];
    const listReads = mocks.listProposalDesk.mock.calls.length;
    act(() => { document.dispatchEvent(new Event("visibilitychange")); });
    await waitFor(() => { expect(panel.getByText(/^Version 2/u, { selector: ".pr-version" })).toBeDefined(); });
    expect(mocks.listProposalDesk.mock.calls.length).toBe(listReads);
    await act(async () => { page({ rows: existing.slice(50), total: 60, statusCounts: counts(existing) }); await Promise.resolve(); });
    expect(await screen.findByTestId("proposal-row-p60")).toBeDefined();
    // Then the list is read for it, keeping every row shown.
    await waitFor(() => { expect(mocks.listProposalDesk).toHaveBeenLastCalledWith({ limit: 60, offset: 0 }); });
    expect(await screen.findByTestId("proposal-row-p60")).toBeDefined();
  });
});

describe("the layout it carries", () => {
  it("says the client's own layout and its room, and that the composer takes it as it stands", async () => {
    existing = [proposal({ configurationId: "layout-1", layoutRoomName: "Grand Hall", layoutFromEnquiry: true })];
    render(<ProposalsDesk />);
    const panel = within(await openProposal());
    expect((await panel.findByTestId("proposal-layout")).textContent).toBe("Their own, Grand Hall");
    expect((await panel.findByTestId("composer-layout")).textContent)
      .toBe("Their layout is taken as it stands when you save. Once the version is saved, Preview as the client shows it as they will see it.");
  });

  it("says a proposal carries none, and claims nothing when the API does not say", async () => {
    existing = [proposal({ layoutRoomName: null, layoutFromEnquiry: false }), proposal({ id: "p2", title: "Burns supper", configurationId: "layout-1" })];
    render(<ProposalsDesk />);
    const none = within(await openProposal());
    expect((await none.findByTestId("proposal-layout")).textContent).toBe("None");
    expect(none.queryByTestId("composer-layout")).toBeNull();
    const silent = within(await openProposal("p2", "Burns supper"));
    await silent.findByTestId("composer-save");
    expect(silent.queryByTestId("proposal-layout")).toBeNull();
    expect(silent.queryByTestId("composer-layout")).toBeNull();
  });
});

describe("the next version", () => {
  it("waits for the version to start from, says when it cannot be read, and reads it again", async () => {
    existing = [proposal({ currentVersion: 1 })];
    mocks.getLatestProposalVersion.mockRejectedValueOnce(new Error("offline"));
    render(<ProposalsDesk />);
    const panel = within(await openProposal());
    expect((await panel.findByTestId("latest-version-error")).textContent)
      .toBe("Version 1 could not be read, so the next one cannot start from it yet.");
    expect(panel.queryByTestId("composer-save")).toBeNull();
    fireEvent.click(panel.getByRole("button", { name: "Try again" }));
    expect(await panel.findByTestId("composer-save")).toBeDefined();
  });

  it("starts from the latest version's words and quote, and says what the new one changes", async () => {
    existing = [proposal({ status: "changes_requested", currentVersion: 2 })];
    mocks.getLatestProposalVersion.mockResolvedValue(version(2, {
      clientMessage: "Planning-grade draft for the gala.", capacityNote: "Around 120 seated.",
      quote: quoteSnapshot([{ description: "Grand Hall hire", quantity: 1, unitAmountMinor: 440_000 }]),
    }));
    render(<ProposalsDesk />);
    const panel = within(await openProposal());
    const message = await panel.findByTestId<HTMLTextAreaElement>("composer-message");
    expect(message.value).toBe("Planning-grade draft for the gala.");
    expect(panel.getByTestId<HTMLInputElement>("composer-capacity").value).toBe("Around 120 seated.");
    expect(panel.getByTestId<HTMLInputElement>("quote-price-0").value).toBe("4400");
    expect(panel.getByTestId("composer-start").textContent).toBe(`Starts from version 2. You have not changed anything here yet.${UNCHECKED}`);
    expect(panel.getByRole("button", { name: "Save version 3" })).toBeDefined();

    fireEvent.change(message, { target: { value: "A later finish, as asked." } });
    fireEvent.change(panel.getByTestId("quote-price-0"), { target: { value: "4600" } });
    expect(panel.getByTestId("composer-start").textContent)
      .toBe(`Starts from version 2. You have changed the message and the quote from £4,400 to £4,600.${UNCHECKED}`);
    expect(panel.queryByTestId("composer-not-carried")).toBeNull();
  });

  // What a save takes besides the words (the drawing, the event's facts) is
  // checked by the server against the version it starts from, said with the
  // words once known, and the save is held to what was said.
  const FACTS = { eventDate: "2026-11-20", guestCount: 120, occasion: "wedding", roomName: "Grand Hall", roomSlug: "grand-hall" };
  function checked(overrides: Record<string, unknown> = {}, now: Record<string, unknown> = {}): Record<string, unknown> {
    return { basedOn: 2, layout: "same", facts: { saved: FACTS, now: { ...FACTS, ...now } }, basis: "b".repeat(64), ...overrides };
  }

  it("says, once checked, what the version will take besides the words", async () => {
    existing = [proposal({ status: "changes_requested", currentVersion: 2 })];
    let answer: (next: Record<string, unknown>) => void = () => undefined;
    mocks.getProposalNextVersion.mockReturnValue(new Promise((resolve) => { answer = resolve; }));
    render(<ProposalsDesk />);
    const panel = within(await openProposal());
    // Until the check is back it says only where it starts.
    expect((await panel.findByTestId("composer-start")).textContent).toBe("Starts from version 2.");
    answer(checked({ layout: "changed" }, { guestCount: 180 }));
    await waitFor(() => {
      expect(panel.getByTestId("composer-start").textContent)
        .toBe("Starts from version 2. Changed: the guest count from 120 to 180 and the layout drawing.");
    });
    fireEvent.change(panel.getByTestId("composer-message"), { target: { value: "Room for 180 now." } });
    expect(panel.getByTestId("composer-start").textContent)
      .toBe("Starts from version 2. Changed: the message, the guest count from 120 to 180 and the layout drawing.");
  });

  it("says nothing is changed once checked, and holds the save to that check", async () => {
    existing = [proposal({ status: "changes_requested", currentVersion: 2 })];
    mocks.getProposalNextVersion.mockResolvedValue(checked());
    mocks.createProposalVersion.mockResolvedValue(version(3));
    render(<ProposalsDesk />);
    const panel = within(await openProposal());
    await waitFor(() => { expect(panel.getByTestId("composer-start").textContent).toBe("Starts from version 2. Nothing is changed from it yet."); });
    fireEvent.click(panel.getByRole("button", { name: "Save version 3" }));
    await waitFor(() => { expect(mocks.createProposalVersion).toHaveBeenCalledTimes(1); });
    expect(mocks.createProposalVersion.mock.calls[0]?.slice(2)).toEqual([2, "b".repeat(64)]);
  });

  it("takes a check made for another version as no check, and holds the save to nothing", async () => {
    existing = [proposal({ status: "changes_requested", currentVersion: 2 })];
    mocks.getProposalNextVersion.mockResolvedValue(checked({ basedOn: 1, layout: "changed" }));
    mocks.createProposalVersion.mockResolvedValue(version(3));
    render(<ProposalsDesk />);
    const panel = within(await openProposal());
    await waitFor(() => { expect(mocks.getProposalNextVersion).toHaveBeenCalled(); });
    expect((await panel.findByTestId("composer-start")).textContent).toBe("Starts from version 2.");
    fireEvent.click(panel.getByRole("button", { name: "Save version 3" }));
    await waitFor(() => { expect(mocks.createProposalVersion).toHaveBeenCalledTimes(1); });
    expect(mocks.createProposalVersion.mock.calls[0]?.slice(2)).toEqual([2, undefined]);
  });

  it("checks again when someone comes back to the page, as a layout may have changed in another tab", async () => {
    existing = [proposal({ status: "changes_requested", currentVersion: 2 })];
    mocks.getProposalNextVersion.mockResolvedValueOnce(checked()).mockResolvedValue(checked({ layout: "changed" }));
    render(<ProposalsDesk />);
    const panel = within(await openProposal());
    await waitFor(() => { expect(panel.getByTestId("composer-start").textContent).toBe("Starts from version 2. Nothing is changed from it yet."); });
    act(() => { window.dispatchEvent(new Event("focus")); });
    await waitFor(() => {
      expect(panel.getByTestId("composer-start").textContent).toBe("Starts from version 2. Changed: the layout drawing.");
    });
    expect(mocks.getProposalNextVersion).toHaveBeenCalledTimes(2);
  });

  it("checks again after a save refused for taking something the check did not say, and keeps the words", async () => {
    existing = [proposal({ status: "changes_requested", currentVersion: 2 })];
    mocks.getProposalNextVersion.mockResolvedValueOnce(checked()).mockResolvedValue(checked({ layout: "changed" }));
    mocks.createProposalVersion.mockRejectedValue(
      new ApiError(409, "The layout or the event changed after this was checked, so the version was not saved. Check it again.", "REVISION_CONFLICT"));
    render(<ProposalsDesk />);
    const panel = within(await openProposal());
    await waitFor(() => { expect(panel.getByTestId("composer-start").textContent).toBe("Starts from version 2. Nothing is changed from it yet."); });
    fireEvent.change(panel.getByTestId("composer-message"), { target: { value: "My words." } });
    fireEvent.click(panel.getByRole("button", { name: "Save version 3" }));
    expect((await panel.findByTestId("composer-error")).textContent)
      .toBe("The layout or the event's details changed before the version arrived, so it did not save. Your changes are still here.");
    await waitFor(() => {
      expect(panel.getByTestId("composer-start").textContent).toBe("Starts from version 2. Changed: the message and the layout drawing.");
    });
    expect(panel.getByTestId<HTMLTextAreaElement>("composer-message").value).toBe("My words.");
  });

  it("counts what a version from the Share lens leaves out among what changes, once checked, and describes Save by it", async () => {
    existing = [proposal({ status: "changes_requested", currentVersion: 2 })];
    mocks.getLatestProposalVersion.mockResolvedValue(version(2, { roomSummary: "The room is 30 m by 15 m.", layoutSummary: "Ten rounds of ten." }));
    let answer: (next: Record<string, unknown>) => void = () => undefined;
    mocks.getProposalNextVersion.mockReturnValue(new Promise((resolve) => { answer = resolve; }));
    render(<ProposalsDesk />);
    const panel = within(await openProposal());
    // Until checked, the words and what is not carried are said apart.
    expect((await panel.findByTestId("composer-start")).textContent).toBe("Starts from version 2.");
    expect(panel.getByTestId("composer-not-carried").textContent).toBe("Its descriptions of the room and layout are not carried over.");
    answer(checked());
    await waitFor(() => {
      expect(panel.getByTestId("composer-start").textContent).toBe("Starts from version 2. Changed: the room and layout descriptions (now left out).");
    });
    expect(panel.queryByTestId("composer-not-carried")).toBeNull();
    const save = panel.getByRole("button", { name: "Save version 3" });
    expect(save.getAttribute("aria-describedby")).toBe(panel.getByTestId("composer-start").id);
  });

  it("says when a check could not be made again, and holds the save to the last one made", async () => {
    existing = [proposal({ status: "changes_requested", currentVersion: 2 })];
    mocks.getProposalNextVersion.mockResolvedValueOnce(checked()).mockRejectedValue(new Error("offline"));
    mocks.createProposalVersion.mockResolvedValue(version(3));
    render(<ProposalsDesk />);
    const panel = within(await openProposal());
    await waitFor(() => { expect(panel.getByTestId("composer-start").textContent).toBe("Starts from version 2. Nothing is changed from it yet."); });
    expect(panel.queryByTestId("composer-check-again")).toBeNull();
    act(() => { window.dispatchEvent(new Event("focus")); });
    await waitFor(() => { expect(panel.getByTestId("composer-start").textContent).toBe(`Starts from version 2. You have not changed anything here yet.${UNCHECKED}`); });
    // What it last checked is not said as current, but the save takes nothing
    // else: if that no longer stands, the save is refused rather than take it.
    fireEvent.click(panel.getByRole("button", { name: "Save version 3" }));
    await waitFor(() => { expect(mocks.createProposalVersion).toHaveBeenCalledTimes(1); });
    expect(mocks.createProposalVersion.mock.calls[0]?.slice(2)).toEqual([2, "b".repeat(64)]);
  });

  it("says a save refused for its check, while the check still cannot be made, without claiming to show what changed", async () => {
    existing = [proposal({ status: "changes_requested", currentVersion: 2 })];
    mocks.getProposalNextVersion.mockResolvedValueOnce(checked()).mockRejectedValue(new Error("offline"));
    mocks.createProposalVersion.mockRejectedValue(
      new ApiError(409, "The layout or the event changed after this was checked, so the version was not saved. Check it again.", "REVISION_CONFLICT"));
    render(<ProposalsDesk />);
    const panel = within(await openProposal());
    await waitFor(() => { expect(panel.getByTestId("composer-start").textContent).toBe("Starts from version 2. Nothing is changed from it yet."); });
    fireEvent.change(panel.getByTestId("composer-message"), { target: { value: "My words." } });
    fireEvent.click(panel.getByRole("button", { name: "Save version 3" }));
    expect((await panel.findByTestId("composer-error")).textContent)
      .toBe("The layout or the event's details changed before the version arrived, so it did not save. Your changes are still here.");
    // The start line says what is known: that it could not be checked, with Check again.
    await waitFor(() => { expect(panel.getByTestId("composer-start").textContent).toBe(`Starts from version 2. You have changed the message.${UNCHECKED}`); });
    expect(panel.getByTestId("composer-check-again").textContent).toBe("Check again");
    expect(panel.getByTestId<HTMLTextAreaElement>("composer-message").value).toBe("My words.");
  });

  it("keeps Check again where it was pressed, with focus, when no check has been made yet", async () => {
    existing = [proposal({ status: "changes_requested", currentVersion: 2 })];
    let answer: (next: Record<string, unknown>) => void = () => undefined;
    mocks.getProposalNextVersion.mockRejectedValueOnce(new Error("offline")).mockReturnValueOnce(new Promise((resolve) => { answer = resolve; }));
    render(<ProposalsDesk />);
    const panel = within(await openProposal());
    const button = await panel.findByTestId("composer-check-again");
    button.focus();
    fireEvent.click(button);
    await waitFor(() => { expect(panel.getByTestId("composer-check-again").textContent).toBe("Checking…"); });
    expect(panel.getByTestId("composer-check-again").getAttribute("aria-disabled")).toBe("true");
    expect(document.activeElement).toBe(panel.getByTestId("composer-check-again"));
    act(() => { answer(checked()); });
    await waitFor(() => { expect(panel.getByTestId("composer-start").textContent).toBe("Starts from version 2. Nothing is changed from it yet."); });
    expect(panel.queryByTestId("composer-check-again")).toBeNull();
    expect(document.activeElement).toBe(panel.getByTestId("composer-start"));
  });

  it("gives focus to what the next composer starts from, or to the proposal, when Check again finds it moved on", async () => {
    for (const [moved, where] of [
      [proposal({ status: "changes_requested", currentVersion: 3 }), "start"],
      [proposal({ status: "sent", currentVersion: 2, sentVersion: 2, sentAt: NOW }), "heading"],
    ] as const) {
      existing = [proposal({ status: "changes_requested", currentVersion: 2 })];
      render(<ProposalsDesk />);
      const panel = within(await openProposal());
      const button = await panel.findByTestId("composer-check-again");
      existing = [moved];
      button.focus();
      fireEvent.click(button);
      if (where === "start") {
        await waitFor(() => { expect(panel.getByTestId("composer-start").textContent).toMatch(/^Starts from version 3\./u); });
        await waitFor(() => { expect(document.activeElement).toBe(panel.getByTestId("composer-start")); });
      } else {
        await waitFor(() => { expect(panel.queryByTestId("composer")).toBeNull(); });
        await waitFor(() => { expect(document.activeElement).toBe(panel.getByRole("heading", { level: 2, name: "Autumn gala" })); });
      }
      cleanup();
      forgetProposalMemory();
    }
  });

  it("waits for the version to start from before giving lost focus to the new composer, and leaves focus the booker moved", async () => {
    for (const elsewhere of [false, true]) {
      existing = [proposal({ status: "draft", currentVersion: 0 })];
      let answer: (value: Record<string, unknown>) => void = () => undefined;
      mocks.getLatestProposalVersion.mockImplementation(() => new Promise((resolve) => { answer = resolve; }));
      render(<ProposalsDesk />);
      const panel = within(await openProposal());
      (await panel.findByTestId("composer-message")).focus();
      const latestReads = mocks.getLatestProposalVersion.mock.calls.length;
      // A colleague saves the first version, and coming back reads it.
      existing = [proposal({ status: "draft", currentVersion: 1 })];
      act(() => { document.dispatchEvent(new Event("visibilitychange")); });
      await waitFor(() => { expect(panel.getByText("Reading version 1 to start from…")).toBeDefined(); });
      await waitFor(() => { expect(mocks.getLatestProposalVersion.mock.calls.length).toBe(latestReads + 1); });
      if (elsewhere) row("p1").focus();
      act(() => { answer(version(1)); });
      await waitFor(() => { expect(panel.getByTestId("composer-start").textContent).toMatch(/^Starts from version 1\./u); });
      await act(async () => { await Promise.resolve(); });
      expect(document.activeElement).toBe(elsewhere ? row("p1") : panel.getByTestId("composer-start"));
      cleanup();
      forgetProposalMemory();
    }
  });

  it("leaves focus where the booker went while Check again was checking", async () => {
    existing = [proposal({ status: "changes_requested", currentVersion: 2 })];
    let answer: (next: Record<string, unknown>) => void = () => undefined;
    mocks.getProposalNextVersion.mockRejectedValueOnce(new Error("offline")).mockReturnValueOnce(new Promise((resolve) => { answer = resolve; }));
    render(<ProposalsDesk />);
    const panel = within(await openProposal());
    const button = await panel.findByTestId("composer-check-again");
    button.focus();
    fireEvent.click(button);
    await waitFor(() => { expect(panel.getByTestId("composer-check-again").textContent).toBe("Checking…"); });
    const message = panel.getByTestId("composer-message");
    message.focus();
    act(() => { answer(checked()); });
    await waitFor(() => { expect(panel.getByTestId("composer-start").textContent).toBe("Starts from version 2. Nothing is changed from it yet."); });
    expect(document.activeElement).toBe(message);
  });

  it("says nothing and moves nothing for a check made again on coming back, only for one the booker asked for", async () => {
    existing = [proposal({ status: "changes_requested", currentVersion: 2 })];
    mocks.getProposalNextVersion.mockRejectedValueOnce(new Error("offline")).mockRejectedValueOnce(new Error("offline")).mockResolvedValue(checked());
    render(<ProposalsDesk />);
    const panel = within(await openProposal());
    await panel.findByTestId("composer-check-again");
    // Made again on coming back, and still not made: nothing is said.
    act(() => { document.dispatchEvent(new Event("visibilitychange")); });
    await waitFor(() => { expect(mocks.getProposalNextVersion).toHaveBeenCalledTimes(2); });
    await waitFor(() => { expect(panel.getByTestId("composer-check-again").textContent).toBe("Check again"); });
    expect(panel.getByTestId("composer-check-said").textContent).toBe("");
    // Made again by the window's focus, past the second that joins the two, and
    // answered: focus stays where it was.
    (document.activeElement as HTMLElement | null)?.blur();
    vi.spyOn(performance, "now").mockReturnValue(performance.now() + 5000);
    act(() => { window.dispatchEvent(new Event("focus")); });
    await waitFor(() => { expect(panel.getByTestId("composer-start").textContent).toBe("Starts from version 2. Nothing is changed from it yet."); });
    expect(document.activeElement).toBe(document.body);
  });

  it("checks again when asked after a check could not be made, keeping focus there, saying nothing of the last until it answers", async () => {
    existing = [proposal({ status: "changes_requested", currentVersion: 2 })];
    let again: (next: Record<string, unknown>) => void = () => undefined;
    mocks.getProposalNextVersion.mockResolvedValueOnce(checked()).mockRejectedValueOnce(new Error("offline"))
      .mockReturnValueOnce(new Promise((resolve) => { again = resolve; }));
    render(<ProposalsDesk />);
    const panel = within(await openProposal());
    await waitFor(() => { expect(panel.getByTestId("composer-start").textContent).toBe("Starts from version 2. Nothing is changed from it yet."); });
    act(() => { window.dispatchEvent(new Event("focus")); });
    const button = await panel.findByTestId("composer-check-again");
    const proposalReads = mocks.getDeskProposal.mock.calls.length;
    button.focus();
    fireEvent.click(button);
    await waitFor(() => { expect(mocks.getProposalNextVersion).toHaveBeenCalledTimes(3); });
    // The proposal is read again with it, so the facts agree with what it says.
    expect(mocks.getDeskProposal.mock.calls.length).toBe(proposalReads + 1);
    expect(panel.getByTestId("composer-start").textContent).toBe("Starts from version 2.");
    // It stays where it was pressed, saying it is checking, and keeps focus.
    await waitFor(() => { expect(panel.getByTestId("composer-check-again").textContent).toBe("Checking…"); });
    expect(panel.getByTestId("composer-check-again").getAttribute("aria-disabled")).toBe("true");
    expect(panel.getByTestId("composer-check-again").getAttribute("aria-busy")).toBe("true");
    expect(document.activeElement).toBe(panel.getByTestId("composer-check-again"));
    fireEvent.click(panel.getByTestId("composer-check-again"));
    expect(mocks.getProposalNextVersion).toHaveBeenCalledTimes(3);
    // Answered, focus goes to what it now says.
    act(() => { again(checked({ layout: "changed", basis: "c".repeat(64) })); });
    await waitFor(() => { expect(panel.getByTestId("composer-start").textContent).toBe("Starts from version 2. Changed: the layout drawing."); });
    expect(panel.queryByTestId("composer-check-again")).toBeNull();
    await waitFor(() => { expect(document.activeElement).toBe(panel.getByTestId("composer-start")); });
  });

  it("says when a check made again still cannot be made, and keeps Check again where focus is", async () => {
    existing = [proposal({ status: "changes_requested", currentVersion: 2 })];
    mocks.getProposalNextVersion.mockResolvedValueOnce(checked()).mockRejectedValue(new Error("offline"));
    render(<ProposalsDesk />);
    const panel = within(await openProposal());
    await waitFor(() => { expect(panel.getByTestId("composer-start").textContent).toBe("Starts from version 2. Nothing is changed from it yet."); });
    act(() => { window.dispatchEvent(new Event("focus")); });
    const button = await panel.findByTestId("composer-check-again");
    button.focus();
    fireEvent.click(button);
    await waitFor(() => { expect(panel.getByTestId("composer-check-said").textContent).toBe("It still could not be checked."); });
    expect(panel.getByTestId("composer-check-again").textContent).toBe("Check again");
    expect(document.activeElement).toBe(panel.getByTestId("composer-check-again"));
  });

  it("holds a save made while a refused check is made again to that check, so it is refused again rather than take what was not said", async () => {
    existing = [proposal({ status: "changes_requested", currentVersion: 2 })];
    mocks.getProposalNextVersion.mockResolvedValueOnce(checked()).mockReturnValueOnce(new Promise(() => undefined));
    mocks.createProposalVersion.mockRejectedValue(
      new ApiError(409, "The layout or the event changed after this was checked, so the version was not saved. Check it again.", "REVISION_CONFLICT"));
    render(<ProposalsDesk />);
    const panel = within(await openProposal());
    await waitFor(() => { expect(panel.getByTestId("composer-start").textContent).toBe("Starts from version 2. Nothing is changed from it yet."); });
    fireEvent.click(panel.getByRole("button", { name: "Save version 3" }));
    expect(await panel.findByTestId("composer-error")).toBeDefined();
    await waitFor(() => { expect(panel.getByTestId("composer-start").textContent).toBe("Starts from version 2."); });
    fireEvent.click(panel.getByRole("button", { name: "Save version 3" }));
    await waitFor(() => { expect(mocks.createProposalVersion).toHaveBeenCalledTimes(2); });
    expect(mocks.createProposalVersion.mock.calls[1]?.slice(2)).toEqual([2, "b".repeat(64)]);
  });

  it("does not say or send again the check a save was refused for while it is made again", async () => {
    existing = [proposal({ status: "changes_requested", currentVersion: 2 })];
    let again: (next: Record<string, unknown>) => void = () => undefined;
    mocks.getProposalNextVersion.mockResolvedValueOnce(checked())
      .mockReturnValueOnce(new Promise((resolve) => { again = resolve; }));
    mocks.createProposalVersion.mockRejectedValueOnce(
      new ApiError(409, "The layout or the event changed after this was checked, so the version was not saved. Check it again.", "REVISION_CONFLICT"))
      .mockResolvedValue(version(3));
    render(<ProposalsDesk />);
    const panel = within(await openProposal());
    await waitFor(() => { expect(panel.getByTestId("composer-start").textContent).toBe("Starts from version 2. Nothing is changed from it yet."); });
    fireEvent.click(panel.getByRole("button", { name: "Save version 3" }));
    expect(await panel.findByTestId("composer-error")).toBeDefined();
    await waitFor(() => { expect(panel.getByTestId("composer-start").textContent).toBe("Starts from version 2."); });
    act(() => { again(checked({ layout: "changed", basis: "c".repeat(64) })); });
    await waitFor(() => { expect(panel.getByTestId("composer-start").textContent).toBe("Starts from version 2. Changed: the layout drawing."); });
    fireEvent.click(panel.getByRole("button", { name: "Save version 3" }));
    await waitFor(() => { expect(mocks.createProposalVersion).toHaveBeenCalledTimes(2); });
    expect(mocks.createProposalVersion.mock.calls[1]?.slice(2)).toEqual([2, "c".repeat(64)]);
  });

  it("reads the proposal again when its check finds it can no longer take a version", async () => {
    existing = [proposal({ status: "changes_requested", currentVersion: 2 })];
    mocks.getProposalNextVersion.mockRejectedValue(new ApiError(422, "Proposal content is frozen in its current status", "NOT_EDITABLE"));
    render(<ProposalsDesk />);
    await openProposal();
    await waitFor(() => { expect(mocks.getProposalNextVersion).toHaveBeenCalledTimes(1); });
    await waitFor(() => { expect(mocks.getDeskProposal.mock.calls.length).toBeGreaterThanOrEqual(2); });
  });

  it("reads the proposal again with the check when someone comes back, once for both events, and not while hidden", async () => {
    existing = [proposal({ status: "changes_requested", currentVersion: 2 })];
    mocks.getProposalNextVersion.mockResolvedValue(checked());
    render(<ProposalsDesk />);
    const panel = within(await openProposal());
    await waitFor(() => { expect(panel.getByTestId("composer-start").textContent).toBe("Starts from version 2. Nothing is changed from it yet."); });
    const proposalReads = mocks.getDeskProposal.mock.calls.length;
    // The guest count changed in the pipeline meanwhile.
    existing = [proposal({ status: "changes_requested", currentVersion: 2, guestCount: 180 })];
    // Coming back fires both, as separate events.
    act(() => { document.dispatchEvent(new Event("visibilitychange")); });
    await act(async () => { await Promise.resolve(); });
    act(() => { window.dispatchEvent(new Event("focus")); });
    await waitFor(() => { expect(mocks.getProposalNextVersion).toHaveBeenCalledTimes(2); });
    await waitFor(() => { expect(mocks.getDeskProposal.mock.calls.length).toBe(proposalReads + 1); });
    // The facts row agrees with what the check now says.
    await waitFor(() => { expect(panel.getByText("180", { selector: "dd" })).toBeDefined(); });
    // Hidden, nothing is read.
    const hidden = vi.spyOn(document, "visibilityState", "get").mockReturnValue("hidden");
    await new Promise((resolve) => { setTimeout(resolve, 1100); });
    act(() => { document.dispatchEvent(new Event("visibilitychange")); });
    hidden.mockRestore();
    expect(mocks.getProposalNextVersion).toHaveBeenCalledTimes(2);
  });

  it("does not read the proposal again for a check the API does not offer", async () => {
    existing = [proposal({ status: "changes_requested", currentVersion: 2 })];
    render(<ProposalsDesk />);
    const panel = within(await openProposal());
    await waitFor(() => { expect(panel.getByTestId("composer-start").textContent).toBe(`Starts from version 2. You have not changed anything here yet.${UNCHECKED}`); });
    await act(async () => { await Promise.resolve(); });
    expect(mocks.getDeskProposal).toHaveBeenCalledTimes(1);
  });

  it("reads the proposal again without saying so when someone comes back", async () => {
    existing = [proposal({ status: "changes_requested", currentVersion: 2 })];
    mocks.getProposalNextVersion.mockResolvedValue(checked());
    render(<ProposalsDesk />);
    const panel = within(await openProposal());
    await waitFor(() => { expect(panel.getByTestId("composer-start").textContent).toBe("Starts from version 2. Nothing is changed from it yet."); });
    let answer: (row: Record<string, unknown>) => void = () => undefined;
    mocks.getDeskProposal.mockReturnValueOnce(new Promise((resolve) => { answer = resolve; }));
    act(() => { document.dispatchEvent(new Event("visibilitychange")); });
    await waitFor(() => { expect(mocks.getDeskProposal).toHaveBeenCalledTimes(2); });
    // The panel does not jump for a read the booker did not ask for.
    expect(panel.queryByText("Refreshing the proposal…")).toBeNull();
    act(() => { answer(proposal({ status: "changes_requested", currentVersion: 2, guestCount: 180 })); });
    await waitFor(() => { expect(panel.getByText("180", { selector: "dd" })).toBeDefined(); });
  });

  // Words written in a composer the proposal moves on from (a version saved
  // elsewhere, or the proposal sent) are kept to copy, with why, rather than
  // lost with the composer.
  it("keeps the words when a version saved elsewhere starts the composer again, says why, and gives them focus", async () => {
    existing = [proposal({ status: "changes_requested", currentVersion: 2 })];
    const current = (): number => Number(existing[0]?.["currentVersion"] ?? 2);
    mocks.getLatestProposalVersion.mockImplementation(() => Promise.resolve(version(current(), { clientMessage: `The words of version ${String(current())}.` })));
    mocks.getProposalNextVersion.mockImplementation(() => Promise.resolve(checked({ basedOn: current() })));
    render(<ProposalsDesk />);
    const panel = within(await openProposal());
    const message = await panel.findByTestId<HTMLTextAreaElement>("composer-message");
    await waitFor(() => { expect(panel.getByTestId("composer-start").textContent).toBe("Starts from version 2. Nothing is changed from it yet."); });
    fireEvent.change(message, { target: { value: "My careful new words." } });
    message.focus();
    // A colleague saved version 3 meanwhile, and the booker comes back to the page.
    existing = [proposal({ status: "changes_requested", currentVersion: 3 })];
    act(() => { document.dispatchEvent(new Event("visibilitychange")); });
    await waitFor(() => { expect(panel.getByTestId("composer-start").textContent).toBe("Starts from version 3. Nothing is changed from it yet."); });
    expect(panel.getByTestId<HTMLTextAreaElement>("composer-message").value).toBe("The words of version 3.");
    const kept = within(panel.getByTestId("kept-version"));
    const heading = kept.getByRole("heading", { name: "What you were writing" });
    expect(kept.getByTestId("kept-version-why").textContent).toBe("Version 3 was saved meanwhile, so the next version starts from it.");
    expect(kept.getByText("My careful new words.")).toBeDefined();
    expect(screen.getByText("Version 3 was saved meanwhile, so the next version starts from it. What you wrote is kept here to copy.")).toBeDefined();
    await waitFor(() => { expect(document.activeElement).toBe(heading); });
  });

  it("keeps the words when the proposal is sent meanwhile, and says why the composer has gone", async () => {
    existing = [proposal({ status: "changes_requested", currentVersion: 2 })];
    mocks.getProposalNextVersion.mockResolvedValueOnce(checked())
      .mockRejectedValue(new ApiError(422, "Proposal content is frozen in its current status", "NOT_EDITABLE"));
    render(<ProposalsDesk />);
    const panel = within(await openProposal());
    fireEvent.change(await panel.findByTestId("composer-message"), { target: { value: "My careful new words." } });
    existing = [proposal({ status: "sent", currentVersion: 2, sentVersion: 2, sentAt: NOW })];
    act(() => { window.dispatchEvent(new Event("focus")); });
    const kept = within(await panel.findByTestId("kept-version"));
    expect(kept.getByRole("heading", { name: "What you were writing" })).toBeDefined();
    expect(kept.getByTestId("kept-version-why").textContent).toBe("It is with the client now, so a new version cannot be written.");
    expect(kept.getByText("My careful new words.")).toBeDefined();
    expect(panel.queryByTestId("composer")).toBeNull();
    expect(panel.getByText("With the client")).toBeDefined();
    // The ledger is read again with it, so its row agrees with the panel.
    await waitFor(() => { expect(within(row("p1")).getByText("With the client")).toBeDefined(); });
  });

  it("reads the ledger again once when the open proposal has moved on from its row, however behind the list answers", async () => {
    existing = [proposal({ status: "changes_requested", currentVersion: 2 })];
    const listed = [...existing];
    mocks.listProposalDesk.mockImplementation(() => Promise.resolve({ rows: listed, total: listed.length, statusCounts: counts(listed) }));
    mocks.getProposalNextVersion.mockResolvedValue(checked());
    render(<ProposalsDesk />);
    const panel = within(await openProposal());
    await waitFor(() => { expect(panel.getByTestId("composer-start").textContent).toBe("Starts from version 2. Nothing is changed from it yet."); });
    const listReads = mocks.listProposalDesk.mock.calls.length;
    // Version 3 was saved elsewhere; the list still answers as it was.
    existing = [proposal({ status: "changes_requested", currentVersion: 3 })];
    mocks.getProposalNextVersion.mockResolvedValue(checked({ basedOn: 3 }));
    act(() => { document.dispatchEvent(new Event("visibilitychange")); });
    await waitFor(() => { expect(panel.getByTestId("composer-start").textContent).toBe("Starts from version 3. Nothing is changed from it yet."); });
    await waitFor(() => { expect(mocks.listProposalDesk).toHaveBeenCalledTimes(listReads + 1); });
    await new Promise((resolve) => { setTimeout(resolve, 50); });
    expect(mocks.listProposalDesk).toHaveBeenCalledTimes(listReads + 1);
  });

  it("puts nothing aside when nothing was written", async () => {
    existing = [proposal({ status: "changes_requested", currentVersion: 2 })];
    render(<ProposalsDesk />);
    const panel = within(await openProposal());
    await panel.findByTestId("composer-message");
    existing = [proposal({ status: "changes_requested", currentVersion: 3 })];
    act(() => { document.dispatchEvent(new Event("visibilitychange")); });
    await waitFor(() => { expect(panel.getByTestId("composer-start").textContent).toBe(`Starts from version 3. You have not changed anything here yet.${UNCHECKED}`); });
    expect(panel.queryByTestId("kept-version")).toBeNull();
  });

  it("checks the new version once it is saved, and says nothing is changed from it", async () => {
    existing = [proposal({ status: "changes_requested", currentVersion: 2 })];
    mocks.getProposalNextVersion.mockImplementation(() => Promise.resolve(checked({ basedOn: Number(existing[0]?.["currentVersion"] ?? 2) })));
    mocks.createProposalVersion.mockImplementation((_id: string, payload: Record<string, unknown>) => {
      existing = [proposal({ status: "changes_requested", currentVersion: 3 })];
      mocks.getLatestProposalVersion.mockResolvedValue(version(3, payload));
      return Promise.resolve(version(3, payload));
    });
    render(<ProposalsDesk />);
    const panel = within(await openProposal());
    await waitFor(() => { expect(panel.getByTestId("composer-start").textContent).toBe("Starts from version 2. Nothing is changed from it yet."); });
    fireEvent.click(panel.getByRole("button", { name: "Save version 3" }));
    await waitFor(() => { expect(panel.getByTestId("composer-start").textContent).toBe("Starts from version 3. Nothing is changed from it yet."); });
  });

  it("stops listening once the desk is gone, and drops a check when the composer closes", async () => {
    existing = [proposal({ status: "changes_requested", currentVersion: 2 }), proposal({ id: "p2", title: "Winter dinner", status: "sent", currentVersion: 1 })];
    let second: (next: Record<string, unknown>) => void = () => undefined;
    mocks.getProposalNextVersion.mockResolvedValueOnce(checked())
      .mockReturnValueOnce(new Promise((resolve) => { second = resolve; }));
    const { unmount } = render(<ProposalsDesk />);
    const panel = within(await openProposal());
    await waitFor(() => { expect(panel.getByTestId("composer-start").textContent).toBe("Starts from version 2. Nothing is changed from it yet."); });
    // Another proposal, sent, then this one again: its old check is not said as current.
    await openProposal("p2", "Winter dinner");
    const again = within(await openProposal());
    expect((await again.findByTestId("composer-start")).textContent).toBe("Starts from version 2.");
    act(() => { second(checked({ layout: "changed" })); });
    await waitFor(() => { expect(again.getByTestId("composer-start").textContent).toBe("Starts from version 2. Changed: the layout drawing."); });
    const made = mocks.getProposalNextVersion.mock.calls.length;
    unmount();
    await new Promise((resolve) => { setTimeout(resolve, 1100); });
    window.dispatchEvent(new Event("focus"));
    expect(mocks.getProposalNextVersion).toHaveBeenCalledTimes(made);
  });

  it("names the version its words came from, saves on that one, and says why a version saved meanwhile stops it", async () => {
    // The proposal reads version 3 while its latest version still reads as 2
    // (a re-read on its way, or one that failed): the words are version 2's.
    existing = [proposal({ status: "changes_requested", currentVersion: 3 })];
    mocks.getLatestProposalVersion.mockResolvedValue(version(2, { clientMessage: "The words of version 2." }));
    mocks.createProposalVersion.mockRejectedValue(
      new ApiError(409, "A newer version was saved or sent after this was read. Reload it to see it.", "PROPOSAL_VERSION_CHANGED"));
    render(<ProposalsDesk />);
    const panel = within(await openProposal());
    expect((await panel.findByTestId("composer-start")).textContent).toBe(`Starts from version 2. You have not changed anything here yet.${UNCHECKED}`);
    fireEvent.click(panel.getByRole("button", { name: "Save version 3" }));
    await waitFor(() => { expect(mocks.createProposalVersion).toHaveBeenCalledTimes(1); });
    expect(mocks.createProposalVersion.mock.calls[0]?.[2]).toBe(2);
    expect((await panel.findByTestId("composer-error")).textContent)
      .toBe("It changed before the version arrived, so it did not save. Your changes are still here, and it now shows where it stands.");
  });

  it("reads the latest version again after a save refused for one saved meanwhile, and starts from it", async () => {
    // Read as version 2 though the proposal is at 3 (a re-read that failed);
    // the proposal's number does not change, so only the refusal re-reads it.
    existing = [proposal({ status: "changes_requested", currentVersion: 3 })];
    mocks.getLatestProposalVersion.mockResolvedValueOnce(version(2, { clientMessage: "The words of version 2." }))
      .mockResolvedValue(version(3, { clientMessage: "The words of version 3." }));
    mocks.createProposalVersion.mockRejectedValue(
      new ApiError(409, "A newer version was saved or sent after this was read. Reload it to see it.", "PROPOSAL_VERSION_CHANGED"));
    render(<ProposalsDesk />);
    const panel = within(await openProposal());
    expect((await panel.findByTestId("composer-start")).textContent).toBe(`Starts from version 2. You have not changed anything here yet.${UNCHECKED}`);
    fireEvent.change(panel.getByTestId("composer-message"), { target: { value: "My later words." } });
    fireEvent.click(panel.getByRole("button", { name: "Save version 3" }));
    await waitFor(() => {
      expect(panel.getByTestId("composer-start").textContent).toBe(`Starts from version 3. You have not changed anything here yet.${UNCHECKED}`);
    });
    expect(panel.getByTestId<HTMLTextAreaElement>("composer-message").value).toBe("The words of version 3.");
    expect(within(panel.getByTestId("kept-version")).getByText("My later words.")).toBeDefined();
  });

  it("takes away the draft quote of a version refused outright, and keeps one that may have saved", async () => {
    const madeQuote = {
      id: "33333333-3333-4333-8333-333333333333", venueId: "v1", opportunityId: null, proposalId: "p1", enquiryId: null, spaceId: null,
      name: "Autumn gala quote", status: "draft", currency: "GBP", subtotalMinor: 12_050, totalMinor: 12_050, validUntil: null,
      supersededByQuoteId: null, notes: null, createdBy: "u1", createdAt: NOW, updatedAt: NOW, deletedAt: null,
      lineItems: [{
        id: "44444444-4444-4444-8444-444444444444", quoteId: "33333333-3333-4333-8333-333333333333", pricingRuleId: null,
        description: "Grand Hall hire", quantity: 1, unitAmountMinor: 12_050, lineTotalMinor: 12_050, sortOrder: 0,
      }],
    };
    mocks.createQuote.mockResolvedValue(madeQuote);
    mocks.deleteQuote.mockResolvedValue(undefined);
    for (const [refusal, deleted] of [
      [new ApiError(409, "A newer version was saved or sent after this was read.", "PROPOSAL_VERSION_CHANGED"), true],
      [new ApiError(0, "Network error — check your connection", "NETWORK_ERROR"), false],
    ] as const) {
      mocks.deleteQuote.mockClear();
      mocks.createProposalVersion.mockReset().mockRejectedValue(refusal);
      render(<ProposalsDesk />);
      const panel = within(await openProposal());
      fireEvent.click(panel.getByTestId("add-quote-line"));
      fireEvent.change(panel.getByTestId("quote-desc-0"), { target: { value: "Grand Hall hire" } });
      fireEvent.change(panel.getByTestId("quote-price-0"), { target: { value: "120.50" } });
      fireEvent.click(panel.getByTestId("composer-save"));
      await panel.findByTestId("composer-error");
      if (deleted) expect(mocks.deleteQuote).toHaveBeenCalledWith(madeQuote.id);
      else expect(mocks.deleteQuote).not.toHaveBeenCalled();
      cleanup();
    }
  });

  it("says what a version from the editor's Share lens shows the client that the next will not carry", async () => {
    existing = [proposal({ status: "changes_requested", currentVersion: 1 })];
    mocks.getLatestProposalVersion.mockResolvedValue(version(1, {
      roomSummary: "The Grand Hall is 30 m by 15 m.", layoutSummary: "Ten round tables of ten.",
    }));
    render(<ProposalsDesk />);
    const panel = within(await openProposal());
    expect((await panel.findByTestId("composer-not-carried")).textContent).toBe("Its descriptions of the room and layout are not carried over.");
  });

  it("says why a version did not save when its links changed meanwhile, keeps the words, and shows the layout now linked", async () => {
    existing = [proposal({ status: "draft", currentVersion: 0, layoutRoomName: null, layoutFromEnquiry: false })];
    mocks.createProposalVersion.mockImplementation(() => {
      // A colleague linked the deal, and with it the client's layout, while this was being written.
      existing = [proposal({ status: "draft", currentVersion: 0, configurationId: "layout-1", layoutRoomName: "Grand Hall", layoutFromEnquiry: true })];
      return Promise.reject(new ApiError(409, "The proposal's links changed; reload before saving a version", "REVISION_CONFLICT"));
    });
    render(<ProposalsDesk />);
    const panel = within(await openProposal());
    expect((await panel.findByTestId("proposal-layout")).textContent).toBe("None");
    fireEvent.change(await panel.findByTestId("composer-message"), { target: { value: "Here is the dinner you asked about." } });
    fireEvent.click(panel.getByTestId("composer-save"));
    expect((await panel.findByTestId("composer-error")).textContent)
      .toBe("The layout or the event's details changed before the version arrived, so it did not save. Your changes are still here.");
    expect(await panel.findByText("Their own, Grand Hall")).toBeDefined();
    expect(panel.getByTestId("composer-message")).toHaveProperty("value", "Here is the dinner you asked about.");
  });

  it("keeps a version refused because a colleague moved the proposal, to copy, with why it did not save", async () => {
    existing = [proposal({ status: "changes_requested", currentVersion: 1, sentVersion: 1 })];
    mocks.createProposalVersion.mockImplementation(() => {
      // A colleague sent version 1 again while this version was being written.
      existing = [proposal({ status: "sent", currentVersion: 1, sentVersion: 1, sentAt: NOW })];
      return Promise.reject(new ApiError(422, "Proposal content is frozen in its current status", "NOT_EDITABLE"));
    });
    render(<ProposalsDesk />);
    const panel = within(await openProposal());
    fireEvent.change(await panel.findByTestId("composer-message"), { target: { value: "Here is the later finish you asked for." } });
    fireEvent.click(panel.getByTestId("composer-save"));
    const kept = within(await panel.findByTestId("kept-version"));
    expect(kept.getByRole("alert").textContent)
      .toBe("It changed before the version arrived, so it did not save. Your changes are still here, and it now shows where it stands.");
    expect(kept.getByText("Here is the later finish you asked for.")).toBeDefined();
    expect(panel.queryByTestId("composer-save")).toBeNull();
    expect(panel.getByText("With the client")).toBeDefined();
  });

  it("keeps a version that did not save once its composer has gone, until it is cleared or a version saves", async () => {
    existing = [proposal({ status: "changes_requested", currentVersion: 1, sentVersion: 1 })];
    mocks.getLatestProposalVersion.mockResolvedValue(version(1));
    mocks.createProposalVersion.mockImplementationOnce(() => {
      // A colleague sent version 1 again while this version was being written.
      existing = [proposal({ status: "sent", currentVersion: 1, sentVersion: 1, sentAt: NOW })];
      return Promise.reject(new ApiError(422, "Proposal content is frozen in its current status", "NOT_EDITABLE"));
    });
    render(<ProposalsDesk />);
    const panel = within(await openProposal());
    fireEvent.change(await panel.findByTestId("composer-message"), { target: { value: "Here is the later finish you asked for." } });
    fireEvent.click(panel.getByTestId("composer-save"));
    expect(await panel.findByTestId("kept-version")).toBeDefined();

    // The client asks again, and the proposal is opened afresh: the composer
    // starts from version 1 again, and the words are still there to copy.
    existing = [proposal({ status: "changes_requested", currentVersion: 1, sentVersion: 1, sentAt: NOW })];
    fireEvent.keyDown(panel.getByRole("heading", { level: 2, name: "Autumn gala" }), { key: "Escape" });
    await waitFor(() => { expect(screen.queryByRole("heading", { level: 2, name: "Autumn gala" })).toBeNull(); });
    const again = within(await openProposal());
    expect((await again.findByTestId<HTMLTextAreaElement>("composer-message")).value).toBe("");
    expect(within(again.getByTestId("kept-version")).getByText("Here is the later finish you asked for.")).toBeDefined();
    // Put away once copied, it stays away.
    fireEvent.click(again.getByTestId("kept-version-clear"));
    expect(again.queryByTestId("kept-version")).toBeNull();
  });

  it("carries words left in a proposal back into its composer when it is opened again, even after a save that did not arrive", async () => {
    existing = [proposal({ status: "changes_requested", currentVersion: 1, sentVersion: 1, sentAt: NOW })];
    mocks.getLatestProposalVersion.mockResolvedValue(version(1));
    mocks.createProposalVersion.mockRejectedValueOnce(new Error("offline")).mockImplementationOnce((_id: string, payload: Record<string, unknown>) => {
      existing = [proposal({ status: "changes_requested", currentVersion: 2, sentVersion: 1, sentAt: NOW })];
      mocks.getLatestProposalVersion.mockResolvedValue(version(2, payload));
      return Promise.resolve(version(2, payload));
    });
    render(<ProposalsDesk />);
    const panel = within(await openProposal());
    fireEvent.change(await panel.findByTestId("composer-message"), { target: { value: "Words one." } });
    fireEvent.click(panel.getByTestId("composer-save"));
    await panel.findByTestId("composer-error");
    fireEvent.keyDown(panel.getByRole("heading", { level: 2, name: "Autumn gala" }), { key: "Escape" });
    await waitFor(() => { expect(screen.queryByRole("heading", { level: 2, name: "Autumn gala" })).toBeNull(); });

    // Opened again, the words are where they were left, in the composer that wrote them.
    const again = within(await openProposal());
    expect((await again.findByTestId<HTMLTextAreaElement>("composer-message")).value).toBe("Words one.");
    expect(again.queryByTestId("kept-version")).toBeNull();
    fireEvent.click(again.getByTestId("composer-save"));
    await waitFor(() => { expect(again.getByTestId("composer-start").textContent).toBe(`Starts from version 2. You have not changed anything here yet.${UNCHECKED}`); });
    expect(mocks.createProposalVersion.mock.calls[1]?.[1]).toMatchObject({ clientMessage: "Words one." });
    expect(again.queryByTestId("kept-version")).toBeNull();
  });

  it("puts a failure away with the composer it belonged to, and says why the words were kept", async () => {
    // Refused here, before anything was sent, and a save that did not arrive:
    // neither is said over the composer that replaces it.
    for (const refuse of ["here", "offline"] as const) {
      existing = [proposal({ status: "changes_requested", currentVersion: 2 })];
      const current = (): number => Number(existing[0]?.["currentVersion"] ?? 2);
      mocks.getLatestProposalVersion.mockImplementation(() => Promise.resolve(version(current(), { clientMessage: `The words of version ${String(current())}.` })));
      mocks.createProposalVersion.mockReset().mockRejectedValue(new Error("offline"));
      render(<ProposalsDesk />);
      const panel = within(await openProposal());
      fireEvent.change(await panel.findByTestId("composer-message"), { target: { value: "My careful new words." } });
      if (refuse === "here") {
        fireEvent.click(panel.getByTestId("add-quote-line"));
        fireEvent.change(panel.getByTestId("quote-desc-0"), { target: { value: "Late licence" } });
      }
      fireEvent.click(panel.getByTestId("composer-save"));
      expect((await panel.findByTestId("composer-error")).textContent).toBe(refuse === "here"
        ? "Quote line 1 needs a price like 120 or 120.50." : "The version did not save. Your changes are still here.");
      // A colleague saves version 3, and the booker comes back.
      existing = [proposal({ status: "changes_requested", currentVersion: 3 })];
      act(() => { document.dispatchEvent(new Event("visibilitychange")); });
      await waitFor(() => { expect(panel.getByTestId<HTMLTextAreaElement>("composer-message").value).toBe("The words of version 3."); });
      const kept = within(panel.getByTestId("kept-version"));
      expect(kept.getByRole("heading", { name: "What you were writing" })).toBeDefined();
      expect(kept.getByTestId("kept-version-why").textContent).toBe("Version 3 was saved meanwhile, so the next version starts from it.");
      expect(kept.getByText("My careful new words.")).toBeDefined();
      expect(panel.getByTestId("kept-note").textContent)
        .toBe("Version 3 was saved meanwhile, so the next version starts from it. What you wrote is kept here to copy.");
      expect(panel.queryByTestId("composer-error")).toBeNull();
      cleanup();
      forgetProposalMemory();
    }
  });

  it("keeps each version refused for one saved meanwhile, one copy for each composer, until each is cleared", async () => {
    existing = [proposal({ status: "changes_requested", currentVersion: 1 })];
    const current = (): number => Number(existing[0]?.["currentVersion"] ?? 1);
    mocks.getLatestProposalVersion.mockImplementation(() => Promise.resolve(version(current(), { clientMessage: `The words of version ${String(current())}.` })));
    // Each save arrives just after a colleague's version.
    mocks.createProposalVersion.mockImplementation(() => {
      existing = [proposal({ status: "changes_requested", currentVersion: current() + 1 })];
      return Promise.reject(new ApiError(409, "A newer version was saved or sent after this was read.", "PROPOSAL_VERSION_CHANGED"));
    });
    render(<ProposalsDesk />);
    const panel = within(await openProposal());
    fireEvent.change(await panel.findByTestId("composer-message"), { target: { value: "Words one." } });
    fireEvent.click(panel.getByTestId("composer-save"));
    await waitFor(() => { expect(panel.getByTestId<HTMLTextAreaElement>("composer-message").value).toBe("The words of version 2."); });
    expect(within(panel.getByTestId("kept-version")).getByRole("heading", { name: "The version that did not save" })).toBeDefined();

    fireEvent.change(panel.getByTestId("composer-message"), { target: { value: "Words two." } });
    fireEvent.click(panel.getByTestId("composer-save"));
    await waitFor(() => { expect(panel.getByTestId<HTMLTextAreaElement>("composer-message").value).toBe("The words of version 3."); });
    const kept = within(panel.getByTestId("kept-version"));
    expect(kept.getByRole("heading", { name: "The versions that did not save" })).toBeDefined();
    expect(kept.getByText("Words one.")).toBeDefined();
    expect(kept.getByText("Words two.")).toBeDefined();
    // Each refusal explains itself; neither was put aside for another reason.
    expect(kept.queryByTestId("kept-version-why")).toBeNull();
    fireEvent.click(kept.getAllByTestId("kept-version-clear")[0] as HTMLElement);
    expect(within(panel.getByTestId("kept-version")).queryByText("Words one.")).toBeNull();
    expect(within(panel.getByTestId("kept-version")).getByText("Words two.")).toBeDefined();
  });

  it("puts away every kept copy once a version saves", async () => {
    existing = [proposal({ status: "changes_requested", currentVersion: 1, sentVersion: 1, sentAt: NOW })];
    const current = (): number => Number(existing[0]?.["currentVersion"] ?? 1);
    mocks.getLatestProposalVersion.mockImplementation(() => Promise.resolve(version(current())));
    mocks.createProposalVersion.mockImplementation((_id: string, payload: Record<string, unknown>) => {
      existing = [proposal({ status: "changes_requested", currentVersion: 3, sentVersion: 1, sentAt: NOW })];
      mocks.getLatestProposalVersion.mockResolvedValue(version(3, payload));
      return Promise.resolve(version(3, payload));
    });
    render(<ProposalsDesk />);
    const panel = within(await openProposal());
    fireEvent.change(await panel.findByTestId("composer-message"), { target: { value: "Words one." } });
    // Version 2 was saved elsewhere: the words are kept beside the next composer.
    existing = [proposal({ status: "changes_requested", currentVersion: 2, sentVersion: 1, sentAt: NOW })];
    act(() => { document.dispatchEvent(new Event("visibilitychange")); });
    expect(await panel.findByTestId("kept-version")).toBeDefined();

    // The next composer saves a version: the copy kept by the first is put away.
    fireEvent.change(panel.getByTestId("composer-message"), { target: { value: "Words one, as saved." } });
    fireEvent.click(panel.getByTestId("composer-save"));
    await waitFor(() => { expect(panel.getByTestId("composer-start").textContent).toBe(`Starts from version 3. You have not changed anything here yet.${UNCHECKED}`); });
    expect(panel.queryByTestId("kept-version")).toBeNull();
  });

  it("keeps the words when another proposal is opened, and when the desk is left, and carries them on when it is opened again", async () => {
    existing = [
      proposal({ status: "changes_requested", currentVersion: 1 }),
      proposal({ id: "p2", title: "Winter dinner", status: "draft", currentVersion: 1 }),
    ];
    render(<ProposalsDesk />);
    const first = within(await openProposal());
    fireEvent.change(await first.findByTestId("composer-message"), { target: { value: "A later finish, as asked." } });
    // j to the next proposal (from outside a text field), then back.
    fireEvent.keyDown(first.getByRole("heading", { level: 2, name: "Autumn gala" }), { key: "j" });
    await screen.findByRole("heading", { level: 2, name: "Winter dinner" });
    const back = within(await openProposal());
    expect((await back.findByTestId<HTMLTextAreaElement>("composer-message")).value).toBe("A later finish, as asked.");
    expect(back.queryByTestId("kept-version")).toBeNull();
    // Another part of the dashboard, and back: still there.
    cleanup();
    render(<ProposalsDesk />);
    const later = within(await openProposal());
    expect((await later.findByTestId<HTMLTextAreaElement>("composer-message")).value).toBe("A later finish, as asked.");
  });

  it("keeps what each person wrote, and the copies they put aside, for them alone, through leaving the desk and another signing in", async () => {
    existing = [proposal({ status: "changes_requested", currentVersion: 1 })];
    mocks.getLatestProposalVersion.mockResolvedValue(version(1, { clientMessage: "The words of version 1." }));
    render(<ProposalsDesk />);
    const panel = within(await openProposal());
    fireEvent.change(await panel.findByTestId("composer-message"), { target: { value: "Words put aside." } });
    fireEvent.click(panel.getByTestId("composer-start-again"));
    fireEvent.change(panel.getByTestId("composer-message"), { target: { value: "Words still being written." } });
    // Another part of the dashboard, and back: both are where they were left.
    cleanup();
    const view = render(<ProposalsDesk />);
    const back = within(await openProposal());
    expect((await back.findByTestId<HTMLTextAreaElement>("composer-message")).value).toBe("Words still being written.");
    expect(within(back.getByTestId("kept-version")).getByText("Words put aside.")).toBeDefined();

    // Another account signed in on this page is given a desk of its own, and
    // reads neither.
    authState.user = { ...authState.user, id: "u2", name: "Iain Robertson" };
    view.rerender(<ProposalsDesk />);
    expect(await screen.findByText("Good morning, Iain")).toBeDefined();
    expect(screen.queryByRole("heading", { level: 2, name: "Autumn gala" })).toBeNull();
    const theirs = within(await openProposal());
    expect((await theirs.findByTestId<HTMLTextAreaElement>("composer-message")).value).toBe("The words of version 1.");
    expect(theirs.queryByTestId("kept-version")).toBeNull();

    // The one who wrote them, signed in again, finds them.
    authState.user = { ...authState.user, id: "u1", name: "Catherine Tait" };
    view.rerender(<ProposalsDesk />);
    const mine = within(await openProposal());
    expect((await mine.findByTestId<HTMLTextAreaElement>("composer-message")).value).toBe("Words still being written.");
    expect(within(mine.getByTestId("kept-version")).getByText("Words put aside.")).toBeDefined();
  });

  it("keeps words left in a proposal that moved on while away, and says why, when it is opened again", async () => {
    for (const [moved, why] of [
      [proposal({ status: "changes_requested", currentVersion: 2 }), "Version 2 was saved meanwhile, so the next version starts from it."],
      [proposal({ status: "sent", currentVersion: 1, sentVersion: 1, sentAt: NOW }), "It is with the client now, so a new version cannot be written."],
    ] as const) {
      existing = [proposal({ status: "changes_requested", currentVersion: 1 }), proposal({ id: "p2", title: "Winter dinner", status: "draft", currentVersion: 1 })];
      const current = (): number => Number(existing[0]?.["currentVersion"] ?? 1);
      mocks.getLatestProposalVersion.mockImplementation(() => Promise.resolve(version(current())));
      render(<ProposalsDesk />);
      const first = within(await openProposal());
      fireEvent.change(await first.findByTestId("composer-message"), { target: { value: "A later finish, as asked." } });
      await openProposal("p2", "Winter dinner");
      existing = [moved, proposal({ id: "p2", title: "Winter dinner", status: "draft", currentVersion: 1 })];
      const again = within(await openProposal());
      const kept = within(await again.findByTestId("kept-version"));
      expect(kept.getByTestId("kept-version-why").textContent).toBe(why);
      expect(kept.getByText("A later finish, as asked.")).toBeDefined();
      expect(again.getByTestId("kept-note").textContent).toBe(`${why} What you wrote is kept here to copy.`);
      // Opened by the booker, the proposal's heading keeps focus.
      expect(document.activeElement).toBe(again.getByRole("heading", { level: 2, name: "Autumn gala" }));
      cleanup();
      forgetProposalMemory();
    }
  });

  it("starts again from the version on request, keeping what was written to copy", async () => {
    existing = [proposal({ status: "changes_requested", currentVersion: 1 })];
    mocks.getLatestProposalVersion.mockResolvedValue(version(1, { clientMessage: "The words of version 1." }));
    render(<ProposalsDesk />);
    const panel = within(await openProposal());
    const message = await panel.findByTestId<HTMLTextAreaElement>("composer-message");
    expect(panel.queryByTestId("composer-start-again")).toBeNull();
    fireEvent.change(message, { target: { value: "Words to set aside." } });
    fireEvent.click(panel.getByRole("button", { name: "Start again from version 1" }));
    await waitFor(() => { expect(panel.getByTestId<HTMLTextAreaElement>("composer-message").value).toBe("The words of version 1."); });
    const kept = within(panel.getByTestId("kept-version"));
    expect(kept.getByTestId("kept-version-why").textContent).toBe("You started again from version 1.");
    expect(kept.getByText("Words to set aside.")).toBeDefined();
    expect(panel.getByTestId("kept-note").textContent).toBe("You started again from version 1. What you wrote is kept here to copy.");
    expect(document.activeElement).toBe(panel.getByTestId("composer-message"));
    expect(panel.queryByTestId("composer-start-again")).toBeNull();
  });

  it("puts a failure away with the words when starting again", async () => {
    existing = [proposal({ status: "changes_requested", currentVersion: 1 })];
    mocks.createProposalVersion.mockRejectedValue(new Error("offline"));
    render(<ProposalsDesk />);
    const panel = within(await openProposal());
    fireEvent.change(await panel.findByTestId("composer-message"), { target: { value: "Words that did not save." } });
    fireEvent.click(panel.getByTestId("composer-save"));
    expect((await panel.findByTestId("composer-error")).textContent).toBe("The version did not save. Your changes are still here.");
    fireEvent.click(panel.getByRole("button", { name: "Start again from version 1" }));
    await waitFor(() => { expect(panel.queryByTestId("composer-error")).toBeNull(); });
    expect(within(panel.getByTestId("kept-version")).getByText("Words that did not save.")).toBeDefined();
  });

  it("gives focus to the words kept, not the next composer, when a version saved elsewhere follows starting again", async () => {
    existing = [proposal({ status: "changes_requested", currentVersion: 1 })];
    const current = (): number => Number(existing[0]?.["currentVersion"] ?? 1);
    mocks.getLatestProposalVersion.mockImplementation(() => Promise.resolve(version(current(), { clientMessage: `The words of version ${String(current())}.` })));
    render(<ProposalsDesk />);
    const panel = within(await openProposal());
    fireEvent.change(await panel.findByTestId("composer-message"), { target: { value: "Words one." } });
    fireEvent.click(panel.getByRole("button", { name: "Start again from version 1" }));
    await waitFor(() => { expect(document.activeElement).toBe(panel.getByTestId("composer-message")); });
    fireEvent.change(panel.getByTestId("composer-message"), { target: { value: "Words two." } });
    // A colleague saves version 2, and the booker comes back to the page.
    existing = [proposal({ status: "changes_requested", currentVersion: 2 })];
    act(() => { document.dispatchEvent(new Event("visibilitychange")); });
    await waitFor(() => { expect(panel.getByTestId<HTMLTextAreaElement>("composer-message").value).toBe("The words of version 2."); });
    const kept = within(panel.getByTestId("kept-version"));
    expect(kept.getByText("Words one.")).toBeDefined();
    expect(kept.getByText("Words two.")).toBeDefined();
    await waitFor(() => { expect(document.activeElement).toBe(kept.getByRole("heading", { name: "What you were writing" })); });
  });

  it("keeps nothing of words that saved after the desk was left", async () => {
    existing = [proposal({ status: "changes_requested", currentVersion: 1 })];
    let saved: (value: Record<string, unknown>) => void = () => undefined;
    mocks.createProposalVersion.mockReturnValue(new Promise((resolve) => { saved = resolve; }));
    render(<ProposalsDesk />);
    const panel = within(await openProposal());
    fireEvent.change(await panel.findByTestId("composer-message"), { target: { value: "Words for version 2." } });
    fireEvent.click(panel.getByTestId("composer-save"));
    await waitFor(() => { expect(mocks.createProposalVersion).toHaveBeenCalledTimes(1); });
    // Another part of the dashboard, and the version arrives meanwhile.
    cleanup();
    existing = [proposal({ status: "changes_requested", currentVersion: 2 })];
    mocks.getLatestProposalVersion.mockResolvedValue(version(2, { clientMessage: "Words for version 2." }));
    await act(async () => {
      saved(version(2, { clientMessage: "Words for version 2." }));
      await new Promise((resolve) => { setTimeout(resolve, 0); });
    });
    render(<ProposalsDesk />);
    const back = within(await openProposal());
    await waitFor(() => { expect(back.getByTestId("composer-start").textContent).toMatch(/^Starts from version 2\. You have not changed anything here yet\./u); });
    expect(back.queryByTestId("kept-version")).toBeNull();
    expect(back.getByTestId("kept-note").textContent).toBe("");
  });

  it("does not keep words the booker's own save is taking when the page is read again before it answers", async () => {
    existing = [proposal({ status: "changes_requested", currentVersion: 1 })];
    const current = (): number => Number(existing[0]?.["currentVersion"] ?? 1);
    mocks.getLatestProposalVersion.mockImplementation(() => Promise.resolve(version(current(), { clientMessage: `The words of version ${String(current())}.` })));
    let saved: (value: Record<string, unknown>) => void = () => undefined;
    mocks.createProposalVersion.mockImplementation(() => {
      // The version lands at once; its answer is slow to come back.
      existing = [proposal({ status: "changes_requested", currentVersion: 2 })];
      return new Promise((resolve) => { saved = resolve; });
    });
    render(<ProposalsDesk />);
    const panel = within(await openProposal());
    fireEvent.change(await panel.findByTestId("composer-message"), { target: { value: "The words of version 2." } });
    fireEvent.click(panel.getByTestId("composer-save"));
    await waitFor(() => { expect(mocks.createProposalVersion).toHaveBeenCalledTimes(1); });
    // Coming back reads the proposal, already at version 2, before the save answers.
    act(() => { document.dispatchEvent(new Event("visibilitychange")); });
    await waitFor(() => { expect(panel.getByTestId("composer-start").textContent).toMatch(/^Starts from version 2\./u); });
    expect(panel.queryByTestId("kept-version")).toBeNull();
    expect(panel.getByTestId("kept-note").textContent).toBe("");
    await act(async () => { saved(version(2, { clientMessage: "The words of version 2." })); await Promise.resolve(); });
    expect(panel.queryByTestId("kept-version")).toBeNull();
  });

  it("leaves focus where the booker went while the link was being made", async () => {
    existing = [proposal({ currentVersion: 1 })];
    let made: () => void = () => undefined;
    mocks.createProposalShareToken.mockImplementation(() => new Promise((resolve) => {
      made = () => {
        existing = [proposal({ currentVersion: 1, status: "sent", sentAt: NOW })];
        resolve({ token: "client-token", shareUrl: "/proposal-share/client-token", tokenPrefix: "client-t", proposal: existing[0] });
      };
    }));
    render(<ProposalsDesk />);
    const panel = within(await openProposal());
    fireEvent.click(panel.getByRole("button", { name: "Send to the client…" }));
    fireEvent.click(panel.getByRole("button", { name: "Make the link" }));
    await waitFor(() => { expect(mocks.createProposalShareToken).toHaveBeenCalledTimes(1); });
    const heading = panel.getByRole("heading", { level: 2, name: "Autumn gala" });
    heading.focus();
    await act(async () => { made(); await Promise.resolve(); });
    expect(await panel.findByRole("button", { name: "Copy the link" })).toBeDefined();
    await act(async () => { await Promise.resolve(); });
    expect(document.activeElement).toBe(heading);
  });

  it("keeps words whose save is refused after a version saved elsewhere took their composer, and says so truly", async () => {
    existing = [proposal({ status: "changes_requested", currentVersion: 2 })];
    const current = (): number => Number(existing[0]?.["currentVersion"] ?? 2);
    mocks.getLatestProposalVersion.mockImplementation(() => Promise.resolve(version(current(), { clientMessage: `The words of version ${String(current())}.` })));
    let refuse: (error: unknown) => void = () => undefined;
    mocks.createProposalVersion.mockImplementation(() => new Promise((_resolve, reject) => { refuse = reject; }));
    render(<ProposalsDesk />);
    const panel = within(await openProposal());
    fireEvent.change(await panel.findByTestId("composer-message"), { target: { value: "My careful new words." } });
    fireEvent.click(panel.getByTestId("composer-save"));
    await waitFor(() => { expect(mocks.createProposalVersion).toHaveBeenCalledTimes(1); });
    // A colleague saves version 3, and coming back reads it while the save is on its way.
    existing = [proposal({ status: "changes_requested", currentVersion: 3 })];
    act(() => { document.dispatchEvent(new Event("visibilitychange")); });
    await waitFor(() => { expect(panel.getByTestId<HTMLTextAreaElement>("composer-message").value).toBe("The words of version 3."); });
    // The save is then refused: the words are kept, so what it says is true.
    await act(async () => { refuse(new ApiError(409, "A newer version was saved or sent after this was read.", "PROPOSAL_VERSION_CHANGED")); await Promise.resolve(); });
    const kept = within(await panel.findByTestId("kept-version"));
    expect(kept.getByRole("heading", { name: "The version that did not save" })).toBeDefined();
    expect(kept.getByText("My careful new words.")).toBeDefined();
    expect(panel.getByTestId("composer-error").textContent)
      .toBe("It changed before the version arrived, so it did not save. Your changes are still here, and it now shows where it stands.");
  });

  it("keeps words whose save is refused after the proposal was sent meanwhile, and says why", async () => {
    existing = [proposal({ status: "changes_requested", currentVersion: 2 })];
    let refuse: (error: unknown) => void = () => undefined;
    mocks.createProposalVersion.mockImplementation(() => new Promise((_resolve, reject) => { refuse = reject; }));
    render(<ProposalsDesk />);
    const panel = within(await openProposal());
    fireEvent.change(await panel.findByTestId("composer-message"), { target: { value: "My careful new words." } });
    fireEvent.click(panel.getByTestId("composer-save"));
    await waitFor(() => { expect(mocks.createProposalVersion).toHaveBeenCalledTimes(1); });
    existing = [proposal({ status: "sent", currentVersion: 2, sentVersion: 2, sentAt: NOW })];
    act(() => { document.dispatchEvent(new Event("visibilitychange")); });
    await waitFor(() => { expect(panel.queryByTestId("composer")).toBeNull(); });
    await act(async () => { refuse(new ApiError(422, "Proposal content is frozen in its current status", "NOT_EDITABLE")); await Promise.resolve(); });
    const kept = within(await panel.findByTestId("kept-version"));
    expect(kept.getByText("My careful new words.")).toBeDefined();
    expect(kept.getByRole("alert").textContent)
      .toBe("It changed before the version arrived, so it did not save. Your changes are still here, and it now shows where it stands.");
  });

  it("keeps words whose save is refused after the booker left the proposal and came back to it moved on", async () => {
    existing = [
      proposal({ status: "changes_requested", currentVersion: 1 }),
      proposal({ id: "p2", title: "Winter dinner", status: "draft", currentVersion: 1 }),
    ];
    let refuse: (error: unknown) => void = () => undefined;
    mocks.createProposalVersion.mockImplementation(() => new Promise((_resolve, reject) => { refuse = reject; }));
    render(<ProposalsDesk />);
    const first = within(await openProposal());
    fireEvent.change(await first.findByTestId("composer-message"), { target: { value: "Words for version 2." } });
    fireEvent.click(first.getByTestId("composer-save"));
    await waitFor(() => { expect(mocks.createProposalVersion).toHaveBeenCalledTimes(1); });
    await openProposal("p2", "Winter dinner");
    // A colleague's version 2 lands meanwhile.
    existing = [proposal({ status: "changes_requested", currentVersion: 2 }), proposal({ id: "p2", title: "Winter dinner", status: "draft", currentVersion: 1 })];
    const back = within(await openProposal());
    await waitFor(() => { expect(back.getByTestId("composer-start").textContent).toMatch(/^Starts from version 2\./u); });
    await act(async () => { refuse(new ApiError(409, "A newer version was saved or sent after this was read.", "PROPOSAL_VERSION_CHANGED")); await Promise.resolve(); });
    expect(within(await back.findByTestId("kept-version")).getByText("Words for version 2.")).toBeDefined();
  });

  it("keeps words whose save is refused after the desk was left, once their composer had gone", async () => {
    existing = [proposal({ status: "changes_requested", currentVersion: 2 })];
    const current = (): number => Number(existing[0]?.["currentVersion"] ?? 2);
    mocks.getLatestProposalVersion.mockImplementation(() => Promise.resolve(version(current(), { clientMessage: `The words of version ${String(current())}.` })));
    let refuse: (error: unknown) => void = () => undefined;
    mocks.createProposalVersion.mockImplementation(() => new Promise((_resolve, reject) => { refuse = reject; }));
    render(<ProposalsDesk />);
    const panel = within(await openProposal());
    fireEvent.change(await panel.findByTestId("composer-message"), { target: { value: "My careful new words." } });
    fireEvent.click(panel.getByTestId("composer-save"));
    await waitFor(() => { expect(mocks.createProposalVersion).toHaveBeenCalledTimes(1); });
    existing = [proposal({ status: "changes_requested", currentVersion: 3 })];
    act(() => { document.dispatchEvent(new Event("visibilitychange")); });
    await waitFor(() => { expect(panel.getByTestId<HTMLTextAreaElement>("composer-message").value).toBe("The words of version 3."); });
    // Another part of the dashboard, and the refusal arrives there.
    cleanup();
    await act(async () => {
      refuse(new ApiError(409, "A newer version was saved or sent after this was read.", "PROPOSAL_VERSION_CHANGED"));
      await new Promise((resolve) => { setTimeout(resolve, 0); });
    });
    render(<ProposalsDesk />);
    const back = within(await openProposal());
    expect(within(await back.findByTestId("kept-version")).getByText("My careful new words.")).toBeDefined();
  });

  it("puts every kept copy away when a version saves after the desk was left", async () => {
    existing = [proposal({ status: "changes_requested", currentVersion: 1 })];
    let saved: (value: Record<string, unknown>) => void = () => undefined;
    mocks.createProposalVersion.mockReturnValue(new Promise((resolve) => { saved = resolve; }));
    render(<ProposalsDesk />);
    const panel = within(await openProposal());
    fireEvent.change(await panel.findByTestId("composer-message"), { target: { value: "Words to set aside." } });
    fireEvent.click(panel.getByRole("button", { name: "Start again from version 1" }));
    await panel.findByTestId("kept-version");
    fireEvent.change(panel.getByTestId("composer-message"), { target: { value: "Words for version 2." } });
    fireEvent.click(panel.getByTestId("composer-save"));
    await waitFor(() => { expect(mocks.createProposalVersion).toHaveBeenCalledTimes(1); });
    cleanup();
    existing = [proposal({ status: "changes_requested", currentVersion: 2 })];
    await act(async () => {
      saved(version(2, { clientMessage: "Words for version 2." }));
      await new Promise((resolve) => { setTimeout(resolve, 0); });
    });
    render(<ProposalsDesk />);
    const back = within(await openProposal());
    await waitFor(() => { expect(back.getByTestId("composer-start").textContent).toMatch(/^Starts from version 2\./u); });
    expect(back.queryByTestId("kept-version")).toBeNull();
  });

  it("says each Start again aloud, even when the words said are the same", async () => {
    existing = [proposal({ status: "changes_requested", currentVersion: 1 })];
    render(<ProposalsDesk />);
    const panel = within(await openProposal());
    fireEvent.change(await panel.findByTestId("composer-message"), { target: { value: "Words one." } });
    fireEvent.click(panel.getByRole("button", { name: "Start again from version 1" }));
    const note = panel.getByTestId("kept-note");
    await waitFor(() => { expect(note.textContent).toBe("You started again from version 1. What you wrote is kept here to copy."); });
    const first = note.firstElementChild;
    fireEvent.change(panel.getByTestId("composer-message"), { target: { value: "Words two." } });
    fireEvent.click(panel.getByRole("button", { name: "Start again from version 1" }));
    // The same words, said afresh: a new node in the status region, which a screen reader hears.
    await waitFor(() => { expect(note.firstElementChild).not.toBe(first); });
    expect(note.textContent).toBe("You started again from version 1. What you wrote is kept here to copy.");
  });

  it("carries words on in the composer that wrote them, so its save still on its way is not taken for a colleague's", async () => {
    existing = [
      proposal({ status: "changes_requested", currentVersion: 1 }),
      proposal({ id: "p2", title: "Winter dinner", status: "draft", currentVersion: 1 }),
    ];
    let saved: (value: Record<string, unknown>) => void = () => undefined;
    mocks.createProposalVersion.mockReturnValue(new Promise((resolve) => { saved = resolve; }));
    render(<ProposalsDesk />);
    const first = within(await openProposal());
    fireEvent.change(await first.findByTestId("composer-message"), { target: { value: "Words for version 2." } });
    fireEvent.click(first.getByTestId("composer-save"));
    await waitFor(() => { expect(mocks.createProposalVersion).toHaveBeenCalledTimes(1); });
    // Another proposal, and back, while the save is on its way: the words carry on.
    await openProposal("p2", "Winter dinner");
    const back = within(await openProposal());
    expect((await back.findByTestId<HTMLTextAreaElement>("composer-message")).value).toBe("Words for version 2.");
    // The version lands, and coming back reads it before the save answers.
    existing = [proposal({ status: "changes_requested", currentVersion: 2 }), proposal({ id: "p2", title: "Winter dinner", status: "draft", currentVersion: 1 })];
    mocks.getLatestProposalVersion.mockResolvedValue(version(2, { clientMessage: "Words for version 2." }));
    act(() => { document.dispatchEvent(new Event("visibilitychange")); });
    await waitFor(() => { expect(back.getByTestId("composer-start").textContent).toMatch(/^Starts from version 2\./u); });
    expect(back.queryByTestId("kept-version")).toBeNull();
    expect(back.getByTestId("kept-note").textContent).toBe("");
    await act(async () => { saved(version(2, { clientMessage: "Words for version 2." })); await Promise.resolve(); });
    expect(back.queryByTestId("kept-version")).toBeNull();
  });

  it("asks the browser to hold a reload while any words are not yet saved, on screen or not", async () => {
    existing = [
      proposal({ status: "changes_requested", currentVersion: 1 }),
      proposal({ id: "p2", title: "Winter dinner", status: "draft", currentVersion: 1 }),
    ];
    const unload = (): boolean => {
      const event = new Event("beforeunload", { cancelable: true });
      window.dispatchEvent(event);
      return event.defaultPrevented;
    };
    render(<ProposalsDesk />);
    const panel = within(await openProposal());
    await panel.findByTestId("composer-message");
    expect(unload()).toBe(false);
    fireEvent.change(panel.getByTestId("composer-message"), { target: { value: "Not yet saved." } });
    expect(unload()).toBe(true);
    // Another proposal, then another part of the dashboard: the words are still here, off screen.
    await openProposal("p2", "Winter dinner");
    expect(unload()).toBe(true);
    cleanup();
    expect(unload()).toBe(true);
    // Back, and the words taken out again: nothing is left to lose.
    render(<ProposalsDesk />);
    const back = within(await openProposal());
    fireEvent.change(await back.findByTestId("composer-message"), { target: { value: "" } });
    expect(unload()).toBe(false);
    // Words put aside to copy are held too, until the copy is cleared.
    fireEvent.change(back.getByTestId("composer-message"), { target: { value: "Words to set aside." } });
    fireEvent.click(back.getByRole("button", { name: "Start again from version 1" }));
    await back.findByTestId("kept-version");
    expect(unload()).toBe(true);
    fireEvent.click(back.getByTestId("kept-version-clear"));
    expect(unload()).toBe(false);
  });

  it("does not move focus to kept words when the booker is working elsewhere on the page", async () => {
    existing = [proposal({ status: "changes_requested", currentVersion: 2 })];
    const current = (): number => Number(existing[0]?.["currentVersion"] ?? 2);
    mocks.getLatestProposalVersion.mockImplementation(() => Promise.resolve(version(current())));
    render(<ProposalsDesk />);
    const panel = within(await openProposal());
    fireEvent.change(await panel.findByTestId("composer-message"), { target: { value: "My careful new words." } });
    const reply = panel.getByTestId("reply-input");
    reply.focus();
    existing = [proposal({ status: "changes_requested", currentVersion: 3 })];
    act(() => { document.dispatchEvent(new Event("visibilitychange")); });
    expect(await panel.findByTestId("kept-version")).toBeDefined();
    await act(async () => { await Promise.resolve(); });
    expect(document.activeElement).toBe(reply);
  });

  it("finds a first version saved elsewhere on coming back, and keeps the words written for it", async () => {
    existing = [proposal({ status: "draft", currentVersion: 0 })];
    mocks.getLatestProposalVersion.mockResolvedValue(version(1, { clientMessage: "A colleague's first version." }));
    render(<ProposalsDesk />);
    const panel = within(await openProposal());
    fireEvent.change(await panel.findByTestId("composer-message"), { target: { value: "My first words." } });
    existing = [proposal({ status: "draft", currentVersion: 1 })];
    act(() => { document.dispatchEvent(new Event("visibilitychange")); });
    await waitFor(() => { expect(panel.getByTestId<HTMLTextAreaElement>("composer-message").value).toBe("A colleague's first version."); });
    const kept = within(panel.getByTestId("kept-version"));
    expect(kept.getByTestId("kept-version-why").textContent).toBe("Version 1 was saved meanwhile, so the next version starts from it.");
    expect(kept.getByText("My first words.")).toBeDefined();
  });

  it("does not start another proposal's composer from a version saved on the one left", async () => {
    existing = [
      proposal({ status: "changes_requested", currentVersion: 1 }),
      proposal({ id: "p2", title: "Winter dinner", status: "draft", currentVersion: 1 }),
    ];
    let saved: (value: Record<string, unknown>) => void = () => undefined;
    mocks.createProposalVersion.mockReturnValue(new Promise((resolve) => { saved = resolve; }));
    render(<ProposalsDesk />);
    const first = within(await openProposal());
    fireEvent.change(await first.findByTestId("composer-message"), { target: { value: "Words for version 2." } });
    fireEvent.click(first.getByTestId("composer-save"));
    await waitFor(() => { expect(mocks.createProposalVersion).toHaveBeenCalledTimes(1); });
    const second = within(await openProposal("p2", "Winter dinner"));
    await second.findByTestId("composer-message");
    existing = [proposal({ status: "changes_requested", currentVersion: 2 }), proposal({ id: "p2", title: "Winter dinner", status: "draft", currentVersion: 1 })];
    await act(async () => { saved(version(2, { clientMessage: "Words for version 2." })); await Promise.resolve(); });
    // The one open still starts from its own version.
    await waitFor(() => { expect(second.getByTestId("composer-start").textContent).toMatch(/^Starts from version 1\./u); });
    expect(second.queryByText(/Reading version/u)).toBeNull();
    // The words saved are the version now: going back finds nothing to carry on or keep.
    mocks.getLatestProposalVersion.mockResolvedValue(version(2, { clientMessage: "Words for version 2." }));
    const back = within(await openProposal());
    await waitFor(() => { expect(back.getByTestId("composer-start").textContent).toMatch(/^Starts from version 2\. You have not changed anything here yet\./u); });
    expect(back.queryByTestId("kept-version")).toBeNull();
    expect(back.getByTestId("kept-note").textContent).toBe("");
  });

  it("shows no second copy while the composer still holds a version that did not arrive, and none once it saves", async () => {
    existing = [proposal({ status: "draft", currentVersion: 0 })];
    mocks.createProposalVersion.mockRejectedValueOnce(new Error("offline")).mockImplementationOnce((_id: string, payload: Record<string, unknown>) => {
      existing = [proposal({ currentVersion: 1 })];
      // Read again, the latest version is the one just saved.
      mocks.getLatestProposalVersion.mockResolvedValue(version(1, payload));
      return Promise.resolve(version(1, payload));
    });
    render(<ProposalsDesk />);
    const panel = within(await openProposal());
    fireEvent.change(panel.getByTestId("composer-message"), { target: { value: "Planning-grade draft." } });
    fireEvent.click(panel.getByTestId("composer-save"));
    expect(await panel.findByTestId("composer-error")).toBeDefined();
    expect(panel.queryByTestId("kept-version")).toBeNull();
    expect(panel.getByTestId<HTMLTextAreaElement>("composer-message").value).toBe("Planning-grade draft.");
    fireEvent.click(panel.getByTestId("composer-save"));
    await waitFor(() => { expect(panel.getByTestId("composer-start").textContent).toBe(`Starts from version 1. You have not changed anything here yet.${UNCHECKED}`); });
    expect(panel.queryByTestId("kept-version")).toBeNull();
  });

  it("keeps no copy of a version that did not arrive while its composer holds it, even with nothing written", async () => {
    existing = [
      proposal({ status: "changes_requested", currentVersion: 1 }),
      proposal({ id: "p2", title: "Winter dinner", status: "draft", currentVersion: 1 }),
    ];
    mocks.getLatestProposalVersion.mockResolvedValue(version(1, { clientMessage: "The words of version 1." }));
    mocks.createProposalVersion.mockRejectedValue(new Error("offline"));
    render(<ProposalsDesk />);
    const panel = within(await openProposal());
    await waitFor(() => { expect(panel.getByTestId<HTMLTextAreaElement>("composer-message").value).toBe("The words of version 1."); });
    // Saved as it stands (to take a changed layout, say), and it does not arrive.
    fireEvent.click(panel.getByTestId("composer-save"));
    await panel.findByTestId("composer-error");
    expect(reloadHeld()).toBe(false);
    await openProposal("p2", "Winter dinner");
    const back = within(await openProposal());
    await waitFor(() => { expect(back.getByTestId<HTMLTextAreaElement>("composer-message").value).toBe("The words of version 1."); });
    expect(back.queryByTestId("kept-version")).toBeNull();
  });

  it("lets words go when the booker takes them out after their save did not arrive", async () => {
    existing = [
      proposal({ status: "changes_requested", currentVersion: 1 }),
      proposal({ id: "p2", title: "Winter dinner", status: "draft", currentVersion: 1 }),
    ];
    mocks.createProposalVersion.mockRejectedValue(new Error("offline"));
    render(<ProposalsDesk />);
    const panel = within(await openProposal());
    fireEvent.change(await panel.findByTestId("composer-message"), { target: { value: "Words I think better of." } });
    fireEvent.click(panel.getByTestId("composer-save"));
    await panel.findByTestId("composer-error");
    expect(reloadHeld()).toBe(true);
    fireEvent.change(panel.getByTestId("composer-message"), { target: { value: "" } });
    expect(reloadHeld()).toBe(false);
    await openProposal("p2", "Winter dinner");
    const back = within(await openProposal());
    await back.findByTestId("composer-message");
    expect(back.queryByTestId("kept-version")).toBeNull();
  });

  it("keeps no copy of a version saved as it stood when a colleague's version takes its composer before it is refused", async () => {
    existing = [proposal({ status: "changes_requested", currentVersion: 2 })];
    const current = (): number => Number(existing[0]?.["currentVersion"] ?? 2);
    mocks.getLatestProposalVersion.mockImplementation(() => Promise.resolve(version(current(), { clientMessage: `The words of version ${String(current())}.` })));
    let refuse: (error: unknown) => void = () => undefined;
    mocks.createProposalVersion.mockImplementation(() => new Promise((_resolve, reject) => { refuse = reject; }));
    render(<ProposalsDesk />);
    const panel = within(await openProposal());
    await waitFor(() => { expect(panel.getByTestId<HTMLTextAreaElement>("composer-message").value).toBe("The words of version 2."); });
    fireEvent.click(panel.getByTestId("composer-save"));
    await waitFor(() => { expect(mocks.createProposalVersion).toHaveBeenCalledTimes(1); });
    existing = [proposal({ status: "changes_requested", currentVersion: 3 })];
    act(() => { document.dispatchEvent(new Event("visibilitychange")); });
    await waitFor(() => { expect(panel.getByTestId<HTMLTextAreaElement>("composer-message").value).toBe("The words of version 3."); });
    // Refused: nothing was written, so there is nothing of the booker's to keep.
    await act(async () => { refuse(new ApiError(409, "A newer version was saved or sent after this was read.", "PROPOSAL_VERSION_CHANGED")); await Promise.resolve(); });
    expect(panel.queryByTestId("kept-version")).toBeNull();
    expect(reloadHeld()).toBe(false);
  });

  it("keeps no copy of words a stalled save sent once they saved on another try", async () => {
    existing = [proposal({ status: "changes_requested", currentVersion: 1 })];
    let refuse: (error: unknown) => void = () => undefined;
    mocks.createProposalVersion
      .mockImplementationOnce(() => new Promise((_resolve, reject) => { refuse = reject; }))
      .mockImplementationOnce((_id: string, payload: Record<string, unknown>) => {
        existing = [proposal({ status: "changes_requested", currentVersion: 2 })];
        mocks.getLatestProposalVersion.mockResolvedValue(version(2, payload));
        return Promise.resolve(version(2, payload));
      });
    render(<ProposalsDesk />);
    const panel = within(await openProposal());
    fireEvent.change(await panel.findByTestId("composer-message"), { target: { value: "My words." } });
    fireEvent.click(panel.getByTestId("composer-save"));
    await waitFor(() => { expect(mocks.createProposalVersion).toHaveBeenCalledTimes(1); });
    // The save stalls. Another part of the dashboard, back, and saved again.
    cleanup();
    render(<ProposalsDesk />);
    const back = within(await openProposal());
    expect((await back.findByTestId<HTMLTextAreaElement>("composer-message")).value).toBe("My words.");
    fireEvent.click(back.getByTestId("composer-save"));
    await waitFor(() => { expect(back.getByTestId("composer-start").textContent).toMatch(/^Starts from version 2\. You have not changed anything here yet\./u); });
    // The stalled save is refused at last: its words are version 2 already.
    await act(async () => {
      refuse(new ApiError(409, "A newer version was saved or sent after this was read.", "PROPOSAL_VERSION_CHANGED"));
      await new Promise((resolve) => { setTimeout(resolve, 0); });
    });
    expect(back.queryByTestId("kept-version")).toBeNull();
    expect(reloadHeld()).toBe(false);
  });

  it("keeps no copy of words a second try was refused for once the stalled save of them arrived", async () => {
    existing = [proposal({ status: "changes_requested", currentVersion: 1 })];
    let saved: (value: Record<string, unknown>) => void = () => undefined;
    mocks.createProposalVersion
      .mockImplementationOnce(() => new Promise((resolve) => { saved = resolve; }))
      .mockRejectedValueOnce(new ApiError(409, "A newer version was saved or sent after this was read.", "PROPOSAL_VERSION_CHANGED"));
    render(<ProposalsDesk />);
    const panel = within(await openProposal());
    fireEvent.change(await panel.findByTestId("composer-message"), { target: { value: "My words." } });
    fireEvent.click(panel.getByTestId("composer-save"));
    await waitFor(() => { expect(mocks.createProposalVersion).toHaveBeenCalledTimes(1); });
    cleanup();
    render(<ProposalsDesk />);
    const back = within(await openProposal());
    expect((await back.findByTestId<HTMLTextAreaElement>("composer-message")).value).toBe("My words.");
    // The stalled save arrives, and the booker, not yet knowing, saves again.
    existing = [proposal({ status: "changes_requested", currentVersion: 2 })];
    mocks.getLatestProposalVersion.mockResolvedValue(version(2, { clientMessage: "My words." }));
    await act(async () => {
      saved(version(2, { clientMessage: "My words." }));
      await new Promise((resolve) => { setTimeout(resolve, 0); });
    });
    fireEvent.click(back.getByTestId("composer-save"));
    await waitFor(() => { expect(back.getByTestId("composer-start").textContent).toMatch(/^Starts from version 2\./u); });
    expect(back.getByTestId<HTMLTextAreaElement>("composer-message").value).toBe("My words.");
    expect(back.queryByTestId("kept-version")).toBeNull();
    expect(reloadHeld()).toBe(false);
  });

  it("puts away only the copies there were when a save began, when it arrives after the desk was left", async () => {
    existing = [proposal({ status: "changes_requested", currentVersion: 1 })];
    let saved: (value: Record<string, unknown>) => void = () => undefined;
    mocks.createProposalVersion.mockReturnValue(new Promise((resolve) => { saved = resolve; }));
    render(<ProposalsDesk />);
    const panel = within(await openProposal());
    fireEvent.change(await panel.findByTestId("composer-message"), { target: { value: "Words for version 2." } });
    fireEvent.click(panel.getByTestId("composer-save"));
    await waitFor(() => { expect(mocks.createProposalVersion).toHaveBeenCalledTimes(1); });
    // Back while the save is on its way: more is written, then put aside.
    cleanup();
    render(<ProposalsDesk />);
    const back = within(await openProposal());
    fireEvent.change(await back.findByTestId("composer-message"), { target: { value: "Words written since." } });
    fireEvent.click(back.getByRole("button", { name: "Start again from version 1" }));
    expect(within(await back.findByTestId("kept-version")).getByText("Words written since.")).toBeDefined();
    await act(async () => {
      saved(version(2, { clientMessage: "Words for version 2." }));
      await new Promise((resolve) => { setTimeout(resolve, 0); });
    });
    expect(within(back.getByTestId("kept-version")).getByText("Words written since.")).toBeDefined();
    expect(reloadHeld()).toBe(true);
  });

  it("puts away the very words a late save saved, when the desk opened meanwhile kept them to copy", async () => {
    existing = [proposal({ status: "changes_requested", currentVersion: 1 })];
    const current = (): number => Number(existing[0]?.["currentVersion"] ?? 1);
    mocks.getLatestProposalVersion.mockImplementation(() => Promise.resolve(version(current(),
      { clientMessage: current() === 2 ? "Words for version 2." : `The words of version ${String(current())}.` })));
    let saved: (value: Record<string, unknown>) => void = () => undefined;
    mocks.createProposalVersion.mockImplementation(() => {
      // The version lands at once; its answer is slow to come back.
      existing = [proposal({ status: "changes_requested", currentVersion: 2 })];
      return new Promise((resolve) => { saved = resolve; });
    });
    render(<ProposalsDesk />);
    const panel = within(await openProposal());
    fireEvent.change(await panel.findByTestId("composer-message"), { target: { value: "Words for version 2." } });
    fireEvent.click(panel.getByTestId("composer-save"));
    await waitFor(() => { expect(mocks.createProposalVersion).toHaveBeenCalledTimes(1); });
    // Another part of the dashboard, and back: version 2 is read, and the
    // words left from version 1 are kept to copy until the save answers.
    cleanup();
    render(<ProposalsDesk />);
    const back = within(await openProposal());
    await waitFor(() => { expect(back.getByTestId("composer-start").textContent).toMatch(/^Starts from version 2\./u); });
    await act(async () => {
      saved(version(2, { clientMessage: "Words for version 2." }));
      await new Promise((resolve) => { setTimeout(resolve, 0); });
    });
    expect(back.queryByTestId("kept-version")).toBeNull();
    expect(reloadHeld()).toBe(false);
  });

  it("puts away words a late save saved even when typed again the same, once the proposal is read again", async () => {
    existing = [proposal({ status: "changes_requested", currentVersion: 1 })];
    let saved: (value: Record<string, unknown>) => void = () => undefined;
    mocks.createProposalVersion.mockReturnValue(new Promise((resolve) => { saved = resolve; }));
    render(<ProposalsDesk />);
    const panel = within(await openProposal());
    fireEvent.change(await panel.findByTestId("composer-message"), { target: { value: "Words for version 2." } });
    fireEvent.click(panel.getByTestId("composer-save"));
    await waitFor(() => { expect(mocks.createProposalVersion).toHaveBeenCalledTimes(1); });
    cleanup();
    render(<ProposalsDesk />);
    const back = within(await openProposal());
    // Changed, then put back as they were: the same words, written again.
    const message = await back.findByTestId("composer-message");
    fireEvent.change(message, { target: { value: "Words for version 2. And more." } });
    fireEvent.change(message, { target: { value: "Words for version 2." } });
    // The version lands, and coming back reads it before the save answers.
    existing = [proposal({ status: "changes_requested", currentVersion: 2 })];
    mocks.getLatestProposalVersion.mockResolvedValue(version(2, { clientMessage: "Words for version 2." }));
    act(() => { document.dispatchEvent(new Event("visibilitychange")); });
    await waitFor(() => { expect(back.getByTestId("composer-start").textContent).toMatch(/^Starts from version 2\./u); });
    await act(async () => {
      saved(version(2, { clientMessage: "Words for version 2." }));
      await new Promise((resolve) => { setTimeout(resolve, 0); });
    });
    expect(back.queryByTestId("kept-version")).toBeNull();
    expect(reloadHeld()).toBe(false);
  });

  it("lets go of words typed again the same once a late save of them answers, so a reload is not held for them", async () => {
    existing = [proposal({ status: "changes_requested", currentVersion: 1 })];
    let saved: (value: Record<string, unknown>) => void = () => undefined;
    mocks.createProposalVersion.mockReturnValue(new Promise((resolve) => { saved = resolve; }));
    render(<ProposalsDesk />);
    const panel = within(await openProposal());
    fireEvent.change(await panel.findByTestId("composer-message"), { target: { value: "Words for version 2." } });
    fireEvent.click(panel.getByTestId("composer-save"));
    await waitFor(() => { expect(mocks.createProposalVersion).toHaveBeenCalledTimes(1); });
    cleanup();
    render(<ProposalsDesk />);
    const back = within(await openProposal());
    const message = await back.findByTestId("composer-message");
    fireEvent.change(message, { target: { value: "Words for version 2. And more." } });
    fireEvent.change(message, { target: { value: "Words for version 2." } });
    expect(reloadHeld()).toBe(true);
    // The save answers before the proposal is read again.
    existing = [proposal({ status: "changes_requested", currentVersion: 2 })];
    mocks.getLatestProposalVersion.mockResolvedValue(version(2, { clientMessage: "Words for version 2." }));
    await act(async () => {
      saved(version(2, { clientMessage: "Words for version 2." }));
      await new Promise((resolve) => { setTimeout(resolve, 0); });
    });
    expect(reloadHeld()).toBe(false);
    act(() => { document.dispatchEvent(new Event("visibilitychange")); });
    await waitFor(() => { expect(back.getByTestId("composer-start").textContent).toMatch(/^Starts from version 2\./u); });
    expect(back.queryByTestId("kept-version")).toBeNull();
  });

  it("keeps the same words written over a version saved since, when a late save of them answers", async () => {
    existing = [proposal({ status: "changes_requested", currentVersion: 1 })];
    const current = (): number => Number(existing[0]?.["currentVersion"] ?? 1);
    mocks.getLatestProposalVersion.mockImplementation(() => Promise.resolve(version(current(), { clientMessage: `The words of version ${String(current())}.` })));
    let saved: (value: Record<string, unknown>) => void = () => undefined;
    mocks.createProposalVersion.mockImplementation(() => {
      // The version lands at once; its answer is slow to come back.
      existing = [proposal({ status: "changes_requested", currentVersion: 2 })];
      return new Promise((resolve) => { saved = resolve; });
    });
    render(<ProposalsDesk />);
    const panel = within(await openProposal());
    fireEvent.change(await panel.findByTestId("composer-message"), { target: { value: "Words for version 2." } });
    fireEvent.click(panel.getByTestId("composer-save"));
    await waitFor(() => { expect(mocks.createProposalVersion).toHaveBeenCalledTimes(1); });
    // Away and back, a colleague has saved version 3: the booker writes the same words over it.
    cleanup();
    existing = [proposal({ status: "changes_requested", currentVersion: 3 })];
    render(<ProposalsDesk />);
    const back = within(await openProposal());
    await waitFor(() => { expect(back.getByTestId("composer-start").textContent).toMatch(/^Starts from version 3\./u); });
    fireEvent.change(back.getByTestId("composer-message"), { target: { value: "Words for version 2." } });
    await act(async () => {
      saved(version(2, { clientMessage: "Words for version 2." }));
      await new Promise((resolve) => { setTimeout(resolve, 0); });
    });
    // Those words are not version 3's: they are still here, and carried on when the proposal is opened again.
    expect(reloadHeld()).toBe(true);
    cleanup();
    render(<ProposalsDesk />);
    const again = within(await openProposal());
    await waitFor(() => { expect(again.getByTestId<HTMLTextAreaElement>("composer-message").value).toBe("Words for version 2."); });
  });

  it("keeps words written since when a save arrives after the desk was left", async () => {
    existing = [proposal({ status: "changes_requested", currentVersion: 1 })];
    let saved: (value: Record<string, unknown>) => void = () => undefined;
    mocks.createProposalVersion.mockReturnValue(new Promise((resolve) => { saved = resolve; }));
    render(<ProposalsDesk />);
    const panel = within(await openProposal());
    fireEvent.change(await panel.findByTestId("composer-message"), { target: { value: "Words for version 2." } });
    fireEvent.click(panel.getByTestId("composer-save"));
    await waitFor(() => { expect(mocks.createProposalVersion).toHaveBeenCalledTimes(1); });
    cleanup();
    render(<ProposalsDesk />);
    const back = within(await openProposal());
    fireEvent.change(await back.findByTestId("composer-message"), { target: { value: "Words for version 2, and more written since." } });
    existing = [proposal({ status: "changes_requested", currentVersion: 2 })];
    mocks.getLatestProposalVersion.mockResolvedValue(version(2, { clientMessage: "Words for version 2." }));
    await act(async () => {
      saved(version(2, { clientMessage: "Words for version 2." }));
      await new Promise((resolve) => { setTimeout(resolve, 0); });
    });
    // Still here to lose, and kept to copy once the proposal is read again.
    expect(reloadHeld()).toBe(true);
    act(() => { document.dispatchEvent(new Event("visibilitychange")); });
    expect(within(await back.findByTestId("kept-version")).getByText("Words for version 2, and more written since.")).toBeDefined();
  });

  it("leaves focus where the booker puts it after starting again, under React's development double run", async () => {
    existing = [proposal({ status: "changes_requested", currentVersion: 1 })];
    render(<StrictMode><ProposalsDesk /></StrictMode>);
    const panel = within(await openProposal());
    fireEvent.change(await panel.findByTestId("composer-message"), { target: { value: "Words one." } });
    fireEvent.click(panel.getByRole("button", { name: "Start again from version 1" }));
    await waitFor(() => { expect(document.activeElement).toBe(panel.getByTestId("composer-message")); });
    // The booker clicks away, and coming back reads the proposal again.
    (document.activeElement as HTMLElement).blur();
    const reads = mocks.getDeskProposal.mock.calls.length;
    act(() => { document.dispatchEvent(new Event("visibilitychange")); });
    await waitFor(() => { expect(mocks.getDeskProposal.mock.calls.length).toBeGreaterThan(reads); });
    await act(async () => { await Promise.resolve(); });
    expect(document.activeElement).toBe(document.body);
  });

  it("leaves focus where the booker puts it when a read on its way closes a composer just started again, under React's development double run", async () => {
    existing = [proposal({ status: "changes_requested", currentVersion: 1 })];
    render(<StrictMode><ProposalsDesk /></StrictMode>);
    const panel = within(await openProposal());
    fireEvent.change(await panel.findByTestId("composer-message"), { target: { value: "Words one." } });
    // Coming back reads the proposal; that read is slow to answer.
    let answer: (value: Record<string, unknown>) => void = () => undefined;
    const reads = mocks.getDeskProposal.mock.calls.length;
    mocks.getDeskProposal.mockImplementation(() => new Promise((resolve) => { answer = resolve; }));
    act(() => { document.dispatchEvent(new Event("visibilitychange")); });
    await waitFor(() => { expect(mocks.getDeskProposal.mock.calls.length).toBeGreaterThan(reads); });
    fireEvent.click(panel.getByRole("button", { name: "Start again from version 1" }));
    await waitFor(() => { expect(document.activeElement).toBe(panel.getByTestId("composer-message")); });
    // The booker clicks away; the read answers that the proposal was sent meanwhile.
    (document.activeElement as HTMLElement).blur();
    await act(async () => {
      answer(proposal({ status: "sent", currentVersion: 1, sentVersion: 1, sentAt: NOW }));
      await new Promise((resolve) => { setTimeout(resolve, 0); });
    });
    await waitFor(() => { expect(panel.queryByTestId("composer")).toBeNull(); });
    await act(async () => { await Promise.resolve(); });
    expect(document.activeElement).toBe(document.body);
  });

  it("gives focus to what the next composer starts from when it goes while focus is on a copy kept beside it", async () => {
    existing = [proposal({ status: "changes_requested", currentVersion: 1 })];
    const current = (): number => Number(existing[0]?.["currentVersion"] ?? 1);
    mocks.getLatestProposalVersion.mockImplementation(() => Promise.resolve(version(current(), { clientMessage: `The words of version ${String(current())}.` })));
    render(<ProposalsDesk />);
    const panel = within(await openProposal());
    fireEvent.change(await panel.findByTestId("composer-message"), { target: { value: "Words to set aside." } });
    fireEvent.click(panel.getByRole("button", { name: "Start again from version 1" }));
    within(await panel.findByTestId("kept-version")).getByTestId("kept-version-clear").focus();
    // A colleague saves version 2, and coming back reads it: the composer the copy stands beside goes.
    existing = [proposal({ status: "changes_requested", currentVersion: 2 })];
    act(() => { document.dispatchEvent(new Event("visibilitychange")); });
    await waitFor(() => { expect(panel.getByTestId("composer-start").textContent).toMatch(/^Starts from version 2\./u); });
    await waitFor(() => { expect(document.activeElement).toBe(panel.getByTestId("composer-start")); });
    expect(within(panel.getByTestId("kept-version")).getByText("Words to set aside.")).toBeDefined();
  });

  it("does not hold up leaving the page once the booker has signed out", async () => {
    render(<ProposalsDesk />);
    const panel = within(await openProposal());
    fireEvent.change(await panel.findByTestId("composer-message"), { target: { value: "Not yet saved." } });
    expect(reloadHeld()).toBe(true);
    const signedIn = authState.user;
    try {
      // Signed out on this page first, a sign-out leaving it is not asked about.
      (authState as { user: typeof signedIn | null }).user = null;
      expect(reloadHeld()).toBe(false);
    } finally {
      authState.user = signedIn;
    }
    expect(reloadHeld()).toBe(true);
  });

  it("saves a first version without a quote, and the next then starts from it", async () => {
    mocks.createProposalVersion.mockImplementation((_id: string, payload: Record<string, unknown>) => {
      existing = [proposal({ currentVersion: 1 })];
      // Read again, the latest version is the one just saved.
      mocks.getLatestProposalVersion.mockResolvedValue(version(1, payload));
      return Promise.resolve(version(1, payload));
    });
    render(<ProposalsDesk />);
    const panel = within(await openProposal());
    expect(panel.getByTestId("composer-start").textContent).toBe("The first version.");
    fireEvent.change(panel.getByTestId("composer-message"), { target: { value: "Planning-grade draft." } });
    fireEvent.click(panel.getByTestId("composer-save"));
    await waitFor(() => { expect(mocks.createProposalVersion).toHaveBeenCalledTimes(1); });
    const payload = mocks.createProposalVersion.mock.calls[0]?.[1] as { clientMessage: string; quote: null };
    expect(payload.clientMessage).toBe("Planning-grade draft.");
    expect(payload.quote).toBeNull();
    // Written from no version, so one saved meanwhile stops it.
    expect(mocks.createProposalVersion.mock.calls[0]?.[2]).toBe(0);
    expect(mocks.createQuote).not.toHaveBeenCalled();
    await waitFor(() => { expect(panel.getByTestId("composer-start").textContent).toBe(`Starts from version 1. You have not changed anything here yet.${UNCHECKED}`); });
    expect(panel.getByTestId<HTMLTextAreaElement>("composer-message").value).toBe("Planning-grade draft.");
  });

  it("builds the quote on the server in exact pence and keeps its answer as the snapshot", async () => {
    mocks.createQuote.mockResolvedValue({
      id: "33333333-3333-4333-8333-333333333333", venueId: "v1", opportunityId: null, proposalId: "p1", enquiryId: null, spaceId: null,
      name: "Autumn gala quote", status: "draft", currency: "GBP", subtotalMinor: 12_050, totalMinor: 12_050, validUntil: null,
      supersededByQuoteId: null, notes: null, createdBy: "u1", createdAt: NOW, updatedAt: NOW, deletedAt: null,
      lineItems: [{
        id: "44444444-4444-4444-8444-444444444444", quoteId: "33333333-3333-4333-8333-333333333333", pricingRuleId: null,
        description: "Grand Hall hire", quantity: 1, unitAmountMinor: 12_050, lineTotalMinor: 12_050, sortOrder: 0,
      }],
    });
    mocks.createProposalVersion.mockResolvedValue(version(1));
    render(<ProposalsDesk />);
    const panel = within(await openProposal());
    fireEvent.click(panel.getByTestId("add-quote-line"));
    fireEvent.change(panel.getByTestId("quote-desc-0"), { target: { value: "Grand Hall hire" } });
    fireEvent.change(panel.getByTestId("quote-qty-0"), { target: { value: "1" } });
    fireEvent.change(panel.getByTestId("quote-price-0"), { target: { value: "120.50" } });
    fireEvent.click(panel.getByTestId("composer-save"));
    await waitFor(() => {
      expect(mocks.createQuote).toHaveBeenCalledWith({
        venueId: "v1", opportunityId: null, proposalId: "p1", name: "Autumn gala quote", currency: "GBP",
        lineItems: [{ description: "Grand Hall hire", quantity: 1, unitAmountMinor: 12_050 }],
      });
    });
    await waitFor(() => { expect(mocks.createProposalVersion).toHaveBeenCalledTimes(1); });
    const payload = mocks.createProposalVersion.mock.calls[0]?.[1] as { quote: { quoteId: string; subtotalMinor: number; totalMinor: number } };
    expect(payload.quote).toMatchObject({ quoteId: "33333333-3333-4333-8333-333333333333", subtotalMinor: 12_050, totalMinor: 12_050 });
  });

  it("refuses a price it cannot read, and unsupported certainty wording, before anything is kept", async () => {
    render(<ProposalsDesk />);
    const panel = within(await openProposal());
    fireEvent.click(panel.getByTestId("add-quote-line"));
    fireEvent.change(panel.getByTestId("quote-desc-0"), { target: { value: "Hire" } });
    fireEvent.change(panel.getByTestId("quote-price-0"), { target: { value: "12.345" } });
    fireEvent.click(panel.getByTestId("composer-save"));
    expect((await panel.findByTestId("composer-error")).textContent).toBe("Quote line 1 needs a price like 120 or 120.50.");

    fireEvent.click(panel.getByRole("button", { name: "Remove quote line 1" }));
    expect(panel.queryByTestId("quote-desc-0")).toBeNull();
    fireEvent.change(panel.getByTestId("composer-message"), { target: { value: "This layout is fire approved for 300 guests." } });
    fireEvent.click(panel.getByTestId("composer-save"));
    await waitFor(() => { expect(panel.getByTestId("composer-error").textContent).toContain("fire approved"); });
    expect(mocks.createQuote).not.toHaveBeenCalled();
    expect(mocks.createProposalVersion).not.toHaveBeenCalled();
  });

  it("computes capacity guidance from the room's area and puts the careful note in", async () => {
    mocks.listSpaces.mockResolvedValue([{
      id: "s1", venueId: "v1", name: "Grand Hall", slug: "grand-hall", description: "", widthM: "21", lengthM: "10", heightM: "7",
      floorPlanOutline: [], meshUrl: null, thumbnailUrl: null, sortOrder: 0, createdAt: NOW, updatedAt: NOW,
    }]);
    render(<ProposalsDesk />);
    const panel = within(await openProposal());
    // 21 m × 10 m = 210 m²; dinner rounds by default: floor(210 / 1.5) = 140.
    fireEvent.change(await panel.findByTestId("capacity-guests"), { target: { value: "120" } });
    const result = panel.getByTestId("capacity-result");
    expect(result.textContent).toContain("around 140 guests");
    expect(result.textContent).toContain("120 asked for");
    expect(result.textContent).toContain("Planning estimate only");
    fireEvent.click(panel.getByTestId("capacity-insert"));
    const note = panel.getByTestId<HTMLInputElement>("composer-capacity");
    expect(note.value).toContain("Grand Hall: comfortable for around 140 guests");
    expect(note.value).toContain("final capacity confirmed by the venue team");
  });

  it("holds capacity guidance still while a save is on its way, so nothing is put in that the version would not keep", async () => {
    existing = [proposal({ status: "changes_requested", currentVersion: 1 })];
    mocks.listSpaces.mockResolvedValue([{
      id: "s1", venueId: "v1", name: "Grand Hall", slug: "grand-hall", description: "", widthM: "21", lengthM: "10", heightM: "7",
      floorPlanOutline: [], meshUrl: null, thumbnailUrl: null, sortOrder: 0, createdAt: NOW, updatedAt: NOW,
    }]);
    let saved: (value: Record<string, unknown>) => void = () => undefined;
    mocks.createProposalVersion.mockReturnValue(new Promise((resolve) => { saved = resolve; }));
    render(<ProposalsDesk />);
    const panel = within(await openProposal());
    fireEvent.change(await panel.findByTestId("capacity-guests"), { target: { value: "120" } });
    fireEvent.change(panel.getByTestId("composer-message"), { target: { value: "Words for version 2." } });
    fireEvent.click(panel.getByTestId("composer-save"));
    await waitFor(() => { expect(panel.getByTestId<HTMLButtonElement>("capacity-insert").disabled).toBe(true); });
    for (const id of ["capacity-space", "capacity-guests", "capacity-style"]) {
      expect(panel.getByTestId<HTMLInputElement | HTMLSelectElement>(id).disabled).toBe(true);
    }
    await act(async () => { saved(version(2, { clientMessage: "Words for version 2." })); await Promise.resolve(); });
    await waitFor(() => { expect(panel.getByTestId<HTMLButtonElement>("capacity-insert").disabled).toBe(false); });
  });

  it("keeps capacity guidance out of sight when the rooms cannot be read", async () => {
    mocks.listSpaces.mockRejectedValue(new Error("offline"));
    render(<ProposalsDesk />);
    const panel = within(await openProposal());
    await panel.findByTestId("composer-save");
    await waitFor(() => { expect(panel.queryByText("Reading the rooms for guidance…")).toBeNull(); });
    expect(panel.queryByTestId("capacity-space")).toBeNull();
  });
});

describe("the conversation and the history", () => {
  it("shows the client's words and posts a reply to the proposal it was written for", async () => {
    existing = [proposal(), proposal({ id: "p2", title: "Winter dinner" })];
    mocks.getProposalComments.mockResolvedValue([clientComment()]);
    let settle: ((value: unknown) => void) | undefined;
    const posting = new Promise<unknown>((resolve) => { settle = resolve; });
    mocks.postProposalComment.mockReturnValue(posting);
    render(<ProposalsDesk />);
    const panel = within(await openProposal());
    expect(await panel.findByTestId("comment-client")).toBeDefined();
    fireEvent.change(panel.getByTestId("reply-input"), { target: { value: "Thanks Elaine, we will look at the timing." } });
    fireEvent.click(panel.getByTestId("reply-submit"));
    await waitFor(() => { expect(mocks.postProposalComment).toHaveBeenCalledWith("p1", "Thanks Elaine, we will look at the timing."); });
    // Another proposal opened while it posts: the reply stays the first one's.
    await openProposal("p2", "Winter dinner");
    await act(async () => { settle?.(clientComment({ id: "c2", authorType: "staff" })); await posting; });
    expect(mocks.postProposalComment).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("says a step's words aloud again when they are the same", async () => {
    mocks.postProposalComment.mockResolvedValue(clientComment({ id: "c2", authorType: "staff" }));
    render(<ProposalsDesk />);
    const panel = within(await openProposal());
    const said = (): HTMLElement | undefined => panel.getAllByRole("status").find((region) => region.textContent === "The reply is posted.");
    fireEvent.change(panel.getByTestId("reply-input"), { target: { value: "Thank you, Elaine." } });
    fireEvent.click(panel.getByTestId("reply-submit"));
    await waitFor(() => { expect(said()).toBeDefined(); });
    const region = said() as HTMLElement;
    const first = region.firstElementChild;
    fireEvent.change(panel.getByTestId("reply-input"), { target: { value: "One more thing." } });
    fireEvent.click(panel.getByTestId("reply-submit"));
    await waitFor(() => { expect(mocks.postProposalComment).toHaveBeenCalledTimes(2); });
    // The same words, said afresh: a new node in the status region, which a screen reader hears.
    await waitFor(() => { expect(region.firstElementChild).not.toBe(first); });
    expect(region.textContent).toBe("The reply is posted.");
  });

  it("refuses unsupported certainty wording in a reply", async () => {
    render(<ProposalsDesk />);
    const panel = within(await openProposal());
    fireEvent.change(panel.getByTestId("reply-input"), { target: { value: "This layout is certified safe for the event." } });
    fireEvent.click(panel.getByTestId("reply-submit"));
    expect((await panel.findByTestId("reply-error")).textContent).toContain("certified safe");
    expect(mocks.postProposalComment).not.toHaveBeenCalled();
    expect(panel.getByTestId<HTMLTextAreaElement>("reply-input").value).toBe("This layout is certified safe for the event.");
  });

  it("offers another try when the conversation or the history cannot be read", async () => {
    mocks.getProposalComments.mockRejectedValueOnce(new Error("offline")).mockResolvedValueOnce([clientComment({ body: "Read the second time." })]);
    mocks.getProposalHistory.mockRejectedValueOnce(new Error("offline")).mockResolvedValueOnce([historyEntry()]);
    render(<ProposalsDesk />);
    const panel = within(await openProposal());
    expect((await panel.findByTestId("conversation-load-error")).textContent).toContain("Couldn't load the client conversation");
    fireEvent.click(panel.getByRole("button", { name: "Retry conversation" }));
    expect(await panel.findByText("Read the second time.")).toBeDefined();
    expect((await panel.findByTestId("history-load-error")).textContent).toContain("Couldn't load this proposal's status history");
    fireEvent.click(panel.getByRole("button", { name: "Retry history" }));
    expect(await panel.findByText("Sent to the client.")).toBeDefined();
    expect(panel.getByText("Shared with the client")).toBeDefined();
    expect(panel.getByText("The proposal was started.")).toBeDefined();
  });
});

describe("a new proposal", () => {
  it("starts one for the staff member's venue and opens it, and keeps a failure in the form", async () => {
    mocks.createProposal.mockImplementationOnce(() => {
      existing = [proposal({ id: "p7", title: "Winter ball" }), ...existing];
      return Promise.resolve(existing[0]);
    }).mockRejectedValueOnce(new Error("duplicate"));
    render(<ProposalsDesk />);
    await screen.findByTestId("proposal-row-p1");
    fireEvent.click(screen.getByRole("button", { name: "New proposal" }));
    fireEvent.change(screen.getByTestId("create-title"), { target: { value: "Winter ball" } });
    fireEvent.click(screen.getByTestId("create-submit"));
    await waitFor(() => { expect(mocks.createProposal).toHaveBeenCalledWith({ venueId: "v1", title: "Winter ball" }); });
    expect(await screen.findByRole("heading", { level: 2, name: "Winter ball" })).toBeDefined();

    fireEvent.click(screen.getByRole("button", { name: "New proposal" }));
    fireEvent.change(screen.getByTestId("create-title"), { target: { value: "Winter ball" } });
    fireEvent.click(screen.getByTestId("create-submit"));
    expect((await screen.findByTestId("create-error")).textContent).toBe("The proposal was not started. Check the title and try again.");
  });

  it("says when the account has no venue to start one at", async () => {
    authState.user = { ...authState.user, venueId: null };
    render(<ProposalsDesk />);
    await screen.findByTestId("proposal-row-p1");
    fireEvent.click(screen.getByRole("button", { name: "New proposal" }));
    expect(screen.getByText("Your account is not linked to a venue, so a proposal cannot be started here.")).toBeDefined();
  });
});
