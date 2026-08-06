import { z } from "zod";
import {
  domainSeparatedSha256,
  stableCanonicalJson,
  toCanonicalJson,
} from "./canonical-json.js";
import { compareCanonicalStrings } from "./canonical-order.js";
import { FoundryIntegrityError } from "./errors.js";
import { FoundryUniversalIntakeReceiptSchema } from "./intake-receipt.js";
import {
  FoundryPotreeV2BundleAssetV7Schema,
  type FoundryPotreeV2BundleAssetV7,
} from "./source-facts-v7.js";
import {
  FoundryPotreeV2PointValueBundleV8Schema,
  FoundryUniversalSourceFactsV8Schema,
  type FoundryPotreeV2PointValueBundleV8,
} from "./source-facts-v8.js";
import {
  FoundrySourceReadinessMapV7Schema,
  compileFoundrySourceReadinessMapV7,
  type FoundrySourceReadinessMapV7,
} from "./source-readiness-v7.js";

export const FOUNDRY_SOURCE_READINESS_MAP_V8 =
  "omnitwin.foundry.source-readiness-map.v8";
export const FOUNDRY_SOURCE_READINESS_MAP_V8_DIGEST_DOMAIN =
  "VENVIEWER_FOUNDRY_SOURCE_READINESS_MAP_V8";
export const FOUNDRY_SOURCE_READINESS_MAP_V8_MEANING =
  "immutable_v7_source_readiness_with_bounded_potree_point_value_refinements";
export const FOUNDRY_SOURCE_READINESS_MAP_V8_BASIS =
  "exact_intake_receipt_and_universal_source_facts_v8";
export const FOUNDRY_SOURCE_READINESS_MAP_V8_DISCLAIMER =
  "This artifact preserves the exact V7 readiness map and adds bounded local Potree point-value and deterministic-preview evidence only. It establishes no processing readiness, units, frame, CRS, accuracy, completeness, registration, rights, approval, or execution authorization.";
export const FOUNDRY_SOURCE_READINESS_MAP_V8_LIMITATIONS = [
  "DECODED_NUMERIC_VALUES_ARE_NOT_PROCESSING_READINESS",
  "LOCAL_CPU_RASTERS_ARE_DIAGNOSTIC_ONLY",
  "UNITS_FRAME_CRS_ACCURACY_AND_COMPLETENESS_REMAIN_UNRESOLVED",
  "THE_OPAQUE_VENDOR_BYTE_REMAINS_SEMANTICALLY_UNKNOWN",
  "INHERITED_V7_READINESS_REMAINS_IMMUTABLE",
  "FAILED_POINT_VALUE_INSPECTIONS_ESTABLISH_NO_PARTIAL_VALUES_OR_PREVIEWS",
] as const;

const SHA256_HEX = /^[a-f0-9]{64}$/u;
const STABLE_CODE = /^[A-Z][A-Z0-9_]{2,95}$/u;

const PointValueStatusSchema = z.enum([
  "decoded_values_established",
  "decoded_values_not_established",
]);
export type FoundryPotreeV2PointValueReadinessStatusV8 = z.infer<
  typeof PointValueStatusSchema
>;

