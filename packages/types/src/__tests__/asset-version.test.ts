import { describe, it, expect } from "vitest";
import {
  AssetVersionSchema,
  LatestRuntimePackageQuerySchema,
  PublicRoomRuntimeVisualSchema,
  RegisterAssetVersionInputSchema,
  RegisterRuntimePackageInputSchema,
  RegisterRuntimeTransformArtifactInputSchema,
  RoomManifestSchema,
  RoomAssetStatusSchema,
  RUNTIME_TRANSFORM_ARTIFACT_REGISTRATION_REPORT_INSPECTION_STATUSES,
  RuntimeTransformArtifactRegistrationReportInspectionSchema,
  RuntimeTransformArtifactRegistrationReportSchema,
  RuntimeTransformArtifactSchema,
  RuntimePackageManifestJsonSchema,
  RuntimePackageSchema,
  CAPTURE_CONTROL_FRESHNESS_STATUSES,
  ROOM_RUNTIME_CONTROL_EVIDENCE_CHAIN_STATUSES,
  REVIEWED_CAPTURE_CONTROL_STATUSES,
  REVIEWED_RUNTIME_TRANSFORM_STATUSES,
  REVIEWED_RUNTIME_QA_STATUSES,
  SIGNED_RUNTIME_TRANSFORM_ALIGNMENT_METHODS,
  SIGNED_RUNTIME_TRANSFORM_EVIDENCE_REF_TYPES,
  TRADES_HALL_RUNTIME_ROOMS,
  TRADES_HALL_RUNTIME_ROOM_SLUGS,
  assetKindAllowsExtension,
  isForbiddenAssetFixtureKey,
  isR2ObjectKeyShape,
  isTradesHallRuntimeRoomSlug,
  runtimeFileExtensionForKey,
  splatExtensionForKey,
  tradesHallRuntimeRoomForSlug,
  trainingInputR2Prefix,
  trainingOutputR2Prefix,
  type RuntimeTransformArtifactRegistrationReport,
  type RuntimeTransformArtifactRegistrationReportInspection,
} from "../asset-version.js";

const ASSET_VERSION_ID = "10000000-0000-4000-8000-000000000001";
const SEMANTIC_ASSET_VERSION_ID = "10000000-0000-4000-8000-000000000002";
const COLLISION_ASSET_VERSION_ID = "10000000-0000-4000-8000-000000000003";
const RUNTIME_PACKAGE_ID = "10000000-0000-4000-8000-000000000004";
const SHA = "a".repeat(64);
const R2_KEY = "venues/trades-hall/rooms/robert-adam-room/xgrids/2026-06-06/scene.ply";
const TRANSFORM_ARTIFACT_ID = "reception-room-landmark-solve-v0";
const transformEvidenceRef = {
  refType: "landmark_set",
  ref: "docs/operations/reception-room-landmarks-v0.json",
  role: "source_landmarks",
} as const;

const manifestJson = {
  schemaVersion: "venviewer.runtime-package.v1" as const,
  venueSlug: "trades-hall",
  roomSlug: "robert-adam-room",
  packageType: "room-runtime" as const,
  assets: {
    primaryVisualAssetVersionId: ASSET_VERSION_ID,
    semanticMeshAssetVersionId: null,
    collisionAssetVersionId: null,
    pointCloudAssetVersionId: null,
  },
  generatedAt: "2026-06-06T10:00:00.000Z",
};

const validVersionInput = {
  venueSlug: "trades-hall",
  roomSlug: "robert-adam-room",
  assetKind: "splat" as const,
  sourceType: "xgrids" as const,
  r2Key: R2_KEY,
  fileName: "scene.ply",
  fileExt: ".ply" as const,
  sha256: SHA,
  sizeBytes: 2_048,
};

const validTransformArtifact = {
  id: TRANSFORM_ARTIFACT_ID,
  sourceFrame: "COLMAP_RDF",
  targetFrame: "CVF",
  units: "meters",
  matrix: [
    1, 0, 0, 0,
    0, 1, 0, 0,
    0, 0, 1, 0,
    0, 0, 0, 1,
  ],
  alignmentMethod: "landmark_solve",
  residualRmseM: 0.012,
  landmarks: [
    {
      id: "corner-01",
      label: "Control corner 01",
      source: [0, 0, 0],
      target: [0, 0, 0],
      residualM: 0.01,
      provenanceRefs: [transformEvidenceRef],
    },
  ],
  provenance: {
    state: "measured",
    refs: [transformEvidenceRef],
  },
  creator: {
    actorType: "human",
    id: "ops/blake",
    displayName: "Runtime operator",
    role: "runtime_operator",
  },
  reviewer: {
    actorType: "human",
    id: "ops/runtime-reviewer",
    displayName: "Runtime reviewer",
    role: "runtime_reviewer",
  },
  date: "2026-06-15T10:00:00.000Z",
} as const;

