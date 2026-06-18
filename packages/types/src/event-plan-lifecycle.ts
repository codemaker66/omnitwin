import { z } from "zod";
import { ConfigurationIdSchema } from "./configuration.js";
import { EventIdSchema } from "./event-phase-graph.js";
import { HandoffPackIdSchema } from "./ops-compiler.js";
import { ProposalIdSchema, QuoteIdSchema } from "./proposal.js";
import { RuntimePackageStatusSchema } from "./asset-version.js";
import { UserIdSchema, UserRoleSchema } from "./user.js";
import { VenueIdSchema } from "./venue.js";

// ---------------------------------------------------------------------------
// Event plan lifecycle v0
//
// A venue plan change is the connective tissue between client proposals,
// planner layouts, evidence, revenue, and hallkeeper execution. These schemas
// model planning operations only; they make no legal, safety, occupancy, or
// certification claims.
// ---------------------------------------------------------------------------

const UUID = z.string().uuid();

export const EventPlanChangeIdSchema = UUID;
export type EventPlanChangeId = z.infer<typeof EventPlanChangeIdSchema>;

export const EventPlanNotificationIdSchema = UUID;
export type EventPlanNotificationId = z.infer<typeof EventPlanNotificationIdSchema>;

export const HallkeeperAcknowledgementIdSchema = UUID;
export type HallkeeperAcknowledgementId = z.infer<typeof HallkeeperAcknowledgementIdSchema>;

export const PlanRevisionIdSchema = UUID;
export type PlanRevisionId = z.infer<typeof PlanRevisionIdSchema>;

export const EVENT_PLAN_AUDIENCE_ROLES = [
  ...UserRoleSchema.options,
  "supplier",
  "executive",
] as const;
export const EventPlanAudienceRoleSchema = z.enum(EVENT_PLAN_AUDIENCE_ROLES);
export type EventPlanAudienceRole = z.infer<typeof EventPlanAudienceRoleSchema>;

export const EVENT_PLAN_CHANGE_SURFACES = [
  "layout",
  "guest_count",
  "timings",
  "furniture",
  "suppliers",
  "accessibility",
  "service_notes",
  "pricing",
  "proposal",
  "evidence",
  "runtime_asset",
  "ops_tasks",
  "room_flip",
  "guest_flow",
  "lighting",
  "comments",
] as const;
export const EventPlanChangeSurfaceSchema = z.enum(EVENT_PLAN_CHANGE_SURFACES);
export type EventPlanChangeSurface = z.infer<typeof EventPlanChangeSurfaceSchema>;

export const EventPlanRiskLevelSchema = z.enum(["info", "attention", "blocker"]);
export type EventPlanRiskLevel = z.infer<typeof EventPlanRiskLevelSchema>;

export const EventPlanSourceKindSchema = z.enum([
  "event",
  "configuration",
  "proposal",
  "proposal_comment",
  "proposal_response",
  "ops_task",
  "ops_issue",
  "handoff_pack",
  "runtime_asset",
]);
export type EventPlanSourceKind = z.infer<typeof EventPlanSourceKindSchema>;

export const EventPlanNotificationSeveritySchema = z.enum(["info", "attention", "urgent"]);
export type EventPlanNotificationSeverity = z.infer<typeof EventPlanNotificationSeveritySchema>;

export const EventPlanSchema = z.object({
  eventId: EventIdSchema,
  configurationId: ConfigurationIdSchema.nullable(),
  proposalId: ProposalIdSchema.nullable(),
  quoteId: QuoteIdSchema.nullable(),
  handoffPackId: HandoffPackIdSchema.nullable(),
  currentSnapshotId: z.string().uuid().nullable(),
  runtimePackageId: z.string().uuid().nullable(),
  status: z.string().trim().min(1).max(60),
}).strict();
export type EventPlan = z.infer<typeof EventPlanSchema>;

export const PlanRevisionSchema = z.object({
  id: PlanRevisionIdSchema,
  eventId: EventIdSchema,
  configurationId: ConfigurationIdSchema.nullable(),
  proposalId: ProposalIdSchema.nullable(),
  handoffPackId: HandoffPackIdSchema.nullable(),
  sourceKind: EventPlanSourceKindSchema,
  sourceId: z.string().trim().min(1).max(160),
  revision: z.number().int().positive(),
  summary: z.string().trim().min(1).max(500),
  createdBy: UserIdSchema.nullable(),
  createdAt: z.string().datetime(),
}).strict();
export type PlanRevision = z.infer<typeof PlanRevisionSchema>;

export const RuntimeAssetStateSchema = z.object({
  runtimePackageId: z.string().uuid().nullable(),
  venueSlug: z.string().trim().min(1).max(100),
  roomSlug: z.string().trim().min(1).max(100),
  displayName: z.string().trim().min(1).max(200),
  visualAssetType: z.enum(["spz", "sog", "splat", "ply", "ksplat", "mesh", "unknown"]),
  evidenceStatus: z.enum(["unverified", "machine_checked", "human_reviewed", "rejected"]),
  runtimeStatus: RuntimePackageStatusSchema.or(z.literal("staged/internal")),
  copy: z.string().trim().min(1).max(500),
}).strict();
export type RuntimeAssetState = z.infer<typeof RuntimeAssetStateSchema>;

