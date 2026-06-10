import { describe, expect, it } from "vitest";
import { EXPOSURE_METADATA_V0_SCHEMA_VERSION } from "../exposure-metadata.js";
import {
  IDENTITY_MATRIX4D,
  RUNTIME_TRANSFORM_ALIGNMENT_METHODS,
  RUNTIME_TRANSFORM_FRAMES,
  RUNTIME_TRANSFORM_PROVENANCE_STATES,
  RUNTIME_VENUE_MANIFEST_V0_VERSION,
  RuntimeAssetUriSchema,
  TransformArtifactV0Schema,
  RuntimeVenueManifestV0Schema,
  isRuntimeAssetUri,
  type TransformArtifactV0,
  type RuntimeVenueManifestV0Input,
} from "../runtime-venue-manifest.js";

const VALID_MANIFEST_ID = "11111111-1111-4111-8111-111111111111";
const VALID_PACKAGE_ID = "22222222-2222-4222-8222-222222222222";
const VALID_VENUE_ID = "33333333-3333-4333-8333-333333333333";
const VALID_SPACE_ID = "44444444-4444-4444-8444-444444444444";
const VALID_SHA256 = `sha256:${"a".repeat(64)}`;
const T_CVF_ARF = [
  1, 0, 0, 0,
  0, 1, 0, 0,
  0, 0, 1, 0,
  1.25, 0, -2.5, 1,
] as const;

function validManifest(overrides: Partial<RuntimeVenueManifestV0Input> = {}): RuntimeVenueManifestV0Input {
  return {
    schemaVersion: RUNTIME_VENUE_MANIFEST_V0_VERSION,
    manifestId: VALID_MANIFEST_ID,
    runtimePackageId: VALID_PACKAGE_ID,
    venueId: VALID_VENUE_ID,
    venueSlug: "trades-hall",
    spaceId: VALID_SPACE_ID,
    spaceSlug: "grand-hall",
    createdAt: "2026-04-30T12:00:00.000Z",
    units: "meters",
    coordinateSystem: "rhs_y_up_meters",
    bounds: {
      min: [-10.5, 0, -5.25],
      max: [10.5, 7, 5.25],
    },
    assets: [
      {
        id: "grand-hall-splat",
        role: "radiance",
        format: "spz",
        uri: "./assets/grand-hall.splat.spz",
        sha256: VALID_SHA256,
        byteLength: 123456,
        mimeType: "application/octet-stream",
      },
    ],
    layers: [
      {
        id: "grand-hall-splat-layer",
        kind: "gaussian_splat",
        renderer: "spark",
        assetId: "grand-hall-splat",
        format: "spz",
        coordinateSystem: "rhs_y_up_meters",
        transform: [...IDENTITY_MATRIX4D],
        visibleByDefault: true,
      },
    ],
    defaultLayerId: "grand-hall-splat-layer",
    ...overrides,
  };
}

function validTransformArtifact(
  overrides: Partial<TransformArtifactV0> = {},
): TransformArtifactV0 {
  return {
    id: "t-cvf-arf-grand-hall-splat",
    sourceFrame: "ARF",
    targetFrame: "CVF",
    units: "meters",
    matrix: [...T_CVF_ARF],
    alignmentMethod: "landmark_solve",
    residualRmseM: 0.018,
    landmarks: [
      {
        id: "fireplace-left-pier",
        label: "Fireplace left pier",
        source: [0.4, 1.2, -0.6],
        target: [1.65, 1.2, -3.1],
        residualM: 0.012,
        provenanceRefs: [
          {
            refType: "landmark_set",
            ref: "grand-hall-manual-landmarks-v1",
            role: "alignment_landmark",
          },
        ],
      },
    ],
    provenance: {
      state: "inferred",
      refs: [
        {
          refType: "capture_session",
          ref: "trades-hall-e57-session-2026-05",
          role: "source_capture",
        },
      ],
    },
    creator: {
      actorType: "pipeline",
      id: "runpod-transform-exporter",
      role: "transform_creator",
    },
    reviewer: {
      actorType: "human",
      id: "venue-ops-reviewer",
      displayName: "Venue ops reviewer",
      role: "venue_ops_reviewer",
    },
    date: "2026-05-12T10:00:00.000Z",
    ...overrides,
  };
}

