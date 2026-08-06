import { FoundryRelativePathSchema } from "@omnitwin/types";
import { z } from "zod";
import {
  domainSeparatedSha256,
  stableCanonicalJson,
  toCanonicalJson,
} from "./canonical-json.js";
import { FoundryIntegrityError } from "./errors.js";
import {
  FoundryPotreeV2PointValuesOutcomeSchema,
  type FoundryPotreeV2PointValuesOutcome,
} from "./potree-v2-point-values.js";
import {
  FOUNDRY_POTREE_V2_UNKNOWNS,
  FoundryUniversalSourceFactsV7Schema,
  type FoundryPotreeV2BundleAssetV7,
  type FoundryUniversalSourceFactsV7,
} from "./source-facts-v7.js";

export const FOUNDRY_UNIVERSAL_SOURCE_FACTS_V8 =
  "omnitwin.foundry.universal-source-facts.v8";
export const FOUNDRY_UNIVERSAL_SOURCE_FACTS_V8_DIGEST_DOMAIN =
  "VENVIEWER_FOUNDRY_UNIVERSAL_SOURCE_FACTS_V8";
export const FOUNDRY_POTREE_POINT_VALUES_RESOLVED_UNKNOWN_CODE =
  "POTREE_POINT_ATTRIBUTE_VALUES_UNKNOWN";

export const FOUNDRY_SOURCE_FACTS_V8_LIMITATIONS = Object.freeze([
  "DECODER_COORDINATES_ARE_NUMERIC_VALUES_WITHOUT_ESTABLISHED_UNITS_FRAME_CRS_ACCURACY_OR_PHYSICAL_MEANING",
  "DETERMINISTIC_CPU_RASTERS_ARE_LOCAL_DIAGNOSTICS_NOT_OFFICIAL_VIEWER_OR_VISUAL_FIDELITY_EVIDENCE",
  "THE_OPAQUE_VENDOR_BYTE_REMAINS_SEMANTICALLY_UNKNOWN",
  "HIERARCHY_AND_DECLARED_RANGE_CHECKS_DO_NOT_ESTABLISH_GEOMETRY_COMPLETENESS_OR_FITNESS_FOR_USE",
  "DUPLICATE_CONCENTRATION_IS_AN_OBSERVATION_AND_DOES_NOT_BY_ITSELF_ESTABLISH_CORRUPTION_OR_CAUSE",
  "THE_EMBEDDED_V7_ARTIFACT_REMAINS_IMMUTABLE_AND_ONLY_THE_EXACT_DECODED_VALUE_UNKNOWN_MAY_BE_SUPERSEDED",
] as const);

const SHA256_HEX = /^[a-f0-9]{64}$/u;
const STABLE_CODE = /^[A-Z][A-Z0-9_]{2,95}$/u;
const BundleRootSchema = z.union([z.literal(""), FoundryRelativePathSchema]);

export const FoundryPotreeV2PointValueBundleV8Schema = z.object({
  bundleRoot: BundleRootSchema,
  bundleSha256: z.string().regex(SHA256_HEX),
  pointValues: FoundryPotreeV2PointValuesOutcomeSchema,
  resolvedUnknownCodes: z.array(z.string().regex(STABLE_CODE)),
  remainingUnknownCodes: z.array(z.string().regex(STABLE_CODE)),
}).strict().superRefine((overlay, ctx) => {
  if (
    overlay.pointValues.bundleRoot !== overlay.bundleRoot ||
    overlay.pointValues.bundleSha256 !== overlay.bundleSha256
  ) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["pointValues"],
      message: "Point-value evidence must retain the exact V7 bundle identity",
    });
  }
  const expectedUnknowns = expectedUnknownCodes({
    inheritedUnknownCodes: FOUNDRY_POTREE_V2_UNKNOWNS.map(
      (unknown) => unknown.code,
    ),
    established: overlay.pointValues.state === "established",
  });
  if (
    JSON.stringify(overlay.resolvedUnknownCodes) !==
      JSON.stringify(expectedUnknowns.resolved) ||
    JSON.stringify(overlay.remainingUnknownCodes) !==
      JSON.stringify(expectedUnknowns.remaining)
  ) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["resolvedUnknownCodes"],
      message:
        "Point-value unknown resolution must match the frozen V7 unknown profile",
    });
  }
});
export type FoundryPotreeV2PointValueBundleV8 = z.infer<
  typeof FoundryPotreeV2PointValueBundleV8Schema
