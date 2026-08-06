/**
 * T-508 focused 0058 evidence — static slice (authority-none).
 *
 * Freezes the exact bytes of the audited disabled activation substrate and
 * asserts, from SQL source text alone, the mechanical invariants of the
 * disabled state plus the identifier-catalog sweep the independent audits
 * mandated (63-byte limit and truncation-collision freedom across the
 * pg_class, pg_proc, pg_trigger, pg_constraint and pg_attribute namespaces,
 * with the pg_policy case recorded as an asserted absence).
 *
 * This suite contacts no database and proves nothing live: semantic
 * behaviour, concurrency, adversarial resistance, Drizzle parity and the
 * privileged callable surface remain open T-508 work items. It exists so any
 * byte or structural drift in the frozen 0053–0058 chain, any appearance of
 * an enable-shaped migration, or any identifier-catalog regression fails
 * closed in CI. Migration 0058 stays disabled; 0059 (under that ordinal or
 * any successor designation) remains prohibited.
 */
import { readFile, readdir } from "node:fs/promises";
import { createHash } from "node:crypto";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { z } from "zod";

const JournalSchema = z.object({
  version: z.string().min(1),
  dialect: z.literal("postgresql"),
  entries: z.array(z.object({
    idx: z.number().int().nonnegative(),
    version: z.string().min(1),
    when: z.number().int().positive(),
    tag: z.string().regex(/^\d{4}_[a-z0-9_]+$/),
    breakpoints: z.boolean(),
  }).strict()).min(1),
}).strict();

/** Frozen byte identities of the Foundry migration chain (recorded in the
 * 2026-07-14 handoff and re-verified by the 2026-07-28 joint audit). */
const FROZEN_FOUNDRY_MIGRATIONS = {
  "0053_foundry_execution_control": {
    bytes: 533_870,
    sha256: "6950a3a230dd0d2181f33296dac3bb5ff42ebbe070e5bdcd4d651f8c737ffa34",
  },
  "0054_foundry_derivative_rights": {
    bytes: 58_546,
    sha256: "05e80543a52978c9b01ab277257ca7eed7bd8a2f37dbedfdeee06fa1c730bdb4",
  },
  "0055_foundry_derivative_rights_custody": {
    bytes: 17_323,
    sha256: "47602cf4ef2973a5e8588759519ca6cef3c7d7dd2f52c463ceea3eb4667db2e7",
  },
  "0056_foundry_derivative_execution_barrier": {
    bytes: 9_768,
    sha256: "3075ba5895283dd6a15407e4aa3edb44073fe7125a69a541d125579efef7a78d",
  },
  "0057_foundry_derivative_execution_candidates": {
    bytes: 59_292,
    sha256: "10fc023060ecd1228421243272d584dcb1b2bd8bd277622d9f66c5cc27ba1c6e",
  },
  "0058_foundry_derivative_activation_disabled": {
    bytes: 262_281,
    sha256: "1655b8ff5022377f28f7ef1f73aa5ca0e75e0ddc14218339b341b81a33c5506e",
  },
} as const;

/** The unrelated planner migration that permanently consumed ordinal 0059
 * (P2-1 in the 2026-07-28 joint audit: fails closed; the parent contract's
 * enable-ordinal clause is amended by proposal, never by renumbering). */
const ACTION_LOG_0059 = {
  tag: "0059_action_log",
  bytes: 1_725,
  sha256: "be3f5cce9060a2c4ab2c43b458b6edfaa63b27cbaffb9e959ad20e4eb6e62133",
} as const;

/** Index-pinned journal positions (never tail-relative; see the 2026-07-18
 * session note on tail-relative fragility). */
const JOURNAL_INDEX_PINS: ReadonlyArray<readonly [number, string]> = [
  [51, "0053_foundry_execution_control"],
  [52, "0054_foundry_derivative_rights"],
  [53, "0055_foundry_derivative_rights_custody"],
  [54, "0056_foundry_derivative_execution_barrier"],
  [55, "0057_foundry_derivative_execution_candidates"],
  [56, "0058_foundry_derivative_activation_disabled"],
  [57, "0059_action_log"],
];

/** Structural facts of the exact frozen 0058 bytes (derived from source and
 * pinned so any intentional re-freeze must re-derive them deliberately). */
const EXPECTED_0058_STRUCTURE = {
  tables: 24,
  functions: 53,
  triggers: 16,
  indexes: 14,
  namedConstraints: 163,
  totalColumns: 578,
  createPolicyStatements: 0,
  rowLevelSecurityMentions: 0,
  securityDefinerCount: 27,
  insertIntoOccurrences: 7,
  grantStatements: 2,
  maxIdentifierBytes: 61,
} as const;

const POSTGRES_IDENTIFIER_BYTE_LIMIT = 63;

function sha256Hex(data: Buffer): string {
  return createHash("sha256").update(data).digest("hex");
}

async function readMigration(tag: string): Promise<Buffer> {
  return Buffer.from(await readFile(resolve("drizzle", `${tag}.sql`)));
}

