import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const MIGRATION_PATH = resolve(
  "drizzle",
  "0067_historical_runtime_reviewed_profiles.sql",
);

const PROFILE_TABLES = [
  "hr_reviewed_profile_subjects",
  "hr_reviewed_profile_actors",
  "hr_reviewed_profile_members",
  "hr_reviewed_profiles",
] as const;

const NEW_FUNCTIONS = [
  "hr_assert_profile_qa_reviewer_current",
  "hr_assert_profile_package_custodian_current",
  "hr_assert_profile_graph_complete",
  "hr_profile_graph_deferred_guard",
  "hr_issue_reviewed_profile_subject",
  "hr_populate_reviewed_profile_children",
  "hr_assert_reviewed_profile_subject_current",
  "hr_assert_reviewed_profile_current",
  "hr_issue_reviewed_profile",
] as const;

const EXPLICIT_TRIGGERS = [
  "hr_profile_subject_graph_complete",
  "hr_profile_actor_graph_complete",
  "hr_profile_member_graph_complete",
  "hr_profile_final_graph_complete",
  "b_hr_issue_reviewed_profile_subject",
  "c_hr_populate_reviewed_profile_children",
  "b_hr_issue_reviewed_profile",
  "a0_hr_require_profile_subject_verifier",
  "a0_hr_require_profile_final_verifier",
] as const;

function requiredCapture(match: RegExpMatchArray | null): string {
  const value = match?.[1];
  if (value === undefined) throw new Error("0067 boundary regex lost a capture.");
  return value;
}

function occurrences(value: string, needle: string): number {
  return value.split(needle).length - 1;
}

