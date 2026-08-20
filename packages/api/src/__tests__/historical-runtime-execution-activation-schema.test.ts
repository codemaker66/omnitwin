import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { getTableColumns } from "drizzle-orm";
import { getTableConfig, type PgTable } from "drizzle-orm/pg-core";
import { describe, expect, it } from "vitest";
import {
  phaseLayoutSnapshots,
  runtimeExecutionActivationDraftMembers,
  runtimeExecutionActivationDrafts,
  runtimeExecutionActivationMembers,
  runtimeExecutionActivationRevocations,
  runtimeExecutionActivations,
  runtimeExecutionKeyPolicies,
  runtimeExecutionKeyPolicyRevocations,
} from "../db/schema.js";

const MIGRATION_TAG = "0064_historical_runtime_execution_activation";

function columnNames(table: PgTable): string[] {
  return Object.values(getTableColumns(table)).map((column) => column.name).sort();
}

describe("historical runtime execution activation schema", () => {
  it("declares the normalized immutable authority records", () => {
    expect(columnNames(runtimeExecutionKeyPolicies)).toEqual([
      "algorithm", "effective_at", "expires_at", "id", "key_id", "policy_body",
      "policy_digest", "public_key_fingerprint", "purpose", "registered_at", "registered_by",
    ].sort());
    expect(columnNames(runtimeExecutionActivationDrafts)).toContain("statement");
    expect(columnNames(runtimeExecutionActivationDraftMembers)).toContain("storage_version");
    expect(columnNames(runtimeExecutionActivationDraftMembers)).toContain("storage_etag");
    expect(columnNames(runtimeExecutionActivations)).toContain("envelope");
    expect(columnNames(runtimeExecutionActivationMembers)).toContain("object_receipt_digest");
    expect(columnNames(runtimeExecutionActivationRevocations)).toContain("revoked_at");
    expect(columnNames(runtimeExecutionKeyPolicyRevocations)).toContain("revoked_at");
    expect(columnNames(phaseLayoutSnapshots)).toContain("runtime_execution_activation_id");
  });

  it("declares exact draft, activation, member, and snapshot foreign keys", () => {
    expect(getTableConfig(runtimeExecutionActivationDrafts).foreignKeys.map((key) => key.getName()))
      .toContain("runtime_execution_activation_drafts_key_policy_fk");
    expect(getTableConfig(runtimeExecutionActivationMembers).foreignKeys.map((key) => key.getName()))
      .toContain("runtime_execution_activation_members_draft_member_fk");
    expect(getTableConfig(phaseLayoutSnapshots).foreignKeys.map((key) => key.getName()))
      .toContain("phase_layout_snapshots_runtime_execution_activation_fk");
  });

  it("journals 0064 and enforces append-only, expiry, revocation, and v2 snapshot guards", async () => {
    const [migration, journalText] = await Promise.all([
      readFile(resolve("drizzle", `${MIGRATION_TAG}.sql`), "utf8"),
      readFile(resolve("drizzle", "meta", "_journal.json"), "utf8"),
    ]);
    const journal = JSON.parse(journalText) as { entries: Array<{ idx: number; tag: string }> };
    expect(journal.entries.at(-1)).toMatchObject({ idx: 62, tag: MIGRATION_TAG });
    expect(migration).toContain("phase-layout-runtime-binding.v2");
    expect(migration).toContain("runtime_execution_activation_snapshot_guard");
    expect(migration).toContain("runtime_execution_evidence_append_only_guard");
    expect(migration).toContain("runtime_execution_activation_revocations");
    expect(migration).toContain("runtime_execution_key_policy_revocations");
    expect(migration).toContain("runtime_execution_activation_members_complete_guard");
    expect(migration).not.toMatch(/UPDATE\s+"phase_layout_snapshots"/iu);
  });
});
