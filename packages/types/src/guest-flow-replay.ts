import { z } from "zod";
import { EventPhaseIdSchema } from "./event-phase-graph.js";
import { CanonicalJsonValueSchema, sha256Hex, stableCanonicalJson } from "./canonical-layout-snapshot.js";
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
  peakAgents: z.number().int().nonnegative().default(0),
  estimatedWaitSeconds: z.number().finite().nonnegative().default(0),
  serviceRatePerMinute: z.number().finite().positive().default(18),
}).strict();
export type QueueZone = z.infer<typeof QueueZoneSchema>;

export const StaffLaneSchema = z.object({
  id: z.string().trim().min(1).max(120),
  label: z.string().trim().min(1).max(160),
  line: z.array(GuestFlowPointSchema).min(2),
}).strict();
export type StaffLane = z.infer<typeof StaffLaneSchema>;

export const NavmeshVersionIdSchema = UUID;
export type NavmeshVersionId = z.infer<typeof NavmeshVersionIdSchema>;

export const GuestFlowScenarioIdSchema = UUID;
export type GuestFlowScenarioId = z.infer<typeof GuestFlowScenarioIdSchema>;

export const GuestFlowScenarioSchema = z.object({
  id: GuestFlowScenarioIdSchema,
  eventId: UUID.nullable(),
  phaseId: EventPhaseIdSchema.nullable(),
  configurationId: UUID.nullable(),
  name: z.string().trim().min(1).max(180),
  scenarioType: CrowdFlowScenarioTypeSchema,
  status: z.enum(["draft", "ready", "archived"]).default("draft"),
  seed: z.number().int().nonnegative(),
  assumptions: z.array(GuestFlowAssumptionSchema),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
}).strict();
export type GuestFlowScenario = z.infer<typeof GuestFlowScenarioSchema>;

export const GuestFlowBlockedZoneSchema = GuestFlowObstacleSchema.extend({
  reason: z.string().trim().min(1).max(160).default("blocked zone"),
}).strict();
export type GuestFlowBlockedZone = z.infer<typeof GuestFlowBlockedZoneSchema>;

export const GuestFlowNavmeshInputSchema = z.object({
  roomPolygon: GuestFlowPolygonSchema,
  obstacles: z.array(GuestFlowObstacleSchema).default([]),
  blockedZones: z.array(GuestFlowBlockedZoneSchema).default([]),
  agentRadiusM: z.number().finite().positive().default(0.35),
  cellSizeM: z.number().finite().positive().default(1.25),
}).strict();
export type GuestFlowNavmeshInput = z.infer<typeof GuestFlowNavmeshInputSchema>;

export const GuestFlowNavmeshCellSchema = z.object({
  id: z.string().trim().min(1).max(80),
  centre: GuestFlowPointSchema,
  polygon: GuestFlowPolygonSchema,
  row: z.number().int().nonnegative(),
  col: z.number().int().nonnegative(),
  neighbours: z.array(z.string().trim().min(1).max(80)),
  blockedBy: z.array(z.string().trim().min(1).max(120)),
}).strict();
export type GuestFlowNavmeshCell = z.infer<typeof GuestFlowNavmeshCellSchema>;

export const GuestFlowNavmeshEdgeSchema = z.object({
  from: z.string().trim().min(1).max(80),
  to: z.string().trim().min(1).max(80),
  cost: z.number().finite().positive(),
}).strict();
export type GuestFlowNavmeshEdge = z.infer<typeof GuestFlowNavmeshEdgeSchema>;

export const GuestFlowNavmeshTriangleSchema = z.object({
  id: z.string().trim().min(1).max(120),
  cellId: z.string().trim().min(1).max(80),
  points: z.tuple([GuestFlowPointSchema, GuestFlowPointSchema, GuestFlowPointSchema]),
}).strict();
export type GuestFlowNavmeshTriangle = z.infer<typeof GuestFlowNavmeshTriangleSchema>;

export const GuestFlowNavmeshArtifactSchema = z.object({
  schemaVersion: z.literal("venviewer.guest-flow-navmesh.v0"),
  navmeshHash: z.string().regex(SHA256_HEX),
  algorithm: z.literal("grid_navmesh_fallback_v0"),
  cellSizeM: z.number().finite().positive(),
  agentRadiusM: z.number().finite().positive(),
  roomBounds: z.object({
    minX: z.number().finite(),
    minY: z.number().finite(),
    maxX: z.number().finite(),
    maxY: z.number().finite(),
  }).strict(),
  cells: z.array(GuestFlowNavmeshCellSchema),
  adjacency: z.array(GuestFlowNavmeshEdgeSchema),
  triangles: z.array(GuestFlowNavmeshTriangleSchema),
  walkableCellCount: z.number().int().nonnegative(),
  blockedCellCount: z.number().int().nonnegative(),
  limitations: z.array(z.string().trim().min(1).max(240)).min(1),
}).strict();
export type GuestFlowNavmeshArtifact = z.infer<typeof GuestFlowNavmeshArtifactSchema>;

