import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { getTableColumns, getTableName } from "drizzle-orm";
import { getTableConfig, type PgTable } from "drizzle-orm/pg-core";
import { z } from "zod";
import {
  supplierAcknowledgements,
  supplierCoordinationPackItems,
  supplierCoordinationPacks,
  supplierCoordinationShareTokens,
} from "../db/schema.js";
import { migrationText, sqlWithoutComments } from "./migration-text.js";

/** The ON DELETE action of the single-column key on `column`. */
function onDeleteOf(table: PgTable, column: string): string | undefined {
  const keys = getTableConfig(table).foreignKeys
    .filter((key) => key.reference().columns.map((col) => col.name).join(",") === column);
  expect(keys, `exactly one key on ${column}`).toHaveLength(1);
  return keys[0]?.onDelete;
}

// What a supplier was told and what they confirmed must not be erasable by a
// cascade (0095). The Postgres proof, on the migrated schema, is
// supplier-records-kept-postgres.test.ts; these hold the schema and the SQL.
describe("supplier records kept (0095)", () => {
  it("declares a pass's handoff pack and a reply's pass as RESTRICT in the Drizzle schema", () => {
    expect(onDeleteOf(supplierCoordinationPacks, "handoff_pack_id")).toBe("restrict");
    expect(onDeleteOf(supplierAcknowledgements, "pack_id")).toBe("restrict");
  });

  it("rewrites both keys as ON DELETE RESTRICT in a journaled migration", async () => {
    const sql = sqlWithoutComments(await migrationText("_supplier_records_kept"));
    expect(sql).toMatch(/ADD CONSTRAINT "supplier_acknowledgements_pack_id_fkey"\s+FOREIGN KEY \("pack_id"\) REFERENCES "supplier_coordination_packs" \("id"\)\s+ON DELETE RESTRICT;/u);
    expect(sql).toMatch(/ADD CONSTRAINT "supplier_coordination_packs_handoff_pack_id_fkey"\s+FOREIGN KEY \("handoff_pack_id"\) REFERENCES "handoff_packs" \("id"\)\s+ON DELETE RESTRICT;/u);
    expect(sql).not.toMatch(/CASCADE/u);
  });
});

const migrationSql = readFileSync(
  fileURLToPath(new URL("../../drizzle/0038_supplier_coordination.sql", import.meta.url)),
  "utf8",
);

const journalRaw = readFileSync(
  fileURLToPath(new URL("../../drizzle/meta/_journal.json", import.meta.url)),
  "utf8",
);

const JournalSchema = z.object({
  entries: z.array(z.object({ idx: z.number().int(), tag: z.string() })),
});

describe("supplier coordination Drizzle schema", () => {
  it("exposes supplier pack, item, token, and acknowledgement tables", () => {
    expect(getTableName(supplierCoordinationPacks)).toBe("supplier_coordination_packs");
    expect(getTableName(supplierCoordinationPackItems)).toBe("supplier_coordination_pack_items");
    expect(getTableName(supplierCoordinationShareTokens)).toBe("supplier_coordination_share_tokens");
    expect(getTableName(supplierAcknowledgements)).toBe("supplier_acknowledgements");
  });

  it("stores supplier share tokens as hashes and pack provenance as hashes", () => {
    const tokenCols = getTableColumns(supplierCoordinationShareTokens);
    expect(tokenCols.tokenHash.name).toBe("token_hash");
    expect(tokenCols.tokenHash.getSQLType()).toBe("varchar(64)");

    const packCols = getTableColumns(supplierCoordinationPacks);
    expect(packCols.sourceSnapshotHash.getSQLType()).toBe("varchar(64)");
    expect(packCols.sourceDigest.getSQLType()).toBe("varchar(64)");
    expect(packCols.safeStatus.name).toBe("safe_status");
  });

  it("links pack items back to frozen supplier instructions", () => {
    const itemCols = getTableColumns(supplierCoordinationPackItems);
    expect(itemCols.packId.name).toBe("pack_id");
    expect(itemCols.supplierInstructionId.name).toBe("supplier_instruction_id");
    expect(itemCols.arrivalWindow.name).toBe("arrival_window");
  });
});

describe("migration 0038_supplier_coordination", () => {
  it("creates all required supplier coordination tables idempotently", () => {
    for (const table of [
      "supplier_coordination_packs",
      "supplier_coordination_pack_items",
      "supplier_coordination_share_tokens",
      "supplier_acknowledgements",
    ]) {
      expect(migrationSql).toContain(`CREATE TABLE IF NOT EXISTS "${table}"`);
    }
  });

  it("guards token, source hash, status, and supplier-safe invariants", () => {
    expect(migrationSql).toContain("supplier_coordination_packs_hash_shape");
    expect(migrationSql).toContain("supplier_coordination_packs_safe_status_check");
    expect(migrationSql).toContain("supplier_coordination_share_tokens_token_hash_shape");
    expect(migrationSql).toContain("supplier_acknowledgements_identity_required");
    expect(migrationSql).toContain("'supplier_safe_operations_handoff'");
  });

  it("is registered after onboarding entitlements in the migration journal", () => {
    const parsed: unknown = JSON.parse(journalRaw);
    const journal = JournalSchema.parse(parsed);
    const tags = journal.entries.map((entry) => entry.tag);
    expect(tags.indexOf("0038_supplier_coordination")).toBeGreaterThan(tags.indexOf("0037_onboarding_entitlements"));
  });
});
