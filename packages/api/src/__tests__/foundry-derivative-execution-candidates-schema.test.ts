import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { stableCanonicalJson } from "@omnitwin/types";
import { describe, expect, it } from "vitest";
import { z } from "zod";

const MIGRATION_TAG = "0057_foundry_derivative_execution_candidates";
const IMMUTABLE_MIGRATION_SHA256 = {
  "0053_foundry_execution_control.sql":
    "6950a3a230dd0d2181f33296dac3bb5ff42ebbe070e5bdcd4d651f8c737ffa34",
  "0054_foundry_derivative_rights.sql":
    "05e80543a52978c9b01ab277257ca7eed7bd8a2f37dbedfdeee06fa1c730bdb4",
  "0055_foundry_derivative_rights_custody.sql":
    "47602cf4ef2973a5e8588759519ca6cef3c7d7dd2f52c463ceea3eb4667db2e7",
  "0056_foundry_derivative_execution_barrier.sql":
    "3075ba5895283dd6a15407e4aa3edb44073fe7125a69a541d125579efef7a78d",
} as const;

const JournalSchema = z
  .object({
    entries: z.array(
      z
        .object({
          idx: z.number().int().nonnegative(),
          tag: z.string(),
        })
        .passthrough(),
    ),
  })
  .passthrough();

function withoutLineComments(sql: string): string {
  return sql.replace(/^--.*$/gmu, "");
}

function functionBody(sql: string, functionName: string): string {
  const start = sql.indexOf(`CREATE FUNCTION "${functionName}"`);
  if (start < 0) throw new Error(`Missing function ${functionName}`);
  const end = sql.indexOf("\n$$;", start);
  if (end < 0) throw new Error(`Unterminated function ${functionName}`);
  return sql.slice(start, end + 4);
}

function expectBefore(haystack: string, first: string, second: string): void {
  const firstIndex = haystack.indexOf(first);
  const secondIndex = haystack.indexOf(second);
  expect(firstIndex, `missing earlier marker: ${first}`).toBeGreaterThanOrEqual(0);
  expect(secondIndex, `missing later marker: ${second}`).toBeGreaterThanOrEqual(0);
  expect(firstIndex).toBeLessThan(secondIndex);
}

