import { useEffect, useId, useRef, useState, type KeyboardEvent, type ReactElement, type RefObject } from "react";
import { occasionLabel } from "@omnitwin/types";
import { Link } from "react-router-dom";
import { ArrowLeft, ArrowUpRight, ChevronDown, ChevronUp, X } from "lucide-react";
import type { Enquiry, StatusHistoryEntry } from "../../../api/enquiries.js";
import { ActivityIndicator, ActivityStatus } from "../../shared/Activity.js";
import { AIDraftPanel } from "../../ai/AIDraftPanel.js";
import { useAIDraftsAvailable } from "../../../hooks/use-ai-drafts-available.js";
import { StageChip } from "./EnquiryStages.js";
import { EnquiryNameText, enquiryName } from "./EnquiryLedger.js";
import type { RoomPhoto } from "./enquiry-room-photo.js";
import type { EnquiryStanding } from "./enquiry-standing.js";
import type { VenueRoom } from "./use-venue-rooms.js";
import { theRoom } from "../proposals/template-format.js";
import {
  eventDateLong, eventDateParts, eventLead, eventWeekday, relativeAge, requestKind, requestWords, sourceWords, stageLabel, stageTone,
  venueMoment, type RequestKind,
} from "./enquiry-desk-format.js";

// ---------------------------------------------------------------------------
// The decision panel: one enquiry, the facts a booker decides on in large
// type, what the client wrote, and the next step in the same place every
// time. Approving or declining emails the client, so both ask once, inline,
// and say what will be sent; starting a review sends nothing and needs no
// confirmation.
//
// An access request or a Venviewer enquiry asks to book nothing, so it is
// never approved or declined (the API refuses both): it says what it asks
// for, and is marked done, or reopened, without an email.
// ---------------------------------------------------------------------------

/** A change the panel may ask the reader to confirm. */
export type ConfirmTarget = "under_review" | "approved" | "rejected" | "archived";
/** Every change the panel makes; reopening a request is never confirmed. */
export type TransitionTarget = ConfirmTarget | "submitted";

export interface PanelTransition {
  /** The decision being confirmed, or null. */
  readonly confirming: ConfirmTarget | null;
  /** The change being saved, or null. */
  readonly saving: TransitionTarget | null;
  readonly failure: string | null;
}

/** Where the enquiry stands in the Diary, for a reader of the enquiry's own
 *  venue's Diary (docs/design/enquiry-day-answer-2026-10-13). */
export interface PanelDiary {
  /** waiting: before the first read, so the slot is held blank; reading: a
   *  read is out and nothing is kept; failed: nothing could be read. */
  readonly status: "waiting" | "reading" | "ready" | "failed";
  readonly standing: EnquiryStanding | null;
  /** The latest read failed: Try again is offered, and a kept answer stays. */
  readonly failed: boolean;
  /** What a failed read says: "The Diary could not be read for that day." */
  readonly failure: string;
  readonly reading: boolean;
  /** "14:02" once the answer on screen is more than two minutes old. */
  readonly readAt: string | null;
  /** What Approve says: null while the Diary is read for it. */
  readonly approve: string | null;
  /** "Hold a date in the Diary", for a Diary writer the drawer would let hold it. */
  readonly holdHref: string | null;
  /** "Open this day in the Diary", when there is a day asked for. */
  readonly dayHref: string | null;
  readonly onRetry: () => void;
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
  /** Only the commercial team may create an opportunity; for anyone else the
   *  control is not offered at all, rather than offered and refused. */
  readonly canCreateOpportunity: boolean;
  readonly creatingOpportunity: boolean;
  /** Why Create opportunity failed, said beside it; null when it has not. */
  readonly opportunityFailure: string | null;
  /** Where the enquiry stands in the Diary; null when the reader reads no
   *  Diary for it (another venue's enquiry, or a role without the Diary). */
  readonly diary: PanelDiary | null;
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
  const received = relativeAge(enquiry.createdAt, nowMs);
  const request = requestKind(enquiry.eventType);
  const kindLabel = request !== null ? requestWords(request).label : occasionLabel(enquiry.eventType) ?? "Enquiry";
  const eyebrow = `${kindLabel}${received === null ? "" : ` · received ${received}`}`;
  const source = sourceWords(enquiry.source);

