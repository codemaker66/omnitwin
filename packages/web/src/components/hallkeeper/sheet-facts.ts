import type { AccessibilityRequirements, DietarySummary, PhaseDeadline, Timing } from "@omnitwin/types";

// ---------------------------------------------------------------------------
// What a hallkeeper keeps in view (roadmap N4): the hour the room must be
// ready, and the needs that must not be missed, read from the planner's own
// instructions. Pure, so the sheet renders them and tests hand in cases.
//
// Nothing here says "none" for what nobody recorded: an allergy nobody wrote
// down is not an allergy nobody has.
// ---------------------------------------------------------------------------

/** The venue's zone in words, never its IANA name: "UK time", "Eastern time". */
export function venueZoneLabel(timeZone: string): string {
  try {
    const name = new Intl.DateTimeFormat("en-GB", { timeZone, timeZoneName: "longGeneric" })
      .formatToParts(0).find((part) => part.type === "timeZoneName")?.value ?? timeZone;
    return name.replace(/^United Kingdom\b/u, "UK").replace(/ Time$/u, " time");
  } catch {
    return timeZone;
  }
}

/** The zone to name beside the sheet's times, or null when the reader's
 *  device already keeps the venue's clock. */
export function zoneNote(venueZone: string, deviceZone: string | undefined): string | null {
  return deviceZone === venueZone ? null : venueZoneLabel(venueZone);
}

/** The reader's own zone; undefined where the runtime cannot say. */
export function deviceZone(): string | undefined {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone;
  } catch {
    return undefined;
  }
}

/** The venue's calendar day of an instant, as YYYY-MM-DD. */
export function venueDay(ms: number, timeZone: string): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(ms);
}

/** The printed sheet's times, as the screen's card gives them: the hour the
 *  room must be ready, the start and the day, on the venue's clock. */
export function formatSheetTimes(timing: Timing, timeZone: string): string {
  const time = (iso: string): string => new Date(iso).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", timeZone });
  const day = new Date(timing.eventStart).toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short", year: "numeric", timeZone });
  const ready = timing.setupBy === null ? "Ready by: not set, as no changeover time is recorded for this room" : `Ready by ${time(timing.setupBy)}`;
  return `${ready} · Starts ${time(timing.eventStart)} · ${day}`;
}

/** The planner's next phase deadline still ahead of `nowMs`, or null once
 *  every deadline has passed or none was set. */
export function nextPhaseDeadline(deadlines: readonly PhaseDeadline[], nowMs: number): PhaseDeadline | null {
  let next: PhaseDeadline | null = null;
  let nextMs = Number.POSITIVE_INFINITY;
  for (const deadline of deadlines) {
    const at = Date.parse(deadline.deadline);
    if (!Number.isFinite(at) || at <= nowMs || at >= nextMs) continue;
    next = deadline;
    nextMs = at;
  }
  return next;
}

/** A deadline's time on the venue's clock, with its day when that is not
 *  `day` (the event's day, or today's when the sheet has no event date). */
export function deadlineWhen(iso: string, timeZone: string, day: string): string {
  const ms = Date.parse(iso);
  const time = new Date(ms).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", timeZone });
  if (venueDay(ms, timeZone) === day) return time;
  const date = new Date(ms).toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short", timeZone });
  return `${date}, ${time}`;
}

/** A guest's access needs as short phrases, in the order the brief ranks
 *  them: what must be in place before guests arrive first, then routes and
 *  print, then the planner's own words as written. */
export function accessNeeds(access: AccessibilityRequirements | null): readonly string[] {
  if (access === null) return [];
  const needs: string[] = [];
  if (access.hearingLoopRequired) needs.push(access.hearingLoopZone === null ? "Hearing loop, zone not set" : `Hearing loop in ${access.hearingLoopZone}`);
  if (access.wheelchairSpaces > 0) needs.push(`${String(access.wheelchairSpaces)} wheelchair ${access.wheelchairSpaces === 1 ? "space" : "spaces"}`);
  if (access.signLanguageInterpreter) needs.push("Sign-language interpreter attending");
  if (access.stepFreeRouteRequired) needs.push("Step-free route to seating");
  if (access.largePrintProgrammes > 0) needs.push(`${String(access.largePrintProgrammes)} large-print ${access.largePrintProgrammes === 1 ? "programme" : "programmes"}`);
  const notes = access.notes.trim();
  if (notes.length > 0) needs.push(notes);
  return needs;
}

export interface AllergyFacts {
  /** Meals made for an allergen, from the planner's counts, each a phrase a
   *  line should not break inside: ["3 nut-free", "2 gluten-free"]. */
  readonly counts: readonly string[];
  /** The noun the counts share: "meal" for one in all, else "meals". */
  readonly noun: "meal" | "meals";
  /** The planner's own words about allergies, as written. */
  readonly notes: string | null;
}

/** The allergies the planner recorded, or null when they recorded none.
 *  Nut-free and gluten-free meals are the counts that answer to allergens;
 *  vegetarian, vegan, halal and kosher stay with the brief. */
export function allergyFacts(dietary: DietarySummary | null): AllergyFacts | null {
  if (dietary === null) return null;
  const counts = [
    dietary.nutFree > 0 ? `${String(dietary.nutFree)} nut-free` : null,
    dietary.glutenFree > 0 ? `${String(dietary.glutenFree)} gluten-free` : null,
  ].filter((part): part is string => part !== null);
  const notes = dietary.otherAllergies.trim();
  if (counts.length === 0 && notes.length === 0) return null;
  return { counts, noun: dietary.nutFree + dietary.glutenFree === 1 ? "meal" : "meals", notes: notes.length > 0 ? notes : null };
}

/** A phone number as a `tel:` target: digits and a leading plus only. The
 *  British "(0)" is the trunk digit a caller from abroad leaves out, so it
 *  never reaches the number dialled. */
export function telHref(phone: string): string {
  const trimmed = phone.trim().replace(/\(0\)/gu, "");
  return `tel:${trimmed.startsWith("+") ? "+" : ""}${trimmed.replace(/\D/gu, "")}`;
}
