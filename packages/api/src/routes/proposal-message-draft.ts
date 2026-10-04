import type { FastifyInstance } from "fastify";
import { and, eq, isNull } from "drizzle-orm";
import { z } from "zod";
import { isProposalEditable, type ProposalStatus } from "@omnitwin/types";
import type { Database } from "../db/client.js";
import { proposals } from "../db/schema.js";
import type { Env } from "../env.js";
import { authenticate, isPlatformAdmin } from "../middleware/auth.js";
import {
  AIAssistantDisabledError,
  createAIGenerationAdapterFromEnv,
  generateAIDraft,
  type AIGenerationAdapter,
} from "../services/ai-assistant.js";
import { messageDraftContext } from "../services/proposal-message-draft.js";
import { canManageCommercial } from "../utils/query.js";

// ---------------------------------------------------------------------------
// POST /proposals/:id/message-draft — an AI draft of a proposal's message to
// its client (roadmap X1, "Use in proposal"). Only the venue's commercial team
// may ask, only while the proposal can take a new version, and only where a
// provider is configured. What the AI is told is built on the server from the
// proposal's own venue (services/proposal-message-draft.ts); the browser sends
// nothing but the proposal's id. With nothing to draw on (no event details,
// enquiry or words from the client) it is refused rather than invented. The
// answer says what the AI drew on. The draft is review-gated and never sent:
// the composer shows it, and the booker chooses to use it.
// ---------------------------------------------------------------------------

const IdParam = z.object({ id: z.string().uuid() });

export async function proposalMessageDraftRoutes(
  server: FastifyInstance,
  opts: { readonly db: Database; readonly env: Env; readonly adapter?: AIGenerationAdapter },
): Promise<void> {
  const { db } = opts;
  const adapter = opts.adapter ?? createAIGenerationAdapterFromEnv(opts.env);

  server.post("/:id/message-draft", { preHandler: [authenticate] }, async (request, reply) => {
    const params = IdParam.safeParse(request.params);
    if (!params.success) {
      return reply.status(400).send({ error: "Invalid ID", code: "VALIDATION_ERROR" });
    }
    const [proposal] = await db.select().from(proposals)
      .where(and(eq(proposals.id, params.data.id), isNull(proposals.deletedAt)))
      .limit(1);
    if (proposal === undefined) {
      return reply.status(404).send({ error: "Proposal not found", code: "NOT_FOUND" });
    }
    if (!canManageCommercial(request.user, proposal.venueId)) {
      return reply.status(403).send({ error: "Insufficient permissions", code: "FORBIDDEN" });
    }
    if (!isPlatformAdmin(request.user) && !isProposalEditable(proposal.status as ProposalStatus)) {
      return reply.status(422).send({ error: "Proposal content is frozen in its current status", code: "NOT_EDITABLE" });
    }
    if (!adapter.status.configured) {
      return reply.status(503).send({
        error: adapter.status.disabledReason ?? "AI assistant is not configured",
        code: "AI_ASSISTANT_DISABLED",
      });
    }
    const { context, drewOn } = await messageDraftContext(db, proposal);
    if (!drewOn.event && !drewOn.enquiry && !drewOn.clientWords) {
      return reply.status(422).send({
        error: "This proposal has no event details, enquiry or words from the client to draft from yet",
        code: "NOTHING_TO_DRAFT_FROM",
      });
    }
    try {
      const draft = await generateAIDraft(adapter, { useCase: "proposal_draft", context });
      return { data: { draft, drewOn } };
    } catch (err) {
      if (err instanceof AIAssistantDisabledError) {
        return reply.status(503).send({ error: err.message, code: "AI_ASSISTANT_DISABLED" });
      }
      request.log.error({ err }, "Proposal message draft failed");
      return reply.status(502).send({ error: "AI draft generation failed", code: "AI_DRAFT_GENERATION_FAILED" });
    }
  });
}
