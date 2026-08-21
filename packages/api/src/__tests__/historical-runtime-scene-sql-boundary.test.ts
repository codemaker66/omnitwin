import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import { relative, resolve } from "node:path";
import { describe, expect, it } from "vitest";

const MIGRATION_PATH = resolve(
  "drizzle",
  "0066_historical_runtime_verified_scene.sql",
);
const SCHEMA_PATH = resolve("src", "db", "schema.ts");

const SCENE_TABLES = [
  "hr_verified_twin_release_authorities",
  "hr_scene_parser_runtime_identities",
  "hr_scene_parser_runtime_identity_revocations",
  "hr_scene_map_parser_receipts",
  "hr_verified_scene_map_receipts",
  "hr_scene_validation_subjects",
  "hr_scene_whole_regions",
  "hr_scene_validation_members",
  "hr_scene_member_regions",
  "hr_scene_validations",
] as const;

const AFFECTED_FUNCTIONS = [
  "hr_jsonb_has_exact_keys",
  "hr_require_evidence_verifier",
  "hr_consume_high_assurance_action_authority",
  "hr_assert_evidence_record_leaf_exact",
  "hr_issue_high_assurance_authenticated_action_assertion",
  "hr_assert_scene_graph_complete",
  "hr_scene_graph_deferred_guard",
  "hr_authorize_verified_twin_release_authority",
  "hr_issue_verified_twin_release_authority",
  "hr_assert_verified_twin_release_current",
  "hr_assert_twin_release_authority_current",
  "hr_assert_transform_review_current",
  "hr_assert_presentation_admission_reviewer_current",
  "hr_assert_runtime_presentation_admission_members_exact",
  "runtime_presentation_member_insert_guard",
  "hr_issue_scene_parser_runtime_identity_revocation",
  "hr_assert_scene_parser_runtime_identity_current",
  "hr_assert_scene_map_parser_receipt_current",
  "hr_assert_verified_scene_map_receipt_current",
  "hr_issue_scene_map_parser_receipt",
  "hr_accept_verified_scene_map_receipt",
  "hr_issue_scene_validation_subject",
  "hr_populate_scene_validation_children",
  "hr_issue_scene_validation",
] as const;

const EXPLICIT_TRIGGERS = [
  "hr_scene_subject_graph_complete",
  "hr_scene_whole_graph_complete",
  "hr_scene_member_graph_complete",
  "hr_scene_member_region_graph_complete",
  "hr_scene_final_graph_complete",
  "b_hr_issue_verified_twin_release_authority",
  "a_hr_issue_scene_parser_runtime_identity_revocation",
  "b_hr_issue_scene_map_parser_receipt",
  "c_hr_accept_verified_scene_map_receipt",
  "b_hr_issue_scene_validation_subject",
  "c_hr_populate_scene_validation_children",
  "b_hr_issue_scene_validation",
  "a0_hr_require_verified_twin_verifier",
  "a0_hr_require_scene_map_parser_receipt_verifier",
  "a0_hr_require_scene_map_handle_owner",
  "a_hr_require_scene_subject_verifier",
  "a_hr_require_scene_final_verifier",
] as const;

const ACTION_KINDS = [
  "scope_epoch_revocation",
  "provider_capability_revocation",
  "signing_key_authority_revocation",
  "role_attestation_revocation",
  "evidence_record_revocation",
  "execution_activation_revocation",
  "execution_activation_request",
  "twin_release_authority_approval",
] as const;

const AUTHORITY_ROLES = [
  "revoker",
  "execution_requester",
  "twin_release_approver",
] as const;

const REFERENCES_BRIDGE_TABLES = [
  "hr_action_authority_snapshots",
  "hr_derivations",
  "hr_derivation_members",
  "hr_evidence_environments",
  "hr_evidence_records",
  "hr_evidence_subjects",
  "hr_object_receipts",
  "hr_provider_capabilities",
  "hr_role_attestations",
  "hr_scope_epochs",
  "hr_signing_key_authorities",
  "hr_transform_reviews",
] as const;

