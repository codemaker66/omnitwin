import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { getTableColumns, getTableName } from "drizzle-orm";
import { z } from "zod";
import {
  supplierAcknowledgements,
  supplierCoordinationPackItems,
  supplierCoordinationPacks,
  supplierCoordinationShareTokens,
} from "../db/schema.js";

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
