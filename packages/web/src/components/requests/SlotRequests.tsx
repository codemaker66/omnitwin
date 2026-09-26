import { useMemo, useState, type ReactElement } from "react";
import {
  REQUEST_KINDS,
  REQUEST_URGENCIES,
  describeRequestKind,
  describeRequestState,
  describeRequestUrgency,
  nextRequestState,
  type RequestKind,
  type RequestOutcome,
  type RequestUrgency,
  type VenueRequest,
} from "@omnitwin/types";
import type { SlotRequestsProps } from "../../pages/hallkeeper/DayBoardPage.js";
import {
  deriveSlotRequestSignal,
  type DayBoardSlotRequest,
} from "../../pages/hallkeeper/lib/day-board-state.js";
import { ActivityIndicator, ActivityStatus } from "../shared/Activity.js";
import { useSlotRequests } from "./requests-context.js";
import "./slot-requests.css";

// ---------------------------------------------------------------------------
// The request slab on a Day Board slot (Ship Friday slice 10, gate line 22).
//
// What somebody standing in the room asked for, on the card for that room, on
// every other phone within a second. Three things it is careful about:
//
//   ONE PULSE, THEN A STEADY DOT. The pulse is a CSS animation that runs once
//   when the dot MOUNTS — a new arrival is a new element (the key is the
//   newest request's id), so "once per arrival" is structural rather than a
//   timer somebody has to remember to stop. Whether the newest arrival is
//   still fresh is decided by the pure day-board derivation, so the board,
//   the slab and the tests agree.
//
//   NO CONFIRMATION DIALOGS, NO SOUND. Every action is one press on the slab
//   itself: "Seen", "I'll do it", and how it finished.
//
//   THE WORDS CARRY THE MEANING. Under reduced motion the pulse simply does
//   not happen and nothing is lost: the summary line says what is waiting.
// ---------------------------------------------------------------------------

const RESOLUTIONS: readonly { readonly outcome: RequestOutcome; readonly label: string }[] = [
  { outcome: "done", label: "Done" },
  { outcome: "not_possible", label: "Could not" },
  { outcome: "no_longer_needed", label: "Not needed" },
];

const COUNTABLE_KINDS: readonly RequestKind[] = ["refreshments", "av", "other"];

function toBoardRequest(request: VenueRequest): DayBoardSlotRequest {
  return {
    id: request.id,
    bookingId: request.bookingId,
    kind: request.kind,
    quantity: request.quantity,
    urgency: request.urgency,
    state: request.state,
    createdAt: request.createdAt,
  };
}

/** "just now", "4 minutes ago", "an hour ago" — never a clock time the reader
 *  has to subtract from. */
function howLongAgo(iso: string, nowMs: number): string {
  const minutes = Math.floor((nowMs - Date.parse(iso)) / 60_000);
  if (!Number.isFinite(minutes) || minutes < 1) return "just now";
  if (minutes === 1) return "a minute ago";
  if (minutes < 60) return `${String(minutes)} minutes ago`;
  const hours = Math.round(minutes / 60);
  return hours === 1 ? "an hour ago" : `${String(hours)} hours ago`;
}

function whatWasAsked(request: VenueRequest): string {
  return request.quantity === null
    ? describeRequestKind(request.kind)
    : `${describeRequestKind(request.kind)} × ${String(request.quantity)}`;
}

function RequestCard({ request, nowMs }: {
  readonly request: VenueRequest;
  readonly nowMs: number;
}): ReactElement {
  const { move, busyId, error } = useSlotRequests();
  const busy = busyId === request.id;
  const canAcknowledge = nextRequestState(request.state, "acknowledged").ok;
  const canAccept = nextRequestState(request.state, "accepted").ok;
  const [finishing, setFinishing] = useState(false);

  return (
    <li className="vv-request" data-urgency={request.urgency} data-state={request.state}>
      <p className="vv-request-what">
        {whatWasAsked(request)}
        {request.urgency === "now" && request.state === "sent"
          ? <span className="vv-request-urgent">{describeRequestUrgency(request.urgency)}</span>
          : null}
      </p>
      <p className="vv-request-who">
        {request.requestedByName} · {howLongAgo(request.createdAt, nowMs)}
        {request.state === "sent" ? null : <> · {describeRequestState(request.state)}</>}
        {request.ownerName === null ? null : <> · {request.ownerName}</>}
      </p>
      {request.detail === null ? null : <p className="vv-request-detail">{request.detail}</p>}

      <div className="vv-request-actions">
        {busy ? (
          <ActivityStatus>Sending…</ActivityStatus>
        ) : (
          <>
            {canAcknowledge && (
              <button
                type="button"
                className="vv-request-action"
                onClick={() => { move(request, { to: "acknowledged" }); }}
              >
                Seen
              </button>
            )}
            {canAccept && (
              <button
                type="button"
                className="vv-request-action vv-request-action--take"
                onClick={() => { move(request, { to: "accepted" }); }}
              >
                I’ll do it
              </button>
            )}
            {finishing ? (
              RESOLUTIONS.map((resolution) => (
                <button
                  key={resolution.outcome}
                  type="button"
                  className="vv-request-action"
                  onClick={() => {
                    setFinishing(false);
                    move(request, { to: "resolved", outcome: resolution.outcome });
                  }}
                >
                  {resolution.label}
                </button>
              ))
            ) : (
              <button
                type="button"
                className="vv-request-action"
                onClick={() => { setFinishing(true); }}
              >
                Finish
              </button>
            )}
          </>
        )}
      </div>
      {error !== null && busyId === null ? <p className="vv-request-error" role="alert">{error}</p> : null}
    </li>
  );
}

