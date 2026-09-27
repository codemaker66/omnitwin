import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type {
  EventMissionAcknowledgement,
  EventMissionBoard,
  EventMissionEvent,
  EventMissionIncident,
  EventMissionPhase,
  EventMissionPresence,
  EventMissionTask,
  EventMissionTimeline,
} from "@omnitwin/types";
import { ApiError } from "../../../api/client.js";
import { EventMissionControl, acknowledgementSummary } from "../EventMissionControl.js";

const mocks = vi.hoisted(() => ({
  acknowledge: vi.fn(),
  createIncident: vi.fn(),
  getMission: vi.fn(),
  getReplay: vi.fn(),
  getTimeline: vi.fn(),
  heartbeat: vi.fn(),
  startMission: vi.fn(),
  transitionPhase: vi.fn(),
  transitionStatus: vi.fn(),
  transitionTask: vi.fn(),
  updateIncident: vi.fn(),
  deletePresence: vi.fn(),
}));

vi.mock("../../../api/event-mission-control.js", () => ({
  acknowledgeEventMissionEvent: mocks.acknowledge,
  createEventMissionIncident: mocks.createIncident,
  getEventMission: mocks.getMission,
  getEventMissionReplay: mocks.getReplay,
  getEventMissionTimeline: mocks.getTimeline,
  heartbeatEventMissionPresence: mocks.heartbeat,
  startEventMission: mocks.startMission,
  transitionEventMissionPhase: mocks.transitionPhase,
  transitionEventMissionStatus: mocks.transitionStatus,
  transitionEventMissionTask: mocks.transitionTask,
  updateEventMissionIncident: mocks.updateIncident,
}));

vi.mock("../../../api/client.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../../api/client.js")>();
  return { ...actual, api: { ...actual.api, delete: mocks.deletePresence } };
});

const EVENT_ID = "00000000-0000-4000-8000-000000000101";
const VENUE_ID = "00000000-0000-4000-8000-000000000102";
const PACK_ID = "00000000-0000-4000-8000-000000000103";
const MISSION_ID = "00000000-0000-4000-8000-000000000104";
const PHASE_ID = "00000000-0000-4000-8000-000000000105";
const MISSION_PHASE_ID = "00000000-0000-4000-8000-000000000106";
const TASK_ID = "00000000-0000-4000-8000-000000000107";
const OPS_TASK_ID = "00000000-0000-4000-8000-000000000108";
const CONFIG_ID = "00000000-0000-4000-8000-000000000109";
const SNAPSHOT_ID = "00000000-0000-4000-8000-000000000110";
const USER_ID = "00000000-0000-4000-8000-000000000111";
const NOW = "2026-07-10T09:00:00.000Z";

const phase: EventMissionPhase = {
  id: MISSION_PHASE_ID,
  missionId: MISSION_ID,
  eventId: EVENT_ID,
  phaseId: PHASE_ID,
  name: "Guest arrival",
  sortOrder: 0,
  status: "pending",
  revision: 1,
  actualStartedAt: null,
  actualEndedAt: null,
  updatedBy: null,
  createdAt: NOW,
  updatedAt: NOW,
};

const task: EventMissionTask = {
  id: TASK_ID,
  missionId: MISSION_ID,
  eventId: EVENT_ID,
  handoffPackId: PACK_ID,
  opsTaskId: OPS_TASK_ID,
  phaseId: PHASE_ID,
  kind: "setup",
  title: "Place reception desk",
  detail: "Use the frozen-snapshot reception anchor.",
  status: "todo",
  revision: 1,
  assignedTo: null,
  assigneeLabel: null,
  spatialAnchors: [{
    coordinateSpace: "real_m_v1",
    configurationId: CONFIG_ID,
    snapshotId: SNAPSHOT_ID,
    objectId: null,
    xM: 3.2,
    zM: 4.1,
    floorLabel: "Ground floor",
    label: "Reception point",
    source: "frozen_snapshot",
  }],
  actualStartedAt: null,
  actualEndedAt: null,
  updatedBy: null,
  createdAt: NOW,
  updatedAt: NOW,
};

