import { z } from "zod";
import { ActionSchema } from "@omnitwin/types";
import type { AuditLogEntry } from "../api/action-log.js";

// ---------------------------------------------------------------------------
// action-log-replay — G4 Slice 3's replay-from-log verification.
//
// Answers one question about a read-back audit page: could a reconstruction
// replay it faithfully? Requirements: server order holds (strictly
// increasing ordinals — client clocks never order the trail), every entry
// reconstructs to a valid Action envelope, no action id appears twice, and
// every document mutation carries a real inverse. `history.*` metas and
// `log.*` management records are exempt from the inverse rule. Full session
// replay (actually applying the actions) is slice 4; this is its gate.
// ---------------------------------------------------------------------------

export interface ReplayVerdict {
  readonly replayable: boolean;
  readonly issues: readonly string[];
  readonly counts: {
    readonly total: number;
    readonly mutations: number;
    readonly metas: number;
    readonly logManagement: number;
  };
}

const MAX_ISSUES = 20;

function isMeta(intent: string): boolean {
  return intent.startsWith("history.");
}

function isLogManagement(intent: string): boolean {
  return intent.startsWith("log.");
}

export function verifyReplayable(entries: readonly AuditLogEntry[]): ReplayVerdict {
  const issues: string[] = [];
  const seenIds = new Set<string>();
  let previousOrdinal = -1;
  let mutations = 0;
  let metas = 0;
  let logManagement = 0;

  for (const item of entries) {
    if (issues.length >= MAX_ISSUES) break;

    if (item.ordinal <= previousOrdinal) {
      issues.push(`ordinal ${String(item.ordinal)} breaks server order after ${String(previousOrdinal)}`);
    }
    previousOrdinal = item.ordinal;

    if (seenIds.has(item.id)) {
      issues.push(`duplicate action id ${item.id} — one action must never replay twice`);
    }
    seenIds.add(item.id);

    const envelope = ActionSchema.safeParse({
      id: item.id,
      actor: item.actor,
      intent: item.intent,
      payload: item.payload,
      inverse: item.inverse,
      provenance: item.provenance,
      ts: item.recordedTs,
    });
    if (!envelope.success) {
      issues.push(`entry ${String(item.ordinal)} is not a valid Action envelope`);
      continue;
    }

    if (isLogManagement(item.intent)) {
      logManagement += 1;
    } else if (isMeta(item.intent)) {
      metas += 1;
    } else {
      mutations += 1;
      if (item.inverse === null) {
        issues.push(`mutation ${item.intent} at ordinal ${String(item.ordinal)} has no inverse`);
      }
    }
  }

  return {
    replayable: issues.length === 0,
    issues,
    counts: { total: entries.length, mutations, metas, logManagement },
  };
}

// ---------------------------------------------------------------------------
// replayActions — slice 4: the actual session replay. Applies object.*
// payload deltas in server order. history.undo/redo replay through each
// action's OWN recorded inverse (the log is the truth — nothing is
// recomputed), via a gesture stack exactly mirroring the editor's undo
// semantics (a new mutation clears the redo stack). Non-object surfaces
// are tallied as skipped, never silently dropped; a fold summary is an
// issue — its constituents are not individually replayable from this page.
// ---------------------------------------------------------------------------

/** A reconstructed placed object: the id plus whatever fields the recorded
 *  payloads carried. Replay never invents fields. */
export type ReplayObject = { readonly id: string } & Record<string, unknown>;

const ReplayPlacedSchema = z.object({
  object: z.object({ id: z.string() }).passthrough(),
  index: z.number().int().nonnegative(),
});

const ReplayPatchSchema = z.object({
  id: z.string(),
  before: z.record(z.unknown()),
  after: z.record(z.unknown()),
});

const ReplayDeltaSchema = z.object({
  added: z.array(ReplayPlacedSchema).default([]),
  removed: z.array(ReplayPlacedSchema).default([]),
  updated: z.array(ReplayPatchSchema).default([]),
});
type ReplayDelta = z.infer<typeof ReplayDeltaSchema>;

