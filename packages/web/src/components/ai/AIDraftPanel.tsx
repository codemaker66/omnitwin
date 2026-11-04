import { useCallback, useEffect, useState, type ReactElement } from "react";
import { Bot, ShieldCheck } from "lucide-react";
import { ActivityIndicator } from "../shared/Activity.js";
import type { AIDraft, AIDraftUseCase, CanonicalJsonValue } from "@omnitwin/types";
import { createAIDraft, getAIAssistantStatus } from "../../api/ai-assistant.js";
import { ApiError } from "../../api/client.js";
import { withheldWords } from "../../lib/ai-draft-words.js";
import "./AIDraftPanel.css";

type StatusState =
  | { readonly kind: "loading" }
  | { readonly kind: "ready"; readonly configured: boolean; readonly message: string }
  | { readonly kind: "error"; readonly message: string };

type DraftState =
  | { readonly kind: "idle" }
  | { readonly kind: "loading" }
  | { readonly kind: "ready"; readonly draft: AIDraft }
  | { readonly kind: "error"; readonly message: string };

// A draft is asked for one of two ways: with the context this screen holds,
// sent to POST /ai/drafts (which takes contact details, names and ids out of
// it before a provider reads it), or by a request whose context the server
// builds from its own record, as an enquiry's summary is (release audit ai-1).
type DraftSource =
  | { readonly context: Record<string, CanonicalJsonValue>; readonly requestedTone?: string; readonly request?: never }
  | { readonly request: () => Promise<AIDraft>; readonly context?: never; readonly requestedTone?: never };

type AIDraftPanelProps = DraftSource & {
  readonly title: string;
  readonly useCase: AIDraftUseCase;
  readonly actionLabel?: string;
};

/** Why no draft came, in the panel's words. A server-built draft can be
 *  refused for what it would be drawn from; a draft can fail to be written
 *  (the AI did not answer, or its words could not be shown once a price,
 *  availability or capacity was taken out); anything else is the AI being
 *  unavailable. The work carries on by hand. */
function failureWords(error: unknown): string {
  if (error instanceof ApiError && error.status === 422 && error.code === "NOTHING_TO_DRAFT_FROM") {
    return "There is nothing to draft from yet: no event details or words from the guest. Continue with manual review.";
  }
  if (error instanceof ApiError && error.status === 404) {
    return "A draft is made only for the venue you work at. Continue with manual review.";
  }
  if (error instanceof ApiError && error.status === 502) {
    return "The draft could not be written. Continue with manual review.";
  }
  return "AI draft generation is unavailable. Continue with manual review.";
}

export function AIDraftPanel({
  title,
  useCase,
  context,
  requestedTone,
  request,
  actionLabel = "Generate draft",
}: AIDraftPanelProps): ReactElement | null {
  const [status, setStatus] = useState<StatusState>({ kind: "loading" });
  const [draftState, setDraftState] = useState<DraftState>({ kind: "idle" });

  useEffect(() => {
    let cancelled = false;
    getAIAssistantStatus()
      .then((result) => {
        if (cancelled) return;
        setStatus({
          kind: "ready",
          configured: result.configured,
          message: result.configured
            ? "AI drafts available"
            : result.disabledReason ?? "AI drafts are not configured.",
        });
      })
      .catch(() => {
        if (!cancelled) {
          setStatus({ kind: "error", message: "AI draft status is unavailable." });
        }
      });
    return () => { cancelled = true; };
  }, []);

  const handleGenerate = useCallback(() => {
    if (status.kind !== "ready" || !status.configured) return;
    setDraftState({ kind: "loading" });
    const asked = request !== undefined ? request() : createAIDraft({ useCase, context, requestedTone });
    asked
      .then((draft) => { setDraftState({ kind: "ready", draft }); })
      .catch((error: unknown) => {
        setDraftState({ kind: "error", message: failureWords(error) });
      });
  }, [context, request, requestedTone, status, useCase]);

  // No provider, no panel. An always-disabled "Generate draft" button was a
  // dead end on every surface that mounts this, so the panel only exists once
  // /ai/status says a provider is configured. While the status is unknown —
  // still loading, or the check itself failed — nothing renders rather than a
  // control that cannot work.
  if (status.kind !== "ready" || !status.configured) return null;

  const disabled = draftState.kind === "loading";
  const withheld = draftState.kind === "ready" ? withheldWords(draftState.draft.withheldCommitments) : null;

  return (
    <section className="ai-draft-panel" aria-label={`${title} AI draft panel`}>
      <div className="ai-draft-panel__header">
        <span className="ai-draft-panel__icon"><Bot aria-hidden="true" size={18} /></span>
        <div>
          <h3>{title}</h3>
          <p>AI draft · unverified. Human review required.</p>
        </div>
      </div>

      <div className="ai-draft-panel__status" role="status">
        <ShieldCheck aria-hidden="true" size={16} />
        <span>{status.message}</span>
      </div>

      <button
        type="button"
        className="ai-draft-panel__button"
        disabled={disabled}
        aria-busy={draftState.kind === "loading"}
        onClick={handleGenerate}
      >
        {draftState.kind === "loading" && <ActivityIndicator size={20} />}
        {draftState.kind === "loading" ? "Generating draft" : actionLabel}
      </button>

      {draftState.kind === "error" && (
        <p className="ai-draft-panel__error" role="alert">{draftState.message}</p>
      )}

      {draftState.kind === "ready" && (
        <div className="ai-draft-panel__draft">
          <div className="ai-draft-panel__meta">
            <span>{draftState.draft.provenance.replace(/_/gu, " ")}</span>
            <span>{draftState.draft.evidenceStatus}</span>
          </div>
          <label>
            <span>{draftState.draft.title}</span>
            <textarea value={draftState.draft.body} readOnly rows={7} />
          </label>
          {draftState.draft.safeLanguageApplied && (
            <p className="ai-draft-panel__note">
              Unsupported certainty was removed.
            </p>
          )}
          {withheld !== null && (
            <p className="ai-draft-panel__note" data-testid="ai-draft-withheld">
              {withheld}
            </p>
          )}
        </div>
      )}
    </section>
  );
}
