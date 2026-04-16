import { useEffect, useState } from "react";
import type { EventInstructions, PhaseDeadline, SetupPhase } from "@omnitwin/types";
import { emptyEventInstructions, PHASE_METADATA, SETUP_PHASES } from "@omnitwin/types";
import { useEditorStore } from "../../stores/editor-store.js";
import { patchConfigMetadata, getConfig } from "../../api/configurations.js";
import { GOLD, BORDER, CARD_BG, INPUT_BG, TEXT_MUT, TEXT_SEC } from "../../constants/ui-palette.js";

// ---------------------------------------------------------------------------
// EventDetailsPanel — modal-style drawer for event-level instructions.
//
// The planner fills this out once per configuration:
//   - Special instructions (free-form block, prominently surfaced)
//   - Day-of contact (name, role, phone, email)
//   - Access / load-in notes
//   - Optional per-phase deadlines
//
// Persists to configurations.metadata.instructions via the auth PATCH
// endpoint. Passing null clears all instructions.
// ---------------------------------------------------------------------------

export interface EventDetailsPanelProps {
  readonly open: boolean;
  readonly onClose: () => void;
}

export function EventDetailsPanel({ open, onClose }: EventDetailsPanelProps): React.ReactElement | null {
  const configId = useEditorStore((s) => s.configId);
  const [state, setState] = useState<EventInstructions>(emptyEventInstructions);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [savedAt, setSavedAt] = useState<Date | null>(null);

  // Load current metadata once when the panel opens. We hit the auth
  // GET endpoint rather than reading from the editor store because the
  // editor store deliberately only tracks placed-object state — config
  // metadata is a separate concern, independently versioned.
  useEffect(() => {
    if (!open || configId === null) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    void (async () => {
      try {
        const config = await getConfig(configId) as unknown as { metadata: unknown };
        if (cancelled) return;
        const raw = config.metadata as { instructions?: Partial<EventInstructions> } | null;
        const loaded = raw?.instructions;
        if (loaded !== undefined && loaded !== null) {
          setState({
            ...emptyEventInstructions(),
            ...loaded,
            dayOfContact: loaded.dayOfContact ?? null,
            phaseDeadlines: loaded.phaseDeadlines ?? [],
          });
        } else {
          setState(emptyEventInstructions());
        }
      } catch (err) {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : "Failed to load event details");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [open, configId]);

  if (!open) return null;

  const handleSave = async (): Promise<void> => {
    if (configId === null) return;
    setSaving(true);
    setError(null);
    try {
      await patchConfigMetadata(configId, { instructions: state });
      setSavedAt(new Date());
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save");
    } finally {
      setSaving(false);
    }
  };

  const updateContact = (patch: Partial<NonNullable<EventInstructions["dayOfContact"]>>): void => {
    setState((prev) => ({
      ...prev,
      dayOfContact: {
        ...(prev.dayOfContact ?? { name: "", role: "", phone: "", email: "" }),
        ...patch,
      },
    }));
  };

  const clearContact = (): void => {
    setState((prev) => ({ ...prev, dayOfContact: null }));
  };

  const updateDeadline = (index: number, patch: Partial<PhaseDeadline>): void => {
    setState((prev) => ({
      ...prev,
      phaseDeadlines: prev.phaseDeadlines.map((d, i) => i === index ? { ...d, ...patch } : d),
    }));
  };

  const addDeadline = (): void => {
    if (state.phaseDeadlines.length >= 8) return;
    setState((prev) => ({
      ...prev,
      phaseDeadlines: [...prev.phaseDeadlines, { phase: "furniture", deadline: defaultDeadlineTime(), reason: "" }],
    }));
  };

  const removeDeadline = (index: number): void => {
    setState((prev) => ({
      ...prev,
      phaseDeadlines: prev.phaseDeadlines.filter((_, i) => i !== index),
    }));
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Event details"
      style={{
        position: "fixed", inset: 0, zIndex: 100,
        background: "rgba(0,0,0,0.6)",
        display: "flex", alignItems: "flex-start", justifyContent: "center",
        overflowY: "auto",
      }}
      onClick={onClose}
    >
      <div
        onClick={(e) => { e.stopPropagation(); }}
        style={{
          width: 640, maxWidth: "calc(100% - 32px)",
          marginTop: 40, marginBottom: 40,
          background: CARD_BG,
          border: `1px solid ${BORDER}`, borderRadius: 12,
          color: "#ddd", fontFamily: "'Inter', system-ui, sans-serif",
        }}
      >
        <header style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: 18, borderBottom: `1px solid ${BORDER}` }}>
          <div>
            <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: "0.12em", color: GOLD, textTransform: "uppercase" }}>
              Event Details
            </div>
            <h2 style={{ fontSize: 18, margin: "4px 0 0", color: "#fff" }}>Instructions for the hallkeeper</h2>
            <p style={{ fontSize: 12, color: TEXT_SEC, margin: "4px 0 0" }}>
              Fill these in and they'll appear on the PDF and tablet sheet.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            style={{ padding: 6, fontSize: 18, background: "transparent", color: TEXT_SEC, border: "none", cursor: "pointer" }}
          >
            ×
          </button>
        </header>

        <div style={{ padding: 18, display: "flex", flexDirection: "column", gap: 18 }}>
          {loading && <div style={{ fontSize: 12, color: TEXT_SEC }}>Loading…</div>}
          {error !== null && (
            <div role="alert" style={{ fontSize: 12, color: "#ef4444", background: "rgba(239,68,68,0.1)", padding: 10, borderRadius: 6 }}>
              {error}
            </div>
          )}

          <Section title="Special instructions" hint="Fire safety, VIP notes, board arrival times, anything the hallkeeper must know.">
            <textarea
              value={state.specialInstructions}
              onChange={(e) => { setState((s) => ({ ...s, specialInstructions: e.target.value.slice(0, 4000) })); }}
              rows={5}
              placeholder="e.g. Fire exits must remain clear. Board arriving at 6:45pm. Bride's family seated at table 3."
              style={textareaStyle}
            />
          </Section>

          <Section title="Day-of contact" hint="The planner's number for the day — who the hallkeeper rings if something goes wrong.">
            {state.dayOfContact !== null ? (
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
                <Field label="Name">
                  <input
                    type="text" value={state.dayOfContact.name}
                    onChange={(e) => { updateContact({ name: e.target.value.slice(0, 120) }); }}
                    style={inputStyle}
                  />
                </Field>
                <Field label="Role">
                  <input
                    type="text" value={state.dayOfContact.role}
                    onChange={(e) => { updateContact({ role: e.target.value.slice(0, 120) }); }}
                    placeholder="Planner, MOH, best man…"
                    style={inputStyle}
                  />
                </Field>
                <Field label="Phone">
                  <input
                    type="tel" value={state.dayOfContact.phone}
                    onChange={(e) => { updateContact({ phone: e.target.value.slice(0, 40) }); }}
                    placeholder="+44 …"
                    style={inputStyle}
                  />
                </Field>
                <Field label="Email">
                  <input
                    type="email" value={state.dayOfContact.email}
                    onChange={(e) => { updateContact({ email: e.target.value.slice(0, 255) }); }}
                    style={inputStyle}
                  />
                </Field>
                <button type="button" onClick={clearContact} style={secondaryBtnStyle}>Remove contact</button>
              </div>
            ) : (
              <button
                type="button"
                onClick={() => { updateContact({ name: "", role: "", phone: "", email: "" }); }}
                style={secondaryBtnStyle}
              >
                + Add day-of contact
              </button>
            )}
          </Section>

          <Section title="Access & load-in notes" hint="Service entrance, parking, load-in sequencing.">
            <textarea
              value={state.accessNotes}
              onChange={(e) => { setState((s) => ({ ...s, accessNotes: e.target.value.slice(0, 1500) })); }}
              rows={3}
              placeholder="Service entrance at south door. Parking in cobbled yard. No vehicles after 15:00."
              style={textareaStyle}
            />
          </Section>

          <Section title="Phase deadlines" hint="Optional — override the default setup-by time with per-phase milestones.">
            {state.phaseDeadlines.map((d, i) => (
              <div key={`${String(i)}-${d.phase}`} style={{ display: "grid", gridTemplateColumns: "120px 160px 1fr 28px", gap: 6, alignItems: "center", marginBottom: 6 }}>
                <select value={d.phase} onChange={(e) => { updateDeadline(i, { phase: e.target.value as SetupPhase }); }} style={inputStyle}>
                  {SETUP_PHASES.map((p) => <option key={p} value={p}>{PHASE_METADATA[p].label}</option>)}
                </select>
                <input
                  type="datetime-local"
                  value={toDateTimeLocal(d.deadline)}
                  onChange={(e) => { updateDeadline(i, { deadline: fromDateTimeLocal(e.target.value) }); }}
                  style={inputStyle}
                />
                <input
                  type="text" value={d.reason}
                  onChange={(e) => { updateDeadline(i, { reason: e.target.value.slice(0, 200) }); }}
                  placeholder="Reason (optional)"
                  style={inputStyle}
                />
                <button type="button" onClick={() => { removeDeadline(i); }} aria-label="Remove deadline" style={iconBtnStyle}>×</button>
              </div>
            ))}
            {state.phaseDeadlines.length < 8 && (
              <button type="button" onClick={addDeadline} style={secondaryBtnStyle}>+ Add deadline</button>
            )}
          </Section>
        </div>

        <footer style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: 18, borderTop: `1px solid ${BORDER}`, background: "#17171a" }}>
          <div style={{ fontSize: 11, color: TEXT_SEC }}>
            {savedAt !== null ? `Saved at ${savedAt.toLocaleTimeString()}` : "Not saved yet"}
          </div>
          <div style={{ display: "flex", gap: 8 }}>
            <button type="button" onClick={onClose} style={secondaryBtnStyle}>Close</button>
            <button
              type="button"
              onClick={() => { void handleSave(); }}
              disabled={saving || configId === null}
              style={{
                ...primaryBtnStyle,
                opacity: saving || configId === null ? 0.6 : 1,
                cursor: saving || configId === null ? "default" : "pointer",
              }}
            >
              {saving ? "Saving…" : "Save"}
            </button>
          </div>
        </footer>
      </div>
    </div>
  );
}

