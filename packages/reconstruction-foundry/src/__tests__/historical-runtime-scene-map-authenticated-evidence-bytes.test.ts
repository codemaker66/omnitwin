import {
  createHash,
  generateKeyPairSync,
  sign,
  type KeyObject,
} from "node:crypto";
import {
  CanonicalJsonValueSchema,
  RECONSTRUCTION_DSSE_PAYLOAD_TYPE,
  RECONSTRUCTION_RELEASE_SCHEMA_VERSION,
  RECONSTRUCTION_SCENE_AUTHORITY_MAP_SCHEMA_VERSION,
  ReconstructionDsseEnvelopeSchema,
  ReconstructionReleaseManifestSchema,
  ReconstructionReleaseSigningStatementSchema,
  ReconstructionSceneAuthorityMapV0Schema,
  TwinManifestSchema,
  computeReconstructionReleaseDigest,
  computeReconstructionReviewEvidenceArtifactDigest,
  historicalRuntimeSceneMemberAuthorityReference,
  resolveReconstructionSceneAuthorityCoverage,
  stableCanonicalJson,
  type ReconstructionReleaseArtifactRef,
  type ReconstructionReleaseFile,
  type ReconstructionReleaseManifest,
  type ReconstructionReleaseSigningStatement,
  type ReconstructionSceneAuthorityMapV0,
  type TwinManifest,
} from "@omnitwin/types";
import { describe, expect, it } from "vitest";
import { dssePreAuthenticationEncoding } from "../dsse.js";
import { FoundryIntegrityError } from "../errors.js";
import {
  HISTORICAL_RUNTIME_SCENE_MAP_EVIDENCE_ERROR_CODES,
  HISTORICAL_RUNTIME_SCENE_MAP_PARSER_VERSION,
  verifyHistoricalRuntimeSceneMapAuthenticatedEvidenceBytes,
  type HistoricalRuntimeSceneMapRuntimeMemberInput,
  type VerifyHistoricalRuntimeSceneMapAuthenticatedEvidenceInput,
} from "../historical-runtime-scene-map-authenticated-evidence-bytes.js";
import {
  HISTORICAL_RUNTIME_SCENE_MAP_PARSER_IMPLEMENTATION_MANIFEST_DIGEST,
} from "../historical-runtime-scene-map-parser-implementation-manifest.generated.js";
import {
  HISTORICAL_RUNTIME_SCENE_MAP_PARSER_POLICY_DIGEST,
} from "../historical-runtime-scene-map-parser-policy.js";
import {
  canonicalHistoricalRuntimeTwinReleaseEnvelopeBytes,
  HISTORICAL_RUNTIME_TWIN_RELEASE_EVIDENCE_ERROR_CODES,
} from "../historical-runtime-twin-release-authenticated-evidence-bytes.js";
import type {
  HistoricalRuntimeTwinReleaseAuthenticatedEvidenceBytes,
} from "../historical-runtime-twin-release-authenticated-evidence-bytes.js";

const RELEASE_ID = "10000000-0000-4000-8000-000000000220";
const REVIEW_ID = "10000000-0000-4000-8000-000000000221";
const REVIEWER_ID = "10000000-0000-4000-8000-000000000222";
const ASSET_IDS = [
  "10000000-0000-4000-8000-000000000230",
  "10000000-0000-4000-8000-000000000231",
  "10000000-0000-4000-8000-000000000232",
] as const;
const OUTPUT_RECEIPT_IDS = [
  "10000000-0000-4000-8000-000000000240",
  "10000000-0000-4000-8000-000000000241",
  "10000000-0000-4000-8000-000000000242",
] as const;
const TRANSFORM_REF: ReconstructionReleaseArtifactRef = {
  artifactId: "grand-hall-transform-v1",
  artifactDigest: hashUtf8("grand-hall-transform-v1"),
};
const SCENE_MAP_ID = "grand-hall-scene-map-v1";
const KEY_ID = "venviewer-scene-release-key";

type SceneScope = ReconstructionSceneAuthorityMapV0["regions"][number]["scope"];
type NonAppearanceAuthoritySlot =
  | "geometryAuthority"
  | "lightingAuthority"
  | "physicsAuthority"
  | "semanticAuthority"
  | "interactionAuthority"
  | "exportAuthority";
type AuthoritySlot = NonAppearanceAuthoritySlot | "appearanceAuthority";

