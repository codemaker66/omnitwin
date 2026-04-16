import { useState } from "react";
import type { EventInstructions, SetupPhase } from "@omnitwin/types";

// ---------------------------------------------------------------------------
// InstructionsBanner — the planner's human layer, shown at the top of
// the hallkeeper sheet so staff read it before scanning the manifest.
//
// Collapsible so it stays out of the way once the hallkeeper has
// internalised the notes. Defaults to expanded on first render because
// the whole point is that the hallkeeper sees this content at least
// once.
// ---------------------------------------------------------------------------

const GOLD = "#c9a84c";
const BORDER = "#252320";
const TEXT_MUT = "#5c5955";
const TEXT_SEC = "#9a9690";

const PHASE_LABEL: Readonly<Record<SetupPhase, string>> = {
  structure: "Structure",
  furniture: "Furniture",
  dress: "Dress",
  technical: "Technical",
  final: "Final Touches",
};

const PHASE_ORDER: Readonly<Record<SetupPhase, number>> = {
  structure: 0,
  furniture: 1,
  dress: 2,
  technical: 3,
  final: 4,
};

export interface InstructionsBannerProps {
  readonly instructions: EventInstructions;
}

export function InstructionsBanner({ instructions }: InstructionsBannerProps): React.ReactElement {
  const [expanded, setExpanded] = useState(true);

  const hasSpecial = instructions.specialInstructions.trim().length > 0;
  const hasContact = instructions.dayOfContact !== null;
  const hasAccess = instructions.accessNotes.trim().length > 0;
  const hasDeadlines = instructions.phaseDeadlines.length > 0;
  const anyContent = hasSpecial || hasContact || hasAccess || hasDeadlines;
  if (!anyContent) return <></>;

  return (
    <section
      className="hk-instructions"
      style={{
        marginTop: 12,
        borderRadius: 10,
        border: `1px solid rgba(201,168,76,0.25)`,
        background: "linear-gradient(180deg, rgba(201,168,76,0.06), rgba(201,168,76,0.02))",
        overflow: "hidden",
      }}
    >
      <button
        type="button"
        onClick={() => { setExpanded((v) => !v); }}
        aria-expanded={expanded}
        style={{
          display: "flex", alignItems: "center", justifyContent: "space-between",
          width: "100%", padding: "10px 12px", border: "none", background: "transparent",
          color: "inherit", cursor: "pointer", fontFamily: "inherit", textAlign: "left",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <span style={{ fontSize: 14, color: GOLD }}>★</span>
          <div>
            <div style={{ fontSize: 9, fontWeight: 700, letterSpacing: "0.12em", color: GOLD, textTransform: "uppercase" }}>
              From the Planner
            </div>
            <div style={{ fontSize: 13, fontWeight: 600, color: "#eee", marginTop: 1 }}>
              {summariseInstructions(instructions)}
            </div>
          </div>
        </div>
        <span style={{ fontSize: 12, color: TEXT_MUT }} aria-hidden>{expanded ? "▾" : "▸"}</span>
      </button>

      {expanded && (
        <div style={{ padding: "0 12px 12px", display: "flex", flexDirection: "column", gap: 10 }}>
          {hasSpecial && (
            <div
              style={{
                padding: "10px 12px", borderRadius: 6,
                background: "rgba(201,168,76,0.08)",
                borderLeft: `3px solid ${GOLD}`,
              }}
            >
              <div style={instructionLabelStyle}>Special Instructions</div>
              <div style={{ fontSize: 13, color: "#eee", whiteSpace: "pre-wrap", lineHeight: 1.45, marginTop: 2 }}>
                {instructions.specialInstructions.trim()}
              </div>
            </div>
          )}

          {(hasContact || hasAccess) && (
            <div style={{ display: "grid", gridTemplateColumns: hasContact && hasAccess ? "1fr 1fr" : "1fr", gap: 8 }}>
              {hasContact && instructions.dayOfContact !== null && (
                <ContactCard contact={instructions.dayOfContact} />
              )}
              {hasAccess && <AccessCard text={instructions.accessNotes.trim()} />}
            </div>
          )}

          {hasDeadlines && (
            <div>
              <div style={instructionLabelStyle}>Phase Deadlines</div>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginTop: 4 }}>
                {[...instructions.phaseDeadlines]
                  .sort((a, b) => PHASE_ORDER[a.phase] - PHASE_ORDER[b.phase])
                  .map((d) => (
                    <span
                      key={`${d.phase}|${d.deadline}`}
                      title={d.reason.length > 0 ? d.reason : undefined}
                      style={{
                        padding: "3px 10px", borderRadius: 100,
                        fontSize: 11, fontWeight: 600,
                        background: "rgba(255,255,255,0.04)",
                        border: `1px solid ${BORDER}`,
                        color: "#eee",
                      }}
                    >
                      <span style={{ color: GOLD, marginRight: 6 }}>{PHASE_LABEL[d.phase]}</span>
                      {formatDeadlineTime(d.deadline)}
                      {d.reason.length > 0 && (
                        <span style={{ color: TEXT_MUT, marginLeft: 6 }}>· {d.reason}</span>
                      )}
                    </span>
                  ))}
              </div>
            </div>
          )}
        </div>
      )}
    </section>
  );
}

