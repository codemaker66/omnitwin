import { useMemo, useState, type ReactElement } from "react";
import {
  COUNTABLE_REQUEST_KINDS,
  REQUEST_KINDS,
  REQUEST_URGENCIES,
  describeRequestKind,
  describeRequestState,
  describeRequestUrgency,
  isClientSideRole,
  nextRequestState,
  type RequestKind,
  type RequestOutcome,
  type RequestUrgency,
  type VenueHandler,
  type VenueRequest,
} from "@omnitwin/types";
import type { SlotRequestsProps } from "../../pages/hallkeeper/lib/slot-requests-contract.js";
import {
  deriveSlotRequestSignal,
  type DayBoardSlotRequest,
} from "../../pages/hallkeeper/lib/day-board-state.js";
import { useAuthStore } from "../../stores/auth-store.js";
import { SlotConversation } from "../conversations/SlotConversation.js";
import { ActivityIndicator, ActivityStatus } from "../shared/Activity.js";
import { mintRequestKey, useSlotRequests } from "./requests-context.js";
import "./slot-requests.css";

// ---------------------------------------------------------------------------
// The request slab on a Day Board slot (Ship Friday slice 10, gate line 22;
// goal 19 S4 adds the longer ladder and the slot's conversation).
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
//   NO CONFIRMATION DIALOGS. Every action is one press on the slab itself:
//   "Seen", "I’ll do it", "On it", "Hand over", and how it finished. Sound is
//   the chime this device opted into (arrival-chime.ts), never a surprise.
//
//   THE WORDS CARRY THE MEANING. Under reduced motion the pulse simply does
//   not happen and nothing is lost: the summary line says what is waiting.
//
// Below the cards sits the slot's conversation (SlotConversation): the floor's
// notes on the booking and the thread of every request, each with its own
// audience, so a client's words are read where the client's request is.
// ---------------------------------------------------------------------------

const RESOLUTIONS: readonly { readonly outcome: RequestOutcome; readonly label: string }[] = [
  { outcome: "done", label: "Done" },
  { outcome: "not_possible", label: "Could not" },
  { outcome: "no_longer_needed", label: "Not needed" },
];

const COUNTABLE_KINDS: readonly RequestKind[] = COUNTABLE_REQUEST_KINDS;

/** The office may step in on another person's request; the owner takes
 *  their own forward. The same "senior" rule the API applies. */
const OFFICE_ROLES: readonly string[] = ["admin", "manager", "staff"];

function messageFor(cause: unknown): string {
  return cause instanceof Error && cause.message !== "" ? cause.message : "That could not be read — try again in a moment.";
}

