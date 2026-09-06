// -----------------------------------------------------------------------------
// FarBank — the burgh on the far bank: the silhouette, the quay, the Water
// Port's mouth, fifteen lit windows, and the lantern's standard and housing
// with an evenodd hole where the Lantern's flame shows through from beneath.
//
// Nothing in this plane moves, so its whole subtree is one module-level
// element: React sees the same element reference on every frame the stage
// re-renders and skips it. Pure over SvgPlaneProps by construction.
// Provenance: Pr, drawn by code, 2026-09-06.
// -----------------------------------------------------------------------------
import type { ReactElement } from "react";
import type { SvgPlaneProps } from "../../plane-registry.js";
import {
  FAR_BANK_QUAY_PATH,
  FAR_BANK_SILHOUETTE_PATH,
  FAR_BANK_WINDOWS,
  LANTERN_ARM_PATH,
  LANTERN_BRACE_PATH,
  LANTERN_HANGER_PATH,
  LANTERN_HOUSING_PATH,
  LANTERN_STANDARD_PATH,
  LIT_STONE_PATHS,
  WATER_PORT_PATH,
  WINDOW_HEIGHT,
  WINDOW_WIDTH,
} from "./far-bank-geometry.js";
import { PALETTE, PLANE_SVG_STYLE } from "./plane-style.js";
import { RIVER_GATE_PRESERVE_ASPECT, RIVER_GATE_VIEWBOX_ATTR } from "./viewbox.js";

const BURGH = (
  <g data-burgh="">
    <path d={FAR_BANK_SILHOUETTE_PATH} fill={PALETTE.town} />
    <path d={FAR_BANK_QUAY_PATH} fill={PALETTE.quay} />
    {LIT_STONE_PATHS.map((d, i) => (
      <path
        key={d}
        d={d}
        fill={i === 0 ? PALETTE.litStone : PALETTE.litStoneNear}
        opacity={i === 0 ? 0.9 : 0.55}
        data-lit-stone=""
      />
    ))}
    <path d={WATER_PORT_PATH} fill={PALETTE.portMouth} data-water-port="" />
    <g data-windows="">
      {FAR_BANK_WINDOWS.map((window) => (
        <rect
          key={`${String(window.x)}-${String(window.y)}`}
          x={window.x}
          y={window.y}
          width={WINDOW_WIDTH}
          height={WINDOW_HEIGHT}
          rx={0.4}
          fill={PALETTE.window}
          opacity={window.glow}
          data-window=""
        />
      ))}
    </g>
    <g data-prop="lantern" fill="none" stroke={PALETTE.ink} strokeLinecap="round">
      <path d={LANTERN_STANDARD_PATH} strokeWidth={2.4} />
      <path d={LANTERN_ARM_PATH} strokeWidth={2} />
      <path d={LANTERN_BRACE_PATH} strokeWidth={1.2} />
      <path d={LANTERN_HANGER_PATH} strokeWidth={1.1} />
      <path d={LANTERN_HOUSING_PATH} fill={PALETTE.ink} stroke="none" fillRule="evenodd" data-lantern-housing="" />
    </g>
  </g>
);

export function FarBank(_props: SvgPlaneProps): ReactElement {
  return (
    <svg
      className="stage-plane-svg stage-plane-svg--far-bank"
      viewBox={RIVER_GATE_VIEWBOX_ATTR}
      preserveAspectRatio={RIVER_GATE_PRESERVE_ASPECT}
      aria-hidden="true"
      focusable="false"
      style={PLANE_SVG_STYLE}
      data-plane="far-bank"
    >
      {BURGH}
    </svg>
  );
}
