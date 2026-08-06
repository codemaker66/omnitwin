import { Buffer } from "node:buffer";
import {
  FoundryIntakeAdmissionResultV0Schema,
  FoundryIntakeAdmissionReviewV0Schema,
  type FoundryIntakeAdmissionResultV0,
  type FoundryIntakeAdmissionReviewV0,
} from "@omnitwin/types";
import { z } from "zod";
import {
  domainSeparatedSha256,
  stableCanonicalJson,
  toCanonicalJson,
} from "./canonical-json.js";
import {
  FoundryCapturedQualityComparisonReportV0Schema,
  type FoundryCapturedQualityComparisonReportV0,
} from "./captured-quality-comparison.js";
import { FoundryIntegrityError } from "./errors.js";
import { admitUniversalIntakeReceipt } from "./intake-admission.js";
import {
  FoundryUniversalIntakeReceiptSchema,
  type FoundryUniversalIntakeReceipt,
} from "./intake-receipt.js";
import {
  compileFoundryLocalInspectionHandoffV0,
  FoundryLocalInspectionHandoffV0Schema,
  type FoundryLocalInspectionArtifactBindingV0,
  type FoundryLocalInspectionHandoffV0,
} from "./local-inspection-handoff-v0.js";
import {
  FoundryOperatorEvidenceChecklistV8Schema,
  type FoundryOperatorEvidenceChecklistV8,
} from "./operator-evidence-checklist-v8.js";
import {
  FoundryPlanPreviewV0Schema,
  type FoundryPlanPreviewV0,
} from "./plan-preview.js";
import {
  FoundrySourceReadinessMapV8Schema,
  type FoundrySourceReadinessMapV8,
} from "./source-readiness-v8.js";
import {
  FoundryUniversalSourceFactsV8Schema,
  type FoundryUniversalSourceFactsV8,
} from "./source-facts-v8.js";

export const FOUNDRY_LOCAL_INSPECTION_HANDOFF_PACKAGE_V0 =
  "omnitwin.foundry.local-inspection-handoff-package.v0";
export const FOUNDRY_LOCAL_INSPECTION_HANDOFF_PACKAGE_DIGEST_DOMAIN_V0 =
  "VENVIEWER_FOUNDRY_LOCAL_INSPECTION_HANDOFF_PACKAGE_V0";
export const FOUNDRY_LOCAL_INSPECTION_HANDOFF_PACKAGE_MAX_SERIALIZED_BYTES_V0 =
  32 * 1_024 * 1_024;

export const FOUNDRY_LOCAL_INSPECTION_HANDOFF_PACKAGE_LIMITATIONS_V0 =
  Object.freeze([
    "This package is a self-contained copy of locally verified inspection artifacts, not a signature, trusted timestamp, physical-accuracy certificate, rights decision, or storage-immutability proof.",
    "All embedded artifacts are parsed by their native schemas and linked to the same receipt; those checks establish digital consistency only, not real-world truth.",
    "Authority remains none, execution remains not authorized, and separate online approval is required before any cloud or state-changing work.",
    "A captured-quality comparison is metric observation only; its provenance is not established when its own source-receipt field is null.",
    "The package contains no provider credential, compute approval, execution confirmation, approval decision, signature, publication, promotion, or runtime-consumption capability.",
  ] as const);

const BARE_SHA256 = /^[a-f0-9]{64}$/u;

export interface FoundryLocalInspectionAdmissionPairV0 {
  readonly review: FoundryIntakeAdmissionReviewV0;
  readonly result: FoundryIntakeAdmissionResultV0;
}

export interface FoundryLocalInspectionHandoffEvidenceV0 {
  readonly receipt: FoundryUniversalIntakeReceipt;
  readonly sourceFacts: FoundryUniversalSourceFactsV8;
  readonly sourceReadiness: FoundrySourceReadinessMapV8;
  readonly operatorEvidenceChecklist: FoundryOperatorEvidenceChecklistV8;
  readonly admission: FoundryLocalInspectionAdmissionPairV0 | null;
  readonly planPreview: FoundryPlanPreviewV0 | null;
  readonly capturedQualityComparison:
    FoundryCapturedQualityComparisonReportV0 | null;
}

