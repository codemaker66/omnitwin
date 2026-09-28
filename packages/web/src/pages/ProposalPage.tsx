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
// cannot accept it unseen. Whenever the API refuses an answer because the
// proposal has moved on, the page reads it again and says what it now finds,
// keeping what was typed. A newer version, or the same one sent again, that
// arrives by any read is said so before it can be answered. The two actions
// are exactly the ones the state machine grants a client on a sent proposal.
// ---------------------------------------------------------------------------

type LoadState =
  | { readonly kind: "loading" }
  | { readonly kind: "error" }
  | { readonly kind: "ready"; readonly proposal: PublicProposal };

/** What this visit's own answer did, said where the buttons were. */
type Outcome = "accepted" | "already_accepted" | "changes_requested";

const OUTCOME_WORDS: Readonly<Record<Outcome, string>> = {
  accepted: "You accepted this version. The venue team has been told.",
  already_accepted: "This version had already been accepted. Nothing more is needed.",
  changes_requested: "Your changes went to the venue team. This version is on hold until they send the next one.",
};

/** Why an answer did not land: a newer version, a proposal that moved on,
 *  or a failure to arrive. The words are chosen once the proposal has been
 *  read again, from what the page then shows, so they are never about a form
 *  that is gone. */
type Failure = "version" | "moved" | "failed";

/** A refusal, whether the proposal could then be read again, and the send
 *  (version and when it was sent) the page showed once it was. */
interface Refusal {
  readonly why: Failure;
  readonly reread: boolean;
  readonly version: number;
  readonly sentAt: string | null;
}

function failureOf(error: unknown): Failure {
  if (!(error instanceof ApiError)) return "failed";
  if (error.code === "PROPOSAL_VERSION_CHANGED") return "version";
  if (error.code === "PROPOSAL_STATUS_CHANGED" || error.code === "NOT_AWAITING_RESPONSE" || error.code === "INVALID_TRANSITION") return "moved";
  if (error.status === 404 || error.status === 410) return "moved";
  return "failed";
}

const NO_LONGER_WAITING = "This proposal is no longer waiting for an answer. It now shows where it stands.";
const NEWER_VERSION = "A newer version was sent after you opened this page. It is shown above now.";
const SENT_AGAIN = "The venue team sent this version to you again. You can answer it below.";

/** The words for a failed answer, beside a form that is still there. */
const OPEN_FAILURE_WORDS: Readonly<Record<Failure, string>> = {
  version: "A newer version arrived after you opened this page. It is shown above now; what you typed is still here.",
  moved: "This proposal changed while your answer was on its way. It is shown above now; what you typed is still here.",
  failed: "Your answer did not reach the venue team. Please try again, or contact them directly.",
};

/** A refusal whose proposal could not be read again: nothing newer is shown. */
const UNREAD_WORDS = "Your answer was not taken, because this proposal changed while it was on its way. Please reload the page to see it as it stands; what you typed is still here.";

