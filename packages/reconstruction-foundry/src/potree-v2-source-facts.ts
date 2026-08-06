import { createHash, type Hash } from "node:crypto";
import { z } from "zod";

export const FOUNDRY_POTREE_V2_METADATA_MAX_BYTES = 1024 * 1024;
export const FOUNDRY_POTREE_V2_HIERARCHY_MAX_BYTES = 64 * 1024 * 1024;
export const FOUNDRY_POTREE_V2_OCTREE_MAX_BYTES = 4 * 1024 * 1024 * 1024;
export const FOUNDRY_POTREE_V2_POINT_MAX_COUNT = 100_000_000;
export const FOUNDRY_POTREE_V2_HIERARCHY_NODE_MAX_COUNT = 1_000_000;
export const FOUNDRY_POTREE_V2_HIERARCHY_RECORD_BYTES = 22;
export const FOUNDRY_POTREE_V2_POINT_RECORD_BYTES = 14;
export const FOUNDRY_POTREE_V2_MEMBER_ROLES = Object.freeze([
  "metadata",
  "hierarchy",
  "octree",
] as const);
export const FOUNDRY_POTREE_V2_SOURCE_FACTS_LIMITATIONS = Object.freeze([
  "POINT_RECORD_VALUES_ARE_NOT_DECODED_OR_VALIDATED",
  "DECLARED_ATTRIBUTE_NAMES_AND_LAYOUT_DO_NOT_ESTABLISH_SEMANTICS",
  "METADATA_BOUNDS_SCALE_OFFSET_SPACING_AND_PROJECTION_ARE_UNVERIFIED_DECLARATIONS",
  "STRUCTURAL_FACTS_DO_NOT_ESTABLISH_GEOMETRY_QUALITY_COMPLETENESS_OR_ACCURACY",
  "STRUCTURAL_FACTS_DO_NOT_ESTABLISH_UNITS_FRAME_CRS_REGISTRATION_OR_SURVEY_AUTHORITY",
  "FORMAT_FACTS_DO_NOT_ESTABLISH_CAPTURE_PROVENANCE_RIGHTS_PRIVACY_OR_FITNESS",
] as const);

export const FOUNDRY_POTREE_V2_SOURCE_FACTS_FAILURE_CODES = Object.freeze([
  "POTREE_V2_INSPECTION_CANCELLED",
  "POTREE_V2_MEMBER_SET_INVALID",
  "POTREE_V2_MEMBER_PATH_MISMATCH",
  "POTREE_V2_MEMBER_STREAM_NONCONTIGUOUS",
  "POTREE_V2_MEMBER_SIZE_MISMATCH",
  "POTREE_V2_MEMBER_SHA256_MISMATCH",
  "POTREE_V2_METADATA_SIZE_LIMIT_EXCEEDED",
  "POTREE_V2_HIERARCHY_SIZE_LIMIT_EXCEEDED",
  "POTREE_V2_OCTREE_SIZE_LIMIT_EXCEEDED",
  "POTREE_V2_METADATA_UTF8_INVALID",
  "POTREE_V2_METADATA_JSON_DUPLICATE_KEY",
  "POTREE_V2_METADATA_JSON_INVALID",
  "POTREE_V2_METADATA_SCHEMA_INVALID",
  "POTREE_V2_PROFILE_UNSUPPORTED",
  "POTREE_V2_POINT_COUNT_LIMIT_EXCEEDED",
  "POTREE_V2_OCTREE_LENGTH_MISMATCH",
  "POTREE_V2_HIERARCHY_FIRST_CHUNK_INVALID",
  "POTREE_V2_HIERARCHY_CHUNK_RANGE_INVALID",
  "POTREE_V2_HIERARCHY_CHUNK_OVERLAP",
  "POTREE_V2_HIERARCHY_PROXY_CYCLE",
  "POTREE_V2_HIERARCHY_NODE_TYPE_INVALID",
  "POTREE_V2_HIERARCHY_INTEGER_OUT_OF_RANGE",
  "POTREE_V2_HIERARCHY_NODE_LIMIT_EXCEEDED",
  "POTREE_V2_HIERARCHY_BFS_COUNT_MISMATCH",
  "POTREE_V2_HIERARCHY_PROXY_REPLACEMENT_MISMATCH",
  "POTREE_V2_HIERARCHY_NODE_BYTE_SIZE_MISMATCH",
  "POTREE_V2_OCTREE_RANGE_OUT_OF_BOUNDS",
  "POTREE_V2_OCTREE_RANGE_GAP",
  "POTREE_V2_OCTREE_RANGE_OVERLAP",
  "POTREE_V2_HIERARCHY_POINT_COUNT_MISMATCH",
  "POTREE_V2_HIERARCHY_UNREACHABLE_BYTES",
  "POTREE_V2_INSPECTION_FAILED",
] as const);

export type FoundryPotreeV2SourceFactsFailureCode =
  (typeof FOUNDRY_POTREE_V2_SOURCE_FACTS_FAILURE_CODES)[number];
export type FoundryPotreeV2SourceFactsFailureCategory =
  | "cancelled"
  | "parse_failure"
  | "resource_limit"
  | "unsupported_variant";

export const FOUNDRY_POTREE_V2_SOURCE_FACTS_FAILURE_CATEGORY_BY_CODE =
  Object.freeze({
    POTREE_V2_INSPECTION_CANCELLED: "cancelled",
    POTREE_V2_MEMBER_SET_INVALID: "parse_failure",
    POTREE_V2_MEMBER_PATH_MISMATCH: "parse_failure",
    POTREE_V2_MEMBER_STREAM_NONCONTIGUOUS: "parse_failure",
    POTREE_V2_MEMBER_SIZE_MISMATCH: "parse_failure",
    POTREE_V2_MEMBER_SHA256_MISMATCH: "parse_failure",
    POTREE_V2_METADATA_SIZE_LIMIT_EXCEEDED: "resource_limit",
    POTREE_V2_HIERARCHY_SIZE_LIMIT_EXCEEDED: "resource_limit",
    POTREE_V2_OCTREE_SIZE_LIMIT_EXCEEDED: "resource_limit",
    POTREE_V2_METADATA_UTF8_INVALID: "parse_failure",
    POTREE_V2_METADATA_JSON_DUPLICATE_KEY: "parse_failure",
    POTREE_V2_METADATA_JSON_INVALID: "parse_failure",
    POTREE_V2_METADATA_SCHEMA_INVALID: "parse_failure",
    POTREE_V2_PROFILE_UNSUPPORTED: "unsupported_variant",
    POTREE_V2_POINT_COUNT_LIMIT_EXCEEDED: "resource_limit",
    POTREE_V2_OCTREE_LENGTH_MISMATCH: "parse_failure",
    POTREE_V2_HIERARCHY_FIRST_CHUNK_INVALID: "parse_failure",
    POTREE_V2_HIERARCHY_CHUNK_RANGE_INVALID: "parse_failure",
    POTREE_V2_HIERARCHY_CHUNK_OVERLAP: "parse_failure",
    POTREE_V2_HIERARCHY_PROXY_CYCLE: "parse_failure",
    POTREE_V2_HIERARCHY_NODE_TYPE_INVALID: "unsupported_variant",
    POTREE_V2_HIERARCHY_INTEGER_OUT_OF_RANGE: "resource_limit",
    POTREE_V2_HIERARCHY_NODE_LIMIT_EXCEEDED: "resource_limit",
    POTREE_V2_HIERARCHY_BFS_COUNT_MISMATCH: "parse_failure",
    POTREE_V2_HIERARCHY_PROXY_REPLACEMENT_MISMATCH: "parse_failure",
    POTREE_V2_HIERARCHY_NODE_BYTE_SIZE_MISMATCH: "parse_failure",
    POTREE_V2_OCTREE_RANGE_OUT_OF_BOUNDS: "parse_failure",
    POTREE_V2_OCTREE_RANGE_GAP: "parse_failure",
    POTREE_V2_OCTREE_RANGE_OVERLAP: "parse_failure",
    POTREE_V2_HIERARCHY_POINT_COUNT_MISMATCH: "parse_failure",
    POTREE_V2_HIERARCHY_UNREACHABLE_BYTES: "parse_failure",
    POTREE_V2_INSPECTION_FAILED: "parse_failure",
  } as const satisfies Readonly<Record<
    FoundryPotreeV2SourceFactsFailureCode,
    FoundryPotreeV2SourceFactsFailureCategory
  >>);

