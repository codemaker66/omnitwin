import { FoundryUtcInstantSchema } from "@omnitwin/types";
import { z } from "zod";
import {
  domainSeparatedSha256,
  stableCanonicalJson,
  toCanonicalJson,
} from "./canonical-json.js";
import { FoundryIntegrityError } from "./errors.js";

export const FOUNDRY_LOCAL_INSPECTION_HANDOFF_V0 =
  "omnitwin.foundry.local-inspection-handoff.v0";
export const FOUNDRY_LOCAL_INSPECTION_HANDOFF_DIGEST_DOMAIN_V0 =
  "VENVIEWER_FOUNDRY_LOCAL_INSPECTION_HANDOFF_V0";

export const FOUNDRY_LOCAL_INSPECTION_HANDOFF_LIMITATIONS_V0 = Object.freeze([
  "This local dossier is a digest-bound handoff index, not a signature, trusted timestamp, execution attestation, or physical-storage immutability proof.",
  "Each referenced artifact must pass its own native schema and digest verifier before its identity is supplied to this dossier verifier.",
  "Binding an inspection artifact records exactly which report was handed over; it does not establish physical accuracy, metric registration, completeness, or real-world truth.",
  "Authority remains none, execution remains not authorized, and a separate online approval is required before any cloud or state-changing work.",
  "Comparison provenance is not established unless an exact comparison report explicitly binds the exact intake-receipt digest recorded here.",
  "This dossier carries no credentials, approval decision, signature, evidence registration, release, publication, promotion, or runtime-consumption capability.",
] as const);

export const FOUNDRY_LOCAL_INSPECTION_ARTIFACT_ROLES_V0 = [
  "intake_receipt",
  "source_facts",
  "source_readiness",
  "operator_evidence_checklist",
  "admission_review",
  "admission_result",
  "pipeline_recipe",
  "plan_preview",
  "captured_quality_comparison",
] as const;

const MAX_HANDOFF_ARTIFACT_COUNT =
  FOUNDRY_LOCAL_INSPECTION_ARTIFACT_ROLES_V0.length;
const SUPPORTED_SOURCE_CHAIN_VERSION_COUNT = 8;

export const FoundryLocalInspectionArtifactRoleV0Schema = z.enum(
  FOUNDRY_LOCAL_INSPECTION_ARTIFACT_ROLES_V0,
);
export type FoundryLocalInspectionArtifactRoleV0 = z.infer<
  typeof FoundryLocalInspectionArtifactRoleV0Schema
>;

export const FOUNDRY_LOCAL_INSPECTION_TRUTH_TOPICS_V0 = [
  "source_identity",
  "format_and_structure",
  "readiness_assessment",
  "operator_evidence_gaps",
  "admission_classification",
  "execution_plan",
  "comparison_evidence",
  "physical_accuracy",
  "rights_and_permissions",
  "release_authority",
] as const;

const BARE_SHA256 = /^[a-f0-9]{64}$/u;
const PREFIXED_SHA256 = /^sha256:[a-f0-9]{64}$/u;
const STABLE_ID = /^[a-z0-9][a-z0-9._-]{0,127}$/u;
const SCHEMA_VERSION = /^omnitwin\.foundry\.[a-z0-9.-]+\.v[0-9]+$/u;

const BareSha256Schema = z.string().regex(BARE_SHA256);
const PrefixedSha256Schema = z.string().regex(PREFIXED_SHA256);
const StableIdSchema = z.string().regex(STABLE_ID);

const BareNativeDigestBindingV0Schema = z
  .object({
    algorithm: z.literal("sha256"),
    field: z.enum([
      "receiptSha256",
      "factsSha256",
      "readinessSha256",
      "checklistSha256",
      "reportSha256",
    ]),
    value: BareSha256Schema,
  })
  .strict();

