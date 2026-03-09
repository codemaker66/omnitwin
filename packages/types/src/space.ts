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
  .min(1, "Slug must not be empty")
  .max(100, "Slug must be at most 100 characters")
  .regex(
    /^[a-z0-9]+(?:-[a-z0-9]+)*$/,
    "Slug must be lowercase alphanumeric with hyphens, not starting or ending with a hyphen",
  );

// ---------------------------------------------------------------------------
// Space Dimensions — width, length, height in metres (all positive)
// ---------------------------------------------------------------------------

const MAX_DIMENSION_METRES = 200;
const MAX_HEIGHT_METRES = 50;

export const SpaceDimensionsSchema = z.object({
  width: z
    .number()
    .positive("Width must be positive")
    .max(MAX_DIMENSION_METRES, `Width must be at most ${String(MAX_DIMENSION_METRES)}m`),
  length: z
    .number()
    .positive("Length must be positive")
    .max(MAX_DIMENSION_METRES, `Length must be at most ${String(MAX_DIMENSION_METRES)}m`),
  height: z
    .number()
    .positive("Height must be positive")
    .max(MAX_HEIGHT_METRES, `Height must be at most ${String(MAX_HEIGHT_METRES)}m`),
});

export type SpaceDimensions = z.infer<typeof SpaceDimensionsSchema>;

// ---------------------------------------------------------------------------
// Floor Plan Point — 2D coordinate for polygon outlines
// ---------------------------------------------------------------------------

export const FloorPlanPointSchema = z.object({
  x: z.number().finite("X coordinate must be finite"),
  y: z.number().finite("Y coordinate must be finite"),
});

export type FloorPlanPoint = z.infer<typeof FloorPlanPointSchema>;

// ---------------------------------------------------------------------------
// Floor Plan Outline — minimum 3 points to form a polygon
// ---------------------------------------------------------------------------

const MIN_POLYGON_POINTS = 3;

export const FloorPlanOutlineSchema = z
  .array(FloorPlanPointSchema)
  .min(MIN_POLYGON_POINTS, `Floor plan outline must have at least ${String(MIN_POLYGON_POINTS)} points`);

// ---------------------------------------------------------------------------
// Space — the full persisted entity
// ---------------------------------------------------------------------------

export const SpaceSchema = z.object({
  id: SpaceIdSchema,
  venueId: VenueIdSchema,
  name: z.string().trim().min(1, "Name must not be empty").max(200, "Name must be at most 200 characters"),
  slug: SpaceSlugSchema,
  description: z.string().trim().max(2000, "Description must be at most 2000 characters").optional().default(""),
  dimensions: SpaceDimensionsSchema,
  sortOrder: z.number().int("Sort order must be an integer").nonnegative("Sort order must not be negative"),
  floorPlanOutline: FloorPlanOutlineSchema,
  meshUrl: z.string().url("Mesh URL must be a valid URL").nullable(),
  thumbnailUrl: z.string().url("Thumbnail URL must be a valid URL").nullable(),
  createdAt: z.string().datetime({ message: "createdAt must be an ISO 8601 datetime string" }),
  updatedAt: z.string().datetime({ message: "updatedAt must be an ISO 8601 datetime string" }),
});

export type Space = z.infer<typeof SpaceSchema>;

// ---------------------------------------------------------------------------
// CreateSpace — fields needed to create a new space (no id, no timestamps)
// ---------------------------------------------------------------------------

export const CreateSpaceSchema = z.object({
  venueId: VenueIdSchema,
  name: z.string().trim().min(1, "Name must not be empty").max(200, "Name must be at most 200 characters"),
  slug: SpaceSlugSchema,
  description: z.string().trim().max(2000, "Description must be at most 2000 characters").optional().default(""),
  dimensions: SpaceDimensionsSchema,
  sortOrder: z.number().int("Sort order must be an integer").nonnegative("Sort order must not be negative"),
  floorPlanOutline: FloorPlanOutlineSchema,
  meshUrl: z.string().url("Mesh URL must be a valid URL").nullable(),
  thumbnailUrl: z.string().url("Thumbnail URL must be a valid URL").nullable(),
});

export type CreateSpace = z.infer<typeof CreateSpaceSchema>;

// ---------------------------------------------------------------------------
// Trades Hall Room Constants
// ---------------------------------------------------------------------------

/** Builds a rectangular floor plan outline from width and length. */
function rectangleOutline(width: number, length: number): readonly FloorPlanPoint[] {
  return [
    { x: 0, y: 0 },
    { x: width, y: 0 },
    { x: width, y: length },
    { x: 0, y: length },
  ] as const;
}

export const TRADES_HALL_GRAND_HALL_DIMENSIONS: SpaceDimensions = {
  width: 21,
  length: 10.5,
  height: 8,
};

export const TRADES_HALL_ROBERT_ADAM_ROOM_DIMENSIONS: SpaceDimensions = {
  width: 12,
  length: 8,
  height: 4,
};

export const TRADES_HALL_RECEPTION_ROOM_DIMENSIONS: SpaceDimensions = {
  width: 10,
  length: 7,
  height: 3.5,
};

export const TRADES_HALL_SALOON_DIMENSIONS: SpaceDimensions = {
  width: 9,
  length: 6,
  height: 3.5,
};

export const TRADES_HALL_ROOMS = [
  {
    name: "Grand Hall",
    slug: "grand-hall",
    description: "The flagship hall of Trades Hall Glasgow, 21m × 10.5m with 8m ceilings.",
    dimensions: TRADES_HALL_GRAND_HALL_DIMENSIONS,
    sortOrder: 0,
    floorPlanOutline: rectangleOutline(21, 10.5),
  },
  {
    name: "Robert Adam Room",
    slug: "robert-adam-room",
    description: "An elegant mid-sized room, 12m × 8m.",
    dimensions: TRADES_HALL_ROBERT_ADAM_ROOM_DIMENSIONS,
    sortOrder: 1,
    floorPlanOutline: rectangleOutline(12, 8),
  },
  {
    name: "Reception Room",
    slug: "reception-room",
    description: "A versatile space for receptions and smaller events, 10m × 7m.",
    dimensions: TRADES_HALL_RECEPTION_ROOM_DIMENSIONS,
    sortOrder: 2,
    floorPlanOutline: rectangleOutline(10, 7),
  },
  {
    name: "Saloon",
    slug: "saloon",
    description: "An intimate room suitable for meetings and small gatherings, 9m × 6m.",
    dimensions: TRADES_HALL_SALOON_DIMENSIONS,
    sortOrder: 3,
    floorPlanOutline: rectangleOutline(9, 6),
  },
] as const;
