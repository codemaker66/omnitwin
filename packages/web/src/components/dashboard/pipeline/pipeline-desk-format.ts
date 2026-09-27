import { OPPORTUNITY_STAGE_TRANSITIONS, OpportunityStageSchema, type OpportunityStage } from "@omnitwin/types";
import type { Activity, Opportunity, StageMove } from "../../../api/crm.js";
import { formatMinorAsCurrency } from "../../../lib/money-input.js";
import {
  eventDateLong, eventDateParts, relativeAge, venueCalendarDate, type StageTone, type SummaryPart,
} from "../enquiries/enquiry-desk-format.js";

// ---------------------------------------------------------------------------
// Words and shapes for the pipeline desk (roadmap X1).
//
// A deal is weighed by what is owed on it next and when, so the desk lists
// open deals by when their next step is due, and says so in the venue's
// calendar ("Due today", "Overdue by 3 days", "Due Thursday"). Stage names
// are the pipeline's own until Blake chooses the venue's (Q-B2); they live
// here, once.
// ---------------------------------------------------------------------------

/** The stages a deal is still being worked in, in the order it moves. */
export const LIVE_STAGES = ["new", "qualified", "proposal_drafting", "proposal_sent", "negotiation"] as const;
export type LiveStage = (typeof LIVE_STAGES)[number];
export type PipelineFilter = LiveStage | "all";

const STAGE_WORDS: Readonly<Record<OpportunityStage, string>> = {
  new: "New",
  qualified: "Qualified",
  proposal_drafting: "Proposal drafting",
  proposal_sent: "Proposal sent",
  negotiation: "Negotiation",
  won: "Won",
  lost: "Lost",
  archived: "Archived",
};

export function asStage(stage: string): OpportunityStage | null {
  const parsed = OpportunityStageSchema.safeParse(stage);
  return parsed.success ? parsed.data : null;
}

export function dealStageWords(stage: string): string {
  const known = asStage(stage);
  return known === null ? "In the pipeline" : STAGE_WORDS[known];
}

/** Copper where the venue owes the next move, amber while it is being worked,
 *  slate while the client has it, sage for won and brick for lost. */
export function dealStageTone(stage: string): StageTone {
  switch (asStage(stage)) {
    case "new": return "new";
    case "qualified":
    case "proposal_drafting":
    case "negotiation": return "review";
    case "proposal_sent": return "withdrawn";
    case "won": return "approved";
    case "lost": return "declined";
    case "archived":
    case null: return "other";
  }
}

export function isClosed(stage: string): boolean {
  return stage === "won" || stage === "lost" || stage === "archived";
}

// ---------------------------------------------------------------------------
// When the next step is due
// ---------------------------------------------------------------------------

export type DueKey = "overdue" | "today" | "week" | "later" | "undated" | "closed";

const DUE_ORDER: readonly DueKey[] = ["overdue", "today", "week", "later", "undated", "closed"];

const DUE_LABELS: Readonly<Record<DueKey, string>> = {
  overdue: "Overdue",
  today: "Due today",
  week: "This week",
  later: "Later",
  undated: "No date set",
  closed: "Won and lost",
};

const DAY_MS = 86_400_000;

