import { createHash, randomUUID } from "node:crypto";
import {
  link,
  lstat,
  mkdir,
  open,
  opendir,
  readFile,
  realpath,
  rename,
  rm,
  unlink,
  utimes,
} from "node:fs/promises";
import {
  basename,
  dirname,
  isAbsolute,
  relative,
  resolve,
  sep,
} from "node:path";
import {
  FoundryIntakeAdmissionResultV0Schema,
  FoundryIntakeAdmissionReviewV0Schema,
  FoundryIntakeExclusionReasonSchema,
  FoundryProvenanceClassSchema,
  FoundryRelativePathSchema,
  FoundryUtcInstantSchema,
  RuntimeManifestKeySchema,
} from "@omnitwin/types";
import { z } from "zod";
import {
  domainSeparatedSha256,
  stableCanonicalJson,
  toCanonicalJson,
} from "./canonical-json.js";
import { FoundryIntegrityError } from "./errors.js";
import {
  sha256Bytes,
  sha256RegularFile,
  sha256RegularFileWithHead,
} from "./hash.js";
import { admitUniversalIntakeReceipt } from "./intake-admission.js";
import {
  FoundryUniversalIntakeReceiptSchema,
  inspectUniversalIntake,
  type FoundryUniversalIntakeReceipt,
} from "./intake-receipt.js";

export const FOUNDRY_LOCAL_INTAKE_WORKSPACE_INTENT_V0 =
  "omnitwin.foundry.local-intake-workspace-intent.v0";
export const FOUNDRY_LOCAL_INTAKE_WORKSPACE_INDEX_V0 =
  "omnitwin.foundry.local-intake-workspace-index.v0";
export const FOUNDRY_LOCAL_INTAKE_WORKSPACE_INTENT_DIGEST_DOMAIN_V0 =
  "VENVIEWER_FOUNDRY_LOCAL_INTAKE_WORKSPACE_INTENT_V0";
export const FOUNDRY_LOCAL_INTAKE_WORKSPACE_INDEX_DIGEST_DOMAIN_V0 =
  "VENVIEWER_FOUNDRY_LOCAL_INTAKE_WORKSPACE_INDEX_V0";
export const FOUNDRY_LOCAL_INTAKE_WORKSPACE_START_OPERATION_V0 =
  "copy_into_local_intake_workspace_v0";
export const FOUNDRY_LOCAL_INTAKE_WORKSPACE_DELETE_OPERATION_V0 =
  "delete_local_intake_workspace_v0";

const INTENT_PATH = "workspace-intent.json";
const INDEX_PATH = "workspace-index.json";
const RECEIPT_PATH = "evidence/intake-receipt.json";
const REVIEW_PATH = "evidence/admission-review.json";
const RESULT_PATH = "evidence/admission-result.json";
const PARTIAL_ROOT = ".partial";
const COPY_BUFFER_BYTES = 8 * 1024 * 1024;
const BARE_SHA256 = /^[a-f0-9]{64}$/u;
const PREFIXED_SHA256 = /^sha256:[a-f0-9]{64}$/u;
const WORKSPACE_ID = /^[a-z0-9][a-z0-9._-]{0,127}$/u;

const BareSha256Schema = z.string().regex(BARE_SHA256);

export const FOUNDRY_LOCAL_INTAKE_WORKSPACE_CAPABILITIES_V0 = Object.freeze({
  localPersistence: "explicit_copy_only",
  resume: "file_boundary_only",
  deletion: "explicit_digest_bound_only",
  jobPlanning: "not_authorized",
  jobSubmission: "not_authorized",
  cloudUpload: "not_authorized",
  reconstruction: "not_authorized",
  modelTraining: "not_authorized",
  enhancement: "not_authorized",
  execution: "not_authorized",
  signing: "not_authorized",
  publication: "not_authorized",
  promotion: "not_authorized",
} as const);

const CapabilitiesSchema = z
  .object({
    localPersistence: z.literal("explicit_copy_only"),
    resume: z.literal("file_boundary_only"),
    deletion: z.literal("explicit_digest_bound_only"),
    jobPlanning: z.literal("not_authorized"),
    jobSubmission: z.literal("not_authorized"),
    cloudUpload: z.literal("not_authorized"),
    reconstruction: z.literal("not_authorized"),
    modelTraining: z.literal("not_authorized"),
    enhancement: z.literal("not_authorized"),
    execution: z.literal("not_authorized"),
    signing: z.literal("not_authorized"),
    publication: z.literal("not_authorized"),
    promotion: z.literal("not_authorized"),
  })
  .strict();

export const FoundryLocalIntakeWorkspaceTruthEntryV0Schema =
  z.discriminatedUnion("state", [
    z
      .object({
        state: z.literal("pending"),
        receiptPath: FoundryRelativePathSchema,
      })
      .strict(),
    z
      .object({
        state: z.literal("admitted"),
        receiptPath: FoundryRelativePathSchema,
        assetId: RuntimeManifestKeySchema,
        captureState: z.enum([
          "raw_capture",
          "official_export",
          "derived",
          "reference",
        ]),
        provenanceClass: FoundryProvenanceClassSchema,
      })
      .strict(),
    z
      .object({
        state: z.literal("excluded"),
        receiptPath: FoundryRelativePathSchema,
        reason: FoundryIntakeExclusionReasonSchema,
      })
      .strict(),
  ]);
export type FoundryLocalIntakeWorkspaceTruthEntryV0 = z.infer<
  typeof FoundryLocalIntakeWorkspaceTruthEntryV0Schema
>;

const SnapshotFileSchema = z
  .object({
    path: FoundryRelativePathSchema,
    sizeBytes: z.number().int().safe().nonnegative(),
    sha256: BareSha256Schema,
  })
  .strict();

const IntentPayloadObjectSchema = z
  .object({
    schemaVersion: z.literal(FOUNDRY_LOCAL_INTAKE_WORKSPACE_INTENT_V0),
    workspaceId: z.string().regex(WORKSPACE_ID),
    createdAt: FoundryUtcInstantSchema,
    operation: z.literal(FOUNDRY_LOCAL_INTAKE_WORKSPACE_START_OPERATION_V0),
    source: z
      .object({
        kind: z.enum(["file", "directory"]),
        label: FoundryRelativePathSchema,
        activeSourceRelativePath: FoundryRelativePathSchema,
        fileCount: z.number().int().nonnegative().max(100_000),
        totalBytes: z.number().int().safe().nonnegative(),
      })
      .strict(),
    snapshots: z
      .object({
        receipt: SnapshotFileSchema.extend({
          path: z.literal(RECEIPT_PATH),
          nativeReceiptSha256: BareSha256Schema,
          value: FoundryUniversalIntakeReceiptSchema,
        }).strict(),
        guidedAdmission: z
          .object({
            review: SnapshotFileSchema.extend({
              path: z.literal(REVIEW_PATH),
              nativeReviewSha256: z.string().regex(PREFIXED_SHA256),
              value: FoundryIntakeAdmissionReviewV0Schema,
            }).strict(),
            result: SnapshotFileSchema.extend({
              path: z.literal(RESULT_PATH),
              nativeResultSha256: z.string().regex(PREFIXED_SHA256),
              manifestSha256: z.string().regex(PREFIXED_SHA256),
              value: FoundryIntakeAdmissionResultV0Schema,
            }).strict(),
          })
          .strict()
          .nullable(),
      })
      .strict(),
    truth: z.array(FoundryLocalIntakeWorkspaceTruthEntryV0Schema).max(100_000),
    authority: z.literal("none"),
    capabilities: CapabilitiesSchema,
  })
  .strict();

function validateIntentPayload(
  intent: z.infer<typeof IntentPayloadObjectSchema>,
  ctx: z.RefinementCtx,
): void {
    if (intent.source.activeSourceRelativePath !== `payload/${intent.source.label}`) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["source", "activeSourceRelativePath"],
        message: "active source must retain the receipt source label below payload/",
      });
    }
    const truthPaths = intent.truth.map((entry) => entry.receiptPath);
    const sorted = [...truthPaths].sort(compareText);
    if (
      truthPaths.length !== intent.source.fileCount ||
      new Set(truthPaths).size !== truthPaths.length ||
      truthPaths.some((path, index) => path !== sorted[index])
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["truth"],
        message: "truth entries must exactly count unique receipt paths in sorted order",
      });
    }
    if (
      intent.snapshots.guidedAdmission === null &&
      intent.truth.some((entry) => entry.state !== "pending")
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["truth"],
        message: "truth remains pending when no guided admission snapshot is bound",
      });
    }
  if (
    intent.snapshots.guidedAdmission !== null &&
      intent.truth.some((entry) => entry.state === "pending")
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["truth"],
        message: "a guided admission snapshot must resolve every receipt path",
      });
    }
    try {
      const receipt = intent.snapshots.receipt.value;
      const receiptBytes = snapshotBytes(receipt);
      if (
        receipt.receiptSha256 !== intent.snapshots.receipt.nativeReceiptSha256 ||
        receiptBytes.length !== intent.snapshots.receipt.sizeBytes ||
        sha256Bytes(receiptBytes) !== intent.snapshots.receipt.sha256 ||
        receipt.source.kind !== intent.source.kind ||
        receipt.source.label !== intent.source.label ||
        receipt.summary.fileCount !== intent.source.fileCount ||
        receipt.summary.totalBytes !== intent.source.totalBytes
      ) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["snapshots", "receipt"],
          message: "receipt snapshot bytes, native digest, and source summary must match",
        });
      }
      let derivedTruth: readonly FoundryLocalIntakeWorkspaceTruthEntryV0[];
      const admission = intent.snapshots.guidedAdmission;
      if (admission === null) {
        derivedTruth = receipt.files.map((file) => ({
          state: "pending" as const,
          receiptPath: file.path,
        }));
      } else {
        const review = admission.review.value;
        const result = admission.result.value;
        const reviewBytes = snapshotBytes(review);
        const resultBytes = snapshotBytes(result);
        if (
          review.reviewSha256 !== admission.review.nativeReviewSha256 ||
          reviewBytes.length !== admission.review.sizeBytes ||
          sha256Bytes(reviewBytes) !== admission.review.sha256 ||
          result.resultSha256 !== admission.result.nativeResultSha256 ||
          result.manifestSha256 !== admission.result.manifestSha256 ||
          resultBytes.length !== admission.result.sizeBytes ||
          sha256Bytes(resultBytes) !== admission.result.sha256 ||
          !sameCanonicalValue(result, admitUniversalIntakeReceipt(receipt, review))
        ) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: ["snapshots", "guidedAdmission"],
            message: "guided admission snapshots must exactly match their bytes and receipt-derived result",
          });
        }
        derivedTruth = truthFromAdmission(receipt, result);
      }
      if (!sameCanonicalValue(intent.truth, derivedTruth)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["truth"],
          message: "truth entries must derive exactly from the bound snapshots",
        });
      }
    } catch {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["snapshots"],
        message: "snapshot bindings must be internally valid and receipt-derived",
      });
    }
}

