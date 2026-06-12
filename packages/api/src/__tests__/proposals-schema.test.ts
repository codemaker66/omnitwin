import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { getTableColumns, getTableName } from "drizzle-orm";
import { z } from "zod";
import {
  PROPOSAL_STATUSES,
  PROPOSAL_VERSION_PAYLOAD_SCHEMA_VERSION,
  QUOTE_STATUSES,
} from "@omnitwin/types";
import {
  proposals,
  proposalStatusHistory,
  proposalVersions,
  quoteLineItems,
  quotes,
} from "../db/schema.js";

// ---------------------------------------------------------------------------
// T-427 phase 1 — schema/migration contract tests.
//
// These are drift guards: the Drizzle table objects, the hand-written
// migration 0026, and the @omnitwin/types vocabularies must agree. A status
// added in types without updating the SQL CHECK (or vice versa) fails here,
// not in production.
// ---------------------------------------------------------------------------

const migrationSql = readFileSync(
  fileURLToPath(new URL("../../drizzle/0026_proposals_quotes.sql", import.meta.url)),
  "utf8",
);

const journalRaw = readFileSync(
  fileURLToPath(new URL("../../drizzle/meta/_journal.json", import.meta.url)),
  "utf8",
);

const JournalSchema = z.object({
  entries: z.array(
    z.object({
      idx: z.number().int(),
      tag: z.string(),
      when: z.number().int(),
    }),
  ),
});

describe("proposal/quote Drizzle tables", () => {
  it("exposes the five T-427 tables under their SQL names", () => {
    expect(getTableName(proposals)).toBe("proposals");
    expect(getTableName(proposalVersions)).toBe("proposal_versions");
    expect(getTableName(proposalStatusHistory)).toBe("proposal_status_history");
    expect(getTableName(quotes)).toBe("quotes");
    expect(getTableName(quoteLineItems)).toBe("quote_line_items");
  });

  it("venue-scopes and soft-deletes proposals and quotes (house pattern)", () => {
    const proposalCols = getTableColumns(proposals);
    expect(proposalCols.venueId.name).toBe("venue_id");
    expect(proposalCols.venueId.notNull).toBe(true);
    expect(proposalCols.deletedAt.name).toBe("deleted_at");

    const quoteCols = getTableColumns(quotes);
    expect(quoteCols.venueId.name).toBe("venue_id");
    expect(quoteCols.venueId.notNull).toBe(true);
    expect(quoteCols.deletedAt.name).toBe("deleted_at");
  });

  it("stores all money as integer minor units — no floating-point columns", () => {
    const quoteCols = getTableColumns(quotes);
    expect(quoteCols.subtotalMinor.getSQLType()).toBe("integer");
    expect(quoteCols.totalMinor.getSQLType()).toBe("integer");

    const lineCols = getTableColumns(quoteLineItems);
    expect(lineCols.unitAmountMinor.getSQLType()).toBe("integer");
    expect(lineCols.lineTotalMinor.getSQLType()).toBe("integer");
    expect(lineCols.quantity.getSQLType()).toBe("integer");
  });

  it("gives versions an immutable shape: positive int + 64-char hash + jsonb payload", () => {
    const versionCols = getTableColumns(proposalVersions);
    expect(versionCols.version.getSQLType()).toBe("integer");
    expect(versionCols.sourceHash.name).toBe("source_hash");
    expect(versionCols.payload.getSQLType()).toBe("jsonb");
  });

  it("mirrors the enquiry status-history shape on proposal_status_history", () => {
    const historyCols = getTableColumns(proposalStatusHistory);
    expect(historyCols.fromStatus.name).toBe("from_status");
    expect(historyCols.toStatus.name).toBe("to_status");
    expect(historyCols.changedBy.notNull).toBe(false);
    expect(historyCols.note.notNull).toBe(false);
  });
});