const PrefixedNativeDigestBindingV0Schema = z
  .object({
    algorithm: z.literal("sha256"),
    field: z.enum([
      "reviewSha256",
      "resultSha256",
      "recipeSha256",
      "previewSha256",
    ]),
    value: PrefixedSha256Schema,
  })
  .strict();

export const FoundryLocalInspectionNativeDigestBindingV0Schema =
  z.union([
    BareNativeDigestBindingV0Schema,
    PrefixedNativeDigestBindingV0Schema,
  ]);
export type FoundryLocalInspectionNativeDigestBindingV0 = z.infer<
  typeof FoundryLocalInspectionNativeDigestBindingV0Schema
>;

const EXPECTED_DIGEST_FIELD_BY_ROLE: Readonly<
  Record<FoundryLocalInspectionArtifactRoleV0, string>
> = Object.freeze({
  intake_receipt: "receiptSha256",
  source_facts: "factsSha256",
  source_readiness: "readinessSha256",
  operator_evidence_checklist: "checklistSha256",
  admission_review: "reviewSha256",
  admission_result: "resultSha256",
  pipeline_recipe: "recipeSha256",
  plan_preview: "previewSha256",
  captured_quality_comparison: "reportSha256",
});

const EXPECTED_SCHEMA_VERSIONS_BY_ROLE: Readonly<
  Record<FoundryLocalInspectionArtifactRoleV0, readonly string[]>
> = Object.freeze({
  intake_receipt: Object.freeze([
    "omnitwin.foundry.universal-intake-receipt.v0",
  ]),
  source_facts: Object.freeze(
    Array.from(
      { length: SUPPORTED_SOURCE_CHAIN_VERSION_COUNT },
      (_, index) =>
        `omnitwin.foundry.universal-source-facts.v${String(index + 1)}`,
    ),
  ),
  source_readiness: Object.freeze(
    Array.from(
      { length: SUPPORTED_SOURCE_CHAIN_VERSION_COUNT },
      (_, index) =>
        `omnitwin.foundry.source-readiness-map.v${String(index + 1)}`,
    ),
  ),
  operator_evidence_checklist: Object.freeze(
    Array.from(
      { length: SUPPORTED_SOURCE_CHAIN_VERSION_COUNT },
      (_, index) =>
        `omnitwin.foundry.operator-evidence-checklist.v${String(index + 1)}`,
    ),
  ),
  admission_review: Object.freeze([
    "omnitwin.foundry.intake-admission-review.v0",
  ]),
  admission_result: Object.freeze([
    "omnitwin.foundry.intake-admission-result.v0",
  ]),
  pipeline_recipe: Object.freeze([
    "omnitwin.foundry.reconstruction-recipe.v0",
  ]),
  plan_preview: Object.freeze(["omnitwin.foundry.plan-preview.v0"]),
  captured_quality_comparison: Object.freeze([
    "omnitwin.foundry.captured-quality-comparison-report.v0",
  ]),
});

function addIssue(
  ctx: z.RefinementCtx,
  path: readonly (string | number)[],
  message: string,
): void {
  ctx.addIssue({
    code: z.ZodIssueCode.custom,
    path: [...path],
    message,
  });
}

const ArtifactBindingObjectV0Schema = z
  .object({
    artifactId: StableIdSchema,
    role: FoundryLocalInspectionArtifactRoleV0Schema,
    schemaVersion: z.string().regex(SCHEMA_VERSION),
    nativeDigest: FoundryLocalInspectionNativeDigestBindingV0Schema,
  })
  .strict();

function validateArtifactBinding(
  artifact: z.infer<typeof ArtifactBindingObjectV0Schema>,
  ctx: z.RefinementCtx,
): void {
  const allowedVersions = EXPECTED_SCHEMA_VERSIONS_BY_ROLE[artifact.role];
  if (!allowedVersions.includes(artifact.schemaVersion)) {
    addIssue(
      ctx,
      ["schemaVersion"],
      `Artifact role ${artifact.role} uses an unsupported schema version.`,
    );
  }
  const expectedField = EXPECTED_DIGEST_FIELD_BY_ROLE[artifact.role];
  if (artifact.nativeDigest.field !== expectedField) {
    addIssue(
      ctx,
      ["nativeDigest", "field"],
      `Artifact role ${artifact.role} must bind its native ${expectedField} digest field.`,
    );
  }
}

