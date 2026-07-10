import { mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join, resolve } from "node:path";
import { getTableColumns, getTableName } from "drizzle-orm";
import type { AnyPgColumn, PgTable } from "drizzle-orm/pg-core";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import {
  canonicalLayoutSnapshots,
  eventArchitectCandidates,
  eventArchitectRuns,
  eventMissionAcknowledgements,
  eventMissionEvents,
  eventMissionIncidents,
  eventMissionPhases,
  eventMissionSessions,
  eventMissionTasks,
  eventMissions,
  layoutValidationRuns,
  opsTasks,
} from "../db/schema.js";
import {
  compareMigrationJournals,
  coordinateMigrationApprovalSatisfied,
  parseCliOptions,
  writeReportAtomic,
} from "../scripts/verify-migration-tail-readiness.js";

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

const MISSION_TABLES = [
  eventMissions,
  eventMissionPhases,
  eventMissionTasks,
  eventMissionIncidents,
  eventMissionEvents,
  eventMissionAcknowledgements,
  eventMissionSessions,
] as const;

const ARCHITECT_TABLES = [
  canonicalLayoutSnapshots,
  layoutValidationRuns,
  eventArchitectRuns,
  eventArchitectCandidates,
] as const;

const EXPECTED_TAIL = [
  "0044_placed_objects_render_to_real",
  "0045_event_scenario_phase_scope",
  "0046_event_mission_control",
  "0047_event_architect_proof",
] as const;

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

async function readMigration(tag: string): Promise<string> {
  return readFile(resolve("drizzle", `${tag}.sql`), "utf8");
}

