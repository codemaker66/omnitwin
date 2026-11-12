import { useCallback, useEffect, useRef, useState, type ReactElement } from "react";
import { Link } from "react-router-dom";
import { Check, X } from "lucide-react";
import {
  describeObservationKind,
  nextObservationKinds,
  occasionLabel,
  type EventAwaitingAcknowledgement,
  type HallkeeperSheetSummary,
  type ObservationKind,
} from "@omnitwin/types";
import { getSheetSummary } from "../../api/hallkeeper-summary.js";
import { formatWallTime } from "../diary/lib/board-time.js";
import { ActivityIndicator, ActivityStatus } from "../../components/shared/Activity.js";
import { roomPhoto } from "../../components/dashboard/enquiries/enquiry-room-photo.js";
import { isQueuedObservation, type RecordOutcome, type SlotObservationsApi } from "./lib/use-slot-observations.js";
import { sheetProgressLine } from "./lib/day-board-sheet.js";
import { useSlotSheet, type SlotSheetResult } from "./lib/use-slot-sheet.js";
import type { DayBoardSlot } from "./lib/day-board-state.js";
import type { SlotRequestsComponent } from "./lib/slot-requests-contract.js";
import { StateIcon } from "./DayBoardRooms.js";
import { ChangeoverSection } from "./DayBoardChangeover.js";
import { ChangeList, changeWhen, gotItLabel } from "./DayBoardChanges.js";

// ---------------------------------------------------------------------------
// The open slot, on the forest decision panel the desks use: the room's
// photograph, the function, where it stands, what changed since the floor
// last looked (with one "Got it"), what the room was seen doing and the next
// fact to record (the first offered as the panel's one primary button, unless
// a change waits to be read), the setup sheet and how far it has got, the
// event, its phases and the requests made against it. The requests surface is Lane 9's and was
// drawn for paper, so it sits on an ivory slip laid on the forest.
// ---------------------------------------------------------------------------

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

function SlotSheetLink({ result, roomName, timeZone }: {
  /** The slot's layouts, read once by the panel. */
  readonly result: SlotSheetResult;
  readonly roomName: string;
  readonly timeZone: string;
}): ReactElement {
  // Every state below is this one box, so Try again, which leaves the page
  // while the link is checked again, hands focus here rather than to the page.
  const box = useRef<HTMLDivElement>(null);
  const retry = (): void => {
    box.current?.focus();
    result.retry();
  };

  if (result.status === "loading") {
    return (
      <div className="dayboard-slot-sheet" ref={box} tabIndex={-1}>
        <ActivityStatus>Finding this room’s setup sheet…</ActivityStatus>
      </div>
    );
  }

  if (result.status === "error" || result.state === null) {
    return (
      <div className="dayboard-slot-sheet" ref={box} tabIndex={-1}>
        <p className="dayboard-slot-sheet-note">{result.error ?? "The setup sheet link could not be checked."}</p>
        <button type="button" className="dayboard-seen-button" onClick={retry} aria-label="Try again to check the setup sheet link">Try again</button>
      </div>
    );
  }

  const state = result.state;
  return (
    <div className="dayboard-slot-sheet" ref={box} tabIndex={-1}>
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

/** Who last acknowledged a change here, while it is still today's news. */
const SEEN_BY_FOR_MS = 12 * 60 * 60 * 1000;

/**
 * What changed on the slot since the floor last looked: each change with its
 * words before and after, and one "Got it" for all of them, which puts them in
 * hand for the whole floor. With nothing waiting, who last acknowledged a
 * change to the event, said of the event: the change may have been another
 * room's.
 */
function WhatChanged({ changes, timeZone, nowMs, onAcknowledge, sending, note, unread }: {
  readonly changes: EventAwaitingAcknowledgement;
  /** The last read of what changed failed: what shows is as last read. */
  readonly unread: boolean;
  readonly timeZone: string;
  readonly nowMs: number;
  /** Null where nothing may be acknowledged (the wall, a role that only reads). */
  readonly onAcknowledge: (() => void) | null;
  readonly sending: boolean;
  /** What the last Got it here came to, when that needs saying. */
  readonly note: string | null;
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
  const unreadLine = unread
    ? <p className="dayboard-changes-unread">What changed could not be read just now; this is as last read.</p>
    : null;
  if (waiting.length === 0) {
    const last = changes.lastAcknowledgement;
    if (last === null || nowMs - Date.parse(last.at) > SEEN_BY_FOR_MS) return unreadLine;
    return (
      <p ref={seenRef} className="dayboard-changes-seen" tabIndex={-1}>
        {last.by} last acknowledged a change to this event, {changeWhen(Date.parse(last.at), nowMs, timeZone)}.
      </p>
    );
  }
  return (
    <section className="dayboard-changes dayboard-detail-section" aria-label="What changed">
      <h3 className="dayboard-detail-heading">What changed</h3>
      <ChangeList changes={waiting} timeZone={timeZone} nowMs={nowMs} />
      {onAcknowledge !== null && (
        // Never disabled: a disabled button drops the keyboard's place to the
        // page, and on a failed send nothing would bring it back.
        <button
          type="button"
          className="dayboard-seen-button is-primary dayboard-changes-ack"
          aria-busy={sending}
          aria-disabled={sending}
          onClick={() => { if (!sending) onAcknowledge(); }}
        >
          {sending && <ActivityIndicator size={14} />}
          {gotItLabel(waiting.length)}
        </button>
      )}
      <p className="dayboard-changes-status" aria-live="polite">{note ?? ""}</p>
      {unreadLine}
    </section>
  );
}

/** The open slot: its sheet, its event, its phases and its requests. */
export function SlotDetail({ slot, room, venueSlug, timeZone, slotRequests: SlotRequests, observations, onClose, closeLabel, changes = null, nowMs = Date.now(), onAcknowledge = null, acknowledging = false, acknowledgeNote = null, changesUnread = false, previous = null }: {
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
  /** What changed on the slot since the floor last looked, and who last
   *  acknowledged a change to its event. */
  readonly changes?: EventAwaitingAcknowledgement | null;
  readonly nowMs?: number;
  /** Acknowledge the waiting changes for the floor; null where none may. */
  readonly onAcknowledge?: (() => void) | null;
  /** This slot's Got it is being sent. */
  readonly acknowledging?: boolean;
  /** What this slot's last Got it came to, when that needs saying. */
  readonly acknowledgeNote?: string | null;
  /** The last read of what changed failed. */
  readonly changesUnread?: boolean;
  /** The booking this one's turn-round runs from, when there is one. */
  readonly previous?: DayBoardSlot | null;
}): ReactElement {
  const occasion = occasionLabel(slot.eventType);
  // The slot's layouts, read once: the sheet link and the changeover share them.
  const sheet = useSlotSheet(slot.eventId, room.slug, room.name, slot.kind);
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
      {changes !== null ? (
        <WhatChanged
          changes={changes}
          timeZone={timeZone}
          nowMs={nowMs}
          onAcknowledge={onAcknowledge}
          sending={acknowledging}
          note={acknowledgeNote}
          unread={changesUnread}
        />
      ) : changesUnread && slot.eventId !== null ? (
        <p className="dayboard-changes-unread">What changed could not be read just now.</p>
      ) : null}
      {/* What moves from the booking before to this one, in this room. */}
      {previous !== null && <ChangeoverSection previous={previous} slot={slot} room={room} after={sheet} />}
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
        <SlotSheetLink result={sheet} roomName={room.name} timeZone={timeZone} />
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
