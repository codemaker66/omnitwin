import { sql } from "drizzle-orm";
import {
  pgTable,
  uuid,
  varchar,
  char,
  text,
  timestamp,
  numeric,
  jsonb,
  integer,
  bigint,
  boolean,
  date,
  index,
  uniqueIndex,
  unique,
  foreignKey,
  primaryKey,
  customType,
  type AnyPgColumn,
} from "drizzle-orm/pg-core";
import type {
  AgentTrajectory,
  AnalyticsSnapshotPayload,
  BookingKind,
  BookingLiveness,
  BookingState,
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
  EventArchitectOpsEvidenceWitness,
  EventArchitectOpsReviewDecision,
  EventArchitectOpsReviewerAuthority,
  EventArchitectRequest,
  EventArchitectRun,
  EventArchitectStrategy,
  LayoutValidatorRun,
  PricingAssumptionInput,
  ProposalVersionPayload,
  ReconstructionQaReport,
  ReconstructionReleaseArtifactRef,
  ReconstructionReleaseManifest,
  ReconstructionVisualEvidence,
  RuntimePackageManifestJson,
  RuntimePackageRevisionIdentityKind,
  RuntimeQaRecordV0,
  TransformArtifactV0,
} from "@omnitwin/types";

const bytea = customType<{ data: Buffer; driverData: Buffer }>({
  dataType: () => "bytea",
});
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
  // Composite identity for tenant-integrity FKs (bookings_space_venue_fk) —
  // the same move migration 0046 made on events. Added by migration 0050.
  unique("spaces_id_venue_unique").on(table.id, table.venueId),
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
  revision: integer("revision").notNull(),
  identityKind: varchar("identity_kind", { length: 24 })
    .$type<RuntimePackageRevisionIdentityKind>()
    .notNull(),
  contentDigest: varchar("content_digest", { length: 64 }),
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
  unique("runtime_packages_venue_room_revision_unique").on(
    table.venueSlug,
    table.roomSlug,
    table.revision,
  ),
  unique("runtime_packages_venue_room_digest_unique").on(
    table.venueSlug,
    table.roomSlug,
    table.contentDigest,
  ),
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
  // CRM spine linkage (Canon §2.4, T-487) — events join the Sell→Hold journey
  // instead of floating free of the pipeline. clientName stays as the legacy
  // denormalised label; these FKs are authoritative where present.
  clientAccountId: uuid("client_account_id").references(() => clientAccounts.id, { onDelete: "set null" }),
  opportunityId: uuid("opportunity_id").references(() => opportunities.id, { onDelete: "set null" }),
  // Headcount triple (Canon §2.4, R2): guaranteed = contract floor, expected
  // = working number, setFor = what the room is physically set for. The
  // legacy single guestCount remains for existing consumers.
  headcountGuaranteed: integer("headcount_guaranteed"),
  headcountExpected: integer("headcount_expected"),
  headcountSetFor: integer("headcount_set_for"),
  notes: text("notes"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  deletedAt: timestamp("deleted_at", { withTimezone: true }),
}, (table) => [
  unique("events_id_venue_unique").on(table.id, table.venueId),
  index("events_venue_status_idx").on(table.venueId, table.status),
  index("events_created_by_idx").on(table.createdBy),
  index("events_client_account_idx").on(table.clientAccountId),
  index("events_opportunity_idx").on(table.opportunityId),
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
  // Keystone Diary migration (Canon §2.3, T-487): phases become room-scoped —
  // the Occupancy Footprint. Nullable: existing rows stay venue-global and
  // are excluded from room lanes until scoped.
  spaceId: uuid("space_id").references(() => spaces.id, { onDelete: "set null" }),
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
  index("event_phases_space_idx").on(table.spaceId),
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
  unique("event_architect_candidates_id_run_unique").on(table.id, table.runId),
  unique("event_architect_candidates_run_rank_unique").on(table.runId, table.rank),
  unique("event_architect_candidates_configuration_unique").on(table.configurationId),
  unique("event_architect_candidates_snapshot_unique").on(table.snapshotId),
  unique("event_architect_candidates_validation_unique").on(table.validationRunId),
  index("event_architect_candidates_run_strategy_idx").on(table.runId, table.strategy),
]);

// Append-only venue review evidence that can resolve the Event Architect
// guest-flow gate at the Ops Compiler boundary. Application code never updates
// or deletes these rows; migration 0048 enforces the same rule with triggers.
export const eventArchitectOpsReviews = pgTable("event_architect_ops_reviews", {
  id: uuid("id").primaryKey().defaultRandom(),
  candidateId: uuid("candidate_id").notNull(),
  runId: uuid("run_id").notNull(),
  venueId: uuid("venue_id").notNull().references(() => venues.id, { onDelete: "restrict" }),
  configurationId: uuid("configuration_id").notNull().references(() => configurations.id, { onDelete: "restrict" }),
  reviewerUserId: uuid("reviewer_user_id").notNull().references(() => users.id, { onDelete: "restrict" }),
  reviewerAuthority: varchar("reviewer_authority", { length: 40 }).$type<EventArchitectOpsReviewerAuthority>().notNull(),
  idempotencyKey: varchar("idempotency_key", { length: 160 }).notNull(),
  decision: varchar("decision", { length: 20 }).$type<EventArchitectOpsReviewDecision>().notNull(),
  requestDigest: varchar("request_digest", { length: 64 }).notNull(),
  snapshotDigest: varchar("snapshot_digest", { length: 64 }).notNull(),
  proofDigest: varchar("proof_digest", { length: 64 }).notNull(),
  guestFlowArtifactHash: varchar("guest_flow_artifact_hash", { length: 64 }).notNull(),
  artifactDigest: varchar("artifact_digest", { length: 64 }).notNull(),
  witnesses: jsonb("witnesses").$type<readonly EventArchitectOpsEvidenceWitness[]>().notNull(),
  note: text("note").notNull(),
  reviewedAt: timestamp("reviewed_at", { withTimezone: true }).notNull(),
  validUntil: timestamp("valid_until", { withTimezone: true }).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  unique("event_architect_ops_reviews_artifact_digest_unique").on(table.artifactDigest),
  unique("event_architect_ops_reviews_reviewer_idempotency_unique").on(
    table.candidateId,
    table.reviewerUserId,
    table.idempotencyKey,
  ),
  index("event_architect_ops_reviews_candidate_reviewed_idx").on(table.candidateId, table.reviewedAt),
  index("event_architect_ops_reviews_valid_until_idx").on(table.validUntil),
  foreignKey({
    columns: [table.candidateId, table.runId],
    foreignColumns: [eventArchitectCandidates.id, eventArchitectCandidates.runId],
    name: "event_architect_ops_reviews_candidate_run_fk",
  }),
]);

// Evidence-to-Runtime Reconstruction Foundry. All records below except the
// channel pointer are made append-only by migration 0049.
export const reconstructionReleases = pgTable("reconstruction_releases", {
  id: uuid("id").primaryKey().defaultRandom(),
  venueSlug: varchar("venue_slug", { length: 100 }).notNull(),
  releaseKind: varchar("release_kind", { length: 40 }).$type<"venue_twin_v1">().notNull(),
  releaseDigest: varchar("release_digest", { length: 64 }).notNull(),
  sourceManifestSha256: varchar("source_manifest_sha256", { length: 64 }).notNull(),
  releaseManifestSha256: varchar("release_manifest_sha256", { length: 64 }).notNull(),
  candidateBucket: varchar("candidate_bucket", { length: 255 }).notNull(),
  candidatePrefix: text("candidate_prefix").notNull(),
  releaseManifestKey: text("release_manifest_key").notNull(),
  fileCount: integer("file_count").notNull(),
  totalBytes: bigint("total_bytes", { mode: "number" }).notNull(),
  manifestJson: jsonb("manifest_json").$type<ReconstructionReleaseManifest>().notNull(),
  idempotencyKey: varchar("idempotency_key", { length: 160 }).notNull(),
  requestDigest: varchar("request_digest", { length: 64 }).notNull(),
  createdBy: uuid("created_by").notNull().references(() => users.id, { onDelete: "restrict" }),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  unique("reconstruction_releases_venue_kind_digest_unique").on(table.venueSlug, table.releaseKind, table.releaseDigest),
  unique("reconstruction_releases_manifest_key_unique").on(table.candidateBucket, table.releaseManifestKey),
  unique("reconstruction_releases_actor_idempotency_unique").on(table.createdBy, table.idempotencyKey),
  unique("reconstruction_releases_id_venue_kind_unique").on(table.id, table.venueSlug, table.releaseKind),
  unique("reconstruction_releases_id_scope_digest_unique").on(table.id, table.venueSlug, table.releaseKind, table.releaseDigest),
  unique("reconstruction_releases_id_scope_digest_manifest_unique").on(table.id, table.venueSlug, table.releaseKind, table.releaseDigest, table.releaseManifestSha256),
  unique("reconstruction_releases_id_scope_digest_source_unique").on(table.id, table.venueSlug, table.releaseKind, table.releaseDigest, table.sourceManifestSha256),
  unique("reconstruction_releases_id_digest_manifest_unique").on(table.id, table.releaseDigest, table.releaseManifestSha256),
  unique("reconstruction_releases_id_digest_source_unique").on(table.id, table.releaseDigest, table.sourceManifestSha256),
  index("reconstruction_releases_venue_created_idx").on(table.venueSlug, table.createdAt),
]);

export const reconstructionReleaseQaRuns = pgTable("reconstruction_release_qa_runs", {
  id: uuid("id").primaryKey().defaultRandom(),
  releaseId: uuid("release_id").notNull(),
  venueSlug: varchar("venue_slug", { length: 100 }).notNull(),
  releaseKind: varchar("release_kind", { length: 40 }).$type<"venue_twin_v1">().notNull(),
  qaProfileVersion: varchar("qa_profile_version", { length: 80 }).notNull(),
  qaProfileDigest: varchar("qa_profile_digest", { length: 64 }).notNull(),
  outcome: varchar("outcome", { length: 20 }).$type<"passed" | "failed">().notNull(),
  reportDigest: varchar("report_digest", { length: 64 }).notNull(),
  reportKey: text("report_key").notNull(),
  reportJson: jsonb("report_json").$type<ReconstructionQaReport>().notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  foreignKey({
    columns: [table.releaseId, table.venueSlug, table.releaseKind],
    foreignColumns: [reconstructionReleases.id, reconstructionReleases.venueSlug, reconstructionReleases.releaseKind],
    name: "reconstruction_qa_release_fk",
  }).onDelete("restrict"),
  unique("reconstruction_qa_release_report_unique").on(table.releaseId, table.reportDigest),
  unique("reconstruction_qa_id_release_unique").on(table.id, table.releaseId),
  unique("reconstruction_qa_id_release_report_unique").on(table.id, table.releaseId, table.reportDigest),
  unique("reconstruction_qa_release_scope_report_unique").on(table.releaseId, table.venueSlug, table.releaseKind, table.reportDigest),
  unique("reconstruction_qa_id_release_scope_report_unique").on(table.id, table.releaseId, table.venueSlug, table.releaseKind, table.reportDigest),
  index("reconstruction_qa_release_created_idx").on(table.releaseId, table.createdAt),
]);

export const reconstructionReleaseReviews = pgTable("reconstruction_release_reviews", {
  id: uuid("id").primaryKey().defaultRandom(),
  releaseId: uuid("release_id").notNull(),
  qaRunId: uuid("qa_run_id").notNull(),
  venueSlug: varchar("venue_slug", { length: 100 }).notNull(),
  releaseKind: varchar("release_kind", { length: 40 }).$type<"venue_twin_v1">().notNull(),
  reviewerUserId: uuid("reviewer_user_id").notNull().references(() => users.id, { onDelete: "restrict" }),
  reviewerAuthority: varchar("reviewer_authority", { length: 40 }).$type<"platform_admin">().notNull(),
  decision: varchar("decision", { length: 20 }).$type<"approved" | "rejected">().notNull(),
  targetExposure: varchar("target_exposure", { length: 30 }).$type<"expert_review" | "public">().notNull(),
  releaseDigest: varchar("release_digest", { length: 64 }).notNull(),
  releaseManifestSha256: varchar("release_manifest_sha256", { length: 64 }).notNull(),
  qaReportDigest: varchar("qa_report_digest", { length: 64 }).notNull(),
  visualEvidence: jsonb("visual_evidence").$type<readonly ReconstructionVisualEvidence[]>().notNull(),
  transformArtifactRefs: jsonb("transform_artifact_refs").$type<readonly ReconstructionReleaseArtifactRef[]>().notNull().default([]),
  sceneAuthorityRefs: jsonb("scene_authority_refs").$type<readonly ReconstructionReleaseArtifactRef[]>().notNull().default([]),
  note: text("note").notNull(),
  idempotencyKey: varchar("idempotency_key", { length: 160 }).notNull(),
  requestDigest: varchar("request_digest", { length: 64 }).notNull(),
  reviewSequence: integer("review_sequence").notNull(),
  supersedesReviewId: uuid("supersedes_review_id"),
  reviewedAt: timestamp("reviewed_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  foreignKey({
    columns: [table.releaseId, table.venueSlug, table.releaseKind],
    foreignColumns: [reconstructionReleases.id, reconstructionReleases.venueSlug, reconstructionReleases.releaseKind],
    name: "reconstruction_reviews_release_fk",
  }).onDelete("restrict"),
  foreignKey({
    columns: [table.releaseId, table.venueSlug, table.releaseKind, table.releaseDigest, table.releaseManifestSha256],
    foreignColumns: [reconstructionReleases.id, reconstructionReleases.venueSlug, reconstructionReleases.releaseKind, reconstructionReleases.releaseDigest, reconstructionReleases.releaseManifestSha256],
    name: "reconstruction_reviews_release_digest_fk",
  }).onDelete("restrict"),
  foreignKey({
    columns: [table.qaRunId, table.releaseId, table.venueSlug, table.releaseKind, table.qaReportDigest],
    foreignColumns: [reconstructionReleaseQaRuns.id, reconstructionReleaseQaRuns.releaseId, reconstructionReleaseQaRuns.venueSlug, reconstructionReleaseQaRuns.releaseKind, reconstructionReleaseQaRuns.reportDigest],
    name: "reconstruction_reviews_qa_fk",
  }).onDelete("restrict"),
  foreignKey({
    columns: [table.supersedesReviewId, table.releaseId],
    foreignColumns: [table.id, table.releaseId],
    name: "reconstruction_reviews_supersedes_release_fk",
  }).onDelete("restrict"),
  unique("reconstruction_reviews_reviewer_idempotency_unique").on(table.reviewerUserId, table.idempotencyKey),
  unique("reconstruction_reviews_release_sequence_unique").on(table.releaseId, table.reviewSequence),
  unique("reconstruction_reviews_release_supersedes_unique").on(table.releaseId, table.supersedesReviewId),
  unique("reconstruction_reviews_id_release_unique").on(table.id, table.releaseId),
  unique("reconstruction_reviews_id_release_digest_unique").on(table.id, table.releaseId, table.requestDigest),
  unique("reconstruction_reviews_id_exact_evidence_unique").on(table.id, table.releaseId, table.venueSlug, table.releaseKind, table.releaseDigest, table.qaReportDigest, table.requestDigest),
  index("reconstruction_reviews_release_reviewed_idx").on(table.releaseId, table.reviewedAt),
]);

export const reconstructionReviewEvidenceArtifacts = pgTable("reconstruction_review_evidence_artifacts", {
  id: uuid("id").primaryKey().defaultRandom(),
  venueSlug: varchar("venue_slug", { length: 100 }).notNull(),
  artifactKind: varchar("artifact_kind", { length: 50 }).$type<"transform_artifact_v0" | "scene_authority_map_v0">().notNull(),
  artifactId: varchar("artifact_id", { length: 160 }).notNull(),
  artifactDigest: varchar("artifact_digest", { length: 64 }).notNull(),
  objectKey: text("object_key").notNull(),
  objectSha256: varchar("object_sha256", { length: 64 }).notNull(),
  sizeBytes: bigint("size_bytes", { mode: "number" }).notNull(),
  schemaVersion: varchar("schema_version", { length: 80 }).notNull(),
  idempotencyKey: varchar("idempotency_key", { length: 160 }).notNull(),
  requestDigest: varchar("request_digest", { length: 64 }).notNull(),
  registeredBy: uuid("registered_by").notNull().references(() => users.id, { onDelete: "restrict" }),
  registeredAt: timestamp("registered_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  unique("reconstruction_review_evidence_venue_kind_id_digest_unique").on(
    table.venueSlug,
    table.artifactKind,
    table.artifactId,
    table.artifactDigest,
  ),
  unique("reconstruction_review_evidence_actor_idempotency_unique").on(
    table.registeredBy,
    table.idempotencyKey,
  ),
  index("reconstruction_review_evidence_venue_kind_registered_idx").on(
    table.venueSlug,
    table.artifactKind,
    table.registeredAt,
  ),
  index("reconstruction_review_evidence_object_digest_idx").on(table.objectSha256),
]);

export const reconstructionReleaseAttestations = pgTable("reconstruction_release_attestations", {
  id: uuid("id").primaryKey().defaultRandom(),
  releaseId: uuid("release_id").notNull(),
  venueSlug: varchar("venue_slug", { length: 100 }).notNull(),
  releaseKind: varchar("release_kind", { length: 40 }).$type<"venue_twin_v1">().notNull(),
  attestationType: varchar("attestation_type", { length: 50 }).$type<"in_toto_dsse_ed25519">().notNull(),
  releaseDigest: varchar("release_digest", { length: 64 }).notNull(),
  qaReportDigest: varchar("qa_report_digest", { length: 64 }).notNull(),
  reviewId: uuid("review_id").notNull(),
  reviewDigest: varchar("review_digest", { length: 64 }).notNull(),
  keyId: varchar("key_id", { length: 160 }).notNull(),
  publicKeyFingerprint: varchar("public_key_fingerprint", { length: 64 }).notNull(),
  statementSha256: varchar("statement_sha256", { length: 64 }).notNull(),
  envelopeSha256: varchar("envelope_sha256", { length: 64 }).notNull(),
  r2Key: text("r2_key").notNull(),
  idempotencyKey: varchar("idempotency_key", { length: 160 }).notNull(),
  requestDigest: varchar("request_digest", { length: 64 }).notNull(),
  verifiedBy: uuid("verified_by").notNull().references(() => users.id, { onDelete: "restrict" }),
  verifiedAt: timestamp("verified_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  foreignKey({
    columns: [table.releaseId, table.venueSlug, table.releaseKind, table.releaseDigest],
    foreignColumns: [reconstructionReleases.id, reconstructionReleases.venueSlug, reconstructionReleases.releaseKind, reconstructionReleases.releaseDigest],
    name: "reconstruction_attestations_release_fk",
  }).onDelete("restrict"),
  foreignKey({
    columns: [table.releaseId, table.venueSlug, table.releaseKind, table.qaReportDigest],
    foreignColumns: [reconstructionReleaseQaRuns.releaseId, reconstructionReleaseQaRuns.venueSlug, reconstructionReleaseQaRuns.releaseKind, reconstructionReleaseQaRuns.reportDigest],
    name: "reconstruction_attestations_qa_fk",
  }).onDelete("restrict"),
  unique("reconstruction_attestations_release_envelope_unique").on(table.releaseId, table.envelopeSha256),
  unique("reconstruction_attestations_release_key_unique").on(table.releaseId, table.r2Key),
  unique("reconstruction_attestations_actor_idempotency_unique").on(table.verifiedBy, table.idempotencyKey),
  unique("reconstruction_attestations_id_release_unique").on(table.id, table.releaseId),
  unique("reconstruction_attestations_id_release_envelope_unique").on(table.id, table.releaseId, table.envelopeSha256),
  unique("reconstruction_attestations_id_exact_evidence_unique").on(
    table.id,
    table.releaseId,
    table.venueSlug,
    table.releaseKind,
    table.releaseDigest,
    table.qaReportDigest,
    table.reviewId,
    table.reviewDigest,
    table.envelopeSha256,
  ),
  foreignKey({
    columns: [table.reviewId, table.releaseId, table.venueSlug, table.releaseKind, table.releaseDigest, table.qaReportDigest, table.reviewDigest],
    foreignColumns: [reconstructionReleaseReviews.id, reconstructionReleaseReviews.releaseId, reconstructionReleaseReviews.venueSlug, reconstructionReleaseReviews.releaseKind, reconstructionReleaseReviews.releaseDigest, reconstructionReleaseReviews.qaReportDigest, reconstructionReleaseReviews.requestDigest],
    name: "reconstruction_attestations_review_fk",
  }).onDelete("restrict"),
  index("reconstruction_attestations_release_verified_idx").on(table.releaseId, table.verifiedAt),
]);

