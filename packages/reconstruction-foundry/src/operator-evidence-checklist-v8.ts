import { FoundryRelativePathSchema } from "@omnitwin/types";
import { z } from "zod";
import {
  domainSeparatedSha256,
  stableCanonicalJson,
  toCanonicalJson,
} from "./canonical-json.js";
import { compareCanonicalStrings } from "./canonical-order.js";
import { FoundryIntegrityError } from "./errors.js";
import {
  FoundryOperatorEvidenceChecklistV7Schema,
  compileFoundryOperatorEvidenceChecklistV7,
  type FoundryOperatorEvidenceChecklistV7,
  type FoundryPotreeV2EvidenceRequestV7,
} from "./operator-evidence-checklist-v7.js";
import {
  FOUNDRY_POTREE_POINT_VALUES_RESOLVED_UNKNOWN_CODE,
} from "./source-facts-v8.js";
import {
  FoundryPotreeV2PointValueReadinessRefinementV8Schema,
  FoundrySourceReadinessMapV8Schema,
  type FoundryPotreeV2PointValueReadinessRefinementV8,
} from "./source-readiness-v8.js";

export const FOUNDRY_OPERATOR_EVIDENCE_CHECKLIST_V8 =
  "omnitwin.foundry.operator-evidence-checklist.v8";
export const FOUNDRY_OPERATOR_EVIDENCE_CHECKLIST_V8_DIGEST_DOMAIN =
  "VENVIEWER_FOUNDRY_OPERATOR_EVIDENCE_CHECKLIST_V8";
export const FOUNDRY_OPERATOR_EVIDENCE_CHECKLIST_V8_MEANING =
  "immutable_v7_operator_evidence_with_effective_point_value_resolution_refs";
export const FOUNDRY_OPERATOR_EVIDENCE_CHECKLIST_V8_BASIS =
  "exact_source_readiness_map_v8";
export const FOUNDRY_OPERATOR_EVIDENCE_CHECKLIST_V8_DISCLAIMER =
  "This deterministic view preserves every V7 evidence request unchanged. A bounded local decode may supersede only the exact point-attribute-value request in the effective V8 view; it grants no approval, processing readiness, authority, reconstruction, or execution permission.";
export const FOUNDRY_OPERATOR_EVIDENCE_CHECKLIST_V8_LIMITATIONS = [
  "INHERITED_V7_REQUESTS_REMAIN_IMMUTABLE",
  "SUPERSESSION_REFS_ARE_EFFECTIVE_VIEW_ONLY",
  "LOCAL_DECODE_AND_CPU_PREVIEWS_ARE_DIAGNOSTIC_ONLY",
  "UNITS_FRAME_CRS_ACCURACY_COMPLETENESS_AND_RIGHTS_REMAIN_UNRESOLVED",
  "THE_OPAQUE_VENDOR_BYTE_REMAINS_SEMANTICALLY_UNKNOWN",
  "FAILED_POINT_VALUE_INSPECTION_LEAVES_ALL_V7_POTREE_REQUESTS_OUTSTANDING",
] as const;

const SHA256_HEX = /^[a-f0-9]{64}$/u;
const BundleRootSchema = z.union([z.literal(""), FoundryRelativePathSchema]);

const ResolvedRequestRefSchema = z
  .object({
    id: z.string().trim().min(1).max(700),
    bundleRoot: BundleRootSchema,
    bundleSha256: z.string().regex(SHA256_HEX),
    inheritedRequestId: z.string().trim().min(1).max(700),
    inheritedEvidenceCode: z.literal(
      FOUNDRY_POTREE_POINT_VALUES_RESOLVED_UNKNOWN_CODE,
    ),
    pointValueOutcomeCode: z.literal("POTREE_V2_POINT_VALUES_ESTABLISHED"),
    resolutionStatus: z.literal("superseded_in_effective_v8_view_only"),
    sourcePaths: z.array(FoundryRelativePathSchema).min(3).max(3),
  })
  .strict()
  .superRefine((reference, ctx) => {
    const expectedId = resolvedReferenceId(
      reference.bundleSha256,
      reference.inheritedRequestId,
    );
    if (reference.id !== expectedId) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["id"],
        message: "V8 resolved-request reference id must bind its exact basis",
      });
    }
    if (!isSortedUnique(reference.sourcePaths)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["sourcePaths"],
        message: "V8 resolved-request source paths must be unique and canonical",
      });
    }
  });
