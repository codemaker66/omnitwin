// -----------------------------------------------------------------------------
// mist-geometry — a low band of mist over the far water, three flat lobes
// of slate at a few percent opacity with hand-drawn top edges. No gradient
// and no filter: three stacked flat fills at 3 to 4.5 percent are softer
// than any gradient at this size and cost the compositor nothing. The
// bands are wider than the frame so a slow drift never shows an edge.
//
// The Lantern paints the water and may take the mist over in its shader;
// until it does, this plane carries it. Provenance: Pr, 2026-09-06.
// -----------------------------------------------------------------------------
import { byteLength, handDrawn, polylinePath, type ViewBoxPoint } from "./viewbox.js";

const p = (x: number, y: number): ViewBoxPoint => ({ x, y });

export interface MistBand {
  readonly path: string;
  readonly opacity: number;
}

function band(top: readonly ViewBoxPoint[], bottomY: number, salt: number): string {
  const drawn = handDrawn(top, 30, 1.4, salt);
  const first = drawn[0];
  const last = drawn[drawn.length - 1];
  if (first === undefined || last === undefined) return "";
  return `${polylinePath(drawn)} L ${String(last.x)} ${String(bottomY)} L ${String(first.x)} ${String(bottomY)} Z`;
}

export const MIST_BANDS: readonly MistBand[] = [
  {
    path: band(
      [p(-40, 549), p(180, 543), p(420, 547), p(640, 552), p(860, 545), p(1080, 540), p(1300, 548), p(1520, 553), p(1640, 546)],
      598,
      21,
    ),
    opacity: 0.045,
  },
  {
    path: band(
      [p(-40, 560), p(240, 556), p(500, 562), p(760, 555), p(1000, 559), p(1260, 564), p(1460, 557), p(1640, 561)],
      606,
      22,
    ),
    opacity: 0.035,
  },
  {
    path: band(
      [p(-40, 571), p(300, 568), p(620, 573), p(900, 567), p(1200, 570), p(1640, 574)],
      590,
      23,
    ),
    opacity: 0.03,
  },
];

/** Drift in drawing units: two slow, incommensurate movements, at most 10 units either way. */
export function mistDriftX(nowMs: number, reducedMotion: boolean): number {
  if (reducedMotion) return 0;
  return 7 * Math.sin(nowMs / 41000) + 3 * Math.sin(nowMs / 17300);
}

export const MIST_BYTES = byteLength(...MIST_BANDS.map((mist) => mist.path));
