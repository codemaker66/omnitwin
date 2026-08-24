import {
  FOUNDRY_INGEST_MANIFEST_V0,
  FOUNDRY_INPUT_TYPES,
  FoundryIngestManifestV0Schema,
  type FoundryIngestManifestV0,
  type FoundryInputType,
} from "@omnitwin/types";
import { describe, expect, it } from "vitest";
import {
  FOUNDRY_ADAPTER_CAPABILITY_INPUT_TYPE_COVERAGE,
  FOUNDRY_ADAPTER_HOST_CAPABILITY_INVENTORY_V0,
  FOUNDRY_ADAPTER_HOST_DEPENDENCY_IDS,
  FoundryAdapterCapabilityAssessmentV0Schema,
  FoundryAdapterHostCapabilityInventoryV0Schema,
  compileFoundryAdapterCapabilityAssessmentV0,
  serializeFoundryAdapterCapabilityAssessmentV0,
  verifyFoundryAdapterCapabilityAssessmentV0,
  type FoundryAdapterHostCapabilityInventoryV0,
  type FoundryAdapterHostDependencyId,
} from "../adapter-capability-assessment.js";

const CREATED_AT = "2026-08-09T10:00:00.000Z";
const OBSERVED_AT = "2026-08-09T10:05:00.000Z";

const DEPENDENCY_VERSION: Readonly<
  Record<FoundryAdapterHostDependencyId, string>
> = {
  pye57_read_only_metadata_probe: "0.4.19",
  pye57_cartesian_geometry_reader: "0.4.19",
  gltf_transform_core: "4.3.0",
  gltf_validator: "2.0.0-dev.3.10",
  meshoptimizer: "1.2.0",
};

type DependencyStatus = "available" | "missing" | "unverified";

function hostCapabilities(
  statuses: Partial<
    Readonly<Record<FoundryAdapterHostDependencyId, DependencyStatus>>
  > = {},
): FoundryAdapterHostCapabilityInventoryV0 {
  return FoundryAdapterHostCapabilityInventoryV0Schema.parse({
    schemaVersion: FOUNDRY_ADAPTER_HOST_CAPABILITY_INVENTORY_V0,
    hostId: "grand-hall-workstation",
    observedAt: OBSERVED_AT,
    platform: "win32",
    dependencies: FOUNDRY_ADAPTER_HOST_DEPENDENCY_IDS.map((id) => {
      const status = statuses[id] ?? "available";
      return {
        id,
        status,
        version: status === "available" ? DEPENDENCY_VERSION[id] : null,
      };
    }),
  });
}

type InputAsset = FoundryIngestManifestV0["assets"][number];

function digestFor(index: number): `sha256:${string}` {
  return `sha256:${index.toString(16).padStart(64, "0")}`;
}

function asset(
  inputType: FoundryInputType,
  index: number,
  overrides: Partial<InputAsset> = {},
): InputAsset {
  return {
    id: `asset-${index.toString().padStart(3, "0")}`,
    sourceRootId: "source-root",
    relativePath: `sources/${index.toString().padStart(3, "0")}-${inputType}.bin`,
    inputType,
    mediaType: "application/octet-stream",
    sizeBytes: 1_024 + index,
    sha256: digestFor(index + 1),
    immutable: true,
    captureState: "reference",
    accessState: "direct",
    capturedAt: null,
    coordinateFrameId: null,
    calibrationAssetIds: [],
    parentAssetIds: [],
    rights: {
      basis: "customer_owned",
      commercialUse: "allowed",
      modelTrainingUse: "allowed",
      redistribution: "allowed",
      termsReviewedAt: CREATED_AT,
      termsReference: `https://rights.example/assets/${index.toString()}`,
      restrictions: [],
    },
    provenanceClass: "captured",
    evidenceKinds: inputType === "evidence_record" ? ["other"] : [],
    inspection: {
      geometryValue: "unknown",
      appearanceValue: "unknown",
      calibrationValue: "unknown",
      scaleValue: "unknown",
      metadataKeys: [],
      decisiveNextTest: "Run the exact bounded source inspection.",
    },
    notes: [],
    ...overrides,
  };
}

