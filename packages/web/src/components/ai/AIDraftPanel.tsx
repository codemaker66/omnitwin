import { useCallback, useEffect, useState, type ReactElement } from "react";
import { Bot, RefreshCw, ShieldCheck } from "lucide-react";
import type { AIDraft, AIDraftUseCase, CanonicalJsonValue } from "@omnitwin/types";
import { createAIDraft, getAIAssistantStatus } from "../../api/ai-assistant.js";
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

interface AIDraftPanelProps {
  readonly title: string;
  readonly useCase: AIDraftUseCase;
  readonly context: Record<string, CanonicalJsonValue>;
  readonly requestedTone?: string;
  readonly actionLabel?: string;
}

export function AIDraftPanel({
  title,
  useCase,
  context,
  requestedTone,
  actionLabel = "Generate draft",
}: AIDraftPanelProps): ReactElement {
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
            ? `Provider configured: ${result.provider ?? "configured"} / ${result.model ?? "model set"}`
            : result.disabledReason ?? "AI drafts are disabled until provider environment is configured.",
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
    createAIDraft({ useCase, context, requestedTone })
      .then((draft) => { setDraftState({ kind: "ready", draft }); })
      .catch(() => {
        setDraftState({
          kind: "error",
          message: "AI draft generation is unavailable. Continue with manual review.",
        });
      });
  }, [context, requestedTone, status, useCase]);

  const disabled = status.kind !== "ready" || !status.configured || draftState.kind === "loading";

  return (
    <section className="ai-draft-panel" aria-label={`${title} AI draft panel`}>
      <div className="ai-draft-panel__header">
        <span className="ai-draft-panel__icon"><Bot aria-hidden="true" size={18} /></span>
        <div>
          <h3>{title}</h3>
          <p>Draft only. AI-generated text remains unverified and requires human review.</p>
        </div>
      </div>

      <div className="ai-draft-panel__status" role="status">
        <ShieldCheck aria-hidden="true" size={16} />
        <span>
          {status.kind === "loading" ? "Checking AI draft configuration." : status.message}
        </span>
      </div>

      <button
        type="button"
        className="ai-draft-panel__button"
        disabled={disabled}
        onClick={handleGenerate}
      >
        {draftState.kind === "loading" && <RefreshCw aria-hidden="true" size={16} className="ai-draft-panel__spin" />}
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
            <span>Human review required</span>
          </div>
          <label>
            <span>{draftState.draft.title}</span>
            <textarea value={draftState.draft.body} readOnly rows={7} />
          </label>
          {draftState.draft.safeLanguageApplied && (
            <p className="ai-draft-panel__note">
              Unsafe certainty wording was replaced before this draft was shown.
            </p>
          )}
        </div>
      )}
    </section>
  );
}