function uniqueMatches(sql: string, pattern: RegExp): string[] {
  const found = new Set<string>();
  for (const match of sql.matchAll(pattern)) {
    const captured = match[1];
    if (captured !== undefined) found.add(captured);
  }
  return [...found];
}

function extractCreatedTableColumns(sql: string, tableName: string): string[] {
  const createPattern = new RegExp(
    `CREATE TABLE(?: IF NOT EXISTS)? "${tableName}" \\(([\\s\\S]*?)\\r?\\n\\);`,
  );
  const body = createPattern.exec(sql)?.[1];
  if (body === undefined) throw new Error(`Migration does not create table ${tableName}`);
  return [...body.matchAll(/^\s{2}"([^"]+)"\s/gm)].map((match) => match[1] ?? "");
}

/** Distinct identifiers that stop being distinct after PostgreSQL's silent
 * 63-byte truncation. An empty result is the required state. */
function truncationCollisions(identifiers: readonly string[]): Array<[string, string]> {
  const byTruncation = new Map<string, string>();
  const collisions: Array<[string, string]> = [];
  for (const identifier of new Set(identifiers)) {
    const truncated = Buffer.from(identifier, "utf8")
      .subarray(0, POSTGRES_IDENTIFIER_BYTE_LIMIT)
      .toString("utf8");
    const existing = byTruncation.get(truncated);
    if (existing !== undefined && existing !== identifier) {
      collisions.push([existing, identifier]);
    }
    byTruncation.set(truncated, identifier);
  }
  return collisions;
}

async function load0058(): Promise<string> {
  const bytes = await readMigration("0058_foundry_derivative_activation_disabled");
  return bytes.toString("utf8");
}

describe("0058 frozen-byte and journal evidence (T-508 static slice, authority-none)", () => {
  it("keeps the Foundry migration chain 0053–0058 byte-identical to its frozen record", async () => {
    for (const [tag, frozen] of Object.entries(FROZEN_FOUNDRY_MIGRATIONS)) {
      const bytes = await readMigration(tag);
      expect(bytes.length, `${tag} byte length`).toBe(frozen.bytes);
      expect(sha256Hex(bytes), `${tag} sha256`).toBe(frozen.sha256);
    }
  });

  it("pins 0053–0059 at journal indices 51–57 without tail-relative addressing", async () => {
    const journal = JournalSchema.parse(
      JSON.parse(await readFile(resolve("drizzle/meta/_journal.json"), "utf8")),
    );
    for (const [idx, tag] of JOURNAL_INDEX_PINS) {
      expect(journal.entries[idx]?.tag, `journal idx ${idx}`).toBe(tag);
      expect(journal.entries[idx]?.idx, `journal idx field ${idx}`).toBe(idx);
    }
    const activationTags = journal.entries
      .map((entry) => entry.tag)
      .filter((tag) => tag.includes("foundry_derivative_activation"));
    expect(activationTags).toEqual(["0058_foundry_derivative_activation_disabled"]);
  });

  it("records ordinal 0059 as consumed by a non-Foundry migration, with no enable-shaped migration anywhere", async () => {
    const actionLog = await readMigration(ACTION_LOG_0059.tag);
    expect(actionLog.length).toBe(ACTION_LOG_0059.bytes);
    expect(sha256Hex(actionLog)).toBe(ACTION_LOG_0059.sha256);
    const actionLogSql = actionLog.toString("utf8");
    for (const forbidden of ["fdv1_", "foundry_derivative", "activation_epoch", "enabled_release"]) {
      expect(actionLogSql.includes(forbidden), `0059_action_log must not mention ${forbidden}`).toBe(false);
    }

    const migrationFiles = (await readdir(resolve("drizzle")))
      .filter((name) => name.endsWith(".sql"));
    const activationFiles = migrationFiles.filter((name) =>
      name.includes("foundry_derivative_activation"));
    expect(activationFiles).toEqual(["0058_foundry_derivative_activation_disabled.sql"]);

    for (const laterTag of ["0060_phase_layout_snapshot_lineage", "0061_diary_commands"]) {
      const laterSql = (await readMigration(laterTag)).toString("utf8");
      for (const forbidden of ["fdv1_", "enabled_release", "foundry_derivative"]) {
        expect(laterSql.includes(forbidden), `${laterTag} must not mention ${forbidden}`).toBe(false);
      }
    }
  });
});

