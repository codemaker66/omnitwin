export type Vec3Tuple = readonly [number, number, number];

export interface GrandHallProxyBox {
  readonly id: string;
  readonly center: Vec3Tuple;
  readonly size: Vec3Tuple;
  readonly claim: "source_extent_not_room_shell";
}

const FRONTIER_WORLD_MIN: Vec3Tuple = [-7.95813846588134, 0, -11.276255369186426];
const FRONTIER_WORLD_MAX: Vec3Tuple = [7.95813846588134, 10.33311295509338, 11.276255369186424];
const POSE_CENTRE_WORLD_MIN: Vec3Tuple = [-4.28351186932374, 1.51073853541565, -9.840649158157376];
const POSE_CENTRE_WORLD_MAX: Vec3Tuple = [4.599439130676259, 4.82764553541565, 9.456960841842625];
const FLOOR_CANDIDATE_WORLD_Y = 0.6431265354156497;

/**
 * Diagnostic navigation facts derived from the supplied XGRIDS LCC2 poses,
 * the exact SOG frontier bounds, and the supplied reconstructed OBJ. None of
 * these values is promoted to a reviewed room transform or collision surface.
 */
export const GRAND_HALL_NAVIGATION_PROFILE_PAYLOAD = {
  schemaVersion: "grand-hall-navigation-profile/v0",
  truthClass: "RECONSTRUCTED",
  capturedFrontier: {
    receiptSha256: "sha256:8e7514e75aa19345dda1955f2cee3f9369339c553c2711c084cd04be4c9c1352",
    gaussianCount: 6_019_684,
    memberCount: 11,
  },
  source: {
    poseCount: 21_417,
    sha256: "sha256:7a020e5f1cc00029ce773d1f448804fa1b7f16355412b023320975122556418d",
    coordinateSystem: "xgrids_lcc2_source_z_up",
    percentileEnvelope: "q05_q95",
  },
  reconstructedMesh: {
    sha256: "sha256:ba5aa3d2c244acca3937505a17b34fb7f437ef5f59b7a85e7e691a2b2bcd47b6",
    vertexCount: 34_040,
    triangleCount: 59_763,
  },
  frontierBounds: { min: FRONTIER_WORLD_MIN, max: FRONTIER_WORLD_MAX },
  poseCentreBounds: { min: POSE_CENTRE_WORLD_MIN, max: POSE_CENTRE_WORLD_MAX },
  navigationBounds: {
    min: [POSE_CENTRE_WORLD_MIN[0], FLOOR_CANDIDATE_WORLD_Y, POSE_CENTRE_WORLD_MIN[2]],
    max: [POSE_CENTRE_WORLD_MAX[0], FLOOR_CANDIDATE_WORLD_Y + 3, POSE_CENTRE_WORLD_MAX[2]],
  },
  floorCandidate: {
    sourceZ: -2.2,
    worldY: FLOOR_CANDIDATE_WORLD_Y,
    derivation: "dominant_reconstructed_mesh_vertex_band_candidate",
    reviewStatus: "unreviewed",
  },
  diagnosticSpawn: {
    sourcePoseIndex: 850,
    position: [0.29488213067625946, FLOOR_CANDIDATE_WORLD_Y + 1.65, -0.9009311581573751],
    reviewStatus: "unreviewed",
  },
  inspectionCamera: {
    sourcePose: {
      index: 19_890,
      timestamp: "1780223098.347440958",
      translation: [-4.774913, -16.59914, -0.687065],
      rotation: [-0.048216, 0.041399, -0.623453, 0.779274],
    },
    position: [-0.03426186932373998, 2.15606153541565, 8.015104841842623],
    target: [
      (POSE_CENTRE_WORLD_MIN[0] + POSE_CENTRE_WORLD_MAX[0]) / 2,
      2.15606153541565,
      (POSE_CENTRE_WORLD_MIN[2] + POSE_CENTRE_WORLD_MAX[2]) / 2,
    ],
    targetDerivation: "pose_q05_q95_horizontal_centre_at_source_pose_height",
    fov: 60,
    near: 0.05,
    far: 80,
    reviewStatus: "source_position_derived_inspection_only",
  },
  eyeHeightM: 1.65,
  capsuleRadiusM: 0.3,
  movementSpeedMps: 2,
  humanCamera: {
    fov: 60,
    near: 0.05,
    far: 80,
  },
  limitations: [
    "Captured-pose envelope only; not a wall, portal, floor, or collision claim.",
    "The floor datum is a reconstructed mesh candidate and awaits human review.",
  ],
} as const;

/** SHA-256 of JSON.stringify(GRAND_HALL_NAVIGATION_PROFILE_PAYLOAD). */
export const GRAND_HALL_NAVIGATION_PROFILE_SHA256 = "sha256:1b2143281bd416392b88a65332471193b02464a336e38e23f47143bb53530782";

export const GRAND_HALL_NAVIGATION_PROFILE = {
  ...GRAND_HALL_NAVIGATION_PROFILE_PAYLOAD,
  profileSha256: GRAND_HALL_NAVIGATION_PROFILE_SHA256,
} as const;

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

/** Source-envelope containment for internal camera QA; never export authority. */
export function clampGrandHallHumanPosition(position: Vec3Tuple): Vec3Tuple {
  const { min, max } = GRAND_HALL_NAVIGATION_PROFILE.navigationBounds;
  const inset = GRAND_HALL_NAVIGATION_PROFILE.capsuleRadiusM;
  return [
    clamp(position[0], min[0] + inset, max[0] - inset),
    GRAND_HALL_NAVIGATION_PROFILE.floorCandidate.worldY
      + GRAND_HALL_NAVIGATION_PROFILE.eyeHeightM,
    clamp(position[2], min[2] + inset, max[2] - inset),
  ];
}

export function isInsideGrandHallDiagnosticBounds(position: Vec3Tuple): boolean {
  const clamped = clampGrandHallHumanPosition(position);
  return Math.abs(position[0] - clamped[0]) <= 1e-8
    && Math.abs(position[1] - clamped[1]) <= 1e-8
    && Math.abs(position[2] - clamped[2]) <= 1e-8;
}

function proxyBox(id: string, min: Vec3Tuple, max: Vec3Tuple): GrandHallProxyBox {
  return {
    id,
    center: [
      (min[0] + max[0]) / 2,
      (min[1] + max[1]) / 2,
      (min[2] + max[2]) / 2,
    ],
    size: [max[0] - min[0], max[1] - min[1], max[2] - min[2]],
    claim: "source_extent_not_room_shell",
  };
}

export function grandHallStructuralProxyBoxes(): readonly GrandHallProxyBox[] {
  return [
    proxyBox("captured-fine-frontier-envelope", FRONTIER_WORLD_MIN, FRONTIER_WORLD_MAX),
    proxyBox("captured-pose-centre-envelope", POSE_CENTRE_WORLD_MIN, POSE_CENTRE_WORLD_MAX),
  ];
}
