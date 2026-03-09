// @omnitwin/types — Shared TypeScript interfaces, Zod schemas, and enums
// Modules are re-exported here as they are built.

export {
  VenueIdSchema,
  VenueSlugSchema,
  BrandColourSchema,
  VenueSchema,
  CreateVenueSchema,
  type VenueId,
  type Venue,
  type CreateVenue,
} from "./venue.js";

export {
  SpaceIdSchema,
  SpaceSlugSchema,
  SpaceDimensionsSchema,
  FloorPlanPointSchema,
  FloorPlanOutlineSchema,
  SpaceSchema,
  CreateSpaceSchema,
  type SpaceId,
  type SpaceDimensions,
  type FloorPlanPoint,
  type Space,
  type CreateSpace,
  TRADES_HALL_GRAND_HALL_DIMENSIONS,
  TRADES_HALL_ROBERT_ADAM_ROOM_DIMENSIONS,
  TRADES_HALL_RECEPTION_ROOM_DIMENSIONS,
  TRADES_HALL_SALOON_DIMENSIONS,
  TRADES_HALL_ROOMS,
} from "./space.js";
