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

// ---------------------------------------------------------------- the day --

export interface DayLine {
  /** ISO instant; the renderer prints it on the venue's clock. */
  readonly at: string;
  readonly title: string;
  readonly detail: string | null;
  /** Room ready and Event starts: the two times the day turns on. */
  readonly emphasis: boolean;
  /** A planner's phase deadline later than the room's ready-by time. */
  readonly late: boolean;
  /** Falls on another venue-local day than the event starts (the night before, after midnight). */
  readonly otherDay: boolean;
}

const BRIEFING_DETAIL = "Evacuation, invacuation, lockdown and communication";

/**
 * Every time on the sheet in one sequence: phase deadlines, the ready-by
 * time, the start, each door's opening and locking, and the team briefing.
 * A final-touches deadline at the ready-by time is the same moment, so it
 * folds into "Room ready" and lends it its reason.
 */
export function sheetRunningOrder(sheet: HallkeeperSheetV2): DayLine[] {
  const timeZone = sheet.venue.timezone;
  const ins = sheet.instructions;
  const setupBy = sheet.timing?.setupBy ?? null;
  const setupByMs = setupBy === null ? null : Date.parse(setupBy);
  const eventDay = sheet.timing === null ? null : venueDay(sheet.timing.eventStart, timeZone);
  const lines: (DayLine & { readonly ms: number })[] = [];
  const add = (at: string, title: string, detail: string | null, emphasis = false, late = false): void => {
    lines.push({ at, ms: Date.parse(at), title, detail, emphasis, late, otherDay: eventDay !== null && venueDay(at, timeZone) !== eventDay });
  };
  const text = (value: string): string | null => (value.trim().length > 0 ? value.trim() : null);

  let readyDetail: string | null = null;
  for (const deadline of ins?.phaseDeadlines ?? []) {
    const ms = Date.parse(deadline.deadline);
    if (deadline.phase === "final" && setupByMs !== null && ms === setupByMs) {
      readyDetail = text(deadline.reason);
      continue;
    }
    add(deadline.deadline, `${phaseLabel(deadline.phase)} done`, text(deadline.reason), false, setupByMs !== null && ms > setupByMs);
  }
  if (setupBy !== null) add(setupBy, "Room ready", readyDetail, true);
  if (sheet.timing !== null) add(sheet.timing.eventStart, "Event starts", null, true);
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

/**
 * What to bring from the store: every placed piece counted from the frozen
 * plan (grouped chairs included) plus the accessories the manifest implies,
 * whose quantities the generator has already multiplied per parent. A sheet
 * frozen without a plan falls back to the manifest's own totals.
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
    for (const entry of sheet.totals.entries) add(entry.category, entry.name, entry.qty);
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

const WITH_CHAIRS = /^(.*) with (\d+) chairs?$/u;
const NOTE_SEPARATOR = " · ";

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
  const setupBy = sheet.timing?.setupBy ?? null;
  const timeZone = sheet.venue.timezone;
  const eventDay = sheet.timing === null ? null : venueDay(sheet.timing.eventStart, timeZone);
  const seenNotes = new Set<string>();
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
      for (const note of row.notes.split(NOTE_SEPARATOR).map((part) => part.trim())) {
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
        late: setupBy !== null && Date.parse(deadline.deadline) > Date.parse(setupBy),
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
