import { z } from "zod";
import {
  ExposureMetadataV0Schema,
  internalOnlyExposureMetadata,
} from "./exposure-metadata.js";
import { matrix4d, validateSimilarityTransformMatrix4d } from "./coordinate-frame.js";
import { SpaceIdSchema, SpaceSlugSchema } from "./space.js";
import { VenueIdSchema, VenueSlugSchema } from "./venue.js";

export const RUNTIME_VENUE_MANIFEST_V0_VERSION = "runtime-venue-manifest/v0";

export const RUNTIME_COORDINATE_SYSTEMS = [
  "rhs_y_up_meters",
  "rhs_z_up_meters",
  "matterport_local",
  "e57_local",
  "usd_rhs_y_up",
  "usd_rhs_z_up",
] as const;

export const RUNTIME_ASSET_ROLES = ["radiance", "geometry", "texture", "metadata"] as const;
export const RUNTIME_ASSET_FORMATS = ["spz", "ply", "splat", "glb", "gltf", "bin", "ktx2", "png", "jpg", "json"] as const;
export const RUNTIME_LAYER_KINDS = ["gaussian_splat", "mesh"] as const;
export const RUNTIME_TRANSFORM_FRAMES = [
  "CVF",
  "ARF",
  "RRF",
  "G",
  "M",
  "W",
  "COLMAP_RDF",
  "THREE_CAMERA",
] as const;
export const RUNTIME_TRANSFORM_ALIGNMENT_METHODS = [
  "manual_alignment",
  "icp",
  "landmark_solve",
  "matterport_e57_extraction",
  "blender_authored_placement",
  "known_pose_colmap",
  "unconstrained_colmap",
  "visual_alignment",
] as const;
export const RUNTIME_TRANSFORM_PROVENANCE_STATES = [
  "measured",
  "inferred",
  "generated",
] as const;
export const RUNTIME_TRANSFORM_REFERENCE_TYPES = [
  "capture_session",
  "asset_version",
  "runtime_package",
  "control_network",
  "landmark_set",
  "operator_note",
  "artifact",
] as const;
export const RUNTIME_TRANSFORM_ACTOR_TYPES = ["human", "pipeline", "tool"] as const;

export const IDENTITY_MATRIX4D = [
  1, 0, 0, 0,
  0, 1, 0, 0,
  0, 0, 1, 0,
  0, 0, 0, 1,
] as const;

