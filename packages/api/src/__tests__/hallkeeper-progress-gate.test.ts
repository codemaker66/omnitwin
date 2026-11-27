import Fastify, { type FastifyInstance } from "fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Database } from "../db/client.js";
import { hallkeeperSheetRoutes } from "../routes/hallkeeper-sheet.js";

// ---------------------------------------------------------------------------
// Who may tick a setup sheet (release audit tenancy-f-2), with the layout's
// owner and venue stubbed. The behaviour against real rows, including a
// hallkeeper's tick surviving the owner's untick, is proven in
// hallkeeper-progress-postgres.test.ts.
//
// The stub answers every select with the layout's auth pivot and has no
// insert or delete: a PATCH that got past the gate would fail with a 500, so
// a 403 here is the gate's own answer.
// ---------------------------------------------------------------------------

process.env["NODE_ENV"] = "test";

const CONFIG_ID = "00000000-0000-4000-8000-0000000000c1";
const VENUE_ID = "00000000-0000-4000-8000-0000000000a1";
const OTHER_VENUE_ID = "00000000-0000-4000-8000-0000000000a2";
const OWNER_ID = "00000000-0000-4000-8000-0000000000b1";

interface FakeLimitedQuery {
  limit: (count: number) => Promise<readonly unknown[]>;
}

interface FakeWhereQuery extends FakeLimitedQuery {
  orderBy: (...columns: readonly unknown[]) => FakeLimitedQuery;
}

interface FakeFromQuery {
  where: (...conditions: readonly unknown[]) => FakeWhereQuery;
}

interface FakeSelectQuery {
  from: (table: unknown) => FakeFromQuery;
}

/** sheet-pdf-privacy.test.ts's stub: every select chain resolves to the pivot. */
function pivotOnlyDb(): Database {
  const rows: readonly unknown[] = [{ venueId: VENUE_ID, ownerId: OWNER_ID }];
  const limited: FakeLimitedQuery = { limit: () => Promise.resolve(rows) };
  const select = (() => ({
    from(table: unknown): FakeFromQuery {
      expect(table).toBeDefined();
      return { where: () => ({ ...limited, orderBy: () => limited }) };
    },
  }) satisfies FakeSelectQuery) as Database["select"];
  return { select } as Database;
}

function bearer(id: string, role: string, venueId: string | null): { authorization: string } {
  return { authorization: `Bearer ${JSON.stringify({ id, email: `${id}@gate.invalid`, role, venueId })}` };
}

describe("PATCH /hallkeeper/:configId/progress — only the venue's floor ticks", () => {
  let server: FastifyInstance;

  beforeAll(async () => {
    server = Fastify();
    await server.register(hallkeeperSheetRoutes, { db: pivotOnlyDb(), prefix: "/hallkeeper" });
    await server.ready();
  });

  afterAll(async () => { await server.close(); });

  function patch(headers: { authorization: string }, payload: Record<string, unknown>) {
    return server.inject({ method: "PATCH", url: `/hallkeeper/${CONFIG_ID}/progress`, headers, payload });
  }

  it.each([
    ["the client who owns the layout", bearer(OWNER_ID, "client", null)],
    ["the planner who owns the layout", bearer(OWNER_ID, "planner", null)],
    ["another venue's staff who own the layout", bearer(OWNER_ID, "staff", OTHER_VENUE_ID)],
  ])("refuses %s, for a set and for the legacy toggle", async (_who, headers) => {
    for (const payload of [{ rowKey: "furniture|Centre|Chair|0", checked: true }, { rowKey: "furniture|Centre|Chair|0" }]) {
      const response = await patch(headers, payload);
      expect(response.statusCode, response.body).toBe(403);
      expect(response.json<{ code: string }>().code).toBe("FORBIDDEN");
    }
  });

  it("lets the owner past the read gate on GET", async () => {
    const response = await server.inject({ method: "GET", url: `/hallkeeper/${CONFIG_ID}/progress`,
      headers: bearer(OWNER_ID, "client", null) });
    expect(response.statusCode).not.toBe(403);
  });
});
