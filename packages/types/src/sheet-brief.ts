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

/**
 * Chairs set at the tables of one of a step's lines: how many, how many at
 * each table when the place holds more than one table and every one seats the
 * same, and the tables: by the planner's names when they name every table the
 * line counts ("Tables 1–11", "Top table"), else the line's own name with its
 * count ("11 × 6ft Round Table", the count tied to its sign by a no-break space).
 */
export interface SeatsAt {
  readonly qty: number;
  readonly each: number | null;
  readonly tables: string;
}

export interface SetupItem {
  readonly name: string;
  readonly qty: number;
  /**
   * Chairs set at these tables, read from the generator's "with N chairs":
   * what a setup short enough to sit under the brief prints on the table's
   * own line. Null on every line but a table's that seats chairs.
   */
  readonly chairs: { readonly total: number; readonly each: number | null } | null;
  /**
   * On the line of chairs that follows a step's tables: the chairs each table
   * line seats, which the setup's own page prints instead (study D). Null on
   * every other line.
   */
  readonly seats: readonly SeatsAt[] | null;
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
  /** The plan pieces its rows list, by id. */
  pieces: string[];
}

/** The chairs at each of an item's tables, when every one seats the same; null when they differ or some seat none. */
function chairsEach(draft: ItemDraft): number | null {
  return draft.chairEach.size === 1 && !draft.someBare ? [...draft.chairEach][0] ?? null : null;
}

/**
 * The chairs the plan seats at its tables, which have no line of their own:
 * the generator folds each into its table's "… with N chairs". They are the
 * plan's chairs that no line lists (an accessory's line may list the chairs
 * it dresses). Their model names them when they are all one model and as
 * many as the tables' lines count, so the line agrees with the store.
 */
function seatedChairs(sheet: HallkeeperSheetV2, seatedTotal: number): { readonly name: string; readonly notes: readonly string[] } {
  const listed = new Set<string>();
  for (const phase of sheet.phases) for (const zone of phase.zones) for (const row of zone.rows) {
    if (!row.isAccessory) for (const position of row.positions) listed.add(position.objectId);
  }
  const seated = (sheet.floorPlan?.objects ?? []).filter((object) => object.category === "chair" && !listed.has(object.objectId));
  const models = new Set(seated.map((chair) => chair.name));
  const [model] = models;
  return {
    name: models.size === 1 && model !== undefined && seated.length === seatedTotal ? model : SEATED_CHAIRS,
    notes: seated.flatMap((chair) => (chair.note === undefined ? [] : [chair.note])),
  };
}

/** A table's line as the generator writes it, "… with N chairs": the table, and the chairs seated at each. Only a table's line seats chairs. */
function tableWithChairs(row: { readonly name: string; readonly category: string }): { readonly name: string; readonly each: number } | null {
  const seated = row.category === "table" ? WITH_CHAIRS.exec(row.name) : null;
  return seated?.[1] === undefined || seated[2] === undefined ? null : { name: seated[1], each: Number(seated[2]) };
}

type PlanPiece = NonNullable<HallkeeperSheetV2["floorPlan"]>["objects"][number];

/** A piece's ground in metres, square to the room: x across it, z down it (its turned corners' box). */
function groundOf(piece: PlanPiece): { readonly left: number; readonly right: number; readonly front: number; readonly back: number } {
  const halfW = piece.widthM * piece.scale / 2;
  const halfD = piece.depthM * piece.scale / 2;
  const reachX = Math.abs(Math.cos(piece.rotationY)) * halfW + Math.abs(Math.sin(piece.rotationY)) * halfD;
  const reachZ = Math.abs(Math.sin(piece.rotationY)) * halfW + Math.abs(Math.cos(piece.rotationY)) * halfD;
  return { left: piece.x - reachX, right: piece.x + reachX, front: piece.z - reachZ, back: piece.z + reachZ };
}

/** How far two pieces in one line may stand apart, and still set end to end, in metres. */
const END_TO_END_M = 0.15;
/** How far their sides may differ and still stand in one line, in metres. */
const IN_LINE_M = 0.05;

/** Two box pieces set end to end: in one line across the room or down it, touching (a top table's trestles). */
function endToEnd(a: PlanPiece, b: PlanPiece): boolean {
  if (a.collisionType !== "box" || b.collisionType !== "box") return false;
  const p = groundOf(a);
  const q = groundOf(b);
  const across = Math.abs(p.front - q.front) < IN_LINE_M && Math.abs(p.back - q.back) < IN_LINE_M
    && Math.max(p.left - q.right, q.left - p.right) <= END_TO_END_M;
  const down = Math.abs(p.left - q.left) < IN_LINE_M && Math.abs(p.right - q.right) < IN_LINE_M
    && Math.max(p.front - q.back, q.front - p.back) <= END_TO_END_M;
  return across || down;
}

