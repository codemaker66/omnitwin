import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import type { FastifyBaseLogger, LightMyRequestResponse } from "fastify";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import {
  MERGE_MOVE_TARGETS,
  MERGE_UNDO_DAYS,
  MergePreviewSchema,
  MergeResultSchema,
  MergeUndoReportSchema,
  MergeUndoResultSchema,
  PersonProfileSchema,
  RecordMergeMoveSchema,
  RecordMergeSnapshotSchema,
  type MergePreview,
  type MergeResult,
  type MergeUndoResult,
  type PersonProfile,
  type RecordMergeSnapshot,
} from "@omnitwin/types";
import { accountMemberships, contactPoints, contacts } from "../db/schema.js";
import { registerErrorNormalizer } from "../middleware/error-normalizer.js";
import { peopleRoutes } from "../routes/people.js";
import { publicEnquiryRoutes } from "../routes/public-enquiries.js";
import { toPerson } from "../services/people-records.js";
import { openPeopleFixture, PLATFORM_TARGET, type PeopleFixture, type PeopleFixtureUser } from "./support/people-platform-fixture.js";

// ---------------------------------------------------------------------------
// Merging two records of one client, and undoing it (T-665, Tasks 11 and 12).
//
// The preview says what will move before anything moves. The merge moves
// every reference to the survivor in one transaction (points, memberships,
// enquiries, deals, organisations' primary contact and earlier tombstones),
// removes the points and memberships the survivor already holds while keeping
// them in the record's snapshot, fills the survivor's empty fields, refreshes
// the mirrors and leaves the closed record as a tombstone, so an old link
// answers with where the person went. A second press answers with the same
// merge; two opposite merges pressed at once make exactly one (Review Focus 4).
//
// For 30 days (720 hours) the merge can be undone: the closed record comes
// back with every point and membership it had (the removed ones made again
// with their own ids, each primary as it was), everything still on the
// survivor moves back, and the survivor's filled fields are emptied again.
// What a colleague changed since stays as they left it and is named in the
// report (Review Focus 5); a second press answers with the same report.
//
// The email service and the in-app notice are mocked for the public enquiry
// route, as in people-enquiry-link-postgres.test.ts.
//
// Opt-in, disposable PostgreSQL only. Never consults DATABASE_URL or .env.
// ---------------------------------------------------------------------------

vi.mock("../services/email.js", () => ({
  sendEmail: vi.fn().mockResolvedValue(true),
  sendEmailAsync: vi.fn(),
  resolveEmailReplyTo: () => null,
}));
vi.mock("../services/commercial-notifications.js", () => ({
  notifyCommercialTeam: vi.fn().mockResolvedValue(0),
}));

/** Every line the routes log, as it was logged. */
const logged: unknown[][] = [];
function record(...args: unknown[]): void { logged.push(args); }
const capturedLog: FastifyBaseLogger = {
  level: "info",
  fatal: record, error: record, warn: record, info: record, debug: record, trace: record, silent: record,
  child: () => capturedLog,
};

type Method = "GET" | "POST" | "PATCH" | "PUT" | "DELETE";
type MergedProfile = Extract<PersonProfile, { status: "merged" }>;

/** Each case's own pair, as the brief draws it. */
interface Pair {
  /** The survivor, "Aileen Murray". */
  readonly s: string;
  /** The record that closes, "A. Murray". */
  readonly l: string;
  /** An earlier tombstone, merged into L. */
  readonly t: string;
  /** The organisation both belong to. */
  readonly x: string;
  /** L's household, whose primary contact is L. */
  readonly y: string;
  readonly e1: string;
  readonly e2: string;
  readonly d1: string;
  readonly sharedEmail: string;
  readonly workEmail: string;
}

/** What points at one person, in the merge's order. */
interface PointingAt {
  points: number;
  memberships: number;
  enquiries: number;
  deals: number;
  accounts: number;
  tombstones: number;
}

const NOTHING: PointingAt = { points: 0, memberships: 0, enquiries: 0, deals: 0, accounts: 0, tombstones: 0 };

/** What points at L in each case's pair before any merge. */
const L_HOLDS: PointingAt = { points: 3, memberships: 2, enquiries: 2, deals: 1, accounts: 1, tombstones: 1 };

/** A record_merges row as stored. */
interface MergeRecordRow {
  id: string;
  kind: string;
  survivor_id: string;
  merged_id: string;
  merged_by: string | null;
  merged_at: Date;
  undone_at: Date | null;
  undone_by: string | null;
  snapshot: unknown;
  moves: unknown;
  undo_report: unknown;
}

