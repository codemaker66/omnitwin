import {
  FOUNDRY_INTAKE_ADMISSION_CAPABILITIES,
  FOUNDRY_INTAKE_ADMISSION_REVIEW_V0,
  FoundryCanonicalActorSchema,
  FoundryEvidenceKindSchema,
  FoundryInputTypeSchema,
  FoundryIntakeExclusionReasonSchema,
  FoundryRelativePathSchema,
  FoundryUtcInstantSchema,
  RuntimeManifestKeySchema,
  finalizeFoundryIntakeAdmissionReview,
  type FoundryInputType,
  type FoundryIntakeAdmissionResultV0,
  type FoundryIntakeAdmissionReviewV0,
} from "@omnitwin/types";
import { z } from "zod";
import { FoundryIntegrityError } from "./errors.js";
import { admitUniversalIntakeReceipt } from "./intake-admission.js";
import {
  FoundryUniversalIntakeReceiptSchema,
  type FoundryUniversalIntakeFile,
  type FoundryUniversalIntakeReceipt,
} from "./intake-receipt.js";

export const FOUNDRY_GUIDED_ADMISSION_DRAFT_V0 =
  "omnitwin.foundry.guided-admission-draft.v0";

export const FOUNDRY_GUIDED_ASSET_ROLES = [
  "raw_capture",
  "official_export",
  "captured_derivative",
  "enhanced_captured_derivative",
  "generated_cinematic_derivative",
  "concept_imagination_derivative",
  "reference_only",
] as const;

export const FoundryGuidedAssetRoleSchema = z.enum(FOUNDRY_GUIDED_ASSET_ROLES);
export type FoundryGuidedAssetRole = z.infer<typeof FoundryGuidedAssetRoleSchema>;

const BARE_SHA256 = /^[a-f0-9]{64}$/u;
const SOURCE_ROOT_ID = "guided-intake-source";
const OPAQUE_RIGHTS_GATED_TYPES = new Set<FoundryInputType>([
  "matterpak_bundle",
  "xgrids_xbin",
  "lcc",
  "lcc2",
]);
const DERIVATIVE_ROLES = new Set<FoundryGuidedAssetRole>([
  "captured_derivative",
  "enhanced_captured_derivative",
  "generated_cinematic_derivative",
  "concept_imagination_derivative",
]);
const NO_PARENT_ROLES = new Set<FoundryGuidedAssetRole>([
  "raw_capture",
  "reference_only",
]);

const FoundryGuidedExcludeChoiceSchema = z
  .object({
    action: z.literal("exclude"),
    path: FoundryRelativePathSchema,
    reason: FoundryIntakeExclusionReasonSchema,
  })
  .strict();

export const FoundryGuidedDerivationDeclarationSchema = z
  .object({
    operationVersion: z.string().trim().min(1).max(160),
    environmentEvidencePath: FoundryRelativePathSchema,
  })
  .strict();
export type FoundryGuidedDerivationDeclaration = z.infer<
  typeof FoundryGuidedDerivationDeclarationSchema
>;

export const FoundryGuidedGenerationDeclarationSchema = z
  .object({
    maskPath: FoundryRelativePathSchema,
    modelName: z.string().trim().min(1).max(160),
    modelVersion: z.string().trim().min(1).max(160),
    checkpointPath: FoundryRelativePathSchema,
    conditionPath: FoundryRelativePathSchema,
    confidence: z.number().finite().min(0).max(1),
    exportRestrictions: z.array(z.string().trim().min(1).max(500)).min(1).max(50),
    truthModeDisclosure: z.string().trim().min(20).max(1_000),
  })
  .strict();
export type FoundryGuidedGenerationDeclaration = z.infer<
  typeof FoundryGuidedGenerationDeclarationSchema
>;

const FoundryGuidedAdmitChoiceSchema = z
  .object({
    action: z.literal("admit"),
    path: FoundryRelativePathSchema,
    inputType: FoundryInputTypeSchema,
    role: FoundryGuidedAssetRoleSchema,
    formatDecision: z.enum(["accept_detector", "operator_override"]),
    formatEvidencePaths: z.array(FoundryRelativePathSchema).max(50).default([]),
    parentPaths: z.array(FoundryRelativePathSchema).max(100).default([]),
    evidenceKinds: z.array(FoundryEvidenceKindSchema).max(12).default([]),
    derivation: FoundryGuidedDerivationDeclarationSchema.optional(),
    generation: FoundryGuidedGenerationDeclarationSchema.optional(),
  })
  .strict();

