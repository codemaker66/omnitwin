import { z } from "zod";
import {
  sha256Hex,
  stableCanonicalJson,
} from "./canonical-layout-snapshot.js";
import { RuntimeSlugSchema } from "./asset-version.js";
import {
  ReconstructionReleaseArtifactRefSchema,
  ReconstructionReleaseManifestSchema,
  ReconstructionReleaseObjectPathSchema,
  ReconstructionReleaseSha256Schema,
  type ReconstructionReleaseArtifactRef,
  type ReconstructionReleaseManifest,
} from "./reconstruction-release.js";
import {
  RuntimeManifestKeySchema,
  RuntimeTransformReferenceSchema,
  TransformArtifactV0Schema,
  type TransformArtifactV0,
} from "./runtime-venue-manifest.js";
import { TruthConfidenceTierSchema } from "./truth-mode.js";
import { TwinManifestSchema, type TwinManifest } from "./twin.js";

export const RECONSTRUCTION_SCENE_AUTHORITY_MAP_SCHEMA_VERSION =
  "venviewer.scene-authority-map.v0";
export const RECONSTRUCTION_SCENE_MAX_EXPANDED_REGION_NODE_REFERENCES = 65_536;
export const RECONSTRUCTION_SCENE_MAX_NORMALIZED_PROJECTION_BYTES =
  4 * 1024 * 1024;

export const RECONSTRUCTION_REVIEW_EVIDENCE_ARTIFACT_KINDS = [
  "transform_artifact_v0",
  "scene_authority_map_v0",
] as const;
export const ReconstructionReviewEvidenceArtifactKindSchema = z.enum(
  RECONSTRUCTION_REVIEW_EVIDENCE_ARTIFACT_KINDS,
);
export type ReconstructionReviewEvidenceArtifactKind = z.infer<
  typeof ReconstructionReviewEvidenceArtifactKindSchema
>;

export const RECONSTRUCTION_SCENE_TRUTH_STATUSES = [
  "measured",
  "inferred",
  "generated",
  "proxy",
  "presentation_enhanced",
] as const;
export const ReconstructionSceneTruthStatusSchema = z.enum(
  RECONSTRUCTION_SCENE_TRUTH_STATUSES,
);

export const RECONSTRUCTION_STRATEGIES = [
  "matterpak_original",
  "e57_poisson",
  "e57_bpa",
  "e57_dual_meshing",
  "realityscan_hybrid",
  "pgsr_mesh_extract",
  "twodgs_mesh_extract",
  "neural_surface_reconstruction",
  "manual_artist_proxy",
  "geometry_nodes_parametric",
  "kitbash_proxy",
  "procedural_runtime",
] as const;
export const ReconstructionStrategySchema = z.enum(RECONSTRUCTION_STRATEGIES);

const SAFE_AUTHORITY_REFERENCE = /^[A-Za-z0-9._~!$&'()*+,;=:@/-]+$/u;
const NamedAuthorityReferenceSchema = z.object({
  kind: z.enum(["runtime_layer", "semantic_graph", "external_artifact"]),
  ref: z.string().trim().min(1).max(1024).regex(SAFE_AUTHORITY_REFERENCE),
}).strict();

export const ReconstructionSceneAuthorityReferenceSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("release_file"),
    ref: ReconstructionReleaseObjectPathSchema,
  }).strict(),
  NamedAuthorityReferenceSchema,
  z.object({ kind: z.literal("none"), ref: z.null() }).strict(),
]);
export type ReconstructionSceneAuthorityReference = z.infer<
  typeof ReconstructionSceneAuthorityReferenceSchema
>;

const SceneAuthorityMapScopeSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("whole_venue") }).strict(),
  z.object({
    kind: z.literal("twin_nodes"),
    nodeIds: z.array(RuntimeManifestKeySchema).min(1).max(2_000),
  }).strict(),
  z.object({
    kind: z.literal("bounds_cvf"),
    min: z.tuple([z.number().finite(), z.number().finite(), z.number().finite()]),
    max: z.tuple([z.number().finite(), z.number().finite(), z.number().finite()]),
  }).strict(),
]).superRefine((scope, ctx) => {
  if (scope.kind === "twin_nodes" && new Set(scope.nodeIds).size !== scope.nodeIds.length) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["nodeIds"],
      message: "Scene Authority Map node IDs must be unique.",
    });
  }
  if (scope.kind === "bounds_cvf") {
    for (const axis of [0, 1, 2] as const) {
      if (scope.min[axis] >= scope.max[axis]) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["max", axis],
          message: "Scene Authority Map bounds max must exceed min on every axis.",
        });
      }
    }
  }
});

const SceneAuthoritiesSchema = z.object({
  geometryAuthority: ReconstructionSceneAuthorityReferenceSchema,
  appearanceAuthority: ReconstructionSceneAuthorityReferenceSchema,
  lightingAuthority: ReconstructionSceneAuthorityReferenceSchema,
  physicsAuthority: ReconstructionSceneAuthorityReferenceSchema,
  semanticAuthority: ReconstructionSceneAuthorityReferenceSchema,
  interactionAuthority: ReconstructionSceneAuthorityReferenceSchema,
  exportAuthority: ReconstructionSceneAuthorityReferenceSchema,
}).strict();

export const ReconstructionSceneAuthorityRegionV0Schema = z.object({
  id: RuntimeManifestKeySchema,
  label: z.string().trim().min(1).max(200),
  scope: SceneAuthorityMapScopeSchema,
  authorities: SceneAuthoritiesSchema,
  truthStatus: ReconstructionSceneTruthStatusSchema,
  confidenceTier: TruthConfidenceTierSchema,
  provenanceRefs: z.array(RuntimeTransformReferenceSchema).min(1).max(200),
  reconstructionStrategy: ReconstructionStrategySchema,
  transformArtifactRef: ReconstructionReleaseArtifactRefSchema,
}).strict();
export type ReconstructionSceneAuthorityRegionV0 = z.infer<
  typeof ReconstructionSceneAuthorityRegionV0Schema
>;

export const ReconstructionSceneAuthorityMapV0Schema = z.object({
  schemaVersion: z.literal(RECONSTRUCTION_SCENE_AUTHORITY_MAP_SCHEMA_VERSION),
  id: RuntimeManifestKeySchema,
  venueSlug: RuntimeSlugSchema,
  generatedAt: z.string().datetime({ offset: true }),
  regions: z.array(ReconstructionSceneAuthorityRegionV0Schema).min(1).max(2_000),
}).strict().superRefine((map, ctx) => {
  const ids = map.regions.map((region) => region.id);
  if (new Set(ids).size !== ids.length) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["regions"],
      message: "Scene Authority Map region IDs must be unique.",
    });
  }
});
export type ReconstructionSceneAuthorityMapV0 = z.infer<
  typeof ReconstructionSceneAuthorityMapV0Schema
>;

export interface ReconstructionSceneAuthorityCoverageProjection {
  readonly roomProjection: {
    readonly projectionVersion: "venviewer.scene-room-node-projection.v1";
    readonly ordering: "source_twin_manifest_order";
    readonly spaceSlug: string | null;
    readonly roomTwinNodeIds: readonly string[];
  };
  readonly regionIds: readonly string[];
  readonly expectedTwinNodeIds: readonly string[];
  readonly coveredTwinNodeIds: readonly string[];
  readonly orderedRegions: readonly {
    readonly regionIndex: number;
    readonly regionId: string;
    readonly coveredTwinNodeIds: readonly string[];
  }[];
  readonly referencedReleasePaths: readonly string[];
  readonly orderedRuntimeLayers: readonly {
    readonly runtimeLayerIndex: number;
    readonly authorityReference: string;
    readonly coveredRegionIds: readonly string[];
  }[];
  readonly expandedRegionNodeReferenceCount: number;
  readonly normalizedProjectionByteLength: number;
}

function sameReleaseArtifactReference(
  left: ReconstructionReleaseArtifactRef,
  right: ReconstructionReleaseArtifactRef,
): boolean {
  return left.artifactId === right.artifactId &&
    left.artifactDigest === right.artifactDigest;
}

