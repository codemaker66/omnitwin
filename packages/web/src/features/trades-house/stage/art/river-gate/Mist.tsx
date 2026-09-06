// -----------------------------------------------------------------------------
// Mist — a low band over the far water: three flat lobes of slate at a few
// percent, drifting a few units on two slow, incommensurate movements so
// nothing loops visibly; still under reduced motion. The Lantern may take
// the mist into its water shader later; until then this plane carries it.
// Provenance: Pr, drawn by code, 2026-09-06.
// -----------------------------------------------------------------------------
import type { ReactElement } from "react";
import type { SvgPlaneProps } from "../../plane-registry.js";
import { MIST_BANDS, mistDriftX } from "./mist-geometry.js";
import { PALETTE, PLANE_SVG_STYLE } from "./plane-style.js";
import { RIVER_GATE_PRESERVE_ASPECT, RIVER_GATE_VIEWBOX_ATTR } from "./viewbox.js";

const BANDS = MIST_BANDS.map((mist) => (
  <path key={mist.path} d={mist.path} fill={PALETTE.mist} opacity={mist.opacity} data-mist-band="" />
));

export function Mist({ nowMs, reducedMotion }: SvgPlaneProps): ReactElement {
  const drift = mistDriftX(nowMs, reducedMotion);
  return (
    <svg
      className="stage-plane-svg stage-plane-svg--mist"
      viewBox={RIVER_GATE_VIEWBOX_ATTR}
      preserveAspectRatio={RIVER_GATE_PRESERVE_ASPECT}
      aria-hidden="true"
      focusable="false"
      style={PLANE_SVG_STYLE}
      data-plane="mist"
    >
      <g transform={`translate(${drift.toFixed(2)} 0)`}>{BANDS}</g>
    </svg>
  );
}
