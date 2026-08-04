import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import {
  ReconstructionReleasePublicActiveDescriptorSchema,
  type ReconstructionReleasePublicActiveDescriptor,
} from "@omnitwin/types";
import Fastify, { type FastifyInstance } from "fastify";
import { describe, expect, it, vi } from "vitest";
import {
  adminReconstructionFoundryRoutes,
  publicReconstructionReleaseRoutes,
} from "../routes/reconstruction-foundry.js";
import {
  ReconstructionFoundryIntegrationUnavailableError,
  ReconstructionFoundryEvidenceError,
  ReconstructionFoundryNotFoundError,
  ReconstructionFoundryProviderError,
  ReconstructionFoundryRevisionConflictError,
  type ReconstructionFoundryServiceApi,
} from "../services/reconstruction-foundry.js";

process.env["NODE_ENV"] = "test";

const RELEASE_ID = "10000000-0000-4000-8000-000000000001";
const REVIEW_ID = "10000000-0000-4000-8000-000000000002";
const PUBLICATION_ID = "10000000-0000-4000-8000-000000000003";
const ACTOR_ID = "10000000-0000-4000-8000-000000000004";
const DIGEST = "a".repeat(64);

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

function unavailable(): Promise<never> {
  return Promise.reject(new ReconstructionFoundryNotFoundError("Fixture method is unavailable."));
}

function service(
  overrides: Partial<ReconstructionFoundryServiceApi> = {},
): ReconstructionFoundryServiceApi {
  return {
    listReviewEvidenceArtifacts: () => Promise.resolve({ venueSlug: "trades-hall", artifacts: [] }),
    registerReviewEvidenceArtifact: unavailable,
    getVisualEvidence: unavailable,
    listReleases: () => Promise.resolve({ releases: [], productionChannel: null }),
    getRelease: unavailable,
    verifyCandidate: unavailable,
    reviewRelease: unavailable,
    getSigningPayload: unavailable,
    verifyAttestation: unavailable,
    publishRelease: unavailable,
    getProductionChannel: () => Promise.resolve(null),
    getProductionChannelHistory: () => Promise.resolve([]),
    promoteRelease: unavailable,
    rollbackRelease: unavailable,
    getActiveRelease: unavailable,
    ...overrides,
  };
}

async function routeServer(api: ReconstructionFoundryServiceApi): Promise<FastifyInstance> {
  const server = Fastify({ logger: false });
  await server.register(adminReconstructionFoundryRoutes, {
    prefix: "/admin/reconstruction-foundry",
    service: api,
  });
  await server.register(publicReconstructionReleaseRoutes, {
    prefix: "/assets/reconstruction-releases",
    service: api,
  });
  await server.ready();
  return server;
}

function activeDescriptor(): ReconstructionReleasePublicActiveDescriptor {
  const prefix = `releases/sha256/${DIGEST.slice(0, 2)}/${DIGEST}`;
  return ReconstructionReleasePublicActiveDescriptorSchema.parse({
    schemaVersion: "venviewer.reconstruction-active-release.v1",
    venueSlug: "trades-hall",
    releaseKind: "venue_twin_v1",
    channel: "production",
    releaseId: RELEASE_ID,
    releaseDigest: DIGEST,
    publicationId: PUBLICATION_ID,
    manifestSha256: DIGEST,
    manifestUrl: `https://twin.venviewer.com/${prefix}/manifest.json`,
    assetBaseUrl: `https://twin.venviewer.com/${prefix}`,
    channelRevision: 4,
  });
}