const IntentPayloadSchema = IntentPayloadObjectSchema.superRefine(
  validateIntentPayload,
);

export const FoundryLocalIntakeWorkspaceIntentV0Schema = IntentPayloadObjectSchema.extend({
  intentSha256: BareSha256Schema,
})
  .strict()
  .superRefine((intent, ctx) => {
    validateIntentPayload(intent, ctx);
    const { intentSha256: _intentSha256, ...payload } = intent;
    const parsed = IntentPayloadSchema.safeParse(payload);
    if (!parsed.success) {
      for (const issue of parsed.error.issues) ctx.addIssue(issue);
      return;
    }
    if (intent.intentSha256 !== intentPayloadSha256(parsed.data)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["intentSha256"],
        message: "workspace intent digest must match its canonical payload",
      });
    }
  });
export type FoundryLocalIntakeWorkspaceIntentV0 = z.infer<
  typeof FoundryLocalIntakeWorkspaceIntentV0Schema
>;

const EvidenceLedgerFileSchema = SnapshotFileSchema.extend({
  role: z.enum(["workspace_intent", "intake_receipt", "admission_review", "admission_result"]),
}).strict();

const PayloadLedgerFileSchema = z
  .object({
    receiptPath: FoundryRelativePathSchema,
    workspacePath: FoundryRelativePathSchema,
    sizeBytes: z.number().int().safe().nonnegative(),
    modifiedAt: FoundryUtcInstantSchema,
    sha256: BareSha256Schema,
  })
  .strict();

const IndexPayloadObjectSchema = z
  .object({
    schemaVersion: z.literal(FOUNDRY_LOCAL_INTAKE_WORKSPACE_INDEX_V0),
    workspaceId: z.string().regex(WORKSPACE_ID),
    intentSha256: BareSha256Schema,
    receiptSha256: BareSha256Schema,
    source: z
      .object({
        kind: z.enum(["file", "directory"]),
        label: FoundryRelativePathSchema,
        activeSourceRelativePath: FoundryRelativePathSchema,
      })
      .strict(),
    fileCount: z.number().int().nonnegative().max(100_000),
    totalBytes: z.number().int().safe().nonnegative(),
    evidenceFiles: z.array(EvidenceLedgerFileSchema).min(2).max(4),
    payloadFiles: z.array(PayloadLedgerFileSchema).max(100_000),
    truth: z.array(FoundryLocalIntakeWorkspaceTruthEntryV0Schema).max(100_000),
    sourceVerification: z
      .object({
        beforeReceiptSha256: BareSha256Schema,
        afterReceiptSha256: BareSha256Schema,
        workspaceReceiptSha256: BareSha256Schema,
        exactReceiptMatch: z.literal(true),
      })
      .strict(),
    authority: z.literal("none"),
    capabilities: CapabilitiesSchema,
    commitMarker: z.literal("workspace_index_written_after_full_verification"),
  })
  .strict();

function validateIndexPayload(
  index: z.infer<typeof IndexPayloadObjectSchema>,
  ctx: z.RefinementCtx,
): void {
    const payloadPaths = index.payloadFiles.map((file) => file.receiptPath);
    const workspacePaths = index.payloadFiles.map((file) => file.workspacePath);
    const evidencePaths = index.evidenceFiles.map((file) => file.path);
    if (
      index.fileCount !== index.payloadFiles.length ||
      new Set(payloadPaths).size !== payloadPaths.length ||
      payloadPaths.some((path, position) => path !== [...payloadPaths].sort(compareText)[position]) ||
      new Set(workspacePaths).size !== workspacePaths.length
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["payloadFiles"],
        message: "payload ledger must exactly count unique sorted receipt paths",
      });
    }
    if (
      new Set(evidencePaths).size !== evidencePaths.length ||
      evidencePaths.some((path, position) => path !== [...evidencePaths].sort(compareText)[position])
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["evidenceFiles"],
        message: "evidence ledger paths must be unique and sorted",
      });
    }
    const payloadTotal = index.payloadFiles.reduce((total, file) => total + file.sizeBytes, 0);
    if (!Number.isSafeInteger(payloadTotal) || payloadTotal !== index.totalBytes) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["totalBytes"],
        message: "workspace byte total must match the payload ledger",
      });
    }
    if (index.source.activeSourceRelativePath !== `payload/${index.source.label}`) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["source", "activeSourceRelativePath"],
        message: "active source must retain the receipt source label below payload/",
      });
    }
    if (
      index.sourceVerification.beforeReceiptSha256 !== index.receiptSha256 ||
      index.sourceVerification.afterReceiptSha256 !== index.receiptSha256 ||
      index.sourceVerification.workspaceReceiptSha256 !== index.receiptSha256
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["sourceVerification"],
        message: "all source verification passes must reproduce the bound receipt digest",
      });
    }
    const truthPaths = index.truth.map((entry) => entry.receiptPath);
    if (!sameCanonicalValue(truthPaths, payloadPaths)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["truth"],
        message: "truth entries must align exactly with the payload receipt paths",
      });
    }
    for (const file of index.payloadFiles) {
      const expectedWorkspacePath = index.source.kind === "file"
        ? index.source.activeSourceRelativePath
        : `${index.source.activeSourceRelativePath}/${file.receiptPath}`;
      if (file.workspacePath !== expectedWorkspacePath) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["payloadFiles"],
          message: "payload workspace paths must map exactly below the retained source label",
        });
        break;
      }
    }
    if (
      index.source.kind === "file" &&
      (index.payloadFiles.length !== 1 || index.payloadFiles[0]?.receiptPath !== index.source.label)
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["payloadFiles"],
        message: "a file workspace must contain exactly its single labelled receipt member",
      });
    }
    const roleByPath = new Map(index.evidenceFiles.map((file) => [file.path, file.role] as const));
    const baseEvidenceIsExact =
      roleByPath.get(INTENT_PATH) === "workspace_intent" &&
      roleByPath.get(RECEIPT_PATH) === "intake_receipt";
    const hasNeitherAdmission =
      !roleByPath.has(REVIEW_PATH) && !roleByPath.has(RESULT_PATH) && roleByPath.size === 2;
    const hasBothAdmission =
      roleByPath.get(REVIEW_PATH) === "admission_review" &&
      roleByPath.get(RESULT_PATH) === "admission_result" &&
      roleByPath.size === 4;
    if (!baseEvidenceIsExact || (!hasNeitherAdmission && !hasBothAdmission)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["evidenceFiles"],
        message: "evidence ledger must contain the exact base snapshots and either both admission snapshots or neither",
      });
    }
}

const IndexPayloadSchema = IndexPayloadObjectSchema.superRefine(
  validateIndexPayload,
);

export const FoundryLocalIntakeWorkspaceIndexV0Schema = IndexPayloadObjectSchema.extend({
  workspaceSha256: BareSha256Schema,
})
  .strict()
  .superRefine((index, ctx) => {
    validateIndexPayload(index, ctx);
    const { workspaceSha256: _workspaceSha256, ...payload } = index;
    const parsed = IndexPayloadSchema.safeParse(payload);
    if (!parsed.success) {
      for (const issue of parsed.error.issues) ctx.addIssue(issue);
      return;
    }
    if (index.workspaceSha256 !== indexPayloadSha256(parsed.data)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["workspaceSha256"],
        message: "workspace index digest must match its canonical payload",
      });
    }
  });
export type FoundryLocalIntakeWorkspaceIndexV0 = z.infer<
  typeof FoundryLocalIntakeWorkspaceIndexV0Schema
>;

export interface CompileFoundryLocalIntakeWorkspaceIntentV0Input {
  readonly workspaceId: string;
  readonly createdAt: string;
  readonly receipt: unknown;
  readonly admissionDraft?: {
    readonly review: unknown;
    readonly result: unknown;
  } | null;
}

export interface FoundryLocalIntakeWorkspaceProgressV0 {
  readonly phase: "validating_source" | "copying" | "verifying_workspace" | "complete";
  readonly completedFiles: number;
  readonly totalFiles: number;
  readonly completedBytes: number;
  readonly totalBytes: number;
  readonly currentFileOrdinal: number | null;
}

export interface FoundryLocalIntakeWorkspaceStatusV0 {
  readonly state: "incomplete" | "complete_verified";
  readonly workspaceId: string;
  readonly intentSha256: string;
  readonly workspaceSha256: string | null;
  readonly fileCount: number;
  readonly completedFileCount: number;
  readonly totalBytes: number;
  readonly completedBytes: number;
  readonly authority: "none";
}

