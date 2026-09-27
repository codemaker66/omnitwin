import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState, type FormEvent, type ReactElement } from "react";
import { useParams } from "react-router-dom";
import { ApiError } from "../api/client.js";
import {
  approveProposalShare,
  commentOnProposalShare,
  getPublicProposal,
  getProposalShare,
  respondToProposal,
  type ProposalResponseAction,
  type PublicProposal,
} from "../api/proposals.js";
import { ProposalDocument } from "../components/proposal/ProposalDocument.js";
import {
  commentAuthor, conversation, documentMoney, documentTitle, venueLongDate,
} from "../components/proposal/proposal-document-format.js";
import { ActivityIndicator, ActivityStatus } from "../components/shared/Activity.js";
import { useLatestRequest } from "../hooks/use-latest-request.js";

// ---------------------------------------------------------------------------
// The client's proposal page (roadmap X1; T-427 phase 3): the proposal as an
// ivory document, and at its foot the client's decision. Accepting asks for
// the name it is given in; asking for changes asks what. Every answer names
// the version the client read, so a page older than the version now sent
// cannot accept it unseen: the API refuses, and the page reads the proposal
// again and keeps what was typed. The two actions are exactly the ones the
// state machine grants a client on a sent proposal.
// ---------------------------------------------------------------------------

type LoadState =
  | { readonly kind: "loading" }
  | { readonly kind: "error" }
  | { readonly kind: "ready"; readonly proposal: PublicProposal };

/** What this visit's own answer did, said where the buttons were. */
type Outcome = "accepted" | "changes_requested";

const OUTCOME_WORDS: Readonly<Record<Outcome, string>> = {
  accepted: "You accepted this version. The venue team has been told.",
  changes_requested: "Your changes went to the venue team. This version is on hold until they send the next one.",
};

const REFUSED_WORDS: Readonly<Record<string, string>> = {
  PROPOSAL_VERSION_CHANGED: "A newer version arrived after you opened this page. It is shown above now; what you typed is still here.",
  PROPOSAL_STATUS_CHANGED: "This proposal changed while your answer was on its way. It now shows where it stands; what you typed is still here.",
};

const FAILED_WORDS = "Your answer did not reach the venue team. Please try again, or contact them directly.";

export function ProposalPage(): ReactElement {
  const { shareCode, token } = useParams<{ shareCode?: string; token?: string }>();
  const hasToken = token !== undefined && token.length > 0;
  const [state, setState] = useState<LoadState>({ kind: "loading" });
  const reads = useLatestRequest();

  const read = useCallback((): Promise<PublicProposal | null> => {
    const owns = reads.begin();
    const loader = hasToken ? getProposalShare(token) : shareCode !== undefined && shareCode.length > 0 ? getPublicProposal(shareCode) : null;
    if (loader === null) {
      setState({ kind: "error" });
      return Promise.resolve(null);
    }
    return loader.then(
      (proposal) => { if (owns()) setState({ kind: "ready", proposal }); return proposal; },
      () => { if (owns()) setState((current) => current.kind === "ready" ? current : { kind: "error" }); return null; },
    );
  }, [hasToken, reads, shareCode, token]);

  useEffect(() => { void read(); }, [read]);

  useEffect(() => {
    if (state.kind === "ready") document.title = documentTitle(state.proposal);
  }, [state]);

  if (state.kind === "loading") {
    return (
      <main aria-label="Client proposal" className="pd-page" data-register="ivory">
        <div className="pd-sheet pd-state"><ActivityStatus variant="panel">Opening the proposal…</ActivityStatus></div>
      </main>
    );
  }

  if (state.kind === "error") {
    return (
      <main aria-label="Client proposal" className="pd-page" data-register="ivory">
        <div className="pd-sheet pd-state">
          <h1>This proposal link isn't available</h1>
          <p>The link may have expired or been withdrawn. Please ask the venue team who sent it for a current copy.</p>
        </div>
      </main>
    );
  }

  return (
    <main aria-label="Client proposal">
      <ProposalDocument
        proposal={state.proposal}
        conversation={hasToken ? <Conversation proposal={state.proposal} token={token} onPosted={read} /> : null}
        decision={<Decision proposal={state.proposal} token={hasToken ? token : null} shareCode={shareCode ?? null} onAnswered={read} />}
      />
    </main>
  );
}

// ---------------------------------------------------------------------------
// The decision
// ---------------------------------------------------------------------------

