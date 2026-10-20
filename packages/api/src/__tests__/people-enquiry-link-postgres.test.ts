import { randomUUID } from "node:crypto";
import type { FastifyBaseLogger, LightMyRequestResponse } from "fastify";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { VENUE_ACCESS_ENQUIRY_TYPE, VENVIEWER_PRICING_ENQUIRY_TYPE } from "@omnitwin/types";
import { crmRoutes } from "../routes/crm.js";
import { publicEnquiryRoutes } from "../routes/public-enquiries.js";
import { linkEnquiryToPerson, type LinkOutcome } from "../services/people-link.js";
import { openPeopleFixture, PLATFORM_TARGET, type PeopleFixture } from "./support/people-platform-fixture.js";

// ---------------------------------------------------------------------------
// A public enquiry finds its person, or makes one (T-665, Task 9).
//
// Every website enquiry is public: the guest is not signed in and can be
// anyone. Inside the enquiry's own transaction, locked on the venue and the
// normalised email, it links to the venue's one live person who holds that
// email, makes one when nobody does, and links neither when two people share
// it (a couple, the wedding norm). The guest's answer is the same whichever
// happened. The guest lead is written once and never overwritten.
//
// The email service and the in-app notice are mocked, as in
// public-enquiry-venue-slug-postgres.test.ts; nothing here claims more about
// them than that the route ran past them.
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

/** Every line the route logs, as it was logged. */
const logged: unknown[][] = [];
function record(...args: unknown[]): void { logged.push(args); }
const capturedLog: FastifyBaseLogger = {
  level: "info",
  fatal: record, error: record, warn: record, info: record, debug: record, trace: record, silent: record,
  child: () => capturedLog,
};

const THE_ANSWER = "Your enquiry has been sent to the events team";

