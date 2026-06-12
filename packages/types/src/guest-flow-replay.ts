import { z } from "zod";
import { EventPhaseIdSchema } from "./event-phase-graph.js";
import { sha256Hex, stableCanonicalJson } from "./canonical-layout-snapshot.js";
import { CrowdAgentProfileTypeSchema, CrowdFlowScenarioTypeSchema, CrowdSimulatorSourceNameSchema } from "./crowd-simulation-replay.js";

// ---------------------------------------------------------------------------
// Guest Flow Replay v0
//
// A deliberately simple deterministic replay boundary. This is simulated
// planning support only: no safety, compliance, evacuation, or accessibility
// approval is created by this module.
// ---------------------------------------------------------------------------

export const GUEST_FLOW_REPLAY_SCHEMA_VERSION = "venviewer.guest-flow-replay.v0";
export const GUEST_FLOW_REPLAY_DIGEST_PREFIX = "venviewer.guest-flow-replay.v0\n";

const UUID = z.string().uuid();
const SHA256_HEX = /^[a-f0-9]{64}$/;

export const GuestFlowReplayIdSchema = UUID;
export type GuestFlowReplayId = z.infer<typeof GuestFlowReplayIdSchema>;

export const AgentTrajectoryIdSchema = UUID;
export type AgentTrajectoryId = z.infer<typeof AgentTrajectoryIdSchema>;

export const DensityHeatmapIdSchema = UUID;
export type DensityHeatmapId = z.infer<typeof DensityHeatmapIdSchema>;

export const RouteConflictIdSchema = UUID;
export type RouteConflictId = z.infer<typeof RouteConflictIdSchema>;

export const QueueZoneIdSchema = UUID;
export type QueueZoneId = z.infer<typeof QueueZoneIdSchema>;

export const StaffLaneIdSchema = UUID;
export type StaffLaneId = z.infer<typeof StaffLaneIdSchema>;

export const GuestFlowPointSchema = z.object({
  x: z.number().finite(),
  y: z.number().finite(),
}).strict();
export type GuestFlowPoint = z.infer<typeof GuestFlowPointSchema>;

export const GuestFlowTimedPointSchema = GuestFlowPointSchema.extend({
  t: z.number().finite().nonnegative(),
}).strict();
export type GuestFlowTimedPoint = z.infer<typeof GuestFlowTimedPointSchema>;

export const GuestFlowPolygonSchema = z.array(GuestFlowPointSchema).min(3);
export type GuestFlowPolygon = z.infer<typeof GuestFlowPolygonSchema>;

export const GuestFlowObstacleSchema = z.object({
  id: z.string().trim().min(1).max(120),
  label: z.string().trim().min(1).max(160),
  polygon: GuestFlowPolygonSchema,
}).strict();
export type GuestFlowObstacle = z.infer<typeof GuestFlowObstacleSchema>;

export const GuestFlowEntranceExitSchema = z.object({
  id: z.string().trim().min(1).max(120),
  label: z.string().trim().min(1).max(160),
  point: GuestFlowPointSchema,
  widthM: z.number().finite().positive().nullable(),
}).strict();
export type GuestFlowEntranceExit = z.infer<typeof GuestFlowEntranceExitSchema>;

export const GuestFlowDestinationSchema = z.object({
  id: z.string().trim().min(1).max(120),
  label: z.string().trim().min(1).max(160),
  point: GuestFlowPointSchema,
  weight: z.number().finite().positive().default(1),
}).strict();
export type GuestFlowDestination = z.infer<typeof GuestFlowDestinationSchema>;

export const GuestFlowStaffLaneInputSchema = z.object({
  id: z.string().trim().min(1).max(120),
  label: z.string().trim().min(1).max(160),
  line: z.array(GuestFlowPointSchema).min(2),
}).strict();
export type GuestFlowStaffLaneInput = z.infer<typeof GuestFlowStaffLaneInputSchema>;

export const GuestFlowLayoutInputSchema = z.object({
  configurationId: z.string().uuid().nullable(),
  snapshotHash: z.string().regex(SHA256_HEX).nullable(),
  placedObjectCount: z.number().int().nonnegative(),
}).strict();
export type GuestFlowLayoutInput = z.infer<typeof GuestFlowLayoutInputSchema>;

export const GuestFlowPhaseInputSchema = z.object({
  phaseId: EventPhaseIdSchema.nullable(),
  label: z.string().trim().min(1).max(120),
  durationMinutes: z.number().int().positive(),
}).strict();
export type GuestFlowPhaseInput = z.infer<typeof GuestFlowPhaseInputSchema>;

