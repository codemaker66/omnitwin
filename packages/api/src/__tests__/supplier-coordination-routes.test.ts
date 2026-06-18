import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";

process.env["DATABASE_URL"] = "postgresql://mock:mock@localhost/mock";
process.env["JWT_SECRET"] = "test-jwt-secret-that-is-at-least-32-characters-long";

const { buildServer } = await import("../index.js");

let server: FastifyInstance;

const VENUE_ID = "00000000-0000-4000-8000-00000000000a";
const HANDOFF_PACK_ID = "00000000-0000-4000-8000-000000000601";
const SUPPLIER_PACK_ID = "00000000-0000-4000-8000-000000000602";
const INSTRUCTION_ID = "00000000-0000-4000-8000-000000000603";
const SHARE_TOKEN = "abcdefghijklmnopqrstuvwxyzABCDEF1234567890_-";

function signToken(payload: { id: string; email: string; role: string; venueId: string | null }): string {
  return JSON.stringify(payload);
}

const staffToken = (): string => signToken({
  id: "00000000-0000-4000-8000-000000000098",
  email: "staff@test.com",
  role: "staff",
  venueId: VENUE_ID,
});

beforeAll(async () => { server = await buildServer(); });
afterAll(async () => { await server.close(); });

describe("supplier coordination routes", () => {
  it("requires auth for internal supplier pack management", async () => {
    for (const [method, url] of [
      ["POST", "/supplier-coordination/packs"],
      ["GET", `/supplier-coordination/packs/${SUPPLIER_PACK_ID}`],
      ["POST", `/supplier-coordination/packs/${SUPPLIER_PACK_ID}/share-token`],
    ] as const) {
      const res = await server.inject({ method, url, payload: method !== "GET" ? {} : undefined });
      expect(res.statusCode).toBe(401);
    }
  });

  it("validates supplier pack creation before database work", async () => {
    const malformed = await server.inject({
      method: "POST",
      url: "/supplier-coordination/packs",
      headers: { authorization: `Bearer ${staffToken()}` },
      payload: {
        handoffPackId: HANDOFF_PACK_ID,
        supplierInstructionIds: [INSTRUCTION_ID, INSTRUCTION_ID],
      },
    });
    expect(malformed.statusCode).toBe(400);

    const unsafe = await server.inject({
      method: "POST",
      url: "/supplier-coordination/packs",
      headers: { authorization: `Bearer ${staffToken()}` },
      payload: {
        handoffPackId: HANDOFF_PACK_ID,
        supplierInstructionIds: [INSTRUCTION_ID],
        title: "Production ready supplier pack",
      },
    });
    expect(unsafe.statusCode).toBe(400);
  });

  it("validates share-token body before database work", async () => {
    const invalid = await server.inject({
      method: "POST",
      url: `/supplier-coordination/packs/${SUPPLIER_PACK_ID}/share-token`,
      headers: { authorization: `Bearer ${staffToken()}` },
      payload: { expiresAt: "not-a-date" },
    });
    expect(invalid.statusCode).toBe(400);
  });

  it("validates supplier share routes without auth", async () => {
    const malformed = await server.inject({ method: "GET", url: "/supplier-share/bad" });
    expect(malformed.statusCode).toBe(400);

    const wellFormed = await server.inject({ method: "GET", url: `/supplier-share/${SHARE_TOKEN}` });
    expect(wellFormed.statusCode).not.toBe(400);
    expect(wellFormed.statusCode).not.toBe(401);
  });

  it("claim-guards supplier acknowledgements", async () => {
    const unsafeAck = await server.inject({
      method: "POST",
      url: `/supplier-share/${SHARE_TOKEN}/acknowledge`,
      payload: {
        acknowledgedByName: "Sam Supplier",
        note: "Confirmed because this is certified safe.",
      },
    });
    expect(unsafeAck.statusCode).toBe(400);

    const missingIdentity = await server.inject({
      method: "POST",
      url: `/supplier-share/${SHARE_TOKEN}/acknowledge`,
      payload: { note: "Received with one timing question." },
    });
    expect(missingIdentity.statusCode).toBe(400);
  });
});

describe("supplier coordination route source guards", () => {
  it("hashes supplier share tokens before persistence", async () => {
    const source = await readFile(resolve("src/routes/supplier-coordination.ts"), "utf-8");
    expect(source).toContain("hashShareToken");
    expect(source).toContain("tokenHash");
    expect(source).toContain("randomBytes");
    expect(source).not.toContain("token: supplierCoordinationShareTokens");
  });

  it("registers internal and supplier-facing route prefixes", async () => {
    const source = await readFile(resolve("src/index.ts"), "utf-8");
    expect(source).toContain("supplierCoordinationRoutes");
    expect(source).toContain("supplierShareRoutes");
    expect(source).toContain("prefix: \"/supplier-coordination\"");
    expect(source).toContain("prefix: \"/supplier-share\"");
  });

  it("keeps supplier route wording inside safe boundaries", async () => {
    const routeSource = await readFile(resolve("src/routes/supplier-coordination.ts"), "utf-8");
    expect(routeSource).not.toMatch(/\bfire approved\b/iu);
    expect(routeSource).not.toMatch(/\bcertified safe\b/iu);
    expect(routeSource).not.toMatch(/\blegally compliant\b/iu);
    expect(routeSource).not.toMatch(/\bsurvey-grade\b/iu);
    expect(routeSource).not.toMatch(/\bapproved for occupancy\b/iu);
    expect(routeSource).not.toMatch(/\bguaranteed accessible\b/iu);
    expect(routeSource).not.toMatch(/\bBlack Label\b/u);
    expect(routeSource).not.toMatch(/\bphotoreal digital twin\b/iu);
  });
});
