import {
  FoundryInputTypeSchema,
  FoundryRelativePathSchema,
} from "@omnitwin/types";
import { z } from "zod";
import {
  FOUNDRY_POINT_PLY_SOURCE_FACTS_LIMITATIONS,
  FoundryPlyPointCloudSourceFactsOutcomeSchema,
  type FoundryPlyPointCloudSourceFactsOutcome,
} from "./ply-point-cloud-source-facts.js";
import {
  domainSeparatedSha256,
  stableCanonicalJson,
  toCanonicalJson,
} from "./canonical-json.js";
import { FoundryIntegrityError } from "./errors.js";
import { FOUNDRY_SOURCE_FACTS_MAX_RECEIPT_FILES } from "./source-facts.js";
import {
  FoundryUniversalSourceFactsV5Schema,
  UniversalSourceFactsV5ReceiptFileIdentitySchema,
  type FoundryUniversalSourceFactsV5,
  type UniversalSourceFactsV5ReceiptFileIdentity,
} from "./source-facts-v5.js";

export const FOUNDRY_UNIVERSAL_SOURCE_FACTS_V6 =
  "omnitwin.foundry.universal-source-facts.v6";
export const FOUNDRY_UNIVERSAL_SOURCE_FACTS_V6_DIGEST_DOMAIN =
  "VENVIEWER_FOUNDRY_UNIVERSAL_SOURCE_FACTS_V6";
export const FOUNDRY_SOURCE_FACTS_V6_RECEIPT_IDENTITY_SET_DIGEST_DOMAIN =
  "VENVIEWER_FOUNDRY_SOURCE_FACTS_V6_RECEIPT_IDENTITY_SET";

const SHA256_HEX = /^[a-f0-9]{64}$/u;

export const FOUNDRY_SOURCE_FACTS_V6_LIMITATIONS = Object.freeze([
  ...FOUNDRY_POINT_PLY_SOURCE_FACTS_LIMITATIONS,
  "POINT_PLY_REFINEMENT_EXCLUDES_RECOGNIZED_MESH_CLASSIC_GAUSSIAN_AND_PLAYCANVAS_PACKED_PROFILES_OTHER_GAUSSIAN_VARIANTS_REQUIRE_REVIEW",
  "POINT_PLY_REFINEMENT_DOES_NOT_DECODE_COORDINATES_OR_ESTABLISH_METRIC_AUTHORITY",
  "POINT_PLY_REFINEMENT_DOES_NOT_CLASSIFY_OR_REMOVE_CAPTURED_MOVABLE_OBJECTS",
  "RECEIPT_IDENTITY_MEMBERSHIP_REQUIRES_VERIFICATION_AGAINST_THE_FULL_SELF_DIGESTED_INTAKE_RECEIPT",
] as const);

export const FOUNDRY_POINT_PLY_NEXT_ACTIONS = Object.freeze([
  "Bind the exact source digest to authoritative units, axes, handedness, origin, and capture lineage.",
  "Run a separately reviewed bounded decoder to establish finite coordinate values, bounds, density, and completeness.",
  "Register the decoded points against independent venue control and review the residual evidence.",
  "Classify captured movable objects and exclude them from placement, measurement, collision, and export authority.",
  "Record a purpose-scoped rights decision before transformation, model use, packaging, or publication.",
] as const);

const PointPlySourceSchema = z
  .object({
    path: FoundryRelativePathSchema,
    sizeBytes: z.number().int().safe().nonnegative(),
    sha256: z.string().regex(SHA256_HEX),
    receiptCandidateInputTypes: z.array(FoundryInputTypeSchema).min(1).max(16),
  })
  .strict()
  .superRefine((source, ctx) => {
    if (!source.receiptCandidateInputTypes.includes("ply_point_cloud")) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["receiptCandidateInputTypes"],
        message:
          "Point PLY refinements require a receipt-bound ply_point_cloud candidate",
      });
    }
    const sorted = [...source.receiptCandidateInputTypes].sort(compareText);
    if (
      new Set(source.receiptCandidateInputTypes).size !==
        source.receiptCandidateInputTypes.length ||
      source.receiptCandidateInputTypes.some(
        (value, index) => value !== sorted[index],
      )
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["receiptCandidateInputTypes"],
        message: "Receipt candidate input types must be unique and sorted",
      });
    }
  });

