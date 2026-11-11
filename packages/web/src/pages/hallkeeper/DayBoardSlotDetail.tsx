import { useCallback, useEffect, useRef, useState, type ReactElement } from "react";
import { Link } from "react-router-dom";
import { Check, X } from "lucide-react";
import {
  describeObservationKind,
  nextObservationKinds,
  occasionLabel,
  type BookingKind,
  type EventAwaitingAcknowledgement,
  type HallkeeperSheetSummary,
  type ObservationKind,
} from "@omnitwin/types";
import { getSheetSummary } from "../../api/hallkeeper-summary.js";
import { formatWallDay, formatWallTime } from "../diary/lib/board-time.js";
import { ActivityIndicator, ActivityStatus } from "../../components/shared/Activity.js";
import { resolveEventLinkedLayouts, type LinkedLayoutChoice } from "../../lib/event-linked-layouts.js";
import { roomPhoto } from "../../components/dashboard/enquiries/enquiry-room-photo.js";
import { isQueuedObservation, type RecordOutcome, type SlotObservationsApi } from "./lib/use-slot-observations.js";
import { describeSlotSheet, sheetProgressLine, type SlotSheetState } from "./lib/day-board-sheet.js";
import type { DayBoardSlot } from "./lib/day-board-state.js";
import type { SlotRequestsComponent } from "./lib/slot-requests-contract.js";
import { StateIcon } from "./DayBoardRooms.js";

// ---------------------------------------------------------------------------
// The open slot, on the forest decision panel the desks use: the room's
// photograph, the function, where it stands, what changed since the floor
// last looked (with one "Got it"), what the room was seen doing and the next
// fact to record (the first offered as the panel's one primary button, unless
// a change waits to be read), the setup sheet and how far it has got, the
// event, its phases and the requests made against it. The requests surface is Lane 9's and was
// drawn for paper, so it sits on an ivory slip laid on the forest.
// ---------------------------------------------------------------------------

interface SlotSheetResult {
  readonly status: "loading" | "ready" | "error";
  readonly state: SlotSheetState | null;
  readonly error: string | null;
}

/**
 * Resolve the slot's setup-sheet door. One resolution per event+room; the
 * `isCurrent` guard is the same superseded-request discipline the planner
 * bootstrap uses, so a board that rolls over midnight (or a room filter
 * change) can never paint a stale room's layouts onto a slot.
 */
function useSlotSheet(eventId: string | null, roomSlug: string, roomName: string, bookingKind: BookingKind): SlotSheetResult {
  const [layouts, setLayouts] = useState<readonly LinkedLayoutChoice[] | null>(null);
  const [unavailable, setUnavailable] = useState(0);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (eventId === null) {
      setLayouts([]);
      setUnavailable(0);
      setError(null);
      return;
    }
    let current = true;
    setLayouts(null);
    setError(null);
    void resolveEventLinkedLayouts({ eventId, spaceSlug: roomSlug, isCurrent: () => current })
      .then((resolved) => {
        if (!current) return;
        setLayouts(resolved.layouts);
        setUnavailable(resolved.unavailableCount);
      })
      .catch(() => {
        if (!current) return;
        setError("The setup sheet link could not be checked.");
      });
    return () => { current = false; };
  }, [eventId, roomSlug]);

  if (error !== null) return { status: "error", state: null, error };
  if (layouts === null) return { status: "loading", state: null, error: null };
  return {
    status: "ready",
    state: describeSlotSheet({ eventId, bookingKind, roomName, layouts, unavailableCount: unavailable }),
    error: null,
  };
}

const SUMMARY_REFRESH_MS = 60_000;

/**
 * A sheet's ready-by time and rows checked, read now and each minute while
 * the slot is open. A failed read keeps the last line it had; before any
 * read lands there is no line at all, rather than a guess.
 */