export const FoundryLocalInspectionArtifactBindingV0Schema =
  ArtifactBindingObjectV0Schema.superRefine(validateArtifactBinding);
export type FoundryLocalInspectionArtifactBindingV0 = z.infer<
  typeof FoundryLocalInspectionArtifactBindingV0Schema
>;

const FoundryLocalInspectionTruthTopicV0Schema = z.enum(
  FOUNDRY_LOCAL_INSPECTION_TRUTH_TOPICS_V0,
);

export const FoundryLocalInspectionTruthEntryV0Schema = z
  .object({
    topic: FoundryLocalInspectionTruthTopicV0Schema,
    status: z.enum(["native_artifact_bound", "not_established"]),
    artifactIds: z.array(StableIdSchema).max(MAX_HANDOFF_ARTIFACT_COUNT),
  })
  .strict()
  .superRefine((entry, ctx) => {
    if (
      entry.status === "native_artifact_bound" &&
      entry.artifactIds.length === 0
    ) {
      addIssue(
        ctx,
        ["artifactIds"],
        "A native-artifact-bound truth entry requires at least one artifact ID.",
      );
    }
    if (entry.status === "not_established" && entry.artifactIds.length !== 0) {
      addIssue(
        ctx,
        ["artifactIds"],
        "A not-established truth entry cannot cite an artifact as proof.",
      );
    }
  });
export type FoundryLocalInspectionTruthEntryV0 = z.infer<
  typeof FoundryLocalInspectionTruthEntryV0Schema
>;

export const FoundryLocalInspectionComparisonProvenanceV0Schema =
  z.discriminatedUnion("status", [
    z
      .object({
        status: z.literal("not_established"),
        reportArtifactId: StableIdSchema.nullable(),
        sourceReceiptSha256: z.null(),
      })
      .strict(),
    z
      .object({
        status: z.literal("receipt_digest_bound"),
        reportArtifactId: StableIdSchema,
        sourceReceiptSha256: BareSha256Schema,
      })
      .strict(),
  ]);
export type FoundryLocalInspectionComparisonProvenanceV0 = z.infer<
  typeof FoundryLocalInspectionComparisonProvenanceV0Schema
>;

const LimitationsV0Schema = z.tuple([
  z.literal(FOUNDRY_LOCAL_INSPECTION_HANDOFF_LIMITATIONS_V0[0]),
  z.literal(FOUNDRY_LOCAL_INSPECTION_HANDOFF_LIMITATIONS_V0[1]),
  z.literal(FOUNDRY_LOCAL_INSPECTION_HANDOFF_LIMITATIONS_V0[2]),
  z.literal(FOUNDRY_LOCAL_INSPECTION_HANDOFF_LIMITATIONS_V0[3]),
  z.literal(FOUNDRY_LOCAL_INSPECTION_HANDOFF_LIMITATIONS_V0[4]),
  z.literal(FOUNDRY_LOCAL_INSPECTION_HANDOFF_LIMITATIONS_V0[5]),
]);

