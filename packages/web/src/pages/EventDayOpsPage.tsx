import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent, type ReactElement } from "react";
import { useParams } from "react-router-dom";
import { AlertCircle, Bell, Check, CircleDashed, Clock, NotebookPen, RefreshCw, Send, ShieldAlert, Truck } from "lucide-react";
import type {
  ChangeFeedItem, EventDayIssue, EventDayIssueSeverity, EventDayIssueStatus,
  EventDayOpsBoard, OpsTask, OpsTaskStatus, SupplierInstruction,
} from "@omnitwin/types";
import { ApiError } from "../api/client.js";
import { createEventDayIssue, getEventDayOpsBoard, updateEventDayIssue, updateOpsTaskStatus } from "../api/event-day-ops.js";
import { acknowledgeEventPlanChange, getEventChangeFeed } from "../api/notifications.js";
import {
  ackEventDayOp,
  enqueueEventDayIssueCreate,
  enqueueEventDayTaskStatus,
  listPendingEventDayOps,
} from "../lib/event-day-offline-queue.js";
import { EventMissionControl } from "../components/mission-control/EventMissionControl.js";
import "../styles/hallkeeper-register.css";
import "./EventDayOpsPage.css";
import { DashboardLayout } from "../components/dashboard/DashboardLayout.js";
import { HallkeeperEventLinks } from "../components/hallkeeper/HallkeeperEventLinks.js";
import { ActivityIndicator, ActivityStatus } from "../components/shared/Activity.js";
import { getCalendar } from "../api/diary.js";
import { useAuthStore } from "../stores/auth-store.js";
import { isBoardWorthy } from "./hallkeeper/lib/day-board-state.js";
import { useVenueTimezone } from "./hallkeeper/lib/use-venue-timezone.js";

// ---------------------------------------------------------------------------
// The event-day board — the hallkeeper's surface while an event is running
// (Ship Friday, gate line 21; decision 7).
//
// Three properties this page owes a hallkeeper who is holding a tablet in a
// room, and did not have before:
//
//   LIVE. Ops state (task status, issues, acknowledgements) does not travel
//   on the diary websocket, so the board polls every 10s behind an in-flight
//   guard and pauses while the tab is hidden — a wall tablet left on overnight
//   must not hammer the API. Every mutation refetches immediately, so the
//   board a second hallkeeper sees is never more than one tick stale.
//
//   ACTIONABLE. An issue can be assigned, resolved and closed here. A board
//   that can only CREATE problems is a list that grows all evening.
//
//   SINGLE AUTHORITY. Tasks and issues are managed here and only here;
//   Mission Control renders alongside as the live phase/timeline record with
//   its own incident form and task grid suppressed. Two forms writing to two
//   different tables, side by side, is how a room ends up with two truths.
// ---------------------------------------------------------------------------

/** Ops state has no push channel of its own; this is the honest interval. */
const POLL_INTERVAL_MS = 10_000;

type LoadState =
  | { readonly kind: "loading" }
  | { readonly kind: "error"; readonly message: string }
  | { readonly kind: "ready"; readonly board: EventDayOpsBoard };

interface IssueDraft {
  readonly title: string;
  readonly detail: string;
  readonly severity: EventDayIssueSeverity;
}

const EMPTY_ISSUE_DRAFT: IssueDraft = {
  title: "",
  detail: "",
  severity: "attention",
};

// Every clock face on this page is the VENUE's wall clock. An un-pinned
// toLocaleString reads the tablet's zone, which is whatever the device was
// last set to — not a property of the event.
function formatEventDate(iso: string | null, timeZone: string): string {
  if (iso === null) return "Date not set";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "Date not set";
  return date.toLocaleDateString("en-GB", {
    weekday: "short",
    day: "2-digit",
    month: "short",
    timeZone,
  });
}

function formatTime(iso: string | null, timeZone: string): string {
  if (iso === null) return "--:--";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "--:--";
  return date.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", timeZone });
}

function formatChangeTime(iso: string, timeZone: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "Time unknown";
  return date.toLocaleString("en-GB", {
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
    timeZone,
  });
}

function issueStatusLabel(status: EventDayIssueStatus): string {
  switch (status) {
    case "open": return "Open";
    case "in_progress": return "Being handled";
    case "resolved": return "Resolved";
    case "closed": return "Closed";
  }
}