export const NavmeshVersionSchema = z.object({
  id: NavmeshVersionIdSchema,
  eventId: UUID.nullable(),
  phaseId: EventPhaseIdSchema.nullable(),
  configurationId: UUID.nullable(),
  navmeshHash: z.string().regex(SHA256_HEX),
  algorithm: z.literal("grid_navmesh_fallback_v0"),
  inputHash: z.string().regex(SHA256_HEX),
  cellSizeM: z.number().finite().positive(),
  agentRadiusM: z.number().finite().positive(),
  walkableCellCount: z.number().int().nonnegative(),
  blockedCellCount: z.number().int().nonnegative(),
  limitations: z.array(z.string().trim().min(1).max(240)),
  createdAt: z.string().datetime(),
}).strict();
export type NavmeshVersion = z.infer<typeof NavmeshVersionSchema>;

export const GuestFlowReplayMetricsSchema = z.object({
  agentCount: z.number().int().nonnegative(),
  averageTravelDistanceM: z.number().finite().nonnegative(),
  averageTravelTimeSeconds: z.number().finite().nonnegative(),
  maxDensity: z.number().finite().nonnegative(),
  bottleneckScore: z.number().min(0).max(1),
  routeConflictCount: z.number().int().nonnegative(),
  densityHotspotCount: z.number().int().nonnegative(),
  navmeshCellCount: z.number().int().nonnegative().optional(),
  navmeshWalkableCellCount: z.number().int().nonnegative().optional(),
  averageWalkingSpeedMps: z.number().finite().positive().optional(),
  queueZoneCount: z.number().int().nonnegative().optional(),
  maxQueueWaitSeconds: z.number().finite().nonnegative().optional(),
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
  navmesh: GuestFlowNavmeshArtifactSchema,
  metrics: GuestFlowReplayMetricsSchema,
}).strict();
export type GuestFlowReplayArtifact = z.infer<typeof GuestFlowReplayArtifactSchema>;

export const CreateGuestFlowReplayScenarioSchema = z.object({
  name: z.string().trim().min(1).max(180),
  eventId: UUID.nullable().optional(),
  phaseId: EventPhaseIdSchema.nullable().optional(),
  configurationId: UUID.nullable().optional(),
  input: GuestFlowReplayInputSchema,
}).strict();
export type CreateGuestFlowReplayScenario = z.infer<typeof CreateGuestFlowReplayScenarioSchema>;

