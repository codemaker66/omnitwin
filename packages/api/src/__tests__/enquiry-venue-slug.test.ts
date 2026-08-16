import { readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { TRADES_HALL_ENQUIRY_VENUE_SLUG, TRADES_HALL_ASSET_SLUG } from "@omnitwin/types";

// ---------------------------------------------------------------------------
// The enquiry anchor invariant.
//
// Trades Hall lives under two slugs — "trades-hall" (asset/twin bundles) and
// "trades-hall-glasgow" (the `venues.slug` row). `POST /public/enquiries`
// checks the twin allowlist FIRST and then looks the slug up in `venues`, so an
// allowlist entry that is not a real row passes the gate and 404s on the
// lookup. That is exactly how walkthrough enquiries were being lost: the client
// sent the asset slug, the gate waved it through, and the venue lookup missed.
//
// No unit test can reach production Postgres, so the seed is the closest
// available proxy for the database's truth. These tests tie the shared constant
// to the seed and forbid the bare asset slug from reappearing as a route
// default. If someone changes the seeded slug without changing the constant,
// this fails — which is the drift mocked-network tests cannot see by
// construction, because they assert on the value the client sends rather than
// on whether that value matches a row.
// ---------------------------------------------------------------------------

const SEED = path.resolve(import.meta.dirname, "../db/seed.ts");
const ENQUIRY_ROUTE = path.resolve(import.meta.dirname, "../routes/public-enquiries.ts");

describe("enquiry venue slug", () => {
  it("matches the venue slug the seed actually inserts", async () => {
    const source = await readFile(SEED, "utf8");
    // The venue insert is the first `slug:` after the `venues` table name.
    const match = /\.insert\(venues\)[\s\S]{0,400}?slug:\s*"([^"]+)"/u.exec(source);
    expect(match, "could not find the seeded venue slug in seed.ts").not.toBeNull();
    expect(match?.[1]).toBe(TRADES_HALL_ENQUIRY_VENUE_SLUG);
  });

  it("keeps the two namespaces distinct", () => {
    // If these ever collapse to one string the invariant is meaningless, and
    // this file should be deleted deliberately rather than quietly passing.
    expect(TRADES_HALL_ENQUIRY_VENUE_SLUG).not.toBe(TRADES_HALL_ASSET_SLUG);
  });

  it("does not default the twin allowlist to a bare string literal", async () => {
    const source = await readFile(ENQUIRY_ROUTE, "utf8");
    // The default must come from the shared constant. A literal here is how the
    // two sides drifted apart in the first place.
    expect(source).toContain(
      'process.env["TWIN_PUBLIC_VENUE_SLUGS"] ?? TRADES_HALL_ENQUIRY_VENUE_SLUG',
    );
    expect(source).not.toMatch(/TWIN_PUBLIC_VENUE_SLUGS"\]\s*\?\?\s*"/u);
  });
});
