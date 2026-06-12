import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { and, eq, inArray, isNull, sql } from "drizzle-orm";
import {
  CreateActivitySchema,
  CreateFollowUpTaskSchema,
  CreateOpportunitySchema,
  OPPORTUNITY_STAGES,
  UpdateFollowUpTaskSchema,
  UpdateOpportunitySchema,
  isValidOpportunityStageTransition,
  type OpportunityStage,
} from "@omnitwin/types";
import {
  activities,
  clientAccounts,
  contacts,
  enquiries,
  followUpTasks,
  opportunities,
  opportunityStatusHistory,
  proposals,
} from "../db/schema.js";
import type { Database } from "../db/client.js";
import { authenticate, type JwtUser } from "../middleware/auth.js";
import { paginate } from "../utils/pagination.js";

const IdParam = z.object({ id: z.string().uuid() });
const TaskParam = z.object({ id: z.string().uuid(), taskId: z.string().uuid() });
const ListQuery = z.object({
  stage: z.enum(OPPORTUNITY_STAGES).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
  offset: z.coerce.number().int().min(0).default(0),
});

function canManageCommercial(user: JwtUser, venueId: string): boolean {
  if (user.role === "admin") return true;
  return user.role === "staff" && user.venueId === venueId;
}

function commercialScope(user: JwtUser): { ok: true; venueId: string | null } | { ok: false } {
  if (user.role === "admin") return { ok: true, venueId: null };
  if (user.role === "staff" && user.venueId !== null) return { ok: true, venueId: user.venueId };
  return { ok: false };
}

function nextActionForStage(stage: OpportunityStage): string {
  switch (stage) {
    case "new":
      return "Qualify the enquiry and confirm the client, date, room, and rough guest count.";
    case "qualified":
      return "Prepare a proposal draft with planning-grade assumptions for review.";
    case "proposal_drafting":
      return "Save a proposal version and prepare the client share link.";
    case "proposal_sent":
      return "Wait for the client response and log any requested changes.";
    case "negotiation":
      return "Resolve quote or package changes before confirming the opportunity.";
    case "won":
      return "Prepare the handoff path after proposal acceptance.";
    case "lost":
      return "Record the reason and archive when follow-up is complete.";
    case "archived":
      return "No next action.";
  }
}

function isoToDate(value: string | null | undefined): Date | null {
  if (value === undefined || value === null) return null;
  return new Date(value);
}

async function linkedRecordVenue(
  db: Database,
  kind: "clientAccount" | "contact" | "enquiry",
  id: string,
): Promise<string | null> {
  if (kind === "clientAccount") {
    const [row] = await db.select({ venueId: clientAccounts.venueId })
      .from(clientAccounts)
      .where(and(eq(clientAccounts.id, id), isNull(clientAccounts.deletedAt)))
      .limit(1);
    return row?.venueId ?? null;
  }
  if (kind === "contact") {
    const [row] = await db.select({ venueId: contacts.venueId })
      .from(contacts)
      .where(and(eq(contacts.id, id), isNull(contacts.deletedAt)))
      .limit(1);
    return row?.venueId ?? null;
  }
  const [row] = await db.select({ venueId: enquiries.venueId })
    .from(enquiries)
    .where(eq(enquiries.id, id))
    .limit(1);
  return row?.venueId ?? null;
}

async function validateOptionalLink(
  db: Database,
  value: string | null | undefined,
  venueId: string,
  kind: "clientAccount" | "contact" | "enquiry",
): Promise<"ok" | "not_found" | "venue_mismatch"> {
  if (value === undefined || value === null) return "ok";
  const linkedVenue = await linkedRecordVenue(db, kind, value);
  if (linkedVenue === null) return "not_found";
  return linkedVenue === venueId ? "ok" : "venue_mismatch";
}