>;

const PolicySchema = z.object({
  sourceAccess: z.literal("read_only"),
  mutation: z.literal("none"),
  reconstruction: z.literal("none"),
  decodedGeometry: z.literal("bounded_numeric_observation"),
  preview: z.literal("local_diagnostic_only"),
  networkAccess: z.literal("none"),
  externalProcess: z.literal("none"),
  authority: z.literal("none"),
  rights: z.literal("not_evaluated"),
  accuracy: z.literal("not_evaluated"),
  registration: z.literal("not_evaluated"),
}).strict();

const POLICY: z.infer<typeof PolicySchema> = {
  sourceAccess: "read_only",
  mutation: "none",
  reconstruction: "none",
  decodedGeometry: "bounded_numeric_observation",
  preview: "local_diagnostic_only",
  networkAccess: "none",
  externalProcess: "none",
  authority: "none",
  rights: "not_evaluated",
  accuracy: "not_evaluated",
  registration: "not_evaluated",
};

const LimitationsSchema = z.tuple([
  z.literal(FOUNDRY_SOURCE_FACTS_V8_LIMITATIONS[0]),
  z.literal(FOUNDRY_SOURCE_FACTS_V8_LIMITATIONS[1]),
  z.literal(FOUNDRY_SOURCE_FACTS_V8_LIMITATIONS[2]),
  z.literal(FOUNDRY_SOURCE_FACTS_V8_LIMITATIONS[3]),
  z.literal(FOUNDRY_SOURCE_FACTS_V8_LIMITATIONS[4]),
  z.literal(FOUNDRY_SOURCE_FACTS_V8_LIMITATIONS[5]),
]);

const SummarySchema = z.object({
  receiptFileCount: z.number().int().safe().nonnegative(),
  potreeBundleCount: z.number().int().safe().nonnegative(),
  structurallyEstablishedPotreeBundleCount: z.number().int().safe().nonnegative(),
  pointValueBundleCount: z.number().int().safe().nonnegative(),
  pointValueEstablishedBundleCount: z.number().int().safe().nonnegative(),
  pointValueFactsNotEstablishedBundleCount: z.number().int().safe().nonnegative(),
  decodedRecordCount: z.number().int().safe().nonnegative(),
  previewImageCount: z.number().int().safe().nonnegative(),
  qualityWarningCount: z.number().int().safe().nonnegative(),
  resolvedPotreeUnknownCount: z.number().int().safe().nonnegative(),
  remainingPotreeUnknownCount: z.number().int().safe().nonnegative(),
}).strict();

type ArtifactBase = {
  readonly schemaVersion: typeof FOUNDRY_UNIVERSAL_SOURCE_FACTS_V8;
  readonly receiptSha256: string;
  readonly inheritedFactsSha256: string;
  readonly inherited: FoundryUniversalSourceFactsV7;
  readonly policy: z.infer<typeof PolicySchema>;
  readonly limitations: z.infer<typeof LimitationsSchema>;
  readonly summary: z.infer<typeof SummarySchema>;
  readonly factsSha256: string;
};

