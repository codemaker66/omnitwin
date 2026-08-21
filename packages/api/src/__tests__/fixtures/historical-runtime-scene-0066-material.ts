import {
  createHash,
  generateKeyPairSync,
  sign,
} from "node:crypto";
import {
  CanonicalJsonValueSchema,
  RECONSTRUCTION_DSSE_PAYLOAD_TYPE,
  RECONSTRUCTION_RELEASE_SCHEMA_VERSION,
  RECONSTRUCTION_SCENE_AUTHORITY_MAP_SCHEMA_VERSION,
  ReconstructionReleaseManifestSchema,
  ReconstructionReleaseSigningStatementSchema,
  ReconstructionSceneAuthorityMapV0Schema,
  TwinManifestSchema,
  computeReconstructionReleaseDigest,
  computeReconstructionReviewEvidenceArtifactDigest,
  historicalRuntimeSceneMemberAuthorityReference,
  stableCanonicalJson,
  type ReconstructionReleaseArtifactRef,
  type ReconstructionReleaseFile,
} from "@omnitwin/types";
import {
  canonicalHistoricalRuntimeTwinReleaseEnvelopeBytes,
  dssePreAuthenticationEncoding,
  verifyHistoricalRuntimeSceneMapAuthenticatedEvidenceBytes,
  type HistoricalRuntimeSceneMapRuntimeMemberInput,
} from "@omnitwin/reconstruction-foundry";

const RELEASE_ID = "91000000-0000-0000-0000-000000000600";
const REVIEW_ID = "91000000-0000-0000-0000-000000000610";
const REVIEWER_ID = "91000000-0000-0000-0000-000000000027";
const KEY_ID = "fixture-twin-release-key";

