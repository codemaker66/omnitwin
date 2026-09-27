import { useEffect, useId, useRef, useState, type KeyboardEvent, type ReactElement, type RefObject } from "react";
import type { ConfigurationReviewStatus, ConfigurationSheetSnapshot } from "@omnitwin/types";
import { ArrowLeft, ArrowUpRight, ChevronDown, ChevronUp, X } from "lucide-react";
import type { ActiveReviewer, PendingReviewEntry, ReviewHistoryEntry } from "../../../api/configuration-reviews.js";
import { useReviewViewers } from "../../../hooks/use-review-viewers.js";
import { prepareFrozenPlan, type ProjectedFrozenPlan } from "../../../lib/hallkeeper-frozen-plan.js";
import { ActivityIndicator, ActivityStatus } from "../../shared/Activity.js";
import { eventDateParts, eventLead, eventWeekday, relativeAge, venueMoment } from "../enquiries/enquiry-desk-format.js";
import {
  claimLine, eventCalendarDate, reviewStage, STATUS_IN_WORDS, timelineSentence, waitingSince,
} from "./review-desk-format.js";
import { ReviewStageChip } from "./ReviewStages.js";

// ---------------------------------------------------------------------------
// The decision panel: one layout, the facts a reviewer decides on in large
// type, who has it and since when, the plan as it was submitted, and the one
// next step for its stage in the same place every time. Every decision that
// emails someone, or ends the review, asks once, inline, and says what will
// happen before it does; starting a review sends nothing and needs no
// confirmation.
// ---------------------------------------------------------------------------

/** A decision the panel asks the reader to confirm. */
export type ReviewDecision = "approved" | "changes_requested" | "rejected" | "withdrawn";
/** Every move the panel makes. */
export type ReviewMove = ReviewDecision | "under_review";

export interface ReviewGates {
  readonly currentStatus: ConfigurationReviewStatus;
  readonly availableTransitions: readonly ConfigurationReviewStatus[];
  /** A rehearsal plan the server lets be approved without emailing anyone. */
  readonly demoEligible: boolean;
  readonly history: readonly ReviewHistoryEntry[];
}

export interface ReviewContextState {
  readonly status: "loading" | "ready" | "error";
  /** The last gates read for this review; kept while they are read again. */
  readonly value: ReviewGates | null;
  readonly message: string | null;
}

export type SnapshotState =
  | { readonly status: "loading" }
  | { readonly status: "ready"; readonly snapshot: ConfigurationSheetSnapshot }
  | { readonly status: "none" }
  | { readonly status: "error" };

export interface PanelDecision {
  readonly confirming: ReviewDecision | null;
  /** The move being saved for this review, or null. */
  readonly saving: ReviewMove | null;
  readonly failure: string | null;
  /** Said when a decision met a review that had moved on. */
  readonly movedNotice: string | null;
}

export interface PanelNavigation {
  readonly layout: "wide" | "single";
  readonly canPrevious: boolean;
  readonly canNext: boolean;
  readonly onClose: () => void;
  readonly onStep: (direction: 1 | -1) => void;
}

interface ReviewPanelProps {
  readonly entry: PendingReviewEntry;
  readonly nowMs: number;
  /** The reader's own name, so a review they hold reads "with you". */
  readonly readerName: string | null;
  readonly context: ReviewContextState;
  readonly snapshot: SnapshotState;
  readonly decision: PanelDecision;
  readonly announcement: string | null;
  readonly stampKey: number | null;
  readonly navigation: PanelNavigation;
  readonly headingRef: RefObject<HTMLHeadingElement>;
  readonly onStart: () => void;
  readonly onRequest: (decision: ReviewDecision) => void;
  readonly onConfirm: (input: { readonly note: string; readonly notifyTeam: boolean }) => void;
  readonly onCancel: () => void;
  readonly onRetryContext: () => void;
  readonly onRetrySnapshot: () => void;
}

