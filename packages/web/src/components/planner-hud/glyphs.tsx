import type { ReactElement, ReactNode } from "react";

// ---------------------------------------------------------------------------
// The HUD's few glyphs: one drawn family (a 24 unit box, one 1.5 unit line,
// round joins), shown at 16 px so the line lands at one pixel. A glyph only
// stands where a word would be longer than the thing it names: the tick of a
// step done, the seats' minus and plus, "more" and close. Each is aria-hidden
// and coloured by the text around it.
// ---------------------------------------------------------------------------

function Glyph({ children }: { readonly children: ReactNode }): ReactElement {
  return (
    <svg
      className="hud-glyph"
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

export function TickGlyph(): ReactElement {
  return <Glyph><path d="M5 12.5l4.5 4.5L19 7.5" /></Glyph>;
}

export function MoreGlyph(): ReactElement {
  return <Glyph><path d="M6 12h.01M12 12h.01M18 12h.01" strokeWidth="2.5" /></Glyph>;
}

export function MinusGlyph(): ReactElement {
  return <Glyph><path d="M6 12h12" /></Glyph>;
}

export function PlusGlyph(): ReactElement {
  return <Glyph><path d="M6 12h12M12 6v12" /></Glyph>;
}

export function CloseGlyph(): ReactElement {
  return <Glyph><path d="M6 6l12 12M18 6L6 18" /></Glyph>;
}
