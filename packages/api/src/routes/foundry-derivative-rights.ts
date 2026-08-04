import {
  FoundryDerivativeExecutionAuthorizationCandidateReservationInputV1Schema,
  FoundryDerivativeRightsRegistryAttestationRegistrationInputV1Schema,
  FoundryDerivativeRightsRegistryAttestationRevocationInputV1Schema,
  FoundryDerivativeRightsCanonicalUuidV1Schema,
  FoundryDerivativeRightsRegistryAttestationReviewInputV1Schema,
  FoundryDerivativeTermsEvidenceCustodyRegistrationInputV1Schema,
  RuntimeManifestKeySchema,
} from "@omnitwin/types";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";
import { authenticate, authorizePlatformAdmin } from "../middleware/auth.js";
import {
  FoundryDerivativeExecutionCandidateConflictError,
  FoundryDerivativeExecutionCandidateIntegrityError,
  FoundryDerivativeExecutionCandidateNotFoundError,
  type FoundryDerivativeExecutionCandidatesServiceApi,
} from "../services/foundry-derivative-execution-candidates.js";
import {
  MAX_FOUNDRY_DERIVATIVE_TERMS_EVIDENCE_BYTES,
  FoundryDerivativeRightsCustodyConflictError,
  FoundryDerivativeRightsCustodyIntegrityError,
  FoundryDerivativeRightsCustodyNotFoundError,
  type FoundryDerivativeRightsCustodyServiceApi,
} from "../services/foundry-derivative-rights-custody.js";
import { FoundryExecutionSubjectBindingV0Schema } from "../services/foundry-provider-request-authorization.js";

const MAX_CANONICAL_BASE64_CHARACTERS =
  Math.ceil(MAX_FOUNDRY_DERIVATIVE_TERMS_EVIDENCE_BYTES / 3) * 4;
const DERIVATIVE_RIGHTS_BODY_LIMIT_BYTES = 6_000_000;

const CanonicalBase64Schema = z
  .string()
  .min(4)
  .max(MAX_CANONICAL_BASE64_CHARACTERS)
  .regex(/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/u)
  .refine(
    (value) => Buffer.from(value, "base64").toString("base64") === value,
    {
      message: "evidenceBytesBase64 must be canonical padded RFC 4648 base64",
    },
  );

const CustodyRegistrationBodySchema =
  FoundryDerivativeTermsEvidenceCustodyRegistrationInputV1Schema.extend({
    evidenceBytesBase64: CanonicalBase64Schema,
    idempotencyKey: RuntimeManifestKeySchema,
  }).strict();

const CustodyParamsSchema = z
  .object({ custodyId: FoundryDerivativeRightsCanonicalUuidV1Schema })
  .strict();

const ReviewBodySchema =
  FoundryDerivativeRightsRegistryAttestationReviewInputV1Schema.extend({
    idempotencyKey: RuntimeManifestKeySchema,
  }).strict();

const RegistryAttestationBodySchema =
  FoundryDerivativeRightsRegistryAttestationRegistrationInputV1Schema.extend({
    idempotencyKey: RuntimeManifestKeySchema,
  }).strict();

const RegistryAttestationRevocationBodySchema =
  FoundryDerivativeRightsRegistryAttestationRevocationInputV1Schema.extend({
    idempotencyKey: RuntimeManifestKeySchema,
  }).strict();

const AuthorizationCandidateBodySchema =
  FoundryDerivativeExecutionAuthorizationCandidateReservationInputV1Schema.extend(
    {
      baseExecutionSubject: FoundryExecutionSubjectBindingV0Schema,
      idempotencyKey: RuntimeManifestKeySchema,
    },
  ).strict();

export interface FoundryDerivativeRightsRoutesOptions {
  readonly service: FoundryDerivativeRightsCustodyServiceApi;
  readonly executionCandidatesService?: FoundryDerivativeExecutionCandidatesServiceApi;
}

function validationError(
  reply: FastifyReply,
  issues: readonly z.ZodIssue[],
): FastifyReply {
  return reply.status(400).send({
    error: "Request validation failed.",
    code: "VALIDATION_ERROR",
    details: issues,
  });
}

function serviceError(
  request: FastifyRequest,
  reply: FastifyReply,
  error: unknown,
): FastifyReply {
  if (error instanceof FoundryDerivativeRightsCustodyNotFoundError) {
    return reply.status(404).send({ error: error.message, code: "NOT_FOUND" });
  }
  if (error instanceof FoundryDerivativeExecutionCandidateNotFoundError) {
    return reply.status(404).send({ error: error.message, code: "NOT_FOUND" });
  }
  if (error instanceof FoundryDerivativeRightsCustodyConflictError) {
    return reply
      .status(409)
      .send({ error: error.message, code: "EVIDENCE_CONFLICT" });
  }
  if (error instanceof FoundryDerivativeExecutionCandidateConflictError) {
    return reply
      .status(409)
      .send({ error: error.message, code: "EVIDENCE_CONFLICT" });
  }
  if (
    error instanceof FoundryDerivativeRightsCustodyIntegrityError ||
    error instanceof FoundryDerivativeExecutionCandidateIntegrityError ||
    error instanceof z.ZodError
  ) {
    request.log.error(
      { err: error },
      "derivative-rights custody integrity check failed",
    );
    return reply.status(409).send({
      error: "Derivative-rights custody evidence failed integrity validation.",
      code: "EVIDENCE_INTEGRITY_FAILURE",
    });
  }
  request.log.error({ err: error }, "derivative-rights custody request failed");
  return reply.status(500).send({
    error: "Derivative-rights custody request failed.",
    code: "INTERNAL_ERROR",
  });
}

