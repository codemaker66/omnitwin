import { createHash } from "node:crypto";
import { lstat, open, readFile, writeFile } from "node:fs/promises";
import { dirname, isAbsolute } from "node:path";

import {
  domainSeparatedSha256,
  stableCanonicalJson,
  toCanonicalJson,
} from "@omnitwin/reconstruction-foundry";
import { z } from "zod";

import { canonicalizeT554PoseDocument } from "./grand-hall-t554-boundary-review.js";
import { parseGrandHallT554StrictJson } from "./grand-hall-t554-strict-json.js";
import {
  GRAND_HALL_CAMERA_METRIC_SUBSET_DOMAIN,
  GRAND_HALL_CAMERA_METRIC_SUBSET_SCHEMA,
  GRAND_HALL_CAMERA_METRIC_SUBSET_STATE,
  GrandHallCameraMetricAuthorityGuardsSchema,
  GrandHallCameraMetricBareSha256Schema,
  GrandHallCameraMetricGuidSchema,
  GrandHallCameraMetricPoseSchema,
  GrandHallCameraMetricSubsetMaterialSchema,
  GrandHallCameraMetricSubsetSchema,
  type GrandHallCameraMetricAuthorityGuards,
  type GrandHallCameraMetricSourceIdentity,
  type GrandHallCameraMetricSubset,
  type GrandHallCameraMetricSubsetMaterial,
} from "./grand-hall-camera-metric-subset-contract.js";

const CROSSWALK_SCHEMA = "venviewer.panorama-e57-candidate-crosswalk-authority-none.v1";
const IMAGE2D_SCHEMA = "venviewer.e57-image2d-evidence.v1";
const POSE_CANONICALIZATION_METHOD =
  "python_sort_keys_compact_separators_finite_float_repr_pose_schema_v1";

export const GRAND_HALL_CAMERA_METRIC_EXPECTED_SOURCE_IDENTITIES = Object.freeze({
  candidateCrosswalk: {
    locator: "T560_LOCAL_EVIDENCE/panorama-image2d-crosswalk-authority-none.json",
    byteLength: 2_025_532,
    sha256: "sha256:3b0a7757395904233e5fa1436dfe68c0a0daa9539c48ef079f70dde528c82215",
  },
  e57Poses: {
    locator: "E57_SOURCE_ROOT/poses.json",
    byteLength: 37_780,
    sha256: "sha256:f53f65e4142d04157cbddf88cb4caeedfe0bb6b35fd5fe66bc14fcfdc3fb6f08",
    canonicalPoseSha256: "sha256:fe3b9000eda4737af038e01e811e57bffa7fae07290a938c1ef75875c9df82e3",
  },
  e57Image2dManifest: {
    locator: "T559_LOCAL_EVIDENCE/image2d-inventory-authority-none.json",
    byteLength: 663_151,
    sha256: "sha256:fd13da9638d1a1e194fb0c1acaedbe07dea15e65d9c16353d29f6542ce3ad344",
  },
} as const);