function Section({ title, hint, children }: { title: string; hint: string; children: React.ReactNode }): React.ReactElement {
  return (
    <section>
      <div style={{ fontSize: 11, fontWeight: 700, color: "#fff", letterSpacing: "0.04em", textTransform: "uppercase" }}>
        {title}
      </div>
      <div style={{ fontSize: 11, color: TEXT_MUT, margin: "2px 0 6px" }}>{hint}</div>
      {children}
    </section>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }): React.ReactElement {
  return (
    <label style={{ display: "flex", flexDirection: "column", gap: 3 }}>
      <span style={{ fontSize: 10, color: TEXT_MUT, textTransform: "uppercase", letterSpacing: "0.04em" }}>{label}</span>
      {children}
    </label>
  );
}

const inputStyle: React.CSSProperties = {
  padding: "6px 8px", borderRadius: 4,
  background: INPUT_BG, color: "#eee",
  border: `1px solid ${BORDER}`,
  fontSize: 13, fontFamily: "inherit",
  width: "100%", boxSizing: "border-box",
};

const textareaStyle: React.CSSProperties = {
  ...inputStyle, resize: "vertical", minHeight: 60,
};

const primaryBtnStyle: React.CSSProperties = {
  padding: "8px 16px", fontSize: 13, fontWeight: 600,
  background: GOLD, color: "#111",
  border: "none", borderRadius: 6, cursor: "pointer",
  fontFamily: "inherit",
};