export const StoredGuestFlowScenarioSchema = z.object({
  id: GuestFlowScenarioIdSchema,
  eventId: UUID.nullable(),
  phaseId: EventPhaseIdSchema.nullable(),
  configurationId: UUID.nullable(),
  name: z.string().trim().min(1).max(180),
  scenarioType: CrowdFlowScenarioTypeSchema,
  status: z.enum(["draft", "ready", "archived"]),
  seed: z.number().int().nonnegative(),
  assumptions: z.array(GuestFlowAssumptionSchema),
  inputPayload: GuestFlowReplayInputSchema,
  createdBy: UUID.nullable(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
}).strict();
export type StoredGuestFlowScenario = z.infer<typeof StoredGuestFlowScenarioSchema>;

export const StoredNavmeshVersionSchema = z.object({
  id: NavmeshVersionIdSchema,
  eventId: UUID.nullable(),
  phaseId: EventPhaseIdSchema.nullable(),
  configurationId: UUID.nullable(),
  scenarioId: GuestFlowScenarioIdSchema.nullable(),
  navmeshHash: z.string().regex(SHA256_HEX),
  inputHash: z.string().regex(SHA256_HEX),
  algorithm: z.literal("grid_navmesh_fallback_v0"),
  cellSizeM: z.number().finite().positive(),
  agentRadiusM: z.number().finite().positive(),
  walkableCellCount: z.number().int().nonnegative(),
  blockedCellCount: z.number().int().nonnegative(),
  payload: GuestFlowNavmeshArtifactSchema,
  limitations: z.array(z.string().trim().min(1).max(240)).min(1),
  createdBy: UUID.nullable(),
  createdAt: z.string().datetime(),
}).strict();
export type StoredNavmeshVersion = z.infer<typeof StoredNavmeshVersionSchema>;

export const StoredGuestFlowReplaySchema = z.object({
  id: GuestFlowReplayIdSchema,
  scenarioId: GuestFlowScenarioIdSchema.nullable(),
  navmeshVersionId: NavmeshVersionIdSchema.nullable(),
  eventId: UUID.nullable(),
  phaseId: EventPhaseIdSchema.nullable(),
  configurationId: UUID.nullable(),
  scenarioType: CrowdFlowScenarioTypeSchema,
  status: z.literal("simulated_planning_support"),
  simulatorSource: CrowdSimulatorSourceNameSchema,
  seed: z.number().int().nonnegative(),
  inputHash: z.string().regex(SHA256_HEX),
  artifactHash: z.string().regex(SHA256_HEX),
  snapshotHash: z.string().regex(SHA256_HEX).nullable(),
  assumptions: z.array(GuestFlowAssumptionSchema),
  inputPayload: GuestFlowReplayInputSchema,
  metrics: GuestFlowReplayMetricsSchema,
  disclosureLabel: z.literal("Simulated guest flow - planning support"),
  createdBy: UUID.nullable(),
  createdAt: z.string().datetime(),
}).strict();
export type StoredGuestFlowReplay = z.infer<typeof StoredGuestFlowReplaySchema>;

export const GuestFlowReplayPersistenceResultSchema = z.object({
  created: z.boolean(),
  scenario: StoredGuestFlowScenarioSchema.nullable(),
  navmeshVersion: StoredNavmeshVersionSchema,
  replay: StoredGuestFlowReplaySchema,
  artifact: GuestFlowReplayArtifactSchema,
}).strict();
export type GuestFlowReplayPersistenceResult = z.infer<typeof GuestFlowReplayPersistenceResultSchema>;

export const GuestFlowLatestReplayQuerySchema = z.object({
  eventId: UUID.optional(),
  phaseId: EventPhaseIdSchema.optional(),
  configurationId: UUID.optional(),
}).strict();
export type GuestFlowLatestReplayQuery = z.infer<typeof GuestFlowLatestReplayQuerySchema>;

interface Bounds {
  readonly minX: number;
  readonly minY: number;
  readonly maxX: number;
  readonly maxY: number;
}

interface BufferedBlocker {
  readonly id: string;
  readonly polygon: readonly GuestFlowPoint[];
  readonly bounds: Bounds;
}

interface QueueAccumulator {
  readonly destinationId: string;
  readonly estimatedAgents: number;
  readonly peakAgents: number;
  readonly maxWaitSeconds: number;
  readonly serviceRatePerMinute: number;
}

const DEFAULT_GUEST_WALKING_SPEED_MPS = 1.15;
const MIN_GUEST_WALKING_SPEED_MPS = 0.75;
const MAX_GUEST_WALKING_SPEED_MPS = 1.55;
const DEFAULT_DESTINATION_SERVICE_RATE_PER_MINUTE = 18;

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

function centroidFor(points: readonly GuestFlowPoint[]): GuestFlowPoint {
  const count = Math.max(1, points.length);
  const sum = points.reduce((acc, point) => ({
    x: acc.x + point.x,
    y: acc.y + point.y,
  }), { x: 0, y: 0 });
  return { x: sum.x / count, y: sum.y / count };
}

function distance(a: GuestFlowPoint, b: GuestFlowPoint): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

function interpolate(a: GuestFlowPoint, b: GuestFlowPoint, t: number): GuestFlowPoint {
  return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
}

function obstacleIntersectsSegment(obstacle: GuestFlowObstacle, start: GuestFlowPoint, end: GuestFlowPoint): boolean {
  const bufferedPolygon = bufferPolygonRadially(obstacle.polygon, 0.35);
  const samples = 12;
  for (let i = 1; i < samples; i += 1) {
    const point = interpolate(start, end, i / samples);
    if (pointInPolygon(point, bufferedPolygon)) return true;
  }
  return false;
}

function avoidanceWaypoint(obstacle: GuestFlowObstacle, room: Bounds, start: GuestFlowPoint, end: GuestFlowPoint): GuestFlowPoint {
  const box = boundsFor(obstacle.polygon);
  const above = { x: (box.minX + box.maxX) / 2, y: Math.min(room.maxY - 0.5, box.maxY + 0.8) };
  const below = { x: (box.minX + box.maxX) / 2, y: Math.max(room.minY + 0.5, box.minY - 0.8) };
  return distance(start, above) + distance(above, end) <= distance(start, below) + distance(below, end) ? above : below;
}

function pointInPolygon(point: GuestFlowPoint, polygon: readonly GuestFlowPoint[]): boolean {
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i, i += 1) {
    const current = polygon[i];
    const previous = polygon[j];
    if (current === undefined || previous === undefined) continue;
    const crosses = (current.y > point.y) !== (previous.y > point.y);
    if (!crosses) continue;
    const xAtY = ((previous.x - current.x) * (point.y - current.y)) / ((previous.y - current.y) || Number.EPSILON) + current.x;
    if (point.x < xAtY) inside = !inside;
  }
  return inside;
}

function bufferedBounds(points: readonly GuestFlowPoint[], bufferM: number): Bounds {
  const box = boundsFor(points);
  return {
    minX: box.minX - bufferM,
    minY: box.minY - bufferM,
    maxX: box.maxX + bufferM,
    maxY: box.maxY + bufferM,
  };
}

function boundsPolygon(bounds: Bounds): GuestFlowPolygon {
  return [
    { x: bounds.minX, y: bounds.minY },
    { x: bounds.maxX, y: bounds.minY },
    { x: bounds.maxX, y: bounds.maxY },
    { x: bounds.minX, y: bounds.maxY },
  ];
}

