import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { and, desc, eq, isNull, sql } from "drizzle-orm";
import { z } from "zod";
import {
  ComfortConstraintSchema,
  CreateRevenueScenarioSchema,
  PricingAssumptionSchema,
  RevenueScenarioBundleSchema,
  RevenueScenarioSchema,
  RoomUtilisationRowSchema,
  type ComfortConstraint,
  type PricingAssumption,
  type RevenueScenario,
} from "@omnitwin/types";
import type { Database } from "../db/client.js";
import {
  comfortConstraints,
  configurations,
  enquiries,
  events,
  pricingAssumptions,
  proposals,
  quotes,
  revenueScenarios,
  spaces,
} from "../db/schema.js";
import { authenticate, isPlatformAdmin } from "../middleware/auth.js";
import { canAccessInternalEvent, canWriteEvents } from "../utils/query.js";
import {
  buildPipelineSummary,
  buildRoomUtilisationRows,
  buildVenueDashboardAnalytics,
  summarizeRevenueScenarios,
} from "../services/revenue-analytics.js";

const IdParam = z.object({ id: z.string().uuid() });
const AnalyticsQuery = z.object({ venueId: z.string().uuid().optional() });

type RevenueScenarioRow = typeof revenueScenarios.$inferSelect;
type PricingAssumptionRow = typeof pricingAssumptions.$inferSelect;
type ComfortConstraintRow = typeof comfortConstraints.$inferSelect;

function validationError(reply: FastifyReply, details: unknown): FastifyReply {
  return reply.status(400).send({ error: "Validation failed", code: "VALIDATION_ERROR", details });
}

function toIso(value: Date): string {
  return value.toISOString();
}

function resolveVenueScope(
  request: FastifyRequest,
  reply: FastifyReply,
  requestedVenueId: string | undefined,
): string | null {
  const user = request.user;
  if (isPlatformAdmin(user)) {
    if (requestedVenueId === undefined) {
      void reply.status(400).send({
        error: "Admin analytics requests must provide venueId",
        code: "VENUE_REQUIRED",
      });
      return null;
    }
    return requestedVenueId;
  }
  if (user.venueId === null) {
    void reply.status(403).send({ error: "User has no venue scope", code: "FORBIDDEN" });
    return null;
  }
  // Preserve existing hallkeeper commercial reads (quotes/event summaries),
  // but neither customer role name grants venue-wide analytics authority.
  if (!canAccessInternalEvent(user, user.venueId)) {
    void reply.status(403).send({ error: "Insufficient permissions", code: "FORBIDDEN" });
    return null;
  }
  if (requestedVenueId !== undefined && requestedVenueId !== user.venueId) {
    void reply.status(403).send({ error: "Insufficient permissions", code: "FORBIDDEN" });
    return null;
  }
  return user.venueId;
}

function serializeScenario(row: RevenueScenarioRow): RevenueScenario {
  return RevenueScenarioSchema.parse({
    id: row.id,
    venueId: row.venueId,
    eventId: row.eventId,
    configurationId: row.configurationId,
    quoteId: row.quoteId,
    name: row.name,
    scenarioKind: row.scenarioKind,
    status: row.status,
    currency: row.currency,
    plannedGuestCount: row.plannedGuestCount,
    estimatedRevenueMinor: row.estimatedRevenueMinor,
    estimatedCostMinor: row.estimatedCostMinor,
    estimatedMarginMinor: row.estimatedMarginMinor,
    comfortStatus: row.comfortStatus,
    reviewGateCount: row.reviewGateCount,
    createdBy: row.createdBy,
    createdAt: toIso(row.createdAt),
    updatedAt: toIso(row.updatedAt),
  });
}

function serializePricingAssumption(row: PricingAssumptionRow): PricingAssumption {
  return PricingAssumptionSchema.parse({
    ...row.payload,
    id: row.id,
    revenueScenarioId: row.revenueScenarioId,
    createdAt: toIso(row.createdAt),
  });
}

function serializeComfortConstraint(row: ComfortConstraintRow): ComfortConstraint {
  return ComfortConstraintSchema.parse({
    ...row.payload,
    id: row.id,
    revenueScenarioId: row.revenueScenarioId,
    createdAt: toIso(row.createdAt),
  });
}

