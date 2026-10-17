import { z } from "zod";
import { ZoneSchema } from "./zone.js";

// ---------------------------------------------------------------------------
// Event Requirements — the non-geometry part of the hallkeeper sheet.
//
// Geometry (placed furniture) tells us what the room looks like. Metadata
// captured here tells us things the planner/client know about the event
// that CAN'T be inferred from geometry:
//
//   - Accessibility: hearing loops, wheelchair spaces, sign-language
//     interpreters, large-print programmes, step-free routing notes.
//   - Dietary: per-diet guest counts for catering + seating allocation.
//   - Door schedule: per-door lock/unlock times so the hallkeeper knows
//     which entrance to expect late arrivals through and which to secure.
//
// All three blocks are optional on a configuration. A bare event with
// nothing set renders as a clean sheet without phantom empty sections —
// the renderer checks `hasXxxContent()` before drawing the callout.
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// AccessibilityRequirements
//
// Every field has a sensible default so `AccessibilityRequirementsSchema.
// parse({})` round-trips to a clean-empty object. Caps are conservative:
//   - 50 wheelchair spaces exceeds any Trades Hall room's seating;
//     the cap protects us from typos and accidental huge numbers.
//   - 500 large-print programmes caps a realistic print run.
//   - 1000-char notes matches EventInstructions.accessNotes for
//     cross-field consistency.
// ---------------------------------------------------------------------------

export const AccessibilityRequirementsSchema = z.object({
  hearingLoopRequired: z.boolean().default(false),
  /**
   * Zone the hearing loop should cover. Must be set when
   * hearingLoopRequired is true — validator on the submit route enforces
   * this cross-field invariant so a sheet can never ship a true flag
   * with a null zone.
   */
  hearingLoopZone: ZoneSchema.nullable().default(null),
  wheelchairSpaces: z.number().int().nonnegative().max(50).default(0),
  stepFreeRouteRequired: z.boolean().default(false),
  signLanguageInterpreter: z.boolean().default(false),
  largePrintProgrammes: z.number().int().nonnegative().max(500).default(0),
  notes: z.string().max(1000).default(""),
});
export type AccessibilityRequirements = z.infer<
  typeof AccessibilityRequirementsSchema
>;

/** Deterministic empty value — same pattern as emptyEventInstructions. */
export function emptyAccessibilityRequirements(): AccessibilityRequirements {
  return {
    hearingLoopRequired: false,
    hearingLoopZone: null,
    wheelchairSpaces: 0,
    stepFreeRouteRequired: false,
    signLanguageInterpreter: false,
    largePrintProgrammes: 0,
    notes: "",
  };
}

/**
 * True if the block has any non-default content. Renderers skip the
 * accessibility callout when this returns false.
 */
export function hasAccessibilityContent(
  a: AccessibilityRequirements,
): boolean {
  if (a.hearingLoopRequired) return true;
  if (a.wheelchairSpaces > 0) return true;
  if (a.stepFreeRouteRequired) return true;
  if (a.signLanguageInterpreter) return true;
  if (a.largePrintProgrammes > 0) return true;
  if (a.notes.trim().length > 0) return true;
  return false;
}

/**
 * True if the accessibility block declares content the hallkeeper MUST
 * know about before the event starts (hearing loop, wheelchair spaces,
 * sign-language interpreter). Step-free and large-print are logistical
 * but not safety-critical. Used by the sheet renderer to decide whether
 * to show the red "CRITICAL" banner vs. a softer accessibility callout.
 */
export function hasCriticalAccessibility(
  a: AccessibilityRequirements,
): boolean {
  if (a.hearingLoopRequired) return true;
  if (a.wheelchairSpaces > 0) return true;
  if (a.signLanguageInterpreter) return true;
  return false;
}

// ---------------------------------------------------------------------------
// DietarySummary
//
// Per-diet guest counts. NOT a seating plan — catering uses these numbers
// to spec the menu. `otherAllergies` is free-text because allergies don't
// fit a fixed enum (sesame, shellfish, celiac, …). The per-diet cap of
// 10,000 matches MAX_GUEST_COUNT in enquiry.ts so a single diet can
// consume the entire guest list (large corporate event where everyone
// is gluten-free, for example).
// ---------------------------------------------------------------------------

export const DietarySummarySchema = z.object({
  vegetarian: z.number().int().nonnegative().max(10000).default(0),
  vegan: z.number().int().nonnegative().max(10000).default(0),
  glutenFree: z.number().int().nonnegative().max(10000).default(0),
  nutFree: z.number().int().nonnegative().max(10000).default(0),
  halal: z.number().int().nonnegative().max(10000).default(0),
  kosher: z.number().int().nonnegative().max(10000).default(0),
  otherAllergies: z.string().max(1000).default(""),
});
export type DietarySummary = z.infer<typeof DietarySummarySchema>;