const SHA256_HEX = /^[a-f0-9]{64}$/u;
const MEMBER_ROLE_SCHEMA = z.enum(FOUNDRY_POTREE_V2_MEMBER_ROLES);
export type FoundryPotreeV2BundleMemberRole = z.infer<typeof MEMBER_ROLE_SCHEMA>;

export const FoundryPotreeV2BundleMemberIdentitySchema = z.object({
  role: MEMBER_ROLE_SCHEMA,
  path: z.string().min(1).max(4096),
  sizeBytes: z.number().int().safe().nonnegative(),
  sha256: z.string().regex(SHA256_HEX),
}).strict();
export type FoundryPotreeV2BundleMemberIdentity = z.infer<
  typeof FoundryPotreeV2BundleMemberIdentitySchema
>;

const Vec3Schema = z.tuple([z.number().finite(), z.number().finite(), z.number().finite()]);
const AttributeLayoutSchema = z.object({
  name: z.enum(["position", "intensity", "lcc prediction"]),
  type: z.enum(["int32", "uint8"]),
  sizeBytes: z.number().int().positive(),
  elementCount: z.number().int().positive(),
  elementSizeBytes: z.number().int().positive(),
  declaredMin: z.union([z.tuple([z.number().finite()]), Vec3Schema]),
  declaredMax: z.union([z.tuple([z.number().finite()]), Vec3Schema]),
  histogramDeclared: z.boolean(),
}).strict();
const AttributeLayoutsSchema = z.tuple([
  AttributeLayoutSchema,
  AttributeLayoutSchema,
  AttributeLayoutSchema,
]).superRefine((attributes, ctx) => {
  const expected = [
    ["position", "int32", 12, 3, 4],
    ["intensity", "uint8", 1, 1, 1],
    ["lcc prediction", "uint8", 1, 1, 1],
  ] as const;
  for (let index = 0; index < expected.length; index += 1) {
    const attribute = attributes[index];
    const layout = expected[index];
    if (attribute === undefined || layout === undefined) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: [index], message: "attribute layout is missing" });
      continue;
    }
    if (attribute.name !== layout[0] || attribute.type !== layout[1] ||
        attribute.sizeBytes !== layout[2] || attribute.elementCount !== layout[3] ||
        attribute.elementSizeBytes !== layout[4]) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: [index], message: "attribute contradicts the frozen XGRIDS DEFAULT layout" });
    }
  }
});
const ReachabilityObservationSchema = z.object({
  kind: z.literal("hierarchy_reachability"),
  hierarchySizeBytes: z.number().int().safe().nonnegative(),
  reachableHierarchyBytes: z.number().int().safe().nonnegative(),
  unreferencedHierarchyBytes: z.number().int().safe().positive(),
}).strict();