export interface FoundryLocalIntakeWorkspaceVerificationV0 {
  readonly status: FoundryLocalIntakeWorkspaceStatusV0;
  readonly index: FoundryLocalIntakeWorkspaceIndexV0;
  /** Process-only convenience value. It is deliberately absent from persisted status. */
  readonly activeSourcePath: string;
}

export interface StartFoundryLocalIntakeWorkspaceV0Options {
  readonly workspaceDirectory: string;
  readonly sourcePath: string;
  readonly intent: unknown;
  readonly confirmation: {
    readonly operation: typeof FOUNDRY_LOCAL_INTAKE_WORKSPACE_START_OPERATION_V0;
    readonly intentSha256: string;
  };
  readonly signal?: AbortSignal;
  readonly onProgress?: (progress: FoundryLocalIntakeWorkspaceProgressV0) => void;
}

export interface ResumeFoundryLocalIntakeWorkspaceV0Options {
  readonly workspaceDirectory: string;
  readonly sourcePath: string;
  readonly expectedIntentSha256: string;
  readonly signal?: AbortSignal;
  readonly onProgress?: (progress: FoundryLocalIntakeWorkspaceProgressV0) => void;
}

export interface DeleteFoundryLocalIntakeWorkspaceV0Options {
  readonly workspaceDirectory: string;
  readonly expectedWorkspaceSha256: string;
  readonly confirmation: {
    readonly operation: typeof FOUNDRY_LOCAL_INTAKE_WORKSPACE_DELETE_OPERATION_V0;
    readonly workspaceSha256: string;
  };
}

export interface FoundryLocalIntakeWorkspaceDeleteResultV0 {
  readonly deleted: true;
  readonly workspaceId: string;
  readonly deletedWorkspaceSha256: string;
  readonly originalSource: "unchanged";
  readonly secureErasure: false;
}

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function operationMatches(actual: unknown, expected: string): boolean {
  return typeof actual === "string" && actual === expected;
}

function intentPayloadSha256(payload: z.infer<typeof IntentPayloadSchema>): string {
  return domainSeparatedSha256(
    FOUNDRY_LOCAL_INTAKE_WORKSPACE_INTENT_DIGEST_DOMAIN_V0,
    toCanonicalJson(payload),
  );
}

function indexPayloadSha256(payload: z.infer<typeof IndexPayloadSchema>): string {
  return domainSeparatedSha256(
    FOUNDRY_LOCAL_INTAKE_WORKSPACE_INDEX_DIGEST_DOMAIN_V0,
    toCanonicalJson(payload),
  );
}

function snapshotBytes(value: unknown): Buffer {
  return Buffer.from(stableCanonicalJson(toCanonicalJson(value)), "utf8");
}

function sameCanonicalValue(left: unknown, right: unknown): boolean {
  return stableCanonicalJson(toCanonicalJson(left)) === stableCanonicalJson(toCanonicalJson(right));
}

function truthFromAdmission(
  receipt: FoundryUniversalIntakeReceipt,
  result: z.infer<typeof FoundryIntakeAdmissionResultV0Schema>,
): readonly FoundryLocalIntakeWorkspaceTruthEntryV0[] {
  const assets = new Map(result.manifest.assets.map((asset) => [asset.relativePath, asset] as const));
  const exclusions = new Map(result.exclusions.map((exclusion) => [exclusion.path, exclusion] as const));
  return receipt.files.map((file) => {
    const asset = assets.get(file.path);
    if (asset !== undefined) {
      return {
        state: "admitted" as const,
        receiptPath: file.path,
        assetId: asset.id,
        captureState: asset.captureState,
        provenanceClass: asset.provenanceClass,
      };
    }
    const exclusion = exclusions.get(file.path);
    if (exclusion === undefined) {
      throw new FoundryIntegrityError(
        "LOCAL_INTAKE_WORKSPACE_ADMISSION_PATH_SET_MISMATCH",
        "Guided admission must resolve every receipt path exactly once.",
      );
    }
    return {
      state: "excluded" as const,
      receiptPath: file.path,
      reason: exclusion.reason,
    };
  });
}

export function compileFoundryLocalIntakeWorkspaceIntentV0(
  input: CompileFoundryLocalIntakeWorkspaceIntentV0Input,
): FoundryLocalIntakeWorkspaceIntentV0 {
  const receipt = FoundryUniversalIntakeReceiptSchema.parse(input.receipt);
  const receiptBytes = snapshotBytes(receipt);
  let guidedAdmission: z.infer<typeof IntentPayloadSchema>["snapshots"]["guidedAdmission"] = null;
  let truth: readonly FoundryLocalIntakeWorkspaceTruthEntryV0[] = receipt.files.map((file) => ({
    state: "pending" as const,
    receiptPath: file.path,
  }));
  if (input.admissionDraft !== undefined && input.admissionDraft !== null) {
    const review = FoundryIntakeAdmissionReviewV0Schema.parse(input.admissionDraft.review);
    const result = FoundryIntakeAdmissionResultV0Schema.parse(input.admissionDraft.result);
    const expectedResult = admitUniversalIntakeReceipt(receipt, review);
    if (!sameCanonicalValue(result, expectedResult)) {
      throw new FoundryIntegrityError(
        "LOCAL_INTAKE_WORKSPACE_ADMISSION_DRAFT_MISMATCH",
        "Guided admission result does not exactly follow from its receipt-bound review.",
      );
    }
    const reviewBytes = snapshotBytes(review);
    const resultBytes = snapshotBytes(result);
    guidedAdmission = {
      review: {
        path: REVIEW_PATH,
        sizeBytes: reviewBytes.length,
        sha256: sha256Bytes(reviewBytes),
        nativeReviewSha256: review.reviewSha256,
        value: review,
      },
      result: {
        path: RESULT_PATH,
        sizeBytes: resultBytes.length,
        sha256: sha256Bytes(resultBytes),
        nativeResultSha256: result.resultSha256,
        manifestSha256: result.manifestSha256,
        value: result,
      },
    };
    truth = truthFromAdmission(receipt, result);
  }
  const payload = IntentPayloadSchema.parse({
    schemaVersion: FOUNDRY_LOCAL_INTAKE_WORKSPACE_INTENT_V0,
    workspaceId: input.workspaceId,
    createdAt: input.createdAt,
    operation: FOUNDRY_LOCAL_INTAKE_WORKSPACE_START_OPERATION_V0,
    source: {
      kind: receipt.source.kind,
      label: receipt.source.label,
      activeSourceRelativePath: `payload/${receipt.source.label}`,
      fileCount: receipt.summary.fileCount,
      totalBytes: receipt.summary.totalBytes,
    },
    snapshots: {
      receipt: {
        path: RECEIPT_PATH,
        sizeBytes: receiptBytes.length,
        sha256: sha256Bytes(receiptBytes),
        nativeReceiptSha256: receipt.receiptSha256,
        value: receipt,
      },
      guidedAdmission,
    },
    truth,
    authority: "none",
    capabilities: FOUNDRY_LOCAL_INTAKE_WORKSPACE_CAPABILITIES_V0,
  });
  return FoundryLocalIntakeWorkspaceIntentV0Schema.parse({
    ...payload,
    intentSha256: intentPayloadSha256(payload),
  });
}

interface LocatedSource {
  readonly path: string;
  readonly kind: "file" | "directory";
}

interface WorkspaceRootSnapshot {
  readonly path: string;
  readonly dev: number;
  readonly ino: number;
}

interface WorkspaceTree {
  readonly files: readonly string[];
  readonly directories: readonly string[];
}

function errorCode(error: unknown): unknown {
  return typeof error === "object" && error !== null && "code" in error
    ? error.code
    : null;
}

function fail(code: string, message: string, cause?: unknown): never {
  throw new FoundryIntegrityError(
    code,
    message,
    cause === undefined ? undefined : { cause },
  );
}

function assertNotCancelled(signal: AbortSignal | undefined): void {
  if (signal?.aborted === true) {
    fail(
      "LOCAL_INTAKE_WORKSPACE_CANCELLED",
      "Local intake workspace copying was cancelled at a file boundary.",
    );
  }
}

async function mapCancellation<T>(
  signal: AbortSignal | undefined,
  action: () => Promise<T>,
): Promise<T> {
  try {
    return await action();
  } catch (error: unknown) {
    if (signal?.aborted === true) {
      return fail(
        "LOCAL_INTAKE_WORKSPACE_CANCELLED",
        "Local intake workspace copying was cancelled at a file boundary.",
        error,
      );
    }
    throw error;
  }
}

function comparable(path: string): string {
  return process.platform === "win32" ? path.toLowerCase() : path;
}

function isWithin(root: string, candidate: string): boolean {
  const fromRoot = relative(comparable(root), comparable(candidate));
  return (
    fromRoot === "" ||
    (fromRoot !== ".." &&
      !fromRoot.startsWith(`..${sep}`) &&
      !isAbsolute(fromRoot))
  );
}

function sameObjectIdentity(
  left: { readonly dev: number; readonly ino: number },
  right: { readonly dev: number; readonly ino: number },
): boolean {
  return left.dev === right.dev && left.ino === right.ino;
}

function sameFileIdentity(
  left: {
    readonly dev: number;
    readonly ino: number;
    readonly size: number;
    readonly mtimeMs: number;
    readonly ctimeMs: number;
  },
  right: {
    readonly dev: number;
    readonly ino: number;
    readonly size: number;
    readonly mtimeMs: number;
    readonly ctimeMs: number;
  },
): boolean {
  return (
    sameObjectIdentity(left, right) &&
    left.size === right.size &&
    left.mtimeMs === right.mtimeMs &&
    left.ctimeMs === right.ctimeMs
  );
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await lstat(path);
    return true;
  } catch (error: unknown) {
    if (errorCode(error) === "ENOENT") return false;
    throw error;
  }
}

