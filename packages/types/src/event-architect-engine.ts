import { getCanonicalAssetBySlug, type CanonicalAsset } from "./asset-catalogue.js";
import {
  canonicalLayoutSnapshotDigest,
  sha256Hex,
  stableCanonicalJson,
  type CanonicalJsonValue,
  type CanonicalLayoutSnapshotV0,
  type LayoutSnapshotPlacedObject,
} from "./canonical-layout-snapshot.js";
import {
  EVENT_ARCHITECT_ENGINE_VERSION,
  EVENT_ARCHITECT_SCHEMA_VERSION,
  EVENT_ARCHITECT_STRATEGIES,
  EventArchitectGuestFlowEvidenceSchema,
  EventArchitectRequestSchema,
  EventArchitectRunSchema,
  type EventArchitectCandidate,
  type EventArchitectGuestFlowEvidence,
  type EventArchitectProjectedCost,
  type EventArchitectRepairAction,
  type EventArchitectRepairHint,
  type EventArchitectRequest,
  type EventArchitectRun,
  type EventArchitectStrategy,
  type EventArchitectStrategyParameters,
} from "./event-architect.js";
import {
  GuestFlowReplayInputSchema,
  runGuestFlowReplayV0,
  type GuestFlowReplayInput,
} from "./guest-flow-replay.js";
import { runLayoutValidator, type LayoutValidatorWitness } from "./layout-validator.js";

const ENGINE_DOMAIN_PREFIX = "venviewer.event-architect-engine.v0\n";
const REQUEST_DOMAIN_PREFIX = "venviewer.event-architect-request.v0\n";
const UUID_DOMAIN_PREFIX = "venviewer.event-architect-uuid.v0\n";

interface Point2 {
  readonly x: number;
  readonly y: number;
}

function toCanonicalJson(value: unknown): CanonicalJsonValue {
  if (value === null || typeof value === "string" || typeof value === "boolean") return value;
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new Error("non-finite number cannot be canonicalized");
    return value;
  }
  if (Array.isArray(value)) return value.map((entry) => toCanonicalJson(entry));
  if (typeof value === "object") {
    const result: Record<string, CanonicalJsonValue> = {};
    for (const [key, entry] of Object.entries(value)) result[key] = toCanonicalJson(entry);
    return result;
  }
  throw new Error("unsupported canonical value");
}

const STRATEGY_PARAMETERS: Readonly<Record<EventArchitectStrategy, EventArchitectStrategyParameters>> = {
  comfort_first: {
    minWallOffsetM: 0.9,
    primaryAisleM: 1.5,
    rowPitchM: 1,
    seatPitchM: 0.55,
    tableGroupSpacingM: 0.9,
  },
  balanced: {
    minWallOffsetM: 0.75,
    primaryAisleM: 1.2,
    rowPitchM: 0.9,
    seatPitchM: 0.52,
    tableGroupSpacingM: 0.6,
  },
  capacity_first: {
    minWallOffsetM: 0.6,
    primaryAisleM: 0.9,
    rowPitchM: 0.8,
    seatPitchM: 0.5,
    tableGroupSpacingM: 0.3,
  },
};

const ENGINE_DEFINITION: CanonicalJsonValue = {
  version: EVENT_ARCHITECT_ENGINE_VERSION,
  strategies: EVENT_ARCHITECT_STRATEGIES.map((strategy) => ({
    strategy,
    parameters: toCanonicalJson(STRATEGY_PARAMETERS[strategy]),
  })),
  generators: ["dinner_round_grid_v0", "theatre_split_aisle_grid_v0"],
  pricing: "integer_minor_units_v0",
  repairs: "witness_causal_hints_v0",
  guestFlow: "deterministic_replay_summary_with_explicit_assumptions_v0",
};

export const EVENT_ARCHITECT_ENGINE_DIGEST = sha256Hex(
  `${ENGINE_DOMAIN_PREFIX}${stableCanonicalJson(ENGINE_DEFINITION)}`,
);

