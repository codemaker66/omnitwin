export const GRAND_HALL_VISIBLE_FIRST_REPRESENTATIONS = ["sog", "spz", "ply"] as const;

export type GrandHallVisibleFirstRepresentation =
  (typeof GRAND_HALL_VISIBLE_FIRST_REPRESENTATIONS)[number];
export type GrandHallVisibleFirstCacheState = "cold" | "warm";

export interface GrandHallVisibleFirstCaptureRun {
  readonly ordinal: 1 | 2 | 3 | 4;
  readonly cacheState: GrandHallVisibleFirstCacheState;
  readonly cacheRunOrdinal: 1 | 2 | 3;
}

export const GRAND_HALL_VISIBLE_FIRST_CAPTURE_RUNS = Object.freeze([
  { ordinal: 1, cacheState: "cold", cacheRunOrdinal: 1 },
  { ordinal: 2, cacheState: "warm", cacheRunOrdinal: 1 },
  { ordinal: 3, cacheState: "warm", cacheRunOrdinal: 2 },
  { ordinal: 4, cacheState: "warm", cacheRunOrdinal: 3 },
] as const satisfies readonly GrandHallVisibleFirstCaptureRun[]);

export const GRAND_HALL_VISIBLE_FIRST_CAMERA_ID = "source-pose-19890-interior-v1";
export const GRAND_HALL_BROWSER_CACHE_EVIDENCE_PREFIX =
  "VENVIEWER_BROWSER_CACHE_STATE_V1:";

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
  return run.cacheState === "cold"
    ? "cold-run-1"
    : `warm-run-${String(run.cacheRunOrdinal)}`;
}

export function grandHallBrowserCacheEvidence(input: {
  readonly representation: GrandHallVisibleFirstRepresentation;
  readonly run: GrandHallVisibleFirstCaptureRun;
  readonly sourceRequestCountBefore: number;
  readonly sourceRequestCountAfter: number;
}): string {
  return `${GRAND_HALL_BROWSER_CACHE_EVIDENCE_PREFIX}${JSON.stringify({
    representation: input.representation,
    runOrdinal: input.run.ordinal,
    cacheState: input.run.cacheState,
    cacheRunOrdinal: input.run.cacheRunOrdinal,
    sourceRequestCountBefore: input.sourceRequestCountBefore,
    sourceRequestCountAfter: input.sourceRequestCountAfter,
    browserProcessScope: "one_representation_cold_plus_three_warm",
  })}`;
}

export function grandHallRadianceRankingEligible(
  representation: GrandHallVisibleFirstRepresentation,
): boolean {
  return representation === "sog" || representation === "spz";
}