function manifest(
  assets: readonly InputAsset[],
  legalReviewState: FoundryIngestManifestV0["legalReviewState"] = "approved",
): FoundryIngestManifestV0 {
  return FoundryIngestManifestV0Schema.parse({
    schemaVersion: FOUNDRY_INGEST_MANIFEST_V0,
    projectId: "grand-hall-adapter-assessment",
    createdAt: CREATED_AT,
    createdBy: "foundry-operator",
    sourceRoots: [
      {
        id: "source-root",
        kind: "local_directory",
        displayName: "Rights-cleared capture bundle",
        locationRedacted: "PRIVATE_STAGE/[redacted]",
        caseSensitivity: "insensitive",
        readOnly: true,
      },
    ],
    coordinateFrames: [],
    transforms: [],
    assets,
    provenanceEdges: [],
    generatedRegions: [],
    legalReviewState,
    sourceMutationPermitted: false,
  });
}

function outcomeByType(
  assessment: ReturnType<typeof compileFoundryAdapterCapabilityAssessmentV0>,
  inputType: FoundryInputType,
) {
  const outcome = assessment.assets.find(
    (item) => item.inputType === inputType,
  );
  if (outcome === undefined) throw new Error(`missing ${inputType} outcome`);
  return outcome;
}

describe("adapter capability assessment", () => {
  it("covers every current FoundryInputType without promoting detection into processing", () => {
    const sourceManifest = manifest(
      FOUNDRY_INPUT_TYPES.map((inputType, index) =>
        asset(inputType, index + 1),
      ),
    );
    const assessment = compileFoundryAdapterCapabilityAssessmentV0({
      manifest: sourceManifest,
      hostCapabilities: hostCapabilities(),
    });

    expect(FOUNDRY_ADAPTER_CAPABILITY_INPUT_TYPE_COVERAGE).toEqual(
      FOUNDRY_INPUT_TYPES,
    );
    expect(new Set(assessment.assets.map((item) => item.inputType))).toEqual(
      new Set(FOUNDRY_INPUT_TYPES),
    );
    expect(assessment.summary.assetCount).toBe(FOUNDRY_INPUT_TYPES.length);
    expect(assessment.summary.productionReadyCount).toBe(0);
    expect(
      assessment.assets.every((item) => item.status !== "production_ready"),
    ).toBe(true);
    expect(assessment.authority).toBe("none");
    expect(assessment.execution).toBe("not_authorized");

    expect(outcomeByType(assessment, "generic_e57")).toMatchObject({
      structuralInspection: "implemented",
      localDeterministicProcessing: "not_implemented",
      productionReachability: "worker_missing",
      primaryFindingCode: "LOCAL_DETERMINISTIC_PROCESSING_NOT_IMPLEMENTED",
    });
    expect(
      outcomeByType(assessment, "generic_e57").findings.find(
        (finding) =>
          finding.code === "E57_GEOMETRY_EXACT_ASSET_COMPATIBILITY_UNVERIFIED",
      )?.category,
    ).toBe("unsupported_variant");
    expect(
      outcomeByType(assessment, "generic_e57").findings.map(
        (finding) => finding.code,
      ),
    ).toEqual(
      expect.arrayContaining([
        "LOCAL_DETERMINISTIC_PROCESSING_NOT_IMPLEMENTED",
        "E57_GEOMETRY_EXACT_ASSET_COMPATIBILITY_UNVERIFIED",
        "LOCAL_E57_GEOMETRY_CORE_IMPLEMENTED",
      ]),
    );
    expect(outcomeByType(assessment, "matterport_e57")).toMatchObject({
      structuralInspection: "implemented",
      localDeterministicProcessing: "not_implemented",
      productionReachability: "worker_missing",
      primaryFindingCode: "LOCAL_DETERMINISTIC_PROCESSING_NOT_IMPLEMENTED",
    });
    expect(
      outcomeByType(assessment, "matterport_e57").findings.map(
        (finding) => finding.code,
      ),
    ).toEqual(
      expect.arrayContaining([
        "LOCAL_DETERMINISTIC_PROCESSING_NOT_IMPLEMENTED",
        "E57_GEOMETRY_EXACT_ASSET_COMPATIBILITY_UNVERIFIED",
        "LOCAL_E57_GEOMETRY_CORE_IMPLEMENTED",
      ]),
    );
    expect(
      outcomeByType(assessment, "generic_e57").findings.map(
        (finding) => finding.code,
      ),
    ).not.toContain("E57_GEOMETRY_EXECUTION_ACTIVATION_MISSING");
    expect(outcomeByType(assessment, "sog")).toMatchObject({
      structuralInspection: "implemented",
      localDeterministicProcessing: "not_implemented",
    });
    expect(outcomeByType(assessment, "spz")).toMatchObject({
      structuralInspection: "implemented",
      localDeterministicProcessing: "not_implemented",
    });
    expect(outcomeByType(assessment, "gaussian_ply")).toMatchObject({
      structuralInspection: "implemented",
      localDeterministicProcessing: "not_implemented",
    });
    expect(outcomeByType(assessment, "ply_point_cloud")).toMatchObject({
      structuralInspection: "implemented",
      primaryFindingCode: "LOCAL_DETERMINISTIC_PROCESSING_NOT_IMPLEMENTED",
    });
    expect(outcomeByType(assessment, "glb_gltf")).toMatchObject({
      structuralInspection: "implemented",
      localDeterministicProcessing:
        "subset_core_available_exact_asset_unverified",
      productionReachability: "activation_missing",
      primaryFindingCode:
        "GLB_NORMALIZATION_EXACT_ASSET_COMPATIBILITY_UNVERIFIED",
    });
    expect(outcomeByType(assessment, "xgrids_xbin")).toMatchObject({
      structuralInspection: "blocked_vendor_format",
      productionReachability: "official_vendor_export_or_sdk_required",
      primaryFindingCode: "XGRIDS_XBIN_OFFICIAL_EXPORT_REQUIRED",
    });
    expect(outcomeByType(assessment, "las_laz")).toMatchObject({
      structuralInspection: "detection_only",
      primaryFindingCode: "STRUCTURAL_INSPECTION_NOT_IMPLEMENTED",
    });
  });

  it("applies rights before dependency and activation findings", () => {
    const glb = asset("glb_gltf", 1);
    const missingDependencies = hostCapabilities({
      gltf_transform_core: "missing",
      gltf_validator: "missing",
      meshoptimizer: "missing",
    });
    const reviewRequired = compileFoundryAdapterCapabilityAssessmentV0({
      manifest: manifest([glb], "requires_review"),
      hostCapabilities: missingDependencies,
    }).assets[0];
    expect(reviewRequired).toBeDefined();
    expect(reviewRequired?.status).toBe("review_required");
    expect(reviewRequired?.primaryFindingCode).toBe(
      "ASSET_RIGHTS_REVIEW_REQUIRED",
    );
    expect(reviewRequired?.findings.map((item) => item.code)).toContain(
      "HOST_DEPENDENCY_MISSING",
    );
    expect(reviewRequired?.findings.map((item) => item.code)).toContain(
      "GLB_NORMALIZATION_EXECUTION_ACTIVATION_MISSING",
    );

    const dependencyBlocked = compileFoundryAdapterCapabilityAssessmentV0({
      manifest: manifest([glb]),
      hostCapabilities: missingDependencies,
    }).assets[0];
    expect(dependencyBlocked?.status).toBe("not_ready");
    expect(dependencyBlocked?.primaryFindingCode).toBe(
      "HOST_DEPENDENCY_MISSING",
    );

    const activatedMissing = compileFoundryAdapterCapabilityAssessmentV0({
      manifest: manifest([glb]),
      hostCapabilities: hostCapabilities(),
    }).assets[0];
    expect(activatedMissing?.primaryFindingCode).toBe(
      "GLB_NORMALIZATION_EXACT_ASSET_COMPATIBILITY_UNVERIFIED",
    );

    const rightsBlockedXbin = compileFoundryAdapterCapabilityAssessmentV0({
      manifest: manifest([asset("xgrids_xbin", 2)], "blocked"),
      hostCapabilities: hostCapabilities(),
    }).assets[0];
    expect(rightsBlockedXbin?.status).toBe("blocked");
    expect(rightsBlockedXbin?.primaryFindingCode).toBe("ASSET_RIGHTS_BLOCKED");
    expect(rightsBlockedXbin?.findings.map((item) => item.code)).toContain(
      "XGRIDS_XBIN_OFFICIAL_EXPORT_REQUIRED",
    );
  });

  it("is deterministic, self-digested, and bound to the exact inputs", () => {
    const sourceManifest = manifest([
      asset("generic_e57", 1),
      asset("glb_gltf", 2),
    ]);
    const inventory = hostCapabilities({
      pye57_read_only_metadata_probe: "unverified",
    });
    const first = compileFoundryAdapterCapabilityAssessmentV0({
      manifest: sourceManifest,
      hostCapabilities: inventory,
    });
    const second = compileFoundryAdapterCapabilityAssessmentV0({
      manifest: sourceManifest,
      hostCapabilities: inventory,
    });
    expect(second).toEqual(first);
    expect(serializeFoundryAdapterCapabilityAssessmentV0(second)).toBe(
      serializeFoundryAdapterCapabilityAssessmentV0(first),
    );
    expect(
      verifyFoundryAdapterCapabilityAssessmentV0({
        manifest: sourceManifest,
        hostCapabilities: inventory,
        assessment: first,
      }),
    ).toEqual(first);

    const tampered = structuredClone(first);
    tampered.assets[0]!.nextAction = "Run an unreviewed binary.";
    expect(() =>
      FoundryAdapterCapabilityAssessmentV0Schema.parse(tampered),
    ).toThrow(/assessment digest/u);

    const otherManifest = manifest([asset("generic_e57", 9)]);
    expect(() =>
      verifyFoundryAdapterCapabilityAssessmentV0({
        manifest: otherManifest,
        hostCapabilities: inventory,
        assessment: first,
      }),
    ).toThrow(/does not match the exact manifest/u);

    const reorderedInventory = structuredClone(inventory);
    reorderedInventory.dependencies.reverse();
    expect(() =>
      FoundryAdapterHostCapabilityInventoryV0Schema.parse(reorderedInventory),
    ).toThrow(/canonical order/u);
  });

  it("reports exact blockers for a Grand Hall-like mixed manifest", () => {
    const sourceManifest = manifest([
      asset("generic_e57", 1, {
        id: "grand-hall-e57",
        relativePath: "capture/cloud.e57",
      }),
      asset("glb_gltf", 2, {
        id: "grand-hall-glb",
        relativePath: "derived/shell.glb",
      }),
      asset("matterport_panorama", 3, {
        id: "grand-hall-panorama",
        relativePath: "capture/pano-001.jpg",
      }),
      asset("ply_point_cloud", 4, {
        id: "grand-hall-ply",
        relativePath: "capture/cloud.ply",
      }),
      asset("spz", 5, {
        id: "grand-hall-spz",
        relativePath: "derived/appearance.spz",
      }),
      asset("xgrids_xbin", 6, {
        id: "grand-hall-xbin",
        relativePath: "vendor/source.xbin",
      }),
    ]);
    const assessment = compileFoundryAdapterCapabilityAssessmentV0({
      manifest: sourceManifest,
      hostCapabilities: hostCapabilities({
        pye57_read_only_metadata_probe: "missing",
        pye57_cartesian_geometry_reader: "missing",
      }),
    });
    const blockers = Object.fromEntries(
      assessment.assets.map((item) => [item.assetId, item.primaryFindingCode]),
    );

    expect(blockers).toEqual({
      "grand-hall-e57": "LOCAL_DETERMINISTIC_PROCESSING_NOT_IMPLEMENTED",
      "grand-hall-glb":
        "GLB_NORMALIZATION_EXACT_ASSET_COMPATIBILITY_UNVERIFIED",
      "grand-hall-panorama": "LOCAL_DETERMINISTIC_PROCESSING_NOT_IMPLEMENTED",
      "grand-hall-ply": "LOCAL_DETERMINISTIC_PROCESSING_NOT_IMPLEMENTED",
      "grand-hall-spz": "LOCAL_DETERMINISTIC_PROCESSING_NOT_IMPLEMENTED",
      "grand-hall-xbin": "XGRIDS_XBIN_OFFICIAL_EXPORT_REQUIRED",
    });
    expect(assessment.summary).toMatchObject({
      assetCount: 6,
      structuralInspectionImplementedCount: 5,
      localDeterministicProcessingImplementedCount: 0,
      productionReadyCount: 0,
      missingDependencyAssetCount: 1,
      vendorExportOrSdkRequiredAssetCount: 1,
      processingWorkerMissingAssetCount: 4,
      activationMissingAssetCount: 1,
    });
    expect(assessment.status).toBe("not_ready");
  });
});