export async function adminFoundryDerivativeRightsRoutes(
  server: FastifyInstance,
  options: FoundryDerivativeRightsRoutesOptions,
): Promise<void> {
  const platformAdmin = {
    preHandler: [authenticate, authorizePlatformAdmin()],
  };

  server.post(
    "/evidence-artifacts",
    { ...platformAdmin, bodyLimit: DERIVATIVE_RIGHTS_BODY_LIMIT_BYTES },
    async (request, reply) => {
      const parsed = CustodyRegistrationBodySchema.safeParse(request.body);
      if (!parsed.success) return validationError(reply, parsed.error.issues);
      const bytes = Buffer.from(parsed.data.evidenceBytesBase64, "base64");
      if (
        bytes.byteLength < 1 ||
        bytes.byteLength > MAX_FOUNDRY_DERIVATIVE_TERMS_EVIDENCE_BYTES
      ) {
        return validationError(reply, [
          {
            code: z.ZodIssueCode.custom,
            path: ["evidenceBytesBase64"],
            message: "decoded evidence must contain between 1 byte and 4 MiB",
          },
        ]);
      }
      try {
        const receipt = await options.service.registerTermsEvidence(
          {
            artifactId: parsed.data.artifactId,
            mediaType: parsed.data.mediaType,
            bytes,
            idempotencyKey: parsed.data.idempotencyKey,
          },
          request.user.id,
        );
        return reply.status(201).send({ data: receipt });
      } catch (error: unknown) {
        return serviceError(request, reply, error);
      }
    },
  );

  server.get(
    "/evidence-artifacts/:custodyId/content",
    platformAdmin,
    async (request, reply) => {
      const parsed = CustodyParamsSchema.safeParse(request.params);
      if (!parsed.success) return validationError(reply, parsed.error.issues);
      try {
        const evidence = await options.service.getTermsEvidence(
          parsed.data.custodyId,
        );
        const filename = `${evidence.receipt.artifactId}.evidence`;
        return reply
          .header("cache-control", "private, no-store")
          .header("content-type", "application/octet-stream")
          .header("content-disposition", `attachment; filename="${filename}"`)
          .header("content-length", String(evidence.bytes.byteLength))
          .header("x-content-type-options", "nosniff")
          .header("content-security-policy", "sandbox")
          .header("etag", `"${evidence.receipt.contentSha256}"`)
          .send(Buffer.from(evidence.bytes));
      } catch (error: unknown) {
        return serviceError(request, reply, error);
      }
    },
  );

  server.post("/reviews", platformAdmin, async (request, reply) => {
    const parsed = ReviewBodySchema.safeParse(request.body);
    if (!parsed.success) return validationError(reply, parsed.error.issues);
    try {
      const receipt = await options.service.reviewForRegistryAttestation(
        parsed.data,
        request.user.id,
      );
      return reply.status(201).send({ data: receipt });
    } catch (error: unknown) {
      return serviceError(request, reply, error);
    }
  });

  const executionCandidatesService = options.executionCandidatesService;
  if (executionCandidatesService !== undefined) {
    server.post("/registry-attestations", platformAdmin, async (request, reply) => {
      const parsed = RegistryAttestationBodySchema.safeParse(request.body);
      if (!parsed.success) return validationError(reply, parsed.error.issues);
      try {
        const attestation =
          await executionCandidatesService.registerRegistryAttestation(
            parsed.data,
            request.user.id,
          );
        return reply.status(201).send({ data: attestation });
      } catch (error: unknown) {
        return serviceError(request, reply, error);
      }
    });

    server.post(
      "/registry-attestation-revocations",
      platformAdmin,
      async (request, reply) => {
        const parsed = RegistryAttestationRevocationBodySchema.safeParse(
          request.body,
        );
        if (!parsed.success) return validationError(reply, parsed.error.issues);
        try {
          const revocation =
            await executionCandidatesService.revokeRegistryAttestation(
              parsed.data,
              request.user.id,
            );
          return reply.status(201).send({ data: revocation });
        } catch (error: unknown) {
          return serviceError(request, reply, error);
        }
      },
    );

    server.post(
      "/authorization-candidates",
      platformAdmin,
      async (request, reply) => {
        const parsed = AuthorizationCandidateBodySchema.safeParse(request.body);
        if (!parsed.success) return validationError(reply, parsed.error.issues);
        try {
          const candidate =
            await executionCandidatesService.reserveAuthorizationCandidate(
              parsed.data,
              request.user.id,
            );
          return reply.status(201).send({ data: candidate });
        } catch (error: unknown) {
          return serviceError(request, reply, error);
        }
      },
    );
  }
}
