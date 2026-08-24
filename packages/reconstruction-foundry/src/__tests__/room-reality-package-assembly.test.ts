import {
  FOUNDRY_INGEST_MANIFEST_V0,
  FoundryIngestManifestV0Schema,
  FoundryPackageReferenceCatalogSchema,
  computeFoundryIngestManifestSha256,
} from "@omnitwin/types";
import { describe, expect, it } from "vitest";
import { FoundryIntegrityError } from "../errors.js";
import {
  FOUNDRY_ROOM_REALITY_PACKAGE_DRAFT_V0,
  FoundryRoomRealityPackageAssemblyInputV0Schema,
  FoundryRoomRealityPackageAssemblyResultV0Schema,
  FoundryRoomRealityPackageDraftV0Schema,
  assembleFoundryRoomRealityPackage,
  verifyFoundryRoomRealityPackageAssembly,
} from "../room-reality-package-assembly.js";

const NOW = "2026-08-09T10:00:00.000Z";
const SOURCE_DIGEST = `sha256:${"1".repeat(64)}`;
const CHECKPOINT_DIGEST = `sha256:${"2".repeat(64)}`;
const CONDITION_DIGEST = `sha256:${"3".repeat(64)}`;

function ingestManifest() {
  return FoundryIngestManifestV0Schema.parse({
    schemaVersion: FOUNDRY_INGEST_MANIFEST_V0,
    projectId: "trades-hall-reality",
    createdAt: NOW,
    createdBy: "capture-reviewer",
    sourceRoots: [
      {
        id: "capture-root",
        kind: "local_directory",
        displayName: "Read-only captured survey",
        locationRedacted: "TRADES_HALL_CAPTURE_ROOT",
        caseSensitivity: "insensitive",
        readOnly: true,
      },
    ],
    coordinateFrames: [
      {
        id: "venue-control",
        kind: "venue_control",
        units: "meters",
        handedness: "right",
        upAxis: "z",
        authority: "measured",
        provenanceAssetIds: ["source-e57"],
        crs: null,
      },
    ],
    transforms: [],
    assets: [
      {
        id: "source-e57",
        sourceRootId: "capture-root",
        relativePath: "grand-hall/capture.e57",
        inputType: "generic_e57",
        mediaType: "model/e57",
        sizeBytes: 10_000,
        sha256: SOURCE_DIGEST,
        immutable: true,
        captureState: "official_export",
        accessState: "official_export",
        capturedAt: null,
        coordinateFrameId: "venue-control",
        calibrationAssetIds: [],
        parentAssetIds: [],
        rights: {
          basis: "customer_owned",
          commercialUse: "allowed",
          modelTrainingUse: "allowed",
          redistribution: "allowed",
          termsReviewedAt: NOW,
          termsReference: "https://rights.example/trades-hall",
          restrictions: [],
        },
        provenanceClass: "captured",
        evidenceKinds: [],
        inspection: {
          geometryValue: "high",
          appearanceValue: "medium",
          calibrationValue: "medium",
          scaleValue: "high",
          metadataKeys: ["fixture"],
          decisiveNextTest: "Review the exact captured room package candidate.",
        },
        notes: [],
      },
    ],
    provenanceEdges: [],
    generatedRegions: [],
    legalReviewState: "approved",
    sourceMutationPermitted: false,
  });
}

function packageDraft() {
  return FoundryRoomRealityPackageDraftV0Schema.parse({
    schemaVersion: FOUNDRY_ROOM_REALITY_PACKAGE_DRAFT_V0,
    id: "trades-hall-room-reality-v0",
    projectId: "trades-hall-reality",
    venueFrameId: "venue-control",
    rooms: [
      {
        id: "grand-hall",
        label: "Grand Hall",
        roomFrameId: "grand-hall-local",
        venueTransformArtifactAssetId: "grand-hall-to-venue-transform",
        sceneAuthorityMapAssetId: "grand-hall-scene-authority-map",
        representations: [
          {
            id: "semantic-graph",
            role: "semantic_graph",
            assetId: "semantic-graph-asset",
            format: "json",
            coordinateFrameId: "grand-hall-local",
            transformArtifactAssetId: null,
            qualityReportId: "representation-qa",
            provenanceClass: "captured",
            lod: 0,
          },
          {
            id: "room-connectivity",
            role: "room_connectivity",
            assetId: "room-connectivity-asset",
            format: "json",
            coordinateFrameId: "grand-hall-local",
            transformArtifactAssetId: null,
            qualityReportId: "representation-qa",
            provenanceClass: "captured",
            lod: 0,
          },
          {
            id: "captured-geometry",
            role: "measured_geometry",
            assetId: "captured-geometry-asset",
            format: "glb",
            coordinateFrameId: "grand-hall-local",
            transformArtifactAssetId: "captured-geometry-transform",
            qualityReportId: "representation-qa",
            provenanceClass: "captured",
            lod: 0,
          },
          {
            id: "camera-spawns",
            role: "camera_spawn_points",
            assetId: "camera-spawns-asset",
            format: "json",
            coordinateFrameId: "grand-hall-local",
            transformArtifactAssetId: null,
            qualityReportId: "representation-qa",
            provenanceClass: "captured",
            lod: 0,
          },
        ],
      },
    ],
    generatedRegions: [],
    packageQualityReportId: "package-qa",
    releaseManifestAssetId: null,
    createdAt: NOW,
  });
}