export const FoundryPotreeV2PointValueReadinessRefinementV8Schema = z
  .object({
    laneIds: z.tuple([z.literal("point_geometry")]),
    status: PointValueStatusSchema,
    diagnosticPreview: z.enum(["available", "unavailable"]),
    processingReadiness: z.literal("not_established"),
    execution: z.literal("not_authorized"),
    sourceFactsBundle: FoundryPotreeV2BundleAssetV7Schema,
    pointValueEvidence: FoundryPotreeV2PointValueBundleV8Schema,
    resolvedUnknownCodes: z.array(z.string().regex(STABLE_CODE)),
    remainingUnknownCodes: z.array(z.string().regex(STABLE_CODE)),
  })
  .strict()
  .superRefine((refinement, ctx) => {
    const established = refinement.pointValueEvidence.pointValues.state ===
      "established";
    const expectedStatus: FoundryPotreeV2PointValueReadinessStatusV8 =
      established
        ? "decoded_values_established"
        : "decoded_values_not_established";
    if (refinement.status !== expectedStatus) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["status"],
        message: "V8 readiness status must match the exact point-value outcome",
      });
    }
    if (
      refinement.diagnosticPreview !==
        (established ? "available" : "unavailable")
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["diagnosticPreview"],
        message:
          "V8 diagnostic preview availability must match the point-value outcome",
      });
    }
    if (
      refinement.sourceFactsBundle.bundleRoot !==
        refinement.pointValueEvidence.bundleRoot ||
      refinement.sourceFactsBundle.bundleSha256 !==
        refinement.pointValueEvidence.bundleSha256 ||
      refinement.sourceFactsBundle.inspection.state !== "established"
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["sourceFactsBundle"],
        message:
          "V8 readiness must retain the exact V7-established Potree bundle",
      });
    }
    if (
      JSON.stringify(refinement.resolvedUnknownCodes) !==
        JSON.stringify(refinement.pointValueEvidence.resolvedUnknownCodes) ||
      JSON.stringify(refinement.remainingUnknownCodes) !==
        JSON.stringify(refinement.pointValueEvidence.remainingUnknownCodes)
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["resolvedUnknownCodes"],
        message:
          "V8 readiness unknown resolution must exactly retain Source Facts V8",
      });
    }
  });
export type FoundryPotreeV2PointValueReadinessRefinementV8 = z.infer<
  typeof FoundryPotreeV2PointValueReadinessRefinementV8Schema
>;

const SummarySchema = z
  .object({
    receiptFileCount: z.number().int().safe().nonnegative(),
    inheritedState: z.enum(["available", "blocked"]),
    pointValueOutcomeCount: z.number().int().safe().nonnegative(),
    decodedValuesEstablishedCount: z.number().int().safe().nonnegative(),
    decodedValuesNotEstablishedCount: z.number().int().safe().nonnegative(),
    diagnosticPreviewAvailableCount: z.number().int().safe().nonnegative(),
    diagnosticPreviewUnavailableCount: z.number().int().safe().nonnegative(),
    affectedPotreeBundleCount: z.number().int().safe().nonnegative(),
    affectedPotreeMemberSourceCount: z.number().int().safe().nonnegative(),
    resolvedUnknownCount: z.number().int().safe().nonnegative(),
    remainingUnknownCount: z.number().int().safe().nonnegative(),
  })
  .strict();

const PolicySchema = z
  .object({
    sourceAccess: z.literal("read_only"),
    mutation: z.literal("none"),
    localDecoder: z.literal("bounded_diagnostic_only"),
    diagnosticPreview: z.literal("local_evidence_only"),
    processingReadiness: z.literal("not_established"),
    reconstruction: z.literal("none"),
    admission: z.literal("not_evaluated"),
    routeCompilation: z.literal("none"),
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
  z.literal(FOUNDRY_SOURCE_READINESS_MAP_V8_LIMITATIONS[0]),
  z.literal(FOUNDRY_SOURCE_READINESS_MAP_V8_LIMITATIONS[1]),
  z.literal(FOUNDRY_SOURCE_READINESS_MAP_V8_LIMITATIONS[2]),
  z.literal(FOUNDRY_SOURCE_READINESS_MAP_V8_LIMITATIONS[3]),
  z.literal(FOUNDRY_SOURCE_READINESS_MAP_V8_LIMITATIONS[4]),
  z.literal(FOUNDRY_SOURCE_READINESS_MAP_V8_LIMITATIONS[5]),
]);

const ArtifactBaseSchema = z
  .object({
    schemaVersion: z.literal(FOUNDRY_SOURCE_READINESS_MAP_V8),
    meaning: z.literal(FOUNDRY_SOURCE_READINESS_MAP_V8_MEANING),
    basis: z.literal(FOUNDRY_SOURCE_READINESS_MAP_V8_BASIS),
    disclaimer: z.literal(FOUNDRY_SOURCE_READINESS_MAP_V8_DISCLAIMER),
    receiptSha256: z.string().regex(SHA256_HEX),
    sourceFactsSha256: z.string().regex(SHA256_HEX),
    inheritedReadinessSha256: z.string().regex(SHA256_HEX),
    inherited: FoundrySourceReadinessMapV7Schema,
    policy: PolicySchema,
    limitations: LimitationsSchema,
    summary: SummarySchema,
    pointValueRefinements: z.array(
      FoundryPotreeV2PointValueReadinessRefinementV8Schema,
    ),
    readinessSha256: z.string().regex(SHA256_HEX),
  })
  .strict();

