import { describe, expect, it } from "vitest";
import PDFDocument from "pdfkit";
import { registerSheetFonts } from "../../services/sheet-pdf/fonts.js";
import { pdfImageCount, pdfPageSizes, pdfPages, pdfText } from "./pdf-text.js";

// The sheet embeds subset TrueType fonts, so its content streams hold glyph
// codes, not characters. The helper maps them back through each font's
// ToUnicode table, which is also what a screen reader or a search does.

async function render(draw: (doc: PDFKit.PDFDocument) => void): Promise<Buffer> {
  const doc = new PDFDocument({ size: "A4", margin: 0 });
  registerSheetFonts(doc);
  const chunks: Buffer[] = [];
  const done = new Promise<Buffer>((resolve, reject) => {
    doc.on("data", (chunk: Buffer) => { chunks.push(chunk); });
    doc.on("end", () => { resolve(Buffer.concat(chunks)); });
    doc.on("error", reject);
  });
  draw(doc);
  doc.end();
  return done;
}

describe("pdf text helper", () => {
  it("reads embedded-font text, its position, size, face and width back out, page by page", async () => {
    let measured = 0;
    const buf = await render((doc) => {
      doc.font("Inter-SemiBold").fontSize(12);
      measured = doc.widthOfString("Ready by 13:30");
      doc.text("Ready by 13:30", 40, 100, { lineBreak: false });
      doc.font("Newsreader-Regular").fontSize(20).text("Łódź", 300, 200, { lineBreak: false });
      doc.addPage({ size: "A4", margin: 0 });
      doc.font("Inter-Regular").fontSize(9).text("Παπαδόπουλος", 40, 700, { lineBreak: false });
    });
    const pages = pdfPages(buf);
    expect(pages).toHaveLength(2);
    const ready = pages[0]?.find((line) => line.text === "Ready by 13:30");
    expect(ready).toMatchObject({ x: 40, size: 12 });
    expect(ready?.font).toMatch(/InterSheet-SemiBold$/u);
    expect(Math.abs((ready?.y ?? 0) - (841.89 - 100))).toBeLessThan(15);
    expect(ready?.width ?? 0).toBeCloseTo(measured, 1);
    expect(pages[0]?.find((line) => line.text === "Łódź")?.font).toMatch(/NewsreaderSheet-Regular$/u);
    expect(pages[1]?.map((line) => line.text)).toEqual(["Παπαδόπουλος"]);
    expect(pdfText(buf)).toBe("Ready by 13:30 Łódź Παπαδόπουλος");
    expect(pdfPageSizes(buf)).toEqual([{ width: 595.28, height: 841.89 }, { width: 595.28, height: 841.89 }]);
    expect(pdfImageCount(buf)).toBe(0);
  });

  it("counts embedded images", async () => {
    const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/RZkAAAAASUVORK5CYII=", "base64");
    expect(pdfImageCount(await render((doc) => { doc.image(png, 10, 10, { width: 20 }); }))).toBe(1);
  });
});