export function deterministicEventArchitectUuid(seed: string): string {
  const digest = sha256Hex(`${UUID_DOMAIN_PREFIX}${seed}`);
  const variant = ((Number.parseInt(digest[16] ?? "0", 16) & 0x3) | 0x8).toString(16);
  return [
    digest.slice(0, 8),
    digest.slice(8, 12),
    `5${digest.slice(13, 16)}`,
    `${variant}${digest.slice(17, 20)}`,
    digest.slice(20, 32),
  ].join("-");
}

function requireAsset(slug: string): CanonicalAsset {
  const asset = getCanonicalAssetBySlug(slug);
  if (asset === undefined) throw new Error(`missing canonical asset: ${slug}`);
  return asset;
}

function bounds(points: readonly Point2[]): {
  readonly minX: number;
  readonly maxX: number;
  readonly minY: number;
  readonly maxY: number;
} {
  return points.reduce(
    (current, point) => ({
      minX: Math.min(current.minX, point.x),
      maxX: Math.max(current.maxX, point.x),
      minY: Math.min(current.minY, point.y),
      maxY: Math.max(current.maxY, point.y),
    }),
    {
      minX: Number.POSITIVE_INFINITY,
      maxX: Number.NEGATIVE_INFINITY,
      minY: Number.POSITIVE_INFINITY,
      maxY: Number.NEGATIVE_INFINITY,
    },
  );
}

function pointSegmentDistance(point: Point2, start: Point2, end: Point2): number {
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const lengthSquared = dx * dx + dy * dy;
  if (lengthSquared === 0) return Math.hypot(point.x - start.x, point.y - start.y);
  const projection = Math.max(
    0,
    Math.min(1, ((point.x - start.x) * dx + (point.y - start.y) * dy) / lengthSquared),
  );
  return Math.hypot(
    point.x - (start.x + projection * dx),
    point.y - (start.y + projection * dy),
  );
}

function pointInsideWithOffset(
  point: Point2,
  polygon: readonly Point2[],
  wallOffsetM: number,
): boolean {
  let inside = false;
  let boundaryDistance = Number.POSITIVE_INFINITY;
  for (let index = 0; index < polygon.length; index += 1) {
    const start = polygon[index];
    const end = polygon[(index + 1) % polygon.length];
    if (start === undefined || end === undefined) continue;
    boundaryDistance = Math.min(boundaryDistance, pointSegmentDistance(point, start, end));
    const crosses = (start.y > point.y) !== (end.y > point.y)
      && point.x < ((end.x - start.x) * (point.y - start.y)) / (end.y - start.y) + start.x;
    if (crosses) inside = !inside;
  }
  return inside && boundaryDistance >= wallOffsetM;
}

function footprint(
  asset: CanonicalAsset,
  point: Point2,
  rotationY: number,
): readonly Point2[] {
  const halfWidth = asset.widthM / 2;
  const halfDepth = asset.depthM / 2;
  const cosine = Math.cos(rotationY);
  const sine = Math.sin(rotationY);
  return [
    { x: -halfWidth, y: -halfDepth },
    { x: halfWidth, y: -halfDepth },
    { x: halfWidth, y: halfDepth },
    { x: -halfWidth, y: halfDepth },
  ].map((corner) => ({
    x: point.x + corner.x * cosine - corner.y * sine,
    y: point.y + corner.x * sine + corner.y * cosine,
  }));
}

function placedObjectFootprint(object: LayoutSnapshotPlacedObject): readonly Point2[] {
  const halfWidth = (object.assetDefinition.widthM * object.scale) / 2;
  const halfDepth = (object.assetDefinition.depthM * object.scale) / 2;
  const cosine = Math.cos(object.rotation.y);
  const sine = Math.sin(object.rotation.y);
  return [
    { x: -halfWidth, y: -halfDepth },
    { x: halfWidth, y: -halfDepth },
    { x: halfWidth, y: halfDepth },
    { x: -halfWidth, y: halfDepth },
  ].map((corner) => ({
    x: object.position.x + corner.x * cosine - corner.y * sine,
    y: object.position.z + corner.x * sine + corner.y * cosine,
  }));
}

