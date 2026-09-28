import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState, type KeyboardEvent, type ReactElement, type RefObject } from "react";
import { LAYOUT_STYLES, occasionLabel, type LayoutStyle, type ProposalNextVersion } from "@omnitwin/types";
import { ArrowLeft, ArrowUpRight, ChevronDown, ChevronUp, X } from "lucide-react";
import type { DeskProposal, ProposalCommentRow, ProposalHistoryEntry, StaffProposalVersion } from "../../../api/proposals.js";
import type { Space } from "../../../api/spaces.js";
import type { WrittenDraft } from "./proposal-memory.js";
import { formatMinorAsCurrency } from "../../../lib/money-input.js";
import { buildProposalCapacityGuidance, buildProposalCapacityNote, CAPACITY_STYLE_LABELS } from "../../../lib/proposal-capacity-note.js";
import { ActivityIndicator, ActivityStatus } from "../../shared/Activity.js";
import { eventDateParts, eventLead, eventWeekday, venueMoment } from "../enquiries/enquiry-desk-format.js";
import {
  EMPTY_LINE, checkIsFor, composerLayoutLine, composerStartWords, draftChanges, draftDiffers, draftFromVersion, droppedChanges, historyMoments,
  layoutFact, linkOpenedSentence, linkVersionWords, notCarriedWords, putAsideWords, type ComposerDraft, type KeptVersion, type QuoteLineDraft,
  type TakenCheck,
} from "./proposals-desk-format.js";
import { ProposalChip } from "./ProposalsStages.js";

// ---------------------------------------------------------------------------
// One proposal in the forest panel beside the ledger: who it is for and what
// it comes to, the one next step its status allows (sending asks first, in
// place), the next version starting from the last one and saying what it
// changes, the conversation with the client and what happened to it.
// ---------------------------------------------------------------------------

/** A read of part of the proposal, kept apart so each can fail and be asked
 *  again on its own. */
export interface PartRead<T> {
  readonly status: "loading" | "ready" | "error";
  /** What was last read for this proposal, kept while it is read again. */
  readonly value: T | null;
}

export interface PanelNavigation {
  readonly layout: "wide" | "single";
  readonly canPrevious: boolean;
  readonly canNext: boolean;
  readonly onClose: () => void;
  readonly onStep: (direction: 1 | -1) => void;
}

/** What the panel is doing, so only that control waits. */
export type ProposalWork = "link" | "withdraw" | "archive" | "version" | "reply" | null;

export interface ProposalFailure {
  readonly where: "step" | "version" | "reply";
  readonly message: string;
  /** For a version: the composer whose save failed. */
  readonly composer?: number;
  /** The proposal had moved on, so it is being read again. */
  readonly moved?: boolean;
}

/** The words in this proposal's composer, remembered for the visit
 *  (proposal-memory.ts), so leaving the proposal loses nothing. */
export interface DraftMemory {
  readonly recall: () => WrittenDraft | null;
  readonly remember: (written: WrittenDraft | null) => void;
}

export interface ProposalPanelProps {
  readonly proposal: DeskProposal;
  /** The proposal itself is being read again, quietly. */
  readonly refreshing: boolean;
  readonly nowMs: number;
  readonly navigation: PanelNavigation;
  readonly headingRef: RefObject<HTMLHeadingElement>;
  readonly announcement: string | null;
  readonly stampKey: number | null;
  readonly latest: PartRead<StaffProposalVersion>;
  /** What a version saved now would take that the latest does not show its
   *  client; read while the composer is open. */
  readonly next: PartRead<ProposalNextVersion>;
  /** The last check made for the proposal as it now reads, whether or not it
   *  is said: a save is held to it, so it takes nothing unseen. */
  readonly lastCheck: ProposalNextVersion | null;
  /** A check that could not be made is being made again. */
  readonly checkRetrying: boolean;
  readonly onRetryCheck: () => void;
  readonly memory: DraftMemory | null;
  /** Said when words are kept to copy, apart from what a step says. */
  readonly keptNote: string | null;
  readonly history: PartRead<readonly ProposalHistoryEntry[]>;
  readonly comments: PartRead<readonly ProposalCommentRow[]>;
  readonly spaces: PartRead<readonly Space[]>;
  /** The client's link, once made in this visit; links are kept hashed, so
   *  one made earlier can never be shown again. */
  readonly shareUrl: string | null;
  /** Versions that did not save, each kept to copy once the composer that
   *  wrote it is gone. */
  readonly keptDrafts: readonly KeptVersion[];
  readonly working: ProposalWork;
  readonly failure: ProposalFailure | null;
  /** Each resolves true once done, so the panel can put its question away. */
  readonly onMakeLink: () => Promise<boolean>;
  readonly onTransition: (to: "withdrawn" | "archived") => Promise<boolean>;
  /** `composer` names the composer saving, which still holds the words
   *  should the version not save. `basedOn` is the version the words started
   *  from (0 for the first), so a version saved meanwhile by someone else is
   *  never replaced unseen. `basis` is the check the composer showed, so the
   *  version takes nothing it did not say. */
  readonly onSaveVersion: (draft: ComposerDraft, composer: number, basedOn: number, basis?: string) => Promise<boolean>;
  /** A composer the proposal moved on from, with its words if they differed
   *  from where it started: kept to copy, saying why. Says whether any were
   *  kept (a composer's own save keeps or saves its words instead). */
  readonly onComposerGone: (composer: number, draft: ComposerDraft | null, why: string) => boolean;
  /** Puts a composer's words aside to copy as it starts again. */
  readonly onStartAgain: (composer: number, draft: ComposerDraft, fromVersion: number | null) => void;
  /** Puts one kept version away once it has been copied. */
  readonly onDiscardKept: (composer: number) => void;
  readonly onReply: (body: string) => Promise<boolean>;
  readonly onRetryLatest: () => void;
  readonly onRetryHistory: () => void;
  readonly onRetryComments: () => void;
  readonly onOpenDeal: ((opportunityId: string) => void) | null;
}

