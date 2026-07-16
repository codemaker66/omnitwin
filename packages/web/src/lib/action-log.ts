import type { Action, ActionActor, JsonValue } from "@omnitwin/types";
import type { EditorHistory, HistoryEntry, HistoryObject } from "./editor-history.js";

// ---------------------------------------------------------------------------
// action-log — G4 Slice 1 (03 §1).
//
// Turns the editor history's invertible deltas into Action envelopes and
// decides WHEN to emit: exactly one Action per completed gesture. The undo
// timeline coalesces drag frames into its top entry, so the top is treated
// as the open gesture; it seals (emits) when a new entry appends over it,
// when undo pops it, or on an explicit flush (save/config boundaries).
// Pure: ids/timestamps are injected via context. No I/O, no store imports —
// the editor store owns wiring.
// ---------------------------------------------------------------------------

export interface ActionContext {
  readonly actor: ActionActor;
  readonly surface: string;
  readonly makeId: () => string;
  readonly now: () => string;
}

/** JSON normalization: guarantees the schema's serializable contract.
 *  Runs at gesture rate (not per frame), so the round-trip cost is noise. */
function asJson(value: unknown): JsonValue {
  return JSON.parse(JSON.stringify(value)) as JsonValue;
}

function intentForDelta<T extends HistoryObject>(entry: HistoryEntry<T>): string {
  const adds = entry.added.length > 0;
  const removes = entry.removed.length > 0;
  const updates = entry.updated.length > 0;
  if (adds && !removes && !updates) return "object.place";
  if (removes && !adds && !updates) return "object.remove";
  if (updates && !adds && !removes) return "object.update";
  return "object.batch";
}

export function actionFromHistoryEntry<T extends HistoryObject>(
  entry: HistoryEntry<T>,
  context: ActionContext,
): Action {
  return {
    id: context.makeId(),
    actor: context.actor,
    intent: intentForDelta(entry),
    payload: asJson({
      label: entry.label,
      added: entry.added,
      removed: entry.removed,
      updated: entry.updated,
      selectionBefore: entry.selectionBefore,
      selectionAfter: entry.selectionAfter,
    }),
    // The mirrored delta: applying it reverts the gesture.
    inverse: asJson({
      label: entry.label,
      added: entry.removed,
      removed: entry.added,
      updated: entry.updated.map((patch) => ({
        id: patch.id,
        before: patch.after,
        after: patch.before,
      })),
      selectionBefore: entry.selectionAfter,
      selectionAfter: entry.selectionBefore,
    }),
    provenance: { surface: context.surface },
    ts: context.now(),
  };
}

function metaAction(
  intent: "history.undo" | "history.redo",
  label: string | null,
  context: ActionContext,
): Action {
  const inverseIntent = intent === "history.undo" ? "history.redo" : "history.undo";
  return {
    id: context.makeId(),
    actor: context.actor,
    intent,
    payload: asJson({ label }),
    inverse: asJson({ intent: inverseIntent, label }),
    provenance: { surface: context.surface },
    ts: context.now(),
  };
}

export interface ActionEmitter<T extends HistoryObject> {
  /** Call after every recordChange with the histories around it. */
  readonly afterRecord: (previous: EditorHistory<T>, next: EditorHistory<T>) => void;
  /** Call before applying undo, with the history whose top will pop. */
  readonly afterUndo: (previous: EditorHistory<T>) => void;
  /** Call after redo, with the history whose top was re-applied. */
  readonly afterRedo: (next: EditorHistory<T>) => void;
  /** Seal the open gesture (autosave and config-switch boundaries). */
  readonly flush: (history: EditorHistory<T>) => void;
  /** Start a new timeline generation. MUST be called whenever the history
   *  is reset to empty (config boundaries): gesture seqs restart at 1 there,
   *  and a stale cursor would silently skip every gesture that follows. */
  readonly reset: () => void;
}

export function createActionEmitter<T extends HistoryObject>(options: {
  readonly emit: (action: Action) => void;
  readonly context: () => ActionContext;
}): ActionEmitter<T> {
  // Gestures are sealed by their engine-assigned `seq`, never by object
  // identity — entries are legitimately cloned wholesale by id remapping
  // (saves, undo healing), and the timeline's eviction keeps `past.length`
  // constant at the cap, so neither identity nor length comparisons are
  // reliable signals (both burned us in review). The invariant: every entry
  // strictly below the open top gets sealed, oldest-first, on every call.
  let lastSealedSeq = 0;

  const seal = (entry: HistoryEntry<T>): void => {
    if (entry.seq <= lastSealedSeq) return;
    lastSealedSeq = entry.seq;
    options.emit(actionFromHistoryEntry(entry, options.context()));
  };

  const sealBelowTop = (history: EditorHistory<T>): void => {
    for (const entry of history.past.slice(0, -1)) seal(entry);
  };

  return {
    afterRecord: (_previous, next) => {
      // The top stays open (it may still coalesce); everything beneath it is
      // final — including a previous top buried by a cap-cycle append+evict.
      sealBelowTop(next);
    },
    afterUndo: (previous) => {
      const top = previous.past.at(-1);
      if (top === undefined) return;
      sealBelowTop(previous);
      seal(top);
      options.emit(metaAction("history.undo", top.label, options.context()));
    },
    afterRedo: (next) => {
      const top = next.past.at(-1);
      if (top === undefined) return;
      // The re-applied gesture was sealed when it was first undone; only the
      // redo itself is a new event.
      options.emit(metaAction("history.redo", top.label, options.context()));
    },
    flush: (history) => {
      sealBelowTop(history);
      const top = history.past.at(-1);
      if (top !== undefined) seal(top);
    },
    reset: () => {
      lastSealedSeq = 0;
    },
  };
}