const SAFE_RELATIVE_PATH = /^[A-Za-z0-9._~!$&'()*+,;=:@/-]+$/;
const SAFE_MANIFEST_KEY = /^[a-z0-9][a-z0-9._-]*$/;
const SAFE_HTTP_URI = /^https?:\/\/[A-Za-z0-9.-]+(?::[0-9]{1,5})?(?:\/[A-Za-z0-9._~%!$&'()*+,;=:@/?#-]*)?$/u;

function hasExplicitScheme(value: string): boolean {
  return /^[A-Za-z][A-Za-z0-9+.-]*:/u.test(value);
}

function isHttpAssetUri(value: string): boolean {
  return SAFE_HTTP_URI.test(value);
}

function isNamespacedAssetUri(value: string, scheme: "r2" | "dev"): boolean {
  const prefix = `${scheme}://`;
  if (!value.startsWith(prefix)) return false;
  const body = value.slice(prefix.length);
  const firstSlash = body.indexOf("/");
  if (firstSlash <= 0 || firstSlash === body.length - 1) return false;
  const namespace = body.slice(0, firstSlash);
  const path = body.slice(firstSlash + 1);
  return SAFE_MANIFEST_KEY.test(namespace) && SAFE_RELATIVE_PATH.test(path);
}

function isRelativeAssetUri(value: string): boolean {
  if (value.startsWith("//") || hasExplicitScheme(value)) return false;
  if (!SAFE_RELATIVE_PATH.test(value)) return false;
  return value.startsWith("/") || value.startsWith("./") || value.startsWith("../") || !value.includes("\\");
}

function containsControlCharacter(value: string): boolean {
  for (const char of value) {
    const code = char.charCodeAt(0);
    if (code <= 31 || code === 127) return true;
  }
  return false;
}

export function isRuntimeAssetUri(value: string): boolean {
  const trimmed = value.trim();
  if (trimmed.length === 0 || trimmed !== value || containsControlCharacter(value)) return false;
  const lower = value.toLowerCase();
  if (lower.startsWith("javascript:") || lower.startsWith("data:")) return false;
  return (
    isHttpAssetUri(value) ||
    isNamespacedAssetUri(value, "r2") ||
    isNamespacedAssetUri(value, "dev") ||
    isRelativeAssetUri(value)
  );
}

export const RuntimeManifestKeySchema = z
  .string()
  .min(1)
  .max(120)
  .regex(SAFE_MANIFEST_KEY);

export const RuntimeAssetUriSchema = z
  .string()
  .min(1)
  .max(2048)
  .refine(isRuntimeAssetUri, "Runtime asset URI must be http(s), r2://, dev://, or a safe relative path");

export const RuntimeSha256Schema = z
  .string()
  .regex(/^sha256:[a-f0-9]{64}$/u, "SHA-256 digest must use sha256:<64 lowercase hex chars>");

export const RuntimeCoordinateSystemSchema = z.enum(RUNTIME_COORDINATE_SYSTEMS);
export const RuntimeAssetRoleSchema = z.enum(RUNTIME_ASSET_ROLES);
export const RuntimeAssetFormatSchema = z.enum(RUNTIME_ASSET_FORMATS);
export const RuntimeLayerKindSchema = z.enum(RUNTIME_LAYER_KINDS);
export const RuntimeTransformFrameSchema = z.enum(RUNTIME_TRANSFORM_FRAMES);
export const RuntimeTransformAlignmentMethodSchema = z.enum(
  RUNTIME_TRANSFORM_ALIGNMENT_METHODS,
);
export const RuntimeTransformProvenanceStateSchema = z.enum(
  RUNTIME_TRANSFORM_PROVENANCE_STATES,
);
export const RuntimeTransformReferenceTypeSchema = z.enum(
  RUNTIME_TRANSFORM_REFERENCE_TYPES,
);
export const RuntimeTransformActorTypeSchema = z.enum(RUNTIME_TRANSFORM_ACTOR_TYPES);

export const RuntimeVec3Schema = z.tuple([
  z.number().finite(),
  z.number().finite(),
  z.number().finite(),
]);

export const Matrix4dSchema = z
  .array(z.number().finite())
  .length(16, "Matrix4d must contain exactly 16 column-major numbers");

export const RuntimeTransformMatrix4dSchema = Matrix4dSchema.superRefine((values, ctx) => {
  const validation = validateSimilarityTransformMatrix4d(matrix4d(values), 1e-7);
  if (!validation.ok) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: `TransformArtifactV0 matrix must be a finite affine similarity transform: ${validation.reason}`,
    });
  }
});

export const RuntimeBoundsSchema = z
  .object({
    min: RuntimeVec3Schema,
    max: RuntimeVec3Schema,
  })
  .strict()
  .superRefine((bounds, ctx) => {
    for (const axis of [0, 1, 2] as const) {
      const min = bounds.min[axis];
      const max = bounds.max[axis];
      if (min >= max) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["max", axis],
          message: "Runtime bounds max must be greater than min on every axis",
        });
      }
    }
  });

export const RuntimeAssetSchema = z
  .object({
    id: RuntimeManifestKeySchema,
    role: RuntimeAssetRoleSchema,
    format: RuntimeAssetFormatSchema,
    uri: RuntimeAssetUriSchema,
    sha256: RuntimeSha256Schema,
    byteLength: z.number().int().positive().optional(),
    mimeType: z.string().trim().min(1).max(120).optional(),
  })
  .strict();

export const RuntimeTransformReferenceSchema = z
  .object({
    refType: RuntimeTransformReferenceTypeSchema,
    ref: z.string().trim().min(1).max(255).regex(SAFE_RELATIVE_PATH),
    role: z.string().trim().min(1).max(80).regex(SAFE_MANIFEST_KEY),
  })
  .strict();

export const RuntimeTransformProvenanceSchema = z
  .object({
    state: RuntimeTransformProvenanceStateSchema,
    refs: z.array(RuntimeTransformReferenceSchema).min(1),
  })
  .strict();

