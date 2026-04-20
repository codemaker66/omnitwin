import { useEffect, useState } from "react";
import type { HallkeeperSheetV2 } from "@omnitwin/types";
import { API_URL } from "../config/env.js";
import { getAuthToken } from "../api/client.js";
import { openCache } from "../lib/idb-cache.js";

// ---------------------------------------------------------------------------
// useHallkeeperSheet — stale-while-revalidate fetch for /v2
//
// On mount, the tablet is typically in one of four states:
//   1. Online, first visit           → cache miss, network hit, cache write.
//   2. Online, returning visit       → cache hit, show instantly, network
//                                      revalidates in background.
//   3. Offline, returning visit      → cache hit, show from cache, mark
//                                      `source: "cache"` so the UI can
//                                      render an "offline — cached" badge.
//   4. Offline, first visit          → `{ data: null, source: "error" }`.
//
// Cache is keyed by configId so each event's payload lives in its own
// IDB entry; switching between configs doesn't invalidate others.
// Entries never expire inside this hook — operational data is always
// shown when that's all we have.
//
// The hook intentionally does NOT poll. The hallkeeper tablet is
// consulted, not monitored — once the sheet is loaded for the day,
// only explicit user actions cause re-fetches.
// ---------------------------------------------------------------------------

const CACHE = openCache<HallkeeperSheetV2>({
  dbName: "omnitwin-hallkeeper",
  storeName: "sheet-cache",
});

export type SheetSource = "loading" | "network" | "cache" | "error";

export interface UseHallkeeperSheetResult {
  readonly data: HallkeeperSheetV2 | null;
  readonly source: SheetSource;
  /** ISO-8601 timestamp of the cached payload (when `source === "cache"`). */
  readonly cachedAt: string | null;
  /** Programmatic refresh. Clears loading state, retries the network. */
  readonly refetch: () => void;
}

async function fetchSheet(configId: string): Promise<HallkeeperSheetV2> {
  const token = await getAuthToken();
  const headers: Record<string, string> = {};
  if (token !== null) headers["Authorization"] = `Bearer ${token}`;
  const res = await fetch(`${API_URL}/hallkeeper/${configId}/v2`, { headers });
  if (!res.ok) {
    throw new Error(`sheet fetch failed: ${String(res.status)}`);
  }
  const json = (await res.json()) as { data: HallkeeperSheetV2 };
  return json.data;
}

export function useHallkeeperSheet(configId: string | null): UseHallkeeperSheetResult {
  const [data, setData] = useState<HallkeeperSheetV2 | null>(null);
  const [source, setSource] = useState<SheetSource>("loading");
  const [cachedAt, setCachedAt] = useState<string | null>(null);
  const [refetchTick, setRefetchTick] = useState(0);

  useEffect(() => {
    if (configId === null) {
      setData(null);
      setSource("loading");
      return;
    }

    let cancelled: boolean = false;
    // The cancelled-mutation pattern used inside useEffect cleanups
    // fools TypeScript's narrowing: reading `cancelled` after an
    // `await` is a legitimate check, but the type-system still sees
    // `false` as the only possible value. Shared elsewhere in web/src.

    void (async () => {
      // STEP 1: cache probe — show instantly if present.
      try {
        const cached = await CACHE.get(configId);
        // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- mutated by cleanup
        if (!cancelled && cached !== null) {
          setData(cached.value);
          setCachedAt(cached.storedAt);
          // Flip to "cache" while the network revalidates in the
          // background. If revalidation succeeds, we advance to
          // "network". If it fails, we stay on "cache".
          setSource("cache");
        }
      } catch {
        // IDB unavailable — silent; network fetch is still the
        // authoritative path.
      }

      // STEP 2: network revalidation.
      try {
        const fresh = await fetchSheet(configId);
        // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- mutated by cleanup
        if (cancelled) return;
        setData(fresh);
        setSource("network");
        setCachedAt(new Date().toISOString());
        // Fire-and-forget cache write. A failed cache write should
        // not degrade UX — the user already has the data.
        void CACHE.put(configId, fresh).catch(() => {
          /* swallow */
        });
      } catch {
        // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- mutated by cleanup
        if (cancelled) return;
        // Only flip to "error" if we have nothing to show. If the
        // cache probe succeeded, keep `source: "cache"` so the UI
        // renders offline-grade content.
        setSource((prev) => (prev === "cache" ? "cache" : "error"));
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [configId, refetchTick]);

  return {
    data,
    source,
    cachedAt,
    refetch: () => {
      setRefetchTick((t) => t + 1);
    },
  };
}