export const FoundryPotreeV2BundleFactsSchema = z.object({
  format: z.literal("potree_v2_three_member_bundle"),
  profile: z.literal("xgrids_default_position_intensity_lcc_prediction_14_byte"),
  inspectionCoverage: z.literal("complete_metadata_hierarchy_graph_and_octree_layout"),
  metadata: z.object({
    version: z.literal("2.0"),
    encoding: z.literal("DEFAULT"),
    name: z.literal("potree"),
    pointCount: z.number().int().safe().positive().max(
      FOUNDRY_POTREE_V2_POINT_MAX_COUNT,
    ),
    hierarchyFirstChunkSizeBytes: z.number().int().safe().positive().max(
      FOUNDRY_POTREE_V2_HIERARCHY_MAX_BYTES,
    ),
    hierarchyStepSize: z.number().int().min(1).max(64),
    declaredHierarchyDepth: z.number().int().min(0).max(64),
    declaredOffset: Vec3Schema,
    declaredScale: Vec3Schema,
    declaredSpacing: z.number().finite().positive(),
    declaredBoundingBox: z.object({ min: Vec3Schema, max: Vec3Schema }).strict(),
    attributes: AttributeLayoutsSchema,
    recordStrideBytes: z.literal(FOUNDRY_POTREE_V2_POINT_RECORD_BYTES),
  }).strict(),
  hierarchy: z.object({
    sourceSizeBytes: z.number().int().safe().positive().max(
      FOUNDRY_POTREE_V2_HIERARCHY_MAX_BYTES,
    ),
    recordSizeBytes: z.literal(FOUNDRY_POTREE_V2_HIERARCHY_RECORD_BYTES),
    reachableChunkCount: z.number().int().safe().positive(),
    reachableRecordCount: z.number().int().safe().positive().max(
      FOUNDRY_POTREE_V2_HIERARCHY_NODE_MAX_COUNT,
    ),
    logicalNodeCount: z.number().int().safe().positive().max(
      FOUNDRY_POTREE_V2_HIERARCHY_NODE_MAX_COUNT,
    ),
    normalNodeCount: z.number().int().safe().nonnegative().max(
      FOUNDRY_POTREE_V2_HIERARCHY_NODE_MAX_COUNT,
    ),
    leafNodeCount: z.number().int().safe().nonnegative().max(
      FOUNDRY_POTREE_V2_HIERARCHY_NODE_MAX_COUNT,
    ),
    proxyReferenceCount: z.number().int().safe().nonnegative().max(
      FOUNDRY_POTREE_V2_HIERARCHY_NODE_MAX_COUNT,
    ),
    proxyReplacementChildMaskMismatchCount: z.number().int().safe()
      .nonnegative().max(FOUNDRY_POTREE_V2_HIERARCHY_NODE_MAX_COUNT),
    proxyReplacementPointCountMismatchCount: z.number().int().safe()
      .nonnegative().max(FOUNDRY_POTREE_V2_HIERARCHY_NODE_MAX_COUNT),
    leafRecordsWithChildren: z.number().int().safe().nonnegative().max(
      FOUNDRY_POTREE_V2_HIERARCHY_NODE_MAX_COUNT,
    ),
    maximumObservedDepth: z.number().int().safe().nonnegative().max(64),
    declaredDepthMatchesObservedMaximum: z.boolean(),
    reachableHierarchyBytes: z.number().int().safe().positive(),
    unreferencedHierarchyBytes: z.literal(0),
    hierarchyChunkRangesDisjoint: z.literal(true),
    pointCountSum: z.number().int().safe().positive(),
  }).strict(),
  octree: z.object({
    sourceSizeBytes: z.number().int().safe().positive().max(
      FOUNDRY_POTREE_V2_OCTREE_MAX_BYTES,
    ),
    expectedSizeFromMetadataBytes: z.number().int().safe().positive().max(
      FOUNDRY_POTREE_V2_OCTREE_MAX_BYTES,
    ),
    payloadRangeCount: z.number().int().safe().positive(),
    coveredBytes: z.number().int().safe().positive(),
    payloadRangesDisjointAndGapless: z.literal(true),
  }).strict(),
  compatibility: z.object({
    declaredHierarchyDepth: z.enum(["matches_observed", "differs_from_observed_accepted"]),
    leafChildMasks: z.enum(["none_observed", "observed_and_accepted_by_official_loader_semantics"]),
    proxyReplacementDeclarations: z.enum([
      "no_proxies",
      "all_match",
      "target_record_overwrite_mismatches_observed_and_accepted",
    ]),
    attributeHistograms: z.enum(["all_declared", "partially_declared", "omitted_and_accepted"]),
  }).strict(),
  limitations: z.tuple([
    z.literal(FOUNDRY_POTREE_V2_SOURCE_FACTS_LIMITATIONS[0]),
    z.literal(FOUNDRY_POTREE_V2_SOURCE_FACTS_LIMITATIONS[1]),
    z.literal(FOUNDRY_POTREE_V2_SOURCE_FACTS_LIMITATIONS[2]),
    z.literal(FOUNDRY_POTREE_V2_SOURCE_FACTS_LIMITATIONS[3]),
    z.literal(FOUNDRY_POTREE_V2_SOURCE_FACTS_LIMITATIONS[4]),
    z.literal(FOUNDRY_POTREE_V2_SOURCE_FACTS_LIMITATIONS[5]),
  ]),
}).strict().superRefine((facts, ctx) => {
  const issue = (path: (string | number)[], message: string): void => {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path, message });
  };
  const { metadata, hierarchy, octree, compatibility } = facts;
  const expectedOctreeBytes = metadata.pointCount *
    FOUNDRY_POTREE_V2_POINT_RECORD_BYTES;
  const expectedHierarchyBytes = hierarchy.reachableRecordCount *
    FOUNDRY_POTREE_V2_HIERARCHY_RECORD_BYTES;
  if (
    !Number.isSafeInteger(expectedOctreeBytes) ||
    octree.sourceSizeBytes !== expectedOctreeBytes ||
    octree.expectedSizeFromMetadataBytes !== expectedOctreeBytes ||
    octree.coveredBytes !== expectedOctreeBytes
  ) {
    issue(
      ["octree"],
      "octree byte totals must equal metadata point count times record stride",
    );
  }
  if (
    hierarchy.pointCountSum !== metadata.pointCount ||
    hierarchy.logicalNodeCount !==
      hierarchy.normalNodeCount + hierarchy.leafNodeCount ||
    hierarchy.reachableRecordCount !==
      hierarchy.logicalNodeCount + hierarchy.proxyReferenceCount ||
    hierarchy.reachableChunkCount !== hierarchy.proxyReferenceCount + 1 ||
    hierarchy.sourceSizeBytes !== expectedHierarchyBytes ||
    hierarchy.reachableHierarchyBytes !== expectedHierarchyBytes ||
    metadata.hierarchyFirstChunkSizeBytes > hierarchy.sourceSizeBytes ||
    metadata.hierarchyFirstChunkSizeBytes %
        FOUNDRY_POTREE_V2_HIERARCHY_RECORD_BYTES !== 0 ||
    hierarchy.leafRecordsWithChildren > hierarchy.leafNodeCount ||
    hierarchy.proxyReplacementChildMaskMismatchCount >
      hierarchy.proxyReferenceCount ||
    hierarchy.proxyReplacementPointCountMismatchCount >
      hierarchy.proxyReferenceCount ||
    octree.payloadRangeCount > hierarchy.logicalNodeCount
  ) {
    issue(
      ["hierarchy"],
      "hierarchy counts, chunks, record bytes, points, and mismatch bounds must agree",
    );
  }
  if (
    hierarchy.declaredDepthMatchesObservedMaximum !==
      (metadata.declaredHierarchyDepth === hierarchy.maximumObservedDepth) ||
    compatibility.declaredHierarchyDepth !==
      (hierarchy.declaredDepthMatchesObservedMaximum
        ? "matches_observed"
        : "differs_from_observed_accepted")
  ) {
    issue(
      ["compatibility", "declaredHierarchyDepth"],
      "declared-depth compatibility must match the observed hierarchy depth",
    );
  }
  const expectedLeafCompatibility = hierarchy.leafRecordsWithChildren === 0
    ? "none_observed"
    : "observed_and_accepted_by_official_loader_semantics";
  if (compatibility.leafChildMasks !== expectedLeafCompatibility) {
    issue(
      ["compatibility", "leafChildMasks"],
      "leaf-child compatibility must match the observed leaf masks",
    );
  }
  const proxyMismatchCount =
    hierarchy.proxyReplacementChildMaskMismatchCount +
    hierarchy.proxyReplacementPointCountMismatchCount;
  const expectedProxyCompatibility = hierarchy.proxyReferenceCount === 0
    ? "no_proxies"
    : proxyMismatchCount === 0
      ? "all_match"
      : "target_record_overwrite_mismatches_observed_and_accepted";
  if (compatibility.proxyReplacementDeclarations !== expectedProxyCompatibility) {
    issue(
      ["compatibility", "proxyReplacementDeclarations"],
      "proxy compatibility must match the observed replacement declarations",
    );
  }
  const histogramCount = metadata.attributes.filter(
    (attribute) => attribute.histogramDeclared,
  ).length;
  const expectedHistogramCompatibility = histogramCount ===
      metadata.attributes.length
    ? "all_declared"
    : histogramCount === 0
      ? "omitted_and_accepted"
      : "partially_declared";
  if (compatibility.attributeHistograms !== expectedHistogramCompatibility) {
    issue(
      ["compatibility", "attributeHistograms"],
      "histogram compatibility must match the declared attribute histograms",
    );
  }
  if (
    metadata.declaredScale.some((value) => value <= 0) ||
    metadata.declaredOffset.some(
      (value, index) => value !== metadata.declaredBoundingBox.min[index],
    ) ||
    metadata.declaredBoundingBox.min.some(
      (value, index) =>
        value >= (metadata.declaredBoundingBox.max[index] ?? value),
    )
  ) {
    issue(
      ["metadata"],
      "metadata scale, offset, and bounding-box declarations must agree",
    );
  }
  for (const [index, attribute] of metadata.attributes.entries()) {
    if (
      attribute.declaredMin.length !== attribute.elementCount ||
      attribute.declaredMax.length !== attribute.elementCount ||
      attribute.declaredMin.some(
        (value, component) =>
          value > (attribute.declaredMax[component] ?? value),
      )
    ) {
      issue(
        ["metadata", "attributes", index],
        "attribute declared ranges must match their element count and ordering",
      );
    }
    if (
      index === 0 &&
      (attribute.declaredMin.some(
        (value, component) =>
          value < (metadata.declaredBoundingBox.min[component] ?? value),
      ) || attribute.declaredMax.some(
        (value, component) =>
          value > (metadata.declaredBoundingBox.max[component] ?? value),
      ))
    ) {
      issue(
        ["metadata", "attributes", index],
        "declared position range must stay within the declared bounding box",
      );
    }
    const firstMinimum = attribute.declaredMin[0];
    const firstMaximum = attribute.declaredMax[0];
    if (index > 0 && (firstMinimum < 0 || firstMaximum > 255)) {
      issue(
        ["metadata", "attributes", index],
        "declared uint8 range must stay within 0 through 255",
      );
    }
  }
});
export type FoundryPotreeV2BundleFacts = z.infer<
  typeof FoundryPotreeV2BundleFactsSchema
>;

const OutcomeBaseSchema = z.object({
  bundleRoot: z.string().max(4096),
  members: z.array(FoundryPotreeV2BundleMemberIdentitySchema).max(3),
}).strict();
const EstablishedOutcomeSchema = OutcomeBaseSchema.extend({
  members: z.array(FoundryPotreeV2BundleMemberIdentitySchema).length(3),
  state: z.literal("established"),
  facts: FoundryPotreeV2BundleFactsSchema,
}).strict();
const FailureOutcomeSchema = OutcomeBaseSchema.extend({
  state: z.literal("facts_not_established"),
  category: z.enum(["cancelled", "parse_failure", "resource_limit", "unsupported_variant"]),
  code: z.enum(FOUNDRY_POTREE_V2_SOURCE_FACTS_FAILURE_CODES),
  observations: ReachabilityObservationSchema.optional(),
}).strict().superRefine((value, ctx) => {
  if (FOUNDRY_POTREE_V2_SOURCE_FACTS_FAILURE_CATEGORY_BY_CODE[value.code] !== value.category) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["category"], message: "failure category contradicts frozen code registry" });
  }
});

export const FoundryPotreeV2SourceFactsOutcomeSchema = z.union([
  EstablishedOutcomeSchema,
  FailureOutcomeSchema,
]);
export type FoundryPotreeV2SourceFactsOutcome = z.infer<
  typeof FoundryPotreeV2SourceFactsOutcomeSchema