export const RuntimeTransformActorSchema = z
  .object({
    actorType: RuntimeTransformActorTypeSchema,
    id: z.string().trim().min(1).max(160).regex(SAFE_RELATIVE_PATH),
    displayName: z.string().trim().min(1).max(160).optional(),
    role: z.string().trim().min(1).max(80).regex(SAFE_MANIFEST_KEY).optional(),
  })
  .strict();

export const RuntimeTransformLandmarkPairSchema = z
  .object({
    id: RuntimeManifestKeySchema,
    label: z.string().trim().min(1).max(160).optional(),
    source: RuntimeVec3Schema,
    target: RuntimeVec3Schema,
    residualM: z.number().finite().nonnegative().nullable().optional(),
    provenanceRefs: z.array(RuntimeTransformReferenceSchema).default([]),
  })
  .strict();

export const TransformArtifactV0Schema = z
  .object({
    id: RuntimeManifestKeySchema,
    sourceFrame: RuntimeTransformFrameSchema,
    targetFrame: RuntimeTransformFrameSchema,
    units: z.literal("meters"),
    matrix: RuntimeTransformMatrix4dSchema,
    alignmentMethod: RuntimeTransformAlignmentMethodSchema,
    residualRmseM: z.number().finite().nonnegative().nullable(),
    landmarks: z.array(RuntimeTransformLandmarkPairSchema).default([]),
    provenance: RuntimeTransformProvenanceSchema,
    creator: RuntimeTransformActorSchema,
    reviewer: RuntimeTransformActorSchema,
    date: z.string().datetime({ offset: true }),
  })
  .strict()
  .superRefine((artifact, ctx) => {
    if (artifact.sourceFrame === artifact.targetFrame) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["targetFrame"],
        message: "TransformArtifactV0 sourceFrame and targetFrame must differ.",
      });
    }

    if (artifact.reviewer.actorType !== "human") {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["reviewer", "actorType"],
        message: "TransformArtifactV0 reviewer must be a human actor.",
      });
    }

    if (artifact.reviewer.role === undefined) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["reviewer", "role"],
        message: "TransformArtifactV0 reviewer must declare a review role.",
      });
    }

    if (artifact.alignmentMethod === "landmark_solve" && artifact.landmarks.length === 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["landmarks"],
        message: "landmark_solve TransformArtifactV0 records need at least one landmark pair.",
      });
    }

    if (artifact.alignmentMethod === "landmark_solve" && artifact.residualRmseM === null) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["residualRmseM"],
        message: "landmark_solve TransformArtifactV0 records need an aggregate residual RMSE.",
      });
    }

    for (const [index, landmark] of artifact.landmarks.entries()) {
      if (
        artifact.alignmentMethod === "landmark_solve" &&
        (landmark.residualM === null || landmark.residualM === undefined)
      ) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["landmarks", index, "residualM"],
          message: "landmark_solve landmark pairs need per-landmark residuals.",
        });
      }

      if (
        artifact.alignmentMethod === "landmark_solve" &&
        landmark.provenanceRefs.length === 0
      ) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["landmarks", index, "provenanceRefs"],
          message: "landmark_solve landmark pairs need provenance references.",
        });
      }
    }

    if (
      artifact.residualRmseM === null &&
      artifact.landmarks.some(
        (landmark) => landmark.residualM !== null && landmark.residualM !== undefined,
      )
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["residualRmseM"],
        message:
          "TransformArtifactV0 records with landmark residuals need an aggregate residual RMSE.",
      });
    }

    if (
      artifact.alignmentMethod === "visual_alignment" &&
      artifact.provenance.state === "measured"
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["provenance", "state"],
        message: "visual_alignment TransformArtifactV0 records cannot claim measured provenance.",
      });
    }

    if (
      artifact.alignmentMethod === "unconstrained_colmap" &&
      artifact.provenance.state === "measured"
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["provenance", "state"],
        message:
          "unconstrained_colmap TransformArtifactV0 records cannot claim measured provenance without external metric control.",
      });
    }
  });

export const RuntimeManifestExposureMetadataSchema = ExposureMetadataV0Schema.refine(
  (metadata) => metadata.artifactType === "runtime_package",
  {
    path: ["artifactType"],
    message: "Runtime manifest exposure metadata must use artifactType runtime_package.",
  },
);

