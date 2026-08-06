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
  FoundryOperatorEvidenceChecklistV6Schema,
  compileFoundryOperatorEvidenceChecklistV6,
  type FoundryOperatorEvidenceChecklistV6,
} from "./operator-evidence-checklist-v6.js";
import { FoundryPotreeV2BundleMemberIdentitySchema } from "./potree-v2-source-facts.js";
import { FoundryPotreeV2BundleAssetV7Schema } from "./source-facts-v7.js";
import {
  FoundrySourceReadinessMapV7Schema,
  type FoundrySourceReadinessMapV7,
} from "./source-readiness-v7.js";

export const FOUNDRY_OPERATOR_EVIDENCE_CHECKLIST_V7 =
  "omnitwin.foundry.operator-evidence-checklist.v7";
export const FOUNDRY_OPERATOR_EVIDENCE_CHECKLIST_V7_DIGEST_DOMAIN =
  "VENVIEWER_FOUNDRY_OPERATOR_EVIDENCE_CHECKLIST_V7";
export const FOUNDRY_OPERATOR_EVIDENCE_CHECKLIST_V7_MEANING =
  "immutable_v6_operator_evidence_with_potree_v2_requests";
export const FOUNDRY_OPERATOR_EVIDENCE_CHECKLIST_V7_BASIS =
  "exact_source_readiness_map_v7";
export const FOUNDRY_OPERATOR_EVIDENCE_CHECKLIST_V7_DISCLAIMER =
  "This is a deterministic, unperformed evidence-request view. It preserves the exact V6 checklist and grants no approval, authority, reconstruction, or execution permission.";
export const FOUNDRY_OPERATOR_EVIDENCE_CHECKLIST_V7_LIMITATIONS = [
  "EVIDENCE_REQUESTS_ARE_NOT_PERFORMED_WORK",
  "POTREE_FORMAT_FACTS_DO_NOT_ESTABLISH_REGISTRATION_OR_ACCURACY",
  "POTREE_PREVIEW_IS_NOT_RAW_CAPTURE_OR_INDEPENDENT_CONTROL",
  "INHERITED_V6_CHECKLIST_REMAINS_IMMUTABLE",
  "SUPERSESSION_REFERENCES_ARE_PATH_SPECIFIC_AND_VIEW_ONLY",
] as const;

export const FOUNDRY_POTREE_V2_INSPECTION_FAILURE_EVIDENCE_CODE =
  "POTREE_V2_SOURCE_FACTS_NOT_ESTABLISHED";

const POTREE_FAILURE_LABEL = "Resolve Potree v2 bundle inspection";
const POTREE_FAILURE_REASON =
  "The exact receipted Potree v2 bundle candidate did not establish bounded format facts.";
const POTREE_FAILURE_REQUEST =
  "Resolve the recorded Potree v2 inspection failure or resource limit against these exact receipted members, then rebuild Source Facts V7.";

const SHA256_HEX = /^[a-f0-9]{64}$/u;
const STABLE_CODE = /^[A-Z][A-Z0-9_]{2,95}$/u;
const BundleRootSchema = z.union([z.literal(""), FoundryRelativePathSchema]);

const PotreeMemberSourceSchema = FoundryPotreeV2BundleMemberIdentitySchema;
type PotreeMemberSource = z.infer<typeof PotreeMemberSourceSchema>;