/** Whole days from the venue's today to the venue's calendar day of `iso`. */
function daysFromToday(iso: string, nowMs: number): number | null {
  const due = venueCalendarDate(iso);
  const today = venueCalendarDate(new Date(nowMs).toISOString());
  if (due === null || today === null) return null;
  return Math.round((Date.parse(`${due}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) / DAY_MS);
}

export function dueKey(deal: Pick<Opportunity, "stage" | "nextActionDueAt">, nowMs: number): DueKey {
  if (isClosed(deal.stage)) return "closed";
  if (deal.nextActionDueAt === null) return "undated";
  const days = daysFromToday(deal.nextActionDueAt, nowMs);
  if (days === null) return "undated";
  if (days < 0) return "overdue";
  if (days === 0) return "today";
  return days < 7 ? "week" : "later";
}

/** "Due today", "Due yesterday", "Overdue by 3 days", "Due tomorrow",
 *  "Due Thursday", "Due 14 Oct", "No date set", or when a closed deal closed. */
export function dueWords(deal: Pick<Opportunity, "stage" | "nextActionDueAt" | "closedAt" | "updatedAt">, nowMs: number): string {
  if (deal.stage === "won" || deal.stage === "lost") {
    const age = relativeAge(deal.closedAt ?? deal.updatedAt, nowMs);
    return `${deal.stage === "won" ? "Won" : "Lost"}${age === null ? "" : ` ${age}`}`;
  }
  if (deal.stage === "archived") return "Archived";
  if (deal.nextActionDueAt === null) return "No date set";
  const days = daysFromToday(deal.nextActionDueAt, nowMs);
  if (days === null) return "No date set";
  if (days === 0) return "Due today";
  if (days === -1) return "Due yesterday";
  if (days < 0) return `Overdue by ${String(-days)} days`;
  if (days === 1) return "Due tomorrow";
  const calendar = venueCalendarDate(deal.nextActionDueAt);
  if (days < 7) return `Due ${eventDateLong(calendar)?.split(" ")[0] ?? ""}`;
  const parts = eventDateParts(calendar);
  const thisYear = venueCalendarDate(new Date(nowMs).toISOString())?.slice(0, 4);
  return parts === null ? "Due later" : `Due ${parts.day} ${parts.month}${parts.year === thisYear ? "" : ` ${parts.year}`}`;
}

/** Whether the reader owes the step now: due today or already past. */
export function dueIsPressing(deal: Pick<Opportunity, "stage" | "nextActionDueAt">, nowMs: number): boolean {
  const key = dueKey(deal, nowMs);
  return key === "overdue" || key === "today";
}

export interface DueGroup<T> {
  readonly key: DueKey;
  readonly label: string;
  readonly rows: readonly T[];
}

/** The deals under Overdue, Due today, This week, Later, No date set, then
 *  Won and lost, each in the order the pipeline gave them. */
export function groupByDue<T extends Pick<Opportunity, "stage" | "nextActionDueAt">>(rows: readonly T[], nowMs: number): DueGroup<T>[] {
  const buckets = new Map<DueKey, T[]>();
  for (const row of rows) {
    const key = dueKey(row, nowMs);
    const bucket = buckets.get(key);
    if (bucket === undefined) buckets.set(key, [row]);
    else bucket.push(row);
  }
  return DUE_ORDER.flatMap((key) => {
    const bucket = buckets.get(key);
    return bucket === undefined ? [] : [{ key, label: DUE_LABELS[key], rows: bucket }];
  });
}

// ---------------------------------------------------------------------------
// The desk's opening sentence
// ---------------------------------------------------------------------------

function deals(count: number): string {
  return `${count.toLocaleString("en-GB")} ${count === 1 ? "deal" : "deals"}`;
}

/** What is owed today, then what is open and what it is worth. Null until
 *  the pipeline says (an API from before it sends no due counts). */
export function pipelineSummary(input: {
  readonly due: { readonly overdue: number; readonly today: number } | null;
  readonly openCount: number;
  readonly openValueMinor: number | null;
  readonly currency: string;
}): readonly SummaryPart[] | null {
  const { due, openCount, openValueMinor, currency } = input;
  if (due === null) return null;
  const owed: SummaryPart[] = due.today > 0 && due.overdue > 0
    ? [{ strong: deals(due.today) }, ` ${due.today === 1 ? "has" : "have"} a step due today, and `,
      { strong: `${due.overdue.toLocaleString("en-GB")} ${due.overdue === 1 ? "is" : "are"} overdue`, tone: "new" }, "."]
    : due.today > 0
      ? [{ strong: deals(due.today) }, ` ${due.today === 1 ? "has" : "have"} a step due today.`]
      : due.overdue > 0
        ? ["Nothing is due today; ", { strong: `${deals(due.overdue)} ${due.overdue === 1 ? "is" : "are"} overdue`, tone: "new" }, "."]
        : ["Nothing is due today or overdue."];
  const open: SummaryPart[] = openCount === 0 ? [" No deals are open."]
    : openValueMinor === null ? [" ", { strong: deals(openCount) }, openCount === 1 ? " is open." : " are open."]
      : [" ", { strong: formatMinorAsCurrency(openValueMinor, currency) }, " is open across ", { strong: deals(openCount) }, "."];
  return [...owed, ...open];
}

// ---------------------------------------------------------------------------
// The next step for each stage, and the moves the API accepts
// ---------------------------------------------------------------------------

/** A move the panel offers: a stage the API accepts from here, or drafting a
 *  proposal, which moves a qualified deal on as it is made. */
export type DealStep =
  | { readonly kind: "stage"; readonly to: OpportunityStage; readonly label: string }
  | { readonly kind: "draft-proposal"; readonly label: string };

export interface StageSteps {
  readonly primary: DealStep | null;
  readonly secondary: readonly DealStep[];
  /** A sentence under the step saying what it does. */
  readonly hint: string;
}

const CLOSE_WORDS: Readonly<Record<"won" | "lost", string>> = { won: "Mark won…", lost: "Mark lost…" };

/** One primary step per stage, a quieter alternative or two, and Mark lost…
 *  wherever the deal is still open. Only moves the stage rules allow. */
export function stageSteps(stage: string): StageSteps {
  const current = asStage(stage);
  const allowed = (to: OpportunityStage): boolean => current !== null && OPPORTUNITY_STAGE_TRANSITIONS[current].includes(to);
  const move = (to: OpportunityStage, label: string): DealStep | null => allowed(to) ? { kind: "stage", to, label } : null;
  const lost = move("lost", CLOSE_WORDS.lost);
  const present = (steps: readonly (DealStep | null)[]): DealStep[] => steps.filter((step): step is DealStep => step !== null);
  switch (current) {
    case "new":
      return { primary: move("qualified", "Mark qualified"), secondary: present([lost]),
        hint: "Qualify it once the date, the room and roughly how many are coming are known." };
    case "qualified":
      return { primary: { kind: "draft-proposal", label: "Draft a proposal" }, secondary: present([lost]),
        hint: "Drafting a proposal moves the deal to Proposal drafting." };
    case "proposal_drafting":
      return { primary: move("proposal_sent", "Mark the proposal sent"), secondary: present([move("qualified", "Back to qualified"), lost]),
        hint: "Sending the proposal moves the deal on by itself. Mark it sent if it went another way." };
    case "proposal_sent":
      return { primary: move("won", CLOSE_WORDS.won), secondary: present([move("negotiation", "They asked for changes"), lost]),
        hint: "The client has the proposal. Their answer on it moves the deal; record one given another way." };
    case "negotiation":
      return { primary: move("proposal_sent", "Mark the revised proposal sent"), secondary: present([move("won", CLOSE_WORDS.won), lost]),
        hint: "Sending the revised proposal moves the deal back to Proposal sent." };
    case "won":
      return { primary: null, secondary: present([move("archived", "Archive")]), hint: "Won. The booking and the handoff take it from here." };
    case "lost":
      return { primary: null, secondary: present([move("archived", "Archive")]), hint: "Lost. Its reason is kept in the timeline." };
    case "archived":
    case null:
      return { primary: null, secondary: [], hint: "Archived. Nothing more is owed on it." };
  }
}

/** Closing a deal asks why, in place, before it moves. */
export function isClosingMove(step: DealStep): step is { readonly kind: "stage"; readonly to: "won" | "lost"; readonly label: string } {
  return step.kind === "stage" && (step.to === "won" || step.to === "lost");
}

/** Reasons a booker gives most often, offered to fill the reason with a press. */
export const CLOSE_REASONS: Readonly<Record<"won" | "lost", readonly string[]>> = {
  won: ["Accepted the proposal", "Signed the contract", "Paid the deposit"],
  lost: ["Chose another venue", "Date not available", "Over budget", "Event cancelled", "No reply"],
};

/** The stages a deal passes through, marked done, current or ahead.
 *  Negotiation is a loop a deal may never enter, so it shows only while the
 *  deal is in it. */
export function stagePath(stage: string): readonly { readonly stage: OpportunityStage; readonly label: string; readonly state: "done" | "current" | "ahead" }[] {
  const order: readonly OpportunityStage[] = stage === "negotiation"
    ? [...LIVE_STAGES, "won"]
    : ["new", "qualified", "proposal_drafting", "proposal_sent", "won"];
  const labels: Readonly<Record<string, string>> = {
    new: "New", qualified: "Qualified", proposal_drafting: "Drafting", proposal_sent: "Sent", negotiation: "Negotiation", won: "Won",
  };
  const at = order.indexOf(asStage(stage) ?? "new");
  return order.map((step, index) => ({
    stage: step, label: labels[step] ?? step,
    state: index < at ? "done" : index === at ? "current" : "ahead",
  }));
}

// ---------------------------------------------------------------------------
// The timeline
// ---------------------------------------------------------------------------

export interface TimelineMoment {
  readonly key: string;
  readonly at: string;
  readonly sentence: string;
  /** The words given with it: a close's reason, or a note's text. */
  readonly quote: string | null;
}

function moveSentence(move: StageMove): string {
  const who = move.changedByName;
  if (who === null) {
    if (move.toStage === "won") return "It was marked won.";
    if (move.toStage === "lost") return "It was marked lost.";
    if (move.toStage === "archived") return "It was archived.";
    return `It moved to ${dealStageWords(move.toStage)}.`;
  }
  if (move.toStage === "won") return `${who} marked it won.`;
  if (move.toStage === "lost") return `${who} marked it lost.`;
  if (move.toStage === "archived") return `${who} archived it.`;
  return `${who} moved it to ${dealStageWords(move.toStage)}.`;
}

/** A move nobody at the venue made (the client's own act on a proposal, say)
 *  is told in its note's words: "The client accepted the proposal (version
 *  2)." A move a person made names them, with their reason beneath. */
function moveMoment(move: StageMove): { sentence: string; quote: string | null } {
  const note = move.note === null ? "" : move.note.trim();
  // The old board wrote "Moved to X" as every move's note; it says nothing.
  const said = note === "" || /^Moved to /u.test(note) ? null : note;
  if (move.changedByName === null && said !== null) return { sentence: said, quote: null };
  return { sentence: moveSentence(move), quote: said };
}

/** What happened to the deal, newest first: its stage moves with who made
 *  them and why, its notes, and when it was opened. */
export function dealTimeline(deal: Pick<Opportunity, "createdAt">, history: readonly StageMove[], notes: readonly Activity[]): TimelineMoment[] {
  const moments: TimelineMoment[] = [
    ...history.map((move) => ({ key: `move:${move.id}`, at: move.createdAt, ...moveMoment(move) })),
    ...notes.map((note) => ({ key: `note:${note.id}`, at: note.createdAt, sentence: "Note", quote: note.body })),
    { key: "opened", at: deal.createdAt, sentence: "The deal was opened.", quote: null },
  ];
  return moments.sort((a, b) => Date.parse(b.at) - Date.parse(a.at));
}

/** When the deal reached its current stage, from its moves (newest first). */
export function stageSince(stage: string, history: readonly StageMove[]): string | null {
  return history.find((move) => move.toStage === stage)?.createdAt ?? null;
}