>;

export interface FoundryPotreeV2ReceiptLikeIdentity {
  readonly path: string;
  readonly sizeBytes: number;
  readonly sha256: string;
}

export interface FoundryPotreeV2BundleCandidate {
  readonly bundleRoot: string;
  readonly members: readonly FoundryPotreeV2BundleMemberIdentity[];
  readonly missingRoles: readonly FoundryPotreeV2BundleMemberRole[];
  readonly duplicateRoles: readonly FoundryPotreeV2BundleMemberRole[];
}

const MEMBER_FILE_BY_ROLE: Readonly<Record<FoundryPotreeV2BundleMemberRole, string>> =
  Object.freeze({
    metadata: "metadata.json",
    hierarchy: "hierarchy.bin",
    octree: "octree.bin",
  });
const ROLE_BY_MEMBER_FILE: Readonly<Record<string, FoundryPotreeV2BundleMemberRole>> =
  Object.freeze({
    "metadata.json": "metadata",
    "hierarchy.bin": "hierarchy",
    "octree.bin": "octree",
  });

function canonicalRelativePath(value: string, allowEmpty: boolean): string | null {
  if (typeof value !== "string" || value.length > 4096 || value.includes("\\") || value.includes(":") ||
      value.startsWith("/") || hasControlCharacter(value)) return null;
  if (value === "") return allowEmpty ? "" : null;
  const segments = value.split("/");
  if (segments.some((segment) => segment === "" || segment === "." || segment === "..")) return null;
  return value;
}

function hasControlCharacter(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code <= 0x1f || code === 0x7f) return true;
  }
  return false;
}

function splitMemberPath(path: string): { readonly root: string; readonly name: string } | null {
  const canonical = canonicalRelativePath(path, false);
  if (canonical === null) return null;
  const slash = canonical.lastIndexOf("/");
  return slash === -1
    ? { root: "", name: canonical }
    : { root: canonical.slice(0, slash), name: canonical.slice(slash + 1) };
}

export function discoverPotreeV2BundleCandidates<
  TIdentity extends FoundryPotreeV2ReceiptLikeIdentity,
>(
  identities: readonly TIdentity[],
): readonly FoundryPotreeV2BundleCandidate[] {
  const groups = new Map<string, FoundryPotreeV2BundleMemberIdentity[]>();
  for (const identity of identities) {
    const split = splitMemberPath(identity.path);
    if (split === null) continue;
    const role = ROLE_BY_MEMBER_FILE[split.name];
    if (role === undefined) continue;
    const parsed = FoundryPotreeV2BundleMemberIdentitySchema.safeParse({
      role,
      path: identity.path,
      sizeBytes: identity.sizeBytes,
      sha256: identity.sha256,
    });
    if (!parsed.success) continue;
    const members = groups.get(split.root) ?? [];
    members.push(parsed.data);
    groups.set(split.root, members);
  }
  return [...groups.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([bundleRoot, unsorted]) => {
      const members = [...unsorted].sort((left, right) =>
        FOUNDRY_POTREE_V2_MEMBER_ROLES.indexOf(left.role) -
        FOUNDRY_POTREE_V2_MEMBER_ROLES.indexOf(right.role));
      const counts = new Map<FoundryPotreeV2BundleMemberRole, number>();
      for (const member of members) counts.set(member.role, (counts.get(member.role) ?? 0) + 1);
      return Object.freeze({
        bundleRoot,
        members: Object.freeze(members),
        missingRoles: Object.freeze(FOUNDRY_POTREE_V2_MEMBER_ROLES.filter((role) => !counts.has(role))),
        duplicateRoles: Object.freeze(FOUNDRY_POTREE_V2_MEMBER_ROLES.filter((role) => (counts.get(role) ?? 0) > 1)),
      });
    });
}

type FailureCode = FoundryPotreeV2SourceFactsFailureCode;
type FailureCategory = FoundryPotreeV2SourceFactsFailureCategory;

class PotreeInspectionFailure extends Error {
  constructor(
    readonly code: FailureCode,
    readonly observations?: z.infer<typeof ReachabilityObservationSchema>,
  ) {
    super(code);
    this.name = "PotreeInspectionFailure";
  }
}

function fail(code: FailureCode): never {
  throw new PotreeInspectionFailure(code);
}

class BoundedCapture {
  private readonly blocks: Buffer[] = [];
  private length = 0;
  private usedInLastBlock = 0;
  constructor(private readonly limit: number) {}

  append(chunk: Uint8Array): boolean {
    if (chunk.length === 0) return true;
    const nextLength = this.length + chunk.length;
    if (!Number.isSafeInteger(nextLength) || nextLength > this.limit) return false;
    let inputOffset = 0;
    while (inputOffset < chunk.length) {
      let block = this.blocks[this.blocks.length - 1];
      if (block === undefined || this.usedInLastBlock === block.length) {
        block = Buffer.allocUnsafe(Math.min(
          1024 * 1024,
          this.limit - this.length,
          Math.max(64 * 1024, chunk.length - inputOffset),
        ));
        this.blocks.push(block);
        this.usedInLastBlock = 0;
      }
      const copyBytes = Math.min(block.length - this.usedInLastBlock, chunk.length - inputOffset);
      block.set(chunk.subarray(inputOffset, inputOffset + copyBytes), this.usedInLastBlock);
      inputOffset += copyBytes;
      this.usedInLastBlock += copyBytes;
      this.length += copyBytes;
    }
    return true;
  }

  finish(): Buffer {
    if (this.blocks.length === 0) return Buffer.alloc(0);
    const slices = this.blocks.map((block, index) =>
      index === this.blocks.length - 1 ? block.subarray(0, this.usedInLastBlock) : block);
    return Buffer.concat(slices, this.length);
  }
}

interface MemberStreamState {
  readonly hash: Hash;
  readonly capture: BoundedCapture | null;
  observedBytes: number;
}

function newMemberState(role: FoundryPotreeV2BundleMemberRole): MemberStreamState {
  const limit = role === "metadata"
    ? FOUNDRY_POTREE_V2_METADATA_MAX_BYTES
    : role === "hierarchy" ? FOUNDRY_POTREE_V2_HIERARCHY_MAX_BYTES : null;
  return { hash: createHash("sha256"), capture: limit === null ? null : new BoundedCapture(limit), observedBytes: 0 };
}