/**
 * How many of an item's tables the planner's names cover: each named piece,
 * and the unnamed pieces of the item standing end to end with one (the plan
 * sets a top table's name along its trestles). Without a plan that lists every
 * piece, only as many as the names themselves, each naming at least one.
 */
function namedTables(draft: ItemDraft, names: readonly string[], plan: ReadonlyMap<string, PlanPiece> | null): number {
  const pieces = plan === null ? [] : draft.pieces.flatMap((id) => { const piece = plan.get(id); return piece === undefined ? [] : [piece]; });
  if (pieces.length !== draft.qty) return names.length;
  const named = new Set(pieces.filter((piece) => (piece.label?.trim() ?? "").length > 0));
  for (let grown = true; grown;) {
    grown = false;
    for (const piece of pieces) {
      if (named.has(piece) || ![...named].some((other) => endToEnd(piece, other))) continue;
      named.add(piece);
      grown = true;
    }
  }
  return named.size;
}

/**
 * Where one item's tables seat their chairs: the tables by the planner's
 * names only when they cover every table the line counts, so a line of eleven
 * with Table 5 named reads "11 × 6ft Round Table", never "Table 5". The count
 * at each table only where the place holds more than one table, each its own
 * piece: one table's chairs are all at it, and four at each trestle of a top
 * table is not four at the table.
 */
function seatsAt(draft: ItemDraft, plan: ReadonlyMap<string, PlanPiece> | null): SeatsAt {
  const names = [...new Set(draft.labels.map((label) => label.trim()).filter((label) => label.length > 0))];
  const named = names.length > 0 && namedTables(draft, names, plan) === draft.qty;
  const tables = named ? formatTableLabels(names) : draft.qty > 1 ? `${String(draft.qty)}\u00A0× ${draft.name}` : draft.name;
  const several = named ? names.length > 1 && names.length === draft.qty : draft.qty > 1;
  return { qty: draft.chairTotal, each: several ? chairsEach(draft) : null, tables };
}

export interface SetupStepsOptions {
  /**
   * Whether the chairs at a step's tables get a line of their own (the
   * setup's own page) and claim their chairs' notes. False for a setup short
   * enough to sit under the brief on page 1, which keeps each table's chairs
   * on its own line: there the chairs' notes go to the next line that carries
   * them, or among the plan's notes.
   */
  readonly chairsLine?: boolean;
}

/**
 * The phases a room is built in, each item merged across the zones it is
 * set in (one dance floor is one line, not three), with the planner's
 * deadline for the phase. The tables that seat chairs lead their step, and
 * (unless `chairsLine` is false) a line of their own follows them with the
 * chairs: how many go to which tables, with the seated chairs' notes. A note
 * prints once, where it first belongs, so an allergy on a table does not
 * repeat on its linen.
 */