const ArtifactBaseShape = {
  schemaVersion: z.literal(FOUNDRY_UNIVERSAL_SOURCE_FACTS_V8),
  receiptSha256: z.string().regex(SHA256_HEX),
  inheritedFactsSha256: z.string().regex(SHA256_HEX),
  inherited: FoundryUniversalSourceFactsV7Schema,
  policy: PolicySchema,
  limitations: LimitationsSchema,
  summary: SummarySchema,
  factsSha256: z.string().regex(SHA256_HEX),
} as const;

type AvailableArtifact = ArtifactBase & {
  readonly state: "available";
  readonly pointValueBundles: FoundryPotreeV2PointValueBundleV8[];
};
type UnavailableArtifact = ArtifactBase & {
  readonly state: "unavailable";
  readonly pointValueBundles: [];
};

const AvailableArtifactSchema: z.ZodType<AvailableArtifact> =
  z.object({
    ...ArtifactBaseShape,
  state: z.literal("available"),
  pointValueBundles: z.array(FoundryPotreeV2PointValueBundleV8Schema),
}).strict();

const UnavailableArtifactSchema: z.ZodType<UnavailableArtifact> =
  z.object({
    ...ArtifactBaseShape,
  state: z.literal("unavailable"),
  pointValueBundles: z.tuple([]),
}).strict();

type ArtifactWithoutValidation =
  | AvailableArtifact
  | UnavailableArtifact;

type ArtifactPayload = ArtifactWithoutValidation extends infer Artifact
  ? Artifact extends ArtifactWithoutValidation
    ? Omit<Artifact, "factsSha256">
    : never
  : never;

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function canonicalPointValueBundles(
  overlays: readonly FoundryPotreeV2PointValueBundleV8[],
): FoundryPotreeV2PointValueBundleV8[] {
  return [...overlays].sort((left, right) =>
    compareText(left.bundleRoot, right.bundleRoot) ||
    compareText(left.bundleSha256, right.bundleSha256)
  );
}

function expectedUnknownCodes(input: {
  readonly inheritedUnknownCodes: readonly string[];
  readonly established: boolean;
}): {
  readonly resolved: string[];
  readonly remaining: string[];
} {
  const canResolve = input.established && input.inheritedUnknownCodes.includes(
    FOUNDRY_POTREE_POINT_VALUES_RESOLVED_UNKNOWN_CODE,
  );
  return {
    resolved: canResolve
      ? [FOUNDRY_POTREE_POINT_VALUES_RESOLVED_UNKNOWN_CODE]
      : [],
    remaining: input.inheritedUnknownCodes.filter(
      (code) =>
        !canResolve || code !== FOUNDRY_POTREE_POINT_VALUES_RESOLVED_UNKNOWN_CODE,
    ),
  };
}

function summaryFor(
  inherited: FoundryUniversalSourceFactsV7,
  overlays: readonly FoundryPotreeV2PointValueBundleV8[],
): z.infer<typeof SummarySchema> {
  const established = overlays.filter(
    (overlay) => overlay.pointValues.state === "established",
  );
  const establishedFacts = overlays.flatMap((overlay) =>
    overlay.pointValues.state === "established"
      ? [overlay.pointValues.facts]
      : []
  );
  const resolvedByRoot = new Map(
    overlays.map((overlay) => [overlay.bundleRoot, overlay.resolvedUnknownCodes.length]),
  );
  const potreeBundles = inherited.state === "available"
    ? inherited.potreeBundles
    : [];
  return {
    receiptFileCount: inherited.summary.receiptFileCount,
    potreeBundleCount: potreeBundles.length,
    structurallyEstablishedPotreeBundleCount: potreeBundles.filter(
      (bundle) => bundle.inspection.state === "established",
    ).length,
    pointValueBundleCount: overlays.length,
    pointValueEstablishedBundleCount: established.length,
    pointValueFactsNotEstablishedBundleCount: overlays.length - established.length,
    decodedRecordCount: establishedFacts.reduce(
      (count, facts) => count + facts.recordCount,
      0,
    ),
    previewImageCount: establishedFacts.reduce(
      (count, facts) => count + facts.previews.images.length,
      0,
    ),
    qualityWarningCount: establishedFacts.reduce(
      (count, facts) => count + facts.qualityWarnings.length,
      0,
    ),
    resolvedPotreeUnknownCount: overlays.reduce(
      (count, overlay) => count + overlay.resolvedUnknownCodes.length,
      0,
    ),
    remainingPotreeUnknownCount: potreeBundles.reduce(
      (count, bundle) =>
        count + bundle.unknowns.length - (resolvedByRoot.get(bundle.bundleRoot) ?? 0),
      0,
    ),
  };
}

