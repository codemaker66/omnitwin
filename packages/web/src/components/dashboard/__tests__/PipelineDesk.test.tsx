import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { StrictMode } from "react";
import { ApiError } from "../../../api/client.js";
import { PipelineDesk } from "../PipelineDesk.js";

// ---------------------------------------------------------------------------
// The pipeline desk (roadmap X1): open deals by when their next step is due,
// the live stages on the copper plane with what they are worth, and one deal
// in the forest panel with the one next step its stage allows. Closing a deal
// asks why; every failure says what is and is not true afterwards.
// ---------------------------------------------------------------------------

const mocks = vi.hoisted(() => ({
  addFollowUpTask: vi.fn(),
  addOpportunityActivity: vi.fn(),
  createOpportunity: vi.fn(),
  createProposal: vi.fn(),
  getOpportunity: vi.fn(),
  getPipeline: vi.fn(),
  updateFollowUpTaskStatus: vi.fn(),
  updateOpportunity: vi.fn(),
}));

vi.mock("../../../api/crm.js", async (importOriginal) => ({
  ...await importOriginal<typeof import("../../../api/crm.js")>(),
  addFollowUpTask: mocks.addFollowUpTask,
  addOpportunityActivity: mocks.addOpportunityActivity,
  createOpportunity: mocks.createOpportunity,
  getOpportunity: mocks.getOpportunity,
  getPipeline: mocks.getPipeline,
  updateFollowUpTaskStatus: mocks.updateFollowUpTaskStatus,
  updateOpportunity: mocks.updateOpportunity,
}));

vi.mock("../../../api/proposals.js", async (importOriginal) => ({
  ...await importOriginal<typeof import("../../../api/proposals.js")>(),
  createProposal: mocks.createProposal,
}));

const authState = vi.hoisted(() => ({
  user: { id: "u1", role: "staff", platformRole: "none" as const, venueId: "v1" as string | null, email: "staff@test.com", name: "Catherine Tait" },
}));

vi.mock("../../../stores/auth-store.js", () => ({
  useAuthStore: (selector: (state: { user: typeof authState.user }) => unknown): unknown => selector({ user: authState.user }),
}));

/** 11:00 in Glasgow on Friday 2 October 2026. */
const NOW = "2026-10-02T10:00:00.000Z";

function deal(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: "opp1", venueId: "v1", clientAccountId: "acct1", primaryContactId: "contact1", sourceEnquiryId: "enq1", ownerUserId: "u1",
    title: "Henderson wedding", stage: "new", eventType: "wedding", preferredDate: "2027-06-05", guestCount: 160,
    estimatedValueMinor: 1_840_000, currency: "GBP", nextAction: "Confirm the date and numbers", nextActionDueAt: "2026-10-02T12:00:00.000Z",
    createdAt: "2026-09-20T09:00:00.000Z", updatedAt: "2026-09-30T09:00:00.000Z", closedAt: null, deletedAt: null,
    contactName: "Ailsa Henderson",
    ...overrides,
  };
}

function followUp(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: "task1", opportunityId: "opp1", assignedTo: "u1", title: "Send the menu", dueAt: "2026-10-01T12:00:00.000Z", status: "open",
    completedAt: null, createdAt: "2026-09-28T09:00:00.000Z", updatedAt: "2026-09-28T09:00:00.000Z", opportunityTitle: "Henderson wedding",
    ...overrides,
  };
}

function proposal(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: "prop1", venueId: "v1", opportunityId: "opp1", enquiryId: "enq1", configurationId: null, title: "Henderson wedding proposal",
    status: "draft", currentVersion: 0, shareCode: null, sentAt: null, createdBy: "u1", createdAt: NOW, updatedAt: NOW, deletedAt: null,
    ...overrides,
  };
}