async function resolveThroughExistingAncestor(input: string): Promise<string> {
  let cursor = resolve(input);
  const suffix: string[] = [];
  for (;;) {
    try {
      return resolve(await realpath(cursor), ...suffix.reverse());
    } catch (error: unknown) {
      if (errorCode(error) !== "ENOENT") throw error;
    }
    const parent = dirname(cursor);
    if (parent === cursor) {
      return fail(
        "LOCAL_INTAKE_WORKSPACE_PARENT_NOT_FOUND",
        "No existing ancestor could be resolved for the requested workspace directory.",
      );
    }
    suffix.push(cursor.slice(parent.length + (parent.endsWith(sep) ? 0 : 1)));
    cursor = parent;
  }
}

async function locateSource(input: string): Promise<LocatedSource> {
  const requested = resolve(input);
  const before = await lstat(requested);
  if (before.isSymbolicLink()) {
    return fail(
      "LOCAL_INTAKE_WORKSPACE_SOURCE_SYMLINK",
      "The selected intake source cannot be a symbolic link.",
    );
  }
  const canonical = await realpath(requested);
  const [after, requestedAfter] = await Promise.all([
    lstat(canonical),
    lstat(requested),
  ]);
  if (
    requestedAfter.isSymbolicLink() ||
    !sameObjectIdentity(before, requestedAfter) ||
    !sameObjectIdentity(requestedAfter, after)
  ) {
    return fail(
      "LOCAL_INTAKE_WORKSPACE_SOURCE_CHANGED",
      "The selected intake source changed while it was being resolved.",
    );
  }
  if (after.isFile()) return { path: canonical, kind: "file" };
  if (after.isDirectory()) return { path: canonical, kind: "directory" };
  return fail(
    "LOCAL_INTAKE_WORKSPACE_SOURCE_UNSUPPORTED",
    "The selected intake source must be one regular file or directory.",
  );
}

async function assertDisjointWorkspace(
  source: LocatedSource,
  workspaceDirectory: string,
): Promise<string> {
  const workspace = await resolveThroughExistingAncestor(workspaceDirectory);
  if (
    comparable(source.path) === comparable(workspace) ||
    isWithin(workspace, source.path) ||
    (source.kind === "directory" && isWithin(source.path, workspace))
  ) {
    return fail(
      "LOCAL_INTAKE_WORKSPACE_SOURCE_OVERLAP",
      "The workspace directory must be disjoint from the original intake source.",
    );
  }
  return workspace;
}

async function canonicalWorkspaceRoot(input: string): Promise<WorkspaceRootSnapshot> {
  const requested = resolve(input);
  let before;
  try {
    before = await lstat(requested);
  } catch (error: unknown) {
    if (errorCode(error) === "ENOENT") {
      return fail(
        "LOCAL_INTAKE_WORKSPACE_NOT_FOUND",
        "The requested local intake workspace does not exist.",
      );
    }
    throw error;
  }
  if (before.isSymbolicLink() || !before.isDirectory()) {
    return fail(
      "LOCAL_INTAKE_WORKSPACE_ROOT_UNSAFE",
      "The local intake workspace root must be a real directory, not a link or file.",
    );
  }
  const canonical = await realpath(requested);
  const [canonicalMetadata, requestedAfter] = await Promise.all([
    lstat(canonical),
    lstat(requested),
  ]);
  if (
    canonicalMetadata.isSymbolicLink() ||
    !canonicalMetadata.isDirectory() ||
    requestedAfter.isSymbolicLink() ||
    !requestedAfter.isDirectory() ||
    !sameObjectIdentity(before, requestedAfter) ||
    !sameObjectIdentity(requestedAfter, canonicalMetadata)
  ) {
    return fail(
      "LOCAL_INTAKE_WORKSPACE_ROOT_CHANGED",
      "The local intake workspace root changed while it was being resolved.",
    );
  }
  return {
    path: canonical,
    dev: canonicalMetadata.dev,
    ino: canonicalMetadata.ino,
  };
}

async function assertWorkspaceRootUnchanged(root: WorkspaceRootSnapshot): Promise<void> {
  const metadata = await lstat(root.path);
  if (
    metadata.isSymbolicLink() ||
    !metadata.isDirectory() ||
    metadata.dev !== root.dev ||
    metadata.ino !== root.ino
  ) {
    return fail(
      "LOCAL_INTAKE_WORKSPACE_ROOT_CHANGED",
      "The local intake workspace root changed during the operation.",
    );
  }
}

function resolveContained(root: string, relativePath: string): string {
  const safe = FoundryRelativePathSchema.parse(relativePath);
  const candidate = resolve(root, ...safe.split("/"));
  if (candidate === root || !isWithin(root, candidate)) {
    return fail(
      "LOCAL_INTAKE_WORKSPACE_PATH_ESCAPE",
      "A local intake workspace path escaped its trusted root.",
    );
  }
  return candidate;
}

async function ensureContainedParent(root: string, relativePath: string): Promise<void> {
  const safe = FoundryRelativePathSchema.parse(relativePath);
  const parts = safe.split("/").slice(0, -1);
  let cursor = root;
  for (const part of parts) {
    cursor = resolve(cursor, part);
    try {
      const metadata = await lstat(cursor);
      if (metadata.isSymbolicLink() || !metadata.isDirectory()) {
        return fail(
          "LOCAL_INTAKE_WORKSPACE_PARENT_UNSAFE",
          "A workspace parent component is not a real directory.",
        );
      }
    } catch (error: unknown) {
      if (errorCode(error) !== "ENOENT") throw error;
      await mkdir(cursor);
      const created = await lstat(cursor);
      if (created.isSymbolicLink() || !created.isDirectory()) {
        return fail(
          "LOCAL_INTAKE_WORKSPACE_PARENT_UNSAFE",
          "A workspace parent component was replaced while being created.",
        );
      }
    }
  }
}

async function verifyRegularFileBytes(
  path: string,
  expectedBytes: Uint8Array,
): Promise<void> {
  const before = await lstat(path);
  if (before.isSymbolicLink() || !before.isFile() || before.nlink !== 1) {
    return fail(
      "LOCAL_INTAKE_WORKSPACE_FILE_LINK_UNSAFE",
      "Every workspace artifact must be one private regular file with no hardlink alias.",
    );
  }
  const actual = await readFile(path);
  const after = await lstat(path);
  if (
    after.isSymbolicLink() ||
    !after.isFile() ||
    after.nlink !== 1 ||
    !sameFileIdentity(before, after) ||
    !actual.equals(expectedBytes)
  ) {
    return fail(
      "LOCAL_INTAKE_WORKSPACE_FILE_DIGEST_MISMATCH",
      "A workspace artifact does not match its exact digest-bound bytes.",
    );
  }
}

async function writeImmutableBytes(
  root: string,
  relativePath: string,
  bytes: Uint8Array,
): Promise<void> {
  await ensureContainedParent(root, relativePath);
  const destination = resolveContained(root, relativePath);
  let handle;
  try {
    handle = await open(destination, "wx");
  } catch (error: unknown) {
    if (errorCode(error) !== "EEXIST") throw error;
    await verifyRegularFileBytes(destination, bytes);
    return;
  }
  try {
    await handle.writeFile(bytes);
    await handle.sync();
  } finally {
    await handle.close();
  }
  await verifyRegularFileBytes(destination, bytes);
}

function validateIntentSnapshots(
  intent: FoundryLocalIntakeWorkspaceIntentV0,
): FoundryUniversalIntakeReceipt {
  const receipt = FoundryUniversalIntakeReceiptSchema.parse(intent.snapshots.receipt.value);
  const receiptBytes = snapshotBytes(receipt);
  if (
    receipt.receiptSha256 !== intent.snapshots.receipt.nativeReceiptSha256 ||
    receiptBytes.length !== intent.snapshots.receipt.sizeBytes ||
    sha256Bytes(receiptBytes) !== intent.snapshots.receipt.sha256 ||
    receipt.source.kind !== intent.source.kind ||
    receipt.source.label !== intent.source.label ||
    receipt.summary.fileCount !== intent.source.fileCount ||
    receipt.summary.totalBytes !== intent.source.totalBytes
  ) {
    return fail(
      "LOCAL_INTAKE_WORKSPACE_RECEIPT_BINDING_MISMATCH",
      "The workspace intent does not exactly bind its intake receipt snapshot.",
    );
  }
  const admission = intent.snapshots.guidedAdmission;
  const expectedTruth = admission === null
    ? receipt.files.map((file) => ({ state: "pending" as const, receiptPath: file.path }))
    : (() => {
        const review = FoundryIntakeAdmissionReviewV0Schema.parse(admission.review.value);
        const result = FoundryIntakeAdmissionResultV0Schema.parse(admission.result.value);
        const expectedResult = admitUniversalIntakeReceipt(receipt, review);
        const reviewBytes = snapshotBytes(review);
        const resultBytes = snapshotBytes(result);
        if (
          !sameCanonicalValue(result, expectedResult) ||
          review.reviewSha256 !== admission.review.nativeReviewSha256 ||
          reviewBytes.length !== admission.review.sizeBytes ||
          sha256Bytes(reviewBytes) !== admission.review.sha256 ||
          result.resultSha256 !== admission.result.nativeResultSha256 ||
          result.manifestSha256 !== admission.result.manifestSha256 ||
          resultBytes.length !== admission.result.sizeBytes ||
          sha256Bytes(resultBytes) !== admission.result.sha256
        ) {
          return fail(
            "LOCAL_INTAKE_WORKSPACE_ADMISSION_BINDING_MISMATCH",
            "The workspace intent does not exactly bind its guided admission snapshot.",
          );
        }
        return truthFromAdmission(receipt, result);
      })();
  if (!sameCanonicalValue(intent.truth, expectedTruth)) {
    return fail(
      "LOCAL_INTAKE_WORKSPACE_TRUTH_MISMATCH",
      "Workspace truth must derive only from the exact receipt and optional admission snapshot.",
    );
  }
  return receipt;
}

