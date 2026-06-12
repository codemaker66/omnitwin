import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import type { FastifyInstance } from "fastify";
import type { AIGenerationAdapter } from "../services/ai-assistant.js";
import { generateAIDraft } from "../services/ai-assistant.js";

process.env["DATABASE_URL"] = "postgresql://mock:mock@localhost/mock";
process.env["JWT_SECRET"] = "test-jwt-secret-that-is-at-least-32-characters-long";
process.env["AI_ASSISTANT_ENABLED"] = "false";
delete process.env["AI_ASSISTANT_PROVIDER"];
delete process.env["AI_ASSISTANT_MODEL"];
delete process.env["AI_ASSISTANT_BASE_URL"];
delete process.env["AI_ASSISTANT_API_KEY"];

const { buildServer } = await import("../index.js");

let server: FastifyInstance;

const USER_ID = "00000000-0000-4000-8000-000000005001";
const VENUE_ID = "00000000-0000-4000-8000-000000005002";

function staffToken(): string {
  return JSON.stringify({
    id: USER_ID,
    email: "staff@test.com",
    role: "staff",
    venueId: VENUE_ID,
  });
}

beforeAll(async () => {
  server = await buildServer();
});

afterAll(async () => {
  await server.close();
});

describe("AI assistant routes", () => {
  it("requires auth for AI status", async () => {
    const res = await server.inject({ method: "GET", url: "/ai/status" });
    expect(res.statusCode).toBe(401);
  });

  it("reports disabled state without exposing secret environment values", async () => {
    const res = await server.inject({
      method: "GET",
      url: "/ai/status",
      headers: { authorization: `Bearer ${staffToken()}` },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({
      data: {
        configured: false,
        provider: null,
        model: null,
      },
    });
    expect(res.body).not.toContain("AI_ASSISTANT_API_KEY");
  });

  it("fails closed when draft generation is not configured", async () => {
    const res = await server.inject({
      method: "POST",
      url: "/ai/drafts",
      headers: { authorization: `Bearer ${staffToken()}` },
      payload: {
        useCase: "enquiry_summary",
        context: { enquiryId: "demo", guestCount: 90 },
      },
    });
    expect(res.statusCode).toBe(503);
    expect(res.json()).toMatchObject({ code: "AI_ASSISTANT_DISABLED" });
  });

  it("registers requested route paths without unsafe output actions", async () => {
    const [indexSource, routeSource] = await Promise.all([
      readFile(resolve("src/index.ts"), "utf-8"),
      readFile(resolve("src/routes/ai-assistant.ts"), "utf-8"),
    ]);
    expect(indexSource).toContain('prefix: "/ai"');
    expect(routeSource).toContain('"/status"');
    expect(routeSource).toContain('"/drafts"');
    expect(routeSource).not.toMatch(/sendToClient|autoApprove|approveAutomatically/iu);
  });
});

describe("AI assistant draft generation", () => {
  it("runs mocked AI output through claim guard and human review metadata", async () => {
    const adapter: AIGenerationAdapter = {
      status: {
        configured: true,
        provider: "mock",
        model: "mock-draft",
        disabledReason: null,
      },
      generateText() {
        return Promise.resolve("This proposal draft is certified safe and legally compliant.");
      },
    };
    const draft = await generateAIDraft(
      adapter,
      {
        useCase: "proposal_draft",
        context: { proposalId: "demo-proposal" },
      },
      new Date("2026-06-12T12:30:00.000Z"),
    );

    expect(draft.body).toContain("requires human review");
    expect(draft.body).toContain("not legally certified");
    expect(draft.blockedUnsafeClaims).toEqual(["certified safe", "legally compliant"]);
    expect(draft.humanReviewRequired).toBe(true);
    expect(draft.provenance).toBe("ai_generated");
    expect(draft.evidenceStatus).toBe("unverified");
    expect(draft.sendState).toBe("draft_only");
  });
});
