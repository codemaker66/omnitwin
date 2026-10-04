import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState, type KeyboardEvent, type ReactElement, type RefObject } from "react";
import { LAYOUT_STYLES, MAX_CLIENT_MESSAGE_LENGTH, occasionLabel, type LayoutStyle, type ProposalNextVersion } from "@omnitwin/types";
import { ArrowLeft, ArrowUpRight, ChevronDown, ChevronUp, Sparkles, X } from "lucide-react";
import type { DeskProposal, ProposalCommentRow, ProposalHistoryEntry, StaffProposalVersion } from "../../../api/proposals.js";
import type { Space } from "../../../api/spaces.js";
import type { WrittenDraft } from "./proposal-memory.js";
import { formatMinorAsCurrency } from "../../../lib/money-input.js";
import { buildProposalCapacityGuidance, buildProposalCapacityNote, CAPACITY_STYLE_LABELS } from "../../../lib/proposal-capacity-note.js";
import { ActivityIndicator, ActivityStatus } from "../../shared/Activity.js";
import { commentAuthor } from "../../proposal/proposal-document-format.js";
import { eventDateParts, eventLead, eventWeekday, venueMoment } from "../enquiries/enquiry-desk-format.js";
import {
  EMPTY_LINE, checkIsFor, lineHasWords, composerLayoutLine, composerStartWords, draftChanges, draftDiffers, draftFromVersion, droppedChanges, historyMoments,
  layoutChoice, layoutFact, linkOpenedSentence, linkVersionWords, notCarriedWords, putAsideWords, savedLayoutWords, type ComposerDraft,
  type KeptVersion, type LayoutChoice, type QuoteLineDraft, type TakenCheck,
} from "./proposals-desk-format.js";
import { ProposalChip } from "./ProposalsStages.js";
import { PriceList } from "./PriceList.js";
import type { PriceListEvent, PriceListOffer } from "./price-list-format.js";
import { getProposalEvent } from "../../../api/proposal-templates.js";
import { AIMessageDraft } from "./AIMessageDraft.js";
import { TemplatePicker, focusIsFree } from "./TemplatePicker.js";
import { TemplateSave } from "./TemplateSave.js";
import { applyTemplate, hasWords, type AppliedTemplate, type ApplyMode, type TemplateEvent } from "./template-format.js";
import type { PricingRule } from "../../../api/pricing.js";
import type { ProposalEvent, ProposalTemplate } from "@omnitwin/types";

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
export type ProposalWork = "link" | "withdraw" | "archive" | "version" | "reply" | "layout" | null;

export interface ProposalFailure {
  readonly where: "step" | "version" | "reply" | "layout";
  readonly message: string;
  /** For a version: the composer whose save failed. */
  readonly composer?: number;
  /** The proposal had moved on, so it is being read again. */
  readonly moved?: boolean;
}

/** Something said aloud, counted: the same words said again are a new
 *  saying, and are heard again. */
