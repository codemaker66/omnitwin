import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { countDuplicateSuggestions, duplicateSuggestions } from "../services/people-duplicates.js";
import { openPeopleFixture, PLATFORM_TARGET, type PeopleFixture } from "./support/people-platform-fixture.js";

// ---------------------------------------------------------------------------
// Duplicate suggestions on the migrated disposable database (T-665, Task 5).
//
// The People Book never merges people by itself. It suggests two people who
// share an email or a phone, or whose names are close within one
// organisation, and a person can settle a suggestion by marking the pair as
// two people. Only real rows under pg_trgm show which names are close, and
// only real tombstones show that a mark holds through merges and lapses when
// they are undone.
//
// Opt-in, disposable PostgreSQL only. Never consults DATABASE_URL or .env.
// ---------------------------------------------------------------------------

describe.skipIf(PLATFORM_TARGET === undefined)("duplicate suggestions on the migrated disposable database", () => {
  let f: PeopleFixture;
  beforeAll(async () => { f = await openPeopleFixture(() => Promise.resolve()); }, 120_000);
  afterAll(async () => { await f?.close(); });

  async function ids(personId: string): Promise<Set<string>> {
    return new Set((await duplicateSuggestions(f.db, f.venueId, personId)).map((suggestion) => suggestion.person.id));
  }

  /** A merge or an undo, by SQL, as Task 11 will write it: both columns together. */
  async function mergeInto(mergedId: string, survivorId: string | null): Promise<void> {
    await f.pool.query(
      `UPDATE contacts SET merged_into_id = $2, deleted_at = CASE WHEN $2::uuid IS NULL THEN NULL ELSE now() END
        WHERE id = $1 AND venue_id = $3`,
      [mergedId, survivorId, f.venueId],
    );
  }

  it("suggests two people who hold one email, each to the other", async () => {
    const a = await f.addPerson({ name: "Aileen Murray", emails: ["dup1@example.test"] });
    const b = await f.addPerson({ name: "A Murray", emails: [" DUP1@Example.test "] });
    expect(await duplicateSuggestions(f.db, f.venueId, a)).toEqual([{ person: { id: b, name: "A Murray", organisationName: null }, reasons: ["shared_email"] }]);
    expect(await countDuplicateSuggestions(f.db, f.venueId, b)).toBe(1);
  });

  it("suggests two people who hold one phone, however it was typed", async () => {
    const a = await f.addPerson({ name: "Morag Campbell", phones: ["+44 7700 900101"] });
    const b = await f.addPerson({ name: "Fergus Lindsay", phones: ["07700 900 101"] });
    expect(await duplicateSuggestions(f.db, f.venueId, a)).toEqual([{ person: { id: b, name: "Fergus Lindsay", organisationName: null }, reasons: ["shared_phone"] }]);
    expect(await duplicateSuggestions(f.db, f.venueId, b)).toEqual([{ person: { id: a, name: "Morag Campbell", organisationName: null }, reasons: ["shared_phone"] }]);
  });

  it("names every reason a pair shares, in a fixed order", async () => {
    const a = await f.addPerson({ name: "Catriona Baird", emails: ["dup3@example.test"], phones: ["0141 496 0301"] });
    const b = await f.addPerson({ name: "C Baird", emails: ["dup3@example.test"], phones: ["+44 141 496 0301"] });
    // Only the email: fewer reasons, so after b though its name sorts first.
    const c = await f.addPerson({ name: "Baird office", emails: ["DUP3@example.test"] });
    expect(await duplicateSuggestions(f.db, f.venueId, a)).toEqual([
      { person: { id: b, name: "C Baird", organisationName: null }, reasons: ["shared_email", "shared_phone"] },
      { person: { id: c, name: "Baird office", organisationName: null }, reasons: ["shared_email"] },
    ]);
  });

  it("suggests a close name within one organisation", async () => {
    const household = await f.addOrganisation({ name: "Murray household", kind: "household" });
    const a = await f.addPerson({ name: "Aileen Murray", organisations: [household] });
    const b = await f.addPerson({ name: "Aileen Murrey", organisations: [household] });
    expect(await duplicateSuggestions(f.db, f.venueId, a)).toEqual([{ person: { id: b, name: "Aileen Murrey", organisationName: "Murray household" }, reasons: ["close_name"] }]);
    expect(await countDuplicateSuggestions(f.db, f.venueId, b)).toBe(1);
  });

  it("does not suggest a couple whose names share only a surname", async () => {
    const household = await f.addOrganisation({ name: "Henderson household", kind: "household" });
    const a = await f.addPerson({ name: "Ailsa Henderson", organisations: [household] });
    const b = await f.addPerson({ name: "Iain Henderson", organisations: [household] });
    expect(await duplicateSuggestions(f.db, f.venueId, a)).toEqual([]);
    expect(await countDuplicateSuggestions(f.db, f.venueId, b)).toBe(0);
  });

  it("does not suggest close names in different organisations", async () => {
    const one = await f.addOrganisation({ name: "Kelvin Rowing Club", kind: "organisation" });
    const two = await f.addOrganisation({ name: "Clyde Choir", kind: "organisation" });
    const a = await f.addPerson({ name: "Euan Macleod", organisations: [one] });
    const b = await f.addPerson({ name: "Euan MacLeod", organisations: [two] });
    expect(await duplicateSuggestions(f.db, f.venueId, a)).toEqual([]);
    expect(await duplicateSuggestions(f.db, f.venueId, b)).toEqual([]);
  });

  it("leaves out merged, deleted and erased people, and other venues", async () => {
    const email = "gone@example.test";
    const a = await f.addPerson({ name: "Isla Grant", emails: [email] });
    const survivor = await f.addPerson({ name: "Isla G Grant", emails: ["survivor@example.test"] });
    const merged = await f.addPerson({ name: "Isla Grant (old)", emails: [email] });
    const deleted = await f.addPerson({ name: "I Grant", emails: [email] });
    const erased = await f.addPerson({ name: "Erased person", emails: [email] });
    await f.addPerson({ name: "Isla Grant", venueId: f.otherVenueId, emails: [email] });
    await mergeInto(merged, survivor);
    await f.pool.query("UPDATE contacts SET deleted_at = now() WHERE id = $1", [deleted]);
    await f.pool.query("UPDATE contacts SET erased_at = now() WHERE id = $1", [erased]);
    expect(await duplicateSuggestions(f.db, f.venueId, a)).toEqual([]);
    expect(await countDuplicateSuggestions(f.db, f.venueId, a)).toBe(0);
  });

  it("leaves out a pair someone has marked as two people, from either side", async () => {
    const a = await f.addPerson({ name: "Rhona Stewart", emails: ["apart1@example.test"] });
    const b = await f.addPerson({ name: "Neil Stewart", emails: ["apart1@example.test"] });
    await f.keepApart(b, a);
    expect(await duplicateSuggestions(f.db, f.venueId, a)).toEqual([]);
    expect(await duplicateSuggestions(f.db, f.venueId, b)).toEqual([]);
    expect(await countDuplicateSuggestions(f.db, f.venueId, a)).toBe(0);
    expect(await countDuplicateSuggestions(f.db, f.venueId, b)).toBe(0);
  });

  it("suggests them again once the mark is withdrawn", async () => {
    const a = await f.addPerson({ name: "Shona Reid", emails: ["apart2@example.test"] });
    const b = await f.addPerson({ name: "Callum Reid", emails: ["apart2@example.test"] });
    await f.keepApart(a, b, { withdrawn: true });
    expect(await duplicateSuggestions(f.db, f.venueId, a)).toEqual([{ person: { id: b, name: "Callum Reid", organisationName: null }, reasons: ["shared_email"] }]);
    expect(await duplicateSuggestions(f.db, f.venueId, b)).toEqual([{ person: { id: a, name: "Shona Reid", organisationName: null }, reasons: ["shared_email"] }]);
  });

  it("holds the mark through merges into other records, and lets it go when they are undone", async () => {
    const email = "hendersons@example.test";
    const a = await f.addPerson({ name: "Ailsa Henderson", emails: [email] });
    const b = await f.addPerson({ name: "Iain Henderson", emails: [email] });
    const c = await f.addPerson({ name: "I Henderson", emails: [email] });
    const d = await f.addPerson({ name: "Iain H", emails: [email] });
    await f.keepApart(a, b);
    expect(await ids(a)).toEqual(new Set([c, d]));

    await mergeInto(b, c);
    expect(await ids(a)).toEqual(new Set([d]));
    // From the other side too: c now speaks for b, whom a is kept apart from.
    expect(await ids(c)).toEqual(new Set([d]));

    // Two hops: b's tombstone still points at c, now itself a tombstone of d.
    await mergeInto(c, d);
    expect(await ids(a)).toEqual(new Set());
    expect(await ids(d)).toEqual(new Set());

    await mergeInto(c, null);
    await mergeInto(b, null);
    expect(await ids(a)).toEqual(new Set([c, d]));
    expect(await ids(b)).toEqual(new Set([c, d]));
  });
});