export function toBoardRequest(request: VenueRequest): DayBoardSlotRequest {
  return {
    id: request.id,
    bookingId: request.bookingId,
    roomId: request.roomId,
    kind: request.kind,
    quantity: request.quantity,
    urgency: request.urgency,
    state: request.state,
    ownerUserId: request.ownerUserId,
    ownerName: request.ownerName,
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
  const { move, busyId, failure, handlers } = useSlotRequests();
  const me = useAuthStore((state) => state.user);
  const meId = me?.id ?? null;
  const senior = me !== null && (OFFICE_ROLES.includes(me.role) || me.platformRole === "admin");
  const mine = request.ownerUserId !== null && request.ownerUserId === meId;
  const handedToMe = request.state === "handed-over" && request.handoverToUserId !== null && request.handoverToUserId === meId;
  const busy = busyId === request.id;
  // Only this request's own failure is said on its card.
  const failed = failure?.on === "request" && failure.requestId === request.id ? failure.message : null;
  const canAcknowledge = nextRequestState(request.state, "acknowledged").ok;
  // A handover in flight is for the person it was handed to; the ladder
  // decides the rest here, and the server decides it again.
  const canAccept = nextRequestState(request.state, "accepted").ok
    && (request.state !== "handed-over" || handedToMe || me?.platformRole === "admin");
  const canStart = nextRequestState(request.state, "underway").ok && (mine || senior);
  const canHandOver = nextRequestState(request.state, "handed-over").ok && (mine || senior);
  const canFinish = nextRequestState(request.state, "resolved").ok;
  const [finishing, setFinishing] = useState(false);
  const [substituting, setSubstituting] = useState(false);
  const [note, setNote] = useState("");
  const [handing, setHanding] = useState(false);
  const [floor, setFloor] = useState<readonly VenueHandler[] | null>(null);
  const [floorError, setFloorError] = useState<string | null>(null);
  const [target, setTarget] = useState("");
  const asker = isClientSideRole(request.requestedByRole) ? `${request.requestedByName} (client)` : request.requestedByName;
  const quiet = !handing && !finishing;

  const openHandover = (): void => {
    setFinishing(false);
    setSubstituting(false);
    setHanding(true);
    setFloorError(null);
    void handlers()
      .then((people) => { setFloor(people); })
      .catch((cause: unknown) => { setFloorError(messageFor(cause)); });
  };

  return (
    <li className="vv-request" data-urgency={request.urgency} data-state={request.state}>
      <p className="vv-request-what">
        {whatWasAsked(request)}
        {request.urgency === "now" && request.state === "sent"
          ? <span className="vv-request-urgent">{describeRequestUrgency(request.urgency)}</span>
          : null}
      </p>
      <p className="vv-request-who">
        {asker} · {howLongAgo(request.createdAt, nowMs)}
        {request.state === "sent" ? null : <> · {describeRequestState(request.state)}</>}
        {request.ownerName === null || request.state === "handed-over" ? null : <> · {request.ownerName}</>}
      </p>
      {request.state === "handed-over" && (
        <p className="vv-request-handover-note">
          {handedToMe
            ? `${request.ownerName ?? "A colleague"} handed this to you.`
            : `${request.ownerName ?? "A colleague"} is handing this to ${request.handoverToName ?? "a colleague"}.`}
        </p>
      )}
      {request.detail === null ? null : <p className="vv-request-detail">{request.detail}</p>}

      <div className="vv-request-actions">
        {busy ? (
          <ActivityStatus>Sending…</ActivityStatus>
        ) : (
          <>
            {canAcknowledge && quiet && (
              <button type="button" className="vv-request-action" onClick={() => { move(request, { to: "acknowledged" }); }}>
                Seen
              </button>
            )}
            {canAccept && quiet && (
              <button
                type="button"
                className="vv-request-action vv-request-action--take"
                onClick={() => { move(request, { to: "accepted" }); }}
              >
                I’ll do it
              </button>
            )}
            {canStart && quiet && (
              <button type="button" className="vv-request-action" onClick={() => { move(request, { to: "underway" }); }}>
                On it
              </button>
            )}
            {canHandOver && quiet && (
              <button type="button" className="vv-request-action" onClick={openHandover}>Hand over</button>
            )}
            {canFinish && quiet && (
              <button type="button" className="vv-request-action" onClick={() => { setFinishing(true); }}>Finish</button>
            )}
            {finishing && !substituting && (
              <>
                {RESOLUTIONS.map((resolution) => (
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
                ))}
                <button type="button" className="vv-request-action" onClick={() => { setSubstituting(true); }}>Done another way</button>
                <button type="button" className="vv-request-action" onClick={() => { setFinishing(false); }}>Not now</button>
              </>
            )}
          </>
        )}
      </div>

      {finishing && substituting && !busy && (
        <div className="vv-request-followup">
          <label className="vv-request-field">
            What was done instead
            <input type="text" maxLength={500} value={note} onChange={(event) => { setNote(event.target.value); }} />
          </label>
          <div className="vv-request-actions">
            <button
              type="button"
              className="vv-request-action vv-request-action--take"
              disabled={note.trim() === ""}
              onClick={() => {
                setFinishing(false);
                setSubstituting(false);
                move(request, { to: "resolved", outcome: "substituted", note: note.trim() });
              }}
            >
              Finish
            </button>
            <button type="button" className="vv-request-action" onClick={() => { setSubstituting(false); }}>Back</button>
          </div>
        </div>
      )}

      {handing && !busy && (
        <div className="vv-request-followup">
          {floor === null && floorError === null && <ActivityStatus>Finding the floor…</ActivityStatus>}
          {floorError !== null && <p className="vv-request-error" role="alert">{floorError}</p>}
          {floor !== null && (
            <label className="vv-request-field">
              Hand to
              <select value={target} onChange={(event) => { setTarget(event.target.value); }}>
                <option value="">Choose a colleague</option>
                {floor.filter((person) => person.id !== meId).map((person) => (
                  <option key={person.id} value={person.id}>{person.name}</option>
                ))}
              </select>
            </label>
          )}
          <div className="vv-request-actions">
            <button
              type="button"
              className="vv-request-action vv-request-action--take"
              disabled={target === ""}
              onClick={() => {
                setHanding(false);
                move(request, { to: "handed-over", toUserId: target });
              }}
            >
              Hand it over
            </button>
            <button type="button" className="vv-request-action" onClick={() => { setHanding(false); setFloorError(null); }}>Not now</button>
          </div>
        </div>
      )}
      {failed !== null && busyId === null ? <p className="vv-request-error" role="alert">{failed}</p> : null}
    </li>
  );
}

function Composer({ slot, onClose }: {
  readonly slot: SlotRequestsProps;
  readonly onClose: () => void;
}): ReactElement {
  const { ask, askingKeys, failure } = useSlotRequests();
  // One key per composer: pressing "Send it" again after a failure replays
  // the same request rather than making a second.
  const [idempotencyKey] = useState(mintRequestKey);
  const asking = askingKeys.has(idempotencyKey);
  // Only this composer's own failure is said here, beside its "Send it".
  const failed = failure?.on === "ask" && failure.idempotencyKey === idempotencyKey ? failure.message : null;
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
        if (asking) return;
        // The composer stays open while the request travels, so "Sending…"
        // is seen, and closes only once it is made. A failure leaves it open,
        // with what was chosen and typed, saying why and ready to send again.
        void ask(slot, {
          kind,
          urgency,
          quantity: countable && Number.isFinite(parsedQuantity) && parsedQuantity > 0
            ? parsedQuantity
            : null,
          detail: detail.trim() === "" ? null : detail.trim(),
          idempotencyKey,
        }).then((made) => { if (made) onClose(); });
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
        <button type="submit" className="vv-request-action vv-request-action--take" disabled={asking} aria-busy={asking}>
          {asking ? <ActivityIndicator size={16} /> : null}
          {asking ? "Sending…" : "Send it"}
        </button>
        <button type="button" className="vv-request-action" onClick={onClose}>Not now</button>
      </div>
      {failed === null || asking ? null : <p className="vv-request-error" role="alert">{failed}</p>}
    </form>
  );
}

/**
 * The Day Board's request region for one slot. Rendered inside Lane 6's
 * reserved mount point; props only, and it never calls back into the board.
 */
export function SlotRequests(props: SlotRequestsProps): ReactElement | null {
  const { requestsFor, status, nowMs, retry } = useSlotRequests();
  const [composing, setComposing] = useState(false);
  const [retrying, setRetrying] = useState(false);
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
      {/* A load that failed is said, never shown as a room with nothing
          asked: an empty slab would claim that nobody wants anything. */}
      {status === "error" ? (
        <div className="vv-requests-unavailable">
          {retrying ? (
            <ActivityStatus>Loading requests…</ActivityStatus>
          ) : (
            <>
              <p>This room’s requests could not be loaded just now.</p>
              <button
                type="button"
                className="vv-request-ask"
                onClick={() => {
                  setRetrying(true);
                  void retry().finally(() => { setRetrying(false); });
                }}
              >
                Try again
              </button>
            </>
          )}
        </div>
      ) : null}

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

      {/* Goal 19 S4: the slot's threads, one tab per audience. */}
      <SlotConversation bookingId={props.bookingId} roomName={props.roomName} requests={requests} />
    </section>
  );
}

export default SlotRequests;
