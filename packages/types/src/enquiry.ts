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
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Enquiry source — which front door the guest came through.
//
// The anchor (configurationId vs venueSlug) used to imply this: a config meant
// the planner, a slug meant the twin. The marketing homepage broke that
// inference, because it also anchors by venueSlug — so an explicit, optional
// discriminator carries the truth instead of the route guessing.
//
// `source` is DESCRIPTIVE ONLY. It must never participate in the anchor xor
// below, which is the security boundary deciding which venues may be enquired
// at. Widening reach is the anchor's job; naming the door is this field's.
// ---------------------------------------------------------------------------

export const ENQUIRY_SOURCES = ["planner", "twin", "homepage"] as const;

export const EnquirySourceSchema = z.enum(ENQUIRY_SOURCES);

export type EnquirySource = z.infer<typeof EnquirySourceSchema>;

/** The twin's note, unchanged since the walkthrough shipped. Kept as an
 *  exported constant so historic enquiry text stays byte-comparable. */
export const TWIN_ENQUIRY_SOURCE_NOTE =
  "Sent from the venue's virtual walkthrough (the twin).";

/** The homepage's note. Says where the lead came from and nothing more — the
 *  page can compute room fit from published capacities, but it cannot know
 *  whether a date is free, so it must not imply that it does. */
export const HOMEPAGE_ENQUIRY_SOURCE_NOTE =
  "Sent from the venue website's enquiry form.";

/**
 * The source a payload actually represents. An explicit `source` always wins;
 * otherwise fall back to the historic anchor inference so clients that predate
 * this field (the deployed twin modal, the planner modal) keep their meaning.
 */
export function resolveEnquirySource(input: {
  readonly configurationId?: string | undefined;
  readonly venueSlug?: string | undefined;
  readonly source?: EnquirySource | undefined;
}): EnquirySource {
  if (input.source !== undefined) return input.source;
  return input.configurationId !== undefined ? "planner" : "twin";
}

/** How many leading hex characters of the enquiry id make the reference. */
const ENQUIRY_REFERENCE_LENGTH = 8;

/**
 * The short human handle for an enquiry — what the acknowledgement email
 * prints and what a guest reads down the phone.
 *
 * Deliberately the leading hex of the enquiry's own id, so the events team can
 * find the record from a quoted reference with no extra column and no lookup
 * table. Both the email and the website's success state MUST call this rather
 * than deriving their own, or a client's reference stops matching what staff
 * can search.
 */
export function enquiryReference(enquiryId: string): string {
  return enquiryId.replace(/-/g, "").slice(0, ENQUIRY_REFERENCE_LENGTH).toUpperCase();
}

/** The line prepended to a guest's message so the events team can see which
 *  door the lead came through. Null for the planner, whose configuration is
 *  itself the context. */
export function enquirySourceNote(source: EnquirySource): string | null {
  switch (source) {
    case "twin":
      return TWIN_ENQUIRY_SOURCE_NOTE;
    case "homepage":
      return HOMEPAGE_ENQUIRY_SOURCE_NOTE;
    case "planner":
      return null;
  }
}

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
    /** Descriptive only — see the note above. Never part of the anchor xor. */
    source: EnquirySourceSchema.optional(),
  })
  .refine(
    (value) => (value.configurationId === undefined) !== (value.venueSlug === undefined),
    {
      message: "Provide exactly one of configurationId or venueSlug",
      path: ["configurationId"],
    },
  );

export type GuestEnquiry = z.infer<typeof GuestEnquirySchema>;