function useSheetSummary(configId: string, eventId: string | null): HallkeeperSheetSummary | null {
  const key = `${configId}:${eventId ?? ""}`;
  const [summary, setSummary] = useState<{ readonly key: string; readonly value: HallkeeperSheetSummary } | null>(null);
  useEffect(() => {
    let reading: AbortController | null = null;
    const read = (): void => {
      if (typeof document !== "undefined" && document.hidden) return;
      reading?.abort();
      const current = new AbortController();
      reading = current;
      void getSheetSummary(configId, eventId, current.signal)
        .then((value) => { if (!current.signal.aborted) setSummary({ key, value }); })
        .catch(() => {
          // Keep the last line; the next minute reads again.
        });
    };
    read();
    const timer = window.setInterval(read, SUMMARY_REFRESH_MS);
    return () => {
      window.clearInterval(timer);
      reading?.abort();
    };
  }, [configId, eventId, key]);
  return summary?.key === key ? summary.value : null;
}

/** Under the sheet's door: "Ready by 16:00 · 12 of 43 checked", with a thin
 *  bar that turns sage when every row is checked. */
function SheetProgress({ configId, eventId, timeZone }: {
  readonly configId: string;
  readonly eventId: string | null;
  readonly timeZone: string;
}): ReactElement | null {
  const summary = useSheetSummary(configId, eventId);
  if (summary === null) return null;
  const complete = summary.total > 0 && summary.checked === summary.total;
  return (
    <p className={`dayboard-slot-progress${complete ? " is-complete" : ""}`}>
      <span className="dayboard-slot-progress-words">
        {complete && <Check size={14} aria-hidden="true" />}
        {sheetProgressLine(summary, timeZone)}
      </span>
      {summary.total > 0 && (
        <span className="dayboard-slot-progress-bar" aria-hidden="true">
          <span style={{ width: `${String(Math.round(summary.checked / summary.total * 100))}%` }} />
        </span>
      )}
    </p>
  );
}

function SlotSheetLink({ eventId, bookingKind, roomSlug, roomName, timeZone }: {
  readonly eventId: string | null;
  readonly bookingKind: BookingKind;
  readonly roomSlug: string;
  readonly roomName: string;
  readonly timeZone: string;
}): ReactElement {
  const result = useSlotSheet(eventId, roomSlug, roomName, bookingKind);

  if (result.status === "loading") {
    return (
      <div className="dayboard-slot-sheet">
        <ActivityStatus>Finding this room’s setup sheet…</ActivityStatus>
      </div>
    );
  }

  if (result.status === "error" || result.state === null) {
    return (
      <div className="dayboard-slot-sheet">
        <p className="dayboard-slot-sheet-note">{result.error ?? "The setup sheet link could not be checked."}</p>
      </div>
    );
  }

  const state = result.state;
  return (
    <div className="dayboard-slot-sheet">
      {state.kind === "one" && (
        <>
          <Link className="dayboard-open-sheet" to={state.href}>
            {state.label}<span className="dayboard-slot-sheet-layout">{state.layoutName}</span>
          </Link>
          <SheetProgress configId={state.configurationId} eventId={state.eventId} timeZone={timeZone} />
        </>
      )}
      {state.kind === "many" && (
        <>
          <p className="dayboard-slot-sheet-note">{roomName} has more than one linked layout.</p>
          <ul className="dayboard-sheet-choices">
            {state.choices.map((choice) => (
              <li key={choice.configurationId}>
                <Link className="dayboard-open-sheet" to={choice.href}>{choice.name}</Link>
                <SheetProgress configId={choice.configurationId} eventId={state.eventId} timeZone={timeZone} />
              </li>
            ))}
          </ul>
        </>
      )}
      {(state.kind === "no-event" || state.kind === "no-layout") && (
        <>
          <p className="dayboard-slot-sheet-note">{state.message}</p>
          {state.kind === "no-layout"
            ? <Link className="dayboard-open-event" to={`/ops/events/${state.eventId}`}>{state.nextAction}</Link>
            : <Link className="dayboard-open-event" to="/diary">{state.nextAction}</Link>}
        </>
      )}
    </div>
  );
}

/** What the hallkeeper is told after a tap: the fact and where it stands. */
function seenStatus(kind: ObservationKind, outcome: RecordOutcome | "sending" | Error): string {
  const what = describeObservationKind(kind);
  if (outcome === "sending") return `${what} · sending…`;
  if (outcome === "sent") return `${what} · recorded`;
  if (outcome === "queued") return `${what} · queued, sends when the connection is back`;
  return `Couldn’t record ${what.toLowerCase()}: ${outcome.message}`;
}

