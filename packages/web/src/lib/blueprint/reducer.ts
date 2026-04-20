import type {
  BlueprintItem,
  BlueprintScene,
  CatalogueChip,
  DancefloorItem,
  EventType,
  RectItem,
  RoundTableItem,
} from "./types.js";

// ---------------------------------------------------------------------------
// Blueprint editor reducer — pure state machine powering every edit.
// Kept deliberately narrow: mutations on `BlueprintScene` plus selection
// plus a capped undo/redo history. Input translation (pointer coords →
// metres, key combos → actions) lives in the component layer.
// ---------------------------------------------------------------------------

export const HISTORY_CAP = 64;
export const NUDGE_STEP_M = 0.1;
export const NUDGE_STEP_BIG_M = 1;
export const ROTATE_STEP_DEG = 90;

export interface BlueprintEditorState {
  readonly scene: BlueprintScene;
  /** Primary focus — the item shown in the inspector. Always either null or the first entry of `selectedIds`. */
  readonly selectedId: string | null;
  /**
   * Full selection set (multi-select support). A single selection is
   * `[id]`; empty means nothing selected; >1 means a multi-select.
   * Kept in sync with `selectedId` by every action that touches selection.
   */
  readonly selectedIds: readonly string[];
  readonly past: readonly BlueprintScene[];
  readonly future: readonly BlueprintScene[];
  readonly dirty: boolean;
}

export type BlueprintAction =
  | { readonly type: "select"; readonly id: string | null }
  /** Replace the multi-selection with the given set of ids (primary = first). */
  | { readonly type: "select-ids"; readonly ids: readonly string[] }
  /** Toggle the id in/out of the multi-selection. */
  | { readonly type: "toggle-select"; readonly id: string }
  /** Select every item in the scene. */
  | { readonly type: "select-all" }
  | { readonly type: "move-to"; readonly id: string; readonly center: { x: number; y: number } }
  /**
   * Silent move — updates item position without pushing history. Used during
   * a pointer drag so the entire drag coalesces into a single undo step.
   * Pair with `stamp-history` on pointer-up.
   */
  | { readonly type: "move-silent"; readonly id: string; readonly center: { x: number; y: number } }
  /**
   * Replace the matching item in place (by id) without pushing history.
   * Used by resize (which changes width/length, not just centre) — pair
   * with `stamp-history` on release so the whole resize coalesces.
   */
  | { readonly type: "replace-item-silent"; readonly item: BlueprintItem }
  /**
   * Push a single snapshot onto `past`, clearing `future`. The caller takes
   * the pre-drag scene before the first silent move and passes it here on
   * drag-end — undo now restores the pre-drag state in one step.
   */
  | { readonly type: "stamp-history"; readonly snapshot: BlueprintScene }
  | { readonly type: "nudge-selected"; readonly dx: number; readonly dy: number }
  | { readonly type: "rotate-selected"; readonly deltaDeg: number }
  | { readonly type: "remove"; readonly id: string }
  | { readonly type: "remove-selected" }
  | { readonly type: "add"; readonly item: BlueprintItem; readonly select: boolean }
  /** Duplicate the currently-selected item with a small offset + select the copy. */
  | { readonly type: "duplicate-selected"; readonly idSeed: number }
  /** Replace the current items with a named template (banquet / ceremony / cabaret). */
  | { readonly type: "apply-template"; readonly templateId: TemplateId; readonly idSeed: number }
  /** Remove every item (keeps room + guests + event type). */
  | { readonly type: "clear-scene" }
  /**
   * Toggle `locked`. With no `id`, toggles every currently-selected item.
   * With `id`, toggles just that one item — selection is untouched. Used by
   * the layer panel's per-row lock button.
   */
  | { readonly type: "toggle-lock"; readonly id?: string }
  /** Move selected items one slot later in the items array (drawn on top). */
  | { readonly type: "raise-selected" }
  /** Move selected items one slot earlier in the items array (drawn below). */
  | { readonly type: "lower-selected" }
  /** Send selected items to the end of the items array (frontmost). */
  | { readonly type: "raise-to-top" }
  /** Send selected items to the start of the items array (backmost). */
  | { readonly type: "lower-to-bottom" }
  | { readonly type: "set-event-type"; readonly eventType: EventType }
  | { readonly type: "set-guests"; readonly guestCount: number }
  | { readonly type: "undo" }
  | { readonly type: "redo" }
  | { readonly type: "mark-saved" };

