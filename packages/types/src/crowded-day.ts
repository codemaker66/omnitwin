import {
  CalendarResponseSchema,
  type CalendarBookingEntry,
  type CalendarConflict,
  type CalendarPhaseEntry,
  type CalendarResponse,
  type CalendarRoom,
  type CalendarTurnaroundRule,
} from "./booking.js";
import { SlotObservationSchema, type ObservationKind, type SlotObservation } from "./observations.js";
import {
  STAFF_AUDIENCE_ROLES,
  VenueRequestSchema,
  type RequestKind,
  type RequestOutcome,
  type RequestState,
  type RequestUrgency,
  type VenueRequest,
} from "./requests.js";
import { TRADES_HALL_PUBLISHED_ROOM_NAMES, TRADES_HALL_ROOM_CAPACITIES, type PublishedRoomSlug } from "./trades-hall-venue-truth.js";

// -----------------------------------------------------------------------------
// A crowded Trades Hall day (L9, goals 05 and 19).
//
// One Saturday in all six rooms the venue publishes, as the house would live
// it: back-to-back functions with their changeovers, one tight, one room seen
// but not yet cleared; a wedding that moves through three rooms and runs past
// midnight; the North Gallery's multi-day install with its private view in
// the South Gallery; a show-round and a house block; sixteen open requests in
// every state the slab knows, and three already finished; what the
// hallkeepers have seen in the rooms; and the suppliers due through the day.
//
// It is data, not a claim about the venue: the rooms, their names and their
// published capacities are the venue's (trades-hall-venue-truth.ts); every
// function, person, company and request is invented. People have first names
// only, nobody has a phone number, and every address ends in .invalid.
// Everything is deterministic: the same date gives the same day, to the id.
// Every booking, phase, request and fact is parsed by the shared schemas, so a
// fixture that drifts from the contract fails where it is built.
//
// Read it at FIXTURE_NOW (14:20, venue time) for the busiest moment: the
// ceremony live in the Saloon, the prize giving's setup under way in the
// Grand Hall with its room not yet cleared, the wedding drinks' guests due,
// and an urgent request nobody owns.
// -----------------------------------------------------------------------------

export const CROWDED_DAY_TIME_ZONE = "Europe/London";
/** A Saturday in November (GMT): the default day. */
export const CROWDED_DAY_DEFAULT_DATE = "2026-11-14";
/** The busiest moment, venue time. */
export const CROWDED_DAY_BUSIEST_TIME = "14:20";

export interface CrowdedDayPerson {
  readonly id: string;
  readonly name: string;
  readonly role: "admin" | "manager" | "staff" | "hallkeeper" | "client";
  readonly email: string;
}

export interface CrowdedDayRoom extends CalendarRoom {
  readonly slug: PublishedRoomSlug;
  /** The venue's published seated-dinner covers, for a realistic guest count. */
  readonly dinnerCovers: number;
}

export interface CrowdedDayEvent {
  readonly id: string;
  readonly name: string;
  readonly eventType: string;
  readonly clientName: string;
  readonly guestCount: number;
}

export interface CrowdedDaySupplier {
  readonly id: string;
  readonly name: string;
  readonly category: string;
  readonly contactName: string;
  readonly email: string;
  /** The booking they serve, and when they are due at the door (venue time). */
  readonly bookingId: string;
  readonly arrivesAt: string;
  readonly leavesBy: string;
  readonly note: string;
}

export interface CrowdedDay {
  readonly date: string;
  readonly timeZone: typeof CROWDED_DAY_TIME_ZONE;
  readonly venue: { readonly id: string; readonly name: string; readonly slug: string };
  readonly rooms: readonly CrowdedDayRoom[];
  readonly people: readonly CrowdedDayPerson[];
  readonly events: readonly CrowdedDayEvent[];
  /** The calendar read model as GET /calendar answers it for the day. */
  readonly calendar: CalendarResponse;
  /** Every request of the day, open and finished. */
  readonly requests: readonly VenueRequest[];
  readonly observations: readonly SlotObservation[];
  readonly suppliers: readonly CrowdedDaySupplier[];
  /** FIXTURE_NOW on this date, as an instant. */
  readonly busiestAtMs: number;
}

// --- Identity ----------------------------------------------------------------

