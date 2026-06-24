import type { FastifyInstance } from "fastify";
import { and, desc, eq } from "drizzle-orm";
import {
  CreateGuestFlowReplayScenarioSchema,
  GuestFlowLatestReplayQuerySchema,
  GuestFlowReplayArtifactSchema,
  GuestFlowReplayIdSchema,
  GuestFlowReplayPersistenceResultSchema,
  StoredGuestFlowReplaySchema,
  StoredGuestFlowScenarioSchema,
  StoredNavmeshVersionSchema,
  type GuestFlowReplayArtifact,
  type GuestFlowReplayPersistenceResult,
  type StoredGuestFlowReplay,
  type StoredGuestFlowScenario,
  type StoredNavmeshVersion,
} from "@omnitwin/types";
import type { Database } from "../db/client.js";
import {
  agentTrajectories,
  configurations,
  densityHeatmaps,
  eventPhases,
  events,
  guestFlowReplays,
  guestFlowScenarios,
  navmeshVersions,
  queueZones,
  routeConflicts,
  staffLanes,
} from "../db/schema.js";
import { authenticate, isPlatformAdmin, type JwtUser } from "../middleware/auth.js";
import { generateGuestFlowReplayV0 } from "../services/guest-flow-replay.js";

type GuestFlowReplayRow = typeof guestFlowReplays.$inferSelect;
type GuestFlowScenarioRow = typeof guestFlowScenarios.$inferSelect;
type NavmeshVersionRow = typeof navmeshVersions.$inferSelect;

function canUseGuestFlowReplay(user: JwtUser): boolean {
  return isPlatformAdmin(user) || user.role === "admin" || user.role === "staff";
}

function dateIso(value: Date): string {
  return value.toISOString();
}

function numericValue(value: string | number): number {
  return typeof value === "number" ? value : Number(value);
}

function storedScenario(row: GuestFlowScenarioRow): StoredGuestFlowScenario {
  return StoredGuestFlowScenarioSchema.parse({
    id: row.id,
    eventId: row.eventId,
    phaseId: row.phaseId,
    configurationId: row.configurationId,
    name: row.name,
    scenarioType: row.scenarioType,
    status: row.status,
    seed: row.seed,
    assumptions: row.assumptions,
    inputPayload: row.inputPayload,
    createdBy: row.createdBy,
    createdAt: dateIso(row.createdAt),
    updatedAt: dateIso(row.updatedAt),
  });
}

function storedNavmesh(row: NavmeshVersionRow): StoredNavmeshVersion {
  return StoredNavmeshVersionSchema.parse({
    id: row.id,
    eventId: row.eventId,
    phaseId: row.phaseId,
    configurationId: row.configurationId,
    scenarioId: row.scenarioId,
    navmeshHash: row.navmeshHash,
    inputHash: row.inputHash,
    algorithm: row.algorithm,
    cellSizeM: numericValue(row.cellSizeM),
    agentRadiusM: numericValue(row.agentRadiusM),
    walkableCellCount: row.walkableCellCount,
    blockedCellCount: row.blockedCellCount,
    payload: row.payload,
    limitations: row.limitations,
    createdBy: row.createdBy,
    createdAt: dateIso(row.createdAt),
  });
}

function storedReplay(row: GuestFlowReplayRow): StoredGuestFlowReplay {
  return StoredGuestFlowReplaySchema.parse({
    id: row.id,
    scenarioId: row.scenarioId,
    navmeshVersionId: row.navmeshVersionId,
    eventId: row.eventId,
    phaseId: row.phaseId,
    configurationId: row.configurationId,
    scenarioType: row.scenarioType,
    status: row.status,
    simulatorSource: row.simulatorSource,
    seed: row.seed,
    inputHash: row.inputHash,
    artifactHash: row.artifactHash,
    snapshotHash: row.snapshotHash,
    assumptions: row.assumptions,
    inputPayload: row.inputPayload,
    metrics: row.metrics,
    disclosureLabel: row.disclosureLabel,
    createdBy: row.createdBy,
    createdAt: dateIso(row.createdAt),
  });
}

