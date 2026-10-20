import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { and, desc, eq, inArray, isNull, or, sql } from "drizzle-orm";
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
  competitorLosses,
  competitorVenues,
  contacts,
  enquiries,
  followUpTasks,
  opportunities,
  opportunityStatusHistory,
  proposals,
  quotes,
  spaces,
  users,
} from "../db/schema.js";
import type { Database } from "../db/client.js";
import { authenticate, isPlatformAdmin, type JwtUser } from "../middleware/auth.js";
import { paginate } from "../utils/pagination.js";
import { canManageCommercial } from "../utils/query.js";
import { lockConflictOf, RETRY_ANSWER } from "../utils/sql-state.js";
import { nextActionForStage } from "../services/deal-next-action.js";
import type { PeopleConn, PeopleTx } from "../services/people-records.js";
import { mergedPerson } from "./people.js";
import { lostToRefusal, recordLoss } from "../services/competitor-watch-data.js";

const IdParam = z.object({ id: z.string().uuid() });
const TaskParam = z.object({ id: z.string().uuid(), taskId: z.string().uuid() });
const ListQuery = z.object({
  stage: z.enum(OPPORTUNITY_STAGES).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
  offset: z.coerce.number().int().min(0).default(0),
});

/**
 * Resolve the venue this actor may list opportunities for: null means
 * platform-wide. The local predicate this replaces admitted `staff` only, so
 * a venue's own ADMIN was 403'd on their own opportunities. Authority now
 * comes from the shared capability helper in utils/query.ts.
 */
function commercialScope(user: JwtUser): { ok: true; venueId: string | null } | { ok: false } {
  if (isPlatformAdmin(user)) return { ok: true, venueId: null };
  if (user.venueId !== null && canManageCommercial(user, user.venueId)) {
    return { ok: true, venueId: user.venueId };
  }
  return { ok: false };
}

/** A quote a deal's value can be filled from: not replaced by another, and
 *  not declined or run out. */
const LIVE_QUOTE_STATUSES = ["draft", "issued", "accepted"];

/** A deal closes as won or lost only with the reason it did: the pipeline's
 *  history is what a team learns from (roadmap X1). */
const CLOSING_STAGES: ReadonlySet<OpportunityStage> = new Set<OpportunityStage>(["won", "lost"]);

function isoToDate(value: string | null | undefined): Date | null {
  if (value === undefined || value === null) return null;
  return new Date(value);
}

async function linkedRecordVenue(
  db: PeopleConn,
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
  db: PeopleConn,
  value: string | null | undefined,
  venueId: string,
  kind: "clientAccount" | "contact" | "enquiry",
): Promise<"ok" | "not_found" | "venue_mismatch"> {
  if (value === undefined || value === null) return "ok";
  const linkedVenue = await linkedRecordVenue(db, kind, value);
  if (linkedVenue === null) return "not_found";
  return linkedVenue === venueId ? "ok" : "venue_mismatch";
}

type ContactHold = "ok" | "not_found" | "venue_mismatch" | { mergedIntoId: string };

/**
 * The person a deal is about to name, taken FOR KEY SHARE at the deal's venue
 * and then looked at again: live (deleted_at, merged_into_id and erased_at
 * all null), a tombstone answering where they went, or not found.
 *
 * The global lock order is advisory locks, then people, then the rows that
 * point at them. A merge or undo holds `people-merge:<venue>`, then both
 * people FOR UPDATE (lower id first), then moves the deals that name them.
 * A deal write takes its person here, before it writes or locks any deal
 * row, so it never holds a deal while it waits for a person: it waits for a
 * merge already holding the person, and once that merge commits this read
 * sees the tombstone; a merge that comes after waits until the deal is
 * written. KEY SHARE (what the deal's foreign key takes anyway) does not
 * block another deal naming the same person.
 */
async function holdContact(tx: PeopleTx, contactId: string, venueId: string): Promise<ContactHold> {
  const [held] = await tx.select({ deletedAt: contacts.deletedAt, mergedIntoId: contacts.mergedIntoId, erasedAt: contacts.erasedAt })
    .from(contacts)
    .where(and(eq(contacts.id, contactId), eq(contacts.venueId, venueId)))
    .limit(1)
    .for("key share");
  // Not at this venue: another venue's live person is a mismatch, anyone else
  // not found, as before.
  if (held === undefined) return validateOptionalLink(tx, contactId, venueId, "contact");
  if (held.erasedAt !== null) return "not_found";
  // A tombstone is deleted too, so it is asked about before deleted.
  if (held.mergedIntoId !== null) return { mergedIntoId: held.mergedIntoId };
  if (held.deletedAt !== null) return "not_found";
  return "ok";
}

