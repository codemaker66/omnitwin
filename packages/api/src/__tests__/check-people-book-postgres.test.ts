import { randomUUID } from "node:crypto";
import { Pool } from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  VENUE_ACCESS_ENQUIRY_TYPE,
  VENVIEWER_PRICING_ENQUIRY_TYPE,
  normaliseEmail,
  normalisePhone,
} from "@omnitwin/types";
import type { Database } from "../db/client.js";
import * as schema from "../db/schema.js";
import { checkPeopleBook, type PeopleBookCheck } from "../scripts/check-people-book.js";

// ---------------------------------------------------------------------------
// The People Book's read-only check on the migrated platform database (T-665).
//
// check-people-book.ts is what an operator runs once against a database after
// migration 0096 has run: every mirror equals its primary point or
// membership, every person has one primary of each kind they hold, and no
// enquiry names another venue's person. Each test writes its own two venues by
// SQL, as the backfill or a later write would leave them, breaks one rule,
// and reads the counts scoped to those venues, so other files' rows never
// disturb them. Every row it writes is removed afterwards.
//
// Opt-in, disposable PostgreSQL only. Never consults DATABASE_URL or .env.
// ---------------------------------------------------------------------------

const target = process.env["VENVIEWER_PLATFORM_TEST_DATABASE_URL"];
if (target !== undefined) {
  const parsed = new URL(target);
  if (parsed.protocol !== "postgresql:" || parsed.hostname !== "127.0.0.1" || parsed.port !== "55477"
    || parsed.pathname !== "/venviewer_platform_test" || parsed.search || parsed.hash) {
    throw new Error("The People Book check's tests require the explicit disposable platform database");
  }
}

interface Fixture {
  readonly venueId: string;
  readonly otherVenueId: string;
  readonly roomId: string;
  readonly otherRoomId: string;
  /** Email and phone, both primary points. */
  readonly ailsa: string;
  readonly ailsaEmail: string;
  /** The primary member of a household named after him. */
  readonly ruaridh: string;
  readonly ruaridhEmail: string;
  readonly householdId: string;
  /** At the other venue. */
  readonly morag: string;
  readonly moragEmail: string;
}

interface PersonInput {
  readonly name: string;
  readonly email?: string;
  readonly phone?: string;
  readonly accountId?: string;
  readonly deleted?: boolean;
}

interface EnquiryInput {
  readonly email: string;
  readonly venueId?: string;
  readonly contactId?: string;
  readonly state?: string;
  readonly eventType?: string;
  readonly fixtureSource?: string;
}

const ZERO = { mirrorMismatches: 0, primaryViolations: 0, crossVenueLinks: 0 } as const;

