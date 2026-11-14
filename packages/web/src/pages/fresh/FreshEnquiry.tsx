import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
  type ReactElement,
} from "react";
import {
  GUEST_ENQUIRY_LATEST_EVENT_DATE,
  GUEST_ENQUIRY_LIMITS,
  TRADES_HALL_ENQUIRY_VENUE_SLUG,
} from "@omnitwin/types";
import { ActivityIndicator } from "../../components/shared/Activity.js";
import { EnquiryTrapField, useEnquiryTrap } from "../../components/shared/EnquiryTrap.js";
import { submitGuestEnquiry } from "../../api/configurations.js";
import { isValidEmail } from "../../lib/email-validation.js";
import { guestToday } from "../../lib/guest-today.js";
import {
  FRESH_CONTACT_PHONE_DISPLAY,
  FRESH_CONTACT_PHONE_HREF,
  FRESH_ENQUIRY_COPIED,
  FRESH_ENQUIRY_COPY_ACTION,
  FRESH_ENQUIRY_CRAFT_PREFIX,
  FRESH_ENQUIRY_DATE_AFTER_LAST,
  FRESH_ENQUIRY_DATE_BEFORE_TODAY,
  FRESH_ENQUIRY_DATE_LABEL,
  FRESH_ENQUIRY_DATE_NOT_A_DATE,
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

/** A Craft's name as the quiz sends it: words of letters joined by spaces,
 *  ampersands, apostrophes or hyphens ("THE BONNETMAKERS & DYERS"). */
const CRAFT_NAME = /^\p{L}[\p{L} &'’-]{0,78}\p{L}$/u;

/**
 * The Craft the Trades House quiz drew, from `?craft=`, or null.
 *
 * A query string is untrusted input and this one is written into a message
 * sent in the visitor's name, so anything that is not shaped like a Craft's
 * name — digits, links, punctuation, more than one line — is dropped rather
 * than cleaned up. The quiz sets its names in capitals; a sentence reads them
 * as words, so "THE HAMMERMEN" becomes "The Hammermen".
 */
export function craftFromQuery(search: string): string | null {
  const raw = new URLSearchParams(search).get("craft");
  if (raw === null) return null;
  const collapsed = raw.replace(/\s+/gu, " ").trim();
  if (!CRAFT_NAME.test(collapsed)) return null;
  return collapsed
    .toLowerCase()
    .replace(/(^|[ -])(\p{L})/gu, (_match: string, lead: string, letter: string) => `${lead}${letter.toUpperCase()}`);
}

/** Why the front door holds Send on its date field. */
export type EventDateRefusal = "not-on-calendar" | "after-last" | "before-today";

/** Each refusal in the owner's words (fresh-copy.ts, 14 November 2026). */
const DATE_REFUSAL_WORDS: Readonly<Record<EventDateRefusal, string>> = {
  "not-on-calendar": FRESH_ENQUIRY_DATE_NOT_A_DATE,
  "after-last": FRESH_ENQUIRY_DATE_AFTER_LAST,
  "before-today": FRESH_ENQUIRY_DATE_BEFORE_TODAY,
};

function daysInMonth(year: number, month: number): number {
  if (month === 2) return year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0) ? 29 : 28;
  return [4, 6, 9, 11].includes(month) ? 30 : 31;
}

/**
 * Why Send holds a date the guest gave, or null when the enquiry may go: no
 * date at all is no refusal. The form sets noValidate, so it checks the date
 * itself (Blake, 13 and 14 November 2026; review of #405, Q3), in this order.
 * A day the calendar does not have (30 February; a thirteenth month; year
 * 0000, which the API refuses) comes first, since it cannot be compared with
 * today. Then a year past GUEST_ENQUIRY_LATEST_EVENT_DATE, the year of five
 * digits a doubled key gives (20277), which is a real day and after today, so
 * it is never told "from today onwards". Then a day before `today`, the
 * guest's own (guestToday), read when the form is checked.
 */
export function eventDateRefusal(dateISO: string, today: string): EventDateRefusal | null {
  if (dateISO === "") return null;
  const [, yearText, monthText, dayText] = /^(\d{4,})-(\d{2})-(\d{2})$/u.exec(dateISO) ?? [];
  if (yearText === undefined || monthText === undefined || dayText === undefined) return "not-on-calendar";
  const year = Number(yearText);
  const month = Number(monthText);
  const day = Number(dayText);
  if (year < 1 || month < 1 || month > 12 || day < 1 || day > daysInMonth(year, month)) return "not-on-calendar";
  // A year of five digits or more sorts before "9999" as text, so it is
  // named by its length; a date of four is compared as the API's text is.
  if (yearText.length > 4 || dateISO > GUEST_ENQUIRY_LATEST_EVENT_DATE) return "after-last";
  return dateISO < today ? "before-today" : null;
}

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
  /** Counts the sends that found no usable address since the guest last
   *  edited it; each takes focus to the field and says the problem again. */
  const [emailFocusRequests, setEmailFocusRequests] = useState(0);
  const emailRef = useRef<HTMLInputElement>(null);
  const sentRef = useRef<HTMLDivElement>(null);
  /** Whether a Send has found the date refused; from then on its reason
   *  follows the date the guest gives. */
  const [dateChecked, setDateChecked] = useState(false);
  /** Counts the sends that held the date since the guest last changed it,
   *  as emailFocusRequests counts the email's. */
  const [dateFocusRequests, setDateFocusRequests] = useState(0);
  const dateRef = useRef<HTMLInputElement>(null);
  /** The hidden field no person reaches, and how long the form is open. */
  const { inputRef: hiddenFieldRef, read: readHiddenTrap } = useEnquiryTrap();

  // The form sets noValidate, so the browser neither focuses nor announces a
  // missing or invalid email: Send does it here (a11y-2). Focus moves once the
  // field has rendered as invalid with its problem attached, so a screen reader
  // reads the label, the invalid state and the problem together.
  useEffect(() => {
    if (emailFocusRequests > 0) emailRef.current?.focus();
  }, [emailFocusRequests]);

  // The date's refusal is taken to the same way.
  useEffect(() => {
    if (dateFocusRequests > 0) dateRef.current?.focus();
  }, [dateFocusRequests]);

  // A sent enquiry replaces the Send button that held focus. Focus goes to the
  // confirmation, which is named by its own title, rather than falling to the
  // page with nothing said.
  useEffect(() => {
    if (sendState === "sent") sentRef.current?.focus();
  }, [sendState]);

  /**
   * The Craft the Trades House quiz drew, arriving as `?craft=`.
   *
   * "Request an introduction" used to be a mailto whose BODY named the Craft.
   * Replacing it with a bare enquiry would have thrown that away, so the quiz
   * carries the Craft in the query and the composer writes it into the
   * message — otherwise the request reaches the team indistinguishable from a
   * wedding enquiry and the quiz's whole answer is lost.
   *
   * Read once, on mount, because the visitor goes on editing the rest of the
   * form; craftFromQuery decides what counts as a Craft.
   */
  const [craft] = useState<string | null>(() => craftFromQuery(window.location.search));
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
  // The guest's own day, read at each drawing (and again at Send), never the
  // UTC date: the picker's earliest day, and the day a checked date is read against.
  const today = guestToday();
  const dateRefusal = dateChecked ? eventDateRefusal(dateISO, today) : null;
  const dateProblem = dateRefusal === null ? null : DATE_REFUSAL_WORDS[dateRefusal];

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
      // The date comes before the email in the form, so it is named first.
      if (eventDateRefusal(dateISO, guestToday()) !== null) {
        setDateChecked(true);
        setDateFocusRequests((count) => count + 1);
        return;
      }
      if (emailProblem !== null) {
        setEmailTouched(true);
        setEmailFocusRequests((count) => count + 1);
        return;
      }
      setSendState("sending");
      void submitGuestEnquiry({
        // The DATABASE slug, never the asset slug: the two namespaces differ
        // and posting the asset slug 404s the enquiry. See TRADES_HALL_ASSET_SLUG.
        venueSlug: TRADES_HALL_ENQUIRY_VENUE_SLUG,
        // The venue path was the walkthrough's; without this the enquiry is
        // recorded as having come from the twin.
        source: "website",
        email: emailTrimmed,
        name: name.trim() !== "" ? name.trim() : undefined,
        phone: phone.trim() !== "" ? phone.trim() : undefined,
        eventDate: dateISO !== "" ? dateISO : undefined,
        eventType: eventKey,
        guestCount: guests,
        message: craftNote === null ? composed.body : `${composed.body}\n\n${craftNote}`,
        ...readHiddenTrap(),
      })
        .then(() => {
          setSendState("sent");
        })
        .catch(() => {
          setSendState("error");
        });
    },
    [composed, guests, emailProblem, emailTrimmed, name, phone, dateISO, eventKey, craftNote, readHiddenTrap],
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
              ref={dateRef}
              type="date"
              min={today}
              max={GUEST_ENQUIRY_LATEST_EVENT_DATE}
              value={dateISO}
              aria-invalid={dateProblem !== null}
              aria-describedby={dateProblem !== null ? "fr-enq-date-problem" : undefined}
              onChange={(event) => {
                setDateISO(event.target.value);
                setDateFocusRequests(0);
              }}
            />
            {/* Said when Send finds it, a new alert each Send; a plain line
                once the guest changes the date, and gone once it is one the
                form takes, as the email's problem is (below). */}
            {dateProblem !== null && (
              <small
                key={dateFocusRequests}
                className="fr-enq-problem"
                id="fr-enq-date-problem"
                role={dateFocusRequests > 0 ? "alert" : undefined}
              >
                {dateProblem}
              </small>
            )}
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
              maxLength={GUEST_ENQUIRY_LIMITS.nameLength}
              value={name}
              onChange={(event) => {
                setName(event.target.value);
              }}
            />
          </label>
          <label className="fr-enq-field">
            <span>{FRESH_ENQUIRY_EMAIL_LABEL}</span>
            <input
              ref={emailRef}
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
                setEmailFocusRequests(0);
              }}
              onBlur={() => {
                setEmailTouched(true);
              }}
            />
            {/* Spoken when Send finds it (review of #405, F1): Enter in this
                field sends with focus already here, so moving focus says
                nothing. Each Send makes a new alert, so a repeat is heard
                again; once the guest edits, it is a plain line again and
                their typing is not interrupted. */}
            {emailTouched && emailProblem !== null && (
              <small
                key={emailFocusRequests}
                className="fr-enq-problem"
                id="fr-enq-email-problem"
                role={emailFocusRequests > 0 ? "alert" : undefined}
              >
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
              maxLength={GUEST_ENQUIRY_LIMITS.phoneLength}
              value={phone}
              onChange={(event) => {
                setPhone(event.target.value);
              }}
            />
          </label>
        </div>
        <EnquiryTrapField inputRef={hiddenFieldRef} />
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
            <div
              className="fr-enq-sent"
              role="status"
              ref={sentRef}
              tabIndex={-1}
              aria-labelledby="fr-enq-sent-title"
            >
              <p className="fr-enq-sent-title" id="fr-enq-sent-title">{FRESH_ENQUIRY_SENT_TITLE}</p>
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
