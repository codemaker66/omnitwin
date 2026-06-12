import { describe, expect, it } from "vitest";
import { GuestFlowReplayArtifactSchema, runGuestFlowReplayV0, type GuestFlowReplayInput } from "../guest-flow-replay.js";

const INPUT: GuestFlowReplayInput = {
  scenarioType: "guest_arrival",
  layout: {
    configurationId: "00000000-0000-4000-8000-000000004001",
    snapshotHash: "c".repeat(64),
    placedObjectCount: 18,
  },
  roomPolygon: [
    { x: 0, y: 0 },
    { x: 22, y: 0 },
    { x: 22, y: 12 },
    { x: 0, y: 12 },
  ],
  obstacles: [{
    id: "table-cluster",
    label: "Table cluster",
    polygon: [
      { x: 9, y: 4.5 },
      { x: 13, y: 4.5 },
      { x: 13, y: 7.5 },
      { x: 9, y: 7.5 },
    ],
  }],
  entrances: [{
    id: "west-door",
    label: "West door",
    point: { x: 1, y: 6 },
    widthM: 1.6,
  }],
  exits: [{
    id: "east-door",
    label: "East door",
    point: { x: 21, y: 6 },
    widthM: 1.6,
  }],
  destinations: [{
    id: "dinner-tables",
    label: "Dinner tables",
    point: { x: 19, y: 6 },
    weight: 1,
  }],
  staffLanes: [{
    id: "service-lane",
    label: "Service lane",
    line: [{ x: 6, y: 2 }, { x: 18, y: 2 }],
  }],
  phase: {
    phaseId: "00000000-0000-4000-8000-000000004002",
    label: "Arrival",
    durationMinutes: 30,
  },
  assumptions: [{
    key: "arrival_window",
    label: "Arrival window",
    value: "30 minutes",
    source: "planner input",
  }],
  agentCount: 40,
  seed: 1234,
};

describe("Guest Flow Replay v0", () => {
  it("is deterministic for the same seed", () => {
    const first = runGuestFlowReplayV0(INPUT);
    const second = runGuestFlowReplayV0(INPUT);

    expect(first.artifactHash).toBe(second.artifactHash);
    expect(first.trajectories[0]?.points).toEqual(second.trajectories[0]?.points);
  });

  it("changes output when the seed changes", () => {
    const first = runGuestFlowReplayV0(INPUT);
    const second = runGuestFlowReplayV0({ ...INPUT, seed: 5678 });

    expect(first.artifactHash).not.toBe(second.artifactHash);
  });

  it("produces density and route conflict output", () => {
    const replay = runGuestFlowReplayV0(INPUT);

    expect(replay.densityHeatmap.cells.length).toBeGreaterThan(0);
    expect(replay.metrics.maxDensity).toBeGreaterThan(0);
    expect(replay.routeConflicts.length).toBeGreaterThan(0);
    expect(replay.metrics.routeConflictCount).toBe(replay.routeConflicts.length);
  });

  it("labels the artifact as simulated planning support", () => {
    const replay = runGuestFlowReplayV0(INPUT);

    expect(GuestFlowReplayArtifactSchema.safeParse(replay).success).toBe(true);
    expect(replay.disclosureLabel).toBe("Simulated guest flow - planning support");
    expect(JSON.stringify(replay)).not.toMatch(/certified safe|legally compliant|approved for occupancy/iu);
  });

  it("keeps queue zones and staff lanes explicit", () => {
    const replay = runGuestFlowReplayV0(INPUT);

    expect(replay.queueZones[0]?.destinationId).toBe("dinner-tables");
    expect(replay.staffLanes[0]?.id).toBe("service-lane");
  });
});
