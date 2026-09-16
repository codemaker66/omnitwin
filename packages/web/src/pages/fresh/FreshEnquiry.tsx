import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type FormEvent,
  type ReactElement,
} from "react";
import { TRADES_HALL_ENQUIRY_VENUE_SLUG } from "@omnitwin/types";
import { ActivityIndicator } from "../../components/shared/Activity.js";
import { submitGuestEnquiry } from "../../api/configurations.js";
import { isValidEmail } from "../../lib/email-validation.js";
import {
  FRESH_CONTACT_PHONE_DISPLAY,
  FRESH_CONTACT_PHONE_HREF,
  FRESH_ENQUIRY_COPIED,
  FRESH_ENQUIRY_COPY_ACTION,
  FRESH_ENQUIRY_CRAFT_PREFIX,
  FRESH_ENQUIRY_DATE_LABEL,
  FRESH_ENQUIRY_EMAIL_INVALID,
  FRESH_ENQUIRY_EMAIL_LABEL,
  FRESH_ENQUIRY_EMAIL_REQUIRED,
  FRESH_ENQUIRY_ERROR,
  FRESH_ENQUIRY_EVENT_LABEL,
  FRESH_ENQUIRY_GUESTS_LABEL,
  FRESH_ENQUIRY_GUESTS_PROMPT,
  FRESH_ENQUIRY_NAME_LABEL,
  FRESH_ENQUIRY_OPTIONAL,
  FRESH_ENQUIRY_OR_CALL,
  FRESH_ENQUIRY_PHONE_LABEL,
  FRESH_ENQUIRY_PRIVACY_HREF,
  FRESH_ENQUIRY_PRIVACY_LINK,
  FRESH_ENQUIRY_PRIVACY_NOTE,
  FRESH_ENQUIRY_SENDING,
  FRESH_ENQUIRY_SENT_LINE,
  FRESH_ENQUIRY_SENT_TITLE,
  FRESH_ENQUIRY_SUBMIT,
} from "./fresh-copy.js";
import {
  ENQUIRY_EVENT_TYPES,
  alsoFitsSentence,
  composeEnquiry,
  enquiryYear,
  fitReport,
  fitSentence,
  weddingRateLine,
  weddingScopeNote,
  type EnquiryEventKey,
} from "./enquiry-fit.js";

// -----------------------------------------------------------------------------
// FreshEnquiry — the Enquiry Composer, the one real form on the public site.
//
// Lifted out of FreshPage in T-616 so the canonical home at `/` and the
// about-and-enquiry page at /fresh render the SAME composer rather than two
// drifting copies. Nothing about its behaviour changed in the move except the
// removal of the "open in your email app" mailto: gate line 4 asks that every
// Enquire post to /public/enquiries, and a mailto beside the send button was a
// second path out of the page that left no row in `enquiries`. The venue's
// phone number stays on screen throughout, which is the fallback that actually
// reaches a person when the POST fails.
//
// State stays tiny: an occasion, a guest count (kept as text so half-typed
// numbers don't judder the answer), an optional date. Everything said below it
// is computed by enquiry-fit from the venue's published figures.
// -----------------------------------------------------------------------------

type EnquirySendState = "idle" | "sending" | "sent" | "error";

