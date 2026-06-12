import { z } from "zod";
import { VenueIdSchema } from "./venue.js";
import { EnquiryIdSchema } from "./enquiry.js";
import { UserIdSchema } from "./user.js";
import { ProposalIdSchema, QuoteIdSchema, MinorUnitAmountSchema, findUnsupportedProposalClaim } from "./proposal.js";

export const COMMERCIAL_SPINE_SCHEMA_VERSION = "venviewer.commercial-spine.v1";

export const ClientAccountIdSchema = z.string().uuid();
export const ContactIdSchema = z.string().uuid();
export const OpportunityIdSchema = z.string().uuid();
export const OpportunityStatusHistoryIdSchema = z.string().uuid();
export const ActivityIdSchema = z.string().uuid();
export const FollowUpTaskIdSchema = z.string().uuid();
export const ProposalShareTokenIdSchema = z.string().uuid();
export const ProposalCommentIdSchema = z.string().uuid();
export const PackageSelectionIdSchema = z.string().uuid();

export type ClientAccountId = z.infer<typeof ClientAccountIdSchema>;
export type ContactId = z.infer<typeof ContactIdSchema>;
export type OpportunityId = z.infer<typeof OpportunityIdSchema>;
export type OpportunityStatusHistoryId = z.infer<typeof OpportunityStatusHistoryIdSchema>;
export type ActivityId = z.infer<typeof ActivityIdSchema>;
export type FollowUpTaskId = z.infer<typeof FollowUpTaskIdSchema>;
export type ProposalShareTokenId = z.infer<typeof ProposalShareTokenIdSchema>;
export type ProposalCommentId = z.infer<typeof ProposalCommentIdSchema>;
export type PackageSelectionId = z.infer<typeof PackageSelectionIdSchema>;

export const OPPORTUNITY_STAGES = [
  "new",
  "qualified",
  "proposal_drafting",
  "proposal_sent",
  "negotiation",
  "won",
  "lost",
  "archived",
] as const;

export const OpportunityStageSchema = z.enum(OPPORTUNITY_STAGES);
export type OpportunityStage = z.infer<typeof OpportunityStageSchema>;

export const OPPORTUNITY_STAGE_TRANSITIONS: Readonly<Record<OpportunityStage, readonly OpportunityStage[]>> = {
  new: ["qualified", "lost", "archived"],
  qualified: ["proposal_drafting", "lost", "archived"],
  proposal_drafting: ["proposal_sent", "qualified", "lost", "archived"],
  proposal_sent: ["negotiation", "won", "lost", "archived"],
  negotiation: ["proposal_sent", "won", "lost", "archived"],
  won: ["archived"],
  lost: ["archived"],
  archived: [],
};

export function isValidOpportunityStageTransition(from: OpportunityStage, to: OpportunityStage): boolean {
  return OPPORTUNITY_STAGE_TRANSITIONS[from].includes(to);
}

export const ACTIVITY_TYPES = ["note", "call", "email", "meeting", "proposal", "system"] as const;
export const ActivityTypeSchema = z.enum(ACTIVITY_TYPES);
export type ActivityType = z.infer<typeof ActivityTypeSchema>;

export const FOLLOW_UP_TASK_STATUSES = ["open", "done", "cancelled"] as const;
export const FollowUpTaskStatusSchema = z.enum(FOLLOW_UP_TASK_STATUSES);
export type FollowUpTaskStatus = z.infer<typeof FollowUpTaskStatusSchema>;

export const PROPOSAL_COMMENT_KINDS = ["comment", "request_changes", "approval_note"] as const;
export const ProposalCommentKindSchema = z.enum(PROPOSAL_COMMENT_KINDS);
export type ProposalCommentKind = z.infer<typeof ProposalCommentKindSchema>;

export const PACKAGE_SELECTION_STATUSES = ["draft", "included", "removed", "superseded"] as const;
export const PackageSelectionStatusSchema = z.enum(PACKAGE_SELECTION_STATUSES);
export type PackageSelectionStatus = z.infer<typeof PackageSelectionStatusSchema>;

const SafeCommercialTextSchema = z.string().max(4000).superRefine((text, ctx) => {
  const claim = findUnsupportedProposalClaim(text);
  if (claim !== null) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: `Unsupported claim phrase "${claim}" is not allowed in commercial copy`,
    });
  }
});
const RequiredSafeCommercialTextSchema = SafeCommercialTextSchema.refine(
  (text) => text.trim().length > 0,
  "Text is required",
);

const IsoDateTimeSchema = z.string().datetime();
const DateStringSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

