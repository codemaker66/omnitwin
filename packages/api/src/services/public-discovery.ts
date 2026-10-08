import { and, asc, eq, gt, inArray, isNull, lt } from "drizzle-orm";
import {
  CAPACITY_FORMATS,
  FloorPlanOutlineSchema,
  ROOM_BLOCKING_BOOKING_KINDS,
  TRADES_HALL_PUBLIC_PROFILE,
  addRotaDays,
  formatPublishedAddress,
  publishedRoomCapacity,
  resolveRotaTimeZone,
  rotaInstant,
  rotaLocalDate,
  type FloorPlanPoint,
  type PublicVenueProfile,
  type PublishedPostalAddress,
} from "@omnitwin/types";
import { bookings, spaces, venues } from "../db/schema.js";
import type { Database } from "../db/client.js";

// ---------------------------------------------------------------------------
// Public venue discovery (T-649) — what AI assistants may read about a venue.
//
// Blake's decision, 8 October 2026: "Yes, read-only" — "Public: venue facts,
// room capacities from venue records, and free/busy dates only (no client
// names). Enquiries still go through staff." This module is that boundary:
//
//   - Only venues in PUBLIC_DISCOVERY_VENUES exist here. Every other tenant is
//     indistinguishable from a venue that does not exist.
//   - Bookings are read as (room, start, end) of the kinds that block a room
//     (ROOM_BLOCKING_BOOKING_KINDS: confirmed bookings and the venue's own
//     blocks) and nothing else: no title, client, event, owner, note, status
//     or count ever leaves the query, so none can reach a response.
//   - Capacities are the venue's published figures with their provenance, or
//     null with a "not published" note. Nothing is estimated.
//   - Both reads are cached for a few minutes, so public traffic costs at most
//     one small query per venue per cache period.
// ---------------------------------------------------------------------------

/** The venues opted into public discovery, by DATABASE slug. Adding one is a
 *  reviewed code change: the venue must have agreed, as Trades Hall has. */
export const PUBLIC_DISCOVERY_VENUES: readonly PublicVenueProfile[] = [TRADES_HALL_PUBLIC_PROFILE];

/** The longest range one availability request may cover. */
export const AVAILABILITY_MAX_SPAN_DAYS = 92;
/** How far ahead availability may be asked about, from the venue's today. */
export const AVAILABILITY_HORIZON_DAYS = 730;
/** How long a venue's rooms and blocking times are reused before re-reading. */
export const PUBLIC_DISCOVERY_CACHE_TTL_MS = 5 * 60_000;
/** The Diary's operational day starts at 04:00 venue-local time
 *  (routes/room-layout-timeline.ts), so an evening that runs past midnight
 *  belongs to the date it started on. Public dates follow the same rule. */
export const VENUE_DAY_START_MINUTE = 4 * 60;
/** A defensive ceiling on blocking rows per read; far above any venue's two
 *  years. Exceeding it fails the request rather than answer from part of it. */
const BLOCKING_INTERVAL_ROW_LIMIT = 50_000;

export const VENUE_NOT_AVAILABLE_MESSAGE = "That venue's public information is not available.";
const TEMPORARILY_UNAVAILABLE_MESSAGE =
  "The venue's information could not be read just now. Please try again shortly, or contact the venue team directly.";

// ---------------------------------------------------------------------------
// Records and the store that reads them
// ---------------------------------------------------------------------------

export interface PublicRoomRecord {
  readonly id: string;
  readonly slug: string;
  readonly name: string;
  /** Numeric columns arrive as decimal strings. */
  readonly widthM: string;
  readonly lengthM: string;
  readonly heightM: string;
  readonly floorPlanOutline: unknown;
}

export interface PublicVenueRecord {
  readonly id: string;
  readonly slug: string;
  readonly timeZone: string;
  readonly rooms: readonly PublicRoomRecord[];
}

/** When a room is unavailable — and nothing else about why. */
export interface BlockingInterval {
  readonly spaceId: string;
  readonly startsAt: Date;
  readonly endsAt: Date;
}

export interface PublicDiscoveryStore {
  loadVenue(slug: string): Promise<PublicVenueRecord | null>;
  /** Blocking intervals overlapping [from, to), half-open as the Diary reads. */
  loadBlockingIntervals(venueId: string, from: Date, to: Date): Promise<readonly BlockingInterval[]>;
}

