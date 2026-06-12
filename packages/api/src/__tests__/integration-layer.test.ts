import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import type { FastifyInstance } from "fastify";
import type { IntegrationConnectionRecord, WebsiteEmbedConfig } from "@omnitwin/types";
import {
  MANAGED_EMAIL_TEMPLATE_SEEDS,
  createWebhookSignatureStub,
  managedTemplateSeedToEmailTemplate,
  publicIntegrationConnection,
  safeEmbedConfig,
} from "../services/integration-layer.js";

process.env["DATABASE_URL"] = "postgresql://mock:mock@localhost/mock";
process.env["JWT_SECRET"] = "test-jwt-secret-that-is-at-least-32-characters-long";

const { buildServer } = await import("../index.js");

let server: FastifyInstance;

const VENUE_ID = "00000000-0000-4000-8000-000000007001";
const OTHER_VENUE_ID = "00000000-0000-4000-8000-000000007002";
const USER_ID = "00000000-0000-4000-8000-000000007003";
const NOW = "2026-06-12T14:30:00.000Z";

function staffToken(): string {
  return JSON.stringify({
    id: USER_ID,
    email: "staff@test.com",
    role: "staff",
    venueId: VENUE_ID,
  });
}

function adminToken(): string {
  return JSON.stringify({
    id: USER_ID,
    email: "admin@test.com",
    role: "admin",
    venueId: null,
  });
}

beforeAll(async () => {
  server = await buildServer();
});

afterAll(async () => {
  await server.close();
});

describe("integration layer routes", () => {
  it("requires auth for integration listings", async () => {
    const res = await server.inject({ method: "GET", url: "/integrations" });
    expect(res.statusCode).toBe(401);
  });

  it("requires admin venue scope before database work", async () => {
    const res = await server.inject({
      method: "GET",
      url: "/integrations",
      headers: { authorization: `Bearer ${adminToken()}` },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json()).toMatchObject({ code: "VENUE_REQUIRED" });
  });

  it("rejects cross-venue integration creation before database work", async () => {
    const res = await server.inject({
      method: "POST",
      url: "/integrations",
      headers: { authorization: `Bearer ${staffToken()}` },
      payload: {
        venueId: OTHER_VENUE_ID,
        provider: "salesforce",
        label: "Salesforce lead sync",
        credentialMode: "not_configured",
        config: {},
      },
    });
    expect(res.statusCode).toBe(403);
  });

  it("rejects cross-venue webhook tests before database work", async () => {
    const res = await server.inject({
      method: "POST",
      url: "/webhooks/outbound/test",
      headers: { authorization: `Bearer ${staffToken()}` },
      payload: {
        venueId: OTHER_VENUE_ID,
        eventType: "lead.created",
        payload: { leadId: "demo" },
      },
    });
    expect(res.statusCode).toBe(403);
  });

  it("registers requested API paths and contains no live delivery call", async () => {
    const [indexSource, routeSource] = await Promise.all([
      readFile(resolve("src/index.ts"), "utf-8"),
      readFile(resolve("src/routes/integrations.ts"), "utf-8"),
    ]);
    expect(indexSource).toContain('prefix: "/integrations"');
    expect(indexSource).toContain('prefix: "/embed-configs"');
    expect(indexSource).toContain('prefix: "/webhooks"');
    expect(routeSource).toContain('"/outbound/test"');
    expect(routeSource).not.toMatch(/fetch\(|axios|sendgrid|resend|salesforce|cvent/iu);
  });
});

describe("integration layer services", () => {
  it("redacts credential references from public output", () => {
    const record: IntegrationConnectionRecord = {
      id: "00000000-0000-4000-8000-000000007010",
      venueId: VENUE_ID,
      provider: "salesforce",
      label: "Salesforce lead sync",
      status: "pending_setup",
      credentialMode: "env_ref",
      credentialRef: "SALESFORCE_TOKEN",
      config: { object: "Lead" },
      healthStatus: "Not connected",
      lastCheckedAt: null,
      createdBy: USER_ID,
      createdAt: NOW,
      updatedAt: NOW,
    };
    const publicRecord = publicIntegrationConnection(record);
    expect(publicRecord.credentialConfigured).toBe(true);
    expect(JSON.stringify(publicRecord)).not.toContain("SALESFORCE_TOKEN");
  });

  it("returns client-safe embed output with no internal ids", () => {
    const record: WebsiteEmbedConfig = {
      id: "00000000-0000-4000-8000-000000007020",
      venueId: VENUE_ID,
      roomId: "00000000-0000-4000-8000-000000007021",
      embedKey: "trades-grand-hall",
      venueName: "Trades Hall",
      roomName: "Grand Hall",
      ctaLabel: "Enquire with the venue team",
      ctaUrl: "https://example.com/enquire",
      safeMode: true,
      analyticsMode: "stub",
      status: "draft",
      createdBy: USER_ID,
      createdAt: NOW,
      updatedAt: NOW,
    };
    const safe = safeEmbedConfig(record);
    const serialized = JSON.stringify(safe);
    expect(safe.analytics.enabled).toBe(false);
    expect(serialized).not.toContain(VENUE_ID);
    expect(serialized).not.toContain("createdBy");
  });

  it("creates a deterministic webhook signing stub without delivery", () => {
    const result = createWebhookSignatureStub({
      eventType: "lead.created",
      payload: { leadId: "lead-1" },
      signingSecretRef: "WEBHOOK_SECRET_REF",
    });
    expect(result.sent).toBe(false);
    expect(result.deliveryMode).toBe("stub_only");
    expect(result.signatureHeader).toMatch(/^t=0,v1=[a-f0-9]{64},mode=stub$/u);
    expect(JSON.stringify(result)).not.toContain("WEBHOOK_SECRET_REF");
  });

  it("exposes managed email template seeds as metadata only", () => {
    const first = MANAGED_EMAIL_TEMPLATE_SEEDS[0];
    expect(first).toBeDefined();
    if (first === undefined) return;
    const template = managedTemplateSeedToEmailTemplate(first, {
      id: "00000000-0000-4000-8000-000000007030",
      venueId: null,
      createdAt: NOW,
      updatedAt: NOW,
    });
    expect(template.managedByCode).toBe(true);
    expect(template.status).toBe("active");
    expect(template.bodyTemplate).not.toContain("<html");
  });
});
