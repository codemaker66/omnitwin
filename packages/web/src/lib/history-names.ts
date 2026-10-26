import { CATALOGUE_CARDS } from "./card-defaults.js";
import { getCatalogueItem, type CatalogueItem } from "./catalogue.js";
import { countLabel } from "./count-label.js";
import type { EditorHistory, HistoryDelta, HistoryEntry } from "./editor-history.js";
import type { EditorObject } from "../stores/editor-store.js";

// ---------------------------------------------------------------------------
// history-names — every undo step named in the venue's words (approved spec
// §6.9; QoL lens B-10, T-674).
//
// The editor store labels a step from its delta in engineering words ("Move
// item", "Place 11 items", "Rearrange items"). History, the dock's Undo
// tooltip and the receipts say what happened to the room instead: "Move
// Table 8", "Add Round of 10 · 11 pieces", "Remove 2 chairs at Table 3",
// "Turn Table 3", "Cloth on 8 tables", "Lay out 14 tables".
//
// A table and its chairs are one piece (they share a group), named by the
// table's own number when it wears one ("Table 8"), otherwise by its
// catalogue card ("Round 6 ft", "Lectern"). Pure: the catalogue is static
// data, and everything else comes in through the arguments.
// ---------------------------------------------------------------------------

/** What the namer may know beyond the step itself. */
export interface HistoryNameContext {
  /** The layout as it stands, to name pieces an update touched and the table a chair belongs to. */
  readonly objects?: readonly EditorObject[];
  /** The floor held nothing just before this step (first seen by history-clock). */
  readonly floorEmptyBefore?: boolean;
  /** The catalogue lookup; the static catalogue unless a test passes its own. */
  readonly item?: (assetDefinitionId: string) => CatalogueItem | undefined;
}

/** A step to name: an entry from the timeline, or a bare delta with an optional label. */
export type NameableStep = HistoryEntry<EditorObject> | (HistoryDelta<EditorObject> & { readonly label?: string });

/**
 * The editor store's own derived labels. Anything else came from the command
 * itself (B-10: commands passing their own words), and is used as it is.
 */
const DERIVED_LABEL = /^(?:(?:Move|Rotate|Resize|Rename|Edit) (?:item|\d+ items)|Place .+|Delete .+|Edit note|Change table setting|Update grouping|Change tablecloth|Rearrange items)$/u;

const POSITION_KEYS: ReadonlySet<string> = new Set(["positionX", "positionY", "positionZ"]);
const ROTATION_KEYS: ReadonlySet<string> = new Set(["rotationX", "rotationY", "rotationZ"]);
const CLOTH_KEYS: ReadonlySet<string> = new Set(["clothed", "clothStyle"]);
const DRESSING_KEYS: ReadonlySet<string> = new Set(["chairStyle", "centerpiece"]);

/** Seats along one trestle at a top table (one side), as lib/setup-cards' SEATS_PER_TRESTLE has it. */
const TOP_TABLE_SEATS_PER_TRESTLE = 3;

type Kind = "table" | "chair" | "dance-floor" | "piece";

interface Unit {
  /** The pieces of this unit the step itself touched. */
  readonly members: readonly EditorObject[];
  /** The table the unit is led by, from the step or the layout. */
  readonly lead: EditorObject | undefined;
  readonly leadItem: CatalogueItem | undefined;
  readonly kind: Kind;
}

interface Namer {
  readonly item: (id: string) => CatalogueItem | undefined;
  readonly objects: readonly EditorObject[];
}

function categoryOf(namer: Namer, object: EditorObject): CatalogueItem["category"] | undefined {
  return namer.item(object.assetDefinitionId)?.category;
}

function isChair(namer: Namer, object: EditorObject): boolean {
  return categoryOf(namer, object) === "chair";
}

function isDancePanel(namer: Namer, object: EditorObject): boolean {
  return namer.item(object.assetDefinitionId)?.slug === "dancefloor-panel";
}

/** The table that leads a group: one in the step first, else one standing in the layout. */
function leadOf(namer: Namer, groupId: string | null, members: readonly EditorObject[]): EditorObject | undefined {
  const notChair = (object: EditorObject): boolean => !isChair(namer, object);
  const inStep = members.find(notChair);
  if (inStep !== undefined || groupId === null) return inStep ?? members[0];
  return namer.objects.find((object) => object.groupId === groupId && notChair(object)) ?? members[0];
}

