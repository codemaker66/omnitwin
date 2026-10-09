// ---------------------------------------------------------------------------
// How much of the hall's finish a device carries
//
// Computers and tablets get everything. Phones take the half-size
// photographs: a quarter of the download and of the texture memory. A
// software rasteriser (a virtual machine, a headless browser) takes them too,
// and leaves out the reflection map and the chandeliers' lights, whose large
// shaders it would compile and run on the CPU: a soft fill lights the
// furniture instead. Read from the user agent and from the canvas's own
// context; no probe context is created.
// ---------------------------------------------------------------------------

import { useMemo } from "react";
import { useThree } from "@react-three/fiber";
import { classifyDevice, currentDeviceContext, deviceFormFactor, type DeviceFormFactor } from "../../lib/device-tier.js";
import { getNativeRenderer, nativeRendererGpuString } from "../../lib/native-renderer.js";

export interface HallFinish {
  /** Photograph resolution: 1 for the full set, 0.5 for the half-size set. */
  readonly photoQuality: number;
  /** The reflection environment and the chandeliers' own lights; otherwise a soft fill. */
  readonly liveLight: boolean;
}

export const FULL_HALL_FINISH: HallFinish = { photoQuality: 1, liveLight: true };

/** Whether a GPU renderer string names a software rasteriser. */
export function isSoftwareRenderer(gpu: string | null): boolean {
  return gpu !== null && gpu.trim() !== "" && classifyDevice(gpu) === "poster";
}

export function hallFinish(formFactor: DeviceFormFactor, software: boolean): HallFinish {
  if (software) return { photoQuality: 0.5, liveLight: false };
  if (formFactor === "phone") return { photoQuality: 0.5, liveLight: true };
  return FULL_HALL_FINISH;
}

/** The finish for the device this canvas runs on. */
export function useHallFinish(): HallFinish {
  const gl = useThree((state) => state.gl);
  return useMemo(() => {
    const renderer = getNativeRenderer(gl);
    const gpu = renderer === null ? null : nativeRendererGpuString(renderer);
    return hallFinish(deviceFormFactor(currentDeviceContext()), isSoftwareRenderer(gpu));
  }, [gl]);
}