function isEditable(target: EventTarget): boolean {
  return target instanceof HTMLTextAreaElement || target instanceof HTMLInputElement
    || target instanceof HTMLSelectElement || (target instanceof HTMLElement && target.isContentEditable);
}

export function ReviewPanel(props: ReviewPanelProps): ReactElement {
  const { entry, nowMs, context, navigation, headingRef } = props;
  const headingId = useId();
  const stage = reviewStage(entry.reviewStatus);
  const submitted = entry.submittedAt === null ? null : relativeAge(entry.submittedAt, nowMs);
  // Presence: who else has this review open, so two colleagues do not decide it twice.
  const { viewers } = useReviewViewers(entry.id);
  const history = context.value?.history ?? null;
  const claim = claimLine(entry, history, nowMs, props.readerName);

  const step = (event: KeyboardEvent<HTMLElement>): void => {
    if (event.altKey || event.ctrlKey || event.metaKey || isEditable(event.target)) return;
    if (event.key !== "j" && event.key !== "k") return;
    event.preventDefault();
    navigation.onStep(event.key === "j" ? 1 : -1);
  };

  return (
    <section className="enq-panel rev-panel" data-register="forest" aria-labelledby={headingId} onKeyDown={step}>
      <div className="enq-panel__body">
        <PanelBar navigation={navigation} closeLabel={navigation.layout === "wide" ? "Close review" : "Back to reviews"} />

        <p className="enq-eyebrow">Layout review{submitted === null ? "" : ` · submitted ${submitted}`}</p>
        <h2 className="enq-panel__name" id={headingId} ref={headingRef} tabIndex={-1}>{entry.name}</h2>
        <div className="enq-panel__status">
          {stage !== null && <ReviewStageChip key={props.stampKey ?? "still"} stage={stage} stamped={props.stampKey !== null} />}
          {claim !== null && <span className="rev-claim" data-testid="review-claim">{claim}</span>}
        </div>
        <Presence viewers={viewers} />
        <p className="vv-sr-only" role="status">{props.announcement}</p>

        <ReviewFacts entry={entry} nowMs={nowMs} />

        <section className="enq-section">
          <h3>Next step</h3>
          <ReviewPath status={entry.reviewStatus} />
          <NextStep {...props} />
        </section>

        <SubmittedPlan entry={entry} snapshot={props.snapshot} onRetry={props.onRetrySnapshot} />

        <section className="enq-section">
          <h3>Timeline</h3>
          <ReviewTimeline history={history} status={context.status} />
        </section>
      </div>
    </section>
  );
}