interface ParsedMetadata {
  readonly facts: FoundryPotreeV2BundleFacts["metadata"];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function exactKeys(
  value: Record<string, unknown>,
  required: readonly string[],
  optional: readonly string[] = [],
): void {
  const actual = Object.keys(value).sort();
  const expected = [...required, ...optional.filter((key) => value[key] !== undefined)].sort();
  if (actual.length !== expected.length || actual.some((key, index) => key !== expected[index])) {
    fail("POTREE_V2_METADATA_SCHEMA_INVALID");
  }
}

function finiteNumber(value: unknown, positive = false): number {
  if (typeof value !== "number" || !Number.isFinite(value) || (positive && value <= 0)) {
    fail("POTREE_V2_METADATA_SCHEMA_INVALID");
  }
  return value;
}

function boundedInteger(value: unknown, minimum: number, maximum: number): number {
  if (!Number.isSafeInteger(value) || (value as number) < minimum || (value as number) > maximum) {
    fail("POTREE_V2_METADATA_SCHEMA_INVALID");
  }
  return value as number;
}

function finiteVector(value: unknown, length: 1 | 3): number[] {
  if (!Array.isArray(value) || value.length !== length) fail("POTREE_V2_METADATA_SCHEMA_INVALID");
  return value.map((item) => finiteNumber(item));
}

function sameNumbers(left: readonly number[], right: readonly number[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

interface ExpectedAttribute {
  readonly name: "position" | "intensity" | "lcc prediction";
  readonly type: "int32" | "uint8";
  readonly sizeBytes: 12 | 1;
  readonly elementCount: 3 | 1;
  readonly elementSizeBytes: 4 | 1;
}

const EXPECTED_ATTRIBUTES = Object.freeze([
  { name: "position", type: "int32", sizeBytes: 12, elementCount: 3, elementSizeBytes: 4 },
  { name: "intensity", type: "uint8", sizeBytes: 1, elementCount: 1, elementSizeBytes: 1 },
  { name: "lcc prediction", type: "uint8", sizeBytes: 1, elementCount: 1, elementSizeBytes: 1 },
] as const satisfies readonly ExpectedAttribute[]);

function parseAttribute(value: unknown, expected: ExpectedAttribute): z.infer<typeof AttributeLayoutSchema> {
  if (!isRecord(value)) fail("POTREE_V2_METADATA_SCHEMA_INVALID");
  exactKeys(value, ["name", "description", "size", "numElements", "elementSize", "type", "min", "max", "scale", "offset"], ["histogram"]);
  if (value.name !== expected.name || value.type !== expected.type || typeof value.description !== "string") {
    fail("POTREE_V2_PROFILE_UNSUPPORTED");
  }
  if (value.size !== expected.sizeBytes || value.numElements !== expected.elementCount || value.elementSize !== expected.elementSizeBytes) {
    fail("POTREE_V2_PROFILE_UNSUPPORTED");
  }
  const minimum = finiteVector(value.min, expected.elementCount);
  const maximum = finiteVector(value.max, expected.elementCount);
  if (minimum.some((item, index) => item > (maximum[index] ?? item))) fail("POTREE_V2_METADATA_SCHEMA_INVALID");
  const scale = finiteVector(value.scale, expected.elementCount);
  const offset = finiteVector(value.offset, expected.elementCount);
  const expectedScale = expected.name === "position" ? [1, 1, 1] : [1];
  const expectedOffset = expected.name === "position" ? [0, 0, 0] : [0];
  if (!sameNumbers(scale, expectedScale) || !sameNumbers(offset, expectedOffset)) {
    fail("POTREE_V2_PROFILE_UNSUPPORTED");
  }
  const declaredMin = declaredVector(minimum, expected.elementCount);
  const declaredMax = declaredVector(maximum, expected.elementCount);
  if (expected.name !== "position" && (declaredMin[0] < 0 || declaredMax[0] > 255)) {
    fail("POTREE_V2_METADATA_SCHEMA_INVALID");
  }
  if (value.histogram !== undefined && (!Array.isArray(value.histogram) || value.histogram.some((item) => typeof item !== "number" || !Number.isFinite(item)))) {
    fail("POTREE_V2_METADATA_SCHEMA_INVALID");
  }
  return {
    name: expected.name,
    type: expected.type,
    sizeBytes: expected.sizeBytes,
    elementCount: expected.elementCount,
    elementSizeBytes: expected.elementSizeBytes,
    declaredMin,
    declaredMax,
    histogramDeclared: value.histogram !== undefined,
  };
}

function declaredVector(values: readonly number[], length: 1 | 3): [number] | [number, number, number] {
  const first = values[0];
  if (first === undefined) fail("POTREE_V2_METADATA_SCHEMA_INVALID");
  if (length === 1) return [first];
  const second = values[1];
  const third = values[2];
  if (second === undefined || third === undefined) fail("POTREE_V2_METADATA_SCHEMA_INVALID");
  return [first, second, third];
}

class StrictJsonParser {
  private index = 0;
  constructor(private readonly text: string) {}

  parse(): unknown {
    const value = this.value(0);
    this.space();
    if (this.index !== this.text.length) fail("POTREE_V2_METADATA_JSON_INVALID");
    return value;
  }

  private value(depth: number): unknown {
    if (depth > 64) fail("POTREE_V2_METADATA_JSON_INVALID");
    this.space();
    const token = this.text[this.index];
    if (token === "{") return this.object(depth + 1);
    if (token === "[") return this.array(depth + 1);
    if (token === "\"") return this.string();
    if (token === "t") return this.literal("true", true);
    if (token === "f") return this.literal("false", false);
    if (token === "n") return this.literal("null", null);
    return this.number();
  }

  private object(depth: number): Record<string, unknown> {
    this.index += 1;
    const result: Record<string, unknown> = {};
    const keys = new Set<string>();
    this.space();
    if (this.text[this.index] === "}") { this.index += 1; return result; }
    while (this.index < this.text.length) {
      if (this.text[this.index] !== "\"") fail("POTREE_V2_METADATA_JSON_INVALID");
      const key = this.string();
      if (keys.has(key)) fail("POTREE_V2_METADATA_JSON_DUPLICATE_KEY");
      keys.add(key);
      this.space();
      if (this.text[this.index] !== ":") fail("POTREE_V2_METADATA_JSON_INVALID");
      this.index += 1;
      result[key] = this.value(depth);
      this.space();
      const separator = this.text[this.index];
      this.index += 1;
      if (separator === "}") return result;
      if (separator !== ",") fail("POTREE_V2_METADATA_JSON_INVALID");
      this.space();
    }
    fail("POTREE_V2_METADATA_JSON_INVALID");
  }

  private array(depth: number): unknown[] {
    this.index += 1;
    const result: unknown[] = [];
    this.space();
    if (this.text[this.index] === "]") { this.index += 1; return result; }
    while (this.index < this.text.length) {
      result.push(this.value(depth));
      this.space();
      const separator = this.text[this.index];
      this.index += 1;
      if (separator === "]") return result;
      if (separator !== ",") fail("POTREE_V2_METADATA_JSON_INVALID");
      this.space();
    }
    fail("POTREE_V2_METADATA_JSON_INVALID");
  }

  private string(): string {
    const start = this.index;
    this.index += 1;
    let escaped = false;
    while (this.index < this.text.length) {
      const code = this.text.charCodeAt(this.index);
      if (!escaped && code === 0x22) {
        this.index += 1;
        return this.decodeString(this.text.slice(start, this.index));
      }
      if (!escaped && code < 0x20) fail("POTREE_V2_METADATA_JSON_INVALID");
      if (!escaped && code === 0x5c) escaped = true;
      else escaped = false;
      this.index += 1;
    }
    fail("POTREE_V2_METADATA_JSON_INVALID");
  }

  private decodeString(token: string): string {
    try {
      const value: unknown = JSON.parse(token);
      if (typeof value !== "string" || !validUnicodeScalars(value)) fail("POTREE_V2_METADATA_JSON_INVALID");
      return value;
    } catch (error: unknown) {
      if (error instanceof PotreeInspectionFailure) throw error;
      fail("POTREE_V2_METADATA_JSON_INVALID");
    }
  }

  private number(): number {
    const match = /^-?(?:0|[1-9][0-9]*)(?:\.[0-9]+)?(?:[eE][+-]?[0-9]+)?/u.exec(this.text.slice(this.index));
    if (match === null) fail("POTREE_V2_METADATA_JSON_INVALID");
    this.index += match[0].length;
    const value = Number(match[0]);
    if (!Number.isFinite(value)) fail("POTREE_V2_METADATA_JSON_INVALID");
    return value;
  }

  private literal<T>(token: string, value: T): T {
    if (!this.text.startsWith(token, this.index)) fail("POTREE_V2_METADATA_JSON_INVALID");
    this.index += token.length;
    return value;
  }

  private space(): void {
    while (this.index < this.text.length) {
      const code = this.text.charCodeAt(this.index);
      if (code !== 0x09 && code !== 0x0a && code !== 0x0d && code !== 0x20) return;
      this.index += 1;
    }
  }
}

function validUnicodeScalars(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code >= 0xd800 && code <= 0xdbff) {
      const next = value.charCodeAt(index + 1);
      if (next < 0xdc00 || next > 0xdfff) return false;
      index += 1;
    } else if (code >= 0xdc00 && code <= 0xdfff) return false;
  }
  return true;
}

function parseMetadata(bytes: Buffer): ParsedMetadata {
  let text: string;
  try {
    text = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(bytes);
  } catch {
    fail("POTREE_V2_METADATA_UTF8_INVALID");
  }
  const root = new StrictJsonParser(text).parse();
  if (!isRecord(root)) fail("POTREE_V2_METADATA_SCHEMA_INVALID");
  exactKeys(root, ["version", "name", "description", "points", "projection", "hierarchy", "offset", "scale", "spacing", "boundingBox", "encoding", "attributes"]);
  if (root.version !== "2.0" || root.encoding !== "DEFAULT" || root.name !== "potree") {
    fail("POTREE_V2_PROFILE_UNSUPPORTED");
  }
  if (typeof root.description !== "string" || typeof root.projection !== "string") fail("POTREE_V2_METADATA_SCHEMA_INVALID");
  const pointCount = boundedInteger(root.points, 1, Number.MAX_SAFE_INTEGER);
  if (pointCount > FOUNDRY_POTREE_V2_POINT_MAX_COUNT) fail("POTREE_V2_POINT_COUNT_LIMIT_EXCEEDED");
  if (!isRecord(root.hierarchy)) fail("POTREE_V2_METADATA_SCHEMA_INVALID");
  exactKeys(root.hierarchy, ["firstChunkSize", "stepSize", "depth"]);
  const firstChunk = boundedInteger(root.hierarchy.firstChunkSize, 1, FOUNDRY_POTREE_V2_HIERARCHY_MAX_BYTES);
  const stepSize = boundedInteger(root.hierarchy.stepSize, 1, 64);
  const depth = boundedInteger(root.hierarchy.depth, 0, 64);
  const offset = finiteVector(root.offset, 3) as [number, number, number];
  const scale = finiteVector(root.scale, 3) as [number, number, number];
  if (scale.some((item) => item <= 0)) fail("POTREE_V2_METADATA_SCHEMA_INVALID");
  const spacing = finiteNumber(root.spacing, true);
  if (!isRecord(root.boundingBox)) fail("POTREE_V2_METADATA_SCHEMA_INVALID");
  exactKeys(root.boundingBox, ["min", "max"]);
  const minimum = finiteVector(root.boundingBox.min, 3) as [number, number, number];
  const maximum = finiteVector(root.boundingBox.max, 3) as [number, number, number];
  if (minimum.some((item, index) => item >= (maximum[index] ?? item)) || !sameNumbers(offset, minimum)) {
    fail("POTREE_V2_METADATA_SCHEMA_INVALID");
  }
  if (!Array.isArray(root.attributes) || root.attributes.length !== EXPECTED_ATTRIBUTES.length) {
    fail("POTREE_V2_PROFILE_UNSUPPORTED");
  }
  const rawAttributes = root.attributes;
  const attributes = EXPECTED_ATTRIBUTES.map((expected, index) => parseAttribute(rawAttributes[index], expected));
  const [positionAttribute, intensityAttribute, predictionAttribute] = attributes;
  if (positionAttribute === undefined || intensityAttribute === undefined || predictionAttribute === undefined ||
      positionAttribute.declaredMin.length !== 3 || positionAttribute.declaredMax.length !== 3) {
    fail("POTREE_V2_METADATA_SCHEMA_INVALID");
  }
  for (let index = 0; index < 3; index += 1) {
    const occupiedMinimum = positionAttribute.declaredMin[index];
    const occupiedMaximum = positionAttribute.declaredMax[index];
    const boxMinimum = minimum[index];
    const boxMaximum = maximum[index];
    if (occupiedMinimum === undefined || occupiedMaximum === undefined || boxMinimum === undefined || boxMaximum === undefined ||
        occupiedMinimum < boxMinimum || occupiedMaximum > boxMaximum) {
      fail("POTREE_V2_METADATA_SCHEMA_INVALID");
    }
  }
  return {
    facts: {
      version: "2.0",
      encoding: "DEFAULT",
      name: "potree",
      pointCount,
      hierarchyFirstChunkSizeBytes: firstChunk,
      hierarchyStepSize: stepSize,
      declaredHierarchyDepth: depth,
      declaredOffset: offset,
      declaredScale: scale,
      declaredSpacing: spacing,
      declaredBoundingBox: { min: minimum, max: maximum },
      attributes: [positionAttribute, intensityAttribute, predictionAttribute],
      recordStrideBytes: FOUNDRY_POTREE_V2_POINT_RECORD_BYTES,
    },
  };
}

interface ByteRange { readonly start: number; readonly end: number }
interface ProxyExpectation { readonly childMask: number; readonly pointCount: number }
interface ChunkWork extends ByteRange {
  readonly rootName: string;
  readonly expectedProxy: ProxyExpectation | null;
}
interface PayloadRange extends ByteRange { readonly pointCount: number }
interface HierarchyInspection {
  readonly facts: FoundryPotreeV2BundleFacts["hierarchy"];
  readonly octreeRanges: readonly PayloadRange[];
}

const SIGNED_U64_MAX = (1n << 63n) - 1n;

function boundedU64(buffer: Buffer, offset: number): number {
  const value = buffer.readBigUInt64LE(offset);
  if (value > SIGNED_U64_MAX || value > BigInt(Number.MAX_SAFE_INTEGER)) {
    fail("POTREE_V2_HIERARCHY_INTEGER_OUT_OF_RANGE");
  }
  return Number(value);
}

function childNames(parent: string, mask: number): string[] {
  if (parent.length >= 65) fail("POTREE_V2_HIERARCHY_NODE_LIMIT_EXCEEDED");
  const children: string[] = [];
  for (let index = 0; index < 8; index += 1) {
    if ((mask & (1 << index)) !== 0) children.push(`${parent}${String(index)}`);
  }
  return children;
}

function assertChunkRange(work: ChunkWork, hierarchyBytes: number): void {
  const size = work.end - work.start;
  if (work.start < 0 || size <= 0 || work.end > hierarchyBytes ||
      work.start % FOUNDRY_POTREE_V2_HIERARCHY_RECORD_BYTES !== 0 ||
      size % FOUNDRY_POTREE_V2_HIERARCHY_RECORD_BYTES !== 0) {
    fail("POTREE_V2_HIERARCHY_CHUNK_RANGE_INVALID");
  }
}

function intersects(left: ByteRange, right: ByteRange): boolean {
  return left.start < right.end && right.start < left.end;
}

function inspectHierarchyChunk(
  payload: Buffer,
  work: ChunkWork,
  chunks: ChunkWork[],
  payloadRanges: PayloadRange[],
  realNames: Set<string>,
  counters: {
    normal: number;
    leaf: number;
    proxy: number;
    proxyReplacementChildMaskMismatches: number;
    proxyReplacementPointCountMismatches: number;
    leafWithChildren: number;
    records: number;
    points: number;
    maximumDepth: number;
  },
): void {
  const names = [work.rootName];
  let nameIndex = 0;
  for (let recordOffset = work.start; recordOffset < work.end; recordOffset += FOUNDRY_POTREE_V2_HIERARCHY_RECORD_BYTES) {
    const name = names[nameIndex];
    if (name === undefined) fail("POTREE_V2_HIERARCHY_BFS_COUNT_MISMATCH");
    nameIndex += 1;
    const type = payload.readUInt8(recordOffset);
    const childMask = payload.readUInt8(recordOffset + 1);
    const pointCount = payload.readUInt32LE(recordOffset + 2);
    const byteOffset = boundedU64(payload, recordOffset + 6);
    const byteSize = boundedU64(payload, recordOffset + 14);
    counters.records += 1;
    if (counters.records > FOUNDRY_POTREE_V2_HIERARCHY_NODE_MAX_COUNT) {
      fail("POTREE_V2_HIERARCHY_NODE_LIMIT_EXCEEDED");
    }
    if (recordOffset === work.start && work.expectedProxy !== null) {
      if (childMask !== work.expectedProxy.childMask) {
        counters.proxyReplacementChildMaskMismatches += 1;
      }
      if (pointCount !== work.expectedProxy.pointCount) {
        counters.proxyReplacementPointCountMismatches += 1;
      }
    }
    if (recordOffset === work.start && type === 2) {
      fail("POTREE_V2_HIERARCHY_PROXY_REPLACEMENT_MISMATCH");
    }
    if (type === 2) {
      counters.proxy += 1;
      if (byteSize <= 0 || !Number.isSafeInteger(byteOffset + byteSize)) fail("POTREE_V2_HIERARCHY_CHUNK_RANGE_INVALID");
      chunks.push({ start: byteOffset, end: byteOffset + byteSize, rootName: name, expectedProxy: { childMask, pointCount } });
      if (chunks.length > FOUNDRY_POTREE_V2_HIERARCHY_NODE_MAX_COUNT) {
        fail("POTREE_V2_HIERARCHY_NODE_LIMIT_EXCEEDED");
      }
      continue;
    }
    if (type !== 0 && type !== 1) fail("POTREE_V2_HIERARCHY_NODE_TYPE_INVALID");
    if (realNames.has(name)) fail("POTREE_V2_HIERARCHY_BFS_COUNT_MISMATCH");
    realNames.add(name);
    counters.maximumDepth = Math.max(counters.maximumDepth, name.length - 1);
    if (type === 0) counters.normal += 1;
    else {
      counters.leaf += 1;
      if (childMask !== 0) counters.leafWithChildren += 1;
    }
    const expectedBytes = pointCount * FOUNDRY_POTREE_V2_POINT_RECORD_BYTES;
    if (!Number.isSafeInteger(expectedBytes) || byteSize !== expectedBytes) {
      fail("POTREE_V2_HIERARCHY_NODE_BYTE_SIZE_MISMATCH");
    }
    if (!Number.isSafeInteger(byteOffset + byteSize)) fail("POTREE_V2_HIERARCHY_INTEGER_OUT_OF_RANGE");
    payloadRanges.push({ start: byteOffset, end: byteOffset + byteSize, pointCount });
    if (!Number.isSafeInteger(counters.points + pointCount)) {
      fail("POTREE_V2_HIERARCHY_INTEGER_OUT_OF_RANGE");
    }
    counters.points += pointCount;
    names.push(...childNames(name, childMask));
  }
  if (nameIndex !== names.length) fail("POTREE_V2_HIERARCHY_BFS_COUNT_MISMATCH");
}

function inspectHierarchy(
  payload: Buffer,
  metadata: FoundryPotreeV2BundleFacts["metadata"],
): HierarchyInspection {
  const firstSize = metadata.hierarchyFirstChunkSizeBytes;
  if (firstSize > payload.length || firstSize % FOUNDRY_POTREE_V2_HIERARCHY_RECORD_BYTES !== 0) {
    fail("POTREE_V2_HIERARCHY_FIRST_CHUNK_INVALID");
  }
  const chunks: ChunkWork[] = [{ start: 0, end: firstSize, rootName: "r", expectedProxy: null }];
  const visited = new Set<string>();
  const visitedRanges: ByteRange[] = [];
  const payloadRanges: PayloadRange[] = [];
  const realNames = new Set<string>();
  const counters = {
    normal: 0,
    leaf: 0,
    proxy: 0,
    proxyReplacementChildMaskMismatches: 0,
    proxyReplacementPointCountMismatches: 0,
    leafWithChildren: 0,
    records: 0,
    points: 0,
    maximumDepth: 0,
  };
  for (let chunkIndex = 0; chunkIndex < chunks.length; chunkIndex += 1) {
    const work = chunks[chunkIndex];
    if (work === undefined) fail("POTREE_V2_INSPECTION_FAILED");
    assertChunkRange(work, payload.length);
    const key = `${String(work.start)}:${String(work.end)}`;
    if (visited.has(key)) fail("POTREE_V2_HIERARCHY_PROXY_CYCLE");
    if (visitedRanges.some((range) => intersects(range, work))) fail("POTREE_V2_HIERARCHY_CHUNK_OVERLAP");
    visited.add(key);
    visitedRanges.push({ start: work.start, end: work.end });
    inspectHierarchyChunk(payload, work, chunks, payloadRanges, realNames, counters);
  }
  const reachableBytes = visitedRanges.reduce((total, range) => total + range.end - range.start, 0);
  const unreferencedBytes = payload.length - reachableBytes;
  if (unreferencedBytes > 0) {
    throw new PotreeInspectionFailure(
      "POTREE_V2_HIERARCHY_UNREACHABLE_BYTES",
      { kind: "hierarchy_reachability", hierarchySizeBytes: payload.length, reachableHierarchyBytes: reachableBytes, unreferencedHierarchyBytes: unreferencedBytes },
    );
  }
  if (counters.points !== metadata.pointCount) fail("POTREE_V2_HIERARCHY_POINT_COUNT_MISMATCH");
  return {
    facts: {
      sourceSizeBytes: payload.length,
      recordSizeBytes: FOUNDRY_POTREE_V2_HIERARCHY_RECORD_BYTES,
      reachableChunkCount: visitedRanges.length,
      reachableRecordCount: counters.records,
      logicalNodeCount: realNames.size,
      normalNodeCount: counters.normal,
      leafNodeCount: counters.leaf,
      proxyReferenceCount: counters.proxy,
      proxyReplacementChildMaskMismatchCount:
        counters.proxyReplacementChildMaskMismatches,
      proxyReplacementPointCountMismatchCount:
        counters.proxyReplacementPointCountMismatches,
      leafRecordsWithChildren: counters.leafWithChildren,
      maximumObservedDepth: counters.maximumDepth,
      declaredDepthMatchesObservedMaximum: metadata.declaredHierarchyDepth === counters.maximumDepth,
      reachableHierarchyBytes: reachableBytes,
      unreferencedHierarchyBytes: 0,
      hierarchyChunkRangesDisjoint: true,
      pointCountSum: counters.points,
    },
    octreeRanges: payloadRanges,
  };
}

function inspectOctreeRanges(ranges: readonly PayloadRange[], octreeSize: number): FoundryPotreeV2BundleFacts["octree"] {
  for (const range of ranges) {
    if (range.start < 0 || range.end < range.start || range.end > octreeSize) {
      fail("POTREE_V2_OCTREE_RANGE_OUT_OF_BOUNDS");
    }
  }
  const sorted = [...ranges].filter((range) => range.end > range.start).sort((left, right) => left.start - right.start || left.end - right.end);
  let cursor = 0;
  for (const range of sorted) {
    if (range.start < cursor) fail("POTREE_V2_OCTREE_RANGE_OVERLAP");
    if (range.start > cursor) fail("POTREE_V2_OCTREE_RANGE_GAP");
    cursor = range.end;
  }
  if (cursor < octreeSize) fail("POTREE_V2_OCTREE_RANGE_GAP");
  return {
    sourceSizeBytes: octreeSize,
    expectedSizeFromMetadataBytes: octreeSize,
    payloadRangeCount: sorted.length,
    coveredBytes: cursor,
    payloadRangesDisjointAndGapless: true,
  };
}

function failureObservations(error: PotreeInspectionFailure): z.infer<typeof ReachabilityObservationSchema> | undefined {
  const parsed = ReachabilityObservationSchema.safeParse(error.observations);
  return parsed.success ? parsed.data : undefined;
}

export interface FoundryPotreeV2SourceFactsCollector {
  observeMember(role: FoundryPotreeV2BundleMemberRole, chunk: Uint8Array, absoluteOffset: number): void;
  finalize(memberIdentities: readonly FoundryPotreeV2BundleMemberIdentity[]): FoundryPotreeV2SourceFactsOutcome;
}

class PotreeV2SourceFactsCollectorImpl implements FoundryPotreeV2SourceFactsCollector {
  private readonly streams: Readonly<Record<FoundryPotreeV2BundleMemberRole, MemberStreamState>> = {
    metadata: newMemberState("metadata"),
    hierarchy: newMemberState("hierarchy"),
    octree: newMemberState("octree"),
  };
  private deferredFailure: FailureCode | null = null;
  private finalized = false;