const PotreeEvidenceRequestSchema = z
  .object({
    id: z.string().trim().min(1).max(700),
    basisKind: z.enum([
      "potree_bundle_inspection_failure",
      "potree_bundle_unknown",
    ]),
    evidenceCode: z.string().regex(STABLE_CODE),
    inspectionCode: z.string().regex(STABLE_CODE).nullable(),
    necessity: z.literal("not_evaluated"),
    requestStatus: z.literal("requested_not_performed"),
    laneIds: z.tuple([z.literal("point_geometry")]),
    bundleRoot: BundleRootSchema,
    bundleSha256: z.string().regex(SHA256_HEX),
    label: z.string().trim().min(1).max(120),
    reason: z.string().trim().min(1).max(500),
    requestedEvidence: z.string().trim().min(1).max(500),
    sourceFactsBundle: FoundryPotreeV2BundleAssetV7Schema,
    affectedSources: z.array(PotreeMemberSourceSchema).min(2).max(3),
  })
  .strict()
  .superRefine((request, ctx) => {
    if (!isSortedUnique(request.affectedSources.map((source) => source.path))) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["affectedSources"],
        message: "affected Potree members must have unique canonical paths",
      });
    }
    const expectedId = requestId(
      request.bundleSha256,
      request.basisKind,
      request.evidenceCode,
    );
    if (request.id !== expectedId) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["id"],
        message: "Potree request id must be derived from its exact basis",
      });
    }
    if (
      request.bundleRoot !== request.sourceFactsBundle.bundleRoot ||
      request.bundleSha256 !== request.sourceFactsBundle.bundleSha256 ||
      JSON.stringify(request.affectedSources) !==
        JSON.stringify(canonicalSources(request.sourceFactsBundle.members))
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["sourceFactsBundle"],
        message:
          "Potree request must retain its exact bundle and canonical member identities",
      });
    }
    if (request.basisKind === "potree_bundle_inspection_failure") {
      if (
        request.evidenceCode !==
          FOUNDRY_POTREE_V2_INSPECTION_FAILURE_EVIDENCE_CODE ||
        request.sourceFactsBundle.inspection.state !==
          "facts_not_established" ||
        request.inspectionCode !== request.sourceFactsBundle.inspection.code ||
        request.label !== POTREE_FAILURE_LABEL ||
        request.reason !== POTREE_FAILURE_REASON ||
        request.requestedEvidence !== POTREE_FAILURE_REQUEST
      ) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["basisKind"],
          message: "Potree failure request must use the frozen failure profile",
        });
      }
    } else {
      const unknown = request.sourceFactsBundle.unknowns.find(
        (candidate) => candidate.code === request.evidenceCode,
      );
      if (
        request.inspectionCode !== null ||
        unknown === undefined ||
        request.label !== unknown.label ||
        request.reason !== unknown.reason ||
        request.requestedEvidence !== unknown.decisiveNextTest
      ) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["basisKind"],
          message:
            "Potree unknown requests must match one frozen bundle unknown exactly",
        });
      }
    }
  });
export type FoundryPotreeV2EvidenceRequestV7 = z.infer<
  typeof PotreeEvidenceRequestSchema
>;

const SupersededInheritedRequestRefSchema = z
  .object({
    bundleRoot: BundleRootSchema,
    bundleSha256: z.string().regex(SHA256_HEX),
    inheritedItemId: z.string().trim().min(1).max(300),
    inheritedEvidenceCode: z.enum([
      "AMBIGUOUS_FORMAT",
      "OUTSIDE_SOURCE_FACTS_V6",
      "SOURCE_FACTS_NOT_ESTABLISHED",
      "UNCLASSIFIED_FORMAT",
    ]),
    sourcePaths: z.array(FoundryRelativePathSchema).min(1),
  })
  .strict()
  .superRefine((reference, ctx) => {
    if (!isSortedUnique(reference.sourcePaths)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["sourcePaths"],
        message: "superseded request paths must be unique and canonical",
      });
    }
  });
export type FoundrySupersededInheritedEvidenceRequestRefV7 = z.infer<
  typeof SupersededInheritedRequestRefSchema
>;

const SummarySchema = z
  .object({
    inheritedState: z.enum(["available", "blocked"]),
    inheritedEvidenceRequestCount: z.number().int().nonnegative(),
    potreeEvidenceRequestCount: z.number().int().nonnegative(),
    potreeInspectionFailureRequestCount: z.number().int().nonnegative(),
    potreeUnknownRequestCount: z.number().int().nonnegative(),
    affectedPotreeMemberSourceCount: z.number().int().nonnegative(),
    supersededInheritedRequestReferenceCount: z.number().int().nonnegative(),
    supersededInheritedSourcePathCount: z.number().int().nonnegative(),
  })
  .strict();

