import {
  findReceptionReviewView,
  RECEPTION_REVIEW_VIEWS,
  type ReceptionReviewView,
} from "./reception-review-views.js";

export const EXPERIMENTAL_E57_CAMERA_NOTICE =
  "Experimental E57-matched camera · no physical approval";

const EXPERIMENTAL_QUERY_KEYS = [
  "camera",
  "lookAt",
  "up",
  "fov",
  "experimentalViewId",
] as const;

const STRICT_FINITE_NUMBER =
  /^-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?$/;
const SAFE_EXPERIMENT_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;
const RESERVED_EXPERIMENT_IDS = new Set(["__proto__", "constructor", "prototype"]);
const MAX_ABSOLUTE_COORDINATE = 100_000;
const MIN_FOV_DEGREES = 5;
const MAX_FOV_DEGREES = 120;
const MIN_VECTOR_LENGTH = 1e-8;
const MIN_NON_PARALLEL_SINE = 1e-6;

type Vector3Tuple = readonly [number, number, number];

function getExactlyOne(
  searchParams: URLSearchParams,
  key: (typeof EXPERIMENTAL_QUERY_KEYS)[number],
): string | null {
  const values = searchParams.getAll(key);
  return values.length === 1 ? values[0] ?? null : null;
}

function parseStrictFiniteNumber(raw: string): number | null {
  if (!STRICT_FINITE_NUMBER.test(raw)) return null;
  const value = Number(raw);
  return Number.isFinite(value) ? value : null;
}

function parseBoundedVector(raw: string): Vector3Tuple | null {
  const parts = raw.split(",");
  if (parts.length !== 3) return null;

  const parsed = parts.map(parseStrictFiniteNumber);
  if (
    parsed.some(
      (value) => value === null || Math.abs(value) > MAX_ABSOLUTE_COORDINATE,
    )
  ) {
    return null;
  }

  return parsed as [number, number, number];
}

function vectorLength(vector: Vector3Tuple): number {
  return Math.hypot(vector[0], vector[1], vector[2]);
}

function subtract(a: Vector3Tuple, b: Vector3Tuple): Vector3Tuple {
  return [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
}

function cross(a: Vector3Tuple, b: Vector3Tuple): Vector3Tuple {
  return [
    a[1] * b[2] - a[2] * b[1],
    a[2] * b[0] - a[0] * b[2],
    a[0] * b[1] - a[1] * b[0],
  ];
}

function isSafeExperimentId(value: string): boolean {
  return (
    SAFE_EXPERIMENT_ID.test(value) &&
    !RESERVED_EXPERIMENT_IDS.has(value.toLowerCase())
  );
}

/**
 * Parse one complete experimental camera group. Any missing, duplicated, or
 * invalid field rejects the whole group so a partial pose is never mixed with
 * a named review camera.
 */
export function parseExperimentalReceptionCamera(
  searchParams: URLSearchParams,
): ReceptionReviewView | null {
  if (!EXPERIMENTAL_QUERY_KEYS.some((key) => searchParams.has(key))) {
    return null;
  }

  const rawCamera = getExactlyOne(searchParams, "camera");
  const rawLookAt = getExactlyOne(searchParams, "lookAt");
  const rawUp = getExactlyOne(searchParams, "up");
  const rawFov = getExactlyOne(searchParams, "fov");
  const experimentalViewId = getExactlyOne(
    searchParams,
    "experimentalViewId",
  );
  if (
    rawCamera === null ||
    rawLookAt === null ||
    rawUp === null ||
    rawFov === null ||
    experimentalViewId === null ||
    !isSafeExperimentId(experimentalViewId)
  ) {
    return null;
  }

  const camera = parseBoundedVector(rawCamera);
  const lookAt = parseBoundedVector(rawLookAt);
  const up = parseBoundedVector(rawUp);
  const verticalFovDegrees = parseStrictFiniteNumber(rawFov);
  if (
    camera === null ||
    lookAt === null ||
    up === null ||
    verticalFovDegrees === null ||
    verticalFovDegrees < MIN_FOV_DEGREES ||
    verticalFovDegrees > MAX_FOV_DEGREES
  ) {
    return null;
  }

  const viewDirection = subtract(lookAt, camera);
  const viewLength = vectorLength(viewDirection);
  const upLength = vectorLength(up);
  if (viewLength <= MIN_VECTOR_LENGTH || upLength <= MIN_VECTOR_LENGTH) {
    return null;
  }

  const nonParallelSine =
    vectorLength(cross(viewDirection, up)) / (viewLength * upLength);
  if (
    !Number.isFinite(nonParallelSine) ||
    nonParallelSine <= MIN_NON_PARALLEL_SINE
  ) {
    return null;
  }

  return {
    id: `experimental-e57:${experimentalViewId}`,
    label: EXPERIMENTAL_E57_CAMERA_NOTICE,
    featureClass: "experimental E57 camera comparison only",
    camera,
    lookAt,
    up,
    verticalFovDegrees,
    near: 0.1,
    far: 120,
    experimentalViewId,
  };
}

/** Resolve the experimental group atomically, then fall back to a named view. */
export function resolveReceptionReviewView(
  searchParams: URLSearchParams,
): ReceptionReviewView {
  return (
    parseExperimentalReceptionCamera(searchParams) ??
    findReceptionReviewView(searchParams.get("view")) ??
    RECEPTION_REVIEW_VIEWS[0]
  );
}

export function buildReceptionCandidateComparisonSearch(
  candidateId: "quality" | "mobile",
  reviewView: ReceptionReviewView,
  captureOnly: boolean,
): string {
  const searchParams = new URLSearchParams({ candidate: candidateId });
  if (reviewView.experimentalViewId !== undefined && reviewView.up !== undefined) {
    searchParams.set("camera", reviewView.camera.join(","));
    searchParams.set("lookAt", reviewView.lookAt.join(","));
    searchParams.set("up", reviewView.up.join(","));
    searchParams.set("fov", String(reviewView.verticalFovDegrees));
    searchParams.set("experimentalViewId", reviewView.experimentalViewId);
  } else {
    searchParams.set("view", reviewView.id);
  }
  if (captureOnly) searchParams.set("capture", "1");
  return searchParams.toString();
}
