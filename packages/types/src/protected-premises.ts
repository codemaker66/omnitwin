import { z } from "zod";

// ---------------------------------------------------------------------------
// Martyn's Law readiness — the Terrorism (Protection of Premises) Act 2025
// (c. 10) as prompts on the hallkeeper sheet (T-648).
//
// The rule this module exists to keep: it PROMPTS and never CLAIMS. Nothing
// here may say or imply that a venue or event is compliant, approved,
// certified or safe. Every value comes from what an operator typed into the
// event details; absence prints "Not set" or "Not checked" and is never
// filled from a default, an inference or another record.
//
// Tier applicability under the Act turns on the PREMISES: s.2(2)(c) and
// s.2(3) ask whether "it is reasonable to expect that from time to time" 200
// (standard) or 800 (enhanced) or more individuals "may be present on the
// premises at the same time". One event's guest count does not decide that,
// so the sheet may show the entered guest count beside the thresholds as
// information and leaves the determination to the venue's responsible
// person. Sources and the no-claims rule: docs/engineering/martyns-law-readiness.md.
//
// Stored on configurations.metadata.instructions.protectedPremises. Every
// field is optional with NO default: a defaulted key would change the parsed
// metadata, and with it every configuration's sheet sourceHash
// (event-sheet-extractor.ts), forcing new snapshot versions for layouts
// nobody edited.
// ---------------------------------------------------------------------------

/** The four public protection procedures, in the order s.5(3)(a)–(d) lists them. */
export const PROTECTION_PROCEDURES = ["evacuation", "invacuation", "lockdown", "communication"] as const;
export const ProtectionProcedureSchema = z.enum(PROTECTION_PROCEDURES);
export type ProtectionProcedure = z.infer<typeof ProtectionProcedureSchema>;

/** Names and plain descriptions, worded from s.5(3) and the statutory guidance (para 7.11). */
export const PROTECTION_PROCEDURE_COPY: Readonly<Record<ProtectionProcedure, { readonly label: string; readonly description: string }>> = {
  evacuation: { label: "Evacuation", description: "Moving people out of the premises." },
  invacuation: { label: "Invacuation", description: "Moving people to a place inside with less risk of harm." },
  lockdown: { label: "Lockdown", description: "Stopping people entering or leaving." },
  communication: { label: "Communication", description: "Giving people information and instructions." },
};

export const PROCEDURE_NOTE_MAX = 300;
export const PROTECTED_PREMISES_NOTES_MAX = 1500;

/** Whether the staff working this event were briefed on one procedure. */
export const ProcedureBriefingSchema = z.object({
  /** true: briefed; false: not briefed; absent: nobody has checked. */
  briefed: z.boolean().optional(),
  /** The operator's note or a reference to the venue's own procedure document. */
  note: z.string().max(PROCEDURE_NOTE_MAX).optional(),
});
export type ProcedureBriefing = z.infer<typeof ProcedureBriefingSchema>;

export const ProtectedPremisesSchema = z.object({
  /**
   * The individual or organisation the venue records as in control of the
   * premises for this event (the Act's "responsible person", s.4). Usually
   * the venue itself; the hirer can hold it for a qualifying event.
   */
  responsiblePerson: z.string().max(200).optional(),
  /** Who leads the procedures on the day. */
  dutyLead: z.object({
    name: z.string().max(120).optional(),
    role: z.string().max(120).optional(),
  }).optional(),
  procedures: z.object({
    evacuation: ProcedureBriefingSchema.optional(),
    invacuation: ProcedureBriefingSchema.optional(),
    lockdown: ProcedureBriefingSchema.optional(),
    communication: ProcedureBriefingSchema.optional(),
  }).optional(),
  /** ISO-8601 time of the team's security briefing for this event. */
  briefingAt: z.string().datetime().optional(),
  doorSupervision: z.object({
    /** true: arranged; false: not arranged; absent: not set. */
    arranged: z.boolean().optional(),
    note: z.string().max(PROCEDURE_NOTE_MAX).optional(),
  }).optional(),
  notes: z.string().max(PROTECTED_PREMISES_NOTES_MAX).optional(),
});
export type ProtectedPremises = z.infer<typeof ProtectedPremisesSchema>;