function unitsOf(namer: Namer, objects: readonly EditorObject[]): readonly Unit[] {
  const byKey = new Map<string, EditorObject[]>();
  for (const object of objects) {
    const key = object.groupId ?? object.id;
    const members = byKey.get(key);
    if (members === undefined) byKey.set(key, [object]);
    else members.push(object);
  }
  return [...byKey.values()].map((members): Unit => {
    const lead = leadOf(namer, members[0]?.groupId ?? null, members);
    const leadItem = lead === undefined ? undefined : namer.item(lead.assetDefinitionId);
    const kind: Kind = members.every((member) => isDancePanel(namer, member))
      ? "dance-floor"
      : leadItem?.category === "table"
        ? "table"
        : leadItem?.category === "chair"
          ? "chair"
          : "piece";
    return { members, lead, leadItem, kind };
  });
}

/** The catalogue card a piece belongs to names it ("Round 6 ft"); otherwise the catalogue's own name. */
function cardName(item: CatalogueItem): string {
  return CATALOGUE_CARDS.find((card) => card.variants.some((variant) => variant.slug === item.slug))?.name ?? item.name;
}

function chairsIn(namer: Namer, members: readonly EditorObject[]): number {
  return members.filter((member) => isChair(namer, member)).length;
}

/** What a new set is called: "Round of 10", "Long table", "Top table", "Dance floor". */
function setName(namer: Namer, unit: Unit): string | null {
  if (unit.kind === "dance-floor") return "Dance floor";
  if (unit.kind !== "table" || unit.leadItem === undefined) return null;
  const chairs = chairsIn(namer, unit.members);
  if (chairs === 0) return null;
  const tables = unit.members.filter((member) => categoryOf(namer, member) === "table");
  if (unit.leadItem.tableShape === "round" && tables.length === 1) return `Round of ${String(chairs)}`;
  const trestles = tables.filter((member) => namer.item(member.assetDefinitionId)?.slug.startsWith("trestle") === true);
  if (trestles.length > 0 && trestles.length === tables.length) {
    return chairs === trestles.length * TOP_TABLE_SEATS_PER_TRESTLE ? "Top table" : "Long table";
  }
  return null;
}

/** One piece's name: its number ("Table 8"), else its card ("Round 6 ft"). */
function unitName(unit: Unit): string {
  if (unit.kind === "dance-floor") return "the dance floor";
  const label = unit.lead?.label?.trim() ?? "";
  if (label !== "") return label;
  return unit.leadItem === undefined ? "a piece" : cardName(unit.leadItem);
}

const SET_PLURAL: readonly (readonly [RegExp, (match: RegExpExecArray, count: number) => string])[] = [
  [/^Round of (\d+)$/u, (match, count) => `${countLabel(count, "round")} of ${match[1] ?? ""}`],
  [/^Long table$/u, (_match, count) => countLabel(count, "long table")],
  [/^Top table$/u, (_match, count) => countLabel(count, "top table")],
  [/^Dance floor$/u, (_match, count) => countLabel(count, "dance floor")],
];

function kindNoun(units: readonly Unit[]): string {
  const count = units.length;
  const kinds = new Set(units.map((unit) => unit.kind));
  if (kinds.size === 1) {
    if (kinds.has("table")) return countLabel(count, "table");
    if (kinds.has("chair")) return countLabel(count, "chair");
    if (kinds.has("dance-floor")) return countLabel(count, "dance floor");
  }
  return countLabel(count, "piece");
}

/** Pieces as a phrase: one by its name, several as "8 tables", "4 rounds of 10" or "3 pieces". */
function unitsNoun(namer: Namer, units: readonly Unit[], asNew: boolean): string {
  const first = units[0];
  if (first === undefined) return "nothing";
  if (units.length === 1) {
    const set = asNew ? setName(namer, first) : null;
    return set ?? (asNew && first.kind === "dance-floor" ? "Dance floor" : unitName(first));
  }
  if (asNew) {
    const names = new Set(units.map((unit) => setName(namer, unit)));
    const only = [...names][0];
    if (names.size === 1 && only !== null && only !== undefined) {
      for (const [pattern, plural] of SET_PLURAL) {
        const match = pattern.exec(only);
        if (match !== null) return plural(match, units.length);
      }
    }
  }
  return kindNoun(units);
}

function piecesSuffix(total: number, units: number): string {
  return total > 1 && total > units ? ` · ${countLabel(total, "piece")}` : "";
}

/** Chairs only, all of one group whose table the layout still has: a change of seats at that table. */
function seatTable(namer: Namer, chairs: readonly EditorObject[]): string | null {
  if (chairs.length === 0 || !chairs.every((chair) => isChair(namer, chair))) return null;
  const groupId = chairs[0]?.groupId ?? null;
  if (groupId === null || !chairs.every((chair) => chair.groupId === groupId)) return null;
  const table = namer.objects.find((object) => object.groupId === groupId && !isChair(namer, object));
  if (table === undefined) return null;
  const label = table.label?.trim() ?? "";
  if (label !== "") return label;
  const item = namer.item(table.assetDefinitionId);
  return item === undefined ? null : cardName(item);
}

