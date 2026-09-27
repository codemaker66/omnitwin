import { Fragment, useEffect, useId, useMemo, useRef, useState } from "react";
import type { ChangeEvent, KeyboardEvent as ReactKeyboardEvent, ReactElement } from "react";
import type { BookingKind, BookingState, CalendarBookingEntry, CalendarRoom } from "@omnitwin/types";
import { ApiError } from "../../../api/client.js";
import {
  convertEnquiry,
  createBooking,
  transitionBooking,
  updateBooking,
} from "../../../api/diary.js";
import { createEvent } from "../../../api/events.js";
import { BOARD_COPY } from "../board-copy.js";
import { ActivityStatus } from "../../../components/shared/Activity.js";
import { DIARY_WRITE_ROLES, hasRole } from "../../../lib/role-capabilities.js";
import { formatInlineDay, formatWallDay, formatWallTime, msToWallInput, wallInputToMs } from "../lib/board-time.js";
import { bookingStateLabel, bookingTimeLabel } from "../lib/board-overview.js";
import { extendedDecisionMs } from "../lib/extend-decision.js";
import { isEndingTransition, ladderAfterExit, type EndingTransition } from "../lib/lifecycle-ending.js";
import type { LadderPlace } from "../lib/ladder-place.js";

/**
 * The planner link for an attached plan: the event the planner binds from,
 * and the booking's own room, because the planner's bootstrap opens its
 * default room when no `space` is given. A room the board does not know
 * (a space row the calendar lacks) is simply left to the planner's default.
 */
function planHref(eventId: string, spaceId: string, rooms: readonly CalendarRoom[]): string {
  const base = `/plan?eventId=${encodeURIComponent(eventId)}`;
  const slug = rooms.find((room) => room.id === spaceId)?.slug;
  return slug === undefined ? base : `${base}&space=${encodeURIComponent(slug)}`;
}
import {
  allowedTransitionTargets,
  formToConvertPayload,
  formToCreatePayload,
  formToUpdatePayload,
  hiddenFieldError,
  initialDrawerForm,
  initialPromotionForm,
  promotionPayload,
  type DrawerForm,
  type DrawerMode,
  type FieldErrors,
  type PromotionForm,
} from "../lib/drawer-form.js";

// ---------------------------------------------------------------------------
// BookingDrawer (T-495/T-496) — create, edit, and convert in one non-modal
// side panel. Validation is the shared Zod schemas via drawer-form; hygiene
// is therefore enforced in the UI by exactly the rules the API applies.
// The owner is the signed-in coordinator — the §17 law wants a real name
// attached, not a free-text uuid field.
// ---------------------------------------------------------------------------

export interface BookingDrawerProps {
  readonly mode: DrawerMode;
  readonly rooms: readonly CalendarRoom[];
  readonly venueId: string;
  readonly role: string;
  readonly onClose: () => void;
  readonly onSaved: (message: string) => void;
  /** The other active holds crossing an edited booking's room and time, as
   *  the board has them, so ending it can say who stands first after. */
  readonly contested?: readonly CalendarBookingEntry[];
  /** False when the board has not read the booking's dates (a booking
   *  opened from the decisions list in another week). */
  readonly ladderRead?: boolean;
  /** Where a new hold in this room and time would stand on its ladder, as
   *  the board has read it (roadmap N3). A new hold's option follows it
   *  until the booker sets one. */
  readonly ladderPlace?: (spaceId: string, startMs: number, endMs: number) => LadderPlace;
  /** The page's clock, for the facts' days and a decision date's standing. */
  readonly nowMs?: number;
}

/** When a booking stands, for its facts: "Sat 19 Sept · 14:00–23:30", or
 *  both ends' days when it runs past midnight. */
function bookingWhen(booking: CalendarBookingEntry, nowMs: number): string {
  const startMs = Date.parse(booking.startsAt);
  const sameDay = msToWallInput(startMs).slice(0, 10) === msToWallInput(Date.parse(booking.endsAt)).slice(0, 10);
  return sameDay ? `${formatInlineDay(startMs, nowMs)} · ${bookingTimeLabel(booking)}` : bookingTimeLabel(booking);
}

/** The ladder where the form places a new hold; null while its times do
 *  not yet make a span. */
function formPlace(
  form: DrawerForm,
  ladderPlace: (spaceId: string, startMs: number, endMs: number) => LadderPlace,
): LadderPlace | null {
  const startMs = wallInputToMs(form.startsAt);
  const endMs = wallInputToMs(form.endsAt);
  if (startMs === null || endMs === null || endMs <= startMs) return null;
  return ladderPlace(form.spaceId, startMs, endMs);
}

function followLadder(
  form: DrawerForm,
  ladderPlace: (spaceId: string, startMs: number, endMs: number) => LadderPlace,
): DrawerForm {
  const place = formPlace(form, ladderPlace);
  return place === null || place.kind === "unread" ? form : { ...form, rank: String(place.rank) };
}