function ContactCard({ contact }: { contact: { name: string; role: string; phone: string; email: string } }): React.ReactElement {
  return (
    <div style={{ padding: "10px 12px", borderRadius: 6, background: "rgba(255,255,255,0.03)", border: `1px solid ${BORDER}` }}>
      <div style={instructionLabelStyle}>Day-of Contact</div>
      <div style={{ fontSize: 14, fontWeight: 600, color: "#fff", marginTop: 4 }}>
        {contact.name}
        {contact.role.length > 0 && (
          <span style={{ color: TEXT_SEC, fontWeight: 400, fontSize: 12, marginLeft: 6 }}>· {contact.role}</span>
        )}
      </div>
      {contact.phone.length > 0 && (
        <a
          href={`tel:${contact.phone.replace(/\s/g, "")}`}
          style={{ display: "inline-block", fontSize: 13, color: GOLD, marginTop: 2, textDecoration: "none" }}
        >
          {contact.phone}
        </a>
      )}
      {contact.email.length > 0 && (
        <div>
          <a
            href={`mailto:${contact.email}`}
            style={{ fontSize: 12, color: TEXT_SEC, textDecoration: "none" }}
          >
            {contact.email}
          </a>
        </div>
      )}
    </div>
  );
}

function AccessCard({ text }: { text: string }): React.ReactElement {
  return (
    <div style={{ padding: "10px 12px", borderRadius: 6, background: "rgba(255,255,255,0.03)", border: `1px solid ${BORDER}` }}>
      <div style={instructionLabelStyle}>Access & Load-in</div>
      <div style={{ fontSize: 12, color: "#ddd", marginTop: 4, whiteSpace: "pre-wrap", lineHeight: 1.4 }}>
        {text}
      </div>
    </div>
  );
}

const instructionLabelStyle: React.CSSProperties = {
  fontSize: 9, fontWeight: 700, letterSpacing: "0.08em", color: TEXT_MUT, textTransform: "uppercase",
};

/**
 * Build a compact one-liner used as the banner title when collapsed.
 * Picks up the most important snippet available, in priority order:
 * special instructions > contact > deadlines > access notes.
 */
function summariseInstructions(ins: EventInstructions): string {
  const trimmed = ins.specialInstructions.trim();
  if (trimmed.length > 0) {
    const firstLine = trimmed.split(/\r?\n/)[0]?.trim() ?? "";
    return firstLine.length > 80 ? `${firstLine.slice(0, 77)}…` : firstLine;
  }
  if (ins.dayOfContact !== null) {
    return `Day-of contact: ${ins.dayOfContact.name}`;
  }
  if (ins.phaseDeadlines.length > 0) {
    return `${String(ins.phaseDeadlines.length)} phase deadline${ins.phaseDeadlines.length > 1 ? "s" : ""} set`;
  }
  if (ins.accessNotes.trim().length > 0) {
    return "Access & load-in notes";
  }
  return "";
}

function formatDeadlineTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}
