import type {
  VisualLineageBenchmarkV0Input,
  VisualLineageCameraV0,
  VisualLineageRendererSettingsV0,
} from "@omnitwin/types";
import {
  GRAND_HALL_CAPTURED_SOG_MEMBERS,
  GRAND_HALL_CAPTURED_SOURCE,
  type GrandHallCapturedSourceMember,
} from "./grand-hall-captured-source.js";
import { GRAND_HALL_NAVIGATION_PROFILE } from "./grand-hall-navigation-profile.js";

/**
 * Immutable receipts for the matching highest-detail SPZ frontier. The
 * gaussian counts are the independently decoded per-member counts shared with
 * the SOG frontier; the byte sizes and hashes bind this distinct codec export.
 */
export const GRAND_HALL_CAPTURED_SPZ_MEMBERS = [
  {
    relativePath: "data/3dgs/0_0_0_1_0_1.spz",
    fileName: "0_0_0_1_0_1.spz",
    gaussianCount: 556_880,
    sizeBytes: 15_460_568,
    sha256: "1af334081d1ac617910878864bd6616a0207da10d887394036fe87480b5eaf0e",
  },
  {
    relativePath: "data/3dgs/0_1_0_1_0_0.spz",
    fileName: "0_1_0_1_0_0.spz",
    gaussianCount: 528_394,
    sizeBytes: 15_191_273,
    sha256: "b9a324d468c53372c6df62a12a07ef5c2da1ec1c9090f778b0540ecfab72b523",
  },
  {
    relativePath: "data/3dgs/0_2_0_0_1_1.spz",
    fileName: "0_2_0_0_1_1.spz",
    gaussianCount: 608_233,
    sizeBytes: 19_065_405,
    sha256: "b09eb2eb9b26208dbb2bb225d08d9903a396b769a3fa0ef9c8608cecd5adc1b6",
  },
  {
    relativePath: "data/3dgs/0_3_0_0_0_0.spz",
    fileName: "0_3_0_0_0_0.spz",
    gaussianCount: 604_745,
    sizeBytes: 18_594_343,
    sha256: "8e2d1423fb0194dc94a4b42156c761769bc8432195e51a45e0c416ebb09074c6",
  },
  {
    relativePath: "data/3dgs/0_3_0_1_0_1.spz",
    fileName: "0_3_0_1_0_1.spz",
    gaussianCount: 585_011,
    sizeBytes: 16_823_801,
    sha256: "642035d5f6ffb451e8247481030ab361316132f2f29ac89b6dde0cf93fdbee9a",
  },
  {
    relativePath: "data/3dgs/0_4_0_1_0_0.spz",
    fileName: "0_4_0_1_0_0.spz",
    gaussianCount: 514_640,
    sizeBytes: 14_952_500,
    sha256: "7571bd14ff3fef79457cce730bec5e1edc63d33799d36214d91d3e5ea12ba651",
  },
  {
    relativePath: "data/3dgs/0_5_0_0_0_1.spz",
    fileName: "0_5_0_0_0_1.spz",
    gaussianCount: 504_860,
    sizeBytes: 16_237_001,
    sha256: "6bcb6f5caccc9b0a7fe71c93d2365220c1ecc1251ea2a2ea99346041315d39c4",
  },
  {
    relativePath: "data/3dgs/0_5_0_1_0_1.spz",
    fileName: "0_5_0_1_0_1.spz",
    gaussianCount: 551_142,
    sizeBytes: 17_006_992,
    sha256: "9147dbc655a3a1ca6005623c129871d519471dad6a84cd7fd4fc09e40f1c6445",
  },
  {
    relativePath: "data/3dgs/0_6_0_0_0_1.spz",
    fileName: "0_6_0_0_0_1.spz",
    gaussianCount: 597_926,
    sizeBytes: 17_383_543,
    sha256: "e79fad848eb440838fac7dd8bf2c413fbfc6b7b6d9bb97bb2c1d0197990d9f72",
  },
  {
    relativePath: "data/3dgs/0_7_0_0_0_0.spz",
    fileName: "0_7_0_0_0_0.spz",
    gaussianCount: 524_982,
    sizeBytes: 15_120_618,
    sha256: "20d84bac9bc1db357f34c4c8fc5b8fd479832ce2caacdb6e477508c39c8d7d9f",
  },
  {
    relativePath: "data/3dgs/0_7_0_0_0_1.spz",
    fileName: "0_7_0_0_0_1.spz",
    gaussianCount: 442_871,
    sizeBytes: 12_579_316,
    sha256: "e45de1ac0d18831524dfa1255bec6c91d737fccbffb67c0de6024cc4bffedf66",
  },
] as const satisfies readonly GrandHallCapturedSourceMember[];