export const ChangeFeedItemSchema = z.object({
  id: EventPlanChangeIdSchema,
  eventId: EventIdSchema,
  venueId: VenueIdSchema,
  configurationId: ConfigurationIdSchema.nullable(),
  proposalId: ProposalIdSchema.nullable(),
  handoffPackId: HandoffPackIdSchema.nullable(),
  actorUserId: UserIdSchema.nullable(),
  actorRole: EventPlanAudienceRoleSchema,
  actorLabel: z.string().trim().min(1).max(160),
  sourceKind: EventPlanSourceKindSchema,
  sourceId: z.string().trim().min(1).max(160),
  title: z.string().trim().min(1).max(180),
  summary: z.string().trim().min(1).max(1000),
  beforeSummary: z.string().trim().min(1).max(1000).nullable(),
  afterSummary: z.string().trim().min(1).max(1000).nullable(),
  affectedSurfaces: z.array(EventPlanChangeSurfaceSchema).min(1),
  audienceRoles: z.array(EventPlanAudienceRoleSchema).min(1),
  riskLevel: EventPlanRiskLevelSchema,
  requiresHallkeeperAcknowledgement: z.boolean(),
  createdAt: z.string().datetime(),
}).strict();
export type ChangeFeedItem = z.infer<typeof ChangeFeedItemSchema>;

export const NotificationSchema = z.object({
  id: EventPlanNotificationIdSchema,
  changeId: EventPlanChangeIdSchema.nullable(),
  eventId: EventIdSchema.nullable(),
  venueId: VenueIdSchema.nullable(),
  audienceRole: EventPlanAudienceRoleSchema,
  recipientUserId: UserIdSchema.nullable(),
  title: z.string().trim().min(1).max(180),
  body: z.string().trim().min(1).max(1000),
  severity: EventPlanNotificationSeveritySchema,
  actionPath: z.string().trim().min(1).max(500).nullable(),
  createdAt: z.string().datetime(),
  readAt: z.string().datetime().nullable(),
}).strict();
export type Notification = z.infer<typeof NotificationSchema>;

export const NotificationListQuerySchema = z.object({
  status: z.enum(["all", "unread", "read"]).default("unread"),
  limit: z.coerce.number().int().min(1).max(100).default(20),
}).strict();
export type NotificationListQuery = z.infer<typeof NotificationListQuerySchema>;

export const ChangeFeedListQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(50),
}).strict();
export type ChangeFeedListQuery = z.infer<typeof ChangeFeedListQuerySchema>;

export const CreateHallkeeperAcknowledgementInputSchema = z.object({
  changeId: EventPlanChangeIdSchema,
  note: z.string().trim().min(1).max(1000).nullable().optional(),
}).strict();
export type CreateHallkeeperAcknowledgementInput = z.infer<
  typeof CreateHallkeeperAcknowledgementInputSchema
>;

export const HallkeeperAcknowledgementSchema = z.object({
  id: HallkeeperAcknowledgementIdSchema,
  changeId: EventPlanChangeIdSchema,
  eventId: EventIdSchema,
  acknowledgedBy: UserIdSchema,
  acknowledgedByRole: EventPlanAudienceRoleSchema,
  note: z.string().trim().min(1).max(1000).nullable(),
  createdAt: z.string().datetime(),
}).strict();
export type HallkeeperAcknowledgement = z.infer<typeof HallkeeperAcknowledgementSchema>;

export const RecordEventPlanChangeInputSchema = z.object({
  eventId: EventIdSchema,
  venueId: VenueIdSchema,
  configurationId: ConfigurationIdSchema.nullable().optional(),
  proposalId: ProposalIdSchema.nullable().optional(),
  handoffPackId: HandoffPackIdSchema.nullable().optional(),
  actorUserId: UserIdSchema.nullable().optional(),
  actorRole: EventPlanAudienceRoleSchema,
  actorLabel: z.string().trim().min(1).max(160),
  sourceKind: EventPlanSourceKindSchema,
  sourceId: z.string().trim().min(1).max(160),
  title: z.string().trim().min(1).max(180),
  summary: z.string().trim().min(1).max(1000),
  beforeSummary: z.string().trim().min(1).max(1000).nullable().optional(),
  afterSummary: z.string().trim().min(1).max(1000).nullable().optional(),
  affectedSurfaces: z.array(EventPlanChangeSurfaceSchema).min(1),
  audienceRoles: z.array(EventPlanAudienceRoleSchema).min(1),
  riskLevel: EventPlanRiskLevelSchema.default("attention"),
  requiresHallkeeperAcknowledgement: z.boolean().default(false),
  actionPath: z.string().trim().min(1).max(500).nullable().optional(),
}).strict();
export type RecordEventPlanChangeInput = z.infer<typeof RecordEventPlanChangeInputSchema>;