function isRuntimeVisualLayerReleasePath(path: string): boolean {
  const normalizedPath = path.toLowerCase();
  return normalizedPath.endsWith(".sog") || normalizedPath.endsWith(".spz");
}

/**
 * Resolves the canonical Scene coverage projection used by both the public
 * release-review gate and the historical-runtime private-byte verifier. The
 * expected whole-room universe is the exact signed source Twin node set, not
 * the Scene map's caller-declared region array.
 */
export function resolveReconstructionSceneAuthorityCoverage(input: {
  readonly map: ReconstructionSceneAuthorityMapV0;
  readonly twin: TwinManifest;
  readonly release: ReconstructionReleaseManifest;
  readonly selectedTransform: ReconstructionReleaseArtifactRef;
  readonly spaceSlug?: string;
  readonly rejectBoundsCvf?: boolean;
  readonly runtimeLayers?: readonly {
    readonly authorityReference: string;
  }[];
}): ReconstructionSceneAuthorityCoverageProjection {
  const map = ReconstructionSceneAuthorityMapV0Schema.parse(input.map);
  const twin = TwinManifestSchema.parse(input.twin);
  const release = ReconstructionReleaseManifestSchema.parse(input.release);
  const selectedTransform = ReconstructionReleaseArtifactRefSchema.parse(
    input.selectedTransform,
  );
  const nodeIds = twin.nodes.map((node) => node.id);
  const nodeIndices = twin.nodes.map((node) => node.index);
  if (
    new Set(nodeIds).size !== nodeIds.length ||
    new Set(nodeIndices).size !== nodeIndices.length
  ) {
    throw new TypeError("Source Twin node IDs and indices must be unique.");
  }
  if (
    input.spaceSlug !== undefined &&
    twin.nodes.some((node) => node.roomSlug === null)
  ) {
    throw new TypeError(
      "Room-scoped Scene verification requires every source Twin node to carry a roomSlug.",
    );
  }
  const scopedNodes = input.spaceSlug === undefined
    ? twin.nodes
    : twin.nodes.filter((node) => node.roomSlug === input.spaceSlug);
  if (scopedNodes.length === 0) {
    throw new TypeError("Source Twin contains no nodes for the exact room scope.");
  }
  const expectedTwinNodeIds = scopedNodes.map((node) => node.id);
  const scopedNodeOrder = new Map(
    expectedTwinNodeIds.map((nodeId, index) => [nodeId, index]),
  );
  let expandedRegionNodeReferenceCount = 0;
  for (const region of map.regions) {
    const regionReferenceCount = region.scope.kind === "twin_nodes"
      ? region.scope.nodeIds.length
      : scopedNodes.length;
    expandedRegionNodeReferenceCount += regionReferenceCount;
    if (
      expandedRegionNodeReferenceCount >
        RECONSTRUCTION_SCENE_MAX_EXPANDED_REGION_NODE_REFERENCES
    ) {
      throw new TypeError(
        "Scene Authority Map expanded region-node projection exceeds the bounded verification ceiling.",
      );
    }
  }
  const nodes = new Map(scopedNodes.map((node) => [node.id, node]));
  const coveredNodeIds = new Set<string>();
  const releaseFiles = new Map(release.files.map((file) => [file.path, file]));
  const runtimeLayerReferences = input.runtimeLayers?.map(
    (layer) => layer.authorityReference,
  ) ?? [];
  if (
    new Set(runtimeLayerReferences).size !== runtimeLayerReferences.length ||
    runtimeLayerReferences.some((reference) => reference.trim() !== reference)
  ) {
    throw new TypeError("Scene runtime-layer authority references must be exact and unique.");
  }
  const runtimeLayerRegions = new Map(
    runtimeLayerReferences.map((reference) => [reference, [] as string[]]),
  );
  const referencedReleasePaths: string[] = [];
  const orderedRegions: {
    readonly regionIndex: number;
    readonly regionId: string;
    readonly coveredTwinNodeIds: readonly string[];
  }[] = [];

  for (const [regionIndex, region] of map.regions.entries()) {
    const regionCoveredNodeIds = new Set<string>();
    if (!sameReleaseArtifactReference(region.transformArtifactRef, selectedTransform)) {
      throw new TypeError(
        `Scene Authority region ${region.id} is not bound to the selected TransformArtifact.`,
      );
    }
    if (region.scope.kind === "whole_venue") {
      if (
        input.spaceSlug !== undefined &&
        scopedNodes.length !== twin.nodes.length
      ) {
        throw new TypeError(
          `Scene Authority region ${region.id} cannot use whole_venue as proof for one room in a multi-room Twin.`,
        );
      }
      for (const nodeId of nodes.keys()) {
        coveredNodeIds.add(nodeId);
        regionCoveredNodeIds.add(nodeId);
      }
    } else if (region.scope.kind === "twin_nodes") {
      for (const nodeId of region.scope.nodeIds) {
        if (!nodes.has(nodeId)) {
          throw new TypeError(
            `Scene Authority region ${region.id} references an unknown Twin node: ${nodeId}.`,
          );
        }
        coveredNodeIds.add(nodeId);
        regionCoveredNodeIds.add(nodeId);
      }
    } else {
      if (input.rejectBoundsCvf === true) {
        throw new TypeError(
          `Scene Authority region ${region.id} uses bounds_cvf without an exact frame-transform proof.`,
        );
      }
      let boundedNodeCount = 0;
      for (const node of nodes.values()) {
        const [x, y, z] = node.pose.t;
        if (
          x >= region.scope.min[0] && x <= region.scope.max[0] &&
          y >= region.scope.min[1] && y <= region.scope.max[1] &&
          z >= region.scope.min[2] && z <= region.scope.max[2]
        ) {
          boundedNodeCount += 1;
          coveredNodeIds.add(node.id);
          regionCoveredNodeIds.add(node.id);
        }
      }
      if (boundedNodeCount === 0) {
        throw new TypeError(
          `Scene Authority region ${region.id} bounds cover no Twin nodes.`,
        );
      }
    }

    for (const [authoritySlot, authority] of Object.entries(
      region.authorities,
    )) {
      if (
        authority.kind !== "release_file" &&
        authority.kind !== "runtime_layer" &&
        authority.kind !== "none"
      ) {
        throw new TypeError(
          `Scene Authority region ${region.id} uses unresolved ${authority.kind} evidence.`,
        );
      }
      if (authority.kind === "release_file") {
        const releaseFile = releaseFiles.get(authority.ref);
        if (releaseFile === undefined) {
          throw new TypeError(
            `Scene Authority region ${region.id} references a file outside the exact release: ${authority.ref}.`,
          );
        }
        if (isRuntimeVisualLayerReleasePath(releaseFile.path)) {
          throw new TypeError(
            `Scene Authority region ${region.id} cannot use a SOG/SPZ visual runtime layer as release_file authority.`,
          );
        }
        referencedReleasePaths.push(authority.ref);
      }
      if (authority.kind === "runtime_layer") {
        if (authoritySlot !== "appearanceAuthority") {
          throw new TypeError(
            `Scene Authority region ${region.id} may use a visual runtime layer only for appearance authority.`,
          );
        }
        const regions = runtimeLayerRegions.get(authority.ref);
        if (regions === undefined) {
          throw new TypeError(
            `Scene Authority region ${region.id} references an unbound runtime layer: ${authority.ref}.`,
          );
        }
        if (!regions.includes(region.id)) regions.push(region.id);
      }
    }
    const requiredAuthorities = [
      ["geometry", region.authorities.geometryAuthority, new Set(["geometry"])],
      ["appearance", region.authorities.appearanceAuthority, new Set(["imagery"])],
      ["semantic", region.authorities.semanticAuthority, new Set(["manifest", "geometry"])],
      ["interaction", region.authorities.interactionAuthority, new Set(["manifest", "geometry"])],
    ] as const;
    for (const [label, authority, allowedRoles] of requiredAuthorities) {
      if (authority.kind === "runtime_layer") {
        if (label !== "appearance") {
          throw new TypeError(
            `Scene Authority region ${region.id} cannot use a runtime layer for ${label} authority.`,
          );
        }
        if (!runtimeLayerRegions.has(authority.ref)) {
          throw new TypeError(
            `Scene Authority region ${region.id} has an unbound ${label} runtime-layer authority.`,
          );
        }
        continue;
      }
      if (authority.kind !== "release_file") {
        throw new TypeError(
          `Scene Authority region ${region.id} needs an exact ${label} authority.`,
        );
      }
      const file = releaseFiles.get(authority.ref);
      if (file === undefined || !allowedRoles.has(file.role)) {
        throw new TypeError(
          `Scene Authority region ${region.id} has an invalid ${label} release-file authority.`,
        );
      }
    }
    orderedRegions.push(Object.freeze({
      regionIndex,
      regionId: region.id,
      coveredTwinNodeIds: Object.freeze(
        region.scope.kind === "whole_venue"
          ? [...expectedTwinNodeIds]
          : [...regionCoveredNodeIds].sort(
              (left, right) =>
                (scopedNodeOrder.get(left) ?? Number.MAX_SAFE_INTEGER) -
                (scopedNodeOrder.get(right) ?? Number.MAX_SAFE_INTEGER),
            ),
      ),
    }));
  }

  const exactCoveredTwinNodeIds = expectedTwinNodeIds.filter(
    (nodeId) => coveredNodeIds.has(nodeId),
  );
  if (exactCoveredTwinNodeIds.length !== expectedTwinNodeIds.length) {
    const missing = expectedTwinNodeIds.filter((id) => !coveredNodeIds.has(id));
    throw new TypeError(
      `Scene Authority Map does not cover every Twin node; missing ${missing.slice(0, 10).join(", ")}.`,
    );
  }
  const orderedRuntimeLayers = runtimeLayerReferences.map(
    (authorityReference, runtimeLayerIndex) => {
      const coveredRegionIds = runtimeLayerRegions.get(authorityReference);
      if (coveredRegionIds === undefined || coveredRegionIds.length === 0) {
        throw new TypeError(
          `Scene Authority Map does not cover runtime layer ${authorityReference}.`,
        );
      }
      return Object.freeze({
        runtimeLayerIndex,
        authorityReference,
        coveredRegionIds: Object.freeze(coveredRegionIds),
      });
    },
  );
  const projectionMaterial = {
    roomProjection: Object.freeze({
      projectionVersion: "venviewer.scene-room-node-projection.v1" as const,
      ordering: "source_twin_manifest_order" as const,
      spaceSlug: input.spaceSlug ?? null,
      roomTwinNodeIds: Object.freeze(expectedTwinNodeIds),
    }),
    regionIds: Object.freeze(map.regions.map((region) => region.id)),
    expectedTwinNodeIds: Object.freeze(expectedTwinNodeIds),
    coveredTwinNodeIds: Object.freeze(exactCoveredTwinNodeIds),
    orderedRegions: Object.freeze(orderedRegions),
    referencedReleasePaths: Object.freeze([...new Set(referencedReleasePaths)]),
    orderedRuntimeLayers: Object.freeze(orderedRuntimeLayers),
  };
  const normalizedProjectionByteLength = new TextEncoder().encode(
    stableCanonicalJson(projectionMaterial),
  ).byteLength;
  if (
    normalizedProjectionByteLength >
      RECONSTRUCTION_SCENE_MAX_NORMALIZED_PROJECTION_BYTES
  ) {
    throw new TypeError(
      "Scene Authority Map normalized projection exceeds the 4 MiB verification boundary.",
    );
  }
  return Object.freeze({
    ...projectionMaterial,
    expandedRegionNodeReferenceCount,
    normalizedProjectionByteLength,
  });
}