export type FoundryResolvedPotreeUnknownRequestRefV8 = z.infer<
  typeof ResolvedRequestRefSchema
>;

const SummarySchema = z
  .object({
    inheritedState: z.enum(["available", "blocked"]),
    inheritedV7EvidenceRequestCount: z.number().int().safe().nonnegative(),
    inheritedV7PotreeRequestCount: z.number().int().safe().nonnegative(),
    pointValueOutcomeCount: z.number().int().safe().nonnegative(),
    decodedValuesEstablishedCount: z.number().int().safe().nonnegative(),
    decodedValuesNotEstablishedCount: z.number().int().safe().nonnegative(),
    resolvedPotreeUnknownRequestCount: z.number().int().safe().nonnegative(),
    effectiveRemainingPotreeRequestCount: z.number().int().safe().nonnegative(),
    effectiveRemainingPotreeUnknownRequestCount: z.number().int().safe().nonnegative(),
    effectiveRemainingPotreeInspectionFailureRequestCount: z.number().int().safe().nonnegative(),
  })
  .strict();

const PolicySchema = z
  .object({
    sourceAccess: z.literal("read_only"),
    mutation: z.literal("none"),
    requestPerformance: z.literal("none"),
    completionTracking: z.literal("none"),
    localDecoder: z.literal("bounded_diagnostic_only"),
    diagnosticPreview: z.literal("local_evidence_only"),
    processingReadiness: z.literal("not_established"),
    reconstruction: z.literal("none"),
    execution: z.literal("not_authorized"),
    approval: z.literal("none"),
    authority: z.literal("none"),
    rights: z.literal("not_evaluated"),
    unitsFrameCrs: z.literal("not_evaluated"),
    accuracy: z.literal("not_evaluated"),
    completeness: z.literal("not_evaluated"),
    vendorSemantics: z.literal("not_evaluated"),
  })
  .strict();

const LimitationsSchema = z.tuple([
  z.literal(FOUNDRY_OPERATOR_EVIDENCE_CHECKLIST_V8_LIMITATIONS[0]),
  z.literal(FOUNDRY_OPERATOR_EVIDENCE_CHECKLIST_V8_LIMITATIONS[1]),
  z.literal(FOUNDRY_OPERATOR_EVIDENCE_CHECKLIST_V8_LIMITATIONS[2]),
  z.literal(FOUNDRY_OPERATOR_EVIDENCE_CHECKLIST_V8_LIMITATIONS[3]),
  z.literal(FOUNDRY_OPERATOR_EVIDENCE_CHECKLIST_V8_LIMITATIONS[4]),
  z.literal(FOUNDRY_OPERATOR_EVIDENCE_CHECKLIST_V8_LIMITATIONS[5]),
]);

const ArtifactBaseSchema = z
  .object({
    schemaVersion: z.literal(FOUNDRY_OPERATOR_EVIDENCE_CHECKLIST_V8),
    meaning: z.literal(FOUNDRY_OPERATOR_EVIDENCE_CHECKLIST_V8_MEANING),
    basis: z.literal(FOUNDRY_OPERATOR_EVIDENCE_CHECKLIST_V8_BASIS),
    disclaimer: z.literal(FOUNDRY_OPERATOR_EVIDENCE_CHECKLIST_V8_DISCLAIMER),
    receiptSha256: z.string().regex(SHA256_HEX),
    sourceFactsSha256: z.string().regex(SHA256_HEX),
    readinessSha256: z.string().regex(SHA256_HEX),
    inheritedChecklistSha256: z.string().regex(SHA256_HEX),
    inherited: FoundryOperatorEvidenceChecklistV7Schema,
    pointValueResolutionBasis: z.array(
      FoundryPotreeV2PointValueReadinessRefinementV8Schema,
    ),
    resolvedPotreeUnknownRequestRefs: z.array(ResolvedRequestRefSchema),
    effectiveRemainingInheritedPotreeRequestIds: z.array(
      z.string().trim().min(1).max(700),
    ),
    policy: PolicySchema,
    limitations: LimitationsSchema,
    summary: SummarySchema,
    checklistSha256: z.string().regex(SHA256_HEX),
  })
  .strict();

