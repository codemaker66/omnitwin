import { describe, expect, it } from "vitest";
import PDFDocument from "pdfkit";
import { registerSheetFonts } from "../services/sheet-pdf/fonts.js";
import { PAGE, TYPE, balancedLines, drawLine, textWidth, wrapLines } from "../services/sheet-pdf/style.js";
import { pdfPages } from "./helpers/pdf-text.js";

// The sheet wraps its own text, so a planner's pasted link or a paragraph of
// Chinese (no spaces) must break between characters quickly, keep every
// character, and never split one in two.

function doc(): PDFKit.PDFDocument {
  const d = new PDFDocument({ size: "A4", margin: 0 });
  registerSheetFonts(d);
  return d;
}

describe("wrapLines on text without spaces", () => {
  it("breaks a 4,000-character word quickly, every line inside the width, nothing lost", () => {
    const d = doc();
    const word = "https://example.com/" + "a1b2c3d4e5".repeat(398);
    const started = performance.now();
    const lines = wrapLines(d, TYPE.paragraph, word, 300);
    expect(performance.now() - started).toBeLessThan(1500);
    expect(lines.join("")).toBe(word);
    for (const line of lines) expect(textWidth(d, TYPE.paragraph, line)).toBeLessThanOrEqual(300);
    d.end();
  });

  it("still advances when one glyph is wider than the line", () => {
    const d = doc();
    expect(wrapLines(d, TYPE.paragraph, "WWWW", 1)).toEqual(["W", "W", "W", "W"]);
    d.end();
  });

  it("never splits a character made of two code units", () => {
    const d = doc();
    const text = "🍽️🥂".repeat(30);
    const lines = wrapLines(d, TYPE.paragraph, text, 40);
    expect(lines.join("")).toBe(text);
    for (const line of lines) expect(line).not.toMatch(/^[\uDC00-\uDFFF]|[\uD800-\uDBFF]$/u);
    d.end();
  });
});

describe("lines a reader takes in at a glance", () => {
  it("keeps a middle dot with the word before it, so no line starts with one", () => {
    const d = doc();
    const text = "Other meals: 14 vegetarian · 4 vegan · 3 halal · 2 kosher";
    for (let width = 60; width <= 300; width += 4) {
      const lines = wrapLines(d, TYPE.bodyDim, text, width);
      expect(lines.join(" ")).toBe(text);
      for (const line of lines) expect(line.startsWith("·"), `${String(width)} pt: "${line}"`).toBe(false);
    }
    d.end();
  });

  it("evens out a short last line, keeping the line count and the width", () => {
    const d = doc();
    const text = "severe peanut allergy, carries an adrenaline pen.";
    const plain = wrapLines(d, TYPE.careWords, text, 178);
    const even = balancedLines(d, TYPE.careWords, text, 178);
    expect(plain).toHaveLength(2);
    expect(even).toHaveLength(2);
    expect(even.join(" ")).toBe(text);
    expect(textWidth(d, TYPE.careWords, even[1] ?? "")).toBeGreaterThan(textWidth(d, TYPE.careWords, plain[1] ?? ""));
    for (const line of even) expect(textWidth(d, TYPE.careWords, line)).toBeLessThanOrEqual(178);
    d.end();
  });

  it("leaves a single line as it is", () => {
    const d = doc();
    expect(balancedLines(d, TYPE.careWords, "two guests coeliac.", 178)).toEqual(["two guests coeliac."]);
    d.end();
  });

  it("never breaks a word to even the lines out, where plain wrapping kept it whole", () => {
    const d = doc();
    // The page 2 rail's inner width, then page 1's Keep in view.
    for (const width of [127, 166]) {
      for (const [style, text] of [
        [TYPE.careWords, "anaphylaxis-sufferer carries two pens."],
        [TYPE.careWords, "immunocompromised guest, keep apart."],
        [TYPE.careWords, "gluten-free/dairy-free meals needed."],
        [TYPE.careWords, "Wheelchair-accessible table near the door."],
        [TYPE.contactName, "Montgomery-Fitzwilliam Alexandria"],
      ] as const) {
        const plain = wrapLines(d, style, text, width);
        const even = balancedLines(d, style, text, width);
        expect(even.join(" "), `${text} at ${String(width)} pt`).toBe(plain.join(" "));
        expect(even).toHaveLength(plain.length);
      }
    }
    d.end();
  });

  it("keeps a middle dot off a line's start after a word too long for the line", () => {
    const d = doc();
    const text = "alexandria.montgomery-fitzwilliam@example.co.uk · Bride's sister";
    for (let width = 30; width <= 240; width += 1) {
      for (const line of wrapLines(d, TYPE.bodyDim, text, width)) {
        expect(line.trimStart().startsWith("·"), `${String(width)} pt: "${line}"`).toBe(false);
      }
    }
    d.end();
  });
});

