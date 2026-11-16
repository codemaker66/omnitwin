import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import type { SQL } from "drizzle-orm";
import { PgDialect } from "drizzle-orm/pg-core";
import { describe, expect, it } from "vitest";
import {
  CLOSED_ENQUIRY_STATES,
  NON_BOOKING_ENQUIRY_TYPES,
  OPEN_OPPORTUNITY_STAGES,
  SENT_PROPOSAL_STATUSES,
} from "@omnitwin/types";
import {
  JS_WHITESPACE,
  readSpineInvariant,
  spineInvariantHolds,
  type SpineInvariant,
} from "../services/event-spine-invariant.js";

// ---------------------------------------------------------------------------
// The spine's count (readSpineInvariant) without a database: it reads the
// nine numbers it is given and nothing else, refuses an answer it cannot read
// rather than reporting zero, and takes the definition's sets from
// @omnitwin/types as values. Its whitespace is exactly what JavaScript's
// trim() removes, and exactly the join's own (js_whitespace in migration
// *_event_spine_links). The counting itself is proven on PostgreSQL in
// event-spine-invariant-postgres.test.ts.
// ---------------------------------------------------------------------------

const DRIZZLE = resolve(import.meta.dirname, "../../drizzle");
const VENUE = "00000000-0000-4000-8000-000000000001";

const COLUMNS = [
  "proposals_without_event",
  "agreements_without_event",
  "deposit_requests_without_event",
  "open_deals_without_event",
  "worked_enquiries_without_event",
  "events_with_two_open_deals",
  "disagreeing_links",
  "links_to_closed_events",
  "event_deal_pointers_in_use",
] as const;

const ALL_ZERO: SpineInvariant = {
  proposalsWithoutEvent: 0,
  agreementsWithoutEvent: 0,
  depositRequestsWithoutEvent: 0,
  openDealsWithoutEvent: 0,
  workedEnquiriesWithoutEvent: 0,
  eventsWithTwoOpenDeals: 0,
  disagreeingLinks: 0,
  linksToClosedEvents: 0,
  eventDealPointersInUse: 0,
};

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

/** A row of the nine columns, each the given value, with any overrides. */
function row(value: unknown, overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return { ...Object.fromEntries(COLUMNS.map((column) => [column, value])), ...overrides };
}

/** The characters of an E'' string literal, its escapes decoded. */
function decodeEscapes(literal: string): string {
  const named: Record<string, string> = { t: "\t", n: "\n", f: "\f", r: "\r" };
  return literal.replace(/\\(u[0-9A-Fa-f]{4}|x[0-9A-Fa-f]{2}|[tnfr])/gu, (_match, escape: string) => {
    if (escape.startsWith("u") || escape.startsWith("x")) return String.fromCodePoint(Number.parseInt(escape.slice(1), 16));
    const character = named[escape];
    if (character === undefined) throw new Error(`Unknown escape \\${escape}`);
    return character;
  });
}

/** Its UTF-16 code units, in order (every character here is in the Basic Multilingual Plane). */
const sortedCodes = (text: string): number[] =>
  Array.from({ length: text.length }, (_unit, index) => text.charCodeAt(index)).sort((x, y) => x - y);

describe("readSpineInvariant", () => {
  it("reads the nine counts as numbers, scoped to a venue when one is named", async () => {
    const conn = reader([row("0", { open_deals_without_event: "3", links_to_closed_events: 2 })]);
    expect(await readSpineInvariant(conn, VENUE)).toEqual({ ...ALL_ZERO, openDealsWithoutEvent: 3, linksToClosedEvents: 2 });
    expect(conn.seen).toHaveLength(1);
    const query = dialect.sqlToQuery(conn.seen[0] as SQL);
    expect(query.params).toContain(VENUE);
    expect(query.sql).toContain("venue_id = $");
  });

  it("passes the definition's sets and JavaScript's whitespace as values, never retyped", async () => {
    const conn = reader([row("0")]);
    await readSpineInvariant(conn, VENUE);
    const query = dialect.sqlToQuery(conn.seen[0] as SQL);
    for (const value of [...OPEN_OPPORTUNITY_STAGES, ...SENT_PROPOSAL_STATUSES, ...CLOSED_ENQUIRY_STATES,
      ...NON_BOOKING_ENQUIRY_TYPES, JS_WHITESPACE]) {
      expect(query.params).toContain(value);
    }
    for (const value of [...OPEN_OPPORTUNITY_STAGES, ...SENT_PROPOSAL_STATUSES, ...CLOSED_ENQUIRY_STATES, ...NON_BOOKING_ENQUIRY_TYPES]) {
      expect(query.sql).not.toContain(`'${value}'`);
    }
  });

  it("reads the whole database when no venue is named", async () => {
    const conn = reader([row(0)]);
    expect(await readSpineInvariant(conn)).toEqual(ALL_ZERO);
    expect(dialect.sqlToQuery(conn.seen[0] as SQL).sql).not.toContain("venue_id = $");
  });

  it("refuses an answer it cannot read rather than reporting zero", async () => {
    await expect(readSpineInvariant(reader([]))).rejects.toThrow("The spine invariant returned no proposal without event count");
    await expect(readSpineInvariant(reader([row("0", { links_to_closed_events: undefined })])))
      .rejects.toThrow("The spine invariant returned no link to a closed event count");
    await expect(readSpineInvariant(reader([row("0", { open_deals_without_event: "-1" })])))
      .rejects.toThrow("The spine invariant returned no open deal without event count");
    await expect(readSpineInvariant(reader([row("0", { disagreeing_links: "many" })])))
      .rejects.toThrow("The spine invariant returned no disagreeing link count");
    await expect(readSpineInvariant(reader([row("0", { event_deal_pointers_in_use: 1.5 })])))
      .rejects.toThrow("The spine invariant returned no event deal pointer count");
  });
});

describe("spineInvariantHolds", () => {
  it("holds only when every one of the nine numbers is zero", () => {
    expect(spineInvariantHolds(ALL_ZERO)).toBe(true);
    for (const field of Object.keys(ALL_ZERO) as (keyof SpineInvariant)[]) {
      expect([field, spineInvariantHolds({ ...ALL_ZERO, [field]: 1 })]).toEqual([field, false]);
    }
  });
});

describe("JS_WHITESPACE", () => {
  it("is exactly what JavaScript's trim() removes, as isBookingEnquiry trims", () => {
    const trimmed: number[] = [];
    for (let code = 0; code <= 0xffff; code += 1) {
      if (String.fromCharCode(code).trim() === "") trimmed.push(code);
    }
    expect(sortedCodes(JS_WHITESPACE)).toEqual(trimmed);
    expect(new Set(JS_WHITESPACE).size).toBe(JS_WHITESPACE.length);
  });

  it("is the join's own js_whitespace, character for character", async () => {
    const journal = await readFile(resolve(DRIZZLE, "meta/_journal.json"), "utf8");
    const tag = (JSON.parse(journal) as { entries: { tag: string }[] }).entries.find((entry) => entry.tag.endsWith("_event_spine_links"))?.tag;
    if (tag === undefined) throw new Error("No *_event_spine_links migration in the journal");
    const source = await readFile(resolve(DRIZZLE, `${tag}.sql`), "utf8");
    const literal = /js_whitespace CONSTANT text := E'([^']*)';/u.exec(source)?.[1];
    if (literal === undefined) throw new Error("The join declares no js_whitespace");
    expect(sortedCodes(decodeEscapes(literal))).toEqual(sortedCodes(JS_WHITESPACE));
  });
});
