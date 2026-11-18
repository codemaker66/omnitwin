import type { AccessibilityRequirements, DietarySummary } from "./event-requirements.js";
import { PHASE_METADATA, type SetupPhase } from "./hallkeeper-accessories.js";
import type { HallkeeperSheetV2 } from "./hallkeeper-v2.js";
import type { Zone } from "./zone.js";

// ---------------------------------------------------------------------------
// The hallkeeper's brief, derived from a sheet: the day in order, what to
// bring from the store, the setup steps and the plan markers notes carry.
// Pure, so the printed sheet and the screen word the same facts the same way.
//
// Nothing here invents a fact the planner did not record: a missing time
// yields no line, and a sheet frozen without a plan falls back to its totals.
// ---------------------------------------------------------------------------

/** "Final Touches" → "Final touches": the House writes labels in sentence case. */
function sentenceCase(label: string): string {
  return label.charAt(0).toUpperCase() + label.slice(1).toLowerCase();
}

function phaseLabel(phase: SetupPhase): string {
  return sentenceCase(PHASE_METADATA[phase].label);
}

function venueDay(iso: string, timeZone: string): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(iso));
}

// -------------------------------------------------------------- the times --
//
// Blake, 18 November 2026: "Setup from + Ready by". One rule, read by the
// printed sheet, the phone card and the Day Board's line alike:
//
//   Setup from  the snapshot's timing.setupBy. Its name is historical: both
//               of its sources START a window (the earliest room phase before
//               the booking, as the Day Board reads setup; or the booking less
//               the room's changeover time).
//   Guests in   the booking's start, timing.eventStart: the Day Board's doors
//               and the Diary's "Doors in".
//   Ready by    the planner's typed final-touches time when they gave one,
//               otherwise when guests come in.
//
// Frozen snapshots already hold every field this reads, so no stored shape
// changes. A planner's final time after guests come in is kept, never moved
// or hidden: every surface says it is after guests come in.

/** The sheet's times on one rule. Instants are ISO strings, printed on the venue's clock. */
export interface SheetTimes {
  /** When the room's setup window opens; null when no room phase or changeover time sets it. */
  readonly setupFrom: string | null;
  /** When the room must be ready: the planner's final-touches time, else guests in. Null only when neither is known. */
  readonly readyBy: string | null;
  /** When guests come in (the booking's start); null when no booking holds the room. */
  readonly guestsIn: string | null;
  /** Ready by is the planner's own final-touches time. */
  readonly readyFromPlanner: boolean;
  /** Whole minutes from Ready by to guests in: positive before, negative after, 0 as they come in. Null without both. */
  readonly readyBeforeGuestsMinutes: number | null;
  /** Whole minutes from Setup from to Ready by; null without both. Zero or less leaves no time to set the room. */
  readonly setupMinutes: number | null;
}

const MINUTE_MS = 60_000;

function instantMs(iso: string | null | undefined): number | null {
  if (iso === null || iso === undefined) return null;
  const ms = Date.parse(iso);
  return Number.isFinite(ms) ? ms : null;
}

type SheetInstructions = HallkeeperSheetV2["instructions"];

/** The planner's final-touches deadline: the first one with a readable time. */
function plannerFinal(instructions: SheetInstructions): NonNullable<SheetInstructions>["phaseDeadlines"][number] | null {
  return instructions?.phaseDeadlines.find((deadline) => deadline.phase === "final" && instantMs(deadline.deadline) !== null) ?? null;
}

const minutesBetween = (fromMs: number, toMs: number): number => Math.round((toMs - fromMs) / MINUTE_MS);

export function sheetTimes(sheet: Pick<HallkeeperSheetV2, "timing" | "instructions">): SheetTimes {
  const timing = sheet.timing;
  const guestsMs = instantMs(timing?.eventStart);
  const guestsIn = guestsMs === null ? null : timing?.eventStart ?? null;
  const setupMs = guestsMs === null ? null : instantMs(timing?.setupBy);
  const setupFrom = setupMs === null ? null : timing?.setupBy ?? null;
  const final = plannerFinal(sheet.instructions);
  const readyBy = final?.deadline ?? guestsIn;
  const readyMs = instantMs(readyBy);
  return {
    setupFrom,
    readyBy,
    guestsIn,
    readyFromPlanner: final !== null,
    readyBeforeGuestsMinutes: readyMs === null || guestsMs === null ? null : minutesBetween(readyMs, guestsMs),
    setupMinutes: setupMs === null || readyMs === null ? null : minutesBetween(setupMs, readyMs),
  };
}