const AvailableArtifactSchema = ArtifactBaseSchema.extend({
  state: z.literal("available"),
}).strict();

const BlockedArtifactSchema = ArtifactBaseSchema.extend({
  state: z.literal("blocked"),
  pointValueRefinements: z.tuple([]),
}).strict();

type ArtifactWithoutValidation =
  | z.infer<typeof AvailableArtifactSchema>
  | z.infer<typeof BlockedArtifactSchema>;

type ArtifactPayload = ArtifactWithoutValidation extends infer Artifact
  ? Artifact extends ArtifactWithoutValidation
    ? Omit<Artifact, "readinessSha256">
    : never
  : never;

export type FoundrySourceReadinessMapV8 = ArtifactWithoutValidation;
export const FoundrySourceReadinessMapV8Schema:
  z.ZodType<FoundrySourceReadinessMapV8> = z
  .discriminatedUnion("state", [AvailableArtifactSchema, BlockedArtifactSchema])
  .superRefine(validateArtifact);

const POLICY: z.infer<typeof PolicySchema> = {
  sourceAccess: "read_only",
  mutation: "none",
  localDecoder: "bounded_diagnostic_only",
  diagnosticPreview: "local_evidence_only",
  processingReadiness: "not_established",
  reconstruction: "none",
  admission: "not_evaluated",
  routeCompilation: "none",
  execution: "not_authorized",
  approval: "none",
  authority: "none",
  rights: "not_evaluated",
  unitsFrameCrs: "not_evaluated",
  accuracy: "not_evaluated",
  completeness: "not_evaluated",
  vendorSemantics: "not_evaluated",
};