function validRuntimeTransformReport(
  overrides: Partial<RuntimeTransformArtifactRegistrationReport> = {},
): RuntimeTransformArtifactRegistrationReport {
  return {
    schemaVersion: "venviewer.runtime-transform-artifact-registration-report.v0",
    generatedAt: "2026-06-16T12:00:00.000Z",
    mode: "registered",
    apiUrl: "http://localhost:3001",
    payloadFile: "docs/operations/reception-room-transform-artifact.json",
    payload: {
      venueSlug: "trades-hall",
      roomSlug: "reception-room",
      runtimePackageId: RUNTIME_PACKAGE_ID,
      transformArtifactId: validTransformArtifact.id,
      sourceFrame: validTransformArtifact.sourceFrame,
      targetFrame: validTransformArtifact.targetFrame,
      alignmentMethod: validTransformArtifact.alignmentMethod,
      provenanceState: validTransformArtifact.provenance.state,
      residualRmseM: validTransformArtifact.residualRmseM,
      landmarkCount: validTransformArtifact.landmarks.length,
      reviewerId: validTransformArtifact.reviewer.id,
      reviewerRole: validTransformArtifact.reviewer.role,
    },
    preflight: {
      payloadRuntimePackageId: RUNTIME_PACKAGE_ID,
      latestRuntimePackageId: RUNTIME_PACKAGE_ID,
      latestRuntimePackageRuntimeStatus: "internal_ready",
      latestRuntimePackageEvidenceStatus: "machine_checked",
      runtimePackageMatchesLatest: true,
      runtimePackageDriftAllowed: false,
    },
    registration: {
      runtimeTransformArtifactRowId: "10000000-0000-4000-8000-000000000021",
      transformArtifactId: validTransformArtifact.id,
      registeredBy: "10000000-0000-4000-8000-000000000007",
      createdAt: "2026-06-16T12:00:00.000Z",
      updatedAt: "2026-06-16T12:00:00.000Z",
    },
    guardrails: {
      runtimePackageDriftAllowed: false,
      runtimeQaRecordChanged: false,
      captureControlSourceChanged: false,
      publicExposureChanged: false,
    },
    ...overrides,
  };
}

function validRuntimeTransformInspection(
  overrides: Partial<RuntimeTransformArtifactRegistrationReportInspection> = {},
): RuntimeTransformArtifactRegistrationReportInspection {
  return {
    schemaVersion: "venviewer.runtime-transform-artifact-registration-report-inspection.v0",
    generatedAt: "2026-06-16T12:05:00.000Z",
    inspectedReportFile: "docs/operations/reception-room-transform-report.json",
    inspectedReportGeneratedAt: "2026-06-16T12:00:00.000Z",
    status: "ready_for_live_transform_registration",
    liveTransformRegistrationReady: true,
    mode: "dry_run",
    venueSlug: "trades-hall",
    roomSlug: "reception-room",
    transformArtifactId: validTransformArtifact.id,
    reportRuntimePackageId: RUNTIME_PACKAGE_ID,
    reportLatestRuntimePackageId: RUNTIME_PACKAGE_ID,
    reportRuntimePackageMatchesLatest: true,
    reportRuntimePackageDriftAllowed: false,
    blockers: [],
    messages: [
      "Report schema is valid for reception-room-landmark-solve-v0 in trades-hall/reception-room.",
      "Report records no runtime QA record, capture-control source, or public exposure change.",
      "Dry-run report is current for live signed-transform registration preflight.",
    ],
    ...overrides,
  };
}

