import type { ReactElement } from "react";
import { PLAN_VIEW_LINK_DAYS } from "@omnitwin/types";
import { ActivityIndicator } from "../shared/Activity.js";
import {
  formatLinkMade,
  formatLinkUntil,
  type VisitorPlanLinks,
} from "../../hooks/use-visitor-plan-links.js";
import "./VisitorPlanPdfActions.css";
import "./VisitorPlanLinkActions.css";

// ---------------------------------------------------------------------------
// VisitorPlanLinkActions — "Copy a view-only link" beside the PDF
// (fix-first item 11).
//
// Shared by the desktop Share lens (dark dock) and the phone's "Send your
// plan" sheet (ivory), like VisitorPlanPdfActions. Before the action it says
// what the link does and does not do; after, it gives the link (once), when
// it stops working, and a way to stop it. The planner address never appears:
// the link is its own token, and it can only read.
// ---------------------------------------------------------------------------

interface ToneClasses {
  readonly button: string;
  readonly note: string;
  readonly hint: string;
  readonly error: string;
  readonly result: string;
  readonly resultLabel: string;
  readonly detail: string;
  readonly actions: string;
  readonly chip: string;
}

const TONES: Readonly<Record<"dock" | "sheet", ToneClasses>> = {
  dock: {
    button: "lens-panel__button lens-panel__button--ghost visitor-pdf__target",
    note: "lens-panel__note",
    hint: "lens-panel__note",
    error: "lens-panel__error",
    result: "lens-panel__share-result",
    resultLabel: "lens-panel__share-result-label",
    detail: "lens-panel__paragraph",
    actions: "lens-panel__share-buttons",
    chip: "lens-panel__chip-link visitor-pdf__target",
  },
  sheet: {
    button: "visitor-pdf__button visitor-link__button--quiet visitor-pdf__target",
    note: "visitor-pdf__note",
    hint: "visitor-pdf__hint",
    error: "visitor-pdf__error",
    result: "visitor-pdf__result",
    resultLabel: "visitor-pdf__result-label",
    detail: "visitor-pdf__file",
    actions: "visitor-pdf__actions",
    chip: "visitor-pdf__chip visitor-pdf__target",
  },
};

export const PLAN_LINK_CONSEQUENCE =
  "Saves your latest change, then copies a link. Whoever opens it sees this plan as it is saved, including later changes, without prices, and cannot change it.";
export const PLAN_LINK_RETENTION =
  `It works for ${String(PLAN_VIEW_LINK_DAYS)} days unless you stop it, and the plan is kept while it works.`;

interface VisitorPlanLinkActionsProps {
  readonly links: VisitorPlanLinks;
  readonly tone: "dock" | "sheet";
  /** Why a link cannot be made yet, in plain words; null when it can. */
  readonly unavailableReason: string | null;
}

export function VisitorPlanLinkActions({ links, tone, unavailableReason }: VisitorPlanLinkActionsProps): ReactElement {
  const c = TONES[tone];
  const { state, list, stoppingId, stopNote, make, copyAgain, stop, reloadList } = links;
  const making = state.phase === "making";
  const made = state.phase === "made" ? state : null;
  const announcement = made === null
    ? stopNote ?? ""
    : made.copied ? "View-only link copied" : "View-only link made";

  return (
    <div className={`visitor-link visitor-link--${tone} visitor-pdf--${tone}`} data-testid="visitor-link">
      <span className="visitor-pdf__live" role="status" aria-live="polite" aria-atomic="true">{announcement}</span>

      {unavailableReason !== null ? (
        <p className={c.note} data-testid="visitor-link-unavailable">{unavailableReason}</p>
      ) : made === null && (
        <>
          <button
            type="button"
            className={c.button}
            onClick={make}
            disabled={making}
            aria-busy={making}
            data-testid="visitor-link-make"
          >
            {making && <ActivityIndicator size={18} />}
            {making ? "Making the link…" : state.phase === "error" ? "Try again" : "Copy a view-only link"}
          </button>
          {state.phase === "idle" && (
            <>
              <p className={c.hint} data-testid="visitor-link-consequence">{PLAN_LINK_CONSEQUENCE}</p>
              <p className={c.hint} data-testid="visitor-link-retention">{PLAN_LINK_RETENTION}</p>
            </>
          )}
        </>
      )}

      {state.phase === "error" && (
        <p className={c.error} role="alert" data-testid="visitor-link-error">{state.message}</p>
      )}

      {made !== null && (
        <div className={c.result} data-testid="visitor-link-result">
          <span className={c.resultLabel}>{made.copied ? "Link copied" : "Your view-only link"}</span>
          <input
            className="visitor-link__url visitor-pdf__target"
            type="text"
            readOnly
            value={made.url}
            aria-label="View-only link"
            onFocus={(event) => { event.currentTarget.select(); }}
            data-testid="visitor-link-url"
          />
          <p className={c.detail} data-testid="visitor-link-until">
            Works until {formatLinkUntil(made.expiresAt)} unless you stop it. Nobody can change the plan through it.
          </p>
          <div className={c.actions}>
            <button type="button" className={c.chip} onClick={copyAgain} data-testid="visitor-link-copy">
              {made.copied ? "Copy again" : "Copy"}
            </button>
            <button type="button" className={c.chip} onClick={make} data-testid="visitor-link-another">
              Make another
            </button>
          </div>
          <p className={c.hint}>
            {made.copied ? "" : "Copy it from the box above. "}
            This link can&apos;t be shown again once you leave; you can stop it below or make another.
          </p>
        </div>
      )}

      {list.phase === "ready" && list.links.length > 0 && (
        <div className="visitor-link__list-wrap" data-testid="visitor-link-list">
          <span className={c.resultLabel}>Working links</span>
          <ul className="visitor-link__list">
            {list.links.map((link) => {
              const madeAt = formatLinkMade(link.createdAt);
              const stopping = stoppingId === link.id;
              return (
                <li key={link.id} className="visitor-link__row">
                  <span className="visitor-link__row-text">
                    Made {madeAt} · works until {formatLinkUntil(link.expiresAt)}
                  </span>
                  <button
                    type="button"
                    className={`${c.chip} visitor-link__stop`}
                    onClick={() => { stop(link.id); }}
                    disabled={stoppingId !== null}
                    aria-busy={stopping}
                    aria-label={stopping ? `Stopping the link made ${madeAt}` : `Stop the link made ${madeAt}`}
                    data-testid="visitor-link-stop"
                  >
                    {stopping && <ActivityIndicator size={14} />}
                    {stopping ? "Stopping…" : "Stop"}
                  </button>
                </li>
              );
            })}
          </ul>
          <p className={c.hint}>Stopping a link is immediate: whoever holds it sees that it no longer works.</p>
        </div>
      )}

      {list.phase === "error" && (
        <div className={c.actions} data-testid="visitor-link-list-error">
          <p className={c.note}>The links already made couldn&apos;t be loaded.</p>
          <button type="button" className={c.chip} onClick={reloadList}>Load them again</button>
        </div>
      )}

      {stopNote !== null && (
        <p className={c.note} data-testid="visitor-link-stop-note">{stopNote}</p>
      )}
    </div>
  );
}