const AdmissionPairV0Schema: z.ZodType<FoundryLocalInspectionAdmissionPairV0> = z
  .object({
    review: FoundryIntakeAdmissionReviewV0Schema,
    result: FoundryIntakeAdmissionResultV0Schema,
  })
  .strict()
  .superRefine((pair, ctx) => {
    if (pair.result.reviewSha256 !== pair.review.reviewSha256) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["result", "reviewSha256"],
        message: "Admission result must bind the embedded admission review.",
      });
    }
  });

const EvidenceObjectV0Schema: z.ZodType<FoundryLocalInspectionHandoffEvidenceV0> = z
  .object({
    receipt: FoundryUniversalIntakeReceiptSchema,
    sourceFacts: FoundryUniversalSourceFactsV8Schema,
    sourceReadiness: FoundrySourceReadinessMapV8Schema,
    operatorEvidenceChecklist: FoundryOperatorEvidenceChecklistV8Schema,
    admission: AdmissionPairV0Schema.nullable(),
    planPreview: FoundryPlanPreviewV0Schema.nullable(),
    capturedQualityComparison:
      FoundryCapturedQualityComparisonReportV0Schema.nullable(),
  })
  .strict()
  .superRefine((evidence, ctx) => {
    const receiptSha256 = evidence.receipt.receiptSha256;
    if (evidence.sourceFacts.receiptSha256 !== receiptSha256) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["sourceFacts", "receiptSha256"],
        message: "Source Facts must bind the embedded receipt.",
      });
    }
    if (
      evidence.sourceReadiness.receiptSha256 !== receiptSha256 ||
      evidence.sourceReadiness.sourceFactsSha256 !==
        evidence.sourceFacts.factsSha256
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["sourceReadiness"],
        message: "Source Readiness must bind the embedded receipt and Source Facts.",
      });
    }
    if (
      evidence.operatorEvidenceChecklist.receiptSha256 !== receiptSha256 ||
      evidence.operatorEvidenceChecklist.sourceFactsSha256 !==
        evidence.sourceFacts.factsSha256 ||
      evidence.operatorEvidenceChecklist.readinessSha256 !==
        evidence.sourceReadiness.readinessSha256
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["operatorEvidenceChecklist"],
        message: "The evidence checklist must bind the embedded receipt and readiness map.",
      });
    }
    if (
      evidence.admission !== null &&
      (
        evidence.admission.review.receiptSha256 !== receiptSha256 ||
        evidence.admission.result.receiptSha256 !== receiptSha256
      )
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["admission"],
        message: "Admission artifacts must bind the embedded receipt.",
      });
    }
    if (evidence.admission !== null) {
      try {
        const expectedResult = admitUniversalIntakeReceipt(
          evidence.receipt,
          evidence.admission.review,
        );
        if (
          stableCanonicalJson(toCanonicalJson(expectedResult)) !==
          stableCanonicalJson(toCanonicalJson(evidence.admission.result))
        ) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: ["admission", "result"],
            message: "The embedded admission result must be re-derived exactly from the embedded receipt and review.",
          });
        }
      } catch {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["admission"],
          message: "The embedded receipt and review cannot reproduce the embedded admission result.",
        });
      }
    }
    if (evidence.planPreview !== null) {
      if (evidence.admission === null) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["planPreview"],
          message: "A plan preview requires its embedded admission artifacts.",
        });
      } else if (
        evidence.planPreview.admissionResultSha256 !==
          evidence.admission.result.resultSha256 ||
        evidence.planPreview.ingestManifestSha256 !==
          evidence.admission.result.manifestSha256
      ) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["planPreview"],
          message: "The plan preview must bind the embedded admission result and manifest.",
        });
      }
    }
    const comparisonReceipt =
      evidence.capturedQualityComparison?.sourceReceiptSha256 ?? null;
    if (comparisonReceipt !== null && comparisonReceipt !== receiptSha256) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["capturedQualityComparison", "sourceReceiptSha256"],
        message: "The comparison report must bind this receipt or state that provenance is not established.",
      });
    }
  });