export const reconstructionReleasePublications = pgTable("reconstruction_release_publications", {
  id: uuid("id").primaryKey().defaultRandom(),
  releaseId: uuid("release_id").notNull(),
  venueSlug: varchar("venue_slug", { length: 100 }).notNull(),
  releaseKind: varchar("release_kind", { length: 40 }).$type<"venue_twin_v1">().notNull(),
  releaseDigest: varchar("release_digest", { length: 64 }).notNull(),
  qaReportDigest: varchar("qa_report_digest", { length: 64 }).notNull(),
  reviewId: uuid("review_id").notNull(),
  reviewDigest: varchar("review_digest", { length: 64 }).notNull(),
  attestationId: uuid("attestation_id").notNull(),
  attestationEnvelopeSha256: varchar("attestation_envelope_sha256", { length: 64 }).notNull(),
  idempotencyKey: varchar("idempotency_key", { length: 160 }).notNull(),
  requestDigest: varchar("request_digest", { length: 64 }).notNull(),
  note: text("note").notNull(),
  candidatePrefix: text("candidate_prefix").notNull(),
  releaseBucket: varchar("release_bucket", { length: 255 }).notNull(),
  releasePrefix: text("release_prefix").notNull(),
  publicManifestKey: text("public_manifest_key").notNull(),
  publicBaseUrl: text("public_base_url").notNull(),
  manifestUrl: text("manifest_url").notNull(),
  manifestSha256: varchar("manifest_sha256", { length: 64 }).notNull(),
  verificationDigest: varchar("verification_digest", { length: 64 }).notNull(),
  objectCount: integer("object_count").notNull(),
  totalBytes: bigint("total_bytes", { mode: "number" }).notNull(),
  publishedBy: uuid("published_by").notNull().references(() => users.id, { onDelete: "restrict" }),
  publishedAt: timestamp("published_at", { withTimezone: true }).defaultNow().notNull(),
  verifiedAt: timestamp("verified_at", { withTimezone: true }).notNull(),
}, (table) => [
  foreignKey({
    columns: [table.releaseId, table.venueSlug, table.releaseKind, table.releaseDigest],
    foreignColumns: [reconstructionReleases.id, reconstructionReleases.venueSlug, reconstructionReleases.releaseKind, reconstructionReleases.releaseDigest],
    name: "reconstruction_publications_release_fk",
  }).onDelete("restrict"),
  unique("reconstruction_publications_release_review_attestation_unique").on(table.releaseId, table.reviewId, table.attestationId),
  unique("reconstruction_publications_id_release_scope_digest_unique").on(table.id, table.releaseId, table.venueSlug, table.releaseKind, table.releaseDigest),
  unique("reconstruction_publications_actor_idempotency_unique").on(table.publishedBy, table.idempotencyKey),
  index("reconstruction_publications_release_published_idx").on(table.releaseId, table.publishedAt),
  index("reconstruction_publications_prefix_idx").on(table.releaseBucket, table.releasePrefix),
  foreignKey({
    columns: [table.releaseId, table.venueSlug, table.releaseKind, table.releaseDigest, table.manifestSha256],
    foreignColumns: [reconstructionReleases.id, reconstructionReleases.venueSlug, reconstructionReleases.releaseKind, reconstructionReleases.releaseDigest, reconstructionReleases.sourceManifestSha256],
    name: "reconstruction_publications_release_digest_fk",
  }).onDelete("restrict"),
  foreignKey({
    columns: [table.releaseId, table.venueSlug, table.releaseKind, table.qaReportDigest],
    foreignColumns: [reconstructionReleaseQaRuns.releaseId, reconstructionReleaseQaRuns.venueSlug, reconstructionReleaseQaRuns.releaseKind, reconstructionReleaseQaRuns.reportDigest],
    name: "reconstruction_publications_qa_fk",
  }).onDelete("restrict"),
  foreignKey({
    columns: [table.reviewId, table.releaseId, table.venueSlug, table.releaseKind, table.releaseDigest, table.qaReportDigest, table.reviewDigest],
    foreignColumns: [reconstructionReleaseReviews.id, reconstructionReleaseReviews.releaseId, reconstructionReleaseReviews.venueSlug, reconstructionReleaseReviews.releaseKind, reconstructionReleaseReviews.releaseDigest, reconstructionReleaseReviews.qaReportDigest, reconstructionReleaseReviews.requestDigest],
    name: "reconstruction_publications_review_fk",
  }).onDelete("restrict"),
  foreignKey({
    columns: [table.attestationId, table.releaseId, table.venueSlug, table.releaseKind, table.releaseDigest, table.qaReportDigest, table.reviewId, table.reviewDigest, table.attestationEnvelopeSha256],
    foreignColumns: [reconstructionReleaseAttestations.id, reconstructionReleaseAttestations.releaseId, reconstructionReleaseAttestations.venueSlug, reconstructionReleaseAttestations.releaseKind, reconstructionReleaseAttestations.releaseDigest, reconstructionReleaseAttestations.qaReportDigest, reconstructionReleaseAttestations.reviewId, reconstructionReleaseAttestations.reviewDigest, reconstructionReleaseAttestations.envelopeSha256],
    name: "reconstruction_publications_attestation_fk",
  }).onDelete("restrict"),
]);

export const reconstructionReleaseChannels = pgTable("reconstruction_release_channels", {
  id: uuid("id").primaryKey().defaultRandom(),
  venueSlug: varchar("venue_slug", { length: 100 }).notNull(),
  releaseKind: varchar("release_kind", { length: 40 }).$type<"venue_twin_v1">().notNull(),
  channel: varchar("channel", { length: 30 }).$type<"production">().notNull(),
  activeReleaseId: uuid("active_release_id").notNull(),
  activeReleaseDigest: varchar("active_release_digest", { length: 64 }).notNull(),
  activePublicationId: uuid("active_publication_id").notNull(),
  revision: integer("revision").notNull(),
  updatedBy: uuid("updated_by").notNull().references(() => users.id, { onDelete: "restrict" }),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  unique("reconstruction_channels_venue_kind_channel_unique").on(table.venueSlug, table.releaseKind, table.channel),
  unique("reconstruction_channels_id_scope_unique").on(table.id, table.venueSlug, table.releaseKind, table.channel),
  foreignKey({
    columns: [table.activeReleaseId, table.venueSlug, table.releaseKind, table.activeReleaseDigest],
    foreignColumns: [reconstructionReleases.id, reconstructionReleases.venueSlug, reconstructionReleases.releaseKind, reconstructionReleases.releaseDigest],
    name: "reconstruction_channels_active_release_fk",
  }).onDelete("restrict"),
  foreignKey({
    columns: [table.activePublicationId, table.activeReleaseId, table.venueSlug, table.releaseKind, table.activeReleaseDigest],
    foreignColumns: [reconstructionReleasePublications.id, reconstructionReleasePublications.releaseId, reconstructionReleasePublications.venueSlug, reconstructionReleasePublications.releaseKind, reconstructionReleasePublications.releaseDigest],
    name: "reconstruction_channels_active_publication_fk",
  }).onDelete("restrict"),
]);

export const reconstructionReleaseChannelEvents = pgTable("reconstruction_release_channel_events", {
  id: uuid("id").primaryKey().defaultRandom(),
  channelId: uuid("channel_id").notNull(),
  venueSlug: varchar("venue_slug", { length: 100 }).notNull(),
  releaseKind: varchar("release_kind", { length: 40 }).$type<"venue_twin_v1">().notNull(),
  channel: varchar("channel", { length: 30 }).$type<"production">().notNull(),
  action: varchar("action", { length: 20 }).$type<"promote" | "rollback">().notNull(),
  fromReleaseId: uuid("from_release_id"),
  fromReleaseDigest: varchar("from_release_digest", { length: 64 }),
  fromPublicationId: uuid("from_publication_id"),
  toReleaseId: uuid("to_release_id").notNull(),
  toReleaseDigest: varchar("to_release_digest", { length: 64 }).notNull(),
  toPublicationId: uuid("to_publication_id").notNull(),
  expectedRevision: integer("expected_revision").notNull(),
  resultingRevision: integer("resulting_revision").notNull(),
  actorUserId: uuid("actor_user_id").notNull().references(() => users.id, { onDelete: "restrict" }),
  idempotencyKey: varchar("idempotency_key", { length: 160 }).notNull(),
  requestDigest: varchar("request_digest", { length: 64 }).notNull(),
  reason: text("reason").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  foreignKey({
    columns: [table.channelId, table.venueSlug, table.releaseKind, table.channel],
    foreignColumns: [reconstructionReleaseChannels.id, reconstructionReleaseChannels.venueSlug, reconstructionReleaseChannels.releaseKind, reconstructionReleaseChannels.channel],
    name: "reconstruction_channel_events_channel_fk",
  }).onDelete("restrict"),
  foreignKey({
    columns: [table.fromReleaseId, table.venueSlug, table.releaseKind, table.fromReleaseDigest],
    foreignColumns: [reconstructionReleases.id, reconstructionReleases.venueSlug, reconstructionReleases.releaseKind, reconstructionReleases.releaseDigest],
    name: "reconstruction_channel_events_from_release_fk",
  }).onDelete("restrict"),
  foreignKey({
    columns: [table.toReleaseId, table.venueSlug, table.releaseKind, table.toReleaseDigest],
    foreignColumns: [reconstructionReleases.id, reconstructionReleases.venueSlug, reconstructionReleases.releaseKind, reconstructionReleases.releaseDigest],
    name: "reconstruction_channel_events_to_release_fk",
  }).onDelete("restrict"),
  foreignKey({
    columns: [table.fromPublicationId, table.fromReleaseId, table.venueSlug, table.releaseKind, table.fromReleaseDigest],
    foreignColumns: [reconstructionReleasePublications.id, reconstructionReleasePublications.releaseId, reconstructionReleasePublications.venueSlug, reconstructionReleasePublications.releaseKind, reconstructionReleasePublications.releaseDigest],
    name: "reconstruction_channel_events_from_publication_fk",
  }).onDelete("restrict"),
  foreignKey({
    columns: [table.toPublicationId, table.toReleaseId, table.venueSlug, table.releaseKind, table.toReleaseDigest],
    foreignColumns: [reconstructionReleasePublications.id, reconstructionReleasePublications.releaseId, reconstructionReleasePublications.venueSlug, reconstructionReleasePublications.releaseKind, reconstructionReleasePublications.releaseDigest],
    name: "reconstruction_channel_events_to_publication_fk",
  }).onDelete("restrict"),
  unique("reconstruction_channel_events_idempotency_unique").on(table.channelId, table.actorUserId, table.idempotencyKey),
  unique("reconstruction_channel_events_revision_unique").on(table.channelId, table.resultingRevision),
  index("reconstruction_channel_events_channel_created_idx").on(table.channelId, table.createdAt),
]);

// ---------------------------------------------------------------------------
// 30. Diary — bookings (the commitment axis; Canon §1–§3, T-487).
//
// A booking is space-time commitment truth. `kind` = what the commitment IS
// (prospect | hold | ink | internal_block) and mutates only on promotion;
// `status` = liveness (active | released | expired | cancelled | lost) and
// mutates only on exit. The Canon's flat lifecycle state is derived
// (deriveBookingState in @omnitwin/types), so a released hold remains
// knowably a hold — wash-rate analytics depend on that provenance.
//
// The ink hard floor lives in the database: migration 0050 adds a btree_gist
// partial EXCLUDE constraint (bookings_ink_no_overlap) so two active inks can
// never overlap in one space. Drizzle cannot express EXCLUDE — the raw
// migration is authoritative for it, together with the row CHECK constraints.
// Holds and prospects overlap by design (the option ladder). Composite
// (id, venue_id) FKs pin bookings to events and spaces of the SAME venue at
// the DB boundary (the Mission Control tenant-integrity pattern).
// ---------------------------------------------------------------------------

export const bookings = pgTable("bookings", {
  id: uuid("id").primaryKey().defaultRandom(),
  venueId: uuid("venue_id").notNull().references(() => venues.id),
  spaceId: uuid("space_id").notNull().references(() => spaces.id),
  eventId: uuid("event_id").references(() => events.id, { onDelete: "set null" }),
  kind: varchar("kind", { length: 20 }).$type<BookingKind>().notNull(),
  status: varchar("status", { length: 20 }).$type<BookingLiveness>().notNull().default("active"),
  title: varchar("title", { length: 200 }).notNull(),
  eventType: varchar("event_type", { length: 80 }),
  startsAt: timestamp("starts_at", { withTimezone: true }).notNull(),
  endsAt: timestamp("ends_at", { withTimezone: true }).notNull(),
  // Option-ladder position; holds only (bookings_rank_hold_only CHECK).
  // Cleared on promotion to ink — the ladder is resolved.
  rank: integer("rank"),
  jointFlag: boolean("joint_flag").notNull().default(false),
  decisionAt: timestamp("decision_at", { withTimezone: true }),
  ownerUserId: uuid("owner_user_id").references(() => users.id, { onDelete: "set null" }),
  nextAction: varchar("next_action", { length: 500 }),
  nextActionDueAt: timestamp("next_action_due_at", { withTimezone: true }),
  // Day-one nullable series group id (Canon §2.1); a series table arrives
  // with recurrence work, not this slice.
  seriesId: uuid("series_id"),
  notes: text("notes"),
  createdBy: uuid("created_by").references(() => users.id, { onDelete: "set null" }),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  deletedAt: timestamp("deleted_at", { withTimezone: true }),
  // Conversion provenance (T-496): the enquiry this booking was pencilled
  // from. Added by migration 0051, so it sits physically after 0050's
  // columns — the diary-schema contract test encodes exactly that order.
  enquiryId: uuid("enquiry_id").references(() => enquiries.id, { onDelete: "set null" }),
}, (table) => [
  unique("bookings_id_venue_unique").on(table.id, table.venueId),
  foreignKey({
    columns: [table.eventId, table.venueId],
    foreignColumns: [events.id, events.venueId],
    name: "bookings_event_venue_fk",
  }),
  foreignKey({
    columns: [table.spaceId, table.venueId],
    foreignColumns: [spaces.id, spaces.venueId],
    name: "bookings_space_venue_fk",
  }),
  index("bookings_venue_starts_idx").on(table.venueId, table.startsAt),
  index("bookings_space_starts_idx").on(table.spaceId, table.startsAt),
  index("bookings_event_idx").on(table.eventId),
  index("bookings_venue_kind_status_idx").on(table.venueId, table.kind, table.status),
  index("bookings_venue_decision_idx").on(table.venueId, table.decisionAt),
  index("bookings_venue_next_action_idx").on(table.venueId, table.nextActionDueAt),
  index("bookings_enquiry_idx").on(table.enquiryId),
]);

