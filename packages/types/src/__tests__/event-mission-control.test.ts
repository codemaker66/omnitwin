import { describe, expect, it } from "vitest";
import {
  CreateEventMissionIncidentInputSchema,
  EventMissionBaselineSchema,
  EventMissionEventSchema,
  EventMissionReplaySequenceError,
  EventMissionSpatialAnchorSchema,
  eventMissionBaselineHash,
  replayEventMission,
  type EventMission,
  type EventMissionBaseline,
  type EventMissionEvent,
  type EventMissionPhase,
  type EventMissionTask,
} from "../event-mission-control.js";

const NOW = "2026-07-10T09:00:00.000Z";
const MISSION_ID = "00000000-0000-4000-8000-000000010001";
const EVENT_ID = "00000000-0000-4000-8000-000000010002";
const VENUE_ID = "00000000-0000-4000-8000-000000010003";
const PACK_ID = "00000000-0000-4000-8000-000000010004";
const SNAPSHOT_ID = "00000000-0000-4000-8000-000000010005";
const CONFIG_ID = "00000000-0000-4000-8000-000000010006";
const PHASE_ID = "00000000-0000-4000-8000-000000010007";
const MISSION_PHASE_ID = "00000000-0000-4000-8000-000000010008";
const OPS_TASK_ID = "00000000-0000-4000-8000-000000010009";
const MISSION_TASK_ID = "00000000-0000-4000-8000-000000010010";
const USER_ID = "00000000-0000-4000-8000-000000010011";
const HASH = "a".repeat(64);

const phase: EventMissionPhase = {
  id: MISSION_PHASE_ID,
  missionId: MISSION_ID,
  eventId: EVENT_ID,
  phaseId: PHASE_ID,
  name: "Arrival",
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
  id: MISSION_TASK_ID,
  missionId: MISSION_ID,
  eventId: EVENT_ID,
  handoffPackId: PACK_ID,
  opsTaskId: OPS_TASK_ID,
  phaseId: PHASE_ID,
  kind: "setup",
  title: "Place tables",
  detail: "Place the frozen-snapshot table group in the marked room zone.",
  status: "todo",
  revision: 1,
  assignedTo: null,
  assigneeLabel: null,
  spatialAnchors: [{
    coordinateSpace: "real_m_v1",
    configurationId: CONFIG_ID,
    snapshotId: SNAPSHOT_ID,
    objectId: null,
    xM: 2.4,
    zM: -1.2,
    floorLabel: "Ground floor",
    label: "Centre tables",
    source: "frozen_snapshot",
  }],
  actualStartedAt: null,
  actualEndedAt: null,
  updatedBy: null,
  createdAt: NOW,
  updatedAt: NOW,
};

const baseline: EventMissionBaseline = {
  schemaVersion: "venviewer.event-mission.v0",
  missionId: MISSION_ID,
  eventId: EVENT_ID,
  venueId: VENUE_ID,
  handoffPackId: PACK_ID,
  sourceSnapshotHash: HASH,
  missionStatus: "live",
  startedAt: NOW,
  phases: [phase],
  tasks: [task],
};

const mission: EventMission = {
  id: MISSION_ID,
  eventId: EVENT_ID,
  venueId: VENUE_ID,
  handoffPackId: PACK_ID,
  sourceSnapshotHash: HASH,
  status: "live",
  baselineHash: eventMissionBaselineHash(baseline),
  lastSequence: 2,
  createdBy: USER_ID,
  startedAt: NOW,
  completedAt: null,
  cancelledAt: null,
  createdAt: NOW,
  updatedAt: NOW,
};