describe("Trades Hall room registry", () => {
  it("pins the seven supported room slugs and status metadata", () => {
    expect(TRADES_HALL_RUNTIME_ROOM_SLUGS).toEqual([
      "grand-hall",
      "reception-room",
      "robert-adam-room",
      "saloon",
      "lady-convenors-room",
      "north-gallery",
      "south-gallery",
    ]);

    for (const room of TRADES_HALL_RUNTIME_ROOMS) {
      expect(room.slug).toBe(room.roomSlug);
      expect(room.defaultStatus).toMatch(/needs_/u);
      expect(room.registryRuntimeStatus).toBe("not_registered");
      expect(room.internalVisualEnabled).toBe(true);
      expect(room.publicShowcaseEnabled).toBe(false);
      expect(room.safeCopy).not.toMatch(/approved|certified|production ready|survey-grade|photoreal/i);
      expect(isTradesHallRuntimeRoomSlug(room.slug)).toBe(true);
      expect(tradesHallRuntimeRoomForSlug(room.slug)?.displayName).toBe(room.displayName);
    }
  });

  it("keeps off-repo splat rooms distinct from captured rooms", () => {
    expect(tradesHallRuntimeRoomForSlug("lady-convenors-room")?.safeCopy).toBe(
      "splat exists outside repo / needs registration",
    );
    expect(tradesHallRuntimeRoomForSlug("north-gallery")?.captureStatus).toBe(
      "splat_exists_outside_repo_needs_registration",
    );
    expect(tradesHallRuntimeRoomForSlug("south-gallery")?.captureStatus).toBe(
      "splat_exists_outside_repo_needs_registration",
    );
    expect(tradesHallRuntimeRoomForSlug("grand-hall")?.safeCopy).toBe("captured / needs processing");
    expect(tradesHallRuntimeRoomForSlug("reception-room")?.captureStatus).toBe(
      "processed_needs_registration",
    );
    expect(tradesHallRuntimeRoomForSlug("reception-room")?.safeCopy).toBe(
      "processed output found / needs registration",
    );
  });

  it("encodes the R2 training path conventions", () => {
    expect(trainingInputR2Prefix("trades-hall", "lady-convenors-room", "xgrids")).toBe(
      "r2:venviewer-training-inputs/trades-hall/rooms/lady-convenors-room/xgrids/",
    );
    expect(trainingInputR2Prefix("trades-hall", "north-gallery", "matterport")).toBe(
      "r2:venviewer-training-inputs/trades-hall/rooms/north-gallery/matterport/",
    );
    expect(trainingInputR2Prefix("trades-hall", "south-gallery", "raw")).toBe(
      "r2:venviewer-training-inputs/trades-hall/rooms/south-gallery/raw/",
    );
    expect(trainingOutputR2Prefix("trades-hall", "lady-convenors-room", "runtime")).toBe(
      "r2:venviewer-training-outputs/trades-hall/rooms/lady-convenors-room/runtime/",
    );
    expect(trainingOutputR2Prefix("trades-hall", "north-gallery", "xgrids")).toBe(
      "r2:venviewer-training-outputs/trades-hall/rooms/north-gallery/xgrids/",
    );
    expect(trainingOutputR2Prefix("trades-hall", "south-gallery", "runpod")).toBe(
      "r2:venviewer-training-outputs/trades-hall/rooms/south-gallery/runpod/",
    );
  });

  it("rejects unsupported Trades Hall room slugs in registration contracts", () => {
    expect(isTradesHallRuntimeRoomSlug("made-up-room")).toBe(false);
    expect(RegisterAssetVersionInputSchema.safeParse({
      ...validVersionInput,
      roomSlug: "made-up-room",
    }).success).toBe(false);
    expect(RegisterAssetVersionInputSchema.safeParse({
      ...validVersionInput,
      venueSlug: "other-venue",
      roomSlug: "made-up-room",
    }).success).toBe(true);
  });
});

describe("runtime file extension helpers", () => {
  it("returns the extension for supported runtime asset files", () => {
    expect(runtimeFileExtensionForKey("a/b/scene.ply")).toBe(".ply");
    expect(runtimeFileExtensionForKey("a/b/scene.spz")).toBe(".spz");
    expect(runtimeFileExtensionForKey("a/SCENE.SPLAT")).toBe(".splat");
    expect(runtimeFileExtensionForKey("a/tiles/0_1_0.sog")).toBe(".sog");
    expect(runtimeFileExtensionForKey("a/scene.glb")).toBe(".glb");
    expect(runtimeFileExtensionForKey("a/cloud.e57")).toBe(".e57");
    expect(runtimeFileExtensionForKey("a/manifest.json")).toBe(".json");
    expect(runtimeFileExtensionForKey("a/Reception%20Room.lcc2")).toBe(".lcc2");
  });

  it("separates Spark splat extensions from broader registry formats", () => {
    expect(splatExtensionForKey("a/b/scene.ply")).toBe(".ply");
    expect(splatExtensionForKey("a/b/scene.spz?signature=abc")).toBe(".spz");
    expect(splatExtensionForKey("a/b/0_1_0.sog")).toBe(".sog");
    expect(splatExtensionForKey("a/b/scene.glb")).toBeNull();
  });

  it("pins asset kind to allowed file formats", () => {
    expect(assetKindAllowsExtension("splat", ".ply")).toBe(true);
    expect(assetKindAllowsExtension("splat", ".sog")).toBe(true);
    expect(assetKindAllowsExtension("mesh", ".glb")).toBe(true);
    expect(assetKindAllowsExtension("mesh", ".ply")).toBe(false);
    expect(assetKindAllowsExtension("manifest", ".lcc2")).toBe(true);
    expect(assetKindAllowsExtension("splat", ".lcc2")).toBe(false);
    expect(assetKindAllowsExtension("video", ".json")).toBe(false);
  });
});

describe("R2 key and fixture rejection", () => {
  it("accepts object keys and rejects URLs/root-relative paths", () => {
    expect(isR2ObjectKeyShape(R2_KEY)).toBe(true);
    expect(isR2ObjectKeyShape("https://assets.example/scene.ply")).toBe(false);
    expect(isR2ObjectKeyShape("/venues/trades-hall/scene.ply")).toBe(false);
    expect(isR2ObjectKeyShape("venues/trades-hall/../scene.ply")).toBe(false);
    expect(isR2ObjectKeyShape("venues\\trades-hall\\scene.ply")).toBe(false);
  });

  it("flags fixture/demo markers regardless of case", () => {
    expect(isForbiddenAssetFixtureKey("dev/Splat-Fixture/scene.spz")).toBe(true);
    expect(isForbiddenAssetFixtureKey("dev/textsplats/x.ply")).toBe(true);
    expect(isForbiddenAssetFixtureKey("a/spark-fixture/y.splat")).toBe(true);
    expect(isForbiddenAssetFixtureKey(R2_KEY)).toBe(false);
  });
});

