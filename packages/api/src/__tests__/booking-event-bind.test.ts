import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { getTableName, type SQL } from "drizzle-orm";
import { PgDialect, getTableConfig } from "drizzle-orm/pg-core";
import { describe, expect, it } from "vitest";
import {
  DEFAULT_EVENT_PHASE_TEMPLATE,
  EVENT_BOUND_BOOKING_KINDS,
  EVENT_CONFIRMED_STATUSES,
  EVENT_PIPELINE_STATUSES,
  EVENT_STATUSES,
} from "@omnitwin/types";
import { bookings, eventBindingReviews, events } from "../db/schema.js";
import { readBindInvariant } from "../services/event-binding.js";

// ---------------------------------------------------------------------------
// The bind (migration 0090) without a database: the migration's SQL, the
// Drizzle schema and @omnitwin/types say the same thing, and the invariant
// reader reads what it is given and nothing else. The behaviour itself is
// proven on PostgreSQL in booking-event-bind-postgres.test.ts.
// ---------------------------------------------------------------------------

const DRIZZLE = resolve(import.meta.dirname, "../../drizzle");
const TAG = "0090_booking_event_bind";

async function migration(): Promise<string> {
  return readFile(resolve(DRIZZLE, `${TAG}.sql`), "utf8");
}

/** The SQL with its comments taken out, whitespace folded. */
function code(source: string): string {
  return source.replace(/--[^\n]*/gu, " ").replace(/\s+/gu, " ");
}

function quotedList(values: readonly string[]): string {
  return values.map((value) => `'${value}'`).join(", ");
}

describe("migration 0090", () => {
  it("is the journal's next entry, after 0089", async () => {
    const journal = JSON.parse(await readFile(resolve(DRIZZLE, "meta/_journal.json"), "utf8")) as {
      entries: { idx: number; when: number; tag: string }[];
    };
    const index = journal.entries.findIndex((entry) => entry.tag === TAG);
    const entry = journal.entries[index];
    const previous = journal.entries[index - 1];
    expect(index).toBe(journal.entries.length - 1);
    expect(previous?.tag).toBe("0089_pricing_rule_windows");
    expect(entry?.idx).toBe((previous?.idx ?? -2) + 1);
    expect(entry?.when).toBeGreaterThan(previous?.when ?? Number.POSITIVE_INFINITY);
  });

  it("adds the rule, the RESTRICT keys and 'lost' exactly as the types state them", async () => {
    const sql = code(await migration());
    expect(sql).toContain(`ADD CONSTRAINT "bookings_bound_to_event" CHECK ("kind" NOT IN (${quotedList(EVENT_BOUND_BOOKING_KINDS)}) OR "event_id" IS NOT NULL)`);
    expect(sql).toContain('ADD CONSTRAINT "bookings_event_id_fkey" FOREIGN KEY ("event_id") REFERENCES "events"("id") ON DELETE RESTRICT');
    expect(sql).toContain('ADD CONSTRAINT "bookings_event_venue_fk" FOREIGN KEY ("event_id", "venue_id") REFERENCES "events"("id", "venue_id") ON DELETE RESTRICT');
    expect(sql).toContain(`CHECK ("status" IN (${quotedList(EVENT_STATUSES)}))`);
    // The derivation table in SQL keeps the same sets as deriveEventStatus.
    expect(sql).toContain(`WHEN "before" IN (${quotedList(EVENT_CONFIRMED_STATUSES)}) THEN "before"`);
    expect(sql).toContain(`WHEN "live_option" THEN CASE WHEN "before" IN (${quotedList(EVENT_PIPELINE_STATUSES)}) THEN "before" ELSE 'draft' END`);
    // A lock it cannot have soon fails the deployment rather than queueing
    // the Diary's writes behind it; the limit is put back afterwards.
    expect(sql).toContain("SET LOCAL lock_timeout = '5s'");
    expect(sql.trim().endsWith("SET LOCAL lock_timeout TO DEFAULT;")).toBe(true);
  });

  it("gives every new event the house's default phases, as POST /events does", async () => {
    const sql = await migration();
    const tuples = [...sql.matchAll(/\('([a-z-]+)', '([^']+)', (\d+), (\d+)\)/gu)].map((match) => ({
      key: match[1], label: match[2], sortOrder: Number(match[3]), minutes: Number(match[4]),
    }));
    expect(tuples).toEqual(DEFAULT_EVENT_PHASE_TEMPLATE.map((entry, sortOrder) => ({
      key: entry.key, label: entry.label, sortOrder, minutes: entry.defaultDurationMinutes,
    })));
  });

  it("removes nothing: no row, table or column goes, but its own scratch tables", async () => {
    const sql = code(await migration());
    expect(sql).not.toMatch(/\bDELETE\s+FROM\b/iu);
    expect(sql).not.toMatch(/\bTRUNCATE\b/iu);
    expect(sql).not.toMatch(/\bDROP\s+COLUMN\b/iu);
    const drops = [...sql.matchAll(/\bDROP\s+TABLE\s+(?:IF\s+EXISTS\s+)?([^\s;]+)/giu)].map((match) => match[1]);
    expect(new Set(drops)).toEqual(new Set(['pg_temp."bind_0090"', 'pg_temp."bind_0090_events"']));
    // Every existing status the derivation changes goes on the review list.
    expect(sql).toContain("'event_status_derived'");
    expect(sql).toContain('"previous_status"');
  });
});

