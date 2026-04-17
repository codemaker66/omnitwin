import { useEffect, useState } from "react";
import type { EventInstructions, PhaseDeadline, SetupPhase } from "@omnitwin/types";
import { emptyEventInstructions, PHASE_METADATA, SETUP_PHASES, ConfigurationMetadataSchema } from "@omnitwin/types";
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
//
// The panel is only usable for claimed configs (isPublicPreview=false).
// Unclaimed public-preview configs cannot authenticate against the PATCH
// endpoint, so the panel renders a "Sign in to save" hint instead of
// opening the form — this avoids a silent 401 after the planner writes
// a long special-instructions block.
// ---------------------------------------------------------------------------

export interface EventDetailsPanelProps {
  readonly open: boolean;
  readonly onClose: () => void;
}

export function EventDetailsPanel({ open, onClose }: EventDetailsPanelProps): React.ReactElement | null {
  const configId = useEditorStore((s) => s.configId);
  const isPublicPreview = useEditorStore((s) => s.isPublicPreview);
  // `state === null` means "not hydrated yet" — distinct from
  // `emptyEventInstructions()` which represents a real saved-empty blob.
  // Holding null until the GET resolves prevents a mid-load Save from
  // wiping real data on the server (the form is hidden while null).
  const [state, setState] = useState<EventInstructions | null>(null);
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
    if (isPublicPreview) {
      // Public-preview configs aren't reachable via the auth endpoints.
      // Render the sign-in affordance instead of attempting a load.
      setState(null);
      setLoading(false);
      return;
    }
    // Use a mutable property on a captured object so TS doesn't narrow
    // the cancellation flag to `false` inside the async closure.
    const guard = { cancelled: false };
    setLoading(true);
    setError(null);
    setState(null);
    void (async () => {
      try {
        const config = await getConfig(configId);
        if (guard.cancelled) return;
        // Narrow the unknown metadata blob at the point we actually
        // consume it. The response-schema uses z.unknown() so the
        // JSONB survives Zod strip-mode; here is where we validate it
        // against the canonical shape the panel edits.
        const parsed = ConfigurationMetadataSchema.nullable().safeParse(config.metadata ?? null);
        const loaded = parsed.success ? parsed.data?.instructions : undefined;
        if (loaded !== undefined) {
          // Spread the parsed blob verbatim — Zod .default()s on the
          // EventInstructions fields guarantee dayOfContact/phaseDeadlines
          // are present post-parse, so no `??` fallbacks are needed here.
          setState({ ...emptyEventInstructions(), ...loaded });
        } else {
          setState(emptyEventInstructions());
        }
      } catch (err) {
        if (guard.cancelled) return;
        setError(err instanceof Error ? err.message : "Failed to load event details");
        setState(emptyEventInstructions());
      } finally {
        if (!guard.cancelled) setLoading(false);
      }
    })();
    return () => { guard.cancelled = true; };
  }, [open, configId, isPublicPreview]);

  if (!open) return null;

  const handleSave = async (): Promise<void> => {
    if (configId === null || state === null) return;
    setSaving(true);
    setError(null);
    try {
      // Scrub a dangling empty-name contact before the PATCH: the server
      // schema requires dayOfContact.name to be non-empty (min(1)). An
      // empty draft should be treated as "no contact" rather than a 400.
      const payload = normalizeForSave(state);
      await patchConfigMetadata(configId, { instructions: payload });
      setSavedAt(new Date());
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save");
    } finally {
      setSaving(false);
    }
  };

  const updateContact = (patch: Partial<NonNullable<EventInstructions["dayOfContact"]>>): void => {
    setState((prev) => {
      if (prev === null) return prev;
      return {
        ...prev,
        dayOfContact: {
          ...(prev.dayOfContact ?? { name: "", role: "", phone: "", email: "" }),
          ...patch,
        },
      };
    });
  };

  const clearContact = (): void => {
    setState((prev) => prev === null ? prev : { ...prev, dayOfContact: null });
  };

  const updateDeadline = (index: number, patch: Partial<PhaseDeadline>): void => {
    setState((prev) => {
      if (prev === null) return prev;
      return {
        ...prev,
        phaseDeadlines: prev.phaseDeadlines.map((d, i) => i === index ? { ...d, ...patch } : d),
      };
    });
  };

  const addDeadline = (): void => {
    setState((prev) => {
      if (prev === null) return prev;
      if (prev.phaseDeadlines.length >= SETUP_PHASES.length) return prev;
      return {
        ...prev,
        phaseDeadlines: [...prev.phaseDeadlines, { phase: "furniture", deadline: defaultDeadlineTime(), reason: "" }],
      };
    });
  };

  const removeDeadline = (index: number): void => {
    setState((prev) => {
      if (prev === null) return prev;
      return {
        ...prev,
        phaseDeadlines: prev.phaseDeadlines.filter((_, i) => i !== index),
      };
    });
  };

  const signInRequired = isPublicPreview;
  const saveBlocked = computeSaveBlocked({ saving, loading, configId, state });

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
          {signInRequired && (
            <div role="status" style={{
              fontSize: 12, color: GOLD,
              background: "rgba(201,168,76,0.08)",
              border: `1px solid rgba(201,168,76,0.2)`,
              padding: 12, borderRadius: 6,
            }}>
              Event details persist to your saved layout. Sign in and claim this
              layout to add instructions for the hallkeeper — that way only you
              can edit them later.
            </div>
          )}
          {!signInRequired && loading && <div style={{ fontSize: 12, color: TEXT_SEC }}>Loading…</div>}
          {error !== null && (
            <div role="alert" style={{ fontSize: 12, color: "#ef4444", background: "rgba(239,68,68,0.1)", padding: 10, borderRadius: 6 }}>
              {error}
            </div>
          )}

          {!signInRequired && state !== null && (
            <>
              <Section title="Special instructions" hint="Fire safety, VIP notes, board arrival times, anything the hallkeeper must know.">
                <textarea
                  value={state.specialInstructions}
                  onChange={(e) => { setState((s) => s === null ? s : ({ ...s, specialInstructions: e.target.value.slice(0, 4000) })); }}
                  rows={5}
                  placeholder="e.g. Fire exits must remain clear. Board arriving at 6:45pm. Bride's family seated at table 3."
                  style={textareaStyle}
                />
              </Section>

              <Section title="Day-of contact" hint="The planner's number for the day — who the hallkeeper rings if something goes wrong.">
                {state.dayOfContact !== null ? (
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
                    <Field label="Name" error={state.dayOfContact.name.trim().length === 0 ? "Required" : null}>
                      <input
                        type="text" value={state.dayOfContact.name}
                        onChange={(e) => { updateContact({ name: e.target.value.slice(0, 120) }); }}
                        style={inputStyle}
                        aria-invalid={state.dayOfContact.name.trim().length === 0}
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
                  onChange={(e) => { setState((s) => s === null ? s : ({ ...s, accessNotes: e.target.value.slice(0, 1500) })); }}
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
                      onChange={(e) => {
                        // Preserve the previously-saved deadline on empty or
                        // unparseable input. Coercing to `now` would silently
                        // corrupt a real milestone when the user hits backspace
                        // or a mobile picker emits a transient empty value.
                        const next = fromDateTimeLocal(e.target.value, d.deadline);
                        updateDeadline(i, { deadline: next });
                      }}
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
                {state.phaseDeadlines.length < SETUP_PHASES.length && (
                  <button type="button" onClick={addDeadline} style={secondaryBtnStyle}>+ Add deadline</button>
                )}
              </Section>
            </>
          )}
        </div>

        <footer style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: 18, borderTop: `1px solid ${BORDER}`, background: "#17171a" }}>
          <div style={{ fontSize: 11, color: TEXT_SEC }}>
            {savedAt !== null ? `Saved at ${savedAt.toLocaleTimeString()}` : "Not saved yet"}
          </div>
          <div style={{ display: "flex", gap: 8 }}>
            <button type="button" onClick={onClose} style={secondaryBtnStyle}>Close</button>
            {!signInRequired && (
              <button
                type="button"
                onClick={() => { void handleSave(); }}
                disabled={saveBlocked}
                style={{
                  ...primaryBtnStyle,
                  opacity: saveBlocked ? 0.6 : 1,
                  cursor: saveBlocked ? "default" : "pointer",
                }}
              >
                {saving ? "Saving…" : "Save"}
              </button>
            )}
          </div>
        </footer>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Pure helpers — exported for unit tests
