/**
 * UI chrome palette — panels, controls, borders, text.
 *
 * This is the "app UI" counterpart to colors.ts (which holds 3D
 * surface colours). Every panel, button, banner, and text style in
 * the hallkeeper sheet, editor overlays, and action bars pulls from
 * here so drift ("is BORDER #252320 or #2a2824?") can't happen twice.
 */

/** Primary brand accent — used for callouts, highlights, primary CTAs. */
export const GOLD = "#c9a84c";

/** Success / completion — checked rows, "Setup complete" state. */
export const GREEN = "#5ba870";

/** Page background on dark UIs (hallkeeper sheet). */
export const DARK_BG = "#111";

/** Slightly-lifted surface — panels, cards, headers on dark UIs. */
export const CARD_BG = "#1a1a1d";

/** Raised input background inside a card (text areas, inputs). */
export const INPUT_BG = "#111";

/** Hairline border between cards / inputs. */
export const BORDER = "#2a2824";

/** Dim text — secondary labels, hints, captions. */
export const TEXT_SEC = "#9a9690";

/** Muted text — placeholders, disabled states, very-secondary captions. */
export const TEXT_MUT = "#5c5955";
