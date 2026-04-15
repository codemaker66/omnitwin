// @omnitwin/types — Shared TypeScript interfaces, Zod schemas, and enums
//
// Modules below are grouped by runtime status:
//   LIVE    — actively consumed by @omnitwin/api and/or @omnitwin/web
//   ASPIRATIONAL — tested and exported, but not yet consumed at runtime;
//                  the web/API packages should import from here when the
//                  feature ships, rather than re-declaring types locally

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
  polygonBoundingBox,
  type SpaceId,
  type SpaceDimensions,
  type FloorPlanPoint,
  type PolygonBoundingBox,
  type Space,
  type CreateSpace,
  TRADES_HALL_GRAND_HALL_DIMENSIONS,
  TRADES_HALL_ROBERT_ADAM_ROOM_DIMENSIONS,
  TRADES_HALL_RECEPTION_ROOM_DIMENSIONS,
  TRADES_HALL_SALOON_DIMENSIONS,
  TRADES_HALL_ROOMS,
} from "./space.js";

export {
  ConfigurationIdSchema,
  ConfigurationStatusSchema,
  CONFIGURATION_STATUSES,
  LayoutStyleSchema,
  LAYOUT_STYLES,
  VISIBILITY_OPTIONS,
  VisibilitySchema,
  Vec3Schema,
  PlacedObjectIdSchema,
  AssetDefinitionIdSchema,
  PlacedObjectSchema,
  ConfigurationSchema,
  CreateConfigurationSchema,
  type ConfigurationId,
  type ConfigurationStatus,
  type LayoutStyle,
  type Visibility,
  type Vec3,
  type PlacedObjectId,
  type PlacedObject,
  type Configuration,
  type CreateConfiguration,
} from "./configuration.js";

// --- ASPIRATIONAL: template management not yet implemented in web/API ---
export {
  LayoutTemplateIdSchema,
  LayoutTemplateSchema,
  CreateLayoutTemplateSchema,
  type LayoutTemplateId,
  type LayoutTemplate,
  type CreateLayoutTemplate,
} from "./template.js";

export {
  FURNITURE_CATEGORIES,
  FurnitureCategorySchema,
  FurnitureDimensionsSchema,
  AssetDefinitionSchema,
  CreateAssetDefinitionSchema,
  type FurnitureCategory,
  type FurnitureDimensions,
  type AssetDefinition,
  type CreateAssetDefinition,
} from "./furniture.js";

// --- ASPIRATIONAL: unified scene-state store not yet consumed by web ---
export {
  VIEW_MODES,
  ViewModeSchema,
  CameraStateSchema,
  TRANSITION_STATES,
  TransitionStateSchema,
  SceneStateSchema,
  type ViewMode,
  type CameraState,
  type TransitionState,
  type SceneState,
} from "./scene.js";

export {
  UserIdSchema,
  USER_ROLES,
  UserRoleSchema,
  EmailSchema,
  UserSchema,
  CreateUserSchema,
  type UserId,
  type UserRole,
  type User,
  type CreateUser,
} from "./user.js";

export {
  EnquiryIdSchema,
  ENQUIRY_STATUSES,
  EnquiryStatusSchema,
  VALID_ENQUIRY_TRANSITIONS,
  isValidEnquiryTransition,
  EnquirySchema,
  CreateEnquirySchema,
  GuestEnquirySchema,
  type EnquiryId,
  type EnquiryStatus,
  type Enquiry,
  type CreateEnquiry,
  type GuestEnquiry,
} from "./enquiry.js";

export {
  PricingRuleIdSchema,
  SUPPORTED_CURRENCIES,
  CurrencySchema,
  PRICING_TYPES,
  PricingTypeSchema,
  TierSchema,
  PricingRuleSchema,
  CreatePricingRuleSchema,
  PriceEstimateRequestSchema,
  PriceEstimateResponseSchema,
  LineItemSchema,
  ModifierSchema,
  type PricingRuleId,
  type Currency,
  type PricingType,
  type Tier,
  type PricingRule,
  type CreatePricingRule,
  type PriceEstimateRequest,
  type PriceEstimateResponse,
  type LineItem,
  type Modifier,
} from "./pricing.js";

export {
  HallkeeperSheetIdSchema,
  ManifestItemSchema,
  HallkeeperSheetDataSchema,
  GenerateHallkeeperSheetRequestSchema,
  type HallkeeperSheetId,
  type ManifestItem,
  type HallkeeperSheetData,
  type GenerateHallkeeperSheetRequest,
} from "./hallkeeper.js";

export {
  PhotoIdSchema,
  ALLOWED_PHOTO_CONTENT_TYPES,
  PhotoContentTypeSchema,
  LegacyPhotoSchema,
  LegacyPhotoUploadRequestSchema,
  LegacyPhotoUploadResponseSchema,
  ReferencePhotoSchema,
  type PhotoId,
  type PhotoContentType,
  type LegacyPhoto,
  type LegacyPhotoUploadRequest,
  type LegacyPhotoUploadResponse,
  type ReferencePhoto,
} from "./photo.js";

// --- ASPIRATIONAL: solver not yet consumed by web/API at runtime ---
export {
  solveLayout,
  SolverInputSchema,
  SolverOutputSchema,
  SolverConfigSchema,
  ComplianceReportSchema,
  FireExitSchema,
  DEFAULT_SOLVER_CONFIG,
  SOLVER_ASSETS,
  SOLVER_ASSET_DIMENSIONS,
  type SolverInput,
  type SolverOutput,
  type SolverConfig,
  type ComplianceReport,
  type FireExit,
  pointInPolygon,
  distanceToEdge,
  distanceToPoint,
  circleInPolygon,
  rectInPolygon,
  lineIntersectsRect,
  generateGridPoints,
  checkAisleWidths,
  checkFireExitClearance,
  checkMaxTravelDistance,
  generateComplianceReport,
  solveDinnerRounds,
  solveTheatre,
  solveBoardroom,
  solveCabaret,
  solveCocktail,
  solveCeremony,
  solveDinnerBanquet,
} from "./solver/index.js";
