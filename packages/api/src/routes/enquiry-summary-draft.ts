import type { FastifyInstance } from "fastify";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { AI_BUDGET_REACHED } from "@omnitwin/types";
import type { Database } from "../db/client.js";
import { enquiries } from "../db/schema.js";
import type { Env } from "../env.js";
import { authenticate } from "../middleware/auth.js";
import {
  AIAssistantDisabledError,
  createAIGenerationAdapterFromEnv,
  generateAIDraft,
  type AIGenerationAdapter,
} from "../services/ai-assistant.js";
import { AIBudgetReachedError, venueAllowanceMeter, type AIUsageMeter } from "../services/ai-usage.js";
import { enquirySummaryContext } from "../services/enquiry-summary-draft.js";
import { aiDraftVenue } from "../utils/query.js";

// ---------------------------------------------------------------------------
// POST /enquiries/:id/summary-draft — an AI summary of an enquiry for the
// venue's own team (release audit ai-1). The browser sends nothing but the
// enquiry's id; what the AI is told is built here from the enquiry as the
// venue holds it (services/enquiry-summary-draft.ts), with no name, contact
// details or ids. Only the venue's floor or commercial team may ask, for an
// enquiry at the venue they work at: another venue's enquiry is not found
// (404), so its existence is not told. With nothing to summarise it is
// refused rather than invented. The draft is review-gated and never sent.
//
// The call is the venue's (T-656): held to its monthly AI allowance (429
// AI_BUDGET_REACHED once used, and nothing is sent) and recorded in the AI
// usage ledger as an enquiry summary.
// ---------------------------------------------------------------------------

const IdParam = z.object({ id: z.uuid() });

export async function enquirySummaryDraftRoutes(
  server: FastifyInstance,
  opts: {
    readonly db: Database;
    readonly env: Env;
    readonly adapter?: AIGenerationAdapter;
    /** Holds each call to its venue's allowance and records it; the venue allowance meter unless given. */
    readonly aiUsage?: AIUsageMeter;
  },
): Promise<void> {
  const { db } = opts;
  const adapter = opts.adapter
    ?? createAIGenerationAdapterFromEnv(opts.env, opts.aiUsage ?? venueAllowanceMeter(db, opts.env, server.log));

  server.post("/:id/summary-draft", { preHandler: [authenticate] }, async (request, reply) => {
    const params = IdParam.safeParse(request.params);
    if (!params.success) {
      return reply.status(400).send({ error: "Invalid ID", code: "VALIDATION_ERROR" });
    }
    const venueId = aiDraftVenue(request.user);
    if (venueId === null) {
      return reply.status(403).send({ error: "AI drafts are made for the venue you work at", code: "FORBIDDEN" });
    }
    const [enquiry] = await db.select().from(enquiries)
      .where(and(eq(enquiries.id, params.data.id), eq(enquiries.venueId, venueId)))
      .limit(1);
    if (enquiry === undefined) {
      return reply.status(404).send({ error: "Enquiry not found", code: "NOT_FOUND" });
    }
    if (!adapter.status.configured) {
      return reply.status(503).send({
        error: adapter.status.disabledReason ?? "AI assistant is not configured",
        code: "AI_ASSISTANT_DISABLED",
      });
    }
    const { context, hasSomething } = await enquirySummaryContext(db, enquiry);
    if (!hasSomething) {
      return reply.status(422).send({
        error: "This enquiry has no event details or words from the guest to summarise yet",
        code: "NOTHING_TO_DRAFT_FROM",
      });
    }
    try {
      const draft = await generateAIDraft(adapter, { useCase: "enquiry_summary", context }, { venueId, userId: request.user.id });
      return { data: draft };
    } catch (err) {
      if (err instanceof AIAssistantDisabledError) {
        return reply.status(503).send({ error: err.message, code: "AI_ASSISTANT_DISABLED" });
      }
      if (err instanceof AIBudgetReachedError) {
        return reply.status(429).send({ error: err.message, code: AI_BUDGET_REACHED });
      }
      request.log.error({ err }, "Enquiry summary draft failed");
      return reply.status(502).send({ error: "AI draft generation failed", code: "AI_DRAFT_GENERATION_FAILED" });
    }
  });
}
