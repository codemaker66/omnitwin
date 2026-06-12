import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { getTableColumns, getTableName } from "drizzle-orm";
import { z } from "zod";
import {
  activities,
  clientAccounts,
  contacts,
  followUpTasks,
  opportunities,
  opportunityStatusHistory,
  packageSelections,
  proposalComments,
  proposalShareTokens,
  proposals,
  quotes,
} from "../db/schema.js";

const migrationSql = readFileSync(
  fileURLToPath(new URL("../../drizzle/0034_commercial_spine.sql", import.meta.url)),
  "utf8",
);

const journalRaw = readFileSync(
  fileURLToPath(new URL("../../drizzle/meta/_journal.json", import.meta.url)),
  "utf8",
);

const JournalSchema = z.object({
  entries: z.array(z.object({ idx: z.number().int(), tag: z.string() })),
});

describe("commercial spine Drizzle schema", () => {
  it("exposes CRM, proposal-share, and package tables under SQL names", () => {
    expect(getTableName(clientAccounts)).toBe("client_accounts");
    expect(getTableName(contacts)).toBe("contacts");
    expect(getTableName(opportunities)).toBe("opportunities");
    expect(getTableName(opportunityStatusHistory)).toBe("opportunity_status_history");
    expect(getTableName(activities)).toBe("activities");
    expect(getTableName(followUpTasks)).toBe("follow_up_tasks");
    expect(getTableName(proposalShareTokens)).toBe("proposal_share_tokens");
    expect(getTableName(proposalComments)).toBe("proposal_comments");
    expect(getTableName(packageSelections)).toBe("package_selections");
  });

  it("links proposals and quotes to opportunities", () => {
    const proposalCols = getTableColumns(proposals);
    const quoteCols = getTableColumns(quotes);
    expect(proposalCols.opportunityId.name).toBe("opportunity_id");
    expect(quoteCols.opportunityId.name).toBe("opportunity_id");
  });

  it("stores share tokens as hashes and package money as integer minor units", () => {
    const tokenCols = getTableColumns(proposalShareTokens);
    expect(tokenCols.tokenHash.name).toBe("token_hash");
    expect(tokenCols.tokenHash.getSQLType()).toBe("varchar(64)");

    const packageCols = getTableColumns(packageSelections);
    expect(packageCols.unitAmountMinor.getSQLType()).toBe("integer");
    expect(packageCols.totalMinor.getSQLType()).toBe("integer");
    expect(packageCols.quantity.getSQLType()).toBe("integer");
  });
});

describe("migration 0034_commercial_spine", () => {
  it("creates all required commercial tables idempotently", () => {
    for (const table of [
      "client_accounts",
      "contacts",
      "opportunities",
      "opportunity_status_history",
      "activities",
      "follow_up_tasks",
      "proposal_share_tokens",
      "proposal_comments",
      "package_selections",
    ]) {
      expect(migrationSql).toContain(`CREATE TABLE IF NOT EXISTS "${table}"`);
    }
  });

  it("adds opportunity linkage to existing proposal and quote tables", () => {
    expect(migrationSql).toContain('ALTER TABLE "proposals" ADD COLUMN IF NOT EXISTS "opportunity_id"');
    expect(migrationSql).toContain('ALTER TABLE "quotes" ADD COLUMN IF NOT EXISTS "opportunity_id"');
  });

  it("guards money, stage, and token invariants", () => {
    expect(migrationSql).toContain('"opportunities_stage_check"');
    expect(migrationSql).toContain('"proposal_share_tokens_token_hash_shape"');
    expect(migrationSql).toContain('"package_selections_total_exact"');
    expect(migrationSql).toContain('CHECK ("total_minor" = "unit_amount_minor" * "quantity")');
  });

  it("is registered after integration layer in the migration journal", () => {
    const parsed: unknown = JSON.parse(journalRaw);
    const journal = JournalSchema.parse(parsed);
    const tags = journal.entries.map((entry) => entry.tag);
    expect(tags.indexOf("0034_commercial_spine")).toBeGreaterThan(tags.indexOf("0033_integration_layer"));
  });
});