function bufferPolygonRadially(points: readonly GuestFlowPoint[], bufferM: number): GuestFlowPolygon {
  if (points.length < 3) return boundsPolygon(bufferedBounds(points, bufferM));
  const centre = centroidFor(points);
  return points.map((point) => {
    const dx = point.x - centre.x;
    const dy = point.y - centre.y;
    const length = Math.hypot(dx, dy);
    if (length < Number.EPSILON) return point;
    return {
      x: Number((point.x + (dx / length) * bufferM).toFixed(3)),
      y: Number((point.y + (dy / length) * bufferM).toFixed(3)),
    };
  });
}

function pointInBounds(point: GuestFlowPoint, box: Bounds): boolean {
  return point.x >= box.minX && point.x <= box.maxX && point.y >= box.minY && point.y <= box.maxY;
}

function blockerContainsCell(blocker: BufferedBlocker, centre: GuestFlowPoint, polygon: readonly GuestFlowPoint[]): boolean {
  if (!pointInBounds(centre, blocker.bounds) && !polygon.some((point) => pointInBounds(point, blocker.bounds))) {
    return false;
  }
  if (pointInPolygon(centre, blocker.polygon)) return true;
  if (polygon.some((point) => pointInPolygon(point, blocker.polygon))) return true;
  return blocker.polygon.some((point) => pointInPolygon(point, polygon));
}

function cellKey(row: number, col: number): string {
  return `cell-${String(row)}-${String(col)}`;
}

function cellPolygon(centre: GuestFlowPoint, size: number): GuestFlowPolygon {
  const half = size / 2;
  return [
    { x: Number((centre.x - half).toFixed(3)), y: Number((centre.y - half).toFixed(3)) },
    { x: Number((centre.x + half).toFixed(3)), y: Number((centre.y - half).toFixed(3)) },
    { x: Number((centre.x + half).toFixed(3)), y: Number((centre.y + half).toFixed(3)) },
    { x: Number((centre.x - half).toFixed(3)), y: Number((centre.y + half).toFixed(3)) },
  ];
}

function cellTriangles(cell: GuestFlowNavmeshCell): readonly GuestFlowNavmeshTriangle[] {
  const [a, b, c, d] = cell.polygon;
  if (a === undefined || b === undefined || c === undefined || d === undefined) return [];
  return [
    GuestFlowNavmeshTriangleSchema.parse({ id: `${cell.id}-tri-a`, cellId: cell.id, points: [a, b, c] }),
    GuestFlowNavmeshTriangleSchema.parse({ id: `${cell.id}-tri-b`, cellId: cell.id, points: [a, c, d] }),
  ];
}

export function buildGuestFlowNavmeshV0(input: GuestFlowNavmeshInput): GuestFlowNavmeshArtifact {
  const parsed = GuestFlowNavmeshInputSchema.parse(input);
  const roomBounds = boundsFor(parsed.roomPolygon);
  const rows = Math.max(1, Math.ceil((roomBounds.maxY - roomBounds.minY) / parsed.cellSizeM));
  const cols = Math.max(1, Math.ceil((roomBounds.maxX - roomBounds.minX) / parsed.cellSizeM));
  const blockers: readonly BufferedBlocker[] = [
    ...parsed.obstacles.map((obstacle) => {
      const polygon = bufferPolygonRadially(obstacle.polygon, parsed.agentRadiusM);
      return {
        id: obstacle.id,
        polygon,
        bounds: boundsFor(polygon),
      };
    }),
    ...parsed.blockedZones.map((zone) => {
      const polygon = bufferPolygonRadially(zone.polygon, parsed.agentRadiusM);
      return {
        id: zone.id,
        polygon,
        bounds: boundsFor(polygon),
      };
    }),
  ];
  const cells: GuestFlowNavmeshCell[] = [];

  for (let row = 0; row < rows; row += 1) {
    for (let col = 0; col < cols; col += 1) {
      const centre = {
        x: Number((roomBounds.minX + (col + 0.5) * parsed.cellSizeM).toFixed(3)),
        y: Number((roomBounds.minY + (row + 0.5) * parsed.cellSizeM).toFixed(3)),
      };
      const polygon = cellPolygon(centre, parsed.cellSizeM);
      const insideRoom = pointInPolygon(centre, parsed.roomPolygon);
      const blockedBy = insideRoom
        ? blockers.filter((blocker) => blockerContainsCell(blocker, centre, polygon)).map((blocker) => blocker.id)
        : ["outside_room_polygon"];
      cells.push(GuestFlowNavmeshCellSchema.parse({
        id: cellKey(row, col),
        centre,
        polygon,
        row,
        col,
        neighbours: [],
        blockedBy,
      }));
    }
  }

  const byRowCol = new Map(cells.map((cell) => [`${String(cell.row)}:${String(cell.col)}`, cell]));
  const walkableCells = cells.filter((cell) => cell.blockedBy.length === 0);
  const walkableIds = new Set(walkableCells.map((cell) => cell.id));
  const adjacency: GuestFlowNavmeshEdge[] = [];
  const neighbourOffsets = [
    { row: -1, col: 0, cost: parsed.cellSizeM },
    { row: 1, col: 0, cost: parsed.cellSizeM },
    { row: 0, col: -1, cost: parsed.cellSizeM },
    { row: 0, col: 1, cost: parsed.cellSizeM },
    { row: -1, col: -1, cost: parsed.cellSizeM * Math.SQRT2 },
    { row: -1, col: 1, cost: parsed.cellSizeM * Math.SQRT2 },
    { row: 1, col: -1, cost: parsed.cellSizeM * Math.SQRT2 },
    { row: 1, col: 1, cost: parsed.cellSizeM * Math.SQRT2 },
  ] as const;

  const cellsWithNeighbours = cells.map((cell) => {
    if (!walkableIds.has(cell.id)) return cell;
    const neighbours = neighbourOffsets.flatMap((offset) => {
      const candidate = byRowCol.get(`${String(cell.row + offset.row)}:${String(cell.col + offset.col)}`);
      if (candidate === undefined || !walkableIds.has(candidate.id)) return [];
      adjacency.push(GuestFlowNavmeshEdgeSchema.parse({
        from: cell.id,
        to: candidate.id,
        cost: Number(offset.cost.toFixed(3)),
      }));
      return [candidate.id];
    });
    return GuestFlowNavmeshCellSchema.parse({ ...cell, neighbours });
  });

  const triangles = cellsWithNeighbours
    .filter((cell) => cell.blockedBy.length === 0)
    .flatMap((cell) => cellTriangles(cell));
  const artifactWithoutHash = {
    schemaVersion: "venviewer.guest-flow-navmesh.v0",
    algorithm: "grid_navmesh_fallback_v0",
    cellSizeM: parsed.cellSizeM,
    agentRadiusM: parsed.agentRadiusM,
    roomBounds,
    cells: cellsWithNeighbours,
    adjacency,
    triangles,
    walkableCellCount: walkableCells.length,
    blockedCellCount: cells.length - walkableCells.length,
    limitations: [
      "V0 uses deterministic square navcells clipped by centre/corner sampling, not full constructive solid geometry.",
      "Object buffers use expanded footprint polygons; curved silhouettes and complex concave offsets are approximated.",
      "A* routes, simple funnel smoothing, density, and queue estimates are planning evidence only and require human review.",
    ],
  } as const;

  return GuestFlowNavmeshArtifactSchema.parse({
    ...artifactWithoutHash,
    navmeshHash: sha256Hex(stableCanonicalJson(CanonicalJsonValueSchema.parse(artifactWithoutHash))),
  });
}

