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
  RefreshCw,
  Rewind,
  Users,
} from "lucide-react";
import type {
  EventMissionBoard,
  EventMissionEvent,
  EventMissionIncidentSeverity,
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
} from "../../api/event-mission-control.js";
import "./EventMissionControl.css";

interface EventMissionControlProps {
  readonly eventId: string;
  readonly handoffPackId: string | null;
  readonly onMissionActiveChange?: (active: boolean) => void;
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
          <h3 id="mission-map-title">Spatial command map</h3>
          <p>Frozen-snapshot anchors in real metres. Pins are operational references, not survey marks.</p>
        </div>
      </div>
      {anchors.length === 0 ? (
        <p className="mission-empty-copy">No frozen spatial anchors were carried into this handoff.</p>
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

const MissionTaskGrid = memo(function MissionTaskGrid(props: {
  readonly tasks: readonly EventMissionTask[];
  readonly busyId: string | null;
  readonly onTransition: (task: EventMissionTask, status: OpsTaskStatus) => void;
}): ReactElement {
  return (
    <section className="mission-tasks" aria-labelledby="mission-tasks-title">
      <div className="mission-panel-heading">
        <Check aria-hidden="true" />
        <div>
          <h3 id="mission-tasks-title">Live execution</h3>
          <p>Every accepted transition is revision-checked and appended to the mission history.</p>
        </div>
      </div>
      <div className="mission-task-grid">
        {props.tasks.map((task) => (
          <article key={task.id} className="mission-task-card" data-status={task.status}>
            <header><span>{task.kind.replace(/_/gu, " ")}</span><strong>{task.status.replace(/_/gu, " ")}</strong></header>
            <h4>{task.title}</h4>
            <p>{task.detail}</p>
            <small>Revision {task.revision} · {task.spatialAnchors.length} spatial ref(s)</small>
            <div className="mission-task-actions">
              {task.status !== "in_progress" && task.status !== "done" && task.status !== "waived" && (
                <button type="button" disabled={props.busyId === task.id} onClick={() => { props.onTransition(task, "in_progress"); }}>
                  Start
                </button>
              )}
              {task.status !== "done" && task.status !== "waived" && (
                <button type="button" disabled={props.busyId === task.id} onClick={() => { props.onTransition(task, "done"); }}>
                  Done
                </button>
              )}
              {task.status !== "blocked" && task.status !== "done" && task.status !== "waived" && (
                <button type="button" disabled={props.busyId === task.id} onClick={() => { props.onTransition(task, "blocked"); }}>
                  Block
                </button>
              )}
            </div>
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
  const [notice, setNotice] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [endConfirm, setEndConfirm] = useState(false);
  const [incidentDraft, setIncidentDraft] = useState<IncidentDraft>(EMPTY_INCIDENT);
  const [sessionId] = useState(createUuid);
  const latestSequenceRef = useRef(0);
  const timelineRef = useRef<EventMissionTimeline | null>(null);

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
      return;
    }
    const controller = new AbortController();
    const timer = window.setTimeout(() => {
      void getEventMissionReplay(board.mission.id, viewingSequence, controller.signal)
        .then(setReplay)
        .catch(() => { if (!controller.signal.aborted) setNotice("Historical replay could not be loaded."); });
    }, 180);
    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [board, viewingSequence]);

  const startMission = useCallback(() => {
    if (props.handoffPackId === null || busyId !== null) return;
    setBusyId("start");
    void startEventMission(props.eventId, {
      handoffPackId: props.handoffPackId,
      idempotencyKey: `start:${props.eventId}:${props.handoffPackId}`.slice(0, 160),
    }).then((next) => {
      applyBoard(next);
      setNotice("Live mission started from the frozen handoff baseline.");
    }).catch((error: unknown) => {
      setNotice(error instanceof ApiError ? error.message : "Mission could not be started.");
    }).finally(() => { setBusyId(null); });
  }, [applyBoard, busyId, props.eventId, props.handoffPackId]);

  const transitionPhase = useCallback((phase: EventMissionPhase, status: EventMissionPhase["status"]) => {
    if (board === null || busyId !== null) return;
    setBusyId(phase.id);
    void transitionEventMissionPhase(board.mission.id, phase.id, {
      status,
      expectedRevision: phase.revision,
      idempotencyKey: operationKey(`phase:${phase.id}:${status}`),
    }).then((updated) => {
      setBoard((current) => current === null ? current : replacePhase(current, updated));
      setNotice(`${updated.name} is now ${updated.status.replace(/_/gu, " ")}.`);
      void loadMission(undefined, true);
    }).catch((error: unknown) => {
      setNotice(error instanceof ApiError && error.status === 409
        ? "That phase changed on another device. The live state has been refreshed."
        : "The phase transition was not accepted.");
      void loadMission(undefined, true);
    }).finally(() => { setBusyId(null); });
  }, [board, busyId, loadMission]);

  const completeMission = useCallback(() => {
    if (board === null || board.mission.status !== "live" || busyId !== null) return;
    setBusyId("mission-complete");
    void transitionEventMissionStatus(board.mission.id, {
      status: "completed",
      idempotencyKey: operationKey(`mission:${board.mission.id}:completed`),
      reason: "Venue operator marked the live mission complete.",
    }).then((mission) => {
      setBoard((current) => current === null ? current : { ...current, mission });
      setEndConfirm(false);
      setNotice("Mission completed. The timeline remains available for replay.");
      void loadMission(undefined, true);
    }).catch(() => { setNotice("The mission could not be completed from the current state."); })
      .finally(() => { setBusyId(null); });
  }, [board, busyId, loadMission]);

  const transitionTask = useCallback((task: EventMissionTask, status: OpsTaskStatus) => {
    if (board === null || busyId !== null) return;
    setBusyId(task.id);
    void transitionEventMissionTask(board.mission.id, task.id, {
      status,
      expectedRevision: task.revision,
      idempotencyKey: operationKey(`task:${task.id}:${status}`),
    }).then((updated) => {
      setBoard((current) => current === null ? current : replaceTask(current, updated));
      setNotice(`${updated.title} is now ${updated.status.replace(/_/gu, " ")}.`);
      void loadMission(undefined, true);
    }).catch((error: unknown) => {
      setNotice(error instanceof ApiError && error.status === 409
        ? "That task changed on another device. The live state has been refreshed."
        : "The task transition was not accepted.");
      void loadMission(undefined, true);
    }).finally(() => { setBusyId(null); });
  }, [board, busyId, loadMission]);

  const submitIncident = useCallback((event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (board === null || busyId !== null) return;
    const activePhaseId = board.phases.find((phase) => phase.status === "active")?.phaseId ?? null;
    setBusyId("incident");
    void createEventMissionIncident(board.mission.id, {
      ...incidentDraft,
      phaseId: activePhaseId,
      missionTaskId: null,
      spatialAnchor: null,
      idempotencyKey: operationKey(`incident:${board.mission.id}`),
    }).then((incident) => {
      setBoard((current) => current === null ? current : { ...current, incidents: [incident, ...current.incidents] });
      setIncidentDraft(EMPTY_INCIDENT);
      setNotice("Incident appended to the mission timeline.");
      void loadMission(undefined, true);
    }).catch(() => { setNotice("The incident could not be appended."); })
      .finally(() => { setBusyId(null); });
  }, [board, busyId, incidentDraft, loadMission]);

  const activePhase = board?.phases.find((phase) => phase.status === "active") ?? null;
  const replayEvents = useMemo(() => {
    if (timeline === null) return [];
    return timeline.events.filter((event) => event.sequence <= viewingSequence).slice(-10).reverse();
  }, [timeline, viewingSequence]);
  const acknowledgedIds = useMemo(
    () => new Set(board?.acknowledgements.map((ack) => ack.acknowledgedEventId) ?? []),
    [board?.acknowledgements],
  );
  const pendingAcknowledgements = useMemo(
    () => (timeline?.events ?? []).filter((event) => event.requiresAcknowledgement && !acknowledgedIds.has(event.id)),
    [acknowledgedIds, timeline?.events],
  );

  if (loadState === "loading") {
    return <section className="mission-shell mission-state" aria-live="polite"><RefreshCw className="mission-spin" aria-hidden="true" /> Loading Mission Control…</section>;
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
          <p className="mission-eyebrow">4D live event command</p>
          <h2 id="mission-launch-title">Start Mission Control</h2>
          <p>Freeze the latest handoff into revisioned phase, task, incident, presence, spatial, and replay state.</p>
          <small>This starts internal execution only. It does not approve a layout or certify operational fitness.</small>
        </div>
        <button type="button" disabled={props.handoffPackId === null || busyId !== null} onClick={startMission}>
          <Play aria-hidden="true" /> {props.handoffPackId === null ? "Handoff required" : "Start live mission"}
        </button>
      </section>
    );
  }

  const displayedTasks = replay?.state.tasks ?? board.tasks;
  const displayedPhases = replay?.state.phases ?? board.phases;
  const displayedIncidents = replay?.state.incidents ?? board.incidents;
  const isLiveEdge = replay === null && board.mission.status === "live";
  const missionHeading = board.mission.status === "live"
    ? activePhase === null ? "Mission live · phase not started" : `Now · ${activePhase.name}`
    : board.mission.status === "completed" ? "Mission complete · replay retained" : "Mission cancelled · replay retained";

  return (
    <section className="mission-shell" aria-label="4D Event Mission Control">
      <header className="mission-command-header">
        <div>
          <p className="mission-eyebrow"><Radio aria-hidden="true" /> 4D Mission Control</p>
          <h2>{missionHeading}</h2>
          <p>Sequence {board.latestSequence} · baseline {board.mission.baselineHash.slice(0, 12)} · {board.mission.status}</p>
        </div>
        <div className="mission-command-actions">
          <div className="mission-live-state" data-live={isLiveEdge}>
            <span /> {isLiveEdge ? "Live edge" : replay === null ? board.mission.status : `Replay · #${String(viewingSequence)}`}
          </div>
          {board.mission.status === "live" && replay === null && (
            <button type="button" className="mission-complete-trigger" onClick={() => { setEndConfirm(true); }}>Finish mission</button>
          )}
        </div>
      </header>

      {notice !== null && <p className="mission-notice" role="status">{notice}</p>}
      {endConfirm && (
        <section className="mission-complete-confirm" role="alert">
          <div><strong>Complete this live mission?</strong><p>Phase, task, incident, and acknowledgement history will become read-only and remain replayable.</p></div>
          <button type="button" onClick={() => { setEndConfirm(false); }}>Keep live</button>
          <button type="button" disabled={busyId !== null} onClick={completeMission}>Complete mission</button>
        </section>
      )}

      <div className="mission-stat-strip">
        <article><Activity aria-hidden="true" /><strong>{displayedTasks.filter((task) => task.status === "done").length}/{displayedTasks.length}</strong><span>tasks complete</span></article>
        <article><AlertTriangle aria-hidden="true" /><strong>{displayedIncidents.filter((incident) => incident.status !== "closed" && incident.status !== "resolved").length}</strong><span>open incidents</span></article>
        <article><Users aria-hidden="true" /><strong>{board.presence.length}</strong><span>people present</span></article>
        <article><Clock3 aria-hidden="true" /><strong>#{viewingSequence}</strong><span>timeline cursor</span></article>
      </div>

      <section className="mission-phase-rail" aria-labelledby="mission-phase-title">
        <div className="mission-panel-heading"><CircleDot aria-hidden="true" /><div><h3 id="mission-phase-title">Phase authority</h3><p>Actual transitions sit beside the planned phase order.</p></div></div>
        <ol>
          {displayedPhases.map((phase) => (
            <li key={phase.id} data-status={phase.status}>
              <div><span>{phase.status}</span><strong>{phase.name}</strong><small>Revision {phase.revision}</small></div>
              {isLiveEdge && phase.status === "pending" && <button type="button" disabled={busyId !== null} onClick={() => { transitionPhase(phase, "active"); }}>Go live</button>}
              {isLiveEdge && phase.status === "active" && <button type="button" disabled={busyId !== null} onClick={() => { transitionPhase(phase, "completed"); }}>Complete</button>}
            </li>
          ))}
        </ol>
      </section>

      <div className="mission-grid">
        <MissionSpatialMap tasks={board.tasks} replay={replay} />
        <section className="mission-presence" aria-labelledby="mission-presence-title">
          <div className="mission-panel-heading"><Users aria-hidden="true" /><div><h3 id="mission-presence-title">Team presence</h3><p>Advisory heartbeats; absence is not proof someone has left the venue.</p></div></div>
          {board.presence.length === 0 ? <p className="mission-empty-copy">No other active operator heartbeat.</p> : (
            <ul>{board.presence.map((person) => <li key={person.sessionId}><span>{person.displayName.slice(0, 1).toUpperCase()}</span><div><strong>{person.displayName}</strong><small>{person.role} · {person.view}</small></div><time>{formatMissionTime(person.lastSeenAt)}</time></li>)}</ul>
          )}
        </section>
      </div>

      {isLiveEdge && <MissionTaskGrid tasks={board.tasks} busyId={busyId} onTransition={transitionTask} />}

      <div className="mission-grid">
        <section className="mission-incidents" aria-labelledby="mission-incidents-title">
          <div className="mission-panel-heading"><AlertTriangle aria-hidden="true" /><div><h3 id="mission-incidents-title">Incident channel</h3><p>Log against the current phase; each submission is idempotent and replayable.</p></div></div>
          {isLiveEdge && (
            <form onSubmit={submitIncident}>
              <input aria-label="Incident title" placeholder="Incident title" maxLength={180} required value={incidentDraft.title} onChange={(event) => { setIncidentDraft((current) => ({ ...current, title: event.target.value })); }} />
              <textarea aria-label="Incident detail" placeholder="What happened, where, and what is needed?" required rows={3} value={incidentDraft.detail} onChange={(event) => { setIncidentDraft((current) => ({ ...current, detail: event.target.value })); }} />
              <select aria-label="Incident severity" value={incidentDraft.severity} onChange={(event) => { setIncidentDraft((current) => ({ ...current, severity: event.target.value as EventMissionIncidentSeverity })); }}>
                <option value="info">Information</option><option value="attention">Attention</option><option value="urgent">Urgent</option>
              </select>
              <button type="submit" disabled={busyId !== null}>Append incident</button>
            </form>
          )}
          <ul className="mission-incident-list">{displayedIncidents.slice(0, 6).map((incident) => <li key={incident.id} data-severity={incident.severity}><span>{incident.severity}</span><div><strong>{incident.title}</strong><p>{incident.detail}</p></div><small>{incident.status}</small></li>)}</ul>
        </section>

        <section className="mission-timeline" aria-labelledby="mission-timeline-title">
          <div className="mission-panel-heading"><Rewind aria-hidden="true" /><div><h3 id="mission-timeline-title">Time machine</h3><p>Scrub the persisted event stream; live state keeps advancing independently.</p></div></div>
          <label>Replay through sequence {viewingSequence}
            <input type="range" min="0" max={board.latestSequence} value={viewingSequence} onChange={(event) => { setViewingSequence(Number(event.target.value)); }} />
          </label>
          {!isLiveEdge && <button type="button" className="mission-return-live" onClick={() => { setViewingSequence(board.latestSequence); }}>Return to live edge</button>}
          <ol>{replayEvents.map((event) => <li key={event.id} data-kind={event.kind}><span>#{event.sequence}</span><div><strong>{eventLabel(event)}</strong><small>{event.actorLabel} · {formatMissionTime(event.occurredAt)}</small></div>{event.requiresAcknowledgement && !acknowledgedIds.has(event.id) && isLiveEdge ? <button type="button" onClick={() => { void acknowledgeEventMissionEvent(board.mission.id, { eventId: event.id, idempotencyKey: operationKey(`ack:${event.id}`) }).then(() => loadMission(undefined, true)); }}>Acknowledge</button> : null}</li>)}</ol>
          {pendingAcknowledgements.length > 0 && <p className="mission-ack-warning">{pendingAcknowledgements.length} event(s) require acknowledgement.</p>}
        </section>
      </div>
    </section>
  );
}