function artifactDigest(value: ArtifactWithoutValidation): string {
  const { factsSha256: _factsSha256, ...payload } = value;
  return domainSeparatedSha256(
    FOUNDRY_UNIVERSAL_SOURCE_FACTS_V8_DIGEST_DOMAIN,
    toCanonicalJson(payload),
  );
}

function sameNumberArray(
  left: readonly number[],
  right: readonly number[],
): boolean {
  return left.length === right.length && left.every(
    (value, index) => value === right[index],
  );
}

function pointValuesMatchV7DecodeDeclaration(input: {
  readonly overlay: FoundryPotreeV2PointValueBundleV8;
  readonly bundle: FoundryPotreeV2BundleAssetV7;
}): boolean {
  if (input.overlay.pointValues.state !== "established") return true;
  const inheritedFacts = input.bundle.facts;
  if (inheritedFacts === null) return false;
  const facts = input.overlay.pointValues.facts;
  const { declaredScale: scale, declaredOffset: offset, pointCount } =
    inheritedFacts.metadata;
  if (
    facts.recordCount !== pointCount ||
    !sameNumberArray(facts.position.toleranceByAxis, scale)
  ) {
    return false;
  }
  for (let axis = 0; axis < 3; axis += 1) {
    const axisScale = scale[axis];
    const axisOffset = offset[axis];
    const rawMin = facts.position.rawMin[axis];
    const rawMax = facts.position.rawMax[axis];
    if (
      axisScale === undefined ||
      axisOffset === undefined ||
      rawMin === undefined ||
      rawMax === undefined ||
      facts.position.decodedMin[axis] !== rawMin * axisScale + axisOffset ||
      facts.position.decodedMax[axis] !== rawMax * axisScale + axisOffset
    ) {
      return false;
    }
    if (facts.deepProfile.state === "performed") {
      const rawQuantiles =
        facts.deepProfile.rawPositionQuantilesByAxis[axis];
      const decodedQuantiles =
        facts.deepProfile.decodedPositionQuantilesByAxis[axis];
      if (
        rawQuantiles === undefined ||
        decodedQuantiles === undefined ||
        !sameNumberArray(
          decodedQuantiles,
          rawQuantiles.map((value) => value * axisScale + axisOffset),
        )
      ) {
        return false;
      }
    }
  }
  return true;
}

