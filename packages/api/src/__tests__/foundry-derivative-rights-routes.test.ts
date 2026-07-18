import Fastify, { type FastifyInstance } from "fastify";
import { describe, expect, it, vi } from "vitest";
import { adminFoundryDerivativeRightsRoutes } from "../routes/foundry-derivative-rights.js";
import type { FoundryDerivativeRightsCustodyServiceApi } from "../services/foundry-derivative-rights-custody.js";

process.env["NODE_ENV"] = "test";

const ACTOR_ID = "10000000-0000-4000-8000-000000000004";
const CUSTODY_ID = "10000000-0000-4000-8000-000000000005";
const REVIEW_ID = "10000000-0000-4000-8000-000000000006";
const SHA256 = `sha256:${"a".repeat(64)}`;

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

function custodyReceipt() {
  return {
    schemaVersion:
      "omnitwin.foundry.derivative-terms-evidence-custody-receipt.v1" as const,
    custodyId: CUSTODY_ID,
    registrationRequestSha256: SHA256,
    artifactId: "terms-evidence-1",
    mediaType: "text/plain",
    contentSha256: SHA256,
    sizeBytes: 3,
    storageMode: "postgres_inline_bytea_v1" as const,
    capturedAt: "2026-07-14T12:00:00.000Z",
    registeredByUserId: ACTOR_ID,
    verifiedAt: "2026-07-14T12:00:00.000Z",
    authority: "none" as const,
    executionEligible: false as const,
    custodyReceiptSha256: SHA256,
  };
}

function reviewReceipt() {
  return {
    schemaVersion:
      "omnitwin.foundry.derivative-rights-review-receipt.v1" as const,
    reviewId: REVIEW_ID,
    reviewRequestSha256: SHA256,
    approvalId: "approval-1",
    custodyId: CUSTODY_ID,
    custodyReceiptSha256: SHA256,
    decision: "accepted_for_registry_attestation" as const,
    rationale: "Exact evidence bytes reviewed.",
    derivativeRightsApprovalSha256: SHA256,
    reviewedByUserId: ACTOR_ID,
    reviewedAt: "2026-07-14T12:01:00.000Z",
    authority: "none" as const,
    executionEligible: false as const,
    reviewReceiptSha256: SHA256,
  };
}

function service(
  overrides: Partial<FoundryDerivativeRightsCustodyServiceApi> = {},
): FoundryDerivativeRightsCustodyServiceApi {
  return {
    registerTermsEvidence: () => Promise.resolve(custodyReceipt()),
    getTermsEvidence: () =>
      Promise.resolve({
        receipt: custodyReceipt(),
        bytes: Buffer.from("abc", "utf8"),
      }),
    reviewForRegistryAttestation: () => Promise.resolve(reviewReceipt()),
    ...overrides,
  };
}

async function routeServer(
  api: FoundryDerivativeRightsCustodyServiceApi,
): Promise<FastifyInstance> {
  const server = Fastify({ logger: false });
  await server.register(adminFoundryDerivativeRightsRoutes, {
    prefix: "/admin/reconstruction-foundry/derivative-rights",
    service: api,
  });
  await server.ready();
  return server;
}

