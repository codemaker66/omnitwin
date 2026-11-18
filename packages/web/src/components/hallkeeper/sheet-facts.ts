import { readyByWords, sheetTimes, venueZoneLabel, type HallkeeperSheetV2, type PhaseDeadline, type Timing } from "@omnitwin/types";

// ---------------------------------------------------------------------------
// What a hallkeeper keeps in view (roadmap N4): the hour the room must be
// ready, and the needs that must not be missed, read from the planner's own
// instructions. Pure, so the sheet renders them and tests hand in cases.
//
// Nothing here says "none" for what nobody recorded: an allergy nobody wrote
// down is not an allergy nobody has.
// ---------------------------------------------------------------------------

// The zone's name in words lives in @omnitwin/types, shared with the printed sheet.
export { venueZoneLabel };

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

/** The printed sheet's times, as the screen's card gives them (sheetTimes,
 *  shared with the PDF): when setup starts, when the room must be ready, when
 *  guests come in and the day, on the venue's clock. A ready-by time after
 *  guests come in is the planner's and is said, never hidden. */
export function formatSheetTimes(sheet: { readonly timing: Timing; readonly instructions: HallkeeperSheetV2["instructions"] }, timeZone: string): string {
  const time = (iso: string): string => new Date(iso).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", timeZone });
  const times = sheetTimes(sheet);
  const day = new Date(sheet.timing.eventStart).toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short", year: "numeric", timeZone });
  const setup = times.setupFrom === null ? "Setup from: not set, as no changeover time is recorded for this room" : `Setup from ${time(times.setupFrom)}`;
  const after = (times.readyBeforeGuestsMinutes ?? 0) < 0 ? `, ${readyByWords(times) ?? ""}` : "";
  const ready = times.readyBy === null ? "Ready by: not set" : `Ready by ${time(times.readyBy)}${after}`;
  return `${setup} · ${ready} · Guests in ${time(sheet.timing.eventStart)} · ${day}`;
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

// Access needs and allergies are worded once, in @omnitwin/types, so the
// printed sheet and this screen say the same thing.
export { accessNeeds, allergyFacts, type AllergyFacts } from "@omnitwin/types";

/** A phone number as a `tel:` target: digits and a leading plus only. The
 *  British "(0)" is the trunk digit a caller from abroad leaves out, so it
 *  never reaches the number dialled. */
export function telHref(phone: string): string {
  const trimmed = phone.trim().replace(/\(0\)/gu, "");
  return `tel:${trimmed.startsWith("+") ? "+" : ""}${trimmed.replace(/\D/gu, "")}`;
}