const LINKABLE = ["draft", "changes_requested", "sent"];
/** The statuses whose content can change, so a next version can be written. */
export const COMPOSABLE: readonly string[] = ["draft", "changes_requested"];
const WITHDRAWABLE = ["draft", "sent", "changes_requested"];
const ARCHIVABLE = ["accepted", "declined", "expired", "withdrawn"];

function isEditable(target: EventTarget): boolean {
  return target instanceof HTMLTextAreaElement || target instanceof HTMLInputElement
    || target instanceof HTMLSelectElement || (target instanceof HTMLElement && target.isContentEditable);
}

function money(minor: number, currency: string): string {
  return formatMinorAsCurrency(minor, currency).replace(/\.00$/u, "");
}

/** The composer form on screen: which composer, starting from which version. */
interface FormOnScreen {
  readonly composer: number;
  readonly start: number;
}

/** A composer form says it is there, and gives its words while they differ
 *  from where it started. */
type ReportForm = (form: FormOnScreen, written: WrittenDraft | null) => void;

/** The version the composer form starts from; "closed" once the proposal is
 *  out of the booker's hands; "reading" while the version to start from is
 *  read. A new form starts whenever this changes. */
type ComposerStart = number | "closed" | "reading";

function composerStart(proposal: DeskProposal, latest: PartRead<StaffProposalVersion>): ComposerStart {
  if (!COMPOSABLE.includes(proposal.status)) return "closed";
  if (proposal.currentVersion > 0 && latest.value === null) return "reading";
  return latest.value?.version ?? 0;
}

export function ProposalPanel(props: ProposalPanelProps): ReactElement {
  const { proposal, navigation, headingRef, memory, onComposerGone } = props;
  const headingId = useId();
  const occasion = occasionLabel(proposal.eventType);
  const context = proposal.dealTitle ?? occasion;
  const sectionRef = useRef<HTMLElement>(null);

  // Words written in a composer the proposal then moves on from (a version
  // saved elsewhere, or the proposal sent or closed meanwhile) are kept to
  // copy, with why, unless its own save took them. So are words remembered
  // from an earlier visit that no longer start where the composer does; those
  // that still do carry on in it. Watched from here, where the proposal stays
  // open while its composer changes.
  const composable = COMPOSABLE.includes(proposal.status);
  const start = composerStart(proposal, props.latest);
  const formRef = useRef<FormOnScreen | null>(null);
  const focusKeptRef = useRef(false);
  const report = useCallback<ReportForm>((form, written) => {
    formRef.current = form;
    memory?.remember(written);
  }, [memory]);
  useLayoutEffect(() => {
    // Until the version to start from is read, nothing has yet moved on.
    if (start === "reading") return;
    const why = putAsideWords(proposal.status, composable, typeof start === "number" ? start : proposal.currentVersion);
    let kept = false;
    const form = formRef.current;
    if (form !== null && form.start !== start) {
      formRef.current = null;
      const written = memory?.recall() ?? null;
      const own = written !== null && written.composer === form.composer ? written : null;
      if (own !== null) memory?.remember(null);
      kept = onComposerGone(form.composer, own?.draft ?? null, why);
    }
    const left = memory?.recall() ?? null;
    if (left !== null && left.start !== start) {
      memory?.remember(null);
      kept = onComposerGone(left.composer, left.draft, why) || kept;
    }
    if (kept) focusKeptRef.current = true;
  }, [start, composable, proposal.status, proposal.currentVersion, memory, onComposerGone]);
  // Focus that was in the composer is lost with it: it goes to the words kept.
  useEffect(() => {
    if (!focusKeptRef.current) return;
    const kept = sectionRef.current?.querySelector<HTMLElement>("[data-kept-heading]") ?? null;
    if (kept === null) return;
    focusKeptRef.current = false;
    const active = document.activeElement;
    if (active === null || active === document.body) kept.focus();
  });

  const step = (event: KeyboardEvent<HTMLElement>): void => {
    if (event.altKey || event.ctrlKey || event.metaKey || isEditable(event.target)) return;
    if (event.key !== "j" && event.key !== "k") return;
    event.preventDefault();
    navigation.onStep(event.key === "j" ? 1 : -1);
  };

  return (
    <section ref={sectionRef} className="enq-panel pr-panel" data-register="forest" aria-labelledby={headingId} onKeyDown={step}>
      <div className="enq-panel__body">
        <div className="enq-panel__bar">
          {navigation.layout === "single" ? (
            <button type="button" className="enq-back" onClick={navigation.onClose}>
              <ArrowLeft size={16} aria-hidden="true" /> Back to proposals
            </button>
          ) : (
            <div className="enq-steps">
              <button type="button" className="enq-back" onClick={() => { navigation.onStep(-1); }}
                disabled={!navigation.canPrevious} aria-keyshortcuts="k">
                <ChevronUp size={16} aria-hidden="true" /> Previous
              </button>
              <button type="button" className="enq-back" onClick={() => { navigation.onStep(1); }}
                disabled={!navigation.canNext} aria-keyshortcuts="j">
                <ChevronDown size={16} aria-hidden="true" /> Next
              </button>
            </div>
          )}
          {navigation.layout === "wide" && (
            <button type="button" className="enq-close" onClick={navigation.onClose} aria-label="Close proposal" aria-keyshortcuts="Escape">
              <X size={18} aria-hidden="true" />
            </button>
          )}
        </div>

        <p className="enq-eyebrow">Proposal{context === null ? "" : ` · ${context}`}</p>
        <h2 className="enq-panel__name" id={headingId} ref={headingRef} tabIndex={-1}>{proposal.title}</h2>
        <div className="enq-panel__status">
          <ProposalChip key={props.stampKey ?? "still"} status={proposal.status} stamped={props.stampKey !== null} />
          <span className="pr-version">
            {proposal.currentVersion === 0 ? "Nothing written yet" : `Version ${String(proposal.currentVersion)}`}
            {props.latest.value !== null && proposal.currentVersion > 0
              ? `, saved ${venueMoment(props.latest.value.createdAt) ?? ""}` : ""}
            {linkVersionWords(proposal)}
          </span>
        </div>
        <p className="vv-sr-only" role="status">{props.announcement}</p>
        <p className="vv-sr-only" role="status" data-testid="kept-note">{props.keptNote}</p>
        {props.refreshing && <ActivityStatus className="enq-panel__activity">Refreshing the proposal…</ActivityStatus>}

        <Facts proposal={proposal} nowMs={props.nowMs} />
        {proposal.opportunityId !== null && props.onOpenDeal !== null && (
          <div className="enq-actions pr-deal">
            <button type="button" className="enq-quiet" onClick={() => { if (proposal.opportunityId !== null) props.onOpenDeal?.(proposal.opportunityId); }}>
              Open the deal in the pipeline <ArrowUpRight size={14} aria-hidden="true" />
            </button>
          </div>
        )}

        <NextStep {...props} />
        {start === "closed" ? <KeptDraft {...props} holder={null} /> : <Composer {...props} start={start} report={report} />}
        <LatestQuote {...props} />
        <Conversation {...props} />
        <History {...props} />
      </div>
    </section>
  );
}

