import { z } from "zod";
import {
  BrandColourSchema,
  DEFAULT_VENUE_TIMEZONE,
  TimezoneSchema,
  VenueIdSchema,
  VenueSlugSchema,
} from "./venue.js";
import { EmailSchema, UserIdSchema } from "./user.js";

// ---------------------------------------------------------------------------
// Organisation / workspace onboarding foundation
//
// Venviewer keeps venue_id as the v1 authorization boundary. These contracts
// add the commercial onboarding shell around that boundary: organisation,
// workspace, customer-owner invitation, staff invitations, entitlement state,
// and operator review gates. Access enforcement is deliberately blocked until
// provider verification is present.
// ---------------------------------------------------------------------------

export const ONBOARDING_SCHEMA_VERSION = "venviewer.onboarding.v1";

export const ORGANISATION_STATUSES = ["prospect", "onboarding", "active", "suspended", "archived"] as const;
export const WORKSPACE_STATUSES = ["onboarding", "active", "suspended", "archived"] as const;
export const WORKSPACE_MEMBER_ROLES = ["owner", "admin", "staff", "hallkeeper", "planner", "client"] as const;
export const STAFF_WORKSPACE_MEMBER_ROLES = ["admin", "staff", "hallkeeper", "planner", "client"] as const;
export const VENUE_INVITATION_ROLES = ["staff", "hallkeeper", "planner", "client"] as const;
export const WORKSPACE_MEMBERSHIP_STATUSES = ["invited", "active", "suspended", "removed"] as const;
export const ONBOARDING_PROJECT_STATUSES = [
  "intake",
  "venue_record",
  "admin_invite",
  "staff_invites",
  "entitlement_review",
  "ready",
  "blocked",
  "cancelled",
] as const;
export const OPERATOR_REVIEW_STATES = ["pending_review", "approved", "blocked"] as const;
export const BILLING_PROVIDERS = ["none", "stripe", "manual_invoice", "external_procurement"] as const;
export const WORKSPACE_ENTITLEMENT_STATUSES = [
  "pending_provider_verification",
  "trial",
  "active",
  "past_due",
  "suspended",
  "cancelled",
] as const;
export const PROVIDER_VERIFICATION_STATUSES = [
  "not_required",
  "pending",
  "provider_verified",
  "operator_review_required",
  "rejected",
] as const;
export const ONBOARDING_AUDIT_EVENT_TYPES = [
  "workspace_created",
  "owner_invited",
  "staff_invited",
  "entitlement_recorded",
  "provider_verification_updated",
  "operator_review_updated",
] as const;

export const OrganisationIdSchema = z.string().uuid();
export const WorkspaceIdSchema = z.string().uuid();
export const WorkspaceMembershipIdSchema = z.string().uuid();
export const OnboardingProjectIdSchema = z.string().uuid();
export const WorkspaceEntitlementIdSchema = z.string().uuid();
export const OnboardingAuditEventIdSchema = z.string().uuid();
export const UserInvitationIdSchema = z.string().uuid();

export type OrganisationId = z.infer<typeof OrganisationIdSchema>;
export type WorkspaceId = z.infer<typeof WorkspaceIdSchema>;
export type WorkspaceMembershipId = z.infer<typeof WorkspaceMembershipIdSchema>;
export type OnboardingProjectId = z.infer<typeof OnboardingProjectIdSchema>;
export type WorkspaceEntitlementId = z.infer<typeof WorkspaceEntitlementIdSchema>;
export type OnboardingAuditEventId = z.infer<typeof OnboardingAuditEventIdSchema>;
export type UserInvitationId = z.infer<typeof UserInvitationIdSchema>;

export const OrganisationStatusSchema = z.enum(ORGANISATION_STATUSES);
export const WorkspaceStatusSchema = z.enum(WORKSPACE_STATUSES);
export const WorkspaceMemberRoleSchema = z.enum(WORKSPACE_MEMBER_ROLES);
export const StaffWorkspaceMemberRoleSchema = z.enum(STAFF_WORKSPACE_MEMBER_ROLES);
export const VenueInvitationRoleSchema = z.enum(VENUE_INVITATION_ROLES);
export const WorkspaceMembershipStatusSchema = z.enum(WORKSPACE_MEMBERSHIP_STATUSES);
export const OnboardingProjectStatusSchema = z.enum(ONBOARDING_PROJECT_STATUSES);
export const OperatorReviewStateSchema = z.enum(OPERATOR_REVIEW_STATES);
export const BillingProviderSchema = z.enum(BILLING_PROVIDERS);
export const WorkspaceEntitlementStatusSchema = z.enum(WORKSPACE_ENTITLEMENT_STATUSES);
export const ProviderVerificationStatusSchema = z.enum(PROVIDER_VERIFICATION_STATUSES);
export const OnboardingAuditEventTypeSchema = z.enum(ONBOARDING_AUDIT_EVENT_TYPES);