describe.skipIf(target === undefined)("the People Book's read-only check on the platform database", () => {
  let pool: Pool;
  let db: Database;
  const venues: string[] = [];

  beforeAll(async () => {
    if (target === undefined) throw new Error("Explicit test database required");
    pool = new Pool({ connectionString: target, application_name: `people_check_${randomUUID()}`, max: 4,
      options: "-c statement_timeout=30000 -c lock_timeout=20000" });
    expect((await pool.query<{ name: string }>("SELECT current_database() AS name")).rows[0]?.name)
      .toBe("venviewer_platform_test");
    db = drizzle(pool, { schema });
  });

  afterAll(async () => {
    if (pool === undefined) return;
    try {
      if (venues.length > 0) {
        // Only this file's venues, children first; points and memberships go with their person.
        for (const statement of [
          "DELETE FROM enquiries WHERE venue_id = ANY($1::uuid[])",
          "DELETE FROM contact_kept_apart WHERE venue_id = ANY($1::uuid[])",
          "DELETE FROM contacts WHERE venue_id = ANY($1::uuid[])",
          "DELETE FROM client_accounts WHERE venue_id = ANY($1::uuid[])",
          "DELETE FROM spaces WHERE venue_id = ANY($1::uuid[])",
          "DELETE FROM venues WHERE id = ANY($1::uuid[])",
        ]) await pool.query(statement, [venues]);
      }
    } finally {
      await pool.end();
    }
  });

  async function room(venueId: string): Promise<string> {
    const rows = await pool.query<{ id: string }>(
      "INSERT INTO spaces (venue_id, name, slug, width_m, length_m, height_m, floor_plan_outline) VALUES ($1, 'Room', $2, 10, 10, 3, '[]') RETURNING id",
      [venueId, `people-check-room-${venueId}`],
    );
    const id = rows.rows[0]?.id;
    if (id === undefined) throw new Error("no room");
    return id;
  }

  /** A person as the People Book writes one: mirrors equal to their primary points and membership. */
  async function person(venueId: string, input: PersonInput): Promise<string> {
    const id = randomUUID();
    await pool.query(
      "INSERT INTO contacts (id, venue_id, client_account_id, name, email, phone, deleted_at) VALUES ($1, $2, $3, $4, $5, $6, $7)",
      [id, venueId, input.accountId ?? null, input.name, input.email ?? null, input.phone ?? null, input.deleted === true ? new Date() : null],
    );
    const points: { kind: string; value: string | null; display: string }[] = [];
    if (input.email !== undefined) points.push({ kind: "email", value: normaliseEmail(input.email), display: input.email });
    if (input.phone !== undefined) points.push({ kind: "phone", value: normalisePhone(input.phone), display: input.phone });
    for (const point of points) {
      await pool.query(
        "INSERT INTO contact_points (venue_id, contact_id, kind, value, display_value, is_primary) VALUES ($1, $2, $3, $4, $5, true)",
        [venueId, id, point.kind, point.value, point.display],
      );
    }
    if (input.accountId !== undefined) {
      await pool.query(
        "INSERT INTO account_memberships (venue_id, contact_id, client_account_id, is_primary) VALUES ($1, $2, $3, true)",
        [venueId, id, input.accountId],
      );
    }
    return id;
  }

  async function fixture(): Promise<Fixture> {
    const venueId = randomUUID();
    const otherVenueId = randomUUID();
    venues.push(venueId, otherVenueId);
    await db.insert(schema.venues).values([
      { id: venueId, name: "TEST ONLY People check", slug: `people-check-${venueId}`, address: "Disposable fixture" },
      { id: otherVenueId, name: "TEST ONLY People check, another venue", slug: `people-check-${otherVenueId}`, address: "Disposable fixture" },
    ]);
    const tag = venueId.slice(0, 8);
    const ailsaEmail = `Ailsa.${tag}@people-check.example.test`;
    const ruaridhEmail = `ruaridh.${tag}@people-check.example.test`;
    const moragEmail = `morag.${tag}@people-check.example.test`;
    const householdId = randomUUID();
    await pool.query(
      "INSERT INTO client_accounts (id, venue_id, name, kind) VALUES ($1, $2, 'Ruaridh Fixture', 'household')",
      [householdId, venueId],
    );
    const ruaridh = await person(venueId, { name: "Ruaridh Fixture", email: ruaridhEmail, accountId: householdId });
    await pool.query("UPDATE client_accounts SET primary_contact_id = $1 WHERE id = $2", [ruaridh, householdId]);
    return {
      venueId,
      otherVenueId,
      roomId: await room(venueId),
      otherRoomId: await room(otherVenueId),
      ailsa: await person(venueId, { name: "Ailsa Fixture", email: ailsaEmail, phone: "0141 496 0123" }),
      ailsaEmail,
      ruaridh,
      ruaridhEmail,
      householdId,
      morag: await person(otherVenueId, { name: "Morag Fixture", email: moragEmail }),
      moragEmail,
    };
  }

  async function enquiry(f: Fixture, input: EnquiryInput): Promise<string> {
    const id = randomUUID();
    const venueId = input.venueId ?? f.venueId;
    await pool.query(
      `INSERT INTO enquiries (id, venue_id, space_id, name, email, guest_email, guest_name, state, event_type, fixture_source, contact_id)
       VALUES ($1, $2, $3, 'Fixture Enquirer', $4::text, $4::text, 'Fixture Enquirer', $5, $6, $7, $8)`,
      [id, venueId, venueId === f.venueId ? f.roomId : f.otherRoomId, input.email, input.state ?? "submitted",
        input.eventType ?? null, input.fixtureSource ?? null, input.contactId ?? null],
    );
    return id;
  }

  const check = (f: Fixture): Promise<PeopleBookCheck> => checkPeopleBook(db, [f.venueId, f.otherVenueId]);

  it("reports nothing wrong on a fresh venue with two people, one with an email and a phone and one in a household", async () => {
    const f = await fixture();
    await enquiry(f, { email: f.ailsaEmail, contactId: f.ailsa });
    expect(await check(f)).toEqual({
      mustBeZero: ZERO,
      counts: {
        livePeople: 3, peopleWithoutPoints: 0, contactPoints: 4, memberships: 1, households: 1, organisations: 0,
        linkedEnquiries: 1, unlinkedEnquiries: 0, unlinkedWithOneHolder: 0, sharedEmails: 0, keptApartMarks: 0,
      },
    });
  });

  it("counts a live person whose email, phone or organisation differs from their primary point or membership", async () => {
    const f = await fixture();
    await pool.query("UPDATE contacts SET email = $1 WHERE id = $2", [`changed.${f.venueId}@people-check.example.test`, f.ailsa]);
    expect((await check(f)).mustBeZero).toEqual({ ...ZERO, mirrorMismatches: 1 });
    await pool.query("UPDATE contacts SET email = $1, phone = '07700 900111' WHERE id = $2", [f.ailsaEmail, f.ailsa]);
    expect((await check(f)).mustBeZero).toEqual({ ...ZERO, mirrorMismatches: 1 });
    await pool.query("UPDATE contacts SET phone = '0141 496 0123' WHERE id = $1", [f.ailsa]);
    await pool.query("UPDATE contacts SET client_account_id = NULL WHERE id = $1", [f.ruaridh]);
    expect((await check(f)).mustBeZero).toEqual({ ...ZERO, mirrorMismatches: 1 });
    await pool.query("UPDATE contacts SET client_account_id = $1 WHERE id = $2", [f.householdId, f.ruaridh]);
    expect((await check(f)).mustBeZero).toEqual(ZERO);
    // A deleted person is no longer anyone's mirror to keep.
    await pool.query("UPDATE contacts SET email = 'gone@people-check.example.test', deleted_at = now() WHERE id = $1", [f.ailsa]);
    expect(await check(f)).toMatchObject({ mustBeZero: ZERO, counts: { livePeople: 2 } });
  });

  it("counts a person with points or memberships but no primary of them", async () => {
    const f = await fixture();
    await pool.query("UPDATE contact_points SET is_primary = false WHERE contact_id = $1 AND kind = 'phone'", [f.ailsa]);
    await pool.query("UPDATE account_memberships SET is_primary = false WHERE contact_id = $1", [f.ruaridh]);
    // With no primary, each mirror also no longer has a source to equal.
    expect((await check(f)).mustBeZero).toEqual({ mirrorMismatches: 2, primaryViolations: 2, crossVenueLinks: 0 });
  });

  it("counts an enquiry linked to another venue's person", async () => {
    const f = await fixture();
    await enquiry(f, { email: f.moragEmail, contactId: f.morag });
    expect(await check(f)).toMatchObject({ mustBeZero: { ...ZERO, crossVenueLinks: 1 }, counts: { linkedEnquiries: 1 } });
  });

  it("counts an email two live people hold once, and not one a deleted person shares", async () => {
    const f = await fixture();
    await person(f.venueId, { name: "Ailsa Fixture-Twin", email: f.ailsaEmail.toUpperCase() });
    await person(f.venueId, { name: "Ruaridh Gone", email: f.ruaridhEmail, deleted: true });
    expect(await check(f)).toMatchObject({ mustBeZero: ZERO, counts: { livePeople: 4, sharedEmails: 1 } });
  });

  it("counts an unlinked client enquiry whose email exactly one live person holds, and no other enquiry", async () => {
    const f = await fixture();
    // Typed with other capitals and spaces, and never linked: the one to count.
    await enquiry(f, { email: `  ${f.ailsaEmail.toUpperCase()} ` });
    // Not the venue's clients, so never linked and never counted.
    await enquiry(f, { email: f.ailsaEmail, fixtureSource: "demo-seed" });
    await enquiry(f, { email: f.ailsaEmail, state: "draft" });
    await enquiry(f, { email: f.ailsaEmail, eventType: VENUE_ACCESS_ENQUIRY_TYPE });
    await enquiry(f, { email: f.ailsaEmail, eventType: VENVIEWER_PRICING_ENQUIRY_TYPE });
    // Morag holds this email at the other venue only: no one here holds it.
    await enquiry(f, { email: f.moragEmail });
    expect(await check(f)).toMatchObject({
      mustBeZero: ZERO,
      counts: { linkedEnquiries: 0, unlinkedEnquiries: 2, unlinkedWithOneHolder: 1 },
    });
    // Once a second live person holds it, nothing can be linked by email.
    await person(f.venueId, { name: "Ailsa Fixture-Twin", email: f.ailsaEmail });
    expect(await check(f)).toMatchObject({ counts: { unlinkedWithOneHolder: 0, sharedEmails: 1 } });
  });

  it("counts a person the previous release wrote, with an email and no points, as residue rather than a fault", async () => {
    const f = await fixture();
    await pool.query("INSERT INTO contacts (venue_id, name, email) VALUES ($1, 'Previous Release', $2)",
      [f.venueId, `previous.${f.venueId}@people-check.example.test`]);
    await pool.query("INSERT INTO contacts (venue_id, name) VALUES ($1, 'No Email Or Phone')", [f.venueId]);
    expect(await check(f)).toMatchObject({ mustBeZero: ZERO, counts: { livePeople: 5, peopleWithoutPoints: 1 } });
  });

  it("counts the kept-apart marks still standing, not the withdrawn ones", async () => {
    const f = await fixture();
    const [low, high] = [f.ailsa, f.ruaridh].sort();
    await pool.query(
      "INSERT INTO contact_kept_apart (venue_id, low_contact_id, high_contact_id, withdrawn_at) VALUES ($1, $2, $3, now()), ($1, $2, $3, NULL)",
      [f.venueId, low, high],
    );
    expect(await check(f)).toMatchObject({ mustBeZero: ZERO, counts: { keptApartMarks: 1 } });
  });
});