function assetFits(
  asset: CanonicalAsset,
  point: Point2,
  rotationY: number,
  outline: readonly Point2[],
  wallOffsetM: number,
): boolean {
  return footprint(asset, point, rotationY).every((corner) =>
    pointInsideWithOffset(corner, outline, wallOffsetM)
  );
}

function makePlacedObject(input: {
  readonly seed: string;
  readonly asset: CanonicalAsset;
  readonly point: Point2;
  readonly rotationY: number;
  readonly sortOrder: number;
  readonly groupId: string | null;
  readonly role: string;
}): LayoutSnapshotPlacedObject {
  return {
    objectId: deterministicEventArchitectUuid(`${input.seed}:object`),
    assetDefinition: {
      assetDefinitionId: input.asset.id,
      category: input.asset.category,
      widthM: input.asset.widthM,
      depthM: input.asset.depthM,
      heightM: input.asset.heightM,
      seatCount: input.asset.seatCount,
      collisionType: input.asset.collisionType,
    },
    position: { x: input.point.x, y: 0, z: input.point.y },
    rotation: { x: 0, y: input.rotationY, z: 0 },
    scale: 1,
    sortOrder: input.sortOrder,
    groupId: input.groupId,
    metadata: { role: input.role },
  };
}

function centeredGridPoints(
  outline: readonly Point2[],
  pitchM: number,
  edgeM: number,
): readonly Point2[] {
  const box = bounds(outline);
  const points: Point2[] = [];
  for (let y = box.minY + edgeM; y <= box.maxY - edgeM; y += pitchM) {
    for (let x = box.minX + edgeM; x <= box.maxX - edgeM; x += pitchM) {
      points.push({ x, y });
    }
  }
  const centre = { x: (box.minX + box.maxX) / 2, y: (box.minY + box.maxY) / 2 };
  return points.sort((left, right) => {
    const leftDistance = (left.x - centre.x) ** 2 + (left.y - centre.y) ** 2;
    const rightDistance = (right.x - centre.x) ** 2 + (right.y - centre.y) ** 2;
    return leftDistance - rightDistance || left.y - right.y || left.x - right.x;
  });
}

function dinnerRoundObjects(
  seed: string,
  request: EventArchitectRequest,
  parameters: EventArchitectStrategyParameters,
): readonly LayoutSnapshotPlacedObject[] {
  const table = requireAsset("round-table-6ft");
  const chair = requireAsset("banquet-chair");
  const chairsPerTable = table.seatCount ?? 10;
  const targetTableCount = Math.ceil(request.brief.guestCount / chairsPerTable);
  const chairRadiusM = Math.max(table.widthM, table.depthM) / 2 + chair.depthM / 2 + 0.1;
  const groupRadiusM = chairRadiusM + Math.max(chair.widthM, chair.depthM) / 2;
  const pitchM = groupRadiusM * 2 + parameters.tableGroupSpacingM;
  const centres = centeredGridPoints(
    request.room.floorPlanOutline,
    pitchM,
    groupRadiusM + parameters.minWallOffsetM,
  );
  const objects: LayoutSnapshotPlacedObject[] = [];
  let seatsRemaining = request.brief.guestCount;

  for (const centre of centres) {
    if (seatsRemaining <= 0 || objects.filter((object) => object.assetDefinition.category === "table").length >= targetTableCount) break;
    const chairCount = Math.min(chairsPerTable, seatsRemaining);
    const groupIndex = objects.filter((object) => object.assetDefinition.category === "table").length;
    const groupId = deterministicEventArchitectUuid(`${seed}:group:${String(groupIndex)}`);
    const chairPlacements = Array.from({ length: chairCount }, (_, chairIndex) => {
      const angle = (chairIndex / chairCount) * Math.PI * 2;
      return {
        point: {
          x: centre.x + Math.cos(angle) * chairRadiusM,
          y: centre.y + Math.sin(angle) * chairRadiusM,
        },
        rotationY: angle + Math.PI,
      };
    });
    const groupFits = assetFits(table, centre, 0, request.room.floorPlanOutline, parameters.minWallOffsetM)
      && chairPlacements.every((placement) => assetFits(
        chair,
        placement.point,
        placement.rotationY,
        request.room.floorPlanOutline,
        parameters.minWallOffsetM,
      ));
    if (!groupFits) continue;

    objects.push(makePlacedObject({
      seed: `${seed}:table:${String(groupIndex)}`,
      asset: table,
      point: centre,
      rotationY: 0,
      sortOrder: objects.length,
      groupId,
      role: "dinner_table",
    }));
    for (let chairIndex = 0; chairIndex < chairPlacements.length; chairIndex += 1) {
      const placement = chairPlacements[chairIndex];
      if (placement === undefined) continue;
      objects.push(makePlacedObject({
        seed: `${seed}:table:${String(groupIndex)}:chair:${String(chairIndex)}`,
        asset: chair,
        point: placement.point,
        rotationY: placement.rotationY,
        sortOrder: objects.length,
        groupId,
        role: "guest_seat",
      }));
    }
    seatsRemaining -= chairCount;
  }
  return objects;
}

