import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { StrictMode } from "react";
import { ApiError } from "../../../api/client.js";
import { ProposalsDesk } from "../ProposalsDesk.js";

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
  getProposalHistory: vi.fn(),
  getProposalComments: vi.fn(),
  postProposalComment: vi.fn(),
  createProposal: vi.fn(),
  createProposalShareToken: vi.fn(),
  createProposalVersion: vi.fn(),
  createQuote: vi.fn(),
  transitionProposal: vi.fn(),
  listSpaces: vi.fn(),
}));

vi.mock("../../../api/proposals.js", async (importOriginal) => ({
  ...await importOriginal<typeof import("../../../api/proposals.js")>(),
  listProposalDesk: mocks.listProposalDesk,
  getDeskProposal: mocks.getDeskProposal,
  getLatestProposalVersion: mocks.getLatestProposalVersion,
  getProposalHistory: mocks.getProposalHistory,
  getProposalComments: mocks.getProposalComments,
  postProposalComment: mocks.postProposalComment,
  createProposal: mocks.createProposal,
  createProposalShareToken: mocks.createProposalShareToken,
  createProposalVersion: mocks.createProposalVersion,
  createQuote: mocks.createQuote,
  transitionProposal: mocks.transitionProposal,
}));
vi.mock("../../../api/spaces.js", () => ({ listSpaces: mocks.listSpaces }));

const authState = vi.hoisted(() => ({
  user: { id: "u1", role: "staff", platformRole: "none" as const, venueId: "v1" as string | null, email: "staff@test.com", name: "Catherine Tait" },
}));

vi.mock("../../../stores/auth-store.js", () => ({
  useAuthStore: (selector: (state: { user: typeof authState.user }) => unknown): unknown => selector({ user: authState.user }),
}));

/** 11:00 in Glasgow on Friday 2 October 2026. */
const NOW = "2026-10-02T10:00:00.000Z";

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

beforeEach(() => {
  for (const fn of Object.values(mocks)) fn.mockReset();
  authState.user = { ...authState.user, venueId: "v1" };
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
    expect(panel.getByTestId("composer-start").textContent).toBe("Starts from version 2. Nothing is changed from it yet.");
    expect(panel.getByRole("button", { name: "Save version 3" })).toBeDefined();

    fireEvent.change(message, { target: { value: "A later finish, as asked." } });
    fireEvent.change(panel.getByTestId("quote-price-0"), { target: { value: "4600" } });
    expect(panel.getByTestId("composer-start").textContent)
      .toBe("Starts from version 2. Changed: the message and the quote, £4,400 to £4,600.");
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

  it("shows no second copy while the composer still holds a version that did not arrive, and none once it saves", async () => {
    existing = [proposal({ status: "draft", currentVersion: 0 })];
    mocks.createProposalVersion.mockRejectedValueOnce(new Error("offline")).mockImplementationOnce((_id: string, payload: Record<string, unknown>) => {
      existing = [proposal({ currentVersion: 1 })];
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
    await waitFor(() => { expect(panel.getByTestId("composer-start").textContent).toBe("Starts from version 1. Nothing is changed from it yet."); });
    expect(panel.queryByTestId("kept-version")).toBeNull();
  });

  it("saves a first version without a quote, and the next then starts from it", async () => {
    mocks.createProposalVersion.mockImplementation((_id: string, payload: Record<string, unknown>) => {
      existing = [proposal({ currentVersion: 1 })];
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
    expect(mocks.createQuote).not.toHaveBeenCalled();
    await waitFor(() => { expect(panel.getByTestId("composer-start").textContent).toBe("Starts from version 1. Nothing is changed from it yet."); });
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