function compareRefinements(
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

function canonicalRefinements(
  refinements: readonly FoundryPotreeV2PointValueReadinessRefinementV8[],
): FoundryPotreeV2PointValueReadinessRefinementV8[] {
  return [...refinements].sort(compareRefinements);
}

function establishedV7Bundles(
  inherited: FoundrySourceReadinessMapV7,
): readonly FoundryPotreeV2BundleAssetV7[] {
  return inherited.state === "available"
    ? inherited.potreeBundleRefinements
      .filter((refinement) => refinement.status === "facts_established")
      .map((refinement) => refinement.sourceFactsBundle)
    : [];
}

function buildRefinement(
  bundle: FoundryPotreeV2BundleAssetV7,
  evidence: FoundryPotreeV2PointValueBundleV8,
): FoundryPotreeV2PointValueReadinessRefinementV8 {
  if (
    bundle.bundleRoot !== evidence.bundleRoot ||
    bundle.bundleSha256 !== evidence.bundleSha256
  ) {
    throw new FoundryIntegrityError(
      "SOURCE_READINESS_V8_BUNDLE_BINDING_MISMATCH",
      "Source Facts V8 point-value evidence does not bind the matching V7 readiness bundle.",
    );
  }
  const established = evidence.pointValues.state === "established";
  return FoundryPotreeV2PointValueReadinessRefinementV8Schema.parse({
    laneIds: ["point_geometry"],
    status: established
      ? "decoded_values_established"
      : "decoded_values_not_established",
    diagnosticPreview: established ? "available" : "unavailable",
    processingReadiness: "not_established",
    execution: "not_authorized",
    sourceFactsBundle: bundle,
    pointValueEvidence: evidence,
    resolvedUnknownCodes: evidence.resolvedUnknownCodes,
    remainingUnknownCodes: evidence.remainingUnknownCodes,
  });
}

function summaryFor(
  inherited: FoundrySourceReadinessMapV7,
  refinements: readonly FoundryPotreeV2PointValueReadinessRefinementV8[],
): z.infer<typeof SummarySchema> {
  return {
    receiptFileCount: inherited.summary.receiptFileCount,
    inheritedState: inherited.state,
    pointValueOutcomeCount: refinements.length,
    decodedValuesEstablishedCount: refinements.filter(
      (refinement) => refinement.status === "decoded_values_established",
    ).length,
    decodedValuesNotEstablishedCount: refinements.filter(
      (refinement) => refinement.status === "decoded_values_not_established",
    ).length,
    diagnosticPreviewAvailableCount: refinements.filter(
      (refinement) => refinement.diagnosticPreview === "available",
    ).length,
    diagnosticPreviewUnavailableCount: refinements.filter(
      (refinement) => refinement.diagnosticPreview === "unavailable",
    ).length,
    affectedPotreeBundleCount: new Set(
      refinements.map((refinement) => refinement.sourceFactsBundle.bundleSha256),
    ).size,
    affectedPotreeMemberSourceCount: new Set(
      refinements.flatMap((refinement) =>
        refinement.sourceFactsBundle.members.map((member) => member.path)
      ),
    ).size,
    resolvedUnknownCount: refinements.reduce(
      (count, refinement) => count + refinement.resolvedUnknownCodes.length,
      0,
    ),
    remainingUnknownCount: refinements.reduce(
      (count, refinement) => count + refinement.remainingUnknownCodes.length,
      0,
    ),
  };
}

function artifactDigest(value: ArtifactWithoutValidation): string {
  const { readinessSha256: _readinessSha256, ...payload } = value;
  return domainSeparatedSha256(
    FOUNDRY_SOURCE_READINESS_MAP_V8_DIGEST_DOMAIN,
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
      message: "V8 receipt binding must equal the embedded V7 readiness binding",
    });
  }
  if (value.inheritedReadinessSha256 !== value.inherited.readinessSha256) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["inheritedReadinessSha256"],
      message: "V8 inherited readiness digest must match the embedded V7 map",
    });
  }
  if (value.state !== value.inherited.state) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["state"],
      message: "V8 readiness must retain the V7 available or blocked state",
    });
  }
  const canonical = canonicalRefinements(value.pointValueRefinements);
  const identities = value.pointValueRefinements.map((refinement) =>
    `${refinement.sourceFactsBundle.bundleRoot}\0${refinement.sourceFactsBundle.bundleSha256}`
  );
  if (
    JSON.stringify(value.pointValueRefinements) !== JSON.stringify(canonical) ||
    new Set(identities).size !== identities.length
  ) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["pointValueRefinements"],
      message:
        "V8 point-value readiness refinements must be unique and canonically ordered",
    });
  }
  const expectedBundles = establishedV7Bundles(value.inherited);
  if (expectedBundles.length !== value.pointValueRefinements.length) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["pointValueRefinements"],
      message:
        "V8 readiness requires one point-value refinement per V7-established bundle",
    });
  }
  for (const [index, expectedBundle] of expectedBundles.entries()) {
    const refinement = value.pointValueRefinements[index];
    if (
      refinement === undefined ||
      JSON.stringify(refinement.sourceFactsBundle) !==
        JSON.stringify(expectedBundle)
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["pointValueRefinements", index, "sourceFactsBundle"],
        message:
          "V8 readiness refinement must retain its exact V7 bundle and unknowns",
      });
    }
  }
  const expectedSummary = summaryFor(
    value.inherited,
    value.pointValueRefinements,
  );
  if (JSON.stringify(value.summary) !== JSON.stringify(expectedSummary)) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["summary"],
      message: "V8 readiness summary contradicts its immutable overlay",
    });
  }
  if (value.readinessSha256 !== artifactDigest(value)) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["readinessSha256"],
      message: "V8 readiness digest does not match the canonical payload",
    });
  }
}

function issueArtifact(
  payload: ArtifactPayload,
): FoundrySourceReadinessMapV8 {
  const candidate = {
    ...payload,
    readinessSha256: "0".repeat(64),
  } as ArtifactWithoutValidation;
  return FoundrySourceReadinessMapV8Schema.parse({
    ...payload,
    readinessSha256: artifactDigest(candidate),
  });
}

function limitations(): z.infer<typeof LimitationsSchema> {
  return [
    FOUNDRY_SOURCE_READINESS_MAP_V8_LIMITATIONS[0],
    FOUNDRY_SOURCE_READINESS_MAP_V8_LIMITATIONS[1],
    FOUNDRY_SOURCE_READINESS_MAP_V8_LIMITATIONS[2],
    FOUNDRY_SOURCE_READINESS_MAP_V8_LIMITATIONS[3],
    FOUNDRY_SOURCE_READINESS_MAP_V8_LIMITATIONS[4],
    FOUNDRY_SOURCE_READINESS_MAP_V8_LIMITATIONS[5],
  ];
}