export const ClientAccountSchema = z.object({
  id: ClientAccountIdSchema,
  venueId: VenueIdSchema,
  name: z.string().trim().min(1).max(200),
  accountType: z.string().trim().min(1).max(60),
  primaryContactId: ContactIdSchema.nullable(),
  sourceEnquiryId: EnquiryIdSchema.nullable(),
  createdBy: UserIdSchema.nullable(),
  createdAt: IsoDateTimeSchema,
  updatedAt: IsoDateTimeSchema,
  deletedAt: IsoDateTimeSchema.nullable(),
});
export type ClientAccount = z.infer<typeof ClientAccountSchema>;

export const ContactSchema = z.object({
  id: ContactIdSchema,
  venueId: VenueIdSchema,
  clientAccountId: ClientAccountIdSchema.nullable(),
  name: z.string().trim().min(1).max(200),
  email: z.string().trim().email().max(255),
  phone: z.string().trim().max(50).nullable(),
  roleLabel: z.string().trim().max(120).nullable(),
  sourceEnquiryId: EnquiryIdSchema.nullable(),
  createdAt: IsoDateTimeSchema,
  updatedAt: IsoDateTimeSchema,
  deletedAt: IsoDateTimeSchema.nullable(),
});
export type Contact = z.infer<typeof ContactSchema>;

export const OpportunitySchema = z.object({
  id: OpportunityIdSchema,
  venueId: VenueIdSchema,
  clientAccountId: ClientAccountIdSchema.nullable(),
  primaryContactId: ContactIdSchema.nullable(),
  sourceEnquiryId: EnquiryIdSchema.nullable(),
  ownerUserId: UserIdSchema.nullable(),
  title: z.string().trim().min(1).max(200),
  stage: OpportunityStageSchema,
  eventType: z.string().trim().max(100).nullable(),
  preferredDate: DateStringSchema.nullable(),
  guestCount: z.number().int().nonnegative().nullable(),
  estimatedValueMinor: MinorUnitAmountSchema,
  currency: z.string().length(3),
  nextAction: z.string().trim().max(500),
  nextActionDueAt: IsoDateTimeSchema.nullable(),
  createdAt: IsoDateTimeSchema,
  updatedAt: IsoDateTimeSchema,
  closedAt: IsoDateTimeSchema.nullable(),
  deletedAt: IsoDateTimeSchema.nullable(),
});
export type Opportunity = z.infer<typeof OpportunitySchema>;

export const OpportunityStatusHistorySchema = z.object({
  id: OpportunityStatusHistoryIdSchema,
  opportunityId: OpportunityIdSchema,
  fromStage: OpportunityStageSchema,
  toStage: OpportunityStageSchema,
  changedBy: UserIdSchema.nullable(),
  note: SafeCommercialTextSchema.nullable(),
  createdAt: IsoDateTimeSchema,
});
export type OpportunityStatusHistory = z.infer<typeof OpportunityStatusHistorySchema>;

export const ActivitySchema = z.object({
  id: ActivityIdSchema,
  opportunityId: OpportunityIdSchema,
  type: ActivityTypeSchema,
  body: SafeCommercialTextSchema,
  createdBy: UserIdSchema.nullable(),
  createdAt: IsoDateTimeSchema,
});
export type Activity = z.infer<typeof ActivitySchema>;

export const FollowUpTaskSchema = z.object({
  id: FollowUpTaskIdSchema,
  opportunityId: OpportunityIdSchema,
  assignedTo: UserIdSchema.nullable(),
  title: z.string().trim().min(1).max(200),
  dueAt: IsoDateTimeSchema.nullable(),
  status: FollowUpTaskStatusSchema,
  completedAt: IsoDateTimeSchema.nullable(),
  createdAt: IsoDateTimeSchema,
  updatedAt: IsoDateTimeSchema,
});
export type FollowUpTask = z.infer<typeof FollowUpTaskSchema>;

export const ProposalShareTokenSchema = z.object({
  id: ProposalShareTokenIdSchema,
  proposalId: ProposalIdSchema,
  tokenHash: z.string().regex(/^[a-f0-9]{64}$/),
  tokenPrefix: z.string().min(6).max(16),
  createdBy: UserIdSchema.nullable(),
  createdAt: IsoDateTimeSchema,
  expiresAt: IsoDateTimeSchema.nullable(),
  revokedAt: IsoDateTimeSchema.nullable(),
  lastViewedAt: IsoDateTimeSchema.nullable(),
});
export type ProposalShareToken = z.infer<typeof ProposalShareTokenSchema>;