export function FreshEnquiry(): ReactElement {
  const [eventKey, setEventKey] = useState<EnquiryEventKey>("wedding");
  const [guestsText, setGuestsText] = useState("100");
  const [dateISO, setDateISO] = useState("");
  const [copied, setCopied] = useState(false);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [emailTouched, setEmailTouched] = useState(false);
  const [sendState, setSendState] = useState<EnquirySendState>("idle");

  /**
   * The Craft the Trades House quiz drew, arriving as `?craft=`.
   *
   * "Request an introduction" used to be a mailto whose BODY named the Craft.
   * Replacing it with a bare enquiry would have thrown that away, so the quiz
   * carries the Craft in the query and the composer writes it into the
   * message — otherwise the request reaches the team indistinguishable from a
   * wedding enquiry and the quiz's whole answer is lost.
   *
   * A query string is untrusted input: this is collapsed to a single line and
   * capped, so it cannot smuggle structure into the message body. Read once,
   * on mount, because the visitor goes on editing the rest of the form.
   */
  const [craft] = useState<string | null>(() => {
    const raw = new URLSearchParams(window.location.search).get("craft");
    if (raw === null) return null;
    const cleaned = raw.replace(/\s+/gu, " ").trim().slice(0, 80);
    return cleaned === "" ? null : cleaned;
  });
  const craftNote = craft === null ? null : `${FRESH_ENQUIRY_CRAFT_PREFIX} ${craft}.`;

  const guestsParsed = Number.parseInt(guestsText, 10);
  const guests =
    Number.isFinite(guestsParsed) && guestsParsed >= 2 && guestsParsed <= 999
      ? guestsParsed
      : null;

  const report = useMemo(
    () => (guests === null ? null : fitReport(eventKey, guests)),
    [eventKey, guests],
  );
  const composed = useMemo(
    () =>
      guests === null
        ? null
        : composeEnquiry({ eventKey, guests, dateISO }),
    [eventKey, guests, dateISO],
  );
  const also = report === null ? "" : alsoFitsSentence(report);
  const rateLine =
    eventKey === "wedding" ? weddingRateLine(enquiryYear(dateISO)) : null;
  const scopeNote =
    eventKey === "wedding" && guests !== null ? weddingScopeNote(guests) : null;
  const today = new Date().toISOString().slice(0, 10);

  const emailTrimmed = email.trim();
  const emailProblem =
    emailTrimmed === ""
      ? FRESH_ENQUIRY_EMAIL_REQUIRED
      : isValidEmail(emailTrimmed)
        ? null
        : FRESH_ENQUIRY_EMAIL_INVALID;

  /** Post the enquiry the page has already written. The phone number stays on
   *  screen throughout: if this fails, the visitor still has a working way to
   *  reach the hall, which is the whole point of keeping it. */
  const sendEnquiry = useCallback(
    (event: FormEvent<HTMLFormElement>) => {
      event.preventDefault();
      if (composed === null || guests === null) return;
      if (emailProblem !== null) {
        setEmailTouched(true);
        return;
      }
      setSendState("sending");
      void submitGuestEnquiry({
        // The DATABASE slug, never the asset slug: the two namespaces differ
        // and posting the asset slug 404s the enquiry. See TRADES_HALL_ASSET_SLUG.
        venueSlug: TRADES_HALL_ENQUIRY_VENUE_SLUG,
        email: emailTrimmed,
        name: name.trim() !== "" ? name.trim() : undefined,
        phone: phone.trim() !== "" ? phone.trim() : undefined,
        eventDate: dateISO !== "" ? dateISO : undefined,
        eventType: eventKey,
        guestCount: guests,
        message: craftNote === null ? composed.body : `${composed.body}\n\n${craftNote}`,
      })
        .then(() => {
          setSendState("sent");
        })
        .catch(() => {
          setSendState("error");
        });
    },
    [composed, guests, emailProblem, emailTrimmed, name, phone, dateISO, eventKey, craftNote],
  );

  const copyEnquiry = useCallback(() => {
    if (composed === null) return;
    const clipboard = navigator.clipboard as Clipboard | undefined;
    if (clipboard === undefined) return;
    void clipboard
      .writeText(
        craftNote === null
          ? `${composed.subject}\n\n${composed.body}`
          : `${composed.subject}\n\n${composed.body}\n\n${craftNote}`,
      )
      .then(() => {
        setCopied(true);
      })
      .catch(() => undefined);
  }, [composed, craftNote]);

  useEffect(() => {
    if (!copied) return;
    const timer = window.setTimeout(() => {
      setCopied(false);
    }, 1600);
    return () => {
      window.clearTimeout(timer);
    };
  }, [copied]);

  return (
    <form className="fr-enq" onSubmit={sendEnquiry} noValidate data-testid="enquiry-composer">
      <div className="fr-enq-controls">
        <fieldset className="fr-enq-types">
          <legend>{FRESH_ENQUIRY_EVENT_LABEL}</legend>
          <div className="fr-enq-pills">
            {ENQUIRY_EVENT_TYPES.map((type) => (
              <button
                key={type.key}
                type="button"
                aria-pressed={eventKey === type.key}
                onClick={() => {
                  setEventKey(type.key);
                }}
              >
                {type.label}
              </button>
            ))}
          </div>
        </fieldset>
        <div className="fr-enq-fields">
          <label className="fr-enq-field">
            <span>{FRESH_ENQUIRY_GUESTS_LABEL}</span>
            <input
              type="number"
              inputMode="numeric"
              min={2}
              max={999}
              value={guestsText}
              onChange={(event) => {
                setGuestsText(event.target.value);
              }}
            />
          </label>
          <label className="fr-enq-field">
            <span>{FRESH_ENQUIRY_DATE_LABEL}</span>
            <input
              type="date"
              min={today}
              value={dateISO}
              onChange={(event) => {
                setDateISO(event.target.value);
              }}
            />
          </label>
        </div>
        <div className="fr-enq-fields fr-enq-contact">
          <label className="fr-enq-field">
            <span>
              {FRESH_ENQUIRY_NAME_LABEL} <em>{FRESH_ENQUIRY_OPTIONAL}</em>
            </span>
            <input
              type="text"
              autoComplete="name"
              value={name}
              onChange={(event) => {
                setName(event.target.value);
              }}
            />
          </label>
          <label className="fr-enq-field">
            <span>{FRESH_ENQUIRY_EMAIL_LABEL}</span>
            <input
              type="email"
              autoComplete="email"
              inputMode="email"
              required
              value={email}
              aria-invalid={emailTouched && emailProblem !== null}
              aria-describedby={
                emailTouched && emailProblem !== null ? "fr-enq-email-problem" : undefined
              }
              onChange={(event) => {
                setEmail(event.target.value);
              }}
              onBlur={() => {
                setEmailTouched(true);
              }}
            />
            {emailTouched && emailProblem !== null && (
              <small className="fr-enq-problem" id="fr-enq-email-problem">
                {emailProblem}
              </small>
            )}
          </label>
          <label className="fr-enq-field">
            <span>
              {FRESH_ENQUIRY_PHONE_LABEL} <em>{FRESH_ENQUIRY_OPTIONAL}</em>
            </span>
            <input
              type="tel"
              autoComplete="tel"
              value={phone}
              onChange={(event) => {
                setPhone(event.target.value);
              }}
            />
          </label>
        </div>
      </div>

      <div className="fr-enq-answer" aria-live="polite">
        {report === null ? (
          <p className="fr-enq-fit">{FRESH_ENQUIRY_GUESTS_PROMPT}</p>
        ) : (
          <>
            <p className="fr-enq-fit">{fitSentence(report)}</p>
            {also !== "" && <p className="fr-enq-also">{also}</p>}
            {rateLine !== null && <p className="fr-enq-also">{rateLine}</p>}
            {scopeNote !== null && <p className="fr-enq-also">{scopeNote}</p>}
          </>
        )}
      </div>

      {composed !== null && (
        <div className="fr-enq-compose">
          <p className="fr-enq-subject">{composed.subject}</p>
          {/* The message is shown before it is sent, so the Craft the quiz
              drew is visible here too rather than appearing only in the POST
              — a visitor should be able to read everything they are about to
              send. */}
          <pre className="fr-enq-body">
            {craftNote === null ? composed.body : `${composed.body}\n\n${craftNote}`}
          </pre>
          {sendState === "sent" ? (
            <div className="fr-enq-sent" role="status">
              <p className="fr-enq-sent-title">{FRESH_ENQUIRY_SENT_TITLE}</p>
              <p className="fr-enq-sent-line">{FRESH_ENQUIRY_SENT_LINE}</p>
              <span className="fr-enq-call">
                {FRESH_ENQUIRY_OR_CALL}{" "}
                <a href={FRESH_CONTACT_PHONE_HREF}>{FRESH_CONTACT_PHONE_DISPLAY}</a>
              </span>
            </div>
          ) : (
            <>
              {sendState === "error" && (
                <p className="fr-enq-problem fr-enq-problem-send" role="alert">
                  {FRESH_ENQUIRY_ERROR}
                </p>
              )}
              <div className="fr-enq-actions">
                <button
                  type="submit"
                  className="fr-cta"
                  disabled={sendState === "sending"}
                  aria-busy={sendState === "sending"}
                >
                  {sendState === "sending" && <ActivityIndicator size={20} />}
                  {sendState === "sending" ? FRESH_ENQUIRY_SENDING : FRESH_ENQUIRY_SUBMIT}
                </button>
                <button type="button" className="fr-enq-copy" onClick={copyEnquiry}>
                  {copied ? FRESH_ENQUIRY_COPIED : FRESH_ENQUIRY_COPY_ACTION}
                </button>
                <span className="fr-enq-call">
                  {FRESH_ENQUIRY_OR_CALL}{" "}
                  <a href={FRESH_CONTACT_PHONE_HREF}>{FRESH_CONTACT_PHONE_DISPLAY}</a>
                </span>
              </div>
              <p className="fr-enq-privacy">
                {FRESH_ENQUIRY_PRIVACY_NOTE}{" "}
                <a href={FRESH_ENQUIRY_PRIVACY_HREF}>{FRESH_ENQUIRY_PRIVACY_LINK}</a>
              </p>
            </>
          )}
        </div>
      )}
    </form>
  );
}

export default FreshEnquiry;
