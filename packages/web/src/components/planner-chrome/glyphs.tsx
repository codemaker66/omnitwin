import type { ReactElement } from "react";

// ---------------------------------------------------------------------------
// Glyphs drawn on Lucide's grid (spec 7.4): 24 units, a 1.5 stroke, round caps
// and joins, so they sit beside Lucide's own without a seam. Lay out is four
// rounds; Cloth is a table's cloth falling to its hem.
// ---------------------------------------------------------------------------

interface GlyphProps {
  readonly size?: 16 | 20 | 22;
  readonly className?: string;
}

function glyphClass(size: number, className: string | undefined): string {
  return ["pc-icon", size === 20 || size === 22 ? "pc-icon--20" : "", className ?? ""].filter(Boolean).join(" ");
}

export function LayOutGlyph({ size = 16, className }: GlyphProps): ReactElement {
  return (
    <svg className={glyphClass(size, className)} width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <circle cx="7" cy="7" r="3" />
      <circle cx="17" cy="7" r="3" />
      <circle cx="7" cy="17" r="3" />
      <circle cx="17" cy="17" r="3" />
    </svg>
  );
}

export function ClothGlyph({ size = 16, className }: GlyphProps): ReactElement {
  return (
    <svg className={glyphClass(size, className)} width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M4 7h16l-1.5 10.5a2 2 0 0 1-2 1.5h-9a2 2 0 0 1-2-1.5z" />
      <path d="M4 7c2.5 2 13.5 2 16 0" />
    </svg>
  );
}
