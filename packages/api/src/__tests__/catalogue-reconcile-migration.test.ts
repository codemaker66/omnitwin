import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { CANONICAL_ASSETS } from "@omnitwin/types";
import { describe, expect, it } from "vitest";

// Migration 0073 carries the catalogue as a literal VALUES list, because a
// migration must describe the state it migrates to and cannot import
// TypeScript. That literal is therefore a copy, and a copy drifts: an item
// added to CANONICAL_ASSETS but not to 0073 silently never reaches the
// database, and the planner then offers furniture the API has no identity
// for. This test is the join between them.
//
// It also holds 0072 to its structural promises: it asserts before it
// constrains, and it marks fixtures rather than adding a second status.

async function migration(tag: string): Promise<string> {
  return readFile(resolve("drizzle", `${tag}.sql`), "utf8");
}

interface CatalogueRow {
  readonly id: string;
  readonly name: string;
  readonly category: string;
  readonly widthM: number;
  readonly depthM: number;
  readonly heightM: number;
  readonly seatCount: number | null;
  readonly collisionType: string;
  readonly meshUrl: string | null;
  readonly thumbnailUrl: string | null;
}

/** Split one VALUES tuple, honouring '' inside a quoted literal. */
function splitTuple(body: string): string[] {
  const fields: string[] = [];
  let current = "";
  let quoted = false;
  for (let index = 0; index < body.length; index += 1) {
    const character = body[index];
    if (quoted) {
      if (character === "'" && body[index + 1] === "'") { current += "'"; index += 1; continue; }
      if (character === "'") { quoted = false; continue; }
      current += character ?? "";
      continue;
    }
    if (character === "'") { quoted = true; continue; }
    if (character === ",") { fields.push(current.trim()); current = ""; continue; }
    current += character ?? "";
  }
  fields.push(current.trim());
  return fields;
}

function parseCatalogue(sql: string): CatalogueRow[] {
  const start = sql.indexOf("SELECT * FROM (VALUES");
  const end = sql.indexOf(") AS catalogue(", start);
  expect(start, "0073 must declare its catalogue as a VALUES list").toBeGreaterThan(-1);
  expect(end, "0073's VALUES list must close into the catalogue alias").toBeGreaterThan(start);
  const body = sql.slice(start, end);
  return [...body.matchAll(/^\s+\((.+?)\),?\s*$/gmu)].map((match) => {
    const fields = splitTuple(match[1] ?? "");
    expect(fields, `each row carries ten fields: ${match[1] ?? ""}`).toHaveLength(10);
    const optional = (value: string | undefined): string | null =>
      value === undefined || value === "NULL" ? null : value;
    return {
      id: fields[0] ?? "", name: fields[1] ?? "", category: fields[2] ?? "",
      widthM: Number(fields[3]), depthM: Number(fields[4]), heightM: Number(fields[5]),
      seatCount: fields[6] === "NULL" ? null : Number(fields[6]),
      collisionType: fields[7] ?? "",
      meshUrl: optional(fields[8]), thumbnailUrl: optional(fields[9]),
    };
  });
}

describe("migration 0073 catalogue reconcile", () => {
  it("carries exactly the canonical catalogue, field for field", async () => {
    const rows = parseCatalogue(await migration("0073_catalogue_reconcile"));
    expect(rows).toHaveLength(CANONICAL_ASSETS.length);
    const byId = new Map(rows.map((row) => [row.id, row]));
    for (const asset of CANONICAL_ASSETS) {
      const row = byId.get(asset.id);
      expect(row, `${asset.slug} (${asset.id}) is missing from migration 0073`).toBeDefined();
      expect(row).toEqual({
        id: asset.id, name: asset.name, category: asset.category,
        widthM: asset.widthM, depthM: asset.depthM, heightM: asset.heightM,
        seatCount: asset.seatCount, collisionType: asset.collisionType,
        meshUrl: asset.meshUrl ?? null, thumbnailUrl: asset.thumbnailUrl ?? null,
      });
    }
  });

  it("registers without overwriting and retires without deleting", async () => {
    const sql = await migration("0073_catalogue_reconcile");
    expect(sql).toContain("ON CONFLICT (id) DO NOTHING");
    expect(sql).toContain("CATALOGUE_RECONCILE_CONFLICT");
    // A saved layout, a stock count and an audit receipt all point at these
    // ids; retirement renames, and nothing in this migration removes a row.
    expect(sql).toContain("' (retired)'");
    expect(sql).not.toMatch(/\bDELETE\s+FROM\b/iu);
    expect(sql).not.toMatch(/\bDROP\s+TABLE\b/iu);
    expect(sql).not.toMatch(/\bTRUNCATE\b/iu);
  });
});

describe("migration 0072 vocabulary and marker", () => {
  it("asserts the stored values before it constrains them", async () => {
    const sql = await migration("0072_vocabulary_checks_and_hot_path_indexes");
    for (const failure of ["USERS_ROLE_VOCABULARY", "CONFIGURATIONS_STATE_VOCABULARY",
      "CONFIGURATIONS_REVIEW_STATUS_VOCABULARY", "CONFIGURATIONS_VISIBILITY_VOCABULARY",
      "CONFIGURATIONS_LAYOUT_STYLE_VOCABULARY", "ENQUIRIES_STATE_VOCABULARY"]) {
      expect(sql, `${failure} must be raised by name`).toContain(failure);
    }
    // The assertion block has to precede the constraint block, or a violating
    // row fails with an anonymous constraint error instead of a named one.
    expect(sql.indexOf("$assertions$")).toBeLessThan(sql.indexOf("$vocabulary$"));
  });

  it("adds the four hot-path indexes named in the release plan", async () => {
    const sql = await migration("0072_vocabulary_checks_and_hot_path_indexes");
    expect(sql).toContain('"events_venue_starts_idx" ON "events" ("venue_id", "starts_at")');
    expect(sql).toContain('"events_venue_ends_idx" ON "events" ("venue_id", "ends_at")');
    expect(sql).toContain('"pricing_rules_venue_space_live_idx" ON "pricing_rules" ("venue_id", "space_id")');
    expect(sql).toContain('"placed_objects_asset_definition_idx" ON "placed_objects" ("asset_definition_id")');
  });

  it("marks fixtures with a nullable column, never a second status", async () => {
    const sql = await migration("0072_vocabulary_checks_and_hot_path_indexes");
    for (const table of ["bookings", "events", "enquiries"]) {
      expect(sql).toContain(`ALTER TABLE "${table}" ADD COLUMN IF NOT EXISTS "fixture_source" varchar(40)`);
    }
    expect(sql).not.toMatch(/fixture_source"?\s+varchar\(40\)\s+NOT NULL/iu);
    expect(sql).not.toMatch(/UPDATE\s+"?bookings"?\s+SET/iu);
  });
});