export const FoundryGuidedAdmissionFileChoiceSchema = z.discriminatedUnion("action", [
  FoundryGuidedExcludeChoiceSchema,
  FoundryGuidedAdmitChoiceSchema,
]);
export type FoundryGuidedAdmissionFileChoice = z.infer<
  typeof FoundryGuidedAdmissionFileChoiceSchema
>;

export const FoundryGuidedAdmissionDraftInputSchema = z
  .object({
    schemaVersion: z.literal(FOUNDRY_GUIDED_ADMISSION_DRAFT_V0),
    receiptSha256: z.string().regex(BARE_SHA256),
    projectId: RuntimeManifestKeySchema,
    reviewedAt: FoundryUtcInstantSchema,
    reviewedBy: FoundryCanonicalActorSchema,
    sourceMedia: z.enum(["local", "removable"]),
    caseSensitivity: z.enum(["sensitive", "insensitive"]),
    decisions: z.array(FoundryGuidedAdmissionFileChoiceSchema).max(100_000),
  })
  .strict();
export type FoundryGuidedAdmissionDraftInput = z.infer<
  typeof FoundryGuidedAdmissionDraftInputSchema
>;

export interface FoundryGuidedAdmissionDraft {
  readonly review: FoundryIntakeAdmissionReviewV0;
  readonly result: FoundryIntakeAdmissionResultV0;
}

interface RolePolicy {
  readonly captureState: "raw_capture" | "official_export" | "derived" | "reference";
  readonly accessState: "direct" | "official_export" | "metadata_only";
  readonly provenanceClass:
    | "captured"
    | "enhanced_captured"
    | "generated_cinematic"
    | "concept_imagination";
}

const ROLE_POLICIES: Readonly<Record<FoundryGuidedAssetRole, RolePolicy>> = {
  raw_capture: {
    captureState: "raw_capture",
    accessState: "direct",
    provenanceClass: "captured",
  },
  official_export: {
    captureState: "official_export",
    accessState: "official_export",
    provenanceClass: "captured",
  },
  captured_derivative: {
    captureState: "derived",
    accessState: "direct",
    provenanceClass: "captured",
  },
  enhanced_captured_derivative: {
    captureState: "derived",
    accessState: "direct",
    provenanceClass: "enhanced_captured",
  },
  generated_cinematic_derivative: {
    captureState: "derived",
    accessState: "direct",
    provenanceClass: "generated_cinematic",
  },
  concept_imagination_derivative: {
    captureState: "derived",
    accessState: "direct",
    provenanceClass: "concept_imagination",
  },
  reference_only: {
    captureState: "reference",
    accessState: "metadata_only",
    provenanceClass: "captured",
  },
};

const EXCLUSION_RATIONALES: Readonly<Record<
  z.infer<typeof FoundryIntakeExclusionReasonSchema>,
  string
>> = {
  duplicate_content: "This exact-content duplicate is kept outside the draft manifest.",
  unsupported_format: "This format is not supported by the safe guided admission path.",
  rights_not_cleared: "This file remains quarantined because its use rights are not cleared.",
  provenance_unknown: "This file remains quarantined because its origin and lineage are unknown.",
  unrelated_to_project: "The operator marked this file as unrelated to this project.",
  superseded_input: "The operator marked this file as superseded by another inspected input.",
  operator_rejected: "The operator chose to keep this file outside the draft manifest.",
};

function fail(code: string, message: string): never {
  throw new FoundryIntegrityError(code, message);
}

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function assetId(index: number): string {
  return `guided-asset-${String(index + 1).padStart(6, "0")}`;
}

function receiptEvidenceReference(
  receipt: FoundryUniversalIntakeReceipt,
  file: FoundryUniversalIntakeFile,
): string {
  const index = receipt.files.findIndex((candidate) => candidate.path === file.path);
  if (index < 0) {
    return fail(
      "GUIDED_ADMISSION_INTERNAL_RECEIPT_LOOKUP_FAILED",
      "The compiler could not bind an evidence file to this receipt. No draft was created.",
    );
  }
  return `intake-receipt:${receipt.receiptSha256}:file:${String(index + 1)}:sha256:${file.sha256}`;
}

function selectedCandidate(
  file: FoundryUniversalIntakeFile,
  inputType: FoundryInputType,
): FoundryUniversalIntakeFile["detection"]["candidates"][number] | undefined {
  return file.detection.candidates.find((candidate) => candidate.inputType === inputType);
}