export const GRAND_HALL_CAMERA_METRIC_EXPECTED_MAPPINGS = Object.freeze([
  { sweepNumber: 41, panoramaSha256: "d9d056e2453a223144514bdca224bbdfb7e76f4bd7130008a3d811afa67eb974", scanIndex: 40, data3DGuid: "358291034cad4ed6a2774ea12c6cb4c7", supportedCandidateCount: 1 },
  { sweepNumber: 42, panoramaSha256: "d17a7ef141b8237edd06962cfd91178345c52085384904452eb54282527e6013", scanIndex: 41, data3DGuid: "7906a35c0ddc422fa3fa5fa2944c3367", supportedCandidateCount: 1 },
  { sweepNumber: 43, panoramaSha256: "c3fdd8cc7dbb1ae366b509885e3bcfc423650b4493d44f22e78b2402aff7efbf", scanIndex: 42, data3DGuid: "98dacd61bf414e09aa92e703b8c18c3b", supportedCandidateCount: 1 },
  { sweepNumber: 44, panoramaSha256: "bbf7220d89d9726d561f98fb93d9ab0d44223007f49bb57b1de6c813b596e859", scanIndex: 43, data3DGuid: "7f61dcb781a14dfda07adfa7b9a324d5", supportedCandidateCount: 1 },
  { sweepNumber: 45, panoramaSha256: "e02d1eda50f9e6749f20130f001d0abfdc8e76d18c86dce2df2a540c7f485e44", scanIndex: 44, data3DGuid: "0cbaccbbeed34aaf8790e71d5393cb3e", supportedCandidateCount: 1 },
  { sweepNumber: 46, panoramaSha256: "7112c76da5b5548780f5ecc47ac2f05259a506f6c70879dda85ac90a1e01a171", scanIndex: 45, data3DGuid: "e8fbbc0cb4a243278573a14ed341e13f", supportedCandidateCount: 1 },
  { sweepNumber: 47, panoramaSha256: "e12b452eb8367d7a9650f78b865d4b96320d67c1699b906e94de10619fde61c8", scanIndex: 46, data3DGuid: "2d837563cd3d4963a3456805b333942e", supportedCandidateCount: 2 },
  { sweepNumber: 48, panoramaSha256: "ab11ad1641301eb022ebde0f5fba7c35d60cbd46670c653e4106051236d12742", scanIndex: 47, data3DGuid: "5ba1879351274fd9ad1759f7a9394dff", supportedCandidateCount: 1 },
] as const);

const CrosswalkCandidateSchema = z.object({
  data3DGuid: GrandHallCameraMetricGuidSchema,
  displayScanIndex: z.number().int().min(0).max(148),
  supported: z.boolean(),
});

const CrosswalkResultSchema = z.object({
  candidateData3DGuid: GrandHallCameraMetricGuidSchema.nullable(),
  candidates: z.array(CrosswalkCandidateSchema).min(1),
  display: z.object({
    relativePath: z.string().min(1),
    sweepNumber: z.number().int().min(1).max(149),
  }),
  humanReviewRequired: z.literal(true),
  panoramaSha256: GrandHallCameraMetricBareSha256Schema,
  state: z.union([z.literal("candidate_human_pending"), z.literal("ambiguous_human_pending")]),
});

const CrosswalkSourceSchema = z.object({
  authority: z.literal("none"),
  contract: z.object({
    cameraPoseAuthority: z.literal("none"),
    correspondenceAuthority: z.literal("candidate_feature_match_unverified"),
    roomMembershipAuthority: z.literal("none"),
    runtimeAuthority: z.literal(false),
    trainingAuthority: z.literal(false),
    transformAuthority: z.literal("none"),
  }),
  results: z.array(CrosswalkResultSchema).length(148),
  schemaVersion: z.literal(CROSSWALK_SCHEMA),
  sourceBindings: z.object({
    image2DManifest: z.object({
      sha256: GrandHallCameraMetricBareSha256Schema,
      sizeBytes: z.number().int().positive(),
    }),
  }),
});

const Image2dData3dSchema = z.object({
  guid: GrandHallCameraMetricGuidSchema,
  scanIndex: z.number().int().min(0).max(148),
});

const Image2dRecordSchema = z.object({
  associatedData3DGuid: GrandHallCameraMetricGuidSchema,
  blob: z.literal("jpegImage"),
  data3DIndex: z.number().int().min(0).max(148),
  decodedMode: z.literal("RGB"),
  faceIndex: z.number().int().min(0).max(5),
  focalLength: z.literal(0.5),
  height: z.literal(4_096),
  imageGuid: GrandHallCameraMetricGuidSchema,
  imageIndex: z.number().int().nonnegative(),
  imageName: z.string().min(1),
  pixelHeight: z.literal(0.000244140625),
  pixelWidth: z.literal(0.000244140625),
  principalPointX: z.literal(2_048),
  principalPointY: z.literal(2_048),
  relativePath: z.string().min(1),
  representation: z.literal("pinholeRepresentation"),
  sha256: GrandHallCameraMetricBareSha256Schema,
  sizeBytes: z.number().int().positive(),
  width: z.literal(4_096),
});