/** Why a deal's links refuse a write, as the answer says it. */
type LinkRefusal =
  | { status: 404; body: { error: string; code: "NOT_FOUND" } }
  | { status: 422; body: { error: string; code: "VENUE_MISMATCH" } }
  | { status: 409; body: ReturnType<typeof mergedPerson> };

/**
 * The links a deal write names, checked in their order (organisation,
 * person, enquiry) inside the write's own transaction, the person held as
 * holdContact says. The first refusal, or null when every link may be made.
 */
async function refuseLinks(
  tx: PeopleTx,
  venueId: string,
  links: { clientAccountId?: string | null; primaryContactId?: string | null; sourceEnquiryId?: string | null },
): Promise<LinkRefusal | null> {
  for (const [kind, value] of [
    ["clientAccount", links.clientAccountId],
    ["contact", links.primaryContactId],
    ["enquiry", links.sourceEnquiryId],
  ] as const) {
    if (value === undefined || value === null) continue;
    const link = kind === "contact" ? await holdContact(tx, value, venueId) : await validateOptionalLink(tx, value, venueId, kind);
    if (link === "ok") continue;
    if (link === "not_found") return { status: 404, body: { error: `${kind} not found`, code: "NOT_FOUND" } };
    if (link === "venue_mismatch") return { status: 422, body: { error: `${kind} belongs to a different venue`, code: "VENUE_MISMATCH" } };
    return { status: 409, body: mergedPerson(link.mergedIntoId) };
  }
  return null;
}

