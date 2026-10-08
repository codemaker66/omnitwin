import { useEffect, useId, useRef, useState, type KeyboardEvent, type ReactElement, type RefObject } from "react";
import { occasionLabel } from "@omnitwin/types";
import { ArrowLeft, ArrowUpRight, ChevronDown, ChevronUp, X } from "lucide-react";
import type { Activity, DealContact, DealQuote, FollowUpTask, Opportunity, StageMove } from "../../../api/crm.js";
import type { StaffProposal } from "../../../api/proposals.js";
import { formatMinorAsCurrency, parsePoundsToMinor } from "../../../lib/money-input.js";
import { ActivityIndicator } from "../../shared/Activity.js";
import { proposalStatusWords } from "../clients/clients-desk-format.js";
import { eventDateParts, eventLead, eventWeekday, venueCalendarDate, venueMoment, venueSince } from "../enquiries/enquiry-desk-format.js";
import {
  CLOSE_REASONS, dealTimeline, dueIsPressing, dueWords, isClosingMove, stagePath, stageSince, stageSteps, type DealStep,
} from "./pipeline-desk-format.js";
import { DealStageChip } from "./PipelineStages.js";

// ---------------------------------------------------------------------------
// One deal in the forest panel beside the ledger: what the event is, who it
// is with and what it is worth in large type, where it stands on its path,
// and the one next step for its stage in the same place every time. Closing
// a deal as won or lost asks why, in place, before it moves.
// ---------------------------------------------------------------------------

export interface DealDetail {
  readonly opportunity: Opportunity;
  readonly activities: readonly Activity[];
  readonly tasks: readonly FollowUpTask[];
  readonly proposals: readonly StaffProposal[];
  readonly history: readonly StageMove[];
  readonly contact: DealContact | null;
  readonly room: string | null;
  /** The newest live quote, which the value can be filled from. */
  readonly latestQuote: DealQuote | null;
}

/** What the panel is saving, so only that control waits. */
export type DealSaving = "step" | "value" | "next" | "task" | "note" | { readonly task: string } | null;

export interface DealNavigation {
  readonly layout: "wide" | "single";
  readonly canPrevious: boolean;
  readonly canNext: boolean;
  readonly onClose: () => void;
  readonly onStep: (direction: 1 | -1) => void;
}

export interface DealPanelProps {
  readonly detail: DealDetail;
  readonly nowMs: number;
  readonly saving: DealSaving;
  /** The last action's failure, said where it happened. */
  readonly failure: { readonly where: "step" | "value" | "next" | "task" | "note"; readonly message: string } | null;
  readonly announcement: string | null;
  readonly stampKey: number | null;
  readonly navigation: DealNavigation;
  readonly headingRef: RefObject<HTMLHeadingElement>;
  /** Each resolves true once saved, so the panel can put its form away. */
  readonly onMove: (to: string, reason: string | null) => Promise<boolean>;
  readonly onDraftProposal: () => Promise<boolean>;
  readonly onSaveValue: (minor: number) => Promise<boolean>;
  readonly onSaveNext: (nextAction: string, dueAt: string | null) => Promise<boolean>;
  readonly onAddTask: (title: string, dueAt: string | null) => Promise<boolean>;
  readonly onCompleteTask: (task: FollowUpTask) => void;
  readonly onAddNote: (body: string) => Promise<boolean>;
  readonly onOpenProposal: (proposalId: string) => void;
  /** Opens the contact on the Clients desk; absent for those who cannot open
   *  Clients (sales), who are offered no way there rather than a refusal. */
  readonly onOpenClient?: ((contactId: string) => void) | undefined;
}

function isEditable(target: EventTarget): boolean {
  return target instanceof HTMLTextAreaElement || target instanceof HTMLInputElement
    || target instanceof HTMLSelectElement || (target instanceof HTMLElement && target.isContentEditable);
}

/** A date input's day as the moment the API stores: midday UTC, which is the
 *  same calendar day in Glasgow all year round. */
function dayToDueAt(day: string): string | null {
  return /^\d{4}-\d{2}-\d{2}$/u.test(day) ? `${day}T12:00:00.000Z` : null;
}

