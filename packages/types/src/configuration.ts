import { z } from "zod";
import { VenueIdSchema } from "./venue.js";
import { SpaceIdSchema } from "./space.js";

// ---------------------------------------------------------------------------
// Configuration ID — UUID v4
// ---------------------------------------------------------------------------

export const ConfigurationIdSchema = z.string().uuid();

export type ConfigurationId = z.infer<typeof ConfigurationIdSchema>;

// ---------------------------------------------------------------------------
// Configuration Status — state machine for publish lifecycle
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
// Vec3 — 3D position/rotation/scale vector
// ---------------------------------------------------------------------------

export const Vec3Schema = z.object({
  x: z.number().finite("x must be finite"),
  y: z.number().finite("y must be finite"),
  z: z.number().finite("z must be finite"),
});

export type Vec3 = z.infer<typeof Vec3Schema>;

// ---------------------------------------------------------------------------
// Placed Object — a furniture item positioned in 3D space
// ---------------------------------------------------------------------------

export const PlacedObjectIdSchema = z.string().uuid();

export type PlacedObjectId = z.infer<typeof PlacedObjectIdSchema>;

export const FurnitureItemIdSchema = z.string().uuid();

export const PlacedObjectSchema = z.object({
  id: PlacedObjectIdSchema,
  furnitureItemId: FurnitureItemIdSchema,
  position: Vec3Schema,
  rotation: Vec3Schema,
  scale: Vec3Schema,
});

export type PlacedObject = z.infer<typeof PlacedObjectSchema>;

// ---------------------------------------------------------------------------
// Configuration — a saved room layout (full persisted entity)
// ---------------------------------------------------------------------------

export const ConfigurationSchema = z.object({
  id: ConfigurationIdSchema,
  venueId: VenueIdSchema,
  spaceId: SpaceIdSchema,
  name: z.string().trim().min(1, "Name must not be empty").max(200, "Name must be at most 200 characters"),
  status: ConfigurationStatusSchema,
  layoutStyle: LayoutStyleSchema,
  placedObjects: z.array(PlacedObjectSchema),
  lightmapUrl: z.string().url("Lightmap URL must be a valid URL").nullable(),
  createdBy: z.string().uuid(),
  publishedAt: z.string().datetime({ message: "publishedAt must be an ISO 8601 datetime string" }).nullable(),
  createdAt: z.string().datetime({ message: "createdAt must be an ISO 8601 datetime string" }),
  updatedAt: z.string().datetime({ message: "updatedAt must be an ISO 8601 datetime string" }),
});

export type Configuration = z.infer<typeof ConfigurationSchema>;

// ---------------------------------------------------------------------------
// CreateConfiguration — fields needed to create a new configuration
// ---------------------------------------------------------------------------

export const CreateConfigurationSchema = z.object({
  venueId: VenueIdSchema,
  spaceId: SpaceIdSchema,
  name: z.string().trim().min(1, "Name must not be empty").max(200, "Name must be at most 200 characters"),
  layoutStyle: LayoutStyleSchema,
  placedObjects: z.array(PlacedObjectSchema),
});

export type CreateConfiguration = z.infer<typeof CreateConfigurationSchema>;