// House status-history convention (enquiry_status_history pattern). Rows
// store DERIVED states (Canon §1 vocabulary), so history reads as the
// lifecycle: "hold → ink", "hold → released", never a kind/status tuple.
export const bookingStatusHistory = pgTable("booking_status_history", {
  id: uuid("id").primaryKey().defaultRandom(),
  bookingId: uuid("booking_id").notNull().references(() => bookings.id, { onDelete: "cascade" }),
  fromState: varchar("from_state", { length: 20 }).$type<BookingState>().notNull(),
  toState: varchar("to_state", { length: 20 }).$type<BookingState>().notNull(),
  changedBy: uuid("changed_by").references(() => users.id, { onDelete: "set null" }),
  note: text("note"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  index("booking_status_history_booking_idx").on(table.bookingId),
]);

// Minimal turnaround rules v0 (Canon §2.3 tail) — shaped like pricing_rules.
// Null spaceId = venue-wide default; null eventType = all event types. The
// conflict engine resolves the most specific active rule and, on specificity
// ties, the largest minutes (fail-safe direction). Pairs no rule covers are
// reported not_checked — never OK (Canon §4 honesty pattern).
export const turnaroundRules = pgTable("turnaround_rules", {
  id: uuid("id").primaryKey().defaultRandom(),
  venueId: uuid("venue_id").notNull().references(() => venues.id),
  spaceId: uuid("space_id").references(() => spaces.id),
  eventType: varchar("event_type", { length: 80 }),
  name: varchar("name", { length: 200 }).notNull(),
  minutes: integer("minutes").notNull(),
  isActive: boolean("is_active").notNull().default(true),
  deletedAt: timestamp("deleted_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  index("turnaround_rules_venue_space_idx").on(table.venueId, table.spaceId),
]);

// ---------------------------------------------------------------------------
// 31. OmniTwin Foundry durable execution control (migration 0053).
//
// These declarations intentionally use DB-local structural types. The raw
// migration is authoritative for state-transition, append-only, partial-index,
// cost, deadline, kill-scope, and fencing triggers. In particular, admission
// remains admitted_awaiting_executor and does not create a submit command.
// ---------------------------------------------------------------------------

type FoundryDbProviderKind =
  | "local_cpu"
  | "local_cuda"
  | "runpod"
  | "aws"
  | "azure"
  | "gcp"
  | "self_hosted_cluster"
  | "other";

type FoundryDbProviderCommandKind =
  | "provider_submit"
  | "provider_reconcile"
  | "provider_poll"
  | "provider_checkpoint"
  | "provider_stop";

type FoundryDbProviderCommandState =
  | "pending"
  | "claimed"
  | "succeeded"
  | "failed"
  | "uncertain"
  | "cancelled";

type FoundryDbProviderLifecycleState =
  | "not_observed"
  | "unknown"
  | "queued"
  | "running"
  | "exited"
  | "terminated"
  | "not_found";

type FoundryDbExecutionState =
  | "admitted_awaiting_executor"
  | "authorized"
  | "submit_pending"
  | "provider_unknown"
  | "queued"
  | "running"
  | "checkpointing"
  | "stop_pending"
  | "terminating"
  | "termination_unconfirmed"
  | "validating"
  | "terminal_succeeded"
  | "terminal_failed"
  | "terminal_cancelled"
  | "terminal_killed"
  | "terminal_budget_exceeded"
  | "terminal_validation_failed"
  | "terminal_provider_lost";

export const foundryExecutionPolicies = pgTable("foundry_execution_policies", {
  executionPolicySha256: varchar("execution_policy_sha256", { length: 71 }).primaryKey(),
  policyId: varchar("policy_id", { length: 120 }).notNull(),
  schemaVersion: varchar("schema_version", { length: 80 }).notNull(),
  maximumAttempts: integer("maximum_attempts").notNull(),
  deterministicRetryDelaySeconds: jsonb("deterministic_retry_delay_seconds").$type<number[]>().notNull(),
  maximumWallClockSeconds: integer("maximum_wall_clock_seconds").notNull(),
  orchestrationOverheadSeconds: integer("orchestration_overhead_seconds").notNull(),
  workerSelfDeadlineSeconds: integer("worker_self_deadline_seconds").notNull(),
  providerMaximumExecutionTtlSeconds: integer("provider_maximum_execution_ttl_seconds").notNull(),
  dispatchWindowTtlSeconds: integer("dispatch_window_ttl_seconds").notNull(),
  leaseTtlSeconds: integer("lease_ttl_seconds").notNull(),
  heartbeatIntervalSeconds: integer("heartbeat_interval_seconds").notNull(),
  observationIntervalSeconds: integer("observation_interval_seconds").notNull(),
  checkpointIntervalSeconds: integer("checkpoint_interval_seconds"),
  cancelGracePeriodSeconds: integer("cancel_grace_period_seconds").notNull(),
  terminationGracePeriodSeconds: integer("termination_grace_period_seconds").notNull(),
  terminationConfirmationTimeoutSeconds: integer("termination_confirmation_timeout_seconds").notNull(),
  pricingSnapshotMaximumAgeSeconds: integer("pricing_snapshot_maximum_age_seconds").notNull(),
  costObservationMaximumAgeSeconds: integer("cost_observation_maximum_age_seconds").notNull(),
  executionConfirmationTtlSeconds: integer("execution_confirmation_ttl_seconds").notNull(),
  computeApprovalTtlSeconds: integer("compute_approval_ttl_seconds").notNull(),
  costWarningMicroUsd: bigint("cost_warning_micro_usd", { mode: "bigint" }).notNull(),
  costHardStopMicroUsd: bigint("cost_hard_stop_micro_usd", { mode: "bigint" }).notNull(),
  terminationReserveMicroUsd: bigint("termination_reserve_micro_usd", { mode: "bigint" }).notNull(),
  absoluteCostCapMicroUsd: bigint("absolute_cost_cap_micro_usd", { mode: "bigint" }).notNull(),
  policyJson: jsonb("policy_json").$type<Record<string, unknown>>().notNull(),
  registeredByUserId: uuid("registered_by_user_id").notNull().references(() => users.id, { onDelete: "restrict" }),
  idempotencyKey: varchar("idempotency_key", { length: 160 }).notNull(),
  requestDigest: varchar("request_digest", { length: 71 }).notNull(),
  registeredAt: timestamp("registered_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  unique("foundry_policy_id_digest_unique").on(table.policyId, table.executionPolicySha256),
  unique("foundry_policy_runtime_exact_unique").on(
    table.executionPolicySha256, table.maximumWallClockSeconds, table.orchestrationOverheadSeconds,
    table.workerSelfDeadlineSeconds, table.providerMaximumExecutionTtlSeconds,
    table.cancelGracePeriodSeconds, table.terminationGracePeriodSeconds,
    table.terminationConfirmationTimeoutSeconds, table.costWarningMicroUsd,
    table.costHardStopMicroUsd, table.terminationReserveMicroUsd, table.absoluteCostCapMicroUsd,
  ),
  unique("foundry_policy_actor_idempotency_unique").on(table.registeredByUserId, table.idempotencyKey),
]);

export const foundryProviderAdapterArtifacts = pgTable("foundry_provider_adapter_artifacts", {
  providerAdapterArtifactSha256: varchar("provider_adapter_artifact_sha256", { length: 71 }).primaryKey(),
  providerKind: varchar("provider_kind", { length: 40 }).$type<FoundryDbProviderKind>().notNull(),
  providerAdapterId: varchar("provider_adapter_id", { length: 120 }).notNull(),
  providerAdapterVersion: varchar("provider_adapter_version", { length: 120 }).notNull(),
  artifactRef: text("artifact_ref").notNull(),
  artifactJson: jsonb("artifact_json").$type<Record<string, unknown>>().notNull(),
  reviewedBy: varchar("reviewed_by", { length: 160 }).notNull(),
  reviewedAt: timestamp("reviewed_at", { withTimezone: true }).notNull(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  registeredByUserId: uuid("registered_by_user_id").notNull().references(() => users.id, { onDelete: "restrict" }),
  idempotencyKey: varchar("idempotency_key", { length: 160 }).notNull(),
  requestDigest: varchar("request_digest", { length: 71 }).notNull(),
  registeredAt: timestamp("registered_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  unique("foundry_adapter_artifact_exact_unique").on(
    table.providerAdapterArtifactSha256, table.providerKind,
    table.providerAdapterId, table.providerAdapterVersion,
  ),
  unique("foundry_adapter_artifact_actor_idem_unique").on(table.registeredByUserId, table.idempotencyKey),
]);

export const foundryProviderDeployments = pgTable("foundry_provider_deployments", {
  providerDeploymentSha256: varchar("provider_deployment_sha256", { length: 71 }).primaryKey(),
  deploymentId: varchar("deployment_id", { length: 120 }).notNull(),
  providerKind: varchar("provider_kind", { length: 40 }).$type<FoundryDbProviderKind>().notNull(),
  providerAdapterId: varchar("provider_adapter_id", { length: 120 }).notNull(),
  providerAdapterVersion: varchar("provider_adapter_version", { length: 120 }).notNull(),
  providerAdapterArtifactSha256: varchar("provider_adapter_artifact_sha256", { length: 71 }).notNull(),
  accountProjectAlias: varchar("account_project_alias", { length: 120 }).notNull(),
  region: varchar("region", { length: 120 }).notNull(),
  dataResidency: varchar("data_residency", { length: 120 }).notNull(),
  observedAt: timestamp("observed_at", { withTimezone: true }).notNull(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  deploymentJson: jsonb("deployment_json").$type<Record<string, unknown>>().notNull(),
  registeredByUserId: uuid("registered_by_user_id").notNull().references(() => users.id, { onDelete: "restrict" }),
  idempotencyKey: varchar("idempotency_key", { length: 160 }).notNull(),
  requestDigest: varchar("request_digest", { length: 71 }).notNull(),
  registeredAt: timestamp("registered_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  foreignKey({
    columns: [
      table.providerAdapterArtifactSha256, table.providerKind,
      table.providerAdapterId, table.providerAdapterVersion,
    ],
    foreignColumns: [
      foundryProviderAdapterArtifacts.providerAdapterArtifactSha256,
      foundryProviderAdapterArtifacts.providerKind,
      foundryProviderAdapterArtifacts.providerAdapterId,
      foundryProviderAdapterArtifacts.providerAdapterVersion,
    ],
    name: "foundry_deployment_adapter_fk",
  }).onDelete("restrict"),
  unique("foundry_deployment_exact_unique").on(
    table.providerDeploymentSha256, table.providerKind, table.providerAdapterId,
    table.providerAdapterVersion, table.providerAdapterArtifactSha256,
  ),
  unique("foundry_deployment_actor_idempotency_unique").on(table.registeredByUserId, table.idempotencyKey),
]);

export const foundryProviderRequestProfiles = pgTable("foundry_provider_request_profiles", {
  providerRequestProfileSha256: varchar("provider_request_profile_sha256", { length: 71 }).primaryKey(),
  profileId: varchar("profile_id", { length: 120 }).notNull(),
  profileVersion: varchar("profile_version", { length: 120 }).notNull(),
  schemaVersion: varchar("schema_version", { length: 80 }).notNull(),
  providerKind: varchar("provider_kind", { length: 40 }).$type<FoundryDbProviderKind>().notNull(),
  providerAdapterId: varchar("provider_adapter_id", { length: 120 }).notNull(),
  providerAdapterVersion: varchar("provider_adapter_version", { length: 120 }).notNull(),
  providerAdapterArtifactSha256: varchar("provider_adapter_artifact_sha256", { length: 71 }).notNull(),
  providerAdapterConfigurationSha256: varchar("provider_adapter_configuration_sha256", { length: 71 }).notNull(),
  providerDeploymentSha256: varchar("provider_deployment_sha256", { length: 71 }).notNull(),
  targetKind: varchar("target_kind", { length: 30 }).$type<"local_worker" | "remote_worker_pool">().notNull(),
  targetId: varchar("target_id", { length: 120 }).notNull(),
  maximumApiCallSeconds: integer("maximum_api_call_seconds").notNull(),
  profileJson: jsonb("profile_json").$type<Record<string, unknown>>().notNull(),
  reviewedAt: timestamp("reviewed_at", { withTimezone: true }).notNull(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  registeredByUserId: uuid("registered_by_user_id").notNull().references(() => users.id, { onDelete: "restrict" }),
  idempotencyKey: varchar("idempotency_key", { length: 160 }).notNull(),
  requestDigest: varchar("request_digest", { length: 71 }).notNull(),
  registeredAt: timestamp("registered_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  foreignKey({
    columns: [
      table.providerDeploymentSha256, table.providerKind, table.providerAdapterId,
      table.providerAdapterVersion, table.providerAdapterArtifactSha256,
    ],
    foreignColumns: [
      foundryProviderDeployments.providerDeploymentSha256,
      foundryProviderDeployments.providerKind,
      foundryProviderDeployments.providerAdapterId,
      foundryProviderDeployments.providerAdapterVersion,
      foundryProviderDeployments.providerAdapterArtifactSha256,
    ],
    name: "foundry_provider_request_profile_deployment_fk",
  }).onDelete("restrict"),
  unique("foundry_provider_request_profile_id_version_unique").on(table.profileId, table.profileVersion),
  unique("foundry_provider_request_profile_exact_unique").on(
    table.providerRequestProfileSha256, table.profileId, table.profileVersion,
    table.providerKind, table.providerAdapterId, table.providerAdapterVersion,
    table.providerAdapterArtifactSha256, table.providerAdapterConfigurationSha256,
    table.providerDeploymentSha256,
  ),
  unique("foundry_provider_request_profile_actor_idem_unique").on(
    table.registeredByUserId, table.idempotencyKey,
  ),
]);

export const foundryTrustedWorkerProfiles = pgTable("foundry_trusted_worker_profiles", {
  workerProfileSha256: varchar("worker_profile_sha256", { length: 71 }).primaryKey(),
  profileId: varchar("profile_id", { length: 120 }).notNull(),
  profileVersion: varchar("profile_version", { length: 120 }).notNull(),
  operationClass: varchar("operation_class", { length: 40 }).$type<
    | "read_only_inspection"
    | "deterministic_transformation"
    | "model_inference"
    | "model_training"
    | "redistribution_packaging"
    | "public_release"
  >().notNull(),
  containerImage: text("container_image").notNull(),
  networkAccess: varchar("network_access", { length: 30 }).$type<"none" | "object_storage_only" | "restricted">().notNull(),
  localExecutionAllowed: boolean("local_execution_allowed").notNull(),
  profileJson: jsonb("profile_json").$type<Record<string, unknown>>().notNull(),
  reviewedBy: varchar("reviewed_by", { length: 160 }).notNull(),
  reviewedAt: timestamp("reviewed_at", { withTimezone: true }).notNull(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  registeredByUserId: uuid("registered_by_user_id").notNull().references(() => users.id, { onDelete: "restrict" }),
  idempotencyKey: varchar("idempotency_key", { length: 160 }).notNull(),
  requestDigest: varchar("request_digest", { length: 71 }).notNull(),
  registeredAt: timestamp("registered_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  unique("foundry_worker_profile_id_version_unique").on(table.profileId, table.profileVersion),
  unique("foundry_worker_profile_exact_unique").on(table.workerProfileSha256, table.operationClass),
  unique("foundry_worker_profile_actor_idem_unique").on(table.registeredByUserId, table.idempotencyKey),
]);

export const foundryJobs = pgTable("foundry_jobs", {
  jobId: varchar("job_id", { length: 120 }).primaryKey(),
  envelopeId: varchar("envelope_id", { length: 120 }).notNull(),
  projectId: varchar("project_id", { length: 120 }).notNull(),
  schemaVersion: varchar("schema_version", { length: 80 }).notNull(),
  executionIntent: varchar("execution_intent", { length: 20 }).$type<"execute">().notNull(),
  authority: varchar("authority", { length: 20 }).$type<"none">().notNull(),
  executionEnvelopeSha256: varchar("execution_envelope_sha256", { length: 71 }).notNull(),
  jobSpecSha256: varchar("job_spec_sha256", { length: 71 }).notNull(),
  providerPlanSha256: varchar("provider_plan_sha256", { length: 71 }).notNull(),
  reviewedIngestManifestSha256: varchar("reviewed_ingest_manifest_sha256", { length: 71 }).notNull(),
  intakeAdmissionResultSha256: varchar("intake_admission_result_sha256", { length: 71 }).notNull(),
  intakeStagingIndexSha256: varchar("intake_staging_index_sha256", { length: 71 }).notNull(),
  executionPolicySha256: varchar("execution_policy_sha256", { length: 71 }).notNull(),
  computeApprovalId: varchar("compute_approval_id", { length: 120 }),
  pricingSnapshotSha256: varchar("pricing_snapshot_sha256", { length: 71 }).notNull(),
  providerKind: varchar("provider_kind", { length: 40 }).$type<FoundryDbProviderKind>().notNull(),
  providerAdapterId: varchar("provider_adapter_id", { length: 120 }).notNull(),
  providerAdapterVersion: varchar("provider_adapter_version", { length: 120 }).notNull(),
  providerAdapterArtifactSha256: varchar("provider_adapter_artifact_sha256", { length: 71 }).notNull(),
  providerDeploymentSha256: varchar("provider_deployment_sha256", { length: 71 }).notNull(),
  trustedWorkerProfileSetSha256: varchar("trusted_worker_profile_set_sha256", { length: 71 }).notNull(),
  trustedWorkerProfileCount: integer("trusted_worker_profile_count").notNull(),
  pricingCurrency: char("pricing_currency", { length: 3 }).$type<"USD">().notNull(),
  pricingSnapshotObservedAt: timestamp("pricing_snapshot_observed_at", { withTimezone: true }).notNull(),
  providerPlanPlannedAt: timestamp("provider_plan_planned_at", { withTimezone: true }).notNull(),
  pricingSnapshotExpiresAt: timestamp("pricing_snapshot_expires_at", { withTimezone: true }).notNull(),
  estimatedCostMicroUsd: bigint("estimated_cost_micro_usd", { mode: "bigint" }).notNull(),
  budgetCapMicroUsd: bigint("budget_cap_micro_usd", { mode: "bigint" }).notNull(),
  costWarningMicroUsd: bigint("cost_warning_micro_usd", { mode: "bigint" }).notNull(),
  costHardStopMicroUsd: bigint("cost_hard_stop_micro_usd", { mode: "bigint" }).notNull(),
  terminationReserveMicroUsd: bigint("termination_reserve_micro_usd", { mode: "bigint" }).notNull(),
  absoluteCostCapMicroUsd: bigint("absolute_cost_cap_micro_usd", { mode: "bigint" }).notNull(),
  maxWallClockSeconds: integer("max_wall_clock_seconds").notNull(),
  orchestrationOverheadSeconds: integer("orchestration_overhead_seconds").notNull(),
  cancelGraceSeconds: integer("cancel_grace_seconds").notNull(),
  terminationGraceSeconds: integer("termination_grace_seconds").notNull(),
  workerSelfDeadlineSeconds: integer("worker_self_deadline_seconds").notNull(),
  terminationConfirmationTimeoutSeconds: integer("termination_confirmation_timeout_seconds").notNull(),
  providerMaximumExecutionTtlSeconds: integer("provider_maximum_execution_ttl_seconds").notNull(),
  killSwitchEnabled: boolean("kill_switch_enabled").notNull(),
  dispatchDeadline: timestamp("dispatch_deadline", { withTimezone: true }).notNull(),
  envelopeCreatedAt: timestamp("envelope_created_at", { withTimezone: true }).notNull(),
  executionEnvelopeJson: jsonb("execution_envelope_json").$type<Record<string, unknown>>().notNull(),
  jobSpecJson: jsonb("job_spec_json").$type<Record<string, unknown>>().notNull(),
  reviewedIngestManifestJson: jsonb("reviewed_ingest_manifest_json").$type<Record<string, unknown>>().notNull(),
  providerPlanJson: jsonb("provider_plan_json").$type<Record<string, unknown>>().notNull(),
  intakeAdmissionResultJson: jsonb("intake_admission_result_json").$type<Record<string, unknown>>().notNull(),
  intakeStagingIndexJson: jsonb("intake_staging_index_json").$type<Record<string, unknown>>().notNull(),
  executionPolicyJson: jsonb("execution_policy_json").$type<Record<string, unknown>>().notNull(),
  pricingSnapshotJson: jsonb("pricing_snapshot_json").$type<Record<string, unknown>>().notNull(),
  registeredByUserId: uuid("registered_by_user_id").notNull().references(() => users.id, { onDelete: "restrict" }),
  idempotencyKey: varchar("idempotency_key", { length: 160 }).notNull(),
  requestDigest: varchar("request_digest", { length: 71 }).notNull(),
  registeredAt: timestamp("registered_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  unique("foundry_jobs_envelope_unique").on(table.envelopeId),
  unique("foundry_jobs_job_project_unique").on(table.jobId, table.projectId),
  unique("foundry_jobs_actor_idempotency_unique").on(table.registeredByUserId, table.idempotencyKey),
  unique("foundry_jobs_confirmation_subject_unique").on(
    table.jobId, table.projectId, table.executionEnvelopeSha256, table.jobSpecSha256,
  ),
  unique("foundry_jobs_rights_subject_unique").on(
    table.jobId, table.projectId, table.executionEnvelopeSha256, table.jobSpecSha256,
    table.reviewedIngestManifestSha256, table.executionPolicySha256,
  ),
  unique("foundry_jobs_compute_subject_unique").on(
    table.jobId, table.projectId, table.executionEnvelopeSha256, table.jobSpecSha256,
    table.providerKind, table.providerAdapterId, table.providerAdapterVersion,
    table.budgetCapMicroUsd, table.providerAdapterArtifactSha256,
    table.providerDeploymentSha256, table.computeApprovalId,
  ),
  unique("foundry_jobs_worker_set_unique").on(
    table.jobId, table.projectId, table.executionEnvelopeSha256, table.providerPlanSha256,
    table.trustedWorkerProfileSetSha256,
  ),
  unique("foundry_jobs_exact_envelope_unique").on(
    table.jobId, table.projectId, table.executionEnvelopeSha256, table.jobSpecSha256,
    table.providerPlanSha256, table.reviewedIngestManifestSha256, table.executionPolicySha256,
    table.intakeAdmissionResultSha256, table.intakeStagingIndexSha256, table.pricingSnapshotSha256,
    table.providerKind, table.providerAdapterId, table.providerAdapterVersion,
    table.providerAdapterArtifactSha256, table.providerDeploymentSha256,
    table.trustedWorkerProfileSetSha256, table.trustedWorkerProfileCount,
    table.pricingSnapshotExpiresAt, table.budgetCapMicroUsd,
    table.costWarningMicroUsd, table.costHardStopMicroUsd, table.terminationReserveMicroUsd,
    table.absoluteCostCapMicroUsd, table.maxWallClockSeconds, table.orchestrationOverheadSeconds,
    table.cancelGraceSeconds,
    table.terminationGraceSeconds, table.workerSelfDeadlineSeconds,
    table.terminationConfirmationTimeoutSeconds, table.providerMaximumExecutionTtlSeconds,
    table.dispatchDeadline,
  ),
  foreignKey({
    columns: [
      table.executionPolicySha256, table.maxWallClockSeconds, table.orchestrationOverheadSeconds,
      table.workerSelfDeadlineSeconds, table.providerMaximumExecutionTtlSeconds,
      table.cancelGraceSeconds, table.terminationGraceSeconds,
      table.terminationConfirmationTimeoutSeconds, table.costWarningMicroUsd,
      table.costHardStopMicroUsd, table.terminationReserveMicroUsd, table.absoluteCostCapMicroUsd,
    ],
    foreignColumns: [
      foundryExecutionPolicies.executionPolicySha256,
      foundryExecutionPolicies.maximumWallClockSeconds,
      foundryExecutionPolicies.orchestrationOverheadSeconds,
      foundryExecutionPolicies.workerSelfDeadlineSeconds,
      foundryExecutionPolicies.providerMaximumExecutionTtlSeconds,
      foundryExecutionPolicies.cancelGracePeriodSeconds,
      foundryExecutionPolicies.terminationGracePeriodSeconds,
      foundryExecutionPolicies.terminationConfirmationTimeoutSeconds,
      foundryExecutionPolicies.costWarningMicroUsd,
      foundryExecutionPolicies.costHardStopMicroUsd,
      foundryExecutionPolicies.terminationReserveMicroUsd,
      foundryExecutionPolicies.absoluteCostCapMicroUsd,
    ],
    name: "foundry_jobs_execution_policy_fk",
  }).onDelete("restrict"),
  foreignKey({
    columns: [
      table.providerAdapterArtifactSha256, table.providerKind,
      table.providerAdapterId, table.providerAdapterVersion,
    ],
    foreignColumns: [
      foundryProviderAdapterArtifacts.providerAdapterArtifactSha256,
      foundryProviderAdapterArtifacts.providerKind,
      foundryProviderAdapterArtifacts.providerAdapterId,
      foundryProviderAdapterArtifacts.providerAdapterVersion,
    ],
    name: "foundry_jobs_adapter_artifact_fk",
  }).onDelete("restrict"),
  foreignKey({
    columns: [
      table.providerDeploymentSha256, table.providerKind, table.providerAdapterId,
      table.providerAdapterVersion, table.providerAdapterArtifactSha256,
    ],
    foreignColumns: [
      foundryProviderDeployments.providerDeploymentSha256,
      foundryProviderDeployments.providerKind,
      foundryProviderDeployments.providerAdapterId,
      foundryProviderDeployments.providerAdapterVersion,
      foundryProviderDeployments.providerAdapterArtifactSha256,
    ],
    name: "foundry_jobs_deployment_fk",
  }).onDelete("restrict"),
]);

export const foundryJobWorkerProfiles = pgTable("foundry_job_worker_profiles", {
  id: uuid("id").primaryKey().defaultRandom(),
  jobId: varchar("job_id", { length: 120 }).notNull(),
  projectId: varchar("project_id", { length: 120 }).notNull(),
  executionEnvelopeSha256: varchar("execution_envelope_sha256", { length: 71 }).notNull(),
  providerPlanSha256: varchar("provider_plan_sha256", { length: 71 }).notNull(),
  trustedWorkerProfileSetSha256: varchar("trusted_worker_profile_set_sha256", { length: 71 }).notNull(),
  stageId: varchar("stage_id", { length: 120 }).notNull(),
  workerProfileSha256: varchar("worker_profile_sha256", { length: 71 }).notNull(),
  operationClass: varchar("operation_class", { length: 40 }).$type<
    | "read_only_inspection"
    | "deterministic_transformation"
    | "model_inference"
    | "model_training"
    | "redistribution_packaging"
    | "public_release"
  >().notNull(),
  registeredByUserId: uuid("registered_by_user_id").notNull().references(() => users.id, { onDelete: "restrict" }),
  idempotencyKey: varchar("idempotency_key", { length: 160 }).notNull(),
  requestDigest: varchar("request_digest", { length: 71 }).notNull(),
  registeredAt: timestamp("registered_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  foreignKey({
    columns: [
      table.jobId, table.projectId, table.executionEnvelopeSha256,
      table.providerPlanSha256, table.trustedWorkerProfileSetSha256,
    ],
    foreignColumns: [
      foundryJobs.jobId, foundryJobs.projectId, foundryJobs.executionEnvelopeSha256,
      foundryJobs.providerPlanSha256, foundryJobs.trustedWorkerProfileSetSha256,
    ],
    name: "foundry_job_worker_set_fk",
  }).onDelete("restrict"),
  foreignKey({
    columns: [table.workerProfileSha256, table.operationClass],
    foreignColumns: [foundryTrustedWorkerProfiles.workerProfileSha256, foundryTrustedWorkerProfiles.operationClass],
    name: "foundry_job_worker_profile_fk",
  }).onDelete("restrict"),
  unique("foundry_job_worker_stage_unique").on(table.jobId, table.stageId),
  unique("foundry_job_worker_actor_idem_unique").on(table.registeredByUserId, table.idempotencyKey),
]);

export const foundryRightsPolicyVersions = pgTable("foundry_rights_policy_versions", {
  policyVersion: varchar("policy_version", { length: 120 }).notNull(),
  policyDefinitionSha256: varchar("policy_definition_sha256", { length: 71 }).notNull(),
  policyEvidenceSha256: varchar("policy_evidence_sha256", { length: 71 }).notNull(),
  generation: bigint("generation", { mode: "bigint" }).notNull(),
  maximumApprovalTtlSeconds: integer("maximum_approval_ttl_seconds").notNull(),
  policyDefinitionJson: jsonb("policy_definition_json").$type<Record<string, unknown>>().notNull(),
  effectiveAt: timestamp("effective_at", { withTimezone: true }).notNull(),
  revokedAt: timestamp("revoked_at", { withTimezone: true }),
  registeredByUserId: uuid("registered_by_user_id").notNull().references(() => users.id, { onDelete: "restrict" }),
  idempotencyKey: varchar("idempotency_key", { length: 160 }).notNull(),
  requestDigest: varchar("request_digest", { length: 71 }).notNull(),
  registeredAt: timestamp("registered_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  primaryKey({
    columns: [table.policyVersion, table.generation],
    name: "foundry_rights_policy_pk",
  }),
  unique("foundry_rights_policy_generation_unique").on(
    table.policyVersion, table.policyDefinitionSha256, table.generation,
  ),
  unique("foundry_rights_policy_exact_unique").on(
    table.policyVersion, table.policyDefinitionSha256, table.policyEvidenceSha256,
    table.generation, table.maximumApprovalTtlSeconds,
  ),
  unique("foundry_rights_policy_actor_idempotency_unique").on(table.registeredByUserId, table.idempotencyKey),
]);

export const foundryRightsPolicyRevocations = pgTable("foundry_rights_policy_revocations", {
  id: uuid("id").primaryKey().defaultRandom(),
  policyVersion: varchar("policy_version", { length: 120 }).notNull(),
  policyDefinitionSha256: varchar("policy_definition_sha256", { length: 71 }).notNull(),
  policyGeneration: bigint("policy_generation", { mode: "bigint" }).notNull(),
  revokedAt: timestamp("revoked_at", { withTimezone: true }).notNull(),
  reason: text("reason").notNull(),
  revokedByUserId: uuid("revoked_by_user_id").notNull().references(() => users.id, { onDelete: "restrict" }),
  idempotencyKey: varchar("idempotency_key", { length: 160 }).notNull(),
  requestDigest: varchar("request_digest", { length: 71 }).notNull(),
  recordedAt: timestamp("recorded_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  foreignKey({
    columns: [table.policyVersion, table.policyDefinitionSha256, table.policyGeneration],
    foreignColumns: [
      foundryRightsPolicyVersions.policyVersion,
      foundryRightsPolicyVersions.policyDefinitionSha256,
      foundryRightsPolicyVersions.generation,
    ],
    name: "foundry_rights_policy_revocation_fk",
  }).onDelete("restrict"),
  unique("foundry_rights_policy_one_revocation_unique").on(
    table.policyVersion, table.policyDefinitionSha256, table.policyGeneration,
  ),
  unique("foundry_rights_policy_revocation_actor_idem_unique").on(table.revokedByUserId, table.idempotencyKey),
]);

export const foundryRightsApprovals = pgTable("foundry_rights_approvals", {
  id: varchar("id", { length: 120 }).primaryKey(),
  jobId: varchar("job_id", { length: 120 }).notNull(),
  projectId: varchar("project_id", { length: 120 }).notNull(),
  executionEnvelopeSha256: varchar("execution_envelope_sha256", { length: 71 }).notNull(),
  jobSpecSha256: varchar("job_spec_sha256", { length: 71 }).notNull(),
  reviewedIngestManifestSha256: varchar("reviewed_ingest_manifest_sha256", { length: 71 }).notNull(),
  executionPolicySha256: varchar("execution_policy_sha256", { length: 71 }).notNull(),
  policyVersion: varchar("policy_version", { length: 120 }).notNull(),
  policyDefinitionSha256: varchar("policy_definition_sha256", { length: 71 }).notNull(),
  policyEvidenceSha256: varchar("policy_evidence_sha256", { length: 71 }).notNull(),
  policyGeneration: bigint("policy_generation", { mode: "bigint" }).notNull(),
  policyMaximumApprovalTtlSeconds: integer("policy_maximum_approval_ttl_seconds").notNull(),
  decision: varchar("decision", { length: 20 }).$type<"allowed">().notNull(),
  decidedBy: varchar("decided_by", { length: 160 }).notNull(),
  decidedAt: timestamp("decided_at", { withTimezone: true }).notNull(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  rightsApprovalSha256: varchar("rights_approval_sha256", { length: 71 }).notNull(),
  rightsApprovalJson: jsonb("rights_approval_json").$type<Record<string, unknown>>().notNull(),
  registeredByUserId: uuid("registered_by_user_id").notNull().references(() => users.id, { onDelete: "restrict" }),
  idempotencyKey: varchar("idempotency_key", { length: 160 }).notNull(),
  requestDigest: varchar("request_digest", { length: 71 }).notNull(),
  registeredAt: timestamp("registered_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  foreignKey({
    columns: [table.jobId, table.projectId, table.executionEnvelopeSha256, table.jobSpecSha256, table.reviewedIngestManifestSha256, table.executionPolicySha256],
    foreignColumns: [foundryJobs.jobId, foundryJobs.projectId, foundryJobs.executionEnvelopeSha256, foundryJobs.jobSpecSha256, foundryJobs.reviewedIngestManifestSha256, foundryJobs.executionPolicySha256],
    name: "foundry_rights_job_fk",
  }).onDelete("restrict"),
  foreignKey({
    columns: [
      table.policyVersion, table.policyDefinitionSha256,
      table.policyEvidenceSha256, table.policyGeneration,
      table.policyMaximumApprovalTtlSeconds,
    ],
    foreignColumns: [
      foundryRightsPolicyVersions.policyVersion,
      foundryRightsPolicyVersions.policyDefinitionSha256,
      foundryRightsPolicyVersions.policyEvidenceSha256,
      foundryRightsPolicyVersions.generation,
      foundryRightsPolicyVersions.maximumApprovalTtlSeconds,
    ],
    name: "foundry_rights_policy_fk",
  }).onDelete("restrict"),
  unique("foundry_rights_actor_idempotency_unique").on(table.registeredByUserId, table.idempotencyKey),
  unique("foundry_rights_exact_subject_unique").on(
    table.id, table.jobId, table.projectId, table.executionEnvelopeSha256, table.jobSpecSha256,
    table.reviewedIngestManifestSha256, table.executionPolicySha256,
    table.policyVersion, table.policyDefinitionSha256, table.policyEvidenceSha256,
    table.policyGeneration, table.policyMaximumApprovalTtlSeconds, table.rightsApprovalSha256,
  ),
]);

export const foundryDerivativeRightsPolicyVersions = pgTable("foundry_derivative_rights_policy_versions", {
  authority: varchar("authority", { length: 20 }).$type<"none">().notNull(),
  policyVersion: varchar("policy_version", { length: 120 }).notNull(),
  policyDefinitionSha256: varchar("policy_definition_sha256", { length: 71 }).notNull(),
  generation: bigint("generation", { mode: "bigint" }).notNull(),
  maximumApprovalTtlSeconds: integer("maximum_approval_ttl_seconds").notNull(),
  effectiveAt: timestamp("effective_at", { withTimezone: true }).notNull(),
  policyDefinitionJson: jsonb("policy_definition_json").$type<Record<string, unknown>>().notNull(),
  registeredByUserId: uuid("registered_by_user_id").notNull().references(() => users.id, { onDelete: "restrict" }),
  idempotencyKey: varchar("idempotency_key", { length: 160 }).notNull(),
  requestDigest: varchar("request_digest", { length: 71 }).notNull(),
  registeredAt: timestamp("registered_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  primaryKey({
    columns: [table.policyVersion, table.generation],
    name: "foundry_derivative_policy_pk",
  }),
  unique("foundry_derivative_policy_generation_unique").on(
    table.policyVersion, table.policyDefinitionSha256, table.generation,
  ),
  unique("foundry_derivative_policy_subject_unique").on(
    table.policyVersion, table.policyDefinitionSha256, table.generation,
    table.maximumApprovalTtlSeconds,
  ),
  unique("foundry_derivative_policy_actor_idem_unique").on(
    table.registeredByUserId, table.idempotencyKey,
  ),
]);

export const foundryDerivativeRightsPolicyRevocations = pgTable("foundry_derivative_rights_policy_revocations", {
  id: uuid("id").primaryKey().defaultRandom(),
  authority: varchar("authority", { length: 20 }).$type<"none">().notNull(),
  revocationId: varchar("revocation_id", { length: 120 }).notNull(),
  policyVersion: varchar("policy_version", { length: 120 }).notNull(),
  policyDefinitionSha256: varchar("policy_definition_sha256", { length: 71 }).notNull(),
  policyGeneration: bigint("policy_generation", { mode: "bigint" }).notNull(),
  revokedAt: timestamp("revoked_at", { withTimezone: true }).notNull(),
  revokedBy: varchar("revoked_by", { length: 160 }).notNull(),
  reason: text("reason").notNull(),
  revocationSha256: varchar("revocation_sha256", { length: 71 }).notNull(),
  revocationJson: jsonb("revocation_json").$type<Record<string, unknown>>().notNull(),
  registeredByUserId: uuid("registered_by_user_id").notNull().references(() => users.id, { onDelete: "restrict" }),
  idempotencyKey: varchar("idempotency_key", { length: 160 }).notNull(),
  requestDigest: varchar("request_digest", { length: 71 }).notNull(),
  recordedAt: timestamp("recorded_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  foreignKey({
    columns: [table.policyVersion, table.policyDefinitionSha256, table.policyGeneration],
    foreignColumns: [
      foundryDerivativeRightsPolicyVersions.policyVersion,
      foundryDerivativeRightsPolicyVersions.policyDefinitionSha256,
      foundryDerivativeRightsPolicyVersions.generation,
    ],
    name: "foundry_derivative_revocation_policy_fk",
  }).onDelete("restrict"),
  unique("foundry_derivative_revocation_exact_unique").on(
    table.policyVersion, table.policyDefinitionSha256, table.policyGeneration,
    table.revocationSha256,
  ),
  unique("foundry_derivative_revocation_id_unique").on(table.revocationId),
  unique("foundry_derivative_revocation_actor_idem_unique").on(
    table.registeredByUserId, table.idempotencyKey,
  ),
  index("foundry_derivative_revocation_effective_idx").on(
    table.policyVersion, table.policyDefinitionSha256, table.policyGeneration,
    table.revokedAt, table.recordedAt, table.id,
  ),
]);

export const foundryDerivativeRightsApprovals = pgTable("foundry_derivative_rights_approvals", {
  approvalId: varchar("approval_id", { length: 120 }).primaryKey(),
  authority: varchar("authority", { length: 20 }).$type<"none">().notNull(),
  jobId: varchar("job_id", { length: 120 }).notNull(),
  projectId: varchar("project_id", { length: 120 }).notNull(),
  jobSpecSha256: varchar("job_spec_sha256", { length: 71 }).notNull(),
  jobSubjectSha256: varchar("job_subject_sha256", { length: 71 }).notNull(),
  ingestManifestSha256: varchar("ingest_manifest_sha256", { length: 71 }).notNull(),
  jobSpecJson: jsonb("job_spec_json").$type<Record<string, unknown>>().notNull(),
  ingestManifestJson: jsonb("ingest_manifest_json").$type<Record<string, unknown>>().notNull(),
  policyVersion: varchar("policy_version", { length: 120 }).notNull(),
  policyDefinitionSha256: varchar("policy_definition_sha256", { length: 71 }).notNull(),
  policyGeneration: bigint("policy_generation", { mode: "bigint" }).notNull(),
  policyMaximumApprovalTtlSeconds: integer("policy_maximum_approval_ttl_seconds").notNull(),
  stageId: varchar("stage_id", { length: 120 }).notNull(),
  operationId: varchar("operation_id", { length: 96 }).$type<"normalize_mesh_glb/v0">().notNull(),
  derivativeClass: varchar("derivative_class", { length: 120 })
    .$type<"lossless_internal_format_normalization">().notNull(),
  assetId: varchar("asset_id", { length: 120 }).notNull(),
  rightsBasis: varchar("rights_basis", { length: 40 }).$type<
    | "customer_owned"
    | "explicit_licence"
    | "vendor_export_terms"
    | "written_permission"
    | "public_domain"
  >().notNull(),
  termsReference: text("terms_reference").notNull(),
  termsReviewedAt: timestamp("terms_reviewed_at", { withTimezone: true }).notNull(),
  termsEvidenceArtifactId: varchar("terms_evidence_artifact_id", { length: 120 }).notNull(),
  termsEvidenceSha256: varchar("terms_evidence_sha256", { length: 71 }).notNull(),
  termsEvidenceSizeBytes: bigint("terms_evidence_size_bytes", { mode: "bigint" }).notNull(),
  termsEvidenceMediaType: varchar("terms_evidence_media_type", { length: 160 }).notNull(),
  termsEvidenceCapturedAt: timestamp("terms_evidence_captured_at", { withTimezone: true }).notNull(),
  decision: varchar("decision", { length: 20 }).$type<"allowed">().notNull(),
  decidedBy: varchar("decided_by", { length: 160 }).notNull(),
  decidedAt: timestamp("decided_at", { withTimezone: true }).notNull(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  derivativeRightsApprovalSha256: varchar("derivative_rights_approval_sha256", { length: 71 }).notNull(),
  derivativeRightsApprovalJson: jsonb("derivative_rights_approval_json").$type<Record<string, unknown>>().notNull(),
  registeredByUserId: uuid("registered_by_user_id").notNull().references(() => users.id, { onDelete: "restrict" }),
  idempotencyKey: varchar("idempotency_key", { length: 160 }).notNull(),
  requestDigest: varchar("request_digest", { length: 71 }).notNull(),
  registeredAt: timestamp("registered_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  foreignKey({
    columns: [
      table.policyVersion, table.policyDefinitionSha256, table.policyGeneration,
      table.policyMaximumApprovalTtlSeconds,
    ],
    foreignColumns: [
      foundryDerivativeRightsPolicyVersions.policyVersion,
      foundryDerivativeRightsPolicyVersions.policyDefinitionSha256,
      foundryDerivativeRightsPolicyVersions.generation,
      foundryDerivativeRightsPolicyVersions.maximumApprovalTtlSeconds,
    ],
    name: "foundry_derivative_approval_policy_fk",
  }).onDelete("restrict"),
  unique("foundry_derivative_approval_actor_idem_unique").on(
    table.registeredByUserId, table.idempotencyKey,
  ),
  unique("foundry_derivative_approval_exact_subject_unique").on(
    table.approvalId, table.jobId, table.projectId, table.jobSubjectSha256,
    table.ingestManifestSha256, table.policyVersion,
    table.policyDefinitionSha256, table.policyGeneration, table.stageId,
    table.operationId, table.assetId, table.derivativeRightsApprovalSha256,
  ),
]);

/**
 * Inline, bounded byte custody for legal/terms evidence. These rows are
 * authenticated review evidence only: authority and execution eligibility are
 * frozen to none/false by migration guards.
 */
export const foundryDerivativeTermsEvidenceCustodyV1 = pgTable(
  "foundry_derivative_terms_evidence_custody_v1",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    authority: varchar("authority", { length: 20 }).$type<"none">().notNull(),
    executionEligible: boolean("execution_eligible").$type<false>().notNull(),
    artifactId: varchar("artifact_id", { length: 120 }).notNull(),
    sha256: varchar("sha256", { length: 71 }).notNull(),
    sizeBytes: bigint("size_bytes", { mode: "number" }).notNull(),
    mediaType: varchar("media_type", { length: 160 }).notNull(),
    evidenceBytes: bytea("evidence_bytes").notNull(),
    capturedAt: timestamp("captured_at", { withTimezone: true }).notNull(),
    storageMode: varchar("storage_mode", { length: 40 })
      .$type<"postgres_inline_bytea_v1">()
      .notNull(),
    custodyRequestSha256: varchar("custody_request_sha256", { length: 71 }).notNull(),
    custodyRequestJson: jsonb("custody_request_json").$type<Record<string, unknown>>().notNull(),
    custodyReceiptSha256: varchar("custody_receipt_sha256", { length: 71 }).notNull(),
    custodyReceiptJson: jsonb("custody_receipt_json").$type<Record<string, unknown>>().notNull(),
    registeredByUserId: uuid("registered_by_user_id")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    idempotencyKey: varchar("idempotency_key", { length: 120 }).notNull(),
    recordedAt: timestamp("recorded_at", { withTimezone: true }).notNull(),
  },
  (table) => [
    unique("foundry_derivative_terms_custody_artifact_unique").on(table.artifactId),
    unique("foundry_derivative_terms_custody_receipt_unique").on(table.custodyReceiptSha256),
    unique("foundry_derivative_terms_custody_id_receipt_unique").on(
      table.id,
      table.custodyReceiptSha256,
    ),
    unique("foundry_derivative_terms_custody_exact_unique").on(
      table.id,
      table.artifactId,
      table.sha256,
      table.sizeBytes,
      table.mediaType,
      table.capturedAt,
      table.custodyReceiptSha256,
    ),
    unique("foundry_derivative_terms_custody_actor_idem_unique").on(
      table.registeredByUserId,
      table.idempotencyKey,
    ),
    index("foundry_derivative_terms_custody_digest_idx").on(
      table.sha256,
      table.sizeBytes,
      table.recordedAt,
    ),
  ],
);

/**
 * Platform-admin review receipts over exact 0054 approval metadata and exact
 * custodied bytes. Acceptance is only for a later registry attestation; it is
 * never an execution approval.
 */
export const foundryDerivativeRightsReviewsV1 = pgTable(
  "foundry_derivative_rights_reviews_v1",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    authority: varchar("authority", { length: 20 }).$type<"none">().notNull(),
    executionEligible: boolean("execution_eligible").$type<false>().notNull(),
    approvalId: varchar("approval_id", { length: 120 })
      .notNull()
      .references(() => foundryDerivativeRightsApprovals.approvalId, { onDelete: "restrict" }),
    derivativeRightsApprovalSha256: varchar("derivative_rights_approval_sha256", { length: 71 })
      .notNull(),
    termsCustodyId: uuid("terms_custody_id").notNull(),
    termsCustodyReceiptSha256: varchar("terms_custody_receipt_sha256", { length: 71 }).notNull(),
    decision: varchar("decision", { length: 48 })
      .$type<"accepted_for_registry_attestation" | "rejected">()
      .notNull(),
    rationale: text("rationale").notNull(),
    reviewRequestSha256: varchar("review_request_sha256", { length: 71 }).notNull(),
    reviewRequestJson: jsonb("review_request_json").$type<Record<string, unknown>>().notNull(),
    reviewReceiptSha256: varchar("review_receipt_sha256", { length: 71 }).notNull(),
    reviewReceiptJson: jsonb("review_receipt_json").$type<Record<string, unknown>>().notNull(),
    reviewedByUserId: uuid("reviewed_by_user_id")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    idempotencyKey: varchar("idempotency_key", { length: 120 }).notNull(),
    reviewedAt: timestamp("reviewed_at", { withTimezone: true }).notNull(),
    recordedAt: timestamp("recorded_at", { withTimezone: true }).notNull(),
  },
  (table) => [
    foreignKey({
      columns: [table.termsCustodyId, table.termsCustodyReceiptSha256],
      foreignColumns: [
        foundryDerivativeTermsEvidenceCustodyV1.id,
        foundryDerivativeTermsEvidenceCustodyV1.custodyReceiptSha256,
      ],
      name: "foundry_derivative_rights_review_custody_fk",
    }).onDelete("restrict"),
    unique("foundry_derivative_rights_review_approval_unique").on(table.approvalId),
    unique("foundry_derivative_rights_review_receipt_unique").on(table.reviewReceiptSha256),
    unique("foundry_derivative_rights_review_actor_idem_unique").on(
      table.reviewedByUserId,
      table.idempotencyKey,
    ),
    index("foundry_derivative_rights_review_custody_idx").on(
      table.termsCustodyId,
      table.reviewedAt,
    ),
  ],
);