function filled(value: string | undefined): value is string {
  return value !== undefined && value.trim().length > 0;
}

/**
 * True when an operator entered anything at all. Accepts null and an absent
 * key: the live sheet path reads configurations.metadata without parsing it,
 * so a layout saved before this field existed arrives with no key.
 */
export function hasProtectedPremisesContent(record: ProtectedPremises | null | undefined): boolean {
  if (record === null || record === undefined) return false;
  if (filled(record.responsiblePerson)) return true;
  if (filled(record.dutyLead?.name) || filled(record.dutyLead?.role)) return true;
  for (const procedure of PROTECTION_PROCEDURES) {
    const briefing = record.procedures?.[procedure];
    if (briefing?.briefed !== undefined || filled(briefing?.note)) return true;
  }
  if (filled(record.briefingAt)) return true;
  if (record.doorSupervision?.arranged !== undefined || filled(record.doorSupervision?.note)) return true;
  return filled(record.notes);
}

/**
 * The record as it should be stored: blank strings and empty groups dropped,
 * text trimmed, keys in schema order. Returns undefined when nothing was
 * entered, so a save never writes an empty block and never changes the
 * sheet's sourceHash for a layout whose operator entered nothing.
 */
export function normalizeProtectedPremises(record: ProtectedPremises | null | undefined): ProtectedPremises | undefined {
  if (record === null || record === undefined || !hasProtectedPremisesContent(record)) return undefined;
  const text = (value: string | undefined): string | undefined => filled(value) ? value.trim() : undefined;
  const out: ProtectedPremises = {};
  const responsiblePerson = text(record.responsiblePerson);
  if (responsiblePerson !== undefined) out.responsiblePerson = responsiblePerson;
  const leadName = text(record.dutyLead?.name);
  const leadRole = text(record.dutyLead?.role);
  if (leadName !== undefined || leadRole !== undefined) {
    out.dutyLead = {
      ...(leadName === undefined ? {} : { name: leadName }),
      ...(leadRole === undefined ? {} : { role: leadRole }),
    };
  }
  const procedures: NonNullable<ProtectedPremises["procedures"]> = {};
  for (const procedure of PROTECTION_PROCEDURES) {
    const briefing = record.procedures?.[procedure];
    const note = text(briefing?.note);
    const briefed = briefing?.briefed;
    if (briefed === undefined && note === undefined) continue;
    procedures[procedure] = {
      ...(briefed === undefined ? {} : { briefed }),
      ...(note === undefined ? {} : { note }),
    };
  }
  if (Object.keys(procedures).length > 0) out.procedures = procedures;
  const briefingAt = text(record.briefingAt);
  if (briefingAt !== undefined) out.briefingAt = briefingAt;
  const arranged = record.doorSupervision?.arranged;
  const doorNote = text(record.doorSupervision?.note);
  if (arranged !== undefined || doorNote !== undefined) {
    out.doorSupervision = {
      ...(arranged === undefined ? {} : { arranged }),
      ...(doorNote === undefined ? {} : { note: doorNote }),
    };
  }
  const notes = text(record.notes);
  if (notes !== undefined) out.notes = notes;
  return out;
}

// ---------------------------------------------------------------------------
// The sheet's lines — one builder for the web sheet, the printed sheet and
// the PDF, so the three cannot word the same record differently.
// ---------------------------------------------------------------------------

export const PROTECTED_PREMISES_HEADING = "Martyn's Law readiness";
const NOT_SET = "Not set";
const NOT_CHECKED = "Not checked";

/** The Act's thresholds (s.2(2)(c), s.2(3), s.3(1)(d)). Legal constants, never venue capacities. */
export const MARTYNS_LAW_THRESHOLDS = { standardFrom: 200, enhancedFrom: 800 } as const;

export interface ProtectedPremisesLine {
  readonly key: string;
  readonly label: string;
  /** What the operator entered, or "Not set" / "Not checked". */
  readonly value: string;
  /** The operator's own note, as written; null when there is none. */
  readonly note: string | null;
  /** False when the value is the "Not set" / "Not checked" prompt. */
  readonly entered: boolean;
}