function validateArtifact(
  value: ArtifactWithoutValidation,
  ctx: z.RefinementCtx,
): void {
  if (
    value.receiptSha256 !== value.inherited.receiptSha256 ||
    value.inheritedFactsSha256 !== value.inherited.factsSha256 ||
    value.state !== value.inherited.state
  ) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["inherited"],
      message: "V8 state and digest bindings must match the exact embedded V7 artifact",
    });
  }
  if (
    JSON.stringify(value.policy) !== JSON.stringify(POLICY) ||
    JSON.stringify(value.limitations) !==
      JSON.stringify(FOUNDRY_SOURCE_FACTS_V8_LIMITATIONS)
  ) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["policy"],
      message: "V8 policy and limitations must match the frozen diagnostic profile",
    });
  }
  const canonical = canonicalPointValueBundles(value.pointValueBundles);
  if (
    JSON.stringify(value.pointValueBundles) !== JSON.stringify(canonical) ||
    new Set(value.pointValueBundles.map((overlay) => overlay.bundleRoot)).size !==
      value.pointValueBundles.length
  ) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["pointValueBundles"],
      message: "V8 point-value overlays must have unique, canonical bundle roots",
    });
  }
  const expectedBundles = value.inherited.state === "available"
    ? value.inherited.potreeBundles.filter(
      (bundle) => bundle.inspection.state === "established",
    )
    : [];
  if (expectedBundles.length !== value.pointValueBundles.length) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["pointValueBundles"],
      message: "V8 requires exactly one point-value outcome for each V7-established bundle",
    });
  }
  for (const [index, bundle] of expectedBundles.entries()) {
    const overlay = value.pointValueBundles[index];
    if (
      overlay === undefined ||
      overlay.bundleRoot !== bundle.bundleRoot ||
      overlay.bundleSha256 !== bundle.bundleSha256
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["pointValueBundles", index],
        message: "A V8 overlay does not bind the exact canonically ordered V7 bundle",
      });
      continue;
    }
    if (!pointValuesMatchV7DecodeDeclaration({ overlay, bundle })) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["pointValueBundles", index, "pointValues", "facts"],
        message:
          "Decoded extrema, quantiles, tolerance, and record count must be derived exactly from the embedded V7 metadata declaration",
      });
    }
    const expectedUnknowns = expectedUnknownCodes({
      inheritedUnknownCodes: bundle.unknowns.map((unknown) => unknown.code),
      established: overlay.pointValues.state === "established",
    });
    if (
      JSON.stringify(overlay.resolvedUnknownCodes) !==
        JSON.stringify(expectedUnknowns.resolved) ||
      JSON.stringify(overlay.remainingUnknownCodes) !==
        JSON.stringify(expectedUnknowns.remaining)
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["pointValueBundles", index, "resolvedUnknownCodes"],
        message: "V8 unknown resolution must be derived exactly from V7 and the decode outcome",
      });
    }
  }
  const expectedSummary = summaryFor(value.inherited, value.pointValueBundles);
  if (JSON.stringify(value.summary) !== JSON.stringify(expectedSummary)) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["summary"],
      message: "V8 summary contradicts the immutable V7 and point-value overlays",
    });
  }
  if (value.factsSha256 !== artifactDigest(value)) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["factsSha256"],
      message: "V8 facts digest does not match the canonical wrapper payload",
    });
  }
}

export type FoundryUniversalSourceFactsV8 = ArtifactWithoutValidation;
export const FoundryUniversalSourceFactsV8Schema:
  z.ZodType<FoundryUniversalSourceFactsV8> = z
  .union([AvailableArtifactSchema, UnavailableArtifactSchema])
  .superRefine(validateArtifact);

function issueArtifact(payload: ArtifactPayload): FoundryUniversalSourceFactsV8 {
  const candidate = {
    ...payload,
    factsSha256: "0".repeat(64),
  } as ArtifactWithoutValidation;
  return FoundryUniversalSourceFactsV8Schema.parse({
    ...payload,
    factsSha256: artifactDigest(candidate),
  });
}

function limitations(): z.infer<typeof LimitationsSchema> {
  return [
    FOUNDRY_SOURCE_FACTS_V8_LIMITATIONS[0],
    FOUNDRY_SOURCE_FACTS_V8_LIMITATIONS[1],
    FOUNDRY_SOURCE_FACTS_V8_LIMITATIONS[2],
    FOUNDRY_SOURCE_FACTS_V8_LIMITATIONS[3],
    FOUNDRY_SOURCE_FACTS_V8_LIMITATIONS[4],
    FOUNDRY_SOURCE_FACTS_V8_LIMITATIONS[5],
  ];
}

/**
 * Retains an exact V7 artifact and adds one bounded point-value outcome for
 * each exact V7-established Potree bundle. Raw preview bytes stay outside this
 * immutable artifact; only their digest-bound manifests are retained.
 */
