import type { FastifyInstance, FastifyReply } from "fastify";
import { z } from "zod";
import { eq, and, isNotNull, isNull } from "drizzle-orm";
import { PricingAdviceKeySchema } from "@omnitwin/types";
import { pricingRules, spaces, venues } from "../db/schema.js";
import type { Database } from "../db/client.js";
import { authenticate } from "../middleware/auth.js";
import { canAdministerVenue, canWritePricing } from "../utils/query.js";
import { calculatePrice } from "../services/price-calculator.js";
import type { PricingRuleInput } from "../services/price-calculator.js";
import {
  listPricingRuleHistory,
  pricingWriteRefusal,
  recordPricingRuleChange,
} from "../services/pricing-rule-audit.js";

/** A write by someone outside PRICING_WRITE_ROLES. The words say who can. */
function refusePricingWrite(reply: FastifyReply): FastifyReply {
  return reply.status(403).send({ error: pricingWriteRefusal(), code: "FORBIDDEN" });
}

// ---------------------------------------------------------------------------
// Zod schemas
// ---------------------------------------------------------------------------

const VenueIdParam = z.object({ venueId: z.string().uuid() });
const RuleIdParam = z.object({ venueId: z.string().uuid(), id: z.string().uuid() });

const PRICING_TYPES = ["flat_rate", "per_hour", "per_head", "tiered"] as const;

const EstimateBody = z.object({
  spaceId: z.string().uuid(),
  eventDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  startTime: z.string().regex(/^\d{2}:\d{2}$/),
  endTime: z.string().regex(/^\d{2}:\d{2}$/),
  guestCount: z.number().int().min(1).max(10000),
});

const TierSchema = z.object({ upTo: z.number().positive(), amount: z.number().nonnegative() });

/** A calendar date that exists: "2027-02-30" is refused here, not by Postgres. */
const CalendarDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine((value) => new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) === value, { message: "Not a calendar date" });

const CreateRuleBody = z.object({
  spaceId: z.string().uuid().nullable().optional(),
  name: z.string().trim().min(1).max(200),
  type: z.enum(PRICING_TYPES),
  amount: z.number().nonnegative(),
  currency: z.string().length(3).default("GBP"),
  minHours: z.number().int().positive().nullable().optional(),
  minGuests: z.number().int().positive().nullable().optional(),
  tiers: z.array(TierSchema).nullable().optional(),
  dayOfWeekModifiers: z.record(z.number().positive()).nullable().optional(),
  seasonalModifiers: z.record(z.number().positive()).nullable().optional(),
  validFrom: CalendarDate.nullable().optional(),
  validTo: CalendarDate.nullable().optional(),
  isActive: z.boolean().default(true),
  // The time of day the rule is for (0089): "HH:MM", both or neither. An
  // until not after its from runs past midnight ("19:00" to "00:30").
  appliesFrom: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/).nullable().optional(),
  appliesUntil: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/).nullable().optional(),
  // The Pricing desk's suggestion this rate follows, if any: kept in the
  // change's record, never stored on the rule.
  adviceKey: PricingAdviceKeySchema.nullable().optional(),
});
const DATE_ORDER_MESSAGE = "validFrom comes on or before validTo";
function datesInOrder(body: { validFrom?: string | null; validTo?: string | null }): boolean {
  const from = body.validFrom ?? null;
  const to = body.validTo ?? null;
  return from === null || to === null || from <= to;
}
const WINDOW_PAIR_MESSAGE = "appliesFrom and appliesUntil go together: both, or neither";
function windowIsPaired(body: { appliesFrom?: string | null; appliesUntil?: string | null }): boolean {
  return ((body.appliesFrom ?? null) === null) === ((body.appliesUntil ?? null) === null);
}
const CreateRuleBodyChecked = CreateRuleBody
  .refine(windowIsPaired, { message: WINDOW_PAIR_MESSAGE, path: ["appliesUntil"] })
  .refine(datesInOrder, { message: DATE_ORDER_MESSAGE, path: ["validTo"] });

/** A suggestion's key names one of this venue's rates, or it is not kept. */
async function adviceKeyIsThisVenues(db: Database, venueId: string, adviceKey: string | null | undefined): Promise<boolean> {
  if (adviceKey === null || adviceKey === undefined) return true;
  const ruleId = adviceKey.slice(0, 36);
  const [rule] = await db.select({ id: pricingRules.id }).from(pricingRules)
    .where(and(eq(pricingRules.id, ruleId), eq(pricingRules.venueId, venueId)))
    .limit(1);
  return rule !== undefined;
}
const ADVICE_KEY_MESSAGE = "That suggestion is not one of this venue's";
// A patch may send one side when the other is already stored; the handler
// judges the pair as it will be stored.

