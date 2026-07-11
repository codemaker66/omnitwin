import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import type { FastifyInstance } from "fastify";

process.env["DATABASE_URL"] = "postgresql://mock:mock@localhost/mock";
process.env["JWT_SECRET"] = "test-jwt-secret-that-is-at-least-32-characters-long";

const { buildServer } = await import("../index.js");

// ---------------------------------------------------------------------------
// Booking write surface (T-487/488/491) — auth + validation boundary through
// the real server, plus source-contract pins for the invariants that need a
// live database to exercise end-to-end (constraint race mapping, transaction
// shape, venue scoping order).
// ---------------------------------------------------------------------------

let server: FastifyInstance;

const VENUE_ID = "00000000-0000-4000-8000-000000000001";
const OTHER_VENUE_ID = "00000000-0000-4000-8000-000000000002";
const BOOKING_ID = "00000000-0000-4000-8000-000000000003";
const OWNER_ID = "00000000-0000-4000-8000-000000000099";

function signToken(payload: {
  id: string;
  email: string;
  role: string;
  venueId: string | null;
}): string {
  return JSON.stringify(payload);
}

const staffToken = (venueId: string = VENUE_ID): string =>
  signToken({ id: OWNER_ID, email: "staff@test.com", role: "staff", venueId });

const hallkeeperToken = (): string =>
  signToken({ id: OWNER_ID, email: "keeper@test.com", role: "hallkeeper", venueId: VENUE_ID });

