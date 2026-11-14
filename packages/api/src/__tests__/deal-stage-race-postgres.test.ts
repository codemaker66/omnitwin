import { randomUUID } from "node:crypto";
import type { LightMyRequestResponse } from "fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { crmRoutes } from "../routes/crm.js";
import { opportunityRoutes } from "../routes/opportunities.js";
import { nextActionForStage } from "../services/deal-next-action.js";
import { openPeopleFixture, PLATFORM_TARGET, type PeopleFixture, type PeopleFixtureUser } from "./support/people-platform-fixture.js";

// ---------------------------------------------------------------------------
// Two moves of one deal pressed at once (audit dash-commercial-6 and
// enquiries-crm-7).
//
// PATCH /opportunities/:id judges a stage move from the deal as it read it,
// before its transaction. It wrote the move by the deal's id alone, so two
// moves judged from the same stage (Mark won in one tab, Mark lost in
// another) both committed: the stage was whichever wrote last, the history
// held both, and a loss could be recorded for a deal that ended won. The move
// is now written only from the stage it was judged from, so one stands and
// the other is refused with nothing written.
//
// Each race really overlaps: a third connection holds the deal's row while
// both requests read it, judge their move and reach their write; it lets go
// only once both are seen waiting there.
//
// Opt-in, disposable PostgreSQL only. Never consults DATABASE_URL or .env.
// ---------------------------------------------------------------------------

const STAGE_CHANGED = {
  error: "The deal changed after this screen read it, so nothing was done. Reload it to see where it stands.",
  code: "OPPORTUNITY_STAGE_CHANGED",
};

const LOST_TO = { competitorId: null, otherName: "TEST ONLY rival rooms", clientFigureMinor: null, clientFigureBasis: null };

interface Move {
  readonly who: PeopleFixtureUser;
  readonly to: string;
  readonly note: string;
  readonly payload: Readonly<Record<string, unknown>>;
}

interface Written {
  readonly stage: string;
  readonly closedAt: Date | null;
  readonly nextAction: string | null;
  readonly nextActionDueAt: Date | null;
  readonly history: readonly { from_stage: string; to_stage: string; note: string | null }[];
  readonly losses: readonly { other_name: string | null }[];
  readonly activities: number;
}

