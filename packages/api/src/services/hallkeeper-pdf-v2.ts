import type { HallkeeperSheetV2, SetupPhase } from "@omnitwin/types";

// ---------------------------------------------------------------------------
// Hallkeeper PDF V2 — portrait A4, phase/zone layout
//
// Renders a print-safe PDF matching the web page's phase-zone hierarchy:
// header, diagram, per-phase sections with zone subheaders and rows
// sorted by afterDepth, totals summary, footer with QR.
//
// All rendering is inlined in one Promise callback so `doc` inherits its
// type from the pdfkit dynamic import — pdfkit doesn't ship .d.ts files
// so extracting render helpers would require a hand-rolled interface that
// drifts from the real API (ask me how I know).
// ---------------------------------------------------------------------------

const A4_W = 595.28;
const A4_H = 841.89;
const MARGIN = 40;
const CONTENT_W = A4_W - MARGIN * 2;

const GOLD = "#b8982f";
const INK = "#1a1a1a";
const INK_DIM = "#555555";
const INK_FAINT = "#999999";
const RULE = "#d0c8b0";

const PHASE_META: Readonly<Record<SetupPhase, { label: string; order: number }>> = {
  structure: { label: "Structure", order: 1 },
  furniture: { label: "Furniture", order: 2 },
  dress: { label: "Dress", order: 3 },
  technical: { label: "Technical", order: 4 },
  final: { label: "Final Touches", order: 5 },
};