export function createUniversalSourceFactsV8ArtifactFromV7(
  inheritedInput: FoundryUniversalSourceFactsV7,
  outcomeInputs: readonly FoundryPotreeV2PointValuesOutcome[] = [],
): FoundryUniversalSourceFactsV8 {
  const inherited = FoundryUniversalSourceFactsV7Schema.parse(inheritedInput);
  const outcomes = outcomeInputs
    .map((outcome) => FoundryPotreeV2PointValuesOutcomeSchema.parse(outcome))
    .sort((left, right) =>
      compareText(left.bundleRoot, right.bundleRoot) ||
      compareText(left.bundleSha256, right.bundleSha256)
    );
  if (inherited.state === "unavailable") {
    if (outcomes.length > 0) {
      throw new FoundryIntegrityError(
        "SOURCE_FACTS_V8_PARTIAL_EVIDENCE_FORBIDDEN",
        "V8 cannot attach point-value evidence when the embedded V7 artifact is unavailable.",
      );
    }
    const overlays: FoundryPotreeV2PointValueBundleV8[] = [];
    return issueArtifact({
      schemaVersion: FOUNDRY_UNIVERSAL_SOURCE_FACTS_V8,
      receiptSha256: inherited.receiptSha256,
      inheritedFactsSha256: inherited.factsSha256,
      state: "unavailable",
      inherited,
      policy: POLICY,
      limitations: limitations(),
      summary: summaryFor(inherited, overlays),
      pointValueBundles: [],
    });
  }

  const expected = inherited.potreeBundles.filter(
    (bundle) => bundle.inspection.state === "established",
  );
  if (outcomes.length !== expected.length) {
    throw new FoundryIntegrityError(
      "SOURCE_FACTS_V8_POINT_VALUE_RESULT_SET_INCOMPLETE",
      "V8 requires one point-value outcome for every V7-established bundle.",
    );
  }
  const overlays = expected.map((bundle, index) => {
    const outcome = outcomes[index];
    if (
      outcome === undefined ||
      outcome.bundleRoot !== bundle.bundleRoot ||
      outcome.bundleSha256 !== bundle.bundleSha256
    ) {
      throw new FoundryIntegrityError(
        "SOURCE_FACTS_V8_POINT_VALUE_BINDING_MISMATCH",
        "A V8 point-value outcome does not match its exact V7 bundle identity.",
      );
    }
    const unknowns = expectedUnknownCodes({
      inheritedUnknownCodes: bundle.unknowns.map((unknown) => unknown.code),
      established: outcome.state === "established",
    });
    return FoundryPotreeV2PointValueBundleV8Schema.parse({
      bundleRoot: bundle.bundleRoot,
      bundleSha256: bundle.bundleSha256,
      pointValues: outcome,
      resolvedUnknownCodes: unknowns.resolved,
      remainingUnknownCodes: unknowns.remaining,
    });
  });
  return issueArtifact({
    schemaVersion: FOUNDRY_UNIVERSAL_SOURCE_FACTS_V8,
    receiptSha256: inherited.receiptSha256,
    inheritedFactsSha256: inherited.factsSha256,
    state: "available",
    inherited,
    policy: POLICY,
    limitations: limitations(),
    summary: summaryFor(inherited, overlays),
    pointValueBundles: overlays,
  });
}

export function serializeUniversalSourceFactsV8Artifact(
  value: FoundryUniversalSourceFactsV8,
): string {
  return stableCanonicalJson(
    toCanonicalJson(FoundryUniversalSourceFactsV8Schema.parse(value)),
  );
}

if (
  FOUNDRY_POTREE_V2_UNKNOWNS[0].code !==
    FOUNDRY_POTREE_POINT_VALUES_RESOLVED_UNKNOWN_CODE
) {
  throw new Error("The frozen V8 resolved unknown no longer matches V7.");
}