export type OrganisationStatus = z.infer<typeof OrganisationStatusSchema>;
export type WorkspaceStatus = z.infer<typeof WorkspaceStatusSchema>;
export type WorkspaceMemberRole = z.infer<typeof WorkspaceMemberRoleSchema>;
export type StaffWorkspaceMemberRole = z.infer<typeof StaffWorkspaceMemberRoleSchema>;
export type VenueInvitationRole = z.infer<typeof VenueInvitationRoleSchema>;
export type WorkspaceMembershipStatus = z.infer<typeof WorkspaceMembershipStatusSchema>;
export type OnboardingProjectStatus = z.infer<typeof OnboardingProjectStatusSchema>;
export type OperatorReviewState = z.infer<typeof OperatorReviewStateSchema>;
export type BillingProvider = z.infer<typeof BillingProviderSchema>;
export type WorkspaceEntitlementStatus = z.infer<typeof WorkspaceEntitlementStatusSchema>;
export type ProviderVerificationStatus = z.infer<typeof ProviderVerificationStatusSchema>;
export type OnboardingAuditEventType = z.infer<typeof OnboardingAuditEventTypeSchema>;

const IsoDateTimeSchema = z.string().datetime();
const PlanKeySchema = z
  .string()
  .trim()
  .min(1)
  .max(80)
  .regex(/^[a-z0-9][a-z0-9_-]*$/, "Plan key must be lowercase alphanumeric with dashes or underscores");
const ProviderReferenceSchema = z.string().trim().min(1).max(240);
const ReviewNoteSchema = z.string().trim().max(1000);

function hasProviderEvidence(input: {
  readonly providerCustomerRef?: string | null;
  readonly providerEntitlementRef?: string | null;
  readonly providerEvidenceRef?: string | null;
}): boolean {
  return (
    (input.providerCustomerRef ?? "").trim().length > 0 ||
    (input.providerEntitlementRef ?? "").trim().length > 0 ||
    (input.providerEvidenceRef ?? "").trim().length > 0
  );
}

function addProviderVerificationIssues(
  input: {
    readonly billingProvider: BillingProvider;
    readonly providerVerified?: boolean;
    readonly providerVerificationStatus?: ProviderVerificationStatus;
    readonly providerCustomerRef?: string | null;
    readonly providerEntitlementRef?: string | null;
    readonly providerEvidenceRef?: string | null;
    readonly accessEnforced: boolean;
  },
  ctx: z.RefinementCtx,
): void {
  const verified = input.providerVerified === true || input.providerVerificationStatus === "provider_verified";

  if (verified && input.billingProvider === "none") {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["billingProvider"],
      message: "Provider verification requires a real billing or invoice provider",
    });
  }

  if (verified && !hasProviderEvidence(input)) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["providerEvidenceRef"],
      message: "Provider verification requires a customer, entitlement, or evidence reference",
    });
  }

  if (input.accessEnforced && !verified) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["accessEnforced"],
      message: "Access cannot be enforced until the provider state is verified",
    });
  }
}

export const ManagedVenueOnboardingInputSchema = z.object({
  name: z.string().trim().min(1).max(200),
  slug: VenueSlugSchema,
  address: z.string().trim().min(1).max(500),
  logoUrl: z.string().url().nullable().optional(),
  brandColour: BrandColourSchema.optional(),
  timezone: TimezoneSchema.default(DEFAULT_VENUE_TIMEZONE),
}).strict();
export type ManagedVenueOnboardingInput = z.infer<typeof ManagedVenueOnboardingInputSchema>;

export const WorkspaceOwnerInviteInputSchema = z.object({
  email: EmailSchema,
  name: z.string().trim().min(1).max(200).nullable().optional(),
  workspaceRole: z.literal("owner").default("owner"),
  venueRole: VenueInvitationRoleSchema.default("staff"),
}).strict();
export type WorkspaceOwnerInviteInput = z.infer<typeof WorkspaceOwnerInviteInputSchema>;

export const WorkspaceStaffInviteInputSchema = z.object({
  email: EmailSchema,
  name: z.string().trim().min(1).max(200).nullable().optional(),
  workspaceRole: StaffWorkspaceMemberRoleSchema.default("staff"),
  venueRole: VenueInvitationRoleSchema.default("staff"),
}).strict();
export type WorkspaceStaffInviteInput = z.infer<typeof WorkspaceStaffInviteInputSchema>;

