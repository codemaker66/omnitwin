import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type FormEvent,
  type KeyboardEvent,
  type ReactElement,
} from "react";
import { submitGuestEnquiry } from "../api/configurations.js";
import { useFocusTrap } from "../lib/use-focus-trap.js";
import { isValidEmail } from "../lib/email-validation.js";
import {
  TWIN_ENQUIRE_CLOSE,
  TWIN_ENQUIRE_CTA,
  TWIN_ENQUIRE_DONE,
  TWIN_ENQUIRE_EMAIL_INVALID,
  TWIN_ENQUIRE_EYEBROW,
  TWIN_ENQUIRE_GENERIC_ERROR,
  TWIN_ENQUIRE_SENDING,
  TWIN_ENQUIRE_SUBHEAD,
  TWIN_ENQUIRE_SUCCESS_TITLE,
  TWIN_ENQUIRE_TRUST,
  twinEnquireSuccessBody,
  twinEnquireTitle,
} from "./twin-copy.js";

// -----------------------------------------------------------------------------
// TwinEnquiryModal — the one-click, stay-in-the-twin enquiry (finding [2]).
//
// A lean venue-context form: no planner, no config, no layout summary — just
// contact details posted with the venueSlug, which the public /public/enquiries
// endpoint anchors to the venue and routes to its hallkeepers (a real, DB-
// persisted lead, not a mailto). Deliberately self-contained rather than forking
// the planner's GuestEnquiryModal, which is coupled to placement/room stores the
// twin does not have. Focus-trapped, Escape/overlay to close, email required.
// -----------------------------------------------------------------------------

export interface TwinEnquiryModalProps {
  readonly venueSlug: string;
  readonly venueName: string;
  readonly onClose: () => void;
}