export interface ReplayResult {
  readonly objects: readonly ReplayObject[];
  readonly applied: number;
  readonly undone: number;
  readonly redone: number;
  readonly skipped: readonly { readonly intent: string; readonly count: number }[];
  readonly issues: readonly string[];
}

function applyDelta(
  objects: readonly ReplayObject[],
  delta: ReplayDelta,
  ordinal: number,
  issues: string[],
): readonly ReplayObject[] {
  let next = [...objects];
  for (const removal of delta.removed) {
    const index = next.findIndex((candidate) => candidate.id === removal.object.id);
    if (index < 0) {
      issues.push(`ordinal ${String(ordinal)} removes ${removal.object.id}, which is not present`);
      continue;
    }
    next.splice(index, 1);
  }
  // Sort by index before splicing — the live engine's insertAscending does
  // exactly this, and replay must reconstruct identically even if a
  // producer ever emits additions out of array order (reviewer M1).
  for (const addition of [...delta.added].sort((a, b) => a.index - b.index)) {
    next.splice(Math.min(addition.index, next.length), 0, addition.object as ReplayObject);
  }
  next = next.map((candidate) => {
    const patch = delta.updated.find((update) => update.id === candidate.id);
    return patch === undefined ? candidate : { ...candidate, ...patch.after };
  });
  for (const patch of delta.updated) {
    if (!next.some((candidate) => candidate.id === patch.id)) {
      issues.push(`ordinal ${String(ordinal)} updates ${patch.id}, which is not present`);
    }
  }
  return next;
}

export function replayActions(entries: readonly AuditLogEntry[]): ReplayResult {
  const verdict = verifyReplayable(entries);
  if (!verdict.replayable) {
    return { objects: [], applied: 0, undone: 0, redone: 0, skipped: [], issues: verdict.issues };
  }

  const issues: string[] = [];
  const skipped = new Map<string, number>();
  let objects: readonly ReplayObject[] = [];
  // Each applied gesture keeps BOTH recorded deltas so undo/redo replay
  // from the log's own inverses.
  const undoStack: { readonly payload: ReplayDelta; readonly inverse: ReplayDelta }[] = [];
  const redoStack: { readonly payload: ReplayDelta; readonly inverse: ReplayDelta }[] = [];
  let applied = 0;
  let undone = 0;
  let redone = 0;

  for (const item of entries) {
    if (isLogManagement(item.intent)) {
      issues.push(`ordinal ${String(item.ordinal)} is ${item.intent} — its folded actions are not individually replayable`);
      continue;
    }
    if (item.intent === "history.undo") {
      const gesture = undoStack.pop();
      if (gesture === undefined) {
        issues.push(`ordinal ${String(item.ordinal)} records an undo with nothing to undo`);
        continue;
      }
      objects = applyDelta(objects, gesture.inverse, item.ordinal, issues);
      redoStack.push(gesture);
      undone += 1;
      continue;
    }
    if (item.intent === "history.redo") {
      const gesture = redoStack.pop();
      if (gesture === undefined) {
        issues.push(`ordinal ${String(item.ordinal)} records a redo with nothing to redo`);
        continue;
      }
      objects = applyDelta(objects, gesture.payload, item.ordinal, issues);
      undoStack.push(gesture);
      redone += 1;
      continue;
    }
    if (!item.intent.startsWith("object.")) {
      skipped.set(item.intent, (skipped.get(item.intent) ?? 0) + 1);
      continue;
    }

    const payload = ReplayDeltaSchema.safeParse(item.payload);
    const inverse = ReplayDeltaSchema.safeParse(item.inverse);
    if (!payload.success || !inverse.success) {
      issues.push(`ordinal ${String(item.ordinal)} carries a delta this replayer cannot parse`);
      continue;
    }
    objects = applyDelta(objects, payload.data, item.ordinal, issues);
    undoStack.push({ payload: payload.data, inverse: inverse.data });
    redoStack.length = 0; // a new gesture clears redo — the editor's semantics
    applied += 1;
  }

  return {
    objects,
    applied,
    undone,
    redone,
    skipped: [...skipped.entries()].map(([intent, count]) => ({ intent, count })),
    issues,
  };
}