function missionEvent(
  sequence: number,
  payload: EventMissionEvent["payload"],
  entityType: EventMissionEvent["entityType"],
  entityId: string | null,
): EventMissionEvent {
  return EventMissionEventSchema.parse({
    id: `00000000-0000-4000-8000-${String(10000 + sequence).padStart(12, "0")}`,
    missionId: MISSION_ID,
    eventId: EVENT_ID,
    venueId: VENUE_ID,
    sequence,
    kind: payload.kind,
    entityType,
    entityId,
    entityRevision: sequence === 1 ? null : 2,
    actorUserId: USER_ID,
    actorRole: "staff",
    actorLabel: "Duty manager",
    actorKey: `user:${USER_ID}`,
    idempotencyKey: `operation-${String(sequence).padStart(8, "0")}`,
    requiresAcknowledgement: false,
    payload,
    occurredAt: NOW,
    createdAt: NOW,
  });
}

describe("event mission control contracts", () => {
  it("accepts typed real-metre anchors and rejects unknown coordinate provenance", () => {
    expect(EventMissionSpatialAnchorSchema.parse(task.spatialAnchors[0])).toEqual(task.spatialAnchors[0]);
    expect(EventMissionSpatialAnchorSchema.safeParse({
      ...task.spatialAnchors[0],
      coordinateSpace: "render_units",
    }).success).toBe(false);
    expect(EventMissionSpatialAnchorSchema.safeParse({
      ...task.spatialAnchors[0],
      confidence: "survey-grade",
    }).success).toBe(false);
  });

  it("hashes a strict immutable mission baseline deterministically", () => {
    expect(EventMissionBaselineSchema.parse(baseline)).toEqual(baseline);
    expect(eventMissionBaselineHash(baseline)).toMatch(/^[a-f0-9]{64}$/u);
    expect(eventMissionBaselineHash({ ...baseline, phases: [...baseline.phases] })).toBe(eventMissionBaselineHash(baseline));
    expect(eventMissionBaselineHash({
      ...baseline,
      tasks: [{ ...task, title: "Place ceremony tables" }],
    })).not.toBe(eventMissionBaselineHash(baseline));
  });

  it("replays phase and task state from append-only ordered events", () => {
    const activePhase: EventMissionPhase = {
      ...phase,
      status: "active",
      revision: 2,
      actualStartedAt: NOW,
      updatedBy: USER_ID,
    };
    const doneTask: EventMissionTask = {
      ...task,
      status: "done",
      revision: 2,
      actualStartedAt: NOW,
      actualEndedAt: NOW,
      updatedBy: USER_ID,
    };
    const events = [
      missionEvent(1, { kind: "mission_started", baselineHash: mission.baselineHash }, "mission", MISSION_ID),
      missionEvent(2, { kind: "phase_status_changed", fromStatus: "pending", phase: activePhase, note: null }, "phase", MISSION_PHASE_ID),
      missionEvent(3, { kind: "task_status_changed", fromStatus: "todo", task: doneTask, note: null }, "task", MISSION_TASK_ID),
    ];

    const atPhaseStart = replayEventMission(baseline, events, 2);
    expect(atPhaseStart.currentPhaseId).toBe(PHASE_ID);
    expect(atPhaseStart.tasks[0]?.status).toBe("todo");
    expect(atPhaseStart.lastSequence).toBe(2);

    const latest = replayEventMission(baseline, events);
    expect(latest.tasks[0]?.status).toBe("done");
    expect(latest.lastSequence).toBe(3);
  });

  it("fails closed on sequence gaps, cross-mission events, and duplicate-prone incident input", () => {
    const started = missionEvent(1, { kind: "mission_started", baselineHash: mission.baselineHash }, "mission", MISSION_ID);
    const gap = missionEvent(3, { kind: "mission_started", baselineHash: mission.baselineHash }, "mission", MISSION_ID);
    expect(() => replayEventMission(baseline, [started, gap])).toThrow(EventMissionReplaySequenceError);

    expect(CreateEventMissionIncidentInputSchema.safeParse({
      title: "Supplier delayed",
      detail: "The supplier has not reached the planned arrival window.",
      severity: "attention",
    }).success).toBe(false);
    expect(CreateEventMissionIncidentInputSchema.safeParse({
      title: "Supplier delayed",
      detail: "The supplier has not reached the planned arrival window.",
      severity: "attention",
      idempotencyKey: "incident-operation-0001",
    }).success).toBe(true);
  });
});