export function initialEditorState(scene: BlueprintScene, selectedId: string | null = null): BlueprintEditorState {
  return {
    scene,
    selectedId,
    selectedIds: selectedId === null ? [] : [selectedId],
    past: [],
    future: [],
    dirty: false,
  };
}

/** Pure reducer. Actions that mutate the scene push history + clear `future`. */
export function reduce(state: BlueprintEditorState, action: BlueprintAction): BlueprintEditorState {
  switch (action.type) {
    case "select":
      return {
        ...state,
        selectedId: action.id,
        selectedIds: action.id === null ? [] : [action.id],
      };

    case "select-ids": {
      const ids = action.ids;
      return {
        ...state,
        selectedIds: ids,
        selectedId: ids.length > 0 ? (ids[0] ?? null) : null,
      };
    }

    case "toggle-select": {
      const has = state.selectedIds.includes(action.id);
      const nextIds = has
        ? state.selectedIds.filter((id) => id !== action.id)
        : [...state.selectedIds, action.id];
      return {
        ...state,
        selectedIds: nextIds,
        selectedId: nextIds.length > 0 ? (nextIds[0] ?? null) : null,
      };
    }

    case "select-all": {
      const ids = state.scene.items.map((it) => it.id);
      return {
        ...state,
        selectedIds: ids,
        selectedId: ids.length > 0 ? (ids[0] ?? null) : null,
      };
    }

    case "move-to": {
      const next = mapItem(state.scene, action.id, (it) => moveItemTo(it, action.center));
      return pushMutation(state, next);
    }

    case "move-silent": {
      const target = state.scene.items.find((i) => i.id === action.id);
      if (target !== undefined && target.locked === true) return state;
      const next = mapItem(state.scene, action.id, (it) => moveItemTo(it, action.center));
      // Mutation WITHOUT history — callers must pair with `stamp-history`.
      return { ...state, scene: next, dirty: true };
    }

    case "replace-item-silent": {
      const existing = state.scene.items.find((i) => i.id === action.item.id);
      if (existing !== undefined && existing.locked === true) return state;
      const next: BlueprintScene = {
        ...state.scene,
        items: state.scene.items.map((it) => (it.id === action.item.id ? action.item : it)),
      };
      return { ...state, scene: next, dirty: true };
    }

    case "stamp-history": {
      return {
        ...state,
        past: [...state.past, action.snapshot].slice(-HISTORY_CAP),
        future: [],
        dirty: true,
      };
    }

    case "nudge-selected": {
      if (state.selectedIds.length === 0) return state;
      const active = new Set(state.selectedIds);
      const next: BlueprintScene = {
        ...state.scene,
        items: state.scene.items.map((it) => (
          active.has(it.id) && it.locked !== true ? moveItemDelta(it, action.dx, action.dy) : it
        )),
      };
      return pushMutation(state, next);
    }

    case "rotate-selected": {
      if (state.selectedIds.length === 0) return state;
      const active = new Set(state.selectedIds);
      const next: BlueprintScene = {
        ...state.scene,
        items: state.scene.items.map((it) => (
          active.has(it.id) && it.locked !== true
            ? ({ ...it, rotationDeg: normaliseDeg((it.rotationDeg ?? 0) + action.deltaDeg) } as BlueprintItem)
            : it
        )),
      };
      return pushMutation(state, next);
    }

    case "remove": {
      const target = state.scene.items.find((i) => i.id === action.id);
      if (target !== undefined && target.locked === true) return state;
      const next: BlueprintScene = { ...state.scene, items: state.scene.items.filter((i) => i.id !== action.id) };
      const remainingIds = state.selectedIds.filter((id) => id !== action.id);
      return {
        ...pushMutation(state, next),
        selectedId: remainingIds.length > 0 ? (remainingIds[0] ?? null) : null,
        selectedIds: remainingIds,
      };
    }

    case "remove-selected": {
      if (state.selectedIds.length === 0) return state;
      const doomed = new Set(state.selectedIds);
      // Preserve locked items — delete only unlocked selected items.
      const kept = state.scene.items.filter((i) => !doomed.has(i.id) || i.locked === true);
      if (kept.length === state.scene.items.length) return state; // nothing unlocked to delete
      const next: BlueprintScene = { ...state.scene, items: kept };
      return { ...pushMutation(state, next), selectedId: null, selectedIds: [] };
    }

    case "add": {
      const next: BlueprintScene = { ...state.scene, items: [...state.scene.items, action.item] };
      const base = pushMutation(state, next);
      return action.select
        ? { ...base, selectedId: action.item.id, selectedIds: [action.item.id] }
        : base;
    }

    case "duplicate-selected": {
      if (state.selectedIds.length === 0) return state;
      const sources = state.scene.items.filter((i) => state.selectedIds.includes(i.id));
      if (sources.length === 0) return state;
      // Deterministic id seeding: shift by source index so multiple
      // duplicates in one action don't collide.
      const copies = sources.map((src, i) => duplicateItem(src, action.idSeed + i));
      const next: BlueprintScene = { ...state.scene, items: [...state.scene.items, ...copies] };
      const base = pushMutation(state, next);
      const copyIds = copies.map((c) => c.id);
      return { ...base, selectedId: copyIds[0] ?? null, selectedIds: copyIds };
    }

    case "apply-template": {
      const items = buildTemplateItems(action.templateId, state.scene.room, state.scene.guestCount, action.idSeed);
      const next: BlueprintScene = { ...state.scene, items };
      return { ...pushMutation(state, next), selectedId: null };
    }

    case "clear-scene": {
      if (state.scene.items.length === 0) return state;
      const next: BlueprintScene = { ...state.scene, items: [] };
      return { ...pushMutation(state, next), selectedId: null, selectedIds: [] };
    }

    case "toggle-lock": {
      if (action.id !== undefined) {
        // Single-id form — flip lock on just that item, leave selection alone.
        const target = state.scene.items.find((it) => it.id === action.id);
        if (target === undefined) return state;
        const nextLocked = target.locked !== true;
        const next: BlueprintScene = {
          ...state.scene,
          items: state.scene.items.map((it) => (
            it.id === action.id ? ({ ...it, locked: nextLocked } as BlueprintItem) : it
          )),
        };
        return pushMutation(state, next);
      }
      if (state.selectedIds.length === 0) return state;
      const active = new Set(state.selectedIds);
      const anyUnlocked = state.scene.items.some((it) => active.has(it.id) && it.locked !== true);
      const targetLock = anyUnlocked;
      const next: BlueprintScene = {
        ...state.scene,
        items: state.scene.items.map((it) => (
          active.has(it.id) ? ({ ...it, locked: targetLock } as BlueprintItem) : it
        )),
      };
      return pushMutation(state, next);
    }

    case "raise-selected":
      return reorderSelected(state, "raise");
    case "lower-selected":
      return reorderSelected(state, "lower");
    case "raise-to-top":
      return reorderSelected(state, "top");
    case "lower-to-bottom":
      return reorderSelected(state, "bottom");

    case "set-event-type":
      return { ...state, scene: { ...state.scene, eventType: action.eventType } };

    case "set-guests":
      return { ...state, scene: { ...state.scene, guestCount: Math.max(0, action.guestCount) } };

    case "undo": {
      if (state.past.length === 0) return state;
      const previous = state.past[state.past.length - 1];
      if (previous === undefined) return state;
      return {
        ...state,
        scene: previous,
        past: state.past.slice(0, -1),
        future: [state.scene, ...state.future].slice(0, HISTORY_CAP),
      };
    }

    case "redo": {
      if (state.future.length === 0) return state;
      const next = state.future[0];
      if (next === undefined) return state;
      return {
        ...state,
        scene: next,
        past: [...state.past, state.scene].slice(-HISTORY_CAP),
        future: state.future.slice(1),
      };
    }

    case "mark-saved":
      return { ...state, dirty: false, scene: { ...state.scene, lastSavedAtMs: Date.now() } };
  }
}