const MaterialObjectV0Schema = z
  .object({
    schemaVersion: z.literal(FOUNDRY_LOCAL_INSPECTION_HANDOFF_V0),
    dossierId: StableIdSchema,
    createdAt: FoundryUtcInstantSchema,
    purpose: z.literal("offline_local_inspection_handoff"),
    authority: z.literal("none"),
    execution: z.literal("not_authorized"),
    onlineApproval: z.literal("required"),
    artifacts: z
      .array(FoundryLocalInspectionArtifactBindingV0Schema)
      .max(MAX_HANDOFF_ARTIFACT_COUNT),
    truthIndex: z
      .array(FoundryLocalInspectionTruthEntryV0Schema)
      .length(FOUNDRY_LOCAL_INSPECTION_TRUTH_TOPICS_V0.length),
    comparisonProvenance:
      FoundryLocalInspectionComparisonProvenanceV0Schema,
    limitations: LimitationsV0Schema,
  })
  .strict();

type MaterialObjectV0 = z.infer<typeof MaterialObjectV0Schema>;

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function findArtifact(
  artifacts: readonly FoundryLocalInspectionArtifactBindingV0[],
  role: FoundryLocalInspectionArtifactRoleV0,
): FoundryLocalInspectionArtifactBindingV0 | undefined {
  return artifacts.find((artifact) => artifact.role === role);
}

function idsForRoles(
  artifacts: readonly FoundryLocalInspectionArtifactBindingV0[],
  roles: readonly FoundryLocalInspectionArtifactRoleV0[],
): string[] {
  const accepted = new Set<FoundryLocalInspectionArtifactRoleV0>(roles);
  return artifacts
    .filter((artifact) => accepted.has(artifact.role))
    .map((artifact) => artifact.artifactId);
}

function truthEntry(
  topic: FoundryLocalInspectionTruthEntryV0["topic"],
  artifactIds: readonly string[],
): FoundryLocalInspectionTruthEntryV0 {
  return {
    topic,
    status:
      artifactIds.length === 0 ? "not_established" : "native_artifact_bound",
    artifactIds: [...artifactIds],
  };
}

function expectedTruthIndex(
  artifacts: readonly FoundryLocalInspectionArtifactBindingV0[],
): FoundryLocalInspectionTruthEntryV0[] {
  return [
    truthEntry("source_identity", idsForRoles(artifacts, ["intake_receipt"])),
    truthEntry("format_and_structure", idsForRoles(artifacts, ["source_facts"])),
    truthEntry(
      "readiness_assessment",
      idsForRoles(artifacts, ["source_readiness"]),
    ),
    truthEntry(
      "operator_evidence_gaps",
      idsForRoles(artifacts, ["operator_evidence_checklist"]),
    ),
    truthEntry(
      "admission_classification",
      idsForRoles(artifacts, ["admission_review", "admission_result"]),
    ),
    truthEntry(
      "execution_plan",
      idsForRoles(artifacts, ["pipeline_recipe", "plan_preview"]),
    ),
    truthEntry(
      "comparison_evidence",
      idsForRoles(artifacts, ["captured_quality_comparison"]),
    ),
    truthEntry("physical_accuracy", []),
    truthEntry("rights_and_permissions", []),
    truthEntry("release_authority", []),
  ];
}

function schemaFamilyVersion(schemaVersion: string): number | null {
  const match = /\.v([0-9]+)$/u.exec(schemaVersion);
  if (match?.[1] === undefined) return null;
  return Number.parseInt(match[1], 10);
}

function validateCoreArtifactChain(
  artifacts: readonly FoundryLocalInspectionArtifactBindingV0[],
  ctx: z.RefinementCtx,
): void {
  const coreRoles = [
    "intake_receipt",
    "source_facts",
    "source_readiness",
    "operator_evidence_checklist",
  ] as const;
  for (const role of coreRoles) {
    if (findArtifact(artifacts, role) === undefined) {
      addIssue(ctx, ["artifacts"], `Missing required core role: ${role}.`);
    }
  }

  const familyRoles = coreRoles.slice(1);
  const versions = familyRoles
    .map((role) => findArtifact(artifacts, role))
    .filter(
      (artifact): artifact is FoundryLocalInspectionArtifactBindingV0 =>
        artifact !== undefined,
    )
    .map((artifact) => schemaFamilyVersion(artifact.schemaVersion));
  if (versions.length === familyRoles.length && new Set(versions).size !== 1) {
    addIssue(
      ctx,
      ["artifacts"],
      "Source Facts, readiness, and checklist artifacts must use the same version.",
    );
  }
}

