import { randomUUID } from "node:crypto";
import type { FastifyBaseLogger, LightMyRequestResponse } from "fastify";
import type { PoolClient } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { registerErrorNormalizer } from "../middleware/error-normalizer.js";
import { opportunityRoutes } from "../routes/opportunities.js";
import { peopleRoutes } from "../routes/people.js";
import { openPeopleFixture, PLATFORM_TARGET, type PeopleFixture, type PeopleFixtureUser } from "./support/people-platform-fixture.js";

// ---------------------------------------------------------------------------
// Deal writes and merges respect each other (T-665, Task 11b).
//
// A deal names a person. While a merge (or its undo) holds that person, a
// deal written at the same moment takes the person first (FOR KEY SHARE) and
// looks again once it has them: so a deal pressed during a merge answers with
// where the person went, never links to the closed record, and a deal moved
// during a merge never holds the deal while it asks for the person, the
// reverse of the merge's order, which deadlocked.
//
// Each race really overlaps: a third connection holds a row the merge needs,
// so the merge stops part-way with the people locked; the deal write is sent
// and seen waiting on the merge (pg_blocking_pids) before the row is let go.
//
// A lock conflict PostgreSQL ends (a deadlock, 40P01) answers 409 RETRY, not
// 500: a third connection waits in a real cycle with the route, and its own
// deadlock check is set late, so the route's check runs first and ends it.
//
// Opt-in, disposable PostgreSQL only. Never consults DATABASE_URL or .env.
// ---------------------------------------------------------------------------

/** Every line the routes log, as it was logged. */
const logged: unknown[][] = [];
function record(...args: unknown[]): void { logged.push(args); }
const capturedLog: FastifyBaseLogger = {
  level: "info",
  fatal: record, error: record, warn: record, info: record, debug: record, trace: record, silent: record,
  child: () => capturedLog,
};

type Method = "GET" | "POST" | "PATCH";

/** A person who will close (L), the one who stays (S), L's deal and enquiry. */
interface Couple {
  readonly s: string;
  readonly l: string;
  readonly deal: string;
  readonly enquiry: string;
}

/** A session seen waiting on a lock, with what it was running. */
interface Waiting {
  readonly pid: number;
  readonly query: string;
}

const RETRY = { error: "Someone else changed this at the same moment. Please try again.", code: "RETRY" };