function compileClassification(
  receipt: FoundryUniversalIntakeReceipt,
  file: FoundryUniversalIntakeFile,
  choice: z.infer<typeof FoundryGuidedAdmitChoiceSchema>,
  receiptByPath: ReadonlyMap<string, FoundryUniversalIntakeFile>,
): {
  readonly method: "accepted_detector_candidate" | "operator_override";
  readonly rationale: string;
  readonly evidenceReferences: readonly string[];
} {
  const candidate = selectedCandidate(file, choice.inputType);
  if (choice.formatDecision === "accept_detector") {
    if (choice.formatEvidencePaths.length !== 0) {
      return fail(
        "GUIDED_ADMISSION_UNUSED_FORMAT_EVIDENCE",
        `File "${file.path}" includes format evidence but is set to accept the detector. Choose an explicit override or remove that evidence.`,
      );
    }
    if (file.detection.status !== "detected" || candidate === undefined) {
      return fail(
        "GUIDED_ADMISSION_FORMAT_NEEDS_OVERRIDE",
        `File "${file.path}" was not identified as one clear format. Choose the format explicitly and attach receipt-bound evidence.`,
      );
    }
    if (candidate.confidence === "low") {
      return fail(
        "GUIDED_ADMISSION_LOW_CONFIDENCE_NEEDS_OVERRIDE",
        `File "${file.path}" has only a low-confidence format guess. Confirm the format explicitly and attach receipt-bound evidence.`,
      );
    }
    return {
      method: "accepted_detector_candidate",
      rationale: `The operator accepted the receipt detector's ${candidate.confidence}-confidence ${choice.inputType} result.`,
      evidenceReferences: [
        receiptEvidenceReference(receipt, file),
        ...[...new Set(candidate.evidence)]
          .sort(compareText)
          .map((evidence) => `detector:${evidence}`),
      ],
    };
  }

  if (choice.formatEvidencePaths.length === 0) {
    return fail(
      "GUIDED_ADMISSION_OVERRIDE_EVIDENCE_REQUIRED",
      `File "${file.path}" needs at least one evidence file from this same receipt before its format can be overridden.`,
    );
  }
  if (new Set(choice.formatEvidencePaths).size !== choice.formatEvidencePaths.length) {
    return fail(
      "GUIDED_ADMISSION_DUPLICATE_FORMAT_EVIDENCE",
      `File "${file.path}" lists the same format evidence more than once.`,
    );
  }
  const evidenceReferences = [...choice.formatEvidencePaths].sort(compareText).map((evidencePath) => {
    const evidenceFile = receiptByPath.get(evidencePath);
    if (evidenceFile === undefined) {
      return fail(
        "GUIDED_ADMISSION_FORMAT_EVIDENCE_NOT_IN_RECEIPT",
        `Format evidence "${evidencePath}" is not part of this receipt. Choose an inspected receipt file instead.`,
      );
    }
    return receiptEvidenceReference(receipt, evidenceFile);
  });
  return {
    method: "operator_override",
    rationale: `The operator explicitly selected ${choice.inputType} after reviewing ${String(evidenceReferences.length)} receipt-bound evidence file(s).`,
    evidenceReferences,
  };
}

function assertExactDecisionSet(
  receipt: FoundryUniversalIntakeReceipt,
  decisions: readonly FoundryGuidedAdmissionFileChoice[],
): void {
  const receiptPaths = new Set(receipt.files.map((file) => file.path));
  const decisionPaths = new Set<string>();
  for (const decision of decisions) {
    if (decisionPaths.has(decision.path)) {
      return fail(
        "GUIDED_ADMISSION_DUPLICATE_FILE_CHOICE",
        `File "${decision.path}" has more than one choice. Keep exactly one choice for each file.`,
      );
    }
    decisionPaths.add(decision.path);
    if (!receiptPaths.has(decision.path)) {
      return fail(
        "GUIDED_ADMISSION_FILE_NOT_IN_RECEIPT",
        `A choice refers to "${decision.path}", but that file is not in this receipt.`,
      );
    }
  }
  for (const file of receipt.files) {
    if (!decisionPaths.has(file.path)) {
      return fail(
        "GUIDED_ADMISSION_FILE_CHOICE_MISSING",
        `Choose whether to admit or exclude "${file.path}". Every inspected file needs exactly one choice.`,
      );
    }
  }
}