function parseAndValidateIntent(input: unknown): FoundryLocalIntakeWorkspaceIntentV0 {
  const intent = FoundryLocalIntakeWorkspaceIntentV0Schema.parse(input);
  validateIntentSnapshots(intent);
  return intent;
}

async function writeIntentAndSnapshots(
  root: string,
  intent: FoundryLocalIntakeWorkspaceIntentV0,
): Promise<void> {
  await writeImmutableBytes(root, INTENT_PATH, snapshotBytes(intent));
  await writeImmutableBytes(root, RECEIPT_PATH, snapshotBytes(intent.snapshots.receipt.value));
  const admission = intent.snapshots.guidedAdmission;
  if (admission !== null) {
    await writeImmutableBytes(root, REVIEW_PATH, snapshotBytes(admission.review.value));
    await writeImmutableBytes(root, RESULT_PATH, snapshotBytes(admission.result.value));
  }
}

async function readCanonicalJson(path: string): Promise<unknown> {
  const before = await lstat(path);
  if (before.isSymbolicLink() || !before.isFile() || before.nlink !== 1) {
    return fail(
      "LOCAL_INTAKE_WORKSPACE_FILE_LINK_UNSAFE",
      "Every workspace artifact must be one private regular file with no hardlink alias.",
    );
  }
  const bytes = await readFile(path);
  const after = await lstat(path);
  if (
    after.isSymbolicLink() ||
    !after.isFile() ||
    after.nlink !== 1 ||
    !sameFileIdentity(before, after)
  ) {
    return fail(
      "LOCAL_INTAKE_WORKSPACE_FILE_CHANGED",
      "A workspace artifact changed while it was being read.",
    );
  }
  try {
    return JSON.parse(bytes.toString("utf8"));
  } catch (error: unknown) {
    return fail(
      "LOCAL_INTAKE_WORKSPACE_JSON_INVALID",
      "A workspace JSON artifact is not valid JSON.",
      error,
    );
  }
}

async function loadIntent(root: string): Promise<FoundryLocalIntakeWorkspaceIntentV0> {
  const intent = parseAndValidateIntent(
    await readCanonicalJson(resolveContained(root, INTENT_PATH)),
  );
  await verifyRegularFileBytes(resolveContained(root, INTENT_PATH), snapshotBytes(intent));
  return intent;
}

async function verifyPersistedSnapshots(
  root: string,
  intent: FoundryLocalIntakeWorkspaceIntentV0,
): Promise<FoundryUniversalIntakeReceipt> {
  const receipt = validateIntentSnapshots(intent);
  await verifyRegularFileBytes(
    resolveContained(root, RECEIPT_PATH),
    snapshotBytes(receipt),
  );
  const persistedReceipt = FoundryUniversalIntakeReceiptSchema.parse(
    await readCanonicalJson(resolveContained(root, RECEIPT_PATH)),
  );
  if (!sameCanonicalValue(receipt, persistedReceipt)) {
    return fail(
      "LOCAL_INTAKE_WORKSPACE_RECEIPT_SNAPSHOT_MISMATCH",
      "The persisted receipt snapshot does not match the workspace intent.",
    );
  }
  const admission = intent.snapshots.guidedAdmission;
  if (admission !== null) {
    for (const binding of [admission.review, admission.result]) {
      await verifyRegularFileBytes(
        resolveContained(root, binding.path),
        snapshotBytes(binding.value),
      );
    }
  }
  return receipt;
}

function payloadWorkspacePath(
  intent: FoundryLocalIntakeWorkspaceIntentV0,
  receiptPath: string,
): string {
  if (intent.source.kind === "file") {
    if (receiptPath !== intent.source.label) {
      return fail(
        "LOCAL_INTAKE_WORKSPACE_FILE_RECEIPT_PATH_MISMATCH",
        "A single-file receipt path must equal its retained source label.",
      );
    }
    return intent.source.activeSourceRelativePath;
  }
  return FoundryRelativePathSchema.parse(
    `${intent.source.activeSourceRelativePath}/${receiptPath}`,
  );
}

function sourceFilePath(
  source: LocatedSource,
  receiptPath: string,
): string {
  if (source.kind === "file") return source.path;
  const safe = FoundryRelativePathSchema.parse(receiptPath);
  const candidate = resolve(source.path, ...safe.split("/"));
  if (!isWithin(source.path, candidate) || candidate === source.path) {
    return fail(
      "LOCAL_INTAKE_WORKSPACE_SOURCE_PATH_ESCAPE",
      "A receipt file path escaped the selected source directory.",
    );
  }
  return candidate;
}

async function verifyPayloadFile(
  destination: string,
  expected: FoundryUniversalIntakeReceipt["files"][number],
  signal?: AbortSignal,
): Promise<void> {
  const before = await lstat(destination);
  if (before.isSymbolicLink() || !before.isFile() || before.nlink !== 1) {
    return fail(
      "LOCAL_INTAKE_WORKSPACE_PAYLOAD_LINK_UNSAFE",
      "Every copied payload member must be one private regular file with no hardlink alias.",
    );
  }
  const digest = await sha256RegularFileWithHead(destination, 0, undefined, signal);
  const after = await lstat(destination);
  if (
    after.isSymbolicLink() ||
    !after.isFile() ||
    after.nlink !== 1 ||
    !sameFileIdentity(before, after) ||
    digest.sizeBytes !== expected.sizeBytes ||
    digest.sha256 !== expected.sha256 ||
    digest.modifiedAt !== expected.modifiedAt
  ) {
    return fail(
      "LOCAL_INTAKE_WORKSPACE_PAYLOAD_MISMATCH",
      "A copied payload member does not match its receipt bytes and preserved modification time.",
    );
  }
}

async function copyReceiptFile(
  root: string,
  sourcePath: string,
  workspacePath: string,
  expected: FoundryUniversalIntakeReceipt["files"][number],
  signal: AbortSignal | undefined,
): Promise<void> {
  const destination = resolveContained(root, workspacePath);
  if (await pathExists(destination)) {
    await verifyPayloadFile(destination, expected, signal);
    return;
  }
  assertNotCancelled(signal);
  await ensureContainedParent(root, workspacePath);
  const partialRelativePath = FoundryRelativePathSchema.parse(
    `${PARTIAL_ROOT}/${randomUUID()}.partial`,
  );
  await ensureContainedParent(root, partialRelativePath);
  const partial = resolveContained(root, partialRelativePath);
  const sourceBefore = await lstat(sourcePath);
  if (
    sourceBefore.isSymbolicLink() ||
    !sourceBefore.isFile() ||
    sourceBefore.size !== expected.sizeBytes ||
    sourceBefore.mtime.toISOString() !== expected.modifiedAt
  ) {
    return fail(
      "LOCAL_INTAKE_WORKSPACE_SOURCE_IDENTITY_MISMATCH",
      "The source file no longer matches the stored receipt.",
    );
  }
  const sourceHandle = await open(sourcePath, "r");
  let destinationHandle: Awaited<ReturnType<typeof open>> | null = null;
  try {
    const openedSource = await sourceHandle.stat();
    if (!openedSource.isFile() || !sameFileIdentity(sourceBefore, openedSource)) {
      return fail(
        "LOCAL_INTAKE_WORKSPACE_SOURCE_CHANGED",
        "The source file changed before copying began.",
      );
    }
    destinationHandle = await open(partial, "wx");
    const destinationIdentity = await destinationHandle.stat();
    if (sameObjectIdentity(openedSource, destinationIdentity)) {
      return fail(
        "LOCAL_INTAKE_WORKSPACE_SOURCE_DESTINATION_ALIAS",
        "The workspace destination unexpectedly aliases the original source file.",
      );
    }
    const digest = createHash("sha256");
    const buffer = Buffer.allocUnsafe(COPY_BUFFER_BYTES);
    let position = 0;
    for (;;) {
      assertNotCancelled(signal);
      const { bytesRead } = await sourceHandle.read(buffer, 0, buffer.length, position);
      assertNotCancelled(signal);
      if (bytesRead === 0) break;
      digest.update(buffer.subarray(0, bytesRead));
      let written = 0;
      while (written < bytesRead) {
        const result = await destinationHandle.write(
          buffer,
          written,
          bytesRead - written,
          position + written,
        );
        if (result.bytesWritten <= 0) {
          return fail(
            "LOCAL_INTAKE_WORKSPACE_WRITE_STALLED",
            "Writing a local workspace payload file made no progress.",
          );
        }
        written += result.bytesWritten;
      }
      position += bytesRead;
    }
    await destinationHandle.sync();
    const [sourceAfter, sourcePathAfter, partialAfter] = await Promise.all([
      sourceHandle.stat(),
      lstat(sourcePath),
      destinationHandle.stat(),
    ]);
    if (
      sourcePathAfter.isSymbolicLink() ||
      !sourcePathAfter.isFile() ||
      !sameFileIdentity(openedSource, sourceAfter) ||
      !sameFileIdentity(sourceAfter, sourcePathAfter) ||
      position !== expected.sizeBytes ||
      partialAfter.size !== expected.sizeBytes ||
      digest.digest("hex") !== expected.sha256
    ) {
      return fail(
        "LOCAL_INTAKE_WORKSPACE_SOURCE_CHANGED",
        "The source file changed or did not match its receipt while being copied.",
      );
    }
    const modifiedAt = new Date(expected.modifiedAt);
    await utimes(partial, modifiedAt, modifiedAt);
    await destinationHandle.sync();
  } finally {
    await destinationHandle?.close();
    await sourceHandle.close();
  }
  try {
    await link(partial, destination);
  } catch (error: unknown) {
    if (errorCode(error) !== "EEXIST") throw error;
  } finally {
    await unlink(partial).catch((error: unknown) => {
      if (errorCode(error) !== "ENOENT") throw error;
    });
  }
  await verifyPayloadFile(destination, expected, signal);
}