function chairsPhrase(count: number): string {
  return count === 1 ? "a chair" : countLabel(count, "chair");
}

function nameAdds(namer: Namer, added: readonly EditorObject[], floorEmptyBefore: boolean): string {
  const atTable = seatTable(namer, added);
  if (atTable !== null) return `Add ${chairsPhrase(added.length)} at ${atTable}`;
  const units = unitsOf(namer, added);
  const tables = units.filter((unit) => unit.kind === "table").length;
  // Lay out only fills an empty floor, so a step of tables onto nothing is it.
  if (floorEmptyBefore && tables >= 2) return `Lay out ${countLabel(tables, "table")}`;
  return `Add ${unitsNoun(namer, units, true)}${piecesSuffix(added.length, units.length)}`;
}

function nameRemoves(namer: Namer, removed: readonly EditorObject[]): string {
  const atTable = seatTable(namer, removed);
  if (atTable !== null) return `Remove ${chairsPhrase(removed.length)} at ${atTable}`;
  const units = unitsOf(namer, removed);
  return `Remove ${unitsNoun(namer, units, false)}${piecesSuffix(removed.length, units.length)}`;
}

function patchedKeys(delta: HistoryDelta<EditorObject>): ReadonlySet<string> {
  const keys = new Set<string>();
  for (const patch of delta.updated) for (const key of Object.keys(patch.after)) keys.add(key);
  return keys;
}

function within(keys: ReadonlySet<string>, ...sets: readonly ReadonlySet<string>[]): boolean {
  return [...keys].every((key) => sets.some((set) => set.has(key)));
}

/** The touched objects as the layout has them now. */
function updatedObjects(namer: Namer, delta: HistoryDelta<EditorObject>): readonly EditorObject[] {
  const byId = new Map(namer.objects.map((object) => [object.id, object]));
  const out: EditorObject[] = [];
  for (const patch of delta.updated) {
    const object = byId.get(patch.id);
    if (object !== undefined) out.push(object);
  }
  return out;
}

/** Who an update was done to: "Table 8", "8 tables", "a chair at Table 3". */
function updateTarget(namer: Namer, objects: readonly EditorObject[], fallbackCount: number): string {
  if (objects.length === 0) return fallbackCount === 1 ? "a piece" : countLabel(fallbackCount, "piece");
  const atTable = seatTable(namer, objects);
  if (atTable !== null) {
    const groupId = objects[0]?.groupId ?? null;
    const chairsAtTable = namer.objects.filter((object) => object.groupId === groupId && isChair(namer, object)).length;
    return objects.length < chairsAtTable ? `${chairsPhrase(objects.length)} at ${atTable}` : `the chairs at ${atTable}`;
  }
  return unitsNoun(namer, unitsOf(namer, objects), false);
}

function everyAfter<K extends keyof EditorObject>(delta: HistoryDelta<EditorObject>, key: K, test: (value: EditorObject[K] | undefined) => boolean): boolean {
  return delta.updated.every((patch) => !(key in patch.after) || test(patch.after[key]));
}

const ONLY_TABLE_SETTING: ReadonlySet<string> = new Set(["tableSetting"]);
const ONLY_NOTES: ReadonlySet<string> = new Set(["notes"]);
const ONLY_LABEL: ReadonlySet<string> = new Set(["label"]);
const ONLY_SCALE: ReadonlySet<string> = new Set(["scale"]);
const ONLY_GROUP: ReadonlySet<string> = new Set(["groupId"]);

function nameCloth(delta: HistoryDelta<EditorObject>, keys: ReadonlySet<string>, target: string): string {
  if (keys.has("clothed")) return everyAfter(delta, "clothed", (value) => value === true) ? `Cloth on ${target}` : `Cloth off ${target}`;
  if (everyAfter(delta, "clothStyle", (value) => value === "white")) return `White cloth on ${target}`;
  if (everyAfter(delta, "clothStyle", (value) => value === "black")) return `Black cloth on ${target}`;
  return `Change the cloth on ${target}`;
}

function nameLabel(delta: HistoryDelta<EditorObject>, target: string): string {
  const only = delta.updated.length === 1 ? delta.updated[0] : undefined;
  if (only === undefined) return `Number ${countLabel(delta.updated.length, "piece")}`;
  const after = only.after.label?.trim() ?? "";
  const before = only.before.label?.trim() ?? "";
  if (after === "") return `Take the number off ${before === "" ? target : before}`;
  return before === "" ? `Number ${target}` : `Rename ${before} as ${after}`;
}

