import { z } from "zod";

export const CAPTURE_INTAKE_SCHEMA_VERSION = "venviewer.capture-intake.v1";
export const CAPTURE_STAGE_SCHEMA_VERSION = "venviewer.capture-stage.v1";
export const E57_PHYSICAL_HEADER_BYTES = 48;

const SHA256_HEX = /^[a-f0-9]{64}$/;
const MAGIC_HEX = /^(?:[a-f0-9]{2})*$/;

function isCanonicalRelativePath(value: string): boolean {
  if (value.startsWith("/") || /^[A-Za-z]:/.test(value) || value.includes("\\")) {
    return false;
  }
  const parts = value.split("/");
  return parts.every((part) => part !== "" && part !== "." && part !== "..");
}

export const CaptureRelativePathSchema = z
  .string()
  .min(1)
  .max(2048)
  .refine(isCanonicalRelativePath, "path must be a canonical, traversal-free relative path");

export const CaptureSha256Schema = z
  .string()
  .regex(SHA256_HEX, "sha256 must be 64 lowercase hexadecimal characters");

export const CAPTURE_FILE_ROLES = [
  "primary_capture",
  "vendor_control",
  "derived_reference",
  "experiment",
  "diagnostic",
  "unknown",
] as const;
export const CaptureFileRoleSchema = z.enum(CAPTURE_FILE_ROLES);
export type CaptureFileRole = z.infer<typeof CaptureFileRoleSchema>;

export const CAPTURE_DISPOSITIONS = ["stage", "reference_only", "exclude"] as const;
export const CaptureDispositionSchema = z.enum(CAPTURE_DISPOSITIONS);
export type CaptureDisposition = z.infer<typeof CaptureDispositionSchema>;

export const CAPTURE_CONFIDENCE_LEVELS = ["high", "medium", "low"] as const;
export const CaptureConfidenceSchema = z.enum(CAPTURE_CONFIDENCE_LEVELS);
export type CaptureConfidence = z.infer<typeof CaptureConfidenceSchema>;

export const CAPTURE_EVIDENCE_CODES = [
  "astm_e57_signature",
  "matterpak_guid_asset_name",
  "matterpak_vendor_sidecar",
  "known_vendor_control_format",
  "explicit_derived_directory",
  "derived_pose_sidecar",
  "pipeline_output_name",
  "aligned_or_edited_name",
  "generated_checkpoint",
  "diagnostic_name",
  "executable_script",
  "reference_design_file",
  "unknown_provenance",
] as const;
export const CaptureEvidenceCodeSchema = z.enum(CAPTURE_EVIDENCE_CODES);
export type CaptureEvidenceCode = z.infer<typeof CaptureEvidenceCodeSchema>;

export const CAPTURE_FILE_FORMATS = [
  "e57",
  "jpeg",
  "png",
  "pdf",
  "sqlite",
  "matterport_metadata",
  "nwc",
  "wavefront_obj",
  "wavefront_mtl",
  "xyz",
  "ply",
  "json",
  "python",
  "text",
  "unknown",
] as const;
export const CaptureFileFormatSchema = z.enum(CAPTURE_FILE_FORMATS);
export type CaptureFileFormat = z.infer<typeof CaptureFileFormatSchema>;

export const E57PhysicalHeaderSchema = z
  .object({
    versionMajor: z.number().int().nonnegative(),
    versionMinor: z.number().int().nonnegative(),
    physicalLengthBytes: z.number().int().nonnegative(),
    xmlPhysicalOffsetBytes: z.number().int().nonnegative(),
    xmlLogicalLengthBytes: z.number().int().nonnegative(),
    pageSizeBytes: z.number().int().positive(),
    fileLengthMatchesHeader: z.boolean(),
  })
  .strict();
export type E57PhysicalHeader = z.infer<typeof E57PhysicalHeaderSchema>;

const E57_MAGIC_BYTES = [0x41, 0x53, 0x54, 0x4d, 0x2d, 0x45, 0x35, 0x37] as const;

function safeE57Integer(value: bigint, label: string): number {
  if (value > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new Error(`${label} exceeds JavaScript's safe integer range`);
  }
  return Number(value);
}

/**
 * Parses the fixed, little-endian ASTM E57 physical header without reading or
 * retaining any bytes beyond the supplied view.
 */