function theatreObjects(
  seed: string,
  request: EventArchitectRequest,
  parameters: EventArchitectStrategyParameters,
): readonly LayoutSnapshotPlacedObject[] {
  const chair = requireAsset("banquet-chair");
  const outline = request.room.floorPlanOutline;
  const box = bounds(outline);
  const centreX = (box.minX + box.maxX) / 2;
  const candidates: Point2[] = [];
  for (
    let y = box.minY + parameters.minWallOffsetM + chair.depthM / 2;
    y <= box.maxY - parameters.minWallOffsetM - chair.depthM / 2;
    y += parameters.rowPitchM
  ) {
    const row: Point2[] = [];
    for (
      let offset = parameters.primaryAisleM / 2 + parameters.seatPitchM / 2;
      centreX - offset >= box.minX && centreX + offset <= box.maxX;
      offset += parameters.seatPitchM
    ) {
      row.push({ x: centreX - offset, y }, { x: centreX + offset, y });
    }
    candidates.push(...row.sort((left, right) => left.x - right.x));
  }

  const objects: LayoutSnapshotPlacedObject[] = [];
  for (const point of candidates) {
    if (objects.length >= request.brief.guestCount) break;
    if (!assetFits(chair, point, 0, outline, parameters.minWallOffsetM)) continue;
    const index = objects.length;
    objects.push(makePlacedObject({
      seed: `${seed}:chair:${String(index)}`,
      asset: chair,
      point,
      rotationY: 0,
      sortOrder: index,
      groupId: null,
      role: "guest_seat",
    }));
  }
  return objects;
}

function projectedCost(
  request: EventArchitectRequest,
  objects: readonly LayoutSnapshotPlacedObject[],
): EventArchitectProjectedCost | null {
  const catalogue = request.pricingCatalogue;
  if (catalogue === null) return null;
  const counts = new Map<string, number>();
  for (const object of objects) {
    const id = object.assetDefinition.assetDefinitionId;
    counts.set(id, (counts.get(id) ?? 0) + 1);
  }
  if ([...counts.keys()].some((id) => catalogue.perAssetMinor[id] === undefined)) return null;
  const assetLines = [...counts.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([assetDefinitionId, quantity]) => {
      const unitMinor = catalogue.perAssetMinor[assetDefinitionId];
      if (unitMinor === undefined) throw new Error("price catalogue changed during calculation");
      return {
        assetDefinitionId,
        quantity,
        unitMinor,
        subtotalMinor: quantity * unitMinor,
      };
    });
  const guestSubtotalMinor = request.brief.guestCount * catalogue.perGuestMinor;
  const totalMinor = catalogue.roomHireMinor
    + guestSubtotalMinor
    + assetLines.reduce((sum, line) => sum + line.subtotalMinor, 0);
  if (!Number.isSafeInteger(totalMinor)) throw new Error("projected total exceeds safe integer range");
  return {
    currency: catalogue.currency,
    priceBookRef: catalogue.priceBookRef,
    roomHireMinor: catalogue.roomHireMinor,
    guestSubtotalMinor,
    assetLines,
    totalMinor,
  };
}

