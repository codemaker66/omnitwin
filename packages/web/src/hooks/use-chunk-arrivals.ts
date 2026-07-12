import { useCallback, useState } from "react";

// CARD A2: accumulates captured-chunk arrivals AND permanent failures for the
// resolve choreography. Dedupes by URL; on a chunk-list key change it retains
// entries for chunks that still exist in the new list (a still-mounted chunk
// never re-fires its callbacks, so wiping it would wedge the phase machine)
// and drops the rest. Kept as a plain hook so the semantics are unit-testable.

export interface ChunkArrivals {
  readonly loadedCount: number;
  readonly failedCount: number;
  /** Identity-stable — safe to hand to Spark load callbacks. */
  readonly markLoaded: (url: string) => void;
  /** Identity-stable — a chunk whose decode failed permanently. */
  readonly markFailed: (url: string) => void;
}

interface ChunkArrivalState {
  readonly key: string;
  readonly loaded: ReadonlySet<string>;
  readonly failed: ReadonlySet<string>;
}

/** The reset key is the joined chunk-URL list; splitting it recovers the
 *  membership test for retention. */
function retained(previous: ReadonlySet<string>, nextKey: string): ReadonlySet<string> {
  const nextUrls = new Set(nextKey.split("|").filter((url) => url.length > 0));
  return new Set([...previous].filter((url) => nextUrls.has(url)));
}

export function useChunkArrivals(resetKey: string): ChunkArrivals {
  const [state, setState] = useState<ChunkArrivalState>({
    key: resetKey,
    loaded: new Set(),
    failed: new Set(),
  });

  // React-sanctioned render-time reset (no stale-count commit).
  if (state.key !== resetKey) {
    setState({
      key: resetKey,
      loaded: retained(state.loaded, resetKey),
      failed: retained(state.failed, resetKey),
    });
  }

  const markLoaded = useCallback((url: string) => {
    setState((previous) => {
      if (previous.loaded.has(url)) return previous;
      const loaded = new Set(previous.loaded);
      loaded.add(url);
      return { key: previous.key, loaded, failed: previous.failed };
    });
  }, []);

  const markFailed = useCallback((url: string) => {
    setState((previous) => {
      if (previous.failed.has(url) || previous.loaded.has(url)) return previous;
      const failed = new Set(previous.failed);
      failed.add(url);
      return { key: previous.key, loaded: previous.loaded, failed };
    });
  }, []);

  const isCurrent = state.key === resetKey;
  return {
    loadedCount: isCurrent ? state.loaded.size : retained(state.loaded, resetKey).size,
    failedCount: isCurrent ? state.failed.size : retained(state.failed, resetKey).size,
    markLoaded,
    markFailed,
  };
}
