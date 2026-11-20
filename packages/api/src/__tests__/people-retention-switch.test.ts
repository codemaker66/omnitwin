import { describe, expect, it } from "vitest";
import type { Database } from "../db/client.js";
import {
  describePeopleRetentionStart,
  eraseLapsedPeople,
  PEOPLE_RETENTION_START_VARIABLE,
  PeopleRetentionError,
  peopleRetentionSwitch,
} from "../services/people-retention.js";

// ---------------------------------------------------------------------------
// The 24-month pass's switch (Blake, 18 Nov 2026: "Merge with the pass off
// until you pick a date"). A real run reads PEOPLE_RETENTION_STARTS_ON and,
// while it is off, returns before touching the database. The stub database
// below refuses every call and counts them: a run that reached it was on.
// ---------------------------------------------------------------------------

/** A database that records each call and refuses it. */
function refusingDatabase(): { readonly db: Database; readonly reached: () => number } {
  let calls = 0;
  const refuse = (): never => {
    calls += 1;
    throw new Error("sentinel: the pass reached the database");
  };
  const db = new Proxy({} as Database, { get: () => refuse });
  return { db, reached: () => calls };
}

/** Runs with the variable set to the value (or unset), then puts it back. */
async function withStartsOn<T>(value: string | undefined, run: () => Promise<T>): Promise<T> {
  const before = process.env[PEOPLE_RETENTION_START_VARIABLE];
  if (value === undefined) Reflect.deleteProperty(process.env, PEOPLE_RETENTION_START_VARIABLE);
  else process.env[PEOPLE_RETENTION_START_VARIABLE] = value;
  try {
    return await run();
  } finally {
    if (before === undefined) Reflect.deleteProperty(process.env, PEOPLE_RETENTION_START_VARIABLE);
    else process.env[PEOPLE_RETENTION_START_VARIABLE] = before;
  }
}

const now = new Date("2027-06-01T02:00:00.000Z");

describe("the 24-month pass's switch, read from PEOPLE_RETENTION_STARTS_ON", () => {
  it("turns the pass on from a first day that has come: the run reaches the database", async () => {
    const stub = refusingDatabase();
    await withStartsOn("2027-06-01", async () => {
      await expect(eraseLapsedPeople(stub.db, { now })).rejects.toBeInstanceOf(PeopleRetentionError);
    });
    expect(stub.reached()).toBeGreaterThan(0);
  });

  it("keeps it off, reading nothing, while the first day is unset, ahead, or not a real date", async () => {
    for (const value of [undefined, "", "2027-06-02", "soon", "2027-6-1", "2027-02-30"]) {
      const stub = refusingDatabase();
      const result = await withStartsOn(value, () => eraseLapsedPeople(stub.db, { now }));
      expect(result, String(value)).toMatchObject({ off: true, people: 0, enquiries: 0, deferred: { people: 0, enquiries: 0 } });
      expect(stub.reached(), String(value)).toBe(0);
    }
  });

  it("starts at 00:00 UTC on the first day: on at that instant, off a millisecond before", async () => {
    const at = refusingDatabase();
    await withStartsOn("2027-06-01", async () => {
      await expect(eraseLapsedPeople(at.db, { now: new Date("2027-06-01T00:00:00.000Z") })).rejects.toBeInstanceOf(PeopleRetentionError);
    });
    expect(at.reached()).toBeGreaterThan(0);
    const before = refusingDatabase();
    const result = await withStartsOn("2027-06-01", () => eraseLapsedPeople(before.db, { now: new Date("2027-05-31T23:59:59.999Z") }));
    expect(result).toMatchObject({ off: true });
    expect(before.reached()).toBe(0);
  });

  it("keeps it off for an invalid date given by hand, the reversible direction", async () => {
    for (const startsOn of [new Date("nonsense"), null]) {
      const stub = refusingDatabase();
      expect(await eraseLapsedPeople(stub.db, { now, startsOn })).toMatchObject({ off: true });
      expect(stub.reached()).toBe(0);
    }
    const stub = refusingDatabase();
    expect(await eraseLapsedPeople(stub.db, { now: new Date("nonsense"), startsOn: new Date("2027-01-01T00:00:00.000Z") }))
      .toMatchObject({ off: true });
    expect(stub.reached()).toBe(0);
  });

  it("never stops the rehearsal, which counts what a real run would do", async () => {
    const stub = refusingDatabase();
    await withStartsOn(undefined, async () => {
      await expect(eraseLapsedPeople(stub.db, { now, dryRun: true })).rejects.toBeInstanceOf(PeopleRetentionError);
    });
    expect(stub.reached()).toBeGreaterThan(0);
  });

  it("says which way it is off, or the day it starts", () => {
    expect(describePeopleRetentionStart(undefined)).toBe("PEOPLE_RETENTION_STARTS_ON is unset");
    expect(describePeopleRetentionStart(" ")).toBe("PEOPLE_RETENTION_STARTS_ON is unset");
    expect(describePeopleRetentionStart("2027-6-1")).toBe("PEOPLE_RETENTION_STARTS_ON is not a real YYYY-MM-DD date");
    expect(describePeopleRetentionStart("2027-02-30")).toBe("PEOPLE_RETENTION_STARTS_ON is not a real YYYY-MM-DD date");
    expect(describePeopleRetentionStart("2027-06-01", new Date("2027-05-31T23:59:59.999Z"))).toBe("it starts on 2027-06-01 at 00:00 UTC");
    expect(describePeopleRetentionStart("2027-06-01", new Date("2027-06-01T00:00:00.000Z"))).toBe("it has been on since 2027-06-01 at 00:00 UTC");
  });

  it("gives its state: the first day, whether a real run then erases, and why", () => {
    expect(peopleRetentionSwitch(undefined, now)).toEqual({ startsOn: null, on: false, reason: "PEOPLE_RETENTION_STARTS_ON is unset" });
    expect(peopleRetentionSwitch("2027-06-02", now)).toEqual({ startsOn: "2027-06-02", on: false, reason: "it starts on 2027-06-02 at 00:00 UTC" });
    expect(peopleRetentionSwitch("2027-06-01", now))
      .toEqual({ startsOn: "2027-06-01", on: true, reason: "it has been on since 2027-06-01 at 00:00 UTC" });
  });
});