// ---------------------------------------------------------------------------
// Who it is for, when, and what it comes to
// ---------------------------------------------------------------------------

function Facts({ proposal, nowMs }: { readonly proposal: DeskProposal; readonly nowMs: number }): ReactElement {
  const date = eventDateParts(proposal.eventDate);
  const weekday = eventWeekday(proposal.eventDate);
  const lead = eventLead(proposal.eventDate, nowMs);
  const layout = layoutFact(proposal, COMPOSABLE.includes(proposal.status));
  return (
    <dl className="enq-facts pr-facts">
      <div>
        <dt>{date === null ? "Date" : `${weekday ?? ""}${lead === null ? "" : `, ${lead}`}`}</dt>
        <dd className={date === null ? "enq-facts__muted" : undefined}>{date === null ? "To be confirmed" : `${date.day} ${date.month} ${date.year}`}</dd>
      </div>
      <div>
        <dt>for</dt>
        <dd className={proposal.clientName === null ? "enq-facts__muted" : undefined}>{proposal.clientName ?? "No client named"}</dd>
      </div>
      <div>
        <dt>guests</dt>
        <dd className={proposal.guestCount === null ? "enq-facts__muted" : undefined}>
          {proposal.guestCount === null ? "To come" : proposal.guestCount.toLocaleString("en-GB")}
        </dd>
      </div>
      <div>
        <dt>comes to</dt>
        <dd className={proposal.latestTotalMinor === null ? "enq-facts__muted" : undefined}>
          {proposal.latestTotalMinor === null ? "No quote yet" : money(proposal.latestTotalMinor, proposal.latestCurrency ?? "GBP")}
          {/* Once out, the figure is the one the client was sent. */}
          {proposal.latestTotalMinor !== null && !COMPOSABLE.includes(proposal.status)
            && (proposal.sentVersion ?? null) !== null && proposal.sentVersion !== proposal.currentVersion
            ? `, as sent in version ${String(proposal.sentVersion)}` : ""}
        </dd>
      </div>
      {layout !== null && (
        <div className="pr-facts__layout">
          <dt>layout</dt>
          <dd className={layout.muted ? "enq-facts__muted" : "enq-facts__room"} data-testid="proposal-layout">{layout.words}</dd>
        </div>
      )}
    </dl>
  );
}

// ---------------------------------------------------------------------------
// The one next step, asked first where it cannot be taken back
// ---------------------------------------------------------------------------

