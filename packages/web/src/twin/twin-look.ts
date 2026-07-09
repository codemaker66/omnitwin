import { z } from "zod";

// -----------------------------------------------------------------------------
// twin-look — the exact-view deep link (?look=), pure and unit-tested.
//
// "Stand where I'm standing": the share button encodes the CURRENT camera —
// node, yaw, pitch, fov — so the recipient lands gazing at exactly the dome the
// sender framed. Compact and human-legible: `?look=scan_045,12.3,-4.5,68.5`
// (commas, because the numbers carry decimal points). The node id ALSO travels
// in ?node= as today — the walk seeds from ?node=, and the look param only adds
// the camera; a mismatched or malformed look is IGNORED (never a broken load).
//
// SS++ phase 1 ("the irresistible link"): the paste becomes the pitch.
// -----------------------------------------------------------------------------

/** Camera pose carried by a ?look= param. Angles in degrees. */
export interface TwinLook {
  readonly nodeId: string;
  readonly yawDeg: number;
  readonly pitchDeg: number;
  readonly fovDeg: number;
}

/** Matches WalkControls' fov zoom range — a decoded fov clamps into it. */
const LOOK_MIN_FOV = 30;
const LOOK_MAX_FOV = 95;
/** Matches WalkControls' pitch clamp (±85°). */
const LOOK_MAX_PITCH_DEG = 85;

const lookSchema = z.object({
  nodeId: z.string().regex(/^[\w-]+$/),
  yawDeg: z.number().finite(),
  pitchDeg: z.number().finite(),
  fovDeg: z.number().finite(),
});

/** Encode a camera pose for the URL: `scan_045,12.3,-4.5,68.5`.
 *  Yaw/pitch to 0.1°, fov to 0.5° — imperceptible, keeps links short. */
export function encodeTwinLook(look: TwinLook): string {
  const tenth = (value: number): string => (Math.round(value * 10) / 10).toString();
  const half = (value: number): string => (Math.round(value * 2) / 2).toString();
  return [look.nodeId, tenth(look.yawDeg), tenth(look.pitchDeg), half(look.fovDeg)].join(",");
}

/**
 * Decode a ?look= value. Returns null for anything malformed — the caller
 * falls back to the normal opening, never a broken load. Pitch and fov are
 * clamped into the walk's real ranges so a hand-edited URL cannot flip the
 * camera or zoom beyond the lens.
 */
export function decodeTwinLook(raw: string | null): TwinLook | null {
  if (raw === null || raw.length === 0 || raw.length > 80) {
    return null;
  }
  const parts = raw.split(",");
  if (parts.length !== 4) {
    return null;
  }
  const candidate = {
    nodeId: parts[0] ?? "",
    yawDeg: Number(parts[1]),
    pitchDeg: Number(parts[2]),
    fovDeg: Number(parts[3]),
  };
  const parsed = lookSchema.safeParse(candidate);
  if (!parsed.success) {
    return null;
  }
  return {
    nodeId: parsed.data.nodeId,
    yawDeg: parsed.data.yawDeg,
    pitchDeg: Math.min(Math.max(parsed.data.pitchDeg, -LOOK_MAX_PITCH_DEG), LOOK_MAX_PITCH_DEG),
    fovDeg: Math.min(Math.max(parsed.data.fovDeg, LOOK_MIN_FOV), LOOK_MAX_FOV),
  };
}
