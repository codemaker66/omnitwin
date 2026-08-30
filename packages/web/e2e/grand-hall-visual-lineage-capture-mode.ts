import path from "node:path";

export const GRAND_HALL_DIFIX_CAPTURE_MODE =
  "difix-no-reference-input-1024x576-v1";
export const GRAND_HALL_DIFIX_CAPTURE_METHOD =
  "playwright_canvas_element_screenshot";
export const GRAND_HALL_DIFIX_CAPTURE_EVIDENCE_PREFIX =
  "VENVIEWER_CAPTURE_EVIDENCE_V1:";

export interface GrandHallLineageCaptureProfile {
  readonly difixNoReference: boolean;
  readonly viewport: { readonly width: number; readonly height: number };
  readonly warmupFrameCount: number;
  readonly frameSampleCount: number;
  readonly publication: "create_exclusive" | "replace_by_rename";
}

export function deriveGrandHallLineageCaptureProfile(
  requestedMode: string | undefined,
  defaultWarmupFrameCount: number,
  defaultFrameSampleCount: number,
): GrandHallLineageCaptureProfile {
  if (requestedMode !== undefined && requestedMode !== GRAND_HALL_DIFIX_CAPTURE_MODE) {
    throw new Error(`Unsupported GRAND_HALL_LINEAGE_CAPTURE_MODE ${JSON.stringify(requestedMode)}.`);
  }
  if (requestedMode === GRAND_HALL_DIFIX_CAPTURE_MODE) {
    return {
      difixNoReference: true,
      viewport: { width: 1_024, height: 576 },
      warmupFrameCount: 8,
      frameSampleCount: 1,
      publication: "create_exclusive",
    };
  }
  return {
    difixNoReference: false,
    viewport: { width: 1_600, height: 900 },
    warmupFrameCount: defaultWarmupFrameCount,
    frameSampleCount: defaultFrameSampleCount,
    publication: "replace_by_rename",
  };
}

export function requireDifixCapturePaths(
  profile: GrandHallLineageCaptureProfile,
  sourceRoot: string | undefined,
  evidenceDirectory: string | undefined,
): void {
  if (
    profile.difixNoReference
    && (
      sourceRoot === undefined
      || evidenceDirectory === undefined
      || !path.isAbsolute(sourceRoot)
      || !path.isAbsolute(evidenceDirectory)
    )
  ) {
    throw new Error(
      "The explicit Difix capture mode requires absolute GRAND_HALL_LINEAGE_ROOT and GRAND_HALL_LINEAGE_EVIDENCE_DIR paths.",
    );
  }
}

export function grandHallCaptureEvidenceLimitation(observed: {
  readonly canvasWidth: number;
  readonly canvasHeight: number;
  readonly devicePixelRatio: number;
  readonly contextAntialias: boolean | null;
}): string {
  return `${GRAND_HALL_DIFIX_CAPTURE_EVIDENCE_PREFIX}${JSON.stringify({
    method: GRAND_HALL_DIFIX_CAPTURE_METHOD,
    canvasWidth: observed.canvasWidth,
    canvasHeight: observed.canvasHeight,
    devicePixelRatio: observed.devicePixelRatio,
    contextAntialias: observed.contextAntialias,
    resizeApplied: false,
  })}`;
}
