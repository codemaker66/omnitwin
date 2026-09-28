import { useEffect, useId, useRef, useState, type KeyboardEvent, type ReactElement, type RefObject } from "react";
import { LAYOUT_STYLES, occasionLabel, type LayoutStyle } from "@omnitwin/types";
import { ArrowLeft, ArrowUpRight, ChevronDown, ChevronUp, X } from "lucide-react";
import type { DeskProposal, ProposalCommentRow, ProposalHistoryEntry, StaffProposalVersion } from "../../../api/proposals.js";
import type { Space } from "../../../api/spaces.js";
import { formatMinorAsCurrency } from "../../../lib/money-input.js";
import { buildProposalCapacityGuidance, buildProposalCapacityNote, CAPACITY_STYLE_LABELS } from "../../../lib/proposal-capacity-note.js";
import { ActivityIndicator, ActivityStatus } from "../../shared/Activity.js";
import { eventDateParts, eventLead, eventWeekday, venueMoment } from "../enquiries/enquiry-desk-format.js";
import {
  EMPTY_LINE, draftChanges, draftFromVersion, historyMoments, linkOpenedSentence, linkVersionWords, listWords, type ComposerDraft, type KeptVersion, type QuoteLineDraft,
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
   *  should the version not save. */
  readonly onSaveVersion: (draft: ComposerDraft, composer: number) => Promise<boolean>;
  /** Puts one kept version away once it has been copied. */
  readonly onDiscardKept: (composer: number) => void;
  readonly onReply: (body: string) => Promise<boolean>;
  readonly onRetryLatest: () => void;
  readonly onRetryHistory: () => void;
  readonly onRetryComments: () => void;
  readonly onOpenDeal: ((opportunityId: string) => void) | null;
}

const LINKABLE = ["draft", "changes_requested", "sent"];
const COMPOSABLE = ["draft", "changes_requested"];
const WITHDRAWABLE = ["draft", "sent", "changes_requested"];
const ARCHIVABLE = ["accepted", "declined", "expired", "withdrawn"];

function isEditable(target: EventTarget): boolean {
  return target instanceof HTMLTextAreaElement || target instanceof HTMLInputElement
    || target instanceof HTMLSelectElement || (target instanceof HTMLElement && target.isContentEditable);
}

function money(minor: number, currency: string): string {
  return formatMinorAsCurrency(minor, currency).replace(/\.00$/u, "");
}

export function ProposalPanel(props: ProposalPanelProps): ReactElement {
  const { proposal, navigation, headingRef } = props;
  const headingId = useId();
  const occasion = occasionLabel(proposal.eventType);
  const context = proposal.dealTitle ?? occasion;

  const step = (event: KeyboardEvent<HTMLElement>): void => {
    if (event.altKey || event.ctrlKey || event.metaKey || isEditable(event.target)) return;
    if (event.key !== "j" && event.key !== "k") return;
    event.preventDefault();
    navigation.onStep(event.key === "j" ? 1 : -1);
  };

  return (
    <section className="enq-panel pr-panel" data-register="forest" aria-labelledby={headingId} onKeyDown={step}>
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
        {COMPOSABLE.includes(proposal.status) ? <Composer {...props} /> : <KeptDraft {...props} holder={null} />}
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

  const makeLink = (): void => {
    void onMakeLink().then((made) => { if (made) setAsking(null); });
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
            <button type="button" className="enq-quiet" onClick={copy}>{copied === "copied" ? "Copied" : "Copy the link"}</button>
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

function Composer(props: ProposalPanelProps): ReactElement {
  const { proposal, latest } = props;
  // Until the version to start from has been read once, the form waits; read
  // again later, the form it started stays.
  if (proposal.currentVersion > 0 && latest.value === null) {
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
  return <ComposerForm key={`${proposal.id}:${String(latest.value?.version ?? 0)}`} {...props} />;
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
  return (
    <section className="enq-section" aria-labelledby={headingId} data-testid="kept-version">
      <h3 id={headingId}>{shown.length === 1 ? "The version that did not save" : "The versions that did not save"}</h3>
      {!composing && failure?.where === "version" && <p className="enq-confirm__error" role="alert">{failure.message}</p>}
      <p className="enq-next__hint">What you wrote is kept here to copy.</p>
      {shown.map(({ draft, composer }) => {
        const lines = draft.lines.filter((line) => line.description.trim() !== "");
        return (
          <div key={composer} className="pr-kept__one">
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

function ComposerForm(props: ProposalPanelProps): ReactElement {
  const { proposal, latest, spaces, working, failure, onSaveVersion } = props;
  const headingId = useId();
  const [composer] = useState(() => { composers += 1; return composers; });
  const from = latest.value?.payload ?? null;
  const [draft, setDraft] = useState<ComposerDraft>(() => draftFromVersion(from));
  const next = proposal.currentVersion + 1;
  const changes = draftChanges(from, draft);
  const saving = working === "version";
  const lineRefs = useRef<(HTMLInputElement | null)[]>([]);
  const [focusLine, setFocusLine] = useState<number | null>(null);

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
        <p className="enq-next__hint" data-testid="composer-start">
          {from === null ? "The first version." : `Starts from version ${String(proposal.currentVersion)}. `}
          {from !== null && (changes.length === 0
            ? `Nothing is changed from it yet.`
            : `Changed: ${listWords(changes)}.`)}
        </p>

        <label className="pr-field">
          <span>Message to the client</span>
          <textarea data-testid="composer-message" rows={4} maxLength={4000} value={draft.message} disabled={saving}
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

        <p className="enq-next__hint">Sending shares the latest saved version. Figures are planning estimates, without safety or compliance assurance.</p>
        {failure?.where === "version" && <p className="enq-confirm__error" role="alert" data-testid="composer-error">{failure.message}</p>}
        <div className="enq-actions">
          <button type="button" className="enq-cta" data-testid="composer-save" disabled={saving || working !== null} aria-busy={saving}
            onClick={() => { void onSaveVersion(draft, composer); }}>
            {saving && <ActivityIndicator size={18} />}
            {saving ? "Saving…" : `Save version ${String(next)}`}
          </button>
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
