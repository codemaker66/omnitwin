import { useEffect } from "react";
import { TWIN_EQUIRECT_LODS, twinEquirectPath } from "@omnitwin/types";

/**
 * Cache-warm the FULL-resolution panos of the current node's graph
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
    const fullLod = TWIN_EQUIRECT_LODS[1];
    for (const id of neighborIds) {
      void fetch(`${base}/${twinEquirectPath(id, fullLod)}`, {
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
