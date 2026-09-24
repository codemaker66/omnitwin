import { useEffect, useId, useRef, useState, type KeyboardEvent, type ReactElement, type RefObject } from "react";
import { ArrowLeft, ArrowUpRight, ChevronDown, ChevronUp, X } from "lucide-react";
import type { Enquiry, StatusHistoryEntry } from "../../../api/enquiries.js";
import { ActivityIndicator, ActivityStatus } from "../../shared/Activity.js";
import { AIDraftPanel } from "../../ai/AIDraftPanel.js";
import { StageChip } from "./EnquiryStages.js";
import { enquiryName } from "./EnquiryLedger.js";
import type { RoomPhoto } from "./enquiry-room-photo.js";
import type { VenueRoom } from "./use-venue-rooms.js";
import {
  eventDateParts, eventLead, eventWeekday, relativeAge, stageLabel, stageTone, venueMoment,
} from "./enquiry-desk-format.js";

// ---------------------------------------------------------------------------
// The decision panel: one enquiry, the facts a booker decides on in large
// type, what the client wrote, and the next step in the same place every
// time. Approving or declining emails the client, so both ask once, inline,
// and say what will be sent; starting a review sends nothing and needs no
// confirmation.
// ---------------------------------------------------------------------------

export type TransitionTarget = "under_review" | "approved" | "rejected";

export interface PanelTransition {
  /** The decision being confirmed, or null. */
  readonly confirming: TransitionTarget | null;
  /** The change being saved, or null. */
  readonly saving: TransitionTarget | null;
  readonly failure: string | null;
}

export interface PanelNavigation {
  readonly layout: "wide" | "single";
  /** "Back to enquiries", or "Back to profile" when a profile opened it. */
  readonly backLabel: string;
  readonly canPrevious: boolean;
  readonly canNext: boolean;
  readonly onClose: () => void;
  readonly onStep: (direction: 1 | -1) => void;
}

interface EnquiryPanelProps {
  readonly enquiry: Enquiry;
  /** Undefined while the venue's rooms are being read; null when unknown. */
  readonly room: VenueRoom | null | undefined;
  readonly nowMs: number;
  readonly history: readonly StatusHistoryEntry[];
  readonly historyStatus: "loading" | "ready" | "error";
  readonly transition: PanelTransition;
  readonly stampKey: number | null;
  readonly announcement: string | null;
  readonly creatingOpportunity: boolean;
  readonly navigation: PanelNavigation;
  readonly headingRef: RefObject<HTMLHeadingElement>;
  readonly onRequest: (to: TransitionTarget, withNote: boolean) => void;
  readonly onConfirm: (note: string) => void;
  readonly onCancel: () => void;
  readonly onCreateOpportunity: () => void;
}

function isEditable(target: EventTarget): boolean {
  return target instanceof HTMLTextAreaElement || target instanceof HTMLInputElement
    || target instanceof HTMLSelectElement || (target instanceof HTMLElement && target.isContentEditable);
}