function nearestWalkableCell(navmesh: GuestFlowNavmeshArtifact, point: GuestFlowPoint): GuestFlowNavmeshCell | null {
  let nearest: GuestFlowNavmeshCell | null = null;
  let bestDistance = Number.POSITIVE_INFINITY;
  for (const cell of navmesh.cells) {
    if (cell.blockedBy.length > 0) continue;
    const candidateDistance = distance(point, cell.centre);
    if (candidateDistance < bestDistance) {
      bestDistance = candidateDistance;
      nearest = cell;
    }
  }
  return nearest;
}

function reconstructCellPath(cameFrom: ReadonlyMap<string, string>, currentId: string): readonly string[] {
  const total = [currentId];
  let cursor = currentId;
  while (cameFrom.has(cursor)) {
    const previous = cameFrom.get(cursor);
    if (previous === undefined) break;
    total.unshift(previous);
    cursor = previous;
  }
  return total;
}

function routeCellIds(navmesh: GuestFlowNavmeshArtifact, start: GuestFlowPoint, end: GuestFlowPoint): readonly string[] {
  const startCell = nearestWalkableCell(navmesh, start);
  const endCell = nearestWalkableCell(navmesh, end);
  if (startCell === null || endCell === null) return [];
  if (startCell.id === endCell.id) return [startCell.id];

  const cellsById = new Map(navmesh.cells.map((cell) => [cell.id, cell]));
  const open = new Set<string>([startCell.id]);
  const cameFrom = new Map<string, string>();
  const gScore = new Map<string, number>([[startCell.id, 0]]);
  const fScore = new Map<string, number>([[startCell.id, distance(startCell.centre, endCell.centre)]]);

  while (open.size > 0) {
    const currentId = Array.from(open).sort((a, b) => {
      const delta = (fScore.get(a) ?? Number.POSITIVE_INFINITY) - (fScore.get(b) ?? Number.POSITIVE_INFINITY);
      return delta !== 0 ? delta : a.localeCompare(b);
    })[0];
    if (currentId === undefined) break;
    if (currentId === endCell.id) return reconstructCellPath(cameFrom, currentId);
    open.delete(currentId);
    const currentCell = cellsById.get(currentId);
    if (currentCell === undefined) continue;
    for (const neighbourId of currentCell.neighbours) {
      const neighbour = cellsById.get(neighbourId);
      if (neighbour === undefined) continue;
      const tentative = (gScore.get(currentId) ?? Number.POSITIVE_INFINITY) + distance(currentCell.centre, neighbour.centre);
      if (tentative >= (gScore.get(neighbourId) ?? Number.POSITIVE_INFINITY)) continue;
      cameFrom.set(neighbourId, currentId);
      gScore.set(neighbourId, tentative);
      fScore.set(neighbourId, tentative + distance(neighbour.centre, endCell.centre));
      open.add(neighbourId);
    }
  }
  return [];
}

