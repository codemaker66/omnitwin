import { mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join, resolve } from "node:path";
import { getTableColumns, getTableName } from "drizzle-orm";
import { getTableConfig, type AnyPgColumn, type PgTable } from "drizzle-orm/pg-core";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import {
  canonicalLayoutSnapshots,
  eventArchitectCandidates,
  eventArchitectOpsReviews,
  eventArchitectRuns,
  eventMissionAcknowledgements,
  eventMissionEvents,
  eventMissionIncidents,
  eventMissionPhases,
  eventMissionSessions,
  eventMissionTasks,
  eventMissions,
  foundryDerivativeExecutionAuthorizationCandidatesV1,
  foundryDerivativeRightsRegistryAttestationRevocationsV1,
  foundryDerivativeRightsRegistryAttestationsV1,
  layoutValidationRuns,
  opsTasks,
  reconstructionReleaseAttestations,
  reconstructionReleaseChannelEvents,
  reconstructionReleaseChannels,
  reconstructionReleasePublications,
  reconstructionReleaseQaRuns,
  reconstructionReleaseReviews,
  reconstructionReleases,
  reconstructionReviewEvidenceArtifacts,
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

const RECONSTRUCTION_FOUNDRY_TABLES = [
  reconstructionReleases,
  reconstructionReleaseQaRuns,
  reconstructionReleaseReviews,
  reconstructionReviewEvidenceArtifacts,
  reconstructionReleaseAttestations,
  reconstructionReleasePublications,
  reconstructionReleaseChannels,
  reconstructionReleaseChannelEvents,
] as const;

const DERIVATIVE_EXECUTION_CANDIDATE_TABLES = [
  foundryDerivativeRightsRegistryAttestationsV1,
  foundryDerivativeRightsRegistryAttestationRevocationsV1,
  foundryDerivativeExecutionAuthorizationCandidatesV1,
] as const;

const EXPECTED_TAIL = [
  "0044_placed_objects_render_to_real",
  "0045_event_scenario_phase_scope",
  "0046_event_mission_control",
  "0047_event_architect_proof",
  "0048_event_architect_ops_reviews",
  "0049_reconstruction_foundry",
  "0050_diary_bookings",
  "0051_diary_enquiry_link",
  "0052_runtime_package_revisions",
  "0053_foundry_execution_control",
  "0054_foundry_derivative_rights",
  "0055_foundry_derivative_rights_custody",
  "0056_foundry_derivative_execution_barrier",
  "0057_foundry_derivative_execution_candidates",
  "0058_foundry_derivative_activation_disabled",
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

function drizzleForeignKeyShape(
  table: PgTable,
  name: string,
): { readonly columns: readonly string[]; readonly foreignColumns: readonly string[] } {
  const key = getTableConfig(table).foreignKeys.find((candidate) => candidate.getName() === name);
  if (key === undefined) throw new Error(`Drizzle table is missing foreign key ${name}`);
  const reference = key.reference();
  return {
    columns: reference.columns.map((column) => column.name),
    foreignColumns: reference.foreignColumns.map((column) => column.name),
  };
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

  it("keeps migration 0048 columns aligned and the Ops review artifact append-only", async () => {
    const sql = await readMigration("0048_event_architect_ops_reviews");
    expect(
      extractCreatedTableColumns(sql, getTableName(eventArchitectOpsReviews)),
    ).toEqual(drizzleColumnNames(eventArchitectOpsReviews));
    expect(sql).toContain("event_architect_ops_reviews_candidate_run_fk");
    expect(sql).toContain("event_architect_ops_reviews_no_update");
    expect(sql).toContain("event_architect_ops_reviews_no_delete");
    expect(sql).toContain("event_architect_ops_reviews_validity_window");
    expect(sql).toContain("event_architect_ops_reviews_required_witnesses");
  });

  it("keeps migration 0049 aligned, append-only, and CAS-controlled", async () => {
    const sql = await readMigration("0049_reconstruction_foundry");
    for (const table of RECONSTRUCTION_FOUNDRY_TABLES) {
      const tableName = getTableName(table);
      expect(extractCreatedTableColumns(sql, tableName), tableName).toEqual(drizzleColumnNames(table));
    }
    expect(sql).not.toMatch(/\b(?:DROP|RENAME)\b/iu);
    expect(sql).not.toMatch(/\bTRUNCATE\s+(?:TABLE\s+)?"/iu);
    expect(sql).not.toMatch(/\bDELETE\s+FROM\b/iu);
    for (const requiredBoundary of [
      "reconstruction_reviews_public_approval_evidence",
      "reconstruction_reviews_release_sequence_unique",
      "reconstruction_reviews_release_supersedes_unique",
      "reconstruction_reviews_supersedes_release_fk",
      "reconstruction_reviews_sequence",
      "reconstruction_reviews_id_exact_evidence_unique",
      "reconstruction_review_evidence_venue_kind_id_digest_unique",
      "reconstruction_review_evidence_actor_idempotency_unique",
      "reconstruction_review_evidence_kind",
      "reconstruction_review_evidence_artifact_digest_shape",
      "reconstruction_review_evidence_object_digest_shape",
      "reconstruction_review_evidence_request_digest_shape",
      "reconstruction_review_evidence_digest_binding",
      "reconstruction_review_evidence_object_key",
      "reconstruction_review_evidence_size",
      "reconstruction_review_evidence_schema_version",
      "reconstruction_review_evidence_idempotency_key",
      "reconstruction_review_evidence_no_update",
      "reconstruction_review_evidence_no_delete",
      "reconstruction_attestations_id_exact_evidence_unique",
      "reconstruction_attestations_qa_fk",
      "reconstruction_publications_release_review_attestation_unique",
      "reconstruction_publications_id_release_scope_digest_unique",
      "reconstruction_publications_qa_fk",
      "reconstruction_channels_active_release_fk",
      "reconstruction_channels_active_publication_fk",
      "reconstruction_channel_events_revision_unique",
      "reconstruction_channel_events_idempotency_unique",
      "reconstruction_channel_events_resulting_revision",
      "reconstruction_releases_no_update",
      "reconstruction_releases_no_truncate",
      "reconstruction_qa_no_update",
      "reconstruction_qa_no_truncate",
      "reconstruction_reviews_no_update",
      "reconstruction_reviews_no_truncate",
      "reconstruction_review_evidence_no_truncate",
      "reconstruction_attestations_no_update",
      "reconstruction_attestations_no_truncate",
      "reconstruction_publications_no_update",
      "reconstruction_publications_no_truncate",
      "reconstruction_channel_events_no_update",
      "reconstruction_channel_events_no_truncate",
    ]) {
      expect(sql).toContain(requiredBoundary);
    }
    const compactSql = sql.replace(/\s+/gu, " ");
    for (const exactCompositeBoundary of [
      'CONSTRAINT "reconstruction_review_evidence_digest_binding" CHECK ( "artifact_digest" = "object_sha256" )',
      'CONSTRAINT "reconstruction_review_evidence_size" CHECK ( "size_bytes" > 0 AND "size_bytes" <= 4194304 )',
      'CONSTRAINT "reconstruction_reviews_qa_fk" FOREIGN KEY("qa_run_id", "release_id", "venue_slug", "release_kind", "qa_report_digest") REFERENCES "reconstruction_release_qa_runs"("id", "release_id", "venue_slug", "release_kind", "report_digest")',
      'CONSTRAINT "reconstruction_reviews_supersedes_release_fk" FOREIGN KEY("supersedes_review_id", "release_id") REFERENCES "reconstruction_release_reviews"("id", "release_id")',
      'CONSTRAINT "reconstruction_attestations_review_fk" FOREIGN KEY("review_id", "release_id", "venue_slug", "release_kind", "release_digest", "qa_report_digest", "review_digest") REFERENCES "reconstruction_release_reviews"("id", "release_id", "venue_slug", "release_kind", "release_digest", "qa_report_digest", "request_digest")',
      'CONSTRAINT "reconstruction_publications_review_fk" FOREIGN KEY("review_id", "release_id", "venue_slug", "release_kind", "release_digest", "qa_report_digest", "review_digest") REFERENCES "reconstruction_release_reviews"("id", "release_id", "venue_slug", "release_kind", "release_digest", "qa_report_digest", "request_digest")',
      'CONSTRAINT "reconstruction_publications_attestation_fk" FOREIGN KEY("attestation_id", "release_id", "venue_slug", "release_kind", "release_digest", "qa_report_digest", "review_id", "review_digest", "attestation_envelope_sha256") REFERENCES "reconstruction_release_attestations"("id", "release_id", "venue_slug", "release_kind", "release_digest", "qa_report_digest", "review_id", "review_digest", "envelope_sha256")',
      'CONSTRAINT "reconstruction_channels_active_publication_fk" FOREIGN KEY("active_publication_id", "active_release_id", "venue_slug", "release_kind", "active_release_digest") REFERENCES "reconstruction_release_publications"("id", "release_id", "venue_slug", "release_kind", "release_digest")',
      'CONSTRAINT "reconstruction_channel_events_from_publication_fk" FOREIGN KEY("from_publication_id", "from_release_id", "venue_slug", "release_kind", "from_release_digest") REFERENCES "reconstruction_release_publications"("id", "release_id", "venue_slug", "release_kind", "release_digest")',
      'CONSTRAINT "reconstruction_channel_events_to_publication_fk" FOREIGN KEY("to_publication_id", "to_release_id", "venue_slug", "release_kind", "to_release_digest") REFERENCES "reconstruction_release_publications"("id", "release_id", "venue_slug", "release_kind", "release_digest")',
    ]) {
      expect(compactSql).toContain(exactCompositeBoundary);
    }
    for (const appendOnlyTable of [
      "reconstruction_releases",
      "reconstruction_release_qa_runs",
      "reconstruction_release_reviews",
      "reconstruction_review_evidence_artifacts",
      "reconstruction_release_attestations",
      "reconstruction_release_publications",
      "reconstruction_release_channel_events",
    ]) {
      expect(compactSql).toContain(`BEFORE TRUNCATE ON "${appendOnlyTable}" FOR EACH STATEMENT`);
    }
    expect(drizzleForeignKeyShape(
      reconstructionReleaseAttestations,
      "reconstruction_attestations_review_fk",
    )).toEqual({
      columns: [
        "review_id",
        "release_id",
        "venue_slug",
        "release_kind",
        "release_digest",
        "qa_report_digest",
        "review_digest",
      ],
      foreignColumns: [
        "id",
        "release_id",
        "venue_slug",
        "release_kind",
        "release_digest",
        "qa_report_digest",
        "request_digest",
      ],
    });
    expect(drizzleForeignKeyShape(
      reconstructionReleasePublications,
      "reconstruction_publications_attestation_fk",
    )).toEqual({
      columns: [
        "attestation_id",
        "release_id",
        "venue_slug",
        "release_kind",
        "release_digest",
        "qa_report_digest",
        "review_id",
        "review_digest",
        "attestation_envelope_sha256",
      ],
      foreignColumns: [
        "id",
        "release_id",
        "venue_slug",
        "release_kind",
        "release_digest",
        "qa_report_digest",
        "review_id",
        "review_digest",
        "envelope_sha256",
      ],
    });
    expect(drizzleForeignKeyShape(
      reconstructionReleaseChannels,
      "reconstruction_channels_active_publication_fk",
    )).toEqual({
      columns: [
        "active_publication_id",
        "active_release_id",
        "venue_slug",
        "release_kind",
        "active_release_digest",
      ],
      foreignColumns: ["id", "release_id", "venue_slug", "release_kind", "release_digest"],
    });
    expect(drizzleForeignKeyShape(
      reconstructionReleaseChannelEvents,
      "reconstruction_channel_events_to_publication_fk",
    )).toEqual({
      columns: [
        "to_publication_id",
        "to_release_id",
        "venue_slug",
        "release_kind",
        "to_release_digest",
      ],
      foreignColumns: ["id", "release_id", "venue_slug", "release_kind", "release_digest"],
    });
    expect(sql).not.toContain('BEFORE UPDATE ON "reconstruction_release_channels"');
  });

  it("keeps migration 0057 evidence columns identical to the inert Drizzle schema", async () => {
    const sql = await readMigration("0057_foundry_derivative_execution_candidates");
    for (const table of DERIVATIVE_EXECUTION_CANDIDATE_TABLES) {
      const tableName = getTableName(table);
      expect(extractCreatedTableColumns(sql, tableName), tableName).toEqual(
        drizzleColumnNames(table),
      );
    }
  });

  it("keeps both feature migrations additive and pins their cross-table integrity boundaries", async () => {
    const [missionSql, architectSql, opsReviewSql] = await Promise.all([
      readMigration("0046_event_mission_control"),
      readMigration("0047_event_architect_proof"),
      readMigration("0048_event_architect_ops_reviews"),
    ]);
    const combined = `${missionSql}\n${architectSql}\n${opsReviewSql}`;

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
      "event_architect_candidates_id_run_unique",
      "event_architect_ops_reviews_reviewer_idempotency_unique",
      "event_architect_ops_reviews_candidate_run_fk",
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