/** When a change was made: the time today, the day and time before that. */
function changeWhen(atMs: number, nowMs: number, timeZone: string): string {
  const time = formatWallTime(atMs, timeZone);
  return formatWallDay(atMs, timeZone) === formatWallDay(nowMs, timeZone) ? time : `${formatWallDay(atMs, timeZone)}, ${time}`;
}

/** What a change's Was and Now lines say in full: hours, rooms and guests. A
 *  change that touched anything else keeps its sentence above them. */
const WAS_NOW_SURFACES: ReadonlySet<string> = new Set(["timings", "layout", "guest_count"]);

/** Who last acknowledged a change here, while it is still today's news. */
const SEEN_BY_FOR_MS = 12 * 60 * 60 * 1000;

/**
 * What changed on the slot's event since the floor last looked: each change
 * with its words before and after, and one "Got it" for all of them, which
 * puts them in hand for the whole floor.
 */
function WhatChanged({ changes, timeZone, nowMs, onAcknowledge, sending, failure }: {
  readonly changes: EventAwaitingAcknowledgement;
  readonly timeZone: string;
  readonly nowMs: number;
  /** Null where nothing may be acknowledged (the wall, a role that only reads). */
  readonly onAcknowledge: (() => void) | null;
  readonly sending: boolean;
  readonly failure: string | null;
}): ReactElement | null {
  const waiting = changes.changes;
  const seenRef = useRef<HTMLParagraphElement>(null);
  const wasSending = useRef(false);
  // The button leaves with the changes it acknowledged; the keyboard's place
  // goes to the line that says who has them, not to the document.
  useEffect(() => {
    if (wasSending.current && !sending && waiting.length === 0) {
      const active = document.activeElement;
      if (active === null || active === document.body) seenRef.current?.focus();
    }
    wasSending.current = sending;
  }, [sending, waiting.length]);
  if (waiting.length === 0) {
    const last = changes.lastAcknowledgement;
    if (last === null || nowMs - Date.parse(last.at) > SEEN_BY_FOR_MS) return null;
    return (
      <p ref={seenRef} className="dayboard-changes-seen" tabIndex={-1}>
        Changes seen by {last.by}, {changeWhen(Date.parse(last.at), nowMs, timeZone)}.
      </p>
    );
  }
  return (
    <section className="dayboard-changes dayboard-detail-section" aria-label="What changed">
      <h3 className="dayboard-detail-heading">What changed</h3>
      <ol className="dayboard-changes-list">
        {waiting.map((change) => {
          const fromTo = change.beforeSummary !== null && change.afterSummary !== null && change.beforeSummary !== change.afterSummary;
          // Said once: the sentence, unless the Was and Now lines say it all.
          const saysMore = !fromTo || change.affectedSurfaces.some((surface) => !WAS_NOW_SURFACES.has(surface));
          return (
            <li key={change.id} className="dayboard-change">
              <p className="dayboard-change-title">
                {change.title}<span className="dayboard-change-when"> · {changeWhen(Date.parse(change.createdAt), nowMs, timeZone)}</span>
              </p>
              {saysMore && <p className="dayboard-change-summary">{change.summary}</p>}
              {fromTo && (
                <dl className="dayboard-change-fromto">
                  <div><dt>Was</dt><dd>{change.beforeSummary}</dd></div>
                  <div><dt>Now</dt><dd>{change.afterSummary}</dd></div>
                </dl>
              )}
            </li>
          );
        })}
      </ol>
      {onAcknowledge !== null && (
        <button
          type="button"
          className="dayboard-seen-button is-primary dayboard-changes-ack"
          aria-busy={sending}
          disabled={sending}
          onClick={onAcknowledge}
        >
          {sending && <ActivityIndicator size={14} />}
          {waiting.length === 1 ? "Got it" : `Got all ${String(waiting.length)}`}
        </button>
      )}
      <p className="dayboard-changes-status" aria-live="polite">
        {failure === null ? "" : `Couldn’t send that: ${failure}. Try again.`}
      </p>
    </section>
  );
}