describe("Foundry derivative execution-candidate evidence migration", () => {
  it("is journaled immediately before the activation-disabled tail and preserves every accepted predecessor byte", async () => {
    const [journalText, ...migrationTexts] = await Promise.all([
      readFile(resolve("drizzle/meta/_journal.json"), "utf8"),
      ...Object.keys(IMMUTABLE_MIGRATION_SHA256).map((fileName) =>
        readFile(resolve("drizzle", fileName), "utf8"),
      ),
    ]);
    const journal = JournalSchema.parse(JSON.parse(journalText) as unknown);
    expect(journal.entries.at(-4)).toMatchObject({
      idx: 53,
      tag: "0055_foundry_derivative_rights_custody",
    });
    expect(journal.entries.at(-3)).toMatchObject({
      idx: 54,
      tag: "0056_foundry_derivative_execution_barrier",
    });
    expect(journal.entries.at(-2)).toMatchObject({
      idx: 55,
      tag: MIGRATION_TAG,
    });
    expect(journal.entries.at(-1)).toMatchObject({
      idx: 56,
      tag: "0058_foundry_derivative_activation_disabled",
    });
    for (const [index, expectedSha256] of Object.values(
      IMMUTABLE_MIGRATION_SHA256,
    ).entries()) {
      expect(createHash("sha256").update(migrationTexts[index] ?? "").digest("hex")).toBe(
        expectedSha256,
      );
    }
  });

  it("adds only inert registry, revocation, and reservation evidence tables", async () => {
    const sql = await readFile(resolve("drizzle", `${MIGRATION_TAG}.sql`), "utf8");
    const executable = withoutLineComments(sql);
    expect([...executable.matchAll(/^CREATE TABLE "([^"]+)"/gmu)].map((match) => match[1])).toEqual([
      "foundry_derivative_rights_registry_attestations_v1",
      "foundry_derivative_rights_registry_attestation_revocations_v1",
      "foundry_derivative_execution_authorization_candidates_v1",
    ]);
    expect([...executable.matchAll(/^CREATE FUNCTION "([^"]+)"/gmu)].map((match) => match[1])).toEqual([
      "guard_foundry_derivative_registry_attestation_v1",
      "guard_foundry_derivative_registry_attestation_revocation_v1",
      "guard_foundry_derivative_execution_candidate_v1",
    ]);

    for (const forbiddenTable of [
      "foundry_executions",
      "foundry_attempts",
      "foundry_execution_attempts",
      "foundry_prepared_provider_requests",
      "foundry_provider_commands",
      "foundry_provider_command_result_observations",
      "foundry_provider_command_result_classifications",
      "foundry_providers",
      "foundry_provider_releases",
      "foundry_provider_adapter_artifacts",
      "foundry_provider_deployments",
      "foundry_provider_request_profiles",
      "reconstruction_releases",
      "reconstruction_release_qa_runs",
      "reconstruction_release_reviews",
      "reconstruction_release_attestations",
      "reconstruction_release_publications",
      "reconstruction_release_channels",
      "reconstruction_release_channel_events",
    ]) {
      expect(executable).not.toContain(`"${forbiddenTable}"`);
    }
    expect(executable).not.toMatch(/"execution_eligible"\s*=\s*true/u);
    expect(executable).toContain('"execution_eligible" = false');
    expect(executable).toContain('"authority" = \'none\'');
    expect(executable).toContain('"dispatch_enabled" = false');
    expect(executable).toContain('"output_disposition" = \'quarantine_only\'');
    expect(executable).toContain(
      '"registry_authority" = \'authenticated_registry_attestation_v1\'',
    );
  });

  it("keeps SQL domain digests byte-identical to TypeScript canonicalization", () => {
    const fixture = {
      z: [3, { x: true }],
      a: "é",
      n: 1.5,
      nil: null,
    };
    const expectedSqlDigests = new Map([
      [
        "omnitwin.foundry.derivative-rights-registry-attestation.v1",
        "sha256:5927ee0a3c1dfba33eda675da71bf70c6aad185d42c68a9cde808bcdd0430796",
      ],
      [
        "omnitwin.foundry.derivative-rights-registry-attestation-revocation.v1",
        "sha256:52c16983736ac3c55f0b173120457578fbd2773c7b7ffed2ebaa389f03424693",
      ],
      [
        "omnitwin.foundry.derivative-execution-authorization-candidate.v1",
        "sha256:8138af3a7db4c7463f7a9422ae188e029a3231dbb9562e736aa792aa34454adb",
      ],
    ]);
    for (const [domain, sqlDigest] of expectedSqlDigests) {
      const typescriptDigest = `sha256:${createHash("sha256")
        .update(`${domain}\n${stableCanonicalJson(fixture)}`)
        .digest("hex")}`;
      expect(typescriptDigest).toBe(sqlDigest);
    }
  });

  it("derives authenticated attestations and revocations from current locked 0054/0055 evidence", async () => {
    const sql = await readFile(resolve("drizzle", `${MIGRATION_TAG}.sql`), "utf8");
    const attestation = functionBody(
      sql,
      "guard_foundry_derivative_registry_attestation_v1",
    );
    const revocation = functionBody(
      sql,
      "guard_foundry_derivative_registry_attestation_revocation_v1",
    );

    expect(attestation).toContain("actor_platform_role IS DISTINCT FROM 'admin'");
    expect(attestation).toContain("accepted_for_registry_attestation");
    expect(attestation).toContain('approval_row."expires_at" <= database_now');
    expect(attestation).toContain(
      'FROM "foundry_derivative_rights_policy_revocations" revocation',
    );
    expect(attestation).toContain(
      "current_policy_generation IS DISTINCT FROM approval_row.\"policy_generation\"",
    );
    expect(attestation).toContain("'reviewReceiptSha256'");
    expect(attestation).toContain("'custodyReceiptSha256'");
    expect(attestation).toContain(
      "'omnitwin.foundry.derivative-rights-registry-attestation-registration-request.v1'",
    );
    expect(attestation).toContain(
      "'omnitwin.foundry.derivative-rights-registry-attestation.v1'",
    );
    expect(attestation).toContain('NEW."registry_attestation_json" := expected_attestation');
    expect(attestation).toContain('NEW."registry_attestation_sha256" :=');
    expectBefore(
      attestation,
      'PERFORM "foundry_lock_derivative_rights_policy_version"',
      "database_now := date_trunc('milliseconds', clock_timestamp())",
    );

    expect(revocation).toContain('WHERE "id" = NEW."attestation_id"');
    expect(revocation).toContain("FOR UPDATE;");
    expect(revocation).toContain(
      "'omnitwin.foundry.derivative-rights-registry-attestation-revocation-request.v1'",
    );
    expect(revocation).toContain(
      "'omnitwin.foundry.derivative-rights-registry-attestation-revocation.v1'",
    );
    expect(revocation).toContain('NEW."attestation_revocation_json" := expected_revocation');
    expect(revocation).toContain('NEW."attestation_revocation_sha256" :=');
    expectBefore(
      revocation,
      'PERFORM "foundry_lock_derivative_rights_policy_version"',
      "database_now := date_trunc('milliseconds', clock_timestamp())",
    );
  });

  it("assembles only the exact singleton normalization binding and DB-derived single-use receipt", async () => {
    const sql = await readFile(resolve("drizzle", `${MIGRATION_TAG}.sql`), "utf8");
    const candidate = functionBody(
      sql,
      "guard_foundry_derivative_execution_candidate_v1",
    );

    expect(candidate).toContain(
      '"foundry_classify_normalize_mesh_glb_v0_job_spec"(',
    );
    expect(candidate).toContain("'normalize_mesh_glb_v0_exact'");
    expect(candidate).toContain("jsonb_array_length(job_row.\"job_spec_json\"->'stages') <> 1");
    expect(candidate).toContain(
      `'["omnitwin-sealed-worker","normalize_mesh_glb","v0"]'::jsonb`,
    );
    expect(candidate).toContain("worker_row.\"network_access\" IS DISTINCT FROM 'none'");
    expect(candidate).toContain('job_worker_row."operation_class"');
    expect(candidate).toContain("IS DISTINCT FROM 'deterministic_transformation'");
    expect(candidate).toContain(
      '"foundry_jsonb_object_key_count"(NEW."base_execution_subject_json") <> 28',
    );
    expect(candidate).toContain("'OMNITWIN_FOUNDRY_EXECUTION_SUBJECT_V0'");
    expect(candidate).toContain("'maximumAttempts'");
    expect(candidate).toContain("'checkpointContract'");
    expect(candidate).toContain("'budgetPolicy'");
    expect(candidate).toContain("'workerProfileSha256s'");

    for (const domain of [
      "omnitwin.foundry.derivative-execution-binding-set.v1",
      "omnitwin.foundry.derivative-restriction-lineage-set.v1",
      "omnitwin.foundry.derivative-quarantine-output-policy.v1",
      "omnitwin.foundry.derivative-execution-authorization-candidate-reservation-request.v1",
      "omnitwin.foundry.derivative-candidate-reservation-receipt.v1",
      "omnitwin.foundry.derivative-execution-authorization-candidate.v1",
    ]) {
      expect(candidate).toContain(`'${domain}'`);
    }
    for (const derivedColumn of [
      "binding_set",
      "restriction_lineage_set",
      "output_policy",
      "candidate_reservation_receipt",
      "candidate",
    ]) {
      expect(candidate).toContain(`NEW."${derivedColumn}_json" :=`);
      expect(candidate).toContain(`NEW."${derivedColumn}_sha256" :=`);
    }
    expect(candidate).toContain("'reservationOrdinal', 1");
    expect(candidate).toContain("'singleReservation', true");
    expect(candidate).toContain(
      "'reservationScope', 'authority_none_candidate_reservation'",
    );
    expect(candidate).toContain("'executionActivationRecorded', false");
    expect(candidate).toContain(
      "'lineageDisposition', 'preserve_on_quarantined_derivative'",
    );
    expect(candidate).toContain(
      "'authorityRevalidationRequiredAtOutputCommit', true",
    );

    expectBefore(
      candidate,
      'FROM "foundry_derivative_rights_registry_attestations_v1"',
      'PERFORM "foundry_lock_derivative_rights_policy_version"',
    );
    expectBefore(
      candidate,
      'PERFORM "foundry_lock_derivative_rights_policy_version"',
      "database_now := date_trunc('milliseconds', clock_timestamp())",
    );
    expect(candidate).toContain(
      'FROM "foundry_derivative_rights_registry_attestation_revocations_v1" revocation',
    );
    expect(candidate).toContain('approval_row."expires_at" <= database_now');
    expect(candidate).toContain('attestation_row."attested_at" > database_now');
    expect(candidate).toContain(
      'attestation_row."approval_expires_at" <= database_now',
    );
  });

  it("makes duplicate reservations single-winner and serializes both attestation-revocation orderings", async () => {
    const sql = await readFile(resolve("drizzle", `${MIGRATION_TAG}.sql`), "utf8");
    const candidate = functionBody(
      sql,
      "guard_foundry_derivative_execution_candidate_v1",
    );
    const revocation = functionBody(
      sql,
      "guard_foundry_derivative_registry_attestation_revocation_v1",
    );

    for (const uniqueIdentity of [
      'UNIQUE("review_id")',
      'UNIQUE("approval_id")',
      'UNIQUE("attestation_id")',
      'UNIQUE("base_execution_subject_sha256")',
    ]) {
      expect(sql).toContain(uniqueIdentity);
    }
    expect(candidate).toContain(
      'FROM "foundry_derivative_rights_registry_attestations_v1"',
    );
    expect(candidate).toContain("FOR SHARE;");
    expect(revocation).toContain(
      'FROM "foundry_derivative_rights_registry_attestations_v1"',
    );
    expect(revocation).toContain("FOR UPDATE;");
    expectBefore(
      candidate,
      "FOR SHARE;",
      'FROM "foundry_derivative_rights_registry_attestation_revocations_v1" revocation',
    );
    expectBefore(
      revocation,
      "FOR UPDATE;",
      'NEW."attestation_revocation_json" := expected_revocation',
    );
  });

  it("enforces one-time identities and append-only evidence on all three tables", async () => {
    const sql = await readFile(resolve("drizzle", `${MIGRATION_TAG}.sql`), "utf8");
    for (const identity of [
      'UNIQUE("review_id")',
      'UNIQUE("approval_id")',
      'UNIQUE("attestation_id")',
      'UNIQUE("base_execution_subject_sha256")',
      'UNIQUE("reservation_id")',
      'UNIQUE("candidate_reservation_receipt_sha256")',
      'UNIQUE("reserved_by_user_id", "idempotency_key")',
    ]) {
      expect(sql).toContain(identity);
    }
    for (const trigger of [
      "foundry_derivative_registry_attestation_guard",
      "foundry_derivative_registry_attestation_revocation_guard",
      "foundry_derivative_execution_candidate_guard",
      "foundry_derivative_registry_attestations_no_update",
      "foundry_derivative_registry_attestations_no_delete",
      "foundry_derivative_registry_attestations_no_truncate",
      "foundry_derivative_registry_attestation_revocations_no_update",
      "foundry_derivative_registry_attestation_revocations_no_delete",
      "foundry_derivative_registry_attestation_revocations_no_truncate",
      "foundry_derivative_execution_candidates_no_update",
      "foundry_derivative_execution_candidates_no_delete",
      "foundry_derivative_execution_candidates_no_truncate",
    ]) {
      expect(sql).toContain(`CREATE TRIGGER "${trigger}"`);
    }
    expect(sql.match(/EXECUTE FUNCTION "deny_foundry_append_only_mutation"\(\)/gu)).toHaveLength(9);
  });
});