export function ProposalPage(): ReactElement {
  const { shareCode, token } = useParams<{ shareCode?: string; token?: string }>();
  const hasToken = token !== undefined && token.length > 0;
  const [state, setState] = useState<LoadState>({ kind: "loading" });
  // Words an answer or a message carried when it was refused, kept only when
  // the read that refusal made finds the link closed, so the closed page
  // gives back exactly what did not reach the venue team.
  const [kept, setKept] = useState<string | null>(null);
  const reads = useLatestRequest();
  const unavailableRef = useRef<HTMLHeadingElement | null>(null);
  const wasReady = useRef(false);

  const read = useCallback((words: string | null = null): Promise<PublicProposal | null> => {
    const owns = reads.begin();
    const loader = hasToken ? getProposalShare(token) : shareCode !== undefined && shareCode.length > 0 ? getPublicProposal(shareCode) : null;
    if (loader === null) {
      setState({ kind: "error" });
      return Promise.resolve(null);
    }
    return loader.then(
      (proposal) => { if (owns()) setState({ kind: "ready", proposal }); return proposal; },
      (error: unknown) => {
        // A link withdrawn or retired is no longer the client's to read; a
        // read that only failed to arrive keeps the page as it was.
        const closed = error instanceof ApiError && (error.status === 404 || error.status === 410);
        if (owns()) {
          setState((current) => current.kind === "ready" && !closed ? current : { kind: "error" });
          if (closed) setKept(words);
        }
        return null;
      },
    );
  }, [hasToken, reads, shareCode, token]);

  useEffect(() => { void read(); }, [read]);

  useEffect(() => {
    if (state.kind === "ready") document.title = documentTitle(state.proposal);
  }, [state]);

  // A link that closes while the page is open takes the focus to the sentence
  // that says so, since the form that had it is gone.
  useEffect(() => {
    if (state.kind === "error" && wasReady.current) unavailableRef.current?.focus();
    wasReady.current = state.kind === "ready";
  }, [state.kind]);

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
          <h1 ref={unavailableRef} tabIndex={-1}>This proposal link isn't available</h1>
          <p>The link may have expired or been withdrawn. Please ask the venue team who sent it for a current copy.</p>
          {kept !== null && (
            <div className="pd-state__kept">
              <p>What you wrote, to send the venue team another way:</p>
              <blockquote className="pd-decision__kept" data-testid="kept-words">{kept}</blockquote>
            </div>
          )}
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
  /** Reads the proposal again, as it now stands; words a refused answer
   *  carried are kept should that read find the link closed. */
  readonly onAnswered: (words?: string | null) => Promise<PublicProposal | null>;
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
  const [failure, setFailure] = useState<Refusal | null>(null);
  // What this visit's answer did, for the send it was given on: the version,
  // and when it was sent, since the same version can be sent again.
  const [outcome, setOutcome] = useState<{ readonly kind: Outcome; readonly version: number; readonly sentAt: string | null } | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [seen, setSeen] = useState<{ readonly version: number; readonly sentAt: string | null }>({ version: proposal.version, sentAt: proposal.sentAt });
  const [returnFocus, setReturnFocus] = useState<ProposalResponseAction | null>(null);
  const outcomeRef = useRef<HTMLParagraphElement | null>(null);
  const noteRef = useRef<HTMLTextAreaElement | null>(null);
  const nameRef = useRef<HTMLInputElement | null>(null);
  const askRef = useRef<HTMLButtonElement | null>(null);
  const acceptRef = useRef<HTMLButtonElement | null>(null);
  const sendRef = useRef<HTMLButtonElement | null>(null);
  const refusalRef = useRef<HTMLParagraphElement | null>(null);
  const backToAsk = useRef(false);

  // A new send reached by any read (a message's, a refused answer's) is said
  // so before it can be answered, and an earlier answer or refusal no longer
  // describes it. A refusal whose own read brought the send already says so,
  // as it will once an answer still on its way has been read again.
  if (proposal.version !== seen.version || proposal.sentAt !== seen.sentAt) {
    setSeen({ version: proposal.version, sentAt: proposal.sentAt });
    const refusalSaysIt = failure !== null && failure.version === proposal.version && failure.sentAt === proposal.sentAt;
    if (proposal.status === "sent" && working === null && !refusalSaysIt) {
      setFailure(null);
      setNotice(proposal.version !== seen.version ? NEWER_VERSION : SENT_AGAIN);
    }
  }
  const answered = outcome !== null && outcome.version === proposal.version && outcome.sentAt === proposal.sentAt ? outcome.kind : null;

  // The buttons are gone once the answer lands, so the sentence that replaces
  // them takes focus.
  useLayoutEffect(() => { if (answered !== null) outcomeRef.current?.focus(); }, [answered]);
  useEffect(() => {
    if (asking) noteRef.current?.focus();
    else if (backToAsk.current) { backToAsk.current = false; askRef.current?.focus(); }
  }, [asking]);
  // After a failed answer, focus returns to the button pressed, or to the
  // sentence that replaced the form.
  useEffect(() => {
    if (returnFocus === null) return;
    setReturnFocus(null);
    if (proposal.status === "sent") (returnFocus === "accept" ? acceptRef : sendRef).current?.focus();
    else refusalRef.current?.focus();
  }, [returnFocus, proposal.status]);

  if (answered !== null) {
    return (
      <section className="pd-decision" data-register="forest" aria-labelledby={headingId}>
        <h2 id={headingId}>Your decision</h2>
        <p ref={outcomeRef} tabIndex={-1} className="pd-decision__outcome" role="status">{OUTCOME_WORDS[answered]}</p>
      </section>
    );
  }
  if (proposal.status !== "sent") {
    // Refused because the proposal moved on: say so where the buttons were,
    // and keep what was written so it can reach the venue team another way.
    if (failure === null) return null;
    return (
      <section className="pd-decision" data-register="forest" aria-labelledby={headingId}>
        <h2 id={headingId}>Your decision</h2>
        <p ref={refusalRef} tabIndex={-1} role="alert" className="pd-decision__error">{NO_LONGER_WAITING}</p>
        {note.trim() !== "" && (
          <>
            <p className="pd-decision__hint">What you wrote, to send the venue team another way:</p>
            <blockquote className="pd-decision__kept" data-testid="kept-note">{note}</blockquote>
          </>
        )}
      </section>
    );
  }

  // The older six-letter link has nowhere to keep a name.
  const asksName = token !== null;
  const total = proposal.quote === null ? null : documentMoney(proposal.quote.totalMinor, proposal.quote.currency);

  const answer = async (action: ProposalResponseAction): Promise<void> => {
    if (working !== null) return;
    setWorking(action);
    setFailure(null);
    setNotice(null);
    const { version, sentAt } = proposal;
    try {
      let already = false;
      if (token !== null) {
        if (action === "accept") already = (await approveProposalShare(token, { authorName: name.trim(), version })).already === true;
        else await commentOnProposalShare(token, { body: note.trim(), kind: "request_changes", version });
      } else if (shareCode !== null) {
        await respondToProposal(shareCode, action, action === "request_changes" ? note.trim() : undefined, version);
      } else {
        throw new Error("Missing proposal link");
      }
      // The answer stands on the send it landed on: the one the page showed,
      // or, when the proposal was sent again meanwhile with this version, the
      // one the read shows the answer settled. A read that shows it sent is a
      // send after the answer, which the answer no longer describes.
      const shown = await onAnswered();
      const landed = shown !== null && shown.status !== "sent" && shown.version === version ? shown.sentAt : sentAt;
      setOutcome({ kind: action === "accept" ? already ? "already_accepted" : "accepted" : "changes_requested", version, sentAt: landed });
      // The request is in the thread now; should the outcome give way to a
      // new send, the form comes back empty rather than holding it unsent.
      if (action === "request_changes") {
        setNote("");
        setAsking(false);
      }
    } catch (error: unknown) {
      const why = failureOf(error);
      // Refused, the proposal is read again first, and the words then chosen
      // from what that read shows.
      const words = action === "request_changes" && note.trim() !== "" ? note.trim() : null;
      const shown = why === "failed" ? null : await onAnswered(words);
      setFailure({
        why, reread: why === "failed" || shown !== null,
        version: shown?.version ?? version, sentAt: shown === null ? sentAt : shown.sentAt,
      });
      setReturnFocus(action);
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
      {notice !== null && <p className="pd-decision__notice" role="status">{notice}</p>}
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
        {nameMissing && <p id={nameErrorId} role="alert" className="pd-decision__error">Please give your name to accept.</p>}
        <div className="pd-actions">
          <button ref={acceptRef} type="submit" className="pd-button" disabled={working !== null} aria-busy={working === "accept"} data-testid="accept-button">
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
            <button ref={askRef} type="button" className="pd-quiet" aria-expanded={false} disabled={working !== null} onClick={() => { setAsking(true); }}
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
              <button ref={sendRef} type="submit" className="pd-button" disabled={working !== null || note.trim() === ""}
                aria-busy={working === "request_changes"} data-testid="send-changes-button">
                {working === "request_changes" && <ActivityIndicator size={18} />}
                {working === "request_changes" ? "Sending…" : "Send to the venue team"}
              </button>
              <button type="button" className="pd-quiet" disabled={working !== null}
                onClick={() => { backToAsk.current = true; setAsking(false); }}>
                Not now
              </button>
            </div>
          </form>
        )}
      </div>

      {failure !== null && (
        <p role="alert" className="pd-decision__error">{failure.reread ? OPEN_FAILURE_WORDS[failure.why] : UNREAD_WORDS}</p>
      )}
    </section>
  );
}

