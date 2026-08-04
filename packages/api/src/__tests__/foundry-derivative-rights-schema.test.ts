import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import {
  computeFoundryDerivativeRightsPolicyRevocationSha256,
  computeFoundryDerivativeRightsPolicySha256,
  computeFoundryDerivativeRightsRestrictionSha256,
  foundryUsdNumberToMicroUsd,
  sha256Hex,
  stableCanonicalJson,
} from "@omnitwin/types";
import { getTableColumns, getTableName } from "drizzle-orm";
import { getTableConfig, type AnyPgColumn, type PgTable } from "drizzle-orm/pg-core";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import {
  foundryDerivativeRightsApprovals,
  foundryDerivativeRightsPolicyRevocations,
  foundryDerivativeRightsPolicyVersions,
} from "../db/schema.js";

const MIGRATION_TAG = "0054_foundry_derivative_rights";
const PREVIOUS_MIGRATION_TAG = "0053_foundry_execution_control";
const IMMUTABLE_0053_SHA256 =
  "6950a3a230dd0d2181f33296dac3bb5ff42ebbe070e5bdcd4d651f8c737ffa34";

const REGISTRY_TABLES = [
  foundryDerivativeRightsPolicyVersions,
  foundryDerivativeRightsPolicyRevocations,
  foundryDerivativeRightsApprovals,
] as const;

const REGISTRY_TABLE_NAMES = REGISTRY_TABLES.map((table) => getTableName(table));

const JournalSchema = z.object({
  entries: z.array(z.object({
    idx: z.number().int().nonnegative(),
    version: z.string(),
    when: z.number().int().positive(),
    tag: z.string(),
    breakpoints: z.boolean(),
  }).strict()),
}).passthrough();

const GOLDEN_POLICY = {
  schemaVersion: "omnitwin.foundry.derivative-rights-policy.v0",
  policyVersion: "derivative-rights-2026-07",
  generation: 1,
  effectiveAt: "2026-07-14T08:00:00.000Z",
  maximumApprovalTtlSeconds: 7_200,
  requireNonUnknownRightsBasis: true,
  requireHttpsTermsReference: true,
  requireTermsReviewedAt: true,
  authorizedActions: ["read_source", "create_internal_derivative"],
  forbiddenDownstreamUses: ["model_training", "redistribution", "public_release"],
  operations: [{
    operationId: "normalize_mesh_glb/v0",
    derivativeClass: "lossless_internal_format_normalization",
    requiredStageKind: "geometry",
    requiredInputType: "glb_gltf",
    requiredMediaType: "model/gltf-binary",
    requiredFileExtension: ".glb",
    requiredAssetCount: 1,
    requiredRightsPurposes: ["commercial_internal_use"],
    requiredCommand: ["omnitwin-sealed-worker", "normalize_mesh_glb", "v0"],
    requiredNetworkAccess: "none",
    deterministic: true,
  }],
} as const;

const GOLDEN_POLICY_SHA256 =
  "sha256:d60c18355be3b08bc9b54bf0c6c0543fd5640c3d58209363b72714a75659f5b8";
const GOLDEN_REVOCATION_SHA256 =
  "sha256:1db2544c8d5bdb835c4808d5b8f734fbcd4e5a15a51193dc0a19d94c471598df";
const GOLDEN_RESTRICTION_SHA256 =
  "sha256:3971427f6ec2960f1108006384d09a3471a6b3d81e728b41d2c824fd6f6a9951";
// Captured from PostgreSQL 16's foundry_ecmascript_domain_jsonb_sha256.
const POSTGRESQL_ECMASCRIPT_NUMERIC_GOLDEN_SHA256 =
  "sha256:bc7c15c2c39207bf55aeb1f339eef64a33dc15533c893eec8805fae7a5dd2ea1";