function NextStep({ proposal, shareUrl, working, failure, onMakeLink, onTransition }: ProposalPanelProps): ReactElement {
  const headingId = useId();
  const questionId = useId();
  const [asking, setAsking] = useState<"link" | "withdraw" | null>(null);
  const [copied, setCopied] = useState<"copied" | "failed" | null>(null);
  const sent = proposal.status === "sent";
  // A version saved since the one the client's link shows goes with the link.
  const sendsNewer = sent && proposal.sentVersion !== null && proposal.sentVersion !== proposal.currentVersion;
  const canLink = LINKABLE.includes(proposal.status) && proposal.currentVersion >= 1;
  const busy = working !== null;

  // Once the link is made, focus goes to copying it, the booker's next step,
  // unless they have moved on meanwhile.
  const copyRef = useRef<HTMLButtonElement>(null);
  const focusCopyRef = useRef(false);
  useEffect(() => {
    if (!focusCopyRef.current || shareUrl === null) return;
    focusCopyRef.current = false;
    const active = document.activeElement;
    if (active === null || active === document.body) copyRef.current?.focus();
  });
  const makeLink = (): void => {
    void onMakeLink().then((made) => {
      if (!made) return;
      focusCopyRef.current = true;
      setAsking(null);
    });
  };
  const withdraw = (): void => {
    void onTransition("withdrawn").then((done) => { if (done) setAsking(null); });
  };
  const copy = (): void => {
    if (shareUrl === null) return;
    // A browser that refuses the clipboard says so, rather than nothing.
    const clipboard = typeof navigator === "undefined" ? undefined : navigator.clipboard as Clipboard | undefined;
    if (clipboard === undefined) { setCopied("failed"); return; }
    void clipboard.writeText(shareUrl).then(() => { setCopied("copied"); }, () => { setCopied("failed"); });
  };

  return (
    <section className="enq-section enq-next" aria-labelledby={headingId}>
      <h3 id={headingId}>Next step</h3>

      {shareUrl !== null && (
        <div className="pr-link">
          <p className="pr-link__label">The client's link</p>
          {/* Shown to copy, not to follow: opening it here would read as the
              client opening it. Preview as the client below reads it safely. */}
          <p className="pr-link__url" data-testid="share-link">{shareUrl}</p>
          <div className="enq-actions">
            <button type="button" className="enq-quiet" ref={copyRef} onClick={copy}>{copied === "copied" ? "Copied" : "Copy the link"}</button>
          </div>
          {copied === "failed" && (
            <p className="enq-confirm__error" role="alert">This browser would not copy it. Select the link above and copy it by hand.</p>
          )}
          <p className="enq-next__hint" data-testid="share-link-note">Not emailed. Copy it into your message to the client.</p>
        </div>
      )}
      {sent && <p className="enq-next__hint" data-testid="link-opened">{linkOpenedSentence(proposal.linkOpenedAt, proposal.hasLink)}</p>}
      {shareUrl === null && sent && (
        <p className="enq-next__hint" data-testid="share-link-unavailable">
          It is with the client. Links are kept hashed, so theirs cannot be shown again; issue a new one if they need it.
          Any link they have keeps working.
        </p>
      )}
      {!canLink && COMPOSABLE.includes(proposal.status) && (
        <p className="enq-next__hint">Write the first version below, then send it.</p>
      )}

      <div className="enq-actions">
        {canLink && (
          <button type="button" className="enq-cta" data-testid="send-open" aria-expanded={asking === "link"} disabled={busy}
            onClick={() => { setAsking((open) => open === "link" ? null : "link"); }}>
            {sent ? "Issue a new link…" : "Send to the client…"}
          </button>
        )}
        {proposal.currentVersion >= 1 && (
          // A tab of its own, so a version being written here is never lost.
          <a className="enq-quiet pr-preview" href={`/proposal-preview/${encodeURIComponent(proposal.id)}`} target="_blank" rel="noopener noreferrer"
            data-testid="preview-link">
            Preview as the client <ArrowUpRight size={14} aria-hidden="true" />
            <span className="vv-sr-only"> (opens in a new tab)</span>
          </a>
        )}
        {WITHDRAWABLE.includes(proposal.status) && (
          <button type="button" className="enq-quiet" data-testid="withdraw-button" aria-expanded={asking === "withdraw"} disabled={busy}
            onClick={() => { setAsking((open) => open === "withdraw" ? null : "withdraw"); }}>
            Withdraw…
          </button>
        )}
        {ARCHIVABLE.includes(proposal.status) && (
          <button type="button" className="enq-quiet" data-testid="archive-button" disabled={busy} aria-busy={working === "archive"}
            onClick={() => { void onTransition("archived"); }}>
            {working === "archive" && <ActivityIndicator size={18} />}
            {working === "archive" ? "Archiving…" : "Archive"}
          </button>
        )}
      </div>

      {asking === "link" && canLink && (
        <div className="enq-confirm" data-tone="review" role="group" aria-labelledby={questionId}>
          <p id={questionId} className="enq-confirm__question">
            {sendsNewer ? `Send version ${String(proposal.currentVersion)} in a new link?`
              : sent ? "Issue a new link?" : `Send version ${String(proposal.currentVersion)} to ${proposal.clientName ?? "the client"}?`}
          </p>
          <p className="enq-next__hint" data-testid="send-consequence">
            {sendsNewer
              ? `Links the client already has will show version ${String(proposal.currentVersion)} too. Nothing is emailed; you send the link.`
              : sent
              ? "Links the client already has keep working. Nothing is emailed; you send the link."
              : "Making the link marks the proposal Sent. Nothing is emailed; you send the link."}
          </p>
          <div className="enq-actions">
            <button type="button" className="enq-cta" data-testid="send-button" disabled={busy} aria-busy={working === "link"} onClick={makeLink}>
              {working === "link" && <ActivityIndicator size={18} />}
              {working === "link" ? "Making the link…" : sent ? "Issue the link" : "Make the link"}
            </button>
            <button type="button" className="enq-quiet" disabled={busy} onClick={() => { setAsking(null); }}>Not yet</button>
          </div>
        </div>
      )}
      {asking === "withdraw" && WITHDRAWABLE.includes(proposal.status) && (
        <div className="enq-confirm" data-tone="declined" role="group" aria-labelledby={questionId} data-testid="withdraw-confirm">
          <p id={questionId} className="enq-confirm__question">Withdraw this proposal? The client's link will stop working.</p>
          <div className="enq-actions">
            <button type="button" className="enq-cta" data-testid="withdraw-confirm-button" disabled={busy} aria-busy={working === "withdraw"} onClick={withdraw}>
              {working === "withdraw" && <ActivityIndicator size={18} />}
              {working === "withdraw" ? "Withdrawing…" : "Withdraw"}
            </button>
            <button type="button" className="enq-quiet" disabled={busy} onClick={() => { setAsking(null); }}>Keep it</button>
          </div>
        </div>
      )}
      {failure?.where === "step" && <p className="enq-confirm__error" role="alert">{failure.message}</p>}
    </section>
  );
}