async function loadRevenueScenarioBundle(
  db: Database,
  scenarioRow: RevenueScenarioRow,
): Promise<z.infer<typeof RevenueScenarioBundleSchema>> {
  const [assumptions, constraints] = await Promise.all([
    db.select().from(pricingAssumptions).where(eq(pricingAssumptions.revenueScenarioId, scenarioRow.id)),
    db.select().from(comfortConstraints).where(eq(comfortConstraints.revenueScenarioId, scenarioRow.id)),
  ]);
  return RevenueScenarioBundleSchema.parse({
    scenario: serializeScenario(scenarioRow),
    pricingAssumptions: assumptions.map(serializePricingAssumption),
    comfortConstraints: constraints.map(serializeComfortConstraint),
  });
}

async function assertLinkedRecordsVenueCoherent(
  db: Database,
  input: {
    readonly venueId: string;
    readonly eventId?: string | null;
    readonly configurationId?: string | null;
    readonly quoteId?: string | null;
  },
): Promise<"ok" | "event" | "configuration" | "quote" | "venue_mismatch"> {
  if (input.eventId !== undefined && input.eventId !== null) {
    const [eventRow] = await db.select({ venueId: events.venueId })
      .from(events)
      .where(and(eq(events.id, input.eventId), isNull(events.deletedAt)))
      .limit(1);
    if (eventRow === undefined) return "event";
    if (eventRow.venueId !== input.venueId) return "venue_mismatch";
  }
  if (input.configurationId !== undefined && input.configurationId !== null) {
    const [configRow] = await db.select({ venueId: configurations.venueId })
      .from(configurations)
      .where(and(eq(configurations.id, input.configurationId), isNull(configurations.deletedAt)))
      .limit(1);
    if (configRow === undefined) return "configuration";
    if (configRow.venueId !== input.venueId) return "venue_mismatch";
  }
  if (input.quoteId !== undefined && input.quoteId !== null) {
    const [quoteRow] = await db.select({ venueId: quotes.venueId })
      .from(quotes)
      .where(and(eq(quotes.id, input.quoteId), isNull(quotes.deletedAt)))
      .limit(1);
    if (quoteRow === undefined) return "quote";
    if (quoteRow.venueId !== input.venueId) return "venue_mismatch";
  }
  return "ok";
}

