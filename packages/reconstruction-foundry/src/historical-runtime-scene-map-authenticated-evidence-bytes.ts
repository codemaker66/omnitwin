import { createHash, type KeyObject } from "node:crypto";
import {
  CanonicalJsonValueSchema,
  ReconstructionReleaseManifestSchema,
  ReconstructionReleaseSigningStatementSchema,
  ReconstructionSceneAuthorityMapV0Schema,
  TwinManifestSchema,
  computeReconstructionReviewEvidenceArtifactDigest,
  historicalRuntimeSceneMemberAuthorityReference,
  resolveReconstructionSceneAuthorityCoverage,
  stableCanonicalJson,
  type ReconstructionReleaseManifest,
  type ReconstructionSceneAuthorityMapV0,
  type ReconstructionSceneAuthorityCoverageProjection,
  type TwinManifest,
} from "@omnitwin/types";
import { z } from "zod";
import {
  parseFoundryStrictJsonBytesWithNumbers,
} from "./activation-v1-authenticated-evidence-bytes.js";
import { FoundryIntegrityError } from "./errors.js";
import {
  verifyHistoricalRuntimeTwinReleaseEnvelopeBytes,
  type HistoricalRuntimeTwinReleaseAuthenticatedEvidenceBytes,
  type HistoricalRuntimeTwinReleaseExpectedEvidence,
} from "./historical-runtime-twin-release-authenticated-evidence-bytes.js";
import {
  HISTORICAL_RUNTIME_RELEASE_MANIFEST_MAX_BYTES,
  HISTORICAL_RUNTIME_SCENE_MAP_MAX_BYTES,
  HISTORICAL_RUNTIME_SCENE_MAP_PARSER_POLICY_DIGEST,
  HISTORICAL_RUNTIME_SCENE_MAP_PARSER_VERSION,
  HISTORICAL_RUNTIME_SOURCE_TWIN_MANIFEST_MAX_BYTES,
} from "./historical-runtime-scene-map-parser-policy.js";
import {
  HISTORICAL_RUNTIME_SCENE_MAP_PARSER_IMPLEMENTATION_MANIFEST_DIGEST,
} from "./historical-runtime-scene-map-parser-implementation-manifest.generated.js";

export {
  HISTORICAL_RUNTIME_RELEASE_MANIFEST_MAX_BYTES,
  HISTORICAL_RUNTIME_SCENE_MAP_MAX_BYTES,
  HISTORICAL_RUNTIME_SCENE_MAP_PARSER_VERSION,
  HISTORICAL_RUNTIME_SOURCE_TWIN_MANIFEST_MAX_BYTES,
} from "./historical-runtime-scene-map-parser-policy.js";

export const HISTORICAL_RUNTIME_SCENE_MAP_EVIDENCE_ERROR_CODES = Object.freeze({
  inputInvalid: "HISTORICAL_RUNTIME_SCENE_MAP_INPUT_INVALID",
  sceneMapShapeInvalid: "HISTORICAL_RUNTIME_SCENE_MAP_SHAPE_INVALID",
  sceneMapBytesInvalid: "HISTORICAL_RUNTIME_SCENE_MAP_BYTES_INVALID",
  releaseManifestShapeInvalid:
    "HISTORICAL_RUNTIME_SCENE_RELEASE_MANIFEST_SHAPE_INVALID",
  releaseManifestBytesInvalid:
    "HISTORICAL_RUNTIME_SCENE_RELEASE_MANIFEST_BYTES_INVALID",
  sourceTwinManifestShapeInvalid:
    "HISTORICAL_RUNTIME_SCENE_SOURCE_TWIN_MANIFEST_SHAPE_INVALID",
  sourceTwinManifestBytesInvalid:
    "HISTORICAL_RUNTIME_SCENE_SOURCE_TWIN_MANIFEST_BYTES_INVALID",
  signedIdentityMismatch:
    "HISTORICAL_RUNTIME_SCENE_SIGNED_IDENTITY_MISMATCH",
  memberIdentityMismatch: "HISTORICAL_RUNTIME_SCENE_MEMBER_IDENTITY_MISMATCH",
  coverageInvalid: "HISTORICAL_RUNTIME_SCENE_COVERAGE_INVALID",
} as const);

export type HistoricalRuntimeSceneMapEvidenceErrorCode =
  (typeof HISTORICAL_RUNTIME_SCENE_MAP_EVIDENCE_ERROR_CODES)[keyof typeof HISTORICAL_RUNTIME_SCENE_MAP_EVIDENCE_ERROR_CODES];

