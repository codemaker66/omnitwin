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
