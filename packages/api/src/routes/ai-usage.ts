import type { FastifyInstance, FastifyReply } from "fastify";
import { z } from "zod";
import { AIUsageSummaryQuerySchema, AIUsageSummarySchema } from "@omnitwin/types";
import type { Database } from "../db/client.js";
import type { Env } from "../env.js";
import { authenticate } from "../middleware/auth.js";
import { ANTHROPIC_PRICE_TABLE, monthlyAllowanceMicroUsd, readAIUsageSummary } from "../services/ai-usage.js";
import { canReadAIUsage } from "../utils/query.js";

// ---------------------------------------------------------------------------
// GET /venues/:venueId/ai-usage?months=3 (T-656) — what the venue's AI use
// has cost, by UTC month and feature: calls and how they ended, tokens
// (cache writes and reads apart) and cost in micro-US-dollars, with this
// month's allowance (spent, held by calls in flight, left). The venue's own
// managers and admins may read it, and Venviewer's platform admins; no one
// reads another venue's. Read-only: the ledger is written only by the calls.
// ---------------------------------------------------------------------------

const VenueParam = z.object({ venueId: z.uuid() }).strict();

function validationError(reply: FastifyReply, details: unknown): FastifyReply {
  return reply.status(400).send({ error: "Validation failed", code: "VALIDATION_ERROR", details });
}

export async function aiUsageRoutes(
  server: FastifyInstance,
  opts: { readonly db: Database; readonly env: Pick<Env, "AI_VENUE_MONTHLY_BUDGET_USD"> },
): Promise<void> {
  server.get("/:venueId/ai-usage", { preHandler: [authenticate] }, async (request, reply) => {
    const params = VenueParam.safeParse(request.params);
    if (!params.success) return validationError(reply, params.error.issues);
    const query = AIUsageSummaryQuerySchema.safeParse(request.query ?? {});
    if (!query.success) return validationError(reply, query.error.issues);
    if (!canReadAIUsage(request.user, params.data.venueId)) {
      return reply.status(403).send({ error: "Insufficient permissions", code: "FORBIDDEN" });
    }
    const summary = await readAIUsageSummary(opts.db, {
      venueId: params.data.venueId,
      months: query.data.months,
      limitMicroUsd: monthlyAllowanceMicroUsd(opts.env.AI_VENUE_MONTHLY_BUDGET_USD),
      priceTableVersion: ANTHROPIC_PRICE_TABLE.version,
    });
    if (summary === null) return reply.status(404).send({ error: "Venue not found", code: "NOT_FOUND" });
    return { data: AIUsageSummarySchema.parse(summary) };
  });
}