function referenceCatalog() {
  return FoundryPackageReferenceCatalogSchema.parse({
    assets: [
      {
        id: "semantic-graph-asset",
        provenanceClass: "captured",
        evidenceKinds: [],
      },
      {
        id: "grand-hall-scene-authority-map",
        provenanceClass: "captured",
        evidenceKinds: ["scene_authority_map"],
      },
      {
        id: "captured-geometry-transform",
        provenanceClass: "captured",
        evidenceKinds: ["transform_artifact"],
      },
      {
        id: "camera-spawns-asset",
        provenanceClass: "captured",
        evidenceKinds: [],
      },
      {
        id: "grand-hall-to-venue-transform",
        provenanceClass: "captured",
        evidenceKinds: ["transform_artifact"],
      },
      {
        id: "room-connectivity-asset",
        provenanceClass: "captured",
        evidenceKinds: [],
      },
      {
        id: "captured-geometry-asset",
        provenanceClass: "captured",
        evidenceKinds: [],
      },
    ],
    coordinateFrameIds: ["venue-control", "grand-hall-local"],
    qualityReports: [
      {
        id: "representation-qa",
        outcome: "passed",
        evidenceResolved: true,
        profileResolved: true,
      },
      {
        id: "package-qa",
        outcome: "passed",
        evidenceResolved: true,
        profileResolved: true,
      },
    ],
  });
}

function assemblyInput() {
  const manifest = ingestManifest();
  return FoundryRoomRealityPackageAssemblyInputV0Schema.parse({
    ingestManifest: manifest,
    verifiedIngestManifestSha256: computeFoundryIngestManifestSha256(manifest),
    packageDraft: packageDraft(),
    referenceCatalog: referenceCatalog(),
  });
}

function generatedAssemblyInput() {
  const input = assemblyInput();
  return FoundryRoomRealityPackageAssemblyInputV0Schema.parse({
    ...input,
    packageDraft: {
      ...input.packageDraft,
      rooms: input.packageDraft.rooms.map((room) => ({
        ...room,
        representations: [
          ...room.representations,
          {
            id: "generated-appearance",
            role: "generated_derivative",
            assetId: "generated-appearance-asset",
            format: "glb",
            coordinateFrameId: "grand-hall-local",
            transformArtifactAssetId: null,
            qualityReportId: "representation-qa",
            provenanceClass: "generated_cinematic",
            lod: 0,
          },
        ],
      })),
      generatedRegions: [
        {
          id: "generated-appearance-region",
          outputAssetId: "generated-appearance-asset",
          sourceAssetIds: ["semantic-graph-asset", "captured-geometry-asset"],
          maskAssetId: "generated-appearance-mask",
          provenanceClass: "generated_cinematic",
          modelName: "appearance-model",
          modelVersion: "v1",
          checkpointSha256: CHECKPOINT_DIGEST,
          promptOrConditionDigest: CONDITION_DIGEST,
          confidence: 0.8,
          exportRestrictions: [
            "Keep generated pixels visibly disclosed.",
            "Never merge into measured geometry.",
          ],
          truthModeDisclosure:
            "This region is generated cinematic appearance and is not captured room evidence.",
        },
      ],
    },
    referenceCatalog: {
      ...input.referenceCatalog,
      assets: [
        ...input.referenceCatalog.assets,
        {
          id: "generated-appearance-asset",
          provenanceClass: "generated_cinematic",
          evidenceKinds: ["provenance_report"],
        },
        {
          id: "generated-appearance-mask",
          provenanceClass: "captured",
          evidenceKinds: ["other", "mask"],
        },
      ],
    },
  });
}

