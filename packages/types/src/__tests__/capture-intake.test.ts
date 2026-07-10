import { describe, expect, it } from "vitest";
import {
  CAPTURE_INTAKE_SCHEMA_VERSION,
  CAPTURE_STAGE_SCHEMA_VERSION,
  CaptureIntakeInspectionSchema,
  CaptureIntakeOperatorStatusSchema,
  CaptureRelativePathSchema,
  CaptureStageManifestSchema,
} from "../capture-intake.js";

const SHA = "a".repeat(64);

function validInspection(): unknown {
  return {
    schemaVersion: CAPTURE_INTAKE_SCHEMA_VERSION,
    sourceRoot: "F:\\E57",
    directoryCount: 1,
    fileCount: 1,
    totalBytes: 48,
    hashedFileCount: 1,
    files: [
      {
        relativePath: "cloud_0.e57",
        sizeBytes: 48,
        modifiedAtUtc: "2026-03-01T16:43:25.000Z",
        extension: ".e57",
        signature: {
          format: "e57",
          magicHex: "4153544d2d453537",
          e57Header: {
            versionMajor: 1,
            versionMinor: 0,
            physicalLengthBytes: 48,
            xmlPhysicalOffsetBytes: 0,
            xmlLogicalLengthBytes: 0,
            pageSizeBytes: 1024,
            fileLengthMatchesHeader: true,
          },
        },
        sha256: SHA,
        classification: {
          role: "primary_capture",
          disposition: "stage",
          confidence: "high",
          evidence: ["astm_e57_signature"],
        },
      },
    ],
    copyPlan: [
      {
        sourceRelativePath: "cloud_0.e57",
        targetRelativePath: "source/e57/cloud_0.e57",
        sizeBytes: 48,
        sha256: SHA,
        role: "primary_capture",
      },
    ],
    duplicateGroups: [],
    planSha256: "b".repeat(64),
  };
}

describe("CaptureRelativePathSchema", () => {
  it("accepts canonical relative paths", () => {
    expect(CaptureRelativePathSchema.parse("source/e57/cloud_0.e57")).toBe(
      "source/e57/cloud_0.e57",
    );
  });

  it.each(["../secret", "source/../secret", "/absolute", "C:/absolute", "a\\b", "a//b"])(
    "rejects unsafe path %s",
    (path) => {
      expect(CaptureRelativePathSchema.safeParse(path).success).toBe(false);
    },
  );
});

describe("CaptureIntakeInspectionSchema", () => {
  it("accepts a consistent deterministic inspection", () => {
    expect(CaptureIntakeInspectionSchema.parse(validInspection())).toMatchObject({
      fileCount: 1,
      totalBytes: 48,
    });
  });

  it("rejects a copy plan that disagrees with inventory evidence", () => {
    const value = validInspection() as {
      copyPlan: Array<{ sha256: string }>;
    };
    value.copyPlan[0]!.sha256 = "c".repeat(64);
    expect(CaptureIntakeInspectionSchema.safeParse(value).success).toBe(false);
  });

  it("rejects stage disposition without a digest", () => {
    const value = validInspection() as {
      files: Array<{ sha256: string | null }>;
    };
    value.files[0]!.sha256 = null;
    expect(CaptureIntakeInspectionSchema.safeParse(value).success).toBe(false);
  });
});

describe("CaptureStageManifestSchema", () => {
  it("rejects totals that do not match the immutable file list", () => {
    const inspection = CaptureIntakeInspectionSchema.parse(validInspection());
    const manifest = {
      schemaVersion: CAPTURE_STAGE_SCHEMA_VERSION,
      sourceRoot: inspection.sourceRoot,
      planSha256: inspection.planSha256,
      fileCount: 1,
      totalBytes: 47,
      files: inspection.copyPlan,
    };
    expect(CaptureStageManifestSchema.safeParse(manifest).success).toBe(false);
  });
});

describe("CaptureIntakeOperatorStatusSchema", () => {
  it("accepts a staged status only with consistent verified summaries", () => {
    const status = CaptureIntakeOperatorStatusSchema.parse({
      status: "staged",
      consistencyStatus: "consistent",
      qaStatus: "intake_verified",
      inspection: {
        schemaVersion: CAPTURE_INTAKE_SCHEMA_VERSION,
        planSha256: SHA,
        inventoryFileCount: 1,
        inventoryBytes: 48,
        hashedFileCount: 1,
        plannedFileCount: 1,
        plannedBytes: 48,
        primaryCaptureFiles: 1,
        vendorControlFiles: 0,
        duplicateGroups: 0,
      },
      stageManifest: {
        schemaVersion: CAPTURE_STAGE_SCHEMA_VERSION,
        planSha256: SHA,
        fileCount: 1,
        totalBytes: 48,
      },
      caveats: ["NO_RECONSTRUCTION_QA"],
      roots: null,
    });
    expect(status.status).toBe("staged");
  });

  it("rejects a staged status whose QA is not intake-verified", () => {
    expect(
      CaptureIntakeOperatorStatusSchema.safeParse({
        status: "staged",
        consistencyStatus: "consistent",
        qaStatus: "requires_review",
        inspection: null,
        stageManifest: null,
        caveats: ["NO_RECONSTRUCTION_QA"],
        roots: null,
      }).success,
    ).toBe(false);
  });
});