export function EnquiryPanel(props: EnquiryPanelProps): ReactElement {
  const { enquiry, room, nowMs, transition, navigation, headingRef } = props;
  const headingId = useId();
  const name = enquiryName(enquiry);
  const received = relativeAge(enquiry.createdAt, nowMs);
  const eventType = enquiry.eventType?.trim() ?? "";
  const eyebrow = `${eventType === "" ? "Enquiry" : eventType}${received === null ? "" : ` · received ${received}`}`;

  const step = (event: KeyboardEvent<HTMLElement>): void => {
    if (event.altKey || event.ctrlKey || event.metaKey || isEditable(event.target)) return;
    if (event.key !== "j" && event.key !== "k") return;
    event.preventDefault();
    navigation.onStep(event.key === "j" ? 1 : -1);
  };

  return (
    <section className="enq-panel" aria-labelledby={headingId} onKeyDown={step}>
      <div className="enq-panel__body">
        <div className="enq-panel__bar">
          {navigation.layout === "single" ? (
            <button type="button" className="enq-back" onClick={navigation.onClose}>
              <ArrowLeft size={16} aria-hidden="true" /> {navigation.backLabel}
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
            <button type="button" className="enq-close" onClick={navigation.onClose} aria-label={navigation.backLabel}
              aria-keyshortcuts="Escape">
              <X size={18} aria-hidden="true" />
            </button>
          )}
        </div>

        {room?.photo !== undefined && room.photo !== null && <RoomPhotoBand photo={room.photo} />}
        <p className="enq-eyebrow">{eyebrow}</p>
        <h2 className="enq-panel__name" id={headingId} ref={headingRef} tabIndex={-1}>{name}</h2>
        <div className="enq-panel__status">
          <StageChip key={props.stampKey ?? "still"} state={enquiry.state} stamped={props.stampKey !== null} />
        </div>
        <p className="vv-sr-only" role="status">{props.announcement}</p>

        <EnquiryFacts enquiry={enquiry} roomName={room === undefined ? undefined : room?.name ?? null} nowMs={nowMs} />

        <section className="enq-section">
          <h3>Next step</h3>
          <StagePath state={enquiry.state} />
          {transition.confirming === null ? (
            <NextStep enquiry={enquiry} transition={transition} creatingOpportunity={props.creatingOpportunity}
              onRequest={props.onRequest} onCreateOpportunity={props.onCreateOpportunity} />
          ) : (
            <ConfirmStep enquiry={enquiry} to={transition.confirming} saving={transition.saving !== null}
              failure={transition.failure} onConfirm={props.onConfirm} onCancel={props.onCancel} />
          )}
        </section>

        <section className="enq-section">
          <h3>Contact</h3>
          <div className="enq-contact">
            <a href={`mailto:${enquiry.guestEmail ?? enquiry.email}`}>{enquiry.guestEmail ?? enquiry.email}</a>
            {enquiry.guestPhone !== null && enquiry.guestPhone.trim() !== "" && (
              <a href={`tel:${enquiry.guestPhone.replace(/[^\d+]/gu, "")}`}>{enquiry.guestPhone}</a>
            )}
            {enquiry.userId === null && <span className="enq-contact__note">Sent without a Venviewer account</span>}
          </div>
        </section>

        {enquiry.message !== null && enquiry.message.trim() !== "" && (
          <section className="enq-section">
            <h3>Their message</h3>
            <blockquote className="enq-quote">{enquiry.message.trim()}</blockquote>
          </section>
        )}

        <EnquiryTools enquiry={enquiry} creatingOpportunity={props.creatingOpportunity}
          onCreateOpportunity={props.onCreateOpportunity} />

        <EnquiryDrafts enquiry={enquiry} />

        <section className="enq-section">
          <h3>Timeline</h3>
          <EnquiryTimeline enquiry={enquiry} history={props.history} status={props.historyStatus} />
        </section>
      </div>
    </section>
  );
}

// ---------------------------------------------------------------------------
// The room, pictured
// ---------------------------------------------------------------------------

/** The requested room's photograph, fading into the panel. It illustrates a
 *  room already named in text, so it is not announced. */
