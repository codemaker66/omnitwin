import { useEffect, useMemo, useState } from "react";
import { useDeviceStore } from "../stores/device-store.js";
import { classifyDeviceInContext, currentDeviceContext, getGpuRenderer, type DeviceTier } from "../lib/device-tier.js";
import {
  resolveSplatRuntimeProfile,
  type SplatRuntimeProfile,
} from "../lib/splat-runtime-profile.js";

// ---------------------------------------------------------------------------
// The splat runtime profile for the device this page is running on.
//
// The device store is a fine place for the tier to live, but nothing on the
// walk route ever called `detect`, so every visitor was "low" and every knob
// keyed on the tier would have been wrong for all of them. This hook closes
// that gap without a flash of the wrong tier: it probes the GPU during the
// FIRST render (a throwaway context, released at once), classifies locally,
// and only then records the result in the store for everyone else. A store
// that has already detected is trusted and never probed again.
//
// Overrides from the query string and the `window` publication are DEV-only
// by default; both exist for scripts/splat-drag-budget.mjs.
// ---------------------------------------------------------------------------

declare global {
  interface Window {
    /** DEV only: the runtime profile the mounted splat scene is using. */
    __splatRuntimeProfile?: SplatRuntimeProfile;
  }
}

export interface UseSplatRuntimeProfileOptions {
  /** Reads the GPU renderer string; defaults to a throwaway WebGL context. */
  readonly probe?: () => string | null;
  /** The query string to read overrides from; defaults to the page's own. */
  readonly search?: string;
  /** Whether the query string may change the profile; defaults to DEV. */
  readonly allowOverrides?: boolean;
  /** Whether to publish the profile on `window`; defaults to DEV. */
  readonly publish?: boolean;
}

/**
 * Reads the GPU renderer string through a context that exists only for the
 * read, then releases it so the real canvas is not competing with a ghost.
 */
export function probeGpuRenderer(): string | null {
  if (typeof document === "undefined") return null;
  const canvas = document.createElement("canvas");
  const gl = canvas.getContext("webgl2", { powerPreference: "high-performance" })
    ?? canvas.getContext("webgl", { powerPreference: "high-performance" });
  if (gl === null) return null;
  try {
    return getGpuRenderer(gl);
  } finally {
    gl.getExtension("WEBGL_lose_context")?.loseContext();
  }
}

/**
 * Probed exactly once, during the first render (a throwaway context, released
 * at once), so the first frame already reflects the right tier instead of
 * re-creating the renderer a frame later. A store that has already detected
 * is trusted and never probed again. Shared by `useAssetDeviceTier` and
 * `useSplatRuntimeProfile` so a component tree using both (the walk route's
 * captured room and its stage floor) probes the GPU once, not twice.
 */
function useProbedDeviceTier(probe: () => string | null): { readonly tier: DeviceTier; readonly probed: string | null } {
  const storeTier = useDeviceStore((state) => state.tier);
  const detected = useDeviceStore((state) => state.detected);
  const [probed] = useState<string | null>(() => (detected ? null : probe()));
  const tier: DeviceTier = detected || probed === null ? storeTier : classifyDeviceInContext(probed, currentDeviceContext());
  return { tier, probed };
}

/**
 * The device tier for asset-quality decisions made outside the splat runtime
 * profile (T-639: the stage floor's texture resolution on `/plan`, which
 * never mounts `useSplatRuntimeProfile` — that would also change the
 * planner's other quality settings). Reads the store's tier once it has
 * detected; otherwise classifies its own probe. Never writes the store or
 * publishes to `window`: `useSplatRuntimeProfile` owns that, so only one
 * caller across the page ever records a detection.
 */
export function useAssetDeviceTier(probe: () => string | null = probeGpuRenderer): DeviceTier {
  return useProbedDeviceTier(probe).tier;
}

export function useSplatRuntimeProfile(
  options: UseSplatRuntimeProfileOptions = {},
): SplatRuntimeProfile {
  const {
    probe = probeGpuRenderer,
    search = typeof window === "undefined" ? "" : window.location.search,
    allowOverrides = import.meta.env.DEV,
    publish = import.meta.env.DEV,
  } = options;

  const detected = useDeviceStore((state) => state.detected);
  const detect = useDeviceStore((state) => state.detect);
  const { tier, probed } = useProbedDeviceTier(probe);

  useEffect(() => {
    if (!detected && probed !== null) detect(probed);
  }, [detect, detected, probed]);

  const profile = useMemo(
    () => resolveSplatRuntimeProfile(tier, search, allowOverrides),
    [tier, search, allowOverrides],
  );

  useEffect(() => {
    if (!publish) return;
    window.__splatRuntimeProfile = profile;
    return () => {
      if (window.__splatRuntimeProfile === profile) delete window.__splatRuntimeProfile;
    };
  }, [profile, publish]);

  return profile;
}