// ---------------------------------------------------------------------------
// The next version, starting from the last one
// ---------------------------------------------------------------------------

interface ComposerProps extends ProposalPanelProps {
  /** The version the form starts from (composerStart). */
  readonly start: Exclude<ComposerStart, "closed">;
  readonly report: ReportForm;
}

interface ComposerFormProps extends ComposerProps {
  readonly start: number;
  /** This form began with Start again: its message field takes focus. */
  readonly startedAgain: boolean;
  /** Starts a new composer from where this one started. */
  readonly onFresh: () => void;
  /** Its message field has taken focus, so no later form does. */
  readonly onFocused: () => void;
}

function Composer(props: ComposerProps): ReactElement {
  const { proposal, latest, start } = props;
  // Starting again is a new composer, so the words put aside are shown to
  // copy beside it; its message field then takes focus to write afresh.
  const [again, setAgain] = useState({ count: 0, focus: false });
  // Until the version to start from has been read once, the form waits; read
  // again later, the form it started stays.
  if (start === "reading") {
    const headingId = `compose-${proposal.id}`;
    return (
      <>
        <KeptDraft {...props} holder={null} />
        <section className="enq-section" aria-labelledby={headingId}>
          <h3 id={headingId}>Version {String(proposal.currentVersion + 1)}</h3>
          {latest.status === "loading" ? (
            <ActivityStatus>Reading version {String(proposal.currentVersion)} to start from…</ActivityStatus>
          ) : (
            <>
              <p className="enq-confirm__error" role="alert" data-testid="latest-version-error">
                Version {String(proposal.currentVersion)} could not be read, so the next one cannot start from it yet.
              </p>
              <div className="enq-actions">
                <button type="button" className="enq-quiet" onClick={props.onRetryLatest}>Try again</button>
              </div>
            </>
          )}
        </section>
      </>
    );
  }
  // A new version starts from the latest one, read again whenever that changes.
  return (
    <ComposerForm key={`${proposal.id}:${String(start)}:${String(again.count)}`} {...props} start={start} startedAgain={again.focus}
      onFresh={() => { setAgain((current) => ({ count: current.count + 1, focus: true })); }}
      onFocused={() => { setAgain((current) => current.focus ? { ...current, focus: false } : current); }} />
  );
}

/** Versions that did not save: what was written, to copy, with why it did
 *  not save. While the composer that wrote one is there, that composer is its
 *  copy; once it is gone (the proposal moved on, or the composer started again
 *  from the proposal as it now is) the words are shown here until they are
 *  put away or a version saves. `holder` is the composer beside it, if any. */
function KeptDraft({ proposal, keptDrafts, failure, onDiscardKept, holder }: ProposalPanelProps & { readonly holder: number | null }): ReactElement | null {
  const headingId = useId();
  const shown = keptDrafts.filter((kept) => kept.composer !== holder);
  if (shown.length === 0) return null;
  const composing = COMPOSABLE.includes(proposal.status);
  // Words put aside unsaved were never sent to be saved, so they are not
  // called a version that did not save.
  const refused = shown.every((kept) => kept.why === null);
  const title = !refused ? "What you were writing" : shown.length === 1 ? "The version that did not save" : "The versions that did not save";
  return (
    <section className="enq-section" aria-labelledby={headingId} data-testid="kept-version">
      <h3 id={headingId} tabIndex={-1} data-kept-heading="">{title}</h3>
      {!composing && failure?.where === "version" && <p className="enq-confirm__error" role="alert">{failure.message}</p>}
      <p className="enq-next__hint">What you wrote is kept here to copy.</p>
      {shown.map(({ draft, composer, why }) => {
        const lines = draft.lines.filter((line) => line.description.trim() !== "");
        return (
          <div key={composer} className="pr-kept__one">
            {why !== null && <p className="enq-next__hint" data-testid="kept-version-why">{why}</p>}
            {draft.message.trim() !== "" && <p className="pr-kept">{draft.message}</p>}
            {draft.capacityNote.trim() !== "" && <p className="pr-kept">Capacity: {draft.capacityNote}</p>}
            {lines.length > 0 && (
              <ul className="pr-kept__lines">
                {lines.map((line, index) => (
                  <li key={index}>{line.description} · {line.quantity} × £{line.pounds === "" ? "0" : line.pounds}</li>
                ))}
              </ul>
            )}
            <div className="enq-actions">
              <button type="button" className="enq-quiet" data-testid="kept-version-clear" onClick={() => { onDiscardKept(composer); }}>
                Clear this copy
              </button>
            </div>
          </div>
        );
      })}
    </section>
  );
}

/** Each composer is told apart, so a version it could not save is shown to
 *  copy only once it is gone. */
let composers = 0;