function hashUtf8(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function hashBytes(value: Uint8Array): string {
  return createHash("sha256").update(value).digest("hex");
}

function prettyJsonBytes(value: unknown): Buffer {
  return Buffer.from(`${JSON.stringify(value, null, 2)}\n`, "utf8");
}

export interface HistoricalRuntimeScene0066MemberReceipt {
  readonly digest: string;
  readonly expiresAt: string;
}

export interface HistoricalRuntimeScene0066Material {
  readonly psqlVariables: Readonly<Record<string, string>>;
}

export function createHistoricalRuntimeScene0066Material(
  memberReceipt: HistoricalRuntimeScene0066MemberReceipt,
): HistoricalRuntimeScene0066Material {
  const transformRef: ReconstructionReleaseArtifactRef = {
    artifactId: "receipt-room-transform-v1",
    artifactDigest: hashUtf8("receipt-room-transform-artifact-v1"),
  };
  const runtimeMember: HistoricalRuntimeSceneMapRuntimeMemberInput = {
    memberIndex: 0,
    assetVersionId: "91000000-0000-0000-0000-000000000202",
    derivationOutputReceiptId: "91000000-0000-0000-0000-000000000201",
    derivationMemberReceiptDigest: memberReceipt.digest,
    derivationMemberStorageKeySha256: "4".repeat(64),
    derivationMemberReceiptExpiresAt: memberReceipt.expiresAt,
    fileName: "derived.spz",
    fileExt: ".spz",
    mimeType: "application/octet-stream",
    sha256: "5".repeat(64),
    sizeBytes: 512,
  };
  const runtimeLayerRef = historicalRuntimeSceneMemberAuthorityReference({
    memberIndex: runtimeMember.memberIndex,
    assetVersionId: runtimeMember.assetVersionId,
    fileName: runtimeMember.fileName,
    fileExt: runtimeMember.fileExt,
    mimeType: runtimeMember.mimeType,
    sha256: runtimeMember.sha256,
    sizeBytes: runtimeMember.sizeBytes,
    storageKeySha256: runtimeMember.derivationMemberStorageKeySha256,
  });
  const sourceTwinManifest = TwinManifestSchema.parse({
    schema: "twin/0",
    venueSlug: "trades-hall",
    name: "Trades Hall receipt-room exact source Twin",
    capture: { kind: "matterport-e57", scanCount: 1 },
    tier: "planning-grade-5cm",
    upAxis: "z",
    units: "m",
    imagery: "equirect",
    faces: ["front", "back", "left", "right", "up", "down"],
    lods: [512, 4096, 8192],
    generatedAt: "2026-08-20T18:40:00.000Z",
    nodes: [{
      id: "scan_000",
      index: 0,
      pose: { q: [1, 0, 0, 0], t: [0, 0, 1.5] },
      floor: 0,
      roomSlug: "receipt-room",
    }],
    edges: [],
    entryNodeId: "scan_000",
  });
  const sourceTwinManifestBytes = prettyJsonBytes(sourceTwinManifest);
  const sourceManifestSha256 = hashBytes(sourceTwinManifestBytes);
  const sceneMap = ReconstructionSceneAuthorityMapV0Schema.parse({
    schemaVersion: RECONSTRUCTION_SCENE_AUTHORITY_MAP_SCHEMA_VERSION,
    id: "receipt-room-scene-map-v1",
    venueSlug: "trades-hall",
    generatedAt: "2026-08-20T18:45:00.000Z",
    regions: [{
      id: "receipt-room-whole",
      label: "Receipt Room whole room",
      scope: { kind: "twin_nodes", nodeIds: ["scan_000"] },
      authorities: {
        geometryAuthority: { kind: "release_file", ref: "mesh/room.glb" },
        appearanceAuthority: { kind: "runtime_layer", ref: runtimeLayerRef },
        lightingAuthority: { kind: "none", ref: null },
        physicsAuthority: { kind: "release_file", ref: "mesh/room.glb" },
        semanticAuthority: { kind: "release_file", ref: "manifest.json" },
        interactionAuthority: { kind: "release_file", ref: "mesh/room.glb" },
        exportAuthority: { kind: "release_file", ref: "mesh/room.glb" },
      },
      truthStatus: "measured",
      confidenceTier: "layout_grade",
      provenanceRefs: [{
        refType: "artifact",
        ref: "evidence/trades-hall/receipt-room",
        role: "release-source",
      }],
      reconstructionStrategy: "matterpak_original",
      transformArtifactRef: transformRef,
    }],
  });
  const sceneMapBytes = Buffer.from(
    stableCanonicalJson(CanonicalJsonValueSchema.parse(sceneMap)),
    "utf8",
  );
  const files: ReconstructionReleaseFile[] = [
    {
      path: "manifest.json",
      sha256: sourceManifestSha256,
      sizeBytes: sourceTwinManifestBytes.byteLength,
      mimeType: "application/json",
      role: "manifest",
    },
    {
      path: "mesh/room.glb",
      sha256: hashUtf8("receipt-room-geometry"),
      sizeBytes: 8192,
      mimeType: "model/gltf-binary",
      role: "geometry",
    },
  ];
  const releaseManifest = ReconstructionReleaseManifestSchema.parse({
    schemaVersion: RECONSTRUCTION_RELEASE_SCHEMA_VERSION,
    releaseKind: "venue_twin_v1",
    venueSlug: "trades-hall",
    releaseDigest: computeReconstructionReleaseDigest(files),
    sourceManifestSha256,
    files,
    fileCount: files.length,
    totalBytes: files.reduce((total, file) => total + file.sizeBytes, 0),
    generatedAt: "2026-08-20T18:50:00.000Z",
  });
  const releaseManifestBytes = prettyJsonBytes(releaseManifest);
  const reviewDigest = hashUtf8("receipt-room-release-review-v1");
  const qaReportDigest = hashUtf8("receipt-room-release-qa-v1");
  const statement = ReconstructionReleaseSigningStatementSchema.parse({
    _type: "https://in-toto.io/Statement/v1",
    subject: [{
      name: `reconstruction-release/trades-hall/${releaseManifest.releaseDigest}`,
      digest: { sha256: releaseManifest.releaseDigest },
    }],
    predicateType: "https://venviewer.com/attestations/reconstruction-release/v1",
    predicate: {
      schemaVersion: "venviewer.reconstruction-attestation-predicate.v1",
      venueSlug: "trades-hall",
      releaseKind: "venue_twin_v1",
      releaseId: RELEASE_ID,
      releaseDigest: releaseManifest.releaseDigest,
      sourceManifestSha256,
      releaseManifestSha256: hashBytes(releaseManifestBytes),
      qaReportDigest,
      reviewId: REVIEW_ID,
      reviewDigest,
      reviewedAt: "2026-08-20T19:00:00.000Z",
      reviewerUserId: REVIEWER_ID,
      decision: "approved",
      targetExposure: "public",
      visualEvidence: [{
        label: "Receipt Room exact overview",
        objectKey: "evidence/trades-hall/receipt-room.png",
        sha256: hashUtf8("receipt-room-visual-evidence"),
      }],
      transformArtifactRef: transformRef,
      sceneAuthorityMapRef: {
        artifactId: sceneMap.id,
        artifactDigest: computeReconstructionReviewEvidenceArtifactDigest(sceneMap),
      },
    },
  });
  const { publicKey, privateKey } = generateKeyPairSync("ed25519");
  const publicKeyDer = publicKey.export({ format: "der", type: "spki" });
  const publicKeyFingerprint = hashBytes(publicKeyDer);
  const payloadBytes = Buffer.from(JSON.stringify(statement), "utf8");
  const signature = sign(
    null,
    dssePreAuthenticationEncoding(RECONSTRUCTION_DSSE_PAYLOAD_TYPE, payloadBytes),
    privateKey,
  );
  const envelopeBytes = canonicalHistoricalRuntimeTwinReleaseEnvelopeBytes({
    payloadType: RECONSTRUCTION_DSSE_PAYLOAD_TYPE,
    payload: payloadBytes.toString("base64"),
    signatures: [{ keyid: KEY_ID, sig: signature.toString("base64") }],
  });
  const verified = verifyHistoricalRuntimeSceneMapAuthenticatedEvidenceBytes({
    sceneMapBytes,
    releaseManifestBytes,
    sourceTwinManifestBytes,
    spaceSlug: "receipt-room",
    twinReleaseEnvelopeBytes: envelopeBytes,
    trustedTwinReleasePublicKeys: new Map([[KEY_ID, publicKey]]),
    expectedTwinRelease: {
      expectedKeyId: KEY_ID,
      expectedPublicKeyFingerprint: publicKeyFingerprint,
      statement,
    },
    runtimeMembers: [runtimeMember],
  });
  if (verified.orderedMembers.length !== 1) {
    throw new Error("0066 fixture verifier did not return one runtime member");
  }

  return {
    psqlVariables: Object.freeze({
      authority_reference: runtimeLayerRef,
      envelope_b64: Buffer.from(envelopeBytes).toString("base64"),
      envelope_sha256: hashBytes(envelopeBytes),
      envelope_size: String(envelopeBytes.byteLength),
      key_der_hex: Buffer.from(publicKeyDer).toString("hex"),
      key_fingerprint: publicKeyFingerprint,
      key_id: KEY_ID,
      parsed_map_digest: verified.parsedMapDigest,
      payload_sha256: verified.authenticatedTwinRelease.payloadSha256,
      payload_size: verified.authenticatedTwinRelease.payloadByteLength,
      predicate_digest: verified.authenticatedTwinRelease.predicateDigest,
      projection_size: String(verified.coverage.normalizedProjectionByteLength),
      qa_digest: qaReportDigest,
      release_b64: releaseManifestBytes.toString("base64"),
      release_digest: releaseManifest.releaseDigest,
      release_sha256: hashBytes(releaseManifestBytes),
      release_size: String(releaseManifestBytes.byteLength),
      review_digest: reviewDigest,
      scene_artifact_digest:
        computeReconstructionReviewEvidenceArtifactDigest(sceneMap),
      scene_b64: sceneMapBytes.toString("base64"),
      scene_sha256: hashBytes(sceneMapBytes),
      scene_size: String(sceneMapBytes.byteLength),
      source_b64: sourceTwinManifestBytes.toString("base64"),
      source_sha256: sourceManifestSha256,
      source_size: String(sourceTwinManifestBytes.byteLength),
      transform_digest: transformRef.artifactDigest,
    }),
  };
}