function validHoldPayload(): Record<string, unknown> {
  return {
    venueId: VENUE_ID,
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

describe("booking routes — auth and validation boundary", () => {
  it("returns 401 without auth on every surface", async () => {
    const surfaces = [
      { method: "POST" as const, url: "/bookings", payload: validHoldPayload() },
      { method: "GET" as const, url: `/bookings/${BOOKING_ID}` },
      { method: "PATCH" as const, url: `/bookings/${BOOKING_ID}`, payload: { title: "X" } },
      {
        method: "POST" as const,
        url: `/bookings/${BOOKING_ID}/transition`,
        payload: { toState: "ink" },
      },
    ];
    for (const surface of surfaces) {
      const res = await server.inject(surface);
      expect(res.statusCode, `${surface.method} ${surface.url}`).toBe(401);
    }
  });

  it("rejects an unknown kind", async () => {
    const res = await server.inject({
      method: "POST",
      url: "/bookings",
      headers: { authorization: `Bearer ${staffToken()}` },
      payload: { ...validHoldPayload(), kind: "pencilled" },
    });
    expect(res.statusCode).toBe(400);
  });

  it("rejects a hold missing its hygiene fields, naming each", async () => {
    const payload = validHoldPayload();
    delete payload["decisionAt"];
    delete payload["nextAction"];
    const res = await server.inject({
      method: "POST",
      url: "/bookings",
      headers: { authorization: `Bearer ${staffToken()}` },
      payload,
    });
    expect(res.statusCode).toBe(400);
    const body = JSON.parse(res.body) as { code: string; details: { path: unknown[] }[] };
    expect(body.code).toBe("VALIDATION_ERROR");
    const paths = body.details.flatMap((issue) => issue.path);
    expect(paths).toContain("decisionAt");
    expect(paths).toContain("nextAction");
  });

  it("rejects a rank on a non-hold", async () => {
    const res = await server.inject({
      method: "POST",
      url: "/bookings",
      headers: { authorization: `Bearer ${staffToken()}` },
      payload: { ...validHoldPayload(), kind: "ink", rank: 1 },
    });
    expect(res.statusCode).toBe(400);
  });

  it("rejects an inverted time window", async () => {
    const res = await server.inject({
      method: "POST",
      url: "/bookings",
      headers: { authorization: `Bearer ${staffToken()}` },
      payload: {
        ...validHoldPayload(),
        startsAt: "2026-09-19T23:30:00.000Z",
        endsAt: "2026-09-19T17:00:00.000Z",
      },
    });
    expect(res.statusCode).toBe(400);
  });

  it("refuses hallkeeper writes — the diary is staff/admin territory (review P1)", async () => {
    const created = await server.inject({
      method: "POST",
      url: "/bookings",
      headers: { authorization: `Bearer ${hallkeeperToken()}` },
      payload: validHoldPayload(),
    });
    expect(created.statusCode).toBe(403);
    expect((JSON.parse(created.body) as { code: string }).code).toBe("FORBIDDEN");

    const patched = await server.inject({
      method: "PATCH",
      url: `/bookings/${BOOKING_ID}`,
      headers: { authorization: `Bearer ${hallkeeperToken()}` },
      payload: { title: "Renamed" },
    });
    expect(patched.statusCode).toBe(403);
  });

  it("keeps hallkeeper reads open (read-facing ops role)", async () => {
    const res = await server.inject({
      method: "GET",
      url: `/bookings/${BOOKING_ID}`,
      headers: { authorization: `Bearer ${hallkeeperToken()}` },
    });
    expect(res.statusCode).not.toBe(401);
    expect(res.statusCode).not.toBe(403);
  });

  it("refuses cross-venue creation before touching booking data", async () => {
    const res = await server.inject({
      method: "POST",
      url: "/bookings",
      headers: { authorization: `Bearer ${staffToken(OTHER_VENUE_ID)}` },
      payload: validHoldPayload(),
    });
    expect(res.statusCode).toBe(403);
    expect((JSON.parse(res.body) as { code: string }).code).toBe("FORBIDDEN");
  });

  it("accepts a fully-hygienic hold shape before hitting the database", async () => {
    const res = await server.inject({
      method: "POST",
      url: "/bookings",
      headers: { authorization: `Bearer ${staffToken()}` },
      payload: validHoldPayload(),
    });
    expect(res.statusCode).not.toBe(400);
    expect(res.statusCode).not.toBe(401);
    expect(res.statusCode).not.toBe(403);
  });

  it("rejects lifecycle vocabulary outside the state list on transition", async () => {
    const res = await server.inject({
      method: "POST",
      url: `/bookings/${BOOKING_ID}/transition`,
      headers: { authorization: `Bearer ${staffToken()}` },
      payload: { toState: "confirmed" },
    });
    expect(res.statusCode).toBe(400);
  });

  it("rejects kind/status edits through PATCH", async () => {
    const res = await server.inject({
      method: "PATCH",
      url: `/bookings/${BOOKING_ID}`,
      headers: { authorization: `Bearer ${staffToken()}` },
      payload: { kind: "ink" },
    });
    expect(res.statusCode).toBe(400);
  });
});

describe("booking routes — source contract", () => {
  it("maps the exclusion-constraint race to a calm 409 and never a stack trace", async () => {
    const source = await readFile(resolve("src/routes/bookings.ts"), "utf-8");
    expect(source).toContain('const PG_EXCLUSION_VIOLATION = "23P01"');
    expect(source).toContain("INK_SLOT_TAKEN");
    expect(source).toContain("first to confirm wins");
  });

  it("checks write authority before any booking write", async () => {
    const source = await readFile(resolve("src/routes/bookings.ts"), "utf-8");
    expect(source.indexOf("canWriteBookings(request.user, input.venueId)")).toBeGreaterThan(-1);
    expect(source.indexOf("canWriteBookings(request.user, input.venueId)")).toBeLessThan(
      source.indexOf(".insert(bookings)"),
    );
  });

  it("runs transition, history, and ladder resequence in one transaction", async () => {
    const source = await readFile(resolve("src/routes/bookings.ts"), "utf-8");
    const txStart = source.indexOf("db.transaction(async (tx) =>");
    expect(txStart).toBeGreaterThan(-1);
    const txBody = source.slice(txStart);
    expect(txBody).toContain("tx.insert(bookingStatusHistory)");
    expect(txBody).toContain("resequenceLaddersAfterExit(");
    expect(source).toContain("bookingStateToColumns(toState, row.kind)");
  });

  it("serialises concurrent hold exits: ordered FOR UPDATE lock + compare-and-set write (review P1)", async () => {
    const source = await readFile(resolve("src/routes/bookings.ts"), "utf-8");
    const txStart = source.indexOf("db.transaction(async (tx) =>");
    const txBody = source.slice(txStart);
    // Deterministic lock order across the space's ladder rows.
    expect(txBody).toContain('.for("update")');
    expect(txBody).toContain("orderBy(asc(bookings.id))");
    // The lock precedes the state write inside the transaction.
    expect(txBody.indexOf('.for("update")')).toBeLessThan(txBody.indexOf(".update(bookings)"));
    // CAS: the write re-asserts the kind/status the transition was derived from.
    expect(txBody).toContain("eq(bookings.kind, row.kind)");
    expect(txBody).toContain("eq(bookings.status, row.status)");
    expect(source).toContain("BOOKING_STATE_CHANGED");
  });

  it("treats exited bookings as history — PATCH refuses them (review P2)", async () => {
    const source = await readFile(resolve("src/routes/bookings.ts"), "utf-8");
    expect(source).toContain("BOOKING_NOT_ACTIVE");
    expect(source).toContain('row.status !== "active"');
  });

  it("scopes diary writes to staff/admin while reads keep the shared venue policy", async () => {
    const source = await readFile(resolve("src/routes/bookings.ts"), "utf-8");
    expect(source).toContain('new Set(["staff", "admin"])');
    expect(source).toContain("canWriteBookings(request.user, input.venueId)");
    // Reads still use the shared helper (hallkeeper stays read-facing).
    expect(source).toContain("canManageVenue(request.user, row.venueId)");
  });

  it("enforces hold hygiene on edits of live holds", async () => {
    const source = await readFile(resolve("src/routes/bookings.ts"), "utf-8");
    expect(source).toContain("HOLD_HYGIENE_REQUIRED");
    expect(source).toContain("holdHygieneIssues");
  });

  it("clears the ladder rank on promotion to ink", async () => {
    const source = await readFile(resolve("src/routes/bookings.ts"), "utf-8");
    expect(source).toContain('rank: toState === "ink" ? null : row.rank');
  });

  it("carries no unsupported claim language", async () => {
    const source = await readFile(resolve("src/routes/bookings.ts"), "utf-8");
    expect(source).not.toContain("certified safe");
    expect(source).not.toContain("fire approved");
    expect(source).not.toContain("legally compliant");
  });
});
