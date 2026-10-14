import { addRotaDays, rotaInstant } from "@omnitwin/types";
import { MIN_INGOT_DURATION_MS } from "./when-ribbon-model.js";

// ---------------------------------------------------------------------------
// Typed natural time for the When ribbon (goal 19 S6, T-651). Pure.
//
// A client or the office types "12-4pm", "7 for 7:30", "half 7" or "6.30pm
// till late" and this module says which instants that means on the day the
// ribbon shows, on the venue's clock. The shell only feeds it text and draws
// the answer; nothing here touches the DOM, React, the network or Date.now().
//
// Doctrine:
//  - A typed time is exact: nothing here snaps.
//  - Explicit markers win: am, pm, noon, midnight, or a 24-hour reading
//    (0, 13-23, a four-digit "0730"). When one side carries a marker the
//    other side takes the reading that keeps the window in order and
//    shortest. When nothing does, bare hours read 1-7 as pm, 8-11 as am,
//    12 as midday and 0 as midnight; an end that then lands before its start
//    rolls forward, twelve hours when that fixes it, otherwise to the next
//    day.
//  - Every such guess is echoed as a short, client-safe assumption so the
//    reader can correct it at a glance. The copy test pins the vocabulary.
//  - Instants come from rotaInstant on the ribbon's date and zone, so BST
//    and GMT are right without any dependence on the machine's clock or zone.
//    An end past midnight is placed on the next calendar date.
// ---------------------------------------------------------------------------

const MINUTE_MS = 60_000;
const HOUR_MS = 60 * MINUTE_MS;
const HALF_DAY_MINUTES = 12 * 60;
const DAY_MINUTES = 24 * 60;
const MIDDAY_MINUTE = 12 * 60;
/** The midnight that ends the shown day, as minutes past its start. */
const MIDNIGHT_MINUTE = DAY_MINUTES;
const MAX_WINDOW_MS = 24 * HOUR_MS;

export interface WhenEntryContext {
  /** The venue-local calendar date the ribbon shows, YYYY-MM-DD. */
  readonly date: string;
  /** IANA zone of the venue, e.g. "Europe/London". */
  readonly timeZone: string;
  /** The window the ribbon shows now, if any. */
  readonly current: { readonly startMs: number; readonly endMs: number } | null;
  /** Used when no end is typed and there is no current window. */
  readonly defaultDurationMs: number;
}

export type WhenEntryResult =
  | {
      readonly kind: "window";
      readonly startMs: number;
      readonly endMs: number;
      /** "7 for 7:30": doors at the start, the event itself from here. */
      readonly liveMs: number | null;
      /** Every reading the parser had to choose, in plain words. */
      readonly assumptions: readonly string[];
    }
  | { readonly kind: "unparsed"; readonly hint: string };

const EXAMPLES = "12-4pm or 7 for 7:30";

const HINTS = {
  empty: `Type a time, like ${EXAMPLES}`,
  unreadable: `Try something like ${EXAMPLES}`,
  hour: "There are only 24 hours in a day: try 18:00-23:00 or 6-11pm",
  minute: "Minutes run from 00 to 59: try 7:30 or 7.45",
  minuteDigits: "Give the minutes as two digits, like 7:05",
  sameTime: "That ends when it starts: try something like 7-11pm",
  tooShort: `That is shorter than ${String(MIN_INGOT_DURATION_MS / MINUTE_MS)} minutes: try a longer window`,
  tooLong: "That runs for more than a day: try a shorter window",
  liveBeforeDoors: "The start should come after the doors time, like 7 for 7:30",
  liveAfterEnd: "The start needs to fall before the end, like 7 for 7:30 till 11",
};

// --- tokens ----------------------------------------------------------------

interface Token {
  readonly kind: "number" | "word" | "dash" | "point";
  readonly text: string;
  readonly from: number;
  readonly to: number;
}

/** Lower-case, one kind of dash, "a.m."/"p.m." folded to am/pm, no commas
 *  or trailing full stop. Spelling the text out this way keeps the grammar
 *  below small and the echoes readable. */
