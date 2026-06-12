import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { and, desc, eq, isNull } from "drizzle-orm";
import {
  CreateEventPhaseSchema,
  CreateEventScenarioSchema,
  CreateEventSchema,
  CreateLayoutVariantSchema,
  EventConfigurationLinkSchema,
  EventPhaseGraphSchema,
  EventPhaseSchema,
  EventScenarioSchema,
  EventSchema,
  LayoutVariantSchema,
  PhaseLayoutSnapshotSchema,
  UpdateEventPhaseSchema,
  UpdateEventSchema,
  defaultEventPhaseInputs,
  type Event,
  type EventConfigurationLink,
  type EventPhase,
  type EventPhaseGraph,
  type EventScenario,
  type LayoutVariant,
  type PhaseLayoutSnapshot,
} from "@omnitwin/types";
import { z } from "zod";
import {
  configurations,
  eventConfigurationLinks,
  eventPhases,
  eventScenarios,
  events,
  layoutVariants,
  phaseLayoutSnapshots,
} from "../db/schema.js";
import type { Database } from "../db/client.js";
import { authenticate } from "../middleware/auth.js";
import { canAccessResource } from "../utils/query.js";

type EventRow = typeof events.$inferSelect;
type EventPhaseRow = typeof eventPhases.$inferSelect;
type EventScenarioRow = typeof eventScenarios.$inferSelect;
type LayoutVariantRow = typeof layoutVariants.$inferSelect;
type EventConfigurationLinkRow = typeof eventConfigurationLinks.$inferSelect;
type PhaseLayoutSnapshotRow = typeof phaseLayoutSnapshots.$inferSelect;

const IdParam = z.object({ id: z.string().uuid() });
const EventIdParam = z.object({ id: z.string().uuid() });

function validationError(reply: FastifyReply, details: unknown): FastifyReply {
  return reply.status(400).send({
    error: "Validation failed",
    code: "VALIDATION_ERROR",
    details,
  });
}

function toIso(value: Date): string {
  return value.toISOString();
}

function toIsoOrNull(value: Date | null): string | null {
  return value === null ? null : value.toISOString();
}

function dateOrNull(value: string | null | undefined): Date | null {
  return value === undefined || value === null ? null : new Date(value);
}

function serializeEvent(row: EventRow): Event {
  return EventSchema.parse({
    id: row.id,
    venueId: row.venueId,
    createdBy: row.createdBy,
    name: row.name,
    eventType: row.eventType,
    status: row.status,
    startsAt: toIsoOrNull(row.startsAt),
    endsAt: toIsoOrNull(row.endsAt),
    guestCount: row.guestCount,
    clientName: row.clientName,
    notes: row.notes,
    createdAt: toIso(row.createdAt),
    updatedAt: toIso(row.updatedAt),
  });
}

function serializePhase(row: EventPhaseRow): EventPhase {
  return EventPhaseSchema.parse({
    id: row.id,
    eventId: row.eventId,
    templateKey: row.templateKey,
    name: row.name,
    sortOrder: row.sortOrder,
    startsAt: toIsoOrNull(row.startsAt),
    durationMinutes: row.durationMinutes,
    guestCount: row.guestCount,
    opsTasksCount: row.opsTasksCount,
    reviewGatesCount: row.reviewGatesCount,
    densityStatus: row.densityStatus,
    densityLabel: row.densityLabel,
    staffConflictsStatus: row.staffConflictsStatus,
    staffConflictsLabel: row.staffConflictsLabel,
    notes: row.notes,
    createdAt: toIso(row.createdAt),
    updatedAt: toIso(row.updatedAt),
  });
}

function serializeScenario(row: EventScenarioRow): EventScenario {
  return EventScenarioSchema.parse({
    id: row.id,
    eventId: row.eventId,
    phaseId: row.phaseId,
    name: row.name,
    status: row.status,
    assumptions: row.assumptions,
    seed: row.seed,
    createdAt: toIso(row.createdAt),
    updatedAt: toIso(row.updatedAt),
  });
}

