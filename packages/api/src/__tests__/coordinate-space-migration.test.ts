import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { getTableColumns } from "drizzle-orm";
import {
  configurationLayoutRevisions,
  configurationSheetSnapshots,
  phaseLayoutSnapshots,
  placedObjects,
  proposalVersions,
} from "../db/schema.js";

const migration = readFileSync(
  fileURLToPath(new URL("../../drizzle/0044_placed_objects_render_to_real.sql", import.meta.url)),
  "utf8",
);
const authenticatedWrites = readFileSync(
  fileURLToPath(new URL("../routes/placed-objects.ts", import.meta.url)),
  "utf8",
);
const publicWrites = readFileSync(
  fileURLToPath(new URL("../routes/public-configs.ts", import.meta.url)),
  "utf8",
);
const websocketWrites = readFileSync(
  fileURLToPath(new URL("../ws/auto-save.ts", import.meta.url)),
  "utf8",
);

describe("migration 0044 coordinate-space contract", () => {
  it("serializes the live transform with every coordinate-bearing artifact writer", () => {
    expect(migration).toContain("LOCK TABLE");
    expect(migration).toContain('"placed_objects"');
    expect(migration).toContain('"configuration_layout_revisions"');
    expect(migration).toContain('"configuration_sheet_snapshots"');
    expect(migration).toContain('"proposal_versions"');
    expect(migration).toContain('"phase_layout_snapshots"');
    expect(migration).toContain("IN ACCESS EXCLUSIVE MODE");
  });

  it("transforms only legacy live rows and leaves immutable JSON payloads unchanged", () => {
    expect(migration).toContain('WHERE "coordinate_space" = \'legacy_render_v0\'');
    expect(migration).toContain('"position_x" = "position_x" / 2');
    expect(migration).toContain('"position_z" = "position_z" / 2');
    expect(migration).toContain('"coordinate_write_token" = COALESCE');
    expect(migration).not.toMatch(/UPDATE\s+"configuration_(?:layout_revisions|sheet_snapshots)"/u);
    expect(migration).not.toMatch(/UPDATE\s+"proposal_versions"/u);
    expect(migration).not.toMatch(/UPDATE\s+"phase_layout_snapshots"/u);
  });

  it("pins coordinate provenance in the Drizzle model", () => {
    for (const table of [
      placedObjects,
      configurationLayoutRevisions,
      configurationSheetSnapshots,
      proposalVersions,
      phaseLayoutSnapshots,
    ]) {
      expect(getTableColumns(table).coordinateSpace).toBeDefined();
    }
    expect(getTableColumns(placedObjects).coordinateWriteToken).toBeDefined();
  });

  it("rejects stale render-space writers after the migration commits", () => {
    expect(migration).toContain('ALTER COLUMN "coordinate_write_token" SET NOT NULL');
    expect(migration).toContain('CREATE TRIGGER "placed_objects_real_metre_write_guard"');
    expect(migration).toContain('NEW."coordinate_write_token" IS NOT DISTINCT FROM OLD."coordinate_write_token"');
    expect(authenticatedWrites.match(/coordinateWriteToken:\s*randomUUID\(\)/gu)).toHaveLength(3);
    expect(authenticatedWrites).toContain('updateData["coordinateWriteToken"] = randomUUID()');
    expect(publicWrites.match(/coordinateWriteToken:\s*randomUUID\(\)/gu)).toHaveLength(2);
    expect(websocketWrites.match(/coordinateWriteToken:\s*randomUUID\(\)/gu)).toHaveLength(2);
  });
});