/**
 * Database-authenticated attestations over the exact accepted derivative-rights
 * review, approval, and terms-evidence custody graph. Registry authority is
 * evidence authority only; these rows remain execution-ineligible.
 */
export const foundryDerivativeRightsRegistryAttestationsV1 = pgTable(
  "foundry_derivative_rights_registry_attestations_v1",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    registryAuthority: varchar("registry_authority", { length: 64 })
      .$type<"authenticated_registry_attestation_v1">()
      .notNull(),
    executionEligible: boolean("execution_eligible").$type<false>().notNull(),
    approvalId: varchar("approval_id", { length: 120 })
      .notNull()
      .references(() => foundryDerivativeRightsApprovals.approvalId, { onDelete: "restrict" }),
    derivativeRightsApprovalSha256: varchar("derivative_rights_approval_sha256", {
      length: 71,
    }).notNull(),
    reviewId: uuid("review_id")
      .notNull()
      .references(() => foundryDerivativeRightsReviewsV1.id, { onDelete: "restrict" }),
    reviewReceiptSha256: varchar("review_receipt_sha256", { length: 71 }).notNull(),
    termsCustodyId: uuid("terms_custody_id")
      .notNull()
      .references(() => foundryDerivativeTermsEvidenceCustodyV1.id, { onDelete: "restrict" }),
    termsCustodyReceiptSha256: varchar("terms_custody_receipt_sha256", { length: 71 }).notNull(),
    policyVersion: varchar("policy_version", { length: 120 }).notNull(),
    policyDefinitionSha256: varchar("policy_definition_sha256", { length: 71 }).notNull(),
    policyGeneration: bigint("policy_generation", { mode: "bigint" }).notNull(),
    jobSubjectSha256: varchar("job_subject_sha256", { length: 71 }).notNull(),
    ingestManifestSha256: varchar("ingest_manifest_sha256", { length: 71 }).notNull(),
    stageId: varchar("stage_id", { length: 120 }).notNull(),
    operationId: varchar("operation_id", { length: 96 })
      .$type<"normalize_mesh_glb/v0">()
      .notNull(),
    derivativeClass: varchar("derivative_class", { length: 120 })
      .$type<"lossless_internal_format_normalization">()
      .notNull(),
    assetId: varchar("asset_id", { length: 120 }).notNull(),
    approvalExpiresAt: timestamp("approval_expires_at", { withTimezone: true }).notNull(),
    registrationRequestSha256: varchar("registration_request_sha256", { length: 71 }).notNull(),
    registrationRequestJson: jsonb("registration_request_json")
      .$type<Record<string, unknown>>()
      .notNull(),
    registryAttestationSha256: varchar("registry_attestation_sha256", { length: 71 }).notNull(),
    registryAttestationJson: jsonb("registry_attestation_json")
      .$type<Record<string, unknown>>()
      .notNull(),
    attestedByUserId: uuid("attested_by_user_id")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    idempotencyKey: varchar("idempotency_key", { length: 120 }).notNull(),
    attestedAt: timestamp("attested_at", { withTimezone: true }).notNull(),
    recordedAt: timestamp("recorded_at", { withTimezone: true }).notNull(),
  },
  (table) => [
    unique("foundry_derivative_registry_attestation_review_unique").on(table.reviewId),
    unique("foundry_derivative_registry_attestation_approval_unique").on(table.approvalId),
    unique("foundry_derivative_registry_attestation_digest_unique").on(
      table.registryAttestationSha256,
    ),
    unique("foundry_derivative_registry_attestation_exact_unique").on(
      table.id,
      table.registryAttestationSha256,
      table.approvalId,
      table.derivativeRightsApprovalSha256,
      table.reviewId,
      table.reviewReceiptSha256,
      table.termsCustodyId,
      table.termsCustodyReceiptSha256,
    ),
    unique("foundry_derivative_registry_attestation_actor_idem_unique").on(
      table.attestedByUserId,
      table.idempotencyKey,
    ),
    index("foundry_derivative_registry_attestation_policy_idx").on(
      table.policyVersion,
      table.policyDefinitionSha256,
      table.policyGeneration,
      table.attestedAt,
    ),
  ],
);

