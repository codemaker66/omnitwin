import { z } from "zod";
import { VenueIdSchema } from "./venue.js";
import { SpaceIdSchema } from "./space.js";
import { ConfigurationIdSchema } from "./configuration.js";
import { UserIdSchema } from "./user.js";

// ---------------------------------------------------------------------------
// Enquiry ID — UUID v4
// ---------------------------------------------------------------------------

export const EnquiryIdSchema = z.string().uuid();

export type EnquiryId = z.infer<typeof EnquiryIdSchema>;

// ---------------------------------------------------------------------------
// Enquiry State — matches the runtime state machine in
// packages/api/src/state-machines/enquiry.ts
// ---------------------------------------------------------------------------

export const ENQUIRY_STATUSES = [
  "draft",
  "submitted",
  "under_review",
  "approved",
  "rejected",
  "withdrawn",
  "archived",
] as const;

export const EnquiryStatusSchema = z.enum(ENQUIRY_STATUSES);

export type EnquiryStatus = z.infer<typeof EnquiryStatusSchema>;

// ---------------------------------------------------------------------------
// Valid Enquiry Transitions — mirrors runtime state machine
// ---------------------------------------------------------------------------

export const VALID_ENQUIRY_TRANSITIONS: Readonly<
  Record<EnquiryStatus, readonly EnquiryStatus[]>
> = {
  draft: ["submitted"],
  submitted: ["under_review", "withdrawn"],
  under_review: ["approved", "rejected", "withdrawn"],
  approved: ["archived"],
  rejected: ["archived"],
  withdrawn: [],
  archived: [],
};

/**
 * Returns true if transitioning from `from` to `to` is a legal state change.
 */
export function isValidEnquiryTransition(
  from: EnquiryStatus,
  to: EnquiryStatus,
): boolean {
  return VALID_ENQUIRY_TRANSITIONS[from].includes(to);
}

// ---------------------------------------------------------------------------
// Enquiry source — how an enquiry reached the venue (migration 0079)
//
// The walkthrough (the twin's own enquiry form), the website's enquiry form,
// the planner (a guest who laid out a room), or a telephone call or email the
// staff enter themselves. An enquiry whose source is not known has none:
// before 26 September the website's form wrote the walkthrough's note too, so
// older enquiries cannot be told apart and are never given a guessed source.
// ---------------------------------------------------------------------------

export const ENQUIRY_SOURCES = ["website", "walkthrough", "planner", "phone", "email"] as const;

export const EnquirySourceSchema = z.enum(ENQUIRY_SOURCES);

export type EnquirySource = z.infer<typeof EnquirySourceSchema>;

// ---------------------------------------------------------------------------
// Enquiry — the full persisted entity (matches DB columns)
// ---------------------------------------------------------------------------

const MAX_GUEST_COUNT = 10000;
const MAX_MESSAGE_LENGTH = 2000;

