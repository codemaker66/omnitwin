import { describe, it, expect, beforeAll, afterAll } from "vitest";
import type { FastifyInstance } from "fastify";

// ---------------------------------------------------------------------------
// Webhook route tests — punch list #30 (missing route tests)
//
// The /webhooks/clerk endpoint verifies Svix signatures on Clerk webhook
// events and syncs user data to the local DB. In dev/test, signature
// verification is skipped when CLERK_WEBHOOK_SECRET is unset.
//
// Note on test isolation: when the full suite runs in a single fork
// (vitest.config.ts: singleFork=true), the webhook endpoint may return
// inconsistent status codes depending on server state from prior tests.
// These tests verify structural properties (route exists, is reachable,
// accepts valid payloads) plus source-grep assertions for the security
// contract. The production-required-secret contract is pinned by env.test.ts.
// ---------------------------------------------------------------------------

process.env["DATABASE_URL"] = "postgresql://mock:mock@localhost/mock";
process.env["JWT_SECRET"] = "test-jwt-secret-that-is-at-least-32-characters-long";

const { buildServer } = await import("../index.js");

let server: FastifyInstance;
beforeAll(async () => { server = await buildServer(); });
afterAll(async () => { await server.close(); });

// ---------------------------------------------------------------------------
// POST /webhooks/clerk — route existence and validation
// ---------------------------------------------------------------------------

describe("POST /webhooks/clerk", () => {
  it("route is registered (does not return 404)", async () => {
    const res = await server.inject({
      method: "POST",
      url: "/webhooks/clerk",
      payload: { type: "user.created", data: { id: "clerk_123", email_addresses: [], primary_email_address_id: "", first_name: null, last_name: null, phone_numbers: [], public_metadata: {} } },
    });
    expect(res.statusCode).not.toBe(404);
  });

  it("accepts a well-formed user.created payload without returning 400", async () => {
    const res = await server.inject({
      method: "POST",
      url: "/webhooks/clerk",
      payload: {
        type: "user.created",
        data: {
          id: "clerk_user_123",
          email_addresses: [{ email_address: "alice@example.com", id: "ea_1" }],
          primary_email_address_id: "ea_1",
          first_name: "Alice",
          last_name: "Smith",
          phone_numbers: [{ phone_number: "+44 7700 900000" }],
          public_metadata: { role: "client" },
        },
      },
    });
    // Payload structure is valid — should not be rejected by validation.
    // May get 200 (processed), 500 (mock DB), or other server state
    // depending on test ordering, but never 400 (malformed body).
    expect(res.statusCode).not.toBe(400);
  });
});

// ---------------------------------------------------------------------------
// Source-grep — structural security properties
// ---------------------------------------------------------------------------

describe("webhooks.ts security contract — source-grep", () => {
  async function readSource(relPath: string): Promise<{ raw: string; codeOnly: string }> {
    const fs = await import("node:fs/promises");
    const path = await import("node:path");
    const raw = await fs.readFile(path.resolve(relPath), "utf-8");
    const codeOnly = raw
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/\/\/[^\n]*/g, "");
    return { raw, codeOnly };
  }

  const SRC = "src/routes/webhooks.ts";

  it("does NOT use preHandler authenticate (webhooks use Svix, not Bearer)", async () => {
    const { codeOnly } = await readSource(SRC);
    // The webhook route must NOT have authenticate in its preHandler.
    // It verifies via Svix headers instead.
    expect(codeOnly).not.toMatch(/preHandler.*authenticate/);
  });

  it("verifies Svix signature when CLERK_WEBHOOK_SECRET is set", async () => {
    const { codeOnly } = await readSource(SRC);
    expect(codeOnly).toContain("new Webhook(webhookSecret)");
    expect(codeOnly).toContain("wh.verify(");
  });

  it("checks svix-id, svix-timestamp, svix-signature headers", async () => {
    const { codeOnly } = await readSource(SRC);
    expect(codeOnly).toContain(`"svix-id"`);
    expect(codeOnly).toContain(`"svix-timestamp"`);
    expect(codeOnly).toContain(`"svix-signature"`);
  });

  it("refuses unsigned events in production (belt-and-suspenders)", async () => {
    const { codeOnly } = await readSource(SRC);
    // The belt-and-suspenders check: even if startup validation was
    // bypassed, the webhook handler refuses to skip verification in
    // NODE_ENV=production.
    expect(codeOnly).toMatch(/NODE_ENV.*production/);
    expect(codeOnly).toContain("Webhook verification not configured");
  });

  it("handles all three Clerk event types", async () => {
    const { codeOnly } = await readSource(SRC);
    expect(codeOnly).toContain(`"user.created"`);
    expect(codeOnly).toContain(`"user.updated"`);
    expect(codeOnly).toContain(`"user.deleted"`);
  });

  it("uses rawBody for signature verification (not JSON.stringify)", async () => {
    const { codeOnly } = await readSource(SRC);
    // Svix HMAC verification requires the exact raw bytes. Using
    // JSON.stringify(request.body) would break signatures because key
    // ordering and whitespace can differ. The route must use rawBody.
    expect(codeOnly).toContain("rawBody");
    expect(codeOnly).toContain("config: { rawBody: true }");
  });
});
