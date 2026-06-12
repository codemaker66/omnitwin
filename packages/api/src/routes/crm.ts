import type { FastifyInstance } from "fastify";
import { and, eq, inArray, isNull, sql } from "drizzle-orm";
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
import { authenticate, type JwtUser } from "../middleware/auth.js";

const IdParam = {
  schema: {
    params: {
      type: "object",
      required: ["enquiryId"],
      properties: { enquiryId: { type: "string", format: "uuid" } },
    },
  },
} as const;

function canManageCommercial(user: JwtUser, venueId: string): boolean {
  if (user.role === "admin") return true;
  return user.role === "staff" && user.venueId === venueId;
}

function staffVenueOrAdmin(user: JwtUser): { ok: true; venueId: string | null } | { ok: false } {
  if (user.role === "admin") return { ok: true, venueId: null };
  if (user.role === "staff" && user.venueId !== null) return { ok: true, venueId: user.venueId };
  return { ok: false };
}

function tomorrowAtNoon(): Date {
  const due = new Date();
  due.setUTCDate(due.getUTCDate() + 1);
  due.setUTCHours(12, 0, 0, 0);
  return due;
}

function buildStageCounts(rows: readonly { stage: string }[]): Record<OpportunityStage, number> {
  const counts = Object.fromEntries(OPPORTUNITY_STAGES.map((stage) => [stage, 0])) as Record<OpportunityStage, number>;
  for (const row of rows) {
    if ((OPPORTUNITY_STAGES as readonly string[]).includes(row.stage)) {
      counts[row.stage as OpportunityStage] += 1;
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
      return reply.status(403).send({ error: "Only venue staff or admin can create opportunities from enquiries", code: "FORBIDDEN" });
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
    const scope = staffVenueOrAdmin(request.user);
    if (!scope.ok) {
      return reply.status(403).send({ error: "Only venue staff or admin can view the CRM pipeline", code: "FORBIDDEN" });
    }

    const where = scope.venueId === null
      ? isNull(opportunities.deletedAt)
      : and(eq(opportunities.venueId, scope.venueId), isNull(opportunities.deletedAt));

    const rows = await db.select()
      .from(opportunities)
      .where(where)
      .orderBy(opportunities.updatedAt)
      .limit(200);

    const opportunityIds = rows.map((row) => row.id);
    const tasks = opportunityIds.length === 0
      ? []
      : await db.select()
        .from(followUpTasks)
        .where(and(inArray(followUpTasks.opportunityId, opportunityIds), eq(followUpTasks.status, "open")))
        .orderBy(followUpTasks.dueAt)
        .limit(100);

    return {
      data: {
        opportunities: rows,
        todayTasks: tasks,
        stageCounts: buildStageCounts(rows),
      },
    };
  });

  server.get("/pipeline/value", { preHandler: [authenticate] }, async (request, reply) => {
    const scope = staffVenueOrAdmin(request.user);
    if (!scope.ok) {
      return reply.status(403).send({ error: "Only venue staff or admin can view pipeline value", code: "FORBIDDEN" });
    }
    const where = scope.venueId === null
      ? isNull(opportunities.deletedAt)
      : and(eq(opportunities.venueId, scope.venueId), isNull(opportunities.deletedAt));
    const [row] = await db.select({ total: sql<number>`coalesce(sum(${opportunities.estimatedValueMinor}), 0)::int` })
      .from(opportunities)
      .where(where);
    return { data: { totalMinor: row?.total ?? 0, currency: "GBP" } };
  });
}