const PolicySchema = z
  .object({
    sourceAccess: z.literal("read_only"),
    mutation: z.literal("none"),
    requestPerformance: z.literal("none"),
    completionTracking: z.literal("none"),
    reconstruction: z.literal("none"),
    execution: z.literal("not_authorized"),
    approval: z.literal("none"),
    authority: z.literal("none"),
    rights: z.literal("not_evaluated"),
    accuracy: z.literal("not_evaluated"),
    registration: z.literal("not_evaluated"),
  })
  .strict();

const LimitationsSchema = z.tuple([
  z.literal(FOUNDRY_OPERATOR_EVIDENCE_CHECKLIST_V7_LIMITATIONS[0]),
  z.literal(FOUNDRY_OPERATOR_EVIDENCE_CHECKLIST_V7_LIMITATIONS[1]),
  z.literal(FOUNDRY_OPERATOR_EVIDENCE_CHECKLIST_V7_LIMITATIONS[2]),
  z.literal(FOUNDRY_OPERATOR_EVIDENCE_CHECKLIST_V7_LIMITATIONS[3]),
  z.literal(FOUNDRY_OPERATOR_EVIDENCE_CHECKLIST_V7_LIMITATIONS[4]),
]);

const ArtifactBaseSchema = z
  .object({
    schemaVersion: z.literal(FOUNDRY_OPERATOR_EVIDENCE_CHECKLIST_V7),
    meaning: z.literal(FOUNDRY_OPERATOR_EVIDENCE_CHECKLIST_V7_MEANING),
    basis: z.literal(FOUNDRY_OPERATOR_EVIDENCE_CHECKLIST_V7_BASIS),
    disclaimer: z.literal(FOUNDRY_OPERATOR_EVIDENCE_CHECKLIST_V7_DISCLAIMER),
    receiptSha256: z.string().regex(SHA256_HEX),
    sourceFactsSha256: z.string().regex(SHA256_HEX),
    readinessSha256: z.string().regex(SHA256_HEX),
    inheritedChecklistSha256: z.string().regex(SHA256_HEX),
    inherited: FoundryOperatorEvidenceChecklistV6Schema,
    policy: PolicySchema,
    limitations: LimitationsSchema,
    summary: SummarySchema,
    potreeEvidenceRequests: z.array(PotreeEvidenceRequestSchema),
    supersededInheritedRequestRefs: z.array(
      SupersededInheritedRequestRefSchema,
    ),
    checklistSha256: z.string().regex(SHA256_HEX),
  })
  .strict();

const AvailableArtifactSchema = ArtifactBaseSchema.extend({
  state: z.literal("available"),
}).strict();

const BlockedArtifactSchema = ArtifactBaseSchema.extend({
  state: z.literal("blocked"),
  potreeEvidenceRequests: z.tuple([]),
  supersededInheritedRequestRefs: z.tuple([]),
}).strict();

type ArtifactWithoutValidation =
  | z.infer<typeof AvailableArtifactSchema>
  | z.infer<typeof BlockedArtifactSchema>;

export const FoundryOperatorEvidenceChecklistV7Schema = z
  .discriminatedUnion("state", [AvailableArtifactSchema, BlockedArtifactSchema])
  .superRefine(validateArtifact);
export type FoundryOperatorEvidenceChecklistV7 = z.infer<
  typeof FoundryOperatorEvidenceChecklistV7Schema
>;

