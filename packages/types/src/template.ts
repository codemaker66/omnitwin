/**
 * @aspirational Layout template schemas — define a pre-made furniture
 * arrangement that can be applied to a space. These types are tested and
 * exported but not yet consumed by the web or API packages. When template
 * management is implemented, import from here rather than re-declaring.
 */
import { z } from "zod";
import { VenueIdSchema } from "./venue.js";
import { SpaceIdSchema } from "./space.js";
import { LayoutStyleSchema, PlacedObjectSchema } from "./configuration.js";

// ---------------------------------------------------------------------------
// Layout Template ID — UUID v4
// ---------------------------------------------------------------------------

export const LayoutTemplateIdSchema = z.string().uuid();

export type LayoutTemplateId = z.infer<typeof LayoutTemplateIdSchema>;

// ---------------------------------------------------------------------------
// Layout Template — a pre-made arrangement of furniture for a space
// ---------------------------------------------------------------------------

const MIN_GUEST_COUNT = 1;
const MAX_GUEST_COUNT = 10000;

export const LayoutTemplateSchema = z.object({
  id: LayoutTemplateIdSchema,
  venueId: VenueIdSchema,
  spaceId: SpaceIdSchema,
  name: z.string().trim().min(1, "Name must not be empty").max(200, "Name must be at most 200 characters"),
  layoutStyle: LayoutStyleSchema,
  description: z.string().trim().max(2000, "Description must be at most 2000 characters").optional().default(""),
  placedObjects: z.array(PlacedObjectSchema),
  guestCapacity: z
    .number()
    .int("Guest capacity must be an integer")
    .min(MIN_GUEST_COUNT, `Guest capacity must be at least ${String(MIN_GUEST_COUNT)}`)
    .max(MAX_GUEST_COUNT, `Guest capacity must be at most ${String(MAX_GUEST_COUNT)}`),
  thumbnailUrl: z.string().url("Thumbnail URL must be a valid URL").nullable(),
  createdAt: z.string().datetime({ message: "createdAt must be an ISO 8601 datetime string" }),
  updatedAt: z.string().datetime({ message: "updatedAt must be an ISO 8601 datetime string" }),
});

export type LayoutTemplate = z.infer<typeof LayoutTemplateSchema>;

// ---------------------------------------------------------------------------
// CreateLayoutTemplate — fields needed to create a new template
// ---------------------------------------------------------------------------

export const CreateLayoutTemplateSchema = z.object({
  venueId: VenueIdSchema,
  spaceId: SpaceIdSchema,
  name: z.string().trim().min(1, "Name must not be empty").max(200, "Name must be at most 200 characters"),
  layoutStyle: LayoutStyleSchema,
  description: z.string().trim().max(2000, "Description must be at most 2000 characters").optional().default(""),
  placedObjects: z.array(PlacedObjectSchema),
  guestCapacity: z
    .number()
    .int("Guest capacity must be an integer")
    .min(MIN_GUEST_COUNT, `Guest capacity must be at least ${String(MIN_GUEST_COUNT)}`)
    .max(MAX_GUEST_COUNT, `Guest capacity must be at most ${String(MAX_GUEST_COUNT)}`),
  thumbnailUrl: z.string().url("Thumbnail URL must be a valid URL").nullable(),
});

export type CreateLayoutTemplate = z.infer<typeof CreateLayoutTemplateSchema>;
