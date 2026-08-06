import { FoundryRelativePathSchema } from "@omnitwin/types";
import { z } from "zod";
import {
  domainSeparatedSha256,
  stableCanonicalJson,
  toCanonicalJson,
} from "./canonical-json.js";
import { FoundryIntegrityError } from "./errors.js";
import {
  FoundryUniversalIntakeReceiptSchema,
  type FoundryUniversalIntakeReceipt,
} from "./intake-receipt.js";
import {
  FOUNDRY_POTREE_V2_SOURCE_FACTS_FAILURE_CATEGORY_BY_CODE,
  FoundryPotreeV2BundleFactsSchema,
  FoundryPotreeV2BundleMemberIdentitySchema,
  FoundryPotreeV2SourceFactsOutcomeSchema,
  type FoundryPotreeV2SourceFactsOutcome,
} from "./potree-v2-source-facts.js";
import {
  FOUNDRY_SOURCE_FACTS_V6_LIMITATIONS,
  FoundryUniversalSourceFactsV6Schema,
  type FoundryUniversalSourceFactsV6,
} from "./source-facts-v6.js";

export const FOUNDRY_UNIVERSAL_SOURCE_FACTS_V7 =
  "omnitwin.foundry.universal-source-facts.v7";
export const FOUNDRY_UNIVERSAL_SOURCE_FACTS_V7_DIGEST_DOMAIN =
  "VENVIEWER_FOUNDRY_UNIVERSAL_SOURCE_FACTS_V7";
export const FOUNDRY_POTREE_V2_BUNDLE_DIGEST_DOMAIN =
  "VENVIEWER_FOUNDRY_POTREE_V2_BUNDLE_V7";

export const FOUNDRY_SOURCE_FACTS_V7_LIMITATIONS = Object.freeze([
  ...FOUNDRY_SOURCE_FACTS_V6_LIMITATIONS,
  "POTREE_BUNDLE_STRUCTURE_DOES_NOT_DECODE_POINT_OR_ATTRIBUTE_VALUES",
  "POTREE_DECLARATIONS_DO_NOT_ESTABLISH_UNITS_FRAME_CRS_PHYSICAL_BOUNDS_ACCURACY_PROVENANCE_RIGHTS_FIDELITY_OR_AUTHORITY",
] as const);

const SHA256_HEX = /^[a-f0-9]{64}$/u;
const STABLE_CODE = /^[A-Z][A-Z0-9_]{2,95}$/u;
const BundleRootSchema = z.union([z.literal(""), FoundryRelativePathSchema]);
const MEMBER_LEAF_BY_ROLE = Object.freeze({
  metadata: "metadata.json",
  hierarchy: "hierarchy.bin",
  octree: "octree.bin",
} as const);

function expectedBundleMemberPath(
  bundleRoot: string,
  role: keyof typeof MEMBER_LEAF_BY_ROLE,
): string {
  const leaf = MEMBER_LEAF_BY_ROLE[role];
  return bundleRoot === "" ? leaf : `${bundleRoot}/${leaf}`;
}

const UnknownFactSchema = z.object({
  code: z.string().regex(STABLE_CODE),
  label: z.string().trim().min(1).max(120),
  reason: z.string().trim().min(1).max(500),
  decisiveNextTest: z.string().trim().min(1).max(500),
}).strict();

function unknownFact(
  code: string,
  label: string,
  reason: string,
  decisiveNextTest: string,
): Readonly<z.infer<typeof UnknownFactSchema>> {
  return Object.freeze(UnknownFactSchema.parse({
    code,
    label,
    reason,
    decisiveNextTest,
  }));
}