/** A fixed, valid v4-shaped id: "cd" for crowded day, then a group and a serial. */
function fixtureId(group: number, serial: number): string {
  const hex = (value: number, width: number): string => value.toString(16).padStart(width, "0");
  return `cd${hex(group, 6)}-0000-4000-8000-${hex(serial, 12)}`;
}

const VENUE_ID = fixtureId(1, 1);
const GROUP = { room: 2, person: 3, event: 4, booking: 5, phase: 6, request: 7, observation: 8, supplier: 9, key: 10 } as const;

// --- Time --------------------------------------------------------------------

const DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/u;
const TIME_PATTERN = /^(\d{2}):(\d{2})$/u;

function offsetMinutes(instantMs: number, timeZone: string): number {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit",
  }).formatToParts(new Date(instantMs));
  const part = (type: Intl.DateTimeFormatPartTypes): number => Number(parts.find((entry) => entry.type === type)?.value);
  const asUtc = Date.UTC(part("year"), part("month") - 1, part("day"), part("hour"), part("minute"));
  return Math.round((asUtc - instantMs) / 60_000);
}

function addDays(date: string, days: number): string {
  const match = DATE_PATTERN.exec(date);
  if (match === null) throw new Error(`A crowded day needs a YYYY-MM-DD date, not "${date}".`);
  return new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]) + days)).toISOString().slice(0, 10);
}

/** A venue wall time on a date, as an instant: correct either side of the clocks changing. */
export function crowdedDayInstant(date: string, time: string, dayOffset = 0): string {
  const day = DATE_PATTERN.exec(addDays(date, dayOffset));
  const clock = TIME_PATTERN.exec(time);
  if (day === null || clock === null) throw new Error(`A crowded-day time is HH:MM, not "${time}".`);
  const wall = Date.UTC(Number(day[1]), Number(day[2]) - 1, Number(day[3]), Number(clock[1]), Number(clock[2]));
  const first = wall - offsetMinutes(wall, CROWDED_DAY_TIME_ZONE) * 60_000;
  const settled = wall - offsetMinutes(first, CROWDED_DAY_TIME_ZONE) * 60_000;
  return new Date(settled).toISOString();
}

// --- The house ---------------------------------------------------------------

const ROOM_ORDER: readonly PublishedRoomSlug[] = [
  "grand-hall", "saloon", "reception-room", "robert-adam-room", "north-gallery", "south-gallery",
];

function rooms(): CrowdedDayRoom[] {
  return ROOM_ORDER.map((slug, index) => ({
    id: fixtureId(GROUP.room, index + 1),
    // The venue's display names, without the article the room cards carry.
    name: TRADES_HALL_PUBLISHED_ROOM_NAMES[slug].replace(/^The /u, ""),
    slug,
    sortOrder: index,
    dinnerCovers: TRADES_HALL_ROOM_CAPACITIES[slug].dinner,
  }));
}

const PEOPLE: readonly Omit<CrowdedDayPerson, "id" | "email">[] = [
  { name: "Elaine", role: "hallkeeper" },
  { name: "Graham", role: "hallkeeper" },
  { name: "Fiona", role: "staff" },
  { name: "Callum", role: "manager" },
  { name: "Ishbel", role: "admin" },
  { name: "Ngozi", role: "client" },
  { name: "Ruaridh", role: "client" },
  { name: "Priya", role: "client" },
];

function people(): CrowdedDayPerson[] {
  return PEOPLE.map((person, index) => ({
    ...person,
    id: fixtureId(GROUP.person, index + 1),
    email: `${person.name.toLowerCase()}.${person.role}@crowded-day.invalid`,
  }));
}

/** Who is who, by name, for the rows below. */
function personNamed(all: readonly CrowdedDayPerson[], name: string): CrowdedDayPerson {
  const found = all.find((person) => person.name === name);
  if (found === undefined) throw new Error(`No fixture person called ${name}.`);
  return found;
}

