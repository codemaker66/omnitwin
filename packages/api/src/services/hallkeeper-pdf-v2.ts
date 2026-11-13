import {
  describeSheetCopy,
  type HallkeeperSheetV2,
  venueWallClock,
  withPrintedAt,
} from "@omnitwin/types";
import { incrementCounter, observeHistogram } from "../observability/metrics.js";
import { brief, facts, footers, header, keepInView, martynsLaw, room, setupSteps, signOff, type CopyMarks } from "./sheet-pdf/blocks.js";
import { Flow, PAGE_OPTIONS } from "./sheet-pdf/flow.js";
import { registerSheetFonts } from "./sheet-pdf/fonts.js";

// ---------------------------------------------------------------------------
// The hallkeeper sheet, portrait A4: "the brief, then the room" (design:
// docs/superpowers/specs/2026-10-18-hallkeeper-sheet-redesign-design.md).
//
// Page 1 is the day: when the room must be ready, what to keep in view, the
// day in order and what to bring from the store, then the planner's words.
// The room follows, on page 1 when it fits at a readable size: the plan with
// the planner's table names and numbered notes, then the setup step by step,
// the sign-off and the Martyn's Law prompts. Every page says which copy it is.
//
// Rendered per signed-in request and never stored (routes/hallkeeper-sheet.ts):
// the sheet can carry allergy and access notes.
// ---------------------------------------------------------------------------

export async function generateSheetPdfV2(data: HallkeeperSheetV2): Promise<Buffer> {
  // Business-level metric: render count + duration histogram. Labels are
  // low-cardinality (approved / draft).
  const renderStart = process.hrtime.bigint();
  const approvalLabel = data.approval !== null ? "approved" : "draft";

  const PDFDocument = (await import("pdfkit")).default;
  const qrTarget = sheetQrTarget(data);
  const marks: CopyMarks = { qr: await qrModules(qrTarget.url), caption: qrTarget.caption, copyLine: sheetCopyLine(data) };

  return new Promise<Buffer>((resolve, reject) => {
    const chunks: Buffer[] = [];
    const fail = (err: unknown): void => {
      incrementCounter("hallkeeper_pdf_render_total", { status: "error", approval: approvalLabel });
      reject(err instanceof Error ? err : new Error(String(err)));
    };
    const doc = new PDFDocument({
      ...PAGE_OPTIONS,
      bufferPages: true, // footers are written once the page count is known
      lang: "en-GB",
      displayTitle: true,
      info: {
        Title: `Hallkeeper sheet — ${data.config.name}`,
        Author: "Venviewer",
        Subject: `${data.space.name} — ${data.venue.name}`,
      },
    });
    doc.on("data", (chunk: Buffer) => { chunks.push(chunk); });
    doc.on("end", () => {
      const durationSeconds = Number(process.hrtime.bigint() - renderStart) / 1_000_000_000;
      incrementCounter("hallkeeper_pdf_render_total", { status: "ok", approval: approvalLabel });
      observeHistogram("hallkeeper_pdf_render_duration_seconds", { approval: approvalLabel }, durationSeconds);
      resolve(Buffer.concat(chunks));
    });
    doc.on("error", fail);

    try {
      registerSheetFonts(doc);
      const flow = new Flow(doc);
      header(flow, data, marks);
      facts(flow, data);
      keepInView(flow, data);
      brief(flow, data);
      room(flow, data);
      setupSteps(flow, data);
      signOff(flow);
      martynsLaw(flow, data);
      footers(doc, data, marks.copyLine);
      doc.end();
    } catch (err) {
      fail(err);
    }
  });
}

/** The QR's modules as rows of "0"/"1", or null when the encoder fails. */
async function qrModules(url: string): Promise<string[] | null> {
  try {
    const QRCode = await import("qrcode");
    const { modules } = QRCode.create(url, { errorCorrectionLevel: "M" });
    const rows: string[] = [];
    for (let row = 0; row < modules.size; row++) {
      let line = "";
      for (let col = 0; col < modules.size; col++) line += modules.get(row, col) === 1 ? "1" : "0";
      rows.push(line);
    }
    return rows;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Paper that knows its version (services/sheet-paper-check.ts)
// ---------------------------------------------------------------------------

/**
 * What the page-1 QR code opens, and the line that says so. A served sheet
 * carries a paper check: its QR leads to the no-sign-in page that answers
 * only whether this copy is current, and carries this copy's printed minute
 * so that page can repeat it when there is no signal. Without one (an
 * encoder failure) the QR stays the sign-in link.
 */
export function sheetQrTarget(data: HallkeeperSheetV2): { readonly url: string; readonly caption: string } {
  if (data.paperCheck === undefined) {
    return { url: data.webViewUrl, caption: "Scan to open this sheet on a phone (sign-in needed)." };
  }
  const printed = venueWallClock(data.generatedAt, data.venue.timezone);
  return {
    url: printed === null ? data.paperCheck.url : withPrintedAt(data.paperCheck.url, printed),
    caption: "Scan to check this copy is current. No sign-in; the check shows nothing from this sheet.",
  };
}

/** The copy's version in words: "v7, issued 16 Oct 14:02, printed 17 Oct 06:02". */
export function sheetCopyLine(data: HallkeeperSheetV2): string {
  return describeSheetCopy({
    version: data.approval?.version ?? null,
    issuedAt: data.approval?.approvedAt ?? null,
    printedAt: data.generatedAt,
    timeZone: data.venue.timezone,
  });
}
