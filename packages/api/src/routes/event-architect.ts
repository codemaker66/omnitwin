import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";
import {
  CreateEventArchitectRunInputSchema,
  CreateEventArchitectOpsReviewInputSchema,
  CreateEventBriefDraftInputSchema,
  EventArchitectCandidateSelectionSchema,
  EventArchitectOpsReviewGateSchema,
  PersistedEventArchitectRunSchema,
  SelectEventArchitectCandidateInputSchema,
  type EventArchitectOpsReviewerAuthority,
} from "@omnitwin/types";
import type { Database } from "../db/client.js";
import type { Env } from "../env.js";
import { authenticate, isPlatformAdmin } from "../middleware/auth.js";
import {
  AIAssistantDisabledError,
  DisabledAIGenerationAdapter,
  createAIStructuredGenerationAdapterFromEnv,
  type AIStructuredGenerationAdapter,
} from "../services/ai-assistant.js";
import { loadEventBriefRoom, readEventBrief } from "../services/event-brief-draft.js";
import { canAccessInternalEvent } from "../utils/query.js";
import {
  EventArchitectCandidateNotFoundError,
  EventArchitectCatalogueNotReadyError,
  EventArchitectIdempotencyConflictError,
  EventArchitectOpsReviewCandidateNotSelectedError,
  EventArchitectOpsReviewDigestConflictError,
  EventArchitectOpsReviewEvidenceIntegrityError,
  EventArchitectOpsReviewIdempotencyConflictError,
  EventArchitectOpsReviewValidityError,
  EventArchitectRequestDigestConflictError,
  EventArchitectSelectionConflictError,
  EventArchitectSourceNotFoundError,
  createEventArchitectRun,
  createEventArchitectOpsReview,
  getEventArchitectOpsReviewGate,
  getEventArchitectRun,
  loadEventArchitectCandidateScope,
  loadEventArchitectRunScope,
  selectEventArchitectCandidate,
} from "../services/event-architect.js";

const RunParamsSchema = z.object({ runId: z.string().uuid() }).strict();
const CandidateParamsSchema = z.object({ candidateId: z.string().uuid() }).strict();

function validationError(reply: FastifyReply, details: unknown): FastifyReply {
  return reply.status(400).send({ error: "Validation failed", code: "VALIDATION_ERROR", details });
}

function roleCanArchitect(request: FastifyRequest, venueId: string): "ok" | "wrong_venue" | "wrong_role" {
  if (isPlatformAdmin(request.user)) return "ok";
  if (request.user.venueId !== venueId) return "wrong_venue";
  // UserRoleSchema defines planner as the default customer role and client
  // as its legacy alias. Neither grants internal venue planning authority.
  return canAccessInternalEvent(request.user, venueId)
    ? "ok"
    : "wrong_role";
}

function requireArchitectAccess(
  request: FastifyRequest,
  reply: FastifyReply,
  venueId: string,
): boolean {
  const access = roleCanArchitect(request, venueId);
  if (access === "ok") return true;
  if (access === "wrong_venue") {
    void reply.status(404).send({ error: "Event Architect resource not found", code: "NOT_FOUND" });
  } else {
    void reply.status(403).send({ error: "Event Architect requires venue planning authority", code: "FORBIDDEN" });
  }
  return false;
}

function requireOpsReviewAuthority(
  request: FastifyRequest,
  reply: FastifyReply,
  venueId: string,
): EventArchitectOpsReviewerAuthority | null {
  if (isPlatformAdmin(request.user)) return "platform_admin";
  if (request.user.venueId !== venueId) {
    void reply.status(404).send({ error: "Event Architect resource not found", code: "NOT_FOUND" });
    return null;
  }
  if (request.user.role === "admin") return "venue_admin";
  if (request.user.role === "hallkeeper") return "venue_hallkeeper";
  if (request.user.role === "staff") return "venue_staff";
  void reply.status(403).send({
    error: "Event Architect Ops review requires venue operations authority",
    code: "FORBIDDEN",
  });
  return null;
}

