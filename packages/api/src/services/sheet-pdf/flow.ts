import { PAGE, lineHeight, wrapLines, drawLine, type Doc, type TextStyle } from "./style.js";

// ---------------------------------------------------------------------------
// The vertical cursor down the sheet. Every block asks for the room it needs
// before drawing, so nothing is cut by the footer and a heading never sits
// alone at the foot of a page; only paragraphs break mid-block, line by line.
// ---------------------------------------------------------------------------

export const PAGE_OPTIONS: PDFKit.PDFDocumentOptions = { size: [PAGE.width, PAGE.height], margin: 0 };

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
