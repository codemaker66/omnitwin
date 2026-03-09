import { z } from "zod";
import { VenueIdSchema } from "./venue.js";
import { FurnitureItemIdSchema } from "./configuration.js";

// ---------------------------------------------------------------------------
// Re-export FurnitureItemIdSchema from its canonical source
// ---------------------------------------------------------------------------

export { FurnitureItemIdSchema } from "./configuration.js";

// ---------------------------------------------------------------------------
// Furniture Category — classification of furniture/asset types
// ---------------------------------------------------------------------------

export const FURNITURE_CATEGORIES = [
  "chair",
  "table",
  "stage",
  "lectern",
  "barrier",
  "decor",
  "av",
  "lighting",
  "other",
] as const;

export const FurnitureCategorySchema = z.enum(FURNITURE_CATEGORIES);

export type FurnitureCategory = z.infer<typeof FurnitureCategorySchema>;

// ---------------------------------------------------------------------------
// Furniture Dimensions — width, height, depth in metres (for bounding box)
// ---------------------------------------------------------------------------

const MAX_FURNITURE_DIMENSION_METRES = 20;

export const FurnitureDimensionsSchema = z.object({
  width: z
    .number()
    .positive("Width must be positive")
    .max(MAX_FURNITURE_DIMENSION_METRES, `Width must be at most ${String(MAX_FURNITURE_DIMENSION_METRES)}m`),
  height: z
    .number()
    .positive("Height must be positive")
    .max(MAX_FURNITURE_DIMENSION_METRES, `Height must be at most ${String(MAX_FURNITURE_DIMENSION_METRES)}m`),
  depth: z
    .number()
    .positive("Depth must be positive")
    .max(MAX_FURNITURE_DIMENSION_METRES, `Depth must be at most ${String(MAX_FURNITURE_DIMENSION_METRES)}m`),
});

export type FurnitureDimensions = z.infer<typeof FurnitureDimensionsSchema>;

// ---------------------------------------------------------------------------
// Furniture Item — a catalogue entry for a piece of furniture
// ---------------------------------------------------------------------------

const MAX_STACK = 100;

export const FurnitureItemSchema = z.object({
  id: FurnitureItemIdSchema,
  venueId: VenueIdSchema,
  name: z.string().trim().min(1, "Name must not be empty").max(200, "Name must be at most 200 characters"),
  category: FurnitureCategorySchema,
  defaultDimensions: FurnitureDimensionsSchema,
  meshUrl: z.string().url("Mesh URL must be a valid URL").nullable(),
  thumbnailUrl: z.string().url("Thumbnail URL must be a valid URL").nullable(),
  stackable: z.boolean(),
  maxStack: z
    .number()
    .int("Max stack must be an integer")
    .min(1, "Max stack must be at least 1")
    .max(MAX_STACK, `Max stack must be at most ${String(MAX_STACK)}`),
  createdAt: z.string().datetime({ message: "createdAt must be an ISO 8601 datetime string" }),
  updatedAt: z.string().datetime({ message: "updatedAt must be an ISO 8601 datetime string" }),
});

export type FurnitureItem = z.infer<typeof FurnitureItemSchema>;

// ---------------------------------------------------------------------------
// CreateFurnitureItem — fields needed to create a new furniture item
// ---------------------------------------------------------------------------

export const CreateFurnitureItemSchema = z.object({
  venueId: VenueIdSchema,
  name: z.string().trim().min(1, "Name must not be empty").max(200, "Name must be at most 200 characters"),
  category: FurnitureCategorySchema,
  defaultDimensions: FurnitureDimensionsSchema,
  meshUrl: z.string().url("Mesh URL must be a valid URL").nullable(),
  thumbnailUrl: z.string().url("Thumbnail URL must be a valid URL").nullable(),
  stackable: z.boolean(),
  maxStack: z
    .number()
    .int("Max stack must be an integer")
    .min(1, "Max stack must be at least 1")
    .max(MAX_STACK, `Max stack must be at most ${String(MAX_STACK)}`),
});

export type CreateFurnitureItem = z.infer<typeof CreateFurnitureItemSchema>;
