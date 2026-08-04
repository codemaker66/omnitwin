import { computeFoundryExecutionSubjectSha256 } from "@omnitwin/reconstruction-foundry";
import Fastify, { type FastifyInstance } from "fastify";
import { describe, expect, it, vi } from "vitest";
import { adminFoundryDerivativeRightsRoutes } from "../routes/foundry-derivative-rights.js";
import {
  FoundryDerivativeExecutionCandidateConflictError,
  FoundryDerivativeExecutionCandidateIntegrityError,
  type FoundryDerivativeExecutionCandidatesServiceApi,
} from "../services/foundry-derivative-execution-candidates.js";
import type { FoundryDerivativeRightsCustodyServiceApi } from "../services/foundry-derivative-rights-custody.js";
import { FoundryExecutionSubjectBindingV0Schema } from "../services/foundry-provider-request-authorization.js";

process.env["NODE_ENV"] = "test";

const ACTOR_ID = "10000000-0000-4000-8000-000000000004";
const ATTESTATION_ID = "10000000-0000-4000-8000-000000000005";
const REVIEW_ID = "10000000-0000-4000-8000-000000000006";
const CUSTODY_ID = "10000000-0000-4000-8000-000000000007";
const SHA = (character: string): string => `sha256:${character.repeat(64)}`;

function token(platformRole: "none" | "operator" | "admin"): string {
  return JSON.stringify({
    id: ACTOR_ID,
    email: "foundry@example.com",
    name: "Foundry Operator",
    role: "admin",
    platformRole,
    venueId: null,
  });
}

function baseExecutionSubject() {
  return FoundryExecutionSubjectBindingV0Schema.parse({
    schemaVersion: "omnitwin.foundry.execution-subject.v0",
    subjectId: "normalize-envelope",
    projectId: "grand-hall",
    jobSpecSha256: SHA("a"),
    executionEnvelopeSha256: SHA("b"),
    ingestManifestSha256: SHA("c"),
    intakeAdmissionResultSha256: SHA("d"),
    intakeStagingIndexSha256: SHA("e"),
    providerPlanSha256: SHA("f"),
    executionPolicySha256: SHA("0"),
    executionConfirmationSha256: SHA("1"),
    rightsApprovalSha256: SHA("2"),
    rightsPolicyEvidenceSha256: SHA("3"),
    rightsPolicyDefinitionSha256: SHA("4"),
    computeApprovalSha256: null,
    providerKind: "local_cpu",
    providerAdapterId: "local-adapter",
    providerAdapterVersion: "1.0.0",
    providerAdapterArtifactSha256: SHA("5"),
    providerDeploymentSha256: SHA("6"),
    workerProfileSha256s: [SHA("7")],
    pricingSnapshotSha256: SHA("8"),
    pricingSnapshotExpiresAt: "2026-07-14T11:00:00.000Z",
    createdAt: "2026-07-14T10:00:00.000Z",
    dispatchDeadline: "2026-07-14T10:30:00.000Z",
    maximumAttempts: 1,
    budgetPolicy: {
      currency: "USD",
      costWarningMicroUsd: "500",
      costHardStopMicroUsd: "1000",
      terminationReserveMicroUsd: "100",
      absoluteCostCapMicroUsd: "2000",
      costObservationMaximumAgeSeconds: 60,
    },
    checkpointContract: null,
  });
}

function attestationBody() {
  return {
    approvalId: "normalize-rights-approval",
    derivativeRightsApprovalSha256: SHA("9"),
    reviewId: REVIEW_ID,
    reviewReceiptSha256: SHA("a"),
    custodyId: CUSTODY_ID,
    custodyReceiptSha256: SHA("b"),
    idempotencyKey: "attestation-1",
  };
}

function revocationBody() {
  return {
    attestationId: ATTESTATION_ID,
    registryAttestationSha256: SHA("c"),
    reason: "Registry evidence withdrawn.",
    idempotencyKey: "attestation-revocation-1",
  };
}