export async function generateSheetPdfV2(data: HallkeeperSheetV2): Promise<Buffer> {
  const PDFDocument = (await import("pdfkit")).default;

  const [qrBuffer, diagramBuffer] = await Promise.all([
    generateQr(data.webViewUrl, 120),
    data.diagramUrl !== null ? Promise.resolve(decodeDataUrl(data.diagramUrl)) : Promise.resolve(null),
  ]);

  return new Promise<Buffer>((resolve, reject) => {
    const chunks: Buffer[] = [];
    const doc = new PDFDocument({
      size: [A4_W, A4_H],
      margin: MARGIN,
      info: {
        Title: `Hallkeeper Sheet — ${data.config.name}`,
        Author: "OMNITWIN",
        Subject: `${data.space.name} — ${data.venue.name}`,
      },
    });
    doc.on("data", (chunk: Buffer) => { chunks.push(chunk); });
    doc.on("end", () => { resolve(Buffer.concat(chunks)); });
    doc.on("error", reject);

    // =================================================================
    // HEADER
    // =================================================================
    doc.font("Helvetica-Bold").fontSize(7).fillColor(GOLD);
    doc.text("HALLKEEPER SHEET", MARGIN, MARGIN);

    doc.font("Helvetica-Bold").fontSize(20).fillColor(INK);
    doc.text(data.config.name, MARGIN, MARGIN + 14, { width: CONTENT_W });

    const infoY = MARGIN + 42;
    doc.font("Helvetica").fontSize(9).fillColor(INK_DIM);
    doc.text(
      `${data.venue.name}  ·  ${data.space.name}  ·  ${fmtDims(data.space)}`,
      MARGIN, infoY,
    );
    doc.text(
      `${String(data.config.guestCount)} guests  ·  ${fmtLayout(data.config.layoutStyle)}`,
      MARGIN, infoY + 12,
    );

    if (data.timing !== null) {
      doc.font("Helvetica-Bold").fontSize(9).fillColor(GOLD);
      doc.text(
        `Setup by ${fmtTime(data.timing.setupBy)}  ·  Event ${fmtTime(data.timing.eventStart)}`,
        MARGIN, infoY + 26,
      );
    }

    const ruleY = data.timing !== null ? infoY + 42 : infoY + 28;
    doc.moveTo(MARGIN, ruleY).lineTo(A4_W - MARGIN, ruleY)
      .strokeColor(GOLD).lineWidth(1.5).stroke();
    doc.y = ruleY + 10;

    // =================================================================
    // DIAGRAM
    // =================================================================
    const diagH = 180;
    const diagY = doc.y;

    if (diagramBuffer !== null) {
      doc.image(diagramBuffer, MARGIN, diagY, {
        width: CONTENT_W, height: diagH,
        fit: [CONTENT_W, diagH], align: "center", valign: "center",
      });
    } else {
      doc.save();
      doc.rect(MARGIN, diagY, CONTENT_W, diagH)
        .strokeColor(RULE).lineWidth(0.5).stroke();
      doc.font("Helvetica").fontSize(10).fillColor(INK_FAINT);
      doc.text("Floor plan diagram", MARGIN, diagY + diagH / 2 - 6, { width: CONTENT_W, align: "center" });
      doc.fontSize(8).fillColor("#bbbbbb");
      doc.text("Generate from the 3D editor", MARGIN, diagY + diagH / 2 + 8, { width: CONTENT_W, align: "center" });
      doc.restore();
    }
    doc.y = diagY + diagH + 18;

    // =================================================================
    // PHASES
    // =================================================================
    for (const phase of data.phases) {
      if (phase.zones.length === 0) continue;
      const meta = PHASE_META[phase.phase];

      // Page break guard — keep header + >=1 row together
      if (doc.y + 60 > A4_H - 80) doc.addPage();

      doc.font("Helvetica-Bold").fontSize(11).fillColor(INK);
      doc.text(`Phase ${String(meta.order)} — ${meta.label}`, MARGIN, doc.y);
      doc.moveTo(MARGIN, doc.y + 2).lineTo(A4_W - MARGIN, doc.y + 2)
        .strokeColor(RULE).lineWidth(0.5).stroke();
      doc.y += 12;

      for (const zoneGroup of phase.zones) {
        if (doc.y + 30 > A4_H - 80) doc.addPage();

        doc.font("Helvetica-Bold").fontSize(8).fillColor(INK_DIM);
        doc.text(`▹  ${zoneGroup.zone.toUpperCase()}`, MARGIN + 4, doc.y);
        doc.y += 12;

        for (const row of zoneGroup.rows) {
          if (doc.y + 16 > A4_H - 80) doc.addPage();

          const rowY = doc.y;
          const indent = row.afterDepth > 0 ? 20 : 0;

          // Empty checkbox for pen
          doc.save();
          doc.rect(MARGIN + 8 + indent, rowY + 1, 8, 8)
            .strokeColor(INK).lineWidth(0.8).stroke();
          doc.restore();

          // Name
          const textX = MARGIN + 24 + indent;
          const qtyColW = 50;
          const nameW = CONTENT_W - (textX - MARGIN) - qtyColW;
          doc.font(row.isAccessory ? "Helvetica" : "Helvetica-Bold")
            .fontSize(9).fillColor(INK);
          doc.text(row.name, textX, rowY, { width: nameW });

          if (row.afterDepth > 0) {
            doc.font("Helvetica").fontSize(7).fillColor(GOLD);
            doc.text("after", textX + nameW - 24, rowY + 2, { width: 24 });
          }

          // Qty
          doc.font("Helvetica-Bold").fontSize(10).fillColor(GOLD);
          doc.text(`×${String(row.qty)}`, A4_W - MARGIN - qtyColW, rowY, { width: qtyColW, align: "right" });

          doc.y = rowY + 14;
        }
        doc.y += 4;
      }
      doc.y += 10;
    }

    // =================================================================
    // TOTALS
    // =================================================================
    if (data.totals.entries.length > 0) {
      if (doc.y + 40 > A4_H - 80) doc.addPage();
      doc.moveTo(MARGIN, doc.y).lineTo(A4_W - MARGIN, doc.y)
        .strokeColor(GOLD).lineWidth(1).stroke();
      doc.y += 6;
      doc.font("Helvetica-Bold").fontSize(10).fillColor(INK);
      doc.text(
        `TOTALS  —  ${String(data.totals.totalItems)} items across ${String(data.totals.totalRows)} rows`,
        MARGIN, doc.y,
      );
      doc.y += 14;
      doc.font("Helvetica").fontSize(8).fillColor(INK_DIM);
      const parts = data.totals.entries.map((e) => `${String(e.qty)}× ${e.name}`).join("  ·  ");
      doc.text(parts, MARGIN, doc.y, { width: CONTENT_W });
      doc.y += 16;
    }

    // =================================================================
    // FOOTER
    // =================================================================
    const footerY = A4_H - 60;
    doc.moveTo(MARGIN, footerY).lineTo(A4_W - MARGIN, footerY)
      .strokeColor(RULE).lineWidth(0.5).stroke();

    if (qrBuffer !== null) {
      doc.image(qrBuffer, MARGIN, footerY + 6, { width: 42, height: 42 });
      doc.font("Helvetica").fontSize(6.5).fillColor(INK_FAINT);
      doc.text("Scan for web view", MARGIN, footerY + 50, { width: 42, align: "center" });
    }

    const genTime = new Date(data.generatedAt).toLocaleString("en-GB", {
      day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit",
    });
    doc.font("Helvetica").fontSize(7).fillColor(INK_FAINT);
    doc.text(
      `Generated by OMNITWIN · ${genTime}`,
      MARGIN + 60, footerY + 16, { width: CONTENT_W - 60, align: "right" },
    );
    doc.text(
      `${data.venue.name} · ${data.venue.address}`,
      MARGIN + 60, footerY + 28, { width: CONTENT_W - 60, align: "right" },
    );

    doc.end();
  });
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function fmtTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });
}

function fmtDims(space: { widthM: number; lengthM: number; heightM: number }): string {
  return `${String(space.widthM)}m × ${String(space.lengthM)}m × ${String(space.heightM)}m`;
}

function fmtLayout(style: string): string {
  return style.replace(/[-_]/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

function decodeDataUrl(url: string): Buffer | null {
  if (!url.startsWith("data:image/")) return null;
  const commaIdx = url.indexOf(",");
  if (commaIdx < 0) return null;
  try {
    return Buffer.from(url.slice(commaIdx + 1), "base64");
  } catch {
    return null;
  }
}

async function generateQr(url: string, size: number): Promise<Buffer | null> {
  try {
    const QRCode = await import("qrcode");
    const dataUrl = await QRCode.toDataURL(url, {
      width: size, margin: 1,
      color: { dark: "#333333", light: "#ffffff" },
    });
    const base64 = dataUrl.split(",")[1];
    if (base64 === undefined) return null;
    return Buffer.from(base64, "base64");
  } catch {
    return null;
  }
}