// ---------------------------------------------------------------------------
// The conversation (links only; the older share code has no comment route)
// ---------------------------------------------------------------------------

function Conversation({ proposal, token, onPosted }: {
  readonly proposal: PublicProposal;
  readonly token: string;
  /** Reads the proposal again; words a refused message carried are kept
   *  should that read find the link closed. */
  readonly onPosted: (words?: string | null) => Promise<PublicProposal | null>;
}): ReactElement | null {
  const headingId = useId();
  const fieldId = useId();
  const [text, setText] = useState("");
  const [posting, setPosting] = useState(false);
  const [failure, setFailure] = useState<Refusal | null>(null);
  const [returnFocus, setReturnFocus] = useState(false);
  const fieldRef = useRef<HTMLTextAreaElement | null>(null);
  const refusalRef = useRef<HTMLParagraphElement | null>(null);
  const thread = conversation(proposal.comments);
  const open = proposal.status === "sent" || proposal.status === "changes_requested";
  // A message that did not post stays on the page, whatever became of the
  // proposal meanwhile.
  const kept = !open && failure !== null && text.trim() !== "";

  useEffect(() => {
    if (!returnFocus) return;
    setReturnFocus(false);
    if (open) fieldRef.current?.focus();
    else refusalRef.current?.focus();
  }, [returnFocus, open]);

  if (thread.length === 0 && !open && !kept) return null;

  const post = (event: FormEvent): void => {
    event.preventDefault();
    if (posting || text.trim() === "") return;
    setPosting(true);
    setFailure(null);
    commentOnProposalShare(token, { body: text.trim(), kind: "comment" })
      .then(() => onPosted())
      .then(() => { setText(""); })
      .catch(async (error: unknown) => {
        // Refused, the proposal is read again first, and the words then
        // chosen from what that read shows.
        const why = failureOf(error);
        const shown = why === "failed" ? null : await onPosted(text.trim());
        setFailure({ why, reread: why === "failed" || shown !== null, version: shown?.version ?? proposal.version, sentAt: shown?.sentAt ?? proposal.sentAt });
        setReturnFocus(true);
      })
      .finally(() => { setPosting(false); });
  };

  // Chosen from what the page now shows: open, the message can go again.
  const words = !open
    ? "This proposal is no longer taking messages here."
    : failure?.why === "failed"
      ? "Your message was not posted. It is still here; please try again."
      : failure?.reread === false
        ? "Your message was not posted, because this proposal changed while it was on its way. Please reload the page to see it as it stands; your message is still here."
        : "This proposal changed while your message was on its way. It is still here; you can send it again.";

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
      {kept && (
        <>
          <p ref={refusalRef} tabIndex={-1} role="alert" className="pd-decision__error">{words}</p>
          <p className="pd-decision__hint">What you wrote, to send the venue team another way:</p>
          <blockquote className="pd-decision__kept" data-testid="kept-message">{text}</blockquote>
        </>
      )}
      {open && (
        <form onSubmit={post} noValidate>
          <label className="pd-field" htmlFor={fieldId}>
            A message for the venue team
            <textarea ref={fieldRef} id={fieldId} data-testid="comment-input" value={text} maxLength={4000} rows={3}
              onChange={(event) => { setText(event.target.value); }} />
          </label>
          <div className="pd-actions">
            <button type="submit" className="pd-quiet" data-testid="comment-submit" disabled={posting || text.trim() === ""} aria-busy={posting}>
              {posting && <ActivityIndicator size={18} />}
              {posting ? "Sending…" : "Send the message"}
            </button>
          </div>
          {failure !== null && <p role="alert" className="pd-decision__error">{words}</p>}
        </form>
      )}
    </section>
  );
}