function serializeLayoutVariant(row: LayoutVariantRow): LayoutVariant {
  return LayoutVariantSchema.parse({
    id: row.id,
    eventId: row.eventId,
    configurationId: row.configurationId,
    name: row.name,
    status: row.status,
    guestCount: row.guestCount,
    notes: row.notes,
    createdAt: toIso(row.createdAt),
    updatedAt: toIso(row.updatedAt),
  });
}

function serializeConfigurationLink(row: EventConfigurationLinkRow): EventConfigurationLink {
  return EventConfigurationLinkSchema.parse({
    id: row.id,
    eventId: row.eventId,
    configurationId: row.configurationId,
    layoutVariantId: row.layoutVariantId,
    linkType: row.linkType,
    createdAt: toIso(row.createdAt),
  });
}

function serializePhaseLayoutSnapshot(row: PhaseLayoutSnapshotRow): PhaseLayoutSnapshot {
  return PhaseLayoutSnapshotSchema.parse({
    id: row.id,
    eventPhaseId: row.eventPhaseId,
    layoutVariantId: row.layoutVariantId,
    configurationId: row.configurationId,
    snapshotHash: row.snapshotHash,
    status: row.status,
    objectCount: row.objectCount,
    guestCount: row.guestCount,
    payload: row.payload,
    createdAt: toIso(row.createdAt),
    frozenAt: toIsoOrNull(row.frozenAt),
  });
}

async function loadEvent(db: Database, id: string): Promise<EventRow | null> {
  const [row] = await db
    .select()
    .from(events)
    .where(and(eq(events.id, id), isNull(events.deletedAt)))
    .limit(1);
  return row ?? null;
}

async function buildPhaseGraph(db: Database, eventRow: EventRow): Promise<EventPhaseGraph> {
  const [phaseRows, scenarioRows, variantRows, linkRows, snapshotRows] = await Promise.all([
    db.select().from(eventPhases).where(eq(eventPhases.eventId, eventRow.id)).orderBy(eventPhases.sortOrder),
    db.select().from(eventScenarios).where(eq(eventScenarios.eventId, eventRow.id)).orderBy(eventScenarios.createdAt),
    db.select().from(layoutVariants).where(eq(layoutVariants.eventId, eventRow.id)).orderBy(layoutVariants.createdAt),
    db.select().from(eventConfigurationLinks).where(eq(eventConfigurationLinks.eventId, eventRow.id)).orderBy(eventConfigurationLinks.createdAt),
    db
      .select({ snapshot: phaseLayoutSnapshots })
      .from(phaseLayoutSnapshots)
      .innerJoin(eventPhases, eq(phaseLayoutSnapshots.eventPhaseId, eventPhases.id))
      .where(eq(eventPhases.eventId, eventRow.id))
      .orderBy(phaseLayoutSnapshots.createdAt),
  ]);

  return EventPhaseGraphSchema.parse({
    event: serializeEvent(eventRow),
    phases: phaseRows.map(serializePhase),
    scenarios: scenarioRows.map(serializeScenario),
    layoutVariants: variantRows.map(serializeLayoutVariant),
    configurationLinks: linkRows.map(serializeConfigurationLink),
    phaseLayoutSnapshots: snapshotRows.map((row) => serializePhaseLayoutSnapshot(row.snapshot)),
  });
}

async function requireEventAccess(
  db: Database,
  request: FastifyRequest,
  reply: FastifyReply,
  eventId: string,
): Promise<EventRow | null> {
  const eventRow = await loadEvent(db, eventId);
  if (eventRow === null) {
    void reply.status(404).send({ error: "Event not found", code: "NOT_FOUND" });
    return null;
  }
  if (!canAccessResource(request.user, eventRow.createdBy, eventRow.venueId)) {
    void reply.status(403).send({ error: "Insufficient permissions", code: "FORBIDDEN" });
    return null;
  }
  return eventRow;
}