function pointFallsInWalkableCell(navmesh: GuestFlowNavmeshArtifact, point: GuestFlowPoint): boolean {
  return navmesh.cells.some((cell) => cell.blockedBy.length === 0 && pointInBounds(point, boundsFor(cell.polygon)));
}

function segmentStaysInWalkableCells(navmesh: GuestFlowNavmeshArtifact, start: GuestFlowPoint, end: GuestFlowPoint): boolean {
  const samples = Math.max(2, Math.ceil(distance(start, end) / Math.max(0.25, navmesh.cellSizeM / 2)));
  for (let i = 0; i <= samples; i += 1) {
    if (!pointFallsInWalkableCell(navmesh, interpolate(start, end, i / samples))) return false;
  }
  return true;
}

function smoothRoute(navmesh: GuestFlowNavmeshArtifact, route: readonly GuestFlowPoint[]): readonly GuestFlowPoint[] {
  if (route.length <= 3) return route;
  const smoothed: GuestFlowPoint[] = [];
  let anchorIndex = 0;
  smoothed.push(route[0] ?? { x: 0, y: 0 });
  while (anchorIndex < route.length - 1) {
    let nextIndex = route.length - 1;
    const anchor = route[anchorIndex];
    if (anchor === undefined) break;
    while (nextIndex > anchorIndex + 1) {
      const candidate = route[nextIndex];
      if (candidate !== undefined && segmentStaysInWalkableCells(navmesh, anchor, candidate)) break;
      nextIndex -= 1;
    }
    const next = route[nextIndex];
    if (next === undefined) break;
    smoothed.push(next);
    anchorIndex = nextIndex;
  }
  return removeNearCollinearTurns(navmesh, smoothed);
}

function turnArea(a: GuestFlowPoint, b: GuestFlowPoint, c: GuestFlowPoint): number {
  return Math.abs(((b.x - a.x) * (c.y - a.y)) - ((b.y - a.y) * (c.x - a.x)));
}

function removeNearCollinearTurns(navmesh: GuestFlowNavmeshArtifact, route: readonly GuestFlowPoint[]): readonly GuestFlowPoint[] {
  if (route.length <= 3) return route;
  const simplified: GuestFlowPoint[] = [];
  for (let i = 0; i < route.length; i += 1) {
    const previous = simplified[simplified.length - 1];
    const current = route[i];
    const next = route[i + 1];
    if (current === undefined) continue;
    if (previous === undefined || next === undefined) {
      simplified.push(current);
      continue;
    }
    const baseline = Math.max(0.001, distance(previous, next));
    const deviation = turnArea(previous, current, next) / baseline;
    if (deviation < 0.18 && segmentStaysInWalkableCells(navmesh, previous, next)) continue;
    simplified.push(current);
  }
  return simplified;
}

export function findGuestFlowRouteV0(
  navmesh: GuestFlowNavmeshArtifact,
  start: GuestFlowPoint,
  end: GuestFlowPoint,
): readonly GuestFlowPoint[] {
  const cellsById = new Map(navmesh.cells.map((cell) => [cell.id, cell]));
  const ids = routeCellIds(navmesh, start, end);
  if (ids.length === 0) return [start, end];
  const route = [
    start,
    ...ids.flatMap((id) => {
      const cell = cellsById.get(id);
      return cell === undefined ? [] : [cell.centre];
    }),
    end,
  ];
  return smoothRoute(navmesh, route);
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

function trajectoryPoints(path: readonly GuestFlowPoint[], totalSeconds: number, startSeconds = 0): readonly GuestFlowTimedPoint[] {
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
      t: Math.round(startSeconds + ((elapsedDistance / totalDistance) * totalSeconds)),
    });
  }
  return points;
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function calibratedWalkingSpeedMps(random: () => number): number {
  const variation = (random() - 0.5) * 0.42;
  return Number(clamp(DEFAULT_GUEST_WALKING_SPEED_MPS + variation, MIN_GUEST_WALKING_SPEED_MPS, MAX_GUEST_WALKING_SPEED_MPS).toFixed(3));
}

function numericAssumptionValue(assumptions: readonly GuestFlowAssumption[], key: string): number | null {
  const assumption = assumptions.find((candidate) => candidate.key === key);
  return typeof assumption?.value === "number" && Number.isFinite(assumption.value) ? assumption.value : null;
}

function serviceRateForDestination(
  destination: GuestFlowDestination,
  assumptions: readonly GuestFlowAssumption[],
): number {
  const scoped = numericAssumptionValue(assumptions, `service_rate_per_minute:${destination.id}`);
  if (scoped !== null && scoped > 0) return scoped;
  const global = numericAssumptionValue(assumptions, "service_rate_per_minute");
  if (global !== null && global > 0) return global;
  if (/bar|drink|queue/iu.test(destination.label)) return 10;
  if (/dinner|table|seat/iu.test(destination.label)) return 24;
  return DEFAULT_DESTINATION_SERVICE_RATE_PER_MINUTE;
}