describe("migration 0026_proposals_quotes", () => {
  it("creates all five tables idempotently", () => {
    for (const table of [
      "proposals",
      "proposal_versions",
      "proposal_status_history",
      "quotes",
      "quote_line_items",
    ]) {
      expect(migrationSql).toContain(`CREATE TABLE IF NOT EXISTS "${table}"`);
    }
  });

  it("keeps the proposal status CHECK in lockstep with @omnitwin/types", () => {
    const expected = PROPOSAL_STATUSES.map((status) => `'${status}'`).join(", ");
    expect(migrationSql).toContain(`CHECK ("status" IN (${expected}))`);
  });

  it("keeps the quote status CHECK in lockstep with @omnitwin/types", () => {
    const expected = QUOTE_STATUSES.map((status) => `'${status}'`).join(", ");
    expect(migrationSql).toContain(`CHECK ("status" IN (${expected}))`);
  });

  it("pins the payload shape to the types schema version", () => {
    expect(migrationSql).toContain(
      `CHECK ("payload"->>'schemaVersion' = '${PROPOSAL_VERSION_PAYLOAD_SCHEMA_VERSION}')`,
    );
  });

  it("declares every named constraint", () => {
    const constraintNames = [
      "proposals_share_code_unique",
      "proposals_status_check",
      "proposals_current_version_nonneg",
      "proposals_share_code_shape",
      "proposals_sent_status_coherent",
      "proposal_versions_proposal_version_unique",
      "proposal_versions_version_positive",
      "proposal_versions_source_hash_check",
      "proposal_versions_payload_shape",
      "quotes_status_check",
      "quotes_currency_check",
      "quotes_amounts_nonneg",
      "quotes_superseded_coherent",
      "quotes_superseded_not_self",
      "quote_line_items_quantity_positive",
      "quote_line_items_amounts_nonneg",
      "quote_line_items_total_exact",
      "quote_line_items_sort_order_nonneg",
    ];
    for (const name of constraintNames) {
      expect(migrationSql).toContain(`"${name}"`);
    }
  });

  it("enforces exact line totals at the database level", () => {
    expect(migrationSql).toContain(
      `CHECK ("line_total_minor" = "unit_amount_minor" * "quantity")`,
    );
  });

  it("declares the venue-scoped and lookup indexes", () => {
    for (const indexName of [
      "proposals_venue_status_idx",
      "proposals_enquiry_idx",
      "proposal_versions_proposal_created_idx",
      "proposal_status_history_proposal_idx",
      "quotes_venue_status_idx",
      "quotes_proposal_idx",
      "quote_line_items_quote_idx",
    ]) {
      expect(migrationSql).toContain(`"${indexName}"`);
    }
  });

  it("uses no floating-point money column types", () => {
    for (const column of ["subtotal_minor", "total_minor", "unit_amount_minor", "line_total_minor"]) {
      expect(migrationSql).toContain(`"${column}" integer`);
      expect(migrationSql).not.toContain(`"${column}" numeric`);
    }
  });
});

describe("drizzle journal", () => {
  it("registers 0026_proposals_quotes so db:migrate and deploys apply it", () => {
    const parsed: unknown = JSON.parse(journalRaw);
    const journal = JournalSchema.parse(parsed);

    const tagsInOrder = journal.entries.map((e) => e.tag);
    // 0025 was originally written without a journal entry, so journal-driven
    // deploys could never apply it; it must stay registered ahead of 0026.
    const idx0024 = tagsInOrder.indexOf("0024_runtime_assets");
    const idx0025 = tagsInOrder.indexOf("0025_configuration_revisions");
    const idx0026 = tagsInOrder.indexOf("0026_proposals_quotes");
    expect(idx0024).toBeGreaterThanOrEqual(0);
    expect(idx0025).toBeGreaterThan(idx0024);
    expect(idx0026).toBeGreaterThan(idx0025);

    const entry = journal.entries[idx0026];
    expect(entry).toBeDefined();

    const indexes = journal.entries.map((e) => e.idx);
    expect(new Set(indexes).size).toBe(indexes.length);
    for (let i = 1; i < indexes.length; i += 1) {
      const previous = indexes[i - 1];
      const current = indexes[i];
      expect(previous).toBeDefined();
      expect(current).toBeDefined();
      if (previous !== undefined && current !== undefined) {
        expect(current).toBeGreaterThan(previous);
      }
    }

    const tags = journal.entries.map((e) => e.tag);
    expect(new Set(tags).size).toBe(tags.length);
  });
});