  constructor(private readonly bundleRoot: string, private readonly signal: AbortSignal | undefined) {}

  observeMember(role: FoundryPotreeV2BundleMemberRole, chunk: Uint8Array, absoluteOffset: number): void {
    if (this.finalized) throw new Error("Potree v2 Source Facts collector is already finalized.");
    if (this.signal?.aborted === true) { this.deferredFailure = "POTREE_V2_INSPECTION_CANCELLED"; return; }
    const state = this.streams[role];
    if (!(chunk instanceof Uint8Array) || absoluteOffset !== state.observedBytes || !Number.isSafeInteger(absoluteOffset)) {
      this.deferredFailure ??= "POTREE_V2_MEMBER_STREAM_NONCONTIGUOUS";
      return;
    }
    if (!Number.isSafeInteger(state.observedBytes + chunk.length)) {
      this.deferredFailure ??= role === "octree" ? "POTREE_V2_OCTREE_SIZE_LIMIT_EXCEEDED" : role === "hierarchy" ? "POTREE_V2_HIERARCHY_SIZE_LIMIT_EXCEEDED" : "POTREE_V2_METADATA_SIZE_LIMIT_EXCEEDED";
      return;
    }
    state.hash.update(chunk);
    state.observedBytes += chunk.length;
    if (state.capture !== null && !state.capture.append(chunk)) {
      this.deferredFailure ??= role === "metadata" ? "POTREE_V2_METADATA_SIZE_LIMIT_EXCEEDED" : "POTREE_V2_HIERARCHY_SIZE_LIMIT_EXCEEDED";
    }
    if (role === "octree" && state.observedBytes > FOUNDRY_POTREE_V2_OCTREE_MAX_BYTES) {
      this.deferredFailure ??= "POTREE_V2_OCTREE_SIZE_LIMIT_EXCEEDED";
    }
  }

