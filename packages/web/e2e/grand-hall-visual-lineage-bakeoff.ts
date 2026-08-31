export const GRAND_HALL_VISIBLE_FIRST_REPRESENTATIONS = ["sog", "spz", "ply"] as const;

export type GrandHallVisibleFirstRepresentation =
  (typeof GRAND_HALL_VISIBLE_FIRST_REPRESENTATIONS)[number];
export type GrandHallVisibleFirstResidencyState = "cold_load" | "resident";

export type GrandHallVisibleFirstCaptureRun = Readonly<
  | { ordinal: 1; residencyState: "cold_load"; residencyRunOrdinal: 1 }
  | {
      ordinal: 2 | 3 | 4;
      residencyState: "resident";
      residencyRunOrdinal: 1 | 2 | 3;
    }
>;

export const GRAND_HALL_VISIBLE_FIRST_CAPTURE_RUNS = Object.freeze([
  { ordinal: 1, residencyState: "cold_load", residencyRunOrdinal: 1 },
  { ordinal: 2, residencyState: "resident", residencyRunOrdinal: 1 },
  { ordinal: 3, residencyState: "resident", residencyRunOrdinal: 2 },
  { ordinal: 4, residencyState: "resident", residencyRunOrdinal: 3 },
] as const satisfies readonly GrandHallVisibleFirstCaptureRun[]);

export const GRAND_HALL_VISIBLE_FIRST_CAMERA_ID = "source-pose-19890-interior-v1";
export const GRAND_HALL_BROWSER_SOURCE_RESIDENCY_EVIDENCE_PREFIX =
  "VENVIEWER_BROWSER_SOURCE_RESIDENCY_V1:";

export function parseGrandHallVisibleFirstRepresentation(
  value: string | undefined,
): GrandHallVisibleFirstRepresentation | undefined {
  if (value === undefined) return undefined;
  if (GRAND_HALL_VISIBLE_FIRST_REPRESENTATIONS.some((candidate) => candidate === value)) {
    return value as GrandHallVisibleFirstRepresentation;
  }
  throw new Error(
    `Unsupported GRAND_HALL_LINEAGE_REPRESENTATION ${JSON.stringify(value)}.`,
  );
}

export function grandHallVisibleFirstRunLabel(
  run: GrandHallVisibleFirstCaptureRun,
): string {
  return run.residencyState === "cold_load"
    ? "cold-load-1"
    : `resident-capture-${String(run.residencyRunOrdinal)}`;
}

export function grandHallVisibleFirstRequiresSourceNavigation(
  run: GrandHallVisibleFirstCaptureRun,
): boolean {
  return run.residencyState === "cold_load";
}

export function grandHallBrowserSourceResidencyEvidence(input: {
  readonly representation: GrandHallVisibleFirstRepresentation;
  readonly run: GrandHallVisibleFirstCaptureRun;
  readonly sourceRequestCountBefore: number;
  readonly sourceRequestCountAfter: number;
  readonly runtimeInstanceId: string;
  readonly renderedFrameCountBefore: number;
  readonly renderedFrameCountAfter: number;
}): string {
  return `${GRAND_HALL_BROWSER_SOURCE_RESIDENCY_EVIDENCE_PREFIX}${JSON.stringify({
    representation: input.representation,
    runOrdinal: input.run.ordinal,
    residencyState: input.run.residencyState,
    residencyRunOrdinal: input.run.residencyRunOrdinal,
    sourceRequestCountBefore: input.sourceRequestCountBefore,
    sourceRequestCountAfter: input.sourceRequestCountAfter,
    runtimeInstanceId: input.runtimeInstanceId,
    renderedFrameCountBefore: input.renderedFrameCountBefore,
    renderedFrameCountAfter: input.renderedFrameCountAfter,
    browserProcessScope: "one_representation_one_cold_load_plus_three_resident_captures",
  })}`;
}

export function grandHallRadianceRankingEligible(
  representation: GrandHallVisibleFirstRepresentation,
): boolean {
  return representation === "sog" || representation === "spz";
}
