import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { getTableColumns, getTableName } from "drizzle-orm";
import { z } from "zod";
import { runtimeTransformArtifacts } from "../db/schema.js";

const migrationSql = readFileSync(
  fileURLToPath(new URL("../../drizzle/0039_runtime_transform_artifacts.sql", import.meta.url)),
  "utf8",
);

const journalRaw = readFileSync(
  fileURLToPath(new URL("../../drizzle/meta/_journal.json", import.meta.url)),
  "utf8",
);

const JournalSchema = z.object({
  entries: z.array(z.object({ idx: z.number().int(), tag: z.string() })),
});

describe("runtime transform artifacts Drizzle schema", () => {
  it("exposes reviewed transform artifact registration columns", () => {
    expect(getTableName(runtimeTransformArtifacts)).toBe("runtime_transform_artifacts");

    const cols = getTableColumns(runtimeTransformArtifacts);
    expect(cols.runtimePackageId.name).toBe("runtime_package_id");
    expect(cols.venueSlug.name).toBe("venue_slug");
    expect(cols.roomSlug.name).toBe("room_slug");
    expect(cols.transformArtifactId.name).toBe("transform_artifact_id");
    expect(cols.transformArtifact.name).toBe("transform_artifact");
    expect(cols.reviewNote.name).toBe("review_note");
    expect(cols.registeredBy.name).toBe("registered_by");
  });
});

describe("migration 0039_runtime_transform_artifacts", () => {
  it("creates the transform artifact registry idempotently", () => {
    expect(migrationSql).toContain('CREATE TABLE IF NOT EXISTS "runtime_transform_artifacts"');
    expect(migrationSql).toContain('"runtime_package_id" uuid NOT NULL REFERENCES "runtime_packages"("id") ON DELETE CASCADE');
    expect(migrationSql).toContain('"transform_artifact" jsonb NOT NULL');
    expect(migrationSql).toContain('"registered_by" uuid REFERENCES "users"("id") ON DELETE SET NULL');
  });

  it("guards signed-transform invariants at the database boundary", () => {
    expect(migrationSql).toContain("runtime_transform_artifacts_package_artifact_unique");
    expect(migrationSql).toContain("runtime_transform_artifacts_json_shape");
    expect(migrationSql).toContain("'landmark_solve'");
    expect(migrationSql).toContain("'known_pose_colmap'");
    expect(migrationSql).not.toContain("'visual_alignment'");
    expect(migrationSql).not.toContain("'unconstrained_colmap'");
    expect(migrationSql).toContain('"transform_artifact"->>\'id\' = "transform_artifact_id"');
    expect(migrationSql).toContain('"transform_artifact"->\'reviewer\'->>\'actorType\' = \'human\'');
    expect(migrationSql).toContain("jsonb_path_exists");
  });

  it("is registered after supplier coordination in the migration journal", () => {
    const parsed: unknown = JSON.parse(journalRaw);
    const journal = JournalSchema.parse(parsed);
    const tags = journal.entries.map((entry) => entry.tag);
    expect(tags.indexOf("0039_runtime_transform_artifacts")).toBeGreaterThan(tags.indexOf("0038_supplier_coordination"));
  });
});