describe("RegisterAssetVersionInputSchema", () => {
  it("accepts a room-scoped XGRIDS splat and applies safe defaults", () => {
    const parsed = RegisterAssetVersionInputSchema.parse(validVersionInput);
    expect(parsed.venueSlug).toBe("trades-hall");
    expect(parsed.roomSlug).toBe("robert-adam-room");
    expect(parsed.evidenceStatus).toBe("unverified");
    expect(parsed.runtimeStatus).toBe("staged");
  });

  it("accepts a Reception Room XGRIDS SOG splat candidate", () => {
    const parsed = RegisterAssetVersionInputSchema.parse({
      ...validVersionInput,
      roomSlug: "reception-room",
      r2Key: "venues/trades-hall/rooms/reception-room/xgrids/2026-06-08/lcc2-result/data/3dgs/0_1_0.sog",
      fileName: "0_1_0.sog",
      fileExt: ".sog",
      sha256: "08c928b2556e2ba38cdf1777c806bb6b7ece249d5e7c442d20c0232ca703005c",
      sizeBytes: 9845814,
      notes: "Candidate XGRIDS/LCC2 SOG chunk; verify whether it represents a tile or whole-room visual before making a runtime package loadable.",
    });
    expect(parsed.roomSlug).toBe("reception-room");
    expect(parsed.fileExt).toBe(".sog");
    expect(parsed.runtimeStatus).toBe("staged");
    expect(parsed.evidenceStatus).toBe("unverified");
  });

  it("accepts the Reception Room XGRIDS LCC2 manifest as provenance, not a splat", () => {
    const parsed = RegisterAssetVersionInputSchema.parse({
      ...validVersionInput,
      roomSlug: "reception-room",
      assetKind: "manifest",
      r2Key: "venues/trades-hall/rooms/reception-room/xgrids/2026-06-08/lcc2-result/Reception Room.lcc2",
      fileName: "Reception Room.lcc2",
      fileExt: ".lcc2",
      sha256: "f0a4c782cc0f031830404d409f5c0accdc30ed501fa562169206962ceee64f3e",
      sizeBytes: 80065,
      notes: "Canonical XGRIDS LCC2 manifest for the Reception Room processed output; Spark loads SOG chunks, not this manifest directly.",
    });
    expect(parsed.assetKind).toBe("manifest");
    expect(parsed.fileExt).toBe(".lcc2");
    expect(assetKindAllowsExtension("splat", parsed.fileExt)).toBe(false);
  });

  it("accepts a master scan with a nullable room slug", () => {
    const parsed = RegisterAssetVersionInputSchema.parse({
      ...validVersionInput,
      roomSlug: null,
      assetKind: "point_cloud",
      fileName: "master.e57",
      fileExt: ".e57",
      r2Key: "venues/trades-hall/master/matterport/master.e57",
      sourceType: "matterport",
    });
    expect(parsed.roomSlug).toBeNull();
  });

  it("rejects fixture/demo asset keys", () => {
    const result = RegisterAssetVersionInputSchema.safeParse({
      ...validVersionInput,
      r2Key: "dev/splat-fixture/scene.ply",
    });
    expect(result.success).toBe(false);
  });

  it("rejects arbitrary URL registration", () => {
    const result = RegisterAssetVersionInputSchema.safeParse({
      ...validVersionInput,
      r2Key: "https://assets.example/scene.ply",
    });
    expect(result.success).toBe(false);
  });

  it("rejects a file extension that does not match the R2 key", () => {
    const result = RegisterAssetVersionInputSchema.safeParse({
      ...validVersionInput,
      fileExt: ".spz",
    });
    expect(result.success).toBe(false);
  });

  it("rejects a format not allowed for the asset kind", () => {
    const result = RegisterAssetVersionInputSchema.safeParse({
      ...validVersionInput,
      assetKind: "mesh",
    });
    expect(result.success).toBe(false);
  });

  it("rejects malformed hashes and unknown statuses", () => {
    expect(RegisterAssetVersionInputSchema.safeParse({ ...validVersionInput, sha256: "nope" }).success).toBe(false);
    expect(RegisterAssetVersionInputSchema.safeParse({ ...validVersionInput, runtimeStatus: "published" }).success).toBe(false);
    expect(RegisterAssetVersionInputSchema.safeParse({ ...validVersionInput, evidenceStatus: "certified" }).success).toBe(false);
  });
});