describe("the Drizzle schema matches 0090", () => {
  it("declares the rule, the RESTRICT keys and the review list", () => {
    const config = getTableConfig(bookings);
    expect(config.checks.map((check) => check.name)).toContain("bookings_bound_to_event");
    const toEvents = config.foreignKeys.filter((key) => getTableName(key.reference().foreignTable) === getTableName(events));
    expect(toEvents).toHaveLength(2);
    expect(toEvents.map((key) => key.onDelete)).toEqual(["restrict", "restrict"]);
    expect(getTableName(eventBindingReviews)).toBe("event_binding_reviews");
    expect(getTableConfig(eventBindingReviews).checks.map((check) => check.name)).toEqual(["event_binding_reviews_reason_check"]);
  });
});

describe("readBindInvariant", () => {
  const dialect = new PgDialect();

  function reader(rows: readonly Record<string, unknown>[]) {
    const seen: SQL[] = [];
    return {
      seen,
      execute: (query: SQL) => {
        seen.push(query);
        return Promise.resolve({ rows });
      },
    };
  }

  it("reads both counts, scoped to a venue when one is named", async () => {
    const conn = reader([{ unbound_bookings: "0", contradicting_events: "2" }]);
    expect(await readBindInvariant(conn, "00000000-0000-4000-8000-000000000001")).toEqual({ unboundBookings: 0, contradictingEvents: 2 });
    const query = dialect.sqlToQuery(conn.seen[0] as SQL);
    expect(query.params).toContain("00000000-0000-4000-8000-000000000001");
    // The status sets are the types' own, passed as values, never retyped.
    for (const status of [...EVENT_CONFIRMED_STATUSES, ...EVENT_PIPELINE_STATUSES, ...EVENT_BOUND_BOOKING_KINDS]) {
      expect(query.params).toContain(status);
    }
  });

  it("reads the whole database when no venue is named", async () => {
    const conn = reader([{ unbound_bookings: 0, contradicting_events: 0 }]);
    expect(await readBindInvariant(conn)).toEqual({ unboundBookings: 0, contradictingEvents: 0 });
    expect(dialect.sqlToQuery(conn.seen[0] as SQL).sql).not.toContain("venue_id = $");
  });

  it("refuses an answer it cannot read rather than reporting zero", async () => {
    await expect(readBindInvariant(reader([]))).rejects.toThrow("no unbound booking count");
    await expect(readBindInvariant(reader([{ unbound_bookings: "-1", contradicting_events: "0" }]))).rejects.toThrow();
    await expect(readBindInvariant(reader([{ unbound_bookings: "0", contradicting_events: "many" }]))).rejects.toThrow();
  });
});