const SHA256 = z.string().regex(/^[a-f0-9]{64}$/u);
const SAFE_FILE_NAME = /^[^/\\]+$/u;

const HistoricalRuntimeSceneMapRuntimeMemberInputSchema = z.object({
  memberIndex: z.number().int().nonnegative().max(7),
  assetVersionId: z.string().uuid(),
  derivationOutputReceiptId: z.string().uuid(),
  derivationMemberReceiptDigest: SHA256,
  derivationMemberStorageKeySha256: SHA256,
  derivationMemberReceiptExpiresAt: z.string().datetime({ offset: true }),
  fileName: z.string().trim().min(1).max(255).regex(SAFE_FILE_NAME),
  fileExt: z.enum([".sog", ".spz"]),
  mimeType: z.string().trim().min(1).max(160),
  sha256: SHA256,
  sizeBytes: z.number().int().positive().max(16 * 1024 * 1024),
}).strict();

export type HistoricalRuntimeSceneMapRuntimeMemberInput = z.infer<
  typeof HistoricalRuntimeSceneMapRuntimeMemberInputSchema
>;

interface VerifyHistoricalRuntimeSceneMapProjectionInput {
  readonly sceneMapBytes: Uint8Array;
  readonly releaseManifestBytes: Uint8Array;
  readonly sourceTwinManifestBytes: Uint8Array;
  readonly spaceSlug: string;
  readonly twinRelease: HistoricalRuntimeTwinReleaseAuthenticatedEvidenceBytes;
  readonly runtimeMembers: readonly HistoricalRuntimeSceneMapRuntimeMemberInput[];
}

export interface VerifyHistoricalRuntimeSceneMapAuthenticatedEvidenceInput {
  readonly sceneMapBytes: Uint8Array;
  readonly releaseManifestBytes: Uint8Array;
  readonly sourceTwinManifestBytes: Uint8Array;
  readonly spaceSlug: string;
  readonly twinReleaseEnvelopeBytes: Uint8Array;
  readonly trustedTwinReleasePublicKeys: ReadonlyMap<string, KeyObject>;
  readonly expectedTwinRelease: HistoricalRuntimeTwinReleaseExpectedEvidence;
  readonly runtimeMembers: readonly HistoricalRuntimeSceneMapRuntimeMemberInput[];
}

export interface HistoricalRuntimeSceneMapAuthenticatedEvidenceBytes {
  readonly parserVersion: typeof HISTORICAL_RUNTIME_SCENE_MAP_PARSER_VERSION;
  readonly parserPolicyDigest:
    typeof HISTORICAL_RUNTIME_SCENE_MAP_PARSER_POLICY_DIGEST;
  readonly parserImplementationManifestDigest: string;
  readonly verificationBoundary: "exact_private_scene_map_release_inventory_v1";
  readonly sceneMap: ReconstructionSceneAuthorityMapV0;
  readonly signedRelease: {
    readonly venueSlug: string;
    readonly releaseId: string;
    readonly releaseDigest: string;
    readonly sourceManifestSha256: string;
    readonly releaseManifestSha256: string;
    readonly reviewId: string;
    readonly reviewDigest: string;
    readonly transformArtifactRef: {
      readonly artifactId: string;
      readonly artifactDigest: string;
    };
    readonly sceneAuthorityMapRef: {
      readonly artifactId: string;
      readonly artifactDigest: string;
    };
  };
  readonly authenticatedTwinRelease: {
    readonly payloadType: string;
    readonly keyId: string;
    readonly publicKeyFingerprint: string;
    readonly envelopeSha256: string;
    readonly envelopeByteLength: string;
    readonly payloadSha256: string;
    readonly payloadByteLength: string;
    readonly statementSha256: string;
    readonly predicateDigest: string;
  };
  readonly sceneMapUtf8: string;
  readonly sceneMapSha256: string;
  readonly sceneMapByteLength: string;
  readonly parsedMapDigest: string;
  readonly releaseManifest: ReconstructionReleaseManifest;
  readonly releaseManifestUtf8: string;
  readonly releaseManifestSha256: string;
  readonly releaseManifestByteLength: string;
  readonly sourceTwinManifest: TwinManifest;
  readonly sourceTwinManifestUtf8: string;
  readonly sourceTwinManifestSha256: string;
  readonly sourceTwinManifestByteLength: string;
  readonly coverage: ReconstructionSceneAuthorityCoverageProjection;
  readonly orderedMembers: readonly (HistoricalRuntimeSceneMapRuntimeMemberInput & {
    readonly authorityReference: string;
    readonly coveredRegionIds: readonly string[];
  })[];
}

