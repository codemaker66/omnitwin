import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { eq, and, isNull, sql } from "drizzle-orm";
import { CreateQuoteLineItemSchema, CreateQuoteSchema, MAX_MINOR_UNIT_AMOUNT } from "@omnitwin/types";
import { quotes, quoteLineItems, proposals, opportunities, enquiries, spaces } from "../db/schema.js";
import type { Database } from "../db/client.js";
import { authenticate } from "../middleware/auth.js";
import { paginate } from "../utils/pagination.js";
import { canAccessResource } from "../utils/query.js";
import { QUOTE_STATES, canTransitionQuote } from "../state-machines/proposal.js";
import { multiplyMinor, sumMinor } from "../services/money.js";

// ---------------------------------------------------------------------------
// Quote routes — T-427 phase 2.
//
// Money: clients never supply totals. Every line total is computed here with
// the exact minor-unit engine (multiplyMinor — integer × integer, no
// rounding), and the subtotal/total are exact sums. The DB CHECK
// quote_line_items_total_exact backstops the same invariant.
//
// Venue scoping mirrors proposals: admin anywhere, staff within their venue.
// A replaced quote transitions to `superseded` and must point at its
// successor; the DB CHECKs quotes_superseded_coherent / _not_self enforce
// the referential shape.
// ---------------------------------------------------------------------------

const IdParam = z.object({ id: z.string().uuid() });

const UpdateQuoteBody = z.object({
  name: z.string().trim().min(1).max(200).optional(),
  notes: z.string().max(2000).nullable().optional(),
  validUntil: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
});

const TransitionBody = z.object({
  status: z.enum(QUOTE_STATES),
  note: z.string().max(1000).nullable().optional(),
  supersededByQuoteId: z.string().uuid().optional(),
});

const ListQuery = z.object({
  status: z.enum(QUOTE_STATES).optional(),
  proposalId: z.string().uuid().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  offset: z.coerce.number().int().min(0).default(0),
});

type AuthedUser = { id: string; role: string; venueId: string | null };

/** Create/mutate policy: admin anywhere, staff within their own venue. */
function canManageVenueQuotes(user: AuthedUser, venueId: string): boolean {
  if (user.role === "admin") return true;
  return user.role === "staff" && user.venueId === venueId;
}

async function validateOpportunityLink(db: Database, opportunityId: string | null | undefined, venueId: string): Promise<"ok" | "missing" | "mismatch"> {
  if (opportunityId === undefined || opportunityId === null) return "ok";
  const [opportunity] = await db.select({ venueId: opportunities.venueId })
    .from(opportunities)
    .where(and(eq(opportunities.id, opportunityId), isNull(opportunities.deletedAt)))
    .limit(1);
  if (opportunity === undefined) return "missing";
  return opportunity.venueId === venueId ? "ok" : "mismatch";
}