/** Append-only, authenticated invalidation of a registry attestation. */
export const foundryDerivativeRightsRegistryAttestationRevocationsV1 = pgTable(
  "foundry_derivative_rights_registry_attestation_revocations_v1",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    registryAuthority: varchar("registry_authority", { length: 64 })
      .$type<"authenticated_registry_attestation_v1">()
      .notNull(),
    executionEligible: boolean("execution_eligible").$type<false>().notNull(),
    attestationId: uuid("attestation_id")
      .notNull()
      .references(() => foundryDerivativeRightsRegistryAttestationsV1.id, { onDelete: "restrict" }),
    registryAttestationSha256: varchar("registry_attestation_sha256", { length: 71 }).notNull(),
    reason: text("reason").notNull(),
    revocationRequestSha256: varchar("revocation_request_sha256", { length: 71 }).notNull(),
    revocationRequestJson: jsonb("revocation_request_json")
      .$type<Record<string, unknown>>()
      .notNull(),
    attestationRevocationSha256: varchar("attestation_revocation_sha256", { length: 71 }).notNull(),
    attestationRevocationJson: jsonb("attestation_revocation_json")
      .$type<Record<string, unknown>>()
      .notNull(),
    revokedByUserId: uuid("revoked_by_user_id")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    idempotencyKey: varchar("idempotency_key", { length: 120 }).notNull(),
    revokedAt: timestamp("revoked_at", { withTimezone: true }).notNull(),
    recordedAt: timestamp("recorded_at", { withTimezone: true }).notNull(),
  },
  (table) => [
    unique("foundry_derivative_registry_revocation_one_unique").on(table.attestationId),
    unique("foundry_derivative_registry_revocation_digest_unique").on(
      table.attestationRevocationSha256,
    ),
    unique("foundry_derivative_registry_revocation_actor_idem_unique").on(
      table.revokedByUserId,
      table.idempotencyKey,
    ),
  ],
);

/**
 * Atomic one-time reservation of an authority-none V1 derivative candidate.
 * This table intentionally has no foreign-key or service path to runtime
 * execution, provider-command, or release authority.
 */
export const foundryDerivativeExecutionAuthorizationCandidatesV1 = pgTable(
  "foundry_derivative_execution_authorization_candidates_v1",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    authority: varchar("authority", { length: 20 }).$type<"none">().notNull(),
    executionEligible: boolean("execution_eligible").$type<false>().notNull(),
    dispatchEnabled: boolean("dispatch_enabled").$type<false>().notNull(),
    outputDisposition: varchar("output_disposition", { length: 40 })
      .$type<"quarantine_only">()
      .notNull(),
    approvalId: varchar("approval_id", { length: 120 })
      .notNull()
      .references(() => foundryDerivativeRightsApprovals.approvalId, { onDelete: "restrict" }),
    derivativeRightsApprovalSha256: varchar("derivative_rights_approval_sha256", {
      length: 71,
    }).notNull(),
    reviewId: uuid("review_id")
      .notNull()
      .references(() => foundryDerivativeRightsReviewsV1.id, { onDelete: "restrict" }),
    reviewReceiptSha256: varchar("review_receipt_sha256", { length: 71 }).notNull(),
    attestationId: uuid("attestation_id")
      .notNull()
      .references(() => foundryDerivativeRightsRegistryAttestationsV1.id, { onDelete: "restrict" }),
    registryAttestationSha256: varchar("registry_attestation_sha256", { length: 71 }).notNull(),
    baseExecutionSubjectSha256: varchar("base_execution_subject_sha256", { length: 71 }).notNull(),
    baseExecutionSubjectJson: jsonb("base_execution_subject_json")
      .$type<Record<string, unknown>>()
      .notNull(),
    projectId: varchar("project_id", { length: 120 }).notNull(),
    jobId: varchar("job_id", { length: 120 })
      .notNull()
      .references(() => foundryJobs.jobId, { onDelete: "restrict" }),
    jobSpecSha256: varchar("job_spec_sha256", { length: 71 }).notNull(),
    executionEnvelopeSha256: varchar("execution_envelope_sha256", { length: 71 }).notNull(),
    ingestManifestSha256: varchar("ingest_manifest_sha256", { length: 71 }).notNull(),
    jobSubjectSha256: varchar("job_subject_sha256", { length: 71 }).notNull(),
    workerProfileSha256: varchar("worker_profile_sha256", { length: 71 }).notNull(),
    operationClass: varchar("operation_class", { length: 40 })
      .$type<"deterministic_transformation">()
      .notNull(),
    bindingSetSha256: varchar("binding_set_sha256", { length: 71 }).notNull(),
    bindingSetJson: jsonb("binding_set_json").$type<Record<string, unknown>>().notNull(),
    restrictionLineageSetSha256: varchar("restriction_lineage_set_sha256", { length: 71 }).notNull(),
    restrictionLineageSetJson: jsonb("restriction_lineage_set_json")
      .$type<Record<string, unknown>>()
      .notNull(),
    outputPolicySha256: varchar("output_policy_sha256", { length: 71 }).notNull(),
    outputPolicyJson: jsonb("output_policy_json").$type<Record<string, unknown>>().notNull(),
    reservationRequestSha256: varchar("reservation_request_sha256", { length: 71 }).notNull(),
    reservationRequestJson: jsonb("reservation_request_json")
      .$type<Record<string, unknown>>()
      .notNull(),
    reservationId: uuid("reservation_id").defaultRandom().notNull(),
    candidateReservationReceiptSha256: varchar("candidate_reservation_receipt_sha256", {
      length: 71,
    }).notNull(),
    candidateReservationReceiptJson: jsonb("candidate_reservation_receipt_json")
      .$type<Record<string, unknown>>()
      .notNull(),
    candidateSha256: varchar("candidate_sha256", { length: 71 }).notNull(),
    candidateJson: jsonb("candidate_json").$type<Record<string, unknown>>().notNull(),
    reservedByUserId: uuid("reserved_by_user_id")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    idempotencyKey: varchar("idempotency_key", { length: 120 }).notNull(),
    assembledAt: timestamp("assembled_at", { withTimezone: true }).notNull(),
    recordedAt: timestamp("recorded_at", { withTimezone: true }).notNull(),
  },
  (table) => [
    unique("foundry_derivative_candidate_review_unique").on(table.reviewId),
    unique("foundry_derivative_candidate_approval_unique").on(table.approvalId),
    unique("foundry_derivative_candidate_attestation_unique").on(table.attestationId),
    unique("foundry_derivative_candidate_base_subject_unique").on(
      table.baseExecutionSubjectSha256,
    ),
    unique("foundry_derivative_candidate_subject_unique").on(table.candidateSha256),
    unique("foundry_derivative_candidate_reservation_unique").on(table.reservationId),
    unique("foundry_derivative_candidate_reservation_receipt_unique").on(
      table.candidateReservationReceiptSha256,
    ),
    unique("foundry_derivative_candidate_actor_idem_unique").on(
      table.reservedByUserId,
      table.idempotencyKey,
    ),
    index("foundry_derivative_candidate_job_idx").on(
      table.jobId,
      table.projectId,
      table.assembledAt,
    ),
  ],
);

export const foundryComputeApprovals = pgTable("foundry_compute_approvals", {
  approvalId: varchar("approval_id", { length: 120 }).primaryKey(),
  jobId: varchar("job_id", { length: 120 }).notNull(),
  projectId: varchar("project_id", { length: 120 }).notNull(),
  executionEnvelopeSha256: varchar("execution_envelope_sha256", { length: 71 }).notNull(),
  jobSpecSha256: varchar("job_spec_sha256", { length: 71 }).notNull(),
  providerKind: varchar("provider_kind", { length: 40 }).$type<FoundryDbProviderKind>().notNull(),
  providerAdapterId: varchar("provider_adapter_id", { length: 120 }).notNull(),
  providerAdapterVersion: varchar("provider_adapter_version", { length: 120 }).notNull(),
  providerAdapterArtifactSha256: varchar("provider_adapter_artifact_sha256", { length: 71 }).notNull(),
  providerDeploymentSha256: varchar("provider_deployment_sha256", { length: 71 }).notNull(),
  jobBudgetCapMicroUsd: bigint("job_budget_cap_micro_usd", { mode: "bigint" }).notNull(),
  maximumCostMicroUsd: bigint("maximum_cost_micro_usd", { mode: "bigint" }).notNull(),
  approvedBy: varchar("approved_by", { length: 160 }).notNull(),
  approvedAt: timestamp("approved_at", { withTimezone: true }).notNull(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  computeApprovalSha256: varchar("compute_approval_sha256", { length: 71 }).notNull(),
  computeApprovalJson: jsonb("compute_approval_json").$type<Record<string, unknown>>().notNull(),
  registeredByUserId: uuid("registered_by_user_id").notNull().references(() => users.id, { onDelete: "restrict" }),
  idempotencyKey: varchar("idempotency_key", { length: 160 }).notNull(),
  requestDigest: varchar("request_digest", { length: 71 }).notNull(),
  registeredAt: timestamp("registered_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  foreignKey({
    columns: [
      table.jobId, table.projectId, table.executionEnvelopeSha256, table.jobSpecSha256,
      table.providerKind, table.providerAdapterId, table.providerAdapterVersion,
      table.jobBudgetCapMicroUsd, table.providerAdapterArtifactSha256,
      table.providerDeploymentSha256, table.approvalId,
    ],
    foreignColumns: [
      foundryJobs.jobId, foundryJobs.projectId, foundryJobs.executionEnvelopeSha256,
      foundryJobs.jobSpecSha256, foundryJobs.providerKind, foundryJobs.providerAdapterId,
      foundryJobs.providerAdapterVersion, foundryJobs.budgetCapMicroUsd,
      foundryJobs.providerAdapterArtifactSha256, foundryJobs.providerDeploymentSha256,
      foundryJobs.computeApprovalId,
    ],
    name: "foundry_compute_job_fk",
  }).onDelete("restrict"),
  unique("foundry_compute_actor_idempotency_unique").on(table.registeredByUserId, table.idempotencyKey),
  unique("foundry_compute_exact_subject_unique").on(
    table.approvalId, table.jobId, table.projectId, table.executionEnvelopeSha256, table.jobSpecSha256,
    table.providerKind, table.providerAdapterId, table.providerAdapterVersion,
    table.providerAdapterArtifactSha256, table.providerDeploymentSha256, table.maximumCostMicroUsd,
    table.computeApprovalSha256,
  ),
]);

export const foundryExecutionConfirmations = pgTable("foundry_execution_confirmations", {
  confirmationId: varchar("confirmation_id", { length: 120 }).primaryKey(),
  jobId: varchar("job_id", { length: 120 }).notNull(),
  projectId: varchar("project_id", { length: 120 }).notNull(),
  executionEnvelopeSha256: varchar("execution_envelope_sha256", { length: 71 }).notNull(),
  jobSpecSha256: varchar("job_spec_sha256", { length: 71 }).notNull(),
  confirmedBy: varchar("confirmed_by", { length: 160 }).notNull(),
  confirmedAt: timestamp("confirmed_at", { withTimezone: true }).notNull(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  confirmationSha256: varchar("confirmation_sha256", { length: 71 }).notNull(),
  confirmationJson: jsonb("confirmation_json").$type<Record<string, unknown>>().notNull(),
  registeredByUserId: uuid("registered_by_user_id").notNull().references(() => users.id, { onDelete: "restrict" }),
  idempotencyKey: varchar("idempotency_key", { length: 160 }).notNull(),
  requestDigest: varchar("request_digest", { length: 71 }).notNull(),
  registeredAt: timestamp("registered_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  foreignKey({
    columns: [table.jobId, table.projectId, table.executionEnvelopeSha256, table.jobSpecSha256],
    foreignColumns: [foundryJobs.jobId, foundryJobs.projectId, foundryJobs.executionEnvelopeSha256, foundryJobs.jobSpecSha256],
    name: "foundry_confirmations_job_fk",
  }).onDelete("restrict"),
  unique("foundry_confirmations_actor_idempotency_unique").on(table.registeredByUserId, table.idempotencyKey),
  unique("foundry_confirmations_exact_subject_unique").on(
    table.confirmationId, table.jobId, table.projectId, table.executionEnvelopeSha256,
    table.jobSpecSha256, table.confirmationSha256,
  ),
]);