export function PanelBar({ navigation, closeLabel }: { readonly navigation: PanelNavigation; readonly closeLabel: string }): ReactElement {
  return (
    <div className="enq-panel__bar">
      {navigation.layout === "single" ? (
        <button type="button" className="enq-back" onClick={navigation.onClose}>
          <ArrowLeft size={16} aria-hidden="true" /> Back to reviews
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
        <button type="button" className="enq-close" onClick={navigation.onClose} aria-label={closeLabel} aria-keyshortcuts="Escape">
          <X size={18} aria-hidden="true" />
        </button>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Presence and facts
// ---------------------------------------------------------------------------

function presenceWords(viewers: readonly ActiveReviewer[]): string | null {
  const names = viewers.map((viewer) => viewer.displayName);
  const [first, second] = names;
  if (first === undefined) return null;
  if (second === undefined) return `${first} is looking at this too.`;
  if (names.length === 2) return `${first} and ${second} are looking at this too.`;
  return `${first} and ${String(names.length - 1)} others are looking at this too.`;
}

/** Another colleague with this review open. Said in the panel's own ink,
 *  never a tinted badge, so it reads at full contrast. */
function Presence({ viewers }: { readonly viewers: readonly ActiveReviewer[] }): ReactElement {
  const words = presenceWords(viewers);
  return (
    <p className="rev-presence" role="status" data-testid="review-presence" hidden={words === null}>
      {words !== null && <span className="rev-presence__dot" aria-hidden="true" />}
      {words}
    </p>
  );
}

function ReviewFacts({ entry, nowMs }: { readonly entry: PendingReviewEntry; readonly nowMs: number }): ReactElement {
  const calendarDate = eventCalendarDate(entry);
  const date = eventDateParts(calendarDate);
  const weekday = eventWeekday(calendarDate);
  const lead = eventLead(calendarDate, nowMs);
  return (
    <dl className="enq-facts">
      <div>
        <dt>{date === null ? "Event date" : [weekday, lead].filter((part) => part !== null).join(", ")}</dt>
        {date === null
          ? <dd className="enq-facts__muted">Not in the Diary</dd>
          : <dd>{`${date.day} ${date.month} ${date.year}`}</dd>}
      </div>
      <div>
        <dt>{entry.guestCount === 1 ? "guest" : "guests"}</dt>
        <dd>{entry.guestCount.toLocaleString("en-GB")}</dd>
      </div>
      <div>
        <dt>room</dt>
        {entry.spaceName === null
          ? <dd className="enq-facts__muted">Not known</dd>
          : <dd className="enq-facts__room">{entry.spaceName}</dd>}
      </div>
    </dl>
  );
}

// ---------------------------------------------------------------------------
// Where the review is, and its next step
// ---------------------------------------------------------------------------

const PATH: Readonly<Partial<Record<ConfigurationReviewStatus, readonly (readonly [label: string, state: "done" | "current" | "todo"])[]>>> = {
  submitted: [["To start", "current"], ["In review", "todo"], ["Decision", "todo"]],
  under_review: [["To start", "done"], ["In review", "current"], ["Decision", "todo"]],
  changes_requested: [["To start", "done"], ["In review", "done"], ["With planner", "current"]],
};

function ReviewPath({ status }: { readonly status: ConfigurationReviewStatus }): ReactElement | null {
  const path = PATH[status];
  if (path === undefined) return null;
  return (
    <ol className="enq-path" aria-label="Progress">
      {path.map(([label, state]) => (
        <li key={label} data-state={state} aria-current={state === "current" ? "step" : undefined}>
          <span className="enq-path__mark" aria-hidden="true" />
          {label}
        </li>
      ))}
    </ol>
  );
}

// Who a decision emails (routes/configuration-reviews.ts): approval emails the
// layout's planner and every hallkeeper account at the venue; a rejection or
// change request emails the planner. A layout with no planner account has
// nobody to email on that side.
export function approvalConsequence(hasPlanner: boolean, emails: boolean): string {
  if (!emails) return "Approving records the decision. Nobody is emailed.";
  return hasPlanner
    ? "Approving emails the planner and your venue's hallkeepers."
    : "Approving emails your venue's hallkeepers. This layout has no planner account to email.";
}

function noteConsequence(hasPlanner: boolean): string {
  return hasPlanner
    ? "Your note is emailed to the planner and kept in this review's timeline."
    : "This layout has no planner account, so nobody is emailed. Your note is kept in this review's timeline.";
}

function NextStep(props: ReviewPanelProps): ReactElement {
  const { entry, context, decision } = props;
  const gates = context.value;
  // The gates read for the status the review is in now; after a move they are
  // read again, and until then the panel says so in the actions' place.
  const fresh = gates !== null && gates.currentStatus === entry.reviewStatus;
  const notices = (
    <>
      {decision.movedNotice !== null && (
        <p className="enq-confirm__error rev-moved" role="alert" data-testid="review-moved-on">{decision.movedNotice}</p>
      )}
      {decision.failure !== null && (
        <p className="enq-confirm__error" role="alert" data-testid="review-action-error">{decision.failure}</p>
      )}
    </>
  );

  if (context.status === "error") {
    return (
      <div className="rev-next">
        <div className="enq-confirm" role="alert" data-testid="review-context-error" data-tone="declined">
          <p className="enq-confirm__consequence">
            What can happen next could not be read{context.message === null ? "." : `: ${context.message}`}
          </p>
          <div className="enq-actions">
            <button type="button" className="enq-quiet" onClick={props.onRetryContext}>Try again</button>
          </div>
        </div>
        {notices}
      </div>
    );
  }

  if (!fresh) {
    return (
      <div className="rev-next">
        <ActivityStatus className="enq-panel__activity">Reading what can happen next…</ActivityStatus>
        {notices}
      </div>
    );
  }

  if (decision.confirming !== null) {
    return (
      <div className="rev-next">
        <ConfirmDecision entry={entry} decision={decision.confirming} demoEligible={gates.demoEligible}
          saving={decision.saving !== null} onConfirm={props.onConfirm} onCancel={props.onCancel} />
        {notices}
      </div>
    );
  }

  const can = (status: ConfigurationReviewStatus): boolean => gates.availableTransitions.includes(status);
  // Actions stay where they are while the gates are read again, and wait.
  const busy = decision.saving !== null || context.status === "loading";
  const withdraw = can("withdrawn") && (
    <button type="button" className="enq-quiet" data-decision="withdrawn" onClick={() => { props.onRequest("withdrawn"); }} disabled={busy}>
      Withdraw…
    </button>
  );
  const hasPlanner = entry.userId !== null;

  switch (entry.reviewStatus) {
    case "submitted":
      return (
        <div className="rev-next" aria-busy={context.status === "loading"}>
          {(can("under_review") || withdraw !== false) && (
            <div className="enq-actions">
              {can("under_review") && (
                <button type="button" className="enq-cta" data-primary="true" onClick={props.onStart}
                  disabled={busy} aria-busy={decision.saving === "under_review"}>
                  {decision.saving === "under_review" && <ActivityIndicator size={18} />}
                  {decision.saving === "under_review" ? "Starting review…" : "Start review"}
                </button>
              )}
              {withdraw}
            </div>
          )}
          <p className="enq-next__hint">
            {can("under_review")
              ? "Starting puts it in review with you, so colleagues see it is taken. Nothing is emailed."
              : noDecisionWords(entry.reviewStatus)}
          </p>
          {notices}
        </div>
      );
    case "under_review":
      return (
        <div className="rev-next" aria-busy={context.status === "loading"}>
          {(can("approved") || can("changes_requested") || can("rejected") || withdraw !== false) && (
            <div className="enq-actions">
              {can("approved") && (
                <button type="button" className="enq-cta" data-primary="true" data-decision="approved"
                  onClick={() => { props.onRequest("approved"); }} disabled={busy}>
                  Approve…
                </button>
              )}
              {can("changes_requested") && (
                <button type="button" className="enq-quiet" data-decision="changes_requested"
                  onClick={() => { props.onRequest("changes_requested"); }} disabled={busy}>
                  Ask for changes…
                </button>
              )}
              {can("rejected") && (
                <button type="button" className="enq-quiet" data-decision="rejected"
                  onClick={() => { props.onRequest("rejected"); }} disabled={busy}>
                  Reject…
                </button>
              )}
              {withdraw}
            </div>
          )}
          <p className="enq-next__hint">
            {can("approved")
              ? `${hasPlanner ? "Each decision emails the planner" : "Approving emails your hallkeepers"}. You will see who hears before anything is sent.`
              : noDecisionWords(entry.reviewStatus)}
          </p>
          {notices}
        </div>
      );
    case "changes_requested":
      return (
        <div className="rev-next" aria-busy={context.status === "loading"}>
          {withdraw !== false && <div className="enq-actions">{withdraw}</div>}
          <p className="enq-next__hint">
            {`Back with ${entry.plannerName ?? "the planner"} for changes. It returns to To start when it is submitted again.`}
          </p>
          {notices}
        </div>
      );
    default:
      return <div className="rev-next"><p className="enq-next__hint">{noDecisionWords(entry.reviewStatus)}</p>{notices}</div>;
  }
}

function noDecisionWords(status: ConfigurationReviewStatus): string {
  return `Your role has no decision to make while this review is ${STATUS_IN_WORDS[status]}.`;
}

interface ConfirmWords {
  readonly question: (name: string) => string;
  readonly consequence: (hasPlanner: boolean, emails: boolean) => string;
  /** The note's label, or null when the decision takes none. */
  readonly noteLabel: string | null;
  readonly confirm: (hasPlanner: boolean, emails: boolean) => string;
  readonly saving: string;
  readonly cancel: string;
}

const CONFIRM_WORDS: Readonly<Record<ReviewDecision, ConfirmWords>> = {
  approved: {
    question: (name) => `Approve ${name}?`,
    consequence: approvalConsequence,
    noteLabel: null,
    confirm: (_, emails) => (emails ? "Approve and email" : "Approve"),
    saving: "Approving…",
    cancel: "Cancel",
  },
  changes_requested: {
    question: (name) => `Ask for changes on ${name}?`,
    consequence: (hasPlanner) => noteConsequence(hasPlanner),
    noteLabel: "What needs to change",
    confirm: (hasPlanner) => (hasPlanner ? "Send to the planner" : "Record the request"),
    saving: "Sending…",
    cancel: "Cancel",
  },
  rejected: {
    question: (name) => `Reject ${name}?`,
    consequence: (hasPlanner) => noteConsequence(hasPlanner),
    noteLabel: "Why it cannot be approved",
    confirm: (hasPlanner) => (hasPlanner ? "Reject and email" : "Reject"),
    saving: "Rejecting…",
    cancel: "Cancel",
  },
  withdrawn: {
    question: (name) => `Withdraw ${name} from review?`,
    consequence: () => "The review ends here and cannot be reopened. Nobody is emailed.",
    noteLabel: null,
    confirm: () => "Withdraw",
    saving: "Withdrawing…",
    cancel: "Keep it in review",
  },
};

const DECISION_TONE: Readonly<Record<ReviewDecision, "approved" | "declined" | "review">> = {
  approved: "approved",
  changes_requested: "review",
  rejected: "declined",
  withdrawn: "declined",
};

function ConfirmDecision({ entry, decision, demoEligible, saving, onConfirm, onCancel }: {
  readonly entry: PendingReviewEntry;
  readonly decision: ReviewDecision;
  readonly demoEligible: boolean;
  readonly saving: boolean;
  readonly onConfirm: (input: { readonly note: string; readonly notifyTeam: boolean }) => void;
  readonly onCancel: () => void;
}): ReactElement {
  const questionId = useId();
  const rehearsalHintId = useId();
  const [note, setNote] = useState("");
  const [notifyTeam, setNotifyTeam] = useState(true);
  const noteRef = useRef<HTMLTextAreaElement>(null);
  const questionRef = useRef<HTMLParagraphElement>(null);
  const words = CONFIRM_WORDS[decision];
  const hasPlanner = entry.userId !== null;
  const emails = decision !== "approved" || !demoEligible || notifyTeam;
  const needsNote = words.noteLabel !== null;
  const ready = !saving && (!needsNote || note.trim() !== "");

  // A precise pointer goes straight to the note; on touch the keyboard would
  // cover the confirmation, so focus lands on the question instead.
  useEffect(() => {
    const finePointer = typeof window.matchMedia === "function" && window.matchMedia("(pointer: fine)").matches;
    (finePointer && noteRef.current !== null ? noteRef.current : questionRef.current)?.focus();
  }, []);

  const confirm = (): void => {
    if (ready) onConfirm({ note: note.trim(), notifyTeam });
  };

  return (
    <div className="enq-confirm" role="group" aria-labelledby={questionId} data-tone={DECISION_TONE[decision]}
      data-testid={`review-confirm-${decision}`}>
      <p className="enq-confirm__question" id={questionId} ref={questionRef} tabIndex={-1}>{words.question(entry.name)}</p>
      <p className="enq-confirm__consequence" data-testid={decision === "approved" ? "approve-consequence" : undefined}>
        {words.consequence(hasPlanner, emails)}
      </p>
      {decision === "approved" && demoEligible && (
        <div className="rev-rehearsal">
          <label>
            <input type="checkbox" checked={notifyTeam} disabled={saving} aria-describedby={rehearsalHintId}
              onChange={(event) => { setNotifyTeam(event.target.checked); }} />
            <span>{hasPlanner ? "Email the planner and hallkeepers" : "Email your venue's hallkeepers"}</span>
          </label>
          <p id={rehearsalHintId}>This is a rehearsal plan, so it can be approved without emailing anyone.</p>
        </div>
      )}
      {needsNote && (
        <label>
          <span>{words.noteLabel}</span>
          <textarea ref={noteRef} value={note} maxLength={2000} rows={3} disabled={saving} required aria-required="true"
            onChange={(event) => { setNote(event.target.value); }}
            onKeyDown={(event) => {
              if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
                event.preventDefault();
                confirm();
              }
            }} />
        </label>
      )}
      <div className="enq-actions">
        <button type="button" className="enq-cta" onClick={confirm} disabled={!ready} aria-busy={saving}>
          {saving && <ActivityIndicator size={18} />}
          {saving ? words.saving : words.confirm(hasPlanner, emails)}
        </button>
        <button type="button" className="enq-quiet" onClick={onCancel} disabled={saving}>{words.cancel}</button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// The plan as it was submitted
// ---------------------------------------------------------------------------

function SubmittedPlan({ entry, snapshot, onRetry }: {
  readonly entry: PendingReviewEntry;
  readonly snapshot: SnapshotState;
  readonly onRetry: () => void;
}): ReactElement {
  return (
    <section className="enq-section">
      <h3>The plan submitted</h3>
      {snapshot.status === "loading" && <ActivityStatus className="enq-panel__activity">Reading the submitted plan…</ActivityStatus>}
      {snapshot.status === "none" && <p className="enq-next__hint">No submitted plan is on record for this layout.</p>}
      {snapshot.status === "error" && (
        <div className="rev-plan__retry">
          <p className="enq-next__hint">The submitted plan could not be read.</p>
          <button type="button" className="enq-quiet" onClick={onRetry}>Try again</button>
        </div>
      )}
      {snapshot.status === "ready" && <PlanFacts entry={entry} snapshot={snapshot.snapshot} />}
      <div className="enq-actions rev-tools">
        <a className="enq-quiet" href={`/plan/${entry.id}`} target="_blank" rel="noreferrer">
          Open the layout <ArrowUpRight size={16} aria-hidden="true" />
          <span className="vv-sr-only"> (opens in a new tab)</span>
        </a>
        <a className="enq-quiet" href={`/hallkeeper/${entry.id}`} target="_blank" rel="noreferrer">
          Preview the setup sheet <ArrowUpRight size={16} aria-hidden="true" />
          <span className="vv-sr-only"> (opens in a new tab)</span>
        </a>
      </div>
    </section>
  );
}

const PLAN_ITEMS_SHOWN = 5;

function PlanFacts({ entry, snapshot }: { readonly entry: PendingReviewEntry; readonly snapshot: ConfigurationSheetSnapshot }): ReactElement {
  const frozen = prepareFrozenPlan(snapshot.payload.floorPlan);
  const items = [...snapshot.payload.totals.entries].sort((a, b) => b.qty - a.qty);
  const shown = items.slice(0, PLAN_ITEMS_SHOWN);
  const more = items.length - shown.length;
  const frozenAt = venueMoment(snapshot.createdAt);
  return (
    <div className="rev-plan">
      {frozen.kind === "saved" && <PlanThumbnail plan={frozen.plan} name={entry.name} room={snapshot.payload.space.name} />}
      <div className="rev-plan__facts">
        <p className="rev-plan__version">
          Version {snapshot.version.toLocaleString("en-GB")}{frozenAt === null ? "" : `, frozen ${frozenAt}`}
        </p>
        {shown.length === 0 ? (
          <p className="enq-next__hint">The plan has no furniture on it.</p>
        ) : (
          <dl className="rev-plan__items">
            {shown.map((item) => (
              <div key={`${item.category}:${item.name}`}>
                <dt>{item.name}</dt>
                <dd>{item.qty.toLocaleString("en-GB")}</dd>
              </div>
            ))}
          </dl>
        )}
        {more > 0 && <p className="enq-next__hint">and {more.toLocaleString("en-GB")} more {more === 1 ? "kind" : "kinds"} of item</p>}
      </div>
    </div>
  );
}

const FOOTPRINT_TONE: Readonly<Record<string, string>> = {
  table: "#264337",
  chair: "#8a8d7c",
  stage: "#9a4a25",
};

/** The frozen plan drawn small: the room's outline and every footprint. */
function PlanThumbnail({ plan, name, room }: { readonly plan: ProjectedFrozenPlan; readonly name: string; readonly room: string }): ReactElement {
  const points = (list: readonly { readonly x: number; readonly y: number }[]): string =>
    list.map((point) => `${String(point.x)},${String(point.y)}`).join(" ");
  return (
    <svg className="rev-plan__thumb" viewBox="0 0 1000 600" preserveAspectRatio="xMidYMid meet" role="img"
      aria-label={`Plan of ${name} as submitted: ${String(plan.objects.length)} ${plan.objects.length === 1 ? "piece" : "pieces"} in the ${room}`}>
      <polygon points={points(plan.outline)} fill="#fffdf7" stroke="#6f6a5e" strokeWidth={2} vectorEffect="non-scaling-stroke" />
      {plan.objects.map(({ object, center, corners, width, depth }) => {
        const tone = FOOTPRINT_TONE[object.category] ?? "#6f6a5e";
        return object.collisionType === "cylinder" ? (
          <ellipse key={object.objectId} cx={center.x} cy={center.y} rx={width / 2} ry={depth / 2} fill={tone} fillOpacity={0.28}
            stroke={tone} strokeWidth={1} vectorEffect="non-scaling-stroke"
            transform={`rotate(${String(-object.rotationY * 180 / Math.PI)} ${String(center.x)} ${String(center.y)})`} />
        ) : (
          <polygon key={object.objectId} points={points(corners)} fill={tone} fillOpacity={0.28} stroke={tone} strokeWidth={1}
            vectorEffect="non-scaling-stroke" />
        );
      })}
    </svg>
  );
}

// ---------------------------------------------------------------------------
// Timeline
// ---------------------------------------------------------------------------

const TIMELINE_TONE: Readonly<Partial<Record<ConfigurationReviewStatus, string>>> = {
  submitted: "new",
  under_review: "review",
  approved: "approved",
  rejected: "declined",
  changes_requested: "review",
};

function ReviewTimeline({ history, status }: {
  readonly history: readonly ReviewHistoryEntry[] | null;
  readonly status: ReviewContextState["status"];
}): ReactElement {
  return (
    <>
      {history !== null && history.length > 0 && (
        <ol className="enq-timeline">
          {history.map((entry) => (
            <li key={entry.id}>
              <span className="enq-dot" data-tone={TIMELINE_TONE[entry.toStatus] ?? "other"} aria-hidden="true" />
              <strong>{timelineSentence(entry)}</strong>
              <time dateTime={entry.createdAt}>{venueMoment(entry.createdAt) ?? entry.createdAt}</time>
              {entry.note !== null && entry.note.trim() !== "" && <q>{entry.note.trim()}</q>}
            </li>
          ))}
        </ol>
      )}
      {history !== null && history.length === 0 && <p className="enq-next__hint">Nothing is recorded yet.</p>}
      {history === null && status === "loading" && <ActivityStatus className="enq-panel__activity">Reading the timeline…</ActivityStatus>}
      {history === null && status === "error" && <p className="enq-next__hint">The timeline could not be read.</p>}
    </>
  );
}

/** Since when this review has waited, for the overview. */
export function waitedWords(entry: PendingReviewEntry, nowMs: number): string | null {
  return relativeAge(waitingSince(entry), nowMs);
}