export async function quoteRoutes(
  server: FastifyInstance,
  opts: { db: Database },
): Promise<void> {
  const { db } = opts;

  // GET /quotes — authenticated, role-filtered, paginated
  server.get("/", { preHandler: [authenticate] }, async (request, reply) => {
    const query = ListQuery.safeParse(request.query);
    if (!query.success) {
      return reply.status(400).send({ error: "Invalid query", code: "VALIDATION_ERROR", details: query.error.issues });
    }

    const user = request.user;
    const whereConditions = [isNull(quotes.deletedAt)];
    if (query.data.status !== undefined) {
      whereConditions.push(eq(quotes.status, query.data.status));
    }
    if (query.data.proposalId !== undefined) {
      whereConditions.push(eq(quotes.proposalId, query.data.proposalId));
    }

    if (user.role === "admin") {
      // Admin sees all venues
    } else if ((user.role === "staff" || user.role === "hallkeeper") && user.venueId !== null) {
      whereConditions.push(eq(quotes.venueId, user.venueId));
    } else {
      whereConditions.push(eq(quotes.createdBy, user.id));
    }

    const where = and(...whereConditions);

    const [countResult] = await db.select({ count: sql<number>`count(*)::int` })
      .from(quotes)
      .where(where);
    const total = countResult?.count ?? 0;

    const rows = await db.select()
      .from(quotes)
      .where(where)
      .limit(query.data.limit)
      .offset(query.data.offset)
      .orderBy(quotes.updatedAt);

    return paginate(rows, total, { limit: query.data.limit, offset: query.data.offset });
  });

  // POST /quotes — staff (own venue) or admin; totals computed server-side
  server.post("/", { preHandler: [authenticate] }, async (request, reply) => {
    const parsed = CreateQuoteSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: "Validation failed", code: "VALIDATION_ERROR", details: parsed.error.issues });
    }

    if (!canManageVenueQuotes(request.user, parsed.data.venueId)) {
      return reply.status(403).send({ error: "Only venue staff or admin can create quotes for this venue", code: "FORBIDDEN" });
    }

    // Exact money: integer unit × integer quantity, exact sum — no floats.
    const lineTotals = parsed.data.lineItems.map((item) =>
      multiplyMinor(item.unitAmountMinor, item.quantity),
    );
    const subtotalMinor = sumMinor(lineTotals);
    const totalMinor = subtotalMinor; // v0: no modifiers/discounts yet
    if (totalMinor > MAX_MINOR_UNIT_AMOUNT) {
      return reply.status(422).send({
        error: "Quote total exceeds the supported ceiling",
        code: "QUOTE_TOTAL_EXCEEDS_LIMIT",
      });
    }

    // Linked records must exist and belong to the same venue.
    const opportunityStatus = await validateOpportunityLink(db, parsed.data.opportunityId, parsed.data.venueId);
    if (opportunityStatus === "missing") {
      return reply.status(404).send({ error: "Opportunity not found", code: "NOT_FOUND" });
    }
    if (opportunityStatus === "mismatch") {
      return reply.status(422).send({ error: "Opportunity belongs to a different venue", code: "VENUE_MISMATCH" });
    }

    if (parsed.data.proposalId !== undefined && parsed.data.proposalId !== null) {
      const [proposal] = await db.select({ venueId: proposals.venueId })
        .from(proposals)
        .where(and(eq(proposals.id, parsed.data.proposalId), isNull(proposals.deletedAt)))
        .limit(1);
      if (proposal === undefined) {
        return reply.status(404).send({ error: "Proposal not found", code: "NOT_FOUND" });
      }
      if (proposal.venueId !== parsed.data.venueId) {
        return reply.status(422).send({ error: "Proposal belongs to a different venue", code: "VENUE_MISMATCH" });
      }
    }
    if (parsed.data.enquiryId !== undefined && parsed.data.enquiryId !== null) {
      const [enquiry] = await db.select({ venueId: enquiries.venueId })
        .from(enquiries).where(eq(enquiries.id, parsed.data.enquiryId)).limit(1);
      if (enquiry === undefined) {
        return reply.status(404).send({ error: "Enquiry not found", code: "NOT_FOUND" });
      }
      if (enquiry.venueId !== parsed.data.venueId) {
        return reply.status(422).send({ error: "Enquiry belongs to a different venue", code: "VENUE_MISMATCH" });
      }
    }
    if (parsed.data.spaceId !== undefined && parsed.data.spaceId !== null) {
      const [space] = await db.select({ venueId: spaces.venueId })
        .from(spaces)
        .where(and(eq(spaces.id, parsed.data.spaceId), isNull(spaces.deletedAt)))
        .limit(1);
      if (space === undefined) {
        return reply.status(404).send({ error: "Space not found", code: "NOT_FOUND" });
      }
      if (space.venueId !== parsed.data.venueId) {
        return reply.status(422).send({ error: "Space belongs to a different venue", code: "VENUE_MISMATCH" });
      }
    }

    // Quote + line items in one transaction — no orphan headers.
    const created = await db.transaction(async (tx) => {
      const [quote] = await tx.insert(quotes).values({
        venueId: parsed.data.venueId,
        opportunityId: parsed.data.opportunityId ?? null,
        proposalId: parsed.data.proposalId ?? null,
        enquiryId: parsed.data.enquiryId ?? null,
        spaceId: parsed.data.spaceId ?? null,
        name: parsed.data.name,
        status: "draft",
        currency: parsed.data.currency,
        subtotalMinor,
        totalMinor,
        validUntil: parsed.data.validUntil ?? null,
        notes: parsed.data.notes ?? null,
        createdBy: request.user.id,
      }).returning();
      if (quote === undefined) {
        throw new Error("quote insert returned no row");
      }

      const lineRows = await tx.insert(quoteLineItems).values(
        parsed.data.lineItems.map((item, index) => ({
          quoteId: quote.id,
          pricingRuleId: item.pricingRuleId ?? null,
          description: item.description,
          quantity: item.quantity,
          unitAmountMinor: item.unitAmountMinor,
          lineTotalMinor: lineTotals[index] ?? multiplyMinor(item.unitAmountMinor, item.quantity),
          sortOrder: index,
        })),
      ).returning();

      return { quote, lineItems: lineRows };
    });

    return reply.status(201).send({ data: { ...created.quote, lineItems: created.lineItems } });
  });

  // GET /quotes/:id — quote with ordered line items
  server.get("/:id", { preHandler: [authenticate] }, async (request, reply) => {
    const params = IdParam.safeParse(request.params);
    if (!params.success) {
      return reply.status(400).send({ error: "Invalid ID", code: "VALIDATION_ERROR" });
    }

    const [quote] = await db.select().from(quotes)
      .where(and(eq(quotes.id, params.data.id), isNull(quotes.deletedAt)))
      .limit(1);
    if (quote === undefined) {
      return reply.status(404).send({ error: "Quote not found", code: "NOT_FOUND" });
    }
    if (!canAccessResource(request.user, quote.createdBy, quote.venueId)) {
      return reply.status(403).send({ error: "Insufficient permissions", code: "FORBIDDEN" });
    }

    const lineItems = await db.select().from(quoteLineItems)
      .where(eq(quoteLineItems.quoteId, params.data.id))
      .orderBy(quoteLineItems.sortOrder);

    return { data: { ...quote, lineItems } };
  });

  // PATCH /quotes/:id — metadata edits while draft (admin may edit anytime)
  server.patch("/:id", { preHandler: [authenticate] }, async (request, reply) => {
    const params = IdParam.safeParse(request.params);
    if (!params.success) {
      return reply.status(400).send({ error: "Invalid ID", code: "VALIDATION_ERROR" });
    }
    const parsed = UpdateQuoteBody.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: "Validation failed", code: "VALIDATION_ERROR", details: parsed.error.issues });
    }

    const [quote] = await db.select().from(quotes)
      .where(and(eq(quotes.id, params.data.id), isNull(quotes.deletedAt)))
      .limit(1);
    if (quote === undefined) {
      return reply.status(404).send({ error: "Quote not found", code: "NOT_FOUND" });
    }
    if (!canManageVenueQuotes(request.user, quote.venueId)) {
      return reply.status(403).send({ error: "Insufficient permissions", code: "FORBIDDEN" });
    }
    if (request.user.role !== "admin" && quote.status !== "draft") {
      return reply.status(422).send({ error: "Only draft quotes can be edited — supersede an issued quote instead", code: "NOT_EDITABLE" });
    }

    const updateData: Record<string, unknown> = { updatedAt: new Date() };
    if (parsed.data.name !== undefined) updateData["name"] = parsed.data.name;
    if (parsed.data.notes !== undefined) updateData["notes"] = parsed.data.notes;
    if (parsed.data.validUntil !== undefined) updateData["validUntil"] = parsed.data.validUntil;

    const [updated] = await db.update(quotes)
      .set(updateData)
      .where(eq(quotes.id, params.data.id))
      .returning();

    return { data: updated };
  });

  // POST /quotes/:id/line-items — append a draft line and recompute exact totals
  server.post("/:id/line-items", { preHandler: [authenticate] }, async (request, reply) => {
    const params = IdParam.safeParse(request.params);
    if (!params.success) {
      return reply.status(400).send({ error: "Invalid ID", code: "VALIDATION_ERROR" });
    }
    const parsed = CreateQuoteLineItemSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: "Validation failed", code: "VALIDATION_ERROR", details: parsed.error.issues });
    }

    const [quote] = await db.select().from(quotes)
      .where(and(eq(quotes.id, params.data.id), isNull(quotes.deletedAt)))
      .limit(1);
    if (quote === undefined) {
      return reply.status(404).send({ error: "Quote not found", code: "NOT_FOUND" });
    }
    if (!canManageVenueQuotes(request.user, quote.venueId)) {
      return reply.status(403).send({ error: "Insufficient permissions", code: "FORBIDDEN" });
    }
    if (request.user.role !== "admin" && quote.status !== "draft") {
      return reply.status(422).send({ error: "Only draft quotes can be edited — supersede an issued quote instead", code: "NOT_EDITABLE" });
    }

    const created = await db.transaction(async (tx) => {
      const existingLines = await tx.select().from(quoteLineItems)
        .where(eq(quoteLineItems.quoteId, quote.id))
        .orderBy(quoteLineItems.sortOrder);
      const lineTotalMinor = multiplyMinor(parsed.data.unitAmountMinor, parsed.data.quantity);
      const [lineItem] = await tx.insert(quoteLineItems).values({
        quoteId: quote.id,
        pricingRuleId: parsed.data.pricingRuleId ?? null,
        description: parsed.data.description,
        quantity: parsed.data.quantity,
        unitAmountMinor: parsed.data.unitAmountMinor,
        lineTotalMinor,
        sortOrder: existingLines.length,
      }).returning();
      if (lineItem === undefined) throw new Error("quote line item insert returned no row");

      const lineItems = [...existingLines, lineItem];
      const subtotalMinor = sumMinor(lineItems.map((item) => item.lineTotalMinor));
      if (subtotalMinor > MAX_MINOR_UNIT_AMOUNT) {
        throw new Error("QUOTE_TOTAL_EXCEEDS_LIMIT");
      }
      const [updatedQuote] = await tx.update(quotes)
        .set({ subtotalMinor, totalMinor: subtotalMinor, updatedAt: new Date() })
        .where(eq(quotes.id, quote.id))
        .returning();
      if (updatedQuote === undefined) throw new Error("quote update returned no row");
      return { quote: updatedQuote, lineItems };
    }).catch((err: unknown) => {
      if (err instanceof Error && err.message === "QUOTE_TOTAL_EXCEEDS_LIMIT") return "QUOTE_TOTAL_EXCEEDS_LIMIT" as const;
      throw err;
    });

    if (created === "QUOTE_TOTAL_EXCEEDS_LIMIT") {
      return reply.status(422).send({ error: "Quote total exceeds the supported ceiling", code: "QUOTE_TOTAL_EXCEEDS_LIMIT" });
    }

    return reply.status(201).send({ data: { ...created.quote, lineItems: created.lineItems } });
  });

  // DELETE /quotes/:id — soft delete drafts (admin may delete any)
  server.delete("/:id", { preHandler: [authenticate] }, async (request, reply) => {
    const params = IdParam.safeParse(request.params);
    if (!params.success) {
      return reply.status(400).send({ error: "Invalid ID", code: "VALIDATION_ERROR" });
    }

    const [quote] = await db.select().from(quotes)
      .where(and(eq(quotes.id, params.data.id), isNull(quotes.deletedAt)))
      .limit(1);
    if (quote === undefined) {
      return reply.status(404).send({ error: "Quote not found", code: "NOT_FOUND" });
    }
    if (!canManageVenueQuotes(request.user, quote.venueId)) {
      return reply.status(403).send({ error: "Insufficient permissions", code: "FORBIDDEN" });
    }
    if (quote.status !== "draft" && request.user.role !== "admin") {
      return reply.status(422).send({ error: "Issued quotes are a commercial record — supersede or expire them instead", code: "QUOTE_ISSUED_LOCKED" });
    }

    await db.update(quotes)
      .set({ deletedAt: new Date(), updatedAt: new Date() })
      .where(eq(quotes.id, params.data.id));

    return reply.status(204).send();
  });

  // POST /quotes/:id/transition — state machine; superseded requires successor
  server.post("/:id/transition", { preHandler: [authenticate] }, async (request, reply) => {
    const params = IdParam.safeParse(request.params);
    if (!params.success) {
      return reply.status(400).send({ error: "Invalid ID", code: "VALIDATION_ERROR" });
    }
    const parsed = TransitionBody.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: "Validation failed", code: "VALIDATION_ERROR", details: parsed.error.issues });
    }
    if (parsed.data.status !== "superseded" && parsed.data.supersededByQuoteId !== undefined) {
      return reply.status(400).send({
        error: "supersededByQuoteId is only valid when transitioning to 'superseded'",
        code: "VALIDATION_ERROR",
      });
    }

    const [quote] = await db.select().from(quotes)
      .where(and(eq(quotes.id, params.data.id), isNull(quotes.deletedAt)))
      .limit(1);
    if (quote === undefined) {
      return reply.status(404).send({ error: "Quote not found", code: "NOT_FOUND" });
    }
    if (!canAccessResource(request.user, quote.createdBy, quote.venueId)) {
      return reply.status(403).send({ error: "Insufficient permissions", code: "FORBIDDEN" });
    }
    if (!canTransitionQuote(quote.status, parsed.data.status, request.user.role)) {
      return reply.status(422).send({
        error: `Cannot transition from '${quote.status}' to '${parsed.data.status}' with role '${request.user.role}'`,
        code: "INVALID_TRANSITION",
      });
    }

    const updateData: Record<string, unknown> = {
      status: parsed.data.status,
      updatedAt: new Date(),
    };

    if (parsed.data.status === "superseded") {
      // DB CHECKs quotes_superseded_coherent / _not_self mirror these guards.
      if (parsed.data.supersededByQuoteId === undefined) {
        return reply.status(422).send({
          error: "A superseded quote must reference its successor",
          code: "SUPERSEDED_REQUIRES_SUCCESSOR",
        });
      }
      if (parsed.data.supersededByQuoteId === params.data.id) {
        return reply.status(422).send({ error: "A quote cannot supersede itself", code: "SUPERSEDED_SELF" });
      }
      const [successor] = await db.select({ venueId: quotes.venueId })
        .from(quotes)
        .where(and(eq(quotes.id, parsed.data.supersededByQuoteId), isNull(quotes.deletedAt)))
        .limit(1);
      if (successor === undefined) {
        return reply.status(404).send({ error: "Successor quote not found", code: "NOT_FOUND" });
      }
      if (successor.venueId !== quote.venueId) {
        return reply.status(422).send({ error: "Successor quote belongs to a different venue", code: "VENUE_MISMATCH" });
      }
      updateData["supersededByQuoteId"] = parsed.data.supersededByQuoteId;
    }

    const [updated] = await db.update(quotes)
      .set(updateData)
      .where(eq(quotes.id, params.data.id))
      .returning();

    return { data: updated };
  });
}