const AvailableArtifactSchema = ArtifactBaseSchema.extend({
  state: z.literal("available"),
}).strict();

const BlockedArtifactSchema = ArtifactBaseSchema.extend({
  state: z.literal("blocked"),
  pointValueResolutionBasis: z.tuple([]),
  resolvedPotreeUnknownRequestRefs: z.tuple([]),
  effectiveRemainingInheritedPotreeRequestIds: z.tuple([]),
}).strict();

type ArtifactWithoutValidation =
  | z.infer<typeof AvailableArtifactSchema>
  | z.infer<typeof BlockedArtifactSchema>;

type ArtifactPayload = ArtifactWithoutValidation extends infer Artifact
  ? Artifact extends ArtifactWithoutValidation
    ? Omit<Artifact, "checklistSha256">
    : never
  : never;

export type FoundryOperatorEvidenceChecklistV8 = ArtifactWithoutValidation;
export const FoundryOperatorEvidenceChecklistV8Schema:
  z.ZodType<FoundryOperatorEvidenceChecklistV8> = z
  .discriminatedUnion("state", [AvailableArtifactSchema, BlockedArtifactSchema])
  .superRefine(validateArtifact);

const POLICY: z.infer<typeof PolicySchema> = {
  sourceAccess: "read_only",
  mutation: "none",
  requestPerformance: "none",
  completionTracking: "none",
  localDecoder: "bounded_diagnostic_only",
  diagnosticPreview: "local_evidence_only",
  processingReadiness: "not_established",
  reconstruction: "none",
  execution: "not_authorized",
  approval: "none",
  authority: "none",
  rights: "not_evaluated",
  unitsFrameCrs: "not_evaluated",
  accuracy: "not_evaluated",
  completeness: "not_evaluated",
  vendorSemantics: "not_evaluated",
};

function isSortedUnique(values: readonly string[]): boolean {
  return (
    new Set(values).size === values.length &&
    values.every(
      (value, index) =>
        index === 0 ||
        compareCanonicalStrings(values[index - 1] ?? "", value) < 0,
    )
  );
}

function resolvedReferenceId(
  bundleSha256: string,
  inheritedRequestId: string,
): string {
  return `potree-v8:${bundleSha256}:resolved:${inheritedRequestId}`;
}

function compareBasis(
  left: FoundryPotreeV2PointValueReadinessRefinementV8,
  right: FoundryPotreeV2PointValueReadinessRefinementV8,
): number {
  const root = compareCanonicalStrings(
    left.sourceFactsBundle.bundleRoot,
    right.sourceFactsBundle.bundleRoot,
  );
  return root !== 0
    ? root
    : compareCanonicalStrings(
        left.sourceFactsBundle.bundleSha256,
        right.sourceFactsBundle.bundleSha256,
      );
}

function canonicalBasis(
  basis: readonly FoundryPotreeV2PointValueReadinessRefinementV8[],
): FoundryPotreeV2PointValueReadinessRefinementV8[] {
  return [...basis].sort(compareBasis);
}

function compareResolvedRefs(
  left: FoundryResolvedPotreeUnknownRequestRefV8,
  right: FoundryResolvedPotreeUnknownRequestRefV8,
): number {
  const root = compareCanonicalStrings(left.bundleRoot, right.bundleRoot);
  return root !== 0
    ? root
    : compareCanonicalStrings(left.inheritedRequestId, right.inheritedRequestId);
}

function canonicalResolvedRefs(
  refs: readonly FoundryResolvedPotreeUnknownRequestRefV8[],
): FoundryResolvedPotreeUnknownRequestRefV8[] {
  return [...refs].sort(compareResolvedRefs);
}

function availablePotreeRequests(
  inherited: FoundryOperatorEvidenceChecklistV7,
): readonly FoundryPotreeV2EvidenceRequestV7[] {
  if (inherited.state !== "available") {
    throw new FoundryIntegrityError(
      "OPERATOR_EVIDENCE_V8_INHERITED_BLOCKED",
      "V8 request resolution requires an available V7 checklist.",
    );
  }
  return inherited.potreeEvidenceRequests;
}