describe.skipIf(PLATFORM_TARGET === undefined)("deal stage moves on the migrated disposable database", () => {
  let f: PeopleFixture;

  beforeAll(async () => {
    f = await openPeopleFixture(async (server, db) => {
      await server.register(opportunityRoutes, { db, prefix: "/opportunities" });
      await server.register(crmRoutes, { db, prefix: "/crm" });
    });
  }, 120_000);

  afterAll(async () => {
    await f?.close();
  });

  async function deal(stage: string): Promise<string> {
    const { rows } = await f.pool.query<{ id: string }>(
      "INSERT INTO opportunities (venue_id, title, stage) VALUES ($1, $2, $3) RETURNING id",
      [f.venueId, `TEST ONLY Henderson wedding ${randomUUID().slice(0, 8)}`, stage],
    );
    const id = rows[0]?.id;
    if (id === undefined) throw new Error("Deal fixture not written");
    return id;
  }

  function send(dealId: string, who: PeopleFixtureUser, payload: Readonly<Record<string, unknown>>): Promise<LightMyRequestResponse> {
    return f.server.inject({ method: "PATCH", url: `/opportunities/${dealId}`, headers: f.bearer(who), payload });
  }

  async function written(dealId: string): Promise<Written> {
    const [row] = (await f.pool.query<{ stage: string; closed_at: Date | null; next_action: string | null; next_action_due_at: Date | null }>(
      "SELECT stage, closed_at, next_action, next_action_due_at FROM opportunities WHERE id = $1", [dealId],
    )).rows;
    if (row === undefined) throw new Error("No such deal");
    const history = (await f.pool.query<{ from_stage: string; to_stage: string; note: string | null }>(
      "SELECT from_stage, to_stage, note FROM opportunity_status_history WHERE opportunity_id = $1 ORDER BY created_at", [dealId],
    )).rows;
    const losses = (await f.pool.query<{ other_name: string | null }>(
      "SELECT other_name FROM competitor_losses WHERE opportunity_id = $1", [dealId],
    )).rows;
    const activities = (await f.pool.query<{ n: number }>(
      "SELECT count(*)::int AS n FROM activities WHERE opportunity_id = $1", [dealId],
    )).rows[0]?.n ?? -1;
    return {
      stage: row.stage, closedAt: row.closed_at, nextAction: row.next_action, nextActionDueAt: row.next_action_due_at,
      history, losses, activities,
    };
  }

  /** A deal with its own next step, due when given, and closed when given. */
  async function dealWithStep(stage: string, nextAction: string, dueAt: Date, closedAt: Date | null = null): Promise<string> {
    const { rows } = await f.pool.query<{ id: string }>(
      `INSERT INTO opportunities (venue_id, title, stage, next_action, next_action_due_at, closed_at)
       VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
      [f.venueId, `TEST ONLY Robertson lunch ${randomUUID().slice(0, 8)}`, stage, nextAction, dueAt, closedAt],
    );
    const id = rows[0]?.id;
    if (id === undefined) throw new Error("Deal fixture not written");
    return id;
  }

  function daysFromNow(days: number): Date {
    return new Date(Date.now() + days * 86_400_000);
  }

  /** The desk's first sentence: open deals with a step due today or already past. */
  async function due(): Promise<{ overdue: number; today: number }> {
    const answer = await f.server.inject({ method: "GET", url: "/crm/pipeline?order=due", headers: f.bearer("staff") });
    expect(answer.statusCode, answer.body).toBe(200);
    return answer.json<{ data: { due: { overdue: number; today: number } } }>().data.due;
  }

  /** What this fixture's sessions waiting on a lock are running, once `count` of them wait. */
  async function waitingAt(read: (text: string) => Promise<readonly { query: string }[]>, count: number): Promise<readonly string[]> {
    for (let attempt = 0; ; attempt += 1) {
      const rows = await read(
        `SELECT query FROM pg_stat_activity
          WHERE application_name = current_setting('application_name')
            AND pid <> pg_backend_pid() AND wait_event_type = 'Lock'`,
      );
      if (rows.length === count) return rows.map((row) => row.query);
      if (rows.length > count) throw new Error(`More than ${String(count)} sessions waited`);
      if (attempt >= 400) throw new Error(`Only ${String(rows.length)} of ${String(count)} sessions ever waited`);
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
  }

  /** Two moves of one deal at once: both read it and judge their move while a
   *  third connection holds its row, and the row is let go only once both
   *  wait at their write. */
  async function atOnce(dealId: string, first: Move, second: Move): Promise<readonly LightMyRequestResponse[]> {
    const holder = await f.pool.connect();
    let sent: Promise<LightMyRequestResponse[]> | undefined;
    try {
      await holder.query("BEGIN");
      await holder.query("SELECT 1 FROM opportunities WHERE id = $1 FOR UPDATE", [dealId]);
      sent = Promise.all([send(dealId, first.who, first.payload), send(dealId, second.who, second.payload)]);
      const queries = await waitingAt(async (text) => {
        // pg_stat_activity is read once per transaction unless cleared.
        await holder.query("SELECT pg_stat_clear_snapshot()");
        return (await holder.query<{ query: string }>(text)).rows;
      }, 2);
      for (const query of queries) expect(query).toMatch(/^update "opportunities"/iu);
    } finally {
      await holder.query("ROLLBACK");
      holder.release();
    }
    if (sent === undefined) throw new Error("The moves were never sent");
    return sent;
  }

  it("lets one of two moves pressed at once stand, and refuses the other with nothing written for it", async () => {
    const id = await deal("proposal_sent");
    const won: Move = { who: "staff", to: "won", note: "TEST ONLY signed today", payload: { stage: "won", note: "TEST ONLY signed today" } };
    const lost: Move = {
      who: "sales", to: "lost", note: "TEST ONLY went elsewhere",
      payload: { stage: "lost", note: "TEST ONLY went elsewhere", lostTo: LOST_TO },
    };

    const answers = await atOnce(id, won, lost);

    expect(answers.map((answer) => answer.statusCode).sort()).toEqual([200, 409]);
    const winner = answers[0]?.statusCode === 200 ? won : lost;
    const refused = answers.find((answer) => answer.statusCode === 409);
    expect(refused?.json()).toEqual(STAGE_CHANGED);
    const after = await written(id);
    expect(after.stage).toBe(winner.to);
    expect(after.history).toEqual([{ from_stage: "proposal_sent", to_stage: winner.to, note: winner.note }]);
    expect(after.losses).toEqual(winner === lost ? [{ other_name: LOST_TO.otherName }] : []);
    expect(after.activities).toBe(0);
  }, 60_000);

  it("writes one move of two identical ones pressed at once, with one line of history", async () => {
    const id = await deal("negotiation");
    const won: Move = { who: "staff", to: "won", note: "TEST ONLY signed", payload: { stage: "won", note: "TEST ONLY signed" } };

    const answers = await atOnce(id, won, { ...won, who: "manager" });

    expect(answers.map((answer) => answer.statusCode).sort()).toEqual([200, 409]);
    const after = await written(id);
    expect(after.stage).toBe("won");
    expect(after.history).toEqual([{ from_stage: "negotiation", to_stage: "won", note: "TEST ONLY signed" }]);
  }, 60_000);

  it("writes a single legal move as before: its stage, closing date, next step, history and who won", async () => {
    const id = await deal("proposal_sent");

    const answer = await send(id, "staff", { stage: "lost", note: "TEST ONLY chose a hotel", lostTo: LOST_TO });

    expect(answer.statusCode, answer.body).toBe(200);
    expect(answer.json<{ data: { id: string; stage: string } }>().data).toMatchObject({ id, stage: "lost" });
    const after = await written(id);
    expect(after).toMatchObject({
      stage: "lost",
      nextAction: nextActionForStage("lost"),
      history: [{ from_stage: "proposal_sent", to_stage: "lost", note: "TEST ONLY chose a hotel" }],
      losses: [{ other_name: LOST_TO.otherName }],
      activities: 0,
    });
    expect(after.closedAt).toBeInstanceOf(Date);

    // A save that moves no stage is written as before.
    const valued = await send(id, "staff", { estimatedValueMinor: 250_000 });
    expect(valued.statusCode, valued.body).toBe(200);
    expect((await written(id)).history).toHaveLength(1);
  });

  it("still refuses a move the stage it was read at does not allow", async () => {
    const id = await deal("won");

    const answer = await send(id, "staff", { stage: "lost", note: "TEST ONLY changed their mind", lostTo: LOST_TO });

    expect(answer.statusCode).toBe(422);
    expect(answer.json()).toMatchObject({ code: "INVALID_TRANSITION" });
    expect(await written(id)).toMatchObject({ stage: "won", history: [], losses: [] });
  });

  // A move gives the deal its new stage's own step (audit
  // api-enquiries-people-3). The old step's date went with the old step: kept,
  // it called a deal that is only waiting on the client overdue.
  it("gives a moved deal its new stage's step with no date, so a deal only waiting is not overdue", async () => {
    const id = await dealWithStep("new", "TEST ONLY Call the client back", daysFromNow(-2));
    expect((await due()).overdue).toBe(1);

    const moved = await send(id, "staff", { stage: "qualified" });

    expect(moved.statusCode, moved.body).toBe(200);
    expect(await written(id)).toMatchObject({
      stage: "qualified",
      nextAction: nextActionForStage("qualified"),
      nextActionDueAt: null,
      history: [{ from_stage: "new", to_stage: "qualified", note: null }],
    });
    expect((await due()).overdue).toBe(0);
  });

  it("keeps the date a move is sent with", async () => {
    const id = await dealWithStep("qualified", "TEST ONLY Draft the proposal", daysFromNow(-1));
    const dueAt = daysFromNow(5);

    const moved = await send(id, "staff", { stage: "proposal_drafting", nextActionDueAt: dueAt.toISOString() });

    expect(moved.statusCode, moved.body).toBe(200);
    expect(await written(id)).toMatchObject({ nextAction: nextActionForStage("proposal_drafting"), nextActionDueAt: dueAt });
  });

  // A save that names the stage the deal already has moves nothing, so it
  // writes nothing a move would: not the stage's step over the booker's own,
  // not a new date, and not a new closing date.
  it("keeps the step, its date and the closing date of a save that names the stage the deal already has", async () => {
    const dueAt = daysFromNow(3);
    const open = await dealWithStep("qualified", "TEST ONLY Send the menus", dueAt);

    const saved = await send(open, "staff", { stage: "qualified", estimatedValueMinor: 250_000 });

    expect(saved.statusCode, saved.body).toBe(200);
    expect(await written(open)).toMatchObject({
      stage: "qualified", nextAction: "TEST ONLY Send the menus", nextActionDueAt: dueAt, history: [],
    });

    const closedAt = new Date("2026-10-01T10:00:00.000Z");
    const won = await dealWithStep("won", "TEST ONLY Book the handoff meeting", dueAt, closedAt);

    const again = await send(won, "staff", { stage: "won" });

    expect(again.statusCode, again.body).toBe(200);
    expect(await written(won)).toMatchObject({
      stage: "won", nextAction: "TEST ONLY Book the handoff meeting", nextActionDueAt: dueAt, closedAt, history: [],
    });
  });
});
