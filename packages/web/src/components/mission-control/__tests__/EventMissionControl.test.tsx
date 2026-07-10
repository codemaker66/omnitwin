import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type {
  EventMissionBoard,
  EventMissionEvent,
  EventMissionPhase,
  EventMissionPresence,
  EventMissionTimeline,
} from "@omnitwin/types";
import { ApiError } from "../../../api/client.js";
import { EventMissionControl } from "../EventMissionControl.js";

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
  tasks: [{
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
  }],
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
    expect(screen.getByText(/operational references, not survey marks/i)).toBeTruthy();
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
});