function resolvedRefsForBasis(
  inherited: FoundryOperatorEvidenceChecklistV7,
  basis: readonly FoundryPotreeV2PointValueReadinessRefinementV8[],
): FoundryResolvedPotreeUnknownRequestRefV8[] {
  const requests = availablePotreeRequests(inherited);
  const refs: FoundryResolvedPotreeUnknownRequestRefV8[] = [];
  for (const refinement of basis) {
    if (refinement.status !== "decoded_values_established") continue;
    const matches = requests.filter((request) =>
      request.bundleRoot === refinement.sourceFactsBundle.bundleRoot &&
      request.bundleSha256 === refinement.sourceFactsBundle.bundleSha256 &&
      request.basisKind === "potree_bundle_unknown" &&
      request.evidenceCode ===
        FOUNDRY_POTREE_POINT_VALUES_RESOLVED_UNKNOWN_CODE
    );
    if (matches.length !== 1) {
      throw new FoundryIntegrityError(
        "OPERATOR_EVIDENCE_V8_POINT_VALUE_REQUEST_NOT_UNIQUE",
        "The exact V7 point-attribute-value request is missing or duplicated.",
      );
    }
    const request = matches[0];
    if (request === undefined) continue;
    const expectedPaths = refinement.sourceFactsBundle.members
      .map((member) => member.path)
      .sort(compareCanonicalStrings);
    const requestPaths = request.affectedSources
      .map((source) => source.path)
      .sort(compareCanonicalStrings);
    if (JSON.stringify(requestPaths) !== JSON.stringify(expectedPaths)) {
      throw new FoundryIntegrityError(
        "OPERATOR_EVIDENCE_V8_POINT_VALUE_SOURCE_MISMATCH",
        "The V7 point-value request does not bind the exact decoded bundle members.",
      );
    }
    refs.push(ResolvedRequestRefSchema.parse({
      id: resolvedReferenceId(
        refinement.sourceFactsBundle.bundleSha256,
        request.id,
      ),
      bundleRoot: refinement.sourceFactsBundle.bundleRoot,
      bundleSha256: refinement.sourceFactsBundle.bundleSha256,
      inheritedRequestId: request.id,
      inheritedEvidenceCode:
        FOUNDRY_POTREE_POINT_VALUES_RESOLVED_UNKNOWN_CODE,
      pointValueOutcomeCode: "POTREE_V2_POINT_VALUES_ESTABLISHED",
      resolutionStatus: "superseded_in_effective_v8_view_only",
      sourcePaths: expectedPaths,
    }));
  }
  return canonicalResolvedRefs(refs);
}

function remainingRequestIds(
  inherited: FoundryOperatorEvidenceChecklistV7,
  refs: readonly FoundryResolvedPotreeUnknownRequestRefV8[],
): string[] {
  if (inherited.state !== "available") return [];
  const resolved = new Set(refs.map((reference) => reference.inheritedRequestId));
  return inherited.potreeEvidenceRequests
    .filter((request) => !resolved.has(request.id))
    .map((request) => request.id)
    .sort(compareCanonicalStrings);
}

function summaryFor(
  inherited: FoundryOperatorEvidenceChecklistV7,
  basis: readonly FoundryPotreeV2PointValueReadinessRefinementV8[],
  refs: readonly FoundryResolvedPotreeUnknownRequestRefV8[],
  remainingIds: readonly string[],
): z.infer<typeof SummarySchema> {
  const remaining = inherited.state === "available"
    ? inherited.potreeEvidenceRequests.filter((request) =>
        remainingIds.includes(request.id)
      )
    : [];
  return {
    inheritedState: inherited.state,
    inheritedV7EvidenceRequestCount:
      inherited.summary.inheritedEvidenceRequestCount +
      inherited.summary.potreeEvidenceRequestCount,
    inheritedV7PotreeRequestCount: inherited.summary.potreeEvidenceRequestCount,
    pointValueOutcomeCount: basis.length,
    decodedValuesEstablishedCount: basis.filter(
      (refinement) => refinement.status === "decoded_values_established",
    ).length,
    decodedValuesNotEstablishedCount: basis.filter(
      (refinement) => refinement.status === "decoded_values_not_established",
    ).length,
    resolvedPotreeUnknownRequestCount: refs.length,
    effectiveRemainingPotreeRequestCount: remaining.length,
    effectiveRemainingPotreeUnknownRequestCount: remaining.filter(
      (request) => request.basisKind === "potree_bundle_unknown",
    ).length,
    effectiveRemainingPotreeInspectionFailureRequestCount: remaining.filter(
      (request) => request.basisKind === "potree_bundle_inspection_failure",
    ).length,
  };
}