const RuntimeLayerBaseSchema = z.object({
  id: RuntimeManifestKeySchema,
  assetId: RuntimeManifestKeySchema,
  coordinateSystem: RuntimeCoordinateSystemSchema,
  transform: Matrix4dSchema.default(() => [...IDENTITY_MATRIX4D]),
  transformArtifactId: RuntimeManifestKeySchema.optional(),
  visibleByDefault: z.boolean().default(true),
});

export const RuntimeGaussianSplatLayerSchema = RuntimeLayerBaseSchema.extend({
  kind: z.literal("gaussian_splat"),
  renderer: z.literal("spark"),
  format: z.enum(["spz", "ply", "splat"]),
}).strict();

export const RuntimeMeshLayerSchema = RuntimeLayerBaseSchema.extend({
  kind: z.literal("mesh"),
  format: z.enum(["glb", "gltf"]),
}).strict();

export const RuntimeRenderLayerSchema = z.discriminatedUnion("kind", [
  RuntimeGaussianSplatLayerSchema,
  RuntimeMeshLayerSchema,
]);

export const RuntimeVenueManifestV0Schema = z
  .object({
    schemaVersion: z.literal(RUNTIME_VENUE_MANIFEST_V0_VERSION),
    manifestId: z.string().uuid(),
    runtimePackageId: z.string().uuid(),
    venueId: VenueIdSchema,
    venueSlug: VenueSlugSchema,
    spaceId: SpaceIdSchema,
    spaceSlug: SpaceSlugSchema,
    createdAt: z.string().datetime({ offset: true }),
    units: z.literal("meters"),
    exposure: RuntimeManifestExposureMetadataSchema.default(() =>
      internalOnlyExposureMetadata("runtime_package"),
    ),
    coordinateSystem: RuntimeCoordinateSystemSchema,
    bounds: RuntimeBoundsSchema,
    assets: z.array(RuntimeAssetSchema).min(1),
    transformArtifacts: z.array(TransformArtifactV0Schema).default([]),
    layers: z.array(RuntimeRenderLayerSchema).min(1),
    defaultLayerId: RuntimeManifestKeySchema,
  })
  .strict()
  .superRefine((manifest, ctx) => {
    const assetById = new Map(manifest.assets.map((asset) => [asset.id, asset]));
    const layerIds = new Set<string>();
    const assetIds = new Set<string>();
    const transformArtifactIds = new Set<string>();
    const transformArtifactById = new Map(
      manifest.transformArtifacts.map((artifact) => [artifact.id, artifact]),
    );

    if (
      manifest.exposure.ownerVenueId !== null &&
      manifest.exposure.ownerVenueId !== manifest.venueId
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["exposure", "ownerVenueId"],
        message: "Runtime manifest exposure ownerVenueId must match venueId.",
      });
    }

    if (
      (manifest.exposure.exposureTier === "authenticated_client" ||
        manifest.exposure.exposureTier === "published_case_study") &&
      manifest.exposure.ownerVenueId !== manifest.venueId
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["exposure", "ownerVenueId"],
        message:
          "Client or case-study runtime exposure must be scoped to the manifest venue.",
      });
    }

    for (const [index, transformArtifact] of manifest.transformArtifacts.entries()) {
      if (transformArtifactIds.has(transformArtifact.id)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["transformArtifacts", index, "id"],
          message: "TransformArtifactV0 IDs must be unique",
        });
      }
      transformArtifactIds.add(transformArtifact.id);
    }

    for (const [index, asset] of manifest.assets.entries()) {
      if (assetIds.has(asset.id)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["assets", index, "id"],
          message: "Runtime asset IDs must be unique",
        });
      }
      assetIds.add(asset.id);
    }

    for (const [index, layer] of manifest.layers.entries()) {
      if (layerIds.has(layer.id)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["layers", index, "id"],
          message: "Runtime layer IDs must be unique",
        });
      }
      layerIds.add(layer.id);

      const asset = assetById.get(layer.assetId);
      if (asset === undefined) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["layers", index, "assetId"],
          message: "Runtime layer assetId must reference a declared asset",
        });
        continue;
      }

      if (asset.format !== layer.format) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["layers", index, "format"],
          message: "Runtime layer format must match its referenced asset format",
        });
      }

      if (layer.kind === "gaussian_splat" && asset.role !== "radiance") {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["layers", index, "assetId"],
          message: "Gaussian splat layers must reference a radiance asset",
        });
      }

      if (layer.kind === "mesh" && asset.role !== "geometry") {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["layers", index, "assetId"],
          message: "Mesh layers must reference a geometry asset",
        });
      }

      if (
        layer.transformArtifactId !== undefined &&
        !transformArtifactIds.has(layer.transformArtifactId)
      ) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["layers", index, "transformArtifactId"],
          message: "Runtime layer transformArtifactId must reference a declared TransformArtifactV0",
        });
      }

      if (layer.transformArtifactId !== undefined) {
        const transformArtifact = transformArtifactById.get(layer.transformArtifactId);
        if (
          transformArtifact !== undefined &&
          !matrix4dEquals(layer.transform, transformArtifact.matrix)
        ) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: ["layers", index, "transform"],
            message:
              "Runtime layer transform must match the referenced TransformArtifactV0 matrix",
          });
        }
      }

      if (layer.transformArtifactId === undefined && !matrix4dEquals(layer.transform, IDENTITY_MATRIX4D)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["layers", index, "transformArtifactId"],
          message: "Non-identity runtime layer transforms must reference a TransformArtifactV0",
        });
      }
    }

    if (!layerIds.has(manifest.defaultLayerId)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["defaultLayerId"],
        message: "defaultLayerId must reference a declared layer",
      });
    }
  });

