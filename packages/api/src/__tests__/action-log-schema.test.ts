import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { getTableColumns, getTableName } from "drizzle-orm";
import { getTableConfig, type AnyPgColumn, type PgTable } from "drizzle-orm/pg-core";
import { describe, expect, it } from "vitest";
import { actionLog } from "../db/schema.js";

// ---------------------------------------------------------------------------
// G4 Slice 3 schema contract (03 §2). Pins the append-only action_log table
// to migration 0059 column-for-column. Design invariants worth pinning:
//   - id is the CLIENT-supplied action uuid (no default) — ON CONFLICT (id)
//     DO NOTHING makes batch retries idempotent.
//   - ordinal is a server bigserial: the stable, gap-tolerant read order the
//     audit endpoint pages by (client clocks are never an ordering).
//   - recorded_ts (operator clock) and received_at (server clock) are
//     separate columns — claim-safe: neither is presented as the other.
//   - No update/delete surface anywhere: append-only by code contract, with
//     cascade only on configuration hard-delete (repo convention).
// ---------------------------------------------------------------------------

const MIGRATION_TAG = "0059_action_log";

function extractCreatedTableColumns(sql: string, tableName: string): string[] {
  const createPattern = new RegExp(
    `CREATE TABLE(?: IF NOT EXISTS)? "${tableName}" \\(([\\s\\S]*?)\\r?\\n\\);`,
  );
  const body = createPattern.exec(sql)?.[1];
  if (body === undefined) throw new Error(`Migration does not create table ${tableName}`);
  return [...body.matchAll(/^\s{2}"([^"]+)"\s/gm)].map((match) => match[1] ?? "");
}

function drizzleColumnNames(table: PgTable): string[] {
  const columns = Object.values(getTableColumns(table)) as AnyPgColumn[];
  return columns.map((column) => column.name);
}

describe("action_log schema (G4 slice 3)", () => {
  it("declares the drizzle table with the audit envelope columns", () => {
    expect(getTableName(actionLog)).toBe("action_log");
    expect(drizzleColumnNames(actionLog).sort()).toEqual([
      "actor",
      "batch_id",
      "configuration_id",
      "id",
      "intent",
      "inverse",
      "ordinal",
      "payload",
      "provenance",
      "received_at",
      "recorded_ts",
      "revision",
      "submitted_by",
    ]);
  });

  it("keeps id client-supplied (no default) and ordinal server-assigned", () => {
    const columns = getTableColumns(actionLog);
    expect(columns.id.primary).toBe(true);
    expect(columns.id.hasDefault).toBe(false);
    expect(columns.ordinal.hasDefault).toBe(true); // bigserial
    expect(columns.inverse.notNull).toBe(false); // log-management records carry null
    expect(columns.payload.notNull).toBe(true);
    expect(columns.recordedTs.notNull).toBe(true);
    expect(columns.receivedAt.notNull).toBe(true);
    // Claim safety, actor half (reviewer HIGH): the client's actor blob is
    // self-reported; submitted_by is the AUTHENTICATED principal the server
    // observed — the anchor to cross-check actor.ref against.
    expect(columns.submittedBy.notNull).toBe(true);
    expect(columns.submittedBy.hasDefault).toBe(false);
  });

  it("scopes to configurations with the repo's cascade convention and pages by (config, ordinal)", () => {
    const config = getTableConfig(actionLog);
    const fk = config.foreignKeys[0];
    if (fk === undefined) throw new Error("missing configuration FK");
    expect(fk.reference().foreignColumns.map((c) => c.name)).toEqual(["id"]);
    expect(fk.onDelete).toBe("cascade");
    const indexNames = config.indexes.map((index) => index.config.name);
    expect(indexNames).toContain("action_log_config_ordinal_idx");
    const uniqueNames = config.uniqueConstraints.map((unique) => unique.name);
    expect(uniqueNames).toContain("action_log_ordinal_unique");
  });

  it("matches migration 0059 column-for-column and the journal carries the tag", async () => {
    const sql = await readFile(resolve("drizzle", `${MIGRATION_TAG}.sql`), "utf8");
    expect(extractCreatedTableColumns(sql, "action_log").sort()).toEqual(
      drizzleColumnNames(actionLog).sort(),
    );
    expect(sql).toContain('"ordinal" bigserial');
    expect(sql).toMatch(/ON DELETE cascade/i);
    expect(sql).not.toMatch(/\bUPDATE\b|\bDELETE FROM\b/); // append-only DDL

    const journal = JSON.parse(
      await readFile(resolve("drizzle", "meta", "_journal.json"), "utf8"),
    ) as { entries: { idx: number; tag: string }[] };
    const entry = journal.entries.find((candidate) => candidate.tag === MIGRATION_TAG);
    expect(entry).toBeDefined();
    // Which migration is the journal's tail is owned by migration-tail-readiness
    // (EXPECTED_TAIL) — pinning it here too broke this suite when 0060/0061 landed.
  });
});