export interface CompileFoundrySourceReadinessMapV8Input {
  readonly receipt: unknown;
  readonly sourceFacts: unknown;
}

/**
 * Recomputes and embeds the exact V7 readiness map, then adds an immutable
 * point-value diagnostic view. It authorizes no processing or execution.
 */
export function compileFoundrySourceReadinessMapV8(
  input: CompileFoundrySourceReadinessMapV8Input,
): FoundrySourceReadinessMapV8 {
  const receipt = FoundryUniversalIntakeReceiptSchema.parse(input.receipt);
  const sourceFacts = FoundryUniversalSourceFactsV8Schema.parse(
    input.sourceFacts,
  );
  const inherited = compileFoundrySourceReadinessMapV7({
    receipt,
    sourceFacts: sourceFacts.inherited,
  });
  if (sourceFacts.receiptSha256 !== receipt.receiptSha256) {
    throw new FoundryIntegrityError(
      "SOURCE_READINESS_V8_RECEIPT_BINDING_MISMATCH",
      "Source Facts V8 does not bind the supplied intake receipt.",
    );
  }
  if (
    (sourceFacts.state === "available") !==
      (inherited.state === "available")
  ) {
    throw new FoundryIntegrityError(
      "SOURCE_READINESS_V8_STATE_MISMATCH",
      "Source Facts V8 and recomputed V7 readiness disagree on availability.",
    );
  }

  const refinements = sourceFacts.state === "available"
    ? canonicalRefinements(
        sourceFacts.pointValueBundles.map((evidence) => {
          const bundle = sourceFacts.inherited.potreeBundles.find(
            (candidate) =>
              candidate.bundleRoot === evidence.bundleRoot &&
              candidate.bundleSha256 === evidence.bundleSha256,
          );
          if (bundle === undefined) {
            throw new FoundryIntegrityError(
              "SOURCE_READINESS_V8_BUNDLE_NOT_FOUND",
              "Source Facts V8 point-value evidence has no exact V7 bundle.",
            );
          }
          return buildRefinement(bundle, evidence);
        }),
      )
    : [];
  const base = {
    schemaVersion: FOUNDRY_SOURCE_READINESS_MAP_V8,
    meaning: FOUNDRY_SOURCE_READINESS_MAP_V8_MEANING,
    basis: FOUNDRY_SOURCE_READINESS_MAP_V8_BASIS,
    disclaimer: FOUNDRY_SOURCE_READINESS_MAP_V8_DISCLAIMER,
    receiptSha256: receipt.receiptSha256,
    sourceFactsSha256: sourceFacts.factsSha256,
    inheritedReadinessSha256: inherited.readinessSha256,
    inherited,
    policy: POLICY,
    limitations: limitations(),
    summary: summaryFor(inherited, refinements),
  } as const;
  return inherited.state === "available"
    ? issueArtifact({
        ...base,
        state: "available",
        pointValueRefinements: refinements,
      })
    : issueArtifact({
        ...base,
        state: "blocked",
        pointValueRefinements: [],
      });
}

export interface VerifyFoundrySourceReadinessMapV8Input
  extends CompileFoundrySourceReadinessMapV8Input {
  readonly readiness: unknown;
}

export function verifyFoundrySourceReadinessMapV8(
  input: VerifyFoundrySourceReadinessMapV8Input,
): FoundrySourceReadinessMapV8 {
  const actual = FoundrySourceReadinessMapV8Schema.parse(input.readiness);
  const expected = compileFoundrySourceReadinessMapV8(input);
  if (
    serializeFoundrySourceReadinessMapV8(actual) !==
      serializeFoundrySourceReadinessMapV8(expected)
  ) {
    throw new FoundryIntegrityError(
      "SOURCE_READINESS_V8_MISMATCH",
      "The V8 readiness artifact does not exactly match the supplied receipt and Source Facts V8 artifact.",
    );
  }
  return actual;
}

export function serializeFoundrySourceReadinessMapV8(
  value: FoundrySourceReadinessMapV8,
): string {
  return stableCanonicalJson(
    toCanonicalJson(FoundrySourceReadinessMapV8Schema.parse(value)),
  );
}