interface DecisionProps {
  readonly proposal: PublicProposal;
  readonly token: string | null;
  readonly shareCode: string | null;
  /** Reads the proposal again, as it now stands. */
  readonly onAnswered: () => Promise<PublicProposal | null>;
}

function Decision({ proposal, token, shareCode, onAnswered }: DecisionProps): ReactElement | null {
  const headingId = useId();
  const nameId = useId();
  const nameHelpId = useId();
  const nameErrorId = useId();
  const noteId = useId();
  const [name, setName] = useState("");
  const [nameMissing, setNameMissing] = useState(false);
  const [asking, setAsking] = useState(false);
  const [note, setNote] = useState("");
  const [working, setWorking] = useState<ProposalResponseAction | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  const [outcome, setOutcome] = useState<Outcome | null>(null);
  const outcomeRef = useRef<HTMLParagraphElement | null>(null);
  const noteRef = useRef<HTMLTextAreaElement | null>(null);
  const nameRef = useRef<HTMLInputElement | null>(null);

  // The buttons are gone once the answer lands, so the sentence that replaces
  // them takes focus.
  useLayoutEffect(() => { if (outcome !== null) outcomeRef.current?.focus(); }, [outcome]);
  useEffect(() => { if (asking) noteRef.current?.focus(); }, [asking]);

  if (outcome !== null) {
    return (
      <section className="pd-decision" data-register="forest" aria-labelledby={headingId}>
        <h2 id={headingId}>Your decision</h2>
        <p ref={outcomeRef} tabIndex={-1} className="pd-decision__outcome" role="status">{OUTCOME_WORDS[outcome]}</p>
      </section>
    );
  }
  if (proposal.status !== "sent") return null;

  // The older six-letter link has nowhere to keep a name.
  const asksName = token !== null;
  const total = proposal.quote === null ? null : documentMoney(proposal.quote.totalMinor, proposal.quote.currency);

  const answer = async (action: ProposalResponseAction): Promise<void> => {
    if (working !== null) return;
    setWorking(action);
    setFailure(null);
    try {
      const version = proposal.version;
      if (token !== null) {
        if (action === "accept") await approveProposalShare(token, { authorName: name.trim(), version });
        else await commentOnProposalShare(token, { body: note.trim(), kind: "request_changes", version });
      } else if (shareCode !== null) {
        await respondToProposal(shareCode, action, action === "request_changes" ? note.trim() : undefined, version);
      } else {
        throw new Error("Missing proposal link");
      }
      await onAnswered();
      setOutcome(action === "accept" ? "accepted" : "changes_requested");
    } catch (error: unknown) {
      const refused = error instanceof ApiError ? REFUSED_WORDS[error.code] : undefined;
      setFailure(refused ?? FAILED_WORDS);
      if (refused !== undefined) void onAnswered();
    } finally {
      setWorking(null);
    }
  };

  const accept = (event: FormEvent): void => {
    event.preventDefault();
    if (asksName && name.trim() === "") {
      setNameMissing(true);
      nameRef.current?.focus();
      return;
    }
    setNameMissing(false);
    void answer("accept");
  };

  const requestChanges = (event: FormEvent): void => {
    event.preventDefault();
    if (note.trim() === "") return;
    void answer("request_changes");
  };

  return (
    <section className="pd-decision" data-register="forest" aria-labelledby={headingId} data-testid="proposal-decision">
      <h2 id={headingId}>Your decision</h2>
      <p className="pd-decision__what">
        {total === null ? `Version ${String(proposal.version)}.` : `Version ${String(proposal.version)} comes to ${total}.`}
      </p>

      <form className="pd-decision__step" onSubmit={accept} noValidate>
        {asksName && (
          <label className="pd-field" htmlFor={nameId}>
            Your name
            <input
              ref={nameRef}
              id={nameId}
              name="name"
              autoComplete="name"
              value={name}
              maxLength={200}
              required
              aria-invalid={nameMissing}
              aria-describedby={nameMissing ? `${nameHelpId} ${nameErrorId}` : nameHelpId}
              onChange={(event) => { setName(event.target.value); if (event.target.value.trim() !== "") setNameMissing(false); }}
            />
          </label>
        )}
        {asksName && <p id={nameHelpId} className="pd-decision__hint">So the venue team knows who accepted it.</p>}
        {nameMissing && <p id={nameErrorId} className="pd-decision__error">Please give your name to accept.</p>}
        <div className="pd-actions">
          <button type="submit" className="pd-button" disabled={working !== null} aria-busy={working === "accept"} data-testid="accept-button">
            {working === "accept" && <ActivityIndicator size={18} />}
            {working === "accept" ? "Accepting…" : `Accept version ${String(proposal.version)}`}
          </button>
        </div>
        <p className="pd-decision__consequence">
          The venue team is told at once. Accepting does not hold the date or take a payment.
        </p>
      </form>

      <div className="pd-decision__step">
        {!asking ? (
          <div className="pd-actions">
            <button type="button" className="pd-quiet" aria-expanded={false} disabled={working !== null} onClick={() => { setAsking(true); }}
              data-testid="ask-changes-button">
              Ask for changes…
            </button>
          </div>
        ) : (
          <form onSubmit={requestChanges} className="pd-decision__step" noValidate>
            <label className="pd-field" htmlFor={noteId}>
              What would you like changed?
              <textarea ref={noteRef} id={noteId} value={note} maxLength={1000} rows={4}
                onChange={(event) => { setNote(event.target.value); }} data-testid="changes-note" />
            </label>
            <p className="pd-decision__hint">This version is put on hold until the venue team sends the next one.</p>
            <div className="pd-actions">
              <button type="submit" className="pd-button" disabled={working !== null || note.trim() === ""}
                aria-busy={working === "request_changes"} data-testid="send-changes-button">
                {working === "request_changes" && <ActivityIndicator size={18} />}
                {working === "request_changes" ? "Sending…" : "Send to the venue team"}
              </button>
              <button type="button" className="pd-quiet" disabled={working !== null} onClick={() => { setAsking(false); }}>
                Not now
              </button>
            </div>
          </form>
        )}
      </div>

      {failure !== null && <p role="alert" className="pd-decision__error">{failure}</p>}
    </section>
  );
}