describe.skipIf(PLATFORM_TARGET === undefined)("merging two people on the migrated disposable database", () => {
  let f: PeopleFixture;
  let spaceId: string;
  // Guest leads are not venue-scoped, so every email here is this run's own.
  const run = randomUUID().slice(0, 8);
  let pairs = 0;
  // The public venue path's opt-in gate reads this; it names the fixture's
  // venues (their slug is their id) and is restored afterwards.
  const savedTwinSlugs = process.env["TWIN_PUBLIC_VENUE_SLUGS"];

  beforeAll(async () => {
    f = await openPeopleFixture(async (server, db) => {
      // The production error envelope and its log line, so a request that
      // fails answers and logs here as it would live.
      registerErrorNormalizer(server);
      server.addHook("onRequest", (request, _reply, done) => { request.log = capturedLog; done(); });
      await server.register(peopleRoutes, { db, prefix: "/people" });
      await server.register(publicEnquiryRoutes, { db, prefix: "/public" });
    });
    process.env["TWIN_PUBLIC_VENUE_SLUGS"] = `${f.venueId},${f.otherVenueId}`;
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
    if (savedTwinSlugs === undefined) delete process.env["TWIN_PUBLIC_VENUE_SLUGS"];
    else process.env["TWIN_PUBLIC_VENUE_SLUGS"] = savedTwinSlugs;
    await f?.close();
  });

  function send(method: Method, url: string, who: PeopleFixtureUser, payload?: object): Promise<LightMyRequestResponse> {
    return f.server.inject({ method, url, headers: f.bearer(who), ...(payload === undefined ? {} : { payload }) });
  }
  const get = (url: string, who: PeopleFixtureUser = "staff") => send("GET", url, who);
  const merge = (closing: string, survivorId: string, who: PeopleFixtureUser = "staff") =>
    send("POST", `/people/${closing}/merge`, who, { survivorId });
  const preview = (closing: string, survivorId: string, who: PeopleFixtureUser = "staff") =>
    get(`/people/${closing}/merge-preview?survivorId=${survivorId}`, who);

  function merged(res: LightMyRequestResponse): MergeResult {
    return MergeResultSchema.parse(res.json().data);
  }

  function previewed(res: LightMyRequestResponse): MergePreview {
    expect(res.statusCode, res.body).toBe(200);
    return MergePreviewSchema.parse(res.json().data);
  }

  function statuses(...responses: readonly LightMyRequestResponse[]): number[] {
    return responses.map((res) => res.statusCode).sort((x, y) => x - y);
  }

  async function one<T extends object>(text: string, values: readonly unknown[]): Promise<T> {
    const { rows } = await f.pool.query<T>(text, [...values]);
    const row = rows[0];
    if (row === undefined) throw new Error(`No row for ${text}`);
    return row;
  }

  async function enquiryFor(personId: string, email: string): Promise<string> {
    return (await one<{ id: string }>(
      `INSERT INTO enquiries (venue_id, space_id, name, email, state, event_type, contact_id)
       VALUES ($1, $2, 'A. Murray', $3, 'submitted', 'wedding', $4) RETURNING id`,
      [f.venueId, spaceId, email, personId],
    )).id;
  }

  async function dealWith(personId: string, accountId: string | null = null): Promise<string> {
    return (await one<{ id: string }>(
      `INSERT INTO opportunities (venue_id, title, stage, client_account_id, primary_contact_id)
       VALUES ($1, 'Wedding for A. Murray', 'new', $2, $3) RETURNING id`,
      [f.venueId, accountId, personId],
    )).id;
  }

  /**
   * S "Aileen Murray": the shared email, primary; member of X, primary; no job
   * title. L "A. Murray": the shared email too, a work email and a phone,
   * primary; member of X (also held) and of household Y; job title
   * "Secretary". E1 and E2 are L's enquiries, D1 L's deal, Y's primary contact
   * is L, and T is an earlier tombstone merged into L by an earlier merge.
   */
  async function pair(): Promise<Pair> {
    pairs += 1;
    const sharedEmail = `aileen.murray@pair${String(pairs)}-${run}.example.test`;
    const workEmail = `aileen@work.pair${String(pairs)}-${run}.example.test`;
    const x = await f.addOrganisation({ name: "Glasgow Medical Society", kind: "organisation" });
    const y = await f.addOrganisation({ name: "Murray household" });
    const s = await f.addPerson({ name: "Aileen Murray", emails: [sharedEmail], organisations: [x] });
    const l = await f.addPerson({ name: "A. Murray", emails: [sharedEmail, workEmail], phones: ["07700 900123"], organisations: [x, y] });
    await f.pool.query("UPDATE contacts SET job_title = 'Secretary' WHERE id = $1", [l]);
    const e1 = await enquiryFor(l, workEmail);
    const e2 = await enquiryFor(l, workEmail);
    const d1 = await dealWith(l);
    await f.pool.query("UPDATE client_accounts SET primary_contact_id = $2 WHERE id = $1", [y, l]);
    const t = await f.addPerson({ name: "Aileen M." });
    const earlier = await merge(t, l);
    expect(earlier.statusCode, earlier.body).toBe(201);
    return { s, l, t, x, y, e1, e2, d1, sharedEmail, workEmail };
  }

  async function pointingAt(personId: string): Promise<PointingAt> {
    return one<PointingAt>(
      `SELECT (SELECT count(*)::int FROM contact_points WHERE contact_id = $1) AS points,
              (SELECT count(*)::int FROM account_memberships WHERE contact_id = $1) AS memberships,
              (SELECT count(*)::int FROM enquiries WHERE contact_id = $1) AS enquiries,
              (SELECT count(*)::int FROM opportunities WHERE primary_contact_id = $1) AS deals,
              (SELECT count(*)::int FROM client_accounts WHERE primary_contact_id = $1) AS accounts,
              (SELECT count(*)::int FROM contacts WHERE merged_into_id = $1) AS tombstones`,
      [personId],
    );
  }

  async function personRow(personId: string): Promise<{
    email: string | null; phone: string | null; client_account_id: string | null; job_title: string | null;
    notes: string | null; last_contact_at: Date | null; merged_into_id: string | null; deleted_at: Date | null;
  }> {
    return one(
      `SELECT email, phone, client_account_id, job_title, notes, last_contact_at, merged_into_id, deleted_at
       FROM contacts WHERE id = $1`,
      [personId],
    );
  }

  /** A person's points by kind, then value, in code-point order (the
   *  database's collation may order "." and "@" either way). */
  async function pointsOf(personId: string): Promise<{ kind: string; value: string; is_primary: boolean }[]> {
    const { rows } = await f.pool.query<{ kind: string; value: string; is_primary: boolean }>(
      "SELECT kind, value, is_primary FROM contact_points WHERE contact_id = $1", [personId],
    );
    const key = (row: { kind: string; value: string }): string => `${row.kind} ${row.value}`;
    return rows.sort((a, b) => (key(a) < key(b) ? -1 : key(a) > key(b) ? 1 : 0));
  }

  async function membershipsOf(personId: string): Promise<{ client_account_id: string; is_primary: boolean }[]> {
    const { rows } = await f.pool.query<{ client_account_id: string; is_primary: boolean }>(
      "SELECT client_account_id, is_primary FROM account_memberships WHERE contact_id = $1 ORDER BY is_primary DESC, client_account_id",
      [personId],
    );
    return rows;
  }

  const RECORD_COLUMNS = "id, kind, survivor_id, merged_id, merged_by, merged_at, undone_at, undone_by, snapshot, moves, undo_report";

  async function recordsOf(mergedId: string): Promise<MergeRecordRow[]> {
    const { rows } = await f.pool.query<MergeRecordRow>(
      `SELECT ${RECORD_COLUMNS} FROM record_merges WHERE merged_id = $1 ORDER BY merged_at`, [mergedId],
    );
    return rows;
  }

  function recordOf(mergeId: string): Promise<MergeRecordRow> {
    return one<MergeRecordRow>(`SELECT ${RECORD_COLUMNS} FROM record_merges WHERE id = $1`, [mergeId]);
  }

  /** A merge made through the route, by staff. */
  async function mergeOf(closing: string, survivorId: string): Promise<MergeResult> {
    const res = await merge(closing, survivorId);
    expect(res.statusCode, res.body).toBe(201);
    return merged(res);
  }

  /** The snapshot a merge kept. */
  async function snapshotOf(mergeId: string): Promise<RecordMergeSnapshot> {
    return RecordMergeSnapshotSchema.parse((await recordOf(mergeId)).snapshot);
  }

  const undo = (mergeId: string, who: PeopleFixtureUser = "staff") => send("POST", `/people/merges/${mergeId}/undo`, who);

  function undone(res: LightMyRequestResponse): MergeUndoResult {
    expect(res.statusCode, res.body).toBe(200);
    return MergeUndoResultSchema.parse(res.json().data);
  }

  /** The fields of every line the routes logged with an event. */
  function eventLines(): unknown[] {
    return logged.flatMap(([fields]) => (typeof fields === "object" && fields !== null && "event" in fields ? [fields] : []));
  }

  /**
   * The book at the venue as an undo should leave it: every row but the merge
   * records, without updated_at (every write moves it on), and each time to
   * the millisecond, the precision a merge record keeps.
   */
  async function bookState(): Promise<Record<string, unknown[]>> {
    const tables = [
      "contacts", "contact_points", "account_memberships", "contact_kept_apart",
      "enquiries", "opportunities", "client_accounts",
    ] as const;
    const state: Record<string, unknown[]> = {};
    for (const table of tables) {
      const { rows } = await f.pool.query<{ row: Record<string, unknown> }>(
        `SELECT to_jsonb(t) - 'updated_at' AS row FROM ${table} t WHERE venue_id = $1 ORDER BY id`, [f.venueId],
      );
      state[table] = rows.map(({ row }) => Object.fromEntries(Object.entries(row).map(([key, value]) => [
        key,
        key.endsWith("_at") && typeof value === "string" ? new Date(value).toISOString() : value,
      ])));
    }
    return state;
  }

  function withoutUpdatedAt(row: object): Record<string, unknown> {
    return Object.fromEntries(Object.entries(row).filter(([key]) => key !== "updatedAt"));
  }

  function byId(a: { id: string }, b: { id: string }): number {
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
  }

  /** What a merge record keeps of a person, their points and memberships, but
   *  for updated_at. */
  function recorded(snapshot: RecordMergeSnapshot): Record<string, unknown> {
    return {
      person: withoutUpdatedAt(snapshot.person),
      contactPoints: [...snapshot.contactPoints].sort(byId).map(withoutUpdatedAt),
      memberships: [...snapshot.memberships].sort(byId).map(withoutUpdatedAt),
    };
  }

  /** The person, their points and memberships as stored now, in the shape a
   *  merge record keeps them, but for updated_at. */
  async function asRecorded(personId: string): Promise<Record<string, unknown>> {
    const [row] = await f.db.select().from(contacts).where(eq(contacts.id, personId));
    if (row === undefined) throw new Error("No such person");
    const points = await f.db.select().from(contactPoints).where(eq(contactPoints.contactId, personId));
    const memberships = await f.db.select().from(accountMemberships).where(eq(accountMemberships.contactId, personId));
    return {
      person: withoutUpdatedAt({
        ...toPerson(row),
        mergedIntoId: row.mergedIntoId,
        erasedAt: row.erasedAt?.toISOString() ?? null,
        deletedAt: row.deletedAt?.toISOString() ?? null,
      }),
      contactPoints: points.sort(byId).map((point) => withoutUpdatedAt({ ...point, createdAt: point.createdAt.toISOString() })),
      memberships: memberships.sort(byId).map((membership) => withoutUpdatedAt({ ...membership, createdAt: membership.createdAt.toISOString() })),
    };
  }

  /** Every row the People Book and its neighbours hold at the fixture's venue. */
  async function venueRows(): Promise<Record<string, unknown[]>> {
    const tables = [
      "contacts", "contact_points", "account_memberships", "contact_kept_apart",
      "enquiries", "opportunities", "client_accounts", "record_merges",
    ] as const;
    const rows: Record<string, unknown[]> = {};
    for (const table of tables) {
      const result = await f.pool.query<{ row: unknown }>(
        `SELECT to_jsonb(t) AS row FROM ${table} t WHERE venue_id = $1 ORDER BY id`, [f.venueId],
      );
      rows[table] = result.rows.map((r) => r.row);
    }
    return rows;
  }

  function mergedProfile(res: LightMyRequestResponse): MergedProfile {
    expect(res.statusCode, res.body).toBe(200);
    const profile = PersonProfileSchema.parse(res.json().data);
    if (profile.status !== "merged") throw new Error("Expected a merged person");
    return profile;
  }

  /**
   * Presses that really overlap: a third connection holds the venue's merge
   * lock while the presses start, and lets go only once every press is waiting
   * on it, so none can begin its merge before the others have reached the
   * lock. Answers with what each waiting session was running at that moment.
   */
  async function pressTogether(
    presses: () => readonly Promise<LightMyRequestResponse>[],
  ): Promise<{ responses: LightMyRequestResponse[]; waiting: string[] }> {
    const holder = await f.pool.connect();
    let inFlight: readonly Promise<LightMyRequestResponse>[] = [];
    let waiting: string[] = [];
    try {
      await holder.query("BEGIN");
      await holder.query("SELECT pg_advisory_xact_lock(hashtextextended($1, 0))", [`people-merge:${f.venueId}`]);
      inFlight = presses();
      for (let attempt = 0; ; attempt += 1) {
        // pg_stat_activity is read once per transaction unless the snapshot
        // is cleared, and the holder polls from inside its own transaction.
        await holder.query("SELECT pg_stat_clear_snapshot()");
        const { rows } = await holder.query<{ query: string }>(
          `SELECT query FROM pg_stat_activity
            WHERE application_name = current_setting('application_name')
              AND wait_event_type = 'Lock' AND wait_event = 'advisory' AND pid <> pg_backend_pid()`,
        );
        if (rows.length >= inFlight.length) {
          waiting = rows.map((row) => row.query);
          break;
        }
        if (attempt >= 200) throw new Error("The presses never met the held lock");
        await new Promise((resolve) => setTimeout(resolve, 25));
      }
      await holder.query("COMMIT");
    } catch (error) {
      await holder.query("ROLLBACK");
      throw error;
    } finally {
      holder.release();
    }
    return { responses: await Promise.all(inFlight), waiting };
  }

  it("says what moves before anything moves", async () => {
    const p = await pair();
    const before = await venueRows();

    const shown = previewed(await preview(p.l, p.s));
    expect(shown).toEqual({
      survivor: { id: p.s, name: "Aileen Murray" },
      merged: { id: p.l, name: "A. Murray" },
      moves: {
        "contact_points.contact_id": 2,
        "account_memberships.contact_id": 1,
        "enquiries.contact_id": 2,
        "opportunities.primary_contact_id": 1,
        "client_accounts.primary_contact_id": 1,
        "contacts.merged_into_id": 1,
      },
      alreadyHeld: { contactPoints: 1, memberships: 1 },
    });
    expect(await venueRows()).toEqual(before);
  });

  it("moves everything to the survivor in one go, and keeps a record", async () => {
    const p = await pair();
    // Only the survivor's empty fields are filled; the later last contact wins.
    await f.pool.query("UPDATE contacts SET notes = 'Prefers email', last_contact_at = '2026-08-01T10:00:00Z' WHERE id = $1", [p.s]);
    await f.pool.query("UPDATE contacts SET notes = 'An older note', last_contact_at = '2026-09-01T10:00:00Z' WHERE id = $1", [p.l]);
    const shown = previewed(await preview(p.l, p.s));
    const lPoints = await f.pool.query<{ id: string; value: string }>("SELECT id, value FROM contact_points WHERE contact_id = $1", [p.l]);
    const lMemberships = await f.pool.query<{ id: string; client_account_id: string }>(
      "SELECT id, client_account_id FROM account_memberships WHERE contact_id = $1", [p.l],
    );
    const heldPoint = lPoints.rows.find((row) => row.value === p.sharedEmail)?.id;
    const heldMembership = lMemberships.rows.find((row) => row.client_account_id === p.x)?.id;

    logged.length = 0;
    const res = await merge(p.l, p.s);
    expect(res.statusCode, res.body).toBe(201);
    const result = merged(res);
    expect(result).toMatchObject({ survivorId: p.s, mergedId: p.l, moves: shown.moves, alreadyHeld: shown.alreadyHeld, replayed: false });

    for (const id of [p.e1, p.e2]) {
      expect((await one<{ contact_id: string }>("SELECT contact_id FROM enquiries WHERE id = $1", [id])).contact_id).toBe(p.s);
    }
    expect((await one<{ primary_contact_id: string }>("SELECT primary_contact_id FROM opportunities WHERE id = $1", [p.d1])).primary_contact_id).toBe(p.s);
    expect((await one<{ primary_contact_id: string }>("SELECT primary_contact_id FROM client_accounts WHERE id = $1", [p.y])).primary_contact_id).toBe(p.s);
    expect((await personRow(p.t)).merged_into_id).toBe(p.s);

    expect(await pointsOf(p.s)).toEqual([
      { kind: "email", value: p.sharedEmail, is_primary: true },
      { kind: "email", value: p.workEmail, is_primary: false },
      { kind: "phone", value: "07700900123", is_primary: true },
    ]);
    expect(await membershipsOf(p.s)).toEqual([
      { client_account_id: p.x, is_primary: true },
      { client_account_id: p.y, is_primary: false },
    ]);
    const survivor = await personRow(p.s);
    expect(survivor).toMatchObject({
      email: p.sharedEmail, phone: "07700 900123", client_account_id: p.x, job_title: "Secretary", notes: "Prefers email",
      merged_into_id: null, deleted_at: null,
    });
    expect(survivor.last_contact_at?.toISOString()).toBe("2026-09-01T10:00:00.000Z");

    // The closed record is a tombstone; nothing points at it any more, and its
    // mirrors follow the points and memberships it no longer has.
    const tombstone = await personRow(p.l);
    expect(tombstone.merged_into_id).toBe(p.s);
    expect(tombstone.deleted_at).toBeInstanceOf(Date);
    expect(tombstone).toMatchObject({ email: null, phone: null, client_account_id: null });
    expect(await pointingAt(p.l)).toEqual(NOTHING);

    const records = await recordsOf(p.l);
    expect(records).toHaveLength(1);
    const kept = records[0];
    if (kept === undefined) throw new Error("No record of the merge");
    expect(kept).toMatchObject({ id: result.mergeId, kind: "person", survivor_id: p.s, merged_id: p.l, merged_by: f.users.staff, undone_at: null });
    expect(result.undoUntil).toBe(new Date(kept.merged_at.getTime() + MERGE_UNDO_DAYS * 86_400_000).toISOString());

    // Everything the undo needs: the person as they were, every point and
    // membership they held, what was removed and what was filled.
    const snapshot = RecordMergeSnapshotSchema.parse(kept.snapshot);
    expect(snapshot.person).toMatchObject({ id: p.l, name: "A. Murray", jobTitle: "Secretary", mergedIntoId: null, deletedAt: null, email: p.sharedEmail });
    expect(snapshot.contactPoints.map((point) => point.id).sort()).toEqual(lPoints.rows.map((row) => row.id).sort());
    expect(snapshot.contactPoints.find((point) => point.value === "07700900123")).toMatchObject({ kind: "phone", isPrimary: true, contactId: p.l });
    expect(snapshot.memberships.map((membership) => membership.id).sort()).toEqual(lMemberships.rows.map((row) => row.id).sort());
    expect(snapshot.removed).toEqual({ contactPointIds: [heldPoint], membershipIds: [heldMembership] });
    expect(snapshot.survivorFilled).toEqual([
      { field: "jobTitle", before: null, after: "Secretary" },
      { field: "lastContactAt", before: "2026-08-01T10:00:00.000Z", after: "2026-09-01T10:00:00.000Z" },
    ]);
    const moves = RecordMergeMoveSchema.array().parse(kept.moves);
    expect(moves.map((move) => move.target)).toEqual([...MERGE_MOVE_TARGETS]);
    const idsOf = (target: string): string[] => [...(moves.find((move) => move.target === target)?.ids ?? [])].sort();
    expect(idsOf("contact_points.contact_id")).toEqual(lPoints.rows.filter((row) => row.id !== heldPoint).map((row) => row.id).sort());
    expect(idsOf("account_memberships.contact_id")).toEqual(lMemberships.rows.filter((row) => row.id !== heldMembership).map((row) => row.id).sort());
    expect(idsOf("enquiries.contact_id")).toEqual([p.e1, p.e2].sort());
    expect(idsOf("opportunities.primary_contact_id")).toEqual([p.d1]);
    expect(idsOf("client_accounts.primary_contact_id")).toEqual([p.y]);
    expect(idsOf("contacts.merged_into_id")).toEqual([p.t]);

    // Ids and the outcome only, never a name, an email or a phone.
    const lines = logged.filter(([fields]) => typeof fields === "object" && fields !== null && "event" in fields);
    expect(lines.map(([fields]) => fields)).toEqual([
      { event: "people.merged", mergeId: result.mergeId, survivorId: p.s, mergedId: p.l },
    ]);
  });

  it("answers an old link to the merged person with where they went", async () => {
    const p = await pair();
    const witness = await f.addPerson({ name: "Witness Person" });
    const res = await merge(p.l, p.s);
    expect(res.statusCode, res.body).toBe(201);
    const result = merged(res);
    const [kept] = await recordsOf(p.l);
    const [earlier] = await recordsOf(p.t);
    if (kept === undefined || earlier === undefined) throw new Error("Expected both records");

    expect(mergedProfile(await get(`/people/${p.l}`))).toEqual({
      status: "merged", mergedInto: { id: p.s, name: "Aileen Murray" }, mergeId: result.mergeId, mergedAt: kept.merged_at.toISOString(),
    });
    expect(mergedProfile(await get(`/people/${p.t}`))).toEqual({
      status: "merged", mergedInto: { id: p.s, name: "Aileen Murray" }, mergeId: earlier.id, mergedAt: earlier.merged_at.toISOString(),
    });

    const point = (await one<{ id: string }>("SELECT id FROM contact_points WHERE contact_id = $1 LIMIT 1", [p.s])).id;
    const writes: readonly [Method, string, object | undefined][] = [
      ["PATCH", `/people/${p.l}`, { jobTitle: "Chair" }],
      ["POST", `/people/${p.l}/contact-points`, { kind: "email", value: "intruder@example.test" }],
      ["DELETE", `/people/${p.l}/contact-points/${point}`, undefined],
      ["PUT", `/people/${p.l}/memberships`, { memberships: [] }],
      ["POST", `/people/${p.l}/kept-apart`, { otherPersonId: witness }],
      ["DELETE", `/people/${p.l}/kept-apart/${witness}`, undefined],
      ["POST", `/people/${witness}/kept-apart`, { otherPersonId: p.l }],
    ];
    for (const [method, url, payload] of writes) {
      const refused = await send(method, url, "staff", payload);
      expect(refused.statusCode, `${method} ${url}: ${refused.body}`).toBe(409);
      expect(refused.json()).toMatchObject({ code: "MERGED", mergedIntoId: p.s });
    }
    expect(await pointingAt(p.l)).toEqual(NOTHING);
    expect((await personRow(p.l)).job_title).toBe("Secretary");
  });

  // Review Focus 4.
  it("answers a second press with the same merge", async () => {
    const p = await pair();
    const { responses, waiting } = await pressTogether(() => [merge(p.l, p.s, "staff"), merge(p.l, p.s, "sales")]);
    // Both presses had begun and were waiting on the venue's merge lock at the
    // same moment: they really overlapped.
    expect(waiting).toHaveLength(2);
    for (const query of waiting) expect(query).toContain("pg_advisory_xact_lock");

    const [first, second] = responses;
    if (first === undefined || second === undefined) throw new Error("Expected two answers");
    expect(statuses(first, second)).toEqual([200, 201]);
    const made = merged(first.statusCode === 201 ? first : second);
    const replayed = merged(first.statusCode === 200 ? first : second);
    expect(replayed).toEqual({ ...made, replayed: true });
    expect(await recordsOf(p.l)).toHaveLength(1);

    // A later press answers the same, and moves nothing more.
    const later = await merge(p.l, p.s);
    expect(later.statusCode, later.body).toBe(200);
    expect(merged(later)).toEqual({ ...made, replayed: true });
    expect(await recordsOf(p.l)).toHaveLength(1);
    expect(await pointingAt(p.l)).toEqual(NOTHING);
    // The preview, which never replays, says it is done.
    const shown = await preview(p.l, p.s);
    expect(shown.statusCode, shown.body).toBe(409);
    expect(shown.json()).toMatchObject({ code: "ALREADY_MERGED", survivorId: p.s });
  }, 30_000);

  // Review Focus 4.
  it("does one of two opposite merges pressed at once", async () => {
    const p = await pair();
    const { responses, waiting } = await pressTogether(() => [merge(p.l, p.s, "staff"), merge(p.s, p.l, "sales")]);
    expect(waiting).toHaveLength(2);
    for (const query of waiting) expect(query).toContain("pg_advisory_xact_lock");

    const [first, second] = responses;
    if (first === undefined || second === undefined) throw new Error("Expected two answers");
    expect(statuses(first, second)).toEqual([201, 409]);
    const made = merged(first.statusCode === 201 ? first : second);
    const refused = first.statusCode === 409 ? first : second;
    const survivor = made.survivorId;
    const tombstone = made.mergedId;
    expect(refused.json()).toMatchObject({ code: "SURVIVOR_MERGED", mergedIntoId: survivor });

    const { rows } = await f.pool.query<{ count: number }>(
      "SELECT count(*)::int AS count FROM record_merges WHERE merged_id = ANY($1::uuid[]) AND survivor_id = ANY($1::uuid[])", [[p.l, p.s]],
    );
    expect(rows[0]?.count).toBe(1);
    const states = await Promise.all([p.l, p.s].map(async (id) => (await personRow(id)).merged_into_id));
    expect(states.filter((into) => into !== null)).toEqual([survivor]);

    // Nothing is left half-moved: everything is on the survivor, whichever won.
    expect(await pointingAt(tombstone)).toEqual(NOTHING);
    expect(await pointingAt(survivor)).toEqual({ points: 3, memberships: 2, enquiries: 2, deals: 1, accounts: 1, tombstones: 2 });
    expect((await personRow(p.t)).merged_into_id).toBe(survivor);
    expect(await pointsOf(survivor)).toEqual([
      { kind: "email", value: p.sharedEmail, is_primary: true },
      { kind: "email", value: p.workEmail, is_primary: false },
      { kind: "phone", value: "07700900123", is_primary: true },
    ]);
    expect(await membershipsOf(survivor)).toEqual([
      { client_account_id: p.x, is_primary: true },
      { client_account_id: p.y, is_primary: false },
    ]);
  }, 30_000);

  it("refuses a merge into itself, another venue's person or a closed record", async () => {
    const p = await pair();
    const elsewhere = await f.addPerson({ name: "Aileen Murray", venueId: f.otherVenueId, emails: [p.sharedEmail] });
    const before = await venueRows();

    const refusals: readonly [string, string, PeopleFixtureUser, number, Record<string, unknown>][] = [
      [p.l, p.l, "staff", 422, { code: "SAME_RECORD" }],
      [p.l, p.l.toUpperCase(), "staff", 422, { code: "SAME_RECORD" }],
      [p.l, elsewhere, "staff", 404, { code: "NOT_FOUND" }],
      [p.l, elsewhere, "platformAdmin", 404, { code: "NOT_FOUND" }],
      [elsewhere, p.s, "staff", 404, { code: "NOT_FOUND" }],
      [p.l, randomUUID(), "staff", 404, { code: "NOT_FOUND" }],
      [p.s, p.t, "staff", 409, { code: "SURVIVOR_MERGED", mergedIntoId: p.l }],
      [p.t, p.s, "staff", 409, { code: "ALREADY_MERGED", survivorId: p.l }],
    ];
    for (const [closing, survivorId, who, status, body] of refusals) {
      for (const res of [await preview(closing, survivorId, who), await merge(closing, survivorId, who)]) {
        expect(res.statusCode, `${closing} into ${survivorId} by ${who}: ${res.body}`).toBe(status);
        expect(res.json()).toMatchObject(body);
      }
    }
    expect(await venueRows()).toEqual(before);
  });

  it("links a later enquiry from a moved email to the survivor", async () => {
    const p = await pair();
    const enquire = async (email: string): Promise<string | null> => {
      const res = await f.server.inject({
        method: "POST", url: "/public/enquiries",
        payload: { venueSlug: f.venueId, source: "website", eventType: "wedding", eventDate: "2027-06-12", guestCount: 90, email, name: "Aileen Murray" },
      });
      expect(res.statusCode, res.body).toBe(201);
      const enquiryId = res.json<{ data: { enquiryId: string } }>().data.enquiryId;
      return (await one<{ contact_id: string | null }>("SELECT contact_id FROM enquiries WHERE id = $1", [enquiryId])).contact_id;
    };
    // Two records hold the shared email until they are one.
    expect(await enquire(p.sharedEmail)).toBeNull();

    const res = await merge(p.l, p.s);
    expect(res.statusCode, res.body).toBe(201);
    expect(await enquire(p.workEmail)).toBe(p.s);
    expect(await enquire(p.sharedEmail.toUpperCase())).toBe(p.s);
  });

  it("keeps what an older writer left on the merged person", async () => {
    const household = await f.addOrganisation({ name: "Legacy household" });
    const survivor = await f.addPerson({ name: "Morven Legacy", emails: [`morven@home-${run}.example.test`] });
    const legacyEmail = `Morven.Legacy@Legacy-${run}.example.test`;
    const legacy = (await one<{ id: string }>(
      `INSERT INTO contacts (venue_id, client_account_id, name, email, phone, role_label)
       VALUES ($1, $2, 'M. Legacy', $3, '+44 7700 900124', 'Primary event contact') RETURNING id`,
      [f.venueId, household, legacyEmail],
    )).id;

    const shown = previewed(await preview(legacy, survivor));
    expect(shown.moves).toMatchObject({ "contact_points.contact_id": 2, "account_memberships.contact_id": 1 });
    const res = await merge(legacy, survivor);
    expect(res.statusCode, res.body).toBe(201);
    expect(merged(res).moves).toEqual(shown.moves);

    expect(await pointsOf(survivor)).toEqual([
      { kind: "email", value: legacyEmail.toLowerCase(), is_primary: false },
      { kind: "email", value: `morven@home-${run}.example.test`, is_primary: true },
      { kind: "phone", value: "07700900124", is_primary: true },
    ]);
    expect(await membershipsOf(survivor)).toEqual([{ client_account_id: household, is_primary: true }]);
    expect(await personRow(survivor)).toMatchObject({ phone: "+44 7700 900124", client_account_id: household });
  });

  it("moves a household's primary contact while a deal for that household is being written", async () => {
    const p = await pair();
    const other = await f.addPerson({ name: "Fergus Lindsay" });
    // A deal written elsewhere holds the household with FOR KEY SHARE (its
    // foreign key) until it commits. Moving the household's primary contact
    // takes FOR NO KEY UPDATE, which does not wait on it.
    const writer = await f.pool.connect();
    try {
      await writer.query("BEGIN");
      await writer.query(
        "INSERT INTO opportunities (venue_id, title, stage, client_account_id, primary_contact_id) VALUES ($1, 'Ceilidh', 'new', $2, $3)",
        [f.venueId, p.y, other],
      );
      const res = await merge(p.l, p.s);
      expect(res.statusCode, res.body).toBe(201);
      await writer.query("COMMIT");
    } catch (error) {
      await writer.query("ROLLBACK");
      throw error;
    } finally {
      writer.release();
    }
    expect((await one<{ primary_contact_id: string }>("SELECT primary_contact_id FROM client_accounts WHERE id = $1", [p.y])).primary_contact_id).toBe(p.s);
    expect(await pointingAt(p.l)).toEqual(NOTHING);
  }, 30_000);

  it("waits for a deal being made from an enquiry for the household, then moves its primary contact", async () => {
    const p = await pair();
    const other = await f.addPerson({ name: "Fergus Lindsay" });
    // Create opportunity's order (people-link.ts): its own person FOR UPDATE,
    // then the household FOR SHARE, then the deal. The merge waits on that
    // hold; the deal maker needs nothing the merge holds, so it finishes.
    const maker = await f.pool.connect();
    let merging: Promise<LightMyRequestResponse> | undefined;
    try {
      await maker.query("BEGIN");
      await maker.query("SELECT id FROM contacts WHERE id = $1 FOR UPDATE", [other]);
      await maker.query("SELECT id FROM client_accounts WHERE id = $1 FOR SHARE", [p.y]);
      merging = merge(p.l, p.s);
      for (let attempt = 0; ; attempt += 1) {
        await maker.query("SELECT pg_stat_clear_snapshot()");
        const { rows } = await maker.query<{ waiting: number }>(
          `SELECT count(*)::int AS waiting FROM pg_stat_activity
            WHERE application_name = current_setting('application_name') AND wait_event_type = 'Lock'
              AND query ILIKE 'update "client_accounts"%' AND pid <> pg_backend_pid()`,
        );
        if ((rows[0]?.waiting ?? 0) === 1) break;
        if (attempt >= 200) throw new Error("The merge never waited on the household");
        await new Promise((resolve) => setTimeout(resolve, 25));
      }
      await maker.query(
        "INSERT INTO opportunities (venue_id, title, stage, client_account_id, primary_contact_id) VALUES ($1, 'Ceilidh', 'new', $2, $3)",
        [f.venueId, p.y, other],
      );
      await maker.query("COMMIT");
    } catch (error) {
      await maker.query("ROLLBACK");
      throw error;
    } finally {
      maker.release();
    }
    if (merging === undefined) throw new Error("The merge never started");
    const res = await merging;
    expect(res.statusCode, res.body).toBe(201);
    expect((await one<{ primary_contact_id: string }>("SELECT primary_contact_id FROM client_accounts WHERE id = $1", [p.y])).primary_contact_id).toBe(p.s);
    expect(await pointingAt(p.l)).toEqual(NOTHING);
  }, 30_000);

  it("lets sales merge", async () => {
    const p = await pair();
    expect(previewed(await preview(p.l, p.s, "sales")).merged.id).toBe(p.l);
    const res = await merge(p.l, p.s, "sales");
    expect(res.statusCode, res.body).toBe(201);
    const [kept] = await recordsOf(p.l);
    expect(kept?.merged_by).toBe(f.users.sales);
  });

  // -------------------------------------------------------------------------
  // Undoing a merge (Task 12).
  // -------------------------------------------------------------------------

  it("puts everything back within 30 days", async () => {
    const p = await pair();
    const before = await bookState();
    const made = await mergeOf(p.l, p.s);
    const snapshot = await snapshotOf(made.mergeId);

    logged.length = 0;
    const result = undone(await undo(made.mergeId));
    expect(result).toEqual({
      mergeId: made.mergeId,
      restored: {
        "contact_points.contact_id": 3,
        "account_memberships.contact_id": 2,
        "enquiries.contact_id": 2,
        "opportunities.primary_contact_id": 1,
        "client_accounts.primary_contact_id": 1,
        "contacts.merged_into_id": 1,
      },
      skipped: [],
      replayed: false,
    });
    // Ids and the outcome only, never a name, an email or a phone.
    expect(eventLines()).toEqual([{ event: "people.merge_undone", mergeId: made.mergeId, skipped: 0 }]);

    // L is live again, and everything that pointed at L points at L again.
    expect(await personRow(p.l)).toMatchObject({
      merged_into_id: null, deleted_at: null, email: p.sharedEmail, phone: "07700 900123", client_account_id: p.x, job_title: "Secretary",
    });
    expect(await pointingAt(p.l)).toEqual(L_HOLDS);
    for (const id of [p.e1, p.e2]) {
      expect((await one<{ contact_id: string }>("SELECT contact_id FROM enquiries WHERE id = $1", [id])).contact_id).toBe(p.l);
    }
    expect((await one<{ primary_contact_id: string }>("SELECT primary_contact_id FROM opportunities WHERE id = $1", [p.d1])).primary_contact_id).toBe(p.l);
    expect((await one<{ primary_contact_id: string }>("SELECT primary_contact_id FROM client_accounts WHERE id = $1", [p.y])).primary_contact_id).toBe(p.l);
    expect((await personRow(p.t)).merged_into_id).toBe(p.l);

    // L's three points (the shared address made again with its own id) and
    // two memberships, each primary as it was: exactly as the record kept them.
    expect(await pointsOf(p.l)).toEqual([
      { kind: "email", value: p.sharedEmail, is_primary: true },
      { kind: "email", value: p.workEmail, is_primary: false },
      { kind: "phone", value: "07700900123", is_primary: true },
    ]);
    expect(await membershipsOf(p.l)).toEqual([
      { client_account_id: p.x, is_primary: true },
      { client_account_id: p.y, is_primary: false },
    ]);
    const [sharedPoint] = snapshot.removed.contactPointIds;
    expect((await one<{ contact_id: string }>("SELECT contact_id FROM contact_points WHERE id = $1", [sharedPoint])).contact_id).toBe(p.l);
    expect(await asRecorded(p.l)).toEqual(recorded(snapshot));

    // S is back to its one point and one membership, with no job title or phone.
    expect(await pointsOf(p.s)).toEqual([{ kind: "email", value: p.sharedEmail, is_primary: true }]);
    expect(await membershipsOf(p.s)).toEqual([{ client_account_id: p.x, is_primary: true }]);
    expect(await personRow(p.s)).toMatchObject({ email: p.sharedEmail, phone: null, client_account_id: p.x, job_title: null });

    // The record is kept, marked undone, with its report.
    const record = await recordOf(made.mergeId);
    expect(record.undone_at).toBeInstanceOf(Date);
    expect(record.undone_by).toBe(f.users.staff);
    expect(MergeUndoReportSchema.parse(record.undo_report)).toEqual({ restored: result.restored, skipped: [] });

    // The whole book at the venue is as it was before the merge.
    expect(await bookState()).toEqual(before);
    // An old link to L shows L again, and the two can be previewed again.
    const profile = await get(`/people/${p.l}`);
    expect(profile.statusCode, profile.body).toBe(200);
    expect(PersonProfileSchema.parse(profile.json().data)).toMatchObject({ status: "live", person: { id: p.l } });
    expect(previewed(await preview(p.l, p.s)).alreadyHeld).toEqual({ contactPoints: 1, memberships: 1 });
  });

  // Review Focus 5.
  it("leaves what a colleague changed since, and says so", async () => {
    const p = await pair();
    const q = await f.addPerson({ name: "Callum Reid" });
    const made = await mergeOf(p.l, p.s);
    const snapshot = await snapshotOf(made.mergeId);
    // After the merge a colleague moves the deal on to someone else and gives
    // S a job title of their own.
    await f.pool.query("UPDATE opportunities SET primary_contact_id = $2 WHERE id = $1", [p.d1, q]);
    const edited = await send("PATCH", `/people/${p.s}`, "staff", { jobTitle: "Chair" });
    expect(edited.statusCode, edited.body).toBe(200);

    const result = undone(await undo(made.mergeId));
    expect(result.skipped).toEqual([
      { target: "opportunities.primary_contact_id", ref: p.d1 },
      { target: "survivor_field", ref: "jobTitle" },
    ]);
    expect(result.restored).toEqual({
      "contact_points.contact_id": 3,
      "account_memberships.contact_id": 2,
      "enquiries.contact_id": 2,
      "opportunities.primary_contact_id": 0,
      "client_accounts.primary_contact_id": 1,
      "contacts.merged_into_id": 1,
    });

    // What the colleague changed stays as they left it.
    expect((await one<{ primary_contact_id: string }>("SELECT primary_contact_id FROM opportunities WHERE id = $1", [p.d1])).primary_contact_id).toBe(q);
    expect((await personRow(p.s)).job_title).toBe("Chair");

    // Everything else is back.
    expect(await pointingAt(p.l)).toEqual({ ...L_HOLDS, deals: 0 });
    expect(await asRecorded(p.l)).toEqual(recorded(snapshot));
    expect((await personRow(p.t)).merged_into_id).toBe(p.l);
    expect(await pointsOf(p.s)).toEqual([{ kind: "email", value: p.sharedEmail, is_primary: true }]);
    expect(await membershipsOf(p.s)).toEqual([{ client_account_id: p.x, is_primary: true }]);
    expect(await personRow(p.s)).toMatchObject({ email: p.sharedEmail, phone: null, client_account_id: p.x });
  });

  it("puts the survivor's filled fields back, unless they have moved on since", async () => {
    // S's own last contact, and a later one and a note on L, each to the
    // microsecond as the database keeps them.
    const filledPair = async (): Promise<{ p: Pair; made: MergeResult }> => {
      const p = await pair();
      await f.pool.query("UPDATE contacts SET last_contact_at = '2026-08-01T10:00:00.654321Z' WHERE id = $1", [p.s]);
      await f.pool.query("UPDATE contacts SET last_contact_at = '2026-09-01T10:00:00.123456Z', notes = 'Prefers email' WHERE id = $1", [p.l]);
      const made = await mergeOf(p.l, p.s);
      expect((await snapshotOf(made.mergeId)).survivorFilled).toEqual([
        { field: "jobTitle", before: null, after: "Secretary" },
        { field: "notes", before: null, after: "Prefers email" },
        { field: "lastContactAt", before: "2026-08-01T10:00:00.654Z", after: "2026-09-01T10:00:00.123Z" },
      ]);
      return { p, made };
    };

    // Untouched since: each goes back, the last contact to the millisecond the
    // record keeps.
    const kept = await filledPair();
    expect(undone(await undo(kept.made.mergeId)).skipped).toEqual([]);
    const restored = await personRow(kept.p.s);
    expect(restored).toMatchObject({ job_title: null, notes: null });
    expect(restored.last_contact_at?.toISOString()).toBe("2026-08-01T10:00:00.654Z");

    // A later enquiry moved S's last contact on since: it stays, named.
    const moved = await filledPair();
    await f.pool.query("UPDATE contacts SET last_contact_at = '2026-10-01T09:00:00Z' WHERE id = $1", [moved.p.s]);
    expect(undone(await undo(moved.made.mergeId)).skipped).toEqual([{ target: "survivor_field", ref: "lastContactAt" }]);
    const left = await personRow(moved.p.s);
    expect(left).toMatchObject({ job_title: null, notes: null });
    expect(left.last_contact_at?.toISOString()).toBe("2026-10-01T09:00:00.000Z");
  });

  it("puts back primaries that were not the oldest", async () => {
    const p = await pair();
    // L's primary email becomes the work address, and its primary membership
    // the household, each made after the rows the merge will remove, so the
    // oldest-first promotion of a mirror refresh would choose the others.
    const work = (await one<{ id: string }>("SELECT id FROM contact_points WHERE contact_id = $1 AND value = $2", [p.l, p.workEmail])).id;
    for (const [method, url, payload] of [
      ["DELETE", `/people/${p.l}/contact-points/${work}`, undefined],
      ["POST", `/people/${p.l}/contact-points`, { kind: "email", value: p.workEmail, isPrimary: true }],
      ["PUT", `/people/${p.l}/memberships`, { memberships: [{ organisationId: p.x }] }],
      ["PUT", `/people/${p.l}/memberships`, { memberships: [{ organisationId: p.x }, { organisationId: p.y, isPrimary: true }] }],
    ] as const) {
      const res = await send(method, url, "staff", payload);
      expect(res.statusCode, `${method} ${url}: ${res.body}`).toBeLessThan(300);
    }
    expect(await pointsOf(p.l)).toEqual([
      { kind: "email", value: p.sharedEmail, is_primary: false },
      { kind: "email", value: p.workEmail, is_primary: true },
      { kind: "phone", value: "07700900123", is_primary: true },
    ]);
    const before = await bookState();
    const made = await mergeOf(p.l, p.s);
    const snapshot = await snapshotOf(made.mergeId);

    expect(undone(await undo(made.mergeId)).skipped).toEqual([]);
    expect(await pointsOf(p.l)).toEqual([
      { kind: "email", value: p.sharedEmail, is_primary: false },
      { kind: "email", value: p.workEmail, is_primary: true },
      { kind: "phone", value: "07700900123", is_primary: true },
    ]);
    expect(await membershipsOf(p.l)).toEqual([
      { client_account_id: p.y, is_primary: true },
      { client_account_id: p.x, is_primary: false },
    ]);
    expect(await personRow(p.l)).toMatchObject({ email: p.workEmail, client_account_id: p.y });
    expect(await asRecorded(p.l)).toEqual(recorded(snapshot));
    expect(await bookState()).toEqual(before);
  });

  it("puts each primary back as it was, around a point a colleague removed since", async () => {
    const p = await pair();
    const made = await mergeOf(p.l, p.s);
    const phone = (await one<{ id: string }>("SELECT id FROM contact_points WHERE contact_id = $1 AND kind = 'phone'", [p.s])).id;
    // After the merge a colleague makes L's work address S's primary email,
    // and removes the phone.
    const promoted = await send("POST", `/people/${p.s}/contact-points`, "staff", { kind: "email", value: p.workEmail, isPrimary: true });
    expect(promoted.statusCode, promoted.body).toBe(200);
    expect(await pointsOf(p.s)).toContainEqual({ kind: "email", value: p.workEmail, is_primary: true });
    const removed = await send("DELETE", `/people/${p.s}/contact-points/${phone}`, "staff");
    expect(removed.statusCode, removed.body).toBe(204);

    const result = undone(await undo(made.mergeId));
    expect(result.skipped).toEqual([{ target: "contact_points.contact_id", ref: phone }]);
    expect(result.restored["contact_points.contact_id"]).toBe(2);
    // L: the shared address primary as it was, the work address not, no phone.
    expect(await pointsOf(p.l)).toEqual([
      { kind: "email", value: p.sharedEmail, is_primary: true },
      { kind: "email", value: p.workEmail, is_primary: false },
    ]);
    expect(await personRow(p.l)).toMatchObject({ email: p.sharedEmail, phone: null, client_account_id: p.x });
    // S: its own address is its primary again, as before the merge.
    expect(await pointsOf(p.s)).toEqual([{ kind: "email", value: p.sharedEmail, is_primary: true }]);
    expect(await personRow(p.s)).toMatchObject({ email: p.sharedEmail, phone: null });
  });

  it("answers a second press with the same report", async () => {
    const p = await pair();
    const made = await mergeOf(p.l, p.s);
    const { responses, waiting } = await pressTogether(() => [undo(made.mergeId, "staff"), undo(made.mergeId, "sales")]);
    // Both presses were waiting on the venue's merge lock at the same moment.
    expect(waiting).toHaveLength(2);
    for (const query of waiting) expect(query).toContain("pg_advisory_xact_lock");

    const [first, second] = responses;
    if (first === undefined || second === undefined) throw new Error("Expected two answers");
    expect(statuses(first, second)).toEqual([200, 200]);
    const answers = [undone(first), undone(second)];
    const report = answers.find((answer) => !answer.replayed);
    if (report === undefined) throw new Error("Neither press undid the merge");
    expect(answers.filter((answer) => answer.replayed)).toEqual([{ ...report, replayed: true }]);
    expect(report.skipped).toEqual([]);
    const record = await recordOf(made.mergeId);
    expect([f.users.staff, f.users.sales]).toContain(record.undone_by);
    expect(await pointingAt(p.l)).toEqual(L_HOLDS);

    // A later press answers the same, and changes nothing at all.
    const settled = await venueRows();
    expect(undone(await undo(made.mergeId))).toEqual({ ...report, replayed: true });
    expect(await venueRows()).toEqual(settled);
  }, 30_000);

  it("closes after 30 days", async () => {
    const p = await pair();
    const made = await mergeOf(p.l, p.s);
    const mergedAgo = (age: string) =>
      f.pool.query("UPDATE record_merges SET merged_at = now() - $2::interval WHERE id = $1", [made.mergeId, age]);

    // Thirty days are 720 hours, whatever the clocks do.
    for (const age of ["31 days", "720 hours"]) {
      await mergedAgo(age);
      const before = await venueRows();
      const res = await undo(made.mergeId);
      expect(res.statusCode, `${age}: ${res.body}`).toBe(409);
      expect(res.json()).toMatchObject({ code: "UNDO_EXPIRED" });
      expect(await venueRows()).toEqual(before);
    }

    await mergedAgo("29 days");
    const result = undone(await undo(made.mergeId));
    expect(result.replayed).toBe(false);
    expect((await personRow(p.l)).merged_into_id).toBeNull();
    // An undo already made still answers once the 30 days have passed.
    await mergedAgo("31 days");
    expect(undone(await undo(made.mergeId))).toEqual({ ...result, replayed: true });
  });

  it("asks for the later merge to be undone first", async () => {
    const p = await pair();
    // C holds the shared address and belongs to X too, so the second merge
    // removes as well as moves.
    const c = await f.addPerson({ name: "Aileen Murray-Grant", emails: [p.sharedEmail], organisations: [p.x] });
    const before = await bookState();
    const first = await mergeOf(p.l, p.s);
    const second = await mergeOf(p.s, c);
    expect((await personRow(p.l)).merged_into_id).toBe(c);

    const waiting = await venueRows();
    const refused = await undo(first.mergeId);
    expect(refused.statusCode, refused.body).toBe(409);
    expect(refused.json()).toMatchObject({ code: "UNDO_LATER_MERGE_FIRST", laterMergeId: second.mergeId });
    expect(await venueRows()).toEqual(waiting);

    expect(undone(await undo(second.mergeId)).skipped).toEqual([]);
    expect((await personRow(p.l)).merged_into_id).toBe(p.s);
    expect(undone(await undo(first.mergeId)).skipped).toEqual([]);
    // Undone in turn, the two merges leave the book as it was before either.
    expect(await bookState()).toEqual(before);
  });

  it("answers not found for another venue's merge, and lets sales undo", async () => {
    const p = await pair();
    const made = await mergeOf(p.l, p.s);
    const before = await venueRows();
    for (const [mergeId, who] of [[made.mergeId, "otherStaff"], [randomUUID(), "staff"]] as const) {
      const res = await undo(mergeId, who);
      expect(res.statusCode, `${who}: ${res.body}`).toBe(404);
      expect(res.json()).toMatchObject({ code: "NOT_FOUND" });
    }
    expect(await venueRows()).toEqual(before);

    expect(undone(await undo(made.mergeId, "sales")).replayed).toBe(false);
    expect((await recordOf(made.mergeId)).undone_by).toBe(f.users.sales);
    expect(await pointingAt(p.l)).toEqual(L_HOLDS);
  });

  it("will not bring back a record when either person has been erased", async () => {
    const p = await pair();
    const made = await mergeOf(p.l, p.s);
    for (const erased of [p.l, p.s]) {
      await f.pool.query("UPDATE contacts SET erased_at = now() WHERE id = $1", [erased]);
      const before = await venueRows();
      const res = await undo(made.mergeId);
      expect(res.statusCode, res.body).toBe(409);
      expect(res.json()).toMatchObject({ code: "ERASED" });
      expect(await venueRows()).toEqual(before);
      await f.pool.query("UPDATE contacts SET erased_at = NULL WHERE id = $1", [erased]);
    }
  });

  it("keeps two people kept apart before the merge apart after the undo", async () => {
    const p = await pair();
    const suggested = async (personId: string): Promise<string[]> => {
      const res = await get(`/people/${personId}/duplicates`);
      expect(res.statusCode, res.body).toBe(200);
      return res.json<{ data: { person: { id: string } }[] }>().data.map((suggestion) => suggestion.person.id);
    };
    // They share an address, so each is suggested to the other until marked.
    expect(await suggested(p.l)).toContain(p.s);
    await f.keepApart(p.l, p.s);
    expect(await suggested(p.l)).not.toContain(p.s);

    const made = await mergeOf(p.l, p.s);
    undone(await undo(made.mergeId));
    expect(await suggested(p.l)).not.toContain(p.s);
    expect(await suggested(p.s)).not.toContain(p.l);
  });

  it("refuses a record it cannot read, changes nothing, and logs only the merge", async () => {
    const p = await pair();
    const made = await mergeOf(p.l, p.s);
    const kept = await recordOf(made.mergeId);
    const corruptions: readonly [string, readonly unknown[]][] = [
      ["UPDATE record_merges SET snapshot = jsonb_set(snapshot, '{person,id}', '\"not-a-person\"') WHERE id = $1", []],
      ["UPDATE record_merges SET moves = '[{\"target\":\"contacts.merged_into_id\",\"ids\":[\"x\"]}]'::jsonb WHERE id = $1", []],
      // Well formed, but naming another venue: never written anywhere.
      ["UPDATE record_merges SET snapshot = jsonb_set(snapshot, '{contactPoints,0,venueId}', to_jsonb($2::text)) WHERE id = $1", [f.otherVenueId]],
    ];
    for (const [corrupt, values] of corruptions) {
      await f.pool.query(corrupt, [made.mergeId, ...values]);
      const before = await venueRows();
      logged.length = 0;
      const res = await undo(made.mergeId);
      expect(res.statusCode, `${corrupt}: ${res.body}`).toBe(500);
      expect(res.json()).toEqual({ error: "Internal server error.", code: "INTERNAL_ERROR" });
      expect(await venueRows()).toEqual(before);

      const errors = logged.flatMap(([fields]) => (typeof fields === "object" && fields !== null && "err" in fields ? [fields.err] : []));
      expect(errors).toHaveLength(1);
      const [err] = errors;
      if (!(err instanceof Error)) throw new Error("Expected the error to be logged under err");
      expect(err).toMatchObject({ mergeId: made.mergeId });
      expect(err.message).toContain(made.mergeId);
      const said = `${err.message} ${JSON.stringify(err)}`;
      for (const personal of ["Murray", p.sharedEmail, p.workEmail, "07700 900123", "07700900123"]) expect(said).not.toContain(personal);

      await f.pool.query(
        "UPDATE record_merges SET snapshot = $2::jsonb, moves = $3::jsonb WHERE id = $1",
        [made.mergeId, JSON.stringify(kept.snapshot), JSON.stringify(kept.moves)],
      );
    }
    // The record as it was can be undone.
    expect(undone(await undo(made.mergeId)).skipped).toEqual([]);
  });
});