export type RuntimeCoordinateSystem = z.infer<typeof RuntimeCoordinateSystemSchema>;
export type RuntimeAssetRole = z.infer<typeof RuntimeAssetRoleSchema>;
export type RuntimeAssetFormat = z.infer<typeof RuntimeAssetFormatSchema>;
export type RuntimeLayerKind = z.infer<typeof RuntimeLayerKindSchema>;
export type RuntimeTransformFrame = z.infer<typeof RuntimeTransformFrameSchema>;
export type RuntimeTransformAlignmentMethod = z.infer<
  typeof RuntimeTransformAlignmentMethodSchema
>;
export type RuntimeTransformProvenanceState = z.infer<
  typeof RuntimeTransformProvenanceStateSchema
>;
export type RuntimeTransformReferenceType = z.infer<
  typeof RuntimeTransformReferenceTypeSchema
>;
export type RuntimeTransformActorType = z.infer<typeof RuntimeTransformActorTypeSchema>;
export type RuntimeVec3 = z.infer<typeof RuntimeVec3Schema>;
export type Matrix4d = z.infer<typeof Matrix4dSchema>;
export type RuntimeBounds = z.infer<typeof RuntimeBoundsSchema>;
export type RuntimeAsset = z.infer<typeof RuntimeAssetSchema>;
export type RuntimeTransformReference = z.infer<typeof RuntimeTransformReferenceSchema>;
export type RuntimeTransformProvenance = z.infer<typeof RuntimeTransformProvenanceSchema>;
export type RuntimeTransformActor = z.infer<typeof RuntimeTransformActorSchema>;
export type RuntimeTransformLandmarkPair = z.infer<typeof RuntimeTransformLandmarkPairSchema>;
export type TransformArtifactV0 = z.infer<typeof TransformArtifactV0Schema>;
export type RuntimeManifestExposureMetadata = z.infer<
  typeof RuntimeManifestExposureMetadataSchema
>;
export type RuntimeGaussianSplatLayer = z.infer<typeof RuntimeGaussianSplatLayerSchema>;
export type RuntimeMeshLayer = z.infer<typeof RuntimeMeshLayerSchema>;
export type RuntimeRenderLayer = z.infer<typeof RuntimeRenderLayerSchema>;
export type RuntimeVenueManifestV0Input = z.input<typeof RuntimeVenueManifestV0Schema>;
export type RuntimeVenueManifestV0 = z.infer<typeof RuntimeVenueManifestV0Schema>;

function matrix4dEquals(
  left: readonly number[],
  right: readonly number[],
  tolerance = 1e-12,
): boolean {
  if (left.length !== right.length) {
    return false;
  }

  return left.every((value, index) => {
    const rightValue = right[index];
    return rightValue !== undefined && Math.abs(value - rightValue) <= tolerance;
  });
}
