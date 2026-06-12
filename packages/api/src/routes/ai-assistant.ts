import type { FastifyInstance, FastifyReply } from "fastify";
import { CreateAIDraftRequestSchema } from "@omnitwin/types";
import type { Env } from "../env.js";
import { authenticate } from "../middleware/auth.js";
import {
  AIAssistantDisabledError,
  createAIGenerationAdapterFromEnv,
  generateAIDraft,
} from "../services/ai-assistant.js";

function validationError(reply: FastifyReply, details: unknown): FastifyReply {
  return reply.status(400).send({ error: "Validation failed", code: "VALIDATION_ERROR", details });
}

export async function aiAssistantRoutes(
  server: FastifyInstance,
  opts: { readonly env: Env },
): Promise<void> {
  const adapter = createAIGenerationAdapterFromEnv(opts.env);

  server.get("/status", { preHandler: [authenticate] }, async () => {
    return { data: adapter.status };
  });

  server.post("/drafts", { preHandler: [authenticate] }, async (request, reply) => {
    const parsed = CreateAIDraftRequestSchema.safeParse(request.body);
    if (!parsed.success) return validationError(reply, parsed.error.issues);
    if (!adapter.status.configured) {
      return reply.status(503).send({
        error: adapter.status.disabledReason ?? "AI assistant is not configured",
        code: "AI_ASSISTANT_DISABLED",
      });
    }
    try {
      const draft = await generateAIDraft(adapter, parsed.data);
      return { data: draft };
    } catch (err) {
      if (err instanceof AIAssistantDisabledError) {
        return reply.status(503).send({
          error: err.message,
          code: "AI_ASSISTANT_DISABLED",
        });
      }
      request.log.error({ err }, "AI draft generation failed");
      return reply.status(502).send({
        error: "AI draft generation failed",
        code: "AI_DRAFT_GENERATION_FAILED",
      });
    }
  });
}