export interface Said {
  readonly text: string;
  readonly n: number;
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
  readonly announcement: Said | null;
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
  readonly keptNote: Said | null;
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
  /** Puts a composer's words aside to copy as it starts again, saying why
   *  when it is not the booker's own Start again (a template replaced them). */
  readonly onStartAgain: (composer: number, draft: ComposerDraft, fromVersion: number | null, reason?: string) => void;
  /** Puts one kept version away once it has been copied. */
  readonly onDiscardKept: (composer: number) => void;
  readonly onReply: (body: string) => Promise<boolean>;
  /** Leaves the client's own layout out of the versions saved from now, or
   *  takes it back (A10). */
  readonly onLayout: (change: LayoutChoice["change"]) => Promise<boolean>;
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
  // A template being priced, saved, removed or brought back holds what would
  // close the composer (Send, Withdraw), so what comes of it is put in or said.
  const [templateWork, setTemplateWork] = useState(false);
  // A composer form says, as it goes, what had focus in it, if anything.
  // Focus went with it only once that has left the page: React's development
  // rehearsal of a form going leaves everything where it was.
  const focusLostRef = useRef<Element | null>(null);
  const onFormGoing = useCallback((focused: Element | null): void => { focusLostRef.current = focused; }, []);
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
  // Focus that was in the composer is lost with it: it goes to the words
  // kept, or else to what the next composer starts from, or, with no
  // composer, to the proposal's name. Never from wherever it has gone since.
  useEffect(() => {
    const lost = (): boolean => document.activeElement === null || document.activeElement === document.body;
    if (focusKeptRef.current) {
      const kept = sectionRef.current?.querySelector<HTMLElement>("[data-kept-heading]") ?? null;
      if (kept === null) return;
      focusKeptRef.current = false;
      focusLostRef.current = null;
      if (lost()) kept.focus();
      return;
    }
    const focused = focusLostRef.current;
    if (focused === null || start === "reading") return;
    focusLostRef.current = null;
    if (focused.isConnected || !lost()) return;
    (sectionRef.current?.querySelector<HTMLElement>("[data-testid='composer-start']") ?? headingRef.current)?.focus();
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
        {/* Each saying is a fresh node, so the same words said again are heard. */}
        <p className="vv-sr-only" role="status">{props.announcement !== null && <span key={props.announcement.n}>{props.announcement.text}</span>}</p>
        <p className="vv-sr-only" role="status" data-testid="kept-note">
          {props.keptNote !== null && <span key={props.keptNote.n}>{props.keptNote.text}</span>}
        </p>
        {props.refreshing && <ActivityStatus className="enq-panel__activity">Refreshing the proposal…</ActivityStatus>}

        <Facts proposal={proposal} nowMs={props.nowMs} check={props.next.value} working={props.working} failure={props.failure}
          onLayout={props.onLayout} headingRef={headingRef} />
        {proposal.opportunityId !== null && props.onOpenDeal !== null && (
          <div className="enq-actions pr-deal">
            <button type="button" className="enq-quiet" onClick={() => { if (proposal.opportunityId !== null) props.onOpenDeal?.(proposal.opportunityId); }}>
              Open the deal in the pipeline <ArrowUpRight size={14} aria-hidden="true" />
            </button>
          </div>
        )}

        <NextStep {...props} templateWork={templateWork} />
        {start === "closed" ? <KeptDraft {...props} holder={null} /> : <Composer {...props} start={start} report={report} onGoing={onFormGoing} onTemplateWork={setTemplateWork} />}
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

function Facts({ proposal, nowMs, check, working, failure, onLayout, headingRef }: {
  readonly proposal: DeskProposal; readonly nowMs: number; readonly check: ProposalNextVersion | null;
  readonly working: ProposalWork; readonly failure: ProposalFailure | null;
  readonly onLayout: ProposalPanelProps["onLayout"]; readonly headingRef: RefObject<HTMLHeadingElement>;
}): ReactElement {
  const date = eventDateParts(proposal.eventDate);
  const weekday = eventWeekday(proposal.eventDate);
  const lead = eventLead(proposal.eventDate, nowMs);
  const inHand = COMPOSABLE.includes(proposal.status);
  const layout = layoutFact(proposal, inHand);
  // Only while it is in hand: a version with the client keeps what it carried.
  const choice = inHand ? layoutChoice(proposal) : null;
  const saved = savedLayoutWords(choice, check, proposal.currentVersion);
  const layoutFailed = failure?.where === "layout" ? failure.message : null;
  // Focus stays on the layout's control through its work and its new words:
  // it is marked unavailable while working, never disabled. If the control
  // goes while it has focus (the proposal moved on, or their layout went),
  // focus goes to what is said in its place, or else to the proposal's name.
  // React lets go of the control before it leaves the page, so whether it had
  // focus is known whatever the browser does with focus as it goes.
  const choiceNodeRef = useRef<HTMLButtonElement | null>(null);
  const focusGoneRef = useRef(false);
  const choiceRef = useCallback((node: HTMLButtonElement | null): void => {
    if (node === null && choiceNodeRef.current !== null && document.activeElement === choiceNodeRef.current) focusGoneRef.current = true;
    choiceNodeRef.current = node;
  }, []);
  const actRef = useRef<HTMLElement>(null);
  useLayoutEffect(() => {
    if (!focusGoneRef.current) return;
    focusGoneRef.current = false;
    const active = document.activeElement;
    if (active === null || active === document.body) (actRef.current ?? headingRef.current)?.focus();
  });
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
          {(choice !== null || layoutFailed !== null) && (
            <dd className="pr-facts__act" ref={actRef} tabIndex={-1}>
              {choice !== null && (
                <button type="button" className="enq-quiet" data-testid="layout-choice" ref={choiceRef} aria-disabled={working !== null}
                  aria-busy={working === "layout"} onClick={() => { if (working === null) void onLayout(choice.change); }}>
                  {working === "layout" && <ActivityIndicator size={18} />}
                  {working === "layout" ? (choice.change === "leave_out" ? "Leaving their layout out…" : "Including their layout…") : choice.label}
                </button>
              )}
              {layoutFailed !== null && <span className="enq-confirm__error" role="alert">{layoutFailed}</span>}
              {saved !== null && <span className="pr-facts__saved" data-testid="layout-saved">{saved}</span>}
            </dd>
          )}
        </div>
      )}
    </dl>
  );
}