describe("runtime package manifest schemas", () => {
  it("accepts a strict v1 manifest", () => {
    const parsed = RuntimePackageManifestJsonSchema.parse(manifestJson);
    expect(parsed.assets.primaryVisualAssetVersionId).toBe(ASSET_VERSION_ID);
  });

  it("rejects unknown manifest fields", () => {
    const result = RuntimePackageManifestJsonSchema.safeParse({
      ...manifestJson,
      arbitraryClaim: true,
    });
    expect(result.success).toBe(false);
  });

  it("requires package fields to match manifest fields", () => {
    const result = RegisterRuntimePackageInputSchema.safeParse({
      venueSlug: "trades-hall",
      roomSlug: "saloon",
      primaryVisualAssetVersionId: ASSET_VERSION_ID,
      manifestJson,
      runtimeStatus: "internal_ready",
    });
    expect(result.success).toBe(false);
  });

  it("requires a primary visual asset before a package can be loadable", () => {
    const result = RegisterRuntimePackageInputSchema.safeParse({
      venueSlug: "trades-hall",
      roomSlug: "saloon",
      primaryVisualAssetVersionId: null,
      manifestJson: {
        ...manifestJson,
        roomSlug: "saloon",
        assets: {
          primaryVisualAssetVersionId: null,
          semanticMeshAssetVersionId: null,
          collisionAssetVersionId: null,
        },
      },
      runtimeStatus: "internal_ready",
    });
    expect(result.success).toBe(false);
  });
});

