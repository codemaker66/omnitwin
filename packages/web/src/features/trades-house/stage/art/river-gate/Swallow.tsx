// -----------------------------------------------------------------------------
// Swallow — one bird crossing high over the town. Its whole state is the
// pure pose in swallow-flight.ts: hunting, leaving on the first poke, back
// once on the manifest's "distinctProps:3" row, still under reduced motion.
// Provenance: Pr, drawn by code, 2026-09-06.
// -----------------------------------------------------------------------------
import type { ReactElement } from "react";
import type { SvgPlaneProps } from "../../plane-registry.js";
import { PALETTE, PLANE_SVG_STYLE } from "./plane-style.js";
import { SWALLOW_BODY_PATH, SWALLOW_WING_PATH, swallowPose } from "./swallow-flight.js";
import { RIVER_GATE_PRESERVE_ASPECT, RIVER_GATE_VIEWBOX_ATTR } from "./viewbox.js";

export function Swallow({ pokes, nowMs, reducedMotion }: SvgPlaneProps): ReactElement {
  const pose = swallowPose(pokes, nowMs, reducedMotion);
  return (
    <svg
      className="stage-plane-svg stage-plane-svg--swallow"
      viewBox={RIVER_GATE_VIEWBOX_ATTR}
      preserveAspectRatio={RIVER_GATE_PRESERVE_ASPECT}
      aria-hidden="true"
      focusable="false"
      style={PLANE_SVG_STYLE}
      data-plane="swallow"
    >
      {pose.visible ? (
        <g
          data-prop="swallow"
          fill={PALETTE.ink}
          transform={`translate(${pose.x.toFixed(2)} ${pose.y.toFixed(2)}) scale(${String(pose.facing)} 1)`}
        >
          <path d={SWALLOW_BODY_PATH} />
          <g transform={`scale(1 ${pose.wingSpread.toFixed(3)})`}>
            <path d={SWALLOW_WING_PATH} data-wing="" />
            <path d={SWALLOW_WING_PATH} transform="scale(1 -1)" data-wing="" />
          </g>
        </g>
      ) : null}
    </svg>
  );
}
