import { describe, expect, it } from "vitest";
import {
  CAPTURE_INTAKE_SCHEMA_VERSION,
  CAPTURE_STAGE_SCHEMA_VERSION,
  E57_PHYSICAL_HEADER_BYTES,
  CaptureIntakeInspectionSchema,
  CaptureIntakeOperatorStatusSchema,
  CaptureRelativePathSchema,
  CaptureStageManifestSchema,
  parseE57PhysicalHeader,
} from "../capture-intake.js";

const SHA = "a".repeat(64);

function e57HeaderBytes(): Uint8Array {
  const backing = new Uint8Array(E57_PHYSICAL_HEADER_BYTES + 7);
  const bytes = backing.subarray(7);
  bytes.set([0x41, 0x53, 0x54, 0x4d, 0x2d, 0x45, 0x35, 0x37]);
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  view.setUint32(8, 1, true);
  view.setUint32(12, 2, true);
  view.setBigUint64(16, 48n, true);
  view.setBigUint64(24, 32n, true);
  view.setBigUint64(32, 128n, true);
  view.setBigUint64(40, 1024n, true);
  return bytes;
}

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

describe("parseE57PhysicalHeader", () => {
  it("parses a valid offset Uint8Array view and binds the declared file length", () => {
    expect(E57_PHYSICAL_HEADER_BYTES).toBe(48);
    expect(parseE57PhysicalHeader(e57HeaderBytes(), 48)).toEqual({
      versionMajor: 1,
      versionMinor: 2,
      physicalLengthBytes: 48,
      xmlPhysicalOffsetBytes: 32,
      xmlLogicalLengthBytes: 128,
      pageSizeBytes: 1024,
      fileLengthMatchesHeader: true,
    });
    expect(parseE57PhysicalHeader(e57HeaderBytes(), 49).fileLengthMatchesHeader).toBe(false);
  });

  it("rejects truncated or incorrectly signed headers", () => {
    expect(() => parseE57PhysicalHeader(e57HeaderBytes().subarray(0, 47), 47)).toThrow(
      "shorter than its 48-byte physical header",
    );
    const bytes = e57HeaderBytes();
    bytes[0] = 0;
    expect(() => parseE57PhysicalHeader(bytes, 48)).toThrow("invalid signature");
  });

  it.each([-1, 1.5, Number.NaN, Number.MAX_SAFE_INTEGER + 1])(
    "rejects unsafe actual byte length %s",
    (actualBytes) => {
      expect(() => parseE57PhysicalHeader(e57HeaderBytes(), actualBytes)).toThrow(
        "nonnegative safe integer",
      );
    },
  );

  it.each([
    [16, "physical length"],
    [24, "XML offset"],
    [32, "XML length"],
    [40, "page size"],
  ] as const)("rejects an unsafe uint64 at byte %i", (offset, label) => {
    const bytes = e57HeaderBytes();
    new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).setBigUint64(
      offset,
      BigInt(Number.MAX_SAFE_INTEGER) + 1n,
      true,
    );
    expect(() => parseE57PhysicalHeader(bytes, 48)).toThrow(
      `E57 ${label} exceeds JavaScript's safe integer range`,
    );
  });

  it("rejects a zero page size", () => {
    const bytes = e57HeaderBytes();
    new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).setBigUint64(40, 0n, true);
    expect(() => parseE57PhysicalHeader(bytes, 48)).toThrow("page size must be positive");
  });
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