/** "45 min", "2 h", "2 h 30 min": minutes under two hours stay minutes, as the sheet has always said them. */
export function sheetDurationWords(minutes: number): string {
  const whole = Math.abs(Math.round(minutes));
  if (whole < 120) return `${String(whole)} min`;
  const rest = whole % 60;
  return `${String(Math.floor(whole / 60))} h${rest === 0 ? "" : ` ${String(rest)} min`}`;
}

/** How Ready by stands to guests coming in: "when guests come in", "15 min before guests come in" or "15 min after guests come in"; null without both times. */
export function readyByWords(times: SheetTimes): string | null {
  const minutes = times.readyBeforeGuestsMinutes;
  if (minutes === null) return null;
  if (minutes === 0) return "when guests come in";
  return `${sheetDurationWords(minutes)} ${minutes > 0 ? "before" : "after"} guests come in`;
}

/** The setup window in words: "60 min to set the room", or that it leaves none; null without both times. */
export function setupFromWords(times: SheetTimes): string | null {
  const minutes = times.setupMinutes;
  if (minutes === null) return null;
  return minutes > 0 ? `${sheetDurationWords(minutes)} to set the room` : "Not before the room's ready-by time";
}

// ---------------------------------------------------------------- the day --

export interface DayLine {
  /** ISO instant; the renderer prints it on the venue's clock. */
  readonly at: string;
  readonly title: string;
  readonly detail: string | null;
  /** Room ready and Event starts: the two times the day turns on. */
  readonly emphasis: boolean;
  /** Falls after the time it must come before: a phase deadline after the room's ready-by time, or Room ready after guests come in. */
  readonly late: boolean;
  /** Room ready falls after guests come in (a planner's final time after the doors). */
  readonly afterGuests: boolean;
  /** Falls on another venue-local day than the event starts (the night before, after midnight). */
  readonly otherDay: boolean;
}

const BRIEFING_DETAIL = "Evacuation, invacuation, lockdown and communication";

/**
 * Every time on the sheet in one sequence: setup starting, phase deadlines,
 * the room ready, guests coming in, each door's opening and locking, and the
 * team briefing. The planner's final-touches time is the room's ready-by time
 * (sheetTimes), so it folds into "Room ready" and lends it its reason; and a
 * room ready as guests come in is one moment, printed once as "Room ready,
 * guests in".
 */
export function sheetRunningOrder(sheet: HallkeeperSheetV2): DayLine[] {
  const timeZone = sheet.venue.timezone;
  const ins = sheet.instructions;
  const times = sheetTimes(sheet);
  const readyMs = instantMs(times.readyBy);
  const final = plannerFinal(ins);
  const eventDay = sheet.timing === null ? null : venueDay(sheet.timing.eventStart, timeZone);
  const lines: (DayLine & { readonly ms: number })[] = [];
  const add = (at: string, title: string, detail: string | null, emphasis = false, late = false, afterGuests = false): void => {
    lines.push({ at, ms: Date.parse(at), title, detail, emphasis, late, afterGuests, otherDay: eventDay !== null && venueDay(at, timeZone) !== eventDay });
  };
  const text = (value: string): string | null => (value.trim().length > 0 ? value.trim() : null);

  if (times.setupFrom !== null) add(times.setupFrom, "Setup starts", null);
  for (const deadline of ins?.phaseDeadlines ?? []) {
    if (deadline === final) continue;
    add(deadline.deadline, `${phaseLabel(deadline.phase)} done`, text(deadline.reason), false, readyMs !== null && Date.parse(deadline.deadline) > readyMs);
  }
  const together = times.readyBeforeGuestsMinutes === 0;
  const afterGuests = times.readyBeforeGuestsMinutes !== null && times.readyBeforeGuestsMinutes < 0;
  if (times.readyBy !== null) add(times.readyBy, together ? "Room ready, guests in" : "Room ready", final === null ? null : text(final.reason), true, afterGuests, afterGuests);
  if (times.guestsIn !== null && !together) add(times.guestsIn, "Event starts", null, true);
  for (const door of ins?.doorSchedule?.entries ?? []) {
    for (const event of door.events) add(event.at, `${door.label} ${event.kind === "open" ? "opens" : "locks"}`, text(event.note));
  }
  const briefingAt = ins?.protectedPremises?.briefingAt;
  if (briefingAt !== undefined && Number.isFinite(Date.parse(briefingAt))) add(briefingAt, "Team briefing", BRIEFING_DETAIL);

  return lines
    .filter((line) => Number.isFinite(line.ms))
    .sort((a, b) => a.ms - b.ms)
    .map(({ ms: _ms, ...line }) => line);
}