const Image2dSourceSchema = z.object({
  authority: z.literal("none"),
  contract: z.object({
    associationMethod: z.literal("exact_associatedData3DGuid"),
    cameraOrientationAuthority: z.literal("none"),
    panoramaCorrespondenceAuthority: z.literal("none"),
    runtimeAuthority: z.literal(false),
    trainingAuthority: z.literal(false),
  }),
  data3D: z.array(Image2dData3dSchema).length(149),
  images: z.array(Image2dRecordSchema).length(894),
  schemaVersion: z.literal(IMAGE2D_SCHEMA),
  source: z.object({
    e57Sha256: GrandHallCameraMetricBareSha256Schema,
    e57SizeBytes: z.literal(20_518_437_888),
  }),
  summary: z.object({
    data3DCount: z.literal(149),
    facesPerData3D: z.literal(6),
    image2DCount: z.literal(894),
  }),
});

const PosesSourceSchema = z.record(z.string().regex(/^(?:0|[1-9]\d*)$/u), GrandHallCameraMetricPoseSchema);

type CrosswalkSource = z.infer<typeof CrosswalkSourceSchema>;
type CrosswalkResult = z.infer<typeof CrosswalkResultSchema>;
type Image2dSource = z.infer<typeof Image2dSourceSchema>;
type PoseSource = z.infer<typeof PosesSourceSchema>;

export interface GrandHallCameraMetricSubsetInputs {
  readonly candidateCrosswalkIdentity: GrandHallCameraMetricSourceIdentity;
  readonly candidateCrosswalkDocument: unknown;
  readonly e57PosesIdentity: GrandHallCameraMetricSourceIdentity;
  readonly e57PosesCanonicalSha256: string;
  readonly e57PosesDocument: unknown;
  readonly e57Image2dIdentity: GrandHallCameraMetricSourceIdentity;
  readonly e57Image2dDocument: unknown;
}

export interface GrandHallCameraMetricSubsetFileOptions {
  readonly candidateCrosswalkPath: string;
  readonly e57PosesPath: string;
  readonly e57Image2dManifestPath: string;
}

export interface GrandHallCameraMetricSubsetWriteOptions extends GrandHallCameraMetricSubsetFileOptions {
  readonly outputPath: string;
}

function authorityGuards(): GrandHallCameraMetricAuthorityGuards {
  return GrandHallCameraMetricAuthorityGuardsSchema.parse({
    authority: "none",
    correspondenceAccepted: false,
    roomMembershipAccepted: false,
    externalPanoramaPoseAccepted: false,
    externalPanoramaOrientationAccepted: false,
    e57CubefaceOrientationBasisAccepted: false,
    e57ToObjTransformAccepted: false,
    e57ToXgridsTransformAccepted: false,
    grandHallPixelMaskAccepted: false,
    trainingInputPermitted: false,
    reconstructionInputPermitted: false,
    providerInputPermitted: false,
    runtimeInputPermitted: false,
    stagingPermitted: false,
    publicationPermitted: false,
    productionTrustPermitted: false,
    generatedContentUsed: false,
  });
}

function assertExactIdentity(
  actual: GrandHallCameraMetricSourceIdentity,
  expected: GrandHallCameraMetricSourceIdentity,
  label: string,
): void {
  if (
    actual.locator !== expected.locator ||
    actual.byteLength !== expected.byteLength ||
    actual.sha256 !== expected.sha256
  ) {
    throw new Error(`${label} does not match the frozen exact source identity.`);
  }
}

