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
  FoundryUniversalIntakeReceiptSchema,
} from "./intake-receipt.js";
import {
  FoundryPotreeV2BundleAssetV7Schema,
  FoundryUniversalSourceFactsV7Schema,
} from "./source-facts-v7.js";
import {
  FoundrySourceReadinessMapV6Schema,
  compileFoundrySourceReadinessMapV6,
  type FoundrySourceReadinessMapV6,
} from "./source-readiness-v6.js";

export const FOUNDRY_SOURCE_READINESS_MAP_V7 =
  "omnitwin.foundry.source-readiness-map.v7";
export const FOUNDRY_SOURCE_READINESS_MAP_V7_DIGEST_DOMAIN =
  "VENVIEWER_FOUNDRY_SOURCE_READINESS_MAP_V7";
export const FOUNDRY_SOURCE_READINESS_MAP_V7_MEANING =
  "immutable_v6_source_readiness_with_potree_v2_bundle_refinements";
export const FOUNDRY_SOURCE_READINESS_MAP_V7_BASIS =
  "exact_intake_receipt_and_universal_source_facts_v7";
export const FOUNDRY_SOURCE_READINESS_MAP_V7_DISCLAIMER =
  "This artifact preserves the exact V6 readiness map and adds bounded Potree v2 bundle format refinements only; it is not processing readiness, registration, accuracy, rights, approval, or execution authorization.";
export const FOUNDRY_SOURCE_READINESS_MAP_V7_LIMITATIONS = [
  "POTREE_FORMAT_FACTS_ARE_NOT_PROCESSING_READINESS",
  "POTREE_PREVIEW_IS_NOT_RAW_CAPTURE_OR_INDEPENDENT_CONTROL",
  "INHERITED_V6_EVIDENCE_REMAINS_IMMUTABLE",
  "SUPERSESSION_IS_PATH_SPECIFIC_AND_VIEW_ONLY",
  "FAILED_BUNDLE_INSPECTIONS_ESTABLISH_NO_PARTIAL_FACTS",
] as const;

const SHA256_HEX = /^[a-f0-9]{64}$/u;

const InheritedFileStatusSchema = z.enum([
  "facts_established",
  "facts_not_established",
  "outside_source_facts_v6",
  "ambiguous_format",
  "unclassified_format",
]);
type InheritedFileStatus = z.infer<typeof InheritedFileStatusSchema>;

const RefinedFileStatusSchema = z.enum([
  "facts_established",
  "facts_not_established",
]);
type RefinedFileStatus = z.infer<typeof RefinedFileStatusSchema>;

const SupersededGenericGapCodeSchema = z.enum([
  "AMBIGUOUS_FORMAT",
  "OUTSIDE_SOURCE_FACTS_V6",
  "SOURCE_FACTS_NOT_ESTABLISHED",
  "UNCLASSIFIED_FORMAT",
]);
type SupersededGenericGapCode = z.infer<
  typeof SupersededGenericGapCodeSchema
>;

const SupersededInheritedEvidenceSchema = z
  .object({
    path: FoundryRelativePathSchema,
    inheritedStatus: InheritedFileStatusSchema.exclude(["facts_established"]),
    inheritedGapCode: SupersededGenericGapCodeSchema,
    refinedStatus: RefinedFileStatusSchema,
  })
  .strict();
type SupersededInheritedEvidence = z.infer<
  typeof SupersededInheritedEvidenceSchema
>;

const PotreeBundleRefinementSchema = z
  .object({
    laneIds: z.tuple([z.literal("point_geometry")]),
    status: RefinedFileStatusSchema,
    sourceFactsBundle: FoundryPotreeV2BundleAssetV7Schema,
    supersededInheritedEvidence: z.array(SupersededInheritedEvidenceSchema),
  })
  .strict()
  .superRefine((refinement, ctx) => {
    const expectedStatus: RefinedFileStatus =
      refinement.sourceFactsBundle.inspection.state === "established"
        ? "facts_established"
        : "facts_not_established";
    if (refinement.status !== expectedStatus) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["status"],
        message: "Potree refinement status must match its exact inspection state",
      });
    }
    if (
      !isSortedUnique(
        refinement.supersededInheritedEvidence.map((row) => row.path),
      )
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["supersededInheritedEvidence"],
        message:
          "superseded inherited evidence must have unique, canonically ordered paths",
      });
    }
    for (const [index, row] of
      refinement.supersededInheritedEvidence.entries()) {
      if (row.refinedStatus !== refinement.status) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["supersededInheritedEvidence", index, "refinedStatus"],
          message: "superseded path status must match its bundle refinement",
        });
      }
    }
  });