describe("migration tail rollout readiness", () => {
  it("keeps every SQL migration journaled once with contiguous order and an increasing timestamp", async () => {
    const [journalText, drizzleFiles] = await Promise.all([
      readFile(resolve("drizzle/meta/_journal.json"), "utf8"),
      readdir(resolve("drizzle")),
    ]);
    const parsed: unknown = JSON.parse(journalText);
    const journal = JournalSchema.parse(parsed);
    const tags = journal.entries.map((entry) => entry.tag);
    const sqlTags = drizzleFiles
      .filter((file) => file.endsWith(".sql"))
      .map((file) => basename(file, ".sql"));

    expect(new Set(tags).size).toBe(tags.length);
    expect([...tags].sort()).toEqual([...sqlTags].sort());
    expect(journal.entries.map((entry) => entry.idx)).toEqual(
      journal.entries.map((_, index) => index),
    );
    for (let index = 1; index < journal.entries.length; index += 1) {
      expect(journal.entries[index]?.when).toBeGreaterThan(journal.entries[index - 1]?.when ?? 0);
    }
    expect(tags.slice(-EXPECTED_TAIL.length)).toEqual(EXPECTED_TAIL);
  });

  it("keeps migration 0046 table columns identical to the Drizzle mission schema", async () => {
    const sql = await readMigration("0046_event_mission_control");
    for (const table of MISSION_TABLES) {
      const tableName = getTableName(table);
      expect(extractCreatedTableColumns(sql, tableName), tableName).toEqual(drizzleColumnNames(table));
    }
    expect(sql).toContain('ADD COLUMN IF NOT EXISTS "spatial_anchors" jsonb NOT NULL');
    expect(getTableColumns(opsTasks).spatialAnchors.name).toBe("spatial_anchors");
  });

  it("keeps migration 0047 table columns identical to the Drizzle architect schema", async () => {
    const sql = await readMigration("0047_event_architect_proof");
    for (const table of ARCHITECT_TABLES) {
      const tableName = getTableName(table);
      expect(extractCreatedTableColumns(sql, tableName), tableName).toEqual(drizzleColumnNames(table));
    }
  });

  it("keeps both feature migrations additive and pins their cross-table integrity boundaries", async () => {
    const [missionSql, architectSql] = await Promise.all([
      readMigration("0046_event_mission_control"),
      readMigration("0047_event_architect_proof"),
    ]);
    const combined = `${missionSql}\n${architectSql}`;

    expect(combined).not.toMatch(/\b(?:DROP|TRUNCATE|RENAME)\b/i);
    expect(combined).not.toMatch(/\bDELETE\s+FROM\b/i);
    for (const requiredBoundary of [
      "events_id_venue_unique",
      "handoff_packs_event_id_id_unique",
      "ops_tasks_handoff_id_unique",
      "event_missions_event_venue_fk",
      "event_missions_event_handoff_fk",
      "event_mission_phases_event_phase_fk",
      "event_mission_tasks_handoff_task_fk",
      "event_mission_events_idempotency_unique",
      "event_mission_events_mission_sequence_unique",
      "event_architect_runs_actor_idempotency_unique",
      "event_architect_runs_selection_complete",
      "event_architect_candidates_rank_range",
    ]) {
      expect(combined).toContain(requiredBoundary);
    }
  });

  it("compares the database migration journal as an exact local prefix", () => {
    const local = [
      { tag: "0044_one", when: 100, hash: "raw-crlf-hash-44", canonicalHash: "hash-44" },
      { tag: "0045_two", when: 200, hash: "raw-crlf-hash-45", canonicalHash: "hash-45" },
    ];
    expect(compareMigrationJournals(local, [
      { createdAt: "100", hash: "hash-44" },
    ])).toMatchObject({
      appliedCount: 1,
      pendingCount: 1,
      pendingTags: ["0045_two"],
      timestampPrefixMatches: true,
      hashPrefixMatches: true,
      hashMismatchTags: [],
      prefixMatches: true,
      firstMismatchIndex: null,
    });
    expect(compareMigrationJournals(local, [
      { createdAt: "100", hash: "different" },
    ])).toMatchObject({
      pendingCount: 1,
      pendingTags: ["0045_two"],
      timestampPrefixMatches: true,
      hashPrefixMatches: false,
      hashMismatchTags: ["0044_one"],
      prefixMatches: false,
      firstMismatchIndex: 0,
    });
  });

  it("requires approval bound to the exact 0044 SQL hash only while 0044 is pending", () => {
    const pending = ["0044_placed_objects_render_to_real", "0045_event_scenario_phase_scope"];
    expect(coordinateMigrationApprovalSatisfied(pending, "reviewed-hash", undefined)).toBe(false);
    expect(coordinateMigrationApprovalSatisfied(pending, "reviewed-hash", "different-hash")).toBe(false);
    expect(coordinateMigrationApprovalSatisfied(pending, "reviewed-hash", "reviewed-hash")).toBe(true);
    expect(coordinateMigrationApprovalSatisfied(["0045_event_scenario_phase_scope"], undefined, undefined)).toBe(true);
  });

  it("parses deploy-gate and durable-output options without accepting ambiguous arguments", () => {
    expect(parseCliOptions(["--deploy-gate", "--out", "readiness.json"])).toEqual({
      deployGate: true,
      outPath: "readiness.json",
    });
    expect(() => parseCliOptions(["--out"])).toThrow("--out requires a file path");
    expect(() => parseCliOptions(["--unknown"])).toThrow("Unknown argument");
  });

  it("atomically writes a readiness report and refuses to overwrite it", async () => {
    const directory = await mkdtemp(join(tmpdir(), "venviewer-migration-readiness-"));
    const output = join(directory, "readiness.json");
    try {
      await expect(writeReportAtomic(output, "{\"safe\":true}\n")).resolves.toBe(resolve(output));
      await expect(readFile(output, "utf8")).resolves.toBe("{\"safe\":true}\n");
      await expect(writeReportAtomic(output, "replacement")).rejects.toThrow("refusing overwrite");
      await expect(readFile(output, "utf8")).resolves.toBe("{\"safe\":true}\n");
    } finally {
      expect(resolve(directory).startsWith(resolve(tmpdir()))).toBe(true);
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("keeps the operator preflight read-only and the Drizzle schema directly loadable", async () => {
    const [script, schema, packageJson, deployWorkflow] = await Promise.all([
      readFile(resolve("src/scripts/verify-migration-tail-readiness.ts"), "utf8"),
      readFile(resolve("src/db/schema.ts"), "utf8"),
      readFile(resolve("package.json"), "utf8"),
      readFile(resolve("../../.github/workflows/deploy.yml"), "utf8"),
    ]);
    expect(script).toContain("SET TRANSACTION READ ONLY");
    const executedSql = [...script.matchAll(/execute\(sql`([\s\S]*?)`\)/g)]
      .map((match) => match[1] ?? "")
      .join("\n");
    expect(executedSql).not.toMatch(/\b(?:ALTER|CREATE|DELETE|DROP|INSERT|TRUNCATE|UPDATE)\s+(?:TABLE|FROM|INTO|SCHEMA)\b/i);
    expect(schema).toContain('type RealMetreCoordinateSpace = typeof import("./coordinate-space.js")');
    expect(schema).not.toMatch(/import\s*\{[^}]*REAL_METRE_COORDINATE_SPACE[^}]*\}\s*from/u);
    for (const relationalBoundary of [
      "events_id_venue_unique",
      "handoff_packs_event_id_id_unique",
      "ops_tasks_handoff_id_unique",
    ]) expect(schema).toContain(relationalBoundary);
    expect(packageJson).toContain('"db:verify-tail": "tsx src/scripts/verify-migration-tail-readiness.ts"');
    expect(deployWorkflow).toContain("db:verify-tail -- --deploy-gate");
    expect(deployWorkflow).toContain("vars.APPROVED_MIGRATION_0044_SHA256");
  });
});
