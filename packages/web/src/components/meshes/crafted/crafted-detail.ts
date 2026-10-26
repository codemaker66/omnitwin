import { classifyDevice, getGpuRenderer } from "../../../lib/device-tier.js";
import { readRenderDeviceContext, selectRenderProfile } from "../../../lib/render-quality.js";

// ---------------------------------------------------------------------------
// How finely crafted furniture is drawn on this device
//
// A hall seats hundreds of chairs, so a phone draws each piece with fewer
// segments round its turned and bent parts: the silhouette, the materials and
// the shadow casters stay the same, only the curvature is coarser. So does a
// software rasteriser (SwiftShader, llvmpipe: a blocklisted GPU, a virtual
// machine, a remote desktop), where every triangle costs the CPU each pass. The level
// is fixed for the page (the device's render profile), so the shared
// geometry cache never holds two levels of one piece; tests and the preview
// studio may set it before the first build.
// ---------------------------------------------------------------------------

export type CraftedDetailLevel = "full" | "lean";

export interface CraftedDetail {
  readonly level: CraftedDetailLevel;
  /** Segments round a turned leg, spindle or rail. */
  readonly radial: number;
  /** Segments round a thin rod (a spindle or a stretcher). */
  readonly rodRadial: number;
  /** Samples per metre along a turned profile or a bent tube. */
  readonly perMetre: number;
  /** Rings across a cushion's top face, and steps round its rolled edge. */
  readonly cushionRings: number;
  readonly cushionEdge: number;
  /** A cloth's samples round its fall, per metre, and rows down it. */
  readonly clothPerMetre: number;
  readonly clothRows: number;
}

const DETAIL: Readonly<Record<CraftedDetailLevel, CraftedDetail>> = {
  full: { level: "full", radial: 10, rodRadial: 7, perMetre: 70, cushionRings: 4, cushionEdge: 7, clothPerMetre: 48, clothRows: 16 },
  lean: { level: "lean", radial: 7, rodRadial: 5, perMetre: 40, cushionRings: 3, cushionEdge: 5, clothPerMetre: 30, clothRows: 11 },
};

let chosen: CraftedDetailLevel | null = null;

/**
 * Whether this browser rasterises in software, read once from a probe WebGL
 * context's renderer string (the hall's own test, hall-finish.ts) and released
 * at once. False wherever there is no WebGL to ask.
 */
function softwareRasteriser(): boolean {
  if (typeof document === "undefined" || typeof WebGL2RenderingContext === "undefined") return false;
  try {
    const gl = document.createElement("canvas").getContext("webgl2");
    if (gl === null) return false;
    const gpu = getGpuRenderer(gl);
    gl.getExtension("WEBGL_lose_context")?.loseContext();
    return gpu !== null && classifyDevice(gpu) === "poster";
  } catch {
    return false;
  }
}

/** The detail level for this device: phones and software rasterisers draw lean, everything else full. */
function deviceLevel(): CraftedDetailLevel {
  const profile = selectRenderProfile(readRenderDeviceContext(import.meta.env.DEV));
  if (profile.name === "phone" || profile.name === "off") return "lean";
  return softwareRasteriser() ? "lean" : "full";
}

/** The detail crafted furniture is drawn at on this page. */
export function craftedDetail(): CraftedDetail {
  chosen ??= deviceLevel();
  return DETAIL[chosen];
}

/**
 * Fixes the level before the first piece is built (tests, the preview
 * studio). Geometry already shared stays at the level it was built with, so
 * callers clear the registry's cache when they change it.
 */
export function setCraftedDetailLevel(level: CraftedDetailLevel): void {
  chosen = level;
}

/** The detail of a named level, whatever this page draws. */
export function craftedDetailOf(level: CraftedDetailLevel): CraftedDetail {
  return DETAIL[level];
}
