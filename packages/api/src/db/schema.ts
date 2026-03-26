import {
  pgTable,
  uuid,
  varchar,
  text,
  timestamp,
  numeric,
  jsonb,
  integer,
  boolean,
  date,
  index,
  unique,
} from "drizzle-orm/pg-core";

// ---------------------------------------------------------------------------
// 1. venues
// ---------------------------------------------------------------------------

export const venues = pgTable("venues", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: varchar("name", { length: 200 }).notNull(),
  slug: varchar("slug", { length: 100 }).notNull().unique(),
  address: varchar("address", { length: 500 }).notNull(),
  logoUrl: text("logo_url"),
  brandColour: varchar("brand_colour", { length: 7 }),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  deletedAt: timestamp("deleted_at", { withTimezone: true }),
});

// ---------------------------------------------------------------------------
// 2. spaces
// ---------------------------------------------------------------------------

export const spaces = pgTable("spaces", {
  id: uuid("id").primaryKey().defaultRandom(),
  venueId: uuid("venue_id").notNull().references(() => venues.id),
  name: varchar("name", { length: 200 }).notNull(),
  slug: varchar("slug", { length: 100 }).notNull(),
  description: text("description").default(""),
  widthM: numeric("width_m", { precision: 6, scale: 2 }).notNull(),
  lengthM: numeric("length_m", { precision: 6, scale: 2 }).notNull(),
  heightM: numeric("height_m", { precision: 6, scale: 2 }).notNull(),
  floorPlanOutline: jsonb("floor_plan_outline").notNull(),
  meshUrl: text("mesh_url"),
  thumbnailUrl: text("thumbnail_url"),
  sortOrder: integer("sort_order").default(0).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  deletedAt: timestamp("deleted_at", { withTimezone: true }),
}, (table) => [
  unique("spaces_venue_slug_unique").on(table.venueId, table.slug),
]);

// ---------------------------------------------------------------------------
// 3. users
// ---------------------------------------------------------------------------

export const users = pgTable("users", {
  id: uuid("id").primaryKey().defaultRandom(),
  clerkId: text("clerk_id").unique(),
  email: varchar("email", { length: 255 }).notNull().unique(),
  name: varchar("name", { length: 200 }).notNull(),
  displayName: text("display_name"),
  phone: text("phone"),
  organizationName: text("organization_name"),
  role: varchar("role", { length: 20 }).notNull(),
  venueId: uuid("venue_id").references(() => venues.id),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
});

// ---------------------------------------------------------------------------
// 4. asset_definitions (global furniture catalogue — no venue_id)
// ---------------------------------------------------------------------------