  finalize(memberIdentities: readonly FoundryPotreeV2BundleMemberIdentity[]): FoundryPotreeV2SourceFactsOutcome {
    if (this.finalized) throw new Error("Potree v2 Source Facts collector is already finalized.");
    this.finalized = true;
    const parsedMembers = z.array(FoundryPotreeV2BundleMemberIdentitySchema).safeParse(memberIdentities);
    const members = parsedMembers.success ? this.sortedMembers(parsedMembers.data) : [];
    if (members.length !== 3) return this.failure(members.slice(0, 3), "POTREE_V2_MEMBER_SET_INVALID");
    if (this.signal?.aborted === true || this.deferredFailure === "POTREE_V2_INSPECTION_CANCELLED") {
      return this.failure(members, "POTREE_V2_INSPECTION_CANCELLED");
    }
    if (this.deferredFailure !== null) return this.failure(members, this.deferredFailure);
    const identityFailure = this.bindMembers(members);
    if (identityFailure !== null) return this.failure(members, identityFailure);
    try {
      const metadataCapture = this.streams.metadata.capture;
      const hierarchyCapture = this.streams.hierarchy.capture;
      if (metadataCapture === null || hierarchyCapture === null) fail("POTREE_V2_INSPECTION_FAILED");
      const metadata = parseMetadata(metadataCapture.finish()).facts;
      const expectedOctreeBytes = metadata.pointCount * FOUNDRY_POTREE_V2_POINT_RECORD_BYTES;
      if (!Number.isSafeInteger(expectedOctreeBytes) || expectedOctreeBytes !== this.streams.octree.observedBytes) {
        fail("POTREE_V2_OCTREE_LENGTH_MISMATCH");
      }
      const hierarchy = inspectHierarchy(hierarchyCapture.finish(), metadata);
      const octree = inspectOctreeRanges(hierarchy.octreeRanges, this.streams.octree.observedBytes);
      const histogramCount = metadata.attributes.filter((attribute) => attribute.histogramDeclared).length;
      return FoundryPotreeV2SourceFactsOutcomeSchema.parse({
        bundleRoot: this.bundleRoot,
        members,
        state: "established",
        facts: {
          format: "potree_v2_three_member_bundle",
          profile: "xgrids_default_position_intensity_lcc_prediction_14_byte",
          inspectionCoverage: "complete_metadata_hierarchy_graph_and_octree_layout",
          metadata,
          hierarchy: hierarchy.facts,
          octree: { ...octree, expectedSizeFromMetadataBytes: expectedOctreeBytes },
          compatibility: {
            declaredHierarchyDepth: hierarchy.facts.declaredDepthMatchesObservedMaximum
              ? "matches_observed"
              : "differs_from_observed_accepted",
            leafChildMasks: hierarchy.facts.leafRecordsWithChildren === 0
              ? "none_observed"
              : "observed_and_accepted_by_official_loader_semantics",
            proxyReplacementDeclarations:
              hierarchy.facts.proxyReferenceCount === 0
                ? "no_proxies"
                : hierarchy.facts.proxyReplacementChildMaskMismatchCount === 0 &&
                    hierarchy.facts.proxyReplacementPointCountMismatchCount === 0
                  ? "all_match"
                  : "target_record_overwrite_mismatches_observed_and_accepted",
            attributeHistograms: histogramCount === metadata.attributes.length
              ? "all_declared"
              : histogramCount === 0 ? "omitted_and_accepted" : "partially_declared",
          },
          limitations: FOUNDRY_POTREE_V2_SOURCE_FACTS_LIMITATIONS,
        },
      });
    } catch (error: unknown) {
      if (error instanceof PotreeInspectionFailure) return this.failure(members, error.code, failureObservations(error));
      return this.failure(members, "POTREE_V2_INSPECTION_FAILED");
    }
  }

