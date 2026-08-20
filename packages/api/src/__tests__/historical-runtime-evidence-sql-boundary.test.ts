import { readdir, readFile } from "node:fs/promises";
import { relative, resolve } from "node:path";
import { describe, expect, it } from "vitest";

const MIGRATION_PATH = resolve(
  "drizzle",
  "0065_historical_runtime_evidence_graph.sql",
);
const SCHEMA_PATH = resolve("src", "db", "schema.ts");

const HISTORICAL_RUNTIME_EVIDENCE_TABLES = [
  "hr_evidence_environments",
  "hr_scope_epochs",
  "hr_scope_epoch_revocations",
  "hr_provider_capabilities",
  "hr_provider_capability_revocations",
  "hr_object_receipts",
  "hr_evidence_subjects",
  "hr_authority_snapshots",
  "hr_authenticated_action_assertions",
  "hr_action_authority_snapshots",
  "hr_authenticated_action_assertion_uses",
  "hr_signing_key_authorities",
  "hr_signing_key_authority_revocations",
  "hr_role_attestation_drafts",
  "hr_role_attestations",
  "hr_role_attestation_revocations",
  "hr_source_receipt_sets",
  "hr_source_receipt_members",
  "hr_normalized_content_identities",
  "hr_normalized_inventory_members",
  "hr_evidence_records",
  "hr_evidence_record_revocations",
  "hr_revocation_actions",
  "hr_capture_content_subjects",
  "hr_capture_content_drafts",
  "hr_capture_roots",
  "hr_capture_clearances",
  "hr_derivations",
  "hr_derivation_members",
  "hr_transform_reviews",
  "hr_rights_clearances",
  "hr_twin_release_authorities",
  "hr_authority_lock_rows",
] as const;

function tableModelName(tableName: string): string {
  return tableName.replace(/_([a-z0-9])/gu, (_, character: string) =>
    character.toUpperCase()
  );
}

function requiredCapture(match: RegExpMatchArray): string {
  const value = match[1];
  if (value === undefined) throw new Error("Historical-runtime boundary regex lost capture group 1.");
  return value;
}

async function findRuntimeTypeScriptFiles(directory: string): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = await Promise.all(entries.map(async (entry): Promise<string[]> => {
    const path = resolve(directory, entry.name);
    if (entry.isDirectory()) {
      return entry.name === "__tests__" ? [] : findRuntimeTypeScriptFiles(path);
    }
    return entry.isFile() && entry.name.endsWith(".ts") ? [path] : [];
  }));
  return files.flat();
}

describe("historical-runtime evidence SQL boundary", () => {
  it("keeps the exact committed 0065 evidence relation inventory migration-owned", async () => {
    const [migration, schema] = await Promise.all([
      readFile(MIGRATION_PATH, "utf8"),
      readFile(SCHEMA_PATH, "utf8"),
    ]);
    const migrationTables = [...migration.matchAll(
      /^CREATE TABLE "(hr_[a-z0-9_]+)" \(/gmu,
    )].map(requiredCapture);
    const drizzleTables = new Set([...schema.matchAll(
      /pgTable\(\s*"([a-z0-9_]+)"/gu,
    )].map(requiredCapture));

    expect(migrationTables).toEqual(HISTORICAL_RUNTIME_EVIDENCE_TABLES);
    expect(migrationTables).toHaveLength(33);
    expect(
      HISTORICAL_RUNTIME_EVIDENCE_TABLES.filter((table) => drizzleTables.has(table)),
    ).toEqual([]);
  });

  it("retains canonical SQL checks, triggers, and fixed-path definer functions", async () => {
    const migration = await readFile(MIGRATION_PATH, "utf8");
    const functionMatches = [...migration.matchAll(
      /CREATE(?: OR REPLACE)? FUNCTION "(hr_[a-z0-9_]+)"\([\s\S]*?\$\$;\r?\n/gu,
    )];
    const functionBlocks = functionMatches.map((match) => match[0]);
    const functionNames = functionMatches.map(requiredCapture);
    const triggerTargets = [...migration.matchAll(
      /^CREATE(?: CONSTRAINT)? TRIGGER "[a-z0-9_]+"[^;]*?\bON "([a-z0-9_]+)"[^;]*;/gmu,
    )].map(requiredCapture);
    const historicalCheckNames = [...migration.matchAll(
      /CONSTRAINT "(hr_[a-z0-9_]+)" CHECK/gu,
    )].map(requiredCapture);
    const definerBlocks = functionBlocks.filter((block) =>
      block.includes("SECURITY DEFINER")
    );

    expect(functionBlocks).toHaveLength(68);
    expect(new Set(functionNames).size).toBe(68);
    expect(triggerTargets).toHaveLength(56);
    const evidenceTables = new Set<string>(HISTORICAL_RUNTIME_EVIDENCE_TABLES);
    expect([...new Set(triggerTargets.filter((table) => !evidenceTables.has(table)))]).toEqual([
      "runtime_execution_key_policy_revocations",
      "reconstruction_release_reviews",
    ]);
    expect(historicalCheckNames).toHaveLength(37);
    expect(definerBlocks).toHaveLength(41);
    for (const block of definerBlocks) {
      expect(block).toContain("SET search_path = pg_catalog, public, pg_temp");
    }
  });

  it("keeps ordinary runtime modules off direct evidence table models and DML", async () => {
    const sourceRoot = resolve("src");
    const files = (await findRuntimeTypeScriptFiles(sourceRoot))
      .filter((file) => file !== SCHEMA_PATH);
    const directReferences: string[] = [];

    for (const file of files) {
      const source = await readFile(file, "utf8");
      for (const table of HISTORICAL_RUNTIME_EVIDENCE_TABLES) {
        const model = tableModelName(table);
        if (source.includes(table) || new RegExp(`\\b${model}\\b`, "u").test(source)) {
          directReferences.push(`${relative(sourceRoot, file)} -> ${table}`);
        }
      }
    }

    // 0065 is a capability/authority graph, not an ordinary application data
    // model. Consumers cross narrow typed SECURITY DEFINER/service boundaries;
    // they do not import its tables or issue direct SELECT/INSERT/UPDATE/DELETE.
    expect(directReferences).toEqual([]);
  });
});
