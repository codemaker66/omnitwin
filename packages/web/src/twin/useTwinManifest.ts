import { useCallback, useEffect, useState } from "react";
import { TwinManifestSchema, type TwinManifest } from "@omnitwin/types";

// -----------------------------------------------------------------------------
// useTwinManifest — loads and validates the twin/0 bundle manifest for a venue.
//
// The asset base is swappable (VITE_TWIN_ASSET_BASE) so production can serve
// bundles from R2 while local dev reads packages/web/public/twin. A manifest
// that fails TwinManifestSchema validation is treated exactly like a network
// failure — the page shows its calm error state; bad data never crashes it.
//
// Plan: docs/superpowers/plans/2026-07-02-twin-phase1-walk.md (Task 6).
// -----------------------------------------------------------------------------

export type TwinManifestState =
  | { readonly state: "loading" }
  | { readonly state: "error"; readonly retry: () => void }
  | { readonly state: "ready"; readonly manifest: TwinManifest };

/** True when no VITE_TWIN_ASSET_BASE override is configured (Task 12 posture). */
export function isDefaultTwinAssetBase(): boolean {
  return import.meta.env["VITE_TWIN_ASSET_BASE"] === undefined;
}

/** Base URL twin bundles are served from; defaults to the local public dir. */
export function twinAssetBase(): string {
  return import.meta.env["VITE_TWIN_ASSET_BASE"] ?? "/twin";
}

export function useTwinManifest(venueSlug: string): TwinManifestState {
  const [attempt, setAttempt] = useState(0);
  const [status, setStatus] = useState<TwinManifestState>({ state: "loading" });

  const retry = useCallback(() => {
    setAttempt((current) => current + 1);
  }, []);

  useEffect(() => {
    let cancelled = false;
    // Abort the superseded request itself (venue change, retry mash) — the
    // cancelled flag alone kept state correct but let stale fetches run to
    // completion in the network layer.
    const controller = new AbortController();
    setStatus({ state: "loading" });

    const load = async (): Promise<void> => {
      try {
        const response = await fetch(`${twinAssetBase()}/${venueSlug}/manifest.json`, {
          signal: controller.signal,
        });
        if (!response.ok) {
          throw new Error(`twin manifest request failed: ${String(response.status)}`);
        }
        const body: unknown = await response.json();
        const parsed = TwinManifestSchema.safeParse(body);
        if (cancelled) {
          return;
        }
        setStatus(
          parsed.success
            ? { state: "ready", manifest: parsed.data }
            : { state: "error", retry },
        );
      } catch {
        if (!cancelled) {
          setStatus({ state: "error", retry });
        }
      }
    };

    void load();
    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [venueSlug, attempt, retry]);

  return status;
}
