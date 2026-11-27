import { useEffect, useState } from "react";
import {
  parseSheetPaperLink,
  type SheetPaperCheck,
  type SheetPaperCheckQuery,
  type SheetPaperCheckResult,
} from "@omnitwin/types";
import { checkSheetPaper } from "../../api/sheet-paper-check.js";

// ---------------------------------------------------------------------------
// Is the sheet on this screen still the version in force? (goal 05: "a
// superseded sheet is watermarked as old wherever it appears")
//
// A phone opened at 06:00 keeps its sheet for hours; if the venue approves
// v4 at 09:15, the v3 on that screen must say so. It asks the same
// no-sign-in check its printout's QR code opens (GET /public/sheet-check),
// with the release the server served it (`paperCheck.url`), so the screen
// and the paper get one answer from one rule (api services/sheet-paper-check.ts).
// The answer is version state only.
//
// A sheet is served as the version in force, so it asks only afterwards:
// every few minutes while the page is in view, when the page is shown
// again and when the device comes back online. The last answer stands until
// a newer one arrives, so no signal never clears a "superseded".
// ---------------------------------------------------------------------------

/** How often an open sheet asks again. The public check allows 30 a minute per caller. */
export const SHEET_STANDING_INTERVAL_MS = 2 * 60_000;

function queryOf(link: string): SheetPaperCheckQuery | null {
  try {
    return parseSheetPaperLink(new URL(link).searchParams)?.query ?? null;
  } catch {
    return null;
  }
}

/** The latest answer for this sheet's release, or null before one (and for a
 *  sheet served without a check link, which has nothing to ask with). */
export function useSheetStanding(check: SheetPaperCheck | undefined): SheetPaperCheckResult | null {
  const link = check?.url;
  const [answer, setAnswer] = useState<{ readonly link: string; readonly result: SheetPaperCheckResult } | null>(null);

  useEffect(() => {
    if (link === undefined) return undefined;
    const query = queryOf(link);
    if (query === null) return undefined;
    let inFlight: AbortController | null = null;
    const ask = (): void => {
      if (document.visibilityState === "hidden") return;
      inFlight?.abort();
      const controller = new AbortController();
      inFlight = controller;
      void (async () => {
        try {
          const result = await checkSheetPaper(query, controller.signal);
          if (!controller.signal.aborted) setAnswer({ link, result });
        } catch {
          // No signal, or no answer: the last answer stands.
        }
      })();
    };
    const onShown = (): void => { if (document.visibilityState === "visible") ask(); };
    const timer = window.setInterval(ask, SHEET_STANDING_INTERVAL_MS);
    window.addEventListener("online", ask);
    document.addEventListener("visibilitychange", onShown);
    return () => {
      inFlight?.abort();
      window.clearInterval(timer);
      window.removeEventListener("online", ask);
      document.removeEventListener("visibilitychange", onShown);
    };
  }, [link]);

  return answer !== null && answer.link === link ? answer.result : null;
}
