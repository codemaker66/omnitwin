// ---------------------------------------------------------------------------
// Hold hygiene (T-491; Canon §3 — the wedge).
//
// Pure functions, no side effects, no clock reads.
//
// resequenceHolds: given the SURVIVING active holds of one space whose ranges
// overlapped a departed hold, reassign contiguous ranks from 1 preserving
// joint ties, and name everyone promoted to 1st option — the "MacLeod wedding
// is now 1st option — tell them" ping payload. The caller applies the rank
// changes in the same transaction as the exit and surfaces the promotions;
// notification delivery is P1.
//
// computeHoldReminderInstants: the T-7/T-3/T-1 schedule core. The reminder
// JOB (scheduler + Resend delivery) is deliberately NOT built in this slice —
// Canon §12 phases it into P1; this pure core exists so that job has a tested
// heart to call. Instant arithmetic (exact multiples of 24h) keeps the
// schedule stable across Europe/London DST folds.
// ---------------------------------------------------------------------------

export interface LadderHold {
  readonly id: string;
  readonly title: string;
  readonly ownerUserId: string | null;
  readonly rank: number | null;
  readonly jointFlag: boolean;
  readonly createdAt: Date;
}

export interface ResequenceChange {
  readonly id: string;
  readonly fromRank: number | null;
  readonly toRank: number;
}

export interface PromotedHold {
  readonly id: string;
  readonly title: string;
  readonly ownerUserId: string | null;
}

export interface ResequenceResult {
  readonly changes: readonly ResequenceChange[];
  readonly promotedToFirst: readonly PromotedHold[];
}

function ladderOrder(a: LadderHold, b: LadderHold): number {
  if (a.rank !== b.rank) {
    if (a.rank === null) return 1;
    if (b.rank === null) return -1;
    return a.rank - b.rank;
  }
  const byCreated = a.createdAt.getTime() - b.createdAt.getTime();
  if (byCreated !== 0) return byCreated;
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

/**
 * Reassign contiguous ladder ranks to the surviving holds of a contested
 * slot. Joint ties (equal original rank, every member joint-flagged) keep
 * sharing one rank; unranked holds join the back of the ladder by creation
 * time; same-rank holds NOT flagged joint are separated deterministically
 * (data repair). Deterministic for any input order.
 */
export function resequenceHolds(holds: readonly LadderHold[]): ResequenceResult {
  const sorted = [...holds].sort(ladderOrder);
  const changes: ResequenceChange[] = [];
  const promotedToFirst: PromotedHold[] = [];

  let nextRank = 1;
  let index = 0;
  while (index < sorted.length) {
    const current = sorted[index];
    if (current === undefined) break;

    // A joint group = consecutive holds sharing the same non-null original
    // rank where every member carries the joint flag.
    let groupEnd = index + 1;
    if (current.rank !== null && current.jointFlag) {
      while (groupEnd < sorted.length) {
        const candidate = sorted[groupEnd];
        if (
          candidate === undefined ||
          candidate.rank !== current.rank ||
          !candidate.jointFlag
        ) {
          break;
        }
        groupEnd += 1;
      }
    }

    for (let member = index; member < groupEnd; member += 1) {
      const holdRow = sorted[member];
      if (holdRow === undefined) continue;
      if (holdRow.rank !== nextRank) {
        changes.push({ id: holdRow.id, fromRank: holdRow.rank, toRank: nextRank });
      }
      if (nextRank === 1 && holdRow.rank !== 1) {
        promotedToFirst.push({
          id: holdRow.id,
          title: holdRow.title,
          ownerUserId: holdRow.ownerUserId,
        });
      }
    }

    nextRank += 1;
    index = groupEnd;
  }

  return { changes, promotedToFirst };
}

export interface WindowedLadderHold extends LadderHold {
  readonly startsAt: Date;
  readonly endsAt: Date;
}

/**
 * Component-scoped resequencing after a hold exits (review finding: pairwise
 * overlap with the departed hold is the WRONG ladder relation).
 *
 * The survivors of one space are clustered into connected components of
 * their own overlap graph (half-open intervals; touching edges contest
 * nothing and stay separate). Every component containing at least one member
 * that overlapped the departed window is one contested slot and is
 * resequenced independently from rank 1 — so an overlap CHAIN promotes
 * contiguously even when its tail never touched the departed hold, and two
 * clusters bridged only by the departed hold each gain their own 1st option.
 * Components in unrelated windows are untouched.
 */
export function resequenceLaddersAfterExit(
  survivors: readonly WindowedLadderHold[],
  departed: { readonly startsAt: Date; readonly endsAt: Date },
): ResequenceResult {
  const sorted = [...survivors].sort((a, b) => {
    const byStart = a.startsAt.getTime() - b.startsAt.getTime();
    if (byStart !== 0) return byStart;
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
  });
  const departedStart = departed.startsAt.getTime();
  const departedEnd = departed.endsAt.getTime();

  const changes: ResequenceChange[] = [];
  const promotedToFirst: PromotedHold[] = [];

  let clusterMembers: WindowedLadderHold[] = [];
  let clusterEnd = Number.NEGATIVE_INFINITY;
  let clusterTouchesDeparted = false;

  const flush = (): void => {
    if (clusterMembers.length === 0 || !clusterTouchesDeparted) return;
    const result = resequenceHolds(clusterMembers);
    changes.push(...result.changes);
    promotedToFirst.push(...result.promotedToFirst);
  };

  for (const survivor of sorted) {
    const startMs = survivor.startsAt.getTime();
    const endMs = survivor.endsAt.getTime();
    if (clusterMembers.length > 0 && startMs >= clusterEnd) {
      flush();
      clusterMembers = [];
      clusterEnd = Number.NEGATIVE_INFINITY;
      clusterTouchesDeparted = false;
    }
    clusterMembers.push(survivor);
    clusterEnd = Math.max(clusterEnd, endMs);
    if (startMs < departedEnd && departedStart < endMs) {
      clusterTouchesDeparted = true;
    }
  }
  flush();

  return { changes, promotedToFirst };
}

const DAY_MS = 24 * 60 * 60 * 1000;
const REMINDER_DAYS_BEFORE = [7, 3, 1] as const;

export interface HoldReminderInstant {
  readonly daysBefore: (typeof REMINDER_DAYS_BEFORE)[number];
  readonly at: Date;
}

/** T-7 / T-3 / T-1 reminder instants before a hold's decision date. The
 *  caller filters instants already in the past — this core has no clock. */
export function computeHoldReminderInstants(decisionAt: Date): readonly HoldReminderInstant[] {
  return REMINDER_DAYS_BEFORE.map((daysBefore) => ({
    daysBefore,
    at: new Date(decisionAt.getTime() - daysBefore * DAY_MS),
  }));
}
