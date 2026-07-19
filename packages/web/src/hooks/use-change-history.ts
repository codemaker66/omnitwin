import { useCallback, useEffect, useRef, useState } from "react";
import { getActionLog, type AuditLogEntry } from "../api/action-log.js";

// ---------------------------------------------------------------------------
// useChangeHistory — G4 Slice 4. Pages the config's audit trail (oldest
// first, the server's ordinal order) and accumulates entries for the
// Evidence lens. A full page means more may exist (hasMore → Load more).
// Config switches mid-fetch are the programme's recurring race class: every
// continuation checks it still serves the config it started for.
// ---------------------------------------------------------------------------

const PAGE_LIMIT = 100;

export interface ChangeHistoryState {
  readonly entries: readonly AuditLogEntry[];
  readonly loading: boolean;
  readonly error: boolean;
  readonly hasMore: boolean;
  readonly loadMore: () => void;
}

export function useChangeHistory(configId: string | null, enabled: boolean): ChangeHistoryState {
  const [entries, setEntries] = useState<readonly AuditLogEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(false);
  const [hasMore, setHasMore] = useState(false);
  const cursorRef = useRef(0);
  const activeConfigRef = useRef<string | null>(null);
  // Continuations are guarded by GENERATION, not config identity (reviewer
  // CRITICAL): a config value can become active twice (A→B→A, an enabled
  // flip, a StrictMode remount), and an identity check would let a
  // doubly-stale response replace the accumulated trail and regress the
  // cursor. Every effect run — and its cleanup — advances the generation,
  // so exactly the newest run's requests may land.
  const generationRef = useRef(0);

  const fetchPage = useCallback((generation: number, forConfig: string, after: number, append: boolean) => {
    setLoading(true);
    setError(false);
    void getActionLog(forConfig, after, PAGE_LIMIT)
      .then((page) => {
        if (generationRef.current !== generation) return; // superseded run
        cursorRef.current = page.nextAfter;
        setEntries((previous) => (append ? [...previous, ...page.entries] : page.entries));
        setHasMore(page.entries.length === PAGE_LIMIT);
        setLoading(false);
      })
      .catch(() => {
        if (generationRef.current !== generation) return;
        setError(true);
        setLoading(false);
      });
  }, []);

  useEffect(() => {
    generationRef.current += 1;
    const generation = generationRef.current;
    activeConfigRef.current = enabled ? configId : null;
    cursorRef.current = 0;
    setEntries([]);
    setHasMore(false);
    setError(false);
    if (enabled && configId !== null) {
      fetchPage(generation, configId, 0, false);
    }
    return () => {
      generationRef.current += 1; // invalidate in-flight work on unmount too
    };
  }, [configId, enabled, fetchPage]);

  const loadMore = useCallback(() => {
    const forConfig = activeConfigRef.current;
    if (forConfig === null) return;
    fetchPage(generationRef.current, forConfig, cursorRef.current, true);
  }, [fetchPage]);

  return { entries, loading, error, hasMore, loadMore };
}
