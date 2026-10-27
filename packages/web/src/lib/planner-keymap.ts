import { useEditorStore } from "../stores/editor-store.js";
import { useToolStore } from "../stores/tool-store.js";
import { useCatalogueStore } from "../stores/catalogue-store.js";
import { usePlacementStore } from "../stores/placement-store.js";
import { useSelectionStore } from "../stores/selection-store.js";
import { useMeasurementStore } from "../stores/measurement-store.js";
import { useMarkupStore } from "../stores/markup-store.js";
import { useLayoutTimelinePreviewStore } from "../stores/layout-timeline-preview-store.js";
import { useCockpitStore } from "../stores/cockpit-store.js";
import { useCaptionFocusStore } from "../stores/caption-focus-store.js";
import { useGhostVerdictStore } from "../stores/ghost-verdict-store.js";
import { postPlacementNotice } from "../stores/placement-notice-store.js";
import { useRoomDimensionsStore } from "../stores/room-dimensions-store.js";
import { toRenderSpace } from "../constants/scale.js";
import { getCatalogueItem } from "./catalogue.js";
import { isDiningTableItem } from "./furniture-semantics.js";
import { createGhostWorld, type GhostWorld } from "./ghost-truth.js";
import { judgeCardAt, placePieceInHand } from "./place-in-hand.js";
import { GRID_SPACING_M, expandIdsToGroupMembers, type PlacedItem } from "./placement.js";
import { TABLE_KIND, stopWords, walkKind, walkOrder, walkStep, walkStops, type WalkCursor, type WalkStop } from "./piece-walk.js";
import { announcePolitely } from "./planner-announcer.js";
import { plannerChromeRequested } from "./planner-chrome-flag.js";
import {
  allPieceIds,
  copyPieces,
  piecesOfKindIds,
  planDuplicate,
  planLineUp,
  planMove,
  planPaste,
  type EditPlan,
  type FloorOffset,
  type MovePlan,
  type PlannerClipboard,
} from "./placement-edit.js";
import { plannerFeatureEnabled } from "./planner-features.js";
import { withNoteSeeds } from "./note-seeds.js";
import { planReplace, type ReplaceOptions, type ReplacePlan, type ReplaceResult } from "./replace.js";
import { describeCard, judgesCard, placesAsCard, seatsInHand, stepCardParams, type CardParams } from "./setup-cards.js";
import { ROTATION_SNAP_RAD, snapRotation } from "./selection.js";
import { isSceneFurniturePlacement, tableClothStyleForCatalogueItem, tableSettingForCatalogueItem } from "./table-dressing.js";
import { diningTablesAmong, tableGroupSeatCapacity, tableOwnChairs, ungroupedKeepingTables } from "./table-group.js";
import {
  KEY_PRIORITY,
  letter,
  shiftedLetter,
  useEscapeLayer,
  usePlannerKeyBindings,
  type KeyBinding,
  type KeyChord,
} from "./planner-keys.js";

