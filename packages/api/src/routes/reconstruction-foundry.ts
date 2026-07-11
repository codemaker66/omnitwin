import {
  ReconstructionCandidateVerificationInputSchema,
  ReconstructionReviewEvidenceArtifactRegistrationInputSchema,
  ReconstructionReleaseObjectPathSchema,
  ReconstructionReleaseAttestationVerificationInputSchema,
  ReconstructionReleaseKindSchema,
  ReconstructionReleasePromoteInputSchema,
  ReconstructionReleasePublicationInputSchema,
  ReconstructionReleaseReviewInputSchema,
  ReconstructionReleaseRollbackInputSchema,
  RuntimeSlugSchema,
} from "@omnitwin/types";
import type {
  FastifyInstance,
  FastifyReply,
  FastifyRequest,
} from "fastify";
import { z } from "zod";
import { authenticate, authorizePlatformAdmin } from "../middleware/auth.js";
import {
  ReconstructionFoundryEligibilityError,
  ReconstructionFoundryEvidenceError,
  ReconstructionFoundryIdempotencyError,
  ReconstructionFoundryIntegrationUnavailableError,
  ReconstructionFoundryNotFoundError,
  ReconstructionFoundryProviderError,
  ReconstructionFoundryRevisionConflictError,
  type ReconstructionFoundryServiceApi,
} from "../services/reconstruction-foundry.js";

const ReleaseParamsSchema = z.object({ releaseId: z.string().uuid() }).strict();
const ReleaseListQuerySchema = z.object({
  venueSlug: RuntimeSlugSchema,
  releaseKind: ReconstructionReleaseKindSchema.default("venue_twin_v1"),
}).strict();
const ChannelQuerySchema = ReleaseListQuerySchema;
const SigningPayloadQuerySchema = z.object({ reviewId: z.string().uuid() }).strict();
const VisualEvidenceQuerySchema = z.object({
  path: ReconstructionReleaseObjectPathSchema,
}).strict();

const LONG_FOUNDRY_OPERATION_TIMEOUT_MS = 15 * 60_000;

export interface ReconstructionFoundryRoutesOptions {
  readonly service: ReconstructionFoundryServiceApi;
}

function extendFoundryRequestTimeout(request: FastifyRequest): void {
  try {
    request.raw.setTimeout(LONG_FOUNDRY_OPERATION_TIMEOUT_MS);
  } catch (error: unknown) {
    // Fastify's in-memory injector does not expose a real network socket.
    // Production requests still receive the explicit long-operation timeout.
    request.log.debug({ err: error }, "foundry request timeout could not be extended");
  }
}

function validationError(reply: FastifyReply, issues: readonly z.ZodIssue[]): FastifyReply {
  return reply.status(400).send({
    error: "Request validation failed.",
    code: "VALIDATION_ERROR",
    details: issues,
  });
}

function adminServiceError(
  request: FastifyRequest,
  reply: FastifyReply,
  error: unknown,
): FastifyReply {
  if (error instanceof ReconstructionFoundryNotFoundError) {
    return reply.status(404).send({ error: error.message, code: "NOT_FOUND" });
  }
  if (error instanceof ReconstructionFoundryRevisionConflictError) {
    return reply.status(409).send({
      error: error.message,
      code: "REVISION_CONFLICT",
      details: {
        currentRevision: error.currentRevision,
        currentReleaseId: error.currentReleaseId,
      },
    });
  }
  if (error instanceof ReconstructionFoundryIdempotencyError) {
    return reply.status(409).send({
      error: error.message,
      code: "IDEMPOTENCY_KEY_REUSED",
    });
  }
  if (error instanceof z.ZodError) {
    request.log.error({ err: error }, "persisted reconstruction evidence failed validation");
    return reply.status(409).send({
      error: "Persisted reconstruction evidence failed integrity validation.",
      code: "EVIDENCE_CONFLICT",
    });
  }
  if (error instanceof ReconstructionFoundryEvidenceError) {
    return reply.status(409).send({ error: error.message, code: "EVIDENCE_CONFLICT" });
  }
  if (error instanceof ReconstructionFoundryEligibilityError) {
    return reply.status(409).send({ error: error.message, code: "RELEASE_NOT_ELIGIBLE" });
  }
  if (error instanceof ReconstructionFoundryIntegrationUnavailableError) {
    return reply.status(503).send({
      error: error.message,
      code: "FOUNDRY_INTEGRATION_UNAVAILABLE",
    });
  }
  if (error instanceof ReconstructionFoundryProviderError) {
    request.log.error({ err: error.cause }, "reconstruction foundry provider failed");
    return reply.status(503).send({
      error: "Reconstruction Foundry storage is temporarily unavailable.",
      code: "FOUNDRY_STORAGE_UNAVAILABLE",
    });
  }
  request.log.error({ err: error }, "reconstruction foundry request failed");
  return reply.status(500).send({
    error: "Reconstruction Foundry request failed.",
    code: "INTERNAL_ERROR",
  });
}