describe("runtime transform artifact registration schemas", () => {
  it("pins the signed transform method and evidence vocabularies", () => {
    expect(SIGNED_RUNTIME_TRANSFORM_ALIGNMENT_METHODS).toEqual([
      "manual_alignment",
      "icp",
      "landmark_solve",
      "matterport_e57_extraction",
      "blender_authored_placement",
      "known_pose_colmap",
    ]);
    expect(SIGNED_RUNTIME_TRANSFORM_EVIDENCE_REF_TYPES).toEqual([
      "control_network",
      "landmark_set",
      "artifact",
    ]);
  });

  it("accepts a reviewed landmark-solve transform for a runtime package", () => {
    const parsed = RegisterRuntimeTransformArtifactInputSchema.parse({
      runtimePackageId: RUNTIME_PACKAGE_ID,
      venueSlug: "trades-hall",
      roomSlug: "reception-room",
      transformArtifact: validTransformArtifact,
      reviewNote: "Contract test only; not a live Reception Room signed transform.",
    });

    expect(parsed.transformArtifact.id).toBe(TRANSFORM_ARTIFACT_ID);
    expect(parsed.transformArtifact.alignmentMethod).toBe("landmark_solve");
  });

  it("rejects visual-only transforms from the signed registration endpoint", () => {
    const result = RegisterRuntimeTransformArtifactInputSchema.safeParse({
      runtimePackageId: RUNTIME_PACKAGE_ID,
      venueSlug: "trades-hall",
      roomSlug: "reception-room",
      transformArtifact: {
        ...validTransformArtifact,
        alignmentMethod: "visual_alignment",
        residualRmseM: null,
        landmarks: [],
        provenance: {
          state: "inferred",
          refs: [
            {
              refType: "artifact",
              ref: "docs/operations/reception-room-visual-review.md",
              role: "visual_review",
            },
          ],
        },
      },
    });

    expect(result.success).toBe(false);
  });

  it("rejects operator-note-only transform provenance", () => {
    const result = RegisterRuntimeTransformArtifactInputSchema.safeParse({
      runtimePackageId: RUNTIME_PACKAGE_ID,
      venueSlug: "trades-hall",
      roomSlug: "reception-room",
      transformArtifact: {
        ...validTransformArtifact,
        alignmentMethod: "manual_alignment",
        provenance: {
          state: "inferred",
          refs: [
            {
              refType: "operator_note",
              ref: "docs/operations/reception-room-operator-note.md",
              role: "operator_note",
            },
          ],
        },
      },
    });

    expect(result.success).toBe(false);
  });

  it("keeps persisted transform artifact ids coherent with the embedded artifact", () => {
    expect(RuntimeTransformArtifactSchema.parse({
      id: "row-1",
      runtimePackageId: RUNTIME_PACKAGE_ID,
      venueSlug: "trades-hall",
      roomSlug: "reception-room",
      transformArtifactId: TRANSFORM_ARTIFACT_ID,
      transformArtifact: validTransformArtifact,
      reviewNote: null,
      registeredBy: "user-1",
      createdAt: "2026-06-15T10:00:00.000Z",
      updatedAt: "2026-06-15T10:00:00.000Z",
    }).transformArtifactId).toBe(TRANSFORM_ARTIFACT_ID);

    expect(RuntimeTransformArtifactSchema.safeParse({
      id: "row-1",
      runtimePackageId: RUNTIME_PACKAGE_ID,
      venueSlug: "trades-hall",
      roomSlug: "reception-room",
      transformArtifactId: "different-transform",
      transformArtifact: validTransformArtifact,
      reviewNote: null,
      registeredBy: "user-1",
      createdAt: "2026-06-15T10:00:00.000Z",
      updatedAt: "2026-06-15T10:00:00.000Z",
    }).success).toBe(false);
  });

  it("parses machine-readable runtime transform registration reports", () => {
    const parsed = RuntimeTransformArtifactRegistrationReportSchema.parse(
      validRuntimeTransformReport(),
    );

    expect(parsed.schemaVersion).toBe("venviewer.runtime-transform-artifact-registration-report.v0");
    expect(parsed.payload.transformArtifactId).toBe(TRANSFORM_ARTIFACT_ID);
    expect(parsed.preflight.runtimePackageMatchesLatest).toBe(true);
    expect(parsed.guardrails.runtimeQaRecordChanged).toBe(false);
    expect(parsed.guardrails.captureControlSourceChanged).toBe(false);
    expect(parsed.guardrails.publicExposureChanged).toBe(false);
  });

  it("keeps dry-run runtime transform reports non-mutating", () => {
    const report = validRuntimeTransformReport({
      mode: "dry_run",
      registration: null,
    });

    expect(RuntimeTransformArtifactRegistrationReportSchema.parse(report).mode).toBe("dry_run");
    expect(RuntimeTransformArtifactRegistrationReportSchema.safeParse({
      ...report,
      registration: validRuntimeTransformReport().registration,
    }).success).toBe(false);
  });

  it("rejects inconsistent runtime transform registration reports", () => {
    const validReport = validRuntimeTransformReport();
    const registration = validReport.registration;

    if (registration === null) {
      throw new Error("Expected valid transform registration report helper to include registration.");
    }

    expect(RuntimeTransformArtifactRegistrationReportSchema.safeParse({
      ...validReport,
      preflight: {
        ...validReport.preflight,
        latestRuntimePackageId: "10000000-0000-4000-8000-000000000099",
        runtimePackageMatchesLatest: false,
      },
    }).success).toBe(false);

    expect(RuntimeTransformArtifactRegistrationReportSchema.safeParse({
      ...validReport,
      preflight: {
        ...validReport.preflight,
        payloadRuntimePackageId: "10000000-0000-4000-8000-000000000099",
        latestRuntimePackageId: "10000000-0000-4000-8000-000000000099",
      },
    }).success).toBe(false);

    expect(RuntimeTransformArtifactRegistrationReportSchema.safeParse({
      ...validReport,
      registration: {
        ...registration,
        transformArtifactId: "different-transform",
      },
    }).success).toBe(false);

    expect(RuntimeTransformArtifactRegistrationReportSchema.safeParse({
      ...validReport,
      guardrails: {
        ...validReport.guardrails,
        publicExposureChanged: true,
      },
    }).success).toBe(false);
  });

  it("parses machine-readable runtime transform report inspections", () => {
    const parsed = RuntimeTransformArtifactRegistrationReportInspectionSchema.parse(
      validRuntimeTransformInspection(),
    );

    expect(RUNTIME_TRANSFORM_ARTIFACT_REGISTRATION_REPORT_INSPECTION_STATUSES).toEqual([
      "ready_for_live_transform_registration",
      "not_ready_for_live_transform_registration",
      "registered_transform_report_verified",
      "invalid_report",
    ]);
    expect(parsed.liveTransformRegistrationReady).toBe(true);
    expect(parsed.mode).toBe("dry_run");
    expect(parsed.blockers).toEqual([]);
  });

  it("rejects inconsistent ready runtime transform report inspections", () => {
    expect(RuntimeTransformArtifactRegistrationReportInspectionSchema.safeParse(
      validRuntimeTransformInspection({
        mode: "registered",
      }),
    ).success).toBe(false);

    expect(RuntimeTransformArtifactRegistrationReportInspectionSchema.safeParse(
      validRuntimeTransformInspection({
        blockers: ["operator override was enabled"],
      }),
    ).success).toBe(false);

    expect(RuntimeTransformArtifactRegistrationReportInspectionSchema.safeParse(
      validRuntimeTransformInspection({
        reportLatestRuntimePackageId: "10000000-0000-4000-8000-000000000099",
      }),
    ).success).toBe(false);

    expect(RuntimeTransformArtifactRegistrationReportInspectionSchema.safeParse(
      validRuntimeTransformInspection({
        reportRuntimePackageDriftAllowed: true,
      }),
    ).success).toBe(false);
  });

  it("keeps registered and invalid transform report inspections out of readiness", () => {
    expect(RuntimeTransformArtifactRegistrationReportInspectionSchema.parse(
      validRuntimeTransformInspection({
        status: "registered_transform_report_verified",
        liveTransformRegistrationReady: false,
        mode: "registered",
        blockers: [
          "Report already records a live signed-transform registration; use it as audit evidence, not authorization for another POST.",
        ],
      }),
    ).liveTransformRegistrationReady).toBe(false);

    expect(RuntimeTransformArtifactRegistrationReportInspectionSchema.parse(
      validRuntimeTransformInspection({
        status: "invalid_report",
        liveTransformRegistrationReady: false,
        inspectedReportGeneratedAt: null,
        mode: null,
        venueSlug: null,
        roomSlug: null,
        transformArtifactId: null,
        reportRuntimePackageId: null,
        reportLatestRuntimePackageId: null,
        reportRuntimePackageMatchesLatest: null,
        reportRuntimePackageDriftAllowed: null,
        blockers: ["generatedAt: Required"],
        messages: ["Report failed RuntimeTransformArtifactRegistrationReportSchema validation."],
      }),
    ).status).toBe("invalid_report");

    expect(RuntimeTransformArtifactRegistrationReportInspectionSchema.safeParse(
      validRuntimeTransformInspection({
        status: "invalid_report",
        liveTransformRegistrationReady: true,
        blockers: ["generatedAt: Required"],
      }),
    ).success).toBe(false);
  });
});