function extractCreatedTableColumns(sql: string, tableName: string): string[] {
  const body = new RegExp(`CREATE TABLE "${tableName}" \\(([\\s\\S]*?)\\r?\\n\\);`, "u")
    .exec(sql)?.[1];
  if (body === undefined) throw new Error(`Migration does not create table ${tableName}`);
  return [...body.matchAll(/^\s{2}"([^"]+)"\s/gmu)].map((match) => match[1] ?? "");
}

function extractTable(sql: string, tableName: string): string {
  const statement = new RegExp(
    `CREATE TABLE "${tableName}" \\([\\s\\S]*?\\r?\\n\\);`,
    "u",
  ).exec(sql)?.[0];
  if (statement === undefined) throw new Error(`Migration does not create table ${tableName}`);
  return statement;
}

function extractFunction(sql: string, functionName: string): string {
  const statement = new RegExp(
    `CREATE FUNCTION "${functionName}"\\([\\s\\S]*?\\r?\\n\\$\\$;`,
    "u",
  ).exec(sql)?.[0];
  if (statement === undefined) throw new Error(`Migration does not create function ${functionName}`);
  return statement;
}

function drizzleColumnNames(table: PgTable): string[] {
  return (Object.values(getTableColumns(table)) as AnyPgColumn[]).map((column) => column.name);
}

function foreignKeyShape(table: PgTable, name: string) {
  const key = getTableConfig(table).foreignKeys.find((candidate) => candidate.getName() === name);
  if (key === undefined) throw new Error(`Missing Drizzle foreign key ${name}`);
  const reference = key.reference();
  return {
    columns: reference.columns.map((column) => column.name),
    foreignColumns: reference.foreignColumns.map((column) => column.name),
  };
}

function normalized(sql: string): string {
  return sql.replace(/\s+/gu, " ").trim();
}

function withoutLineComments(sql: string): string {
  return sql.replace(/^\s*--.*$/gmu, "");
}

async function migrationSql(): Promise<string> {
  return readFile(resolve("drizzle", `${MIGRATION_TAG}.sql`), "utf8");
}