// -------------------------------------------------------------- the store --

export interface StoreItem { readonly name: string; readonly qty: number }
export interface StoreGroup { readonly title: string; readonly items: readonly StoreItem[] }

const OTHER_GROUP = "Bar, service and other";
const STORE_GROUP: Readonly<Record<string, string>> = {
  table: "Tables",
  chair: "Chairs",
  stage: "Staging and floor",
  decor: "Linen and dressing",
  av: "Sound and vision",
  lectern: "Sound and vision",
};
const STORE_ORDER = ["Tables", "Chairs", "Staging and floor", "Linen and dressing", "Sound and vision", OTHER_GROUP];

/** The generator's name for a table with the chairs seated at it. */
const WITH_CHAIRS = /^(.*) with (\d+) chairs?$/u;
/** Chairs a sheet frozen without a plan knows only by count. */
const SEATED_CHAIRS = "Chairs for the tables";

/**
 * What to bring from the store: every placed piece counted from the frozen
 * plan (grouped chairs included) plus the accessories the manifest implies,
 * whose quantities the generator has already multiplied per parent. A sheet
 * frozen without a plan falls back to the manifest's own totals, where the
 * chairs at a table live in the table's name ("… with 10 chairs").
 */
export function sheetStoreList(sheet: HallkeeperSheetV2): StoreGroup[] {
  const groups = new Map<string, Map<string, number>>();
  const add = (category: string, name: string, qty: number): void => {
    const title = STORE_GROUP[category] ?? OTHER_GROUP;
    const items = groups.get(title) ?? new Map<string, number>();
    items.set(name, (items.get(name) ?? 0) + qty);
    groups.set(title, items);
  };
  const plan = sheet.floorPlan ?? null;
  if (plan !== null) {
    for (const object of plan.objects) add(object.category, object.name, 1);
    for (const phase of sheet.phases) for (const zone of phase.zones) for (const row of zone.rows) {
      if (row.isAccessory) add(row.category, row.name, row.qty);
    }
  } else {
    for (const entry of sheet.totals.entries) {
      // Only a table's row seats chairs. The generator before T-672 also named
      // other pieces in the group "… with N chairs"; they stay as written, so a
      // group's chairs come once from its table. An old copy that grouped two
      // tables gave each the group's chairs, and without a plan the sheet
      // cannot say whose they were: there the chairs count once per table, as
      // that copy's setup list reads them.
      const seated = entry.category === "table" ? WITH_CHAIRS.exec(entry.name) : null;
      if (seated?.[1] === undefined || seated[2] === undefined) { add(entry.category, entry.name, entry.qty); continue; }
      add(entry.category, seated[1], entry.qty);
      add("chair", SEATED_CHAIRS, entry.qty * Number(seated[2]));
    }
  }
  return STORE_ORDER.flatMap((title) => {
    const items = groups.get(title);
    if (items === undefined) return [];
    return [{
      title,
      items: [...items].map(([name, qty]) => ({ name, qty })).sort((a, b) => b.qty - a.qty || a.name.localeCompare(b.name)),
    }];
  });
}

// ------------------------------------------------------------ setup steps --

export interface SetupItem {
  readonly name: string;
  readonly qty: number;
  /** Chairs set at these tables, read from the generator's "with N chairs". */
  readonly chairs: { readonly total: number; readonly each: number | null } | null;
  /** Where the pieces go, busiest zone first. */
  readonly where: readonly { readonly zone: Zone; readonly qty: number }[];
  /** The planner's notes, each printed only at its first row in the setup. */
  readonly notes: readonly string[];
  readonly accessory: boolean;
  /** The planner's names for these pieces ("Table 1"); formatTableLabels prints them. */
  readonly labels: readonly string[];
}