const EVIDENCE_OWNER_SELECT_TABLES = [
  "phase_layout_snapshots",
  "reconstruction_review_evidence_artifacts",
  "runtime_packages",
  "runtime_presentation_admissions",
  "runtime_presentation_admission_members",
  ...SCENE_TABLES,
] as const;

const VERIFIER_SELECT_TABLES = [
  "reconstruction_review_evidence_artifacts",
  "runtime_packages",
  "runtime_presentation_admissions",
  "runtime_presentation_admission_members",
  "hr_verified_twin_release_authorities",
  "hr_scene_map_parser_receipts",
  "hr_verified_scene_map_receipts",
  "hr_scene_validation_subjects",
  "hr_scene_whole_regions",
  "hr_scene_validation_members",
  "hr_scene_member_regions",
  "hr_scene_validations",
] as const;

const FUNCTION_OWNER_TRANSFERS = [
  ["hr_jsonb_has_exact_keys", "omnitwin_historical_schema_owner"],
  ["hr_assert_scene_graph_complete", "omnitwin_historical_schema_owner"],
  ["hr_consume_high_assurance_action_authority", "omnitwin_historical_evidence_owner"],
  ["hr_issue_high_assurance_authenticated_action_assertion", "omnitwin_historical_evidence_owner"],
  ["hr_scene_graph_deferred_guard", "omnitwin_historical_evidence_owner"],
  ["hr_authorize_verified_twin_release_authority", "omnitwin_historical_evidence_owner"],
  ["hr_issue_verified_twin_release_authority", "omnitwin_historical_evidence_owner"],
  ["hr_assert_verified_twin_release_current", "omnitwin_historical_evidence_owner"],
  ["hr_assert_twin_release_authority_current", "omnitwin_historical_evidence_owner"],
  ["hr_assert_transform_review_current", "omnitwin_historical_evidence_owner"],
  ["hr_assert_presentation_admission_reviewer_current", "omnitwin_historical_evidence_owner"],
  [
    "hr_assert_runtime_presentation_admission_members_exact",
    "omnitwin_historical_evidence_owner",
  ],
  ["runtime_presentation_member_insert_guard", "omnitwin_historical_evidence_owner"],
  [
    "hr_issue_scene_parser_runtime_identity_revocation",
    "omnitwin_historical_evidence_owner",
  ],
  ["hr_assert_scene_parser_runtime_identity_current", "omnitwin_historical_evidence_owner"],
  ["hr_assert_scene_map_parser_receipt_current", "omnitwin_historical_evidence_owner"],
  ["hr_assert_verified_scene_map_receipt_current", "omnitwin_historical_evidence_owner"],
  ["hr_issue_scene_map_parser_receipt", "omnitwin_historical_evidence_owner"],
  ["hr_accept_verified_scene_map_receipt", "omnitwin_historical_evidence_owner"],
  ["hr_issue_scene_validation_subject", "omnitwin_historical_evidence_owner"],
  ["hr_populate_scene_validation_children", "omnitwin_historical_evidence_owner"],
  ["hr_issue_scene_validation", "omnitwin_historical_evidence_owner"],
] as const;

function requiredCapture(match: RegExpMatchArray | null, index = 1): string {
  const value = match?.[index];
  if (value === undefined) {
    throw new Error(`Historical-runtime Scene boundary regex lost capture group ${String(index)}.`);
  }
  return value;
}

function quotedIdentifiers(sql: string): string[] {
  return [...sql.matchAll(/"([a-z0-9_]+)"/gu)]
    .map((match) => requiredCapture(match));
}

function stringLiterals(sql: string): string[] {
  return [...sql.matchAll(/'([a-z0-9_]+)'/gu)]
    .map((match) => requiredCapture(match));
}

function occurrences(value: string, needle: string): number {
  return value.split(needle).length - 1;
}

