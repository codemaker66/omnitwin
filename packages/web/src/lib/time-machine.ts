import type { Action } from "@omnitwin/types";
import type { AuditLogEntry } from "../api/action-log.js";
import type { ActionContext } from "./action-log.js";
import { asJson } from "./action-log.js";
import { replayActions, type ReplayObject } from "./action-log-replay.js";
import { changeHistoryRows } from "./change-history-model.js";

// ---------------------------------------------------------------------------
// time-machine — the payoff of the G4 Action log (03 §1).
//
// Deep undo, version restore and session replay are not three features. They
// are three questions asked of one engine, because the audit trail already
// holds every mutation AND its exact inverse in server order:
//
//   documentAtOrdinal  — "what did the room look like at this point?"
//   timelineMarkers    — "which points can I travel to?"
//   planRestore        — "put the room back to that point."
//
// The load-bearing decision: restoring never rewrites history. It APPENDS a
// single `layout.restore` Action whose delta moves the live document to the
// historical state and whose inverse brings it back. So the trail stays
// append-only, a restore is itself auditable, and a restore can be undone
// like any other gesture. Deep undo is then just travel to an older ordinal
// — unbounded by the 100-entry in-memory undo cap, because the trail, not
// the browser tab, is the truth.
//
// Pure: no store reads, no I/O. Ids and timestamps arrive via ActionContext.
// ---------------------------------------------------------------------------

const ACTOR_LABEL: Record<string, string> = {
  operator: "Operator",
  ai: "AI",
  system: "System",
};

export interface DocumentAtOrdinal {
  readonly objects: readonly ReplayObject[];
  /** The newest ordinal actually applied (server ordinals are sparse, so
   *  this can be lower than the ordinal asked for). 0 when nothing applied. */
  readonly appliedThrough: number;
  readonly issues: readonly string[];
}

/** Reconstruct the document as it stood immediately after `ordinal`.
 *  Inclusive of that ordinal; everything after it is ignored.
 *
 *  `base` is the document the trail started FROM — the objects a saved
 *  configuration was loaded with. It is not optional in spirit: a reopened
 *  configuration's trail contains only the gestures made since it loaded
 *  (loadConfiguration emits no Action for the loaded objects), so omitting
 *  the base reconstructs a room missing its pre-existing furniture. It
 *  defaults to empty only so a session that genuinely started from an empty
 *  room needs no ceremony. */
export function documentAtOrdinal(
  entries: readonly AuditLogEntry[],
  ordinal: number,
  base: readonly ReplayObject[] = [],
): DocumentAtOrdinal {
  // Filter, never sort — sorting would silently repair a broken trail and
  // hide exactly the order violation the replay gate exists to catch.
  const upTo = entries.filter((entry) => entry.ordinal <= ordinal);
  const result = replayActions(upTo, base);
  let appliedThrough = 0;
  for (const entry of upTo) {
    if (entry.ordinal > appliedThrough) appliedThrough = entry.ordinal;
  }
  return { objects: result.objects, appliedThrough, issues: result.issues };
}

export interface TimelineMarker {
  readonly ordinal: number;
  readonly title: string;
  /** Operator-reported clock, as recorded — never server-verified. */
  readonly when: string;
  readonly whenNote: string;
  readonly actorLabel: string;
  /** True when the gesture added or removed objects, false for adjustments.
   *  Lets the scrubber weight structural moments more heavily than nudges. */
  readonly structural: boolean;
}

function isStructural(entry: AuditLogEntry): boolean {
  return entry.intent === "object.place"
    || entry.intent === "object.remove"
    || entry.intent === "layout.restore";
}

/** The travellable points on the trail, newest first. Log-management records
 *  (fold summaries) are excluded — a summary is not a state you can visit. */
export function timelineMarkers(entries: readonly AuditLogEntry[]): readonly TimelineMarker[] {
  const meaningful = entries.filter((entry) => !entry.intent.startsWith("log."));
  const byOrdinal = new Map(meaningful.map((entry) => [entry.ordinal, entry]));
  // changeHistoryRows already owns the claim-safe titling and clock
  // formatting (and returns newest-first) — reuse it rather than restating
  // those rules, so the scrubber and the history panel can never disagree.
  return changeHistoryRows(meaningful).map((row) => {
    const entry = byOrdinal.get(row.ordinal);
    return {
      ordinal: row.ordinal,
      title: row.title,
      when: row.when,
      whenNote: row.whenNote,
      actorLabel: entry === undefined ? "Operator" : ACTOR_LABEL[entry.actor.kind] ?? entry.actor.kind,
      structural: entry !== undefined && isStructural(entry),
    };
  });
}

