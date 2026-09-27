import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { StrictMode } from "react";
import type { ActiveReviewer, PendingReviewEntry, ReviewHistoryEntry, SnapshotEnvelope } from "../../../api/configuration-reviews.js";
import { ApiError } from "../../../api/client.js";
import { useAuthStore } from "../../../stores/auth-store.js";
import { ReviewsView } from "../ReviewsView.js";

// ---------------------------------------------------------------------------
// The Layout reviews desk (roadmap X2): the queue in three stages beside a
// forest decision panel, one next step per stage, every decision said in
// place before and after it is made, and the open review in the address.
// ---------------------------------------------------------------------------

const CONFIG_ID = "00000000-0000-4000-8000-000000007001";
const SECOND_ID = "00000000-0000-4000-8000-000000007099";
const THIRD_ID = "00000000-0000-4000-8000-000000007098";
const VENUE_ID = "00000000-0000-4000-8000-000000007002";
const SPACE_ID = "00000000-0000-4000-8000-000000007003";
const PLANNER_ID = "00000000-0000-4000-8000-000000007010";
/** 11:00 in Glasgow on Friday 19 June 2026. */
const NOW = "2026-06-19T10:00:00.000Z";

const mocks = vi.hoisted(() => ({
  approveLayout: vi.fn(),
  getAvailableTransitions: vi.fn(),
  getLatestSnapshot: vi.fn(),
  getReviewHistory: vi.fn(),
  listPendingReviews: vi.fn(),
  rejectLayout: vi.fn(),
  requestChanges: vi.fn(),
  startReview: vi.fn(),
  withdrawReview: vi.fn(),
  addToast: vi.fn(),
  viewers: [] as ActiveReviewer[],
}));

vi.mock("../../../api/configuration-reviews.js", async (importOriginal) => ({
  ...await importOriginal<typeof import("../../../api/configuration-reviews.js")>(),
  approveLayout: mocks.approveLayout,
  getAvailableTransitions: mocks.getAvailableTransitions,
  getLatestSnapshot: mocks.getLatestSnapshot,
  getReviewHistory: mocks.getReviewHistory,
  listPendingReviews: mocks.listPendingReviews,
  rejectLayout: mocks.rejectLayout,
  requestChanges: mocks.requestChanges,
  startReview: mocks.startReview,
  withdrawReview: mocks.withdrawReview,
}));