function pipeline(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  const rows = (overrides["opportunities"] as unknown[] | undefined) ?? [deal()];
  return {
    opportunities: rows,
    todayTasks: [followUp()],
    stageCounts: { new: 1, qualified: 4, proposal_drafting: 0, proposal_sent: 2, negotiation: 1, won: 3, lost: 1, archived: 2 },
    stageValues: { new: 1_840_000, qualified: 1_200_000, proposal_drafting: 0, proposal_sent: 900_000, negotiation: 400_000, won: 5_000_000, lost: 0, archived: 0 },
    due: { overdue: 1, today: 2 },
    // Served, never summed from the rows: the ledger shows one page.
    pipelineValueMinor: 4_340_000,
    currency: "GBP",
    page: { total: rows.length, limit: 50, offset: 0, taskTotal: 1, taskLimit: 50, taskOffset: 0 },
    ...overrides,
  };
}

function detail(overrides: Record<string, unknown> = {}, dealOverrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    opportunity: deal(dealOverrides),
    activities: [{ id: "act1", opportunityId: "opp1", type: "note", body: "Prefers a later start.", createdBy: "u1", createdAt: "2026-09-29T09:00:00.000Z" }],
    tasks: [followUp()],
    proposals: [],
    history: [],
    contact: { id: "contact1", name: "Ailsa Henderson", email: "ailsa@example.test", phone: "0141 555 0100", accountName: "Henderson Family" },
    room: "Grand Hall",
    latestQuote: null,
    ...overrides,
  };
}

function quote(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: "quote1", name: "Henderson wedding proposal quote", status: "draft", currency: "GBP", totalMinor: 1_580_000,
    createdAt: "2026-09-30T09:00:00.000Z", ...overrides,
  };
}

function wideDesk(): void {
  vi.spyOn(window, "matchMedia").mockImplementation((query: string): MediaQueryList => ({
    matches: query === "(min-width: 1180px)" || query === "(pointer: fine)",
    media: query, onchange: null,
    addListener: () => undefined, removeListener: () => undefined,
    addEventListener: () => undefined, removeEventListener: () => undefined, dispatchEvent: () => false,
  }));
}

function row(name: RegExp): HTMLElement {
  const match = [...document.querySelectorAll<HTMLElement>("button[data-deal-id]")]
    .find((button) => name.test(button.getAttribute("aria-label") ?? ""));
  if (match === undefined) throw new Error(`No deal row for ${String(name)}`);
  return match;
}

async function openDeal(name = /^Henderson wedding,/u): Promise<HTMLElement> {
  fireEvent.click(await waitFor(() => row(name)));
  const heading = await screen.findByRole("heading", { level: 2, name: "Henderson wedding" });
  const panel = heading.closest("section");
  if (panel === null) throw new Error("No panel");
  return panel;
}

function groupLabels(): string[] {
  return [...document.querySelectorAll(".enq-group")].map((heading) => heading.firstChild?.textContent ?? "");
}