function candidateBody() {
  const subject = baseExecutionSubject();
  return {
    baseExecutionSubjectSha256: computeFoundryExecutionSubjectSha256(subject),
    baseExecutionSubject: subject,
    projectId: subject.projectId,
    jobId: "normalize-job",
    jobSpecSha256: subject.jobSpecSha256,
    executionEnvelopeSha256: subject.executionEnvelopeSha256,
    ingestManifestSha256: subject.ingestManifestSha256,
    jobSubjectSha256: SHA("d"),
    registryAttestationSha256: SHA("c"),
    bindingSetSha256: SHA("e"),
    restrictionLineageSetSha256: SHA("f"),
    outputPolicySha256: SHA("0"),
    idempotencyKey: "candidate-1",
  };
}

function custodyService(): FoundryDerivativeRightsCustodyServiceApi {
  return {
    registerTermsEvidence: vi.fn(),
    getTermsEvidence: vi.fn(),
    reviewForRegistryAttestation: vi.fn(),
  };
}

function candidatesService(
  overrides: Partial<FoundryDerivativeExecutionCandidatesServiceApi> = {},
): FoundryDerivativeExecutionCandidatesServiceApi {
  return {
    registerRegistryAttestation: vi.fn(() =>
      Promise.resolve({
        registryAuthority: "authenticated_registry_attestation_v1",
        executionEligible: false,
      } as never),
    ),
    revokeRegistryAttestation: vi.fn(() =>
      Promise.resolve({
        registryAuthority: "authenticated_registry_attestation_v1",
        executionEligible: false,
      } as never),
    ),
    reserveAuthorizationCandidate: vi.fn(() =>
      Promise.resolve({
        authority: "none",
        executionEligible: false,
        dispatchEnabled: false,
        outputDisposition: "quarantine_only",
      } as never),
    ),
    ...overrides,
  };
}

async function routeServer(
  api: FoundryDerivativeExecutionCandidatesServiceApi,
): Promise<FastifyInstance> {
  const server = Fastify({ logger: false });
  await server.register(adminFoundryDerivativeRightsRoutes, {
    prefix: "/admin/reconstruction-foundry/derivative-rights",
    service: custodyService(),
    executionCandidatesService: api,
  });
  await server.ready();
  return server;
}

