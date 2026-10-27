import type { FastifyInstance, FastifyReply } from "fastify";
import { AI_BUDGET_REACHED, CreateAIDraftRequestSchema } from "@omnitwin/types";
import type { Database } from "../db/client.js";
import type { Env } from "../env.js";
import { authenticate } from "../middleware/auth.js";
import {
  AIAssistantDisabledError,
  createAIGenerationAdapterFromEnv,
  generateAIDraft,
  scrubDraftContext,
  type AIGenerationAdapter,
} from "../services/ai-assistant.js";
import { AIBudgetReachedError, venueAllowanceMeter, type AIUsageMeter } from "../services/ai-usage.js";
import { aiDraftVenue } from "../utils/query.js";

// ---------------------------------------------------------------------------
// /ai — the AI provider's status and the general drafts (enquiry summaries,
// BEO wording, explanations) behind the draft panels on staff surfaces.
//
// A draft is a venue's call (T-656): it is attributed to the venue the person
// asking works at, held to that venue's monthly AI allowance (429
// AI_BUDGET_REACHED once it is used, and nothing is sent) and recorded in the
// AI usage ledger. So only the venue's own floor or commercial team may ask:
// an account with no venue, or a client's, cannot spend a venue's allowance.
//
// The screen builds a general draft's context, so the server holds it to the
// privacy rule before any provider reads it (release audit ai-1): contact
// details, people's names and record ids are dropped and every email address
// and phone number in its words is taken out (scrubDraftContext). An
// enquiry's summary is built on the server from the enquiry itself
// (routes/enquiry-summary-draft.ts); a summary sent here is held to the same
// rule.
// ---------------------------------------------------------------------------

function validationError(reply: FastifyReply, details: unknown): FastifyReply {
  return reply.status(400).send({ error: "Validation failed", code: "VALIDATION_ERROR", details });
}

export async function aiAssistantRoutes(
  server: FastifyInstance,
  opts: {
    readonly env: Env;
    readonly db: Database;
    /** The provider; the environment's unless a test names one. */
    readonly adapter?: AIGenerationAdapter;
    /** Holds each draft to its venue's allowance and records it; the venue allowance meter unless given. */
    readonly aiUsage?: AIUsageMeter;
  },
): Promise<void> {
  const adapter = opts.adapter
    ?? createAIGenerationAdapterFromEnv(opts.env, opts.aiUsage ?? venueAllowanceMeter(opts.db, opts.env, server.log));

  server.get("/status", { preHandler: [authenticate] }, async () => {
    return { data: adapter.status };
  });

  server.post("/drafts", { preHandler: [authenticate] }, async (request, reply) => {
    const parsed = CreateAIDraftRequestSchema.safeParse(request.body);
    if (!parsed.success) return validationError(reply, parsed.error.issues);
    const venueId = aiDraftVenue(request.user);
    if (venueId === null) {
      return reply.status(403).send({ error: "AI drafts are made for the venue you work at", code: "FORBIDDEN" });
    }
    if (!adapter.status.configured) {
      return reply.status(503).send({
        error: adapter.status.disabledReason ?? "AI assistant is not configured",
        code: "AI_ASSISTANT_DISABLED",
      });
    }
    try {
      const draft = await generateAIDraft(
        adapter,
        { ...parsed.data, context: scrubDraftContext(parsed.data.context) },
        { venueId, userId: request.user.id },
      );
      return { data: draft };
    } catch (err) {
      if (err instanceof AIAssistantDisabledError) {
        return reply.status(503).send({
          error: err.message,
          code: "AI_ASSISTANT_DISABLED",
        });
      }
      if (err instanceof AIBudgetReachedError) {
        return reply.status(429).send({ error: err.message, code: AI_BUDGET_REACHED });
      }
      request.log.error({ err }, "AI draft generation failed");
      return reply.status(502).send({
        error: "AI draft generation failed",
        code: "AI_DRAFT_GENERATION_FAILED",
      });
    }
  });
}