export function parseE57PhysicalHeader(
  bytes: Uint8Array,
  actualBytes: number,
): E57PhysicalHeader {
  if (bytes.byteLength < E57_PHYSICAL_HEADER_BYTES) {
    throw new Error("ASTM E57 file is shorter than its 48-byte physical header");
  }
  for (const [index, expected] of E57_MAGIC_BYTES.entries()) {
    if (bytes[index] !== expected) {
      throw new Error("ASTM E57 physical header has an invalid signature");
    }
  }
  if (!Number.isSafeInteger(actualBytes) || actualBytes < 0) {
    throw new Error("E57 actual byte length must be a nonnegative safe integer");
  }

  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const physicalLengthBytes = safeE57Integer(
    view.getBigUint64(16, true),
    "E57 physical length",
  );
  const xmlPhysicalOffsetBytes = safeE57Integer(
    view.getBigUint64(24, true),
    "E57 XML offset",
  );
  const xmlLogicalLengthBytes = safeE57Integer(
    view.getBigUint64(32, true),
    "E57 XML length",
  );
  const pageSizeBytes = safeE57Integer(view.getBigUint64(40, true), "E57 page size");
  if (pageSizeBytes <= 0) {
    throw new Error("ASTM E57 page size must be positive");
  }

  return {
    versionMajor: view.getUint32(8, true),
    versionMinor: view.getUint32(12, true),
    physicalLengthBytes,
    xmlPhysicalOffsetBytes,
    xmlLogicalLengthBytes,
    pageSizeBytes,
    fileLengthMatchesHeader: physicalLengthBytes === actualBytes,
  };
}

export const CaptureFileSignatureSchema = z
  .object({
    format: CaptureFileFormatSchema,
    magicHex: z.string().regex(MAGIC_HEX).max(96),
    e57Header: E57PhysicalHeaderSchema.nullable(),
  })
  .strict()
  .superRefine((signature, ctx) => {
    if ((signature.format === "e57") !== (signature.e57Header !== null)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["e57Header"],
        message: "e57Header must be present exactly when format is e57",
      });
    }
  });
export type CaptureFileSignature = z.infer<typeof CaptureFileSignatureSchema>;

export const CaptureFileClassificationSchema = z
  .object({
    role: CaptureFileRoleSchema,
    disposition: CaptureDispositionSchema,
    confidence: CaptureConfidenceSchema,
    evidence: z.array(CaptureEvidenceCodeSchema).min(1),
  })
  .strict()
  .superRefine((classification, ctx) => {
    if (
      classification.disposition === "stage" &&
      classification.role !== "primary_capture" &&
      classification.role !== "vendor_control"
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["disposition"],
        message: "only primary captures and vendor controls may be staged",
      });
    }
  });
export type CaptureFileClassification = z.infer<typeof CaptureFileClassificationSchema>;

export const CaptureInventoryFileSchema = z
  .object({
    relativePath: CaptureRelativePathSchema,
    sizeBytes: z.number().int().nonnegative(),
    modifiedAtUtc: z.string().datetime({ offset: true }),
    extension: z.string().max(32),
    signature: CaptureFileSignatureSchema,
    sha256: CaptureSha256Schema.nullable(),
    classification: CaptureFileClassificationSchema,
  })
  .strict()
  .superRefine((file, ctx) => {
    if (file.classification.disposition === "stage" && file.sha256 === null) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["sha256"],
        message: "staged files require a sha256 digest",
      });
    }
  });
export type CaptureInventoryFile = z.infer<typeof CaptureInventoryFileSchema>;

export const CaptureCopyPlanEntrySchema = z
  .object({
    sourceRelativePath: CaptureRelativePathSchema,
    targetRelativePath: CaptureRelativePathSchema,
    sizeBytes: z.number().int().nonnegative(),
    sha256: CaptureSha256Schema,
    role: z.union([z.literal("primary_capture"), z.literal("vendor_control")]),
  })
  .strict();
export type CaptureCopyPlanEntry = z.infer<typeof CaptureCopyPlanEntrySchema>;

export const CaptureDuplicateGroupSchema = z
  .object({
    sha256: CaptureSha256Schema,
    relativePaths: z.array(CaptureRelativePathSchema).min(2),
  })
  .strict();
export type CaptureDuplicateGroup = z.infer<typeof CaptureDuplicateGroupSchema>;

function isStrictlySorted(values: readonly string[]): boolean {
  for (let index = 1; index < values.length; index += 1) {
    const previous = values[index - 1];
    const current = values[index];
    if (previous === undefined || current === undefined || previous >= current) return false;
  }
  return true;
}