const GUEST_FLOW_OBSTACLE_CATEGORIES: ReadonlySet<string> = new Set([
  "table",
  "stage",
  "barrier",
]);
const GUEST_FLOW_MARKER_LIMIT = 12;

function averagePoint(points: readonly Point2[]): Point2 {
  const total = points.reduce(
    (sum, point) => ({ x: sum.x + point.x, y: sum.y + point.y }),
    { x: 0, y: 0 },
  );
  return { x: total.x / points.length, y: total.y / points.length };
}

function guestFlowInput(
  request: EventArchitectRequest,
  snapshot: CanonicalLayoutSnapshotV0,
  snapshotDigest: string,
  requestDigest: string,
  strategy: EventArchitectStrategy,
): GuestFlowReplayInput {
  const outline = request.room.floorPlanOutline;
  const roomBounds = bounds(outline);
  const roomCentre = averagePoint(outline);
  const horizontalInsetM = Math.min(0.6, Math.max(0.1, (roomBounds.maxX - roomBounds.minX) * 0.1));
  const destinationObjects = snapshot.objects.filter(
    (object) => object.assetDefinition.category === "table",
  );
  const fallbackDestinationObjects = destinationObjects.length > 0
    ? destinationObjects
    : snapshot.objects.filter((object) => object.assetDefinition.category === "chair");
  const destination = fallbackDestinationObjects.length === 0
    ? roomCentre
    : averagePoint(fallbackDestinationObjects.map((object) => ({
        x: object.position.x,
        y: object.position.z,
      })));
  const seed = Number.parseInt(
    sha256Hex(`${requestDigest}:${strategy}:guest-flow`).slice(0, 8),
    16,
  );

  return GuestFlowReplayInputSchema.parse({
    scenarioType: "guest_arrival",
    layout: {
      configurationId: snapshot.configurationId,
      snapshotHash: snapshotDigest,
      placedObjectCount: snapshot.objects.length,
    },
    roomPolygon: outline,
    obstacles: snapshot.objects
      .filter((object) => GUEST_FLOW_OBSTACLE_CATEGORIES.has(object.assetDefinition.category))
      .map((object, index) => ({
        id: object.objectId,
        label: `${object.assetDefinition.category} ${String(index + 1)}`,
        polygon: placedObjectFootprint(object),
      })),
    entrances: [{
      id: "assumed-entrance",
      label: "Assumed entrance from room bounds",
      point: { x: roomBounds.minX + horizontalInsetM, y: roomCentre.y },
      widthM: null,
    }],
    exits: [{
      id: "assumed-exit",
      label: "Assumed exit from room bounds",
      point: { x: roomBounds.maxX - horizontalInsetM, y: roomCentre.y },
      widthM: null,
    }],
    destinations: [{
      id: "planned-guest-destination",
      label: destinationObjects.length > 0 ? "Planned table area" : "Planned guest area",
      point: destination,
      weight: 1,
    }],
    staffLanes: [],
    phase: { phaseId: null, label: "Arrival", durationMinutes: 30 },
    assumptions: [
      {
        key: "door_positions",
        label: "Door positions",
        value: "assumed from recorded room bounds",
        source: "Event Architect planning assumption",
      },
      {
        key: "guest_count",
        label: "Guest count",
        value: request.brief.guestCount,
        source: "event brief",
      },
      {
        key: "walking_speed_model",
        label: "Walking speed model",
        value: "deterministic guest-flow v0",
        source: "Venviewer guest-flow v0",
      },
      {
        key: "arrival_window_minutes",
        label: "Arrival window (minutes)",
        value: 30,
        source: "Event Architect planning assumption",
      },
    ],
    agentCount: request.brief.guestCount,
    seed,
  });
}