function normalise(text: string): string {
  return text
    .toLowerCase()
    .replace(/[‐-―−]/gu, "-")
    .replace(/\b([ap])\.\s?m\b\.?/gu, "$1m")
    .replace(/\bo'?clock\b/gu, " ")
    .replace(/'til\b/gu, "til")
    .replace(/,/gu, " ")
    .replace(/\s+/gu, " ")
    .trim()
    .replace(/[\s.]+$/u, "");
}

/** Digits, words, dashes and the two minute separators; whitespace is
 *  dropped. Any other character means this is not a time. */
function tokenise(text: string): readonly Token[] | null {
  const tokens: Token[] = [];
  const scanner = /(\d+)|([a-z]+)|(-)|([:.])|(\s+)|(.)/gu;
  let match = scanner.exec(text);
  while (match !== null) {
    const [whole, digits, letters, dash, point, space] = match;
    const from = match.index;
    const to = from + whole.length;
    if (digits !== undefined) tokens.push({ kind: "number", text: digits, from, to });
    else if (letters !== undefined) tokens.push({ kind: "word", text: letters, from, to });
    else if (dash !== undefined) tokens.push({ kind: "dash", text: dash, from, to });
    else if (point !== undefined) tokens.push({ kind: "point", text: point, from, to });
    else if (space === undefined) return null;
    match = scanner.exec(text);
  }
  return tokens;
}

function wordAt(tokens: readonly Token[], index: number, ...words: readonly string[]): boolean {
  const token = tokens[index];
  return token !== undefined && token.kind === "word" && words.includes(token.text);
}

const SEPARATORS: readonly string[] = ["to", "till", "until", "til", "and"];

function isSeparator(tokens: readonly Token[], index: number): boolean {
  const token = tokens[index];
  if (token === undefined) return false;
  return token.kind === "dash" || (token.kind === "word" && SEPARATORS.includes(token.text));
}

/** The source text of tokens[first] through tokens[next - 1], for echoes. */
function sourceOf(source: string, tokens: readonly Token[], first: number, next: number): string {
  const head = tokens[first];
  const tail = tokens[next - 1];
  return head === undefined || tail === undefined ? "" : source.slice(head.from, tail.to);
}

// --- one clock time ----------------------------------------------------------

type Meridiem = "am" | "pm";

interface ExactClock {
  readonly kind: "exact";
  readonly raw: string;
  /** Minutes past the shown day's midnight; 1440 is the midnight that ends it. */
  readonly minute: number;
  /** An echo owed although the reading is settled ("late" means midnight). */
  readonly note: string | null;
}

interface AmbiguousClock {
  readonly kind: "ambiguous";
  readonly raw: string;
  readonly am: number;
  readonly pm: number;
  /** The reading taken when nothing in the entry carries a marker. */
  readonly preferred: Meridiem;
}

type Clock = ExactClock | AmbiguousClock;

type ClockParse =
  | { readonly kind: "clock"; readonly clock: Clock; readonly next: number }
  | { readonly kind: "invalid"; readonly hint: string }
  | { readonly kind: "none" };

type ClockFailure = Exclude<ClockParse, { kind: "clock" }>;

const NO_CLOCK: ClockParse = { kind: "none" };

function exactClock(raw: string, minute: number, note: string | null, next: number): ClockParse {
  return { kind: "clock", clock: { kind: "exact", raw, minute, note }, next };
}

/** What was typed, before the am/pm question is settled. */
interface Face {
  readonly hour: number;
  readonly minute: number;
  readonly meridiem: Meridiem | null;
  /** "0730": four digits are the 24-hour clock. */
  readonly fourDigit: boolean;
  /** -15 for "quarter to": the face names the hour the time runs up to. */
  readonly shiftMinutes: 0 | -15;
}

function faceToClock(face: Face, raw: string, next: number): ClockParse {
  const { hour, minute, meridiem } = face;
  if (hour > 23) return { kind: "invalid", hint: HINTS.hour };
  if (minute > 59) return { kind: "invalid", hint: HINTS.minute };
  if (meridiem !== null && (hour === 0 || (hour > 12 && meridiem === "am"))) {
    return { kind: "invalid", hint: HINTS.unreadable };
  }

  const explicit = meridiem !== null || hour === 0 || hour > 12 || face.fourDigit;
  if (explicit) {
    const base = meridiem === null
      ? hour * 60 + minute
      : ((hour % 12) + (meridiem === "pm" ? 12 : 0)) * 60 + minute;
    const settled = (base + face.shiftMinutes + DAY_MINUTES) % DAY_MINUTES;
    const note = hour === 0 && minute === 0 && meridiem === null && face.shiftMinutes === 0
      ? `Took ${raw} as midnight`
      : null;
    return exactClock(raw, settled, note, next);
  }

  // 1 to 12 with no marker: both readings stay open until the rest of the
  // entry says which. "quarter to 8" shows 7:45 on the face, so the face
  // hour is the one the bare-hour rule reads.
  const faceHour = face.shiftMinutes === 0 ? hour : hour === 1 ? 12 : hour - 1;
  const faceMinute = face.shiftMinutes === 0 ? minute : 45;
  const am = (faceHour % 12) * 60 + faceMinute;
  const preferred: Meridiem = faceHour >= 8 && faceHour <= 11 ? "am" : "pm";
  return {
    kind: "clock",
    clock: { kind: "ambiguous", raw, am, pm: am + HALF_DAY_MINUTES, preferred },
    next,
  };
}

function readMeridiem(tokens: readonly Token[], index: number): { readonly meridiem: Meridiem; readonly next: number } | null {
  const token = tokens[index];
  if (token === undefined || token.kind !== "word") return null;
  if (token.text === "am" || token.text === "pm") return { meridiem: token.text, next: index + 1 };
  return null;
}

/** The hour after "half", "quarter past" or "quarter to": one or two digits
 *  and an optional am/pm. */
function readHour(tokens: readonly Token[], index: number): { readonly hour: number; readonly meridiem: Meridiem | null; readonly next: number } | null {
  const token = tokens[index];
  if (token === undefined || token.kind !== "number" || token.text.length > 2) return null;
  const meridiem = readMeridiem(tokens, index + 1);
  return {
    hour: Number(token.text),
    meridiem: meridiem === null ? null : meridiem.meridiem,
    next: meridiem === null ? index + 1 : meridiem.next,
  };
}

/** "7", "7:30", "7.30", "730", "1930", "0730", each with an optional am/pm,
 *  and "12 noon" / "12 midnight". */
function parseNumeric(source: string, tokens: readonly Token[], index: number): ClockParse {
  const token = tokens[index];
  if (token === undefined || token.kind !== "number") return NO_CLOCK;
  const digits = token.text;
  if (digits.length > 4) return NO_CLOCK;

  let hour: number;
  let minute: number;
  let next = index + 1;
  const fourDigit = digits.length === 4;
  if (digits.length >= 3) {
    hour = Number(digits.slice(0, -2));
    minute = Number(digits.slice(-2));
  } else {
    hour = Number(digits);
    minute = 0;
    const point = tokens[next];
    const minutes = tokens[next + 1];
    if (point !== undefined && point.kind === "point" && minutes !== undefined && minutes.kind === "number") {
      if (minutes.text.length !== 2) return { kind: "invalid", hint: HINTS.minuteDigits };
      minute = Number(minutes.text);
      next += 2;
    }
  }

  const meridiem = readMeridiem(tokens, next);
  if (meridiem !== null) next = meridiem.next;
  if (meridiem === null && hour === 12 && minute === 0) {
    if (wordAt(tokens, next, "noon", "midday")) {
      return exactClock(sourceOf(source, tokens, index, next + 1), MIDDAY_MINUTE, null, next + 1);
    }
    if (wordAt(tokens, next, "midnight")) {
      return exactClock(sourceOf(source, tokens, index, next + 1), MIDNIGHT_MINUTE, null, next + 1);
    }
  }
  return faceToClock(
    { hour, minute, meridiem: meridiem === null ? null : meridiem.meridiem, fourDigit, shiftMinutes: 0 },
    sourceOf(source, tokens, index, next),
    next,
  );
}

function parseClock(source: string, tokens: readonly Token[], index: number): ClockParse {
  const token = tokens[index];
  if (token === undefined) return NO_CLOCK;
  if (token.kind === "number") return parseNumeric(source, tokens, index);
  if (token.kind !== "word") return NO_CLOCK;
  switch (token.text) {
    case "noon":
    case "midday":
      return exactClock(token.text, MIDDAY_MINUTE, null, index + 1);
    case "midnight":
      return exactClock(token.text, MIDNIGHT_MINUTE, null, index + 1);
    case "half": {
      const hourIndex = wordAt(tokens, index + 1, "past") ? index + 2 : index + 1;
      const read = readHour(tokens, hourIndex);
      if (read === null) return NO_CLOCK;
      return faceToClock(
        { hour: read.hour, minute: 30, meridiem: read.meridiem, fourDigit: false, shiftMinutes: 0 },
        sourceOf(source, tokens, index, read.next),
        read.next,
      );
    }
    case "quarter": {
      const past = wordAt(tokens, index + 1, "past");
      if (!past && !wordAt(tokens, index + 1, "to")) return NO_CLOCK;
      const read = readHour(tokens, index + 2);
      if (read === null) return NO_CLOCK;
      return faceToClock(
        {
          hour: read.hour,
          minute: past ? 15 : 0,
          meridiem: read.meridiem,
          fourDigit: false,
          shiftMinutes: past ? 0 : -15,
        },
        sourceOf(source, tokens, index, read.next),
        read.next,
      );
    }
    default:
      return NO_CLOCK;
  }
}

/** An end may also be "late", which means midnight and says so. */
function parseEnd(source: string, tokens: readonly Token[], index: number): ClockParse {
  if (wordAt(tokens, index, "late")) {
    return exactClock("late", MIDNIGHT_MINUTE, "Took late as midnight", index + 1);
  }
  return parseClock(source, tokens, index);
}

// --- settling the readings --------------------------------------------------

function preferredReading(clock: AmbiguousClock): number {
  return clock.preferred === "am" ? clock.am : clock.pm;
}

/** `minute` as a moment after `startMinute`: itself, or itself the next
 *  day; null when the two coincide. */
function rollAfter(minute: number, startMinute: number): number | null {
  if (minute > startMinute) return minute;
  if (minute < startMinute) return minute + DAY_MINUTES;
  return null;
}

/** The reading of an open clock that falls soonest after the start. */
function nearestAfter(startMinute: number, clock: AmbiguousClock): number | null {
  let best: number | null = null;
  for (const reading of [clock.am, clock.pm]) {
    const rolled = rollAfter(reading, startMinute);
    if (rolled !== null && (best === null || rolled < best)) best = rolled;
  }
  return best;
}

/** The reading of an open start that makes the shortest window up to a
 *  settled end. */
function startBefore(endMinute: number, clock: AmbiguousClock): number | null {
  let best: { readonly start: number; readonly length: number } | null = null;
  for (const start of [clock.am, clock.pm]) {
    const rolledEnd = rollAfter(endMinute, start);
    if (rolledEnd === null) continue;
    const length = rolledEnd - start;
    if (best === null || length < best.length) best = { start, length };
  }
  return best === null ? null : best.start;
}

/** No marker anywhere: the bare-hour reading of the end, rolled forward
 *  when it lands before the start, twelve hours when that fixes it and
 *  otherwise to the next day. "7 to 7" coincides and is refused. */
function bareEnd(startMinute: number, clock: AmbiguousClock): number | null {
  const first = preferredReading(clock);
  if (first > startMinute) return first;
  if (first === startMinute) return null;
  const twelveLater = first + HALF_DAY_MINUTES;
  return twelveLater > startMinute ? twelveLater : first + DAY_MINUTES;
}

// --- words -------------------------------------------------------------------

function clockWords(minute: number): string {
  const ofDay = minute % DAY_MINUTES;
  if (ofDay === 0) return "midnight";
  if (ofDay === MIDDAY_MINUTE) return "midday";
  const hour = Math.floor(ofDay / 60);
  const minutes = ofDay % 60;
  const face = hour % 12 === 0 ? 12 : hour % 12;
  const suffix = hour < 12 ? "am" : "pm";
  return minutes === 0
    ? `${String(face)}${suffix}`
    : `${String(face)}:${String(minutes).padStart(2, "0")}${suffix}`;
}

function took(raw: string, minute: number): string {
  return `Took ${raw} as ${clockWords(minute)}`;
}

interface LengthWords {
  readonly amount: string;
  readonly unit: "hour" | "minute";
  readonly plural: boolean;
}

function lengthWords(ms: number): LengthWords {
  const minutes = Math.round(ms / MINUTE_MS);
  if (minutes >= 60 && minutes % 60 === 0) {
    return { amount: String(minutes / 60), unit: "hour", plural: minutes !== 60 };
  }
  if (minutes > 60 && minutes % 30 === 0) {
    return { amount: `${String(Math.floor(minutes / 60))}½`, unit: "hour", plural: true };
  }
  return { amount: String(minutes), unit: "minute", plural: minutes !== 1 };
}

/** "5 hours", "1½ hours", "45 minutes". */
function lengthAsNoun(ms: number): string {
  const words = lengthWords(ms);
  return `${words.amount} ${words.unit}${words.plural ? "s" : ""}`;
}

/** "5-hour", "1½-hour", "45-minute". */
function lengthAsAdjective(ms: number): string {
  const words = lengthWords(ms);
  return `${words.amount}-${words.unit}`;
}

// --- instants ----------------------------------------------------------------

function wholeMinutes(ms: number): number {
  return Math.round(ms / MINUTE_MS) * MINUTE_MS;
}

/** The current window's length when it is one worth keeping. */
function keptLength(current: WhenEntryContext["current"]): number | null {
  if (current === null) return null;
  const length = wholeMinutes(current.endMs - current.startMs);
  return length >= MIN_INGOT_DURATION_MS ? length : null;
}

function instantAt(context: WhenEntryContext, minute: number): number {
  const days = Math.floor(minute / DAY_MINUTES);
  const date = days === 0 ? context.date : addRotaDays(context.date, days);
  return rotaInstant(date, minute - days * DAY_MINUTES, context.timeZone);
}

function unparsed(hint: string): WhenEntryResult {
  return { kind: "unparsed", hint };
}

function failed(parse: ClockFailure): WhenEntryResult {
  return unparsed(parse.kind === "invalid" ? parse.hint : HINTS.unreadable);
}

function resolve(
  start: Clock,
  live: Clock | null,
  end: Clock | null,
  context: WhenEntryContext,
): WhenEntryResult {
  const assumptions: string[] = [];

  // The start. A settled live time or end anchors an open start; with no
  // marker anywhere the bare-hour rule reads it.
  const anchor = end !== null && end.kind === "exact"
    ? end
    : live !== null && live.kind === "exact"
      ? live
      : null;
  let startMinute: number;
  if (start.kind === "exact") {
    startMinute = start.minute;
    if (start.note !== null) assumptions.push(start.note);
  } else {
    const chosen = anchor === null ? preferredReading(start) : startBefore(anchor.minute, start);
    if (chosen === null) return unparsed(HINTS.sameTime);
    startMinute = chosen;
    assumptions.push(took(start.raw, startMinute));
  }

  // "7 for 7:30": the event starts a little after the doors.
  let liveMinute: number | null = null;
  if (live !== null) {
    const chosen = live.kind === "exact" ? rollAfter(live.minute, startMinute) : nearestAfter(startMinute, live);
    if (chosen === null) return unparsed(HINTS.liveBeforeDoors);
    liveMinute = chosen;
    if (live.kind === "exact") {
      if (live.note !== null) assumptions.push(live.note);
    } else {
      assumptions.push(took(live.raw, liveMinute));
    }
  }

  // The end, when one was typed.
  let endMinute: number | null = null;
  if (end !== null) {
    let chosen: number | null;
    if (end.kind === "exact") {
      chosen = rollAfter(end.minute, startMinute);
      if (end.note !== null) assumptions.push(end.note);
    } else if (start.kind === "ambiguous" && anchor === null) {
      chosen = bareEnd(startMinute, end);
    } else {
      chosen = nearestAfter(startMinute, end);
    }
    if (chosen === null) return unparsed(HINTS.sameTime);
    endMinute = chosen;
    if (end.kind === "ambiguous") assumptions.push(took(end.raw, endMinute));
  }

  const startMs = instantAt(context, startMinute);
  const liveMs = liveMinute === null ? null : instantAt(context, liveMinute);
  let endMs: number;
  if (endMinute === null) {
    // Only a start: keep the length the ribbon shows, else the default.
    const kept = keptLength(context.current);
    const lengthMs = kept ?? wholeMinutes(context.defaultDurationMs);
    endMs = startMs + lengthMs;
    assumptions.push(
      kept === null
        ? `Gave it ${lengthAsNoun(lengthMs)}, as no end was typed`
        : `Kept your ${lengthAsAdjective(lengthMs)} length`,
    );
  } else {
    endMs = instantAt(context, endMinute);
  }

  if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || (liveMs !== null && !Number.isFinite(liveMs))) {
    return unparsed(HINTS.unreadable);
  }
  const lengthMs = endMs - startMs;
  if (lengthMs <= 0) return unparsed(HINTS.sameTime);
  if (lengthMs < MIN_INGOT_DURATION_MS) return unparsed(HINTS.tooShort);
  if (lengthMs > MAX_WINDOW_MS) return unparsed(HINTS.tooLong);
  if (liveMs !== null) {
    if (liveMs <= startMs) return unparsed(HINTS.liveBeforeDoors);
    if (liveMs >= endMs) return unparsed(HINTS.liveAfterEnd);
  }
  return { kind: "window", startMs, endMs, liveMs, assumptions };
}

// --- the entry ---------------------------------------------------------------

/**
 * Read one typed time entry against the day the ribbon shows.
 *
 * Grammar, after normalising case, dashes and "a.m."/"p.m.":
 *   [from | at | between] START [for LIVE] [(- | to | till | until | and) END | onwards]
 * where START and LIVE are clock times and END is a clock time or "late".
 * A clock time is noon, midday, midnight, "half [past] H", "quarter past H",
 * "quarter to H", or H[:MM | .MM] / HMM / HHMM, each with an optional am/pm.
 */
export function parseWhenEntry(text: string, context: WhenEntryContext): WhenEntryResult {
  const source = normalise(text);
  if (source === "") return unparsed(HINTS.empty);
  const tokens = tokenise(source);
  if (tokens === null) return unparsed(HINTS.unreadable);

  let index = wordAt(tokens, 0, "from", "at", "between") ? 1 : 0;
  const start = parseClock(source, tokens, index);
  if (start.kind !== "clock") return failed(start);
  index = start.next;

  let live: Clock | null = null;
  if (wordAt(tokens, index, "for")) {
    const parsed = parseClock(source, tokens, index + 1);
    if (parsed.kind !== "clock") return failed(parsed);
    live = parsed.clock;
    index = parsed.next;
  }

  let end: Clock | null = null;
  if (isSeparator(tokens, index)) {
    const parsed = parseEnd(source, tokens, index + 1);
    if (parsed.kind !== "clock") return failed(parsed);
    end = parsed.clock;
    index = parsed.next;
  } else if (wordAt(tokens, index, "onwards", "onward")) {
    index += 1;
  }

  if (index !== tokens.length) return unparsed(HINTS.unreadable);
  return resolve(start.clock, live, end, context);
}