export function emptyDietarySummary(): DietarySummary {
  return {
    vegetarian: 0,
    vegan: 0,
    glutenFree: 0,
    nutFree: 0,
    halal: 0,
    kosher: 0,
    otherAllergies: "",
  };
}

/** Sum of the named-diet counts. Excludes free-text allergies. */
export function dietaryTotal(d: DietarySummary): number {
  return (
    d.vegetarian +
    d.vegan +
    d.glutenFree +
    d.nutFree +
    d.halal +
    d.kosher
  );
}

// ---------------------------------------------------------------------------
// Health free text stays out of logs and error reports (fix-first item 18).
//
// `otherAllergies` is free text about guests' health. It belongs on the
// layout, the event sheets and the screens of the people preparing the day,
// and nowhere else: not a server log line, not an error report. The counts
// per diet are not about anyone in particular and are left alone.
//
// Two shapes reach a log or an error report: an object carrying the key
// (a request body, a metadata column), and a string with the JSON inside it
// (a database error repeating the row or the query's parameters, sometimes
// with its quotes escaped once more). Both are handled here, once, for the
// API's logger and both error reporters.
// ---------------------------------------------------------------------------

/**
 * How long the free-text allergy note is kept (fix-first item 18). One
 * definition for the API's retention pass, the privacy policy and the words
 * beside the field, so none of them can promise a different period.
 *   - daysAfterEvent: after the latest event the layout is linked to ends;
 *   - daysWithoutEvent: after a layout with no dated event last changed (the
 *     24 months the privacy policy gives an enquiry that did not become a
 *     booking).
 */
export const DIETARY_NOTE_RETENTION = { daysAfterEvent: 30, daysWithoutEvent: 730 } as const;

/** Keys whose values are free text about someone's health. */
export const HEALTH_FREE_TEXT_KEYS: readonly string[] = ["otherAllergies"];

/** What a redacted value reads as. */
export const REDACTED_HEALTH_TEXT = "[redacted]";

const HEALTH_KEY_SET: ReadonlySet<string> = new Set(HEALTH_FREE_TEXT_KEYS);

function escapeForPattern(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
}

const KEY_ALTERNATION = HEALTH_FREE_TEXT_KEYS.map(escapeForPattern).join("|");
// "otherAllergies": "sesame, \"shellfish\""
const PLAIN_JSON_VALUE = new RegExp(`("(?:${KEY_ALTERNATION})"\\s*:\\s*")((?:[^"\\\\]|\\\\.)*)(")`, "gu");
// \"otherAllergies\":\"sesame\" — the same JSON inside another JSON string.
// Read token by token: a plain character, an escaped backslash followed by
// whatever it escapes (an inner escaped quote is \\\"), or any other escape
// except \" — which is where the inner string ends.
const ESCAPED_JSON_VALUE = new RegExp(
  `(\\\\"(?:${KEY_ALTERNATION})\\\\"\\s*:\\s*\\\\")((?:[^\\\\]|\\\\\\\\(?:\\\\.|[^\\\\])|\\\\[^"\\\\])*)(\\\\")`,
  "gu",
);
// otherAllergies=sesame or otherAllergies: sesame, up to the end of the line
// or the next field separator, for messages that are not JSON at all.
const LOOSE_VALUE = new RegExp(`(\\b(?:${KEY_ALTERNATION})\\b\\s*[:=]\\s*)(?!["\\\\])([^,;\\n}]*)`, "gu");

/** The same text with every health free-text value replaced. */
export function redactHealthFreeTextInString(text: string): string {
  if (!HEALTH_FREE_TEXT_KEYS.some((key) => text.includes(key))) return text;
  return text
    .replace(PLAIN_JSON_VALUE, `$1${REDACTED_HEALTH_TEXT}$3`)
    .replace(ESCAPED_JSON_VALUE, `$1${REDACTED_HEALTH_TEXT}$3`)
    .replace(LOOSE_VALUE, `$1${REDACTED_HEALTH_TEXT}`);
}

