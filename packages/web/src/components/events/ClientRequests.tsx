import { useEffect, useMemo, useRef, useState, type ReactElement } from "react";
import {
  COUNTABLE_REQUEST_KINDS,
  REQUEST_KINDS,
  REQUEST_URGENCIES,
  describeRequestKind,
  describeRequestOutcome,
  describeRequestUrgency,
  type ClientEventScheduleSlot,
  type Message,
  type RequestKind,
  type RequestUrgency,
  type VenueRequest,
} from "@omnitwin/types";
import { ApiError } from "../../api/client.js";
import { createEventRequest } from "../../api/conversations.js";
import { useEventConversation } from "../../hooks/use-event-conversation.js";
import { useEventRequests } from "../../hooks/use-event-requests.js";
import { mintRequestKey } from "../requests/requests-context.js";
import { ActivityIndicator, ActivityStatus } from "../shared/Activity.js";
import "./client-requests.css";

// ---------------------------------------------------------------------------
// The client's requests on their event page (goal 19 S4; D4, D5, D6).
//
// "We need ten more chairs" in one gesture: what, how many, how soon, on the
// slot the house holds for them, prefilled to the one that is live or next.
// The ask lands on the slot's slab within a second for the house; the client
// sees the honest state the house moves it to, on the five-second poll: sent
// and waiting, then "Elaine has seen this.", "Elaine has this.", "Elaine is on
// it.", then the outcome, each in the words the house's own step recorded.
// Nothing here changes a time, a layout or stock; a quantity beyond the
// release is a request the office decides.
//
// Honest states: "Sending…" while the request travels, then the true one.
// Offline keeps the draft and its key, so "Send again" replays the same
// request rather than making a second. A revoked link closes the composer and
// the reads the same instant, with one plain sentence.
// ---------------------------------------------------------------------------

export const SENT_WAITING = "Sent · waiting for the house";
export const OFFLINE_NOT_SENT = "Not sent — you’re offline. Your request is kept here; send it again when you’re back.";
export const LINK_REVOKED = "This event is no longer linked to your account.";

const COUNTABLE: readonly RequestKind[] = COUNTABLE_REQUEST_KINDS;

export interface ClientRequestsProps {
  readonly eventId: string;
  /** The event's live bookings, from the schedule the page already read. */
  readonly slots: readonly ClientEventScheduleSlot[];
  readonly timeZone: string;
  /** Test seam: the poll cadence. */
  readonly pollMs?: number;
}

function whatWasAsked(request: { readonly kind: RequestKind; readonly quantity: number | null }): string {
  return request.quantity === null
    ? describeRequestKind(request.kind)
    : `${describeRequestKind(request.kind)} × ${String(request.quantity)}`;
}