export type FoundryPotreeV2BundleReadinessRefinementV7 = z.infer<
  typeof PotreeBundleRefinementSchema
>;

const SummarySchema = z
  .object({
    receiptFileCount: z.number().int().nonnegative(),
    inheritedState: z.enum(["available", "blocked"]),
    potreeBundleCount: z.number().int().nonnegative(),
    potreeBundleEstablishedCount: z.number().int().nonnegative(),
    potreeBundleFactsNotEstablishedCount: z.number().int().nonnegative(),
    potreeMemberSourceCount: z.number().int().nonnegative(),
    potreeUnknownCount: z.number().int().nonnegative(),
    supersededInheritedPathCount: z.number().int().nonnegative(),
  })
  .strict();

const PolicySchema = z
  .object({
    sourceAccess: z.literal("read_only"),
    mutation: z.literal("none"),
    reconstruction: z.literal("none"),
    admission: z.literal("not_evaluated"),
    routeCompilation: z.literal("none"),
    execution: z.literal("not_authorized"),
    approval: z.literal("none"),
    authority: z.literal("none"),
    rights: z.literal("not_evaluated"),
    accuracy: z.literal("not_evaluated"),
    registration: z.literal("not_evaluated"),
  })
  .strict();

const LimitationsSchema = z.tuple([
  z.literal(FOUNDRY_SOURCE_READINESS_MAP_V7_LIMITATIONS[0]),
  z.literal(FOUNDRY_SOURCE_READINESS_MAP_V7_LIMITATIONS[1]),
  z.literal(FOUNDRY_SOURCE_READINESS_MAP_V7_LIMITATIONS[2]),
  z.literal(FOUNDRY_SOURCE_READINESS_MAP_V7_LIMITATIONS[3]),
  z.literal(FOUNDRY_SOURCE_READINESS_MAP_V7_LIMITATIONS[4]),
]);

const ArtifactBaseSchema = z
  .object({
    schemaVersion: z.literal(FOUNDRY_SOURCE_READINESS_MAP_V7),
    meaning: z.literal(FOUNDRY_SOURCE_READINESS_MAP_V7_MEANING),
    basis: z.literal(FOUNDRY_SOURCE_READINESS_MAP_V7_BASIS),
    disclaimer: z.literal(FOUNDRY_SOURCE_READINESS_MAP_V7_DISCLAIMER),
    receiptSha256: z.string().regex(SHA256_HEX),
    sourceFactsSha256: z.string().regex(SHA256_HEX),
    inheritedReadinessSha256: z.string().regex(SHA256_HEX),
    inherited: FoundrySourceReadinessMapV6Schema,
    policy: PolicySchema,
    limitations: LimitationsSchema,
    summary: SummarySchema,
    potreeBundleRefinements: z.array(PotreeBundleRefinementSchema),
    readinessSha256: z.string().regex(SHA256_HEX),
  })
  .strict();

const AvailableArtifactSchema = ArtifactBaseSchema.extend({
  state: z.literal("available"),
}).strict();

const BlockedArtifactSchema = ArtifactBaseSchema.extend({
  state: z.literal("blocked"),
  potreeBundleRefinements: z.tuple([]),
}).strict();

type ArtifactWithoutValidation =
  | z.infer<typeof AvailableArtifactSchema>
  | z.infer<typeof BlockedArtifactSchema>;

export const FoundrySourceReadinessMapV7Schema = z
  .discriminatedUnion("state", [AvailableArtifactSchema, BlockedArtifactSchema])
  .superRefine(validateArtifact);
export type FoundrySourceReadinessMapV7 = z.infer<
  typeof FoundrySourceReadinessMapV7Schema
>;