export const GRAND_HALL_PLY_SOURCE_MEMBER = {
  relativePath: "scans_BIG_MODEL_TH_GH_3/mesh-files/Grand_Hall.ply",
  sizeBytes: 1_185_642,
  sha256: "sha256:be8d7a47c021c4299c554d5e325740c06238c078da6fee72b884807e19528fea",
} as const;

/**
 * The position is source pose 19,890 transformed by the inspection transform.
 * Its look direction is deliberately not claimed as a calibrated source-camera
 * orientation: it points horizontally at the q05/q95 pose-envelope centre.
 */
export const GRAND_HALL_LINEAGE_CAMERA_SOURCE = {
  poseIndex: GRAND_HALL_NAVIGATION_PROFILE.inspectionCamera.sourcePose.index,
  timestamp: GRAND_HALL_NAVIGATION_PROFILE.inspectionCamera.sourcePose.timestamp,
  translation: GRAND_HALL_NAVIGATION_PROFILE.inspectionCamera.sourcePose.translation,
  rotation: GRAND_HALL_NAVIGATION_PROFILE.inspectionCamera.sourcePose.rotation,
  targetDerivation: GRAND_HALL_NAVIGATION_PROFILE.inspectionCamera.targetDerivation,
} as const;

export const GRAND_HALL_LINEAGE_CAMERA: VisualLineageCameraV0 = {
  id: "source-pose-19890-interior-v1",
  revision: 1,
  sourceFrame: "THREE_CAMERA",
  position: [
    GRAND_HALL_NAVIGATION_PROFILE.inspectionCamera.position[0],
    GRAND_HALL_NAVIGATION_PROFILE.inspectionCamera.position[1],
    GRAND_HALL_NAVIGATION_PROFILE.inspectionCamera.position[2],
  ],
  quaternion: [0, -0.01170873415725777, 0, 0.999931450422695],
  projection: "perspective",
  fov: GRAND_HALL_NAVIGATION_PROFILE.inspectionCamera.fov,
  near: GRAND_HALL_NAVIGATION_PROFILE.inspectionCamera.near,
  far: GRAND_HALL_NAVIGATION_PROFILE.inspectionCamera.far,
  aspect: 16 / 9,
  projectionMatrix: [
    0.9742785792574936, 0, 0, 0,
    0, 1.7320508075688774, 0, 0,
    0, 0, -1.0012507817385865, -1,
    0, 0, -0.10006253908692933, 0,
  ],
};

export const GRAND_HALL_LINEAGE_TARGET = GRAND_HALL_NAVIGATION_PROFILE.inspectionCamera.target;
export const GRAND_HALL_LINEAGE_INSPECTION_OFFSET = [
  4.74065113067626,
  2.84312653541565,
  -8.584035158157375,
] as const;

export const GRAND_HALL_PLY_RENDERER_SETTINGS = {
  renderer: "Three.js 0.180 / PLYLoader / MeshNormalMaterial",
  antialias: false,
  transparent: false,
  depthWrite: true,
  maxSplats: "not_applicable_structural_mesh",
  maxStdDev: "not_applicable_structural_mesh",
  minAlpha: "not_applicable_structural_mesh",
  preBlurAmount: "not_applicable_structural_mesh",
  blurAmount: "not_applicable_structural_mesh",
  focalAdjustment: "not_applicable_structural_mesh",
  toneMapping: "NoToneMapping",
  outputColorSpace: "srgb",
} as const satisfies VisualLineageRendererSettingsV0;

export type WebGlRendererClass = "hardware" | "software" | "unknown";

const SOFTWARE_WEBGL_MARKERS = [
  "swiftshader",
  "llvmpipe",
  "softpipe",
  "software rasterizer",
  "microsoft basic render driver",
  "mesa offscreen",
] as const;

const HARDWARE_WEBGL_MARKERS = [
  "nvidia",
  "geforce",
  "amd",
  "radeon",
  "intel",
  "apple gpu",
  "adreno",
  "qualcomm",
  "mali",
  "powervr",
] as const;

