import {
  pgTable,
  uuid,
  varchar,
  text,
  timestamp,
  numeric,
  jsonb,
  integer,
  bigint,
  boolean,
  date,
  index,
  unique,
  foreignKey,
  primaryKey,
  type AnyPgColumn,
} from "drizzle-orm/pg-core";
import type {
  AgentTrajectory,
  AnalyticsSnapshotPayload,
  CanonicalLayoutSnapshotV0,
  ComfortConstraintInput,
  CaptureControlSourceRecord,
  DensityHeatmapCell,
  GuestFlowAssumption,
  GuestFlowNavmeshArtifact,
  GuestFlowPoint,
  GuestFlowReplayInput,
  GuestFlowReplayMetrics,
  IntegrationConfig,
  EventPlanAudienceRole,
  EventPlanChangeSurface,
  EventPlanRiskLevel,
  EventPlanSourceKind,
  EventPlanNotificationSeverity,
  EventMissionBaseline,
  EventMissionEventKind,
  EventMissionEventPayload,
  EventMissionEntityType,
  EventMissionIncidentSeverity,
  EventMissionIncidentStatus,
  EventMissionPhaseStatus,
  EventMissionPresence,
  EventMissionSpatialAnchor,
  EventMissionStatus,
  EventMissionTask,
  EventArchitectCandidate,
  EventArchitectRequest,
  EventArchitectRun,
  EventArchitectStrategy,
  LayoutValidatorRun,
  PricingAssumptionInput,
  ProposalVersionPayload,
  RuntimePackageManifestJson,
  RuntimeQaRecordV0,
  TransformArtifactV0,
} from "@omnitwin/types";
// Keep the runtime schema self-contained so drizzle-kit can load this .ts file
// directly. The type-only imports preserve the canonical coordinate contract
// without leaving a runtime `./coordinate-space.js` require for drizzle-kit.
type LayoutCoordinateSpace = import("./coordinate-space.js").LayoutCoordinateSpace;
type RealMetreCoordinateSpace = typeof import("./coordinate-space.js").REAL_METRE_COORDINATE_SPACE;
const REAL_METRE_COORDINATE_SPACE: RealMetreCoordinateSpace = "real_m_v1";

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
  // IANA timezone — e.g. "Europe/London", "America/New_York". Drives
  // audit-timestamp rendering (approval stamp, PDF footer) in the
  // venue's operational clock rather than the server's process locale.
  timezone: varchar("timezone", { length: 100 }).notNull().default("Europe/London"),
  // Billing state — denormalised from the subscriptions table so the
  // require-active-subscription middleware can gate writes with a single
  // indexed lookup instead of joining on every authenticated request.
  // The Stripe webhook keeps these two columns in sync whenever a
  // `customer.subscription.updated` event arrives. Values:
  // 'none' (never subscribed), 'incomplete', 'trialing', 'active',
  // 'past_due', 'canceled', 'unpaid'.
  subscriptionStatus: varchar("subscription_status", { length: 30 }).notNull().default("none"),
  planTier: varchar("plan_tier", { length: 30 }),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  deletedAt: timestamp("deleted_at", { withTimezone: true }),
});

// ---------------------------------------------------------------------------
// 2. spaces
//
// Shape invariant (enforced by routes/spaces.ts on every write, backfilled
// once by migration 0007_polygon_bbox_invariant):
//
//   width_m  = MAX(p.x) - MIN(p.x) over floor_plan_outline
//   length_m = MAX(p.y) - MIN(p.y) over floor_plan_outline
//
// `floor_plan_outline` is the authoritative shape. `width_m` / `length_m` are
// denormalised bounding-box values kept because hot-path readers
// (spatial-classifier, hallkeeper-sheet, manifest-generator) want the box
// dimensions without iterating the polygon each call. `height_m` is
// orthogonal — ceiling height, not a floor-plan concept.
//
// Never write width_m / length_m independently of floor_plan_outline. Routes
// run everything through `polygonBoundingBox` (@omnitwin/types) on insert
// and update; seed data is polygon-first.
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
  platformRole: varchar("platform_role", { length: 20 }).notNull().default("none"),
  venueId: uuid("venue_id").references(() => venues.id),
  // URL-safe handle for the `/<username>/<slug>` namespace URLs.
  // Mirrored from Clerk's username field via the clerk-webhook. Nullable
  // during backfill; the UsernameGate component prompts legacy users on
  // next sign-in. Shape (3-30 chars, lowercase alphanumeric with
  // single-hyphen) is enforced by the DB CHECK constraint
  // `users_username_shape` — see migration 0017_layout_urls.sql.
  username: varchar("username", { length: 30 }),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
});

// ---------------------------------------------------------------------------
// 3b. user_invitations
//
// Clerk authentication is not authorization. A new Clerk identity can only
// become a local Venviewer user when it matches a pending invitation record
// (email or approved domain) or an explicitly configured approved-domain
// policy in the auth middleware. The accepted* columns are the audit marker
// that closes the invitation loop.
// ---------------------------------------------------------------------------

export const userInvitations = pgTable("user_invitations", {
  id: uuid("id").primaryKey().defaultRandom(),
  email: varchar("email", { length: 255 }),
  domain: varchar("domain", { length: 255 }),
  role: varchar("role", { length: 20 }).notNull().default("planner"),
  venueId: uuid("venue_id").references(() => venues.id),
  tokenHash: text("token_hash").unique(),
  status: varchar("status", { length: 20 }).notNull().default("pending"),
  expiresAt: timestamp("expires_at", { withTimezone: true }),
  acceptedAt: timestamp("accepted_at", { withTimezone: true }),
  acceptedBy: uuid("accepted_by").references(() => users.id),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  index("user_invitations_email_status_idx").on(table.email, table.status),
  index("user_invitations_domain_status_idx").on(table.domain, table.status),
  index("user_invitations_venue_status_idx").on(table.venueId, table.status),
]);

// ---------------------------------------------------------------------------
// 3c. onboarding foundation — organisation/workspace shell around venues.
//
// Venue remains the v1 authorization boundary. These tables model the sales
// handoff and managed rollout state around a venue: organisation, workspace,
// invited owner/staff membership, entitlement provider verification, and
// operator review gates. Access enforcement is coherence-checked in migration
// 0037 so billing/invoice state cannot gate access until provider verified.
// ---------------------------------------------------------------------------

export const organisations = pgTable("organisations", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: varchar("name", { length: 200 }).notNull(),
  status: varchar("status", { length: 30 }).notNull().default("onboarding"),
  createdBy: uuid("created_by").references(() => users.id, { onDelete: "set null" }),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  deletedAt: timestamp("deleted_at", { withTimezone: true }),
}, (table) => [
  index("organisations_status_idx").on(table.status),
  index("organisations_name_idx").on(table.name),
]);

export const workspaces = pgTable("workspaces", {
  id: uuid("id").primaryKey().defaultRandom(),
  organisationId: uuid("organisation_id").notNull().references(() => organisations.id, { onDelete: "cascade" }),
  primaryVenueId: uuid("primary_venue_id").notNull().references(() => venues.id),
  name: varchar("name", { length: 200 }).notNull(),
  status: varchar("status", { length: 30 }).notNull().default("onboarding"),
  createdBy: uuid("created_by").references(() => users.id, { onDelete: "set null" }),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  deletedAt: timestamp("deleted_at", { withTimezone: true }),
}, (table) => [
  index("workspaces_org_status_idx").on(table.organisationId, table.status),
  index("workspaces_primary_venue_idx").on(table.primaryVenueId),
  unique("workspaces_org_name_unique").on(table.organisationId, table.name),
]);