describe("a count kept to its tables (#443's review, HG3)", () => {
  // The setup page's place column: the steps' lane beside the rail, less the step numerals' indent, a third of it.
  const placeW = Math.min(150, (PAGE.contentWidth - Math.round(PAGE.contentWidth * 0.29) - 16 - 30) * 0.32);

  it("breaks a seat note only at a plain space, so a no-break space keeps the count at each with its last table", () => {
    const d = doc();
    const text = "80 at Tables 1–4, 6–9, 13\u00A0(10\u00A0each) · 10 at Top table";
    expect(placeW).toBeCloseTo(102.49, 2);
    expect(wrapLines(d, TYPE.where, text, placeW).length).toBeGreaterThan(1);
    for (let width = 60; width <= 200; width += 0.5) {
      const lines = wrapLines(d, TYPE.where, text, width);
      expect(lines.join(" "), `${String(width)} pt`).toBe(text);
      expect(lines.some((line) => line.includes("13\u00A0(10\u00A0each)")), `${String(width)} pt: ${JSON.stringify(lines)}`).toBe(true);
      for (const line of lines) expect(/^(?:each|\(|·)/u.test(line), `${String(width)} pt: "${line}"`).toBe(false);
    }
    d.end();
  });

  it("still breaks at a tab as at a space", () => {
    const d = doc();
    expect(textWidth(d, TYPE.where, "Tables")).toBeLessThan(32);
    expect(wrapLines(d, TYPE.where, "Tables\t1–11", 32)).toEqual(["Tables", "1–11"]);
    d.end();
  });

  it("ties only at U+00A0, so a narrow no-break or figure space, which no House face sets, breaks as a space (#443's second review, HI1)", () => {
    const d = doc();
    expect(wrapLines(d, TYPE.where, "Tables\u202F1–11", 32)).toEqual(["Tables", "1–11"]);
    expect(wrapLines(d, TYPE.where, "Tables\u20071–11", 32)).toEqual(["Tables", "1–11"]);
    expect(wrapLines(d, TYPE.where, "Tables\u00A01–11", 32).join("")).not.toContain(" ");
    d.end();
  });

  it("breaks a tied place wider than its line at its own no-break spaces, the bracket whole, between characters only as the last resort (HI4)", () => {
    const d = doc();
    const text = "16 at Bridesmaids-and-ushers, Family-of-the-groom\u00A0(8\u00A0each)";
    const lines = wrapLines(d, TYPE.where, text, placeW);
    expect(textWidth(d, TYPE.where, "Family-of-the-groom\u00A0(8\u00A0each)")).toBeGreaterThan(placeW);
    // Every word whole, the line broken before the bracket.
    expect(lines.flatMap((line) => line.split(/[ \u00A0]/u))).toEqual(text.split(/[ \u00A0]/u));
    expect(lines.slice(-2)).toEqual(["Family-of-the-groom", "(8\u00A0each)"]);
    // A name with nowhere to break is cut between its characters, its bracket still whole after it.
    const unbroken = `16 at ${"Grandparents".repeat(4)}\u00A0(8\u00A0each)`;
    const cut = wrapLines(d, TYPE.where, unbroken, placeW);
    expect(cut.join("").split(/[ \u00A0]/u).join("")).toBe(unbroken.split(/[ \u00A0]/u).join(""));
    expect(cut[cut.length - 1]).toBe("(8\u00A0each)");
    for (const line of cut) expect(textWidth(d, TYPE.where, line), line).toBeLessThanOrEqual(placeW);
    d.end();
  });
});

describe("characters no House face sets", () => {
  it("prints each missing-glyph box as wide as it was measured, so the line ends where it was laid out", async () => {
    const d = doc();
    const chunks: Buffer[] = [];
    const done = new Promise<Buffer>((resolve) => {
      d.on("data", (chunk: Buffer) => { chunks.push(chunk); });
      d.on("end", () => { resolve(Buffer.concat(chunks)); });
    });
    const text = "山田家 🎂 Table 4";
    const measured = textWidth(d, TYPE.body, text);
    drawLine(d, TYPE.body, text, 40, 100);
    d.end();
    const line = pdfPages(await done)[0]?.[0];
    expect(line?.x2 ?? 0).toBeCloseTo(40 + measured, 1);
  });
});