function validateInventoryTotals(
  inspection: {
    fileCount: number;
    totalBytes: number;
    hashedFileCount: number;
    files: readonly CaptureInventoryFile[];
  },
  ctx: z.RefinementCtx,
): void {
  if (inspection.fileCount !== inspection.files.length) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["fileCount"], message: "fileCount mismatch" });
  }
  const totalBytes = inspection.files.reduce((sum, file) => sum + file.sizeBytes, 0);
  if (inspection.totalBytes !== totalBytes) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["totalBytes"], message: "totalBytes mismatch" });
  }
  const hashed = inspection.files.filter((file) => file.sha256 !== null).length;
  if (inspection.hashedFileCount !== hashed) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["hashedFileCount"],
      message: "hashedFileCount mismatch",
    });
  }
}

function validateCopyPlan(
  inspection: {
    files: readonly CaptureInventoryFile[];
    copyPlan: readonly CaptureCopyPlanEntry[];
  },
  ctx: z.RefinementCtx,
): void {
  const files = new Map(inspection.files.map((file) => [file.relativePath, file]));
  const targets = new Set<string>();
  for (const [index, entry] of inspection.copyPlan.entries()) {
    const file = files.get(entry.sourceRelativePath);
    if (
      file === undefined ||
      file.classification.disposition !== "stage" ||
      file.sha256 !== entry.sha256 ||
      file.sizeBytes !== entry.sizeBytes ||
      file.classification.role !== entry.role
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["copyPlan", index],
        message: "copy plan entry does not match its staged inventory file",
      });
    }
    if (targets.has(entry.targetRelativePath)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["copyPlan", index, "targetRelativePath"],
        message: "copy plan targets must be unique",
      });
    }
    targets.add(entry.targetRelativePath);
  }
  const stagedCount = inspection.files.filter(
    (file) => file.classification.disposition === "stage",
  ).length;
  if (stagedCount !== inspection.copyPlan.length) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["copyPlan"],
      message: "copy plan must contain every staged inventory file",
    });
  }
}

export const CaptureIntakeInspectionSchema = z
  .object({
    schemaVersion: z.literal(CAPTURE_INTAKE_SCHEMA_VERSION),
    sourceRoot: z.string().min(1).max(2048),
    directoryCount: z.number().int().nonnegative(),
    fileCount: z.number().int().nonnegative(),
    totalBytes: z.number().int().nonnegative(),
    hashedFileCount: z.number().int().nonnegative(),
    files: z.array(CaptureInventoryFileSchema),
    copyPlan: z.array(CaptureCopyPlanEntrySchema),
    duplicateGroups: z.array(CaptureDuplicateGroupSchema),
    planSha256: CaptureSha256Schema,
  })
  .strict()
  .superRefine((inspection, ctx) => {
    validateInventoryTotals(inspection, ctx);
    validateCopyPlan(inspection, ctx);
    if (!isStrictlySorted(inspection.files.map((file) => file.relativePath))) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["files"], message: "files must be sorted" });
    }
    if (!isStrictlySorted(inspection.copyPlan.map((entry) => entry.sourceRelativePath))) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["copyPlan"],
        message: "copy plan must be sorted",
      });
    }
  });
export type CaptureIntakeInspection = z.infer<typeof CaptureIntakeInspectionSchema>;

export const CaptureStageManifestSchema = z
  .object({
    schemaVersion: z.literal(CAPTURE_STAGE_SCHEMA_VERSION),
    sourceRoot: z.string().min(1).max(2048),
    planSha256: CaptureSha256Schema,
    fileCount: z.number().int().nonnegative(),
    totalBytes: z.number().int().nonnegative(),
    files: z.array(CaptureCopyPlanEntrySchema),
  })
  .strict()
  .superRefine((manifest, ctx) => {
    if (manifest.fileCount !== manifest.files.length) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["fileCount"], message: "fileCount mismatch" });
    }
    const totalBytes = manifest.files.reduce((sum, file) => sum + file.sizeBytes, 0);
    if (manifest.totalBytes !== totalBytes) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["totalBytes"], message: "totalBytes mismatch" });
    }
    if (!isStrictlySorted(manifest.files.map((file) => file.sourceRelativePath))) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["files"], message: "files must be sorted" });
    }
  });
export type CaptureStageManifest = z.infer<typeof CaptureStageManifestSchema>;

export const CAPTURE_INTAKE_CONSISTENCY_STATUSES = [
  "not_checkable",
  "inspection_valid",
  "consistent",
  "inconsistent",
  "invalid",
] as const;
export const CaptureIntakeConsistencyStatusSchema = z.enum(
  CAPTURE_INTAKE_CONSISTENCY_STATUSES,
);
export type CaptureIntakeConsistencyStatus = z.infer<
  typeof CaptureIntakeConsistencyStatusSchema
>;

export const CAPTURE_INTAKE_QA_STATUSES = [
  "blocked",
  "requires_review",
  "intake_verified",
] as const;
export const CaptureIntakeQaStatusSchema = z.enum(CAPTURE_INTAKE_QA_STATUSES);
export type CaptureIntakeQaStatus = z.infer<typeof CaptureIntakeQaStatusSchema>;