// ---------------------------------------------------------------------------
// Item-level helpers
// ---------------------------------------------------------------------------

function mapItem(
  scene: BlueprintScene,
  id: string,
  fn: (item: BlueprintItem) => BlueprintItem,
): BlueprintScene {
  return { ...scene, items: scene.items.map((it) => (it.id === id ? fn(it) : it)) };
}

function moveItemTo(item: BlueprintItem, center: { x: number; y: number }): BlueprintItem {
  if (item.shape === "round") {
    return { ...item, center } satisfies RoundTableItem;
  }
  const topLeft = { x: center.x - item.widthM / 2, y: center.y - item.lengthM / 2 };
  if (item.shape === "dancefloor") {
    return { ...item, topLeft } satisfies DancefloorItem;
  }
  return { ...item, topLeft } satisfies RectItem;
}

function moveItemDelta(item: BlueprintItem, dx: number, dy: number): BlueprintItem {
  if (item.shape === "round") {
    return { ...item, center: { x: item.center.x + dx, y: item.center.y + dy } } satisfies RoundTableItem;
  }
  const topLeft = { x: item.topLeft.x + dx, y: item.topLeft.y + dy };
  if (item.shape === "dancefloor") {
    return { ...item, topLeft } satisfies DancefloorItem;
  }
  return { ...item, topLeft } satisfies RectItem;
}