function extractTableBlock(sql: string, tableName: string): string {
  const escaped = tableName.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
  return requiredCapture(new RegExp(
    `^CREATE TABLE "${escaped}" \\(([\\s\\S]*?)\\r?\\n\\);`,
    "mu",
  ).exec(sql));
}

function extractGrantTables(
  sql: string,
  privileges: string,
  role: string,
): string[] {
  const match = new RegExp(
    `GRANT ${privileges} ON TABLE\\s+([^;]*?)\\s+TO "${role}";`,
    "u",
  ).exec(sql);
  return quotedIdentifiers(requiredCapture(match));
}

function extractGrantFunctions(sql: string, role: string): string[] {
  const match = new RegExp(
    `GRANT EXECUTE ON FUNCTION\\s+([^;]*?)\\s+TO "${role}";`,
    "u",
  ).exec(sql);
  return [...requiredCapture(match).matchAll(/public\."([a-z0-9_]+)"/gu)]
    .map((functionMatch) => requiredCapture(functionMatch));
}

function extractFunctionBlock(
  blocksByName: ReadonlyMap<string, string>,
  functionName: string,
): string {
  const block = blocksByName.get(functionName);
  if (block === undefined) throw new Error(`Missing function block ${functionName}.`);
  return block;
}

async function findRuntimeTypeScriptFiles(directory: string): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = await Promise.all(entries.map(async (entry): Promise<string[]> => {
    if (entry.isDirectory() && (entry.name === "__tests__" || entry.name === "scripts")) {
      return [];
    }
    const path = resolve(directory, entry.name);
    if (entry.isDirectory()) return findRuntimeTypeScriptFiles(path);
    return entry.isFile() && entry.name.endsWith(".ts") ? [path] : [];
  }));
  return files.flat();
}