describe("Foundry derivative execution V1 admin HTTP surface", () => {
  it("requires a platform administrator for all authenticated registry operations", async () => {
    const server = await routeServer(candidatesService());
    try {
      for (const request of [
        { url: "/registry-attestations", payload: attestationBody() },
        {
          url: "/registry-attestation-revocations",
          payload: revocationBody(),
        },
        { url: "/authorization-candidates", payload: candidateBody() },
      ]) {
        const anonymous = await server.inject({
          method: "POST",
          url: `/admin/reconstruction-foundry/derivative-rights${request.url}`,
          payload: request.payload,
        });
        expect(anonymous.statusCode).toBe(401);
        const operator = await server.inject({
          method: "POST",
          url: `/admin/reconstruction-foundry/derivative-rights${request.url}`,
          headers: { authorization: `Bearer ${token("operator")}` },
          payload: request.payload,
        });
        expect(operator.statusCode).toBe(403);
      }
    } finally {
      await server.close();
    }
  });

  it("derives the actor and exposes only inert attestation and candidate responses", async () => {
    const registerRegistryAttestation = vi.fn(() =>
      Promise.resolve({
        registryAuthority: "authenticated_registry_attestation_v1",
        executionEligible: false,
      } as never),
    );
    const revokeRegistryAttestation = vi.fn(() =>
      Promise.resolve({
        registryAuthority: "authenticated_registry_attestation_v1",
        executionEligible: false,
      } as never),
    );
    const reserveAuthorizationCandidate = vi.fn(() =>
      Promise.resolve({
        authority: "none",
        executionEligible: false,
        dispatchEnabled: false,
        outputDisposition: "quarantine_only",
      } as never),
    );
    const server = await routeServer(
      candidatesService({
        registerRegistryAttestation,
        revokeRegistryAttestation,
        reserveAuthorizationCandidate,
      }),
    );
    const headers = { authorization: `Bearer ${token("admin")}` };
    try {
      const attestation = await server.inject({
        method: "POST",
        url: "/admin/reconstruction-foundry/derivative-rights/registry-attestations",
        headers,
        payload: attestationBody(),
      });
      const revocation = await server.inject({
        method: "POST",
        url: "/admin/reconstruction-foundry/derivative-rights/registry-attestation-revocations",
        headers,
        payload: revocationBody(),
      });
      const candidate = await server.inject({
        method: "POST",
        url: "/admin/reconstruction-foundry/derivative-rights/authorization-candidates",
        headers,
        payload: candidateBody(),
      });
      expect([attestation.statusCode, revocation.statusCode, candidate.statusCode]).toEqual([
        201,
        201,
        201,
      ]);
      expect(registerRegistryAttestation).toHaveBeenCalledWith(
        attestationBody(),
        ACTOR_ID,
      );
      expect(revokeRegistryAttestation).toHaveBeenCalledWith(
        revocationBody(),
        ACTOR_ID,
      );
      expect(reserveAuthorizationCandidate).toHaveBeenCalledWith(
        candidateBody(),
        ACTOR_ID,
      );
      expect(candidate.json().data).toEqual({
        authority: "none",
        executionEligible: false,
        dispatchEnabled: false,
        outputDisposition: "quarantine_only",
      });
    } finally {
      await server.close();
    }
  });

  it("rejects caller-supplied authority, identities, times, and unknown fields", async () => {
    const registerRegistryAttestation = vi.fn();
    const reserveAuthorizationCandidate = vi.fn();
    const server = await routeServer(
      candidatesService({
        registerRegistryAttestation,
        reserveAuthorizationCandidate,
      }),
    );
    const headers = { authorization: `Bearer ${token("admin")}` };
    try {
      for (const extra of [
        { attestedByUserId: ACTOR_ID },
        { attestedAt: "2026-07-14T10:00:00.000Z" },
        { registryAuthority: "authenticated_registry_attestation_v1" },
        { executionEligible: false },
      ]) {
        const response = await server.inject({
          method: "POST",
          url: "/admin/reconstruction-foundry/derivative-rights/registry-attestations",
          headers,
          payload: { ...attestationBody(), ...extra },
        });
        expect(response.statusCode).toBe(400);
      }
      for (const extra of [
        { reservedByUserId: ACTOR_ID },
        { assembledAt: "2026-07-14T10:00:00.000Z" },
        { authority: "none" },
        { dispatchEnabled: false },
      ]) {
        const response = await server.inject({
          method: "POST",
          url: "/admin/reconstruction-foundry/derivative-rights/authorization-candidates",
          headers,
          payload: { ...candidateBody(), ...extra },
        });
        expect(response.statusCode).toBe(400);
      }
      expect(registerRegistryAttestation).not.toHaveBeenCalled();
      expect(reserveAuthorizationCandidate).not.toHaveBeenCalled();
    } finally {
      await server.close();
    }
  });

  it("maps uniqueness to conflict and canonical trigger rejection to integrity failure", async () => {
    const server = await routeServer(
      candidatesService({
        registerRegistryAttestation: () =>
          Promise.reject(
            new FoundryDerivativeExecutionCandidateConflictError(
              "Already registered.",
            ),
          ),
        reserveAuthorizationCandidate: () =>
          Promise.reject(
            new FoundryDerivativeExecutionCandidateIntegrityError(
              "No longer current.",
            ),
          ),
      }),
    );
    const headers = { authorization: `Bearer ${token("admin")}` };
    try {
      const conflict = await server.inject({
        method: "POST",
        url: "/admin/reconstruction-foundry/derivative-rights/registry-attestations",
        headers,
        payload: attestationBody(),
      });
      const integrity = await server.inject({
        method: "POST",
        url: "/admin/reconstruction-foundry/derivative-rights/authorization-candidates",
        headers,
        payload: candidateBody(),
      });
      expect(conflict.statusCode).toBe(409);
      expect(conflict.json().code).toBe("EVIDENCE_CONFLICT");
      expect(integrity.statusCode).toBe(409);
      expect(integrity.json().code).toBe("EVIDENCE_INTEGRITY_FAILURE");
    } finally {
      await server.close();
    }
  });
});