function normaliseDeg(deg: number): number {
  return ((deg % 360) + 360) % 360;
}

/**
 * Z-order reorderer. "raise" moves selected items one slot later in the
 * items array (drawn on top of their current neighbour); "lower" reverses
 * that. "top"/"bottom" move the whole selection to the array endpoints.
 * No-op when selection empty or already at the extreme.
 */
function reorderSelected(
  state: BlueprintEditorState,
  mode: "raise" | "lower" | "top" | "bottom",
): BlueprintEditorState {
  if (state.selectedIds.length === 0) return state;
  const active = new Set(state.selectedIds);
  const items = state.scene.items;
  const selected = items.filter((i) => active.has(i.id));
  const rest = items.filter((i) => !active.has(i.id));
  if (mode === "top") {
    const next: BlueprintScene = { ...state.scene, items: [...rest, ...selected] };
    return pushMutation(state, next);
  }
  if (mode === "bottom") {
    const next: BlueprintScene = { ...state.scene, items: [...selected, ...rest] };
    return pushMutation(state, next);
  }
  // raise / lower — one-step nudge preserving relative order among selected.
  const step = mode === "raise" ? 1 : -1;
  const newItems = items.slice();
  const indices: number[] = [];
  for (let i = 0; i < newItems.length; i += 1) {
    const it = newItems[i];
    if (it !== undefined && active.has(it.id)) indices.push(i);
  }
  // For "raise" iterate rightmost→leftmost; for "lower" the reverse,
  // so items can't overtake other members of the selection.
  const order = mode === "raise" ? indices.slice().reverse() : indices;
  for (const idx of order) {
    const target = idx + step;
    if (target < 0 || target >= newItems.length) continue;
    const here = newItems[idx];
    const there = newItems[target];
    if (here === undefined || there === undefined) continue;
    if (active.has(there.id)) continue; // don't swap with another selected
    newItems[idx] = there;
    newItems[target] = here;
  }
  if (newItems.every((it, i) => it.id === items[i]?.id)) return state;
  const next: BlueprintScene = { ...state.scene, items: newItems };
  return pushMutation(state, next);
}

function pushMutation(state: BlueprintEditorState, nextScene: BlueprintScene): BlueprintEditorState {
  return {
    ...state,
    scene: nextScene,
    past: [...state.past, state.scene].slice(-HISTORY_CAP),
    future: [],
    dirty: true,
  };
}

// ---------------------------------------------------------------------------
// Catalogue → new item factory
// ---------------------------------------------------------------------------

