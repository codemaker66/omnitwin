import {
  PHASE_METADATA,
  type EventInstructions,
  type HallkeeperSheetV2,
  type ManifestRowV2,
} from "@omnitwin/types";

// `PDFKit` comes from the global namespace declared in @types/pdfkit.
type Doc = PDFKit.PDFDocument;

// ---------------------------------------------------------------------------
// Hallkeeper PDF V2 — portrait A4, operations-grade events sheet
//
// Design principles (these drive every visual decision):
//
//   1. SCANABILITY. The hallkeeper is standing up, holding a clipboard,
//      reading in mixed lighting. Every section must be findable in 3
//      seconds. Phase headers are bold + ruled; zone subheaders are
//      indented + caps; rows alternate shade for eye-tracking.
//
//   2. PEN-FRIENDLINESS. The checkbox squares are 3.5mm — large enough
//      for a Sharpie tick. Row height is 5mm minimum. The sign-off
//      area at the bottom has a ruled line for a signature.
//
//   3. AUTHORITY. This is an operational document handed to venue staff.
//      It should look like it came from a professional events system,
//      not a dev tool. Structured info grid, gold accent rule, page
//      numbers, venue address in the footer.
//
//   4. MULTI-PAGE. Long manifests (50+ rows for a large wedding) must
//      page-break cleanly. Phase headers never orphan at the bottom.
//      Page numbers show "Page 1 of N". The footer repeats on every
//      page so a dropped page can be re-filed.
// ---------------------------------------------------------------------------

const A4_W = 595.28;
const A4_H = 841.89;
const MARGIN = 36;
const CONTENT_W = A4_W - MARGIN * 2;

const GOLD = "#b8982f";
const GOLD_LIGHT = "#d4b84a";
const INK = "#1a1a1a";
const INK_DIM = "#555555";
const INK_FAINT = "#999999";
const RULE = "#d0c8b0";
const ROW_SHADE = "#f7f5f0";

const ROW_H = 16;
const FOOTER_H = 50;

