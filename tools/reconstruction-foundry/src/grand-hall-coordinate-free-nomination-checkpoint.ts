import {
  CanonicalJsonValueSchema,
  GRAND_HALL_ARF_CVF_COORDINATE_PAIR_INTAKE_V1,
  GrandHallCoordinatePairIntakeV1MaterialSchema,
  GrandHallCoordinatePairIntakeV1Schema,
  GrandHallRegistrationSeedV1Schema,
  computeGrandHallCoordinatePairIntakeV1Sha256,
  computeGrandHallCoordinatePairInventorySha256,
  computeGrandHallCoordinatePairNominationInventorySha256,
  stableCanonicalJson,
  type GrandHallCoordinatePairIntakeV1,
  type GrandHallRegistrationSeedV1,
} from "@omnitwin/types";

export const GRAND_HALL_COORDINATE_FREE_NOMINATION_EXACT_SEED_ARTIFACT_SHA256 =
  "sha256:786fe2d4f2e24209d440aefc6d2496337e13b37d9bcba77eafe39a2cf0856c78";
export const GRAND_HALL_COORDINATE_FREE_NOMINATION_CHECKPOINT_PACKET_ID =
  "grand-hall-authority-none-coordinate-free-nomination-checkpoint-2026-08-28-v1";
export const GRAND_HALL_COORDINATE_FREE_NOMINATION_CHECKPOINT_ARTIFACT_SHA256 =
  "sha256:f0794f63a0545d852829355d59c779168fdc92770324f2a2a3972a0ac7e74b3b";

/**
 * Exact source-derived identities that are not repeated inside the registration
 * seed. They are fixed here so the production builder cannot accept caller-
 * selected geometry, E57, room inventory, or authority-bearing overrides.
 */
const EXACT_ROOM9_VERIFIED_FACE_ORDINAL_INVENTORY_SHA256 =
  "sha256:9f8ddf17db9cbbb2ff3e8c03edf21cd074184a53715bcbf77a04e6aacb12b889";
const EXACT_ROOM9_SHARED_VERTEX_INVENTORY_SHA256 =
  "sha256:f60a6bf3cd24faee9ce897cf1a13057816bbb8e336e5f4dd8b9d03b293ba9bc8";
const EXACT_ROOM9_INTERFACE_FACE_COUNT = 292;
const EXACT_ROOM9_INTERFACE_FACE_ORDINAL_INVENTORY_SHA256 =
  "sha256:44dcda959638d1635a3e305ba5e758b6050bebd370b210cf2e15b3f4037cb3eb";
const EXACT_MATTERPORT_E57 = {
  sha256:
    "sha256:975039d11fc04ca681f038e499f358124bbcab178ad5ce6324fa912212729cdd",
  byteLength: 20_518_437_888,
  rootGuid: "424ff41f6e5d41969c635fcd61be9b3f",
  scanCount: 149,
  data3DGuidSha256:
    "sha256:f723f0e172946cfd57f9bf5b0bc678005b364b49cf7b3750949d15b687fc8bbb",
  poseSha256:
    "sha256:fe3b9000eda4737af038e01e811e57bffa7fae07290a938c1ef75875c9df82e3",
  coordinateConvention:
    "E57 data3D pose; quaternion [w,x,y,z], translation [x,y,z] metres, Z-up",
} as const;

export interface BuildGrandHallCoordinateFreeNominationCheckpointInput {
  readonly registrationSeed: unknown;
}

export interface VerifyGrandHallCoordinateFreeNominationCheckpointInput {
  readonly registrationSeed: unknown;
  readonly checkpoint: unknown;
}

export interface VerifiedGrandHallCoordinateFreeNominationCheckpoint {
  readonly authority: "none";
  readonly registrationSeedArtifactSha256: typeof GRAND_HALL_COORDINATE_FREE_NOMINATION_EXACT_SEED_ARTIFACT_SHA256;
  readonly checkpointArtifactSha256: typeof GRAND_HALL_COORDINATE_FREE_NOMINATION_CHECKPOINT_ARTIFACT_SHA256;
  readonly state: "nomination_only";
  readonly nominationCount: 0;
  readonly coordinatePairCount: 0;
  readonly coordinatesGenerated: false;
  readonly matrixUsedAsMeasurement: false;
  readonly matrixUsedAsSolverInput: false;
  readonly transformArtifactCreated: false;
  readonly operationalGeometryCreated: false;
  readonly runtimeAuthorityGranted: false;
  readonly publicExposureChanged: false;
}

export class GrandHallCoordinateFreeNominationCheckpointError extends Error {
  readonly code:
    | "INVALID_REGISTRATION_SEED"
    | "INVALID_CHECKPOINT"
    | "REGISTRATION_SEED_BINDING_MISMATCH";

  constructor(
    code: GrandHallCoordinateFreeNominationCheckpointError["code"],
    message: string,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = "GrandHallCoordinateFreeNominationCheckpointError";
    this.code = code;
  }
}