export function RoomPhotoBand({ photo }: { readonly photo: RoomPhoto }): ReactElement {
  return (
    <div className="enq-room-photo" aria-hidden="true">
      <img src={photo.src} srcSet={photo.srcSet} sizes="(min-width: 1180px) 540px, 100vw" alt="" decoding="async"
        style={{ objectPosition: photo.objectPosition }} />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Facts
// ---------------------------------------------------------------------------

function EnquiryFacts({ enquiry, roomName, nowMs }: {
  readonly enquiry: Enquiry;
  readonly roomName: string | null | undefined;
  readonly nowMs: number;
}): ReactElement {
  const date = eventDateParts(enquiry.preferredDate);
  const weekday = eventWeekday(enquiry.preferredDate);
  const lead = eventLead(enquiry.preferredDate, nowMs);
  const guests = enquiry.estimatedGuests;
  return (
    <dl className="enq-facts">
      <div>
        <dt>{date === null ? "Event date" : [weekday, lead].filter((part) => part !== null).join(", ")}</dt>
        {date === null
          ? <dd className="enq-facts__muted">To be confirmed</dd>
          : <dd>{`${date.day} ${date.month} ${date.year}`}</dd>}
      </div>
      <div>
        <dt>{guests === 1 ? "guest" : "guests"}</dt>
        {guests === null
          ? <dd className="enq-facts__muted">Not given</dd>
          : <dd>{guests.toLocaleString("en-GB")}</dd>}
      </div>
      <div>
        <dt>room</dt>
        {roomName === undefined ? <dd aria-hidden="true" />
          : roomName === null ? <dd className="enq-facts__muted">Not known</dd>
            : <dd className="enq-facts__room">{roomName}</dd>}
      </div>
    </dl>
  );
}

// ---------------------------------------------------------------------------
// Where the enquiry is, and what can happen next
// ---------------------------------------------------------------------------

const PATH: Readonly<Record<string, readonly (readonly [label: string, state: "done" | "current" | "todo"])[]>> = {
  submitted: [["New", "current"], ["In review", "todo"], ["Decision", "todo"]],
  under_review: [["New", "done"], ["In review", "current"], ["Decision", "todo"]],
  approved: [["New", "done"], ["In review", "done"], ["Approved", "current"]],
  rejected: [["New", "done"], ["In review", "done"], ["Declined", "current"]],
  withdrawn: [["New", "done"], ["Withdrawn", "current"]],
};

function StagePath({ state }: { readonly state: string }): ReactElement | null {
  const path = PATH[state];
  if (path === undefined) return null;
  return (
    <ol className="enq-path" aria-label="Progress">
      {path.map(([label, step]) => (
        <li key={label} data-state={step} aria-current={step === "current" ? "step" : undefined}>
          <span className="enq-path__mark" aria-hidden="true" />
          {label}
        </li>
      ))}
    </ol>
  );
}

function NextStep({ enquiry, transition, creatingOpportunity, onRequest, onCreateOpportunity }: {
  readonly enquiry: Enquiry;
  readonly transition: PanelTransition;
  readonly creatingOpportunity: boolean;
  readonly onRequest: (to: TransitionTarget, withNote: boolean) => void;
  readonly onCreateOpportunity: () => void;
}): ReactElement {
  const busy = transition.saving !== null;
  const failure = transition.failure === null ? null
    : <p className="enq-confirm__error" role="alert">{transition.failure}</p>;

  switch (enquiry.state) {
    case "submitted":
      return (
        <>
          <div className="enq-actions">
            <button type="button" className="enq-cta" onClick={() => { onRequest("under_review", false); }}
              disabled={busy} aria-busy={transition.saving === "under_review"}>
              {transition.saving === "under_review" && <ActivityIndicator size={18} />}
              {transition.saving === "under_review" ? "Starting review…" : "Start review"}
            </button>
            <button type="button" className="enq-quiet" data-transition="under_review"
              onClick={() => { onRequest("under_review", true); }} disabled={busy}>
              Start review with a note
            </button>
          </div>
          <p className="enq-next__hint">Only your team sees this stage. Nothing is sent to the client.</p>
          {failure}
        </>
      );
    case "under_review":
      return (
        <>
          <div className="enq-actions">
            <button type="button" className="enq-cta" data-transition="approved"
              onClick={() => { onRequest("approved", true); }} disabled={busy}>
              Approve…
            </button>
            <button type="button" className="enq-quiet" data-transition="rejected"
              onClick={() => { onRequest("rejected", true); }} disabled={busy}>
              Decline…
            </button>
          </div>
          <p className="enq-next__hint">Either decision emails the client. You will see what is sent before it goes.</p>
          {failure}
        </>
      );
    case "approved":
      return (
        <>
          <div className="enq-actions">
            <button type="button" className="enq-cta" data-testid="create-opportunity-from-enquiry"
              onClick={onCreateOpportunity} disabled={creatingOpportunity} aria-busy={creatingOpportunity}>
              {creatingOpportunity && <ActivityIndicator size={18} />}
              Create opportunity
            </button>
          </div>
          <p className="enq-next__hint">Approved. An opportunity carries it on to a proposal.</p>
          {failure}
        </>
      );
    case "rejected":
      return <><p className="enq-next__hint">Declined. There is nothing more to do here.</p>{failure}</>;
    case "withdrawn":
      return <><p className="enq-next__hint">Withdrawn. There is nothing more to do here.</p>{failure}</>;
    default:
      return <><p className="enq-next__hint">{stageLabel(enquiry.state)}. There is no next step from here.</p>{failure}</>;
  }
}

interface ConfirmWords {
  readonly question: (name: string) => string;
  readonly consequence: (enquiry: Enquiry) => string;
  readonly noteLabel: string;
  readonly confirm: string;
  readonly saving: string;
}

const CONFIRM_WORDS: Readonly<Record<TransitionTarget, ConfirmWords>> = {
  under_review: {
    question: (name) => `Start reviewing ${name}’s enquiry?`,
    consequence: () => "Only your team sees this stage and the note. Nothing is sent to the client.",
    noteLabel: "Note for the timeline (optional)",
    confirm: "Start review",
    saving: "Starting review…",
  },
  approved: {
    question: (name) => `Approve ${name}’s enquiry?`,
    consequence: (enquiry) => `Approving emails ${enquiry.guestEmail ?? enquiry.email} to say the enquiry is approved${enquiry.configurationId === null ? "" : ", with a link to their layout"}.`,
    noteLabel: "Note for the timeline (optional, not in the email)",
    confirm: "Approve and email",
    saving: "Approving…",
  },
  rejected: {
    question: (name) => `Decline ${name}’s enquiry?`,
    consequence: (enquiry) => `Declining emails ${enquiry.guestEmail ?? enquiry.email} to say the venue cannot take this request, and invites them to try other dates or rooms.`,
    noteLabel: "Note to the client (optional, shown in the email as “Note from the events team”)",
    confirm: "Decline and email",
    saving: "Declining…",
  },
};

function ConfirmStep({ enquiry, to, saving, failure, onConfirm, onCancel }: {
  readonly enquiry: Enquiry;
  readonly to: TransitionTarget;
  readonly saving: boolean;
  readonly failure: string | null;
  readonly onConfirm: (note: string) => void;
  readonly onCancel: () => void;
}): ReactElement {
  const questionId = useId();
  const [note, setNote] = useState("");
  const noteRef = useRef<HTMLTextAreaElement>(null);
  const questionRef = useRef<HTMLParagraphElement>(null);
  const words = CONFIRM_WORDS[to];

  // A precise pointer goes straight to the note; on touch the keyboard would
  // cover the confirmation, so focus lands on the question instead.
  useEffect(() => {
    const finePointer = typeof window.matchMedia === "function" && window.matchMedia("(pointer: fine)").matches;
    (finePointer ? noteRef.current : questionRef.current)?.focus();
  }, []);

  return (
    <div className="enq-confirm" role="group" aria-labelledby={questionId} data-tone={stageTone(to)}>
      <p className="enq-confirm__question" id={questionId} ref={questionRef} tabIndex={-1}>{words.question(enquiryName(enquiry))}</p>
      <p className="enq-confirm__consequence">{words.consequence(enquiry)}</p>
      <label>
        <span>{words.noteLabel}</span>
        <textarea ref={noteRef} value={note} maxLength={1000} rows={3} disabled={saving}
          onChange={(event) => { setNote(event.target.value); }}
          onKeyDown={(event) => {
            if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
              event.preventDefault();
              onConfirm(note);
            }
          }} />
      </label>
      <div className="enq-actions">
        <button type="button" className="enq-cta" onClick={() => { onConfirm(note); }} disabled={saving} aria-busy={saving}>
          {saving && <ActivityIndicator size={18} />}
          {saving ? words.saving : words.confirm}
        </button>
        <button type="button" className="enq-quiet" onClick={onCancel} disabled={saving}>Cancel</button>
      </div>
      {failure !== null && <p className="enq-confirm__error" role="alert">{failure}</p>}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Tools, drafts, timeline
// ---------------------------------------------------------------------------

function EnquiryTools({ enquiry, creatingOpportunity, onCreateOpportunity }: {
  readonly enquiry: Enquiry;
  readonly creatingOpportunity: boolean;
  readonly onCreateOpportunity: () => void;
}): ReactElement | null {
  // An approved enquiry offers the opportunity as its next step instead.
  const offersOpportunity = enquiry.state !== "approved";
  if (!offersOpportunity && enquiry.configurationId === null) return null;
  return (
    <section className="enq-section">
      <h3>Tools</h3>
      <div className="enq-actions">
        {enquiry.configurationId !== null && (
          <a className="enq-quiet" href={`/plan/${enquiry.configurationId}`} target="_blank" rel="noreferrer">
            Open their layout <ArrowUpRight size={16} aria-hidden="true" />
            <span className="vv-sr-only"> (opens in a new tab)</span>
          </a>
        )}
        {offersOpportunity && (
          <button type="button" className="enq-quiet" data-testid="create-opportunity-from-enquiry"
            onClick={onCreateOpportunity} disabled={creatingOpportunity} aria-busy={creatingOpportunity}>
            {creatingOpportunity && <ActivityIndicator size={16} />}
            Create opportunity
          </button>
        )}
      </div>
    </section>
  );
}

function EnquiryDrafts({ enquiry }: { readonly enquiry: Enquiry }): ReactElement {
  // The drafting panels ask whether AI is available when they mount, so they
  // mount only once someone opens this section.
  const [open, setOpen] = useState(false);
  return (
    <section className="enq-section">
      <details className="enq-drafts" onToggle={(event) => { setOpen(event.currentTarget.open); }}>
        <summary>Draft with AI</summary>
        {open && (
          <div className="enq-drafts__body">
            <AIDraftPanel
              title="Enquiry summary"
              useCase="enquiry_summary"
              actionLabel="Draft summary"
              context={{
                enquiryId: enquiry.id,
                name: enquiry.guestName ?? enquiry.name,
                email: enquiry.guestEmail ?? enquiry.email,
                eventType: enquiry.eventType,
                preferredDate: enquiry.preferredDate,
                estimatedGuests: enquiry.estimatedGuests,
                message: enquiry.message,
                currentStatus: enquiry.state,
              }}
            />
            <AIDraftPanel
              title="Proposal wording"
              useCase="proposal_draft"
              actionLabel="Draft proposal copy"
              context={{
                enquiryId: enquiry.id,
                clientName: enquiry.guestName ?? enquiry.name,
                eventType: enquiry.eventType,
                preferredDate: enquiry.preferredDate,
                estimatedGuests: enquiry.estimatedGuests,
                clientNotes: enquiry.message,
                currentStatus: enquiry.state,
              }}
            />
          </div>
        )}
      </details>
    </section>
  );
}

const TIMELINE_WORDS: Readonly<Record<string, string>> = {
  submitted: "Submitted",
  under_review: "Review started",
  approved: "Approved",
  rejected: "Declined",
  withdrawn: "Withdrawn",
  archived: "Archived",
};

function EnquiryTimeline({ enquiry, history, status }: {
  readonly enquiry: Enquiry;
  readonly history: readonly StatusHistoryEntry[];
  readonly status: "loading" | "ready" | "error";
}): ReactElement {
  return (
    <>
      <ol className="enq-timeline">
        <li>
          <span className="enq-dot" data-tone="new" aria-hidden="true" />
          <strong>Enquiry received</strong>
          <time dateTime={enquiry.createdAt}>{venueMoment(enquiry.createdAt) ?? enquiry.createdAt}</time>
        </li>
        {history.map((entry) => (
          <li key={entry.id}>
            <span className="enq-dot" data-tone={stageTone(entry.toStatus)} aria-hidden="true" />
            <strong>{TIMELINE_WORDS[entry.toStatus] ?? stageLabel(entry.toStatus)}</strong>
            <time dateTime={entry.createdAt}>{venueMoment(entry.createdAt) ?? entry.createdAt}</time>
            {entry.note !== null && entry.note.trim() !== "" && <q>{entry.note.trim()}</q>}
          </li>
        ))}
      </ol>
      {status === "loading" && <ActivityStatus className="enq-panel__activity">Loading the timeline…</ActivityStatus>}
      {status === "error" && <p className="enq-next__hint">The rest of the timeline could not be loaded.</p>}
    </>
  );
}