describe("historical-runtime 0066 verified Scene SQL boundary", () => {
  it("freezes the independently replayed D9BB migration and exact table island", async () => {
    const [migration, schema] = await Promise.all([
      readFile(MIGRATION_PATH, "utf8"),
      readFile(SCHEMA_PATH, "utf8"),
    ]);

    expect(Buffer.byteLength(migration, "utf8")).toBe(405_109);
    expect(createHash("sha256").update(migration, "utf8").digest("hex")).toBe(
      "1a33375f9197950568ac9a182600efa8e5154b11b93029c6d15abbb077357671",
    );

    const createdTables = [...migration.matchAll(
      /^CREATE TABLE "([a-z0-9_]+)" \(/gmu,
    )].map((match) => requiredCapture(match));
    expect(createdTables).toEqual(SCENE_TABLES);

    const drizzleTables = new Set([...schema.matchAll(
      /pgTable\(\s*"([a-z0-9_]+)"/gu,
    )].map((match) => requiredCapture(match)));
    expect(SCENE_TABLES.filter((table) => drizzleTables.has(table))).toEqual([]);

    const parserBlock = extractTableBlock(migration, "hr_scene_map_parser_receipts");
    const handleBlock = extractTableBlock(migration, "hr_verified_scene_map_receipts");
    expect(parserBlock).toMatch(/^\s{2}"id" uuid PRIMARY KEY NOT NULL,/mu);
    expect(handleBlock).toMatch(/^\s{2}"id" uuid PRIMARY KEY NOT NULL,/mu);
    expect(migration).not.toContain("_pkey1");
    expect(`${SCENE_TABLES[3]}_pkey`).toBe("hr_scene_map_parser_receipts_pkey");
    expect(`${SCENE_TABLES[4]}_pkey`).toBe("hr_verified_scene_map_receipts_pkey");
  });

  it("retains the exact function and trigger inventories with fixed paths", async () => {
    const migration = await readFile(MIGRATION_PATH, "utf8");
    const functionMatches = [...migration.matchAll(
      /^CREATE OR REPLACE FUNCTION\s+(?:public\.)?"([a-z0-9_]+)"\s*\([\s\S]*?\$\$;\r?\n/gmu,
    )];
    const functionNames = functionMatches.map((match) => requiredCapture(match));
    const blocksByName = new Map(functionMatches.map((match) => [
      requiredCapture(match),
      match[0],
    ] as const));
    expect(functionNames).toEqual(AFFECTED_FUNCTIONS);
    expect(functionNames).toHaveLength(24);
    expect(functionMatches.filter((match) => match[0].includes("SECURITY DEFINER")))
      .toHaveLength(21);
    for (const match of functionMatches) {
      expect(match[0]).toContain("SET search_path = pg_catalog, public, pg_temp");
    }

    const explicitTriggers = [...migration.matchAll(
      /^CREATE(?: CONSTRAINT)? TRIGGER "([a-z0-9_]+)"/gmu,
    )].map((match) => requiredCapture(match));
    expect(explicitTriggers).toEqual(EXPLICIT_TRIGGERS);

    const appendOnlyMatch = /FOREACH target_table IN ARRAY ARRAY\[\s*([\s\S]*?)\s*\]::text\[\]\s*LOOP([\s\S]*?)END LOOP;/u.exec(
      migration,
    );
    expect(stringLiterals(requiredCapture(appendOnlyMatch))).toEqual(SCENE_TABLES);
    const appendOnlyBody = requiredCapture(appendOnlyMatch, 2);
    expect(occurrences(appendOnlyBody, "CREATE TRIGGER z_hr_reject_row_mutation"))
      .toBe(1);
    expect(occurrences(appendOnlyBody, "CREATE TRIGGER z_hr_reject_truncate"))
      .toBe(1);
    expect(SCENE_TABLES.length * 2).toBe(20);

    const issuer = extractFunctionBlock(
      blocksByName,
      "hr_issue_high_assurance_authenticated_action_assertion",
    );
    const consumer = extractFunctionBlock(
      blocksByName,
      "hr_consume_high_assurance_action_authority",
    );
    for (const block of [issuer, consumer]) {
      expect(block).toContain("omnitwin_historical_schema_owner");
      expect(block).toContain("twin_release_authority_approval");
      expect(block).not.toContain("execution_activation_subject_request");
      expect(block).not.toContain("execution_activation_draft_request");
    }
    expect(consumer).toContain("p_expected_authority_role <> 'twin_release_approver'");
    expect(issuer).toContain("p_action_kind <> 'twin_release_authority_approval'");
  });

  it("keeps the neutral action contract and excludes profile, execution, and quarantine islands", async () => {
    const migration = await readFile(MIGRATION_PATH, "utf8");
    const actionKinds = stringLiterals(requiredCapture(
      /ADD CONSTRAINT "hr_action_assertions_shape"[\s\S]*?AND "action_kind" IN \(\s*([\s\S]*?)\s*\)\s*AND "environment_mode"/u.exec(
        migration,
      ),
    ));
    const authorityRoles = stringLiterals(requiredCapture(
      /ADD CONSTRAINT "hr_action_authority_shape"[\s\S]*?"authority_role" IN \(\s*([\s\S]*?)\s*\)\s*AND \(/u.exec(
        migration,
      ),
    ));
    expect(actionKinds).toEqual(ACTION_KINDS);
    expect(authorityRoles).toEqual(AUTHORITY_ROLES);

    expect(migration).toContain(
      '"action_kind" = \'twin_release_authority_approval\'\n'
        + '        AND "authority_role" = \'twin_release_approver\'',
    );
    expect(migration).not.toContain("hr_issue_execution_authenticated_action_assertion");
    expect(migration).not.toContain("execution_activation_subject_request");
    expect(migration).not.toContain("execution_activation_draft_request");
    expect(migration).not.toContain("hr_reviewed_profile");
    expect(migration).not.toContain("hr_execution_");
    expect(migration.toLowerCase()).not.toContain("quarantine");
    expect(occurrences(migration, "'reviewed_profile'")).toBe(2);

    const leafGuard = requiredCapture(
      /^CREATE OR REPLACE FUNCTION "hr_assert_evidence_record_leaf_exact"\([\s\S]*?\$\$;\r?$/mu.exec(
        migration,
      ),
      0,
    );
    expect(leafGuard).toContain('FROM "hr_verified_twin_release_authorities"');
    expect(leafGuard).toContain('FROM "hr_scene_validations"');
    expect(leafGuard).not.toContain("reviewed_profile");
    expect(leafGuard).not.toContain("hr_execution_");

    expect(occurrences(
      migration,
      "5cb0e2e84963d42f7adb08128af1a45698b483af26649d7c96190199aeeb5b17",
    )).toBe(4);
    expect(occurrences(
      migration,
      "f1b795772332e15fa2dea472106baff920ed188dfa8d67c2d0543e02710401e1",
    )).toBe(4);
    expect(migration).not.toMatch(/'0{64}'/u);
  });

  it("pins the explicit ownership, ACL, and least-privilege deployment choreography", async () => {
    const migration = await readFile(MIGRATION_PATH, "utf8");
    expect(migration).not.toMatch(/(?:^|\n)(?:CREATE|ALTER) ROLE /u);
    expect(migration).not.toMatch(/^CREATE EXTENSION /mu);
    expect(migration).not.toMatch(/^(?:BEGIN|COMMIT);/mu);
    expect(migration).toContain("current_user IS DISTINCT FROM session_user");
    expect(migration).toContain("0066 requires an isolated least-privilege migration login");
    for (const attribute of [
      "rolcanlogin",
      "rolinherit",
      "rolsuper",
      "rolcreatedb",
      "rolcreaterole",
      "rolreplication",
      "rolbypassrls",
    ]) {
      expect(migration).toContain(`migration_role."${attribute}"`);
    }
    expect(occurrences(migration, "SET LOCAL ROLE ")).toBe(8);
    expect(occurrences(migration, "RESET ROLE;")).toBe(8);

    const grantReferencesStart = migration.indexOf("'GRANT REFERENCES ON TABLE '");
    const grantReferencesEnd = migration.indexOf("RESET ROLE;", grantReferencesStart);
    const revokeReferencesStart = migration.indexOf("'REVOKE REFERENCES ON TABLE '");
    const revokeReferencesEnd = migration.indexOf("RESET ROLE;", revokeReferencesStart);
    expect(grantReferencesStart).toBeGreaterThan(0);
    expect(revokeReferencesStart).toBeGreaterThan(grantReferencesStart);
    const grantReferences = migration.slice(grantReferencesStart, grantReferencesEnd);
    const revokeReferences = migration.slice(revokeReferencesStart, revokeReferencesEnd);
    const referencePattern = /public\.([a-z0-9_]+)/gu;
    expect([...grantReferences.matchAll(referencePattern)]
      .map((match) => requiredCapture(match))).toEqual(REFERENCES_BRIDGE_TABLES);
    expect([...revokeReferences.matchAll(referencePattern)]
      .map((match) => requiredCapture(match))).toEqual(REFERENCES_BRIDGE_TABLES);

    const tableOwnerTransfers = [...migration.matchAll(
      /^ALTER TABLE public\."([a-z0-9_]+)"\r?\n\s+OWNER TO "omnitwin_historical_schema_owner";/gmu,
    )].map((match) => requiredCapture(match));
    expect(tableOwnerTransfers).toEqual(SCENE_TABLES);
    expect(migration).not.toContain("ALTER TABLE public.%I OWNER TO");

    const functionOwnerTransfers = [...migration.matchAll(
      /^ALTER FUNCTION public\."([a-z0-9_]+)"\([\s\S]*?\)\s+OWNER TO "([a-z0-9_]+)";/gmu,
    )].map((match) => [
      requiredCapture(match),
      requiredCapture(match, 2),
    ] as const);
    expect(functionOwnerTransfers).toEqual(FUNCTION_OWNER_TRANSFERS);

    expect(extractGrantTables(
      migration,
      "SELECT",
      "omnitwin_historical_evidence_owner",
    )).toEqual(EVIDENCE_OWNER_SELECT_TABLES);
    expect(extractGrantTables(
      migration,
      "SELECT",
      "omnitwin_historical_evidence_verifier",
    )).toEqual(VERIFIER_SELECT_TABLES);
    expect(extractGrantTables(
      migration,
      "INSERT",
      "omnitwin_historical_evidence_owner",
    )).toEqual([
      "hr_verified_scene_map_receipts",
      "hr_scene_whole_regions",
      "hr_scene_validation_members",
      "hr_scene_member_regions",
    ]);
    expect(extractGrantTables(
      migration,
      "SELECT, INSERT",
      "omnitwin_historical_evidence_verifier",
    )).toEqual([
      "hr_verified_twin_release_authorities",
      "hr_scene_map_parser_receipts",
      "hr_scene_validation_subjects",
      "hr_scene_validations",
    ]);
    expect(extractGrantTables(
      migration,
      'UPDATE \\("id"\\)',
      "omnitwin_historical_evidence_owner",
    )).toEqual([
      "reconstruction_review_evidence_artifacts",
      "runtime_packages",
      "runtime_presentation_admissions",
      "hr_verified_twin_release_authorities",
      "hr_scene_parser_runtime_identities",
      "hr_scene_map_parser_receipts",
      "hr_verified_scene_map_receipts",
      "hr_scene_validation_subjects",
      "hr_scene_validations",
    ]);
    expect(extractGrantTables(
      migration,
      'UPDATE \\("scene_validation_id"\\)',
      "omnitwin_historical_evidence_owner",
    )).toEqual(["hr_scene_validation_members"]);

    expect(extractGrantFunctions(
      migration,
      "omnitwin_historical_evidence_owner",
    )).toEqual([
      "hr_assert_scene_graph_complete",
      "hr_jsonb_has_exact_keys",
    ]);
    expect(extractGrantFunctions(
      migration,
      "omnitwin_historical_evidence_verifier",
    )).toEqual(["hr_jsonb_has_exact_keys"]);
    expect(extractGrantFunctions(migration, "omnitwin_api_activation"))
      .toEqual(["hr_authorize_verified_twin_release_authority"]);
    expect(extractGrantFunctions(migration, "omnitwin_historical_auth_gateway"))
      .toEqual(["hr_issue_high_assurance_authenticated_action_assertion"]);

    const temporaryCreate = migration.indexOf("GRANT CREATE ON SCHEMA public");
    const firstOwnerTransfer = migration.indexOf(
      'ALTER TABLE public."hr_verified_twin_release_authorities"',
    );
    const revokeCreate = migration.indexOf("REVOKE CREATE ON SCHEMA public");
    const finalClosure = migration.indexOf("-- Exact postflight:");
    expect(temporaryCreate).toBeGreaterThan(0);
    expect(firstOwnerTransfer).toBeGreaterThan(temporaryCreate);
    expect(revokeCreate).toBeGreaterThan(firstOwnerTransfer);
    expect(finalClosure).toBeGreaterThan(revokeCreate);
    expect(migration).toContain("0066 relation ownership/migrator ACL closure failed");
    expect(migration).toContain("0066 function ownership/ACL closure failed");
    expect(migration).toContain("0066 append-only trigger closure failed");
    expect(migration).toContain("0066 legacy relation ACL closure failed");
  });

  it("keeps ordinary runtime TypeScript off direct Scene/Twin table models and DML", async () => {
    const sourceRoot = resolve("src");
    const files = (await findRuntimeTypeScriptFiles(sourceRoot))
      .filter((file) => file !== SCHEMA_PATH);
    const directReferences: string[] = [];

    for (const file of files) {
      const source = await readFile(file, "utf8");
      for (const table of SCENE_TABLES) {
        if (source.includes(table)) {
          directReferences.push(`${relative(sourceRoot, file)} -> ${table}`);
        }
      }
    }

    expect(directReferences).toEqual([]);
  });
});