vi.mock("../../../hooks/use-review-viewers.js", () => ({
  useReviewViewers: () => ({ viewers: mocks.viewers, loading: false }),
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
    submittedAt: "2026-06-19T07:00:00.000Z",
    updatedAt: "2026-06-19T07:00:00.000Z",
    guestCount: 120,
    spaceName: "Reception Room",
    plannerName: null,
    eventStartsAt: "2026-10-03T17:00:00.000Z",
    stageSince: "2026-06-19T07:00:00.000Z",
    stageByName: null,
    ...overrides,
  };
}

function historyEntry(overrides: Partial<ReviewHistoryEntry> = {}): ReviewHistoryEntry {
  return {
    id: "00000000-0000-4000-8000-000000007004",
    configurationId: CONFIG_ID,
    fromStatus: "draft",
    toStatus: "submitted",
    changedByName: "Fiona Grant",
    note: "Submitted for review.",
    createdAt: "2026-06-19T07:00:00.000Z",
    ...overrides,
  };
}

function gates(currentStatus: string, availableTransitions: string[], internalDemoReviewEligible = false) {
  return { currentStatus, availableTransitions, internalDemoReviewEligible };
}

const TO_START = gates("submitted", ["under_review", "withdrawn"]);
const IN_REVIEW = gates("under_review", ["approved", "rejected", "changes_requested", "withdrawn"]);

function snapshotEnvelope(): SnapshotEnvelope {
  return {
    id: "00000000-0000-4000-8000-000000007005",
    configurationId: CONFIG_ID,
    version: 2,
    payload: {
      config: { id: CONFIG_ID, name: "Reception Room review pack", guestCount: 120, layoutStyle: "dinner-rounds" },
      venue: { name: "Trades Hall Glasgow", address: "85 Glassford Street", logoUrl: null, timezone: "Europe/London" },
      space: { name: "Reception Room", widthM: 12, lengthM: 8, heightM: 4 },
      timing: null,
      instructions: null,
      phases: [],
      totals: {
        entries: [
          { name: "Round table", category: "table", qty: 12 },
          { name: "Banquet chair", category: "chair", qty: 120 },
          { name: "Lectern", category: "av", qty: 1 },
        ],
        totalRows: 3,
        totalItems: 133,
      },
      diagramUrl: null,
      floorPlan: {
        coordinateSpace: "real_m_v1",
        outline: [{ x: 0, z: 0 }, { x: 12, z: 0 }, { x: 12, z: 8 }, { x: 0, z: 8 }],
        objects: [{
          objectId: "00000000-0000-4000-8000-000000007101", assetDefinitionId: "00000000-0000-4000-8000-000000007102",
          name: "Round table", category: "table", x: 4, z: 4, rotationY: 0, scale: 1, widthM: 1.8, depthM: 1.8, collisionType: "cylinder",
        }],
      },
      webViewUrl: `http://localhost:5173/hallkeeper/${CONFIG_ID}`,
      generatedAt: "2026-06-19T07:00:00.000Z",
      approval: null,
    },
    diagramUrl: null,
    pdfUrl: null,
    sourceHash: "a".repeat(64),
    createdAt: "2026-06-19T07:00:00.000Z",
    createdBy: null,
    approvedAt: null,
    approvedBy: null,
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

/** Lays the desk out as a wide screen does: the queue and the panel side by side. */
function wideDesk(): void {
  vi.spyOn(window, "matchMedia").mockImplementation((query: string): MediaQueryList => ({
    matches: query === "(min-width: 1180px)",
    media: query,
    onchange: null,
    addListener: () => undefined,
    removeListener: () => undefined,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
    dispatchEvent: () => false,
  }));
}

function row(name: string): HTMLElement {
  const found = document.querySelectorAll<HTMLButtonElement>("button[data-review-id]");
  const match = [...found].find((button) => button.getAttribute("aria-label")?.startsWith(`${name},`) === true);
  if (match === undefined) throw new Error(`No queue row for ${name}`);
  return match;
}

async function findRow(name: string): Promise<HTMLElement> {
  return waitFor(() => row(name));
}

async function openReview(name = "Reception Room review pack"): Promise<void> {
  fireEvent.click(await findRow(name));
  await screen.findByRole("heading", { level: 2, name });
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(NOW);
  mocks.viewers = [];
  mocks.listPendingReviews.mockResolvedValue([pendingReview()]);
  mocks.getReviewHistory.mockResolvedValue([historyEntry()]);
  mocks.getAvailableTransitions.mockResolvedValue(TO_START);
  mocks.getLatestSnapshot.mockResolvedValue(snapshotEnvelope());
  mocks.approveLayout.mockResolvedValue({ reviewStatus: "approved", notificationPolicy: "team_requested", snapshot: snapshotEnvelope() });
  wideDesk();
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("the queue", () => {
  it("lists layouts by stage, the longest-waiting first, each led by its event's date", async () => {
    mocks.listPendingReviews.mockResolvedValue([
      pendingReview({ id: THIRD_ID, name: "Burns supper", reviewStatus: "changes_requested", plannerName: "Ross Kerr",
        stageSince: "2026-06-17T09:00:00.000Z", eventStartsAt: null }),
      pendingReview({ id: SECOND_ID, name: "Late submission", stageSince: "2026-06-19T09:30:00.000Z", plannerName: "Fiona Grant" }),
      pendingReview({ name: "Reception Room review pack", stageSince: "2026-06-18T16:00:00.000Z" }),
      pendingReview({ id: "00000000-0000-4000-8000-000000007097", name: "Hogmanay ball", reviewStatus: "under_review",
        stageByName: "Catherine Tait", stageSince: "2026-06-19T08:14:00.000Z", eventStartsAt: "2027-12-31T19:00:00.000Z" }),
    ]);
    render(<ReviewsView />);

    await findRow("Reception Room review pack");
    const headings = [...document.querySelectorAll(".enq-group")].map((heading) => heading.textContent);
    expect(headings).toEqual(["To start, 2", "In review, 1", "With planner, 1"]);
    const order = [...document.querySelectorAll("button[data-review-id]")].map((button) => button.getAttribute("aria-label")?.split(",")[0]);
    expect(order).toEqual(["Reception Room review pack", "Late submission", "Hogmanay ball", "Burns supper"]);

    expect(row("Late submission").getAttribute("aria-label"))
      .toBe("Late submission, To start, event Sat 3 Oct 2026, Reception Room, 120 guests, Planned by Fiona Grant, submitted 30 minutes ago");
    expect(row("Burns supper").getAttribute("aria-label")).toContain("no event date yet");
    expect(row("Burns supper").getAttribute("aria-label")).toContain("changes asked for 2 days ago");
    // The event's date leads each row; a year is shown only when it is not this one.
    expect(within(row("Hogmanay ball")).getByText("31").closest(".enq-date")?.textContent).toBe("Fri31Dec ’27");
    // The wait is copper where it waits on the venue, and plain where it waits on the planner.
    expect(row("Late submission").querySelector(".rev-row__wait")).not.toBeNull();
    expect(row("Burns supper").querySelector(".rev-row__wait")).toBeNull();

    expect(screen.getByRole("button", { name: "To start, 2" }).getAttribute("aria-pressed")).toBe("false");
    expect(screen.getByRole("button", { name: "All, 4" }).getAttribute("aria-pressed")).toBe("true");
    expect(screen.getByTestId("reviews-summary").textContent)
      .toBe("2 layouts to start are waiting for a reviewer; the longest-waiting was submitted yesterday. 1 layout in review waits for a decision. 1 layout with its planner for changes.");
  });

  it("filters the queue by the stage counts", async () => {
    mocks.listPendingReviews.mockResolvedValue([
      pendingReview(),
      pendingReview({ id: SECOND_ID, name: "Hogmanay ball", reviewStatus: "under_review" }),
    ]);
    render(<ReviewsView />);
    await findRow("Reception Room review pack");
    fireEvent.click(screen.getByRole("button", { name: "In review, 1" }));
    expect(document.querySelectorAll("button[data-review-id]")).toHaveLength(1);
    expect(row("Hogmanay ball")).toBeDefined();
    fireEvent.click(screen.getByRole("button", { name: "With planner, 0" }));
    expect(screen.getByRole("heading", { name: "None at this stage" })).toBeDefined();
  });

  it("moves along the queue with j, k and the arrow keys, and opens a row with Enter", async () => {
    mocks.listPendingReviews.mockResolvedValue([
      pendingReview(),
      pendingReview({ id: SECOND_ID, name: "Late submission", stageSince: "2026-06-19T09:30:00.000Z" }),
    ]);
    render(<ReviewsView />);
    const first = await findRow("Reception Room review pack");
    expect(first.tabIndex).toBe(0);
    expect(row("Late submission").tabIndex).toBe(-1);
    first.focus();
    fireEvent.keyDown(first, { key: "j" });
    expect(document.activeElement).toBe(row("Late submission"));
    fireEvent.keyDown(document.activeElement ?? document.body, { key: "ArrowUp" });
    expect(document.activeElement).toBe(first);
    fireEvent.click(first);
    const heading = await screen.findByRole("heading", { level: 2, name: "Reception Room review pack" });
    await waitFor(() => { expect(document.activeElement).toBe(heading); });
  });

  it("says a queue that could not be read, and reads it again", async () => {
    mocks.listPendingReviews
      .mockRejectedValueOnce(new Error("review registry offline"))
      .mockResolvedValueOnce([pendingReview()]);
    render(<ReviewsView />);
    expect((await screen.findByTestId("reviews-load-error")).textContent).toContain("review registry offline");
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(await findRow("Reception Room review pack")).toBeDefined();
    expect(mocks.listPendingReviews).toHaveBeenCalledTimes(2);
  });

  it("says when nothing is waiting", async () => {
    mocks.listPendingReviews.mockResolvedValue([]);
    render(<ReviewsView />);
    expect(await screen.findByRole("heading", { name: "No layouts waiting" })).toBeDefined();
    expect(screen.getByRole("heading", { name: "All caught up" })).toBeDefined();
    expect(screen.getByTestId("reviews-summary").textContent).toBe("All caught up: no layout is waiting for review.");
  });
});

describe("the address", () => {
  it("opens the review the address names, and follows the review that is open", async () => {
    const shown = vi.fn();
    mocks.listPendingReviews.mockResolvedValue([pendingReview(), pendingReview({ id: SECOND_ID, name: "Late submission" })]);
    render(<ReviewsView reviewId={CONFIG_ID} onReviewShown={shown} />);
    expect(await screen.findByRole("heading", { level: 2, name: "Reception Room review pack" })).toBeDefined();
    expect(await screen.findByRole("button", { name: "Start review" })).toBeDefined();
    await waitFor(() => { expect(shown).toHaveBeenLastCalledWith(CONFIG_ID); });
    expect(shown).not.toHaveBeenCalledWith(null);

    fireEvent.click(row("Late submission"));
    await waitFor(() => { expect(shown).toHaveBeenLastCalledWith(SECOND_ID); });
    fireEvent.click(screen.getByRole("button", { name: "Close review" }));
    await waitFor(() => { expect(shown).toHaveBeenLastCalledWith(null); });
    expect(screen.queryByRole("heading", { level: 2, name: "Late submission" })).toBeNull();
  });

  it("says so, and lands on the queue, when the linked review is no longer waiting", async () => {
    const shown = vi.fn();
    mocks.listPendingReviews.mockResolvedValue([pendingReview({ id: SECOND_ID, name: "Someone else's review" })]);
    render(<ReviewsView reviewId={CONFIG_ID} onReviewShown={shown} />);
    expect((await screen.findByTestId("reviews-link-notice")).textContent)
      .toBe("The review you followed is no longer waiting for a decision.");
    expect(row("Someone else's review")).toBeDefined();
    expect(screen.queryByTestId("reviews-load-error")).toBeNull();
    expect(shown).toHaveBeenLastCalledWith(null);
  });

  it("keeps the address while the queue cannot be read, and opens the review once it is", async () => {
    const shown = vi.fn();
    mocks.listPendingReviews.mockRejectedValueOnce(new Error("review registry offline")).mockResolvedValue([pendingReview()]);
    render(<ReviewsView reviewId={CONFIG_ID} onReviewShown={shown} />);
    await screen.findByTestId("reviews-load-error");
    expect(shown).not.toHaveBeenCalledWith(null);
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(await screen.findByRole("heading", { level: 2, name: "Reception Room review pack" })).toBeDefined();
    await waitFor(() => { expect(shown).toHaveBeenLastCalledWith(CONFIG_ID); });
  });

  it("on a narrow screen, lets the reviewer go back to the queue without being pulled back in", async () => {
    vi.mocked(window.matchMedia).mockRestore();
    render(<ReviewsView reviewId={CONFIG_ID} />);
    await screen.findByRole("button", { name: "Start review" });
    expect(document.querySelector("button[data-review-id]")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Back to reviews" }));
    expect(await findRow("Reception Room review pack")).toBeDefined();
    expect(screen.queryByRole("button", { name: "Start review" })).toBeNull();
  });
});

describe("the decision panel", () => {
  it("says who has the review and since when, in the venue's time, and names a colleague looking at it too", async () => {
    mocks.viewers = [{ userId: "00000000-0000-4000-8000-000000007020", displayName: "Ross Kerr", lastSeenAt: NOW }];
    mocks.listPendingReviews.mockResolvedValue([pendingReview({ reviewStatus: "under_review", stageByName: "Catherine Tait" })]);
    mocks.getAvailableTransitions.mockResolvedValue(IN_REVIEW);
    mocks.getReviewHistory.mockResolvedValue([
      historyEntry(),
      historyEntry({ id: "00000000-0000-4000-8000-000000007006", fromStatus: "submitted", toStatus: "under_review",
        changedByName: "Catherine Tait", note: null, createdAt: "2026-06-19T09:14:00.000Z" }),
    ]);
    render(<ReviewsView />);
    await openReview();

    expect(await screen.findByText("In review with Catherine Tait since 10:14")).toBeDefined();
    const presence = screen.getByTestId("review-presence");
    expect(presence.textContent).toBe("Ross Kerr is looking at this too.");
    expect(presence.getAttribute("role")).toBe("status");
    // The facts a reviewer decides on, in large type.
    const facts = document.querySelector(".enq-facts");
    expect(facts?.textContent).toContain("3 Oct 2026");
    expect(facts?.textContent).toContain("120");
    expect(facts?.textContent).toContain("Reception Room");
    // The timeline in sentences, in venue time.
    const timeline = document.querySelector(".enq-timeline");
    expect(timeline?.textContent).toContain("Fiona Grant submitted it for review.Fri 19 Jun, 08:00");
    expect(timeline?.textContent).toContain("Catherine Tait started the review.Fri 19 Jun, 10:14");
  });

  it("shows the plan as it was submitted: its version, its largest items and a drawing", async () => {
    render(<ReviewsView />);
    await openReview();
    expect(await screen.findByText("Version 2, frozen Fri 19 Jun, 08:00")).toBeDefined();
    const items = [...document.querySelectorAll(".rev-plan__items > div")].map((item) => item.textContent);
    expect(items).toEqual(["Banquet chair120", "Round table12", "Lectern1"]);
    expect(screen.getByRole("img", { name: "Plan of Reception Room review pack as submitted: 1 piece in the Reception Room" })).toBeDefined();
    expect(screen.getByRole("link", { name: "Open the layout (opens in a new tab)" }).getAttribute("href")).toBe(`/plan/${CONFIG_ID}`);
    expect(screen.getByRole("link", { name: "Preview the setup sheet (opens in a new tab)" }).getAttribute("href")).toBe(`/hallkeeper/${CONFIG_ID}`);
  });

  it("says when the submitted plan could not be read, and reads it again", async () => {
    mocks.getLatestSnapshot.mockRejectedValueOnce(new Error("snapshot store offline"));
    render(<ReviewsView />);
    await openReview();
    expect(await screen.findByText("The submitted plan could not be read.")).toBeDefined();
    fireEvent.click(within(document.querySelector(".rev-plan__retry") as HTMLElement).getByRole("button", { name: "Try again" }));
    expect(await screen.findByText("Version 2, frozen Fri 19 Jun, 08:00")).toBeDefined();
  });

  it("starts a review in place, then offers the decision with focus on it", async () => {
    mocks.getAvailableTransitions.mockResolvedValueOnce(TO_START).mockResolvedValueOnce(IN_REVIEW);
    mocks.getReviewHistory
      .mockResolvedValueOnce([historyEntry()])
      .mockResolvedValueOnce([historyEntry(), historyEntry({ id: "00000000-0000-4000-8000-000000007006", fromStatus: "submitted",
        toStatus: "under_review", changedByName: "Catherine Tait", note: null, createdAt: NOW })]);
    mocks.startReview.mockResolvedValue("under_review");
    render(<ReviewsView />);
    await openReview();
    fireEvent.click(await screen.findByRole("button", { name: "Start review" }));
    const approve = await screen.findByRole("button", { name: "Approve…" });
    await waitFor(() => { expect(document.activeElement).toBe(approve); });
    expect(screen.queryByRole("button", { name: "Start review" })).toBeNull();
    expect(screen.getByText("Catherine Tait started the review.")).toBeDefined();
    expect(screen.getByText("In review with Catherine Tait since 11:00")).toBeDefined();
    expect(within(document.querySelector(".enq-panel__status") as HTMLElement).getByText("In review")).toBeDefined();
    expect(mocks.getAvailableTransitions).toHaveBeenCalledTimes(2);
  });

  it("says a review the reader holds is in review with them", async () => {
    useAuthStore.setState({ user: { id: "00000000-0000-4000-8000-000000007030", name: "Catherine Tait", email: "catherine@example.test",
      role: "staff", platformRole: "none", venueId: VENUE_ID }, isAuthenticated: true });
    mocks.listPendingReviews.mockResolvedValue([pendingReview({ reviewStatus: "under_review", stageByName: "Catherine Tait" })]);
    mocks.getAvailableTransitions.mockResolvedValue(IN_REVIEW);
    mocks.getReviewHistory.mockResolvedValue([historyEntry(), historyEntry({ id: "00000000-0000-4000-8000-000000007006",
      fromStatus: "submitted", toStatus: "under_review", changedByName: "Catherine Tait", note: null, createdAt: "2026-06-19T09:14:00.000Z" })]);
    render(<ReviewsView />);
    await openReview();
    expect(await screen.findByText("In review with you since 10:14")).toBeDefined();
    useAuthStore.setState({ user: null, isAuthenticated: false });
  });

  it("offers only the steps the server allows for this stage", async () => {
    mocks.getAvailableTransitions.mockResolvedValue(gates("submitted", []));
    render(<ReviewsView />);
    await openReview();
    expect(await screen.findByText("Your role has no decision to make while this review is waiting for a reviewer.")).toBeDefined();
    expect(screen.queryByRole("button", { name: "Start review" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Withdraw…" })).toBeNull();
  });

  it("hides the steps when they cannot be read, and reads them again", async () => {
    mocks.getReviewHistory
      .mockRejectedValueOnce(new Error("history service unavailable"))
      .mockResolvedValueOnce([historyEntry()]);
    render(<ReviewsView />);
    await openReview();
    expect((await screen.findByTestId("review-context-error")).textContent).toContain("history service unavailable");
    expect(screen.queryByRole("button", { name: "Start review" })).toBeNull();
    fireEvent.click(within(screen.getByTestId("review-context-error")).getByRole("button", { name: "Try again" }));
    expect(await screen.findByRole("button", { name: "Start review" })).toBeDefined();
    expect(screen.getByText("Fiona Grant submitted it for review.")).toBeDefined();
  });
});

describe("decisions say who hears, and what happened", () => {
  it("asks once before approving, names who is emailed, and offers the next review afterwards", async () => {
    mocks.listPendingReviews.mockResolvedValue([
      pendingReview({ userId: PLANNER_ID, reviewStatus: "under_review" }),
      pendingReview({ id: SECOND_ID, name: "Late submission", stageSince: "2026-06-19T09:30:00.000Z" }),
    ]);
    mocks.getAvailableTransitions.mockImplementation((id: string) => Promise.resolve(id === CONFIG_ID ? IN_REVIEW : TO_START));
    render(<ReviewsView />);
    await openReview();
    fireEvent.click(await screen.findByRole("button", { name: "Approve…" }));
    expect(screen.getByTestId("approve-consequence").textContent).toBe("Approving emails the planner and your venue's hallkeepers.");
    expect(mocks.approveLayout).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "Approve and email" }));
    await waitFor(() => { expect(mocks.approveLayout).toHaveBeenCalledWith(CONFIG_ID); });
    const recorded = await screen.findByTestId("review-recorded");
    expect(recorded.textContent).toBe("Reception Room review pack");
    expect(screen.getByText("Approved. The planner and your hallkeepers are being emailed.")).toBeDefined();
    expect(() => row("Reception Room review pack")).toThrow();
    const next = screen.getByRole("button", { name: "Open the next review" });
    expect(screen.getByText("Next: Late submission")).toBeDefined();
    await waitFor(() => { expect(document.activeElement).toBe(next); });
    fireEvent.click(next);
    expect(await screen.findByRole("heading", { level: 2, name: "Late submission" })).toBeDefined();
    expect(mocks.addToast).not.toHaveBeenCalled();
  });

  it("does not promise the planner an email when the layout has no planner account", async () => {
    mocks.listPendingReviews.mockResolvedValue([pendingReview({ reviewStatus: "under_review" })]);
    mocks.getAvailableTransitions.mockResolvedValue(IN_REVIEW);
    render(<ReviewsView />);
    await openReview();
    fireEvent.click(await screen.findByRole("button", { name: "Approve…" }));
    expect(screen.getByTestId("approve-consequence").textContent)
      .toBe("Approving emails your venue's hallkeepers. This layout has no planner account to email.");
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    fireEvent.click(screen.getByRole("button", { name: "Ask for changes…" }));
    const confirm = screen.getByTestId("review-confirm-changes_requested");
    expect(confirm.textContent).toContain("This layout has no planner account, so nobody is emailed.");
    expect(within(confirm).getByRole("button", { name: "Record the request" })).toBeDefined();
  });

  it("asks for changes with a note it requires, and keeps the layout in the queue with its planner", async () => {
    mocks.listPendingReviews.mockResolvedValue([pendingReview({ userId: PLANNER_ID, plannerName: "Fiona Grant", reviewStatus: "under_review" })]);
    mocks.getAvailableTransitions.mockResolvedValueOnce(IN_REVIEW).mockResolvedValue(gates("changes_requested", ["withdrawn"]));
    mocks.requestChanges.mockResolvedValue("changes_requested");
    render(<ReviewsView />);
    await openReview();
    fireEvent.click(await screen.findByRole("button", { name: "Ask for changes…" }));
    const confirm = screen.getByTestId("review-confirm-changes_requested");
    expect(confirm.textContent).toContain("Your note is emailed to the planner and kept in this review's timeline.");
    const send = within(confirm).getByRole("button", { name: "Send to the planner" });
    expect(send).toHaveProperty("disabled", true);
    fireEvent.change(within(confirm).getByLabelText("What needs to change"), { target: { value: "Widen the aisle by the stage." } });
    expect(send).toHaveProperty("disabled", false);
    fireEvent.click(send);

    await waitFor(() => { expect(mocks.requestChanges).toHaveBeenCalledWith(CONFIG_ID, "Widen the aisle by the stage."); });
    expect(await screen.findByText("Back with Fiona Grant for changes. It returns to To start when it is submitted again.")).toBeDefined();
    expect(row("Reception Room review pack").getAttribute("aria-label")).toContain("With planner");
    expect(screen.getByRole("button", { name: "With planner, 1" })).toBeDefined();
  });

  it("offers a rehearsal plan's quiet approval as a plain choice, and says what it does", async () => {
    mocks.listPendingReviews.mockResolvedValue([pendingReview({ userId: PLANNER_ID, reviewStatus: "under_review" })]);
    mocks.getAvailableTransitions.mockResolvedValue(gates("under_review", ["approved"], true));
    mocks.approveLayout.mockResolvedValue({ reviewStatus: "approved", notificationPolicy: "suppressed_demo", snapshot: snapshotEnvelope() });
    render(<ReviewsView />);
    await openReview();
    fireEvent.click(await screen.findByRole("button", { name: "Approve…" }));
    const choice = screen.getByRole("checkbox", { name: "Email the planner and hallkeepers" });
    expect(choice).toHaveProperty("checked", true);
    expect(document.getElementById(choice.getAttribute("aria-describedby") ?? "")?.textContent)
      .toBe("This is a rehearsal plan, so it can be approved without emailing anyone.");
    expect(document.body.textContent).not.toContain("DEMO ONLY");

    fireEvent.click(choice);
    expect(screen.getByTestId("approve-consequence").textContent).toBe("Approving records the decision. Nobody is emailed.");
    fireEvent.click(screen.getByRole("button", { name: "Approve" }));
    await waitFor(() => { expect(mocks.approveLayout).toHaveBeenCalledWith(CONFIG_ID, undefined, false); });
    expect(await screen.findByText("Approved. Nobody was emailed.")).toBeDefined();
  });

  it("does not offer a silent approval for an ordinary plan", async () => {
    mocks.listPendingReviews.mockResolvedValue([pendingReview({ reviewStatus: "under_review" })]);
    mocks.getAvailableTransitions.mockResolvedValue(IN_REVIEW);
    render(<ReviewsView />);
    await openReview();
    fireEvent.click(await screen.findByRole("button", { name: "Approve…" }));
    expect(screen.queryByRole("checkbox")).toBeNull();
  });

  it("asks before withdrawing, and says the review cannot be reopened", async () => {
    mocks.withdrawReview.mockResolvedValue("withdrawn");
    render(<ReviewsView />);
    await openReview();
    fireEvent.click(await screen.findByRole("button", { name: "Withdraw…" }));
    expect(screen.getByTestId("review-confirm-withdrawn").textContent)
      .toContain("Withdraw Reception Room review pack from review?The review ends here and cannot be reopened. Nobody is emailed.");
    expect(mocks.withdrawReview).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Keep it in review" }));
    expect(screen.queryByTestId("review-confirm-withdrawn")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Withdraw…" }));
    fireEvent.click(within(screen.getByTestId("review-confirm-withdrawn")).getByRole("button", { name: "Withdraw" }));
    await waitFor(() => { expect(mocks.withdrawReview).toHaveBeenCalledWith(CONFIG_ID); });
    expect(await screen.findByText("Withdrawn from review. Nobody was emailed.")).toBeDefined();
    expect(screen.getByText("Nothing else is waiting on you.")).toBeDefined();
  });

  it("closes a confirmation, then the review, with Escape", async () => {
    render(<ReviewsView />);
    await openReview();
    fireEvent.click(await screen.findByRole("button", { name: "Withdraw…" }));
    fireEvent.keyDown(screen.getByTestId("review-confirm-withdrawn"), { key: "Escape" });
    expect(screen.queryByTestId("review-confirm-withdrawn")).toBeNull();
    fireEvent.keyDown(screen.getByRole("button", { name: "Start review" }), { key: "Escape" });
    // The panel returns to the queue's next move, and focus to the row.
    expect(await screen.findByRole("complementary", { name: "Queue overview" })).toBeDefined();
    expect(screen.queryByRole("button", { name: "Start review" })).toBeNull();
    await waitFor(() => { expect(document.activeElement).toBe(row("Reception Room review pack")); });
  });

  it("says where a review now stands when someone else decided first", async () => {
    mocks.listPendingReviews.mockResolvedValue([pendingReview({ reviewStatus: "under_review" })]);
    mocks.approveLayout.mockRejectedValueOnce(new ApiError(409, "Cannot approve from state 'approved'", "INVALID_TRANSITION"));
    mocks.getAvailableTransitions.mockResolvedValueOnce(IN_REVIEW).mockResolvedValue(gates("approved", []));
    render(<ReviewsView />);
    await openReview();
    fireEvent.click(await screen.findByRole("button", { name: "Approve…" }));
    fireEvent.click(screen.getByRole("button", { name: "Approve and email" }));

    expect(await screen.findByText("Reception Room review pack changed while it was open here. It is now approved, so your decision was not recorded."))
      .toBeDefined();
    expect(screen.getByText("Changed while it was open here")).toBeDefined();
    expect(() => row("Reception Room review pack")).toThrow();
    expect(screen.queryByText(/Approval did not save/u)).toBeNull();
    expect(mocks.addToast).not.toHaveBeenCalled();
  });

  it("keeps the review open, with its steps in place while they are read again, when it moved on but is still waiting", async () => {
    mocks.startReview.mockRejectedValueOnce(new ApiError(409, "Cannot start review from state 'under_review'", "INVALID_TRANSITION"));
    const reread = deferred<ReturnType<typeof gates>>();
    mocks.getAvailableTransitions
      .mockResolvedValueOnce(TO_START)
      .mockResolvedValueOnce(IN_REVIEW)
      .mockReturnValueOnce(reread.promise);
    render(<ReviewsView />);
    await openReview();
    fireEvent.click(await screen.findByRole("button", { name: "Start review" }));

    expect((await screen.findByTestId("review-moved-on")).textContent)
      .toBe("Reception Room review pack changed while it was open here. It is now under review, so your decision was not recorded.");
    await act(async () => { reread.resolve(IN_REVIEW); await reread.promise; });
    expect(await screen.findByRole("button", { name: "Approve…" })).toBeDefined();
    expect(screen.getByTestId("review-moved-on")).toBeDefined();
    expect(screen.queryByTestId("review-action-error")).toBeNull();
  });

  it("keeps the steps mounted, and waiting, while the same review is read again", async () => {
    mocks.startReview.mockRejectedValueOnce(new ApiError(409, "Conflict", "SNAPSHOT_CONFLICT"));
    const reread = deferred<ReturnType<typeof gates>>();
    mocks.getAvailableTransitions
      .mockResolvedValueOnce(TO_START)
      .mockResolvedValueOnce(TO_START)
      .mockReturnValueOnce(reread.promise);
    render(<ReviewsView />);
    await openReview();
    fireEvent.click(await screen.findByRole("button", { name: "Start review" }));
    expect((await screen.findByTestId("review-moved-on")).textContent).toContain("It has been read again; look it over before deciding.");
    const start = screen.getByRole("button", { name: "Start review" });
    expect(start).toHaveProperty("disabled", true);
    await act(async () => { reread.resolve(TO_START); await reread.promise; });
    await waitFor(() => { expect(screen.getByRole("button", { name: "Start review" })).toHaveProperty("disabled", false); });
    expect(screen.getByRole("button", { name: "Start review" })).toBe(start);
  });

  it("reads the queue again quietly when the tab is looked at, and says where an open review went", async () => {
    mocks.listPendingReviews
      .mockResolvedValueOnce([pendingReview(), pendingReview({ id: SECOND_ID, name: "Late submission", stageSince: "2026-06-19T09:30:00.000Z" })])
      .mockResolvedValue([pendingReview({ id: SECOND_ID, name: "Late submission", stageSince: "2026-06-19T09:30:00.000Z" })]);
    mocks.getAvailableTransitions.mockImplementation((id: string) => Promise.resolve(id === CONFIG_ID && mocks.listPendingReviews.mock.calls.length > 1
      ? gates("approved", []) : TO_START));
    render(<ReviewsView />);
    await openReview();
    await screen.findByRole("button", { name: "Start review" });

    act(() => { document.dispatchEvent(new Event("visibilitychange")); });
    expect(await screen.findByText("Reception Room review pack changed while it was open here. It is now approved.")).toBeDefined();
    expect(screen.getByText("Changed while it was open here")).toBeDefined();
    // A quiet read never shows it is reading.
    expect(screen.queryByText("Reading the queue again…")).toBeNull();
    expect(() => row("Reception Room review pack")).toThrow();
    fireEvent.click(screen.getByRole("button", { name: "Open the next review" }));
    expect(await screen.findByRole("heading", { level: 2, name: "Late submission" })).toBeDefined();
  });

  it("keeps a failed decision visible and lets it be tried again", async () => {
    mocks.listPendingReviews.mockResolvedValue([pendingReview({ reviewStatus: "under_review" })]);
    mocks.getAvailableTransitions.mockResolvedValue(IN_REVIEW);
    mocks.approveLayout.mockRejectedValueOnce(new Error("approval write rejected"));
    render(<ReviewsView />);
    await openReview();
    fireEvent.click(await screen.findByRole("button", { name: "Approve…" }));
    fireEvent.click(screen.getByRole("button", { name: "Approve and email" }));
    expect((await screen.findByTestId("review-action-error")).textContent)
      .toBe("Approval did not save. The layout has not been approved and nobody was emailed.");
    const again = screen.getByRole("button", { name: "Approve and email" });
    expect(again).toHaveProperty("disabled", false);
    fireEvent.click(again);
    await waitFor(() => { expect(mocks.approveLayout).toHaveBeenCalledTimes(2); });
    expect(await screen.findByTestId("review-recorded")).toBeDefined();
  });

  it.each(["resolve", "reject"] as const)("leaves review B alone when an approval for A %ss after B is opened", async (outcome) => {
    const approval = deferred<{ reviewStatus: string; notificationPolicy: string }>();
    mocks.approveLayout.mockReturnValueOnce(approval.promise);
    mocks.listPendingReviews.mockResolvedValue([
      pendingReview({ reviewStatus: "under_review" }),
      pendingReview({ id: SECOND_ID, name: "Second review", reviewStatus: "under_review" }),
    ]);
    mocks.getAvailableTransitions.mockResolvedValue(IN_REVIEW);
    render(<ReviewsView />);
    await openReview();
    fireEvent.click(await screen.findByRole("button", { name: "Approve…" }));
    fireEvent.click(screen.getByRole("button", { name: "Approve and email" }));
    fireEvent.click(row("Second review"));
    await screen.findByRole("heading", { level: 2, name: "Second review" });
    const approve = await screen.findByRole("button", { name: "Approve…" });
    await act(async () => {
      if (outcome === "resolve") approval.resolve({ reviewStatus: "approved", notificationPolicy: "team_requested" });
      else approval.reject(new Error("Obsolete approval failure"));
      await approval.promise.catch(() => undefined);
    });
    expect(screen.getByRole("heading", { level: 2, name: "Second review" })).toBeDefined();
    expect(approve).toHaveProperty("disabled", false);
    expect(screen.queryByTestId("review-action-error")).toBeNull();
    if (outcome === "resolve") {
      // The approval landed: the queue says so, and nothing interrupts B.
      expect(() => row("Reception Room review pack")).toThrow();
      expect(mocks.addToast).not.toHaveBeenCalled();
    } else {
      expect(row("Reception Room review pack")).toBeDefined();
      expect(mocks.addToast).toHaveBeenCalledWith(
        "Reception Room review pack: Approval did not save. The layout has not been approved and nobody was emailed.", "error");
    }
  });

  it.each(["resolve", "reject"] as const)("ignores an older read of a review that %ss after a newer one", async (outcome) => {
    const olderHistory = deferred<ReviewHistoryEntry[]>();
    mocks.listPendingReviews.mockResolvedValue([
      pendingReview({ reviewStatus: "under_review" }),
      pendingReview({ id: SECOND_ID, name: "Second review", reviewStatus: "under_review" }),
    ]);
    mocks.getAvailableTransitions.mockResolvedValue(IN_REVIEW);
    mocks.getReviewHistory
      .mockReturnValueOnce(olderHistory.promise)
      .mockResolvedValueOnce([historyEntry({ configurationId: SECOND_ID })])
      .mockResolvedValueOnce([historyEntry({ toStatus: "under_review", note: "Current staff review." })]);
    render(<StrictMode><ReviewsView /></StrictMode>);
    await openReview();
    fireEvent.click(row("Second review"));
    await screen.findByRole("heading", { level: 2, name: "Second review" });
    fireEvent.click(row("Reception Room review pack"));
    expect(await screen.findByText("Current staff review.")).toBeDefined();
    await act(async () => {
      if (outcome === "resolve") olderHistory.resolve([historyEntry({ note: "Obsolete submitted history." })]);
      else olderHistory.reject(new Error("Obsolete context failure"));
      await olderHistory.promise.catch(() => undefined);
    });
    expect(screen.getByRole("button", { name: "Approve…" })).toBeDefined();
    expect(screen.getByText("Current staff review.")).toBeDefined();
    expect(screen.queryByText("Obsolete submitted history.")).toBeNull();
    expect(screen.queryByTestId("review-context-error")).toBeNull();
  });
});