function guestFlowEvidence(
  request: EventArchitectRequest,
  snapshot: CanonicalLayoutSnapshotV0,
  snapshotDigest: string,
  requestDigest: string,
  strategy: EventArchitectStrategy,
): EventArchitectGuestFlowEvidence {
  const input = guestFlowInput(request, snapshot, snapshotDigest, requestDigest, strategy);
  const artifact = runGuestFlowReplayV0(input);
  return EventArchitectGuestFlowEvidenceSchema.parse({
    evidenceStatus: artifact.evidenceStatus,
    disclosureLabel: artifact.disclosureLabel,
    humanReviewRequired: true,
    input,
    inputHash: artifact.inputHash,
    artifactHash: artifact.artifactHash,
    simulatorSource: artifact.simulatorSource,
    metrics: artifact.metrics,
    navmeshHash: artifact.navmesh.navmeshHash,
    navmeshAlgorithm: artifact.navmesh.algorithm,
    navmeshWalkableCellCount: artifact.navmesh.walkableCellCount,
    navmeshBlockedCellCount: artifact.navmesh.blockedCellCount,
    limitations: artifact.navmesh.limitations,
    routeConflictMarkers: artifact.routeConflicts.slice(0, GUEST_FLOW_MARKER_LIMIT),
    routeConflictMarkersTruncated: artifact.routeConflicts.length > GUEST_FLOW_MARKER_LIMIT,
    reviewGate: {
      status: "requires_human_review",
      reason: "planning_assumptions_and_simplified_crowd_model",
      requiredData: [
        "surveyed_door_positions",
        "reviewed_route_model",
        "venue_operations_signoff",
      ],
      blockingForOpsCompilation: true,
    },
  });
}