function assertSourceIdentities(inputs: GrandHallCameraMetricSubsetInputs): void {
  assertExactIdentity(
    inputs.candidateCrosswalkIdentity,
    GRAND_HALL_CAMERA_METRIC_EXPECTED_SOURCE_IDENTITIES.candidateCrosswalk,
    "Candidate crosswalk",
  );
  assertExactIdentity(
    inputs.e57PosesIdentity,
    GRAND_HALL_CAMERA_METRIC_EXPECTED_SOURCE_IDENTITIES.e57Poses,
    "E57 poses",
  );
  assertExactIdentity(
    inputs.e57Image2dIdentity,
    GRAND_HALL_CAMERA_METRIC_EXPECTED_SOURCE_IDENTITIES.e57Image2dManifest,
    "E57 Image2D manifest",
  );
  if (inputs.e57PosesCanonicalSha256 !== GRAND_HALL_CAMERA_METRIC_EXPECTED_SOURCE_IDENTITIES.e57Poses.canonicalPoseSha256) {
    throw new Error("E57 pose values do not match the frozen canonical pose identity.");
  }
}

function assertCompletePoseKeys(poses: PoseSource): void {
  const expected = Array.from({ length: 149 }, (_, index) => String(index));
  const actual = Object.keys(poses).sort((left, right) => Number(left) - Number(right));
  if (actual.length !== expected.length || actual.some((key, index) => key !== expected[index])) {
    throw new Error("The E57 pose document must contain exactly scan keys 0 through 148.");
  }
}

function selectedCrosswalkResult(
  source: CrosswalkSource,
  sweepNumber: number,
): CrosswalkResult {
  const rows = source.results.filter((row) => row.display.sweepNumber === sweepNumber);
  if (rows.length !== 1) {
    throw new Error(`Sweep ${String(sweepNumber)} must have exactly one crosswalk result.`);
  }
  return rows[0] as CrosswalkResult;
}

function assertSelectedCrosswalkCandidate(
  result: CrosswalkResult,
  expected: (typeof GRAND_HALL_CAMERA_METRIC_EXPECTED_MAPPINGS)[number],
): void {
  const matches = result.candidates.filter((candidate) => candidate.data3DGuid === result.candidateData3DGuid);
  const selected = matches[0];
  const supportedCount = result.candidates.filter((candidate) => candidate.supported).length;
  if (
    result.state !== "candidate_human_pending" ||
    result.display.relativePath !== `sweep_0${String(expected.sweepNumber)}jpg.jpg` ||
    result.panoramaSha256 !== expected.panoramaSha256 ||
    result.candidateData3DGuid !== expected.data3DGuid ||
    matches.length !== 1 ||
    selected?.displayScanIndex !== expected.scanIndex ||
    !selected.supported ||
    result.candidates.indexOf(selected) !== 0 ||
    supportedCount !== expected.supportedCandidateCount
  ) {
    throw new Error(`Sweep ${String(expected.sweepNumber)} crosswalk candidate drifted.`);
  }
}

function nativeFacesForScan(
  imageSource: Image2dSource,
  scanIndex: number,
  data3DGuid: string,
) {
  const data3dMatches = imageSource.data3D.filter((entry) => entry.scanIndex === scanIndex);
  if (data3dMatches.length !== 1 || data3dMatches[0]?.guid !== data3DGuid) {
    throw new Error(`E57 Data3D identity for scan ${String(scanIndex)} drifted.`);
  }
  const faces = imageSource.images
    .filter((image) => image.data3DIndex === scanIndex)
    .sort((left, right) => left.faceIndex - right.faceIndex);
  if (
    faces.length !== 6 ||
    faces.some((face, index) => face.faceIndex !== index || face.associatedData3DGuid !== data3DGuid)
  ) {
    throw new Error(`E57 scan ${String(scanIndex)} must have six exact associated cubefaces.`);
  }
  return faces;
}