const EVENTS: readonly Omit<CrowdedDayEvent, "id">[] = [
  { name: "Merchants' Breakfast Briefing", eventType: "breakfast", clientName: "Clyde Merchants' Circle", guestCount: 120 },
  { name: "Bridgewrights' Society AGM", eventType: "conference", clientName: "Clydebank Bridgewrights' Society", guestCount: 220 },
  { name: "Glasgow Schools Prize Giving", eventType: "ceremony", clientName: "Glasgow Schools Trust", guestCount: 200 },
  // One event, three rooms, past midnight.
  { name: "Morrison–Adeyemi wedding", eventType: "wedding", clientName: "Ngozi and Ruaridh", guestCount: 80 },
  { name: "Heritage Trust board meeting", eventType: "meeting", clientName: "Merchant City Heritage Trust", guestCount: 18 },
  { name: "Book launch: The Clyde at Night", eventType: "reception", clientName: "Kelvin Lane Press", guestCount: 70 },
  { name: "Speyside whisky tasting", eventType: "tasting", clientName: "Glassford Street Dram Club", guestCount: 40 },
  { name: "Housing co-op interview panel", eventType: "meeting", clientName: "Strathclyde Homes Co-operative", guestCount: 12 },
  { name: "Alumni networking evening", eventType: "reception", clientName: "Merchant City College Alumni", guestCount: 90 },
  { name: "Digital skills workshop (morning)", eventType: "training", clientName: "Clydeside Digital Skills", guestCount: 40 },
  { name: "Digital skills workshop (afternoon)", eventType: "training", clientName: "Clydeside Digital Skills", guestCount: 36 },
  { name: "Charity quiz night", eventType: "social", clientName: "Friends of the Merchant Steeple", guestCount: 60 },
  // The install and its private view: one event, two galleries, four days.
  { name: "Exhibition: Glasgow Trades in Print", eventType: "exhibition", clientName: "Priya", guestCount: 40 },
  { name: "Book club lunch", eventType: "lunch", clientName: "Glassford Readers", guestCount: 30 },
  { name: "Bridal portraits", eventType: "photography", clientName: "Ngozi and Ruaridh", guestCount: 10 },
];

function events(): CrowdedDayEvent[] {
  return EVENTS.map((event, index) => ({ ...event, id: fixtureId(GROUP.event, index + 1) }));
}

interface BookingPlan {
  readonly room: PublishedRoomSlug;
  readonly event: string | null;
  readonly title: string;
  readonly kind: CalendarBookingEntry["kind"];
  readonly eventType: string | null;
  readonly doors: string;
  readonly end: string;
  /** Days after the date the end falls on (a wedding past midnight). */
  readonly endDay?: number;
  /** Days before the date the booking starts (a multi-day install). */
  readonly startDay?: number;
  /** Venue time setup opens in this room, before the doors. */
  readonly setup?: string;
  readonly rank?: number;
}

