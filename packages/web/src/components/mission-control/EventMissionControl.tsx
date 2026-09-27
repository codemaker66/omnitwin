import {
  memo,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
  type ReactElement,
} from "react";
import {
  Activity,
  AlertTriangle,
  Check,
  CircleDot,
  Clock3,
  MapPinned,
  Play,
  Radio,
  Rewind,
  Users,
} from "lucide-react";
import { ActivityIndicator, ActivityStatus } from "../shared/Activity.js";
import type {
  EventMissionBoard,
  EventMissionEvent,
  EventMissionIncident,
  EventMissionIncidentSeverity,
  EventMissionIncidentStatus,
  EventMissionPhase,
  EventMissionReplay,
  EventMissionTask,
  EventMissionTimeline,
  OpsTaskStatus,
} from "@omnitwin/types";
import { ApiError, api } from "../../api/client.js";
import {
  acknowledgeEventMissionEvent,
  createEventMissionIncident,
  getEventMission,
  getEventMissionReplay,
  getEventMissionTimeline,
  heartbeatEventMissionPresence,
  startEventMission,
  transitionEventMissionPhase,
  transitionEventMissionStatus,
  transitionEventMissionTask,
  updateEventMissionIncident,
} from "../../api/event-mission-control.js";
import "../../styles/hallkeeper-register.css";
import "./EventMissionControl.css";

interface EventMissionControlProps {
  readonly eventId: string;
  readonly handoffPackId: string | null;
  readonly onMissionActiveChange?: (active: boolean) => void;
  /**
   * Whether THIS surface owns task and incident entry (Ship Friday decision
   * 7). The event-day board is the hallkeeper's surface, so when it mounts
   * Mission Control it passes false: the phase rail, timeline and read-only
   * incident list stay, the task grid and incident form do not. Two forms
   * writing to two different tables, side by side, is how a room ends up
   * with two truths about the same evening. Defaults to true so the
   * component still stands alone wherever it is mounted on its own.
   */
  readonly ownsExecutionControls?: boolean;
}

interface IncidentDraft {
  readonly title: string;
  readonly detail: string;
  readonly severity: EventMissionIncidentSeverity;
}

type MissionLoadState = "loading" | "absent" | "ready" | "error";

const EMPTY_INCIDENT: IncidentDraft = { title: "", detail: "", severity: "attention" };
const POLL_INTERVAL_MS = 5_000;
const PRESENCE_INTERVAL_MS = 10_000;
const MAX_TIMELINE_PAGES = 20;

function createUuid(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  const tail = `${Date.now().toString(16)}${Math.floor(Math.random() * 0xffff_ffff).toString(16)}`
    .padEnd(12, "0")
    .slice(0, 12);
  return `00000000-0000-4000-8000-${tail}`;
}

function operationKey(scope: string): string {
  return `${scope}:${createUuid()}`.slice(0, 160);
}

function eventLabel(event: EventMissionEvent): string {
  switch (event.kind) {
    case "mission_started": return "Mission started";
    case "mission_status_changed": return "Mission status changed";
    case "phase_status_changed": return "Phase changed";
    case "task_status_changed": return "Task changed";
    case "incident_created": return "Incident logged";
    case "incident_updated": return "Incident updated";
    case "event_acknowledged": return "Event acknowledged";
  }
}

const RETRY = "Check the connection and try again.";

const SEVERITY_WORD: Readonly<Record<EventMissionIncidentSeverity, string>> = {
  info: "Information", attention: "Attention", urgent: "Urgent",
};

const INCIDENT_STATUS_WORD: Readonly<Record<EventMissionIncidentStatus, string>> = {
  open: "Open", in_progress: "In hand", resolved: "Resolved", closed: "Closed",
};

const INCIDENT_CHANGE_WORD: Readonly<Record<EventMissionIncidentStatus, string>> = {
  open: "reopened", in_progress: "in hand", resolved: "resolved", closed: "closed",
};

/** What an event that waits for acknowledgement says happened, in the
 *  venue's words and from its own record rather than a generic kind. */
export function acknowledgementSummary(event: EventMissionEvent): { readonly title: string; readonly detail: string | null } {
  const { payload } = event;
  switch (payload.kind) {
    case "mission_status_changed":
      return { title: payload.mission.status === "cancelled" ? "Mission cancelled" : "Mission closed", detail: payload.reason };
    case "task_status_changed":
      return { title: `${payload.task.status === "blocked" ? "Task blocked" : "Task changed"}: ${payload.task.title}`, detail: payload.note };
    case "incident_created":
      return { title: `${SEVERITY_WORD[payload.incident.severity]} incident: ${payload.incident.title}`, detail: payload.incident.detail };
    case "incident_updated": {
      const change = payload.fromStatus === payload.incident.status ? "updated" : INCIDENT_CHANGE_WORD[payload.incident.status];
      return { title: `${SEVERITY_WORD[payload.incident.severity]} incident ${change}: ${payload.incident.title}`, detail: payload.incident.detail };
    }
    case "mission_started":
    case "phase_status_changed":
    case "event_acknowledged":
      return { title: eventLabel(event), detail: null };
  }
}