function snapshotForCandidate(input: {
  readonly request: EventArchitectRequest;
  readonly requestDigest: string;
  readonly strategy: EventArchitectStrategy;
  readonly parameters: EventArchitectStrategyParameters;
  readonly objects: readonly LayoutSnapshotPlacedObject[];
}): CanonicalLayoutSnapshotV0 {
  const promptDigest = input.request.brief.planningPrompt === null
    ? null
    : sha256Hex(`${REQUEST_DOMAIN_PREFIX}prompt\n${input.request.brief.planningPrompt}`);
  return {
    schemaVersion: "layout_snapshot.v0",
    configurationId: deterministicEventArchitectUuid(`${input.requestDigest}:${input.strategy}:configuration`),
    venueId: input.request.room.venueId,
    spaceId: input.request.room.spaceId,
    layoutName: `${input.request.brief.eventName} — ${input.strategy}`,
    layoutStyle: input.request.brief.layoutStyle,
    visibility: "private",
    guestCount: input.request.brief.guestCount,
    createdFromConfigurationUpdatedAt: input.request.configurationUpdatedAt,
    createdBy: input.request.createdBy,
    snapshotCreatedAt: input.request.snapshotCreatedAt,
    sourceState: "saved_configuration",
    units: {
      lengthUnit: "metre",
      angleUnit: "radian",
      timeUnit: "iso8601_utc_timestamp",
      currency: "GBP",
    },
    tolerancePolicy: input.request.tolerancePolicy,
    eventMetadata: {
      eventType: input.request.brief.eventType,
      guestCount: input.request.brief.guestCount,
      preferredDate: input.request.brief.preferredDate,
      startTime: input.request.brief.startTime,
      endTime: input.request.brief.endTime,
      specialInstructions: null,
    },
    scenarioAssumptions: [
      {
        category: "guest_count",
        value: input.request.brief.guestCount,
        source: "planner_input",
        sourceReference: "eventArchitectRequest.brief.guestCount",
      },
      {
        category: "seating_style",
        value: input.request.brief.layoutStyle,
        source: "planner_input",
        sourceReference: "eventArchitectRequest.brief.layoutStyle",
      },
      {
        category: "service_model",
        value: input.request.brief.serviceModel,
        source: "planner_input",
        sourceReference: "eventArchitectRequest.brief.serviceModel",
      },
      {
        category: "accessibility_profile",
        value: [...input.request.brief.accessibilityRequirements].sort(),
        source: "planner_input",
        sourceReference: "eventArchitectRequest.brief.accessibilityRequirements",
      },
      {
        category: "tolerance_policy",
        value: toCanonicalJson(input.parameters),
        source: "system_default",
        sourceReference: `event-architect/${input.strategy}`,
      },
    ],
    venueRuntime: {
      venueId: input.request.room.venueId,
      venueSlug: input.request.room.venueSlug,
      spaceId: input.request.room.spaceId,
      spaceSlug: input.request.room.spaceSlug,
      spaceName: input.request.room.spaceName,
      floorPlanOutline: input.request.room.floorPlanOutline,
      floorPlanOutlineDigest: input.request.room.floorPlanOutlineDigest,
      spaceDimensions: input.request.room.spaceDimensions,
      roomGeometrySource: input.request.room.roomGeometrySource,
      runtimeVenueManifestDigest: input.request.room.runtimeVenueManifestDigest,
      runtimePackageId: input.request.room.runtimePackageId,
    },
    policyBundle: input.request.policyBundle,
    generatorProvenance: {
      generatorType: "template",
      generatorName: "Venviewer Event Architect",
      generatorVersion: EVENT_ARCHITECT_ENGINE_VERSION,
      promptDigest,
      sourceTemplateId: `event-architect/${input.request.brief.layoutStyle}/${input.strategy}`,
      humanEditedAfterGeneration: false,
      generatedAt: input.request.snapshotCreatedAt,
    },
    objects: [...input.objects],
  };
}