// ---------------------------------------------------------------------------
// The one next step, asked first where it cannot be taken back
// ---------------------------------------------------------------------------

function NextStep({ proposal, shareUrl, working, failure, onMakeLink, onTransition, templateWork }: ProposalPanelProps & { readonly templateWork: boolean }): ReactElement {
  const headingId = useId();
  const questionId = useId();
  const [asking, setAsking] = useState<"link" | "withdraw" | null>(null);
  const [copied, setCopied] = useState<"copied" | "failed" | null>(null);
  const sent = proposal.status === "sent";
  // A version saved since the one the client's link shows goes with the link.
  const sendsNewer = sent && proposal.sentVersion !== null && proposal.sentVersion !== proposal.currentVersion;
  const canLink = LINKABLE.includes(proposal.status) && proposal.currentVersion >= 1;
  const busy = working !== null || templateWork;

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
  /** The form is going: what had focus in it, or null. */
  readonly onGoing: (focused: Element | null) => void;
  /** Whether template work is on its way in the form, so the panel holds what would close it. */
  readonly onTemplateWork: (busy: boolean) => void;
}

type EventRead =
  | { readonly status: "idle" | "loading" | "error" }
  | { readonly status: "ready"; readonly event: ProposalEvent };

interface ComposerFormProps extends ComposerProps {
  readonly start: number;
  /** This form began with Start again: its message field takes focus. */
  readonly startedAgain: boolean;
  /** Starts a new composer from where this one started. */
  readonly onFresh: () => void;
  /** Its message field has taken focus, so no later form does. */
  readonly onFocused: () => void;
  /** This form began from a template, or an AI draft, that replaced the
   *  words before it: its words, what to say and where to go. */
  readonly seeded: ComposerSeed | null;
  /** Starts a new composer from a template or an AI draft, the words before it kept to copy. */
  readonly onSeed: (seed: ComposerSeed) => void;
}

/** What starts a new composer in place of the one before, whose words are
 *  kept to copy: a template, or an AI draft used over a message already
 *  written. Focus moves into the new composer only from where it was when
 *  Use was pressed, or from nowhere. */
interface ComposerSeed {
  readonly draft: ComposerDraft;
  /** What a template put in, said once the form is on the page; none for an AI draft. */
  readonly applied: AppliedTemplate | null;
  readonly focus: AppliedTemplate["focus"];
  readonly from: Element | null;
}

