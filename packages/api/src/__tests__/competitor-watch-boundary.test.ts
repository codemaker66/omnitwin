import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { z } from "zod";
import { describe, expect, it } from "vitest";
import { watchRefusal } from "../routes/competitor-watch.js";
import { migrationText, tagEndingWith } from "./migration-text.js";

// ---------------------------------------------------------------------------
// The competitor watch's boundaries, read from the code itself:
//   - the suggestion maths never reads a competitor's figure (CMA guidance on
//     pricing algorithms; the Competition Act 1998, Chapter I);
//   - the page check can never write a capture or keep a page;
//   - the migration is journaled, venue-bound and append-only.
// The behaviour behind each, and the screenshot's upload scope, is proven on
// PostgreSQL in
// competitor-watch-postgres.test.ts, including identical suggestions with
// and without captures.
// ---------------------------------------------------------------------------

const WATCH_NAMES = [
  "competitor-watch-data",
  "competitor-watch",
  "page-check",
  "competitor-prices",
  "competitorVenues",
  "competitorPriceCaptures",
  "competitorPageChecks",
  "competitorLosses",
  "competitor_price_captures",
  "competitor_venues",
  "competitor_losses",
];

/** The code without its comments, which may name the rule they keep. */
function code(text: string): string {
  return text.replace(/\/\*[\s\S]*?\*\//gu, "").replace(/(^|[^:"'`])\/\/.*$/gmu, "$1");
}

describe("the suggestion maths", () => {
  it("reads nothing of the competitor watch", async () => {
    for (const file of ["src/services/pricing-advice.ts", "src/services/pricing-desk-data.ts", "src/routes/pricing-desk.ts"]) {
      const text = code(await readFile(resolve(file), "utf8"));
      for (const name of WATCH_NAMES) expect(text.includes(name), `${file} must not name ${name}`).toBe(false);
    }
  });
});

describe("the page check", () => {
  it("never writes a capture and never keeps the page", async () => {
    const check = await readFile(resolve("src/services/page-check.ts"), "utf8");
    expect(check).not.toMatch(/competitorPriceCaptures|competitor_price_captures|insert\(|writeFile/u);
    const data = await readFile(resolve("src/services/competitor-watch-data.ts"), "utf8");
    const pass = data.slice(data.indexOf("export async function runPageChecks"));
    expect(pass).not.toContain("competitorPriceCaptures");
    // What a check stores: the hash, the date, the status, what robots.txt said.
    expect(pass).toMatch(/contentHash: answer\.hash/u);
    expect(pass).not.toMatch(/\.body\b/u);
  });
});

describe("migration 0095", () => {
  it("is journaled after 0090 with a later timestamp", async () => {
    const journal = z.object({ entries: z.array(z.object({ tag: z.string(), when: z.number() })) })
      .parse(JSON.parse(await readFile(resolve("drizzle", "meta", "_journal.json"), "utf8")));
    const tag = await tagEndingWith("_competitor_watch");
    const entry = journal.entries.find((candidate) => candidate.tag === tag);
    const previous = journal.entries.find((candidate) => candidate.tag === "0090_booking_event_bind");
    expect(entry?.when ?? 0).toBeGreaterThan(previous?.when ?? Number.MAX_SAFE_INTEGER);
  });

  it("binds every child to its venue and keeps captures append-only", async () => {
    const sql = await migrationText("_competitor_watch");
    expect(sql).toContain(`UNIQUE ("id", "venue_id")`);
    for (const table of ["competitor_price_captures", "competitor_page_checks", "competitor_losses"]) {
      expect(sql).toContain(`ALTER TABLE "${table}" ADD CONSTRAINT "${table}_competitor_venue"`);
    }
    expect(sql).toMatch(/FOREIGN KEY \("competitor_id", "venue_id"\) REFERENCES "competitor_venues"\("id", "venue_id"\)/u);
    expect(sql).toMatch(/BEFORE UPDATE OR DELETE ON "competitor_price_captures"/u);
    expect(sql).toContain("SET LOCAL lock_timeout");
  });
});

describe("a refusal", () => {
  it("names who keeps the watch", () => {
    expect(watchRefusal()).toBe("The competitor watch is kept by an administrator or a manager at the venue, beside the price list. Ask them.");
  });
});