describe("Foundry derivative-rights registry migration", () => {
  it("remains the immutable predecessor of custody and preserves 0053 byte-for-byte", async () => {
    const [journalText, previousSql] = await Promise.all([
      readFile(resolve("drizzle/meta/_journal.json"), "utf8"),
      readFile(resolve("drizzle", `${PREVIOUS_MIGRATION_TAG}.sql`), "utf8"),
    ]);
    const journal = JournalSchema.parse(JSON.parse(journalText) as unknown);
    const previous = journal.entries.find((entry) => entry.tag === PREVIOUS_MIGRATION_TAG);
    const current = journal.entries.find((entry) => entry.tag === MIGRATION_TAG);
    const successor = journal.entries.find(
      (entry) => entry.tag === "0055_foundry_derivative_rights_custody",
    );

    expect(previous).toMatchObject({ idx: 51, tag: PREVIOUS_MIGRATION_TAG });
    expect(current).toMatchObject({ idx: 52, tag: MIGRATION_TAG, version: "7", breakpoints: true });
    expect(current?.when).toBeGreaterThan(previous?.when ?? 0);
    expect(successor).toMatchObject({ idx: 53, tag: "0055_foundry_derivative_rights_custody" });
    expect(successor?.when).toBeGreaterThan(current?.when ?? 0);
    expect(createHash("sha256").update(previousSql).digest("hex"))
      .toBe(IMMUTABLE_0053_SHA256);
  });

  it("creates exactly three additive registry tables aligned with Drizzle", async () => {
    const sql = await migrationSql();
    const executableSql = withoutLineComments(sql);
    const createdTables = [...sql.matchAll(/^CREATE TABLE "([^"]+)"/gmu)]
      .map((match) => match[1] ?? "");

    expect(createdTables).toEqual(REGISTRY_TABLE_NAMES);
    for (const table of REGISTRY_TABLES) {
      const tableName = getTableName(table);
      expect(extractCreatedTableColumns(sql, tableName), tableName)
        .toEqual(drizzleColumnNames(table));
    }
    expect(executableSql).not.toMatch(/\bALTER\s+TABLE\b/iu);
    expect(executableSql).not.toMatch(/\bDROP\s+(?:TABLE|FUNCTION|TRIGGER|INDEX)\b/iu);
    expect(executableSql).not.toMatch(/\bDELETE\s+FROM\b/iu);
  });

  it("keeps every registry explicitly non-authoritative", async () => {
    const sql = await migrationSql();
    for (const tableName of REGISTRY_TABLE_NAMES) {
      const table = extractTable(sql, tableName);
      expect(table).toContain('"authority" varchar(20) NOT NULL');
      expect(table).toContain('"authority" = \'none\'');
    }
    expect(sql.match(/"authority" = 'none'/gu)).toHaveLength(3);
  });

  it("keeps approvals independent from V0 execution, provider, and generic-rights authority", async () => {
    const sql = withoutLineComments(await migrationSql());
    const approvalTable = extractTable(sql, "foundry_derivative_rights_approvals");
    const approvalGuard = extractFunction(sql, "guard_foundry_derivative_approval");
    const executableBoundary = `${approvalTable}\n${approvalGuard}`;
    const references = [...approvalTable.matchAll(/REFERENCES\s+"([^"]+)"/gu)]
      .map((match) => match[1] ?? "");

    expect(references).toEqual([
      "users",
      "foundry_derivative_rights_policy_versions",
    ]);
    for (const forbiddenTable of [
      "foundry_jobs",
      "foundry_rights_policy_versions",
      "foundry_rights_policy_revocations",
      "foundry_rights_approvals",
      "foundry_executions",
      "foundry_execution_confirmations",
      "foundry_compute_approvals",
      "foundry_provider_commands",
      "foundry_prepared_provider_requests",
    ]) {
      expect(executableBoundary).not.toContain(`"${forbiddenTable}"`);
    }
    expect(approvalTable).not.toContain('"execution_id"');
    expect(approvalTable).not.toContain('"execution_subject_sha256"');

    const triggerTargets = [...sql.matchAll(
      /CREATE TRIGGER "[^"]+"[\s\S]*?\bON "([^"]+)"/gu,
    )].map((match) => match[1] ?? "");
    expect(new Set(triggerTargets)).toEqual(new Set(REGISTRY_TABLE_NAMES));
  });

  it("uses exact composite policy foreign keys, including the approval TTL", () => {
    expect(foreignKeyShape(
      foundryDerivativeRightsPolicyRevocations,
      "foundry_derivative_revocation_policy_fk",
    )).toEqual({
      columns: ["policy_version", "policy_definition_sha256", "policy_generation"],
      foreignColumns: ["policy_version", "policy_definition_sha256", "generation"],
    });
    expect(foreignKeyShape(
      foundryDerivativeRightsApprovals,
      "foundry_derivative_approval_policy_fk",
    )).toEqual({
      columns: [
        "policy_version",
        "policy_definition_sha256",
        "policy_generation",
        "policy_maximum_approval_ttl_seconds",
      ],
      foreignColumns: [
        "policy_version",
        "policy_definition_sha256",
        "generation",
        "maximum_approval_ttl_seconds",
      ],
    });
  });

  it("serializes policy mutation and uses the earliest append-only revocation", async () => {
    const sql = await migrationSql();
    const policyGuard = extractFunction(sql, "guard_foundry_derivative_policy_version");
    const revocationGuard = extractFunction(sql, "guard_foundry_derivative_policy_revocation");
    const approvalGuard = extractFunction(sql, "guard_foundry_derivative_approval");
    const lockCall =
      'PERFORM "foundry_lock_derivative_rights_policy_version"(NEW."policy_version");';

    for (const guard of [policyGuard, revocationGuard, approvalGuard]) {
      expect(guard).toContain(lockCall);
    }
    expect(extractFunction(sql, "foundry_lock_derivative_rights_policy_version"))
      .toContain("pg_advisory_xact_lock");
    expect(approvalGuard).toMatch(/SELECT min\(revocation\."revoked_at"\)/u);
    expect(normalized(approvalGuard)).toContain(
      'earliest_revoked_at <= NEW."registered_at" OR NEW."expires_at" > earliest_revoked_at',
    );
    expect(normalized(approvalGuard)).toContain(
      'policy."effective_at" <= NEW."registered_at" ORDER BY policy."effective_at" DESC, policy."generation" DESC LIMIT 1',
    );
    expect(approvalGuard).toContain(
      "derivative-rights approval must use the current effective policy generation",
    );

    expect(normalized(revocationGuard)).toContain(
      'IF NEW."revoked_at" <= policy_effective_at THEN',
    );
    expect(normalized(revocationGuard)).not.toContain(
      'NEW."revoked_at" <= NEW."recorded_at"',
    );
    expect(normalized(revocationGuard)).not.toContain(
      'NEW."revoked_at" <= clock_timestamp()',
    );
    expect(normalized(revocationGuard)).not.toContain('NEW."revoked_at" <= now()');

    const revocationTable = normalized(extractTable(
      sql,
      "foundry_derivative_rights_policy_revocations",
    ));
    expect(revocationTable).toContain(
      'UNIQUE( "policy_version", "policy_definition_sha256", "policy_generation", "revocation_sha256" )',
    );
    expect(revocationTable).not.toContain("one_revocation_unique");
  });

  it("makes all three registries append-only across update, delete, and truncate", async () => {
    const sql = await migrationSql();
    for (const tableName of REGISTRY_TABLE_NAMES) {
      for (const event of ["UPDATE", "DELETE", "TRUNCATE"]) {
        const rowMode = event === "TRUNCATE" ? "STATEMENT" : "ROW";
        expect(normalized(sql)).toMatch(new RegExp(
          `BEFORE ${event} ON "${tableName}" FOR EACH ${rowMode} EXECUTE FUNCTION "deny_foundry_append_only_mutation"\\(\\)`,
          "u",
        ));
      }
    }
  });

  it("enforces closed policy, revocation, approval, evidence, and artifact JSON", async () => {
    const sql = await migrationSql();
    const policyGuard = normalized(extractFunction(
      sql,
      "guard_foundry_derivative_policy_version",
    ));
    const revocationGuard = normalized(extractFunction(
      sql,
      "guard_foundry_derivative_policy_revocation",
    ));
    const approvalGuard = normalized(extractFunction(sql, "guard_foundry_derivative_approval"));

    expect(policyGuard).toContain(
      '"foundry_jsonb_object_key_count"(NEW."policy_definition_json") <> 11',
    );
    for (const key of [
      "schemaVersion",
      "policyVersion",
      "generation",
      "effectiveAt",
      "maximumApprovalTtlSeconds",
      "requireNonUnknownRightsBasis",
      "requireHttpsTermsReference",
      "requireTermsReviewedAt",
      "authorizedActions",
      "forbiddenDownstreamUses",
      "operations",
    ]) {
      expect(policyGuard).toContain(`'${key}'`);
    }
    expect(policyGuard).toContain(
      'NEW."policy_definition_json"->\'authorizedActions\' IS DISTINCT FROM \'["read_source","create_internal_derivative"]\'::jsonb',
    );
    expect(policyGuard).toContain(
      'NEW."policy_definition_json"->\'forbiddenDownstreamUses\' IS DISTINCT FROM \'["model_training","redistribution","public_release"]\'::jsonb',
    );
    expect(policyGuard).toContain(
      'NEW."policy_definition_json"->\'operations\' IS DISTINCT FROM \'[{',
    );
    for (const exactBinding of [
      '"operationId":"normalize_mesh_glb/v0"',
      '"requiredAssetCount":1',
      '"requiredRightsPurposes":["commercial_internal_use"]',
      '"requiredCommand":["omnitwin-sealed-worker","normalize_mesh_glb","v0"]',
      '"requiredNetworkAccess":"none"',
    ]) {
      expect(policyGuard).toContain(exactBinding);
    }

    expect(revocationGuard).toContain(
      '"foundry_jsonb_object_key_count"(NEW."revocation_json") <> 8',
    );
    for (const key of [
      "schemaVersion",
      "revocationId",
      "policyVersion",
      "policyDefinitionSha256",
      "policyGeneration",
      "revokedAt",
      "revokedBy",
      "reason",
    ]) {
      expect(revocationGuard).toContain(`'${key}'`);
    }

    expect(approvalGuard).toContain(
      '"foundry_jsonb_object_key_count"( NEW."derivative_rights_approval_json" ) <> 18',
    );
    for (const key of [
      "schemaVersion",
      "approvalId",
      "policyVersion",
      "policyDefinitionSha256",
      "policyGeneration",
      "jobSubjectSha256",
      "ingestManifestSha256",
      "stageId",
      "operation",
      "authorizedActions",
      "forbiddenDownstreamUses",
      "assetIds",
      "assetRightsEvidence",
      "assetSnapshots",
      "decision",
      "decidedBy",
      "decidedAt",
      "expiresAt",
    ]) {
      expect(approvalGuard).toContain(`'${key}'`);
    }
    expect(approvalGuard).toContain(
      '"foundry_jsonb_object_key_count"( NEW."derivative_rights_approval_json"->\'operation\' ) <> 2',
    );
    expect(approvalGuard).toContain(
      'NEW."derivative_rights_approval_json"->\'authorizedActions\' IS DISTINCT FROM \'["read_source","create_internal_derivative"]\'::jsonb',
    );
    expect(approvalGuard).toContain(
      'NEW."derivative_rights_approval_json"->\'forbiddenDownstreamUses\' IS DISTINCT FROM \'["model_training","redistribution","public_release"]\'::jsonb',
    );
    expect(approvalGuard).toContain(
      'NEW."derivative_rights_approval_json"->\'assetIds\' IS DISTINCT FROM jsonb_build_array(NEW."asset_id")',
    );
    expect(approvalGuard).toContain(
      'jsonb_array_length( NEW."derivative_rights_approval_json"->\'assetRightsEvidence\' ) <> 1',
    );
    expect(approvalGuard).toContain(
      'jsonb_array_length( NEW."derivative_rights_approval_json"->\'assetSnapshots\' ) <> 1',
    );
    expect(approvalGuard).not.toContain('"foundry_is_ingest_asset_array"(');
    expect(approvalGuard).toContain(
      '"foundry_jsonb_object_key_count"(bound_evidence) <> 7',
    );
    expect(approvalGuard).toContain(
      '"foundry_jsonb_object_key_count"(bound_artifact) <> 5',
    );
    expect(approvalGuard).toContain("bound_snapshot IS DISTINCT FROM bound_asset");
    expect(approvalGuard).toContain(
      '"foundry_is_derivative_restriction_dispositions_v0"(',
    );
  });

  it("validates JobSpec and manifest subjects locally with the singleton GLB stage", async () => {
    const sql = await migrationSql();
    const approvalGuard = normalized(extractFunction(
      sql,
      "guard_foundry_derivative_approval",
    ));
    const manifestValidator = normalized(extractFunction(
      sql,
      "foundry_is_derivative_execution_ingest_manifest_v0",
    ));

    for (const boundary of [
      '"foundry_jsonb_object_key_count"(NEW."job_spec_json") <> 16',
      '"foundry_is_job_stage_array"(NEW."job_spec_json"->\'stages\') IS NOT TRUE',
      'NEW."job_spec_json"->>\'executionIntent\' NOT IN (\'plan_only\', \'execute\')',
      'NEW."job_spec_json"->>\'sourceMountMode\' IS DISTINCT FROM \'read_only\'',
      'estimated_cost_usd * 1000000::double precision > 9007199254740991::double precision',
      'budget_cap_usd * 1000000::double precision > 9007199254740991::double precision',
      '"foundry_is_derivative_execution_ingest_manifest_v0"( NEW."ingest_manifest_json" ) IS NOT TRUE',
      'NEW."ingest_manifest_json"->>\'projectId\' IS DISTINCT FROM NEW."project_id"',
      'NEW."ingest_manifest_json"->>\'legalReviewState\' = \'blocked\'',
      'stage.value->\'rightsPurposes\' ?| ARRAY[ \'model_training\', \'redistribution\', \'public_release\' ]',
      'asset.asset_value->>\'accessState\' = \'blocked_legal\'',
      'asset.asset_value->\'rights\'->>\'commercialUse\' <> \'allowed\'',
      'bound_stage->>\'kind\' IS DISTINCT FROM \'geometry\'',
      'bound_stage->\'command\' IS DISTINCT FROM \'["omnitwin-sealed-worker","normalize_mesh_glb","v0"]\'::jsonb',
      'bound_stage->>\'networkAccess\' IS DISTINCT FROM \'none\'',
      'bound_stage->\'rightsPurposes\' IS DISTINCT FROM \'["commercial_internal_use"]\'::jsonb',
      'bound_stage->\'inputAssetIds\' IS DISTINCT FROM jsonb_build_array(NEW."asset_id")',
      'bound_asset->>\'inputType\' IS DISTINCT FROM \'glb_gltf\'',
      'bound_asset->>\'mediaType\' IS DISTINCT FROM \'model/gltf-binary\'',
      'right(lower(bound_asset->>\'relativePath\'), 4) IS DISTINCT FROM \'.glb\'',
    ]) {
      expect(approvalGuard).toContain(boundary);
    }
    expect(approvalGuard).toContain("estimated_cost_usd double precision");
    expect(approvalGuard).toContain("budget_cap_usd double precision");
    expect(approvalGuard).not.toContain("estimated_cost_usd * 1000000 <>");
    expect(approvalGuard).not.toContain("budget_cap_usd * 1000000 <>");
    expect(manifestValidator).toContain(
      "asset.value->'rights'->>'termsReference' ~* '^https://'",
    );
    expect(manifestValidator).toContain(
      'IF "foundry_is_execution_ingest_manifest"(normalized_manifest) IS NOT TRUE THEN',
    );
    for (const exactDerivativeManifestBoundary of [
      "value_input->'coordinateFrames' IS DISTINCT FROM '[]'::jsonb",
      "value_input->'transforms' IS DISTINCT FROM '[]'::jsonb",
      "value_input->'provenanceEdges' IS DISTINCT FROM '[]'::jsonb",
      "value_input->'generatedRegions' IS DISTINCT FROM '[]'::jsonb",
      '"foundry_jsonb_object_key_count"(root.value) <> 6',
      "'id', 'kind', 'displayName', 'locationRedacted', 'caseSensitivity', 'readOnly'",
      "asset.value->'coordinateFrameId' IS DISTINCT FROM 'null'::jsonb",
      "asset.value->'calibrationAssetIds' IS DISTINCT FROM '[]'::jsonb",
      "asset.value->'parentAssetIds' IS DISTINCT FROM '[]'::jsonb",
      "asset.value->>'captureState' NOT IN ( 'raw_capture', 'official_export', 'reference' )",
      "asset.value->>'provenanceClass' NOT IN ( 'captured', 'enhanced_captured' )",
      "FROM jsonb_array_elements_text( asset.value->'rights'->'restrictions' ) restriction(value)",
      "asset.value->'inspection'->>'decisiveNextTest', 1, 1000",
      "FROM jsonb_array_elements_text(asset.value->'notes') note(value)",
      "count(*) <> count(DISTINCT root.value->>'id')",
      "count(*) <> count(DISTINCT jsonb_build_array(",
      "value_input->>'legalReviewState' = 'approved'",
      "asset.value->'rights'->'termsReference' = 'null'::jsonb",
    ]) {
      expect(manifestValidator).toContain(exactDerivativeManifestBoundary);
    }
    expect(manifestValidator).toContain(
      "!~* '^https://[a-z0-9]{1,63}(\\.[a-z0-9]{1,63})?\\.[a-z]{2,63}",
    );
  });

  it("uses only ECMAScript-canonical domain digests for every frozen subject", async () => {
    const sql = await migrationSql();
    const digestDomains = [...sql.matchAll(
      /"foundry_ecmascript_domain_jsonb_sha256"\(\s*'([^']+)'/gu,
    )].map((match) => match[1] ?? "");

    expect(digestDomains).toEqual([
      "omnitwin.foundry.derivative-rights-restriction.v0",
      "omnitwin.foundry.job-spec.v0",
      "omnitwin.foundry.job-approval-subject.v0",
      "omnitwin.foundry.ingest-manifest.v0",
      "omnitwin.foundry.derivative-rights-approval.v0",
      "omnitwin.foundry.derivative-rights-approval-registration.v0",
      "omnitwin.foundry.derivative-rights-policy.v0",
      "omnitwin.foundry.derivative-rights-policy-registration.v0",
      "omnitwin.foundry.derivative-rights-policy-revocation.v0",
      "omnitwin.foundry.derivative-rights-revocation-registration.v0",
    ]);
    expect(sql).not.toMatch(/"foundry_domain_jsonb_sha256"\s*\(/u);
  });

  it("pins canonical TypeScript policy, revocation, and restriction digest vectors", () => {
    const revocation = {
      schemaVersion: "omnitwin.foundry.derivative-rights-policy-revocation.v0",
      revocationId: "derivative-rights-revocation",
      policyVersion: GOLDEN_POLICY.policyVersion,
      policyDefinitionSha256: GOLDEN_POLICY_SHA256,
      policyGeneration: GOLDEN_POLICY.generation,
      revokedAt: "2026-07-14T11:30:00.000Z",
      revokedBy: "rights-reviewer@example.test",
      reason: "The source owner withdrew permission for further derivatives.",
    } as const;

    expect(computeFoundryDerivativeRightsPolicySha256(GOLDEN_POLICY))
      .toBe(GOLDEN_POLICY_SHA256);
    expect(computeFoundryDerivativeRightsPolicyRevocationSha256(revocation))
      .toBe(GOLDEN_REVOCATION_SHA256);
    expect(computeFoundryDerivativeRightsRestrictionSha256({
      assetId: "mesh-a",
      restrictionIndex: 0,
      restrictionText: "Internal lossless derivatives only.",
    })).toBe(GOLDEN_RESTRICTION_SHA256);
  });

  it("matches the PostgreSQL ECMAScript canonicalizer on numeric edge spellings", () => {
    const numericVector = {
      numbers: [
        1e-7,
        0.000001,
        100000000000000000000,
        1e21,
        Number("333333333.33333329"),
        -0,
      ],
    };
    const typesDigest = `sha256:${sha256Hex(
      `omnitwin.foundry.job-spec.v0\n${stableCanonicalJson(numericVector)}`,
    )}`;

    expect(typesDigest).toBe(POSTGRESQL_ECMASCRIPT_NUMERIC_GOLDEN_SHA256);
    expect(foundryUsdNumberToMicroUsd(Number("9007199254.740991"))).toBeNull();
    expect(foundryUsdNumberToMicroUsd(Number("9007199254.74099")))
      .toBe("9007199254740990");
    expect(foundryUsdNumberToMicroUsd(Number("5758141201.9515085")))
      .toBe("5758141201951509");
  });
});