export const foundryExecutions = pgTable("foundry_executions", {
  id: uuid("id").primaryKey().defaultRandom(),
  jobId: varchar("job_id", { length: 120 }).notNull(),
  projectId: varchar("project_id", { length: 120 }).notNull(),
  executionEnvelopeSha256: varchar("execution_envelope_sha256", { length: 71 }).notNull(),
  executionSubjectSha256: varchar("execution_subject_sha256", { length: 71 }).notNull(),
  executionSubjectJson: jsonb("execution_subject_json").$type<Record<string, unknown>>().notNull(),
  jobSpecSha256: varchar("job_spec_sha256", { length: 71 }).notNull(),
  providerPlanSha256: varchar("provider_plan_sha256", { length: 71 }).notNull(),
  reviewedIngestManifestSha256: varchar("reviewed_ingest_manifest_sha256", { length: 71 }).notNull(),
  intakeAdmissionResultSha256: varchar("intake_admission_result_sha256", { length: 71 }).notNull(),
  intakeStagingIndexSha256: varchar("intake_staging_index_sha256", { length: 71 }).notNull(),
  executionPolicySha256: varchar("execution_policy_sha256", { length: 71 }).notNull(),
  pricingSnapshotSha256: varchar("pricing_snapshot_sha256", { length: 71 }).notNull(),
  providerKind: varchar("provider_kind", { length: 40 }).$type<FoundryDbProviderKind>().notNull(),
  providerAdapterId: varchar("provider_adapter_id", { length: 120 }).notNull(),
  providerAdapterVersion: varchar("provider_adapter_version", { length: 120 }).notNull(),
  providerAdapterArtifactSha256: varchar("provider_adapter_artifact_sha256", { length: 71 }).notNull(),
  providerDeploymentSha256: varchar("provider_deployment_sha256", { length: 71 }).notNull(),
  trustedWorkerProfileSetSha256: varchar("trusted_worker_profile_set_sha256", { length: 71 }).notNull(),
  trustedWorkerProfileCount: integer("trusted_worker_profile_count").notNull(),
  pricingCurrency: char("pricing_currency", { length: 3 }).$type<"USD">().notNull(),
  pricingSnapshotExpiresAt: timestamp("pricing_snapshot_expires_at", { withTimezone: true }).notNull(),
  budgetCapMicroUsd: bigint("budget_cap_micro_usd", { mode: "bigint" }).notNull(),
  costWarningMicroUsd: bigint("cost_warning_micro_usd", { mode: "bigint" }).notNull(),
  costHardStopMicroUsd: bigint("cost_hard_stop_micro_usd", { mode: "bigint" }).notNull(),
  terminationReserveMicroUsd: bigint("termination_reserve_micro_usd", { mode: "bigint" }).notNull(),
  absoluteCostCapMicroUsd: bigint("absolute_cost_cap_micro_usd", { mode: "bigint" }).notNull(),
  maxWallClockSeconds: integer("max_wall_clock_seconds").notNull(),
  orchestrationOverheadSeconds: integer("orchestration_overhead_seconds").notNull(),
  cancelGraceSeconds: integer("cancel_grace_seconds").notNull(),
  terminationGraceSeconds: integer("termination_grace_seconds").notNull(),
  workerSelfDeadlineSeconds: integer("worker_self_deadline_seconds").notNull(),
  terminationConfirmationTimeoutSeconds: integer("termination_confirmation_timeout_seconds").notNull(),
  providerMaximumExecutionTtlSeconds: integer("provider_maximum_execution_ttl_seconds").notNull(),
  dispatchDeadline: timestamp("dispatch_deadline", { withTimezone: true }).notNull(),
  rightsApprovalId: varchar("rights_approval_id", { length: 120 }).notNull(),
  rightsApprovalSha256: varchar("rights_approval_sha256", { length: 71 }).notNull(),
  rightsPolicyVersion: varchar("rights_policy_version", { length: 120 }).notNull(),
  rightsPolicyDefinitionSha256: varchar("rights_policy_definition_sha256", { length: 71 }).notNull(),
  rightsPolicyEvidenceSha256: varchar("rights_policy_evidence_sha256", { length: 71 }).notNull(),
  rightsPolicyGeneration: bigint("rights_policy_generation", { mode: "bigint" }).notNull(),
  rightsPolicyMaximumApprovalTtlSeconds: integer("rights_policy_maximum_approval_ttl_seconds").notNull(),
  computeApprovalId: varchar("compute_approval_id", { length: 120 }),
  computeApprovalSha256: varchar("compute_approval_sha256", { length: 71 }),
  computeApprovalMaximumCostMicroUsd: bigint("compute_approval_maximum_cost_micro_usd", { mode: "bigint" }),
  confirmationId: varchar("confirmation_id", { length: 120 }).notNull(),
  confirmationSha256: varchar("confirmation_sha256", { length: 71 }).notNull(),
  state: varchar("state", { length: 40 }).$type<FoundryDbExecutionState>().notNull().default("admitted_awaiting_executor"),
  lastAttemptOrdinal: integer("last_attempt_ordinal").notNull().default(0),
  fencingToken: bigint("fencing_token", { mode: "bigint" }).notNull().default(0n),
  totalCostMicroUsd: bigint("total_cost_micro_usd", { mode: "bigint" }).notNull().default(0n),
  cancelRequested: boolean("cancel_requested").notNull().default(false),
  revision: bigint("revision", { mode: "bigint" }).notNull().default(0n),
  admittedByUserId: uuid("admitted_by_user_id").notNull().references(() => users.id, { onDelete: "restrict" }),
  idempotencyKey: varchar("idempotency_key", { length: 160 }).notNull(),
  requestDigest: varchar("request_digest", { length: 71 }).notNull(),
  admittedAt: timestamp("admitted_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  foreignKey({
    columns: [
      table.jobId, table.projectId, table.executionEnvelopeSha256, table.jobSpecSha256,
      table.providerPlanSha256, table.reviewedIngestManifestSha256, table.executionPolicySha256,
      table.intakeAdmissionResultSha256, table.intakeStagingIndexSha256, table.pricingSnapshotSha256,
      table.providerKind, table.providerAdapterId, table.providerAdapterVersion,
      table.providerAdapterArtifactSha256, table.providerDeploymentSha256,
      table.trustedWorkerProfileSetSha256, table.trustedWorkerProfileCount,
      table.pricingSnapshotExpiresAt, table.budgetCapMicroUsd,
      table.costWarningMicroUsd, table.costHardStopMicroUsd, table.terminationReserveMicroUsd,
      table.absoluteCostCapMicroUsd, table.maxWallClockSeconds, table.orchestrationOverheadSeconds,
      table.cancelGraceSeconds,
      table.terminationGraceSeconds, table.workerSelfDeadlineSeconds,
      table.terminationConfirmationTimeoutSeconds, table.providerMaximumExecutionTtlSeconds,
      table.dispatchDeadline,
    ],
    foreignColumns: [
      foundryJobs.jobId, foundryJobs.projectId, foundryJobs.executionEnvelopeSha256,
      foundryJobs.jobSpecSha256, foundryJobs.providerPlanSha256,
      foundryJobs.reviewedIngestManifestSha256, foundryJobs.executionPolicySha256,
      foundryJobs.intakeAdmissionResultSha256, foundryJobs.intakeStagingIndexSha256,
      foundryJobs.pricingSnapshotSha256, foundryJobs.providerKind, foundryJobs.providerAdapterId,
      foundryJobs.providerAdapterVersion, foundryJobs.providerAdapterArtifactSha256,
      foundryJobs.providerDeploymentSha256, foundryJobs.trustedWorkerProfileSetSha256,
      foundryJobs.trustedWorkerProfileCount, foundryJobs.pricingSnapshotExpiresAt,
      foundryJobs.budgetCapMicroUsd, foundryJobs.costWarningMicroUsd,
      foundryJobs.costHardStopMicroUsd, foundryJobs.terminationReserveMicroUsd,
      foundryJobs.absoluteCostCapMicroUsd, foundryJobs.maxWallClockSeconds,
      foundryJobs.orchestrationOverheadSeconds, foundryJobs.cancelGraceSeconds,
      foundryJobs.terminationGraceSeconds,
      foundryJobs.workerSelfDeadlineSeconds, foundryJobs.terminationConfirmationTimeoutSeconds,
      foundryJobs.providerMaximumExecutionTtlSeconds, foundryJobs.dispatchDeadline,
    ],
    name: "foundry_exec_job_fk",
  }).onDelete("restrict"),
  foreignKey({
    columns: [
      table.rightsApprovalId, table.jobId, table.projectId, table.executionEnvelopeSha256,
      table.jobSpecSha256, table.reviewedIngestManifestSha256, table.executionPolicySha256,
      table.rightsPolicyVersion, table.rightsPolicyDefinitionSha256,
      table.rightsPolicyEvidenceSha256, table.rightsPolicyGeneration,
      table.rightsPolicyMaximumApprovalTtlSeconds,
      table.rightsApprovalSha256,
    ],
    foreignColumns: [
      foundryRightsApprovals.id, foundryRightsApprovals.jobId, foundryRightsApprovals.projectId,
      foundryRightsApprovals.executionEnvelopeSha256, foundryRightsApprovals.jobSpecSha256,
      foundryRightsApprovals.reviewedIngestManifestSha256,
      foundryRightsApprovals.executionPolicySha256, foundryRightsApprovals.policyVersion,
      foundryRightsApprovals.policyDefinitionSha256, foundryRightsApprovals.policyEvidenceSha256,
      foundryRightsApprovals.policyGeneration,
      foundryRightsApprovals.policyMaximumApprovalTtlSeconds,
      foundryRightsApprovals.rightsApprovalSha256,
    ],
    name: "foundry_exec_rights_fk",
  }).onDelete("restrict"),
  foreignKey({
    columns: [
      table.computeApprovalId, table.jobId, table.projectId, table.executionEnvelopeSha256,
      table.jobSpecSha256, table.providerKind, table.providerAdapterId,
      table.providerAdapterVersion, table.providerAdapterArtifactSha256,
      table.providerDeploymentSha256, table.computeApprovalMaximumCostMicroUsd,
      table.computeApprovalSha256,
    ],
    foreignColumns: [
      foundryComputeApprovals.approvalId, foundryComputeApprovals.jobId,
      foundryComputeApprovals.projectId, foundryComputeApprovals.executionEnvelopeSha256,
      foundryComputeApprovals.jobSpecSha256, foundryComputeApprovals.providerKind,
      foundryComputeApprovals.providerAdapterId, foundryComputeApprovals.providerAdapterVersion,
      foundryComputeApprovals.providerAdapterArtifactSha256,
      foundryComputeApprovals.providerDeploymentSha256,
      foundryComputeApprovals.maximumCostMicroUsd,
      foundryComputeApprovals.computeApprovalSha256,
    ],
    name: "foundry_exec_compute_fk",
  }).onDelete("restrict"),
  foreignKey({
    columns: [
      table.confirmationId, table.jobId, table.projectId,
      table.executionEnvelopeSha256, table.jobSpecSha256, table.confirmationSha256,
    ],
    foreignColumns: [
      foundryExecutionConfirmations.confirmationId, foundryExecutionConfirmations.jobId,
      foundryExecutionConfirmations.projectId,
      foundryExecutionConfirmations.executionEnvelopeSha256,
      foundryExecutionConfirmations.jobSpecSha256,
      foundryExecutionConfirmations.confirmationSha256,
    ],
    name: "foundry_exec_confirmation_fk",
  }).onDelete("restrict"),
  unique("foundry_exec_job_unique").on(table.jobId, table.projectId),
  unique("foundry_exec_confirmation_consumption_unique").on(table.confirmationId),
  unique("foundry_exec_actor_idempotency_unique").on(table.admittedByUserId, table.idempotencyKey),
  unique("foundry_exec_scope_unique").on(
    table.id, table.projectId, table.jobId, table.executionEnvelopeSha256,
    table.providerKind, table.providerAdapterId, table.providerAdapterVersion,
    table.providerAdapterArtifactSha256, table.providerDeploymentSha256,
  ),
  unique("foundry_exec_subject_unique").on(table.id, table.executionSubjectSha256),
  unique("foundry_exec_pricing_unique").on(table.id, table.pricingCurrency, table.pricingSnapshotSha256),
  index("foundry_exec_project_state_idx").on(table.projectId, table.state, table.updatedAt),
]);

export const foundryAttempts = pgTable("foundry_attempts", {
  id: uuid("id").primaryKey().defaultRandom(),
  executionId: uuid("execution_id").notNull(),
  projectId: varchar("project_id", { length: 120 }).notNull(),
  jobId: varchar("job_id", { length: 120 }).notNull(),
  executionEnvelopeSha256: varchar("execution_envelope_sha256", { length: 71 }).notNull(),
  executionSubjectSha256: varchar("execution_subject_sha256", { length: 71 }).notNull(),
  providerKind: varchar("provider_kind", { length: 40 }).$type<FoundryDbProviderKind>().notNull(),
  providerAdapterId: varchar("provider_adapter_id", { length: 120 }).notNull(),
  providerAdapterVersion: varchar("provider_adapter_version", { length: 120 }).notNull(),
  providerAdapterArtifactSha256: varchar("provider_adapter_artifact_sha256", { length: 71 }).notNull(),
  providerDeploymentSha256: varchar("provider_deployment_sha256", { length: 71 }).notNull(),
  attemptOrdinal: integer("attempt_ordinal").notNull(),
  fencingToken: bigint("fencing_token", { mode: "bigint" }).notNull(),
  state: varchar("state", { length: 40 }).$type<Exclude<FoundryDbExecutionState, "admitted_awaiting_executor">>().notNull().default("authorized"),
  providerExecutionRef: varchar("provider_execution_ref", { length: 240 }),
  providerAttemptRef: varchar("provider_attempt_ref", { length: 240 }),
  leaseOwner: varchar("lease_owner", { length: 160 }),
  leaseExpiresAt: timestamp("lease_expires_at", { withTimezone: true }),
  observedCostMicroUsd: bigint("observed_cost_micro_usd", { mode: "bigint" }).notNull().default(0n),
  cancelRequested: boolean("cancel_requested").notNull().default(false),
  revision: bigint("revision", { mode: "bigint" }).notNull().default(0n),
  createdByUserId: uuid("created_by_user_id").notNull().references(() => users.id, { onDelete: "restrict" }),
  idempotencyKey: varchar("idempotency_key", { length: 160 }).notNull(),
  requestDigest: varchar("request_digest", { length: 71 }).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  submittedAt: timestamp("submitted_at", { withTimezone: true }),
  startedAt: timestamp("started_at", { withTimezone: true }),
  finishedAt: timestamp("finished_at", { withTimezone: true }),
  wallClockDeadline: timestamp("wall_clock_deadline", { withTimezone: true }),
  cancelDeadline: timestamp("cancel_deadline", { withTimezone: true }),
  terminationDeadline: timestamp("termination_deadline", { withTimezone: true }),
  workerSelfDeadline: timestamp("worker_self_deadline", { withTimezone: true }),
  terminationConfirmationDeadline: timestamp("termination_confirmation_deadline", { withTimezone: true }),
  providerTtlDeadline: timestamp("provider_ttl_deadline", { withTimezone: true }),
}, (table) => [
  foreignKey({
    columns: [
      table.executionId, table.projectId, table.jobId, table.executionEnvelopeSha256,
      table.providerKind, table.providerAdapterId, table.providerAdapterVersion,
      table.providerAdapterArtifactSha256, table.providerDeploymentSha256,
    ],
    foreignColumns: [
      foundryExecutions.id, foundryExecutions.projectId, foundryExecutions.jobId,
      foundryExecutions.executionEnvelopeSha256, foundryExecutions.providerKind,
      foundryExecutions.providerAdapterId, foundryExecutions.providerAdapterVersion,
      foundryExecutions.providerAdapterArtifactSha256, foundryExecutions.providerDeploymentSha256,
    ],
    name: "foundry_attempt_execution_fk",
  }).onDelete("restrict"),
  foreignKey({
    columns: [table.executionId, table.executionSubjectSha256],
    foreignColumns: [foundryExecutions.id, foundryExecutions.executionSubjectSha256],
    name: "foundry_attempt_execution_subject_fk",
  }).onDelete("restrict"),
  unique("foundry_attempt_execution_ordinal_unique").on(table.executionId, table.attemptOrdinal),
  unique("foundry_attempt_execution_fence_unique").on(table.executionId, table.fencingToken),
  unique("foundry_attempt_actor_idempotency_unique").on(table.createdByUserId, table.idempotencyKey),
  unique("foundry_attempt_scope_unique").on(
    table.id, table.executionId, table.projectId, table.jobId, table.executionEnvelopeSha256,
    table.providerKind, table.providerAdapterId, table.providerAdapterVersion,
    table.providerAdapterArtifactSha256, table.providerDeploymentSha256,
    table.attemptOrdinal, table.fencingToken,
  ),
  unique("foundry_attempt_subject_unique").on(
    table.id, table.executionId, table.executionSubjectSha256,
  ),
  uniqueIndex("foundry_attempt_one_nonterminal_unique")
    .on(table.executionId)
    .where(sql`left(${table.state}, 9) <> 'terminal_'`),
  index("foundry_attempt_execution_state_idx").on(table.executionId, table.state, table.updatedAt),
]);

export const foundryStopIntents = pgTable("foundry_stop_intents", {
  id: uuid("id").primaryKey().defaultRandom(),
  executionId: uuid("execution_id").notNull(),
  projectId: varchar("project_id", { length: 120 }).notNull(),
  jobId: varchar("job_id", { length: 120 }).notNull(),
  executionEnvelopeSha256: varchar("execution_envelope_sha256", { length: 71 }).notNull(),
  executionSubjectSha256: varchar("execution_subject_sha256", { length: 71 }).notNull(),
  providerKind: varchar("provider_kind", { length: 40 }).$type<FoundryDbProviderKind>().notNull(),
  providerAdapterId: varchar("provider_adapter_id", { length: 120 }).notNull(),
  providerAdapterVersion: varchar("provider_adapter_version", { length: 120 }).notNull(),
  providerAdapterArtifactSha256: varchar("provider_adapter_artifact_sha256", { length: 71 }).notNull(),
  providerDeploymentSha256: varchar("provider_deployment_sha256", { length: 71 }).notNull(),
  attemptId: uuid("attempt_id").notNull(),
  attemptOrdinal: integer("attempt_ordinal").notNull(),
  fencingToken: bigint("fencing_token", { mode: "bigint" }).notNull(),
  reasonCode: varchar("reason_code", { length: 40 }).$type<
    | "operator_cancel"
    | "kill_global"
    | "kill_provider"
    | "kill_project"
    | "kill_execution"
    | "kill_attempt"
    | "rights_revoked"
    | "cost_hard_stop"
    | "wall_clock_deadline"
    | "cancel_deadline"
    | "termination_deadline"
    | "worker_self_deadline"
    | "provider_ttl_deadline"
    | "checkpoint_effect_unknown"
  >().notNull(),
  priority: integer("priority").notNull(),
  targetTerminalState: varchar("target_terminal_state", { length: 40 }).$type<
    | "terminal_cancelled"
    | "terminal_killed"
    | "terminal_budget_exceeded"
    | "terminal_provider_lost"
  >().notNull(),
  sourceKind: varchar("source_kind", { length: 40 }).$type<
    | "operator_request"
    | "kill_switch_event"
    | "rights_policy_revocation"
    | "cost_observation"
    | "runtime_watchdog"
    | "provider_command"
  >().notNull(),
  sourceId: uuid("source_id").notNull(),
  sourceDigest: varchar("source_digest", { length: 71 }).notNull(),
  sourceRecordedAt: timestamp("source_recorded_at", { withTimezone: true }).notNull(),
  actorKind: varchar("actor_kind", { length: 30 }).$type<"operator" | "service" | "watchdog" | "system">().notNull(),
  actorKey: varchar("actor_key", { length: 160 }).notNull(),
  actorUserId: uuid("actor_user_id").references(() => users.id, { onDelete: "restrict" }),
  idempotencyKey: varchar("idempotency_key", { length: 160 }).notNull(),
  causationId: uuid("causation_id").notNull(),
  correlationId: uuid("correlation_id").notNull(),
  requestDigest: varchar("request_digest", { length: 71 }).notNull(),
  recordedAt: timestamp("recorded_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  foreignKey({
    columns: [
      table.attemptId, table.executionId, table.projectId, table.jobId,
      table.executionEnvelopeSha256, table.providerKind, table.providerAdapterId,
      table.providerAdapterVersion, table.providerAdapterArtifactSha256,
      table.providerDeploymentSha256, table.attemptOrdinal, table.fencingToken,
    ],
    foreignColumns: [
      foundryAttempts.id, foundryAttempts.executionId, foundryAttempts.projectId,
      foundryAttempts.jobId, foundryAttempts.executionEnvelopeSha256,
      foundryAttempts.providerKind, foundryAttempts.providerAdapterId,
      foundryAttempts.providerAdapterVersion, foundryAttempts.providerAdapterArtifactSha256,
      foundryAttempts.providerDeploymentSha256, foundryAttempts.attemptOrdinal,
      foundryAttempts.fencingToken,
    ],
    name: "foundry_stop_intent_attempt_fk",
  }).onDelete("restrict"),
  foreignKey({
    columns: [table.executionId, table.executionSubjectSha256],
    foreignColumns: [foundryExecutions.id, foundryExecutions.executionSubjectSha256],
    name: "foundry_stop_intent_subject_fk",
  }).onDelete("restrict"),
  unique("foundry_stop_intent_actor_idempotency_unique").on(table.actorKey, table.idempotencyKey),
  unique("foundry_stop_intent_source_unique").on(table.attemptId, table.sourceKind, table.sourceId),
  unique("foundry_stop_intent_exact_unique").on(
    table.id, table.executionId, table.attemptId, table.executionSubjectSha256, table.fencingToken,
  ),
]);