export function sheetSetupSteps(sheet: HallkeeperSheetV2, { chairsLine = true }: SetupStepsOptions = {}): SetupStep[] {
  const setupBy = sheet.timing?.setupBy ?? null;
  const timeZone = sheet.venue.timezone;
  const eventDay = sheet.timing === null ? null : venueDay(sheet.timing.eventStart, timeZone);
  const seenNotes = new Set<string>();
  const planNotes = new Map<string, string>();
  for (const object of sheet.floorPlan?.objects ?? []) if (object.note !== undefined) planNotes.set(object.objectId, object.note);
  const plan = sheet.floorPlan === null || sheet.floorPlan === undefined ? null : new Map(sheet.floorPlan.objects.map((object) => [object.objectId, object]));
  let seatedTotal = 0;
  for (const phase of sheet.phases) for (const zone of phase.zones) for (const row of zone.rows) {
    seatedTotal += row.qty * (tableWithChairs(row)?.each ?? 0);
  }
  const chairs = seatedChairs(sheet, seatedTotal);
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
      const table = tableWithChairs(row);
      const name = table?.name ?? row.name;
      const key = `${name}|${String(row.afterDepth)}|${String(row.isAccessory)}`;
      const draft = drafts.get(key) ?? { name, qty: 0, chairTotal: 0, chairEach: new Set<number>(), someBare: false, where: new Map<Zone, number>(), notes: [], accessory: row.isAccessory, labels: [], pieces: [] };
      draft.qty += row.qty;
      draft.labels.push(...(row.labels ?? []));
      draft.pieces.push(...row.positions.map((position) => position.objectId));
      if (table === null) {
        draft.someBare = true;
      } else {
        draft.chairTotal += row.qty * table.each;
        draft.chairEach.add(table.each);
      }
      draft.where.set(zone.zone, (draft.where.get(zone.zone) ?? 0) + row.qty);
      for (const note of splitNotes(row.notes, wholeOf(row.positions))) {
        if (note.length === 0 || seenNotes.has(note)) continue;
        seenNotes.add(note);
        draft.notes.push(note);
      }
      drafts.set(key, draft);
    }
    // The tables that seat chairs lead the step, as a crew sets a room: then the chairs at them, then the rest in order.
    const seatingTables = [...drafts.values()].filter((draft) => draft.chairEach.size > 0);
    const drafted = [...seatingTables, ...[...drafts.values()].filter((draft) => draft.chairEach.size === 0)];
    const items: SetupItem[] = drafted.map((draft) => ({
      name: draft.name,
      qty: draft.qty,
      chairs: draft.chairEach.size === 0 ? null : { total: draft.chairTotal, each: chairsEach(draft) },
      seats: null,
      where: [...draft.where].map(([zone, qty]) => ({ zone, qty })).sort((a, b) => b.qty - a.qty),
      notes: draft.notes,
      accessory: draft.accessory,
      labels: draft.labels,
    }));
    // The chairs' notes are claimed only where their line prints, so under the brief a later line still carries them.
    if (chairsLine && seatingTables.length > 0) {
      const notes: string[] = [];
      for (const note of chairs.notes) {
        if (seenNotes.has(note)) continue;
        seenNotes.add(note);
        notes.push(note);
      }
      items.splice(seatingTables.length, 0, {
        name: chairs.name,
        qty: seatingTables.reduce((sum, draft) => sum + draft.chairTotal, 0),
        chairs: null,
        seats: seatingTables.map((draft) => seatsAt(draft, plan)),
        where: [],
        notes,
        accessory: false,
        labels: [],
      });
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
      items,
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

/**
 * A label as a pattern that matches it only as a whole phrase, in any case,
 * and never as the whole part of a decimal ("a table 1.2 m from the exit" does
 * not name Table 1), as the runs below read a name.
 */
function wholePhrase(label: string): RegExp {
  const escaped = label.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
  return new RegExp(`(?<![\\p{L}\\p{N}])${escaped}(?![\\p{L}\\p{N}]|\\.\\d)`, "iu");
}

// A run of tables' names after "table" or "tables", as the setup's own lines
// write one ("Tables 1–3, 5, 7–8") or as people do ("tables 4 and 5", "table
// A & B"). A name is a range of numbers, a number or a code with one ("12",
// "4b", "A1"), or one letter, never a clock time or a decimal: a number with
// two-digit minutes after a colon ("10:30"), or with any digit after a point
// ("12.30", "a table 1.2 m from the exit"). Shorthand with no space after a
// table's colon still names it when no clock's minutes follow ("Table 5:2
// coeliacs"). The names after the
// first are joined by a comma, "and", "or" or "&", and are of the first one's
// kind. Each joins only where the run goes on or its clause ends after it: a
// word after it makes it a count ("Table 7, 1 coeliac", "table 4 and 2 guests").
// After "tables" and an "and", "or" or "&" the run is meant ("Tables 4 and 5
// are nut-free"); a comma never carries one into a number a word follows.
const TABLE_WORD = /(?<![\p{L}\p{N}])(tables?)\s+/giu;
const FIRST_NAME = /(?:(\d+)[–—-](\d+)|(\p{L}?\p{N}+\p{L}?)|(\p{L}))(?![\p{L}\p{N}]|:[0-5]\d(?!\d)|\.\d)/yu;
/** What joins a further name to a run: a comma, "and", "or" or "&", alone or after a comma. */
const JOINER = /\s*,\s*(?:(?:and|or|AND|OR)\s+|&\s*)?|\s*&\s*|\s+(?:and|or|AND|OR)\s+/yu;
/** A further name in the run; a letter only as a capital, so "and a guest" adds no table A. */
const NEXT_NAME = /(?:(\d+)[–—-](\d+)|(\p{L}?\p{N}+\p{L}?)|(\p{Lu}))(?![\p{L}\p{N}]|:[0-5]\d(?!\d)|\.\d)/yu;
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