export async function opportunityRoutes(
  server: FastifyInstance,
  opts: { db: Database },
): Promise<void> {
  const { db } = opts;

  server.get("/", { preHandler: [authenticate] }, async (request, reply) => {
    const scope = commercialScope(request.user);
    if (!scope.ok) {
      return reply.status(403).send({ error: "Only venue staff or admin can view opportunities", code: "FORBIDDEN" });
    }
    const parsed = ListQuery.safeParse(request.query);
    if (!parsed.success) {
      return reply.status(400).send({ error: "Invalid query", code: "VALIDATION_ERROR", details: parsed.error.issues });
    }

    const conditions = [isNull(opportunities.deletedAt)];
    if (scope.venueId !== null) conditions.push(eq(opportunities.venueId, scope.venueId));
    if (parsed.data.stage !== undefined) conditions.push(eq(opportunities.stage, parsed.data.stage));
    const where = and(...conditions);

    const [countRow] = await db.select({ count: sql<number>`count(*)::int` }).from(opportunities).where(where);
    const rows = await db.select()
      .from(opportunities)
      .where(where)
      .limit(parsed.data.limit)
      .offset(parsed.data.offset)
      .orderBy(opportunities.updatedAt);

    return paginate(rows, countRow?.count ?? 0, { limit: parsed.data.limit, offset: parsed.data.offset });
  });

  server.post("/", { preHandler: [authenticate] }, async (request, reply) => {
    const parsed = CreateOpportunitySchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: "Validation failed", code: "VALIDATION_ERROR", details: parsed.error.issues });
    }
    if (!canManageCommercial(request.user, parsed.data.venueId)) {
      return reply.status(403).send({ error: "Only venue staff or admin can create opportunities for this venue", code: "FORBIDDEN" });
    }

    for (const [kind, value] of [
      ["clientAccount", parsed.data.clientAccountId],
      ["contact", parsed.data.primaryContactId],
      ["enquiry", parsed.data.sourceEnquiryId],
    ] as const) {
      const linkStatus = await validateOptionalLink(db, value, parsed.data.venueId, kind);
      if (linkStatus === "not_found") {
        return reply.status(404).send({ error: `${kind} not found`, code: "NOT_FOUND" });
      }
      if (linkStatus === "venue_mismatch") {
        return reply.status(422).send({ error: `${kind} belongs to a different venue`, code: "VENUE_MISMATCH" });
      }
    }

    const created = await db.transaction(async (tx) => {
      const nextAction = parsed.data.nextAction ?? nextActionForStage("new");
      const [opportunity] = await tx.insert(opportunities).values({
        venueId: parsed.data.venueId,
        clientAccountId: parsed.data.clientAccountId ?? null,
        primaryContactId: parsed.data.primaryContactId ?? null,
        sourceEnquiryId: parsed.data.sourceEnquiryId ?? null,
        ownerUserId: request.user.id,
        title: parsed.data.title,
        stage: "new",
        eventType: parsed.data.eventType ?? null,
        preferredDate: parsed.data.preferredDate ?? null,
        guestCount: parsed.data.guestCount ?? null,
        estimatedValueMinor: parsed.data.estimatedValueMinor ?? 0,
        currency: parsed.data.currency,
        nextAction,
        nextActionDueAt: isoToDate(parsed.data.nextActionDueAt),
      }).returning();
      if (opportunity === undefined) throw new Error("opportunity insert returned no row");

      await tx.insert(opportunityStatusHistory).values({
        opportunityId: opportunity.id,
        fromStage: "new",
        toStage: "new",
        changedBy: request.user.id,
        note: "Created manually",
      });

      const [task] = await tx.insert(followUpTasks).values({
        opportunityId: opportunity.id,
        assignedTo: request.user.id,
        title: nextAction,
        dueAt: isoToDate(parsed.data.nextActionDueAt),
        status: "open",
      }).returning();

      return { opportunity, task: task ?? null };
    });

    return reply.status(201).send({ data: created });
  });

  server.get("/:id", { preHandler: [authenticate] }, async (request, reply) => {
    const params = IdParam.safeParse(request.params);
    if (!params.success) return reply.status(400).send({ error: "Invalid ID", code: "VALIDATION_ERROR" });

    const [opportunity] = await db.select().from(opportunities)
      .where(and(eq(opportunities.id, params.data.id), isNull(opportunities.deletedAt)))
      .limit(1);
    if (opportunity === undefined) return reply.status(404).send({ error: "Opportunity not found", code: "NOT_FOUND" });
    if (!canManageCommercial(request.user, opportunity.venueId)) {
      return reply.status(403).send({ error: "Insufficient permissions", code: "FORBIDDEN" });
    }

    const opportunityActivities = await db.select()
      .from(activities)
      .where(eq(activities.opportunityId, opportunity.id))
      .orderBy(activities.createdAt)
      .limit(100);
    const tasks = await db.select()
      .from(followUpTasks)
      .where(eq(followUpTasks.opportunityId, opportunity.id))
      .orderBy(followUpTasks.createdAt)
      .limit(100);
    const linkedProposals = await db.select()
      .from(proposals)
      .where(and(eq(proposals.opportunityId, opportunity.id), isNull(proposals.deletedAt)))
      .orderBy(proposals.updatedAt)
      .limit(50);

    return { data: { opportunity, activities: opportunityActivities, tasks, proposals: linkedProposals } };
  });

  server.patch("/:id", { preHandler: [authenticate] }, async (request, reply) => {
    const params = IdParam.safeParse(request.params);
    if (!params.success) return reply.status(400).send({ error: "Invalid ID", code: "VALIDATION_ERROR" });
    const parsed = UpdateOpportunitySchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: "Validation failed", code: "VALIDATION_ERROR", details: parsed.error.issues });
    }

    const [opportunity] = await db.select().from(opportunities)
      .where(and(eq(opportunities.id, params.data.id), isNull(opportunities.deletedAt)))
      .limit(1);
    if (opportunity === undefined) return reply.status(404).send({ error: "Opportunity not found", code: "NOT_FOUND" });
    if (!canManageCommercial(request.user, opportunity.venueId)) {
      return reply.status(403).send({ error: "Insufficient permissions", code: "FORBIDDEN" });
    }

    for (const [kind, value] of [
      ["clientAccount", parsed.data.clientAccountId],
      ["contact", parsed.data.primaryContactId],
      ["enquiry", parsed.data.sourceEnquiryId],
    ] as const) {
      const linkStatus = await validateOptionalLink(db, value, opportunity.venueId, kind);
      if (linkStatus === "not_found") return reply.status(404).send({ error: `${kind} not found`, code: "NOT_FOUND" });
      if (linkStatus === "venue_mismatch") return reply.status(422).send({ error: `${kind} belongs to a different venue`, code: "VENUE_MISMATCH" });
    }

    const fromStage = opportunity.stage as OpportunityStage;
    const toStage = parsed.data.stage;
    if (toStage !== undefined && toStage !== fromStage && request.user.role !== "admin" && !isValidOpportunityStageTransition(fromStage, toStage)) {
      return reply.status(422).send({ error: `Cannot transition opportunity from ${fromStage} to ${toStage}`, code: "INVALID_TRANSITION" });
    }

    const updateData: Partial<typeof opportunities.$inferInsert> = { updatedAt: new Date() };
    if (parsed.data.title !== undefined) updateData.title = parsed.data.title;
    if (parsed.data.clientAccountId !== undefined) updateData.clientAccountId = parsed.data.clientAccountId;
    if (parsed.data.primaryContactId !== undefined) updateData.primaryContactId = parsed.data.primaryContactId;
    if (parsed.data.sourceEnquiryId !== undefined) updateData.sourceEnquiryId = parsed.data.sourceEnquiryId;
    if (parsed.data.eventType !== undefined) updateData.eventType = parsed.data.eventType;
    if (parsed.data.preferredDate !== undefined) updateData.preferredDate = parsed.data.preferredDate;
    if (parsed.data.guestCount !== undefined) updateData.guestCount = parsed.data.guestCount;
    if (parsed.data.estimatedValueMinor !== undefined) updateData.estimatedValueMinor = parsed.data.estimatedValueMinor;
    if (parsed.data.currency !== undefined) updateData.currency = parsed.data.currency;
    if (parsed.data.nextAction !== undefined) updateData.nextAction = parsed.data.nextAction;
    if (parsed.data.nextActionDueAt !== undefined) updateData.nextActionDueAt = isoToDate(parsed.data.nextActionDueAt);
    if (toStage !== undefined) {
      updateData.stage = toStage;
      if (toStage === "won" || toStage === "lost") updateData.closedAt = new Date();
      if (parsed.data.nextAction === undefined) updateData.nextAction = nextActionForStage(toStage);
    }

    const [updated] = await db.update(opportunities)
      .set(updateData)
      .where(eq(opportunities.id, opportunity.id))
      .returning();
    if (updated === undefined) return reply.status(404).send({ error: "Opportunity not found", code: "NOT_FOUND" });

    if (toStage !== undefined && toStage !== fromStage) {
      await db.insert(opportunityStatusHistory).values({
        opportunityId: opportunity.id,
        fromStage,
        toStage,
        changedBy: request.user.id,
        note: parsed.data.note ?? null,
      });
    }

    return { data: updated };
  });

  server.post("/:id/activities", { preHandler: [authenticate] }, async (request, reply) => {
    const params = IdParam.safeParse(request.params);
    if (!params.success) return reply.status(400).send({ error: "Invalid ID", code: "VALIDATION_ERROR" });
    const parsed = CreateActivitySchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: "Validation failed", code: "VALIDATION_ERROR", details: parsed.error.issues });
    }

    const [opportunity] = await db.select({ venueId: opportunities.venueId }).from(opportunities)
      .where(and(eq(opportunities.id, params.data.id), isNull(opportunities.deletedAt)))
      .limit(1);
    if (opportunity === undefined) return reply.status(404).send({ error: "Opportunity not found", code: "NOT_FOUND" });
    if (!canManageCommercial(request.user, opportunity.venueId)) return reply.status(403).send({ error: "Insufficient permissions", code: "FORBIDDEN" });

    const [activity] = await db.insert(activities).values({
      opportunityId: params.data.id,
      type: parsed.data.type,
      body: parsed.data.body,
      createdBy: request.user.id,
    }).returning();
    return reply.status(201).send({ data: activity });
  });

  server.post("/:id/tasks", { preHandler: [authenticate] }, async (request, reply) => {
    const params = IdParam.safeParse(request.params);
    if (!params.success) return reply.status(400).send({ error: "Invalid ID", code: "VALIDATION_ERROR" });
    const parsed = CreateFollowUpTaskSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: "Validation failed", code: "VALIDATION_ERROR", details: parsed.error.issues });
    }

    const [opportunity] = await db.select({ venueId: opportunities.venueId }).from(opportunities)
      .where(and(eq(opportunities.id, params.data.id), isNull(opportunities.deletedAt)))
      .limit(1);
    if (opportunity === undefined) return reply.status(404).send({ error: "Opportunity not found", code: "NOT_FOUND" });
    if (!canManageCommercial(request.user, opportunity.venueId)) return reply.status(403).send({ error: "Insufficient permissions", code: "FORBIDDEN" });

    const [task] = await db.insert(followUpTasks).values({
      opportunityId: params.data.id,
      assignedTo: parsed.data.assignedTo ?? request.user.id,
      title: parsed.data.title,
      dueAt: isoToDate(parsed.data.dueAt),
      status: "open",
    }).returning();
    return reply.status(201).send({ data: task });
  });

  server.patch("/:id/tasks/:taskId", { preHandler: [authenticate] }, async (request, reply) => {
    const params = TaskParam.safeParse(request.params);
    if (!params.success) return reply.status(400).send({ error: "Invalid ID", code: "VALIDATION_ERROR" });
    const parsed = UpdateFollowUpTaskSchema.safeParse(request.body);
    if (!parsed.success) return reply.status(400).send({ error: "Validation failed", code: "VALIDATION_ERROR", details: parsed.error.issues });

    const [opportunity] = await db.select({ venueId: opportunities.venueId }).from(opportunities)
      .where(and(eq(opportunities.id, params.data.id), isNull(opportunities.deletedAt)))
      .limit(1);
    if (opportunity === undefined) return reply.status(404).send({ error: "Opportunity not found", code: "NOT_FOUND" });
    if (!canManageCommercial(request.user, opportunity.venueId)) return reply.status(403).send({ error: "Insufficient permissions", code: "FORBIDDEN" });

    const completedAt = parsed.data.status === "done" ? new Date() : null;
    const [task] = await db.update(followUpTasks)
      .set({ status: parsed.data.status, completedAt, updatedAt: new Date() })
      .where(and(
        eq(followUpTasks.id, params.data.taskId),
        eq(followUpTasks.opportunityId, params.data.id),
        inArray(followUpTasks.status, ["open", "done", "cancelled"]),
      ))
      .returning();
    if (task === undefined) return reply.status(404).send({ error: "Task not found", code: "NOT_FOUND" });
    return { data: task };
  });
}