const POLICY: z.infer<typeof PolicySchema> = {
  sourceAccess: "read_only",
  mutation: "none",
  reconstruction: "none",
  admission: "not_evaluated",
  routeCompilation: "none",
  execution: "not_authorized",
  approval: "none",
  authority: "none",
  rights: "not_evaluated",
  accuracy: "not_evaluated",
  registration: "not_evaluated",
};

const GENERIC_GAP_CODE_BY_STATUS: Readonly<
  Partial<Record<InheritedFileStatus, SupersededGenericGapCode>>
> = {
  ambiguous_format: "AMBIGUOUS_FORMAT",
  facts_not_established: "SOURCE_FACTS_NOT_ESTABLISHED",
  outside_source_facts_v6: "OUTSIDE_SOURCE_FACTS_V6",
  unclassified_format: "UNCLASSIFIED_FORMAT",
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

function compareRefinements(
  left: FoundryPotreeV2BundleReadinessRefinementV7,
  right: FoundryPotreeV2BundleReadinessRefinementV7,
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
  refinements: readonly FoundryPotreeV2BundleReadinessRefinementV7[],
): FoundryPotreeV2BundleReadinessRefinementV7[] {
  return [...refinements].sort(compareRefinements);
}

function availableInheritedFiles(
  inherited: FoundrySourceReadinessMapV6,
): Extract<FoundrySourceReadinessMapV6, { readonly state: "available" }>[
  "files"
] {
  if (inherited.state !== "available") {
    throw new FoundryIntegrityError(
      "SOURCE_READINESS_V7_INHERITED_BLOCKED",
      "Potree refinements require an available inherited V6 readiness map.",
    );
  }
  return inherited.files;
}

function expectedSupersededEvidence(
  inherited: FoundrySourceReadinessMapV6,
  bundle: z.infer<typeof FoundryPotreeV2BundleAssetV7Schema>,
  refinedStatus: RefinedFileStatus,
): SupersededInheritedEvidence[] {
  const files = availableInheritedFiles(inherited);
  const byPath = new Map(files.map((file) => [file.path, file] as const));
  return bundle.members.flatMap((member) => {
    const inheritedFile = byPath.get(member.path);
    if (inheritedFile === undefined) {
      throw new FoundryIntegrityError(
        "SOURCE_READINESS_V7_MEMBER_NOT_IN_INHERITED_MAP",
        `Potree member ${member.path} is absent from inherited V6 readiness.`,
      );
    }
    if (
      inheritedFile.sizeBytes !== member.sizeBytes ||
      inheritedFile.sha256 !== member.sha256
    ) {
      throw new FoundryIntegrityError(
        "SOURCE_READINESS_V7_MEMBER_IDENTITY_MISMATCH",
        `Potree member ${member.path} contradicts inherited V6 identity.`,
      );
    }
    const gapCode = GENERIC_GAP_CODE_BY_STATUS[inheritedFile.status];
    if (gapCode === undefined) return [];
    const gap = inherited.gaps.find((candidate) => candidate.code === gapCode);
    if (gap === undefined || !gap.sourcePaths.includes(member.path)) {
      throw new FoundryIntegrityError(
        "SOURCE_READINESS_V7_GENERIC_GAP_BINDING_MISMATCH",
        `Potree member ${member.path} lacks its inherited generic gap binding.`,
      );
    }
    return [SupersededInheritedEvidenceSchema.parse({
      path: member.path,
      inheritedStatus: inheritedFile.status,
      inheritedGapCode: gapCode,
      refinedStatus,
    })];
  }).sort((left, right) => compareCanonicalStrings(left.path, right.path));
}

function buildRefinement(
  inherited: FoundrySourceReadinessMapV6,
  bundle: z.infer<typeof FoundryPotreeV2BundleAssetV7Schema>,
): FoundryPotreeV2BundleReadinessRefinementV7 {
  const status: RefinedFileStatus =
    bundle.inspection.state === "established"
      ? "facts_established"
      : "facts_not_established";
  return PotreeBundleRefinementSchema.parse({
    laneIds: ["point_geometry"],
    status,
    sourceFactsBundle: bundle,
    supersededInheritedEvidence: expectedSupersededEvidence(
      inherited,
      bundle,
      status,
    ),
  });
}

function summaryFor(
  inherited: FoundrySourceReadinessMapV6,
  refinements: readonly FoundryPotreeV2BundleReadinessRefinementV7[],
): z.infer<typeof SummarySchema> {
  return {
    receiptFileCount: inherited.summary.receiptFileCount,
    inheritedState: inherited.state,
    potreeBundleCount: refinements.length,
    potreeBundleEstablishedCount: refinements.filter(
      (refinement) => refinement.status === "facts_established",
    ).length,
    potreeBundleFactsNotEstablishedCount: refinements.filter(
      (refinement) => refinement.status === "facts_not_established",
    ).length,
    potreeMemberSourceCount: new Set(
      refinements.flatMap((refinement) =>
        refinement.sourceFactsBundle.members.map((member) => member.path)
      ),
    ).size,
    potreeUnknownCount: refinements.reduce(
      (count, refinement) =>
        count + refinement.sourceFactsBundle.unknowns.length,
      0,
    ),
    supersededInheritedPathCount: new Set(
      refinements.flatMap((refinement) =>
        refinement.supersededInheritedEvidence.map((row) => row.path)
      ),
    ).size,
  };
}

function artifactDigest(value: ArtifactWithoutValidation): string {
  const { readinessSha256: _readinessSha256, ...payload } = value;
  return domainSeparatedSha256(
    FOUNDRY_SOURCE_READINESS_MAP_V7_DIGEST_DOMAIN,
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
      message: "V7 receipt binding must equal the inherited V6 binding",
    });
  }
  if (value.inheritedReadinessSha256 !== value.inherited.readinessSha256) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["inheritedReadinessSha256"],
      message: "inherited readiness digest must match the embedded V6 artifact",
    });
  }
  if (value.state !== value.inherited.state) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["state"],
      message: "V7 must retain the inherited V6 available or XBIN-blocked state",
    });
  }
  const expectedOrder = canonicalRefinements(value.potreeBundleRefinements);
  if (
    JSON.stringify(value.potreeBundleRefinements) !==
    JSON.stringify(expectedOrder) ||
    !isSortedUnique(
      value.potreeBundleRefinements.map(
        (refinement) => refinement.sourceFactsBundle.bundleRoot,
      ),
    )
  ) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["potreeBundleRefinements"],
      message: "Potree refinements must have unique, canonically ordered roots",
    });
  }
  if (value.state === "available") {
    const memberPaths = value.potreeBundleRefinements.flatMap((refinement) =>
      refinement.sourceFactsBundle.members.map((member) => member.path)
    );
    if (new Set(memberPaths).size !== memberPaths.length) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["potreeBundleRefinements"],
        message: "a receipted member path may belong to only one Potree bundle",
      });
    }
    for (const [index, refinement] of
      value.potreeBundleRefinements.entries()) {
      let expected: SupersededInheritedEvidence[];
      try {
        expected = expectedSupersededEvidence(
          value.inherited,
          refinement.sourceFactsBundle,
          refinement.status,
        );
      } catch (error) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["potreeBundleRefinements", index],
          message: error instanceof Error
            ? error.message
            : "Potree refinement contradicts inherited V6 evidence",
        });
        continue;
      }
      if (
        JSON.stringify(refinement.supersededInheritedEvidence) !==
        JSON.stringify(expected)
      ) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: [
            "potreeBundleRefinements",
            index,
            "supersededInheritedEvidence",
          ],
          message:
            "supersession must cover only exact member paths with inherited generic statuses and gaps",
        });
      }
    }
  }
  const expectedSummary = summaryFor(
    value.inherited,
    value.potreeBundleRefinements,
  );
  if (JSON.stringify(value.summary) !== JSON.stringify(expectedSummary)) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["summary"],
      message: "V7 summary contradicts the immutable refinement overlay",
    });
  }
  if (value.readinessSha256 !== artifactDigest(value)) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["readinessSha256"],
      message: "V7 readiness digest does not match the canonical payload",
    });
  }
}