interface FixtureOptions {
  readonly nodeRooms?: readonly [string | null, string | null, string | null];
  readonly firstScope?: SceneScope;
  readonly secondScope?: SceneScope;
  readonly includeSecondRegion?: boolean;
  readonly firstRuntimeLayerReference?: string;
  readonly secondRuntimeLayerReference?: string;
  readonly semanticReleasePath?: string;
  readonly firstRuntimeLayerSlot?: NonAppearanceAuthoritySlot;
}

interface SceneEvidenceFixture {
  readonly input: VerifyHistoricalRuntimeSceneMapAuthenticatedEvidenceInput;
  readonly sceneMap: ReconstructionSceneAuthorityMapV0;
  readonly releaseManifest: ReconstructionReleaseManifest;
  readonly twinManifest: TwinManifest;
  readonly runtimeMembers: readonly HistoricalRuntimeSceneMapRuntimeMemberInput[];
  readonly sceneMapBytes: Uint8Array;
  readonly signingStatement: ReconstructionReleaseSigningStatement;
  readonly privateKey: KeyObject;
}

function hashUtf8(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function hashBytes(value: Uint8Array): string {
  return createHash("sha256").update(value).digest("hex");
}

function prettyJsonBytes(value: unknown): Uint8Array {
  return Buffer.from(`${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function canonicalSceneBytes(value: ReconstructionSceneAuthorityMapV0): Uint8Array {
  return Buffer.from(
    stableCanonicalJson(CanonicalJsonValueSchema.parse(value)),
    "utf8",
  );
}

function runtimeMember(index: 0 | 1 | 2): HistoricalRuntimeSceneMapRuntimeMemberInput {
  const fileExt = index === 1 ? ".spz" : ".sog";
  const fileName = `grand-hall-layer-${String(index)}${fileExt}`;
  return {
    memberIndex: index,
    assetVersionId: ASSET_IDS[index],
    derivationOutputReceiptId: OUTPUT_RECEIPT_IDS[index],
    derivationMemberReceiptDigest: hashUtf8(`member-receipt-${String(index)}`),
    derivationMemberStorageKeySha256: hashUtf8(`member-storage-${String(index)}`),
    derivationMemberReceiptExpiresAt: "2026-08-20T12:00:00.000Z",
    fileName,
    fileExt,
    mimeType: index === 1
      ? "application/vnd.venviewer.spz"
      : "application/vnd.venviewer.sog",
    sha256: hashUtf8(`runtime-member-${String(index)}`),
    sizeBytes: 1_024 + index,
  };
}

function runtimeAuthorityReference(
  member: HistoricalRuntimeSceneMapRuntimeMemberInput,
): string {
  return historicalRuntimeSceneMemberAuthorityReference({
    memberIndex: member.memberIndex,
    assetVersionId: member.assetVersionId,
    fileName: member.fileName,
    fileExt: member.fileExt,
    mimeType: member.mimeType,
    sha256: member.sha256,
    sizeBytes: member.sizeBytes,
    storageKeySha256: member.derivationMemberStorageKeySha256,
  });
}

function sourceTwin(
  rooms: readonly [string | null, string | null, string | null],
): TwinManifest {
  return TwinManifestSchema.parse({
    schema: "twin/0",
    venueSlug: "trades-hall",
    name: "Trades Hall exact source Twin",
    capture: { kind: "matterport-e57", scanCount: 3 },
    tier: "planning-grade-5cm",
    upAxis: "z",
    units: "m",
    imagery: "equirect",
    faces: ["front", "back", "left", "right", "up", "down"],
    lods: [512, 4096, 8192],
    generatedAt: "2026-08-20T08:00:00.000Z",
    nodes: [
      {
        id: "scan_000",
        index: 0,
        pose: { q: [1, 0, 0, 0], t: [0, 0, 1.5] },
        floor: 0,
        roomSlug: rooms[0],
      },
      {
        id: "scan_001",
        index: 1,
        pose: { q: [1, 0, 0, 0], t: [4, 0, 1.5] },
        floor: 0,
        roomSlug: rooms[1],
      },
      {
        id: "scan_002",
        index: 2,
        pose: { q: [1, 0, 0, 0], t: [8, 0, 1.5] },
        floor: 0,
        roomSlug: rooms[2],
      },
    ],
    edges: [
      { a: "scan_000", b: "scan_001", distanceM: 4 },
      { a: "scan_001", b: "scan_002", distanceM: 4 },
    ],
    entryNodeId: "scan_000",
  });
}

function sceneAuthorityMap(
  members: readonly HistoricalRuntimeSceneMapRuntimeMemberInput[],
  options: FixtureOptions,
): ReconstructionSceneAuthorityMapV0 {
  const firstMember = members[0];
  const secondMember = members[1];
  if (firstMember === undefined || secondMember === undefined) {
    throw new TypeError("The valid fixture requires two runtime members.");
  }
  const releaseFile = (ref: string) => ({ kind: "release_file" as const, ref });
  const runtimeLayer = (ref: string) => ({ kind: "runtime_layer" as const, ref });
  const authorities = (
    runtimeLayerRef: string,
    runtimeLayerSlot?: NonAppearanceAuthoritySlot,
  ) => {
    const releaseBacked = {
      geometryAuthority: releaseFile("mesh/dollhouse.glb"),
      appearanceAuthority: releaseFile("tiles/scan_000/equirect_512.webp"),
      lightingAuthority: { kind: "none" as const, ref: null },
      physicsAuthority: releaseFile("mesh/dollhouse.glb"),
      semanticAuthority: releaseFile(options.semanticReleasePath ?? "manifest.json"),
      interactionAuthority: releaseFile("mesh/dollhouse.glb"),
      exportAuthority: releaseFile("mesh/dollhouse.glb"),
    };
    if (runtimeLayerSlot === undefined) {
      return {
        ...releaseBacked,
        appearanceAuthority: runtimeLayer(runtimeLayerRef),
      };
    }
    switch (runtimeLayerSlot) {
      case "geometryAuthority":
        return { ...releaseBacked, geometryAuthority: runtimeLayer(runtimeLayerRef) };
      case "lightingAuthority":
        return { ...releaseBacked, lightingAuthority: runtimeLayer(runtimeLayerRef) };
      case "physicsAuthority":
        return { ...releaseBacked, physicsAuthority: runtimeLayer(runtimeLayerRef) };
      case "semanticAuthority":
        return { ...releaseBacked, semanticAuthority: runtimeLayer(runtimeLayerRef) };
      case "interactionAuthority":
        return { ...releaseBacked, interactionAuthority: runtimeLayer(runtimeLayerRef) };
      case "exportAuthority":
        return { ...releaseBacked, exportAuthority: runtimeLayer(runtimeLayerRef) };
    }
  };
  const region = (
    id: string,
    label: string,
    scope: SceneScope,
    runtimeLayerRef: string,
    runtimeLayerSlot?: NonAppearanceAuthoritySlot,
  ) => ({
    id,
    label,
    scope,
    authorities: authorities(runtimeLayerRef, runtimeLayerSlot),
    truthStatus: "measured" as const,
    confidenceTier: "layout_grade" as const,
    provenanceRefs: [{
      refType: "artifact" as const,
      ref: "evidence/trades-hall",
      role: "release-source",
    }],
    reconstructionStrategy: "matterpak_original" as const,
    transformArtifactRef: TRANSFORM_REF,
  });
  const regions = [
    region(
      "grand-hall-west",
      "Grand Hall west",
      options.firstScope ?? { kind: "twin_nodes", nodeIds: ["scan_000"] },
      options.firstRuntimeLayerReference ?? runtimeAuthorityReference(firstMember),
      options.firstRuntimeLayerSlot,
    ),
  ];
  if (options.includeSecondRegion !== false) {
    regions.push(region(
      "grand-hall-east",
      "Grand Hall east",
      options.secondScope ?? { kind: "twin_nodes", nodeIds: ["scan_001"] },
      options.secondRuntimeLayerReference ?? runtimeAuthorityReference(secondMember),
    ));
  }
  return ReconstructionSceneAuthorityMapV0Schema.parse({
    schemaVersion: RECONSTRUCTION_SCENE_AUTHORITY_MAP_SCHEMA_VERSION,
    id: SCENE_MAP_ID,
    venueSlug: "trades-hall",
    generatedAt: "2026-08-20T08:10:00.000Z",
    regions,
  });
}

function signedStatement(input: {
  readonly releaseDigest: string;
  readonly releaseManifestSha256: string;
  readonly sourceManifestSha256: string;
  readonly sceneMap: ReconstructionSceneAuthorityMapV0;
}): ReconstructionReleaseSigningStatement {
  return ReconstructionReleaseSigningStatementSchema.parse({
    _type: "https://in-toto.io/Statement/v1",
    subject: [{
      name: `reconstruction-release/trades-hall/${input.releaseDigest}`,
      digest: { sha256: input.releaseDigest },
    }],
    predicateType: "https://venviewer.com/attestations/reconstruction-release/v1",
    predicate: {
      schemaVersion: "venviewer.reconstruction-attestation-predicate.v1",
      venueSlug: "trades-hall",
      releaseKind: "venue_twin_v1",
      releaseId: RELEASE_ID,
      releaseDigest: input.releaseDigest,
      sourceManifestSha256: input.sourceManifestSha256,
      releaseManifestSha256: input.releaseManifestSha256,
      qaReportDigest: hashUtf8("qa-report"),
      reviewId: REVIEW_ID,
      reviewDigest: hashUtf8("review"),
      reviewedAt: "2026-08-20T09:01:00.000Z",
      reviewerUserId: REVIEWER_ID,
      decision: "approved",
      targetExposure: "public",
      visualEvidence: [{
        label: "Grand Hall exact overview",
        objectKey: "evidence/trades-hall/grand-hall.png",
        sha256: hashUtf8("visual-evidence"),
      }],
      transformArtifactRef: TRANSFORM_REF,
      sceneAuthorityMapRef: {
        artifactId: input.sceneMap.id,
        artifactDigest: computeReconstructionReviewEvidenceArtifactDigest(input.sceneMap),
      },
    },
  });
}

function publicKeyFingerprint(publicKey: KeyObject): string {
  const der = publicKey.export({ format: "der", type: "spki" });
  return createHash("sha256").update(der).digest("hex");
}

function signedTwinEnvelopeBytes(
  statement: ReconstructionReleaseSigningStatement,
  privateKey: KeyObject,
): Uint8Array {
  const payloadUtf8 = JSON.stringify(statement);
  const payload = Buffer.from(payloadUtf8, "utf8");
  const signature = sign(
    null,
    dssePreAuthenticationEncoding(RECONSTRUCTION_DSSE_PAYLOAD_TYPE, payload),
    privateKey,
  );
  return canonicalHistoricalRuntimeTwinReleaseEnvelopeBytes({
    payloadType: RECONSTRUCTION_DSSE_PAYLOAD_TYPE,
    payload: payload.toString("base64"),
    signatures: [{ keyid: KEY_ID, sig: signature.toString("base64") }],
  });
}

function structurallyVerifiedTwinRelease(
  statement: ReconstructionReleaseSigningStatement,
): HistoricalRuntimeTwinReleaseAuthenticatedEvidenceBytes {
  const payloadUtf8 = JSON.stringify(statement);
  const envelope = ReconstructionDsseEnvelopeSchema.parse({
    payloadType: RECONSTRUCTION_DSSE_PAYLOAD_TYPE,
    payload: Buffer.from(payloadUtf8, "utf8").toString("base64"),
    signatures: [{
      keyid: KEY_ID,
      sig: Buffer.alloc(64, 7).toString("base64"),
    }],
  });
  const envelopeUtf8 = JSON.stringify(envelope);
  return Object.freeze({
    payloadType: RECONSTRUCTION_DSSE_PAYLOAD_TYPE,
    keyId: envelope.signatures[0]?.keyid ?? "",
    publicKeyFingerprint: hashUtf8("test-release-public-key"),
    envelope,
    statement,
    envelopeUtf8,
    payloadUtf8,
    envelopeSha256: hashUtf8(envelopeUtf8),
    payloadSha256: hashUtf8(payloadUtf8),
    envelopeByteLength: String(Buffer.byteLength(envelopeUtf8, "utf8")),
    payloadByteLength: String(Buffer.byteLength(payloadUtf8, "utf8")),
  });
}

function fixture(options: FixtureOptions = {}): SceneEvidenceFixture {
  const { publicKey, privateKey } = generateKeyPairSync("ed25519");
  const runtimeMembers = [runtimeMember(0), runtimeMember(1)] as const;
  const twinManifest = sourceTwin(
    options.nodeRooms ?? ["grand-hall", "grand-hall", "reception-room"],
  );
  const sourceTwinManifestBytes = prettyJsonBytes(twinManifest);
  const sourceManifestSha256 = hashBytes(sourceTwinManifestBytes);
  const sceneMap = sceneAuthorityMap(runtimeMembers, options);
  const sceneMapBytes = canonicalSceneBytes(sceneMap);
  const files: ReconstructionReleaseFile[] = [
    {
      path: "manifest.json",
      sha256: sourceManifestSha256,
      sizeBytes: sourceTwinManifestBytes.byteLength,
      mimeType: "application/json",
      role: "manifest",
    },
    {
      path: "mesh/dollhouse.glb",
      sha256: hashUtf8("dollhouse-geometry"),
      sizeBytes: 8_192,
      mimeType: "model/gltf-binary",
      role: "geometry",
    },
    ...runtimeMembers.map((member) => ({
      path: `runtime/${member.fileName}`,
      sha256: member.sha256,
      sizeBytes: member.sizeBytes,
      mimeType: member.mimeType,
      role: "geometry" as const,
    })),
    {
      path: "tiles/scan_000/equirect_512.webp",
      sha256: hashUtf8("grand-hall-equirect"),
      sizeBytes: 4_096,
      mimeType: "image/webp",
      role: "imagery",
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
    generatedAt: "2026-08-20T08:20:00.000Z",
  });
  const releaseManifestBytes = prettyJsonBytes(releaseManifest);
  const statement = signedStatement({
    releaseDigest: releaseManifest.releaseDigest,
    releaseManifestSha256: hashBytes(releaseManifestBytes),
    sourceManifestSha256,
    sceneMap,
  });
  return {
    sceneMap,
    releaseManifest,
    twinManifest,
    runtimeMembers,
    sceneMapBytes,
    signingStatement: statement,
    privateKey,
    input: {
      sceneMapBytes,
      releaseManifestBytes,
      sourceTwinManifestBytes,
      spaceSlug: "grand-hall",
      twinReleaseEnvelopeBytes: signedTwinEnvelopeBytes(statement, privateKey),
      trustedTwinReleasePublicKeys: new Map([[KEY_ID, publicKey]]),
      expectedTwinRelease: {
        expectedKeyId: KEY_ID,
        expectedPublicKeyFingerprint: publicKeyFingerprint(publicKey),
        statement,
      },
      runtimeMembers,
    },
  };
}

function expectIntegrityCode(action: () => unknown, code: string): void {
  let caught: unknown;
  try {
    action();
  } catch (error: unknown) {
    caught = error;
  }
  expect(caught).toBeInstanceOf(FoundryIntegrityError);
  expect((caught as FoundryIntegrityError).code).toBe(code);
}

function inputWithStatement(
  source: SceneEvidenceFixture,
  statement: ReconstructionReleaseSigningStatement,
): VerifyHistoricalRuntimeSceneMapAuthenticatedEvidenceInput {
  return {
    ...source.input,
    twinReleaseEnvelopeBytes: signedTwinEnvelopeBytes(statement, source.privateKey),
    expectedTwinRelease: {
      ...source.input.expectedTwinRelease,
      statement,
    },
  };
}

describe("historical-runtime Scene-map exact private-byte evidence", () => {
  it("derives exact signed room, node, release-file, and runtime-member coverage", () => {
    const source = fixture();
    const verified = verifyHistoricalRuntimeSceneMapAuthenticatedEvidenceBytes(source.input);

    expect(verified.parserVersion).toBe(HISTORICAL_RUNTIME_SCENE_MAP_PARSER_VERSION);
    expect(verified.verificationBoundary).toBe(
      "exact_private_scene_map_release_inventory_v1",
    );
    expect(verified.parserPolicyDigest).toBe(
      HISTORICAL_RUNTIME_SCENE_MAP_PARSER_POLICY_DIGEST,
    );
    expect(verified.parserImplementationManifestDigest).toBe(
      HISTORICAL_RUNTIME_SCENE_MAP_PARSER_IMPLEMENTATION_MANIFEST_DIGEST,
    );
    expect(verified.authenticatedTwinRelease).toMatchObject({
      payloadType: RECONSTRUCTION_DSSE_PAYLOAD_TYPE,
      keyId: KEY_ID,
      envelopeSha256: hashBytes(source.input.twinReleaseEnvelopeBytes),
    });
    expect(verified.authenticatedTwinRelease.statementSha256).toBe(
      verified.authenticatedTwinRelease.payloadSha256,
    );
    expect(verified.coverage.roomProjection).toEqual({
      projectionVersion: "venviewer.scene-room-node-projection.v1",
      ordering: "source_twin_manifest_order",
      spaceSlug: "grand-hall",
      roomTwinNodeIds: ["scan_000", "scan_001"],
    });
    expect(verified.coverage.expectedTwinNodeIds).toEqual(["scan_000", "scan_001"]);
    expect(verified.coverage.coveredTwinNodeIds).toEqual(["scan_000", "scan_001"]);
    expect(verified.coverage.expandedRegionNodeReferenceCount).toBe(2);
    expect(verified.coverage.normalizedProjectionByteLength).toBeGreaterThan(0);
    expect(verified.coverage.orderedRegions).toEqual([
      {
        regionIndex: 0,
        regionId: "grand-hall-west",
        coveredTwinNodeIds: ["scan_000"],
      },
      {
        regionIndex: 1,
        regionId: "grand-hall-east",
        coveredTwinNodeIds: ["scan_001"],
      },
    ]);
    expect(verified.orderedMembers.map((member) => member.coveredRegionIds)).toEqual([
      ["grand-hall-west"],
      ["grand-hall-east"],
    ]);
    expect(verified.orderedMembers.map((member) => member.authorityReference)).toEqual(
      source.runtimeMembers.map(runtimeAuthorityReference),
    );
    expect(verified.sceneMapSha256).toBe(hashBytes(source.sceneMapBytes));
    expect(verified.sceneMapByteLength).toBe(String(source.sceneMapBytes.byteLength));
  });

  it("cannot bypass the raw Twin verifier with a forged structural result", () => {
    const source = fixture();
    const forgedTwinRelease = structurallyVerifiedTwinRelease(
      source.signingStatement,
    );
    const forgedInput = {
      ...source.input,
      twinReleaseEnvelopeBytes: canonicalHistoricalRuntimeTwinReleaseEnvelopeBytes(
        forgedTwinRelease.envelope,
      ),
      twinRelease: forgedTwinRelease,
    };
    expectIntegrityCode(
      () => verifyHistoricalRuntimeSceneMapAuthenticatedEvidenceBytes(forgedInput),
      HISTORICAL_RUNTIME_TWIN_RELEASE_EVIDENCE_ERROR_CODES.signatureInvalid,
    );
  });

  it("rejects BOM, invalid UTF-8, and duplicate JSON keys before projection", () => {
    const source = fixture();
    expect(() => verifyHistoricalRuntimeSceneMapAuthenticatedEvidenceBytes({
      ...source.input,
      sceneMapBytes: Buffer.concat([
        Buffer.from([0xef, 0xbb, 0xbf]),
        Buffer.from(source.sceneMapBytes),
      ]),
    })).toThrow();

    const invalidUtf8 = Buffer.from(source.sceneMapBytes);
    const venueOffset = invalidUtf8.indexOf(Buffer.from("trades-hall", "utf8"));
    expect(venueOffset).toBeGreaterThanOrEqual(0);
    invalidUtf8[venueOffset] = 0xff;
    expect(() => verifyHistoricalRuntimeSceneMapAuthenticatedEvidenceBytes({
      ...source.input,
      sceneMapBytes: invalidUtf8,
    })).toThrow();

    const canonical = Buffer.from(source.sceneMapBytes).toString("utf8");
    const duplicateId = canonical.replace(
      `"id":"${SCENE_MAP_ID}"`,
      `"id":"${SCENE_MAP_ID}","id":"${SCENE_MAP_ID}"`,
    );
    expect(duplicateId).not.toBe(canonical);
    expect(() => verifyHistoricalRuntimeSceneMapAuthenticatedEvidenceBytes({
      ...source.input,
      sceneMapBytes: Buffer.from(duplicateId, "utf8"),
    })).toThrow();
  });

  it("rejects Scene whitespace and key-order aliases that parse to the same object", () => {
    const source = fixture();
    const canonical = Buffer.from(source.sceneMapBytes).toString("utf8");
    const whitespaceAlias = canonical.replace("{", "{ ");
    expectIntegrityCode(
      () => verifyHistoricalRuntimeSceneMapAuthenticatedEvidenceBytes({
        ...source.input,
        sceneMapBytes: Buffer.from(whitespaceAlias, "utf8"),
      }),
      HISTORICAL_RUNTIME_SCENE_MAP_EVIDENCE_ERROR_CODES.sceneMapBytesInvalid,
    );

    const fieldOrderAlias = JSON.stringify(source.sceneMap);
    expect(fieldOrderAlias).not.toBe(canonical);
    expectIntegrityCode(
      () => verifyHistoricalRuntimeSceneMapAuthenticatedEvidenceBytes({
        ...source.input,
        sceneMapBytes: Buffer.from(fieldOrderAlias, "utf8"),
      }),
      HISTORICAL_RUNTIME_SCENE_MAP_EVIDENCE_ERROR_CODES.sceneMapBytesInvalid,
    );
  });

  it("rejects substituted release/source bytes and signed Scene/Transform refs", () => {
    const source = fixture();
    const base = source.signingStatement;
    const substitutedRelease = ReconstructionReleaseManifestSchema.parse({
      ...source.releaseManifest,
      generatedAt: "2026-08-20T08:20:01.000Z",
    });
    expectIntegrityCode(
      () => verifyHistoricalRuntimeSceneMapAuthenticatedEvidenceBytes({
        ...source.input,
        releaseManifestBytes: prettyJsonBytes(substitutedRelease),
      }),
      HISTORICAL_RUNTIME_SCENE_MAP_EVIDENCE_ERROR_CODES.signedIdentityMismatch,
    );

    const substitutedSourceTwin = TwinManifestSchema.parse({
      ...source.twinManifest,
      name: "Substituted source Twin",
    });
    expectIntegrityCode(
      () => verifyHistoricalRuntimeSceneMapAuthenticatedEvidenceBytes({
        ...source.input,
        sourceTwinManifestBytes: prettyJsonBytes(substitutedSourceTwin),
      }),
      HISTORICAL_RUNTIME_SCENE_MAP_EVIDENCE_ERROR_CODES.signedIdentityMismatch,
    );

    const wrongSceneRef = ReconstructionReleaseSigningStatementSchema.parse({
      ...base,
      predicate: {
        ...base.predicate,
        sceneAuthorityMapRef: {
          artifactId: "substituted-scene-map",
          artifactDigest: hashUtf8("substituted-scene-map"),
        },
      },
    });
    expectIntegrityCode(
      () => verifyHistoricalRuntimeSceneMapAuthenticatedEvidenceBytes(
        inputWithStatement(source, wrongSceneRef),
      ),
      HISTORICAL_RUNTIME_SCENE_MAP_EVIDENCE_ERROR_CODES.signedIdentityMismatch,
    );

    const wrongTransformRef = ReconstructionReleaseSigningStatementSchema.parse({
      ...base,
      predicate: {
        ...base.predicate,
        transformArtifactRef: {
          artifactId: "substituted-transform",
          artifactDigest: hashUtf8("substituted-transform"),
        },
      },
    });
    expectIntegrityCode(
      () => verifyHistoricalRuntimeSceneMapAuthenticatedEvidenceBytes(
        inputWithStatement(source, wrongTransformRef),
      ),
      HISTORICAL_RUNTIME_SCENE_MAP_EVIDENCE_ERROR_CODES.coverageInvalid,
    );
  });

  it("excludes other-room nodes, but rejects null room tags and incomplete room coverage", () => {
    const valid = fixture();
    expect(
      verifyHistoricalRuntimeSceneMapAuthenticatedEvidenceBytes(valid.input)
        .coverage.expectedTwinNodeIds,
    ).not.toContain("scan_002");

    const nullRoom = fixture({
      nodeRooms: ["grand-hall", "grand-hall", null],
    });
    expectIntegrityCode(
      () => verifyHistoricalRuntimeSceneMapAuthenticatedEvidenceBytes(nullRoom.input),
      HISTORICAL_RUNTIME_SCENE_MAP_EVIDENCE_ERROR_CODES.coverageInvalid,
    );

    const missingNode = fixture({ includeSecondRegion: false });
    expectIntegrityCode(
      () => verifyHistoricalRuntimeSceneMapAuthenticatedEvidenceBytes(missingNode.input),
      HISTORICAL_RUNTIME_SCENE_MAP_EVIDENCE_ERROR_CODES.coverageInvalid,
    );
  });

  it("rejects unknown, omitted, extra, and duplicate-alias runtime members", () => {
    const unknownLayer = fixture({
      firstRuntimeLayerReference: `runtime-layer/v1/${hashUtf8("unknown-layer")}`,
    });
    expectIntegrityCode(
      () => verifyHistoricalRuntimeSceneMapAuthenticatedEvidenceBytes(unknownLayer.input),
      HISTORICAL_RUNTIME_SCENE_MAP_EVIDENCE_ERROR_CODES.coverageInvalid,
    );

    const source = fixture();
    expectIntegrityCode(
      () => verifyHistoricalRuntimeSceneMapAuthenticatedEvidenceBytes({
        ...source.input,
        runtimeMembers: [source.runtimeMembers[0]!],
      }),
      HISTORICAL_RUNTIME_SCENE_MAP_EVIDENCE_ERROR_CODES.coverageInvalid,
    );
    expectIntegrityCode(
      () => verifyHistoricalRuntimeSceneMapAuthenticatedEvidenceBytes({
        ...source.input,
        runtimeMembers: [...source.runtimeMembers, runtimeMember(2)],
      }),
      HISTORICAL_RUNTIME_SCENE_MAP_EVIDENCE_ERROR_CODES.coverageInvalid,
    );
    expectIntegrityCode(
      () => verifyHistoricalRuntimeSceneMapAuthenticatedEvidenceBytes({
        ...source.input,
        runtimeMembers: [source.runtimeMembers[0]!, source.runtimeMembers[0]!],
      }),
      HISTORICAL_RUNTIME_SCENE_MAP_EVIDENCE_ERROR_CODES.memberIdentityMismatch,
    );
  });

  it("rejects an unbound appearance runtime layer at the public release-review boundary", () => {
    const source = fixture();
    expect(() => resolveReconstructionSceneAuthorityCoverage({
      map: source.sceneMap,
      twin: source.twinManifest,
      release: source.releaseManifest,
      selectedTransform: TRANSFORM_REF,
      spaceSlug: "grand-hall",
      rejectBoundsCvf: true,
    })).toThrow(/unbound runtime layer/u);
  });

  it("rejects missing release_file authorities and frame-unproven bounds_cvf", () => {
    const missingReleaseFile = fixture({
      semanticReleasePath: "semantic/missing.json",
    });
    expectIntegrityCode(
      () => verifyHistoricalRuntimeSceneMapAuthenticatedEvidenceBytes(missingReleaseFile.input),
      HISTORICAL_RUNTIME_SCENE_MAP_EVIDENCE_ERROR_CODES.coverageInvalid,
    );

    const bounds = fixture({
      firstScope: {
        kind: "bounds_cvf",
        min: [-1, -1, 0],
        max: [1, 1, 3],
      },
    });
    expectIntegrityCode(
      () => verifyHistoricalRuntimeSceneMapAuthenticatedEvidenceBytes(bounds.input),
      HISTORICAL_RUNTIME_SCENE_MAP_EVIDENCE_ERROR_CODES.coverageInvalid,
    );
  });

  it.each([
    "geometryAuthority",
    "lightingAuthority",
    "physicsAuthority",
    "semanticAuthority",
    "interactionAuthority",
    "exportAuthority",
  ] as const)("rejects visual runtime_layer in non-appearance slot %s", (slot) => {
    const source = fixture({ firstRuntimeLayerSlot: slot });
    expectIntegrityCode(
      () => verifyHistoricalRuntimeSceneMapAuthenticatedEvidenceBytes(source.input),
      HISTORICAL_RUNTIME_SCENE_MAP_EVIDENCE_ERROR_CODES.coverageInvalid,
    );
  });

  it.each([
    "geometryAuthority",
    "appearanceAuthority",
    "lightingAuthority",
    "physicsAuthority",
    "semanticAuthority",
    "interactionAuthority",
    "exportAuthority",
  ] as const)("rejects a SOG/SPZ release_file in authority slot %s", (slot: AuthoritySlot) => {
    const source = fixture();
    const firstRegion = source.sceneMap.regions[0];
    if (firstRegion === undefined) throw new Error("Scene test fixture requires one region.");
    const map = ReconstructionSceneAuthorityMapV0Schema.parse({
      ...source.sceneMap,
      regions: [{
        ...firstRegion,
        authorities: {
          ...firstRegion.authorities,
          [slot]: {
            kind: "release_file",
            ref: "runtime/grand-hall-layer-0.sog",
          },
        },
      }, ...source.sceneMap.regions.slice(1)],
    });
    expect(() => resolveReconstructionSceneAuthorityCoverage({
      map,
      twin: source.twinManifest,
      release: source.releaseManifest,
      selectedTransform: TRANSFORM_REF,
      spaceSlug: "grand-hall",
      rejectBoundsCvf: true,
      runtimeLayers: source.runtimeMembers.map((member) => ({
        authorityReference: runtimeAuthorityReference(member),
      })),
    })).toThrow(/cannot use a SOG\/SPZ visual runtime layer as release_file authority/u);
  });

  it("rejects whole_venue as a room proof when the signed Twin contains another room", () => {
    const source = fixture({
      firstScope: { kind: "whole_venue" },
    });
    expectIntegrityCode(
      () => verifyHistoricalRuntimeSceneMapAuthenticatedEvidenceBytes(source.input),
      HISTORICAL_RUNTIME_SCENE_MAP_EVIDENCE_ERROR_CODES.coverageInvalid,
    );
  });
});