const ARTIFACT_IDS = Object.freeze({
  receipt: "01-intake-receipt",
  sourceFacts: "02-source-facts-v8",
  sourceReadiness: "03-source-readiness-v8",
  operatorEvidenceChecklist: "04-operator-evidence-checklist-v8",
  admissionReview: "05-admission-review",
  admissionResult: "06-admission-result",
  planPreview: "07-plan-preview",
  capturedQualityComparison: "08-captured-quality-comparison",
});

function binding(
  artifactId: string,
  role: FoundryLocalInspectionArtifactBindingV0["role"],
  schemaVersion: string,
  field: FoundryLocalInspectionArtifactBindingV0["nativeDigest"]["field"],
  value: string,
): FoundryLocalInspectionArtifactBindingV0 {
  return {
    artifactId,
    role,
    schemaVersion,
    nativeDigest: {
      algorithm: "sha256",
      field,
      value,
    } as FoundryLocalInspectionArtifactBindingV0["nativeDigest"],
  };
}

function artifactBindings(
  evidence: FoundryLocalInspectionHandoffEvidenceV0,
): FoundryLocalInspectionArtifactBindingV0[] {
  const artifacts: FoundryLocalInspectionArtifactBindingV0[] = [
    binding(
      ARTIFACT_IDS.receipt,
      "intake_receipt",
      evidence.receipt.schemaVersion,
      "receiptSha256",
      evidence.receipt.receiptSha256,
    ),
    binding(
      ARTIFACT_IDS.sourceFacts,
      "source_facts",
      evidence.sourceFacts.schemaVersion,
      "factsSha256",
      evidence.sourceFacts.factsSha256,
    ),
    binding(
      ARTIFACT_IDS.sourceReadiness,
      "source_readiness",
      evidence.sourceReadiness.schemaVersion,
      "readinessSha256",
      evidence.sourceReadiness.readinessSha256,
    ),
    binding(
      ARTIFACT_IDS.operatorEvidenceChecklist,
      "operator_evidence_checklist",
      evidence.operatorEvidenceChecklist.schemaVersion,
      "checklistSha256",
      evidence.operatorEvidenceChecklist.checklistSha256,
    ),
  ];
  if (evidence.admission !== null) {
    artifacts.push(
      binding(
        ARTIFACT_IDS.admissionReview,
        "admission_review",
        evidence.admission.review.schemaVersion,
        "reviewSha256",
        evidence.admission.review.reviewSha256,
      ),
      binding(
        ARTIFACT_IDS.admissionResult,
        "admission_result",
        evidence.admission.result.schemaVersion,
        "resultSha256",
        evidence.admission.result.resultSha256,
      ),
    );
  }
  if (evidence.planPreview !== null) {
    artifacts.push(
      binding(
        ARTIFACT_IDS.planPreview,
        "plan_preview",
        evidence.planPreview.schemaVersion,
        "previewSha256",
        evidence.planPreview.previewSha256,
      ),
    );
  }
  if (evidence.capturedQualityComparison !== null) {
    artifacts.push(
      binding(
        ARTIFACT_IDS.capturedQualityComparison,
        "captured_quality_comparison",
        evidence.capturedQualityComparison.schemaVersion,
        "reportSha256",
        evidence.capturedQualityComparison.reportSha256,
      ),
    );
  }
  return artifacts.sort((left, right) =>
    left.artifactId < right.artifactId
      ? -1
      : left.artifactId > right.artifactId
        ? 1
        : 0
  );
}

const LimitationsV0Schema = z.tuple([
  z.literal(FOUNDRY_LOCAL_INSPECTION_HANDOFF_PACKAGE_LIMITATIONS_V0[0]),
  z.literal(FOUNDRY_LOCAL_INSPECTION_HANDOFF_PACKAGE_LIMITATIONS_V0[1]),
  z.literal(FOUNDRY_LOCAL_INSPECTION_HANDOFF_PACKAGE_LIMITATIONS_V0[2]),
  z.literal(FOUNDRY_LOCAL_INSPECTION_HANDOFF_PACKAGE_LIMITATIONS_V0[3]),
  z.literal(FOUNDRY_LOCAL_INSPECTION_HANDOFF_PACKAGE_LIMITATIONS_V0[4]),
]);