/** A phase's place in the evening, in words: the one now, the one next. */
function phaseWord(phase: EventMissionPhase, nextId: string | null): string {
  switch (phase.status) {
    case "active": return "Now";
    case "completed": return "Done";
    case "skipped": return "Skipped";
    case "pending": return phase.id === nextId ? "Next" : "Later";
  }
}

/** The record moved on another device before this write reached it. */
function isStale(error: unknown): boolean {
  return error instanceof ApiError && (error.status === 409 || error.status === 422);
}

function formatMissionTime(iso: string): string {
  const value = new Date(iso);
  if (Number.isNaN(value.getTime())) return "Time unavailable";
  return value.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

function replaceTask(board: EventMissionBoard, task: EventMissionTask): EventMissionBoard {
  return { ...board, tasks: board.tasks.map((entry) => entry.id === task.id ? task : entry) };
}

function replacePhase(board: EventMissionBoard, phase: EventMissionPhase): EventMissionBoard {
  return { ...board, phases: board.phases.map((entry) => entry.id === phase.id ? phase : entry) };
}

function mergeTimelineEvents(
  current: readonly EventMissionEvent[],
  incoming: readonly EventMissionEvent[],
): EventMissionEvent[] {
  const eventsById = new Map<string, EventMissionEvent>();
  for (const event of current) eventsById.set(event.id, event);
  for (const event of incoming) eventsById.set(event.id, event);
  return [...eventsById.values()].sort((left, right) => left.sequence - right.sequence);
}

async function loadMissionTimelinePages(
  missionId: string,
  signal?: AbortSignal,
  initialAfterSequence = 0,
): Promise<EventMissionTimeline> {
  const events: EventMissionEvent[] = [];
  let afterSequence = initialAfterSequence;
  let latestSequence = 0;
  let hasMore = true;
  let page = 0;
  while (hasMore && page < MAX_TIMELINE_PAGES) {
    const result = await getEventMissionTimeline(missionId, afterSequence, 250, signal);
    events.push(...result.events);
    latestSequence = result.latestSequence;
    hasMore = result.hasMore;
    afterSequence = result.events.at(-1)?.sequence ?? afterSequence;
    if (result.events.length === 0) break;
    page += 1;
  }
  return { missionId, events, latestSequence, hasMore };
}

const MissionSpatialMap = memo(function MissionSpatialMap(props: {
  readonly tasks: readonly EventMissionTask[];
  readonly replay: EventMissionReplay | null;
}): ReactElement {
  const sourceTasks = props.replay?.state.tasks ?? props.tasks;
  const anchors = useMemo(
    () => sourceTasks.flatMap((task) => task.spatialAnchors.map((anchor) => ({ task, anchor }))),
    [sourceTasks],
  );
  const extent = useMemo(() => {
    if (anchors.length === 0) return { minX: 0, minZ: 0, width: 1, height: 1 };
    const xs = anchors.map(({ anchor }) => anchor.xM);
    const zs = anchors.map(({ anchor }) => anchor.zM);
    const minX = Math.min(...xs) - 1;
    const maxX = Math.max(...xs) + 1;
    const minZ = Math.min(...zs) - 1;
    const maxZ = Math.max(...zs) + 1;
    return {
      minX,
      minZ,
      width: Math.max(2, maxX - minX),
      height: Math.max(2, maxZ - minZ),
    };
  }, [anchors]);

  return (
    <section className="mission-map" aria-labelledby="mission-map-title">
      <div className="mission-panel-heading">
        <MapPinned aria-hidden="true" />
        <div>
          <h3 id="mission-map-title">Where the tasks are</h3>
          <p>Planning references in metres, not survey marks.</p>
        </div>
      </div>
      {anchors.length === 0 ? (
        <p className="mission-empty-copy">No spatial references in this handoff.</p>
      ) : (
        <svg
          className="mission-map-canvas"
          viewBox={`${String(extent.minX)} ${String(extent.minZ)} ${String(extent.width)} ${String(extent.height)}`}
          role="img"
          aria-label={`${String(anchors.length)} operational task anchors`}
          preserveAspectRatio="xMidYMid meet"
        >
          <defs>
            <pattern id="mission-grid" width="1" height="1" patternUnits="userSpaceOnUse">
              <path d="M 1 0 L 0 0 0 1" fill="none" stroke="rgba(143,216,210,.15)" strokeWidth=".025" />
            </pattern>
          </defs>
          <rect x={extent.minX} y={extent.minZ} width={extent.width} height={extent.height} fill="url(#mission-grid)" rx=".2" />
          {anchors.map(({ anchor, task }, index) => (
            <g key={`${task.id}:${anchor.label}:${String(index)}`} data-status={task.status}>
              <circle cx={anchor.xM} cy={anchor.zM} r=".22" className="mission-map-pin-halo" />
              <circle cx={anchor.xM} cy={anchor.zM} r=".1" className="mission-map-pin" />
              <title>{`${task.title}: ${anchor.label} (${anchor.xM.toFixed(2)}m, ${anchor.zM.toFixed(2)}m)`}</title>
            </g>
          ))}
        </svg>
      )}
      <ul className="mission-map-legend">
        {anchors.slice(0, 6).map(({ anchor, task }, index) => (
          <li key={`${task.id}:legend:${String(index)}`}>
            <span data-status={task.status} />
            <div><strong>{anchor.label}</strong><small>{task.title}</small></div>
            <code>{anchor.xM.toFixed(2)}, {anchor.zM.toFixed(2)}m</code>
          </li>
        ))}
      </ul>
    </section>
  );
});

const TASK_STATUS_WORD: Readonly<Record<OpsTaskStatus, string>> = {
  todo: "To do", in_progress: "In progress", done: "Done", blocked: "Blocked", waived: "Waived",
};

const MissionTaskGrid = memo(function MissionTaskGrid(props: {
  readonly tasks: readonly EventMissionTask[];
  readonly busy: string | null;
  readonly errors: ReadonlyMap<string, string>;
  readonly onTransition: (task: EventMissionTask, status: OpsTaskStatus) => void;
}): ReactElement {
  const action = (task: EventMissionTask, status: OpsTaskStatus, label: string): ReactElement => {
    const key = `task:${task.id}:${status}`;
    return (
      <button type="button" aria-disabled={props.busy !== null} aria-busy={props.busy === key} onClick={() => { props.onTransition(task, status); }}>
        {props.busy === key && <ActivityIndicator size={18} />} {props.busy === key ? "Saving…" : label}
      </button>
    );
  };
  return (
    <section className="mission-tasks" aria-labelledby="mission-tasks-title">
      <div className="mission-panel-heading">
        <Check aria-hidden="true" />
        <div>
          <h3 id="mission-tasks-title" tabIndex={-1}>Live execution</h3>
        </div>
      </div>
      <div className="mission-task-grid">
        {props.tasks.map((task) => (
          <article key={task.id} className="mission-task-card" data-status={task.status}>
            <header><span>{task.kind.replace(/_/gu, " ")}</span><strong>{TASK_STATUS_WORD[task.status]}</strong></header>
            <h4>{task.title}</h4>
            <p>{task.detail}</p>
            <small>{task.spatialAnchors.length === 1 ? "1 place on the plan" : `${String(task.spatialAnchors.length)} places on the plan`}</small>
            <div className="mission-task-actions">
              {task.status !== "in_progress" && task.status !== "done" && task.status !== "waived" && action(task, "in_progress", "Start")}
              {task.status !== "done" && task.status !== "waived" && action(task, "done", "Done")}
              {task.status !== "blocked" && task.status !== "done" && task.status !== "waived" && action(task, "blocked", "Block")}
            </div>
            {props.errors.has(`task:${task.id}`) && <p className="mission-card-error" role="alert">{props.errors.get(`task:${task.id}`)}</p>}
          </article>
        ))}
      </div>
    </section>
  );
});

export function EventMissionControl(props: EventMissionControlProps): ReactElement {
  const [loadState, setLoadState] = useState<MissionLoadState>("loading");
  const [board, setBoard] = useState<EventMissionBoard | null>(null);
  const [timeline, setTimeline] = useState<EventMissionTimeline | null>(null);
  const [replay, setReplay] = useState<EventMissionReplay | null>(null);
  const [viewingSequence, setViewingSequence] = useState(0);
  // One write at a time, named by its exact action ("phase:<id>:active"), so
  // only the pressed control says it is working.
  const [busy, setBusy] = useState<string | null>(null);
  // A failed write's words, keyed by the card they sit beside. Nothing
  // announces success: the changed card is the confirmation.
  const [errors, setErrors] = useState<ReadonlyMap<string, string>>(() => new Map());
  // Acknowledgements this screen has seen land. They are never withdrawn, so
  // a poll that left before one landed cannot bring its event back.
  const [acknowledgedHere, setAcknowledgedHere] = useState<ReadonlySet<string>>(() => new Set());
  const [endConfirm, setEndConfirm] = useState(false);
  const [skipConfirm, setSkipConfirm] = useState<string | null>(null);
  const [incidentDraft, setIncidentDraft] = useState<IncidentDraft>(EMPTY_INCIDENT);
  // Where focus goes when a write removes the control that was pressed: its
  // section's heading, never another action, so a second key press cannot
  // act on something not yet read.
  const [focusTarget, setFocusTarget] = useState<string | null>(null);
  const [sessionId] = useState(createUuid);
  const latestSequenceRef = useRef(0);
  const timelineRef = useRef<EventMissionTimeline | null>(null);

  useEffect(() => {
    if (focusTarget === null) return;
    setFocusTarget(null);
    // Only when focus has fallen to the page; never take it from elsewhere.
    if (document.activeElement !== null && document.activeElement !== document.body) return;
    (document.getElementById(focusTarget) ?? document.getElementById("mission-heading"))?.focus();
  }, [focusTarget]);

  const showError = useCallback((key: string, message: string | null) => {
    setErrors((current) => {
      if (message === null ? !current.has(key) : current.get(key) === message) return current;
      const next = new Map(current);
      if (message === null) next.delete(key);
      else next.set(key, message);
      return next;
    });
  }, []);

  const applyBoard = useCallback((next: EventMissionBoard) => {
    const previousLatestSequence = latestSequenceRef.current;
    setBoard(next);
    setLoadState("ready");
    setViewingSequence((current) => current === previousLatestSequence ? next.latestSequence : current);
    latestSequenceRef.current = next.latestSequence;
  }, []);

  const loadMission = useCallback(async (signal?: AbortSignal, silent = false): Promise<void> => {
    if (!silent) setLoadState("loading");
    try {
      const next = await getEventMission(props.eventId, signal);
      applyBoard(next);
      const currentTimeline = timelineRef.current?.missionId === next.mission.id
        ? timelineRef.current
        : null;
      const afterSequence = silent ? currentTimeline?.events.at(-1)?.sequence ?? 0 : 0;
      const loadedTimeline = await loadMissionTimelinePages(next.mission.id, signal, afterSequence);
      const nextTimeline = currentTimeline !== null && afterSequence > 0
        ? { ...loadedTimeline, events: mergeTimelineEvents(currentTimeline.events, loadedTimeline.events) }
        : loadedTimeline;
      timelineRef.current = nextTimeline;
      setTimeline(nextTimeline);
    } catch (error) {
      if (signal?.aborted === true) return;
      if (error instanceof ApiError && error.status === 404) {
        setBoard(null);
        setTimeline(null);
        timelineRef.current = null;
        setReplay(null);
        setLoadState("absent");
        return;
      }
      if (!silent) setLoadState("error");
    }
  }, [applyBoard, props.eventId]);

  useEffect(() => {
    const controller = new AbortController();
    void loadMission(controller.signal);
    return () => { controller.abort(); };
  }, [loadMission]);

  useEffect(() => {
    props.onMissionActiveChange?.(board?.mission.status === "live");
  }, [board?.mission.status, props.onMissionActiveChange]);

  useEffect(() => {
    if (board === null) return;
    let inFlight = false;
    const interval = window.setInterval(() => {
      if (inFlight) return;
      inFlight = true;
      void loadMission(undefined, true).finally(() => { inFlight = false; });
    }, POLL_INTERVAL_MS);
    return () => { window.clearInterval(interval); };
  }, [board?.mission.id, loadMission]);

  const heartbeatMissionId = board?.mission.id ?? null;
  const heartbeatPhaseId = board?.phases.find((phase) => phase.status === "active")?.phaseId ?? null;
  const heartbeatView = replay === null ? "board" : "replay";

  useEffect(() => {
    if (heartbeatMissionId === null) return;
    const heartbeat = (): void => {
      void heartbeatEventMissionPresence(heartbeatMissionId, {
        sessionId,
        activePhaseId: heartbeatPhaseId,
        activeTaskId: null,
        view: heartbeatView,
      }).catch(() => undefined);
    };
    heartbeat();
    const interval = window.setInterval(heartbeat, PRESENCE_INTERVAL_MS);
    return () => { window.clearInterval(interval); };
  }, [heartbeatMissionId, heartbeatPhaseId, heartbeatView, sessionId]);

  useEffect(() => {
    if (heartbeatMissionId === null) return;
    return () => {
      void api.delete(`/event-missions/${heartbeatMissionId}/presence/${sessionId}`).catch(() => undefined);
    };
  }, [heartbeatMissionId, sessionId]);

  useEffect(() => {
    if (board === null || viewingSequence >= board.latestSequence) {
      setReplay(null);
      showError("replay", null);
      return;
    }
    const controller = new AbortController();
    const timer = window.setTimeout(() => {
      void getEventMissionReplay(board.mission.id, viewingSequence, controller.signal)
        .then((next) => {
          setReplay(next);
          showError("replay", null);
        })
        .catch(() => {
          if (!controller.signal.aborted) showError("replay", "That point in the history did not load. Move the slider to try again.");
        });
    }, 180);
    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [board, showError, viewingSequence]);

  const startMission = useCallback(() => {
    if (props.handoffPackId === null || busy !== null) return;
    setBusy("start");
    showError("start", null);
    void startEventMission(props.eventId, {
      handoffPackId: props.handoffPackId,
      idempotencyKey: `start:${props.eventId}:${props.handoffPackId}`.slice(0, 160),
    }).then((next) => {
      applyBoard(next);
      setFocusTarget("mission-heading");
    }).catch((error: unknown) => {
      // Another device started it first: show that mission.
      if (error instanceof ApiError && error.status === 409) {
        void loadMission();
        return;
      }
      showError("start", error instanceof ApiError && error.status === 404
        ? "The handoff pack for this event could not be found."
        : `The mission did not start. ${RETRY}`);
    }).finally(() => { setBusy(null); });
  }, [applyBoard, busy, loadMission, props.eventId, props.handoffPackId, showError]);

  const transitionPhase = useCallback((phase: EventMissionPhase, status: EventMissionPhase["status"]) => {
    if (board === null || busy !== null) return;
    setBusy(`phase:${phase.id}:${status}`);
    showError("phases", null);
    void transitionEventMissionPhase(board.mission.id, phase.id, {
      status,
      expectedRevision: phase.revision,
      idempotencyKey: operationKey(`phase:${phase.id}:${status}`),
    }).then((updated) => {
      setBoard((current) => current === null ? current : replacePhase(current, updated));
      setSkipConfirm(null);
      setFocusTarget("mission-phase-title");
    }).catch((error: unknown) => {
      if (isStale(error)) setSkipConfirm(null);
      showError("phases", isStale(error)
        ? `${phase.name} was not changed: another device changed the mission first. The phases now show the latest.`
        : `${phase.name} was not changed. ${RETRY}`);
    }).finally(() => {
      setBusy(null);
      void loadMission(undefined, true);
    });
  }, [board, busy, loadMission, showError]);

  const completeMission = useCallback(() => {
    if (board === null || board.mission.status !== "live" || busy !== null) return;
    setBusy("mission-complete");
    showError("mission-complete", null);
    void transitionEventMissionStatus(board.mission.id, {
      status: "completed",
      idempotencyKey: operationKey(`mission:${board.mission.id}:completed`),
      reason: "Venue operator marked the live mission complete.",
    }).then((mission) => {
      setBoard((current) => current === null ? current : { ...current, mission });
      setEndConfirm(false);
      setFocusTarget("mission-heading");
    }).catch((error: unknown) => {
      // Closed on another device: the refresh below shows how it ended.
      if (isStale(error)) {
        setEndConfirm(false);
        setFocusTarget("mission-heading");
        return;
      }
      showError("mission-complete", `The mission is still live. ${RETRY}`);
    }).finally(() => {
      setBusy(null);
      void loadMission(undefined, true);
    });
  }, [board, busy, loadMission, showError]);

  const transitionTask = useCallback((task: EventMissionTask, status: OpsTaskStatus) => {
    if (board === null || busy !== null) return;
    const card = `task:${task.id}`;
    setBusy(`${card}:${status}`);
    showError(card, null);
    void transitionEventMissionTask(board.mission.id, task.id, {
      status,
      expectedRevision: task.revision,
      idempotencyKey: operationKey(`task:${task.id}:${status}`),
    }).then((updated) => {
      setBoard((current) => current === null ? current : replaceTask(current, updated));
      setFocusTarget("mission-tasks-title");
    }).catch((error: unknown) => {
      showError(card, isStale(error)
        ? "Not changed: another device changed this task first. It now shows the latest."
        : `Not saved. ${RETRY}`);
    }).finally(() => {
      setBusy(null);
      void loadMission(undefined, true);
    });
  }, [board, busy, loadMission, showError]);

  const moveIncident = useCallback((incident: EventMissionIncident, status: EventMissionIncidentStatus) => {
    if (board === null || busy !== null) return;
    const card = `incident:${incident.id}`;
    setBusy(`${card}:${status}`);
    showError(card, null);
    void updateEventMissionIncident(board.mission.id, incident.id, {
      status,
      expectedRevision: incident.revision,
      idempotencyKey: operationKey(`${card}:${status}`),
    }).then((updated) => {
      setBoard((current) => current === null ? current : {
        ...current,
        incidents: current.incidents.map((entry) => entry.id === updated.id ? updated : entry),
      });
      setFocusTarget("mission-incidents-title");
    }).catch((error: unknown) => {
      showError(card, error instanceof ApiError && error.code === "MISSION_CONFLICT"
        ? "The mission has closed, so this incident can no longer change."
        : isStale(error)
          ? "Not changed: another device changed this incident first. It now shows the latest."
          : `Not saved. ${RETRY}`);
    }).finally(() => {
      setBusy(null);
      void loadMission(undefined, true);
    });
  }, [board, busy, loadMission, showError]);

  const acknowledge = useCallback((event: EventMissionEvent) => {
    if (board === null || busy !== null) return;
    const key = `ack:${event.id}`;
    setBusy(key);
    showError(key, null);
    const settle = (): void => {
      setAcknowledgedHere((current) => new Set(current).add(event.id));
      setFocusTarget("mission-waiting-title");
    };
    void acknowledgeEventMissionEvent(board.mission.id, { eventId: event.id, idempotencyKey: operationKey(key) })
      .then(settle)
      .catch((error: unknown) => {
        // A conflict means this person has already acknowledged it, on
        // another device or in another tab. It is done, so it leaves.
        if (error instanceof ApiError && error.status === 409) {
          settle();
          return;
        }
        showError(key, `Not acknowledged. ${RETRY}`);
      })
      .finally(() => {
        setBusy(null);
        void loadMission(undefined, true);
      });
  }, [board, busy, loadMission, showError]);

  const submitIncident = useCallback((event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (board === null || busy !== null) return;
    const activePhaseId = board.phases.find((phase) => phase.status === "active")?.phaseId ?? null;
    setBusy("incident-form");
    showError("incident-form", null);
    void createEventMissionIncident(board.mission.id, {
      ...incidentDraft,
      phaseId: activePhaseId,
      missionTaskId: null,
      spatialAnchor: null,
      idempotencyKey: operationKey(`incident:${board.mission.id}`),
    }).then((incident) => {
      setBoard((current) => current === null ? current : { ...current, incidents: [incident, ...current.incidents] });
      setIncidentDraft(EMPTY_INCIDENT);
    }).catch(() => { showError("incident-form", `The incident was not logged. ${RETRY}`); })
      .finally(() => {
        setBusy(null);
        void loadMission(undefined, true);
      });
  }, [board, busy, incidentDraft, loadMission, showError]);

  const activePhase = board?.phases.find((phase) => phase.status === "active") ?? null;
  const replayEvents = useMemo(() => {
    if (timeline === null) return [];
    return timeline.events.filter((event) => event.sequence <= viewingSequence).slice(-10).reverse();
  }, [timeline, viewingSequence]);
  const acknowledgedIds = useMemo(
    () => new Set([...(board?.acknowledgements.map((ack) => ack.acknowledgedEventId) ?? []), ...acknowledgedHere]),
    [acknowledgedHere, board?.acknowledgements],
  );
  // Everything still waiting, newest first and never capped: an event that
  // has scrolled out of the recent history stays within reach here.
  const pendingAcknowledgements = useMemo(
    () => (timeline?.events ?? []).filter((event) => event.requiresAcknowledgement && !acknowledgedIds.has(event.id)).reverse(),
    [acknowledgedIds, timeline?.events],
  );

  if (loadState === "loading") {
    return <section className="mission-shell mission-state"><ActivityStatus>Loading Mission Control…</ActivityStatus></section>;
  }
  if (loadState === "error") {
    return (
      <section className="mission-shell mission-state" role="alert">
        <AlertTriangle aria-hidden="true" />
        <div><strong>Mission Control unavailable</strong><p>The event board remains available; live mission state could not be loaded.</p></div>
        <button type="button" onClick={() => { void loadMission(); }}>Retry</button>
      </section>
    );
  }
  if (loadState === "absent" || board === null) {
    return (
      <section className="mission-shell mission-launch" aria-labelledby="mission-launch-title">
        <div className="mission-launch-mark"><Radio aria-hidden="true" /></div>
        <div>
          <h2 id="mission-launch-title">Start Mission Control</h2>
          <small>Internal execution only. This does not approve the layout or certify operational fitness.</small>
        </div>
        <button type="button" disabled={props.handoffPackId === null} aria-disabled={busy !== null} aria-busy={busy === "start"} onClick={startMission}>
          {busy === "start" ? <ActivityIndicator size={20} /> : <Play aria-hidden="true" />} {props.handoffPackId === null ? "Handoff required" : busy === "start" ? "Starting…" : "Start live mission"}
        </button>
        {errors.has("start") && <p className="mission-card-error" role="alert">{errors.get("start")}</p>}
      </section>
    );
  }

  const displayedTasks = replay?.state.tasks ?? board.tasks;
  const displayedPhases = replay?.state.phases ?? board.phases;
  const displayedIncidents = replay?.state.incidents ?? board.incidents;
  const isLiveEdge = replay === null && board.mission.status === "live";
  const ownsControls = props.ownsExecutionControls ?? true;
  // Decision 7 hands the ops board the TASK grid and the INCIDENT form, and
  // nothing else. The phase rail stays live here: a mission whose phases can
  // never be advanced but which still offers "Finish mission" can be ended
  // and never progressed, and nothing else in the product transitions a
  // mission phase — `transitionEventMissionPhase` has exactly one caller.
  const canAct = isLiveEdge && ownsControls;
  // Phases run in order, one live at a time. Only the first still to come
  // may go live, and only once nothing else is live: anywhere else the
  // server is bound to refuse. It may also be skipped, so an evening that
  // drops a phase need not invent one.
  const orderedPhases = [...displayedPhases].sort((left, right) => left.sortOrder - right.sortOrder);
  const nextPhase = orderedPhases.find((phase) => phase.status === "pending") ?? null;
  const phaseLive = orderedPhases.some((phase) => phase.status === "active");
  const skipping = isLiveEdge && nextPhase !== null && nextPhase.id === skipConfirm ? nextPhase : null;
  const openIncidents = displayedIncidents.filter((incident) => incident.status === "open" || incident.status === "in_progress");
  const settledIncidents = displayedIncidents.filter((incident) => incident.status === "resolved" || incident.status === "closed");
  const missionHeading = board.mission.status === "live"
    ? activePhase === null ? "Mission live · phase not started" : `Now · ${activePhase.name}`
    : board.mission.status === "completed" ? "Mission complete · replay retained" : "Mission cancelled · replay retained";

  const phaseButton = (phase: EventMissionPhase, status: EventMissionPhase["status"], label: string, working: string): ReactElement => {
    const key = `phase:${phase.id}:${status}`;
    return (
      <button type="button" aria-disabled={busy !== null} aria-busy={busy === key} onClick={() => { transitionPhase(phase, status); }}>
        {busy === key && <ActivityIndicator size={18} />} {busy === key ? working : label}
      </button>
    );
  };

  const incidentRow = (incident: EventMissionIncident): ReactElement => {
    const card = `incident:${incident.id}`;
    const next: EventMissionIncidentStatus | null = !isLiveEdge ? null
      : incident.status === "open" || incident.status === "in_progress" ? "resolved"
        : incident.status === "resolved" ? "open" : null;
    const key = `${card}:${next ?? "none"}`;
    return (
      <li key={incident.id} data-severity={incident.severity} data-status={incident.status}>
        <div>
          <span>{SEVERITY_WORD[incident.severity]}</span>
          <strong id={`mission-incident-${incident.id}`}>{incident.title}</strong>
          <p>{incident.detail}</p>
          {errors.has(card) && <p className="mission-card-error" role="alert">{errors.get(card)}</p>}
        </div>
        <div className="mission-incident-side">
          <small>{INCIDENT_STATUS_WORD[incident.status]}</small>
          {next !== null && (
            <button type="button" aria-disabled={busy !== null} aria-busy={busy === key} aria-describedby={`mission-incident-${incident.id}`} onClick={() => { moveIncident(incident, next); }}>
              {busy === key && <ActivityIndicator size={18} />} {next === "resolved"
                ? busy === key ? "Resolving…" : "Resolve"
                : busy === key ? "Reopening…" : "Reopen"}
            </button>
          )}
        </div>
      </li>
    );
  };

  return (
    <section className="mission-shell" aria-label="Event mission record">
      <header className="mission-command-header">
        <div>
          <p className="mission-eyebrow"><Radio aria-hidden="true" /> Mission record</p>
          <h2 id="mission-heading" tabIndex={-1}>{missionHeading}</h2>
        </div>
        <div className="mission-command-actions">
          <div className="mission-live-state" data-live={isLiveEdge}>
            <span /> {isLiveEdge ? "Live now" : replay !== null ? `Replay · #${String(viewingSequence)}` : board.mission.status === "cancelled" ? "Cancelled" : "Complete"}
          </div>
          {board.mission.status === "live" && replay === null && (
            <button type="button" id="mission-finish" className="mission-complete-trigger" onClick={() => { setEndConfirm(true); }}>Finish mission</button>
          )}
        </div>
      </header>

      {endConfirm && (
        <section className="mission-complete-confirm" role="alert">
          <div><strong>Complete this live mission?</strong><p>Phase, task, incident, and acknowledgement history will become read-only and remain replayable.</p></div>
          <button type="button" onClick={() => { setEndConfirm(false); showError("mission-complete", null); setFocusTarget("mission-finish"); }}>Keep live</button>
          <button type="button" aria-disabled={busy !== null} aria-busy={busy === "mission-complete"} onClick={completeMission}>{busy === "mission-complete" && <ActivityIndicator size={18} />} {busy === "mission-complete" ? "Completing…" : "Complete mission"}</button>
          {errors.has("mission-complete") && <p className="mission-card-error">{errors.get("mission-complete")}</p>}
        </section>
      )}

      {pendingAcknowledgements.length > 0 && (
        <section className="mission-waiting" aria-labelledby="mission-waiting-title">
          <h3 id="mission-waiting-title" tabIndex={-1}>Waiting for acknowledgement</h3>
          <p>Each stays here until someone on the team acknowledges it.</p>
          <ul>
            {pendingAcknowledgements.map((event) => {
              const summary = acknowledgementSummary(event);
              const key = `ack:${event.id}`;
              return (
                <li key={event.id}>
                  <div id={`mission-waiting-${event.id}`}>
                    <strong>{summary.title}</strong>
                    {summary.detail !== null && <p>{summary.detail}</p>}
                    <small>{event.actorLabel} · {formatMissionTime(event.occurredAt)}</small>
                  </div>
                  <button type="button" aria-disabled={busy !== null} aria-busy={busy === key} aria-describedby={`mission-waiting-${event.id}`} onClick={() => { acknowledge(event); }}>
                    {busy === key && <ActivityIndicator size={18} />} {busy === key ? "Acknowledging…" : "Acknowledge"}
                  </button>
                  {errors.has(key) && <p className="mission-card-error" role="alert">{errors.get(key)}</p>}
                </li>
              );
            })}
          </ul>
        </section>
      )}

      <div className="mission-stat-strip">
        {ownsControls && <article><Activity aria-hidden="true" /><strong>{displayedTasks.filter((task) => task.status === "done").length}/{displayedTasks.length}</strong><span>tasks complete</span></article>}
        <article><AlertTriangle aria-hidden="true" /><strong>{openIncidents.length}</strong><span>open incidents</span></article>
        <article><Users aria-hidden="true" /><strong>{board.presence.length}</strong><span>active operators</span></article>
        <article><Clock3 aria-hidden="true" /><strong>#{viewingSequence}</strong><span>timeline cursor</span></article>
      </div>

      <section className="mission-phase-rail" aria-labelledby="mission-phase-title">
        <div className="mission-panel-heading"><CircleDot aria-hidden="true" /><div><h3 id="mission-phase-title" tabIndex={-1}>Phases</h3></div></div>
        <ol>
          {orderedPhases.map((phase) => (
            <li key={phase.id} data-status={phase.status}>
              <div><span>{phaseWord(phase, nextPhase?.id ?? null)}</span><strong>{phase.name}</strong></div>
              {isLiveEdge && phase.status === "active" && phaseButton(phase, "completed", "Complete", "Completing…")}
              {isLiveEdge && phase.id === nextPhase?.id && (
                <div className="mission-phase-actions">
                  {!phaseLive && phaseButton(phase, "active", "Go live", "Going live…")}
                  <button type="button" id={`mission-skip-${phase.id}`} className="mission-phase-skip" aria-disabled={busy !== null} aria-expanded={skipping?.id === phase.id} onClick={() => { if (busy === null) setSkipConfirm(phase.id); }}>Skip</button>
                </div>
              )}
            </li>
          ))}
        </ol>
        {skipping !== null && (
          <div className="mission-phase-confirm">
            <p><strong>Skip {skipping.name}?</strong> A skipped phase cannot be started afterwards.</p>
            <button type="button" onClick={() => { setSkipConfirm(null); setFocusTarget(`mission-skip-${skipping.id}`); }}>Keep</button>
            {phaseButton(skipping, "skipped", `Skip ${skipping.name}`, "Skipping…")}
          </div>
        )}
        {errors.has("phases") && <p className="mission-card-error" role="alert">{errors.get("phases")}</p>}
      </section>

      <div className="mission-grid">
        <MissionSpatialMap tasks={board.tasks} replay={replay} />
        <section className="mission-presence" aria-labelledby="mission-presence-title">
          <div className="mission-panel-heading"><Users aria-hidden="true" /><div><h3 id="mission-presence-title">Team presence</h3><p>Online status does not confirm venue attendance.</p></div></div>
          {board.presence.length === 0 ? <p className="mission-empty-copy">No recent operator activity.</p> : (
            <ul>{board.presence.map((person) => <li key={person.sessionId}><span>{person.displayName.slice(0, 1).toUpperCase()}</span><div><strong>{person.displayName}</strong><small>{person.role} · {person.view}</small></div><time>{formatMissionTime(person.lastSeenAt)}</time></li>)}</ul>
          )}
        </section>
      </div>

      {canAct && <MissionTaskGrid tasks={board.tasks} busy={busy} errors={errors} onTransition={transitionTask} />}

      <div className="mission-grid">
        <section className="mission-incidents" aria-labelledby="mission-incidents-title">
          <div className="mission-panel-heading"><AlertTriangle aria-hidden="true" /><div><h3 id="mission-incidents-title" tabIndex={-1}>Incident channel</h3></div></div>
          {!ownsControls && (
            <p className="mission-empty-copy">New issues are logged on the event-day board.</p>
          )}
          {canAct && (
            <form onSubmit={submitIncident}>
              <input aria-label="Incident title" placeholder="Incident title" maxLength={180} required value={incidentDraft.title} onChange={(event) => { setIncidentDraft((current) => ({ ...current, title: event.target.value })); }} />
              <textarea aria-label="Incident detail" placeholder="What happened, where, and what is needed?" required rows={3} value={incidentDraft.detail} onChange={(event) => { setIncidentDraft((current) => ({ ...current, detail: event.target.value })); }} />
              <select aria-label="Incident severity" value={incidentDraft.severity} onChange={(event) => { setIncidentDraft((current) => ({ ...current, severity: event.target.value as EventMissionIncidentSeverity })); }}>
                <option value="info">Information</option><option value="attention">Attention</option><option value="urgent">Urgent</option>
              </select>
              <button type="submit" aria-disabled={busy !== null} aria-busy={busy === "incident-form"}>{busy === "incident-form" && <ActivityIndicator size={18} />} {busy === "incident-form" ? "Logging…" : "Log incident"}</button>
              {errors.has("incident-form") && <p className="mission-card-error" role="alert">{errors.get("incident-form")}</p>}
            </form>
          )}
          {openIncidents.length === 0
            ? <p className="mission-sealed"><Check aria-hidden="true" /> No open incidents.</p>
            : <ul className="mission-incident-list">{openIncidents.map(incidentRow)}</ul>}
          {settledIncidents.length > 0 && (
            <ul className="mission-incident-list is-settled" aria-label="Resolved and closed incidents">{settledIncidents.map(incidentRow)}</ul>
          )}
        </section>

        <section className="mission-timeline" aria-labelledby="mission-timeline-title">
          <div className="mission-panel-heading"><Rewind aria-hidden="true" /><div><h3 id="mission-timeline-title">History</h3><p>Replay what happened. The live event continues.</p></div></div>
          <label>Replay through sequence {viewingSequence}
            <input type="range" min="0" max={board.latestSequence} value={viewingSequence} onChange={(event) => { setViewingSequence(Number(event.target.value)); }} />
          </label>
          {!isLiveEdge && <button type="button" className="mission-return-live" onClick={() => { setViewingSequence(board.latestSequence); }}>Return to live</button>}
          {errors.has("replay") && <p className="mission-card-error" role="alert">{errors.get("replay")}</p>}
          <ol>{replayEvents.map((event) => <li key={event.id} data-kind={event.kind}><span>#{event.sequence}</span><div><strong>{eventLabel(event)}</strong><small>{event.actorLabel} · {formatMissionTime(event.occurredAt)}</small></div></li>)}</ol>
        </section>
      </div>
    </section>
  );
}