function buildNativeCubefaces(
  imageSource: Image2dSource,
  scanIndex: number,
  data3DGuid: string,
) {
  return nativeFacesForScan(imageSource, scanIndex, data3DGuid).map((face) => ({
    faceIndex: face.faceIndex,
    imageIndex: face.imageIndex,
    imageGuid: face.imageGuid,
    imageName: face.imageName,
    relativePath: face.relativePath,
    sha256: `sha256:${face.sha256}`,
    byteLength: face.sizeBytes,
    mediaType: "image/jpeg" as const,
    widthPx: face.width,
    heightPx: face.height,
    decodedMode: face.decodedMode,
    representation: face.representation,
    blob: face.blob,
    focalLength: face.focalLength,
    pixelWidth: face.pixelWidth,
    pixelHeight: face.pixelHeight,
    principalPointX: face.principalPointX,
    principalPointY: face.principalPointY,
    associatedData3DGuid: face.associatedData3DGuid,
    orientationBasis: null,
    authority: "none" as const,
  }));
}

function buildSubsetRow(
  crosswalk: CrosswalkSource,
  poses: PoseSource,
  imageSource: Image2dSource,
  expected: (typeof GRAND_HALL_CAMERA_METRIC_EXPECTED_MAPPINGS)[number],
) {
  const result = selectedCrosswalkResult(crosswalk, expected.sweepNumber);
  assertSelectedCrosswalkCandidate(result, expected);
  const pose = poses[String(expected.scanIndex)];
  if (pose === undefined) throw new Error(`E57 scan ${String(expected.scanIndex)} pose is missing.`);
  return {
    state: GRAND_HALL_CAMERA_METRIC_SUBSET_STATE,
    authority: "none" as const,
    externalPanorama: {
      sweepNumber: expected.sweepNumber,
      relativePath: result.display.relativePath,
      sha256: `sha256:${result.panoramaSha256}`,
      cameraPosition: null,
      cameraOrientation: null,
      poseAuthority: "none" as const,
      orientationAuthority: "none" as const,
    },
    candidateCorrespondence: {
      state: "candidate_human_pending" as const,
      data3DGuid: expected.data3DGuid,
      displayScanIndex: expected.scanIndex,
      candidateRank: 1 as const,
      matcherSupportedCandidate: true as const,
      supportedCandidateCount: expected.supportedCandidateCount,
      caveat: expected.sweepNumber === 47
        ? "two_matcher_supported_candidates_human_review_required" as const : null,
      humanReviewRequired: true as const,
      authority: "none" as const,
    },
    e57Scanner: {
      scanIndex: expected.scanIndex,
      data3DGuid: expected.data3DGuid,
      coordinateFrame: "e57_local" as const,
      units: "metres" as const,
      rotationEncoding: "quaternion_wxyz" as const,
      translationM: pose.translation,
      rotationQuaternionWxyz: pose.rotation,
      sourceValueState: "exact_from_bound_e57_pose_document" as const,
      poseAuthority: "none" as const,
      orientationUseBlocked: true as const,
    },
    nativeCubefaces: buildNativeCubefaces(imageSource, expected.scanIndex, expected.data3DGuid),
    guards: authorityGuards(),
  };
}

function assertCrossSourceBinding(crosswalk: CrosswalkSource, imageSource: Image2dSource): void {
  const expected = GRAND_HALL_CAMERA_METRIC_EXPECTED_SOURCE_IDENTITIES.e57Image2dManifest;
  if (
    crosswalk.sourceBindings.image2DManifest.sha256 !== expected.sha256.slice("sha256:".length) ||
    crosswalk.sourceBindings.image2DManifest.sizeBytes !== expected.byteLength ||
    imageSource.source.e57Sha256 !== "975039d11fc04ca681f038e499f358124bbcab178ad5ce6324fa912212729cdd"
  ) {
    throw new Error("The T-560 crosswalk and T-559 Image2D evidence are not cross-bound as expected.");
  }
}