function issueArtifact(
  payload: Omit<ArtifactWithoutValidation, "readinessSha256">,
): FoundrySourceReadinessMapV7 {
  const candidate = {
    ...payload,
    readinessSha256: "0".repeat(64),
  } as ArtifactWithoutValidation;
  return FoundrySourceReadinessMapV7Schema.parse({
    ...payload,
    readinessSha256: artifactDigest(candidate),
  });
}

function limitations(): z.infer<typeof LimitationsSchema> {
  return [
    FOUNDRY_SOURCE_READINESS_MAP_V7_LIMITATIONS[0],
    FOUNDRY_SOURCE_READINESS_MAP_V7_LIMITATIONS[1],
    FOUNDRY_SOURCE_READINESS_MAP_V7_LIMITATIONS[2],
    FOUNDRY_SOURCE_READINESS_MAP_V7_LIMITATIONS[3],
    FOUNDRY_SOURCE_READINESS_MAP_V7_LIMITATIONS[4],
  ];
}

export interface CompileFoundrySourceReadinessMapV7Input {
  readonly receipt: unknown;
  readonly sourceFacts: unknown;
}

/**
 * Recomputes and embeds the exact V6 readiness artifact, then adds a bounded,
 * immutable Potree v2 bundle refinement view. It does not mutate or remove any
 * inherited file, lane, gap, or policy evidence.
 */
