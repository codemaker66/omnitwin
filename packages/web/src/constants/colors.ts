/**
 * Trades Hall Glasgow palette — Robert Adam Georgian neoclassical interior.
 *
 * Tuned against reference photos of the actual Grand Hall (1791–1794):
 *   - Polished honey timber plank floor
 *   - Warm cream plaster walls with white trim
 *   - Dark oak wainscot panelling
 *   - West African avodire timber ceiling and seven-metre dome
 *   - Brass / gold accents (chandelier, mouldings highlights)
 *   - Burgundy and gold trade frieze
 *
 * The palette stays muted enough that placed furniture stays the visual
 * focus, while every surface reads as a real material instead of "grey
 * neutral N." All values are 6-digit hex; tests assert this shape.
 */

// ---------------------------------------------------------------------------
// Surfaces
// ---------------------------------------------------------------------------

/** Polished honey timber planks - light varnish tint that lets the floor texture carry the grain. */
export const FLOOR_COLOR = "#f5d9a1";

/** Warm cream plaster — the dominant interior tone. */
export const WALL_COLOR = "#efe2c5";

/** West African avodire timber — warm golden-brown coffered ceiling. */
export const CEILING_COLOR = "#b9783d";

/** Dark oak wainscot — anchors the lower walls, frames the cream above. */
export const WAINSCOT_COLOR = "#7a5832";

/** Height in meters of the wainscoting panels. */
export const WAINSCOT_HEIGHT = 2.5;

/** Floor grid line colour — subtle gold tint so it disappears against the parquet. */
export const GRID_COLOR = "#8a6a45";

/** Floor grid secondary line colour — even more subtle. */
export const GRID_COLOR_CENTER = "#6e5235";

/** Dome interior — avodire timber warmed by gold leaf and chandelier light. */
export const DOME_COLOR = "#c08a42";

// ---------------------------------------------------------------------------
// Ornament accents
// ---------------------------------------------------------------------------

/** Ivory white — crown moulding, skirting, pilaster shafts. */
export const TRIM_COLOR = "#f8f3e8";

/** Brass / antique gold — chandelier, ornamental mouldings, frieze highlights. */
export const BRASS_GOLD = "#b8965a";

/** Deeper bronze — gold ornament shadows and weight. */
export const BRONZE_DARK = "#8a6f37";

/** Burgundy — frieze background, accent inlay, optional carpet runner. */
export const BURGUNDY = "#6b2a2a";

/** Frosted crystal — chandelier drops, soft luminous emissive. */
export const CRYSTAL = "#fdf6df";

/** Cool window-glow — emissive panes that read as "daylight outside". */
export const WINDOW_GLOW = "#dde5ec";

// ---------------------------------------------------------------------------
// Misc
// ---------------------------------------------------------------------------

/** Human reference figure — neutral medium grey, visible but not distracting. */
export const HUMAN_FIGURE_COLOR = "#8090a0";

/** Room wireframe edge colour — subtle dark grey, always visible as reference. */
export const FRAME_COLOR = "#6a6a6a";