describe("Foundry derivative-rights custody HTTP surface", () => {
  it("requires a platform administrator for custody, retrieval, and review", async () => {
    const server = await routeServer(service());
    try {
      for (const request of [
        {
          method: "POST" as const,
          url: "/admin/reconstruction-foundry/derivative-rights/evidence-artifacts",
          payload: {},
        },
        {
          method: "GET" as const,
          url: `/admin/reconstruction-foundry/derivative-rights/evidence-artifacts/${CUSTODY_ID}/content`,
        },
        {
          method: "POST" as const,
          url: "/admin/reconstruction-foundry/derivative-rights/reviews",
          payload: {},
        },
      ]) {
        const anonymous = await server.inject(request);
        expect(anonymous.statusCode).toBe(401);
        const operator = await server.inject({
          ...request,
          headers: { authorization: `Bearer ${token("operator")}` },
        });
        expect(operator.statusCode).toBe(403);
      }
    } finally {
      await server.close();
    }
  });

  it("decodes only canonical base64 and derives the actor from authentication", async () => {
    const registerTermsEvidence = vi.fn(() =>
      Promise.resolve(custodyReceipt()),
    );
    const server = await routeServer(service({ registerTermsEvidence }));
    const headers = { authorization: `Bearer ${token("admin")}` };
    try {
      const malformed = await server.inject({
        method: "POST",
        url: "/admin/reconstruction-foundry/derivative-rights/evidence-artifacts",
        headers,
        payload: {
          artifactId: "terms-evidence-1",
          mediaType: "text/plain",
          evidenceBytesBase64: "YWJj\n",
          idempotencyKey: "custody-1",
        },
      });
      expect(malformed.statusCode).toBe(400);
      expect(registerTermsEvidence).not.toHaveBeenCalled();

      const success = await server.inject({
        method: "POST",
        url: "/admin/reconstruction-foundry/derivative-rights/evidence-artifacts",
        headers,
        payload: {
          artifactId: "terms-evidence-1",
          mediaType: "text/plain",
          evidenceBytesBase64: "YWJj",
          idempotencyKey: "custody-1",
        },
      });
      expect(success.statusCode).toBe(201);
      expect(registerTermsEvidence).toHaveBeenCalledWith(
        expect.objectContaining({
          artifactId: "terms-evidence-1",
          mediaType: "text/plain",
          idempotencyKey: "custody-1",
          bytes: Buffer.from("abc", "utf8"),
        }),
        ACTOR_ID,
      );
      expect(success.json().data).toMatchObject({
        authority: "none",
        executionEligible: false,
      });
    } finally {
      await server.close();
    }
  });

  it("returns exact bytes only as a no-store, nosniff attachment", async () => {
    const server = await routeServer(service());
    try {
      const response = await server.inject({
        method: "GET",
        url: `/admin/reconstruction-foundry/derivative-rights/evidence-artifacts/${CUSTODY_ID}/content`,
        headers: { authorization: `Bearer ${token("admin")}` },
      });
      expect(response.statusCode).toBe(200);
      expect(response.rawPayload).toEqual(Buffer.from("abc", "utf8"));
      expect(response.headers["cache-control"]).toBe("private, no-store");
      expect(response.headers["content-type"]).toBe("application/octet-stream");
      expect(response.headers["content-disposition"]).toBe(
        'attachment; filename="terms-evidence-1.evidence"',
      );
      expect(response.headers["x-content-type-options"]).toBe("nosniff");
      expect(response.headers["content-security-policy"]).toBe("sandbox");
    } finally {
      await server.close();
    }
  });

  it("records only a registry-attestation review and derives its reviewer", async () => {
    const reviewForRegistryAttestation = vi.fn(() =>
      Promise.resolve(reviewReceipt()),
    );
    const server = await routeServer(service({ reviewForRegistryAttestation }));
    try {
      const response = await server.inject({
        method: "POST",
        url: "/admin/reconstruction-foundry/derivative-rights/reviews",
        headers: { authorization: `Bearer ${token("admin")}` },
        payload: {
          approvalId: "approval-1",
          custodyId: CUSTODY_ID,
          custodyReceiptSha256: SHA256,
          decision: "accepted_for_registry_attestation",
          rationale: "Exact evidence bytes reviewed.",
          idempotencyKey: "review-1",
        },
      });
      expect(response.statusCode).toBe(201);
      expect(reviewForRegistryAttestation).toHaveBeenCalledWith(
        expect.objectContaining({
          approvalId: "approval-1",
          decision: "accepted_for_registry_attestation",
        }),
        ACTOR_ID,
      );
      expect(response.json().data).toMatchObject({
        authority: "none",
        executionEligible: false,
      });
    } finally {
      await server.close();
    }
  });

  it("rejects whitespace and caller-supplied review identity or authority", async () => {
    const reviewForRegistryAttestation = vi.fn(() =>
      Promise.resolve(reviewReceipt()),
    );
    const registerTermsEvidence = vi.fn(() =>
      Promise.resolve(custodyReceipt()),
    );
    const server = await routeServer(
      service({
        registerTermsEvidence,
        reviewForRegistryAttestation,
      }),
    );
    const headers = { authorization: `Bearer ${token("admin")}` };
    try {
      const paddedMediaType = await server.inject({
        method: "POST",
        url: "/admin/reconstruction-foundry/derivative-rights/evidence-artifacts",
        headers,
        payload: {
          artifactId: "terms-evidence-1",
          mediaType: " text/plain",
          evidenceBytesBase64: "YWJj",
          idempotencyKey: "custody-1",
        },
      });
      expect(paddedMediaType.statusCode).toBe(400);

      for (const extra of [
        { reviewedByUserId: ACTOR_ID },
        { reviewedAt: "2026-07-14T12:01:00.000Z" },
        { derivativeRightsApprovalSha256: SHA256 },
        { authority: "none" },
        { executionEligible: false },
      ]) {
        const response = await server.inject({
          method: "POST",
          url: "/admin/reconstruction-foundry/derivative-rights/reviews",
          headers,
          payload: {
            approvalId: "approval-1",
            custodyId: CUSTODY_ID,
            custodyReceiptSha256: SHA256,
            decision: "rejected",
            rationale: "Exact evidence bytes reviewed.",
            idempotencyKey: "review-1",
            ...extra,
          },
        });
        expect(response.statusCode).toBe(400);
      }

      const paddedRationale = await server.inject({
        method: "POST",
        url: "/admin/reconstruction-foundry/derivative-rights/reviews",
        headers,
        payload: {
          approvalId: "approval-1",
          custodyId: CUSTODY_ID,
          custodyReceiptSha256: SHA256,
          decision: "rejected",
          rationale: " Padded rationale",
          idempotencyKey: "review-1",
        },
      });
      expect(paddedRationale.statusCode).toBe(400);
      expect(registerTermsEvidence).not.toHaveBeenCalled();
      expect(reviewForRegistryAttestation).not.toHaveBeenCalled();
    } finally {
      await server.close();
    }
  });
});
