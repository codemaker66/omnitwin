import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";
import {
  CreateEventArchitectRunInputSchema,
  CreateEventArchitectOpsReviewInputSchema,
  EventArchitectCandidateSelectionSchema,
  EventArchitectOpsReviewGateSchema,
  PersistedEventArchitectRunSchema,
  SelectEventArchitectCandidateInputSchema,
  type EventArchitectOpsReviewerAuthority,
} from "@omnitwin/types";
import type { Database } from "../db/client.js";
import { authenticate, isPlatformAdmin } from "../middleware/auth.js";
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
  return ["admin", "staff", "hallkeeper", "planner"].includes(request.user.role)
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
  opts: { db: Database },
): Promise<void> {
  const { db } = opts;

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
