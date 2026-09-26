import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { and, asc, desc, eq, inArray, isNull, sql } from "drizzle-orm";
import {
  OPPORTUNITY_STAGES,
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
} from "../db/schema.js";
import type { Database } from "../db/client.js";
import { authenticate, isPlatformAdmin, type JwtUser } from "../middleware/auth.js";
import { canManageCommercial } from "../utils/query.js";
import { PIPELINE_VALUE_CURRENCY, loadPipelineValueMinor } from "../services/commercial-pipeline.js";

const IdParam = {
  schema: {
    params: {
      type: "object",
      required: ["enquiryId"],
      properties: { enquiryId: { type: "string", format: "uuid" } },
    },
  },
} as const;

/**
 * Resolve the venue this actor may read the commercial board for: null means
 * platform-wide. The local predicate this replaces admitted `staff` only, so
 * a venue's own ADMIN was 403'd on their own pipeline. Authority now comes
 * from the shared capability helper, which is the one place a role is added.
 */
function commercialScope(user: JwtUser): { ok: true; venueId: string | null } | { ok: false } {
  if (isPlatformAdmin(user)) return { ok: true, venueId: null };
  if (user.venueId !== null && canManageCommercial(user, user.venueId)) {
    return { ok: true, venueId: user.venueId };
  }
  return { ok: false };
}

// Real pagination for the pipeline board: a bounded page plus the unbounded
// total, so the client can say "50 of 312" instead of silently truncating at
// a hard-coded 200 as this route used to.
const PipelineQuery = z.object({
  limit: z.coerce.number().int().min(1).max(200).default(50),
  offset: z.coerce.number().int().min(0).default(0),
  taskLimit: z.coerce.number().int().min(1).max(200).default(50),
  taskOffset: z.coerce.number().int().min(0).default(0),
});

function tomorrowAtNoon(): Date {
  const due = new Date();
  due.setUTCDate(due.getUTCDate() + 1);
  due.setUTCHours(12, 0, 0, 0);
  return due;
}

/** Folds a SQL `GROUP BY stage` result into the full stage vocabulary, so a
 *  stage with no rows still reports 0 rather than being absent. */
function buildStageCounts(rows: readonly { stage: string; count: number }[]): Record<OpportunityStage, number> {
  const counts = Object.fromEntries(OPPORTUNITY_STAGES.map((stage) => [stage, 0])) as Record<OpportunityStage, number>;
  for (const row of rows) {
    if ((OPPORTUNITY_STAGES as readonly string[]).includes(row.stage)) {
      counts[row.stage as OpportunityStage] += row.count;
    }
  }
  return counts;
}

