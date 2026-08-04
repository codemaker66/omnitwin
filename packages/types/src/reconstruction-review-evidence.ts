import { z } from "zod";
import {
  sha256Hex,
  stableCanonicalJson,
} from "./canonical-layout-snapshot.js";
import { RuntimeSlugSchema } from "./asset-version.js";
import {
  ReconstructionReleaseArtifactRefSchema,
  ReconstructionReleaseObjectPathSchema,
  ReconstructionReleaseSha256Schema,
} from "./reconstruction-release.js";
import {
  RuntimeManifestKeySchema,
  RuntimeTransformReferenceSchema,
  TransformArtifactV0Schema,
  type TransformArtifactV0,
} from "./runtime-venue-manifest.js";
import { TruthConfidenceTierSchema } from "./truth-mode.js";

export const RECONSTRUCTION_SCENE_AUTHORITY_MAP_SCHEMA_VERSION =
  "venviewer.scene-authority-map.v0";

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