export const workspaceMemberships = pgTable("workspace_memberships", {
  id: uuid("id").primaryKey().defaultRandom(),
  workspaceId: uuid("workspace_id").notNull().references(() => workspaces.id, { onDelete: "cascade" }),
  userId: uuid("user_id").references(() => users.id, { onDelete: "set null" }),
  invitationId: uuid("invitation_id").references(() => userInvitations.id, { onDelete: "set null" }),
  email: varchar("email", { length: 255 }).notNull(),
  role: varchar("role", { length: 30 }).notNull(),
  venueRole: varchar("venue_role", { length: 20 }).notNull(),
  status: varchar("status", { length: 30 }).notNull().default("invited"),
  invitedBy: uuid("invited_by").references(() => users.id, { onDelete: "set null" }),
  acceptedAt: timestamp("accepted_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  unique("workspace_memberships_workspace_email_unique").on(table.workspaceId, table.email),
  index("workspace_memberships_workspace_status_idx").on(table.workspaceId, table.status),
  index("workspace_memberships_invitation_idx").on(table.invitationId),
  index("workspace_memberships_user_idx").on(table.userId),
]);

export const onboardingProjects = pgTable("onboarding_projects", {
  id: uuid("id").primaryKey().defaultRandom(),
  workspaceId: uuid("workspace_id").notNull().references(() => workspaces.id, { onDelete: "cascade" }),
  venueId: uuid("venue_id").notNull().references(() => venues.id),
  status: varchar("status", { length: 40 }).notNull().default("admin_invite"),
  currentStep: varchar("current_step", { length: 240 }).notNull(),
  operatorReviewState: varchar("operator_review_state", { length: 40 }).notNull().default("pending_review"),
  evidenceNote: text("evidence_note"),
  createdBy: uuid("created_by").references(() => users.id, { onDelete: "set null" }),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  completedAt: timestamp("completed_at", { withTimezone: true }),
}, (table) => [
  index("onboarding_projects_workspace_status_idx").on(table.workspaceId, table.status),
  index("onboarding_projects_venue_idx").on(table.venueId),
  index("onboarding_projects_operator_review_idx").on(table.operatorReviewState),
]);

export const workspaceEntitlements = pgTable("workspace_entitlements", {
  id: uuid("id").primaryKey().defaultRandom(),
  workspaceId: uuid("workspace_id").notNull().references(() => workspaces.id, { onDelete: "cascade" }),
  planKey: varchar("plan_key", { length: 80 }).notNull(),
  status: varchar("status", { length: 40 }).notNull().default("pending_provider_verification"),
  billingProvider: varchar("billing_provider", { length: 40 }).notNull().default("none"),
  providerCustomerRef: varchar("provider_customer_ref", { length: 240 }),
  providerEntitlementRef: varchar("provider_entitlement_ref", { length: 240 }),
  providerEvidenceRef: varchar("provider_evidence_ref", { length: 240 }),
  providerVerificationStatus: varchar("provider_verification_status", { length: 40 }).notNull().default("pending"),
  providerVerifiedAt: timestamp("provider_verified_at", { withTimezone: true }),
  accessEnforced: boolean("access_enforced").notNull().default(false),
  createdBy: uuid("created_by").references(() => users.id, { onDelete: "set null" }),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  unique("workspace_entitlements_workspace_unique").on(table.workspaceId),
  index("workspace_entitlements_status_idx").on(table.status),
  index("workspace_entitlements_provider_status_idx").on(table.billingProvider, table.providerVerificationStatus),
]);

export const onboardingAuditEvents = pgTable("onboarding_audit_events", {
  id: uuid("id").primaryKey().defaultRandom(),
  workspaceId: uuid("workspace_id").notNull().references(() => workspaces.id, { onDelete: "cascade" }),
  projectId: uuid("project_id").references(() => onboardingProjects.id, { onDelete: "set null" }),
  eventType: varchar("event_type", { length: 60 }).notNull(),
  summary: varchar("summary", { length: 500 }).notNull(),
  actorUserId: uuid("actor_user_id").references(() => users.id, { onDelete: "set null" }),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  index("onboarding_audit_events_workspace_created_idx").on(table.workspaceId, table.createdAt),
  index("onboarding_audit_events_project_idx").on(table.projectId),
]);

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
// 4b. asset_accessories — implied items for the hallkeeper sheet
//
// When a 6ft Round Table is placed, the hallkeeper needs to set up a
// tablecloth, a runner, a centrepiece, candles, and an acrylic number
// card. This table stores those rules so the manifest generator can
// expand placed items into the full setup list.
//
// Keyed on parent_asset_id (FK → asset_definitions). The hallkeeper
// sheet JOINs this table once per config to expand all accessories.
// ---------------------------------------------------------------------------

export const assetAccessories = pgTable("asset_accessories", {
  id: uuid("id").primaryKey().defaultRandom(),
  parentAssetId: uuid("parent_asset_id").notNull().references(() => assetDefinitions.id, { onDelete: "cascade" }),
  name: varchar("name", { length: 200 }).notNull(),
  category: varchar("category", { length: 50 }).notNull(),
  quantityPerParent: integer("quantity_per_parent").notNull().default(1),
  phase: varchar("phase", { length: 20 }).notNull(),
  afterDepth: integer("after_depth").notNull().default(0),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  index("asset_accessories_parent_idx").on(table.parentAssetId),
]);

// ---------------------------------------------------------------------------
// 4c. hallkeeper_progress — per-row checkbox state for the events sheet
//
// When a hallkeeper ticks off "Ivory Tablecloth × 5" on their tablet,
// this table records that tick. Multiple hallkeepers (and the events
// manager's dashboard) all read from the same rows — no localStorage
// isolation. The row_key matches the stable manifest key
// (phase|zone|name|afterDepth) so checkbox state survives config
// re-saves without resetting.
//
// Unique on (config_id, row_key) — one tick per manifest row per config.
// The checked_by / checked_at fields are audit — who ticked what when.
// ---------------------------------------------------------------------------

export const hallkeeperProgress = pgTable("hallkeeper_progress", {
  id: uuid("id").primaryKey().defaultRandom(),
  configId: uuid("config_id").notNull().references(() => configurations.id, { onDelete: "cascade" }),
  rowKey: varchar("row_key", { length: 300 }).notNull(),
  checkedBy: uuid("checked_by").references(() => users.id),
  checkedAt: timestamp("checked_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  unique("hallkeeper_progress_config_row_unique").on(table.configId, table.rowKey),
  index("hallkeeper_progress_config_idx").on(table.configId),
]);

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
  /**
   * Review lifecycle — ORTHOGONAL to `state` (draft/published).
   * Values are the 8 statuses in CONFIGURATION_REVIEW_STATUSES from
   * @omnitwin/types. See state-machines/config-review.ts for the
   * role-gated transition matrix.
   */
  reviewStatus: varchar("review_status", { length: 30 }).notNull().default("draft"),
  /** Set when `reviewStatus` first becomes "submitted". */
  submittedAt: timestamp("submitted_at", { withTimezone: true }),
  /** Set together with `approvedBy` when `reviewStatus` becomes "approved". */
  approvedAt: timestamp("approved_at", { withTimezone: true }),
  approvedBy: uuid("approved_by").references(() => users.id),
  /** Optional context — required only for reject / changes_requested transitions. */
  reviewNote: text("review_note"),
  layoutStyle: varchar("layout_style", { length: 50 }).notNull(),
  isPublicPreview: boolean("is_public_preview").notNull().default(false),
  guestCount: integer("guest_count").notNull().default(0),
  isTemplate: boolean("is_template").notNull().default(false),
  visibility: varchar("visibility", { length: 20 }).notNull().default("private"),
  /**
   * Optimistic-concurrency token for full-layout saves. Every successful
   * full-sync batch increments this value atomically before replacing the
   * placed_objects set. Clients must send the revision they loaded; stale
   * saves return 409 instead of silently overwriting another tab.
   */
  revision: integer("revision").notNull().default(1),
  thumbnailUrl: text("thumbnail_url"),
  lightmapUrl: text("lightmap_url"),
  /**
   * Planner-authored context that isn't captured by placed-object
   * geometry: special instructions, day-of contact, per-phase deadlines,
   * access notes, accessibility requirements, dietary summary, door
   * schedule. Shape defined in @omnitwin/types hallkeeper-instructions.ts
   * (ConfigurationMetadataSchema). Nullable — the hallkeeper sheet
   * renderer falls through cleanly when unset.
   */
  metadata: jsonb("metadata"),
  // URL-path identifier. Exactly one of `slug` or `shortCode` is set per
  // live row: user-owned configs get a slug (unique per user), guest
  // configs get a nanoid-6 shortCode (globally unique). Both nullable
  // during the 0017 → 0018 backfill window. Uniqueness is enforced via
  // the partial indexes `configurations_user_slug_unique` and
  // `configurations_short_code_unique` defined in migration 0017.
  slug: varchar("slug", { length: 60 }),
  shortCode: varchar("short_code", { length: 12 }),
  publishedAt: timestamp("published_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  deletedAt: timestamp("deleted_at", { withTimezone: true }),
}, (table) => [
  index("configurations_space_state_idx").on(table.spaceId, table.state),
  index("configurations_venue_visibility_idx").on(table.venueId, table.visibility),
  index("configurations_venue_review_status_idx").on(table.venueId, table.reviewStatus),
]);

// ---------------------------------------------------------------------------
// 5b. configuration_layout_revisions — immutable layout-save history
//
// Full-sync planner saves replace the placed_objects set. This table records
// each accepted revision so a conflict can be explained and a future layout
// history UI has a real source of truth. It is not the approved hallkeeper
// snapshot table; this is draft/edit history.
// ---------------------------------------------------------------------------

export const configurationLayoutRevisions = pgTable("configuration_layout_revisions", {
  id: uuid("id").primaryKey().defaultRandom(),
  configurationId: uuid("configuration_id").notNull().references(() => configurations.id, { onDelete: "cascade" }),
  revision: integer("revision").notNull(),
  source: varchar("source", { length: 40 }).notNull(),
  actorUserId: uuid("actor_user_id").references(() => users.id),
  payload: jsonb("payload").notNull(),
  coordinateSpace: varchar("coordinate_space", { length: 32 })
    .$type<LayoutCoordinateSpace>()
    .default(REAL_METRE_COORDINATE_SPACE)
    .notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  unique("configuration_layout_revisions_config_revision_unique").on(table.configurationId, table.revision),
  index("configuration_layout_revisions_config_created_idx").on(table.configurationId, table.createdAt),
]);

// ---------------------------------------------------------------------------
// 5c. configuration_review_history — audit trail for review transitions
//
// Shape parallels `enquiry_status_history` so the web timeline component
// renders both. ON DELETE CASCADE from configurations cleans the trail
// when a config is hard-deleted. `changed_by` is nullable for
// system-automatic transitions (migration backfill, scheduled archive).
// ---------------------------------------------------------------------------

export const configurationReviewHistory = pgTable("configuration_review_history", {
  id: uuid("id").primaryKey().defaultRandom(),
  configurationId: uuid("configuration_id").notNull().references(() => configurations.id, { onDelete: "cascade" }),
  fromStatus: varchar("from_status", { length: 30 }).notNull(),
  toStatus: varchar("to_status", { length: 30 }).notNull(),
  changedBy: uuid("changed_by").references(() => users.id),
  note: text("note"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  index("config_review_history_config_idx").on(table.configurationId),
]);

// ---------------------------------------------------------------------------
// 5d. review_sessions — presence tracking (who is viewing a review)
//
// Polling-based presence: viewer client heartbeats every ~10s while
// the review detail is open, server upserts `last_seen_at = now()`.
// The UI renders "Catherine is viewing" badges from rows whose
// last_seen_at falls within the 30-second active window. See
// migration 0016 for design rationale.
// ---------------------------------------------------------------------------

export const reviewSessions = pgTable("review_sessions", {
  configurationId: uuid("configuration_id").notNull().references(() => configurations.id, { onDelete: "cascade" }),
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  lastSeenAt: timestamp("last_seen_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  primaryKey({ columns: [table.configurationId, table.userId] }),
  index("review_sessions_config_last_seen_idx").on(table.configurationId, table.lastSeenAt),
]);

// ---------------------------------------------------------------------------
// 5e. configuration_sheet_snapshots — immutable hallkeeper-sheet artifacts
//
// The freeze boundary between the live config (edit-forever) and what
// the hallkeeper sees (frozen at approval). See 0013 migration comment
// for full semantics. Key invariants enforced at the DB level via CHECKs
// declared in the SQL migration (not replicated in the Drizzle DSL):
//   - version is a positive integer, gapless within a configuration
//   - version is unique per configuration (UNIQUE constraint)
//   - source_hash is 64 lowercase hex characters (CHECK regex)
//   - approval columns are both-or-neither populated (CHECK)
// ---------------------------------------------------------------------------

export const configurationSheetSnapshots = pgTable("configuration_sheet_snapshots", {
  id: uuid("id").primaryKey().defaultRandom(),
  configurationId: uuid("configuration_id").notNull().references(() => configurations.id, { onDelete: "cascade" }),
  version: integer("version").notNull(),
  payload: jsonb("payload").notNull(),
  coordinateSpace: varchar("coordinate_space", { length: 32 })
    .$type<LayoutCoordinateSpace>()
    .default(REAL_METRE_COORDINATE_SPACE)
    .notNull(),
  diagramUrl: text("diagram_url"),
  pdfUrl: text("pdf_url"),
  sourceHash: varchar("source_hash", { length: 64 }).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  createdBy: uuid("created_by").references(() => users.id),
  approvedAt: timestamp("approved_at", { withTimezone: true }),
  approvedBy: uuid("approved_by").references(() => users.id),
}, (table) => [
  unique("config_sheet_snapshot_version_unique").on(table.configurationId, table.version),
  index("config_sheet_snapshots_config_idx").on(table.configurationId),
  index("config_sheet_snapshots_source_hash_idx").on(table.configurationId, table.sourceHash),
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
  coordinateSpace: varchar("coordinate_space", { length: 32 })
    .$type<LayoutCoordinateSpace>()
    .default(REAL_METRE_COORDINATE_SPACE)
    .notNull(),
  // Application-generated on every X/Z write. Migration 0044's trigger uses
  // this nonce to reject stale render-space writers during a rolling deploy.
  coordinateWriteToken: uuid("coordinate_write_token").notNull(),
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
// 7c. commercial spine — client accounts, contacts, opportunities.
//
// These tables turn an enquiry into a managed commercial record without
// changing the visual-planning truth boundary. They store customer pipeline
// state, follow-up work, and proposal linkage; they do not imply venue,
// capacity, safety, or operational approval.
// ---------------------------------------------------------------------------

export const clientAccounts = pgTable("client_accounts", {
  id: uuid("id").primaryKey().defaultRandom(),
  venueId: uuid("venue_id").notNull().references(() => venues.id),
  name: varchar("name", { length: 200 }).notNull(),
  accountType: varchar("account_type", { length: 60 }).notNull().default("event_client"),
  primaryContactId: uuid("primary_contact_id").references((): AnyPgColumn => contacts.id, { onDelete: "set null" }),
  sourceEnquiryId: uuid("source_enquiry_id").references(() => enquiries.id, { onDelete: "set null" }),
  createdBy: uuid("created_by").references(() => users.id),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  deletedAt: timestamp("deleted_at", { withTimezone: true }),
}, (table) => [
  index("client_accounts_venue_name_idx").on(table.venueId, table.name),
  index("client_accounts_source_enquiry_idx").on(table.sourceEnquiryId),
]);

export const contacts = pgTable("contacts", {
  id: uuid("id").primaryKey().defaultRandom(),
  venueId: uuid("venue_id").notNull().references(() => venues.id),
  clientAccountId: uuid("client_account_id").references(() => clientAccounts.id, { onDelete: "set null" }),
  name: varchar("name", { length: 200 }).notNull(),
  email: varchar("email", { length: 255 }).notNull(),
  phone: varchar("phone", { length: 50 }),
  roleLabel: varchar("role_label", { length: 120 }),
  sourceEnquiryId: uuid("source_enquiry_id").references(() => enquiries.id, { onDelete: "set null" }),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  deletedAt: timestamp("deleted_at", { withTimezone: true }),
}, (table) => [
  index("contacts_venue_email_idx").on(table.venueId, table.email),
  index("contacts_account_idx").on(table.clientAccountId),
  index("contacts_source_enquiry_idx").on(table.sourceEnquiryId),
]);

export const opportunities = pgTable("opportunities", {
  id: uuid("id").primaryKey().defaultRandom(),
  venueId: uuid("venue_id").notNull().references(() => venues.id),
  clientAccountId: uuid("client_account_id").references(() => clientAccounts.id, { onDelete: "set null" }),
  primaryContactId: uuid("primary_contact_id").references(() => contacts.id, { onDelete: "set null" }),
  sourceEnquiryId: uuid("source_enquiry_id").references(() => enquiries.id, { onDelete: "set null" }),
  ownerUserId: uuid("owner_user_id").references(() => users.id, { onDelete: "set null" }),
  title: varchar("title", { length: 200 }).notNull(),
  stage: varchar("stage", { length: 40 }).notNull().default("new"),
  eventType: varchar("event_type", { length: 100 }),
  preferredDate: date("preferred_date"),
  guestCount: integer("guest_count"),
  estimatedValueMinor: integer("estimated_value_minor").notNull().default(0),
  currency: varchar("currency", { length: 3 }).notNull().default("GBP"),
  nextAction: varchar("next_action", { length: 500 }).notNull().default("Confirm the next planning step with the client."),
  nextActionDueAt: timestamp("next_action_due_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  closedAt: timestamp("closed_at", { withTimezone: true }),
  deletedAt: timestamp("deleted_at", { withTimezone: true }),
}, (table) => [
  index("opportunities_venue_stage_idx").on(table.venueId, table.stage),
  index("opportunities_account_idx").on(table.clientAccountId),
  index("opportunities_source_enquiry_idx").on(table.sourceEnquiryId),
  index("opportunities_next_action_idx").on(table.venueId, table.nextActionDueAt),
]);

export const opportunityStatusHistory = pgTable("opportunity_status_history", {
  id: uuid("id").primaryKey().defaultRandom(),
  opportunityId: uuid("opportunity_id").notNull().references(() => opportunities.id, { onDelete: "cascade" }),
  fromStage: varchar("from_stage", { length: 40 }).notNull(),
  toStage: varchar("to_stage", { length: 40 }).notNull(),
  changedBy: uuid("changed_by").references(() => users.id, { onDelete: "set null" }),
  note: text("note"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  index("opportunity_status_history_opportunity_idx").on(table.opportunityId),
]);

export const activities = pgTable("activities", {
  id: uuid("id").primaryKey().defaultRandom(),
  opportunityId: uuid("opportunity_id").notNull().references(() => opportunities.id, { onDelete: "cascade" }),
  type: varchar("type", { length: 30 }).notNull().default("note"),
  body: text("body").notNull(),
  createdBy: uuid("created_by").references(() => users.id, { onDelete: "set null" }),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  index("activities_opportunity_created_idx").on(table.opportunityId, table.createdAt),
]);

export const followUpTasks = pgTable("follow_up_tasks", {
  id: uuid("id").primaryKey().defaultRandom(),
  opportunityId: uuid("opportunity_id").notNull().references(() => opportunities.id, { onDelete: "cascade" }),
  assignedTo: uuid("assigned_to").references(() => users.id, { onDelete: "set null" }),
  title: varchar("title", { length: 200 }).notNull(),
  dueAt: timestamp("due_at", { withTimezone: true }),
  status: varchar("status", { length: 20 }).notNull().default("open"),
  completedAt: timestamp("completed_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  index("follow_up_tasks_opportunity_idx").on(table.opportunityId),
  index("follow_up_tasks_assigned_status_idx").on(table.assignedTo, table.status),
  index("follow_up_tasks_status_due_idx").on(table.status, table.dueAt),
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
  contentLengthBytes: integer("content_length_bytes"),
  sha256: varchar("sha256", { length: 64 }),
  context: varchar("context", { length: 50 }).notNull(),
  contextId: uuid("context_id").notNull(),
  visibility: varchar("visibility", { length: 20 }).notNull().default("private"),
  uploadedBy: uuid("uploaded_by").notNull().references(() => users.id),
  uploadedAt: timestamp("uploaded_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  index("files_context_idx").on(table.context, table.contextId),
  index("files_visibility_idx").on(table.visibility),
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

// ---------------------------------------------------------------------------
// 13. email_sends — audit log + idempotency store for every transactional
// email the API attempts to deliver.
//
// `idempotency_key` has a UNIQUE constraint. Callers insert this row BEFORE
// calling Resend; a duplicate key is a PostgreSQL unique-violation that
// the email service catches and treats as "already sent" — this is the
// primary dedup mechanism and survives process restarts (in-memory LRUs
// would not). `provider_message_id` is populated on success. `attempt_count`
// + `last_error` support post-mortem of transient failures during the
// bounded-retry loop in services/email.ts.
// ---------------------------------------------------------------------------

export const emailSends = pgTable("email_sends", {
  id: uuid("id").primaryKey().defaultRandom(),
  idempotencyKey: text("idempotency_key").notNull().unique(),
  recipient: text("recipient").notNull(),
  subject: text("subject").notNull(),
  status: varchar("status", { length: 20 }).notNull().default("pending"),
  providerMessageId: text("provider_message_id"),
  lastError: text("last_error"),
  attemptCount: integer("attempt_count").notNull().default(0),
  sentAt: timestamp("sent_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  index("email_sends_status_idx").on(table.status),
  index("email_sends_created_at_idx").on(table.createdAt),
]);

// ---------------------------------------------------------------------------
// 14. layout_aliases — every URL a configuration has ever resolved under.
//
// The URL resolver (services/layout-resolver.ts, Phase 2) normalises any
// incoming layout URL to a `path_key` and looks it up here. Rows with
// `retired_at IS NULL` are the current canonical address; non-null rows
// are redirect-only historical records that 301 to the canonical form.
//
// `kind` distinguishes the three URL families: legacy UUID paths
// (`/plan/<uuid>`), guest short codes (`/plan/<short_code>`), and
// authenticated user slugs (`/<username>/<slug>`). `path_key` encodes
// the full identifier with a one-letter prefix so a single index
// handles all three lookups: `uuid:<id>` / `sc:<code>` / `u:<username>/<slug>`.
//
// FK ON DELETE CASCADE: when a configuration is hard-deleted, all its
// aliases go with it — no dangling redirects. Soft-deletes
// (configurations.deletedAt) leave aliases untouched so the row can be
// restored without rebuilding URL history.
// ---------------------------------------------------------------------------

export const layoutAliases = pgTable("layout_aliases", {
  id: uuid("id").primaryKey().defaultRandom(),
  configurationId: uuid("configuration_id").notNull().references(() => configurations.id, { onDelete: "cascade" }),
  kind: varchar("kind", { length: 20 }).notNull(),
  pathKey: text("path_key").notNull(),
  retiredAt: timestamp("retired_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  unique("layout_aliases_path_unique").on(table.pathKey),
  index("layout_aliases_config_idx").on(table.configurationId),
]);

// ---------------------------------------------------------------------------
// 15. subscriptions — one row per Stripe subscription.
//
// Created during Stripe Checkout (venue_id NULL until the onboarding
// wizard attaches it). Populated by the Stripe webhook at
// /webhooks/stripe as lifecycle events arrive. Reads on the hot path
// are served from venues.subscription_status (denormalised above);
// this table is the source-of-truth for billing history and
// reconciliation with Stripe's dashboard.
// ---------------------------------------------------------------------------

export const subscriptions = pgTable("subscriptions", {
  id: uuid("id").primaryKey().defaultRandom(),
  venueId: uuid("venue_id").references(() => venues.id),
  stripeCustomerId: text("stripe_customer_id").notNull(),
  stripeSubscriptionId: text("stripe_subscription_id"),
  stripeCheckoutSessionId: text("stripe_checkout_session_id"),
  planTier: varchar("plan_tier", { length: 30 }).notNull(),
  status: varchar("status", { length: 30 }).notNull(),
  currentPeriodEnd: timestamp("current_period_end", { withTimezone: true }),
  trialEndsAt: timestamp("trial_ends_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  index("subscriptions_venue_idx").on(table.venueId),
  index("subscriptions_status_idx").on(table.status),
]);

// ---------------------------------------------------------------------------
// 16. stripe_events — idempotency log for Stripe webhooks.
//
// Mirror of the email_sends pattern: insert-first by unique event_id,
// catch PG 23505, treat duplicates as already-processed. Stripe retries
// webhooks on any non-2xx for up to 3 days, so every handler MUST be
// idempotent — storing the event_id here is how we distinguish a genuine
// retry from first delivery.
// ---------------------------------------------------------------------------

export const stripeEvents = pgTable("stripe_events", {
  id: uuid("id").primaryKey().defaultRandom(),
  eventId: text("event_id").notNull().unique(),
  type: varchar("type", { length: 100 }).notNull(),
  receivedAt: timestamp("received_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  index("stripe_events_type_idx").on(table.type),
]);

// ---------------------------------------------------------------------------
// 17. capture_sessions — raw or processed room/master capture events.
//
// Slug-based scoping is deliberate for this foundation: XGRIDS or RunPod
// outputs can be registered before a room has a fully managed `spaces` row.
// ---------------------------------------------------------------------------

export const captureSessions = pgTable("capture_sessions", {
  id: uuid("id").primaryKey().defaultRandom(),
  venueSlug: varchar("venue_slug", { length: 100 }).notNull(),
  roomSlug: varchar("room_slug", { length: 100 }),
  captureSource: varchar("capture_source", { length: 30 }).notNull(),
  captureDevice: text("capture_device"),
  captureDate: date("capture_date"),
  operatorName: text("operator_name"),
  sourceProjectName: text("source_project_name"),
  notes: text("notes"),
  status: varchar("status", { length: 30 }).notNull().default("captured"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  index("capture_sessions_venue_room_idx").on(table.venueSlug, table.roomSlug),
  index("capture_sessions_status_idx").on(table.status),
]);

// ---------------------------------------------------------------------------
// 18. asset_versions — provenance record for one stored runtime/capture asset.
// ---------------------------------------------------------------------------

export const assetVersions = pgTable("asset_versions", {
  id: uuid("id").primaryKey().defaultRandom(),
  venueSlug: varchar("venue_slug", { length: 100 }).notNull(),
  roomSlug: varchar("room_slug", { length: 100 }),
  captureSessionId: uuid("capture_session_id").references(() => captureSessions.id, { onDelete: "set null" }),
  assetKind: varchar("asset_kind", { length: 30 }).notNull(),
  sourceType: varchar("source_type", { length: 30 }).notNull(),
  fileName: text("file_name").notNull(),
  fileExt: varchar("file_ext", { length: 16 }).notNull(),
  r2Key: text("r2_key"),
  externalUrl: text("external_url"),
  mimeType: text("mime_type"),
  sha256: varchar("sha256", { length: 64 }),
  sizeBytes: bigint("size_bytes", { mode: "number" }),
  evidenceStatus: varchar("evidence_status", { length: 20 }).notNull().default("unverified"),
  runtimeStatus: varchar("runtime_status", { length: 20 }).notNull().default("staged"),
  notes: text("notes"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  unique("asset_versions_r2_key_unique").on(table.r2Key),
  unique("asset_versions_external_url_unique").on(table.externalUrl),
  index("asset_versions_venue_room_idx").on(table.venueSlug, table.roomSlug),
  index("asset_versions_capture_session_idx").on(table.captureSessionId),
  index("asset_versions_runtime_status_idx").on(table.runtimeStatus),
]);

// ---------------------------------------------------------------------------
// 19. room_manifests — room registry and alignment state for captured rooms.
// ---------------------------------------------------------------------------

export const roomManifests = pgTable("room_manifests", {
  id: uuid("id").primaryKey().defaultRandom(),
  venueSlug: varchar("venue_slug", { length: 100 }).notNull(),
  roomSlug: varchar("room_slug", { length: 100 }).notNull(),
  displayName: text("display_name").notNull(),
  matterportMasterReference: text("matterport_master_reference"),
  alignmentStatus: varchar("alignment_status", { length: 20 }).notNull().default("unaligned"),
  primaryCaptureSource: text("primary_capture_source"),
  notes: text("notes"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  unique("room_manifests_venue_room_unique").on(table.venueSlug, table.roomSlug),
  index("room_manifests_alignment_idx").on(table.alignmentStatus),
]);

// ---------------------------------------------------------------------------
// 20. runtime_packages — room-scoped runtime manifest and asset pointers.
// ---------------------------------------------------------------------------

export const runtimePackages = pgTable("runtime_packages", {
  id: uuid("id").primaryKey().defaultRandom(),
  venueSlug: varchar("venue_slug", { length: 100 }).notNull(),
  roomSlug: varchar("room_slug", { length: 100 }).notNull(),
  primaryVisualAssetVersionId: uuid("primary_visual_asset_version_id").references(() => assetVersions.id, { onDelete: "set null" }),
  semanticMeshAssetVersionId: uuid("semantic_mesh_asset_version_id").references(() => assetVersions.id, { onDelete: "set null" }),
  collisionAssetVersionId: uuid("collision_asset_version_id").references(() => assetVersions.id, { onDelete: "set null" }),
  pointCloudAssetVersionId: uuid("point_cloud_asset_version_id").references(() => assetVersions.id, { onDelete: "set null" }),
  manifestJson: jsonb("manifest_json").$type<RuntimePackageManifestJson>().notNull(),
  evidenceStatus: varchar("evidence_status", { length: 20 }).notNull().default("unverified"),
  runtimeStatus: varchar("runtime_status", { length: 20 }).notNull().default("draft"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  index("runtime_packages_venue_room_status_idx").on(table.venueSlug, table.roomSlug, table.runtimeStatus),
  index("runtime_packages_primary_visual_idx").on(table.primaryVisualAssetVersionId),
  index("runtime_packages_point_cloud_idx").on(table.pointCloudAssetVersionId),
]);

// ---------------------------------------------------------------------------
// 21. runtime_transform_artifacts — reviewed metric transforms for packages.
// ---------------------------------------------------------------------------

export const runtimeTransformArtifacts = pgTable("runtime_transform_artifacts", {
  id: uuid("id").primaryKey().defaultRandom(),
  runtimePackageId: uuid("runtime_package_id").notNull().references(() => runtimePackages.id, { onDelete: "cascade" }),
  venueSlug: varchar("venue_slug", { length: 100 }).notNull(),
  roomSlug: varchar("room_slug", { length: 100 }).notNull(),
  transformArtifactId: varchar("transform_artifact_id", { length: 120 }).notNull(),
  transformArtifact: jsonb("transform_artifact").$type<TransformArtifactV0>().notNull(),
  reviewNote: text("review_note"),
  registeredBy: uuid("registered_by").references(() => users.id, { onDelete: "set null" }),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  unique("runtime_transform_artifacts_package_artifact_unique").on(table.runtimePackageId, table.transformArtifactId),
  index("runtime_transform_artifacts_package_idx").on(table.runtimePackageId),
  index("runtime_transform_artifacts_venue_room_idx").on(table.venueSlug, table.roomSlug),
]);

// ---------------------------------------------------------------------------
// 22. runtime_qa_records — reviewed QA/exposure records for runtime packages.
// ---------------------------------------------------------------------------

export const runtimeQaRecords = pgTable("runtime_qa_records", {
  id: uuid("id").primaryKey().defaultRandom(),
  runtimePackageId: uuid("runtime_package_id").notNull().references(() => runtimePackages.id, { onDelete: "cascade" }),
  venueSlug: varchar("venue_slug", { length: 100 }).notNull(),
  roomSlug: varchar("room_slug", { length: 100 }).notNull(),
  recordId: varchar("record_id", { length: 120 }).notNull(),
  recordJson: jsonb("record_json").$type<RuntimeQaRecordV0>().notNull(),
  signedTransformArtifactId: varchar("signed_transform_artifact_id", { length: 120 }),
  publicExposureDecision: varchar("public_exposure_decision", { length: 40 }).notNull(),
  assetEvidenceStatus: varchar("asset_evidence_status", { length: 20 }).notNull(),
  runtimeStatus: varchar("runtime_status", { length: 20 }).notNull(),
  reviewedBy: uuid("reviewed_by").references(() => users.id, { onDelete: "set null" }),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  unique("runtime_qa_records_package_record_unique").on(table.runtimePackageId, table.recordId),
  index("runtime_qa_records_package_idx").on(table.runtimePackageId),
  index("runtime_qa_records_venue_room_idx").on(table.venueSlug, table.roomSlug),
  index("runtime_qa_records_signed_transform_idx").on(table.runtimePackageId, table.signedTransformArtifactId),
  index("runtime_qa_records_public_exposure_idx").on(table.publicExposureDecision),
]);

// ---------------------------------------------------------------------------
// 23. capture_control_source_records — pose/control evidence for transforms.
// ---------------------------------------------------------------------------

export const captureControlSourceRecords = pgTable("capture_control_source_records", {
  id: uuid("id").primaryKey().defaultRandom(),
  venueSlug: varchar("venue_slug", { length: 100 }).notNull(),
  roomSlug: varchar("room_slug", { length: 100 }).notNull(),
  runtimePackageId: uuid("runtime_package_id").references(() => runtimePackages.id, { onDelete: "set null" }),
  transformArtifactId: varchar("transform_artifact_id", { length: 120 }),
  sourceId: varchar("source_id", { length: 160 }).notNull(),
  sourceClass: varchar("source_class", { length: 50 }).notNull(),
  poseAuthorityLevel: varchar("pose_authority_level", { length: 50 }).notNull(),
  qaStatus: varchar("qa_status", { length: 40 }).notNull(),
  sourceRecord: jsonb("source_record").$type<CaptureControlSourceRecord>().notNull(),
  reviewNote: text("review_note"),
  registeredBy: uuid("registered_by").references(() => users.id, { onDelete: "set null" }),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  unique("capture_control_sources_venue_room_source_unique").on(table.venueSlug, table.roomSlug, table.sourceId),
  index("capture_control_sources_venue_room_idx").on(table.venueSlug, table.roomSlug),
  index("capture_control_sources_runtime_package_idx").on(table.runtimePackageId),
  index("capture_control_sources_transform_idx").on(table.runtimePackageId, table.transformArtifactId),
  index("capture_control_sources_qa_status_idx").on(table.qaStatus),
]);

// ---------------------------------------------------------------------------
// 24. processing_jobs — optional lineage/processing tracker for capture assets.
// ---------------------------------------------------------------------------

export const processingJobs = pgTable("processing_jobs", {
  id: uuid("id").primaryKey().defaultRandom(),
  venueSlug: varchar("venue_slug", { length: 100 }).notNull(),
  roomSlug: varchar("room_slug", { length: 100 }),
  sourceAssetVersionId: uuid("source_asset_version_id").references(() => assetVersions.id, { onDelete: "set null" }),
  targetRoomSlug: varchar("target_room_slug", { length: 100 }),
  processor: varchar("processor", { length: 30 }).notNull(),
  machineType: text("machine_type"),
  requiredRamGb: numeric("required_ram_gb", { precision: 6, scale: 2 }),
  status: varchar("status", { length: 30 }).notNull().default("planned"),
  outputNotes: text("output_notes"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  index("processing_jobs_venue_room_idx").on(table.venueSlug, table.roomSlug),
  index("processing_jobs_source_asset_idx").on(table.sourceAssetVersionId),
  index("processing_jobs_status_idx").on(table.status),
]);

// ---------------------------------------------------------------------------
// 21b. events — first-class event records for the Event Phase Graph.
//
// Events are venue-scoped and creator-linked. They do not replace
// configurations: configurations remain editable layout canvases, while events
// organize phases, scenarios, variants, and snapshot links around an actual
// planning lifecycle. Status vocabulary is CHECK-enforced in migration 0027.
// ---------------------------------------------------------------------------

export const events = pgTable("events", {
  id: uuid("id").primaryKey().defaultRandom(),
  venueId: uuid("venue_id").notNull().references(() => venues.id),
  createdBy: uuid("created_by").references(() => users.id),
  name: varchar("name", { length: 200 }).notNull(),
  eventType: varchar("event_type", { length: 80 }),
  status: varchar("status", { length: 30 }).notNull().default("draft"),
  startsAt: timestamp("starts_at", { withTimezone: true }),
  endsAt: timestamp("ends_at", { withTimezone: true }),
  guestCount: integer("guest_count").notNull().default(0),
  clientName: varchar("client_name", { length: 200 }),
  notes: text("notes"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  deletedAt: timestamp("deleted_at", { withTimezone: true }),
}, (table) => [
  unique("events_id_venue_unique").on(table.id, table.venueId),
  index("events_venue_status_idx").on(table.venueId, table.status),
  index("events_created_by_idx").on(table.createdBy),
]);

// ---------------------------------------------------------------------------
// 21c. event_phases — ordered phase graph nodes.
//
// Density and staff-conflict fields are explicit placeholders until a later
// Guest Flow Replay implementation writes simulated output. This prevents the
// command shell from implying a check has happened when no replay exists.
// ---------------------------------------------------------------------------

export const eventPhases = pgTable("event_phases", {
  id: uuid("id").primaryKey().defaultRandom(),
  eventId: uuid("event_id").notNull().references(() => events.id, { onDelete: "cascade" }),
  templateKey: varchar("template_key", { length: 40 }),
  name: varchar("name", { length: 100 }).notNull(),
  sortOrder: integer("sort_order").notNull(),
  startsAt: timestamp("starts_at", { withTimezone: true }),
  durationMinutes: integer("duration_minutes").notNull().default(0),
  guestCount: integer("guest_count"),
  opsTasksCount: integer("ops_tasks_count").notNull().default(0),
  reviewGatesCount: integer("review_gates_count").notNull().default(0),
  densityStatus: varchar("density_status", { length: 30 }).notNull().default("not_checked"),
  densityLabel: varchar("density_label", { length: 120 }).notNull().default("Density not checked"),
  staffConflictsStatus: varchar("staff_conflicts_status", { length: 30 }).notNull().default("not_checked"),
  staffConflictsLabel: varchar("staff_conflicts_label", { length: 120 }).notNull().default("Staff conflicts not checked"),
  notes: text("notes"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  unique("event_phases_event_template_unique").on(table.eventId, table.templateKey),
  unique("event_phases_event_id_id_unique").on(table.eventId, table.id),
  index("event_phases_event_order_idx").on(table.eventId, table.sortOrder),
]);

// ---------------------------------------------------------------------------
// 21d. event_scenarios — scenario records, not simulation results.
// ---------------------------------------------------------------------------

export const eventScenarios = pgTable("event_scenarios", {
  id: uuid("id").primaryKey().defaultRandom(),
  eventId: uuid("event_id").notNull().references(() => events.id, { onDelete: "cascade" }),
  phaseId: uuid("phase_id").references(() => eventPhases.id, { onDelete: "set null" }),
  name: varchar("name", { length: 160 }).notNull(),
  status: varchar("status", { length: 30 }).notNull().default("draft"),
  assumptions: jsonb("assumptions").$type<Record<string, unknown>>().notNull(),
  seed: integer("seed"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  // Migration 0045 applies PostgreSQL's column-targeted
  // `ON DELETE SET NULL (phase_id)`. Drizzle 0.45 cannot encode the target
  // column list, so the migration is authoritative for that delete action.
  foreignKey({
    columns: [table.eventId, table.phaseId],
    foreignColumns: [eventPhases.eventId, eventPhases.id],
    name: "event_scenarios_event_phase_fk",
  }),
  index("event_scenarios_event_idx").on(table.eventId),
  index("event_scenarios_phase_idx").on(table.phaseId),
]);

// ---------------------------------------------------------------------------
// 21e. layout_variants — named candidate layouts attached to an event.
// ---------------------------------------------------------------------------

export const layoutVariants = pgTable("layout_variants", {
  id: uuid("id").primaryKey().defaultRandom(),
  eventId: uuid("event_id").notNull().references(() => events.id, { onDelete: "cascade" }),
  configurationId: uuid("configuration_id").references(() => configurations.id, { onDelete: "set null" }),
  name: varchar("name", { length: 160 }).notNull(),
  status: varchar("status", { length: 30 }).notNull().default("draft"),
  guestCount: integer("guest_count"),
  notes: text("notes"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  index("layout_variants_event_status_idx").on(table.eventId, table.status),
  index("layout_variants_configuration_idx").on(table.configurationId),
]);

// ---------------------------------------------------------------------------
// 21f. event_configuration_links — event/configuration join with intent.
// ---------------------------------------------------------------------------

export const eventConfigurationLinks = pgTable("event_configuration_links", {
  id: uuid("id").primaryKey().defaultRandom(),
  eventId: uuid("event_id").notNull().references(() => events.id, { onDelete: "cascade" }),
  configurationId: uuid("configuration_id").notNull().references(() => configurations.id, { onDelete: "cascade" }),
  layoutVariantId: uuid("layout_variant_id").references(() => layoutVariants.id, { onDelete: "set null" }),
  linkType: varchar("link_type", { length: 40 }).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  unique("event_configuration_links_unique").on(table.eventId, table.configurationId, table.linkType),
  index("event_configuration_links_event_idx").on(table.eventId),
  index("event_configuration_links_config_idx").on(table.configurationId),
]);

// ---------------------------------------------------------------------------
// 21g. phase_layout_snapshots — phase-specific frozen or draft layout refs.
// ---------------------------------------------------------------------------

export const phaseLayoutSnapshots = pgTable("phase_layout_snapshots", {
  id: uuid("id").primaryKey().defaultRandom(),
  eventPhaseId: uuid("event_phase_id").notNull().references(() => eventPhases.id, { onDelete: "cascade" }),
  layoutVariantId: uuid("layout_variant_id").references(() => layoutVariants.id, { onDelete: "set null" }),
  configurationId: uuid("configuration_id").references(() => configurations.id, { onDelete: "set null" }),
  snapshotHash: varchar("snapshot_hash", { length: 64 }),
  status: varchar("status", { length: 30 }).notNull().default("draft"),
  objectCount: integer("object_count").notNull().default(0),
  guestCount: integer("guest_count"),
  payload: jsonb("payload").$type<Record<string, unknown> | null>(),
  coordinateSpace: varchar("coordinate_space", { length: 32 })
    .$type<LayoutCoordinateSpace>()
    .default(REAL_METRE_COORDINATE_SPACE)
    .notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  frozenAt: timestamp("frozen_at", { withTimezone: true }),
}, (table) => [
  index("phase_layout_snapshots_phase_idx").on(table.eventPhaseId),
  index("phase_layout_snapshots_variant_idx").on(table.layoutVariantId),
  index("phase_layout_snapshots_config_idx").on(table.configurationId),
]);

// ---------------------------------------------------------------------------
// 21h. evidence_items — runtime Truth Mode evidence atoms.
//
// These rows explain what is known, missing, stale, or not checked for a
// target. They are planning evidence records only; they do not imply legal,
// fire, occupancy, accessibility, or survey approval.
// ---------------------------------------------------------------------------

export const evidenceItems = pgTable("evidence_items", {
  id: uuid("id").primaryKey().defaultRandom(),
  configId: uuid("config_id").references(() => configurations.id, { onDelete: "cascade" }),
  targetType: varchar("target_type", { length: 40 }).notNull(),
  targetId: varchar("target_id", { length: 160 }).notNull(),
  itemType: varchar("item_type", { length: 40 }).notNull(),
  sourceType: varchar("source_type", { length: 40 }).notNull(),
  sourceLabel: varchar("source_label", { length: 200 }).notNull(),
  confidence: varchar("confidence", { length: 20 }).notNull().default("unknown"),
  status: varchar("status", { length: 20 }).notNull().default("not_checked"),
  staleState: varchar("stale_state", { length: 20 }).notNull().default("unknown"),
  wording: text("wording").notNull(),
  metadata: jsonb("metadata").$type<Record<string, unknown> | null>(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  index("evidence_items_config_idx").on(table.configId),
  index("evidence_items_target_idx").on(table.targetType, table.targetId),
  index("evidence_items_status_idx").on(table.status, table.staleState),
]);

export const checkResults = pgTable("check_results", {
  id: uuid("id").primaryKey().defaultRandom(),
  evidenceItemId: uuid("evidence_item_id").references(() => evidenceItems.id, { onDelete: "set null" }),
  configId: uuid("config_id").references(() => configurations.id, { onDelete: "cascade" }),
  targetType: varchar("target_type", { length: 40 }).notNull(),
  targetId: varchar("target_id", { length: 160 }).notNull(),
  checkType: varchar("check_type", { length: 40 }).notNull(),
  status: varchar("status", { length: 30 }).notNull(),
  severity: varchar("severity", { length: 20 }).notNull().default("info"),
  message: text("message").notNull(),
  measuredValue: numeric("measured_value", { precision: 12, scale: 4 }),
  thresholdValue: numeric("threshold_value", { precision: 12, scale: 4 }),
  unit: varchar("unit", { length: 40 }),
  sourceLabel: varchar("source_label", { length: 200 }).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  index("check_results_config_idx").on(table.configId),
  index("check_results_target_idx").on(table.targetType, table.targetId),
  index("check_results_type_status_idx").on(table.checkType, table.status),
]);

export const assumptionRecords = pgTable("assumption_records", {
  id: uuid("id").primaryKey().defaultRandom(),
  configId: uuid("config_id").references(() => configurations.id, { onDelete: "cascade" }),
  targetType: varchar("target_type", { length: 40 }).notNull(),
  targetId: varchar("target_id", { length: 160 }).notNull(),
  assumptionType: varchar("assumption_type", { length: 80 }).notNull(),
  value: jsonb("value").$type<unknown>().notNull(),
  sourceLabel: varchar("source_label", { length: 200 }).notNull(),
  status: varchar("status", { length: 20 }).notNull().default("active"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  index("assumption_records_config_idx").on(table.configId),
  index("assumption_records_target_idx").on(table.targetType, table.targetId),
]);

export const reviewGates = pgTable("review_gates", {
  id: uuid("id").primaryKey().defaultRandom(),
  configId: uuid("config_id").references(() => configurations.id, { onDelete: "cascade" }),
  targetType: varchar("target_type", { length: 40 }).notNull(),
  targetId: varchar("target_id", { length: 160 }).notNull(),
  gateType: varchar("gate_type", { length: 60 }).notNull(),
  status: varchar("status", { length: 20 }).notNull().default("open"),
  title: varchar("title", { length: 200 }).notNull(),
  description: text("description").notNull(),
  requiredRole: varchar("required_role", { length: 80 }),
  decisionBy: uuid("decision_by").references(() => users.id),
  decisionAt: timestamp("decision_at", { withTimezone: true }),
  decisionNote: text("decision_note"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  index("review_gates_config_idx").on(table.configId),
  index("review_gates_target_idx").on(table.targetType, table.targetId),
  index("review_gates_status_idx").on(table.status),
]);

export const claimStates = pgTable("claim_states", {
  id: uuid("id").primaryKey().defaultRandom(),
  configId: uuid("config_id").references(() => configurations.id, { onDelete: "cascade" }),
  targetType: varchar("target_type", { length: 40 }).notNull(),
  targetId: varchar("target_id", { length: 160 }).notNull(),
  claimKey: varchar("claim_key", { length: 120 }).notNull(),
  status: varchar("status", { length: 40 }).notNull(),
  safeWording: text("safe_wording").notNull(),
  evidencePackId: uuid("evidence_pack_id"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  unique("claim_states_target_key_unique").on(table.targetType, table.targetId, table.claimKey),
  index("claim_states_config_idx").on(table.configId),
  index("claim_states_pack_idx").on(table.evidencePackId),
]);

export const evidencePacks = pgTable("evidence_packs", {
  id: uuid("id").primaryKey().defaultRandom(),
  configId: uuid("config_id").notNull().references(() => configurations.id, { onDelete: "cascade" }),
  snapshotId: uuid("snapshot_id").notNull().references(() => configurationSheetSnapshots.id, { onDelete: "cascade" }),
  snapshotHash: varchar("snapshot_hash", { length: 64 }).notNull(),
  payloadHash: varchar("payload_hash", { length: 64 }).notNull(),
  status: varchar("status", { length: 20 }).notNull().default("generated"),
  humanReviewRequired: boolean("human_review_required").notNull().default(true),
  payload: jsonb("payload").$type<Record<string, unknown>>().notNull(),
  generatedBy: uuid("generated_by").references(() => users.id),
  generatedAt: timestamp("generated_at", { withTimezone: true }).defaultNow().notNull(),
  staleAt: timestamp("stale_at", { withTimezone: true }),
}, (table) => [
  unique("evidence_packs_snapshot_hash_unique").on(table.snapshotId, table.payloadHash),
  index("evidence_packs_config_idx").on(table.configId),
  index("evidence_packs_snapshot_idx").on(table.snapshotId),
  index("evidence_packs_status_idx").on(table.status),
]);

export const evidencePackItems = pgTable("evidence_pack_items", {
  id: uuid("id").primaryKey().defaultRandom(),
  evidencePackId: uuid("evidence_pack_id").notNull().references(() => evidencePacks.id, { onDelete: "cascade" }),
  evidenceItemId: uuid("evidence_item_id").notNull().references(() => evidenceItems.id, { onDelete: "cascade" }),
  itemRole: varchar("item_role", { length: 40 }).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  unique("evidence_pack_items_unique").on(table.evidencePackId, table.evidenceItemId, table.itemRole),
  index("evidence_pack_items_pack_idx").on(table.evidencePackId),
]);

export const staleEvidenceEvents = pgTable("stale_evidence_events", {
  id: uuid("id").primaryKey().defaultRandom(),
  configId: uuid("config_id").notNull().references(() => configurations.id, { onDelete: "cascade" }),
  targetType: varchar("target_type", { length: 40 }).notNull(),
  targetId: varchar("target_id", { length: 160 }).notNull(),
  evidencePackId: uuid("evidence_pack_id").references(() => evidencePacks.id, { onDelete: "set null" }),
  reason: varchar("reason", { length: 200 }).notNull(),
  previousHash: varchar("previous_hash", { length: 64 }),
  newHash: varchar("new_hash", { length: 64 }),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  index("stale_evidence_events_config_idx").on(table.configId),
  index("stale_evidence_events_target_idx").on(table.targetType, table.targetId),
  index("stale_evidence_events_pack_idx").on(table.evidencePackId),
]);

export const generalAuditLog = pgTable("general_audit_log", {
  id: uuid("id").primaryKey().defaultRandom(),
  actorUserId: uuid("actor_user_id").references(() => users.id),
  action: varchar("action", { length: 120 }).notNull(),
  targetType: varchar("target_type", { length: 80 }).notNull(),
  targetId: varchar("target_id", { length: 160 }).notNull(),
  summary: text("summary").notNull(),
  metadata: jsonb("metadata").$type<Record<string, unknown> | null>(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  index("general_audit_log_target_idx").on(table.targetType, table.targetId),
  index("general_audit_log_actor_idx").on(table.actorUserId),
  index("general_audit_log_action_idx").on(table.action),
]);

// ---------------------------------------------------------------------------
// 22. ops compiler — frozen handoff artifacts from approved snapshots.
//
// These rows are internal operations handoffs. They are compiled from a frozen
// hallkeeper snapshot and optional event phase context. They do not represent
// event-day live task state; that belongs to the later mobile ops board.
// ---------------------------------------------------------------------------

export const handoffPacks = pgTable("handoff_packs", {
  id: uuid("id").primaryKey().defaultRandom(),
  eventId: uuid("event_id").references(() => events.id, { onDelete: "set null" }),
  configId: uuid("config_id").notNull().references(() => configurations.id, { onDelete: "cascade" }),
  snapshotId: uuid("snapshot_id").notNull().references(() => configurationSheetSnapshots.id, { onDelete: "cascade" }),
  snapshotHash: varchar("snapshot_hash", { length: 64 }).notNull(),
  version: integer("version").notNull().default(1),
  status: varchar("status", { length: 20 }).notNull().default("compiled"),
  sourceLabel: varchar("source_label", { length: 200 }).notNull(),
  summary: text("summary").notNull(),
  createdBy: uuid("created_by").references(() => users.id),
  compiledAt: timestamp("compiled_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  unique("handoff_packs_snapshot_version_unique").on(table.snapshotId, table.version),
  unique("handoff_packs_event_id_id_unique").on(table.eventId, table.id),
  index("handoff_packs_config_idx").on(table.configId),
  index("handoff_packs_event_idx").on(table.eventId),
  index("handoff_packs_status_idx").on(table.status),
]);

export const taskGroups = pgTable("task_groups", {
  id: uuid("id").primaryKey().defaultRandom(),
  handoffPackId: uuid("handoff_pack_id").notNull().references(() => handoffPacks.id, { onDelete: "cascade" }),
  title: varchar("title", { length: 200 }).notNull(),
  kind: varchar("kind", { length: 30 }).notNull(),
  sortOrder: integer("sort_order").notNull().default(0),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  index("task_groups_pack_order_idx").on(table.handoffPackId, table.sortOrder),
]);

export const opsTasks = pgTable("ops_tasks", {
  id: uuid("id").primaryKey().defaultRandom(),
  handoffPackId: uuid("handoff_pack_id").notNull().references(() => handoffPacks.id, { onDelete: "cascade" }),
  taskGroupId: uuid("task_group_id").references(() => taskGroups.id, { onDelete: "set null" }),
  phaseId: uuid("phase_id").references(() => eventPhases.id, { onDelete: "set null" }),
  kind: varchar("kind", { length: 30 }).notNull(),
  title: varchar("title", { length: 240 }).notNull(),
  detail: text("detail").notNull(),
  status: varchar("status", { length: 20 }).notNull().default("todo"),
  sortOrder: integer("sort_order").notNull().default(0),
  dueLabel: varchar("due_label", { length: 120 }),
  sourceRef: varchar("source_ref", { length: 300 }),
  spatialAnchors: jsonb("spatial_anchors").$type<EventMissionSpatialAnchor[]>().notNull().default([]),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  unique("ops_tasks_handoff_id_unique").on(table.handoffPackId, table.id),
  index("ops_tasks_pack_order_idx").on(table.handoffPackId, table.sortOrder),
  index("ops_tasks_group_idx").on(table.taskGroupId),
  index("ops_tasks_status_idx").on(table.status),
]);

export const furniturePickLists = pgTable("furniture_pick_lists", {
  id: uuid("id").primaryKey().defaultRandom(),
  handoffPackId: uuid("handoff_pack_id").notNull().references(() => handoffPacks.id, { onDelete: "cascade" }),
  title: varchar("title", { length: 200 }).notNull(),
  totalItems: integer("total_items").notNull().default(0),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  unique("furniture_pick_lists_pack_unique").on(table.handoffPackId),
]);

export const pickListItems = pgTable("pick_list_items", {
  id: uuid("id").primaryKey().defaultRandom(),
  pickListId: uuid("pick_list_id").notNull().references(() => furniturePickLists.id, { onDelete: "cascade" }),
  name: varchar("name", { length: 200 }).notNull(),
  category: varchar("category", { length: 80 }).notNull(),
  quantity: integer("quantity").notNull().default(0),
  sourcePhase: varchar("source_phase", { length: 80 }),
  sourceZone: varchar("source_zone", { length: 80 }),
  notes: text("notes"),
  sortOrder: integer("sort_order").notNull().default(0),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  index("pick_list_items_list_order_idx").on(table.pickListId, table.sortOrder),
]);

export const suppliers = pgTable("suppliers", {
  id: uuid("id").primaryKey().defaultRandom(),
  venueId: uuid("venue_id").references(() => venues.id, { onDelete: "set null" }),
  name: varchar("name", { length: 200 }).notNull(),
  category: varchar("category", { length: 80 }).notNull(),
  contactName: varchar("contact_name", { length: 160 }),
  email: varchar("email", { length: 255 }),
  phone: varchar("phone", { length: 40 }),
  notes: text("notes"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  deletedAt: timestamp("deleted_at", { withTimezone: true }),
}, (table) => [
  index("suppliers_venue_category_idx").on(table.venueId, table.category),
]);

export const supplierInstructions = pgTable("supplier_instructions", {
  id: uuid("id").primaryKey().defaultRandom(),
  handoffPackId: uuid("handoff_pack_id").notNull().references(() => handoffPacks.id, { onDelete: "cascade" }),
  supplierId: uuid("supplier_id").references(() => suppliers.id, { onDelete: "set null" }),
  category: varchar("category", { length: 80 }).notNull(),
  title: varchar("title", { length: 200 }).notNull(),
  detail: text("detail").notNull(),
  arrivalWindow: varchar("arrival_window", { length: 120 }),
  sourceRef: varchar("source_ref", { length: 300 }),
  sortOrder: integer("sort_order").notNull().default(0),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  index("supplier_instructions_pack_order_idx").on(table.handoffPackId, table.sortOrder),
  index("supplier_instructions_supplier_idx").on(table.supplierId),
]);

// ---------------------------------------------------------------------------
// 22a. supplier_coordination_* — supplier-safe external handoff packs.
//
// These rows are capability-shareable extracts from frozen ops handoff packs.
// Public supplier views resolve through hashed bearer tokens and expose only
// supplier-scoped instructions, contact fields, and source provenance.
// ---------------------------------------------------------------------------

export const supplierCoordinationPacks = pgTable("supplier_coordination_packs", {
  id: uuid("id").primaryKey().defaultRandom(),
  venueId: uuid("venue_id").notNull().references(() => venues.id, { onDelete: "cascade" }),
  handoffPackId: uuid("handoff_pack_id").notNull().references(() => handoffPacks.id, { onDelete: "cascade" }),
  eventId: uuid("event_id").references(() => events.id, { onDelete: "set null" }),
  supplierId: uuid("supplier_id").references(() => suppliers.id, { onDelete: "set null" }),
  title: varchar("title", { length: 200 }).notNull(),
  contactName: varchar("contact_name", { length: 160 }),
  contactEmail: varchar("contact_email", { length: 255 }),
  contactPhone: varchar("contact_phone", { length: 40 }),
  status: varchar("status", { length: 30 }).notNull().default("draft"),
  sourceSnapshotHash: varchar("source_snapshot_hash", { length: 64 }).notNull(),
  sourceDigest: varchar("source_digest", { length: 64 }).notNull(),
  sourceLabel: varchar("source_label", { length: 200 }).notNull(),
  safeStatus: varchar("safe_status", { length: 80 }).notNull().default("supplier_safe_operations_handoff"),
  createdBy: uuid("created_by").references(() => users.id, { onDelete: "set null" }),
  issuedAt: timestamp("issued_at", { withTimezone: true }),
  acknowledgedAt: timestamp("acknowledged_at", { withTimezone: true }),
  expiresAt: timestamp("expires_at", { withTimezone: true }),
  revokedAt: timestamp("revoked_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  index("supplier_coordination_packs_venue_status_idx").on(table.venueId, table.status),
  index("supplier_coordination_packs_handoff_idx").on(table.handoffPackId),
  index("supplier_coordination_packs_supplier_idx").on(table.supplierId),
]);

export const supplierCoordinationPackItems = pgTable("supplier_coordination_pack_items", {
  id: uuid("id").primaryKey().defaultRandom(),
  packId: uuid("pack_id").notNull().references(() => supplierCoordinationPacks.id, { onDelete: "cascade" }),
  supplierInstructionId: uuid("supplier_instruction_id").references(() => supplierInstructions.id, { onDelete: "set null" }),
  kind: varchar("kind", { length: 30 }).notNull().default("requirement"),
  title: varchar("title", { length: 200 }).notNull(),
  detail: text("detail").notNull(),
  arrivalWindow: varchar("arrival_window", { length: 120 }),
  sourceRef: varchar("source_ref", { length: 300 }),
  sortOrder: integer("sort_order").notNull().default(0),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  index("supplier_coordination_items_pack_order_idx").on(table.packId, table.sortOrder),
  index("supplier_coordination_items_instruction_idx").on(table.supplierInstructionId),
]);

export const supplierCoordinationShareTokens = pgTable("supplier_coordination_share_tokens", {
  id: uuid("id").primaryKey().defaultRandom(),
  packId: uuid("pack_id").notNull().references(() => supplierCoordinationPacks.id, { onDelete: "cascade" }),
  tokenHash: varchar("token_hash", { length: 64 }).notNull().unique(),
  tokenPrefix: varchar("token_prefix", { length: 16 }).notNull(),
  createdBy: uuid("created_by").references(() => users.id, { onDelete: "set null" }),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  expiresAt: timestamp("expires_at", { withTimezone: true }),
  revokedAt: timestamp("revoked_at", { withTimezone: true }),
  lastViewedAt: timestamp("last_viewed_at", { withTimezone: true }),
}, (table) => [
  index("supplier_coordination_tokens_pack_idx").on(table.packId),
  index("supplier_coordination_tokens_hash_idx").on(table.tokenHash),
]);

export const supplierAcknowledgements = pgTable("supplier_acknowledgements", {
  id: uuid("id").primaryKey().defaultRandom(),
  packId: uuid("pack_id").notNull().references(() => supplierCoordinationPacks.id, { onDelete: "cascade" }),
  shareTokenId: uuid("share_token_id").references(() => supplierCoordinationShareTokens.id, { onDelete: "set null" }),
  status: varchar("status", { length: 30 }).notNull().default("acknowledged"),
  acknowledgedByName: varchar("acknowledged_by_name", { length: 160 }),
  acknowledgedByEmail: varchar("acknowledged_by_email", { length: 255 }),
  note: text("note"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  index("supplier_acknowledgements_pack_created_idx").on(table.packId, table.createdAt),
  index("supplier_acknowledgements_share_token_idx").on(table.shareTokenId),
]);

export const loadInSequences = pgTable("load_in_sequences", {
  id: uuid("id").primaryKey().defaultRandom(),
  handoffPackId: uuid("handoff_pack_id").notNull().references(() => handoffPacks.id, { onDelete: "cascade" }),
  stepNumber: integer("step_number").notNull(),
  title: varchar("title", { length: 200 }).notNull(),
  detail: text("detail").notNull(),
  sortOrder: integer("sort_order").notNull().default(0),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  index("load_in_sequences_pack_order_idx").on(table.handoffPackId, table.sortOrder),
]);

export const breakdownSequences = pgTable("breakdown_sequences", {
  id: uuid("id").primaryKey().defaultRandom(),
  handoffPackId: uuid("handoff_pack_id").notNull().references(() => handoffPacks.id, { onDelete: "cascade" }),
  stepNumber: integer("step_number").notNull(),
  title: varchar("title", { length: 200 }).notNull(),
  detail: text("detail").notNull(),
  sortOrder: integer("sort_order").notNull().default(0),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  index("breakdown_sequences_pack_order_idx").on(table.handoffPackId, table.sortOrder),
]);

export const roomFlipPlans = pgTable("room_flip_plans", {
  id: uuid("id").primaryKey().defaultRandom(),
  handoffPackId: uuid("handoff_pack_id").notNull().references(() => handoffPacks.id, { onDelete: "cascade" }),
  phaseId: uuid("phase_id").references(() => eventPhases.id, { onDelete: "set null" }),
  fromPhaseLabel: varchar("from_phase_label", { length: 120 }),
  toPhaseLabel: varchar("to_phase_label", { length: 120 }),
  durationMinutes: integer("duration_minutes").notNull().default(0),
  taskCount: integer("task_count").notNull().default(0),
  reviewGateCount: integer("review_gate_count").notNull().default(0),
  notes: text("notes").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  index("room_flip_plans_pack_idx").on(table.handoffPackId),
  index("room_flip_plans_phase_idx").on(table.phaseId),
]);

export const beoDocuments = pgTable("beo_documents", {
  id: uuid("id").primaryKey().defaultRandom(),
  handoffPackId: uuid("handoff_pack_id").notNull().references(() => handoffPacks.id, { onDelete: "cascade" }),
  title: varchar("title", { length: 200 }).notNull(),
  body: text("body").notNull(),
  sourceSnapshotHash: varchar("source_snapshot_hash", { length: 64 }).notNull(),
  safeStatus: varchar("safe_status", { length: 60 }).notNull().default("internal_operations_handoff"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  unique("beo_documents_pack_unique").on(table.handoffPackId),
]);

export const snapshotDiffs = pgTable("snapshot_diffs", {
  id: uuid("id").primaryKey().defaultRandom(),
  handoffPackId: uuid("handoff_pack_id").notNull().references(() => handoffPacks.id, { onDelete: "cascade" }),
  previousSnapshotHash: varchar("previous_snapshot_hash", { length: 64 }),
  currentSnapshotHash: varchar("current_snapshot_hash", { length: 64 }).notNull(),
  addedCount: integer("added_count").notNull().default(0),
  removedCount: integer("removed_count").notNull().default(0),
  changedCount: integer("changed_count").notNull().default(0),
  summary: text("summary").notNull(),
  payload: jsonb("payload").$type<Record<string, unknown>>().notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  unique("snapshot_diffs_pack_unique").on(table.handoffPackId),
]);

// ---------------------------------------------------------------------------
// 22b. event-day ops — live mobile execution state.
//
// These rows record day-of progress and issues for hallkeepers and operations
// staff. They do not mutate the frozen handoff pack beyond task status, and
// they do not imply compliance, safety, or certification.
// ---------------------------------------------------------------------------

export const eventDayIssues = pgTable("event_day_issues", {
  id: uuid("id").primaryKey().defaultRandom(),
  eventId: uuid("event_id").notNull().references(() => events.id, { onDelete: "cascade" }),
  phaseId: uuid("phase_id").references(() => eventPhases.id, { onDelete: "set null" }),
  opsTaskId: uuid("ops_task_id").references(() => opsTasks.id, { onDelete: "set null" }),
  title: varchar("title", { length: 180 }).notNull(),
  detail: text("detail").notNull(),
  status: varchar("status", { length: 20 }).notNull().default("open"),
  severity: varchar("severity", { length: 20 }).notNull().default("attention"),
  source: varchar("source", { length: 20 }).notNull().default("hallkeeper"),
  reportedBy: uuid("reported_by").references(() => users.id),
  assignedTo: uuid("assigned_to").references(() => users.id),
  escalationNote: text("escalation_note"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  resolvedAt: timestamp("resolved_at", { withTimezone: true }),
}, (table) => [
  index("event_day_issues_event_status_idx").on(table.eventId, table.status),
  index("event_day_issues_phase_idx").on(table.phaseId),
  index("event_day_issues_task_idx").on(table.opsTaskId),
]);

export const taskAssignments = pgTable("task_assignments", {
  id: uuid("id").primaryKey().defaultRandom(),
  opsTaskId: uuid("ops_task_id").notNull().references(() => opsTasks.id, { onDelete: "cascade" }),
  eventId: uuid("event_id").notNull().references(() => events.id, { onDelete: "cascade" }),
  assignedTo: uuid("assigned_to").references(() => users.id),
  assigneeLabel: varchar("assignee_label", { length: 160 }),
  roleLabel: varchar("role_label", { length: 80 }),
  status: varchar("status", { length: 20 }).notNull().default("assigned"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  index("task_assignments_event_idx").on(table.eventId),
  index("task_assignments_task_idx").on(table.opsTaskId),
  index("task_assignments_assignee_idx").on(table.assignedTo),
]);

export const taskCompletionEvents = pgTable("task_completion_events", {
  id: uuid("id").primaryKey().defaultRandom(),
  opsTaskId: uuid("ops_task_id").notNull().references(() => opsTasks.id, { onDelete: "cascade" }),
  eventId: uuid("event_id").notNull().references(() => events.id, { onDelete: "cascade" }),
  actorUserId: uuid("actor_user_id").references(() => users.id),
  fromStatus: varchar("from_status", { length: 20 }).notNull(),
  toStatus: varchar("to_status", { length: 20 }).notNull(),
  idempotencyKey: varchar("idempotency_key", { length: 160 }),
  note: text("note"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  index("task_completion_events_event_idx").on(table.eventId, table.createdAt),
  index("task_completion_events_task_idx").on(table.opsTaskId, table.createdAt),
]);

export const opsStatusUpdates = pgTable("ops_status_updates", {
  id: uuid("id").primaryKey().defaultRandom(),
  eventId: uuid("event_id").notNull().references(() => events.id, { onDelete: "cascade" }),
  phaseId: uuid("phase_id").references(() => eventPhases.id, { onDelete: "set null" }),
  kind: varchar("kind", { length: 20 }).notNull().default("general"),
  message: text("message").notNull(),
  createdBy: uuid("created_by").references(() => users.id),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  index("ops_status_updates_event_idx").on(table.eventId, table.createdAt),
  index("ops_status_updates_phase_idx").on(table.phaseId),
]);

// ---------------------------------------------------------------------------
// 22c. guest flow replay — deterministic simulated planning artifacts.
//
// V0 stores custom Venviewer replay outputs as inspectable planning support:
// scenarios, navmesh versions, trajectories, density cells, route conflicts,
// queue zones, and staff lanes.
// It does not assert legal, safety, accessibility, egress, or occupancy status.
// ---------------------------------------------------------------------------

export const guestFlowScenarios = pgTable("guest_flow_scenarios", {
  id: uuid("id").primaryKey().defaultRandom(),
  eventId: uuid("event_id").references(() => events.id, { onDelete: "set null" }),
  phaseId: uuid("phase_id").references(() => eventPhases.id, { onDelete: "set null" }),
  configurationId: uuid("configuration_id").references(() => configurations.id, { onDelete: "set null" }),
  name: varchar("name", { length: 180 }).notNull(),
  scenarioType: varchar("scenario_type", { length: 60 }).notNull(),
  status: varchar("status", { length: 40 }).notNull().default("draft"),
  seed: integer("seed").notNull(),
  assumptions: jsonb("assumptions").$type<GuestFlowAssumption[]>().notNull(),
  inputPayload: jsonb("input_payload").$type<GuestFlowReplayInput>().notNull(),
  createdBy: uuid("created_by").references(() => users.id),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  index("guest_flow_scenarios_event_idx").on(table.eventId, table.createdAt),
  index("guest_flow_scenarios_phase_idx").on(table.phaseId),
  index("guest_flow_scenarios_config_idx").on(table.configurationId),
]);

export const navmeshVersions = pgTable("navmesh_versions", {
  id: uuid("id").primaryKey().defaultRandom(),
  eventId: uuid("event_id").references(() => events.id, { onDelete: "set null" }),
  phaseId: uuid("phase_id").references(() => eventPhases.id, { onDelete: "set null" }),
  configurationId: uuid("configuration_id").references(() => configurations.id, { onDelete: "set null" }),
  scenarioId: uuid("scenario_id").references(() => guestFlowScenarios.id, { onDelete: "set null" }),
  navmeshHash: varchar("navmesh_hash", { length: 64 }).notNull(),
  inputHash: varchar("input_hash", { length: 64 }).notNull(),
  algorithm: varchar("algorithm", { length: 80 }).notNull().default("grid_navmesh_fallback_v0"),
  cellSizeM: numeric("cell_size_m", { precision: 8, scale: 3 }).notNull(),
  agentRadiusM: numeric("agent_radius_m", { precision: 8, scale: 3 }).notNull(),
  walkableCellCount: integer("walkable_cell_count").notNull(),
  blockedCellCount: integer("blocked_cell_count").notNull(),
  payload: jsonb("payload").$type<GuestFlowNavmeshArtifact>().notNull(),
  limitations: jsonb("limitations").$type<string[]>().notNull(),
  createdBy: uuid("created_by").references(() => users.id),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  index("navmesh_versions_event_idx").on(table.eventId, table.createdAt),
  index("navmesh_versions_phase_idx").on(table.phaseId),
  index("navmesh_versions_config_idx").on(table.configurationId),
  index("navmesh_versions_scenario_idx").on(table.scenarioId),
  unique("navmesh_versions_hash_unique").on(table.navmeshHash),
]);

export const guestFlowReplays = pgTable("guest_flow_replays", {
  id: uuid("id").primaryKey().defaultRandom(),
  scenarioId: uuid("scenario_id").references(() => guestFlowScenarios.id, { onDelete: "set null" }),
  navmeshVersionId: uuid("navmesh_version_id").references(() => navmeshVersions.id, { onDelete: "set null" }),
  eventId: uuid("event_id").references(() => events.id, { onDelete: "set null" }),
  phaseId: uuid("phase_id").references(() => eventPhases.id, { onDelete: "set null" }),
  configurationId: uuid("configuration_id").references(() => configurations.id, { onDelete: "set null" }),
  scenarioType: varchar("scenario_type", { length: 60 }).notNull(),
  status: varchar("status", { length: 40 }).notNull().default("simulated_planning_support"),
  simulatorSource: varchar("simulator_source", { length: 60 }).notNull().default("custom_venviewer_v0"),
  seed: integer("seed").notNull(),
  inputHash: varchar("input_hash", { length: 64 }).notNull(),
  artifactHash: varchar("artifact_hash", { length: 64 }).notNull(),
  snapshotHash: varchar("snapshot_hash", { length: 64 }),
  assumptions: jsonb("assumptions").$type<GuestFlowAssumption[]>().notNull(),
  inputPayload: jsonb("input_payload").$type<GuestFlowReplayInput>().notNull(),
  metrics: jsonb("metrics").$type<GuestFlowReplayMetrics>().notNull(),
  disclosureLabel: varchar("disclosure_label", { length: 160 }).notNull().default("Simulated guest flow - planning support"),
  createdBy: uuid("created_by").references(() => users.id),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  index("guest_flow_replays_event_idx").on(table.eventId, table.createdAt),
  index("guest_flow_replays_phase_idx").on(table.phaseId),
  index("guest_flow_replays_config_idx").on(table.configurationId),
  unique("guest_flow_replays_artifact_hash_unique").on(table.artifactHash),
]);

export const agentTrajectories = pgTable("agent_trajectories", {
  id: uuid("id").primaryKey().defaultRandom(),
  replayId: uuid("replay_id").notNull().references(() => guestFlowReplays.id, { onDelete: "cascade" }),
  agentId: varchar("agent_id", { length: 80 }).notNull(),
  profile: varchar("profile", { length: 40 }).notNull(),
  spawnId: varchar("spawn_id", { length: 120 }).notNull(),
  destinationId: varchar("destination_id", { length: 120 }).notNull(),
  points: jsonb("points").$type<AgentTrajectory["points"]>().notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  index("agent_trajectories_replay_idx").on(table.replayId, table.agentId),
]);

export const densityHeatmaps = pgTable("density_heatmaps", {
  id: uuid("id").primaryKey().defaultRandom(),
  replayId: uuid("replay_id").notNull().references(() => guestFlowReplays.id, { onDelete: "cascade" }),
  cellSizeM: numeric("cell_size_m", { precision: 8, scale: 3 }).notNull(),
  maxDensity: numeric("max_density", { precision: 10, scale: 3 }).notNull(),
  cells: jsonb("cells").$type<DensityHeatmapCell[]>().notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  unique("density_heatmaps_replay_unique").on(table.replayId),
]);

export const routeConflicts = pgTable("route_conflicts", {
  id: uuid("id").primaryKey().defaultRandom(),
  replayId: uuid("replay_id").notNull().references(() => guestFlowReplays.id, { onDelete: "cascade" }),
  conflictKey: varchar("conflict_key", { length: 120 }).notNull(),
  conflictType: varchar("conflict_type", { length: 40 }).notNull(),
  severity: varchar("severity", { length: 20 }).notNull(),
  point: jsonb("point").$type<GuestFlowPoint>().notNull(),
  involvedAgentIds: jsonb("involved_agent_ids").$type<string[]>().notNull(),
  message: text("message").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  index("route_conflicts_replay_idx").on(table.replayId, table.severity),
]);

export const queueZones = pgTable("queue_zones", {
  id: uuid("id").primaryKey().defaultRandom(),
  replayId: uuid("replay_id").notNull().references(() => guestFlowReplays.id, { onDelete: "cascade" }),
  zoneKey: varchar("zone_key", { length: 120 }).notNull(),
  destinationId: varchar("destination_id", { length: 120 }).notNull(),
  label: varchar("label", { length: 160 }).notNull(),
  centre: jsonb("centre").$type<GuestFlowPoint>().notNull(),
  estimatedAgents: integer("estimated_agents").notNull().default(0),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  index("queue_zones_replay_idx").on(table.replayId),
]);

export const staffLanes = pgTable("staff_lanes", {
  id: uuid("id").primaryKey().defaultRandom(),
  replayId: uuid("replay_id").notNull().references(() => guestFlowReplays.id, { onDelete: "cascade" }),
  laneKey: varchar("lane_key", { length: 120 }).notNull(),
  label: varchar("label", { length: 160 }).notNull(),
  line: jsonb("line").$type<GuestFlowPoint[]>().notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  index("staff_lanes_replay_idx").on(table.replayId),
]);

// ---------------------------------------------------------------------------
// 23. proposals — client-facing commercial documents (T-427 phase 1).
//
// House patterns: venue scoping (venue_id FK + venue/status index), soft
// delete (deleted_at), status history in 22c, immutable version snapshots in
// 22b. `current_version` is 0 until the first snapshot exists. `share_code`
// is the house nanoid-6 shortcode, set when the proposal is first shared.
// Status vocabulary and the sent_at coherence rule live in
// @omnitwin/types proposal.ts; the CHECK constraints are declared in
// migration 0026 (not replicated in the Drizzle DSL, matching 0024's style).
// ---------------------------------------------------------------------------

export const proposals = pgTable("proposals", {
  id: uuid("id").primaryKey().defaultRandom(),
  venueId: uuid("venue_id").notNull().references(() => venues.id),
  opportunityId: uuid("opportunity_id").references(() => opportunities.id, { onDelete: "set null" }),
  enquiryId: uuid("enquiry_id").references(() => enquiries.id, { onDelete: "set null" }),
  configurationId: uuid("configuration_id").references(() => configurations.id, { onDelete: "set null" }),
  title: varchar("title", { length: 200 }).notNull(),
  status: varchar("status", { length: 30 }).notNull().default("draft"),
  currentVersion: integer("current_version").notNull().default(0),
  shareCode: varchar("share_code", { length: 12 }),
  sentAt: timestamp("sent_at", { withTimezone: true }),
  createdBy: uuid("created_by").references(() => users.id),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  deletedAt: timestamp("deleted_at", { withTimezone: true }),
}, (table) => [
  unique("proposals_share_code_unique").on(table.shareCode),
  index("proposals_venue_status_idx").on(table.venueId, table.status),
  index("proposals_opportunity_idx").on(table.opportunityId),
  index("proposals_enquiry_idx").on(table.enquiryId),
]);

// ---------------------------------------------------------------------------
// 22b. proposal_versions — immutable client-facing content snapshots.
//
// Mirrors configuration_sheet_snapshots: version is a positive integer,
// gapless and unique per proposal; source_hash is the domain-prefixed
// SHA-256 of the payload's stable canonical JSON (64 lowercase hex,
// CHECK-enforced in migration 0026).
// ---------------------------------------------------------------------------

export const proposalVersions = pgTable("proposal_versions", {
  id: uuid("id").primaryKey().defaultRandom(),
  proposalId: uuid("proposal_id").notNull().references(() => proposals.id, { onDelete: "cascade" }),
  version: integer("version").notNull(),
  payload: jsonb("payload").$type<ProposalVersionPayload>().notNull(),
  coordinateSpace: varchar("coordinate_space", { length: 32 })
    .$type<LayoutCoordinateSpace>()
    .default(REAL_METRE_COORDINATE_SPACE)
    .notNull(),
  sourceHash: varchar("source_hash", { length: 64 }).notNull(),
  createdBy: uuid("created_by").references(() => users.id),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  unique("proposal_versions_proposal_version_unique").on(table.proposalId, table.version),
  index("proposal_versions_proposal_created_idx").on(table.proposalId, table.createdAt),
]);

// ---------------------------------------------------------------------------
// 22c. proposal_status_history — audit trail for proposal transitions.
//
// Shape parallels enquiry_status_history / configuration_review_history so
// the web timeline component renders all three. `changed_by` is nullable for
// system-automatic transitions (expiry sweeps).
// ---------------------------------------------------------------------------

export const proposalStatusHistory = pgTable("proposal_status_history", {
  id: uuid("id").primaryKey().defaultRandom(),
  proposalId: uuid("proposal_id").notNull().references(() => proposals.id, { onDelete: "cascade" }),
  fromStatus: varchar("from_status", { length: 30 }).notNull(),
  toStatus: varchar("to_status", { length: 30 }).notNull(),
  changedBy: uuid("changed_by").references(() => users.id),
  note: text("note"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  index("proposal_status_history_proposal_idx").on(table.proposalId),
]);

// ---------------------------------------------------------------------------
// 22d. proposal_share_tokens / proposal_comments.
//
// `proposal_share_tokens` stores a SHA-256 hash of the bearer token, never the
// token itself. The client URL receives the raw token once when staff generate
// a link. Public reads resolve through the hash and return a client-safe shape.
// ---------------------------------------------------------------------------

export const proposalShareTokens = pgTable("proposal_share_tokens", {
  id: uuid("id").primaryKey().defaultRandom(),
  proposalId: uuid("proposal_id").notNull().references(() => proposals.id, { onDelete: "cascade" }),
  tokenHash: varchar("token_hash", { length: 64 }).notNull().unique(),
  tokenPrefix: varchar("token_prefix", { length: 16 }).notNull(),
  createdBy: uuid("created_by").references(() => users.id, { onDelete: "set null" }),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  expiresAt: timestamp("expires_at", { withTimezone: true }),
  revokedAt: timestamp("revoked_at", { withTimezone: true }),
  lastViewedAt: timestamp("last_viewed_at", { withTimezone: true }),
}, (table) => [
  index("proposal_share_tokens_proposal_idx").on(table.proposalId),
  index("proposal_share_tokens_hash_idx").on(table.tokenHash),
]);

export const proposalComments = pgTable("proposal_comments", {
  id: uuid("id").primaryKey().defaultRandom(),
  proposalId: uuid("proposal_id").notNull().references(() => proposals.id, { onDelete: "cascade" }),
  shareTokenId: uuid("share_token_id").references(() => proposalShareTokens.id, { onDelete: "set null" }),
  kind: varchar("kind", { length: 30 }).notNull().default("comment"),
  authorName: varchar("author_name", { length: 200 }),
  authorEmail: varchar("author_email", { length: 255 }),
  body: text("body").notNull(),
  isClientVisible: boolean("is_client_visible").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  index("proposal_comments_proposal_created_idx").on(table.proposalId, table.createdAt),
  index("proposal_comments_share_token_idx").on(table.shareTokenId),
]);

// ---------------------------------------------------------------------------
// 23. quotes — priced component of a proposal (T-427 phase 1).
//
// Money is integer minor units (pence) ONLY — the services/money.ts exact
// arithmetic contract. No floating-point money columns. A replaced quote is
// marked `superseded` and points at its successor via superseded_by_quote_id
// (coherence CHECK in migration 0026). Venue-scoped, soft-deleted.
// ---------------------------------------------------------------------------

export const quotes = pgTable("quotes", {
  id: uuid("id").primaryKey().defaultRandom(),
  venueId: uuid("venue_id").notNull().references(() => venues.id),
  opportunityId: uuid("opportunity_id").references(() => opportunities.id, { onDelete: "set null" }),
  proposalId: uuid("proposal_id").references(() => proposals.id, { onDelete: "set null" }),
  enquiryId: uuid("enquiry_id").references(() => enquiries.id, { onDelete: "set null" }),
  spaceId: uuid("space_id").references(() => spaces.id, { onDelete: "set null" }),
  name: varchar("name", { length: 200 }).notNull(),
  status: varchar("status", { length: 20 }).notNull().default("draft"),
  currency: varchar("currency", { length: 3 }).notNull().default("GBP"),
  subtotalMinor: integer("subtotal_minor").notNull().default(0),
  totalMinor: integer("total_minor").notNull().default(0),
  validUntil: date("valid_until"),
  supersededByQuoteId: uuid("superseded_by_quote_id").references((): AnyPgColumn => quotes.id, { onDelete: "set null" }),
  notes: text("notes"),
  createdBy: uuid("created_by").references(() => users.id),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  deletedAt: timestamp("deleted_at", { withTimezone: true }),
}, (table) => [
  index("quotes_venue_status_idx").on(table.venueId, table.status),
  index("quotes_opportunity_idx").on(table.opportunityId),
  index("quotes_proposal_idx").on(table.proposalId),
]);

// ---------------------------------------------------------------------------
// 23b. quote_line_items — exact-money line rows.
//
// quantity is an integer so unit × quantity is exact in minor units;
// line_total_minor = unit_amount_minor * quantity is CHECK-enforced in
// migration 0026 (no hidden rounding can be persisted). pricing_rule_id is
// optional provenance back to the pricing engine rule that produced the line.
// ---------------------------------------------------------------------------

export const quoteLineItems = pgTable("quote_line_items", {
  id: uuid("id").primaryKey().defaultRandom(),
  quoteId: uuid("quote_id").notNull().references(() => quotes.id, { onDelete: "cascade" }),
  pricingRuleId: uuid("pricing_rule_id").references(() => pricingRules.id, { onDelete: "set null" }),
  description: text("description").notNull(),
  quantity: integer("quantity").notNull().default(1),
  unitAmountMinor: integer("unit_amount_minor").notNull(),
  lineTotalMinor: integer("line_total_minor").notNull(),
  sortOrder: integer("sort_order").notNull().default(0),
}, (table) => [
  index("quote_line_items_quote_idx").on(table.quoteId, table.sortOrder),
]);

// ---------------------------------------------------------------------------
// 23c. package_selections — commercial package rows surfaced in proposals.
// ---------------------------------------------------------------------------

export const packageSelections = pgTable("package_selections", {
  id: uuid("id").primaryKey().defaultRandom(),
  opportunityId: uuid("opportunity_id").references(() => opportunities.id, { onDelete: "set null" }),
  proposalId: uuid("proposal_id").references(() => proposals.id, { onDelete: "set null" }),
  quoteId: uuid("quote_id").references(() => quotes.id, { onDelete: "set null" }),
  packageKey: varchar("package_key", { length: 120 }).notNull(),
  label: varchar("label", { length: 200 }).notNull(),
  quantity: integer("quantity").notNull().default(1),
  unitAmountMinor: integer("unit_amount_minor").notNull().default(0),
  totalMinor: integer("total_minor").notNull().default(0),
  status: varchar("status", { length: 30 }).notNull().default("draft"),
  notes: text("notes"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  index("package_selections_opportunity_idx").on(table.opportunityId),
  index("package_selections_proposal_idx").on(table.proposalId),
  index("package_selections_quote_idx").on(table.quoteId),
]);

// ---------------------------------------------------------------------------
// 23d. event-plan lifecycle — cross-role change feed and notifications.
//
// These rows connect client proposal activity, planner edits, ops handoff
// changes, and event-day acknowledgement state. They are planning operations
// records only and do not imply safety, legal, accessibility, or occupancy
// approval.
// ---------------------------------------------------------------------------

export const eventPlanChanges = pgTable("event_plan_changes", {
  id: uuid("id").primaryKey().defaultRandom(),
  eventId: uuid("event_id").notNull().references(() => events.id, { onDelete: "cascade" }),
  venueId: uuid("venue_id").notNull().references(() => venues.id, { onDelete: "cascade" }),
  configurationId: uuid("configuration_id").references(() => configurations.id, { onDelete: "set null" }),
  proposalId: uuid("proposal_id").references(() => proposals.id, { onDelete: "set null" }),
  handoffPackId: uuid("handoff_pack_id").references(() => handoffPacks.id, { onDelete: "set null" }),
  actorUserId: uuid("actor_user_id").references(() => users.id, { onDelete: "set null" }),
  actorRole: varchar("actor_role", { length: 30 }).$type<EventPlanAudienceRole>().notNull(),
  actorLabel: varchar("actor_label", { length: 160 }).notNull(),
  sourceKind: varchar("source_kind", { length: 40 }).$type<EventPlanSourceKind>().notNull(),
  sourceId: varchar("source_id", { length: 160 }).notNull(),
  title: varchar("title", { length: 180 }).notNull(),
  summary: text("summary").notNull(),
  beforeSummary: text("before_summary"),
  afterSummary: text("after_summary"),
  affectedSurfaces: jsonb("affected_surfaces").$type<EventPlanChangeSurface[]>().notNull(),
  audienceRoles: jsonb("audience_roles").$type<EventPlanAudienceRole[]>().notNull(),
  riskLevel: varchar("risk_level", { length: 20 }).$type<EventPlanRiskLevel>().notNull().default("attention"),
  requiresHallkeeperAcknowledgement: boolean("requires_hallkeeper_acknowledgement").notNull().default(false),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  index("event_plan_changes_event_created_idx").on(table.eventId, table.createdAt),
  index("event_plan_changes_venue_created_idx").on(table.venueId, table.createdAt),
  index("event_plan_changes_config_idx").on(table.configurationId),
  index("event_plan_changes_proposal_idx").on(table.proposalId),
  index("event_plan_changes_handoff_idx").on(table.handoffPackId),
]);

export const eventPlanNotifications = pgTable("event_plan_notifications", {
  id: uuid("id").primaryKey().defaultRandom(),
  changeId: uuid("change_id").references(() => eventPlanChanges.id, { onDelete: "cascade" }),
  eventId: uuid("event_id").references(() => events.id, { onDelete: "cascade" }),
  venueId: uuid("venue_id").references(() => venues.id, { onDelete: "cascade" }),
  audienceRole: varchar("audience_role", { length: 30 }).$type<EventPlanAudienceRole>().notNull(),
  recipientUserId: uuid("recipient_user_id").references(() => users.id, { onDelete: "cascade" }),
  title: varchar("title", { length: 180 }).notNull(),
  body: text("body").notNull(),
  severity: varchar("severity", { length: 20 }).$type<EventPlanNotificationSeverity>().notNull().default("attention"),
  actionPath: varchar("action_path", { length: 500 }),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  index("event_plan_notifications_change_idx").on(table.changeId),
  index("event_plan_notifications_venue_role_created_idx").on(table.venueId, table.audienceRole, table.createdAt),
  index("event_plan_notifications_recipient_created_idx").on(table.recipientUserId, table.createdAt),
]);

export const eventPlanNotificationReads = pgTable("event_plan_notification_reads", {
  id: uuid("id").primaryKey().defaultRandom(),
  notificationId: uuid("notification_id").notNull().references(() => eventPlanNotifications.id, { onDelete: "cascade" }),
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  readAt: timestamp("read_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  unique("event_plan_notification_reads_unique").on(table.notificationId, table.userId),
  index("event_plan_notification_reads_user_idx").on(table.userId),
]);

export const eventPlanChangeAcknowledgements = pgTable("event_plan_change_acknowledgements", {
  id: uuid("id").primaryKey().defaultRandom(),
  changeId: uuid("change_id").notNull().references(() => eventPlanChanges.id, { onDelete: "cascade" }),
  eventId: uuid("event_id").notNull().references(() => events.id, { onDelete: "cascade" }),
  acknowledgedBy: uuid("acknowledged_by").notNull().references(() => users.id, { onDelete: "cascade" }),
  acknowledgedByRole: varchar("acknowledged_by_role", { length: 30 }).$type<EventPlanAudienceRole>().notNull(),
  note: text("note"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  unique("event_plan_change_ack_user_unique").on(table.changeId, table.acknowledgedBy),
  index("event_plan_change_ack_event_idx").on(table.eventId, table.createdAt),
]);

// ---------------------------------------------------------------------------
// 24. revenue analytics — commercial planning insight.
//
// Money is exact integer minor units. Comfort constraints and review gates are
// persisted alongside scenarios so commercial dashboards cannot hide planning
// limitations or review bottlenecks.
// ---------------------------------------------------------------------------

export const revenueScenarios = pgTable("revenue_scenarios", {
  id: uuid("id").primaryKey().defaultRandom(),
  venueId: uuid("venue_id").notNull().references(() => venues.id),
  eventId: uuid("event_id").references(() => events.id, { onDelete: "set null" }),
  configurationId: uuid("configuration_id").references(() => configurations.id, { onDelete: "set null" }),
  quoteId: uuid("quote_id").references(() => quotes.id, { onDelete: "set null" }),
  name: varchar("name", { length: 500 }).notNull(),
  scenarioKind: varchar("scenario_kind", { length: 40 }).notNull().default("manual"),
  status: varchar("status", { length: 20 }).notNull().default("draft"),
  currency: varchar("currency", { length: 3 }).notNull().default("GBP"),
  plannedGuestCount: integer("planned_guest_count").notNull().default(0),
  estimatedRevenueMinor: integer("estimated_revenue_minor").notNull().default(0),
  estimatedCostMinor: integer("estimated_cost_minor").notNull().default(0),
  estimatedMarginMinor: integer("estimated_margin_minor").notNull().default(0),
  comfortStatus: varchar("comfort_status", { length: 30 }).notNull().default("not_checked"),
  reviewGateCount: integer("review_gate_count").notNull().default(0),
  createdBy: uuid("created_by").references(() => users.id),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  index("revenue_scenarios_venue_status_idx").on(table.venueId, table.status),
  index("revenue_scenarios_event_idx").on(table.eventId),
  index("revenue_scenarios_quote_idx").on(table.quoteId),
]);

export const pricingAssumptions = pgTable("pricing_assumptions", {
  id: uuid("id").primaryKey().defaultRandom(),
  revenueScenarioId: uuid("revenue_scenario_id").notNull().references(() => revenueScenarios.id, { onDelete: "cascade" }),
  key: varchar("key", { length: 120 }).notNull(),
  label: varchar("label", { length: 500 }).notNull(),
  valueMinor: integer("value_minor"),
  valueNumber: numeric("value_number", { precision: 14, scale: 4 }),
  valueText: varchar("value_text", { length: 500 }),
  source: varchar("source", { length: 500 }).notNull(),
  payload: jsonb("payload").$type<PricingAssumptionInput>().notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  index("pricing_assumptions_scenario_idx").on(table.revenueScenarioId),
]);

export const comfortConstraints = pgTable("comfort_constraints", {
  id: uuid("id").primaryKey().defaultRandom(),
  revenueScenarioId: uuid("revenue_scenario_id").notNull().references(() => revenueScenarios.id, { onDelete: "cascade" }),
  constraintType: varchar("constraint_type", { length: 40 }).notNull(),
  label: varchar("label", { length: 500 }).notNull(),
  threshold: numeric("threshold", { precision: 14, scale: 4 }),
  actualValue: numeric("actual_value", { precision: 14, scale: 4 }),
  status: varchar("status", { length: 30 }).notNull(),
  reviewRequired: boolean("review_required").notNull().default(false),
  note: varchar("note", { length: 500 }),
  payload: jsonb("payload").$type<ComfortConstraintInput>().notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  index("comfort_constraints_scenario_status_idx").on(table.revenueScenarioId, table.status),
]);

export const scenarioComparisons = pgTable("scenario_comparisons", {
  id: uuid("id").primaryKey().defaultRandom(),
  venueId: uuid("venue_id").notNull().references(() => venues.id),
  eventId: uuid("event_id").references(() => events.id, { onDelete: "set null" }),
  leftScenarioId: uuid("left_scenario_id").notNull().references(() => revenueScenarios.id, { onDelete: "cascade" }),
  rightScenarioId: uuid("right_scenario_id").notNull().references(() => revenueScenarios.id, { onDelete: "cascade" }),
  currency: varchar("currency", { length: 3 }).notNull().default("GBP"),
  revenueDeltaMinor: integer("revenue_delta_minor").notNull().default(0),
  marginDeltaMinor: integer("margin_delta_minor").notNull().default(0),
  comfortDeltaLabel: varchar("comfort_delta_label", { length: 500 }).notNull(),
  reviewGateDelta: integer("review_gate_delta").notNull().default(0),
  recommendationStatus: varchar("recommendation_status", { length: 30 }).notNull().default("not_checked"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  index("scenario_comparisons_venue_idx").on(table.venueId, table.createdAt),
  index("scenario_comparisons_event_idx").on(table.eventId),
]);

export const analyticsSnapshots = pgTable("analytics_snapshots", {
  id: uuid("id").primaryKey().defaultRandom(),
  venueId: uuid("venue_id").notNull().references(() => venues.id),
  snapshotType: varchar("snapshot_type", { length: 40 }).notNull(),
  payload: jsonb("payload").$type<AnalyticsSnapshotPayload>().notNull(),
  generatedAt: timestamp("generated_at", { withTimezone: true }).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  index("analytics_snapshots_venue_type_idx").on(table.venueId, table.snapshotType, table.createdAt),
]);

// ---------------------------------------------------------------------------
// 25. integration layer — guarded external-system metadata.
//
// These records deliberately store credential references, not credential
// values. Live external calls are out of scope for v0; routes expose redacted
// connection state, safe website embeds, managed email-template metadata, and
// webhook signing stubs.
// ---------------------------------------------------------------------------

export const integrationConnections = pgTable("integration_connections", {
  id: uuid("id").primaryKey().defaultRandom(),
  venueId: uuid("venue_id").notNull().references(() => venues.id),
  provider: varchar("provider", { length: 40 }).notNull(),
  label: varchar("label", { length: 500 }).notNull(),
  status: varchar("status", { length: 30 }).notNull().default("pending_setup"),
  credentialMode: varchar("credential_mode", { length: 30 }).notNull().default("not_configured"),
  credentialRef: varchar("credential_ref", { length: 200 }),
  config: jsonb("config").$type<IntegrationConfig>().notNull().default({}),
  healthStatus: varchar("health_status", { length: 500 }).notNull().default("Not connected"),
  lastCheckedAt: timestamp("last_checked_at", { withTimezone: true }),
  createdBy: uuid("created_by").references(() => users.id),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  index("integration_connections_venue_provider_idx").on(table.venueId, table.provider),
  index("integration_connections_venue_status_idx").on(table.venueId, table.status),
]);

export const webhookEndpoints = pgTable("webhook_endpoints", {
  id: uuid("id").primaryKey().defaultRandom(),
  venueId: uuid("venue_id").notNull().references(() => venues.id),
  integrationConnectionId: uuid("integration_connection_id").references(() => integrationConnections.id, { onDelete: "set null" }),
  label: varchar("label", { length: 500 }).notNull(),
  url: text("url").notNull(),
  eventTypes: jsonb("event_types").$type<string[]>().notNull(),
  status: varchar("status", { length: 30 }).notNull().default("test_only"),
  signingSecretRef: varchar("signing_secret_ref", { length: 200 }),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  index("webhook_endpoints_venue_status_idx").on(table.venueId, table.status),
  index("webhook_endpoints_connection_idx").on(table.integrationConnectionId),
]);

export const externalCalendarLinks = pgTable("external_calendar_links", {
  id: uuid("id").primaryKey().defaultRandom(),
  venueId: uuid("venue_id").notNull().references(() => venues.id),
  integrationConnectionId: uuid("integration_connection_id").references(() => integrationConnections.id, { onDelete: "set null" }),
  calendarLabel: varchar("calendar_label", { length: 500 }).notNull(),
  externalCalendarId: varchar("external_calendar_id", { length: 240 }).notNull(),
  syncDirection: varchar("sync_direction", { length: 30 }).notNull().default("read_only"),
  status: varchar("status", { length: 30 }).notNull().default("pending_setup"),
  lastSyncedAt: timestamp("last_synced_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  index("external_calendar_links_venue_idx").on(table.venueId, table.status),
  index("external_calendar_links_connection_idx").on(table.integrationConnectionId),
]);

export const websiteEmbedConfigs = pgTable("website_embed_configs", {
  id: uuid("id").primaryKey().defaultRandom(),
  venueId: uuid("venue_id").notNull().references(() => venues.id),
  roomId: uuid("room_id").references(() => spaces.id, { onDelete: "set null" }),
  embedKey: varchar("embed_key", { length: 80 }).notNull().unique(),
  venueName: varchar("venue_name", { length: 500 }).notNull(),
  roomName: varchar("room_name", { length: 500 }),
  ctaLabel: varchar("cta_label", { length: 500 }).notNull(),
  ctaUrl: text("cta_url").notNull(),
  safeMode: boolean("safe_mode").notNull().default(true),
  analyticsMode: varchar("analytics_mode", { length: 20 }).notNull().default("stub"),
  status: varchar("status", { length: 20 }).notNull().default("draft"),
  createdBy: uuid("created_by").references(() => users.id),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  index("website_embed_configs_venue_status_idx").on(table.venueId, table.status),
  index("website_embed_configs_room_idx").on(table.roomId),
]);

export const emailTemplates = pgTable("email_templates", {
  id: uuid("id").primaryKey().defaultRandom(),
  venueId: uuid("venue_id").references(() => venues.id, { onDelete: "set null" }),
  templateKey: varchar("template_key", { length: 120 }).notNull(),
  label: varchar("label", { length: 500 }).notNull(),
  subjectTemplate: varchar("subject_template", { length: 500 }).notNull(),
  bodyTemplate: text("body_template").notNull(),
  status: varchar("status", { length: 20 }).notNull().default("draft"),
  managedByCode: boolean("managed_by_code").notNull().default(false),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  unique("email_templates_venue_key_unique").on(table.venueId, table.templateKey),
  index("email_templates_venue_status_idx").on(table.venueId, table.status),
]);

export const integrationEvents = pgTable("integration_events", {
  id: uuid("id").primaryKey().defaultRandom(),
  venueId: uuid("venue_id").notNull().references(() => venues.id),
  integrationConnectionId: uuid("integration_connection_id").references(() => integrationConnections.id, { onDelete: "set null" }),
  direction: varchar("direction", { length: 20 }).notNull(),
  eventType: varchar("event_type", { length: 120 }).notNull(),
  status: varchar("status", { length: 20 }).notNull().default("stubbed"),
  payloadHash: varchar("payload_hash", { length: 64 }).notNull(),
  summary: varchar("summary", { length: 500 }).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  index("integration_events_venue_created_idx").on(table.venueId, table.createdAt),
  index("integration_events_connection_idx").on(table.integrationConnectionId),
]);

// ---------------------------------------------------------------------------
// 26. event mission control — authoritative event-day execution and replay.
//
// The compiled handoff remains immutable. Mission phase/task rows are mutable
// read projections guarded by entity revisions; event_mission_events is the
// append-only audit/replay source. Presence rows are advisory and deliberately
// excluded from replay.
// ---------------------------------------------------------------------------

export const eventMissions = pgTable("event_missions", {
  id: uuid("id").primaryKey().defaultRandom(),
  eventId: uuid("event_id").notNull().references(() => events.id, { onDelete: "cascade" }),
  venueId: uuid("venue_id").notNull().references(() => venues.id, { onDelete: "cascade" }),
  handoffPackId: uuid("handoff_pack_id").notNull().references(() => handoffPacks.id),
  sourceSnapshotHash: varchar("source_snapshot_hash", { length: 64 }).notNull(),
  status: varchar("status", { length: 20 }).$type<EventMissionStatus>().notNull().default("live"),
  baseline: jsonb("baseline").$type<EventMissionBaseline>().notNull(),
  baselineHash: varchar("baseline_hash", { length: 64 }).notNull(),
  lastSequence: bigint("last_sequence", { mode: "number" }).notNull().default(0),
  createdBy: uuid("created_by").references(() => users.id, { onDelete: "set null" }),
  startedAt: timestamp("started_at", { withTimezone: true }).notNull(),
  completedAt: timestamp("completed_at", { withTimezone: true }),
  cancelledAt: timestamp("cancelled_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  unique("event_missions_id_event_unique").on(table.id, table.eventId),
  unique("event_missions_id_event_handoff_unique").on(table.id, table.eventId, table.handoffPackId),
  index("event_missions_event_created_idx").on(table.eventId, table.createdAt),
  index("event_missions_venue_status_idx").on(table.venueId, table.status),
  foreignKey({
    columns: [table.eventId, table.venueId],
    foreignColumns: [events.id, events.venueId],
    name: "event_missions_event_venue_fk",
  }),
  foreignKey({
    columns: [table.eventId, table.handoffPackId],
    foreignColumns: [handoffPacks.eventId, handoffPacks.id],
    name: "event_missions_event_handoff_fk",
  }),
]);

export const eventMissionPhases = pgTable("event_mission_phases", {
  id: uuid("id").primaryKey().defaultRandom(),
  missionId: uuid("mission_id").notNull().references(() => eventMissions.id, { onDelete: "cascade" }),
  eventId: uuid("event_id").notNull().references(() => events.id, { onDelete: "cascade" }),
  phaseId: uuid("phase_id").notNull().references(() => eventPhases.id),
  name: varchar("name", { length: 100 }).notNull(),
  sortOrder: integer("sort_order").notNull(),
  status: varchar("status", { length: 20 }).$type<EventMissionPhaseStatus>().notNull().default("pending"),
  revision: integer("revision").notNull().default(1),
  actualStartedAt: timestamp("actual_started_at", { withTimezone: true }),
  actualEndedAt: timestamp("actual_ended_at", { withTimezone: true }),
  updatedBy: uuid("updated_by").references(() => users.id, { onDelete: "set null" }),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  unique("event_mission_phases_mission_phase_unique").on(table.missionId, table.phaseId),
  unique("event_mission_phases_mission_id_unique").on(table.missionId, table.id),
  index("event_mission_phases_mission_order_idx").on(table.missionId, table.sortOrder),
  foreignKey({
    columns: [table.missionId, table.eventId],
    foreignColumns: [eventMissions.id, eventMissions.eventId],
    name: "event_mission_phases_mission_event_fk",
  }),
  foreignKey({
    columns: [table.eventId, table.phaseId],
    foreignColumns: [eventPhases.eventId, eventPhases.id],
    name: "event_mission_phases_event_phase_fk",
  }),
]);

export const eventMissionTasks = pgTable("event_mission_tasks", {
  id: uuid("id").primaryKey().defaultRandom(),
  missionId: uuid("mission_id").notNull().references(() => eventMissions.id, { onDelete: "cascade" }),
  eventId: uuid("event_id").notNull().references(() => events.id, { onDelete: "cascade" }),
  handoffPackId: uuid("handoff_pack_id").notNull().references(() => handoffPacks.id),
  opsTaskId: uuid("ops_task_id").notNull().references(() => opsTasks.id),
  phaseId: uuid("phase_id").references(() => eventPhases.id, { onDelete: "set null" }),
  kind: varchar("kind", { length: 30 }).$type<EventMissionTask["kind"]>().notNull(),
  title: varchar("title", { length: 240 }).notNull(),
  detail: text("detail").notNull(),
  status: varchar("status", { length: 20 }).$type<EventMissionTask["status"]>().notNull().default("todo"),
  revision: integer("revision").notNull().default(1),
  assignedTo: uuid("assigned_to").references(() => users.id, { onDelete: "set null" }),
  assigneeLabel: varchar("assignee_label", { length: 160 }),
  spatialAnchors: jsonb("spatial_anchors").$type<EventMissionSpatialAnchor[]>().notNull().default([]),
  actualStartedAt: timestamp("actual_started_at", { withTimezone: true }),
  actualEndedAt: timestamp("actual_ended_at", { withTimezone: true }),
  updatedBy: uuid("updated_by").references(() => users.id, { onDelete: "set null" }),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  unique("event_mission_tasks_mission_task_unique").on(table.missionId, table.opsTaskId),
  unique("event_mission_tasks_mission_id_unique").on(table.missionId, table.id),
  index("event_mission_tasks_mission_status_idx").on(table.missionId, table.status),
  index("event_mission_tasks_assignee_idx").on(table.assignedTo),
  foreignKey({
    columns: [table.missionId, table.eventId, table.handoffPackId],
    foreignColumns: [eventMissions.id, eventMissions.eventId, eventMissions.handoffPackId],
    name: "event_mission_tasks_mission_scope_fk",
  }),
  foreignKey({
    columns: [table.handoffPackId, table.opsTaskId],
    foreignColumns: [opsTasks.handoffPackId, opsTasks.id],
    name: "event_mission_tasks_handoff_task_fk",
  }),
  foreignKey({
    columns: [table.eventId, table.phaseId],
    foreignColumns: [eventPhases.eventId, eventPhases.id],
    name: "event_mission_tasks_event_phase_fk",
  }),
]);

export const eventMissionIncidents = pgTable("event_mission_incidents", {
  id: uuid("id").primaryKey().defaultRandom(),
  missionId: uuid("mission_id").notNull().references(() => eventMissions.id, { onDelete: "cascade" }),
  eventId: uuid("event_id").notNull().references(() => events.id, { onDelete: "cascade" }),
  phaseId: uuid("phase_id").references(() => eventPhases.id, { onDelete: "set null" }),
  missionTaskId: uuid("mission_task_id").references(() => eventMissionTasks.id, { onDelete: "set null" }),
  title: varchar("title", { length: 180 }).notNull(),
  detail: text("detail").notNull(),
  status: varchar("status", { length: 20 }).$type<EventMissionIncidentStatus>().notNull().default("open"),
  severity: varchar("severity", { length: 20 }).$type<EventMissionIncidentSeverity>().notNull().default("attention"),
  spatialAnchor: jsonb("spatial_anchor").$type<EventMissionSpatialAnchor | null>(),
  assignedTo: uuid("assigned_to").references(() => users.id, { onDelete: "set null" }),
  reportedBy: uuid("reported_by").references(() => users.id, { onDelete: "set null" }),
  revision: integer("revision").notNull().default(1),
  resolvedAt: timestamp("resolved_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  unique("event_mission_incidents_mission_id_unique").on(table.missionId, table.id),
  index("event_mission_incidents_mission_status_idx").on(table.missionId, table.status),
  foreignKey({
    columns: [table.missionId, table.eventId],
    foreignColumns: [eventMissions.id, eventMissions.eventId],
    name: "event_mission_incidents_mission_event_fk",
  }),
  foreignKey({
    columns: [table.missionId, table.missionTaskId],
    foreignColumns: [eventMissionTasks.missionId, eventMissionTasks.id],
    name: "event_mission_incidents_mission_task_fk",
  }),
  foreignKey({
    columns: [table.eventId, table.phaseId],
    foreignColumns: [eventPhases.eventId, eventPhases.id],
    name: "event_mission_incidents_event_phase_fk",
  }),
]);

export const eventMissionEvents = pgTable("event_mission_events", {
  id: uuid("id").primaryKey().defaultRandom(),
  missionId: uuid("mission_id").notNull().references(() => eventMissions.id, { onDelete: "cascade" }),
  eventId: uuid("event_id").notNull().references(() => events.id, { onDelete: "cascade" }),
  venueId: uuid("venue_id").notNull().references(() => venues.id, { onDelete: "cascade" }),
  sequence: bigint("sequence", { mode: "number" }).notNull(),
  kind: varchar("kind", { length: 40 }).$type<EventMissionEventKind>().notNull(),
  entityType: varchar("entity_type", { length: 30 }).$type<EventMissionEntityType>().notNull(),
  entityId: uuid("entity_id"),
  entityRevision: integer("entity_revision"),
  actorUserId: uuid("actor_user_id").references(() => users.id, { onDelete: "set null" }),
  actorRole: varchar("actor_role", { length: 30 }).$type<EventPlanAudienceRole>().notNull(),
  actorLabel: varchar("actor_label", { length: 160 }).notNull(),
  actorKey: varchar("actor_key", { length: 200 }).notNull(),
  idempotencyKey: varchar("idempotency_key", { length: 160 }).notNull(),
  requiresAcknowledgement: boolean("requires_acknowledgement").notNull().default(false),
  payload: jsonb("payload").$type<EventMissionEventPayload>().notNull(),
  occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  unique("event_mission_events_mission_sequence_unique").on(table.missionId, table.sequence),
  unique("event_mission_events_mission_id_unique").on(table.missionId, table.id),
  unique("event_mission_events_idempotency_unique").on(table.missionId, table.actorKey, table.idempotencyKey),
  index("event_mission_events_mission_created_idx").on(table.missionId, table.createdAt),
  index("event_mission_events_entity_idx").on(table.entityType, table.entityId),
  foreignKey({
    columns: [table.missionId, table.eventId],
    foreignColumns: [eventMissions.id, eventMissions.eventId],
    name: "event_mission_events_mission_event_fk",
  }),
]);

export const eventMissionAcknowledgements = pgTable("event_mission_acknowledgements", {
  id: uuid("id").primaryKey().defaultRandom(),
  missionId: uuid("mission_id").notNull().references(() => eventMissions.id, { onDelete: "cascade" }),
  eventId: uuid("event_id").notNull().references(() => events.id, { onDelete: "cascade" }),
  acknowledgedEventId: uuid("acknowledged_event_id").notNull().references(() => eventMissionEvents.id, { onDelete: "cascade" }),
  acknowledgedBy: uuid("acknowledged_by").notNull().references(() => users.id, { onDelete: "cascade" }),
  acknowledgedByRole: varchar("acknowledged_by_role", { length: 30 }).$type<EventPlanAudienceRole>().notNull(),
  note: text("note"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  unique("event_mission_ack_event_user_unique").on(table.missionId, table.acknowledgedEventId, table.acknowledgedBy),
  index("event_mission_ack_mission_created_idx").on(table.missionId, table.createdAt),
  foreignKey({
    columns: [table.missionId, table.eventId],
    foreignColumns: [eventMissions.id, eventMissions.eventId],
    name: "event_mission_ack_mission_event_fk",
  }),
  foreignKey({
    columns: [table.missionId, table.acknowledgedEventId],
    foreignColumns: [eventMissionEvents.missionId, eventMissionEvents.id],
    name: "event_mission_ack_target_fk",
  }),
]);

export const eventMissionSessions = pgTable("event_mission_sessions", {
  missionId: uuid("mission_id").notNull().references(() => eventMissions.id, { onDelete: "cascade" }),
  sessionId: uuid("session_id").notNull(),
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  displayName: varchar("display_name", { length: 160 }).notNull(),
  role: varchar("role", { length: 30 }).$type<EventPlanAudienceRole>().notNull(),
  activePhaseId: uuid("active_phase_id").references(() => eventPhases.id, { onDelete: "set null" }),
  activeTaskId: uuid("active_task_id").references(() => eventMissionTasks.id, { onDelete: "set null" }),
  view: varchar("view", { length: 20 }).$type<EventMissionPresence["view"]>().notNull().default("board"),
  lastSeenAt: timestamp("last_seen_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  primaryKey({ columns: [table.missionId, table.sessionId, table.userId] }),
  index("event_mission_sessions_active_idx").on(table.missionId, table.lastSeenAt),
  foreignKey({
    columns: [table.missionId, table.activeTaskId],
    foreignColumns: [eventMissionTasks.missionId, eventMissionTasks.id],
    name: "event_mission_sessions_mission_task_fk",
  }),
]);

// ---------------------------------------------------------------------------
// 27. proof-carrying Event Architect.
//
// Every generated candidate is materialised as a real private draft
// configuration in the same transaction as its canonical snapshot and
// validator run. The browser never supplies frozen geometry, timestamps,
// policy references, or evidence digests.
// ---------------------------------------------------------------------------

export const canonicalLayoutSnapshots = pgTable("canonical_layout_snapshots", {
  id: uuid("id").primaryKey(),
  configurationId: uuid("configuration_id").notNull().references(() => configurations.id, { onDelete: "cascade" }),
  venueId: uuid("venue_id").notNull().references(() => venues.id, { onDelete: "cascade" }),
  spaceId: uuid("space_id").notNull().references(() => spaces.id, { onDelete: "cascade" }),
  schemaVersion: varchar("schema_version", { length: 60 }).notNull(),
  snapshotDigest: varchar("snapshot_digest", { length: 64 }).notNull(),
  sourceKind: varchar("source_kind", { length: 40 }).notNull().default("event_architect_candidate"),
  payload: jsonb("payload").$type<CanonicalLayoutSnapshotV0>().notNull(),
  createdBy: uuid("created_by").references(() => users.id, { onDelete: "set null" }),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  unique("canonical_layout_snapshots_config_unique").on(table.configurationId),
  unique("canonical_layout_snapshots_digest_unique").on(table.snapshotDigest),
  index("canonical_layout_snapshots_venue_created_idx").on(table.venueId, table.createdAt),
  index("canonical_layout_snapshots_space_created_idx").on(table.spaceId, table.createdAt),
]);

export const layoutValidationRuns = pgTable("layout_validation_runs", {
  id: uuid("id").primaryKey(),
  snapshotId: uuid("snapshot_id").notNull().references(() => canonicalLayoutSnapshots.id, { onDelete: "cascade" }),
  snapshotDigest: varchar("snapshot_digest", { length: 64 }).notNull(),
  validatorVersion: varchar("validator_version", { length: 40 }).notNull(),
  validatorDigest: varchar("validator_digest", { length: 64 }).notNull(),
  contextDigest: varchar("context_digest", { length: 64 }).notNull(),
  proofDigest: varchar("proof_digest", { length: 64 }).notNull(),
  payload: jsonb("payload").$type<LayoutValidatorRun>().notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  unique("layout_validation_runs_snapshot_unique").on(table.snapshotId),
  unique("layout_validation_runs_proof_unique").on(table.proofDigest),
  index("layout_validation_runs_snapshot_digest_idx").on(table.snapshotDigest),
]);

export const eventArchitectRuns = pgTable("event_architect_runs", {
  id: uuid("id").primaryKey(),
  venueId: uuid("venue_id").notNull().references(() => venues.id, { onDelete: "cascade" }),
  spaceId: uuid("space_id").notNull().references(() => spaces.id, { onDelete: "cascade" }),
  createdBy: uuid("created_by").notNull().references(() => users.id, { onDelete: "cascade" }),
  idempotencyKey: varchar("idempotency_key", { length: 160 }).notNull(),
  requestDigest: varchar("request_digest", { length: 64 }).notNull(),
  engineVersion: varchar("engine_version", { length: 40 }).notNull(),
  engineDigest: varchar("engine_digest", { length: 64 }).notNull(),
  requestPayload: jsonb("request_payload").$type<EventArchitectRequest>().notNull(),
  runPayload: jsonb("run_payload").$type<EventArchitectRun>().notNull(),
  selectedCandidateId: uuid("selected_candidate_id"),
  selectedConfigurationId: uuid("selected_configuration_id").references(() => configurations.id, { onDelete: "set null" }),
  selectedSnapshotDigest: varchar("selected_snapshot_digest", { length: 64 }),
  selectedProofDigest: varchar("selected_proof_digest", { length: 64 }),
  selectionIdempotencyKey: varchar("selection_idempotency_key", { length: 160 }),
  selectedBy: uuid("selected_by").references(() => users.id, { onDelete: "set null" }),
  selectedAt: timestamp("selected_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  unique("event_architect_runs_actor_idempotency_unique").on(table.createdBy, table.idempotencyKey),
  index("event_architect_runs_venue_created_idx").on(table.venueId, table.createdAt),
  index("event_architect_runs_space_created_idx").on(table.spaceId, table.createdAt),
]);

export const eventArchitectCandidates = pgTable("event_architect_candidates", {
  id: uuid("id").primaryKey(),
  runId: uuid("run_id").notNull().references(() => eventArchitectRuns.id, { onDelete: "cascade" }),
  rank: integer("rank").notNull(),
  strategy: varchar("strategy", { length: 40 }).$type<EventArchitectStrategy>().notNull(),
  configurationId: uuid("configuration_id").notNull().references(() => configurations.id, { onDelete: "cascade" }),
  snapshotId: uuid("snapshot_id").notNull().references(() => canonicalLayoutSnapshots.id, { onDelete: "cascade" }),
  validationRunId: uuid("validation_run_id").notNull().references(() => layoutValidationRuns.id, { onDelete: "cascade" }),
  snapshotDigest: varchar("snapshot_digest", { length: 64 }).notNull(),
  proofDigest: varchar("proof_digest", { length: 64 }).notNull(),
  payload: jsonb("payload").$type<EventArchitectCandidate>().notNull(),
  selectedBy: uuid("selected_by").references(() => users.id, { onDelete: "set null" }),
  selectedAt: timestamp("selected_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  unique("event_architect_candidates_run_rank_unique").on(table.runId, table.rank),
  unique("event_architect_candidates_configuration_unique").on(table.configurationId),
  unique("event_architect_candidates_snapshot_unique").on(table.snapshotId),
  unique("event_architect_candidates_validation_unique").on(table.validationRunId),
  index("event_architect_candidates_run_strategy_idx").on(table.runId, table.strategy),
]);