function ComposerForm(props: ComposerFormProps): ReactElement {
  const {
    proposal, latest, next: checkRead, lastCheck, checkRetrying, spaces, working, failure, memory, startedAgain,
    onSaveVersion, onRetryCheck, onStartAgain, onFresh, onFocused, report,
  } = props;
  const layoutLine = composerLayoutLine(proposal);
  const headingId = useId();
  const from = latest.value?.payload ?? null;
  // The version the words came from names the start and the next number: a
  // re-read still on its way, or one that failed, keeps the words it had.
  const basedOn = latest.value?.version ?? 0;
  // Words left here earlier this visit (another proposal was opened, or
  // another part of the dashboard) carry on where they were, in the composer
  // that wrote them, if they start where this one does.
  const [resumed] = useState(() => {
    const written = startedAgain ? null : memory?.recall() ?? null;
    return written !== null && written.start === basedOn ? written : null;
  });
  const [composer] = useState(() => {
    if (resumed !== null) return resumed.composer;
    composers += 1;
    return composers;
  });
  const [draft, setDraft] = useState<ComposerDraft>(() => resumed?.draft ?? draftFromVersion(from));
  const next = basedOn + 1;
  const changes = draftChanges(from, draft);
  // The panel knows this form, and its words while there is something to
  // lose, so they are kept should the proposal move on or be left.
  const differs = draftDiffers(from, draft);
  useEffect(() => {
    report({ composer, start: basedOn }, differs ? { composer, start: basedOn, draft } : null);
  }, [report, differs, composer, basedOn, draft]);
  // A reload or a closed tab would take them: the browser asks first.
  useEffect(() => {
    if (!differs) return;
    const protect = (event: BeforeUnloadEvent): void => { event.preventDefault(); };
    window.addEventListener("beforeunload", protect);
    return () => { window.removeEventListener("beforeunload", protect); };
  }, [differs]);
  const messageRef = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    if (!startedAgain) return;
    messageRef.current?.focus();
    onFocused();
  }, [startedAgain, onFocused]);
  const startAgain = (): void => {
    onStartAgain(composer, draft, from === null ? null : basedOn);
    onFresh();
  };
  // What the save would take, once checked against the version the words
  // came from: a check for another is not this one's, and one that could
  // not be made again says only what is typed.
  const check: TakenCheck = checkRead.status === "error" ? { status: "failed" }
    : checkRead.value !== null && checkRead.value.basedOn === basedOn ? { status: "ready", next: checkRead.value }
      : { status: "waiting" };
  const checked = checkIsFor(check, from === null ? null : basedOn);
  // The save is held to the last check made for these words' version, said
  // or not: one refused, or not made again, can only be refused, so a save
  // never takes what it was not shown.
  const heldTo = from !== null && lastCheck !== null && lastCheck.basedOn === basedOn ? lastCheck.basis : undefined;
  // Once checked, what the new version leaves out is said with the rest of
  // what it changes; until then, on its own line.
  const notCarried = checked ? null : notCarriedWords(from);
  const startId = useId();
  const notCarriedId = useId();
  const saving = working === "version";
  const lineRefs = useRef<(HTMLInputElement | null)[]>([]);
  const [focusLine, setFocusLine] = useState<number | null>(null);
  // Check again stays where it was pressed while it checks, so focus stays
  // with it. Answered, focus goes to what the start line now says; not
  // answered, it is said, and Check again is there to press again.
  const startRef = useRef<HTMLParagraphElement>(null);
  const retriedRef = useRef(false);
  const [checkSaid, setCheckSaid] = useState("");
  useEffect(() => {
    if (checkRetrying) {
      retriedRef.current = true;
      setCheckSaid("");
      return;
    }
    if (!retriedRef.current) return;
    retriedRef.current = false;
    if (check.status === "failed") {
      setCheckSaid("It still could not be checked.");
      return;
    }
    const active = document.activeElement;
    if (active === null || active === document.body) startRef.current?.focus();
  }, [checkRetrying, check.status]);

  useEffect(() => {
    if (focusLine === null) return;
    lineRefs.current[focusLine]?.focus();
    setFocusLine(null);
  }, [focusLine]);

  const setLine = (index: number, change: Partial<QuoteLineDraft>): void => {
    setDraft((current) => ({ ...current, lines: current.lines.map((line, at) => at === index ? { ...line, ...change } : line) }));
  };

  return (
    <>
      <KeptDraft {...props} holder={composer} />
      <section className="enq-section pr-compose" aria-labelledby={headingId} data-testid="composer">
        <h3 id={headingId}>Version {String(next)}</h3>
        <p className="enq-next__hint" id={startId} ref={startRef} tabIndex={-1} data-testid="composer-start">
          {composerStartWords(from === null ? null : basedOn, changes, check, droppedChanges(from))}
        </p>
        {from !== null && (check.status === "failed" || checkRetrying) && (
          <div className="enq-actions">
            <button type="button" className="enq-quiet" data-testid="composer-check-again" aria-disabled={checkRetrying}
              onClick={() => { if (!checkRetrying) onRetryCheck(); }}>
              {checkRetrying && <ActivityIndicator size={18} />}
              {checkRetrying ? "Checking…" : "Check again"}
            </button>
          </div>
        )}
        <p className="vv-sr-only" role="status" data-testid="composer-check-said">{checkSaid}</p>
        {notCarried !== null && <p className="enq-next__hint" id={notCarriedId} data-testid="composer-not-carried">{notCarried}</p>}

        <label className="pr-field">
          <span>Message to the client</span>
          <textarea ref={messageRef} data-testid="composer-message" rows={4} maxLength={4000} value={draft.message} disabled={saving}
            onChange={(event) => { setDraft((current) => ({ ...current, message: event.target.value })); }} />
        </label>
        <label className="pr-field">
          <span>Capacity note</span>
          <input data-testid="composer-capacity" maxLength={500} value={draft.capacityNote} disabled={saving}
            onChange={(event) => { setDraft((current) => ({ ...current, capacityNote: event.target.value })); }} />
        </label>
        <CapacityGuidance spaces={spaces} onInsert={(note) => { setDraft((current) => ({ ...current, capacityNote: note })); }} />

        <div className="pr-quote">
          <p className="pr-quote__title">Quote</p>
          {draft.lines.length === 0 && <p className="enq-next__hint">No lines. A version can go without a quote.</p>}
          {draft.lines.map((line, index) => (
            <div className="pr-line" key={index}>
              <input aria-label={`Line ${String(index + 1)} description`} data-testid={`quote-desc-${String(index)}`} placeholder="Grand Hall hire"
                ref={(element) => { lineRefs.current[index] = element; }} value={line.description} disabled={saving}
                onChange={(event) => { setLine(index, { description: event.target.value }); }} />
              <label className="pr-line__part">
                <span aria-hidden="true">Quantity</span>
                <input aria-label={`Line ${String(index + 1)} quantity`} data-testid={`quote-qty-${String(index)}`} inputMode="numeric"
                  value={line.quantity} disabled={saving} onChange={(event) => { setLine(index, { quantity: event.target.value }); }} />
              </label>
              <label className="pr-line__part">
                <span aria-hidden="true">Unit price, £</span>
                <input aria-label={`Line ${String(index + 1)} unit price (£)`} data-testid={`quote-price-${String(index)}`} inputMode="decimal"
                  placeholder="0.00" value={line.pounds} disabled={saving} onChange={(event) => { setLine(index, { pounds: event.target.value }); }} />
              </label>
              <button type="button" className="enq-quiet" aria-label={`Remove quote line ${String(index + 1)}`} disabled={saving}
                onClick={() => { setDraft((current) => ({ ...current, lines: current.lines.filter((_, at) => at !== index) })); }}>
                Remove
              </button>
            </div>
          ))}
          <div className="enq-actions">
            <button type="button" className="enq-quiet" data-testid="add-quote-line" disabled={saving}
              onClick={() => { setDraft((current) => ({ ...current, lines: [...current.lines, { ...EMPTY_LINE }] })); setFocusLine(draft.lines.length); }}>
              Add a line
            </button>
          </div>
        </div>

        {layoutLine !== null && <p className="enq-next__hint" data-testid="composer-layout">{layoutLine}</p>}
        <p className="enq-next__hint">Sending shares the latest saved version. Figures are planning estimates, without safety or compliance assurance.</p>
        {failure?.where === "version" && <p className="enq-confirm__error" role="alert" data-testid="composer-error">{failure.message}</p>}
        <div className="enq-actions">
          {/* Save is described by what the version starts from and changes, so
              it is heard at the moment of saving, however it came to change. */}
          <button type="button" className="enq-cta" data-testid="composer-save" disabled={saving || working !== null} aria-busy={saving}
            aria-describedby={notCarried === null ? startId : `${startId} ${notCarriedId}`}
            onClick={() => { void onSaveVersion(draft, composer, basedOn, heldTo); }}>
            {saving && <ActivityIndicator size={18} />}
            {saving ? "Saving…" : `Save version ${String(next)}`}
          </button>
          {/* Nothing written is thrown away: starting again keeps it to copy. */}
          {differs && (
            <button type="button" className="enq-quiet" data-testid="composer-start-again" disabled={saving || working !== null} onClick={startAgain}>
              {from === null ? "Start again" : `Start again from version ${String(basedOn)}`}
            </button>
          )}
        </div>
      </section>
    </>
  );
}