const ERROR = HISTORICAL_RUNTIME_SCENE_MAP_EVIDENCE_ERROR_CODES;

function fail(
  code: HistoricalRuntimeSceneMapEvidenceErrorCode,
  message: string,
  options?: ErrorOptions,
): never {
  throw new FoundryIntegrityError(code, message, options);
}

function sha256Hex(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function parseStrictSchema<Output, Input>(input: {
  readonly bytes: Uint8Array;
  readonly maximumByteLength: number;
  readonly schema: z.ZodType<Output, z.ZodTypeDef, Input>;
  readonly shapeCode: HistoricalRuntimeSceneMapEvidenceErrorCode;
  readonly shapeSubject: string;
}): { readonly value: Output; readonly sourceJson: string } {
  const parsed = parseFoundryStrictJsonBytesWithNumbers(
    input.bytes,
    input.maximumByteLength,
  );
  try {
    return Object.freeze({
      value: input.schema.parse(parsed.value),
      sourceJson: parsed.sourceJson,
    });
  } catch (cause) {
    fail(input.shapeCode, `${input.shapeSubject} does not have the exact strict schema.`, {
      cause,
    });
  }
}

function exactPrettyJson(value: unknown): string {
  return `${JSON.stringify(value, null, 2)}\n`;
}

function exactRuntimeMembers(
  input: readonly HistoricalRuntimeSceneMapRuntimeMemberInput[],
): readonly (HistoricalRuntimeSceneMapRuntimeMemberInput & {
  readonly authorityReference: string;
})[] {
  let members: HistoricalRuntimeSceneMapRuntimeMemberInput[];
  try {
    members = z.array(HistoricalRuntimeSceneMapRuntimeMemberInputSchema)
      .min(1).max(8).parse(input);
  } catch (cause) {
    fail(ERROR.inputInvalid, "Scene verification requires 1-8 exact runtime members.", {
      cause,
    });
  }
  if (
    members.some((member, index) => member.memberIndex !== index) ||
    new Set(members.map((member) => member.assetVersionId)).size !== members.length ||
    new Set(members.map((member) => member.derivationOutputReceiptId)).size !==
      members.length ||
    new Set(members.map((member) => member.derivationMemberReceiptDigest)).size !==
      members.length ||
    new Set(members.map((member) => member.derivationMemberStorageKeySha256)).size !==
      members.length ||
    members.some((member) => !member.fileName.endsWith(member.fileExt))
  ) {
    fail(
      ERROR.memberIdentityMismatch,
      "Scene runtime members must be dense, exact, uniquely stored derivation outputs.",
    );
  }
  return Object.freeze(members.map((member) => Object.freeze({
    ...member,
    authorityReference: historicalRuntimeSceneMemberAuthorityReference({
      memberIndex: member.memberIndex,
      assetVersionId: member.assetVersionId,
      fileName: member.fileName,
      fileExt: member.fileExt,
      mimeType: member.mimeType,
      sha256: member.sha256,
      sizeBytes: member.sizeBytes,
      storageKeySha256: member.derivationMemberStorageKeySha256,
    }),
  })));
}

/**
 * Verifies the three exact private JSON byte sequences needed for production
 * Scene authority, then derives one deterministic room/member projection from
 * the already-signed release statement. No new signature is necessary: the
 * Twin statement commits the release/source-manifest hashes and exact
 * Transform/Scene artifact refs, while this verifier commits the raw private
 * bytes and exact runtime-layer membership used by the SQL receipt.
 */
function verifyHistoricalRuntimeSceneMapEvidenceProjection(
  input: VerifyHistoricalRuntimeSceneMapProjectionInput,
): HistoricalRuntimeSceneMapAuthenticatedEvidenceBytes {
  if (input.spaceSlug.trim() !== input.spaceSlug || input.spaceSlug.length === 0) {
    fail(ERROR.inputInvalid, "Scene verification requires one exact nonblank room slug.");
  }
  const members = exactRuntimeMembers(input.runtimeMembers);
  const sceneResult = parseStrictSchema({
    bytes: input.sceneMapBytes,
    maximumByteLength: HISTORICAL_RUNTIME_SCENE_MAP_MAX_BYTES,
    schema: ReconstructionSceneAuthorityMapV0Schema,
    shapeCode: ERROR.sceneMapShapeInvalid,
    shapeSubject: "Private Scene Authority Map",
  });
  const releaseResult = parseStrictSchema({
    bytes: input.releaseManifestBytes,
    maximumByteLength: HISTORICAL_RUNTIME_RELEASE_MANIFEST_MAX_BYTES,
    schema: ReconstructionReleaseManifestSchema,
    shapeCode: ERROR.releaseManifestShapeInvalid,
    shapeSubject: "Private reconstruction release manifest",
  });
  const twinResult = parseStrictSchema({
    bytes: input.sourceTwinManifestBytes,
    maximumByteLength: HISTORICAL_RUNTIME_SOURCE_TWIN_MANIFEST_MAX_BYTES,
    schema: TwinManifestSchema,
    shapeCode: ERROR.sourceTwinManifestShapeInvalid,
    shapeSubject: "Private source Twin manifest",
  });

  const sceneCanonical = stableCanonicalJson(
    CanonicalJsonValueSchema.parse(sceneResult.value),
  );
  if (sceneResult.sourceJson !== sceneCanonical) {
    fail(
      ERROR.sceneMapBytesInvalid,
      "Scene-map bytes must equal the registry's exact stable-canonical serialization.",
    );
  }
  if (releaseResult.sourceJson !== exactPrettyJson(releaseResult.value)) {
    fail(
      ERROR.releaseManifestBytesInvalid,
      "Release-manifest bytes must equal the Foundry pretty-JSON newline serialization.",
    );
  }
  if (twinResult.sourceJson !== exactPrettyJson(twinResult.value)) {
    fail(
      ERROR.sourceTwinManifestBytesInvalid,
      "Source Twin manifest bytes must equal the Foundry pretty-JSON newline serialization.",
    );
  }

  let statement;
  try {
    statement = ReconstructionReleaseSigningStatementSchema.parse(
      input.twinRelease.statement,
    );
  } catch (cause) {
    fail(
      ERROR.inputInvalid,
      "Scene verification requires one previously authenticated Twin release statement.",
      { cause },
    );
  }
  const predicate = statement.predicate;
  const sceneMapSha256 = sha256Hex(sceneResult.sourceJson);
  const releaseManifestSha256 = sha256Hex(releaseResult.sourceJson);
  const sourceTwinManifestSha256 = sha256Hex(twinResult.sourceJson);
  const parsedMapDigest = computeReconstructionReviewEvidenceArtifactDigest(
    sceneResult.value,
  );
  const predicateDigest = sha256Hex(
    `venviewer.historical-runtime-twin-release-predicate.v1\n${stableCanonicalJson(
      CanonicalJsonValueSchema.parse(predicate),
    )}`,
  );
  const sourceManifestFile = releaseResult.value.files.find(
    (file) => file.path === "manifest.json",
  );
  if (
    predicate.venueSlug !== sceneResult.value.venueSlug ||
    predicate.venueSlug !== releaseResult.value.venueSlug ||
    predicate.venueSlug !== twinResult.value.venueSlug ||
    predicate.releaseDigest !== releaseResult.value.releaseDigest ||
    predicate.releaseManifestSha256 !== releaseManifestSha256 ||
    predicate.sourceManifestSha256 !== sourceTwinManifestSha256 ||
    releaseResult.value.sourceManifestSha256 !== sourceTwinManifestSha256 ||
    sourceManifestFile === undefined ||
    sourceManifestFile.sha256 !== sourceTwinManifestSha256 ||
    sourceManifestFile.sizeBytes !== Buffer.byteLength(twinResult.sourceJson, "utf8") ||
    predicate.sceneAuthorityMapRef.artifactId !== sceneResult.value.id ||
    predicate.sceneAuthorityMapRef.artifactDigest !== parsedMapDigest
  ) {
    fail(
      ERROR.signedIdentityMismatch,
      "Scene, release, and source-Twin bytes do not equal the identities committed by the verified release statement.",
    );
  }

  let coverage: ReconstructionSceneAuthorityCoverageProjection;
  try {
    coverage = resolveReconstructionSceneAuthorityCoverage({
      map: sceneResult.value,
      twin: twinResult.value,
      release: releaseResult.value,
      selectedTransform: predicate.transformArtifactRef,
      spaceSlug: input.spaceSlug,
      rejectBoundsCvf: true,
      runtimeLayers: members.map((member) => ({
        authorityReference: member.authorityReference,
      })),
    });
  } catch (cause) {
    fail(
      ERROR.coverageInvalid,
      "Scene-map bytes do not prove exact whole-room and runtime-member coverage.",
      { cause },
    );
  }
  const memberRegions = new Map(
    coverage.orderedRuntimeLayers.map((layer) => [
      layer.authorityReference,
      layer.coveredRegionIds,
    ]),
  );
  const orderedMembers = members.map((member) => {
    const coveredRegionIds = memberRegions.get(member.authorityReference);
    if (coveredRegionIds === undefined || coveredRegionIds.length === 0) {
      fail(
        ERROR.coverageInvalid,
        `Scene-map bytes do not cover runtime member ${String(member.memberIndex)}.`,
      );
    }
    return Object.freeze({ ...member, coveredRegionIds });
  });
  const memberCoveredRegions = new Set(
    orderedMembers.flatMap((member) => member.coveredRegionIds),
  );
  if (
    memberCoveredRegions.size !== coverage.regionIds.length ||
    coverage.regionIds.some((regionId) => !memberCoveredRegions.has(regionId))
  ) {
    fail(
      ERROR.coverageInvalid,
      "Exact runtime-layer members do not collectively cover every room Scene region.",
    );
  }

  return Object.freeze({
    parserVersion: HISTORICAL_RUNTIME_SCENE_MAP_PARSER_VERSION,
    parserPolicyDigest: HISTORICAL_RUNTIME_SCENE_MAP_PARSER_POLICY_DIGEST,
    parserImplementationManifestDigest:
      HISTORICAL_RUNTIME_SCENE_MAP_PARSER_IMPLEMENTATION_MANIFEST_DIGEST,
    verificationBoundary: "exact_private_scene_map_release_inventory_v1",
    signedRelease: Object.freeze({
      venueSlug: predicate.venueSlug,
      releaseId: predicate.releaseId,
      releaseDigest: predicate.releaseDigest,
      sourceManifestSha256: predicate.sourceManifestSha256,
      releaseManifestSha256: predicate.releaseManifestSha256,
      reviewId: predicate.reviewId,
      reviewDigest: predicate.reviewDigest,
      transformArtifactRef: Object.freeze(predicate.transformArtifactRef),
      sceneAuthorityMapRef: Object.freeze(predicate.sceneAuthorityMapRef),
    }),
    authenticatedTwinRelease: Object.freeze({
      payloadType: input.twinRelease.payloadType,
      keyId: input.twinRelease.keyId,
      publicKeyFingerprint: input.twinRelease.publicKeyFingerprint,
      envelopeSha256: input.twinRelease.envelopeSha256,
      envelopeByteLength: input.twinRelease.envelopeByteLength,
      payloadSha256: input.twinRelease.payloadSha256,
      payloadByteLength: input.twinRelease.payloadByteLength,
      statementSha256: input.twinRelease.payloadSha256,
      predicateDigest,
    }),
    sceneMap: sceneResult.value,
    sceneMapUtf8: sceneResult.sourceJson,
    sceneMapSha256,
    sceneMapByteLength: String(Buffer.byteLength(sceneResult.sourceJson, "utf8")),
    parsedMapDigest,
    releaseManifest: releaseResult.value,
    releaseManifestUtf8: releaseResult.sourceJson,
    releaseManifestSha256,
    releaseManifestByteLength: String(
      Buffer.byteLength(releaseResult.sourceJson, "utf8"),
    ),
    sourceTwinManifest: twinResult.value,
    sourceTwinManifestUtf8: twinResult.sourceJson,
    sourceTwinManifestSha256,
    sourceTwinManifestByteLength: String(
      Buffer.byteLength(twinResult.sourceJson, "utf8"),
    ),
    coverage,
    orderedMembers: Object.freeze(orderedMembers),
  });
}

/**
 * Production Scene verification is deliberately composed with the raw Twin
 * DSSE verifier. Callers cannot substitute a structurally plausible
 * `HistoricalRuntimeTwinReleaseAuthenticatedEvidenceBytes` value: the exact
 * envelope bytes, trusted Ed25519 key, and expected latest-release statement
 * are authenticated in this call before any Scene projection is derived.
 */
export function verifyHistoricalRuntimeSceneMapAuthenticatedEvidenceBytes(
  input: VerifyHistoricalRuntimeSceneMapAuthenticatedEvidenceInput,
): HistoricalRuntimeSceneMapAuthenticatedEvidenceBytes {
  const twinRelease = verifyHistoricalRuntimeTwinReleaseEnvelopeBytes(
    input.twinReleaseEnvelopeBytes,
    input.trustedTwinReleasePublicKeys,
    input.expectedTwinRelease,
  );
  return verifyHistoricalRuntimeSceneMapEvidenceProjection({
    sceneMapBytes: input.sceneMapBytes,
    releaseManifestBytes: input.releaseManifestBytes,
    sourceTwinManifestBytes: input.sourceTwinManifestBytes,
    spaceSlug: input.spaceSlug,
    twinRelease,
    runtimeMembers: input.runtimeMembers,
  });
}
