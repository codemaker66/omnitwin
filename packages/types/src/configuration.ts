import { z } from "zod";
import { VenueIdSchema } from "./venue.js";
import { SpaceIdSchema } from "./space.js";
import { UserIdSchema } from "./user.js";

// ---------------------------------------------------------------------------
// Configuration ID — UUID v4
// ---------------------------------------------------------------------------

export const ConfigurationIdSchema = z.string().uuid();

export type ConfigurationId = z.infer<typeof ConfigurationIdSchema>;

// ---------------------------------------------------------------------------
// Configuration State — draft/published lifecycle (DB column: `state`)
// ---------------------------------------------------------------------------

export const CONFIGURATION_STATUSES = ["draft", "published"] as const;

export const ConfigurationStatusSchema = z.enum(CONFIGURATION_STATUSES);

export type ConfigurationStatus = z.infer<typeof ConfigurationStatusSchema>;

// ---------------------------------------------------------------------------
// Layout Style — how furniture is arranged in the space
// ---------------------------------------------------------------------------

export const LAYOUT_STYLES = [
  "ceremony",
  "dinner-rounds",
  "dinner-banquet",
  "theatre",
  "boardroom",
  "cabaret",
  "cocktail",
  "custom",
] as const;

export const LayoutStyleSchema = z.enum(LAYOUT_STYLES);

export type LayoutStyle = z.infer<typeof LayoutStyleSchema>;

// ---------------------------------------------------------------------------
// Visibility — who can see this configuration
// ---------------------------------------------------------------------------

export const VISIBILITY_OPTIONS = ["private", "staff", "public"] as const;

export const VisibilitySchema = z.enum(VISIBILITY_OPTIONS);

export type Visibility = z.infer<typeof VisibilitySchema>;

// ---------------------------------------------------------------------------
// Vec3 — 3D position/rotation/scale vector (used by solver, not DB)
// ---------------------------------------------------------------------------

export const Vec3Schema = z.object({
  x: z.number().finite(),
  y: z.number().finite(),
  z: z.number().finite(),
});

export type Vec3 = z.infer<typeof Vec3Schema>;

// ---------------------------------------------------------------------------
// Placed Object — a furniture item positioned in 3D space
//
// Matches DB: flat positionX/Y/Z, rotationX/Y/Z, scale (single number),
// sortOrder, metadata (JSONB). NOT nested Vec3 objects.
// ---------------------------------------------------------------------------

export const PlacedObjectIdSchema = z.string().uuid();

export type PlacedObjectId = z.infer<typeof PlacedObjectIdSchema>;

/** Asset definition ID (global catalogue, not venue-scoped). */
export const AssetDefinitionIdSchema = z.string().uuid();


export const PlacedObjectSchema = z.object({
  id: PlacedObjectIdSchema,
  configurationId: ConfigurationIdSchema,
  assetDefinitionId: AssetDefinitionIdSchema,
  positionX: z.string(), // numeric(8,3) stored as string
  positionY: z.string(),
  positionZ: z.string(),
  rotationX: z.string(),
  rotationY: z.string(),
  rotationZ: z.string(),
  scale: z.string(),
  sortOrder: z.number().int().nonnegative(),
  metadata: z.record(z.unknown()).nullable(),
});

export type PlacedObject = z.infer<typeof PlacedObjectSchema>;

// ---------------------------------------------------------------------------
// Configuration — the full persisted entity (matches DB schema)
// ---------------------------------------------------------------------------

export const ConfigurationSchema = z.object({
  id: ConfigurationIdSchema,
  venueId: VenueIdSchema,
  spaceId: SpaceIdSchema,
  userId: UserIdSchema.nullable(),
  name: z.string().trim().min(1).max(200),
  state: ConfigurationStatusSchema,
  layoutStyle: LayoutStyleSchema,
  isPublicPreview: z.boolean(),
  guestCount: z.number().int().nonnegative(),
  isTemplate: z.boolean(),
  visibility: VisibilitySchema,
  thumbnailUrl: z.string().url().nullable(),
  lightmapUrl: z.string().url().nullable(),
  publishedAt: z.string().datetime().nullable(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});

export type Configuration = z.infer<typeof ConfigurationSchema>;

// ---------------------------------------------------------------------------
// CreateConfiguration — fields needed to create a new configuration
// ---------------------------------------------------------------------------

export const CreateConfigurationSchema = z.object({
  venueId: VenueIdSchema,
  spaceId: SpaceIdSchema,
  name: z.string().trim().min(1).max(200),
  layoutStyle: LayoutStyleSchema,
  guestCount: z.number().int().nonnegative().default(0),
  isTemplate: z.boolean().default(false),
  visibility: VisibilitySchema.default("private"),
});

export type CreateConfiguration = z.infer<typeof CreateConfigurationSchema>;