export async function opportunityRoutes(
  server: FastifyInstance,
  opts: { db: Database },
): Promise<void> {
  const { db } = opts;

  server.get("/", { preHandler: [authenticate] }, async (request, reply) => {
    const scope = commercialScope(request.user);
    if (!scope.ok) {
      return reply.status(403).send({ error: "Only the venue commercial team can view opportunities", code: "FORBIDDEN" });
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
    // Newest first with a total order (see enquiries.ts): `createdAt` ties are
    // broken by id so limit/offset paging cannot repeat or drop a row.
    const rows = await db.select()
      .from(opportunities)
      .where(where)
      .limit(parsed.data.limit)
      .offset(parsed.data.offset)
      .orderBy(desc(opportunities.createdAt), desc(opportunities.id));

    return paginate(rows, countRow?.count ?? 0, { limit: parsed.data.limit, offset: parsed.data.offset });
  });

  server.post("/", { preHandler: [authenticate] }, async (request, reply) => {
    const parsed = CreateOpportunitySchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: "Validation failed", code: "VALIDATION_ERROR", details: parsed.error.issues });
    }
    if (!canManageCommercial(request.user, parsed.data.venueId)) {
      return reply.status(403).send({ error: "Only the venue commercial team can create opportunities for this venue", code: "FORBIDDEN" });
    }

    type Created =
      | { kind: "refused"; refusal: LinkRefusal }
      | { kind: "created"; opportunity: typeof opportunities.$inferSelect; task: typeof followUpTasks.$inferSelect | null };
    const write = async (tx: PeopleTx): Promise<Created> => {
      // The person first (refuseLinks → holdContact), then the deal: see
      // holdContact for the lock order.
      const refusal = await refuseLinks(tx, parsed.data.venueId, parsed.data);
      if (refusal !== null) return { kind: "refused", refusal };
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

      return { kind: "created", opportunity, task: task ?? null };
    };

    let created: Created;
    try {
      created = await db.transaction(write);
    } catch (error) {
      // A deadlock or serialisation failure rolled the whole write back.
      const pgCode = lockConflictOf(error);
      if (pgCode === null) throw error;
      request.log.warn(
        { event: "opportunities.create.retry", venueId: parsed.data.venueId, primaryContactId: parsed.data.primaryContactId ?? null, pgCode },
        "deal write met a lock conflict",
      );
      return reply.status(409).send(RETRY_ANSWER);
    }

    if (created.kind === "refused") return reply.status(created.refusal.status).send(created.refusal.body);
    return reply.status(201).send({ data: { opportunity: created.opportunity, task: created.task } });
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

    // The deal's venue is checked above, before anything of it is read. What
    // follows are its parts, none needing another, so they are read at once
    // rather than one round trip after another.
    const [opportunityActivities, tasks, linkedProposals, history, [contact], [source], [latestQuote]] = await Promise.all([
      // The newest hundred, answered oldest first: a long-running deal's
      // latest notes are the ones its timeline must never drop.
      db.select()
        .from(activities)
        .where(eq(activities.opportunityId, opportunity.id))
        .orderBy(desc(activities.createdAt), desc(activities.id))
        .limit(100),
      // Follow-ups and linked proposals are newest-first under a total order,
      // matching the list endpoints so a staff member never sees one surface
      // ordered oldest-first and another newest-first for the same records.
      db.select()
        .from(followUpTasks)
        .where(eq(followUpTasks.opportunityId, opportunity.id))
        .orderBy(desc(followUpTasks.createdAt), desc(followUpTasks.id))
        .limit(100),
      db.select()
        .from(proposals)
        .where(and(eq(proposals.opportunityId, opportunity.id), isNull(proposals.deletedAt)))
        .orderBy(desc(proposals.createdAt), desc(proposals.id))
        .limit(50),
      // Every move between stages, newest first, with who made it and why.
      // A move to lost carries who won, when it was said (the competitor
      // watch): a venue in the set, or another by name, with any figure the
      // client volunteered, which the timeline labels as theirs, unverified.
      db.select({
        id: opportunityStatusHistory.id,
        fromStage: opportunityStatusHistory.fromStage,
        toStage: opportunityStatusHistory.toStage,
        note: opportunityStatusHistory.note,
        changedByName: sql<string | null>`COALESCE(${users.displayName}, ${users.name})`,
        createdAt: opportunityStatusHistory.createdAt,
        lostToName: sql<string | null>`COALESCE(${competitorVenues.name}, ${competitorLosses.otherName})`,
        lostToCompetitorId: competitorLosses.competitorId,
        clientFigureMinor: competitorLosses.clientFigureMinor,
        clientFigureBasis: competitorLosses.clientFigureBasis,
        lossCurrency: competitorLosses.currency,
      })
        .from(opportunityStatusHistory)
        .leftJoin(users, eq(users.id, opportunityStatusHistory.changedBy))
        .leftJoin(competitorLosses, and(
          eq(competitorLosses.statusHistoryId, opportunityStatusHistory.id),
          eq(competitorLosses.venueId, opportunity.venueId),
        ))
        .leftJoin(competitorVenues, and(
          eq(competitorVenues.id, competitorLosses.competitorId),
          eq(competitorVenues.venueId, competitorLosses.venueId),
        ))
        .where(eq(opportunityStatusHistory.opportunityId, opportunity.id))
        .orderBy(desc(opportunityStatusHistory.createdAt), desc(opportunityStatusHistory.id))
        .limit(100)
        .then((rows) => rows.map(({ lostToName, lostToCompetitorId, clientFigureMinor, clientFigureBasis, lossCurrency, ...move }) => ({
          ...move,
          lostTo: lostToName === null ? null : {
            name: lostToName,
            competitorId: lostToCompetitorId,
            clientFigureMinor,
            clientFigureBasis,
            currency: lossCurrency ?? "GBP",
          },
        }))),
      // Who the deal is with, at this venue.
      opportunity.primaryContactId === null ? [] : db.select({
        id: contacts.id,
        name: contacts.name,
        email: contacts.email,
        phone: contacts.phone,
        accountName: clientAccounts.name,
      })
        .from(contacts)
        .leftJoin(clientAccounts, and(eq(clientAccounts.id, contacts.clientAccountId), isNull(clientAccounts.deletedAt)))
        .where(and(eq(contacts.id, opportunity.primaryContactId), eq(contacts.venueId, opportunity.venueId), isNull(contacts.deletedAt)))
        .limit(1),
      // The room the guest asked for; none where they named none (roomChosen
      // false files an enquiry under the venue's first room).
      opportunity.sourceEnquiryId === null ? [] : db.select({
        roomName: spaces.name,
        roomChosen: enquiries.roomChosen,
      })
        .from(enquiries)
        .leftJoin(spaces, eq(spaces.id, enquiries.spaceId))
        .where(and(eq(enquiries.id, opportunity.sourceEnquiryId), eq(enquiries.venueId, opportunity.venueId)))
        .limit(1),
      // The deal's newest live quote, made for the deal itself or for one of
      // its proposals: what its value can be filled from.
      db.select({
        id: quotes.id,
        name: quotes.name,
        status: quotes.status,
        currency: quotes.currency,
        totalMinor: quotes.totalMinor,
        createdAt: quotes.createdAt,
      })
        .from(quotes)
        .where(and(
          eq(quotes.venueId, opportunity.venueId),
          isNull(quotes.deletedAt),
          inArray(quotes.status, LIVE_QUOTE_STATUSES),
          or(
            eq(quotes.opportunityId, opportunity.id),
            inArray(quotes.proposalId, db.select({ id: proposals.id }).from(proposals)
              .where(and(eq(proposals.opportunityId, opportunity.id), isNull(proposals.deletedAt)))),
          ),
        ))
        .orderBy(desc(quotes.createdAt), desc(quotes.id))
        .limit(1),
    ]);

    return {
      data: {
        opportunity,
        activities: [...opportunityActivities].reverse(),
        tasks,
        proposals: linkedProposals,
        history,
        contact: contact ?? null,
        room: source === undefined || !source.roomChosen ? null : source.roomName,
        latestQuote: latestQuote ?? null,
      },
    };
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

    // Checked here, before the transaction, and answered after the links, as
    // before: a bad link is said first, then a bad stage move, then who won.
    const fromStage = opportunity.stage as OpportunityStage;
    const toStage = parsed.data.stage;
    const lostTo = parsed.data.lostTo;
    type StageRefusal = {
      error: string;
      code: "INVALID_TRANSITION" | "REASON_REQUIRED" | "LOST_TO_WITHOUT_LOSS" | "COMPETITOR_NOT_IN_SET";
    };
    const refuseStage = async (): Promise<StageRefusal | null> => {
      if (toStage !== undefined && toStage !== fromStage && !isPlatformAdmin(request.user) && !isValidOpportunityStageTransition(fromStage, toStage)) {
        return { error: `Cannot transition opportunity from ${fromStage} to ${toStage}`, code: "INVALID_TRANSITION" };
      }
      if (toStage !== undefined && toStage !== fromStage && CLOSING_STAGES.has(toStage) && (parsed.data.note ?? "").trim() === "") {
        return { error: "Say why the deal was won or lost.", code: "REASON_REQUIRED" };
      }
      // Who won is said with the reason, on the move to lost and no other.
      if (lostTo !== undefined) {
        if (toStage !== "lost" || fromStage === "lost") {
          return { error: "Who won is recorded only as the deal is marked lost.", code: "LOST_TO_WITHOUT_LOSS" };
        }
        const refused = await lostToRefusal(db, opportunity.venueId, lostTo);
        if (refused !== null) return { error: refused, code: "COMPETITOR_NOT_IN_SET" };
      }
      return null;
    };
    const stageRefusal = await refuseStage();

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

    type Updated =
      | { kind: "refused"; refusal: LinkRefusal }
      | { kind: "stage_refused"; refusal: StageRefusal }
      | { kind: "not_found" }
      | { kind: "updated"; opportunity: typeof opportunities.$inferSelect };
    // The deal, its stage move and who won are written together, or not at
    // all: a loss is never recorded without the reason it hangs on.
    const write = async (tx: PeopleTx): Promise<Updated> => {
      // The person a move names first (refuseLinks → holdContact), and only
      // then the deal row, by this UPDATE: never the deal before the person,
      // the reverse of a merge's order (see holdContact).
      const refusal = await refuseLinks(tx, opportunity.venueId, parsed.data);
      if (refusal !== null) return { kind: "refused", refusal };
      if (stageRefusal !== null) return { kind: "stage_refused", refusal: stageRefusal };
      const [updated] = await tx.update(opportunities)
        .set(updateData)
        .where(eq(opportunities.id, opportunity.id))
        .returning();
      if (updated === undefined) return { kind: "not_found" };

      if (toStage !== undefined && toStage !== fromStage) {
        const [move] = await tx.insert(opportunityStatusHistory).values({
          opportunityId: opportunity.id,
          fromStage,
          toStage,
          changedBy: request.user.id,
          note: parsed.data.note ?? null,
        }).returning({ id: opportunityStatusHistory.id });
        if (lostTo !== undefined && move !== undefined) {
          await recordLoss(tx, {
            venueId: opportunity.venueId,
            opportunityId: opportunity.id,
            statusHistoryId: move.id,
            lostTo,
            actorId: request.user.id,
            currency: updated.currency,
          });
        }
      }
      return { kind: "updated", opportunity: updated };
    };

    let outcome: Updated;
    try {
      outcome = await db.transaction(write);
    } catch (error) {
      // A deadlock or serialisation failure rolled the whole write back.
      const pgCode = lockConflictOf(error);
      if (pgCode === null) throw error;
      request.log.warn({ event: "opportunities.update.retry", opportunityId: opportunity.id, pgCode }, "deal write met a lock conflict");
      return reply.status(409).send(RETRY_ANSWER);
    }

    switch (outcome.kind) {
      case "refused": return reply.status(outcome.refusal.status).send(outcome.refusal.body);
      case "stage_refused": return reply.status(422).send(outcome.refusal);
      case "not_found": return reply.status(404).send({ error: "Opportunity not found", code: "NOT_FOUND" });
      case "updated": return { data: outcome.opportunity };
    }
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
