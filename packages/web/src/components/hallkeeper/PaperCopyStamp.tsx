import { useEffect, useState, type ReactElement } from "react";
import { flushSync } from "react-dom";
import { describeSheetCopy, type HallkeeperSheetV2, type SheetPaperQr } from "@omnitwin/types";
import "./paper-copy-stamp.css";

// ---------------------------------------------------------------------------
// Paper that knows its version — the web print's stamp.
//
// A sheet printed from the browser carries the same facts as the PDF: its
// version in words ("v7, issued 16 Oct 14:02, printed 17 Oct 06:02") and a
// QR code that opens the no-sign-in check (/sheet-check), which answers only
// whether the copy is current. The printed minute is taken when the browser
// starts printing, not when the page loaded.
// ---------------------------------------------------------------------------

/** The moment the browser last began printing; the load time until then. */
export function usePrintedAt(): string {
  const [printedAt, setPrintedAt] = useState(() => new Date().toISOString());
  useEffect(() => {
    // Synchronous so the stamp is in the page before the print snapshot.
    const stamp = (): void => { flushSync(() => { setPrintedAt(new Date().toISOString()); }); };
    window.addEventListener("beforeprint", stamp);
    return () => { window.removeEventListener("beforeprint", stamp); };
  }, []);
  return printedAt;
}

/** The copy's version in words, for this sheet printed at `printedAt`. */
export function paperCopyLine(data: HallkeeperSheetV2, printedAt: string): string {
  return describeSheetCopy({
    version: data.approval?.version ?? null,
    issuedAt: data.approval?.approvedAt ?? null,
    printedAt,
    timeZone: data.venue.timezone,
  });
}

/** One SVG path of the dark modules, with the four-module quiet zone the QR standard asks for. */
function qrPath(qr: SheetPaperQr): string {
  const quiet = 4;
  let path = "";
  qr.rows.forEach((row, y) => {
    let x = 0;
    while (x < row.length) {
      if (row[x] !== "1") { x += 1; continue; }
      let run = 1;
      while (row[x + run] === "1") run += 1;
      path += `M${String(x + quiet)} ${String(y + quiet)}h${String(run)}v1h-${String(run)}z`;
      x += run;
    }
  });
  return path;
}

export function PaperCheckQr({ qr }: { readonly qr: SheetPaperQr }): ReactElement {
  const extent = qr.size + 8;
  return <svg className="hk-paper-copy__qr" viewBox={`0 0 ${String(extent)} ${String(extent)}`}
    role="img" aria-label="QR code to check this copy is current" shapeRendering="crispEdges">
    <rect width={extent} height={extent} fill="#ffffff" />
    <path d={qrPath(qr)} fill="#000000" />
  </svg>;
}

/** The stamp at the foot of a printed sheet: QR, version line, and what the code does. */
export function PaperCopyStamp({ data, printedAt }: {
  readonly data: HallkeeperSheetV2;
  readonly printedAt: string;
}): ReactElement {
  const check = data.paperCheck;
  return <div className="hk-paper-copy" data-testid="paper-copy-stamp">
    {check !== undefined && <PaperCheckQr qr={check.qr} />}
    <div className="hk-paper-copy__text">
      <p className="hk-paper-copy__line">{paperCopyLine(data, printedAt)}</p>
      <p className="hk-paper-copy__caption">{check !== undefined
        ? "Scan to check this copy is current. No sign-in; the check shows nothing from this sheet."
        : `${data.venue.name} · times on the venue's clock (${data.venue.timezone})`}</p>
    </div>
  </div>;
}