const board: EventMissionBoard = {
  mission: {
    id: MISSION_ID,
    eventId: EVENT_ID,
    venueId: VENUE_ID,
    handoffPackId: PACK_ID,
    sourceSnapshotHash: "a".repeat(64),
    status: "live",
    baselineHash: "b".repeat(64),
    lastSequence: 1,
    createdBy: USER_ID,
    startedAt: NOW,
    completedAt: null,
    cancelledAt: null,
    createdAt: NOW,
    updatedAt: NOW,
  },
  phases: [phase],
  tasks: [task],
  incidents: [],
  acknowledgements: [],
  presence: [],
  latestSequence: 1,
};

const timeline: EventMissionTimeline = {
  missionId: MISSION_ID,
  events: [],
  latestSequence: 1,
  hasMore: false,
};

const missionStartedEvent: EventMissionEvent = {
  id: "00000000-0000-4000-8000-000000000113",
  missionId: MISSION_ID,
  eventId: EVENT_ID,
  venueId: VENUE_ID,
  sequence: 1,
  kind: "mission_started",
  entityType: "mission",
  entityId: MISSION_ID,
  entityRevision: null,
  actorUserId: USER_ID,
  actorRole: "staff",
  actorLabel: "Duty manager",
  actorKey: `user:${USER_ID}`,
  idempotencyKey: "mission:start:test",
  requiresAcknowledgement: false,
  payload: { kind: "mission_started", baselineHash: "b".repeat(64) },
  occurredAt: NOW,
  createdAt: NOW,
};

/** An event on the record at `sequence`, carrying `payload`. */
function recorded(sequence: number, payload: EventMissionEvent["payload"], requiresAcknowledgement = false): EventMissionEvent {
  return {
    ...missionStartedEvent,
    id: `00000000-0000-4000-8000-${String(900 + sequence).padStart(12, "0")}`,
    sequence,
    kind: payload.kind,
    idempotencyKey: `test-event:${String(sequence)}`,
    requiresAcknowledgement,
    payload,
  };
}

/** A blocked task at sequence 2, then twelve newer events that ask
 *  nothing of anyone: more than the history shows. */
const BLOCKED = recorded(2, {
  kind: "task_status_changed",
  fromStatus: "in_progress",
  task: { ...task, status: "blocked", revision: 2 },
  note: "Lift out of service.",
}, true);
const BUSY_EVENING = [
  missionStartedEvent,
  BLOCKED,
  ...Array.from({ length: 12 }, (_, index) => recorded(3 + index, {
    kind: "phase_status_changed",
    fromStatus: "pending",
    phase: { ...phase, revision: 2 + index },
    note: null,
  })),
];

const urgent: EventMissionIncident = {
  id: "00000000-0000-4000-8000-000000000120",
  missionId: MISSION_ID,
  eventId: EVENT_ID,
  phaseId: null,
  missionTaskId: null,
  title: "Fire door propped open",
  detail: "North stair, beside the cloakroom.",
  status: "open",
  severity: "urgent",
  spatialAnchor: null,
  assignedTo: null,
  reportedBy: USER_ID,
  revision: 1,
  resolvedAt: null,
  createdAt: NOW,
  updatedAt: NOW,
};

function acknowledgementOf(event: EventMissionEvent): EventMissionAcknowledgement {
  return {
    id: "00000000-0000-4000-8000-000000000130",
    missionId: MISSION_ID,
    eventId: EVENT_ID,
    acknowledgedEventId: event.id,
    acknowledgedBy: USER_ID,
    acknowledgedByRole: "staff",
    note: null,
    createdAt: NOW,
  };
}

function phaseAt(sortOrder: number, name: string, status: EventMissionPhase["status"]): EventMissionPhase {
  return {
    ...phase,
    id: `00000000-0000-4000-8000-${String(300 + sortOrder).padStart(12, "0")}`,
    phaseId: `00000000-0000-4000-8000-${String(400 + sortOrder).padStart(12, "0")}`,
    name,
    sortOrder,
    status,
  };
}

/** Resolves when the test says so, to hold a write in flight. */
function held<T>(): { readonly promise: Promise<T>; readonly release: (value: T) => void } {
  let release: (value: T) => void = () => undefined;
  const promise = new Promise<T>((resolve) => { release = resolve; });
  return { promise, release };
}

const presence: EventMissionPresence = {
  missionId: MISSION_ID,
  sessionId: "00000000-0000-4000-8000-000000000112",
  userId: USER_ID,
  displayName: "Duty manager",
  role: "staff",
  activePhaseId: null,
  activeTaskId: null,
  view: "board",
  lastSeenAt: NOW,
};