/** The open slot: its sheet, its event, its phases and its requests. */
export function SlotDetail({ slot, room, venueSlug, timeZone, slotRequests: SlotRequests, observations, onClose, closeLabel, changes = null, nowMs = Date.now(), onAcknowledge = null, acknowledging = false, acknowledgeFailure = null }: {
  readonly slot: DayBoardSlot;
  readonly room: { readonly id: string; readonly name: string; readonly slug: string };
  readonly venueSlug: string | null;
  readonly timeZone: string;
  readonly slotRequests: SlotRequestsComponent | null;
  /** Null where nothing may be recorded (the wall, a visitor). */
  readonly observations: SlotObservationsApi | null;
  readonly onClose: () => void;
  /** What closing does, in words: back to the requests, or back to the room. */
  readonly closeLabel: string;
  /** What changed on the slot's event since the floor last looked. */
  readonly changes?: EventAwaitingAcknowledgement | null;
  readonly nowMs?: number;
  /** Acknowledge the waiting changes for the floor; null where none may. */
  readonly onAcknowledge?: (() => void) | null;
  readonly acknowledging?: boolean;
  readonly acknowledgeFailure?: string | null;
}): ReactElement {
  const occasion = occasionLabel(slot.eventType);
  const photo = venueSlug === null ? null : roomPhoto(venueSlug, room.slug);
  // One tap at a time; the words say what happened to it (S5, D10).
  const [busy, setBusy] = useState<ObservationKind | null>(null);
  const [seenLine, setSeenLine] = useState<string | null>(null);
  const actionsRef = useRef<HTMLDivElement>(null);
  const seenRef = useRef<HTMLElement>(null);
  const settledRef = useRef(false);
  const tap = useCallback((kind: ObservationKind): void => {
    if (observations === null || busy !== null) return;
    setBusy(kind);
    setSeenLine(seenStatus(kind, "sending"));
    observations.record(slot.bookingId, kind)
      .then((outcome) => { setSeenLine(seenStatus(kind, outcome)); })
      .catch((err: unknown) => { setSeenLine(seenStatus(kind, err instanceof Error ? err : new Error("the server refused it"))); })
      .finally(() => { settledRef.current = true; setBusy(null); });
  }, [observations, slot.bookingId, busy]);
  // The tapped button leaves with its fact; if that dropped the keyboard's
  // place to the document, it is kept on the next fact to record, or on the
  // section when there is none left. A place moved elsewhere meanwhile stays.
  useEffect(() => {
    if (busy !== null || !settledRef.current) return;
    settledRef.current = false;
    const active = document.activeElement;
    if (active !== null && active !== document.body) return;
    const next = actionsRef.current?.querySelector("button");
    if (next instanceof HTMLButtonElement) next.focus();
    else seenRef.current?.focus();
  }, [busy]);
  const nextKinds = nextObservationKinds(slot.observed?.kind ?? null);
  // A change waiting to be read takes the panel's one cream button.
  const changeFirst = onAcknowledge !== null && (changes?.changes.length ?? 0) > 0;
  const waitingHere = observations?.pendingByBooking.get(slot.bookingId) ?? 0;
  // The latest fact stands as this device's own until the server lists it.
  const latestWaiting = slot.observed !== null && observations !== null
    && observations.observations.some((fact) => fact.bookingId === slot.bookingId && isQueuedObservation(fact) && Date.parse(fact.observedAt) === slot.observed?.atMs);
  const latest: ReactElement | string = slot.observed !== null
    ? `${slot.observed.line}${slot.observed.actorName === null ? "" : ` · ${slot.observed.actorName}`}${latestWaiting ? " · waiting to send" : ""}`
    : observations?.status === "loading"
      ? <ActivityStatus>Reading what the room was seen doing…</ActivityStatus>
      : observations?.status === "failed"
        ? "What the room was seen doing could not be read."
        : "Nothing recorded for this room yet.";
  return (
    <section
      className={`dayboard-detail dayboard-tone-${slot.tone}`}
      aria-label={`${room.name}: ${slot.title}`}
      data-state={slot.state}
      data-register="forest"
    >
      <div className="dayboard-detail-bar">
        <p className="dayboard-detail-room">{room.name} · {slot.timeRange}</p>
        <button type="button" className="dayboard-detail-close" onClick={onClose} aria-label={closeLabel}>
          <X size={16} aria-hidden="true" />Close
        </button>
      </div>
      {photo !== null && (
        <div className="dayboard-detail-photo">
          <img src={photo.src} srcSet={photo.srcSet} sizes="(max-width: 760px) 100vw, 540px" alt="" decoding="async" style={{ objectPosition: photo.objectPosition }} />
        </div>
      )}
      <h2 className="dayboard-detail-title">{slot.title}</h2>
      <p className="dayboard-detail-status">
        <span className="dayboard-detail-verb" data-tone={slot.tone}>
          <span className="dayboard-dot" aria-hidden="true" />
          <StateIcon icon={slot.icon} size={14} />
          {slot.countdown}
        </span>
      </p>
      {/* The state is on the tag above; the line says what the booking is. */}
      <p className="dayboard-slot-meta">
        {slot.bookingLabel}{occasion === null ? "" : ` · ${occasion}`}{slot.guestCount === null ? "" : ` · ${String(slot.guestCount)} guests`}
      </p>
      {slot.exceptionDetail !== null ? (
        <p className="dayboard-slot-alert" role="alert">{slot.exceptionDetail}</p>
      ) : null}
      {slot.turnaroundWarning !== null ? (
        <p className="dayboard-slot-warning">{slot.turnaroundWarning}</p>
      ) : null}
      {changes !== null && (
        <WhatChanged
          changes={changes}
          timeZone={timeZone}
          nowMs={nowMs}
          onAcknowledge={onAcknowledge}
          sending={acknowledging}
          failure={acknowledgeFailure}
        />
      )}
      {/* What the room was seen doing (S5): the latest fact, and the next
          facts a hallkeeper may record from here. Facts never move a time. */}
      <section ref={seenRef} className="dayboard-seen dayboard-detail-section" aria-label="What the room is doing" tabIndex={-1}>
        <h3 className="dayboard-detail-heading">What the room is doing</h3>
        <p className="dayboard-seen-latest">{latest}</p>
        {observations !== null && nextKinds.length > 0 && (
          <div ref={actionsRef} className="dayboard-seen-actions" role="group" aria-label="Record what the room is doing">
            {nextKinds.map((kind, index) => (
              <button
                key={kind}
                type="button"
                className={`dayboard-seen-button${index === 0 && !changeFirst ? " is-primary" : ""}`}
                aria-busy={busy === kind}
                disabled={busy !== null && busy !== kind}
                onClick={() => { tap(kind); }}
              >
                {busy === kind && <ActivityIndicator size={14} />}
                {describeObservationKind(kind)}
              </button>
            ))}
          </div>
        )}
        {waitingHere > 0 && (
          <p className="dayboard-seen-pending">
            {waitingHere === 1 ? "One tap for this room waiting to send." : `${String(waitingHere)} taps for this room waiting to send.`}
          </p>
        )}
        <p className="dayboard-seen-status" aria-live="polite">{seenLine ?? ""}</p>
      </section>
      <div className="dayboard-detail-section">
        <h3 className="dayboard-detail-heading">Setup</h3>
        <SlotSheetLink eventId={slot.eventId} bookingKind={slot.kind} roomSlug={room.slug} roomName={room.name} timeZone={timeZone} />
        {slot.eventId !== null && <Link className="dayboard-open-event" to={`/ops/events/${slot.eventId}`}>Open event &amp; working documents →</Link>}
        {slot.phases.length > 0 && <ol className="dayboard-phases" aria-label="Planned event phases">
          {slot.phases.map((phase, index) => <li key={phase.id} data-colour={index % 6}>
            <strong>{phase.name}</strong><span>{formatWallTime(Date.parse(phase.startsAt), timeZone)} – {formatWallTime(Date.parse(phase.endsAt), timeZone)}</span>
          </li>)}
        </ol>}
      </div>
      {/* Lane 9's mount point. Reserved region, props only; the board never
          reads or writes request state. Its cards were drawn for paper, so
          they sit on an ivory slip. */}
      <div className="dayboard-slot-requests" data-register="ivory" data-slot-requests={slot.bookingId}>
        {SlotRequests !== null && (
          <SlotRequests
            bookingId={slot.bookingId}
            eventId={slot.eventId}
            roomId={room.id}
            roomName={room.name}
            startsAtMs={slot.startsAtMs}
            endsAtMs={slot.endsAtMs}
          />
        )}
      </div>
    </section>
  );
}