export const EnquirySchema = z.object({
  id: EnquiryIdSchema,
  venueId: VenueIdSchema,
  spaceId: SpaceIdSchema,
  configurationId: ConfigurationIdSchema.nullable(),
  userId: UserIdSchema.nullable(),
  name: z.string().trim().min(1).max(200),
  email: z.string().trim().email().max(255),
  eventType: z.string().trim().max(100).nullable(),
  preferredDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable(),
  estimatedGuests: z.number().int().nonnegative().max(MAX_GUEST_COUNT).nullable(),
  message: z.string().max(MAX_MESSAGE_LENGTH).nullable(),
  state: EnquiryStatusSchema,
  guestEmail: z.string().email().nullable(),
  guestPhone: z.string().max(30).nullable(),
  guestName: z.string().max(200).nullable(),
  /** How it reached the venue; null where that is not known. */
  source: EnquirySourceSchema.nullable(),
  /** False when the guest named no room: spaceId is then only where the
   *  enquiry is filed (the venue's first room), never what they asked for. */
  roomChosen: z.boolean(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});

export type Enquiry = z.infer<typeof EnquirySchema>;

// ---------------------------------------------------------------------------
// CreateEnquiry — fields submitted via the enquiry form
// ---------------------------------------------------------------------------

export const CreateEnquirySchema = z.object({
  configurationId: ConfigurationIdSchema,
  venueId: VenueIdSchema,
  spaceId: SpaceIdSchema,
  name: z.string().trim().min(1).max(200),
  email: z.string().trim().email().max(255),
  eventType: z.string().trim().max(100).nullable().optional(),
  preferredDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
  estimatedGuests: z.number().int().nonnegative().max(MAX_GUEST_COUNT).nullable().optional(),
  message: z.string().max(MAX_MESSAGE_LENGTH).nullable().optional(),
});

export type CreateEnquiry = z.infer<typeof CreateEnquirySchema>;

// ---------------------------------------------------------------------------
// GuestEnquiry — fields accepted by the public /public/enquiries endpoint
//
// Differs from CreateEnquiry: guests identify themselves either via the
// configuration they viewed (configurationId — planner path) OR the venue they
// walked (venueSlug — twin path); provide contact details directly (not sourced
// from an auth session); and use `eventDate`/`guestCount` naming rather than
// `preferredDate`/`estimatedGuests`. Exactly one of configurationId / venueSlug
// is required. Keeping the xor in the shared contract prevents API clients and
// server routes from drifting on this security-sensitive anchor choice.
//
// On the venue path a guest may name one of the venue's rooms by its slug
// (`roomSlug`); the API files the enquiry against that room and records it as
// the guest's choice. Without one the enquiry is filed against the venue's
// first room and recorded as naming none. A configuration already names its
// room, so `roomSlug` is refused beside one.
// ---------------------------------------------------------------------------

/**
 * Where a guest enquiry on the venue path was written: the walkthrough (the
 * twin's form) or the website's own form (the front door and /fresh). An
 * enquiry that names no source is the walkthrough's, which predates this
 * field. The API records the enquiry's full source (ENQUIRY_SOURCES).
 */
export const GUEST_ENQUIRY_SOURCES = ["website", "walkthrough"] as const;
export type GuestEnquirySource = (typeof GUEST_ENQUIRY_SOURCES)[number];

export const GuestEnquirySchema = z
  .object({
    configurationId: ConfigurationIdSchema.optional(),
    venueSlug: z.string().trim().min(1).max(100).optional(),
    email: z.string().trim().email().max(255),
    phone: z.string().trim().max(30).optional(),
    name: z.string().trim().max(200).optional(),
    eventDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
    eventType: z.string().trim().max(100).optional(),
    guestCount: z.number().int().nonnegative().max(MAX_GUEST_COUNT).optional(),
    message: z.string().max(MAX_MESSAGE_LENGTH).optional(),
    source: z.enum(GUEST_ENQUIRY_SOURCES).optional(),
    roomSlug: z.string().trim().min(1).max(100).optional(),
  })
  .refine(
    (value) => (value.configurationId === undefined) !== (value.venueSlug === undefined),
    {
      message: "Provide exactly one of configurationId or venueSlug",
      path: ["configurationId"],
    },
  )
  .refine(
    (value) => value.roomSlug === undefined || value.venueSlug !== undefined,
    {
      message: "A configuration already names its room",
      path: ["roomSlug"],
    },
  );

export type GuestEnquiry = z.infer<typeof GuestEnquirySchema>;

// ---------------------------------------------------------------------------
// Occasions — what an enquiry is for, in words a person reads
//
// The venue's forms send short slugs: the walkthrough and the planner send
// wedding, corporate, ceremony, concert, private or other, and the website's
// form wedding, dinner, conference or reception. Staff read them as words,
// never as slugs. An occasion typed in free (older rows, other senders) is
// shown as it was typed.
// ---------------------------------------------------------------------------

interface OccasionWords {
  /** "Corporate event": on its own, as a fact. */
  readonly label: string;
  /** "a corporate event": inside a sentence, after "for". */
  readonly phrase: string;
}

const ENQUIRY_OCCASIONS: Readonly<Record<string, OccasionWords>> = {
  wedding: { label: "Wedding", phrase: "a wedding" },
  dinner: { label: "Dinner", phrase: "a dinner" },
  conference: { label: "Conference", phrase: "a conference" },
  reception: { label: "Drinks reception", phrase: "a drinks reception" },
  corporate: { label: "Corporate event", phrase: "a corporate event" },
  ceremony: { label: "Ceremony", phrase: "a ceremony" },
  concert: { label: "Concert or performance", phrase: "a concert or performance" },
  private: { label: "Private celebration", phrase: "a private celebration" },
  other: { label: "Other occasion", phrase: "another occasion" },
};

/** The occasions the venue names, in the order it offers them. */
export const ENQUIRY_OCCASION_KEYS: readonly string[] = Object.keys(ENQUIRY_OCCASIONS);

function occasionWords(eventType: string | null | undefined): { readonly typed: string; readonly known: OccasionWords | undefined } | null {
  const typed = eventType?.trim() ?? "";
  if (typed === "") return null;
  const key = typed.toLowerCase();
  return { typed, known: Object.hasOwn(ENQUIRY_OCCASIONS, key) ? ENQUIRY_OCCASIONS[key] : undefined };
}

/** "Wedding", "Corporate event"; an occasion typed in free as typed; null for none. */
export function occasionLabel(eventType: string | null | undefined): string | null {
  const words = occasionWords(eventType);
  return words === null ? null : words.known?.label ?? words.typed;
}

/** "a wedding", "another occasion", to follow "for"; an occasion typed in free as typed; null for none. */
export function occasionPhrase(eventType: string | null | undefined): string | null {
  const words = occasionWords(eventType);
  return words === null ? null : words.known?.phrase ?? words.typed;
}

// ---------------------------------------------------------------------------
// Venue slug namespaces — the enquiry anchor
//
// Trades Hall exists under TWO slugs and they are not interchangeable:
//
//   "trades-hall"          the ASSET namespace — twin bundles, splat paths,
//                          runtime packages, the twin manifest's venueSlug.
//   "trades-hall-glasgow"  the DATABASE namespace — the `venues.slug` row that
//                          `POST /public/enquiries` resolves against.
//
// Sending the asset slug to the enquiry endpoint passes the twin allowlist gate
// and then misses the `venues.slug` lookup, so the request 404s as "Venue not
// found" — a total, silent loss of walkthrough leads. Mocked-network tests
// cannot catch this by construction: they assert on the value the client sends,
// and nothing asserts that value matches a row in `venues`.
//
// This constant is the single source of truth for the DATABASE namespace. Both
// the web client and the API's twin allowlist default import it, so the two
// sides cannot drift apart again without a type error.
// ---------------------------------------------------------------------------

/** The `venues.slug` value the public enquiry endpoint resolves against. */
export const TRADES_HALL_ENQUIRY_VENUE_SLUG = "trades-hall-glasgow";

/** The asset/twin-bundle namespace. NOT valid as an enquiry anchor. */
export const TRADES_HALL_ASSET_SLUG = "trades-hall";

/**
 * The `eventType` a signed-in but uninvited person's "Request access" sends.
 * It rides the public enquiry route so the ask reaches the venue's inbox, but
 * it is a request to be let into the venue's workspace, never a room booking:
 * the API announces it as one and sends no booking acknowledgement.
 */
export const VENUE_ACCESS_ENQUIRY_TYPE = "venue-access";

/**
 * The `eventType` the pricing page's "Talk to us about your venue" sends: a
 * venue asking about Venviewer for its own rooms. Like an access request it
 * rides the public enquiry route, and like one it is not a booking of this
 * venue's rooms, so no booking acknowledgement is sent.
 */
export const VENVIEWER_PRICING_ENQUIRY_TYPE = "venue-enquiry";

/**
 * The `eventType`s that ride the enquiry route without asking to book the
 * venue's rooms. Staff answer them and mark them done; they are never
 * approved or declined, because both decisions email a booking outcome.
 */
export const NON_BOOKING_ENQUIRY_TYPES: readonly string[] = [
  VENUE_ACCESS_ENQUIRY_TYPE,
  VENVIEWER_PRICING_ENQUIRY_TYPE,
];

/** Whether an enquiry asks to book the venue's rooms: any type but the two
 *  requests above, including none at all. */
export function isBookingEnquiry(eventType: string | null | undefined): boolean {
  return eventType === null || eventType === undefined || !NON_BOOKING_ENQUIRY_TYPES.includes(eventType.trim());
}