export type ReconstructionReviewEvidenceArtifactBody =
  | TransformArtifactV0
  | ReconstructionSceneAuthorityMapV0;

export function parseReconstructionReviewEvidenceArtifact(
  kind: ReconstructionReviewEvidenceArtifactKind,
  artifact: unknown,
): ReconstructionReviewEvidenceArtifactBody {
  return kind === "transform_artifact_v0"
    ? TransformArtifactV0Schema.parse(artifact)
    : ReconstructionSceneAuthorityMapV0Schema.parse(artifact);
}

export function reconstructionReviewEvidenceArtifactId(
  artifact: ReconstructionReviewEvidenceArtifactBody,
): string {
  return artifact.id;
}

export function reconstructionReviewEvidenceArtifactSchemaVersion(
  kind: ReconstructionReviewEvidenceArtifactKind,
): string {
  return kind === "transform_artifact_v0"
    ? "venviewer.transform-artifact.v0"
    : RECONSTRUCTION_SCENE_AUTHORITY_MAP_SCHEMA_VERSION;
}

export function canonicalReconstructionReviewEvidenceArtifact(
  artifact: ReconstructionReviewEvidenceArtifactBody,
): string {
  return stableCanonicalJson(artifact);
}

export function computeReconstructionReviewEvidenceArtifactDigest(
  artifact: ReconstructionReviewEvidenceArtifactBody,
): string {
  return sha256Hex(canonicalReconstructionReviewEvidenceArtifact(artifact));
}