export function DealPanel(props: DealPanelProps): ReactElement {
  const { detail, nowMs, navigation, headingRef } = props;
  const deal = detail.opportunity;
  const headingId = useId();
  const occasion = occasionLabel(deal.eventType);
  const since = stageSince(deal.stage, detail.history);
  const sinceWords = since === null ? null : venueSince(since, nowMs);

  const step = (event: KeyboardEvent<HTMLElement>): void => {
    if (event.altKey || event.ctrlKey || event.metaKey || isEditable(event.target)) return;
    if (event.key !== "j" && event.key !== "k") return;
    event.preventDefault();
    navigation.onStep(event.key === "j" ? 1 : -1);
  };

  return (
    <section className="enq-panel pl-panel" data-register="forest" aria-labelledby={headingId} onKeyDown={step}>
      <div className="enq-panel__body">
        <div className="enq-panel__bar">
          {navigation.layout === "single" ? (
            <button type="button" className="enq-back" onClick={navigation.onClose}>
              <ArrowLeft size={16} aria-hidden="true" /> Back to the pipeline
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
            <button type="button" className="enq-close" onClick={navigation.onClose} aria-label="Close deal" aria-keyshortcuts="Escape">
              <X size={18} aria-hidden="true" />
            </button>
          )}
        </div>

        <p className="enq-eyebrow">Deal{occasion === null ? "" : ` · ${occasion}`}</p>
        <h2 className="enq-panel__name" id={headingId} ref={headingRef} tabIndex={-1}>{deal.title}</h2>
        <div className="enq-panel__status">
          <DealStageChip key={props.stampKey ?? "still"} stage={deal.stage} stamped={props.stampKey !== null} />
          {sinceWords !== null && <span className="pl-since">since {sinceWords}</span>}
        </div>
        <p className="vv-sr-only" role="status">{props.announcement}</p>

        <DealFacts {...props} />
        <ol className="enq-path pl-path" aria-label="Stages">
          {deal.stage === "lost" || deal.stage === "archived" ? (
            <li data-state="current"><span className="enq-path__mark" aria-hidden="true" />{deal.stage === "lost" ? "Lost" : "Archived"}</li>
          ) : stagePath(deal.stage).map((stop) => (
            <li key={stop.stage} data-state={stop.state} aria-current={stop.state === "current" ? "step" : undefined}>
              <span className="enq-path__mark" aria-hidden="true" />{stop.label}
            </li>
          ))}
        </ol>

        <NextStep {...props} />
        <FollowUps {...props} />
        {detail.contact !== null && <WithWhom contact={detail.contact} onOpenClient={props.onOpenClient} />}
        <Proposals proposals={detail.proposals} onOpenProposal={props.onOpenProposal} />
        <Timeline {...props} />
      </div>
    </section>
  );
}

// ---------------------------------------------------------------------------
// Facts, with the value that can be put right in place
// ---------------------------------------------------------------------------

