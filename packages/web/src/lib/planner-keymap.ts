import { useEditorStore } from "../stores/editor-store.js";
import { useToolStore } from "../stores/tool-store.js";
import { useCatalogueStore } from "../stores/catalogue-store.js";
import { usePlacementStore } from "../stores/placement-store.js";
import { useSelectionStore } from "../stores/selection-store.js";
import { useMeasurementStore } from "../stores/measurement-store.js";
import { useMarkupStore } from "../stores/markup-store.js";
import { useLayoutTimelinePreviewStore } from "../stores/layout-timeline-preview-store.js";
import { useCockpitStore } from "../stores/cockpit-store.js";
import { toRenderSpace } from "../constants/scale.js";
import { getCatalogueItem } from "./catalogue.js";
import { isDiningTableItem } from "./furniture-semantics.js";
import { expandIdsToGroupMembers, type PlacedItem } from "./placement.js";
import { ROTATION_SNAP_RAD, snapRotation } from "./selection.js";
import { isSceneFurniturePlacement } from "./table-dressing.js";
import { tableGroupSeatCapacity } from "./table-group.js";
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

/** The chairs round one table. */
function seatsAt(tableGroupId: string, tableId: string): number {
  return usePlacementStore.getState().placedItems.filter((item) => item.groupId === tableGroupId && item.id !== tableId
    && isSceneFurniturePlacement(item) && getCatalogueItem(item.catalogueItemId)?.category === "chair").length;
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
    const seats = seatsAt(item.groupId, item.id);
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

/** Ctrl G groups the selection; a group breaks only on Ctrl Shift G (F-24). */
export function groupSelection(): boolean {
  const ids = selectedIds();
  if (ids.size < 2 || selectionIsOneGroup(ids)) return false;
  const expanded = expandIdsToGroupMembers(ids, usePlacementStore.getState().placedItems);
  asOneUndoStep(() => { usePlacementStore.getState().groupItems(expanded); });
  useSelectionStore.getState().selectMultiple([...expanded]);
  return true;
}

export function ungroupSelection(): boolean {
  const ids = selectedIds();
  if (!selectionIsOneGroup(ids)) return false;
  const expanded = expandIdsToGroupMembers(ids, usePlacementStore.getState().placedItems);
  asOneUndoStep(() => { usePlacementStore.getState().ungroupItems(expanded); });
  useSelectionStore.getState().selectMultiple([...expanded]);
  return true;
}

/** Puts down the piece in hand without placing it. */
export function putDownPieceInHand(): void {
  useCatalogueStore.getState().clearSelection();
  usePlacementStore.getState().clearGhost();
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
      keys: [{ key: "+" }, { key: "=" }, { code: "NumpadAdd" }], priority, when: hasSelection, mutates: true, repeat: true,
      run: () => afterEdit(deps, changeSeatsAtSelectedTables(1)),
    },
    {
      keys: [{ key: "-" }, { code: "NumpadSubtract" }], priority, when: hasSelection, mutates: true, repeat: true,
      run: () => afterEdit(deps, changeSeatsAtSelectedTables(-1)),
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
  ];
}

/** Keys for the piece in hand: Q, E and R turn it as they turn a selection. */
export function placingKeyBindings(deps: Pick<SceneKeyDeps, "invalidate">): KeyBinding[] {
  return [{
    keys: TURN_CHORDS, priority: KEY_PRIORITY.placing, when: placing,
    run: (event) => {
      const delta = turnForKey(event);
      if (delta === null) return false;
      usePlacementStore.getState().rotateGhost(delta);
      deps.invalidate();
    },
  }];
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