export const GuestFlowAssumptionSchema = z.object({
  key: z.string().trim().min(1).max(120),
  label: z.string().trim().min(1).max(200),
  value: z.union([z.string(), z.number(), z.boolean()]),
  source: z.string().trim().min(1).max(160),
}).strict();
export type GuestFlowAssumption = z.infer<typeof GuestFlowAssumptionSchema>;

export const GuestFlowReplayInputSchema = z.object({
  scenarioType: CrowdFlowScenarioTypeSchema,
  layout: GuestFlowLayoutInputSchema,
  roomPolygon: GuestFlowPolygonSchema,
  obstacles: z.array(GuestFlowObstacleSchema),
  entrances: z.array(GuestFlowEntranceExitSchema).min(1),
  exits: z.array(GuestFlowEntranceExitSchema).min(1),
  destinations: z.array(GuestFlowDestinationSchema).min(1),
  staffLanes: z.array(GuestFlowStaffLaneInputSchema).default([]),
  phase: GuestFlowPhaseInputSchema,
  assumptions: z.array(GuestFlowAssumptionSchema),
  agentCount: z.number().int().positive().max(500),
  seed: z.number().int().nonnegative(),
}).strict();
export type GuestFlowReplayInput = z.infer<typeof GuestFlowReplayInputSchema>;

export const AgentTrajectorySchema = z.object({
  agentId: z.string().trim().min(1).max(80),
  profile: CrowdAgentProfileTypeSchema,
  spawnId: z.string().trim().min(1).max(120),
  destinationId: z.string().trim().min(1).max(120),
  points: z.array(GuestFlowTimedPointSchema).min(2),
}).strict();
export type AgentTrajectory = z.infer<typeof AgentTrajectorySchema>;

export const DensityHeatmapCellSchema = z.object({
  x: z.number().finite(),
  y: z.number().finite(),
  count: z.number().int().nonnegative(),
  density: z.number().finite().nonnegative(),
  level: z.enum(["low", "medium", "high"]),
}).strict();
export type DensityHeatmapCell = z.infer<typeof DensityHeatmapCellSchema>;

export const DensityHeatmapSchema = z.object({
  cellSizeM: z.number().finite().positive(),
  maxDensity: z.number().finite().nonnegative(),
  cells: z.array(DensityHeatmapCellSchema),
}).strict();
export type DensityHeatmap = z.infer<typeof DensityHeatmapSchema>;

export const RouteConflictSchema = z.object({
  id: z.string().trim().min(1).max(120),
  conflictType: z.enum(["obstacle_avoidance", "route_crossing", "density_bottleneck", "staff_lane_overlap"]),
  severity: z.enum(["info", "attention", "review"]),
  point: GuestFlowPointSchema,
  involvedAgentIds: z.array(z.string().trim().min(1).max(80)),
  message: z.string().trim().min(1).max(260),
}).strict();
export type RouteConflict = z.infer<typeof RouteConflictSchema>;

export const QueueZoneSchema = z.object({
  id: z.string().trim().min(1).max(120),
  destinationId: z.string().trim().min(1).max(120),
  label: z.string().trim().min(1).max(160),
  centre: GuestFlowPointSchema,
  estimatedAgents: z.number().int().nonnegative(),
}).strict();
export type QueueZone = z.infer<typeof QueueZoneSchema>;

export const StaffLaneSchema = z.object({
  id: z.string().trim().min(1).max(120),
  label: z.string().trim().min(1).max(160),
  line: z.array(GuestFlowPointSchema).min(2),
}).strict();
export type StaffLane = z.infer<typeof StaffLaneSchema>;

export const GuestFlowReplayMetricsSchema = z.object({
  agentCount: z.number().int().nonnegative(),
  averageTravelDistanceM: z.number().finite().nonnegative(),
  averageTravelTimeSeconds: z.number().finite().nonnegative(),
  maxDensity: z.number().finite().nonnegative(),
  bottleneckScore: z.number().min(0).max(1),
  routeConflictCount: z.number().int().nonnegative(),
  densityHotspotCount: z.number().int().nonnegative(),
}).strict();
export type GuestFlowReplayMetrics = z.infer<typeof GuestFlowReplayMetricsSchema>;