export async function generateSheetPdfV2(data: HallkeeperSheetV2): Promise<Buffer> {
  const PDFDocument = (await import("pdfkit")).default;

  const [qrBuffer, diagramBuffer] = await Promise.all([
    generateQr(data.webViewUrl, 120),
    data.diagramUrl !== null ? Promise.resolve(decodeDataUrl(data.diagramUrl)) : Promise.resolve(null),
  ]);

  return new Promise<Buffer>((resolve, reject) => {
    const chunks: Buffer[] = [];
    let pageCount = 0;

    const doc = new PDFDocument({
      size: [A4_W, A4_H],
      margin: MARGIN,
      bufferPages: true, // enables page count + footer on every page
      info: {
        Title: `Hallkeeper Sheet — ${data.config.name}`,
        Author: "OMNITWIN",
        Subject: `${data.space.name} — ${data.venue.name}`,
      },
    });
    doc.on("data", (chunk: Buffer) => { chunks.push(chunk); });
    doc.on("end", () => { resolve(Buffer.concat(chunks)); });
    doc.on("error", reject);
    doc.on("pageAdded", () => { pageCount++; });
    pageCount = 1; // first page

    // =================================================================
    // PAGE 1: HEADER
    // =================================================================

    // Gold accent bar at the very top
    doc.save();
    doc.rect(0, 0, A4_W, 4).fill(GOLD);
    doc.restore();

    // "HALLKEEPER SHEET" label
    doc.font("Helvetica-Bold").fontSize(7).fillColor(GOLD);
    doc.text("HALLKEEPER SHEET", MARGIN, MARGIN - 4);

    // Event name — the most prominent text on the page
    doc.font("Helvetica-Bold").fontSize(22).fillColor(INK);
    doc.text(data.config.name, MARGIN, MARGIN + 10, { width: CONTENT_W - 80 });

    // Guest count — large number, right-aligned
    doc.font("Helvetica-Bold").fontSize(36).fillColor(INK);
    doc.text(String(data.config.guestCount), A4_W - MARGIN - 70, MARGIN + 4, { width: 70, align: "right" });
    doc.font("Helvetica").fontSize(7).fillColor(INK_FAINT);
    doc.text("GUESTS", A4_W - MARGIN - 70, MARGIN + 38, { width: 70, align: "right" });

    // Info grid — structured 2×2 layout below the title
    const gridY = MARGIN + 48;
    const col1X = MARGIN;
    const col2X = MARGIN + CONTENT_W / 2;

    doc.font("Helvetica").fontSize(8).fillColor(INK_FAINT);
    doc.text("Venue", col1X, gridY);
    doc.font("Helvetica-Bold").fontSize(9).fillColor(INK);
    doc.text(data.venue.name, col1X, gridY + 10);

    doc.font("Helvetica").fontSize(8).fillColor(INK_FAINT);
    doc.text("Room", col2X, gridY);
    doc.font("Helvetica-Bold").fontSize(9).fillColor(INK);
    doc.text(`${data.space.name}  ·  ${fmtDims(data.space)}`, col2X, gridY + 10);

    doc.font("Helvetica").fontSize(8).fillColor(INK_FAINT);
    doc.text("Layout", col1X, gridY + 26);
    doc.font("Helvetica-Bold").fontSize(9).fillColor(INK);
    doc.text(fmtLayout(data.config.layoutStyle), col1X, gridY + 36);

    doc.font("Helvetica").fontSize(8).fillColor(INK_FAINT);
    doc.text("Items", col2X, gridY + 26);
    doc.font("Helvetica-Bold").fontSize(9).fillColor(INK);
    doc.text(`${String(data.totals.totalItems)} items across ${String(data.totals.totalRows)} rows`, col2X, gridY + 36);

    // Timing callout box (if timing is available)
    let headerBottom = gridY + 52;
    if (data.timing !== null) {
      const deadlines = data.instructions?.phaseDeadlines ?? [];
      const hasDeadlines = deadlines.length > 0;
      const boxH = hasDeadlines ? 50 : 28;
      const boxY = headerBottom + 4;
      doc.save();
      doc.roundedRect(MARGIN, boxY, CONTENT_W, boxH, 4)
        .fillAndStroke("#faf8f2", GOLD_LIGHT);
      doc.restore();
      doc.font("Helvetica-Bold").fontSize(10).fillColor(GOLD);
      doc.text(
        `Setup by ${fmtTime(data.timing.setupBy)}`,
        MARGIN + 12, boxY + 8,
      );
      doc.font("Helvetica").fontSize(9).fillColor(INK_DIM);
      doc.text(
        `Event starts ${fmtTime(data.timing.eventStart)}  ·  ${String(data.timing.bufferMinutes)} min buffer`,
        MARGIN + 160, boxY + 9,
      );

      if (hasDeadlines) {
        // Mini per-phase deadline chart — one chip per deadline, ordered
        // by phase. Keeps the hallkeeper's eye on the milestones that
        // matter for this specific event.
        doc.font("Helvetica").fontSize(7).fillColor(INK_FAINT);
        doc.text("PHASE DEADLINES", MARGIN + 12, boxY + 26);
        const chipsY = boxY + 36;
        const sortedDeadlines = [...deadlines].sort(
          (a, b) => PHASE_METADATA[a.phase].order - PHASE_METADATA[b.phase].order,
        );
        let chipX = MARGIN + 12;
        for (const d of sortedDeadlines) {
          const label = `${PHASE_METADATA[d.phase].label} · ${fmtTime(d.deadline)}`;
          const w = doc.widthOfString(label) + 12;
          if (chipX + w > A4_W - MARGIN - 12) break;
          doc.save();
          doc.roundedRect(chipX, chipsY, w, 11, 2).fillAndStroke("#ffffff", GOLD_LIGHT);
          doc.restore();
          doc.font("Helvetica").fontSize(7.5).fillColor(GOLD);
          doc.text(label, chipX + 6, chipsY + 2.5);
          chipX += w + 6;
        }
      }

      headerBottom = boxY + boxH + 8;
    }

    // Gold rule below header
    doc.moveTo(MARGIN, headerBottom).lineTo(A4_W - MARGIN, headerBottom)
      .strokeColor(GOLD).lineWidth(1.5).stroke();
    doc.y = headerBottom + 10;

    // =================================================================
    // INSTRUCTIONS SECTION — planner's human layer
    //
    // Only rendered if the planner has filled in any instruction content.
    // Three sub-blocks, each independently optional:
    //   - Special instructions (free-form paragraph, gold-accented box)
    //   - Day-of contact (name + role + phone + email)
    //   - Access notes (service entrance, parking, load-in rules)
    //
    // Rendered BEFORE the diagram so the hallkeeper reads it first.
    // =================================================================
    if (data.instructions !== null) {
      renderInstructions(doc, data.instructions);
    }

    // =================================================================
    // DIAGRAM
    // =================================================================
    const diagH = 160;
    const diagY = doc.y;

    if (diagramBuffer !== null) {
      doc.image(diagramBuffer, MARGIN, diagY, {
        width: CONTENT_W, height: diagH,
        fit: [CONTENT_W, diagH], align: "center", valign: "center",
      });
      doc.save();
      doc.rect(MARGIN, diagY, CONTENT_W, diagH)
        .strokeColor("#e0e0e0").lineWidth(0.5).stroke();
      doc.restore();
    } else {
      doc.save();
      doc.rect(MARGIN, diagY, CONTENT_W, diagH)
        .strokeColor(RULE).lineWidth(0.5).stroke();
      doc.font("Helvetica").fontSize(9).fillColor(INK_FAINT);
      doc.text("Floor plan diagram — generate from the 3D editor", MARGIN, diagY + diagH / 2 - 5, { width: CONTENT_W, align: "center" });
      doc.restore();
    }
    doc.y = diagY + diagH + 14;

    // =================================================================
    // PHASES
    // =================================================================
    for (const phase of data.phases) {
      if (phase.zones.length === 0) continue;
      const meta = PHASE_METADATA[phase.phase];
      const phaseItemCount = phase.zones.reduce((s, z) => z.rows.reduce((ss, r) => ss + r.qty, s), 0);
      const phaseRowCount = phase.zones.reduce((s, z) => s + z.rows.length, 0);

      ensureSpace(doc, 50);

      // Phase header — bold with item count
      doc.save();
      doc.rect(MARGIN, doc.y, CONTENT_W, 18).fill("#f0ede5");
      doc.restore();
      doc.font("Helvetica-Bold").fontSize(10).fillColor(INK);
      doc.text(`${meta.icon}  Phase ${String(meta.order)} — ${meta.label}`, MARGIN + 6, doc.y + 4);
      doc.font("Helvetica").fontSize(8).fillColor(INK_DIM);
      doc.text(
        `${String(phaseItemCount)} items · ${String(phaseRowCount)} rows`,
        A4_W - MARGIN - 120, doc.y + 5, { width: 114, align: "right" },
      );
      doc.y += 22;

      for (const zoneGroup of phase.zones) {
        ensureSpace(doc, 26);

        // Zone subheader
        doc.font("Helvetica-Bold").fontSize(7.5).fillColor(INK_DIM);
        doc.text(`▹  ${zoneGroup.zone.toUpperCase()}`, MARGIN + 6, doc.y);
        doc.y += 11;

        let rowIdx = 0;
        for (const row of zoneGroup.rows) {
          const rowHeight = rowHeightFor(row);
          ensureSpace(doc, rowHeight);
          const rowY = doc.y;
          const indent = row.afterDepth > 0 ? 16 : 0;

          // Alternating row shade — covers the full variable height
          if (rowIdx % 2 === 0) {
            doc.save();
            doc.rect(MARGIN, rowY, CONTENT_W, rowHeight).fill(ROW_SHADE);
            doc.restore();
          }

          // Checkbox (3.5mm = ~10pt square)
          doc.save();
          doc.rect(MARGIN + 8 + indent, rowY + 3, 10, 10)
            .strokeColor(INK_DIM).lineWidth(0.6).stroke();
          doc.restore();

          // Item name
          const textX = MARGIN + 26 + indent;
          const qtyColW = 44;
          const nameW = CONTENT_W - (textX - MARGIN) - qtyColW;
          doc.font(row.isAccessory ? "Helvetica" : "Helvetica-Bold")
            .fontSize(9).fillColor(INK);
          doc.text(row.name, textX, rowY + 3, { width: nameW });

          // "after" badge for dependencies
          if (row.afterDepth > 0) {
            doc.font("Helvetica").fontSize(6).fillColor(GOLD);
            doc.text("AFTER", textX + nameW - 30, rowY + 5, { width: 28, align: "right" });
          }

          // Quantity — right-aligned, gold
          doc.font("Helvetica-Bold").fontSize(10).fillColor(GOLD);
          doc.text(`×${String(row.qty)}`, A4_W - MARGIN - qtyColW, rowY + 3, { width: qtyColW, align: "right" });

          // Planner note (second line, italic gold)
          if (row.notes.length > 0) {
            doc.font("Helvetica-Oblique").fontSize(7.5).fillColor(GOLD);
            doc.text(`▸ ${row.notes}`, textX, rowY + 16, { width: nameW });
          }

          doc.y = rowY + rowHeight;
          rowIdx++;
        }
        doc.y += 3;
      }
      doc.y += 8;
    }

    // =================================================================
    // TOTALS
    // =================================================================
    if (data.totals.entries.length > 0) {
      ensureSpace(doc, 36);
      doc.save();
      doc.rect(MARGIN, doc.y, CONTENT_W, 0.5).fill(GOLD);
      doc.restore();
      doc.y += 6;
      doc.font("Helvetica-Bold").fontSize(9).fillColor(INK);
      doc.text(
        `TOTALS  —  ${String(data.totals.totalItems)} items · ${String(data.totals.totalRows)} rows`,
        MARGIN, doc.y,
      );
      doc.y += 13;
      doc.font("Helvetica").fontSize(7.5).fillColor(INK_DIM);
      const parts = data.totals.entries.map((e) => `${String(e.qty)}× ${e.name}`).join("   ·   ");
      doc.text(parts, MARGIN, doc.y, { width: CONTENT_W });
      doc.y += 14;
    }

    // =================================================================
    // SIGN-OFF AREA
    // =================================================================
    ensureSpace(doc, 60);
    doc.y += 10;
    doc.moveTo(MARGIN, doc.y).lineTo(A4_W - MARGIN, doc.y)
      .strokeColor(RULE).lineWidth(0.5).stroke();
    doc.y += 12;
    doc.font("Helvetica-Bold").fontSize(8).fillColor(INK_DIM);
    doc.text("Setup verified by:", MARGIN, doc.y);
    doc.moveTo(MARGIN + 90, doc.y + 10).lineTo(MARGIN + 280, doc.y + 10)
      .strokeColor(INK_FAINT).lineWidth(0.5).stroke();
    doc.font("Helvetica").fontSize(8).fillColor(INK_DIM);
    doc.text("Date:", MARGIN + 300, doc.y);
    doc.moveTo(MARGIN + 330, doc.y + 10).lineTo(A4_W - MARGIN, doc.y + 10)
      .strokeColor(INK_FAINT).lineWidth(0.5).stroke();
    doc.y += 20;

    // Fire safety note
    doc.font("Helvetica").fontSize(6.5).fillColor(INK_FAINT);
    doc.text(
      "Fire exits must remain unobstructed at all times. Maximum occupancy must be observed per venue licence. " +
      "Report any safety concerns to the duty manager immediately.",
      MARGIN, doc.y, { width: CONTENT_W },
    );

    // =================================================================
    // FOOTER ON EVERY PAGE (added via buffered pages)
    // =================================================================
    const pages = doc.bufferedPageRange();
    const totalPages = pages.start + pages.count;

    for (let i = pages.start; i < pages.start + pages.count; i++) {
      doc.switchToPage(i);
      const footerTop = A4_H - FOOTER_H;

      doc.save();
      doc.moveTo(MARGIN, footerTop).lineTo(A4_W - MARGIN, footerTop)
        .strokeColor(RULE).lineWidth(0.3).stroke();

      // QR code (page 1 only)
      if (i === 0 && qrBuffer !== null) {
        doc.image(qrBuffer, MARGIN, footerTop + 6, { width: 36, height: 36 });
        doc.font("Helvetica").fontSize(5.5).fillColor(INK_FAINT);
        doc.text("Web view", MARGIN, footerTop + 43, { width: 36, align: "center" });
      }

      // Venue + generation time (all pages)
      const textLeft = i === 0 && qrBuffer !== null ? MARGIN + 50 : MARGIN;
      doc.font("Helvetica").fontSize(6.5).fillColor(INK_FAINT);
      doc.text(`${data.venue.name}  ·  ${data.venue.address}`, textLeft, footerTop + 10, { width: CONTENT_W - 80 });

      const genTime = new Date(data.generatedAt).toLocaleString("en-GB", {
        day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit",
      });
      doc.text(`Generated by OMNITWIN  ·  ${genTime}`, textLeft, footerTop + 22, { width: CONTENT_W - 80 });

      // Page number (all pages, right-aligned)
      doc.font("Helvetica-Bold").fontSize(8).fillColor(INK_DIM);
      doc.text(`Page ${String(i + 1)} of ${String(totalPages)}`, A4_W - MARGIN - 80, footerTop + 14, { width: 80, align: "right" });

      doc.restore();
    }

    doc.end();
  });
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function ensureSpace(doc: Doc, needed: number): void {
  if (doc.y + needed > A4_H - FOOTER_H - 10) {
    doc.addPage();
    doc.y = MARGIN;
  }
}

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

// ---------------------------------------------------------------------------
// Instructions block renderer
//
// Renders the planner's human layer: special instructions, day-of
// contact, access notes. Each sub-block is independently optional.
// Structured so the hallkeeper's eye lands on special instructions
// first (fire safety, VIP guests, etc.) — that block is the gold
// one with a heavy rule on the left edge.
// ---------------------------------------------------------------------------

function renderInstructions(doc: Doc, ins: EventInstructions): void {
  const blockStartY = doc.y;
  let anyRendered = false;

  // ---- Special instructions (the headline) ------------------------------
  if (ins.specialInstructions.trim().length > 0) {
    const text = ins.specialInstructions.trim();
    const innerW = CONTENT_W - 16;
    const textH = doc.heightOfString(text, { width: innerW });
    const blockH = Math.max(28, textH + 24);
    const y0 = doc.y;
    doc.save();
    doc.roundedRect(MARGIN, y0, CONTENT_W, blockH, 4).fill("#fff9e8");
    doc.rect(MARGIN, y0, 3, blockH).fill(GOLD);
    doc.restore();
    doc.font("Helvetica-Bold").fontSize(7).fillColor(GOLD);
    doc.text("SPECIAL INSTRUCTIONS", MARGIN + 12, y0 + 6);
    doc.font("Helvetica").fontSize(9).fillColor(INK);
    doc.text(text, MARGIN + 12, y0 + 17, { width: innerW });
    doc.y = y0 + blockH + 6;
    anyRendered = true;
  }

  // ---- Day-of contact + access notes side-by-side -----------------------
  const hasContact = ins.dayOfContact !== null;
  const hasAccess = ins.accessNotes.trim().length > 0;

  if (hasContact || hasAccess) {
    const y0 = doc.y;
    const colW = hasContact && hasAccess ? (CONTENT_W - 8) / 2 : CONTENT_W;
    let blockH = 0;

    if (hasContact && ins.dayOfContact !== null) {
      const c = ins.dayOfContact;
      const contactH = renderContactBlock(doc, c, MARGIN, y0, colW);
      blockH = Math.max(blockH, contactH);
    }

    if (hasAccess) {
      const accessX = hasContact ? MARGIN + colW + 8 : MARGIN;
      const accessH = renderAccessBlock(doc, ins.accessNotes.trim(), accessX, y0, colW);
      blockH = Math.max(blockH, accessH);
    }

    doc.y = y0 + blockH + 6;
    anyRendered = true;
  }

  if (anyRendered) {
    // Thin rule to separate the instructions block from the diagram below
    doc.moveTo(MARGIN, doc.y).lineTo(A4_W - MARGIN, doc.y)
      .strokeColor(RULE).lineWidth(0.3).stroke();
    doc.y += 10;
  } else {
    // If no content was rendered (shouldn't happen — resolveInstructions
    // filters empty blocks — but guard anyway), reset y to start.
    doc.y = blockStartY;
  }
}

function renderContactBlock(
  doc: Doc,
  c: { name: string; role: string; phone: string; email: string },
  x: number,
  y: number,
  w: number,
): number {
  const lines: string[] = [c.name];
  if (c.role.length > 0) lines[0] = `${c.name}  ·  ${c.role}`;
  if (c.phone.length > 0) lines.push(c.phone);
  if (c.email.length > 0) lines.push(c.email);

  const h = 18 + lines.length * 12;
  doc.save();
  doc.roundedRect(x, y, w, h, 4).fillAndStroke("#f4f1e8", RULE);
  doc.restore();
  doc.font("Helvetica-Bold").fontSize(7).fillColor(INK_DIM);
  doc.text("DAY-OF CONTACT", x + 10, y + 6);

  doc.font("Helvetica-Bold").fontSize(10).fillColor(INK);
  doc.text(lines[0] ?? "", x + 10, y + 18, { width: w - 20 });
  if (lines.length > 1) {
    doc.font("Helvetica").fontSize(9).fillColor(INK_DIM);
    for (let i = 1; i < lines.length; i++) {
      doc.text(lines[i] ?? "", x + 10, y + 18 + i * 12, { width: w - 20 });
    }
  }
  return h;
}

function renderAccessBlock(doc: Doc, text: string, x: number, y: number, w: number): number {
  const innerW = w - 20;
  const textH = doc.heightOfString(text, { width: innerW });
  const h = 22 + textH;
  doc.save();
  doc.roundedRect(x, y, w, h, 4).fillAndStroke("#f4f1e8", RULE);
  doc.restore();
  doc.font("Helvetica-Bold").fontSize(7).fillColor(INK_DIM);
  doc.text("ACCESS & LOAD-IN", x + 10, y + 6);
  doc.font("Helvetica").fontSize(9).fillColor(INK);
  doc.text(text, x + 10, y + 18, { width: innerW });
  return h;
}

/**
 * Row height is variable: standard rows are ROW_H; rows with a planner
 * note grow by one line to accommodate the italic second line.
 */
function rowHeightFor(row: ManifestRowV2): number {
  return row.notes.length > 0 ? ROW_H + 10 : ROW_H;
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
