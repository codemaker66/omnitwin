import { useCallback, useState } from "react";

// CARD A2: accumulates captured-chunk arrivals AND permanent failures for the
// resolve choreography. Dedupes by URL; on a chunk-list key change it retains
// entries for chunks that still exist in the new list (a still-mounted chunk
// never re-fires its callbacks, so wiping it would wedge the phase machine)
// and drops the rest. A replacement renderer must draw every source again.
// Kept as a plain hook so the semantics are unit-testable.

export interface ChunkArrivals {
  readonly loadedCount: number;
  readonly failedCount: number;
  readonly loadedUrls: ReadonlySet<string>;
  readonly failedUrls: ReadonlySet<string>;
  /** Stable within a renderer generation; receives actual source draws. */
  readonly markLoaded: (url: string) => void;
  /** Stable within a renderer generation; a source that failed to load or draw. */
  readonly markFailed: (url: string) => void;
}

interface ChunkArrivalState {
  readonly key: string;
  readonly generation: number;
  readonly loaded: ReadonlySet<string>;
  readonly failed: ReadonlySet<string>;
}

/** The reset key is the joined chunk-URL list; splitting it recovers the
 *  membership test for retention. */
function retained(previous: ReadonlySet<string>, nextKey: string): ReadonlySet<string> {
  const nextUrls = new Set(nextKey.split("|").filter((url) => url.length > 0));
  return new Set([...previous].filter((url) => nextUrls.has(url)));
}

export function useChunkArrivals(resetKey: string, generation = 0): ChunkArrivals {
  const [state, setState] = useState<ChunkArrivalState>({
    key: resetKey,
    generation,
    loaded: new Set(),
    failed: new Set(),
  });

  // React-sanctioned render-time reset (no stale-count commit).
  const sameGeneration = state.generation === generation;
  if (state.key !== resetKey || !sameGeneration) {
    setState({
      key: resetKey,
      generation,
      loaded: sameGeneration ? retained(state.loaded, resetKey) : new Set(),
      failed: sameGeneration ? retained(state.failed, resetKey) : new Set(),
    });
  }

  const markLoaded = useCallback((url: string) => {
    setState((previous) => {
      if (previous.generation !== generation || !previous.key.split("|").includes(url) || previous.loaded.has(url)) return previous;
      const loaded = new Set(previous.loaded);
      loaded.add(url);
      const failed = new Set(previous.failed);
      failed.delete(url);
      return { key: previous.key, generation, loaded, failed };
    });
  }, [generation]);

  const markFailed = useCallback((url: string) => {
    setState((previous) => {
      if (previous.generation !== generation || !previous.key.split("|").includes(url) || previous.failed.has(url) || previous.loaded.has(url)) return previous;
      const failed = new Set(previous.failed);
      failed.add(url);
      return { key: previous.key, generation, loaded: previous.loaded, failed };
    });
  }, [generation]);

  const isCurrent = state.key === resetKey;
  const loadedUrls = !sameGeneration ? new Set<string>() : isCurrent ? state.loaded : retained(state.loaded, resetKey);
  const failedUrls = !sameGeneration ? new Set<string>() : isCurrent ? state.failed : retained(state.failed, resetKey);
  return {
    loadedCount: loadedUrls.size,
    failedCount: failedUrls.size,
    loadedUrls,
    failedUrls,
    markLoaded,
    markFailed,
  };
}