/** The day, room by room, in time order. Gaps are the changeovers. */
const BOOKINGS: readonly BookingPlan[] = [
  // The Grand Hall: four functions. The prize giving's setup follows the AGM
  // by thirty minutes where the room needs sixty: the tight changeover.
  { room: "grand-hall", event: "Merchants' Breakfast Briefing", title: "Merchants' Breakfast Briefing", kind: "ink", eventType: "breakfast", setup: "07:00", doors: "08:00", end: "10:00" },
  { room: "grand-hall", event: "Bridgewrights' Society AGM", title: "Bridgewrights' Society AGM", kind: "ink", eventType: "conference", setup: "11:00", doors: "11:30", end: "13:30" },
  { room: "grand-hall", event: "Glasgow Schools Prize Giving", title: "Glasgow Schools Prize Giving", kind: "ink", eventType: "ceremony", setup: "14:00", doors: "14:30", end: "16:30" },
  { room: "grand-hall", event: "Morrison–Adeyemi wedding", title: "Morrison–Adeyemi wedding · dinner and ceilidh", kind: "ink", eventType: "wedding", setup: "17:30", doors: "18:30", end: "00:30", endDay: 1 },
  // The Saloon: five, with a show-round between the board and the ceremony.
  { room: "saloon", event: "Heritage Trust board meeting", title: "Heritage Trust board meeting", kind: "ink", eventType: "meeting", setup: "08:30", doors: "09:00", end: "10:30" },
  { room: "saloon", event: null, title: "Show-round · June 2027 wedding enquiry", kind: "viewing", eventType: null, doors: "11:15", end: "11:45" },
  { room: "saloon", event: "Morrison–Adeyemi wedding", title: "Morrison–Adeyemi wedding · ceremony", kind: "ink", eventType: "wedding", setup: "12:00", doors: "13:00", end: "15:00" },
  { room: "saloon", event: "Book launch: The Clyde at Night", title: "Book launch: The Clyde at Night", kind: "ink", eventType: "reception", setup: "16:30", doors: "17:00", end: "19:00" },
  { room: "saloon", event: "Speyside whisky tasting", title: "Speyside whisky tasting", kind: "hold", rank: 1, eventType: "tasting", setup: "19:45", doors: "20:00", end: "22:00" },
  // The Reception Room: the panel, the wedding's drinks, the alumni.
  { room: "reception-room", event: "Housing co-op interview panel", title: "Housing co-op interview panel", kind: "ink", eventType: "meeting", setup: "08:00", doors: "08:30", end: "12:00" },
  { room: "reception-room", event: "Morrison–Adeyemi wedding", title: "Morrison–Adeyemi wedding · drinks reception", kind: "ink", eventType: "wedding", setup: "14:00", doors: "15:00", end: "17:30" },
  { room: "reception-room", event: "Alumni networking evening", title: "Alumni networking evening", kind: "ink", eventType: "reception", setup: "19:00", doors: "19:30", end: "22:00" },
  // The Robert Adam Room: two workshops and the quiz.
  { room: "robert-adam-room", event: "Digital skills workshop (morning)", title: "Digital skills workshop (morning)", kind: "ink", eventType: "training", setup: "08:45", doors: "09:30", end: "12:00" },
  { room: "robert-adam-room", event: "Digital skills workshop (afternoon)", title: "Digital skills workshop (afternoon)", kind: "ink", eventType: "training", setup: "12:45", doors: "13:15", end: "16:30" },
  { room: "robert-adam-room", event: "Charity quiz night", title: "Charity quiz night", kind: "ink", eventType: "social", setup: "17:30", doors: "18:30", end: "23:00" },
  // The North Gallery: the install, Thursday to Monday.
  { room: "north-gallery", event: "Exhibition: Glasgow Trades in Print", title: "Exhibition: Glasgow Trades in Print", kind: "ink", eventType: "exhibition", doors: "10:00", end: "17:00", startDay: -2, endDay: 2 },
  // The South Gallery: a show-round, lunch, the portraits, a house clean, the private view.
  { room: "south-gallery", event: null, title: "Show-round · Christmas party enquiry", kind: "viewing", eventType: null, doors: "10:00", end: "10:45" },
  { room: "south-gallery", event: "Book club lunch", title: "Book club lunch", kind: "ink", eventType: "lunch", setup: "11:30", doors: "12:00", end: "14:00" },
  { room: "south-gallery", event: "Bridal portraits", title: "Bridal portraits", kind: "ink", eventType: "photography", setup: "14:45", doors: "15:00", end: "16:00" },
  { room: "south-gallery", event: null, title: "House block · deep clean", kind: "internal_block", eventType: null, doors: "16:45", end: "17:30" },
  { room: "south-gallery", event: "Exhibition: Glasgow Trades in Print", title: "Private view: Glasgow Trades in Print", kind: "ink", eventType: "exhibition", setup: "18:30", doors: "19:00", end: "21:30" },
];

/** The venue's turnaround guidance: forty-five minutes, an hour in the
 *  Grand Hall, ninety after a wedding. Guidance, never an enforced gap. */
function turnaroundRules(allRooms: readonly CrowdedDayRoom[]): CalendarTurnaroundRule[] {
  const grandHall = allRooms.find((room) => room.slug === "grand-hall");
  return [
    { spaceId: null, eventType: null, name: "House changeover", minutes: 45, isActive: true },
    { spaceId: grandHall?.id ?? null, eventType: null, name: "Grand Hall changeover", minutes: 60, isActive: true },
    { spaceId: null, eventType: "wedding", name: "After a wedding", minutes: 90, isActive: true },
  ];
}

// --- Requests ----------------------------------------------------------------

interface RequestPlan {
  readonly booking: string;
  readonly kind: RequestKind;
  readonly quantity?: number;
  readonly urgency: RequestUrgency;
  readonly detail: string;
  readonly by: string;
  readonly at: string;
  readonly state: RequestState;
  readonly owner?: string;
  readonly handoverTo?: string;
  readonly outcome?: RequestOutcome;
  readonly outcomeNote?: string;
  /** When each step after "sent" happened, venue time. */
  readonly steps?: Partial<Record<"acknowledged" | "accepted" | "underway" | "handed-over" | "resolved", string>>;
}

