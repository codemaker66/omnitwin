import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { StrictMode } from "react";
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

function deferred<T>(): { promise: Promise<T>; resolve: (value: T) => void; reject: (error: Error) => void } {
  let resolvePromise: ((value: T) => void) | undefined;
  let rejectPromise: ((error: Error) => void) | undefined;
  return {
    promise: new Promise<T>((resolve, reject) => { resolvePromise = resolve; rejectPromise = reject; }),
    resolve: value => { resolvePromise?.(value); },
    reject: error => { rejectPromise?.(error); },
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
  it.each(["resolve", "reject"] as const)("keeps review B open when a pending approval for A later %s", async outcome => {
    const approval = deferred<{ reviewStatus: string; notificationPolicy: string }>();
    mocks.approveLayout.mockReturnValueOnce(approval.promise);
    mocks.listPendingReviews.mockResolvedValue([
      pendingReview(),
      pendingReview({ id: "00000000-0000-4000-8000-000000007099", name: "Second review" }),
    ]);
    render(<ReviewsView />);
    fireEvent.click(await screen.findByRole("button", { name: "Open review for Reception Room review pack" }));
    fireEvent.click(await screen.findByRole("button", { name: "Approve" }));
    fireEvent.click(screen.getByRole("button", { name: /Back to pending reviews/u }));
    fireEvent.click(screen.getByRole("button", { name: "Open review for Second review" }));
    await screen.findByRole("button", { name: "Approve" });
    await act(async () => {
      if (outcome === "resolve") approval.resolve({ reviewStatus: "approved", notificationPolicy: "suppressed_demo" });
      else approval.reject(new Error("Obsolete approval failure"));
      await approval.promise.catch(() => undefined);
    });
    expect(screen.getByRole("heading", { name: "Second review" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Approve" })).toHaveProperty("disabled", false);
    expect(screen.queryByTestId("review-action-error")).toBeNull();
    expect(mocks.addToast).not.toHaveBeenCalled();
  });

  it.each(["resolve", "reject"] as const)("ignores an older StrictMode context %s after starting review", async outcome => {
    const olderHistory = deferred<ReviewHistoryEntry[]>();
    mocks.getReviewHistory
      .mockReturnValueOnce(olderHistory.promise)
      .mockResolvedValueOnce([historyEntry()])
      .mockResolvedValueOnce([historyEntry({ toStatus: "under_review", note: "Current staff review." })]);
    mocks.getAvailableTransitions
      .mockResolvedValueOnce({ currentStatus: "submitted", availableTransitions: ["under_review"], internalDemoReviewEligible: false })
      .mockResolvedValueOnce({ currentStatus: "submitted", availableTransitions: ["under_review"], internalDemoReviewEligible: true })
      .mockResolvedValueOnce({ currentStatus: "under_review", availableTransitions: ["approved"], internalDemoReviewEligible: true });
    mocks.startReview.mockResolvedValue("under_review");
    render(<StrictMode><ReviewsView /></StrictMode>);
    fireEvent.click(await screen.findByRole("button", { name: "Open review for Reception Room review pack" }));
    fireEvent.click(await screen.findByRole("button", { name: "Start Review" }));
    await screen.findByRole("button", { name: "Approve" });
    fireEvent.click(screen.getByRole("checkbox", { name: /Notify team/u }));
    await act(async () => {
      if (outcome === "resolve") olderHistory.resolve([historyEntry({ note: "Obsolete submitted history." })]);
      else olderHistory.reject(new Error("Obsolete context failure"));
      await olderHistory.promise.catch(() => undefined);
    });
    expect(screen.getByRole("button", { name: "Approve" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Start Review" })).toBeNull();
    expect(screen.getByText("Current staff review.")).toBeTruthy();
    expect(screen.queryByText("Obsolete submitted history.")).toBeNull();
    expect(screen.queryByRole("alert")).toBeNull();
    expect(screen.getByRole("checkbox", { name: /Notify team/u })).toHaveProperty("checked", false);
    expect(mocks.addToast).not.toHaveBeenCalledWith("Failed to load review context", "error");
  });

  it("refreshes actions and history after starting review without navigating back", async () => {
    mocks.getAvailableTransitions
      .mockResolvedValueOnce({ currentStatus: "submitted", availableTransitions: ["under_review", "withdrawn"], internalDemoReviewEligible: true })
      .mockResolvedValueOnce({ currentStatus: "under_review", availableTransitions: ["approved", "rejected", "changes_requested"], internalDemoReviewEligible: true });
    mocks.getReviewHistory
      .mockResolvedValueOnce([historyEntry()])
      .mockResolvedValueOnce([historyEntry(), historyEntry({ id: "00000000-0000-4000-8000-000000007006", fromStatus: "submitted", toStatus: "under_review", note: "Review started by staff." })]);
    mocks.startReview.mockResolvedValue("under_review");
    render(<ReviewsView />);
    fireEvent.click(await screen.findByRole("button", { name: "Open review for Reception Room review pack" }));
    fireEvent.click(await screen.findByRole("button", { name: "Start Review" }));
    expect(await screen.findByRole("button", { name: "Approve" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Start Review" })).toBeNull();
    expect(screen.getByText("Review started by staff.")).toBeTruthy();
    expect(mocks.getAvailableTransitions).toHaveBeenCalledTimes(2);
    expect(mocks.getReviewHistory).toHaveBeenCalledTimes(2);
    expect(await screen.findByRole("checkbox", { name: /Notify team/u })).toHaveProperty("checked", true);
  });

  it("shows a retryable context error if the post-start refresh fails", async () => {
    mocks.getAvailableTransitions
      .mockResolvedValueOnce({ currentStatus: "submitted", availableTransitions: ["under_review"] })
      .mockRejectedValueOnce(new Error("Transition lookup unavailable"))
      .mockResolvedValueOnce({ currentStatus: "under_review", availableTransitions: ["approved"], internalDemoReviewEligible: true });
    mocks.startReview.mockResolvedValue("under_review");
    render(<ReviewsView />);
    fireEvent.click(await screen.findByRole("button", { name: "Open review for Reception Room review pack" }));
    fireEvent.click(await screen.findByRole("button", { name: "Start Review" }));
    expect((await screen.findByRole("alert")).textContent).toContain("Transition lookup unavailable");
    expect(screen.queryByRole("button", { name: "Start Review" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Approve" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Retry review context" }));
    expect(await screen.findByRole("button", { name: "Approve" })).toBeTruthy();
  });

  it("offers notification choice only for server-eligible demos and reports actual suppression", async () => {
    mocks.getAvailableTransitions.mockResolvedValue({ currentStatus: "under_review", availableTransitions: ["approved"], internalDemoReviewEligible: true });
    mocks.approveLayout.mockResolvedValue({ reviewStatus: "approved", notificationPolicy: "suppressed_demo" });
    render(<ReviewsView />);
    fireEvent.click(await screen.findByRole("button", { name: "Open review for Reception Room review pack" }));
    const choice = await screen.findByRole("checkbox", { name: /Notify team/u });
    expect(choice).toHaveProperty("checked", true);
    fireEvent.click(choice);
    fireEvent.click(screen.getByRole("button", { name: "Approve" }));
    await waitFor(() => { expect(mocks.approveLayout).toHaveBeenCalledWith(CONFIG_ID, undefined, false); });
    expect(mocks.addToast).toHaveBeenCalledWith("Layout approved for internal demo. Team notifications were suppressed.", "success");
  });

  it("does not offer a silent-review choice for ordinary plans", async () => {
    render(<ReviewsView />);
    fireEvent.click(await screen.findByRole("button", { name: "Open review for Reception Room review pack" }));
    await screen.findByRole("button", { name: "Approve" });
    expect(screen.queryByRole("checkbox", { name: /Notify team/u })).toBeNull();
  });

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
