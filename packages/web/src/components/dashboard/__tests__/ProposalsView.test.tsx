import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { ProposalsView } from "../ProposalsView.js";

const mocks = vi.hoisted(() => ({
  listProposals: vi.fn(),
  getProposal: vi.fn(),
  createProposal: vi.fn(),
  updateProposalTitle: vi.fn(),
  transitionProposal: vi.fn(),
  getProposalHistory: vi.fn(),
  createProposalVersion: vi.fn(),
  getLatestProposalVersion: vi.fn(),
  createQuote: vi.fn(),
  createProposalShareToken: vi.fn(),
  getProposalComments: vi.fn(),
  postProposalComment: vi.fn(),
  listSpaces: vi.fn(),
}));

vi.mock("../../../api/proposals.js", () => mocks);
vi.mock("../../../api/spaces.js", () => ({ listSpaces: mocks.listSpaces }));

const MOCK_USER = {
  id: "u1",
  role: "staff",
  venueId: "v1",
  email: "staff@test.com",
  name: "Staff",
};

vi.mock("../../../stores/auth-store.js", () => ({
  useAuthStore: (selector: (state: { user: typeof MOCK_USER }) => unknown): unknown =>
    selector({ user: MOCK_USER }),
}));

const NOW = "2026-06-12T00:00:00.000Z";

function draftProposal(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: "p1",
    venueId: "v1",
    opportunityId: null,
    enquiryId: null,
    configurationId: null,
    title: "Autumn gala",
    status: "draft",
    currentVersion: 0,
    shareCode: null,
    sentAt: null,
    createdBy: "u1",
    createdAt: NOW,
    updatedAt: NOW,
    deletedAt: null,
    ...overrides,
  };
}

function clientComment(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: "comment-client",
    kind: "comment",
    authorType: "client",
    authorName: "Elaine",
    body: "Could we review a later finish time?",
    isClientVisible: true,
    createdAt: NOW,
    ...overrides,
  };
}

function historyEntry(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: "history1",
    proposalId: "p1",
    fromStatus: "draft",
    toStatus: "sent",
    changedBy: "u1",
    note: "Shared with the client",
    createdAt: NOW,
    ...overrides,
  };
}

beforeEach(() => {
  for (const fn of Object.values(mocks)) fn.mockReset();
  mocks.listProposals.mockResolvedValue([]);
  mocks.listSpaces.mockResolvedValue([]);
  mocks.getProposalHistory.mockResolvedValue([]);
  mocks.getProposalComments.mockResolvedValue([]);
  mocks.postProposalComment.mockResolvedValue({
    id: "comment-staff",
    kind: "comment",
    authorType: "staff",
    authorName: "Venue team",
    body: "Thanks, we will review this with the team.",
    isClientVisible: true,
    createdAt: NOW,
  });
  mocks.getLatestProposalVersion.mockRejectedValue(new Error("404"));
});

// RTL auto-cleanup is not wired globally in this suite's environment —
// unmount explicitly so renders don't accumulate across tests.
afterEach(() => {
  cleanup();
});

async function selectFirstProposal(id: string): Promise<void> {
  const row = await screen.findByTestId(`proposal-row-${id}`);
  fireEvent.click(row);
}

