import { z } from "zod";
import { VenueIdSchema } from "./venue.js";

// ---------------------------------------------------------------------------
// Space ID — UUID v4
// ---------------------------------------------------------------------------

export const SpaceIdSchema = z.string().uuid();

export type SpaceId = z.infer<typeof SpaceIdSchema>;

// ---------------------------------------------------------------------------
// Space Slug — lowercase alphanumeric + hyphens
// ---------------------------------------------------------------------------

export const SpaceSlugSchema = z
  .string()
  .min(1)
  .max(100)
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/);

// ---------------------------------------------------------------------------
// Space Dimensions — convenience type for width/length/height in metres.
// Used by the web client for rendering. NOT stored as a nested object in DB
// (DB has separate widthM, lengthM, heightM numeric columns).
// ---------------------------------------------------------------------------

const MAX_DIMENSION_METRES = 200;
const MAX_HEIGHT_METRES = 50;

export const SpaceDimensionsSchema = z.object({
  width: z.number().positive().max(MAX_DIMENSION_METRES),
  length: z.number().positive().max(MAX_DIMENSION_METRES),
  height: z.number().positive().max(MAX_HEIGHT_METRES),
});

export type SpaceDimensions = z.infer<typeof SpaceDimensionsSchema>;

// ---------------------------------------------------------------------------
// Floor Plan Point — 2D coordinate for polygon outlines
// ---------------------------------------------------------------------------

export const FloorPlanPointSchema = z.object({
  x: z.number().finite(),
  y: z.number().finite(),
});

export type FloorPlanPoint = z.infer<typeof FloorPlanPointSchema>;

const MIN_POLYGON_POINTS = 3;

export const FloorPlanOutlineSchema = z
  .array(FloorPlanPointSchema)
  .min(MIN_POLYGON_POINTS);

// ---------------------------------------------------------------------------
// Space — the full persisted entity (matches DB columns)
//
// DB stores dimensions as separate numeric columns: widthM, lengthM, heightM.
// NOT as a nested dimensions object. The SpaceDimensions type above is a
// client-side convenience, not a DB shape.
// ---------------------------------------------------------------------------

export const SpaceSchema = z.object({
  id: SpaceIdSchema,
  venueId: VenueIdSchema,
  name: z.string().trim().min(1).max(200),
  slug: SpaceSlugSchema,
  description: z.string().max(2000).nullable(),
  widthM: z.string(), // numeric(6,2) stored as string by Drizzle
  lengthM: z.string(),
  heightM: z.string(),
  floorPlanOutline: FloorPlanOutlineSchema,
  meshUrl: z.string().url().nullable(),
  thumbnailUrl: z.string().url().nullable(),
  sortOrder: z.number().int().nonnegative(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});

export type Space = z.infer<typeof SpaceSchema>;

// ---------------------------------------------------------------------------
// CreateSpace — fields needed to create a new space
// ---------------------------------------------------------------------------

export const CreateSpaceSchema = z.object({
  venueId: VenueIdSchema,
  name: z.string().trim().min(1).max(200),
  slug: SpaceSlugSchema,
  widthM: z.number().positive().max(MAX_DIMENSION_METRES),
  lengthM: z.number().positive().max(MAX_DIMENSION_METRES),
  heightM: z.number().positive().max(MAX_HEIGHT_METRES),
  floorPlanOutline: FloorPlanOutlineSchema,
  sortOrder: z.number().int().nonnegative().default(0),
});

export type CreateSpace = z.infer<typeof CreateSpaceSchema>;

// ---------------------------------------------------------------------------
// Trades Hall Room Constants (client-side convenience)
// ---------------------------------------------------------------------------

export const TRADES_HALL_GRAND_HALL_DIMENSIONS: SpaceDimensions = { width: 21, length: 10, height: 7 };
export const TRADES_HALL_ROBERT_ADAM_ROOM_DIMENSIONS: SpaceDimensions = { width: 9.7, length: 5.6, height: 2.18 };
export const TRADES_HALL_RECEPTION_ROOM_DIMENSIONS: SpaceDimensions = { width: 13.4, length: 11.2, height: 3.2 };
export const TRADES_HALL_SALOON_DIMENSIONS: SpaceDimensions = { width: 12, length: 7, height: 5.4 };

/** Builds a rectangular floor plan from width and length. */
function rectangleOutline(width: number, length: number): readonly FloorPlanPoint[] {
  return [{ x: 0, y: 0 }, { x: width, y: 0 }, { x: width, y: length }, { x: 0, y: length }];
}

export const TRADES_HALL_ROOMS = [
  { name: "Grand Hall", slug: "grand-hall", description: "The flagship hall, 21m x 10m with 7m dome.", dimensions: TRADES_HALL_GRAND_HALL_DIMENSIONS, sortOrder: 0, floorPlanOutline: rectangleOutline(21, 10) },
  { name: "Robert Adam Room", slug: "robert-adam-room", description: "Elegant intimate room, 9.7m x 5.6m.", dimensions: TRADES_HALL_ROBERT_ADAM_ROOM_DIMENSIONS, sortOrder: 1, floorPlanOutline: rectangleOutline(9.7, 5.6) },
  { name: "Reception Room", slug: "reception-room", description: "Versatile event space, 13.4m x 11.2m.", dimensions: TRADES_HALL_RECEPTION_ROOM_DIMENSIONS, sortOrder: 2, floorPlanOutline: rectangleOutline(13.4, 11.2) },
  { name: "Saloon", slug: "saloon", description: "Grand entertaining room, 12m x 7m.", dimensions: TRADES_HALL_SALOON_DIMENSIONS, sortOrder: 3, floorPlanOutline: rectangleOutline(12, 7) },
] as const;