export function drizzlePublicDiscoveryStore(db: Database): PublicDiscoveryStore {
  return {
    async loadVenue(slug) {
      const [venue] = await db
        .select({ id: venues.id, slug: venues.slug, timeZone: venues.timezone })
        .from(venues)
        .where(and(eq(venues.slug, slug), isNull(venues.deletedAt)))
        .limit(1);
      if (venue === undefined) return null;
      const rooms = await db
        .select({
          id: spaces.id,
          slug: spaces.slug,
          name: spaces.name,
          widthM: spaces.widthM,
          lengthM: spaces.lengthM,
          heightM: spaces.heightM,
          floorPlanOutline: spaces.floorPlanOutline,
        })
        .from(spaces)
        .where(and(eq(spaces.venueId, venue.id), isNull(spaces.deletedAt)))
        .orderBy(asc(spaces.sortOrder), asc(spaces.name), asc(spaces.id));
      return { ...venue, rooms };
    },
    async loadBlockingIntervals(venueId, from, to) {
      // Three columns, by construction: the public read cannot carry a title,
      // client, owner or note because it never selects one.
      const rows = await db
        .select({ spaceId: bookings.spaceId, startsAt: bookings.startsAt, endsAt: bookings.endsAt })
        .from(bookings)
        .where(and(
          eq(bookings.venueId, venueId),
          isNull(bookings.deletedAt),
          eq(bookings.status, "active"),
          inArray(bookings.kind, [...ROOM_BLOCKING_BOOKING_KINDS]),
          lt(bookings.startsAt, to),
          gt(bookings.endsAt, from),
        ))
        .orderBy(asc(bookings.startsAt), asc(bookings.id))
        .limit(BLOCKING_INTERVAL_ROW_LIMIT + 1);
      if (rows.length > BLOCKING_INTERVAL_ROW_LIMIT) {
        throw new Error("Blocking interval read exceeded its ceiling");
      }
      return rows;
    },
  };
}

// ---------------------------------------------------------------------------
// Dates — the venue's calendar, read through the shared venue-clock helpers
// ---------------------------------------------------------------------------

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/u;

/** A real YYYY-MM-DD calendar date (no 30 February). */
export function isCalendarDate(value: string): boolean {
  if (!DATE_PATTERN.test(value)) return false;
  const [year = 0, month = 0, day = 0] = value.split("-").map(Number);
  if (year < 1970 || year > 9999) return false;
  const probe = new Date(Date.UTC(year, month - 1, day));
  return probe.getUTCFullYear() === year && probe.getUTCMonth() === month - 1 && probe.getUTCDate() === day;
}

/** Inclusive count of dates from `from` to `to` (both YYYY-MM-DD). */
export function inclusiveDayCount(from: string, to: string): number {
  const [fy = 0, fm = 1, fd = 1] = from.split("-").map(Number);
  const [ty = 0, tm = 1, td = 1] = to.split("-").map(Number);
  return Math.round((Date.UTC(ty, tm - 1, td) - Date.UTC(fy, fm - 1, fd)) / 86_400_000) + 1;
}

/** The instants a venue date covers: 04:00 that day to 04:00 the next, on the
 *  venue's clock — 23 or 25 hours long across a clock change. */
export function venueDayWindow(date: string, timeZone: string): { readonly startMs: number; readonly endMs: number } {
  return {
    startMs: rotaInstant(date, VENUE_DAY_START_MINUTE, timeZone),
    endMs: rotaInstant(addRotaDays(date, 1), VENUE_DAY_START_MINUTE, timeZone),
  };
}

export type DayStatus = "free" | "busy";

/** Free or busy for each date, for one room. Busy when any blocking interval
 *  overlaps the date's window (half-open: touching edges do not overlap). */
export function roomDayStatuses(
  intervals: readonly BlockingInterval[],
  dates: readonly string[],
  timeZone: string,
): Record<string, DayStatus> {
  const statuses: Record<string, DayStatus> = {};
  for (const date of dates) {
    const { startMs, endMs } = venueDayWindow(date, timeZone);
    const busy = intervals.some((interval) =>
      interval.startsAt.getTime() < endMs && interval.endsAt.getTime() > startMs);
    statuses[date] = busy ? "busy" : "free";
  }
  return statuses;
}

// ---------------------------------------------------------------------------
// Rooms — measured record plus published capacities
// ---------------------------------------------------------------------------

/** Area of a simple polygon in square metres (shoelace), or null if the
 *  outline is not a valid floor plan. */