function sourceBindings(inputs: GrandHallCameraMetricSubsetInputs, imageSource: Image2dSource) {
  return {
    candidateCrosswalk: {
      ...inputs.candidateCrosswalkIdentity,
      schemaVersion: CROSSWALK_SCHEMA,
    },
    e57Poses: {
      ...inputs.e57PosesIdentity,
      canonicalPoseSha256: inputs.e57PosesCanonicalSha256,
      canonicalizationMethod: POSE_CANONICALIZATION_METHOD,
      coordinateFrame: "e57_local" as const,
      units: "metres" as const,
      rotationEncoding: "quaternion_wxyz" as const,
    },
    e57Image2dManifest: {
      ...inputs.e57Image2dIdentity,
      schemaVersion: IMAGE2D_SCHEMA,
      e57Sha256: `sha256:${imageSource.source.e57Sha256}`,
      e57ByteLength: imageSource.source.e57SizeBytes,
    },
  };
}

export function buildGrandHallCameraMetricSubsetMaterial(
  inputs: GrandHallCameraMetricSubsetInputs,
): GrandHallCameraMetricSubsetMaterial {
  assertSourceIdentities(inputs);
  const crosswalk = CrosswalkSourceSchema.parse(inputs.candidateCrosswalkDocument);
  const poses = PosesSourceSchema.parse(inputs.e57PosesDocument);
  const imageSource = Image2dSourceSchema.parse(inputs.e57Image2dDocument);
  assertCompletePoseKeys(poses);
  assertCrossSourceBinding(crosswalk, imageSource);
  const rows = GRAND_HALL_CAMERA_METRIC_EXPECTED_MAPPINGS.map((expected) =>
    buildSubsetRow(crosswalk, poses, imageSource, expected));
  return GrandHallCameraMetricSubsetMaterialSchema.parse({
    schemaVersion: GRAND_HALL_CAMERA_METRIC_SUBSET_SCHEMA,
    state: GRAND_HALL_CAMERA_METRIC_SUBSET_STATE,
    authority: "none",
    subject: {
      venueSlug: "trades-hall",
      roomSlug: "grand-hall",
      scope: "candidate_camera_metric_subset",
      includedExternalSweepNumbers: [41, 42, 43, 44, 45, 46, 47, 48],
      excludedExternalSweepNumbers: [49],
      sweep49Included: false,
    },
    sourceBindings: sourceBindings(inputs, imageSource),
    contract: authorityGuards(),
    blockers: [
      "native_grid_room_scope_review_incomplete",
      "panorama_e57_correspondence_human_review_incomplete",
      "external_panorama_orientation_unresolved",
      "e57_cubeface_orientation_basis_unaccepted",
      "grand_hall_pixel_masks_absent",
      "room_selection_volume_unaccepted",
      "e57_to_obj_transform_unreviewed",
      "e57_to_xgrids_transform_absent",
    ],
    rows,
    summary: {
      rowCount: 8,
      externalPanoramaCount: 8,
      e57ScanCount: 8,
      nativeCubefaceCount: 48,
      orientationReadyRowCount: 0,
      trainingEligibleRowCount: 0,
      reconstructionEligibleRowCount: 0,
      runtimeEligibleRowCount: 0,
      acceptedRowCount: 0,
    },
  });
}

function materialFromBundle(bundle: GrandHallCameraMetricSubset): GrandHallCameraMetricSubsetMaterial {
  const { bundleSha256: _bundleSha256, ...material } = bundle;
  return GrandHallCameraMetricSubsetMaterialSchema.parse(material);
}

function bundleDigest(material: GrandHallCameraMetricSubsetMaterial): string {
  return `sha256:${domainSeparatedSha256(
    GRAND_HALL_CAMERA_METRIC_SUBSET_DOMAIN,
    toCanonicalJson(material),
  )}`;
}

export function sealGrandHallCameraMetricSubset(
  material: GrandHallCameraMetricSubsetMaterial,
): GrandHallCameraMetricSubset {
  const parsed = GrandHallCameraMetricSubsetMaterialSchema.parse(material);
  return GrandHallCameraMetricSubsetSchema.parse({
    ...parsed,
    bundleSha256: bundleDigest(parsed),
  });
}

