import type { ReactElement } from "react";
import { ActivityIndicator } from "../shared/Activity.js";
import {
  formatFileSize,
  formatPreparedTime,
  type VisitorPlanPdf,
} from "../../hooks/use-visitor-plan-pdf.js";
import "./VisitorPlanPdfActions.css";

// ---------------------------------------------------------------------------
// VisitorPlanPdfActions — prepare, then send or download, a visitor's plan.
//
// Shared by the desktop Share lens (the dark cockpit dock) and the phone's
// "Send your plan" sheet (ivory). The flow is identical; only the surface
// differs, so each tone maps the same structure onto its own classes.
//
// Every state tells the truth about the file: it is made from the saved plan,
// it stays on this device until the organiser sends it, and if the plan
// changes afterwards the old file is withdrawn rather than offered stale.
// ---------------------------------------------------------------------------

interface ToneClasses {
  readonly button: string;
  readonly note: string;
  readonly hint: string;
  readonly error: string;
  readonly result: string;
  readonly resultLabel: string;
  readonly file: string;
  readonly actions: string;
  readonly primaryChip: string;
  readonly chip: string;
}

const TONES: Readonly<Record<"dock" | "sheet", ToneClasses>> = {
  dock: {
    button: "lens-panel__button visitor-pdf__target",
    note: "lens-panel__note",
    hint: "lens-panel__note",
    error: "lens-panel__error",
    result: "lens-panel__share-result",
    resultLabel: "lens-panel__share-result-label",
    file: "lens-panel__paragraph",
    actions: "lens-panel__share-buttons",
    primaryChip: "lens-panel__chip-link is-active visitor-pdf__target",
    chip: "lens-panel__chip-link visitor-pdf__target",
  },
  sheet: {
    button: "visitor-pdf__button visitor-pdf__target",
    note: "visitor-pdf__note",
    hint: "visitor-pdf__hint",
    error: "visitor-pdf__error",
    result: "visitor-pdf__result",
    resultLabel: "visitor-pdf__result-label",
    file: "visitor-pdf__file",
    actions: "visitor-pdf__actions",
    primaryChip: "visitor-pdf__chip visitor-pdf__chip--primary visitor-pdf__target",
    chip: "visitor-pdf__chip visitor-pdf__target",
  },
};

const NOTHING_SENT = "Nothing is emailed. The file stays on this device until you send it.";

interface VisitorPlanPdfActionsProps {
  readonly pdf: VisitorPlanPdf;
  readonly tone: "dock" | "sheet";
  /** Why the PDF cannot be prepared yet, in plain words; null when it can. */
  readonly unavailableReason: string | null;
}

export function VisitorPlanPdfActions({ pdf, tone, unavailableReason }: VisitorPlanPdfActionsProps): ReactElement {
  const c = TONES[tone];
  const { state, stale, canShareFile, shareNote, prepare, share } = pdf;
  const preparing = state.phase === "preparing";
  // A file is offered only while it still matches the plan on screen.
  const readyState = state.phase === "ready" && !stale ? state : null;
  const announcement = readyState !== null ? `PDF ready: ${readyState.file.name}` : "";

  return (
    <div className={`visitor-pdf visitor-pdf--${tone}`} data-testid="visitor-pdf">
      {/* One persistent polite region, so "ready" is spoken when it happens. */}
      <span className="visitor-pdf__live" role="status" aria-live="polite" aria-atomic="true">{announcement}</span>

      {unavailableReason !== null ? (
        <p className={c.note} data-testid="visitor-pdf-unavailable">{unavailableReason}</p>
      ) : readyState === null && (
        <>
          {state.phase === "ready" && stale && (
            <p className={c.note} data-testid="visitor-pdf-stale">The plan has changed since this PDF was made.</p>
          )}
          <button
            type="button"
            className={c.button}
            onClick={prepare}
            disabled={preparing}
            aria-busy={preparing}
            data-testid="visitor-pdf-prepare"
          >
            {preparing && <ActivityIndicator size={18} />}
            {preparing
              ? "Preparing the PDF…"
              : state.phase === "error" ? "Try again"
                : state.phase === "ready" ? "Prepare it again" : "Prepare the PDF"}
          </button>
          {state.phase === "idle" && (
            <p className={c.hint} data-testid="visitor-pdf-consequence">
              Saves your latest change, then makes the PDF. {NOTHING_SENT}
            </p>
          )}
        </>
      )}

      {state.phase === "error" && (
        <p className={c.error} role="alert" data-testid="visitor-pdf-error">{state.message}</p>
      )}

      {readyState !== null && (
        <div className={c.result} data-testid="visitor-pdf-result">
          <span className={c.resultLabel}>PDF ready</span>
          <p className={c.file} data-testid="visitor-pdf-file">
            {readyState.file.name} · {formatFileSize(readyState.file.size)} · made {formatPreparedTime(readyState.preparedAt)}
          </p>
          <div className={c.actions}>
            {canShareFile && (
              <button type="button" className={c.primaryChip} onClick={share} data-testid="visitor-pdf-share">
                Send the PDF
              </button>
            )}
            <a className={c.chip} href={readyState.url} download={readyState.file.name} data-testid="visitor-pdf-download">
              Download
            </a>
          </div>
          <p className={c.hint}>{NOTHING_SENT}</p>
        </div>
      )}

      {shareNote !== null && (
        <p className={c.note} data-testid="visitor-pdf-share-note">{shareNote}</p>
      )}
    </div>
  );
}