export function floorAreaM2(outline: unknown): number | null {
  const parsed = FloorPlanOutlineSchema.safeParse(outline);
  if (!parsed.success) return null;
  const points: readonly FloorPlanPoint[] = parsed.data;
  let twiceArea = 0;
  for (let index = 0; index < points.length; index += 1) {
    const current = points[index];
    const next = points[(index + 1) % points.length];
    if (current === undefined || next === undefined) return null;
    twiceArea += current.x * next.y - next.x * current.y;
  }
  const area = Math.abs(twiceArea) / 2;
  return area > 0 ? Math.round(area * 10) / 10 : null;
}

function metres(value: string): number | null {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

export interface PublicCapacity {
  readonly layout: string;
  readonly label: string;
  readonly description: string;
  /** The venue's published figure, or null where none is published. */
  readonly maxGuests: number | null;
  readonly note: string | null;
}

export interface PublicRoomDescription {
  readonly slug: string;
  readonly name: string;
  readonly dimensions: {
    readonly widthM: number | null;
    readonly lengthM: number | null;
    readonly heightM: number | null;
    readonly floorAreaM2: number | null;
  };
  readonly capacities: readonly PublicCapacity[];
  readonly capacitySource: {
    readonly publishedBy: string;
    readonly statement: string;
    readonly url: string;
  } | null;
}

export interface PublicVenueDescription {
  readonly venue: {
    readonly slug: string;
    readonly name: string;
    readonly alternateName: string;
    readonly address: PublishedPostalAddress & { readonly text: string };
    readonly timeZone: string;
    readonly officialWebsite: string;
    readonly venviewerPage: string;
  };
  readonly rooms: readonly PublicRoomDescription[];
  readonly notes: {
    readonly dimensions: string;
    readonly capacities: string;
    readonly availability: string;
    readonly enquiries: string;
  };
}

const NOT_PUBLISHED_NOTE =
  "Not published: the venue has not published a capacity for this room in this layout. Ask the venue team.";

export function describeRoom(profile: PublicVenueProfile, room: PublicRoomRecord): PublicRoomDescription {
  const published = publishedRoomCapacity(profile, room.slug);
  return {
    slug: room.slug,
    name: room.name,
    dimensions: {
      widthM: metres(room.widthM),
      lengthM: metres(room.lengthM),
      heightM: metres(room.heightM),
      floorAreaM2: floorAreaM2(room.floorPlanOutline),
    },
    capacities: CAPACITY_FORMATS.map((format) => {
      const figure = published === null ? null : published[format.key];
      return {
        layout: format.key,
        label: format.label,
        description: format.description,
        maxGuests: figure,
        note: figure === null ? NOT_PUBLISHED_NOTE : null,
      };
    }),
    capacitySource: published === null
      ? null
      : { publishedBy: profile.name, statement: profile.capacityProvenance, url: profile.officialWebsite },
  };
}

export function describeVenue(profile: PublicVenueProfile, record: PublicVenueRecord): PublicVenueDescription {
  return {
    venue: {
      slug: profile.dbSlug,
      name: profile.name,
      alternateName: profile.alternateName,
      address: { ...profile.address, text: formatPublishedAddress(profile.address) },
      timeZone: resolveRotaTimeZone(record.timeZone),
      officialWebsite: profile.officialWebsite,
      venviewerPage: profile.venviewerUrl,
    },
    rooms: record.rooms.map((room) => describeRoom(profile, room)),
    notes: {
      dimensions:
        "Room dimensions are the venue's room records in Venviewer, in metres; floor area is computed from the recorded floor plan.",
      capacities:
        "Capacities are only the venue's own published figures, cited with their source. A layout without one is null and marked not published; final numbers depend on the layout agreed with the venue team.",
      availability: "Use check_availability for free or busy dates. It never shows who has booked or why.",
      enquiries: "Use how_to_enquire. Enquiries go to the venue team; nothing here can hold or book a date.",
    },
  };
}

// ---------------------------------------------------------------------------
// Enquiries — the staff path, described
// ---------------------------------------------------------------------------

export interface EnquiryGuide {
  readonly venue: string;
  readonly name: string;
  readonly enquiryUrl: string;
  readonly howItWorks: string;
  readonly include: readonly string[];
  readonly otherWays: {
    readonly telephone: string;
    readonly email: string;
    readonly officialWebsite: string;
  };
}

export function enquiryGuide(profile: PublicVenueProfile): EnquiryGuide {
  return {
    venue: profile.dbSlug,
    name: profile.name,
    enquiryUrl: profile.enquiryUrl,
    howItWorks:
      "Enquiries go to the venue's own events team, who reply directly. This service cannot send an enquiry, hold a date or make a booking: nothing is reserved until the team confirms it with you.",
    include: [
      "The occasion: for example a wedding, dinner, conference or drinks reception.",
      "Your preferred date, and any alternative dates.",
      "Roughly how many guests.",
      "The room you have in mind, if any (get_venue lists them).",
      "Your name and email address, and a phone number if you would like a call.",
    ],
    otherWays: {
      telephone: profile.telephone,
      email: profile.email,
      officialWebsite: profile.officialWebsite,
    },
  };
}

// ---------------------------------------------------------------------------
// The service: allowlist, cache, availability
// ---------------------------------------------------------------------------

export type DiscoveryOutcome<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly message: string };