function fail(
  code: GrandHallCoordinateFreeNominationCheckpointError["code"],
  message: string,
  cause?: unknown,
): GrandHallCoordinateFreeNominationCheckpointError {
  return new GrandHallCoordinateFreeNominationCheckpointError(
    code,
    message,
    cause === undefined ? undefined : { cause },
  );
}

function parseRegistrationSeed(value: unknown): GrandHallRegistrationSeedV1 {
  try {
    const seed = GrandHallRegistrationSeedV1Schema.parse(value);
    if (
      seed.artifactSha256 !==
      GRAND_HALL_COORDINATE_FREE_NOMINATION_EXACT_SEED_ARTIFACT_SHA256
    ) {
      throw new Error(
        "registration seed is valid but is not the reviewed exact persisted seed",
      );
    }
    return seed;
  } catch (error) {
    throw fail(
      "INVALID_REGISTRATION_SEED",
      "registration seed failed strict schema and self-digest verification",
      error,
    );
  }
}

function buildSourceBindings(seed: GrandHallRegistrationSeedV1) {
  return {
    frame: "ARF" as const,
    coordinateConvention: seed.source.coordinateConvention,
    metricAuthority: false as const,
    ...seed.source.upstreamLineage,
    exactAcceptedOutputInventorySha256: null,
    bigObj: {
      sha256: seed.source.exactBigObj.sha256,
      byteLength: seed.source.exactBigObj.byteLength,
      vertexRecordCount: seed.source.exactBigObj.vertexRecordCount,
      faceRecordCount: seed.source.exactBigObj.faceRecordCount,
      bounds: seed.source.exactBigObj.boundsMetres,
    },
  };
}

function buildTargetBindings(seed: GrandHallRegistrationSeedV1) {
  return {
    frame: "CVF" as const,
    coordinateConvention: seed.target.coordinateConvention,
    crosswalkAuthority: "diagnostic_only" as const,
    metricControlAuthority: false as const,
    matterPakE57ReceiptSha256:
      seed.target.upstreamLineage.matterPakE57ReceiptSha256,
    boundaryEvidenceSha256:
      seed.target.upstreamLineage.room9BoundaryEvidenceSha256,
    boundaryManifestSha256:
      seed.target.upstreamLineage.room9BoundaryManifestSha256,
    interfaceAtlasSha256: seed.target.upstreamLineage.interfaceAtlasSha256,
    scopeReviewPackSha256:
      seed.target.upstreamLineage.scopeReviewPackSha256,
    matterPakObj: {
      sha256: seed.target.exactMatterPakObj.sha256,
      byteLength: seed.target.exactMatterPakObj.byteLength,
      vertexRecordCount: seed.target.exactMatterPakObj.vertexRecordCount,
      faceRecordCount: seed.target.exactMatterPakObj.faceRecordCount,
      bounds: seed.target.exactMatterPakObj.boundsMetres,
    },
    room9: {
      groupIndex: seed.target.exactRoom9.groupIndex,
      subIndex: seed.target.exactRoom9.subIndex,
      exactObjGroupSuffix: seed.target.exactRoom9.exactObjGroupSuffix,
      faceCount: seed.target.exactRoom9.faceCount,
      evidenceFaceOrdinalsSha256:
        seed.target.exactRoom9.faceOrdinalInventorySha256,
      verifiedFaceOrdinalInventorySha256:
        EXACT_ROOM9_VERIFIED_FACE_ORDINAL_INVENTORY_SHA256,
      sharedVertexCount:
        seed.target.exactRoom9.verticesSharedWithOtherRoomGroups,
      sharedVertexInventorySha256:
        EXACT_ROOM9_SHARED_VERTEX_INVENTORY_SHA256,
      interfaceFaceCount: EXACT_ROOM9_INTERFACE_FACE_COUNT,
      interfaceFaceOrdinalInventorySha256:
        EXACT_ROOM9_INTERFACE_FACE_ORDINAL_INVENTORY_SHA256,
    },
    e57: EXACT_MATTERPORT_E57,
    e57PointSupport: null,
  };
}

function buildNominationSeed(seed: GrandHallRegistrationSeedV1) {
  return {
    authority: "none" as const,
    seedArtifactSha256: seed.artifactSha256,
    implementationSha256: seed.replayBindings.implementationSha256,
    configurationSha256:
      seed.replayBindings.algorithmCanonicalJsonSha256,
    sourceSelectionInventorySha256:
      seed.source.selection
        .selectedOriginalVerticesPackedLittleEndianFloat64RawSha256,
    targetSelectionInventorySha256:
      seed.target.selection
        .selectedOrderedVerticesPackedLittleEndianFloat64RawSha256,
    sourceSelectionCount: seed.source.selection.selectedVertexInventoryCount,
    targetSelectionCount: seed.target.selection.selectedVertexInventoryCount,
    method: seed.schedule.method,
    permittedUse: "review_overlay_candidate_nomination_only" as const,
    matrixStoredOnlyInSeedArtifact: true as const,
    matrixUsedAsMeasurement: false as const,
    matrixUsedAsSolverInput: false as const,
  };
}