/** What already holds the room and time, in one line. */
function ladderNote(place: LadderPlace, room: string): string {
  if (place.kind === "unread") return BOARD_COPY.drawer.ladder.unread;
  const sentences: string[] = [];
  if (place.confirmed.length > 0) sentences.push(BOARD_COPY.drawer.ladder.confirmed(place.confirmed.map((booking) => booking.title)));
  if (place.holds.length > 0) {
    sentences.push(BOARD_COPY.drawer.ladder.held(place.holds.map((hold) => ({
      title: hold.title, place: BOARD_COPY.decisions.option(hold.rank, hold.jointFlag),
    }))));
  }
  return sentences.length === 0 ? BOARD_COPY.drawer.ladder.open(room) : sentences.join(" ");
}

const NO_CONTESTED: readonly CalendarBookingEntry[] = [];

/** What ending this booking does, in one plain paragraph: where and when,
 *  what ends, who stands first after, and that the client hears nothing. */
function endingConsequence(
  booking: CalendarBookingEntry,
  rooms: readonly CalendarRoom[],
  contested: readonly CalendarBookingEntry[],
  ladderRead: boolean,
): string {
  const room = rooms.find((candidate) => candidate.id === booking.spaceId)?.name ?? BOARD_COPY.drawer.fields.room;
  const startMs = Date.parse(booking.startsAt);
  const when = `${formatWallDay(startMs)} ${formatWallTime(startMs)}–${formatWallTime(Date.parse(booking.endsAt))}`;
  const sentences = [BOARD_COPY.ending.ends(room, when, BOARD_COPY.ending.what[booking.kind])];
  // Holds are named only from a date the board has read whole: a partial
  // read could miss the 1st option and call the 2nd "1st".
  const ladder = ladderRead ? ladderAfterExit(booking, contested) : null;
  if (ladder?.kind === "promoted") sentences.push(BOARD_COPY.ending.promoted(ladder.titles));
  else if (ladder?.kind === "free") sentences.push(BOARD_COPY.ending.free(ladder.titles));
  else if (ladder === null && booking.kind === "hold" && booking.rank === 1) sentences.push(BOARD_COPY.ending.ladderUnread);
  if (booking.kind !== "internal_block") sentences.push(BOARD_COPY.ending.nothingSent);
  return sentences.join(" ");
}

const KIND_OPTIONS: readonly BookingKind[] = ["hold", "ink", "internal_block", "prospect"];

/** A detail is only worth a line when it carries a value: the calendar marks
 *  these optional AND nullable, and a blank string says no more than either. */
function detailOrNull(value: string | null | undefined): string | null {
  if (value === undefined || value === null) return null;
  const trimmed = value.trim();
  return trimmed.length === 0 ? null : trimmed;
}

function drawerTitle(mode: DrawerMode): string {
  if (mode.kind === "edit") return BOARD_COPY.drawer.editTitle;
  if (mode.kind === "convert") return BOARD_COPY.drawer.convertTitle;
  return BOARD_COPY.drawer.createTitle;
}

