import type { ReactElement, ReactNode } from "react";
import { quarterDayLabel, ruledBorderPath, type QuarterDay } from "./frame-geometry.js";
import type { FRAME_GENRES } from "./stage-manifest.js";

// -----------------------------------------------------------------------------
// DocumentFrame — the paper the tableau sits in.
//
// The prospect-map genre: a paper margin with a hand-ruled double border, a
// small cartouche naming the scene and its quarter day in the quiz's serif,
// a compass rose in a corner, and the left margin, where the ceremony mounts
// its LedgerStrip (twelve faint slots; a gold stroke per commit). Everything
// is DOM, CSS and SVG: no image loads for the frame, so it is on screen
// before any plane arrives. On phones the margin is a 6 to 8 px paper edge
// and the cartouche sits at the top; stage.css owns those decisions.
//
// The border paths are computed once per module load from a deterministic
// hash (frame-geometry.ts): the same paper for every reader.
// -----------------------------------------------------------------------------

export type FrameGenre = (typeof FRAME_GENRES)[number];

const OUTER_RULE = ruledBorderPath({ inset: 3, amplitude: 1.6, step: 24, seed: 3 });
const INNER_RULE = ruledBorderPath({ inset: 11, amplitude: 1.1, step: 30, seed: 11 });

export interface DocumentFrameProps {
  readonly genre: FrameGenre;
  /** The scene's name as the cartouche prints it; absent, the cartouche carries the quarter day alone. */
  readonly title?: string;
  readonly quarterDay: QuarterDay;
  /** The ceremony's LedgerStrip; mounts in the left margin. */
  readonly ledgerSlot: ReactNode;
}

function CompassRose(): ReactElement {
  return (
    <svg className="stage-frame-compass" viewBox="0 0 100 100" aria-hidden="true" focusable="false">
      <circle cx="50" cy="50" r="31" fill="none" stroke="currentColor" strokeWidth="0.6" opacity="0.7" />
      <circle cx="50" cy="50" r="22" fill="none" stroke="currentColor" strokeWidth="0.4" opacity="0.45" />
      {/* the half-points, shorter, rotated between the cardinals */}
      <g transform="rotate(45 50 50)">
        <path d="M50 26 L52.4 50 L50 50 Z M50 74 L47.6 50 L50 50 Z M26 50 L50 47.6 L50 50 Z M74 50 L50 52.4 L50 50 Z" fill="currentColor" opacity="0.55" />
        <path d="M50 26 L47.6 50 L50 50 Z M50 74 L52.4 50 L50 50 Z M26 50 L50 52.4 L50 50 Z M74 50 L50 47.6 L50 50 Z" fill="none" stroke="currentColor" strokeWidth="0.5" opacity="0.55" />
      </g>
      {/* the cardinals: one half filled, one half ruled, as an engraver shades a point */}
      <path d="M50 10 L53.6 50 L50 50 Z M50 90 L46.4 50 L50 50 Z M10 50 L50 46.4 L50 50 Z M90 50 L50 53.6 L50 50 Z" fill="currentColor" opacity="0.85" />
      <path d="M50 10 L46.4 50 L50 50 Z M50 90 L53.6 50 L50 50 Z M10 50 L50 53.6 L50 50 Z M90 50 L50 46.4 L50 50 Z" fill="none" stroke="currentColor" strokeWidth="0.6" opacity="0.85" />
      <circle cx="50" cy="50" r="1.6" fill="currentColor" />
      <text x="50" y="7.5" textAnchor="middle" fontSize="7" fill="currentColor" className="stage-frame-compass-north">N</text>
    </svg>
  );
}

export function DocumentFrame({ genre, title, quarterDay, ledgerSlot }: DocumentFrameProps): ReactElement {
  const quarter = quarterDayLabel(quarterDay);
  return (
    <div className="stage-frame" data-genre={genre}>
      <svg
        className="stage-frame-rule"
        viewBox="0 0 1000 1000"
        preserveAspectRatio="none"
        aria-hidden="true"
        focusable="false"
      >
        <path d={OUTER_RULE} fill="none" stroke="currentColor" strokeWidth="1.1" vectorEffect="non-scaling-stroke" opacity="0.82" />
        <path d={INNER_RULE} fill="none" stroke="currentColor" strokeWidth="0.7" vectorEffect="non-scaling-stroke" opacity="0.5" />
      </svg>
      <p className="stage-frame-cartouche">
        {title !== undefined && title.length > 0 ? (
          <span className="stage-frame-title">{title}.</span>
        ) : null}
        <span className="stage-frame-quarter">{quarter}.</span>
      </p>
      <CompassRose />
      <div className="stage-frame-ledger">{ledgerSlot}</div>
    </div>
  );
}