async function adminResult<T>(
  request: FastifyRequest,
  reply: FastifyReply,
  operation: () => Promise<T>,
  statusCode = 200,
): Promise<FastifyReply> {
  try {
    return reply.status(statusCode).send({ data: await operation() });
  } catch (error: unknown) {
    return adminServiceError(request, reply, error);
  }
}

export async function adminReconstructionFoundryRoutes(
  server: FastifyInstance,
  options: ReconstructionFoundryRoutesOptions,
): Promise<void> {
  const { service } = options;
  const platformAdmin = { preHandler: [authenticate, authorizePlatformAdmin()] };

  server.get("/evidence-artifacts", platformAdmin, async (request, reply) => {
    const parsed = z.object({ venueSlug: RuntimeSlugSchema }).strict().safeParse(request.query);
    if (!parsed.success) return validationError(reply, parsed.error.issues);
    return adminResult(request, reply, () => service.listReviewEvidenceArtifacts(parsed.data.venueSlug));
  });

  server.post("/evidence-artifacts", platformAdmin, async (request, reply) => {
    const parsed = ReconstructionReviewEvidenceArtifactRegistrationInputSchema.safeParse(request.body);
    if (!parsed.success) return validationError(reply, parsed.error.issues);
    return adminResult(
      request,
      reply,
      () => service.registerReviewEvidenceArtifact(parsed.data, request.user.id),
      201,
    );
  });

  server.get("/releases", platformAdmin, async (request, reply) => {
    const parsed = ReleaseListQuerySchema.safeParse(request.query);
    if (!parsed.success) return validationError(reply, parsed.error.issues);
    return adminResult(request, reply, () =>
      service.listReleases(parsed.data.venueSlug, parsed.data.releaseKind));
  });

  server.get("/releases/:releaseId", platformAdmin, async (request, reply) => {
    const parsed = ReleaseParamsSchema.safeParse(request.params);
    if (!parsed.success) return validationError(reply, parsed.error.issues);
    return adminResult(request, reply, () => service.getRelease(parsed.data.releaseId));
  });

  server.get("/releases/:releaseId/visual-evidence", platformAdmin, async (request, reply) => {
    const parsedParams = ReleaseParamsSchema.safeParse(request.params);
    if (!parsedParams.success) return validationError(reply, parsedParams.error.issues);
    const parsedQuery = VisualEvidenceQuerySchema.safeParse(request.query);
    if (!parsedQuery.success) return validationError(reply, parsedQuery.error.issues);
    try {
      const evidence = await service.getVisualEvidence(
        parsedParams.data.releaseId,
        parsedQuery.data.path,
      );
      return reply
        .header("cache-control", "private, no-store")
        .header("content-type", evidence.contentType)
        .header("content-length", String(evidence.bytes.byteLength))
        .header("x-content-type-options", "nosniff")
        .header("etag", `"sha256-${evidence.sha256}"`)
        .send(Buffer.from(evidence.bytes));
    } catch (error: unknown) {
      return adminServiceError(request, reply, error);
    }
  });

  server.post("/releases/verify-candidate", platformAdmin, async (request, reply) => {
    const parsed = ReconstructionCandidateVerificationInputSchema.safeParse(request.body);
    if (!parsed.success) return validationError(reply, parsed.error.issues);
    extendFoundryRequestTimeout(request);
    request.log.info({
      userId: request.user.id,
      candidateR2Prefix: parsed.data.candidateR2Prefix,
    }, "reconstruction candidate verification started");
    return adminResult(request, reply, async () => {
      const registration = await service.verifyCandidate(parsed.data, request.user.id);
      request.log.info({
        userId: request.user.id,
        releaseId: registration.id,
        releaseDigest: registration.manifest.releaseDigest,
        qaOutcome: registration.qaReport.outcome,
        fileCount: registration.manifest.fileCount,
        totalBytes: registration.manifest.totalBytes,
      }, "reconstruction candidate verification completed");
      return registration;
    }, 201);
  });

  server.post("/releases/:releaseId/reviews", platformAdmin, async (request, reply) => {
    const parsedParams = ReleaseParamsSchema.safeParse(request.params);
    if (!parsedParams.success) return validationError(reply, parsedParams.error.issues);
    const parsedBody = ReconstructionReleaseReviewInputSchema.safeParse(request.body);
    if (!parsedBody.success) return validationError(reply, parsedBody.error.issues);
    return adminResult(request, reply, () =>
      service.reviewRelease(parsedParams.data.releaseId, parsedBody.data, request.user.id), 201);
  });

  server.get("/releases/:releaseId/signing-payload", platformAdmin, async (request, reply) => {
    const parsedParams = ReleaseParamsSchema.safeParse(request.params);
    if (!parsedParams.success) return validationError(reply, parsedParams.error.issues);
    const parsedQuery = SigningPayloadQuerySchema.safeParse(request.query);
    if (!parsedQuery.success) return validationError(reply, parsedQuery.error.issues);
    return adminResult(request, reply, () =>
      service.getSigningPayload(parsedParams.data.releaseId, parsedQuery.data.reviewId));
  });

  server.post(
    "/releases/:releaseId/attestations/verify",
    platformAdmin,
    async (request, reply) => {
      const parsedParams = ReleaseParamsSchema.safeParse(request.params);
      if (!parsedParams.success) return validationError(reply, parsedParams.error.issues);
      const parsedBody = ReconstructionReleaseAttestationVerificationInputSchema.safeParse(
        request.body,
      );
      if (!parsedBody.success) return validationError(reply, parsedBody.error.issues);
      return adminResult(request, reply, () =>
        service.verifyAttestation(
          parsedParams.data.releaseId,
          parsedBody.data,
          request.user.id,
        ), 201);
    },
  );

  server.post("/releases/:releaseId/publish", platformAdmin, async (request, reply) => {
    const parsedParams = ReleaseParamsSchema.safeParse(request.params);
    if (!parsedParams.success) return validationError(reply, parsedParams.error.issues);
    const parsedBody = ReconstructionReleasePublicationInputSchema.safeParse(request.body);
    if (!parsedBody.success) return validationError(reply, parsedBody.error.issues);
    extendFoundryRequestTimeout(request);
    request.log.info({
      userId: request.user.id,
      releaseId: parsedParams.data.releaseId,
      releaseDigest: parsedBody.data.releaseDigest,
      reviewId: parsedBody.data.reviewId,
      attestationId: parsedBody.data.attestationId,
    }, "immutable reconstruction publication started");
    return adminResult(request, reply, async () => {
      const publication = await service.publishRelease(
        parsedParams.data.releaseId,
        parsedBody.data,
        request.user.id,
      );
      request.log.info({
        userId: request.user.id,
        releaseId: publication.releaseId,
        publicationId: publication.id,
        publicR2Prefix: publication.publicR2Prefix,
        fileCount: publication.fileCount,
        totalBytes: publication.totalBytes,
      }, "immutable reconstruction publication completed");
      return publication;
    }, 201);
  });

  server.get("/channels/production", platformAdmin, async (request, reply) => {
    const parsed = ChannelQuerySchema.safeParse(request.query);
    if (!parsed.success) return validationError(reply, parsed.error.issues);
    return adminResult(request, reply, () =>
      service.getProductionChannel(parsed.data.venueSlug, parsed.data.releaseKind));
  });

  server.get("/channels/production/history", platformAdmin, async (request, reply) => {
    const parsed = ChannelQuerySchema.safeParse(request.query);
    if (!parsed.success) return validationError(reply, parsed.error.issues);
    return adminResult(request, reply, () =>
      service.getProductionChannelHistory(parsed.data.venueSlug, parsed.data.releaseKind));
  });

  server.post("/channels/production/promote", platformAdmin, async (request, reply) => {
    const parsed = ReconstructionReleasePromoteInputSchema.safeParse(request.body);
    if (!parsed.success) return validationError(reply, parsed.error.issues);
    return adminResult(request, reply, () => service.promoteRelease(parsed.data, request.user.id));
  });

  server.post("/channels/production/rollback", platformAdmin, async (request, reply) => {
    const parsed = ReconstructionReleaseRollbackInputSchema.safeParse(request.body);
    if (!parsed.success) return validationError(reply, parsed.error.issues);
    return adminResult(request, reply, () => service.rollbackRelease(parsed.data, request.user.id));
  });
}