export const FOUNDRY_POTREE_V2_UNKNOWNS = Object.freeze([
  unknownFact(
    "POTREE_POINT_ATTRIBUTE_VALUES_UNKNOWN",
    "Decoded point and attribute values",
    "V7 verifies metadata declarations and exact byte layout without decoding coordinates, intensity, or the opaque vendor attribute.",
    "Run a separately reviewed bounded decoder against the exact three-member bundle digest and record finite-value, range, node-bound and cancellation evidence.",
  ),
  unknownFact(
    "POTREE_VENDOR_ATTRIBUTE_SEMANTICS_UNKNOWN",
    "Vendor attribute semantics",
    "The name `lcc prediction` and its uint8 layout do not establish how XGRIDS produced the value or what it means.",
    "Obtain a versioned vendor specification bound to the exact producer and bundle digest, then verify the declared encoding with independent fixtures.",
  ),
  unknownFact(
    "POTREE_PHYSICAL_BOUNDS_UNKNOWN",
    "Physical meaning of declared bounds",
    "Metadata root-cube and occupied-position declarations are retained as declarations; V7 does not decode points or establish physical extent, completeness, density, or clipping.",
    "Decode under frozen limits and compare digest-bound extrema and coverage with independently scoped control geometry.",
  ),
  unknownFact(
    "POTREE_UNITS_FRAME_CRS_UNKNOWN",
    "Units, axes, frame, and CRS",
    "Potree scale and offset values do not declare units, handedness, up axis, origin, datum, CRS, or a venue transform.",
    "Obtain an authoritative digest-bound frame declaration and verify independently controlled dimensions and a reviewed transform.",
  ),
  unknownFact(
    "POTREE_GEOMETRY_ROLE_COMPLETENESS_UNKNOWN",
    "Geometry role and preview completeness",
    "A viewer-compatible octree layout does not prove whether it is raw, decimated, filtered, complete, room-local, or suitable for reconstruction or measurement.",
    "Obtain a producer lineage record and compare decoded coverage with the source capture inventory and independently reviewed room scope.",
  ),
  unknownFact(
    "POTREE_PROVENANCE_CAPTURE_CLASS_UNKNOWN",
    "Provenance and capture class",
    "The bundle does not identify the XGRIDS/LCC version, device, session, parent observations, export settings, transformations, or capture-versus-derived class.",
    "Obtain a digest-bound lineage manifest naming the producer version, capture session, material parents, transformations, and export step.",
  ),
  unknownFact(
    "POTREE_ACCURACY_UNCERTAINTY_UNKNOWN",
    "Accuracy and uncertainty",
    "Byte equations and hierarchy coverage establish no measurement accuracy, precision, drift, covariance, or fitness for survey or fabrication.",
    "Compare decoded positions with independent surveyed controls under frozen blind limits, uncertainty treatment, and outlier policy.",
  ),
  unknownFact(
    "POTREE_REGISTRATION_UNKNOWN",
    "Registration quality",
    "The bundle does not establish a transform into sibling captures or a venue frame, residuals, holdouts, or independent registration validation.",
    "Evaluate a digest-bound transform against independent control with declared residual, holdout, and reviewer requirements.",
  ),
  unknownFact(
    "POTREE_VIEWER_FIDELITY_UNKNOWN",
    "Viewer compatibility and visual fidelity",
    "Structural compatibility with the official loader does not prove identical rendering, point appearance, device behavior, or fidelity to another XGRIDS viewer.",
    "Run frozen same-camera render comparisons in the target viewers and devices with exact source, renderer, settings, and repeatability evidence.",
  ),
  unknownFact(
    "POTREE_RIGHTS_UNKNOWN",
    "Purpose-scoped rights",
    "Read-only structural inspection does not evaluate ownership, privacy, commercial use, derivative-output, model-training, or redistribution rights.",
    "Obtain an authorized purpose-scoped rights decision bound to the exact three-member bundle digest.",
  ),
] as const);

const ROLE_ORDER = Object.freeze({ metadata: 0, hierarchy: 1, octree: 2 } as const);

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function orderedMembers<T extends {
  readonly role: keyof typeof ROLE_ORDER;
  readonly path: string;
}>(members: readonly T[]): T[] {
  return [...members].sort((left, right) =>
    ROLE_ORDER[left.role] - ROLE_ORDER[right.role] ||
    compareText(left.path, right.path)
  );
}

