import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { and, eq } from "drizzle-orm";
import { PricingAdviceDismissalSchema, PricingAdviceKeySchema } from "@omnitwin/types";
import { pricingRules } from "../db/schema.js";
import type { Database } from "../db/client.js";
import { authenticate } from "../middleware/auth.js";
import { canManageCommercial, canWritePricing } from "../utils/query.js";
import { pricingWriteRefusal } from "../services/pricing-rule-audit.js";
import { loadPricingAdvice, loadPricingDesk, recordAdviceDecision } from "../services/pricing-desk-data.js";

// ---------------------------------------------------------------------------
// The Pricing desk (Blake, 17 October 2026): a venue's own price list, kept
// from its workspace.
//
//   GET    /venues/:venueId/pricing-desk                         the list
//   GET    /venues/:venueId/pricing-desk/advice                  suggestions
//   POST   /venues/:venueId/pricing-desk/advice/dismissals       dismiss one
//   DELETE /venues/:venueId/pricing-desk/advice/dismissals/:key  bring it back
//
// Who reads what:
//   - The list, with who changed each rate and when, is the commercial team's
//     (canManageCommercial: admin, manager, staff, sales), as are the prices
//     themselves (/venues/:venueId/pricing): a visitor is asked to enquire
//     for a quote and never shown a price. The hallkeeper does not see prices
//     (goal 18 decision 6b).
//   - Suggestions are for the people who set prices (canWritePricing: admin
//     and manager), so there is one price sheet everyone else quotes from.
//   - Rates themselves are changed through /venues/:venueId/pricing, gated
//     the same way; this file writes no price.
// ---------------------------------------------------------------------------

const VenueIdParam = z.object({ venueId: z.uuid() });
const KeyParam = z.object({ venueId: z.uuid(), key: PricingAdviceKeySchema });

/** A year and a half ahead by default: peak Saturdays sell 12 to 18 months
 *  out (docs/research/r6-revenue-management.md). */
const AdviceQuery = z.object({
  days: z.coerce.number().int().min(7).max(730).default(548),
  limit: z.coerce.number().int().min(1).max(300).default(150),
}).strict();

function refused(): { readonly error: string; readonly code: "FORBIDDEN" } {
  return { error: pricingWriteRefusal(), code: "FORBIDDEN" };
}

export async function pricingDeskRoutes(server: FastifyInstance, opts: { db: Database }): Promise<void> {
  const { db } = opts;

  server.get("/", { preHandler: [authenticate] }, async (request, reply) => {
    const params = VenueIdParam.safeParse(request.params);
    if (!params.success) return reply.status(400).send({ error: "Invalid venue ID", code: "VALIDATION_ERROR" });
    if (!canManageCommercial(request.user, params.data.venueId)) {
      return reply.status(403).send({ error: "The price list is kept by the venue's own team.", code: "FORBIDDEN" });
    }
    const desk = await loadPricingDesk(db, params.data.venueId);
    if (desk === null) return reply.status(404).send({ error: "Venue not found", code: "NOT_FOUND" });
    reply.header("Cache-Control", "private, no-store");
    return { data: { ...desk, canSetPrices: canWritePricing(request.user, params.data.venueId) } };
  });

  server.get("/advice", { preHandler: [authenticate] }, async (request, reply) => {
    const params = VenueIdParam.safeParse(request.params);
    if (!params.success) return reply.status(400).send({ error: "Invalid venue ID", code: "VALIDATION_ERROR" });
    if (!canWritePricing(request.user, params.data.venueId)) return reply.status(403).send(refused());
    const query = AdviceQuery.safeParse(request.query ?? {});
    if (!query.success) {
      return reply.status(400).send({ error: "Invalid query", code: "VALIDATION_ERROR", details: query.error.issues });
    }
    const advice = await loadPricingAdvice(db, params.data.venueId, {
      now: new Date(), horizonDays: query.data.days, limit: query.data.limit,
    });
    if (advice === null) return reply.status(404).send({ error: "Venue not found", code: "NOT_FOUND" });
    reply.header("Cache-Control", "private, no-store");
    return { data: advice };
  });

  /** The rate a key names, if it is one of this venue's. */
  async function ruleOfKey(venueId: string, key: string): Promise<{ readonly name: string } | null> {
    const [rule] = await db.select({ name: pricingRules.name }).from(pricingRules)
      .where(and(eq(pricingRules.id, key.slice(0, 36)), eq(pricingRules.venueId, venueId)))
      .limit(1);
    return rule ?? null;
  }

  server.post("/advice/dismissals", { preHandler: [authenticate] }, async (request, reply) => {
    const params = VenueIdParam.safeParse(request.params);
    if (!params.success) return reply.status(400).send({ error: "Invalid venue ID", code: "VALIDATION_ERROR" });
    if (!canWritePricing(request.user, params.data.venueId)) return reply.status(403).send(refused());
    const body = PricingAdviceDismissalSchema.safeParse(request.body);
    if (!body.success) {
      return reply.status(400).send({ error: "Validation failed", code: "VALIDATION_ERROR", details: body.error.issues });
    }
    const rule = await ruleOfKey(params.data.venueId, body.data.key);
    if (rule === null) return reply.status(404).send({ error: "Suggestion not found", code: "NOT_FOUND" });
    await recordAdviceDecision(db, {
      venueId: params.data.venueId, key: body.data.key, ruleName: rule.name, date: body.data.key.slice(37, 47),
      actorUserId: request.user.id, decision: "dismissed",
    });
    return reply.status(201).send({ data: { key: body.data.key, dismissed: true } });
  });

  server.delete("/advice/dismissals/:key", { preHandler: [authenticate] }, async (request, reply) => {
    const params = KeyParam.safeParse(request.params);
    if (!params.success) return reply.status(400).send({ error: "Invalid params", code: "VALIDATION_ERROR" });
    if (!canWritePricing(request.user, params.data.venueId)) return reply.status(403).send(refused());
    const rule = await ruleOfKey(params.data.venueId, params.data.key);
    if (rule === null) return reply.status(404).send({ error: "Suggestion not found", code: "NOT_FOUND" });
    await recordAdviceDecision(db, {
      venueId: params.data.venueId, key: params.data.key, ruleName: rule.name, date: params.data.key.slice(37, 47),
      actorUserId: request.user.id, decision: "restored",
    });
    return { data: { key: params.data.key, dismissed: false } };
  });
}