  private sortedMembers(members: readonly FoundryPotreeV2BundleMemberIdentity[]): FoundryPotreeV2BundleMemberIdentity[] {
    return [...members].sort((left, right) => FOUNDRY_POTREE_V2_MEMBER_ROLES.indexOf(left.role) - FOUNDRY_POTREE_V2_MEMBER_ROLES.indexOf(right.role));
  }

  private bindMembers(members: readonly FoundryPotreeV2BundleMemberIdentity[]): FailureCode | null {
    const roles = new Set(members.map((member) => member.role));
    if (roles.size !== 3) return "POTREE_V2_MEMBER_SET_INVALID";
    for (const member of members) {
      const expectedPath = this.bundleRoot === "" ? MEMBER_FILE_BY_ROLE[member.role] : `${this.bundleRoot}/${MEMBER_FILE_BY_ROLE[member.role]}`;
      if (member.path !== expectedPath) return "POTREE_V2_MEMBER_PATH_MISMATCH";
      const stream = this.streams[member.role];
      if (member.sizeBytes !== stream.observedBytes) return "POTREE_V2_MEMBER_SIZE_MISMATCH";
      if (member.sha256 !== stream.hash.digest("hex")) return "POTREE_V2_MEMBER_SHA256_MISMATCH";
    }
    return null;
  }

  private failure(
    members: readonly FoundryPotreeV2BundleMemberIdentity[],
    code: FailureCode,
    observations?: z.infer<typeof ReachabilityObservationSchema>,
  ): FoundryPotreeV2SourceFactsOutcome {
    const category: FailureCategory = FOUNDRY_POTREE_V2_SOURCE_FACTS_FAILURE_CATEGORY_BY_CODE[code];
    const base = { bundleRoot: this.bundleRoot, members, state: "facts_not_established" as const, category, code };
    return FoundryPotreeV2SourceFactsOutcomeSchema.parse(observations === undefined ? base : { ...base, observations });
  }
}

export function createPotreeV2SourceFactsCollector(
  bundleRootInput: string,
  signal?: AbortSignal,
): FoundryPotreeV2SourceFactsCollector {
  const bundleRoot = canonicalRelativePath(bundleRootInput, true);
  if (bundleRoot === null) throw new Error("Potree v2 bundle root must be a canonical relative path.");
  return new PotreeV2SourceFactsCollectorImpl(bundleRoot, signal);
}