function validateArtifactSet(
  artifacts: readonly FoundryLocalInspectionArtifactBindingV0[],
  ctx: z.RefinementCtx,
): void {
  const ids = artifacts.map((artifact) => artifact.artifactId);
  if (new Set(ids).size !== ids.length) {
    addIssue(ctx, ["artifacts"], "Artifact IDs must be unique.");
  }
  const roles = artifacts.map((artifact) => artifact.role);
  if (new Set(roles).size !== roles.length) {
    addIssue(ctx, ["artifacts"], "Artifact roles must be unique.");
  }
  const sortedIds = [...ids].sort(compareText);
  if (ids.some((id, index) => id !== sortedIds[index])) {
    addIssue(ctx, ["artifacts"], "Artifacts must be sorted by artifactId.");
  }

  validateCoreArtifactChain(artifacts, ctx);

  const hasReview = findArtifact(artifacts, "admission_review") !== undefined;
  const hasResult = findArtifact(artifacts, "admission_result") !== undefined;
  if (hasReview !== hasResult) {
    addIssue(
      ctx,
      ["artifacts"],
      "Admission review and result artifacts must be present together.",
    );
  }
  const hasPlan =
    findArtifact(artifacts, "pipeline_recipe") !== undefined ||
    findArtifact(artifacts, "plan_preview") !== undefined;
  if (hasPlan && !hasResult) {
    addIssue(
      ctx,
      ["artifacts"],
      "A pipeline recipe or plan preview requires an admission result.",
    );
  }
}

function validateComparisonProvenance(
  material: MaterialObjectV0,
  ctx: z.RefinementCtx,
): void {
  const report = findArtifact(
    material.artifacts,
    "captured_quality_comparison",
  );
  const receipt = findArtifact(material.artifacts, "intake_receipt");
  const provenance = material.comparisonProvenance;
  if (provenance.status === "not_established") {
    const expectedReportId = report?.artifactId ?? null;
    if (provenance.reportArtifactId !== expectedReportId) {
      addIssue(
        ctx,
        ["comparisonProvenance", "reportArtifactId"],
        "Unestablished comparison provenance must identify the bound report when one exists.",
      );
    }
    return;
  }
  if (report === undefined || provenance.reportArtifactId !== report.artifactId) {
    addIssue(
      ctx,
      ["comparisonProvenance", "reportArtifactId"],
      "Receipt-bound comparison provenance requires the indexed comparison report.",
    );
  }
  if (
    receipt === undefined ||
    provenance.sourceReceiptSha256 !== receipt.nativeDigest.value
  ) {
    addIssue(
      ctx,
      ["comparisonProvenance", "sourceReceiptSha256"],
      "Comparison provenance must bind the exact intake receipt digest.",
    );
  }
}

function validateMaterial(
  material: MaterialObjectV0,
  ctx: z.RefinementCtx,
): void {
  validateArtifactSet(material.artifacts, ctx);
  const expected = expectedTruthIndex(material.artifacts);
  if (
    stableCanonicalJson(toCanonicalJson(material.truthIndex)) !==
    stableCanonicalJson(toCanonicalJson(expected))
  ) {
    addIssue(
      ctx,
      ["truthIndex"],
      "Truth index must be the exact derived index for the bound native artifacts.",
    );
  }
  validateComparisonProvenance(material, ctx);
}

export const FoundryLocalInspectionHandoffMaterialV0Schema =
  MaterialObjectV0Schema.superRefine(validateMaterial);
export type FoundryLocalInspectionHandoffMaterialV0 = z.infer<
  typeof FoundryLocalInspectionHandoffMaterialV0Schema
