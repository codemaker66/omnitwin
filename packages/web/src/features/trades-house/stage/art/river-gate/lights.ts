// -----------------------------------------------------------------------------
// lights — what the Lantern's water reflects: the lantern at full intensity
// and warmth, then the fifteen windows at 0.15 to 0.35, sixteen lights in
// all, the manifest's maximum. Positions are normalised to the tableau, so
// for any aspect other than the drawing's 16:9 the caller asks for the
// projected set; the constant is the 16:9 case.
// -----------------------------------------------------------------------------
import { MAX_STAGE_LIGHTS, type StageLight } from "../../stage-manifest.js";
import { FAR_BANK_WINDOWS, LANTERN_FLAME, WINDOW_HEIGHT, WINDOW_WIDTH } from "./far-bank-geometry.js";
import { RIVER_GATE_VIEWBOX, viewBoxToTableau, type TableauPoint, type ViewBoxPoint } from "./viewbox.js";

export interface RiverGateLightSource {
  readonly point: ViewBoxPoint;
  readonly intensity: number;
  readonly warmth: number;
}

const WINDOW_INTENSITY_MIN = 0.15;
const WINDOW_INTENSITY_MAX = 0.35;
const WINDOW_GLOW_MIN = 0.55;
const WINDOW_GLOW_MAX = 0.85;

function windowIntensity(glow: number): number {
  const t = (glow - WINDOW_GLOW_MIN) / (WINDOW_GLOW_MAX - WINDOW_GLOW_MIN);
  const clamped = t < 0 ? 0 : t > 1 ? 1 : t;
  return WINDOW_INTENSITY_MIN + clamped * (WINDOW_INTENSITY_MAX - WINDOW_INTENSITY_MIN);
}

/** The lantern first, so it is never the one dropped if the cap ever tightens. */
export const RIVER_GATE_LIGHT_SOURCES: readonly RiverGateLightSource[] = [
  { point: LANTERN_FLAME, intensity: 1, warmth: 1 },
  ...FAR_BANK_WINDOWS.map((window) => ({
    point: { x: window.x + WINDOW_WIDTH / 2, y: window.y + WINDOW_HEIGHT / 2 },
    intensity: windowIntensity(window.glow),
    warmth: 0.9,
  })),
].slice(0, MAX_STAGE_LIGHTS);

/** The lights for a tableau of the given size (any unit; the ratio is what matters). */
export function riverGateLightsFor(tableauWidth: number, tableauHeight: number): readonly StageLight[] {
  return RIVER_GATE_LIGHT_SOURCES.map((source) => {
    const at = viewBoxToTableau(source.point, tableauWidth, tableauHeight);
    return { x: at.x, y: at.y, intensity: source.intensity, warmth: source.warmth };
  });
}

/** The 16:9 case, where the drawing and the tableau coincide. */
export const RIVER_GATE_LIGHTS: readonly StageLight[] = riverGateLightsFor(RIVER_GATE_VIEWBOX.width, RIVER_GATE_VIEWBOX.height);

/** The flame's centre, normalised to the tableau, for the Lantern to put its fire in the housing's hole. */
export function riverGateLanternPositionFor(tableauWidth: number, tableauHeight: number): TableauPoint {
  return viewBoxToTableau(LANTERN_FLAME, tableauWidth, tableauHeight);
}

export const RIVER_GATE_LANTERN_POSITION: TableauPoint = riverGateLanternPositionFor(RIVER_GATE_VIEWBOX.width, RIVER_GATE_VIEWBOX.height);
