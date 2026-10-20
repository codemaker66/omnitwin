import { useCallback, useEffect, useId, useState, type ReactElement } from "react";
import { useParams } from "react-router-dom";
import { Phone, Printer } from "lucide-react";
import { ActivityIndicator, ActivityStatus } from "../components/shared/Activity.js";
import { ApiError } from "../api/client.js";
import {
  acknowledgeSupplierShare,
  getSupplierShare,
  type CreateSupplierAcknowledgementInput,
  type SupplierSafePackView,
} from "../api/supplier-coordination.js";
import {
  clockTime,
  dayAndTime,
  longDay,
  roomList,
  shortDay,
  updatedWords,
} from "../components/supplier-passes/supplier-pass-words.js";
import "./SupplierPortalPage.css";

// ---------------------------------------------------------------------------
// The supplier's own page (A Door for Everyone Outside, stage 1).
//
// Opened from a link a member of the venue team sent, with no account. It
// says, in the order someone needs it, the day and room, when to arrive,
// where to go, their part, and who to ask; then one main button, "I've read
// it". Nothing on it uses the venue's system words, and the name given with
// a reply is shown to the venue as given by whoever holds the link, never as
// a checked identity.
// ---------------------------------------------------------------------------

type LoadState =
  | { readonly kind: "loading" }
  /** "closed": the API said the link does not open (withdrawn, replaced,
   *  ended or never valid). "unreachable": the page could not ask, so it
   *  must not claim the link is dead. */
  | { readonly kind: "error"; readonly reason: "closed" | "unreachable" }
  | { readonly kind: "ready"; readonly pack: SupplierSafePackView };

type ReplyStatus = CreateSupplierAcknowledgementInput["status"];

type Contact = { readonly name: string; readonly phone: string | null } | null;

const DEFAULT_ZONE = "Europe/London";

function telHref(phone: string): string {
  return `tel:${phone.replace(/[^\d+]/gu, "")}`;
}

function askWords(contact: Contact): string {
  return contact === null ? "the venue team" : contact.name;
}

/** Who to turn to when a reply did not reach the venue. */
function fallbackWords(contact: Contact): string {
  if (contact === null) return ".";
  return contact.phone === null ? `, or ask for ${contact.name}.` : `, or ring ${contact.name} on ${contact.phone}.`;
}

function ChangeList({ label, items }: { readonly label: string; readonly items: readonly string[] }): ReactElement | null {
  if (items.length === 0) return null;
  return (
    <div className="supplier-pass__change">
      <h3>{label}</h3>
      <ul>{items.map((item) => <li key={item}>{item}</li>)}</ul>
    </div>
  );
}

