import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { LightMyRequestResponse } from "fastify";
import {
  DuplicateSuggestionSchema,
  KeptApartMarkSchema,
  OrganisationProfileSchema,
  PersonProfileSchema,
  type OrganisationProfile,
  type PersonProfile,
} from "@omnitwin/types";
import { peopleRoutes } from "../routes/people.js";
import { openPeopleFixture, PLATFORM_TARGET, type PeopleFixture, type PeopleFixtureUser } from "./support/people-platform-fixture.js";

// ---------------------------------------------------------------------------
// The People Book's /people routes on the migrated disposable database
// (T-665, Task 6): people with several emails and phones, normalised; their
// organisations; an owner; the mirrors every older reader keeps reading; and
// the mark that says two people are not the same person. Only real rows show
// the one-primary indexes, the unique keys and two presses arriving at once.
//
// Opt-in, disposable PostgreSQL only. Never consults DATABASE_URL or .env.
// ---------------------------------------------------------------------------

type LiveProfile = Extract<PersonProfile, { status: "live" }>;
type Method = "GET" | "POST" | "PATCH" | "PUT" | "DELETE";

describe.skipIf(PLATFORM_TARGET === undefined)("the People Book's people routes on the migrated disposable database", () => {
  let f: PeopleFixture;
  beforeAll(async () => {
    f = await openPeopleFixture(async (server, db) => { await server.register(peopleRoutes, { db, prefix: "/people" }); });
  }, 120_000);
  afterAll(async () => { await f?.close(); });

  function send(method: Method, url: string, who: PeopleFixtureUser, payload?: object): Promise<LightMyRequestResponse> {
    return f.server.inject({ method, url, headers: f.bearer(who), ...(payload === undefined ? {} : { payload }) });
  }
  const get = (url: string, who: PeopleFixtureUser = "staff") => send("GET", url, who);
  const post = (url: string, who: PeopleFixtureUser, payload: object) => send("POST", url, who, payload);
  const patch = (url: string, who: PeopleFixtureUser, payload: object) => send("PATCH", url, who, payload);
  const put = (url: string, who: PeopleFixtureUser, payload: object) => send("PUT", url, who, payload);
  const del = (url: string, who: PeopleFixtureUser = "staff") => send("DELETE", url, who);

  function live(res: LightMyRequestResponse): LiveProfile {
    const profile = PersonProfileSchema.parse(res.json().data);
    if (profile.status !== "live") throw new Error("Expected a live person");
    return profile;
  }

  async function create(who: PeopleFixtureUser, body: Record<string, unknown>): Promise<LiveProfile> {
    const res = await post("/people", who, { venueId: f.venueId, ...body });
    expect(res.statusCode, res.body).toBe(201);
    return live(res);
  }

  async function mirror(personId: string): Promise<{ email: string | null; phone: string | null; client_account_id: string | null }> {
    const { rows } = await f.pool.query<{ email: string | null; phone: string | null; client_account_id: string | null }>(
      "SELECT email, phone, client_account_id FROM contacts WHERE id = $1", [personId],
    );
    const row = rows[0];
    if (row === undefined) throw new Error("No such person");
    return row;
  }

  async function liveMarks(a: string, b: string): Promise<number> {
    const { rows } = await f.pool.query<{ count: number }>(
      `SELECT count(*)::int AS count FROM contact_kept_apart
        WHERE low_contact_id = LEAST($1::uuid, $2::uuid) AND high_contact_id = GREATEST($1::uuid, $2::uuid) AND withdrawn_at IS NULL`,
      [a, b],
    );
    return rows[0]?.count ?? -1;
  }

  function statuses(...responses: readonly LightMyRequestResponse[]): number[] {
    return responses.map((res) => res.statusCode).sort((x, y) => x - y);
  }

  /**
   * Presses that really overlap: a third connection holds the people's rows
   * while the presses start, and lets go only once every press is waiting on
   * that lock, so none can finish before the others have begun.
   */
  async function pressTogether(personIds: readonly string[], presses: () => readonly Promise<LightMyRequestResponse>[]): Promise<LightMyRequestResponse[]> {
    const holder = await f.pool.connect();
    let inFlight: readonly Promise<LightMyRequestResponse>[] = [];
    try {
      await holder.query("BEGIN");
      await holder.query("SELECT id FROM contacts WHERE id = ANY($1::uuid[]) ORDER BY id FOR UPDATE", [personIds]);
      inFlight = presses();
      for (let attempt = 0; ; attempt += 1) {
        // pg_stat_activity is read once per transaction unless the snapshot
        // is cleared, and the holder polls from inside its own transaction.
        await holder.query("SELECT pg_stat_clear_snapshot()");
        const { rows } = await holder.query<{ waiting: number }>(
          `SELECT count(*)::int AS waiting FROM pg_stat_activity
            WHERE application_name = current_setting('application_name') AND wait_event_type = 'Lock' AND pid <> pg_backend_pid()`,
        );
        if ((rows[0]?.waiting ?? 0) >= inFlight.length) break;
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
    return Promise.all(inFlight);
  }

  it("creates a person with their email and phone, normalised, and makes the creator the owner", async () => {
    const res = await post("/people", "staff", { venueId: f.venueId, name: "Aileen Murray", jobTitle: "Secretary",
      contactPoints: [{ kind: "email", value: " Aileen.Murray@Example.TEST ", label: "work" }, { kind: "phone", value: "+44 7700 900123", label: "mobile" }] });
    expect(res.statusCode, res.body).toBe(201);
    const profile = live(res);
    expect(profile.person).toMatchObject({ name: "Aileen Murray", jobTitle: "Secretary", email: "Aileen.Murray@Example.TEST", phone: "+44 7700 900123", ownerUserId: f.users.staff });
    expect(profile.contactPoints.map((p) => [p.kind, p.value, p.displayValue, p.label, p.isPrimary])).toEqual([
      ["email", "aileen.murray@example.test", "Aileen.Murray@Example.TEST", "work", true],
      ["phone", "07700900123", "+44 7700 900123", "mobile", true],
    ]);
    expect(profile.owner?.id).toBe(f.users.staff);
    expect(profile.duplicateSuggestionCount).toBe(0);
    expect(await mirror(profile.person.id)).toEqual({ email: "Aileen.Murray@Example.TEST", phone: "+44 7700 900123", client_account_id: null });

    const read = await get(`/people/${profile.person.id}`);
    expect(read.statusCode, read.body).toBe(200);
    expect(live(read)).toEqual(profile);
  });

  it("lets sales create and edit a person", async () => {
    const created = await create("sales", { name: "Fergus Lindsay" });
    expect(created.person.ownerUserId).toBe(f.users.sales);
    const res = await patch(`/people/${created.person.id}`, "sales", { jobTitle: "Treasurer", notes: "Prefers a call after six" });
    expect(res.statusCode, res.body).toBe(200);
    expect(live(res).person).toMatchObject({ jobTitle: "Treasurer", notes: "Prefers a call after six", name: "Fergus Lindsay" });
  });

  it("refuses an owner who is not on the venue's commercial team", async () => {
    for (const owner of [f.users.hallkeeper, f.users.otherStaff]) {
      const res = await post("/people", "staff", { venueId: f.venueId, name: "Owned Elsewhere", ownerUserId: owner });
      expect(res.statusCode, res.body).toBe(422);
      expect(res.json()).toMatchObject({ code: "OWNER_NOT_AT_VENUE" });
    }
    const { rows } = await f.pool.query<{ count: number }>(
      "SELECT count(*)::int AS count FROM contacts WHERE venue_id = $1 AND name = 'Owned Elsewhere'", [f.venueId],
    );
    expect(rows[0]?.count).toBe(0);

    const managed = await create("staff", { name: "Kirsty Doyle", ownerUserId: f.users.manager });
    expect(managed.owner).toEqual({ id: f.users.manager, name: "People Book manager" });
    const moved = await patch(`/people/${managed.person.id}`, "staff", { ownerUserId: f.users.hallkeeper });
    expect(moved.statusCode, moved.body).toBe(422);
    expect(moved.json()).toMatchObject({ code: "OWNER_NOT_AT_VENUE" });
    expect(live(await get(`/people/${managed.person.id}`)).person.ownerUserId).toBe(f.users.manager);

    // Nobody owns a person made with no owner, or by someone on no venue's team.
    expect((await create("staff", { name: "Ewan Ross", ownerUserId: null })).owner).toBeNull();
    expect((await create("platformAdmin", { name: "Ishbel Ross" })).person.ownerUserId).toBeNull();
  });

  it("refuses to create a person at another venue", async () => {
    const res = await post("/people", "staff", { venueId: f.otherVenueId, name: "Somewhere Else" });
    expect(res.statusCode, res.body).toBe(403);
    expect(res.json()).toMatchObject({ code: "FORBIDDEN" });
  });

  it("answers not found for another venue's person, a deleted one and a made-up id", async () => {
    const other = await f.addPerson({ name: "Isla Grant", venueId: f.otherVenueId, emails: ["isla.elsewhere@example.test"] });
    const deleted = await f.addPerson({ name: "Gone Person", emails: ["gone.person@example.test"] });
    await f.pool.query("UPDATE contacts SET deleted_at = now() WHERE id = $1", [deleted]);
    const witness = await f.addPerson({ name: "Witness Person" });
    const otherPoint = (await f.pool.query<{ id: string }>("SELECT id FROM contact_points WHERE contact_id = $1", [other])).rows[0]?.id;
    if (otherPoint === undefined) throw new Error("The other venue's person has no point");

    for (const id of [other, deleted, randomUUID()]) {
      const attempts: readonly [Method, string, object | undefined][] = [
        ["GET", `/people/${id}`, undefined],
        ["PATCH", `/people/${id}`, { jobTitle: "Chair" }],
        ["POST", `/people/${id}/contact-points`, { kind: "email", value: "intruder@example.test" }],
        ["DELETE", `/people/${id}/contact-points/${otherPoint}`, undefined],
        ["PUT", `/people/${id}/memberships`, { memberships: [] }],
        ["GET", `/people/${id}/duplicates`, undefined],
        ["POST", `/people/${id}/kept-apart`, { otherPersonId: witness }],
        ["DELETE", `/people/${id}/kept-apart/${witness}`, undefined],
      ];
      for (const [method, url, payload] of attempts) {
        const res = await send(method, url, "staff", payload);
        expect(res.statusCode, `${method} ${url}: ${res.body}`).toBe(404);
        expect(res.json()).toMatchObject({ code: "NOT_FOUND" });
      }
    }
    const { rows } = await f.pool.query<{ job_title: string | null; points: number }>(
      "SELECT job_title, (SELECT count(*)::int FROM contact_points WHERE contact_id = $1) AS points FROM contacts WHERE id = $1",
      [other],
    );
    expect(rows[0]).toEqual({ job_title: null, points: 1 });
  });

  it("edits with the time it last read, and refuses an edit made from an older read", async () => {
    const created = await create("staff", { name: "Rhona Stewart" });
    const url = `/people/${created.person.id}`;
    const first = await patch(url, "staff", { jobTitle: "Chair", expectedUpdatedAt: created.person.updatedAt });
    expect(first.statusCode, first.body).toBe(200);
    const edited = live(first);
    expect(edited.person.jobTitle).toBe("Chair");
    expect(edited.person.updatedAt).not.toBe(created.person.updatedAt);

    const stale = await patch(url, "staff", { jobTitle: "Treasurer", expectedUpdatedAt: created.person.updatedAt });
    expect(stale.statusCode, stale.body).toBe(409);
    expect(stale.json()).toMatchObject({ code: "STALE_RECORD" });
    expect(live(await get(url)).person.jobTitle).toBe("Chair");

    const fresh = await patch(url, "staff", { jobTitle: "Treasurer", expectedUpdatedAt: edited.person.updatedAt });
    expect(fresh.statusCode, fresh.body).toBe(200);
    expect(live(fresh).person.jobTitle).toBe("Treasurer");
  });

  it("answers a phone typed another way with the point the person already holds", async () => {
    const created = await create("staff", { name: "Morag Campbell", contactPoints: [
      { kind: "phone", value: "+44 7700 900123" },
      { kind: "phone", value: "+44 (0)141 496 0000", label: "work" },
    ] });
    const [mobile, office] = created.contactPoints;
    if (mobile === undefined || office === undefined) throw new Error("Expected two phones");
    for (const [value, held] of [["07700 900 123", mobile], ["0044 141 496 0000", office], ["0141 496 0000", office]] as const) {
      const res = await post(`/people/${created.person.id}/contact-points`, "staff", { kind: "phone", value });
      expect(res.statusCode, `${value}: ${res.body}`).toBe(200);
      const profile = live(res);
      expect(profile.contactPoints.map((p) => [p.id, p.displayValue])).toEqual([
        [mobile.id, "+44 7700 900123"],
        [office.id, "+44 (0)141 496 0000"],
      ]);
      expect(profile.contactPoints.some((p) => p.id === held.id)).toBe(true);
    }
    expect(live(await get(`/people/${created.person.id}`)).person.phone).toBe("+44 7700 900123");
  });

  it("makes a new primary email the one the record shows", async () => {
    const created = await create("staff", { name: "Aileen Murray", contactPoints: [{ kind: "email", value: "aileen@home.example.test" }] });
    const home = created.contactPoints[0];
    if (home === undefined) throw new Error("Expected the home email");
    const url = `/people/${created.person.id}/contact-points`;
    const res = await post(url, "staff", { kind: "email", value: "aileen@work.example.test", isPrimary: true });
    expect(res.statusCode, res.body).toBe(201);
    const profile = live(res);
    expect(profile.person.email).toBe("aileen@work.example.test");
    expect(profile.contactPoints.map((p) => [p.value, p.isPrimary])).toEqual([
      ["aileen@work.example.test", true],
      ["aileen@home.example.test", false],
    ]);
    expect((await mirror(created.person.id)).email).toBe("aileen@work.example.test");

    // Asking for one the person already holds makes that one primary again.
    const back = await post(url, "staff", { kind: "email", value: "Aileen@Home.example.test", isPrimary: true });
    expect(back.statusCode, back.body).toBe(200);
    expect(live(back).contactPoints.map((p) => [p.id, p.isPrimary])[0]).toEqual([home.id, true]);
    expect((await mirror(created.person.id)).email).toBe("aileen@home.example.test");
  });

  it("promotes the oldest remaining email when the primary goes, and shows none when the last goes", async () => {
    const created = await create("staff", { name: "Catriona Baird", contactPoints: [
      { kind: "email", value: "first@baird.example.test" },
      { kind: "email", value: "second@baird.example.test" },
      { kind: "email", value: "third@baird.example.test" },
      { kind: "phone", value: "0141 496 0301" },
    ] });
    const byValue = new Map(created.contactPoints.map((p) => [p.value, p]));
    const point = (value: string): string => {
      const found = byValue.get(value);
      if (found === undefined) throw new Error(`No point ${value}`);
      return found.id;
    };
    expect(created.person.email).toBe("first@baird.example.test");
    const base = `/people/${created.person.id}`;

    const first = await del(`${base}/contact-points/${point("first@baird.example.test")}`);
    expect(first.statusCode, first.body).toBe(204);
    const after = live(await get(base));
    expect(after.person.email).toBe("second@baird.example.test");
    expect(after.contactPoints.filter((p) => p.kind === "email").map((p) => [p.value, p.isPrimary])).toEqual([
      ["second@baird.example.test", true],
      ["third@baird.example.test", false],
    ]);

    for (const value of ["second@baird.example.test", "third@baird.example.test"]) {
      expect((await del(`${base}/contact-points/${point(value)}`)).statusCode).toBe(204);
    }
    const none = live(await get(base));
    expect(none.person.email).toBeNull();
    expect(none.person.phone).toBe("0141 496 0301");
    expect(none.contactPoints.map((p) => p.kind)).toEqual(["phone"]);
    expect(await mirror(created.person.id)).toMatchObject({ email: null, phone: "0141 496 0301" });

    const again = await del(`${base}/contact-points/${point("third@baird.example.test")}`);
    expect(again.statusCode, again.body).toBe(404);
  });

  it("will not remove another person's contact point", async () => {
    const one = await create("staff", { name: "Neil Stewart" });
    const two = await create("staff", { name: "Kirsty Stewart", contactPoints: [{ kind: "email", value: "kirsty@stewart.example.test" }] });
    const theirs = two.contactPoints[0];
    if (theirs === undefined) throw new Error("Expected Kirsty's email");
    const res = await del(`/people/${one.person.id}/contact-points/${theirs.id}`);
    expect(res.statusCode, res.body).toBe(404);
    expect(res.json()).toMatchObject({ code: "NOT_FOUND" });
    expect(live(await get(`/people/${two.person.id}`)).contactPoints.map((p) => p.id)).toEqual([theirs.id]);
  });

  it("sets a person's organisations, mirrors the primary, and refuses another venue's", async () => {
    const society = await f.addOrganisation({ name: "Glasgow Medical Society", kind: "organisation" });
    const household = await f.addOrganisation({ name: "Murray household" });
    const foreign = await f.addOrganisation({ name: "A club elsewhere", kind: "organisation", venueId: f.otherVenueId });
    const created = await create("staff", { name: "Shona Murray" });
    const url = `/people/${created.person.id}/memberships`;
    const shape = (profile: LiveProfile) => profile.memberships.map((m) => [m.organisation.id, m.organisation.name, m.organisation.kind, m.roleLabel, m.isPrimary]);

    const res = await put(url, "staff", { memberships: [
      { organisationId: society, roleLabel: "Secretary", isPrimary: true },
      { organisationId: household },
    ] });
    expect(res.statusCode, res.body).toBe(200);
    const set = live(res);
    expect(shape(set)).toEqual([
      [society, "Glasgow Medical Society", "organisation", "Secretary", true],
      [household, "Murray household", "household", null, false],
    ]);
    expect(set.person.clientAccountId).toBe(society);
    expect((await mirror(created.person.id)).client_account_id).toBe(society);

    const refused = await put(url, "staff", { memberships: [{ organisationId: household, isPrimary: true }, { organisationId: foreign }] });
    expect(refused.statusCode, refused.body).toBe(404);
    expect(refused.json()).toMatchObject({ code: "ORGANISATION_NOT_FOUND" });
    expect(shape(live(await get(`/people/${created.person.id}`)))).toEqual(shape(set));
    expect((await mirror(created.person.id)).client_account_id).toBe(society);

    // No primary in the list: the first is primary; a label not sent is kept.
    const swapped = await put(url, "staff", { memberships: [{ organisationId: household }, { organisationId: society }] });
    expect(swapped.statusCode, swapped.body).toBe(200);
    expect(shape(live(swapped))).toEqual([
      [household, "Murray household", "household", null, true],
      [society, "Glasgow Medical Society", "organisation", "Secretary", false],
    ]);
    expect((await mirror(created.person.id)).client_account_id).toBe(household);

    const cleared = await put(url, "staff", { memberships: [] });
    expect(cleared.statusCode, cleared.body).toBe(200);
    expect(live(cleared).memberships).toEqual([]);
    expect(live(cleared).person.clientAccountId).toBeNull();
    expect((await mirror(created.person.id)).client_account_id).toBeNull();
  });

  /** A person as the older from-enquiry writer leaves them (crm.ts): the
   *  mirror columns set, no points and no membership. */
  async function legacyContact(input: { name: string; email: string | null; phone: string | null; clientAccountId: string | null }): Promise<string> {
    const { rows } = await f.pool.query<{ id: string }>(
      `INSERT INTO contacts (venue_id, client_account_id, name, email, phone, role_label)
       VALUES ($1, $2, $3, $4, $5, 'Primary event contact') RETURNING id`,
      [f.venueId, input.clientAccountId, input.name, input.email, input.phone],
    );
    const id = rows[0]?.id;
    if (id === undefined) throw new Error("The legacy contact was not written");
    return id;
  }

  async function heldRows(personId: string): Promise<{ points: number; memberships: number }> {
    const { rows } = await f.pool.query<{ points: number; memberships: number }>(
      `SELECT (SELECT count(*)::int FROM contact_points WHERE contact_id = $1) AS points,
              (SELECT count(*)::int FROM account_memberships WHERE contact_id = $1) AS memberships`,
      [personId],
    );
    const row = rows[0];
    if (row === undefined) throw new Error("No counts");
    return row;
  }

  it("keeps what an older writer left on a person when the book first writes to them", async () => {
    const household = await f.addOrganisation({ name: "Legacy household" });
    const id = await legacyContact({ name: "Morven Legacy", email: "Morven.Legacy@Example.TEST", phone: "+44 7700 900123", clientAccountId: household });

    // A refused write leaves no trace, adopted rows included.
    const refused = await del(`/people/${id}/contact-points/${randomUUID()}`);
    expect(refused.statusCode, refused.body).toBe(404);
    expect(await heldRows(id)).toEqual({ points: 0, memberships: 0 });

    const res = await post(`/people/${id}/contact-points`, "staff", { kind: "phone", value: "0141 496 0123", label: "work" });
    expect(res.statusCode, res.body).toBe(201);
    const profile = live(res);
    expect(profile.contactPoints.map((p) => [p.kind, p.value, p.displayValue, p.label, p.isPrimary])).toEqual([
      ["email", "morven.legacy@example.test", "Morven.Legacy@Example.TEST", "other", true],
      ["phone", "07700900123", "+44 7700 900123", "other", true],
      ["phone", "01414960123", "0141 496 0123", "work", false],
    ]);
    expect(profile.memberships.map((m) => [m.organisation.id, m.roleLabel, m.isPrimary])).toEqual([
      [household, "Primary event contact", true],
    ]);
    expect(profile.person).toMatchObject({ email: "Morven.Legacy@Example.TEST", phone: "+44 7700 900123", clientAccountId: household });
    expect(await mirror(id)).toEqual({ email: "Morven.Legacy@Example.TEST", phone: "+44 7700 900123", client_account_id: household });
  });

  it("keeps a legacy email when the book first sets the person's organisations", async () => {
    const household = await f.addOrganisation({ name: "Older household" });
    const society = await f.addOrganisation({ name: "Newer society", kind: "organisation" });
    const foreign = await f.addOrganisation({ name: "Elsewhere society", kind: "organisation", venueId: f.otherVenueId });
    const id = await legacyContact({ name: "Euan Legacy", email: "euan.legacy@example.test", phone: "+44 7700 900124", clientAccountId: household });
    const url = `/people/${id}/memberships`;

    const refused = await put(url, "staff", { memberships: [{ organisationId: foreign }] });
    expect(refused.statusCode, refused.body).toBe(404);
    expect(refused.json()).toMatchObject({ code: "ORGANISATION_NOT_FOUND" });
    expect(await heldRows(id)).toEqual({ points: 0, memberships: 0 });
    expect(await mirror(id)).toEqual({ email: "euan.legacy@example.test", phone: "+44 7700 900124", client_account_id: household });

    const res = await put(url, "staff", { memberships: [{ organisationId: society }] });
    expect(res.statusCode, res.body).toBe(200);
    const profile = live(res);
    expect(profile.contactPoints.map((p) => [p.kind, p.value, p.isPrimary])).toEqual([
      ["email", "euan.legacy@example.test", true],
      ["phone", "07700900124", true],
    ]);
    expect(profile.memberships.map((m) => [m.organisation.id, m.isPrimary])).toEqual([[society, true]]);
    expect(await mirror(id)).toEqual({ email: "euan.legacy@example.test", phone: "+44 7700 900124", client_account_id: society });
  });

  it("leaves an unusable legacy phone out, as the backfill does", async () => {
    const id = await legacyContact({ name: "Isla Legacy", email: null, phone: "TBC", clientAccountId: null });
    const res = await post(`/people/${id}/contact-points`, "staff", { kind: "email", value: "isla.legacy@example.test" });
    expect(res.statusCode, res.body).toBe(201);
    const profile = live(res);
    expect(profile.contactPoints.map((p) => [p.kind, p.value])).toEqual([["email", "isla.legacy@example.test"]]);
    expect(profile.person.phone).toBeNull();
    expect(await mirror(id)).toEqual({ email: "isla.legacy@example.test", phone: null, client_account_id: null });
  });

  it("moves the primary off an organisation that is no longer live", async () => {
    const closing = await f.addOrganisation({ name: "Closing club", kind: "organisation" });
    const continuing = await f.addOrganisation({ name: "Continuing club", kind: "organisation" });
    const absorbed = await f.addOrganisation({ name: "Absorbed club", kind: "organisation" });
    const first = await f.addPerson({ name: "Fiona Kerr", organisations: [closing, continuing] });
    const second = await f.addPerson({ name: "Ruaridh Kerr", organisations: [absorbed, continuing] });
    await f.pool.query("UPDATE client_accounts SET deleted_at = now() WHERE id = $1", [closing]);
    await f.pool.query("UPDATE client_accounts SET merged_into_id = $2, deleted_at = now() WHERE id = $1", [absorbed, continuing]);

    for (const [id, gone, value] of [[first, closing, "fiona@kerr.example.test"], [second, absorbed, "ruaridh@kerr.example.test"]] as const) {
      const res = await post(`/people/${id}/contact-points`, "staff", { kind: "email", value });
      expect(res.statusCode, res.body).toBe(201);
      const profile = live(res);
      expect(profile.memberships.map((m) => [m.organisation.id, m.isPrimary])).toEqual([[continuing, true]]);
      expect(profile.person.clientAccountId).toBe(continuing);
      expect((await mirror(id)).client_account_id).toBe(continuing);
      const { rows } = await f.pool.query<{ is_primary: boolean }>(
        "SELECT is_primary FROM account_memberships WHERE contact_id = $1 AND client_account_id = $2", [id, gone],
      );
      expect(rows).toEqual([{ is_primary: false }]);
    }
  });

  it("keeps one point when the same new email is added twice at once", async () => {
    const created = await create("staff", { name: "Callum Reid" });
    const url = `/people/${created.person.id}/contact-points`;
    const body = { kind: "email", value: "callum@reid.example.test" };
    const [one, two] = await pressTogether([created.person.id], () => [post(url, "staff", body), post(url, "sales", body)]);
    if (one === undefined || two === undefined) throw new Error("Expected two answers");
    expect(statuses(one, two)).toEqual([200, 201]);
    expect(live(one).contactPoints.map((p) => p.id)).toEqual(live(two).contactPoints.map((p) => p.id));
    const { rows } = await f.pool.query<{ count: number }>(
      "SELECT count(*)::int AS count FROM contact_points WHERE contact_id = $1 AND kind = 'email'", [created.person.id],
    );
    expect(rows[0]?.count).toBe(1);
  });

  it("counts and lists the person's possible duplicates", async () => {
    const a = await create("staff", { name: "Euan Macleod", contactPoints: [{ kind: "email", value: "euan@rowing.example.test" }] });
    const b = await create("staff", { name: "E Macleod", contactPoints: [{ kind: "email", value: " EUAN@Rowing.example.test" }] });
    expect(live(await get(`/people/${a.person.id}`)).duplicateSuggestionCount).toBe(1);
    const res = await get(`/people/${a.person.id}/duplicates`);
    expect(res.statusCode, res.body).toBe(200);
    expect(DuplicateSuggestionSchema.array().parse(res.json().data)).toEqual([
      { person: { id: b.person.id, name: "E Macleod", organisationName: null }, reasons: ["shared_email"] },
    ]);
  });

  async function pair(email: string): Promise<[string, string]> {
    const a = await create("staff", { name: "Ailsa Henderson", contactPoints: [{ kind: "email", value: email }] });
    const b = await create("staff", { name: "Iain Henderson", contactPoints: [{ kind: "email", value: email }] });
    return [a.person.id, b.person.id];
  }

  it("keeps two people apart, once, from either side", async () => {
    const [a, b] = await pair("pair@example.test");
    const first = await post(`/people/${a}/kept-apart`, "staff", { otherPersonId: b });
    expect(first.statusCode, first.body).toBe(201);
    const mark = KeptApartMarkSchema.parse(first.json().data);
    expect(mark).toMatchObject({ venueId: f.venueId, personIds: [a, b].sort(), decidedBy: f.users.staff });

    const duplicates = await get(`/people/${a}/duplicates`);
    expect(duplicates.statusCode, duplicates.body).toBe(200);
    expect(duplicates.json().data).toEqual([]);
    expect(live(await get(`/people/${a}`)).duplicateSuggestionCount).toBe(0);

    const second = await post(`/people/${b}/kept-apart`, "sales", { otherPersonId: a });
    expect(second.statusCode, second.body).toBe(200);
    expect(KeptApartMarkSchema.parse(second.json().data)).toEqual(mark);
    expect(await liveMarks(a, b)).toBe(1);
  });

  it("keeps one mark when both sides press at once", async () => {
    const [a, b] = await pair("both-sides@example.test");
    const [one, two] = await pressTogether([a, b], () => [
      post(`/people/${a}/kept-apart`, "staff", { otherPersonId: b }),
      post(`/people/${b}/kept-apart`, "sales", { otherPersonId: a }),
    ]);
    if (one === undefined || two === undefined) throw new Error("Expected two answers");
    expect(statuses(one, two)).toEqual([200, 201]);
    expect(KeptApartMarkSchema.parse(one.json().data).id).toBe(KeptApartMarkSchema.parse(two.json().data).id);
    expect(await liveMarks(a, b)).toBe(1);
  });

  it("withdraws the mark, keeps its history, and suggests the pair again", async () => {
    const [a, b] = await pair("withdrawn@example.test");
    const made = await post(`/people/${a}/kept-apart`, "staff", { otherPersonId: b });
    expect(made.statusCode, made.body).toBe(201);
    const mark = KeptApartMarkSchema.parse(made.json().data);

    const withdrawn = await del(`/people/${a}/kept-apart/${b}`, "sales");
    expect(withdrawn.statusCode, withdrawn.body).toBe(204);
    const duplicates = await get(`/people/${a}/duplicates`);
    expect(DuplicateSuggestionSchema.array().parse(duplicates.json().data).map((d) => d.person.id)).toEqual([b]);
    const { rows } = await f.pool.query<{ id: string; decided_by: string; withdrawn: boolean; withdrawn_by: string | null }>(
      `SELECT id, decided_by, withdrawn_at IS NOT NULL AS withdrawn, withdrawn_by FROM contact_kept_apart
        WHERE low_contact_id = LEAST($1::uuid, $2::uuid) AND high_contact_id = GREATEST($1::uuid, $2::uuid)`,
      [a, b],
    );
    expect(rows).toEqual([{ id: mark.id, decided_by: f.users.staff, withdrawn: true, withdrawn_by: f.users.sales }]);

    const again = await del(`/people/${b}/kept-apart/${a}`);
    expect(again.statusCode, again.body).toBe(404);
    expect(again.json()).toMatchObject({ code: "NOT_FOUND" });

    // The withdrawn mark is history; the pair can be kept apart anew.
    const anew = await post(`/people/${b}/kept-apart`, "staff", { otherPersonId: a });
    expect(anew.statusCode, anew.body).toBe(201);
    expect(KeptApartMarkSchema.parse(anew.json().data).id).not.toBe(mark.id);
    expect(await liveMarks(a, b)).toBe(1);
  });

  it("refuses to keep a person apart from themself or from another venue's person", async () => {
    const [a] = await pair("alone@example.test");
    const self = await post(`/people/${a}/kept-apart`, "staff", { otherPersonId: a.toUpperCase() });
    expect(self.statusCode, self.body).toBe(422);
    expect(self.json()).toMatchObject({ code: "SAME_RECORD" });

    const elsewhere = await f.addPerson({ name: "Ailsa Henderson", venueId: f.otherVenueId, emails: ["alone@example.test"] });
    for (const who of ["staff", "platformAdmin"] as const) {
      const res = await post(`/people/${a}/kept-apart`, who, { otherPersonId: elsewhere });
      expect(res.statusCode, `${who}: ${res.body}`).toBe(404);
      expect(res.json()).toMatchObject({ code: "NOT_FOUND" });
      const back = await post(`/people/${elsewhere}/kept-apart`, who, { otherPersonId: a });
      expect(back.statusCode, `${who}: ${back.body}`).toBe(404);
      expect((await del(`/people/${a}/kept-apart/${elsewhere}`, who)).statusCode).toBe(404);
    }
    const { rows } = await f.pool.query<{ count: number }>(
      "SELECT count(*)::int AS count FROM contact_kept_apart WHERE $1::uuid IN (low_contact_id, high_contact_id)", [a],
    );
    expect(rows[0]?.count).toBe(0);
  });

  it("stores a pair named in capitals in the database's own order", async () => {
    const [a, b] = await pair("capitals@example.test");
    const res = await post(`/people/${a.toUpperCase()}/kept-apart`, "staff", { otherPersonId: b.toUpperCase() });
    expect(res.statusCode, res.body).toBe(201);
    expect(KeptApartMarkSchema.parse(res.json().data).personIds).toEqual([a, b].sort());
    expect((await del(`/people/${b.toUpperCase()}/kept-apart/${a.toUpperCase()}`)).statusCode).toBe(204);
  });

  function organisation(res: LightMyRequestResponse): OrganisationProfile {
    return OrganisationProfileSchema.parse(res.json().data);
  }

  async function createOrganisation(who: PeopleFixtureUser, body: Record<string, unknown>): Promise<OrganisationProfile> {
    const res = await post("/people/organisations", who, { venueId: f.venueId, ...body });
    expect(res.statusCode, res.body).toBe(201);
    return organisation(res);
  }

  it("creates a household and an organisation, each owned by its creator", async () => {
    const household = await createOrganisation("staff", { name: "Murray household", kind: "household" });
    expect(household.organisation).toMatchObject({
      name: "Murray household", kind: "household", accountType: "event_client", venueId: f.venueId,
      ownerUserId: f.users.staff, primaryContactId: null, address: null, website: null, vatNumber: null, notes: null,
    });
    expect(household.members).toEqual([]);
    expect(household.owner?.id).toBe(f.users.staff);

    const society = await createOrganisation("staff", {
      name: "Glasgow Medical Society", kind: "organisation", website: "medsoc.example.test", vatNumber: "GB000000000",
    });
    expect(society.organisation).toMatchObject({
      kind: "organisation", website: "medsoc.example.test", vatNumber: "GB000000000", ownerUserId: f.users.staff,
    });
    const { rows } = await f.pool.query<{ created_by: string | null; kind: string }>(
      "SELECT created_by, kind FROM client_accounts WHERE id = $1", [society.organisation.id],
    );
    expect(rows[0]).toEqual({ created_by: f.users.staff, kind: "organisation" });

    // A platform admin works across venues and so owns nothing by default.
    expect((await createOrganisation("platformAdmin", { name: "Nobody's club", kind: "organisation" })).owner).toBeNull();
  });

  it("refuses an owner who is not on the commercial team, and a venue that is not the actor's", async () => {
    for (const owner of [f.users.hallkeeper, f.users.otherStaff]) {
      const res = await post("/people/organisations", "staff", { venueId: f.venueId, name: "Owned Elsewhere Ltd", kind: "organisation", ownerUserId: owner });
      expect(res.statusCode, res.body).toBe(422);
      expect(res.json()).toMatchObject({ code: "OWNER_NOT_AT_VENUE" });
    }
    const { rows } = await f.pool.query<{ count: number }>(
      "SELECT count(*)::int AS count FROM client_accounts WHERE venue_id = $1 AND name = 'Owned Elsewhere Ltd'", [f.venueId],
    );
    expect(rows[0]?.count).toBe(0);

    const managed = await createOrganisation("staff", { name: "Managed club", kind: "organisation", ownerUserId: f.users.manager });
    expect(managed.owner).toEqual({ id: f.users.manager, name: "People Book manager" });
    const moved = await patch(`/people/organisations/${managed.organisation.id}`, "staff", { ownerUserId: f.users.hallkeeper });
    expect(moved.statusCode, moved.body).toBe(422);
    expect(moved.json()).toMatchObject({ code: "OWNER_NOT_AT_VENUE" });
    expect(organisation(await get(`/people/organisations/${managed.organisation.id}`)).organisation.ownerUserId).toBe(f.users.manager);

    const elsewhere = await post("/people/organisations", "staff", { venueId: f.otherVenueId, name: "Somewhere Else", kind: "household" });
    expect(elsewhere.statusCode, elsewhere.body).toBe(403);
    expect(elsewhere.json()).toMatchObject({ code: "FORBIDDEN" });
  });

  it("reads an organisation with its live members, primary first", async () => {
    const society = await createOrganisation("staff", { name: "Perth Rotary Club", kind: "organisation" });
    const club = society.organisation.id;
    const other = await f.addOrganisation({ name: "Reid household" });
    const alasdair = await create("staff", { name: "Alasdair Reid" });
    const morven = await create("staff", { name: "Morven Reid" });
    const gone = await create("staff", { name: "Duplicate Reid" });
    // Alasdair is listed under the club first by name, but the club is Morven's primary.
    expect((await put(`/people/${alasdair.person.id}/memberships`, "staff", {
      memberships: [{ organisationId: other, isPrimary: true }, { organisationId: club, roleLabel: "Treasurer" }],
    })).statusCode).toBe(200);
    expect((await put(`/people/${morven.person.id}/memberships`, "staff", {
      memberships: [{ organisationId: club, roleLabel: "Secretary", isPrimary: true }],
    })).statusCode).toBe(200);
    expect((await put(`/people/${gone.person.id}/memberships`, "staff", {
      memberships: [{ organisationId: club, roleLabel: "Chair", isPrimary: true }],
    })).statusCode).toBe(200);
    await f.pool.query("UPDATE contacts SET merged_into_id = $2, deleted_at = now() WHERE id = $1", [gone.person.id, morven.person.id]);

    const res = await get(`/people/organisations/${club}`);
    expect(res.statusCode, res.body).toBe(200);
    const profile = organisation(res);
    expect(profile.members).toEqual([
      { personId: morven.person.id, name: "Morven Reid", roleLabel: "Secretary", isPrimary: true },
      { personId: alasdair.person.id, name: "Alasdair Reid", roleLabel: "Treasurer", isPrimary: false },
    ]);
    expect(profile.organisation).toMatchObject({ id: club, name: "Perth Rotary Club", kind: "organisation" });
    expect(profile.owner?.id).toBe(f.users.staff);

    // A deleted organisation is not read.
    await f.pool.query("UPDATE client_accounts SET deleted_at = now() WHERE id = $1", [club]);
    expect((await get(`/people/organisations/${club}`)).statusCode).toBe(404);
  });

  it("edits an organisation with the time it last read, and refuses an older read", async () => {
    const created = await createOrganisation("staff", { name: "Kelvin Bridge Society", kind: "organisation" });
    const url = `/people/organisations/${created.organisation.id}`;
    const first = await patch(url, "staff", {
      website: "kelvin.example.test", kind: "household", address: "Fictional Lane, Glasgow", expectedUpdatedAt: created.organisation.updatedAt,
    });
    expect(first.statusCode, first.body).toBe(200);
    const edited = organisation(first);
    expect(edited.organisation).toMatchObject({
      name: "Kelvin Bridge Society", website: "kelvin.example.test", kind: "household", address: "Fictional Lane, Glasgow",
    });
    expect(edited.organisation.updatedAt).not.toBe(created.organisation.updatedAt);

    const stale = await patch(url, "staff", { vatNumber: "GB111111111", expectedUpdatedAt: created.organisation.updatedAt });
    expect(stale.statusCode, stale.body).toBe(409);
    expect(stale.json()).toMatchObject({ code: "STALE_RECORD" });
    expect(organisation(await get(url)).organisation.vatNumber).toBeNull();

    const fresh = await patch(url, "staff", { vatNumber: "GB111111111", website: null, expectedUpdatedAt: edited.organisation.updatedAt });
    expect(fresh.statusCode, fresh.body).toBe(200);
    expect(organisation(fresh).organisation).toMatchObject({ vatNumber: "GB111111111", website: null });

    // An edit that names no time still lands, and renames the organisation.
    const renamed = await patch(url, "staff", { name: "Kelvin Bridge Association" });
    expect(renamed.statusCode, renamed.body).toBe(200);
    expect(organisation(renamed).organisation.name).toBe("Kelvin Bridge Association");
  });

  it("answers not found for another venue's organisation, a deleted one and a made-up id", async () => {
    const foreign = await f.addOrganisation({ name: "A club elsewhere", kind: "organisation", venueId: f.otherVenueId });
    const deleted = await f.addOrganisation({ name: "Gone household" });
    await f.pool.query("UPDATE client_accounts SET deleted_at = now() WHERE id = $1", [deleted]);
    for (const id of [foreign, deleted, randomUUID()]) {
      for (const [method, payload] of [["GET", undefined], ["PATCH", { website: "intruder.example.test" }]] as const) {
        const res = await send(method, `/people/organisations/${id}`, "staff", payload);
        expect(res.statusCode, `${method} ${id}: ${res.body}`).toBe(404);
        expect(res.json()).toMatchObject({ code: "NOT_FOUND" });
      }
    }
    const { rows } = await f.pool.query<{ website: string | null }>("SELECT website FROM client_accounts WHERE id = $1", [foreign]);
    expect(rows[0]?.website).toBeNull();
  });

  it("lets sales create an organisation", async () => {
    const created = await createOrganisation("sales", { name: "Bearsden Book Group", kind: "organisation" });
    expect(created.organisation.ownerUserId).toBe(f.users.sales);
    const edited = await patch(`/people/organisations/${created.organisation.id}`, "sales", { notes: "Meets on the first Tuesday" });
    expect(edited.statusCode, edited.body).toBe(200);
    expect(organisation(edited).organisation.notes).toBe("Meets on the first Tuesday");
  });
});
