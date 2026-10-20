import { describe, expect, it } from "vitest";
import PDFDocument from "pdfkit";
import { registerSheetFonts } from "../services/sheet-pdf/fonts.js";
import { TYPE, textWidth, wrapLines } from "../services/sheet-pdf/style.js";

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
