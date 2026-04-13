import { useState, useCallback, useEffect, useRef } from "react";
import { submitGuestEnquiry } from "../../api/configurations.js";
import { usePlacementStore } from "../../stores/placement-store.js";
import { CATALOGUE_ITEMS } from "../../lib/catalogue.js";
import { useFocusTrap } from "../../lib/use-focus-trap.js";

// ---------------------------------------------------------------------------
// GuestEnquiryModal — premium conversion moment
// ---------------------------------------------------------------------------

const GOLD = "#c9a84c";
const GOLD_LIGHT = "#dfc06a";
const CHARCOAL = "#111113";
const GLASS = "rgba(16,16,16,0.97)";

// Inject animation keyframes once
const STYLE_ID = "omni-enquiry-modal";
if (typeof document !== "undefined" && document.getElementById(STYLE_ID) === null) {
  const s = document.createElement("style");
  s.id = STYLE_ID;
  s.textContent = `
    @keyframes omni-enq-overlay { 0% { opacity: 0; } 100% { opacity: 1; } }
    @keyframes omni-enq-in {
      0%   { opacity: 0; transform: scale(0.92) translateY(20px); filter: blur(8px); }
      100% { opacity: 1; transform: scale(1) translateY(0); filter: blur(0); }
    }
    @keyframes omni-enq-success {
      0%   { opacity: 0; transform: scale(0.8); }
      50%  { transform: scale(1.04); }
      100% { opacity: 1; transform: scale(1); }
    }
    @keyframes omni-enq-check {
      0%   { stroke-dashoffset: 24; }
      100% { stroke-dashoffset: 0; }
    }
    @keyframes omni-enq-glow {
      0%, 100% { box-shadow: 0 0 40px rgba(201,168,76,0.08), 0 24px 80px rgba(0,0,0,0.5); }
      50%      { box-shadow: 0 0 60px rgba(201,168,76,0.15), 0 28px 90px rgba(0,0,0,0.6); }
    }
    .omni-enq-input {
      width: 100%; padding: 11px 14px; font-size: 14px; font-family: 'Inter', system-ui, sans-serif;
      background: rgba(255,255,255,0.04); border: 1px solid rgba(255,255,255,0.1);
      border-radius: 10px; color: #f0f0f0; outline: none;
      transition: border-color 0.2s, box-shadow 0.2s, background 0.2s;
    }
    .omni-enq-input::placeholder { color: rgba(255,255,255,0.25); }
    .omni-enq-input:focus {
      border-color: rgba(201,168,76,0.4); background: rgba(255,255,255,0.06);
      box-shadow: 0 0 0 3px rgba(201,168,76,0.08);
    }
    .omni-enq-input:hover:not(:focus) { border-color: rgba(255,255,255,0.18); }
    .omni-enq-select { cursor: pointer; appearance: none;
      background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 24 24' fill='none' stroke='%23c9a84c' stroke-width='2'%3E%3Cpolyline points='6 9 12 15 18 9'/%3E%3C/svg%3E");
      background-repeat: no-repeat; background-position: right 12px center; padding-right: 32px;
    }
    .omni-enq-select option { background: #1a1a1a; color: #f0f0f0; }
  `;
  document.head.appendChild(s);
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Build a human-readable summary of the current layout. */
function getLayoutSummary(): string {
  const items = usePlacementStore.getState().placedItems;
  if (items.length === 0) return "Empty layout";
  const counts = new Map<string, number>();
  for (const item of items) {
    const cat = CATALOGUE_ITEMS.find((c) => c.id === item.catalogueItemId);
    const label = cat?.name ?? item.catalogueItemId;
    counts.set(label, (counts.get(label) ?? 0) + 1);
  }
  const parts: string[] = [];
  for (const [label, count] of counts) {
    parts.push(count > 1 ? `${String(count)}x ${label}` : label);
  }
  return parts.join(", ");
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

interface GuestEnquiryModalProps {
  readonly configId: string;
  readonly onClose: () => void;
}

export function GuestEnquiryModal({ configId, onClose }: GuestEnquiryModalProps): React.ReactElement {
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [name, setName] = useState("");
  const [eventDate, setEventDate] = useState("");
  const [eventType, setEventType] = useState("");
  const [guestCount, setGuestCount] = useState("");
  const [message, setMessage] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [emailTouched, setEmailTouched] = useState(false);
  const [copied, setCopied] = useState<"idle" | "success" | "fail">("idle");
  const emailRef = useRef<HTMLInputElement>(null);
  const trapRef = useFocusTrap<HTMLDivElement>();

  // Auto-focus email on open
  useEffect(() => {
    const timer = setTimeout(() => { emailRef.current?.focus(); }, 100);
    return () => { clearTimeout(timer); };
  }, []);

  const emailValid = EMAIL_RE.test(email.trim());
  const showEmailHint = emailTouched && email.trim().length > 0 && !emailValid;

  const handleSubmit = useCallback(async (e: React.FormEvent): Promise<void> => {
    e.preventDefault();
    setError(null);

    if (!emailValid) {
      setEmailTouched(true);
      setError("We need a valid email so the events team can reach you");
      emailRef.current?.focus();
      return;
    }

    setIsSubmitting(true);
    try {
      await submitGuestEnquiry({
        configurationId: configId,
        email: email.trim(),
        phone: phone.trim() !== "" ? phone.trim() : undefined,
        name: name.trim() !== "" ? name.trim() : undefined,
        eventDate: eventDate !== "" ? eventDate : undefined,
        eventType: eventType !== "" ? eventType : undefined,
        guestCount: guestCount !== "" ? parseInt(guestCount, 10) : undefined,
        message: message.trim() !== "" ? message.trim() : undefined,
      });
      setSubmitted(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong — please try again");
    } finally {
      setIsSubmitting(false);
    }
  }, [configId, email, phone, name, eventDate, eventType, guestCount, message, emailValid]);

  const handleCopy = useCallback(async (): Promise<void> => {
    try {
      await navigator.clipboard.writeText(`${window.location.origin}/editor/${configId}`);
      setCopied("success");
      setTimeout(() => { setCopied("idle"); }, 2500);
    } catch {
      setCopied("fail");
      setTimeout(() => { setCopied("idle"); }, 2500);
    }
  }, [configId]);

  const handleKeyDown = useCallback((e: React.KeyboardEvent): void => {
    if (e.key === "Escape") onClose();
  }, [onClose]);

  // `split(...)[0]` is `string | undefined` under noUncheckedIndexedAccess, so
  // coalesce to null up-front and keep the render-side check as a single
  // is-non-null comparison.
  const displayName: string | null = name.trim() !== "" ? (name.trim().split(/\s+/)[0] ?? null) : null;
  const layoutSummary = getLayoutSummary();

  // -----------------------------------------------------------------------
  // Success state
  // -----------------------------------------------------------------------

  if (submitted) {
    return (
      <div
        style={{
          position: "fixed", inset: 0, background: "rgba(0,0,0,0.7)",
          display: "flex", alignItems: "center", justifyContent: "center",
          zIndex: 200, fontFamily: "'Inter', system-ui, sans-serif",
          animation: "omni-enq-overlay 0.3s ease forwards",
        }}
        onClick={onClose}
        onKeyDown={handleKeyDown}
        role="dialog"
        aria-modal="true"
        aria-labelledby="enquiry-success-title"
        tabIndex={-1}
      >
        <div
          ref={trapRef}
          style={{
            background: `linear-gradient(145deg, ${GLASS}, rgba(22,22,22,0.98))`,
            backdropFilter: "blur(24px)", WebkitBackdropFilter: "blur(24px)",
            borderRadius: 24, padding: "44px 40px 36px", width: 460, maxWidth: "90vw",
            border: "1px solid rgba(201,168,76,0.15)",
            animation: "omni-enq-success 0.5s cubic-bezier(0.16, 1, 0.3, 1) forwards",
            textAlign: "center",
          }}
          onClick={(e) => { e.stopPropagation(); }}
        >
          {/* Animated check circle */}
          <div style={{ marginBottom: 20 }}>
            <svg width="64" height="64" viewBox="0 0 64 64" fill="none" aria-hidden="true">
              <circle cx="32" cy="32" r="30" stroke={GOLD} strokeWidth="2" opacity="0.2" />
              <circle cx="32" cy="32" r="30" stroke={GOLD} strokeWidth="2"
                strokeDasharray="188" strokeDashoffset="0"
                style={{ animation: "omni-enq-check 0.6s ease 0.2s both" }} />
              <polyline points="22,33 29,40 42,26" stroke={GOLD_LIGHT} strokeWidth="3"
                strokeLinecap="round" strokeLinejoin="round" fill="none"
                strokeDasharray="24" strokeDashoffset="0"
                style={{ animation: "omni-enq-check 0.4s ease 0.5s both" }} />
            </svg>
          </div>

          <h2 id="enquiry-success-title" style={{
            fontSize: 26, fontWeight: 700, color: "#f5f5f5",
            fontFamily: "'Playfair Display', serif", marginBottom: 8,
          }}>
            {displayName !== null ? `Beautiful work, ${displayName}` : "Your layout is on its way"}
          </h2>

          <p style={{
            fontSize: 14, color: "rgba(255,255,255,0.5)", lineHeight: 1.6,
            marginBottom: 8, maxWidth: 340, marginLeft: "auto", marginRight: "auto",
          }}>
            The Trades Hall events team now has your layout and will be in touch at
          </p>
          <p style={{
            fontSize: 15, fontWeight: 600, color: GOLD, marginBottom: 24,
          }}>
            {email}
          </p>

          {/* Layout summary chip */}
          <div style={{
            display: "inline-block", padding: "6px 16px", borderRadius: 20,
            background: "rgba(201,168,76,0.08)", border: "1px solid rgba(201,168,76,0.12)",
            fontSize: 12, color: "rgba(255,255,255,0.45)", marginBottom: 28,
            maxWidth: "100%", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
          }}>
            {layoutSummary}
          </div>

          {/* Copy link button */}
          <button
            type="button"
            style={{
              width: "100%", padding: "13px 20px", fontSize: 14, fontWeight: 600,
              fontFamily: "'Inter', system-ui, sans-serif",
              background: copied === "success"
                ? "rgba(34,197,94,0.12)"
                : copied === "fail"
                  ? "rgba(239,68,68,0.12)"
                  : "rgba(255,255,255,0.05)",
              border: `1px solid ${copied === "success" ? "rgba(34,197,94,0.3)" : copied === "fail" ? "rgba(239,68,68,0.3)" : "rgba(255,255,255,0.1)"}`,
              borderRadius: 12, cursor: "pointer",
              color: copied === "success" ? "#22c55e" : copied === "fail" ? "#ef4444" : "rgba(255,255,255,0.7)",
              transition: "all 0.25s ease", marginBottom: 10,
              letterSpacing: 0.2,
            }}
            onClick={() => { void handleCopy(); }}
          >
            {copied === "success" ? "Copied to clipboard" : copied === "fail" ? "Couldn\u2019t copy \u2014 try manually" : "Copy link to your layout"}
          </button>

          {/* Close */}
          <button
            type="button"
            style={{
              width: "100%", padding: "13px 20px", fontSize: 14, fontWeight: 600,
              fontFamily: "'Inter', system-ui, sans-serif",
              background: `linear-gradient(135deg, ${GOLD}, #a8893e)`,
              border: "none", borderRadius: 12, cursor: "pointer",
              color: CHARCOAL, letterSpacing: 0.3,
              boxShadow: `0 4px 20px rgba(201,168,76,0.25)`,
              transition: "all 0.2s ease",
            }}
            onClick={onClose}
            onMouseEnter={(e) => { e.currentTarget.style.boxShadow = `0 6px 28px rgba(201,168,76,0.4)`; e.currentTarget.style.transform = "translateY(-1px)"; }}
            onMouseLeave={(e) => { e.currentTarget.style.boxShadow = `0 4px 20px rgba(201,168,76,0.25)`; e.currentTarget.style.transform = ""; }}
          >
            Back to your layout
          </button>
        </div>
      </div>
    );
  }

  // -----------------------------------------------------------------------
  // Form state
  // -----------------------------------------------------------------------

  return (
    <div
      style={{
        position: "fixed", inset: 0, background: "rgba(0,0,0,0.7)",
        display: "flex", alignItems: "center", justifyContent: "center",
        zIndex: 200, fontFamily: "'Inter', system-ui, sans-serif",
        animation: "omni-enq-overlay 0.3s ease forwards",
      }}
      onClick={onClose}
      onKeyDown={handleKeyDown}
      role="dialog"
      aria-modal="true"
      aria-labelledby="enquiry-form-title"
      tabIndex={-1}
    >
      <div
        ref={trapRef}
        style={{
          background: `linear-gradient(145deg, ${GLASS}, rgba(22,22,22,0.98))`,
          backdropFilter: "blur(24px)", WebkitBackdropFilter: "blur(24px)",
          borderRadius: 24, padding: "36px 36px 32px", width: 480, maxWidth: "90vw",
          maxHeight: "90vh", overflowY: "auto",
          border: "1px solid rgba(201,168,76,0.15)",
          animation: "omni-enq-in 0.45s cubic-bezier(0.16, 1, 0.3, 1) forwards, omni-enq-glow 4s ease-in-out 1s infinite",
        }}
        onClick={(e) => { e.stopPropagation(); }}
      >
        {/* Gold accent bar */}
        <div style={{
          width: 40, height: 3, borderRadius: 2,
          background: `linear-gradient(90deg, ${GOLD}, rgba(201,168,76,0.3))`,
          marginBottom: 20,
        }} />

        {/* Header */}
        <div style={{ marginBottom: 24 }}>
          <div style={{
            fontSize: 10, fontWeight: 600, textTransform: "uppercase" as const,
            letterSpacing: 2.5, color: GOLD, marginBottom: 6,
          }}>
            Almost there
          </div>
          <h2 id="enquiry-form-title" style={{
            fontSize: 24, fontWeight: 700, color: "#f5f5f5",
            fontFamily: "'Playfair Display', serif", marginBottom: 8,
            lineHeight: 1.2,
          }}>
            Send your layout to the events team
          </h2>
          <p style={{
            fontSize: 13, color: "rgba(255,255,255,0.4)", lineHeight: 1.5,
          }}>
            No account needed. They&apos;ll review your setup and get back to you with availability and pricing.
          </p>
        </div>

        {/* Layout summary */}
        <div style={{
          padding: "10px 14px", borderRadius: 10, marginBottom: 24,
          background: "rgba(201,168,76,0.05)", border: "1px solid rgba(201,168,76,0.1)",
          fontSize: 12, color: "rgba(255,255,255,0.45)", lineHeight: 1.5,
          overflow: "hidden", textOverflow: "ellipsis",
          display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical" as const,
        }}>
          <span style={{ color: "rgba(201,168,76,0.6)", fontWeight: 600, marginRight: 6 }}>Your layout:</span>
          {layoutSummary}
        </div>

        {error !== null && (
          <div role="alert" style={{
            padding: "10px 14px", borderRadius: 10, marginBottom: 16,
            background: "rgba(239,68,68,0.08)", border: "1px solid rgba(239,68,68,0.2)",
            fontSize: 13, color: "#f87171", lineHeight: 1.4,
          }}>
            {error}
          </div>
        )}

        <form onSubmit={(e) => { void handleSubmit(e); }} data-testid="guest-enquiry-form">
          {/* Email — required */}
          <div style={{ marginBottom: 16 }}>
            <label htmlFor="ge-email" style={{
              display: "block", fontSize: 12, fontWeight: 600,
              color: "rgba(255,255,255,0.5)", marginBottom: 6, letterSpacing: 0.3,
            }}>
              Email <span style={{ color: GOLD }}>*</span>
            </label>
            <input
              ref={emailRef}
              id="ge-email"
              type="email"
              className="omni-enq-input"
              value={email}
              onChange={(e) => { setEmail(e.target.value); if (!emailTouched) setEmailTouched(true); }}
              onBlur={() => { setEmailTouched(true); }}
              placeholder="you@example.com"
              required
              autoComplete="email"
              style={showEmailHint ? { borderColor: "rgba(251,191,36,0.4)" } : undefined}
            />
            {showEmailHint && (
              <div style={{
                fontSize: 11, color: "#fbbf24", marginTop: 5, lineHeight: 1.3,
                transition: "opacity 0.2s",
              }}>
                Almost — just needs a valid email address
              </div>
            )}
          </div>

          {/* Name + Phone side by side */}
          <div style={{ display: "flex", gap: 12, marginBottom: 16 }}>
            <div style={{ flex: 1 }}>
              <label htmlFor="ge-name" style={{
                display: "block", fontSize: 12, fontWeight: 600,
                color: "rgba(255,255,255,0.5)", marginBottom: 6, letterSpacing: 0.3,
              }}>
                Your name
              </label>
              <input
                id="ge-name"
                type="text"
                className="omni-enq-input"
                value={name}
                onChange={(e) => { setName(e.target.value); }}
                placeholder="First name or organisation"
                autoComplete="name"
              />
            </div>
            <div style={{ flex: 1 }}>
              <label htmlFor="ge-phone" style={{
                display: "block", fontSize: 12, fontWeight: 600,
                color: "rgba(255,255,255,0.5)", marginBottom: 6, letterSpacing: 0.3,
              }}>
                Phone <span style={{ fontSize: 10, color: "rgba(255,255,255,0.25)", fontWeight: 400 }}>recommended</span>
              </label>
              <input
                id="ge-phone"
                type="tel"
                className="omni-enq-input"
                value={phone}
                onChange={(e) => { setPhone(e.target.value); }}
                placeholder="+44 7700 900000"
                autoComplete="tel"
              />
            </div>
          </div>

          {/* Event date + guest count */}
          <div style={{ display: "flex", gap: 12, marginBottom: 16 }}>
            <div style={{ flex: 1 }}>
              <label htmlFor="ge-date" style={{
                display: "block", fontSize: 12, fontWeight: 600,
                color: "rgba(255,255,255,0.5)", marginBottom: 6, letterSpacing: 0.3,
              }}>
                Event date
              </label>
              <input
                id="ge-date"
                type="date"
                className="omni-enq-input"
                value={eventDate}
                onChange={(e) => { setEventDate(e.target.value); }}
              />
            </div>
            <div style={{ flex: 1 }}>
              <label htmlFor="ge-guests" style={{
                display: "block", fontSize: 12, fontWeight: 600,
                color: "rgba(255,255,255,0.5)", marginBottom: 6, letterSpacing: 0.3,
              }}>
                Guest count
              </label>
              <input
                id="ge-guests"
                type="number"
                className="omni-enq-input"
                value={guestCount}
                onChange={(e) => { setGuestCount(e.target.value); }}
                min="0"
                placeholder="Approx. number"
              />
            </div>
          </div>

          {/* Event type */}
          <div style={{ marginBottom: 16 }}>
            <label htmlFor="ge-type" style={{
              display: "block", fontSize: 12, fontWeight: 600,
              color: "rgba(255,255,255,0.5)", marginBottom: 6, letterSpacing: 0.3,
            }}>
              Event type
            </label>
            <select
              id="ge-type"
              className="omni-enq-input omni-enq-select"
              value={eventType}
              onChange={(e) => { setEventType(e.target.value); }}
            >
              <option value="">What are you planning?</option>
              <option value="wedding">Wedding</option>
              <option value="corporate">Corporate Event</option>
              <option value="ceremony">Ceremony</option>
              <option value="concert">Concert or Performance</option>
              <option value="private">Private Celebration</option>
              <option value="other">Something Else</option>
            </select>
          </div>

          {/* Message */}
          <div style={{ marginBottom: 24 }}>
            <label htmlFor="ge-message" style={{
              display: "block", fontSize: 12, fontWeight: 600,
              color: "rgba(255,255,255,0.5)", marginBottom: 6, letterSpacing: 0.3,
            }}>
              Anything else?
            </label>
            <textarea
              id="ge-message"
              className="omni-enq-input"
              style={{ minHeight: 72, resize: "vertical" }}
              value={message}
              onChange={(e) => { setMessage(e.target.value); }}
              placeholder="Tell us about your event — we'd love to hear the details"
            />
          </div>

          {/* Submit CTA */}
          <button
            type="submit"
            disabled={isSubmitting}
            style={{
              width: "100%", padding: "14px 20px", fontSize: 15, fontWeight: 700,
              fontFamily: "'Inter', system-ui, sans-serif",
              background: isSubmitting
                ? "rgba(201,168,76,0.5)"
                : `linear-gradient(135deg, ${GOLD}, #a8893e)`,
              border: "none", borderRadius: 12, cursor: isSubmitting ? "wait" : "pointer",
              color: CHARCOAL, letterSpacing: 0.3,
              boxShadow: `0 4px 24px rgba(201,168,76,0.25)`,
              transition: "all 0.2s ease",
            }}
            onMouseEnter={(e) => { if (!isSubmitting) { e.currentTarget.style.boxShadow = `0 6px 32px rgba(201,168,76,0.4)`; e.currentTarget.style.transform = "translateY(-1px)"; } }}
            onMouseLeave={(e) => { e.currentTarget.style.boxShadow = `0 4px 24px rgba(201,168,76,0.25)`; e.currentTarget.style.transform = ""; }}
          >
            {isSubmitting ? "Sending your layout\u2026" : "Send to Events Team"}
          </button>

          {/* Trust signal */}
          <p style={{
            textAlign: "center", fontSize: 11, color: "rgba(255,255,255,0.2)",
            marginTop: 14, lineHeight: 1.4,
          }}>
            Your details are shared only with the Trades Hall events team. No spam, ever.
          </p>
        </form>
      </div>
    </div>
  );
}