>;

export function computeFoundryLocalInspectionHandoffSha256V0(
  input: unknown,
): string {
  const material = FoundryLocalInspectionHandoffMaterialV0Schema.parse(input);
  return domainSeparatedSha256(
    FOUNDRY_LOCAL_INSPECTION_HANDOFF_DIGEST_DOMAIN_V0,
    toCanonicalJson(material),
  );
}

const DossierObjectV0Schema = MaterialObjectV0Schema.extend({
  dossierSha256: BareSha256Schema,
}).strict();

export const FoundryLocalInspectionHandoffV0Schema =
  DossierObjectV0Schema.superRefine((dossier, ctx) => {
    const { dossierSha256: _dossierSha256, ...material } = dossier;
    const parsed = FoundryLocalInspectionHandoffMaterialV0Schema.safeParse(
      material,
    );
    if (!parsed.success) {
      for (const issue of parsed.error.issues) ctx.addIssue(issue);
      return;
    }
    if (
      dossier.dossierSha256 !==
      computeFoundryLocalInspectionHandoffSha256V0(parsed.data)
    ) {
      addIssue(
        ctx,
        ["dossierSha256"],
        "Local inspection handoff digest does not match its exact material.",
      );
    }
  });
export type FoundryLocalInspectionHandoffV0 = z.infer<
  typeof FoundryLocalInspectionHandoffV0Schema
>;

const CompileInputV0Schema = z
  .object({
    dossierId: StableIdSchema,
    createdAt: FoundryUtcInstantSchema,
    artifacts: z
      .array(FoundryLocalInspectionArtifactBindingV0Schema)
      .max(MAX_HANDOFF_ARTIFACT_COUNT),
    comparisonSourceReceiptSha256: BareSha256Schema.nullable(),
  })
  .strict();

export interface CompileFoundryLocalInspectionHandoffV0Input {
  readonly dossierId: string;
  readonly createdAt: string;
  readonly artifacts: readonly FoundryLocalInspectionArtifactBindingV0[];
  readonly comparisonSourceReceiptSha256?: string | null;
}

function deriveComparisonProvenance(
  artifacts: readonly FoundryLocalInspectionArtifactBindingV0[],
  sourceReceiptSha256: string | null,
): FoundryLocalInspectionComparisonProvenanceV0 {
  const report = findArtifact(artifacts, "captured_quality_comparison");
  if (sourceReceiptSha256 === null) {
    return {
      status: "not_established",
      reportArtifactId: report?.artifactId ?? null,
      sourceReceiptSha256: null,
    };
  }
  if (report === undefined) {
    throw new FoundryIntegrityError(
      "LOCAL_HANDOFF_COMPARISON_REPORT_MISSING",
      "A comparison receipt binding requires a comparison report artifact.",
    );
  }
  const receipt = findArtifact(artifacts, "intake_receipt");
  if (
    receipt === undefined ||
    receipt.nativeDigest.value !== sourceReceiptSha256
  ) {
    throw new FoundryIntegrityError(
      "LOCAL_HANDOFF_COMPARISON_RECEIPT_MISMATCH",
      "Comparison provenance must bind the exact intake receipt digest.",
    );
  }
  return {
    status: "receipt_digest_bound",
    reportArtifactId: report.artifactId,
    sourceReceiptSha256,
  };
}