async function venueForConfiguration(db: Database, configurationId: string): Promise<string | null> {
  const [row] = await db.select({ venueId: configurations.venueId })
    .from(configurations)
    .where(eq(configurations.id, configurationId))
    .limit(1);
  return row?.venueId ?? null;
}

async function venueForEvent(db: Database, eventId: string): Promise<string | null> {
  const [row] = await db.select({ venueId: events.venueId })
    .from(events)
    .where(eq(events.id, eventId))
    .limit(1);
  return row?.venueId ?? null;
}

async function eventForPhase(db: Database, phaseId: string): Promise<{ eventId: string; venueId: string } | null> {
  const [phase] = await db.select({ eventId: eventPhases.eventId })
    .from(eventPhases)
    .where(eq(eventPhases.id, phaseId))
    .limit(1);
  if (phase === undefined) return null;
  const venueId = await venueForEvent(db, phase.eventId);
  if (venueId === null) return null;
  return { eventId: phase.eventId, venueId };
}

async function validateLinkedVenue(
  db: Database,
  user: JwtUser,
  links: {
    readonly eventId: string | null;
    readonly phaseId: string | null;
    readonly configurationId: string | null;
  },
): Promise<{ ok: true; eventId: string | null } | { ok: false; status: number; error: string; code: string }> {
  if (!canUseGuestFlowReplay(user)) {
    return { ok: false, status: 403, error: "Only venue staff can manage guest-flow replay artifacts", code: "FORBIDDEN" };
  }

  const linkedVenueIds = new Set<string>();
  let resolvedEventId = links.eventId;

  if (links.configurationId !== null) {
    const venueId = await venueForConfiguration(db, links.configurationId);
    if (venueId === null) {
      return { ok: false, status: 404, error: "Configuration not found", code: "NOT_FOUND" };
    }
    linkedVenueIds.add(venueId);
  }

  if (links.eventId !== null) {
    const venueId = await venueForEvent(db, links.eventId);
    if (venueId === null) {
      return { ok: false, status: 404, error: "Event not found", code: "NOT_FOUND" };
    }
    linkedVenueIds.add(venueId);
  }

  if (links.phaseId !== null) {
    const phase = await eventForPhase(db, links.phaseId);
    if (phase === null) {
      return { ok: false, status: 404, error: "Event phase not found", code: "NOT_FOUND" };
    }
    if (resolvedEventId !== null && resolvedEventId !== phase.eventId) {
      return { ok: false, status: 422, error: "Event phase belongs to a different event", code: "EVENT_PHASE_MISMATCH" };
    }
    resolvedEventId = phase.eventId;
    linkedVenueIds.add(phase.venueId);
  }

  if (linkedVenueIds.size > 1) {
    return { ok: false, status: 422, error: "Guest-flow replay links must belong to one venue", code: "VENUE_MISMATCH" };
  }

  if (!isPlatformAdmin(user)) {
    if (linkedVenueIds.size === 0) {
      return { ok: false, status: 422, error: "Venue replay requests must be linked to an event, phase, or configuration", code: "VENUE_SCOPE_REQUIRED" };
    }
    const [venueId] = Array.from(linkedVenueIds);
    if (user.venueId === null || venueId !== user.venueId) {
      return { ok: false, status: 403, error: "Insufficient venue scope for guest-flow replay", code: "FORBIDDEN" };
    }
  }

  return { ok: true, eventId: resolvedEventId };
}