export interface AvailabilityRequest {
  readonly venue: string;
  readonly from: string;
  readonly to: string;
  readonly room?: string | undefined;
}

export interface AvailabilityReport {
  readonly venue: string;
  readonly timeZone: string;
  readonly from: string;
  readonly to: string;
  /** When the venue's diary was last read for this answer. */
  readonly asOf: string;
  readonly dayRule: string;
  readonly meaning: { readonly free: string; readonly busy: string };
  readonly rooms: readonly {
    readonly room: string;
    readonly name: string;
    readonly days: Readonly<Record<string, DayStatus>>;
  }[];
  readonly enquire: string;
}

interface CacheEntry<T> {
  readonly loadedAtMs: number;
  readonly value: Promise<T>;
}

interface IntervalWindow {
  readonly fromMs: number;
  readonly toMs: number;
  readonly intervals: readonly BlockingInterval[];
}

export interface PublicDiscoveryOptions {
  readonly store: PublicDiscoveryStore;
  readonly venues?: readonly PublicVenueProfile[];
  readonly now?: () => number;
  readonly cacheTtlMs?: number;
  /** Told when a read fails; the caller sees only a plain message. */
  readonly onReadError?: (error: unknown) => void;
}

export class PublicDiscovery {
  readonly venues: readonly PublicVenueProfile[];
  private readonly store: PublicDiscoveryStore;
  private readonly now: () => number;
  private readonly ttlMs: number;
  private readonly onReadError: (error: unknown) => void;
  private readonly venueCache = new Map<string, CacheEntry<PublicVenueRecord | null>>();
  private readonly intervalCache = new Map<string, CacheEntry<IntervalWindow>>();

  constructor(options: PublicDiscoveryOptions) {
    this.venues = options.venues ?? PUBLIC_DISCOVERY_VENUES;
    if (this.venues.length === 0) throw new Error("Public discovery needs at least one opted-in venue");
    this.store = options.store;
    this.now = options.now ?? Date.now;
    this.ttlMs = options.cacheTtlMs ?? PUBLIC_DISCOVERY_CACHE_TTL_MS;
    this.onReadError = options.onReadError ?? (() => undefined);
  }

  /** The opted-in profile for a DATABASE slug; undefined for anything else. */
  profile(slug: string): PublicVenueProfile | undefined {
    return this.venues.find((venue) => venue.dbSlug === slug);
  }

  async describe(slug: string): Promise<DiscoveryOutcome<PublicVenueDescription>> {
    const profile = this.profile(slug);
    if (profile === undefined) return { ok: false, message: VENUE_NOT_AVAILABLE_MESSAGE };
    try {
      const { value: record } = await this.cached(this.venueCache, slug, () => this.store.loadVenue(slug));
      if (record === null) return { ok: false, message: VENUE_NOT_AVAILABLE_MESSAGE };
      return { ok: true, value: describeVenue(profile, record) };
    } catch (error) {
      this.onReadError(error);
      return { ok: false, message: TEMPORARILY_UNAVAILABLE_MESSAGE };
    }
  }

  guide(slug: string): DiscoveryOutcome<EnquiryGuide> {
    const profile = this.profile(slug);
    return profile === undefined
      ? { ok: false, message: VENUE_NOT_AVAILABLE_MESSAGE }
      : { ok: true, value: enquiryGuide(profile) };
  }

