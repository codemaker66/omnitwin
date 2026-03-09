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
// Enquiry Status — state machine for enquiry lifecycle
// ---------------------------------------------------------------------------

export const ENQUIRY_STATUSES = [
  "submitted",
  "viewed",
  "responded",
  "converted",
  "lost",
] as const;

export const EnquiryStatusSchema = z.enum(ENQUIRY_STATUSES);

export type EnquiryStatus = z.infer<typeof EnquiryStatusSchema>;

// ---------------------------------------------------------------------------
// Valid Enquiry Transitions — typed map of legal state transitions
//
// submitted  → viewed
// viewed     → responded | lost
// responded  → converted | lost
// converted  → (terminal)
// lost       → (terminal)
// ---------------------------------------------------------------------------

export const VALID_ENQUIRY_TRANSITIONS: Readonly<
  Record<EnquiryStatus, readonly EnquiryStatus[]>
> = {
  submitted: ["viewed"],
  viewed: ["responded", "lost"],
  responded: ["converted", "lost"],
  converted: [],
  lost: [],
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
// Enquiry — the full persisted entity
// ---------------------------------------------------------------------------

const MAX_GUEST_COUNT = 10000;
const MAX_MESSAGE_LENGTH = 5000;

export const EnquirySchema = z.object({
  id: EnquiryIdSchema,
  venueId: VenueIdSchema,
  spaceId: SpaceIdSchema,
  configurationId: ConfigurationIdSchema.nullable(),
  name: z.string().trim().min(1, "Name must not be empty").max(200, "Name must be at most 200 characters"),
  email: z.string().trim().min(1, "Email must not be empty").email("Email must be a valid email address"),
  phone: z.string().trim().max(50, "Phone must be at most 50 characters").optional().default(""),
  message: z
    .string()
    .trim()
    .min(1, "Message must not be empty")
    .max(MAX_MESSAGE_LENGTH, `Message must be at most ${String(MAX_MESSAGE_LENGTH)} characters`),
  eventDate: z.string().datetime({ message: "eventDate must be an ISO 8601 datetime string" }),
  guestCount: z
    .number()
    .int("Guest count must be an integer")
    .min(1, "Guest count must be at least 1")
    .max(MAX_GUEST_COUNT, `Guest count must be at most ${String(MAX_GUEST_COUNT)}`),
  status: EnquiryStatusSchema,
  respondedBy: UserIdSchema.nullable(),
  respondedAt: z.string().datetime({ message: "respondedAt must be an ISO 8601 datetime string" }).nullable(),
  createdAt: z.string().datetime({ message: "createdAt must be an ISO 8601 datetime string" }),
  updatedAt: z.string().datetime({ message: "updatedAt must be an ISO 8601 datetime string" }),
});

export type Enquiry = z.infer<typeof EnquirySchema>;

// ---------------------------------------------------------------------------
// CreateEnquiry — fields submitted by the client via the enquiry form
// ---------------------------------------------------------------------------

export const CreateEnquirySchema = z.object({
  venueId: VenueIdSchema,
  spaceId: SpaceIdSchema,
  configurationId: ConfigurationIdSchema.nullable(),
  name: z.string().trim().min(1, "Name must not be empty").max(200, "Name must be at most 200 characters"),
  email: z.string().trim().min(1, "Email must not be empty").email("Email must be a valid email address"),
  phone: z.string().trim().max(50, "Phone must be at most 50 characters").optional().default(""),
  message: z
    .string()
    .trim()
    .min(1, "Message must not be empty")
    .max(MAX_MESSAGE_LENGTH, `Message must be at most ${String(MAX_MESSAGE_LENGTH)} characters`),
  eventDate: z.string().datetime({ message: "eventDate must be an ISO 8601 datetime string" }),
  guestCount: z
    .number()
    .int("Guest count must be an integer")
    .min(1, "Guest count must be at least 1")
    .max(MAX_GUEST_COUNT, `Guest count must be at most ${String(MAX_GUEST_COUNT)}`),
});

export type CreateEnquiry = z.infer<typeof CreateEnquirySchema>;
