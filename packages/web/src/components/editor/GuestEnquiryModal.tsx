import { useState } from "react";
import { submitGuestEnquiry } from "../../api/configurations.js";

// ---------------------------------------------------------------------------
// GuestEnquiryModal — guest submission form
// ---------------------------------------------------------------------------

const overlayStyle: React.CSSProperties = {
  position: "fixed", inset: 0, background: "rgba(0,0,0,0.5)",
  display: "flex", alignItems: "center", justifyContent: "center",
  zIndex: 200, fontFamily: "'Inter', sans-serif",
};

const modalStyle: React.CSSProperties = {
  background: "#fff", borderRadius: 12, padding: 32, width: 440,
  maxWidth: "90vw", maxHeight: "90vh", overflowY: "auto",
  boxShadow: "0 20px 60px rgba(0,0,0,0.3)",
};

const titleStyle: React.CSSProperties = {
  fontSize: 20, fontWeight: 700, color: "#1a1a2e", marginBottom: 4,
};

const descStyle: React.CSSProperties = {
  fontSize: 13, color: "#666", marginBottom: 20,
};

const labelStyle: React.CSSProperties = {
  fontSize: 12, fontWeight: 600, color: "#555", display: "block", marginBottom: 4,
};

const inputStyle: React.CSSProperties = {
  width: "100%", padding: "8px 10px", fontSize: 14, border: "1px solid #ddd",
  borderRadius: 6, boxSizing: "border-box",
};

const fieldStyle: React.CSSProperties = { marginBottom: 14 };

const errorStyle: React.CSSProperties = {
  background: "#fef2f2", border: "1px solid #fecaca", borderRadius: 6,
  padding: "8px 12px", fontSize: 13, color: "#dc2626", marginBottom: 14,
};

const btnStyle: React.CSSProperties = {
  width: "100%", padding: "12px 16px", fontSize: 15, fontWeight: 600,
  background: "#1a1a2e", color: "#fff", border: "none", borderRadius: 6,
  cursor: "pointer",
};

const successStyle: React.CSSProperties = {
  textAlign: "center", padding: "20px 0",
};

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

  const handleSubmit = async (e: React.FormEvent): Promise<void> => {
    e.preventDefault();
    setError(null);

    if (email.trim() === "" || !email.includes("@")) {
      setError("Please enter a valid email address");
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
      setError(err instanceof Error ? err.message : "Failed to send enquiry");
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent): void => {
    if (e.key === "Escape") onClose();
  };

  if (submitted) {
    return (
      <div style={overlayStyle} onClick={onClose} onKeyDown={handleKeyDown} role="dialog" tabIndex={-1}>
        <div style={modalStyle} onClick={(e) => { e.stopPropagation(); }}>
          <div style={successStyle}>
            <div style={{ fontSize: 48, marginBottom: 16 }}>&#9989;</div>
            <h2 style={{ fontSize: 20, fontWeight: 700, color: "#1a1a2e", marginBottom: 8 }}>
              Enquiry Sent!
            </h2>
            <p style={{ fontSize: 14, color: "#666", marginBottom: 16 }}>
              Your layout has been sent to the Trades Hall events team.
              They&apos;ll be in touch at <strong>{email}</strong>.
            </p>
            <button
              type="button"
              style={{ ...btnStyle, background: "#2563eb", marginBottom: 8 }}
              onClick={() => {
                void navigator.clipboard.writeText(`${window.location.origin}/editor/${configId}`);
              }}
            >
              Copy Link to Your Layout
            </button>
            <button type="button" style={{ ...btnStyle, background: "#6b7280" }} onClick={onClose}>
              Close
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div style={overlayStyle} onClick={onClose} onKeyDown={handleKeyDown} role="dialog" tabIndex={-1}>
      <div style={modalStyle} onClick={(e) => { e.stopPropagation(); }}>
        <h2 style={titleStyle}>Send to Events Team</h2>
        <p style={descStyle}>Share your layout with the Trades Hall events team. No account needed.</p>

        {error !== null && <div style={errorStyle} role="alert">{error}</div>}

        <form onSubmit={(e) => { void handleSubmit(e); }} data-testid="guest-enquiry-form">
          <div style={fieldStyle}>
            <label style={labelStyle} htmlFor="ge-email">Email *</label>
            <input id="ge-email" type="email" style={inputStyle} value={email}
              onChange={(e) => { setEmail(e.target.value); }} placeholder="your@email.com" required />
          </div>

          <div style={fieldStyle}>
            <label style={labelStyle} htmlFor="ge-phone">Phone</label>
            <input id="ge-phone" type="tel" style={inputStyle} value={phone}
              onChange={(e) => { setPhone(e.target.value); }} placeholder="+44 7700 900000" />
            <span style={{ fontSize: 11, color: "#999" }}>Recommended so we can reach you quickly</span>
          </div>

          <div style={fieldStyle}>
            <label style={labelStyle} htmlFor="ge-name">Name</label>
            <input id="ge-name" type="text" style={inputStyle} value={name}
              onChange={(e) => { setName(e.target.value); }} placeholder="Your name or organisation" />
          </div>

          <div style={{ display: "flex", gap: 12, marginBottom: 14 }}>
            <div style={{ flex: 1 }}>
              <label style={labelStyle} htmlFor="ge-date">Event Date</label>
              <input id="ge-date" type="date" style={inputStyle} value={eventDate}
                onChange={(e) => { setEventDate(e.target.value); }} />
            </div>
            <div style={{ flex: 1 }}>
              <label style={labelStyle} htmlFor="ge-guests">Guest Count</label>
              <input id="ge-guests" type="number" style={inputStyle} value={guestCount}
                onChange={(e) => { setGuestCount(e.target.value); }} min="0" placeholder="0" />
            </div>
          </div>

          <div style={fieldStyle}>
            <label style={labelStyle} htmlFor="ge-type">Event Type</label>
            <select id="ge-type" style={inputStyle} value={eventType}
              onChange={(e) => { setEventType(e.target.value); }}>
              <option value="">Select...</option>
              <option value="wedding">Wedding</option>
              <option value="corporate">Corporate</option>
              <option value="ceremony">Ceremony</option>
              <option value="concert">Concert</option>
              <option value="private">Private Event</option>
              <option value="other">Other</option>
            </select>
          </div>

          <div style={fieldStyle}>
            <label style={labelStyle} htmlFor="ge-message">Message</label>
            <textarea id="ge-message" style={{ ...inputStyle, minHeight: 80, resize: "vertical" }} value={message}
              onChange={(e) => { setMessage(e.target.value); }} placeholder="Tell us about your event" />
          </div>

          <button type="submit" style={{ ...btnStyle, opacity: isSubmitting ? 0.7 : 1 }} disabled={isSubmitting}>
            {isSubmitting ? "Sending..." : "Send Enquiry"}
          </button>
        </form>
      </div>
    </div>
  );
}
