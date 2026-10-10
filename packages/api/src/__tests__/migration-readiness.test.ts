import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  BUNDLED_JOURNAL_URL,
  loadBundledJournal,
  pendingMigrations,
  readMigrationReadiness,
  type JournalEntry,
} from "../db/migration-readiness.js";

// T-653 — Railway rebuilds the API on the master push while the Deploy
// workflow applies migrations only after CI, so on 9 October the new API ran
// eleven minutes ahead of 0087. /health/ready now compares the journal the
// image ships with drizzle.__drizzle_migrations; these are the pure parts.

const journal: readonly JournalEntry[] = [
  { tag: "0085_proposal_templates", when: 1791212400000 },
  { tag: "0086_venue_location", when: 1791298800000 },
  { tag: "0087_living_timetable_conversations", when: 1791385200000 },
];

describe("pendingMigrations", () => {
  it("is empty when the database has recorded every journal timestamp", () => {
    expect(pendingMigrations(journal, ["1791212400000", "1791298800000", "1791385200000"])).toEqual([]);
  });

  it("names the journal entries the database has not recorded, in journal order", () => {
    const pending = pendingMigrations(journal, ["1791212400000"]);
    expect(pending.map((entry) => entry.tag)).toEqual([
      "0086_venue_location",
      "0087_living_timetable_conversations",
    ]);
  });

  it("ignores applied rows this image does not know (an older image after a newer migration)", () => {
    const applied = ["1791212400000", "1791298800000", "1791385200000", "1791471600000"];
    expect(pendingMigrations(journal, applied)).toEqual([]);
  });

  it("reports every entry pending against an empty migrations table", () => {
    expect(pendingMigrations(journal, []).map((entry) => entry.tag)).toHaveLength(3);
  });
});

describe("loadBundledJournal", () => {
  it("reads drizzle/meta/_journal.json next to the package and keeps its order", async () => {
    const journalPath = fileURLToPath(new URL("../../drizzle/meta/_journal.json", import.meta.url));
    const raw = JSON.parse(await readFile(journalPath, "utf8")) as { entries: { tag: string; when: number }[] };
    const entries = await loadBundledJournal();
    expect(entries.map((entry) => entry.tag)).toEqual(raw.entries.map((entry) => entry.tag));
    expect(entries.map((entry) => entry.when)).toEqual(raw.entries.map((entry) => entry.when));
    expect(entries.length).toBeGreaterThan(80);
    // The route resolves the same file, from src/db in development and from
    // dist/db in the image; both sit two levels under packages/api.
    expect(fileURLToPath(BUNDLED_JOURNAL_URL)).toBe(journalPath);
  });
});

describe("readMigrationReadiness", () => {
  function store(rows: readonly { created_at: string }[]) {
    return { execute: () => Promise.resolve({ rows: rows.map((row) => ({ ...row })) }) };
  }

  it("counts applied and bundled migrations and names the pending tags", async () => {
    const readiness = await readMigrationReadiness(store([{ created_at: "1791212400000" }, { created_at: "1791298800000" }]), journal);
    expect(readiness).toEqual({ applied: 2, local: 3, pendingTags: ["0087_living_timetable_conversations"] });
  });

  it("treats a database without the migrations table as entirely unmigrated", async () => {
    const missing = { execute: () => Promise.reject(Object.assign(new Error('relation "drizzle.__drizzle_migrations" does not exist'), { code: "42P01" })) };
    const readiness = await readMigrationReadiness(missing, journal);
    expect(readiness).toEqual({ applied: 0, local: 3, pendingTags: journal.map((entry) => entry.tag) });
  });

  it("lets any other database error through, so the probe reports it rather than guessing", async () => {
    const broken = { execute: () => Promise.reject(Object.assign(new Error("terminating connection"), { code: "57P01" })) };
    await expect(readMigrationReadiness(broken, journal)).rejects.toThrow("terminating connection");
  });
});