/** Build a default `BlueprintItem` from a catalogue chip dropped onto the canvas. */
export function buildItemForChip(
  chip: CatalogueChip,
  center: { x: number; y: number },
  seed: number,
): BlueprintItem {
  const id = `${chip.kind}-${String(seed)}`;
  switch (chip.kind) {
    case "round-table":
      return {
        id, kind: "round-table", shape: "round",
        center, diameterM: 1.8, seats: 10,
        linen: "Ivory", centrepiece: "Low floral",
      } satisfies RoundTableItem;
    case "long-table":
      return {
        id, kind: "long-table", shape: "rect",
        topLeft: { x: center.x - 1.5, y: center.y - 0.45 },
        widthM: 3, lengthM: 0.9, seats: 12, linen: "Ivory",
      } satisfies RectItem;
    case "stage":
      return {
        id, kind: "stage", shape: "rect",
        topLeft: { x: center.x - 2, y: center.y - 1 },
        widthM: 4, lengthM: 2,
      } satisfies RectItem;
    case "top-table":
      return {
        id, kind: "top-table", shape: "rect",
        topLeft: { x: center.x - 2.5, y: center.y - 0.65 },
        widthM: 5, lengthM: 1.3, seats: 8, linen: "Ivory",
      } satisfies RectItem;
    case "bar":
      return {
        id, kind: "bar", shape: "bar",
        topLeft: { x: center.x - 1.5, y: center.y - 0.35 },
        widthM: 3, lengthM: 0.7,
      } satisfies RectItem;
    case "dancefloor":
      return {
        id, kind: "dancefloor", shape: "dancefloor",
        topLeft: { x: center.x - 2, y: center.y - 1.5 },
        widthM: 4, lengthM: 3,
      } satisfies DancefloorItem;
  }
}

// ---------------------------------------------------------------------------
// Geometry helpers
// ---------------------------------------------------------------------------

/** Snap a metre value to the nearest grid node (default 0.5 m). */
export function snapToGrid(m: number, stepM: number = 0.5): number {
  return Math.round(m / stepM) * stepM;
}

/**
 * Clamp a candidate centre point so the item's half-footprint stays
 * inside the room. The half-footprint is derived from a best-effort
 * kind-specific default — round tables are 0.9 m radius, rect items
 * vary by kind. Keeps dropped/moved items from drifting off the plan.
 */
export function clampCenterToRoom(
  center: { x: number; y: number },
  room: { widthM: number; lengthM: number },
  kind?: BlueprintItem["kind"],
): { x: number; y: number } {
  const half = halfFootprintFor(kind);
  return {
    x: Math.max(half, Math.min(room.widthM - half, center.x)),
    y: Math.max(half, Math.min(room.lengthM - half, center.y)),
  };
}

function halfFootprintFor(kind?: BlueprintItem["kind"]): number {
  switch (kind) {
    case "round-table": return 0.9;
    case "long-table": return 1.5;
    case "stage": return 2;
    case "top-table": return 2.5;
    case "bar": return 1.5;
    case "dancefloor": return 2;
    default: return 1;
  }
}

// ---------------------------------------------------------------------------
// Duplication + templates
// ---------------------------------------------------------------------------

/** Offset applied to a duplicated item so the copy is visually distinct. */
const DUPLICATE_OFFSET_M = 0.5;

/**
 * Clone an item, offset by DUPLICATE_OFFSET_M diagonally, with a fresh id
 * derived from a monotonic seed. Preserves all scalar props (seats, linen,
 * rotation) so the copy is a true duplicate ready for further editing.
 */
export function duplicateItem(item: BlueprintItem, idSeed: number): BlueprintItem {
  const idBase = `${item.kind}-${String(idSeed)}`;
  if (item.shape === "round") {
    return {
      ...item,
      id: idBase,
      center: { x: item.center.x + DUPLICATE_OFFSET_M, y: item.center.y + DUPLICATE_OFFSET_M },
    };
  }
  const topLeft = { x: item.topLeft.x + DUPLICATE_OFFSET_M, y: item.topLeft.y + DUPLICATE_OFFSET_M };
  if (item.shape === "dancefloor") {
    return { ...item, id: idBase, topLeft };
  }
  return { ...item, id: idBase, topLeft };
}

export type TemplateId = "banquet" | "ceremony" | "cabaret";

export interface BlueprintTemplate {
  readonly id: TemplateId;
  readonly label: string;
  readonly description: string;
}

/** The canonical catalogue of one-click layout templates. */
export const TEMPLATES: readonly BlueprintTemplate[] = [
  { id: "banquet", label: "Banquet", description: "Rows of round tables + a top table + dancefloor" },
  { id: "ceremony", label: "Ceremony", description: "Two blocks of theatre-style seating with a central aisle" },
  { id: "cabaret", label: "Cabaret", description: "Half-rounds facing a stage with a central dancefloor" },
];

