import { describe, expect, it } from "vitest";
import PDFDocument from "pdfkit";
import { SHEET_FACES, faceFor, registerSheetFonts } from "../services/sheet-pdf/fonts.js";

// The sheet sets its type in the House faces, Newsreader and Inter, embedded
// from static instances the API ships (assets/fonts). A name Newsreader cannot
// set falls back to Inter of the same weight rather than printing boxes.

describe("sheet fonts", () => {
  it("registers every House face so the renderer can set text in it", () => {
    const doc = new PDFDocument({ size: "A4" });
    registerSheetFonts(doc);
    for (const face of SHEET_FACES) {
      doc.font(face);
      expect(doc.widthOfString("Mackenzie–Ross"), face).toBeGreaterThan(0);
    }
    doc.end();
  });

  it("keeps Newsreader for Latin names with accents and dashes", () => {
    expect(faceFor("Mackenzie–Ross Łódź Nguyễn", "Newsreader-Regular")).toBe("Newsreader-Regular");
    expect(faceFor("Café 13:30 £120", "Newsreader-DisplayLight")).toBe("Newsreader-DisplayLight");
  });

  it("sets Greek and Cyrillic in Inter of the matching weight", () => {
    expect(faceFor("Παπαδόπουλος", "Newsreader-Regular")).toBe("Inter-Regular");
    expect(faceFor("Παπαδόπουλος", "Newsreader-Italic")).toBe("Inter-Regular");
    expect(faceFor("Иванов", "Newsreader-Medium")).toBe("Inter-SemiBold");
    expect(faceFor("Иванов", "Inter-Medium")).toBe("Inter-Medium");
  });

  it("keeps the preferred face for scripts neither family sets, without throwing", () => {
    expect(faceFor("王小明", "Inter-Regular")).toBe("Inter-Regular");
    expect(faceFor("王小明", "Newsreader-Regular")).toBe("Inter-Regular");
  });
});