const POLICY: z.infer<typeof PolicySchema> = {
  sourceAccess: "read_only",
  mutation: "none",
  requestPerformance: "none",
  completionTracking: "none",
  reconstruction: "none",
  execution: "not_authorized",
  approval: "none",
  authority: "none",
  rights: "not_evaluated",
  accuracy: "not_evaluated",
  registration: "not_evaluated",
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

function canonicalSources(
  sources: readonly PotreeMemberSource[],
): PotreeMemberSource[] {
  return [...sources].sort((left, right) =>
    compareCanonicalStrings(left.path, right.path)
  );
}

function requestId(
  bundleSha256: string,
  basisKind: FoundryPotreeV2EvidenceRequestV7["basisKind"],
  evidenceCode: string,
): string {
  return `potree-v7:${bundleSha256}:${basisKind}:${evidenceCode}`;
}

const REQUEST_KIND_ORDER: Readonly<
  Record<FoundryPotreeV2EvidenceRequestV7["basisKind"], number>
> = {
  potree_bundle_inspection_failure: 0,
  potree_bundle_unknown: 1,
};

function compareRequests(
  left: FoundryPotreeV2EvidenceRequestV7,
  right: FoundryPotreeV2EvidenceRequestV7,
): number {
  const root = compareCanonicalStrings(left.bundleRoot, right.bundleRoot);
  if (root !== 0) return root;
  const kind = REQUEST_KIND_ORDER[left.basisKind] -
    REQUEST_KIND_ORDER[right.basisKind];
  if (kind !== 0) return kind;
  return compareCanonicalStrings(left.evidenceCode, right.evidenceCode);
}

function canonicalRequests(
  requests: readonly FoundryPotreeV2EvidenceRequestV7[],
): FoundryPotreeV2EvidenceRequestV7[] {
  return [...requests].sort(compareRequests);
}

function compareSupersededRefs(
  left: FoundrySupersededInheritedEvidenceRequestRefV7,
  right: FoundrySupersededInheritedEvidenceRequestRefV7,
): number {
  const root = compareCanonicalStrings(left.bundleRoot, right.bundleRoot);
  if (root !== 0) return root;
  const code = compareCanonicalStrings(
    left.inheritedEvidenceCode,
    right.inheritedEvidenceCode,
  );
  return code !== 0
    ? code
    : compareCanonicalStrings(left.inheritedItemId, right.inheritedItemId);
}

function canonicalSupersededRefs(
  refs: readonly FoundrySupersededInheritedEvidenceRequestRefV7[],
): FoundrySupersededInheritedEvidenceRequestRefV7[] {
  return [...refs].sort(compareSupersededRefs);
}

function requestsForReadiness(
  readiness: Extract<FoundrySourceReadinessMapV7, { readonly state: "available" }>,
): FoundryPotreeV2EvidenceRequestV7[] {
  const requests: FoundryPotreeV2EvidenceRequestV7[] = [];
  for (const refinement of readiness.potreeBundleRefinements) {
    const bundle = refinement.sourceFactsBundle;
    const sources = canonicalSources(bundle.members);
    if (bundle.inspection.state === "facts_not_established") {
      requests.push(PotreeEvidenceRequestSchema.parse({
        id: requestId(
          bundle.bundleSha256,
          "potree_bundle_inspection_failure",
          FOUNDRY_POTREE_V2_INSPECTION_FAILURE_EVIDENCE_CODE,
        ),
        basisKind: "potree_bundle_inspection_failure",
        evidenceCode: FOUNDRY_POTREE_V2_INSPECTION_FAILURE_EVIDENCE_CODE,
        inspectionCode: bundle.inspection.code,
        necessity: "not_evaluated",
        requestStatus: "requested_not_performed",
        laneIds: ["point_geometry"],
        bundleRoot: bundle.bundleRoot,
        bundleSha256: bundle.bundleSha256,
        label: POTREE_FAILURE_LABEL,
        reason: POTREE_FAILURE_REASON,
        requestedEvidence: POTREE_FAILURE_REQUEST,
        sourceFactsBundle: bundle,
        affectedSources: sources,
      }));
    }
    for (const unknown of bundle.unknowns) {
      requests.push(PotreeEvidenceRequestSchema.parse({
        id: requestId(
          bundle.bundleSha256,
          "potree_bundle_unknown",
          unknown.code,
        ),
        basisKind: "potree_bundle_unknown",
        evidenceCode: unknown.code,
        inspectionCode: null,
        necessity: "not_evaluated",
        requestStatus: "requested_not_performed",
        laneIds: ["point_geometry"],
        bundleRoot: bundle.bundleRoot,
        bundleSha256: bundle.bundleSha256,
        label: unknown.label,
        reason: unknown.reason,
        requestedEvidence: unknown.decisiveNextTest,
        sourceFactsBundle: bundle,
        affectedSources: sources,
      }));
    }
  }
  return canonicalRequests(requests);
}

function availableInheritedItems(
  inherited: FoundryOperatorEvidenceChecklistV6,
): Extract<FoundryOperatorEvidenceChecklistV6, { readonly state: "available" }>[
  "items"
] {
  if (inherited.state !== "available") {
    throw new FoundryIntegrityError(
      "OPERATOR_EVIDENCE_V7_INHERITED_BLOCKED",
      "Potree request supersession requires an available V6 checklist.",
    );
  }
  return inherited.items;
}

function supersededRefsForReadiness(
  readiness: Extract<FoundrySourceReadinessMapV7, { readonly state: "available" }>,
  inherited: FoundryOperatorEvidenceChecklistV6,
): FoundrySupersededInheritedEvidenceRequestRefV7[] {
  const items = availableInheritedItems(inherited);
  const refs: FoundrySupersededInheritedEvidenceRequestRefV7[] = [];
  for (const refinement of readiness.potreeBundleRefinements) {
    const bundle = refinement.sourceFactsBundle;
    const grouped = new Map<string, string[]>();
    for (const row of refinement.supersededInheritedEvidence) {
      const existing = grouped.get(row.inheritedGapCode) ?? [];
      existing.push(row.path);
      grouped.set(row.inheritedGapCode, existing);
    }
    for (const [evidenceCode, paths] of grouped) {
      const item = items.find((candidate) =>
        candidate.evidenceCode === evidenceCode
      );
      if (item === undefined) {
        throw new FoundryIntegrityError(
          "OPERATOR_EVIDENCE_V7_SUPERSEDED_ITEM_NOT_FOUND",
          `Inherited V6 request ${evidenceCode} is absent.`,
        );
      }
      const sourceByPath = new Map(
        item.affectedSources.map((source) => [source.path, source] as const),
      );
      for (const path of paths) {
        const member = bundle.members.find((source) => source.path === path);
        const inheritedSource = sourceByPath.get(path);
        if (
          member === undefined ||
          inheritedSource === undefined ||
          inheritedSource.sizeBytes !== member.sizeBytes ||
          inheritedSource.sha256 !== member.sha256
        ) {
          throw new FoundryIntegrityError(
            "OPERATOR_EVIDENCE_V7_SUPERSEDED_SOURCE_MISMATCH",
            `Inherited V6 request ${evidenceCode} does not bind Potree member ${path}.`,
          );
        }
      }
      refs.push(SupersededInheritedRequestRefSchema.parse({
        bundleRoot: bundle.bundleRoot,
        bundleSha256: bundle.bundleSha256,
        inheritedItemId: item.id,
        inheritedEvidenceCode: evidenceCode,
        sourcePaths: [...paths].sort(compareCanonicalStrings),
      }));
    }
  }
  return canonicalSupersededRefs(refs);
}

function summaryFor(
  inherited: FoundryOperatorEvidenceChecklistV6,
  requests: readonly FoundryPotreeV2EvidenceRequestV7[],
  refs: readonly FoundrySupersededInheritedEvidenceRequestRefV7[],
): z.infer<typeof SummarySchema> {
  return {
    inheritedState: inherited.state,
    inheritedEvidenceRequestCount: inherited.summary.evidenceRequestCount,
    potreeEvidenceRequestCount: requests.length,
    potreeInspectionFailureRequestCount: requests.filter(
      (request) =>
        request.basisKind === "potree_bundle_inspection_failure",
    ).length,
    potreeUnknownRequestCount: requests.filter(
      (request) => request.basisKind === "potree_bundle_unknown",
    ).length,
    affectedPotreeMemberSourceCount: new Set(
      requests.flatMap((request) =>
        request.affectedSources.map((source) => source.path)
      ),
    ).size,
    supersededInheritedRequestReferenceCount: refs.length,
    supersededInheritedSourcePathCount: new Set(
      refs.flatMap((reference) => reference.sourcePaths),
    ).size,
  };
}

function artifactDigest(value: ArtifactWithoutValidation): string {
  const { checklistSha256: _checklistSha256, ...payload } = value;
  return domainSeparatedSha256(
    FOUNDRY_OPERATOR_EVIDENCE_CHECKLIST_V7_DIGEST_DOMAIN,
    toCanonicalJson(payload),
  );
}

function validateArtifact(
  value: ArtifactWithoutValidation,
  ctx: z.RefinementCtx,
): void {
  if (value.receiptSha256 !== value.inherited.receiptSha256) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["receiptSha256"],
      message: "V7 checklist receipt must match the inherited V6 checklist",
    });
  }
  if (value.inheritedChecklistSha256 !== value.inherited.checklistSha256) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["inheritedChecklistSha256"],
      message: "inherited checklist digest must match the embedded V6 artifact",
    });
  }
  if (value.state !== value.inherited.state) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["state"],
      message: "V7 checklist must retain the inherited XBIN-blocked state",
    });
  }
  const expectedRequests = canonicalRequests(value.potreeEvidenceRequests);
  if (
    JSON.stringify(value.potreeEvidenceRequests) !==
      JSON.stringify(expectedRequests) ||
    !isSortedUnique(value.potreeEvidenceRequests.map((request) => request.id))
  ) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["potreeEvidenceRequests"],
      message: "Potree requests must have unique, canonical identities and order",
    });
  }
  const expectedRefs = canonicalSupersededRefs(
    value.supersededInheritedRequestRefs,
  );
  const refKeys = value.supersededInheritedRequestRefs.map((reference) =>
    `${reference.bundleRoot}\0${reference.inheritedEvidenceCode}`
  );
  if (
    JSON.stringify(value.supersededInheritedRequestRefs) !==
      JSON.stringify(expectedRefs) ||
    new Set(refKeys).size !== refKeys.length
  ) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["supersededInheritedRequestRefs"],
      message: "superseded inherited request references must be unique and canonical",
    });
  }
  const expectedSummary = summaryFor(
    value.inherited,
    value.potreeEvidenceRequests,
    value.supersededInheritedRequestRefs,
  );
  if (JSON.stringify(value.summary) !== JSON.stringify(expectedSummary)) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["summary"],
      message: "V7 checklist summary contradicts its request overlay",
    });
  }
  if (value.checklistSha256 !== artifactDigest(value)) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["checklistSha256"],
      message: "V7 checklist digest does not match the canonical payload",
    });
  }
}