export const GuestFlowReplayArtifactSchema = z.object({
  schemaVersion: z.literal(GUEST_FLOW_REPLAY_SCHEMA_VERSION),
  artifactHash: z.string().regex(SHA256_HEX),
  inputHash: z.string().regex(SHA256_HEX),
  scenarioType: CrowdFlowScenarioTypeSchema,
  phase: GuestFlowPhaseInputSchema,
  seed: z.number().int().nonnegative(),
  simulatorSource: CrowdSimulatorSourceNameSchema,
  evidenceStatus: z.literal("simulated_planning_support"),
  disclosureLabel: z.literal("Simulated guest flow - planning support"),
  assumptions: z.array(GuestFlowAssumptionSchema),
  trajectories: z.array(AgentTrajectorySchema),
  densityHeatmap: DensityHeatmapSchema,
  routeConflicts: z.array(RouteConflictSchema),
  queueZones: z.array(QueueZoneSchema),
  staffLanes: z.array(StaffLaneSchema),
  metrics: GuestFlowReplayMetricsSchema,
}).strict();
export type GuestFlowReplayArtifact = z.infer<typeof GuestFlowReplayArtifactSchema>;

interface Bounds {
  readonly minX: number;
  readonly minY: number;
  readonly maxX: number;
  readonly maxY: number;
}

function prng(seed: number): () => number {
  let state = seed === 0 ? 1 : seed >>> 0;
  return () => {
    state = (1664525 * state + 1013904223) >>> 0;
    return state / 0x100000000;
  };
}

function boundsFor(points: readonly GuestFlowPoint[]): Bounds {
  return points.reduce<Bounds>((acc, point) => ({
    minX: Math.min(acc.minX, point.x),
    minY: Math.min(acc.minY, point.y),
    maxX: Math.max(acc.maxX, point.x),
    maxY: Math.max(acc.maxY, point.y),
  }), { minX: Number.POSITIVE_INFINITY, minY: Number.POSITIVE_INFINITY, maxX: Number.NEGATIVE_INFINITY, maxY: Number.NEGATIVE_INFINITY });
}

function distance(a: GuestFlowPoint, b: GuestFlowPoint): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

function interpolate(a: GuestFlowPoint, b: GuestFlowPoint, t: number): GuestFlowPoint {
  return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
}

function obstacleIntersectsSegment(obstacle: GuestFlowObstacle, start: GuestFlowPoint, end: GuestFlowPoint): boolean {
  const box = boundsFor(obstacle.polygon);
  const samples = 12;
  for (let i = 1; i < samples; i += 1) {
    const point = interpolate(start, end, i / samples);
    if (point.x >= box.minX && point.x <= box.maxX && point.y >= box.minY && point.y <= box.maxY) return true;
  }
  return false;
}

function avoidanceWaypoint(obstacle: GuestFlowObstacle, room: Bounds, start: GuestFlowPoint, end: GuestFlowPoint): GuestFlowPoint {
  const box = boundsFor(obstacle.polygon);
  const above = { x: (box.minX + box.maxX) / 2, y: Math.min(room.maxY - 0.5, box.maxY + 0.8) };
  const below = { x: (box.minX + box.maxX) / 2, y: Math.max(room.minY + 0.5, box.minY - 0.8) };
  return distance(start, above) + distance(above, end) <= distance(start, below) + distance(below, end) ? above : below;
}

function weightedDestination(destinations: readonly GuestFlowDestination[], random: () => number): GuestFlowDestination {
  const total = destinations.reduce((sum, destination) => sum + destination.weight, 0);
  let cursor = random() * total;
  for (const destination of destinations) {
    cursor -= destination.weight;
    if (cursor <= 0) return destination;
  }
  const fallback = destinations[destinations.length - 1];
  if (fallback === undefined) throw new Error("Guest Flow Replay requires at least one destination.");
  return fallback;
}

function jitter(point: GuestFlowPoint, random: () => number, radius: number): GuestFlowPoint {
  const angle = random() * Math.PI * 2;
  const scale = random() * radius;
  return {
    x: point.x + Math.cos(angle) * scale,
    y: point.y + Math.sin(angle) * scale,
  };
}

function pathDistance(points: readonly GuestFlowPoint[]): number {
  let total = 0;
  for (let i = 1; i < points.length; i += 1) {
    const previous = points[i - 1];
    const current = points[i];
    if (previous !== undefined && current !== undefined) total += distance(previous, current);
  }
  return total;
}