export function serializeGrandHallCameraMetricSubset(bundle: GrandHallCameraMetricSubset): Buffer {
  const parsed = GrandHallCameraMetricSubsetSchema.parse(bundle);
  return Buffer.from(`${stableCanonicalJson(toCanonicalJson(parsed))}\n`, "utf8");
}

export function parseGrandHallCameraMetricSubset(bytes: Buffer): GrandHallCameraMetricSubset {
  const parsed = GrandHallCameraMetricSubsetSchema.parse(parseGrandHallT554StrictJson(bytes));
  const material = materialFromBundle(parsed);
  if (parsed.bundleSha256 !== bundleDigest(material)) {
    throw new Error("Grand Hall camera/metric subset self-digest does not match its material.");
  }
  if (!serializeGrandHallCameraMetricSubset(parsed).equals(bytes)) {
    throw new Error("Grand Hall camera/metric subset bytes are not canonical.");
  }
  return parsed;
}

async function readExactBoundSource(
  path: string,
  expected: GrandHallCameraMetricSourceIdentity,
): Promise<{ readonly bytes: Buffer; readonly identity: GrandHallCameraMetricSourceIdentity }> {
  if (!isAbsolute(path)) throw new Error("Camera/metric source paths must be absolute.");
  const pathStat = await lstat(path);
  if (!pathStat.isFile() || pathStat.isSymbolicLink()) throw new Error("Camera/metric source must be a direct file.");
  const handle = await open(path, "r");
  try {
    const before = await handle.stat();
    const bytes = await handle.readFile();
    const after = await handle.stat();
    if (
      before.size !== after.size || before.mtimeMs !== after.mtimeMs || before.ctimeMs !== after.ctimeMs ||
      bytes.byteLength !== before.size
    ) {
      throw new Error("Camera/metric source changed during its stable read.");
    }
    const identity = {
      locator: expected.locator,
      byteLength: bytes.byteLength,
      sha256: `sha256:${createHash("sha256").update(bytes).digest("hex")}`,
    };
    assertExactIdentity(identity, expected, expected.locator);
    return { bytes, identity };
  } finally {
    await handle.close();
  }
}

export async function loadGrandHallCameraMetricSubsetInputsFromFiles(
  options: GrandHallCameraMetricSubsetFileOptions,
): Promise<GrandHallCameraMetricSubsetInputs> {
  const expected = GRAND_HALL_CAMERA_METRIC_EXPECTED_SOURCE_IDENTITIES;
  const [crosswalk, poses, image2d] = await Promise.all([
    readExactBoundSource(options.candidateCrosswalkPath, expected.candidateCrosswalk),
    readExactBoundSource(options.e57PosesPath, expected.e57Poses),
    readExactBoundSource(options.e57Image2dManifestPath, expected.e57Image2dManifest),
  ]);
  const canonicalPoses = canonicalizeT554PoseDocument(poses.bytes);
  return {
    candidateCrosswalkIdentity: crosswalk.identity,
    candidateCrosswalkDocument: parseGrandHallT554StrictJson(crosswalk.bytes),
    e57PosesIdentity: poses.identity,
    e57PosesCanonicalSha256: canonicalPoses.canonicalSha256,
    e57PosesDocument: canonicalPoses.posesJson,
    e57Image2dIdentity: image2d.identity,
    e57Image2dDocument: parseGrandHallT554StrictJson(image2d.bytes),
  };
}

export async function buildGrandHallCameraMetricSubsetFromFiles(
  options: GrandHallCameraMetricSubsetFileOptions,
): Promise<GrandHallCameraMetricSubset> {
  const inputs = await loadGrandHallCameraMetricSubsetInputsFromFiles(options);
  return sealGrandHallCameraMetricSubset(buildGrandHallCameraMetricSubsetMaterial(inputs));
}

function assertAbsoluteOutputPath(outputPath: string): void {
  if (!isAbsolute(outputPath)) throw new Error("Camera/metric output path must be absolute.");
}

