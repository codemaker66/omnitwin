import { useEffect } from "react";
import { twinEquirectPath, type TwinEquirectLod } from "@omnitwin/types";

/** Prefetch warms the 4096 BASE tier only — the 8192 zoom tier is strictly
 *  on-demand (zoom intent on the current node), never speculative traffic. */
const PREFETCH_LOD: TwinEquirectLod = 4096;

/**
 * Cache-warm the base-resolution panos of the current node's graph
 * neighbours so travel starts from the HTTP cache instead of the network —
 * the difference between a hop that sharpens instantly and one that sits on
 * its 512 preview while 4096×2048 crosses the wire.
 *
 * Fire-and-forget fetches, aborted on node change/unmount; the bytes are
 * drained so the browser commits them to cache, but no decode happens here
 * (useEquirectTexture does that off-thread on arrival). No-ops quietly where
 * fetch is unavailable (happy-dom tests).
 */
export function useTwinPrefetch(neighborIds: readonly string[], base: string): void {
  useEffect(() => {
    if (typeof fetch !== "function" || neighborIds.length === 0) {
      return;
    }
    const controller = new AbortController();
    for (const id of neighborIds) {
      void fetch(`${base}/${twinEquirectPath(id, PREFETCH_LOD)}`, {
        signal: controller.signal,
        priority: "low",
      } as RequestInit)
        .then((response) => (response.ok ? response.blob() : null))
        .catch(() => null);
    }
    return () => {
      controller.abort();
    };
  }, [neighborIds, base]);
}