function isPlainRecord(value: object): value is Record<string, unknown> {
  const proto: unknown = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

function redactValue(value: unknown, seen: WeakMap<object, unknown>): unknown {
  if (typeof value === "string") return redactHealthFreeTextInString(value);
  if (typeof value !== "object" || value === null) return value;
  const known = seen.get(value);
  if (known !== undefined) return known;

  if (Array.isArray(value)) {
    const copy: unknown[] = [];
    seen.set(value, copy);
    for (const item of value) copy.push(redactValue(item, seen));
    return copy;
  }

  if (value instanceof Error) {
    const copy: Record<string, unknown> = {};
    seen.set(value, copy);
    copy["type"] = value.name;
    copy["message"] = redactHealthFreeTextInString(value.message);
    if (value.stack !== undefined) copy["stack"] = redactHealthFreeTextInString(value.stack);
    for (const [key, item] of Object.entries(value)) {
      copy[key] = HEALTH_KEY_SET.has(key) ? REDACTED_HEALTH_TEXT : redactValue(item, seen);
    }
    const cause: unknown = (value as { cause?: unknown }).cause;
    if (cause !== undefined) copy["cause"] = redactValue(cause, seen);
    return copy;
  }

  // Class instances (a request, a stream, a date) are left to their own
  // serialisers; only plain data is walked.
  if (!isPlainRecord(value)) return value;

  const copy: Record<string, unknown> = {};
  seen.set(value, copy);
  for (const [key, item] of Object.entries(value)) {
    copy[key] = HEALTH_KEY_SET.has(key) && item !== null && item !== undefined && item !== ""
      ? REDACTED_HEALTH_TEXT
      : redactValue(item, seen);
  }
  return copy;
}

/**
 * A copy of `value` with every health free-text value replaced: object keys
 * at any depth, JSON inside strings, and an Error's message, stack, own
 * fields and cause (an Error comes back as a plain object). Never mutates
 * its input. Safe on cycles.
 */
export function redactHealthFreeText(value: unknown): unknown {
  return redactValue(value, new WeakMap());
}

export function hasDietaryContent(d: DietarySummary): boolean {
  if (dietaryTotal(d) > 0) return true;
  if (d.otherAllergies.trim().length > 0) return true;
  return false;
}

// ---------------------------------------------------------------------------
// DoorSchedule — per-door lock/unlock timeline for the hallkeeper.
//
// For a typical wedding: "Front door open 15:00, side door locked 18:30
// after guests arrive, service door open throughout." Rendered on the
// sheet as a compact chronological table.
//
// A door is identified by a human label (freeform) rather than a fixed
// enum because doors vary per venue. We cap at 12 doors per event
// (Trades Hall has 4 externally accessible; 12 gives headroom for
// multi-level / multi-building events).
// ---------------------------------------------------------------------------

export const DOOR_EVENT_TYPES = ["open", "lock"] as const;
export const DoorEventTypeSchema = z.enum(DOOR_EVENT_TYPES);
export type DoorEventType = z.infer<typeof DoorEventTypeSchema>;

export const DoorEventSchema = z.object({
  /** ISO-8601 datetime this event happens. */
  at: z.string().datetime(),
  kind: DoorEventTypeSchema,
  /** Optional context ("after VIP arrival", "overnight lockup"). */
  note: z.string().max(200).default(""),
});
export type DoorEvent = z.infer<typeof DoorEventSchema>;

export const DoorScheduleEntrySchema = z.object({
  /** Human-readable door label, e.g. "Front door", "Side door (Garthamlock St)". */
  label: z.string().trim().min(1).max(100),
  /** Ordered list of open/lock events — renderer sorts by `at`. */
  events: z.array(DoorEventSchema).max(10).default([]),
});
export type DoorScheduleEntry = z.infer<typeof DoorScheduleEntrySchema>;

export const DoorScheduleSchema = z.object({
  entries: z.array(DoorScheduleEntrySchema).max(12).default([]),
});
export type DoorSchedule = z.infer<typeof DoorScheduleSchema>;

export function emptyDoorSchedule(): DoorSchedule {
  return { entries: [] };
}

export function hasDoorScheduleContent(s: DoorSchedule): boolean {
  return s.entries.length > 0;
}

// ---------------------------------------------------------------------------
// Equipment Tags — implicit requirements triggered by placing an asset.
//
// Tags live here (in event-requirements) rather than in asset-catalogue
// because they are a property of the event sheet, not of the catalog
// itself. Multiple catalog entries may share a tag. The extraction
// engine reads `asset.equipmentTags` (declared in asset-catalogue) and
// unions them into a "Technical requirements" section on the sheet.
//
//   power-outlet      — 13A socket must be routable to this placement
//                       (projector, laptop, mic, string-light table)
//   av-cable-path     — HDMI/network path must be clear of guest traffic
//   water-supply      — potable water at this placement (lectern → speaker
//                       bottle, bar, catering station)
//   overhead-rig      — mount-check required overhead (projector screen,
//                       lighting truss, hanging signage)
//   data-network      — wired Ethernet drop at this placement
//   dimmable-lighting — room lighting must dim to spotlight this
//                       placement (stage, screen)
//   blackout          — windows must be blackout-capable for this
//                       placement (projector screen in daylight-heavy
//                       rooms)
// ---------------------------------------------------------------------------

export const EQUIPMENT_TAGS = [
  "power-outlet",
  "av-cable-path",
  "water-supply",
  "overhead-rig",
  "data-network",
  "dimmable-lighting",
  "blackout",
] as const;

export const EquipmentTagSchema = z.enum(EQUIPMENT_TAGS);
export type EquipmentTag = z.infer<typeof EquipmentTagSchema>;