function DealFacts({ detail, nowMs, saving, failure, onSaveValue }: DealPanelProps): ReactElement {
  const deal = detail.opportunity;
  const date = eventDateParts(deal.preferredDate);
  const weekday = eventWeekday(deal.preferredDate);
  const lead = eventLead(deal.preferredDate, nowMs);
  const [editing, setEditing] = useState(false);
  const [pounds, setPounds] = useState("");
  const [invalid, setInvalid] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const value = deal.estimatedValueMinor > 0 ? formatMinorAsCurrency(deal.estimatedValueMinor, deal.currency).replace(/\.00$/u, "") : null;
  // The value follows the quote only when the booker says so; a figure they
  // set is theirs. A quote in another currency is not offered.
  const quote = detail.latestQuote !== null && detail.latestQuote.currency === deal.currency ? detail.latestQuote : null;
  const quoted = quote === null ? null : formatMinorAsCurrency(quote.totalMinor, quote.currency).replace(/\.00$/u, "");

  useEffect(() => { if (editing) inputRef.current?.focus(); }, [editing]);

  const open = (): void => {
    setPounds(deal.estimatedValueMinor > 0 ? (deal.estimatedValueMinor / 100).toFixed(2).replace(/\.00$/u, "") : "");
    setInvalid(false);
    setEditing(true);
  };
  const save = (): void => {
    const minor = parsePoundsToMinor(pounds);
    if (minor === null) {
      setInvalid(true);
      return;
    }
    void onSaveValue(minor).then((saved) => { if (saved) setEditing(false); });
  };

  return (
    <>
      <dl className="enq-facts pl-facts">
        <div>
          <dt>{date === null ? "Date" : `${weekday ?? ""}${lead === null ? "" : `, ${lead}`}`}</dt>
          <dd className={date === null ? "enq-facts__muted" : undefined}>{date === null ? "To be confirmed" : `${date.day} ${date.month} ${date.year}`}</dd>
        </div>
        <div>
          <dt>guests</dt>
          <dd className={deal.guestCount === null ? "enq-facts__muted" : undefined}>
            {deal.guestCount === null ? "To come" : deal.guestCount.toLocaleString("en-GB")}
          </dd>
        </div>
        <div>
          <dt>room</dt>
          <dd className={detail.room === null ? "enq-facts__muted" : "enq-facts__room"}>{detail.room ?? "Not chosen"}</dd>
        </div>
      </dl>
      <div className="pl-value">
        {editing ? (
          <form className="pl-value__form" onSubmit={(event) => { event.preventDefault(); save(); }}>
            <label>
              <span>Estimated value, in pounds</span>
              <input ref={inputRef} inputMode="decimal" value={pounds} disabled={saving === "value"}
                aria-invalid={invalid} aria-describedby={invalid ? "pl-value-error" : undefined}
                onChange={(event) => { setPounds(event.target.value); setInvalid(false); }}
                onKeyDown={(event) => { if (event.key === "Escape") { event.stopPropagation(); setEditing(false); } }} />
            </label>
            <div className="enq-actions">
              <button type="submit" className="enq-cta" disabled={saving === "value"} aria-busy={saving === "value"}>
                {saving === "value" && <ActivityIndicator size={18} />}
                {saving === "value" ? "Saving…" : "Save the value"}
              </button>
              <button type="button" className="enq-quiet" disabled={saving === "value"} onClick={() => { setEditing(false); }}>Cancel</button>
            </div>
            {invalid && <p className="enq-confirm__error" id="pl-value-error" role="alert">Enter pounds, like 18400 or 18400.50.</p>}
          </form>
        ) : (
          <>
            <p className="pl-value__figure">
              <span className="vv-sr-only">Estimated value: </span>
              {value ?? <span className="pl-value__none">No value yet</span>}
            </p>
            <button type="button" className="enq-quiet pl-value__edit" onClick={open}>{value === null ? "Add a value" : "Change the value"}</button>
            {quote !== null && quoted !== null && (quote.totalMinor === deal.estimatedValueMinor ? (
              <p className="pl-value__quote">The latest quote's total.</p>
            ) : (
              <p className="pl-value__quote">
                <span>The latest quote comes to {quoted}.</span>
                <button type="button" className="enq-quiet" disabled={saving === "value"} aria-busy={saving === "value"}
                  onClick={() => { void onSaveValue(quote.totalMinor); }}>
                  {saving === "value" && <ActivityIndicator size={18} />}
                  {saving === "value" ? "Saving…" : `Use ${quoted}`}
                </button>
              </p>
            ))}
          </>
        )}
        {failure?.where === "value" && <p className="enq-confirm__error" role="alert">{failure.message}</p>}
      </div>
    </>
  );
}

// ---------------------------------------------------------------------------
// The next step: what is owed and when, and the stage's one move
// ---------------------------------------------------------------------------