const TABLE_LABEL = /^Table\s+(\d+)$/iu;

/**
 * The planner's names for a row's pieces as a crew reads them: numbered
 * tables run together ("Table 4", "Tables 1–3, 5, 7–8"); any other names are
 * listed as they were written. Empty when there are none.
 */
export function formatTableLabels(labels: readonly string[]): string {
  const unique = [...new Set(labels.map((label) => label.trim()).filter((label) => label.length > 0))];
  if (unique.length === 0) return "";
  const numbers = unique.map((label) => TABLE_LABEL.exec(label)?.[1]);
  if (numbers.every((value): value is string => value !== undefined)) {
    const sorted = [...new Set(numbers.map(Number))].sort((a, b) => a - b);
    const runs: string[] = [];
    let start = sorted[0] ?? 0;
    let previous = start;
    for (const value of [...sorted.slice(1), Number.NaN]) {
      if (value === previous + 1) { previous = value; continue; }
      runs.push(start === previous ? String(start) : `${String(start)}–${String(previous)}`);
      start = value;
      previous = value;
    }
    return `${sorted.length === 1 ? "Table" : "Tables"} ${runs.join(", ")}`;
  }
  return [...unique].sort((a, b) => a.localeCompare(b, "en-GB", { numeric: true })).join(", ");
}

export interface SetupStep {
  readonly phase: SetupPhase;
  readonly label: string;
  readonly deadline: { readonly at: string; readonly reason: string | null; readonly late: boolean; readonly otherDay: boolean } | null;
  readonly items: readonly SetupItem[];
}

const NOTE_SEPARATOR = " · ";

interface WholeNote {
  readonly note: string;
  readonly pieces: readonly string[];
}

/** The notes that contain the separator themselves, as their pieces, the longest first. */
function wholeNotes(notes: readonly string[]): WholeNote[] {
  return [...new Set(notes)]
    .filter((note) => note.includes(NOTE_SEPARATOR))
    .map((note) => ({ note, pieces: note.split(NOTE_SEPARATOR).map((piece) => piece.trim()) }))
    .sort((a, b) => b.pieces.length - a.pieces.length);
}

/**
 * A row's notes, one per piece of advice. The generator joins notes with
 * " · ", which a planner may also type inside one note; a note the plan holds
 * whole stays in one piece, so its plan marker still matches.
 */
function splitNotes(text: string, whole: readonly WholeNote[]): string[] {
  const parts = text.split(NOTE_SEPARATOR).map((part) => part.trim());
  const notes: string[] = [];
  for (let i = 0; i < parts.length;) {
    const match = whole.find(({ pieces }) => pieces.every((piece, offset) => parts[i + offset] === piece));
    notes.push(match?.note ?? parts[i] ?? "");
    i += match?.pieces.length ?? 1;
  }
  return notes;
}

interface ItemDraft {
  name: string;
  qty: number;
  chairTotal: number;
  chairEach: Set<number>;
  /** A merged row carried no chairs, so "N chairs each" would overstate. */
  someBare: boolean;
  where: Map<Zone, number>;
  notes: string[];
  accessory: boolean;
  labels: string[];
}

/**
 * The phases a room is built in, each item merged across the zones it is
 * set in (one dance floor is one line, not three), with the planner's
 * deadline for the phase. A note prints once, where it first belongs, so an
 * allergy on a table does not repeat on its linen.
 */