export async function revenueScenarioRoutes(server: FastifyInstance, opts: { db: Database }): Promise<void> {
  const { db } = opts;

  server.post("/", { preHandler: [authenticate] }, async (request, reply) => {
    const parsed = CreateRevenueScenarioSchema.safeParse(request.body);
    if (!parsed.success) return validationError(reply, parsed.error.issues);
    if (!canWriteEvents(request.user, parsed.data.venueId)) {
      return reply.status(403).send({ error: "Insufficient permissions", code: "FORBIDDEN" });
    }

    const linked = await assertLinkedRecordsVenueCoherent(db, parsed.data);
    if (linked !== "ok") {
      const code = linked === "venue_mismatch" ? "VENUE_MISMATCH" : "NOT_FOUND";
      return reply.status(linked === "venue_mismatch" ? 422 : 404).send({
        error: linked === "venue_mismatch" ? "Linked record belongs to a different venue" : `Linked ${linked} not found`,
        code,
      });
    }

    const created = await db.transaction(async (tx) => {
      const [scenario] = await tx.insert(revenueScenarios).values({
        venueId: parsed.data.venueId,
        eventId: parsed.data.eventId ?? null,
        configurationId: parsed.data.configurationId ?? null,
        quoteId: parsed.data.quoteId ?? null,
        name: parsed.data.name,
        scenarioKind: parsed.data.scenarioKind,
        status: "draft",
        currency: parsed.data.currency,
        plannedGuestCount: parsed.data.plannedGuestCount,
        estimatedRevenueMinor: parsed.data.estimatedRevenueMinor,
        estimatedCostMinor: parsed.data.estimatedCostMinor,
        estimatedMarginMinor: parsed.data.estimatedRevenueMinor - parsed.data.estimatedCostMinor,
        comfortStatus: parsed.data.comfortStatus,
        reviewGateCount: parsed.data.reviewGateCount,
        createdBy: request.user.id,
      }).returning();
      if (scenario === undefined) return null;

      if (parsed.data.pricingAssumptions.length > 0) {
        await tx.insert(pricingAssumptions).values(parsed.data.pricingAssumptions.map((assumption) => ({
          revenueScenarioId: scenario.id,
          key: assumption.key,
          label: assumption.label,
          valueMinor: assumption.valueMinor ?? null,
          valueNumber: assumption.valueNumber === undefined || assumption.valueNumber === null
            ? null
            : assumption.valueNumber.toString(),
          valueText: assumption.valueText ?? null,
          source: assumption.source,
          payload: assumption,
        })));
      }

      if (parsed.data.comfortConstraints.length > 0) {
        await tx.insert(comfortConstraints).values(parsed.data.comfortConstraints.map((constraint) => ({
          revenueScenarioId: scenario.id,
          constraintType: constraint.constraintType,
          label: constraint.label,
          threshold: constraint.threshold === undefined || constraint.threshold === null ? null : constraint.threshold.toString(),
          actualValue: constraint.actualValue === undefined || constraint.actualValue === null ? null : constraint.actualValue.toString(),
          status: constraint.status,
          reviewRequired: constraint.reviewRequired,
          note: constraint.note ?? null,
          payload: constraint,
        })));
      }

      return scenario;
    });

    if (created === null) {
      return reply.status(500).send({ error: "Failed to create revenue scenario", code: "REVENUE_SCENARIO_CREATE_FAILED" });
    }
    return reply.status(201).send({ data: await loadRevenueScenarioBundle(db, created) });
  });
}

export async function eventRevenueRoutes(server: FastifyInstance, opts: { db: Database }): Promise<void> {
  const { db } = opts;

  server.get("/:id/revenue-summary", { preHandler: [authenticate] }, async (request, reply) => {
    const params = IdParam.safeParse(request.params);
    if (!params.success) return validationError(reply, params.error.issues);
    const [eventRow] = await db.select().from(events)
      .where(and(eq(events.id, params.data.id), isNull(events.deletedAt)))
      .limit(1);
    if (eventRow === undefined) {
      return reply.status(404).send({ error: "Event not found", code: "NOT_FOUND" });
    }
    if (!canAccessInternalEvent(request.user, eventRow.venueId)) {
      return reply.status(403).send({ error: "Insufficient permissions", code: "FORBIDDEN" });
    }

    const scenarioRows = await db.select()
      .from(revenueScenarios)
      .where(eq(revenueScenarios.eventId, eventRow.id))
      .orderBy(desc(revenueScenarios.updatedAt));
    return { data: summarizeRevenueScenarios({ eventId: eventRow.id, scenarios: scenarioRows.map(serializeScenario) }) };
  });
}

export async function analyticsRoutes(server: FastifyInstance, opts: { db: Database }): Promise<void> {
  const { db } = opts;

  server.get("/pipeline-summary", { preHandler: [authenticate] }, async (request, reply) => {
    const query = AnalyticsQuery.safeParse(request.query);
    if (!query.success) return validationError(reply, query.error.issues);
    const venueId = resolveVenueScope(request, reply, query.data.venueId);
    if (venueId === null) return;
    const pipeline = await loadPipelineSummary(db, venueId);
    return { data: pipeline };
  });

  server.get("/room-utilisation", { preHandler: [authenticate] }, async (request, reply) => {
    const query = AnalyticsQuery.safeParse(request.query);
    if (!query.success) return validationError(reply, query.error.issues);
    const venueId = resolveVenueScope(request, reply, query.data.venueId);
    if (venueId === null) return;
    const rows = await loadRoomUtilisation(db, venueId);
    return { data: rows };
  });

  server.get("/venue-dashboard", { preHandler: [authenticate] }, async (request, reply) => {
    const query = AnalyticsQuery.safeParse(request.query);
    if (!query.success) return validationError(reply, query.error.issues);
    const venueId = resolveVenueScope(request, reply, query.data.venueId);
    if (venueId === null) return;
    const [pipeline, roomUtilisation, scenarioRows, constraintRows] = await Promise.all([
      loadPipelineSummary(db, venueId),
      loadRoomUtilisation(db, venueId),
      db.select().from(revenueScenarios).where(eq(revenueScenarios.venueId, venueId)).orderBy(desc(revenueScenarios.updatedAt)).limit(8),
      db
        .select({ constraint: comfortConstraints })
        .from(comfortConstraints)
        .innerJoin(revenueScenarios, eq(comfortConstraints.revenueScenarioId, revenueScenarios.id))
        .where(eq(revenueScenarios.venueId, venueId))
        .limit(20),
    ]);
    return {
      data: buildVenueDashboardAnalytics({
        generatedAt: new Date().toISOString(),
        pipeline,
        roomUtilisation,
        revenueScenarios: scenarioRows.map(serializeScenario),
        comfortConstraints: constraintRows.map((row) => serializeComfortConstraint(row.constraint)),
      }),
    };
  });
}