function numberFact(witness: LayoutValidatorWitness, key: string): number | null {
  const value = witness.facts[key];
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function makeRepairHint(input: {
  readonly candidateId: string;
  readonly witness: LayoutValidatorWitness;
  readonly action: EventArchitectRepairAction;
  readonly affectedObjectIds?: readonly string[];
  readonly quantity?: number;
  readonly amountM?: number;
  readonly amountMinor?: number;
}): EventArchitectRepairHint {
  return {
    hintId: deterministicEventArchitectUuid(
      `${input.candidateId}:${input.witness.witnessId}:${input.action}`,
    ),
    action: input.action,
    sourceWitnessId: input.witness.witnessId,
    affectedObjectIds: [...(input.affectedObjectIds ?? input.witness.affectedObjectIds)].sort(),
    quantity: input.quantity ?? null,
    amountM: input.amountM ?? null,
    amountMinor: input.amountMinor ?? null,
    messageKey: `event_architect_${input.action}`,
  };
}

function repairHints(
  candidateId: string,
  witnesses: readonly LayoutValidatorWitness[],
): readonly EventArchitectRepairHint[] {
  const hints: EventArchitectRepairHint[] = [];
  for (const witness of witnesses) {
    if (witness.ruleId === "layout.seating_provision" && witness.status === "fail") {
      const deficit = numberFact(witness, "deficit");
      if (deficit !== null && deficit > 0) hints.push(makeRepairHint({
        candidateId,
        witness,
        action: "add_seating",
        quantity: Math.ceil(deficit),
      }));
    }
    if (witness.ruleId === "layout.footprint_containment" && witness.status === "fail") {
      hints.push(makeRepairHint({ candidateId, witness, action: "move_inside_room" }));
    }
    if (witness.ruleId === "layout.primary_furniture_clearance" && witness.status === "fail") {
      const shortfallM = numberFact(witness, "shortfallM");
      if (shortfallM !== null && shortfallM > 0) hints.push(makeRepairHint({
        candidateId,
        witness,
        action: "increase_clearance",
        amountM: shortfallM,
      }));
    }
    if (witness.ruleId === "layout.budget" && witness.status === "fail") {
      const overrunMinor = numberFact(witness, "overrunMinor");
      if (overrunMinor !== null && overrunMinor > 0) hints.push(makeRepairHint({
        candidateId,
        witness,
        action: "reduce_budget_scope",
        amountMinor: Math.ceil(overrunMinor),
      }));
    }
    if (witness.ruleId === "layout.budget" && witness.status === "not_checked") {
      hints.push(makeRepairHint({ candidateId, witness, action: "supply_pricing_data" }));
    }
  }
  return hints.sort((left, right) =>
    left.action.localeCompare(right.action) || left.sourceWitnessId.localeCompare(right.sourceWitnessId)
  );
}

function buildCandidate(
  request: EventArchitectRequest,
  requestDigest: string,
  strategy: EventArchitectStrategy,
  rank: number,
): EventArchitectCandidate {
  const parameters = STRATEGY_PARAMETERS[strategy];
  const seed = `${requestDigest}:${strategy}`;
  const objects = request.brief.layoutStyle === "dinner-rounds"
    ? dinnerRoundObjects(seed, request, parameters)
    : theatreObjects(seed, request, parameters);
  const snapshot = snapshotForCandidate({ request, requestDigest, strategy, parameters, objects });
  const snapshotDigest = canonicalLayoutSnapshotDigest(snapshot);
  const cost = projectedCost(request, objects);
  const validation = runLayoutValidator(snapshot, {
    policyBundleId: request.policyBundle.policyBundleId,
    policyBundleDigest: request.policyBundle.policyBundleDigest,
    policyBundleVersion: request.policyBundle.policyBundleVersion,
    minPrimaryFurnitureClearanceM: request.validatorPolicy.minPrimaryFurnitureClearanceM,
    clearanceWarningMarginM: request.validatorPolicy.clearanceWarningMarginM,
    pricing: cost === null ? null : {
      currency: cost.currency,
      budgetLimitMinor: request.brief.budgetLimitMinor,
      projectedTotalMinor: cost.totalMinor,
      priceBookRef: cost.priceBookRef,
    },
  });
  const flowEvidence = guestFlowEvidence(
    request,
    snapshot,
    snapshotDigest,
    requestDigest,
    strategy,
  );
  const candidateId = deterministicEventArchitectUuid(`${seed}:candidate`);
  return {
    candidateId,
    rank,
    strategy,
    strategyParameters: parameters,
    snapshot,
    snapshotDigest,
    projectedCost: cost,
    validation,
    guestFlowEvidence: flowEvidence,
    repairHints: [...repairHints(candidateId, validation.witnesses)],
  };
}

export function runEventArchitect(requestInput: EventArchitectRequest): EventArchitectRun {
  const request = EventArchitectRequestSchema.parse(requestInput);
  const requestDigest = sha256Hex(
    `${REQUEST_DOMAIN_PREFIX}${stableCanonicalJson(toCanonicalJson(request))}`,
  );
  const runId = deterministicEventArchitectUuid(`${requestDigest}:run`);
  const candidates = EVENT_ARCHITECT_STRATEGIES.map((strategy, index) =>
    buildCandidate(request, requestDigest, strategy, index + 1)
  );
  return EventArchitectRunSchema.parse({
    schemaVersion: EVENT_ARCHITECT_SCHEMA_VERSION,
    engineVersion: EVENT_ARCHITECT_ENGINE_VERSION,
    engineDigest: EVENT_ARCHITECT_ENGINE_DIGEST,
    requestDigest,
    runId,
    candidates,
  });
}