/**
 * The compiler emits two kinds of supplier row: an arrival somebody captured
 * (a named supplier or an arrival window) and a prompt derived from the
 * approved snapshot. Only the first is an arrival; the rest are notes, and
 * they are labelled as notes rather than quietly dropped.
 */
function isHandoffNote(instruction: SupplierInstruction): boolean {
  return instruction.supplierId === null && instruction.arrivalWindow === null;
}

function isRetriableError(err: unknown): boolean {
  if (!(err instanceof ApiError)) return true;
  if (err.status === 0 || err.status >= 500 || err.status === 408 || err.status === 429) return true;
  return false;
}

function makeIdempotencyKey(taskId: string, status: OpsTaskStatus): string {
  const suffix = typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
    ? crypto.randomUUID()
    : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
  return `event-day:${taskId}:${status}:${suffix}`;
}

function updateTaskInBoard(board: EventDayOpsBoard, updated: OpsTask): EventDayOpsBoard {
  if (board.handoffPack === null) return board;
  return {
    ...board,
    handoffPack: {
      ...board.handoffPack,
      opsTasks: board.handoffPack.opsTasks.map((task) => task.id === updated.id ? updated : task),
    },
    setupProgress: {
      ...board.setupProgress,
      doneTasks: board.handoffPack.opsTasks.map((task) => task.id === updated.id ? updated : task)
        .filter((task) => task.status === "done").length,
      blockedTasks: board.handoffPack.opsTasks.map((task) => task.id === updated.id ? updated : task)
        .filter((task) => task.status === "blocked").length,
      activeTasks: board.handoffPack.opsTasks.map((task) => task.id === updated.id ? updated : task)
        .filter((task) => task.status !== "done" && task.status !== "blocked" && task.status !== "waived").length,
      percent: board.handoffPack.opsTasks.length === 0
        ? 0
        : Math.round((board.handoffPack.opsTasks.map((task) => task.id === updated.id ? updated : task)
          .filter((task) => task.status === "done").length / board.handoffPack.opsTasks.length) * 100),
    },
  };
}

function statusLabel(status: OpsTaskStatus): string {
  switch (status) {
    case "todo": return "To do";
    case "in_progress": return "In progress";
    case "done": return "Done";
    case "blocked": return "Blocked";
    case "waived": return "Waived";
  }
}

function Section(props: {
  readonly title: string;
  readonly subtitle?: string;
  readonly icon: ReactElement;
  readonly children: ReactElement | readonly ReactElement[];
}): ReactElement {
  return (
    <section className="event-day-section">
      <div className="event-day-section-head">
        {props.icon}
        <div>
          <h2>{props.title}</h2>
          {props.subtitle !== undefined && <p>{props.subtitle}</p>}
        </div>
      </div>
      {props.children}
    </section>
  );
}

