import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { cleanup, render, screen, fireEvent, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { ProposalPage } from "../pages/ProposalPage.js";
import { PublicProposalSchema, type PublicProposal } from "../api/proposals.js";

const {
  mockApproveProposalShare,
  mockCommentOnProposalShare,
  mockGetProposalShare,
  mockGetPublicProposal,
  mockRespondToProposal,
} = vi.hoisted(() => ({
  mockApproveProposalShare: vi.fn(),
  mockCommentOnProposalShare: vi.fn(),
  mockGetProposalShare: vi.fn(),
  mockGetPublicProposal: vi.fn(),
  mockRespondToProposal: vi.fn(),
}));

vi.mock("../api/proposals.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../api/proposals.js")>();
  return {
    ...actual,
    approveProposalShare: mockApproveProposalShare,
    commentOnProposalShare: mockCommentOnProposalShare,
    getProposalShare: mockGetProposalShare,
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

function renderTokenPage(): void {
  render(
    <MemoryRouter initialEntries={["/proposal-share/client-token"]}>
      <Routes>
        <Route path="/proposal-share/:token" element={<ProposalPage />} />
      </Routes>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  mockApproveProposalShare.mockReset();
  mockCommentOnProposalShare.mockReset();
  mockGetProposalShare.mockReset();
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
    expect(screen.getByRole("button", { name: "Approve proposal" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Request changes" })).toBeTruthy();
    expect(screen.getByText(/planning estimates for discussion/)).toBeTruthy();
  });

  it("accepts the proposal via the legacy public respond endpoint", async () => {
    mockGetPublicProposal.mockResolvedValue(fixtureProposal());
    mockRespondToProposal.mockResolvedValue({ status: "accepted" });
    renderPage();

    fireEvent.click(await screen.findByRole("button", { name: "Approve proposal" }));

    await waitFor(() => {
      expect(mockRespondToProposal).toHaveBeenCalledWith("abcdef", "accept", undefined);
    });
    expect(await screen.findByText("Proposal accepted")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Approve proposal" })).toBeNull();
  });

  it("approves a token-based proposal without exposing internal identifiers", async () => {
    mockGetProposalShare.mockResolvedValue(fixtureProposal({
      roomSummary: "Grand Hall visual summary for discussion.",
      layoutSummary: "Dinner layout summary for planning review.",
      packageSummary: ["Room hire package"],
      comments: [{ kind: "comment", authorName: "Elaine", body: "Looks good.", createdAt: "2026-06-11T10:00:00.000Z" }],
      packages: [{ label: "Room hire", quantity: 1, totalMinor: 250000, status: "draft" }],
    }));
    mockApproveProposalShare.mockResolvedValue({ status: "accepted" });
    renderTokenPage();

    expect(await screen.findByText("Grand Hall visual summary for discussion.")).toBeTruthy();
    expect(screen.getByText("Dinner layout summary for planning review.")).toBeTruthy();
    expect(screen.getByText("Room hire package")).toBeTruthy();
    expect(document.body.textContent).not.toMatch(/proposalId|quoteId|share token|internal/i);

    fireEvent.click(screen.getByRole("button", { name: "Approve proposal" }));
    await waitFor(() => {
      expect(mockApproveProposalShare).toHaveBeenCalledWith("client-token", {});
    });
    expect(mockRespondToProposal).not.toHaveBeenCalled();
  });

  it("requires a note before a token-based change request can be sent", async () => {
    mockGetProposalShare.mockResolvedValue(fixtureProposal());
    mockCommentOnProposalShare.mockResolvedValue({
      kind: "request_changes",
      authorName: null,
      body: "Could we seat 130 instead?",
      createdAt: "2026-06-11T10:00:00.000Z",
    });
    renderTokenPage();

    fireEvent.click(await screen.findByRole("button", { name: "Request changes" }));
    const send = screen.getByRole("button", { name: "Send request" });
    expect((send as HTMLButtonElement).disabled).toBe(true);

    fireEvent.change(screen.getByLabelText(/what you'd like changed/), {
      target: { value: "Could we seat 130 instead?" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Send request" }));

    await waitFor(() => {
      expect(mockCommentOnProposalShare).toHaveBeenCalledWith("client-token", {
        body: "Could we seat 130 instead?",
        kind: "request_changes",
      });
    });
    expect(await screen.findByText("Changes requested")).toBeTruthy();
  });

  it("hides actions for non-actionable statuses", async () => {
    mockGetPublicProposal.mockResolvedValue(fixtureProposal({ status: "accepted" }));
    renderPage();

    expect(await screen.findByText("Proposal accepted")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Approve proposal" })).toBeNull();
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

    fireEvent.click(await screen.findByRole("button", { name: "Approve proposal" }));
    expect(await screen.findByRole("alert")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Approve proposal" })).toBeTruthy();
  });

  it("lets the client post a standalone comment on the token share and shows it (T-427 phase 6)", async () => {
    mockGetProposalShare
      .mockResolvedValueOnce(fixtureProposal())
      .mockResolvedValueOnce(fixtureProposal({
        comments: [{ kind: "comment", authorName: "Elaine", body: "Can we add a cheese table?", createdAt: "2026-06-11T11:00:00.000Z" }],
      }));
    mockCommentOnProposalShare.mockResolvedValue({
      kind: "comment", authorName: "Elaine", body: "Can we add a cheese table?", createdAt: "2026-06-11T11:00:00.000Z",
    });
    renderTokenPage();

    const input = await screen.findByTestId("comment-input");
    fireEvent.change(input, { target: { value: "Can we add a cheese table?" } });
    fireEvent.click(screen.getByTestId("comment-submit"));

    await waitFor(() => {
      expect(mockCommentOnProposalShare).toHaveBeenCalledWith("client-token", {
        body: "Can we add a cheese table?",
        kind: "comment",
      });
    });
    expect(await screen.findByText("Can we add a cheese table?")).toBeTruthy();
  });

  it("does not offer a standalone comment box on the legacy shareCode path", async () => {
    mockGetPublicProposal.mockResolvedValue(fixtureProposal());
    renderPage();

    await screen.findByText("Summer wedding — Grand Hall");
    expect(screen.queryByTestId("comment-input")).toBeNull();
  });

  it("renders the read-only layout visual when a snapshot is present (T-427 phase 7)", async () => {
    mockGetPublicProposal.mockResolvedValue(fixtureProposal({
      layoutSnapshot: {
        roomWidthM: 20,
        roomLengthM: 10,
        items: [
          { shape: "round", kind: "table", xM: 4, zM: 3, widthM: 1.8, depthM: 1.8, rotationDeg: 0 },
          { shape: "rect", kind: "chair", xM: 4, zM: 4.5, widthM: 0.45, depthM: 0.45, rotationDeg: 0 },
        ],
      },
    }));
    renderPage();

    expect(await screen.findByTestId("proposal-layout-visual")).toBeTruthy();
    expect(screen.getByText(/Proposed layout — to scale/)).toBeTruthy();
  });

  it("omits the layout visual when there is no snapshot", async () => {
    mockGetPublicProposal.mockResolvedValue(fixtureProposal());
    renderPage();

    await screen.findByText("Summer wedding — Grand Hall");
    expect(screen.queryByTestId("proposal-layout-visual")).toBeNull();
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