function trajectoryPoints(path: readonly GuestFlowPoint[], totalSeconds: number): readonly GuestFlowTimedPoint[] {
  const totalDistance = Math.max(pathDistance(path), 0.001);
  let elapsedDistance = 0;
  const points: GuestFlowTimedPoint[] = [];
  for (let i = 0; i < path.length; i += 1) {
    const current = path[i];
    if (current === undefined) continue;
    if (i > 0) {
      const previous = path[i - 1];
      if (previous !== undefined) elapsedDistance += distance(previous, current);
    }
    points.push({
      ...current,
      t: Math.round((elapsedDistance / totalDistance) * totalSeconds),
    });
  }
  return points;
}

function buildDensity(trajectories: readonly AgentTrajectory[], cellSizeM: number): DensityHeatmap {
  const counts = new Map<string, { x: number; y: number; count: number }>();
  for (const trajectory of trajectories) {
    for (const point of trajectory.points) {
      const cellX = Math.floor(point.x / cellSizeM) * cellSizeM;
      const cellY = Math.floor(point.y / cellSizeM) * cellSizeM;
      const key = `${cellX}:${cellY}`;
      const existing = counts.get(key);
      counts.set(key, {
        x: cellX + cellSizeM / 2,
        y: cellY + cellSizeM / 2,
        count: (existing?.count ?? 0) + 1,
      });
    }
  }
  const cells = Array.from(counts.values()).map((cell) => {
    const density = Number((cell.count / (cellSizeM * cellSizeM)).toFixed(3));
    return DensityHeatmapCellSchema.parse({
      x: Number(cell.x.toFixed(3)),
      y: Number(cell.y.toFixed(3)),
      count: cell.count,
      density,
      level: density >= 3 ? "high" : density >= 1.5 ? "medium" : "low",
    });
  }).sort((a, b) => b.density - a.density);
  return DensityHeatmapSchema.parse({
    cellSizeM,
    maxDensity: cells[0]?.density ?? 0,
    cells,
  });
}

function nearestTrajectoryPoint(trajectory: AgentTrajectory, t: number): GuestFlowTimedPoint {
  return trajectory.points.reduce((best, point) => (
    Math.abs(point.t - t) < Math.abs(best.t - t) ? point : best
  ), trajectory.points[0] ?? { x: 0, y: 0, t: 0 });
}

function detectRouteCrossings(trajectories: readonly AgentTrajectory[]): readonly RouteConflict[] {
  const conflicts: RouteConflict[] = [];
  const sampleTime = 30;
  const limit = Math.min(trajectories.length, 28);
  for (let i = 0; i < limit; i += 1) {
    const a = trajectories[i];
    if (a === undefined) continue;
    for (let j = i + 1; j < limit; j += 1) {
      const b = trajectories[j];
      if (b === undefined) continue;
      const pa = nearestTrajectoryPoint(a, sampleTime);
      const pb = nearestTrajectoryPoint(b, sampleTime);
      if (distance(pa, pb) < 0.65) {
        conflicts.push(RouteConflictSchema.parse({
          id: `route-crossing-${String(conflicts.length + 1)}`,
          conflictType: "route_crossing",
          severity: "attention",
          point: { x: Number(((pa.x + pb.x) / 2).toFixed(3)), y: Number(((pa.y + pb.y) / 2).toFixed(3)) },
          involvedAgentIds: [a.agentId, b.agentId],
          message: "Simulated routes converge within a close planning threshold.",
        }));
      }
      if (conflicts.length >= 6) return conflicts;
    }
  }
  return conflicts;
}

function buildQueueZones(
  trajectories: readonly AgentTrajectory[],
  destinations: readonly GuestFlowDestination[],
): readonly QueueZone[] {
  return destinations.flatMap((destination) => {
    const estimatedAgents = trajectories.filter((trajectory) => trajectory.destinationId === destination.id).length;
    if (estimatedAgents < 5) return [];
    return [QueueZoneSchema.parse({
      id: `queue-${destination.id}`,
      destinationId: destination.id,
      label: `${destination.label} queue zone`,
      centre: destination.point,
      estimatedAgents,
    })];
  });
}

