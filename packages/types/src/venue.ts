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
// Venue Timezone — IANA timezone identifier
//
// Used by hallkeeper-sheet renderers (PDF banner + tablet banner +
// email footers) to format approval audit timestamps in the venue's
// local time rather than the server's runtime locale. Must be an IANA
// identifier accepted by `Intl.DateTimeFormat` — we validate at parse
// time using the runtime's own ICU catalogue so an invalid zone is
// caught at the boundary instead of falling back to UTC silently at
// render time.
// ---------------------------------------------------------------------------

function isValidIanaTimezone(tz: string): boolean {
  // Intl.supportedValuesOf is Node 18+ / modern browser — checks the
  // runtime's ICU timezone list. Fall back to constructing a
  // formatter (older runtimes) which throws for unknown zones.
  try {
    const supportedValuesOf = Intl.supportedValuesOf;
    if (typeof supportedValuesOf === "function") {
      return supportedValuesOf("timeZone").includes(tz);
    }
    new Intl.DateTimeFormat("en-GB", { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

export const TimezoneSchema = z
  .string()
  .min(1)
  .max(100)
  .refine(isValidIanaTimezone, {
    message: "Timezone must be a valid IANA identifier (e.g. 'Europe/London', 'America/New_York')",
  });

export type Timezone = z.infer<typeof TimezoneSchema>;

/**
 * Default venue timezone — used when backfilling existing rows during
 * the 0015 migration and as the Zod schema default for the Venue
 * create path. Trades Hall is in Glasgow; when OMNITWIN onboards
 * venues outside the UK they override at creation time.
 */
export const DEFAULT_VENUE_TIMEZONE = "Europe/London";

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
  /**
   * IANA timezone identifier. Drives the venue's operational clock for
   * audit-critical renderings (approval stamp, footer timestamps). A
   * single-tenant deployment can leave this on the default; a SaaS
   * rollout overrides per-venue at creation.
   */
  timezone: TimezoneSchema.default(DEFAULT_VENUE_TIMEZONE),
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
  timezone: TimezoneSchema.default(DEFAULT_VENUE_TIMEZONE),
});

export type CreateVenue = z.infer<typeof CreateVenueSchema>;