async function cleanPartialTree(root: string): Promise<void> {
  const partialRoot = resolveContained(root, PARTIAL_ROOT);
  if (!(await pathExists(partialRoot))) return;
  const rootMetadata = await lstat(partialRoot);
  if (rootMetadata.isSymbolicLink() || !rootMetadata.isDirectory()) {
    return fail(
      "LOCAL_INTAKE_WORKSPACE_PARTIAL_ROOT_UNSAFE",
      "The resumable partial-copy area must be a real directory.",
    );
  }
  async function clean(directory: string): Promise<void> {
    const entries = await opendir(directory);
    for await (const entry of entries) {
      const absolute = resolve(directory, entry.name);
      const metadata = await lstat(absolute);
      if (entry.isSymbolicLink() || metadata.isSymbolicLink()) {
        return fail(
          "LOCAL_INTAKE_WORKSPACE_PARTIAL_LINK_UNSAFE",
          "The resumable partial-copy area contains a symbolic link.",
        );
      }
      if (entry.isDirectory() && metadata.isDirectory()) {
        await clean(absolute);
      } else if (
        entry.isFile() &&
        metadata.isFile() &&
        metadata.nlink === 1 &&
        entry.name.endsWith(".partial")
      ) {
        await unlink(absolute);
      } else {
        return fail(
          "LOCAL_INTAKE_WORKSPACE_PARTIAL_ENTRY_UNSAFE",
          "The resumable partial-copy area contains an unrecognized entry.",
        );
      }
    }
  }
  await clean(partialRoot);
  await rm(partialRoot, { recursive: true, force: false });
}

async function listWorkspaceTree(root: string): Promise<WorkspaceTree> {
  const files: string[] = [];
  const directories: string[] = [];
  async function walk(directory: string, parts: readonly string[]): Promise<void> {
    const entries = await opendir(directory);
    const collected = [];
    for await (const entry of entries) collected.push(entry);
    collected.sort((left, right) => compareText(left.name, right.name));
    for (const entry of collected) {
      const childParts = [...parts, entry.name];
      const relativePath = FoundryRelativePathSchema.parse(childParts.join("/"));
      const absolute = resolve(directory, entry.name);
      const metadata = await lstat(absolute);
      if (entry.isSymbolicLink() || metadata.isSymbolicLink()) {
        return fail(
          "LOCAL_INTAKE_WORKSPACE_TREE_LINK_UNSAFE",
          "The local intake workspace contains a symbolic link.",
        );
      }
      if (entry.isDirectory() && metadata.isDirectory()) {
        directories.push(relativePath);
        await walk(absolute, childParts);
      } else if (entry.isFile() && metadata.isFile() && metadata.nlink === 1) {
        files.push(relativePath);
      } else if (entry.isFile() && metadata.isFile()) {
        return fail(
          "LOCAL_INTAKE_WORKSPACE_TREE_HARDLINK_UNSAFE",
          "The local intake workspace contains a hardlinked file.",
        );
      } else {
        return fail(
          "LOCAL_INTAKE_WORKSPACE_TREE_ENTRY_UNSAFE",
          "The local intake workspace contains a non-regular entry.",
        );
      }
    }
  }
  await walk(root, []);
  return {
    files: files.sort(compareText),
    directories: directories.sort(compareText),
  };
}

function expectedDirectories(
  files: readonly string[],
  requiredDirectories: readonly string[] = [],
): readonly string[] {
  const directories = new Set(requiredDirectories);
  for (const file of files) {
    const parts = file.split("/");
    for (let index = 1; index < parts.length; index += 1) {
      directories.add(parts.slice(0, index).join("/"));
    }
  }
  return [...directories].sort(compareText);
}

async function indexedFile(
  root: string,
  path: string,
  role: z.infer<typeof EvidenceLedgerFileSchema>["role"],
): Promise<z.infer<typeof EvidenceLedgerFileSchema>> {
  const digest = await sha256RegularFile(resolveContained(root, path));
  return { path, role, sizeBytes: digest.sizeBytes, sha256: digest.sha256 };
}

function emitProgress(
  options: {
    readonly onProgress?: (progress: FoundryLocalIntakeWorkspaceProgressV0) => void;
  },
  progress: FoundryLocalIntakeWorkspaceProgressV0,
): void {
  options.onProgress?.(progress);
}

async function inspectExactSource(
  source: LocatedSource,
  receipt: FoundryUniversalIntakeReceipt,
  signal: AbortSignal | undefined,
): Promise<FoundryUniversalIntakeReceipt> {
  const inspected = await inspectUniversalIntake(source.path, { signal });
  if (!sameCanonicalValue(inspected, receipt)) {
    return fail(
      "LOCAL_INTAKE_WORKSPACE_SOURCE_RECEIPT_MISMATCH",
      "The selected source no longer exactly reproduces the stored intake receipt.",
    );
  }
  return inspected;
}

async function completeWorkspace(
  rootSnapshot: WorkspaceRootSnapshot,
  source: LocatedSource,
  intent: FoundryLocalIntakeWorkspaceIntentV0,
  receiptBefore: FoundryUniversalIntakeReceipt,
  options: {
    readonly signal?: AbortSignal;
    readonly onProgress?: (progress: FoundryLocalIntakeWorkspaceProgressV0) => void;
  },
): Promise<FoundryLocalIntakeWorkspaceVerificationV0> {
  const root = rootSnapshot.path;
  await writeIntentAndSnapshots(root, intent);
  const receipt = await verifyPersistedSnapshots(root, intent);
  if (source.kind !== receipt.source.kind) {
    return fail(
      "LOCAL_INTAKE_WORKSPACE_SOURCE_KIND_MISMATCH",
      "The selected source kind differs from the stored receipt.",
    );
  }
  if (intent.source.kind === "directory") {
    await ensureContainedParent(root, `${intent.source.activeSourceRelativePath}/.keep`);
    const activeSource = resolveContained(root, intent.source.activeSourceRelativePath);
    if (!(await pathExists(activeSource))) await mkdir(activeSource);
    const activeMetadata = await lstat(activeSource);
    if (activeMetadata.isSymbolicLink() || !activeMetadata.isDirectory()) {
      return fail(
        "LOCAL_INTAKE_WORKSPACE_ACTIVE_SOURCE_UNSAFE",
        "The copied active source root must be a real directory.",
      );
    }
  }
  let completedFiles = 0;
  let completedBytes = 0;
  for (let index = 0; index < receipt.files.length; index += 1) {
    assertNotCancelled(options.signal);
    const file = receipt.files[index];
    if (file === undefined) continue;
    emitProgress(options, {
      phase: "copying",
      completedFiles,
      totalFiles: receipt.summary.fileCount,
      completedBytes,
      totalBytes: receipt.summary.totalBytes,
      currentFileOrdinal: index + 1,
    });
    await copyReceiptFile(
      root,
      sourceFilePath(source, file.path),
      payloadWorkspacePath(intent, file.path),
      file,
      options.signal,
    );
    completedFiles += 1;
    completedBytes += file.sizeBytes;
    emitProgress(options, {
      phase: "copying",
      completedFiles,
      totalFiles: receipt.summary.fileCount,
      completedBytes,
      totalBytes: receipt.summary.totalBytes,
      currentFileOrdinal: index + 1,
    });
  }
  assertNotCancelled(options.signal);
  emitProgress(options, {
    phase: "verifying_workspace",
    completedFiles,
    totalFiles: receipt.summary.fileCount,
    completedBytes,
    totalBytes: receipt.summary.totalBytes,
    currentFileOrdinal: null,
  });
  const receiptAfter = await inspectExactSource(source, receipt, options.signal);
  const activeSourcePath = resolveContained(root, intent.source.activeSourceRelativePath);
  const workspaceReceipt = await inspectUniversalIntake(activeSourcePath, {
    signal: options.signal,
  });
  if (!sameCanonicalValue(workspaceReceipt, receipt)) {
    return fail(
      "LOCAL_INTAKE_WORKSPACE_REPRODUCED_RECEIPT_MISMATCH",
      "The copied active source does not reproduce the original intake receipt.",
    );
  }
  await cleanPartialTree(root);
  const evidenceFiles = [
    await indexedFile(root, INTENT_PATH, "workspace_intent"),
    await indexedFile(root, RECEIPT_PATH, "intake_receipt"),
  ];
  if (intent.snapshots.guidedAdmission !== null) {
    evidenceFiles.push(
      await indexedFile(root, REVIEW_PATH, "admission_review"),
      await indexedFile(root, RESULT_PATH, "admission_result"),
    );
  }
  evidenceFiles.sort((left, right) => compareText(left.path, right.path));
  const payloadFiles = receipt.files.map((file) => ({
    receiptPath: file.path,
    workspacePath: payloadWorkspacePath(intent, file.path),
    sizeBytes: file.sizeBytes,
    modifiedAt: file.modifiedAt,
    sha256: file.sha256,
  }));
  const payload = IndexPayloadSchema.parse({
    schemaVersion: FOUNDRY_LOCAL_INTAKE_WORKSPACE_INDEX_V0,
    workspaceId: intent.workspaceId,
    intentSha256: intent.intentSha256,
    receiptSha256: receipt.receiptSha256,
    source: {
      kind: intent.source.kind,
      label: intent.source.label,
      activeSourceRelativePath: intent.source.activeSourceRelativePath,
    },
    fileCount: receipt.summary.fileCount,
    totalBytes: receipt.summary.totalBytes,
    evidenceFiles,
    payloadFiles,
    truth: intent.truth,
    sourceVerification: {
      beforeReceiptSha256: receiptBefore.receiptSha256,
      afterReceiptSha256: receiptAfter.receiptSha256,
      workspaceReceiptSha256: workspaceReceipt.receiptSha256,
      exactReceiptMatch: true,
    },
    authority: "none",
    capabilities: FOUNDRY_LOCAL_INTAKE_WORKSPACE_CAPABILITIES_V0,
    commitMarker: "workspace_index_written_after_full_verification",
  });
  const index = FoundryLocalIntakeWorkspaceIndexV0Schema.parse({
    ...payload,
    workspaceSha256: indexPayloadSha256(payload),
  });
  if (await pathExists(resolveContained(root, INDEX_PATH))) {
    return verifyFoundryLocalIntakeWorkspaceV0(root);
  }
  await writeImmutableBytes(root, INDEX_PATH, snapshotBytes(index));
  await assertWorkspaceRootUnchanged(rootSnapshot);
  const verified = await verifyFoundryLocalIntakeWorkspaceV0(root);
  emitProgress(options, {
    phase: "complete",
    completedFiles: receipt.summary.fileCount,
    totalFiles: receipt.summary.fileCount,
    completedBytes: receipt.summary.totalBytes,
    totalBytes: receipt.summary.totalBytes,
    currentFileOrdinal: null,
  });
  return verified;
}