describe("Room Reality Package assembly", () => {
  it("assembles an explicitly unverified local Grand Hall candidate with no downstream authority", () => {
    const input = assemblyInput();
    const result = assembleFoundryRoomRealityPackage(input);

    expect(result).toMatchObject({
      status: "local_unverified_candidate",
      packageId: "trades-hall-room-reality-v0",
      projectId: "trades-hall-reality",
      ingestManifestSha256: input.verifiedIngestManifestSha256,
      unresolvedReferences: [],
      ingestLegalReviewState: "approved",
      referenceCatalogAuthority: "caller_supplied_unverified",
      exactMemberIdentities: "not_verified",
      movableObjectClassification: "not_verified",
      releaseEligibility: "blocked",
      releaseBlockers: [
        "EXACT_MEMBER_IDENTITIES_UNVERIFIED",
        "MOVABLE_OBJECT_CLASSIFICATION_UNVERIFIED",
        "REFERENCE_CATALOG_UNAUTHENTICATED",
      ],
      authority: "none",
      capabilities: {
        signing: "not_authorized",
        publication: "not_authorized",
        runtimeActivation: "not_authorized",
        exportAuthority: "not_authorized",
        runtimePackageRegistration: "not_authorized",
      },
    });
    expect(
      result.canonicalPackage?.rooms[0]?.representations.map(({ id }) => id),
    ).toEqual([
      "camera-spawns",
      "captured-geometry",
      "room-connectivity",
      "semantic-graph",
    ]);
    expect(
      FoundryRoomRealityPackageAssemblyResultV0Schema.parse(result),
    ).toEqual(result);
  });

  it("returns an actionable block instead of fabricating a missing required room role", () => {
    const input = assemblyInput();
    const result = assembleFoundryRoomRealityPackage({
      ...input,
      packageDraft: {
        ...input.packageDraft,
        rooms: input.packageDraft.rooms.map((room) => ({
          ...room,
          representations: room.representations.filter(
            (representation) => representation.role !== "camera_spawn_points",
          ),
        })),
      },
    });

    expect(result.status).toBe("blocked");
    expect(result.canonicalPackage).toBeNull();
    expect(result.unresolvedReferences).toEqual([
      "required_room_role:grand-hall:camera_spawn_points",
    ]);
  });

  it("keeps a rights-blocked package only as a visibly blocked local candidate", () => {
    const input = assemblyInput();
    const blockedManifest = FoundryIngestManifestV0Schema.parse({
      ...input.ingestManifest,
      legalReviewState: "blocked",
    });
    const result = assembleFoundryRoomRealityPackage({
      ...input,
      ingestManifest: blockedManifest,
      verifiedIngestManifestSha256:
        computeFoundryIngestManifestSha256(blockedManifest),
    });

    expect(result).toMatchObject({
      status: "local_unverified_candidate",
      ingestLegalReviewState: "blocked",
      releaseEligibility: "blocked",
      authority: "none",
    });
    expect(result.releaseBlockers).toContain("RIGHTS_BLOCKED");
    expect(result.releaseBlockers).not.toContain("RIGHTS_NOT_APPROVED");
  });

  it("reports exact failed QA, TransformArtifact, and Scene Authority references", () => {
    const input = assemblyInput();
    const result = assembleFoundryRoomRealityPackage({
      ...input,
      referenceCatalog: {
        ...input.referenceCatalog,
        assets: input.referenceCatalog.assets
          .filter((asset) => asset.id !== "grand-hall-scene-authority-map")
          .map((asset) =>
            asset.id === "grand-hall-to-venue-transform"
              ? { ...asset, evidenceKinds: [] }
              : asset,
          ),
        qualityReports: input.referenceCatalog.qualityReports.map((report) =>
          report.id === "representation-qa"
            ? { ...report, outcome: "failed" }
            : report,
        ),
      },
    });

    expect(result.status).toBe("blocked");
    expect(result.canonicalPackage).not.toBeNull();
    expect(result.unresolvedReferences).toEqual([
      "asset:grand-hall-scene-authority-map",
      "asset_kind:grand-hall-to-venue-transform:transform_artifact",
      "quality_unapproved:representation-qa",
    ]);
  });

  it("keeps a generated derivative separate and enforces its mask and provenance", () => {
    const input = generatedAssemblyInput();
    const candidate = assembleFoundryRoomRealityPackage(input);
    expect(candidate.status).toBe("local_unverified_candidate");
    expect(candidate.canonicalPackage?.generatedRegions).toHaveLength(1);
    expect(
      candidate.canonicalPackage?.rooms[0]?.representations.find(
        (representation) => representation.id === "generated-appearance",
      ),
    ).toMatchObject({
      role: "generated_derivative",
      provenanceClass: "generated_cinematic",
    });

    const blocked = assembleFoundryRoomRealityPackage({
      ...input,
      referenceCatalog: {
        ...input.referenceCatalog,
        assets: input.referenceCatalog.assets.map((asset) => {
          if (asset.id === "generated-appearance-asset") {
            return { ...asset, provenanceClass: "captured" };
          }
          if (asset.id === "generated-appearance-mask") {
            return { ...asset, evidenceKinds: ["other"] };
          }
          return asset;
        }),
      },
    });
    expect(blocked.status).toBe("blocked");
    expect(blocked.unresolvedReferences).toEqual([
      "asset_kind:generated-appearance-mask:mask",
      "provenance_mismatch:generated-appearance-asset",
    ]);
  });

  it("canonicalizes caller-controlled input order deterministically", () => {
    const input = generatedAssemblyInput();
    const expected = assembleFoundryRoomRealityPackage(input);
    const reordered = assembleFoundryRoomRealityPackage({
      ...input,
      packageDraft: {
        ...input.packageDraft,
        rooms: [...input.packageDraft.rooms].reverse().map((room) => ({
          ...room,
          representations: [...room.representations].reverse(),
        })),
        generatedRegions: [...input.packageDraft.generatedRegions]
          .reverse()
          .map((region) => ({
            ...region,
            sourceAssetIds: [...region.sourceAssetIds].reverse(),
            exportRestrictions: [...region.exportRestrictions].reverse(),
          })),
      },
      referenceCatalog: {
        assets: [...input.referenceCatalog.assets].reverse().map((asset) => ({
          ...asset,
          evidenceKinds: [...asset.evidenceKinds].reverse(),
        })),
        coordinateFrameIds: [
          ...input.referenceCatalog.coordinateFrameIds,
        ].reverse(),
        qualityReports: [...input.referenceCatalog.qualityReports].reverse(),
      },
    });

    expect(reordered).toEqual(expected);
  });

  it("rejects a tampered ingest binding and recomputes against the exact inputs", () => {
    const input = assemblyInput();
    const tamperedManifest = {
      ...input.ingestManifest,
      createdBy: "different-reviewer",
    };
    try {
      assembleFoundryRoomRealityPackage({
        ...input,
        ingestManifest: tamperedManifest,
      });
      throw new Error("expected ingest digest mismatch");
    } catch (error: unknown) {
      expect(error).toBeInstanceOf(FoundryIntegrityError);
      expect((error as FoundryIntegrityError).code).toBe(
        "ROOM_REALITY_PACKAGE_INGEST_DIGEST_MISMATCH",
      );
    }

    const result = assembleFoundryRoomRealityPackage(input);
    expect(verifyFoundryRoomRealityPackageAssembly(result, input)).toEqual(
      result,
    );
    expect(() =>
      verifyFoundryRoomRealityPackageAssembly(result, {
        ...input,
        packageDraft: {
          ...input.packageDraft,
          createdAt: "2026-08-09T10:00:01.000Z",
        },
      }),
    ).toThrowError(/does not match the exact supplied manifest/u);
    expect(
      FoundryRoomRealityPackageAssemblyResultV0Schema.safeParse({
        ...result,
        canonicalPackage:
          result.canonicalPackage === null
            ? null
            : {
                ...result.canonicalPackage,
                createdAt: "2026-08-09T10:00:01.000Z",
              },
      }).success,
    ).toBe(false);
  });

  it("strictly rejects unknown room and representation fields without claiming semantic furniture detection", () => {
    const input = assemblyInput();
    const roomFurnitureInput: unknown = {
      ...input,
      packageDraft: {
        ...input.packageDraft,
        rooms: input.packageDraft.rooms.map((room) => ({
          ...room,
          furniture: [{ id: "banquet-table-1" }],
        })),
      },
    };
    const representationFurnitureInput: unknown = {
      ...input,
      packageDraft: {
        ...input.packageDraft,
        rooms: input.packageDraft.rooms.map((room) => ({
          ...room,
          representations: room.representations.map((representation) => ({
            ...representation,
            furnitureAssetId: "banquet-table-1",
          })),
        })),
      },
    };

    for (const invalidInput of [
      roomFurnitureInput,
      representationFurnitureInput,
    ]) {
      try {
        assembleFoundryRoomRealityPackage(invalidInput);
        throw new Error("expected strict assembly input rejection");
      } catch (error: unknown) {
        expect(error).toBeInstanceOf(FoundryIntegrityError);
        expect((error as FoundryIntegrityError).code).toBe(
          "ROOM_REALITY_PACKAGE_ASSEMBLY_INPUT_INVALID",
        );
      }
    }
  });
});
