// -----------------------------------------------------------------------------
// What he notices about YOU.
//
// The reactions in convener-lines.ts answer WHAT you chose. These answer HOW
// you chose it — that you rushed, that you sat a long while, that you keep
// reaching for the same place on the table, that you have stood here before.
// A narrator who only responds to your choices is a lookup table. One who
// remarks on your manner is a character.
//
// Two rules keep this charm rather than nagging:
//
//   Each observation fires AT MOST ONCE per run, and only a few land in any
//   playthrough. A remark arriving every question is a mechanic; one arriving
//   twice in twelve scenes is a man paying attention. A sixth observation —
//   noticing a visitor who used all four seats early — was written and then
//   cut: the test proved it fired on completely ordinary play, and an
//   observation that is not rare is not an observation.
//
//   None of them judges the answer. He may notice your manner. He may not
//   grade your choice — that would turn a sorting into a test, and would tip
//   the scale the whole axis model exists to keep hidden.
//
// Pure: no storage, no clock, no DOM. Callers pass what they observed.
// -----------------------------------------------------------------------------

export type ObservationId =
  | "returning"
  | "quick"
  | "lingerer"
  | "sameSeat"
  | "skipper";

export interface Observation {
  readonly id: ObservationId;
  readonly text: string;
}

/** Everything he could have noticed by the moment an answer is committed. */
export interface PlayRecord {
  /** Milliseconds spent on each answered scene, oldest first. */
  readonly answerMs: readonly number[];
  /** Which of the four seats was taken, per answered scene. */
  readonly seats: readonly number[];
  /** How many times the visitor cut him off mid-line. */
  readonly skips: number;
  /** Completed runs BEFORE this one. */
  readonly priorRuns: number;
}

// Thresholds are deliberately generous. A remark that fires on ordinary play
// stops being a remark; each of these should feel like being caught at
// something, not like tripping a sensor.
const QUICK_MS = 4_500;
const QUICK_STREAK = 3;
const LINGER_MS = 32_000;
const SAME_SEAT_RUN = 4;
const SKIPS_BEFORE_HE_MENTIONS_IT = 3;

/** He notices your manner, never grades your answer. */
const LINES: Readonly<Record<ObservationId, string>> = {
  returning:
    "Ye've stood here before. I remember the shape o' ye. Let's see whether ye've changed yer mind or just yer mood.",
  quick:
    "Ye answer fast. That's nae fault — some folk ken themselves early. Just dinnae mistake speed for certainty.",
  lingerer:
    "Ye sat a long while wi' that one. Good. The quick answer is usually somebody else's answer, borrowed.",
  sameSeat:
    "Ye keep reaching for the same place on the table. I'm no' judging ye. I'm just saying I noticed.",
  skipper:
    "Ye keep cutting me off. Fine. I'll talk faster — I've only had four hundred years tae practise.",
};

/** True when the last `run` seats are all the same. */
function endsWithSameSeatRun(seats: readonly number[], run: number): boolean {
  if (seats.length < run) return false;
  const tail = seats.slice(-run);
  const [first] = tail;
  return first !== undefined && tail.every((seat) => seat === first);
}

/** True when the last `n` answers were each under `ms`. */
function endsWithQuickStreak(answerMs: readonly number[], n: number, ms: number): boolean {
  if (answerMs.length < n) return false;
  return answerMs.slice(-n).every((taken) => taken < ms);
}

/**
 * The one remark worth making right now, or null — which is the common case,
 * and the point. `spent` carries the ids already used this run so nothing
 * repeats. Order below is priority order: only ever one remark per answer.
 */
export function observePlay(
  record: PlayRecord,
  spent: ReadonlySet<ObservationId>,
): Observation | null {
  const { answerMs, seats, skips, priorRuns } = record;
  const answered = answerMs.length;

  const pick = (id: ObservationId): Observation | null =>
    spent.has(id) ? null : { id, text: LINES[id] };

  // Greeted on the FIRST answer only: acknowledging a returning visitor halfway
  // through reads as the page having only just checked, which is worse than
  // never noticing at all.
  if (priorRuns > 0 && answered === 1) {
    const hit = pick("returning");
    if (hit !== null) return hit;
  }

  // Being cut off is the loudest signal a visitor can send, so it outranks the
  // rest — he should answer an interruption before remarking on seating habits.
  if (skips >= SKIPS_BEFORE_HE_MENTIONS_IT) {
    const hit = pick("skipper");
    if (hit !== null) return hit;
  }

  // A single long pause is more distinctive than an average, and deserves
  // recognition on the very answer it happened to.
  const last = answerMs[answered - 1];
  if (last !== undefined && last >= LINGER_MS) {
    const hit = pick("lingerer");
    if (hit !== null) return hit;
  }

  if (endsWithSameSeatRun(seats, SAME_SEAT_RUN)) {
    const hit = pick("sameSeat");
    if (hit !== null) return hit;
  }

  if (endsWithQuickStreak(answerMs, QUICK_STREAK, QUICK_MS)) {
    const hit = pick("quick");
    if (hit !== null) return hit;
  }

  return null;
}

/** Every line he can say about you — the corpus the voice generator reads. */
export const CONVENER_OBSERVATIONS: readonly string[] = Object.values(LINES);