export const assetDefinitions = pgTable("asset_definitions", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: varchar("name", { length: 200 }).notNull(),
  category: varchar("category", { length: 50 }).notNull(),
  thumbnailUrl: text("thumbnail_url"),
  meshUrl: text("mesh_url"),
  widthM: numeric("width_m", { precision: 5, scale: 3 }).notNull(),
  depthM: numeric("depth_m", { precision: 5, scale: 3 }).notNull(),
  heightM: numeric("height_m", { precision: 5, scale: 3 }).notNull(),
  seatCount: integer("seat_count"),
  collisionType: varchar("collision_type", { length: 20 }).default("box").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

// ---------------------------------------------------------------------------
// 5. configurations
// ---------------------------------------------------------------------------

export const configurations = pgTable("configurations", {
  id: uuid("id").primaryKey().defaultRandom(),
  spaceId: uuid("space_id").notNull().references(() => spaces.id),
  venueId: uuid("venue_id").notNull().references(() => venues.id),
  userId: uuid("user_id").references(() => users.id),
  name: varchar("name", { length: 200 }).notNull(),
  state: varchar("state", { length: 20 }).notNull().default("draft"),
  layoutStyle: varchar("layout_style", { length: 50 }).notNull(),
  isPublicPreview: boolean("is_public_preview").notNull().default(false),
  guestCount: integer("guest_count").notNull().default(0),
  isTemplate: boolean("is_template").notNull().default(false),
  visibility: varchar("visibility", { length: 20 }).notNull().default("private"),
  thumbnailUrl: text("thumbnail_url"),
  lightmapUrl: text("lightmap_url"),
  publishedAt: timestamp("published_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  deletedAt: timestamp("deleted_at", { withTimezone: true }),
}, (table) => [
  index("configurations_space_state_idx").on(table.spaceId, table.state),
  index("configurations_venue_visibility_idx").on(table.venueId, table.visibility),
]);

// ---------------------------------------------------------------------------
// 6. placed_objects
// ---------------------------------------------------------------------------

export const placedObjects = pgTable("placed_objects", {
  id: uuid("id").primaryKey().defaultRandom(),
  configurationId: uuid("configuration_id").notNull().references(() => configurations.id, { onDelete: "cascade" }),
  assetDefinitionId: uuid("asset_definition_id").notNull().references(() => assetDefinitions.id),
  positionX: numeric("position_x", { precision: 8, scale: 3 }).notNull(),
  positionY: numeric("position_y", { precision: 8, scale: 3 }).notNull(),
  positionZ: numeric("position_z", { precision: 8, scale: 3 }).notNull(),
  rotationX: numeric("rotation_x", { precision: 8, scale: 5 }).notNull().default("0"),
  rotationY: numeric("rotation_y", { precision: 8, scale: 5 }).notNull().default("0"),
  rotationZ: numeric("rotation_z", { precision: 8, scale: 5 }).notNull().default("0"),
  scale: numeric("scale", { precision: 5, scale: 3 }).notNull().default("1.000"),
  sortOrder: integer("sort_order").notNull().default(0),
  metadata: jsonb("metadata"),
}, (table) => [
  index("placed_objects_configuration_id_idx").on(table.configurationId),
]);

// ---------------------------------------------------------------------------
// 7. enquiries
// ---------------------------------------------------------------------------

export const enquiries = pgTable("enquiries", {
  id: uuid("id").primaryKey().defaultRandom(),
  venueId: uuid("venue_id").notNull().references(() => venues.id),
  spaceId: uuid("space_id").notNull().references(() => spaces.id),
  configurationId: uuid("configuration_id").references(() => configurations.id),
  userId: uuid("user_id").references(() => users.id),
  guestEmail: text("guest_email"),
  guestPhone: text("guest_phone"),
  guestName: text("guest_name"),
  state: varchar("state", { length: 20 }).notNull().default("draft"),
  name: varchar("name", { length: 200 }).notNull(),
  email: varchar("email", { length: 255 }).notNull(),
  preferredDate: date("preferred_date"),
  eventType: varchar("event_type", { length: 100 }),
  estimatedGuests: integer("estimated_guests"),
  message: text("message"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  index("enquiries_venue_state_idx").on(table.venueId, table.state),
  index("enquiries_user_id_idx").on(table.userId),
]);

// ---------------------------------------------------------------------------
// 7b. enquiry_status_history
// ---------------------------------------------------------------------------

export const enquiryStatusHistory = pgTable("enquiry_status_history", {
  id: uuid("id").primaryKey().defaultRandom(),
  enquiryId: uuid("enquiry_id").notNull().references(() => enquiries.id, { onDelete: "cascade" }),
  fromStatus: varchar("from_status", { length: 20 }).notNull(),
  toStatus: varchar("to_status", { length: 20 }).notNull(),
  changedBy: uuid("changed_by").references(() => users.id),
  note: text("note"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  index("enquiry_history_enquiry_id_idx").on(table.enquiryId),
]);

// ---------------------------------------------------------------------------
// 8. photo_references
// ---------------------------------------------------------------------------

export const photoReferences = pgTable("photo_references", {
  id: uuid("id").primaryKey().defaultRandom(),
  configurationId: uuid("configuration_id").notNull().references(() => configurations.id),
  venueId: uuid("venue_id").notNull().references(() => venues.id),
  userId: uuid("user_id").notNull().references(() => users.id),
  imageUrl: text("image_url").notNull(),
  thumbnailUrl: text("thumbnail_url"),
  tags: jsonb("tags").default([]),
  visibility: varchar("visibility", { length: 20 }).notNull().default("staff"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

// ---------------------------------------------------------------------------
// 9. pricing_rules
// ---------------------------------------------------------------------------

export const pricingRules = pgTable("pricing_rules", {
  id: uuid("id").primaryKey().defaultRandom(),
  venueId: uuid("venue_id").notNull().references(() => venues.id),
  spaceId: uuid("space_id").references(() => spaces.id),
  name: varchar("name", { length: 200 }).notNull(),
  type: varchar("type", { length: 20 }).notNull(),
  amount: numeric("amount", { precision: 10, scale: 2 }).notNull(),
  currency: varchar("currency", { length: 3 }).notNull().default("GBP"),
  minHours: integer("min_hours"),
  minGuests: integer("min_guests"),
  tiers: jsonb("tiers"),
  dayOfWeekModifiers: jsonb("day_of_week_modifiers"),
  seasonalModifiers: jsonb("seasonal_modifiers"),
  validFrom: date("valid_from"),
  validTo: date("valid_to"),
  isActive: boolean("is_active").notNull().default(true),
  deletedAt: timestamp("deleted_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
});

// ---------------------------------------------------------------------------
// 10. files — tracks uploaded files (S3/R2)
// ---------------------------------------------------------------------------

export const files = pgTable("files", {
  id: uuid("id").primaryKey().defaultRandom(),
  fileKey: text("file_key").notNull().unique(),
  filename: varchar("filename", { length: 500 }).notNull(),
  contentType: varchar("content_type", { length: 100 }).notNull(),
  context: varchar("context", { length: 50 }).notNull(),
  contextId: uuid("context_id").notNull(),
  uploadedBy: uuid("uploaded_by").notNull().references(() => users.id),
  uploadedAt: timestamp("uploaded_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  index("files_context_idx").on(table.context, table.contextId),
]);

// ---------------------------------------------------------------------------
// 11. guest_leads — tracks anonymous visitors who submit enquiries
// ---------------------------------------------------------------------------

export const guestLeads = pgTable("guest_leads", {
  id: uuid("id").primaryKey().defaultRandom(),
  email: text("email").notNull(),
  phone: text("phone"),
  name: text("name"),
  firstEnquiryId: uuid("first_enquiry_id"),
  convertedToUserId: uuid("converted_to_user_id").references(() => users.id),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  index("guest_leads_email_idx").on(table.email),
]);

// ---------------------------------------------------------------------------
// 12. reference_loadouts — hallkeeper photo documentation of room setups
// ---------------------------------------------------------------------------

export const referenceLoadouts = pgTable("reference_loadouts", {
  id: uuid("id").primaryKey().defaultRandom(),
  spaceId: uuid("space_id").notNull().references(() => spaces.id),
  venueId: uuid("venue_id").notNull().references(() => venues.id),
  name: text("name").notNull(),
  description: text("description"),
  createdBy: uuid("created_by").notNull().references(() => users.id),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  deletedAt: timestamp("deleted_at", { withTimezone: true }),
}, (table) => [
  index("reference_loadouts_space_idx").on(table.spaceId),
]);

// ---------------------------------------------------------------------------
// 12. reference_photos — photos linked to a reference loadout
// ---------------------------------------------------------------------------

export const referencePhotos = pgTable("reference_photos", {
  id: uuid("id").primaryKey().defaultRandom(),
  loadoutId: uuid("loadout_id").notNull().references(() => referenceLoadouts.id, { onDelete: "cascade" }),
  fileId: uuid("file_id").notNull().references(() => files.id),
  caption: text("caption"),
  sortOrder: integer("sort_order").notNull().default(0),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  index("reference_photos_loadout_idx").on(table.loadoutId),
]);