export function TwinEnquiryModal({
  venueSlug,
  venueName,
  onClose,
}: TwinEnquiryModalProps): ReactElement {
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [name, setName] = useState("");
  const [eventDate, setEventDate] = useState("");
  const [eventType, setEventType] = useState("");
  const [guestCount, setGuestCount] = useState("");
  const [message, setMessage] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [emailTouched, setEmailTouched] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const emailRef = useRef<HTMLInputElement>(null);
  const trapRef = useFocusTrap<HTMLDivElement>();

  useEffect(() => {
    const timer = window.setTimeout(() => {
      emailRef.current?.focus();
    }, 80);
    return () => {
      window.clearTimeout(timer);
    };
  }, []);

  const emailValid = isValidEmail(email);
  const showEmailHint = emailTouched && email.trim().length > 0 && !emailValid;

  const onSubmit = useCallback(
    (event: FormEvent): void => {
      event.preventDefault();
      setError(null);
      if (!emailValid) {
        setEmailTouched(true);
        setError(TWIN_ENQUIRE_EMAIL_INVALID);
        emailRef.current?.focus();
        return;
      }
      const parsedGuests =
        guestCount.trim() === "" ? undefined : Number.parseInt(guestCount, 10);
      const guests =
        parsedGuests !== undefined && Number.isFinite(parsedGuests) && parsedGuests >= 0
          ? parsedGuests
          : undefined;
      setIsSubmitting(true);
      void submitGuestEnquiry({
        venueSlug,
        email: email.trim(),
        phone: phone.trim() !== "" ? phone.trim() : undefined,
        name: name.trim() !== "" ? name.trim() : undefined,
        eventDate: eventDate !== "" ? eventDate : undefined,
        eventType: eventType !== "" ? eventType : undefined,
        guestCount: guests,
        message: message.trim() !== "" ? message.trim() : undefined,
      })
        .then(() => {
          setSubmitted(true);
        })
        .catch((err: unknown) => {
          setError(err instanceof Error ? err.message : TWIN_ENQUIRE_GENERIC_ERROR);
        })
        .finally(() => {
          setIsSubmitting(false);
        });
    },
    [venueSlug, email, phone, name, eventDate, eventType, guestCount, message, emailValid],
  );

  const onKeyDown = useCallback(
    (event: KeyboardEvent): void => {
      if (event.key === "Escape") {
        onClose();
      }
    },
    [onClose],
  );

  if (submitted) {
    return (
      <div
        className="vv-twin-enq-overlay"
        role="dialog"
        aria-modal="true"
        aria-labelledby="vv-twin-enq-success-title"
        tabIndex={-1}
        onClick={onClose}
      >
        <div
          ref={trapRef}
          className="vv-twin-enq-panel vv-twin-enq-panel--success"
          onClick={(event) => {
            event.stopPropagation();
          }}
          onKeyDown={onKeyDown}
        >
          <div className="vv-twin-enq-check" aria-hidden>
            ✓
          </div>
          <h2 id="vv-twin-enq-success-title" className="vv-twin-enq-title">
            {TWIN_ENQUIRE_SUCCESS_TITLE}
          </h2>
          <p className="vv-twin-enq-sub">{twinEnquireSuccessBody(venueName)}</p>
          <p className="vv-twin-enq-email">{email}</p>
          <button type="button" className="vv-twin-enq-submit" onClick={onClose}>
            {TWIN_ENQUIRE_DONE}
          </button>
        </div>
      </div>
    );
  }

  return (
    <div
      className="vv-twin-enq-overlay"
      role="dialog"
      aria-modal="true"
      aria-labelledby="vv-twin-enq-title"
      tabIndex={-1}
      onClick={onClose}
    >
      <div
        ref={trapRef}
        className="vv-twin-enq-panel"
        onClick={(event) => {
          event.stopPropagation();
        }}
        onKeyDown={onKeyDown}
      >
        <button
          type="button"
          className="vv-twin-enq-close"
          aria-label={TWIN_ENQUIRE_CLOSE}
          onClick={onClose}
        >
          ×
        </button>
        <p className="vv-twin-enq-eyebrow">{TWIN_ENQUIRE_EYEBROW}</p>
        <h2 id="vv-twin-enq-title" className="vv-twin-enq-title">
          {twinEnquireTitle(venueName)}
        </h2>
        <p className="vv-twin-enq-sub">{TWIN_ENQUIRE_SUBHEAD}</p>

        {error !== null && (
          <div role="alert" className="vv-twin-enq-error">
            {error}
          </div>
        )}

        <form onSubmit={onSubmit} data-testid="twin-enquiry-form">
          <label className="vv-twin-enq-label" htmlFor="tw-enq-email">
            Email *
          </label>
          <input
            ref={emailRef}
            id="tw-enq-email"
            type="email"
            required
            autoComplete="email"
            className="vv-twin-enq-input"
            value={email}
            onChange={(event) => {
              setEmail(event.target.value);
            }}
            onBlur={() => {
              setEmailTouched(true);
            }}
            placeholder="you@example.com"
          />
          {showEmailHint && (
            <div className="vv-twin-enq-hint">Almost — just needs a valid email address</div>
          )}

          <div className="vv-twin-enq-row">
            <div>
              <label className="vv-twin-enq-label" htmlFor="tw-enq-name">
                Your name
              </label>
              <input
                id="tw-enq-name"
                type="text"
                autoComplete="name"
                className="vv-twin-enq-input"
                value={name}
                onChange={(event) => {
                  setName(event.target.value);
                }}
                placeholder="Name or organisation"
              />
            </div>
            <div>
              <label className="vv-twin-enq-label" htmlFor="tw-enq-phone">
                Phone
              </label>
              <input
                id="tw-enq-phone"
                type="tel"
                autoComplete="tel"
                className="vv-twin-enq-input"
                value={phone}
                onChange={(event) => {
                  setPhone(event.target.value);
                }}
                placeholder="+44 …"
              />
            </div>
          </div>

          <div className="vv-twin-enq-row">
            <div>
              <label className="vv-twin-enq-label" htmlFor="tw-enq-date">
                Event date
              </label>
              <input
                id="tw-enq-date"
                type="date"
                className="vv-twin-enq-input"
                value={eventDate}
                onChange={(event) => {
                  setEventDate(event.target.value);
                }}
              />
            </div>
            <div>
              <label className="vv-twin-enq-label" htmlFor="tw-enq-guests">
                Guests
              </label>
              <input
                id="tw-enq-guests"
                type="number"
                min="0"
                className="vv-twin-enq-input"
                value={guestCount}
                onChange={(event) => {
                  setGuestCount(event.target.value);
                }}
                placeholder="Approx."
              />
            </div>
          </div>

          <label className="vv-twin-enq-label" htmlFor="tw-enq-type">
            Event type
          </label>
          <select
            id="tw-enq-type"
            className="vv-twin-enq-input vv-twin-enq-select"
            value={eventType}
            onChange={(event) => {
              setEventType(event.target.value);
            }}
          >
            <option value="">What are you planning?</option>
            <option value="wedding">Wedding</option>
            <option value="corporate">Corporate event</option>
            <option value="ceremony">Ceremony</option>
            <option value="concert">Concert or performance</option>
            <option value="private">Private celebration</option>
            <option value="other">Something else</option>
          </select>

          <label className="vv-twin-enq-label" htmlFor="tw-enq-message">
            Anything else?
          </label>
          <textarea
            id="tw-enq-message"
            className="vv-twin-enq-input vv-twin-enq-textarea"
            value={message}
            onChange={(event) => {
              setMessage(event.target.value);
            }}
            placeholder="Tell us about your event"
          />

          <button type="submit" className="vv-twin-enq-submit" disabled={isSubmitting}>
            {isSubmitting ? TWIN_ENQUIRE_SENDING : TWIN_ENQUIRE_CTA}
          </button>
          <p className="vv-twin-enq-trust">{TWIN_ENQUIRE_TRUST}</p>
        </form>
      </div>
    </div>
  );
}