describe("ProposalsView", () => {
  it("lists proposals and shows the empty state when none exist", async () => {
    mocks.listProposals.mockResolvedValue([draftProposal()]);
    render(<ProposalsView />);
    expect(await screen.findByTestId("proposal-row-p1")).toBeTruthy();

    cleanup();
    mocks.listProposals.mockResolvedValue([]);
    render(<ProposalsView />);
    expect(await screen.findByText(/No proposals yet/)).toBeTruthy();
  });

  it("shows a retryable proposal-list error instead of a dead empty panel", async () => {
    mocks.listProposals
      .mockRejectedValueOnce(new Error("network"))
      .mockResolvedValueOnce([draftProposal()]);
    render(<ProposalsView />);

    const listError = await screen.findByTestId("proposal-list-error");
    expect(listError.textContent).toContain("Couldn't load proposals");
    fireEvent.click(screen.getByRole("button", { name: "Retry proposals" }));

    expect(await screen.findByTestId("proposal-row-p1")).toBeTruthy();
    expect(mocks.listProposals).toHaveBeenCalledTimes(2);
  });

  it("creates a draft scoped to the staff member's venue", async () => {
    mocks.createProposal.mockResolvedValue(draftProposal({ title: "Winter ball" }));
    render(<ProposalsView />);

    fireEvent.change(await screen.findByTestId("create-title"), { target: { value: "Winter ball" } });
    fireEvent.click(screen.getByTestId("create-submit"));

    await waitFor(() => {
      expect(mocks.createProposal).toHaveBeenCalledWith({ venueId: "v1", title: "Winter ball" });
    });
    expect(await screen.findByRole("heading", { name: "Winter ball" })).toBeTruthy();
  });

  it("keeps create-draft failures visible in the create form", async () => {
    mocks.createProposal.mockRejectedValue(new Error("duplicate"));
    render(<ProposalsView />);

    fireEvent.change(await screen.findByTestId("create-title"), { target: { value: "Winter ball" } });
    fireEvent.click(screen.getByTestId("create-submit"));

    const error = await screen.findByTestId("create-error");
    expect(error.textContent).toContain("Could not create the proposal");
    expect(screen.queryByLabelText("Proposal detail")).toBeNull();
  });

  it("disables client-link generation until a version snapshot exists", async () => {
    mocks.listProposals.mockResolvedValue([draftProposal({ currentVersion: 0 })]);
    render(<ProposalsView />);
    await selectFirstProposal("p1");

    const send = await screen.findByTestId("send-button");
    expect((send as HTMLButtonElement).disabled).toBe(true);
  });

  it("generates a client share link once a version exists", async () => {
    mocks.listProposals.mockResolvedValue([draftProposal({ currentVersion: 2 })]);
    mocks.createProposalShareToken.mockResolvedValue({
      token: "client-token",
      shareUrl: "/proposal-share/client-token",
      tokenPrefix: "client-t",
      proposal: draftProposal({ status: "sent", currentVersion: 2, shareCode: "abcdef" }),
    });
    render(<ProposalsView />);
    await selectFirstProposal("p1");

    const send = await screen.findByTestId("send-button");
    expect((send as HTMLButtonElement).disabled).toBe(false);
    fireEvent.click(send);

    await waitFor(() => {
      expect(mocks.createProposalShareToken).toHaveBeenCalledWith("p1");
    });
    expect(await screen.findByTestId("share-link")).toBeTruthy();
  });

  it("loads client comments and posts a claim-guarded venue-team reply", async () => {
    mocks.listProposals.mockResolvedValue([draftProposal()]);
    mocks.getProposalComments.mockResolvedValue([clientComment()]);
    render(<ProposalsView />);
    await selectFirstProposal("p1");

    expect(await screen.findByTestId("comment-client")).toBeTruthy();
    fireEvent.change(screen.getByTestId("reply-input"), {
      target: { value: "Thanks Elaine - we will review this with the venue team." },
    });
    fireEvent.click(screen.getByTestId("reply-submit"));

    await waitFor(() => {
      expect(mocks.postProposalComment).toHaveBeenCalledWith(
        "p1",
        "Thanks Elaine - we will review this with the venue team.",
      );
    });
  });

  it("shows a retry action when the client conversation fails to load", async () => {
    mocks.listProposals.mockResolvedValue([draftProposal()]);
    mocks.getProposalComments
      .mockRejectedValueOnce(new Error("network"))
      .mockResolvedValueOnce([clientComment({ id: "comment-retry", body: "Retry loaded." })]);
    render(<ProposalsView />);
    await selectFirstProposal("p1");

    const conversationError = await screen.findByTestId("conversation-load-error");
    expect(conversationError.textContent).toContain("Couldn't load the client conversation");
    fireEvent.click(screen.getByRole("button", { name: "Retry conversation" }));

    expect(await screen.findByText("Retry loaded.")).toBeTruthy();
    expect(mocks.getProposalComments).toHaveBeenCalledTimes(2);
  });

  it("blocks unsupported certainty claims in venue-team replies", async () => {
    mocks.listProposals.mockResolvedValue([draftProposal()]);
    render(<ProposalsView />);
    await selectFirstProposal("p1");

    fireEvent.change(screen.getByTestId("reply-input"), {
      target: { value: "This layout is certified safe for the event." },
    });
    fireEvent.click(screen.getByTestId("reply-submit"));

    const error = await screen.findByTestId("reply-error");
    expect(error.textContent).toContain("certified safe");
    expect(mocks.postProposalComment).not.toHaveBeenCalled();
  });

  it("surfaces the claim guard inline and refuses to save unsupported wording", async () => {
    mocks.listProposals.mockResolvedValue([draftProposal()]);
    render(<ProposalsView />);
    await selectFirstProposal("p1");

    fireEvent.change(await screen.findByTestId("composer-message"), {
      target: { value: "This layout is fire approved for 300 guests." },
    });
    fireEvent.click(screen.getByTestId("composer-save"));

    const error = await screen.findByTestId("composer-error");
    expect(error.textContent).toContain("fire approved");
    expect(mocks.createProposalVersion).not.toHaveBeenCalled();
    expect(mocks.createQuote).not.toHaveBeenCalled();
  });

  it("saves a SAFE version without a quote", async () => {
    mocks.listProposals.mockResolvedValue([draftProposal()]);
    mocks.createProposalVersion.mockResolvedValue({
      id: "ver1", proposalId: "p1", version: 1,
      payload: {
        schemaVersion: "venviewer.proposal-version.v1", title: "Autumn gala",
        clientMessage: "Planning-grade draft.", configurationId: null,
        layoutRevision: null, capacityNote: null, quote: null,
      },
      sourceHash: "a".repeat(64), createdBy: "u1", createdAt: NOW,
    });
    mocks.getProposal.mockResolvedValue(draftProposal({ currentVersion: 1 }));
    render(<ProposalsView />);
    await selectFirstProposal("p1");

    fireEvent.change(await screen.findByTestId("composer-message"), {
      target: { value: "Planning-grade draft." },
    });
    fireEvent.click(screen.getByTestId("composer-save"));

    await waitFor(() => {
      expect(mocks.createProposalVersion).toHaveBeenCalledTimes(1);
    });
    const payload = mocks.createProposalVersion.mock.calls[0]?.[1] as { clientMessage: string; quote: null };
    expect(payload.clientMessage).toBe("Planning-grade draft.");
    expect(payload.quote).toBeNull();
    expect(mocks.createQuote).not.toHaveBeenCalled();
  });

  it("builds the quote server-side with exact minor units and snapshots the response", async () => {
    mocks.listProposals.mockResolvedValue([draftProposal()]);
    const QUOTE_UUID = "33333333-3333-4333-8333-333333333333";
    mocks.createQuote.mockResolvedValue({
      id: QUOTE_UUID, venueId: "v1", opportunityId: null, proposalId: "p1", enquiryId: null, spaceId: null,
      name: "Autumn gala quote", status: "draft", currency: "GBP",
      subtotalMinor: 12050, totalMinor: 12050, validUntil: null,
      supersededByQuoteId: null, notes: null, createdBy: "u1",
      createdAt: NOW, updatedAt: NOW, deletedAt: null,
      lineItems: [{
        id: "44444444-4444-4444-8444-444444444444", quoteId: "33333333-3333-4333-8333-333333333333",
        pricingRuleId: null, description: "Grand Hall hire",
        quantity: 1, unitAmountMinor: 12050, lineTotalMinor: 12050, sortOrder: 0,
      }],
    });
    mocks.createProposalVersion.mockResolvedValue({
      id: "ver1", proposalId: "p1", version: 1,
      payload: {
        schemaVersion: "venviewer.proposal-version.v1", title: "Autumn gala",
        clientMessage: null, configurationId: null, layoutRevision: null,
        capacityNote: null, quote: null,
      },
      sourceHash: "a".repeat(64), createdBy: "u1", createdAt: NOW,
    });
    mocks.getProposal.mockResolvedValue(draftProposal({ currentVersion: 1 }));
    render(<ProposalsView />);
    await selectFirstProposal("p1");

    fireEvent.click(await screen.findByTestId("add-quote-line"));
    fireEvent.change(screen.getByTestId("quote-desc-0"), { target: { value: "Grand Hall hire" } });
    fireEvent.change(screen.getByTestId("quote-qty-0"), { target: { value: "1" } });
    fireEvent.change(screen.getByTestId("quote-price-0"), { target: { value: "120.50" } });
    fireEvent.click(screen.getByTestId("composer-save"));

    await waitFor(() => {
      expect(mocks.createQuote).toHaveBeenCalledWith({
        venueId: "v1", opportunityId: null, proposalId: "p1", name: "Autumn gala quote", currency: "GBP",
        lineItems: [{ description: "Grand Hall hire", quantity: 1, unitAmountMinor: 12050 }],
      });
    });
    await waitFor(() => {
      expect(mocks.createProposalVersion).toHaveBeenCalledTimes(1);
    });
    const payload = mocks.createProposalVersion.mock.calls[0]?.[1] as {
      quote: { quoteId: string; subtotalMinor: number; totalMinor: number };
    };
    expect(payload.quote.quoteId).toBe("33333333-3333-4333-8333-333333333333");
    expect(payload.quote.subtotalMinor).toBe(12050);
    expect(payload.quote.totalMinor).toBe(12050);
  });

  it("rejects a malformed quote price before any API call", async () => {
    mocks.listProposals.mockResolvedValue([draftProposal()]);
    render(<ProposalsView />);
    await selectFirstProposal("p1");

    fireEvent.click(await screen.findByTestId("add-quote-line"));
    fireEvent.change(screen.getByTestId("quote-desc-0"), { target: { value: "Hire" } });
    fireEvent.change(screen.getByTestId("quote-price-0"), { target: { value: "12.345" } });
    fireEvent.click(screen.getByTestId("composer-save"));

    const error = await screen.findByTestId("composer-error");
    expect(error.textContent).toContain("price");
    expect(mocks.createQuote).not.toHaveBeenCalled();
    expect(mocks.createProposalVersion).not.toHaveBeenCalled();
  });

  it("lets staff remove accidental quote lines before saving", async () => {
    mocks.listProposals.mockResolvedValue([draftProposal()]);
    render(<ProposalsView />);
    await selectFirstProposal("p1");

    fireEvent.click(await screen.findByTestId("add-quote-line"));
    expect(screen.getByTestId("quote-desc-0")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Remove quote line 1" }));

    expect(screen.queryByTestId("quote-desc-0")).toBeNull();
  });

  it("hides the composer and shows archive for concluded proposals", async () => {
    mocks.listProposals.mockResolvedValue([draftProposal({ status: "accepted", currentVersion: 3, shareCode: "abcdef", sentAt: NOW })]);
    render(<ProposalsView />);
    await selectFirstProposal("p1");

    await screen.findByTestId("archive-button");
    expect(screen.queryByTestId("composer-save")).toBeNull();
    expect(screen.queryByTestId("send-button")).toBeNull();
    expect(screen.queryByTestId("withdraw-button")).toBeNull();
  });

  it("keeps status-history failures visible and retryable", async () => {
    mocks.listProposals.mockResolvedValue([draftProposal()]);
    mocks.getProposalHistory
      .mockRejectedValueOnce(new Error("network"))
      .mockResolvedValueOnce([historyEntry()]);
    render(<ProposalsView />);
    await selectFirstProposal("p1");

    const historyError = await screen.findByTestId("history-load-error");
    expect(historyError.textContent).toContain("Couldn't load this proposal's status history");
    fireEvent.click(screen.getByRole("button", { name: "Retry history" }));

    expect(await screen.findByText(/Shared with the client/)).toBeTruthy();
    expect(mocks.getProposalHistory).toHaveBeenCalledTimes(2);
  });

  it("computes capacity guidance from room area and inserts the SAFE note (T-429)", async () => {
    mocks.listProposals.mockResolvedValue([draftProposal()]);
    mocks.listSpaces.mockResolvedValue([{
      id: "s1", venueId: "v1", name: "Grand Hall", slug: "grand-hall", description: "",
      widthM: "21", lengthM: "10", heightM: "7", floorPlanOutline: [],
      meshUrl: null, thumbnailUrl: null, sortOrder: 0, createdAt: NOW, updatedAt: NOW,
    }]);
    render(<ProposalsView />);
    await selectFirstProposal("p1");

    // 21m × 10m = 210 m²; dinner-rounds default → floor(210 / 1.5) = 140.
    fireEvent.change(await screen.findByTestId("capacity-guests"), { target: { value: "120" } });

    const result = await screen.findByTestId("capacity-result");
    expect(result.textContent).toContain("around 140 guests");
    expect(result.textContent).toContain("120 requested");
    expect(result.textContent).toContain("Planning estimate only");

    fireEvent.click(screen.getByTestId("capacity-insert"));
    const note = screen.getByTestId<HTMLInputElement>("composer-capacity");
    expect(note.value).toContain("Grand Hall: comfortable for around 140 guests");
    expect(note.value).toContain("for 120 guests");
    expect(note.value).toContain("final capacity confirmed by the venue team");
  });

  it("keeps capacity guidance hidden when no rooms load", async () => {
    mocks.listProposals.mockResolvedValue([draftProposal()]);
    mocks.listSpaces.mockRejectedValue(new Error("network"));
    render(<ProposalsView />);
    await selectFirstProposal("p1");

    await screen.findByTestId("composer-save");
    expect(screen.queryByTestId("capacity-space")).toBeNull();
    expect(screen.queryByTestId("capacity-result")).toBeNull();
  });
});