function Composer({ slot, onClose }: {
  readonly slot: SlotRequestsProps;
  readonly onClose: () => void;
}): ReactElement {
  const { ask, asking } = useSlotRequests();
  const [kind, setKind] = useState<RequestKind>("refreshments");
  const [urgency, setUrgency] = useState<RequestUrgency>("soon");
  const [quantity, setQuantity] = useState("");
  const [detail, setDetail] = useState("");

  const countable = COUNTABLE_KINDS.includes(kind);
  const parsedQuantity = Number.parseInt(quantity, 10);

  return (
    <form
      className="vv-request-composer"
      onSubmit={(event) => {
        event.preventDefault();
        ask(slot, {
          kind,
          urgency,
          quantity: countable && Number.isFinite(parsedQuantity) && parsedQuantity > 0
            ? parsedQuantity
            : null,
          detail: detail.trim() === "" ? null : detail.trim(),
        });
        onClose();
      }}
    >
      <fieldset className="vv-request-choices">
        <legend>What do you need?</legend>
        {REQUEST_KINDS.map((option) => (
          <button
            key={option}
            type="button"
            className="vv-request-choice"
            aria-pressed={kind === option}
            onClick={() => { setKind(option); }}
          >
            {describeRequestKind(option)}
          </button>
        ))}
      </fieldset>

      <fieldset className="vv-request-choices">
        <legend>How soon?</legend>
        {REQUEST_URGENCIES.map((option) => (
          <button
            key={option}
            type="button"
            className="vv-request-choice"
            aria-pressed={urgency === option}
            onClick={() => { setUrgency(option); }}
          >
            {describeRequestUrgency(option)}
          </button>
        ))}
      </fieldset>

      {countable && (
        <label className="vv-request-field">
          How many
          <input
            type="number"
            min={1}
            max={999}
            inputMode="numeric"
            value={quantity}
            onChange={(event) => { setQuantity(event.target.value); }}
          />
        </label>
      )}

      <label className="vv-request-field">
        Anything to add
        <input
          type="text"
          maxLength={500}
          value={detail}
          placeholder={`For ${slot.roomName}`}
          onChange={(event) => { setDetail(event.target.value); }}
        />
      </label>

      <div className="vv-request-actions">
        <button type="submit" className="vv-request-action vv-request-action--take" disabled={asking}>
          {asking ? <ActivityIndicator size={16} /> : null}
          {asking ? "Sending…" : "Send it"}
        </button>
        <button type="button" className="vv-request-action" onClick={onClose}>Not now</button>
      </div>
    </form>
  );
}

/**
 * The Day Board's request region for one slot. Rendered inside Lane 6's
 * reserved mount point; props only, and it never calls back into the board.
 */
export function SlotRequests(props: SlotRequestsProps): ReactElement | null {
  const { requestsFor, status, nowMs } = useSlotRequests();
  const [composing, setComposing] = useState(false);
  const requests = requestsFor(props.bookingId);

  const signal = useMemo(
    () => deriveSlotRequestSignal(requests.map(toBoardRequest), nowMs),
    [requests, nowMs],
  );

  // Nothing to say yet and nothing being written: the region stays empty, so
  // the board shows no chrome for a feature the slot is not using.
  if (status === "loading" && requests.length === 0 && !composing) return null;

  return (
    <section className="vv-requests" aria-label={`Requests for ${props.roomName}`}>
      {signal === null ? null : (
        <p className="vv-requests-summary" data-urgent={signal.urgent} aria-live="polite">
          <span
            key={signal.newestId ?? "steady"}
            className="vv-requests-dot"
            data-motion={signal.motion}
            aria-hidden="true"
          />
          {signal.label}
        </p>
      )}

      {requests.length > 0 && (
        <ul className="vv-request-list">
          {requests.map((request) => (
            <RequestCard key={request.id} request={request} nowMs={nowMs} />
          ))}
        </ul>
      )}

      {composing
        ? <Composer slot={props} onClose={() => { setComposing(false); }} />
        : (
          <button type="button" className="vv-request-ask" onClick={() => { setComposing(true); }}>
            Ask for something
          </button>
        )}
    </section>
  );
}

export default SlotRequests;