function assertExactArray(left: readonly string[], right: readonly string[], code: string): void {
  if (
    left.length !== right.length ||
    left.some((value, index) => value !== right[index])
  ) {
    return fail(code, "The workspace tree does not match its exact committed ledger.");
  }
}

function statusFromIndex(
  index: FoundryLocalIntakeWorkspaceIndexV0,
): FoundryLocalIntakeWorkspaceStatusV0 {
  return {
    state: "complete_verified",
    workspaceId: index.workspaceId,
    intentSha256: index.intentSha256,
    workspaceSha256: index.workspaceSha256,
    fileCount: index.fileCount,
    completedFileCount: index.fileCount,
    totalBytes: index.totalBytes,
    completedBytes: index.totalBytes,
    authority: "none",
  };
}

function assertIndexMatchesIntentAndReceipt(
  index: FoundryLocalIntakeWorkspaceIndexV0,
  intent: FoundryLocalIntakeWorkspaceIntentV0,
  receipt: FoundryUniversalIntakeReceipt,
): void {
  const expectedPayloadFiles = receipt.files.map((file) => ({
    receiptPath: file.path,
    workspacePath: payloadWorkspacePath(intent, file.path),
    sizeBytes: file.sizeBytes,
    modifiedAt: file.modifiedAt,
    sha256: file.sha256,
  }));
  if (
    index.workspaceId !== intent.workspaceId ||
    index.intentSha256 !== intent.intentSha256 ||
    index.receiptSha256 !== receipt.receiptSha256 ||
    index.source.kind !== intent.source.kind ||
    index.source.label !== intent.source.label ||
    index.source.activeSourceRelativePath !== intent.source.activeSourceRelativePath ||
    index.fileCount !== receipt.summary.fileCount ||
    index.totalBytes !== receipt.summary.totalBytes ||
    !sameCanonicalValue(index.payloadFiles, expectedPayloadFiles) ||
    !sameCanonicalValue(index.truth, intent.truth) ||
    !sameCanonicalValue(index.capabilities, intent.capabilities) ||
    index.sourceVerification.beforeReceiptSha256 !== receipt.receiptSha256 ||
    index.sourceVerification.afterReceiptSha256 !== receipt.receiptSha256 ||
    index.sourceVerification.workspaceReceiptSha256 !== receipt.receiptSha256
  ) {
    return fail(
      "LOCAL_INTAKE_WORKSPACE_INDEX_BINDING_MISMATCH",
      "The committed workspace index does not exactly bind its intent, receipt, and payload ledger.",
    );
  }
  const expectedEvidence = [
    { path: INTENT_PATH, role: "workspace_intent" },
    { path: RECEIPT_PATH, role: "intake_receipt" },
    ...(intent.snapshots.guidedAdmission === null
      ? []
      : [
          { path: REVIEW_PATH, role: "admission_review" },
          { path: RESULT_PATH, role: "admission_result" },
        ]),
  ].sort((left, right) => compareText(left.path, right.path));
  if (
    index.evidenceFiles.length !== expectedEvidence.length ||
    index.evidenceFiles.some((file, position) => {
      const expected = expectedEvidence[position];
      return expected === undefined || file.path !== expected.path || file.role !== expected.role;
    })
  ) {
    return fail(
      "LOCAL_INTAKE_WORKSPACE_EVIDENCE_LEDGER_MISMATCH",
      "The workspace evidence ledger does not name the exact required snapshots.",
    );
  }
}

export async function verifyFoundryLocalIntakeWorkspaceV0(
  workspaceDirectory: string,
): Promise<FoundryLocalIntakeWorkspaceVerificationV0> {
  const rootSnapshot = await canonicalWorkspaceRoot(workspaceDirectory);
  const root = rootSnapshot.path;
  if (!(await pathExists(resolveContained(root, INDEX_PATH)))) {
    return fail(
      "LOCAL_INTAKE_WORKSPACE_INCOMPLETE",
      "The local intake workspace has no committed index and is not complete.",
    );
  }
  const index = FoundryLocalIntakeWorkspaceIndexV0Schema.parse(
    await readCanonicalJson(resolveContained(root, INDEX_PATH)),
  );
  await verifyRegularFileBytes(resolveContained(root, INDEX_PATH), snapshotBytes(index));
  const intent = await loadIntent(root);
  const receipt = await verifyPersistedSnapshots(root, intent);
  assertIndexMatchesIntentAndReceipt(index, intent, receipt);

  for (const file of index.evidenceFiles) {
    const absolute = resolveContained(root, file.path);
    const digest = await sha256RegularFile(absolute);
    if (digest.sizeBytes !== file.sizeBytes || digest.sha256 !== file.sha256) {
      return fail(
        "LOCAL_INTAKE_WORKSPACE_EVIDENCE_DIGEST_MISMATCH",
        "A workspace evidence snapshot does not match the committed index.",
      );
    }
  }
  for (let position = 0; position < index.payloadFiles.length; position += 1) {
    const ledgerFile = index.payloadFiles[position];
    const receiptFile = receipt.files[position];
    if (ledgerFile === undefined || receiptFile === undefined) {
      return fail(
        "LOCAL_INTAKE_WORKSPACE_PAYLOAD_LEDGER_MISMATCH",
        "The workspace payload ledger does not align with the receipt.",
      );
    }
    await verifyPayloadFile(
      resolveContained(root, ledgerFile.workspacePath),
      receiptFile,
    );
  }

  const actualTree = await listWorkspaceTree(root);
  const expectedFiles = [
    ...index.evidenceFiles.map((file) => file.path),
    ...index.payloadFiles.map((file) => file.workspacePath),
    INDEX_PATH,
  ].sort(compareText);
  const requiredDirectories = intent.source.kind === "directory"
    ? [intent.source.activeSourceRelativePath]
    : [];
  assertExactArray(
    actualTree.files,
    expectedFiles,
    "LOCAL_INTAKE_WORKSPACE_EXACT_FILE_TREE_MISMATCH",
  );
  assertExactArray(
    actualTree.directories,
    expectedDirectories(expectedFiles, requiredDirectories),
    "LOCAL_INTAKE_WORKSPACE_EXACT_DIRECTORY_TREE_MISMATCH",
  );

  const activeSourcePath = resolveContained(root, intent.source.activeSourceRelativePath);
  const reproducedReceipt = await inspectUniversalIntake(activeSourcePath);
  if (!sameCanonicalValue(reproducedReceipt, receipt)) {
    return fail(
      "LOCAL_INTAKE_WORKSPACE_REPRODUCED_RECEIPT_MISMATCH",
      "The verified workspace payload does not reproduce the original receipt.",
    );
  }
  await assertWorkspaceRootUnchanged(rootSnapshot);
  return {
    status: statusFromIndex(index),
    index,
    activeSourcePath,
  };
}

export async function inspectFoundryLocalIntakeWorkspaceV0(
  workspaceDirectory: string,
): Promise<FoundryLocalIntakeWorkspaceStatusV0> {
  const rootSnapshot = await canonicalWorkspaceRoot(workspaceDirectory);
  const root = rootSnapshot.path;
  if (await pathExists(resolveContained(root, INDEX_PATH))) {
    return (await verifyFoundryLocalIntakeWorkspaceV0(root)).status;
  }
  const intent = await loadIntent(root);
  const receipt = await verifyPersistedSnapshots(root, intent);
  const evidencePaths = [INTENT_PATH, RECEIPT_PATH];
  if (intent.snapshots.guidedAdmission !== null) {
    evidencePaths.push(REVIEW_PATH, RESULT_PATH);
  }
  const payloadPaths = receipt.files.map((file) =>
    payloadWorkspacePath(intent, file.path),
  );
  const expectedFileSet = new Set([...evidencePaths, ...payloadPaths]);
  const actualTree = await listWorkspaceTree(root);
  for (const path of actualTree.files) {
    if (
      !expectedFileSet.has(path) &&
      !/^\.partial\/[0-9a-f-]{36}\.partial$/u.test(path)
    ) {
      return fail(
        "LOCAL_INTAKE_WORKSPACE_INCOMPLETE_TREE_UNSAFE",
        "The incomplete workspace contains an unexpected file.",
      );
    }
  }
  const allowedDirectories = new Set(
    expectedDirectories(
      [...expectedFileSet],
      intent.source.kind === "directory"
        ? [intent.source.activeSourceRelativePath]
        : [],
    ),
  );
  allowedDirectories.add(PARTIAL_ROOT);
  for (const path of actualTree.directories) {
    if (!allowedDirectories.has(path) && !path.startsWith(`${PARTIAL_ROOT}/`)) {
      return fail(
        "LOCAL_INTAKE_WORKSPACE_INCOMPLETE_TREE_UNSAFE",
        "The incomplete workspace contains an unexpected directory.",
      );
    }
  }
  let completedFileCount = 0;
  let completedBytes = 0;
  for (const file of receipt.files) {
    const destination = resolveContained(root, payloadWorkspacePath(intent, file.path));
    if (!(await pathExists(destination))) continue;
    await verifyPayloadFile(destination, file);
    completedFileCount += 1;
    completedBytes += file.sizeBytes;
  }
  await assertWorkspaceRootUnchanged(rootSnapshot);
  return {
    state: "incomplete",
    workspaceId: intent.workspaceId,
    intentSha256: intent.intentSha256,
    workspaceSha256: null,
    fileCount: receipt.summary.fileCount,
    completedFileCount,
    totalBytes: receipt.summary.totalBytes,
    completedBytes,
    authority: "none",
  };
}