export function sheetSetupSteps(sheet: HallkeeperSheetV2): SetupStep[] {
  // Late means after the room's ready-by time (sheetTimes), never after the
  // setup window merely opens: a step due at 07:30 for 08:00 doors is on time.
  const readyMs = instantMs(sheetTimes(sheet).readyBy);
  const timeZone = sheet.venue.timezone;
  const eventDay = sheet.timing === null ? null : venueDay(sheet.timing.eventStart, timeZone);
  const seenNotes = new Set<string>();
  const planNotes = new Map<string, string>();
  for (const object of sheet.floorPlan?.objects ?? []) if (object.note !== undefined) planNotes.set(object.objectId, object.note);
  const anyWhole = wholeNotes([...planNotes.values()]);
  // A row's notes are its own pieces' notes, so only those can stand whole in
  // it; two notes that happen to read as a third piece's note stay two. A row
  // with no pieces of its own (an accessory's, which carries its parent's
  // note) may hold any of the plan's.
  const wholeOf = (positions: readonly { readonly objectId: string }[]): readonly WholeNote[] => positions.length === 0
    ? anyWhole
    : wholeNotes(positions.flatMap((position) => { const note = planNotes.get(position.objectId); return note === undefined ? [] : [note]; }));
  return sheet.phases.filter((phase) => phase.zones.some((zone) => zone.rows.length > 0)).map((phase) => {
    const drafts = new Map<string, ItemDraft>();
    for (const zone of phase.zones) for (const row of zone.rows) {
      const chairs = WITH_CHAIRS.exec(row.name);
      const name = chairs?.[1] ?? row.name;
      const key = `${name}|${String(row.afterDepth)}|${String(row.isAccessory)}`;
      const draft = drafts.get(key) ?? { name, qty: 0, chairTotal: 0, chairEach: new Set<number>(), someBare: false, where: new Map<Zone, number>(), notes: [], accessory: row.isAccessory, labels: [] };
      draft.qty += row.qty;
      draft.labels.push(...(row.labels ?? []));
      if (chairs?.[2] !== undefined) {
        const each = Number(chairs[2]);
        draft.chairTotal += row.qty * each;
        draft.chairEach.add(each);
      } else {
        draft.someBare = true;
      }
      draft.where.set(zone.zone, (draft.where.get(zone.zone) ?? 0) + row.qty);
      for (const note of splitNotes(row.notes, wholeOf(row.positions))) {
        if (note.length === 0 || seenNotes.has(note)) continue;
        seenNotes.add(note);
        draft.notes.push(note);
      }
      drafts.set(key, draft);
    }
    const deadline = sheet.instructions?.phaseDeadlines.find((candidate) => candidate.phase === phase.phase) ?? null;
    return {
      phase: phase.phase,
      label: phaseLabel(phase.phase),
      deadline: deadline === null ? null : {
        at: deadline.deadline,
        reason: deadline.reason.trim().length > 0 ? deadline.reason.trim() : null,
        late: readyMs !== null && Date.parse(deadline.deadline) > readyMs,
        otherDay: eventDay !== null && venueDay(deadline.deadline, timeZone) !== eventDay,
      },
      items: [...drafts.values()].map((draft) => ({
        name: draft.name,
        qty: draft.qty,
        chairs: draft.chairEach.size === 0 ? null : { total: draft.chairTotal, each: draft.chairEach.size === 1 && !draft.someBare ? [...draft.chairEach][0] ?? null : null },
        where: [...draft.where].map(([zone, qty]) => ({ zone, qty })).sort((a, b) => b.qty - a.qty),
        notes: draft.notes,
        accessory: draft.accessory,
        labels: draft.labels,
      })),
    };
  });
}

// ------------------------------------------------------------ plan markers --

/**
 * The number each noted piece wears on the printed plan, keyed by its note:
 * reading order, top row first (rows half a metre deep), then left to right.
 * A note carried by two pieces keeps the first number.
 */
export function sheetNoteMarkers(sheet: HallkeeperSheetV2): Map<string, number> {
  const noted = (sheet.floorPlan?.objects ?? []).filter((object) => object.note !== undefined);
  noted.sort((a, b) => Math.round(a.z * 2) - Math.round(b.z * 2) || a.x - b.x);
  const markers = new Map<string, number>();
  for (const object of noted) {
    if (object.note !== undefined && !markers.has(object.note)) markers.set(object.note, markers.size + 1);
  }
  return markers;
}

// ----------------------------------------------------------- keep in view --

/** The venue's zone in words, never its IANA name: "UK time", "Eastern time". */
export function venueZoneLabel(timeZone: string): string {
  try {
    const name = new Intl.DateTimeFormat("en-GB", { timeZone, timeZoneName: "longGeneric" })
      .formatToParts(0).find((part) => part.type === "timeZoneName")?.value ?? timeZone;
    return name.replace(/^United Kingdom\b/u, "UK").replace(/ Time$/u, " time");
  } catch {
    return timeZone;
  }
}