export function EventDayOpsPage(): ReactElement {
  const { eventId } = useParams<{ eventId: string }>();
  const [state, setState] = useState<LoadState>({ kind: "loading" });
  const [pendingCount, setPendingCount] = useState(0);
  const [syncing, setSyncing] = useState(false);
  const [pendingWrites, setPendingWrites] = useState(0);
  const [pendingIssues, setPendingIssues] = useState(0);
  const [issueDraft, setIssueDraft] = useState<IssueDraft>(EMPTY_ISSUE_DRAFT);
  const [notice, setNotice] = useState<string | null>(null);
  const [changeFeed, setChangeFeed] = useState<readonly ChangeFeedItem[]>([]);
  const [acknowledgedChanges, setAcknowledgedChanges] = useState<ReadonlySet<string>>(new Set());
  const [ackBusyId, setAckBusyId] = useState<string | null>(null);
  const [issueBusyId, setIssueBusyId] = useState<string | null>(null);
  const [lastSyncedAt, setLastSyncedAt] = useState<string | null>(null);
  // The hour this room is actually booked for. `events.starts_at` is planning
  // metadata that drifts from the Diary — on the seeded wedding the event row
  // says 13:00 while the booking says 09:00 — and a board that disagrees with
  // the sheet printed from it is worse than a board with no time at all.
  const [bookedStartsAt, setBookedStartsAt] = useState<string | null>(null);
  const currentUserId = useAuthStore((store) => store.user?.id ?? null);
  // One request at a time. Without this guard a slow API turns a 10s tick
  // into a queue of overlapping reads that each overwrite the last.
  const refreshInFlight = useRef(false);

  const refreshPendingCount = useCallback(() => {
    void listPendingEventDayOps()
      .then((ops) => { setPendingCount(ops.length); })
      .catch(() => { setPendingCount(0); });
  }, []);

  const loadBoard = useCallback(() => {
    if (eventId === undefined || eventId.length === 0) {
      setState({ kind: "error", message: "The event-day board link is missing an event ID." });
      return;
    }
    setState({ kind: "loading" });
    void (async () => {
      const board = await getEventDayOpsBoard(eventId);
      const changes = await getEventChangeFeed(eventId, 25).catch((): ChangeFeedItem[] => []);
      setState({ kind: "ready", board });
      setChangeFeed(changes);
      setLastSyncedAt(new Date().toISOString());
    })()
      .catch(() => {
        setState({
          kind: "error",
          message: "This event-day board could not be loaded. Check the event link or try again.",
        });
      });
  }, [eventId]);

  /**
   * A background refresh: it never shows the full-page loading state and
   * never clears the board on failure, so a tablet that loses the network
   * mid-event keeps showing the last good truth instead of an error screen.
   */
  const refreshBoard = useCallback(() => {
    if (eventId === undefined || eventId.length === 0) return;
    if (refreshInFlight.current) return;
    refreshInFlight.current = true;
    void Promise.all([
      getEventDayOpsBoard(eventId),
      getEventChangeFeed(eventId, 25).catch((): ChangeFeedItem[] => []),
    ])
      .then(([board, changes]) => {
        setState({ kind: "ready", board });
        setChangeFeed(changes);
        setLastSyncedAt(new Date().toISOString());
      })
      .catch(() => {
        // Keep the last good board; the next tick retries.
      })
      .finally(() => { refreshInFlight.current = false; });
  }, [eventId]);

  useEffect(() => {
    const timer = window.setInterval(() => {
      // A wall tablet left on overnight must not poll a hidden tab.
      if (typeof document !== "undefined" && document.hidden) return;
      refreshBoard();
    }, POLL_INTERVAL_MS);
    return () => { window.clearInterval(timer); };
  }, [refreshBoard]);

  const flushQueue = useCallback(() => {
    if (syncing) return;
    setSyncing(true);
    void (async () => {
      const queued = await listPendingEventDayOps();
      for (const op of queued) {
        try {
          if (op.kind === "task_status") {
            await updateOpsTaskStatus(op.opsTaskId, op.input);
          } else {
            await createEventDayIssue(op.eventId, op.input);
          }
          await ackEventDayOp(op.queueKey);
        } catch (err) {
          if (!isRetriableError(err)) {
            await ackEventDayOp(op.queueKey);
          }
        }
      }
      refreshPendingCount();
      if (eventId !== undefined) {
        const [board, changes] = await Promise.all([
          getEventDayOpsBoard(eventId),
          getEventChangeFeed(eventId, 25).catch((): ChangeFeedItem[] => []),
        ]);
        setState({ kind: "ready", board });
        setChangeFeed(changes);
      }
      setSyncing(false);
    })().catch(() => {
      setSyncing(false);
      refreshPendingCount();
    });
  }, [eventId, refreshPendingCount, syncing]);

  useEffect(() => {
    loadBoard();
    refreshPendingCount();
  }, [loadBoard, refreshPendingCount]);

  useEffect(() => {
    window.addEventListener("online", flushQueue);
    return () => { window.removeEventListener("online", flushQueue); };
  }, [flushQueue]);

  const board = state.kind === "ready" ? state.board : null;
  const timeZone = useVenueTimezone(board?.event.venueId ?? null);

  // One read of the Diary for the event's own day, so the hero shows the
  // booked hour rather than the event record's planned one.
  const eventVenueId = board?.event.venueId ?? null;
  const eventPlannedStart = board?.event.startsAt ?? null;
  const boardEventId = board?.event.id ?? null;
  useEffect(() => {
    if (eventVenueId === null || eventPlannedStart === null || boardEventId === null) return;
    const anchor = Date.parse(eventPlannedStart);
    if (!Number.isFinite(anchor)) return;
    let current = true;
    const from = new Date(anchor - 36 * 3_600_000).toISOString();
    const to = new Date(anchor + 36 * 3_600_000).toISOString();
    void getCalendar(eventVenueId, from, to)
      .then((calendar) => {
        if (!current) return;
        // Same predicate the Day Board uses, so the two boards and the sheet
        // cannot disagree about which bookings count; and compared as
        // instants, because lexicographic ISO ordering only holds while every
        // string carries the same offset and precision.
        const candidates = calendar.entries
          .flatMap((entry) => entry.entryType === "booking"
            && entry.eventId === boardEventId
            && isBoardWorthy(entry)
            ? [{ iso: entry.startsAt, ms: Date.parse(entry.startsAt) }]
            : [])
          .filter((entry) => Number.isFinite(entry.ms))
          .sort((a, b) => a.ms - b.ms);
        setBookedStartsAt(candidates[0]?.iso ?? null);
      })
      .catch(() => {
        // No Diary read: the hero falls back to the event record and says so.
        if (current) setBookedStartsAt(null);
      });
    return () => { current = false; };
  }, [boardEventId, eventPlannedStart, eventVenueId]);
  const tasks = board?.handoffPack?.opsTasks ?? [];
  const setupTasks = useMemo(() => tasks.filter((task) => task.kind === "setup"), [tasks]);
  const roomFlipTasks = useMemo(() => tasks.filter((task) => task.kind === "room_flip"), [tasks]);
  const taskList = useMemo(() => [...setupTasks, ...roomFlipTasks], [setupTasks, roomFlipTasks]);
  const openIssues = useMemo(() => board?.issues.filter((issue) => issue.status !== "closed") ?? [], [board]);
  const handoffNotes = useMemo(
    () => board?.handoffPack?.supplierInstructions.filter(isHandoffNote) ?? [],
    [board],
  );
  const syncLabel = pendingCount === 0 ? "Synced" : `${String(pendingCount)} pending sync`;
  const requiredAcknowledgements = useMemo(
    () => changeFeed
      .filter((change) => change.requiresHallkeeperAcknowledgement)
      .filter((change) => !acknowledgedChanges.has(change.id)),
    [acknowledgedChanges, changeFeed],
  );

  const setTaskStatus = useCallback((task: OpsTask, status: OpsTaskStatus) => {
    if (status === task.status) return;
    const optimistic = { ...task, status, updatedAt: new Date().toISOString() };
    setState((prev) => prev.kind === "ready" ? { kind: "ready", board: updateTaskInBoard(prev.board, optimistic) } : prev);
    const input = { status, idempotencyKey: makeIdempotencyKey(task.id, status) };
    setPendingWrites((count) => count + 1);
    void updateOpsTaskStatus(task.id, input)
      .then((updated) => {
        setState((prev) => prev.kind === "ready" ? { kind: "ready", board: updateTaskInBoard(prev.board, updated) } : prev);
        setNotice("Task status updated.");
        refreshBoard();
      })
      .catch((err: unknown) => {
        if (isRetriableError(err)) {
          return enqueueEventDayTaskStatus(task.id, input)
            .then(() => {
              refreshPendingCount();
              setNotice("Task saved on this device and will sync when the connection returns.");
            });
        }
        setState((prev) => prev.kind === "ready" ? { kind: "ready", board: updateTaskInBoard(prev.board, task) } : prev);
        setNotice("Task update was rejected by the server.");
      })
      .catch(() => {
        setState((prev) => prev.kind === "ready" ? { kind: "ready", board: updateTaskInBoard(prev.board, task) } : prev);
        setNotice("Task could not be saved on this device. Please try again.");
      })
      .finally(() => { setPendingWrites((count) => count - 1); });
  }, [refreshBoard, refreshPendingCount]);

  const submitIssue = useCallback((event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (eventId === undefined) return;
    const input = {
      title: issueDraft.title,
      detail: issueDraft.detail,
      severity: issueDraft.severity,
    };
    setPendingIssues((count) => count + 1);
    void createEventDayIssue(eventId, input)
      .then((issue) => {
        setIssueDraft(EMPTY_ISSUE_DRAFT);
        setNotice("Issue logged.");
        setState((prev) => prev.kind === "ready"
          ? { kind: "ready", board: { ...prev.board, issues: [issue, ...prev.board.issues] } }
          : prev);
        refreshBoard();
      })
      .catch((err: unknown) => {
        if (isRetriableError(err)) {
          return enqueueEventDayIssueCreate(eventId, input)
            .then(() => {
              setIssueDraft(EMPTY_ISSUE_DRAFT);
              refreshPendingCount();
              setNotice("Issue saved on this device and will sync when the connection returns.");
            });
        } else {
          setNotice("Issue could not be logged. Check the wording and try again.");
        }
      })
      .catch(() => { setNotice("Issue could not be saved on this device. Please try again."); })
      .finally(() => { setPendingIssues((count) => count - 1); });
  }, [eventId, issueDraft, refreshBoard, refreshPendingCount]);

  const acknowledgeChange = useCallback((change: ChangeFeedItem) => {
    if (eventId === undefined || ackBusyId !== null) return;
    setAckBusyId(change.id);
    void acknowledgeEventPlanChange(eventId, { changeId: change.id })
      .then(() => {
        setAcknowledgedChanges((prev) => new Set([...prev, change.id]));
        setNotice("Change acknowledged.");
        refreshBoard();
      })
      .catch(() => { setNotice("Change acknowledgement could not be saved."); })
      .finally(() => { setAckBusyId(null); });
  }, [ackBusyId, eventId, refreshBoard]);

  /**
   * Issue lifecycle. A board that can only create issues is a list that grows
   * all evening; resolving, closing and taking ownership are what let a
   * hallkeeper clear the deck before handback, and the sheet's "Keep in view"
   * strip reads the same `issues` array, so a resolved issue leaves it too.
   */
  const changeIssue = useCallback((issue: EventDayIssue, patch: {
    readonly status?: EventDayIssueStatus;
    readonly assignedTo?: string | null;
  }, doneNotice: string) => {
    if (eventId === undefined || issueBusyId !== null) return;
    setIssueBusyId(issue.id);
    void updateEventDayIssue(eventId, issue.id, patch)
      .then((updated) => {
        setState((prev) => prev.kind === "ready"
          ? { kind: "ready", board: { ...prev.board, issues: prev.board.issues.map((row) => row.id === updated.id ? updated : row) } }
          : prev);
        setNotice(doneNotice);
        refreshBoard();
      })
      .catch(() => { setNotice("That issue change could not be saved. Try again."); })
      .finally(() => { setIssueBusyId(null); });
  }, [eventId, issueBusyId, refreshBoard]);

  if (state.kind === "loading") {
    return (
      <DashboardLayout>

        <div className="event-day-page event-day-centered" role="status">
        <ActivityIndicator size={64} />
        <h1>Loading event-day board</h1>
        </div>

      </DashboardLayout>
    );
  }

  if (state.kind === "error") {
    return (
      <DashboardLayout>

        <div className="event-day-page event-day-centered">
        <AlertCircle aria-hidden="true" />
        <h1>Event-day board unavailable</h1>
        <p>{state.message}</p>
        <button type="button" className="event-day-button secondary" onClick={loadBoard}>
          <RefreshCw aria-hidden="true" />
          Retry
        </button>
        </div>

      </DashboardLayout>
    );
  }

  const readyBoard = state.board;

  return (
    <DashboardLayout>

      <div className="event-day-page">
      <header className="event-day-hero">
        <div>
          <p className="event-day-kicker">Today&apos;s event</p>
          <h1>{readyBoard.event.name}</h1>
          <p>
            {formatEventDate(bookedStartsAt ?? readyBoard.event.startsAt, timeZone)}
            {" · "}{formatTime(bookedStartsAt ?? readyBoard.event.startsAt, timeZone)}
            {bookedStartsAt === null ? " (planned)" : ""}
            {" · "}{timeZone}{" · "}{readyBoard.event.guestCount} guests
          </p>
        </div>
        <div className="event-day-sync">
          <span data-pending={pendingCount > 0}>{syncLabel}</span>
          <span className="event-day-live">{lastSyncedAt === null ? "Checking for changes…" : `Updated ${formatTime(lastSyncedAt, timeZone)}`}</span>
          <button type="button" className="event-day-icon-button" onClick={flushQueue} aria-label="Sync pending event-day changes" aria-busy={syncing}>
            {syncing ? <ActivityIndicator /> : <RefreshCw aria-hidden="true" />}
          </button>
        </div>
      </header>

      <HallkeeperEventLinks board={readyBoard} />

      {notice !== null && <p className="event-day-notice">{notice}</p>}
      {pendingWrites > 0 && <ActivityStatus>Saving event-day changes…</ActivityStatus>}

      {/* Decision 7: this board owns tasks and issues. Mission Control keeps
          the live phase and timeline record, with its own incident form and
          task grid suppressed so there is one place to act. */}
      <EventMissionControl
        eventId={readyBoard.event.id}
        handoffPackId={readyBoard.handoffPack?.pack.id ?? null}
        ownsExecutionControls={false}
      />

      {readyBoard.sourceStatus === "missing_handoff" && (
        <section className="event-day-empty">
          <h2>No handoff pack linked</h2>
          <p>Create a handoff from an approved snapshot to use this board.</p>
        </section>
      )}

      <Section
        title="Required acknowledgements"
        icon={<Bell aria-hidden="true" />}
      >
        {requiredAcknowledgements.length === 0 ? (
          <p className="event-day-muted">No changes awaiting acknowledgement.</p>
        ) : (
          <div className="event-day-change-feed">
            {requiredAcknowledgements.map((change) => (
              <article key={change.id} data-risk={change.riskLevel}>
                <div>
                  <span>{change.riskLevel}</span>
                  <h3>{change.title}</h3>
                  <p>{change.summary}</p>
                  <small>{formatChangeTime(change.createdAt, timeZone)} · {change.affectedSurfaces.join(", ")}</small>
                </div>
                <button
                  type="button"
                  className="event-day-button secondary"
                  disabled={ackBusyId === change.id}
                  aria-busy={ackBusyId === change.id}
                  onClick={() => { acknowledgeChange(change); }}
                >
                  {ackBusyId === change.id ? <ActivityIndicator size={20} /> : <Check aria-hidden="true" />}
                  Acknowledge change
                </button>
              </article>
            ))}
          </div>
        )}
      </Section>

      <Section
        title="Phase timeline"
        icon={<Clock aria-hidden="true" />}
      >
        <ol className="event-day-phases">
          {readyBoard.phases.map((phase) => (
            <li key={phase.id}>
              <span>{phase.name}</span>
              <strong>{phase.durationMinutes} min</strong>
            </li>
          ))}
        </ol>
      </Section>

      <Section
        title="Setup progress"
        subtitle={`${String(readyBoard.setupProgress.doneTasks)} of ${String(readyBoard.setupProgress.totalTasks)} tasks done.`}
        icon={<Check aria-hidden="true" />}
      >
        <div className="event-day-progress" aria-label="Setup progress">
          <span style={{ width: `${String(readyBoard.setupProgress.percent)}%` }} />
        </div>
        <div className="event-day-progress-stats">
          <span>{readyBoard.setupProgress.activeTasks} active</span>
          <span>{readyBoard.setupProgress.blockedTasks} blocked</span>
          <span>{readyBoard.setupProgress.percent}% done</span>
        </div>
      </Section>

      <Section
        title="Task checklist"
        subtitle="Tasks are managed here for the whole event."
        icon={<CircleDashed aria-hidden="true" />}
      >
        {taskList.length === 0 ? (
          <p className="event-day-muted">No setup or room flip tasks in this handoff.</p>
        ) : (
          <div className="event-day-task-list">
            {taskList.map((task) => (
              <article className="event-day-task" key={task.id}>
                <div>
                  <span>{statusLabel(task.status)}</span>
                  <h3>{task.title}</h3>
                  <p>{task.detail}</p>
                </div>
                <div className="event-day-task-actions" aria-label={`${task.title} status actions`}>
                  <button type="button" onClick={() => { setTaskStatus(task, "in_progress"); }}>
                    Start
                  </button>
                  <button type="button" onClick={() => { setTaskStatus(task, "done"); }}>
                    Done
                  </button>
                  <button type="button" onClick={() => { setTaskStatus(task, "blocked"); }}>
                    Block
                  </button>
                </div>
              </article>
            ))}
          </div>
        )}
      </Section>

      <Section
        title="Issue report"
        subtitle={`${String(openIssues.length)} open issue(s).`}
        icon={<ShieldAlert aria-hidden="true" />}
      >
        <form className="event-day-issue-form" onSubmit={submitIssue}>
          <label>
            Title
            <input
              value={issueDraft.title}
              onChange={(event) => { setIssueDraft((prev) => ({ ...prev, title: event.target.value })); }}
              required
              maxLength={180}
            />
          </label>
          <label>
            Detail
            <textarea
              value={issueDraft.detail}
              onChange={(event) => { setIssueDraft((prev) => ({ ...prev, detail: event.target.value })); }}
              required
              rows={3}
            />
          </label>
          <label>
            Severity
            <select
              value={issueDraft.severity}
              onChange={(event) => { setIssueDraft((prev) => ({ ...prev, severity: event.target.value as EventDayIssueSeverity })); }}
            >
              <option value="info">Info</option>
              <option value="attention">Attention</option>
              <option value="urgent">Urgent</option>
            </select>
          </label>
          <button type="submit" className="event-day-button primary" aria-busy={pendingIssues > 0}>
            {pendingIssues > 0 ? <ActivityIndicator /> : <Send aria-hidden="true" />}
            Log issue
          </button>
        </form>
        {openIssues.length === 0 ? (
          <p className="event-day-muted">No open issues on this event.</p>
        ) : (
          <ul className="event-day-issue-list">
            {openIssues.map((issue) => (
              <li key={issue.id} data-severity={issue.severity}>
                <div>
                  <span>{issue.severity} · {issueStatusLabel(issue.status)}</span>
                  <h3>{issue.title}</h3>
                  <p>{issue.detail}</p>
                  <small>
                    {formatChangeTime(issue.createdAt, timeZone)}
                    {issue.assignedTo === null
                      ? " · unassigned"
                      : issue.assignedTo === currentUserId ? " · with you" : " · assigned"}
                  </small>
                </div>
                <div className="event-day-issue-actions" aria-label={`${issue.title} actions`}>
                  {currentUserId !== null && issue.assignedTo !== currentUserId && (
                    <button
                      type="button"
                      disabled={issueBusyId !== null}
                      aria-busy={issueBusyId === issue.id}
                      onClick={() => { changeIssue(issue, { assignedTo: currentUserId, status: "in_progress" }, "Issue assigned to you."); }}
                    >
                      Take it
                    </button>
                  )}
                  {issue.status !== "resolved" && (
                    <button
                      type="button"
                      disabled={issueBusyId !== null}
                      aria-busy={issueBusyId === issue.id}
                      onClick={() => { changeIssue(issue, { status: "resolved" }, "Issue resolved."); }}
                    >
                      Resolve
                    </button>
                  )}
                  <button
                    type="button"
                    disabled={issueBusyId !== null}
                    aria-busy={issueBusyId === issue.id}
                    onClick={() => { changeIssue(issue, { status: "closed" }, "Issue closed."); }}
                  >
                    Close
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </Section>

      <Section
        title="What changed"
        subtitle={readyBoard.changesSinceLastHandoff.summary}
        icon={<RefreshCw aria-hidden="true" />}
      >
        <div className="event-day-change-grid">
          <div>
            <h3>Added</h3>
            <p>{readyBoard.changesSinceLastHandoff.added.length}</p>
          </div>
          <div>
            <h3>Removed</h3>
            <p>{readyBoard.changesSinceLastHandoff.removed.length}</p>
          </div>
          <div>
            <h3>Changed</h3>
            <p>{readyBoard.changesSinceLastHandoff.changed.length}</p>
          </div>
        </div>
      </Section>

      <Section
        title="Supplier arrivals"
        subtitle="Only suppliers or arrival windows someone captured."
        icon={<Truck aria-hidden="true" />}
      >
        {readyBoard.supplierArrivals.length === 0 ? (
          <p className="event-day-muted">No supplier arrival has been captured for this event.</p>
        ) : (
          <div className="event-day-arrivals">
            {readyBoard.supplierArrivals.map((arrival) => (
              <article key={arrival.instructionId}>
                <span>{arrival.category}</span>
                <h3>{arrival.title}</h3>
                <p>{arrival.statusLabel}</p>
                <p>{arrival.detail}</p>
              </article>
            ))}
          </div>
        )}
      </Section>

      {handoffNotes.length > 0 && (
        <Section
          title="Handoff notes"
          subtitle="Compiled from the approved layout. Notes to check — not booked arrivals."
          icon={<NotebookPen aria-hidden="true" />}
        >
          <ul className="event-day-handoff-notes">
            {handoffNotes.map((note) => (
              <li key={note.id}>
                <span>Note · {note.category}</span>
                <h3>{note.title}</h3>
                <p>{note.detail}</p>
              </li>
            ))}
          </ul>
        </Section>
      )}

      <Section
        title="Escalation notes"
        icon={<AlertCircle aria-hidden="true" />}
      >
        {readyBoard.escalationNotes.length === 0 ? (
          <p className="event-day-muted">No escalation notes are open.</p>
        ) : (
          <ul className="event-day-escalations">
            {readyBoard.escalationNotes.map((note) => <li key={note}>{note}</li>)}
          </ul>
        )}
      </Section>
      </div>

    </DashboardLayout>
  );
}
