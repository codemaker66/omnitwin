import {
  APPROVED_ROOM_RUNTIME_PRESENTATION_CONTRACT_SCHEMA_VERSION,
  CanonicalJsonValueSchema,
  buildApprovedRoomRuntimePresentationContract,
  runtimeGroupTransformMatchesMatrix,
  sha256Hex,
  stableCanonicalJson,
  type ApprovedRoomRuntimePresentationContract,
} from "@omnitwin/types";
import captureBinding from "./reception-capture-binding-v1.json";
import { CRANE_POSE, CRANE_WEIGHT_POLICY } from "./crane.js";
import {
  MIN_GAZE_DISTANCE_M,
  RECEPTION_DOLLY_STATIONS,
} from "./reception-dolly-path.js";
import { RECEPTION_FIXED_FINE_REVIEW_PROFILE } from "./reception-viewer-profile.js";

const CAMERA_PATH_DIGEST_DOMAIN = "venviewer.reception-camera-path.v1\u0000";

function canonical(value: unknown): string {
  return stableCanonicalJson(CanonicalJsonValueSchema.parse(value));
}

export const RECEPTION_LIVING_HALL_PRESENTATION_ROUTE = "/living-hall";
export const RECEPTION_DOLLY_APPROACH_RATE = 2.6;
export const RECEPTION_DOLLY_SETTLE_EPSILON = 0.0004;
export const RECEPTION_CAMERA_VERTICAL_FOV_DEGREES = 62;
export const RECEPTION_CAMERA_NEAR_PLANE_METRES = 0.05;
export const RECEPTION_CAMERA_FAR_PLANE_METRES = 150;

export const RECEPTION_SPLAT_GROUP_TRANSFORM = {
  position: [0, 0, 0],
  rotationEulerRadians: [-Math.PI / 2, 0, 0],
  uniformScale: 1,
} as const;

const CAMERA_PATH_MATERIAL = {
  policyVersion: "reception-scroll-dolly-v1",
  dollyStations: RECEPTION_DOLLY_STATIONS,
  minimumGazeDistanceMetres: MIN_GAZE_DISTANCE_M,
  dressingCranePose: CRANE_POSE,
  dressingCraneWeightPolicy: CRANE_WEIGHT_POLICY,
} as const;

export const RECEPTION_CAMERA_PATH_DIGEST = sha256Hex(
  `${CAMERA_PATH_DIGEST_DOMAIN}${canonical(CAMERA_PATH_MATERIAL)}`,
);

export const RECEPTION_RENDERER_PROFILE_DIGEST = sha256Hex(
  `${captureBinding.digestDomains.profile}${canonical(RECEPTION_FIXED_FINE_REVIEW_PROFILE)}`,
);

const initialCamera = RECEPTION_DOLLY_STATIONS[0];
if (initialCamera === undefined) {
  throw new Error("Reception presentation contract requires an initial dolly station.");
}

export const RECEPTION_LIVING_HALL_PRESENTATION_CONTRACT =
  buildApprovedRoomRuntimePresentationContract({
    schemaVersion: APPROVED_ROOM_RUNTIME_PRESENTATION_CONTRACT_SCHEMA_VERSION,
    groupTransform: {
      position: [...RECEPTION_SPLAT_GROUP_TRANSFORM.position],
      rotationEulerRadians: [...RECEPTION_SPLAT_GROUP_TRANSFORM.rotationEulerRadians],
      uniformScale: RECEPTION_SPLAT_GROUP_TRANSFORM.uniformScale,
    },
    cameraPolicy: {
      id: "reception-scroll-dolly-v1",
      route: RECEPTION_LIVING_HALL_PRESENTATION_ROUTE,
      pathDigest: RECEPTION_CAMERA_PATH_DIGEST,
      initialPosition: [...initialCamera.position],
      initialTarget: [...initialCamera.look],
      verticalFovDegrees: RECEPTION_CAMERA_VERTICAL_FOV_DEGREES,
      nearPlaneMetres: RECEPTION_CAMERA_NEAR_PLANE_METRES,
      farPlaneMetres: RECEPTION_CAMERA_FAR_PLANE_METRES,
      approachRatePerSecond: RECEPTION_DOLLY_APPROACH_RATE,
      settleEpsilon: RECEPTION_DOLLY_SETTLE_EPSILON,
      reducedMotionMode: "pin_to_scroll_position",
    },
    rendererProfile: {
      id: RECEPTION_FIXED_FINE_REVIEW_PROFILE.id,
      digest: RECEPTION_RENDERER_PROFILE_DIGEST,
    },
  });

if (!runtimeGroupTransformMatchesMatrix(
  RECEPTION_SPLAT_GROUP_TRANSFORM,
  RECEPTION_FIXED_FINE_REVIEW_PROFILE.expectedSplatMeshMatrixWorld,
)) {
  throw new Error("Reception group transform does not match its reviewed renderer profile.");
}

export function matchesReceptionLivingHallPresentationContract(
  contract: ApprovedRoomRuntimePresentationContract,
): boolean {
  return canonical(contract) === canonical(RECEPTION_LIVING_HALL_PRESENTATION_CONTRACT);
}