function updateQueueAccumulator(
  existing: QueueAccumulator | undefined,
  destinationId: string,
  serviceRatePerMinute: number,
  waitSeconds: number,
): QueueAccumulator {
  const estimatedAgents = (existing?.estimatedAgents ?? 0) + 1;
  const peakAgents = Math.max(existing?.peakAgents ?? 0, Math.ceil(waitSeconds / Math.max(1, 60 / serviceRatePerMinute)));
  return {
    destinationId,
    estimatedAgents,
    peakAgents,
    maxWaitSeconds: Math.max(existing?.maxWaitSeconds ?? 0, waitSeconds),
    serviceRatePerMinute,
  };
}

function buildDensity(trajectories: readonly AgentTrajectory[], cellSizeM: number): DensityHeatmap {
  const counts = new Map<string, { x: number; y: number; count: number }>();
  for (const trajectory of trajectories) {
    for (const point of trajectory.points) {
      const cellX = Math.floor(point.x / cellSizeM) * cellSizeM;
      const cellY = Math.floor(point.y / cellSizeM) * cellSizeM;
      const key = `${String(cellX)}:${String(cellY)}`;
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
  const maxTime = Math.max(...trajectories.map((trajectory) => trajectory.points[trajectory.points.length - 1]?.t ?? 0), 60);
  const sampleTimes = [0.2, 0.4, 0.6, 0.8].map((ratio) => Math.round(maxTime * ratio));
  const limit = Math.min(trajectories.length, 28);
  for (let i = 0; i < limit; i += 1) {
    const a = trajectories[i];
    if (a === undefined) continue;
    for (let j = i + 1; j < limit; j += 1) {
      const b = trajectories[j];
      if (b === undefined) continue;
      for (const sampleTime of sampleTimes) {
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
          break;
        }
      }
      if (conflicts.length >= 6) return conflicts;
    }
  }
  return conflicts;
}

function distanceToSegment(point: GuestFlowPoint, start: GuestFlowPoint, end: GuestFlowPoint): number {
  const lengthSquared = ((end.x - start.x) ** 2) + ((end.y - start.y) ** 2);
  if (lengthSquared === 0) return distance(point, start);
  const t = Math.max(0, Math.min(1, (((point.x - start.x) * (end.x - start.x)) + ((point.y - start.y) * (end.y - start.y))) / lengthSquared));
  return distance(point, {
    x: start.x + t * (end.x - start.x),
    y: start.y + t * (end.y - start.y),
  });
}

function detectStaffLaneOverlaps(
  trajectories: readonly AgentTrajectory[],
  lanes: readonly StaffLane[],
): readonly RouteConflict[] {
  const conflicts: RouteConflict[] = [];
  for (const lane of lanes) {
    for (const trajectory of trajectories.slice(0, 60)) {
      const closePoint = trajectory.points.find((point) => {
        for (let i = 1; i < lane.line.length; i += 1) {
          const previous = lane.line[i - 1];
          const current = lane.line[i];
          if (previous !== undefined && current !== undefined && distanceToSegment(point, previous, current) < 0.55) {
            return true;
          }
        }
        return false;
      });
      if (closePoint === undefined) continue;
      conflicts.push(RouteConflictSchema.parse({
        id: `staff-lane-overlap-${String(conflicts.length + 1)}`,
        conflictType: "staff_lane_overlap",
        severity: "attention",
        point: { x: Number(closePoint.x.toFixed(3)), y: Number(closePoint.y.toFixed(3)) },
        involvedAgentIds: [trajectory.agentId],
        message: `Simulated guest route overlaps ${lane.label}; review staffing assumptions.`,
      }));
      if (conflicts.length >= 4) return conflicts;
    }
  }
  return conflicts;
}

function buildQueueZones(
  queueAccumulators: ReadonlyMap<string, QueueAccumulator>,
  destinations: readonly GuestFlowDestination[],
): readonly QueueZone[] {
  return destinations.flatMap((destination) => {
    const accumulator = queueAccumulators.get(destination.id);
    const estimatedAgents = accumulator?.estimatedAgents ?? 0;
    if (estimatedAgents < 5) return [];
    return [QueueZoneSchema.parse({
      id: `queue-${destination.id}`,
      destinationId: destination.id,
      label: `${destination.label} queue zone`,
      centre: destination.point,
      estimatedAgents,
      peakAgents: accumulator?.peakAgents ?? 0,
      estimatedWaitSeconds: Number((accumulator?.maxWaitSeconds ?? 0).toFixed(1)),
      serviceRatePerMinute: accumulator?.serviceRatePerMinute ?? DEFAULT_DESTINATION_SERVICE_RATE_PER_MINUTE,
    })];
  });
}

export function runGuestFlowReplayV0(input: GuestFlowReplayInput): GuestFlowReplayArtifact {
  const parsed = GuestFlowReplayInputSchema.parse(input);
  const random = prng(parsed.seed);
  const roomBounds = boundsFor(parsed.roomPolygon);
  const navmesh = buildGuestFlowNavmeshV0({
    roomPolygon: parsed.roomPolygon,
    obstacles: parsed.obstacles,
    blockedZones: [],
    agentRadiusM: 0.35,
    cellSizeM: 1.25,
  });
  const trajectories: AgentTrajectory[] = [];
  const obstacleConflicts: RouteConflict[] = [];
  const queueAccumulators = new Map<string, QueueAccumulator>();
  const walkingSpeeds: number[] = [];
  const totalSeconds = Math.max(30, Math.min(600, parsed.phase.durationMinutes * 60));
  const arrivalSpreadSeconds = Math.min(totalSeconds * 0.35, 300);

  for (let i = 0; i < parsed.agentCount; i += 1) {
    const entrance = parsed.entrances[i % parsed.entrances.length];
    if (entrance === undefined) throw new Error("Guest Flow Replay requires at least one entrance.");
    const destination = weightedDestination(parsed.destinations, random);
    const spawn = jitter(entrance.point, random, Math.max(0.2, (entrance.widthM ?? 1) / 2));
    const path: GuestFlowPoint[] = [...findGuestFlowRouteV0(navmesh, spawn, destination.point)];
    const directFallbackPath: GuestFlowPoint[] = [spawn];
    for (const obstacle of parsed.obstacles) {
      if (obstacleIntersectsSegment(obstacle, spawn, destination.point)) {
        directFallbackPath.push(avoidanceWaypoint(obstacle, roomBounds, spawn, destination.point));
        if (obstacleConflicts.length < 6) {
          obstacleConflicts.push(RouteConflictSchema.parse({
            id: `obstacle-avoidance-${String(obstacleConflicts.length + 1)}`,
            conflictType: "obstacle_avoidance",
            severity: "info",
            point: directFallbackPath[directFallbackPath.length - 1] ?? destination.point,
            involvedAgentIds: [`agent-${String(i + 1).padStart(3, "0")}`],
            message: `Simulated path detours around ${obstacle.label}.`,
          }));
        }
      }
    }
    directFallbackPath.push(destination.point);
    const routePath = path.length >= 2 ? path : directFallbackPath;
    const walkingSpeedMps = calibratedWalkingSpeedMps(random);
    walkingSpeeds.push(walkingSpeedMps);
    const serviceRatePerMinute = serviceRateForDestination(destination, parsed.assumptions);
    const priorDestinationAgents = queueAccumulators.get(destination.id)?.estimatedAgents ?? 0;
    const queuePosition = priorDestinationAgents + 1;
    const queueWaitSeconds = Math.max(0, ((queuePosition - serviceRatePerMinute) / serviceRatePerMinute) * 60);
    queueAccumulators.set(
      destination.id,
      updateQueueAccumulator(queueAccumulators.get(destination.id), destination.id, serviceRatePerMinute, queueWaitSeconds),
    );
    const travelSeconds = Math.max(8, pathDistance(routePath) / walkingSpeedMps);
    const startSeconds = Math.round((i / Math.max(1, parsed.agentCount - 1)) * arrivalSpreadSeconds);
    trajectories.push(AgentTrajectorySchema.parse({
      agentId: `agent-${String(i + 1).padStart(3, "0")}`,
      profile: "guest",
      spawnId: entrance.id,
      destinationId: destination.id,
      points: trajectoryPoints(routePath, travelSeconds + queueWaitSeconds, startSeconds),
    }));
  }

  const densityHeatmap = buildDensity(trajectories, 1.5);
  const routeConflicts = [
    ...detectRouteCrossings(trajectories),
    ...detectStaffLaneOverlaps(trajectories, parsed.staffLanes),
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
  const avgWalkingSpeed = walkingSpeeds.reduce((sum, value) => sum + value, 0) / Math.max(1, walkingSpeeds.length);
  const queueZones = buildQueueZones(queueAccumulators, parsed.destinations);
  const maxQueueWaitSeconds = Math.max(0, ...queueZones.map((zone) => zone.estimatedWaitSeconds));
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
    queueZones,
    staffLanes: parsed.staffLanes,
    metrics: GuestFlowReplayMetricsSchema.parse({
      agentCount: trajectories.length,
      averageTravelDistanceM: Number(avgDistance.toFixed(3)),
      averageTravelTimeSeconds: Number(avgTime.toFixed(3)),
      maxDensity: densityHeatmap.maxDensity,
      bottleneckScore: Number(bottleneckScore.toFixed(3)),
      routeConflictCount: routeConflicts.length,
      densityHotspotCount: densityHotspots.length,
      navmeshCellCount: navmesh.cells.length,
      navmeshWalkableCellCount: navmesh.walkableCellCount,
      averageWalkingSpeedMps: Number(avgWalkingSpeed.toFixed(3)),
      queueZoneCount: queueZones.length,
      maxQueueWaitSeconds: Number(maxQueueWaitSeconds.toFixed(1)),
    }),
    navmesh,
  } as const;

  return GuestFlowReplayArtifactSchema.parse({
    ...artifactWithoutHash,
    artifactHash: sha256Hex(stableCanonicalJson(artifactWithoutHash)),
  });
}