const REQUESTS: readonly RequestPlan[] = [
  // Open, at the busiest moment.
  { booking: "Morrison–Adeyemi wedding · ceremony", kind: "chairs", quantity: 6, urgency: "now", detail: "Six more at the back: the grandparents' table arrived early.", by: "Ngozi", at: "14:12", state: "sent" },
  { booking: "Morrison–Adeyemi wedding · ceremony", kind: "temperature", urgency: "soon", detail: "It is warm by the windows.", by: "Fiona", at: "13:40", state: "acknowledged", steps: { acknowledged: "13:42" } },
  { booking: "Morrison–Adeyemi wedding · ceremony", kind: "av", urgency: "now", detail: "The celebrant's microphone is cutting out.", by: "Fiona", at: "13:18", state: "underway", owner: "Graham", steps: { accepted: "13:19", underway: "13:21" } },
  { booking: "Glasgow Schools Prize Giving", kind: "tables", quantity: 2, urgency: "soon", detail: "Two trestles for the certificates by the stage.", by: "Callum", at: "14:05", state: "sent" },
  { booking: "Glasgow Schools Prize Giving", kind: "av", urgency: "now", detail: "Lectern microphone and the slides on the screen.", by: "Fiona", at: "13:58", state: "accepted", owner: "Elaine", steps: { accepted: "14:01" } },
  { booking: "Glasgow Schools Prize Giving", kind: "access", urgency: "soon", detail: "The ramp to the stage for two wheelchair users.", by: "Callum", at: "13:50", state: "handed-over", owner: "Graham", handoverTo: "Elaine", steps: { accepted: "13:52", "handed-over": "14:10" } },
  { booking: "Morrison–Adeyemi wedding · drinks reception", kind: "refreshments", quantity: 100, urgency: "routine", detail: "Soft drinks for the toast, alongside the fizz.", by: "Ruaridh", at: "13:30", state: "sent" },
  { booking: "Morrison–Adeyemi wedding · drinks reception", kind: "tables", quantity: 4, urgency: "soon", detail: "Four poseur tables by the fireplace.", by: "Fiona", at: "13:45", state: "acknowledged", steps: { acknowledged: "13:47" } },
  { booking: "Digital skills workshop (afternoon)", kind: "refreshments", quantity: 40, urgency: "routine", detail: "Tea and coffee for the three o'clock break.", by: "Fiona", at: "13:20", state: "underway", owner: "Elaine", steps: { accepted: "13:25", underway: "14:15" } },
  { booking: "Digital skills workshop (afternoon)", kind: "temperature", urgency: "soon", detail: "The projector end is cold.", by: "Fiona", at: "14:08", state: "sent" },
  { booking: "Digital skills workshop (afternoon)", kind: "cleaning", urgency: "routine", detail: "Coffee spilled by the door.", by: "Graham", at: "14:16", state: "sent" },
  { booking: "Book club lunch", kind: "cleaning", urgency: "routine", detail: "Clear the lunch before the portraits.", by: "Fiona", at: "14:03", state: "sent" },
  { booking: "Bridal portraits", kind: "setup", urgency: "routine", detail: "Move the chaise to the window for the light.", by: "Ngozi", at: "13:10", state: "sent" },
  { booking: "Exhibition: Glasgow Trades in Print", kind: "access", urgency: "routine", detail: "The lift key for the print courier at four.", by: "Priya", at: "12:40", state: "acknowledged", steps: { acknowledged: "12:55" } },
  { booking: "Morrison–Adeyemi wedding · dinner and ceilidh", kind: "chairs", quantity: 10, urgency: "routine", detail: "Ten more chairs for the top table, please.", by: "Ngozi", at: "13:55", state: "sent" },
  { booking: "Book launch: The Clyde at Night", kind: "av", urgency: "routine", detail: "A microphone for the reading.", by: "Callum", at: "12:30", state: "sent" },
  // Finished earlier in the day.
  { booking: "Merchants' Breakfast Briefing", kind: "refreshments", quantity: 20, urgency: "soon", detail: "Twenty more bacon rolls.", by: "Fiona", at: "08:20", state: "resolved", owner: "Elaine", outcome: "done", steps: { accepted: "08:22", resolved: "08:40" } },
  { booking: "Heritage Trust board meeting", kind: "av", urgency: "soon", detail: "A conference phone for a member dialling in.", by: "Callum", at: "08:50", state: "resolved", owner: "Graham", outcome: "substituted", outcomeNote: "A laptop with a speaker instead.", steps: { accepted: "08:52", resolved: "09:05" } },
  { booking: "Housing co-op interview panel", kind: "cleaning", urgency: "routine", detail: "Water jugs refilled and the table wiped.", by: "Fiona", at: "10:15", state: "resolved", owner: "Graham", outcome: "done", steps: { accepted: "10:16", resolved: "10:30" } },
];

