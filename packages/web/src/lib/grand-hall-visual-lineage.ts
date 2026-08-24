import type {
  VisualLineageBenchmarkV0Input,
  VisualLineageCameraV0,
} from "@omnitwin/types";
import { GRAND_HALL_CAPTURED_SOG_MEMBERS, GRAND_HALL_CAPTURED_SOURCE } from "./grand-hall-captured-source.js";
import { GRAND_HALL_NAVIGATION_PROFILE } from "./grand-hall-navigation-profile.js";

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
      status: "unavailable",
      visualAssessment: "not_reviewed",
      cameraRegistration: "unavailable",
      rendererProfile: "unavailable",
      sourceRefs: ["sha256:be8d7a47c021c4299c554d5e325740c06238c078da6fee72b884807e19528fea"],
      limitations: ["The supplied PLY is a triangle mesh, not a Gaussian PLY representation."],
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
  const base = sourceBaseUrl.endsWith("/") ? sourceBaseUrl : `${sourceBaseUrl}/`;
  return GRAND_HALL_CAPTURED_SOG_MEMBERS.map((member) => {
    const fileName = format === "sog" ? member.fileName : member.fileName.replace(/\.sog$/u, ".spz");
    return new URL(`${variant}/lcc2-result/data/3dgs/${fileName}`, base).toString();
  });
}

/** Dev-only local-source route used by the deterministic Playwright harness. */
export function grandHallLineageFixturePath(
  format: "sog" | "spz",
  sourceBaseUrl: string,
): string {
  const params = new URLSearchParams({
    splatUrl: sourceUrls(format, sourceBaseUrl).join(","),
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
  return `/dev/splat-fixture?${params.toString()}`;
}