/** "Grand Hall · Sat 10 Oct · 12:00–16:00", venue-local. */
export function slotLabel(slot: ClientEventScheduleSlot, timeZone: string): string {
  const day = new Intl.DateTimeFormat("en-GB", { timeZone, weekday: "short", day: "numeric", month: "short" });
  const time = new Intl.DateTimeFormat("en-GB", { timeZone, hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
  const start = new Date(slot.startsAt);
  const end = new Date(slot.endsAt);
  return `${slot.space.name} · ${day.format(start)} · ${time.format(start)}–${time.format(end)}`;
}

/** The slot to prefill: the one that is live, else the next to come, else
 *  the last one held. Null when the house holds none. */
export function preferredSlot(slots: readonly ClientEventScheduleSlot[], nowMs: number): ClientEventScheduleSlot | null {
  const live = slots.find((slot) => Date.parse(slot.startsAt) <= nowMs && nowMs < Date.parse(slot.endsAt));
  if (live !== undefined) return live;
  const upcoming = slots
    .filter((slot) => Date.parse(slot.startsAt) > nowMs)
    .sort((left, right) => Date.parse(left.startsAt) - Date.parse(right.startsAt))[0];
  if (upcoming !== undefined) return upcoming;
  const last = [...slots].sort((left, right) => Date.parse(right.startsAt) - Date.parse(left.startsAt))[0];
  return last ?? null;
}

/** What the client reads under their ask: the house's latest step, in the
 *  words the step itself recorded; before any step, that it is sent. */
export function statusLine(request: VenueRequest, messages: readonly Message[]): string {
  const steps = messages.filter((message) => message.threadId === request.threadId && message.kind === "system");
  const latest = steps[steps.length - 1];
  if (latest !== undefined) return latest.body;
  if (request.state === "resolved" && request.outcome !== null) {
    return request.outcomeNote === null ? `${describeRequestOutcome(request.outcome)}.` : `${describeRequestOutcome(request.outcome)}: ${request.outcomeNote}`;
  }
  if (request.ownerName !== null && (request.state === "accepted" || request.state === "underway")) {
    return request.state === "underway" ? `${request.ownerName} is on it.` : `${request.ownerName} has this.`;
  }
  return SENT_WAITING;
}

function isOffline(cause: unknown): boolean {
  if (typeof navigator !== "undefined" && !navigator.onLine) return true;
  return cause instanceof ApiError && cause.code === "NETWORK_ERROR";
}

function Composer({ eventId, slots, timeZone, closed, onMade, onClose }: {
  readonly eventId: string;
  readonly slots: readonly ClientEventScheduleSlot[];
  readonly timeZone: string;
  readonly closed: boolean;
  readonly onMade: (request: VenueRequest) => void;
  readonly onClose: () => void;
}): ReactElement {
  const [kind, setKind] = useState<RequestKind>("chairs");
  const [urgency, setUrgency] = useState<RequestUrgency>("soon");
  const [quantity, setQuantity] = useState("");
  const [detail, setDetail] = useState("");
  const [bookingId, setBookingId] = useState(() => preferredSlot(slots, Date.now())?.bookingId ?? "");
  // One key per draft: a resend after a failure, or after being offline, is
  // the same request to the house.
  const [idempotencyKey, setIdempotencyKey] = useState(mintRequestKey);
  const [sending, setSending] = useState(false);
  const [failure, setFailure] = useState<{ readonly offline: boolean; readonly message: string } | null>(null);
  const countable = COUNTABLE.includes(kind);
  const parsedQuantity = Number.parseInt(quantity, 10);
  const slot = slots.find((candidate) => candidate.bookingId === bookingId) ?? null;

  return (
    <form
      className="client-request-composer"
      aria-label="Ask the house for something"
      onSubmit={(event) => {
        event.preventDefault();
        if (sending || closed || slot === null) return;
        setSending(true);
        setFailure(null);
        void createEventRequest(eventId, {
          bookingId: slot.bookingId,
          kind,
          urgency,
          quantity: countable && Number.isFinite(parsedQuantity) && parsedQuantity > 0 ? parsedQuantity : null,
          detail: detail.trim() === "" ? null : detail.trim(),
          idempotencyKey,
        })
          .then((made) => {
            onMade(made);
            setIdempotencyKey(mintRequestKey());
            onClose();
          })
          .catch((cause: unknown) => {
            setFailure(isOffline(cause)
              ? { offline: true, message: OFFLINE_NOT_SENT }
              : { offline: false, message: cause instanceof Error && cause.message !== "" ? cause.message : "That could not be sent — try again in a moment." });
          })
          .finally(() => { setSending(false); });
      }}
    >
      <fieldset className="client-request-choices">
        <legend>What do you need?</legend>
        {REQUEST_KINDS.map((option) => (
          <button key={option} type="button" className="client-request-choice" aria-pressed={kind === option} onClick={() => { setKind(option); }}>
            {describeRequestKind(option)}
          </button>
        ))}
      </fieldset>

      {countable && (
        <label className="client-request-field client-request-field--number">
          How many
          <input type="number" min={1} max={999} inputMode="numeric" value={quantity} onChange={(event) => { setQuantity(event.target.value); }} />
        </label>
      )}

      <fieldset className="client-request-choices">
        <legend>How soon?</legend>
        {REQUEST_URGENCIES.map((option) => (
          <button key={option} type="button" className="client-request-choice" aria-pressed={urgency === option} onClick={() => { setUrgency(option); }}>
            {describeRequestUrgency(option)}
          </button>
        ))}
      </fieldset>

      <label className="client-request-field">
        Room and time
        <select value={bookingId} onChange={(event) => { setBookingId(event.target.value); }}>
          {slots.map((candidate) => (
            <option key={candidate.bookingId} value={candidate.bookingId}>{slotLabel(candidate, timeZone)}</option>
          ))}
        </select>
      </label>

      <label className="client-request-field">
        Anything to add
        <input type="text" maxLength={500} value={detail} onChange={(event) => { setDetail(event.target.value); }} />
      </label>

      <div className="client-request-actions">
        <button type="submit" className="client-event-button client-request-send" disabled={sending || closed || slot === null} aria-busy={sending}>
          {sending ? <ActivityIndicator size={16} /> : null}
          {sending ? "Sending…" : failure?.offline === true ? "Send again" : "Send it"}
        </button>
        <button type="button" className="client-event-button client-request-cancel" onClick={onClose}>Not now</button>
      </div>
      {failure !== null && !sending && <p className="client-request-error" role="alert">{failure.message}</p>}
    </form>
  );
}

export function ClientRequests({ eventId, slots, timeZone, pollMs }: ClientRequestsProps): ReactElement {
  const pollOptions = pollMs === undefined ? {} : { pollMs };
  const conversation = useEventConversation(eventId, pollOptions);
  const requests = useEventRequests(eventId, pollOptions);
  const [composing, setComposing] = useState(false);
  const closed = conversation.closed || requests.closed;
  const [announcement, setAnnouncement] = useState("");
  const spoken = useRef<ReadonlyMap<string, string> | null>(null);

  const lines = useMemo(
    () => new Map(requests.requests.map((request) => [request.id, statusLine(request, conversation.messages)])),
    [requests.requests, conversation.messages],
  );

  // Said once per change, never per poll: a step the house took since the
  // last reading is announced, politely, in its own words.
  useEffect(() => {
    const previous = spoken.current;
    spoken.current = lines;
    if (previous === null) return;
    for (const request of requests.requests) {
      const line = lines.get(request.id);
      if (line !== undefined && previous.has(request.id) && previous.get(request.id) !== line) {
        setAnnouncement(`${whatWasAsked(request)}: ${line}`);
        return;
      }
    }
  }, [lines, requests.requests]);

  return (
    <section className="client-requests" aria-label="Requests">
      <h2>Requests</h2>
      <p className="client-event-disclosure">
        Ask the house for something on the day: more chairs, the sound, the room temperature. It reaches the team on
        the floor within a second, and you will see who has it.
      </p>

      {closed ? (
        <p className="client-request-closed" role="alert">{LINK_REVOKED}</p>
      ) : null}

      {!closed && slots.length === 0 && (
        <p className="client-event-empty">The house has not held a slot for this event yet, so there is nothing to ask about.</p>
      )}

      {/* A revoked link does not take the composer away mid-sentence: it
          stays, with Send it refused, under the one sentence that says why. */}
      {slots.length > 0 && (composing
        ? (
          <Composer
            eventId={eventId}
            slots={slots}
            timeZone={timeZone}
            closed={closed}
            onMade={requests.merge}
            onClose={() => { setComposing(false); }}
          />
        )
        : (
          <button type="button" className="client-event-button" disabled={closed} onClick={() => { setComposing(true); }}>Ask for something</button>
        ))}

      {requests.status === "loading" && requests.requests.length === 0 && !closed && (
        <ActivityStatus>Reading your requests…</ActivityStatus>
      )}
      {requests.status === "error" && !closed && requests.error !== null && (
        <p className="client-request-error" role="alert">{requests.error}</p>
      )}

      {requests.requests.length > 0 && (
        <ul className="client-request-list" aria-label="Your requests">
          {requests.requests.map((request) => (
            <li key={request.id} className="client-request" data-state={request.state}>
              <p className="client-request-what">
                {whatWasAsked(request)}
                {request.roomName !== null && <span className="client-request-where"> · {request.roomName}</span>}
              </p>
              <p className="client-request-status">{lines.get(request.id) ?? SENT_WAITING}</p>
              {request.detail !== null && <p className="client-request-detail">{request.detail}</p>}
            </li>
          ))}
        </ul>
      )}
      <span className="client-request-announcer" role="status" aria-live="polite">{announcement}</span>
    </section>
  );
}

export default ClientRequests;
