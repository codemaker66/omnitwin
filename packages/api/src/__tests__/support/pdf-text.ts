import { inflateSync } from "node:zlib";

/**
 * The words on each page of a PDFKit document, read from its real compressed
 * page-content streams (the approach hallkeeper-pdf-v2.test.ts uses). One
 * string per page; each text run on its own line.
 */
export function pdfPageTexts(buf: Buffer): readonly string[] {
  const objects = new Map([...buf.toString("latin1").matchAll(/(\d+) 0 obj([\s\S]*?)endobj/gu)]
    .map((match) => [match[1] ?? "", match[2] ?? ""]));
  return [...objects.values()].filter((body) => /\/Type \/Page\b/u.test(body)).map((page) => {
    const contentId = /\/Contents (\d+) 0 R/u.exec(page)?.[1];
    const body = objects.get(contentId ?? "") ?? "";
    const stream = /stream\r?\n([\s\S]*?)\r?\nendstream/u.exec(body)?.[1];
    if (stream === undefined) throw new Error("PDF page has no content stream");
    const content = inflateSync(Buffer.from(stream, "latin1")).toString("latin1");
    return [...content.matchAll(/BT([\s\S]*?)ET/gu)].map((block) =>
      [...(block[1] ?? "").matchAll(/<([a-f0-9]+)>/giu)]
        .map((match) => Buffer.from(match[1] ?? "", "hex").toString("latin1")).join(""),
    ).join("\n");
  });
}