export interface ProtectedPremisesSummary {
  readonly heading: string;
  /** One sentence under the heading saying what these lines are. */
  readonly intro: string;
  readonly people: readonly ProtectedPremisesLine[];
  /** One line per procedure, s.5(3) order. */
  readonly procedures: readonly ProtectedPremisesLine[];
  readonly arrangements: readonly ProtectedPremisesLine[];
  /** The entered guest count, shown beside the Act's thresholds as information. */
  readonly guestLine: string;
  /** Plain context: what decides the tier, who decides it, when duties start. */
  readonly context: readonly string[];
}

export interface ProtectedPremisesSummaryOptions {
  /** configurations.guest_count. 0 is the column default and reads as not set. */
  readonly guestCount: number;
  /** The venue's IANA zone; the briefing time prints on the venue's clock. */
  readonly timeZone: string;
}

/** A briefing time on the venue's clock, "Mon 15 Jun, 17:30"; null when unreadable. */
export function formatBriefingTime(iso: string, timeZone: string): string | null {
  const ms = Date.parse(iso);
  if (!Number.isFinite(ms)) return null;
  try {
    const at = new Date(ms);
    const day = at.toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short", timeZone });
    const time = at.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", timeZone });
    return `${day}, ${time}`;
  } catch {
    return null;
  }
}

function line(key: string, label: string, value: string | null, unset: string, note?: string): ProtectedPremisesLine {
  const trimmedNote = note?.trim() ?? "";
  return {
    key,
    label,
    value: value ?? unset,
    note: trimmedNote.length > 0 ? trimmedNote : null,
    entered: value !== null,
  };
}

/**
 * Everything the sheet says about Martyn's Law, from the operator's record
 * (null or absent when they entered nothing) and the event's entered guest
 * count. Pure: renderers draw it, tests hand in cases.
 */
export function buildProtectedPremisesSummary(
  record: ProtectedPremises | null | undefined,
  options: ProtectedPremisesSummaryOptions,
): ProtectedPremisesSummary {
  const r: ProtectedPremises = record ?? {};
  const text = (value: string | undefined): string | null => filled(value) ? value.trim() : null;
  const leadName = text(r.dutyLead?.name);
  const leadRole = text(r.dutyLead?.role);
  const lead = leadName !== null && leadRole !== null ? `${leadName} · ${leadRole}` : leadName ?? leadRole;
  const briefingAt = r.briefingAt === undefined ? null : formatBriefingTime(r.briefingAt, options.timeZone);
  const arranged = r.doorSupervision?.arranged;
  const guests = Number.isInteger(options.guestCount) && options.guestCount > 0 ? options.guestCount : null;
  const { standardFrom, enhancedFrom } = MARTYNS_LAW_THRESHOLDS;

  return {
    heading: PROTECTED_PREMISES_HEADING,
    intro: "Prompts only, from what has been entered for this event.",
    people: [
      line("responsible-person", "Responsible person", text(r.responsiblePerson), NOT_SET),
      line("duty-lead", "Lead on duty", lead, NOT_SET),
    ],
    procedures: PROTECTION_PROCEDURES.map((procedure) => {
      const briefing = r.procedures?.[procedure];
      const value = briefing?.briefed === undefined ? null : briefing.briefed ? "Briefed" : "Not briefed";
      return line(procedure, PROTECTION_PROCEDURE_COPY[procedure].label, value, NOT_CHECKED, briefing?.note);
    }),
    arrangements: [
      line("briefing", "Team briefing", briefingAt, NOT_SET),
      line("door-supervision", "Door supervision", arranged === undefined ? null : arranged ? "Arranged" : "Not arranged", NOT_SET, r.doorSupervision?.note),
      line("notes", "Notes", text(r.notes), NOT_SET),
    ],
    guestLine: guests === null
      ? "Guest count for this event: not set."
      : `Guest count entered for this event: ${String(guests)}.`,
    context: [
      `The Act's tiers depend on how many people may reasonably be expected on the premises at the same time, not on one event's guest list: ${String(standardFrom)} to ${String(enhancedFrom - 1)} for the standard tier, ${String(enhancedFrom)} or more for the enhanced tier.`,
      `A public event with entry checks where ${String(enhancedFrom)} or more may be present can be a qualifying event.`,
      "The venue's responsible person decides what applies.",
      "The duties are expected from spring 2027; the date is to be confirmed.",
    ],
  };
}
