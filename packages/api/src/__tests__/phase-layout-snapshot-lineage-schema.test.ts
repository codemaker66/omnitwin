import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { getTableColumns } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { phaseLayoutSnapshots } from "../db/schema.js";

describe("phase layout snapshot lineage migration", () => {
  it("exposes proof, actor, canonical source, and predecessor columns", () => {
    const columns = getTableColumns(phaseLayoutSnapshots);
    expect(columns.canonicalSnapshotId).toBeDefined();
    expect(columns.proofDigest).toBeDefined();
    expect(columns.supersedesSnapshotId).toBeDefined();
    expect(columns.frozenBy).toBeDefined();
  });

  it("adds nullable backward-compatible lineage with referential constraints", async () => {
    const migration = await readFile(
      resolve("drizzle/0060_phase_layout_snapshot_lineage.sql"),
      "utf-8",
    );
    expect(migration).toContain('ADD COLUMN IF NOT EXISTS "canonical_snapshot_id" uuid');
    expect(migration).toContain('ADD COLUMN IF NOT EXISTS "proof_digest" varchar(64)');
    expect(migration).toContain('ADD COLUMN IF NOT EXISTS "supersedes_snapshot_id" uuid');
    expect(migration).toContain('ADD COLUMN IF NOT EXISTS "frozen_by" uuid');
    expect(migration).toContain("phase_layout_snapshots_canonical_snapshot_fk");
    expect(migration).toContain("phase_layout_snapshots_proof_digest_fk");
    expect(migration).toContain("phase_layout_snapshots_supersedes_fk");
    expect(migration).toContain("phase_layout_snapshots_frozen_by_fk");
    expect(migration).toContain("phase_layout_snapshots_no_self_supersession");
    expect(migration.match(/ON DELETE RESTRICT/gu)).toHaveLength(4);
    expect(migration).not.toContain("ON DELETE SET NULL");
    expect(migration).not.toMatch(/\b(?:DROP|TRUNCATE|RENAME)\b/iu);
  });

  it("keeps 0059 → 0060 contiguous and registers the immutable successor", async () => {
    const journal = JSON.parse(await readFile(resolve("drizzle/meta/_journal.json"), "utf-8")) as {
      readonly entries: readonly { readonly idx: number; readonly tag: string }[];
    };
    const migration0060Index = journal.entries.findIndex(
      (entry) => entry.tag === "0060_phase_layout_snapshot_lineage",
    );
    expect(journal.entries[migration0060Index - 1]).toEqual(expect.objectContaining({
      idx: 57,
      tag: "0059_action_log",
    }));
    expect(journal.entries[migration0060Index]).toEqual(expect.objectContaining({
      idx: 58,
      tag: "0060_phase_layout_snapshot_lineage",
    }));
    expect(journal.entries[migration0060Index + 1]).toEqual(expect.objectContaining({
      idx: 59,
      tag: "0061_diary_commands",
    }));
    expect(journal.entries.at(-1)).toEqual(expect.objectContaining({
      idx: 60,
      tag: "0062_phase_layout_snapshot_immutability",
    }));
  });

  it("blocks mutation only after a phase layout snapshot is frozen", async () => {
    const migration = await readFile(
      resolve("drizzle/0062_phase_layout_snapshot_immutability.sql"),
      "utf-8",
    );
    expect(migration).toContain("OLD.\"status\" = 'frozen'");
    expect(migration).toContain('BEFORE INSERT OR UPDATE OR DELETE ON "phase_layout_snapshots"');
    expect(migration).toContain('NEW."status" = \'frozen\'');
    expect(migration).toContain("phase_layout_snapshots_supersedes_lineage");
    expect(migration).toContain("phase_layout_snapshots_frozen_immutable");
    expect(migration).toContain("append a superseding row instead");
    expect(migration).toContain("configuration_layout_revisions_source_check");
    expect(migration).toContain("'public_batch', 'authenticated_batch', 'event_architect_candidate'");
    expect(migration).not.toMatch(/\b(?:DROP|TRUNCATE|RENAME)\s+TABLE\b/iu);
  });
});
