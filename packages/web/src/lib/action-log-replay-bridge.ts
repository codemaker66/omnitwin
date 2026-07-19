import { getActionLog, type AuditLogEntry } from "../api/action-log.js";
import { replayActions, type ReplayResult } from "./action-log-replay.js";
import { useEditorStore } from "../stores/editor-store.js";

// ---------------------------------------------------------------------------
// action-log-replay-bridge — G4 Slice 4's session-replay dev tool.
//
// DEV-only console bridge (the __venPerf pattern): `window.__venReplay()`
// fetches the open configuration's full audit trail, replays it through
// the tested engine, and diffs the reconstruction against the LIVE editor
// objects by id. The report is returned AND tabled to the console — this
// is a diagnostic mirror, not a mutation: nothing it computes ever writes
// back into the document.
// ---------------------------------------------------------------------------

const PAGE_LIMIT = 100;
const MAX_PAGES = 50;

export interface ReplayBridgeReport {
  readonly configId: string;
  readonly replay: ReplayResult;
  /** Honesty flags: a config switch mid-paging (the live diff would compare
   *  the wrong documents) or a trail longer than the page budget (the
   *  reconstruction is a prefix, not the full session). */
  readonly caveats: readonly string[];
  readonly comparison: {
    readonly liveCount: number;
    readonly replayCount: number;
    readonly matching: number;
    /** Ids the replay reconstructs that the live document lacks. */
    readonly missingFromLive: readonly string[];
    /** Ids live holds that the replay never saw (e.g. unsaved edits). */
    readonly extraInLive: readonly string[];
  };
}

declare global {
  interface Window {
    __venReplay?: (configId?: string) => Promise<ReplayBridgeReport | null>;
  }
}

async function runReplay(configId?: string): Promise<ReplayBridgeReport | null> {
  const target = configId ?? useEditorStore.getState().configId;
  if (target === null) {
    // eslint-disable-next-line no-console -- dev-only console bridge
    console.warn("__venReplay: no configuration open");
    return null;
  }

  const entries: AuditLogEntry[] = [];
  let after = 0;
  let sawShortPage = false;
  for (let page = 0; page < MAX_PAGES; page += 1) {
    const result = await getActionLog(target, after, PAGE_LIMIT);
    entries.push(...result.entries);
    if (result.entries.length < PAGE_LIMIT) {
      sawShortPage = true;
      break;
    }
    after = result.nextAfter;
  }

  const caveats: string[] = [];
  if (!sawShortPage) {
    caveats.push(
      `trail truncated at ${String(entries.length)} entries (page budget) — the reconstruction is a prefix, not the full session`,
    );
  }
  const liveConfigNow = useEditorStore.getState().configId;
  if (liveConfigNow !== target) {
    caveats.push(
      `configuration switched to ${liveConfigNow ?? "none"} while paging ${target} — the live comparison below diffs the WRONG document`,
    );
  }

  const replay = replayActions(entries);
  const liveIds = new Set(useEditorStore.getState().objects.map((object) => object.id));
  const replayIds = new Set(replay.objects.map((object) => object.id));
  const report: ReplayBridgeReport = {
    configId: target,
    replay,
    caveats,
    comparison: {
      liveCount: liveIds.size,
      replayCount: replayIds.size,
      matching: [...replayIds].filter((id) => liveIds.has(id)).length,
      missingFromLive: [...replayIds].filter((id) => !liveIds.has(id)),
      extraInLive: [...liveIds].filter((id) => !replayIds.has(id)),
    },
  };

  // eslint-disable-next-line no-console -- dev-only console bridge output
  console.table({
    applied: report.replay.applied,
    undone: report.replay.undone,
    redone: report.replay.redone,
    issues: report.replay.issues.length,
    matching: report.comparison.matching,
    missingFromLive: report.comparison.missingFromLive.length,
    extraInLive: report.comparison.extraInLive.length,
    caveats: report.caveats.length,
  });
  for (const caveat of report.caveats) {
    // eslint-disable-next-line no-console -- dev-only console bridge output
    console.warn("__venReplay:", caveat);
  }
  return report;
}

/** Attach the bridge; returns the cleanup. Callers gate on DEV. */
export function registerReplayBridge(): () => void {
  window.__venReplay = runReplay;
  return () => {
    delete window.__venReplay;
  };
}
