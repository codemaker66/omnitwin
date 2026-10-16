// ---------------------------------------------------------------------------
// The time of day a pricing rule is for, as the office enters and reads it in
// Room Hire Pricing (goal 19 S6, migration 0089).
//
// The price sheet has slots: Half Day 09:00–13:00, Half Day 14:00–18:00,
// Full Day 09:00–17:30, Evening 19:00–00:30. A rule with a window prices only
// a span inside it, so the slots stop stacking on one evening. A rule with no
// window applies at any time, as every rule did before.
//
// The API's rule, mirrored here so the office hears it before the request
// goes: both times or neither, each "HH:MM" on a 24-hour clock, and an until
// not after its from runs past midnight.
// ---------------------------------------------------------------------------

export const WINDOW_COPY = {
  anyTime: "any time",
  pastMidnight: "past midnight",
  pairNeeded: "Enter both times, or neither.",
  clockNeeded: "Times are HH:MM on a 24-hour clock, as 09:00 or 19:00.",
  hint: "Leave both empty and the rate applies at any time. An until before its from runs past midnight, as 19:00 to 00:30 does.",
} as const;

const CLOCK_TIME = /^([01]\d|2[0-3]):[0-5]\d$/u;
const CLOCK_TIME_WITH_SECONDS = /^([01]\d|2[0-3]):[0-5]\d:[0-5]\d(\.\d+)?$/u;

/** The API's own sentence for one side alone (routes/pricing-rules.ts). */
const API_PAIR_MESSAGE = "appliesFrom and appliesUntil go together: both, or neither";
const WINDOW_FIELDS = new Set(["appliesFrom", "appliesUntil"]);

/** "09:00:00" as Postgres sends a time, or "09:00" as the form does: the
 *  clock face of either. Anything else is left as it came. */
export function clockFace(time: string): string {
  return CLOCK_TIME_WITH_SECONDS.test(time) ? time.slice(0, 5) : time;
}

function minutesOfDay(face: string): number {
  return Number.parseInt(face.slice(0, 2), 10) * 60 + Number.parseInt(face.slice(3, 5), 10);
}

export interface RuleWindowFields {
  readonly appliesFrom?: string | null;
  readonly appliesUntil?: string | null;
}

/** The rule's window for the list: "09:00–13:00", "19:00–00:30 (past
 *  midnight)", or "any time" for a rule without one. A rule from an older
 *  server carries neither field and reads as any time too. */
export function describeWindow(rule: RuleWindowFields): string {
  const from = rule.appliesFrom ?? null;
  const until = rule.appliesUntil ?? null;
  if (from === null || until === null) return WINDOW_COPY.anyTime;
  const fromFace = clockFace(from);
  const untilFace = clockFace(until);
  const window = `${fromFace}–${untilFace}`;
  if (!CLOCK_TIME.test(fromFace) || !CLOCK_TIME.test(untilFace)) return window;
  return minutesOfDay(untilFace) <= minutesOfDay(fromFace) ? `${window} (${WINDOW_COPY.pastMidnight})` : window;
}

export interface WindowDraft {
  readonly from: string;
  readonly until: string;
}

/** What the two inputs say, read the way the API will read them. */
export type WindowDraftReading =
  | { readonly kind: "any"; readonly appliesFrom: null; readonly appliesUntil: null }
  | { readonly kind: "set"; readonly appliesFrom: string; readonly appliesUntil: string }
  | { readonly kind: "half"; readonly message: string }
  | { readonly kind: "invalid"; readonly message: string };

export function readWindowDraft(draft: WindowDraft): WindowDraftReading {
  const from = draft.from.trim();
  const until = draft.until.trim();
  if (from === "" && until === "") return { kind: "any", appliesFrom: null, appliesUntil: null };
  if (from === "" || until === "") return { kind: "half", message: WINDOW_COPY.pairNeeded };
  if (!CLOCK_TIME.test(from) || !CLOCK_TIME.test(until)) return { kind: "invalid", message: WINDOW_COPY.clockNeeded };
  return { kind: "set", appliesFrom: from, appliesUntil: until };
}

function field(value: unknown, key: string): unknown {
  return value !== null && typeof value === "object" ? (value as Record<string, unknown>)[key] : undefined;
}

function readable(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0 ? value : undefined;
}

/** A refusal in the office's words: the API's pair sentence, or any issue
 *  on a window field, says what the form says; anything else as it came. */
function houseWords(message: string | undefined, path: unknown): string | undefined {
  if (message === API_PAIR_MESSAGE) return WINDOW_COPY.pairNeeded;
  const onWindow = Array.isArray(path) && path.some((step) => typeof step === "string" && WINDOW_FIELDS.has(step));
  return onWindow ? WINDOW_COPY.clockNeeded : message;
}

/** The words to show when a save fails. A 400 from the create route says
 *  only "Validation failed" and keeps the reason in its details, so the
 *  first reason is shown plainly, in the office's words where the form has
 *  them; any other message stands as it came. */
export function ruleSaveError(error: unknown, fallback: string): string {
  const message = error instanceof Error ? readable(error.message) : undefined;
  if (message === undefined) return fallback;
  if (field(error, "code") !== "VALIDATION_ERROR") return message;
  const details = field(error, "details");
  const reason = Array.isArray(details)
    ? details.map((issue) => houseWords(readable(field(issue, "message")), field(issue, "path"))).find((text) => text !== undefined)
    : undefined;
  return reason ?? houseWords(message, undefined) ?? fallback;
}
