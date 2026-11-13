import { useEditorStore } from "../stores/editor-store.js";
import { postPlacementNotice } from "../stores/placement-notice-store.js";
import { usePlacementStore } from "../stores/placement-store.js";
import { useSelectionStore } from "../stores/selection-store.js";
import { withNoteSeeds } from "./note-seeds.js";
import type { PlacedItem } from "./placement.js";
import { planLineUp, planMove, type MovePlan } from "./placement-moves.js";
import { asOneUndoStep, editWorld, selectedIds } from "./planner-keymap.js";
import { planReplace, type ReplaceOptions, type ReplacePlan, type ReplaceResult } from "./replace.js";
import type { CardParams } from "./setup-cards.js";

// ---------------------------------------------------------------------------
// Line up, Move and Replace (spec §8.2, §18; Q-16, Q-18, law 11), the
// commands the caption's verbs and any key call alike: the plan
// (lib/placement-moves, lib/replace; every piece settled where it stands),
// set down as one undo step (placement-store applyEdit), the result
// selected. A refusal says why where a placement notice would.
//
// Apart from the keymap (lib/planner-keymap.ts) because no key of today's
// planner calls them: only the new chrome does, so they load with it (T-671).
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