export async function eventRoutes(server: FastifyInstance, opts: { db: Database }): Promise<void> {
  const { db } = opts;

  server.post("/", { preHandler: [authenticate] }, async (request, reply) => {
    const parsed = CreateEventSchema.safeParse(request.body);
    if (!parsed.success) return validationError(reply, parsed.error.issues);

    const created = await db.transaction(async (tx) => {
      const [eventRow] = await tx.insert(events).values({
        venueId: parsed.data.venueId,
        createdBy: request.user.id,
        name: parsed.data.name,
        eventType: parsed.data.eventType ?? null,
        status: parsed.data.status,
        startsAt: dateOrNull(parsed.data.startsAt),
        endsAt: dateOrNull(parsed.data.endsAt),
        guestCount: parsed.data.guestCount,
        clientName: parsed.data.clientName ?? null,
        notes: parsed.data.notes ?? null,
      }).returning();

      if (eventRow === undefined) return null;

      const defaultPhaseValues = defaultEventPhaseInputs().map((phase, index) => ({
        eventId: eventRow.id,
        templateKey: phase.templateKey,
        name: phase.name,
        sortOrder: index,
        startsAt: null,
        durationMinutes: phase.durationMinutes,
        guestCount: parsed.data.guestCount > 0 ? parsed.data.guestCount : null,
        opsTasksCount: phase.opsTasksCount,
        reviewGatesCount: phase.reviewGatesCount,
        densityStatus: "not_checked",
        densityLabel: "Density not checked",
        staffConflictsStatus: "not_checked",
        staffConflictsLabel: "Staff conflicts not checked",
        notes: phase.notes,
      }));
      await tx.insert(eventPhases).values(defaultPhaseValues);
      return eventRow;
    });

    if (created === null) {
      return reply.status(500).send({ error: "Failed to create event", code: "EVENT_CREATE_FAILED" });
    }

    return reply.status(201).send({ data: await buildPhaseGraph(db, created) });
  });

  server.get("/:id", { preHandler: [authenticate] }, async (request, reply) => {
    const params = IdParam.safeParse(request.params);
    if (!params.success) return validationError(reply, params.error.issues);
    const eventRow = await requireEventAccess(db, request, reply, params.data.id);
    if (eventRow === null) return;
    return { data: serializeEvent(eventRow) };
  });

  server.patch("/:id", { preHandler: [authenticate] }, async (request, reply) => {
    const params = IdParam.safeParse(request.params);
    if (!params.success) return validationError(reply, params.error.issues);
    const parsed = UpdateEventSchema.safeParse(request.body);
    if (!parsed.success) return validationError(reply, parsed.error.issues);
    const eventRow = await requireEventAccess(db, request, reply, params.data.id);
    if (eventRow === null) return;

    const [updated] = await db.update(events).set({
      name: parsed.data.name ?? eventRow.name,
      eventType: parsed.data.eventType === undefined ? eventRow.eventType : parsed.data.eventType,
      status: parsed.data.status ?? eventRow.status,
      startsAt: parsed.data.startsAt === undefined ? eventRow.startsAt : dateOrNull(parsed.data.startsAt),
      endsAt: parsed.data.endsAt === undefined ? eventRow.endsAt : dateOrNull(parsed.data.endsAt),
      guestCount: parsed.data.guestCount ?? eventRow.guestCount,
      clientName: parsed.data.clientName === undefined ? eventRow.clientName : parsed.data.clientName,
      notes: parsed.data.notes === undefined ? eventRow.notes : parsed.data.notes,
      updatedAt: new Date(),
    }).where(eq(events.id, eventRow.id)).returning();

    if (updated === undefined) {
      return reply.status(500).send({ error: "Failed to update event", code: "EVENT_UPDATE_FAILED" });
    }
    return { data: serializeEvent(updated) };
  });

  server.post("/:id/phases", { preHandler: [authenticate] }, async (request, reply) => {
    const params = EventIdParam.safeParse(request.params);
    if (!params.success) return validationError(reply, params.error.issues);
    const parsed = CreateEventPhaseSchema.safeParse(request.body);
    if (!parsed.success) return validationError(reply, parsed.error.issues);
    const eventRow = await requireEventAccess(db, request, reply, params.data.id);
    if (eventRow === null) return;

    const [lastPhase] = await db
      .select({ sortOrder: eventPhases.sortOrder })
      .from(eventPhases)
      .where(eq(eventPhases.eventId, eventRow.id))
      .orderBy(desc(eventPhases.sortOrder))
      .limit(1);

    const [phase] = await db.insert(eventPhases).values({
      eventId: eventRow.id,
      templateKey: parsed.data.templateKey ?? null,
      name: parsed.data.name,
      sortOrder: (lastPhase?.sortOrder ?? -1) + 1,
      startsAt: dateOrNull(parsed.data.startsAt),
      durationMinutes: parsed.data.durationMinutes,
      guestCount: parsed.data.guestCount ?? null,
      opsTasksCount: parsed.data.opsTasksCount,
      reviewGatesCount: parsed.data.reviewGatesCount,
      densityStatus: "not_checked",
      densityLabel: "Density not checked",
      staffConflictsStatus: "not_checked",
      staffConflictsLabel: "Staff conflicts not checked",
      notes: parsed.data.notes ?? null,
    }).returning();

    if (phase === undefined) {
      return reply.status(500).send({ error: "Failed to create event phase", code: "EVENT_PHASE_CREATE_FAILED" });
    }
    return reply.status(201).send({ data: serializePhase(phase) });
  });

  server.post("/:id/scenarios", { preHandler: [authenticate] }, async (request, reply) => {
    const params = EventIdParam.safeParse(request.params);
    if (!params.success) return validationError(reply, params.error.issues);
    const parsed = CreateEventScenarioSchema.safeParse(request.body);
    if (!parsed.success) return validationError(reply, parsed.error.issues);
    const eventRow = await requireEventAccess(db, request, reply, params.data.id);
    if (eventRow === null) return;

    const [scenario] = await db.insert(eventScenarios).values({
      eventId: eventRow.id,
      phaseId: parsed.data.phaseId ?? null,
      name: parsed.data.name,
      status: parsed.data.status,
      assumptions: parsed.data.assumptions,
      seed: parsed.data.seed ?? null,
    }).returning();

    if (scenario === undefined) {
      return reply.status(500).send({ error: "Failed to create event scenario", code: "EVENT_SCENARIO_CREATE_FAILED" });
    }
    return reply.status(201).send({ data: serializeScenario(scenario) });
  });

  server.post("/:id/layout-variants", { preHandler: [authenticate] }, async (request, reply) => {
    const params = EventIdParam.safeParse(request.params);
    if (!params.success) return validationError(reply, params.error.issues);
    const parsed = CreateLayoutVariantSchema.safeParse(request.body);
    if (!parsed.success) return validationError(reply, parsed.error.issues);
    const eventRow = await requireEventAccess(db, request, reply, params.data.id);
    if (eventRow === null) return;

    if (parsed.data.configurationId !== undefined && parsed.data.configurationId !== null) {
      const [config] = await db.select().from(configurations)
        .where(and(eq(configurations.id, parsed.data.configurationId), isNull(configurations.deletedAt)))
        .limit(1);
      if (config === undefined) {
        return reply.status(404).send({ error: "Configuration not found", code: "NOT_FOUND" });
      }
      if (!canAccessResource(request.user, config.userId, config.venueId)) {
        return reply.status(403).send({ error: "Insufficient permissions", code: "FORBIDDEN" });
      }
    }

    const created = await db.transaction(async (tx) => {
      const [variant] = await tx.insert(layoutVariants).values({
        eventId: eventRow.id,
        configurationId: parsed.data.configurationId ?? null,
        name: parsed.data.name,
        status: parsed.data.status,
        guestCount: parsed.data.guestCount ?? null,
        notes: parsed.data.notes ?? null,
      }).returning();
      if (variant === undefined) return null;

      if (parsed.data.configurationId !== undefined && parsed.data.configurationId !== null) {
        await tx.insert(eventConfigurationLinks).values({
          eventId: eventRow.id,
          configurationId: parsed.data.configurationId,
          layoutVariantId: variant.id,
          linkType: "variant_configuration",
        });
      }
      return variant;
    });

    if (created === null) {
      return reply.status(500).send({ error: "Failed to create layout variant", code: "LAYOUT_VARIANT_CREATE_FAILED" });
    }
    return reply.status(201).send({ data: serializeLayoutVariant(created) });
  });

  server.get("/:id/phase-graph", { preHandler: [authenticate] }, async (request, reply) => {
    const params = IdParam.safeParse(request.params);
    if (!params.success) return validationError(reply, params.error.issues);
    const eventRow = await requireEventAccess(db, request, reply, params.data.id);
    if (eventRow === null) return;
    return { data: await buildPhaseGraph(db, eventRow) };
  });
}