const secondaryBtnStyle: React.CSSProperties = {
  padding: "6px 12px", fontSize: 12,
  background: "transparent", color: TEXT_SEC,
  border: `1px solid ${BORDER}`, borderRadius: 6,
  cursor: "pointer", fontFamily: "inherit",
};

const iconBtnStyle: React.CSSProperties = {
  width: 28, height: 28, padding: 0,
  background: "transparent", color: TEXT_SEC,
  border: `1px solid ${BORDER}`, borderRadius: 4,
  cursor: "pointer", fontSize: 14,
  fontFamily: "inherit",
};

/**
 * Convert a browser datetime-local string ("2026-06-15T18:00") to ISO UTC.
 * The datetime-local value is in the user's local timezone; converting
 * through new Date() normalises it to the correct ISO.
 */
function fromDateTimeLocal(local: string): string {
  if (local === "") return new Date().toISOString();
  const d = new Date(local);
  if (Number.isNaN(d.getTime())) return new Date().toISOString();
  return d.toISOString();
}

/**
 * Convert an ISO UTC string back to a datetime-local-compatible string.
 * Strips seconds and the trailing Z, and uses local time components.
 */
function toDateTimeLocal(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const pad = (n: number): string => String(n).padStart(2, "0");
  const yyyy = d.getFullYear();
  const mm = pad(d.getMonth() + 1);
  const dd = pad(d.getDate());
  const hh = pad(d.getHours());
  const mi = pad(d.getMinutes());
  return `${String(yyyy)}-${mm}-${dd}T${hh}:${mi}`;
}

function defaultDeadlineTime(): string {
  // Default to "tomorrow at 16:30 local" — sane starting point for
  // events scheduled in the next few days. The planner changes it.
  const d = new Date();
  d.setDate(d.getDate() + 1);
  d.setHours(16, 30, 0, 0);
  return d.toISOString();
}
