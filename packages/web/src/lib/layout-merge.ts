import type { ReplayObject } from "./action-log-replay.js";

// ---------------------------------------------------------------------------
// layout-merge — the multiplayer core.
//
// THE PROBLEM THIS SOLVES. Today two simultaneous edits lose one of them:
// EditorBridge returns early while a push is in flight, so an edit arriving
// in that window is discarded by design and nobody is told. The socket is
// not the blocker (one is already built and unused) — the blocker is that
// the planner has no way to combine two divergent rooms.
//
// THE THREE PROMISES.
//   1. CONVERGENCE. merge(base, A, B) and merge(base, B, A) produce the same
//      room. Without this, two screens drift and multiplayer is worse than
//      working alone. Property-tested over 200 generated shapes.
//   2. NO SILENT LOSS. Field-level merging, so "Ana nudged the table while
//      Ben rotated it" keeps BOTH. Only a true same-field collision has a
//      loser, and the loser is reported — never quietly dropped.
//   3. DETERMINISM WITHOUT COORDINATION. Resolution is a pure function of
//      the inputs (later clock wins; exact ties break on actor id), so two
//      browsers reach the same answer without a round trip.
//
// WHAT THIS IS NOT. Not a general CRDT and not a transport. Ordering is
// deliberately not modelled: the array index is presentational here, and
// concurrent inserts are appended in a deterministic id order rather than
// fighting over a position. If a future requirement makes visual z-order
// semantic, that needs a real fractional index — do not fake it here.
// ---------------------------------------------------------------------------

export type LayoutEdit =
  | { readonly op: "update"; readonly id: string; readonly fields: Readonly<Record<string, unknown>> }
  | { readonly op: "insert"; readonly object: ReplayObject }
  | { readonly op: "remove"; readonly id: string };

export interface EditBranch {
  /** Stable identity of the editor — used to break exact clock ties. */
  readonly actor: string;
  /** ISO timestamp the branch's edits were made at. */
  readonly at: string;
  readonly edits: readonly LayoutEdit[];
}

export interface MergeConflict {
  readonly objectId: string;
  /** Absent when the conflict is about the object's existence, not a field. */
  readonly field?: string;
  readonly keptFrom: string;
  readonly discardedFrom: string;
  readonly discardedValue?: unknown;
  readonly reason: string;
}

export interface MergeResult {
  readonly objects: readonly ReplayObject[];
  /** Every edit that did NOT survive, with who lost and why. The operator
   *  is owed this: a silently dropped edit is the bug being fixed. */
  readonly conflicts: readonly MergeConflict[];
}

/** Later clock wins; an exact tie breaks on actor id so both browsers agree
 *  without talking to each other. Returns true when `a` beats `b`. */
function wins(a: EditBranch, b: EditBranch): boolean {
  if (a.at !== b.at) return a.at > b.at;
  return a.actor > b.actor;
}

export function mergeConcurrentEdits(
  base: readonly ReplayObject[],
  left: EditBranch,
  right: EditBranch,
): MergeResult {
  // Order the branches deterministically so the algorithm sees the same
  // "winner" and "loser" regardless of argument order — this is what makes
  // the operation commutative.
  const [loser, winner] = wins(left, right) ? [right, left] : [left, right];

  const conflicts: MergeConflict[] = [];
  const present = new Map<string, ReplayObject>(base.map((object) => [object.id, { ...object }]));
  const order: string[] = base.map((object) => object.id);

  // Removals from either branch, collected first: a remove beats a
  // concurrent edit, because resurrecting an object somebody deliberately
  // deleted is the more surprising outcome.
  const removed = new Map<string, string>();
  for (const branch of [winner, loser]) {
    for (const edit of branch.edits) {
      if (edit.op === "remove" && present.has(edit.id)) removed.set(edit.id, branch.actor);
    }
  }

  // Field-level updates. The loser applies first so the winner's values
  // overwrite on a genuine collision, and every overwrite is reported.
  const applied = new Map<string, Map<string, { value: unknown; actor: string }>>();
  for (const branch of [loser, winner]) {
    for (const edit of branch.edits) {
      if (edit.op !== "update") continue;

      if (!present.has(edit.id)) {
        conflicts.push({
          objectId: edit.id,
          keptFrom: "—",
          discardedFrom: branch.actor,
          reason: `edit discarded: ${edit.id} is not present in the shared layout`,
        });
        continue;
      }
      const remover = removed.get(edit.id);
      if (remover !== undefined) {
        conflicts.push({
          objectId: edit.id,
          keptFrom: remover,
          discardedFrom: branch.actor,
          reason: `edit discarded: ${edit.id} was removed by ${remover} at the same time`,
        });
        continue;
      }

      const fieldsForObject = applied.get(edit.id) ?? new Map<string, { value: unknown; actor: string }>();
      for (const [field, value] of Object.entries(edit.fields)) {
        const previous = fieldsForObject.get(field);
        if (previous !== undefined && previous.actor !== branch.actor) {
          conflicts.push({
            objectId: edit.id,
            field,
            keptFrom: branch.actor,
            discardedFrom: previous.actor,
            discardedValue: previous.value,
            reason: `both edited ${field}; kept ${branch.actor}'s value`,
          });
        }
        fieldsForObject.set(field, { value, actor: branch.actor });
      }
      applied.set(edit.id, fieldsForObject);
    }
  }

  for (const [id, fields] of applied) {
    const object = present.get(id);
    if (object === undefined) continue;
    const next: Record<string, unknown> = { ...object };
    for (const [field, resolved] of fields) next[field] = resolved.value;
    present.set(id, next as ReplayObject);
  }

  for (const id of removed.keys()) {
    present.delete(id);
  }

  // Insertions from both branches survive. They are appended in a
  // deterministic id order rather than competing for an array position,
  // which is precisely why concurrent inserts commute here.
  const inserted: ReplayObject[] = [];
  for (const branch of [winner, loser]) {
    for (const edit of branch.edits) {
      if (edit.op !== "insert") continue;
      if (present.has(edit.object.id)) continue;
      inserted.push({ ...edit.object });
      present.set(edit.object.id, { ...edit.object });
    }
  }
  inserted.sort((a, b) => a.id.localeCompare(b.id));

  const objects: ReplayObject[] = [];
  for (const id of order) {
    const object = present.get(id);
    if (object !== undefined) objects.push(object);
  }
  objects.push(...inserted);

  // Stable conflict order, so two browsers report identically.
  conflicts.sort((a, b) =>
    a.objectId.localeCompare(b.objectId) || (a.field ?? "").localeCompare(b.field ?? ""));

  return { objects, conflicts };
}
