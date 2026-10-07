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
  changeProposalLayout: vi.fn(),
  listSpaces: vi.fn(),
  listPricingRules: vi.fn(),
  listProposalTemplates: vi.fn(),
  createProposalTemplate: vi.fn(),
  replaceProposalTemplate: vi.fn(),
  removeProposalTemplate: vi.fn(),
  restoreProposalTemplate: vi.fn(),
  getProposalEvent: vi.fn(),
  draftProposalMessage: vi.fn(),
  markAIDraftsUnavailable: vi.fn(),
}));

/** Whether an AI drafting provider is configured; by default, as where none is. */
const ai = vi.hoisted(() => ({ available: false as boolean | undefined }));

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
  changeProposalLayout: mocks.changeProposalLayout,
}));
vi.mock("../../../api/spaces.js", () => ({ listSpaces: mocks.listSpaces }));
vi.mock("../../../api/ai-assistant.js", async (importOriginal) => ({
  ...await importOriginal<typeof import("../../../api/ai-assistant.js")>(),
  draftProposalMessage: mocks.draftProposalMessage,
}));
vi.mock("../../../hooks/use-ai-drafts-available.js", () => ({
  useAIDraftsAvailable: (): boolean | undefined => ai.available,
  markAIDraftsUnavailable: mocks.markAIDraftsUnavailable,
}));
vi.mock("../../../api/pricing.js", async (importOriginal) => ({
  ...await importOriginal<typeof import("../../../api/pricing.js")>(),
  listPricingRules: mocks.listPricingRules,
}));
vi.mock("../../../api/proposal-templates.js", () => ({
  listProposalTemplates: mocks.listProposalTemplates,
  createProposalTemplate: mocks.createProposalTemplate,
  replaceProposalTemplate: mocks.replaceProposalTemplate,
  removeProposalTemplate: mocks.removeProposalTemplate,
  restoreProposalTemplate: mocks.restoreProposalTemplate,
  getProposalEvent: mocks.getProposalEvent,
}));

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
  ai.available = false;
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
  mocks.listPricingRules.mockResolvedValue([]);
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

  // A10 (Blake, 29 September 2026): the client's own layout goes with a
  // proposal, and staff may leave it out, or include it again.
  const THEIRS = { enquiryLayoutId: "layout-1", enquiryLayoutRoomName: "Grand Hall" };
  function carrying(configurationId: string | null, overrides: Record<string, unknown> = {}): Record<string, unknown> {
    return proposal({
      status: "changes_requested", currentVersion: 2, configurationId, layoutRoomName: configurationId === null ? null : "Grand Hall",
      layoutFromEnquiry: configurationId !== null, ...THEIRS, ...overrides,
    });
  }
  const said = (panel: { readonly getAllByRole: (role: "status") => HTMLElement[] }, words: string): HTMLElement | undefined =>
    panel.getAllByRole("status").find((region) => region.textContent === words);
  const FACTS = { eventDate: "2026-11-20", guestCount: 120, occasion: "wedding", roomName: "Grand Hall", roomSlug: "grand-hall" };

  it("leaves their layout out of the versions saved from now, includes it by naming it, and checks the next version again each time", async () => {
    existing = [carrying("layout-1")];
    mocks.getProposalNextVersion.mockResolvedValue({ basedOn: 2, layout: "same", facts: { saved: FACTS, now: FACTS }, basis: "b".repeat(64) });
    mocks.changeProposalLayout.mockImplementation((_id: string, configurationId: string | null) => {
      existing = [carrying(configurationId)];
      return Promise.resolve(existing[0]);
    });
    render(<ProposalsDesk />);
    const panel = within(await openProposal());
    expect((await panel.findByTestId("proposal-layout")).textContent).toBe("Their own, Grand Hall");
    await waitFor(() => { expect(mocks.getProposalNextVersion).toHaveBeenCalledTimes(1); });
    const lists = mocks.listProposalDesk.mock.calls.length;

    fireEvent.click(panel.getByTestId("layout-choice"));
    await waitFor(() => { expect(said(panel, "Their Grand Hall layout is left out of the versions you save from now.")).toBeDefined(); });
    // Only while it stands where the screen shows it.
    expect(mocks.changeProposalLayout).toHaveBeenCalledWith("p1", null, "changes_requested");
    await waitFor(() => { expect(panel.getByTestId("proposal-layout").textContent).toBe("None"); });
    expect(panel.getByTestId("layout-choice").textContent).toBe("Include their Grand Hall layout");
    await waitFor(() => { expect(mocks.getProposalNextVersion).toHaveBeenCalledTimes(2); });
    // The ledger is read again, so its row says when it changed.
    await waitFor(() => { expect(mocks.listProposalDesk.mock.calls.length).toBeGreaterThan(lists); });

    fireEvent.click(panel.getByTestId("layout-choice"));
    await waitFor(() => { expect(said(panel, "Their Grand Hall layout goes with the versions you save from now.")).toBeDefined(); });
    expect(mocks.changeProposalLayout).toHaveBeenLastCalledWith("p1", "layout-1", "changes_requested");
    await waitFor(() => { expect(panel.getByTestId("proposal-layout").textContent).toBe("Their own, Grand Hall"); });
    expect(panel.getByTestId("layout-choice").textContent).toBe("Leave their layout out");
    await waitFor(() => { expect(mocks.getProposalNextVersion).toHaveBeenCalledTimes(3); });
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("shows the answer at once, before the proposal is read again", async () => {
    existing = [carrying("layout-1")];
    mocks.changeProposalLayout.mockImplementation((_id: string, configurationId: string | null) => Promise.resolve(carrying(configurationId)));
    render(<ProposalsDesk />);
    const panel = within(await openProposal());
    await panel.findByTestId("layout-choice");
    // The read that follows never answers.
    mocks.getDeskProposal.mockReturnValue(new Promise(() => undefined));
    fireEvent.click(panel.getByTestId("layout-choice"));
    await waitFor(() => { expect(panel.getByTestId("proposal-layout").textContent).toBe("None"); });
    expect(panel.getByTestId("layout-choice").textContent).toBe("Include their Grand Hall layout");
  });

  it("keeps focus on the control while it works and as its words change", async () => {
    existing = [carrying("layout-1")];
    let answer: (value: unknown) => void = () => undefined;
    mocks.changeProposalLayout.mockReturnValue(new Promise((resolve) => { answer = resolve; }));
    render(<ProposalsDesk />);
    const panel = within(await openProposal());
    const control = await panel.findByTestId<HTMLButtonElement>("layout-choice");
    control.focus();
    fireEvent.click(control);
    // Unavailable while it works, but never disabled, so focus stays on it.
    expect(control.textContent).toBe("Leaving their layout out…");
    expect(control.getAttribute("aria-disabled")).toBe("true");
    expect(control.getAttribute("aria-busy")).toBe("true");
    expect(control.disabled).toBe(false);
    expect(document.activeElement).toBe(control);
    // Pressed again while it works, nothing more is sent.
    fireEvent.click(control);
    expect(mocks.changeProposalLayout).toHaveBeenCalledTimes(1);
    existing = [carrying(null)];
    await act(async () => { answer(carrying(null)); await Promise.resolve(); });
    await waitFor(() => { expect(control.textContent).toBe("Include their Grand Hall layout"); });
    expect(panel.getByTestId("layout-choice")).toBe(control);
    expect(control.getAttribute("aria-disabled")).toBe("false");
    expect(document.activeElement).toBe(control);
  });

  it("says when the version Send shares still shows their layout once it is left out, as the check finds it", async () => {
    existing = [carrying("layout-1")];
    // Version 2 was saved with their drawing: the check finds it removed while the layout is left out.
    mocks.getProposalNextVersion.mockImplementation(() => Promise.resolve({ basedOn: 2, facts: { saved: FACTS, now: FACTS }, basis: "b".repeat(64),
      layout: existing[0]?.["configurationId"] === null ? "removed" : "same" }));
    mocks.changeProposalLayout.mockImplementation((_id: string, configurationId: string | null) => {
      existing = [carrying(configurationId)];
      return Promise.resolve(existing[0]);
    });
    render(<ProposalsDesk />);
    const panel = within(await openProposal());
    await panel.findByTestId("layout-choice");
    await waitFor(() => { expect(mocks.getProposalNextVersion).toHaveBeenCalledTimes(1); });
    expect(panel.queryByTestId("layout-saved")).toBeNull();
    fireEvent.click(panel.getByTestId("layout-choice"));
    expect((await panel.findByTestId("layout-saved")).textContent)
      .toBe("Version 2, the one Send shares, still shows their layout. Save version 3 to send it without.");
    // Included again, the saved version and the next agree.
    fireEvent.click(panel.getByTestId("layout-choice"));
    await waitFor(() => { expect(panel.queryByTestId("layout-saved")).toBeNull(); });
  });

  it("says nothing of the saved version when the client would see no difference, as their layout has nothing placed", async () => {
    existing = [carrying("layout-1")];
    mocks.getProposalNextVersion.mockResolvedValue({ basedOn: 2, facts: { saved: FACTS, now: FACTS }, basis: "b".repeat(64), layout: "none" });
    mocks.changeProposalLayout.mockImplementation((_id: string, configurationId: string | null) => {
      existing = [carrying(configurationId)];
      return Promise.resolve(existing[0]);
    });
    render(<ProposalsDesk />);
    const panel = within(await openProposal());
    fireEvent.click(await panel.findByTestId("layout-choice"));
    await waitFor(() => { expect(panel.getByTestId("layout-choice").textContent).toBe("Include their Grand Hall layout"); });
    await waitFor(() => { expect(mocks.getProposalNextVersion).toHaveBeenCalledTimes(2); });
    expect(panel.queryByTestId("layout-saved")).toBeNull();
  });

  it("says the proposal is as it was when the change is refused, and shows it as it is", async () => {
    existing = [carrying("layout-1")];
    mocks.changeProposalLayout.mockRejectedValue(new ApiError(422, "Validation failed", "VALIDATION_ERROR"));
    render(<ProposalsDesk />);
    const panel = within(await openProposal());
    const reads = mocks.getDeskProposal.mock.calls.length;
    fireEvent.click(await panel.findByTestId("layout-choice"));
    expect((await panel.findByRole("alert")).textContent).toBe("The layout did not change. The proposal is as it was.");
    await waitFor(() => { expect(mocks.getDeskProposal.mock.calls.length).toBeGreaterThan(reads); });
    expect(panel.getByTestId("proposal-layout").textContent).toBe("Their own, Grand Hall");
    const again = panel.getByTestId<HTMLButtonElement>("layout-choice");
    expect(again.textContent).toBe("Leave their layout out");
    expect(again.getAttribute("aria-disabled")).toBe("false");
  });

  it("does not claim nothing changed when the answer is lost, and reads the proposal again", async () => {
    existing = [carrying("layout-1")];
    mocks.changeProposalLayout.mockImplementation(() => {
      // It landed, and the answer never came back.
      existing = [carrying(null)];
      return Promise.reject(new ApiError(0, "Network error — check your connection", "NETWORK_ERROR"));
    });
    render(<ProposalsDesk />);
    const panel = within(await openProposal());
    fireEvent.click(await panel.findByTestId("layout-choice"));
    expect((await panel.findByRole("alert")).textContent).toBe("The change could not be confirmed. The layout shown is as last read.");
    await waitFor(() => { expect(panel.getByTestId("proposal-layout").textContent).toBe("None"); });
    expect(panel.getByTestId("layout-choice").textContent).toBe("Include their Grand Hall layout");
  });

  it("shows the proposal as it is when their layout went before it could be put back, keeping focus on what is said", async () => {
    existing = [carrying(null)];
    mocks.changeProposalLayout.mockImplementation(() => {
      // Their layout was removed a moment before the booker's press arrived.
      existing = [carrying(null, { enquiryLayoutId: null, enquiryLayoutRoomName: null })];
      return Promise.reject(new ApiError(404, "Configuration not found", "NOT_FOUND"));
    });
    render(<ProposalsDesk />);
    const panel = within(await openProposal());
    const control = await panel.findByTestId("layout-choice");
    control.focus();
    fireEvent.click(control);
    expect((await panel.findByRole("alert")).textContent).toBe("The layout did not change. The proposal is as it was.");
    await waitFor(() => { expect(panel.queryByTestId("layout-choice")).toBeNull(); });
    expect(panel.getByTestId("proposal-layout").textContent).toBe("None");
    // Focus goes to what is said where the control was.
    await waitFor(() => { expect(document.activeElement).toBe(panel.getByRole("alert").closest("dd")); });
  });

  it("says the proposal moved first, and shows where it stands, when it was sent before the change arrived", async () => {
    existing = [carrying("layout-1")];
    mocks.changeProposalLayout.mockImplementation(() => {
      // A colleague sent it a moment before.
      existing = [carrying("layout-1", { status: "sent", currentVersion: 2, sentAt: "2026-10-02T09:59:00.000Z" })];
      return Promise.reject(new ApiError(409, "The proposal changed", "PROPOSAL_STATUS_CHANGED"));
    });
    render(<ProposalsDesk />);
    const panel = within(await openProposal());
    fireEvent.click(await panel.findByTestId("layout-choice"));
    expect((await panel.findByRole("alert")).textContent)
      .toBe("It changed before that arrived, so the layout did not change. It now shows where it stands.");
    expect(await panel.findByText("With the client", { selector: ".enq-chip" })).toBeDefined();
    expect(panel.queryByTestId("layout-choice")).toBeNull();
  });

  it("offers nothing once it is with the client, for a layout not theirs, or for one the API does not name", async () => {
    existing = [
      carrying("layout-1", { status: "sent", sentAt: "2026-10-01T09:00:00.000Z" }),
      carrying("layout-2", { id: "p2", title: "Burns supper", layoutFromEnquiry: false }),
      // Removed, or its links disagreeing with its deal: the API names no layout of theirs.
      carrying("layout-1", { id: "p3", title: "Hogmanay", layoutRoomName: null, enquiryLayoutId: null, enquiryLayoutRoomName: null }),
    ];
    render(<ProposalsDesk />);
    const sent = within(await openProposal());
    expect((await sent.findByTestId("proposal-layout")).textContent).toBe("Their own, Grand Hall");
    expect(sent.queryByTestId("layout-choice")).toBeNull();
    const other = within(await openProposal("p2", "Burns supper"));
    expect((await other.findByTestId("proposal-layout")).textContent).toBe("Grand Hall");
    expect(other.queryByTestId("layout-choice")).toBeNull();
    const removed = within(await openProposal("p3", "Hogmanay"));
    expect((await removed.findByTestId("proposal-layout")).textContent).toBe("Removed");
    expect(removed.queryByTestId("layout-choice")).toBeNull();
    expect(mocks.changeProposalLayout).not.toHaveBeenCalled();
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

  it("names who wrote each message as it was recorded, never by the name the client typed", async () => {
    mocks.getProposalComments.mockResolvedValue([
      clientComment({ id: "signed-as-venue", authorName: "Venue team", body: "Please hold the date for us." }),
      clientComment({ id: "unsigned", authorName: "", body: "And a later finish?" }),
      clientComment({ id: "reply", authorType: "staff", authorName: "Venue team", body: "We will hold it until Friday." }),
    ]);
    render(<ProposalsDesk />);
    const panel = within(await openProposal());
    const thread = within(await panel.findByTestId("conversation-thread"));
    const who = (body: string): string | null | undefined => thread.getByText(body).closest("li")?.querySelector("strong")?.textContent;
    expect(who("Please hold the date for us.")).toBe("Venue team (client)");
    expect(who("And a later finish?")).toBe("The client");
    expect(who("We will hold it until Friday.")).toBe("The venue team");
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

// ---------------------------------------------------------------------------
// Add from price list (roadmap X1): a price picked is a line, priced for the
// event, with nothing retyped; the booker gives only what the list cannot know.
// ---------------------------------------------------------------------------

describe("Add from price list", () => {
  const room = (id: string, name: string, slug: string): Record<string, unknown> => ({
    id, venueId: "v1", name, slug, widthM: "30", lengthM: "15", heightM: "10", floorPlanOutline: [],
  });
  const price = (id: string, overrides: Record<string, unknown> = {}): Record<string, unknown> => ({
    id, venueId: "v1", spaceId: "room-gh", name: "Grand Hall — Evening Event (19:00–00:30)", type: "flat_rate", amount: "2400.00",
    currency: "GBP", minHours: null, minGuests: null, tiers: null, dayOfWeekModifiers: null, seasonalModifiers: null,
    isActive: true, validFrom: null, validTo: null, ...overrides,
  });
  const PRICES = [
    price("gh-evening"),
    price("venue", { spaceId: null, name: "Exclusive Use of Full Venue", amount: "2500" }),
    price("saloon", { spaceId: "room-sal", name: "Saloon — Evening Event (19:00–00:30)", amount: "900" }),
    price("bar", { spaceId: null, name: "Bar staff", type: "per_hour", amount: "18.00", minHours: 4 }),
  ];
  const FACTS = { eventDate: "2026-11-20", guestCount: 120, occasion: "wedding", roomName: "Grand Hall", roomSlug: "grand-hall" };
  const said = (panel: { readonly getAllByRole: (role: "status") => HTMLElement[] }, words: string): HTMLElement | undefined =>
    panel.getAllByRole("status").find((region) => region.textContent === words);
  const headings = (list: HTMLElement): string[] => Array.from(list.querySelectorAll(".pr-prices__heading")).map((node) => node.textContent ?? "");

  beforeEach(() => {
    existing = [proposal({ currentVersion: 1 })];
    mocks.listSpaces.mockResolvedValue([room("room-gh", "Grand Hall", "grand-hall"), room("room-sal", "Saloon", "saloon")]);
    mocks.listPricingRules.mockResolvedValue(PRICES);
    mocks.getProposalNextVersion.mockResolvedValue({ basedOn: 1, layout: "none", facts: { saved: FACTS, now: FACTS }, basis: "b".repeat(64) });
  });

  it("adds the event's room's price as a line, says so, keeps the list open for another, and saves them as typed lines", async () => {
    let saved: (value: unknown) => void = () => undefined;
    mocks.createQuote.mockImplementation((input: { readonly lineItems: readonly { description: string; quantity: number; unitAmountMinor: number }[] }) => {
      const lineItems = input.lineItems.map((line, index) => ({ ...line, id: `line-${String(index)}`, quoteId: "q1", pricingRuleId: null,
        lineTotalMinor: line.quantity * line.unitAmountMinor, sortOrder: index }));
      const total = lineItems.reduce((sum, line) => sum + line.lineTotalMinor, 0);
      return Promise.resolve({ id: "33333333-3333-4333-8333-333333333333", venueId: "v1", opportunityId: null, proposalId: "p1", enquiryId: null,
        spaceId: null, name: "Autumn gala quote", status: "draft", currency: "GBP", subtotalMinor: total, totalMinor: total, validUntil: null,
        supersededByQuoteId: null, notes: null, createdBy: "u1", createdAt: NOW, updatedAt: NOW, deletedAt: null, lineItems });
    });
    mocks.createProposalVersion.mockReturnValue(new Promise((resolve) => { saved = resolve; }));
    render(<ProposalsDesk />);
    const panel = within(await openProposal());
    const toggle = await panel.findByTestId("price-list-toggle");
    expect(toggle.getAttribute("aria-expanded")).toBe("false");
    fireEvent.click(toggle);
    expect(toggle.getAttribute("aria-expanded")).toBe("true");
    const listElement = await panel.findByTestId("price-list");
    const list = within(listElement);
    // The event's room first, then what any room takes; the other rooms wait.
    await waitFor(() => { expect(headings(listElement)).toEqual(["Grand Hall", "Venue-wide"]); });
    expect(list.queryByTestId("price-saloon")).toBeNull();
    expect(list.getByTestId("price-gh-evening").textContent).toBe("Grand Hall — Evening Event (19:00–00:30)£2,400");

    fireEvent.click(list.getByTestId("price-gh-evening"));
    expect(panel.getByTestId<HTMLInputElement>("quote-desc-0").value).toBe("Grand Hall — Evening Event (19:00–00:30)");
    expect(panel.getByTestId<HTMLInputElement>("quote-qty-0").value).toBe("1");
    expect(panel.getByTestId<HTMLInputElement>("quote-price-0").value).toBe("2400");
    expect(said(panel, "Added Grand Hall — Evening Event (19:00–00:30) at £2,400 as line 1.")).toBeDefined();
    fireEvent.click(list.getByTestId("price-venue"));
    expect(panel.getByTestId<HTMLInputElement>("quote-desc-1").value).toBe("Exclusive Use of Full Venue");
    expect(said(panel, "Added Exclusive Use of Full Venue at £2,500 as line 2.")).toBeDefined();
    expect(panel.getByTestId("price-list")).toBe(listElement);

    fireEvent.click(panel.getByTestId("composer-save"));
    await waitFor(() => { expect(mocks.createProposalVersion).toHaveBeenCalled(); });
    expect(mocks.createQuote).toHaveBeenCalledWith(expect.objectContaining({ lineItems: [
      { description: "Grand Hall — Evening Event (19:00–00:30)", quantity: 1, unitAmountMinor: 240_000 },
      { description: "Exclusive Use of Full Venue", quantity: 1, unitAmountMinor: 250_000 },
    ] }));
    // Nothing is picked while the version saves.
    expect(list.getByTestId<HTMLButtonElement>("price-venue").disabled).toBe(true);
    expect(panel.getByTestId<HTMLButtonElement>("price-list-toggle").disabled).toBe(true);
    await act(async () => { saved(version(2)); await Promise.resolve(); });
  });

  it("hands focus to the hours of a price an hour, which the proposal does not hold", async () => {
    render(<ProposalsDesk />);
    const panel = within(await openProposal());
    fireEvent.click(await panel.findByTestId("price-list-toggle"));
    fireEvent.click(await panel.findByTestId("price-bar"));
    expect(panel.getByTestId<HTMLInputElement>("quote-qty-0").value).toBe("4");
    expect(panel.getByTestId<HTMLInputElement>("quote-price-0").value).toBe("18");
    await waitFor(() => { expect(document.activeElement).toBe(panel.getByTestId("quote-qty-0")); });
    expect(said(panel, "Added Bar staff at £18 an hour as line 1. Enter the hours.")).toBeDefined();
  });

  it("keeps other rooms' prices behind a button, and shows every room's when the event's room is not known", async () => {
    render(<ProposalsDesk />);
    const panel = within(await openProposal());
    fireEvent.click(await panel.findByTestId("price-list-toggle"));
    const listElement = await panel.findByTestId("price-list");
    await waitFor(() => { expect(headings(listElement)).toEqual(["Grand Hall", "Venue-wide"]); });
    const others = panel.getByTestId("price-list-other-rooms");
    expect(others.getAttribute("aria-expanded")).toBe("false");
    fireEvent.click(others);
    expect(others.getAttribute("aria-expanded")).toBe("true");
    expect(headings(listElement)).toEqual(["Grand Hall", "Venue-wide", "Saloon"]);
    expect(panel.getByTestId("price-saloon").textContent).toBe("Saloon — Evening Event (19:00–00:30)£900");
    cleanup();

    // No check yet, so no room: every room's prices, and the proposal's own date and guests.
    mocks.getProposalNextVersion.mockRejectedValue(new ApiError(404, "Not found", "NOT_FOUND"));
    render(<ProposalsDesk />);
    const unplaced = within(await openProposal());
    fireEvent.click(await unplaced.findByTestId("price-list-toggle"));
    const allRooms = await unplaced.findByTestId("price-list");
    await waitFor(() => { expect(headings(allRooms)).toEqual(["Venue-wide", "Grand Hall", "Saloon"]); });
    expect(unplaced.queryByTestId("price-list-other-rooms")).toBeNull();
  });

  it("reads the list each time it opens, says when it could not, and tries again", async () => {
    mocks.listPricingRules.mockReset().mockRejectedValueOnce(new ApiError(0, "Network error", "NETWORK_ERROR"))
      .mockRejectedValueOnce(new ApiError(0, "Network error", "NETWORK_ERROR")).mockResolvedValue(PRICES);
    render(<ProposalsDesk />);
    const panel = within(await openProposal());
    const toggle = await panel.findByTestId("price-list-toggle");
    fireEvent.click(toggle);
    expect((await panel.findByTestId("price-list-error")).textContent).toBe("The price list could not be read.");
    // Closed and opened again after a failure, it reads again.
    fireEvent.click(panel.getByTestId("price-list-done"));
    fireEvent.click(toggle);
    await waitFor(() => { expect(mocks.listPricingRules).toHaveBeenCalledTimes(2); });
    await panel.findByTestId("price-list-error");
    fireEvent.click(panel.getByTestId("price-list-retry"));
    await panel.findByTestId("price-gh-evening");
    expect(mocks.listPricingRules).toHaveBeenCalledTimes(3);
    expect(mocks.listPricingRules).toHaveBeenLastCalledWith("v1");
    fireEvent.click(panel.getByTestId("price-list-done"));
    expect(panel.queryByTestId("price-list")).toBeNull();
    expect(document.activeElement).toBe(toggle);
    fireEvent.click(toggle);
    await panel.findByTestId("price-gh-evening");
    expect(mocks.listPricingRules).toHaveBeenCalledTimes(4);
  });

  it("adds the price as it stands when the list is opened again", async () => {
    render(<ProposalsDesk />);
    const panel = within(await openProposal());
    const toggle = await panel.findByTestId("price-list-toggle");
    fireEvent.click(toggle);
    expect((await panel.findByTestId("price-gh-evening")).textContent).toContain("£2,400");
    fireEvent.click(panel.getByTestId("price-list-done"));
    // A manager changes the price meanwhile.
    mocks.listPricingRules.mockResolvedValue([price("gh-evening", { amount: "2600.00" })]);
    fireEvent.click(toggle);
    await waitFor(() => { expect(panel.getByTestId("price-gh-evening").textContent).toContain("£2,600"); });
    fireEvent.click(panel.getByTestId("price-gh-evening"));
    expect(panel.getByTestId<HTMLInputElement>("quote-price-0").value).toBe("2600");
  });

  it("says when the price list is empty, and what it leaves out and why", async () => {
    mocks.listPricingRules.mockResolvedValue([]);
    render(<ProposalsDesk />);
    const panel = within(await openProposal());
    fireEvent.click(await panel.findByTestId("price-list-toggle"));
    expect((await panel.findByTestId("price-list-empty")).textContent).toBe("The venue's price list is empty.");
    cleanup();

    mocks.listPricingRules.mockResolvedValue([price("euro", { name: "Euro hire", currency: "EUR" })]);
    render(<ProposalsDesk />);
    const other = within(await openProposal());
    fireEvent.click(await other.findByTestId("price-list-toggle"));
    expect((await other.findByTestId("price-list-left-out")).textContent).toBe("Priced in another currency, and the quote is in pounds: Euro hire.");
    expect(other.queryByTestId("price-list-empty")).toBeNull();
  });

  it("closes on Escape from its button too, and only then leaves Escape to the proposal", async () => {
    render(<ProposalsDesk />);
    const panel = within(await openProposal());
    const toggle = await panel.findByTestId("price-list-toggle");
    fireEvent.click(toggle);
    await panel.findByTestId("price-gh-evening");
    toggle.focus();
    fireEvent.keyDown(toggle, { key: "Escape" });
    expect(panel.queryByTestId("price-list")).toBeNull();
    expect(toggle.getAttribute("aria-expanded")).toBe("false");
    expect(document.activeElement).toBe(toggle);
    expect(screen.getByRole("heading", { level: 2, name: "Autumn gala" })).toBeDefined();
    // With the list closed, Escape is the proposal's, as from any other button.
    fireEvent.keyDown(toggle, { key: "Escape" });
    await waitFor(() => { expect(screen.queryByRole("heading", { level: 2, name: "Autumn gala" })).toBeNull(); });
  });

  it("closes on Escape without closing the proposal, and gives focus back to its button", async () => {
    render(<ProposalsDesk />);
    const panel = within(await openProposal());
    const toggle = await panel.findByTestId("price-list-toggle");
    fireEvent.click(toggle);
    const pick = await panel.findByTestId("price-gh-evening");
    pick.focus();
    fireEvent.keyDown(pick, { key: "Escape" });
    expect(panel.queryByTestId("price-list")).toBeNull();
    expect(document.activeElement).toBe(toggle);
    expect(screen.getByRole("heading", { level: 2, name: "Autumn gala" })).toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// Proposal templates (roadmap X1; Tier B #16): a venue's message and quote
// lines for a room and an occasion. Used, a template's price-list lines are
// priced from the list as it stands; its typed lines ask for their price.
// Saved, the form says what is kept. Nothing is read until it is wanted.
// ---------------------------------------------------------------------------

describe("proposal templates", () => {
  const VENUE = "00000000-0000-4000-8000-000000000001";
  const GH = "00000000-0000-4000-8000-000000000011";
  const SALOON = "00000000-0000-4000-8000-000000000012";
  const GONE_ROOM = "00000000-0000-4000-8000-000000000013";
  const HIRE = "00000000-0000-4000-8000-0000000000a1";
  const DINNER = "00000000-0000-4000-8000-0000000000a2";
  const BAR = "00000000-0000-4000-8000-0000000000a3";
  const HIRE_NAME = "Grand Hall — Evening Event (19:00–00:30)";
  const room = (id: string, name: string, slug: string): Record<string, unknown> => ({
    id, venueId: "v1", name, slug, widthM: "30", lengthM: "15", heightM: "10", floorPlanOutline: [],
  });
  const price = (id: string, overrides: Record<string, unknown> = {}): Record<string, unknown> => ({
    id, venueId: "v1", spaceId: GH, name: HIRE_NAME, type: "flat_rate", amount: "2400.00",
    currency: "GBP", minHours: null, minGuests: null, tiers: null, dayOfWeekModifiers: null, seasonalModifiers: null,
    isActive: true, validFrom: null, validTo: null, ...overrides,
  });
  const PRICES = [
    price(HIRE),
    price(DINNER, { spaceId: null, name: "Dinner", type: "per_head", amount: "65.00", minGuests: 100 }),
    price(BAR, { spaceId: null, name: "Late bar", type: "per_hour", amount: "180.00", minHours: 3 }),
  ];
  const FACTS = { eventDate: "2026-11-20", guestCount: 120, occasion: "wedding", roomName: "Grand Hall", roomSlug: "grand-hall" };
  const MESSAGE = "Thank you for thinking of the Grand Hall.";
  /** A template as the API lists it: by default the Grand Hall's for a
   *  wedding, its hire saved under an older name. */
  const template = (key: string, overrides: Record<string, unknown> = {}): Record<string, unknown> => ({
    id: `00000000-0000-4000-8000-0000000000${key}`, venueId: VENUE, spaceId: GH, roomName: "Grand Hall", roomListed: true,
    occasion: "wedding", name: "Grand Hall wedding", message: MESSAGE,
    lines: [
      { kind: "price_list", pricingRuleId: HIRE, name: "Grand Hall hire", ruleType: "flat_rate", quantity: 1 },
      { kind: "price_list", pricingRuleId: DINNER, name: "Dinner", ruleType: "per_head", quantity: null },
      { kind: "typed", description: "Piper", quantity: 1 },
    ],
    readable: true, createdAt: "2026-09-29T10:00:00.000Z", updatedAt: "2026-09-29T10:00:00.000Z", updatedByName: "Anna Reid",
    ...overrides,
  });
  const WEDDING = template("f1");
  /** The templates the venue has; Remove and Undo change them. */
  let stored: Record<string, unknown>[] = [];

  function held<T>(): { readonly promise: Promise<T>; readonly resolve: (value: T) => void; readonly reject: (error: unknown) => void } {
    let resolve: (value: T) => void = () => undefined;
    let reject: (error: unknown) => void = () => undefined;
    const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
    return { promise, resolve, reject };
  }
  /** Each quote line as [description, quantity, price]. */
  const quoteLines = (panel: HTMLElement): string[][] =>
    Array.from(panel.querySelectorAll<HTMLInputElement>("[data-testid^='quote-desc-']")).map((description, index) => {
      const field = (part: string): string => panel.querySelector<HTMLInputElement>(`[data-testid='quote-${part}-${String(index)}']`)?.value ?? "";
      return [description.value, field("qty"), field("price")];
    });
  const sentences = (region: HTMLElement): string[] => Array.from(region.querySelectorAll("p")).map((node) => node.textContent ?? "");
  const names = (group: HTMLElement): string[] => Array.from(group.querySelectorAll(".pr-template__name")).map((node) => node.textContent ?? "");
  const messageOf = (panel: HTMLElement): string =>
    within(panel).getByTestId<HTMLTextAreaElement>("composer-message").value;

  /** A version-2 composer carrying version 1's message, hire line and capacity note. */
  function carried(): void {
    existing = [proposal({ currentVersion: 1 })];
    mocks.getLatestProposalVersion.mockResolvedValue(version(1, {
      clientMessage: "Dear Elaine, here is the hall for your day.",
      capacityNote: "Up to 120 at dinner rounds.",
      quote: quoteSnapshot([{ description: HIRE_NAME, quantity: 1, unitAmountMinor: 240_000 }]),
    }));
  }

  /** Writes a first version: a message, the hire and 4 hours of the bar
   *  from the price list, a typed piper, and a capacity note. */
  async function compose(panel: HTMLElement, message = MESSAGE): Promise<void> {
    const inPanel = within(panel);
    fireEvent.change(await inPanel.findByTestId("composer-message"), { target: { value: message } });
    fireEvent.click(inPanel.getByTestId("price-list-toggle"));
    fireEvent.click(await inPanel.findByTestId(`price-${HIRE}`));
    fireEvent.click(inPanel.getByTestId(`price-${BAR}`));
    fireEvent.change(inPanel.getByTestId("quote-qty-1"), { target: { value: "4" } });
    fireEvent.click(inPanel.getByTestId("price-list-done"));
    fireEvent.click(inPanel.getByTestId("add-quote-line"));
    fireEvent.change(inPanel.getByTestId("quote-desc-2"), { target: { value: "Piper" } });
    fireEvent.change(inPanel.getByTestId("quote-price-2"), { target: { value: "150" } });
    fireEvent.change(inPanel.getByTestId("composer-capacity"), { target: { value: "Up to 120 at dinner rounds." } });
  }

  /** Opens Save as template and waits for the event and the price list. */
  async function openSave(panel: HTMLElement): Promise<HTMLElement> {
    const inPanel = within(panel);
    fireEvent.click(inPanel.getByTestId("template-save-toggle"));
    const form = await inPanel.findByTestId("template-save");
    await within(form).findByTestId("template-kept");
    await waitFor(() => { expect(within(form).getByTestId<HTMLInputElement>("template-name").value).toBe("Grand Hall wedding"); });
    return form;
  }

  const SENT_LINES = [
    { kind: "price_list", pricingRuleId: HIRE, name: HIRE_NAME, ruleType: "flat_rate", quantity: 1 },
    { kind: "price_list", pricingRuleId: BAR, name: "Late bar", ruleType: "per_hour", quantity: 4 },
    { kind: "typed", description: "Piper", quantity: 1 },
  ];

  beforeEach(() => {
    existing = [proposal()];
    stored = [WEDDING];
    mocks.listSpaces.mockResolvedValue([room(GH, "Grand Hall", "grand-hall"), room(SALOON, "Saloon", "saloon")]);
    mocks.listPricingRules.mockResolvedValue(PRICES);
    mocks.listProposalTemplates.mockImplementation(() => Promise.resolve(stored));
    mocks.getProposalEvent.mockResolvedValue({ facts: FACTS, spaceId: GH });
    mocks.removeProposalTemplate.mockImplementation((_venue: string, id: string) => {
      stored = stored.filter((one) => one["id"] !== id);
      return Promise.resolve();
    });
  });

  describe("Start from a template", () => {
    it("reads nothing more for templates until one of their panels is opened, and reads the event afresh each time one opens", async () => {
      render(<ProposalsDesk />);
      const element = await openProposal();
      const panel = within(element);
      fireEvent.change(await panel.findByTestId("composer-message"), { target: { value: "Dear Elaine." } });
      expect(mocks.getProposalEvent).not.toHaveBeenCalled();
      expect(mocks.listProposalTemplates).not.toHaveBeenCalled();
      expect(mocks.listPricingRules).not.toHaveBeenCalled();

      fireEvent.click(panel.getByTestId("template-toggle"));
      await panel.findByRole("button", { name: "Use Grand Hall wedding" });
      expect(mocks.getProposalEvent).toHaveBeenCalledTimes(1);
      expect(mocks.getProposalEvent).toHaveBeenCalledWith("p1");
      expect(mocks.listProposalTemplates).toHaveBeenCalledWith("v1");
      // The event and the templates are read afresh each time, so a template takes the event as it now is.
      fireEvent.click(panel.getByTestId("templates-done"));
      await openSave(element);
      expect(mocks.getProposalEvent).toHaveBeenCalledTimes(2);
      fireEvent.click(panel.getByTestId("template-toggle"));
      await waitFor(() => { expect(mocks.listProposalTemplates).toHaveBeenCalledTimes(2); });
      expect(mocks.getProposalEvent).toHaveBeenCalledTimes(3);
    });

    it("says it is reading, and says when there are no templates yet", async () => {
      const list = held<Record<string, unknown>[]>();
      mocks.listProposalTemplates.mockReturnValueOnce(list.promise);
      render(<ProposalsDesk />);
      const panel = within(await openProposal());
      const toggle = await panel.findByTestId("template-toggle");
      expect(toggle.getAttribute("aria-expanded")).toBe("false");
      fireEvent.click(toggle);
      expect(toggle.getAttribute("aria-expanded")).toBe("true");
      expect(panel.getByText("Reading the templates…")).toBeDefined();
      await act(async () => { list.resolve([]); await Promise.resolve(); });
      expect((await panel.findByTestId("templates-empty")).textContent)
        .toBe("No templates yet. Save as template, beside Save version, keeps one from the proposal you are writing.");
      expect(panel.queryByText("Reading the templates…")).toBeNull();
    });

    it("says when the templates could not be read, and reads them again on Try again", async () => {
      mocks.listProposalTemplates.mockRejectedValueOnce(new ApiError(0, "Network error", "NETWORK_ERROR"));
      render(<ProposalsDesk />);
      const panel = within(await openProposal());
      fireEvent.click(await panel.findByTestId("template-toggle"));
      expect((await panel.findByTestId("templates-error")).textContent).toBe("The templates could not be read.");
      expect(panel.queryByRole("button", { name: "Use Grand Hall wedding" })).toBeNull();
      fireEvent.click(panel.getByTestId("templates-retry"));
      await panel.findByRole("button", { name: "Use Grand Hall wedding" });
      expect(panel.queryByTestId("templates-error")).toBeNull();
      expect(mocks.listProposalTemplates).toHaveBeenCalledTimes(2);
    });

    it("offers no Use until the event is read, says when it could not be, and reads it again on Try again", async () => {
      mocks.getProposalEvent.mockRejectedValueOnce(new ApiError(0, "Network error", "NETWORK_ERROR"));
      render(<ProposalsDesk />);
      const panel = within(await openProposal());
      fireEvent.click(await panel.findByTestId("template-toggle"));
      expect((await panel.findByTestId("templates-event-error")).textContent)
        .toBe("The event's details could not be read, so a template cannot be priced for it yet.");
      await panel.findByTestId(`template-${String(WEDDING["id"])}`);
      expect(panel.queryByRole("button", { name: "Use Grand Hall wedding" })).toBeNull();
      // Remove does not need the event.
      expect(panel.getByRole("button", { name: "Remove Grand Hall wedding" })).toBeDefined();
      fireEvent.click(panel.getByTestId("templates-event-retry"));
      await panel.findByRole("button", { name: "Use Grand Hall wedding" });
      expect(panel.queryByTestId("templates-event-error")).toBeNull();
      expect(mocks.getProposalEvent).toHaveBeenCalledTimes(2);
    });

    it("lists this event's templates first, closest first, and the others with why they are not this event's", async () => {
      stored = [
        template("a5", { name: "Saloon wedding", spaceId: SALOON, roomName: "Saloon" }),
        template("a4", { name: "House style", spaceId: null, roomName: null, occasion: null }),
        template("a6", { name: "Conference day", spaceId: null, roomName: null, occasion: "conference" }),
        template("a2", { name: "Grand Hall, any occasion", occasion: null }),
        template("a7", { name: "Old room dinner", spaceId: GONE_ROOM, roomName: null, roomListed: false, occasion: null }),
        template("a3", { name: "Weddings anywhere", spaceId: null, roomName: null }),
        template("a1", { name: "Grand Hall wedding" }),
      ];
      render(<ProposalsDesk />);
      const panel = within(await openProposal());
      fireEvent.click(await panel.findByTestId("template-toggle"));
      const list = within(await panel.findByTestId("templates"));
      const forEvent = await list.findByRole("group", { name: "For this event" });
      expect(names(forEvent)).toEqual(["Grand Hall wedding", "Grand Hall, any occasion", "Weddings anywhere", "House style"]);
      const others = list.getByRole("group", { name: "Other templates" });
      expect(names(others)).toEqual(["Conference day", "Old room dinner", "Saloon wedding"]);

      const about = (key: string): string[] => Array.from(list.getByTestId(`template-00000000-0000-4000-8000-0000000000${key}`)
        .querySelectorAll(".pr-template__about")).map((node) => node.textContent ?? "");
      expect(about("a1")[0]).toBe("Grand Hall · Wedding");
      expect(about("a1")[1]).toMatch(/^The message and 3 lines · Saved by Anna Reid, /u);
      expect(about("a4")[0]).toBe("Any room · Any occasion");
      expect(about("a5")[0]).toBe("Saloon · Wedding · For the Saloon");
      expect(about("a6")[0]).toBe("Any room · Conference · For a conference");
      expect(about("a7")[0]).toBe("A room no longer listed · Any occasion · Its room is no longer listed");
      expect(list.getByRole("button", { name: "Use Saloon wedding" })).toBeDefined();
    });

    it("starts an empty first version from a template, priced from the list as it stands, says so, and goes to the first thing to fill in", async () => {
      render(<ProposalsDesk />);
      const element = await openProposal();
      const panel = within(element);
      const toggle = await panel.findByTestId("template-toggle");
      fireEvent.click(toggle);
      fireEvent.click(await panel.findByRole("button", { name: "Use Grand Hall wedding" }));
      await waitFor(() => { expect(messageOf(element)).toBe(MESSAGE); });
      expect(mocks.listPricingRules).toHaveBeenCalledWith("v1");
      // The hire is named and priced as the list has it now, not as the template saved it.
      expect(quoteLines(element)).toEqual([
        [HIRE_NAME, "1", "2400"],
        ["Dinner", "120", "65"],
        ["Piper", "1", ""],
      ]);
      const said = panel.getByTestId("template-said");
      expect(said.getAttribute("role")).toBe("status");
      expect(sentences(said)).toEqual(["Started from Grand Hall wedding: the message and its 3 lines.", "Enter the price for Piper (line 3)."]);
      await waitFor(() => { expect(document.activeElement).toBe(panel.getByTestId("quote-price-2")); });
      expect(panel.queryByTestId("templates")).toBeNull();
      expect(toggle.getAttribute("aria-expanded")).toBe("false");
      // Nothing was put aside: there was nothing to keep.
      expect(panel.queryByTestId("kept-version")).toBeNull();
    });

    it("asks before changing words already in the composer: Replace them, Add its lines, or Cancel", async () => {
      carried();
      render(<ProposalsDesk />);
      const element = await openProposal();
      const panel = within(element);
      await waitFor(() => { expect(messageOf(element)).toBe("Dear Elaine, here is the hall for your day."); });
      fireEvent.click(panel.getByTestId("template-toggle"));
      fireEvent.click(await panel.findByRole("button", { name: "Use Grand Hall wedding" }));
      const choice = within(panel.getByTestId("template-choice"));
      expect(panel.getByTestId("template-choice").getAttribute("role")).toBe("group");
      expect(panel.getByRole("group", { name: "The composer already has a message and 1 line. Replace keeps what is there now to copy. The capacity note stays." }))
        .toBeDefined();
      expect(choice.getByRole("button", { name: "Replace them" })).toBeDefined();
      expect(choice.getByRole("button", { name: "Add its lines" })).toBeDefined();
      fireEvent.click(choice.getByRole("button", { name: "Cancel" }));
      expect(panel.queryByTestId("template-choice")).toBeNull();
      expect(panel.getByRole("button", { name: "Use Grand Hall wedding" })).toBeDefined();
      // Nothing was priced and nothing changed.
      expect(mocks.listPricingRules).not.toHaveBeenCalled();
      expect(messageOf(element)).toBe("Dear Elaine, here is the hall for your day.");
      expect(quoteLines(element)).toEqual([[HIRE_NAME, "1", "2400"]]);
    });

    it("closes the choice on Escape first, then the list, gives focus back to its button and leaves the proposal open", async () => {
      carried();
      render(<ProposalsDesk />);
      const element = await openProposal();
      const panel = within(element);
      await waitFor(() => { expect(messageOf(element)).toBe("Dear Elaine, here is the hall for your day."); });
      const toggle = panel.getByTestId("template-toggle");
      fireEvent.click(toggle);
      fireEvent.click(await panel.findByRole("button", { name: "Use Grand Hall wedding" }));
      const replace = within(panel.getByTestId("template-choice")).getByRole("button", { name: "Replace them" });
      replace.focus();
      fireEvent.keyDown(replace, { key: "Escape" });
      expect(panel.queryByTestId("template-choice")).toBeNull();
      expect(panel.getByTestId("templates")).toBeDefined();
      const use = panel.getByRole("button", { name: "Use Grand Hall wedding" });
      use.focus();
      fireEvent.keyDown(use, { key: "Escape" });
      expect(panel.queryByTestId("templates")).toBeNull();
      expect(toggle.getAttribute("aria-expanded")).toBe("false");
      expect(document.activeElement).toBe(toggle);
      expect(screen.getByRole("heading", { level: 2, name: "Autumn gala" })).toBeDefined();
      expect(messageOf(element)).toBe("Dear Elaine, here is the hall for your day.");
    });

    it("replaces the words in a new composer started from the template, keeping the old ones to copy and the capacity note", async () => {
      carried();
      render(<ProposalsDesk />);
      const element = await openProposal();
      const panel = within(element);
      await waitFor(() => { expect(messageOf(element)).toBe("Dear Elaine, here is the hall for your day."); });
      fireEvent.change(panel.getByTestId("quote-qty-0"), { target: { value: "2" } });
      const before = panel.getByTestId("composer");
      fireEvent.click(panel.getByTestId("template-toggle"));
      fireEvent.click(await panel.findByRole("button", { name: "Use Grand Hall wedding" }));
      fireEvent.click(within(panel.getByTestId("template-choice")).getByRole("button", { name: "Replace them" }));

      await waitFor(() => { expect(messageOf(element)).toBe(MESSAGE); });
      // A new composer, so the words before it are shown to copy beside it.
      expect(panel.getByTestId("composer")).not.toBe(before);
      const kept = within(panel.getByTestId("kept-version"));
      expect(kept.getByRole("heading", { name: "What you were writing" })).toBeDefined();
      expect(kept.getByTestId("kept-version-why").textContent).toBe("You started from Grand Hall wedding.");
      expect(kept.getByText("What you wrote is kept here to copy.")).toBeDefined();
      expect(kept.getByText("Dear Elaine, here is the hall for your day.")).toBeDefined();
      expect(kept.getByText("Capacity: Up to 120 at dinner rounds.")).toBeDefined();
      expect(kept.getByText(`${HIRE_NAME} · 2 × £2400`)).toBeDefined();

      expect(quoteLines(element)).toEqual([[HIRE_NAME, "1", "2400"], ["Dinner", "120", "65"], ["Piper", "1", ""]]);
      expect(panel.getByTestId<HTMLInputElement>("composer-capacity").value).toBe("Up to 120 at dinner rounds.");
      await waitFor(() => {
        expect(sentences(panel.getByTestId("template-said")))
          .toEqual(["Started from Grand Hall wedding: the message and its 3 lines.", "Enter the price for Piper (line 3)."]);
      });
      await waitFor(() => { expect(document.activeElement).toBe(panel.getByTestId("quote-price-2")); });
    });

    it("adds its lines after the ones there, keeps the message, and does not add a line already in the quote", async () => {
      carried();
      render(<ProposalsDesk />);
      const element = await openProposal();
      const panel = within(element);
      await waitFor(() => { expect(messageOf(element)).toBe("Dear Elaine, here is the hall for your day."); });
      const before = panel.getByTestId("composer");
      fireEvent.click(panel.getByTestId("template-toggle"));
      fireEvent.click(await panel.findByRole("button", { name: "Use Grand Hall wedding" }));
      fireEvent.click(within(panel.getByTestId("template-choice")).getByRole("button", { name: "Add its lines" }));

      await waitFor(() => { expect(quoteLines(element)).toHaveLength(3); });
      expect(quoteLines(element)).toEqual([[HIRE_NAME, "1", "2400"], ["Dinner", "120", "65"], ["Piper", "1", ""]]);
      expect(messageOf(element)).toBe("Dear Elaine, here is the hall for your day.");
      expect(panel.getByTestId("composer")).toBe(before);
      expect(panel.queryByTestId("kept-version")).toBeNull();
      expect(sentences(panel.getByTestId("template-said"))).toEqual([
        "Added 2 of Grand Hall wedding's 3 lines.",
        `Already in the quote, so not added again: ${HIRE_NAME}.`,
        "Enter the price for Piper (line 3).",
      ]);
      await waitFor(() => { expect(document.activeElement).toBe(panel.getByTestId("quote-price-2")); });
    });

    it("changes nothing when the price list cannot be read on Use, says so, and uses the template on Try again", async () => {
      mocks.listPricingRules.mockRejectedValueOnce(new ApiError(0, "Network error", "NETWORK_ERROR"));
      render(<ProposalsDesk />);
      const element = await openProposal();
      const panel = within(element);
      fireEvent.click(await panel.findByTestId("template-toggle"));
      fireEvent.click(await panel.findByRole("button", { name: "Use Grand Hall wedding" }));
      expect((await panel.findByTestId("templates-price-error")).textContent)
        .toBe("The price list could not be read, so Grand Hall wedding was not used.");
      expect(messageOf(element)).toBe("");
      expect(quoteLines(element)).toEqual([]);
      expect(sentences(panel.getByTestId("template-said"))).toEqual([]);
      fireEvent.click(panel.getByTestId("templates-price-retry"));
      await waitFor(() => { expect(messageOf(element)).toBe(MESSAGE); });
      expect(quoteLines(element)).toHaveLength(3);
      expect(mocks.listPricingRules).toHaveBeenCalledTimes(2);
    });

    it("drops a price read overtaken by closing the list and using another template", async () => {
      stored = [WEDDING, template("f2", { name: "House style", spaceId: null, roomName: null, occasion: null, message: "Our house words.",
        lines: [{ kind: "typed", description: "Flowers", quantity: 10 }] })];
      const first = held<Record<string, unknown>[]>();
      const second = held<Record<string, unknown>[]>();
      mocks.listPricingRules.mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);
      render(<ProposalsDesk />);
      const element = await openProposal();
      const panel = within(element);
      fireEvent.click(await panel.findByTestId("template-toggle"));
      fireEvent.click(await panel.findByRole("button", { name: "Use Grand Hall wedding" }));
      expect(panel.getByText("Pricing Grand Hall wedding…")).toBeDefined();
      // While it prices, nothing else can be used, and the buttons keep their place for focus.
      expect(panel.getByRole("button", { name: "Use House style" }).getAttribute("aria-disabled")).toBe("true");
      fireEvent.click(panel.getByTestId("templates-done"));
      fireEvent.click(panel.getByTestId("template-toggle"));
      fireEvent.click(await panel.findByRole("button", { name: "Use House style" }));
      await act(async () => { second.resolve(PRICES); await Promise.resolve(); });
      await waitFor(() => { expect(messageOf(element)).toBe("Our house words."); });
      await act(async () => { first.resolve(PRICES); await Promise.resolve(); });
      expect(messageOf(element)).toBe("Our house words.");
      expect(quoteLines(element)).toEqual([["Flowers", "10", ""]]);
      expect(sentences(panel.getByTestId("template-said"))[0]).toBe("Started from House style: the message and its 1 line.");
    });

    it("drops a price read that arrives after the list was closed by Escape or by its button", async () => {
      const first = held<Record<string, unknown>[]>();
      const second = held<Record<string, unknown>[]>();
      mocks.listPricingRules.mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);
      render(<ProposalsDesk />);
      const element = await openProposal();
      const panel = within(element);
      const toggle = await panel.findByTestId("template-toggle");
      fireEvent.click(toggle);
      const use = await panel.findByRole("button", { name: "Use Grand Hall wedding" });
      fireEvent.click(use);
      fireEvent.keyDown(panel.getByTestId("templates"), { key: "Escape" });
      expect(panel.queryByTestId("templates")).toBeNull();
      expect(document.activeElement).toBe(toggle);
      await act(async () => { first.resolve(PRICES); await Promise.resolve(); });
      expect(messageOf(element)).toBe("");
      expect(quoteLines(element)).toEqual([]);

      fireEvent.click(toggle);
      fireEvent.click(await panel.findByRole("button", { name: "Use Grand Hall wedding" }));
      fireEvent.click(toggle);
      expect(panel.queryByTestId("templates")).toBeNull();
      await act(async () => { second.resolve(PRICES); await Promise.resolve(); });
      expect(messageOf(element)).toBe("");
      expect(quoteLines(element)).toEqual([]);
      expect(sentences(panel.getByTestId("template-said"))).toEqual([]);
    });

    it("removes a template for everyone, and Undo brings it back", async () => {
      mocks.restoreProposalTemplate.mockImplementation(() => {
        stored = [WEDDING];
        return Promise.resolve(WEDDING);
      });
      render(<ProposalsDesk />);
      const panel = within(await openProposal());
      fireEvent.click(await panel.findByTestId("template-toggle"));
      fireEvent.click(await panel.findByRole("button", { name: "Remove Grand Hall wedding" }));
      const said = panel.getByTestId("templates-said");
      await waitFor(() => { expect(said.textContent).toBe("Removed Grand Hall wedding for everyone at the venue."); });
      expect(mocks.removeProposalTemplate).toHaveBeenCalledWith("v1", WEDDING["id"]);
      await panel.findByTestId("templates-empty");
      fireEvent.click(panel.getByTestId("template-undo"));
      await waitFor(() => { expect(said.textContent).toBe("Grand Hall wedding is back."); });
      expect(mocks.restoreProposalTemplate).toHaveBeenCalledWith("v1", WEDDING["id"]);
      await panel.findByRole("button", { name: "Use Grand Hall wedding" });
      expect(panel.queryByTestId("template-undo")).toBeNull();
    });

    it("says when Undo cannot bring a template back because its name is used again", async () => {
      mocks.restoreProposalTemplate.mockRejectedValue(new ApiError(409, "Name taken", "NAME_TAKEN"));
      render(<ProposalsDesk />);
      const panel = within(await openProposal());
      fireEvent.click(await panel.findByTestId("template-toggle"));
      fireEvent.click(await panel.findByRole("button", { name: "Remove Grand Hall wedding" }));
      fireEvent.click(await panel.findByTestId("template-undo"));
      await waitFor(() => {
        expect(panel.getByTestId("templates-said").textContent)
          .toBe("Another template is now called Grand Hall wedding, so this one cannot come back.");
      });
      expect(panel.queryByTestId("template-undo")).toBeNull();
    });

    it("says when a template was already removed by someone else", async () => {
      mocks.removeProposalTemplate.mockImplementation(() => {
        stored = [];
        return Promise.reject(new ApiError(404, "Not found", "NOT_FOUND"));
      });
      render(<ProposalsDesk />);
      const panel = within(await openProposal());
      fireEvent.click(await panel.findByTestId("template-toggle"));
      fireEvent.click(await panel.findByRole("button", { name: "Remove Grand Hall wedding" }));
      await waitFor(() => { expect(panel.getByTestId("templates-said").textContent).toBe("Grand Hall wedding was already removed."); });
      expect(panel.queryByTestId("template-undo")).toBeNull();
      await panel.findByTestId("templates-empty");
    });
  });

  describe("what a template puts in is never lost, stale or misstated", () => {
    it("starts the version after one saved from a template from the version saved, not the template", async () => {
      carried();
      const saved = version(2, {
        clientMessage: "Dear Elaine, our own words.",
        quote: quoteSnapshot([{ description: HIRE_NAME, quantity: 1, unitAmountMinor: 240_000 }]),
      });
      mocks.createQuote.mockResolvedValue({
        id: "33333333-3333-4333-8333-333333333333", venueId: "v1", opportunityId: null, proposalId: "p1", enquiryId: null, spaceId: null,
        name: "Autumn gala quote", status: "draft", currency: "GBP", subtotalMinor: 240_000, totalMinor: 240_000, validUntil: null,
        supersededByQuoteId: null, notes: null, createdBy: "u1", createdAt: "2026-09-30T09:00:00.000Z", updatedAt: "2026-09-30T09:00:00.000Z",
        deletedAt: null,
        lineItems: [{
          id: "44444444-4444-4444-8444-444444444444", quoteId: "33333333-3333-4333-8333-333333333333", pricingRuleId: HIRE,
          description: HIRE_NAME, quantity: 1, unitAmountMinor: 240_000, lineTotalMinor: 240_000, sortOrder: 0,
        }],
      });
      mocks.createProposalVersion.mockResolvedValue(saved);
      render(<ProposalsDesk />);
      const element = await openProposal();
      const panel = within(element);
      await waitFor(() => { expect(messageOf(element)).toBe("Dear Elaine, here is the hall for your day."); });
      fireEvent.click(panel.getByTestId("template-toggle"));
      fireEvent.click(await panel.findByRole("button", { name: "Use Grand Hall wedding" }));
      fireEvent.click(within(panel.getByTestId("template-choice")).getByRole("button", { name: "Replace them" }));
      await waitFor(() => { expect(messageOf(element)).toBe(MESSAGE); });
      fireEvent.change(panel.getByTestId("composer-message"), { target: { value: "Dear Elaine, our own words." } });
      fireEvent.click(panel.getByRole("button", { name: "Remove quote line 3" }));
      fireEvent.click(panel.getByRole("button", { name: "Remove quote line 2" }));
      existing = [proposal({ currentVersion: 2 })];
      mocks.getLatestProposalVersion.mockResolvedValue(saved);
      fireEvent.click(panel.getByRole("button", { name: "Save version 2" }));

      await panel.findByRole("button", { name: "Save version 3" });
      expect(messageOf(element)).toBe("Dear Elaine, our own words.");
      expect(quoteLines(element)).toEqual([[HIRE_NAME, "1", "2400"]]);
      expect(sentences(panel.getByTestId("template-said"))).toEqual([]);
    });

    it("keeps words typed while a template is priced: replaced, they are kept to copy", async () => {
      const prices = held<Record<string, unknown>[]>();
      mocks.listPricingRules.mockReturnValueOnce(prices.promise);
      render(<ProposalsDesk />);
      const element = await openProposal();
      const panel = within(element);
      fireEvent.click(await panel.findByTestId("template-toggle"));
      // The composer is empty when Use is pressed; words arrive before the prices do.
      fireEvent.click(await panel.findByRole("button", { name: "Use Grand Hall wedding" }));
      fireEvent.change(panel.getByTestId("composer-message"), { target: { value: "Typed while it priced." } });
      await act(async () => { prices.resolve(PRICES); await Promise.resolve(); });

      await waitFor(() => { expect(messageOf(element)).toBe(MESSAGE); });
      const kept = within(panel.getByTestId("kept-version"));
      expect(kept.getByTestId("kept-version-why").textContent).toBe("You started from Grand Hall wedding.");
      expect(kept.getByText("Typed while it priced.")).toBeDefined();
    });

    it("keeps words typed while a template's lines are priced to add", async () => {
      carried();
      const prices = held<Record<string, unknown>[]>();
      mocks.listPricingRules.mockReturnValueOnce(prices.promise);
      render(<ProposalsDesk />);
      const element = await openProposal();
      const panel = within(element);
      await waitFor(() => { expect(messageOf(element)).toBe("Dear Elaine, here is the hall for your day."); });
      const before = panel.getByTestId("composer");
      fireEvent.click(panel.getByTestId("template-toggle"));
      fireEvent.click(await panel.findByRole("button", { name: "Use Grand Hall wedding" }));
      fireEvent.click(within(panel.getByTestId("template-choice")).getByRole("button", { name: "Add its lines" }));
      fireEvent.change(panel.getByTestId("composer-message"), { target: { value: "Dear Elaine, written while it priced." } });
      await act(async () => { prices.resolve(PRICES); await Promise.resolve(); });

      await waitFor(() => { expect(quoteLines(element)).toHaveLength(3); });
      expect(messageOf(element)).toBe("Dear Elaine, written while it priced.");
      expect(panel.getByTestId("composer")).toBe(before);
      expect(panel.queryByTestId("kept-version")).toBeNull();
    });

    it("gives focus back to the template's Use after Cancel, to Undo after Remove, to what is said after Undo, and to Try again when pricing fails", async () => {
      carried();
      mocks.restoreProposalTemplate.mockImplementation(() => {
        stored = [WEDDING];
        return Promise.resolve(WEDDING);
      });
      render(<ProposalsDesk />);
      const element = await openProposal();
      const panel = within(element);
      await waitFor(() => { expect(messageOf(element)).toBe("Dear Elaine, here is the hall for your day."); });
      fireEvent.click(panel.getByTestId("template-toggle"));
      fireEvent.click(await panel.findByRole("button", { name: "Use Grand Hall wedding" }));
      fireEvent.click(within(panel.getByTestId("template-choice")).getByRole("button", { name: "Cancel" }));
      await waitFor(() => { expect(document.activeElement).toBe(panel.getByRole("button", { name: "Use Grand Hall wedding" })); });

      fireEvent.click(panel.getByRole("button", { name: "Remove Grand Hall wedding" }));
      await waitFor(() => { expect(document.activeElement).toBe(panel.getByTestId("template-undo")); });
      fireEvent.click(panel.getByTestId("template-undo"));
      await waitFor(() => { expect(document.activeElement).toBe(panel.getByTestId("templates-said")); });
      expect(panel.getByTestId("templates-said").textContent).toBe("Grand Hall wedding is back.");

      mocks.listPricingRules.mockRejectedValueOnce(new ApiError(0, "Network error", "NETWORK_ERROR"));
      fireEvent.click(await panel.findByRole("button", { name: "Use Grand Hall wedding" }));
      fireEvent.click(within(panel.getByTestId("template-choice")).getByRole("button", { name: "Add its lines" }));
      await waitFor(() => { expect(document.activeElement).toBe(panel.getByTestId("templates-price-retry")); });
    });

    it("says a Remove with no answer, or a failure on the venue's side, could not be confirmed, and offers no Undo", async () => {
      for (const failure of [new ApiError(0, "Network error", "NETWORK_ERROR"), new ApiError(503, "Unavailable", "UNAVAILABLE")]) {
        mocks.removeProposalTemplate.mockReset().mockRejectedValue(failure);
        render(<ProposalsDesk />);
        const panel = within(await openProposal());
        fireEvent.click(await panel.findByTestId("template-toggle"));
        fireEvent.click(await panel.findByRole("button", { name: "Remove Grand Hall wedding" }));
        const said = panel.getByTestId("templates-said");
        await waitFor(() => {
          expect(said.textContent)
            .toBe("Removing Grand Hall wedding could not be confirmed. The list shows the templates as the venue now has them.");
        });
        await waitFor(() => { expect(document.activeElement).toBe(said); });
        expect(panel.queryByTestId("template-undo")).toBeNull();
        cleanup();
      }
    });

    it("drops what it said about particular lines once the lines change, and keeps what it said of the whole", async () => {
      render(<ProposalsDesk />);
      const element = await openProposal();
      const panel = within(element);
      fireEvent.click(await panel.findByTestId("template-toggle"));
      fireEvent.click(await panel.findByRole("button", { name: "Use Grand Hall wedding" }));
      await waitFor(() => {
        expect(sentences(panel.getByTestId("template-said")))
          .toEqual(["Started from Grand Hall wedding: the message and its 3 lines.", "Enter the price for Piper (line 3)."]);
      });
      fireEvent.change(panel.getByTestId("quote-price-2"), { target: { value: "150" } });
      expect(sentences(panel.getByTestId("template-said"))).toEqual(["Started from Grand Hall wedding: the message and its 3 lines."]);
    });
  });

  describe("Save as template, never lost or misstated", () => {
    it("closes on Escape from its own button, and leaves the proposal open", async () => {
      render(<ProposalsDesk />);
      const element = await openProposal();
      await compose(element);
      await openSave(element);
      const toggle = within(element).getByTestId("template-save-toggle");
      toggle.focus();
      fireEvent.keyDown(toggle, { key: "Escape" });
      expect(within(element).queryByTestId("template-save")).toBeNull();
      expect(toggle.getAttribute("aria-expanded")).toBe("false");
      expect(document.activeElement).toBe(toggle);
      expect(screen.getByRole("heading", { level: 2, name: "Autumn gala" })).toBeDefined();
      expect(messageOf(element)).toBe(MESSAGE);
    });

    it("fills in the name, room and occasion once the event is read on Try again", async () => {
      mocks.getProposalEvent.mockRejectedValueOnce(new ApiError(0, "Network error", "NETWORK_ERROR"));
      render(<ProposalsDesk />);
      const element = await openProposal();
      await compose(element);
      fireEvent.click(within(element).getByTestId("template-save-toggle"));
      const form = within(await within(element).findByTestId("template-save"));
      expect((await form.findByTestId("template-save-event-error")).textContent)
        .toBe("The event's details could not be read, so what the template keeps cannot be checked against its prices yet.");
      expect(form.getByTestId<HTMLInputElement>("template-name").value).toBe("");
      // Nothing is said to be kept, and nothing can be saved, until the event is read.
      await waitFor(() => { expect(mocks.listPricingRules).toHaveBeenCalled(); });
      expect(form.queryByTestId("template-kept")).toBeNull();
      expect(form.getByTestId("template-save-submit").getAttribute("aria-disabled")).toBe("true");
      const tryAgain = form.getByRole("button", { name: "Try again" });
      tryAgain.focus();
      fireEvent.click(tryAgain);
      // Its block goes as the event is read again, so focus goes to the form's title.
      expect(document.activeElement?.textContent).toBe("Save as a template");
      await waitFor(() => { expect(form.getByTestId<HTMLInputElement>("template-name").value).toBe("Grand Hall wedding"); });
      await form.findByTestId("template-kept");
      expect(form.getByTestId<HTMLSelectElement>("template-room").value).toBe(GH);
      expect(form.getByTestId<HTMLSelectElement>("template-occasion").value).toBe("wedding");
      expect(form.queryByTestId("template-save-event-error")).toBeNull();
      expect(mocks.getProposalEvent).toHaveBeenCalledTimes(2);
    });

    it("fills in from the event only the fields not typed in or chosen before it arrived", async () => {
      const late = held<Record<string, unknown>>();
      mocks.getProposalEvent.mockReturnValueOnce(late.promise);
      render(<ProposalsDesk />);
      const element = await openProposal();
      await compose(element);
      fireEvent.click(within(element).getByTestId("template-save-toggle"));
      const form = within(await within(element).findByTestId("template-save"));
      fireEvent.change(form.getByTestId("template-name"), { target: { value: "Our autumn wedding" } });
      await act(async () => { late.resolve({ facts: FACTS, spaceId: GH }); await Promise.resolve(); });
      await waitFor(() => { expect(form.getByTestId<HTMLSelectElement>("template-room").value).toBe(GH); });
      expect(form.getByTestId<HTMLSelectElement>("template-occasion").value).toBe("wedding");
      expect(form.getByTestId<HTMLInputElement>("template-name").value).toBe("Our autumn wedding");
    });

    it("shows the event's room as the one chosen even when the venue's rooms could not be read", async () => {
      mocks.listSpaces.mockRejectedValue(new ApiError(0, "Network error", "NETWORK_ERROR"));
      render(<ProposalsDesk />);
      const element = await openProposal();
      await compose(element);
      const form = within(await openSave(element));
      const select = form.getByTestId<HTMLSelectElement>("template-room");
      expect(select.value).toBe(GH);
      expect(select.selectedOptions[0]?.textContent).toBe("Grand Hall");
    });

    it("waits for a save on its way: Cancel, Escape and its button do nothing until it answers, and what came of it is said", async () => {
      const saving = held<Record<string, unknown>>();
      mocks.createProposalTemplate.mockReturnValueOnce(saving.promise);
      render(<ProposalsDesk />);
      const element = await openProposal();
      await compose(element);
      // The status line is there before anything is said, so what is said is heard.
      const said = within(element).getByTestId("template-save-said");
      expect(said.getAttribute("role")).toBe("status");
      expect(said.textContent).toBe("");
      const form = within(await openSave(element));
      fireEvent.click(form.getByTestId("template-save-submit"));
      await waitFor(() => { expect(mocks.createProposalTemplate).toHaveBeenCalledTimes(1); });
      fireEvent.click(form.getByRole("button", { name: "Cancel" }));
      fireEvent.keyDown(form.getByTestId("template-name"), { key: "Escape" });
      fireEvent.click(within(element).getByTestId("template-save-toggle"));
      expect(within(element).getByTestId("template-save")).toBeDefined();
      await act(async () => { saving.resolve(template("s1")); await Promise.resolve(); });
      await waitFor(() => { expect(within(element).queryByTestId("template-save")).toBeNull(); });
      expect(within(element).getByTestId("template-save-said")).toBe(said);
      expect(said.textContent).toBe("Saved the template Grand Hall wedding.");
    });
  });

  describe("held, focused and said as it is", () => {
    it("holds Save version and Start again while a template is priced, and lets them go once it is in", async () => {
      carried();
      const prices = held<Record<string, unknown>[]>();
      mocks.listPricingRules.mockReturnValueOnce(prices.promise);
      render(<ProposalsDesk />);
      const element = await openProposal();
      const panel = within(element);
      await waitFor(() => { expect(messageOf(element)).toBe("Dear Elaine, here is the hall for your day."); });
      fireEvent.change(panel.getByTestId("quote-qty-0"), { target: { value: "2" } });
      fireEvent.click(panel.getByTestId("template-toggle"));
      fireEvent.click(await panel.findByRole("button", { name: "Use Grand Hall wedding" }));
      fireEvent.click(within(panel.getByTestId("template-choice")).getByRole("button", { name: "Add its lines" }));
      expect(panel.getByTestId<HTMLButtonElement>("composer-save").disabled).toBe(true);
      expect(panel.getByTestId<HTMLButtonElement>("composer-start-again").disabled).toBe(true);
      expect(panel.getByTestId("template-save-toggle").getAttribute("aria-disabled")).toBe("true");
      fireEvent.click(panel.getByTestId("composer-save"));
      expect(mocks.createProposalVersion).not.toHaveBeenCalled();
      await act(async () => { prices.resolve(PRICES); await Promise.resolve(); });
      await waitFor(() => { expect(quoteLines(element)).toHaveLength(3); });
      expect(panel.getByTestId<HTMLButtonElement>("composer-save").disabled).toBe(false);
      expect(panel.getByTestId<HTMLButtonElement>("composer-start-again").disabled).toBe(false);
    });

    it("holds what would replace the composer while a template is saved, so its answer is said", async () => {
      const saving = held<Record<string, unknown>>();
      mocks.createProposalTemplate.mockReturnValueOnce(saving.promise);
      render(<ProposalsDesk />);
      const element = await openProposal();
      const panel = within(element);
      await compose(element);
      const form = within(await openSave(element));
      fireEvent.click(form.getByTestId("template-save-submit"));
      await waitFor(() => { expect(mocks.createProposalTemplate).toHaveBeenCalledTimes(1); });
      expect(panel.getByTestId<HTMLButtonElement>("composer-save").disabled).toBe(true);
      expect(panel.getByTestId<HTMLButtonElement>("composer-start-again").disabled).toBe(true);
      expect(panel.getByTestId("template-toggle").getAttribute("aria-disabled")).toBe("true");
      await act(async () => { saving.reject(new ApiError(409, "Name taken", "NAME_TAKEN", template("c1"))); await Promise.resolve(); });
      expect((await panel.findByTestId("template-name-taken")).textContent).toContain("A template is already called Grand Hall wedding.");
      expect(panel.getByTestId<HTMLButtonElement>("composer-save").disabled).toBe(false);
    });

    it("takes focus to the question when Use finds words in the composer, and Escape from there answers it", async () => {
      carried();
      render(<ProposalsDesk />);
      const element = await openProposal();
      const panel = within(element);
      await waitFor(() => { expect(messageOf(element)).toBe("Dear Elaine, here is the hall for your day."); });
      fireEvent.click(panel.getByTestId("template-toggle"));
      const use = await panel.findByRole("button", { name: "Use Grand Hall wedding" });
      use.focus();
      fireEvent.click(use);
      const question = panel.getByTestId("template-question");
      await waitFor(() => { expect(document.activeElement).toBe(question); });
      expect(question.textContent).toBe("The composer already has a message and 1 line. Replace keeps what is there now to copy. The capacity note stays.");
      fireEvent.keyDown(question, { key: "Escape" });
      expect(panel.queryByTestId("template-choice")).toBeNull();
      await waitFor(() => { expect(document.activeElement).toBe(panel.getByRole("button", { name: "Use Grand Hall wedding" })); });
      expect(panel.getByTestId("templates")).toBeDefined();
    });

    it("never moves focus from a field the booker went to while a template was priced or removed", async () => {
      const prices = held<Record<string, unknown>[]>();
      mocks.listPricingRules.mockReturnValueOnce(prices.promise);
      const removing = held<undefined>();
      render(<ProposalsDesk />);
      const element = await openProposal();
      const panel = within(element);
      fireEvent.click(await panel.findByTestId("template-toggle"));
      fireEvent.click(await panel.findByRole("button", { name: "Use Grand Hall wedding" }));
      const message = panel.getByTestId("composer-message");
      message.focus();
      await act(async () => { prices.resolve(PRICES); await Promise.resolve(); });
      await waitFor(() => { expect(quoteLines(element)).toHaveLength(3); });
      expect(document.activeElement).toBe(message);

      stored = [WEDDING];
      mocks.removeProposalTemplate.mockReturnValueOnce(removing.promise);
      fireEvent.click(panel.getByTestId("template-toggle"));
      // Remove is pressed (so has focus), then the booker goes back to the message.
      const remove = await panel.findByRole("button", { name: "Remove Grand Hall wedding" });
      remove.focus();
      fireEvent.click(remove);
      message.focus();
      stored = [];
      await act(async () => { removing.resolve(undefined); await Promise.resolve(); });
      await waitFor(() => { expect(panel.getByTestId("templates-said").textContent).toBe("Removed Grand Hall wedding for everyone at the venue."); });
      expect(document.activeElement).toBe(message);
    });

    it("says the list is as it was last read when a removal is unconfirmed and the templates cannot be read again", async () => {
      render(<ProposalsDesk />);
      const panel = within(await openProposal());
      fireEvent.click(await panel.findByTestId("template-toggle"));
      await panel.findByRole("button", { name: "Use Grand Hall wedding" });
      mocks.removeProposalTemplate.mockRejectedValueOnce(new ApiError(0, "Network error", "NETWORK_ERROR"));
      mocks.listProposalTemplates.mockRejectedValueOnce(new ApiError(0, "Network error", "NETWORK_ERROR"));
      fireEvent.click(panel.getByRole("button", { name: "Remove Grand Hall wedding" }));
      await waitFor(() => {
        expect(panel.getByTestId("templates-said").textContent).toBe("Removing Grand Hall wedding could not be confirmed. The list is as it was last read.");
      });
      expect(panel.getByTestId("templates-error").textContent).toBe("The templates could not be read.");
    });

    it("takes a template known to be removed out of the list even when the templates cannot be read again", async () => {
      render(<ProposalsDesk />);
      const panel = within(await openProposal());
      fireEvent.click(await panel.findByTestId("template-toggle"));
      await panel.findByRole("button", { name: "Use Grand Hall wedding" });
      mocks.listProposalTemplates.mockRejectedValueOnce(new ApiError(0, "Network error", "NETWORK_ERROR"));
      fireEvent.click(panel.getByRole("button", { name: "Remove Grand Hall wedding" }));
      await waitFor(() => { expect(panel.getByTestId("templates-said").textContent).toBe("Removed Grand Hall wedding for everyone at the venue."); });
      expect(panel.queryByTestId(`template-${String(WEDDING["id"])}`)).toBeNull();
      expect(panel.getByTestId("template-undo")).toBeDefined();
    });

    it("keeps the list open while a removal is on its way, says what came of it, and steals no focus on opening again", async () => {
      const removing = held<undefined>();
      mocks.removeProposalTemplate.mockReturnValueOnce(removing.promise);
      render(<ProposalsDesk />);
      const panel = within(await openProposal());
      const toggle = await panel.findByTestId("template-toggle");
      fireEvent.click(toggle);
      fireEvent.click(await panel.findByRole("button", { name: "Remove Grand Hall wedding" }));
      expect(panel.getByTestId("templates-done").getAttribute("aria-disabled")).toBe("true");
      fireEvent.click(panel.getByTestId("templates-done"));
      fireEvent.keyDown(panel.getByTestId("templates"), { key: "Escape" });
      expect(panel.getByTestId("templates")).toBeDefined();
      stored = [];
      await act(async () => { removing.reject(new ApiError(503, "Unavailable", "UNAVAILABLE")); await Promise.resolve(); });
      await waitFor(() => {
        expect(panel.getByTestId("templates-said").textContent)
          .toBe("Removing Grand Hall wedding could not be confirmed. The list shows the templates as the venue now has them.");
      });
      fireEvent.click(panel.getByTestId("templates-done"));
      expect(panel.queryByTestId("templates")).toBeNull();
      toggle.focus();
      fireEvent.click(toggle);
      await panel.findByTestId("templates-empty");
      expect(document.activeElement).toBe(toggle);
    });

    it("prices a template for the event's guests as they are now, reading the event each time the list opens", async () => {
      mocks.getProposalEvent.mockResolvedValueOnce({ facts: FACTS, spaceId: GH }).mockResolvedValue({ facts: { ...FACTS, guestCount: 160 }, spaceId: GH });
      render(<ProposalsDesk />);
      const element = await openProposal();
      const panel = within(element);
      fireEvent.click(await panel.findByTestId("template-toggle"));
      await panel.findByRole("button", { name: "Use Grand Hall wedding" });
      fireEvent.click(panel.getByTestId("templates-done"));
      // The deal's guests change elsewhere; the list is opened again.
      fireEvent.click(panel.getByTestId("template-toggle"));
      await waitFor(() => { expect(mocks.getProposalEvent).toHaveBeenCalledTimes(2); });
      fireEvent.click(await panel.findByRole("button", { name: "Use Grand Hall wedding" }));
      await waitFor(() => { expect(quoteLines(element)).toHaveLength(3); });
      expect(quoteLines(element)[1]).toEqual(["Dinner", "160", "65"]);
    });

    it("keeps focus on Replace it while the replace is on its way and when the answer asks again", async () => {
      mocks.createProposalTemplate.mockRejectedValueOnce(new ApiError(409, "Name taken", "NAME_TAKEN", template("c1")));
      const replacing = held<Record<string, unknown>>();
      mocks.replaceProposalTemplate.mockReturnValueOnce(replacing.promise);
      render(<ProposalsDesk />);
      const element = await openProposal();
      await compose(element);
      const form = within(await openSave(element));
      fireEvent.click(form.getByTestId("template-save-submit"));
      const replace = await form.findByTestId("template-replace-existing");
      replace.focus();
      fireEvent.click(replace);
      await waitFor(() => { expect(mocks.replaceProposalTemplate).toHaveBeenCalledTimes(1); });
      expect(replace.isConnected).toBe(true);
      expect(replace.getAttribute("aria-busy")).toBe("true");
      expect(document.activeElement).toBe(replace);
      await act(async () => {
        replacing.reject(new ApiError(409, "Changed", "TEMPLATE_CHANGED", template("c1", { updatedByName: "Morag Bell", updatedAt: "2026-10-02T09:30:00.000Z" })));
        await Promise.resolve();
      });
      const changed = await form.findByTestId("template-changed");
      expect(changed.textContent).toContain("Morag Bell changed Grand Hall wedding at 10:30.");
      expect(document.activeElement?.textContent).toBe("Replace it");
    });

    it("moves focus to the list's title when Try again takes its own block away", async () => {
      mocks.listProposalTemplates.mockRejectedValueOnce(new ApiError(0, "Network error", "NETWORK_ERROR"));
      render(<ProposalsDesk />);
      const panel = within(await openProposal());
      fireEvent.click(await panel.findByTestId("template-toggle"));
      const retry = await panel.findByTestId("templates-retry");
      retry.focus();
      fireEvent.click(retry);
      expect(document.activeElement?.textContent).toBe("Templates");
      await panel.findByRole("button", { name: "Use Grand Hall wedding" });
      expect(document.activeElement?.textContent).toBe("Templates");
    });

    it("gives the year of a template saved in an earlier year, so it never reads as recent", async () => {
      stored = [template("a9", { name: "Old wedding", updatedAt: "2025-09-22T09:14:00.000Z" })];
      render(<ProposalsDesk />);
      const panel = within(await openProposal());
      fireEvent.click(await panel.findByTestId("template-toggle"));
      const row = await panel.findByTestId("template-00000000-0000-4000-8000-0000000000a9");
      expect(row.textContent).toContain("Saved by Anna Reid, 22 Sep 2025");
    });
  });

  describe("held both ways, so nothing on its way is lost", () => {
    it("saves no template from the open form while a version saves, and holds Undo then too", async () => {
      carried();
      // The version's quote is made first; held there, the version save stays on its way.
      const quoting = held<Record<string, unknown>>();
      mocks.createQuote.mockReturnValueOnce(quoting.promise);
      render(<ProposalsDesk />);
      const element = await openProposal();
      const panel = within(element);
      await waitFor(() => { expect(messageOf(element)).toBe("Dear Elaine, here is the hall for your day."); });
      fireEvent.click(panel.getByTestId("template-toggle"));
      fireEvent.click(await panel.findByRole("button", { name: "Remove Grand Hall wedding" }));
      const undo = await panel.findByTestId("template-undo");
      // The removal's hold lifts a render after Undo appears.
      await waitFor(() => { expect(panel.getByTestId("template-save-toggle").getAttribute("aria-disabled")).toBe("false"); });
      const form = within(await openSave(element));
      fireEvent.click(panel.getByRole("button", { name: "Save version 2" }));
      await waitFor(() => { expect(mocks.createQuote).toHaveBeenCalledTimes(1); });
      expect(form.getByTestId("template-save-submit").getAttribute("aria-disabled")).toBe("true");
      fireEvent.click(form.getByTestId("template-save-submit"));
      expect(mocks.createProposalTemplate).not.toHaveBeenCalled();
      expect(undo.getAttribute("aria-disabled")).toBe("true");
      fireEvent.click(undo);
      expect(mocks.restoreProposalTemplate).not.toHaveBeenCalled();
    });

    it("holds Send to the client while a template is saved", async () => {
      carried();
      const saving = held<Record<string, unknown>>();
      mocks.createProposalTemplate.mockReturnValueOnce(saving.promise);
      render(<ProposalsDesk />);
      const element = await openProposal();
      const panel = within(element);
      await waitFor(() => { expect(messageOf(element)).toBe("Dear Elaine, here is the hall for your day."); });
      expect(panel.getByTestId<HTMLButtonElement>("send-open").disabled).toBe(false);
      const form = within(await openSave(element));
      fireEvent.click(form.getByTestId("template-save-submit"));
      await waitFor(() => { expect(mocks.createProposalTemplate).toHaveBeenCalledTimes(1); });
      expect(panel.getByTestId<HTMLButtonElement>("send-open").disabled).toBe(true);
      await act(async () => { saving.resolve(template("s1")); await Promise.resolve(); });
      await waitFor(() => { expect(panel.getByTestId("template-save-said").textContent).toBe("Saved the template Grand Hall wedding."); });
      expect(panel.getByTestId<HTMLButtonElement>("send-open").disabled).toBe(false);
    });

    it("still puts in a template priced while a reply posts, which replaces nothing", async () => {
      const prices = held<Record<string, unknown>[]>();
      mocks.listPricingRules.mockReturnValueOnce(prices.promise);
      const posting = held<Record<string, unknown>>();
      mocks.postProposalComment.mockReturnValueOnce(posting.promise);
      render(<ProposalsDesk />);
      const element = await openProposal();
      const panel = within(element);
      fireEvent.click(await panel.findByTestId("template-toggle"));
      fireEvent.click(await panel.findByRole("button", { name: "Use Grand Hall wedding" }));
      fireEvent.change(panel.getByTestId("reply-input"), { target: { value: "Thanks Elaine." } });
      fireEvent.click(panel.getByTestId("reply-submit"));
      await waitFor(() => { expect(mocks.postProposalComment).toHaveBeenCalledTimes(1); });
      await act(async () => { prices.resolve(PRICES); await Promise.resolve(); });
      await waitFor(() => { expect(messageOf(element)).toBe(MESSAGE); });
      expect(quoteLines(element)).toHaveLength(3);
    });

    it("leaves focus where the booker went while a template saved, whatever the answer", async () => {
      for (const answer of ["saved", "refused"] as const) {
        const saving = held<Record<string, unknown>>();
        mocks.createProposalTemplate.mockReturnValueOnce(saving.promise);
        render(<ProposalsDesk />);
        const element = await openProposal();
        const panel = within(element);
        await compose(element);
        const form = within(await openSave(element));
        const submit = form.getByTestId("template-save-submit");
        submit.focus();
        fireEvent.click(submit);
        await waitFor(() => { expect(mocks.createProposalTemplate).toHaveBeenCalled(); });
        const message = panel.getByTestId("composer-message");
        message.focus();
        await act(async () => {
          if (answer === "saved") saving.resolve(template("s1"));
          else saving.reject(new ApiError(422, "Changed", "PRICE_ENTRY_CHANGED"));
          await Promise.resolve();
        });
        if (answer === "saved") await waitFor(() => { expect(panel.queryByTestId("template-save")).toBeNull(); });
        else await panel.findByTestId("template-save-error");
        expect(document.activeElement).toBe(message);
        cleanup();
        mocks.createProposalTemplate.mockReset();
      }
    });

    it("keeps focus on the list's button when the list closes while a template saves, and opens it only once answered", async () => {
      const saving = held<Record<string, unknown>>();
      mocks.createProposalTemplate.mockReturnValueOnce(saving.promise);
      render(<ProposalsDesk />);
      const element = await openProposal();
      const panel = within(element);
      await compose(element);
      const toggle = panel.getByTestId("template-toggle");
      fireEvent.click(toggle);
      await panel.findByRole("button", { name: "Use Grand Hall wedding" });
      const form = within(await openSave(element));
      fireEvent.click(form.getByTestId("template-save-submit"));
      await waitFor(() => { expect(mocks.createProposalTemplate).toHaveBeenCalledTimes(1); });
      fireEvent.click(panel.getByTestId("templates-done"));
      expect(panel.queryByTestId("templates")).toBeNull();
      expect(document.activeElement).toBe(toggle);
      expect(toggle.getAttribute("aria-disabled")).toBe("true");
      fireEvent.click(toggle);
      expect(panel.queryByTestId("templates")).toBeNull();
    });

    it("asks before a template replaces a line with a price but no words yet, and keeps it to copy", async () => {
      render(<ProposalsDesk />);
      const element = await openProposal();
      const panel = within(element);
      fireEvent.click(await panel.findByTestId("add-quote-line"));
      fireEvent.change(panel.getByTestId("quote-qty-0"), { target: { value: "3" } });
      fireEvent.change(panel.getByTestId("quote-price-0"), { target: { value: "450" } });
      fireEvent.click(panel.getByTestId("template-toggle"));
      fireEvent.click(await panel.findByRole("button", { name: "Use Grand Hall wedding" }));
      expect(panel.getByTestId("template-question").textContent).toContain("The composer already has 1 line.");
      fireEvent.click(within(panel.getByTestId("template-choice")).getByRole("button", { name: "Replace them" }));
      await waitFor(() => { expect(messageOf(element)).toBe(MESSAGE); });
      expect(within(panel.getByTestId("kept-version")).getByText("A line with no description · 3 × £450")).toBeDefined();
    });
  });

  describe("the panel holds Send and Withdraw for template work, and lets them go", () => {
    it("holds Send and Withdraw while a template is priced and while one is removed, and lets them go after", async () => {
      carried();
      const prices = held<Record<string, unknown>[]>();
      mocks.listPricingRules.mockReturnValueOnce(prices.promise);
      const removing = held<undefined>();
      render(<ProposalsDesk />);
      const element = await openProposal();
      const panel = within(element);
      await waitFor(() => { expect(messageOf(element)).toBe("Dear Elaine, here is the hall for your day."); });
      const send = (): HTMLButtonElement => panel.getByTestId<HTMLButtonElement>("send-open");
      const withdraw = (): HTMLButtonElement => panel.getByTestId<HTMLButtonElement>("withdraw-button");
      expect(send().disabled).toBe(false);
      expect(withdraw().disabled).toBe(false);
      fireEvent.click(panel.getByTestId("template-toggle"));
      fireEvent.click(await panel.findByRole("button", { name: "Use Grand Hall wedding" }));
      fireEvent.click(within(panel.getByTestId("template-choice")).getByRole("button", { name: "Add its lines" }));
      await waitFor(() => { expect(send().disabled).toBe(true); });
      expect(withdraw().disabled).toBe(true);
      await act(async () => { prices.resolve(PRICES); await Promise.resolve(); });
      await waitFor(() => { expect(quoteLines(element)).toHaveLength(3); });
      await waitFor(() => { expect(send().disabled).toBe(false); });
      expect(withdraw().disabled).toBe(false);

      mocks.removeProposalTemplate.mockReturnValueOnce(removing.promise);
      fireEvent.click(panel.getByTestId("template-toggle"));
      fireEvent.click(await panel.findByRole("button", { name: "Remove Grand Hall wedding" }));
      await waitFor(() => { expect(send().disabled).toBe(true); });
      expect(withdraw().disabled).toBe(true);
      stored = [];
      await act(async () => { removing.resolve(undefined); await Promise.resolve(); });
      await panel.findByTestId("template-undo");
      await waitFor(() => { expect(send().disabled).toBe(false); });
    });

    it("lets Withdraw go when the composer closes with a template save on its way", async () => {
      carried();
      const saving = held<Record<string, unknown>>();
      mocks.createProposalTemplate.mockReturnValueOnce(saving.promise);
      render(<ProposalsDesk />);
      const element = await openProposal();
      const panel = within(element);
      await waitFor(() => { expect(messageOf(element)).toBe("Dear Elaine, here is the hall for your day."); });
      const form = within(await openSave(element));
      fireEvent.click(form.getByTestId("template-save-submit"));
      await waitFor(() => { expect(mocks.createProposalTemplate).toHaveBeenCalledTimes(1); });
      await waitFor(() => { expect(panel.getByTestId<HTMLButtonElement>("withdraw-button").disabled).toBe(true); });
      // A colleague sends it meanwhile, and the booker comes back to the page: the composer closes.
      existing = [proposal({ status: "sent", currentVersion: 1, sentAt: "2026-10-02T09:00:00.000Z" })];
      act(() => { document.dispatchEvent(new Event("visibilitychange")); });
      await waitFor(() => { expect(panel.queryByTestId("composer")).toBeNull(); });
      await waitFor(() => { expect(panel.getByTestId<HTMLButtonElement>("withdraw-button").disabled).toBe(false); });
    });

    it("refuses to open Save as template while a template is priced, and the template still goes in", async () => {
      carried();
      const prices = held<Record<string, unknown>[]>();
      mocks.listPricingRules.mockReturnValueOnce(prices.promise);
      render(<ProposalsDesk />);
      const element = await openProposal();
      const panel = within(element);
      await waitFor(() => { expect(messageOf(element)).toBe("Dear Elaine, here is the hall for your day."); });
      fireEvent.click(panel.getByTestId("template-toggle"));
      fireEvent.click(await panel.findByRole("button", { name: "Use Grand Hall wedding" }));
      fireEvent.click(within(panel.getByTestId("template-choice")).getByRole("button", { name: "Add its lines" }));
      const toggle = panel.getByTestId("template-save-toggle");
      await waitFor(() => { expect(toggle.getAttribute("aria-disabled")).toBe("true"); });
      fireEvent.click(toggle);
      expect(panel.queryByTestId("template-save")).toBeNull();
      expect(mocks.getProposalEvent).toHaveBeenCalledTimes(1);
      await act(async () => { prices.resolve(PRICES); await Promise.resolve(); });
      await waitFor(() => { expect(quoteLines(element)).toHaveLength(3); });
      expect(sentences(panel.getByTestId("template-said"))[0]).toBe("Added 2 of Grand Hall wedding's 3 lines.");
    });

    it("saves a template while a reply posts, which replaces nothing", async () => {
      const posting = held<Record<string, unknown>>();
      mocks.postProposalComment.mockReturnValueOnce(posting.promise);
      mocks.createProposalTemplate.mockResolvedValueOnce(template("s1"));
      render(<ProposalsDesk />);
      const element = await openProposal();
      const panel = within(element);
      await compose(element);
      const form = within(await openSave(element));
      fireEvent.change(panel.getByTestId("reply-input"), { target: { value: "Thanks Elaine." } });
      fireEvent.click(panel.getByTestId("reply-submit"));
      await waitFor(() => { expect(mocks.postProposalComment).toHaveBeenCalledTimes(1); });
      expect(form.getByTestId("template-save-submit").getAttribute("aria-disabled")).toBe("false");
      fireEvent.click(form.getByTestId("template-save-submit"));
      await waitFor(() => { expect(panel.getByTestId("template-save-said").textContent).toBe("Saved the template Grand Hall wedding."); });
    });

    it("marks Replace it unavailable while a version saves", async () => {
      carried();
      mocks.createProposalTemplate.mockRejectedValueOnce(new ApiError(409, "Name taken", "NAME_TAKEN", template("c1")));
      const quoting = held<Record<string, unknown>>();
      mocks.createQuote.mockReturnValueOnce(quoting.promise);
      render(<ProposalsDesk />);
      const element = await openProposal();
      const panel = within(element);
      await waitFor(() => { expect(messageOf(element)).toBe("Dear Elaine, here is the hall for your day."); });
      const form = within(await openSave(element));
      fireEvent.click(form.getByTestId("template-save-submit"));
      const replace = await form.findByTestId("template-replace-existing");
      expect(replace.getAttribute("aria-disabled")).toBe("false");
      fireEvent.click(panel.getByRole("button", { name: "Save version 2" }));
      await waitFor(() => { expect(mocks.createQuote).toHaveBeenCalledTimes(1); });
      expect(replace.getAttribute("aria-disabled")).toBe("true");
      fireEvent.click(replace);
      expect(mocks.replaceProposalTemplate).not.toHaveBeenCalled();
    });

    it("offers Save as template only for what a template keeps, and keeps its button for focus when that goes", async () => {
      render(<ProposalsDesk />);
      const element = await openProposal();
      const panel = within(element);
      fireEvent.click(await panel.findByTestId("add-quote-line"));
      fireEvent.change(panel.getByTestId("quote-price-0"), { target: { value: "450" } });
      expect(panel.queryByTestId("template-save-toggle")).toBeNull();
      fireEvent.change(panel.getByTestId("composer-message"), { target: { value: "Dear Elaine," } });
      const form = within(await openSave(element));
      expect(form.getByTestId("template-kept").textContent).toContain("Line 1 has no description, so it is not kept.");
      fireEvent.change(panel.getByTestId("composer-message"), { target: { value: "" } });
      const cancel = form.getByRole("button", { name: "Cancel" });
      cancel.focus();
      fireEvent.click(cancel);
      const toggle = panel.getByTestId("template-save-toggle");
      expect(document.activeElement).toBe(toggle);
      expect(toggle.getAttribute("aria-disabled")).toBe("true");
      fireEvent.click(toggle);
      expect(panel.queryByTestId("template-save")).toBeNull();
      // The window losing focus blurs it while it is still focused: it stays.
      fireEvent.blur(toggle);
      expect(panel.getByTestId("template-save-toggle")).toBe(toggle);
      // Focus moving on within the page takes it away.
      panel.getByTestId("composer-message").focus();
      await waitFor(() => { expect(panel.queryByTestId("template-save-toggle")).toBeNull(); });
      fireEvent.change(panel.getByTestId("quote-desc-0"), { target: { value: "Piper" } });
      expect(panel.getByTestId("template-save-toggle")).toBeDefined();
    });

    it("offers a name in the event's own words for an occasion typed in free", async () => {
      mocks.getProposalEvent.mockResolvedValue({ facts: { ...FACTS, occasion: "AGM" }, spaceId: GH });
      render(<ProposalsDesk />);
      const element = await openProposal();
      await compose(element);
      fireEvent.click(within(element).getByTestId("template-save-toggle"));
      const form = within(await within(element).findByTestId("template-save"));
      await waitFor(() => { expect(form.getByTestId<HTMLInputElement>("template-name").value).toBe("Grand Hall AGM"); });
    });
  });

  describe("Save as template", () => {
    it("is offered only once the composer has words", async () => {
      render(<ProposalsDesk />);
      const panel = within(await openProposal());
      const message = await panel.findByTestId("composer-message");
      expect(panel.queryByTestId("template-save-toggle")).toBeNull();
      fireEvent.change(message, { target: { value: "Dear Elaine." } });
      expect(panel.getByTestId("template-save-toggle").textContent).toBe("Save as template");
      fireEvent.change(message, { target: { value: "   " } });
      expect(panel.queryByTestId("template-save-toggle")).toBeNull();
    });

    it("offers the event's room and occasion, names it from them, and says what is kept and what is not", async () => {
      render(<ProposalsDesk />);
      const element = await openProposal();
      await compose(element);
      // A price of your own differs from the list's.
      fireEvent.change(within(element).getByTestId("quote-price-0"), { target: { value: "2200" } });
      const form = within(await openSave(element));
      expect(form.getByTestId<HTMLSelectElement>("template-room").value).toBe(GH);
      expect(Array.from(form.getByTestId<HTMLSelectElement>("template-room").options).map((option) => option.text))
        .toEqual(["Any room", "Grand Hall", "Saloon"]);
      expect(form.getByTestId<HTMLSelectElement>("template-occasion").value).toBe("wedding");
      expect(sentences(form.getByTestId("template-kept"))).toEqual([
        "The message.",
        `From the price list, priced each time it is used: ${HIRE_NAME}; Late bar, 4 hours.`,
        "Typed, with the price entered each time: Piper.",
        `Your price for ${HIRE_NAME}, £2,200, differs from the list's £2,400. The template takes the list's price each time.`,
        "The capacity note is not kept.",
      ]);
      const submit = form.getByTestId("template-save-submit");
      expect(submit.getAttribute("aria-disabled")).toBe("false");
      expect(document.getElementById(submit.getAttribute("aria-describedby") ?? "")).toBe(form.getByTestId("template-kept"));
    });

    it("refuses an any-room template holding a room's price, and a message with a claim the venue cannot show", async () => {
      render(<ProposalsDesk />);
      const element = await openProposal();
      await compose(element);
      const form = within(await openSave(element));
      const submit = form.getByTestId("template-save-submit");
      fireEvent.change(form.getByTestId("template-room"), { target: { value: "" } });
      const refusal = form.getByTestId("template-save-refusal");
      expect(refusal.textContent).toBe(`${HIRE_NAME} is priced for the Grand Hall, so this template needs a room.`);
      expect(submit.getAttribute("aria-disabled")).toBe("true");
      expect(submit.getAttribute("aria-describedby")).toBe(refusal.id);
      fireEvent.click(submit);
      expect(mocks.createProposalTemplate).not.toHaveBeenCalled();

      fireEvent.change(form.getByTestId("template-room"), { target: { value: GH } });
      expect(form.queryByTestId("template-save-refusal")).toBeNull();
      fireEvent.change(within(element).getByTestId("composer-message"), { target: { value: "The hall is certified safe for 300." } });
      expect(form.getByTestId("template-save-refusal").textContent)
        .toBe("The message says \"certified safe\", a certainty the venue cannot show a client. Reword it first.");
      expect(submit.getAttribute("aria-disabled")).toBe("true");
      fireEvent.click(submit);
      expect(mocks.createProposalTemplate).not.toHaveBeenCalled();
    });

    it("saves the template with the lines as references and typed lines, says so, and gives focus back to its button", async () => {
      mocks.createProposalTemplate.mockImplementation((_venue: string, input: Record<string, unknown>) =>
        Promise.resolve(template("b1", input)));
      render(<ProposalsDesk />);
      const element = await openProposal();
      await compose(element);
      const form = within(await openSave(element));
      fireEvent.click(form.getByTestId("template-save-submit"));
      const toggle = within(element).getByTestId("template-save-toggle");
      await waitFor(() => { expect(within(element).queryByTestId("template-save")).toBeNull(); });
      expect(mocks.createProposalTemplate).toHaveBeenCalledWith("v1", {
        name: "Grand Hall wedding", spaceId: GH, occasion: "wedding", message: MESSAGE, lines: SENT_LINES,
      });
      expect(within(element).getByTestId("template-save-said").textContent).toBe("Saved the template Grand Hall wedding.");
      expect(document.activeElement).toBe(toggle);
      // The composer's own words are untouched.
      expect(messageOf(element)).toBe(MESSAGE);
    });

    it("offers to replace a template of the same name, as it was read, or to choose another name", async () => {
      const existingOne = template("c1", { updatedAt: "2026-09-30T08:00:00.000Z" });
      mocks.createProposalTemplate.mockRejectedValue(new ApiError(409, "Name taken", "NAME_TAKEN", existingOne));
      mocks.replaceProposalTemplate.mockImplementation((_venue: string, id: string) => Promise.resolve({ ...existingOne, id }));
      render(<ProposalsDesk />);
      const element = await openProposal();
      await compose(element);
      const form = within(await openSave(element));
      fireEvent.click(form.getByTestId("template-save-submit"));
      const taken = within(await form.findByTestId("template-name-taken"));
      expect(taken.getByRole("alert").textContent).toBe("A template is already called Grand Hall wedding.");
      fireEvent.click(taken.getByRole("button", { name: "Choose another name" }));
      expect(form.queryByTestId("template-name-taken")).toBeNull();
      expect(document.activeElement).toBe(form.getByTestId("template-name"));

      fireEvent.click(form.getByTestId("template-save-submit"));
      fireEvent.click(await form.findByTestId("template-replace-existing"));
      await waitFor(() => { expect(within(element).queryByTestId("template-save")).toBeNull(); });
      expect(mocks.replaceProposalTemplate).toHaveBeenCalledWith("v1", existingOne["id"], {
        name: "Grand Hall wedding", spaceId: GH, occasion: "wedding", message: MESSAGE, lines: SENT_LINES,
        expectedUpdatedAt: "2026-09-30T08:00:00.000Z",
      });
      expect(within(element).getByTestId("template-save-said").textContent).toBe("Replaced the template Grand Hall wedding.");
      expect(document.activeElement).toBe(within(element).getByTestId("template-save-toggle"));
    });

    it("never overwrites a template a colleague changed meanwhile unseen: it names them and offers Replace it or Keep theirs", async () => {
      const existingOne = template("c1", { updatedAt: "2026-09-30T08:00:00.000Z" });
      const theirs = template("c1", { updatedAt: "2026-10-02T09:59:00.000Z", updatedByName: "Anna Reid" });
      mocks.createProposalTemplate.mockRejectedValue(new ApiError(409, "Name taken", "NAME_TAKEN", existingOne));
      mocks.replaceProposalTemplate.mockRejectedValueOnce(new ApiError(409, "Changed", "TEMPLATE_CHANGED", theirs))
        .mockResolvedValueOnce(theirs);
      render(<ProposalsDesk />);
      const element = await openProposal();
      await compose(element);
      const form = within(await openSave(element));
      fireEvent.click(form.getByTestId("template-save-submit"));
      fireEvent.click(await form.findByTestId("template-replace-existing"));
      const changed = within(await form.findByTestId("template-changed"));
      expect(changed.getByRole("alert").textContent).toBe("Anna Reid changed Grand Hall wedding at 10:59.");
      expect(changed.getByRole("button", { name: "Keep theirs" })).toBeDefined();
      fireEvent.click(changed.getByRole("button", { name: "Replace it" }));
      await waitFor(() => { expect(within(element).queryByTestId("template-save")).toBeNull(); });
      expect(mocks.replaceProposalTemplate).toHaveBeenLastCalledWith("v1", theirs["id"],
        expect.objectContaining({ expectedUpdatedAt: "2026-10-02T09:59:00.000Z" }));
      expect(within(element).getByTestId("template-save-said").textContent).toBe("Replaced the template Grand Hall wedding.");
    });

    it("keeps the colleague's template on Keep theirs", async () => {
      const existingOne = template("c1", { updatedAt: "2026-09-30T08:00:00.000Z" });
      const theirs = template("c1", { updatedAt: "2026-10-02T09:59:00.000Z", updatedByName: "Anna Reid" });
      mocks.createProposalTemplate.mockRejectedValue(new ApiError(409, "Name taken", "NAME_TAKEN", existingOne));
      mocks.replaceProposalTemplate.mockRejectedValue(new ApiError(409, "Changed", "TEMPLATE_CHANGED", theirs));
      render(<ProposalsDesk />);
      const element = await openProposal();
      await compose(element);
      const form = within(await openSave(element));
      fireEvent.click(form.getByTestId("template-save-submit"));
      fireEvent.click(await form.findByTestId("template-replace-existing"));
      // Pressed, as a browser does, so focus is on it.
      const keep = await form.findByTestId("template-keep-theirs");
      keep.focus();
      fireEvent.click(keep);
      expect(within(element).queryByTestId("template-save")).toBeNull();
      expect(within(element).getByTestId("template-save-said").textContent).toBe("Kept Anna Reid's Grand Hall wedding.");
      expect(mocks.replaceProposalTemplate).toHaveBeenCalledTimes(1);
      expect(document.activeElement).toBe(within(element).getByTestId("template-save-toggle"));
    });

    it("reads the price list again when an entry changed while saving, and says to check what is kept", async () => {
      mocks.createProposalTemplate.mockRejectedValue(new ApiError(422, "A price-list entry is priced differently now", "PRICE_ENTRY_CHANGED",
        { names: ["Late bar"] }));
      render(<ProposalsDesk />);
      const element = await openProposal();
      await compose(element);
      const form = within(await openSave(element));
      const reads = mocks.listPricingRules.mock.calls.length;
      // The bar is taken off the list meanwhile.
      mocks.listPricingRules.mockResolvedValue([PRICES[0], PRICES[1]]);
      fireEvent.click(form.getByTestId("template-save-submit"));
      expect((await form.findByTestId("template-save-error")).textContent)
        .toBe("The price list changed while you saved. Check what is kept and save again.");
      expect(mocks.listPricingRules).toHaveBeenCalledTimes(reads + 1);
      await waitFor(() => {
        expect(sentences(form.getByTestId("template-kept"))).toContain("Typed, with the price entered each time: Late bar and Piper.");
      });
    });

    it("says a save with no answer could not be confirmed, whether the connection failed or the request did", async () => {
      mocks.createProposalTemplate.mockRejectedValueOnce(new ApiError(0, "Network error — check your connection", "NETWORK_ERROR"))
        .mockRejectedValueOnce(new ApiError(502, "Bad gateway", "UNKNOWN")).mockRejectedValueOnce(new Error("offline"));
      render(<ProposalsDesk />);
      const element = await openProposal();
      await compose(element);
      const form = within(await openSave(element));
      const words = "The save could not be confirmed. Start from a template shows whether it was kept.";
      fireEvent.click(form.getByTestId("template-save-submit"));
      expect((await form.findByTestId("template-save-error")).textContent).toBe(words);
      // Every field is kept to try again.
      expect(form.getByTestId<HTMLInputElement>("template-name").value).toBe("Grand Hall wedding");
      fireEvent.click(form.getByTestId("template-save-submit"));
      await waitFor(() => { expect(mocks.createProposalTemplate).toHaveBeenCalledTimes(2); });
      expect((await form.findByTestId("template-save-error")).textContent).toBe(words);
      fireEvent.click(form.getByTestId("template-save-submit"));
      await waitFor(() => { expect(mocks.createProposalTemplate).toHaveBeenCalledTimes(3); });
      expect((await form.findByTestId("template-save-error")).textContent).toBe(words);
    });

    it("says a refusal is a refusal: a room no longer listed, or a template the API will not keep", async () => {
      mocks.createProposalTemplate.mockRejectedValueOnce(new ApiError(422, "Room not at venue", "ROOM_NOT_AT_VENUE"))
        .mockRejectedValueOnce(new ApiError(400, "Validation failed", "VALIDATION_ERROR"));
      render(<ProposalsDesk />);
      const element = await openProposal();
      await compose(element);
      const form = within(await openSave(element));
      fireEvent.click(form.getByTestId("template-save-submit"));
      expect((await form.findByTestId("template-save-error")).textContent).toBe("That room is no longer listed. Choose another room.");
      fireEvent.click(form.getByTestId("template-save-submit"));
      await waitFor(() => { expect(form.getByTestId("template-save-error").textContent).toBe("The template could not be saved as it stands."); });
    });

    it("closes on Escape without closing the proposal, and gives focus back to its button", async () => {
      render(<ProposalsDesk />);
      const element = await openProposal();
      await compose(element);
      const form = within(await openSave(element));
      const name = form.getByTestId("template-name");
      name.focus();
      fireEvent.keyDown(name, { key: "Escape" });
      expect(within(element).queryByTestId("template-save")).toBeNull();
      expect(document.activeElement).toBe(within(element).getByTestId("template-save-toggle"));
      expect(screen.getByRole("heading", { level: 2, name: "Autumn gala" })).toBeDefined();
      expect(mocks.createProposalTemplate).not.toHaveBeenCalled();
    });
  });
});

// ---------------------------------------------------------------------------

describe("Draft the message with AI", () => {
  const BODY = "Dear Elaine, thank you for thinking of Trades Hall for your wedding on Friday 20 November.";
  const WRITTEN = "Dear Elaine, here is the hall for your day.";
  const DREW_ON = { event: true, enquiry: true, clientWords: false };
  /** A draft as the API answers one, with what it drew on; only its words,
   *  its notes and what it drew on are read here. */
  const draft = (overrides: Record<string, unknown> = {}, drewOn: Record<string, boolean> = DREW_ON): Record<string, unknown> => ({
    draft: {
      schemaVersion: "ai_assistant.v0", useCase: "proposal_draft", title: "Proposal draft", body: BODY,
      blockedUnsafeClaims: [], safeLanguageApplied: false, humanReviewRequired: true, provenance: "ai_generated",
      evidenceStatus: "unverified", sendState: "draft_only", generatedAt: NOW, digest: "c".repeat(64), ...overrides,
    },
    drewOn,
  });
  function later<T>(): { readonly promise: Promise<T>; readonly resolve: (value: T) => void } {
    let resolve: (value: T) => void = () => undefined;
    const promise = new Promise<T>((yes) => { resolve = yes; });
    return { promise, resolve };
  }
  const messageOf = (panel: HTMLElement): string =>
    within(panel).getByTestId<HTMLTextAreaElement>("composer-message").value;
  /** Asks for a draft and waits until it is shown. */
  async function drafted(panel: HTMLElement, answer: Record<string, unknown> = draft()): Promise<HTMLElement> {
    mocks.draftProposalMessage.mockResolvedValueOnce(answer);
    fireEvent.click(await within(panel).findByTestId("ai-draft-ask"));
    return within(panel).findByTestId("ai-draft-block");
  }
  /** A version-2 composer carrying version 1's message, capacity note and hire line. */
  function carried(): void {
    existing = [proposal({ currentVersion: 1 })];
    mocks.getLatestProposalVersion.mockResolvedValue(version(1, {
      clientMessage: WRITTEN, capacityNote: "Up to 120 at dinner rounds.",
      quote: quoteSnapshot([{ description: "Grand Hall hire", quantity: 1, unitAmountMinor: 240_000 }]),
    }));
  }

  beforeEach(() => { ai.available = true; });

  it("offers nothing about AI where no provider is configured, or until that is known", async () => {
    for (const answer of [false, undefined]) {
      ai.available = answer;
      render(<ProposalsDesk />);
      const element = await openProposal();
      await within(element).findByTestId("composer-message");
      expect(within(element).queryByTestId("ai-draft")).toBeNull();
      expect(within(element).queryByText(/\bAI\b/u)).toBeNull();
      cleanup();
    }
    expect(mocks.draftProposalMessage).not.toHaveBeenCalled();
  });

  it("drafts from the proposal alone, says so while it does, and shows the draft apart, in its ivory card, as AI wording not checked", async () => {
    const answer = later<Record<string, unknown>>();
    mocks.draftProposalMessage.mockReturnValueOnce(answer.promise);
    render(<ProposalsDesk />);
    const element = await openProposal();
    const panel = within(element);
    const ask = await panel.findByTestId("ai-draft-ask");
    expect(ask.textContent).toBe("Draft the message with AI");
    fireEvent.click(ask);
    expect(ask.getAttribute("aria-busy")).toBe("true");
    expect(ask.getAttribute("aria-disabled")).toBe("true");
    expect(ask.textContent).toBe("Drafting…");
    fireEvent.click(ask);
    expect(mocks.draftProposalMessage).toHaveBeenCalledTimes(1);
    expect(mocks.draftProposalMessage).toHaveBeenCalledWith("p1");

    await act(async () => { answer.resolve(draft()); await answer.promise; });
    const block = panel.getByRole("region", { name: "AI draft of the message" });
    expect(block).toBe(panel.getByTestId("ai-draft-block"));
    expect(block.getAttribute("data-register")).toBe("ivory");
    const inBlock = within(block);
    expect(inBlock.getByText("Written by AI from the event's details and the client's enquiry. Not checked.")).toBeDefined();
    const body = inBlock.getByTestId<HTMLTextAreaElement>("ai-draft-body");
    expect(body.value).toBe(BODY);
    expect(body.readOnly).toBe(true);
    expect(inBlock.queryByText("Unsupported certainty was taken out of it.")).toBeNull();
    await waitFor(() => { expect(document.activeElement).toBe(block.querySelector(".pr-ai__heading")); });
    // Nothing changes in the composer until the draft is used.
    expect(messageOf(element)).toBe("");
  });

  it("leaves focus where the booker put it while the draft was being written", async () => {
    const answer = later<Record<string, unknown>>();
    mocks.draftProposalMessage.mockReturnValueOnce(answer.promise);
    render(<ProposalsDesk />);
    const element = await openProposal();
    const panel = within(element);
    fireEvent.click(await panel.findByTestId("ai-draft-ask"));
    const capacity = panel.getByTestId("composer-capacity");
    capacity.focus();
    await act(async () => { answer.resolve(draft()); await answer.promise; });
    expect(panel.getByTestId("ai-draft-block")).toBeDefined();
    expect(document.activeElement).toBe(capacity);
  });

  it("used on an empty message, puts the draft in marked as not yet read through, and holds Save until it is", async () => {
    mocks.createProposalVersion.mockResolvedValue(version(1));
    render(<ProposalsDesk />);
    const element = await openProposal();
    const panel = within(element);
    const before = await panel.findByTestId("composer");
    fireEvent.click(within(await drafted(element)).getByTestId("ai-draft-use"));

    expect(messageOf(element)).toBe(BODY);
    expect(panel.getByTestId("composer")).toBe(before);
    expect(panel.queryByTestId("kept-version")).toBeNull();
    expect(panel.queryByTestId("ai-draft-block")).toBeNull();
    expect(panel.getByTestId("ai-draft-ask")).toBeDefined();
    const marker = panel.getByTestId("ai-unread");
    expect(marker.textContent).toBe("DraftAI wording, not yet read through.I have read it");
    expect(panel.getByTestId("composer-message").hasAttribute("data-ai-unread")).toBe(true);
    await waitFor(() => { expect(document.activeElement).toBe(panel.getByTestId("composer-message")); });

    const save = panel.getByRole("button", { name: "Save version 1" });
    const sentence = marker.querySelector("span[id]");
    if (sentence === null) throw new Error("The marker's sentence has no id");
    expect((save.getAttribute("aria-describedby") ?? "").split(" ")).toContain(sentence.id);
    fireEvent.click(save);
    expect(mocks.createProposalVersion).not.toHaveBeenCalled();
    expect(document.activeElement).toBe(panel.getByTestId("ai-read"));
    expect(panel.getByTestId("ai-said").textContent).toBe("Read the AI wording through first, then press I have read it.");

    fireEvent.click(panel.getByTestId("ai-read"));
    expect(panel.queryByTestId("ai-unread")).toBeNull();
    expect(panel.getByTestId("ai-said").textContent).toBe("");
    expect(document.activeElement).toBe(panel.getByTestId("composer-message"));
    expect(panel.getByTestId("composer-message").hasAttribute("data-ai-unread")).toBe(false);
    expect((save.getAttribute("aria-describedby") ?? "").split(" ")).not.toContain(sentence.id);
    fireEvent.click(save);
    await waitFor(() => { expect(mocks.createProposalVersion).toHaveBeenCalledTimes(1); });
    const payload = mocks.createProposalVersion.mock.calls[0]?.[1] as { clientMessage: string };
    expect(payload.clientMessage).toBe(BODY);
  });

  it("used over words written here and not saved, starts a new composer carrying the rest, and keeps those words to copy", async () => {
    carried();
    render(<ProposalsDesk />);
    const element = await openProposal();
    const panel = within(element);
    await waitFor(() => { expect(messageOf(element)).toBe(WRITTEN); });
    fireEvent.change(panel.getByTestId("composer-message"), { target: { value: "Dear Elaine, a few words of my own." } });
    const before = panel.getByTestId("composer");
    fireEvent.click(within(await drafted(element)).getByTestId("ai-draft-use"));

    await waitFor(() => { expect(messageOf(element)).toBe(BODY); });
    expect(panel.getByTestId("composer")).not.toBe(before);
    const kept = within(panel.getByTestId("kept-version"));
    expect(kept.getByTestId("kept-version-why").textContent).toBe("Kept when you used the AI draft.");
    expect(kept.getByText("Dear Elaine, a few words of my own.")).toBeDefined();
    expect(kept.queryByTestId("kept-ai-unread")).toBeNull();
    expect(panel.getByTestId<HTMLInputElement>("composer-capacity").value).toBe("Up to 120 at dinner rounds.");
    expect(panel.getByTestId<HTMLInputElement>("quote-desc-0").value).toBe("Grand Hall hire");
    expect(panel.getByTestId("ai-unread")).toBeDefined();
    await waitFor(() => { expect(document.activeElement).toBe(panel.getByTestId("composer-message")); });
  });

  it("replaces a message as the version holds it where it is, the version keeping it", async () => {
    carried();
    render(<ProposalsDesk />);
    const element = await openProposal();
    const panel = within(element);
    await waitFor(() => { expect(messageOf(element)).toBe(WRITTEN); });
    const before = panel.getByTestId("composer");
    fireEvent.click(within(await drafted(element)).getByTestId("ai-draft-use"));
    expect(messageOf(element)).toBe(BODY);
    expect(panel.getByTestId("composer")).toBe(before);
    expect(panel.queryByTestId("kept-version")).toBeNull();
    expect(panel.getByTestId("ai-unread")).toBeDefined();
  });

  it("keeps the mark through edits, and lets it go once the message is emptied", async () => {
    render(<ProposalsDesk />);
    const element = await openProposal();
    const panel = within(element);
    fireEvent.click(within(await drafted(element)).getByTestId("ai-draft-use"));
    fireEvent.change(panel.getByTestId("composer-message"), { target: { value: `${BODY} With warm wishes.` } });
    expect(panel.getByTestId("ai-unread")).toBeDefined();
    fireEvent.change(panel.getByTestId("composer-message"), { target: { value: "  " } });
    expect(panel.queryByTestId("ai-unread")).toBeNull();
    fireEvent.change(panel.getByTestId("composer-message"), { target: { value: "My own words." } });
    expect(panel.queryByTestId("ai-unread")).toBeNull();
  });

  it("puts the draft away with the message unchanged, back to its button", async () => {
    render(<ProposalsDesk />);
    const element = await openProposal();
    const panel = within(element);
    fireEvent.change(await panel.findByTestId("composer-message"), { target: { value: "My own words." } });
    fireEvent.click(within(await drafted(element)).getByTestId("ai-draft-away"));
    expect(panel.queryByTestId("ai-draft-block")).toBeNull();
    expect(messageOf(element)).toBe("My own words.");
    expect(panel.queryByTestId("ai-unread")).toBeNull();
    await waitFor(() => { expect(document.activeElement).toBe(panel.getByTestId("ai-draft-ask")); });
  });

  it("says when a draft could not be written, leaves the message, and drafts again on Try again", async () => {
    mocks.draftProposalMessage.mockRejectedValueOnce(new ApiError(502, "The AI draft could not be generated.", "AI_DRAFT_GENERATION_FAILED"));
    render(<ProposalsDesk />);
    const element = await openProposal();
    const panel = within(element);
    fireEvent.change(await panel.findByTestId("composer-message"), { target: { value: "My own words." } });
    fireEvent.click(panel.getByTestId("ai-draft-ask"));
    const failed = await panel.findByTestId("ai-draft-failed");
    expect(failed.getAttribute("role")).toBe("alert");
    expect(failed.textContent).toBe("The draft could not be written. The message is unchanged.");
    expect(messageOf(element)).toBe("My own words.");
    await waitFor(() => { expect(document.activeElement).toBe(panel.getByTestId("ai-draft-retry")); });

    mocks.draftProposalMessage.mockResolvedValueOnce(draft());
    fireEvent.click(panel.getByTestId("ai-draft-retry"));
    expect(await panel.findByTestId("ai-draft-block")).toBeDefined();
    expect(panel.queryByTestId("ai-draft-failed")).toBeNull();
    expect(mocks.draftProposalMessage).toHaveBeenCalledTimes(2);
  });

  it("takes AI drafting away for the visit when the server says it is not available now", async () => {
    mocks.draftProposalMessage.mockRejectedValueOnce(new ApiError(503, "AI drafting is not configured.", "AI_ASSISTANT_DISABLED"));
    render(<ProposalsDesk />);
    const element = await openProposal();
    const panel = within(element);
    fireEvent.click(await panel.findByTestId("ai-draft-ask"));
    const gone = await panel.findByTestId("ai-draft-gone");
    expect(gone.textContent).toBe("AI drafts are not available now. The message is unchanged.");
    expect(mocks.markAIDraftsUnavailable).toHaveBeenCalledTimes(1);
    expect(panel.queryByTestId("ai-draft-ask")).toBeNull();
    await waitFor(() => { expect(document.activeElement).toBe(gone); });
  });

  it("says what a draft holds that cannot go as it is, and offers Use only for one a message can hold", async () => {
    render(<ProposalsDesk />);
    const element = await openProposal();
    const panel = within(element);
    let block = await drafted(element, draft({ body: "a".repeat(4001) }));
    expect(within(block).getByTestId("ai-draft-too-long").textContent)
      .toBe("It is longer than a message can hold (4,000 characters). Draft again, or copy what you need.");
    expect(within(block).queryByTestId("ai-draft-use")).toBeNull();

    mocks.draftProposalMessage.mockResolvedValueOnce(draft({ body: "a".repeat(4000) }));
    fireEvent.click(within(block).getByTestId("ai-draft-again"));
    block = await panel.findByTestId("ai-draft-block");
    expect(within(block).queryByTestId("ai-draft-too-long")).toBeNull();
    expect(within(block).getByTestId("ai-draft-use")).toBeDefined();
    fireEvent.click(within(block).getByTestId("ai-draft-away"));

    block = await drafted(element, draft({ body: "Our photoreal digital twins show the hall as it is.", safeLanguageApplied: true }));
    expect(within(block).getByTestId("ai-draft-claim").textContent)
      .toBe("It includes \"photoreal digital twin\", which a proposal may not say. Change it before saving.");
    expect(within(block).getByText("Unsupported certainty was taken out of it.")).toBeDefined();
    expect(within(block).getByTestId("ai-draft-use")).toBeDefined();
  });

  it("holds Use while a save is on its way, and puts nothing in", async () => {
    const saving = later<Record<string, unknown>>();
    mocks.createProposalVersion.mockReturnValueOnce(saving.promise);
    render(<ProposalsDesk />);
    const element = await openProposal();
    const panel = within(element);
    fireEvent.change(await panel.findByTestId("composer-message"), { target: { value: "My own words." } });
    const block = await drafted(element);
    fireEvent.click(panel.getByRole("button", { name: "Save version 1" }));
    const use = within(block).getByTestId("ai-draft-use");
    await waitFor(() => { expect(use.getAttribute("aria-disabled")).toBe("true"); });
    fireEvent.click(use);
    expect(messageOf(element)).toBe("My own words.");
    expect(panel.queryByTestId("ai-unread")).toBeNull();
    await act(async () => { saving.resolve(version(1)); await saving.promise; });
  });

  it("drops a draft that answers after its proposal was left", async () => {
    existing = [proposal(), proposal({ id: "p2", title: "Spring ball" })];
    const answer = later<Record<string, unknown>>();
    mocks.draftProposalMessage.mockReturnValueOnce(answer.promise);
    render(<ProposalsDesk />);
    const first = await openProposal();
    fireEvent.click(await within(first).findByTestId("ai-draft-ask"));
    const second = await openProposal("p2", "Spring ball");
    await within(second).findByTestId("composer-message");
    await act(async () => { answer.resolve(draft()); await answer.promise; });
    expect(within(second).queryByTestId("ai-draft-block")).toBeNull();
    expect(messageOf(second)).toBe("");
    expect(within(second).getByTestId("ai-draft-ask").textContent).toBe("Draft the message with AI");
  });

  it("notes unread AI wording in a copy kept by Start again", async () => {
    render(<ProposalsDesk />);
    const element = await openProposal();
    const panel = within(element);
    fireEvent.click(within(await drafted(element)).getByTestId("ai-draft-use"));
    fireEvent.click(panel.getByTestId("composer-start-again"));
    const kept = within(await panel.findByTestId("kept-version"));
    expect(kept.getByText(BODY)).toBeDefined();
    expect(kept.getByTestId("kept-ai-unread").textContent).toBe("It holds AI wording not yet read through.");
    await waitFor(() => { expect(messageOf(element)).toBe(""); });
    expect(panel.queryByTestId("ai-unread")).toBeNull();
  });

  it("remembers the mark with the words when the booker leaves the proposal and comes back", async () => {
    existing = [proposal(), proposal({ id: "p2", title: "Spring ball" })];
    render(<ProposalsDesk />);
    const first = await openProposal();
    fireEvent.click(within(await drafted(first)).getByTestId("ai-draft-use"));
    await openProposal("p2", "Spring ball");
    const back = await openProposal();
    await waitFor(() => { expect(messageOf(back)).toBe(BODY); });
    expect(within(back).getByTestId("ai-unread")).toBeDefined();
  });
  it("says what a draft was written from, and only that", async () => {
    render(<ProposalsDesk />);
    const element = await openProposal();
    const panel = within(element);
    const said: string[] = [];
    for (const drewOn of [
      { event: false, enquiry: true, clientWords: true },
      { event: true, enquiry: false, clientWords: false },
      { event: true, enquiry: true, clientWords: true },
    ]) {
      const block = await drafted(element, draft({}, drewOn));
      said.push(within(block).getByTestId("ai-draft-from").textContent ?? "");
      fireEvent.click(within(block).getByTestId("ai-draft-away"));
      await panel.findByTestId("ai-draft-ask");
    }
    expect(said).toEqual([
      "Written by AI from the client's enquiry and the client's latest message. Not checked.",
      "Written by AI from the event's details. Not checked.",
      "Written by AI from the event's details, the client's enquiry and the client's latest message. Not checked.",
    ]);
  });

  it("says when there is nothing to draft from, and leaves the message as it is", async () => {
    mocks.draftProposalMessage.mockRejectedValueOnce(new ApiError(422, "Nothing to draft from", "NOTHING_TO_DRAFT_FROM"));
    render(<ProposalsDesk />);
    const element = await openProposal();
    const panel = within(element);
    fireEvent.change(await panel.findByTestId("composer-message"), { target: { value: "My own words." } });
    fireEvent.click(panel.getByTestId("ai-draft-ask"));
    const nothing = await panel.findByTestId("ai-draft-nothing");
    expect(nothing.textContent).toBe(
      "There is nothing for AI to draft from yet: this proposal has no event details, enquiry or message from the client. The message is unchanged.");
    expect(panel.queryByTestId("ai-draft-ask")).toBeNull();
    expect(messageOf(element)).toBe("My own words.");
    expect(mocks.markAIDraftsUnavailable).not.toHaveBeenCalled();
    await waitFor(() => { expect(document.activeElement).toBe(nothing); });
  });

  it("takes a 503 that is not the server's own word as a failure to try again, and Try again waits on the button drafting", async () => {
    mocks.draftProposalMessage.mockRejectedValueOnce(new ApiError(503, "Service Unavailable", "UNKNOWN"));
    render(<ProposalsDesk />);
    const element = await openProposal();
    const panel = within(element);
    fireEvent.click(await panel.findByTestId("ai-draft-ask"));
    expect(await panel.findByTestId("ai-draft-failed")).toBeDefined();
    expect(mocks.markAIDraftsUnavailable).not.toHaveBeenCalled();
    expect(panel.queryByTestId("ai-draft-gone")).toBeNull();

    const answer = later<Record<string, unknown>>();
    mocks.draftProposalMessage.mockReturnValueOnce(answer.promise);
    const retry = await panel.findByTestId("ai-draft-retry");
    retry.focus();
    fireEvent.click(retry);
    await waitFor(() => { expect(document.activeElement).toBe(panel.getByTestId("ai-draft-ask")); });
    expect(panel.getByTestId("ai-draft-ask").textContent).toBe("Drafting…");
    expect(panel.getByTestId("ai-draft-said").textContent).toBe("Drafting the message with AI.");
    await act(async () => { answer.resolve(draft()); await answer.promise; });
    const block = panel.getByTestId("ai-draft-block");
    await waitFor(() => { expect(document.activeElement).toBe(block.querySelector(".pr-ai__heading")); });
    expect(panel.getByTestId("ai-draft-said").textContent).toBe("");
  });

  it("never takes focus out of another part's flow when the draft arrives, and says it is ready instead", async () => {
    const answer = later<Record<string, unknown>>();
    mocks.draftProposalMessage.mockReturnValueOnce(answer.promise);
    render(<ProposalsDesk />);
    const element = await openProposal();
    const panel = within(element);
    // Asked from its button, as a press in a browser leaves focus there.
    const ask = await panel.findByTestId("ai-draft-ask");
    ask.focus();
    fireEvent.click(ask);
    // The panel's heading, where another flow (a template's question, a
    // reply) parks focus.
    const heading = screen.getByRole("heading", { level: 2, name: "Autumn gala" });
    heading.focus();
    expect(document.activeElement).toBe(heading);
    await act(async () => { answer.resolve(draft()); await answer.promise; });
    expect(panel.getByTestId("ai-draft-block")).toBeDefined();
    expect(document.activeElement).toBe(heading);
    expect(panel.getByTestId("ai-draft-said").textContent).toBe("The AI draft is ready, under the message.");
  });

  it("describes the message by its mark, says the draft is now the message, and marks its words again if they come back", async () => {
    render(<ProposalsDesk />);
    const element = await openProposal();
    const panel = within(element);
    fireEvent.click(within(await drafted(element)).getByTestId("ai-draft-use"));
    const message = panel.getByTestId("composer-message");
    const marker = panel.getByTestId("ai-unread");
    expect(marker.querySelector("svg")).not.toBeNull();
    expect(message.getAttribute("aria-describedby")).toBe(marker.querySelector("span[id]")?.id);
    expect(panel.getByTestId("ai-said").textContent).toBe("The AI draft is now the message, marked until you have read it through.");

    // Emptied, the mark and what was said go; the AI's words brought back
    // (an undo, a paste) are marked again.
    fireEvent.change(message, { target: { value: "" } });
    expect(panel.queryByTestId("ai-unread")).toBeNull();
    expect(message.hasAttribute("aria-describedby")).toBe(false);
    expect(panel.getByTestId("ai-said").textContent).toBe("");
    fireEvent.change(message, { target: { value: BODY } });
    expect(panel.getByTestId("ai-unread")).toBeDefined();
    fireEvent.change(message, { target: { value: `Hello. ${BODY}` } });
    expect(panel.getByTestId("ai-unread")).toBeDefined();

    // Read through, it is the booker's: emptied and brought back, it stays unmarked.
    fireEvent.click(panel.getByTestId("ai-read"));
    fireEvent.change(message, { target: { value: "" } });
    fireEvent.change(message, { target: { value: BODY } });
    expect(panel.queryByTestId("ai-unread")).toBeNull();
  });

  it("holds Save as template while the message holds AI wording not yet read through", async () => {
    mocks.listProposalTemplates.mockResolvedValue([]);
    mocks.getProposalEvent.mockResolvedValue({
      facts: { eventDate: "2026-11-20", guestCount: 120, occasion: "wedding", roomName: "Grand Hall", roomSlug: "grand-hall" }, spaceId: null,
    });
    render(<ProposalsDesk />);
    const element = await openProposal();
    const panel = within(element);
    fireEvent.click(within(await drafted(element)).getByTestId("ai-draft-use"));
    fireEvent.click(panel.getByTestId("template-save-toggle"));
    const form = await panel.findByTestId("template-save");
    const refusal = await within(form).findByTestId("template-save-refusal");
    expect(refusal.textContent).toBe("The message holds AI wording not yet read through. Press I have read it under the message first.");
    const save = within(form).getByRole("button", { name: "Save template" });
    expect(save.getAttribute("aria-disabled")).toBe("true");
    fireEvent.click(save);
    expect(mocks.createProposalTemplate).not.toHaveBeenCalled();

    fireEvent.click(panel.getByTestId("ai-read"));
    await waitFor(() => {
      expect(within(form).queryByText("The message holds AI wording not yet read through. Press I have read it under the message first.")).toBeNull();
    });
  });
  it("never marks the booker's own words after a draft is deleted a little at a time", async () => {
    render(<ProposalsDesk />);
    const element = await openProposal();
    const panel = within(element);
    fireEvent.click(within(await drafted(element)).getByTestId("ai-draft-use"));
    const message = panel.getByTestId("composer-message");
    for (let cut = BODY.length - 1; cut >= 0; cut -= 7) fireEvent.change(message, { target: { value: BODY.slice(0, cut) } });
    fireEvent.change(message, { target: { value: "" } });
    expect(panel.queryByTestId("ai-unread")).toBeNull();
    let typed = "";
    for (const letter of "Dear Mr Crawford, thank you for your note.") {
      typed += letter;
      fireEvent.change(message, { target: { value: typed } });
    }
    expect(panel.queryByTestId("ai-unread")).toBeNull();
    // The draft brought back whole (an undo) is marked again.
    fireEvent.change(message, { target: { value: `${typed} ${BODY}` } });
    expect(panel.getByTestId("ai-unread")).toBeDefined();
  });

  it("marks words copied from the draft shown, and from a kept copy not yet read through", async () => {
    render(<ProposalsDesk />);
    const element = await openProposal();
    const panel = within(element);
    await drafted(element);
    const message = panel.getByTestId("composer-message");
    fireEvent.change(message, { target: { value: `My own start. ${BODY.slice(13)}` } });
    expect(panel.getByTestId("ai-unread")).toBeDefined();

    // Kept to copy by Start again, then pasted into the fresh composer.
    fireEvent.click(within(panel.getByTestId("ai-draft-block")).getByTestId("ai-draft-away"));
    fireEvent.click(panel.getByTestId("composer-start-again"));
    expect(within(await panel.findByTestId("kept-version")).getByTestId("kept-ai-unread")).toBeDefined();
    await waitFor(() => { expect(messageOf(element)).toBe(""); });
    fireEvent.change(panel.getByTestId("composer-message"), { target: { value: `My own start. ${BODY.slice(13)}` } });
    expect(panel.getByTestId("ai-unread")).toBeDefined();
  });

  it("still marks AI words brought back after the booker leaves the proposal and comes back", async () => {
    existing = [proposal(), proposal({ id: "p2", title: "Spring ball" })];
    render(<ProposalsDesk />);
    const first = await openProposal();
    fireEvent.click(within(await drafted(first)).getByTestId("ai-draft-use"));
    await openProposal("p2", "Spring ball");
    const back = await openProposal();
    await waitFor(() => { expect(messageOf(back)).toBe(BODY); });
    const message = within(back).getByTestId("composer-message");
    fireEvent.change(message, { target: { value: "" } });
    expect(within(back).queryByTestId("ai-unread")).toBeNull();
    fireEvent.change(message, { target: { value: BODY } });
    expect(within(back).getByTestId("ai-unread")).toBeDefined();
  });

  it("says plainly when a draft is refused for the proposal as it stands, with no Try again that cannot work", async () => {
    mocks.draftProposalMessage.mockRejectedValueOnce(new ApiError(422, "Proposal content is frozen", "NOT_EDITABLE"));
    render(<ProposalsDesk />);
    const element = await openProposal();
    const panel = within(element);
    fireEvent.click(await panel.findByTestId("ai-draft-ask"));
    const refused = await panel.findByTestId("ai-draft-refused");
    expect(refused.textContent).toBe("A draft cannot be written for this proposal as it stands. The message is unchanged.");
    expect(panel.queryByTestId("ai-draft-retry")).toBeNull();
    expect(panel.queryByTestId("ai-draft-ask")).toBeNull();
    expect(mocks.markAIDraftsUnavailable).not.toHaveBeenCalled();
  });

  it("says that AI is not available, or that there is nothing to draft from, where focus cannot go", async () => {
    for (const [error, words] of [
      [new ApiError(503, "Off", "AI_ASSISTANT_DISABLED"), "AI drafts are not available now. The message is unchanged."],
      [new ApiError(422, "Nothing", "NOTHING_TO_DRAFT_FROM"),
        "There is nothing for AI to draft from yet: this proposal has no event details, enquiry or message from the client. The message is unchanged."],
    ] as const) {
      let refuse: (reason: unknown) => void = () => undefined;
      mocks.draftProposalMessage.mockReturnValueOnce(new Promise((_, no) => { refuse = no; }));
      render(<ProposalsDesk />);
      const element = await openProposal();
      const panel = within(element);
      const ask = await panel.findByTestId("ai-draft-ask");
      ask.focus();
      fireEvent.click(ask);
      const capacity = panel.getByTestId("composer-capacity");
      capacity.focus();
      await act(async () => { refuse(error); await Promise.resolve(); });
      await waitFor(() => { expect(panel.getByTestId("ai-draft-said").textContent).toBe(words); });
      expect(document.activeElement).toBe(capacity);
      cleanup();
    }
  });
  it("marks words copied from a draft even after it is put away", async () => {
    render(<ProposalsDesk />);
    const element = await openProposal();
    const panel = within(element);
    fireEvent.click(within(await drafted(element)).getByTestId("ai-draft-away"));
    await panel.findByTestId("ai-draft-ask");
    fireEvent.change(panel.getByTestId("composer-message"), { target: { value: `My own start. ${BODY.slice(13)}` } });
    expect(panel.getByTestId("ai-unread")).toBeDefined();
  });

  it("offers Try again when the sign-in has lapsed, rather than calling the draft refused", async () => {
    mocks.draftProposalMessage.mockRejectedValueOnce(new ApiError(401, "Session expired", "UNAUTHORIZED"));
    render(<ProposalsDesk />);
    const element = await openProposal();
    const panel = within(element);
    fireEvent.click(await panel.findByTestId("ai-draft-ask"));
    expect(await panel.findByTestId("ai-draft-retry")).toBeDefined();
    expect(panel.queryByTestId("ai-draft-refused")).toBeNull();
  });
  it("never marks the version's own saved words, brought back, as AI words not read", async () => {
    carried();
    mocks.getLatestProposalVersion.mockResolvedValue(version(1, { clientMessage: BODY }));
    render(<ProposalsDesk />);
    const element = await openProposal();
    const panel = within(element);
    await waitFor(() => { expect(messageOf(element)).toBe(BODY); });
    // The same words shown again as a draft, then the message emptied and undone.
    await drafted(element);
    const message = panel.getByTestId("composer-message");
    fireEvent.change(message, { target: { value: "" } });
    fireEvent.change(message, { target: { value: BODY } });
    expect(panel.queryByTestId("ai-unread")).toBeNull();
  });
});
