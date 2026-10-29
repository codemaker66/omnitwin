import { deflateSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import PDFDocument from "pdfkit";
import { registerSheetFonts } from "../../services/sheet-pdf/fonts.js";
import { pdfImageCount, pdfPageSizes, pdfPages, pdfRules, pdfText } from "./pdf-text.js";

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

  it("places rotated text where it lands on the page", async () => {
    const buf = await render((doc) => {
      doc.font("Inter-Regular").fontSize(10);
      doc.save().rotate(-90, { origin: [50, 400] });
      doc.text("West wall", 30, 395, { lineBreak: false });
      doc.restore();
    });
    const line = pdfPages(buf)[0]?.[0];
    // Turned a quarter anticlockwise about (50, 400): the run now climbs the
    // page at about x = 50, from y ≈ 420 (page coordinates, top-down) upwards.
    expect(line?.x).toBeGreaterThan(45);
    expect(line?.x).toBeLessThan(60);
    expect(line?.x2).toBeCloseTo(line?.x ?? 0, 0);
    expect((line?.y2 ?? 0) - (line?.y ?? 0)).toBeCloseTo(line?.width ?? 0, 0);
  });

  it("counts embedded images", async () => {
    const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/RZkAAAAASUVORK5CYII=", "base64");
    expect(pdfImageCount(await render((doc) => { doc.image(png, 10, 10, { width: 20 }); }))).toBe(1);
  });

  it("reads a compressed stream whose last byte is a carriage return", () => {
    // About one compressed stream in 256 ends in 0x0D; a reader that finds the
    // stream's end by "\r?\nendstream" drops that byte and cannot inflate it.
    let content = "";
    for (let n = 0; ; n++) {
      content = `40 100 m\n555.28 100 l\nS\n% ${String(n)}`;
      if (deflateSync(content).at(-1) === 0x0d) break;
    }
    const data = deflateSync(content);
    const head = "%PDF-1.3\n1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595.28 841.89] /Contents 4 0 R /Resources << >> >>\nendobj\n";
    const stream = `4 0 obj\n<< /Length ${String(data.length)} /Filter /FlateDecode >>\nstream\n`;
    const buf = Buffer.concat([Buffer.from(head + stream, "latin1"), data, Buffer.from("\nendstream\nendobj\n%%EOF\n", "latin1")]);
    expect(pdfRules(buf)).toEqual([[{ x: 40, x2: 555.28, y: 100 }]]);
  });

  it("finds each page's horizontal rules where they land, and nothing else", async () => {
    const buf = await render((doc) => {
      doc.save().moveTo(40, 120).lineTo(555.28, 120).lineWidth(0.6).stroke().restore();
      doc.save().moveTo(300, 50).lineTo(300, 90).stroke().restore();
      doc.save().rect(100, 300, 50, 20).stroke().restore();
      doc.save().moveTo(60, 400).lineTo(160, 400).lineTo(160, 450).stroke().restore();
      doc.addPage({ size: "A4", margin: 0 });
      doc.save().moveTo(40, 32).lineTo(555.28, 32).stroke().restore();
    });
    const pages = pdfRules(buf);
    expect(pages).toHaveLength(2);
    expect(pages[0]).toEqual([{ x: 40, x2: 555.28, y: expect.closeTo(841.89 - 120, 2) as number }]);
    expect(pages[1]).toEqual([{ x: 40, x2: 555.28, y: expect.closeTo(841.89 - 32, 2) as number }]);
  });
});
