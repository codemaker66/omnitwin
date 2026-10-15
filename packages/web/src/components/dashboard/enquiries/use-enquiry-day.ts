import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { isBookingEnquiry, type Booking, type CalendarEntry, type CalendarRoom } from "@omnitwin/types";
import { ApiError } from "../../../api/client.js";
import { getCalendar, listEnquiryBookings } from "../../../api/diary.js";
import type { Enquiry } from "../../../api/enquiries.js";
import { boardRange } from "../../../pages/diary/lib/board-time.js";
import { HOLDABLE_ENQUIRY_STATES } from "../../../pages/diary/lib/enquiry-link.js";

// ---------------------------------------------------------------------------
// The Diary as the open enquiry needs it (T-635, roadmap Tier A #4): the day
// it asks for, room by room, and its own live bookings wherever they are.
//
// Read where the person stops. An answer kept from earlier shows at once, and
// the day is read again a quarter of a second after the enquiry is shown, so
// stepping through with J and K reads only where the person stops. It is read
// again when the page comes back into view, when Approve is pressed and on Try
// again, at once; never on a timer. Answers are kept per venue and day (rooms
// and entries, so each enquiry works out its own standing) and per enquiry, at
// most 32 of each, for as long as the desk is open. Only the open enquiry's
// answer is used, and an aborted read changes nothing. A refusal (401 or 403)
// means this reader may not read the Diary: nothing more is read.
// ---------------------------------------------------------------------------

export const ENQUIRY_DAY_SETTLE_MS = 250;
const KEEP = 32;

/** What is read for one enquiry. */
export interface EnquiryDayPlan {
  readonly enquiryId: string;
  readonly venueId: string;
  /** The day asked for, midnight to midnight on the Diary's clock; null when
   *  no day is read (no date asked, or a closed enquiry). */
  readonly day: { readonly iso: string; readonly startMs: number; readonly endMs: number } | null;
}

/** Midday (UTC) of a real calendar date, "2027-05-14"; NaN for anything
 *  else, "2027-02-30" included, which Date.parse would roll into March. */
function calendarNoon(iso: string): number {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/u.exec(iso);
  if (match === null) return Number.NaN;
  const [year, month, day] = [Number(match[1]), Number(match[2]), Number(match[3])];
  const noon = new Date(Date.UTC(year, month - 1, day, 12));
  return noon.getUTCFullYear() === year && noon.getUTCMonth() === month - 1 && noon.getUTCDate() === day ? noon.getTime() : Number.NaN;
}

/** What is read for an enquiry, or null when nothing is: only a booking
 *  enquiry at the venue whose Diary the reader reads. A closed enquiry, or
 *  one with no date, reads only its own bookings. */
export function enquiryDayPlan(
  enquiry: Pick<Enquiry, "id" | "venueId" | "eventType" | "state" | "preferredDate"> | undefined,
  diaryVenueId: string | null,
): EnquiryDayPlan | null {
  if (enquiry === undefined || diaryVenueId === null || enquiry.venueId !== diaryVenueId) return null;
  if (!isBookingEnquiry(enquiry.eventType)) return null;
  const iso = enquiry.preferredDate;
  const noon = iso === null ? Number.NaN : calendarNoon(iso);
  if (iso === null || !Number.isFinite(noon) || !HOLDABLE_ENQUIRY_STATES.includes(enquiry.state)) {
    return { enquiryId: enquiry.id, venueId: enquiry.venueId, day: null };
  }
  const range = boardRange(noon, "day");
  return { enquiryId: enquiry.id, venueId: enquiry.venueId, day: { iso, startMs: range.fromMs, endMs: range.toMs } };
}

interface KeptDay {
  readonly rooms: readonly CalendarRoom[];
  readonly entries: readonly CalendarEntry[];
  readonly readAtMs: number;
}

interface KeptOwn {
  readonly bookings: readonly Booking[];
  readonly readAtMs: number;
}

export interface EnquiryDayAnswer {
  /** The day asked for, with its rooms and entries; null when no day is read. */
  readonly day: {
    readonly rooms: readonly CalendarRoom[];
    readonly entries: readonly CalendarEntry[];
    readonly startMs: number;
    readonly endMs: number;
  } | null;
  readonly own: readonly Booking[];
  /** When the older half of the answer was read. */
  readonly readAtMs: number;
}

export interface EnquiryDay {
  /**
   * off: nothing is read for the open enquiry (a request, another venue's,
   * a reader of no Diary, or after a refusal); waiting: the quarter second
   * before the first read; reading: a read is out and nothing is kept;
   * ready: an answer, kept or fresh; failed: nothing could be read.
   */
  readonly status: "off" | "waiting" | "reading" | "ready" | "failed";
  readonly plan: EnquiryDayPlan | null;
  readonly answer: EnquiryDayAnswer | null;
  /** The latest read for the open enquiry failed; a kept answer stays. */
  readonly failed: boolean;
  /** A read for the open enquiry is out. */
  readonly reading: boolean;
  /** Counts finished reads, whether they landed or failed. */
  readonly settled: number;
  /** Reads again at once: Try again, and Approve. */
  readonly readNow: () => void;
}

