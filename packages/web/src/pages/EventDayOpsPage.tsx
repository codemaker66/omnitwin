import { useCallback, useEffect, useMemo, useState, type FormEvent, type ReactElement } from "react";
import { useParams } from "react-router-dom";
import { AlertCircle, Check, CircleDashed, Clock, RefreshCw, Send, ShieldAlert, Truck } from "lucide-react";
import type { EventDayIssueSeverity, EventDayOpsBoard, OpsTask, OpsTaskStatus } from "@omnitwin/types";
import { ApiError } from "../api/client.js";
import { createEventDayIssue, getEventDayOpsBoard, updateOpsTaskStatus } from "../api/event-day-ops.js";
import {
  ackEventDayOp,
  enqueueEventDayIssueCreate,
  enqueueEventDayTaskStatus,
  listPendingEventDayOps,
} from "../lib/event-day-offline-queue.js";
import "./EventDayOpsPage.css";

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

function formatEventDate(iso: string | null): string {
  if (iso === null) return "Date not set";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "Date not set";
  return date.toLocaleDateString("en-GB", {
    weekday: "short",
    day: "2-digit",
    month: "short",
  });
}

function formatTime(iso: string | null): string {
  if (iso === null) return "--:--";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "--:--";
  return date.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });
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
  const [issueDraft, setIssueDraft] = useState<IssueDraft>(EMPTY_ISSUE_DRAFT);
  const [notice, setNotice] = useState<string | null>(null);

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
    getEventDayOpsBoard(eventId)
      .then((board) => { setState({ kind: "ready", board }); })
      .catch(() => {
        setState({
          kind: "error",
          message: "This event-day board could not be loaded. Check the event link or try again.",
        });
      });
  }, [eventId]);

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
        const board = await getEventDayOpsBoard(eventId);
        setState({ kind: "ready", board });
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
  const tasks = board?.handoffPack?.opsTasks ?? [];
  const setupTasks = useMemo(() => tasks.filter((task) => task.kind === "setup"), [tasks]);
  const roomFlipTasks = useMemo(() => tasks.filter((task) => task.kind === "room_flip"), [tasks]);
  const taskList = useMemo(() => [...setupTasks, ...roomFlipTasks], [setupTasks, roomFlipTasks]);
  const openIssues = useMemo(() => board?.issues.filter((issue) => issue.status !== "closed") ?? [], [board]);
  const syncLabel = pendingCount === 0 ? "Synced" : `${String(pendingCount)} pending sync`;

  const setTaskStatus = useCallback((task: OpsTask, status: OpsTaskStatus) => {
    if (status === task.status) return;
    const optimistic = { ...task, status, updatedAt: new Date().toISOString() };
    setState((prev) => prev.kind === "ready" ? { kind: "ready", board: updateTaskInBoard(prev.board, optimistic) } : prev);
    const input = { status, idempotencyKey: makeIdempotencyKey(task.id, status) };
    void updateOpsTaskStatus(task.id, input)
      .then((updated) => {
        setState((prev) => prev.kind === "ready" ? { kind: "ready", board: updateTaskInBoard(prev.board, updated) } : prev);
        setNotice("Task status updated.");
      })
      .catch((err: unknown) => {
        if (isRetriableError(err)) {
          void enqueueEventDayTaskStatus(task.id, input)
            .then(() => {
              refreshPendingCount();
              setNotice("Task saved on this device and will sync when the connection returns.");
            });
          return;
        }
        setState((prev) => prev.kind === "ready" ? { kind: "ready", board: updateTaskInBoard(prev.board, task) } : prev);
        setNotice("Task update was rejected by the server.");
      });
  }, [refreshPendingCount]);

  const submitIssue = useCallback((event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (eventId === undefined) return;
    const input = {
      title: issueDraft.title,
      detail: issueDraft.detail,
      severity: issueDraft.severity,
    };
    void createEventDayIssue(eventId, input)
      .then((issue) => {
        setIssueDraft(EMPTY_ISSUE_DRAFT);
        setNotice("Issue logged.");
        setState((prev) => prev.kind === "ready"
          ? { kind: "ready", board: { ...prev.board, issues: [issue, ...prev.board.issues] } }
          : prev);
      })
      .catch((err: unknown) => {
        if (isRetriableError(err)) {
          void enqueueEventDayIssueCreate(eventId, input)
            .then(() => {
              setIssueDraft(EMPTY_ISSUE_DRAFT);
              refreshPendingCount();
              setNotice("Issue saved on this device and will sync when the connection returns.");
            });
        } else {
          setNotice("Issue could not be logged. Check the wording and try again.");
        }
      });
  }, [eventId, issueDraft, refreshPendingCount]);

  if (state.kind === "loading") {
    return (
      <main className="event-day-page event-day-centered">
        <RefreshCw aria-hidden="true" className="event-day-spin" />
        <h1>Loading event-day board</h1>
        <p>Preparing the latest internal operations view.</p>
      </main>
    );
  }

  if (state.kind === "error") {
    return (
      <main className="event-day-page event-day-centered">
        <AlertCircle aria-hidden="true" />
        <h1>Event-day board unavailable</h1>
        <p>{state.message}</p>
        <button type="button" className="event-day-button secondary" onClick={loadBoard}>
          <RefreshCw aria-hidden="true" />
          Retry
        </button>
      </main>
    );
  }

  const readyBoard = state.board;

  return (
    <main className="event-day-page">
      <header className="event-day-hero">
        <div>
          <p className="event-day-kicker">Today&apos;s event</p>
          <h1>{readyBoard.event.name}</h1>
          <p>{formatEventDate(readyBoard.event.startsAt)} · {formatTime(readyBoard.event.startsAt)} · {readyBoard.event.guestCount} guests</p>
        </div>
        <div className="event-day-sync">
          <span data-pending={pendingCount > 0}>{syncLabel}</span>
          <button type="button" className="event-day-icon-button" onClick={flushQueue} aria-label="Sync pending event-day changes">
            <RefreshCw aria-hidden="true" className={syncing ? "event-day-spin" : undefined} />
          </button>
        </div>
      </header>

      {notice !== null && <p className="event-day-notice">{notice}</p>}

      {readyBoard.sourceStatus === "missing_handoff" && (
        <section className="event-day-empty">
          <h2>No handoff pack linked</h2>
          <p>Compile an internal ops handoff from an approved snapshot before using the live board.</p>
        </section>
      )}

      <Section
        title="Phase timeline"
        subtitle="Planning phases from the event record."
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
        subtitle={`${String(readyBoard.setupProgress.doneTasks)} of ${String(readyBoard.setupProgress.totalTasks)} task(s) done.`}
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
        subtitle="Live status for setup and room flip work."
        icon={<CircleDashed aria-hidden="true" />}
      >
        {taskList.length === 0 ? (
          <p className="event-day-muted">No setup or room flip tasks are available from the latest handoff pack.</p>
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
          <button type="submit" className="event-day-button primary">
            <Send aria-hidden="true" />
            Log issue
          </button>
        </form>
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
        subtitle="Existing supplier instructions only."
        icon={<Truck aria-hidden="true" />}
      >
        {readyBoard.supplierArrivals.length === 0 ? (
          <p className="event-day-muted">No supplier arrival notes are available in this handoff pack.</p>
        ) : (
          <div className="event-day-arrivals">
            {readyBoard.supplierArrivals.map((arrival) => (
              <article key={arrival.instructionId}>
                <span>{arrival.category}</span>
                <h3>{arrival.title}</h3>
                <p>{arrival.statusLabel}</p>
              </article>
            ))}
          </div>
        )}
      </Section>

      <Section
        title="Escalation notes"
        subtitle="Open urgent notes and escalation updates."
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
    </main>
  );
}