beforeEach(() => {
  for (const fn of Object.values(mocks)) fn.mockReset();
  authState.user = { ...authState.user, venueId: "v1" };
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(NOW);
  mocks.getPipeline.mockResolvedValue(pipeline());
  mocks.getOpportunity.mockResolvedValue(detail());
  wideDesk();
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("the ledger", () => {
  it("lists open deals by when their next step is due, then the won and lost, in the venue's words", async () => {
    mocks.getPipeline.mockResolvedValue(pipeline({
      opportunities: [
        deal({ id: "o1", title: "Overdue ball", nextActionDueAt: "2026-09-29T12:00:00.000Z" }),
        deal({ id: "o2", title: "Today's dinner", nextActionDueAt: "2026-10-02T15:00:00.000Z" }),
        deal({ id: "o3", title: "Thursday lunch", nextActionDueAt: "2026-10-08T12:00:00.000Z" }),
        deal({ id: "o4", title: "Spring gala", nextActionDueAt: "2026-11-20T12:00:00.000Z" }),
        deal({ id: "o5", title: "Undated party", nextActionDueAt: null, guestCount: null }),
        deal({ id: "o6", title: "Won wedding", stage: "won", closedAt: "2026-09-30T10:00:00.000Z" }),
      ],
    }));
    render(<PipelineDesk />);

    await waitFor(() => row(/^Overdue ball/u));
    expect(mocks.getPipeline).toHaveBeenCalledWith({ order: "due", limit: 50 });
    expect(groupLabels()).toEqual(["Overdue", "Due today", "This week", "Later", "No date set", "Won and lost"]);
    expect(row(/^Overdue ball/u).getAttribute("aria-label")).toBe(
      "Overdue ball, New, event Saturday 5 June 2027, Ailsa Henderson, Wedding, 160 guests, £18,400, overdue by 3 days: Confirm the date and numbers",
    );
    expect(row(/^Thursday lunch/u).getAttribute("aria-label")).toContain("due Thursday: Confirm");
    expect(row(/^Spring gala/u).getAttribute("aria-label")).toContain("due 20 Nov: Confirm");
    // A guest count still to come is left out rather than printed as "null guests".
    expect(row(/^Undated party/u).getAttribute("aria-label")).not.toMatch(/guests/u);
    expect(row(/^Won wedding/u).getAttribute("aria-label")).toMatch(/, Won 2 days ago$/u);
  });

  it("says what is owed today and what is open, from the pipeline's own figures", async () => {
    render(<PipelineDesk />);
    expect((await screen.findByTestId("pipeline-summary")).textContent)
      .toBe("2 deals have a step due today, and 1 is overdue. £43,400.00 is open across 8 deals.");
  });

  it("shows each live stage's count and worth, and filters the ledger by it", async () => {
    render(<PipelineDesk />);
    const qualified = await screen.findByRole("button", { name: "Qualified, 4, £12,000" });
    expect(screen.getByRole("button", { name: "All open, 8, £43,400" }).getAttribute("aria-pressed")).toBe("true");
    fireEvent.click(qualified);
    await waitFor(() => { expect(mocks.getPipeline).toHaveBeenLastCalledWith({ order: "due", limit: 50, stage: "qualified" }); });
    expect(qualified.getAttribute("aria-pressed")).toBe("true");
  });

  it("offers the rest of the pipeline on request, and no paging for a single page", async () => {
    mocks.getPipeline.mockResolvedValueOnce(pipeline({ page: { total: 51, limit: 50, offset: 0, taskTotal: 1, taskLimit: 50, taskOffset: 0 } }))
      .mockResolvedValueOnce(pipeline({ opportunities: [deal({ id: "o51", title: "Last dinner" })] }));
    render(<PipelineDesk />);
    fireEvent.click(await screen.findByRole("button", { name: "Show more (50 more)" }));
    await waitFor(() => row(/^Last dinner/u));
    expect(mocks.getPipeline).toHaveBeenLastCalledWith({ order: "due", limit: 50, offset: 1 });
    cleanup();

    mocks.getPipeline.mockResolvedValue(pipeline());
    render(<PipelineDesk />);
    await waitFor(() => row(/^Henderson wedding/u));
    expect(screen.queryByRole("button", { name: /^Show more/u })).toBeNull();
  });

  it("keeps the ledger when the pipeline cannot be read again, and tries again", async () => {
    mocks.getPipeline.mockRejectedValueOnce(new Error("Unavailable"));
    render(<PipelineDesk />);
    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toContain("The pipeline could not be read.");
    fireEvent.click(within(alert).getByRole("button", { name: "Try again" }));
    await waitFor(() => row(/^Henderson wedding/u));
  });
});

describe("the open deal", () => {
  it("opens a deal linked from the address, even under React's development double run, and says which is open", async () => {
    const shown = vi.fn();
    render(<StrictMode><PipelineDesk opportunityId="opp1" onOpportunityShown={shown} /></StrictMode>);
    expect(await screen.findByRole("heading", { level: 2, name: "Henderson wedding" })).toBeDefined();
    expect(shown).toHaveBeenLastCalledWith("opp1");
    expect(shown).not.toHaveBeenCalledWith(null);
  });

  it("never lets an older answer replace a newer one", async () => {
    let answerFirst: (value: unknown) => void = () => undefined;
    mocks.getOpportunity
      .mockImplementationOnce(() => new Promise((resolve) => { answerFirst = resolve; }))
      .mockResolvedValueOnce(detail({}, { id: "opp2", title: "Merchants' dinner" }));
    const shown = vi.fn();
    const view = render(<PipelineDesk opportunityId="opp1" onOpportunityShown={shown} />);
    await waitFor(() => { expect(shown).toHaveBeenCalledWith("opp1"); });
    view.rerender(<PipelineDesk opportunityId="opp2" onOpportunityShown={shown} />);
    expect(await screen.findByRole("heading", { level: 2, name: "Merchants' dinner" })).toBeDefined();
    await act(async () => { answerFirst(detail()); await Promise.resolve(); });
    expect(screen.queryByRole("heading", { level: 2, name: "Henderson wedding" })).toBeNull();
    expect(shown).toHaveBeenLastCalledWith("opp2");
  });

  it("shows the deal's facts, path, who it is with, its proposals and its timeline", async () => {
    mocks.getOpportunity.mockResolvedValue(detail({
      proposals: [proposal({ status: "sent", currentVersion: 2 })],
      history: [{ id: "h1", fromStage: "new", toStage: "qualified", note: "Date and numbers confirmed", changedByName: "Catherine Tait", createdAt: "2026-09-25T09:00:00.000Z" }],
    }, { stage: "qualified" }));
    const onOpenProposal = vi.fn();
    const onOpenClient = vi.fn();
    render(<PipelineDesk onOpenProposal={onOpenProposal} onOpenClient={onOpenClient} />);
    const panel = within(await openDeal());

    await waitFor(() => { expect(document.activeElement?.textContent).toBe("Henderson wedding"); });
    expect(panel.getByText("Deal · Wedding")).toBeDefined();
    const facts = [...document.querySelectorAll(".pl-facts > div")].map((fact) => fact.textContent);
    expect(facts).toEqual(["Saturday, in 8 months5 Jun 2027", "guests160", "roomGrand Hall"]);
    expect(panel.getByText("£18,400")).toBeDefined();
    const path = [...document.querySelectorAll(".pl-path li")].map((stop) => `${stop.textContent ?? ""}:${stop.getAttribute("data-state") ?? ""}`);
    expect(path).toEqual(["New:done", "Qualified:current", "Drafting:ahead", "Sent:ahead", "Won:ahead"]);
    expect(panel.getByRole("link", { name: "0141 555 0100" }).getAttribute("href")).toBe("tel:01415550100");
    fireEvent.click(panel.getByRole("button", { name: "Open in Clients" }));
    expect(onOpenClient).toHaveBeenCalledWith("contact1");
    fireEvent.click(panel.getByRole("button", { name: /^Henderson wedding proposal/u }));
    expect(onOpenProposal).toHaveBeenCalledWith("prop1");
    const timeline = [...document.querySelectorAll(".enq-timeline li strong")].map((moment) => moment.textContent);
    expect(timeline).toEqual(["Note", "Catherine Tait moved it to Qualified.", "The deal was opened."]);
    expect(panel.getByText("Date and numbers confirmed")).toBeDefined();
  });

  it("offers only the moves the deal can make from where it stands", async () => {
    mocks.updateOpportunity.mockResolvedValue(deal({ stage: "qualified" }));
    render(<PipelineDesk />);
    const panel = within(await openDeal());
    expect(panel.getByRole("button", { name: "Mark qualified" })).toBeDefined();
    expect(panel.getByRole("button", { name: "Mark lost…" })).toBeDefined();
    expect(panel.queryByRole("button", { name: "Mark won…" })).toBeNull();

    fireEvent.click(panel.getByRole("button", { name: "Mark qualified" }));
    await waitFor(() => { expect(mocks.updateOpportunity).toHaveBeenCalledWith("opp1", { stage: "qualified", note: null }); });
    // The deal and the ledger are read again, so the timeline and the order follow.
    await waitFor(() => { expect(mocks.getOpportunity).toHaveBeenCalledTimes(2); });
    expect(mocks.getPipeline).toHaveBeenCalledTimes(2);
  });

  it("marks a deal won only with the reason it was, offering the common ones", async () => {
    mocks.getOpportunity.mockResolvedValue(detail({}, { stage: "proposal_sent" }));
    mocks.updateOpportunity.mockResolvedValue(deal({ stage: "won", closedAt: NOW }));
    render(<PipelineDesk />);
    const panel = within(await openDeal());
    fireEvent.click(panel.getByRole("button", { name: "Mark won…" }));
    const confirm = within(await screen.findByTestId("deal-confirm-won"));
    expect(confirm.getByText("Mark Henderson wedding won?")).toBeDefined();
    expect(confirm.getByText("It leaves the open pipeline and counts as won. Nothing is sent to the client.")).toBeDefined();
    const mark = confirm.getByRole("button", { name: "Mark won" });
    expect((mark as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(confirm.getByRole("button", { name: "Accepted the proposal" }));
    expect((mark as HTMLButtonElement).disabled).toBe(false);
    fireEvent.click(mark);
    await waitFor(() => { expect(mocks.updateOpportunity).toHaveBeenCalledWith("opp1", { stage: "won", note: "Accepted the proposal" }); });
    expect(await screen.findByText("Henderson wedding is now won.")).toBeDefined();
  });

  it("keeps it open when Keep it open is chosen, and says so plainly when the move is refused", async () => {
    mocks.updateOpportunity.mockRejectedValue(new ApiError(422, "Cannot transition", "INVALID_TRANSITION"));
    render(<PipelineDesk />);
    const panel = within(await openDeal());
    fireEvent.click(panel.getByRole("button", { name: "Mark lost…" }));
    fireEvent.click(within(await screen.findByTestId("deal-confirm-lost")).getByRole("button", { name: "Keep it open" }));
    expect(screen.queryByTestId("deal-confirm-lost")).toBeNull();
    expect(mocks.updateOpportunity).not.toHaveBeenCalled();

    fireEvent.click(panel.getByRole("button", { name: "Mark qualified" }));
    expect(await screen.findByText("That move is not open from this stage any more. The deal has been read again.")).toBeDefined();
  });

  it("drafts a proposal from a qualified deal and moves it on, and never offers a second draft when only the move failed", async () => {
    mocks.getOpportunity.mockResolvedValue(detail({}, { stage: "qualified" }));
    mocks.createProposal.mockResolvedValue(proposal());
    mocks.updateOpportunity.mockRejectedValueOnce(new Error("Unavailable"));
    render(<PipelineDesk />);
    const panel = within(await openDeal());
    fireEvent.click(panel.getByRole("button", { name: "Draft a proposal" }));
    await waitFor(() => {
      expect(mocks.createProposal).toHaveBeenCalledWith({ venueId: "v1", opportunityId: "opp1", enquiryId: "enq1", title: "Henderson wedding proposal" });
    });
    expect(await screen.findByText("The proposal draft is made, but the deal did not move to Proposal drafting.")).toBeDefined();

    // Read again with its draft, the deal offers the move alone.
    mocks.getOpportunity.mockResolvedValue(detail({ proposals: [proposal()] }, { stage: "qualified" }));
    mocks.updateOpportunity.mockResolvedValue(deal({ stage: "proposal_drafting" }));
    fireEvent.click(screen.getByRole("button", { name: "Close deal" }));
    const again = within(await openDeal());
    expect(again.queryByRole("button", { name: "Draft a proposal" })).toBeNull();
    fireEvent.click(again.getByRole("button", { name: "Move to Proposal drafting" }));
    await waitFor(() => { expect(mocks.updateOpportunity).toHaveBeenLastCalledWith("opp1", { stage: "proposal_drafting", note: null }); });
    expect(mocks.createProposal).toHaveBeenCalledTimes(1);
  });

  it("saves the value in exact pence, and refuses one it cannot read without coercing it", async () => {
    mocks.updateOpportunity.mockResolvedValue(deal({ estimatedValueMinor: 12_050 }));
    // Read again after the save, the deal is as the server now holds it.
    mocks.getOpportunity.mockResolvedValueOnce(detail()).mockResolvedValue(detail({}, { estimatedValueMinor: 12_050 }));
    render(<PipelineDesk />);
    const panel = within(await openDeal());
    fireEvent.click(panel.getByRole("button", { name: "Change the value" }));
    const input = panel.getByLabelText("Estimated value, in pounds");
    fireEvent.change(input, { target: { value: "-10" } });
    fireEvent.click(panel.getByRole("button", { name: "Save the value" }));
    expect(panel.getByText("Enter pounds, like 18400 or 18400.50.")).toBeDefined();
    expect(mocks.updateOpportunity).not.toHaveBeenCalled();

    fireEvent.change(input, { target: { value: "120.50" } });
    fireEvent.click(panel.getByRole("button", { name: "Save the value" }));
    await waitFor(() => { expect(mocks.updateOpportunity).toHaveBeenCalledWith("opp1", { estimatedValueMinor: 12_050 }); });
    expect(await screen.findByText("£120.50")).toBeDefined();
  });

  it("offers the latest quote's total as the value, and says so once the value is the quote's", async () => {
    mocks.updateOpportunity.mockResolvedValue(deal({ estimatedValueMinor: 1_580_000 }));
    mocks.getOpportunity.mockResolvedValueOnce(detail({ latestQuote: quote() }))
      .mockResolvedValue(detail({ latestQuote: quote() }, { estimatedValueMinor: 1_580_000 }));
    render(<PipelineDesk />);
    const panel = within(await openDeal());
    expect(panel.getByText("£18,400")).toBeDefined();
    expect(panel.getByText("The latest quote comes to £15,800.")).toBeDefined();
    fireEvent.click(panel.getByRole("button", { name: "Use £15,800" }));
    await waitFor(() => { expect(mocks.updateOpportunity).toHaveBeenCalledWith("opp1", { estimatedValueMinor: 1_580_000 }); });
    expect(await screen.findByText("The latest quote's total.")).toBeDefined();
    expect(panel.getByText("£15,800")).toBeDefined();
    expect(panel.queryByRole("button", { name: /^Use / })).toBeNull();
  });

  it("offers no quote in another currency, and none where there is none", async () => {
    mocks.getOpportunity.mockResolvedValue(detail({ latestQuote: quote({ currency: "EUR" }) }));
    render(<PipelineDesk />);
    const panel = within(await openDeal());
    expect(panel.getByText("£18,400")).toBeDefined();
    expect(panel.queryByText(/latest quote/u)).toBeNull();
  });

  it("sets what is owed next and the day it is due", async () => {
    mocks.updateOpportunity.mockResolvedValue(deal({ nextAction: "Send the menus", nextActionDueAt: "2026-10-09T12:00:00.000Z" }));
    mocks.getOpportunity.mockResolvedValueOnce(detail())
      .mockResolvedValue(detail({}, { nextAction: "Send the menus", nextActionDueAt: "2026-10-09T12:00:00.000Z" }));
    render(<PipelineDesk />);
    const panel = within(await openDeal());
    expect(panel.getByText("Due today")).toBeDefined();
    fireEvent.click(panel.getByRole("button", { name: "Change" }));
    fireEvent.change(panel.getByLabelText("What is owed next"), { target: { value: "Send the menus" } });
    fireEvent.change(panel.getAllByLabelText("Due on")[0] as HTMLElement, { target: { value: "2026-10-09" } });
    fireEvent.click(panel.getByRole("button", { name: "Save the next step" }));
    await waitFor(() => {
      expect(mocks.updateOpportunity).toHaveBeenCalledWith("opp1", { nextAction: "Send the menus", nextActionDueAt: "2026-10-09T12:00:00.000Z" });
    });
    expect(await screen.findByText("Send the menus")).toBeDefined();
    expect(panel.getByText("Due 9 Oct")).toBeDefined();
  });

  it("adds a follow-up with its day, marks one done, and keeps a note's words when it fails", async () => {
    mocks.addFollowUpTask.mockResolvedValue(followUp({ id: "task2", title: "Book the piper" }));
    mocks.updateFollowUpTaskStatus.mockResolvedValue(followUp({ status: "done" }));
    mocks.addOpportunityActivity.mockRejectedValueOnce(new Error("Unavailable"));
    render(<PipelineDesk />);
    const panel = within(await openDeal());
    expect(panel.getByText("Due yesterday")).toBeDefined();

    fireEvent.change(panel.getByLabelText("A follow-up"), { target: { value: "Book the piper" } });
    fireEvent.change(panel.getAllByLabelText("Due on").at(-1) as HTMLElement, { target: { value: "2026-10-05" } });
    fireEvent.click(panel.getByRole("button", { name: "Add" }));
    await waitFor(() => { expect(mocks.addFollowUpTask).toHaveBeenCalledWith("opp1", "Book the piper", "2026-10-05T12:00:00.000Z"); });

    fireEvent.click(panel.getByRole("button", { name: "Mark “Send the menu” done" }));
    await waitFor(() => { expect(mocks.updateFollowUpTaskStatus).toHaveBeenCalledWith("opp1", "task1", "done"); });

    const note = panel.getByLabelText("Add a note");
    fireEvent.change(note, { target: { value: "Wants the piper at seven." } });
    fireEvent.click(panel.getByRole("button", { name: "Add the note" }));
    expect(await screen.findByText("The note did not save. Your words are still here.")).toBeDefined();
    expect((note as HTMLTextAreaElement).value).toBe("Wants the piper at seven.");
  });

  it("says a deal could not be opened, and tries again", async () => {
    mocks.getOpportunity.mockRejectedValueOnce(new Error("Unavailable"));
    render(<PipelineDesk />);
    fireEvent.click(await waitFor(() => row(/^Henderson wedding/u)));
    expect((await screen.findByTestId("opportunity-detail-error")).textContent).toBe("The deal could not be opened.");
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(await screen.findByRole("heading", { level: 2, name: "Henderson wedding" })).toBeDefined();
  });

  it("closes with Escape and returns the reader to the deal's row", async () => {
    const shown = vi.fn();
    render(<PipelineDesk onOpportunityShown={shown} />);
    const heading = (await openDeal()).querySelector("h2");
    if (heading === null) throw new Error("No heading");
    fireEvent.keyDown(heading, { key: "Escape" });
    await waitFor(() => { expect(document.activeElement).toBe(row(/^Henderson wedding/u)); });
    expect(shown).toHaveBeenLastCalledWith(null);
    expect(screen.getByRole("complementary", { name: "Pipeline overview" })).toBeDefined();
  });
});

describe("a new deal", () => {
  it("opens one with exact pence, refuses a value it cannot read, and says when the account has no venue", async () => {
    mocks.createOpportunity.mockResolvedValue({ opportunity: deal({ id: "opp9", title: "Winter dinner" }), task: null });
    mocks.getOpportunity.mockResolvedValue(detail({}, { id: "opp9", title: "Winter dinner" }));
    render(<PipelineDesk />);
    fireEvent.click(await screen.findByRole("button", { name: "New deal" }));
    fireEvent.change(screen.getByTestId("manual-opportunity-title"), { target: { value: "Winter dinner" } });
    fireEvent.change(screen.getByTestId("manual-opportunity-value"), { target: { value: "-10" } });
    fireEvent.click(screen.getByRole("button", { name: "Open the deal" }));
    expect(screen.getByTestId("manual-opportunity-error").textContent).toBe("Enter the value in pounds, like 18400 or 18400.50.");
    expect(mocks.createOpportunity).not.toHaveBeenCalled();

    fireEvent.change(screen.getByTestId("manual-opportunity-value"), { target: { value: "120.50" } });
    fireEvent.click(screen.getByRole("button", { name: "Open the deal" }));
    await waitFor(() => {
      expect(mocks.createOpportunity).toHaveBeenCalledWith({ venueId: "v1", title: "Winter dinner", estimatedValueMinor: 12_050, guestCount: null, preferredDate: null });
    });
    expect(await screen.findByRole("heading", { level: 2, name: "Winter dinner" })).toBeDefined();
    cleanup();

    authState.user = { ...authState.user, venueId: null };
    render(<PipelineDesk />);
    fireEvent.click(await screen.findByRole("button", { name: "New deal" }));
    fireEvent.change(screen.getByTestId("manual-opportunity-title"), { target: { value: "Winter dinner" } });
    fireEvent.click(screen.getByRole("button", { name: "Open the deal" }));
    expect(screen.getByTestId("manual-opportunity-error").textContent).toBe("Your account is not linked to a venue, so a deal cannot be opened here.");
  });
});