export async function writeGrandHallCameraMetricSubset(
  options: GrandHallCameraMetricSubsetWriteOptions,
): Promise<GrandHallCameraMetricSubset> {
  assertAbsoluteOutputPath(options.outputPath);
  const parentStat = await lstat(dirname(options.outputPath));
  if (!parentStat.isDirectory() || parentStat.isSymbolicLink()) {
    throw new Error("Camera/metric output parent must be a direct existing directory.");
  }
  const bundle = await buildGrandHallCameraMetricSubsetFromFiles(options);
  const bytes = serializeGrandHallCameraMetricSubset(bundle);
  await writeFile(options.outputPath, bytes, { flag: "wx" });
  const persisted = await readFile(options.outputPath);
  const verified = parseGrandHallCameraMetricSubset(persisted);
  if (!persisted.equals(bytes)) throw new Error("Persisted camera/metric subset differs from generated bytes.");
  return verified;
}

export async function checkGrandHallCameraMetricSubset(
  options: GrandHallCameraMetricSubsetWriteOptions,
): Promise<GrandHallCameraMetricSubset> {
  assertAbsoluteOutputPath(options.outputPath);
  const expected = await buildGrandHallCameraMetricSubsetFromFiles(options);
  const expectedBytes = serializeGrandHallCameraMetricSubset(expected);
  const persistedBytes = await readFile(options.outputPath);
  const persisted = parseGrandHallCameraMetricSubset(persistedBytes);
  if (!persistedBytes.equals(expectedBytes)) {
    throw new Error("Persisted camera/metric subset is not the exact regeneration from bound sources.");
  }
  return persisted;
}

export interface GrandHallCameraMetricSubsetArguments extends GrandHallCameraMetricSubsetWriteOptions {
  readonly check: boolean;
}

export const GRAND_HALL_CAMERA_METRIC_SUBSET_USAGE = [
  "Usage:",
  "  tsx src/grand-hall-camera-metric-subset-entry.ts --crosswalk <absolute T-560 crosswalk> --poses <absolute poses.json> --image2d <absolute T-559 Image2D manifest> --out <new absolute JSON path>",
  "  tsx src/grand-hall-camera-metric-subset-entry.ts --check --crosswalk <absolute T-560 crosswalk> --poses <absolute poses.json> --image2d <absolute T-559 Image2D manifest> --out <existing absolute JSON path>",
].join("\n");

type CameraMetricPathFlag = "--crosswalk" | "--poses" | "--image2d" | "--out";

function isCameraMetricPathFlag(value: string | undefined): value is CameraMetricPathFlag {
  return value === "--crosswalk" || value === "--poses" || value === "--image2d" || value === "--out";
}

export function parseGrandHallCameraMetricSubsetArguments(
  args: readonly string[],
): GrandHallCameraMetricSubsetArguments {
  const values = new Map<string, string>();
  let check = false;
  for (let index = 0; index < args.length; index += 1) {
    const flag = args[index];
    if (flag === "--check") {
      if (check) throw new Error("Duplicate CLI option: --check.");
      check = true;
      continue;
    }
    if (!isCameraMetricPathFlag(flag)) {
      throw new Error(`Unknown CLI option: ${flag ?? "missing option"}.`);
    }
    const value = args[index + 1];
    if (value === undefined || value.startsWith("--")) throw new Error(`Missing value for ${flag}.`);
    if (values.has(flag)) throw new Error(`Duplicate CLI option: ${flag}.`);
    values.set(flag, value);
    index += 1;
  }
  const required = (flag: string): string => {
    const value = values.get(flag)?.trim();
    if (value === undefined || value.length === 0) throw new Error(`Missing required CLI option: ${flag}.`);
    return value;
  };
  return {
    candidateCrosswalkPath: required("--crosswalk"),
    e57PosesPath: required("--poses"),
    e57Image2dManifestPath: required("--image2d"),
    outputPath: required("--out"),
    check,
  };
}
