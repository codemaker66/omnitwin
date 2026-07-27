import { useEffect, useMemo, useRef, useState } from "react";
import type { ChangeEvent, KeyboardEvent as ReactKeyboardEvent, ReactElement } from "react";
import type { BookingKind, BookingState, CalendarRoom } from "@omnitwin/types";
import { ApiError } from "../../../api/client.js";
import {
  convertEnquiry,
  createBooking,
  transitionBooking,
  updateBooking,
} from "../../../api/diary.js";
import { createEvent } from "../../../api/events.js";
import { BOARD_COPY } from "../board-copy.js";
import {
  allowedTransitionTargets,
  formToConvertPayload,
  formToCreatePayload,
  formToUpdatePayload,
  hiddenFieldError,
  initialDrawerForm,
  type DrawerForm,
  type DrawerMode,
  type FieldErrors,
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
}

const KIND_OPTIONS: readonly BookingKind[] = ["hold", "ink", "internal_block", "prospect"];

function drawerTitle(mode: DrawerMode): string {
  if (mode.kind === "edit") return BOARD_COPY.drawer.editTitle;
  if (mode.kind === "convert") return BOARD_COPY.drawer.convertTitle;
  return BOARD_COPY.drawer.createTitle;
}

export function BookingDrawer(props: BookingDrawerProps): ReactElement {
  const { mode, rooms, venueId, role, onClose, onSaved } = props;
  const [form, setForm] = useState<DrawerForm>(() => initialDrawerForm(mode));
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const titleRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    titleRef.current?.focus();
  }, []);

  const transitions = useMemo(
    () => (mode.kind === "edit" ? allowedTransitionTargets(mode.booking.state, role) : []),
    [mode, role],
  );

  const isHold = form.kind === "hold";
  // COUPLED to drawer-form.ts ERROR_SLOTTED_HOLD: the hygiene fieldset is
  // exactly the set of hold-only inline error slots.
  const showHygiene = isHold;

  function set<Key extends keyof DrawerForm>(key: Key, value: DrawerForm[Key]): void {
    setForm((previous) => ({ ...previous, [key]: value }));
  }

  function onText(key: keyof DrawerForm) {
    return (event: ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => {
      set(key, event.target.value as DrawerForm[typeof key]);
    };
  }

  function failure(caught: unknown): void {
    if (caught instanceof ApiError && caught.code === "INK_SLOT_TAKEN") {
      setSubmitError(BOARD_COPY.undo.slotTaken);
      return;
    }
    setSubmitError(caught instanceof ApiError ? caught.message : BOARD_COPY.drawer.saveFailed);
  }

  function rejectWithVisibleErrors(errors: FieldErrors): void {
    setFieldErrors(errors);
    // An error keyed to a field with no inline slot (e.g. hidden hygiene
    // fields) must still be seen — a silent return is a dead submit button.
    setSubmitError(hiddenFieldError(errors, isHold));
  }

  function submit(): void {
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
    setSubmitError(null);
    setBusy(true);
    transitionBooking(mode.booking.id, toState)
      .then((booking) => {
        onSaved(BOARD_COPY.drawer.transitioned(booking.title, BOARD_COPY.transitions[toState]));
      })
      .catch(failure)
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
    createEvent({
      venueId,
      name: booking.title,
      eventType: booking.eventType,
      // Honest defaults: a plan begun from a booking is a draft, and the
      // headcount is genuinely unknown until someone enters it.
      status: "draft",
      guestCount: 0,
      startsAt: booking.startsAt,
      endsAt: booking.endsAt,
    })
      .then((graph) => updateBooking(booking.id, { eventId: graph.event.id }))
      .then((saved) => {
        onSaved(BOARD_COPY.drawer.planStarted(saved.title));
      })
      .catch((caught: unknown) => {
        // The event may exist while the link failed — say only what is true.
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
      if (!busy) onClose();
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
      onKeyDown={onKeyDown}
    >
      <header className="diary-drawer-header">
        <h2 className="diary-drawer-title">{drawerTitle(mode)}</h2>
        <button type="button" className="diary-button" onClick={onClose} disabled={busy}>
          {BOARD_COPY.drawer.close}
        </button>
      </header>

      {mode.kind === "convert" ? (
        <p className="diary-drawer-note">{BOARD_COPY.drawer.convertNote(mode.enquiry.name)}</p>
      ) : null}

      <form
        className="diary-drawer-form"
        onSubmit={(event) => {
          event.preventDefault();
          submit();
        }}
      >
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

        <label className="diary-field">
          {BOARD_COPY.drawer.fields.room}
          <select
            value={form.spaceId}
            onChange={onText("spaceId")}
            disabled={mode.kind === "edit"}
          >
            {rooms.map((room) => (
              <option key={room.id} value={room.id}>
                {room.name}
              </option>
            ))}
          </select>
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

        <div className="diary-field-row">
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
            <p className="diary-drawer-note">{BOARD_COPY.drawer.ownerNote}</p>
            {fieldError("ownerUserId")}
          </fieldset>
        ) : null}

        {mode.kind !== "edit" ? (
          <label className="diary-field">
            {BOARD_COPY.drawer.fields.notes}
            <textarea value={form.notes} onChange={onText("notes")} rows={2} />
          </label>
        ) : null}

        {submitError !== null ? (
          <p className="diary-drawer-error" role="alert">
            {submitError}
          </p>
        ) : null}

        <div className="diary-drawer-actions">
          <button type="submit" className="diary-button is-primary" disabled={busy}>
            {BOARD_COPY.drawer.submit[mode.kind]}
          </button>
          <button type="button" className="diary-button" onClick={onClose} disabled={busy}>
            {BOARD_COPY.drawer.cancel}
          </button>
        </div>
      </form>

      {mode.kind === "edit" ? (
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
                  href={`/plan?eventId=${encodeURIComponent(mode.booking.eventId)}`}
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

      {transitions.length > 0 ? (
        <div className="diary-drawer-transitions">
          <h3 className="diary-checks-title">{BOARD_COPY.drawer.transitionsTitle}</h3>
          <div className="diary-drawer-actions">
            {transitions.map((target) => (
              <button
                key={target}
                type="button"
                className={`diary-button${target === "ink" ? " is-primary" : ""}`}
                onClick={() => {
                  runTransition(target);
                }}
                disabled={busy}
              >
                {BOARD_COPY.transitions[target]}
              </button>
            ))}
          </div>
        </div>
      ) : null}
    </aside>
  );
}
