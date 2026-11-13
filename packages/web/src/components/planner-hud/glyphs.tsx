import type { ReactElement, ReactNode } from "react";
import type { SealId } from "../../lib/hud/room-seals.js";

// ---------------------------------------------------------------------------
// The HUD's glyphs: one drawn family (24 px, one 1.5 px line, round joins),
// so the seals and keys read as engraved by one hand. Each is decoration
// beside a word: aria-hidden, coloured by the text around it.
// ---------------------------------------------------------------------------

function Glyph({ children, className }: { readonly children: ReactNode; readonly className?: string }): ReactElement {
  return (
    <svg
      className={className === undefined ? "hud-glyph" : `hud-glyph ${className}`}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      {children}
    </svg>
  );
}

const SEAL_GLYPHS: Readonly<Record<SealId, ReactNode>> = {
  seats: <><path d="M7 11V7.5a2.5 2.5 0 0 1 5 0V11" /><path d="M5 11h9v4H5z" /><path d="M6 15v4M13 15v4" /><path d="M17 9v10M17 13h2.5" /></>,
  doors: <><path d="M6 20V5.5A1.5 1.5 0 0 1 7.5 4h9A1.5 1.5 0 0 1 18 5.5V20" /><path d="M4 20h16" /><path d="M12 4v16" /><path d="M9.5 12.5h.01M14.5 12.5h.01" /></>,
  aisles: <><path d="M6 20V8M18 20V8" /><circle cx="6" cy="6" r="2" /><circle cx="18" cy="6" r="2" /><path d="M6 10c3 4 9 4 12 0" /><path d="M4 20h4M16 20h4" /></>,
  "top-table": <><path d="M3 12h18v2H3z" /><path d="M5 14v5M19 14v5" /><path d="M7 9.5a1.5 1.5 0 1 1 3 0M10.5 9.5a1.5 1.5 0 1 1 3 0M14 9.5a1.5 1.5 0 1 1 3 0" /></>,
  "dance-floor": <><path d="M4 9l8-4 8 4-8 4z" /><path d="M8 7l8 4M16 7l-8 4" /><path d="M4 9v4l8 4 8-4V9" /></>,
  bar: <><path d="M5 5h14l-7 8z" /><path d="M12 13v6" /><path d="M8 19h8" /><path d="M15 8.5l2.5-3" /></>,
  stage: <><path d="M3 15h18v4H3z" /><path d="M5 15V5h14v10" /><path d="M5 5c2.5 3 2.5 6 0 8M19 5c-2.5 3-2.5 6 0 8" /></>,
  lectern: <><path d="M7 8l10-2v5H7z" /><path d="M12 11v8" /><path d="M8 19h8" /><path d="M12 6V4" /></>,
  screen: <><rect x="4" y="5" width="16" height="10" rx="1" /><path d="M12 15v3" /><path d="M8 20l4-2 4 2" /></>,
};

export function SealGlyph({ id }: { readonly id: SealId }): ReactElement {
  return <Glyph className="hud-glyph--seal">{SEAL_GLYPHS[id]}</Glyph>;
}

export function TickGlyph(): ReactElement {
  return <Glyph><path d="M5 12.5l4.5 4.5L19 7.5" /></Glyph>;
}

export function UndoGlyph(): ReactElement {
  return <Glyph><path d="M9 14L4 9l5-5" /><path d="M4 9h10a6 6 0 0 1 0 12h-3" /></Glyph>;
}

export function RedoGlyph(): ReactElement {
  return <Glyph><path d="M15 14l5-5-5-5" /><path d="M20 9H10a6 6 0 0 0 0 12h3" /></Glyph>;
}

/** The burst on "Lay out for me": the room laid at a stroke. */
export function SunburstGlyph(): ReactElement {
  return (
    <Glyph>
      <circle cx="12" cy="12" r="3" />
      <path d="M12 3v3M12 18v3M3 12h3M18 12h3M5.6 5.6l2.1 2.1M16.3 16.3l2.1 2.1M18.4 5.6l-2.1 2.1M7.7 16.3l-2.1 2.1" />
    </Glyph>
  );
}

export function MoreGlyph(): ReactElement {
  return <Glyph><path d="M6 12h.01M12 12h.01M18 12h.01" strokeWidth="2.5" /></Glyph>;
}

export function ChevronGlyph(): ReactElement {
  return <Glyph><path d="M9 6l6 6-6 6" /></Glyph>;
}

export function MinusGlyph(): ReactElement {
  return <Glyph><path d="M6 12h12" /></Glyph>;
}

export function PlusGlyph(): ReactElement {
  return <Glyph><path d="M6 12h12M12 6v12" /></Glyph>;
}

export function TurnGlyph(): ReactElement {
  return <Glyph><path d="M20 12a8 8 0 1 1-2.6-5.9" /><path d="M20 4v5h-5" /></Glyph>;
}

export function CopyGlyph(): ReactElement {
  return <Glyph><rect x="9" y="9" width="11" height="11" rx="1.5" /><path d="M15 9V5.5A1.5 1.5 0 0 0 13.5 4h-8A1.5 1.5 0 0 0 4 5.5v8A1.5 1.5 0 0 0 5.5 15H9" /></Glyph>;
}

/** Back to the hand: a piece returning to its card. */
export function PutBackGlyph(): ReactElement {
  return <Glyph><path d="M12 4v10" /><path d="M8 10l4 4 4-4" /><path d="M5 17v2.5h14V17" /></Glyph>;
}

export function CloseGlyph(): ReactElement {
  return <Glyph><path d="M6 6l12 12M18 6L6 18" /></Glyph>;
}

export function SunGlyph(): ReactElement {
  return <Glyph><circle cx="12" cy="12" r="4" /><path d="M12 3v2M12 19v2M3 12h2M19 12h2M5.6 5.6l1.4 1.4M17 17l1.4 1.4M18.4 5.6L17 7M7 17l-1.4 1.4" /></Glyph>;
}

export function DuskGlyph(): ReactElement {
  return <Glyph><path d="M5 16a7 7 0 0 1 14 0" /><path d="M3 16h18M7 20h10" /><path d="M12 5v2M5.5 8.5l1.4 1.4M18.5 8.5l-1.4 1.4" /></Glyph>;
}

export function CandleGlyph(): ReactElement {
  return <Glyph><path d="M12 3c1.6 2 2 3.2 2 4a2 2 0 0 1-4 0c0-.8.4-2 2-4z" /><path d="M9.5 12h5v8h-5z" /><path d="M12 9v3" /></Glyph>;
}