function NextStep({ detail, nowMs, saving, failure, onMove, onDraftProposal, onSaveNext }: DealPanelProps): ReactElement {
  const deal = detail.opportunity;
  const headingId = useId();
  const drafted = detail.proposals.some((proposal) => proposal.status === "draft");
  const steps = withDraft(stageSteps(deal.stage), deal.stage, drafted);
  const [closing, setClosing] = useState<"won" | "lost" | null>(null);
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState(deal.nextAction);
  const [day, setDay] = useState("");
  const textRef = useRef<HTMLInputElement>(null);
  const busy = saving === "step";
  const closed = deal.stage === "won" || deal.stage === "lost" || deal.stage === "archived";
  const due = dueWords(deal, nowMs);
  const pressing = dueIsPressing(deal, nowMs);

  // A deal that moved on puts any half-made decision away. Settled while
  // rendering rather than in an effect, which would also run once the panel
  // first appears and undo a Change pressed before then.
  const [seen, setSeen] = useState({ id: deal.id, stage: deal.stage });
  if (seen.id !== deal.id || seen.stage !== deal.stage) {
    setSeen({ id: deal.id, stage: deal.stage });
    setClosing(null);
    setEditing(false);
  }
  useEffect(() => { if (editing) textRef.current?.focus(); }, [editing]);

  const run = (stepToRun: DealStep): void => {
    if (isClosingMove(stepToRun)) {
      setClosing(stepToRun.to);
      return;
    }
    if (stepToRun.kind === "draft-proposal") void onDraftProposal();
    else void onMove(stepToRun.to, null);
  };
  const openEditor = (): void => {
    setText(deal.nextAction);
    setDay(deal.nextActionDueAt === null ? "" : venueCalendarDate(deal.nextActionDueAt) ?? "");
    setEditing(true);
  };
  const saveNext = (): void => {
    if (text.trim() === "") return;
    void onSaveNext(text.trim(), day === "" ? null : dayToDueAt(day)).then((saved) => { if (saved) setEditing(false); });
  };

  return (
    <section className="enq-section pl-next" aria-labelledby={headingId}>
      <h3 id={headingId}>Next step</h3>
      {!closed && (
        editing ? (
          <form className="pl-next__form" onSubmit={(event) => { event.preventDefault(); saveNext(); }}>
            <label>
              <span>What is owed next</span>
              <input ref={textRef} value={text} maxLength={500} required disabled={saving === "next"}
                onChange={(event) => { setText(event.target.value); }} />
            </label>
            <label>
              <span>Due on</span>
              <input type="date" value={day} disabled={saving === "next"} onChange={(event) => { setDay(event.target.value); }} />
            </label>
            <div className="enq-actions">
              <button type="submit" className="enq-cta" disabled={saving === "next" || text.trim() === ""} aria-busy={saving === "next"}>
                {saving === "next" && <ActivityIndicator size={18} />}
                {saving === "next" ? "Saving…" : "Save the next step"}
              </button>
              <button type="button" className="enq-quiet" disabled={saving === "next"} onClick={() => { setEditing(false); }}>Cancel</button>
            </div>
          </form>
        ) : (
          <div className="pl-next__owed">
            <p className="pl-next__action">{deal.nextAction}</p>
            <p className={`pl-next__due${pressing ? " pl-next__due--pressing" : ""}`}>{due}</p>
            <button type="button" className="enq-quiet" onClick={openEditor}>Change</button>
          </div>
        )
      )}
      {failure?.where === "next" && <p className="enq-confirm__error" role="alert">{failure.message}</p>}

      {closing !== null ? (
        <ConfirmClose title={deal.title} to={closing} saving={busy}
          onConfirm={(reason) => { void onMove(closing, reason).then((saved) => { if (saved) setClosing(null); }); }}
          onCancel={() => { setClosing(null); }} />
      ) : (
        <>
          {(steps.primary !== null || steps.secondary.length > 0) && (
            <div className="enq-actions">
              {steps.primary !== null && (
                <button type="button" className="enq-cta" disabled={busy} aria-busy={busy} onClick={() => { if (steps.primary !== null) run(steps.primary); }}>
                  {busy && <ActivityIndicator size={18} />}
                  {steps.primary.label}
                </button>
              )}
              {steps.secondary.map((secondary) => (
                <button key={secondary.label} type="button" className="enq-quiet" disabled={busy} onClick={() => { run(secondary); }}>
                  {secondary.label}
                </button>
              ))}
            </div>
          )}
          <p className="enq-next__hint">{steps.hint}</p>
        </>
      )}
      {failure?.where === "step" && <p className="enq-confirm__error" role="alert">{failure.message}</p>}
    </section>
  );
}

/** A qualified deal that already has a draft moves on without a second one. */
function withDraft(steps: ReturnType<typeof stageSteps>, stage: string, drafted: boolean): ReturnType<typeof stageSteps> {
  if (stage !== "qualified" || !drafted) return steps;
  return { ...steps, primary: { kind: "stage", to: "proposal_drafting", label: "Move to Proposal drafting" },
    hint: "Its proposal is drafted. Move it on to Proposal drafting." };
}