/** The venue's window before an unanswered request reaches the duty admin. */
const ESCALATION_MINUTES: Readonly<Record<RequestUrgency, number>> = { now: 2, soon: 5, routine: 15 };

// --- Observations ------------------------------------------------------------

interface ObservationPlan {
  readonly booking: string;
  readonly kind: ObservationKind;
  readonly at: string;
  readonly by: string;
}

const OBSERVATIONS: readonly ObservationPlan[] = [
  { booking: "Merchants' Breakfast Briefing", kind: "set", at: "07:50", by: "Elaine" },
  { booking: "Merchants' Breakfast Briefing", kind: "done", at: "10:05", by: "Elaine" },
  { booking: "Merchants' Breakfast Briefing", kind: "cleaned", at: "10:55", by: "Elaine" },
  // The AGM is done but nobody has cleared it: the prize giving is at risk.
  { booking: "Bridgewrights' Society AGM", kind: "live", at: "11:32", by: "Graham" },
  { booking: "Bridgewrights' Society AGM", kind: "done", at: "13:35", by: "Graham" },
  { booking: "Heritage Trust board meeting", kind: "done", at: "10:28", by: "Graham" },
  { booking: "Heritage Trust board meeting", kind: "cleaned", at: "10:50", by: "Graham" },
  { booking: "Morrison–Adeyemi wedding · ceremony", kind: "set", at: "12:40", by: "Graham" },
  { booking: "Morrison–Adeyemi wedding · ceremony", kind: "doors-open", at: "12:50", by: "Graham" },
  { booking: "Morrison–Adeyemi wedding · ceremony", kind: "live", at: "13:02", by: "Graham" },
  { booking: "Digital skills workshop (afternoon)", kind: "live", at: "13:17", by: "Elaine" },
  { booking: "Book club lunch", kind: "done", at: "14:02", by: "Fiona" },
];

// --- Suppliers ---------------------------------------------------------------

const SUPPLIERS: readonly Omit<CrowdedDaySupplier, "id" | "email" | "bookingId">[] = [
  { name: "Thistle & Fern Flowers", category: "florist", contactName: "Morven", arrivesAt: "11:30", leavesBy: "12:30", note: "Ceremony arch and aisle posies; the Saloon's side door." },
  { name: "Clydeside Kitchen Co.", category: "caterer", contactName: "Duncan", arrivesAt: "15:30", leavesBy: "01:00", note: "Dinner for 80 and the ceilidh supper; the kitchen lift." },
  { name: "The Kelvin Reelers", category: "band", contactName: "Siobhan", arrivesAt: "20:30", leavesBy: "00:45", note: "Ceilidh band, five players; load in by the Glassford Street door." },
  { name: "Merchant City Sound", category: "av", contactName: "Tariq", arrivesAt: "10:30", leavesBy: "17:00", note: "Lectern, two radio microphones and the screen for the prize giving." },
  { name: "Ferry Road Cakes", category: "cake", contactName: "Annie", arrivesAt: "17:00", leavesBy: "17:30", note: "Three tiers for the top table; needs a small table and a knife." },
  { name: "Lightwell Photography", category: "photographer", contactName: "Euan", arrivesAt: "12:30", leavesBy: "23:00", note: "Portraits in the South Gallery at three." },
  { name: "Print Room Couriers", category: "courier", contactName: "Lena", arrivesAt: "16:00", leavesBy: "16:30", note: "Two crates of prints for the exhibition; the lift key is asked for." },
];

const SUPPLIER_BOOKING: Readonly<Record<string, string>> = {
  "Thistle & Fern Flowers": "Morrison–Adeyemi wedding · ceremony",
  "Clydeside Kitchen Co.": "Morrison–Adeyemi wedding · dinner and ceilidh",
  "The Kelvin Reelers": "Morrison–Adeyemi wedding · dinner and ceilidh",
  "Merchant City Sound": "Glasgow Schools Prize Giving",
  "Ferry Road Cakes": "Morrison–Adeyemi wedding · dinner and ceilidh",
  "Lightwell Photography": "Bridal portraits",
  "Print Room Couriers": "Exhibition: Glasgow Trades in Print",
};

// --- The day -----------------------------------------------------------------