const NOTHING_KEPT = new Map<string, never>();

function remember<T>(kept: ReadonlyMap<string, T>, key: string, value: T): ReadonlyMap<string, T> {
  const next = new Map(kept);
  // Re-inserted, so the map's order is oldest read first.
  next.delete(key);
  next.set(key, value);
  for (const oldest of next.keys()) {
    if (next.size <= KEEP) break;
    next.delete(oldest);
  }
  return next;
}

function planKey(plan: EnquiryDayPlan): string {
  return `${plan.enquiryId}:${plan.venueId}:${plan.day?.iso ?? ""}`;
}

function dayKey(venueId: string, iso: string): string {
  return `${venueId}:${iso}`;
}

function isRefusal(reason: unknown): boolean {
  return reason instanceof ApiError && (reason.status === 401 || reason.status === 403);
}

export function useEnquiryDay(enquiry: Enquiry | undefined, diaryVenueId: string | null): EnquiryDay {
  const [days, setDays] = useState<ReadonlyMap<string, KeptDay>>(NOTHING_KEPT);
  const [owns, setOwns] = useState<ReadonlyMap<string, KeptOwn>>(NOTHING_KEPT);
  const [readingKey, setReadingKey] = useState<string | null>(null);
  const [failedKey, setFailedKey] = useState<string | null>(null);
  const [refused, setRefused] = useState(false);
  const [settled, setSettled] = useState(0);
  const plan = refused ? null : enquiryDayPlan(enquiry, diaryVenueId);
  const key = plan === null ? null : planKey(plan);
  const planRef = useRef(plan);
  planRef.current = plan;
  const controllerRef = useRef<AbortController | null>(null);

  const readNow = useCallback((): void => {
    const target = planRef.current;
    if (target === null) return;
    const readKey = planKey(target);
    controllerRef.current?.abort();
    const controller = new AbortController();
    controllerRef.current = controller;
    setReadingKey(readKey);
    const dayRead = target.day === null ? Promise.resolve(null)
      : getCalendar(target.venueId, new Date(target.day.startMs).toISOString(), new Date(target.day.endMs).toISOString(), controller.signal);
    void Promise.allSettled([dayRead, listEnquiryBookings(target.enquiryId, controller.signal)]).then(([day, own]) => {
      if (controller.signal.aborted) return;
      controllerRef.current = null;
      const readAtMs = Date.now();
      if (day.status === "fulfilled" && day.value !== null && target.day !== null) {
        const kept: KeptDay = { rooms: day.value.rooms, entries: day.value.entries, readAtMs };
        setDays((previous) => remember(previous, dayKey(target.venueId, target.day?.iso ?? ""), kept));
      }
      if (own.status === "fulfilled") {
        setOwns((previous) => remember(previous, target.enquiryId, { bookings: own.value, readAtMs }));
      }
      const failures = [day, own].flatMap((result) => result.status === "rejected" ? [result.reason as unknown] : []);
      if (failures.some(isRefusal)) setRefused(true);
      setFailedKey(failures.length > 0 ? readKey : null);
      setReadingKey((current) => (current === readKey ? null : current));
      setSettled((count) => count + 1);
    });
  }, []);

  // Shown: read a quarter of a second later, unless the person moves on. A
  // failure belongs to the visit it happened in.
  useEffect(() => {
    if (key === null) return;
    setFailedKey(null);
    const timer = window.setTimeout(readNow, ENQUIRY_DAY_SETTLE_MS);
    return () => {
      window.clearTimeout(timer);
      controllerRef.current?.abort();
      controllerRef.current = null;
      setReadingKey(null);
    };
  }, [key, readNow]);

  // Back on the page: the Diary may have moved meanwhile (a date held in
  // another tab), so it is read again at once.
  useEffect(() => {
    const onVisible = (): void => {
      if (document.visibilityState === "visible") readNow();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => { document.removeEventListener("visibilitychange", onVisible); };
  }, [readNow]);

  const keptDay = plan?.day == null ? undefined : days.get(dayKey(plan.venueId, plan.day.iso));
  const keptOwn = plan === null ? undefined : owns.get(plan.enquiryId);
  const answer = useMemo((): EnquiryDayAnswer | null => {
    if (plan === null || keptOwn === undefined) return null;
    if (plan.day === null) return { day: null, own: keptOwn.bookings, readAtMs: keptOwn.readAtMs };
    if (keptDay === undefined) return null;
    return {
      day: { rooms: keptDay.rooms, entries: keptDay.entries, startMs: plan.day.startMs, endMs: plan.day.endMs },
      own: keptOwn.bookings,
      readAtMs: Math.min(keptDay.readAtMs, keptOwn.readAtMs),
    };
    // The plan is fully described by its key.
  }, [key, keptDay, keptOwn]);
  const reading = key !== null && readingKey === key;
  const failed = key !== null && failedKey === key;
  const status = plan === null ? "off" : answer !== null ? "ready" : reading ? "reading" : failed ? "failed" : "waiting";
  return { status, plan, answer, failed, reading, settled, readNow };
}