function assertDuplicateExclusionClaims(
  receipt: FoundryUniversalIntakeReceipt,
  decisionsByPath: ReadonlyMap<string, FoundryGuidedAdmissionFileChoice>,
): void {
  const duplicateGroupByPath = new Map<string, readonly string[]>();
  for (const group of receipt.duplicateGroups) {
    for (const path of group.paths) duplicateGroupByPath.set(path, group.paths);
  }
  for (const decision of decisionsByPath.values()) {
    if (decision.action !== "exclude" || decision.reason !== "duplicate_content") continue;
    const groupPaths = duplicateGroupByPath.get(decision.path);
    if (groupPaths === undefined) {
      return fail(
        "GUIDED_ADMISSION_FALSE_DUPLICATE_EXCLUSION",
        `File "${decision.path}" is not in an exact-copy group from this receipt. Choose a truthful exclusion reason.`,
      );
    }
    const anotherCopyIsAdmitted = groupPaths.some(
      (path) => path !== decision.path && decisionsByPath.get(path)?.action === "admit",
    );
    if (!anotherCopyIsAdmitted) {
      return fail(
        "GUIDED_ADMISSION_DUPLICATE_SOURCE_NOT_ADMITTED",
        `File "${decision.path}" is marked as an excluded duplicate, but no other exact copy is kept in this draft. Keep one receipt-confirmed copy or choose another reason.`,
      );
    }
  }
}