function issueArtifact(
  payload: Omit<ArtifactWithoutValidation, "checklistSha256">,
): FoundryOperatorEvidenceChecklistV7 {
  const candidate = {
    ...payload,
    checklistSha256: "0".repeat(64),
  } as ArtifactWithoutValidation;
  return FoundryOperatorEvidenceChecklistV7Schema.parse({
    ...payload,
    checklistSha256: artifactDigest(candidate),
  });
}

function limitations(): z.infer<typeof LimitationsSchema> {
  return [
    FOUNDRY_OPERATOR_EVIDENCE_CHECKLIST_V7_LIMITATIONS[0],
    FOUNDRY_OPERATOR_EVIDENCE_CHECKLIST_V7_LIMITATIONS[1],
    FOUNDRY_OPERATOR_EVIDENCE_CHECKLIST_V7_LIMITATIONS[2],
    FOUNDRY_OPERATOR_EVIDENCE_CHECKLIST_V7_LIMITATIONS[3],
    FOUNDRY_OPERATOR_EVIDENCE_CHECKLIST_V7_LIMITATIONS[4],
  ];
}

export interface CompileFoundryOperatorEvidenceChecklistV7Input {
  readonly readiness: unknown;
}

/**
 * Recomputes and embeds the exact V6 checklist, then adds unperformed Potree
 * inspection and unknown requests plus path-scoped inherited-request refs.
 */