/** Classifies only explicit renderer evidence; generic strings stay unknown. */
export function classifyWebGlRenderer(vendor: string, renderer: string): WebGlRendererClass {
  const identity = `${vendor} ${renderer}`.toLowerCase();
  if (SOFTWARE_WEBGL_MARKERS.some((marker) => identity.includes(marker))) return "software";
  if (HARDWARE_WEBGL_MARKERS.some((marker) => identity.includes(marker))) return "hardware";
  return "unknown";
}

interface LineageCameraSnapshot {
  readonly position: readonly number[];
  readonly quaternion: readonly number[];
  readonly projectionMatrix: readonly number[];
  readonly fov: number | null;
  readonly near: number;
  readonly far: number;
}

function arraysNear(
  actual: readonly number[],
  expected: readonly number[],
  tolerance: number,
): boolean {
  return actual.length === expected.length
    && actual.every((value, index) => Math.abs(value - (expected[index] ?? Number.NaN)) <= tolerance);
}

/**
 * Enforces the complete fixed-camera contract. Quaternion sign is allowed to
 * flip because q and -q encode the same physical rotation.
 */
export function grandHallLineageCameraMatches(
  actual: LineageCameraSnapshot,
  tolerance = 1e-7,
): boolean {
  const expected = GRAND_HALL_LINEAGE_CAMERA;
  const quaternionMatches = arraysNear(actual.quaternion, expected.quaternion, tolerance)
    || arraysNear(actual.quaternion, expected.quaternion.map((value) => -value), tolerance);
  return arraysNear(actual.position, expected.position, tolerance)
    && quaternionMatches
    && arraysNear(actual.projectionMatrix, expected.projectionMatrix, tolerance)
    && actual.fov !== null
    && Math.abs(actual.fov - expected.fov) <= tolerance
    && Math.abs(actual.near - expected.near) <= tolerance
    && Math.abs(actual.far - expected.far) <= tolerance;
}

export const GRAND_HALL_LINEAGE_INITIAL_BENCHMARK = {
  schemaVersion: "visual-lineage-benchmark/v0",
  benchmarkId: "grand-hall-lineage-v0",
  roomRef: "trades-hall/grand-hall",
  gitSha: "4c7a34bd7bbe77d16bf36c4c82354737073a497a",
  worktreeDirty: true,
  camera: GRAND_HALL_LINEAGE_CAMERA,
  viewport: { width: 1600, height: 900, devicePixelRatio: 1 },
  rendererSettings: {
    renderer: "Three.js 0.180 / Spark 2.0",
    antialias: false,
    transparent: true,
    depthWrite: false,
    maxSplats: "asset_count_plus_one_exact_runtime; library_default_fixture",
    maxStdDev: "library_default",
    minAlpha: "library_default",
    preBlurAmount: "library_default",
    blurAmount: "library_default",
    focalAdjustment: "library_default",
    toneMapping: "NoToneMapping",
    outputColorSpace: "srgb",
  },
  representations: [
    {
      id: "native-lcc",
      format: "lcc",
      lineage: "Grand_Hall.lcc native XGRIDS representation",
      status: "not_run",
      visualAssessment: "not_reviewed",
      cameraRegistration: "unavailable",
      rendererProfile: "unavailable",
      sourceRefs: ["sha256:ce2a539483c7c2a271ca2555f6390e16425bb911851a8a56c2f16b17c248cac1"],
      limitations: ["Native matched-camera screenshot requires an independent LCC-capable viewer run."],
    },
    {
      id: "exact-sog-frontier",
      format: "sog",
      lineage: "Grand_Hall.lcc2 exact non-environment fine frontier",
      status: "not_run",
      visualAssessment: "not_reviewed",
      cameraRegistration: "inspection_only",
      rendererProfile: "diagnostic_unresolved_defaults",
      sourceRefs: [GRAND_HALL_CAPTURED_SOURCE.frontierReceiptSha256],
      limitations: [
        "The camera position is a transformed source trajectory sample, but its look direction and FOV remain inspection-only rather than source-calibrated.",
      ],
    },
    {
      id: "name-matched-spz-candidate",
      format: "spz",
      lineage: "Grand Hall XGRIDS SPZ candidate selected by matching frontier names",
      status: "not_run",
      visualAssessment: "not_reviewed",
      cameraRegistration: "inspection_only",
      rendererProfile: "diagnostic_unresolved_defaults",
      sourceRefs: ["local-source:scans_BIG_MODEL_TH_GH_4/lcc2-result/data/3dgs"],
      limitations: ["SPZ member receipt, export-lineage proof, and visual benchmark remain to be recorded."],
    },
    {
      id: "independent-viewer-sog",
      format: "sog",
      lineage: "Independent viewer rendering of the exact SOG frontier",
      status: "not_run",
      visualAssessment: "not_reviewed",
      cameraRegistration: "unavailable",
      rendererProfile: "unavailable",
      sourceRefs: [GRAND_HALL_CAPTURED_SOURCE.frontierReceiptSha256],
      limitations: ["Independent viewer and matched-camera workflow have not been selected or run."],
    },
    {
      id: "supplied-ply-mesh",
      format: "ply_mesh",
      lineage: "Supplied reconstructed triangle mesh",
      status: "not_run",
      visualAssessment: "not_reviewed",
      cameraRegistration: "inspection_only",
      rendererProfile: "controlled_explicit",
      sourceRefs: [GRAND_HALL_PLY_SOURCE_MEMBER.sha256],
      limitations: [
        "The supplied PLY is reconstructed structural geometry, not Gaussian or captured radiance data.",
        "Its deterministic normal colours are debug appearance derived at render time, not source appearance.",
        "Its broad extent and Grand Hall-only boundary remain unreviewed, so it is not admitted as room geometry.",
      ],
    },
    {
      id: "venviewer-exact-runtime",
      format: "venviewer",
      lineage: "T-540 authenticated atomic SOG runtime",
      status: "not_run",
      visualAssessment: "not_reviewed",
      cameraRegistration: "inspection_only",
      rendererProfile: "diagnostic_unresolved_defaults",
      sourceRefs: [GRAND_HALL_CAPTURED_SOURCE.frontierReceiptSha256],
      limitations: ["Authenticated runtime screenshot awaits local or staging package admission."],
    },
  ],
} as const satisfies VisualLineageBenchmarkV0Input;

