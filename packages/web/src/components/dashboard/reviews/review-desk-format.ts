import type { ConfigurationReviewStatus } from "@omnitwin/types";
import type { PendingReviewEntry, ReviewHistoryEntry } from "../../../api/configuration-reviews.js";
import { relativeAge, venueCalendarDate, venueSince, type StageTone, type SummaryPart } from "../enquiries/enquiry-desk-format.js";

// ---------------------------------------------------------------------------
// Words and orderings for the Layout reviews desk (roadmap X2).
//
// A submission waits in one of three stages: for a reviewer to start it, in
// review with the colleague who started it, or back with its planner for
// changes. The desk counts and lists them in that order, the longest-waiting
// first, and says everything in the venue's own time.
// ---------------------------------------------------------------------------

export const REVIEW_STAGES = ["to_start", "in_review", "with_planner"] as const;
export type ReviewStage = (typeof REVIEW_STAGES)[number];
export type ReviewFilter = ReviewStage | "all";

const STAGE_OF: Readonly<Partial<Record<ConfigurationReviewStatus, ReviewStage>>> = {
  submitted: "to_start",
  under_review: "in_review",
  changes_requested: "with_planner",
};

interface StageWords {
  readonly label: string;
  readonly tone: StageTone;
  readonly count: readonly [singular: string, plural: string];
}

const STAGE_WORDS: Readonly<Record<ReviewStage, StageWords>> = {
  to_start: { label: "To start", tone: "new", count: ["layout to start", "layouts to start"] },
  in_review: { label: "In review", tone: "review", count: ["layout in review", "layouts in review"] },
  with_planner: { label: "With planner", tone: "other", count: ["layout with its planner", "layouts with their planners"] },
};

/** The desk's stage for a review status, or null for one that has left the queue. */
export function reviewStage(status: ConfigurationReviewStatus): ReviewStage | null {
  return STAGE_OF[status] ?? null;
}

export function stageLabel(stage: ReviewStage): string {
  return STAGE_WORDS[stage].label;
}

export function stageTone(stage: ReviewStage): StageTone {
  return STAGE_WORDS[stage].tone;
}

/** "1 layout to start", "3 layouts in review". */
export function stagePhrase(count: number, stage: ReviewStage): string {
  const [singular, plural] = STAGE_WORDS[stage].count;
  return `${count.toLocaleString("en-GB")} ${count === 1 ? singular : plural}`;
}

/** Where a review stands, as words for a sentence. */
export const STATUS_IN_WORDS: Readonly<Record<ConfigurationReviewStatus, string>> = {
  draft: "back with the planner as a draft",
  submitted: "waiting for a reviewer",
  under_review: "under review",
  approved: "approved",
  rejected: "rejected",
  changes_requested: "back with the planner for changes",
  withdrawn: "withdrawn",
  archived: "archived",
};

/** Since when a review has waited in its stage. */
export function waitingSince(entry: PendingReviewEntry): string {
  return entry.stageSince ?? entry.submittedAt ?? entry.updatedAt;
}

export type StageCounts = Readonly<Record<ReviewStage, number>>;

export function countStages(entries: readonly PendingReviewEntry[]): StageCounts {
  const counts: Record<ReviewStage, number> = { to_start: 0, in_review: 0, with_planner: 0 };
  for (const entry of entries) {
    const stage = reviewStage(entry.reviewStatus);
    if (stage !== null) counts[stage] += 1;
  }
  return counts;
}

/** The queue in the desk's order: by stage, then the longest-waiting first. */
export function orderQueue(entries: readonly PendingReviewEntry[], filter: ReviewFilter): PendingReviewEntry[] {
  const rank = (entry: PendingReviewEntry): number => {
    const stage = reviewStage(entry.reviewStatus);
    return stage === null ? REVIEW_STAGES.length : REVIEW_STAGES.indexOf(stage);
  };
  return entries
    .filter((entry) => filter === "all" || reviewStage(entry.reviewStatus) === filter)
    .map((entry, index) => ({ entry, index, since: Date.parse(waitingSince(entry)) }))
    .sort((a, b) => rank(a.entry) - rank(b.entry)
      || (Number.isFinite(a.since) && Number.isFinite(b.since) ? a.since - b.since : 0)
      || a.index - b.index)
    .map(({ entry }) => entry);
}

export interface QueueGroup {
  readonly stage: ReviewStage;
  readonly rows: readonly PendingReviewEntry[];
}

/** Consecutive rows of one stage; the queue is ordered by stage, so each stage is one group. */
export function groupQueue(rows: readonly PendingReviewEntry[]): QueueGroup[] {
  const groups: { stage: ReviewStage; rows: PendingReviewEntry[] }[] = [];
  for (const row of rows) {
    const stage = reviewStage(row.reviewStatus);
    if (stage === null) continue;
    const last = groups.at(-1);
    if (last !== undefined && last.stage === stage) last.rows.push(row);
    else groups.push({ stage, rows: [row] });
  }
  return groups;
}

