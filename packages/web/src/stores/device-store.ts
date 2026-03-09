import { create } from "zustand";
import {
  classifyDevice,
  getQualitySettings,
  type DeviceTier,
  type QualitySettings,
} from "../lib/device-tier.js";

// ---------------------------------------------------------------------------
// Store interface
// ---------------------------------------------------------------------------

export interface DeviceState {
  /** Current detected device tier. */
  readonly tier: DeviceTier;
  /** Quality settings derived from the tier. */
  readonly quality: QualitySettings;
  /** Raw GPU renderer string, or null if unavailable. */
  readonly gpuRenderer: string | null;
  /** Whether detection has been performed. */
  readonly detected: boolean;
  /** Detect tier from a GPU renderer string. */
  readonly detect: (rendererString: string) => void;
  /** Manually override the tier (e.g. from user settings). */
  readonly override: (tier: DeviceTier) => void;
}

// ---------------------------------------------------------------------------
// Store
// ---------------------------------------------------------------------------

/**
 * Device capability store. Defaults to "low" tier until detection runs.
 * Safe default — avoids crashing on poster-tier devices while not
 * wasting resources at high settings on initial load.
 */
export const useDeviceStore = create<DeviceState>()((set) => ({
  tier: "low",
  quality: getQualitySettings("low"),
  gpuRenderer: null,
  detected: false,

  detect: (rendererString: string) => {
    const tier = classifyDevice(rendererString);
    set({
      tier,
      quality: getQualitySettings(tier),
      gpuRenderer: rendererString,
      detected: true,
    });
  },

  override: (tier: DeviceTier) => {
    set({
      tier,
      quality: getQualitySettings(tier),
      detected: true,
    });
  },
}));