/** One crowded Trades Hall day. Deterministic: the same date gives the same day. */
export function crowdedTradesHallDay(date: string = CROWDED_DAY_DEFAULT_DATE): CrowdedDay {
  const at = (time: string, dayOffset = 0): string => crowdedDayInstant(date, time, dayOffset);
  const allRooms = rooms();
  const roomBySlug = new Map(allRooms.map((room) => [room.slug, room]));
  const allPeople = people();
  const allEvents = events();
  const eventByName = new Map(allEvents.map((event) => [event.name, event]));
  const staffIds = new Set(allPeople.filter((person) => person.role !== "client").map((person) => person.id));

  const bookingEntries: CalendarBookingEntry[] = [];
  const phaseEntries: CalendarPhaseEntry[] = [];
  const bookingByTitle = new Map<string, CalendarBookingEntry>();
  BOOKINGS.forEach((plan, index) => {
    const room = roomBySlug.get(plan.room);
    if (room === undefined) throw new Error(`No fixture room ${plan.room}.`);
    const event = plan.event === null ? null : eventByName.get(plan.event) ?? null;
    if (plan.event !== null && event === null) throw new Error(`No fixture event ${plan.event}.`);
    const entry: CalendarBookingEntry = {
      entryType: "booking",
      id: fixtureId(GROUP.booking, index + 1),
      spaceId: room.id,
      kind: plan.kind,
      status: "active",
      state: plan.kind,
      title: plan.title,
      eventType: plan.eventType,
      startsAt: at(plan.doors, plan.startDay ?? 0),
      endsAt: at(plan.end, plan.endDay ?? 0),
      rank: plan.kind === "hold" ? plan.rank ?? 1 : null,
      jointFlag: false,
      decisionAt: null,
      ownerUserId: null,
      nextAction: null,
      nextActionDueAt: null,
      eventId: event?.id ?? null,
      seriesId: null,
      eventName: event?.name ?? null,
      clientName: event?.clientName ?? null,
      guestCount: event?.guestCount ?? null,
      notes: null,
      ownerName: null,
    };
    bookingEntries.push(entry);
    bookingByTitle.set(plan.title, entry);
    if (plan.setup !== undefined && event !== null) {
      // The room's setup phase: the board reads setup from the earliest phase.
      const startsAt = at(plan.setup, plan.startDay ?? 0);
      phaseEntries.push({
        entryType: "phase",
        id: fixtureId(GROUP.phase, index + 1),
        spaceId: room.id,
        eventId: event.id,
        eventName: event.name,
        name: "Setup",
        startsAt,
        endsAt: entry.startsAt,
        sortOrder: 0,
      });
    }
  });

  const bookingNamed = (title: string): CalendarBookingEntry => {
    const found = bookingByTitle.get(title);
    if (found === undefined) throw new Error(`No fixture booking ${title}.`);
    return found;
  };

  // The one changeover shorter than the room needs: the AGM to the prize giving.
  const agm = bookingNamed("Bridgewrights' Society AGM");
  const prizeGiving = bookingNamed("Glasgow Schools Prize Giving");
  const conflicts: CalendarConflict[] = [{
    id: `insufficient_turnaround:${agm.id}:${prizeGiving.id}`,
    type: "insufficient_turnaround",
    severity: "warning",
    spaceId: agm.spaceId,
    entryIds: [agm.id, prizeGiving.id],
    // The server's own words for it (calendar-conflicts.ts), so the fixture is
    // the calendar read model as GET /calendar answers it.
    explanation: `Only 30 minutes between "${agm.title}" and "${prizeGiving.title}" in this space — the applicable turnaround guideline is 60 minutes (Grand Hall changeover). Planning support only; the team judges what is workable.`,
  }];

  const entries = [...bookingEntries, ...phaseEntries].sort((a, b) => {
    if (a.startsAt !== b.startsAt) return a.startsAt < b.startsAt ? -1 : 1;
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
  });

  const calendar = CalendarResponseSchema.parse({
    venueId: VENUE_ID,
    range: { from: at("04:00"), to: at("04:00", 1) },
    rooms: allRooms.map(({ id, name, slug, sortOrder }) => ({ id, name, slug, sortOrder })),
    entries,
    conflicts: {
      conflicts,
      checks: {
        inkDoubleBook: { status: "checked" },
        holdOverlap: { status: "checked" },
        turnaround: { status: "checked", uncoveredPairCount: 0, detail: "All 12 consecutive occupancy pairs have an applicable turnaround rule." },
      },
    },
    turnaroundRules: turnaroundRules(allRooms),
  });

  const requests = REQUESTS.map((plan, index): VenueRequest => {
    const booking = bookingNamed(plan.booking);
    const room = allRooms.find((candidate) => candidate.id === booking.spaceId);
    const asker = personNamed(allPeople, plan.by);
    const owner = plan.owner === undefined ? null : personNamed(allPeople, plan.owner);
    const relief = plan.handoverTo === undefined ? null : personNamed(allPeople, plan.handoverTo);
    const step = (name: keyof NonNullable<RequestPlan["steps"]>): string | null => {
      const time = plan.steps?.[name];
      return time === undefined ? null : at(time);
    };
    const createdAt = at(plan.at);
    const lastStep = [step("acknowledged"), step("accepted"), step("underway"), step("handed-over"), step("resolved")]
      .filter((value): value is string => value !== null)
      .sort()
      .at(-1);
    return VenueRequestSchema.parse({
      id: fixtureId(GROUP.request, index + 1),
      venueId: VENUE_ID,
      bookingId: booking.id,
      eventId: booking.eventId,
      roomId: booking.spaceId,
      roomName: room?.name ?? null,
      kind: plan.kind,
      quantity: plan.quantity ?? null,
      urgency: plan.urgency,
      detail: plan.detail,
      requestedByUserId: asker.id,
      requestedByName: asker.name,
      requestedByRole: asker.role,
      audienceRoles: [...STAFF_AUDIENCE_ROLES],
      ownerUserId: owner?.id ?? null,
      ownerName: owner?.name ?? null,
      state: plan.state,
      outcome: plan.outcome ?? null,
      outcomeNote: plan.outcomeNote ?? null,
      escalationDueAt: new Date(Date.parse(createdAt) + ESCALATION_MINUTES[plan.urgency] * 60_000).toISOString(),
      escalatedAt: null,
      acknowledgedAt: step("acknowledged"),
      acceptedAt: step("accepted"),
      resolvedAt: step("resolved"),
      threadId: null,
      handoverToUserId: relief?.id ?? null,
      handoverToName: relief?.name ?? null,
      handedOverAt: step("handed-over"),
      handoverDueAt: null,
      underwayAt: step("underway"),
      reopenedAt: null,
      createdAt,
      updatedAt: lastStep ?? createdAt,
    });
  });

  const observations = OBSERVATIONS.map((plan, index): SlotObservation => {
    const booking = bookingNamed(plan.booking);
    const actor = personNamed(allPeople, plan.by);
    if (!staffIds.has(actor.id)) throw new Error("Only the floor records what a room is doing.");
    return SlotObservationSchema.parse({
      id: fixtureId(GROUP.observation, index + 1),
      venueId: VENUE_ID,
      bookingId: booking.id,
      spaceId: booking.spaceId,
      kind: plan.kind,
      observedAt: at(plan.at),
      recordedAt: at(plan.at),
      actorUserId: actor.id,
      actorName: actor.name,
      actorRole: actor.role,
      idempotencyKey: fixtureId(GROUP.key, index + 1),
    });
  });

  const suppliers = SUPPLIERS.map((supplier, index): CrowdedDaySupplier => {
    const bookingTitle = SUPPLIER_BOOKING[supplier.name];
    if (bookingTitle === undefined) throw new Error(`No booking for supplier ${supplier.name}.`);
    return {
      ...supplier,
      id: fixtureId(GROUP.supplier, index + 1),
      email: `${supplier.contactName.toLowerCase()}@crowded-day.invalid`,
      bookingId: bookingNamed(bookingTitle).id,
    };
  });

  return {
    date,
    timeZone: CROWDED_DAY_TIME_ZONE,
    venue: { id: VENUE_ID, name: "Trades Hall Glasgow · crowded-day fixture", slug: "trades-hall-crowded-day" },
    rooms: allRooms,
    people: allPeople,
    events: allEvents,
    calendar,
    requests,
    observations,
    suppliers,
    busiestAtMs: Date.parse(at(CROWDED_DAY_BUSIEST_TIME)),
  };
}

/** The requests still open: what the slabs and the UNOWNED rail carry. */
export function crowdedDayOpenRequests(day: CrowdedDay): readonly VenueRequest[] {
  return day.requests.filter((request) => request.state !== "resolved");
}
