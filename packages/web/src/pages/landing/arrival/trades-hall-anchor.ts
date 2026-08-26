/**
 * Trades Hall of Glasgow, 85 Glassford Street — the point ReorientationPlugin
 * pins to the scene origin (+Y up, cardinals aligned).
 *
 * PROVENANCE: seeded 2026-08-26 from the address's approximate map position;
 * CALIBRATED in plan Task 6/8 by eye against the rendered tiles (nudge tool),
 * then baked here with the calibration date. This file is the ONLY alignment
 * truth for the Arrival — never introduce a second anchor (spec §3).
 */
export const TRADES_HALL_ANCHOR = {
  latDeg: 55.859,
  lonDeg: -4.2474,
  heightM: 20,
  azimuthDeg: 0,
} as const;
