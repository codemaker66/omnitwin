import { pdfStream } from "../helpers/pdf-text.js";

/**
 * The words on each page of a PDFKit document, read from its real compressed
 * page-content streams (the approach hallkeeper-pdf-v2.test.ts uses), each by
 * its /Length through helpers/pdf-text.ts. One string per page; each text run
 * on its own line.
 */
export function pdfPageTexts(buf: Buffer): readonly string[] {
  const objects = new Map([...buf.toString("latin1").matchAll(/(\d+) 0 obj([\s\S]*?)endobj/gu)]
    .map((match) => [match[1] ?? "", match[2] ?? ""]));
  return [...objects.values()].filter((body) => /\/Type \/Page\b/u.test(body)).map((page) => {
    const contentId = /\/Contents (\d+) 0 R/u.exec(page)?.[1];
    const content = pdfStream(objects.get(contentId ?? "") ?? "");
    return [...content.matchAll(/BT([\s\S]*?)ET/gu)].map((block) =>
      [...(block[1] ?? "").matchAll(/<([a-f0-9]+)>/giu)]
        .map((match) => Buffer.from(match[1] ?? "", "hex").toString("latin1")).join(""),
    ).join("\n");
  });
}