interface RestoreDelta {
  readonly label: string;
  readonly targetOrdinal: number;
  readonly added: readonly { readonly object: ReplayObject; readonly index: number }[];
  readonly removed: readonly { readonly object: ReplayObject; readonly index: number }[];
  /** Exact object order after the delta, when order differs. */
  readonly order: readonly string[] | null;
  readonly updated: readonly {
    readonly id: string;
    readonly before: Record<string, unknown>;
    readonly after: Record<string, unknown>;
    /** Keys present before the patch that must be absent afterwards. */
    readonly unset: readonly string[];
  }[];
}

/** Field-level diff of two versions of the same object: only what changed. */
function changedFields(
  from: ReplayObject,
  to: ReplayObject,
): { before: Record<string, unknown>; after: Record<string, unknown>; unset: readonly string[] } | null {
  const before: Record<string, unknown> = {};
  const after: Record<string, unknown> = {};
  const unset: string[] = [];
  const keys = new Set([...Object.keys(from), ...Object.keys(to)]);
  keys.delete("id");
  for (const key of keys) {
    if (JSON.stringify(from[key]) === JSON.stringify(to[key])) continue;
    const fromHasKey = Object.prototype.hasOwnProperty.call(from, key);
    const toHasKey = Object.prototype.hasOwnProperty.call(to, key);
    if (fromHasKey) before[key] = from[key];
    if (toHasKey) after[key] = to[key];
    if (fromHasKey && !toHasKey) unset.push(key);
  }
  return Object.keys(after).length === 0 && unset.length === 0
    ? null
    : { before, after, unset };
}

/** Plan the restore of `current` to the historical `target`.
 *  Returns null when they already match — no empty audit noise. */
export function planRestore(
  current: readonly ReplayObject[],
  target: readonly ReplayObject[],
  context: ActionContext,
  meta: { readonly targetOrdinal: number },
): Action | null {
  const currentById = new Map(current.map((object, index) => [object.id, { object, index }]));
  const targetById = new Map(target.map((object, index) => [object.id, { object, index }]));

  const removed = current
    .map((object, index) => ({ object, index }))
    .filter((placed) => !targetById.has(placed.object.id));
  const added = target
    .map((object, index) => ({ object, index }))
    .filter((placed) => !currentById.has(placed.object.id));

  const updated: RestoreDelta["updated"] = [...targetById.entries()].flatMap(([id, targetPlaced]) => {
    const currentPlaced = currentById.get(id);
    if (currentPlaced === undefined) return [];
    const diff = changedFields(currentPlaced.object, targetPlaced.object);
    return diff === null ? [] : [{ id, before: diff.before, after: diff.after, unset: diff.unset }];
  });
  const currentOrder = current.map((object) => object.id);
  const targetOrder = target.map((object) => object.id);
  const orderChanged = currentOrder.length !== targetOrder.length
    || currentOrder.some((id, index) => id !== targetOrder[index]);

  if (removed.length === 0 && added.length === 0 && updated.length === 0 && !orderChanged) return null;

  const label = `Restore to change ${String(meta.targetOrdinal)}`;
  const forward: RestoreDelta = {
    label,
    targetOrdinal: meta.targetOrdinal,
    added,
    removed,
    order: orderChanged ? targetOrder : null,
    updated,
  };
  // The inverse is the mirror: what the restore removed comes back, what it
  // added goes away, and every field patch is flipped.
  const backward: RestoreDelta = {
    label,
    targetOrdinal: meta.targetOrdinal,
    added: removed,
    removed: added,
    order: orderChanged ? currentOrder : null,
    updated: updated.map((patch) => ({
      id: patch.id,
      before: patch.after,
      after: patch.before,
      unset: Object.keys(patch.after).filter(
        (key) => !Object.prototype.hasOwnProperty.call(patch.before, key),
      ),
    })),
  };

  return {
    id: context.makeId(),
    actor: context.actor,
    intent: "layout.restore",
    payload: asJson(forward),
    inverse: asJson(backward),
    provenance: { surface: context.surface, tool: "time-machine" },
    ts: context.now(),
  };
}