function sourceUrls(format: "sog" | "spz", sourceBaseUrl: string): readonly string[] {
  const variant = format === "sog" ? "scans_BIG_MODEL_TH_GH_1" : "scans_BIG_MODEL_TH_GH_4";
  const members = format === "sog"
    ? GRAND_HALL_CAPTURED_SOG_MEMBERS
    : GRAND_HALL_CAPTURED_SPZ_MEMBERS;
  const base = sourceBaseUrl.endsWith("/") ? sourceBaseUrl : `${sourceBaseUrl}/`;
  return members.map((member) => (
    new URL(`${variant}/lcc2-result/data/3dgs/${member.fileName}`, base).toString()
  ));
}

function fixedCameraParams(): URLSearchParams {
  return new URLSearchParams({
    zUp: "1",
    offset: GRAND_HALL_LINEAGE_INSPECTION_OFFSET.join(","),
    cam: GRAND_HALL_LINEAGE_CAMERA.position.join(","),
    look: GRAND_HALL_LINEAGE_TARGET.join(","),
    fov: String(GRAND_HALL_LINEAGE_CAMERA.fov),
    near: String(GRAND_HALL_LINEAGE_CAMERA.near),
    far: String(GRAND_HALL_LINEAGE_CAMERA.far),
    dpr: "1",
    antialias: "0",
    fixed: "1",
  });
}

/** Dev-only local-source route used by the deterministic Playwright harness. */
export function grandHallLineageFixturePath(
  format: "sog" | "spz",
  sourceBaseUrl: string,
): string {
  const params = fixedCameraParams();
  params.set("splatUrl", sourceUrls(format, sourceBaseUrl).join(","));
  return `/dev/splat-fixture?${params.toString()}`;
}

/** Dev-only exact-byte structural PLY route using the identical inspection camera. */
export function grandHallPlyLineageFixturePath(sourceBaseUrl: string): string {
  const base = sourceBaseUrl.endsWith("/") ? sourceBaseUrl : `${sourceBaseUrl}/`;
  const params = fixedCameraParams();
  params.set("meshUrl", new URL(GRAND_HALL_PLY_SOURCE_MEMBER.relativePath, base).toString());
  return `/dev/splat-fixture?${params.toString()}`;
}