describe("Reconstruction Foundry HTTP surface", () => {
  it("protects every admin route with platform-admin authentication", async () => {
    const server = await routeServer(service());
    try {
      const anonymous = await server.inject({
        method: "GET",
        url: "/admin/reconstruction-foundry/releases?venueSlug=trades-hall",
      });
      expect(anonymous.statusCode).toBe(401);
      const operator = await server.inject({
        method: "GET",
        url: "/admin/reconstruction-foundry/releases?venueSlug=trades-hall",
        headers: { authorization: `Bearer ${token("operator")}` },
      });
      expect(operator.statusCode).toBe(403);
    } finally {
      await server.close();
    }
  });

  it("exposes persisted signing payload lookup and requires a submitted envelope", async () => {
    const getSigningPayload = vi.fn(() => Promise.reject(
      new ReconstructionFoundryNotFoundError("Signing payload not found."),
    ));
    const verifyAttestation = vi.fn(() => Promise.reject(
      new ReconstructionFoundryNotFoundError("Attestation target not found."),
    ));
    const server = await routeServer(service({ getSigningPayload, verifyAttestation }));
    const headers = { authorization: `Bearer ${token("admin")}` };
    try {
      const signing = await server.inject({
        method: "GET",
        url: `/admin/reconstruction-foundry/releases/${RELEASE_ID}/signing-payload?reviewId=${REVIEW_ID}`,
        headers,
      });
      expect(signing.statusCode).toBe(404);
      expect(getSigningPayload).toHaveBeenCalledWith(RELEASE_ID, REVIEW_ID);

      const missingEnvelope = await server.inject({
        method: "POST",
        url: `/admin/reconstruction-foundry/releases/${RELEASE_ID}/attestations/verify`,
        headers,
      });
      expect(missingEnvelope.statusCode).toBe(400);
      expect(verifyAttestation).not.toHaveBeenCalled();

      const submitted = await server.inject({
        method: "POST",
        url: `/admin/reconstruction-foundry/releases/${RELEASE_ID}/attestations/verify`,
        headers,
        payload: {
          reviewId: REVIEW_ID,
          envelope: {
            payloadType: "application/vnd.in-toto+json",
            payload: "e30=",
            signatures: [{ keyid: "trusted-key", sig: Buffer.alloc(64, 1).toString("base64") }],
          },
          idempotencyKey: "verify-attestation:one",
        },
      });
      expect(submitted.statusCode).toBe(404);
      expect(verifyAttestation).toHaveBeenCalledOnce();
    } finally {
      await server.close();
    }
  });

  it("returns standard revision conflicts for stale channel controls", async () => {
    const promoteRelease = vi.fn(() => Promise.reject(
      new ReconstructionFoundryRevisionConflictError(7, RELEASE_ID),
    ));
    const server = await routeServer(service({ promoteRelease }));
    try {
      const response = await server.inject({
        method: "POST",
        url: "/admin/reconstruction-foundry/channels/production/promote",
        headers: { authorization: `Bearer ${token("admin")}` },
        payload: {
          targetReleaseId: RELEASE_ID,
          targetReleaseDigest: DIGEST,
          targetPublicationId: PUBLICATION_ID,
          expectedRevision: 6,
          expectedActiveReleaseId: null,
          idempotencyKey: "promote:trades-hall:one",
          reason: "Promote the exact approved and verified release publication.",
        },
      });
      expect(response.statusCode).toBe(409);
      expect(response.json()).toMatchObject({
        code: "REVISION_CONFLICT",
        details: { currentRevision: 7, currentReleaseId: RELEASE_ID },
      });
    } finally {
      await server.close();
    }
  });

  it("keeps active-pointer responses uncached on success and failure", async () => {
    const successServer = await routeServer(service({
      getActiveRelease: () => Promise.resolve(activeDescriptor()),
    }));
    try {
      const success = await successServer.inject({
        method: "GET",
        url: "/assets/reconstruction-releases/active?venueSlug=trades-hall&releaseKind=venue_twin_v1",
      });
      expect(success.statusCode).toBe(200);
      expect(success.headers["cache-control"]).toBe("no-store");
      expect(success.json()).toMatchObject({ data: { channelRevision: 4 } });
    } finally {
      await successServer.close();
    }

    const failureServer = await routeServer(service());
    try {
      const failure = await failureServer.inject({
        method: "GET",
        url: "/assets/reconstruction-releases/active?venueSlug=trades-hall&releaseKind=venue_twin_v1",
      });
      expect(failure.statusCode).toBe(404);
      expect(failure.headers["cache-control"]).toBe("no-store");
    } finally {
      await failureServer.close();
    }
  });

  it("pins long verification/publication timeouts and the complete button-addressable route set", async () => {
    const source = await readFile(resolve("src/routes/reconstruction-foundry.ts"), "utf8");
    expect(source).toContain("request.raw.setTimeout(LONG_FOUNDRY_OPERATION_TIMEOUT_MS)");
    expect(source).toContain("15 * 60_000");
    expect(source).toContain('server.post("/releases/verify-candidate"');
    expect(source).toContain('server.get("/releases/:releaseId/signing-payload"');
    expect(source).toContain('"/releases/:releaseId/attestations/verify"');
    expect(source).toContain('server.post("/releases/:releaseId/publish"');
    expect(source).toContain('server.post("/channels/production/promote"');
    expect(source).toContain('server.post("/channels/production/rollback"');
    expect(source).toContain('server.get("/active"');
  });

  it("fails closed when private candidate verification is not configured", async () => {
    const verifyCandidate = vi.fn(() => Promise.reject(
      new ReconstructionFoundryIntegrationUnavailableError("Candidate verification"),
    ));
    const server = await routeServer(service({ verifyCandidate }));
    try {
      const response = await server.inject({
        method: "POST",
        url: "/admin/reconstruction-foundry/releases/verify-candidate",
        headers: { authorization: `Bearer ${token("admin")}` },
        payload: {
          candidateR2Prefix: `candidates/trades-hall/${DIGEST}`,
          idempotencyKey: "verify-candidate:one",
        },
      });
      expect(response.statusCode).toBe(503);
      expect(response.json()).toMatchObject({ code: "FOUNDRY_INTEGRATION_UNAVAILABLE" });
    } finally {
      await server.close();
    }
  });

  it("separates integrity conflicts from safe provider-unavailable responses", async () => {
    const headers = { authorization: `Bearer ${token("admin")}` };
    const integrityServer = await routeServer(service({
      listReleases: () => Promise.reject(
        new ReconstructionFoundryEvidenceError("Candidate digest mismatch."),
      ),
    }));
    try {
      const response = await integrityServer.inject({
        method: "GET",
        url: "/admin/reconstruction-foundry/releases?venueSlug=trades-hall",
        headers,
      });
      expect(response.statusCode).toBe(409);
      expect(response.json()).toMatchObject({ code: "EVIDENCE_CONFLICT" });
    } finally {
      await integrityServer.close();
    }

    const providerServer = await routeServer(service({
      listReleases: () => Promise.reject(
        new ReconstructionFoundryProviderError("R2", new Error("secret provider detail")),
      ),
    }));
    try {
      const response = await providerServer.inject({
        method: "GET",
        url: "/admin/reconstruction-foundry/releases?venueSlug=trades-hall",
        headers,
      });
      expect(response.statusCode).toBe(503);
      expect(response.json()).toEqual({
        error: "Reconstruction Foundry storage is temporarily unavailable.",
        code: "FOUNDRY_STORAGE_UNAVAILABLE",
      });
      expect(response.body).not.toContain("secret provider detail");
    } finally {
      await providerServer.close();
    }
  });
});
