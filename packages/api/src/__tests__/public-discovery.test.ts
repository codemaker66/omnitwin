import { describe, expect, it, vi } from "vitest";
import {
  ROOM_BLOCKING_BOOKING_KINDS,
  ROOM_OPTION_BOOKING_KINDS,
  TRADES_HALL_PUBLIC_PROFILE,
  bookingRoomStatus,
  isLiveBooking,
  publicDayStatus,
  type BookingKind,
  type BookingLiveness,
  type PublicVenueProfile,
} from "@omnitwin/types";
import {
  PUBLIC_DISCOVERY_CACHE_TTL_MS,
  PUBLIC_DISCOVERY_VENUES,
  PublicDiscovery,
  VENUE_NOT_AVAILABLE_MESSAGE,
  describeRoom,
  floorAreaM2,
  inclusiveDayCount,
  isCalendarDate,
  roomDayStatuses,
  venueDayWindow,
  type PublicDiscoveryStore,
  type PublicRoomRecord,
  type PublicVenueRecord,
  type RoomInterval,
} from "../services/public-discovery.js";

// ---------------------------------------------------------------------------
// The public discovery boundary (T-649), without a database: the Diary's
// busy and held rule, the venue's operational day across Europe/London clock
// changes, published-only capacities, the allowlist, and the cache.
// public-mcp-postgres.test.ts runs the same rules through the real query
// against migrated PostgreSQL.
// ---------------------------------------------------------------------------

const LONDON = "Europe/London";
const HOUR = 3_600_000;

function interval(spaceId: string, startsAt: string, endsAt: string, effect: "busy" | "held" = "busy"): RoomInterval {
  return { spaceId, effect, startsAt: new Date(startsAt), endsAt: new Date(endsAt) };
}

function room(slug: string, overrides: Partial<PublicRoomRecord> = {}): PublicRoomRecord {
  return {
    id: `id-${slug}`,
    slug,
    name: slug,
    widthM: "21",
    lengthM: "10.5",
    heightM: "7",
    floorPlanOutline: [{ x: 0, y: 0 }, { x: 21, y: 0 }, { x: 21, y: 10.5 }, { x: 0, y: 10.5 }],
    ...overrides,
  };
}

describe("the Diary's busy and held rule", () => {
  const cases: readonly [BookingKind, BookingLiveness, "busy" | "held" | null][] = [
    ["ink", "active", "busy"],
    ["internal_block", "active", "busy"],
    ["hold", "active", "held"],
    ["prospect", "active", null],
    ["ink", "cancelled", null],
    ["internal_block", "released", null],
    ["hold", "released", null],
    ["hold", "expired", null],
    ["hold", "lost", null],
    ["prospect", "lost", null],
  ];

  it.each(cases)("%s / %s makes the room %s", (kind, status, effect) => {
    expect(bookingRoomStatus({ kind, status, deletedAt: null })).toBe(effect);
  });

  it("never counts a soft-deleted booking, whatever its kind", () => {
    for (const kind of ["ink", "internal_block", "hold"] as const) {
      expect(bookingRoomStatus({ kind, status: "active", deletedAt: new Date() })).toBeNull();
    }
  });

  it("reads liveness exactly as the Diary does: active and not deleted, nothing on the clock", () => {
    expect(isLiveBooking({ status: "active", deletedAt: null })).toBe(true);
    expect(isLiveBooking({ status: "active", deletedAt: "2026-10-01T00:00:00.000Z" })).toBe(false);
    for (const status of ["released", "expired", "cancelled", "lost"] as const) {
      expect(isLiveBooking({ status, deletedAt: null })).toBe(false);
    }
  });

  it("is confirmed bookings and the venue's own blocks for busy, provisional holds for held", () => {
    expect([...ROOM_BLOCKING_BOOKING_KINDS]).toEqual(["ink", "internal_block"]);
    expect([...ROOM_OPTION_BOOKING_KINDS]).toEqual(["hold"]);
  });

  it("answers busy over held over free, never more than the one word", () => {
    expect(publicDayStatus([])).toBe("free");
    expect(publicDayStatus(["held"])).toBe("held");
    expect(publicDayStatus(["held", "held", "held"])).toBe("held");
    expect(publicDayStatus(["held", "busy", "held"])).toBe("busy");
    expect(publicDayStatus(["busy"])).toBe("busy");
  });
});

