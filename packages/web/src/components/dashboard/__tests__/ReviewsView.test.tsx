import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { StrictMode } from "react";
import type { PendingReviewEntry, ReviewHistoryEntry } from "../../../api/configuration-reviews.js";
import { ApiError } from "../../../api/client.js";
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

describe("ReviewsView deep link from the reviewer email", () => {
  it("opens the review named by ?config=", async () => {
    render(<ReviewsView initialSelectedId={CONFIG_ID} />);
    // The detail, not the list: the reviewer clicked "Open Review" in the
    // submission email and expects to land on that submission.
    expect(await screen.findByRole("button", { name: "Approve" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Open review for Reception Room review pack" })).toBeNull();
  });

  it("lands on the list when the linked review is no longer pending", async () => {
    mocks.listPendingReviews.mockResolvedValue([
      pendingReview({ id: "00000000-0000-4000-8000-0000000070ff", name: "Someone else's review" }),
    ]);
    render(<ReviewsView initialSelectedId={CONFIG_ID} />);

    // No detail and no error — another reviewer actioned it, and the list is
    // the honest destination.
    expect(await screen.findByRole("button", { name: "Open review for Someone else's review" })).toBeTruthy();
    expect(screen.queryByTestId("reviews-load-error")).toBeNull();
  });

  it("lets the reviewer return to the list without being pulled straight back in", async () => {
    render(<ReviewsView initialSelectedId={CONFIG_ID} />);
    await screen.findByRole("button", { name: "Approve" });

    fireEvent.click(screen.getByRole("button", { name: /back/iu }));
    expect(await screen.findByRole("button", { name: "Open review for Reception Room review pack" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Approve" })).toBeNull();
  });

  it("ignores a deep link when none is given", async () => {
    render(<ReviewsView />);
    expect(await screen.findByRole("button", { name: "Open review for Reception Room review pack" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Approve" })).toBeNull();
  });
});

describe("ReviewsView", () => {
  it("does not label the internal-review toggle as a demo", async () => {
    mocks.getAvailableTransitions.mockResolvedValue({
      currentStatus: "under_review", availableTransitions: ["approved"], internalDemoReviewEligible: true,
    });
    render(<ReviewsView />);
    fireEvent.click(await screen.findByRole("button", { name: "Open review for Reception Room review pack" }));
    await screen.findByRole("checkbox", { name: /^Email /u });
    // The control is real and stays; the copy that called the product a demo
    // does not ship to a venue.
    expect(document.body.textContent ?? "").not.toContain("DEMO ONLY");
  });

  it.each(["resolve", "reject"] as const)("stops the review loading animation when the list request %s", async outcome => {
    const request = deferred<PendingReviewEntry[]>();
    mocks.listPendingReviews.mockReturnValueOnce(request.promise);
    render(<ReviewsView />);
    const activity = screen.getByRole("status");
    expect(activity.textContent).toContain("Loading reviews…");
    expect(activity.querySelector("svg[data-activity-indicator]")).not.toBeNull();
    await act(async () => {
      if (outcome === "resolve") request.resolve([pendingReview()]);
      else request.reject(new Error("Review list unavailable"));
      await request.promise.catch(() => undefined);
    });
    expect(screen.queryByText("Loading reviews…")).toBeNull();
    expect(screen.getByRole("button", { name: "Refresh" }).querySelector("svg[data-activity-indicator]")).toBeNull();
    if (outcome === "resolve") expect(screen.getByRole("button", { name: "Open review for Reception Room review pack" })).toBeTruthy();
    else expect(screen.getByTestId("reviews-load-error").textContent).toContain("Review list unavailable");
  });

  it.each(["resolve", "reject"] as const)("stops the review decision animation when approval %s", async outcome => {
    const request = deferred<{ reviewStatus: string; notificationPolicy: string }>();
    mocks.approveLayout.mockReturnValueOnce(request.promise);
    render(<ReviewsView />);
    fireEvent.click(await screen.findByRole("button", { name: "Open review for Reception Room review pack" }));
    fireEvent.click(await screen.findByRole("button", { name: "Approve" }));
    expect(screen.getByRole("status").textContent).toContain("Recording the review decision…");
    expect(screen.getByRole("status").querySelector("svg[data-activity-indicator]")).not.toBeNull();
    expect(screen.getByRole("button", { name: "Approve" })).toHaveProperty("disabled", true);
    await act(async () => {
      if (outcome === "resolve") request.resolve({ reviewStatus: "approved", notificationPolicy: "requested" });
      else request.reject(new Error("Approval unavailable"));
      await request.promise.catch(() => undefined);
    });
    expect(screen.queryByText("Recording the review decision…")).toBeNull();
    if (outcome === "reject") expect(screen.getByTestId("review-action-error").textContent).toContain("Approval did not save");
    expect(mocks.approveLayout).toHaveBeenCalledTimes(1);
  });

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
    fireEvent.click(screen.getByRole("checkbox", { name: /^Email /u }));
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
    expect(screen.getByRole("checkbox", { name: /^Email /u })).toHaveProperty("checked", false);
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
    expect(await screen.findByRole("checkbox", { name: /^Email /u })).toHaveProperty("checked", true);
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
    const choice = await screen.findByRole("checkbox", { name: /^Email /u });
    expect(choice).toHaveProperty("checked", true);
    fireEvent.click(choice);
    fireEvent.click(screen.getByRole("button", { name: "Approve" }));
    await waitFor(() => { expect(mocks.approveLayout).toHaveBeenCalledWith(CONFIG_ID, undefined, false); });
    expect(mocks.addToast).toHaveBeenCalledWith("Layout approved. Nobody was emailed.", "success");
  });

  it("does not offer a silent-review choice for ordinary plans", async () => {
    render(<ReviewsView />);
    fireEvent.click(await screen.findByRole("button", { name: "Open review for Reception Room review pack" }));
    await screen.findByRole("button", { name: "Approve" });
    expect(screen.queryByRole("checkbox", { name: /^Email /u })).toBeNull();
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

// ---------------------------------------------------------------------------
// T-635 N5, item 11: each decision says who it emails, withdrawing asks
// first, and a decision that meets a review which moved on says where the
// review now stands instead of "did not save".
// ---------------------------------------------------------------------------
describe("ReviewsView says who hears about a decision, and what happened", () => {
  const PLANNER_ID = "00000000-0000-4000-8000-000000007010";

  async function openReview(): Promise<void> {
    fireEvent.click(await screen.findByRole("button", { name: "Open review for Reception Room review pack" }));
  }

  it("names who approval emails before it is pressed", async () => {
    mocks.listPendingReviews.mockResolvedValue([pendingReview({ userId: PLANNER_ID })]);
    render(<ReviewsView />);
    await openReview();
    expect((await screen.findByTestId("approve-consequence")).textContent)
      .toBe("Approving emails the planner and your venue's hallkeepers.");

    fireEvent.click(screen.getByRole("button", { name: "Approve" }));
    await waitFor(() => {
      expect(mocks.addToast).toHaveBeenCalledWith("Layout approved. The planner and your hallkeepers are being emailed.", "success");
    });
  });

  it("does not promise the planner an email when the layout has no planner account", async () => {
    render(<ReviewsView />);
    await openReview();
    expect((await screen.findByTestId("approve-consequence")).textContent)
      .toBe("Approving emails your venue's hallkeepers. This layout has no planner account to email.");

    fireEvent.click(screen.getByRole("button", { name: "Request Changes" }));
    const dialog = screen.getByRole("dialog", { name: "Request changes on this layout?" });
    expect(dialog.textContent).toContain("This layout has no planner account, so nobody is emailed.");
    expect(dialog.textContent).not.toContain("saved in review history");
  });

  it("says a change request is emailed to the planner", async () => {
    mocks.listPendingReviews.mockResolvedValue([pendingReview({ userId: PLANNER_ID })]);
    mocks.requestChanges.mockResolvedValue("changes_requested");
    render(<ReviewsView />);
    await openReview();
    fireEvent.click(await screen.findByRole("button", { name: "Request Changes" }));
    const dialog = screen.getByRole("dialog", { name: "Request changes on this layout?" });
    expect(dialog.textContent).toContain("Your note is emailed to the planner and kept in this review's timeline.");

    fireEvent.change(screen.getByLabelText("Review note"), { target: { value: "Widen the aisle by the stage." } });
    fireEvent.click(screen.getByRole("button", { name: "Send change request" }));
    await waitFor(() => { expect(mocks.addToast).toHaveBeenCalledWith("Change request sent to the planner", "success"); });
  });

  it("offers a rehearsal plan's quiet approval as a plain choice, and says what it does", async () => {
    mocks.listPendingReviews.mockResolvedValue([pendingReview({ userId: PLANNER_ID })]);
    mocks.getAvailableTransitions.mockResolvedValue({ currentStatus: "under_review", availableTransitions: ["approved"], internalDemoReviewEligible: true });
    render(<ReviewsView />);
    await openReview();
    const choice = await screen.findByRole("checkbox", { name: "Email the planner and hallkeepers" });
    expect(document.getElementById(choice.getAttribute("aria-describedby") ?? "")?.textContent?.trim())
      .toBe("This is a rehearsal plan, so it can be approved without emailing anyone.");
    expect(document.body.textContent ?? "").not.toContain("Uncheck to record this decision internally");

    fireEvent.click(choice);
    expect(screen.getByTestId("approve-consequence").textContent).toBe("Approving records the decision. Nobody is emailed.");
  });

  it("asks before withdrawing, and says the review cannot be reopened", async () => {
    mocks.getAvailableTransitions.mockResolvedValue({ currentStatus: "submitted", availableTransitions: ["under_review", "withdrawn"], internalDemoReviewEligible: false });
    mocks.withdrawReview.mockResolvedValue("withdrawn");
    render(<ReviewsView />);
    await openReview();

    const withdraw = await screen.findByRole("button", { name: "Withdraw…" });
    fireEvent.click(withdraw);
    expect(screen.getByTestId("review-withdraw-confirm").textContent)
      .toContain("Withdraw this layout from review? The review ends here and cannot be reopened. Nobody is emailed.");
    expect(withdraw.getAttribute("aria-expanded")).toBe("true");
    expect(mocks.withdrawReview).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "Keep it in review" }));
    expect(screen.queryByTestId("review-withdraw-confirm")).toBeNull();
    expect(mocks.withdrawReview).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "Withdraw…" }));
    fireEvent.click(screen.getByRole("button", { name: "Withdraw" }));
    await waitFor(() => { expect(mocks.withdrawReview).toHaveBeenCalledWith(CONFIG_ID); });
  });

  it("says where a review now stands when someone else decided first", async () => {
    mocks.approveLayout.mockRejectedValueOnce(new ApiError(409, "Cannot approve from state 'approved'", "INVALID_TRANSITION"));
    mocks.getAvailableTransitions
      .mockResolvedValueOnce({ currentStatus: "submitted", availableTransitions: ["under_review", "approved"], internalDemoReviewEligible: false })
      .mockResolvedValueOnce({ currentStatus: "approved", availableTransitions: [], internalDemoReviewEligible: false });
    render(<ReviewsView />);
    await openReview();
    fireEvent.click(await screen.findByRole("button", { name: "Approve" }));

    expect((await screen.findByTestId("reviews-list-notice")).textContent)
      .toBe("Reception Room review pack changed while it was open here. It is now approved, so your decision was not recorded.");
    expect(screen.queryByRole("button", { name: "Open review for Reception Room review pack" })).toBeNull();
    expect(screen.queryByText(/Approval did not save/u)).toBeNull();
    expect(mocks.addToast).not.toHaveBeenCalledWith("Failed to approve", "error");
  });

  it("keeps the review open and says so when it moved on but is still pending", async () => {
    mocks.startReview.mockRejectedValueOnce(new ApiError(409, "Cannot start review from state 'under_review'", "INVALID_TRANSITION"));
    mocks.getAvailableTransitions
      .mockResolvedValueOnce({ currentStatus: "submitted", availableTransitions: ["under_review"], internalDemoReviewEligible: false })
      .mockResolvedValue({ currentStatus: "under_review", availableTransitions: ["approved"], internalDemoReviewEligible: false });
    render(<ReviewsView />);
    await openReview();
    fireEvent.click(await screen.findByRole("button", { name: "Start Review" }));

    expect((await screen.findByTestId("review-moved-on")).textContent)
      .toBe("Reception Room review pack changed while it was open here. It is now under review, so your decision was not recorded.");
    // Read again: the decisions on offer are the ones for where it stands.
    expect(await screen.findByRole("button", { name: "Approve" })).toBeTruthy();
    expect(screen.getByTestId("review-moved-on")).toBeTruthy();
    expect(screen.queryByTestId("review-action-error")).toBeNull();
  });

  it("keeps a written note when the space beside the dialog is clicked", async () => {
    render(<ReviewsView />);
    await openReview();
    fireEvent.click(await screen.findByRole("button", { name: "Reject" }));
    fireEvent.change(screen.getByLabelText("Review note"), { target: { value: "The fire exit route is blocked." } });

    fireEvent.click(screen.getByRole("dialog", { name: "Reject this layout?" }));
    expect(screen.getByRole("dialog", { name: "Reject this layout?" })).toBeTruthy();
    expect(screen.getByLabelText<HTMLTextAreaElement>("Review note").value).toBe("The fire exit route is blocked.");

    fireEvent.change(screen.getByLabelText("Review note"), { target: { value: "" } });
    fireEvent.click(screen.getByRole("dialog", { name: "Reject this layout?" }));
    expect(screen.queryByRole("dialog", { name: "Reject this layout?" })).toBeNull();
  });
});