function artifactDigest(value: ArtifactWithoutValidation): string {
  const { checklistSha256: _checklistSha256, ...payload } = value;
  return domainSeparatedSha256(
    FOUNDRY_OPERATOR_EVIDENCE_CHECKLIST_V8_DIGEST_DOMAIN,
    toCanonicalJson(payload),
  );
}

function validateArtifact(
  value: ArtifactWithoutValidation,
  ctx: z.RefinementCtx,
): void {
  if (
    value.receiptSha256 !== value.inherited.receiptSha256 ||
    value.inheritedChecklistSha256 !== value.inherited.checklistSha256 ||
    value.state !== value.inherited.state
  ) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["inherited"],
      message:
        "V8 checklist state and digest bindings must match the exact embedded V7 checklist",
    });
  }
  const canonicalBasisValue = canonicalBasis(value.pointValueResolutionBasis);
  if (
    JSON.stringify(value.pointValueResolutionBasis) !==
      JSON.stringify(canonicalBasisValue) ||
    !isSortedUnique(
      value.pointValueResolutionBasis.map((refinement) =>
        `${refinement.sourceFactsBundle.bundleRoot}\0${refinement.sourceFactsBundle.bundleSha256}`
      ),
    )
  ) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["pointValueResolutionBasis"],
      message: "V8 point-value resolution basis must be unique and canonical",
    });
  }
  let expectedRefs: FoundryResolvedPotreeUnknownRequestRefV8[] = [];
  try {
    expectedRefs = value.state === "available"
      ? resolvedRefsForBasis(value.inherited, value.pointValueResolutionBasis)
      : [];
  } catch (error) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["resolvedPotreeUnknownRequestRefs"],
      message: error instanceof Error
        ? error.message
        : "V8 request resolution contradicts the inherited V7 checklist",
    });
  }
  if (
    JSON.stringify(value.resolvedPotreeUnknownRequestRefs) !==
      JSON.stringify(expectedRefs)
  ) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["resolvedPotreeUnknownRequestRefs"],
      message:
        "V8 may resolve only the exact point-value request for an established outcome",
    });
  }
  const expectedRemaining = remainingRequestIds(value.inherited, expectedRefs);
  if (
    JSON.stringify(value.effectiveRemainingInheritedPotreeRequestIds) !==
      JSON.stringify(expectedRemaining)
  ) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["effectiveRemainingInheritedPotreeRequestIds"],
      message:
        "V8 effective remaining Potree request ids contradict the immutable V7 checklist",
    });
  }
  const expectedSummary = summaryFor(
    value.inherited,
    value.pointValueResolutionBasis,
    expectedRefs,
    expectedRemaining,
  );
  if (JSON.stringify(value.summary) !== JSON.stringify(expectedSummary)) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["summary"],
      message: "V8 checklist summary contradicts its effective request view",
    });
  }
  if (value.checklistSha256 !== artifactDigest(value)) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["checklistSha256"],
      message: "V8 checklist digest does not match the canonical payload",
    });
  }
}

function issueArtifact(
  payload: ArtifactPayload,
): FoundryOperatorEvidenceChecklistV8 {
  const candidate = {
    ...payload,
    checklistSha256: "0".repeat(64),
  } as ArtifactWithoutValidation;
  return FoundryOperatorEvidenceChecklistV8Schema.parse({
    ...payload,
    checklistSha256: artifactDigest(candidate),
  });
}