export const CAPTURE_INTAKE_CAVEATS = [
  "INSPECTION_NOT_CONFIGURED",
  "INSPECTION_UNAVAILABLE",
  "INSPECTION_INVALID",
  "STAGE_MANIFEST_NOT_CONFIGURED",
  "STAGE_MANIFEST_UNAVAILABLE",
  "STAGE_MANIFEST_INVALID",
  "STAGED_FILES_MISSING_OR_CHANGED",
  "LEDGER_MISMATCH",
  "SOURCE_BYTES_ARE_NOT_RUNTIME_READY",
  "NO_RECONSTRUCTION_QA",
  "NO_SPATIAL_ACCURACY_CERTIFICATION",
  "DERIVED_REFERENCES_EXCLUDED_FROM_TRUTH_INPUTS",
  "STATUS_READ_DOES_NOT_REHASH_STAGED_BYTES",
] as const;
export const CaptureIntakeCaveatSchema = z.enum(CAPTURE_INTAKE_CAVEATS);
export type CaptureIntakeCaveat = z.infer<typeof CaptureIntakeCaveatSchema>;

const CaptureIntakeInspectionSummarySchema = z
  .object({
    schemaVersion: z.literal(CAPTURE_INTAKE_SCHEMA_VERSION),
    planSha256: CaptureSha256Schema,
    inventoryFileCount: z.number().int().nonnegative(),
    inventoryBytes: z.number().int().nonnegative(),
    hashedFileCount: z.number().int().nonnegative(),
    plannedFileCount: z.number().int().nonnegative(),
    plannedBytes: z.number().int().nonnegative(),
    primaryCaptureFiles: z.number().int().nonnegative(),
    vendorControlFiles: z.number().int().nonnegative(),
    duplicateGroups: z.number().int().nonnegative(),
  })
  .strict();
export type CaptureIntakeInspectionSummary = z.infer<
  typeof CaptureIntakeInspectionSummarySchema
>;

const CaptureIntakeStageSummarySchema = z
  .object({
    schemaVersion: z.literal(CAPTURE_STAGE_SCHEMA_VERSION),
    planSha256: CaptureSha256Schema,
    fileCount: z.number().int().nonnegative(),
    totalBytes: z.number().int().nonnegative(),
  })
  .strict();
export type CaptureIntakeStageSummary = z.infer<typeof CaptureIntakeStageSummarySchema>;

const CaptureIntakeRootsSchema = z
  .object({
    sourceRoot: z.string().min(1).max(2048).nullable(),
    stagingRoot: z.string().min(1).max(2048).nullable(),
  })
  .strict();
export type CaptureIntakeRoots = z.infer<typeof CaptureIntakeRootsSchema>;

const OperatorStatusBaseSchema = z.object({
  caveats: z.array(CaptureIntakeCaveatSchema).min(1),
  roots: CaptureIntakeRootsSchema.nullable(),
});

const CaptureIntakeUnavailableStatusSchema = OperatorStatusBaseSchema.extend({
  status: z.literal("unavailable"),
  consistencyStatus: z.union([z.literal("not_checkable"), z.literal("invalid")]),
  qaStatus: z.literal("blocked"),
  inspection: z.null(),
  stageManifest: z.null(),
}).strict();

const CaptureIntakeInspectedStatusSchema = OperatorStatusBaseSchema.extend({
  status: z.literal("inspected"),
  consistencyStatus: z.union([
    z.literal("inspection_valid"),
    z.literal("inconsistent"),
    z.literal("invalid"),
  ]),
  qaStatus: z.union([z.literal("requires_review"), z.literal("blocked")]),
  inspection: CaptureIntakeInspectionSummarySchema,
  stageManifest: CaptureIntakeStageSummarySchema.nullable(),
}).strict();

const CaptureIntakeStagedStatusSchema = OperatorStatusBaseSchema.extend({
  status: z.literal("staged"),
  consistencyStatus: z.literal("consistent"),
  qaStatus: z.literal("intake_verified"),
  inspection: CaptureIntakeInspectionSummarySchema,
  stageManifest: CaptureIntakeStageSummarySchema,
}).strict();

export const CaptureIntakeOperatorStatusSchema = z.discriminatedUnion("status", [
  CaptureIntakeUnavailableStatusSchema,
  CaptureIntakeInspectedStatusSchema,
  CaptureIntakeStagedStatusSchema,
]);
export type CaptureIntakeOperatorStatus = z.infer<typeof CaptureIntakeOperatorStatusSchema>;
