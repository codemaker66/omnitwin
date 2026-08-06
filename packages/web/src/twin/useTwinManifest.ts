import { useCallback, useEffect, useState } from "react";
import {
  ReconstructionReleasePublicActiveDescriptorSchema,
  TwinManifestSchema,
  type ReconstructionReleasePublicActiveDescriptor,
  type TwinManifest,
} from "@omnitwin/types";
import { API_URL } from "../config/env.js";

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
  | {
      readonly state: "ready";
      readonly manifest: TwinManifest;
      readonly assetBase: string;
      readonly release: ReconstructionReleasePublicActiveDescriptor | null;
    };

/** True when no VITE_TWIN_ASSET_BASE override is configured (Task 12 posture). */
export function isDefaultTwinAssetBase(): boolean {
  return import.meta.env["VITE_TWIN_ASSET_BASE"] === undefined;
}

/** Base URL twin bundles are served from; defaults to the local public dir. */
export function twinAssetBase(): string {
  return import.meta.env["VITE_TWIN_ASSET_BASE"] ?? "/twin";
}

function bytesToSha256Hex(bytes: ArrayBuffer): Promise<string> {
  return globalThis.crypto.subtle.digest("SHA-256", bytes).then((digest) =>
    [...new Uint8Array(digest)]
      .map((byte) => byte.toString(16).padStart(2, "0"))
      .join(""),
  );
}

function activeReleaseUrl(venueSlug: string): string {
  const query = new URLSearchParams({
    venueSlug,
    releaseKind: "venue_twin_v1",
  });
  return `${API_URL}/assets/reconstruction-releases/active?${query.toString()}`;
}

async function loadLegacyManifest(
  venueSlug: string,
  signal: AbortSignal,
): Promise<{ manifest: TwinManifest; assetBase: string }> {
  const response = await fetch(`${twinAssetBase()}/${venueSlug}/manifest.json`, { signal });
  if (!response.ok) {
    throw new Error(`twin manifest request failed: ${String(response.status)}`);
  }
  const body: unknown = await response.json();
  const manifest = TwinManifestSchema.parse(body);
  if (manifest.venueSlug !== venueSlug) {
    throw new Error("twin manifest venue does not match the requested venue");
  }
  return { manifest, assetBase: `${twinAssetBase()}/${venueSlug}` };
}

async function loadFoundryManifest(
  descriptor: ReconstructionReleasePublicActiveDescriptor,
  venueSlug: string,
  signal: AbortSignal,
): Promise<TwinManifest> {
  const response = await fetch(descriptor.manifestUrl, { signal, cache: "no-store" });
  if (!response.ok) {
    throw new Error(`Foundry manifest request failed: ${String(response.status)}`);
  }
  const bytes = await response.arrayBuffer();
  const actualSha256 = await bytesToSha256Hex(bytes);
  if (actualSha256 !== descriptor.manifestSha256) {
    throw new Error("Foundry manifest digest verification failed");
  }
  const body: unknown = JSON.parse(new TextDecoder().decode(bytes));
  const manifest = TwinManifestSchema.parse(body);
  if (manifest.venueSlug !== venueSlug) {
    throw new Error("Foundry manifest venue does not match the requested venue");
  }
  return manifest;
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
        let descriptorResponse: Response;
        try {
          descriptorResponse = await fetch(activeReleaseUrl(venueSlug), {
            signal: controller.signal,
            cache: "no-store",
          });
        } catch (error) {
          // An unreachable API (connection refused, DNS, offline) must not
          // kill a twin whose bundle is entirely local — treat it exactly
          // like the 404 "no active release" answer and fall back. Aborts
          // still propagate: the effect is being torn down.
          if (controller.signal.aborted) {
            throw error;
          }
          const legacy = await loadLegacyManifest(venueSlug, controller.signal);
          if (!cancelled) {
            setStatus({ state: "ready", ...legacy, release: null });
          }
          return;
        }

        if (descriptorResponse.status === 404) {
          const legacy = await loadLegacyManifest(venueSlug, controller.signal);
          if (!cancelled) {
            setStatus({ state: "ready", ...legacy, release: null });
          }
          return;
        }
        if (!descriptorResponse.ok) {
          throw new Error(`Foundry release resolution failed: ${String(descriptorResponse.status)}`);
        }
        const envelope: unknown = await descriptorResponse.json();
        const rawDescriptor = typeof envelope === "object" && envelope !== null && "data" in envelope
          ? (envelope as { readonly data: unknown }).data
          : envelope;
        if (rawDescriptor === null) {
          const legacy = await loadLegacyManifest(venueSlug, controller.signal);
          if (!cancelled) {
            setStatus({ state: "ready", ...legacy, release: null });
          }
          return;
        }
        const descriptor = ReconstructionReleasePublicActiveDescriptorSchema.parse(rawDescriptor);
        if (descriptor.venueSlug !== venueSlug) {
          throw new Error("Foundry release descriptor venue does not match the request");
        }
        const manifest = await loadFoundryManifest(descriptor, venueSlug, controller.signal);
        if (cancelled) {
          return;
        }
        setStatus({
          state: "ready",
          manifest,
          assetBase: descriptor.assetBaseUrl.replace(/\/+$/u, ""),
          release: descriptor,
        });
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