/** A guest's access needs as short phrases, in the order the brief ranks
 *  them: what must be in place before guests arrive first, then routes and
 *  print, then the planner's own words as written. */
export function accessNeeds(access: AccessibilityRequirements | null): readonly string[] {
  if (access === null) return [];
  const needs: string[] = [];
  if (access.hearingLoopRequired) needs.push(access.hearingLoopZone === null ? "Hearing loop, zone not set" : `Hearing loop in ${access.hearingLoopZone}`);
  if (access.wheelchairSpaces > 0) needs.push(`${String(access.wheelchairSpaces)} wheelchair ${access.wheelchairSpaces === 1 ? "space" : "spaces"}`);
  if (access.signLanguageInterpreter) needs.push("Sign-language interpreter attending");
  if (access.stepFreeRouteRequired) needs.push("Step-free route to seating");
  if (access.largePrintProgrammes > 0) needs.push(`${String(access.largePrintProgrammes)} large-print ${access.largePrintProgrammes === 1 ? "programme" : "programmes"}`);
  const notes = access.notes.trim();
  if (notes.length > 0) needs.push(notes);
  return needs;
}

export interface AllergyFacts {
  /** Meals made for an allergen, from the planner's counts, each a phrase a
   *  line should not break inside: ["3 nut-free", "2 gluten-free"]. */
  readonly counts: readonly string[];
  /** The noun the counts share: "meal" for one in all, else "meals". */
  readonly noun: "meal" | "meals";
  /** The planner's own words about allergies, as written. */
  readonly notes: string | null;
}

/** The allergies the planner recorded, or null when they recorded none.
 *  Nut-free and gluten-free meals are the counts that answer to allergens;
 *  vegetarian, vegan, halal and kosher stay with the brief. */
export function allergyFacts(dietary: DietarySummary | null): AllergyFacts | null {
  if (dietary === null) return null;
  const counts = [
    dietary.nutFree > 0 ? `${String(dietary.nutFree)} nut-free` : null,
    dietary.glutenFree > 0 ? `${String(dietary.glutenFree)} gluten-free` : null,
  ].filter((part): part is string => part !== null);
  const notes = dietary.otherAllergies.trim();
  if (counts.length === 0 && notes.length === 0) return null;
  return { counts, noun: dietary.nutFree + dietary.glutenFree === 1 ? "meal" : "meals", notes: notes.length > 0 ? notes : null };
}

/** The special meals that are not allergens: "14 vegetarian · 4 vegan". */
export function otherMeals(dietary: DietarySummary | null): string | null {
  if (dietary === null) return null;
  const parts = ([
    [dietary.vegetarian, "vegetarian"], [dietary.vegan, "vegan"], [dietary.halal, "halal"], [dietary.kosher, "kosher"],
  ] as const).filter(([count]) => count > 0).map(([count, word]) => `${String(count)} ${word}`);
  return parts.length === 0 ? null : parts.join(" · ");
}

/** "Table 5": the number (or letter) a planner's label gives a table, as care words call it. */
const NUMBERED_LABEL = /^table\s+(\S+)$/iu;

/** A label of digits or of one character ("12", "A"): a table only where the words call it one. */
function bareLabel(label: string): boolean {
  return /^\p{N}+$/u.test(label) || label.length < 2;
}

/** A label as a pattern that matches it only as a whole phrase, in any case. */
function wholePhrase(label: string): RegExp {
  const escaped = label.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
  return new RegExp(`(?<![\\p{L}\\p{N}])${escaped}(?![\\p{L}\\p{N}])`, "iu");
}

