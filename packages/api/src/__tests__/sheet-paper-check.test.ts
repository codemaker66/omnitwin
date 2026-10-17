import Fastify, { type FastifyInstance } from "fastify";
import rateLimit from "@fastify/rate-limit";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  SheetPaperCheckQuerySchema,
  SheetPaperCheckResultSchema,
  SheetPaperQrSchema,
  type SheetPaperCheckQuery,
  type SheetPaperCheckResult,
} from "@omnitwin/types";
import { buildSheetPaperCheck, decideSheetPaperCheck, type SheetPaperFacts } from "../services/sheet-paper-check.js";
import { SHEET_CHECK_RATE_LIMIT, publicSheetCheckRoutes } from "../routes/public-sheet-check.js";

// ---------------------------------------------------------------------------
// Paper that knows its version — the rule, the QR and the public route.
// The database read is covered against PostgreSQL in
// sheet-paper-check-postgres.test.ts.
// ---------------------------------------------------------------------------

const V7 = "5b8f2c1e-3d4a-4f6b-9c7d-1e2f3a4b5c6d";
const V9 = "7c9a3d2f-4e5b-4a7c-8d8e-2f3a4b5c6d7e";
const CONFIG = "9a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d";
const HASH_V7 = `0123456789abcdef${"a".repeat(48)}`;
const ISSUED_AT = new Date("2026-10-16T13:02:00.000Z");
const LATER = new Date("2026-10-17T09:30:00.000Z");

function facts(overrides: Partial<SheetPaperFacts> = {}): SheetPaperFacts {
  return {
    claim: { kind: "issued", snapshotId: V7, version: 7, fingerprint: "0123456789abcdef" },
    named: { version: 7, sourceHash: HASH_V7, approvedAt: ISSUED_AT },
    config: { reviewStatus: "approved", approvedAt: ISSUED_AT },
    latestApproved: { id: V7, version: 7, approvedAt: ISSUED_AT },
    ...overrides,
  };
}

describe("the paper check rule", () => {
  it("confirms the copy that is the version in force", () => {
    expect(decideSheetPaperCheck(facts())).toEqual({ state: "current", version: 7 });
  });

  it("names the newer version a superseded copy should ask for", () => {
    expect(decideSheetPaperCheck(facts({
      config: { reviewStatus: "approved", approvedAt: LATER },
      latestApproved: { id: V9, version: 9, approvedAt: LATER },
    }))).toEqual({ state: "superseded", currentVersion: 9 });
  });

  it.each([
    ["the snapshot is missing", { named: null }],
    ["the version on the paper is wrong", { claim: { kind: "issued" as const, snapshotId: V7, version: 6, fingerprint: "0123456789abcdef" } }],
    ["the fingerprint is wrong", { claim: { kind: "issued" as const, snapshotId: V7, version: 7, fingerprint: "fedcba9876543210" } }],
    ["the named snapshot was never approved", { named: { version: 7, sourceHash: HASH_V7, approvedAt: null } }],
    ["the layout is deleted or unknown", { config: null }],
    ["the approval record is damaged", { config: { reviewStatus: "approved", approvedAt: LATER } }],
    ["an approved layout has no approved snapshot", { latestApproved: null }],
  ])("says only 'unknown' when %s", (_label, overrides) => {
    expect(decideSheetPaperCheck(facts(overrides))).toEqual({ state: "unknown" });
  });

  it("never calls a copy current because it claims a version newer than the one in force", () => {
    expect(decideSheetPaperCheck(facts({
      latestApproved: { id: V9, version: 5, approvedAt: ISSUED_AT },
    }))).toEqual({ state: "unknown" });
  });

  it("says an issued copy is not in force while the layout is being revised", () => {
    expect(decideSheetPaperCheck(facts({ config: { reviewStatus: "draft", approvedAt: null } })))
      .toEqual({ state: "not_approved" });
  });

  it.each(["archived", "withdrawn"])("retires a copy once the layout is %s", (reviewStatus) => {
    expect(decideSheetPaperCheck(facts({ config: { reviewStatus, approvedAt: null } })))
      .toEqual({ state: "retired" });
  });

  it("never calls a rejected layout closed, because it can return to draft", () => {
    expect(decideSheetPaperCheck(facts({
      claim: { kind: "working" }, named: null,
      config: { reviewStatus: "rejected", approvedAt: null }, latestApproved: null,
    }))).toEqual({ state: "not_approved" });
  });

  it("does not retire a layout whose status it does not recognise", () => {
    expect(decideSheetPaperCheck(facts({
      claim: { kind: "working" }, named: null,
      config: { reviewStatus: "mystery", approvedAt: null }, latestApproved: null,
    }))).toEqual({ state: "not_approved" });
  });

  it("tells a draft copy which approved version replaced it", () => {
    expect(decideSheetPaperCheck(facts({ claim: { kind: "working" }, named: null })))
      .toEqual({ state: "superseded", currentVersion: 7 });
  });

  it.each(["draft", "submitted", "under_review", "changes_requested"])(
    "says a draft copy is not approved while the layout is %s",
    (reviewStatus) => {
      expect(decideSheetPaperCheck(facts({
        claim: { kind: "working" }, named: null,
        config: { reviewStatus, approvedAt: null }, latestApproved: null,
      }))).toEqual({ state: "not_approved" });
    },
  );
});

