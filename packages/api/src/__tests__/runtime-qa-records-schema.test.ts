import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { getTableColumns, getTableName } from "drizzle-orm";
import { z } from "zod";
import { runtimeQaRecords } from "../db/schema.js";

const migrationSql = readFileSync(
  fileURLToPath(new URL("../../drizzle/0040_runtime_qa_records.sql", import.meta.url)),
  "utf8",
);

const journalRaw = readFileSync(
  fileURLToPath(new URL("../../drizzle/meta/_journal.json", import.meta.url)),
  "utf8",
);

const JournalSchema = z.object({
  entries: z.array(z.object({ idx: z.number().int(), tag: z.string() })),
});

describe("runtime QA records Drizzle schema", () => {
  it("exposes reviewed QA and public exposure registration columns", () => {
    expect(getTableName(runtimeQaRecords)).toBe("runtime_qa_records");

    const cols = getTableColumns(runtimeQaRecords);
    expect(cols.runtimePackageId.name).toBe("runtime_package_id");
    expect(cols.recordId.name).toBe("record_id");
    expect(cols.recordJson.name).toBe("record_json");
    expect(cols.signedTransformArtifactId.name).toBe("signed_transform_artifact_id");
    expect(cols.publicExposureDecision.name).toBe("public_exposure_decision");
    expect(cols.assetEvidenceStatus.name).toBe("asset_evidence_status");
    expect(cols.runtimeStatus.name).toBe("runtime_status");
    expect(cols.reviewedBy.name).toBe("reviewed_by");
  });
});

describe("migration 0040_runtime_qa_records", () => {
  it("creates the runtime QA registry idempotently", () => {
    expect(migrationSql).toContain('CREATE TABLE IF NOT EXISTS "runtime_qa_records"');
    expect(migrationSql).toContain('"runtime_package_id" uuid NOT NULL REFERENCES "runtime_packages"("id") ON DELETE CASCADE');
    expect(migrationSql).toContain('"record_json" jsonb NOT NULL');
    expect(migrationSql).toContain('"signed_transform_artifact_id" varchar(120)');
    expect(migrationSql).toContain('"reviewed_by" uuid REFERENCES "users"("id") ON DELETE SET NULL');
  });

  it("guards embedded record coherence and public exposure approval", () => {
    expect(migrationSql).toContain("runtime_qa_records_package_record_unique");
    expect(migrationSql).toContain("runtime_qa_records_json_shape");
    expect(migrationSql).toContain('"record_json"->>\'runtimePackageId\' = "runtime_package_id"::text');
    expect(migrationSql).toContain('"record_json"->\'publicExposure\'->>\'decision\' = "public_exposure_decision"');
    expect(migrationSql).toContain("runtime_qa_records_signed_transform_artifact_fk");
    expect(migrationSql).toContain('FOREIGN KEY ("runtime_package_id", "signed_transform_artifact_id")');
    expect(migrationSql).toContain('REFERENCES "runtime_transform_artifacts" ("runtime_package_id", "transform_artifact_id")');
    expect(migrationSql).toContain("runtime_qa_records_public_gate");
    expect(migrationSql).toContain("'approved_public'");
    expect(migrationSql).toContain("'human_reviewed'");
    expect(migrationSql).toContain("'signed_room_local_transform'");
    expect(migrationSql).toContain('"signed_transform_artifact_id" IS NOT NULL');
    expect(migrationSql).toContain("jsonb_path_exists");
  });

  it("is registered after runtime transform artifacts in the migration journal", () => {
    const parsed: unknown = JSON.parse(journalRaw);
    const journal = JournalSchema.parse(parsed);
    const tags = journal.entries.map((entry) => entry.tag);
    expect(tags.indexOf("0040_runtime_qa_records")).toBeGreaterThan(tags.indexOf("0039_runtime_transform_artifacts"));
  });
});