export function compileFoundrySourceReadinessMapV7(
  input: CompileFoundrySourceReadinessMapV7Input,
): FoundrySourceReadinessMapV7 {
  const receipt = FoundryUniversalIntakeReceiptSchema.parse(input.receipt);
  const sourceFacts = FoundryUniversalSourceFactsV7Schema.parse(
    input.sourceFacts,
  );
  const inherited = compileFoundrySourceReadinessMapV6({
    receipt,
    sourceFacts: sourceFacts.inherited,
  });
  if (sourceFacts.receiptSha256 !== receipt.receiptSha256) {
    throw new FoundryIntegrityError(
      "SOURCE_READINESS_V7_RECEIPT_BINDING_MISMATCH",
      "Source Facts V7 does not bind the supplied intake receipt.",
    );
  }
  if (
    (sourceFacts.state === "available") !==
    (inherited.state === "available")
  ) {
    throw new FoundryIntegrityError(
      "SOURCE_READINESS_V7_STATE_MISMATCH",
      "Source Facts V7 must retain the inherited V6 XBIN availability state.",
    );
  }

  const refinements = sourceFacts.state === "available"
    ? canonicalRefinements(
      sourceFacts.potreeBundles.map((bundle) =>
        buildRefinement(inherited, bundle)
      ),
    )
    : [];
  const base = {
    schemaVersion: FOUNDRY_SOURCE_READINESS_MAP_V7,
    meaning: FOUNDRY_SOURCE_READINESS_MAP_V7_MEANING,
    basis: FOUNDRY_SOURCE_READINESS_MAP_V7_BASIS,
    disclaimer: FOUNDRY_SOURCE_READINESS_MAP_V7_DISCLAIMER,
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
      potreeBundleRefinements: refinements,
    })
    : issueArtifact({
      ...base,
      state: "blocked",
      potreeBundleRefinements: [],
    });
}

export interface VerifyFoundrySourceReadinessMapV7Input
  extends CompileFoundrySourceReadinessMapV7Input {
  readonly readiness: unknown;
}

export function verifyFoundrySourceReadinessMapV7(
  input: VerifyFoundrySourceReadinessMapV7Input,
): FoundrySourceReadinessMapV7 {
  const actual = FoundrySourceReadinessMapV7Schema.parse(input.readiness);
  const expected = compileFoundrySourceReadinessMapV7(input);
  if (
    serializeFoundrySourceReadinessMapV7(actual) !==
    serializeFoundrySourceReadinessMapV7(expected)
  ) {
    throw new FoundryIntegrityError(
      "SOURCE_READINESS_V7_MISMATCH",
      "The V7 readiness artifact does not exactly match the supplied receipt and Source Facts V7 artifact.",
    );
  }
  return actual;
}

export function serializeFoundrySourceReadinessMapV7(
  value: FoundrySourceReadinessMapV7,
): string {
  return stableCanonicalJson(
    toCanonicalJson(FoundrySourceReadinessMapV7Schema.parse(value)),
  );
}
