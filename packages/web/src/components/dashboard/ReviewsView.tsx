import { useCallback, useEffect, useId, useRef, useState, type KeyboardEvent, type ReactElement } from "react";
import type { ConfigurationReviewStatus } from "@omnitwin/types";
import { ApiError } from "../../api/client.js";
import {
  approveLayout,
  getAvailableTransitions,
  getLatestSnapshot,
  getReviewHistory,
  listPendingReviews,
  rejectLayout,
  requestChanges,
  safeParseSnapshot,
  startReview,
  withdrawReview,
  type PendingReviewEntry,
  type ReviewNotificationPolicy,
} from "../../api/configuration-reviews.js";
import { useMediaQuery } from "../../hooks/use-media-query.js";
import { useAuthStore } from "../../stores/auth-store.js";
import { useToastStore } from "../../stores/toast-store.js";
import { ActivityStatus } from "../shared/Activity.js";
import { deskGreeting, venueYear } from "./enquiries/enquiry-desk-format.js";
import {
  countStages, orderQueue, queueSummary, STATUS_IN_WORDS, type ReviewFilter,
} from "./reviews/review-desk-format.js";
import { ReviewStages } from "./reviews/ReviewStages.js";
import { ReviewLedger } from "./reviews/ReviewLedger.js";
import {
  ReviewPanel, type ReviewContextState, type ReviewDecision, type ReviewMove, type SnapshotState,
} from "./reviews/ReviewPanel.js";
import { ReviewOverview, type Recorded } from "./reviews/ReviewOverview.js";
import "./enquiries/EnquiriesDesk.css";
import "./reviews/ReviewsDesk.css";

// ---------------------------------------------------------------------------
// ReviewsView — the Layout reviews desk (roadmap X2).
//
// The queue of submitted layouts sits on the ivory sheet under its three
// stage counts, which are also its filters; the forest decision panel beside
// it holds the open review, so the queue keeps its place while a reviewer
// works through it with the mouse or with j, k and Enter alone. The open
// review is in the address (?review=), so a reload or a shared link returns
// to it. Below 1180px the queue and the panel take turns.
//
// Every decision is said in place: what it will send before it is made, and
// what happened after. A decision that met a review someone else had already
// moved says where the review now stands instead of "did not save".
// ---------------------------------------------------------------------------

const WIDE_DESK = "(min-width: 1180px)";

/** The statuses that keep a review in the queue. */
const PENDING: ReadonlySet<ConfigurationReviewStatus> = new Set<ConfigurationReviewStatus>([
  "submitted", "under_review", "changes_requested",
]);

// The API's 409 codes for a review that moved on before a decision reached
// it: someone else decided, or the planner withdrew it.
const REVIEW_MOVED_CODES: ReadonlySet<string> = new Set([
  "INVALID_TRANSITION", "SNAPSHOT_CONFLICT", "SNAPSHOT_ALREADY_APPROVED",
]);

function reviewMovedOn(error: unknown): boolean {
  return error instanceof ApiError && error.status === 409 && REVIEW_MOVED_CODES.has(error.code);
}

function approvalOutcome(policy: ReviewNotificationPolicy | undefined, hasPlanner: boolean): string {
  if (policy === "suppressed_demo") return "Approved. Nobody was emailed.";
  return hasPlanner
    ? "Approved. The planner and your hallkeepers are being emailed."
    : "Approved. Your hallkeepers are being emailed.";
}

const FAILURE_WORDS: Readonly<Record<ReviewMove, string>> = {
  under_review: "The review could not be started. Nothing was changed; try again.",
  approved: "Approval did not save. The layout has not been approved and nobody was emailed.",
  changes_requested: "The change request did not save. The planner has not been emailed.",
  rejected: "The rejection did not save. The planner has not been emailed.",
  withdrawn: "Withdrawing did not save. This review is still active.",
};

const ANNOUNCEMENTS: Readonly<Partial<Record<ConfigurationReviewStatus, string>>> = {
  under_review: "Now in review with you.",
  changes_requested: "Sent back to the planner for changes.",
};