  const step = (event: KeyboardEvent<HTMLElement>): void => {
    if (event.altKey || event.ctrlKey || event.metaKey || isEditable(event.target)) return;
    if (event.key !== "j" && event.key !== "k") return;
    event.preventDefault();
    navigation.onStep(event.key === "j" ? 1 : -1);
  };

  return (
    <section className="enq-panel" data-register="forest" aria-labelledby={headingId} onKeyDown={step}>
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

        {request === null && room?.photo !== undefined && room.photo !== null && <RoomPhotoBand photo={room.photo} />}
        <p className="enq-eyebrow">{eyebrow}</p>
        <h2 className="enq-panel__name" id={headingId} ref={headingRef} tabIndex={-1}><EnquiryNameText enquiry={enquiry} /></h2>
        <div className="enq-panel__status">
          <StageChip key={props.stampKey ?? "still"} state={enquiry.state} stamped={props.stampKey !== null}
            request={request !== null} />
          {request === null && source !== null && <span className="enq-source">{source}</span>}
        </div>
        <p className="vv-sr-only" role="status">{props.announcement}</p>

        {request === null
          ? <EnquiryFacts enquiry={enquiry} roomName={room === undefined ? undefined : room?.name ?? null} nowMs={nowMs} diary={props.diary} />
          : <p className="enq-request">{requestWords(request).ask}</p>}

        <section className="enq-section">
          <h3>Next step</h3>
          <StagePath state={enquiry.state} request={request !== null} />
          {transition.confirming !== null ? (
            <ConfirmStep enquiry={enquiry} to={transition.confirming} roomName={room?.name ?? null}
              diarySays={transition.confirming === "approved" && props.diary !== null ? props.diary.approve : undefined}
              saving={transition.saving !== null} failure={transition.failure} onConfirm={props.onConfirm} onCancel={props.onCancel} />
          ) : request === null ? (
            <NextStep enquiry={enquiry} transition={transition} canCreateOpportunity={props.canCreateOpportunity}
              creatingOpportunity={props.creatingOpportunity} opportunityFailure={props.opportunityFailure}
              onRequest={props.onRequest} onCreateOpportunity={props.onCreateOpportunity} />
          ) : (
            <RequestNextStep enquiry={enquiry} kind={request} transition={transition} onRequest={props.onRequest} />
          )}
        </section>

        {request === null && props.diary !== null && <EnquiryDiary diary={props.diary} />}

        <section className="enq-section">
          <h3>Contact</h3>
          <div className="enq-contact">
            <a href={`mailto:${enquiry.guestEmail ?? enquiry.email}`}>{enquiry.guestEmail ?? enquiry.email}</a>
            {enquiry.guestPhone !== null && enquiry.guestPhone.trim() !== "" && (
              <a href={`tel:${enquiry.guestPhone.replace(/[^\d+]/gu, "")}`}>{enquiry.guestPhone}</a>
            )}
            {/* An access request comes from someone signed in but not invited, so
                requests leave the note off. */}
            {enquiry.userId === null && request === null
              && <span className="enq-contact__note">Sent without a Venviewer account</span>}
          </div>
        </section>

        {enquiry.message !== null && enquiry.message.trim() !== "" && (
          <section className="enq-section">
            <h3>Their message</h3>
            <blockquote className="enq-quote">{enquiry.message.trim()}</blockquote>
          </section>
        )}

        {/* An opportunity, a layout and proposal wording belong to bookings. */}
        {request === null && (
          <>
            <EnquiryTools enquiry={enquiry} canCreateOpportunity={props.canCreateOpportunity}
              creatingOpportunity={props.creatingOpportunity} opportunityFailure={props.opportunityFailure}
              onCreateOpportunity={props.onCreateOpportunity} />
            <EnquiryDrafts enquiry={enquiry} />
          </>
        )}

        <section className="enq-section">
          <h3>Timeline</h3>
          <EnquiryTimeline enquiry={enquiry} history={props.history} status={props.historyStatus} request={request !== null} />
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

function EnquiryFacts({ enquiry, roomName, nowMs, diary }: {
  readonly enquiry: Enquiry;
  readonly roomName: string | null | undefined;
  readonly nowMs: number;
  readonly diary: PanelDiary | null;
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
        {/* The room a roomless enquiry is filed under is not the guest's choice. */}
        {enquiry.roomChosen === false ? <dd className="enq-facts__muted">Not chosen</dd>
          : roomName === undefined ? <dd aria-hidden="true" />
            : roomName === null ? <dd className="enq-facts__muted">Not known</dd>
              : <dd className="enq-facts__room">{roomName}</dd>}
      </div>
      {diary !== null && (
        // Its label above its answer, held at two lines from the first paint,
        // so nothing below moves when the Diary answers; the whole answer is
        // in the list below and in what is read out.
        <div className="enq-facts__diary">
          <dt>In the Diary</dt>
          <dd>
            {diary.standing !== null ? diary.standing.fact
              : diary.status === "reading" ? <span className="enq-facts__reading"><ActivityIndicator size={16} />Reading the Diary…</span>
                : diary.status === "failed" ? diary.failure
                  : null}
          </dd>
        </div>
      )}
    </dl>
  );
}

// ---------------------------------------------------------------------------
// In the Diary: its actions first, so nothing below them moves when the Diary
// answers; then the enquiry's own bookings elsewhere, then the day asked for,
// room by room.
// ---------------------------------------------------------------------------

function EnquiryDiary({ diary }: { readonly diary: PanelDiary }): ReactElement {
  const headingId = useId();
  const headingRef = useRef<HTMLHeadingElement>(null);
  // Try again keeps its place, and focus, while it reads; when the read
  // lands and it goes, focus it held moves to the section, not the page.
  const retryHadFocus = useRef(false);
  useEffect(() => {
    if (diary.failed || !retryHadFocus.current) return;
    retryHadFocus.current = false;
    headingRef.current?.focus();
  }, [diary.failed]);
  const { standing } = diary;
  const hasActions = diary.failed || diary.holdHref !== null || diary.dayHref !== null;
  return (
    <section className="enq-section enq-diary" aria-labelledby={headingId}>
      <h3 id={headingId} ref={headingRef} tabIndex={-1}>In the Diary</h3>
      {hasActions && (
        <div className="enq-actions">
          {diary.failed && (
            <button type="button" className="enq-quiet" aria-disabled={diary.reading}
              onFocus={() => { retryHadFocus.current = true; }} onBlur={() => { retryHadFocus.current = false; }}
              onClick={() => { if (!diary.reading) diary.onRetry(); }}>
              {diary.reading && <ActivityIndicator size={16} />}
              Try again
            </button>
          )}
          {diary.holdHref !== null && <Link className="enq-quiet" to={diary.holdHref}>Hold a date in the Diary</Link>}
          {diary.dayHref !== null && <Link className="enq-quiet" to={diary.dayHref}>Open this day in the Diary</Link>}
        </div>
      )}
      {diary.failed && <p className="enq-diary__note">{diary.failure}</p>}
      {diary.readAt !== null && <p className="enq-diary__note">As read at {diary.readAt}.</p>}
      {standing !== null && standing.elsewhere.length > 0 && (
        <ul className="enq-diary__own">
          {standing.elsewhere.map((line) => <li key={line.key}>{line.text}</li>)}
        </ul>
      )}
      {standing !== null && standing.rooms.length > 0 && (
        <dl className="enq-diary__rooms">
          {standing.rooms.map((room) => (
            <div key={room.id} className="enq-diary__room">
              <dt>
                <span>{room.name}</span>
                {room.asked && <span className="enq-diary__tag">asked for</span>}
                {room.figure !== null && <span className="enq-diary__figure">{room.figure}</span>}
              </dt>
              {room.lines.map((line) => (
                <dd key={line.key} data-kind={line.kind}>
                  {line.text}
                  {line.own && <span className="enq-diary__tag">For this enquiry</span>}
                </dd>
              ))}
            </div>
          ))}
        </dl>
      )}
    </section>
  );
}

// ---------------------------------------------------------------------------
// Where the enquiry is, and what can happen next
// ---------------------------------------------------------------------------

type Path = Readonly<Record<string, readonly (readonly [label: string, state: "done" | "current" | "todo"])[]>>;

const PATH: Path = {
  submitted: [["New", "current"], ["In review", "todo"], ["Decision", "todo"]],
  under_review: [["New", "done"], ["In review", "current"], ["Decision", "todo"]],
  approved: [["New", "done"], ["In review", "done"], ["Approved", "current"]],
  rejected: [["New", "done"], ["In review", "done"], ["Declined", "current"]],
  withdrawn: [["New", "done"], ["Withdrawn", "current"]],
};

/** A request is read and marked done; one moved into review before requests
 *  had their own path shows that step. */
const REQUEST_PATH: Path = {
  submitted: [["New", "current"], ["Done", "todo"]],
  under_review: [["New", "done"], ["In review", "current"], ["Done", "todo"]],
  archived: [["New", "done"], ["Done", "current"]],
  withdrawn: [["New", "done"], ["Withdrawn", "current"]],
};

function StagePath({ state, request }: { readonly state: string; readonly request: boolean }): ReactElement | null {
  const path = (request ? REQUEST_PATH : PATH)[state];
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

function NextStep({ enquiry, transition, canCreateOpportunity, creatingOpportunity, opportunityFailure, onRequest, onCreateOpportunity }: {
  readonly enquiry: Enquiry;
  readonly transition: PanelTransition;
  readonly canCreateOpportunity: boolean;
  readonly creatingOpportunity: boolean;
  readonly opportunityFailure: string | null;
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
          {canCreateOpportunity && (
            <div className="enq-actions">
              <button type="button" className="enq-cta" data-testid="create-opportunity-from-enquiry"
                onClick={onCreateOpportunity} disabled={creatingOpportunity} aria-busy={creatingOpportunity}>
                {creatingOpportunity && <ActivityIndicator size={18} />}
                Create opportunity
              </button>
            </div>
          )}
          {opportunityFailure !== null && <p className="enq-confirm__error" role="alert">{opportunityFailure}</p>}
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

/** A request's next step: marked done without an email, or reopened. */
function RequestNextStep({ enquiry, kind, transition, onRequest }: {
  readonly enquiry: Enquiry;
  readonly kind: RequestKind;
  readonly transition: PanelTransition;
  readonly onRequest: (to: TransitionTarget, withNote: boolean) => void;
}): ReactElement {
  const busy = transition.saving !== null;
  const failure = transition.failure === null ? null
    : <p className="enq-confirm__error" role="alert">{transition.failure}</p>;

  switch (enquiry.state) {
    case "submitted":
    case "under_review":
      return (
        <>
          <div className="enq-actions">
            <button type="button" className="enq-cta" onClick={() => { onRequest("archived", false); }}
              disabled={busy} aria-busy={transition.saving === "archived"}>
              {transition.saving === "archived" && <ActivityIndicator size={18} />}
              {transition.saving === "archived" ? "Marking done…" : "Mark done"}
            </button>
            <button type="button" className="enq-quiet" data-transition="archived"
              onClick={() => { onRequest("archived", true); }} disabled={busy}>
              Mark done with a note
            </button>
          </div>
          <p className="enq-next__hint">{requestWords(kind).next}</p>
          {failure}
        </>
      );
    case "archived":
      return (
        <>
          <div className="enq-actions">
            <button type="button" className="enq-quiet" data-transition="submitted"
              onClick={() => { onRequest("submitted", false); }} disabled={busy} aria-busy={transition.saving === "submitted"}>
              {transition.saving === "submitted" && <ActivityIndicator size={16} />}
              {transition.saving === "submitted" ? "Reopening…" : "Reopen"}
            </button>
          </div>
          <p className="enq-next__hint">Done. Reopening returns it to New.</p>
          {failure}
        </>
      );
    case "withdrawn":
      return <><p className="enq-next__hint">Withdrawn. There is nothing more to do here.</p>{failure}</>;
    default:
      return <><p className="enq-next__hint">{stageLabel(enquiry.state, true)}. There is no next step from here.</p>{failure}</>;
  }
}

interface ConfirmWords {
  readonly question: (name: string) => string;
  /** `roomName`: the room the guest chose, as the approval email names it. */
  readonly consequence: (enquiry: Enquiry, roomName: string | null) => string;
  readonly noteLabel: string;
  readonly confirm: string;
  readonly saving: string;
}

const CONFIRM_WORDS: Readonly<Record<ConfirmTarget, ConfirmWords>> = {
  under_review: {
    question: (name) => `Start reviewing ${name}’s enquiry?`,
    consequence: () => "Only your team sees this stage and the note. Nothing is sent to the client.",
    noteLabel: "Note for the timeline (optional)",
    confirm: "Start review",
    saving: "Starting review…",
  },
  approved: {
    question: (name) => `Approve ${name}’s enquiry?`,
    // The room and the date as the email names them.
    consequence: (enquiry, roomName) => {
      const date = eventDateLong(enquiry.preferredDate);
      const what = `the enquiry${roomName === null ? "" : ` for ${theRoom(roomName)}`}${date === null ? "" : ` on ${date}`}`;
      return `Approving emails ${enquiry.guestEmail ?? enquiry.email} to say ${what} is approved${enquiry.configurationId === null ? "" : ", with a link to their layout"}.`;
    },
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
  archived: {
    question: (name) => `Mark ${name}’s request done?`,
    consequence: () => "Only your team sees the note. Nothing is emailed.",
    noteLabel: "Note for the timeline (optional)",
    confirm: "Mark done",
    saving: "Marking done…",
  },
};

function ConfirmStep({ enquiry, to, roomName, diarySays, saving, failure, onConfirm, onCancel }: {
  readonly enquiry: Enquiry;
  readonly to: ConfirmTarget;
  readonly roomName: string | null;
  /** What the Diary says before the client is emailed: null while it is read,
   *  undefined when this confirmation says nothing of the Diary. */
  readonly diarySays: string | null | undefined;
  readonly saving: boolean;
  readonly failure: string | null;
  readonly onConfirm: (note: string) => void;
  readonly onCancel: () => void;
}): ReactElement {
  const questionId = useId();
  const consequenceId = useId();
  const diaryId = useId();
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
      <p className="enq-confirm__consequence" id={consequenceId}>{words.consequence(enquiry, roomName)}</p>
      {diarySays !== undefined && (
        // A slot held for the sentence, which changes at most once: from what
        // was kept, or "Reading", to what the Diary says now.
        <p className="enq-confirm__diary" id={diaryId}>
          {diarySays ?? <span className="enq-facts__reading"><ActivityIndicator size={16} />Reading the Diary…</span>}
        </p>
      )}
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
        <button type="button" className="enq-cta" onClick={() => { onConfirm(note); }} disabled={saving} aria-busy={saving}
          aria-describedby={diarySays === undefined ? consequenceId : `${consequenceId} ${diaryId}`}>
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

function EnquiryTools({ enquiry, canCreateOpportunity, creatingOpportunity, opportunityFailure, onCreateOpportunity }: {
  readonly enquiry: Enquiry;
  readonly canCreateOpportunity: boolean;
  readonly creatingOpportunity: boolean;
  readonly opportunityFailure: string | null;
  readonly onCreateOpportunity: () => void;
}): ReactElement | null {
  // An approved enquiry offers the opportunity as its next step instead, and
  // only the commercial team is offered it at all. Holding a date lives with
  // the Diary's answer, In the Diary.
  const offersOpportunity = canCreateOpportunity && enquiry.state !== "approved";
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
      {offersOpportunity && opportunityFailure !== null && <p className="enq-confirm__error" role="alert">{opportunityFailure}</p>}
    </section>
  );
}

function EnquiryDrafts({ enquiry }: { readonly enquiry: Enquiry }): ReactElement | null {
  // AI drafting is offered only where a provider is configured: the panel
  // renders nothing without one, so the section would open onto an empty body.
  // The panel still mounts only once someone opens the section. A proposal's
  // message is drafted in the proposal itself, where it can be used.
  const available = useAIDraftsAvailable();
  const [open, setOpen] = useState(false);
  if (available !== true) return null;
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

function timelineWords(entry: StatusHistoryEntry, request: boolean): string {
  if (entry.fromStatus === "archived" && entry.toStatus === "submitted") return "Reopened";
  if (request && entry.toStatus === "archived") return "Marked done";
  return TIMELINE_WORDS[entry.toStatus] ?? stageLabel(entry.toStatus);
}

function EnquiryTimeline({ enquiry, history, status, request }: {
  readonly enquiry: Enquiry;
  readonly history: readonly StatusHistoryEntry[];
  readonly status: "loading" | "ready" | "error";
  readonly request: boolean;
}): ReactElement {
  return (
    <>
      <ol className="enq-timeline">
        <li>
          <span className="enq-dot" data-tone="new" aria-hidden="true" />
          <strong>{request ? "Request received" : "Enquiry received"}</strong>
          <time dateTime={enquiry.createdAt}>{venueMoment(enquiry.createdAt) ?? enquiry.createdAt}</time>
        </li>
        {history.map((entry) => (
          <li key={entry.id}>
            <span className="enq-dot" data-tone={stageTone(entry.toStatus)} aria-hidden="true" />
            <strong>{timelineWords(entry, request)}</strong>
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