describe("EventMissionControl", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getTimeline.mockResolvedValue(timeline);
    mocks.heartbeat.mockResolvedValue(presence);
    mocks.deletePresence.mockResolvedValue(undefined);
  });

  afterEach(() => {
    cleanup();
  });

  it("starts a mission only from an explicit frozen handoff", async () => {
    mocks.getMission.mockRejectedValueOnce(new ApiError(404, "Mission not found", "NOT_FOUND"));
    mocks.startMission.mockResolvedValue(board);

    render(<EventMissionControl eventId={EVENT_ID} handoffPackId={PACK_ID} />);

    const start = await screen.findByRole("button", { name: /start live mission/i });
    fireEvent.click(start);

    await screen.findByRole("heading", { name: /mission live · phase not started/i });
    expect(mocks.startMission).toHaveBeenCalledWith(EVENT_ID, expect.objectContaining({ handoffPackId: PACK_ID }));
    expect(screen.getByText(/Planning references in metres, not survey marks/i)).toBeTruthy();
  });

  it("sends revision-checked phase transitions and renders spatial anchors", async () => {
    const activePhase: EventMissionPhase = {
      ...phase,
      status: "active",
      revision: 2,
      actualStartedAt: NOW,
    };
    mocks.getMission.mockResolvedValue(board);
    mocks.transitionPhase.mockResolvedValue(activePhase);

    render(<EventMissionControl eventId={EVENT_ID} handoffPackId={PACK_ID} />);

    expect(await screen.findByRole("slider")).toHaveProperty("value", "1");
    fireEvent.click(await screen.findByRole("button", { name: /go live/i }));

    await waitFor(() => {
      expect(mocks.transitionPhase).toHaveBeenCalledWith(
        MISSION_ID,
        MISSION_PHASE_ID,
        expect.objectContaining({ expectedRevision: 1, status: "active" }),
      );
    });
    expect(screen.getByText("Reception point")).toBeTruthy();
    expect(screen.getByRole("img", { name: /1 operational task anchors/i })).toBeTruthy();
  });

  it("deduplicates an overlapping event page during a live refresh", async () => {
    const activePhase: EventMissionPhase = {
      ...phase,
      status: "active",
      revision: 2,
      actualStartedAt: NOW,
    };
    mocks.getMission.mockResolvedValue(board);
    mocks.getTimeline.mockResolvedValue({ ...timeline, events: [missionStartedEvent] });
    mocks.transitionPhase.mockResolvedValue(activePhase);

    render(<EventMissionControl eventId={EVENT_ID} handoffPackId={PACK_ID} />);

    fireEvent.click(await screen.findByRole("button", { name: /go live/i }));
    await waitFor(() => { expect(mocks.getTimeline).toHaveBeenCalledTimes(2); });
    expect(screen.getAllByText("Mission started")).toHaveLength(1);
  });

  it("requires confirmation before making the mission terminal", async () => {
    const completedMission = {
      ...board.mission,
      status: "completed",
      completedAt: NOW,
      lastSequence: 2,
    } as const;
    mocks.getMission.mockResolvedValueOnce(board).mockResolvedValue({
      ...board,
      mission: completedMission,
      latestSequence: 2,
    });
    mocks.transitionStatus.mockResolvedValue(completedMission);
    render(<EventMissionControl eventId={EVENT_ID} handoffPackId={PACK_ID} />);

    fireEvent.click(await screen.findByRole("button", { name: /finish mission/i }));
    expect(mocks.transitionStatus).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: /^complete mission$/i }));

    await waitFor(() => {
      expect(mocks.transitionStatus).toHaveBeenCalledWith(
        MISSION_ID,
        expect.objectContaining({ status: "completed" }),
      );
    });
    expect(await screen.findByRole("heading", { name: /mission complete · replay retained/i })).toBeTruthy();
  });

  // --- Decision 7: the event-day board owns tasks and incidents ------------
  //
  // The scope is the TASK GRID and the INCIDENT FORM, and nothing else. An
  // earlier reading of this also took the phase rail's controls, which left a
  // live mission that could be finished but never advanced — and nothing else
  // in the product transitions a mission phase.

  it("keeps the phase rail live when the ops board owns tasks and incidents", async () => {
    mocks.getMission.mockResolvedValue(board);

    render(<EventMissionControl eventId={EVENT_ID} handoffPackId={PACK_ID} ownsExecutionControls={false} />);

    // The phase rail still acts.
    expect(await screen.findByRole("button", { name: /go live/i })).toBeTruthy();
    // The two surfaces decision 7 hands over are gone.
    expect(screen.queryByRole("button", { name: /log incident/i })).toBeNull();
    expect(screen.queryByLabelText("Incident title")).toBeNull();
    // And the counter for a grid that is not here, and cannot move, is gone.
    expect(screen.queryByText("tasks complete")).toBeNull();
    // The reader is told where to log instead.
    expect(screen.getByText("New issues are logged on the event-day board.")).toBeTruthy();
  });

  it("keeps its own task grid and incident form when mounted standalone", async () => {
    mocks.getMission.mockResolvedValue(board);

    // No `ownsExecutionControls` — the default the docblock claims.
    render(<EventMissionControl eventId={EVENT_ID} handoffPackId={PACK_ID} />);

    expect(await screen.findByRole("button", { name: /go live/i })).toBeTruthy();
    expect(screen.getByLabelText("Incident title")).toBeTruthy();
    expect(screen.getByText("tasks complete")).toBeTruthy();
  });

  // --- Roadmap N4: acknowledgements, phases and incidents that tell the truth

  it("lists every event still waiting, even twelve events back, and acknowledges it in place", async () => {
    mocks.getMission.mockResolvedValue({ ...board, latestSequence: 14 });
    mocks.getTimeline.mockResolvedValue({ ...timeline, events: BUSY_EVENING, latestSequence: 14 });
    const write = held<EventMissionAcknowledgement>();
    mocks.acknowledge.mockReturnValue(write.promise);

    render(<EventMissionControl eventId={EVENT_ID} handoffPackId={PACK_ID} ownsExecutionControls={false} />);

    const waiting = await screen.findByRole("region", { name: "Waiting for acknowledgement" });
    expect(within(waiting).getByText("Task blocked: Place reception desk")).toBeTruthy();
    expect(within(waiting).getByText("Lift out of service.")).toBeTruthy();
    // The history shows the latest ten, which no longer include it, and
    // offers nothing to press.
    const history = screen.getByRole("region", { name: "History" });
    expect(within(history).queryByText("#2")).toBeNull();
    expect(within(history).queryByRole("button", { name: "Acknowledge" })).toBeNull();

    fireEvent.click(within(waiting).getByRole("button", { name: "Acknowledge" }));
    const working = within(waiting).getByRole("button", { name: /Acknowledging…/u });
    expect(working.getAttribute("aria-busy")).toBe("true");
    // Waiting, not gone: it keeps focus while the others hold back.
    expect(working.getAttribute("aria-disabled")).toBe("true");
    expect(working).toHaveProperty("disabled", false);
    expect(mocks.acknowledge).toHaveBeenCalledWith(MISSION_ID, expect.objectContaining({ eventId: BLOCKED.id }));

    write.release(acknowledgementOf(BLOCKED));
    // It leaves, and a refresh that does not yet carry it cannot bring it back.
    await waitFor(() => { expect(screen.queryByRole("region", { name: "Waiting for acknowledgement" })).toBeNull(); });
    await waitFor(() => { expect(mocks.getMission).toHaveBeenCalledTimes(2); });
    expect(screen.queryByRole("region", { name: "Waiting for acknowledgement" })).toBeNull();
    expect(screen.queryByRole("status")).toBeNull();
  });

  it("keeps a failed acknowledgement beside its event, and takes a conflict as already acknowledged", async () => {
    mocks.getMission.mockResolvedValue({ ...board, latestSequence: 14 });
    mocks.getTimeline.mockResolvedValue({ ...timeline, events: BUSY_EVENING, latestSequence: 14 });
    mocks.acknowledge
      .mockRejectedValueOnce(new ApiError(503, "Service unavailable", "UNAVAILABLE"))
      .mockRejectedValueOnce(new ApiError(409, "Mission command conflicts with current state", "MISSION_CONFLICT"));

    render(<EventMissionControl eventId={EVENT_ID} handoffPackId={PACK_ID} ownsExecutionControls={false} />);

    const waiting = await screen.findByRole("region", { name: "Waiting for acknowledgement" });
    fireEvent.click(within(waiting).getByRole("button", { name: "Acknowledge" }));
    const failure = await within(waiting).findByRole("alert");
    expect(failure.textContent).toBe("Not acknowledged. Check the connection and try again.");
    expect(within(waiting).getByText("Task blocked: Place reception desk")).toBeTruthy();

    // Already acknowledged on another device: done, so it leaves.
    fireEvent.click(await within(waiting).findByRole("button", { name: "Acknowledge" }));
    await waitFor(() => { expect(screen.queryByRole("region", { name: "Waiting for acknowledgement" })).toBeNull(); });
  });

  it("offers Go live only on the next phase once nothing is live, and Skip only after asking", async () => {
    const running = [phaseAt(0, "Arrival", "completed"), phaseAt(1, "Dinner", "active"), phaseAt(2, "Speeches", "pending"), phaseAt(3, "Dancing", "pending")];
    mocks.getMission.mockResolvedValue({ ...board, phases: running });
    const skipped: EventMissionPhase = { ...phaseAt(2, "Speeches", "skipped"), revision: 2 };
    mocks.transitionPhase.mockResolvedValue(skipped);

    render(<EventMissionControl eventId={EVENT_ID} handoffPackId={PACK_ID} ownsExecutionControls={false} />);

    const rail = await screen.findByRole("region", { name: "Phases" });
    // Dinner is live, so nothing else may go live.
    expect(within(rail).queryByRole("button", { name: "Go live" })).toBeNull();
    expect(within(rail).getByRole("button", { name: "Complete" })).toBeTruthy();
    expect(Array.from(rail.querySelectorAll("li"), (item) => item.querySelector("span")?.textContent))
      .toEqual(["Done", "Now", "Next", "Later"]);

    // Skipping asks first, and names the phase.
    fireEvent.click(within(rail).getByRole("button", { name: "Skip" }));
    expect(mocks.transitionPhase).not.toHaveBeenCalled();
    expect(within(rail).getByText("Skip Speeches?")).toBeTruthy();
    fireEvent.click(within(rail).getByRole("button", { name: "Skip Speeches" }));
    await waitFor(() => {
      expect(mocks.transitionPhase).toHaveBeenCalledWith(MISSION_ID, running[2]?.id, expect.objectContaining({ status: "skipped", expectedRevision: 1 }));
    });
  });

  it("offers Go live on the next phase alone when none is live", async () => {
    mocks.getMission.mockResolvedValue({
      ...board,
      phases: [phaseAt(0, "Arrival", "completed"), phaseAt(1, "Dinner", "pending"), phaseAt(2, "Speeches", "pending")],
    });

    render(<EventMissionControl eventId={EVENT_ID} handoffPackId={PACK_ID} ownsExecutionControls={false} />);

    const rail = await screen.findByRole("region", { name: "Phases" });
    const goLive = within(rail).getAllByRole("button", { name: "Go live" });
    expect(goLive).toHaveLength(1);
    expect(goLive[0]?.closest("li")?.textContent).toContain("Dinner");
  });

  it("says beside the phases why one did not move, and announces no success", async () => {
    mocks.getMission.mockResolvedValue(board);
    mocks.transitionPhase
      .mockRejectedValueOnce(new ApiError(409, "Mission state changed in another session", "REVISION_CONFLICT"))
      .mockRejectedValueOnce(new ApiError(503, "Service unavailable", "UNAVAILABLE"))
      .mockResolvedValueOnce({ ...phase, status: "active", revision: 2, actualStartedAt: NOW });

    render(<EventMissionControl eventId={EVENT_ID} handoffPackId={PACK_ID} ownsExecutionControls={false} />);

    const rail = await screen.findByRole("region", { name: "Phases" });
    fireEvent.click(within(rail).getByRole("button", { name: "Go live" }));
    expect((await within(rail).findByRole("alert")).textContent)
      .toBe("Guest arrival was not changed: another device changed the mission first. The phases now show the latest.");

    fireEvent.click(await within(rail).findByRole("button", { name: "Go live" }));
    await waitFor(() => {
      expect(within(rail).getByRole("alert").textContent).toBe("Guest arrival was not changed. Check the connection and try again.");
    });

    fireEvent.click(await within(rail).findByRole("button", { name: "Go live" }));
    await waitFor(() => { expect(within(rail).queryByRole("alert")).toBeNull(); });
    expect(screen.queryByText(/is now/u)).toBeNull();
    expect(screen.queryByRole("status")).toBeNull();
  });

  it("resolves an incident in place, seals the list when none is open, and can reopen it", async () => {
    mocks.getMission.mockResolvedValue({ ...board, incidents: [urgent] });
    const write = held<EventMissionIncident>();
    mocks.updateIncident.mockReturnValue(write.promise);

    render(<EventMissionControl eventId={EVENT_ID} handoffPackId={PACK_ID} ownsExecutionControls={false} />);

    const incidents = await screen.findByRole("region", { name: "Incident channel" });
    expect(within(incidents).queryByText("No open incidents.")).toBeNull();
    expect(within(incidents).getByText("Urgent")).toBeTruthy();
    expect(within(incidents).getByText("Open")).toBeTruthy();
    fireEvent.click(within(incidents).getByRole("button", { name: "Resolve" }));
    expect(within(incidents).getByRole("button", { name: /Resolving…/u }).getAttribute("aria-busy")).toBe("true");
    expect(mocks.updateIncident).toHaveBeenCalledWith(MISSION_ID, urgent.id, expect.objectContaining({ status: "resolved", expectedRevision: 1 }));

    const resolved: EventMissionIncident = { ...urgent, status: "resolved", revision: 2, resolvedAt: NOW };
    mocks.getMission.mockResolvedValue({ ...board, incidents: [resolved] });
    write.release(resolved);

    expect(await within(incidents).findByText("No open incidents.")).toBeTruthy();
    const settled = within(incidents).getByRole("list", { name: "Resolved and closed incidents" });
    expect(within(settled).getByText("Resolved")).toBeTruthy();
    expect(within(settled).getByRole("button", { name: "Reopen" })).toBeTruthy();
    expect(screen.getByText("open incidents").previousElementSibling?.textContent).toBe("0");
  });

  it("keeps a failed resolve beside its incident, in words that fit the failure", async () => {
    mocks.getMission.mockResolvedValue({ ...board, incidents: [urgent] });
    mocks.updateIncident
      .mockRejectedValueOnce(new ApiError(503, "Service unavailable", "UNAVAILABLE"))
      .mockRejectedValueOnce(new ApiError(409, "Mission state changed in another session", "REVISION_CONFLICT"))
      .mockRejectedValueOnce(new ApiError(409, "Mission command conflicts with current state", "MISSION_CONFLICT"));

    render(<EventMissionControl eventId={EVENT_ID} handoffPackId={PACK_ID} ownsExecutionControls={false} />);

    const incidents = await screen.findByRole("region", { name: "Incident channel" });
    const expected = [
      "Not saved. Check the connection and try again.",
      "Not changed: another device changed this incident first. It now shows the latest.",
      "The mission has closed, so this incident can no longer change.",
    ];
    for (const words of expected) {
      fireEvent.click(await within(incidents).findByRole("button", { name: "Resolve" }));
      await waitFor(() => { expect(within(incidents).getByRole("alert").textContent).toBe(words); });
    }
    expect(within(incidents).getByText("Fire door propped open")).toBeTruthy();
  });

  it("names what each waiting event says happened", () => {
    const cancelled = recorded(5, {
      kind: "mission_status_changed",
      fromStatus: "live",
      mission: { ...board.mission, status: "cancelled", cancelledAt: NOW },
      reason: "Fire alarm evacuation.",
    }, true);
    expect(acknowledgementSummary(cancelled)).toEqual({ title: "Mission cancelled", detail: "Fire alarm evacuation." });
    expect(acknowledgementSummary(recorded(6, { kind: "incident_created", incident: urgent }, true)))
      .toEqual({ title: "Urgent incident: Fire door propped open", detail: "North stair, beside the cloakroom." });
    expect(acknowledgementSummary(recorded(7, {
      kind: "incident_updated",
      fromStatus: "open",
      incident: { ...urgent, status: "resolved", revision: 2, resolvedAt: NOW },
    }, true)).title).toBe("Urgent incident resolved: Fire door propped open");
    expect(acknowledgementSummary(BLOCKED)).toEqual({ title: "Task blocked: Place reception desk", detail: "Lift out of service." });
  });
});