export const ProposalCommentSchema = z.object({
  id: ProposalCommentIdSchema,
  proposalId: ProposalIdSchema,
  shareTokenId: ProposalShareTokenIdSchema.nullable(),
  kind: ProposalCommentKindSchema,
  authorName: z.string().trim().max(200).nullable(),
  authorEmail: z.string().trim().email().max(255).nullable(),
  body: SafeCommercialTextSchema,
  isClientVisible: z.boolean(),
  createdAt: IsoDateTimeSchema,
});
export type ProposalComment = z.infer<typeof ProposalCommentSchema>;

export const PackageSelectionSchema = z.object({
  id: PackageSelectionIdSchema,
  opportunityId: OpportunityIdSchema.nullable(),
  proposalId: ProposalIdSchema.nullable(),
  quoteId: QuoteIdSchema.nullable(),
  packageKey: z.string().trim().min(1).max(120),
  label: z.string().trim().min(1).max(200),
  quantity: z.number().int().min(1).max(10000),
  unitAmountMinor: MinorUnitAmountSchema,
  totalMinor: MinorUnitAmountSchema,
  status: PackageSelectionStatusSchema,
  notes: SafeCommercialTextSchema.nullable(),
  createdAt: IsoDateTimeSchema,
  updatedAt: IsoDateTimeSchema,
});
export type PackageSelection = z.infer<typeof PackageSelectionSchema>;

export const CreateOpportunitySchema = z.object({
  venueId: VenueIdSchema,
  title: z.string().trim().min(1).max(200),
  clientAccountId: ClientAccountIdSchema.nullable().optional(),
  primaryContactId: ContactIdSchema.nullable().optional(),
  sourceEnquiryId: EnquiryIdSchema.nullable().optional(),
  eventType: z.string().trim().max(100).nullable().optional(),
  preferredDate: DateStringSchema.nullable().optional(),
  guestCount: z.number().int().nonnegative().nullable().optional(),
  estimatedValueMinor: MinorUnitAmountSchema.optional(),
  currency: z.string().length(3).default("GBP"),
  nextAction: z.string().trim().max(500).optional(),
  nextActionDueAt: IsoDateTimeSchema.nullable().optional(),
});
export type CreateOpportunity = z.infer<typeof CreateOpportunitySchema>;

export const UpdateOpportunitySchema = CreateOpportunitySchema.omit({ venueId: true }).partial().extend({
  stage: OpportunityStageSchema.optional(),
  note: SafeCommercialTextSchema.nullable().optional(),
});
export type UpdateOpportunity = z.infer<typeof UpdateOpportunitySchema>;

export const CreateActivitySchema = z.object({
  type: ActivityTypeSchema.default("note"),
  body: RequiredSafeCommercialTextSchema,
});
export type CreateActivity = z.infer<typeof CreateActivitySchema>;

export const CreateFollowUpTaskSchema = z.object({
  title: z.string().trim().min(1).max(200),
  assignedTo: UserIdSchema.nullable().optional(),
  dueAt: IsoDateTimeSchema.nullable().optional(),
});
export type CreateFollowUpTask = z.infer<typeof CreateFollowUpTaskSchema>;

export const UpdateFollowUpTaskSchema = z.object({
  status: FollowUpTaskStatusSchema,
});
export type UpdateFollowUpTask = z.infer<typeof UpdateFollowUpTaskSchema>;

export const CreateProposalCommentSchema = z.object({
  authorName: z.string().trim().max(200).nullable().optional(),
  authorEmail: z.string().trim().email().max(255).nullable().optional(),
  body: RequiredSafeCommercialTextSchema,
  kind: ProposalCommentKindSchema.default("comment"),
});
export type CreateProposalComment = z.infer<typeof CreateProposalCommentSchema>;

export const CreatePackageSelectionSchema = z.object({
  opportunityId: OpportunityIdSchema.nullable().optional(),
  proposalId: ProposalIdSchema.nullable().optional(),
  quoteId: QuoteIdSchema.nullable().optional(),
  packageKey: z.string().trim().min(1).max(120),
  label: z.string().trim().min(1).max(200),
  quantity: z.number().int().min(1).max(10000),
  unitAmountMinor: MinorUnitAmountSchema,
  notes: SafeCommercialTextSchema.nullable().optional(),
});
export type CreatePackageSelection = z.infer<typeof CreatePackageSelectionSchema>;

export const CrmPipelineSummarySchema = z.object({
  opportunities: z.array(OpportunitySchema),
  todayTasks: z.array(FollowUpTaskSchema),
  stageCounts: z.record(z.number().int().nonnegative()),
});
export type CrmPipelineSummary = z.infer<typeof CrmPipelineSummarySchema>;
