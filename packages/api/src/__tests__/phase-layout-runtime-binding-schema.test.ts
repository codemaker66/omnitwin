import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { getTableColumns } from "drizzle-orm";
import { getTableConfig } from "drizzle-orm/pg-core";
import { describe, expect, it } from "vitest";
import { phaseLayoutSnapshots, runtimePackages } from "../db/schema.js";

const MIGRATION_TAG = "0063_phase_layout_runtime_bindings";

describe("phase layout historical runtime binding migration", () => {
  it("keeps the immutable binding columns aligned with the Drizzle schema", () => {
    const columns = getTableColumns(phaseLayoutSnapshots);

    expect(columns.runtimeBindingState.name).toBe("runtime_binding_state");
    expect(columns.runtimeBindingDigest.name).toBe("runtime_binding_digest");
    expect(columns.runtimeBinding.name).toBe("runtime_binding");
    expect(columns.runtimePackageId.name).toBe("runtime_package_id");
    expect(columns.runtimePackageContentDigest.name).toBe("runtime_package_content_digest");
    expect(columns.runtimeQaRecordId.name).toBe("runtime_qa_record_id");
    expect(columns.runtimeTransformArtifactRowId.name).toBe("runtime_transform_artifact_row_id");

    const packageUnique = getTableConfig(runtimePackages).uniqueConstraints.find(
      (constraint) => constraint.name === "runtime_packages_id_digest_unique",
    );
    expect(packageUnique?.columns.map((column) => column.name)).toEqual(["id", "content_digest"]);

    const foreignKeys = getTableConfig(phaseLayoutSnapshots).foreignKeys.map((key) => key.getName());
    expect(foreignKeys).toContain("phase_layout_snapshots_runtime_package_digest_fk");
    expect(foreignKeys).toContain("phase_layout_snapshots_runtime_qa_record_fk");
    expect(foreignKeys).toContain("phase_layout_snapshots_runtime_transform_artifact_fk");
  });

  it("records either one complete reviewed binding or one honest unavailable decision", async () => {
    const migration = await readFile(resolve("drizzle", `${MIGRATION_TAG}.sql`), "utf8");

    for (const boundary of [
      "runtime_packages_id_digest_unique",
      "phase_layout_snapshots_runtime_binding_state_check",
      "phase_layout_snapshots_runtime_binding_digest_shape",
      "phase_layout_snapshots_runtime_package_digest_shape",
      "phase_layout_snapshots_runtime_binding_coherent",
      "phase_layout_snapshots_runtime_binding_json_identity",
      "phase_layout_snapshots_runtime_binding_package_identity",
      "phase_layout_snapshots_runtime_package_digest_fk",
      "phase_layout_snapshots_runtime_qa_record_fk",
      "phase_layout_snapshots_runtime_transform_artifact_fk",
    ]) {
      expect(migration).toContain(boundary);
    }

    expect(migration).toContain("'legacy_unbound', 'available', 'unavailable'");
    expect(migration).toContain('"runtime_binding"->>\'bindingId\' = "id"::text');
    expect(migration).toContain('"runtime_binding"->>\'canonicalSnapshotId\' = "canonical_snapshot_id"::text');
    expect(migration).toContain('"runtime_binding"->>\'snapshotHash\' = "snapshot_hash"');
    expect(migration).toContain('"runtime_binding"->>\'boundBy\' = "frozen_by"::text');
    expect(migration.match(/\) IS TRUE\)/gu)).toHaveLength(3);
    expect(migration).toContain("ON DELETE RESTRICT");
    expect(migration).not.toMatch(/\bUPDATE\s+"phase_layout_snapshots"/iu);
    expect(migration).not.toMatch(/\b(?:DROP|TRUNCATE|RENAME)\s+TABLE\b/iu);
  });

  it("is the unique migration journal tail after frozen-row immutability", async () => {
    const journal = JSON.parse(
      await readFile(resolve("drizzle/meta/_journal.json"), "utf8"),
    ) as { readonly entries: readonly { readonly idx: number; readonly tag: string }[] };

    expect(journal.entries.slice(-2)).toEqual([
      expect.objectContaining({ idx: 60, tag: "0062_phase_layout_snapshot_immutability" }),
      expect.objectContaining({ idx: 61, tag: MIGRATION_TAG }),
    ]);
    expect(journal.entries.filter((entry) => entry.tag === MIGRATION_TAG)).toHaveLength(1);
  });
});