  async availability(request: AvailabilityRequest): Promise<DiscoveryOutcome<AvailabilityReport>> {
    const profile = this.profile(request.venue);
    if (profile === undefined) return { ok: false, message: VENUE_NOT_AVAILABLE_MESSAGE };
    try {
      const { value: record } = await this.cached(this.venueCache, request.venue, () => this.store.loadVenue(request.venue));
      if (record === null) return { ok: false, message: VENUE_NOT_AVAILABLE_MESSAGE };
      const timeZone = resolveRotaTimeZone(record.timeZone);
      const nowMs = this.now();
      const today = rotaLocalDate(nowMs, timeZone);
      const horizon = addRotaDays(today, AVAILABILITY_HORIZON_DAYS);
      if (request.from < today) {
        return { ok: false, message: `"from" must be today (${today}, venue time) or later.` };
      }
      if (request.to > horizon) {
        return {
          ok: false,
          message: `"to" can be at most ${String(AVAILABILITY_HORIZON_DAYS)} days ahead (${horizon}); the venue team can advise on later dates.`,
        };
      }
      const rooms = request.room === undefined
        ? record.rooms
        : record.rooms.filter((room) => room.slug === request.room);
      if (rooms.length === 0) {
        const known = record.rooms.map((room) => `${room.slug} (${room.name})`).join(", ");
        return { ok: false, message: `There is no room "${request.room ?? ""}" at this venue. Rooms: ${known}.` };
      }

      // One cached read covers every date a request may ask about: yesterday
      // through the horizon (plus a day), so the cache stays one entry per
      // venue whatever ranges callers choose.
      const windowFrom = venueDayWindow(addRotaDays(today, -1), timeZone).startMs;
      const windowTo = venueDayWindow(addRotaDays(horizon, 1), timeZone).endMs;
      const requestFrom = venueDayWindow(request.from, timeZone).startMs;
      const requestTo = venueDayWindow(request.to, timeZone).endMs;
      const { value: window, loadedAtMs } = await this.cached(
        this.intervalCache,
        record.id,
        async () => ({
          fromMs: windowFrom,
          toMs: windowTo,
          intervals: await this.store.loadBlockingIntervals(record.id, new Date(windowFrom), new Date(windowTo)),
        }),
        (cached) => cached.fromMs <= requestFrom && cached.toMs >= requestTo,
      );

      const dates: string[] = [];
      for (let date = request.from; date <= request.to; date = addRotaDays(date, 1)) dates.push(date);

      return {
        ok: true,
        value: {
          venue: profile.dbSlug,
          timeZone,
          from: request.from,
          to: request.to,
          asOf: new Date(loadedAtMs).toISOString(),
          dayRule: `Each date runs from 04:00 to 04:00 the next morning, venue time (${timeZone}), as the venue's own diary counts a day, so an evening that runs past midnight belongs to the date it started on.`,
          meaning: {
            free: "No confirmed booking and no venue closure in this room on this date. A date can still carry provisional options, so the venue team confirms availability when you enquire.",
            busy: "The room has a confirmed booking or a venue closure at some time on this date.",
          },
          rooms: rooms.map((room) => ({
            room: room.slug,
            name: room.name,
            days: roomDayStatuses(window.intervals.filter((interval) => interval.spaceId === room.id), dates, timeZone),
          })),
          enquire: profile.enquiryUrl,
        },
      };
    } catch (error) {
      this.onReadError(error);
      return { ok: false, message: TEMPORARILY_UNAVAILABLE_MESSAGE };
    }
  }

  /** A per-key read reused for the TTL; concurrent misses share one read, and
   *  a failed read is forgotten so the next request tries again. */
  private async cached<T>(
    cache: Map<string, CacheEntry<T>>,
    key: string,
    load: () => Promise<T>,
    covers?: (value: T) => boolean,
  ): Promise<{ readonly value: T; readonly loadedAtMs: number }> {
    const nowMs = this.now();
    const existing = cache.get(key);
    if (existing !== undefined && nowMs - existing.loadedAtMs < this.ttlMs) {
      const value = await existing.value;
      if (covers === undefined || covers(value)) return { value, loadedAtMs: existing.loadedAtMs };
    }
    const entry: CacheEntry<T> = { loadedAtMs: nowMs, value: load() };
    cache.set(key, entry);
    void entry.value.catch(() => {
      if (cache.get(key) === entry) cache.delete(key);
    });
    return { value: await entry.value, loadedAtMs: nowMs };
  }
}