describe("the venue's operational day (04:00 to 04:00, Europe/London)", () => {
  it("is 24 hours on an ordinary date", () => {
    const window = venueDayWindow("2026-11-14", LONDON);
    expect(new Date(window.startMs).toISOString()).toBe("2026-11-14T04:00:00.000Z");
    expect(window.endMs - window.startMs).toBe(24 * HOUR);
  });

  it("is 23 hours over the spring change and 25 over the autumn one", () => {
    const spring = venueDayWindow("2026-03-28", LONDON);
    expect(new Date(spring.startMs).toISOString()).toBe("2026-03-28T04:00:00.000Z");
    expect(new Date(spring.endMs).toISOString()).toBe("2026-03-29T03:00:00.000Z");
    const autumn = venueDayWindow("2026-10-24", LONDON);
    expect(new Date(autumn.startMs).toISOString()).toBe("2026-10-24T03:00:00.000Z");
    expect(new Date(autumn.endMs).toISOString()).toBe("2026-10-25T04:00:00.000Z");
    expect(autumn.endMs - autumn.startMs).toBe(25 * HOUR);
  });

  it("gives an evening that runs past midnight to the date it started on", () => {
    // 19:00 to 01:00 BST.
    const late = [interval("r", "2026-09-12T18:00:00.000Z", "2026-09-13T00:00:00.000Z")];
    expect(roomDayStatuses(late, ["2026-09-12", "2026-09-13"], LONDON))
      .toEqual({ "2026-09-12": "busy", "2026-09-13": "free" });
  });

  it("treats a booking that ends exactly at 04:00 as not touching the next date", () => {
    const edge = [interval("r", "2026-11-13T20:00:00.000Z", "2026-11-14T04:00:00.000Z")];
    expect(roomDayStatuses(edge, ["2026-11-13", "2026-11-14"], LONDON))
      .toEqual({ "2026-11-13": "busy", "2026-11-14": "free" });
  });

  it("places 03:30 on the autumn change night in the earlier date, by the venue's clock", () => {
    // 25 Oct 2026 03:30 GMT (after the clocks went back) is still the 24th's
    // night. A fixed-offset BST boundary (03:00Z) would wrongly give it to the 25th.
    const night = [interval("r", "2026-10-25T03:30:00.000Z", "2026-10-25T03:59:00.000Z")];
    expect(roomDayStatuses(night, ["2026-10-24", "2026-10-25"], LONDON))
      .toEqual({ "2026-10-24": "busy", "2026-10-25": "free" });
  });

  it("marks both dates when a booking crosses the spring 04:00 boundary", () => {
    // 03:30 to 04:30 BST on 28 March 2027 (the clocks went forward at 01:00 GMT).
    const crossing = [interval("r", "2027-03-28T02:30:00.000Z", "2027-03-28T03:30:00.000Z")];
    expect(roomDayStatuses(crossing, ["2027-03-27", "2027-03-28"], LONDON))
      .toEqual({ "2027-03-27": "busy", "2027-03-28": "busy" });
  });

  it("marks every date a multi-day block covers, and none after it", () => {
    const block = [interval("r", "2026-12-24T04:00:00.000Z", "2026-12-27T04:00:00.000Z")];
    expect(roomDayStatuses(block, ["2026-12-23", "2026-12-24", "2026-12-25", "2026-12-26", "2026-12-27"], LONDON))
      .toEqual({
        "2026-12-23": "free", "2026-12-24": "busy", "2026-12-25": "busy", "2026-12-26": "busy", "2026-12-27": "free",
      });
  });

  it("answers held for a provisional option, and busy where a confirmed booking shares the date", () => {
    const day = [
      interval("r", "2026-11-14T10:00:00.000Z", "2026-11-14T22:00:00.000Z", "held"),
      interval("r", "2026-11-21T10:00:00.000Z", "2026-11-21T22:00:00.000Z", "held"),
      interval("r", "2026-11-21T09:00:00.000Z", "2026-11-21T12:00:00.000Z", "busy"),
    ];
    expect(roomDayStatuses(day, ["2026-11-13", "2026-11-14", "2026-11-21"], LONDON))
      .toEqual({ "2026-11-13": "free", "2026-11-14": "held", "2026-11-21": "busy" });
  });

  it("places a hold by the venue's clock on both change nights", () => {
    const holds = [
      // 03:30 GMT after the clocks went back: still the 24th's night.
      interval("r", "2026-10-25T03:30:00.000Z", "2026-10-25T03:59:00.000Z", "held"),
      // 04:30 to 06:00 BST on 28 March 2027: the 28th only.
      interval("r", "2027-03-28T03:30:00.000Z", "2027-03-28T05:00:00.000Z", "held"),
    ];
    expect(roomDayStatuses(holds, ["2026-10-24", "2026-10-25", "2027-03-27", "2027-03-28"], LONDON)).toEqual({
      "2026-10-24": "held", "2026-10-25": "free", "2027-03-27": "free", "2027-03-28": "held",
    });
  });
});

