import { useEffect, useId, useRef, useState, type ReactElement } from "react";
import { Sparkles } from "lucide-react";
import { MAX_CLIENT_MESSAGE_LENGTH, findUnsupportedProposalClaim, type AIDraft, type ProposalMessageDraft } from "@omnitwin/types";
import { ApiError } from "../../../api/client.js";
import { draftProposalMessage } from "../../../api/ai-assistant.js";
import { markAIDraftsUnavailable, useAIDraftsAvailable } from "../../../hooks/use-ai-drafts-available.js";
import { ActivityIndicator } from "../../shared/Activity.js";

// ---------------------------------------------------------------------------
// Draft the message with AI (roadmap X1, "Use in proposal"), under the
// composer's message. Offered only where a provider is configured; with none,
// nothing about AI is shown or stored. The server writes the draft from what
// the venue holds of the proposal (the event, the client's name, their
// enquiry's words and their latest message on it), and refuses when it holds
// none of them rather than have the AI invent an event. The draft is shown in
// heather, saying what it was written from and that it is not checked, and the
// booker chooses to use it or put it away; used, the message stays marked
// until they say they have read it through.
// ---------------------------------------------------------------------------

type DrewOn = ProposalMessageDraft["drewOn"];

type Step =
  | { readonly kind: "idle" }
  | { readonly kind: "drafting" }
  | { readonly kind: "ready"; readonly draft: AIDraft; readonly drewOn: DrewOn }
  | { readonly kind: "failed" }
  | { readonly kind: "refused" }
  | { readonly kind: "nothing" }
  | { readonly kind: "gone" };

/** What a draft was written from, in words: only what the AI was given. */
export function drewOnWords(drewOn: DrewOn): string {
  const parts = [
    drewOn.event ? "the event's details" : null,
    drewOn.enquiry ? "the client's enquiry" : null,
    drewOn.clientWords ? "the client's latest message" : null,
  ].filter((part): part is string => part !== null);
  if (parts.length === 0) return "Written by AI. Not checked.";
  const last = parts[parts.length - 1] ?? "";
  const list = parts.length === 1 ? last : `${parts.slice(0, -1).join(", ")} and ${last}`;
  return `Written by AI from ${list}. Not checked.`;
}

/** Focus moves to what an answer brings only from where it was when asked,
 *  from inside this card, or from nowhere: never out of another part's flow
 *  (a template's question, say) that took it meanwhile. */
function focusFree(from: Element | null, card: Element | null): boolean {
  const active = document.activeElement;
  return active === null || active === document.body || active === from || (card?.contains(active) ?? false);
}

interface AIMessageDraftProps {
  readonly proposalId: string;
  /** False while the composer holds what would replace it (a save on its
   *  way, template work): Use waits. */
  readonly canUse: boolean;
  /** Puts the draft's words in as the message; `from` is where focus was. */
  readonly onUse: (body: string, from: Element | null) => void;
  /** Each draft as it is shown (null between): its words, copied into the
   *  message even after it is put away, are AI words. */
  readonly onShown: (body: string | null) => void;
}