function assertRoleAndParents(
  file: FoundryUniversalIntakeFile,
  choice: z.infer<typeof FoundryGuidedAdmitChoiceSchema>,
  admittedByPath: ReadonlyMap<string, z.infer<typeof FoundryGuidedAdmitChoiceSchema>>,
  receiptByPath: ReadonlyMap<string, FoundryUniversalIntakeFile>,
): void {
  if (new Set(choice.parentPaths).size !== choice.parentPaths.length) {
    return fail(
      "GUIDED_ADMISSION_DUPLICATE_PARENT",
      `File "${file.path}" lists the same parent file more than once.`,
    );
  }
  if (new Set(choice.evidenceKinds).size !== choice.evidenceKinds.length) {
    return fail(
      "GUIDED_ADMISSION_DUPLICATE_EVIDENCE_KIND",
      `File "${file.path}" lists the same evidence role more than once.`,
    );
  }
  if (DERIVATIVE_ROLES.has(choice.role) && choice.parentPaths.length === 0) {
    return fail(
      "GUIDED_ADMISSION_DERIVATIVE_PARENT_REQUIRED",
      `File "${file.path}" is labelled as a derivative, so choose at least one admitted source file as its parent.`,
    );
  }
  if (DERIVATIVE_ROLES.has(choice.role) && choice.derivation === undefined) {
    return fail(
      "GUIDED_ADMISSION_DERIVATION_EVIDENCE_REQUIRED",
      `File "${file.path}" is labelled as a derivative. Name its exact operation version and an environment evidence file from this receipt.`,
    );
  }
  if (!DERIVATIVE_ROLES.has(choice.role) && choice.derivation !== undefined) {
    return fail(
      "GUIDED_ADMISSION_UNUSED_DERIVATION_EVIDENCE",
      `File "${file.path}" includes derivation evidence but is not labelled as a derivative.`,
    );
  }
  if (
    choice.derivation !== undefined &&
    !receiptByPath.has(choice.derivation.environmentEvidencePath)
  ) {
    return fail(
      "GUIDED_ADMISSION_ENVIRONMENT_EVIDENCE_NOT_IN_RECEIPT",
      `Environment evidence "${choice.derivation.environmentEvidencePath}" for "${file.path}" is not part of this receipt.`,
    );
  }
  if (NO_PARENT_ROLES.has(choice.role) && choice.parentPaths.length !== 0) {
    return fail(
      "GUIDED_ADMISSION_ROLE_CANNOT_HAVE_PARENTS",
      `File "${file.path}" uses the ${choice.role} role, which cannot also claim parent files.`,
    );
  }
  for (const parentPath of choice.parentPaths) {
    if (parentPath === file.path) {
      return fail(
        "GUIDED_ADMISSION_SELF_PARENT",
        `File "${file.path}" cannot be its own parent.`,
      );
    }
    if (!admittedByPath.has(parentPath)) {
      return fail(
        "GUIDED_ADMISSION_PARENT_NOT_ADMITTED",
        `Parent "${parentPath}" for "${file.path}" must also be admitted in this draft.`,
      );
    }
  }
  if (choice.inputType === "evidence_record" && choice.evidenceKinds.length === 0) {
    return fail(
      "GUIDED_ADMISSION_EVIDENCE_ROLE_REQUIRED",
      `Evidence record "${file.path}" needs at least one explicit evidence role.`,
    );
  }
  const generated =
    choice.role === "generated_cinematic_derivative" ||
    choice.role === "concept_imagination_derivative";
  if (generated && choice.generation === undefined) {
    return fail(
      "GUIDED_ADMISSION_GENERATION_EVIDENCE_REQUIRED",
      `Generated file "${file.path}" needs an admitted mask plus exact model, checkpoint, conditioning, disclosure, and restriction details.`,
    );
  }
  if (!generated && choice.generation !== undefined) {
    return fail(
      "GUIDED_ADMISSION_UNUSED_GENERATION_EVIDENCE",
      `File "${file.path}" includes generation evidence but does not use a generated role.`,
    );
  }
  if (choice.generation !== undefined) {
    const generation = choice.generation;
    const maskChoice = admittedByPath.get(generation.maskPath);
    if (maskChoice === undefined) {
      return fail(
        "GUIDED_ADMISSION_GENERATION_MASK_NOT_ADMITTED",
        `Mask "${generation.maskPath}" for generated file "${file.path}" must also be admitted.`,
      );
    }
    if (!maskChoice.evidenceKinds.includes("mask")) {
      return fail(
        "GUIDED_ADMISSION_GENERATION_MASK_ROLE_REQUIRED",
        `File "${generation.maskPath}" must carry the explicit mask evidence role.`,
      );
    }
    if (!choice.parentPaths.includes(generation.maskPath)) {
      return fail(
        "GUIDED_ADMISSION_GENERATION_MASK_PARENT_REQUIRED",
        `Mask "${generation.maskPath}" must also be listed as a parent of generated file "${file.path}".`,
      );
    }
    if (choice.parentPaths.every((parentPath) => parentPath === generation.maskPath)) {
      return fail(
        "GUIDED_ADMISSION_GENERATION_SOURCE_REQUIRED",
        `Generated file "${file.path}" needs at least one admitted source parent in addition to its mask.`,
      );
    }
    for (const [evidenceRole, evidencePath] of [
      ["checkpoint", generation.checkpointPath],
      ["conditioning", generation.conditionPath],
    ] as const) {
      if (!receiptByPath.has(evidencePath)) {
        return fail(
          "GUIDED_ADMISSION_GENERATION_EVIDENCE_NOT_IN_RECEIPT",
          `The ${evidenceRole} evidence "${evidencePath}" for "${file.path}" is not part of this receipt.`,
        );
      }
      if (evidencePath === file.path) {
        return fail(
          "GUIDED_ADMISSION_GENERATION_EVIDENCE_IS_OUTPUT",
          `Generated output "${file.path}" cannot also be its own ${evidenceRole} evidence.`,
        );
      }
    }
    if (generation.checkpointPath === generation.conditionPath) {
      return fail(
        "GUIDED_ADMISSION_GENERATION_EVIDENCE_ROLES_CONFLATED",
        `Generated file "${file.path}" must name separate checkpoint and conditioning evidence files.`,
      );
    }
  }
  const receiptSaysXbin =
    file.detection.candidates.some((candidate) => candidate.inputType === "xgrids_xbin") ||
    file.inspection.magicHex.startsWith("58424147") ||
    file.path.toLowerCase().endsWith(".xbin");
  if (receiptSaysXbin && choice.inputType !== "xgrids_xbin") {
    return fail(
      "GUIDED_ADMISSION_XBIN_CANNOT_BE_RELABELLED",
      `Raw XGRIDS file "${file.path}" cannot be relabelled as another format to bypass its safety restriction.`,
    );
  }
  if (choice.inputType === "xgrids_xbin" && choice.role !== "reference_only") {
    return fail(
      "GUIDED_ADMISSION_XBIN_REFERENCE_ONLY",
      `Raw XGRIDS file "${file.path}" must use the reference-only role. Its payload is not authorized for processing.`,
    );
  }
  if (OPAQUE_RIGHTS_GATED_TYPES.has(choice.inputType) && choice.role !== "reference_only") {
    return fail(
      "GUIDED_ADMISSION_OPAQUE_REFERENCE_ONLY",
      `Opaque file "${file.path}" must remain reference-only until authoritative rights and access evidence are recorded.`,
    );
  }
}

