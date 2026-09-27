import { useEffect, useId, useRef, useState, type ReactElement } from "react";
import { ApiError } from "../../../api/client.js";
import { publishRotaWeek, rotaRefusalWords } from "../../../api/rota.js";
import type { RotaPublishResult, RotaWeek } from "@omnitwin/types";
import { ActivityIndicator } from "../../shared/Activity.js";
import { publishPlan, rotaWeekTitle } from "./rota-format.js";
import type { PanelMessage } from "./ShiftEditor.js";

// ---------------------------------------------------------------------------
// "Publish this week": one clear next step, always in the same place. What it
// will do is said under it before it is pressed, and again in the question
// that confirms it, because publishing tells people.
// ---------------------------------------------------------------------------

/** "Published 14 shifts. 9 people have been told in the app." */
export function publishedWords(result: RotaPublishResult): string {
  const shifts = `Published ${String(result.published)} ${result.published === 1 ? "shift" : "shifts"}.`;
  if (result.told === 0 && result.notTold === 0) return shifts;
  if (result.told === 0) return `${shifts} Nobody on them has an account, so let them know yourself.`;
  const told = `${String(result.told)} ${result.told === 1 ? "person has" : "people have"} been told in the app`;
  if (result.notTold === 0) return `${shifts} ${told}.`;
  return `${shifts} ${told}; tell the other ${String(result.notTold)} yourself.`;
}

export function PublishControl({ venueId, week, onDone }: {
  readonly venueId: string;
  readonly week: RotaWeek;
  /** Publishing finished or was refused: say so and read the week again. */
  readonly onDone: (message: PanelMessage) => void;
}): ReactElement {
  const questionId = useId();
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const questionRef = useRef<HTMLParagraphElement>(null);
  const plan = publishPlan(week);

  // The question takes focus, not the button: a second Enter must not publish.
  // The question replaces the button, so focus goes back to the button once
  // it is there again.
  const wasConfirming = useRef(false);
  useEffect(() => {
    if (confirming) questionRef.current?.focus();
    else if (wasConfirming.current) triggerRef.current?.focus();
    wasConfirming.current = confirming;
  }, [confirming]);
  const nothing = plan.publishable.length === 0;

  const publish = async (): Promise<void> => {
    setBusy(true);
    try {
      const result = await publishRotaWeek(venueId, week.weekStart, plan.publishable);
      setConfirming(false);
      onDone({ tone: "settled", text: publishedWords(result) });
    } catch (error) {
      setConfirming(false);
      onDone({
        tone: "alert",
        text: error instanceof ApiError && error.code === "WEEK_CHANGED"
          ? "The week changed while you were looking at it. Here it is as it stands now; nothing was published."
          : rotaRefusalWords(error, "The week could not be published. Nothing has changed; try again."),
      });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="rota-publish">
      {!confirming && (
        <>
          <button type="button" ref={triggerRef} className="rota-button rota-button--primary rota-publish__button"
            disabled={nothing || busy} aria-describedby={`${questionId}-consequence`}
            onClick={() => { setConfirming(true); }}>
            Publish this week
          </button>
          <p className="rota-publish__consequence" id={`${questionId}-consequence`}>{plan.consequence}</p>
          {plan.heldBack !== null && <p className="rota-publish__held">{plan.heldBack}</p>}
        </>
      )}
      {confirming && (
        <div className="rota-confirm" role="group" aria-labelledby={questionId}
          onKeyDown={(event) => { if (event.key === "Escape" && !busy) { event.preventDefault(); setConfirming(false); } }}>
          <p className="rota-confirm__question" id={questionId} ref={questionRef} tabIndex={-1}>Publish the {rotaWeekTitle(week.weekStart).replace(/^Week/u, "week")}?</p>
          <p className="rota-confirm__consequence">{plan.consequence}</p>
          {plan.heldBack !== null && <p className="rota-confirm__consequence rota-publish__held">{plan.heldBack}</p>}
          <div className="rota-actions">
            <button type="button" className="rota-button rota-button--primary" disabled={busy} aria-busy={busy}
              onClick={() => { void publish(); }}>
              {busy && <ActivityIndicator size={16} />}
              {busy ? "Publishing…" : plan.buttonLabel}
            </button>
            <button type="button" className="rota-button" disabled={busy} onClick={() => { setConfirming(false); }}>Not yet</button>
          </div>
        </div>
      )}
    </div>
  );
}
