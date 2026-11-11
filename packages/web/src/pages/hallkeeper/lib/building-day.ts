import type { SupplierArrival } from "@omnitwin/types";
import { wallInputToMs } from "../../diary/lib/board-time.js";
import type { DayBoardLane, DayBoardSlot } from "./day-board-state.js";

// ---------------------------------------------------------------------------
// The building's day (pure, T-693): when it must be open and when it can be
// locked up, and who was marked in and not out.
//
// Everything that needs the building is a span: each function from its setup
// to its clear-down (a provisional one says so), and each supplier from their
// arrival to their leaving time. Spans that touch are one stretch of use. The
// board's own day runs from its boundary hour to the next; a stretch is that
// day's when it starts in it, so a night's late lock-up stays with the day it
// began and never becomes the next morning's. "Open by" is the first stretch
// the day begins; "Lock up after" is the last one's end, when that comes by
// the small hours after the day. A stretch already running as the day begins
// (a setup through the night) holds the building from before, and one that
// runs on past the night holds it after: each is named instead of a time.
// A booking running for days (an exhibition) has no daily hours on the
// Diary: only its first setup and its last clear-down are known, and they
// count; on each day it runs it is named, so the day's own times read as what
// they are, the other bookings' needs, beside it. A house block is a room
// taken out of use, not a reason to open the building, so it sets nothing.
// ---------------------------------------------------------------------------

const HOUR_MS = 3_600_000;
const DAY_MS = 24 * HOUR_MS;
/** The night after a board's day ends by this hour, or by its boundary when later. */
const NIGHT_ENDS_HOUR = 6;

export interface BuildingMoment {
  readonly atMs: number;
  /** Why then, in the floor's words: "Merchants' Breakfast Briefing sets up". */
  readonly why: string;
}

/** A booking holding the building across the edge of the day, or running for days. */
export interface BuildingHold {
  readonly title: string;
  readonly fromMs: number;
  readonly toMs: number;
  /** It sets up through the night (rather than running through it). */
  readonly setsUp: boolean;
  /** It runs for days: the Diary holds no daily hours for it. */
  readonly days: boolean;
}

/** A booking running for days, and where this day falls in it. */
export interface LongHold extends BuildingHold {
  readonly startsToday: boolean;
  readonly endsToday: boolean;
}

export interface BuildingDay {
  readonly openBy: BuildingMoment | null;
  readonly lockUpAfter: BuildingMoment | null;
  /** In use since before the day began; then there is no "open by". */
  readonly heldFrom: BuildingHold | null;
  /** Still in use after the night; then there is no "lock up after". */
  readonly heldUntil: BuildingHold | null;
  /** Bookings running for days that run on this day, with no daily hours on the Diary. */
  readonly longHolds: readonly LongHold[];
  /** Suppliers marked in and not out, earliest in first. */
  readonly stillIn: readonly SupplierArrival[];
}

interface Need {
  readonly fromMs: number;
  readonly toMs: number;
  /** Why the building opens for it, and why it can lock up after it; null where it does neither. */
  readonly opens: string | null;
  readonly closes: string | null;
  readonly hold: BuildingHold;
}

function holdOf(slot: DayBoardSlot): BuildingHold {
  return {
    title: slot.title,
    fromMs: slot.setupStartsAtMs,
    toMs: Math.max(slot.endsAtMs, slot.segments.clearDownEndsAtMs),
    setsUp: slot.setupStartsAtMs < slot.startsAtMs,
    days: slot.endsAtMs - slot.startsAtMs >= DAY_MS,
  };
}

/** A function's span; a booking running for days gives only its known edges. */
function slotNeeds(slot: DayBoardSlot): readonly Need[] {
  if (slot.kind === "internal_block" || slot.kind === "prospect") return [];
  const provisional = slot.kind === "hold" ? " (provisional)" : "";
  const hold = holdOf(slot);
  const opens = `${slot.title} ${hold.setsUp ? "sets up" : "begins"}${provisional}`;
  const closes = `${slot.title} ${hold.toMs > slot.endsAtMs ? "clears" : "ends"}${provisional}`;
  if (!hold.days) return [{ fromMs: hold.fromMs, toMs: hold.toMs, opens, closes, hold }];
  return [
    { fromMs: hold.fromMs, toMs: hold.fromMs, opens, closes: null, hold },
    { fromMs: hold.toMs, toMs: hold.toMs, opens: null, closes, hold },
  ];
}

function arrivalNeed(arrival: SupplierArrival): Need {
  const fromMs = Date.parse(arrival.arrivesAt);
  const opens = `${arrival.supplierName} due`;
  // With no leaving time, nobody knows when they go: they open the building, never close it.
  if (arrival.leavesBy === null) {
    return { fromMs, toMs: fromMs, opens, closes: null, hold: { title: arrival.supplierName, fromMs, toMs: fromMs, setsUp: false, days: false } };
  }
  const toMs = Date.parse(arrival.leavesBy);
  return { fromMs, toMs, opens, closes: `${arrival.supplierName} out`, hold: { title: arrival.supplierName, fromMs, toMs, setsUp: false, days: false } };
}

interface Stretch {
  readonly fromMs: number;
  readonly toMs: number;
  readonly needs: readonly Need[];
}