export const WorkspaceEntitlementInputSchema = z.object({
  planKey: PlanKeySchema,
  billingProvider: BillingProviderSchema.default("none"),
  providerCustomerRef: ProviderReferenceSchema.nullable().optional(),
  providerEntitlementRef: ProviderReferenceSchema.nullable().optional(),
  providerEvidenceRef: ProviderReferenceSchema.nullable().optional(),
  providerVerified: z.boolean().default(false),
  accessEnforced: z.boolean().default(false),
}).strict().superRefine(addProviderVerificationIssues);
export type WorkspaceEntitlementInput = z.infer<typeof WorkspaceEntitlementInputSchema>;

export const CreateManagedOnboardingSchema = z.object({
  organisationName: z.string().trim().min(1).max(200),
  workspaceName: z.string().trim().min(1).max(200).optional(),
  venue: ManagedVenueOnboardingInputSchema,
  ownerInvite: WorkspaceOwnerInviteInputSchema,
  staffInvites: z.array(WorkspaceStaffInviteInputSchema).max(25).default([]),
  entitlement: WorkspaceEntitlementInputSchema,
  operatorReviewNote: ReviewNoteSchema.nullable().optional(),
}).strict().superRefine((input, ctx) => {
  const seen = new Set<string>();
  const emails = [input.ownerInvite.email, ...input.staffInvites.map((invite) => invite.email)];
  for (const [index, email] of emails.entries()) {
    const normalized = email.trim().toLowerCase();
    if (seen.has(normalized)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: index === 0 ? ["ownerInvite", "email"] : ["staffInvites", index - 1, "email"],
        message: "Each workspace invitation email must be unique",
      });
    }
    seen.add(normalized);
  }
});
export type CreateManagedOnboarding = z.infer<typeof CreateManagedOnboardingSchema>;

export const InviteWorkspaceMembersSchema = z.object({
  staffInvites: z.array(WorkspaceStaffInviteInputSchema).min(1).max(50),
}).strict().superRefine((input, ctx) => {
  const seen = new Set<string>();
  input.staffInvites.forEach((invite, index) => {
    const normalized = invite.email.trim().toLowerCase();
    if (seen.has(normalized)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["staffInvites", index, "email"],
        message: "Each workspace invitation email must be unique",
      });
    }
    seen.add(normalized);
  });
});
export type InviteWorkspaceMembers = z.infer<typeof InviteWorkspaceMembersSchema>;

export const UpdateOnboardingProjectSchema = z.object({
  status: OnboardingProjectStatusSchema.optional(),
  currentStep: z.string().trim().min(1).max(240).optional(),
  operatorReviewState: OperatorReviewStateSchema.optional(),
  evidenceNote: ReviewNoteSchema.nullable().optional(),
}).strict();
export type UpdateOnboardingProject = z.infer<typeof UpdateOnboardingProjectSchema>;

export const VerifyWorkspaceEntitlementSchema = z.object({
  billingProvider: BillingProviderSchema,
  providerVerificationStatus: ProviderVerificationStatusSchema,
  providerCustomerRef: ProviderReferenceSchema.nullable().optional(),
  providerEntitlementRef: ProviderReferenceSchema.nullable().optional(),
  providerEvidenceRef: ProviderReferenceSchema.nullable().optional(),
  accessEnforced: z.boolean().default(false),
}).strict().superRefine(addProviderVerificationIssues);
export type VerifyWorkspaceEntitlement = z.infer<typeof VerifyWorkspaceEntitlementSchema>;

export const OrganisationSchema = z.object({
  id: OrganisationIdSchema,
  name: z.string().trim().min(1).max(200),
  status: OrganisationStatusSchema,
  createdBy: UserIdSchema.nullable(),
  createdAt: IsoDateTimeSchema,
  updatedAt: IsoDateTimeSchema,
  deletedAt: IsoDateTimeSchema.nullable(),
}).strict();
export type Organisation = z.infer<typeof OrganisationSchema>;

export const OnboardingVenueSchema = z.object({
  id: VenueIdSchema,
  name: z.string().trim().min(1).max(200),
  slug: VenueSlugSchema,
  address: z.string().trim().min(1).max(500),
  logoUrl: z.string().url().nullable(),
  brandColour: BrandColourSchema,
  timezone: TimezoneSchema,
  createdAt: IsoDateTimeSchema,
  updatedAt: IsoDateTimeSchema,
});
export type OnboardingVenue = z.infer<typeof OnboardingVenueSchema>;

export const WorkspaceSchema = z.object({
  id: WorkspaceIdSchema,
  organisationId: OrganisationIdSchema,
  primaryVenueId: VenueIdSchema,
  name: z.string().trim().min(1).max(200),
  status: WorkspaceStatusSchema,
  createdBy: UserIdSchema.nullable(),
  createdAt: IsoDateTimeSchema,
  updatedAt: IsoDateTimeSchema,
  deletedAt: IsoDateTimeSchema.nullable(),
}).strict();
export type Workspace = z.infer<typeof WorkspaceSchema>;

