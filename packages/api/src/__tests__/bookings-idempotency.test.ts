import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import type { FastifyInstance } from "fastify";

process.env["DATABASE_URL"] = "postgresql://mock:mock@localhost/mock";
process.env["JWT_SECRET"] = "test-jwt-secret-that-is-at-least-32-characters-long";

const { buildServer } = await import("../index.js");

// ---------------------------------------------------------------------------
// REST command idempotency (T-538) — the boundary of the keyed path.
//
// A booking mutation carrying an `Idempotency-Key` header (a client-minted
// uuid commandId) runs THROUGH executeDiaryCommand — the same envelope
// dispatch, ledger write, savepoint law, and replay authorization the
// /ws/diary transport uses. These tests exercise everything reachable
// without a live database: header validation, the venue-scope requirement,
// and the command gate. Ledger/replay semantics are pinned by the
// diary-commands unit suite; the no-duplicate resend is proven live by the
// diary e2e. Keyless requests are pinned byte-identical by the main
// bookings-routes suite.
// ---------------------------------------------------------------------------

let server: FastifyInstance;

const VENUE_ID = "00000000-0000-4000-8000-000000000001";
const OTHER_VENUE_ID = "00000000-0000-4000-8000-000000000002";
const BOOKING_ID = "00000000-0000-4000-8000-000000000003";
const OWNER_ID = "00000000-0000-4000-8000-000000000099";
const COMMAND_ID = "00000000-0000-4000-8000-00000000c0de";

function signToken(payload: {
  id: string;
  email: string;
  role: string;
  venueId: string | null;
}): string {
  return JSON.stringify(payload);
}

const staffToken = (venueId: string | null = VENUE_ID): string =>
  signToken({ id: OWNER_ID, email: "staff@test.com", role: "staff", venueId });

const hallkeeperToken = (): string =>
  signToken({ id: OWNER_ID, email: "keeper@test.com", role: "hallkeeper", venueId: VENUE_ID });

function validHoldPayload(venueId: string = VENUE_ID): Record<string, unknown> {
  return {
    venueId,
    spaceId: "00000000-0000-4000-8000-000000000010",
    kind: "hold",
    title: "MacLeod wedding",
    startsAt: "2026-09-19T17:00:00.000Z",
    endsAt: "2026-09-19T23:30:00.000Z",
    rank: 1,
    decisionAt: "2026-08-01T12:00:00.000Z",
    ownerUserId: OWNER_ID,
    nextAction: "Call Fiona MacLeod to confirm the decision date.",
    nextActionDueAt: "2026-07-25T09:00:00.000Z",
  };
}

beforeAll(async () => {
  server = await buildServer();
});
afterAll(async () => {
  await server.close();
});

describe("Idempotency-Key boundary (T-538)", () => {
  it("rejects a malformed key with 400 VALIDATION_ERROR on every mutation surface", async () => {
    const surfaces = [
      { method: "POST" as const, url: "/bookings", payload: validHoldPayload() },
      { method: "PATCH" as const, url: `/bookings/${BOOKING_ID}`, payload: { title: "X" } },
      {
        method: "POST" as const,
        url: `/bookings/${BOOKING_ID}/transition`,
        payload: { toState: "released" },
      },
    ];
    for (const surface of surfaces) {
      const res = await server.inject({
        ...surface,
        headers: {
          authorization: `Bearer ${staffToken()}`,
          "idempotency-key": "not-a-uuid",
        },
      });
      expect(res.statusCode, `${surface.method} ${surface.url}`).toBe(400);
      const body = JSON.parse(res.body) as { code: string; details?: unknown };
      expect(body.code).toBe("VALIDATION_ERROR");
      expect(JSON.stringify(body.details ?? "")).toContain("idempotency-key");
    }
  });

  it("requires a venue-scoped session — a venue-less actor cannot use the keyed path", async () => {
    // Mirrors the ws door ("the diary is a venue surface"): the ledger
    // records the actor's venue, so a venue-less session has no scope to
    // record. Keyless requests from the same actor are untouched.
    const res = await server.inject({
      method: "PATCH",
      url: `/bookings/${BOOKING_ID}`,
      headers: {
        authorization: `Bearer ${staffToken(null)}`,
        "idempotency-key": COMMAND_ID,
      },
      payload: { title: "Renamed" },
    });
    expect(res.statusCode).toBe(400);
    const body = JSON.parse(res.body) as { code: string };
    expect(body.code).toBe("IDEMPOTENCY_REQUIRES_VENUE");
  });

  it("fronts the command gate: a hallkeeper's keyed transition is denied before any work", async () => {
    const res = await server.inject({
      method: "POST",
      url: `/bookings/${BOOKING_ID}/transition`,
      headers: {
        authorization: `Bearer ${hallkeeperToken()}`,
        "idempotency-key": COMMAND_ID,
      },
      payload: { toState: "released" },
    });
    expect(res.statusCode).toBe(403);
    const body = JSON.parse(res.body) as { code: string };
    expect(body.code).toBe("FORBIDDEN");
  });

  it("scopes a keyed create to the actor's own venue (VENUE_SCOPE_MISMATCH)", async () => {
    // The ws transport scopes creates to the connection's venue; the REST
    // keyed path scopes to the actor's venue — same rule, same code.
    const res = await server.inject({
      method: "POST",
      url: "/bookings",
      headers: {
        authorization: `Bearer ${staffToken()}`,
        "idempotency-key": COMMAND_ID,
      },
      payload: validHoldPayload(OTHER_VENUE_ID),
    });
    expect(res.statusCode).toBe(403);
    const body = JSON.parse(res.body) as { code: string };
    expect(body.code).toBe("VENUE_SCOPE_MISMATCH");
  });

  it("source contract: the keyed branch dispatches the SAME envelope path as /ws/diary", async () => {
    const source = await readFile(resolve("src/routes/bookings.ts"), "utf-8");
    // The keyed path runs executeDiaryCommand with the real deps — one
    // dialect, two transports, ONE ledger.
    expect(source).toContain("executeDiaryCommand(");
    expect(source).toContain("realDiaryCommandDeps(");
    expect(source).toContain("IDEMPOTENCY_REQUIRES_VENUE");
    // The reply advertises replay so operators can see dedupes.
    expect(source).toContain("idempotency-replay");
    // Broadcast only for fresh commits — replays publish nothing.
    expect(source).toContain("execution.changed");
  });

  it("source contract: reads and the tray conversion carry no idempotency surface", async () => {
    const source = await readFile(resolve("src/routes/bookings.ts"), "utf-8");
    const getRoute = source.slice(source.indexOf('server.get("/:id"'), source.indexOf('server.patch("/:id"'));
    expect(getRoute).not.toContain("idempotency");
    const fromEnquiry = source.slice(source.indexOf('server.post("/from-enquiry"'));
    expect(fromEnquiry).not.toContain("idempotency");
  });
});