/** Spans that overlap or touch, as stretches of use, earliest first. */
function stretchesOf(needs: readonly Need[]): Stretch[] {
  const stretches: Stretch[] = [];
  for (const need of [...needs].sort((a, b) => a.fromMs - b.fromMs || a.toMs - b.toMs)) {
    const last = stretches[stretches.length - 1];
    if (last !== undefined && need.fromMs <= last.toMs) {
      stretches[stretches.length - 1] = { fromMs: last.fromMs, toMs: Math.max(last.toMs, need.toMs), needs: [...last.needs, need] };
    } else {
      stretches.push({ fromMs: need.fromMs, toMs: need.toMs, needs: [need] });
    }
  }
  return stretches;
}

/** The first need that opens the building. */
function earliest(needs: readonly Need[]): (Need & { readonly opens: string }) | undefined {
  let first: (Need & { readonly opens: string }) | undefined;
  for (const need of needs) {
    const opens = need.opens;
    if (opens !== null && (first === undefined || need.fromMs < first.fromMs)) first = { ...need, opens };
  }
  return first;
}

/** The last need that closes it. */
function latest(needs: readonly Need[]): (Need & { readonly closes: string }) | undefined {
  let last: (Need & { readonly closes: string }) | undefined;
  for (const need of needs) {
    const closes = need.closes;
    if (closes !== null && (last === undefined || need.toMs > last.toMs)) last = { ...need, closes };
  }
  return last;
}

/** The need that keeps a stretch going longest, whether or not it closes the building. */
function longest(needs: readonly Need[]): Need | undefined {
  return needs.reduce<Need | undefined>((last, need) => (last === undefined || need.toMs > last.toMs ? need : last), undefined);
}

/** "YYYY-MM-DD" moved by whole calendar days. */
function nextDate(date: string, days: number): string {
  const [year, month, day] = date.split("-").map(Number);
  return new Date(Date.UTC(year ?? 1970, (month ?? 1) - 1, (day ?? 1) + days)).toISOString().slice(0, 10);
}

export function buildingDay(
  lanes: readonly DayBoardLane[],
  arrivals: readonly SupplierArrival[],
  day: {
    /** The board's day, YYYY-MM-DD on the venue's clock. */
    readonly date: string;
    readonly dayBoundaryHour: number;
    readonly timeZone: string;
  },
): BuildingDay {
  const at = (date: string, hour: number): number => wallInputToMs(`${date}T${String(hour).padStart(2, "0")}:00`, day.timeZone) ?? Number.NaN;
  const nightHour = Math.max(day.dayBoundaryHour, NIGHT_ENDS_HOUR);
  const startMs = at(day.date, day.dayBoundaryHour);
  const endMs = at(nextDate(day.date, 1), day.dayBoundaryHour);
  // Last night's lock-up ends by this; tonight's by the next.
  const lastNightEndsMs = at(day.date, nightHour);
  const tonightEndsMs = at(nextDate(day.date, 1), nightHour);

  const slots = lanes.flatMap((lane) => lane.slots);
  const needs = [...slots.flatMap(slotNeeds), ...arrivals.map(arrivalNeed)];
  const stretches = stretchesOf(needs);
  // A stretch running as the day begins, past last night's lock-up, holds the building from before.
  const carried = stretches.find((stretch) => stretch.fromMs < startMs && stretch.toMs > lastNightEndsMs);
  const own = stretches.filter((stretch) => stretch.fromMs >= startMs && stretch.fromMs < endMs);
  const opener = carried === undefined ? earliest(own.flatMap((stretch) => stretch.needs)) : undefined;
  const mine = [...(carried === undefined ? [] : [carried]), ...own];
  const last = mine.reduce<Stretch | undefined>((end, stretch) => (end === undefined || stretch.toMs > end.toMs ? stretch : end), undefined);
  const runsOn = last !== undefined && last.toMs > tonightEndsMs;
  const closer = latest(mine.flatMap((stretch) => stretch.needs));
  const heldFrom = carried === undefined ? undefined : earliest(carried.needs) ?? carried.needs[0];
  const heldUntil = runsOn ? longest(last.needs) : undefined;
  // Bookings running for days that run during this board day.
  const longHolds = slots
    .filter((slot) => slot.kind !== "internal_block" && slot.kind !== "prospect")
    .map(holdOf)
    .filter((hold) => hold.days && hold.fromMs < endMs && hold.toMs > startMs)
    .map((hold) => ({ ...hold, startsToday: hold.fromMs >= startMs, endsToday: hold.toMs <= tonightEndsMs }));

  return {
    openBy: opener === undefined ? null : { atMs: opener.fromMs, why: opener.opens },
    lockUpAfter: closer === undefined || runsOn ? null : { atMs: closer.toMs, why: closer.closes },
    heldFrom: heldFrom?.hold ?? null,
    heldUntil: heldUntil?.hold ?? null,
    longHolds,
    stillIn: arrivals
      .filter((arrival) => arrival.arrivedAt !== null && arrival.leftAt === null)
      .sort((a, b) => Date.parse(a.arrivedAt ?? a.arrivesAt) - Date.parse(b.arrivedAt ?? b.arrivesAt)),
  };
}