export const WorkspaceMembershipSchema = z.object({
  id: WorkspaceMembershipIdSchema,
  workspaceId: WorkspaceIdSchema,
  userId: UserIdSchema.nullable(),
  invitationId: UserInvitationIdSchema.nullable(),
  email: EmailSchema,
  role: WorkspaceMemberRoleSchema,
  venueRole: VenueInvitationRoleSchema,
  status: WorkspaceMembershipStatusSchema,
  invitedBy: UserIdSchema.nullable(),
  acceptedAt: IsoDateTimeSchema.nullable(),
  createdAt: IsoDateTimeSchema,
  updatedAt: IsoDateTimeSchema,
}).strict();
export type WorkspaceMembership = z.infer<typeof WorkspaceMembershipSchema>;

export const OnboardingProjectSchema = z.object({
  id: OnboardingProjectIdSchema,
  workspaceId: WorkspaceIdSchema,
  venueId: VenueIdSchema,
  status: OnboardingProjectStatusSchema,
  currentStep: z.string().trim().min(1).max(240),
  operatorReviewState: OperatorReviewStateSchema,
  evidenceNote: ReviewNoteSchema.nullable(),
  createdBy: UserIdSchema.nullable(),
  createdAt: IsoDateTimeSchema,
  updatedAt: IsoDateTimeSchema,
  completedAt: IsoDateTimeSchema.nullable(),
}).strict();
export type OnboardingProject = z.infer<typeof OnboardingProjectSchema>;

export const WorkspaceEntitlementSchema = z.object({
  id: WorkspaceEntitlementIdSchema,
  workspaceId: WorkspaceIdSchema,
  planKey: PlanKeySchema,
  status: WorkspaceEntitlementStatusSchema,
  billingProvider: BillingProviderSchema,
  providerCustomerRef: ProviderReferenceSchema.nullable(),
  providerEntitlementRef: ProviderReferenceSchema.nullable(),
  providerEvidenceRef: ProviderReferenceSchema.nullable(),
  providerVerificationStatus: ProviderVerificationStatusSchema,
  providerVerifiedAt: IsoDateTimeSchema.nullable(),
  accessEnforced: z.boolean(),
  createdBy: UserIdSchema.nullable(),
  createdAt: IsoDateTimeSchema,
  updatedAt: IsoDateTimeSchema,
}).strict().superRefine((input, ctx) => {
  if (input.accessEnforced && input.providerVerificationStatus !== "provider_verified") {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["accessEnforced"],
      message: "Access cannot be enforced until the provider state is verified",
    });
  }
  if (input.accessEnforced && input.providerVerifiedAt === null) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["providerVerifiedAt"],
      message: "Access enforcement requires a provider verification timestamp",
    });
  }
});
export type WorkspaceEntitlement = z.infer<typeof WorkspaceEntitlementSchema>;

export const OnboardingAuditEventSchema = z.object({
  id: OnboardingAuditEventIdSchema,
  workspaceId: WorkspaceIdSchema,
  projectId: OnboardingProjectIdSchema.nullable(),
  eventType: OnboardingAuditEventTypeSchema,
  summary: z.string().trim().min(1).max(500),
  actorUserId: UserIdSchema.nullable(),
  createdAt: IsoDateTimeSchema,
}).strict();
export type OnboardingAuditEvent = z.infer<typeof OnboardingAuditEventSchema>;

export const OnboardingSummarySchema = z.object({
  organisations: z.array(OrganisationSchema),
  workspaces: z.array(WorkspaceSchema),
  venues: z.array(OnboardingVenueSchema),
  memberships: z.array(WorkspaceMembershipSchema),
  projects: z.array(OnboardingProjectSchema),
  entitlements: z.array(WorkspaceEntitlementSchema),
  auditEvents: z.array(OnboardingAuditEventSchema),
}).strict();
export type OnboardingSummary = z.infer<typeof OnboardingSummarySchema>;

export const CreateManagedOnboardingResultSchema = z.object({
  organisation: OrganisationSchema,
  workspace: WorkspaceSchema,
  venue: OnboardingVenueSchema,
  ownerMembership: WorkspaceMembershipSchema,
  staffMemberships: z.array(WorkspaceMembershipSchema),
  project: OnboardingProjectSchema,
  entitlement: WorkspaceEntitlementSchema,
}).strict();
export type CreateManagedOnboardingResult = z.infer<typeof CreateManagedOnboardingResultSchema>;

export const InviteWorkspaceMembersResultSchema = z.object({
  memberships: z.array(WorkspaceMembershipSchema),
}).strict();
export type InviteWorkspaceMembersResult = z.infer<typeof InviteWorkspaceMembersResultSchema>;
