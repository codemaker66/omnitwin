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