interface QueueState {
  readonly status: "loading" | "ready" | "error";
  /** The latest queue; kept while it is read again. */
  readonly entries: readonly PendingReviewEntry[];
  readonly message: string | null;
}

interface PendingFocus {
  readonly kind: "panel" | "row" | "action" | "recorded";
  readonly id: string | null;
}

export interface ReviewsViewProps {
  /** The review the address names (?review=, or the reviewer email's
   *  ?config=). Opened once the queue has been read, and only if it is still
   *  in it: a link to a review that has since been decided says so and lands
   *  on the queue, not on an error. */
  readonly reviewId?: string | null;
  /** Told which review is open, or null, so the address can follow it. */
  readonly onReviewShown?: (reviewId: string | null) => void;
}

export function ReviewsView({ reviewId = null, onReviewShown }: ReviewsViewProps = {}): ReactElement {
  const wide = useMediaQuery(WIDE_DESK);
  const titleId = useId();
  const addToast = useToastStore((s) => s.addToast);
  const userName = useAuthStore((s) => s.user?.name ?? null);
  const [queue, setQueue] = useState<QueueState>({ status: "loading", entries: [], message: null });
  // A read the reader asked for shows it is reading; a quiet one (each minute,
  // and when the tab is looked at again) keeps the queue current unseen.
  const [reload, setReload] = useState<{ readonly count: number; readonly quiet: boolean }>({ count: 0, quiet: false });
  const [filter, setFilter] = useState<ReviewFilter>("all");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [openedIndex, setOpenedIndex] = useState(-1);
  const [context, setContext] = useState<{ readonly id: string | null } & ReviewContextState>({ id: null, status: "loading", value: null, message: null });
  const [contextVersion, setContextVersion] = useState(0);
  const [snapshot, setSnapshot] = useState<{ readonly id: string | null; readonly state: SnapshotState }>({ id: null, state: { status: "loading" } });
  const [snapshotVersion, setSnapshotVersion] = useState(0);
  const [confirming, setConfirming] = useState<ReviewDecision | null>(null);
  const [saving, setSaving] = useState<{ readonly id: string; readonly move: ReviewMove } | null>(null);
  const [failure, setFailure] = useState<{ readonly id: string; readonly message: string } | null>(null);
  const [movedNotice, setMovedNotice] = useState<{ readonly id: string; readonly message: string } | null>(null);
  const [recorded, setRecorded] = useState<Recorded | null>(null);
  const [linkNotice, setLinkNotice] = useState<string | null>(null);
  const [announcement, setAnnouncement] = useState<string | null>(null);
  const [stamp, setStamp] = useState<{ readonly id: string; readonly key: number } | null>(null);
  const [nowMs, setNowMs] = useState(() => Date.now());
  const deskRef = useRef<HTMLDivElement>(null);
  const sheetHeadingRef = useRef<HTMLHeadingElement>(null);
  const panelHeadingRef = useRef<HTMLHeadingElement>(null);
  const selectedIdRef = useRef(selectedId);
  const pendingFocusRef = useRef<PendingFocus | null>(null);
  // Each address is honoured once, so closing a review is not undone by the
  // next render, and the address the desk itself wrote is not re-applied.
  const appliedLinkRef = useRef<string | null>(null);
  const openingRef = useRef<string | null>(null);
  const savingIdRef = useRef<string | null>(null);

  useEffect(() => { selectedIdRef.current = selectedId; }, [selectedId]);

  // "3 hours ago" stays true while the desk is open all day.
  useEffect(() => {
    const timer = window.setInterval(() => { setNowMs(Date.now()); }, 60_000);
    return () => { window.clearInterval(timer); };
  }, []);

  // The queue, read on arrival and on Try again; the rows stay while it is re-read.
  useEffect(() => {
    let current = true;
    if (!reload.quiet) setQueue((previous) => ({ ...previous, status: "loading", message: null }));
    void listPendingReviews()
      .then((entries) => {
        if (!current) return;
        const open = selectedIdRef.current;
        const departed = open === null || entries.some((entry) => entry.id === open) || savingIdRef.current === open
          ? undefined : entriesRef.current.find((entry) => entry.id === open);
        setQueue({ status: "ready", entries, message: null });
        if (departed !== undefined) void explainDepartureRef.current(departed);
      })
      .catch((error: unknown) => {
        // A quiet read that fails leaves the queue as it was.
        if (!current || reload.quiet) return;
        setQueue((previous) => ({ ...previous, status: "error",
          message: error instanceof Error ? error.message : "The queue could not be read." }));
      });
    return () => { current = false; };
  }, [reload]);

  useEffect(() => {
    const readQuietly = (): void => {
      if (document.visibilityState === "visible") setReload((previous) => ({ count: previous.count + 1, quiet: true }));
    };
    const timer = window.setInterval(readQuietly, 60_000);
    document.addEventListener("visibilitychange", readQuietly);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", readQuietly);
    };
  }, []);

  const entries = queue.entries;
  const selected = entries.find((entry) => entry.id === selectedId);
  const rows = orderQueue(entries, filter);
  const entriesRef = useRef(entries);
  useEffect(() => { entriesRef.current = entries; }, [entries]);

  // The address names a review: open it once the queue holds it.
  useEffect(() => {
    if (reviewId === null || queue.status !== "ready" || appliedLinkRef.current === reviewId) return;
    appliedLinkRef.current = reviewId;
    if (reviewId === selectedIdRef.current) return;
    const linked = entries.find((entry) => entry.id === reviewId);
    if (linked === undefined) {
      setLinkNotice("The review you followed is no longer waiting for a decision.");
      onReviewShown?.(null);
      return;
    }
    setFilter("all");
    openingRef.current = linked.id;
    setSelectedId(linked.id);
    setOpenedIndex(orderQueue(entries, "all").findIndex((entry) => entry.id === linked.id));
    pendingFocusRef.current = { kind: "panel", id: linked.id };
  }, [entries, onReviewShown, queue.status, reviewId]);

  // The address follows the open review.
  const shownId = selected?.id ?? null;
  useEffect(() => {
    // Until the queue has been read, a review the address names may yet open.
    if (queue.status !== "ready" && shownId === null) return;
    // A linked review about to open is not a review closed.
    if (shownId === null && openingRef.current !== null) return;
    openingRef.current = null;
    if (shownId !== null) appliedLinkRef.current = shownId;
    onReviewShown?.(shownId);
  }, [onReviewShown, queue.status, shownId]);

  // The open review's gates and timeline. Read again after every move; the
  // last reading stays on screen until the new one lands.
  useEffect(() => {
    if (selectedId === null) return;
    let current = true;
    setContext((previous) => previous.id === selectedId
      ? { ...previous, status: "loading", message: null }
      : { id: selectedId, status: "loading", value: null, message: null });
    void Promise.all([getReviewHistory(selectedId), getAvailableTransitions(selectedId)])
      .then(([history, gates]) => {
        if (!current) return;
        setContext({ id: selectedId, status: "ready", message: null, value: {
          currentStatus: gates.currentStatus,
          availableTransitions: gates.availableTransitions,
          demoEligible: gates.internalDemoReviewEligible,
          history,
        } });
        // Where the server's status differs from the queue's, the server is right.
        const listed = entriesRef.current.find((entry) => entry.id === selectedId);
        if (listed !== undefined && listed.reviewStatus !== gates.currentStatus) {
          applyStatusRef.current(listed, gates.currentStatus, {
            outcome: `${listed.name} changed after the queue was read. It is now ${STATUS_IN_WORDS[gates.currentStatus]}.`,
            movedElsewhere: true,
          });
        }
      })
      .catch((error: unknown) => {
        if (!current) return;
        setContext({ id: selectedId, status: "error", value: null,
          message: error instanceof Error ? error.message : null });
      });
    return () => { current = false; };
  }, [selectedId, contextVersion]);

  // When the queue and the gates disagree about the open review's stage (after
  // a move here, or a quiet read of someone else's), read its gates again.
  const selectedStatus = selected?.reviewStatus ?? null;
  useEffect(() => {
    if (selectedStatus === null || context.id !== selectedId || context.status === "loading") return;
    if (context.value !== null && context.value.currentStatus !== selectedStatus) setContextVersion((version) => version + 1);
    // Only a change of stage asks; the context it compares with is read here.
  }, [selectedStatus]);

  // The plan as it was submitted, read once per review opened.
  useEffect(() => {
    if (selectedId === null) return;
    let current = true;
    setSnapshot({ id: selectedId, state: { status: "loading" } });
    void getLatestSnapshot(selectedId)
      .then((envelope) => {
        if (!current) return;
        const parsed = safeParseSnapshot(envelope);
        setSnapshot({ id: selectedId, state: parsed === null ? { status: "error" } : { status: "ready", snapshot: parsed } });
      })
      .catch((error: unknown) => {
        if (!current) return;
        const none = error instanceof ApiError && error.status === 404;
        setSnapshot({ id: selectedId, state: none ? { status: "none" } : { status: "error" } });
      });
    return () => { current = false; };
  }, [selectedId, snapshotVersion]);

  // Keyboard focus follows the reader: into the panel when a review opens,
  // onto the next step after a move, back to its row when it closes. A
  // request waits for the render that shows its target.
  useEffect(() => {
    const pending = pendingFocusRef.current;
    if (pending === null) return;
    const desk = deskRef.current;
    if (desk === null) return;
    switch (pending.kind) {
      case "panel":
        if (shownId !== pending.id || panelHeadingRef.current === null) return;
        pendingFocusRef.current = null;
        panelHeadingRef.current.focus();
        return;
      case "action": {
        if (shownId !== pending.id || confirming !== null) return;
        // Wait for the steps of the stage the review is in now.
        if (context.status !== "error" && (context.status === "loading" || context.value?.currentStatus !== selected?.reviewStatus)) return;
        const action = desk.querySelector<HTMLButtonElement>("button[data-primary='true']:not(:disabled)");
        (action ?? panelHeadingRef.current)?.focus();
        pendingFocusRef.current = null;
        return;
      }
      case "recorded": {
        if (recorded === null || shownId !== null) return;
        pendingFocusRef.current = null;
        const next = desk.querySelector<HTMLButtonElement>(".rev-panel button[data-primary='true']");
        (next ?? panelHeadingRef.current)?.focus();
        return;
      }
      case "row": {
        if (shownId !== null) return;
        pendingFocusRef.current = null;
        const row = [...desk.querySelectorAll<HTMLButtonElement>("button[data-review-id]")]
          .find((button) => button.dataset.reviewId === pending.id);
        (row ?? sheetHeadingRef.current)?.focus();
        return;
      }
    }
  });

  const open = (entry: PendingReviewEntry): void => {
    setOpenedIndex(rows.findIndex((row) => row.id === entry.id));
    setSelectedId(entry.id);
    setConfirming(null);
    setRecorded(null);
    setLinkNotice(null);
    setAnnouncement(null);
    pendingFocusRef.current = { kind: "panel", id: entry.id };
  };

  const close = (): void => {
    const closing = selectedId ?? recorded?.id ?? null;
    setSelectedId(null);
    setConfirming(null);
    setRecorded(null);
    setAnnouncement(null);
    pendingFocusRef.current = { kind: "row", id: closing };
  };

  const listedIndex = selectedId === null ? -1 : rows.findIndex((row) => row.id === selectedId);
  // Where the open review sat when it was opened. A decision can move it to
  // another stage, or out of the queue; the reader carries on from its place.
  const anchor = openedIndex >= 0 ? openedIndex : listedIndex;
  const others = rows.filter((row) => row.id !== selectedId);
  const stepTarget = (direction: 1 | -1): PendingReviewEntry | undefined => {
    if (listedIndex >= 0 && listedIndex === anchor) return rows[listedIndex + direction];
    if (anchor < 0) return undefined;
    return direction === 1 ? others[anchor] : others[anchor - 1];
  };
  /** The next review that waits on the venue, from the open review's place on. */
  const nextWaiting = (): PendingReviewEntry | null => {
    const waits = (row: PendingReviewEntry): boolean => row.reviewStatus === "submitted" || row.reviewStatus === "under_review";
    const from = Math.max(0, anchor);
    return others.slice(from).find(waits) ?? others.slice(0, from).find(waits) ?? null;
  };
  const step = (direction: 1 | -1): void => {
    const target = stepTarget(direction);
    if (target !== undefined) open(target);
  };

  /** Moves a review to a status in the queue: kept with its new stage, or
   *  taken out with a record of what happened when it has left the queue. */
  function applyStatus(entry: PendingReviewEntry, next: ConfigurationReviewStatus, leaving: Omit<Recorded, "id" | "name">): void {
    const stays = PENDING.has(next);
    setQueue((previous) => ({
      ...previous,
      entries: stays
        ? previous.entries.map((row) => row.id === entry.id ? { ...row, reviewStatus: next, stageSince: new Date().toISOString(), stageByName: null } : row)
        : previous.entries.filter((row) => row.id !== entry.id),
    }));
    if (selectedIdRef.current !== entry.id) return;
    if (stays) {
      setStamp((previous) => ({ id: entry.id, key: (previous?.key ?? 0) + 1 }));
      return;
    }
    setOpenedIndex(rows.findIndex((row) => row.id === entry.id));
    setSelectedId(null);
    setConfirming(null);
    setRecorded({ id: entry.id, name: entry.name, ...leaving });
    pendingFocusRef.current = { kind: "recorded", id: entry.id };
  }

  const applyStatusRef = useRef(applyStatus);
  useEffect(() => { applyStatusRef.current = applyStatus; });
  useEffect(() => { savingIdRef.current = saving?.id ?? null; }, [saving]);

  /** The open review left the queue on a quiet read: someone else decided it,
   *  or its planner withdrew it. Say where it went rather than let it vanish. */
  async function explainDeparture(entry: PendingReviewEntry): Promise<void> {
    let outcome = `${entry.name} is no longer waiting for review.`;
    try {
      const now = await getAvailableTransitions(entry.id);
      outcome = `${entry.name} changed while it was open here. It is now ${STATUS_IN_WORDS[now.currentStatus]}.`;
    } catch {
      // The plainer words stand.
    }
    if (selectedIdRef.current !== entry.id) return;
    const focusWasInPanel = deskRef.current?.querySelector(".rev-panel")?.contains(document.activeElement) === true;
    setOpenedIndex(rows.findIndex((row) => row.id === entry.id));
    setSelectedId(null);
    setConfirming(null);
    setRecorded({ id: entry.id, name: entry.name, outcome, movedElsewhere: true });
    if (focusWasInPanel) pendingFocusRef.current = { kind: "recorded", id: entry.id };
  }
  const explainDepartureRef = useRef(explainDeparture);
  useEffect(() => { explainDepartureRef.current = explainDeparture; });

  const reportMovedOn = async (entry: PendingReviewEntry): Promise<void> => {
    try {
      const now = await getAvailableTransitions(entry.id);
      if (now.currentStatus === entry.reviewStatus) {
        if (selectedIdRef.current === entry.id) {
          setConfirming(null);
          setMovedNotice({ id: entry.id, message: "This review changed while it was open here, so your decision was not recorded. It has been read again; look it over before deciding." });
          setContextVersion((version) => version + 1);
        }
        return;
      }
      const notice = `${entry.name} changed while it was open here. It is now ${STATUS_IN_WORDS[now.currentStatus]}, so your decision was not recorded.`;
      if (selectedIdRef.current === entry.id && PENDING.has(now.currentStatus)) {
        setConfirming(null);
        setMovedNotice({ id: entry.id, message: notice });
      }
      applyStatus(entry, now.currentStatus, { outcome: notice, movedElsewhere: true });
    } catch {
      if (selectedIdRef.current === entry.id) {
        setFailure({ id: entry.id, message: "This review changed while it was open here, so your decision was not recorded. Close it and open it again from the queue." });
      }
    }
  };

  const runMove = async (entry: PendingReviewEntry, move: ReviewMove, input: { readonly note: string; readonly notifyTeam: boolean }): Promise<void> => {
    setSaving({ id: entry.id, move });
    setFailure(null);
    setMovedNotice(null);
    setAnnouncement(null);
    const hasPlanner = entry.userId !== null;
    try {
      let next: ConfigurationReviewStatus;
      let outcome: string;
      switch (move) {
        case "under_review":
          next = await startReview(entry.id);
          outcome = "In review.";
          break;
        case "approved": {
          const demoEligible = context.id === entry.id && context.value?.demoEligible === true;
          const result = demoEligible ? await approveLayout(entry.id, undefined, input.notifyTeam) : await approveLayout(entry.id);
          next = result.reviewStatus;
          outcome = approvalOutcome(result.notificationPolicy, hasPlanner);
          break;
        }
        case "changes_requested":
          next = await requestChanges(entry.id, input.note);
          outcome = hasPlanner ? "Changes asked for. The planner is being emailed your note." : "Changes asked for. There is no planner account to email.";
          break;
        case "rejected":
          next = await rejectLayout(entry.id, input.note);
          outcome = hasPlanner ? "Rejected. The planner is being emailed your note." : "Rejected. There is no planner account to email.";
          break;
        case "withdrawn":
          next = await withdrawReview(entry.id);
          outcome = "Withdrawn from review. Nobody was emailed.";
          break;
      }
      const stillOpen = selectedIdRef.current === entry.id;
      applyStatus(entry, next, { outcome, movedElsewhere: false });
      if (stillOpen && PENDING.has(next)) {
        setConfirming(null);
        setAnnouncement(ANNOUNCEMENTS[next] ?? outcome);
        pendingFocusRef.current = { kind: "action", id: entry.id };
      }
    } catch (error: unknown) {
      if (reviewMovedOn(error)) {
        await reportMovedOn(entry);
      } else if (selectedIdRef.current === entry.id) {
        setFailure({ id: entry.id, message: FAILURE_WORDS[move] });
      } else {
        addToast(`${entry.name}: ${FAILURE_WORDS[move]}`, "error");
      }
    } finally {
      setSaving((current) => current?.id === entry.id ? null : current);
    }
  };

  const requestDecision = (decision: ReviewDecision): void => {
    if (selected === undefined || saving?.id === selected.id) return;
    setFailure(null);
    setMovedNotice(null);
    setAnnouncement(null);
    setConfirming(decision);
  };

  const confirmDecision = (input: { readonly note: string; readonly notifyTeam: boolean }): void => {
    if (selected === undefined || confirming === null || saving?.id === selected.id) return;
    void runMove(selected, confirming, input);
  };

  const cancelDecision = (): void => {
    if (confirming === null || (selected !== undefined && saving?.id === selected.id)) return;
    setConfirming(null);
    setFailure(null);
    if (selected !== undefined) {
      const decision = confirming;
      pendingFocusRef.current = null;
      window.requestAnimationFrame(() => {
        deskRef.current?.querySelector<HTMLButtonElement>(`button[data-decision="${decision}"]`)?.focus();
      });
    }
  };

  const onDeskKeyDown = (event: KeyboardEvent<HTMLDivElement>): void => {
    if (event.key !== "Escape" || event.defaultPrevented) return;
    if (confirming !== null) {
      event.preventDefault();
      cancelDecision();
      return;
    }
    if (selectedId !== null || recorded !== null) {
      event.preventDefault();
      close();
    }
  };

  const chooseFilter = (next: ReviewFilter): void => {
    setOpenedIndex(-1);
    setFilter(next);
  };

  const retryContext = useCallback((): void => { setContextVersion((version) => version + 1); }, []);
  const retrySnapshot = useCallback((): void => { setSnapshotVersion((version) => version + 1); }, []);

  const counts = queue.status === "loading" && entries.length === 0 ? null : countStages(entries);
  const longestWaiting = orderQueue(entries, "to_start")[0] ?? null;
  const summary = counts === null ? null : queueSummary(counts, longestWaiting, nowMs);
  const year = venueYear(nowMs);
  const greeting = deskGreeting(nowMs, userName);
  const panelOpen = selected !== undefined || recorded !== null;
  const showSheet = wide || !panelOpen;
  const showPanel = wide || panelOpen;
  const navigation = {
    layout: wide ? "wide" as const : "single" as const,
    canPrevious: stepTarget(-1) !== undefined,
    canNext: stepTarget(1) !== undefined,
    onClose: close,
    onStep: step,
  };
  const panelContext: ReviewContextState = selected !== undefined && context.id === selected.id
    ? context : { status: "loading", value: null, message: null };

  return (
    <div ref={deskRef} className={`enq-desk rev-desk${wide ? "" : " enq-desk--single"}`} data-register="ivory" onKeyDown={onDeskKeyDown}>
      {showSheet && (
        <section className="enq-sheet" aria-labelledby={titleId}>
          <header className="enq-head">
            <p className="enq-greeting">
              <span>{greeting.date}</span>
              <span aria-hidden="true">·</span>
              <span>{greeting.greeting}</span>
            </p>
            <h1 id={titleId} ref={sheetHeadingRef} tabIndex={-1}>Pending reviews</h1>
          </header>
          <div className="enq-summary">
            {summary !== null && (
              <p data-testid="reviews-summary">
                {summary.map((part, index) => typeof part === "string" ? part
                  : <strong key={index} data-tone={part.tone}>{part.strong}</strong>)}
              </p>
            )}
            {summary === null && queue.status === "loading" && <ActivityStatus>Reading the queue…</ActivityStatus>}
          </div>

          <ReviewStages filter={filter} counts={counts} onFilter={chooseFilter} />

          {linkNotice !== null && (
            <div className="enq-notice" data-testid="reviews-link-notice">
              <p role="status">{linkNotice}</p>
            </div>
          )}

          {queue.status === "loading" && entries.length > 0 && <ActivityStatus className="enq-sheet__activity">Reading the queue again…</ActivityStatus>}

          {queue.status === "error" && (
            <div className="enq-notice enq-notice--alert" role="alert" data-testid="reviews-load-error">
              <p>The queue could not be read{queue.message === null ? "." : `: ${queue.message}`}</p>
              <button type="button" className="enq-button" onClick={() => { setReload((previous) => ({ count: previous.count + 1, quiet: false })); }}>Try again</button>
            </div>
          )}

          {queue.status === "ready" && rows.length === 0 && (
            <div className="enq-empty">
              <h2>{filter === "all" ? "No layouts waiting" : "None at this stage"}</h2>
              <p>{filter === "all" ? "Layouts appear here as planners submit them for review." : "Choose All to see every layout waiting."}</p>
            </div>
          )}

          <ReviewLedger rows={rows} selectedId={selectedId} nowMs={nowMs} year={year} onOpen={open} />
        </section>
      )}

      {showPanel && (selected !== undefined ? (
        <ReviewPanel
          key={selected.id}
          entry={selected}
          nowMs={nowMs}
          readerName={userName}
          context={panelContext}
          snapshot={snapshot.id === selected.id ? snapshot.state : { status: "loading" }}
          decision={{
            confirming,
            saving: saving?.id === selected.id ? saving.move : null,
            failure: failure?.id === selected.id ? failure.message : null,
            movedNotice: movedNotice?.id === selected.id ? movedNotice.message : null,
          }}
          announcement={announcement}
          stampKey={stamp !== null && stamp.id === selected.id ? stamp.key : null}
          navigation={navigation}
          headingRef={panelHeadingRef}
          onStart={() => { void runMove(selected, "under_review", { note: "", notifyTeam: true }); }}
          onRequest={requestDecision}
          onConfirm={confirmDecision}
          onCancel={cancelDecision}
          onRetryContext={retryContext}
          onRetrySnapshot={retrySnapshot}
        />
      ) : (wide || recorded !== null) ? (
        <ReviewOverview
          counts={counts}
          next={longestWaiting}
          nowMs={nowMs}
          recorded={recorded}
          after={recorded === null ? null : nextWaiting()}
          navigation={recorded === null ? null : navigation}
          headingRef={panelHeadingRef}
          onOpen={open}
          onFilter={chooseFilter}
        />
      ) : null)}
    </div>
  );
}