describe("response schemas", () => {
  const assetVersion = {
    id: ASSET_VERSION_ID,
    venueSlug: "trades-hall",
    roomSlug: "robert-adam-room",
    captureSessionId: null,
    assetKind: "splat",
    sourceType: "xgrids",
    r2Key: R2_KEY,
    fileName: "scene.ply",
    fileExt: ".ply",
    externalUrl: null,
    mimeType: "application/octet-stream",
    sha256: SHA,
    sizeBytes: 2048,
    evidenceStatus: "machine_checked",
    runtimeStatus: "usable",
    notes: null,
    createdAt: "2026-06-06T10:00:00.000Z",
    updatedAt: "2026-06-06T10:00:00.000Z",
  };

  it("parses AssetVersion, RoomManifest, and RuntimePackage API shapes", () => {
    expect(AssetVersionSchema.parse(assetVersion).runtimeStatus).toBe("usable");

    expect(RoomManifestSchema.parse({
      id: "rm1",
      venueSlug: "trades-hall",
      roomSlug: "saloon",
      displayName: "Saloon",
      matterportMasterReference: null,
      alignmentStatus: "approximate",
      primaryCaptureSource: null,
      notes: null,
      createdAt: "2026-06-06T10:00:00.000Z",
      updatedAt: "2026-06-06T10:00:00.000Z",
    }).roomSlug).toBe("saloon");

    const pkg = RuntimePackageSchema.parse({
      id: "rp1",
      venueSlug: "trades-hall",
      roomSlug: "robert-adam-room",
      primaryVisualAssetVersionId: ASSET_VERSION_ID,
      semanticMeshAssetVersionId: null,
      collisionAssetVersionId: null,
      pointCloudAssetVersionId: null,
      manifestJson,
      evidenceStatus: "machine_checked",
      runtimeStatus: "internal_ready",
      createdAt: "2026-06-06T10:00:00.000Z",
      updatedAt: "2026-06-06T10:00:00.000Z",
      primaryVisualAssetVersion: assetVersion,
      primaryVisualAssetUrl: "https://assets.example/scene.ply",
      visualAssetUrls: ["https://assets.example/scene.ply"],
    });
    expect(pkg.primaryVisualAssetVersion?.sourceType).toBe("xgrids");
  });

  it("parses room asset status transform-review posture", () => {
    expect(REVIEWED_RUNTIME_TRANSFORM_STATUSES).toEqual(["missing", "registered"]);
    expect(REVIEWED_RUNTIME_QA_STATUSES).toEqual([
      "missing",
      "blocked_internal_only",
      "approved_internal_preview",
      "approved_public",
    ]);
    expect(REVIEWED_CAPTURE_CONTROL_STATUSES).toEqual([
      "missing",
      "source_registered",
      "linked_to_transform",
    ]);
    expect(CAPTURE_CONTROL_FRESHNESS_STATUSES).toEqual([
      "missing",
      "not_checked",
      "current_for_runtime_package",
      "stale_for_runtime_package",
    ]);
    expect(ROOM_RUNTIME_CONTROL_EVIDENCE_CHAIN_STATUSES).toEqual([
      "not_recorded",
      "blocked_insufficient_landmark_candidates",
      "blocked_missing_coordinate_pair_intake",
      "blocked_invalid_coordinate_pair_intake",
      "blocked_incompatible_coordinate_pair_intake",
      "blocked_packet_build",
      "blocked_capture_control_payload",
      "capture_control_payload_ready",
      "chain_inconsistent",
    ]);

    const status = RoomAssetStatusSchema.parse({
      venueSlug: "trades-hall",
      roomSlug: "reception-room",
      displayName: "Reception Room",
      roomGroup: "support-room",
      defaultStatus: "needs_registration",
      captureStatus: "processed_needs_registration",
      registryRuntimeStatus: "not_registered",
      publicShowcaseEnabled: false,
      internalVisualEnabled: true,
      primaryCaptureSource: "xgrids",
      currentState: "processed_output_found",
      splatStatus: "registered splat asset",
      splatExists: true,
      runtimePackageStatus: "runtime package internal ready",
      runtimePackageExists: true,
      reviewedTransformStatus: "missing",
      reviewedTransformArtifactCount: 0,
      latestTransformArtifactId: null,
      reviewedTransformSafeCopy: "no reviewed runtime transform registered",
      reviewedQaStatus: "missing",
      latestQaRecordId: null,
      qaSignedTransformArtifactId: null,
      qaSignedTransformLinked: false,
      reviewedQaSafeCopy: "no runtime QA record registered",
      captureControlStatus: "missing",
      captureControlSourceCount: 0,
      latestCaptureControlSourceRecordId: null,
      latestCaptureControlSourceId: null,
      latestCaptureControlSourceClass: null,
      latestCaptureControlPoseAuthorityLevel: null,
      latestCaptureControlAlignmentMethods: [],
      latestCaptureControlStalenessTriggers: [],
      latestCaptureControlActiveStalenessTriggers: [],
      captureControlFreshnessStatus: "missing",
      latestCaptureControlQaStatus: null,
      captureControlLinkedTransformArtifactId: null,
      captureControlTransformLinked: false,
      captureControlAuthoritySafeCopy: "no capture-control authority recorded",
      captureControlStalenessSafeCopy: "no capture-control staleness policy recorded",
      captureControlSafeCopy: "no capture-control source registered",
      runtimeControlEvidenceChainStatus: "blocked_missing_coordinate_pair_intake",
      runtimeControlEvidenceChainRef: "docs/operations/reception-room-runtime-control-evidence-chain-status-2026-06-16.json",
      runtimeControlRequiredCoordinatePairCount: 4,
      runtimeControlReviewedCoordinatePairCount: 0,
      runtimeControlEvidenceChainSafeCopy: "runtime-control chain blocked because reviewed coordinate-pair intake is missing",
      runtimeControlEvidenceChainNextAction: "Collect the four reviewed ARF to CVF landmark measurements",
      evidenceStatus: "machine_checked",
      runtimeStatus: "internal_ready",
      nextAction: "Open the internal runtime view",
      safeCopy: "Runtime asset loaded, machine checked; human review required.",
    });

    expect(status.reviewedTransformStatus).toBe("missing");
    expect(status.reviewedTransformArtifactCount).toBe(0);
    expect(status.reviewedQaStatus).toBe("missing");
    expect(status.captureControlStatus).toBe("missing");
    expect(status.captureControlFreshnessStatus).toBe("missing");
    expect(status.latestCaptureControlActiveStalenessTriggers).toEqual([]);
    expect(status.captureControlAuthoritySafeCopy).toBe("no capture-control authority recorded");
    expect(status.captureControlStalenessSafeCopy).toBe("no capture-control staleness policy recorded");
    expect(status.runtimeControlEvidenceChainStatus).toBe("blocked_missing_coordinate_pair_intake");
    expect(status.runtimeControlReviewedCoordinatePairCount).toBe(0);
  });

  it("parses the latest runtime package room query", () => {
    expect(LatestRuntimePackageQuerySchema.parse({
      venue: "trades-hall",
      room: "grand-hall",
    }).room).toBe("grand-hall");
  });

  it("keeps public room runtime visual payloads client-safe and internally opaque", () => {
    const parsed = PublicRoomRuntimeVisualSchema.parse({
      venueSlug: "trades-hall",
      roomSlug: "grand-hall",
      runtimeVisualAvailable: true,
      visualUrl: "https://assets.example/rooms/grand-hall/scene.ply",
      visualLabel: "Runtime visual preview",
      safeCopy: "Runtime visual available for planning preview. Final details confirmed by venue team.",
      humanReviewRequired: true,
    });

    expect(parsed.humanReviewRequired).toBe(true);
    expect(PublicRoomRuntimeVisualSchema.safeParse({
      ...parsed,
      id: "runtime-package-1",
      r2Key: "venues/trades-hall/rooms/grand-hall/runtime/scene.ply",
    }).success).toBe(false);
    expect(PublicRoomRuntimeVisualSchema.safeParse({
      ...parsed,
      runtimeVisualAvailable: false,
    }).success).toBe(false);
  });

  it("pins semantic/collision ids in the manifest when present", () => {
    const result = RegisterRuntimePackageInputSchema.safeParse({
      venueSlug: "trades-hall",
      roomSlug: "grand-hall",
      primaryVisualAssetVersionId: ASSET_VERSION_ID,
      semanticMeshAssetVersionId: SEMANTIC_ASSET_VERSION_ID,
      collisionAssetVersionId: COLLISION_ASSET_VERSION_ID,
      manifestJson: {
        ...manifestJson,
        roomSlug: "grand-hall",
        assets: {
          primaryVisualAssetVersionId: ASSET_VERSION_ID,
          semanticMeshAssetVersionId: SEMANTIC_ASSET_VERSION_ID,
          collisionAssetVersionId: COLLISION_ASSET_VERSION_ID,
          pointCloudAssetVersionId: null,
        },
      },
      runtimeStatus: "draft",
    });
    expect(result.success).toBe(true);
  });
});