function assertNoParentCycles(
  admittedByPath: ReadonlyMap<string, z.infer<typeof FoundryGuidedAdmitChoiceSchema>>,
): void {
  const childPaths = new Map<string, string[]>();
  const remainingParents = new Map<string, number>();
  for (const [path, choice] of admittedByPath) {
    remainingParents.set(path, choice.parentPaths.length);
    for (const parentPath of choice.parentPaths) {
      const children = childPaths.get(parentPath) ?? [];
      children.push(path);
      childPaths.set(parentPath, children);
    }
  }
  const ready = [...remainingParents]
    .filter(([, parentCount]) => parentCount === 0)
    .map(([path]) => path)
    .sort(compareText);
  let visited = 0;
  for (let index = 0; index < ready.length; index += 1) {
    const path = ready[index];
    if (path === undefined) continue;
    visited += 1;
    for (const childPath of childPaths.get(path) ?? []) {
      const next = (remainingParents.get(childPath) ?? 0) - 1;
      remainingParents.set(childPath, next);
      if (next === 0) ready.push(childPath);
    }
  }
  if (visited !== admittedByPath.size) {
    return fail(
      "GUIDED_ADMISSION_PARENT_CYCLE",
      "The selected parent links form a loop. Remove the loop so every derivative leads back to an original source.",
    );
  }
}

function decisiveNextTest(choice: z.infer<typeof FoundryGuidedAdmitChoiceSchema>): string {
  if (choice.inputType === "xgrids_xbin") {
    return "Use a documented vendor SDK or official export; keep the proprietary payload metadata-only until access and rights are proven.";
  }
  if (
    choice.role === "generated_cinematic_derivative" ||
    choice.role === "concept_imagination_derivative"
  ) {
    return "Verify parent links, model and checkpoint identity, conditioning evidence, masks, and truth-mode disclosure before any use.";
  }
  return "Run the approved format-aware read-only inspector, then complete rights, provenance, calibration, and coordinate-frame review.";
}

function assetNotes(choice: z.infer<typeof FoundryGuidedAdmitChoiceSchema>): string[] {
  const notes = [
    `Guided admission role: ${choice.role}.`,
    "Legal rights remain unreviewed; this draft does not authorize processing.",
  ];
  if (
    choice.role === "generated_cinematic_derivative" ||
    choice.role === "concept_imagination_derivative"
  ) {
    notes.push("This asset is explicitly generated and cannot act as captured or metric truth.");
  } else if (choice.role === "enhanced_captured_derivative") {
    notes.push("This enhanced derivative remains separate from raw captured and metric truth.");
  } else if (choice.role === "reference_only") {
    notes.push("The bytes remain metadata-only at guided admission.");
  }
  return notes;
}

/**
 * Purely compiles one already-verified receipt and explicit human choices.
 * It performs no filesystem access, staging, execution, training, signing,
 * publication, promotion, network access, or legal approval.
 */
