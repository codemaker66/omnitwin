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

export {
  ConfigurationIdSchema,
  ConfigurationStatusSchema,
  CONFIGURATION_STATUSES,
  LayoutStyleSchema,
  LAYOUT_STYLES,
  Vec3Schema,
  PlacedObjectIdSchema,
  FurnitureItemIdSchema,
  PlacedObjectSchema,
  ConfigurationSchema,
  CreateConfigurationSchema,
  type ConfigurationId,
  type ConfigurationStatus,
  type LayoutStyle,
  type Vec3,
  type PlacedObjectId,
  type PlacedObject,
  type Configuration,
  type CreateConfiguration,
} from "./configuration.js";

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
  FurnitureItemSchema,
  CreateFurnitureItemSchema,
  type FurnitureCategory,
  type FurnitureDimensions,
  type FurnitureItem,
  type CreateFurnitureItem,
} from "./furniture.js";

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
  LoginRequestSchema,
  RegisterRequestSchema,
  AuthTokensSchema,
  type UserId,
  type UserRole,
  type User,
  type CreateUser,
  type LoginRequest,
  type RegisterRequest,
  type AuthTokens,
} from "./user.js";

export {
  EnquiryIdSchema,
  ENQUIRY_STATUSES,
  EnquiryStatusSchema,
  VALID_ENQUIRY_TRANSITIONS,
  isValidEnquiryTransition,
  EnquirySchema,
  CreateEnquirySchema,
  type EnquiryId,
  type EnquiryStatus,
  type Enquiry,
  type CreateEnquiry,
} from "./enquiry.js";

export {
  PricingRuleIdSchema,
  SUPPORTED_CURRENCIES,
  CurrencySchema,
  PricingRuleSchema,
  PriceEstimateRequestSchema,
  PriceEstimateResponseSchema,
  type PricingRuleId,
  type Currency,
  type PricingRule,
  type PriceEstimateRequest,
  type PriceEstimateResponse,
} from "./pricing.js";

export {
  HallkeeperSheetIdSchema,
  ManifestItemSchema,
  HallkeeperSheetSchema,
  GenerateHallkeeperSheetRequestSchema,
  type HallkeeperSheetId,
  type ManifestItem,
  type HallkeeperSheet,
  type GenerateHallkeeperSheetRequest,
} from "./hallkeeper.js";

export {
  PhotoIdSchema,
  ALLOWED_PHOTO_CONTENT_TYPES,
  PhotoContentTypeSchema,
  PhotoSchema,
  PhotoUploadRequestSchema,
  PhotoUploadResponseSchema,
  type PhotoId,
  type PhotoContentType,
  type Photo,
  type PhotoUploadRequest,
  type PhotoUploadResponse,
} from "./photo.js";
