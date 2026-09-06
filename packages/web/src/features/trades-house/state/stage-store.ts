// -----------------------------------------------------------------------------
// stage-store — the tier the stage runs at, and which scene is on it.
//
// The GPU class alone lies about phones: an iPhone reports "Apple GPU" and
// classifies high, then cooks under a 2x-DPR Lantern. So the effective tier
// is min(classified tier, phone cap), where the cap is "medium" for a
// coarse-pointer window narrower than 980 px, or a multi-touch device that
// reports at most 4 GB (Appendix A section 5). The pure function is the
// contract; the hook feeds it from the device store (probing the GPU once,
// the way use-splat-runtime-profile does) and from the window, and records
// the result here for the Lantern and the Hall gate. The tier is fixed for
// the mount: a rotation does not change a phone's memory or its GPU.
// -----------------------------------------------------------------------------
import { useEffect, useState } from "react";
import { create } from "zustand";
import { probeGpuRenderer } from "../../../hooks/use-splat-runtime-profile.js";
import { classifyDevice } from "../../../lib/device-tier.js";
import { useDeviceStore } from "../../../stores/device-store.js";
import type { DeviceTierName, StageTierInput } from "./run-types.js";

/** The most a phone-shaped device may run at. */
export const PHONE_CAP_TIER: DeviceTierName = "medium";
/** A coarse pointer below this width is a phone, not a tablet on a desk. */
export const PHONE_CAP_MAX_WIDTH_PX = 980;
/** A multi-touch device reporting this much memory or less is capped even when wide. */
export const PHONE_CAP_MAX_MEMORY_GB = 4;

const TIER_RANK: Readonly<Record<DeviceTierName, number>> = { poster: 0, low: 1, medium: 2, high: 3 };

export function minTier(a: DeviceTierName, b: DeviceTierName): DeviceTierName {
  return TIER_RANK[a] <= TIER_RANK[b] ? a : b;
}

/** The phone cap for these facts, or null when nothing about them says phone. */
export function phoneCap(input: Omit<StageTierInput, "classifiedTier">): DeviceTierName | null {
  const narrowTouch = input.coarsePointer && input.innerWidth < PHONE_CAP_MAX_WIDTH_PX;
  const smallMemoryTouch =
    input.maxTouchPoints > 1 &&
    input.deviceMemoryGb !== null &&
    input.deviceMemoryGb <= PHONE_CAP_MAX_MEMORY_GB;
  return narrowTouch || smallMemoryTouch ? PHONE_CAP_TIER : null;
}

/** Pure: min(classified tier, phone cap). */
export function effectiveTier(input: StageTierInput): DeviceTierName {
  const cap = phoneCap(input);
  return cap === null ? input.classifiedTier : minTier(input.classifiedTier, cap);
}

/** What the hook reads off `window`; a test hands in a literal. */
export interface StageWindow {
  readonly innerWidth: number;
  matchMedia?(query: string): { readonly matches: boolean };
}

/** What the hook reads off `navigator`; `deviceMemory` is absent on Safari and Firefox. */
export interface StageNavigator {
  readonly maxTouchPoints: number;
  readonly deviceMemory?: number;
}

export function readStageTierInput(
  classifiedTier: DeviceTierName,
  win: StageWindow,
  nav: StageNavigator,
): StageTierInput {
  return {
    classifiedTier,
    coarsePointer: win.matchMedia?.("(pointer: coarse)").matches ?? false,
    innerWidth: win.innerWidth,
    maxTouchPoints: nav.maxTouchPoints,
    deviceMemoryGb: typeof nav.deviceMemory === "number" ? nav.deviceMemory : null,
  };
}

export interface StageStore {
  /** 0 to 11 the twelve scenes; 12 the threshold. */
  readonly sceneIndex: number;
  /** The tier the stage runs at. "low" until useEffectiveTier has resolved it. */
  readonly effectiveTier: DeviceTierName;
  readonly tierResolved: boolean;
  readonly setSceneIndex: (sceneIndex: number) => void;
  readonly setEffectiveTier: (tier: DeviceTierName) => void;
}

export const useStageStore = create<StageStore>()((set) => ({
  sceneIndex: 0,
  effectiveTier: "low",
  tierResolved: false,
  setSceneIndex: (sceneIndex) => {
    set({ sceneIndex });
  },
  setEffectiveTier: (tier) => {
    set({ effectiveTier: tier, tierResolved: true });
  },
}));

export interface UseEffectiveTierOptions {
  /** Reads the GPU renderer string; defaults to a throwaway WebGL context. */
  readonly probe?: () => string | null;
  /** Defaults to `window`; null when there is none. */
  readonly win?: StageWindow | null;
  /** Defaults to `navigator`; null when there is none. */
  readonly nav?: StageNavigator | null;
}

const NO_WINDOW_FACTS: Omit<StageTierInput, "classifiedTier"> = {
  coarsePointer: false,
  innerWidth: 0,
  maxTouchPoints: 0,
  deviceMemoryGb: null,
};

function defaultWindow(): StageWindow | null {
  return typeof window === "undefined" ? null : window;
}

function defaultNavigator(): StageNavigator | null {
  return typeof navigator === "undefined" ? null : navigator;
}

/**
 * The effective tier for this mount. Right on the first render (the probe
 * runs during it, so the first frame already runs at the right tier), and
 * recorded in the stage store after the first commit for components that
 * mount later; pass the returned value down to anything mounting in the same
 * frame. A device store that has already detected is trusted, never re-probed.
 */
export function useEffectiveTier(options: UseEffectiveTierOptions = {}): DeviceTierName {
  const { probe = probeGpuRenderer, win = defaultWindow(), nav = defaultNavigator() } = options;
  const storeTier = useDeviceStore((state) => state.tier);
  const detected = useDeviceStore((state) => state.detected);
  const detect = useDeviceStore((state) => state.detect);
  const setEffectiveTier = useStageStore((state) => state.setEffectiveTier);

  const [probed] = useState<string | null>(() => (detected ? null : probe()));
  const classified: DeviceTierName =
    detected || probed === null ? storeTier : classifyDevice(probed);

  // The window's facts are read once: the tier is fixed for the mount.
  const [facts] = useState<Omit<StageTierInput, "classifiedTier">>(() =>
    win === null || nav === null
      ? NO_WINDOW_FACTS
      : readStageTierInput(classified, win, nav),
  );

  useEffect(() => {
    if (!detected && probed !== null) detect(probed);
  }, [detect, detected, probed]);

  const tier = effectiveTier({ ...facts, classifiedTier: classified });

  useEffect(() => {
    setEffectiveTier(tier);
  }, [setEffectiveTier, tier]);

  return tier;
}
