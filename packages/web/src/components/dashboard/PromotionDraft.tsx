import { useEffect, useId, useState, type ReactElement } from "react";
import type { PromotionDraft as PromotionDraftData } from "@omnitwin/types";
import { getPromotionDraft } from "../../api/diary.js";
import { ApiError } from "../../api/client.js";
import { ActivityStatus } from "../shared/Activity.js";

// ---------------------------------------------------------------------------
// The drafted email for a hold that has become 1st option (Blake, 26 Sep:
// "given a drafted email to their client to review and send. Nothing is sent
// automatically").
//
// It opens inside the notification it belongs to, never as a dialog over the
// popover. The words can be changed here; "Open in your email" starts a new
// message in the person's own email with these words, and they send it from
// there. Venviewer sends nothing.
// ---------------------------------------------------------------------------

/** A `mailto:` link carrying the address (when one is recorded), subject and
 *  body. Spaces are %20, not "+", so every mail program reads them. */
export function draftMailto(to: string | null, subject: string, body: string): string {
  const params = [`subject=${encodeURIComponent(subject)}`, `body=${encodeURIComponent(body)}`].join("&");
  return `mailto:${to === null ? "" : encodeURIComponent(to)}?${params}`;
}

const SOURCE_WORDS: Readonly<Record<NonNullable<PromotionDraftData["to"]>["source"], string>> = {
  client_contact: "the client's main contact",
  enquiry: "from the enquiry",
};

type DraftState =
  | { readonly kind: "loading" }
  | { readonly kind: "ready"; readonly draft: PromotionDraftData }
  | { readonly kind: "error"; readonly message: string };

export interface PromotionDraftProps {
  readonly bookingId: string;
}

export function PromotionDraft({ bookingId }: PromotionDraftProps): ReactElement {
  const [state, setState] = useState<DraftState>({ kind: "loading" });
  const [body, setBody] = useState("");
  const [attempt, setAttempt] = useState(0);
  const [copied, setCopied] = useState<"idle" | "copied" | "failed">("idle");
  const bodyId = useId();
  const consequenceId = useId();

  useEffect(() => {
    const controller = new AbortController();
    setState({ kind: "loading" });
    getPromotionDraft(bookingId, controller.signal)
      .then((draft) => {
        setState({ kind: "ready", draft });
        setBody(draft.body);
      })
      .catch((error: unknown) => {
        if (controller.signal.aborted) return;
        // A hold that has moved on says so in the server's own words, which
        // are written for this reader; anything else is a plain retry.
        const message = error instanceof ApiError && error.status === 409
          ? error.message
          : "The draft could not be prepared.";
        setState({ kind: "error", message });
      });
    return () => { controller.abort(); };
  }, [bookingId, attempt]);

  useEffect(() => {
    if (copied === "idle") return;
    const timer = window.setTimeout(() => { setCopied("idle"); }, 4000);
    return () => { window.clearTimeout(timer); };
  }, [copied]);

  if (state.kind === "loading") {
    return <ActivityStatus className="vv-draft-note">Preparing the draft…</ActivityStatus>;
  }
  if (state.kind === "error") {
    return (
      <div className="vv-draft">
        <p className="vv-draft-note" role="alert">{state.message}</p>
        <div className="vv-draft-actions">
          <button type="button" className="vv-notifications-button" onClick={() => { setAttempt((n) => n + 1); }}>
            Try again
          </button>
        </div>
      </div>
    );
  }

  const { draft } = state;
  const copy = (): void => {
    const text = `${draft.subject}\n\n${body}`;
    try {
      // The clipboard is absent outside a secure page; that is a failure to
      // say, not an error to throw.
      void navigator.clipboard.writeText(text)
        .then(() => { setCopied("copied"); })
        .catch(() => { setCopied("failed"); });
    } catch {
      setCopied("failed");
    }
  };

  return (
    <div className="vv-draft">
      <dl className="vv-draft-facts">
        <div>
          <dt>To</dt>
          <dd>
            {draft.to === null
              ? "No client email is recorded on this hold. Add one to the enquiry, or choose the address in your own email."
              : `${draft.to.name}, ${draft.to.email} (${SOURCE_WORDS[draft.to.source]})`}
          </dd>
        </div>
        <div>
          <dt>Subject</dt>
          <dd>{draft.subject}</dd>
        </div>
      </dl>
      <label className="vv-draft-label" htmlFor={bodyId}>Email</label>
      <textarea
        id={bodyId}
        className="vv-draft-body"
        value={body}
        rows={10}
        spellCheck
        aria-describedby={consequenceId}
        onChange={(event) => { setBody(event.target.value); }}
      />
      <p id={consequenceId} className="vv-draft-note">
        Open in your email starts a new message with these words. Nothing is sent until you send it.
      </p>
      <div className="vv-draft-actions">
        <a className="vv-notifications-button" href={draftMailto(draft.to?.email ?? null, draft.subject, body)}>
          Open in your email
        </a>
        <button type="button" className="vv-notifications-button" onClick={copy}>
          Copy
        </button>
        <span className="vv-draft-copied" role="status">
          {copied === "copied" ? "Copied." : copied === "failed" ? "Copy did not work here; select the words and copy them." : ""}
        </span>
      </div>
    </div>
  );
}