export async function publicReconstructionReleaseRoutes(
  server: FastifyInstance,
  options: ReconstructionFoundryRoutesOptions,
): Promise<void> {
  server.get("/active", async (request, reply) => {
    reply.header("cache-control", "no-store");
    const parsed = ChannelQuerySchema.safeParse(request.query);
    if (!parsed.success) return validationError(reply, parsed.error.issues);
    try {
      return reply.send({
        data: await options.service.getActiveRelease(
          parsed.data.venueSlug,
          parsed.data.releaseKind,
        ),
      });
    } catch (error: unknown) {
      if (error instanceof ReconstructionFoundryNotFoundError) {
        return reply.status(404).send({
          error: "No active reconstruction release exists.",
          code: "NOT_FOUND",
        });
      }
      if (
        error instanceof ReconstructionFoundryEligibilityError ||
        error instanceof ReconstructionFoundryEvidenceError ||
        error instanceof ReconstructionFoundryIntegrationUnavailableError ||
        error instanceof ReconstructionFoundryProviderError ||
        error instanceof z.ZodError
      ) {
        request.log.error({ err: error }, "active reconstruction release failed eligibility");
        return reply.status(503).send({
          error: "The active reconstruction release is temporarily unavailable.",
          code: "ACTIVE_RELEASE_UNAVAILABLE",
        });
      }
      request.log.error({ err: error }, "active reconstruction release lookup failed");
      return reply.status(500).send({
        error: "Active reconstruction release lookup failed.",
        code: "INTERNAL_ERROR",
      });
    }
  });
}
