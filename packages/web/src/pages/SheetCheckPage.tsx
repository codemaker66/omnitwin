import { useCallback, useEffect, useMemo, useState, type ReactElement, type ReactNode } from "react";
import { useSearchParams } from "react-router-dom";
import {
  describePaperClaim,
  parseSheetPaperLink,
  type PaperCopyClaim,
  type SheetPaperCheckQuery,
  type SheetPaperCheckResult,
} from "@omnitwin/types";
import { ActivityIndicator } from "../components/shared/Activity.js";
import { ApiError } from "../api/client.js";
import { checkSheetPaper } from "../api/sheet-paper-check.js";
import "./SheetCheckPage.css";

// ---------------------------------------------------------------------------
// /sheet-check — "is this printed sheet current?"
//
// The page a printed hallkeeper sheet's QR code opens. No sign-in: it is
// read at 06:00 with paper in hand, sometimes in a cellar. It answers one
// question in one sentence and offers the next step, and it shows nothing
// from the sheet itself — only the version the paper claims (from its own
// link) and the version state the server returns.
//
// With no signal it says so and repeats what the paper says about itself.
// A small service worker (public/sheet-check-sw.js), registered on the first
// visit, gives the same answer when the phone cannot reach the site at all.
// ---------------------------------------------------------------------------

type Tone = "current" | "superseded" | "pending" | "neutral";

export interface SheetCheckAnswer {
  readonly tone: Tone;
  readonly headline: string;
  readonly lede: string;
  /** The version to read in large type, with what it means. */
  readonly numeral: { readonly value: string; readonly caption: string } | null;
}

/** One answer per state, in the venue's words. Every "no" names the next step. */
export function describeSheetCheck(result: SheetPaperCheckResult, claim: PaperCopyClaim): SheetCheckAnswer {
  switch (result.state) {
    case "current":
      return {
        tone: "current",
        headline: "This is the current sheet.",
        lede: "No newer version has been issued for this room.",
        numeral: { value: `v${String(result.version)}`, caption: "In force" },
      };
    case "superseded": {
      const version = `v${String(result.currentVersion)}`;
      return claim.kind === "issued"
        ? {
          tone: "superseded",
          headline: "Superseded.",
          lede: `Ask the duty manager for ${version} before setting up.`,
          numeral: { value: version, caption: "The version to use" },
        }
        : {
          tone: "superseded",
          headline: "Not the approved sheet.",
          lede: `This copy was printed before approval. Ask the duty manager for ${version}.`,
          numeral: { value: version, caption: "The version to use" },
        };
    }
    case "not_approved":
      return claim.kind === "issued"
        ? {
          tone: "pending",
          headline: "Being revised.",
          lede: "The venue is changing this room's layout. Ask the duty manager before setting up from this copy.",
          numeral: null,
        }
        : {
          tone: "pending",
          headline: "Not approved yet.",
          lede: "This room's layout is still being prepared. Ask the duty manager before setting up from this copy.",
          numeral: null,
        };
    case "retired":
      return {
        tone: "neutral",
        headline: "No longer in use.",
        lede: "This room's layout has been closed. Ask the duty manager for the sheet you need.",
        numeral: null,
      };
    case "unknown":
      return {
        tone: "neutral",
        headline: "Can't confirm this copy.",
        lede: "Ask the duty manager which version to use.",
        numeral: null,
      };
  }
}

type CheckState =
  | { readonly kind: "checking" }
  | { readonly kind: "answered"; readonly result: SheetPaperCheckResult }
  | { readonly kind: "offline" }
  | { readonly kind: "failed" };

function isOffline(error: unknown): boolean {
  if (typeof navigator !== "undefined" && !navigator.onLine) return true;
  return error instanceof ApiError && error.code === "NETWORK_ERROR";
}

/** Install the offline answer for the next scan on this phone. Best effort. */
function registerOfflineAnswer(): void {
  if (typeof navigator === "undefined" || !("serviceWorker" in navigator)) return;
  navigator.serviceWorker.register("/sheet-check-sw.js", { scope: "/sheet-check" }).catch(() => undefined);
}