function architectError(reply: FastifyReply, error: unknown): FastifyReply | null {
  if (
    error instanceof EventArchitectSourceNotFoundError ||
    error instanceof EventArchitectCandidateNotFoundError
  ) {
    return reply.status(404).send({ error: "Event Architect resource not found", code: "NOT_FOUND" });
  }
  if (error instanceof EventArchitectCatalogueNotReadyError) {
    return reply.status(409).send({
      error: "The canonical furniture catalogue is not ready for this generated plan",
      code: "ASSET_CATALOGUE_NOT_READY",
      details: { missingAssetIds: error.missingAssetIds },
    });
  }
  if (error instanceof EventArchitectSelectionConflictError) {
    return reply.status(409).send({
      error: "A different candidate has already been selected for this run",
      code: "CANDIDATE_SELECTION_CONFLICT",
    });
  }
  if (error instanceof EventArchitectRequestDigestConflictError) {
    return reply.status(409).send({
      error: "The Event Architect run changed before candidate selection",
      code: "REQUEST_DIGEST_CONFLICT",
    });
  }
  if (error instanceof EventArchitectIdempotencyConflictError) {
    return reply.status(409).send({
      error: "That idempotency key already belongs to a different Event Architect brief",
      code: "IDEMPOTENCY_KEY_REUSED",
    });
  }
  if (error instanceof EventArchitectOpsReviewCandidateNotSelectedError) {
    return reply.status(409).send({
      error: "Select this candidate before recording its Ops review",
      code: "CANDIDATE_NOT_SELECTED",
    });
  }
  if (error instanceof EventArchitectOpsReviewDigestConflictError) {
    return reply.status(409).send({
      error: "The candidate evidence changed before this review was recorded",
      code: "REVIEW_EVIDENCE_DIGEST_CONFLICT",
    });
  }
  if (error instanceof EventArchitectOpsReviewIdempotencyConflictError) {
    return reply.status(409).send({
      error: "That idempotency key already belongs to a different Ops review",
      code: "IDEMPOTENCY_KEY_REUSED",
    });
  }
  if (error instanceof EventArchitectOpsReviewValidityError) {
    return reply.status(400).send({
      error: "Ops review validity must be between one hour and 90 days",
      code: "INVALID_REVIEW_VALIDITY",
    });
  }
  if (error instanceof EventArchitectOpsReviewEvidenceIntegrityError) {
    return reply.status(409).send({
      error: "The persisted Event Architect evidence could not be verified",
      code: "SOURCE_EVIDENCE_INVALID",
    });
  }
  return null;
}

async function runArchitectCommand<T>(
  reply: FastifyReply,
  command: () => Promise<T>,
): Promise<T | FastifyReply> {
  try {
    return await command();
  } catch (error) {
    const response = architectError(reply, error);
    if (response !== null) return response;
    throw error;
  }
}