// ---------------------------------------------------------------------------

export interface SaveBlockedInput {
  readonly saving: boolean;
  readonly loading: boolean;
  readonly configId: string | null;
  readonly state: EventInstructions | null;
}

/**
 * True when the Save button must be disabled. Blocks on: in-flight save,
 * hydration still running, no config to save against, form not yet
 * materialised, or an incomplete day-of contact (server schema requires
 * a non-empty name).
 */
export function computeSaveBlocked(input: SaveBlockedInput): boolean {
  if (input.saving) return true;
  if (input.loading) return true;
  if (input.configId === null) return true;
  if (input.state === null) return true;
  if (input.state.dayOfContact !== null && input.state.dayOfContact.name.trim().length === 0) return true;
  return false;
}

/**
 * Collapse a day-of contact with an empty name to `null` before we
 * PATCH the server. The server schema has `name: z.string().min(1)`,
 * which would otherwise turn an empty-name draft into a silent 400
 * that discards every other edit in the same payload.
 */
export function normalizeForSave(state: EventInstructions): EventInstructions {
  const dayOfContact = state.dayOfContact !== null && state.dayOfContact.name.trim().length === 0
    ? null
    : state.dayOfContact;
  return { ...state, dayOfContact };
}

/**
 * Convert a browser datetime-local string (e.g. "2026-06-15T18:00") to
 * ISO UTC. Empty or unparseable input returns `fallback` unchanged,
 * which preserves a previously-saved deadline instead of silently
 * coercing to the current time.
 */
export function fromDateTimeLocal(local: string, fallback: string): string {
  if (local === "") return fallback;
  const d = new Date(local);
  if (Number.isNaN(d.getTime())) return fallback;
  return d.toISOString();
}

// ---------------------------------------------------------------------------
// Section / Field wrappers
// ---------------------------------------------------------------------------

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

function Field({ label, children, error }: { label: string; children: React.ReactNode; error?: string | null }): React.ReactElement {
  return (
    <label style={{ display: "flex", flexDirection: "column", gap: 3 }}>
      <span style={{ fontSize: 10, color: TEXT_MUT, textTransform: "uppercase", letterSpacing: "0.04em" }}>{label}</span>
      {children}
      {error !== undefined && error !== null && (
        <span style={{ fontSize: 10, color: "#ef4444" }}>{error}</span>
      )}
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
