import type { LaunchOptions } from "@playwright/test";

// Native GL capture readback was verified on both software llvmpipe and RTX.
// Select that backend without changing image quality, workload or thresholds.
export const captureLaunchOptions = {
  args: [
    "--use-gl=angle",
    "--use-angle=gl",
    "--enable-unsafe-swiftshader",
    "--ignore-gpu-blocklist",
  ],
} satisfies LaunchOptions;