export function compileGuidedAdmissionDraft(
  receiptInput: unknown,
  draftInput: unknown,
): FoundryGuidedAdmissionDraft {
  const receiptResult = FoundryUniversalIntakeReceiptSchema.safeParse(receiptInput);
  if (!receiptResult.success) {
    return fail(
      "GUIDED_ADMISSION_RECEIPT_INVALID",
      "The intake receipt is invalid or was changed after it was created. Inspect the source again before continuing.",
    );
  }
  const inputResult = FoundryGuidedAdmissionDraftInputSchema.safeParse(draftInput);
  if (!inputResult.success) {
    return fail(
      "GUIDED_ADMISSION_CHOICES_INVALID",
      "The admission choices are incomplete or malformed. Check the project, operator, time, source settings, and each file choice.",
    );
  }
  const receipt = receiptResult.data;
  const input = inputResult.data;
  if (input.receiptSha256 !== receipt.receiptSha256) {
    return fail(
      "GUIDED_ADMISSION_RECEIPT_DIGEST_MISMATCH",
      "These choices belong to a different intake receipt. Reopen the matching receipt before continuing.",
    );
  }
  if (receipt.files.length === 0) {
    return fail(
      "GUIDED_ADMISSION_EMPTY_RECEIPT",
      "The receipt contains no files, so there is nothing to admit.",
    );
  }
  assertExactDecisionSet(receipt, input.decisions);

  const receiptByPath = new Map(receipt.files.map((file) => [file.path, file] as const));
  const decisionsByPath = new Map(input.decisions.map((decision) => [decision.path, decision] as const));
  assertDuplicateExclusionClaims(receipt, decisionsByPath);
  const admittedByPath = new Map<string, z.infer<typeof FoundryGuidedAdmitChoiceSchema>>();
  for (const file of receipt.files) {
    const decision = decisionsByPath.get(file.path);
    if (decision?.action === "admit") admittedByPath.set(file.path, decision);
  }
  if (admittedByPath.size === 0) {
    return fail(
      "GUIDED_ADMISSION_NO_FILES_ADMITTED",
      "At least one file must be admitted. If no file is usable, leave the receipt quarantined instead of creating a draft.",
    );
  }
  for (const [path, choice] of admittedByPath) {
    const file = receiptByPath.get(path);
    if (file === undefined) {
      return fail(
        "GUIDED_ADMISSION_INTERNAL_RECEIPT_LOOKUP_FAILED",
        "The compiler could not match a selected file to this receipt. No draft was created.",
      );
    }
    assertRoleAndParents(file, choice, admittedByPath, receiptByPath);
  }
  assertNoParentCycles(admittedByPath);

  const assetIdByPath = new Map(
    receipt.files.map((file, index) => [file.path, assetId(index)] as const),
  );
  const provenanceEdges = receipt.files.flatMap((file, index) => {
    const decision = admittedByPath.get(file.path);
    if (decision?.derivation === undefined) return [];
    const outputAssetId = assetIdByPath.get(file.path);
    const environmentFile = receiptByPath.get(decision.derivation.environmentEvidencePath);
    if (outputAssetId === undefined || environmentFile === undefined) {
      return fail(
        "GUIDED_ADMISSION_INTERNAL_DERIVATION_LOOKUP_FAILED",
        "The compiler could not bind derivative evidence to this receipt. No draft was created.",
      );
    }
    return [{
      id: `guided-provenance-${String(index + 1).padStart(6, "0")}`,
      operationId: `guided-operation-${String(index + 1).padStart(6, "0")}`,
      inputAssetIds: [...decision.parentPaths].sort(compareText).map((parentPath) => {
        const id = assetIdByPath.get(parentPath);
        if (id === undefined) {
          return fail(
            "GUIDED_ADMISSION_INTERNAL_PARENT_LOOKUP_FAILED",
            "The compiler could not bind a derivative operation to its parent. No draft was created.",
          );
        }
        return id;
      }),
      outputAssetId,
      operationVersion: decision.derivation.operationVersion,
      environmentDigest: `sha256:${environmentFile.sha256}` as const,
      createdAt: input.reviewedAt,
    }];
  });
  const generatedRegions = receipt.files.flatMap((file, index) => {
    const decision = admittedByPath.get(file.path);
    if (decision?.generation === undefined) return [];
    const outputAssetId = assetIdByPath.get(file.path);
    const maskAssetId = assetIdByPath.get(decision.generation.maskPath);
    const checkpointFile = receiptByPath.get(decision.generation.checkpointPath);
    const conditionFile = receiptByPath.get(decision.generation.conditionPath);
    if (
      outputAssetId === undefined ||
      maskAssetId === undefined ||
      checkpointFile === undefined ||
      conditionFile === undefined
    ) {
      return fail(
        "GUIDED_ADMISSION_INTERNAL_GENERATION_LOOKUP_FAILED",
        "The compiler could not bind generated-region evidence to this receipt. No draft was created.",
      );
    }
    return [{
      id: `guided-generated-region-${String(index + 1).padStart(6, "0")}`,
      outputAssetId,
      sourceAssetIds: [...decision.parentPaths]
        .filter((parentPath) => parentPath !== decision.generation?.maskPath)
        .sort(compareText)
        .map((parentPath) => {
          const id = assetIdByPath.get(parentPath);
          if (id === undefined) {
            return fail(
              "GUIDED_ADMISSION_INTERNAL_PARENT_LOOKUP_FAILED",
              "The compiler could not bind a generated region to its source. No draft was created.",
            );
          }
          return id;
        }),
      maskAssetId,
      provenanceClass:
        decision.role === "generated_cinematic_derivative"
          ? "generated_cinematic" as const
          : "concept_imagination" as const,
      modelName: decision.generation.modelName,
      modelVersion: decision.generation.modelVersion,
      checkpointSha256: `sha256:${checkpointFile.sha256}` as const,
      promptOrConditionDigest: `sha256:${conditionFile.sha256}` as const,
      confidence: decision.generation.confidence,
      exportRestrictions: [...decision.generation.exportRestrictions].sort(compareText),
      truthModeDisclosure: decision.generation.truthModeDisclosure,
    }];
  });
  const reviewDecisions = receipt.files.map((file) => {
    const decision = decisionsByPath.get(file.path);
    if (decision === undefined) {
      return fail(
        "GUIDED_ADMISSION_INTERNAL_DECISION_LOOKUP_FAILED",
        "The compiler lost a file choice while building the draft. No draft was created.",
      );
    }
    if (decision.action === "exclude") {
      return {
        action: "exclude" as const,
        path: file.path,
        reason: decision.reason,
        rationale: EXCLUSION_RATIONALES[decision.reason],
      };
    }
    const policy = ROLE_POLICIES[decision.role];
    const id = assetIdByPath.get(file.path);
    if (id === undefined) {
      return fail(
        "GUIDED_ADMISSION_INTERNAL_ASSET_LOOKUP_FAILED",
        "The compiler could not create a stable asset identity. No draft was created.",
      );
    }
    return {
      action: "admit" as const,
      path: file.path,
      classification: compileClassification(receipt, file, decision, receiptByPath),
      asset: {
        id,
        sourceRootId: SOURCE_ROOT_ID,
        relativePath: file.path,
        inputType: decision.inputType,
        mediaType: "application/octet-stream",
        sizeBytes: file.sizeBytes,
        sha256: `sha256:${file.sha256}` as const,
        immutable: true as const,
        captureState: policy.captureState,
        accessState: policy.accessState,
        capturedAt: null,
        coordinateFrameId: null,
        calibrationAssetIds: [],
        parentAssetIds: [...decision.parentPaths].sort(compareText).map((parentPath) => {
          const parentId = assetIdByPath.get(parentPath);
          if (parentId === undefined) {
            return fail(
              "GUIDED_ADMISSION_INTERNAL_PARENT_LOOKUP_FAILED",
              "The compiler could not bind a derivative to its selected parent. No draft was created.",
            );
          }
          return parentId;
        }),
        rights: {
          basis: "unknown" as const,
          commercialUse: "unknown" as const,
          modelTrainingUse: "unknown" as const,
          redistribution: "unknown" as const,
          termsReviewedAt: null,
          termsReference: null,
          restrictions: [
            "Ownership, commercial use, model training, and redistribution require separate authoritative review.",
          ],
        },
        provenanceClass: policy.provenanceClass,
        evidenceKinds: [...decision.evidenceKinds].sort(compareText),
        inspection: {
          geometryValue: "unknown" as const,
          appearanceValue: "unknown" as const,
          calibrationValue: "unknown" as const,
          scaleValue: "unknown" as const,
          metadataKeys: [],
          decisiveNextTest: decisiveNextTest(decision),
        },
        notes: assetNotes(decision),
      },
    };
  });

  try {
    const review = finalizeFoundryIntakeAdmissionReview({
      schemaVersion: FOUNDRY_INTAKE_ADMISSION_REVIEW_V0,
      receiptSha256: receipt.receiptSha256,
      projectId: input.projectId,
      reviewedAt: input.reviewedAt,
      reviewedBy: input.reviewedBy,
      sourceRoot: {
        id: SOURCE_ROOT_ID,
        kind: input.sourceMedia === "removable" ? "removable_media" : "local_directory",
        displayName: "Inspected local intake",
        locationRedacted:
          input.sourceMedia === "removable"
            ? "REMOVABLE_SOURCE/[redacted]"
            : "LOCAL_SOURCE/[redacted]",
        caseSensitivity: input.caseSensitivity,
        readOnly: true,
      },
      coordinateFrames: [],
      transforms: [],
      decisions: reviewDecisions,
      provenanceEdges,
      generatedRegions,
      legalReviewState: "requires_review",
      sourceMutationPermitted: false,
      authority: "none",
      capabilities: FOUNDRY_INTAKE_ADMISSION_CAPABILITIES,
    });
    return {
      review,
      result: admitUniversalIntakeReceipt(receipt, review),
    };
  } catch (error) {
    if (error instanceof FoundryIntegrityError) throw error;
    return fail(
      "GUIDED_ADMISSION_OUTPUT_INVALID",
      "The choices could not be turned into a safe admission draft. Nothing was staged, processed, trained, signed, published, or promoted.",
    );
  }
}
