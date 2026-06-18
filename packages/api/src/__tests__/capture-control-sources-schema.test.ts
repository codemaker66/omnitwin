import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { getTableColumns, getTableName } from "drizzle-orm";
import { z } from "zod";
import { captureControlSourceRecords } from "../db/schema.js";

const migrationSql = readFileSync(
  fileURLToPath(new URL("../../drizzle/0041_capture_control_sources.sql", import.meta.url)),
  "utf8",
);

const journalRaw = readFileSync(
  fileURLToPath(new URL("../../drizzle/meta/_journal.json", import.meta.url)),
  "utf8",
);

const JournalSchema = z.object({
  entries: z.array(z.object({ idx: z.number().int(), tag: z.string() })),
});

describe("capture control source records Drizzle schema", () => {
  it("exposes capture-control evidence columns", () => {
    expect(getTableName(captureControlSourceRecords)).toBe("capture_control_source_records");

    const cols = getTableColumns(captureControlSourceRecords);
    expect(cols.venueSlug.name).toBe("venue_slug");
    expect(cols.roomSlug.name).toBe("room_slug");
    expect(cols.runtimePackageId.name).toBe("runtime_package_id");
    expect(cols.transformArtifactId.name).toBe("transform_artifact_id");
    expect(cols.sourceId.name).toBe("source_id");
    expect(cols.sourceClass.name).toBe("source_class");
    expect(cols.poseAuthorityLevel.name).toBe("pose_authority_level");
    expect(cols.qaStatus.name).toBe("qa_status");
    expect(cols.sourceRecord.name).toBe("source_record");
    expect(cols.reviewNote.name).toBe("review_note");
    expect(cols.registeredBy.name).toBe("registered_by");
  });
});

describe("migration 0041_capture_control_sources", () => {
  it("creates the capture-control source registry idempotently", () => {
    expect(migrationSql).toContain('CREATE TABLE IF NOT EXISTS "capture_control_source_records"');
    expect(migrationSql).toContain('"runtime_package_id" uuid REFERENCES "runtime_packages"("id") ON DELETE SET NULL');
    expect(migrationSql).toContain('"transform_artifact_id" varchar(120)');
    expect(migrationSql).toContain('"source_record" jsonb NOT NULL');
    expect(migrationSql).toContain('"registered_by" uuid REFERENCES "users"("id") ON DELETE SET NULL');
  });

  it("guards capture-control source coherence and transform references", () => {
    expect(migrationSql).toContain("capture_control_sources_venue_room_source_unique");
    expect(migrationSql).toContain("capture_control_sources_source_class_check");
    expect(migrationSql).toContain("'manual_landmarks'");
    expect(migrationSql).toContain("'manual_landmark_control'");
    expect(migrationSql).toContain("capture_control_sources_authority_pair_check");
    expect(migrationSql).toContain("capture_control_sources_transform_requires_package");
    expect(migrationSql).toContain("capture_control_sources_json_shape");
    expect(migrationSql).toContain('"source_record"->>\'sourceId\' = "source_id"');
    expect(migrationSql).toContain("capture_control_sources_transform_artifact_fk");
    expect(migrationSql).toContain('FOREIGN KEY ("runtime_package_id", "transform_artifact_id")');
    expect(migrationSql).toContain('REFERENCES "runtime_transform_artifacts" ("runtime_package_id", "transform_artifact_id")');
  });

  it("is registered after runtime QA records in the migration journal", () => {
    const parsed: unknown = JSON.parse(journalRaw);
    const journal = JournalSchema.parse(parsed);
    const tags = journal.entries.map((entry) => entry.tag);
    expect(tags.indexOf("0041_capture_control_sources")).toBeGreaterThan(tags.indexOf("0040_runtime_qa_records"));
  });
});