function bundleDigest(input: {
  readonly bundleRoot: string;
  readonly members: readonly z.infer<
    typeof FoundryPotreeV2BundleMemberIdentitySchema
  >[];
}): string {
  return domainSeparatedSha256(
    FOUNDRY_POTREE_V2_BUNDLE_DIGEST_DOMAIN,
    toCanonicalJson({
      bundleRoot: input.bundleRoot,
      members: orderedMembers(input.members),
    }),
  );
}

const PotreeInspectionSchema = z.object({
  state: z.enum(["established", "facts_not_established"]),
  category: z.enum([
    "established",
    "resource_limit",
    "parse_failure",
    "unsupported_variant",
  ]),
  code: z.string().regex(STABLE_CODE),
  coverage: z.enum([
    "none",
    "complete_metadata_hierarchy_and_exact_octree_layout",
  ]),
}).strict().superRefine((inspection, ctx) => {
  if (inspection.state === "established") {
    if (
      inspection.category !== "established" ||
      inspection.code !== "POTREE_V2_SOURCE_FACTS_ESTABLISHED" ||
      inspection.coverage !==
        "complete_metadata_hierarchy_and_exact_octree_layout"
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message:
          "Established Potree inspection state, category, code, and coverage must agree",
      });
    }
    return;
  }

  const expectedFailureCategory = Object.entries(
    FOUNDRY_POTREE_V2_SOURCE_FACTS_FAILURE_CATEGORY_BY_CODE,
  ).find(([code]) => code === inspection.code)?.[1];
  if (
    inspection.code === "POTREE_V2_INSPECTION_CANCELLED" ||
    expectedFailureCategory === undefined ||
    expectedFailureCategory !== inspection.category ||
    inspection.coverage !== "none"
  ) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message:
        "Non-established Potree inspection must match the frozen failure-code registry and carry no coverage",
    });
  }
});

export const FoundryPotreeV2BundleAssetV7Schema = z.object({
  bundleRoot: BundleRootSchema,
  bundleSha256: z.string().regex(SHA256_HEX),
  members: z.array(FoundryPotreeV2BundleMemberIdentitySchema).min(2).max(3),
  inspection: PotreeInspectionSchema,
  facts: FoundryPotreeV2BundleFactsSchema.nullable(),
  unknowns: z.array(UnknownFactSchema).length(FOUNDRY_POTREE_V2_UNKNOWNS.length),
}).strict().superRefine((asset, ctx) => {
  const members = orderedMembers(asset.members);
  const roles = members.map((member) => member.role);
  if (
    new Set(roles).size !== roles.length ||
    members.some((member, index) =>
      member.role !== asset.members[index]?.role ||
      member.path !== asset.members[index]?.path ||
      member.path !== expectedBundleMemberPath(asset.bundleRoot, member.role)
    )
  ) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["members"],
      message: "Potree bundle members must be unique and ordered metadata, hierarchy, octree",
    });
  }
  if (asset.bundleSha256 !== bundleDigest(asset)) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["bundleSha256"],
      message: "Potree bundle digest does not match its exact member identities",
    });
  }
  if (
    JSON.stringify(asset.unknowns) !==
      JSON.stringify(FOUNDRY_POTREE_V2_UNKNOWNS)
  ) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["unknowns"],
      message: "Potree bundle unknowns must match the frozen V7 profile",
    });
  }
  if (
    (asset.inspection.state === "established") !== (asset.facts !== null)
  ) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["facts"],
      message: "Potree facts must match the inspection state",
    });
  }
  if (
    asset.inspection.state === "established" &&
    roles.join(",") !== "metadata,hierarchy,octree"
  ) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["members"],
      message: "Established Potree facts require all three core members",
    });
  }
});
export type FoundryPotreeV2BundleAssetV7 = z.infer<
  typeof FoundryPotreeV2BundleAssetV7Schema
>;

