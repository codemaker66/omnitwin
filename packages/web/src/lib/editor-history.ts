// ---------------------------------------------------------------------------
// editor-history — pure command-sourced undo/redo engine
//
// Records document mutations as invertible deltas (added / removed /
// updated field patches) rather than snapshots, so one bounded timeline
// can span the 3D scene and 2D blueprint, coalesce drags, and survive
// server saves via whole-history ID remapping.
//
// The engine is generic over any flat object with a string `id` whose
// remaining fields are primitives (shallow Object.is comparison). It has
// zero dependencies and performs no I/O — the editor store owns wiring.
// ---------------------------------------------------------------------------

export interface HistoryObject {
  readonly id: string;
}

/** Hard cap on undoable steps; beyond this the oldest entries are dropped. */
export const MAX_HISTORY_ENTRIES = 100;

/** Soft memory budget for the whole timeline (UTF-16 estimate). */
export const MAX_HISTORY_BYTES = 2 * 1024 * 1024;

/** Field-level change for one object; `before`/`after` hold only changed keys. */
export interface ObjectFieldPatch<T extends HistoryObject> {
  readonly id: string;
  readonly before: Readonly<Partial<T>>;
  readonly after: Readonly<Partial<T>>;
}

/** An object captured together with the array index it occupied. */
export interface PlacedAt<T extends HistoryObject> {
  readonly object: T;
  readonly index: number;
}

/** Invertible difference between two document states. */
export interface HistoryDelta<T extends HistoryObject> {
  readonly added: readonly PlacedAt<T>[];
  readonly removed: readonly PlacedAt<T>[];
  readonly updated: readonly ObjectFieldPatch<T>[];
}

/** One undoable step: an invertible delta plus selection and coalescing context. */
export interface HistoryEntry<T extends HistoryObject> extends HistoryDelta<T> {
  readonly label: string;
  /** Interaction epoch — consecutive update-only entries in one epoch coalesce. */
  readonly epoch: number;
  readonly selectionBefore: readonly string[];
  readonly selectionAfter: readonly string[];
}

/** The full timeline. `past` and `future` are stacks with newest at the end. */
export interface EditorHistory<T extends HistoryObject> {
  readonly past: readonly HistoryEntry<T>[];
  readonly future: readonly HistoryEntry<T>[];
}

export interface RecordChangeInput<T extends HistoryObject> {
  readonly before: readonly T[];
  readonly after: readonly T[];
  readonly label: string;
  readonly epoch: number;
  readonly selectionBefore: readonly string[];
  readonly selectionAfter: readonly string[];
}

export function emptyHistory<T extends HistoryObject>(): EditorHistory<T> {
  return { past: [], future: [] };
}

export function canUndo<T extends HistoryObject>(history: EditorHistory<T>): boolean {
  return history.past.length > 0;
}

export function canRedo<T extends HistoryObject>(history: EditorHistory<T>): boolean {
  return history.future.length > 0;
}

/** Label of the entry undo would revert, for UI affordances. Null when empty. */
export function undoLabel<T extends HistoryObject>(history: EditorHistory<T>): string | null {
  return history.past.at(-1)?.label ?? null;
}

/** Label of the entry redo would reapply, for UI affordances. Null when empty. */
export function redoLabel<T extends HistoryObject>(history: EditorHistory<T>): string | null {
  return history.future.at(-1)?.label ?? null;
}

/**
 * How the engine mints and recognises client-local IDs. Undo/redo
 * re-insertions of server-persisted objects must be healed to fresh local
 * IDs (the server silently drops updates addressed to deleted rows).
 */
export interface HistoryIdAdapter {
  makeLocalId(): string;
  isLocalId(id: string): boolean;
}

/** Result of one undo/redo step. */
export interface HistoryStep<T extends HistoryObject> {
  readonly history: EditorHistory<T>;
  readonly objects: readonly T[];
  readonly selection: readonly string[];
  readonly label: string;
}