const MaterialBaseObjectV0Schema = z
  .object({
    schemaVersion: z.literal(FOUNDRY_LOCAL_INSPECTION_HANDOFF_PACKAGE_V0),
    purpose: z.literal("self_contained_offline_local_inspection_handoff"),
    authority: z.literal("none"),
    execution: z.literal("not_authorized"),
    onlineApproval: z.literal("required"),
    evidence: EvidenceObjectV0Schema,
    handoff: FoundryLocalInspectionHandoffV0Schema,
    limitations: LimitationsV0Schema,
  })
  .strict();

const MaterialObjectV0Schema = MaterialBaseObjectV0Schema.superRefine(
  (material, ctx) => {
    const expectedArtifacts = artifactBindings(material.evidence);
    if (
      stableCanonicalJson(toCanonicalJson(material.handoff.artifacts)) !==
      stableCanonicalJson(toCanonicalJson(expectedArtifacts))
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["handoff", "artifacts"],
        message: "The handoff index must bind every embedded artifact exactly once.",
      });
    }
    const comparison = material.evidence.capturedQualityComparison;
    const expectedComparisonReceipt = comparison?.sourceReceiptSha256 ?? null;
    const provenance = material.handoff.comparisonProvenance;
    if (
      expectedComparisonReceipt === null
        ? provenance.status !== "not_established"
        : provenance.status !== "receipt_digest_bound" ||
          provenance.sourceReceiptSha256 !== expectedComparisonReceipt
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["handoff", "comparisonProvenance"],
        message: "Comparison provenance must come from the embedded report itself.",
      });
    }
  },
);

export const FoundryLocalInspectionHandoffPackageMaterialV0Schema =
  MaterialObjectV0Schema as z.ZodType<FoundryLocalInspectionHandoffPackageMaterialV0>;
export interface FoundryLocalInspectionHandoffPackageMaterialV0 {
  readonly schemaVersion: typeof FOUNDRY_LOCAL_INSPECTION_HANDOFF_PACKAGE_V0;
  readonly purpose: "self_contained_offline_local_inspection_handoff";
  readonly authority: "none";
  readonly execution: "not_authorized";
  readonly onlineApproval: "required";
  readonly evidence: FoundryLocalInspectionHandoffEvidenceV0;
  readonly handoff: FoundryLocalInspectionHandoffV0;
  readonly limitations: typeof FOUNDRY_LOCAL_INSPECTION_HANDOFF_PACKAGE_LIMITATIONS_V0;
}

export function computeFoundryLocalInspectionHandoffPackageSha256V0(
  input: unknown,
): string {
  const material =
    FoundryLocalInspectionHandoffPackageMaterialV0Schema.parse(input);
  return domainSeparatedSha256(
    FOUNDRY_LOCAL_INSPECTION_HANDOFF_PACKAGE_DIGEST_DOMAIN_V0,
    toCanonicalJson(material),
  );
}

const PackageObjectV0Schema = MaterialBaseObjectV0Schema.extend({
  packageSha256: z.string().regex(BARE_SHA256),
}).strict();

export const FoundryLocalInspectionHandoffPackageV0Schema =
  PackageObjectV0Schema.superRefine((value, ctx) => {
    const { packageSha256: _packageSha256, ...material } = value;
    const parsed =
      FoundryLocalInspectionHandoffPackageMaterialV0Schema.safeParse(material);
    if (!parsed.success) {
      for (const issue of parsed.error.issues) ctx.addIssue(issue);
      return;
    }
    if (
      value.packageSha256 !==
      computeFoundryLocalInspectionHandoffPackageSha256V0(parsed.data)
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["packageSha256"],
        message: "The self-contained handoff package digest does not match its exact material.",
      });
    }
  }) as z.ZodType<FoundryLocalInspectionHandoffPackageV0>;

export interface FoundryLocalInspectionHandoffPackageV0
  extends FoundryLocalInspectionHandoffPackageMaterialV0 {
  readonly packageSha256: string;
}