function ConfirmClose({ title, to, saving, onConfirm, onCancel }: {
  readonly title: string;
  readonly to: "won" | "lost";
  readonly saving: boolean;
  readonly onConfirm: (reason: string) => void;
  readonly onCancel: () => void;
}): ReactElement {
  const questionId = useId();
  const [reason, setReason] = useState("");
  const reasonRef = useRef<HTMLTextAreaElement>(null);
  const questionRef = useRef<HTMLParagraphElement>(null);
  const ready = !saving && reason.trim() !== "";

  // A precise pointer goes straight to the reason; on touch the keyboard would
  // cover the question, so focus lands on it instead.
  useEffect(() => {
    const finePointer = typeof window.matchMedia === "function" && window.matchMedia("(pointer: fine)").matches;
    (finePointer ? reasonRef.current : questionRef.current)?.focus();
  }, []);

  const confirm = (): void => { if (ready) onConfirm(reason.trim()); };

  return (
    <div className="enq-confirm" role="group" aria-labelledby={questionId} data-tone={to === "won" ? "approved" : "declined"}
      data-testid={`deal-confirm-${to}`}>
      <p className="enq-confirm__question" id={questionId} ref={questionRef} tabIndex={-1}>
        {to === "won" ? `Mark ${title} won?` : `Mark ${title} lost?`}
      </p>
      <p className="enq-confirm__consequence">
        {to === "won"
          ? "It leaves the open pipeline and counts as won. Nothing is sent to the client."
          : "It leaves the open pipeline. Nothing is sent to the client."}
      </p>
      <div className="pl-reasons" role="group" aria-label="Common reasons">
        {CLOSE_REASONS[to].map((common) => (
          <button key={common} type="button" className="pl-reason" aria-pressed={reason === common} disabled={saving}
            onClick={() => { setReason(common); reasonRef.current?.focus(); }}>
            {common}
          </button>
        ))}
      </div>
      <label>
        <span>{to === "won" ? "Why it was won" : "Why it was lost"}</span>
        <textarea ref={reasonRef} value={reason} maxLength={2000} rows={2} disabled={saving} required aria-required="true"
          onChange={(event) => { setReason(event.target.value); }}
          onKeyDown={(event) => {
            if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
              event.preventDefault();
              confirm();
            }
          }} />
      </label>
      <div className="enq-actions">
        <button type="button" className="enq-cta" onClick={confirm} disabled={!ready} aria-busy={saving}>
          {saving && <ActivityIndicator size={18} />}
          {saving ? "Saving…" : to === "won" ? "Mark won" : "Mark lost"}
        </button>
        <button type="button" className="enq-quiet" onClick={onCancel} disabled={saving}>Keep it open</button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Follow-ups, who it is with, proposals and the timeline
// ---------------------------------------------------------------------------

function FollowUps({ detail, nowMs, saving, failure, onAddTask, onCompleteTask }: DealPanelProps): ReactElement {
  const headingId = useId();
  const [title, setTitle] = useState("");
  const [day, setDay] = useState("");
  const open = detail.tasks.filter((task) => task.status === "open");
  const done = detail.tasks.filter((task) => task.status === "done").length;

  const add = (): void => {
    if (title.trim() === "") return;
    void onAddTask(title.trim(), day === "" ? null : dayToDueAt(day)).then((saved) => {
      if (saved) { setTitle(""); setDay(""); }
    });
  };

  return (
    <section className="enq-section" aria-labelledby={headingId}>
      <h3 id={headingId}>Follow-ups</h3>
      {open.length === 0 ? (
        <p className="enq-next__hint">{done === 0 ? "None yet." : "All done."}</p>
      ) : (
        <ul className="pl-tasks">
          {open.map((task) => {
            const due = dueWords({ stage: "new", nextActionDueAt: task.dueAt, closedAt: null, updatedAt: task.updatedAt }, nowMs);
            const pressing = dueIsPressing({ stage: "new", nextActionDueAt: task.dueAt }, nowMs);
            const completing = typeof saving === "object" && saving !== null && saving.task === task.id;
            return (
              <li key={task.id}>
                <span className="pl-task__title">{task.title}</span>
                <span className={`pl-task__due${pressing ? " pl-next__due--pressing" : ""}`}>{due}</span>
                <button type="button" className="enq-quiet" disabled={completing} aria-busy={completing}
                  aria-label={`Mark “${task.title}” done`} onClick={() => { onCompleteTask(task); }}>
                  {completing && <ActivityIndicator size={18} />}
                  {completing ? "Saving…" : "Done"}
                </button>
              </li>
            );
          })}
        </ul>
      )}
      <form className="pl-task-form" onSubmit={(event) => { event.preventDefault(); add(); }}>
        <label>
          <span>A follow-up</span>
          <input value={title} maxLength={200} placeholder="Call about the menu" disabled={saving === "task"}
            onChange={(event) => { setTitle(event.target.value); }} />
        </label>
        <label>
          <span>Due on</span>
          <input type="date" value={day} disabled={saving === "task"} onChange={(event) => { setDay(event.target.value); }} />
        </label>
        <button type="submit" className="enq-quiet" disabled={saving === "task" || title.trim() === ""} aria-busy={saving === "task"}>
          {saving === "task" && <ActivityIndicator size={18} />}
          {saving === "task" ? "Adding…" : "Add"}
        </button>
      </form>
      {failure?.where === "task" && <p className="enq-confirm__error" role="alert">{failure.message}</p>}
    </section>
  );
}

function WithWhom({ contact, onOpenClient }: {
  readonly contact: DealContact;
  readonly onOpenClient: ((contactId: string) => void) | undefined;
}): ReactElement {
  const headingId = useId();
  return (
    <section className="enq-section" aria-labelledby={headingId}>
      <h3 id={headingId}>With</h3>
      <p className="pl-contact__name">{contact.name}</p>
      {contact.accountName !== null && <p className="pl-contact__account">{contact.accountName}</p>}
      <div className="enq-contact">
        <a href={`mailto:${contact.email}`}>{contact.email}</a>
        {contact.phone !== null && contact.phone.trim() !== "" && <a href={`tel:${contact.phone.replace(/[^\d+]/gu, "")}`}>{contact.phone}</a>}
      </div>
      {onOpenClient !== undefined && (
        <div className="enq-actions">
          <button type="button" className="enq-quiet" onClick={() => { onOpenClient(contact.id); }}>Open in Clients</button>
        </div>
      )}
    </section>
  );
}

function Proposals({ proposals, onOpenProposal }: {
  readonly proposals: readonly StaffProposal[];
  readonly onOpenProposal: (proposalId: string) => void;
}): ReactElement | null {
  const headingId = useId();
  if (proposals.length === 0) return null;
  return (
    <section className="enq-section" aria-labelledby={headingId}>
      <h3 id={headingId}>Proposals</h3>
      <ul className="cl-list">
        {proposals.map((proposal) => (
          <li key={proposal.id}>
            <button type="button" className="cl-item" onClick={() => { onOpenProposal(proposal.id); }}>
              <span className="cl-item__title">{proposal.title}</span>
              <span className="cl-item__detail">
                {proposalStatusWords(proposal.status)}{proposal.currentVersion > 0 ? ` · version ${proposal.currentVersion.toLocaleString("en-GB")}` : ""}
              </span>
              <ArrowUpRight size={16} aria-hidden="true" className="cl-item__go" />
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}

function Timeline({ detail, saving, failure, onAddNote }: DealPanelProps): ReactElement {
  const headingId = useId();
  const [note, setNote] = useState("");
  const moments = dealTimeline(detail.opportunity, detail.history, detail.activities);
  const add = (): void => {
    if (note.trim() === "") return;
    void onAddNote(note.trim()).then((saved) => { if (saved) setNote(""); });
  };
  return (
    <section className="enq-section" aria-labelledby={headingId}>
      <h3 id={headingId}>Timeline</h3>
      <form className="pl-note-form" onSubmit={(event) => { event.preventDefault(); add(); }}>
        <label>
          <span>Add a note</span>
          <textarea value={note} rows={2} maxLength={4000} disabled={saving === "note"}
            onChange={(event) => { setNote(event.target.value); }}
            onKeyDown={(event) => {
              if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
                event.preventDefault();
                add();
              }
            }} />
        </label>
        <div className="enq-actions">
          <button type="submit" className="enq-quiet" disabled={saving === "note" || note.trim() === ""} aria-busy={saving === "note"}>
            {saving === "note" && <ActivityIndicator size={18} />}
            {saving === "note" ? "Adding…" : "Add the note"}
          </button>
        </div>
      </form>
      {failure?.where === "note" && <p className="enq-confirm__error" role="alert">{failure.message}</p>}
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
    </section>
  );
}