export function SupplierPortalPage(): ReactElement {
  const { token } = useParams<{ token?: string }>();
  const questionId = useId();
  const [state, setState] = useState<LoadState>({ kind: "loading" });
  const [name, setName] = useState("");
  const [asking, setAsking] = useState(false);
  const [question, setQuestion] = useState("");
  const [sending, setSending] = useState<ReplyStatus | null>(null);
  const [sendError, setSendError] = useState(false);
  const [sent, setSent] = useState<ReplyStatus | null>(null);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    if (token === undefined || token.length === 0) {
      setState({ kind: "error", reason: "closed" });
      return;
    }
    let cancelled = false;
    setState({ kind: "loading" });
    getSupplierShare(token)
      .then((pack) => {
        if (cancelled) return;
        setState({ kind: "ready", pack });
        // The name the venue addressed the brief to, ready to confirm or change.
        setName((current) => current.length > 0 ? current : pack.passDetails?.addressedTo ?? pack.contactName ?? "");
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        const closed = err instanceof ApiError && (err.status === 404 || err.status === 400 || err.status === 410);
        setState({ kind: "error", reason: closed ? "closed" : "unreachable" });
      });
    return () => {
      cancelled = true;
    };
  }, [token, attempt]);

  const send = useCallback((status: ReplyStatus) => {
    if (token === undefined || token.length === 0 || state.kind !== "ready" || sending !== null) return;
    const given = name.trim();
    const note = question.trim();
    if (given.length === 0) return;
    if (status === "needs_clarification" && note.length === 0) return;
    setSending(status);
    setSendError(false);
    setSent(null);
    const input: CreateSupplierAcknowledgementInput = {
      status,
      acknowledgedByName: given,
      acknowledgedByEmail: null,
      note: status === "needs_clarification" ? note : null,
    };
    acknowledgeSupplierShare(token, input)
      .then(() => {
        // Sent: the venue's staff and hallkeepers are notified with these
        // words (routes/supplier-coordination.ts), whatever the re-read does.
        setSent(status);
        if (status === "needs_clarification") {
          setQuestion("");
          setAsking(false);
        }
        return getSupplierShare(token).then((pack) => { setState({ kind: "ready", pack }); }, () => undefined);
      })
      .catch(() => {
        setSendError(true);
      })
      .finally(() => {
        setSending(null);
      });
  }, [name, question, sending, state.kind, token]);

  if (state.kind === "loading") {
    return (
      <main className="supplier-pass supplier-pass--centred" aria-label="Your brief">
        <ActivityStatus variant="panel">Opening your brief…</ActivityStatus>
      </main>
    );
  }

  if (state.kind === "error" && state.reason === "unreachable") {
    return (
      <main className="supplier-pass supplier-pass--centred" aria-label="Your brief">
        <section className="supplier-pass__sheet supplier-pass__closed">
          <h1>Your brief did not load</h1>
          <p>
            The page could not reach the venue just now. Check your signal and try again.
          </p>
          <button
            type="button"
            className="supplier-pass__button supplier-pass__button--primary supplier-pass__retry"
            onClick={() => { setAttempt((count) => count + 1); }}
          >
            Try again
          </button>
        </section>
      </main>
    );
  }

  if (state.kind === "error") {
    return (
      <main className="supplier-pass supplier-pass--centred" aria-label="Your brief">
        <section className="supplier-pass__sheet supplier-pass__closed">
          <h1>This link no longer opens</h1>
          <p>
            It may have reached its end date, or the venue may have sent you a newer link. Ask the person at the venue who sent it for the current one.
          </p>
        </section>
      </main>
    );
  }

  const { pack } = state;
  const details = pack.passDetails;
  const timeZone = details?.venueTimeZone ?? DEFAULT_ZONE;
  const contact: Contact = details?.venueContact ?? null;
  const venue = pack.venueName ?? "The venue";
  // The day only: the Diary's hours include the room's setup, so they are
  // not the supplier's time. Their own arrival windows are.
  const day = longDay(details?.eventStartsAt, timeZone);
  const rooms = roomList(details?.rooms ?? []);
  const address = details?.venueAddress ?? null;
  const addressedTo = details?.addressedTo ?? pack.contactName;
  const updated = updatedWords(details?.updatedAt ?? pack.issuedAt, timeZone);
  const changes = details?.changesForYou ?? null;
  const planChanged = details?.planChangedAt ?? null;
  const arrivals = pack.items.filter((item) => item.arrivalWindow !== null);
  const until = shortDay(pack.expiresAt, timeZone);
  const replies = [...pack.acknowledgements].reverse();
  const lastRead = replies.find((ack) => ack.status === "acknowledged") ?? null;
  const nameMissing = name.trim().length === 0;

  return (
    <main className="supplier-pass" aria-label="Your brief">
      <article className="supplier-pass__sheet">
        <header className="supplier-pass__head">
          <p className="supplier-pass__venue">{venue}</p>
          <h1 className="supplier-pass__title">{pack.title}</h1>
          {addressedTo !== null && addressedTo !== pack.title && <p className="supplier-pass__for">For {addressedTo}</p>}
          {(day !== null || rooms !== null) && (
            <p className="supplier-pass__when">{[day, rooms].filter((part): part is string => part !== null).join(" · ")}</p>
          )}
          {updated !== null && (
            <p className="supplier-pass__updated">
              {updated}
              {changes !== null && <> · <a href="#what-changed">what changed for you</a></>}
            </p>
          )}
        </header>

        {planChanged !== null && (
          <p className="supplier-pass__stale" role="note">
            The venue's plan changed on {shortDay(planChanged, timeZone)} at {clockTime(planChanged, timeZone)}, after this brief was made. Check with {askWords(contact)} before you arrive.
          </p>
        )}

        {changes !== null && (
          <section className="supplier-pass__section" id="what-changed" aria-labelledby="what-changed-heading">
            <h2 id="what-changed-heading">What changed for you</h2>
            <p>Since your last brief, made {dayAndTime(changes.since, timeZone) ?? "earlier"}.</p>
            {changes.added.length + changes.changed.length + changes.removed.length === 0 ? (
              <p>Nothing in your part changed.</p>
            ) : (
              <div className="supplier-pass__changes">
                <ChangeList label="New" items={changes.added} />
                <ChangeList label="Changed" items={changes.changed} />
                <ChangeList label="No longer yours" items={changes.removed} />
              </div>
            )}
          </section>
        )}

        <section className="supplier-pass__section" aria-labelledby="before-heading">
          <h2 id="before-heading">Before you come</h2>
          {day !== null && (
            <p>The event is on {day}{rooms === null ? "" : `, in the ${rooms}`}.</p>
          )}
          {arrivals.length === 0 ? (
            <p>No arrival time is on your brief yet. Agree one with {askWords(contact)}.</p>
          ) : (
            <ul className="supplier-pass__arrivals">
              {arrivals.map((item) => (
                <li key={`${String(item.sortOrder)}-${item.title}`}>
                  <strong>Arrive {item.arrivalWindow}</strong>
                  <span>{item.title}</span>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="supplier-pass__section" aria-labelledby="door-heading">
          <h2 id="door-heading">At the door</h2>
          <p className="supplier-pass__address">{address === null ? `${venue}.` : `${venue}, ${address}`}</p>
          <p>{contact === null ? "Tell the door who you are and what you are here for." : `Ask for ${contact.name}.`}</p>
        </section>

        <section className="supplier-pass__section" aria-labelledby="part-heading">
          <h2 id="part-heading">Your part</h2>
          <ul className="supplier-pass__items">
            {pack.items.map((item) => (
              <li key={`${String(item.sortOrder)}-${item.title}`}>
                <h3>{item.title}</h3>
                <p>{item.detail}</p>
                {item.arrivalWindow !== null && <p className="supplier-pass__item-time">Arrive {item.arrivalWindow}</p>}
              </li>
            ))}
          </ul>
        </section>

        <section className="supplier-pass__contact" data-register="forest" aria-labelledby="ask-heading">
          <h2 id="ask-heading">If something comes up</h2>
          {contact === null ? (
            <p>Send the venue team a question below; it reaches the people running the day.</p>
          ) : contact.phone === null ? (
            <p>Ask for {contact.name} at the venue, or send a question below.</p>
          ) : (
            <>
              <p>Ring {contact.name}, or send a question below.</p>
              <a className="supplier-pass__call" href={telHref(contact.phone)}>
                <Phone aria-hidden="true" size={20} />
                Call {contact.name}, {contact.phone}
              </a>
            </>
          )}
        </section>

        <section className="supplier-pass__section supplier-pass__reply" aria-labelledby="reply-heading">
          <h2 id="reply-heading">Tell the venue</h2>
          {lastRead === null ? (
            <p>When you have read your part, say so here. The venue sees it straight away.</p>
          ) : (
            <p>
              You marked this as read on {dayAndTime(lastRead.createdAt, timeZone) ?? "an earlier day"}
              {lastRead.acknowledgedByName === null ? "" : `, as ${lastRead.acknowledgedByName}`}.
            </p>
          )}

          <div className="supplier-pass__field">
            <label htmlFor="supplier-pass-name">Your name</label>
            <input
              id="supplier-pass-name"
              value={name}
              onChange={(event) => { setName(event.target.value); }}
              maxLength={160}
              autoComplete="name"
              aria-describedby="supplier-pass-name-hint"
            />
            <small id="supplier-pass-name-hint">The venue sees this name with your reply, as given by whoever holds this link.</small>
          </div>

          <div className="supplier-pass__actions">
            {lastRead === null && (
              <button
                type="button"
                className="supplier-pass__button supplier-pass__button--primary"
                disabled={sending !== null || nameMissing}
                aria-busy={sending === "acknowledged"}
                onClick={() => { send("acknowledged"); }}
              >
                {sending === "acknowledged" && <ActivityIndicator size={20} />}
                {sending === "acknowledged" ? "Sending…" : "I've read it"}
              </button>
            )}
            <button
              type="button"
              className="supplier-pass__button"
              aria-expanded={asking}
              aria-controls={questionId}
              disabled={sending !== null}
              onClick={() => { setAsking((open) => !open); }}
            >
              {asking ? "Close the question" : "Ask a question"}
            </button>
          </div>

          {asking && (
            <div className="supplier-pass__question" id={questionId}>
              <div className="supplier-pass__field">
                <label htmlFor="supplier-pass-question">Your question</label>
                <textarea
                  id="supplier-pass-question"
                  value={question}
                  onChange={(event) => { setQuestion(event.target.value); }}
                  maxLength={4000}
                  rows={4}
                />
              </div>
              <button
                type="button"
                className="supplier-pass__button supplier-pass__button--primary"
                disabled={sending !== null || nameMissing || question.trim().length === 0}
                aria-busy={sending === "needs_clarification"}
                onClick={() => { send("needs_clarification"); }}
              >
                {sending === "needs_clarification" && <ActivityIndicator size={20} />}
                {sending === "needs_clarification" ? "Sending…" : "Send my question"}
              </button>
            </div>
          )}

          {nameMissing && <p className="supplier-pass__hint">Write your name first, so the venue knows who replied.</p>}

          <p className="supplier-pass__sent" role="status">
            {sent === null ? "" : sent === "acknowledged"
              ? `Sent. ${venue}'s team can see you have read this.`
              : `Sent. ${venue}'s team has your question.${contact === null || contact.phone === null ? "" : ` If it is urgent, ring ${contact.name} on ${contact.phone}.`}`}
          </p>
          {sendError && (
            <p className="supplier-pass__error" role="alert">
              Your reply did not reach the venue. Check your signal and try again{fallbackWords(contact)}
            </p>
          )}

          {replies.length > 0 && (
            <div className="supplier-pass__replies">
              <h3>Your replies</h3>
              <ul>
                {replies.map((ack) => (
                  <li key={`${ack.createdAt}-${ack.status}`}>
                    <strong>{ack.status === "acknowledged" ? "Read" : "Question"}</strong>
                    <span>
                      {dayAndTime(ack.createdAt, timeZone) ?? ""}
                      {ack.acknowledgedByName === null ? "" : ` · ${ack.acknowledgedByName}`}
                    </span>
                    {ack.note !== null && <p>{ack.note}</p>}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </section>

        <footer className="supplier-pass__foot">
          <p>This page shows only your part of the event{until === null ? "." : `, and works until ${until}.`}</p>
          <button type="button" className="supplier-pass__button supplier-pass__print" onClick={() => { window.print(); }}>
            <Printer aria-hidden="true" size={18} />
            Print or save this brief
          </button>
        </footer>
      </article>
    </main>
  );
}
