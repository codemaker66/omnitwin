import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { eq, and, isNull } from "drizzle-orm";
import { pricingRules, spaces, venues } from "../db/schema.js";
import type { Database } from "../db/client.js";
import { authenticate } from "../middleware/auth.js";
import { canManageVenue } from "../utils/query.js";
import { calculatePrice } from "../services/price-calculator.js";
import type { PricingRuleInput } from "../services/price-calculator.js";

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
  validFrom: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
  validTo: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
  isActive: z.boolean().default(true),
});

const UpdateRuleBody = CreateRuleBody.partial();

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

  // POST /venues/:venueId/pricing — hallkeeper or admin
  server.post("/", { preHandler: [authenticate] }, async (request, reply) => {
    const params = VenueIdParam.safeParse(request.params);
    if (!params.success) {
      return reply.status(400).send({ error: "Invalid venue ID", code: "VALIDATION_ERROR" });
    }

    if (!canManageVenue(request.user, params.data.venueId)) {
      return reply.status(403).send({ error: "Insufficient permissions", code: "FORBIDDEN" });
    }

    const parsed = CreateRuleBody.safeParse(request.body);
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

    const [rule] = await db.insert(pricingRules).values({
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
    }).returning();

    return reply.status(201).send({ data: rule });
  });

  // PATCH /venues/:venueId/pricing/:id — hallkeeper or admin
  server.patch("/:id", { preHandler: [authenticate] }, async (request, reply) => {
    const params = RuleIdParam.safeParse(request.params);
    if (!params.success) {
      return reply.status(400).send({ error: "Invalid params", code: "VALIDATION_ERROR" });
    }

    if (!canManageVenue(request.user, params.data.venueId)) {
      return reply.status(403).send({ error: "Insufficient permissions", code: "FORBIDDEN" });
    }

    const parsed = UpdateRuleBody.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: "Validation failed", code: "VALIDATION_ERROR", details: parsed.error.issues });
    }

    // Verify rule exists AND belongs to the URL venue (prevents cross-venue updates)
    const [existing] = await db.select().from(pricingRules)
      .where(and(eq(pricingRules.id, params.data.id), eq(pricingRules.venueId, params.data.venueId), isNull(pricingRules.deletedAt)))
      .limit(1);
    if (existing === undefined) {
      return reply.status(404).send({ error: "Pricing rule not found", code: "NOT_FOUND" });
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

    const [updated] = await db.update(pricingRules)
      .set(updateData)
      .where(eq(pricingRules.id, params.data.id))
      .returning();

    return { data: updated };
  });

  // DELETE /venues/:venueId/pricing/:id — hallkeeper or admin, soft delete
  server.delete("/:id", { preHandler: [authenticate] }, async (request, reply) => {
    const params = RuleIdParam.safeParse(request.params);
    if (!params.success) {
      return reply.status(400).send({ error: "Invalid params", code: "VALIDATION_ERROR" });
    }

    if (!canManageVenue(request.user, params.data.venueId)) {
      return reply.status(403).send({ error: "Insufficient permissions", code: "FORBIDDEN" });
    }

    // Verify rule belongs to the URL venue
    const [existing] = await db.select().from(pricingRules)
      .where(and(eq(pricingRules.id, params.data.id), eq(pricingRules.venueId, params.data.venueId), isNull(pricingRules.deletedAt)))
      .limit(1);
    if (existing === undefined) {
      return reply.status(404).send({ error: "Pricing rule not found", code: "NOT_FOUND" });
    }

    await db.update(pricingRules)
      .set({ deletedAt: new Date(), updatedAt: new Date(), isActive: false })
      .where(eq(pricingRules.id, params.data.id));

    return reply.status(204).send();
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