describe("RuntimeAssetUriSchema", () => {
  it.each([
    "./assets/grand-hall.splat.spz",
    "../shared/grand-hall.ply",
    "/runtime/trades-hall/grand-hall.spz",
    "assets/grand-hall.glb",
    "dev://fixtures/trades-hall/grand-hall.spz",
    "r2://venviewer-runtime/trades-hall/grand-hall.spz",
    "https://cdn.example.com/trades-hall/grand-hall.spz",
  ])("accepts %s", (uri) => {
    expect(RuntimeAssetUriSchema.safeParse(uri).success).toBe(true);
    expect(isRuntimeAssetUri(uri)).toBe(true);
  });

  it.each([
    "",
    " ./assets/grand-hall.spz",
    "//cdn.example.com/grand-hall.spz",
    "javascript:alert(1)",
    "data:application/octet-stream;base64,AA==",
    "C:\\captures\\grand-hall.spz",
    "r2://bucket",
    "dev://fixture",
  ])("rejects %s", (uri) => {
    expect(RuntimeAssetUriSchema.safeParse(uri).success).toBe(false);
    expect(isRuntimeAssetUri(uri)).toBe(false);
  });
});

describe("RuntimeVenueManifestV0Schema", () => {
  it("pins the D-024 transform frame, method, and provenance vocabularies", () => {
    expect(RUNTIME_TRANSFORM_FRAMES).toEqual([
      "CVF",
      "ARF",
      "RRF",
      "G",
      "M",
      "W",
      "COLMAP_RDF",
      "THREE_CAMERA",
    ]);
    expect(RUNTIME_TRANSFORM_ALIGNMENT_METHODS).toEqual([
      "manual_alignment",
      "icp",
      "landmark_solve",
      "matterport_e57_extraction",
      "blender_authored_placement",
      "known_pose_colmap",
      "unconstrained_colmap",
      "visual_alignment",
    ]);
    expect(RUNTIME_TRANSFORM_PROVENANCE_STATES).toEqual([
      "measured",
      "inferred",
      "generated",
    ]);
  });

  it("accepts the first T-091A shape: one Spark gaussian splat layer with a relative asset reference", () => {
    const parsed = RuntimeVenueManifestV0Schema.parse(validManifest());

    expect(parsed.schemaVersion).toBe(RUNTIME_VENUE_MANIFEST_V0_VERSION);
    expect(parsed.layers[0]?.kind).toBe("gaussian_splat");
    const layer = parsed.layers[0];
    expect(layer?.kind).toBe("gaussian_splat");
    if (layer?.kind !== "gaussian_splat") {
      throw new Error("expected gaussian splat layer");
    }
    expect(layer.renderer).toBe("spark");
    expect(parsed.assets[0]?.uri).toBe("./assets/grand-hall.splat.spz");
  });

  it("defaults transformArtifacts to an empty list for trivial identity-layer manifests", () => {
    const parsed = RuntimeVenueManifestV0Schema.parse(validManifest());

    expect(parsed.transformArtifacts).toEqual([]);
  });

  it("defaults exposure metadata to internal-only runtime package posture", () => {
    const parsed = RuntimeVenueManifestV0Schema.parse(validManifest());

    expect(parsed.exposure).toEqual({
      schemaVersion: EXPOSURE_METADATA_V0_SCHEMA_VERSION,
      artifactType: "runtime_package",
      exposureTier: "internal_only",
      ownerVenueId: null,
      ownerClientScope: null,
      subjectRefs: [],
      allowedAudience: ["internal_team"],
      expiresAt: null,
      claimReviewStatus: "not_required",
      approvalRefs: [],
      sourceArtifactRefs: [],
      exportSafety: "internal_only",
    });
  });

  it("accepts authenticated-client runtime exposure scoped to the manifest venue", () => {
    const parsed = RuntimeVenueManifestV0Schema.parse(
      validManifest({
        exposure: {
          schemaVersion: EXPOSURE_METADATA_V0_SCHEMA_VERSION,
          artifactType: "runtime_package",
          exposureTier: "authenticated_client",
          ownerVenueId: VALID_VENUE_ID,
          ownerClientScope: "trades_hall_event_team",
          subjectRefs: [
            {
              refType: "venue",
              ref: "trades-hall",
              role: "subject_venue",
            },
          ],
          allowedAudience: ["authenticated_client", "venue_staff"],
          expiresAt: null,
          claimReviewStatus: "not_required",
          approvalRefs: [],
          sourceArtifactRefs: [
            {
              refType: "artifact",
              ref: "runtime-package-builder-output",
              role: "source_artifact",
            },
          ],
          exportSafety: "safe_to_export",
        },
      }),
    );

    expect(parsed.exposure.ownerVenueId).toBe(VALID_VENUE_ID);
    expect(parsed.exposure.exposureTier).toBe("authenticated_client");
  });

  it("rejects runtime exposure metadata for non-runtime artifact types", () => {
    const result = RuntimeVenueManifestV0Schema.safeParse(
      validManifest({
        exposure: {
          schemaVersion: EXPOSURE_METADATA_V0_SCHEMA_VERSION,
          artifactType: "layout_evidence_pack",
          exposureTier: "internal_only",
          ownerVenueId: null,
          ownerClientScope: null,
          subjectRefs: [],
          allowedAudience: ["internal_team"],
          expiresAt: null,
          claimReviewStatus: "not_required",
          approvalRefs: [],
          sourceArtifactRefs: [],
          exportSafety: "internal_only",
        },
      }),
    );

    expect(result.success).toBe(false);
  });

  it("rejects runtime exposure ownerVenueId values that drift from venueId", () => {
    const result = RuntimeVenueManifestV0Schema.safeParse(
      validManifest({
        exposure: {
          schemaVersion: EXPOSURE_METADATA_V0_SCHEMA_VERSION,
          artifactType: "runtime_package",
          exposureTier: "authenticated_client",
          ownerVenueId: "55555555-5555-4555-8555-555555555555",
          ownerClientScope: "trades_hall_event_team",
          subjectRefs: [],
          allowedAudience: ["authenticated_client"],
          expiresAt: null,
          claimReviewStatus: "not_required",
          approvalRefs: [],
          sourceArtifactRefs: [],
          exportSafety: "safe_to_export",
        },
      }),
    );

    expect(result.success).toBe(false);
  });

  it("rejects public runtime exposure without current claim review and approval", () => {
    const result = RuntimeVenueManifestV0Schema.safeParse(
      validManifest({
        exposure: {
          schemaVersion: EXPOSURE_METADATA_V0_SCHEMA_VERSION,
          artifactType: "runtime_package",
          exposureTier: "published_case_study",
          ownerVenueId: VALID_VENUE_ID,
          ownerClientScope: null,
          subjectRefs: [],
          allowedAudience: ["public"],
          expiresAt: null,
          claimReviewStatus: "requires_review",
          approvalRefs: [],
          sourceArtifactRefs: [],
          exportSafety: "safe_for_public_marketing",
        },
      }),
    );

    expect(result.success).toBe(false);
  });

  it("accepts a TransformArtifactV0 referenced by a non-identity layer transform", () => {
    const parsed = RuntimeVenueManifestV0Schema.parse(
      validManifest({
        transformArtifacts: [validTransformArtifact()],
        layers: [
          {
            id: "grand-hall-splat-layer",
            kind: "gaussian_splat",
            renderer: "spark",
            assetId: "grand-hall-splat",
            format: "spz",
            coordinateSystem: "rhs_z_up_meters",
            transform: [...T_CVF_ARF],
            transformArtifactId: "t-cvf-arf-grand-hall-splat",
          },
        ],
      }),
    );

    expect(parsed.transformArtifacts[0]?.sourceFrame).toBe("ARF");
    expect(parsed.layers[0]?.transformArtifactId).toBe("t-cvf-arf-grand-hall-splat");
    expect(TransformArtifactV0Schema.parse(parsed.transformArtifacts[0])).toEqual(
      parsed.transformArtifacts[0],
    );
  });

  it("rejects a non-identity layer transform without a TransformArtifactV0 reference", () => {
    const result = RuntimeVenueManifestV0Schema.safeParse(
      validManifest({
        layers: [
          {
            id: "grand-hall-splat-layer",
            kind: "gaussian_splat",
            renderer: "spark",
            assetId: "grand-hall-splat",
            format: "spz",
            coordinateSystem: "rhs_z_up_meters",
            transform: [...T_CVF_ARF],
          },
        ],
      }),
    );

    expect(result.success).toBe(false);
  });

  it("rejects layer transformArtifactId values that do not reference declared artifacts", () => {
    const result = RuntimeVenueManifestV0Schema.safeParse(
      validManifest({
        layers: [
          {
            id: "grand-hall-splat-layer",
            kind: "gaussian_splat",
            renderer: "spark",
            assetId: "grand-hall-splat",
            format: "spz",
            coordinateSystem: "rhs_z_up_meters",
            transform: [...T_CVF_ARF],
            transformArtifactId: "missing-transform",
          },
        ],
      }),
    );

    expect(result.success).toBe(false);
  });

  it("rejects layer transforms that drift from the referenced TransformArtifactV0 matrix", () => {
    const result = RuntimeVenueManifestV0Schema.safeParse(
      validManifest({
        transformArtifacts: [validTransformArtifact()],
        layers: [
          {
            id: "grand-hall-splat-layer",
            kind: "gaussian_splat",
            renderer: "spark",
            assetId: "grand-hall-splat",
            format: "spz",
            coordinateSystem: "rhs_z_up_meters",
            transform: [
              1, 0, 0, 0,
              0, 1, 0, 0,
              0, 0, 1, 0,
              4, 0, -2.5, 1,
            ],
            transformArtifactId: "t-cvf-arf-grand-hall-splat",
          },
        ],
      }),
    );

    expect(result.success).toBe(false);
  });

  it("rejects duplicate TransformArtifactV0 IDs", () => {
    const result = RuntimeVenueManifestV0Schema.safeParse(
      validManifest({
        transformArtifacts: [
          validTransformArtifact(),
          validTransformArtifact({ sourceFrame: "CVF", targetFrame: "RRF" }),
        ],
      }),
    );

    expect(result.success).toBe(false);
  });

  it("rejects transforms that map a frame into itself", () => {
    const result = TransformArtifactV0Schema.safeParse(
      validTransformArtifact({ sourceFrame: "CVF", targetFrame: "CVF" }),
    );

    expect(result.success).toBe(false);
  });

  it("requires a human reviewer for TransformArtifactV0 records", () => {
    const result = TransformArtifactV0Schema.safeParse(
      validTransformArtifact({
        reviewer: {
          actorType: "pipeline",
          id: "runpod-transform-exporter",
          role: "transform_reviewer",
        },
      }),
    );

    expect(result.success).toBe(false);
  });

  it("requires a reviewer role for TransformArtifactV0 records", () => {
    const result = TransformArtifactV0Schema.safeParse(
      validTransformArtifact({
        reviewer: {
          actorType: "human",
          id: "venue-ops-reviewer",
          displayName: "Venue ops reviewer",
        },
      }),
    );

    expect(result.success).toBe(false);
  });

  it("rejects landmark-solve TransformArtifactV0 records without landmark pairs", () => {
    const result = TransformArtifactV0Schema.safeParse(
      validTransformArtifact({ landmarks: [] }),
    );

    expect(result.success).toBe(false);
  });

  it("rejects landmark-solve TransformArtifactV0 records without aggregate residuals", () => {
    const result = TransformArtifactV0Schema.safeParse(
      validTransformArtifact({ residualRmseM: null }),
    );

    expect(result.success).toBe(false);
  });

  it("rejects landmark-solve TransformArtifactV0 records without per-landmark residuals", () => {
    const result = TransformArtifactV0Schema.safeParse(
      validTransformArtifact({
        landmarks: [
          {
            id: "fireplace-left-pier",
            label: "Fireplace left pier",
            source: [0.4, 1.2, -0.6],
            target: [1.65, 1.2, -3.1],
            residualM: null,
            provenanceRefs: [],
          },
        ],
      }),
    );

    expect(result.success).toBe(false);
  });

  it("rejects landmark-solve TransformArtifactV0 records without landmark provenance", () => {
    const result = TransformArtifactV0Schema.safeParse(
      validTransformArtifact({
        landmarks: [
          {
            id: "fireplace-left-pier",
            label: "Fireplace left pier",
            source: [0.4, 1.2, -0.6],
            target: [1.65, 1.2, -3.1],
            residualM: 0.012,
            provenanceRefs: [],
          },
        ],
      }),
    );

    expect(result.success).toBe(false);
  });

  it("rejects landmark residuals without an aggregate residual RMSE", () => {
    const result = TransformArtifactV0Schema.safeParse(
      validTransformArtifact({
        alignmentMethod: "manual_alignment",
        residualRmseM: null,
      }),
    );

    expect(result.success).toBe(false);
  });

  it("rejects visual-only alignment that claims measured provenance", () => {
    const result = TransformArtifactV0Schema.safeParse(
      validTransformArtifact({
        alignmentMethod: "visual_alignment",
        residualRmseM: null,
        provenance: {
          state: "measured",
          refs: [
            {
              refType: "operator_note",
              ref: "visual-check-only",
              role: "source_alignment",
            },
          ],
        },
      }),
    );

    expect(result.success).toBe(false);
  });

  it("rejects unconstrained COLMAP alignment that claims measured provenance", () => {
    const result = TransformArtifactV0Schema.safeParse(
      validTransformArtifact({
        alignmentMethod: "unconstrained_colmap",
        residualRmseM: null,
        landmarks: [],
        provenance: {
          state: "measured",
          refs: [
            {
              refType: "capture_session",
              ref: "trades-hall-colmap-run-2026-05",
              role: "source_reconstruction",
            },
          ],
        },
      }),
    );

    expect(result.success).toBe(false);
  });

  it("rejects non-similarity transform matrices in TransformArtifactV0 records", () => {
    const result = TransformArtifactV0Schema.safeParse(
      validTransformArtifact({
        matrix: [
          2, 0, 0, 0,
          0, 1, 0, 0,
          0, 0, 1, 0,
          0, 0, 0, 1,
        ],
      }),
    );

    expect(result.success).toBe(false);
  });

  it("rejects negative residual metrics in TransformArtifactV0 records", () => {
    const result = TransformArtifactV0Schema.safeParse(
      validTransformArtifact({ residualRmseM: -0.1 }),
    );

    expect(result.success).toBe(false);
  });

  it("accepts R2-backed asset references without requiring URL syntax", () => {
    const result = RuntimeVenueManifestV0Schema.safeParse(
      validManifest({
        assets: [
          {
            id: "grand-hall-splat",
            role: "radiance",
            format: "spz",
            uri: "r2://venviewer-runtime/trades-hall/grand-hall.splat.spz",
            sha256: VALID_SHA256,
          },
        ],
      }),
    );

    expect(result.success).toBe(true);
  });

  it("defaults layer transform and visibility when omitted", () => {
    const result = RuntimeVenueManifestV0Schema.parse(
      validManifest({
        layers: [
          {
            id: "grand-hall-splat-layer",
            kind: "gaussian_splat",
            renderer: "spark",
            assetId: "grand-hall-splat",
            format: "spz",
            coordinateSystem: "rhs_y_up_meters",
          },
        ],
      }),
    );

    expect(result.layers[0]?.transform).toEqual([...IDENTITY_MATRIX4D]);
    expect(result.layers[0]?.visibleByDefault).toBe(true);
  });

  it("rejects malformed SHA-256 digests", () => {
    const result = RuntimeVenueManifestV0Schema.safeParse(
      validManifest({
        assets: [
          {
            id: "grand-hall-splat",
            role: "radiance",
            format: "spz",
            uri: "./assets/grand-hall.splat.spz",
            sha256: "sha256:ABC",
          },
        ],
      }),
    );

    expect(result.success).toBe(false);
  });

  it("rejects transforms that are not 16-number Matrix4d arrays", () => {
    const result = RuntimeVenueManifestV0Schema.safeParse(
      validManifest({
        layers: [
          {
            id: "grand-hall-splat-layer",
            kind: "gaussian_splat",
            renderer: "spark",
            assetId: "grand-hall-splat",
            format: "spz",
            coordinateSystem: "rhs_y_up_meters",
            transform: [1, 0, 0, 0],
          },
        ],
      }),
    );

    expect(result.success).toBe(false);
  });

  it("rejects layers that reference undeclared assets", () => {
    const result = RuntimeVenueManifestV0Schema.safeParse(
      validManifest({
        layers: [
          {
            id: "grand-hall-splat-layer",
            kind: "gaussian_splat",
            renderer: "spark",
            assetId: "missing-splat",
            format: "spz",
            coordinateSystem: "rhs_y_up_meters",
          },
        ],
      }),
    );

    expect(result.success).toBe(false);
  });

  it("rejects layer format mismatches against the referenced asset", () => {
    const result = RuntimeVenueManifestV0Schema.safeParse(
      validManifest({
        layers: [
          {
            id: "grand-hall-splat-layer",
            kind: "gaussian_splat",
            renderer: "spark",
            assetId: "grand-hall-splat",
            format: "ply",
            coordinateSystem: "rhs_y_up_meters",
          },
        ],
      }),
    );

    expect(result.success).toBe(false);
  });

  it("rejects gaussian splat layers that point at non-radiance assets", () => {
    const result = RuntimeVenueManifestV0Schema.safeParse(
      validManifest({
        assets: [
          {
            id: "grand-hall-splat",
            role: "geometry",
            format: "spz",
            uri: "./assets/grand-hall.splat.spz",
            sha256: VALID_SHA256,
          },
        ],
      }),
    );

    expect(result.success).toBe(false);
  });

  it("accepts mesh layers that point at geometry assets", () => {
    const parsed = RuntimeVenueManifestV0Schema.parse(
      validManifest({
        assets: [
          {
            id: "grand-hall-shell",
            role: "geometry",
            format: "glb",
            uri: "./assets/grand-hall-shell.glb",
            sha256: VALID_SHA256,
          },
        ],
        layers: [
          {
            id: "grand-hall-shell-layer",
            kind: "mesh",
            assetId: "grand-hall-shell",
            format: "glb",
            coordinateSystem: "rhs_y_up_meters",
          },
        ],
        defaultLayerId: "grand-hall-shell-layer",
      }),
    );

    expect(parsed.layers[0]?.kind).toBe("mesh");
  });

  it("rejects mesh layers that point at radiance assets", () => {
    const result = RuntimeVenueManifestV0Schema.safeParse(
      validManifest({
        assets: [
          {
            id: "grand-hall-radiance-mesh",
            role: "radiance",
            format: "glb",
            uri: "./assets/grand-hall-radiance.glb",
            sha256: VALID_SHA256,
          },
        ],
        layers: [
          {
            id: "grand-hall-shell-layer",
            kind: "mesh",
            assetId: "grand-hall-radiance-mesh",
            format: "glb",
            coordinateSystem: "rhs_y_up_meters",
          },
        ],
        defaultLayerId: "grand-hall-shell-layer",
      }),
    );

    expect(result.success).toBe(false);
  });

  it("rejects defaultLayerId when it does not reference a declared layer", () => {
    const result = RuntimeVenueManifestV0Schema.safeParse(
      validManifest({
        defaultLayerId: "missing-layer",
      }),
    );

    expect(result.success).toBe(false);
  });

  it("rejects inverted bounds", () => {
    const result = RuntimeVenueManifestV0Schema.safeParse(
      validManifest({
        bounds: {
          min: [1, 0, -1],
          max: [1, 7, 1],
        },
      }),
    );

    expect(result.success).toBe(false);
  });
});