export function AIMessageDraft({ proposalId, canUse, onUse, onShown }: AIMessageDraftProps): ReactElement | null {
  const available = useAIDraftsAvailable();
  const [step, setStep] = useState<Step>({ kind: "idle" });
  // Said to a screen reader: the draft on its way, or ready where focus could not go.
  const [said, setSaid] = useState("");
  const headingId = useId();
  const cardRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const headingRef = useRef<HTMLParagraphElement>(null);
  const retryRef = useRef<HTMLButtonElement>(null);
  const saidRef = useRef<HTMLParagraphElement>(null);
  // An answer overtaken by a newer request, or arriving after the composer
  // has gone, is dropped.
  const askNumber = useRef(0);
  useEffect(() => () => { askNumber.current += 1; }, []);
  useEffect(() => { onShown(step.kind === "ready" ? step.draft.body : null); }, [step, onShown]);
  useEffect(() => () => { onShown(null); }, [onShown]);
  const askedFrom = useRef<Element | null>(null);
  const [focusTo, setFocusTo] = useState<"draft" | "button" | "retry" | "said" | null>(null);
  useEffect(() => {
    if (focusTo === null) return;
    const target = focusTo === "draft" ? headingRef.current : focusTo === "button" ? buttonRef.current
      : focusTo === "retry" ? retryRef.current : saidRef.current;
    if (target === null) return;
    setFocusTo(null);
    // Where focus cannot go, the card's one live region says what came; a
    // failure says itself (an alert), and a button is never read out bare.
    if (focusFree(askedFrom.current, cardRef.current)) target.focus();
    else if (focusTo === "draft") setSaid("The AI draft is ready, under the message.");
    else if (focusTo === "said") setSaid(target.textContent ?? "");
  }, [focusTo, step]);

  // Try again and Draft again take away the button pressed, so focus waits
  // on the one that says the draft is on its way.
  const ask = (again: boolean): void => {
    askedFrom.current = document.activeElement;
    askNumber.current += 1;
    const mine = askNumber.current;
    setStep({ kind: "drafting" });
    setSaid("Drafting the message with AI.");
    if (again) setFocusTo("button");
    draftProposalMessage(proposalId)
      .then(({ draft, drewOn }) => {
        if (askNumber.current !== mine) return;
        setSaid("");
        setStep({ kind: "ready", draft, drewOn });
        setFocusTo("draft");
      })
      .catch((error: unknown) => {
        if (askNumber.current !== mine) return;
        setSaid("");
        // Only the server's own word that AI is switched off takes it away for
        // the visit; a proxy's or a deploy's 503 is a failure to try again.
        if (error instanceof ApiError && error.status === 503 && error.code === "AI_ASSISTANT_DISABLED") {
          setStep({ kind: "gone" });
          markAIDraftsUnavailable();
          setFocusTo("said");
          return;
        }
        if (error instanceof ApiError && error.status === 422 && error.code === "NOTHING_TO_DRAFT_FROM") {
          setStep({ kind: "nothing" });
          setFocusTo("said");
          return;
        }
        // Refused for this proposal as it stands (sent from elsewhere meanwhile,
        // say): asking again would be refused again. A lapsed sign-in, a
        // timeout or too many asks can be tried again.
        if (error instanceof ApiError && error.status >= 400 && error.status < 500 && ![401, 408, 429].includes(error.status)) {
          setStep({ kind: "refused" });
          setFocusTo("said");
          return;
        }
        setStep({ kind: "failed" });
        setFocusTo("retry");
      });
  };

  if (step.kind !== "gone" && available !== true) return null;

  const drafting = step.kind === "drafting";
  const ready = step.kind === "ready" ? step : null;
  const draft = ready?.draft ?? null;
  const tooLong = draft !== null && draft.body.length > MAX_CLIENT_MESSAGE_LENGTH;
  const claim = draft === null ? null : findUnsupportedProposalClaim(draft.body);
  return (
    <div className="pr-ai" ref={cardRef} data-testid="ai-draft">
      <p className="vv-sr-only" role="status" data-testid="ai-draft-said">{said}</p>
      {step.kind === "gone" && (
        <p className="enq-next__hint" ref={saidRef} tabIndex={-1} data-testid="ai-draft-gone">
          AI drafts are not available now. The message is unchanged.
        </p>
      )}
      {step.kind === "refused" && (
        <p className="enq-next__hint" ref={saidRef} tabIndex={-1} data-testid="ai-draft-refused">
          A draft cannot be written for this proposal as it stands. The message is unchanged.
        </p>
      )}
      {(step.kind === "idle" || drafting) && (
        <div className="enq-actions">
          <button type="button" className="enq-quiet" ref={buttonRef} data-testid="ai-draft-ask" aria-busy={drafting}
            aria-disabled={drafting} onClick={() => { if (!drafting) ask(false); }}>
            {drafting && <ActivityIndicator size={18} />}
            {drafting ? "Drafting…" : "Draft the message with AI"}
          </button>
        </div>
      )}
      {step.kind === "nothing" && (
        <p className="enq-next__hint" ref={saidRef} tabIndex={-1} data-testid="ai-draft-nothing">
          There is nothing for AI to draft from yet: this proposal has no event details, enquiry or message from the client. The message is unchanged.
        </p>
      )}
      {step.kind === "failed" && (
        <>
          <p className="enq-confirm__error" role="alert" data-testid="ai-draft-failed">The draft could not be written. The message is unchanged.</p>
          <div className="enq-actions">
            <button type="button" className="enq-quiet" ref={retryRef} data-testid="ai-draft-retry" onClick={() => { ask(true); }}>Try again</button>
          </div>
        </>
      )}
      {ready !== null && draft !== null && (
        <section className="pr-ai__draft" data-register="ivory" aria-labelledby={headingId} data-testid="ai-draft-block">
          <p className="pr-ai__heading" id={headingId} ref={headingRef} tabIndex={-1}>
            <Sparkles aria-hidden="true" size={15} />
            <span className="pr-ai__chip" aria-hidden="true">Draft</span>
            AI draft of the message
          </p>
          <p className="pr-ai__about" data-testid="ai-draft-from">{drewOnWords(ready.drewOn)}</p>
          <textarea className="pr-ai__body" aria-label="AI draft of the message" data-testid="ai-draft-body" rows={6} readOnly value={draft.body} />
          {draft.safeLanguageApplied && <p className="pr-ai__about">Unsupported certainty was taken out of it.</p>}
          {claim !== null && (
            <p className="pr-ai__about" data-testid="ai-draft-claim">
              It includes "{claim}", which a proposal may not say. Change it before saving.
            </p>
          )}
          {tooLong && (
            <p className="pr-ai__about" data-testid="ai-draft-too-long">
              It is longer than a message can hold ({MAX_CLIENT_MESSAGE_LENGTH.toLocaleString("en-GB")} characters). Draft again, or copy what you need.
            </p>
          )}
          <div className="enq-actions">
            {!tooLong && (
              <button type="button" className="enq-quiet" data-testid="ai-draft-use" aria-disabled={!canUse}
                onClick={() => { if (canUse) { onUse(draft.body, document.activeElement); setStep({ kind: "idle" }); } }}>
                Use as the message
              </button>
            )}
            {tooLong && (
              <button type="button" className="enq-quiet" data-testid="ai-draft-again" onClick={() => { ask(true); }}>Draft again</button>
            )}
            <button type="button" className="enq-quiet" data-testid="ai-draft-away"
              onClick={() => { askedFrom.current = document.activeElement; setStep({ kind: "idle" }); setFocusTo("button"); }}>
              Put it away
            </button>
          </div>
        </section>
      )}
    </div>
  );
}