export function SheetCheckPage(): ReactElement {
  const [searchParams] = useSearchParams();
  const link = useMemo(() => parseSheetPaperLink(searchParams), [searchParams]);

  useEffect(() => {
    document.title = "Sheet check · Venviewer";
    registerOfflineAnswer();
  }, []);

  if (link === null) {
    return <SheetCheckFrame tone="neutral">
      <h1 className="sheet-check__headline">This link is not a sheet check.</h1>
      <p className="sheet-check__lede">Scan the code at the foot of a printed hallkeeper sheet, or ask the duty manager.</p>
    </SheetCheckFrame>;
  }
  return <SheetCheck query={link.query} claim={link.claim} />;
}

function SheetCheck({ query, claim }: { readonly query: SheetPaperCheckQuery; readonly claim: PaperCopyClaim }): ReactElement {
  const [state, setState] = useState<CheckState>({ kind: "checking" });
  const [attempt, setAttempt] = useState(0);
  const retry = useCallback(() => { setAttempt((n) => n + 1); }, []);

  useEffect(() => {
    const controller = new AbortController();
    setState({ kind: "checking" });
    checkSheetPaper(query, controller.signal).then(
      (result) => { if (!controller.signal.aborted) setState({ kind: "answered", result }); },
      (error: unknown) => {
        if (controller.signal.aborted) return;
        setState({ kind: isOffline(error) ? "offline" : "failed" });
      },
    );
    return () => { controller.abort(); };
  }, [query, attempt]);

  // When signal returns, ask again without a tap.
  useEffect(() => {
    if (state.kind !== "offline") return undefined;
    window.addEventListener("online", retry);
    return () => { window.removeEventListener("online", retry); };
  }, [state.kind, retry]);

  const claimLine = describePaperClaim(claim);

  if (state.kind === "checking") {
    return <SheetCheckFrame tone="neutral" busy>
      <p className="sheet-check__checking"><ActivityIndicator size={56} /><span>Checking this copy…</span></p>
      <p className="sheet-check__claim">{claimLine}</p>
    </SheetCheckFrame>;
  }

  if (state.kind === "offline" || state.kind === "failed") {
    const offline = state.kind === "offline";
    return <SheetCheckFrame tone="neutral">
      <h1 className="sheet-check__headline">{offline ? "Can't check: no signal." : "Can't check right now."}</h1>
      <p className="sheet-check__lede">{offline ? claimLine : "Try again in a minute, or ask the duty manager."}</p>
      {!offline && <p className="sheet-check__claim">{claimLine}</p>}
      <button type="button" className="sheet-check__retry" onClick={retry}>Try again</button>
    </SheetCheckFrame>;
  }

  const answer = describeSheetCheck(state.result, claim);
  return <SheetCheckFrame tone={answer.tone}>
    {answer.numeral !== null && <p className="sheet-check__numeral">
      <span className="sheet-check__numeral-value">{answer.numeral.value}</span>
      <span className="sheet-check__numeral-caption">{answer.numeral.caption}</span>
    </p>}
    <h1 className="sheet-check__headline">{answer.headline}</h1>
    <p className="sheet-check__lede">{answer.lede}</p>
    <p className="sheet-check__claim">{claimLine}</p>
  </SheetCheckFrame>;
}

/** One sheet on the sage ground. The answer sits in one polite live region,
 *  held busy while checking so a screen reader hears the answer, not the wait. */
function SheetCheckFrame({ tone, busy = false, children }: {
  readonly tone: Tone;
  readonly busy?: boolean;
  readonly children: ReactNode;
}): ReactElement {
  return <main className="sheet-check" data-register="ivory">
    <article className="sheet-check__sheet" data-tone={tone} data-register={tone === "current" ? "forest" : "ivory"}
      aria-labelledby="sheet-check-overline">
      <p id="sheet-check-overline" className="sheet-check__overline">Hallkeeper sheet check</p>
      <div className="sheet-check__answer" aria-live="polite" aria-busy={busy}>{children}</div>
      <p className="sheet-check__note">This check says only whether a printed copy is current. It shows nothing from the sheet itself.</p>
    </article>
  </main>;
}