export function compileFoundryOperatorEvidenceChecklistV7(
  input: CompileFoundryOperatorEvidenceChecklistV7Input,
): FoundryOperatorEvidenceChecklistV7 {
  const readiness = FoundrySourceReadinessMapV7Schema.parse(input.readiness);
  const inherited = compileFoundryOperatorEvidenceChecklistV6({
    readiness: readiness.inherited,
  });
  if (readiness.state !== inherited.state) {
    throw new FoundryIntegrityError(
      "OPERATOR_EVIDENCE_V7_STATE_MISMATCH",
      "Readiness V7 and the recomputed V6 checklist disagree on XBIN availability.",
    );
  }
  const requests = readiness.state === "available"
    ? requestsForReadiness(readiness)
    : [];
  const refs = readiness.state === "available"
    ? supersededRefsForReadiness(readiness, inherited)
    : [];
  const base = {
    schemaVersion: FOUNDRY_OPERATOR_EVIDENCE_CHECKLIST_V7,
    meaning: FOUNDRY_OPERATOR_EVIDENCE_CHECKLIST_V7_MEANING,
    basis: FOUNDRY_OPERATOR_EVIDENCE_CHECKLIST_V7_BASIS,
    disclaimer: FOUNDRY_OPERATOR_EVIDENCE_CHECKLIST_V7_DISCLAIMER,
    receiptSha256: readiness.receiptSha256,
    sourceFactsSha256: readiness.sourceFactsSha256,
    readinessSha256: readiness.readinessSha256,
    inheritedChecklistSha256: inherited.checklistSha256,
    inherited,
    policy: POLICY,
    limitations: limitations(),
    summary: summaryFor(inherited, requests, refs),
  } as const;
  return readiness.state === "available"
    ? issueArtifact({
      ...base,
      state: "available",
      potreeEvidenceRequests: requests,
      supersededInheritedRequestRefs: refs,
    })
    : issueArtifact({
      ...base,
      state: "blocked",
      potreeEvidenceRequests: [],
      supersededInheritedRequestRefs: [],
    });
}

export interface VerifyFoundryOperatorEvidenceChecklistV7Input {
  readonly readiness: unknown;
  readonly checklist: unknown;
}

export function verifyFoundryOperatorEvidenceChecklistV7(
  input: VerifyFoundryOperatorEvidenceChecklistV7Input,
): FoundryOperatorEvidenceChecklistV7 {
  const actual = FoundryOperatorEvidenceChecklistV7Schema.parse(
    input.checklist,
  );
  const expected = compileFoundryOperatorEvidenceChecklistV7({
    readiness: input.readiness,
  });
  if (
    serializeFoundryOperatorEvidenceChecklistV7(actual) !==
    serializeFoundryOperatorEvidenceChecklistV7(expected)
  ) {
    throw new FoundryIntegrityError(
      "OPERATOR_EVIDENCE_CHECKLIST_V7_MISMATCH",
      "The V7 checklist does not exactly match the supplied readiness artifact.",
    );
  }
  return actual;
}

export function serializeFoundryOperatorEvidenceChecklistV7(
  value: FoundryOperatorEvidenceChecklistV7,
): string {
  return stableCanonicalJson(
    toCanonicalJson(FoundryOperatorEvidenceChecklistV7Schema.parse(value)),
  );
}
