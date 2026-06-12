import { describe, expect, it } from "vitest";
import {
  CreateGuestFlowReplayScenarioSchema,
  GuestFlowReplayPersistenceResultSchema,
  GuestFlowReplayArtifactSchema,
  buildGuestFlowNavmeshV0,
  findGuestFlowRouteV0,
  runGuestFlowReplayV0,
  type GuestFlowReplayInput,
} from "../guest-flow-replay.js";

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
  it("builds a deterministic navmesh approximation with cells, adjacency, and triangles", () => {
    const first = buildGuestFlowNavmeshV0({
      roomPolygon: INPUT.roomPolygon,
      obstacles: INPUT.obstacles,
      blockedZones: [],
      agentRadiusM: 0.35,
      cellSizeM: 1.25,
    });
    const second = buildGuestFlowNavmeshV0({
      roomPolygon: INPUT.roomPolygon,
      obstacles: INPUT.obstacles,
      blockedZones: [],
      agentRadiusM: 0.35,
      cellSizeM: 1.25,
    });

    expect(first.navmeshHash).toBe(second.navmeshHash);
    expect(first.algorithm).toBe("grid_navmesh_fallback_v0");
    expect(first.walkableCellCount).toBeGreaterThan(0);
    expect(first.blockedCellCount).toBeGreaterThan(0);
    expect(first.adjacency.length).toBeGreaterThan(0);
    expect(first.triangles.length).toBe(first.walkableCellCount * 2);
    expect(first.limitations.join(" ")).toMatch(/not full constructive polygon clipping/i);
  });

  it("finds a route through navcells and keeps route endpoints", () => {
    const navmesh = buildGuestFlowNavmeshV0({
      roomPolygon: INPUT.roomPolygon,
      obstacles: INPUT.obstacles,
      blockedZones: [],
      agentRadiusM: 0.35,
      cellSizeM: 1.25,
    });
    const route = findGuestFlowRouteV0(navmesh, INPUT.entrances[0]?.point ?? { x: 0, y: 0 }, INPUT.destinations[0]?.point ?? { x: 0, y: 0 });

    expect(route.length).toBeGreaterThan(2);
    expect(route[0]).toEqual(INPUT.entrances[0]?.point);
    expect(route[route.length - 1]).toEqual(INPUT.destinations[0]?.point);
  });

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
    expect(replay.navmesh.walkableCellCount).toBeGreaterThan(0);
    expect(replay.metrics.navmeshWalkableCellCount).toBe(replay.navmesh.walkableCellCount);
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

  it("validates persisted replay API contracts", () => {
    const artifact = runGuestFlowReplayV0(INPUT);
    const createdAt = "2026-06-12T12:00:00.000Z";
    const scenario = {
      id: "00000000-0000-4000-8000-000000006001",
      eventId: null,
      phaseId: INPUT.phase.phaseId,
      configurationId: INPUT.layout.configurationId,
      name: "Arrival replay",
      scenarioType: artifact.scenarioType,
      status: "ready",
      seed: artifact.seed,
      assumptions: artifact.assumptions,
      inputPayload: INPUT,
      createdBy: null,
      createdAt,
      updatedAt: createdAt,
    };
    const navmeshVersion = {
      id: "00000000-0000-4000-8000-000000006002",
      eventId: null,
      phaseId: INPUT.phase.phaseId,
      configurationId: INPUT.layout.configurationId,
      scenarioId: scenario.id,
      navmeshHash: artifact.navmesh.navmeshHash,
      inputHash: artifact.inputHash,
      algorithm: artifact.navmesh.algorithm,
      cellSizeM: artifact.navmesh.cellSizeM,
      agentRadiusM: artifact.navmesh.agentRadiusM,
      walkableCellCount: artifact.navmesh.walkableCellCount,
      blockedCellCount: artifact.navmesh.blockedCellCount,
      payload: artifact.navmesh,
      limitations: artifact.navmesh.limitations,
      createdBy: null,
      createdAt,
    };
    const replay = {
      id: "00000000-0000-4000-8000-000000006003",
      scenarioId: scenario.id,
      navmeshVersionId: navmeshVersion.id,
      eventId: null,
      phaseId: INPUT.phase.phaseId,
      configurationId: INPUT.layout.configurationId,
      scenarioType: artifact.scenarioType,
      status: artifact.evidenceStatus,
      simulatorSource: artifact.simulatorSource,
      seed: artifact.seed,
      inputHash: artifact.inputHash,
      artifactHash: artifact.artifactHash,
      snapshotHash: INPUT.layout.snapshotHash,
      assumptions: artifact.assumptions,
      inputPayload: INPUT,
      metrics: artifact.metrics,
      disclosureLabel: artifact.disclosureLabel,
      createdBy: null,
      createdAt,
    };

    expect(CreateGuestFlowReplayScenarioSchema.parse({ name: "Arrival replay", input: INPUT }).name).toBe("Arrival replay");
    expect(() => CreateGuestFlowReplayScenarioSchema.parse({ name: "", input: INPUT })).toThrow();
    expect(GuestFlowReplayPersistenceResultSchema.parse({
      created: true,
      scenario,
      navmeshVersion,
      replay,
      artifact,
    }).artifact.artifactHash).toBe(artifact.artifactHash);
  });
});
