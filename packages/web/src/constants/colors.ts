/**
 * Trades Hall Glasgow palette — Robert Adam Georgian neoclassical interior.
 *
 * Tuned against reference photos of the actual Grand Hall (1791–1794):
 *   - Honey-oak parquet floor
 *   - Warm cream plaster walls with white trim
 *   - Dark oak wainscot panelling
 *   - Pale cream-blue painted plaster ceiling
 *   - Brass / gold accents (chandelier, mouldings highlights)
 *   - Burgundy coved frieze
 *
 * The palette stays muted enough that placed furniture stays the visual
 * focus, while every surface reads as a real material instead of "grey
 * neutral N." All values are 6-digit hex; tests assert this shape.
 */

// ---------------------------------------------------------------------------
// Surfaces
// ---------------------------------------------------------------------------

/** Honey-oak parquet — warm, polished, mid-value so furniture reads above it. */
export const FLOOR_COLOR = "#a07a4d";

/** Warm cream plaster — the dominant interior tone. */
export const WALL_COLOR = "#efe2c5";

/** Pale cream-blue painted plaster — tints toward white, hints of Adam blue. */
export const CEILING_COLOR = "#e8e3d6";

/** Dark oak wainscot — anchors the lower walls, frames the cream above. */
export const WAINSCOT_COLOR = "#7a5832";

/** Height in meters of the wainscoting panels. */
export const WAINSCOT_HEIGHT = 2.5;

/** Floor grid line colour — subtle gold tint so it disappears against the parquet. */
export const GRID_COLOR = "#8a6a45";

/** Floor grid secondary line colour — even more subtle. */
export const GRID_COLOR_CENTER = "#6e5235";

/** Dome interior — cream with a whisper of Wedgwood blue, classic Adam ceiling. */
export const DOME_COLOR = "#dbe1e8";

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