export interface CompileFoundryLocalInspectionHandoffPackageV0Input {
  readonly dossierId: string;
  readonly createdAt: string;
  readonly evidence: {
    readonly receipt: FoundryUniversalIntakeReceipt;
    readonly sourceFacts: FoundryUniversalSourceFactsV8;
    readonly sourceReadiness: FoundrySourceReadinessMapV8;
    readonly operatorEvidenceChecklist: FoundryOperatorEvidenceChecklistV8;
    readonly admission: {
      readonly review: FoundryIntakeAdmissionReviewV0;
      readonly result: FoundryIntakeAdmissionResultV0;
    } | null;
    readonly planPreview: FoundryPlanPreviewV0 | null;
    readonly capturedQualityComparison:
      FoundryCapturedQualityComparisonReportV0 | null;
  };
}

export function compileFoundryLocalInspectionHandoffPackageV0(
  input: CompileFoundryLocalInspectionHandoffPackageV0Input,
): FoundryLocalInspectionHandoffPackageV0 {
  const evidence = EvidenceObjectV0Schema.parse(input.evidence);
  const handoff = compileFoundryLocalInspectionHandoffV0({
    dossierId: input.dossierId,
    createdAt: input.createdAt,
    artifacts: artifactBindings(evidence),
    comparisonSourceReceiptSha256:
      evidence.capturedQualityComparison?.sourceReceiptSha256 ?? null,
  });
  const material =
    FoundryLocalInspectionHandoffPackageMaterialV0Schema.parse({
      schemaVersion: FOUNDRY_LOCAL_INSPECTION_HANDOFF_PACKAGE_V0,
      purpose: "self_contained_offline_local_inspection_handoff",
      authority: "none",
      execution: "not_authorized",
      onlineApproval: "required",
      evidence,
      handoff,
      limitations: [
        ...FOUNDRY_LOCAL_INSPECTION_HANDOFF_PACKAGE_LIMITATIONS_V0,
      ],
    });
  return FoundryLocalInspectionHandoffPackageV0Schema.parse({
    ...material,
    packageSha256:
      computeFoundryLocalInspectionHandoffPackageSha256V0(material),
  });
}

export function verifyFoundryLocalInspectionHandoffPackageV0(
  input: unknown,
): FoundryLocalInspectionHandoffPackageV0 {
  try {
    return FoundryLocalInspectionHandoffPackageV0Schema.parse(input);
  } catch (error: unknown) {
    throw new FoundryIntegrityError(
      "LOCAL_INSPECTION_HANDOFF_PACKAGE_INVALID",
      "The self-contained local inspection handoff package is invalid or internally inconsistent.",
      { cause: error },
    );
  }
}

export function serializeFoundryLocalInspectionHandoffPackageV0(
  input: unknown,
): string {
  const serialized = stableCanonicalJson(
    toCanonicalJson(verifyFoundryLocalInspectionHandoffPackageV0(input)),
  );
  if (
    Buffer.byteLength(serialized, "utf8") >
      FOUNDRY_LOCAL_INSPECTION_HANDOFF_PACKAGE_MAX_SERIALIZED_BYTES_V0
  ) {
    throw new FoundryIntegrityError(
      "LOCAL_INSPECTION_HANDOFF_PACKAGE_TOO_LARGE",
      "The self-contained local inspection handoff package exceeds its fixed 32 MiB serialized limit.",
    );
  }
  return serialized;
}

/**
 * Parse untrusted serialized handoff bytes through the aggregate size gate
 * before JSON parsing or native artifact verification.
 */
export function parseFoundryLocalInspectionHandoffPackageV0(
  serialized: unknown,
): FoundryLocalInspectionHandoffPackageV0 {
  if (
    typeof serialized !== "string" ||
    Buffer.byteLength(serialized, "utf8") >
      FOUNDRY_LOCAL_INSPECTION_HANDOFF_PACKAGE_MAX_SERIALIZED_BYTES_V0
  ) {
    throw new FoundryIntegrityError(
      "LOCAL_INSPECTION_HANDOFF_PACKAGE_TOO_LARGE",
      "The serialized local inspection handoff package is not text within the fixed 32 MiB limit.",
    );
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(serialized) as unknown;
  } catch (error: unknown) {
    throw new FoundryIntegrityError(
      "LOCAL_INSPECTION_HANDOFF_PACKAGE_JSON_INVALID",
      "The serialized local inspection handoff package is not valid JSON.",
      { cause: error },
    );
  }
  return verifyFoundryLocalInspectionHandoffPackageV0(parsed);
}
