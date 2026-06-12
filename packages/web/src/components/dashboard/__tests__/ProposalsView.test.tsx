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
}));

vi.mock("../../../api/proposals.js", () => mocks);

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

beforeEach(() => {
  for (const fn of Object.values(mocks)) fn.mockReset();
  mocks.listProposals.mockResolvedValue([]);
  mocks.getProposalHistory.mockResolvedValue([]);
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

  it("disables sending until a version snapshot exists", async () => {
    mocks.listProposals.mockResolvedValue([draftProposal({ currentVersion: 0 })]);
    render(<ProposalsView />);
    await selectFirstProposal("p1");

    const send = await screen.findByTestId("send-button");
    expect((send as HTMLButtonElement).disabled).toBe(true);
  });

  it("enables sending once a version exists and transitions to sent", async () => {
    mocks.listProposals.mockResolvedValue([draftProposal({ currentVersion: 2 })]);
    mocks.transitionProposal.mockResolvedValue(draftProposal({ status: "sent", currentVersion: 2, shareCode: "abcdef" }));
    mocks.getProposal.mockResolvedValue(draftProposal({ status: "sent", currentVersion: 2, shareCode: "abcdef" }));
    render(<ProposalsView />);
    await selectFirstProposal("p1");

    const send = await screen.findByTestId("send-button");
    expect((send as HTMLButtonElement).disabled).toBe(false);
    fireEvent.click(send);

    await waitFor(() => {
      expect(mocks.transitionProposal).toHaveBeenCalledWith("p1", "sent");
    });
    expect(await screen.findByTestId("share-link")).toBeTruthy();
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
      id: QUOTE_UUID, venueId: "v1", proposalId: "p1", enquiryId: null, spaceId: null,
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
        venueId: "v1", proposalId: "p1", name: "Autumn gala quote", currency: "GBP",
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

  it("hides the composer and shows archive for concluded proposals", async () => {
    mocks.listProposals.mockResolvedValue([draftProposal({ status: "accepted", currentVersion: 3, shareCode: "abcdef", sentAt: NOW })]);
    render(<ProposalsView />);
    await selectFirstProposal("p1");

    await screen.findByTestId("archive-button");
    expect(screen.queryByTestId("composer-save")).toBeNull();
    expect(screen.queryByTestId("send-button")).toBeNull();
    expect(screen.queryByTestId("withdraw-button")).toBeNull();
  });
});