function CapacityGuidance({ spaces, onInsert }: { readonly spaces: PartRead<readonly Space[]>; readonly onInsert: (note: string) => void }): ReactElement | null {
  const rooms = spaces.value ?? [];
  const [spaceId, setSpaceId] = useState("");
  const [guests, setGuests] = useState("");
  const [style, setStyle] = useState<LayoutStyle>("dinner-rounds");
  if (spaces.status === "loading" && rooms.length === 0) return <ActivityStatus>Reading the rooms for guidance…</ActivityStatus>;
  // Guidance is a help, never a condition: without rooms the note is written by hand.
  if (rooms.length === 0) return null;
  const space = rooms.find((room) => room.id === spaceId) ?? rooms[0] ?? null;
  const area = space === null ? 0 : Number(space.widthM) * Number(space.lengthM);
  const guestCount = /^\d+$/u.test(guests.trim()) ? Number(guests.trim()) : 0;
  const guidance = space !== null && area > 0 ? buildProposalCapacityGuidance(area, guestCount, style) : null;
  return (
    <div className="pr-guidance">
      <p className="pr-guidance__title">Capacity guidance, planning-grade, from the room's floor area</p>
      <div className="pr-guidance__fields">
        <select aria-label="Guidance room" data-testid="capacity-space" value={space?.id ?? ""} onChange={(event) => { setSpaceId(event.target.value); }}>
          {rooms.map((room) => <option key={room.id} value={room.id}>{room.name}</option>)}
        </select>
        <input aria-label="Guidance guest count" data-testid="capacity-guests" inputMode="numeric" placeholder="Guests" value={guests}
          onChange={(event) => { setGuests(event.target.value); }} />
        <select aria-label="Guidance layout style" data-testid="capacity-style" value={style}
          onChange={(event) => { setStyle(event.target.value as LayoutStyle); }}>
          {LAYOUT_STYLES.map((option) => <option key={option} value={option}>{CAPACITY_STYLE_LABELS[option]}</option>)}
        </select>
      </div>
      {guidance !== null && space !== null && (
        <>
          <p className="enq-next__hint" data-testid="capacity-result">
            Comfortable for around {guidance.comfortableCapacity} guests
            {guidance.plannedSeats > 0 && `, ${String(guidance.plannedSeats)} asked for (${guidance.band.replace(/-/gu, " ")})`}
            . Planning estimate only; a person checks it.
          </p>
          <div className="enq-actions">
            <button type="button" className="enq-quiet" data-testid="capacity-insert"
              onClick={() => { onInsert(buildProposalCapacityNote(space.name, guidance)); }}>
              Insert into the capacity note
            </button>
          </div>
        </>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// The latest version's quote, the conversation, and what happened
// ---------------------------------------------------------------------------

function LatestQuote({ proposal, latest, onRetryLatest }: ProposalPanelProps): ReactElement | null {
  const headingId = useId();
  if (proposal.currentVersion === 0) return null;
  if (latest.status === "error" && COMPOSABLE.includes(proposal.status)) return null;
  if (latest.status === "error") {
    return (
      <section className="enq-section" aria-labelledby={headingId}>
        <h3 id={headingId}>Version {String(proposal.currentVersion)}</h3>
        <p className="enq-confirm__error" role="alert" data-testid="latest-version-error">Version {String(proposal.currentVersion)} could not be read.</p>
        <div className="enq-actions"><button type="button" className="enq-quiet" onClick={onRetryLatest}>Try again</button></div>
      </section>
    );
  }
  const quote = latest.value?.payload.quote ?? null;
  if (quote === null) return null;
  return (
    <section className="enq-section" aria-labelledby={headingId}>
      <h3 id={headingId}>Version {String(latest.value?.version ?? proposal.currentVersion)}'s quote</h3>
      <table className="pr-quote-table">
        <tbody>
          {quote.lineItems.map((item, index) => (
            <tr key={index}>
              <td>{item.description}</td>
              <td className="pr-num">{item.quantity}×</td>
              <td className="pr-num">{formatMinorAsCurrency(item.lineTotalMinor, quote.currency)}</td>
            </tr>
          ))}
          <tr className="pr-quote-table__total">
            <td colSpan={2}>Total</td>
            <td className="pr-num" data-testid="latest-quote-total">{formatMinorAsCurrency(quote.totalMinor, quote.currency)}</td>
          </tr>
        </tbody>
      </table>
    </section>
  );
}

function Conversation({ comments, working, failure, onReply, onRetryComments }: ProposalPanelProps): ReactElement {
  const headingId = useId();
  const [reply, setReply] = useState("");
  const rows = comments.value ?? [];
  const posting = working === "reply";
  const post = (): void => {
    void onReply(reply).then((posted) => { if (posted) setReply(""); });
  };
  return (
    <section className="enq-section" aria-labelledby={headingId} data-testid="proposal-conversation">
      <h3 id={headingId}>Conversation</h3>
      {comments.status === "loading" && (
        <ActivityStatus>{rows.length === 0 ? "Reading the conversation…" : "Reading the conversation again…"}</ActivityStatus>
      )}
      {comments.status === "error" ? (
        <div role="alert" data-testid="conversation-load-error">
          <p className="enq-confirm__error">Couldn't load the client conversation.</p>
          <div className="enq-actions"><button type="button" className="enq-quiet" onClick={onRetryComments}>Retry conversation</button></div>
        </div>
      ) : comments.status === "ready" && rows.length === 0 ? (
        <p className="enq-next__hint">No messages yet. What the client writes on their link appears here.</p>
      ) : rows.length > 0 && (
        <ol className="pr-thread" data-testid="conversation-thread">
          {rows.map((comment) => (
            <li key={comment.id} data-testid={`comment-${comment.authorType}`} data-author={comment.authorType}>
              <p className="pr-thread__who">
                <strong>{comment.authorType === "client" ? (comment.authorName ?? "The client") : (comment.authorName ?? "The venue team")}</strong>
                <span>{venueMoment(comment.createdAt) ?? ""}</span>
                {comment.kind === "request_changes" && <span className="pr-thread__asked">asked for changes</span>}
              </p>
              <p className="pr-thread__body">{comment.body}</p>
            </li>
          ))}
        </ol>
      )}
      <label className="pr-field">
        <span>Reply to the client</span>
        <textarea data-testid="reply-input" rows={2} maxLength={4000} value={reply} disabled={posting}
          placeholder="Shown to the client on their link" onChange={(event) => { setReply(event.target.value); }} />
      </label>
      {failure?.where === "reply" && <p className="enq-confirm__error" role="alert" data-testid="reply-error">{failure.message}</p>}
      <div className="enq-actions">
        <button type="button" className="enq-quiet" data-testid="reply-submit" disabled={working !== null || reply.trim() === ""} aria-busy={posting} onClick={post}>
          {posting && <ActivityIndicator size={18} />}
          {posting ? "Posting…" : "Post the reply"}
        </button>
      </div>
    </section>
  );
}

function History({ proposal, history, onRetryHistory }: ProposalPanelProps): ReactElement {
  const headingId = useId();
  const rows = history.value ?? [];
  const moments = historyMoments(rows, proposal.createdAt);
  return (
    <section className="enq-section" aria-labelledby={headingId}>
      <h3 id={headingId}>History</h3>
      {history.status === "loading" && <ActivityStatus>{rows.length === 0 ? "Reading the history…" : "Reading the history again…"}</ActivityStatus>}
      {history.status === "error" ? (
        <div role="alert" data-testid="history-load-error">
          <p className="enq-confirm__error">Couldn't load this proposal's status history.</p>
          <div className="enq-actions"><button type="button" className="enq-quiet" onClick={onRetryHistory}>Retry history</button></div>
        </div>
      ) : (history.status === "ready" || rows.length > 0) && (
        <ol className="enq-timeline">
          {moments.map((moment) => (
            <li key={moment.key}>
              <span className="enq-dot" aria-hidden="true" />
              <strong>{moment.sentence}</strong>
              {moment.quote !== null && <q className="pl-quote">{moment.quote}</q>}
              <time dateTime={moment.at}>{venueMoment(moment.at) ?? moment.at}</time>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}