const PolicySchema = z.object({
  sourceAccess: z.literal("read_only"),
  mutation: z.literal("none"),
  reconstruction: z.literal("none"),
  decodedGeometry: z.literal("none"),
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
  decodedGeometry: "none",
  networkAccess: "none",
  externalProcess: "none",
  authority: "none",
  rights: "not_evaluated",
  accuracy: "not_evaluated",
  registration: "not_evaluated",
};

const SummarySchema = z.object({
  receiptFileCount: z.number().int().safe().nonnegative(),
  inheritedAssetCount: z.number().int().safe().nonnegative(),
  potreeBundleCount: z.number().int().safe().nonnegative(),
  establishedPotreeBundleCount: z.number().int().safe().nonnegative(),
  factsNotEstablishedPotreeBundleCount: z.number().int().safe().nonnegative(),
  targetedMemberFileCount: z.number().int().safe().nonnegative(),
  untargetedFileCount: z.number().int().safe().nonnegative(),
  blockedSourceCount: z.number().int().safe().nonnegative(),
}).strict();

const ArtifactBaseSchema = z.object({
  schemaVersion: z.literal(FOUNDRY_UNIVERSAL_SOURCE_FACTS_V7),
  receiptSha256: z.string().regex(SHA256_HEX),
  inherited: FoundryUniversalSourceFactsV6Schema,
  policy: PolicySchema,
  limitations: z.array(z.string()).length(
    FOUNDRY_SOURCE_FACTS_V7_LIMITATIONS.length,
  ),
  summary: SummarySchema,
  factsSha256: z.string().regex(SHA256_HEX),
}).strict();

const AvailableArtifactSchema = ArtifactBaseSchema.extend({
  state: z.literal("available"),
  potreeBundles: z.array(FoundryPotreeV2BundleAssetV7Schema),
}).strict();

const UnavailableArtifactSchema = ArtifactBaseSchema.extend({
  state: z.literal("unavailable"),
  potreeBundles: z.tuple([]),
}).strict();

type ArtifactWithoutValidation =
  | z.infer<typeof AvailableArtifactSchema>
  | z.infer<typeof UnavailableArtifactSchema>;

type ArtifactPayload = ArtifactWithoutValidation extends infer Artifact
  ? Artifact extends ArtifactWithoutValidation
    ? Omit<Artifact, "factsSha256">
    : never
  : never;

function artifactDigest(value: ArtifactWithoutValidation): string {
  const { factsSha256: _factsSha256, ...payload } = value;
  return domainSeparatedSha256(
    FOUNDRY_UNIVERSAL_SOURCE_FACTS_V7_DIGEST_DOMAIN,
    toCanonicalJson(payload),
  );
}

function validateArtifact(
  value: ArtifactWithoutValidation,
  ctx: z.RefinementCtx,
): void {
  if (
    value.receiptSha256 !== value.inherited.receiptSha256 ||
    value.state !== value.inherited.state
  ) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["inherited"],
      message: "V7 state and receipt identity must match the embedded V6 artifact",
    });
  }
  if (
    JSON.stringify(value.policy) !== JSON.stringify(POLICY) ||
    JSON.stringify(value.limitations) !==
      JSON.stringify(FOUNDRY_SOURCE_FACTS_V7_LIMITATIONS)
  ) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["policy"],
      message: "V7 policy and limitations must match the frozen profile",
    });
  }
  const roots = value.potreeBundles.map((bundle) => bundle.bundleRoot);
  const sortedRoots = [...roots].sort(compareText);
  if (
    new Set(roots).size !== roots.length ||
    roots.some((root, index) => root !== sortedRoots[index])
  ) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["potreeBundles"],
      message: "V7 Potree bundle roots must be unique and sorted",
    });
  }
  const memberPaths = value.potreeBundles.flatMap((bundle) =>
    bundle.members.map((member) => member.path)
  );
  if (new Set(memberPaths).size !== memberPaths.length) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["potreeBundles"],
      message: "One receipt path cannot belong to multiple V7 Potree bundles",
    });
  }
  const inheritedPaths = value.inherited.state === "available"
    ? new Set(value.inherited.assets.map((asset) => asset.source.path))
    : new Set<string>();
  if (memberPaths.some((path) => inheritedPaths.has(path))) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["potreeBundles"],
      message: "V7 Potree members cannot overlap V6-established asset paths",
    });
  }
  const inheritedAssetCount = value.inherited.state === "available"
    ? value.inherited.assets.length
    : 0;
  const expected = {
    receiptFileCount: value.inherited.summary.receiptFileCount,
    inheritedAssetCount,
    potreeBundleCount: value.potreeBundles.length,
    establishedPotreeBundleCount: value.potreeBundles.filter(
      (bundle) => bundle.inspection.state === "established",
    ).length,
    factsNotEstablishedPotreeBundleCount: value.potreeBundles.filter(
      (bundle) => bundle.inspection.state === "facts_not_established",
    ).length,
    targetedMemberFileCount: memberPaths.length,
    untargetedFileCount: value.inherited.summary.untargetedFileCount -
      memberPaths.length,
    blockedSourceCount: value.inherited.summary.blockedSourceCount,
  };
  if (
    expected.untargetedFileCount < 0 ||
    JSON.stringify(value.summary) !== JSON.stringify(expected)
  ) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["summary"],
      message: "V7 summary contradicts its embedded V6 artifact and bundle members",
    });
  }
  if (value.factsSha256 !== artifactDigest(value)) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["factsSha256"],
      message: "V7 facts digest does not match the canonical wrapper payload",
    });
  }
}

