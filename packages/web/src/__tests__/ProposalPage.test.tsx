import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { cleanup, render, screen, fireEvent, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { ProposalPage } from "../pages/ProposalPage.js";
import { PublicProposalSchema, type PublicProposal } from "../api/proposals.js";

const { mockGetPublicProposal, mockRespondToProposal } = vi.hoisted(() => ({
  mockGetPublicProposal: vi.fn(),
  mockRespondToProposal: vi.fn(),
}));

vi.mock("../api/proposals.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../api/proposals.js")>();
  return {
    ...actual,
    getPublicProposal: mockGetPublicProposal,
    respondToProposal: mockRespondToProposal,
  };
});

function fixtureProposal(overrides: Partial<PublicProposal> = {}): PublicProposal {
  return {
    title: "Summer wedding — Grand Hall",
    status: "sent",
    sentAt: "2026-06-11T09:00:00.000Z",
    venueName: "Trades Hall of Glasgow",
    clientMessage: "Planning-grade draft for your review.",
    capacityNote: "Comfortable for around 120 guests — planning estimate only.",
    quote: {
      quoteId: null,
      currency: "GBP",
      lineItems: [
        { description: "Grand Hall hire", quantity: 1, unitAmountMinor: 250000, lineTotalMinor: 250000 },
        { description: "Round table", quantity: 12, unitAmountMinor: 1250, lineTotalMinor: 15000 },
      ],
      subtotalMinor: 265000,
      totalMinor: 265000,
    },
    version: 1,
    ...overrides,
  };
}

function renderPage(): void {
  render(
    <MemoryRouter initialEntries={["/proposal/abcdef"]}>
      <Routes>
        <Route path="/proposal/:shareCode" element={<ProposalPage />} />
      </Routes>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  mockGetPublicProposal.mockReset();
  mockRespondToProposal.mockReset();
});

// RTL auto-cleanup is not wired globally in this suite's environment, so
// unmount explicitly — otherwise each render accumulates in document.body
// and "absent button" assertions match the previous test's tree.
afterEach(() => {
  cleanup();
});

describe("ProposalPage", () => {
  it("renders the client-safe proposal with exact-money formatting", async () => {
    mockGetPublicProposal.mockResolvedValue(fixtureProposal());
    renderPage();

    expect(await screen.findByText("Summer wedding — Grand Hall")).toBeTruthy();
    expect(screen.getByText("Trades Hall of Glasgow")).toBeTruthy();
    expect(screen.getAllByText("£2,650.00").length).toBeGreaterThan(0);
    expect(screen.getByText("£12.50")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Accept proposal" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Request changes" })).toBeTruthy();
    expect(screen.getByText(/planning estimates for discussion/)).toBeTruthy();
  });

  it("accepts the proposal via the public respond endpoint", async () => {
    mockGetPublicProposal.mockResolvedValue(fixtureProposal());
    mockRespondToProposal.mockResolvedValue({ status: "accepted" });
    renderPage();

    fireEvent.click(await screen.findByRole("button", { name: "Accept proposal" }));

    await waitFor(() => {
      expect(mockRespondToProposal).toHaveBeenCalledWith("abcdef", "accept", undefined);
    });
    expect(await screen.findByText("Proposal accepted")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Accept proposal" })).toBeNull();
  });

  it("requires a note before a change request can be sent", async () => {
    mockGetPublicProposal.mockResolvedValue(fixtureProposal());
    mockRespondToProposal.mockResolvedValue({ status: "changes_requested" });
    renderPage();

    fireEvent.click(await screen.findByRole("button", { name: "Request changes" }));
    const send = screen.getByRole("button", { name: "Send request" });
    expect((send as HTMLButtonElement).disabled).toBe(true);

    fireEvent.change(screen.getByLabelText(/what you'd like changed/), {
      target: { value: "Could we seat 130 instead?" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Send request" }));

    await waitFor(() => {
      expect(mockRespondToProposal).toHaveBeenCalledWith(
        "abcdef",
        "request_changes",
        "Could we seat 130 instead?",
      );
    });
    expect(await screen.findByText("Changes requested")).toBeTruthy();
  });

  it("hides actions for non-actionable statuses", async () => {
    mockGetPublicProposal.mockResolvedValue(fixtureProposal({ status: "accepted" }));
    renderPage();

    expect(await screen.findByText("Proposal accepted")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Accept proposal" })).toBeNull();
  });

  it("shows the plain-English unavailable state when the fetch fails", async () => {
    mockGetPublicProposal.mockRejectedValue(new Error("404"));
    renderPage();

    expect(await screen.findByText("This proposal link isn't available")).toBeTruthy();
  });

  it("surfaces a retryable error when responding fails", async () => {
    mockGetPublicProposal.mockResolvedValue(fixtureProposal());
    mockRespondToProposal.mockRejectedValue(new Error("network"));
    renderPage();

    fireEvent.click(await screen.findByRole("button", { name: "Accept proposal" }));
    expect(await screen.findByRole("alert")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Accept proposal" })).toBeTruthy();
  });
});

describe("PublicProposalSchema boundary validation", () => {
  it("accepts the fixture and rejects malformed payloads", () => {
    expect(PublicProposalSchema.safeParse(fixtureProposal()).success).toBe(true);
    expect(PublicProposalSchema.safeParse({ ...fixtureProposal(), status: "approved" }).success).toBe(false);
    expect(PublicProposalSchema.safeParse({ ...fixtureProposal(), version: 0 }).success).toBe(false);
    expect(
      PublicProposalSchema.safeParse({
        ...fixtureProposal(),
        quote: { ...fixtureProposal().quote, subtotalMinor: 1 },
      }).success,
    ).toBe(false);
  });
});