export async function eventPhaseRoutes(server: FastifyInstance, opts: { db: Database }): Promise<void> {
  const { db } = opts;

  server.patch("/:id", { preHandler: [authenticate] }, async (request, reply) => {
    const params = IdParam.safeParse(request.params);
    if (!params.success) return validationError(reply, params.error.issues);
    const parsed = UpdateEventPhaseSchema.safeParse(request.body);
    if (!parsed.success) return validationError(reply, parsed.error.issues);

    const [joined] = await db
      .select({ phase: eventPhases, event: events })
      .from(eventPhases)
      .innerJoin(events, eq(eventPhases.eventId, events.id))
      .where(and(eq(eventPhases.id, params.data.id), isNull(events.deletedAt)))
      .limit(1);

    if (joined === undefined) {
      return reply.status(404).send({ error: "Event phase not found", code: "NOT_FOUND" });
    }
    if (!canAccessResource(request.user, joined.event.createdBy, joined.event.venueId)) {
      return reply.status(403).send({ error: "Insufficient permissions", code: "FORBIDDEN" });
    }

    const [updated] = await db.update(eventPhases).set({
      name: parsed.data.name ?? joined.phase.name,
      startsAt: parsed.data.startsAt === undefined ? joined.phase.startsAt : dateOrNull(parsed.data.startsAt),
      durationMinutes: parsed.data.durationMinutes ?? joined.phase.durationMinutes,
      guestCount: parsed.data.guestCount === undefined ? joined.phase.guestCount : parsed.data.guestCount,
      opsTasksCount: parsed.data.opsTasksCount ?? joined.phase.opsTasksCount,
      reviewGatesCount: parsed.data.reviewGatesCount ?? joined.phase.reviewGatesCount,
      densityStatus: parsed.data.densityStatus ?? joined.phase.densityStatus,
      densityLabel: parsed.data.densityLabel ?? joined.phase.densityLabel,
      staffConflictsStatus: parsed.data.staffConflictsStatus ?? joined.phase.staffConflictsStatus,
      staffConflictsLabel: parsed.data.staffConflictsLabel ?? joined.phase.staffConflictsLabel,
      notes: parsed.data.notes === undefined ? joined.phase.notes : parsed.data.notes,
      updatedAt: new Date(),
    }).where(eq(eventPhases.id, params.data.id)).returning();

    if (updated === undefined) {
      return reply.status(500).send({ error: "Failed to update event phase", code: "EVENT_PHASE_UPDATE_FAILED" });
    }
    return { data: serializePhase(updated) };
  });
}
