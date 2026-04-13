import { z } from "zod";
import { AssetDefinitionIdSchema } from "./configuration.js";

// ---------------------------------------------------------------------------
// Re-export for convenience
// ---------------------------------------------------------------------------

export { AssetDefinitionIdSchema } from "./configuration.js";


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
// Furniture Dimensions — width, height, depth in metres (bounding box)
// Client-side convenience type — DB stores as separate numeric columns.
// ---------------------------------------------------------------------------

const MAX_DIM = 20;

export const FurnitureDimensionsSchema = z.object({
  width: z.number().positive().max(MAX_DIM),
  height: z.number().positive().max(MAX_DIM),
  depth: z.number().positive().max(MAX_DIM),
});

export type FurnitureDimensions = z.infer<typeof FurnitureDimensionsSchema>;

// ---------------------------------------------------------------------------
// Asset Definition — a global catalogue entry (matches DB: asset_definitions)
//
// NOT venue-scoped. The DB table has no venueId column. The old
// FurnitureItemSchema with venueId/stackable/maxStack was aspirational
// and never matched the running system.
// ---------------------------------------------------------------------------

export const AssetDefinitionSchema = z.object({
  id: AssetDefinitionIdSchema,
  name: z.string().trim().min(1).max(200),
  category: FurnitureCategorySchema,
  thumbnailUrl: z.string().url().nullable(),
  meshUrl: z.string().url().nullable(),
  widthM: z.string(), // numeric(5,3) stored as string
  depthM: z.string(),
  heightM: z.string(),
  seatCount: z.number().int().positive().nullable(),
  collisionType: z.string().max(20),
  createdAt: z.string().datetime(),
});

export type AssetDefinition = z.infer<typeof AssetDefinitionSchema>;

// ---------------------------------------------------------------------------
// CreateAssetDefinition — fields needed to create a new catalogue entry
// ---------------------------------------------------------------------------

export const CreateAssetDefinitionSchema = z.object({
  name: z.string().trim().min(1).max(200),
  category: FurnitureCategorySchema,
  widthM: z.number().positive().max(MAX_DIM),
  depthM: z.number().positive().max(MAX_DIM),
  heightM: z.number().positive().max(MAX_DIM),
  seatCount: z.number().int().positive().nullable().optional(),
  collisionType: z.string().max(20).default("box"),
  meshUrl: z.string().url().nullable().optional(),
  thumbnailUrl: z.string().url().nullable().optional(),
});

export type CreateAssetDefinition = z.infer<typeof CreateAssetDefinitionSchema>;