async function assembleStoredReplay(
  db: Database,
  replay: GuestFlowReplayRow,
): Promise<GuestFlowReplayPersistenceResult | null> {
  if (replay.navmeshVersionId === null) return null;

  const [navmesh] = await db.select()
    .from(navmeshVersions)
    .where(eq(navmeshVersions.id, replay.navmeshVersionId))
    .limit(1);
  if (navmesh === undefined) return null;

  const [scenario] = replay.scenarioId === null
    ? []
    : await db.select()
      .from(guestFlowScenarios)
      .where(eq(guestFlowScenarios.id, replay.scenarioId))
      .limit(1);

  const [trajectoryRows, heatmapRows, conflictRows, queueRows, laneRows] = await Promise.all([
    db.select().from(agentTrajectories).where(eq(agentTrajectories.replayId, replay.id)),
    db.select().from(densityHeatmaps).where(eq(densityHeatmaps.replayId, replay.id)).limit(1),
    db.select().from(routeConflicts).where(eq(routeConflicts.replayId, replay.id)),
    db.select().from(queueZones).where(eq(queueZones.replayId, replay.id)),
    db.select().from(staffLanes).where(eq(staffLanes.replayId, replay.id)),
  ]);

  const heatmap = heatmapRows[0];
  if (heatmap === undefined) return null;

  const artifact: GuestFlowReplayArtifact = GuestFlowReplayArtifactSchema.parse({
    schemaVersion: "venviewer.guest-flow-replay.v0",
    artifactHash: replay.artifactHash,
    inputHash: replay.inputHash,
    scenarioType: replay.scenarioType,
    phase: replay.inputPayload.phase,
    seed: replay.seed,
    simulatorSource: replay.simulatorSource,
    evidenceStatus: "simulated_planning_support",
    disclosureLabel: replay.disclosureLabel,
    assumptions: replay.assumptions,
    trajectories: trajectoryRows.map((row) => ({
      agentId: row.agentId,
      profile: row.profile,
      spawnId: row.spawnId,
      destinationId: row.destinationId,
      points: row.points,
    })),
    densityHeatmap: {
      cellSizeM: numericValue(heatmap.cellSizeM),
      maxDensity: numericValue(heatmap.maxDensity),
      cells: heatmap.cells,
    },
    routeConflicts: conflictRows.map((row) => ({
      id: row.conflictKey,
      conflictType: row.conflictType,
      severity: row.severity,
      point: row.point,
      involvedAgentIds: row.involvedAgentIds,
      message: row.message,
    })),
    queueZones: queueRows.map((row) => ({
      id: row.zoneKey,
      destinationId: row.destinationId,
      label: row.label,
      centre: row.centre,
      estimatedAgents: row.estimatedAgents,
    })),
    staffLanes: laneRows.map((row) => ({
      id: row.laneKey,
      label: row.label,
      line: row.line,
    })),
    navmesh: navmesh.payload,
    metrics: replay.metrics,
  });

  return GuestFlowReplayPersistenceResultSchema.parse({
    created: false,
    scenario: scenario === undefined ? null : storedScenario(scenario),
    navmeshVersion: storedNavmesh(navmesh),
    replay: storedReplay(replay),
    artifact,
  });
}