function limitations(): z.infer<typeof LimitationsSchema> {
  return [
    FOUNDRY_OPERATOR_EVIDENCE_CHECKLIST_V8_LIMITATIONS[0],
    FOUNDRY_OPERATOR_EVIDENCE_CHECKLIST_V8_LIMITATIONS[1],
    FOUNDRY_OPERATOR_EVIDENCE_CHECKLIST_V8_LIMITATIONS[2],
    FOUNDRY_OPERATOR_EVIDENCE_CHECKLIST_V8_LIMITATIONS[3],
    FOUNDRY_OPERATOR_EVIDENCE_CHECKLIST_V8_LIMITATIONS[4],
    FOUNDRY_OPERATOR_EVIDENCE_CHECKLIST_V8_LIMITATIONS[5],
  ];
}

export interface CompileFoundryOperatorEvidenceChecklistV8Input {
  readonly readiness: unknown;
}

/**
 * Recomputes and embeds the exact V7 checklist. Only a successful bounded V8
 * point-value outcome adds one effective-view supersession reference.
 */
export function compileFoundryOperatorEvidenceChecklistV8(
  input: CompileFoundryOperatorEvidenceChecklistV8Input,
): FoundryOperatorEvidenceChecklistV8 {
  const readiness = FoundrySourceReadinessMapV8Schema.parse(input.readiness);
  const inherited = compileFoundryOperatorEvidenceChecklistV7({
    readiness: readiness.inherited,
  });
  if (readiness.state !== inherited.state) {
    throw new FoundryIntegrityError(
      "OPERATOR_EVIDENCE_V8_STATE_MISMATCH",
      "Readiness V8 and the recomputed V7 checklist disagree on availability.",
    );
  }
  const basis = readiness.state === "available"
    ? canonicalBasis(readiness.pointValueRefinements)
    : [];
  const refs = readiness.state === "available"
    ? resolvedRefsForBasis(inherited, basis)
    : [];
  const remainingIds = remainingRequestIds(inherited, refs);
  const base = {
    schemaVersion: FOUNDRY_OPERATOR_EVIDENCE_CHECKLIST_V8,
    meaning: FOUNDRY_OPERATOR_EVIDENCE_CHECKLIST_V8_MEANING,
    basis: FOUNDRY_OPERATOR_EVIDENCE_CHECKLIST_V8_BASIS,
    disclaimer: FOUNDRY_OPERATOR_EVIDENCE_CHECKLIST_V8_DISCLAIMER,
    receiptSha256: readiness.receiptSha256,
    sourceFactsSha256: readiness.sourceFactsSha256,
    readinessSha256: readiness.readinessSha256,
    inheritedChecklistSha256: inherited.checklistSha256,
    inherited,
    pointValueResolutionBasis: basis,
    policy: POLICY,
    limitations: limitations(),
    summary: summaryFor(inherited, basis, refs, remainingIds),
  } as const;
  return readiness.state === "available"
    ? issueArtifact({
        ...base,
        state: "available",
        resolvedPotreeUnknownRequestRefs: refs,
        effectiveRemainingInheritedPotreeRequestIds: remainingIds,
      })
    : issueArtifact({
        ...base,
        state: "blocked",
        pointValueResolutionBasis: [],
        resolvedPotreeUnknownRequestRefs: [],
        effectiveRemainingInheritedPotreeRequestIds: [],
      });
}

export interface VerifyFoundryOperatorEvidenceChecklistV8Input
  extends CompileFoundryOperatorEvidenceChecklistV8Input {
  readonly checklist: unknown;
}

export function verifyFoundryOperatorEvidenceChecklistV8(
  input: VerifyFoundryOperatorEvidenceChecklistV8Input,
): FoundryOperatorEvidenceChecklistV8 {
  const actual = FoundryOperatorEvidenceChecklistV8Schema.parse(
    input.checklist,
  );
  const expected = compileFoundryOperatorEvidenceChecklistV8(input);
  if (
    serializeFoundryOperatorEvidenceChecklistV8(actual) !==
      serializeFoundryOperatorEvidenceChecklistV8(expected)
  ) {
    throw new FoundryIntegrityError(
      "OPERATOR_EVIDENCE_CHECKLIST_V8_MISMATCH",
      "The V8 checklist does not exactly match the supplied readiness artifact.",
    );
  }
  return actual;
}

export function serializeFoundryOperatorEvidenceChecklistV8(
  value: FoundryOperatorEvidenceChecklistV8,
): string {
  return stableCanonicalJson(
    toCanonicalJson(FoundryOperatorEvidenceChecklistV8Schema.parse(value)),
  );
}