describe("the paper check a served sheet carries", () => {
  it("encodes an issued copy's link, with a fingerprint and no sign-in path", async () => {
    const check = await buildSheetPaperCheck("https://venviewer.com", CONFIG, { snapshotId: V7, version: 7, sourceHash: HASH_V7 });
    expect(check?.url).toBe(`https://venviewer.com/sheet-check?s=${V7}&v=7&h=0123456789abcdef`);
    expect(SheetPaperQrSchema.safeParse(check?.qr).success).toBe(true);
    // A real QR symbol: version 2 or larger, with the three finder squares' corners dark.
    const qr = check?.qr;
    expect(qr?.size).toBeGreaterThanOrEqual(25);
    expect(qr?.rows[0]?.startsWith("1111111")).toBe(true);
    expect(qr?.rows[0]?.endsWith("1111111")).toBe(true);
  });

  it("encodes a draft copy's link by layout only", async () => {
    const check = await buildSheetPaperCheck("https://venviewer.com/", CONFIG, null);
    expect(check?.url).toBe(`https://venviewer.com/sheet-check?c=${CONFIG}`);
  });
});

describe("GET /public/sheet-check", () => {
  let server: FastifyInstance | undefined;
  afterEach(async () => { await server?.close(); server = undefined; });

  async function start(check: (query: SheetPaperCheckQuery) => Promise<SheetPaperCheckResult>): Promise<FastifyInstance> {
    const app = Fastify();
    await app.register(rateLimit, { max: 1000, timeWindow: "1 minute" });
    await app.register(publicSheetCheckRoutes, { check, prefix: "/public" });
    await app.ready();
    server = app;
    return app;
  }

  it("answers without sign-in, uncached, with version state only", async () => {
    const check = vi.fn((): Promise<SheetPaperCheckResult> => Promise.resolve({ state: "superseded", currentVersion: 9 }));
    const app = await start(check);
    const response = await app.inject({ method: "GET", url: `/public/sheet-check?s=${V7}&v=7&h=0123456789abcdef&p=2026-10-17T06:02` });
    expect(response.statusCode).toBe(200);
    expect(response.headers["cache-control"]).toBe("no-store");
    expect(response.headers["x-robots-tag"]).toBe("noindex");
    expect(response.json()).toEqual({ data: { state: "superseded", currentVersion: 9 } });
    expect(SheetPaperCheckResultSchema.safeParse(response.json<{ data: unknown }>().data).success).toBe(true);
    // The printed minute is the paper's own business; the server never sees it.
    expect(check).toHaveBeenCalledWith({ s: V7, v: 7, h: "0123456789abcdef" });
  });

  it.each([
    "/public/sheet-check",
    `/public/sheet-check?s=${V7}&v=7`,
    `/public/sheet-check?s=${V7}&v=07&h=0123456789abcdef`,
    "/public/sheet-check?c=not-a-uuid",
  ])("refuses a link that is not a sheet check: %s", async (url) => {
    const check = vi.fn((): Promise<SheetPaperCheckResult> => Promise.resolve({ state: "current", version: 1 }));
    const app = await start(check);
    const response = await app.inject({ method: "GET", url });
    expect(response.statusCode).toBe(400);
    expect(response.json()).toEqual({ error: "This link is not a sheet check.", code: "VALIDATION_ERROR" });
    expect(check).not.toHaveBeenCalled();
  });

  it("is rate-limited per caller", async () => {
    const check = vi.fn((): Promise<SheetPaperCheckResult> => Promise.resolve({ state: "unknown" }));
    const app = await start(check);
    const url = `/public/sheet-check?c=${CONFIG}`;
    for (let i = 0; i < SHEET_CHECK_RATE_LIMIT.max; i++) {
      expect((await app.inject({ method: "GET", url })).statusCode).toBe(200);
    }
    expect((await app.inject({ method: "GET", url })).statusCode).toBe(429);
    expect(check).toHaveBeenCalledTimes(SHEET_CHECK_RATE_LIMIT.max);
  });

  it("accepts exactly the query shapes the printed links use", () => {
    expect(SheetPaperCheckQuerySchema.safeParse({ s: V7, v: "7", h: "0123456789abcdef" }).success).toBe(true);
    expect(SheetPaperCheckQuerySchema.safeParse({ c: CONFIG }).success).toBe(true);
  });
});