// ---------------------------------------------------------------------------
// The conversation (links only; the older share code has no comment route)
// ---------------------------------------------------------------------------

function Conversation({ proposal, token, onPosted }: {
  readonly proposal: PublicProposal;
  readonly token: string;
  readonly onPosted: () => Promise<PublicProposal | null>;
}): ReactElement | null {
  const headingId = useId();
  const fieldId = useId();
  const [text, setText] = useState("");
  const [posting, setPosting] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const thread = conversation(proposal.comments);
  const open = proposal.status === "sent" || proposal.status === "changes_requested";
  if (thread.length === 0 && !open) return null;

  const post = (event: FormEvent): void => {
    event.preventDefault();
    if (posting || text.trim() === "") return;
    setPosting(true);
    setFailure(null);
    commentOnProposalShare(token, { body: text.trim(), kind: "comment" })
      .then(() => onPosted())
      .then(() => { setText(""); })
      .catch(() => { setFailure("Your message was not posted. It is still here; please try again."); })
      .finally(() => { setPosting(false); });
  };

  return (
    <section className="pd-conversation pd-section" aria-labelledby={headingId} data-testid="proposal-comments">
      <h2 id={headingId}>Conversation</h2>
      {thread.length > 0 && (
        <ol className="pd-thread">
          {thread.map((comment, index) => (
            <li key={index} data-from={comment.from ?? (comment.authorName === "Venue team" ? "venue" : "client")}>
              <p className="pd-thread__who">
                <strong>{commentAuthor(comment)}</strong>{venueLongDate(comment.createdAt) === null ? "" : ` · ${venueLongDate(comment.createdAt) ?? ""}`}
              </p>
              <p className="pd-thread__body">{comment.body}</p>
            </li>
          ))}
        </ol>
      )}
      {open && (
        <form onSubmit={post} noValidate>
          <label className="pd-field" htmlFor={fieldId}>
            A message for the venue team
            <textarea id={fieldId} data-testid="comment-input" value={text} maxLength={4000} rows={3}
              onChange={(event) => { setText(event.target.value); }} />
          </label>
          <div className="pd-actions">
            <button type="submit" className="pd-quiet" data-testid="comment-submit" disabled={posting || text.trim() === ""} aria-busy={posting}>
              {posting && <ActivityIndicator size={18} />}
              {posting ? "Sending…" : "Send the message"}
            </button>
          </div>
          {failure !== null && <p role="alert" className="pd-decision__error">{failure}</p>}
        </form>
      )}
    </section>
  );
}