export const FoundryUniversalSourceFactsV7Schema = z
  .discriminatedUnion("state", [AvailableArtifactSchema, UnavailableArtifactSchema])
  .superRefine(validateArtifact);
export type FoundryUniversalSourceFactsV7 = z.infer<
  typeof FoundryUniversalSourceFactsV7Schema
>;

function issueArtifact(payload: ArtifactPayload): FoundryUniversalSourceFactsV7 {
  const candidate = {
    ...payload,
    factsSha256: "0".repeat(64),
  } as ArtifactWithoutValidation;
  return FoundryUniversalSourceFactsV7Schema.parse({
    ...payload,
    factsSha256: artifactDigest(candidate),
  });
}

function coreMember(path: string): {
  readonly bundleRoot: string;
  readonly role: "metadata" | "hierarchy" | "octree";
} | null {
  const parts = path.split("/");
  const leaf = parts.at(-1);
  const role = leaf === MEMBER_LEAF_BY_ROLE.metadata
    ? "metadata" as const
    : leaf === MEMBER_LEAF_BY_ROLE.hierarchy
      ? "hierarchy" as const
      : leaf === MEMBER_LEAF_BY_ROLE.octree
        ? "octree" as const
        : null;
  if (role === null) return null;
  return { bundleRoot: parts.slice(0, -1).join("/"), role };
}

interface ExpectedBundleCandidate {
  readonly bundleRoot: string;
  readonly members: readonly z.infer<
    typeof FoundryPotreeV2BundleMemberIdentitySchema
  >[];
}

function expectedBundleCandidates(
  receipt: FoundryUniversalIntakeReceipt,
): ExpectedBundleCandidate[] {
  const roots = new Map<string, Array<z.infer<
    typeof FoundryPotreeV2BundleMemberIdentitySchema
  >>>();
  for (const file of receipt.files) {
    const core = coreMember(file.path);
    if (core === null) continue;
    const members = roots.get(core.bundleRoot) ?? [];
    members.push({
      role: core.role,
      path: file.path,
      sizeBytes: file.sizeBytes,
      sha256: file.sha256,
    });
    roots.set(core.bundleRoot, members);
  }
  return [...roots.entries()]
    .filter(([, members]) => members.length >= 2)
    .map(([bundleRoot, members]) => ({
      bundleRoot,
      members: orderedMembers(members),
    }))
    .sort((left, right) => compareText(left.bundleRoot, right.bundleRoot));
}