export function compileFoundryLocalInspectionHandoffV0(
  input: CompileFoundryLocalInspectionHandoffV0Input,
): FoundryLocalInspectionHandoffV0 {
  const parsed = CompileInputV0Schema.parse({
    dossierId: input.dossierId,
    createdAt: input.createdAt,
    artifacts: input.artifacts,
    comparisonSourceReceiptSha256:
      input.comparisonSourceReceiptSha256 ?? null,
  });
  const material = FoundryLocalInspectionHandoffMaterialV0Schema.parse({
    schemaVersion: FOUNDRY_LOCAL_INSPECTION_HANDOFF_V0,
    dossierId: parsed.dossierId,
    createdAt: parsed.createdAt,
    purpose: "offline_local_inspection_handoff",
    authority: "none",
    execution: "not_authorized",
    onlineApproval: "required",
    artifacts: parsed.artifacts,
    truthIndex: expectedTruthIndex(parsed.artifacts),
    comparisonProvenance: deriveComparisonProvenance(
      parsed.artifacts,
      parsed.comparisonSourceReceiptSha256,
    ),
    limitations: [...FOUNDRY_LOCAL_INSPECTION_HANDOFF_LIMITATIONS_V0],
  });
  return FoundryLocalInspectionHandoffV0Schema.parse({
    ...material,
    dossierSha256: computeFoundryLocalInspectionHandoffSha256V0(material),
  });
}

export function verifyFoundryLocalInspectionHandoffV0(
  input: unknown,
): FoundryLocalInspectionHandoffV0 {
  return FoundryLocalInspectionHandoffV0Schema.parse(input);
}

export const FoundryLocalInspectionNativeArtifactIdentityV0Schema = z
  .object({
    artifactId: StableIdSchema,
    schemaVersion: z.string().regex(SCHEMA_VERSION),
    nativeDigest: FoundryLocalInspectionNativeDigestBindingV0Schema,
  })
  .strict();
export type FoundryLocalInspectionNativeArtifactIdentityV0 = z.infer<
  typeof FoundryLocalInspectionNativeArtifactIdentityV0Schema
>;

function sameNativeIdentity(
  artifact: FoundryLocalInspectionArtifactBindingV0,
  identity: FoundryLocalInspectionNativeArtifactIdentityV0,
): boolean {
  return (
    artifact.artifactId === identity.artifactId &&
    artifact.schemaVersion === identity.schemaVersion &&
    artifact.nativeDigest.field === identity.nativeDigest.field &&
    artifact.nativeDigest.value === identity.nativeDigest.value
  );
}

/**
 * Compares the dossier to identities emitted only after each referenced
 * artifact has passed its own native verifier. This function deliberately
 * does not replace those artifact-specific verifiers.
 */
export function verifyFoundryLocalInspectionHandoffNativeIdentitiesV0(
  dossierInput: unknown,
  nativeIdentitiesInput: unknown,
): FoundryLocalInspectionHandoffV0 {
  const dossier = verifyFoundryLocalInspectionHandoffV0(dossierInput);
  const identities = z
    .array(FoundryLocalInspectionNativeArtifactIdentityV0Schema)
    .max(MAX_HANDOFF_ARTIFACT_COUNT)
    .parse(nativeIdentitiesInput);
  if (identities.length !== dossier.artifacts.length) {
    throw new FoundryIntegrityError(
      "LOCAL_HANDOFF_NATIVE_IDENTITY_SET_MISMATCH",
      "Native identities must exactly match the dossier artifact set.",
    );
  }
  for (const [index, artifact] of dossier.artifacts.entries()) {
    const identity = identities[index];
    if (identity === undefined || artifact.artifactId !== identity.artifactId) {
      throw new FoundryIntegrityError(
        "LOCAL_HANDOFF_NATIVE_IDENTITY_ORDER_MISMATCH",
        "Native identities must use the same order as the dossier artifacts.",
      );
    }
    if (!sameNativeIdentity(artifact, identity)) {
      throw new FoundryIntegrityError(
        "LOCAL_HANDOFF_NATIVE_IDENTITY_MISMATCH",
        `Native identity does not match dossier artifact ${artifact.artifactId}.`,
      );
    }
  }
  return dossier;
}

export function serializeFoundryLocalInspectionHandoffV0(
  input: unknown,
): string {
  return stableCanonicalJson(
    toCanonicalJson(verifyFoundryLocalInspectionHandoffV0(input)),
  );
}