function emptyGuardrails() {
  return {
    sourceBytesMutated: false as const,
    targetBytesMutated: false as const,
    coordinatesGenerated: false as const,
    candidateLandmarksGenerated: false as const,
    icpPromoted: false as const,
    icpMatrixUsedAsMeasurement: false as const,
    icpMatrixUsedAsSolverInput: false as const,
    solverOutputCreated: false as const,
    transformArtifactCreated: false as const,
    e57PointAuthorityClaimed: false as const,
    operationalGeometryCreated: false as const,
    runtimeAuthorityGranted: false as const,
    publicExposureChanged: false as const,
  };
}

function buildCheckpointFromParsedSeed(
  seed: GrandHallRegistrationSeedV1,
): GrandHallCoordinatePairIntakeV1 {
  const nominations = [] as const;
  const coordinatePairs = [] as const;
  const material = GrandHallCoordinatePairIntakeV1MaterialSchema.parse({
    schemaVersion: GRAND_HALL_ARF_CVF_COORDINATE_PAIR_INTAKE_V1,
    packetId: GRAND_HALL_COORDINATE_FREE_NOMINATION_CHECKPOINT_PACKET_ID,
    revision: 1,
    predecessorArtifactSha256: null,
    venueSlug: seed.venueSlug,
    roomSlug: seed.roomSlug,
    authority: "none",
    productionTrust: null,
    sourceBindings: buildSourceBindings(seed),
    targetBindings: buildTargetBindings(seed),
    nominationSeed: buildNominationSeed(seed),
    state: "nomination_only",
    nominations,
    nominationInventorySha256:
      computeGrandHallCoordinatePairNominationInventorySha256(nominations),
    coordinatePairs,
    coordinatePairInventorySha256:
      computeGrandHallCoordinatePairInventorySha256(coordinatePairs),
    split: null,
    humanReview: null,
    rejection: null,
    guardrails: emptyGuardrails(),
  });
  const checkpoint = GrandHallCoordinatePairIntakeV1Schema.parse({
    ...material,
    artifactSha256: computeGrandHallCoordinatePairIntakeV1Sha256(material),
  });
  if (
    checkpoint.artifactSha256 !==
    GRAND_HALL_COORDINATE_FREE_NOMINATION_CHECKPOINT_ARTIFACT_SHA256
  ) {
    throw new Error(
      "empty checkpoint does not reproduce the reviewed exact artifact digest",
    );
  }
  return checkpoint;
}

/**
 * Creates only the empty revision-1 checkpoint. There is deliberately no API
 * surface for nominations, coordinates, predecessor state, authority, or any
 * runtime/deployment claim.
 */
export function buildGrandHallCoordinateFreeNominationCheckpoint(
  input: BuildGrandHallCoordinateFreeNominationCheckpointInput,
): GrandHallCoordinatePairIntakeV1 {
  const seed = parseRegistrationSeed(input.registrationSeed);
  try {
    return buildCheckpointFromParsedSeed(seed);
  } catch (error) {
    throw fail(
      "INVALID_CHECKPOINT",
      "empty coordinate-free checkpoint input failed the strict packet contract",
      error,
    );
  }
}

function canonicalEqual(left: unknown, right: unknown): boolean {
  return stableCanonicalJson(CanonicalJsonValueSchema.parse(left)) ===
    stableCanonicalJson(CanonicalJsonValueSchema.parse(right));
}

/**
 * Reconstructs the only permitted checkpoint from the exact seed and rejects
 * any otherwise-schema-valid drift, including a non-empty nomination list.
 */
export function verifyGrandHallCoordinateFreeNominationCheckpoint(
  input: VerifyGrandHallCoordinateFreeNominationCheckpointInput,
): VerifiedGrandHallCoordinateFreeNominationCheckpoint {
  const seed = parseRegistrationSeed(input.registrationSeed);
  let checkpoint: GrandHallCoordinatePairIntakeV1;
  try {
    checkpoint = GrandHallCoordinatePairIntakeV1Schema.parse(input.checkpoint);
  } catch (error) {
    throw fail(
      "INVALID_CHECKPOINT",
      "coordinate-free checkpoint failed strict schema and self-digest verification",
      error,
    );
  }
  const expected = buildCheckpointFromParsedSeed(seed);
  if (!canonicalEqual(checkpoint, expected)) {
    throw fail(
      "REGISTRATION_SEED_BINDING_MISMATCH",
      "checkpoint is not the exact empty revision-1 projection of the supplied registration seed",
    );
  }
  return Object.freeze({
    authority: "none",
    registrationSeedArtifactSha256:
      GRAND_HALL_COORDINATE_FREE_NOMINATION_EXACT_SEED_ARTIFACT_SHA256,
    checkpointArtifactSha256:
      GRAND_HALL_COORDINATE_FREE_NOMINATION_CHECKPOINT_ARTIFACT_SHA256,
    state: "nomination_only",
    nominationCount: 0,
    coordinatePairCount: 0,
    coordinatesGenerated: false,
    matrixUsedAsMeasurement: false,
    matrixUsedAsSolverInput: false,
    transformArtifactCreated: false,
    operationalGeometryCreated: false,
    runtimeAuthorityGranted: false,
    publicExposureChanged: false,
  });
}