export const FoundryPointPlySourceFactsRefinementV6Schema = z
  .object({
    source: PointPlySourceSchema,
    outcome: FoundryPlyPointCloudSourceFactsOutcomeSchema,
    nextActions: z.tuple([
      z.literal(FOUNDRY_POINT_PLY_NEXT_ACTIONS[0]),
      z.literal(FOUNDRY_POINT_PLY_NEXT_ACTIONS[1]),
      z.literal(FOUNDRY_POINT_PLY_NEXT_ACTIONS[2]),
      z.literal(FOUNDRY_POINT_PLY_NEXT_ACTIONS[3]),
      z.literal(FOUNDRY_POINT_PLY_NEXT_ACTIONS[4]),
    ]),
    authority: z.literal("none"),
  })
  .strict()
  .superRefine((refinement, ctx) => {
    if (
      refinement.outcome.sourceSha256 !== refinement.source.sha256 ||
      refinement.outcome.sourceSizeBytes !== refinement.source.sizeBytes
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["outcome"],
        message: "Point PLY outcome must match its exact receipt-bound source",
      });
    }
    if (
      refinement.outcome.state === "facts_not_established" &&
      refinement.outcome.category === "cancelled"
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["outcome", "category"],
        message: "A cancelled point PLY inspection cannot issue Source Facts",
      });
    }
  });
export type FoundryPointPlySourceFactsRefinementV6 = z.infer<
  typeof FoundryPointPlySourceFactsRefinementV6Schema
>;

const SummarySchema = z
  .object({
    receiptFileCount: z
      .number()
      .int()
      .min(0)
      .max(FOUNDRY_SOURCE_FACTS_MAX_RECEIPT_FILES),
    targetedPointPlyCount: z
      .number()
      .int()
      .min(0)
      .max(FOUNDRY_SOURCE_FACTS_MAX_RECEIPT_FILES),
    establishedPointPlyCount: z
      .number()
      .int()
      .min(0)
      .max(FOUNDRY_SOURCE_FACTS_MAX_RECEIPT_FILES),
    factsNotEstablishedPointPlyCount: z
      .number()
      .int()
      .min(0)
      .max(FOUNDRY_SOURCE_FACTS_MAX_RECEIPT_FILES),
  })
  .strict();

const ArtifactObjectSchema = z
  .object({
    schemaVersion: z.literal(FOUNDRY_UNIVERSAL_SOURCE_FACTS_V6),
    state: z.enum(["available", "unavailable"]),
    receiptSha256: z.string().regex(SHA256_HEX),
    baseFactsV5Sha256: z.string().regex(SHA256_HEX),
    baseFactsV5: FoundryUniversalSourceFactsV5Schema,
    receiptFileIdentities: z
      .array(UniversalSourceFactsV5ReceiptFileIdentitySchema)
      .max(FOUNDRY_SOURCE_FACTS_MAX_RECEIPT_FILES),
    receiptIdentitySetSha256: z.string().regex(SHA256_HEX),
    pointCloudPlyRefinements: z
      .array(FoundryPointPlySourceFactsRefinementV6Schema)
      .max(FOUNDRY_SOURCE_FACTS_MAX_RECEIPT_FILES),
    summary: SummarySchema,
    limitations: z.tuple([
      z.literal(FOUNDRY_SOURCE_FACTS_V6_LIMITATIONS[0]),
      z.literal(FOUNDRY_SOURCE_FACTS_V6_LIMITATIONS[1]),
      z.literal(FOUNDRY_SOURCE_FACTS_V6_LIMITATIONS[2]),
      z.literal(FOUNDRY_SOURCE_FACTS_V6_LIMITATIONS[3]),
      z.literal(FOUNDRY_SOURCE_FACTS_V6_LIMITATIONS[4]),
      z.literal(FOUNDRY_SOURCE_FACTS_V6_LIMITATIONS[5]),
      z.literal(FOUNDRY_SOURCE_FACTS_V6_LIMITATIONS[6]),
      z.literal(FOUNDRY_SOURCE_FACTS_V6_LIMITATIONS[7]),
      z.literal(FOUNDRY_SOURCE_FACTS_V6_LIMITATIONS[8]),
    ]),
    policy: z
      .object({
        sourceAccess: z.literal("read_only"),
        mutation: z.literal("none"),
        reconstruction: z.literal("none"),
        networkAccess: z.literal("none"),
        pointCloudInspection: z.literal(
          "bounded_header_and_exact_payload_extent",
        ),
        rights: z.literal("not_evaluated"),
        authority: z.literal("none"),
        receiptMembership: z.literal("requires_full_receipt_pair_verification"),
      })
      .strict(),
    factsSha256: z.string().regex(SHA256_HEX),
  })
  .strict();