export const ReconstructionReviewEvidenceArtifactRegistrationInputSchema = z.object({
  venueSlug: RuntimeSlugSchema,
  artifactKind: ReconstructionReviewEvidenceArtifactKindSchema,
  artifact: z.unknown(),
  idempotencyKey: z.string().trim().min(8).max(160).regex(/^[A-Za-z0-9._:-]+$/u),
}).strict().superRefine((input, ctx) => {
  if (input.artifactKind === "transform_artifact_v0") {
    const parsed = TransformArtifactV0Schema.safeParse(input.artifact);
    if (!parsed.success) {
      for (const issue of parsed.error.issues) {
        ctx.addIssue({ ...issue, path: ["artifact", ...issue.path] });
      }
    }
    return;
  }
  const parsed = ReconstructionSceneAuthorityMapV0Schema.safeParse(input.artifact);
  if (!parsed.success) {
    for (const issue of parsed.error.issues) {
      ctx.addIssue({ ...issue, path: ["artifact", ...issue.path] });
    }
    return;
  }
  if (parsed.data.venueSlug !== input.venueSlug) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["artifact", "venueSlug"],
      message: "Scene Authority Map venueSlug must match the registration scope.",
    });
  }
});
export type ReconstructionReviewEvidenceArtifactRegistrationInput = z.infer<
  typeof ReconstructionReviewEvidenceArtifactRegistrationInputSchema
