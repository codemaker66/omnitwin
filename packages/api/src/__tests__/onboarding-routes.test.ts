import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";

process.env["DATABASE_URL"] = "postgresql://mock:mock@localhost/mock";
process.env["JWT_SECRET"] = "test-jwt-secret-that-is-at-least-32-characters-long";

const { buildServer } = await import("../index.js");

let server: FastifyInstance;

const WORKSPACE_ID = "00000000-0000-4000-8000-000000000021";
const PROJECT_ID = "00000000-0000-4000-8000-000000000022";
const ENTITLEMENT_ID = "00000000-0000-4000-8000-000000000023";

function signToken(payload: { id: string; email: string; role: string; venueId: string | null }): string {
  return JSON.stringify(payload);
}

const adminToken = (): string => signToken({
  id: "00000000-0000-4000-8000-000000000099",
  email: "admin@test.com",
  role: "admin",
  venueId: null,
});
const staffToken = (): string => signToken({
  id: "00000000-0000-4000-8000-000000000098",
  email: "staff@test.com",
  role: "staff",
  venueId: "00000000-0000-4000-8000-00000000000a",
});

beforeAll(async () => { server = await buildServer(); });
afterAll(async () => { await server.close(); });

describe("onboarding routes", () => {
  it("requires admin authentication for onboarding surfaces", async () => {
    for (const [method, url] of [
      ["GET", "/onboarding/summary"],
      ["POST", "/onboarding/managed-workspaces"],
      ["POST", `/onboarding/workspaces/${WORKSPACE_ID}/invitations`],
      ["PATCH", `/onboarding/projects/${PROJECT_ID}`],
      ["PATCH", `/onboarding/entitlements/${ENTITLEMENT_ID}/provider-verification`],
    ] as const) {
      const unauthenticated = await server.inject({ method, url, payload: method !== "GET" ? {} : undefined });
      expect(unauthenticated.statusCode).toBe(401);

      const staff = await server.inject({
        method,
        url,
        headers: { authorization: `Bearer ${staffToken()}` },
        payload: method !== "GET" ? {} : undefined,
      });
      expect(staff.statusCode).toBe(403);
    }
  });

  it("rejects managed access enforcement before provider verification", async () => {
    const res = await server.inject({
      method: "POST",
      url: "/onboarding/managed-workspaces",
      headers: { authorization: `Bearer ${adminToken()}` },
      payload: {
        organisationName: "Trades Hall Trust",
        venue: {
          name: "Trades Hall Glasgow",
          slug: "trades-hall-glasgow",
          address: "85 Glassford Street, Glasgow G1 1UH",
        },
        ownerInvite: { email: "owner@tradeshall.co.uk" },
        entitlement: {
          planKey: "managed_deployment",
          billingProvider: "stripe",
          providerVerified: false,
          accessEnforced: true,
        },
      },
    });

    expect(res.statusCode).toBe(400);
  });

  it("validates provider-verification updates before database work", async () => {
    const invalid = await server.inject({
      method: "PATCH",
      url: `/onboarding/entitlements/${ENTITLEMENT_ID}/provider-verification`,
      headers: { authorization: `Bearer ${adminToken()}` },
      payload: {
        billingProvider: "stripe",
        providerVerificationStatus: "pending",
        accessEnforced: true,
      },
    });
    expect(invalid.statusCode).toBe(400);

    const validShape = await server.inject({
      method: "PATCH",
      url: `/onboarding/entitlements/${ENTITLEMENT_ID}/provider-verification`,
      headers: { authorization: `Bearer ${adminToken()}` },
      payload: {
        billingProvider: "manual_invoice",
        providerVerificationStatus: "provider_verified",
        providerEvidenceRef: "invoice-2026-001",
        accessEnforced: true,
      },
    });
    expect(validShape.statusCode).not.toBe(400);
    expect(validShape.statusCode).not.toBe(401);
    expect(validShape.statusCode).not.toBe(403);
  });

  it("accepts a valid managed workspace payload at the route boundary", async () => {
    const res = await server.inject({
      method: "POST",
      url: "/onboarding/managed-workspaces",
      headers: { authorization: `Bearer ${adminToken()}` },
      payload: {
        organisationName: "Trades Hall Trust",
        workspaceName: "Trades Hall rollout",
        venue: {
          name: "Trades Hall Glasgow",
          slug: "trades-hall-glasgow",
          address: "85 Glassford Street, Glasgow G1 1UH",
        },
        ownerInvite: { email: "owner@tradeshall.co.uk" },
        staffInvites: [
          { email: "events@tradeshall.co.uk", workspaceRole: "staff", venueRole: "staff" },
        ],
        entitlement: {
          planKey: "managed_deployment",
          billingProvider: "none",
        },
      },
    });

    expect(res.statusCode).not.toBe(400);
    expect(res.statusCode).not.toBe(401);
    expect(res.statusCode).not.toBe(403);
  });
});

describe("onboarding route source guards", () => {
  it("routes are admin-gated and use user invitations rather than direct platform-admin grants", async () => {
    const source = await readFile(resolve("src/routes/onboarding.ts"), "utf-8");
    expect(source).toContain("authorize(\"admin\")");
    expect(source).toContain("userInvitations");
    expect(source).toContain("workspaceMemberships");
    expect(source).toContain("venueRole");
    expect(source).not.toContain("venueRole: \"admin\"");
  });

  it("server registers the onboarding route prefix", async () => {
    const source = await readFile(resolve("src/index.ts"), "utf-8");
    expect(source).toContain("onboardingRoutes");
    expect(source).toContain("prefix: \"/onboarding\"");
  });
});