export function BookingDrawer(props: BookingDrawerProps): ReactElement {
  const { mode, rooms, venueId, role, onClose, onSaved, contested = NO_CONTESTED, ladderRead = true, ladderPlace } = props;
  const nowMs = props.nowMs ?? Date.now();
  // A live hold's decision date, when it has one: a fact of the summary.
  const decisionMs = mode.kind === "edit" && mode.booking.kind === "hold" && mode.booking.status === "active"
    && mode.booking.decisionAt !== null ? Date.parse(mode.booking.decisionAt) : null;
  // A new hold takes the next place on its ladder, and keeps following the
  // room and time it is placed in until the booker sets an option.
  const followsLadder = mode.kind !== "edit" ? ladderPlace : undefined;
  const [form, setForm] = useState<DrawerForm>(() =>
    (followsLadder === undefined ? initialDrawerForm(mode) : followLadder(initialDrawerForm(mode), followsLadder)));
  const [optionChosen, setOptionChosen] = useState(false);
  const ladderNoteId = useId();
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [stepError, setStepError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const titleRef = useRef<HTMLInputElement | null>(null);
  const closeRef = useRef<HTMLButtonElement | null>(null);
  /** An event created by startPlan whose link has not landed yet — so a
   *  retry finishes the job instead of orphaning another plan. */
  const startedEventRef = useRef<string | null>(null);
  // Ending a booking's claim on its date is confirmed first (roadmap N3);
  // its failure is said beside it, not above the form's Save.
  const [ending, setEnding] = useState<EndingTransition | null>(null);
  const [endingNote, setEndingNote] = useState("");
  const [endingError, setEndingError] = useState<string | null>(null);
  const endingQuestionId = useId();
  const endingQuestionRef = useRef<HTMLParagraphElement | null>(null);
  const endingNoteRef = useRef<HTMLTextAreaElement | null>(null);
  const transitionsRef = useRef<HTMLDivElement | null>(null);
  /** The change whose button opened the confirmation "Keep it" closed. */
  const endingReturnRef = useRef<EndingTransition | null>(null);
  // Making an interest-only booking provisional asks for the hold's details
  // first (roadmap N3); a live hold carries them, and the API now refuses one
  // without.
  const [promotion, setPromotion] = useState<PromotionForm | null>(null);
  const [promotionErrors, setPromotionErrors] = useState<FieldErrors>({});
  const promotionQuestionId = useId();
  const promotionFirstRef = useRef<HTMLInputElement | null>(null);
  const promotionReturnRef = useRef(false);
  useEffect(() => {
    if (promotion !== null) return;
    if (promotionReturnRef.current) {
      promotionReturnRef.current = false;
      transitionsRef.current?.querySelector<HTMLButtonElement>('[data-transition="hold"]')?.focus();
    }
  }, [promotion]);
  const promotionOpen = promotion !== null;
  useEffect(() => {
    if (promotionOpen) promotionFirstRef.current?.focus();
  }, [promotionOpen]);
  function keepBooking(): void {
    endingReturnRef.current = ending;
    setEnding(null);
    setEndingError(null);
  }
  useEffect(() => {
    if (ending === null) {
      // Back on the button that asked, which the confirmation had replaced.
      const target = endingReturnRef.current;
      endingReturnRef.current = null;
      if (target !== null) transitionsRef.current?.querySelector<HTMLButtonElement>(`[data-transition="${target}"]`)?.focus();
      return;
    }
    // A precise pointer goes straight to the reason; on touch the keyboard
    // would cover the question, so focus lands on the question instead.
    const finePointer = typeof window.matchMedia === "function" && window.matchMedia("(pointer: fine)").matches;
    (finePointer ? endingNoteRef.current : endingQuestionRef.current)?.focus();
  }, [ending]);

  // The same gate the API applies to diary writes (DIARY_WRITE_ROLES): the
  // hallkeeper reads the diary but never edits it, so a read-only role is
  // never offered a control whose every path ends in a 403.
  const canWriteDiary = hasRole(DIARY_WRITE_ROLES, role);
  // Where a live hold's decision can move to (roadmap N3's Extend): a week
  // on, never past the day before its event; null when there is no later day.
  const extendTo = canWriteDiary && mode.kind === "edit" && decisionMs !== null && mode.booking.decisionAt !== null
    ? extendedDecisionMs(mode.booking.decisionAt, mode.booking.startsAt, nowMs) : null;

  useEffect(() => {
    if (canWriteDiary) titleRef.current?.focus();
    else closeRef.current?.focus();
  }, [canWriteDiary]);

  const transitions = useMemo(
    () => (mode.kind === "edit" ? allowedTransitionTargets(mode.booking.state, role) : []),
    [mode, role],
  );

  const isHold = form.kind === "hold";
  const place = followsLadder !== undefined && isHold ? formPlace(form, followsLadder) : null;
  // COUPLED to drawer-form.ts ERROR_SLOTTED_HOLD: the hygiene fieldset is
  // exactly the set of hold-only inline error slots.
  const showHygiene = isHold;

  function set<Key extends keyof DrawerForm>(key: Key, value: DrawerForm[Key]): void {
    setForm((previous) => {
      const next = { ...previous, [key]: value };
      const moved = key === "spaceId" || key === "startsAt" || key === "endsAt";
      return followsLadder !== undefined && !optionChosen && moved ? followLadder(next, followsLadder) : next;
    });
    if (key === "rank") setOptionChosen(true);
  }

  function onText(key: keyof DrawerForm) {
    return (event: ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => {
      set(key, event.target.value as DrawerForm[typeof key]);
    };
  }

  function failureMessage(caught: unknown): string {
    if (caught instanceof ApiError && caught.code === "INK_SLOT_TAKEN") return BOARD_COPY.undo.slotTaken;
    return caught instanceof ApiError ? caught.message : BOARD_COPY.drawer.saveFailed;
  }

  function failure(caught: unknown): void {
    setSubmitError(failureMessage(caught));
  }

  /** A next step that failed says so under its own buttons, not below the
   *  form it now sits above (roadmap N3). */
  function stepFailure(caught: unknown): void {
    setStepError(failureMessage(caught));
  }

  function rejectWithVisibleErrors(errors: FieldErrors): void {
    setFieldErrors(errors);
    // An error keyed to a field with no inline slot (e.g. hidden hygiene
    // fields) must still be seen — a silent return is a dead submit button.
    setSubmitError(hiddenFieldError(errors, isHold));
  }

  function submit(): void {
    if (!canWriteDiary) return;
    setSubmitError(null);
    if (mode.kind === "create") {
      const result = formToCreatePayload(form, venueId);
      if (!result.ok) {
        rejectWithVisibleErrors(result.fieldErrors);
        return;
      }
      setFieldErrors({});
      setBusy(true);
      createBooking(result.payload)
        .then((booking) => {
          onSaved(BOARD_COPY.drawer.created(booking.title));
        })
        .catch(failure)
        .finally(() => {
          setBusy(false);
        });
      return;
    }
    if (mode.kind === "convert") {
      const result = formToConvertPayload(form, mode.enquiry.id);
      if (!result.ok) {
        rejectWithVisibleErrors(result.fieldErrors);
        return;
      }
      setFieldErrors({});
      setBusy(true);
      convertEnquiry(result.payload)
        .then((booking) => {
          onSaved(BOARD_COPY.drawer.converted(booking.title));
        })
        .catch(failure)
        .finally(() => {
          setBusy(false);
        });
      return;
    }
    const result = formToUpdatePayload(form, mode.booking);
    if (!result.ok) {
      rejectWithVisibleErrors(result.fieldErrors);
      return;
    }
    if (!result.changed) {
      onClose();
      return;
    }
    setFieldErrors({});
    setBusy(true);
    updateBooking(mode.booking.id, result.payload)
      .then((booking) => {
        onSaved(BOARD_COPY.drawer.saved(booking.title));
      })
      .catch(failure)
      .finally(() => {
        setBusy(false);
      });
  }

  function runTransition(toState: BookingState): void {
    if (mode.kind !== "edit") return;
    if (toState === "hold" && mode.booking.kind === "prospect") {
      const place = ladderPlace?.(mode.booking.spaceId, Date.parse(mode.booking.startsAt), Date.parse(mode.booking.endsAt));
      setSubmitError(null);
      setStepError(null);
      setPromotionErrors({});
      setPromotion(initialPromotionForm(mode.booking, place?.kind === "read" ? place.rank : null));
      return;
    }
    if (isEndingTransition(toState)) {
      setSubmitError(null);
      setStepError(null);
      setEndingError(null);
      setEnding(toState);
      return;
    }
    setStepError(null);
    setBusy(true);
    transitionBooking(mode.booking.id, toState)
      .then(({ booking }) => {
        onSaved(BOARD_COPY.drawer.transitioned(booking.title, BOARD_COPY.transitions[toState]));
      })
      .catch(stepFailure)
      .finally(() => {
        setBusy(false);
      });
  }

  function extendDecision(): void {
    if (mode.kind !== "edit" || extendTo === null) return;
    const day = formatInlineDay(extendTo, nowMs);
    setStepError(null);
    setBusy(true);
    updateBooking(mode.booking.id, { decisionAt: new Date(extendTo).toISOString() })
      .then((saved) => {
        onSaved(BOARD_COPY.drawer.extended(saved.title, day));
      })
      .catch(stepFailure)
      .finally(() => {
        setBusy(false);
      });
  }

  function keepAsInterest(): void {
    promotionReturnRef.current = true;
    setPromotion(null);
    setPromotionErrors({});
  }

  function confirmPromotion(): void {
    if (mode.kind !== "edit" || promotion === null) return;
    const result = promotionPayload(promotion);
    if (!result.ok) {
      setPromotionErrors(result.fieldErrors);
      return;
    }
    setPromotionErrors({});
    setBusy(true);
    transitionBooking(mode.booking.id, "hold", undefined, result.hold)
      .then(({ booking }) => {
        onSaved(BOARD_COPY.promotion.done(booking.title, BOARD_COPY.decisions.option(booking.rank, booking.jointFlag)));
      })
      .catch((caught: unknown) => {
        // What was typed stays; the failure is said beside it.
        setPromotionErrors({ form: caught instanceof ApiError ? caught.message : BOARD_COPY.drawer.saveFailed });
      })
      .finally(() => {
        setBusy(false);
      });
  }

  function confirmEnding(): void {
    if (mode.kind !== "edit" || ending === null) return;
    const toState = ending;
    const note = endingNote.trim();
    setEndingError(null);
    setBusy(true);
    transitionBooking(mode.booking.id, toState, note.length === 0 ? undefined : note)
      .then(({ booking, promotedToFirst }) => {
        // The closing line says who now stands first: from the API's own
        // resequence when a hold left. A confirmed booking leaving moves no
        // hold's rank, so its 1st option is the one the board already had.
        const done = BOARD_COPY.ending.done[toState](booking.title);
        const ladder = ladderRead ? ladderAfterExit(mode.booking, contested) : null;
        if (promotedToFirst.length > 0) onSaved(`${done} ${BOARD_COPY.ending.nowFirst(promotedToFirst.map((hold) => hold.title))}`);
        else if (ladder?.kind === "free") onSaved(`${done} ${BOARD_COPY.ending.nowFree(ladder.titles)}`);
        else onSaved(done);
      })
      .catch((caught: unknown) => {
        // The reason typed so far stays; the failure is said beside it.
        setEndingError(caught instanceof ApiError ? caught.message : BOARD_COPY.drawer.saveFailed);
      })
      .finally(() => {
        setBusy(false);
      });
  }

  // The corridor between the Diary and the planner. The API has always
  // accepted `eventId` on a booking (updateBookingCore checks the event
  // belongs to the booking's venue); nothing in the client ever sent it, so
  // a coordinator had no way to say "this booking is the thing I am planning".
  // Starting a plan seeds the event from the booking it belongs to, then
  // links the two — the id is what /plan?eventId= reads.
  function startPlan(): void {
    if (mode.kind !== "edit") return;
    const booking = mode.booking;
    setSubmitError(null);
    setBusy(true);
    // Starting a plan is TWO writes that cannot be one transaction: create the
    // event, then link it. If the link fails the event is already committed,
    // and there is no endpoint that can list or delete it — so a naive retry
    // would mint a second orphan every time. Remembering the id makes the
    // retry FINISH the operation instead of repeating its first half.
    const existing = startedEventRef.current;
    const eventIdPromise =
      existing === null ? createEvent({
        venueId,
        name: booking.title,
        eventType: booking.eventType,
        // Honest defaults: a plan begun from a booking is a draft, and the
        // headcount is genuinely unknown until someone enters it.
        status: "draft",
        guestCount: 0,
        startsAt: booking.startsAt,
        endsAt: booking.endsAt,
      }).then((graph) => {
        startedEventRef.current = graph.event.id;
        return graph.event.id;
      })
      : Promise.resolve(existing);

    eventIdPromise
      .then((eventId) => updateBooking(booking.id, { eventId }))
      .then((saved) => {
        startedEventRef.current = null;
        onSaved(BOARD_COPY.drawer.planStarted(saved.title));
      })
      .catch((caught: unknown) => {
        // Which half failed decides what is true to say. Once the plan
        // exists, "the booking is unchanged" would hide it.
        if (startedEventRef.current !== null) {
          setSubmitError(BOARD_COPY.drawer.planLinkFailed);
          return;
        }
        setSubmitError(caught instanceof ApiError ? caught.message : BOARD_COPY.drawer.planFailed);
      })
      .finally(() => {
        setBusy(false);
      });
  }

  function detachPlan(): void {
    if (mode.kind !== "edit") return;
    const booking = mode.booking;
    setSubmitError(null);
    setBusy(true);
    updateBooking(booking.id, { eventId: null })
      .then((saved) => {
        onSaved(BOARD_COPY.drawer.planDetached(saved.title));
      })
      .catch(failure)
      .finally(() => {
        setBusy(false);
      });
  }

  function onKeyDown(event: ReactKeyboardEvent<HTMLElement>): void {
    if (event.key === "Escape") {
      event.preventDefault();
      // Same rule as the Cancel button: while a save is in flight the drawer
      // stays put, so its outcome always lands somewhere visible (review P2).
      if (busy) return;
      // A confirmation open inside the drawer steps back first.
      if (ending !== null) keepBooking();
      else if (promotion !== null) keepAsInterest();
      else onClose();
    }
  }

  function fieldError(key: string): ReactElement | null {
    const message = fieldErrors[key];
    if (message === undefined) return null;
    return (
      <span className="diary-field-error" id={`diary-field-${key}-error`}>
        {message}
      </span>
    );
  }

  return (
    <aside
      className="diary-drawer"
      role="dialog"
      aria-label={drawerTitle(mode)}
      aria-busy={busy}
      onKeyDown={onKeyDown}
    >
      <header className="diary-drawer-header">
        <h2 className="diary-drawer-title">{drawerTitle(mode)}</h2>
        <button ref={closeRef} type="button" className="diary-button" onClick={onClose} disabled={busy}>
          {BOARD_COPY.drawer.close}
        </button>
      </header>

      {busy ? <ActivityStatus>Updating this booking…</ActivityStatus> : null}

      {mode.kind === "convert" ? (
        <p className="diary-drawer-note">{BOARD_COPY.drawer.convertNote(mode.enquiry.name)}</p>
      ) : null}

      {/* "Booking summary", not "Booking details": the drawer itself answers
          to "Booking details", and two landmarks with one name are a maze for
          anyone navigating by label (T-619). */}
      {mode.kind === "edit" ? <section className="diary-booking-detail" aria-label={BOARD_COPY.drawer.summaryLabel}>
        <h3>{mode.booking.title}</h3>
        {/* Facts first (roadmap N3): what the booking is, in the board's own
            words, then when and where it stands and when it must be
            decided, before who owns it. */}
        <p className="diary-booking-standing" data-kind={mode.booking.status === "active" ? mode.booking.kind : "exited"}>
          {bookingStateLabel(mode.booking)}
        </p>
        {/* Who owns it and whose event it is, by name, with each absence
            said out loud rather than left as a gap (T-619). */}
        <dl className="diary-booking-facts">
          <dt>{BOARD_COPY.drawer.whenLabel}</dt>
          <dd>{bookingWhen(mode.booking, nowMs)}</dd>
          <dt>{BOARD_COPY.drawer.roomLabel}</dt>
          <dd>{rooms.find((room) => room.id === mode.booking.spaceId)?.name ?? BOARD_COPY.drawer.roomUnknown}</dd>
          {decisionMs === null ? null : <>
            <dt>{decisionMs < nowMs ? BOARD_COPY.drawer.decisionWasDueLabel : BOARD_COPY.drawer.decideByLabel}</dt>
            <dd className={decisionMs < nowMs ? "is-overdue" : undefined}>{formatInlineDay(decisionMs, nowMs)}</dd>
          </>}
          <dt>{BOARD_COPY.drawer.ownerLabel}</dt>
          <dd>{detailOrNull(mode.booking.ownerName) ?? BOARD_COPY.drawer.ownerUnassigned}</dd>
          <dt>{BOARD_COPY.drawer.clientLabel}</dt>
          <dd>{detailOrNull(mode.booking.clientName) ?? BOARD_COPY.drawer.clientNone}</dd>
          {detailOrNull(mode.booking.eventName) === null ? null : <>
            <dt>{BOARD_COPY.drawer.eventLabel}</dt>
            <dd>{detailOrNull(mode.booking.eventName)}</dd>
          </>}
          {mode.booking.guestCount === null || mode.booking.guestCount === undefined ? null : <>
            <dt>{BOARD_COPY.drawer.guestsLabel}</dt>
            <dd>{String(mode.booking.guestCount)}</dd>
          </>}
        </dl>
      </section> : null}
      {!canWriteDiary ? <p className="diary-drawer-note">Read-only booking details. A venue coordinator can make changes.</p> : null}

      {/* The next step sits in one place, under the facts and above the
          form (roadmap N3), so confirming or releasing never means
          scrolling past every field first. */}
      {transitions.length > 0 && promotion !== null && mode.kind === "edit" ? (
        <div className="diary-drawer-transitions">
          <h3 className="diary-checks-title">{BOARD_COPY.drawer.transitionsTitle}</h3>
          <div className="diary-consequence" role="group" aria-labelledby={promotionQuestionId} data-tone="sage">
            <p className="diary-consequence-question" id={promotionQuestionId}>
              {BOARD_COPY.promotion.question(mode.booking.title)}
            </p>
            <p className="diary-consequence-line">
              {BOARD_COPY.promotion.needs}{mode.booking.ownerUserId === null ? ` ${BOARD_COPY.drawer.ownerNote}` : ""}
            </p>
            {ladderPlace === undefined ? null : (
              <p className="diary-drawer-note">
                {ladderNote(
                  ladderPlace(mode.booking.spaceId, Date.parse(mode.booking.startsAt), Date.parse(mode.booking.endsAt)),
                  rooms.find((room) => room.id === mode.booking.spaceId)?.name ?? BOARD_COPY.drawer.fields.room,
                )}
              </p>
            )}
            <div className="diary-field-row">
              <label className="diary-field">
                {BOARD_COPY.drawer.fields.rank}
                <input
                  ref={promotionFirstRef}
                  type="number"
                  min={1}
                  value={promotion.rank}
                  disabled={busy}
                  aria-invalid={promotionErrors["rank"] !== undefined}
                  onChange={(event) => { const rank = event.target.value; setPromotion((previous) => (previous === null ? previous : { ...previous, rank })); }}
                />
                {promotionErrors["rank"] !== undefined ? <span className="diary-field-error">{promotionErrors["rank"]}</span> : null}
              </label>
              <label className="diary-field">
                {BOARD_COPY.drawer.fields.decisionAt}
                <input
                  type="datetime-local"
                  value={promotion.decisionAt}
                  disabled={busy}
                  aria-invalid={promotionErrors["decisionAt"] !== undefined}
                  onChange={(event) => { const decisionAt = event.target.value; setPromotion((previous) => (previous === null ? previous : { ...previous, decisionAt })); }}
                />
                {promotionErrors["decisionAt"] !== undefined ? <span className="diary-field-error">{promotionErrors["decisionAt"]}</span> : null}
              </label>
            </div>
            <label className="diary-field">
              {BOARD_COPY.drawer.fields.nextAction}
              <input
                type="text"
                value={promotion.nextAction}
                disabled={busy}
                aria-invalid={promotionErrors["nextAction"] !== undefined}
                onChange={(event) => { const nextAction = event.target.value; setPromotion((previous) => (previous === null ? previous : { ...previous, nextAction })); }}
              />
              {promotionErrors["nextAction"] !== undefined ? <span className="diary-field-error">{promotionErrors["nextAction"]}</span> : null}
            </label>
            <label className="diary-field">
              {BOARD_COPY.drawer.fields.nextActionDueAt}
              <input
                type="datetime-local"
                value={promotion.nextActionDueAt}
                disabled={busy}
                aria-invalid={promotionErrors["nextActionDueAt"] !== undefined}
                onChange={(event) => { const nextActionDueAt = event.target.value; setPromotion((previous) => (previous === null ? previous : { ...previous, nextActionDueAt })); }}
              />
              {promotionErrors["nextActionDueAt"] !== undefined ? <span className="diary-field-error">{promotionErrors["nextActionDueAt"]}</span> : null}
            </label>
            <div className="diary-drawer-actions">
              <button type="button" className="diary-button is-primary" onClick={confirmPromotion} disabled={busy} aria-busy={busy}>
                {busy ? BOARD_COPY.promotion.saving : BOARD_COPY.promotion.confirm}
              </button>
              <button type="button" className="diary-button" onClick={keepAsInterest} disabled={busy}>
                {BOARD_COPY.promotion.keep}
              </button>
            </div>
            {promotionErrors["form"] !== undefined ? <p className="diary-drawer-error" role="alert">{promotionErrors["form"]}</p> : null}
          </div>
        </div>
      ) : transitions.length > 0 && ending !== null && mode.kind === "edit" ? (
        <div className="diary-drawer-transitions">
          <h3 className="diary-checks-title">{BOARD_COPY.drawer.transitionsTitle}</h3>
          <div className="diary-consequence" role="group" aria-labelledby={endingQuestionId} data-tone={ending === "cancelled" ? "brick" : "amber"}>
            <p className="diary-consequence-question" id={endingQuestionId} ref={endingQuestionRef} tabIndex={-1}>
              {BOARD_COPY.ending.question[ending](mode.booking.title)}
            </p>
            <p className="diary-consequence-line">{endingConsequence(mode.booking, rooms, contested, ladderRead)}</p>
            <label className="diary-field">
              {BOARD_COPY.ending.noteLabel}
              <textarea
                ref={endingNoteRef}
                value={endingNote}
                maxLength={500}
                rows={2}
                disabled={busy}
                onChange={(event) => { setEndingNote(event.target.value); }}
              />
            </label>
            <div className="diary-drawer-actions">
              <button type="button" className="diary-button is-primary" onClick={confirmEnding} disabled={busy} aria-busy={busy}>
                {busy ? BOARD_COPY.ending.saving[ending] : BOARD_COPY.ending.confirm[ending]}
              </button>
              <button type="button" className="diary-button" onClick={keepBooking} disabled={busy}>
                {BOARD_COPY.ending.keep}
              </button>
            </div>
            {endingError !== null ? <p className="diary-drawer-error" role="alert">{endingError}</p> : null}
          </div>
        </div>
      ) : transitions.length > 0 ? (
        <div className="diary-drawer-transitions" ref={transitionsRef}>
          <h3 className="diary-checks-title">{BOARD_COPY.drawer.transitionsTitle}</h3>
          <div className="diary-drawer-actions">
            {transitions.map((target, index) => (
              <Fragment key={target}>
                <button
                  type="button"
                  data-transition={target}
                  className={`diary-button${target === "ink" ? " is-primary" : ""}`}
                  onClick={() => {
                    runTransition(target);
                  }}
                  disabled={busy}
                >
                  {/* "…": this one asks first. */}
                  {BOARD_COPY.transitions[target]}{isEndingTransition(target) || (target === "hold" && mode.kind === "edit" && mode.booking.kind === "prospect") ? "…" : ""}
                </button>
                {/* Confirm, Extend, Release: the day it moves to is on the
                    button, so it needs no question of its own. */}
                {extendTo !== null && (target === "ink" || (index === 0 && !transitions.includes("ink"))) ? (
                  <button type="button" className="diary-button" onClick={extendDecision} disabled={busy}>
                    {BOARD_COPY.drawer.extendTo(formatInlineDay(extendTo, nowMs))}
                  </button>
                ) : null}
              </Fragment>
            ))}
          </div>
          {stepError !== null ? <p className="diary-drawer-error" role="alert">{stepError}</p> : null}
        </div>
      ) : null}

      <form
        className="diary-drawer-form"
        onSubmit={(event) => {
          event.preventDefault();
          submit();
        }}
      >
        <fieldset className="diary-form-fields" disabled={!canWriteDiary}>
        {mode.kind === "create" ? (
          <label className="diary-field">
            {BOARD_COPY.drawer.fields.kind}
            <select value={form.kind} onChange={onText("kind")}>
              {KIND_OPTIONS.map((kind) => (
                <option key={kind} value={kind}>
                  {BOARD_COPY.legend[kind]}
                </option>
              ))}
            </select>
          </label>
        ) : null}

        {/* A room change is a cross-lane move, which the board has always
            allowed by dragging. Withholding it here left a coordinator on a
            phone, where dragging is hardest, unable to move a booking at all
            (T-619). The server applies the same exclusion constraint. */}
        <label className="diary-field">
          {BOARD_COPY.drawer.fields.room}
          <select
            value={form.spaceId}
            onChange={onText("spaceId")}
            aria-invalid={fieldErrors["spaceId"] !== undefined}
          >
            {rooms.map((room) => (
              <option key={room.id} value={room.id}>
                {room.name}
              </option>
            ))}
          </select>
          {fieldError("spaceId")}
        </label>

        <label className="diary-field">
          {BOARD_COPY.drawer.fields.title}
          <input
            ref={titleRef}
            type="text"
            value={form.title}
            onChange={onText("title")}
            aria-invalid={fieldErrors["title"] !== undefined}
          />
          {fieldError("title")}
        </label>

        <label className="diary-field">
          {BOARD_COPY.drawer.fields.eventType}
          <input type="text" value={form.eventType} onChange={onText("eventType")} />
        </label>

        <div className="diary-field-row is-times">
          <label className="diary-field">
            {BOARD_COPY.drawer.fields.startsAt}
            <input
              type="datetime-local"
              value={form.startsAt}
              onChange={onText("startsAt")}
              aria-invalid={fieldErrors["startsAt"] !== undefined}
            />
            {fieldError("startsAt")}
          </label>
          <label className="diary-field">
            {BOARD_COPY.drawer.fields.endsAt}
            <input
              type="datetime-local"
              value={form.endsAt}
              onChange={onText("endsAt")}
              aria-invalid={fieldErrors["endsAt"] !== undefined}
            />
            {fieldError("endsAt")}
          </label>
        </div>

        {showHygiene ? (
          <fieldset className="diary-hygiene">
            <legend>{BOARD_COPY.drawer.hygieneLegend}</legend>
            <div className="diary-field-row">
              <label className="diary-field">
                {BOARD_COPY.drawer.fields.rank}
                <input
                  type="number"
                  min={1}
                  value={form.rank}
                  onChange={onText("rank")}
                  aria-invalid={fieldErrors["rank"] !== undefined}
                  aria-describedby={place === null ? undefined : ladderNoteId}
                />
                {fieldError("rank")}
              </label>
              <label className="diary-field diary-field-checkbox">
                <input
                  type="checkbox"
                  checked={form.jointFlag}
                  onChange={(event) => {
                    set("jointFlag", event.target.checked);
                  }}
                />
                {BOARD_COPY.drawer.fields.jointFlag}
              </label>
            </div>
            {place !== null ? (
              <p id={ladderNoteId} className="diary-drawer-note diary-ladder-note">
                {ladderNote(place, rooms.find((room) => room.id === form.spaceId)?.name ?? BOARD_COPY.drawer.fields.room)}
              </p>
            ) : null}
            <label className="diary-field">
              {BOARD_COPY.drawer.fields.decisionAt}
              <input
                type="datetime-local"
                value={form.decisionAt}
                onChange={onText("decisionAt")}
                aria-invalid={fieldErrors["decisionAt"] !== undefined}
              />
              {fieldError("decisionAt")}
            </label>
            <label className="diary-field">
              {BOARD_COPY.drawer.fields.nextAction}
              <input
                type="text"
                value={form.nextAction}
                onChange={onText("nextAction")}
                aria-invalid={fieldErrors["nextAction"] !== undefined}
              />
              {fieldError("nextAction")}
            </label>
            <label className="diary-field">
              {BOARD_COPY.drawer.fields.nextActionDueAt}
              <input
                type="datetime-local"
                value={form.nextActionDueAt}
                onChange={onText("nextActionDueAt")}
                aria-invalid={fieldErrors["nextActionDueAt"] !== undefined}
              />
              {fieldError("nextActionDueAt")}
            </label>
            {/* True when making one; an existing booking already has its
                owner, named in the summary above (T-619). */}
            {mode.kind === "edit" ? null : (
              <p className="diary-drawer-note">{BOARD_COPY.drawer.ownerNote}</p>
            )}
            {fieldError("ownerUserId")}
          </fieldset>
        ) : null}

        {/* Notes in every mode. On edit they were rendered nowhere and never
            saved, so a note written at creation vanished for the rest of the
            booking's life (T-619). */}
        <label className="diary-field">
          {BOARD_COPY.drawer.fields.notes}
          <textarea
            value={form.notes}
            onChange={onText("notes")}
            rows={3}
            aria-invalid={fieldErrors["notes"] !== undefined}
          />
          {fieldError("notes")}
        </label>

        </fieldset>
        {submitError !== null ? (
          <p className="diary-drawer-error" role="alert">
            {submitError}
          </p>
        ) : null}

        <div className="diary-drawer-actions">
          {canWriteDiary ? <button type="submit" className="diary-button is-primary" disabled={busy}>
            {BOARD_COPY.drawer.submit[mode.kind]}
          </button> : null}
          <button type="button" className="diary-button" onClick={onClose} disabled={busy}>
            {BOARD_COPY.drawer.cancel}
          </button>
        </div>
      </form>

      {mode.kind === "edit" && canWriteDiary ? (
        <div className="diary-drawer-plan">
          <h3 className="diary-checks-title">{BOARD_COPY.drawer.planTitle}</h3>
          {mode.booking.eventId === null ? (
            <>
              <p className="diary-drawer-note">{BOARD_COPY.drawer.planNone}</p>
              <div className="diary-drawer-actions">
                <button
                  type="button"
                  className="diary-button"
                  onClick={startPlan}
                  disabled={busy}
                >
                  {BOARD_COPY.drawer.planStart}
                </button>
              </div>
            </>
          ) : (
            <>
              <p className="diary-drawer-note">{BOARD_COPY.drawer.planAttached}</p>
              <div className="diary-drawer-actions">
                {/* A real link, not a router push: the planner is a heavy 3D
                    route and a deliberate context switch, and an anchor keeps
                    this drawer testable without a router. */}
                <a
                  className="diary-button is-primary"
                  href={planHref(mode.booking.eventId, mode.booking.spaceId, rooms)}
                >
                  {BOARD_COPY.drawer.planOpen}
                </a>
                <button
                  type="button"
                  className="diary-button"
                  onClick={detachPlan}
                  disabled={busy}
                >
                  {BOARD_COPY.drawer.planDetach}
                </button>
              </div>
            </>
          )}
        </div>
      ) : null}

    </aside>
  );
}