type ArtifactObject = z.infer<typeof ArtifactObjectSchema>;
type ArtifactPayload = Omit<ArtifactObject, "factsSha256">;

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function artifactDigest(value: ArtifactObject): string {
  const { factsSha256: _factsSha256, ...payload } = value;
  return domainSeparatedSha256(
    FOUNDRY_UNIVERSAL_SOURCE_FACTS_V6_DIGEST_DOMAIN,
    toCanonicalJson(payload),
  );
}

function receiptIdentitySetDigest(
  identities: readonly UniversalSourceFactsV5ReceiptFileIdentity[],
): string {
  return domainSeparatedSha256(
    FOUNDRY_SOURCE_FACTS_V6_RECEIPT_IDENTITY_SET_DIGEST_DOMAIN,
    toCanonicalJson(identities),
  );
}

function validateArtifact(value: ArtifactObject, ctx: z.RefinementCtx): void {
  if (
    value.state !== value.baseFactsV5.state ||
    value.receiptSha256 !== value.baseFactsV5.receiptSha256 ||
    value.baseFactsV5Sha256 !== value.baseFactsV5.factsSha256
  ) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["baseFactsV5"],
      message: "V6 must preserve the exact V5 receipt, state, and digest",
    });
  }
  const identityPaths = value.receiptFileIdentities.map(
    (identity) => identity.path,
  );
  const sortedIdentityPaths = [...identityPaths].sort(compareText);
  if (
    new Set(identityPaths).size !== identityPaths.length ||
    identityPaths.some((path, index) => path !== sortedIdentityPaths[index])
  ) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["receiptFileIdentities"],
      message: "Receipt file identities must be unique and sorted by path",
    });
  }
  if (
    value.receiptFileIdentities.length !==
      value.baseFactsV5.summary.receiptFileCount ||
    value.receiptIdentitySetSha256 !==
      receiptIdentitySetDigest(value.receiptFileIdentities)
  ) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["receiptIdentitySetSha256"],
      message:
        "V6 must bind the complete canonical receipt identity set retained by this artifact",
    });
  }
  const paths = value.pointCloudPlyRefinements.map(
    (refinement) => refinement.source.path,
  );
  const sortedPaths = [...paths].sort(compareText);
  if (
    new Set(paths).size !== paths.length ||
    paths.some((path, index) => path !== sortedPaths[index])
  ) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["pointCloudPlyRefinements"],
      message: "Point PLY refinement paths must be unique and sorted",
    });
  }
  if (
    value.state === "unavailable" &&
    value.pointCloudPlyRefinements.length !== 0
  ) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["pointCloudPlyRefinements"],
      message:
        "An atomically unavailable V5 receipt cannot carry partial V6 refinements",
    });
  }
  if (value.state === "available") {
    const receiptIdentities = new Map(
      value.receiptFileIdentities.map(
        (identity) => [identity.path, identity] as const,
      ),
    );
    const expectedTargetPaths = value.receiptFileIdentities
      .filter(hasPointPlyCandidate)
      .map((identity) => identity.path);
    if (
      expectedTargetPaths.length !== paths.length ||
      expectedTargetPaths.some((path, index) => path !== paths[index])
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["pointCloudPlyRefinements"],
        message:
          "V6 must retain exactly one refinement for every receipt identity classified as point-cloud PLY",
      });
    }
    const baseAssets = new Map(
      value.baseFactsV5.assets.map(
        (asset) => [asset.source.path, asset] as const,
      ),
    );
    for (const [
      index,
      refinement,
    ] of value.pointCloudPlyRefinements.entries()) {
      const baseAsset = baseAssets.get(refinement.source.path);
      const receiptIdentity = receiptIdentities.get(refinement.source.path);
      if (
        receiptIdentity === undefined ||
        receiptIdentity.sizeBytes !== refinement.source.sizeBytes ||
        receiptIdentity.sha256 !== refinement.source.sha256 ||
        JSON.stringify(
          receiptIdentity.detection.candidates
            .map((candidate) => candidate.inputType)
            .filter(
              (value, candidateIndex, values) =>
                values.indexOf(value) === candidateIndex,
            )
            .sort(compareText),
        ) !== JSON.stringify(refinement.source.receiptCandidateInputTypes)
      ) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["pointCloudPlyRefinements", index, "source"],
          message:
            "Point PLY refinement must match an exact retained receipt identity and its detector candidates",
        });
      }
      if (
        baseAsset !== undefined &&
        (baseAsset.source.sizeBytes !== refinement.source.sizeBytes ||
          baseAsset.source.sha256 !== refinement.source.sha256)
      ) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["pointCloudPlyRefinements", index, "source"],
          message: "Point PLY refinement must match an exact V5 source asset",
        });
      }
      if (
        baseAsset?.format === "gaussian_ply" &&
        baseAsset.inspection.state === "established" &&
        refinement.outcome.state === "established"
      ) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["pointCloudPlyRefinements", index, "outcome"],
          message:
            "One PLY source cannot be established as both Gaussian and ordinary point geometry",
        });
      }
    }
  }
  const established = value.pointCloudPlyRefinements.filter(
    (refinement) => refinement.outcome.state === "established",
  ).length;
  const expectedSummary = {
    receiptFileCount: value.baseFactsV5.summary.receiptFileCount,
    targetedPointPlyCount: value.pointCloudPlyRefinements.length,
    establishedPointPlyCount: established,
    factsNotEstablishedPointPlyCount:
      value.pointCloudPlyRefinements.length - established,
  };
  if (JSON.stringify(value.summary) !== JSON.stringify(expectedSummary)) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["summary"],
      message: "V6 summary contradicts its exact refinements",
    });
  }
  if (value.factsSha256 !== artifactDigest(value)) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["factsSha256"],
      message: "V6 facts digest does not match the canonical payload",
    });
  }
}