// A run of tables' names after "table" or "tables", as the setup's own lines
// write one ("Tables 1–3, 5, 7–8") or as people do ("tables 4 and 5", "table
// A & B"). A name is a range of numbers, a number or a code with one ("12",
// "4b", "A1"), or one letter, never a time ("10:30"). The names after the
// first are joined by a comma, "and", "or" or "&", and are of the first one's
// kind. Each joins only where the run goes on or its clause ends after it: a
// word after it makes it a count ("Table 7, 1 coeliac", "table 4 and 2 guests").
// After "tables" and an "and", "or" or "&" the run is meant ("Tables 4 and 5
// are nut-free"); a comma never carries one into a number a word follows.
const TABLE_WORD = /(?<![\p{L}\p{N}])(tables?)\s+/giu;
const FIRST_NAME = /(?:(\d+)[–—-](\d+)|(\p{L}?\p{N}+\p{L}?)|(\p{L}))(?![\p{L}\p{N}]|[:.]\d)/yu;
/** What joins a further name to a run: a comma, "and", "or" or "&", alone or after a comma. */
const JOINER = /\s*,\s*(?:(?:and|or|AND|OR)\s+|&\s*)?|\s*&\s*|\s+(?:and|or|AND|OR)\s+/yu;
/** A further name in the run; a letter only as a capital, so "and a guest" adds no table A. */
const NEXT_NAME = /(?:(\d+)[–—-](\d+)|(\p{L}?\p{N}+\p{L}?)|(\p{Lu}))(?![\p{L}\p{N}]|[:.]\d)/yu;
/** What may follow a name that joins a run: another joiner, or the end of its clause. */
const RUN_GOES_ON = /[ \t]*(?:[,&:;.)!?–—\n]|-[ \t]|(?:and|or|AND|OR)(?![\p{L}\p{N}])|$)/yu;

/** Every name such runs give, in lower case, each range spelled out. */
function namesInRuns(words: string): ReadonlySet<string> {
  const names = new Set<string>();
  const add = ([, from, to, code, letter]: RegExpExecArray): void => {
    if (from !== undefined && to !== undefined) {
      const start = Number(from);
      const end = Number(to);
      if (end >= start && end - start <= 200) {
        for (let n = start; n <= end; n++) names.add(String(n));
      } else {
        names.add(from);
        names.add(to);
      }
      return;
    }
    names.add((code ?? letter ?? "").toLowerCase());
  };
  for (const head of words.matchAll(TABLE_WORD)) {
    FIRST_NAME.lastIndex = head.index + head[0].length;
    const first = FIRST_NAME.exec(words);
    if (first === null) continue;
    add(first);
    const letters = first[4] !== undefined;
    const plural = (head[1] ?? "").toLowerCase() === "tables";
    for (let at = FIRST_NAME.lastIndex; ;) {
      JOINER.lastIndex = at;
      const joiner = JOINER.exec(words);
      if (joiner === null) break;
      NEXT_NAME.lastIndex = JOINER.lastIndex;
      const next = NEXT_NAME.exec(words);
      if (next === null || (next[4] !== undefined) !== letters) break;
      RUN_GOES_ON.lastIndex = NEXT_NAME.lastIndex;
      const closes = RUN_GOES_ON.test(words);
      const announced = plural && !/^\s*,\s*$/u.test(joiner[0]);
      if (!closes && !announced) break;
      add(next);
      at = NEXT_NAME.lastIndex;
    }
  }
  return names;
}

/** The plan's tables the care words name ("Table 5, seat 4: …", "go on table
 *  3", "Tables 4 and 5 are nut-free"), by the planner's own labels, so the plan
 *  can ring where care is needed. The care words are the planner's own access
 *  and allergy notes, not the counts Keep in view adds to them. A table counts
 *  when the words give its number or letter after "table" or "tables", alone or
 *  in a run ("Tables 1–3, 5 and 7"), or name it in full as a whole phrase in
 *  any case ("the top table"). So "Table 1" never rings because of "Table 10",
 *  and "2 guests" or "a wheelchair" names no table; only tables are ringed. */
export function careTables(sheet: HallkeeperSheetV2): ReadonlySet<string> {
  const ringed = new Set<string>();
  const plan = sheet.floorPlan ?? null;
  const instructions = sheet.instructions;
  // The planner's own words only: "1 wheelchair space" is the sheet's count, not a table.
  const words = [instructions?.accessibility?.notes ?? "", allergyFacts(instructions?.dietary ?? null)?.notes ?? ""].join("\n");
  if (plan === null || words.trim().length === 0) return ringed;
  const named = namesInRuns(words);
  for (const object of plan.objects) {
    const label = object.label?.trim() ?? "";
    if (object.category !== "table" || label.length === 0) continue;
    const bare = bareLabel(label);
    const name = bare ? label : NUMBERED_LABEL.exec(label)?.[1];
    if ((name !== undefined && named.has(name.toLowerCase())) || (!bare && wholePhrase(label).test(words))) ringed.add(label);
  }
  return ringed;
}