export async function resolveFoundryLocalIntakeWorkspaceSourcePathV0(
  workspaceDirectory: string,
  expectedIntentSha256?: string,
): Promise<string> {
  const rootSnapshot = await canonicalWorkspaceRoot(workspaceDirectory);
  const intent = await loadIntent(rootSnapshot.path);
  if (
    expectedIntentSha256 !== undefined &&
    intent.intentSha256 !== expectedIntentSha256
  ) {
    return fail(
      "LOCAL_INTAKE_WORKSPACE_INTENT_DIGEST_MISMATCH",
      "The workspace intent does not match the expected digest.",
    );
  }
  await assertWorkspaceRootUnchanged(rootSnapshot);
  return resolveContained(rootSnapshot.path, intent.source.activeSourceRelativePath);
}

export async function startFoundryLocalIntakeWorkspaceV0(
  options: StartFoundryLocalIntakeWorkspaceV0Options,
): Promise<FoundryLocalIntakeWorkspaceVerificationV0> {
  return mapCancellation(options.signal, async () => {
    const intent = parseAndValidateIntent(options.intent);
    if (
      !operationMatches(
        options.confirmation.operation,
        FOUNDRY_LOCAL_INTAKE_WORKSPACE_START_OPERATION_V0,
      ) ||
      options.confirmation.intentSha256 !== intent.intentSha256
    ) {
      return fail(
        "LOCAL_INTAKE_WORKSPACE_START_CONFIRMATION_MISMATCH",
        "Starting a workspace requires explicit confirmation bound to the exact intent digest.",
      );
    }
    assertNotCancelled(options.signal);
    const source = await locateSource(options.sourcePath);
    const workspaceTarget = await assertDisjointWorkspace(
      source,
      options.workspaceDirectory,
    );
    if (await pathExists(workspaceTarget)) {
      return fail(
        "LOCAL_INTAKE_WORKSPACE_ALREADY_EXISTS",
        "Start requires a new workspace directory; use resume for an existing workspace.",
      );
    }
    emitProgress(options, {
      phase: "validating_source",
      completedFiles: 0,
      totalFiles: intent.source.fileCount,
      completedBytes: 0,
      totalBytes: intent.source.totalBytes,
      currentFileOrdinal: null,
    });
    const receipt = validateIntentSnapshots(intent);
    const receiptBefore = await inspectExactSource(source, receipt, options.signal);
    assertNotCancelled(options.signal);
    try {
      await mkdir(workspaceTarget);
    } catch (error: unknown) {
      if (errorCode(error) === "EEXIST") {
        return fail(
          "LOCAL_INTAKE_WORKSPACE_ALREADY_EXISTS",
          "Start requires a new workspace directory; use resume for an existing workspace.",
        );
      }
      throw error;
    }
    const root = await canonicalWorkspaceRoot(workspaceTarget);
    return completeWorkspace(root, source, intent, receiptBefore, options);
  });
}

export async function resumeFoundryLocalIntakeWorkspaceV0(
  options: ResumeFoundryLocalIntakeWorkspaceV0Options,
): Promise<FoundryLocalIntakeWorkspaceVerificationV0> {
  return mapCancellation(options.signal, async () => {
    if (!BARE_SHA256.test(options.expectedIntentSha256)) {
      return fail(
        "LOCAL_INTAKE_WORKSPACE_INTENT_DIGEST_INVALID",
        "Resume requires one bare SHA-256 workspace intent digest.",
      );
    }
    const root = await canonicalWorkspaceRoot(options.workspaceDirectory);
    const intent = await loadIntent(root.path);
    if (intent.intentSha256 !== options.expectedIntentSha256) {
      return fail(
        "LOCAL_INTAKE_WORKSPACE_INTENT_DIGEST_MISMATCH",
        "The existing workspace intent does not match the expected digest.",
      );
    }
    if (await pathExists(resolveContained(root.path, INDEX_PATH))) {
      const verified = await verifyFoundryLocalIntakeWorkspaceV0(root.path);
      emitProgress(options, {
        phase: "complete",
        completedFiles: verified.status.completedFileCount,
        totalFiles: verified.status.fileCount,
        completedBytes: verified.status.completedBytes,
        totalBytes: verified.status.totalBytes,
        currentFileOrdinal: null,
      });
      return verified;
    }
    assertNotCancelled(options.signal);
    const source = await locateSource(options.sourcePath);
    await assertDisjointWorkspace(source, root.path);
    emitProgress(options, {
      phase: "validating_source",
      completedFiles: 0,
      totalFiles: intent.source.fileCount,
      completedBytes: 0,
      totalBytes: intent.source.totalBytes,
      currentFileOrdinal: null,
    });
    const receipt = validateIntentSnapshots(intent);
    const receiptBefore = await inspectExactSource(source, receipt, options.signal);
    return completeWorkspace(root, source, intent, receiptBefore, options);
  });
}

export async function deleteFoundryLocalIntakeWorkspaceV0(
  options: DeleteFoundryLocalIntakeWorkspaceV0Options,
): Promise<FoundryLocalIntakeWorkspaceDeleteResultV0> {
  const status = await inspectFoundryLocalIntakeWorkspaceV0(options.workspaceDirectory);
  const subjectDigest = status.workspaceSha256 ?? status.intentSha256;
  if (
    !BARE_SHA256.test(options.expectedWorkspaceSha256) ||
    !operationMatches(
      options.confirmation.operation,
      FOUNDRY_LOCAL_INTAKE_WORKSPACE_DELETE_OPERATION_V0,
    ) ||
    options.expectedWorkspaceSha256 !== subjectDigest ||
    options.confirmation.workspaceSha256 !== subjectDigest
  ) {
    return fail(
      "LOCAL_INTAKE_WORKSPACE_DELETE_CONFIRMATION_MISMATCH",
      "Deletion requires explicit confirmation bound to the exact current workspace digest.",
    );
  }
  const root = await canonicalWorkspaceRoot(options.workspaceDirectory);
  const parent = await realpath(dirname(root.path));
  const tombstone = resolve(
    parent,
    `.${basename(root.path)}.deleting-${randomUUID()}`,
  );
  if (!isWithin(parent, tombstone) || dirname(tombstone) !== parent) {
    return fail(
      "LOCAL_INTAKE_WORKSPACE_DELETE_PATH_UNSAFE",
      "The digest-bound deletion tombstone escaped the workspace parent.",
    );
  }
  await assertWorkspaceRootUnchanged(root);
  await rename(root.path, tombstone);
  const renamed = await lstat(tombstone);
  if (
    renamed.isSymbolicLink() ||
    !renamed.isDirectory() ||
    renamed.dev !== root.dev ||
    renamed.ino !== root.ino
  ) {
    return fail(
      "LOCAL_INTAKE_WORKSPACE_DELETE_RENAME_MISMATCH",
      "The renamed workspace did not retain the verified root identity.",
    );
  }
  try {
    await rm(tombstone, { recursive: true, force: false });
  } catch (error: unknown) {
    try {
      if (await pathExists(root.path)) {
        return fail(
          "LOCAL_INTAKE_WORKSPACE_DELETE_RESTORE_BLOCKED",
          "Deletion failed and the original workspace path is unexpectedly occupied; the isolated tombstone was retained.",
          error,
        );
      }
      await rename(tombstone, root.path);
      const restored = await lstat(root.path);
      if (
        restored.isSymbolicLink() ||
        !restored.isDirectory() ||
        restored.dev !== root.dev ||
        restored.ino !== root.ino
      ) {
        return fail(
          "LOCAL_INTAKE_WORKSPACE_DELETE_RESTORE_MISMATCH",
          "Deletion failed and the restored workspace root did not retain its verified identity.",
          error,
        );
      }
    } catch (restoreError: unknown) {
      if (restoreError instanceof FoundryIntegrityError) throw restoreError;
      return fail(
        "LOCAL_INTAKE_WORKSPACE_DELETE_RESTORE_FAILED",
        "Deletion failed and the isolated workspace could not be restored to its original path.",
        restoreError,
      );
    }
    return fail(
      "LOCAL_INTAKE_WORKSPACE_DELETE_FAILED",
      "Recursive removal did not complete; the workspace root was restored for an explicit retry.",
      error,
    );
  }
  return {
    deleted: true,
    workspaceId: status.workspaceId,
    deletedWorkspaceSha256: subjectDigest,
    originalSource: "unchanged",
    secureErasure: false,
  };
}