export const FoundryUniversalSourceFactsV6Schema =
  ArtifactObjectSchema.superRefine(validateArtifact);
export type FoundryUniversalSourceFactsV6 = z.infer<
  typeof FoundryUniversalSourceFactsV6Schema
>;

export interface FoundryPointPlyRefinementInputV6 {
  readonly path: string;
  readonly outcome: FoundryPlyPointCloudSourceFactsOutcome;
}

function issueArtifact(
  payload: ArtifactPayload,
): FoundryUniversalSourceFactsV6 {
  const placeholder: ArtifactObject = {
    ...payload,
    factsSha256: "0".repeat(64),
  };
  return FoundryUniversalSourceFactsV6Schema.parse({
    ...payload,
    factsSha256: artifactDigest(placeholder),
  });
}

function hasPointPlyCandidate(
  identity: UniversalSourceFactsV5ReceiptFileIdentity,
): boolean {
  return identity.detection.candidates.some(
    (candidate) => candidate.inputType === "ply_point_cloud",
  );
}

export function createUniversalSourceFactsV6ArtifactFromV5(
  baseFactsInput: FoundryUniversalSourceFactsV5,
  identityInputs: readonly UniversalSourceFactsV5ReceiptFileIdentity[],
  refinementInputs: readonly FoundryPointPlyRefinementInputV6[],
): FoundryUniversalSourceFactsV6 {
  const baseFactsV5 = FoundryUniversalSourceFactsV5Schema.parse(baseFactsInput);
  const identities = identityInputs
    .map((identity) =>
      UniversalSourceFactsV5ReceiptFileIdentitySchema.parse(identity),
    )
    .sort((left, right) => compareText(left.path, right.path));
  if (
    identities.length !== baseFactsV5.summary.receiptFileCount ||
    new Set(identities.map((identity) => identity.path)).size !==
      identities.length
  ) {
    throw new FoundryIntegrityError(
      "SOURCE_FACTS_V6_RECEIPT_SET_MISMATCH",
      "Source Facts V6 requires the exact unique V5 receipt identity set.",
    );
  }

  const expectedTargets =
    baseFactsV5.state === "available"
      ? identities.filter(hasPointPlyCandidate)
      : [];
  const refinementsByPath = new Map<
    string,
    FoundryPlyPointCloudSourceFactsOutcome
  >();
  for (const input of refinementInputs) {
    if (refinementsByPath.has(input.path)) {
      throw new FoundryIntegrityError(
        "SOURCE_FACTS_V6_DUPLICATE_REFINEMENT_PATH",
        `Point PLY refinement path is duplicated: ${input.path}`,
      );
    }
    refinementsByPath.set(
      input.path,
      FoundryPlyPointCloudSourceFactsOutcomeSchema.parse(input.outcome),
    );
  }
  if (
    refinementsByPath.size !== expectedTargets.length ||
    expectedTargets.some((identity) => !refinementsByPath.has(identity.path))
  ) {
    throw new FoundryIntegrityError(
      "SOURCE_FACTS_V6_REFINEMENT_SET_MISMATCH",
      "Source Facts V6 requires one point PLY refinement for every receipt-bound point-cloud PLY candidate and no others.",
    );
  }

  const pointCloudPlyRefinements = expectedTargets.map((identity) => {
    const outcome = refinementsByPath.get(identity.path);
    if (outcome === undefined) {
      throw new FoundryIntegrityError(
        "SOURCE_FACTS_V6_REFINEMENT_SET_MISMATCH",
        `Point PLY refinement is missing: ${identity.path}`,
      );
    }
    if (
      outcome.sourceSha256 !== identity.sha256 ||
      outcome.sourceSizeBytes !== identity.sizeBytes
    ) {
      throw new FoundryIntegrityError(
        "SOURCE_FACTS_V6_REFINEMENT_SOURCE_MISMATCH",
        `Point PLY refinement does not match receipt bytes: ${identity.path}`,
      );
    }
    if (
      outcome.state === "facts_not_established" &&
      outcome.category === "cancelled"
    ) {
      throw new FoundryIntegrityError(
        "SOURCE_FACTS_V6_INSPECTION_CANCELLED",
        "A cancelled point PLY inspection cannot issue a V6 artifact.",
      );
    }
    const receiptCandidateInputTypes = [
      ...new Set(
        identity.detection.candidates.map((candidate) => candidate.inputType),
      ),
    ].sort(compareText);
    return FoundryPointPlySourceFactsRefinementV6Schema.parse({
      source: {
        path: identity.path,
        sizeBytes: identity.sizeBytes,
        sha256: identity.sha256,
        receiptCandidateInputTypes,
      },
      outcome,
      nextActions: [...FOUNDRY_POINT_PLY_NEXT_ACTIONS],
      authority: "none",
    });
  });
  const established = pointCloudPlyRefinements.filter(
    (refinement) => refinement.outcome.state === "established",
  ).length;
  return issueArtifact({
    schemaVersion: FOUNDRY_UNIVERSAL_SOURCE_FACTS_V6,
    state: baseFactsV5.state,
    receiptSha256: baseFactsV5.receiptSha256,
    baseFactsV5Sha256: baseFactsV5.factsSha256,
    baseFactsV5,
    receiptFileIdentities: identities,
    receiptIdentitySetSha256: receiptIdentitySetDigest(identities),
    pointCloudPlyRefinements,
    summary: {
      receiptFileCount: baseFactsV5.summary.receiptFileCount,
      targetedPointPlyCount: pointCloudPlyRefinements.length,
      establishedPointPlyCount: established,
      factsNotEstablishedPointPlyCount:
        pointCloudPlyRefinements.length - established,
    },
    limitations: [...FOUNDRY_SOURCE_FACTS_V6_LIMITATIONS],
    policy: {
      sourceAccess: "read_only",
      mutation: "none",
      reconstruction: "none",
      networkAccess: "none",
      pointCloudInspection: "bounded_header_and_exact_payload_extent",
      rights: "not_evaluated",
      authority: "none",
      receiptMembership: "requires_full_receipt_pair_verification",
    },
  });
}

export function serializeUniversalSourceFactsV6Artifact(
  value: FoundryUniversalSourceFactsV6,
): string {
  return stableCanonicalJson(
    toCanonicalJson(FoundryUniversalSourceFactsV6Schema.parse(value)),
  );
}