function nameUpdates(namer: Namer, delta: HistoryDelta<EditorObject>): string {
  const keys = patchedKeys(delta);
  const target = updateTarget(namer, updatedObjects(namer, delta), delta.updated.length);
  const pieces = countLabel(delta.updated.length, "piece");
  if ([...keys].some((key) => ROTATION_KEYS.has(key)) && within(keys, POSITION_KEYS, ROTATION_KEYS)) return `Turn ${target}`;
  if (within(keys, POSITION_KEYS)) return `Move ${target}`;
  if (within(keys, CLOTH_KEYS)) return nameCloth(delta, keys, target);
  if (within(keys, ONLY_TABLE_SETTING)) {
    return everyAfter(delta, "tableSetting", (value) => value !== null && value !== undefined)
      ? `Place settings on ${target}`
      : `Place settings off ${target}`;
  }
  if (within(keys, DRESSING_KEYS)) return `Dress ${target}`;
  if (within(keys, ONLY_NOTES)) {
    return everyAfter(delta, "notes", (value) => value === "" || value === undefined) ? `Remove the note on ${target}` : `Note on ${target}`;
  }
  if (within(keys, ONLY_LABEL)) return nameLabel(delta, target);
  if (within(keys, ONLY_SCALE)) return `Resize ${target}`;
  if (within(keys, ONLY_GROUP)) {
    return everyAfter(delta, "groupId", (value) => value !== null && value !== undefined) ? `Group ${pieces}` : `Ungroup ${pieces}`;
  }
  return `Change ${target}`;
}

function objectsOf(placed: HistoryDelta<EditorObject>["added"]): readonly EditorObject[] {
  return placed.map((entry) => entry.object);
}

/** Adds and removes in one step: seats changed at one table, or one set of pieces replaced by another. */
function nameExchange(namer: Namer, delta: HistoryDelta<EditorObject>): string {
  const added = objectsOf(delta.added);
  const removed = objectsOf(delta.removed);
  const atAdded = seatTable(namer, added);
  const atRemoved = seatTable(namer, removed);
  const table = atAdded ?? atRemoved;
  const sameTable = (added.length === 0 || atAdded !== null) && (removed.length === 0 || atRemoved !== null)
    && (atAdded === null || atRemoved === null || atAdded === atRemoved);
  if (table !== null && sameTable) {
    const net = added.length - removed.length;
    if (net > 0) return `Add ${chairsPhrase(net)} at ${table}`;
    if (net < 0) return `Remove ${chairsPhrase(-net)} at ${table}`;
    return `Rearrange the chairs at ${table}`;
  }
  return `Replace ${unitsNoun(namer, unitsOf(namer, removed), true)} with ${unitsNoun(namer, unitsOf(namer, added), true)}`;
}

/**
 * One step's name, in the venue's words. A label a command gave in its own
 * words is kept; the editor's derived labels are named again from the delta.
 */
export function nameHistoryStep(entry: NameableStep, context: HistoryNameContext = {}): string {
  const label = entry.label?.trim() ?? "";
  if (label !== "" && !DERIVED_LABEL.test(label)) return label;
  const namer: Namer = { item: context.item ?? getCatalogueItem, objects: context.objects ?? [] };
  const adds = entry.added.length;
  const removes = entry.removed.length;
  // A set stamped down may straighten its own chairs as it lands; it is still an add.
  if (adds > 0 && removes === 0) return nameAdds(namer, objectsOf(entry.added), context.floorEmptyBefore === true);
  // So is a removal that closes up what is left (the chairs round a table, the order of what stays).
  if (removes > 0 && adds === 0) return nameRemoves(namer, objectsOf(entry.removed));
  if (adds > 0 || removes > 0) return nameExchange(namer, entry);
  if (entry.updated.length > 0) return nameUpdates(namer, entry);
  return "Change the layout";
}

/** What Undo would take back, named (the dock's tooltip: "Undo Move Table 8"); null with nothing to undo. */
export function nameUndoStep(history: EditorHistory<EditorObject>, objects: readonly EditorObject[]): string | null {
  const entry = history.past.at(-1);
  return entry === undefined ? null : nameHistoryStep(entry, { objects });
}

/** What Redo would put back, named; null with nothing to redo. */
export function nameRedoStep(history: EditorHistory<EditorObject>, objects: readonly EditorObject[]): string | null {
  const entry = history.future.at(-1);
  return entry === undefined ? null : nameHistoryStep(entry, { objects });
}