const UpdateRuleBody = CreateRuleBody.partial();

// A delete marks the rule and switches it off; the admin's Undo sends back
// whether it was on.
const RestoreRuleBody = z.object({ isActive: z.boolean().default(true) });

// ---------------------------------------------------------------------------
// Plugin
// ---------------------------------------------------------------------------

export async function pricingRuleRoutes(
  server: FastifyInstance,
  opts: { db: Database },
): Promise<void> {
  const { db } = opts;

  // GET /venues/:venueId/pricing — public
  server.get("/", async (request, reply) => {
    const params = VenueIdParam.safeParse(request.params);
    if (!params.success) {
      return reply.status(400).send({ error: "Invalid venue ID", code: "VALIDATION_ERROR" });
    }

    // Verify venue is active — prevents leaking pricing for soft-deleted venues
    const [venueCheck] = await db.select({ id: venues.id }).from(venues)
      .where(and(eq(venues.id, params.data.venueId), isNull(venues.deletedAt)))
      .limit(1);
    if (venueCheck === undefined) {
      return reply.status(404).send({ error: "Venue not found", code: "NOT_FOUND" });
    }

    const rows = await db.select().from(pricingRules)
      .where(and(
        eq(pricingRules.venueId, params.data.venueId),
        eq(pricingRules.isActive, true),
        isNull(pricingRules.deletedAt),
      ))
      .orderBy(pricingRules.createdAt);

    return { data: rows };
  });

  // GET /venues/:venueId/pricing/:id — public
  server.get("/:id", async (request, reply) => {
    const params = RuleIdParam.safeParse(request.params);
    if (!params.success) {
      return reply.status(400).send({ error: "Invalid params", code: "VALIDATION_ERROR" });
    }

    // Verify venue is active
    const [venueCheck] = await db.select({ id: venues.id }).from(venues)
      .where(and(eq(venues.id, params.data.venueId), isNull(venues.deletedAt)))
      .limit(1);
    if (venueCheck === undefined) {
      return reply.status(404).send({ error: "Venue not found", code: "NOT_FOUND" });
    }

    const [rule] = await db.select().from(pricingRules)
      .where(and(
        eq(pricingRules.id, params.data.id),
        eq(pricingRules.venueId, params.data.venueId),
        isNull(pricingRules.deletedAt),
      ))
      .limit(1);

    if (rule === undefined) {
      return reply.status(404).send({ error: "Pricing rule not found", code: "NOT_FOUND" });
    }

    return { data: rule };
  });

  // GET /venues/:venueId/pricing/:id/history — who changed this price, when,
  // and what. The venue's own administration reads it; the public does not.
  server.get("/:id/history", { preHandler: [authenticate] }, async (request, reply) => {
    const params = RuleIdParam.safeParse(request.params);
    if (!params.success) {
      return reply.status(400).send({ error: "Invalid params", code: "VALIDATION_ERROR" });
    }
    if (!canAdministerVenue(request.user, params.data.venueId)) {
      return reply.status(403).send({ error: "Insufficient permissions", code: "FORBIDDEN" });
    }
    // Deleted rules keep their history; another venue's rule is not found.
    const [rule] = await db.select({ id: pricingRules.id }).from(pricingRules)
      .where(and(eq(pricingRules.id, params.data.id), eq(pricingRules.venueId, params.data.venueId)))
      .limit(1);
    if (rule === undefined) {
      return reply.status(404).send({ error: "Pricing rule not found", code: "NOT_FOUND" });
    }
    reply.header("Cache-Control", "private, no-store");
    return { data: await listPricingRuleHistory(db, rule.id) };
  });

  // POST /venues/:venueId/pricing — PRICING_WRITE_ROLES only
  server.post("/", { preHandler: [authenticate] }, async (request, reply) => {
    const params = VenueIdParam.safeParse(request.params);
    if (!params.success) {
      return reply.status(400).send({ error: "Invalid venue ID", code: "VALIDATION_ERROR" });
    }

    if (!canWritePricing(request.user, params.data.venueId)) return refusePricingWrite(reply);

    const parsed = CreateRuleBodyChecked.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: "Validation failed", code: "VALIDATION_ERROR", details: parsed.error.issues });
    }

    // Verify spaceId belongs to this venue (prevents cross-venue pricing rules)
    if (parsed.data.spaceId !== undefined && parsed.data.spaceId !== null) {
      const [space] = await db.select({ id: spaces.id }).from(spaces)
        .where(and(eq(spaces.id, parsed.data.spaceId), eq(spaces.venueId, params.data.venueId), isNull(spaces.deletedAt)))
        .limit(1);
      if (space === undefined) {
        return reply.status(404).send({ error: "Space not found in this venue", code: "NOT_FOUND" });
      }
    }
    if (!await adviceKeyIsThisVenues(db, params.data.venueId, parsed.data.adviceKey)) {
      return reply.status(400).send({ error: ADVICE_KEY_MESSAGE, code: "VALIDATION_ERROR" });
    }

    const rule = await db.transaction(async (tx) => {
      const [created] = await tx.insert(pricingRules).values({
      venueId: params.data.venueId,
      spaceId: parsed.data.spaceId ?? null,
      name: parsed.data.name,
      type: parsed.data.type,
      amount: String(parsed.data.amount),
      currency: parsed.data.currency,
      minHours: parsed.data.minHours ?? null,
      minGuests: parsed.data.minGuests ?? null,
      tiers: parsed.data.tiers ?? null,
      dayOfWeekModifiers: parsed.data.dayOfWeekModifiers ?? null,
      seasonalModifiers: parsed.data.seasonalModifiers ?? null,
      validFrom: parsed.data.validFrom ?? null,
      validTo: parsed.data.validTo ?? null,
      isActive: parsed.data.isActive,
      appliesFrom: parsed.data.appliesFrom ?? null,
      appliesUntil: parsed.data.appliesUntil ?? null,
      }).returning();
      if (created === undefined) throw new Error("Pricing rule insert returned no row");
      await recordPricingRuleChange(tx, {
        kind: "created", actorUserId: request.user.id, before: null, after: created, adviceKey: parsed.data.adviceKey ?? null,
      });
      return created;
    });

    return reply.status(201).send({ data: rule });
  });

  // PATCH /venues/:venueId/pricing/:id — PRICING_WRITE_ROLES only
  server.patch("/:id", { preHandler: [authenticate] }, async (request, reply) => {
    const params = RuleIdParam.safeParse(request.params);
    if (!params.success) {
      return reply.status(400).send({ error: "Invalid params", code: "VALIDATION_ERROR" });
    }

    if (!canWritePricing(request.user, params.data.venueId)) return refusePricingWrite(reply);

    const parsed = UpdateRuleBody.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: "Validation failed", code: "VALIDATION_ERROR", details: parsed.error.issues });
    }

    // Verify spaceId belongs to this venue if being updated
    if (parsed.data.spaceId !== undefined && parsed.data.spaceId !== null) {
      const [space] = await db.select({ id: spaces.id }).from(spaces)
        .where(and(eq(spaces.id, parsed.data.spaceId), eq(spaces.venueId, params.data.venueId), isNull(spaces.deletedAt)))
        .limit(1);
      if (space === undefined) {
        return reply.status(404).send({ error: "Space not found in this venue", code: "NOT_FOUND" });
      }
    }
    if (!await adviceKeyIsThisVenues(db, params.data.venueId, parsed.data.adviceKey)) {
      return reply.status(400).send({ error: ADVICE_KEY_MESSAGE, code: "VALIDATION_ERROR" });
    }

    const updateData: Record<string, unknown> = { updatedAt: new Date() };
    if (parsed.data.spaceId !== undefined) updateData["spaceId"] = parsed.data.spaceId;
    if (parsed.data.name !== undefined) updateData["name"] = parsed.data.name;
    if (parsed.data.type !== undefined) updateData["type"] = parsed.data.type;
    if (parsed.data.amount !== undefined) updateData["amount"] = String(parsed.data.amount);
    if (parsed.data.currency !== undefined) updateData["currency"] = parsed.data.currency;
    if (parsed.data.minHours !== undefined) updateData["minHours"] = parsed.data.minHours;
    if (parsed.data.minGuests !== undefined) updateData["minGuests"] = parsed.data.minGuests;
    if (parsed.data.tiers !== undefined) updateData["tiers"] = parsed.data.tiers;
    if (parsed.data.dayOfWeekModifiers !== undefined) updateData["dayOfWeekModifiers"] = parsed.data.dayOfWeekModifiers;
    if (parsed.data.seasonalModifiers !== undefined) updateData["seasonalModifiers"] = parsed.data.seasonalModifiers;
    if (parsed.data.validFrom !== undefined) updateData["validFrom"] = parsed.data.validFrom;
    if (parsed.data.validTo !== undefined) updateData["validTo"] = parsed.data.validTo;
    if (parsed.data.isActive !== undefined) updateData["isActive"] = parsed.data.isActive;

    // The rule is read and locked inside the write's transaction, so the
    // record's "before" is the rule this change actually replaced.
    const outcome = await db.transaction(async (tx) => {
      // Verify rule exists AND belongs to the URL venue (prevents cross-venue updates)
      const [existing] = await tx.select().from(pricingRules)
        .where(and(eq(pricingRules.id, params.data.id), eq(pricingRules.venueId, params.data.venueId), isNull(pricingRules.deletedAt)))
        .limit(1)
        .for("update");
      if (existing === undefined) return "not_found" as const;
      if (parsed.data.appliesFrom !== undefined || parsed.data.appliesUntil !== undefined) {
        const next = {
          appliesFrom: parsed.data.appliesFrom === undefined ? existing.appliesFrom : parsed.data.appliesFrom,
          appliesUntil: parsed.data.appliesUntil === undefined ? existing.appliesUntil : parsed.data.appliesUntil,
        };
        if (!windowIsPaired(next)) return "unpaired_window" as const;
        updateData["appliesFrom"] = next.appliesFrom;
        updateData["appliesUntil"] = next.appliesUntil;
      }
      // The dates are judged as they will be stored, one side sent or both.
      const dates = {
        validFrom: parsed.data.validFrom === undefined ? existing.validFrom : parsed.data.validFrom,
        validTo: parsed.data.validTo === undefined ? existing.validTo : parsed.data.validTo,
      };
      if (!datesInOrder(dates)) return "dates_out_of_order" as const;
      const [updated] = await tx.update(pricingRules)
        .set(updateData)
        .where(eq(pricingRules.id, existing.id))
        .returning();
      if (updated === undefined) throw new Error("Pricing rule update returned no row");
      await recordPricingRuleChange(tx, {
        kind: "updated", actorUserId: request.user.id, before: existing, after: updated, adviceKey: parsed.data.adviceKey ?? null,
      });
      return updated;
    });

    if (outcome === "not_found") {
      return reply.status(404).send({ error: "Pricing rule not found", code: "NOT_FOUND" });
    }
    if (outcome === "unpaired_window") {
      return reply.status(400).send({ error: WINDOW_PAIR_MESSAGE, code: "VALIDATION_ERROR" });
    }
    if (outcome === "dates_out_of_order") {
      return reply.status(400).send({ error: DATE_ORDER_MESSAGE, code: "VALIDATION_ERROR" });
    }
    return { data: outcome };
  });

  // DELETE /venues/:venueId/pricing/:id — PRICING_WRITE_ROLES only, soft delete
  server.delete("/:id", { preHandler: [authenticate] }, async (request, reply) => {
    const params = RuleIdParam.safeParse(request.params);
    if (!params.success) {
      return reply.status(400).send({ error: "Invalid params", code: "VALIDATION_ERROR" });
    }

    if (!canWritePricing(request.user, params.data.venueId)) return refusePricingWrite(reply);

    const deleted = await db.transaction(async (tx) => {
      // Verify rule belongs to the URL venue; the update re-checks it is live.
      const [existing] = await tx.select().from(pricingRules)
        .where(and(eq(pricingRules.id, params.data.id), eq(pricingRules.venueId, params.data.venueId), isNull(pricingRules.deletedAt)))
        .limit(1)
        .for("update");
      if (existing === undefined) return null;
      const now = new Date();
      const [marked] = await tx.update(pricingRules)
        .set({ deletedAt: now, updatedAt: now, isActive: false })
        .where(eq(pricingRules.id, existing.id))
        .returning();
      if (marked === undefined) throw new Error("Pricing rule delete returned no row");
      await recordPricingRuleChange(tx, { kind: "deleted", actorUserId: request.user.id, before: existing, after: marked });
      return marked;
    });
    if (deleted === null) {
      return reply.status(404).send({ error: "Pricing rule not found", code: "NOT_FOUND" });
    }

    return reply.status(204).send();
  });

  // POST /venues/:venueId/pricing/:id/restore — undo a delete. Only a rule
  // this venue deleted comes back; a live rule or another venue's is 404.
  server.post("/:id/restore", { preHandler: [authenticate] }, async (request, reply) => {
    const params = RuleIdParam.safeParse(request.params);
    if (!params.success) {
      return reply.status(400).send({ error: "Invalid params", code: "VALIDATION_ERROR" });
    }

    if (!canWritePricing(request.user, params.data.venueId)) return refusePricingWrite(reply);

    const parsed = RestoreRuleBody.safeParse(request.body ?? {});
    if (!parsed.success) {
      return reply.status(400).send({ error: "Validation failed", code: "VALIDATION_ERROR", details: parsed.error.issues });
    }

    const restored = await db.transaction(async (tx) => {
      const [existing] = await tx.select().from(pricingRules)
        .where(and(
          eq(pricingRules.id, params.data.id),
          eq(pricingRules.venueId, params.data.venueId),
          isNotNull(pricingRules.deletedAt),
        ))
        .limit(1)
        .for("update");
      if (existing === undefined) return null;
      const [back] = await tx.update(pricingRules)
        .set({ deletedAt: null, isActive: parsed.data.isActive, updatedAt: new Date() })
        .where(eq(pricingRules.id, existing.id))
        .returning();
      if (back === undefined) throw new Error("Pricing rule restore returned no row");
      await recordPricingRuleChange(tx, { kind: "restored", actorUserId: request.user.id, before: existing, after: back });
      return back;
    });
    if (restored === null) {
      return reply.status(404).send({ error: "Deleted pricing rule not found", code: "NOT_FOUND" });
    }

    return { data: restored };
  });

  // POST /venues/:venueId/pricing/estimate — public price calculator
  server.post("/estimate", async (request, reply) => {
    const params = VenueIdParam.safeParse(request.params);
    if (!params.success) {
      return reply.status(400).send({ error: "Invalid venue ID", code: "VALIDATION_ERROR" });
    }

    const parsed = EstimateBody.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: "Validation failed", code: "VALIDATION_ERROR", details: parsed.error.issues });
    }

    // Verify venue is active
    const [venueCheck] = await db.select({ id: venues.id }).from(venues)
      .where(and(eq(venues.id, params.data.venueId), isNull(venues.deletedAt)))
      .limit(1);
    if (venueCheck === undefined) {
      return reply.status(404).send({ error: "Venue not found", code: "NOT_FOUND" });
    }

    // Verify spaceId belongs to this venue (prevents cross-entity estimation)
    const [space] = await db.select({ id: spaces.id }).from(spaces)
      .where(and(
        eq(spaces.id, parsed.data.spaceId),
        eq(spaces.venueId, params.data.venueId),
        isNull(spaces.deletedAt),
      ))
      .limit(1);
    if (space === undefined) {
      return reply.status(404).send({ error: "Space not found in this venue", code: "NOT_FOUND" });
    }

    // Reject inverted time ranges — computeHours would silently return 0
    if (parsed.data.startTime >= parsed.data.endTime) {
      return reply.status(400).send({ error: "startTime must be before endTime", code: "VALIDATION_ERROR" });
    }

    // Fetch active, non-deleted rules for this venue
    const rows = await db.select().from(pricingRules)
      .where(and(
        eq(pricingRules.venueId, params.data.venueId),
        eq(pricingRules.isActive, true),
        isNull(pricingRules.deletedAt),
      ));

    const rules: PricingRuleInput[] = rows.map((r) => ({
      name: r.name,
      type: r.type as PricingRuleInput["type"],
      amount: parseFloat(r.amount),
      currency: r.currency,
      minHours: r.minHours,
      minGuests: r.minGuests,
      tiers: r.tiers as PricingRuleInput["tiers"],
      dayOfWeekModifiers: r.dayOfWeekModifiers as PricingRuleInput["dayOfWeekModifiers"],
      seasonalModifiers: r.seasonalModifiers as PricingRuleInput["seasonalModifiers"],
      validFrom: r.validFrom,
      validTo: r.validTo,
      isActive: r.isActive,
      spaceId: r.spaceId,
      appliesFrom: r.appliesFrom,
      appliesUntil: r.appliesUntil,
    }));

    const result = calculatePrice({
      rules,
      spaceId: parsed.data.spaceId,
      eventDate: parsed.data.eventDate,
      startTime: parsed.data.startTime,
      endTime: parsed.data.endTime,
      guestCount: parsed.data.guestCount,
    });

    return { data: result };
  });
}