/**
 * Build the item list for a given template, scaled to the room and guest
 * count. Returns a fresh array with deterministic IDs derived from the seed.
 */
export function buildTemplateItems(
  id: TemplateId,
  room: { readonly widthM: number; readonly lengthM: number },
  guestCount: number,
  idSeed: number,
): BlueprintItem[] {
  switch (id) {
    case "banquet":
      return buildBanquetTemplate(room, guestCount, idSeed);
    case "ceremony":
      return buildCeremonyTemplate(room, guestCount, idSeed);
    case "cabaret":
      return buildCabaretTemplate(room, guestCount, idSeed);
  }
}

function buildBanquetTemplate(room: { widthM: number; lengthM: number }, guests: number, seed: number): BlueprintItem[] {
  const items: BlueprintItem[] = [];
  let n = seed;
  // Top table along the top wall, centred.
  const topWidth = Math.min(10, room.widthM - 4);
  items.push({
    id: `top-table-${String(n++)}`, kind: "top-table", shape: "rect",
    topLeft: { x: (room.widthM - topWidth) / 2, y: 1 },
    widthM: topWidth, lengthM: 1.3, seats: 14, linen: "Ivory",
  });
  // Grid of round tables — rows × cols sized to fit guests / 10.
  const wantedRounds = Math.max(4, Math.ceil(Math.max(0, guests - 14) / 10));
  const cols = Math.max(3, Math.min(8, Math.round(Math.sqrt(wantedRounds * (room.widthM / Math.max(2, room.lengthM - 3))))));
  const rows = Math.max(1, Math.ceil(wantedRounds / cols));
  const gridLeft = 1.5;
  const gridRight = room.widthM - 1.5;
  const gridTop = 3.3;
  const gridBottom = room.lengthM - 3.5;
  for (let r = 0; r < rows; r += 1) {
    for (let c = 0; c < cols; c += 1) {
      const idx = r * cols + c;
      if (idx >= wantedRounds) break;
      const x = cols === 1 ? (gridLeft + gridRight) / 2 : gridLeft + (c * (gridRight - gridLeft)) / (cols - 1);
      const y = rows === 1 ? (gridTop + gridBottom) / 2 : gridTop + (r * (gridBottom - gridTop)) / (rows - 1);
      items.push({
        id: `round-${String(n++)}`, kind: "round-table", shape: "round",
        center: { x, y }, diameterM: 1.8, seats: 10,
        linen: "Ivory", centrepiece: "Low floral",
      });
    }
  }
  // Dancefloor bottom-centre.
  const dfWidth = Math.min(6, room.widthM - 6);
  items.push({
    id: `dancefloor-${String(n++)}`, kind: "dancefloor", shape: "dancefloor",
    topLeft: { x: (room.widthM - dfWidth) / 2, y: room.lengthM - 2 },
    widthM: dfWidth, lengthM: 1.6,
  });
  return items;
}

function buildCeremonyTemplate(room: { widthM: number; lengthM: number }, guests: number, seed: number): BlueprintItem[] {
  const items: BlueprintItem[] = [];
  let n = seed;
  // Stage at the front (top wall).
  const stageW = Math.min(6, room.widthM - 4);
  items.push({
    id: `stage-${String(n++)}`, kind: "stage", shape: "rect",
    topLeft: { x: (room.widthM - stageW) / 2, y: 1 },
    widthM: stageW, lengthM: 2,
  });
  // Two blocks of long tables facing the stage with a central aisle.
  const rowsWanted = Math.max(4, Math.ceil(guests / 16));
  const rowGap = Math.max(0.8, (room.lengthM - 4) / Math.max(1, rowsWanted));
  const blockWidth = (room.widthM - 4) / 2 - 0.5;
  const leftX = 2;
  const rightX = room.widthM / 2 + 0.5;
  for (let r = 0; r < rowsWanted; r += 1) {
    const y = 4 + r * rowGap;
    if (y + 1 > room.lengthM - 1) break;
    items.push({
      id: `long-left-${String(n++)}`, kind: "long-table", shape: "rect",
      topLeft: { x: leftX, y }, widthM: blockWidth, lengthM: 0.9, seats: 8, linen: "Ivory",
    });
    items.push({
      id: `long-right-${String(n++)}`, kind: "long-table", shape: "rect",
      topLeft: { x: rightX, y }, widthM: blockWidth, lengthM: 0.9, seats: 8, linen: "Ivory",
    });
  }
  return items;
}