describe("0058 disabled-substrate mechanical invariants (source-level)", () => {
  it("authors exactly one epoch row: the generation-1 disabled sentinel", async () => {
    const sql = await load0058();
    const epochInserts = [...sql.matchAll(
      /INSERT INTO "foundry_derivative_execution_activation_epochs_v1"[\s\S]*?;/g,
    )].map((match) => match[0]);
    expect(epochInserts).toHaveLength(1);
    const sentinelInsert = epochInserts[0] ?? "";
    expect(sentinelInsert).toContain("'disabled_sentinel'");
    expect(sentinelInsert).toContain("'bootstrap'");
    expect(sentinelInsert.includes("enabled_release")).toBe(false);

    const allInserts = [...sql.matchAll(/INSERT INTO[\s\S]*?;/g)].map((match) => match[0]);
    expect(allInserts).toHaveLength(EXPECTED_0058_STRUCTURE.insertIntoOccurrences);
    for (const insert of allInserts) {
      expect(insert.includes("enabled_release"), "no INSERT may author an enabled epoch").toBe(false);
    }
  });

  it("grants nothing beyond the two read helpers and keeps the dynamic table denial", async () => {
    const sql = await load0058();
    const grants = [...sql.matchAll(/^\s*GRANT [^;]+;/gm)].map((match) => match[0]);
    expect(grants).toHaveLength(EXPECTED_0058_STRUCTURE.grantStatements);
    expect(grants.every((grant) => grant.trimStart().startsWith("GRANT EXECUTE ON FUNCTION"))).toBe(true);
    expect(grants.some((grant) => grant.includes('"fdv1_current_epoch"'))).toBe(true);
    expect(grants.some((grant) => grant.includes('"fdv1_next_epoch_boundary"'))).toBe(true);

    expect(sql).toContain("REVOKE ALL PRIVILEGES ON TABLE %I FROM PUBLIC");
    expect(sql).toContain("REVOKE ALL PRIVILEGES ON TABLE %I FROM %I");

    expect(sql).toContain('CREATE FUNCTION "fdv1_assert_enabled"');
    expect(sql).toContain("derivative phase % is denied by the latest effective disabled epoch");
  });

  it("carries zero policies and zero row-level security, recorded as an asserted absence", async () => {
    const sql = await load0058();
    expect([...sql.matchAll(/CREATE POLICY/g)]).toHaveLength(
      EXPECTED_0058_STRUCTURE.createPolicyStatements,
    );
    expect([...sql.matchAll(/ROW LEVEL SECURITY/g)]).toHaveLength(
      EXPECTED_0058_STRUCTURE.rowLevelSecurityMentions,
    );
    expect([...sql.matchAll(/SECURITY DEFINER/g)]).toHaveLength(
      EXPECTED_0058_STRUCTURE.securityDefinerCount,
    );
  });
});

describe("0058 identifier catalog sweep (pg_class, pg_proc, pg_trigger, pg_constraint, pg_attribute)", () => {
  it("holds every created identifier within 63 bytes and free of truncation collisions", async () => {
    const sql = await load0058();

    const tables = uniqueMatches(sql, /CREATE TABLE(?: IF NOT EXISTS)? "([^"]+)"/g);
    const functions = uniqueMatches(sql, /CREATE (?:OR REPLACE )?FUNCTION (?:public\.)?"?([A-Za-z0-9_]+)"?\s*\(/g);
    const triggers = uniqueMatches(sql, /CREATE (?:CONSTRAINT )?TRIGGER "?([A-Za-z0-9_]+)"?/g);
    const indexes = uniqueMatches(sql, /CREATE (?:UNIQUE )?INDEX(?: IF NOT EXISTS)? "([^"]+)"/g);
    const constraints = uniqueMatches(sql, /CONSTRAINT "([^"]+)"/g);

    expect(tables).toHaveLength(EXPECTED_0058_STRUCTURE.tables);
    expect(functions).toHaveLength(EXPECTED_0058_STRUCTURE.functions);
    expect(triggers).toHaveLength(EXPECTED_0058_STRUCTURE.triggers);
    expect(indexes).toHaveLength(EXPECTED_0058_STRUCTURE.indexes);
    expect(constraints).toHaveLength(EXPECTED_0058_STRUCTURE.namedConstraints);

    const columnsByTable = new Map<string, string[]>(
      tables.map((table) => [table, extractCreatedTableColumns(sql, table)]),
    );
    const totalColumns = [...columnsByTable.values()]
      .reduce((sum, columns) => sum + columns.length, 0);
    expect(totalColumns).toBe(EXPECTED_0058_STRUCTURE.totalColumns);

    const allIdentifiers = [
      ...tables,
      ...functions,
      ...triggers,
      ...indexes,
      ...constraints,
      ...[...columnsByTable.values()].flat(),
    ];
    const overLimit = allIdentifiers.filter(
      (identifier) => Buffer.byteLength(identifier, "utf8") > POSTGRES_IDENTIFIER_BYTE_LIMIT,
    );
    expect(overLimit).toEqual([]);
    const maxIdentifierBytes = allIdentifiers.reduce(
      (max, identifier) => Math.max(max, Buffer.byteLength(identifier, "utf8")),
      0,
    );
    expect(maxIdentifierBytes).toBe(EXPECTED_0058_STRUCTURE.maxIdentifierBytes);

    // pg_class namespace is shared by relations and indexes.
    expect(truncationCollisions([...tables, ...indexes])).toEqual([]);
    expect(truncationCollisions(functions)).toEqual([]);
    expect(truncationCollisions(triggers)).toEqual([]);
    expect(truncationCollisions(constraints)).toEqual([]);
    for (const [table, columns] of columnsByTable) {
      expect(truncationCollisions(columns), `pg_attribute collisions in ${table}`).toEqual([]);
    }
  });
});
