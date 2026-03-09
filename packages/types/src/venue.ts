import { z } from "zod";

// ---------------------------------------------------------------------------
// Venue ID — UUID v4
// ---------------------------------------------------------------------------

export const VenueIdSchema = z.string().uuid();

export type VenueId = z.infer<typeof VenueIdSchema>;

// ---------------------------------------------------------------------------
// Venue Slug — lowercase alphanumeric + hyphens
// ---------------------------------------------------------------------------

export const VenueSlugSchema = z
  .string()
  .min(1, "Slug must not be empty")
  .max(100, "Slug must be at most 100 characters")
  .regex(
    /^[a-z0-9]+(?:-[a-z0-9]+)*$/,
    "Slug must be lowercase alphanumeric with hyphens, not starting or ending with a hyphen",
  );

// ---------------------------------------------------------------------------
// Brand Colour — 6-digit hex colour code, nullable
// ---------------------------------------------------------------------------

export const BrandColourSchema = z
  .string()
  .regex(/^#[0-9a-fA-F]{6}$/, "Brand colour must be a valid 6-digit hex code (e.g. #FF5733)")
  .nullable();

// ---------------------------------------------------------------------------
// Venue — the full persisted entity
// ---------------------------------------------------------------------------

export const VenueSchema = z.object({
  id: VenueIdSchema,
  name: z.string().trim().min(1, "Name must not be empty").max(200, "Name must be at most 200 characters"),
  address: z.string().trim().min(1, "Address must not be empty").max(500, "Address must be at most 500 characters"),
  slug: VenueSlugSchema,
  logoUrl: z.string().url("Logo URL must be a valid URL").nullable(),
  brandColour: BrandColourSchema,
  createdAt: z.string().datetime({ message: "createdAt must be an ISO 8601 datetime string" }),
  updatedAt: z.string().datetime({ message: "updatedAt must be an ISO 8601 datetime string" }),
});

export type Venue = z.infer<typeof VenueSchema>;

// ---------------------------------------------------------------------------
// CreateVenue — fields needed to create a new venue (no id, no timestamps)
// ---------------------------------------------------------------------------

export const CreateVenueSchema = z.object({
  name: z.string().trim().min(1, "Name must not be empty").max(200, "Name must be at most 200 characters"),
  address: z.string().trim().min(1, "Address must not be empty").max(500, "Address must be at most 500 characters"),
  slug: VenueSlugSchema,
  logoUrl: z.string().url("Logo URL must be a valid URL").nullable(),
  brandColour: BrandColourSchema,
});

export type CreateVenue = z.infer<typeof CreateVenueSchema>;
