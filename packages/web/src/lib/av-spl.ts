// ---------------------------------------------------------------------------
// av-spl — indicative speaker coverage + SPL planning (Epic 6 AV module).
//
// Models the three numbers that decide whether a PA covers an audience: how
// wide the pattern is at the listener plane, how loud it arrives, and whether
// that beats the room's ambient noise enough for clear speech.
//
// Formulas (standard planning approximations):
//   coverage width @ d = 2·d·tan(angle/2)
//   SPL falloff = 20·log10(d2/d1)  → −6 dB per distance doubling (free field)
//   speech SNR = SPL at listener − ambient noise
//
// SAFE: indicative only. Real directivity, room reflections, and
// gain-before-feedback vary; final voicing and intelligibility are set on-site.
// See AV_PLANNING_DISCLAIMER.
// ---------------------------------------------------------------------------

const DEG2RAD = Math.PI / 180;

/** Default speech-intelligibility target: SPL ≥ ambient + 10 dB. */
export const DEFAULT_SPEECH_SNR_TARGET_DB = 10;

/** Free-field SPL falloff between two distances, dB (positive = quieter). */
export function splFalloffDb(fromDistanceM: number, toDistanceM: number): number {
  const from = Math.max(0.1, fromDistanceM);
  const to = Math.max(0.1, toDistanceM);
  return 20 * Math.log10(to / from);
}

/** SPL at a distance given the rated max SPL @ 1 m. */
export function splAtDistanceDb(maxSplAt1mDb: number, distanceM: number): number {
  return maxSplAt1mDb - splFalloffDb(1, distanceM);
}

/** Coverage width on a plane at distance d for a horizontal pattern angle. */
export function coverageWidthM(distanceM: number, coverageAngleDeg: number): number {
  const d = Math.max(0, distanceM);
  const half = Math.max(0, Math.min(179, coverageAngleDeg)) / 2;
  return 2 * d * Math.tan(half * DEG2RAD);
}

export type SnrStatus = "good" | "marginal" | "poor";

/** Speech-SNR verdict: good (≥ target), marginal (audible but under target), poor (below ambient). */
export function speechSnrStatus(snrDb: number, targetDb: number): SnrStatus {
  if (snrDb >= targetDb) return "good";
  if (snrDb > 0) return "marginal";
  return "poor";
}

export interface AvInput {
  /** Rated max SPL at 1 m, dB. */
  readonly maxSplAt1mDb: number;
  /** Horizontal coverage angle, degrees. */
  readonly coverageAngleDeg: number;
  /** Distance to the listener plane (throw), metres. */
  readonly listenerDistanceM: number;
  /** Ambient noise level the planner entered/measured, dB. */
  readonly ambientDb: number;
  /** Speech-SNR target above ambient, dB (default 10). */
  readonly targetSnrDb?: number;
}

export interface AvCoverage {
  readonly splAtListenerDb: number;
  readonly coverageWidthM: number;
  readonly ambientDb: number;
  readonly speechSnrDb: number;
  readonly targetSnrDb: number;
  readonly meetsTarget: boolean;
  readonly snrStatus: SnrStatus;
}

/** Build the indicative coverage plan for one speaker/zone. Pure. */
export function buildAvCoverage(input: AvInput): AvCoverage {
  const targetSnrDb = input.targetSnrDb !== undefined && input.targetSnrDb >= 0 ? input.targetSnrDb : DEFAULT_SPEECH_SNR_TARGET_DB;
  const splAtListenerDb = splAtDistanceDb(input.maxSplAt1mDb, input.listenerDistanceM);
  const speechSnrDb = splAtListenerDb - input.ambientDb;
  return {
    splAtListenerDb,
    coverageWidthM: coverageWidthM(input.listenerDistanceM, input.coverageAngleDeg),
    ambientDb: input.ambientDb,
    speechSnrDb,
    targetSnrDb,
    meetsTarget: speechSnrDb >= targetSnrDb,
    snrStatus: speechSnrStatus(speechSnrDb, targetSnrDb),
  };
}

export const AV_PLANNING_DISCLAIMER =
  "Indicative SPL and coverage from planning approximations (−6 dB per distance doubling, free field). Real "
  + "directivity, room acoustics, and gain-before-feedback vary; final voicing and intelligibility are confirmed "
  + "on-site by the audio team.";