function remapId(id: string, idMap: ReadonlyMap<string, string>): string {
  return idMap.get(id) ?? id;
}

function remapIdList(
  ids: readonly string[],
  idMap: ReadonlyMap<string, string>,
): readonly string[] {
  return ids.map((id) => remapId(id, idMap));
}

function remapPlaced<T extends HistoryObject>(
  placed: readonly PlacedAt<T>[],
  idMap: ReadonlyMap<string, string>,
): readonly PlacedAt<T>[] {
  return placed.map(({ object, index }) => ({
    object: { ...object, id: remapId(object.id, idMap) } as T,
    index,
  }));
}

function remapEntry<T extends HistoryObject>(
  entry: HistoryEntry<T>,
  idMap: ReadonlyMap<string, string>,
): HistoryEntry<T> {
  return {
    ...entry,
    added: remapPlaced(entry.added, idMap),
    removed: remapPlaced(entry.removed, idMap),
    updated: entry.updated.map((patch) => ({ ...patch, id: remapId(patch.id, idMap) })),
    selectionBefore: remapIdList(entry.selectionBefore, idMap),
    selectionAfter: remapIdList(entry.selectionAfter, idMap),
  };
}

/**
 * Rewrite object ids across the whole timeline — object records, patch
 * targets, and selections, in both stacks. Field values (e.g. `groupId`)
 * are never touched: they share no namespace with object ids.
 */
export function remapHistoryIds<T extends HistoryObject>(
  history: EditorHistory<T>,
  idMap: ReadonlyMap<string, string>,
): EditorHistory<T> {
  if (idMap.size === 0) {
    return history;
  }
  return {
    past: history.past.map((entry) => remapEntry(entry, idMap)),
    future: history.future.map((entry) => remapEntry(entry, idMap)),
  };
}

/**
 * Fresh local ids for re-inserted objects that were server-persisted.
 * The batch save silently skips updates addressed to deleted rows, so a
 * resurrected object must re-enter as a new row, never by its dead id.
 */
function buildHealMap<T extends HistoryObject>(
  reinserted: readonly PlacedAt<T>[],
  ids: HistoryIdAdapter,
): ReadonlyMap<string, string> {
  const healMap = new Map<string, string>();
  for (const { object } of reinserted) {
    if (!ids.isLocalId(object.id)) {
      healMap.set(object.id, ids.makeLocalId());
    }
  }
  return healMap;
}

function insertAscending<T extends HistoryObject>(
  doc: T[],
  placed: readonly PlacedAt<T>[],
): void {
  const byIndex = [...placed].sort((a, b) => a.index - b.index);
  for (const { object, index } of byIndex) {
    doc.splice(Math.min(index, doc.length), 0, object);
  }
}

/**
 * Apply one side of an entry to a document: drop `remove`, re-insert
 * `insert` at their recorded indexes, then overlay the chosen side of
 * each field patch.
 */
function applyEntryToDoc<T extends HistoryObject>(
  objects: readonly T[],
  remove: readonly PlacedAt<T>[],
  insert: readonly PlacedAt<T>[],
  patches: readonly ObjectFieldPatch<T>[],
  side: "before" | "after",
): readonly T[] {
  const removeIds = new Set(remove.map((placed) => placed.object.id));
  const doc = objects.filter((object) => !removeIds.has(object.id));
  insertAscending(doc, insert);
  const patchById = new Map(patches.map((patch) => [patch.id, patch]));
  return doc.map((object) => {
    const patch = patchById.get(object.id);
    if (patch === undefined) {
      return object;
    }
    return { ...object, ...(side === "before" ? patch.before : patch.after) };
  });
}

export function performUndo<T extends HistoryObject>(
  history: EditorHistory<T>,
  objects: readonly T[],
  ids: HistoryIdAdapter,
): HistoryStep<T> | null {
  const entry = history.past.at(-1);
  if (entry === undefined) {
    return null;
  }
  const healMap = buildHealMap(entry.removed, ids);
  const healed = healMap.size === 0 ? entry : remapEntry(entry, healMap);
  return {
    history: remapHistoryIds(
      { past: history.past.slice(0, -1), future: [...history.future, entry] },
      healMap,
    ),
    objects: applyEntryToDoc(objects, healed.added, healed.removed, healed.updated, "before"),
    selection: healed.selectionBefore,
    label: entry.label,
  };
}