export const foundryPreparedProviderRequests = pgTable("foundry_prepared_provider_requests", {
  id: uuid("id").primaryKey().defaultRandom(),
  executionId: uuid("execution_id").notNull(),
  projectId: varchar("project_id", { length: 120 }).notNull(),
  jobId: varchar("job_id", { length: 120 }).notNull(),
  executionEnvelopeSha256: varchar("execution_envelope_sha256", { length: 71 }).notNull(),
  executionSubjectSha256: varchar("execution_subject_sha256", { length: 71 }).notNull(),
  providerKind: varchar("provider_kind", { length: 40 }).$type<FoundryDbProviderKind>().notNull(),
  providerAdapterId: varchar("provider_adapter_id", { length: 120 }).notNull(),
  providerAdapterVersion: varchar("provider_adapter_version", { length: 120 }).notNull(),
  providerAdapterArtifactSha256: varchar("provider_adapter_artifact_sha256", { length: 71 }).notNull(),
  providerDeploymentSha256: varchar("provider_deployment_sha256", { length: 71 }).notNull(),
  attemptId: uuid("attempt_id").notNull(),
  attemptOrdinal: integer("attempt_ordinal").notNull(),
  fencingToken: bigint("fencing_token", { mode: "bigint" }).notNull(),
  commandKind: varchar("command_kind", { length: 40 }).$type<FoundryDbProviderCommandKind>().notNull(),
  providerCommandId: uuid("provider_command_id").notNull(),
  commandSequence: bigint("command_sequence", { mode: "bigint" }).notNull(),
  stopIntentId: uuid("stop_intent_id"),
  providerRequestSha256: varchar("provider_request_sha256", { length: 71 }).notNull(),
  providerRequestJson: jsonb("provider_request_json").$type<Record<string, unknown>>().notNull(),
  providerRequestProfileId: varchar("provider_request_profile_id", { length: 120 }).notNull(),
  providerRequestProfileVersion: varchar("provider_request_profile_version", { length: 120 }).notNull(),
  providerRequestProfileSha256: varchar("provider_request_profile_sha256", { length: 71 }).notNull(),
  providerAdapterConfigurationSha256: varchar("provider_adapter_configuration_sha256", { length: 71 }).notNull(),
  providerIdempotencyKey: varchar("provider_idempotency_key", { length: 120 }).notNull(),
  providerClientRequestId: varchar("provider_client_request_id", { length: 120 }).notNull(),
  stageIds: jsonb("stage_ids").$type<string[]>().notNull(),
  maximumApiCallSeconds: integer("maximum_api_call_seconds").notNull(),
  preparedByActorKind: varchar("prepared_by_actor_kind", { length: 30 })
    .$type<"operator" | "service" | "watchdog" | "system">().notNull(),
  preparedByActorKey: varchar("prepared_by_actor_key", { length: 160 }).notNull(),
  preparedByUserId: uuid("prepared_by_user_id").references(() => users.id, { onDelete: "restrict" }),
  idempotencyKey: varchar("idempotency_key", { length: 160 }).notNull(),
  requestDigest: varchar("request_digest", { length: 71 }).notNull(),
  preparedAt: timestamp("prepared_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  foreignKey({
    columns: [
      table.attemptId, table.executionId, table.projectId, table.jobId,
      table.executionEnvelopeSha256, table.providerKind, table.providerAdapterId,
      table.providerAdapterVersion, table.providerAdapterArtifactSha256,
      table.providerDeploymentSha256, table.attemptOrdinal, table.fencingToken,
    ],
    foreignColumns: [
      foundryAttempts.id, foundryAttempts.executionId, foundryAttempts.projectId,
      foundryAttempts.jobId, foundryAttempts.executionEnvelopeSha256,
      foundryAttempts.providerKind, foundryAttempts.providerAdapterId,
      foundryAttempts.providerAdapterVersion, foundryAttempts.providerAdapterArtifactSha256,
      foundryAttempts.providerDeploymentSha256, foundryAttempts.attemptOrdinal,
      foundryAttempts.fencingToken,
    ],
    name: "foundry_prepared_request_attempt_fk",
  }).onDelete("restrict"),
  foreignKey({
    columns: [table.executionId, table.executionSubjectSha256],
    foreignColumns: [foundryExecutions.id, foundryExecutions.executionSubjectSha256],
    name: "foundry_prepared_request_subject_fk",
  }).onDelete("restrict"),
  foreignKey({
    columns: [
      table.stopIntentId, table.executionId, table.attemptId,
      table.executionSubjectSha256, table.fencingToken,
    ],
    foreignColumns: [
      foundryStopIntents.id, foundryStopIntents.executionId, foundryStopIntents.attemptId,
      foundryStopIntents.executionSubjectSha256, foundryStopIntents.fencingToken,
    ],
    name: "foundry_prepared_request_stop_intent_fk",
  }).onDelete("restrict"),
  foreignKey({
    columns: [
      table.providerRequestProfileSha256, table.providerRequestProfileId,
      table.providerRequestProfileVersion, table.providerKind, table.providerAdapterId,
      table.providerAdapterVersion, table.providerAdapterArtifactSha256,
      table.providerAdapterConfigurationSha256, table.providerDeploymentSha256,
    ],
    foreignColumns: [
      foundryProviderRequestProfiles.providerRequestProfileSha256,
      foundryProviderRequestProfiles.profileId, foundryProviderRequestProfiles.profileVersion,
      foundryProviderRequestProfiles.providerKind, foundryProviderRequestProfiles.providerAdapterId,
      foundryProviderRequestProfiles.providerAdapterVersion,
      foundryProviderRequestProfiles.providerAdapterArtifactSha256,
      foundryProviderRequestProfiles.providerAdapterConfigurationSha256,
      foundryProviderRequestProfiles.providerDeploymentSha256,
    ],
    name: "foundry_prepared_request_profile_fk",
  }).onDelete("restrict"),
  unique("foundry_prepared_request_actor_idem_unique").on(table.preparedByActorKey, table.idempotencyKey),
  unique("foundry_prepared_request_exact_unique").on(
    table.id, table.providerCommandId, table.executionId, table.attemptId,
    table.executionSubjectSha256, table.commandSequence, table.commandKind,
    table.providerRequestSha256, table.providerRequestProfileId,
    table.providerRequestProfileVersion, table.providerRequestProfileSha256,
    table.providerAdapterConfigurationSha256, table.providerIdempotencyKey,
    table.providerClientRequestId, table.maximumApiCallSeconds,
    table.preparedByActorKind, table.preparedByActorKey,
  ),
  unique("foundry_prepared_request_command_unique").on(table.providerCommandId),
  unique("foundry_prepared_request_attempt_sequence_unique").on(table.attemptId, table.commandSequence),
]);

export const foundryKillSwitches = pgTable("foundry_kill_switches", {
  id: uuid("id").primaryKey().defaultRandom(),
  scope: varchar("scope", { length: 20 }).$type<"global" | "provider" | "project" | "execution" | "attempt">().notNull(),
  targetKey: varchar("target_key", { length: 320 }).notNull(),
  projectId: varchar("project_id", { length: 120 }),
  executionId: uuid("execution_id"),
  attemptId: uuid("attempt_id"),
  jobId: varchar("job_id", { length: 120 }),
  executionEnvelopeSha256: varchar("execution_envelope_sha256", { length: 71 }),
  providerKind: varchar("provider_kind", { length: 40 }).$type<FoundryDbProviderKind>(),
  providerAdapterId: varchar("provider_adapter_id", { length: 120 }),
  providerAdapterVersion: varchar("provider_adapter_version", { length: 120 }),
  providerAdapterArtifactSha256: varchar("provider_adapter_artifact_sha256", { length: 71 }),
  providerDeploymentSha256: varchar("provider_deployment_sha256", { length: 71 }),
  attemptOrdinal: integer("attempt_ordinal"),
  fencingToken: bigint("fencing_token", { mode: "bigint" }),
  state: varchar("state", { length: 20 }).$type<"inactive" | "active">().notNull().default("inactive"),
  reason: text("reason").notNull(),
  lastChangedActorKind: varchar("last_changed_actor_kind", { length: 30 }).$type<"operator" | "service" | "watchdog" | "system">().notNull(),
  lastChangedActorKey: varchar("last_changed_actor_key", { length: 160 }).notNull(),
  lastChangedByUserId: uuid("last_changed_by_user_id").references(() => users.id, { onDelete: "restrict" }),
  revision: bigint("revision", { mode: "bigint" }).notNull().default(0n),
  createdByUserId: uuid("created_by_user_id").notNull().references(() => users.id, { onDelete: "restrict" }),
  idempotencyKey: varchar("idempotency_key", { length: 160 }).notNull(),
  requestDigest: varchar("request_digest", { length: 71 }).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  foreignKey({
    columns: [
      table.executionId, table.projectId, table.jobId, table.executionEnvelopeSha256,
      table.providerKind, table.providerAdapterId, table.providerAdapterVersion,
      table.providerAdapterArtifactSha256, table.providerDeploymentSha256,
    ],
    foreignColumns: [
      foundryExecutions.id, foundryExecutions.projectId, foundryExecutions.jobId,
      foundryExecutions.executionEnvelopeSha256, foundryExecutions.providerKind,
      foundryExecutions.providerAdapterId, foundryExecutions.providerAdapterVersion,
      foundryExecutions.providerAdapterArtifactSha256, foundryExecutions.providerDeploymentSha256,
    ],
    name: "foundry_kill_execution_fk",
  }).onDelete("restrict"),
  foreignKey({
    columns: [
      table.attemptId, table.executionId, table.projectId, table.jobId,
      table.executionEnvelopeSha256, table.providerKind, table.providerAdapterId,
      table.providerAdapterVersion, table.providerAdapterArtifactSha256,
      table.providerDeploymentSha256, table.attemptOrdinal, table.fencingToken,
    ],
    foreignColumns: [
      foundryAttempts.id, foundryAttempts.executionId, foundryAttempts.projectId,
      foundryAttempts.jobId, foundryAttempts.executionEnvelopeSha256,
      foundryAttempts.providerKind, foundryAttempts.providerAdapterId,
      foundryAttempts.providerAdapterVersion, foundryAttempts.providerAdapterArtifactSha256,
      foundryAttempts.providerDeploymentSha256, foundryAttempts.attemptOrdinal,
      foundryAttempts.fencingToken,
    ],
    name: "foundry_kill_attempt_fk",
  }).onDelete("restrict"),
  unique("foundry_kill_actor_idempotency_unique").on(table.createdByUserId, table.idempotencyKey),
  unique("foundry_kill_exact_scope_unique").on(table.id, table.scope, table.targetKey),
  uniqueIndex("foundry_kill_one_global_unique")
    .on(table.scope)
    .where(sql`${table.scope} = 'global'`),
  uniqueIndex("foundry_kill_one_provider_unique")
    .on(table.providerKind, table.providerAdapterId, table.providerAdapterVersion)
    .where(sql`${table.scope} = 'provider'`),
  uniqueIndex("foundry_kill_one_project_unique")
    .on(table.projectId)
    .where(sql`${table.scope} = 'project'`),
  uniqueIndex("foundry_kill_one_execution_unique")
    .on(table.executionId)
    .where(sql`${table.scope} = 'execution'`),
  uniqueIndex("foundry_kill_one_attempt_unique")
    .on(table.attemptId)
    .where(sql`${table.scope} = 'attempt'`),
  index("foundry_kill_active_scope_idx").on(table.state, table.scope, table.targetKey),
]);

export const foundryKillSwitchEvents = pgTable("foundry_kill_switch_events", {
  id: uuid("id").primaryKey().defaultRandom(),
  killSwitchId: uuid("kill_switch_id").notNull(),
  scope: varchar("scope", { length: 20 }).$type<"global" | "provider" | "project" | "execution" | "attempt">().notNull(),
  targetKey: varchar("target_key", { length: 320 }).notNull(),
  sequence: bigint("sequence", { mode: "bigint" }).notNull(),
  action: varchar("action", { length: 20 }).$type<"activate" | "release">().notNull(),
  actorKind: varchar("actor_kind", { length: 30 }).$type<"operator" | "service" | "watchdog" | "system">().notNull(),
  actorKey: varchar("actor_key", { length: 160 }).notNull(),
  actorUserId: uuid("actor_user_id").references(() => users.id, { onDelete: "restrict" }),
  idempotencyKey: varchar("idempotency_key", { length: 160 }).notNull(),
  causationId: uuid("causation_id"),
  correlationId: uuid("correlation_id").notNull(),
  expectedRevision: bigint("expected_revision", { mode: "bigint" }).notNull(),
  resultingRevision: bigint("resulting_revision", { mode: "bigint" }).notNull(),
  requestDigest: varchar("request_digest", { length: 71 }).notNull(),
  reason: text("reason").notNull(),
  recordedAt: timestamp("recorded_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  foreignKey({
    columns: [table.killSwitchId, table.scope, table.targetKey],
    foreignColumns: [foundryKillSwitches.id, foundryKillSwitches.scope, foundryKillSwitches.targetKey],
    name: "foundry_kill_event_switch_fk",
  }).onDelete("restrict"),
  unique("foundry_kill_event_sequence_unique").on(table.killSwitchId, table.sequence),
  unique("foundry_kill_event_actor_idempotency_unique").on(table.actorKey, table.idempotencyKey),
]);

export const foundryExecutionEvents = pgTable("foundry_execution_events", {
  id: uuid("id").primaryKey().defaultRandom(),
  executionId: uuid("execution_id").notNull(),
  projectId: varchar("project_id", { length: 120 }).notNull(),
  jobId: varchar("job_id", { length: 120 }).notNull(),
  executionEnvelopeSha256: varchar("execution_envelope_sha256", { length: 71 }).notNull(),
  executionSubjectSha256: varchar("execution_subject_sha256", { length: 71 }).notNull(),
  providerKind: varchar("provider_kind", { length: 40 }).$type<FoundryDbProviderKind>().notNull(),
  providerAdapterId: varchar("provider_adapter_id", { length: 120 }).notNull(),
  providerAdapterVersion: varchar("provider_adapter_version", { length: 120 }).notNull(),
  providerAdapterArtifactSha256: varchar("provider_adapter_artifact_sha256", { length: 71 }).notNull(),
  providerDeploymentSha256: varchar("provider_deployment_sha256", { length: 71 }).notNull(),
  attemptId: uuid("attempt_id"),
  attemptOrdinal: integer("attempt_ordinal"),
  fencingToken: bigint("fencing_token", { mode: "bigint" }),
  providerCommandId: uuid("provider_command_id"),
  providerCommandKind: varchar("provider_command_kind", { length: 40 }).$type<FoundryDbProviderCommandKind>(),
  claimToken: uuid("claim_token"),
  providerCommandPayloadSha256: varchar("provider_command_payload_sha256", { length: 71 }),
  providerRequestSha256: varchar("provider_request_sha256", { length: 71 }),
  providerIdempotencyKey: varchar("provider_idempotency_key", { length: 120 }),
  maximumApiCallSeconds: integer("maximum_api_call_seconds"),
  providerCommandState: varchar("provider_command_state", { length: 20 }).$type<FoundryDbProviderCommandState>(),
  providerCommandOutcomeSha256: varchar("provider_command_outcome_sha256", { length: 71 }),
  providerLifecycleState: varchar("provider_lifecycle_state", { length: 30 }).$type<FoundryDbProviderLifecycleState>(),
  providerWasInvoked: boolean("provider_was_invoked"),
  sequence: bigint("sequence", { mode: "bigint" }).notNull(),
  eventKind: varchar("event_kind", { length: 60 }).notNull(),
  advancesProjection: boolean("advances_projection").notNull(),
  payload: jsonb("payload").$type<Record<string, unknown>>().notNull(),
  actorKind: varchar("actor_kind", { length: 30 }).$type<"operator" | "service" | "provider" | "watchdog" | "system">().notNull(),
  actorKey: varchar("actor_key", { length: 160 }).notNull(),
  actorUserId: uuid("actor_user_id").references(() => users.id, { onDelete: "restrict" }),
  idempotencyKey: varchar("idempotency_key", { length: 160 }).notNull(),
  causationId: uuid("causation_id"),
  correlationId: uuid("correlation_id").notNull(),
  expectedRevision: bigint("expected_revision", { mode: "bigint" }).notNull(),
  resultingRevision: bigint("resulting_revision", { mode: "bigint" }).notNull(),
  requestDigest: varchar("request_digest", { length: 71 }).notNull(),
  recordedAt: timestamp("recorded_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  foreignKey({
    columns: [
      table.executionId, table.projectId, table.jobId, table.executionEnvelopeSha256,
      table.providerKind, table.providerAdapterId, table.providerAdapterVersion,
      table.providerAdapterArtifactSha256, table.providerDeploymentSha256,
    ],
    foreignColumns: [
      foundryExecutions.id, foundryExecutions.projectId, foundryExecutions.jobId,
      foundryExecutions.executionEnvelopeSha256, foundryExecutions.providerKind,
      foundryExecutions.providerAdapterId, foundryExecutions.providerAdapterVersion,
      foundryExecutions.providerAdapterArtifactSha256, foundryExecutions.providerDeploymentSha256,
    ],
    name: "foundry_event_execution_fk",
  }).onDelete("restrict"),
  foreignKey({
    columns: [table.executionId, table.executionSubjectSha256],
    foreignColumns: [foundryExecutions.id, foundryExecutions.executionSubjectSha256],
    name: "foundry_event_execution_subject_fk",
  }).onDelete("restrict"),
  foreignKey({
    columns: [
      table.attemptId, table.executionId, table.projectId, table.jobId,
      table.executionEnvelopeSha256, table.providerKind, table.providerAdapterId,
      table.providerAdapterVersion, table.providerAdapterArtifactSha256,
      table.providerDeploymentSha256, table.attemptOrdinal, table.fencingToken,
    ],
    foreignColumns: [
      foundryAttempts.id, foundryAttempts.executionId, foundryAttempts.projectId,
      foundryAttempts.jobId, foundryAttempts.executionEnvelopeSha256,
      foundryAttempts.providerKind, foundryAttempts.providerAdapterId,
      foundryAttempts.providerAdapterVersion, foundryAttempts.providerAdapterArtifactSha256,
      foundryAttempts.providerDeploymentSha256, foundryAttempts.attemptOrdinal,
      foundryAttempts.fencingToken,
    ],
    name: "foundry_event_attempt_fk",
  }).onDelete("restrict"),
  foreignKey({
    columns: [table.providerCommandId],
    foreignColumns: [foundryProviderCommands.id],
    name: "foundry_event_provider_command_fk",
  }).onDelete("restrict"),
  unique("foundry_event_execution_sequence_unique").on(table.executionId, table.sequence),
  unique("foundry_event_actor_idempotency_unique").on(table.actorKey, table.idempotencyKey),
  uniqueIndex("foundry_event_one_invocation_start_unique")
    .on(table.providerCommandId, table.claimToken)
    .where(sql`${table.eventKind} = 'provider_invocation_started'`),
  uniqueIndex("foundry_event_one_command_completion_unique")
    .on(table.providerCommandId)
    .where(sql`${table.eventKind} = 'provider_command_completed'`),
  index("foundry_event_execution_recorded_idx").on(table.executionId, table.recordedAt),
]);