// ---------------------------------------------------------------------------
// The planner's keymap (spec 11; T-671 slice 5), on lib/planner-keys.ts.
//
// The tool keys and the tools' Escapes live here, mounted once by the editor
// page, so they hold whichever chrome is on screen. The keys that need the
// scene (the camera's facing for a nudge, a drag to cancel) are built here
// and registered by the scene's own components. KEY_PRIORITY orders them.
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Turning (spec 11: Q and E opposite ways, the same whether placing or
// selected, F-06; R a quarter turn, Shift R back). Angles are three.js
// rotationY, positive anticlockwise seen from above: Q turns anticlockwise,
// as it always did for the piece in hand, and E clockwise.
// ---------------------------------------------------------------------------

export const QUARTER_TURN_RAD = Math.PI / 2;

/**
 * How far a key turns a piece, or null for a key that does not turn. Q and E
 * are a pair by where they sit (left and right of W); R is a letter.
 */
export function turnForKey(press: Pick<KeyboardEvent, "code" | "key" | "shiftKey">): number | null {
  if (press.code === "KeyQ") return ROTATION_SNAP_RAD;
  if (press.code === "KeyE") return -ROTATION_SNAP_RAD;
  if (press.key.toLowerCase() === "r") return press.shiftKey ? QUARTER_TURN_RAD : -QUARTER_TURN_RAD;
  return null;
}

const TURN_CHORDS: readonly KeyChord[] = [{ code: "KeyQ" }, { code: "KeyE" }, ...letter("r"), ...shiftedLetter("r")];

// ---------------------------------------------------------------------------
// Nudging (spec 11: arrows nudge 10 cm, Shift 1 m, Alt 1 cm).
// ---------------------------------------------------------------------------

export const NUDGE_METRES = { fine: 0.01, step: 0.1, coarse: 1 } as const;

export function nudgeMetres(modifiers: { readonly shiftKey: boolean; readonly altKey: boolean }): number {
  if (modifiers.altKey) return NUDGE_METRES.fine;
  if (modifiers.shiftKey) return NUDGE_METRES.coarse;
  return NUDGE_METRES.step;
}

export interface FloorDirection {
  readonly x: number;
  readonly z: number;
}

/**
 * The way an arrow moves a piece across the floor: Up is away from the viewer
 * along the room axis nearest the view, Right is square to it. Moves keep to
 * the room's axes, so a row stays a row however the camera is turned.
 * `screenUp` is the floor direction that runs up the screen.
 */
export function arrowFloorDirection(code: string, screenUp: FloorDirection): FloorDirection | null {
  const alongX = Math.abs(screenUp.x) > Math.abs(screenUp.z);
  const up: FloorDirection = alongX
    ? { x: Math.sign(screenUp.x), z: 0 }
    : { x: 0, z: screenUp.z > 0 ? 1 : -1 };
  // Screen right is the floor direction a quarter turn clockwise from up, seen from above.
  const right: FloorDirection = { x: 0 - up.z, z: up.x };
  switch (code) {
    case "ArrowUp": return up;
    case "ArrowDown": return opposite(up);
    case "ArrowRight": return right;
    case "ArrowLeft": return opposite(right);
    default: return null;
  }
}

/** The reverse direction (written so a zero stays +0). */
function opposite(direction: FloorDirection): FloorDirection {
  return { x: 0 - direction.x, z: 0 - direction.z };
}

const ARROW_CHORDS: readonly KeyChord[] = ["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"]
  .map((code) => ({ code, shift: "any", alt: "any" }));

/** + and − (spec 11): a seat more or fewer at the selected tables, or a step of the card in hand. */
const MORE_CHORDS: readonly KeyChord[] = [{ key: "+" }, { key: "=" }, { code: "NumpadAdd" }];
const FEWER_CHORDS: readonly KeyChord[] = [{ key: "-" }, { code: "NumpadSubtract" }];

const ENTER_CHORDS: readonly KeyChord[] = [{ code: "Enter" }, { code: "NumpadEnter" }];

/** A symbol by the character typed (Shift as typing it needs), also with AltGr (Ctrl Alt) where a layout keeps it there. */
function typed(key: string): KeyChord[] {
  return [{ key, alt: "any" }, { key, mod: true, alt: true }];
}

/** ] and [ walk the selection's kind; Shift ] and Shift [, typed as } and {, every kind. */
const WALK_NEXT = typed("]");
const WALK_PREVIOUS = typed("[");
const WALK_NEXT_ANY = typed("}");
const WALK_PREVIOUS_ANY = typed("{");

// ---------------------------------------------------------------------------
// Edits, each one undo step.
// ---------------------------------------------------------------------------

/** Runs an edit as exactly one undo step; nothing runs while an act's layout is previewed. */
export function asOneUndoStep(action: () => void): void {
  if (useLayoutTimelinePreviewStore.getState().mode !== "inactive") return;
  useEditorStore.getState().bumpHistoryEpoch();
  try { action(); } finally { useEditorStore.getState().bumpHistoryEpoch(); }
}

function selectedIds(): ReadonlySet<string> {
  return useSelectionStore.getState().selectedIds;
}

function hasSelection(): boolean {
  return selectedIds().size > 0;
}

function placing(): boolean {
  return useCatalogueStore.getState().selectedItemId !== null;
}

export interface TurnedPiece {
  readonly x: number;
  readonly z: number;
  readonly rotationY: number;
}

/**
 * Where a turn leaves each piece. A table turns with its chairs: the group
 * turns about the table, the table's angle comes to the 15° step and every
 * chair moves round by the same amount, so each still faces the table. A lone
 * piece turns in place. Angles follow three.js rotationY (anticlockwise seen
 * from above is positive).
 */
export function turnedAboutTheirTables(
  placed: readonly PlacedItem[],
  ids: ReadonlySet<string>,
  delta: number,
): Map<string, TurnedPiece> {
  const expanded = expandIdsToGroupMembers(ids, placed);
  const units = new Map<string, PlacedItem[]>();
  for (const item of placed) {
    if (!expanded.has(item.id) || !isSceneFurniturePlacement(item)) continue;
    const key = item.groupId ?? `piece:${item.id}`;
    units.set(key, [...(units.get(key) ?? []), item]);
  }
  const turned = new Map<string, TurnedPiece>();
  for (const members of units.values()) {
    const pivot = members.find((item) => {
      const catalogue = getCatalogueItem(item.catalogueItemId);
      return catalogue !== undefined && isDiningTableItem(catalogue);
    }) ?? members[0];
    if (pivot === undefined) continue;
    const step = snapRotation(pivot.rotationY + delta) - pivot.rotationY;
    const cos = Math.cos(step);
    const sin = Math.sin(step);
    for (const item of members) {
      const dx = item.x - pivot.x;
      const dz = item.z - pivot.z;
      turned.set(item.id, {
        x: pivot.x + dx * cos + dz * sin,
        z: pivot.z - dx * sin + dz * cos,
        rotationY: item.rotationY + step,
      });
    }
  }
  return turned;
}

/** Turns the selection, each table with its chairs. False when nothing turnable is selected. */
export function turnSelection(delta: number): boolean {
  const placed = usePlacementStore.getState().placedItems;
  const turned = turnedAboutTheirTables(placed, selectedIds(), delta);
  if (turned.size === 0) return false;
  asOneUndoStep(() => {
    usePlacementStore.setState({
      placedItems: usePlacementStore.getState().placedItems.map((item) => {
        const next = turned.get(item.id);
        return next === undefined ? item : { ...item, ...next };
      }),
    });
  });
  return true;
}

/** Moves the selection, with each table's chairs, across the floor. */
export function nudgeSelection(direction: FloorDirection, metres: number): boolean {
  const ids = selectedIds();
  if (ids.size === 0) return false;
  const moving = expandIdsToGroupMembers(ids, usePlacementStore.getState().placedItems);
  asOneUndoStep(() => {
    usePlacementStore.getState().moveItemsByDelta(moving, toRenderSpace(direction.x * metres), toRenderSpace(direction.z * metres));
  });
  return true;
}

/** The chairs round one table: its own, not those of another table grouped with it. */
function seatsAt(table: PlacedItem, placedItems: readonly PlacedItem[]): number {
  return tableOwnChairs(table, placedItems).length;
}

/** One chair more or fewer round each selected table, within what fits. */
export function changeSeatsAtSelectedTables(delta: 1 | -1): boolean {
  const ids = selectedIds();
  const placed = usePlacementStore.getState().placedItems;
  const changes: { readonly tableId: string; readonly seats: number }[] = [];
  for (const item of placed) {
    if (!ids.has(item.id) || item.groupId === null) continue;
    const catalogue = getCatalogueItem(item.catalogueItemId);
    if (catalogue === undefined || !isDiningTableItem(catalogue)) continue;
    const seats = seatsAt(item, placed);
    const next = Math.min(Math.max(seats + delta, 1), tableGroupSeatCapacity(item, placed));
    if (next !== seats) changes.push({ tableId: item.id, seats: next });
  }
  if (changes.length === 0) return false;
  asOneUndoStep(() => {
    for (const change of changes) usePlacementStore.getState().rearrangeGroup(change.tableId, change.seats);
  });
  return true;
}

export function removeSelection(): boolean {
  const ids = selectedIds();
  if (ids.size === 0) return false;
  asOneUndoStep(() => {
    usePlacementStore.getState().removeItems(ids);
    useSelectionStore.getState().clearSelection();
  });
  return true;
}

export function toggleClothOnSelection(): boolean {
  const ids = selectedIds();
  if (ids.size === 0) return false;
  asOneUndoStep(() => {
    for (const id of ids) usePlacementStore.getState().toggleCloth(id);
  });
  return true;
}

/** Whether the selection is exactly one whole group. */
function selectionIsOneGroup(ids: ReadonlySet<string>): boolean {
  const placed = usePlacementStore.getState().placedItems;
  const expanded = expandIdsToGroupMembers(ids, placed);
  const groups = new Set(placed.filter((item) => expanded.has(item.id)).map((item) => item.groupId));
  return expanded.size >= 2 && groups.size === 1 && !groups.has(null);
}

/** Group's refusal to join two dining tables (QoL B-03): each keeps its own chairs. */
export const TABLES_KEEP_THEIR_CHAIRS = "Tables keep their own chairs · select them together to move them";
/** Ungroup's refusal on a lone table's own group. */
export const A_TABLE_KEEPS_ITS_CHAIRS = "A table keeps its chairs";

/**
 * Ctrl G (and the deck's Group) groups the selection; a group breaks only on
 * Ctrl Shift G (F-24). Two dining tables are never joined, each keeps its
 * own chairs, so that is refused with the reason; a table with a lectern or
 * a dance floor may group. True when the planner handled it, grouped or
 * refused; false when there was nothing to group.
 */
export function groupSelection(): boolean {
  const ids = selectedIds();
  if (ids.size < 2 || selectionIsOneGroup(ids)) return false;
  const placed = usePlacementStore.getState().placedItems;
  const expanded = expandIdsToGroupMembers(ids, placed);
  if (diningTablesAmong(placed.filter((item) => expanded.has(item.id))).length > 1) {
    postPlacementNotice(TABLES_KEEP_THEIR_CHAIRS);
    return true;
  }
  asOneUndoStep(() => { usePlacementStore.getState().groupItems(expanded); });
  useSelectionStore.getState().selectMultiple([...expanded]);
  return true;
}

/**
 * Ctrl Shift G (and the deck's Ungroup) breaks the selected group, each
 * table keeping its own chairs; on a lone table's own group, where only its
 * chairs would leave it, it is refused with the reason. True when handled.
 */
export function ungroupSelection(): boolean {
  const ids = selectedIds();
  if (!selectionIsOneGroup(ids)) return false;
  const placed = usePlacementStore.getState().placedItems;
  const expanded = expandIdsToGroupMembers(ids, placed);
  if (ungroupedKeepingTables(expanded, placed) === placed) {
    postPlacementNotice(A_TABLE_KEEPS_ITS_CHAIRS);
    return true;
  }
  asOneUndoStep(() => { usePlacementStore.getState().ungroupItems(expanded); });
  useSelectionStore.getState().selectMultiple([...expanded]);
  return true;
}

// ---------------------------------------------------------------------------
// Duplicate, copy, paste and select all (card-dock Q-11, spec §18; behind
// editingKeys), each one undo step. The copies take new group, set and
// table ids (lib/placement-edit.ts) and are selected, so a second Ctrl D
// copies the copies one more pitch along.
// ---------------------------------------------------------------------------

/** Where pieces were copied: the layout, its room and its venue (QoL B-X10). */
interface CopiedFrom {
  readonly configId: string | null;
  readonly spaceId: string | null;
  readonly roomName: string | null;
  readonly venueId: string | null;
}

/** A paste into another venue's layout is refused with this. */
export const PASTE_OTHER_VENUE = "Copied in another venue · paste it there";

/** Where the last Ctrl D put its copies, in which layout: a repeat in the same layout goes the same way. */
let lastDuplicate: { readonly offset: FloorOffset; readonly configId: string | null } | null = null;
/** What Ctrl C holds this session, and where it was copied. */
let clipboard: { readonly copied: PlannerClipboard; readonly from: CopiedFrom } | null = null;
/** Where the last walk stood (] and [), so a walk goes on from a stop just removed. */
let walkCursor: WalkCursor | null = null;
/** Where the keys aim the piece in hand, and the ghost they left there, so steps smaller than a snap add up. */
let keyAim: { readonly x: number; readonly z: number; readonly left: readonly [number, number, number] | null } | null = null;
/** The ghost's words, waiting for the arrows to stop. */
let ghostWordsTimer: ReturnType<typeof setTimeout> | null = null;

/** Drops the ghost's words still waiting: a key that sets the piece down or puts it away says its own. */
function quietGhostWords(): void {
  if (ghostWordsTimer !== null) clearTimeout(ghostWordsTimer);
  ghostWordsTimer = null;
}

/** The open layout, its room and its venue. */
function hereNow(): CopiedFrom {
  const { configId, space } = useEditorStore.getState();
  return { configId, spaceId: space?.id ?? null, roomName: space?.name ?? null, venueId: space?.venueId ?? null };
}

/** "3 tables", "1 table", "4 pieces": what a paste set down, by its tables where it has any. */
function pastedWords(items: readonly PlacedItem[]): string {
  const tables = items.filter((item) => {
    const catalogue = getCatalogueItem(item.catalogueItemId);
    return catalogue !== undefined && isDiningTableItem(catalogue);
  }).length;
  const [count, noun] = tables > 0 ? [tables, "table"] : [items.length, "piece"];
  return `${String(count)} ${noun}${count === 1 ? "" : "s"}`;
}

/** Forgets the session's last duplicate offset and clipboard, where the walk stood and where the keys aimed. */
export function resetEditingMemoryForTesting(): void {
  lastDuplicate = null;
  clipboard = null;
  walkCursor = null;
  keyAim = null;
  quietGhostWords();
}

function editingKeys(): boolean {
  return plannerFeatureEnabled("editingKeys");
}

function editWorld(): GhostWorld {
  return createGhostWorld(usePlacementStore.getState().placedItems, useRoomDimensionsStore.getState().dimensions);
}

/** Sets a plan's copies down as one undo step and selects them; a refusal says why where a placement notice would. */
function landEdit(plan: EditPlan): FloorOffset | null {
  if (!plan.ok) {
    postPlacementNotice(plan.reason);
    return null;
  }
  // The copies come settled where they land (lib/placement-edit): a copy on a dance floor stands on it.
  let placed: readonly string[] = [];
  asOneUndoStep(() => { placed = usePlacementStore.getState().placeSetup(plan.items); });
  if (placed.length === 0) return null;
  useSelectionStore.getState().selectMultiple(placed);
  return plan.offset;
}

/** Ctrl D: the selection, made whole, one pitch away (the last offset this session first). */
export function duplicateSelection(): boolean {
  const ids = selectedIds();
  if (ids.size === 0) return false;
  const { configId } = hereNow();
  // The last offset is the open layout's only: another layout starts afresh.
  const last = lastDuplicate !== null && lastDuplicate.configId === configId ? lastDuplicate.offset : null;
  const offset = landEdit(planDuplicate(ids, editWorld(), last));
  if (offset === null) return false;
  lastDuplicate = { offset, configId };
  return true;
}

/** Ctrl C: the selection, made whole, onto the session's clipboard. */
export function copySelection(): boolean {
  const copied = copyPieces(selectedIds(), usePlacementStore.getState().placedItems);
  if (copied === null) return false;
  clipboard = { copied, from: hereNow() };
  return true;
}

/**
 * Ctrl V: the clipboard set down centred on the floor point under the
 * pointer. Copied in another room, the receipt says where from ("Pasted 3
 * tables from the Grand Hall"); copied in another venue, it is refused.
 */
export function pasteAt(at: { readonly x: number; readonly z: number } | null): boolean {
  if (clipboard === null || at === null) return false;
  const here = hereNow();
  const { copied, from } = clipboard;
  if (from.venueId !== null && here.venueId !== null && from.venueId !== here.venueId) {
    postPlacementNotice(PASTE_OTHER_VENUE);
    return true;
  }
  const plan = planPaste(copied, at, editWorld());
  if (landEdit(plan) === null || !plan.ok) return false;
  // A receipt one Undo takes back: v2's receipt host offers Undo beside it.
  if (from.spaceId !== here.spaceId && from.roomName !== null) postPlacementNotice(`Pasted ${pastedWords(plan.items)} from the ${from.roomName}`, { undo: true });
  return true;
}

// ---------------------------------------------------------------------------
// Line up, Move and Replace (spec §8.2, §18; Q-16, Q-18, law 11), the
// commands the caption's verbs and any key call alike: the plan
// (lib/placement-edit, lib/replace; every piece settled where it stands),
// set down as one undo step (placement-store applyEdit), the result
// selected. A refusal says why where a placement notice would.
// ---------------------------------------------------------------------------

/** Sets a plan's pieces down as one undo step, `removeIds` gone, and selects what changed or joined. */
function landChange(removeIds: ReadonlySet<string>, add: readonly PlacedItem[]): boolean {
  let changed: readonly string[] = [];
  asOneUndoStep(() => { changed = usePlacementStore.getState().applyEdit({ removeIds, add }); });
  if (changed.length === 0) return false;
  useSelectionStore.getState().selectMultiple([...changed]);
  return true;
}

function landMove(plan: MovePlan): boolean {
  if (!plan.ok) {
    postPlacementNotice(plan.reason);
    return false;
  }
  return landChange(new Set(), plan.items);
}

/** Line up: the selected tables' centres onto one line along the axis they spread along most. */
export function lineUpSelection(): boolean {
  const ids = selectedIds();
  if (ids.size === 0) return false;
  return landMove(planLineUp(ids, editWorld()));
}

/** Move, then tap the destination: the selection, made whole, centred on the floor point `at`, pushed clear by up to 0.15 m. */
export function moveSelectionTo(at: { readonly x: number; readonly z: number }): boolean {
  const ids = selectedIds();
  if (ids.size === 0) return false;
  return landMove(planMove(ids, at, editWorld()));
}

/** A placed piece's note as the editor holds it, trimmed; "" for none. */
function noteOf(pieceId: string): string {
  return (useEditorStore.getState().objects.find((object) => object.id === pieceId)?.notes ?? "").trim();
}

/**
 * The whole note each table a Replace carries notes to will hold: its own
 * first, then each moved note under its old table's name ("Table 3: …").
 */
function carriedNotes(plan: ReplacePlan): ReadonlyMap<string, string> {
  const notes = new Map<string, string>();
  for (const { fromId, toId, prefix } of plan.notes) {
    const moved = noteOf(fromId);
    if (moved === "" || fromId === toId) continue;
    const before = notes.get(toId) ?? noteOf(toId);
    notes.set(toId, before === "" ? `${prefix}${moved}` : `${before}\n${prefix}${moved}`);
  }
  return notes;
}

/**
 * Replace: the selection with what `params` describes (lib/replace), as one
 * undo step, each old table's note carried to the new table nearest it in
 * that same step (lib/note-seeds). The plan comes back either way, for its
 * receipt; refused, nothing changes. `hasNote` defaults to the editor's notes.
 */
export function replaceSelection(params: CardParams, options: Pick<ReplaceOptions, "hasNote" | "store"> = {}): ReplaceResult {
  const hasNote = options.hasNote ?? ((pieceId: string) => noteOf(pieceId) !== "");
  const result = planReplace(selectedIds(), params, editWorld(), { ...options, hasNote });
  if (!result.ok) {
    postPlacementNotice(result.reason);
    return result;
  }
  const { plan } = result;
  withNoteSeeds(carriedNotes(plan), () => { landChange(plan.removeIds, plan.add); });
  return result;
}

/** Whether the page has text selected, which Ctrl C copies before any piece. */
function pageTextSelected(): boolean {
  const selection = typeof window === "undefined" ? null : window.getSelection();
  return selection !== null && !selection.isCollapsed && selection.toString().trim() !== "";
}

/** Ctrl A: every piece in the room. */
export function selectAllPieces(): boolean {
  const ids = allPieceIds(usePlacementStore.getState().placedItems);
  if (ids.length === 0) return false;
  useSelectionStore.getState().selectMultiple(ids);
  return true;
}

/** Ctrl Shift A: every piece of the selected pieces' kinds. */
export function selectAllOfKind(): boolean {
  const ids = piecesOfKindIds(usePlacementStore.getState().placedItems, selectedIds());
  if (ids.length === 0) return false;
  useSelectionStore.getState().selectMultiple(ids);
  return true;
}

/** Puts down the piece in hand without placing it. */
export function putDownPieceInHand(): void {
  quietGhostWords();
  useCatalogueStore.getState().clearSelection();
  usePlacementStore.getState().clearGhost();
}

// ---------------------------------------------------------------------------
// Walking the room (spec §11; QoL B-X2): ] and [ select the next or previous
// table by number, or piece of the selected piece's kind; Shift ] and
// Shift [ any piece (lib/piece-walk). The camera brings it into view, its
// caption is asked to take focus, and its name is said. v2's keys only: in
// v1 the timeline dock steps its keyframes on [ and ].
// ---------------------------------------------------------------------------

export const NO_TABLES_TO_WALK = "No tables in the room yet";
export const NOTHING_TO_WALK = "Nothing in the room yet";

/** The walk's keys hold in v2, with nothing in hand. */
function walking(): boolean {
  return typeof window !== "undefined" && plannerChromeRequested(window.location.search) === "v2" && !placing();
}

/** Eases the camera to a stop not well in view (cockpit-store requestFocus, CockpitCameraFocus), unless Walk holds it. */
function bringIntoView(stop: WalkStop, inView: ((x: number, z: number) => boolean) | undefined): void {
  const cockpit = useCockpitStore.getState();
  if (cockpit.walkMode || inView === undefined || inView(stop.x, stop.z)) return;
  cockpit.requestFocus(stop.x, stop.z);
}

/**
 * ] and [: the stop `step` along, of the selection's kind or, `anyKind`,
 * of every kind, selected as a click selects it, brought into view, its
 * caption asked to take focus, and its name said ("Table 4, Round of 10,
 * 10 seats"). With nothing to walk it says so, and selects nothing.
 */
export function walkSelection(step: 1 | -1, anyKind: boolean, inView?: (x: number, z: number) => boolean): boolean {
  const stops = walkStops(usePlacementStore.getState().placedItems);
  const ids = selectedIds();
  const kind = anyKind ? null : walkKind(stops, ids);
  const order = walkOrder(stops, kind);
  const stop = walkStep(order, step, ids, walkCursor);
  if (stop === null) {
    announcePolitely(kind === TABLE_KIND ? NO_TABLES_TO_WALK : NOTHING_TO_WALK);
    return false;
  }
  walkCursor = { order: order.map((each) => each.pieceId), at: order.indexOf(stop) };
  useSelectionStore.getState().select(stop.pieceId);
  bringIntoView(stop, inView);
  useCaptionFocusStore.getState().requestCaptionFocus(stop.pieceId);
  announcePolitely(stopWords(stop));
  return true;
}

// ---------------------------------------------------------------------------
// Placing by keyboard (spec §11, §12; QoL B-06), with a card in hand: + and −
// step the card as its own stepper does, the arrows move its ghost as they
// nudge a selection, and Enter sets it down where the ghost stands through
// the click's own commit (lib/place-in-hand), keeping it in hand. Each is
// said politely; a refusal says why on the placement notice, as a click's
// does, and the ghost's own alert.
// ---------------------------------------------------------------------------

/** How long the ghost's words wait after the last arrow, so a run of presses is said once. */
export const GHOST_WORDS_DELAY_MS = 500;

/** A card aloud: "Round of 12, 12 seats", "Dance floor, 4.6 m square". */
export function cardWords(params: CardParams): string {
  const face = describeCard(params);
  const seats = seatsInHand(params);
  const detail = seats > 0 ? `${String(seats)} seat${seats === 1 ? "" : "s"}` : face.size;
  return detail === "" ? face.name : `${face.name}, ${detail}`;
}

/** What stops a card stepping further one way. */
function cardLimitWords(params: CardParams, delta: 1 | -1): string {
  switch (params.card) {
    case "dance-floor": return delta > 0 ? "no larger" : "no smaller";
    case "top-table":
    case "long-table": return delta > 0 ? "no longer" : "no shorter";
    case "round":
    case "piece": return delta > 0 ? "no more seats" : "no fewer seats";
  }
}

/** Whether + and − change this card at all: its seats, its panels or its trestles. */
function cardSteps(params: CardParams): boolean {
  return stepCardParams(params, 1) !== params || stepCardParams(params, -1) !== params;
}

/**
 * + and − with a card in hand: one step of it (catalogue-store
 * stepArmedCard), said; at a limit, the limit said. False for a card with
 * nothing to step (a piece with no seats).
 */
export function stepCardInHand(delta: 1 | -1): boolean {
  const before = useCatalogueStore.getState().cardParams;
  if (before === null || !cardSteps(before)) return false;
  if (!useCatalogueStore.getState().stepArmedCard(delta)) {
    announcePolitely(`${cardWords(before)}, ${cardLimitWords(before, delta)}`);
    return true;
  }
  const after = useCatalogueStore.getState().cardParams;
  if (after !== null) announcePolitely(cardWords(after));
  return true;
}

/**
 * Whether the piece in hand is set down where a pointer's ghost would be
 * snapped to (a piece placed alone, not as a card), so the keys aim its
 * ghost as a pointer would; a card's set, a cloth or a place setting goes
 * down exactly where its ghost stands.
 */
function commitSnaps(): boolean {
  const { selectedItemId, cardParams } = useCatalogueStore.getState();
  if (selectedItemId === null) return false;
  if (tableClothStyleForCatalogueItem(selectedItemId) !== null || tableSettingForCatalogueItem(selectedItemId) !== null) return false;
  return cardParams === null || !placesAsCard(cardParams);
}

/**
 * Stands the ghost of the piece in hand at (x, z), render-space: exactly
 * there where its commit sets it down exactly, else as a pointer there
 * would. False with nothing in hand.
 */
export function standGhostAt(x: number, z: number): boolean {
  const itemId = useCatalogueStore.getState().selectedItemId;
  if (itemId === null) return false;
  usePlacementStore.getState().updateGhost(x, z, itemId, { exact: !commitSnaps() });
  return usePlacementStore.getState().ghostPosition !== null;
}

/**
 * The ghost aloud, once the keys leave it: "Round of 10, 10 seats, fits",
 * "…, fits, moved 0.12 m", judged as the ghost and the commit judge it
 * (judgeCardAt); a piece placed alone by its name, "Poseur Table, fits".
 * Null for a refusal, which the ghost says itself, once, and for a card the
 * ghost claims nothing about.
 */
export function ghostWords(): string | null {
  const { cardParams, selectedItemId } = useCatalogueStore.getState();
  const { ghostPosition, ghostRotation, ghostValid } = usePlacementStore.getState();
  if (ghostPosition === null) return null;
  if (cardParams === null || !placesAsCard(cardParams)) {
    // A piece placed alone: its name, while its ghost says it fits.
    const item = selectedItemId === null ? undefined : getCatalogueItem(selectedItemId);
    return item === undefined || !ghostValid ? null : `${item.name}, fits`;
  }
  if (!judgesCard(cardParams)) return null;
  const origin = { x: ghostPosition[0], y: ghostPosition[1], z: ghostPosition[2] };
  const { verdict } = judgeCardAt(cardParams, origin, ghostRotation, editWorld(), useGhostVerdictStore.getState().verdict?.state);
  if (verdict.state === "refused") return null;
  const moved = Math.round(verdict.pushedM * 100) / 100;
  const fits = verdict.state === "pushed" && moved > 0 ? `fits, moved ${moved.toFixed(2)} m` : "fits";
  return `${cardWords(cardParams)}, ${fits}`;
}

function sayGhostSoon(): void {
  if (ghostWordsTimer !== null) clearTimeout(ghostWordsTimer);
  ghostWordsTimer = setTimeout(() => {
    ghostWordsTimer = null;
    const words = ghostWords();
    if (words !== null) announcePolitely(words);
  }, GHOST_WORDS_DELAY_MS);
}

/** The middle of the visible floor, render-space; null with no floor in sight. */
type FloorMiddle = () => { readonly x: number; readonly z: number } | null;

function standGhostAtFloorMiddle(floorMiddle: FloorMiddle): boolean {
  const middle = floorMiddle();
  return middle !== null && standGhostAt(middle.x, middle.z);
}

/** The ghost one nudge on from where the keys last aimed it (or from where it stands, if anything else has moved it since). */
function nudgeGhost(ghost: readonly [number, number, number], direction: FloorDirection, metres: number): boolean {
  const from = keyAim !== null && keyAim.left === ghost ? keyAim : { x: ghost[0], z: ghost[2] };
  const x = from.x + toRenderSpace(direction.x * metres);
  const z = from.z + toRenderSpace(direction.z * metres);
  if (!standGhostAt(x, z)) return false;
  keyAim = { x, z, left: usePlacementStore.getState().ghostPosition };
  return true;
}

/**
 * An arrow with a card in hand: its ghost one nudge along the floor
 * (nudgeMetres, arrowFloorDirection). A piece its commit snaps to the grid
 * moves a whole grid square a press, since a smaller step would show and
 * place nothing. With no ghost yet, the first press shows it at the middle
 * of the visible floor. Its words follow once the arrows stop.
 */
export function moveGhostBy(direction: FloorDirection, metres: number, floorMiddle: FloorMiddle): boolean {
  const ghost = usePlacementStore.getState().ghostPosition;
  const step = commitSnaps() && usePlacementStore.getState().snapEnabled ? Math.max(metres, GRID_SPACING_M) : metres;
  const moved = ghost === null ? standGhostAtFloorMiddle(floorMiddle) : nudgeGhost(ghost, direction, step);
  if (moved) sayGhostSoon();
  return moved;
}

/**
 * Enter with a card in hand: set down where its ghost stands through the
 * click's own commit (placePieceInHand: the judge, the store's stock, the
 * venue's caps, one undo step), kept in hand, and what was set down said.
 * A refusal sets nothing down and says why on the placement notice. With no
 * ghost yet, the press shows it at the middle of the visible floor instead,
 * so nothing is set down unseen.
 */
export function placeInHandByKey(deps: Pick<PlacingKeyDeps, "invalidate" | "floorMiddle">): boolean {
  if (!placing()) return false;
  quietGhostWords();
  if (usePlacementStore.getState().ghostPosition === null) {
    if (!standGhostAtFloorMiddle(deps.floorMiddle)) return false;
    const words = ghostWords();
    if (words !== null) announcePolitely(words);
    return true;
  }
  const before = new Set(usePlacementStore.getState().placedItems.map((piece) => piece.id));
  placePieceInHand(deps.invalidate);
  const placed = usePlacementStore.getState().placedItems;
  const added = placed.find((piece) => !before.has(piece.id));
  const stop = added === undefined ? undefined : walkStops(placed).find((each) => each.pieces.some((piece) => piece.id === added.id));
  if (stop !== undefined) announcePolitely(`Placed ${stopWords(stop)}`);
  return true;
}

// ---------------------------------------------------------------------------
// The scene's bindings (registered by SelectionSystem and PlacementGhost).
// ---------------------------------------------------------------------------

export interface SceneKeyDeps {
  /** Asks the demand-driven canvas for a frame. */
  readonly invalidate: () => void;
  /** Cancels a drag or box in progress before a key edits the selection. */
  readonly cancelGesture: () => void;
  /** The floor direction that runs up the screen, from the camera. */
  readonly screenUp: () => FloorDirection;
  /** The floor point under the pointer, render-space, for a paste; null off the floor. */
  readonly pointerFloor?: () => { readonly x: number; readonly z: number } | null;
  /** Whether a floor point, render-space, stands well inside the view; absent, the walk never moves the camera. */
  readonly inView?: (x: number, z: number) => boolean;
}

/** What the keys for the piece in hand need from the scene (registered by PlacementGhost). */
export interface PlacingKeyDeps extends Pick<SceneKeyDeps, "invalidate" | "screenUp"> {
  /** The middle of the visible floor, render-space, where a ghost with no pointer to follow stands; null with no floor in sight. */
  readonly floorMiddle: FloorMiddle;
}

/** Asks for a frame after an edit, or declines the key when there was nothing to edit. */
function afterEdit(deps: Pick<SceneKeyDeps, "invalidate">, done: boolean): false | undefined {
  if (!done) return false;
  deps.invalidate();
  return undefined;
}

/** Keys that edit the selection (spec 11). */
export function selectionKeyBindings(deps: SceneKeyDeps): KeyBinding[] {
  const priority = KEY_PRIORITY.selection;
  return [
    {
      keys: TURN_CHORDS, priority, when: hasSelection, mutates: true,
      run: (event) => {
        const delta = turnForKey(event);
        if (delta === null) return false;
        deps.cancelGesture();
        return afterEdit(deps, turnSelection(delta));
      },
    },
    {
      keys: ARROW_CHORDS, priority, when: hasSelection, mutates: true, repeat: true,
      run: (event) => {
        const direction = arrowFloorDirection(event.code, deps.screenUp());
        if (direction === null) return false;
        deps.cancelGesture();
        return afterEdit(deps, nudgeSelection(direction, nudgeMetres(event)));
      },
    },
    {
      keys: [{ code: "Delete" }, { code: "Backspace" }], priority, when: hasSelection, mutates: true,
      run: () => { deps.cancelGesture(); return afterEdit(deps, removeSelection()); },
    },
    {
      keys: MORE_CHORDS, priority, when: hasSelection, mutates: true, repeat: true,
      run: () => afterEdit(deps, changeSeatsAtSelectedTables(1)),
    },
    {
      keys: FEWER_CHORDS, priority, when: hasSelection, mutates: true, repeat: true,
      run: () => afterEdit(deps, changeSeatsAtSelectedTables(-1)),
    },
    {
      keys: WALK_NEXT, priority, when: walking,
      run: () => { deps.cancelGesture(); return afterEdit(deps, walkSelection(1, false, deps.inView)); },
    },
    {
      keys: WALK_PREVIOUS, priority, when: walking,
      run: () => { deps.cancelGesture(); return afterEdit(deps, walkSelection(-1, false, deps.inView)); },
    },
    {
      keys: WALK_NEXT_ANY, priority, when: walking,
      run: () => { deps.cancelGesture(); return afterEdit(deps, walkSelection(1, true, deps.inView)); },
    },
    {
      keys: WALK_PREVIOUS_ANY, priority, when: walking,
      run: () => { deps.cancelGesture(); return afterEdit(deps, walkSelection(-1, true, deps.inView)); },
    },
    {
      keys: letter("c"), priority, when: hasSelection, mutates: true,
      run: () => { deps.cancelGesture(); return afterEdit(deps, toggleClothOnSelection()); },
    },
    {
      keys: letter("g", { mod: true }), priority, when: hasSelection, mutates: true,
      run: () => { deps.cancelGesture(); return afterEdit(deps, groupSelection()); },
    },
    {
      keys: shiftedLetter("g", { mod: true }), priority, when: hasSelection, mutates: true,
      run: () => { deps.cancelGesture(); return afterEdit(deps, ungroupSelection()); },
    },
    {
      keys: letter("g"), priority: KEY_PRIORITY.planner,
      run: () => { usePlacementStore.getState().toggleSnap(); },
    },
    {
      // Taken even when refused (the notice says why), so the browser never bookmarks the page instead.
      keys: letter("d", { mod: true }), priority, when: () => editingKeys() && hasSelection() && !placing(), mutates: true,
      run: () => {
        deps.cancelGesture();
        if (duplicateSelection()) deps.invalidate();
      },
    },
    {
      keys: letter("c", { mod: true }), priority, when: () => editingKeys() && hasSelection() && !pageTextSelected(),
      run: () => (copySelection() ? undefined : false),
    },
    {
      keys: letter("v", { mod: true }), priority, when: () => editingKeys() && !placing(), mutates: true,
      run: () => afterEdit(deps, pasteAt(deps.pointerFloor?.() ?? null)),
    },
    {
      keys: letter("a", { mod: true }), priority, when: () => editingKeys() && !placing(),
      run: () => afterEdit(deps, selectAllPieces()),
    },
    {
      keys: shiftedLetter("a", { mod: true }), priority, when: () => editingKeys() && hasSelection() && !placing(),
      run: () => afterEdit(deps, selectAllOfKind()),
    },
  ];
}

/** A card in hand that the keys aim: not one a drag is carrying, which the pointer holds. */
function aimingByKey(): boolean {
  return placing() && !useCatalogueStore.getState().dragActive;
}

/**
 * Keys for the piece in hand: Q, E and R turn it as they turn a selection;
 * + and − step its card; the arrows move its ghost and Enter sets it down
 * (B-06). Each wins over a selection held at the same time.
 */
export function placingKeyBindings(deps: PlacingKeyDeps): KeyBinding[] {
  const priority = KEY_PRIORITY.placing;
  return [
    {
      keys: TURN_CHORDS, priority, when: placing,
      run: (event) => {
        const delta = turnForKey(event);
        if (delta === null) return false;
        usePlacementStore.getState().rotateGhost(delta);
        if (aimingByKey()) sayGhostSoon();
        deps.invalidate();
      },
    },
    // Taken even with nothing to do (a card with no seats, no floor in sight), so a press never
    // reaches a selection held under the piece in hand.
    {
      keys: MORE_CHORDS, priority, when: placing, repeat: true,
      run: () => { stepCardInHand(1); },
    },
    {
      keys: FEWER_CHORDS, priority, when: placing, repeat: true,
      run: () => { stepCardInHand(-1); },
    },
    {
      keys: ARROW_CHORDS, priority, when: aimingByKey, repeat: true,
      run: (event) => {
        const direction = arrowFloorDirection(event.code, deps.screenUp());
        if (direction !== null && moveGhostBy(direction, nudgeMetres(event), deps.floorMiddle)) deps.invalidate();
      },
    },
    {
      keys: ENTER_CHORDS, priority, when: aimingByKey, mutates: true,
      run: () => { if (placeInHandByKey(deps)) deps.invalidate(); },
    },
  ];
}

// ---------------------------------------------------------------------------
// The tools' keys and Escapes, mounted once by the editor page.
// ---------------------------------------------------------------------------

function inWalk(): boolean {
  return useCockpitStore.getState().walkMode;
}

function toggleTool(tool: "add" | "measure" | "draw"): void {
  const store = useToolStore.getState();
  store.setTool(store.activeTool === tool ? "select" : tool);
}

/** The tools (spec 4.2, 11): A Add (F for one release), M Measure, D Draw, V back to selecting. */
export function toolKeyBindings(): KeyBinding[] {
  const priority = KEY_PRIORITY.planner;
  return [
    {
      keys: [...letter("a"), ...letter("f")], priority, when: () => !inWalk() && !placing(), mutates: true,
      run: () => { toggleTool("add"); },
    },
    {
      keys: letter("m"), priority, when: () => !inWalk(),
      run: () => { toggleTool("measure"); },
    },
    {
      keys: letter("d"), priority, when: () => !inWalk() && !placing(), mutates: true,
      run: () => { toggleTool("draw"); },
    },
    {
      keys: letter("v"), priority,
      run: () => {
        putDownPieceInHand();
        useToolStore.getState().setTool("select");
      },
    },
  ];
}

/**
 * Undo and redo match the letter typed, not where it sits, so Ctrl Z is undo
 * on any keyboard layout. Caps Lock types a capital without Shift.
 */
const UNDO_CHORDS: readonly KeyChord[] = letter("z", { mod: true });
const REDO_CHORDS: readonly KeyChord[] = [...shiftedLetter("z", { mod: true }), ...letter("y", { mod: true })];

/** Undo and redo for the layout; while drawing, Ctrl Z takes back the last stroke. */
export function undoKeyBindings(): KeyBinding[] {
  const drawing = (): boolean => useMarkupStore.getState().active;
  return [
    {
      keys: UNDO_CHORDS, priority: KEY_PRIORITY.pen, when: drawing,
      run: () => { useMarkupStore.getState().undoStroke(); },
    },
    {
      keys: UNDO_CHORDS, priority: KEY_PRIORITY.planner, mutates: true, when: () => !drawing(),
      run: () => { useEditorStore.getState().undo(); },
    },
    {
      keys: REDO_CHORDS, priority: KEY_PRIORITY.planner, mutates: true, when: () => !drawing(),
      run: () => { useEditorStore.getState().redo(); },
    },
  ];
}

const TOOL_KEYS: readonly KeyBinding[] = [...toolKeyBindings(), ...undoKeyBindings()];

function holding(tool: string): () => boolean {
  return () => useToolStore.getState().activeTool === tool;
}

/**
 * The tools' keys, and the Escape layers for what a tool holds: the piece in
 * hand, the tape, the pen, the pill's hands and the selection, each stepping
 * back one press at a time.
 */
export function usePlannerToolKeys(): void {
  usePlannerKeyBindings(TOOL_KEYS);

  // The piece in hand: Esc puts it down and keeps the selection.
  useEscapeLayer("operation", { open: placing, onEscape: putDownPieceInHand });

  // Measure: Esc lets go of a first point, then puts the tape away.
  useEscapeLayer("operation", {
    open: holding("measure"),
    onEscape: () => {
      const measurement = useMeasurementStore.getState();
      if (measurement.pendingPoint !== null) measurement.cancelPending();
      else useToolStore.getState().setTool("select");
    },
  });

  // Draw: Esc lets go of a stroke being drawn, then puts the pen down.
  useEscapeLayer("operation", {
    open: holding("draw"),
    onEscape: () => {
      const markup = useMarkupStore.getState();
      if (markup.draftStroke !== null) markup.cancelStroke();
      else useToolStore.getState().setTool("select");
    },
  });

  // The pill's Move, Rotate and Scale: back to Select.
  useEscapeLayer("operation", {
    open: () => ["move", "rotate", "scale"].includes(useToolStore.getState().activeTool),
    onEscape: () => { useToolStore.getState().setTool("select"); },
  });

  // Last: the selection.
  useEscapeLayer("selection", {
    open: hasSelection,
    onEscape: () => { useSelectionStore.getState().clearSelection(); },
  });
}