describe("dates", () => {
  it.each(["2026-11-14", "2028-02-29", "2026-12-31"])("accepts the real date %s", (value) => {
    expect(isCalendarDate(value)).toBe(true);
  });

  it.each(["2026-02-29", "2026-02-30", "2026-13-01", "2026-1-1", "14/11/2026", "2026-11-14T00:00:00Z", "", "0000-01-01"])(
    "rejects %s",
    (value) => {
      expect(isCalendarDate(value)).toBe(false);
    },
  );

  it("counts calendar days inclusively, unaffected by clock changes", () => {
    expect(inclusiveDayCount("2026-10-24", "2026-10-26")).toBe(3);
    expect(inclusiveDayCount("2026-03-28", "2026-03-29")).toBe(2);
    expect(inclusiveDayCount("2026-11-01", "2027-01-31")).toBe(92);
  });
});

describe("rooms: recorded dimensions and published-only capacities", () => {
  it("computes floor area from the recorded outline", () => {
    expect(floorAreaM2([{ x: 0, y: 0 }, { x: 21, y: 0 }, { x: 21, y: 10.5 }, { x: 0, y: 10.5 }])).toBe(220.5);
    // An L: 10x10 less a 5x5 corner.
    expect(floorAreaM2([{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 5 }, { x: 5, y: 5 }, { x: 5, y: 10 }, { x: 0, y: 10 }])).toBe(75);
    expect(floorAreaM2([{ x: 0, y: 0 }])).toBeNull();
    expect(floorAreaM2("not an outline")).toBeNull();
  });

  it("gives a published room the venue's figures for every layout, with their source", () => {
    const described = describeRoom(TRADES_HALL_PUBLIC_PROFILE, room("grand-hall", { name: "Grand Hall" }));
    expect(described.capacities.map((capacity) => [capacity.layout, capacity.maxGuests, capacity.note])).toEqual([
      ["theatre", 250, null],
      ["classroom", 80, null],
      ["dinner", 180, null],
      ["reception", 250, null],
    ]);
    expect(described.capacitySource).toEqual({
      publishedBy: "Trades Hall of Glasgow",
      statement: TRADES_HALL_PUBLIC_PROFILE.capacityProvenance,
      url: "https://www.tradeshallglasgow.co.uk/",
    });
    expect(described.dimensions).toEqual({ widthM: 21, lengthM: 10.5, heightM: 7, floorAreaM2: 220.5 });
  });

  it.each(["kitchen", "constructor", "__proto__", "toString"])("never estimates a capacity for the unpublished room %s", (slug) => {
    const described = describeRoom(TRADES_HALL_PUBLIC_PROFILE, room(slug, { widthM: "40", lengthM: "40" }));
    expect(described.capacitySource).toBeNull();
    for (const capacity of described.capacities) {
      expect(capacity.maxGuests).toBeNull();
      expect(capacity.note).toMatch(/^Not published/u);
    }
  });

  it("reports unusable dimensions as unknown rather than zero", () => {
    const described = describeRoom(TRADES_HALL_PUBLIC_PROFILE, room("saloon", { heightM: "0", widthM: "abc" }));
    expect(described.dimensions.heightM).toBeNull();
    expect(described.dimensions.widthM).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// The service
// ---------------------------------------------------------------------------

const NOW = Date.parse("2026-10-01T11:00:00.000Z");

function memoryStore(records: Record<string, PublicVenueRecord>, intervals: Record<string, readonly RoomInterval[]> = {}) {
  const loadVenue = vi.fn((slug: string) => Promise.resolve(records[slug] ?? null));
  const loadRoomIntervals = vi.fn((venueId: string, from: Date, to: Date) => Promise.resolve(
    (intervals[venueId] ?? []).filter((item) => item.startsAt < to && item.endsAt > from),
  ));
  const store: PublicDiscoveryStore = { loadVenue, loadRoomIntervals };
  return { store, loadVenue, loadRoomIntervals };
}

const TRADES_HALL: PublicVenueRecord = {
  id: "venue-th",
  slug: TRADES_HALL_PUBLIC_PROFILE.dbSlug,
  timeZone: LONDON,
  rooms: [room("grand-hall", { id: "gh", name: "Grand Hall" }), room("saloon", { id: "sa", name: "Saloon" })],
};
const OTHER: PublicVenueRecord = { id: "venue-other", slug: "other-venue", timeZone: LONDON, rooms: [room("hall", { id: "oh" })] };

describe("PublicDiscovery", () => {
  it("is opted in for Trades Hall Glasgow by its database slug, and nothing else", () => {
    expect(PUBLIC_DISCOVERY_VENUES.map((venue) => venue.dbSlug)).toEqual(["trades-hall-glasgow"]);
  });

  it("refuses every venue outside the allowlist without reading the database", async () => {
    const { store, loadVenue } = memoryStore({ [TRADES_HALL.slug]: TRADES_HALL, [OTHER.slug]: OTHER });
    const discovery = new PublicDiscovery({ store, now: () => NOW });
    for (const slug of ["other-venue", "venue-other", "no-such-venue", "trades-hall"]) {
      expect(await discovery.describe(slug)).toEqual({ ok: false, message: VENUE_NOT_AVAILABLE_MESSAGE });
      expect(await discovery.availability({ venue: slug, from: "2026-10-02", to: "2026-10-03" }))
        .toEqual({ ok: false, message: VENUE_NOT_AVAILABLE_MESSAGE });
      expect(discovery.guide(slug)).toEqual({ ok: false, message: VENUE_NOT_AVAILABLE_MESSAGE });
    }
    expect(loadVenue).not.toHaveBeenCalled();
  });

  it("answers an allowlisted venue with no live row exactly as an unknown one", async () => {
    const { store } = memoryStore({});
    const discovery = new PublicDiscovery({ store, now: () => NOW });
    expect(await discovery.describe(TRADES_HALL.slug)).toEqual({ ok: false, message: VENUE_NOT_AVAILABLE_MESSAGE });
  });

  it("reports each room free, held or busy per date from busy and held intervals only", async () => {
    const { store } = memoryStore({ [TRADES_HALL.slug]: TRADES_HALL }, {
      [TRADES_HALL.id]: [
        interval("gh", "2026-10-24T17:00:00.000Z", "2026-10-25T00:30:00.000Z"),
        interval("gh", "2026-10-24T10:00:00.000Z", "2026-10-24T16:00:00.000Z", "held"),
        interval("sa", "2026-10-25T10:00:00.000Z", "2026-10-25T16:00:00.000Z", "held"),
      ],
    });
    const discovery = new PublicDiscovery({ store, now: () => NOW });
    const outcome = await discovery.availability({ venue: TRADES_HALL.slug, from: "2026-10-23", to: "2026-10-25" });
    if (!outcome.ok) throw new Error(outcome.message);
    expect(outcome.value.rooms).toEqual([
      { room: "grand-hall", name: "Grand Hall", days: { "2026-10-23": "free", "2026-10-24": "busy", "2026-10-25": "free" } },
      { room: "saloon", name: "Saloon", days: { "2026-10-23": "free", "2026-10-24": "free", "2026-10-25": "held" } },
    ]);
    expect(outcome.value.timeZone).toBe(LONDON);
    expect(outcome.value.enquire).toBe("https://venviewer.com/#enquire");
  });

  it("says what held means in plain words: an option exists, a second may be possible, ask the team", async () => {
    const { store } = memoryStore({ [TRADES_HALL.slug]: TRADES_HALL });
    const discovery = new PublicDiscovery({ store, now: () => NOW });
    const outcome = await discovery.availability({ venue: TRADES_HALL.slug, from: "2026-10-02", to: "2026-10-02" });
    if (!outcome.ok) throw new Error(outcome.message);
    expect(outcome.value.meaning.held).toContain("Someone has a provisional option");
    expect(outcome.value.meaning.held).toContain("A second option may be possible");
    expect(outcome.value.meaning.held).toContain("https://venviewer.com/#enquire");
    expect(outcome.value.meaning.held).toContain("The venue team confirms availability");
    expect(outcome.value.meaning.free).toContain("The venue team confirms availability");
  });

  it("narrows to one room, and names the rooms when asked about one it lacks", async () => {
    const { store } = memoryStore({ [TRADES_HALL.slug]: TRADES_HALL });
    const discovery = new PublicDiscovery({ store, now: () => NOW });
    const one = await discovery.availability({ venue: TRADES_HALL.slug, from: "2026-10-02", to: "2026-10-02", room: "saloon" });
    expect(one.ok && one.value.rooms.map((entry) => entry.room)).toEqual(["saloon"]);
    const missing = await discovery.availability({ venue: TRADES_HALL.slug, from: "2026-10-02", to: "2026-10-02", room: "ballroom" });
    expect(missing).toEqual({
      ok: false,
      message: "There is no room \"ballroom\" at this venue. Rooms: grand-hall (Grand Hall), saloon (Saloon).",
    });
  });

  it("bounds dates to today (venue time) through the horizon", async () => {
    const { store } = memoryStore({ [TRADES_HALL.slug]: TRADES_HALL });
    const discovery = new PublicDiscovery({ store, now: () => NOW });
    const past = await discovery.availability({ venue: TRADES_HALL.slug, from: "2026-09-30", to: "2026-10-02" });
    expect(past).toEqual({ ok: false, message: "\"from\" must be today (2026-10-01, venue time) or later." });
    const today = await discovery.availability({ venue: TRADES_HALL.slug, from: "2026-10-01", to: "2026-10-01" });
    expect(today.ok).toBe(true);
    const lastDay = await discovery.availability({ venue: TRADES_HALL.slug, from: "2028-09-30", to: "2028-09-30" });
    expect(lastDay.ok).toBe(true);
    const beyond = await discovery.availability({ venue: TRADES_HALL.slug, from: "2028-09-30", to: "2028-10-01" });
    expect(beyond.ok).toBe(false);
    expect(!beyond.ok && beyond.message).toContain("2028-09-30");
  });

  it("reads each venue once per cache period, shares concurrent reads, and re-reads after it", async () => {
    let now = NOW;
    const { store, loadVenue, loadRoomIntervals } = memoryStore({ [TRADES_HALL.slug]: TRADES_HALL });
    const discovery = new PublicDiscovery({ store, now: () => now });
    await Promise.all([
      discovery.availability({ venue: TRADES_HALL.slug, from: "2026-10-02", to: "2026-10-30" }),
      discovery.availability({ venue: TRADES_HALL.slug, from: "2027-01-01", to: "2027-02-01" }),
      discovery.describe(TRADES_HALL.slug),
    ]);
    expect(loadVenue).toHaveBeenCalledTimes(1);
    expect(loadRoomIntervals).toHaveBeenCalledTimes(1);
    now += PUBLIC_DISCOVERY_CACHE_TTL_MS - 1;
    await discovery.availability({ venue: TRADES_HALL.slug, from: "2026-10-02", to: "2026-10-03" });
    expect(loadRoomIntervals).toHaveBeenCalledTimes(1);
    now += 2;
    const fresh = await discovery.availability({ venue: TRADES_HALL.slug, from: "2026-10-02", to: "2026-10-03" });
    expect(loadVenue).toHaveBeenCalledTimes(2);
    expect(loadRoomIntervals).toHaveBeenCalledTimes(2);
    expect(fresh.ok && fresh.value.asOf).toBe(new Date(now).toISOString());
  });

  it("answers a failed read with a plain message, reports it, and tries again next time", async () => {
    const onReadError = vi.fn();
    const loadVenue = vi.fn()
      .mockRejectedValueOnce(new Error("connect ECONNREFUSED 127.0.0.1:5432"))
      .mockResolvedValue(TRADES_HALL);
    const store: PublicDiscoveryStore = { loadVenue, loadRoomIntervals: () => Promise.resolve([]) };
    const discovery = new PublicDiscovery({ store, now: () => NOW, onReadError });
    const failed = await discovery.describe(TRADES_HALL.slug);
    expect(failed.ok).toBe(false);
    expect(!failed.ok && failed.message).not.toMatch(/ECONNREFUSED|127\.0\.0\.1|Error|\bat\b /u);
    expect(onReadError).toHaveBeenCalledTimes(1);
    expect((await discovery.describe(TRADES_HALL.slug)).ok).toBe(true);
  });

  it("refuses to start with no opted-in venue", () => {
    const venues: readonly PublicVenueProfile[] = [];
    expect(() => new PublicDiscovery({ store: memoryStore({}).store, venues })).toThrow(/at least one/u);
  });
});