export function runGuestFlowReplayV0(input: GuestFlowReplayInput): GuestFlowReplayArtifact {
  const parsed = GuestFlowReplayInputSchema.parse(input);
  const random = prng(parsed.seed);
  const roomBounds = boundsFor(parsed.roomPolygon);
  const trajectories: AgentTrajectory[] = [];
  const obstacleConflicts: RouteConflict[] = [];
  const totalSeconds = Math.max(30, Math.min(600, parsed.phase.durationMinutes * 60));

  for (let i = 0; i < parsed.agentCount; i += 1) {
    const entrance = parsed.entrances[i % parsed.entrances.length];
    if (entrance === undefined) throw new Error("Guest Flow Replay requires at least one entrance.");
    const destination = weightedDestination(parsed.destinations, random);
    const spawn = jitter(entrance.point, random, Math.max(0.2, (entrance.widthM ?? 1) / 2));
    const path: GuestFlowPoint[] = [spawn];
    for (const obstacle of parsed.obstacles) {
      if (obstacleIntersectsSegment(obstacle, spawn, destination.point)) {
        path.push(avoidanceWaypoint(obstacle, roomBounds, spawn, destination.point));
        if (obstacleConflicts.length < 6) {
          obstacleConflicts.push(RouteConflictSchema.parse({
            id: `obstacle-avoidance-${String(obstacleConflicts.length + 1)}`,
            conflictType: "obstacle_avoidance",
            severity: "info",
            point: path[path.length - 1] ?? destination.point,
            involvedAgentIds: [`agent-${String(i + 1).padStart(3, "0")}`],
            message: `Simulated path detours around ${obstacle.label}.`,
          }));
        }
      }
    }
    path.push(destination.point);
    const speedSeconds = totalSeconds * (0.45 + random() * 0.28);
    trajectories.push(AgentTrajectorySchema.parse({
      agentId: `agent-${String(i + 1).padStart(3, "0")}`,
      profile: "guest",
      spawnId: entrance.id,
      destinationId: destination.id,
      points: trajectoryPoints(path, speedSeconds),
    }));
  }

  const densityHeatmap = buildDensity(trajectories, 1.5);
  const routeConflicts = [
    ...detectRouteCrossings(trajectories),
    ...obstacleConflicts,
  ].slice(0, 12);
  const densityHotspots = densityHeatmap.cells.filter((cell) => cell.level === "high");
  if (densityHotspots.length > 0) {
    const hotspot = densityHotspots[0];
    if (hotspot !== undefined) {
      routeConflicts.push(RouteConflictSchema.parse({
        id: "density-bottleneck-1",
        conflictType: "density_bottleneck",
        severity: "review",
        point: { x: hotspot.x, y: hotspot.y },
        involvedAgentIds: [],
        message: "Simulated density hotspot; review the layout and assumptions.",
      }));
    }
  }

  const travelDistances = trajectories.map((trajectory) => pathDistance(trajectory.points));
  const travelTimes = trajectories.map((trajectory) => trajectory.points[trajectory.points.length - 1]?.t ?? 0);
  const avgDistance = travelDistances.reduce((sum, value) => sum + value, 0) / Math.max(1, travelDistances.length);
  const avgTime = travelTimes.reduce((sum, value) => sum + value, 0) / Math.max(1, travelTimes.length);
  const bottleneckScore = Math.min(1, (densityHotspots.length * 0.14) + (routeConflicts.length * 0.035));
  const inputHash = sha256Hex(stableCanonicalJson(parsed));
  const artifactWithoutHash = {
    schemaVersion: GUEST_FLOW_REPLAY_SCHEMA_VERSION,
    inputHash,
    scenarioType: parsed.scenarioType,
    phase: parsed.phase,
    seed: parsed.seed,
    simulatorSource: "custom_venviewer_v0",
    evidenceStatus: "simulated_planning_support",
    disclosureLabel: "Simulated guest flow - planning support",
    assumptions: parsed.assumptions,
    trajectories,
    densityHeatmap,
    routeConflicts,
    queueZones: buildQueueZones(trajectories, parsed.destinations),
    staffLanes: parsed.staffLanes,
    metrics: GuestFlowReplayMetricsSchema.parse({
      agentCount: trajectories.length,
      averageTravelDistanceM: Number(avgDistance.toFixed(3)),
      averageTravelTimeSeconds: Number(avgTime.toFixed(3)),
      maxDensity: densityHeatmap.maxDensity,
      bottleneckScore: Number(bottleneckScore.toFixed(3)),
      routeConflictCount: routeConflicts.length,
      densityHotspotCount: densityHotspots.length,
    }),
  } as const;

  return GuestFlowReplayArtifactSchema.parse({
    ...artifactWithoutHash,
    artifactHash: sha256Hex(stableCanonicalJson(artifactWithoutHash)),
  });
}