export function performRedo<T extends HistoryObject>(
  history: EditorHistory<T>,
  objects: readonly T[],
  ids: HistoryIdAdapter,
): HistoryStep<T> | null {
  const entry = history.future.at(-1);
  if (entry === undefined) {
    return null;
  }
  const healMap = buildHealMap(entry.added, ids);
  const healed = healMap.size === 0 ? entry : remapEntry(entry, healMap);
  return {
    history: remapHistoryIds(
      { past: [...history.past, entry], future: history.future.slice(0, -1) },
      healMap,
    ),
    objects: applyEntryToDoc(objects, healed.removed, healed.added, healed.updated, "after"),
    selection: healed.selectionAfter,
    label: entry.label,
  };
}

function isUpdateOnly<T extends HistoryObject>(entry: HistoryDelta<T>): boolean {
  return entry.added.length === 0 && entry.removed.length === 0;
}

function patchKeys<T extends HistoryObject>(patch: ObjectFieldPatch<T>): readonly string[] {
  return Object.keys(patch.after);
}

function sameStringSet(a: readonly string[], b: readonly string[]): boolean {
  if (a.length !== b.length) {
    return false;
  }
  const set = new Set(a);
  return b.every((value) => set.has(value));
}

/**
 * Two entries coalesce when they belong to one interaction epoch and are
 * pure field updates over the same objects and the same fields — i.e.
 * successive frames of the same drag, slider, or nudge.
 */
function canCoalesce<T extends HistoryObject>(
  top: HistoryEntry<T>,
  next: HistoryEntry<T>,
): boolean {
  if (top.epoch !== next.epoch || !isUpdateOnly(top) || !isUpdateOnly(next)) {
    return false;
  }
  if (top.updated.length !== next.updated.length) {
    return false;
  }
  const topById = new Map(top.updated.map((patch) => [patch.id, patch]));
  return next.updated.every((patch) => {
    const prior = topById.get(patch.id);
    return prior !== undefined && sameStringSet(patchKeys(prior), patchKeys(patch));
  });
}

function coalesceEntries<T extends HistoryObject>(
  top: HistoryEntry<T>,
  next: HistoryEntry<T>,
): HistoryEntry<T> {
  const topById = new Map(top.updated.map((patch) => [patch.id, patch]));
  return {
    ...top,
    updated: next.updated.map((patch) => ({
      id: patch.id,
      before: topById.get(patch.id)?.before ?? patch.before,
      after: patch.after,
    })),
    selectionAfter: next.selectionAfter,
    label: next.label,
  };
}

function asUnknownRecord(value: object): Record<string, unknown> {
  return value as Record<string, unknown>;
}

/** True when every patch in the entry changes nothing end-to-end. */
function isIdentityEntry<T extends HistoryObject>(entry: HistoryEntry<T>): boolean {
  return (
    isUpdateOnly(entry) &&
    entry.updated.every((patch) =>
      patchKeys(patch).every((key) =>
        Object.is(asUnknownRecord(patch.before)[key], asUnknownRecord(patch.after)[key]),
      ),
    )
  );
}

/**
 * Per-entry size memo. Entries are immutable, so caching on identity is
 * sound; it keeps budget enforcement from re-serialising the whole
 * timeline on every recorded frame of a drag.
 */
const entryByteCache = new WeakMap<object, number>();

function estimateEntryBytes(entry: object): number {
  const cached = entryByteCache.get(entry);
  if (cached !== undefined) {
    return cached;
  }
  const bytes = JSON.stringify(entry).length * 2;
  entryByteCache.set(entry, bytes);
  return bytes;
}

