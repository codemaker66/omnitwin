import { randomUUID } from "node:crypto";
import { Pool } from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import { getTableConfig, type PgTable } from "drizzle-orm/pg-core";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import * as schema from "../db/schema.js";
import { moveDealWithProposal } from "../services/deal-stage-from-proposal.js";

// ---------------------------------------------------------------------------
// A proposal's moves move its deal (roadmap X1), on isolated PostgreSQL.
//
// Only real rows show that a move is made from where the deal stood and
// nowhere else, that two events at once record one move, and that the move
// and its history row are written together.
//
// Opt-in, isolated PostgreSQL only. Never consults DATABASE_URL or .env.
// ---------------------------------------------------------------------------

const testUrl = process.env["VENVIEWER_ROUTE_TEST_DATABASE_URL"];
if (testUrl !== undefined) {
  const parsed = new URL(testUrl);
  if (!["postgres:", "postgresql:"].includes(parsed.protocol)
    || parsed.hostname !== "127.0.0.1" || parsed.port !== "55476"
    || parsed.pathname !== "/venviewer_route_atomicity_test"
    || parsed.search !== "" || parsed.hash !== "") {
    throw new Error("Deal stage tests require their explicit isolated loopback database");
  }
}

const VENUE = "22222222-2222-4222-8222-222222222222";
const OTHER_VENUE = "22222222-2222-4222-8222-222222222999";
const STAFF = "33333333-3333-4333-8333-333333333333";
const DEAL = "cccccccc-0000-4000-8000-000000000001";