describe.skipIf(PLATFORM_TARGET === undefined)("a public enquiry and the People Book on the migrated disposable database", () => {
  let f: PeopleFixture;
  // Guest leads are not venue-scoped, so a lead's email is this run's own.
  const run = randomUUID().slice(0, 8);
  // The venue path's opt-in gate reads this; it names the fixture's venues
  // (their slug is their id) and is restored afterwards.
  const savedTwinSlugs = process.env["TWIN_PUBLIC_VENUE_SLUGS"];

  beforeAll(async () => {
    f = await openPeopleFixture(async (server, db) => {
      server.addHook("onRequest", (request, _reply, done) => { request.log = capturedLog; done(); });
      await server.register(publicEnquiryRoutes, { db, prefix: "/public" });
      // Create opportunity, which works an enquiry a colleague has chosen.
      await server.register(crmRoutes, { db, prefix: "/crm" });
    });
    process.env["TWIN_PUBLIC_VENUE_SLUGS"] = `${f.venueId},${f.otherVenueId}`;
    await f.pool.query(
      `INSERT INTO spaces (venue_id, name, slug, width_m, length_m, height_m, floor_plan_outline)
       VALUES ($1, 'The Saloon', 'saloon', 10, 10, 3, '[]'), ($2, 'The Saloon', 'saloon', 10, 10, 3, '[]')`,
      [f.venueId, f.otherVenueId],
    );
  }, 120_000);

  afterAll(async () => {
    if (savedTwinSlugs === undefined) delete process.env["TWIN_PUBLIC_VENUE_SLUGS"];
    else process.env["TWIN_PUBLIC_VENUE_SLUGS"] = savedTwinSlugs;
    await f?.close();
  });

  /** What the website's enquiry form posts, at one of the fixture's venues. */
  function enquire(venueId: string, guest: Record<string, unknown>): Promise<LightMyRequestResponse> {
    return f.server.inject({
      method: "POST", url: "/public/enquiries",
      payload: { venueSlug: venueId, source: "website", eventType: "wedding", eventDate: "2027-06-12", guestCount: 90, ...guest },
    });
  }

  function enquiryIdOf(res: LightMyRequestResponse): string {
    expect(res.statusCode, res.body).toBe(201);
    return res.json<{ data: { enquiryId: string } }>().data.enquiryId;
  }

  async function personOf(enquiryId: string): Promise<string | null> {
    const { rows } = await f.pool.query<{ contact_id: string | null }>("SELECT contact_id FROM enquiries WHERE id = $1", [enquiryId]);
    const row = rows[0];
    if (row === undefined) throw new Error("No such enquiry");
    return row.contact_id;
  }

  /** The live people at a venue who hold an email, however it was typed. */
  async function holders(venueId: string, email: string): Promise<string[]> {
    const { rows } = await f.pool.query<{ id: string }>(
      `SELECT DISTINCT c.id FROM contacts c
         JOIN contact_points p ON p.contact_id = c.id AND p.venue_id = c.venue_id
        WHERE c.venue_id = $1 AND p.kind = 'email' AND p.value = people_normalise_email($2)
          AND c.deleted_at IS NULL AND c.merged_into_id IS NULL AND c.erased_at IS NULL
        ORDER BY c.id`,
      [venueId, email],
    );
    return rows.map((row) => row.id);
  }

  async function peopleAt(venueId: string): Promise<number> {
    const { rows } = await f.pool.query<{ count: number }>("SELECT count(*)::int AS count FROM contacts WHERE venue_id = $1", [venueId]);
    return rows[0]?.count ?? -1;
  }

  async function lastContactOf(personId: string): Promise<Date | null> {
    const { rows } = await f.pool.query<{ last_contact_at: Date | null }>("SELECT last_contact_at FROM contacts WHERE id = $1", [personId]);
    const row = rows[0];
    if (row === undefined) throw new Error("No such person");
    return row.last_contact_at;
  }

  /**
   * Enquiries that really overlap: a third connection holds the lock the
   * route takes for this venue and email while the enquiries start, and lets
   * go only once every one of them is waiting on it, so none can look for its
   * person before the others have stored their enquiry. Answers with what each
   * waiting session was running when they all waited together.
   */
  async function enquireWhileEmailHeld(
    lockKey: string,
    sends: () => readonly Promise<LightMyRequestResponse>[],
  ): Promise<{ responses: LightMyRequestResponse[]; waiting: string[] }> {
    const holder = await f.pool.connect();
    let inFlight: readonly Promise<LightMyRequestResponse>[] = [];
    let waiting: string[] = [];
    try {
      await holder.query("BEGIN");
      await holder.query("SELECT pg_advisory_xact_lock(hashtextextended($1, 0))", [lockKey]);
      inFlight = sends();
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
        if (attempt >= 200) throw new Error("The enquiries never met the held lock");
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

  it("makes a person for a new email, with their phone, and links the enquiry", async () => {
    const enquiryId = enquiryIdOf(await enquire(f.venueId, { email: "kirsty@example.test", name: "Kirsty Lane", phone: "0141 496 0001" }));

    const found = await holders(f.venueId, "kirsty@example.test");
    expect(found).toHaveLength(1);
    const person = found[0];
    const { rows } = await f.pool.query<{
      name: string; email: string | null; phone: string | null; owner_user_id: string | null;
      source_enquiry_id: string | null; last_contact_at: Date | null;
    }>("SELECT name, email, phone, owner_user_id, source_enquiry_id, last_contact_at FROM contacts WHERE id = $1", [person]);
    expect(rows[0]).toMatchObject({
      name: "Kirsty Lane", email: "kirsty@example.test", phone: "0141 496 0001", owner_user_id: null, source_enquiry_id: enquiryId,
    });
    expect(rows[0]?.last_contact_at).toBeInstanceOf(Date);

    const points = await f.pool.query<{ kind: string; value: string; display_value: string; is_primary: boolean }>(
      "SELECT kind, value, display_value, is_primary FROM contact_points WHERE contact_id = $1 ORDER BY kind", [person],
    );
    expect(points.rows).toEqual([
      { kind: "email", value: "kirsty@example.test", display_value: "kirsty@example.test", is_primary: true },
      { kind: "phone", value: "01414960001", display_value: "0141 496 0001", is_primary: true },
    ]);
    expect(await personOf(enquiryId)).toBe(person);
  });

  /** The person's phone mirror and phone points, as stored. */
  async function phoneOf(personId: string): Promise<{ phone: string | null; points: number }> {
    const { rows } = await f.pool.query<{ phone: string | null; points: number }>(
      `SELECT phone, (SELECT count(*)::int FROM contact_points p WHERE p.contact_id = c.id AND p.kind = 'phone') AS points
         FROM contacts c WHERE id = $1`,
      [personId],
    );
    const row = rows[0];
    if (row === undefined) throw new Error("No such person");
    return row;
  }

  // The phone ruling in 0098 (no phone rule in the pre-deploy window) relies
  // on these two: the People Book itself never writes a blank phone.
  it("keeps no phone for a guest whose phone is only spaces", async () => {
    const enquiryId = enquiryIdOf(await enquire(f.venueId, { email: `spaces.phone.${run}@example.test`, name: "Ishbel Grant", phone: "   " }));
    const person = await personOf(enquiryId);
    if (person === null) throw new Error("The enquiry made no person");
    expect(await phoneOf(person)).toEqual({ phone: null, points: 0 });
  });

  it("keeps no phone when Create opportunity works an enquiry whose phone is blank", async () => {
    const email = `blank.phone.${run}@example.test`;
    // As an older writer may have stored it: the enquiry's phone is "".
    const { rows } = await f.pool.query<{ id: string }>(
      `INSERT INTO enquiries (venue_id, space_id, guest_email, guest_name, guest_phone, name, email, state, event_type)
       SELECT $1, s.id, $2::text, 'Lachlan Reid', '', 'Lachlan Reid', $2::text, 'submitted', 'wedding' FROM spaces s WHERE s.venue_id = $1
       LIMIT 1 RETURNING id`,
      [f.venueId, email],
    );
    const enquiryId = rows[0]?.id;
    if (enquiryId === undefined) throw new Error("No enquiry was stored");

    const res = await f.server.inject({ method: "POST", url: `/crm/from-enquiry/${enquiryId}`, headers: f.bearer("staff") });
    expect(res.statusCode, res.body).toBe(201);
    const person = await personOf(enquiryId);
    if (person === null) throw new Error("Create opportunity linked no person");
    expect(await phoneOf(person)).toEqual({ phone: null, points: 0 });
  });

  // Review Focus 2.
  it("links a returning guest who types their email differently, and makes nobody new", async () => {
    const aileen = await f.addPerson({ name: "Aileen Murray", emails: ["aileen.murray@example.test"], phones: ["07700 900123"] });
    const people = await peopleAt(f.venueId);

    const enquiryId = enquiryIdOf(await enquire(f.venueId, {
      email: " Aileen.Murray@Example.TEST ", name: "Aileen Murray", phone: "07700 900456",
    }));

    expect(await personOf(enquiryId)).toBe(aileen);
    expect(await peopleAt(f.venueId)).toBe(people);
    expect(await lastContactOf(aileen)).toBeInstanceOf(Date);
    // Linking writes no point: the phone she typed this time is the enquiry's.
    const points = await f.pool.query<{ kind: string; value: string }>(
      "SELECT kind, value FROM contact_points WHERE contact_id = $1 ORDER BY kind", [aileen],
    );
    expect(points.rows).toEqual([{ kind: "email", value: "aileen.murray@example.test" }, { kind: "phone", value: "07700900123" }]);
  });

  // Review Focus 3.
  it("links neither of two people who share an email, and makes no third", async () => {
    const morag = await f.addPerson({ name: "Morag Baird", emails: ["couple@example.test"] });
    const iain = await f.addPerson({ name: "Iain Baird", emails: ["Couple@Example.test"] });
    const people = await peopleAt(f.venueId);

    const enquiryId = enquiryIdOf(await enquire(f.venueId, { email: "couple@example.test", name: "Morag and Iain Baird" }));

    expect(await personOf(enquiryId)).toBeNull();
    expect(await peopleAt(f.venueId)).toBe(people);
    expect(await holders(f.venueId, "couple@example.test")).toEqual([morag, iain].sort());
    // Nothing was written to either of them.
    expect(await lastContactOf(morag)).toBeNull();
    expect(await lastContactOf(iain)).toBeNull();
  });

  it("keeps a separate person at each venue for one email", async () => {
    const atA = enquiryIdOf(await enquire(f.venueId, { email: "rhona.kerr@example.test", name: "Rhona Kerr" }));
    const atB = enquiryIdOf(await enquire(f.otherVenueId, { email: "rhona.kerr@example.test", name: "Rhona Kerr" }));

    const [a, ...moreA] = await holders(f.venueId, "rhona.kerr@example.test");
    const [b, ...moreB] = await holders(f.otherVenueId, "rhona.kerr@example.test");
    expect(moreA).toEqual([]);
    expect(moreB).toEqual([]);
    expect(a).toBeDefined();
    expect(b).toBeDefined();
    expect(a).not.toBe(b);
    expect(await personOf(atA)).toBe(a);
    expect(await personOf(atB)).toBe(b);
  });

  it("makes one person when the same new email arrives twice at once", async () => {
    const email = "twice@example.test";
    const { responses, waiting } = await enquireWhileEmailHeld(`people-email:${f.venueId}:${email}`, () => [
      enquire(f.venueId, { email, name: "Isla Grant" }),
      enquire(f.venueId, { email, name: "Isla Grant", message: "Sent again by a double click." }),
    ]);
    // Both had stored their enquiry and were waiting on the lock at the same
    // moment: the two really overlapped.
    expect(waiting).toHaveLength(2);
    for (const query of waiting) expect(query).toContain("pg_advisory_xact_lock");

    const [one, two] = responses;
    if (one === undefined || two === undefined) throw new Error("Expected two answers");
    const first = enquiryIdOf(one);
    const second = enquiryIdOf(two);
    const found = await holders(f.venueId, email);
    expect(found).toHaveLength(1);
    expect(await personOf(first)).toBe(found[0]);
    expect(await personOf(second)).toBe(found[0]);
  }, 30_000);

  it("answers every guest alike, whoever they turn out to be", async () => {
    const known = await f.addPerson({ name: "Callum Reid", emails: ["callum.reid@example.test"] });
    await f.addPerson({ name: "Eilidh Shaw", emails: ["shaws@example.test"] });
    await f.addPerson({ name: "Ruaridh Shaw", emails: ["shaws@example.test"] });

    const created = await enquire(f.venueId, { email: "ailsa.ross@example.test", name: "Ailsa Ross" });
    const linked = await enquire(f.venueId, { email: "callum.reid@example.test", name: "Callum Reid" });
    const shared = await enquire(f.venueId, { email: "shaws@example.test", name: "The Shaws" });

    const answers = [created, linked, shared].map((res) => {
      expect(res.statusCode, res.body).toBe(201);
      return { body: res.json<{ data: Record<string, unknown> }>(), type: res.headers["content-type"] };
    });
    for (const { body } of answers) {
      expect(Object.keys(body)).toEqual(["data"]);
      expect(Object.keys(body.data).sort()).toEqual(["enquiryId", "message"]);
      expect(body.data["message"]).toBe(THE_ANSWER);
    }
    expect(new Set(answers.map(({ type }) => type)).size).toBe(1);

    // And the three really were a new person, a known one and a shared email.
    const madeFor = await personOf(enquiryIdOf(created));
    expect(madeFor).not.toBeNull();
    expect(madeFor).not.toBe(known);
    expect(await personOf(enquiryIdOf(linked))).toBe(known);
    expect(await personOf(enquiryIdOf(shared))).toBeNull();
  });

  it("logs each outcome by its ids alone, never the guest's email, name or phone", async () => {
    await f.addPerson({ name: "Fiona Black", emails: ["fiona.black@example.test"] });
    await f.addPerson({ name: "Duncan Black", emails: ["blacks@example.test"] });
    await f.addPerson({ name: "Shona Black", emails: ["blacks@example.test"] });
    logged.length = 0;

    const created = enquiryIdOf(await enquire(f.venueId, { email: "gregor.black@example.test", name: "Gregor Black", phone: "07700 900321" }));
    const linked = enquiryIdOf(await enquire(f.venueId, { email: "fiona.black@example.test", name: "Fiona Black" }));
    const shared = enquiryIdOf(await enquire(f.venueId, { email: "blacks@example.test", name: "The Blacks" }));

    const outcomes = logged
      .map(([first]) => first)
      .filter((entry): entry is Record<string, unknown> =>
        typeof entry === "object" && entry !== null && (entry as Record<string, unknown>)["event"] === "enquiry.person_linked");
    expect(outcomes).toEqual([
      { event: "enquiry.person_linked", enquiryId: created, venueId: f.venueId, outcome: "created" },
      { event: "enquiry.person_linked", enquiryId: linked, venueId: f.venueId, outcome: "linked" },
      { event: "enquiry.person_linked", enquiryId: shared, venueId: f.venueId, outcome: "ambiguous" },
    ]);
    const everything = JSON.stringify(logged).toLowerCase();
    for (const personal of ["gregor", "fiona", "blacks@", "example.test", "07700"]) expect(everything).not.toContain(personal);
  });

  it("leaves an access request and a Venviewer pricing enquiry out of the book", async () => {
    const people = await peopleAt(f.venueId);

    const access = enquiryIdOf(await enquire(f.venueId, {
      email: "let-me-in@example.test", eventType: VENUE_ACCESS_ENQUIRY_TYPE, message: "Venue access request from let-me-in@example.test.",
    }));
    const pricing = enquiryIdOf(await enquire(f.venueId, {
      email: "operations@other-venue.invalid", eventType: VENVIEWER_PRICING_ENQUIRY_TYPE, message: "We let three rooms and a courtyard.",
    }));

    expect(await personOf(access)).toBeNull();
    expect(await personOf(pricing)).toBeNull();
    expect(await holders(f.venueId, "let-me-in@example.test")).toEqual([]);
    expect(await holders(f.venueId, "operations@other-venue.invalid")).toEqual([]);
    expect(await peopleAt(f.venueId)).toBe(people);
  });

  /** Whether another connection could lock the person this moment: "held"
   *  when someone holds their row. */
  async function rowLockOn(personId: string): Promise<"free" | "held"> {
    const probe = await f.pool.connect();
    try {
      await probe.query("BEGIN");
      await probe.query("SELECT id FROM contacts WHERE id = $1 FOR UPDATE NOWAIT", [personId]);
      return "free";
    } catch (error) {
      // lock_not_available
      if (error instanceof Error && "code" in error && error.code === "55P03") return "held";
      throw error;
    } finally {
      await probe.query("ROLLBACK");
      probe.release();
    }
  }

  /** Waits until some session waits on a lock the given backend holds. */
  async function waitUntilBlockedBy(pid: number): Promise<void> {
    for (let attempt = 0; attempt < 200; attempt += 1) {
      const { rows } = await f.pool.query<{ waiting: number }>(
        "SELECT count(*)::int AS waiting FROM pg_stat_activity WHERE $1 = ANY(pg_blocking_pids(pid))",
        [pid],
      );
      if ((rows[0]?.waiting ?? 0) > 0) return;
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
    throw new Error("Nothing ever waited on the held row");
  }

  it("looks again, keeping no lock, when the one holder is merged away between the look and the lock", async () => {
    const email = `rhona.begg-${run}@example.test`;
    const holder = await f.addPerson({ name: "Rhona Begg", emails: [email] });
    const survivor = await f.addPerson({ name: "Rhona Begg", emails: [`r.begg-${run}@example.test`] });
    const { rows: [made] } = await f.pool.query<{ id: string }>(
      `INSERT INTO enquiries (venue_id, space_id, name, email, state)
       SELECT $1, id, 'Rhona Begg', $2, 'submitted' FROM spaces WHERE venue_id = $1 LIMIT 1 RETURNING id`,
      [f.venueId, email],
    );
    if (made === undefined) throw new Error("No enquiry was made");

    // A merge of the holder into the survivor, written by hand, holds the
    // holder's row while the link looks.
    const merger = await f.pool.connect();
    let linking: Promise<{ outcome: LinkOutcome; tombstone: "free" | "held"; survivor: "free" | "held" }> | undefined;
    try {
      await merger.query("BEGIN");
      await merger.query("SELECT id FROM contacts WHERE id = $1 FOR UPDATE", [holder]);
      const { rows: [me] } = await merger.query<{ pid: number }>("SELECT pg_backend_pid() AS pid");
      if (me === undefined) throw new Error("No backend pid");
      linking = f.db.transaction(async (tx) => {
        const outcome = await linkEnquiryToPerson(tx, {
          id: made.id, venueId: f.venueId, contactId: null, email, name: "Rhona Begg", phone: null,
        }, { ownerUserId: null, whenShared: "leave" });
        // Still inside the link's transaction.
        return { outcome, tombstone: await rowLockOn(holder), survivor: await rowLockOn(survivor) };
      });
      // ... until the link has looked, found the holder live and waits on them;
      await waitUntilBlockedBy(me.pid);
      // ... then moves their email to the survivor and closes them, as a merge does.
      await merger.query("UPDATE contact_points SET contact_id = $2, is_primary = false WHERE contact_id = $1", [holder, survivor]);
      await merger.query("UPDATE contacts SET merged_into_id = $2, deleted_at = now(), email = NULL WHERE id = $1", [holder, survivor]);
      await merger.query("COMMIT");
    } catch (error) {
      await merger.query("ROLLBACK");
      throw error;
    } finally {
      merger.release();
    }
    if (linking === undefined) throw new Error("The link never started");

    const result = await linking;
    expect(result.outcome).toEqual({ outcome: "linked", contactId: survivor });
    // The survivor is held; the tombstone it found merged is not, so the two
    // were never held together out of ascending id order.
    expect(result.survivor).toBe("held");
    expect(result.tombstone).toBe("free");
    expect(await personOf(made.id)).toBe(survivor);
  });

  it("writes a guest lead once and never overwrites it from another venue", async () => {
    const email = `kirsty.lane-${run}@example.test`;
    const first = enquiryIdOf(await enquire(f.venueId, { email, name: "Kirsty Lane", phone: "0141 496 0001" }));
    enquiryIdOf(await enquire(f.otherVenueId, { email, name: "Somebody Else", phone: "07700 900999" }));

    const { rows } = await f.pool.query<{ name: string | null; phone: string | null; first_enquiry_id: string | null }>(
      "SELECT name, phone, first_enquiry_id FROM guest_leads WHERE email = $1", [email],
    );
    expect(rows).toEqual([{ name: "Kirsty Lane", phone: "0141 496 0001", first_enquiry_id: first }]);
  });
});