// Counted and summed in PostgreSQL: the dashboard needs a venue's totals, not
// every quote, proposal, enquiry and layout row it used to read.
async function loadPipelineSummary(db: Database, venueId: string) {
  const [[quoteTotal], proposalRows, [enquiryTotal]] = await Promise.all([
    db.select({ totalMinor: sql<number>`coalesce(sum(${quotes.totalMinor}), 0)`.mapWith(Number) })
      .from(quotes).where(and(eq(quotes.venueId, venueId), isNull(quotes.deletedAt))),
    db.select({ status: proposals.status, count: sql<number>`count(*)`.mapWith(Number) })
      .from(proposals).where(and(eq(proposals.venueId, venueId), isNull(proposals.deletedAt)))
      .groupBy(proposals.status).orderBy(proposals.status),
    db.select({ count: sql<number>`count(*)`.mapWith(Number) }).from(enquiries).where(eq(enquiries.venueId, venueId)),
  ]);
  return buildPipelineSummary({
    pipelineValueMinor: quoteTotal?.totalMinor ?? 0,
    enquiryCount: enquiryTotal?.count ?? 0,
    proposalStatusCounts: Object.fromEntries(proposalRows.map((row) => [row.status, row.count])),
  });
}

async function loadRoomUtilisation(db: Database, venueId: string): Promise<readonly z.infer<typeof RoomUtilisationRowSchema>[]> {
  const [roomRows, quoteRows, bottleneckRows] = await Promise.all([
    db.select({ spaceId: spaces.id, roomName: spaces.name }).from(spaces).where(and(eq(spaces.venueId, venueId), isNull(spaces.deletedAt))),
    db.select({
      spaceId: quotes.spaceId,
      proposed: sql<number>`count(*)`.mapWith(Number),
      booked: sql<number>`count(*) filter (where ${quotes.status} = 'accepted')`.mapWith(Number),
    }).from(quotes).where(and(eq(quotes.venueId, venueId), isNull(quotes.deletedAt))).groupBy(quotes.spaceId),
    // A scenario's review gates count against its layout's room; the layout
    // must belong to this venue (a soft-deleted layout still counts).
    db.select({
      spaceId: configurations.spaceId,
      reviewGateCount: sql<number>`sum(${revenueScenarios.reviewGateCount})`.mapWith(Number),
    }).from(revenueScenarios)
      .innerJoin(configurations, and(
        eq(configurations.id, revenueScenarios.configurationId),
        eq(configurations.venueId, venueId),
      ))
      .where(eq(revenueScenarios.venueId, venueId))
      .groupBy(configurations.spaceId),
  ]);

  return buildRoomUtilisationRows({
    rooms: roomRows.length > 0 ? roomRows : [{ spaceId: null, roomName: "Unassigned room" }],
    quotesBySpaceId: new Map(quoteRows.map((row) => [row.spaceId, { proposed: row.proposed, booked: row.booked }])),
    reviewBottlenecksBySpaceId: new Map(bottleneckRows.map((row) => [row.spaceId, row.reviewGateCount])),
  });
}