function Composer(props: ComposerProps): ReactElement {
  const { proposal, latest, start } = props;
  // Starting again is a new composer, so the words put aside are shown to
  // copy beside it; its message field then takes focus to write afresh.
  // A template's seed belongs to the one form it started, for the version it
  // was made from: a form after a save starts from the version saved.
  const [again, setAgain] = useState<{
    readonly count: number; readonly focus: boolean; readonly seed: { readonly seed: ComposerSeed; readonly start: number } | null;
  }>({ count: 0, focus: false, seed: null });
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
      seeded={again.seed !== null && again.seed.start === start ? again.seed.seed : null}
      onFresh={() => { setAgain((current) => ({ count: current.count + 1, focus: true, seed: null })); }}
      onSeed={(seed) => { setAgain((current) => ({ count: current.count + 1, focus: false, seed: { seed, start } })); }}
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
    <section className="enq-section" aria-labelledby={headingId} data-testid="kept-version" data-composer-form={holder ?? undefined}>
      <h3 id={headingId} tabIndex={-1} data-kept-heading="">{title}</h3>
      {!composing && failure?.where === "version" && <p className="enq-confirm__error" role="alert">{failure.message}</p>}
      <p className="enq-next__hint">What you wrote is kept here to copy.</p>
      {shown.map(({ draft, composer, why }) => {
        const lines = draft.lines.filter(lineHasWords);
        return (
          <div key={composer} className="pr-kept__one">
            {why !== null && <p className="enq-next__hint" data-testid="kept-version-why">{why}</p>}
            {draft.message.trim() !== "" && <p className="pr-kept">{draft.message}</p>}
            {draft.aiUnread === true && <p className="enq-next__hint" data-testid="kept-ai-unread">It holds AI wording not yet read through.</p>}
            {draft.capacityNote.trim() !== "" && <p className="pr-kept">Capacity: {draft.capacityNote}</p>}
            {lines.length > 0 && (
              <ul className="pr-kept__lines">
                {lines.map((line, index) => (
                  <li key={index}>{line.description.trim() === "" ? "A line with no description" : line.description} · {line.quantity} × £{line.pounds === "" ? "0" : line.pounds}</li>
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
    proposal, latest, next: checkRead, lastCheck, checkRetrying, spaces, working, failure, memory, startedAgain, seeded, nowMs,
    onSaveVersion, onRetryCheck, onStartAgain, onFresh, onFocused, onGoing, onSeed, onTemplateWork, report,
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
    const written = startedAgain || seeded !== null ? null : memory?.recall() ?? null;
    return written !== null && written.start === basedOn ? written : null;
  });
  const [composer] = useState(() => {
    if (resumed !== null) return resumed.composer;
    composers += 1;
    return composers;
  });
  const [draft, setDraft] = useState<ComposerDraft>(() => seeded?.draft ?? resumed?.draft ?? draftFromVersion(from));
  const next = basedOn + 1;
  const changes = draftChanges(from, draft);
  // The panel knows this form, and its words while there is something to
  // lose, so they are kept should the proposal move on or be left.
  const differs = draftDiffers(from, draft);
  useEffect(() => {
    report({ composer, start: basedOn }, differs ? { composer, start: basedOn, draft } : null);
  }, [report, differs, composer, basedOn, draft]);
  // Going (replaced by a version saved elsewhere, a send, or anything else),
  // the form says what had focus in it before its fields leave the page, so
  // the panel can give focus somewhere to go.
  useLayoutEffect(() => () => {
    const focused = document.activeElement;
    const within = focused !== null && focused.closest(`[data-composer-form="${String(composer)}"]`) !== null;
    onGoing(within ? focused : null);
  }, [composer, onGoing]);
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
  // AI wording not yet read through: its marker, its button, and what is said
  // when Save is pressed before it has been.
  const aiMarkerId = useId();
  const aiReadRef = useRef<HTMLButtonElement>(null);
  // Keyed, so the same words said again are heard again; gone with the mark.
  const [aiSaid, setAiSaid] = useState<{ readonly n: number; readonly text: string } | null>(null);
  const sayAI = (text: string): void => { setAiSaid((said) => ({ n: (said?.n ?? 0) + 1, text })); };
  useEffect(() => { if (draft.aiUnread !== true) setAiSaid(null); }, [draft.aiUnread]);
  // AI wording emptied from the message, so that brought back (an undo, a
  // paste) is marked again rather than slipping past the read-through.
  const aiCleared = useRef<string | null>(null);
  const saving = working === "version";
  const lineRefs = useRef<(HTMLInputElement | null)[]>([]);
  const [focusLine, setFocusLine] = useState<number | null>(null);
  const quantityRefs = useRef<(HTMLInputElement | null)[]>([]);
  const [focusQuantity, setFocusQuantity] = useState<number | null>(null);
  const priceRefs = useRef<(HTMLInputElement | null)[]>([]);
  // Check again stays where it was pressed while it checks, so focus stays
  // with it. Answered, focus goes to what the start line now says; not
  // answered, it is said, and Check again is there to press again. Only a
  // check the booker asked for is answered like that: one made again on
  // coming back to the page says nothing and moves nothing.
  const startRef = useRef<HTMLParagraphElement>(null);
  const askedRef = useRef<"asked" | "checking" | null>(null);
  const [checkSaid, setCheckSaid] = useState("");
  useEffect(() => {
    if (checkRetrying) {
      if (askedRef.current === "asked") askedRef.current = "checking";
      setCheckSaid("");
      return;
    }
    if (askedRef.current !== "checking") return;
    askedRef.current = null;
    if (check.status === "failed") {
      setCheckSaid("It still could not be checked.");
      return;
    }
    const active = document.activeElement;
    if (active === null || active === document.body) startRef.current?.focus();
  }, [checkRetrying, check.status]);
  const checkAgain = (): void => {
    if (checkRetrying) return;
    askedRef.current = "asked";
    onRetryCheck();
  };

  useEffect(() => {
    if (focusLine === null) return;
    lineRefs.current[focusLine]?.focus();
    setFocusLine(null);
  }, [focusLine]);
  useEffect(() => {
    if (focusQuantity === null) return;
    quantityRefs.current[focusQuantity]?.focus();
    setFocusQuantity(null);
  }, [focusQuantity]);

  // The price list is priced for the event as the version would take it: the
  // check's facts once answered, else the proposal's own date and guests.
  const facts = checkRead.value?.facts.now ?? null;
  const rooms = spaces.value ?? [];
  const priceEvent: PriceListEvent = {
    spaceId: facts === null || facts.roomSlug === null ? null : rooms.find((room) => room.slug === facts.roomSlug)?.id ?? null,
    eventDate: facts?.eventDate ?? proposal.eventDate,
    guestCount: facts?.guestCount ?? proposal.guestCount,
  };
  // A price picked is a line like any typed one; the booker gives the
  // quantity it cannot know.
  const addFromList = (offer: PriceListOffer): number => {
    const at = draft.lines.length;
    setLines((lines) => [...lines, { ...offer.line }]);
    if (offer.asks !== null) setFocusQuantity(at);
    return at + 1;
  };

  // Templates are matched to the event, read when first wanted: before any
  // version exists, only it names the event's room.
  const [eventRead, setEventRead] = useState<EventRead>({ status: "idle" });
  const eventNumber = useRef(0);
  useEffect(() => () => { eventNumber.current += 1; }, []);
  const needEvent = useCallback(() => {
    eventNumber.current += 1;
    const mine = eventNumber.current;
    setEventRead({ status: "loading" });
    getProposalEvent(proposal.id)
      .then((event) => { if (eventNumber.current === mine) setEventRead({ status: "ready", event }); })
      .catch(() => { if (eventNumber.current === mine) setEventRead({ status: "error" }); });
  }, [proposal.id]);
  const templateEvent: TemplateEvent | null = eventRead.status !== "ready" ? null : {
    spaceId: eventRead.event.spaceId,
    eventDate: eventRead.event.facts.eventDate ?? proposal.eventDate,
    guestCount: eventRead.event.facts.guestCount ?? proposal.guestCount,
    roomName: eventRead.event.facts.roomName,
    occasion: eventRead.event.facts.occasion,
  };
  // What a template put in is said, and focus goes where the booker is
  // needed first. A form a template started says it once it is on the page.
  // What is said of particular lines holds only until the lines change.
  const [templateSaid, setTemplateSaid] = useState<AppliedTemplate | null>(null);
  const [lineNotes, setLineNotes] = useState<readonly string[]>([]);
  const [templateFocus, setTemplateFocus] = useState<{ readonly to: AppliedTemplate["focus"]; readonly from: Element | null } | null>(null);
  useEffect(() => {
    if (seeded === null) return;
    if (seeded.applied !== null) {
      setTemplateSaid(seeded.applied);
      setLineNotes(seeded.applied.lineSaid);
    } else if (seeded.draft.aiUnread === true) {
      setAiSaid({ n: 1, text: "The AI draft is now the message, marked until you have read it through. What you had written is kept to copy." });
    }
    setTemplateFocus({ to: seeded.focus, from: seeded.from });
  }, [seeded]);
  // The words as they stand when a template's prices arrive, typed meanwhile or not.
  const draftNow = useRef(draft);
  useEffect(() => { draftNow.current = draft; }, [draft]);
  // Focus goes to what the template needs only from where Use was pressed,
  // or from nowhere (the Use pressed has gone with the list): never away
  // from a field the booker went to while it was priced.
  useEffect(() => {
    if (templateFocus === null) return;
    setTemplateFocus(null);
    if (!focusIsFree(templateFocus.from)) return;
    const to = templateFocus.to;
    if (to === "message") messageRef.current?.focus();
    else (to.field === "quantity" ? quantityRefs : priceRefs).current[to.line]?.focus();
  }, [templateFocus]);
  // While a template is priced, removed or brought back, or one is saved,
  // nothing that would replace this form or its words can be pressed: what
  // comes of it is put in, or said, here.
  const [pickerBusy, setPickerBusy] = useState(false);
  const [templateSaving, setTemplateSaving] = useState(false);
  const held = saving || working !== null || pickerBusy || templateSaving;
  useEffect(() => { onTemplateWork(pickerBusy || templateSaving); }, [onTemplateWork, pickerBusy, templateSaving]);
  useEffect(() => () => { onTemplateWork(false); }, [onTemplateWork]);
  // Work that would replace this form; a reply or a layout choice does not.
  const replacing = working !== null && working !== "reply" && working !== "layout";
  // An AI draft used as the message, marked until it is read through. Over
  // words written here and not saved it starts a new composer, those words
  // kept to copy, as a template's Replace does; a message as the version
  // holds it is replaced where it is, the version keeping it.
  const takeAIDraft = (body: string, focusFrom: Element | null): void => {
    if (held) return;
    const words = draftNow.current;
    const used: ComposerDraft = { ...words, message: body, aiUnread: true };
    const unsaved = words.message.trim() !== "" && words.message.trim() !== (from?.clientMessage ?? "").trim();
    aiCleared.current = null;
    if (unsaved) {
      onStartAgain(composer, words, from === null ? null : basedOn, "Kept when you used the AI draft.");
      onSeed({ draft: used, applied: null, focus: "message", from: focusFrom });
      return;
    }
    setDraft(used);
    sayAI("The AI draft is now the message, marked until you have read it through.");
    setTemplateFocus({ to: "message", from: focusFrom });
  };
  const startFromTemplate = (template: ProposalTemplate, rules: readonly PricingRule[], mode: ApplyMode, focusFrom: Element | null): void => {
    if (templateEvent === null || saving) return;
    const words = draftNow.current;
    const applied = applyTemplate(template, rules, templateEvent, words, mode, (id) => rooms.find((room) => room.id === id)?.name ?? null);
    // Words replaced are kept to copy, beside a new composer the template starts.
    if (mode === "replace" && hasWords(words)) {
      onStartAgain(composer, words, from === null ? null : basedOn, `You started from ${template.name}.`);
      onSeed({ draft: applied.draft, applied, focus: applied.focus, from: focusFrom });
      return;
    }
    setDraft(applied.draft);
    setTemplateSaid(applied);
    setLineNotes(applied.lineSaid);
    setTemplateFocus({ to: applied.focus, from: focusFrom });
  };

  const setLines = (change: (lines: readonly QuoteLineDraft[]) => readonly QuoteLineDraft[]): void => {
    setDraft((current) => ({ ...current, lines: change(current.lines) }));
    setLineNotes([]);
  };
  const setLine = (index: number, change: Partial<QuoteLineDraft>): void => {
    setLines((lines) => lines.map((line, at) => at === index ? { ...line, ...change } : line));
  };

  return (
    <>
      <KeptDraft {...props} holder={composer} />
      <section className="enq-section pr-compose" aria-labelledby={headingId} data-testid="composer" data-composer-form={composer}>
        <h3 id={headingId}>Version {String(next)}</h3>
        <p className="enq-next__hint" id={startId} ref={startRef} tabIndex={-1} data-testid="composer-start">
          {composerStartWords(from === null ? null : basedOn, changes, check, droppedChanges(from))}
        </p>
        {from !== null && (check.status === "failed" || checkRetrying) && (
          <div className="enq-actions">
            <button type="button" className="enq-quiet" data-testid="composer-check-again" aria-disabled={checkRetrying} aria-busy={checkRetrying}
              onClick={checkAgain}>
              {checkRetrying && <ActivityIndicator size={18} />}
              {checkRetrying ? "Checking…" : "Check again"}
            </button>
          </div>
        )}
        <p className="vv-sr-only" role="status" data-testid="composer-check-said">{checkSaid}</p>
        {notCarried !== null && <p className="enq-next__hint" id={notCarriedId} data-testid="composer-not-carried">{notCarried}</p>}

        <TemplatePicker venueId={proposal.venueId} event={templateEvent} eventStatus={eventRead.status} onNeedEvent={needEvent}
          draft={draft} disabled={replacing || templateSaving} nowMs={nowMs} onUse={startFromTemplate} onBusy={setPickerBusy} />
        <div className="pr-template-said" role="status" data-testid="template-said">
          {templateSaid !== null && (
            <>
              <p>{templateSaid.summary}</p>
              {[...templateSaid.said, ...lineNotes].map((sentence, index) => <p key={`${String(index)}:${sentence}`} className="enq-next__hint">{sentence}</p>)}
            </>
          )}
        </div>

        <label className="pr-field">
          <span>Message to the client</span>
          <textarea ref={messageRef} data-testid="composer-message" rows={4} maxLength={MAX_CLIENT_MESSAGE_LENGTH} value={draft.message} disabled={saving}
            data-ai-unread={draft.aiUnread === true ? "" : undefined} aria-describedby={draft.aiUnread === true ? aiMarkerId : undefined}
            onChange={(event) => {
              // An emptied message holds no AI wording left to read through;
              // the AI's words brought back are marked again.
              const message = event.target.value;
              let aiUnread = draft.aiUnread === true;
              if (aiUnread && message.trim() === "") {
                aiCleared.current = draft.message;
                aiUnread = false;
              } else if (!aiUnread && aiCleared.current !== null && message.trim() !== "" && message.includes(aiCleared.current.trim())) {
                aiUnread = true;
              }
              setDraft((current) => ({ ...current, message, aiUnread }));
            }} />
        </label>
        {draft.aiUnread === true && (
          <p className="pr-ai__marker" data-testid="ai-unread">
            <Sparkles aria-hidden="true" size={14} />
            <span className="pr-ai__chip" aria-hidden="true">Draft</span>
            <span id={aiMarkerId}>AI wording, not yet read through.</span>
            <button type="button" className="enq-quiet" ref={aiReadRef} data-testid="ai-read" disabled={saving}
              onClick={() => { aiCleared.current = null; setDraft((current) => ({ ...current, aiUnread: false })); messageRef.current?.focus(); }}>
              I have read it
            </button>
          </p>
        )}
        <p className="vv-sr-only" role="status" data-testid="ai-said">{aiSaid !== null && <span key={aiSaid.n}>{aiSaid.text}</span>}</p>
        <AIMessageDraft proposalId={proposal.id} canUse={!held} onUse={takeAIDraft} />
        <label className="pr-field">
          <span>Capacity note</span>
          <input data-testid="composer-capacity" maxLength={500} value={draft.capacityNote} disabled={saving}
            onChange={(event) => { setDraft((current) => ({ ...current, capacityNote: event.target.value })); }} />
        </label>
        <CapacityGuidance spaces={spaces} disabled={saving} onInsert={(note) => { setDraft((current) => ({ ...current, capacityNote: note })); }} />

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
                  ref={(element) => { quantityRefs.current[index] = element; }}
                  value={line.quantity} disabled={saving} onChange={(event) => { setLine(index, { quantity: event.target.value }); }} />
              </label>
              <label className="pr-line__part">
                <span aria-hidden="true">Unit price, £</span>
                <input aria-label={`Line ${String(index + 1)} unit price (£)`} data-testid={`quote-price-${String(index)}`} inputMode="decimal"
                  ref={(element) => { priceRefs.current[index] = element; }}
                  placeholder="0.00" value={line.pounds} disabled={saving} onChange={(event) => { setLine(index, { pounds: event.target.value }); }} />
              </label>
              <button type="button" className="enq-quiet" aria-label={`Remove quote line ${String(index + 1)}`} disabled={saving}
                onClick={() => { setLines((lines) => lines.filter((_, at) => at !== index)); }}>
                Remove
              </button>
            </div>
          ))}
          <div className="enq-actions">
            <button type="button" className="enq-quiet" data-testid="add-quote-line" disabled={saving}
              onClick={() => { setLines((lines) => [...lines, { ...EMPTY_LINE }]); setFocusLine(draft.lines.length); }}>
              Add a line
            </button>
            <PriceList venueId={proposal.venueId} event={priceEvent} rooms={rooms} disabled={saving} onAdd={addFromList} />
          </div>
        </div>

        {layoutLine !== null && <p className="enq-next__hint" data-testid="composer-layout">{layoutLine}</p>}
        <p className="enq-next__hint">Sending shares the latest saved version. Figures are planning estimates, without safety or compliance assurance.</p>
        {failure?.where === "version" && <p className="enq-confirm__error" role="alert" data-testid="composer-error">{failure.message}</p>}
        <div className="enq-actions">
          {/* Save is described by what the version starts from and changes, so
              it is heard at the moment of saving, however it came to change. */}
          <button type="button" className="enq-cta" data-testid="composer-save" disabled={held} aria-busy={saving}
            aria-describedby={[startId, ...(notCarried === null ? [] : [notCarriedId]), ...(draft.aiUnread === true ? [aiMarkerId] : [])].join(" ")}
            onClick={() => {
              // AI wording goes to the client only once the booker has read it through.
              if (draft.aiUnread === true) {
                sayAI("Read the AI wording through first, then press I have read it.");
                aiReadRef.current?.focus();
                return;
              }
              void onSaveVersion(draft, composer, basedOn, heldTo);
            }}>
            {saving && <ActivityIndicator size={18} />}
            {saving ? "Saving…" : `Save version ${String(next)}`}
          </button>
          {/* Nothing written is thrown away: starting again keeps it to copy. */}
          {differs && (
            <button type="button" className="enq-quiet" data-testid="composer-start-again" disabled={held} onClick={startAgain}>
              {from === null ? "Start again" : `Start again from version ${String(basedOn)}`}
            </button>
          )}
          <TemplateSave venueId={proposal.venueId} event={templateEvent} eventStatus={eventRead.status} onNeedEvent={needEvent}
            rooms={rooms} draft={draft} disabled={replacing || pickerBusy} nowMs={nowMs} onSaving={setTemplateSaving} />
        </div>
      </section>
    </>
  );
}

/** `disabled` while a save is on its way: a note put in then would not be
 *  in the version, and the composer that saves makes way for the next. */
function CapacityGuidance({ spaces, disabled, onInsert }: {
  readonly spaces: PartRead<readonly Space[]>;
  readonly disabled: boolean;
  readonly onInsert: (note: string) => void;
}): ReactElement | null {
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
        <select aria-label="Guidance room" data-testid="capacity-space" value={space?.id ?? ""} disabled={disabled}
          onChange={(event) => { setSpaceId(event.target.value); }}>
          {rooms.map((room) => <option key={room.id} value={room.id}>{room.name}</option>)}
        </select>
        <input aria-label="Guidance guest count" data-testid="capacity-guests" inputMode="numeric" placeholder="Guests" value={guests} disabled={disabled}
          onChange={(event) => { setGuests(event.target.value); }} />
        <select aria-label="Guidance layout style" data-testid="capacity-style" value={style} disabled={disabled}
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
            <button type="button" className="enq-quiet" data-testid="capacity-insert" disabled={disabled}
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
                <strong>{commentAuthor({ authorName: comment.authorName, from: comment.authorType === "staff" ? "venue" : "client" })}</strong>
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
