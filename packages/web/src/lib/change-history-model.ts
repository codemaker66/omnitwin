import type { AuditLogEntry } from "../api/action-log.js";

// ---------------------------------------------------------------------------
// change-history-model — G4 Slice 4. Audit entries → the rows the Evidence
// lens renders. Pure, and claim-safe by construction:
//   - `when` is the operator's clock AS REPORTED, formatted straight from
//     the ISO string (no timezone reinterpretation), and always paired
//     with `whenNote` saying exactly that.
//   - `origin` states who/what recorded the action without certifying
//     client-supplied provenance as verified.
//   - fold summaries say plainly that earlier detail was compressed.
// ---------------------------------------------------------------------------

export type ChangeHistoryTone = "add" | "edit" | "remove" | "meta" | "note";

export interface ChangeHistoryRow {
  readonly ordinal: number;
  readonly title: string;
  /** Operator-reported time, e.g. "10:15 · 18 Jul 2026". */
  readonly when: string;
  readonly whenNote: string;
  readonly origin: string;
  readonly tone: ChangeHistoryTone;
}

const WHEN_NOTE = "as recorded by the planner's device";

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"] as const;

const ACTOR_LABEL: Record<string, string> = {
  operator: "Operator",
  ai: "AI",
  system: "System",
};

/** Format the ISO string's own components — never through a Date object,
 *  which would silently re-express the operator's clock in the viewer's
 *  timezone and break the "as recorded" claim. */
function formatRecorded(iso: string): string {
  if (iso.length < 16 || iso[10] !== "T") return iso; // malformed — show verbatim
  const time = iso.slice(11, 16);
  const year = iso.slice(0, 4);
  const month = MONTHS[Number.parseInt(iso.slice(5, 7), 10) - 1] ?? iso.slice(5, 7);
  const day = String(Number.parseInt(iso.slice(8, 10), 10));
  return `${time} · ${day} ${month} ${year}`;
}

function recordedLabel(payload: AuditLogEntry["payload"]): string | null {
  if (payload === null || typeof payload !== "object" || Array.isArray(payload)) return null;
  const label = (payload as { label?: unknown }).label;
  return typeof label === "string" && label.length > 0 ? label : null;
}

function foldedCount(payload: AuditLogEntry["payload"]): number | null {
  if (payload === null || typeof payload !== "object" || Array.isArray(payload)) return null;
  const folded = (payload as { folded?: unknown }).folded;
  return typeof folded === "number" ? folded : null;
}

function titleAndTone(item: AuditLogEntry): { title: string; tone: ChangeHistoryTone } {
  const label = recordedLabel(item.payload);
  if (item.intent.startsWith("log.")) {
    const folded = foldedCount(item.payload);
    return {
      title: folded === null ? "Earlier actions summarized" : `${String(folded)} earlier actions summarized`,
      tone: "note",
    };
  }
  if (item.intent === "history.undo" || item.intent === "history.redo") {
    const verb = item.intent === "history.undo" ? "Undo" : "Redo";
    return { title: label === null ? verb : `${verb} — ${label}`, tone: "meta" };
  }
  switch (item.intent) {
    case "object.place":
      return { title: label ?? "Objects placed", tone: "add" };
    case "object.remove":
      return { title: label ?? "Objects removed", tone: "remove" };
    case "object.update":
    case "object.batch":
      return { title: label ?? "Layout edited", tone: "edit" };
    case "markup.draw":
      return { title: "Markup drawn", tone: "edit" };
    case "markup.erase":
      return { title: "Markup erased", tone: "remove" };
    case "markup.clear":
      return { title: "Markup cleared", tone: "remove" };
    case "event.details.update":
      return { title: "Event details updated", tone: "edit" };
    default:
      if (item.intent.startsWith("lighting.rig.")) {
        return { title: "Lighting rig adjusted", tone: "edit" };
      }
      return { title: item.intent, tone: "note" };
  }
}

export function changeHistoryRows(entries: readonly AuditLogEntry[]): readonly ChangeHistoryRow[] {
  return entries
    .map((item) => {
      const { title, tone } = titleAndTone(item);
      const kind = ACTOR_LABEL[item.actor.kind] ?? item.actor.kind;
      return {
        ordinal: item.ordinal,
        title,
        when: formatRecorded(item.recordedTs),
        whenNote: WHEN_NOTE,
        origin: `${kind} · ${item.provenance.tool ?? item.provenance.surface}`,
        tone,
      };
    })
    .reverse();
}