function exactMembersMatch(
  left: readonly z.infer<typeof FoundryPotreeV2BundleMemberIdentitySchema>[],
  right: readonly z.infer<typeof FoundryPotreeV2BundleMemberIdentitySchema>[],
): boolean {
  return JSON.stringify(orderedMembers(left)) === JSON.stringify(orderedMembers(right));
}

function missingMemberAsset(
  candidate: ExpectedBundleCandidate,
): FoundryPotreeV2BundleAssetV7 {
  return FoundryPotreeV2BundleAssetV7Schema.parse({
    bundleRoot: candidate.bundleRoot,
    bundleSha256: bundleDigest(candidate),
    members: candidate.members,
    inspection: {
      state: "facts_not_established",
      category: "parse_failure",
      code: "POTREE_V2_MEMBER_SET_INVALID",
      coverage: "none",
    },
    facts: null,
    unknowns: FOUNDRY_POTREE_V2_UNKNOWNS,
  });
}

export function createFoundryPotreeV2BundleAssetV7(
  outcomeInput: FoundryPotreeV2SourceFactsOutcome,
): FoundryPotreeV2BundleAssetV7 {
  const outcome = FoundryPotreeV2SourceFactsOutcomeSchema.parse(outcomeInput);
  const base = {
    bundleRoot: outcome.bundleRoot,
    bundleSha256: bundleDigest(outcome),
    members: orderedMembers(outcome.members),
    unknowns: FOUNDRY_POTREE_V2_UNKNOWNS,
  };
  if (outcome.state === "established") {
    return FoundryPotreeV2BundleAssetV7Schema.parse({
      ...base,
      inspection: {
        state: "established",
        category: "established",
        code: "POTREE_V2_SOURCE_FACTS_ESTABLISHED",
        coverage: "complete_metadata_hierarchy_and_exact_octree_layout",
      },
      facts: outcome.facts,
    });
  }
  if (outcome.category === "cancelled") {
    throw new FoundryIntegrityError(
      "SOURCE_FACTS_V7_POTREE_INSPECTION_CANCELLED",
      "Potree Source Facts inspection was cancelled; no V7 artifact was issued.",
    );
  }
  return FoundryPotreeV2BundleAssetV7Schema.parse({
    ...base,
    inspection: {
      state: "facts_not_established",
      category: outcome.category,
      code: outcome.code,
      coverage: "none",
    },
    facts: null,
  });
}