export async function crmRoutes(
  server: FastifyInstance,
  opts: { db: Database },
): Promise<void> {
  const { db } = opts;

  server.post("/from-enquiry/:enquiryId", { preHandler: [authenticate], ...IdParam }, async (request, reply) => {
    const params = request.params as { enquiryId: string };

    const [enquiry] = await db.select().from(enquiries).where(eq(enquiries.id, params.enquiryId)).limit(1);
    if (enquiry === undefined) {
      return reply.status(404).send({ error: "Enquiry not found", code: "NOT_FOUND" });
    }
    if (!canManageCommercial(request.user, enquiry.venueId)) {
      return reply.status(403).send({ error: "Only the venue commercial team can create opportunities from enquiries", code: "FORBIDDEN" });
    }

    const [existing] = await db.select()
      .from(opportunities)
      .where(and(eq(opportunities.sourceEnquiryId, enquiry.id), isNull(opportunities.deletedAt)))
      .limit(1);

    if (existing !== undefined) {
      return {
        data: {
          created: false,
          opportunity: existing,
          clientAccount: null,
          contact: null,
          followUpTask: null,
        },
      };
    }

    const clientName = enquiry.guestName ?? enquiry.name;
    const clientEmail = enquiry.guestEmail ?? enquiry.email;
    const clientPhone = enquiry.guestPhone;
    const eventLabel = enquiry.eventType ?? "Event";

    const created = await db.transaction(async (tx) => {
      const [account] = await tx.insert(clientAccounts).values({
        venueId: enquiry.venueId,
        name: clientName,
        accountType: "event_client",
        sourceEnquiryId: enquiry.id,
        createdBy: request.user.id,
      }).returning();
      if (account === undefined) throw new Error("client account insert returned no row");

      const [contact] = await tx.insert(contacts).values({
        venueId: enquiry.venueId,
        clientAccountId: account.id,
        name: clientName,
        email: clientEmail,
        phone: clientPhone,
        roleLabel: "Primary event contact",
        sourceEnquiryId: enquiry.id,
      }).returning();
      if (contact === undefined) throw new Error("contact insert returned no row");

      await tx.update(clientAccounts)
        .set({ primaryContactId: contact.id, updatedAt: new Date() })
        .where(eq(clientAccounts.id, account.id));

      const [opportunity] = await tx.insert(opportunities).values({
        venueId: enquiry.venueId,
        clientAccountId: account.id,
        primaryContactId: contact.id,
        sourceEnquiryId: enquiry.id,
        ownerUserId: request.user.id,
        title: `${eventLabel} — ${clientName}`,
        stage: "new",
        eventType: enquiry.eventType,
        preferredDate: enquiry.preferredDate,
        guestCount: enquiry.estimatedGuests,
        estimatedValueMinor: 0,
        currency: "GBP",
        nextAction: "Prepare a proposal draft and confirm room, date, and guest-count assumptions with the client.",
        nextActionDueAt: tomorrowAtNoon(),
      }).returning();
      if (opportunity === undefined) throw new Error("opportunity insert returned no row");

      await tx.insert(activities).values({
        opportunityId: opportunity.id,
        type: "system",
        body: "Opportunity created from enquiry. Planning details still require venue-team review.",
        createdBy: request.user.id,
      });

      await tx.insert(opportunityStatusHistory).values({
        opportunityId: opportunity.id,
        fromStage: "new",
        toStage: "new",
        changedBy: request.user.id,
        note: "Created from enquiry",
      });

      const [followUpTask] = await tx.insert(followUpTasks).values({
        opportunityId: opportunity.id,
        assignedTo: request.user.id,
        title: "Draft proposal and confirm planning assumptions",
        dueAt: tomorrowAtNoon(),
        status: "open",
      }).returning();
      if (followUpTask === undefined) throw new Error("follow-up task insert returned no row");

      return { account, contact, opportunity, followUpTask };
    });

    return reply.status(201).send({
      data: {
        created: true,
        opportunity: created.opportunity,
        clientAccount: created.account,
        contact: created.contact,
        followUpTask: created.followUpTask,
      },
    });
  });

  server.get("/pipeline", { preHandler: [authenticate] }, async (request, reply) => {
    const scope = commercialScope(request.user);
    if (!scope.ok) {
      return reply.status(403).send({ error: "Only the venue commercial team can view the CRM pipeline", code: "FORBIDDEN" });
    }
    const query = PipelineQuery.safeParse(request.query);
    if (!query.success) {
      return reply.status(400).send({ error: "Invalid query", code: "VALIDATION_ERROR", details: query.error.issues });
    }

    const where = scope.venueId === null
      ? isNull(opportunities.deletedAt)
      : and(eq(opportunities.venueId, scope.venueId), isNull(opportunities.deletedAt));

    // Stage counts come from the WHOLE pipeline, not the returned page. The
    // old code counted the (silently truncated) 200-row window, so a venue
    // past 200 open opportunities was shown stage totals that were simply
    // wrong. Counting in SQL keeps the header honest under pagination.
    const [totalRow] = await db.select({ count: sql<number>`count(*)::int` }).from(opportunities).where(where);
    const stageRows = await db.select({ stage: opportunities.stage, count: sql<number>`count(*)::int` })
      .from(opportunities)
      .where(where)
      .groupBy(opportunities.stage);

    const rows = await db.select()
      .from(opportunities)
      .where(where)
      .orderBy(desc(opportunities.createdAt), desc(opportunities.id))
      .limit(query.data.limit)
      .offset(query.data.offset);

    // Open follow-ups are scoped to the VENUE's opportunities rather than to
    // the current page, so paging the board never hides a due task. They stay
    // in due-date order — this strip is the urgency queue, not a feed — with
    // createdAt/id as the tiebreak so its own paging is a total order too.
    const taskScope = scope.venueId === null
      ? isNull(opportunities.deletedAt)
      : and(eq(opportunities.venueId, scope.venueId), isNull(opportunities.deletedAt));
    const openVenueOpportunityIds = db.select({ id: opportunities.id }).from(opportunities).where(taskScope);
    const taskWhere = and(
      inArray(followUpTasks.opportunityId, openVenueOpportunityIds),
      eq(followUpTasks.status, "open"),
    );
    const [taskTotalRow] = await db.select({ count: sql<number>`count(*)::int` }).from(followUpTasks).where(taskWhere);
    const tasks = await db.select()
      .from(followUpTasks)
      .where(taskWhere)
      .orderBy(asc(followUpTasks.dueAt), desc(followUpTasks.createdAt), desc(followUpTasks.id))
      .limit(query.data.taskLimit)
      .offset(query.data.taskOffset);

    return {
      data: {
        opportunities: rows,
        todayTasks: tasks,
        stageCounts: buildStageCounts(stageRows),
        // Served, not summed client-side: a page of rows cannot be summed
        // into a pipeline total, and this is the same figure Executive
        // Analytics reports (services/commercial-pipeline.ts).
        pipelineValueMinor: await loadPipelineValueMinor(db, scope.venueId),
        currency: PIPELINE_VALUE_CURRENCY,
        // INSIDE `data`, deliberately. The house `{ data, meta }` envelope is
        // for plain lists, and the shared web client unwraps `data` before any
        // caller sees the envelope — so a sibling `meta` is unreachable from
        // the board without re-contracting that client. The board NEEDS these
        // numbers: stage counts span the whole pipeline, so without the
        // unpaged total the header reads "qualified 312" above fifty cards
        // and offers no way to reach the rest.
        page: {
          total: totalRow?.count ?? 0,
          limit: query.data.limit,
          offset: query.data.offset,
          taskTotal: taskTotalRow?.count ?? 0,
          taskLimit: query.data.taskLimit,
          taskOffset: query.data.taskOffset,
        },
      },
    };
  });

  server.get("/pipeline/value", { preHandler: [authenticate] }, async (request, reply) => {
    const scope = commercialScope(request.user);
    if (!scope.ok) {
      return reply.status(403).send({ error: "Only the venue commercial team can view pipeline value", code: "FORBIDDEN" });
    }
    return {
      data: {
        totalMinor: await loadPipelineValueMinor(db, scope.venueId),
        currency: PIPELINE_VALUE_CURRENCY,
      },
    };
  });
}