export async function eventArchitectRoutes(
  server: FastifyInstance,
  opts: {
    db: Database;
    /** Configures the provider that reads event briefs; absent, it is off. */
    env?: Env;
    /** A provider a test supplies in place of the environment's. */
    briefReader?: AIStructuredGenerationAdapter;
  },
): Promise<void> {
  const { db } = opts;
  const briefReader = opts.briefReader
    ?? (opts.env === undefined ? new DisabledAIGenerationAdapter() : createAIStructuredGenerationAdapterFromEnv(opts.env));

  // -------------------------------------------------------------------------
  // Typed event briefs (T-650). A planner's description is read by the AI
  // into a draft of the brief, with what it assumed and what the engine
  // cannot represent. The same authority as creating a run may ask; the
  // server's own "AI is off" status hides the feature; contact details are
  // scrubbed before the description is sent; the answer is an unchecked
  // draft, and nothing runs or is stored until a person generates options.
  // -------------------------------------------------------------------------

  server.get("/brief-drafts/status", { preHandler: [authenticate] }, async () => {
    return { data: briefReader.status };
  });

  server.post("/brief-drafts", {
    preHandler: [authenticate],
    // Each read is a paid model call; a person reading briefs by hand never
    // comes near this.
    config: { rateLimit: { max: 12, timeWindow: "1 minute" } },
  }, async (request, reply) => {
    const body = CreateEventBriefDraftInputSchema.safeParse(request.body);
    if (!body.success) return validationError(reply, body.error.issues);
    if (!requireArchitectAccess(request, reply, body.data.venueId)) return;
    if (!briefReader.status.configured) {
      return reply.status(503).send({
        error: briefReader.status.disabledReason ?? "AI assistant is not configured",
        code: "AI_ASSISTANT_DISABLED",
      });
    }
    const room = await loadEventBriefRoom(db, body.data.venueId, body.data.spaceId);
    if (room === null) return reply.status(404).send({ error: "Event Architect resource not found", code: "NOT_FOUND" });

    // The person who asked going away (Stop, or leaving the page) stops the
    // provider request too.
    const abandoned = new AbortController();
    const onClose = (): void => { if (!reply.raw.writableEnded) abandoned.abort(); };
    reply.raw.once("close", onClose);
    try {
      const draft = await readEventBrief(briefReader, {
        description: body.data.description,
        room,
        signal: abandoned.signal,
      });
      return { data: draft };
    } catch (err) {
      if (err instanceof AIAssistantDisabledError) {
        return reply.status(503).send({ error: err.message, code: "AI_ASSISTANT_DISABLED" });
      }
      // The errors carry a status, a reason or contract paths, never the
      // description itself.
      if (abandoned.signal.aborted) {
        request.log.info({ err }, "Event brief reading stopped by the requester");
      } else {
        request.log.error({ err }, "Event brief reading failed");
      }
      return reply.status(502).send({ error: "AI draft generation failed", code: "AI_DRAFT_GENERATION_FAILED" });
    } finally {
      reply.raw.off("close", onClose);
    }
  });

  server.post("/runs", { preHandler: [authenticate] }, async (request, reply) => {
    const body = CreateEventArchitectRunInputSchema.safeParse(request.body);
    if (!body.success) return validationError(reply, body.error.issues);
    if (!requireArchitectAccess(request, reply, body.data.venueId)) return;
    const result = await runArchitectCommand(reply, () => createEventArchitectRun(
      db,
      body.data,
      { userId: request.user.id },
    ));
    if ("statusCode" in result) return result;
    return reply.status(201).send({ data: PersistedEventArchitectRunSchema.parse(result) });
  });

  server.get("/runs/:runId", { preHandler: [authenticate] }, async (request, reply) => {
    const params = RunParamsSchema.safeParse(request.params);
    if (!params.success) return validationError(reply, params.error.issues);
    const scope = await loadEventArchitectRunScope(db, params.data.runId);
    if (scope === null || !requireArchitectAccess(request, reply, scope.venueId)) {
      if (scope === null) return reply.status(404).send({ error: "Event Architect resource not found", code: "NOT_FOUND" });
      return;
    }
    const run = await getEventArchitectRun(db, params.data.runId);
    if (run === null) return reply.status(404).send({ error: "Event Architect resource not found", code: "NOT_FOUND" });
    return { data: PersistedEventArchitectRunSchema.parse(run) };
  });

  server.post("/candidates/:candidateId/select", { preHandler: [authenticate] }, async (request, reply) => {
    const params = CandidateParamsSchema.safeParse(request.params);
    if (!params.success) return validationError(reply, params.error.issues);
    const body = SelectEventArchitectCandidateInputSchema.safeParse(request.body);
    if (!body.success) return validationError(reply, body.error.issues);
    const scope = await loadEventArchitectCandidateScope(db, params.data.candidateId);
    if (scope === null || !requireArchitectAccess(request, reply, scope.venueId)) {
      if (scope === null) return reply.status(404).send({ error: "Event Architect resource not found", code: "NOT_FOUND" });
      return;
    }
    const result = await runArchitectCommand(reply, () => selectEventArchitectCandidate(
      db,
      params.data.candidateId,
      body.data,
      { userId: request.user.id },
    ));
    if ("statusCode" in result) return result;
    return { data: EventArchitectCandidateSelectionSchema.parse(result) };
  });

  server.get("/candidates/:candidateId/ops-review", { preHandler: [authenticate] }, async (request, reply) => {
    const params = CandidateParamsSchema.safeParse(request.params);
    if (!params.success) return validationError(reply, params.error.issues);
    const scope = await loadEventArchitectCandidateScope(db, params.data.candidateId);
    if (scope === null || !requireArchitectAccess(request, reply, scope.venueId)) {
      if (scope === null) return reply.status(404).send({ error: "Event Architect resource not found", code: "NOT_FOUND" });
      return;
    }
    const gate = await getEventArchitectOpsReviewGate(db, params.data.candidateId);
    if (gate === null) return reply.status(404).send({ error: "Event Architect resource not found", code: "NOT_FOUND" });
    return { data: EventArchitectOpsReviewGateSchema.parse(gate) };
  });

  server.post("/candidates/:candidateId/ops-review", { preHandler: [authenticate] }, async (request, reply) => {
    const params = CandidateParamsSchema.safeParse(request.params);
    if (!params.success) return validationError(reply, params.error.issues);
    const body = CreateEventArchitectOpsReviewInputSchema.safeParse(request.body);
    if (!body.success) return validationError(reply, body.error.issues);
    const scope = await loadEventArchitectCandidateScope(db, params.data.candidateId);
    if (scope === null) {
      return reply.status(404).send({ error: "Event Architect resource not found", code: "NOT_FOUND" });
    }
    const reviewerAuthority = requireOpsReviewAuthority(request, reply, scope.venueId);
    if (reviewerAuthority === null) return;
    const result = await runArchitectCommand(reply, () => createEventArchitectOpsReview(
      db,
      params.data.candidateId,
      body.data,
      { userId: request.user.id, reviewerAuthority },
    ));
    if ("statusCode" in result) return result;
    return reply.status(201).send({ data: EventArchitectOpsReviewGateSchema.parse(result) });
  });
}
