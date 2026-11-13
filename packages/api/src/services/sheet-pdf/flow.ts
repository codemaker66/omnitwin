import { PAGE, lineHeight, wrapLines, drawLine, type Doc, type TextStyle } from "./style.js";

// ---------------------------------------------------------------------------
// The vertical cursor down the sheet. Every block asks for the room it needs
// before drawing, so nothing is cut by the footer and a heading never sits
// alone at the foot of a page; only paragraphs break mid-block, line by line.
// ---------------------------------------------------------------------------

export const PAGE_OPTIONS: PDFKit.PDFDocumentOptions = { size: [PAGE.width, PAGE.height], margin: 0 };

/** One piece of a column, drawn whole at the y it is given. */
export interface Unit {
  readonly height: number;
  /** Room asked for before it starts: itself plus what must stay with it. */
  readonly need?: number;
  /** Space above it, dropped at the top of a page. */
  readonly before?: number;
  readonly draw: (y: number) => void;
}

/** A paragraph as units, one per line, the first asking room for `keep` lines. */
export function paragraphUnits(doc: Doc, style: TextStyle, text: string, x: number, width: number, keep = 1): Unit[] {
  const height = lineHeight(doc, style, text);
  const lines = wrapLines(doc, style, text, width);
  return lines.map((line, index) => ({
    height,
    ...(index === 0 ? { need: height * Math.min(keep, lines.length) } : {}),
    draw: (y: number) => { drawLine(doc, style, line, x, y); },
  }));
}

export class Flow {
  y: number;

  constructor(readonly doc: Doc, readonly top: number = PAGE.margin, readonly bottom: number = PAGE.contentBottom) {
    this.y = top;
  }

  /** Room left on this page. */
  get room(): number {
    return this.bottom - this.y;
  }

  /** The height a fresh page offers. */
  get pageRoom(): number {
    return this.bottom - this.top;
  }

  newPage(): void {
    this.doc.addPage(PAGE_OPTIONS);
    this.y = this.top;
  }

  /** Start a new page unless `height` fits below the cursor. Returns whether it did. */
  ensure(height: number): boolean {
    if (this.y + height <= this.bottom) return false;
    this.newPage();
    return true;
  }

  /**
   * Columns side by side that may cross pages. Each lane keeps its own
   * cursor and carries on overleaf by itself, so a long store list runs on
   * beside a short day instead of pushing both to a fresh page. `rule` draws
   * whatever separates the lanes, once per page they share, between that
   * page's top and the lowest line on it. Leaves the flow on the last page
   * any lane reached, below its lowest line there.
   */
  lanes(lanes: readonly (readonly Unit[])[], rule?: (top: number, bottom: number) => void): void {
    const { doc } = this;
    const opening = Math.max(0, ...lanes.map((units) => (units[0] === undefined ? 0 : units[0].need ?? units[0].height)));
    this.ensure(opening);
    const range = doc.bufferedPageRange();
    const first = range.start + range.count - 1;
    const start = this.y;
    const topOf = (page: number): number => (page === first ? start : this.top);
    let last = first;
    /** reach[lane][page - first]: the lowest y each lane reached on each page. */
    const reach: number[][] = [];
    for (const units of lanes) {
      const mine: number[] = [];
      reach.push(mine);
      let page = first;
      let y = start;
      doc.switchToPage(page);
      for (const unit of units) {
        if (y + (unit.before ?? 0) + (unit.need ?? unit.height) > this.bottom && y > topOf(page)) {
          page += 1;
          y = this.top;
          if (page > last) { doc.addPage(PAGE_OPTIONS); last = page; } else doc.switchToPage(page);
        }
        if (y > topOf(page)) y += unit.before ?? 0;
        unit.draw(y);
        y += unit.height;
        mine[page - first] = Math.max(mine[page - first] ?? 0, y);
      }
    }
    for (let page = first; page <= last; page++) {
      const reached = reach.map((mine) => mine[page - first]).filter((y): y is number => y !== undefined);
      if (rule === undefined || reached.length < lanes.length) continue;
      doc.switchToPage(page);
      rule(topOf(page), Math.max(...reached));
    }
    doc.switchToPage(last);
    this.y = Math.max(topOf(last), ...reach.map((mine) => mine[last - first] ?? 0));
  }

  /**
   * A paragraph that may cross pages. `beside` draws anything that runs
   * alongside each line (a rule in the margin), given the line's top and height.
   */
  paragraph(style: TextStyle, text: string, x: number, width: number, beside?: (top: number, height: number) => void): void {
    const height = lineHeight(this.doc, style, text);
    for (const line of wrapLines(this.doc, style, text, width)) {
      this.ensure(height);
      beside?.(this.y, height);
      drawLine(this.doc, style, line, x, this.y);
      this.y += height;
    }
  }
}