describe.skipIf(PLATFORM_TARGET === undefined)("deal writes during merges on the migrated disposable database", () => {
  let f: PeopleFixture;
  let spaceId: string;
  const run = randomUUID().slice(0, 8);
  let couples = 0;

  beforeAll(async () => {
    f = await openPeopleFixture(async (server, db) => {
      registerErrorNormalizer(server);
      server.addHook("onRequest", (request, _reply, done) => { request.log = capturedLog; done(); });
      await server.register(peopleRoutes, { db, prefix: "/people" });
      await server.register(opportunityRoutes, { db, prefix: "/opportunities" });
    });
    const { rows } = await f.pool.query<{ id: string }>(
      `INSERT INTO spaces (venue_id, name, slug, width_m, length_m, height_m, floor_plan_outline)
       VALUES ($1, 'The Saloon', 'saloon', 10, 10, 3, '[]') RETURNING id`,
      [f.venueId],
    );
    const space = rows[0]?.id;
    if (space === undefined) throw new Error("No room was made");
    spaceId = space;
  }, 120_000);

  afterAll(async () => {
    await f?.close();
  });

  function send(method: Method, url: string, who: PeopleFixtureUser, payload?: object): Promise<LightMyRequestResponse> {
    return f.server.inject({ method, url, headers: f.bearer(who), ...(payload === undefined ? {} : { payload }) });
  }
  const merge = (closing: string, survivorId: string) => send("POST", `/people/${closing}/merge`, "staff", { survivorId });
  const undo = (mergeId: string) => send("POST", `/people/merges/${mergeId}/undo`, "staff");
  const postDeal = (payload: Record<string, unknown>) =>
    send("POST", "/opportunities", "staff", { venueId: f.venueId, title: `Ceilidh ${randomUUID().slice(0, 8)}`, ...payload });
  const patchDeal = (dealId: string, payload: Record<string, unknown>) => send("PATCH", `/opportunities/${dealId}`, "staff", payload);

  async function one<T extends object>(text: string, values: readonly unknown[]): Promise<T> {
    const { rows } = await f.pool.query<T>(text, [...values]);
    const row = rows[0];
    if (row === undefined) throw new Error(`No row for ${text}`);
    return row;
  }

  async function dealWith(personId: string | null, accountId: string | null = null): Promise<string> {
    return (await one<{ id: string }>(
      `INSERT INTO opportunities (venue_id, title, stage, client_account_id, primary_contact_id)
       VALUES ($1, 'Wedding for I. Fraser', 'new', $2, $3) RETURNING id`,
      [f.venueId, accountId, personId],
    )).id;
  }

  async function couple(): Promise<Couple> {
    couples += 1;
    const s = await f.addPerson({ name: "Isla Fraser", emails: [`isla.fraser@couple${String(couples)}-${run}.example.test`] });
    const l = await f.addPerson({ name: "I. Fraser" });
    const enquiry = (await one<{ id: string }>(
      `INSERT INTO enquiries (venue_id, space_id, name, email, state, event_type, contact_id)
       VALUES ($1, $2, 'I. Fraser', $3, 'submitted', 'wedding', $4) RETURNING id`,
      [f.venueId, spaceId, `i.fraser@couple${String(couples)}-${run}.example.test`, l],
    )).id;
    return { s, l, deal: await dealWith(l), enquiry };
  }

  async function dealsNaming(personId: string): Promise<number> {
    return (await one<{ n: number }>("SELECT count(*)::int AS n FROM opportunities WHERE primary_contact_id = $1", [personId])).n;
  }

  async function contactOf(dealId: string): Promise<string | null> {
    return (await one<{ primary_contact_id: string | null }>("SELECT primary_contact_id FROM opportunities WHERE id = $1", [dealId])).primary_contact_id;
  }

  /** The fields of every line the routes logged with an event. */
  function eventLines(): unknown[] {
    return logged.flatMap(([fields]) => (typeof fields === "object" && fields !== null && "event" in fields ? [fields] : []));
  }

  /**
   * A third connection's transaction, rolled back at the end whatever
   * happens, so every request it held is let go. `deadlockTimeout` makes its
   * own deadlock check run late, so in a cycle with a route the route's check
   * runs first and the route is the one PostgreSQL ends.
   */
  async function holding<T>(work: (holder: PoolClient, holderPid: number) => Promise<T>, options: { deadlockTimeout?: string } = {}): Promise<T> {
    const holder = await f.pool.connect();
    try {
      await holder.query("BEGIN");
      if (options.deadlockTimeout !== undefined) await holder.query(`SET LOCAL deadlock_timeout = '${options.deadlockTimeout}'`);
      const pid = (await holder.query<{ pid: number }>("SELECT pg_backend_pid() AS pid")).rows[0]?.pid;
      if (pid === undefined) throw new Error("The holder has no backend");
      return await work(holder, pid);
    } finally {
      await holder.query("ROLLBACK");
      holder.release();
    }
  }

  /** The one session of this fixture waiting on a lock `blockerPid` holds,
   *  polled from the holder's own transaction. */
  async function blockedBy(holder: PoolClient, blockerPid: number, what: string): Promise<Waiting> {
    for (let attempt = 0; ; attempt += 1) {
      // pg_stat_activity is read once per transaction unless the snapshot is
      // cleared; pg_blocking_pids reads the lock table as it is now.
      await holder.query("SELECT pg_stat_clear_snapshot()");
      const { rows } = await holder.query<Waiting>(
        `SELECT pid, query FROM pg_stat_activity
          WHERE application_name = current_setting('application_name')
            AND wait_event_type = 'Lock' AND $1 = ANY(pg_blocking_pids(pid))`,
        [blockerPid],
      );
      const [found] = rows;
      if (rows.length === 1 && found !== undefined) return found;
      if (rows.length > 1) throw new Error(`More than one session waited on ${what}`);
      if (attempt >= 400) throw new Error(`Nothing ever waited on ${what}`);
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
  }

  it("a deal pressed during a merge never links to the closed record", async () => {
    const c = await couple();
    const title = `Ceilidh for I. Fraser ${run}`;
    let merging: Promise<LightMyRequestResponse> | undefined;
    let posting: Promise<LightMyRequestResponse> | undefined;
    const { mergeSession, postSession } = await holding(async (holder, holderPid) => {
      // The merge locks L and S, then stops at L's deal, which the holder has.
      await holder.query("SELECT 1 FROM opportunities WHERE id = $1 FOR UPDATE", [c.deal]);
      merging = merge(c.l, c.s);
      const mergeWaiting = await blockedBy(holder, holderPid, "the held deal");
      expect(mergeWaiting.query).toMatch(/^update "opportunities"/iu);
      // A deal naming L, sent while the merge holds L: it waits on the merge.
      posting = send("POST", "/opportunities", "staff", { venueId: f.venueId, title, primaryContactId: c.l });
      const postWaiting = await blockedBy(holder, mergeWaiting.pid, "the merge");
      return { mergeSession: mergeWaiting, postSession: postWaiting };
    });
    if (merging === undefined || posting === undefined) throw new Error("A press never started");
    const [merged, posted] = await Promise.all([merging, posting]);

    // Both were in flight at once: the deal write waited on the merge's pid,
    // at its person, before it wrote anything.
    expect(postSession.pid).not.toBe(mergeSession.pid);
    expect(postSession.query).toMatch(/^select .* from "contacts" .* for key share$/iu);
    expect(merged.statusCode, merged.body).toBe(201);
    expect(posted.statusCode, posted.body).toBe(409);
    expect(posted.json()).toEqual({ error: "This person has been merged into another record", code: "MERGED", mergedIntoId: c.s });
    expect(await dealsNaming(c.l)).toBe(0);
    expect((await one<{ n: number }>("SELECT count(*)::int AS n FROM opportunities WHERE title = $1", [title])).n).toBe(0);
    expect(await contactOf(c.deal)).toBe(c.s);
  }, 60_000);

  it("moving a deal during a merge cannot deadlock", async () => {
    const c = await couple();
    let merging: Promise<LightMyRequestResponse> | undefined;
    let moving: Promise<LightMyRequestResponse> | undefined;
    const { mergeSession, patchSession } = await holding(async (holder, holderPid) => {
      // The merge locks L and S, then stops at L's enquiry, before the deals.
      await holder.query("SELECT 1 FROM enquiries WHERE id = $1 FOR UPDATE", [c.enquiry]);
      merging = merge(c.l, c.s);
      const mergeWaiting = await blockedBy(holder, holderPid, "the held enquiry");
      expect(mergeWaiting.query).toMatch(/^update "enquiries"/iu);
      // L's deal moved to S while the merge holds S.
      moving = patchDeal(c.deal, { primaryContactId: c.s });
      const patchWaiting = await blockedBy(holder, mergeWaiting.pid, "the merge");
      return { mergeSession: mergeWaiting, patchSession: patchWaiting };
    });
    if (merging === undefined || moving === undefined) throw new Error("A press never started");
    const [merged, moved] = await Promise.all([merging, moving]);

    // The move waited on the merge's pid at its person, holding no deal row.
    expect(patchSession.pid).not.toBe(mergeSession.pid);
    expect(patchSession.query).toMatch(/^select .* from "contacts" .* for key share$/iu);
    expect(merged.statusCode, merged.body).toBe(201);
    expect([200, 409], moved.body).toContain(moved.statusCode);
    if (moved.statusCode === 409) expect(moved.json()).toMatchObject({ code: "MERGED", mergedIntoId: c.s });
    expect(await contactOf(c.deal)).toBe(c.s);
    expect(await dealsNaming(c.l)).toBe(0);
  }, 60_000);

  it("a deal names a live person as before", async () => {
    const a = await f.addPerson({ name: "Morag Baird" });
    const b = await f.addPerson({ name: "Callum Baird" });
    const elsewhere = await f.addPerson({ name: "Morag Baird", venueId: f.otherVenueId });
    const created = await postDeal({ primaryContactId: a });
    expect(created.statusCode, created.body).toBe(201);
    const dealId = created.json<{ data: { opportunity: { id: string; primaryContactId: string } } }>().data.opportunity.id;
    expect(await contactOf(dealId)).toBe(a);

    const moved = await patchDeal(dealId, { primaryContactId: b, title: "Ceilidh for the Bairds" });
    expect(moved.statusCode, moved.body).toBe(200);
    expect(moved.json()).toMatchObject({ data: { id: dealId, primaryContactId: b, title: "Ceilidh for the Bairds" } });
    const cleared = await patchDeal(dealId, { primaryContactId: null });
    expect(cleared.statusCode, cleared.body).toBe(200);
    expect(await contactOf(dealId)).toBeNull();
    const untouched = await patchDeal(dealId, { guestCount: 80 });
    expect(untouched.statusCode, untouched.body).toBe(200);

    // Unknown, deleted, erased and another venue's people keep today's answers.
    const deleted = await f.addPerson({ name: "Deleted Person" });
    await f.pool.query("UPDATE contacts SET deleted_at = now() WHERE id = $1", [deleted]);
    const erased = await f.addPerson({ name: "Erased Person" });
    await f.pool.query("UPDATE contacts SET erased_at = now() WHERE id = $1", [erased]);
    const notFound = { error: "contact not found", code: "NOT_FOUND" };
    for (const [contact, status, body] of [
      [randomUUID(), 404, notFound],
      [deleted, 404, notFound],
      [erased, 404, notFound],
      [elsewhere, 422, { error: "contact belongs to a different venue", code: "VENUE_MISMATCH" }],
    ] as const) {
      for (const res of [await postDeal({ primaryContactId: contact }), await patchDeal(dealId, { primaryContactId: contact })]) {
        expect(res.statusCode, `${contact}: ${res.body}`).toBe(status);
        expect(res.json()).toEqual(body);
      }
    }

    // A person merged before the write answers where they went.
    const closing = await f.addPerson({ name: "M. Baird" });
    const done = await merge(closing, a);
    expect(done.statusCode, done.body).toBe(201);
    for (const res of [await postDeal({ primaryContactId: closing }), await patchDeal(dealId, { primaryContactId: closing })]) {
      expect(res.statusCode, res.body).toBe(409);
      expect(res.json()).toEqual({ error: "This person has been merged into another record", code: "MERGED", mergedIntoId: a });
    }
    // The links are still checked in their order: the organisation first.
    const both = await postDeal({ clientAccountId: randomUUID(), primaryContactId: closing });
    expect(both.statusCode, both.body).toBe(404);
    expect(both.json()).toEqual({ error: "clientAccount not found", code: "NOT_FOUND" });
    expect(await dealsNaming(closing)).toBe(0);
    expect(await contactOf(dealId)).toBeNull();
  }, 60_000);

  // -------------------------------------------------------------------------
  // A lock conflict PostgreSQL ends answers "try again".
  // -------------------------------------------------------------------------

  it("answers try again when a merge meets a deadlock, and the merge then goes through", async () => {
    const c = await couple();
    logged.length = 0;
    let merging: Promise<LightMyRequestResponse> | undefined;
    const { refused, cycle } = await holding(async (holder, holderPid) => {
      await holder.query("SELECT 1 FROM opportunities WHERE id = $1 FOR UPDATE", [c.deal]);
      merging = merge(c.l, c.s);
      const mergeWaiting = await blockedBy(holder, holderPid, "the held deal");
      // The holder asks for L, which the merge holds: a cycle.
      const asking = holder.query("SELECT 1 FROM contacts WHERE id = $1 FOR KEY SHARE", [c.l]);
      const answer = await merging;
      await asking;
      return { refused: answer, cycle: mergeWaiting };
    }, { deadlockTimeout: "10s" });

    expect(cycle.query).toMatch(/^update "opportunities"/iu);
    expect(refused.statusCode, refused.body).toBe(409);
    expect(refused.json()).toEqual(RETRY);
    expect(eventLines()).toEqual([{ event: "people.merge.retry", personId: c.l, survivorId: c.s, pgCode: "40P01" }]);
    // Nothing moved; the same press now goes through.
    expect(await contactOf(c.deal)).toBe(c.l);
    expect((await merge(c.l, c.s)).statusCode).toBe(201);
  }, 60_000);

  it("answers try again when an undo meets a deadlock, and the undo then goes through", async () => {
    const c = await couple();
    const made = await merge(c.l, c.s);
    expect(made.statusCode, made.body).toBe(201);
    const mergeId = made.json<{ data: { mergeId: string } }>().data.mergeId;
    logged.length = 0;
    let undoing: Promise<LightMyRequestResponse> | undefined;
    const { refused, cycle } = await holding(async (holder, holderPid) => {
      await holder.query("SELECT 1 FROM opportunities WHERE id = $1 FOR UPDATE", [c.deal]);
      undoing = undo(mergeId);
      const undoWaiting = await blockedBy(holder, holderPid, "the held deal");
      // The holder asks for S, which the undo holds: a cycle.
      const asking = holder.query("SELECT 1 FROM contacts WHERE id = $1 FOR KEY SHARE", [c.s]);
      const answer = await undoing;
      await asking;
      return { refused: answer, cycle: undoWaiting };
    }, { deadlockTimeout: "10s" });

    expect(cycle.query).toMatch(/^update "opportunities"/iu);
    expect(refused.statusCode, refused.body).toBe(409);
    expect(refused.json()).toEqual(RETRY);
    expect(eventLines()).toEqual([{ event: "people.merge_undo.retry", mergeId, pgCode: "40P01" }]);
    expect(await contactOf(c.deal)).toBe(c.s);
    const again = await undo(mergeId);
    expect(again.statusCode, again.body).toBe(200);
    expect(await contactOf(c.deal)).toBe(c.l);
  }, 60_000);

  it("answers try again when a new deal meets a deadlock", async () => {
    const person = await f.addPerson({ name: "Ewan Gillies" });
    const household = await f.addOrganisation({ name: "Gillies household" });
    const title = `Burns supper ${run}`;
    logged.length = 0;
    let posting: Promise<LightMyRequestResponse> | undefined;
    const { refused, cycle } = await holding(async (holder, holderPid) => {
      // The deal takes the person, then stops at the household the holder has.
      await holder.query("SELECT 1 FROM client_accounts WHERE id = $1 FOR UPDATE", [household]);
      posting = send("POST", "/opportunities", "staff", { venueId: f.venueId, title, clientAccountId: household, primaryContactId: person });
      const postWaiting = await blockedBy(holder, holderPid, "the held household");
      // The holder asks for the person the deal holds: a cycle.
      const asking = holder.query("SELECT 1 FROM contacts WHERE id = $1 FOR UPDATE", [person]);
      const answer = await posting;
      await asking;
      return { refused: answer, cycle: postWaiting };
    }, { deadlockTimeout: "10s" });

    expect(cycle.query).toMatch(/^insert into "opportunities"/iu);
    expect(refused.statusCode, refused.body).toBe(409);
    expect(refused.json()).toEqual(RETRY);
    expect(eventLines()).toEqual([{ event: "opportunities.create.retry", venueId: f.venueId, primaryContactId: person, pgCode: "40P01" }]);
    expect((await one<{ n: number }>("SELECT count(*)::int AS n FROM opportunities WHERE title = $1", [title])).n).toBe(0);
  }, 60_000);

  it("answers try again when moving a deal meets a deadlock", async () => {
    const from = await f.addPerson({ name: "Ewan Gillies" });
    const to = await f.addPerson({ name: "Shona Gillies" });
    const dealId = await dealWith(from);
    logged.length = 0;
    let moving: Promise<LightMyRequestResponse> | undefined;
    const { refused, cycle } = await holding(async (holder, holderPid) => {
      // The move takes the new person, then stops at the deal the holder has.
      await holder.query("SELECT 1 FROM opportunities WHERE id = $1 FOR UPDATE", [dealId]);
      moving = patchDeal(dealId, { primaryContactId: to });
      const patchWaiting = await blockedBy(holder, holderPid, "the held deal");
      // The holder asks for the person the move holds: a cycle.
      const asking = holder.query("SELECT 1 FROM contacts WHERE id = $1 FOR UPDATE", [to]);
      const answer = await moving;
      await asking;
      return { refused: answer, cycle: patchWaiting };
    }, { deadlockTimeout: "10s" });

    expect(cycle.query).toMatch(/^update "opportunities"/iu);
    expect(refused.statusCode, refused.body).toBe(409);
    expect(refused.json()).toEqual(RETRY);
    expect(eventLines()).toEqual([{ event: "opportunities.update.retry", opportunityId: dealId, pgCode: "40P01" }]);
    expect(await contactOf(dealId)).toBe(from);
    const again = await patchDeal(dealId, { primaryContactId: to });
    expect(again.statusCode, again.body).toBe(200);
    expect(await contactOf(dealId)).toBe(to);
  }, 60_000);
});