/** Drop oldest past entries beyond the entry cap and the byte budget. */
function enforceBudgets<T extends HistoryObject>(
  history: EditorHistory<T>,
): EditorHistory<T> {
  let past = history.past;
  if (past.length > MAX_HISTORY_ENTRIES) {
    past = past.slice(past.length - MAX_HISTORY_ENTRIES);
  }
  let total = [...past, ...history.future].reduce(
    (sum, entry) => sum + estimateEntryBytes(entry),
    0,
  );
  let dropCount = 0;
  while (total > MAX_HISTORY_BYTES && past.length - dropCount > 1) {
    const oldest = past[dropCount];
    if (oldest === undefined) {
      break;
    }
    total -= estimateEntryBytes(oldest);
    dropCount++;
  }
  if (dropCount > 0) {
    past = past.slice(dropCount);
  }
  return past === history.past ? history : { past, future: history.future };
}

/**
 * Record a document mutation. No-ops return the history unchanged; real
 * changes clear the redo future and push a new entry — or merge into the
 * previous one when both are frames of the same interaction. A merged
 * entry that ends where it started (drag away and back) is dropped.
 */
export function recordChange<T extends HistoryObject>(
  history: EditorHistory<T>,
  input: RecordChangeInput<T>,
): EditorHistory<T> {
  const delta = diffObjects(input.before, input.after);
  if (delta === null) {
    return history;
  }
  const entry: HistoryEntry<T> = {
    ...delta,
    label: input.label,
    epoch: input.epoch,
    selectionBefore: input.selectionBefore,
    selectionAfter: input.selectionAfter,
  };
  const top = history.future.length === 0 ? history.past.at(-1) : undefined;
  if (top !== undefined && canCoalesce(top, entry)) {
    const merged = coalesceEntries(top, entry);
    const past = isIdentityEntry(merged)
      ? history.past.slice(0, -1)
      : [...history.past.slice(0, -1), merged];
    return enforceBudgets({ past, future: [] });
  }
  return enforceBudgets({ past: [...history.past, entry], future: [] });
}

function fieldKeys<T extends HistoryObject>(o: T): readonly (keyof T & string)[] {
  return Object.keys(o).filter((key) => key !== "id") as (keyof T & string)[];
}

function shallowFieldPatch<T extends HistoryObject>(
  before: T,
  after: T,
): ObjectFieldPatch<T> | null {
  const keys = new Set<keyof T & string>([...fieldKeys(before), ...fieldKeys(after)]);
  const changedBefore: Partial<T> = {};
  const changedAfter: Partial<T> = {};
  let changed = false;
  for (const key of keys) {
    if (!Object.is(before[key], after[key])) {
      changed = true;
      changedBefore[key] = before[key];
      changedAfter[key] = after[key];
    }
  }
  return changed
    ? { id: before.id, before: changedBefore, after: changedAfter }
    : null;
}

/**
 * Compute the invertible delta between two document states, or null when
 * nothing changed. Objects are matched by `id`; pure reordering is not
 * considered a mutation (no real editor action reorders without also
 * adding, removing, or updating).
 */
export function diffObjects<T extends HistoryObject>(
  before: readonly T[],
  after: readonly T[],
): HistoryDelta<T> | null {
  const beforeById = new Map(before.map((object) => [object.id, object]));
  const afterIds = new Set(after.map((object) => object.id));

  const added: PlacedAt<T>[] = [];
  const updated: ObjectFieldPatch<T>[] = [];
  after.forEach((object, index) => {
    const prior = beforeById.get(object.id);
    if (prior === undefined) {
      added.push({ object, index });
      return;
    }
    const patch = shallowFieldPatch(prior, object);
    if (patch !== null) {
      updated.push(patch);
    }
  });

  const removed: PlacedAt<T>[] = [];
  before.forEach((object, index) => {
    if (!afterIds.has(object.id)) {
      removed.push({ object, index });
    }
  });

  return added.length === 0 && removed.length === 0 && updated.length === 0
    ? null
    : { added, removed, updated };
}