export async function guestFlowReplayRoutes(
  server: FastifyInstance,
  opts: { db: Database },
): Promise<void> {
  const { db } = opts;

  server.post("/scenarios", { preHandler: [authenticate] }, async (request, reply) => {
    const parsed = CreateGuestFlowReplayScenarioSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: "Validation failed", code: "VALIDATION_ERROR", details: parsed.error.issues });
    }

    const configurationId = parsed.data.configurationId ?? parsed.data.input.layout.configurationId;
    const phaseId = parsed.data.phaseId ?? parsed.data.input.phase.phaseId;
    const links = {
      eventId: parsed.data.eventId ?? null,
      phaseId: phaseId ?? null,
      configurationId: configurationId ?? null,
    };
    const scope = await validateLinkedVenue(db, request.user, links);
    if (!scope.ok) {
      return reply.status(scope.status).send({ error: scope.error, code: scope.code });
    }

    const artifact = generateGuestFlowReplayV0(parsed.data.input);
    const [existingReplay] = await db.select()
      .from(guestFlowReplays)
      .where(eq(guestFlowReplays.artifactHash, artifact.artifactHash))
      .limit(1);
    if (existingReplay !== undefined) {
      const existing = await assembleStoredReplay(db, existingReplay);
      if (existing !== null) return { data: existing };
    }

    const created = await db.transaction(async (tx) => {
      const [scenario] = await tx.insert(guestFlowScenarios).values({
        eventId: scope.eventId,
        phaseId: links.phaseId,
        configurationId: links.configurationId,
        name: parsed.data.name,
        scenarioType: artifact.scenarioType,
        status: "ready",
        seed: artifact.seed,
        assumptions: artifact.assumptions,
        inputPayload: parsed.data.input,
        createdBy: request.user.id,
      }).returning();
      if (scenario === undefined) throw new Error("guest-flow scenario insert returned no row");

      const [existingNavmesh] = await tx.select()
        .from(navmeshVersions)
        .where(eq(navmeshVersions.navmeshHash, artifact.navmesh.navmeshHash))
        .limit(1);
      const navmesh = existingNavmesh ?? (await tx.insert(navmeshVersions).values({
        eventId: scope.eventId,
        phaseId: links.phaseId,
        configurationId: links.configurationId,
        scenarioId: scenario.id,
        navmeshHash: artifact.navmesh.navmeshHash,
        inputHash: artifact.inputHash,
        algorithm: artifact.navmesh.algorithm,
        cellSizeM: String(artifact.navmesh.cellSizeM),
        agentRadiusM: String(artifact.navmesh.agentRadiusM),
        walkableCellCount: artifact.navmesh.walkableCellCount,
        blockedCellCount: artifact.navmesh.blockedCellCount,
        payload: artifact.navmesh,
        limitations: artifact.navmesh.limitations,
        createdBy: request.user.id,
      }).returning())[0];
      if (navmesh === undefined) throw new Error("navmesh insert returned no row");

      const [replay] = await tx.insert(guestFlowReplays).values({
        scenarioId: scenario.id,
        navmeshVersionId: navmesh.id,
        eventId: scope.eventId,
        phaseId: links.phaseId,
        configurationId: links.configurationId,
        scenarioType: artifact.scenarioType,
        status: artifact.evidenceStatus,
        simulatorSource: artifact.simulatorSource,
        seed: artifact.seed,
        inputHash: artifact.inputHash,
        artifactHash: artifact.artifactHash,
        snapshotHash: parsed.data.input.layout.snapshotHash,
        assumptions: artifact.assumptions,
        inputPayload: parsed.data.input,
        metrics: artifact.metrics,
        disclosureLabel: artifact.disclosureLabel,
        createdBy: request.user.id,
      }).returning();
      if (replay === undefined) throw new Error("guest-flow replay insert returned no row");

      if (artifact.trajectories.length > 0) {
        await tx.insert(agentTrajectories).values(artifact.trajectories.map((trajectory) => ({
          replayId: replay.id,
          agentId: trajectory.agentId,
          profile: trajectory.profile,
          spawnId: trajectory.spawnId,
          destinationId: trajectory.destinationId,
          points: trajectory.points,
        })));
      }

      await tx.insert(densityHeatmaps).values({
        replayId: replay.id,
        cellSizeM: String(artifact.densityHeatmap.cellSizeM),
        maxDensity: String(artifact.densityHeatmap.maxDensity),
        cells: artifact.densityHeatmap.cells,
      });

      if (artifact.routeConflicts.length > 0) {
        await tx.insert(routeConflicts).values(artifact.routeConflicts.map((conflict) => ({
          replayId: replay.id,
          conflictKey: conflict.id,
          conflictType: conflict.conflictType,
          severity: conflict.severity,
          point: conflict.point,
          involvedAgentIds: conflict.involvedAgentIds,
          message: conflict.message,
        })));
      }

      if (artifact.queueZones.length > 0) {
        await tx.insert(queueZones).values(artifact.queueZones.map((zone) => ({
          replayId: replay.id,
          zoneKey: zone.id,
          destinationId: zone.destinationId,
          label: zone.label,
          centre: zone.centre,
          estimatedAgents: zone.estimatedAgents,
        })));
      }

      if (artifact.staffLanes.length > 0) {
        await tx.insert(staffLanes).values(artifact.staffLanes.map((lane) => ({
          replayId: replay.id,
          laneKey: lane.id,
          label: lane.label,
          line: lane.line,
        })));
      }

      return GuestFlowReplayPersistenceResultSchema.parse({
        created: true,
        scenario: storedScenario(scenario),
        navmeshVersion: storedNavmesh(navmesh),
        replay: storedReplay(replay),
        artifact,
      });
    });

    return reply.status(201).send({ data: created });
  });

  server.get("/replays/latest", { preHandler: [authenticate] }, async (request, reply) => {
    const parsed = GuestFlowLatestReplayQuerySchema.safeParse(request.query);
    if (!parsed.success) {
      return reply.status(400).send({ error: "Invalid query", code: "VALIDATION_ERROR", details: parsed.error.issues });
    }

    const links = {
      eventId: parsed.data.eventId ?? null,
      phaseId: parsed.data.phaseId ?? null,
      configurationId: parsed.data.configurationId ?? null,
    };
    const scope = await validateLinkedVenue(db, request.user, links);
    if (!scope.ok) {
      return reply.status(scope.status).send({ error: scope.error, code: scope.code });
    }

    const conditions = [];
    if (scope.eventId !== null) conditions.push(eq(guestFlowReplays.eventId, scope.eventId));
    if (links.phaseId !== null) conditions.push(eq(guestFlowReplays.phaseId, links.phaseId));
    if (links.configurationId !== null) conditions.push(eq(guestFlowReplays.configurationId, links.configurationId));

    const rows = conditions.length === 0
      ? await db.select().from(guestFlowReplays).orderBy(desc(guestFlowReplays.createdAt)).limit(1)
      : await db.select().from(guestFlowReplays).where(and(...conditions)).orderBy(desc(guestFlowReplays.createdAt)).limit(1);
    const replay = rows[0];
    if (replay === undefined) {
      return reply.status(404).send({ error: "Guest-flow replay not found", code: "NOT_FOUND" });
    }

    const stored = await assembleStoredReplay(db, replay);
    if (stored === null) {
      return reply.status(500).send({ error: "Stored replay artifact is incomplete", code: "REPLAY_INCOMPLETE" });
    }
    return { data: stored };
  });

  server.get("/replays/:id", { preHandler: [authenticate] }, async (request, reply) => {
    const params = GuestFlowReplayIdSchema.safeParse((request.params as { id?: unknown }).id);
    if (!params.success) {
      return reply.status(400).send({ error: "Invalid replay ID", code: "VALIDATION_ERROR" });
    }

    const [replay] = await db.select()
      .from(guestFlowReplays)
      .where(eq(guestFlowReplays.id, params.data))
      .limit(1);
    if (replay === undefined) {
      return reply.status(404).send({ error: "Guest-flow replay not found", code: "NOT_FOUND" });
    }

    const scope = await validateLinkedVenue(db, request.user, {
      eventId: replay.eventId,
      phaseId: replay.phaseId,
      configurationId: replay.configurationId,
    });
    if (!scope.ok) {
      return reply.status(scope.status).send({ error: scope.error, code: scope.code });
    }

    const stored = await assembleStoredReplay(db, replay);
    if (stored === null) {
      return reply.status(500).send({ error: "Stored replay artifact is incomplete", code: "REPLAY_INCOMPLETE" });
    }
    return { data: stored };
  });
}