>;

export const ReconstructionReviewEvidenceArtifactSchema = z.object({
  id: z.string().uuid(),
  venueSlug: RuntimeSlugSchema,
  artifactKind: ReconstructionReviewEvidenceArtifactKindSchema,
  artifactId: RuntimeManifestKeySchema,
  artifactDigest: ReconstructionReleaseSha256Schema,
  objectKey: ReconstructionReleaseObjectPathSchema,
  objectSha256: ReconstructionReleaseSha256Schema,
  sizeBytes: z.number().int().positive().max(4 * 1024 * 1024),
  schemaVersion: z.string().trim().min(1).max(120),
  registeredBy: z.string().uuid(),
  registeredAt: z.string().datetime({ offset: true }),
}).strict().superRefine((artifact, ctx) => {
  if (artifact.artifactDigest !== artifact.objectSha256) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["objectSha256"],
      message: "The immutable object digest must equal the canonical artifact digest.",
    });
  }
});
export type ReconstructionReviewEvidenceArtifact = z.infer<
  typeof ReconstructionReviewEvidenceArtifactSchema
>;

export const ReconstructionReviewEvidenceArtifactListSchema = z.object({
  venueSlug: RuntimeSlugSchema,
  artifacts: z.array(ReconstructionReviewEvidenceArtifactSchema),
}).strict();
export type ReconstructionReviewEvidenceArtifactList = z.infer<
  typeof ReconstructionReviewEvidenceArtifactListSchema
>;