describe.skipIf(testUrl === undefined)("a proposal's moves move its deal", () => {
  let pool: Pool;
  let db: ReturnType<typeof drizzle<typeof schema>>;
  const fixtureSchema = `deal_stage_${randomUUID().replaceAll("-", "")}`;
  const tables: PgTable[] = [schema.opportunities, schema.opportunityStatusHistory];

  beforeAll(async () => {
    pool = new Pool({ connectionString: testUrl, application_name: fixtureSchema, max: 4, options: `-c search_path=${fixtureSchema}` });
    await pool.query(`CREATE SCHEMA "${fixtureSchema}"`);
    for (const table of tables) {
      const config = getTableConfig(table);
      const columns = config.columns.map((column) => {
        let defaultSql = "";
        if (column.name === "id") defaultSql = " primary key default gen_random_uuid()";
        else if (column.name === "created_at" || column.name === "updated_at") defaultSql = " default now()";
        return `"${column.name}" ${column.getSQLType()}${defaultSql}`;
      });
      await pool.query(`CREATE TABLE "${config.name}" (${columns.join(", ")})`);
    }
    db = drizzle(pool, { schema });
  }, 120_000);

  beforeEach(async () => {
    await pool.query("TRUNCATE opportunities, opportunity_status_history");
  });

  afterAll(async () => {
    if (pool !== undefined) {
      await pool.query(`DROP SCHEMA IF EXISTS "${fixtureSchema}" CASCADE`);
      await pool.end();
    }
  }, 60_000);

  async function deal(stage: string, venueId = VENUE): Promise<void> {
    await pool.query(
      `INSERT INTO opportunities (id, venue_id, title, stage, estimated_value_minor, currency, next_action)
       VALUES ($1, $2, 'Henderson wedding', $3, 0, 'GBP', 'Something owed')`,
      [DEAL, venueId, stage],
    );
  }

  async function standing(): Promise<{ stage: string; nextAction: string; closed: boolean; history: { from: string; to: string; by: string | null; note: string }[] }> {
    const [row] = (await pool.query<{ stage: string; next_action: string; closed_at: Date | null }>(
      "SELECT stage, next_action, closed_at FROM opportunities WHERE id = $1", [DEAL],
    )).rows;
    const history = (await pool.query<{ from_stage: string; to_stage: string; changed_by: string | null; note: string }>(
      "SELECT from_stage, to_stage, changed_by, note FROM opportunity_status_history WHERE opportunity_id = $1 ORDER BY created_at", [DEAL],
    )).rows;
    return {
      stage: row?.stage ?? "", nextAction: row?.next_action ?? "", closed: row?.closed_at !== null && row?.closed_at !== undefined,
      history: history.map((move) => ({ from: move.from_stage, to: move.to_stage, by: move.changed_by, note: move.note })),
    };
  }

  const proposal = { venueId: VENUE, opportunityId: DEAL, currentVersion: 2 };

  it("stands at Proposal sent once the proposal is sent, from wherever it was before", async () => {
    await deal("qualified");
    expect(await moveDealWithProposal(db, proposal, "sent", STAFF)).toBe("proposal_sent");
    expect(await standing()).toEqual({
      stage: "proposal_sent", nextAction: "Wait for the client response and log any requested changes.", closed: false,
      history: [{ from: "qualified", to: "proposal_sent", by: STAFF, note: "The proposal (version 2) was sent." }],
    });
  });

  it("is won when the client accepts, with their act as the reason, and lost when they decline", async () => {
    await deal("proposal_sent");
    expect(await moveDealWithProposal(db, proposal, "accepted", null)).toBe("won");
    const won = await standing();
    expect(won).toMatchObject({ stage: "won", closed: true });
    expect(won.history).toEqual([{ from: "proposal_sent", to: "won", by: null, note: "The client accepted the proposal (version 2)." }]);

    await pool.query("TRUNCATE opportunities, opportunity_status_history");
    await deal("negotiation");
    expect(await moveDealWithProposal(db, proposal, "declined", null)).toBe("lost");
    expect((await standing()).history).toEqual([{ from: "negotiation", to: "lost", by: null, note: "The client declined the proposal (version 2)." }]);
  });

  it("goes to Negotiation when the client asks for changes, and back to Proposal sent when it is sent again", async () => {
    await deal("proposal_sent");
    expect(await moveDealWithProposal(db, proposal, "changes_requested", null)).toBe("negotiation");
    expect(await moveDealWithProposal(db, { ...proposal, currentVersion: 3 }, "sent", STAFF)).toBe("proposal_sent");
    expect((await standing()).history.map((move) => move.note)).toEqual([
      "The client asked for changes to the proposal (version 2).",
      "The proposal (version 3) was sent.",
    ]);
  });

  it("never moves a closed deal, never moves one backwards, and ignores what means nothing for a deal", async () => {
    await deal("won");
    expect(await moveDealWithProposal(db, proposal, "declined", null)).toBeNull();
    expect(await moveDealWithProposal(db, proposal, "sent", STAFF)).toBeNull();
    await pool.query("UPDATE opportunities SET stage = 'negotiation' WHERE id = $1", [DEAL]);
    // Changes asked for again on a deal already in negotiation: nothing to move.
    expect(await moveDealWithProposal(db, proposal, "changes_requested", null)).toBeNull();
    expect(await moveDealWithProposal(db, proposal, "withdrawn", STAFF)).toBeNull();
    expect(await moveDealWithProposal(db, proposal, "expired", null)).toBeNull();
    expect((await standing()).history).toEqual([]);
  });

  it("moves no deal of another venue, and none for a proposal without one", async () => {
    await deal("proposal_sent", OTHER_VENUE);
    expect(await moveDealWithProposal(db, proposal, "accepted", null)).toBeNull();
    expect(await moveDealWithProposal(db, { ...proposal, opportunityId: null }, "accepted", null)).toBeNull();
    expect((await standing()).stage).toBe("proposal_sent");
  });

  it("records one move when two events arrive at once", async () => {
    await deal("proposal_sent");
    const results = await Promise.all([
      moveDealWithProposal(db, proposal, "accepted", null),
      moveDealWithProposal(db, proposal, "accepted", null),
    ]);
    expect(results.filter((result) => result === "won")).toHaveLength(1);
    expect((await standing()).history).toHaveLength(1);
  });
});
