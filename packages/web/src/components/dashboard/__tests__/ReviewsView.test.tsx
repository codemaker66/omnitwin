import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { PendingReviewEntry, ReviewHistoryEntry } from "../../../api/configuration-reviews.js";
import { ReviewsView } from "../ReviewsView.js";

const CONFIG_ID = "00000000-0000-4000-8000-000000007001";
const VENUE_ID = "00000000-0000-4000-8000-000000007002";
const SPACE_ID = "00000000-0000-4000-8000-000000007003";
const NOW = "2026-06-19T10:00:00.000Z";

const mocks = vi.hoisted(() => ({
  approveLayout: vi.fn(),
  getAvailableTransitions: vi.fn(),
  getReviewHistory: vi.fn(),
  listPendingReviews: vi.fn(),
  rejectLayout: vi.fn(),
  requestChanges: vi.fn(),
  startReview: vi.fn(),
  withdrawReview: vi.fn(),
  addToast: vi.fn(),
}));

vi.mock("../../../api/configuration-reviews.js", () => ({
  approveLayout: mocks.approveLayout,
  getAvailableTransitions: mocks.getAvailableTransitions,
  getReviewHistory: mocks.getReviewHistory,
  listPendingReviews: mocks.listPendingReviews,
  rejectLayout: mocks.rejectLayout,
  requestChanges: mocks.requestChanges,
  startReview: mocks.startReview,
  withdrawReview: mocks.withdrawReview,
}));

vi.mock("../../../hooks/use-review-viewers.js", () => ({
  useReviewViewers: () => ({ viewers: [] }),
}));

vi.mock("../../../stores/toast-store.js", () => ({
  useToastStore: (selector: (state: { readonly addToast: typeof mocks.addToast }) => unknown): unknown =>
    selector({ addToast: mocks.addToast }),
}));

function pendingReview(overrides: Partial<PendingReviewEntry> = {}): PendingReviewEntry {
  return {
    id: CONFIG_ID,
    name: "Reception Room review pack",
    venueId: VENUE_ID,
    spaceId: SPACE_ID,
    userId: null,
    reviewStatus: "submitted",
    submittedAt: NOW,
    updatedAt: NOW,
    guestCount: 120,
    ...overrides,
  };
}

function historyEntry(overrides: Partial<ReviewHistoryEntry> = {}): ReviewHistoryEntry {
  return {
    id: "00000000-0000-4000-8000-000000007004",
    configurationId: CONFIG_ID,
    fromStatus: "draft",
    toStatus: "submitted",
    changedByName: "Planner",
    note: "Submitted for review.",
    createdAt: NOW,
    ...overrides,
  };
}

beforeEach(() => {
  mocks.approveLayout.mockReset();
  mocks.getAvailableTransitions.mockReset();
  mocks.getReviewHistory.mockReset();
  mocks.listPendingReviews.mockReset();
  mocks.rejectLayout.mockReset();
  mocks.requestChanges.mockReset();
  mocks.startReview.mockReset();
  mocks.withdrawReview.mockReset();
  mocks.addToast.mockReset();

  mocks.listPendingReviews.mockResolvedValue([pendingReview()]);
  mocks.getReviewHistory.mockResolvedValue([historyEntry()]);
  mocks.getAvailableTransitions.mockResolvedValue({
    currentStatus: "submitted",
    availableTransitions: ["under_review", "approved", "changes_requested", "rejected"],
  });
  mocks.approveLayout.mockResolvedValue({
    reviewStatus: "approved",
    snapshot: {
      id: "00000000-0000-4000-8000-000000007005",
      configurationId: CONFIG_ID,
      version: 1,
      payload: {},
      diagramUrl: null,
      pdfUrl: null,
      sourceHash: "a".repeat(64),
      createdAt: NOW,
      createdBy: null,
      approvedAt: NOW,
      approvedBy: null,
    },
  });
});

afterEach(() => {
  cleanup();
});

describe("ReviewsView", () => {
  it("surfaces pending-review list failures with a retry path", async () => {
    mocks.listPendingReviews
      .mockRejectedValueOnce(new Error("review registry offline"))
      .mockResolvedValueOnce([pendingReview()]);

    render(<ReviewsView />);

    expect((await screen.findByTestId("reviews-load-error")).textContent).toContain("review registry offline");
    fireEvent.click(screen.getByRole("button", { name: "Retry reviews" }));

    expect(await screen.findByRole("button", { name: "Open review for Reception Room review pack" })).toBeTruthy();
    expect(mocks.listPendingReviews).toHaveBeenCalledTimes(2);
  });

  it("does not hide action gates when review context loading fails", async () => {
    mocks.getReviewHistory
      .mockRejectedValueOnce(new Error("history service unavailable"))
      .mockResolvedValueOnce([historyEntry()]);

    render(<ReviewsView />);

    fireEvent.click(await screen.findByRole("button", { name: "Open review for Reception Room review pack" }));
    expect((await screen.findByTestId("review-context-error")).textContent).toContain("history service unavailable");
    expect(screen.queryByRole("button", { name: "Approve" })).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Retry review context" }));

    expect(await screen.findByRole("button", { name: "Approve" })).toBeTruthy();
    expect(screen.getByText("Submitted for review.")).toBeTruthy();
  });

  it("keeps failed review decisions visible and retryable", async () => {
    mocks.approveLayout.mockRejectedValueOnce(new Error("approval write rejected"));

    render(<ReviewsView />);

    fireEvent.click(await screen.findByRole("button", { name: "Open review for Reception Room review pack" }));
    fireEvent.click(await screen.findByRole("button", { name: "Approve" }));

    await waitFor(() => {
      expect(mocks.approveLayout).toHaveBeenCalledWith(CONFIG_ID);
    });
    expect(screen.getByTestId("review-action-error").textContent).toContain("Approval did not save");
    expect(screen.getByRole("button", { name: "Approve" })).toHaveProperty("disabled", false);
  });
});