describe("historical-runtime 0067 reviewed-profile SQL boundary", () => {
  it("pins the compile candidate and exact profile-only inventory", async () => {
    const migration = await readFile(MIGRATION_PATH, "utf8");

    expect(Buffer.byteLength(migration, "utf8")).toBe(162_112);
    expect(createHash("sha256").update(migration, "utf8").digest("hex")).toBe(
      "5fc17b64558d13c054a92db41785278ae534d296b86d55ac7b38b1073c8a23d3",
    );
    expect([...migration.matchAll(/^CREATE TABLE "([a-z0-9_]+)" \(/gmu)]
      .map((match) => requiredCapture(match))).toEqual(PROFILE_TABLES);

    const functionNames = [...migration.matchAll(
      /^CREATE OR REPLACE FUNCTION\s+(?:public\.)?"?([a-z0-9_]+)"?\s*\(/gmu,
    )].map((match) => requiredCapture(match));
    expect(functionNames).toEqual([
      "hr_assert_evidence_record_leaf_exact",
      ...NEW_FUNCTIONS,
    ]);
    expect(new Set(functionNames)).toHaveLength(10);

    const explicitTriggers = [...migration.matchAll(
      /^CREATE (?:CONSTRAINT )?TRIGGER "([a-z0-9_]+)"/gmu,
    )].map((match) => requiredCapture(match));
    expect(explicitTriggers).toEqual(EXPLICIT_TRIGGERS);
    expect(migration).toContain("<> 17 THEN");
    expect(occurrences(migration, "CREATE TRIGGER z_hr_reject_row_mutation"))
      .toBe(1);
    expect(occurrences(migration, "CREATE TRIGGER z_hr_reject_truncate"))
      .toBe(1);
  });

  it("keeps the slice free of execution, layout, action, and quarantine authority", async () => {
    const migration = await readFile(MIGRATION_PATH, "utf8");
    for (const forbidden of [
      "hr_execution",
      "execution_activation",
      "execution_subject",
      "execution_draft",
      "phase_layout",
      "layout_receipt",
      "legacy_activation",
      "quarantine",
      "hr_authenticated_action",
    ]) {
      expect(migration, forbidden).not.toContain(forbidden);
    }
    expect(migration).toContain(
      'ALTER TABLE "runtime_presentation_admissions"\n'
        + '  ADD CONSTRAINT "hr_admissions_profile_leaf_unique"',
    );
    expect(migration).toContain(
      'ALTER TABLE "runtime_packages"\n'
        + '  ADD CONSTRAINT "hr_runtime_packages_profile_leaf_unique"',
    );
    expect(migration).toContain('"member_index" BETWEEN 0 AND 7');
    expect(migration).toContain('"member_index" < "profile_member_count"');
    expect(migration).toContain('CONSTRAINT "hr_profile_members_asset_unique"');
    expect(migration).toContain('CONSTRAINT "hr_profile_members_receipt_unique"');
    expect(migration).toContain('CONSTRAINT "hr_profile_members_rights_unique"');
    expect(migration).toContain("CONSTRAINT = 'hr_profile_member_intersection'");
  });

  it("binds exact 90-day Type parity without changing the constituent minimum", async () => {
    const migration = await readFile(MIGRATION_PATH, "utf8");
    expect(migration).toContain(
      'AND "expires_at" = LEAST(\n'
        + '      "subject_expires_at", "final_reviewer_attestation_expires_at"\n'
        + "    )\n"
        + '    AND "expires_at" <= "reviewed_at" + interval \'90 days\'',
    );
    expect(migration).toContain(
      'NEW."expires_at" := LEAST(\n'
        + '    profile_subject."expires_at", final_role."expires_at"\n'
        + "  );",
    );
    expect(migration).toContain(
      "IF NEW.\"expires_at\" > action_at + interval '90 days' THEN",
    );
    expect(migration).toContain("CONSTRAINT = 'hr_reviewed_profile_ttl'");
    expect(migration).not.toContain("interval '30 days'");
  });

  it("serializes admission membership before row locks and repeats exact deep currentness", async () => {
    const migration = await readFile(MIGRATION_PATH, "utf8");
    const subjectIssuer = requiredCapture(new RegExp(
      'CREATE OR REPLACE FUNCTION public\\.hr_issue_reviewed_profile_subject\\(\\)'
        + '([\\s\\S]*?)CREATE TRIGGER "b_hr_issue_reviewed_profile_subject"',
      "u",
    ).exec(migration));
    const subjectCurrent = requiredCapture(new RegExp(
      'CREATE OR REPLACE FUNCTION "hr_assert_reviewed_profile_subject_current"\\('
        + '([\\s\\S]*?)CREATE OR REPLACE FUNCTION "hr_assert_reviewed_profile_current"',
      "u",
    ).exec(migration));

    for (const block of [subjectIssuer, subjectCurrent]) {
      expect(block.indexOf("'runtime-presentation-admission'"))
        .toBeLessThan(block.indexOf('FROM "runtime_presentation_admissions"'));
      expect(block).toContain('"hr_assert_derivation_current"(');
      expect(block).toContain('"hr_assert_transform_review_current"(');
      expect(block).toContain('"hr_assert_verified_scene_map_receipt_current"(');
      expect(block).toContain('"hr_assert_profile_qa_reviewer_current"(');
      expect(block).toContain('"hr_assert_profile_package_custodian_current"(');
      expect(block).toContain('"hr_assert_presentation_admission_reviewer_current"(');
    }
    expect(occurrences(subjectIssuer, '"hr_assert_profile_qa_reviewer_current"('))
      .toBe(2);
    expect(occurrences(subjectIssuer, '"hr_assert_profile_package_custodian_current"('))
      .toBe(2);
    expect(subjectCurrent).toContain("FOR sweep_index IN 1..2 LOOP");
    expect(occurrences(migration, "hr_profile_scene_admission_actor_exact"))
      .toBe(3);
    expect(migration).toContain(
      'scene_subject."presentation_admission_reviewer_actor_id" IS DISTINCT FROM',
    );
  });

  it("preserves monotonic clock fences and closes migration ownership/ACLs", async () => {
    const migration = await readFile(MIGRATION_PATH, "utf8");
    expect(occurrences(migration, "CONSTRAINT = 'hr_profile_clock_monotonic'"))
      .toBe(2);
    expect(migration).toContain(
      'check_at := GREATEST(check_at, action_at, "hr_wall_clock_ms"());',
    );
    expect(migration).toContain(
      'COALESCE(check_at, p_action_at), p_action_at, "hr_wall_clock_ms"()',
    );
    expect(migration).toContain(
      'COALESCE(wall_now, p_action_at), p_action_at, "hr_wall_clock_ms"()',
    );
    expect(migration).toContain("0067 exact trigger inventory is not 17");
    expect(migration).toContain("0067 temporary/mutating ACL closure failed");
    expect(migration).toContain(
      'GRANT EXECUTE ON FUNCTION public."hr_uuid_array_is_distinct"(uuid[])',
    );
  });
});