function buildCabaretTemplate(room: { widthM: number; lengthM: number }, guests: number, seed: number): BlueprintItem[] {
  const items: BlueprintItem[] = [];
  let n = seed;
  // Stage top-left.
  items.push({
    id: `stage-${String(n++)}`, kind: "stage", shape: "rect",
    topLeft: { x: 1, y: 1 }, widthM: Math.min(6, room.widthM - 6), lengthM: 2,
  });
  // Bar top-right.
  items.push({
    id: `bar-${String(n++)}`, kind: "bar", shape: "bar",
    topLeft: { x: room.widthM - 4, y: 1 }, widthM: 3, lengthM: 0.7,
  });
  // Dancefloor centre.
  items.push({
    id: `dancefloor-${String(n++)}`, kind: "dancefloor", shape: "dancefloor",
    topLeft: { x: room.widthM / 2 - 2, y: 4 }, widthM: 4, lengthM: 3,
  });
  // Ring of half-round tables (seats 6) around the dancefloor.
  const wanted = Math.max(6, Math.min(14, Math.ceil(guests / 6)));
  for (let i = 0; i < wanted; i += 1) {
    const theta = (Math.PI * 2 * i) / wanted;
    const cx = room.widthM / 2 + Math.cos(theta) * Math.max(3, room.widthM / 4);
    const cy = (room.lengthM / 2 + 1) + Math.sin(theta) * Math.max(2, room.lengthM / 4);
    items.push({
      id: `round-${String(n++)}`, kind: "round-table", shape: "round",
      center: { x: cx, y: cy }, diameterM: 1.5, seats: 6,
      linen: "Ivory", centrepiece: "Candle",
    });
  }
  return items;
}

/**
 * Return the ids of every item whose AABB overlaps the given world-space
 * rectangle (rubber-band selection). Order matches the input items.
 */
export function itemsInsideBox(
  items: readonly BlueprintItem[],
  box: { readonly left: number; readonly top: number; readonly right: number; readonly bottom: number },
): readonly string[] {
  const left = Math.min(box.left, box.right);
  const right = Math.max(box.left, box.right);
  const top = Math.min(box.top, box.bottom);
  const bottom = Math.max(box.top, box.bottom);
  const hits: string[] = [];
  for (const item of items) {
    const bb = aabbOf(item);
    const overlaps = bb.left < right && bb.right > left && bb.top < bottom && bb.bottom > top;
    if (overlaps) hits.push(item.id);
  }
  return hits;
}

/** True if two items' AABBs overlap on the floor plane. */
export function itemsOverlap(a: BlueprintItem, b: BlueprintItem): boolean {
  const boxA = aabbOf(a);
  const boxB = aabbOf(b);
  return (
    boxA.left < boxB.right &&
    boxA.right > boxB.left &&
    boxA.top < boxB.bottom &&
    boxA.bottom > boxB.top
  );
}

function aabbOf(item: BlueprintItem): { left: number; right: number; top: number; bottom: number } {
  if (item.shape === "round") {
    const r = item.diameterM / 2;
    return { left: item.center.x - r, right: item.center.x + r, top: item.center.y - r, bottom: item.center.y + r };
  }
  return {
    left: item.topLeft.x,
    right: item.topLeft.x + item.widthM,
    top: item.topLeft.y,
    bottom: item.topLeft.y + item.lengthM,
  };
}

// ---------------------------------------------------------------------------
// Alignment snapping (smart guides)
// ---------------------------------------------------------------------------

/** Default pull distance (metres) within which a drag snaps to another item. */
export const ALIGN_SNAP_M = 0.15;

/** The six anchor lines — left/centre/right on X, top/centre/bottom on Y. */
export interface ItemAnchors {
  readonly cx: number;
  readonly cy: number;
  readonly left: number;
  readonly right: number;
  readonly top: number;
  readonly bottom: number;
}