/** The event's calendar date in the venue, for the date tile, or null. */
export function eventCalendarDate(entry: PendingReviewEntry): string | null {
  return entry.eventStartsAt === null ? null : venueCalendarDate(entry.eventStartsAt);
}

/** "Grand Hall · 120 guests · Planned by Fiona Grant": what a reviewer weighs a layout by. */
export function queueDetails(entry: PendingReviewEntry): string[] {
  const details: string[] = [];
  if (entry.spaceName !== null) details.push(entry.spaceName);
  details.push(`${entry.guestCount.toLocaleString("en-GB")} ${entry.guestCount === 1 ? "guest" : "guests"}`);
  if (entry.plannerName !== null) details.push(`Planned by ${entry.plannerName}`);
  return details;
}

/** The move that put a review in the stage it is in, from its timeline. */
function stageMove(status: ConfigurationReviewStatus, history: readonly ReviewHistoryEntry[] | null): ReviewHistoryEntry | null {
  if (history === null) return null;
  for (let index = history.length - 1; index >= 0; index -= 1) {
    const entry = history[index];
    if (entry?.toStatus === status) return entry;
  }
  return null;
}

/** Who has the review, and since when: "In review with Catherine since 10:14",
 *  or "with you" when it is the reader's. The timeline, once read, is fresher
 *  than the list. */
export function claimLine(
  entry: PendingReviewEntry,
  history: readonly ReviewHistoryEntry[] | null,
  nowMs: number,
  readerName: string | null = null,
): string | null {
  const move = stageMove(entry.reviewStatus, history);
  const sinceIso = move?.createdAt ?? waitingSince(entry);
  const named = move === null ? entry.stageByName : move.changedByName;
  const by = named !== null && readerName !== null && named === readerName ? "you" : named;
  const since = venueSince(sinceIso, nowMs);
  const at = since === null ? "" : ` since ${since}`;
  switch (entry.reviewStatus) {
    case "submitted":
      return `Waiting for a reviewer${at}`;
    case "under_review":
      return by === null ? `In review${at}` : `In review with ${by}${at}`;
    case "changes_requested":
      return `With ${entry.plannerName ?? "the planner"} for changes${at}`;
    default:
      return null;
  }
}

/** How long a row has waited in its stage: "3 hours ago". */
export function queueAge(entry: PendingReviewEntry, nowMs: number): string | null {
  return relativeAge(waitingSince(entry), nowMs);
}

/** One timeline entry as a sentence, naming who acted when the record does. */
export function timelineSentence(entry: ReviewHistoryEntry): string {
  const by = entry.changedByName;
  switch (entry.toStatus) {
    case "submitted":
      return by === null ? "Submitted for review." : `${by} submitted it for review.`;
    case "under_review":
      return by === null ? "The review was started." : `${by} started the review.`;
    case "approved":
      return by === null ? "Approved." : `${by} approved it.`;
    case "rejected":
      return by === null ? "Rejected." : `${by} rejected it.`;
    case "changes_requested":
      return by === null ? "Changes were asked for." : `${by} asked the planner for changes.`;
    case "withdrawn":
      return by === null ? "Withdrawn from review." : `${by} withdrew it from review.`;
    case "draft":
      return by === null ? "Taken back to revise." : `${by} took it back to revise.`;
    case "archived":
      return by === null ? "Archived." : `${by} archived it.`;
  }
}

/** What needs attention now, from the queue itself. */
export function queueSummary(counts: StageCounts, longestWaiting: PendingReviewEntry | null, nowMs: number): readonly SummaryPart[] {
  const { to_start: toStart, in_review: inReview, with_planner: withPlanner } = counts;
  const later: SummaryPart[] = [];
  if (inReview > 0) later.push(" ", { strong: stagePhrase(inReview, "in_review") }, ` ${inReview === 1 ? "waits" : "wait"} for a decision.`);
  if (withPlanner > 0) later.push(" ", { strong: stagePhrase(withPlanner, "with_planner") }, " for changes.");
  if (toStart === 0 && inReview === 0 && withPlanner === 0) return ["All caught up: no layout is waiting for review."];
  if (toStart === 0) return ["Nothing is waiting to be started.", ...later];
  const age = longestWaiting === null ? null : queueAge(longestWaiting, nowMs);
  return [
    { strong: stagePhrase(toStart, "to_start"), tone: "new" },
    ` ${toStart === 1 ? "is" : "are"} waiting for a reviewer`,
    ...(age === null ? [] : [toStart === 1 ? "; it was submitted " : "; the longest-waiting was submitted ", { strong: age }]),
    ".",
    ...later,
  ];
}