export const foundryProviderCommands = pgTable("foundry_provider_commands", {
  id: uuid("id").primaryKey().defaultRandom(),
  executionId: uuid("execution_id").notNull(),
  projectId: varchar("project_id", { length: 120 }).notNull(),
  jobId: varchar("job_id", { length: 120 }).notNull(),
  executionEnvelopeSha256: varchar("execution_envelope_sha256", { length: 71 }).notNull(),
  executionSubjectSha256: varchar("execution_subject_sha256", { length: 71 }).notNull(),
  providerKind: varchar("provider_kind", { length: 40 }).$type<FoundryDbProviderKind>().notNull(),
  providerAdapterId: varchar("provider_adapter_id", { length: 120 }).notNull(),
  providerAdapterVersion: varchar("provider_adapter_version", { length: 120 }).notNull(),
  providerAdapterArtifactSha256: varchar("provider_adapter_artifact_sha256", { length: 71 }).notNull(),
  providerDeploymentSha256: varchar("provider_deployment_sha256", { length: 71 }).notNull(),
  attemptId: uuid("attempt_id").notNull(),
  attemptOrdinal: integer("attempt_ordinal").notNull(),
  fencingToken: bigint("fencing_token", { mode: "bigint" }).notNull(),
  commandSequence: bigint("command_sequence", { mode: "bigint" }).notNull(),
  commandKind: varchar("command_kind", { length: 40 }).$type<FoundryDbProviderCommandKind>().notNull(),
  preparedProviderRequestId: uuid("prepared_provider_request_id").notNull(),
  stopIntentId: uuid("stop_intent_id"),
  cancelledByStopIntentId: uuid("cancelled_by_stop_intent_id"),
  cancelledByProviderCommandId: uuid("cancelled_by_provider_command_id"),
  state: varchar("state", { length: 20 }).$type<FoundryDbProviderCommandState>().notNull().default("pending"),
  payload: jsonb("payload").$type<Record<string, unknown>>().notNull(),
  payloadSha256: varchar("payload_sha256", { length: 71 }).notNull(),
  providerRequestSha256: varchar("provider_request_sha256", { length: 71 }).notNull(),
  providerRequestProfileId: varchar("provider_request_profile_id", { length: 120 }).notNull(),
  providerRequestProfileVersion: varchar("provider_request_profile_version", { length: 120 }).notNull(),
  providerRequestProfileSha256: varchar("provider_request_profile_sha256", { length: 71 }).notNull(),
  providerAdapterConfigurationSha256: varchar("provider_adapter_configuration_sha256", { length: 71 }).notNull(),
  providerIdempotencyKey: varchar("provider_idempotency_key", { length: 120 }).notNull(),
  providerClientRequestId: varchar("provider_client_request_id", { length: 120 }).notNull(),
  stageIds: jsonb("stage_ids").$type<string[]>().notNull(),
  maximumApiCallSeconds: integer("maximum_api_call_seconds").notNull(),
  targetProviderRef: varchar("target_provider_ref", { length: 240 }),
  originatingSubmitCommandId: uuid("originating_submit_command_id"),
  originatingSubmitProviderRequestSha256: varchar("originating_submit_provider_request_sha256", { length: 71 }),
  originatingSubmitProviderIdempotencyKey: varchar("originating_submit_provider_idempotency_key", { length: 120 }),
  providerCommandRef: varchar("provider_command_ref", { length: 240 }),
  availableAt: timestamp("available_at", { withTimezone: true }).defaultNow().notNull(),
  claimedBy: varchar("claimed_by", { length: 160 }),
  claimToken: uuid("claim_token"),
  claimedAt: timestamp("claimed_at", { withTimezone: true }),
  claimExpiresAt: timestamp("claim_expires_at", { withTimezone: true }),
  outcomeJson: jsonb("outcome_json").$type<Record<string, unknown>>(),
  outcomeSha256: varchar("outcome_sha256", { length: 71 }),
  providerLifecycleState: varchar("provider_lifecycle_state", { length: 30 }).$type<FoundryDbProviderLifecycleState>(),
  completedByActorKind: varchar("completed_by_actor_kind", { length: 30 })
    .$type<"service" | "watchdog" | "system">(),
  completedByActorKey: varchar("completed_by_actor_key", { length: 160 }),
  completedAt: timestamp("completed_at", { withTimezone: true }),
  createdByActorKind: varchar("created_by_actor_kind", { length: 30 })
    .$type<"operator" | "service" | "watchdog" | "system">().notNull(),
  createdByActorKey: varchar("created_by_actor_key", { length: 160 }).notNull(),
  createdByUserId: uuid("created_by_user_id").references(() => users.id, { onDelete: "restrict" }),
  idempotencyKey: varchar("idempotency_key", { length: 160 }).notNull(),
  causationId: uuid("causation_id"),
  correlationId: uuid("correlation_id").notNull(),
  requestDigest: varchar("request_digest", { length: 71 }).notNull(),
  revision: bigint("revision", { mode: "bigint" }).notNull().default(0n),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  foreignKey({
    columns: [
      table.attemptId, table.executionId, table.projectId, table.jobId,
      table.executionEnvelopeSha256, table.providerKind, table.providerAdapterId,
      table.providerAdapterVersion, table.providerAdapterArtifactSha256,
      table.providerDeploymentSha256, table.attemptOrdinal, table.fencingToken,
    ],
    foreignColumns: [
      foundryAttempts.id, foundryAttempts.executionId, foundryAttempts.projectId,
      foundryAttempts.jobId, foundryAttempts.executionEnvelopeSha256,
      foundryAttempts.providerKind, foundryAttempts.providerAdapterId,
      foundryAttempts.providerAdapterVersion, foundryAttempts.providerAdapterArtifactSha256,
      foundryAttempts.providerDeploymentSha256, foundryAttempts.attemptOrdinal,
      foundryAttempts.fencingToken,
    ],
    name: "foundry_command_attempt_fk",
  }).onDelete("restrict"),
  foreignKey({
    columns: [table.executionId, table.executionSubjectSha256],
    foreignColumns: [foundryExecutions.id, foundryExecutions.executionSubjectSha256],
    name: "foundry_command_execution_subject_fk",
  }).onDelete("restrict"),
  foreignKey({
    columns: [
      table.stopIntentId, table.executionId, table.attemptId,
      table.executionSubjectSha256, table.fencingToken,
    ],
    foreignColumns: [
      foundryStopIntents.id, foundryStopIntents.executionId, foundryStopIntents.attemptId,
      foundryStopIntents.executionSubjectSha256, foundryStopIntents.fencingToken,
    ],
    name: "foundry_command_stop_intent_fk",
  }).onDelete("restrict"),
  foreignKey({
    columns: [
      table.cancelledByStopIntentId, table.executionId, table.attemptId,
      table.executionSubjectSha256, table.fencingToken,
    ],
    foreignColumns: [
      foundryStopIntents.id, foundryStopIntents.executionId, foundryStopIntents.attemptId,
      foundryStopIntents.executionSubjectSha256, foundryStopIntents.fencingToken,
    ],
    name: "foundry_command_cancelled_stop_intent_fk",
  }).onDelete("restrict"),
  foreignKey({
    columns: [
      table.preparedProviderRequestId, table.id, table.executionId, table.attemptId,
      table.executionSubjectSha256, table.commandSequence, table.commandKind,
      table.providerRequestSha256, table.providerRequestProfileId,
      table.providerRequestProfileVersion, table.providerRequestProfileSha256,
      table.providerAdapterConfigurationSha256, table.providerIdempotencyKey,
      table.providerClientRequestId, table.maximumApiCallSeconds,
      table.createdByActorKind, table.createdByActorKey,
    ],
    foreignColumns: [
      foundryPreparedProviderRequests.id, foundryPreparedProviderRequests.providerCommandId,
      foundryPreparedProviderRequests.executionId, foundryPreparedProviderRequests.attemptId,
      foundryPreparedProviderRequests.executionSubjectSha256,
      foundryPreparedProviderRequests.commandSequence, foundryPreparedProviderRequests.commandKind,
      foundryPreparedProviderRequests.providerRequestSha256,
      foundryPreparedProviderRequests.providerRequestProfileId,
      foundryPreparedProviderRequests.providerRequestProfileVersion,
      foundryPreparedProviderRequests.providerRequestProfileSha256,
      foundryPreparedProviderRequests.providerAdapterConfigurationSha256,
      foundryPreparedProviderRequests.providerIdempotencyKey,
      foundryPreparedProviderRequests.providerClientRequestId,
      foundryPreparedProviderRequests.maximumApiCallSeconds,
      foundryPreparedProviderRequests.preparedByActorKind,
      foundryPreparedProviderRequests.preparedByActorKey,
    ],
    name: "foundry_command_prepared_request_fk",
  }).onDelete("restrict"),
  foreignKey({
    columns: [table.originatingSubmitCommandId],
    foreignColumns: [table.id],
    name: "foundry_command_originating_submit_fk",
  }).onDelete("restrict"),
  foreignKey({
    columns: [table.cancelledByProviderCommandId],
    foreignColumns: [table.id],
    name: "foundry_command_cancelled_by_command_fk",
  }).onDelete("restrict"),
  unique("foundry_command_attempt_sequence_unique").on(table.attemptId, table.commandSequence),
  unique("foundry_command_actor_idempotency_unique").on(table.createdByActorKey, table.idempotencyKey),
  uniqueIndex("foundry_command_one_active_kind_unique")
    .on(table.attemptId, table.commandKind)
    .where(sql`${table.state} IN ('pending', 'claimed')`),
  uniqueIndex("foundry_command_one_active_non_stop_unique")
    .on(table.attemptId)
    .where(sql`${table.state} IN ('pending', 'claimed') AND ${table.commandKind} <> 'provider_stop'`),
  uniqueIndex("foundry_command_submit_provider_idempotency_unique")
    .on(
      table.providerKind, table.providerAdapterId, table.providerAdapterVersion,
      table.providerDeploymentSha256, table.providerIdempotencyKey,
    )
    .where(sql`${table.commandKind} = 'provider_submit'`),
  index("foundry_command_claimable_idx").on(table.state, table.availableAt, table.claimExpiresAt),
]);

/** Raw, append-only evidence for a canonical conclusive adapter response. */
export const foundryProviderCommandResultObservations = pgTable("foundry_provider_command_result_observations", {
  id: uuid("id").primaryKey().defaultRandom(),
  providerCommandId: uuid("provider_command_id").notNull().references(
    () => foundryProviderCommands.id,
    { onDelete: "restrict" },
  ),
  invocationEventId: uuid("invocation_event_id").notNull().references(
    () => foundryExecutionEvents.id,
    { onDelete: "restrict" },
  ),
  executionId: uuid("execution_id").notNull(),
  projectId: varchar("project_id", { length: 120 }).notNull(),
  jobId: varchar("job_id", { length: 120 }).notNull(),
  executionEnvelopeSha256: varchar("execution_envelope_sha256", { length: 71 }).notNull(),
  executionSubjectSha256: varchar("execution_subject_sha256", { length: 71 }).notNull(),
  providerKind: varchar("provider_kind", { length: 40 }).$type<FoundryDbProviderKind>().notNull(),
  providerAdapterId: varchar("provider_adapter_id", { length: 120 }).notNull(),
  providerAdapterVersion: varchar("provider_adapter_version", { length: 120 }).notNull(),
  providerAdapterArtifactSha256: varchar("provider_adapter_artifact_sha256", { length: 71 }).notNull(),
  providerAdapterConfigurationSha256: varchar("provider_adapter_configuration_sha256", { length: 71 }).notNull(),
  providerDeploymentSha256: varchar("provider_deployment_sha256", { length: 71 }).notNull(),
  preparedProviderRequestId: uuid("prepared_provider_request_id").notNull().references(
    () => foundryPreparedProviderRequests.id,
    { onDelete: "restrict" },
  ),
  providerRequestProfileId: varchar("provider_request_profile_id", { length: 120 }).notNull(),
  providerRequestProfileVersion: varchar("provider_request_profile_version", { length: 120 }).notNull(),
  providerRequestProfileSha256: varchar("provider_request_profile_sha256", { length: 71 }).notNull(),
  providerRequestSha256: varchar("provider_request_sha256", { length: 71 }).notNull(),
  providerIdempotencyKey: varchar("provider_idempotency_key", { length: 120 }).notNull(),
  providerClientRequestId: varchar("provider_client_request_id", { length: 120 }).notNull(),
  maximumApiCallSeconds: integer("maximum_api_call_seconds").notNull(),
  commandPayloadSha256: varchar("command_payload_sha256", { length: 71 }).notNull(),
  attemptId: uuid("attempt_id").notNull(),
  attemptOrdinal: integer("attempt_ordinal").notNull(),
  fencingToken: bigint("fencing_token", { mode: "bigint" }).notNull(),
  commandSequence: bigint("command_sequence", { mode: "bigint" }).notNull(),
  commandKind: varchar("command_kind", { length: 40 }).$type<FoundryDbProviderCommandKind>().notNull(),
  claimToken: uuid("claim_token").notNull(),
  claimedBy: varchar("claimed_by", { length: 160 }).notNull(),
  adapterOutcomeJson: jsonb("adapter_outcome_json").$type<Record<string, unknown>>().notNull(),
  adapterOutcomeSha256: varchar("adapter_outcome_sha256", { length: 71 }).notNull(),
  workerObservedAt: timestamp("worker_observed_at", { withTimezone: true }).notNull(),
  actorKind: varchar("actor_kind", { length: 30 }).$type<"service">().notNull(),
  actorKey: varchar("actor_key", { length: 160 }).notNull(),
  idempotencyKey: varchar("idempotency_key", { length: 160 }).notNull(),
  causationId: uuid("causation_id").notNull(),
  correlationId: uuid("correlation_id").notNull(),
  requestDigest: varchar("request_digest", { length: 71 }).notNull(),
  recordedAt: timestamp("recorded_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  foreignKey({
    columns: [
      table.attemptId, table.executionId, table.projectId, table.jobId,
      table.executionEnvelopeSha256, table.providerKind, table.providerAdapterId,
      table.providerAdapterVersion, table.providerAdapterArtifactSha256,
      table.providerDeploymentSha256, table.attemptOrdinal, table.fencingToken,
    ],
    foreignColumns: [
      foundryAttempts.id, foundryAttempts.executionId, foundryAttempts.projectId,
      foundryAttempts.jobId, foundryAttempts.executionEnvelopeSha256,
      foundryAttempts.providerKind, foundryAttempts.providerAdapterId,
      foundryAttempts.providerAdapterVersion, foundryAttempts.providerAdapterArtifactSha256,
      foundryAttempts.providerDeploymentSha256, foundryAttempts.attemptOrdinal,
      foundryAttempts.fencingToken,
    ],
    name: "foundry_result_observation_attempt_fk",
  }).onDelete("restrict"),
  unique("foundry_result_observation_command_claim_unique").on(
    table.providerCommandId,
    table.claimToken,
  ),
  unique("foundry_result_observation_invocation_unique").on(table.invocationEventId),
  unique("foundry_result_observation_actor_idempotency_unique").on(
    table.actorKey,
    table.idempotencyKey,
  ),
  index("foundry_result_observation_execution_recorded_idx").on(
    table.executionId,
    table.recordedAt.desc(),
  ),
]);

/** Immutable interpretation of an observation against one exact terminal event. */
export const foundryProviderCommandResultClassifications = pgTable("foundry_provider_command_result_classifications", {
  id: uuid("id").primaryKey().defaultRandom(),
  observationId: uuid("observation_id").notNull().references(
    () => foundryProviderCommandResultObservations.id,
    { onDelete: "restrict" },
  ),
  providerCommandId: uuid("provider_command_id").notNull().references(
    () => foundryProviderCommands.id,
    { onDelete: "restrict" },
  ),
  completionEventId: uuid("completion_event_id").notNull().references(
    () => foundryExecutionEvents.id,
    { onDelete: "restrict" },
  ),
  terminalOutcomeSha256: varchar("terminal_outcome_sha256", { length: 71 }).notNull(),
  disposition: varchar("disposition", { length: 30 }).$type<
    "late_eligible" | "already_authoritative" | "terminal_conflict" | "not_eligible"
  >().notNull(),
  actorKind: varchar("actor_kind", { length: 30 }).$type<"system">().notNull(),
  actorKey: varchar("actor_key", { length: 160 }).notNull(),
  idempotencyKey: varchar("idempotency_key", { length: 160 }).notNull(),
  causationId: uuid("causation_id").notNull(),
  correlationId: uuid("correlation_id").notNull(),
  requestDigest: varchar("request_digest", { length: 71 }).notNull(),
  classifiedAt: timestamp("classified_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  unique("foundry_result_classification_observation_unique").on(table.observationId),
  unique("foundry_result_classification_command_unique").on(table.providerCommandId),
  unique("foundry_result_classification_completion_unique").on(table.completionEventId),
  unique("foundry_result_classification_actor_idempotency_unique").on(
    table.actorKey,
    table.idempotencyKey,
  ),
  index("foundry_result_classification_command_idx").on(
    table.providerCommandId,
    table.classifiedAt.desc(),
  ),
]);

export const foundryCostObservations = pgTable("foundry_cost_observations", {
  id: uuid("id").primaryKey().defaultRandom(),
  executionId: uuid("execution_id").notNull(),
  projectId: varchar("project_id", { length: 120 }).notNull(),
  jobId: varchar("job_id", { length: 120 }).notNull(),
  executionEnvelopeSha256: varchar("execution_envelope_sha256", { length: 71 }).notNull(),
  providerKind: varchar("provider_kind", { length: 40 }).$type<FoundryDbProviderKind>().notNull(),
  providerAdapterId: varchar("provider_adapter_id", { length: 120 }).notNull(),
  providerAdapterVersion: varchar("provider_adapter_version", { length: 120 }).notNull(),
  providerAdapterArtifactSha256: varchar("provider_adapter_artifact_sha256", { length: 71 }).notNull(),
  providerDeploymentSha256: varchar("provider_deployment_sha256", { length: 71 }).notNull(),
  attemptId: uuid("attempt_id").notNull(),
  attemptOrdinal: integer("attempt_ordinal").notNull(),
  fencingToken: bigint("fencing_token", { mode: "bigint" }).notNull(),
  observationSequence: bigint("observation_sequence", { mode: "bigint" }).notNull(),
  providerObservationId: varchar("provider_observation_id", { length: 240 }).notNull(),
  observationKind: varchar("observation_kind", { length: 20 }).$type<"accrued" | "final" | "adjustment">().notNull(),
  pricingCurrency: char("pricing_currency", { length: 3 }).$type<"USD">().notNull(),
  pricingSnapshotSha256: varchar("pricing_snapshot_sha256", { length: 71 }).notNull(),
  incrementalCostMicroUsd: bigint("incremental_cost_micro_usd", { mode: "bigint" }).notNull(),
  cumulativeCostMicroUsd: bigint("cumulative_cost_micro_usd", { mode: "bigint" }).notNull(),
  evidenceSha256: varchar("evidence_sha256", { length: 71 }).notNull(),
  providerObservedAt: timestamp("provider_observed_at", { withTimezone: true }).notNull(),
  recordedBy: varchar("recorded_by", { length: 160 }).notNull(),
  idempotencyKey: varchar("idempotency_key", { length: 160 }).notNull(),
  causationId: uuid("causation_id"),
  correlationId: uuid("correlation_id").notNull(),
  requestDigest: varchar("request_digest", { length: 71 }).notNull(),
  recordedAt: timestamp("recorded_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  foreignKey({
    columns: [
      table.attemptId, table.executionId, table.projectId, table.jobId,
      table.executionEnvelopeSha256, table.providerKind, table.providerAdapterId,
      table.providerAdapterVersion, table.providerAdapterArtifactSha256,
      table.providerDeploymentSha256, table.attemptOrdinal, table.fencingToken,
    ],
    foreignColumns: [
      foundryAttempts.id, foundryAttempts.executionId, foundryAttempts.projectId,
      foundryAttempts.jobId, foundryAttempts.executionEnvelopeSha256,
      foundryAttempts.providerKind, foundryAttempts.providerAdapterId,
      foundryAttempts.providerAdapterVersion, foundryAttempts.providerAdapterArtifactSha256,
      foundryAttempts.providerDeploymentSha256, foundryAttempts.attemptOrdinal,
      foundryAttempts.fencingToken,
    ],
    name: "foundry_cost_attempt_fk",
  }).onDelete("restrict"),
  foreignKey({
    columns: [table.executionId, table.pricingCurrency, table.pricingSnapshotSha256],
    foreignColumns: [foundryExecutions.id, foundryExecutions.pricingCurrency, foundryExecutions.pricingSnapshotSha256],
    name: "foundry_cost_pricing_fk",
  }).onDelete("restrict"),
  unique("foundry_cost_attempt_sequence_unique").on(table.attemptId, table.observationSequence),
  unique("foundry_cost_provider_observation_unique").on(
    table.providerKind, table.providerAdapterId, table.providerAdapterVersion, table.providerObservationId,
  ),
  unique("foundry_cost_actor_idempotency_unique").on(table.recordedBy, table.idempotencyKey),
  index("foundry_cost_execution_recorded_idx").on(table.executionId, table.recordedAt),
]);

export const foundryVerifiedCheckpoints = pgTable("foundry_verified_checkpoints", {
  id: uuid("id").primaryKey().defaultRandom(),
  executionId: uuid("execution_id").notNull(),
  projectId: varchar("project_id", { length: 120 }).notNull(),
  jobId: varchar("job_id", { length: 120 }).notNull(),
  executionEnvelopeSha256: varchar("execution_envelope_sha256", { length: 71 }).notNull(),
  providerKind: varchar("provider_kind", { length: 40 }).$type<FoundryDbProviderKind>().notNull(),
  providerAdapterId: varchar("provider_adapter_id", { length: 120 }).notNull(),
  providerAdapterVersion: varchar("provider_adapter_version", { length: 120 }).notNull(),
  providerAdapterArtifactSha256: varchar("provider_adapter_artifact_sha256", { length: 71 }).notNull(),
  providerDeploymentSha256: varchar("provider_deployment_sha256", { length: 71 }).notNull(),
  attemptId: uuid("attempt_id").notNull(),
  attemptOrdinal: integer("attempt_ordinal").notNull(),
  fencingToken: bigint("fencing_token", { mode: "bigint" }).notNull(),
  providerCommandId: uuid("provider_command_id").notNull().references(
    () => foundryProviderCommands.id,
    { onDelete: "restrict" },
  ),
  providerCommandOutcomeSha256: varchar("provider_command_outcome_sha256", { length: 71 }).notNull(),
  checkpointSequence: bigint("checkpoint_sequence", { mode: "bigint" }).notNull(),
  checkpointKind: varchar("checkpoint_kind", { length: 60 }).notNull(),
  providerCheckpointId: varchar("provider_checkpoint_id", { length: 240 }).notNull(),
  checkpointSha256: varchar("checkpoint_sha256", { length: 71 }).notNull(),
  evidenceRef: text("evidence_ref").notNull(),
  providerCreatedAt: timestamp("provider_created_at", { withTimezone: true }).notNull(),
  verifiedBy: varchar("verified_by", { length: 160 }).notNull(),
  idempotencyKey: varchar("idempotency_key", { length: 160 }).notNull(),
  causationId: uuid("causation_id").notNull(),
  correlationId: uuid("correlation_id").notNull(),
  requestDigest: varchar("request_digest", { length: 71 }).notNull(),
  verifiedAt: timestamp("verified_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  foreignKey({
    columns: [
      table.attemptId, table.executionId, table.projectId, table.jobId,
      table.executionEnvelopeSha256, table.providerKind, table.providerAdapterId,
      table.providerAdapterVersion, table.providerAdapterArtifactSha256,
      table.providerDeploymentSha256, table.attemptOrdinal, table.fencingToken,
    ],
    foreignColumns: [
      foundryAttempts.id, foundryAttempts.executionId, foundryAttempts.projectId,
      foundryAttempts.jobId, foundryAttempts.executionEnvelopeSha256,
      foundryAttempts.providerKind, foundryAttempts.providerAdapterId,
      foundryAttempts.providerAdapterVersion, foundryAttempts.providerAdapterArtifactSha256,
      foundryAttempts.providerDeploymentSha256, foundryAttempts.attemptOrdinal,
      foundryAttempts.fencingToken,
    ],
    name: "foundry_checkpoint_attempt_fk",
  }).onDelete("restrict"),
  unique("foundry_checkpoint_attempt_sequence_unique").on(table.attemptId, table.checkpointSequence),
  unique("foundry_checkpoint_command_unique").on(table.providerCommandId),
  unique("foundry_checkpoint_provider_dedupe_unique").on(table.attemptId, table.providerCheckpointId, table.checkpointSha256),
  unique("foundry_checkpoint_actor_idempotency_unique").on(table.verifiedBy, table.idempotencyKey),
  index("foundry_checkpoint_attempt_verified_idx").on(table.attemptId, table.verifiedAt),
]);