/** Compute the 6 anchor-line coordinates of an item's AABB + centre. */
export function itemAnchors(item: BlueprintItem): ItemAnchors {
  const box = aabbOf(item);
  return {
    cx: (box.left + box.right) / 2,
    cy: (box.top + box.bottom) / 2,
    left: box.left,
    right: box.right,
    top: box.top,
    bottom: box.bottom,
  };
}

export interface AlignmentGuide {
  /** "x" = vertical line at this world-x; "y" = horizontal at world-y. */
  readonly axis: "x" | "y";
  readonly value: number;
}

export interface AlignmentResult {
  readonly center: { x: number; y: number };
  readonly guides: readonly AlignmentGuide[];
}

/**
 * Given a dragged item's centre + half-footprint and every OTHER item
 * in the scene, pull the centre to the nearest alignment anchor on each
 * axis if within `threshold` metres. Returns the adjusted centre plus
 * the guide lines that were active (for rendering).
 *
 * This is the "snap to centre + edges of neighbouring objects" behaviour
 * used by Figma / Keynote. Purely geometric, pure function.
 */
export function snapToAlignment(
  draggedCentre: { x: number; y: number },
  halfW: number,
  halfH: number,
  others: readonly BlueprintItem[],
  threshold: number = ALIGN_SNAP_M,
): AlignmentResult {
  const draggedXs = [draggedCentre.x, draggedCentre.x - halfW, draggedCentre.x + halfW];
  const draggedYs = [draggedCentre.y, draggedCentre.y - halfH, draggedCentre.y + halfH];
  let bestDx = 0;
  let bestDxDist = threshold;
  let bestGuideX: AlignmentGuide | null = null;
  let bestDy = 0;
  let bestDyDist = threshold;
  let bestGuideY: AlignmentGuide | null = null;

  for (const other of others) {
    const a = itemAnchors(other);
    const otherX = [a.cx, a.left, a.right];
    const otherY = [a.cy, a.top, a.bottom];
    for (const dx of draggedXs) {
      for (const ox of otherX) {
        const d = ox - dx;
        if (Math.abs(d) < bestDxDist) {
          bestDxDist = Math.abs(d);
          bestDx = d;
          bestGuideX = { axis: "x", value: ox };
        }
      }
    }
    for (const dy of draggedYs) {
      for (const oy of otherY) {
        const d = oy - dy;
        if (Math.abs(d) < bestDyDist) {
          bestDyDist = Math.abs(d);
          bestDy = d;
          bestGuideY = { axis: "y", value: oy };
        }
      }
    }
  }

  const center = { x: draggedCentre.x + bestDx, y: draggedCentre.y + bestDy };
  const guides: AlignmentGuide[] = [];
  if (bestGuideX !== null) guides.push(bestGuideX);
  if (bestGuideY !== null) guides.push(bestGuideY);
  return { center, guides };
}

// ---------------------------------------------------------------------------
// Resize (rect items only)
// ---------------------------------------------------------------------------

export type ResizeHandle = "nw" | "ne" | "sw" | "se";

/**
 * Resize a rect item by dragging one of its four corner handles to the
 * given world-space (x, y). Enforces a minimum 0.5 m × 0.5 m footprint.
 * Round tables don't support corner resize — returned unchanged.
 */
export function resizeItem(
  item: BlueprintItem,
  handle: ResizeHandle,
  toPoint: { x: number; y: number },
): BlueprintItem {
  if (item.shape === "round") return item;
  const MIN = 0.5;
  const box = aabbOf(item);
  let left = box.left;
  let right = box.right;
  let top = box.top;
  let bottom = box.bottom;
  if (handle === "nw") { left = Math.min(toPoint.x, right - MIN); top = Math.min(toPoint.y, bottom - MIN); }
  if (handle === "ne") { right = Math.max(toPoint.x, left + MIN); top = Math.min(toPoint.y, bottom - MIN); }
  if (handle === "sw") { left = Math.min(toPoint.x, right - MIN); bottom = Math.max(toPoint.y, top + MIN); }
  if (handle === "se") { right = Math.max(toPoint.x, left + MIN); bottom = Math.max(toPoint.y, top + MIN); }
  const next = {
    ...item,
    topLeft: { x: left, y: top },
    widthM: right - left,
    lengthM: bottom - top,
  };
  return next as BlueprintItem;
}