export function createUniversalSourceFactsV7ArtifactFromReceipt(
  receiptInput: unknown,
  inheritedInput: FoundryUniversalSourceFactsV6,
  bundleAssetInputs: readonly FoundryPotreeV2BundleAssetV7[] = [],
): FoundryUniversalSourceFactsV7 {
  const receipt = FoundryUniversalIntakeReceiptSchema.parse(receiptInput);
  const inherited = FoundryUniversalSourceFactsV6Schema.parse(inheritedInput);
  if (
    inherited.receiptSha256 !== receipt.receiptSha256 ||
    inherited.summary.receiptFileCount !== receipt.files.length
  ) {
    throw new FoundryIntegrityError(
      "SOURCE_FACTS_V7_INHERITED_BINDING_MISMATCH",
      "The embedded V6 artifact does not bind the supplied intake receipt.",
    );
  }
  if (inherited.state === "unavailable") {
    if (bundleAssetInputs.length > 0) {
      throw new FoundryIntegrityError(
        "SOURCE_FACTS_V7_XBIN_PARTIAL_EVIDENCE_FORBIDDEN",
        "V7 cannot attach Potree evidence when the embedded V6 artifact is atomically unavailable.",
      );
    }
    return issueArtifact({
      schemaVersion: FOUNDRY_UNIVERSAL_SOURCE_FACTS_V7,
      receiptSha256: receipt.receiptSha256,
      state: "unavailable",
      inherited,
      policy: POLICY,
      limitations: [...FOUNDRY_SOURCE_FACTS_V7_LIMITATIONS],
      summary: {
        receiptFileCount: receipt.files.length,
        inheritedAssetCount: 0,
        potreeBundleCount: 0,
        establishedPotreeBundleCount: 0,
        factsNotEstablishedPotreeBundleCount: 0,
        targetedMemberFileCount: 0,
        untargetedFileCount: inherited.summary.untargetedFileCount,
        blockedSourceCount: inherited.summary.blockedSourceCount,
      },
      potreeBundles: [],
    });
  }

  const expected = expectedBundleCandidates(receipt);
  const expectedComplete = expected.filter(
    (candidate) => candidate.members.length === 3,
  );
  const suppliedBundles = bundleAssetInputs
    .map((asset) => FoundryPotreeV2BundleAssetV7Schema.parse(asset))
    .sort((left, right) => compareText(left.bundleRoot, right.bundleRoot));
  if (suppliedBundles.length !== expectedComplete.length) {
    throw new FoundryIntegrityError(
      "SOURCE_FACTS_V7_POTREE_RESULT_SET_INCOMPLETE",
      "V7 requires one Potree inspection result for every complete receipt-level bundle candidate.",
    );
  }
  const inheritedPaths = new Set(inherited.assets.map((asset) => asset.source.path));
  if (
    expected.some((candidate) =>
      candidate.members.some((member) => inheritedPaths.has(member.path))
    )
  ) {
    throw new FoundryIntegrityError(
      "SOURCE_FACTS_V7_INHERITED_TARGET_OVERLAP",
      "A Potree bundle member cannot replace a file already established by V6.",
    );
  }
  for (const [index, candidate] of expectedComplete.entries()) {
    const bundle = suppliedBundles[index];
    if (
      bundle === undefined ||
      bundle.bundleRoot !== candidate.bundleRoot ||
      !exactMembersMatch(bundle.members, candidate.members)
    ) {
      throw new FoundryIntegrityError(
        "SOURCE_FACTS_V7_POTREE_MEMBER_BINDING_MISMATCH",
        "A V7 Potree result does not match the exact receipt member identities.",
      );
    }
  }
  const suppliedByRoot = new Map(
    suppliedBundles.map((bundle) => [bundle.bundleRoot, bundle] as const),
  );
  const bundles = expected.map((candidate) =>
    candidate.members.length === 3
      ? suppliedByRoot.get(candidate.bundleRoot) ?? (() => {
          throw new FoundryIntegrityError(
            "SOURCE_FACTS_V7_POTREE_RESULT_SET_INCOMPLETE",
            "A complete receipt-level Potree bundle is missing its inspection result.",
          );
        })()
      : missingMemberAsset(candidate)
  );
  const memberPathCount = bundles.reduce(
    (total, bundle) => total + bundle.members.length,
    0,
  );
  return issueArtifact({
    schemaVersion: FOUNDRY_UNIVERSAL_SOURCE_FACTS_V7,
    receiptSha256: receipt.receiptSha256,
    state: "available",
    inherited,
    policy: POLICY,
    limitations: [...FOUNDRY_SOURCE_FACTS_V7_LIMITATIONS],
    summary: {
      receiptFileCount: receipt.files.length,
      inheritedAssetCount: inherited.assets.length,
      potreeBundleCount: bundles.length,
      establishedPotreeBundleCount: bundles.filter(
        (bundle) => bundle.inspection.state === "established",
      ).length,
      factsNotEstablishedPotreeBundleCount: bundles.filter(
        (bundle) => bundle.inspection.state === "facts_not_established",
      ).length,
      targetedMemberFileCount: memberPathCount,
      untargetedFileCount:
        inherited.summary.untargetedFileCount - memberPathCount,
      blockedSourceCount: 0,
    },
    potreeBundles: bundles,
  });
}

export function serializeUniversalSourceFactsV7Artifact(
  value: FoundryUniversalSourceFactsV7,
): string {
  return stableCanonicalJson(
    toCanonicalJson(FoundryUniversalSourceFactsV7Schema.parse(value)),
  );
}
