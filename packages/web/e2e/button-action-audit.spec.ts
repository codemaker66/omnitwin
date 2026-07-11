import { expect, test, type Page } from "@playwright/test";
import type {
  ChangeFeedItem,
  CreateManagedOnboardingResult,
  EventDayIssue,
  EventDayOpsBoard,
  InviteWorkspaceMembers,
  Notification,
  OnboardingProject,
  OnboardingSummary,
  OpsTask,
  UpdateOnboardingProject,
  VenueDashboardAnalytics,
  VerifyWorkspaceEntitlement,
  WorkspaceEntitlement,
  WorkspaceMembership,
} from "@omnitwin/types";
import type { PendingReviewEntry, ReviewHistoryEntry } from "../src/api/configuration-reviews.js";
import type { Activity, FollowUpTask, Opportunity, OpportunityDetail, PipelineSummary } from "../src/api/crm.js";
import type { Loadout, LoadoutDetail, LoadoutPhoto } from "../src/api/loadouts.js";
import type { PricingRule } from "../src/api/pricing.js";
import type { PublicProposal } from "../src/api/proposals.js";
import type { ProposalCommentRow, ProposalHistoryEntry, StaffProposal, StaffProposalVersion } from "../src/api/proposals.js";
import type { Space } from "../src/api/spaces.js";

const API = "http://localhost:3001";
const NOW = "2026-06-18T12:00:00.000Z";
const VENUE_ID = "00000000-0000-4000-8000-000000004001";
const SPACE_ID = "00000000-0000-4000-8000-000000004002";
const EVENT_ID = "00000000-0000-4000-8000-000000004003";
const PACK_ID = "00000000-0000-4000-8000-000000004004";
const TASK_ID = "00000000-0000-4000-8000-000000004005";
const CHANGE_ID = "00000000-0000-4000-8000-000000004006";
const CONFIG_ID = "00000000-0000-4000-8000-000000004007";
const SNAPSHOT_ID = "00000000-0000-4000-8000-000000004008";
const NOTIFICATION_ID = "00000000-0000-4000-8000-000000004009";
const ISSUE_ID = "00000000-0000-4000-8000-000000004010";
const PROPOSAL_ID = "00000000-0000-4000-8000-000000004018";
const LOADOUT_ID = "00000000-0000-4000-8000-000000004019";
const PROPOSAL_COMMENT_ID = "00000000-0000-4000-8000-000000004020";
const ONBOARDING_WORKSPACE_ID = "00000000-0000-4000-8000-000000004021";
const OPPORTUNITY_ID = "00000000-0000-4000-8000-000000004050";
const OPPORTUNITY_TASK_ID = "00000000-0000-4000-8000-000000004051";
const ONBOARDING_PROJECT_ID = "00000000-0000-4000-8000-000000004028";
const ONBOARDING_ENTITLEMENT_ID = "00000000-0000-4000-8000-000000004029";
const LOADOUT_PHOTO_ID = "00000000-0000-4000-8000-000000004030";
const LOADOUT_SECOND_PHOTO_ID = "00000000-0000-4000-8000-000000004031";
const UPLOADED_FILE_ID = "00000000-0000-4000-8000-000000004032";
const SHARE_CODE = "abcdef";
const SHARE_TOKEN = "button-audit-share";
const HASH = "b".repeat(64);

interface VisibleControlSnapshot {
  readonly tagName: string;
  readonly role: string | null;
  readonly label: string;
  readonly rawHref: string | null;
  readonly disabled: boolean;
  readonly width: number;
  readonly height: number;
}

interface PageProblems {
  readonly pageErrors: readonly string[];
  readonly consoleErrors: readonly string[];
}

interface DashboardMockState {
  readonly reviewNotes: string[];
  readonly createdLoadouts: string[];
  readonly createdOnboarding: string[];
  readonly proposalReplies: string[];
  readonly proposalShareRequests: string[];
  readonly renamedLoadouts: string[];
  readonly deletedLoadouts: string[];
  readonly uploadedFileNames: string[];
  readonly linkedFileIds: string[];
  readonly photoCaptions: string[];
  readonly photoOrders: string[];
  readonly deletedPhotos: string[];
  readonly invitedStaffEmails: string[];
  readonly savedProjectGates: string[];
  readonly savedProviderGates: string[];
  readonly savedVenueSettings: string[];
  readonly createdAdminVenues: string[];
  readonly createdAdminSpaces: string[];
  readonly createdPricingRules: string[];
  readonly deletedPricingRules: string[];
  readonly createdPipelineOpportunities: string[];
  readonly enquiryOpportunityRequests: string[];
  readonly pipelineStageUpdates: string[];
  readonly completedPipelineTasks: string[];
  readonly addedPipelineTasks: string[];
  readonly addedOpportunityNotes: string[];
  readonly createdOpportunityProposalDrafts: string[];
}

interface DashboardMockOptions {
  readonly onboardingPopulated?: boolean;
  readonly failProjectGateOnce?: boolean;
  readonly failAnalyticsOnce?: boolean;
  readonly failPipelineOnce?: boolean;
  readonly failOpportunityDetailOnce?: boolean;
  readonly failProposalHistoryOnce?: boolean;
  readonly failProposalCommentsOnce?: boolean;
  readonly failReviewsListOnce?: boolean;
  readonly failReviewHistoryOnce?: boolean;
  readonly failReviewApproveOnce?: boolean;
  readonly failLoadoutListOnce?: boolean;
  readonly failLoadoutCreateOnce?: boolean;
  readonly failLoadoutDetailOnce?: boolean;
  readonly failLoadoutCaptionOnce?: boolean;
}

function watchPageProblems(page: Page): PageProblems {
  const pageErrors: string[] = [];
  const consoleErrors: string[] = [];

  page.on("pageerror", (error) => {
    pageErrors.push(error.message);
  });
  page.on("console", (message) => {
    if (message.type() === "error" && !message.text().startsWith("Failed to load resource:")) {
      consoleErrors.push(message.text());
    }
  });

  return { pageErrors, consoleErrors };
}

type SeedRole = "staff" | "planner" | "hallkeeper" | "admin" | "platform-admin" | "executive" | "supplier";

async function seedAuthenticatedUser(page: Page, role: SeedRole): Promise<void> {
  await page.addInitScript(({ seedRole, venueId }) => {
    const roleSuffix: Record<string, string> = {
      staff: "91",
      planner: "92",
      hallkeeper: "93",
      admin: "94",
      "platform-admin": "97",
      executive: "95",
      supplier: "96",
    };
    const isPlatformAdmin = seedRole === "platform-admin";
    const venueRole = isPlatformAdmin ? "admin" : seedRole;
    Object.defineProperty(window, "__OMNITWIN_E2E__", { value: true, writable: false });
    Object.defineProperty(window, "__OMNITWIN_SEED_USER__", {
      value: {
        id: `00000000-0000-4000-8000-0000000040${roleSuffix[seedRole] ?? "99"}`,
        email: `${seedRole}@button-audit.test`,
        role: venueRole,
        platformRole: isPlatformAdmin ? "admin" : "none",
        venueId: isPlatformAdmin ? null : venueId,
        name: `${seedRole[0]?.toUpperCase() ?? "U"}${seedRole.slice(1)} Audit`,
      },
      writable: false,
    });
  }, { seedRole: role, venueId: VENUE_ID });
}

function venueDetailFixture() {
  return {
    id: VENUE_ID,
    name: "Trades Hall Glasgow",
    slug: "trades-hall",
    address: "85 Glassford Street",
    logoUrl: null,
    brandColour: null,
    spaces: [spaceFixture()],
  };
}

function spaceFixture() {
  return {
    id: SPACE_ID,
    venueId: VENUE_ID,
    name: "Grand Hall",
    slug: "grand-hall",
    widthM: "21",
    lengthM: "10.5",
    heightM: "7.5",
    floorPlanOutline: [
      { x: 0, y: 0 },
      { x: 21, y: 0 },
      { x: 21, y: 10.5 },
      { x: 0, y: 10.5 },
    ],
  };
}

function dashboardSpaceFixture(): Space {
  return {
    ...spaceFixture(),
    loadoutCount: 1,
  };
}

function pricingRuleFixture(): PricingRule {
  return {
    id: "00000000-0000-4000-8000-000000004038",
    venueId: VENUE_ID,
    spaceId: SPACE_ID,
    name: "Grand Hall Half Day",
    type: "flat_rate",
    amount: "950.00",
    currency: "GBP",
    minHours: null,
    minGuests: null,
    isActive: true,
    validFrom: null,
    validTo: null,
  };
}

function publicConfigurationFixture() {
  return {
    id: CONFIG_ID,
    spaceId: SPACE_ID,
    venueId: VENUE_ID,
    userId: null,
    name: "Button audit Grand Hall",
    isPublicPreview: true,
    revision: 1,
    objects: [],
  };
}

function publicProposalFixture(status: PublicProposal["status"] = "sent"): PublicProposal {
  return {
    title: "Reception Room wedding proposal",
    status,
    sentAt: NOW,
    venueName: "Trades Hall Glasgow",
    clientMessage: "Review this planning draft and send a response to the venue team.",
    capacityNote: "Planning estimate only. Human review required before final operational reliance.",
    roomSummary: "Reception Room",
    layoutSummary: "Dinner layout with guest comfort protected.",
    packageSummary: ["Dinner package", "Late-night extension"],
    quote: {
      quoteId: null,
      currency: "GBP",
      lineItems: [
        {
          description: "Reception Room hire",
          quantity: 1,
          unitAmountMinor: 125_000,
          lineTotalMinor: 125_000,
        },
      ],
      subtotalMinor: 125_000,
      totalMinor: 125_000,
    },
    version: 1,
    comments: [
      { kind: "comment", authorName: "Venue team", body: "We can adjust the arrival time.", createdAt: NOW },
    ],
    packages: [
      { label: "Dinner package", quantity: 1, totalMinor: 125_000, status: "included" },
    ],
    layoutSnapshot: null,
  };
}

function staffProposalFixture(overrides: Partial<StaffProposal> = {}): StaffProposal {
  return {
    id: PROPOSAL_ID,
    venueId: VENUE_ID,
    opportunityId: null,
    enquiryId: null,
    configurationId: CONFIG_ID,
    title: "Reception Room wedding proposal",
    status: "draft",
    currentVersion: 1,
    shareCode: null,
    sentAt: null,
    createdBy: "00000000-0000-4000-8000-000000004091",
    createdAt: NOW,
    updatedAt: NOW,
    deletedAt: null,
    ...overrides,
  };
}

function staffProposalVersionFixture(): StaffProposalVersion {
  return {
    id: "00000000-0000-4000-8000-000000004022",
    proposalId: PROPOSAL_ID,
    version: 1,
    payload: {
      schemaVersion: "venviewer.proposal-version.v1",
      title: "Reception Room wedding proposal",
      clientMessage: "Planning-grade proposal prepared for review.",
      configurationId: CONFIG_ID,
      layoutRevision: null,
      capacityNote: "Planning estimate only. Human review required before final operational reliance.",
      quote: null,
    },
    sourceHash: HASH,
    createdBy: "00000000-0000-4000-8000-000000004091",
    createdAt: NOW,
  };
}

function proposalHistoryFixture(): ProposalHistoryEntry {
  return {
    id: "00000000-0000-4000-8000-000000004023",
    proposalId: PROPOSAL_ID,
    fromStatus: "draft",
    toStatus: "draft",
    changedBy: "00000000-0000-4000-8000-000000004091",
    note: "Initial planning-grade proposal draft created.",
    createdAt: NOW,
  };
}

function proposalCommentFixture(authorType: "client" | "staff" = "client"): ProposalCommentRow {
  return {
    id: PROPOSAL_COMMENT_ID,
    kind: "comment",
    authorType,
    authorName: authorType === "client" ? "Elaine Wilson" : "Venue team",
    body: authorType === "client"
      ? "Could we keep a clearer route near the main doors?"
      : "We will review that route with the venue team.",
    isClientVisible: true,
    createdAt: NOW,
  };
}

function opportunityFixture(overrides: Partial<Opportunity> = {}): Opportunity {
  return {
    id: OPPORTUNITY_ID,
    venueId: VENUE_ID,
    clientAccountId: null,
    primaryContactId: null,
    sourceEnquiryId: "enquiry-button-audit",
    ownerUserId: "00000000-0000-4000-8000-000000004091",
    title: "Reception Room wedding enquiry",
    stage: "new",
    eventType: "wedding",
    preferredDate: "2026-09-20",
    guestCount: 120,
    estimatedValueMinor: 125_000,
    currency: "GBP",
    nextAction: "Confirm event basics",
    nextActionDueAt: null,
    createdAt: NOW,
    updatedAt: NOW,
    closedAt: null,
    deletedAt: null,
    ...overrides,
  };
}

function pipelineTaskFixture(overrides: Partial<FollowUpTask> = {}): FollowUpTask {
  return {
    id: OPPORTUNITY_TASK_ID,
    opportunityId: OPPORTUNITY_ID,
    assignedTo: "00000000-0000-4000-8000-000000004091",
    title: "Confirm planning assumptions",
    dueAt: null,
    status: "open",
    completedAt: null,
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  };
}

function opportunityActivityFixture(overrides: Partial<Activity> = {}): Activity {
  return {
    id: "00000000-0000-4000-8000-000000004052",
    opportunityId: OPPORTUNITY_ID,
    type: "note",
    body: "Client asked for a planning-grade quote.",
    createdBy: "00000000-0000-4000-8000-000000004091",
    createdAt: NOW,
    ...overrides,
  };
}

function opportunityDetailFixture(overrides: Partial<OpportunityDetail> = {}): OpportunityDetail {
  return {
    opportunity: opportunityFixture(),
    activities: [opportunityActivityFixture()],
    tasks: [pipelineTaskFixture()],
    proposals: [],
    ...overrides,
  };
}

function pipelineSummaryFixture(overrides: Partial<PipelineSummary> = {}): PipelineSummary {
  return {
    opportunities: [opportunityFixture()],
    todayTasks: [pipelineTaskFixture()],
    stageCounts: { new: 1 },
    ...overrides,
  };
}

function pendingReviewFixture(overrides: Partial<PendingReviewEntry> = {}): PendingReviewEntry {
  return {
    id: CONFIG_ID,
    name: "Reception Room dinner review",
    venueId: VENUE_ID,
    spaceId: SPACE_ID,
    userId: null,
    reviewStatus: "submitted",
    submittedAt: NOW,
    updatedAt: NOW,
    guestCount: 120,
    ...overrides,
  };
}

function reviewHistoryFixture(): ReviewHistoryEntry {
  return {
    id: "00000000-0000-4000-8000-000000004024",
    configurationId: CONFIG_ID,
    fromStatus: "draft",
    toStatus: "submitted",
    changedByName: "Planner Audit",
    note: "Submitted for venue review.",
    createdAt: NOW,
  };
}

function snapshotEnvelopeFixture() {
  return {
    id: SNAPSHOT_ID,
    configurationId: CONFIG_ID,
    version: 2,
    payload: {},
    diagramUrl: null,
    pdfUrl: null,
    sourceHash: HASH,
    createdAt: NOW,
    createdBy: null,
    approvedAt: NOW,
    approvedBy: null,
  };
}

function loadoutFixture(overrides: Partial<Loadout> = {}): Loadout {
  return {
    id: LOADOUT_ID,
    name: "Ceremony reference setup",
    description: "Room reference for a formal ceremony layout.",
    createdAt: NOW,
    photoCount: 0,
    coverFileKey: null,
    ...overrides,
  };
}

function loadoutDetailFixture(overrides: Partial<LoadoutDetail> = {}): LoadoutDetail {
  return {
    id: LOADOUT_ID,
    spaceId: SPACE_ID,
    venueId: VENUE_ID,
    name: "Ceremony reference setup",
    description: "Room reference for a formal ceremony layout.",
    createdAt: NOW,
    updatedAt: NOW,
    photos: [loadoutPhotoFixture(), loadoutPhotoFixture({
      id: LOADOUT_SECOND_PHOTO_ID,
      fileId: "00000000-0000-4000-8000-000000004033",
      caption: null,
      sortOrder: 1,
      fileKey: "loadouts/ceremony-platform.jpg",
      filename: "ceremony-platform.jpg",
    })],
    ...overrides,
  };
}

function loadoutPhotoFixture(overrides: Partial<LoadoutPhoto> = {}): LoadoutPhoto {
  return {
    id: LOADOUT_PHOTO_ID,
    fileId: "00000000-0000-4000-8000-000000004034",
    caption: "Room entrance",
    sortOrder: 0,
    fileKey: "loadouts/setup-entrance.jpg",
    filename: "setup-entrance.jpg",
    contentType: "image/jpeg",
    ...overrides,
  };
}

function onboardingSummaryFixture(): OnboardingSummary {
  return {
    organisations: [],
    workspaces: [],
    venues: [],
    memberships: [],
    projects: [],
    entitlements: [],
    auditEvents: [],
  };
}

function onboardingCreateResultFixture(): CreateManagedOnboardingResult {
  const organisationId = "00000000-0000-4000-8000-000000004025";
  const ownerMembershipId = "00000000-0000-4000-8000-000000004026";
  const ownerInvitationId = "00000000-0000-4000-8000-000000004027";

  return {
    organisation: {
      id: organisationId,
      name: "Trades Hall Trust",
      status: "onboarding",
      createdBy: null,
      createdAt: NOW,
      updatedAt: NOW,
      deletedAt: null,
    },
    workspace: {
      id: ONBOARDING_WORKSPACE_ID,
      organisationId,
      primaryVenueId: VENUE_ID,
      name: "Trades Hall deployment",
      status: "onboarding",
      createdBy: null,
      createdAt: NOW,
      updatedAt: NOW,
      deletedAt: null,
    },
    venue: {
      id: VENUE_ID,
      name: "Trades Hall Glasgow",
      slug: "trades-hall-glasgow",
      address: "85 Glassford Street, Glasgow G1 1UH",
      logoUrl: null,
      brandColour: null,
      timezone: "Europe/London",
      createdAt: NOW,
      updatedAt: NOW,
    },
    ownerMembership: {
      id: ownerMembershipId,
      workspaceId: ONBOARDING_WORKSPACE_ID,
      userId: null,
      invitationId: ownerInvitationId,
      email: "owner@tradeshall.co.uk",
      role: "owner",
      venueRole: "staff",
      status: "invited",
      invitedBy: null,
      acceptedAt: null,
      createdAt: NOW,
      updatedAt: NOW,
    },
    staffMemberships: [],
    project: {
      id: ONBOARDING_PROJECT_ID,
      workspaceId: ONBOARDING_WORKSPACE_ID,
      venueId: VENUE_ID,
      status: "admin_invite",
      currentStep: "Workspace owner invitation is pending acceptance.",
      operatorReviewState: "pending_review",
      evidenceNote: "Operator review required before deployment is marked ready.",
      createdBy: null,
      createdAt: NOW,
      updatedAt: NOW,
      completedAt: null,
    },
    entitlement: {
      id: ONBOARDING_ENTITLEMENT_ID,
      workspaceId: ONBOARDING_WORKSPACE_ID,
      planKey: "managed_deployment",
      status: "pending_provider_verification",
      billingProvider: "none",
      providerCustomerRef: null,
      providerEntitlementRef: null,
      providerEvidenceRef: null,
      providerVerificationStatus: "not_required",
      providerVerifiedAt: null,
      accessEnforced: false,
      createdBy: null,
      createdAt: NOW,
      updatedAt: NOW,
    },
  };
}

function onboardingSummaryFromCreate(result: CreateManagedOnboardingResult): OnboardingSummary {
  return {
    organisations: [result.organisation],
    workspaces: [result.workspace],
    venues: [result.venue],
    memberships: [result.ownerMembership, ...result.staffMemberships],
    projects: [result.project],
    entitlements: [result.entitlement],
    auditEvents: [],
  };
}

function onboardingPopulatedSummaryFixture(): OnboardingSummary {
  return onboardingSummaryFromCreate(onboardingCreateResultFixture());
}

function syntheticInviteUuid(seed: number): string {
  return `00000000-0000-4000-8000-${String(seed).padStart(12, "0")}`;
}

function notificationFixture(readAt: string | null = null): Notification {
  return {
    id: NOTIFICATION_ID,
    changeId: CHANGE_ID,
    eventId: EVENT_ID,
    venueId: VENUE_ID,
    audienceRole: "staff",
    recipientUserId: null,
    title: "Guest count updated",
    body: "The client updated the guest count. Review the plan before the handoff is used.",
    severity: "attention",
    actionPath: `/ops/events/${EVENT_ID}`,
    createdAt: NOW,
    readAt,
  };
}

function changeFeedFixture(): ChangeFeedItem {
  return {
    id: CHANGE_ID,
    eventId: EVENT_ID,
    venueId: VENUE_ID,
    configurationId: CONFIG_ID,
    proposalId: null,
    handoffPackId: PACK_ID,
    actorUserId: null,
    actorRole: "client",
    actorLabel: "Client",
    sourceKind: "proposal_comment",
    sourceId: "button-audit-comment",
    title: "Guest count changed",
    summary: "Guest count increased from 112 to 120 after the handoff was compiled.",
    beforeSummary: "112 guests",
    afterSummary: "120 guests",
    affectedSurfaces: ["guest_count", "ops_tasks"],
    audienceRoles: ["hallkeeper", "staff"],
    riskLevel: "attention",
    requiresHallkeeperAcknowledgement: true,
    createdAt: NOW,
  };
}

function taskFixture(status: OpsTask["status"] = "todo"): OpsTask {
  return {
    id: TASK_ID,
    handoffPackId: PACK_ID,
    taskGroupId: null,
    phaseId: null,
    kind: "setup",
    title: "Set room tables",
    detail: "Place tables from the latest internal handoff pack.",
    status,
    sortOrder: 0,
    dueLabel: "Before arrival",
    sourceRef: "handoff-pack-v1",
    createdAt: NOW,
    updatedAt: NOW,
  };
}

function eventDayIssueFixture(): EventDayIssue {
  return {
    id: ISSUE_ID,
    eventId: EVENT_ID,
    phaseId: null,
    opsTaskId: null,
    title: "Blocked access door",
    detail: "North service door needs venue team attention.",
    status: "open",
    severity: "attention",
    source: "hallkeeper",
    reportedBy: null,
    assignedTo: null,
    escalationNote: null,
    createdAt: NOW,
    updatedAt: NOW,
    resolvedAt: null,
  };
}

function eventDayBoardFixture(taskStatus: OpsTask["status"] = "todo"): EventDayOpsBoard {
  return {
    event: {
      id: EVENT_ID,
      venueId: VENUE_ID,
      createdBy: null,
      name: "Wilson wedding",
      eventType: "wedding",
      status: "ready_for_ops",
      startsAt: NOW,
      endsAt: null,
      guestCount: 120,
      clientName: "Wilson",
      notes: null,
      createdAt: NOW,
      updatedAt: NOW,
    },
    phases: [
      {
        id: "00000000-0000-4000-8000-000000004011",
        eventId: EVENT_ID,
        templateKey: "arrival",
        name: "Arrival",
        sortOrder: 0,
        startsAt: NOW,
        durationMinutes: 30,
        guestCount: 120,
        opsTasksCount: 1,
        reviewGatesCount: 1,
        densityStatus: "not_checked",
        densityLabel: "Density not checked",
        staffConflictsStatus: "not_checked",
        staffConflictsLabel: "Staff conflicts not checked",
        notes: null,
        createdAt: NOW,
        updatedAt: NOW,
      },
    ],
    handoffPack: {
      pack: {
        id: PACK_ID,
        eventId: EVENT_ID,
        configId: CONFIG_ID,
        snapshotId: SNAPSHOT_ID,
        snapshotHash: HASH,
        version: 1,
        status: "compiled",
        sourceLabel: "Approved configuration snapshot v1",
        summary: "Internal operations handoff from approved planning data.",
        createdBy: null,
        compiledAt: NOW,
        updatedAt: NOW,
      },
      taskGroups: [],
      opsTasks: [taskFixture(taskStatus)],
      furniturePickList: {
        id: "00000000-0000-4000-8000-000000004012",
        handoffPackId: PACK_ID,
        title: "Pick list",
        totalItems: 12,
        createdAt: NOW,
      },
      pickListItems: [],
      supplierInstructions: [
        {
          id: "00000000-0000-4000-8000-000000004013",
          handoffPackId: PACK_ID,
          supplierId: null,
          category: "catering",
          title: "Catering arrival",
          detail: "Confirm arrival at staff entrance.",
          arrivalWindow: "16:00-16:30",
          sourceRef: "event-notes",
          sortOrder: 0,
          createdAt: NOW,
        },
      ],
      loadInSequence: [],
      breakdownSequence: [],
      roomFlipPlans: [],
      beoDocument: {
        id: "00000000-0000-4000-8000-000000004014",
        handoffPackId: PACK_ID,
        title: "Internal BEO",
        body: "Internal operations handoff.",
        sourceSnapshotHash: HASH,
        safeStatus: "internal_operations_handoff",
        createdAt: NOW,
      },
      snapshotDiff: {
        id: "00000000-0000-4000-8000-000000004015",
        handoffPackId: PACK_ID,
        previousSnapshotHash: null,
        currentSnapshotHash: HASH,
        addedCount: 1,
        removedCount: 0,
        changedCount: 1,
        summary: "Two planning changes since the last handoff.",
        payload: {
          added: ["Additional table"],
          removed: [],
          changed: ["Supplier arrival note updated"],
        },
        createdAt: NOW,
      },
    },
    assignments: [],
    issues: [],
    statusUpdates: [],
    setupProgress: {
      totalTasks: 1,
      doneTasks: taskStatus === "done" ? 1 : 0,
      blockedTasks: taskStatus === "blocked" ? 1 : 0,
      activeTasks: taskStatus === "done" || taskStatus === "blocked" ? 0 : 1,
      percent: taskStatus === "done" ? 100 : 0,
    },
    supplierArrivals: [
      {
        instructionId: "00000000-0000-4000-8000-000000004013",
        title: "Catering arrival",
        category: "catering",
        arrivalWindow: "16:00-16:30",
        detail: "Confirm arrival at staff entrance.",
        statusLabel: "Expected 16:00-16:30",
      },
    ],
    escalationNotes: ["Review staffing for bar queue before doors open."],
    changesSinceLastHandoff: {
      handoffPackId: PACK_ID,
      summary: "Two planning changes since the last handoff.",
      added: ["Additional table"],
      removed: [],
      changed: ["Supplier arrival note updated"],
      currentSnapshotHash: HASH,
      previousSnapshotHash: null,
    },
    sourceStatus: "ready",
  };
}

function missingHandoffEventDayBoardFixture(): EventDayOpsBoard {
  const board = eventDayBoardFixture();
  return {
    ...board,
    handoffPack: null,
    supplierArrivals: [],
    setupProgress: {
      totalTasks: 0,
      doneTasks: 0,
      blockedTasks: 0,
      activeTasks: 0,
      percent: 0,
    },
    changesSinceLastHandoff: {
      handoffPackId: null,
      summary: "No compiled handoff is linked to this event yet.",
      added: [],
      removed: [],
      changed: [],
      currentSnapshotHash: null,
      previousSnapshotHash: null,
    },
    sourceStatus: "missing_handoff",
  };
}

function revenueAnalyticsFixture(): VenueDashboardAnalytics {
  return {
    generatedAt: NOW,
    currency: "GBP",
    pipelineValueMinor: 475_000,
    enquiryConversionPercent: 42,
    proposalStatusCounts: {
      draft: 2,
      sent: 3,
      accepted: 1,
      changes_requested: 1,
    },
    roomUtilisation: [
      {
        spaceId: SPACE_ID,
        roomName: "Grand Hall",
        bookedEvents: 4,
        proposedEvents: 3,
        utilisationPercent: 64,
        reviewBottlenecks: 1,
      },
    ],
    revenueScenarios: [
      {
        id: "00000000-0000-4000-8000-000000004016",
        venueId: VENUE_ID,
        eventId: EVENT_ID,
        configurationId: null,
        quoteId: null,
        name: "Dinner reception planning scenario",
        scenarioKind: "quote_based",
        status: "active",
        currency: "GBP",
        plannedGuestCount: 120,
        estimatedRevenueMinor: 220_000,
        estimatedCostMinor: 70_000,
        estimatedMarginMinor: 150_000,
        comfortStatus: "review_required",
        reviewGateCount: 2,
        createdBy: null,
        createdAt: NOW,
        updatedAt: NOW,
      },
    ],
    comfortFloorWarnings: ["Bar queue comfort floor requires review."],
    reviewBottlenecks: ["Route clearance gate needs human review."],
    disclosure: "Commercial planning insight - review constraints preserved",
  };
}

async function mockPlannerRoutes(page: Page): Promise<void> {
  await page.route(`${API}/public/configurations/${CONFIG_ID}`, (route) => {
    void route.fulfill({ json: { data: publicConfigurationFixture() } });
  });
  await page.route(`${API}/venues/${VENUE_ID}/spaces/${SPACE_ID}`, (route) => {
    void route.fulfill({ json: { data: spaceFixture() } });
  });
  await page.route(`${API}/assets/runtime-packages/latest**`, (route) => {
    void route.fulfill({ json: { data: null } });
  });
}

async function mockPublicRoomRoutes(page: Page): Promise<void> {
  await page.route(`${API}/assets/runtime-packages/public-room-visual**`, (route) => {
    void route.fulfill({
      json: {
        data: {
          venueSlug: "trades-hall",
          roomSlug: "reception-room",
          runtimeVisualAvailable: false,
          visualUrl: null,
          visualLabel: "Visual preview",
          safeCopy: "Runtime room visual is not currently available for this public preview. Final details are confirmed by the venue team.",
          humanReviewRequired: true,
        },
      },
    });
  });
}

async function mockProposalRoutes(page: Page): Promise<void> {
  await page.route(`${API}/public/proposals/${SHARE_CODE}`, (route) => {
    void route.fulfill({ json: { data: publicProposalFixture() } });
  });
  await page.route(`${API}/public/proposals/${SHARE_CODE}/respond`, (route) => {
    void route.fulfill({ json: { data: { status: "accepted" } } });
  });
  await page.route(`${API}/proposal-share/${SHARE_TOKEN}`, (route) => {
    void route.fulfill({ json: { data: publicProposalFixture() } });
  });
  await page.route(`${API}/proposal-share/${SHARE_TOKEN}/comment`, (route) => {
    void route.fulfill({
      json: {
        data: {
          kind: "comment",
          authorName: "Client",
          body: "Could we move the arrival time thirty minutes later?",
          createdAt: NOW,
        },
      },
    });
  });
  await page.route(`${API}/proposal-share/${SHARE_TOKEN}/approve`, (route) => {
    void route.fulfill({ json: { data: { status: "accepted" } } });
  });
}

async function mockDashboardRoutes(page: Page, options: DashboardMockOptions = {}): Promise<DashboardMockState> {
  const reviewNotes: string[] = [];
  const createdLoadouts: string[] = [];
  const createdOnboarding: string[] = [];
  const proposalReplies: string[] = [];
  const proposalShareRequests: string[] = [];
  const renamedLoadouts: string[] = [];
  const deletedLoadouts: string[] = [];
  const uploadedFileNames: string[] = [];
  const linkedFileIds: string[] = [];
  const photoCaptions: string[] = [];
  const photoOrders: string[] = [];
  const deletedPhotos: string[] = [];
  const invitedStaffEmails: string[] = [];
  const savedProjectGates: string[] = [];
  const savedProviderGates: string[] = [];
  const savedVenueSettings: string[] = [];
  const createdAdminVenues: string[] = [];
  const createdAdminSpaces: string[] = [];
  const createdPricingRules: string[] = [];
  const deletedPricingRules: string[] = [];
  const createdPipelineOpportunities: string[] = [];
  const enquiryOpportunityRequests: string[] = [];
  const pipelineStageUpdates: string[] = [];
  const completedPipelineTasks: string[] = [];
  const addedPipelineTasks: string[] = [];
  const addedOpportunityNotes: string[] = [];
  const createdOpportunityProposalDrafts: string[] = [];
  let loadoutName = "Ceremony reference setup";
  let loadoutPhotos: LoadoutPhoto[] = [
    loadoutPhotoFixture(),
    loadoutPhotoFixture({
      id: LOADOUT_SECOND_PHOTO_ID,
      fileId: "00000000-0000-4000-8000-000000004033",
      caption: null,
      sortOrder: 1,
      fileKey: "loadouts/ceremony-platform.jpg",
      filename: "ceremony-platform.jpg",
    }),
  ];
  let onboardingSummary = options.onboardingPopulated === true
    ? onboardingPopulatedSummaryFixture()
    : onboardingSummaryFixture();
  let failProjectGateOnce = options.failProjectGateOnce === true;
  let remainingAnalyticsFailures = options.failAnalyticsOnce === true ? 2 : 0;
  let remainingPipelineFailures = options.failPipelineOnce === true ? 2 : 0;
  let failOpportunityDetailOnce = options.failOpportunityDetailOnce === true;
  let failProposalHistoryOnce = options.failProposalHistoryOnce === true;
  let failProposalCommentsOnce = options.failProposalCommentsOnce === true;
  let remainingReviewsListFailures = options.failReviewsListOnce === true ? 2 : 0;
  let remainingReviewHistoryFailures = options.failReviewHistoryOnce === true ? 2 : 0;
  let failReviewApproveOnce = options.failReviewApproveOnce === true;
  let failLoadoutListOnce = options.failLoadoutListOnce === true;
  let failLoadoutCreateOnce = options.failLoadoutCreateOnce === true;
  let remainingLoadoutDetailFailures = options.failLoadoutDetailOnce === true ? 2 : 0;
  let failLoadoutCaptionOnce = options.failLoadoutCaptionOnce === true;

  await page.route(`${API}/venues`, (route) => {
    if (route.request().method() === "POST") {
      const body = route.request().postDataJSON() as {
        readonly name?: string;
        readonly slug?: string;
        readonly address?: string;
      };
      createdAdminVenues.push(`${body.name ?? ""}|${body.slug ?? ""}|${body.address ?? ""}`);
      void route.fulfill({
        status: 201,
        json: {
          data: {
            id: "00000000-0000-4000-8000-000000004039",
            name: body.name ?? "New venue",
            slug: body.slug ?? "new-venue",
            address: body.address ?? "",
            logoUrl: null,
            brandColour: null,
          },
        },
      });
      return;
    }
    void route.fulfill({ json: { data: [venueDetailFixture()] } });
  });

  await page.route(`${API}/venues/${VENUE_ID}`, (route) => {
    if (route.request().method() === "PATCH") {
      const body = route.request().postDataJSON() as {
        readonly name?: string;
        readonly address?: string;
        readonly brandColour?: string | null;
        readonly logoUrl?: string | null;
      };
      savedVenueSettings.push(`${body.name ?? ""}|${body.address ?? ""}|${body.brandColour ?? ""}|${body.logoUrl ?? ""}`);
      void route.fulfill({
        json: {
          data: {
            id: VENUE_ID,
            name: body.name ?? "Trades Hall Glasgow",
            slug: "trades-hall",
            address: body.address ?? "85 Glassford Street",
            logoUrl: body.logoUrl ?? null,
            brandColour: body.brandColour ?? null,
          },
        },
      });
      return;
    }
    void route.fulfill({ json: { data: venueDetailFixture() } });
  });
  await page.route(`${API}/venues/${VENUE_ID}/spaces`, (route) => {
    if (route.request().method() === "POST") {
      const body = route.request().postDataJSON() as {
        readonly name?: string;
        readonly slug?: string;
        readonly heightM?: number;
        readonly floorPlanOutline?: readonly unknown[];
      };
      createdAdminSpaces.push(`${body.name ?? ""}|${body.slug ?? ""}|${String(body.heightM ?? "")}|${String(body.floorPlanOutline?.length ?? 0)}`);
      void route.fulfill({
        status: 201,
        json: {
          data: {
            ...spaceFixture(),
            id: "00000000-0000-4000-8000-000000004040",
            name: body.name ?? "New Space",
            slug: body.slug ?? "new-space",
            heightM: String(body.heightM ?? "4"),
            floorPlanOutline: body.floorPlanOutline ?? spaceFixture().floorPlanOutline,
          },
        },
      });
      return;
    }
    void route.fulfill({ json: { data: [dashboardSpaceFixture()] } });
  });
  await page.route(`${API}/venues/${VENUE_ID}/spaces/${SPACE_ID}`, (route) => {
    if (route.request().method() === "PATCH") {
      const body = route.request().postDataJSON() as {
        readonly name?: string;
        readonly heightM?: number;
        readonly floorPlanOutline?: readonly unknown[];
      };
      void route.fulfill({
        json: {
          data: {
            ...spaceFixture(),
            name: body.name ?? "Grand Hall",
            heightM: String(body.heightM ?? "7.5"),
            floorPlanOutline: body.floorPlanOutline ?? spaceFixture().floorPlanOutline,
          },
        },
      });
      return;
    }
    if (route.request().method() === "DELETE") {
      void route.fulfill({ status: 204 });
      return;
    }
    void route.fulfill({ json: { data: spaceFixture() } });
  });
  await page.route(`${API}/venues/${VENUE_ID}/pricing`, (route) => {
    if (route.request().method() === "POST") {
      const body = route.request().postDataJSON() as {
        readonly name?: string;
        readonly type?: string;
        readonly amount?: number;
        readonly spaceId?: string | null;
      };
      createdPricingRules.push(`${body.name ?? ""}|${body.type ?? ""}|${String(body.amount ?? "")}|${body.spaceId ?? "venue-wide"}`);
      void route.fulfill({
        status: 201,
        json: {
          data: {
            ...pricingRuleFixture(),
            id: "00000000-0000-4000-8000-000000004041",
            name: body.name ?? "New rule",
            type: body.type ?? "flat_rate",
            amount: String(body.amount ?? 0),
            spaceId: body.spaceId ?? null,
          },
        },
      });
      return;
    }
    void route.fulfill({ json: { data: [pricingRuleFixture()] } });
  });
  await page.route(`${API}/venues/${VENUE_ID}/pricing/${pricingRuleFixture().id}`, (route) => {
    deletedPricingRules.push(pricingRuleFixture().id);
    void route.fulfill({ status: 204 });
  });
  await page.route(`${API}/venues/${VENUE_ID}/spaces/${SPACE_ID}/loadouts`, (route) => {
    if (route.request().method() === "POST") {
      if (failLoadoutCreateOnce) {
        failLoadoutCreateOnce = false;
        void route.fulfill({ status: 500, json: { error: "button audit loadout create failure" } });
        return;
      }
      const body = route.request().postDataJSON() as { readonly name?: string; readonly description?: string };
      if (body.name !== undefined) createdLoadouts.push(body.name);
      void route.fulfill({
        json: {
          data: loadoutDetailFixture({
            name: body.name ?? "New loadout",
            description: body.description ?? null,
          }),
        },
      });
      return;
    }
    if (failLoadoutListOnce) {
      failLoadoutListOnce = false;
      void route.fulfill({ status: 500, json: { error: "button audit loadout list failure" } });
      return;
    }
    void route.fulfill({ json: { data: [loadoutFixture()] } });
  });
  await page.route(`${API}/venues/${VENUE_ID}/spaces/${SPACE_ID}/loadouts/${LOADOUT_ID}`, (route) => {
    if (route.request().method() === "PATCH") {
      const body = route.request().postDataJSON() as { readonly name?: string; readonly description?: string | null };
      if (body.name !== undefined) {
        loadoutName = body.name;
        renamedLoadouts.push(body.name);
      }
      void route.fulfill({
        json: {
          data: loadoutDetailFixture({
            name: loadoutName,
            description: body.description ?? "Room reference for a formal ceremony layout.",
            photos: loadoutPhotos,
          }),
        },
      });
      return;
    }
    if (route.request().method() === "DELETE") {
      deletedLoadouts.push(LOADOUT_ID);
      void route.fulfill({ status: 204 });
      return;
    }
    if (remainingLoadoutDetailFailures > 0) {
      remainingLoadoutDetailFailures -= 1;
      void route.fulfill({ status: 500, json: { error: "button audit loadout detail failure" } });
      return;
    }
    void route.fulfill({ json: { data: loadoutDetailFixture({ name: loadoutName, photos: loadoutPhotos }) } });
  });
  await page.route(`${API}/uploads/presigned`, (route) => {
    const body = route.request().postDataJSON() as { readonly filename?: string };
    if (body.filename !== undefined) uploadedFileNames.push(body.filename);
    void route.fulfill({
      json: {
        data: {
          uploadUrl: "https://upload.button-audit.test/loadout-photo.jpg",
          fileKey: "loadouts/uploaded/setup-photo.jpg",
          publicUrl: null,
          readUrl: null,
          fileId: UPLOADED_FILE_ID,
          visibility: "private",
        },
      },
    });
  });
  await page.route("https://upload.button-audit.test/**", (route) => {
    void route.fulfill({ status: 200, body: "" });
  });
  await page.route(`${API}/loadouts/${LOADOUT_ID}/photos`, (route) => {
    const body = route.request().postDataJSON() as { readonly fileId?: string };
    if (body.fileId !== undefined) linkedFileIds.push(body.fileId);
    const uploadedPhoto = loadoutPhotoFixture({
      id: "00000000-0000-4000-8000-000000004035",
      fileId: body.fileId ?? UPLOADED_FILE_ID,
      caption: null,
      sortOrder: loadoutPhotos.length,
      fileKey: "loadouts/uploaded/setup-photo.jpg",
      filename: "setup-photo.jpg",
    });
    loadoutPhotos = [...loadoutPhotos, uploadedPhoto];
    void route.fulfill({ json: { data: uploadedPhoto } });
  });
  await page.route(`${API}/loadouts/${LOADOUT_ID}/photos/${LOADOUT_PHOTO_ID}`, (route) => {
    if (route.request().method() === "PATCH") {
      if (failLoadoutCaptionOnce) {
        failLoadoutCaptionOnce = false;
        void route.fulfill({ status: 500, json: { error: "button audit caption failure" } });
        return;
      }
      const body = route.request().postDataJSON() as { readonly caption?: string | null };
      photoCaptions.push(body.caption ?? "");
      loadoutPhotos = loadoutPhotos.map((photo) => (
        photo.id === LOADOUT_PHOTO_ID ? { ...photo, caption: body.caption ?? null } : photo
      ));
      void route.fulfill({ json: { data: loadoutPhotos.find((photo) => photo.id === LOADOUT_PHOTO_ID) ?? loadoutPhotoFixture() } });
      return;
    }
    if (route.request().method() === "DELETE") {
      deletedPhotos.push(LOADOUT_PHOTO_ID);
      loadoutPhotos = loadoutPhotos.filter((photo) => photo.id !== LOADOUT_PHOTO_ID);
      void route.fulfill({ status: 204 });
    }
  });
  await page.route(`${API}/loadouts/${LOADOUT_ID}/photos/reorder`, (route) => {
    const body = route.request().postDataJSON() as { readonly photoIds?: readonly string[] };
    const orderedIds = body.photoIds ?? [];
    photoOrders.push(orderedIds.join(","));
    loadoutPhotos = orderedIds
      .map((id, index) => {
        const photo = loadoutPhotos.find((item) => item.id === id);
        return photo === undefined ? null : { ...photo, sortOrder: index };
      })
      .filter((photo): photo is LoadoutPhoto => photo !== null);
    void route.fulfill({ json: { data: loadoutPhotos } });
  });
  await page.route(`${API}/enquiries**`, (route) => {
    void route.fulfill({ json: { data: [] } });
  });
  await page.route(`${API}/notifications**`, (route) => {
    if (route.request().method() === "PATCH") {
      void route.fulfill({ json: { data: notificationFixture(NOW) } });
      return;
    }
    void route.fulfill({ json: { data: [notificationFixture()] } });
  });
  await page.route(`${API}/analytics/venue-dashboard**`, (route) => {
    if (remainingAnalyticsFailures > 0) {
      remainingAnalyticsFailures -= 1;
      void route.fulfill({ status: 500, json: { error: "button audit analytics failure" } });
      return;
    }
    void route.fulfill({ json: { data: revenueAnalyticsFixture() } });
  });
  await page.route(`${API}/crm/pipeline`, (route) => {
    if (remainingPipelineFailures > 0) {
      remainingPipelineFailures -= 1;
      void route.fulfill({ status: 500, json: { error: "button audit pipeline failure" } });
      return;
    }
    void route.fulfill({ json: { data: pipelineSummaryFixture() } });
  });
  await page.route(`${API}/crm/from-enquiry/**`, (route) => {
    const enquiryId = decodeURIComponent(route.request().url().split("/").pop() ?? "");
    enquiryOpportunityRequests.push(enquiryId);
    void route.fulfill({
      json: {
        data: {
          created: true,
          opportunity: opportunityFixture({ sourceEnquiryId: enquiryId }),
          clientAccount: null,
          contact: null,
          followUpTask: pipelineTaskFixture(),
        },
      },
    });
  });
  await page.route(`${API}/opportunities`, (route) => {
    const body = route.request().postDataJSON() as {
      readonly title?: string;
      readonly estimatedValueMinor?: number;
      readonly nextAction?: string;
    };
    createdPipelineOpportunities.push(`${body.title ?? ""}|${String(body.estimatedValueMinor ?? "")}`);
    void route.fulfill({
      status: 201,
      json: {
        data: {
          opportunity: opportunityFixture({
            title: body.title ?? "New opportunity",
            estimatedValueMinor: body.estimatedValueMinor ?? 0,
            nextAction: body.nextAction ?? "Qualify the enquiry and prepare the first proposal step.",
          }),
          task: null,
        },
      },
    });
  });
  await page.route(`${API}/opportunities/${OPPORTUNITY_ID}`, (route) => {
    if (route.request().method() === "PATCH") {
      const body = route.request().postDataJSON() as { readonly stage?: string; readonly note?: string | null };
      pipelineStageUpdates.push(`${body.stage ?? ""}|${body.note ?? ""}`);
      void route.fulfill({
        json: {
          data: opportunityFixture({
            stage: body.stage ?? "new",
            nextAction: body.note ?? "Confirm event basics",
          }),
        },
      });
      return;
    }
    if (failOpportunityDetailOnce) {
      failOpportunityDetailOnce = false;
      void route.fulfill({ status: 500, json: { error: "button audit opportunity detail failure" } });
      return;
    }
    void route.fulfill({ json: { data: opportunityDetailFixture() } });
  });
  await page.route(`${API}/opportunities/${OPPORTUNITY_ID}/activities`, (route) => {
    const body = route.request().postDataJSON() as { readonly body?: string };
    if (body.body !== undefined) addedOpportunityNotes.push(body.body);
    void route.fulfill({
      status: 201,
      json: { data: opportunityActivityFixture({ body: body.body ?? "Pipeline note." }) },
    });
  });
  await page.route(`${API}/opportunities/${OPPORTUNITY_ID}/tasks`, (route) => {
    const body = route.request().postDataJSON() as { readonly title?: string; readonly dueAt?: string | null };
    if (body.title !== undefined) addedPipelineTasks.push(body.title);
    void route.fulfill({
      status: 201,
      json: { data: pipelineTaskFixture({ id: "00000000-0000-4000-8000-000000004053", title: body.title ?? "Follow up" }) },
    });
  });
  await page.route(`${API}/opportunities/${OPPORTUNITY_ID}/tasks/${OPPORTUNITY_TASK_ID}`, (route) => {
    const body = route.request().postDataJSON() as { readonly status?: string };
    completedPipelineTasks.push(body.status ?? "");
    void route.fulfill({
      json: { data: pipelineTaskFixture({ status: body.status ?? "open", completedAt: body.status === "done" ? NOW : null }) },
    });
  });
  await page.route(`${API}/configurations/reviews/pending`, (route) => {
    if (remainingReviewsListFailures > 0) {
      remainingReviewsListFailures -= 1;
      void route.fulfill({ status: 500, json: { error: "button audit reviews list failure" } });
      return;
    }
    void route.fulfill({ json: { data: { entries: [pendingReviewFixture()] } } });
  });
  await page.route(`${API}/configurations/${CONFIG_ID}/review/history`, (route) => {
    if (remainingReviewHistoryFailures > 0) {
      remainingReviewHistoryFailures -= 1;
      void route.fulfill({ status: 500, json: { error: "button audit review history failure" } });
      return;
    }
    void route.fulfill({ json: { data: { configurationId: CONFIG_ID, entries: [reviewHistoryFixture()] } } });
  });
  await page.route(`${API}/configurations/${CONFIG_ID}/review/available-transitions`, (route) => {
    void route.fulfill({
      json: {
        data: {
          configurationId: CONFIG_ID,
          currentStatus: "submitted",
          availableTransitions: ["under_review", "approved", "changes_requested", "rejected"],
        },
      },
    });
  });
  await page.route(`${API}/configurations/${CONFIG_ID}/review/start-review`, (route) => {
    void route.fulfill({ json: { data: { reviewStatus: "under_review" } } });
  });
  await page.route(`${API}/configurations/${CONFIG_ID}/review/approve`, (route) => {
    if (failReviewApproveOnce) {
      failReviewApproveOnce = false;
      void route.fulfill({ status: 500, json: { error: "Approval did not save" } });
      return;
    }
    void route.fulfill({ json: { data: { reviewStatus: "approved", snapshot: snapshotEnvelopeFixture() } } });
  });
  await page.route(`${API}/configurations/${CONFIG_ID}/review/request-changes`, (route) => {
    const body = route.request().postDataJSON() as { readonly note?: string };
    if (body.note !== undefined) reviewNotes.push(body.note);
    void route.fulfill({ json: { data: { reviewStatus: "changes_requested" } } });
  });
  await page.route(`${API}/configurations/${CONFIG_ID}/review/reject`, (route) => {
    const body = route.request().postDataJSON() as { readonly note?: string };
    if (body.note !== undefined) reviewNotes.push(body.note);
    void route.fulfill({ json: { data: { reviewStatus: "rejected" } } });
  });
  await page.route(`${API}/configurations/${CONFIG_ID}/review/viewers/heartbeat`, (route) => {
    void route.fulfill({ json: { data: { ok: true } } });
  });
  await page.route(`${API}/configurations/${CONFIG_ID}/review/viewers`, (route) => {
    void route.fulfill({ json: { data: { configurationId: CONFIG_ID, viewers: [] } } });
  });
  await page.route(`${API}/configurations/${CONFIG_ID}/review/viewers/self`, (route) => {
    void route.fulfill({ status: 204 });
  });
  await page.route(`${API}/proposals`, (route) => {
    if (route.request().method() === "POST") {
      const body = route.request().postDataJSON() as {
        readonly title?: string;
        readonly opportunityId?: string | null;
      };
      if (body.opportunityId !== undefined && body.opportunityId !== null) {
        createdOpportunityProposalDrafts.push(`${body.opportunityId}|${body.title ?? ""}`);
      }
      void route.fulfill({
        json: {
          data: staffProposalFixture({
            title: body.title ?? "Untitled proposal",
            currentVersion: 0,
            opportunityId: body.opportunityId ?? null,
          }),
        },
      });
      return;
    }
    void route.fulfill({ json: { data: [staffProposalFixture()] } });
  });
  await page.route(`${API}/proposals/${PROPOSAL_ID}`, (route) => {
    void route.fulfill({ json: { data: staffProposalFixture({ currentVersion: 1 }) } });
  });
  await page.route(`${API}/proposals/${PROPOSAL_ID}/history`, (route) => {
    if (failProposalHistoryOnce) {
      failProposalHistoryOnce = false;
      void route.fulfill({ status: 500, json: { error: "button audit proposal history failure" } });
      return;
    }
    void route.fulfill({ json: { data: [proposalHistoryFixture()] } });
  });
  await page.route(`${API}/proposals/${PROPOSAL_ID}/comments`, (route) => {
    if (route.request().method() === "POST") {
      const body = route.request().postDataJSON() as { readonly body?: string };
      if (body.body !== undefined) proposalReplies.push(body.body);
      void route.fulfill({
        json: {
          data: {
            ...proposalCommentFixture("staff"),
            body: body.body ?? "We will review that route with the venue team.",
          },
        },
      });
      return;
    }
    if (failProposalCommentsOnce) {
      failProposalCommentsOnce = false;
      void route.fulfill({ status: 500, json: { error: "button audit proposal comments failure" } });
      return;
    }
    void route.fulfill({ json: { data: [proposalCommentFixture()] } });
  });
  await page.route(`${API}/proposals/${PROPOSAL_ID}/versions/latest`, (route) => {
    void route.fulfill({ json: { data: staffProposalVersionFixture() } });
  });
  await page.route(`${API}/proposals/${PROPOSAL_ID}/versions`, (route) => {
    void route.fulfill({ json: { data: staffProposalVersionFixture() } });
  });
  await page.route(`${API}/proposals/${PROPOSAL_ID}/share-token`, (route) => {
    proposalShareRequests.push(PROPOSAL_ID);
    void route.fulfill({
      json: {
        data: {
          token: SHARE_TOKEN,
          shareUrl: `/proposal-share/${SHARE_TOKEN}`,
          tokenPrefix: "button-a",
          proposal: staffProposalFixture({
            status: "sent",
            currentVersion: 1,
            shareCode: SHARE_CODE,
            sentAt: NOW,
          }),
        },
      },
    });
  });
  await page.route(`${API}/onboarding/summary`, (route) => {
    void route.fulfill({ json: { data: onboardingSummary } });
  });
  await page.route(`${API}/onboarding/managed-workspaces`, (route) => {
    const body = route.request().postDataJSON() as { readonly organisationName?: string };
    if (body.organisationName !== undefined) createdOnboarding.push(body.organisationName);
    const result = onboardingCreateResultFixture();
    onboardingSummary = onboardingSummaryFromCreate(result);
    void route.fulfill({ json: { data: result } });
  });
  await page.route(`${API}/onboarding/workspaces/${ONBOARDING_WORKSPACE_ID}/invitations`, (route) => {
    const body = route.request().postDataJSON() as InviteWorkspaceMembers;
    const memberships: WorkspaceMembership[] = body.staffInvites.map((invite, index) => {
      invitedStaffEmails.push(invite.email);
      return {
        id: syntheticInviteUuid(4_036 + index),
        workspaceId: ONBOARDING_WORKSPACE_ID,
        userId: null,
        invitationId: syntheticInviteUuid(4_046 + index),
        email: invite.email,
        role: invite.workspaceRole,
        venueRole: invite.venueRole,
        status: "invited",
        invitedBy: null,
        acceptedAt: null,
        createdAt: NOW,
        updatedAt: NOW,
      };
    });
    onboardingSummary = {
      ...onboardingSummary,
      memberships: [...onboardingSummary.memberships, ...memberships],
    };
    void route.fulfill({ status: 201, json: { data: { memberships } } });
  });
  await page.route(`${API}/onboarding/projects/${ONBOARDING_PROJECT_ID}`, (route) => {
    if (failProjectGateOnce) {
      failProjectGateOnce = false;
      void route.fulfill({ status: 500, json: { error: "button audit project gate failure" } });
      return;
    }

    const body = route.request().postDataJSON() as UpdateOnboardingProject;
    const fallbackProject = onboardingCreateResultFixture().project;
    const currentProject = onboardingSummary.projects.find((project) => project.id === ONBOARDING_PROJECT_ID) ?? fallbackProject;
    const updatedProject: OnboardingProject = {
      ...currentProject,
      status: body.status ?? currentProject.status,
      currentStep: body.currentStep ?? currentProject.currentStep,
      operatorReviewState: body.operatorReviewState ?? currentProject.operatorReviewState,
      evidenceNote: body.evidenceNote === undefined ? currentProject.evidenceNote : body.evidenceNote,
      updatedAt: NOW,
      completedAt: body.status === "ready" ? NOW : currentProject.completedAt,
    };
    savedProjectGates.push(`${updatedProject.status}|${updatedProject.operatorReviewState}|${updatedProject.currentStep}`);
    onboardingSummary = {
      ...onboardingSummary,
      projects: onboardingSummary.projects.some((project) => project.id === ONBOARDING_PROJECT_ID)
        ? onboardingSummary.projects.map((project) => project.id === ONBOARDING_PROJECT_ID ? updatedProject : project)
        : [updatedProject],
    };
    void route.fulfill({ json: { data: updatedProject } });
  });
  await page.route(`${API}/onboarding/entitlements/${ONBOARDING_ENTITLEMENT_ID}/provider-verification`, (route) => {
    const body = route.request().postDataJSON() as VerifyWorkspaceEntitlement;
    const fallbackEntitlement = onboardingCreateResultFixture().entitlement;
    const currentEntitlement = onboardingSummary.entitlements.find((entitlement) => entitlement.id === ONBOARDING_ENTITLEMENT_ID) ?? fallbackEntitlement;
    const providerVerifiedAt = body.providerVerificationStatus === "provider_verified" ? NOW : null;
    const updatedEntitlement: WorkspaceEntitlement = {
      ...currentEntitlement,
      billingProvider: body.billingProvider,
      providerCustomerRef: body.providerCustomerRef ?? null,
      providerEntitlementRef: body.providerEntitlementRef ?? null,
      providerEvidenceRef: body.providerEvidenceRef ?? null,
      providerVerificationStatus: body.providerVerificationStatus,
      providerVerifiedAt,
      accessEnforced: body.accessEnforced,
      status: body.providerVerificationStatus === "provider_verified" ? "active" : "pending_provider_verification",
      updatedAt: NOW,
    };
    savedProviderGates.push(`${updatedEntitlement.billingProvider}|${updatedEntitlement.providerVerificationStatus}|${String(updatedEntitlement.accessEnforced)}`);
    onboardingSummary = {
      ...onboardingSummary,
      entitlements: onboardingSummary.entitlements.some((entitlement) => entitlement.id === ONBOARDING_ENTITLEMENT_ID)
        ? onboardingSummary.entitlements.map((entitlement) => entitlement.id === ONBOARDING_ENTITLEMENT_ID ? updatedEntitlement : entitlement)
        : [updatedEntitlement],
    };
    void route.fulfill({ json: { data: updatedEntitlement } });
  });

  return {
    reviewNotes,
    createdLoadouts,
    createdOnboarding,
    proposalReplies,
    proposalShareRequests,
    renamedLoadouts,
    deletedLoadouts,
    uploadedFileNames,
    linkedFileIds,
    photoCaptions,
    photoOrders,
    deletedPhotos,
    invitedStaffEmails,
    savedProjectGates,
    savedProviderGates,
    savedVenueSettings,
    createdAdminVenues,
    createdAdminSpaces,
    createdPricingRules,
    deletedPricingRules,
    createdPipelineOpportunities,
    enquiryOpportunityRequests,
    pipelineStageUpdates,
    completedPipelineTasks,
    addedPipelineTasks,
    addedOpportunityNotes,
    createdOpportunityProposalDrafts,
  };
}

async function mockEventDayRoutes(page: Page): Promise<{
  readonly taskStatuses: OpsTask["status"][];
  readonly acknowledgements: string[];
  readonly issueTitles: string[];
}> {
  const taskStatuses: OpsTask["status"][] = [];
  const acknowledgements: string[] = [];
  const issueTitles: string[] = [];
  await page.route(`${API}/events/${EVENT_ID}/ops-board`, (route) => {
    void route.fulfill({ json: { data: eventDayBoardFixture() } });
  });
  await page.route(`${API}/events/${EVENT_ID}/change-feed**`, (route) => {
    void route.fulfill({ json: { data: [changeFeedFixture()] } });
  });
  await page.route(`${API}/events/${EVENT_ID}/change-acknowledgements`, (route) => {
    const body = route.request().postDataJSON() as { readonly changeId?: string };
    if (body.changeId !== undefined) acknowledgements.push(body.changeId);
    void route.fulfill({
      json: {
        data: {
          id: "00000000-0000-4000-8000-000000004017",
          changeId: CHANGE_ID,
          eventId: EVENT_ID,
          acknowledgedBy: "00000000-0000-4000-8000-000000004093",
          acknowledgedByRole: "hallkeeper",
          note: null,
          createdAt: NOW,
        },
      },
    });
  });
  await page.route(`${API}/ops-tasks/${TASK_ID}/status`, (route) => {
    const body = route.request().postDataJSON() as { readonly status?: OpsTask["status"] };
    if (body.status !== undefined) taskStatuses.push(body.status);
    void route.fulfill({ json: { data: taskFixture(body.status ?? "todo") } });
  });
  await page.route(`${API}/events/${EVENT_ID}/issues`, (route) => {
    const body = route.request().postDataJSON() as { readonly title?: string };
    if (body.title !== undefined) issueTitles.push(body.title);
    void route.fulfill({ json: { data: eventDayIssueFixture() } });
  });
  return { taskStatuses, acknowledgements, issueTitles };
}

async function mockHallkeeperRoutes(page: Page): Promise<{
  readonly progressUpdates: string[];
  readonly pdfDownloads: string[];
}> {
  const progressUpdates: string[] = [];
  const pdfDownloads: string[] = [];
  await page.route(`${API}/configurations/${CONFIG_ID}/review/available-transitions`, (route) => {
    void route.fulfill({
      json: {
        data: {
          configurationId: CONFIG_ID,
          currentStatus: "approved",
          availableTransitions: [],
        },
      },
    });
  });
  await page.route(`${API}/configurations/${CONFIG_ID}/snapshot/latest`, (route) => {
    void route.fulfill({
      json: {
        data: snapshotEnvelopeFixture(),
      },
    });
  });
  await page.route(`${API}/hallkeeper/${CONFIG_ID}/v2`, (route) => {
    void route.fulfill({
      json: {
        data: {
          venue: {
            name: "Trades Hall Glasgow",
            address: "85 Glassford Street, Glasgow G1 1UH",
            logoUrl: null,
            timezone: "Europe/London",
          },
          space: { name: "Grand Hall", widthM: 21, lengthM: 10, heightM: 7 },
          config: { id: CONFIG_ID, name: "Button audit gala", layoutStyle: "dinner-banquet", guestCount: 120 },
          timing: null,
          instructions: null,
          phases: [
            {
              phase: "structure",
              zones: [
                {
                  zone: "North wall",
                  rows: [
                    {
                      key: "structure|North wall|Stage Platform|0",
                      name: "Stage Platform",
                      category: "stage",
                      qty: 1,
                      afterDepth: 0,
                      isAccessory: false,
                      notes: "Place before tables",
                      positions: [{ x: 3, y: 2 }],
                    },
                  ],
                },
              ],
            },
            {
              phase: "furniture",
              zones: [
                {
                  zone: "Centre",
                  rows: [
                    {
                      key: "furniture|Centre|6ft Round Table with 10 chairs|0",
                      name: "6ft Round Table with 10 chairs",
                      category: "table",
                      qty: 10,
                      afterDepth: 0,
                      isAccessory: false,
                      notes: "",
                      positions: [{ x: 9, y: 4 }],
                    },
                  ],
                },
              ],
            },
          ],
          totals: {
            entries: [
              { name: "6ft Round Table with 10 chairs", category: "table", qty: 10 },
              { name: "Stage Platform", category: "stage", qty: 1 },
            ],
            totalRows: 2,
            totalItems: 11,
          },
          diagramUrl: null,
          webViewUrl: `http://localhost:5173/hallkeeper/${CONFIG_ID}`,
          generatedAt: NOW,
          approval: {
            version: 2,
            approvedAt: NOW,
            approverName: "Venue Operations",
          },
        },
      },
    });
  });
  await page.route(`${API}/hallkeeper/${CONFIG_ID}/progress`, (route) => {
    if (route.request().method() === "GET") {
      void route.fulfill({ json: { data: { configId: CONFIG_ID, checked: {} } } });
      return;
    }
    const body = route.request().postDataJSON() as { readonly rowKey?: string; readonly checked?: boolean };
    if (body.rowKey !== undefined) progressUpdates.push(body.rowKey);
    void route.fulfill({
      json: {
        data: {
          configId: CONFIG_ID,
          rowKey: body.rowKey ?? "unknown",
          checked: body.checked ?? false,
        },
      },
    });
  });
  await page.route(`${API}/hallkeeper/${CONFIG_ID}/sheet?download=true`, (route) => {
    pdfDownloads.push(route.request().url());
    void route.fulfill({
      headers: { "content-type": "application/pdf" },
      body: "%PDF-1.4\n% button audit\n",
    });
  });
  return { progressUpdates, pdfDownloads };
}

async function setupRouteMocks(page: Page, routeName: string): Promise<void> {
  if (routeName === "planner cockpit") {
    await mockPlannerRoutes(page);
    return;
  }
  if (routeName === "internal visual") {
    await page.route(`${API}/assets/runtime-packages/latest**`, (route) => {
      void route.fulfill({ json: { data: null } });
    });
    await page.route(`${API}/ai/status`, (route) => {
      void route.fulfill({ status: 401, json: { error: "authentication required" } });
    });
    await page.route(`${API}/truth-mode/summary**`, (route) => {
      void route.fulfill({ status: 401, json: { error: "authentication required" } });
    });
    return;
  }
  if (routeName === "public room") {
    await mockPublicRoomRoutes(page);
    return;
  }
  if (routeName === "proposal") {
    await mockProposalRoutes(page);
    return;
  }
  if (routeName === "proposal share") {
    await mockProposalRoutes(page);
    return;
  }
  if (routeName === "dashboard") {
    await seedAuthenticatedUser(page, "staff");
    await mockDashboardRoutes(page);
    return;
  }
  if (routeName === "event day ops") {
    await seedAuthenticatedUser(page, "hallkeeper");
    await mockEventDayRoutes(page);
    return;
  }
  if (routeName === "hallkeeper") {
    await seedAuthenticatedUser(page, "planner");
    await mockHallkeeperRoutes(page);
  }
}

async function visibleControls(page: Page): Promise<readonly VisibleControlSnapshot[]> {
  return page.evaluate((): VisibleControlSnapshot[] => {
    const selector = [
      "button",
      "a[href]",
      "[role='button']",
      "[role='tab']",
      "[role='menuitem']",
      "[role='menuitemcheckbox']",
      "[role='checkbox']",
      "input:not([type='hidden'])",
      "select",
      "textarea",
      "summary",
    ].join(",");

    function textFromLabelledBy(element: Element): string {
      const labelledBy = element.getAttribute("aria-labelledby");
      if (labelledBy === null) return "";
      return labelledBy
        .split(/\s+/u)
        .map((id) => document.getElementById(id)?.textContent?.trim() ?? "")
        .filter((text) => text.length > 0)
        .join(" ");
    }

    function textFromAssociatedLabel(element: Element): string {
      if (!(element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement || element instanceof HTMLSelectElement)) {
        return "";
      }
      if (element.labels !== null && element.labels.length > 0) {
        return Array.from(element.labels)
          .map((label) => label.textContent?.trim() ?? "")
          .filter((text) => text.length > 0)
          .join(" ");
      }
      return "";
    }

    function controlLabel(element: Element): string {
      return [
        element.getAttribute("aria-label"),
        textFromLabelledBy(element),
        textFromAssociatedLabel(element),
        element.getAttribute("title"),
        element.getAttribute("placeholder"),
        element instanceof HTMLInputElement ? element.value : null,
        element.textContent,
      ]
        .map((value) => value?.replace(/\s+/gu, " ").trim() ?? "")
        .find((value) => value.length > 0) ?? "";
    }

    function isVisibleControl(element: Element): boolean {
      if (!(element instanceof HTMLElement)) return false;
      const rect = element.getBoundingClientRect();
      const style = window.getComputedStyle(element);
      return rect.width > 0 &&
        rect.height > 0 &&
        style.display !== "none" &&
        style.visibility !== "hidden" &&
        Number(style.opacity) !== 0;
    }

    return Array.from(document.querySelectorAll(selector))
      .filter(isVisibleControl)
      .map((element) => {
        const rect = element.getBoundingClientRect();
        const disabled = element instanceof HTMLButtonElement ||
          element instanceof HTMLInputElement ||
          element instanceof HTMLSelectElement ||
          element instanceof HTMLTextAreaElement
          ? element.disabled
          : element.getAttribute("aria-disabled") === "true";
        return {
          tagName: element.tagName.toLowerCase(),
          role: element.getAttribute("role"),
          label: controlLabel(element),
          rawHref: element instanceof HTMLAnchorElement ? element.getAttribute("href") : null,
          disabled,
          width: Math.round(rect.width),
          height: Math.round(rect.height),
        };
      });
  });
}

function describeControl(control: VisibleControlSnapshot): string {
  const role = control.role === null ? control.tagName : `${control.tagName}[role=${control.role}]`;
  const label = control.label.length === 0 ? "<unnamed>" : control.label;
  return `${role} "${label}" ${String(control.width)}x${String(control.height)}`;
}

async function expectVisibleControlsAreWired(page: Page, routeName: string): Promise<void> {
  const controls = await visibleControls(page);
  await test.info().attach(`${routeName}-visible-controls.json`, {
    body: JSON.stringify(controls, null, 2),
    contentType: "application/json",
  });

  const unnamed = controls.filter((control) => control.label.length === 0);
  const badHref = controls.filter((control) => {
    if (control.rawHref === null) return false;
    const href = control.rawHref.trim().toLowerCase();
    return href === "#" || href.startsWith("javascript:");
  });
  const unusablySmall = controls.filter((control) => {
    if (control.tagName === "input" || control.tagName === "textarea" || control.tagName === "select") return false;
    return control.width < 18 || control.height < 18;
  });

  expect(controls.length, `${routeName} should expose visible controls`).toBeGreaterThan(0);
  expect(unnamed.map(describeControl), `${routeName} unnamed controls`).toEqual([]);
  expect(badHref.map(describeControl), `${routeName} placeholder links`).toEqual([]);
  expect(unusablySmall.map(describeControl), `${routeName} unusably small controls`).toEqual([]);
}

test.describe("SS++ button and action inventory", () => {
  const routes: readonly {
    readonly name: string;
    readonly path: string;
    readonly waitFor: (page: Page) => Promise<void>;
  }[] = [
    {
      name: "landing (spotlight)",
      path: "/",
      waitFor: async (page) => {
        await expect(page.getByRole("heading", { level: 1, name: /See your evening/i })).toBeVisible();
      },
    },
    {
      name: "the rite (previous landing)",
      path: "/landing",
      waitFor: async (page) => {
        await expect(page.getByRole("heading", { level: 1, name: /There is a hall in Glasgow/i })).toBeVisible();
      },
    },
    {
      name: "pricing",
      path: "/pricing",
      waitFor: async (page) => {
        await expect(page.getByRole("heading", { level: 1, name: /Turn every enquiry/i })).toBeVisible();
      },
    },
    {
      name: "planner cockpit",
      path: `/plan/${CONFIG_ID}`,
      waitFor: async (page) => {
        await page.waitForSelector("[data-testid='cockpit-shell']", { timeout: 20_000 });
      },
    },
    {
      name: "internal visual",
      path: "/dev/trades-hall-visual?venue=trades-hall&room=reception-room",
      waitFor: async (page) => {
        await expect(page.getByRole("heading", { name: "Truth Mode", exact: true })).toBeVisible({ timeout: 20_000 });
      },
    },
    {
      name: "public room",
      path: "/venues/trades-hall/rooms/reception-room",
      waitFor: async (page) => {
        await expect(page.getByRole("heading", { level: 1, name: "Reception Room" })).toBeVisible();
      },
    },
    {
      name: "proposal",
      path: `/proposal/${SHARE_CODE}`,
      waitFor: async (page) => {
        await expect(page.getByRole("heading", { level: 1, name: "Reception Room wedding proposal" })).toBeVisible();
      },
    },
    {
      name: "proposal share",
      path: `/proposal-share/${SHARE_TOKEN}`,
      waitFor: async (page) => {
        await expect(page.getByRole("heading", { level: 1, name: "Reception Room wedding proposal" })).toBeVisible();
      },
    },
    {
      name: "dashboard",
      path: "/dashboard",
      waitFor: async (page) => {
        await page.waitForSelector("#dashboard-main", { timeout: 15_000 });
      },
    },
    {
      name: "event day ops",
      path: `/ops/events/${EVENT_ID}`,
      waitFor: async (page) => {
        await expect(page.getByRole("heading", { level: 1, name: "Wilson wedding" })).toBeVisible();
      },
    },
    {
      name: "hallkeeper",
      path: `/hallkeeper/${CONFIG_ID}`,
      waitFor: async (page) => {
        await expect(page.getByRole("heading", { level: 1, name: "Button audit gala" })).toBeVisible();
      },
    },
  ];

  for (const route of routes) {
    test(`${route.name} has no unnamed, placeholder, or unusable visible controls`, async ({ page }) => {
      test.setTimeout(45_000);
      const problems = watchPageProblems(page);
      await setupRouteMocks(page, route.name);
      await page.goto(route.path);
      await route.waitFor(page);
      await expectVisibleControlsAreWired(page, route.name);
      expect(problems.pageErrors, `${route.name} page errors`).toEqual([]);
      expect(problems.consoleErrors, `${route.name} console errors`).toEqual([]);
    });
  }
});

test.describe("SS++ representative button behavior", () => {
  test("planner cockpit controls update visible state", async ({ page }) => {
    await mockPlannerRoutes(page);
    await page.goto(`/plan/${CONFIG_ID}`);
    await page.waitForSelector("[data-testid='cockpit-shell']", { timeout: 20_000 });

    const visualLayer = page.getByRole("group", { name: "Visual layer" });
    await visualLayer.getByRole("button", { name: "Splat" }).click();
    await expect(visualLayer.getByRole("button", { name: "Splat" })).toHaveAttribute("aria-pressed", "true");

    await page.locator("[data-testid='cockpit-rail']").getByRole("button", { name: "Flow" }).click();
    await expect(page.locator(".cockpit-stage")).toHaveAttribute("data-cockpit-mode", "flow");

    await page.getByRole("button", { name: "Layers" }).click();
    const guestFlowToggle = page.getByRole("menuitemcheckbox", { name: "Guest flow" });
    await expect(guestFlowToggle).toHaveAttribute("aria-checked", "true");
    await guestFlowToggle.click();
    await expect(guestFlowToggle).toHaveAttribute("aria-checked", "false");
  });

  test("internal visual controls switch layer, phase, and command mode", async ({ page }) => {
    await page.route(`${API}/assets/runtime-packages/latest**`, (route) => {
      void route.fulfill({ json: { data: null } });
    });
    await page.goto("/dev/trades-hall-visual?venue=trades-hall&room=reception-room");
    await expect(page.getByRole("heading", { name: "Truth Mode", exact: true })).toBeVisible({ timeout: 20_000 });

    await page.getByRole("button", { name: /Splat/i }).click();
    await expect(page.getByRole("button", { name: /Splat/i })).toHaveAttribute("aria-pressed", "true");

    await page.getByRole("button", { name: /Bar queue/i }).click();
    await expect(page.getByText(/Reception Room \/ Bar queue/i)).toBeVisible();

    await page.getByRole("button", { name: /Ops Compiler/i }).click();
    await expect(page.getByRole("button", { name: "Ops", exact: true })).toHaveAttribute("aria-pressed", "true");
  });

  test("public room buttons select event context and preserve safe runtime copy", async ({ page }) => {
    await mockPublicRoomRoutes(page);
    await page.goto("/venues/trades-hall/rooms/reception-room");
    await expect(page.getByRole("heading", { level: 1, name: "Reception Room" })).toBeVisible();
    await expect(page.getByLabel("Reception Room visual preview").getByText(/Runtime room visual is not currently available/i)).toBeVisible();

    const eventType = page.locator(".room-showcase-event-types button").first();
    await eventType.click();
    await expect(eventType).toHaveClass(/selected/u);
  });

  test("proposal controls approve, reveal change request, and post token comments", async ({ page }) => {
    await mockProposalRoutes(page);
    await page.goto(`/proposal/${SHARE_CODE}`);
    await page.getByRole("button", { name: "Request changes" }).click();
    const sendRequest = page.getByRole("button", { name: "Send request" });
    await expect(sendRequest).toBeDisabled();
    await page.getByLabel(/what you'd like changed/i).fill("Can we move speeches earlier?");
    await expect(sendRequest).toBeEnabled();

    await page.getByRole("button", { name: "Approve proposal" }).click();
    await expect(page.getByText("Proposal accepted")).toBeVisible();

    await page.goto(`/proposal-share/${SHARE_TOKEN}`);
    await page.getByTestId("comment-input").fill("Could we move the arrival time thirty minutes later?");
    await page.getByTestId("comment-submit").click();
    await expect(page.getByTestId("comment-input")).toHaveValue("");
  });

  test("dashboard navigation and notification controls are live", async ({ page }) => {
    await seedAuthenticatedUser(page, "staff");
    await mockDashboardRoutes(page);
    await page.goto("/dashboard");
    await page.waitForSelector("#dashboard-main", { timeout: 15_000 });

    await page.getByRole("button", { name: /unread notification/i }).click();
    await expect(page.getByRole("heading", { name: "Change feed" })).toBeVisible();
    await page.getByRole("button", { name: "Refresh notifications" }).click();
    await page.getByRole("button", { name: /Mark Guest count updated read/i }).click();
    await expect(page.getByText("No unread changes for this workspace.")).toBeVisible();

    await page.getByRole("button", { name: "Executive Analytics" }).click();
    await expect(page.getByRole("heading", { name: "Commercial planning dashboard" })).toBeVisible();
    await expect(page.getByText("Pipeline value")).toBeVisible();
  });

  test("event-day controls acknowledge changes, update tasks, and log issues", async ({ page }) => {
    await seedAuthenticatedUser(page, "hallkeeper");
    const mock = await mockEventDayRoutes(page);
    await page.goto(`/ops/events/${EVENT_ID}`);
    await expect(page.getByRole("heading", { level: 1, name: "Wilson wedding" })).toBeVisible();

    await page.getByRole("button", { name: /Acknowledge change/i }).click();
    await expect.poll(() => mock.acknowledgements).toContain(CHANGE_ID);
    await expect(page.getByText("Change acknowledged.")).toBeVisible();

    await page.getByRole("button", { name: "Done" }).click();
    await expect.poll(() => mock.taskStatuses).toContain("done");
    await expect(page.getByText("Task status updated.")).toBeVisible();

    await page.getByLabel("Title").fill("Blocked access door");
    await page.getByLabel("Detail").fill("North service door needs venue team attention.");
    await page.getByRole("button", { name: "Log issue" }).click();
    await expect.poll(() => mock.issueTitles).toContain("Blocked access door");
    await expect(page.getByText("Issue logged.")).toBeVisible();
  });

  test("hallkeeper controls update progress, locate rows, download, and print", async ({ page }) => {
    await seedAuthenticatedUser(page, "planner");
    const mock = await mockHallkeeperRoutes(page);
    let printCalled = false;
    await page.addInitScript(() => {
      Object.defineProperty(window, "print", { value: () => undefined, writable: true });
    });
    await page.goto(`/hallkeeper/${CONFIG_ID}`);
    await page.evaluate(() => {
      window.print = () => {
        window.dispatchEvent(new Event("button-audit-print"));
      };
    });
    await page.exposeFunction("buttonAuditPrintCalled", () => {
      printCalled = true;
    });
    await page.evaluate(() => {
      window.addEventListener("button-audit-print", () => {
        void window.buttonAuditPrintCalled?.();
      });
    });

    await expect(page.getByRole("heading", { level: 1, name: "Button audit gala" })).toBeVisible();
    const row = page.getByRole("checkbox", { name: /Stage Platform/i });
    await row.click();
    await expect(row).toHaveAttribute("aria-checked", "true");
    await expect.poll(() => mock.progressUpdates.length).toBeGreaterThan(0);

    await page.getByRole("button", { name: "Locate on floor plan" }).first().click();
    await expect(page.getByRole("button", { name: "Clear highlight" })).toBeVisible();
    await page.getByRole("button", { name: "Clear highlight" }).click();
    await expect(page.getByRole("button", { name: "Clear highlight" })).toHaveCount(0);

    await page.getByRole("button", { name: "Download PDF" }).click();
    await expect.poll(() => mock.pdfDownloads.length).toBe(1);
    await expect(page.getByRole("status").filter({ hasText: "PDF download started." })).toBeVisible();
    await page.getByRole("button", { name: "Print" }).click();
    await expect.poll(() => printCalled).toBe(true);
  });
});

test.describe("SS++ deep modal, drawer, role, disabled, and error states", () => {
  test("expired proposals expose terminal copy and remove response buttons", async ({ page }) => {
    await page.route(`${API}/public/proposals/${SHARE_CODE}`, (route) => {
      void route.fulfill({ json: { data: publicProposalFixture("expired") } });
    });

    await page.goto(`/proposal/${SHARE_CODE}`);
    await expect(page.getByRole("heading", { level: 1, name: "Reception Room wedding proposal" })).toBeVisible();
    await expect(page.getByText("Proposal expired")).toBeVisible();
    await expect(page.getByRole("button", { name: "Approve proposal" })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Request changes" })).toHaveCount(0);
  });

  test("proposal response and comment failures keep clients informed", async ({ page }) => {
    await page.route(`${API}/public/proposals/${SHARE_CODE}`, (route) => {
      void route.fulfill({ json: { data: publicProposalFixture() } });
    });
    await page.route(`${API}/public/proposals/${SHARE_CODE}/respond`, (route) => {
      void route.fulfill({ status: 500, json: { error: "button audit failure" } });
    });

    await page.goto(`/proposal/${SHARE_CODE}`);
    await page.getByRole("button", { name: "Request changes" }).click();
    const sendRequest = page.getByRole("button", { name: "Send request" });
    await expect(sendRequest).toBeDisabled();
    await page.getByLabel(/what you'd like changed/i).fill("Please move speeches before dinner.");
    await expect(sendRequest).toBeEnabled();
    await sendRequest.click();
    await expect(page.getByRole("alert")).toContainText("Something went wrong sending your response");

    await page.route(`${API}/proposal-share/${SHARE_TOKEN}`, (route) => {
      void route.fulfill({ json: { data: publicProposalFixture() } });
    });
    await page.route(`${API}/proposal-share/${SHARE_TOKEN}/comment`, (route) => {
      void route.fulfill({ status: 500, json: { error: "button audit failure" } });
    });

    await page.goto(`/proposal-share/${SHARE_TOKEN}`);
    const sendComment = page.getByTestId("comment-submit");
    await expect(sendComment).toBeDisabled();
    await page.getByTestId("comment-input").fill("Please keep a clear route for a wheelchair user.");
    await expect(sendComment).toBeEnabled();
    await sendComment.click();
    await expect(page.getByRole("alert")).toContainText("We couldn't post your comment");
  });

  test("dashboard role restrictions hide staff/admin-only surfaces from hallkeepers", async ({ page }) => {
    await seedAuthenticatedUser(page, "hallkeeper");
    await mockDashboardRoutes(page);

    await page.goto("/dashboard");
    await page.waitForSelector("#dashboard-main", { timeout: 15_000 });
    await expect(page.getByRole("button", { name: "Pipeline" })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Proposals" })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Onboarding" })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Admin" })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Pending Reviews" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Executive Analytics" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Venue Settings" })).toBeVisible();
  });

  test("dashboard direct admin-view URLs fail closed for hallkeepers", async ({ page }) => {
    await seedAuthenticatedUser(page, "hallkeeper");
    await mockDashboardRoutes(page);

    await page.goto("/dashboard?view=onboarding");
    await page.waitForSelector("#dashboard-main", { timeout: 15_000 });
    await expect(page.getByRole("heading", { name: /not available for this role/u })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Workspace onboarding" })).toHaveCount(0);
    await page.getByRole("button", { name: "Open enquiries" }).click();
    await expect(page).toHaveURL(/\/dashboard\?view=enquiries$/u);
  });

  test("executive users get only the analytics cockpit and direct commercial surfaces fail closed", async ({ page }) => {
    await seedAuthenticatedUser(page, "executive");
    await mockDashboardRoutes(page);

    await page.goto("/dashboard");
    await page.waitForSelector("#dashboard-main", { timeout: 15_000 });
    await expect(page.getByRole("heading", { name: "Commercial planning dashboard" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Executive Analytics" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Pipeline" })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Proposals" })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Onboarding" })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Admin" })).toHaveCount(0);

    await page.goto("/dashboard?view=pipeline");
    await page.waitForSelector("#dashboard-main", { timeout: 15_000 });
    await expect(page.getByRole("heading", { name: /not available for this role/u })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Commercial pipeline" })).toHaveCount(0);
  });

  test("supplier users are denied internal dashboard routes before any staff data loads", async ({ page }) => {
    await seedAuthenticatedUser(page, "supplier");
    await mockDashboardRoutes(page);

    await page.goto("/dashboard");
    await expect(page.getByRole("heading", { level: 1, name: "This workspace is not available to your role" })).toBeVisible();
    await expect(page.locator("#dashboard-main")).toHaveCount(0);
  });

  test("executive analytics failure exposes a branded retry path", async ({ page }) => {
    await seedAuthenticatedUser(page, "executive");
    await mockDashboardRoutes(page, { failAnalyticsOnce: true });

    await page.goto("/dashboard?view=analytics");
    await page.waitForSelector("#dashboard-main", { timeout: 15_000 });
    await expect(page.getByRole("heading", { name: "Analytics unavailable" })).toBeVisible();
    await expect(page.getByRole("alert")).toContainText("button audit analytics failure");
    await page.getByRole("button", { name: "Retry analytics" }).click();
    await expect(page.getByRole("heading", { name: "Commercial planning dashboard" })).toBeVisible();
  });

  test("dashboard admin role exposes commercial and deployment controls", async ({ page }) => {
    await seedAuthenticatedUser(page, "platform-admin");
    await mockDashboardRoutes(page);

    await page.goto("/dashboard");
    await page.waitForSelector("#dashboard-main", { timeout: 15_000 });
    await expect(page.getByRole("button", { name: "Pipeline" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Proposals" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Onboarding" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Admin" })).toBeVisible();
  });

  test("admin registry view wires venue, space, and pricing actions", async ({ page }) => {
    await seedAuthenticatedUser(page, "platform-admin");
    const mock = await mockDashboardRoutes(page);

    await page.goto("/dashboard?view=admin");
    await page.waitForSelector("#dashboard-main", { timeout: 15_000 });
    await expect(page.getByRole("heading", { name: "Venue Registry" })).toBeVisible();

    await page.getByRole("button", { name: /Trades Hall Glasgow/u }).click();
    await expect(page.getByRole("heading", { level: 2, name: "Trades Hall Glasgow" })).toBeVisible();

    await page.getByRole("button", { name: "New Space" }).click();
    await page.getByLabel("Space Name").fill("Reception Room");
    await page.getByLabel("Height (m)").fill("4.2");
    await expect(page.getByRole("button", { name: "Create Space" })).toBeDisabled();
    await page.getByRole("button", { name: "Reset to rectangle" }).click();
    await page.getByRole("button", { name: "Create Space" }).click();
    await expect.poll(() => mock.createdAdminSpaces)
      .toContain("Reception Room|reception-room|4.2|4");

    await page.getByRole("button", { name: "New Rule" }).click();
    await page.getByLabel("Rule Name").fill("Reception Room Evening");
    await page.getByLabel("Amount (GBP)").fill("500");
    await page.getByRole("button", { name: "Create Rule" }).click();
    await expect.poll(() => mock.createdPricingRules)
      .toContain("Reception Room Evening|flat_rate|500|venue-wide");

    await page.getByRole("button", { name: "Delete pricing rule Grand Hall Half Day" }).click();
    await expect.poll(() => mock.deletedPricingRules)
      .toContain("00000000-0000-4000-8000-000000004038");

    await page.getByRole("button", { name: "Back to venues" }).click();
    await page.getByRole("button", { name: "New Venue" }).click();
    await page.getByLabel("Venue Name").fill("New Venue");
    await page.getByLabel("Address").fill("1 Test Street");
    await expect(page.getByText("Slug: new-venue")).toBeVisible();
    await page.getByRole("button", { name: "Create Venue" }).click();
    await expect.poll(() => mock.createdAdminVenues)
      .toContain("New Venue|new-venue|1 Test Street");
  });

  test("venue settings direct route validates, resets, and saves through the venue API", async ({ page }) => {
    await seedAuthenticatedUser(page, "admin");
    const mock = await mockDashboardRoutes(page);

    await page.goto("/dashboard?view=settings");
    await page.waitForSelector("#dashboard-main", { timeout: 15_000 });
    await expect(page.getByRole("heading", { name: "Venue Settings" })).toBeVisible();
    await expect(page.getByText("Venue record in sync")).toBeVisible();

    const save = page.getByRole("button", { name: "Save Changes" });
    await expect(save).toBeDisabled();
    await page.getByLabel("Brand Colour").fill("gold");
    await expect(page.getByText(/six-digit hex colour/u)).toBeVisible();
    await expect(save).toBeDisabled();

    await page.getByRole("button", { name: "Reset" }).click();
    await expect(page.getByText(/six-digit hex colour/u)).toHaveCount(0);
    await page.getByLabel("Venue Name").fill("Trades Hall Operations");
    await page.getByLabel("Address").fill("85 Glassford Street, Glasgow");
    await page.getByLabel("Brand Colour").fill("#68d8d2");
    await page.getByLabel("Logo URL").fill("https://assets.example/trades-hall.svg");
    await expect(save).toBeEnabled();
    await save.click();

    await expect.poll(() => mock.savedVenueSettings)
      .toContain("Trades Hall Operations|85 Glassford Street, Glasgow|#68d8d2|https://assets.example/trades-hall.svg");
    await expect(page.getByText("Venue record in sync")).toBeVisible();
  });

  test("notification drawer view action navigates to the live event-day board", async ({ page }) => {
    await seedAuthenticatedUser(page, "staff");
    await mockDashboardRoutes(page);
    await mockEventDayRoutes(page);

    await page.goto("/dashboard");
    await page.waitForSelector("#dashboard-main", { timeout: 15_000 });
    await page.getByRole("button", { name: /unread notification/i }).click();
    await page.getByRole("button", { name: "View Guest count updated" }).click();
    await expect(page).toHaveURL(new RegExp(`/ops/events/${EVENT_ID}$`, "u"));
    await expect(page.getByRole("heading", { level: 1, name: "Wilson wedding" })).toBeVisible();
  });

  test("event-day board surfaces retry and missing-handoff states", async ({ page }) => {
    await seedAuthenticatedUser(page, "hallkeeper");
    let allowOpsBoardSuccess = false;
    await page.route(`${API}/events/${EVENT_ID}/ops-board`, (route) => {
      if (!allowOpsBoardSuccess) {
        void route.fulfill({ status: 500, json: { error: "button audit failure" } });
        return;
      }
      void route.fulfill({ json: { data: missingHandoffEventDayBoardFixture() } });
    });
    await page.route(`${API}/events/${EVENT_ID}/change-feed**`, (route) => {
      void route.fulfill({ json: { data: [] } });
    });

    await page.goto(`/ops/events/${EVENT_ID}`);
    await expect(page.getByRole("heading", { level: 1, name: "Event-day board unavailable" })).toBeVisible();
    allowOpsBoardSuccess = true;
    await page.getByRole("button", { name: "Retry" }).click();
    await expect(page.getByRole("heading", { level: 1, name: "Wilson wedding" })).toBeVisible();
    await expect(page.getByRole("heading", { level: 2, name: "No handoff pack linked" })).toBeVisible();
    await expect(page.getByText("No unacknowledged planner or client changes are open for this event.")).toBeVisible();
  });

  test("hallkeeper sheet retry and PDF download failure paths are visible", async ({ page }) => {
    await seedAuthenticatedUser(page, "planner");
    const mock = await mockHallkeeperRoutes(page);
    await page.unroute(`${API}/hallkeeper/${CONFIG_ID}/v2`);
    let allowSheetSuccess = false;
    await page.route(`${API}/hallkeeper/${CONFIG_ID}/v2`, (route) => {
      if (!allowSheetSuccess) {
        void route.fulfill({ status: 500, json: { error: "button audit failure" } });
        return;
      }
      void route.fulfill({
        json: {
          data: {
            venue: {
              name: "Trades Hall Glasgow",
              address: "85 Glassford Street, Glasgow G1 1UH",
              logoUrl: null,
              timezone: "Europe/London",
            },
            space: { name: "Grand Hall", widthM: 21, lengthM: 10, heightM: 7 },
            config: { id: CONFIG_ID, name: "Button audit gala", layoutStyle: "dinner-banquet", guestCount: 120 },
            timing: null,
            instructions: null,
            phases: [
              {
                phase: "structure",
                zones: [
                  {
                    zone: "North wall",
                    rows: [
                      {
                        key: "structure|North wall|Stage Platform|0",
                        name: "Stage Platform",
                        category: "stage",
                        qty: 1,
                        afterDepth: 0,
                        isAccessory: false,
                        notes: "Place before tables",
                        positions: [{ x: 3, y: 2 }],
                      },
                    ],
                  },
                ],
              },
            ],
            totals: {
              entries: [{ name: "Stage Platform", category: "stage", qty: 1 }],
              totalRows: 1,
              totalItems: 1,
            },
            diagramUrl: null,
            webViewUrl: `http://localhost:5173/hallkeeper/${CONFIG_ID}`,
            generatedAt: NOW,
            approval: {
              version: 2,
              approvedAt: NOW,
              approverName: "Venue Operations",
            },
          },
        },
      });
    });
    await page.unroute(`${API}/hallkeeper/${CONFIG_ID}/sheet?download=true`);
    await page.route(`${API}/hallkeeper/${CONFIG_ID}/sheet?download=true`, (route) => {
      mock.pdfDownloads.push(route.request().url());
      void route.fulfill({ status: 500, json: { error: "button audit failure" } });
    });

    await page.goto(`/hallkeeper/${CONFIG_ID}`);
    await expect(page.getByRole("alert")).toContainText("Failed to load");
    allowSheetSuccess = true;
    await page.getByRole("button", { name: "Try again" }).click();
    await expect(page.getByRole("heading", { level: 1, name: "Button audit gala" })).toBeVisible();

    await page.getByRole("button", { name: "Download PDF" }).click();
    await expect.poll(() => mock.pdfDownloads.length).toBe(1);
    await expect(page.getByRole("alert")).toContainText("PDF could not be downloaded");
    await expect(page.getByRole("button", { name: "Download PDF" })).toBeEnabled();
  });

  test("hallkeeper mobile denied sheet path stays readable and recovers on retry", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await seedAuthenticatedUser(page, "planner");
    await mockHallkeeperRoutes(page);
    await page.unroute(`${API}/hallkeeper/${CONFIG_ID}/v2`);
    let allowSheetSuccess = false;
    await page.route(`${API}/hallkeeper/${CONFIG_ID}/v2`, (route) => {
      if (!allowSheetSuccess) {
        void route.fulfill({ status: 403, json: { error: "button audit hallkeeper denied" } });
        return;
      }
      void route.fulfill({
        json: {
          data: {
            venue: {
              name: "Trades Hall Glasgow",
              address: "85 Glassford Street, Glasgow G1 1UH",
              logoUrl: null,
              timezone: "Europe/London",
            },
            space: { name: "Grand Hall", widthM: 21, lengthM: 10, heightM: 7 },
            config: { id: CONFIG_ID, name: "Button audit gala", layoutStyle: "dinner-banquet", guestCount: 120 },
            timing: null,
            instructions: "Mobile recovery check",
            phases: [
              {
                phase: "structure",
                zones: [
                  {
                    zone: "North wall",
                    rows: [
                      {
                        key: "structure|North wall|Stage Platform|0",
                        name: "Stage Platform",
                        category: "stage",
                        qty: 1,
                        afterDepth: 0,
                        isAccessory: false,
                        notes: "Place before tables",
                        positions: [{ x: 3, y: 2 }],
                      },
                    ],
                  },
                ],
              },
            ],
            totals: {
              entries: [{ name: "Stage Platform", category: "stage", qty: 1 }],
              totalRows: 1,
              totalItems: 1,
            },
            diagramUrl: null,
            webViewUrl: `http://localhost:5173/hallkeeper/${CONFIG_ID}`,
            generatedAt: NOW,
            approval: null,
          },
        },
      });
    });

    await page.goto(`/hallkeeper/${CONFIG_ID}`);
    await expect(page.getByRole("alert")).toContainText("You don't have permission to view this events sheet.");
    await expect(page.getByRole("button", { name: "Try again" })).toBeVisible();
    await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true);
    allowSheetSuccess = true;
    await page.getByRole("button", { name: "Try again" }).click();
    await expect(page.getByRole("heading", { level: 1, name: "Button audit gala" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Download PDF" })).toBeVisible();
  });

  test("review change-request modal requires a note and posts the review action", async ({ page }) => {
    await seedAuthenticatedUser(page, "staff");
    const mock = await mockDashboardRoutes(page);

    await page.goto("/dashboard");
    await page.waitForSelector("#dashboard-main", { timeout: 15_000 });
    await page.getByRole("button", { name: "Pending Reviews" }).click();
    await expect(page.getByRole("heading", { name: /Pending Reviews/u })).toBeVisible();

    await page.getByRole("button", { name: "Open review for Reception Room dinner review" }).click();
    await expect(page.getByRole("heading", { name: "Reception Room dinner review" })).toBeVisible();
    await page.getByRole("button", { name: "Request Changes" }).click();

    const dialog = page.getByRole("dialog", { name: "Request changes on this layout?" });
    await expect(dialog).toBeVisible();
    const send = dialog.getByRole("button", { name: "Send change request" });
    await expect(send).toBeDisabled();
    await dialog.getByLabel("Review note").fill("Keep the 1.2m route clearance open beside the main doors.");
    await expect(send).toBeEnabled();
    await send.click();

    await expect.poll(() => mock.reviewNotes).toContain("Keep the 1.2m route clearance open beside the main doors.");
    await expect(dialog).toHaveCount(0);
  });

  test("review list, context, and approve failures remain visible and retryable", async ({ page }) => {
    await seedAuthenticatedUser(page, "staff");
    await mockDashboardRoutes(page, {
      failReviewsListOnce: true,
      failReviewHistoryOnce: true,
      failReviewApproveOnce: true,
    });

    await page.goto("/dashboard?view=reviews");
    await page.waitForSelector("#dashboard-main", { timeout: 15_000 });
    await expect(page.getByTestId("reviews-load-error")).toContainText("Could not load pending reviews");
    await page.getByRole("button", { name: "Retry reviews" }).click();
    await page.getByRole("button", { name: "Open review for Reception Room dinner review" }).click();

    await expect(page.getByTestId("review-context-error")).toContainText("button audit review history failure");
    await expect(page.getByRole("button", { name: "Approve" })).toHaveCount(0);
    await page.getByRole("button", { name: "Retry review context" }).click();
    await expect(page.getByRole("button", { name: "Approve" })).toBeVisible();

    await page.getByRole("button", { name: "Approve" }).click();
    await expect(page.getByTestId("review-action-error")).toContainText("Approval did not save");
    await expect(page.getByRole("button", { name: "Approve" })).toBeEnabled();
    await page.getByRole("button", { name: "Approve" }).click();
    await expect(page.getByTestId("review-action-error")).toHaveCount(0);
  });

  test("reference-loadout modal is keyboard-readable and creates a real loadout", async ({ page }) => {
    await seedAuthenticatedUser(page, "staff");
    const mock = await mockDashboardRoutes(page);

    await page.goto("/dashboard");
    await page.waitForSelector("#dashboard-main", { timeout: 15_000 });
    await page.getByRole("button", { name: "Reference Loadouts" }).click();
    await expect(page.getByRole("heading", { name: "Reference Loadouts" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Open reference loadout Ceremony reference setup" })).toBeVisible();

    await page.getByRole("button", { name: "New Loadout" }).click();
    const dialog = page.getByRole("dialog", { name: "New Reference Loadout" });
    await expect(dialog).toBeVisible();
    const create = dialog.getByRole("button", { name: "Create" });
    await expect(create).toBeDisabled();
    await dialog.getByLabel("Name *").fill("Dinner reset reference");
    await dialog.getByLabel("Description").fill("Gold chairs, round tables, and main-door route kept clear.");
    await expect(create).toBeEnabled();
    await create.click();

    await expect.poll(() => mock.createdLoadouts).toContain("Dinner reset reference");
    await expect(dialog).toHaveCount(0);
  });

  test("reference-loadout list and create failures keep recovery controls live", async ({ page }) => {
    await seedAuthenticatedUser(page, "staff");
    const mock = await mockDashboardRoutes(page, { failLoadoutListOnce: true, failLoadoutCreateOnce: true });

    await page.goto("/dashboard?view=loadouts");
    await page.waitForSelector("#dashboard-main", { timeout: 15_000 });
    await expect(page.getByTestId("loadouts-list-error")).toContainText("button audit loadout list failure");
    await page.getByRole("button", { name: "Retry loadouts" }).click();
    await expect(page.getByRole("button", { name: "Open reference loadout Ceremony reference setup" })).toBeVisible();

    await page.getByRole("button", { name: "New Loadout" }).click();
    const dialog = page.getByRole("dialog", { name: "New Reference Loadout" });
    await dialog.getByLabel("Name *").fill("Dinner retry reference");
    const create = dialog.getByRole("button", { name: "Create" });
    await create.click();
    await expect(page.getByTestId("loadout-create-error")).toContainText("button audit loadout create failure");
    await expect(dialog).toBeVisible();
    await expect(create).toBeEnabled();
    await create.click();
    await expect.poll(() => mock.createdLoadouts).toContain("Dinner retry reference");
    await expect(dialog).toHaveCount(0);
  });

  test("reference-loadout detail and caption failures expose drawer-level recovery", async ({ page }) => {
    await seedAuthenticatedUser(page, "staff");
    await mockDashboardRoutes(page, { failLoadoutDetailOnce: true, failLoadoutCaptionOnce: true });

    await page.goto("/dashboard?view=loadouts");
    await page.waitForSelector("#dashboard-main", { timeout: 15_000 });
    await page.getByRole("button", { name: "Open reference loadout Ceremony reference setup" }).click();
    await expect(page.getByTestId("loadout-detail-error")).toContainText("button audit loadout detail failure");
    await page.getByRole("button", { name: "Retry" }).click();
    await expect(page.getByRole("heading", { name: "Ceremony reference setup" })).toBeVisible();

    await page.getByRole("button", { name: "Room entrance" }).click();
    await page.getByLabel("Caption for setup-entrance.jpg").fill("Main doors still clear");
    await page.getByRole("button", { name: "Save" }).click();
    await expect(page.getByTestId("loadout-action-error")).toContainText("button audit caption failure");
    await expect(page.getByRole("button", { name: "Save" })).toBeEnabled();
  });

  test("reference-loadout detail edits, uploads, captions, reorders, and deletes through real controls", async ({ page }) => {
    await seedAuthenticatedUser(page, "staff");
    const mock = await mockDashboardRoutes(page);

    await page.goto("/dashboard");
    await page.waitForSelector("#dashboard-main", { timeout: 15_000 });
    await page.getByRole("button", { name: "Reference Loadouts" }).click();
    await page.getByRole("button", { name: "Open reference loadout Ceremony reference setup" }).click();
    await expect(page.getByRole("heading", { name: "Ceremony reference setup" })).toBeVisible();

    await page.getByRole("button", { name: "Edit name" }).click();
    await page.getByLabel("Loadout name").fill("Dinner reset master");
    await page.getByRole("button", { name: "Save" }).click();
    await expect.poll(() => mock.renamedLoadouts).toContain("Dinner reset master");
    await expect(page.getByRole("heading", { name: "Dinner reset master" })).toBeVisible();

    await page.locator("input[type='file']").setInputFiles({
      name: "setup-photo.jpg",
      mimeType: "image/jpeg",
      buffer: Buffer.from("button-audit-photo"),
    });
    await expect.poll(() => mock.uploadedFileNames).toContain("setup-photo.jpg");
    await expect.poll(() => mock.linkedFileIds).toContain(UPLOADED_FILE_ID);
    await expect(page.getByText("setup-photo.jpg")).toBeVisible();

    await page.getByRole("button", { name: "Room entrance" }).click();
    await page.getByLabel("Caption for setup-entrance.jpg").fill("Main doors remain clear");
    await page.getByRole("button", { name: "Save" }).click();
    await expect.poll(() => mock.photoCaptions).toContain("Main doors remain clear");

    await page.getByRole("button", { name: "Move setup-entrance.jpg down" }).click();
    await expect.poll(() => mock.photoOrders).toContain(`${LOADOUT_SECOND_PHOTO_ID},${LOADOUT_PHOTO_ID},00000000-0000-4000-8000-000000004035`);

    await page.getByRole("button", { name: "Remove setup-entrance.jpg" }).click();
    const removeDialog = page.getByRole("dialog", { name: "Remove Photo" });
    await expect(removeDialog).toBeVisible();
    await removeDialog.getByRole("button", { name: "Remove" }).click();
    await expect.poll(() => mock.deletedPhotos).toContain(LOADOUT_PHOTO_ID);

    await page.getByRole("button", { name: "Delete Loadout" }).click();
    const deleteDialog = page.getByRole("dialog", { name: "Delete Loadout" });
    await expect(deleteDialog).toBeVisible();
    await deleteDialog.getByRole("button", { name: "Delete" }).click();
    await expect.poll(() => mock.deletedLoadouts).toContain(LOADOUT_ID);
    await expect(page.getByRole("heading", { name: "Reference Loadouts" })).toBeVisible();
  });

  test("proposal conversation and client-link controls call the staff proposal APIs", async ({ page }) => {
    await seedAuthenticatedUser(page, "staff");
    const mock = await mockDashboardRoutes(page);

    await page.goto("/dashboard");
    await page.waitForSelector("#dashboard-main", { timeout: 15_000 });
    await page.getByRole("button", { name: "Proposals" }).click();
    await page.getByTestId(`proposal-row-${PROPOSAL_ID}`).click();
    await expect(page.getByRole("heading", { name: "Reception Room wedding proposal" })).toBeVisible();

    const reply = page.getByTestId("reply-submit");
    await expect(reply).toBeDisabled();
    await page.getByTestId("reply-input").fill("We will re-check the main-door route with operations before sending the next version.");
    await expect(reply).toBeEnabled();
    await reply.click();
    await expect.poll(() => mock.proposalReplies).toContain("We will re-check the main-door route with operations before sending the next version.");

    await page.getByTestId("send-button").click();
    await expect.poll(() => mock.proposalShareRequests).toContain(PROPOSAL_ID);
    await expect(page.getByTestId("share-link")).toHaveText(new RegExp(`/proposal-share/${SHARE_TOKEN}$`, "u"));
  });

  test("proposal drawer history and conversation failures are retryable", async ({ page }) => {
    await seedAuthenticatedUser(page, "staff");
    await mockDashboardRoutes(page, { failProposalHistoryOnce: true, failProposalCommentsOnce: true });

    await page.goto("/dashboard?view=proposals");
    await page.waitForSelector("#dashboard-main", { timeout: 15_000 });
    await page.getByTestId(`proposal-row-${PROPOSAL_ID}`).click();
    await expect(page.getByRole("heading", { name: "Reception Room wedding proposal" })).toBeVisible();

    await expect(page.getByTestId("conversation-load-error")).toContainText("Couldn't load the client conversation");
    await page.getByRole("button", { name: "Retry conversation" }).click();
    await expect(page.getByText("Could we keep a clearer route near the main doors?")).toBeVisible();

    await expect(page.getByTestId("history-load-error")).toContainText("Couldn't load this proposal's status history");
    await page.getByRole("button", { name: "Retry history" }).click();
    await expect(page.getByText("Initial planning-grade proposal draft created.")).toBeVisible();
  });

  test("commercial pipeline forms and detail actions call the CRM APIs", async ({ page }) => {
    await seedAuthenticatedUser(page, "staff");
    const mock = await mockDashboardRoutes(page);

    await page.goto("/dashboard?view=pipeline");
    await page.waitForSelector("#dashboard-main", { timeout: 15_000 });
    await expect(page.getByRole("heading", { name: "Commercial pipeline" })).toBeVisible();

    await page.getByTestId("manual-opportunity-title").fill("Winter dinner");
    await page.getByTestId("manual-opportunity-value").fill("-10");
    await page.getByRole("button", { name: "Add" }).click();
    await expect(page.getByTestId("manual-opportunity-error")).toContainText("non-negative pounds amount");
    await expect.poll(() => mock.createdPipelineOpportunities.length).toBe(0);

    await page.getByTestId("manual-opportunity-value").fill("120.50");
    await page.getByRole("button", { name: "Add" }).click();
    await expect.poll(() => mock.createdPipelineOpportunities).toContain("Winter dinner|12050");

    await page.getByTestId("pipeline-enquiry-id").fill("enquiry-button-audit");
    await page.getByTestId("pipeline-enquiry-create").click();
    await expect.poll(() => mock.enquiryOpportunityRequests).toContain("enquiry-button-audit");

    await page.getByTestId(`opportunity-${OPPORTUNITY_ID}`).click();
    await expect(page.getByLabel("Opportunity detail")).toBeVisible();
    await page.getByTestId("opportunity-stage").selectOption("proposal_drafting");
    await expect.poll(() => mock.pipelineStageUpdates).toContain("proposal_drafting|Moved to Proposal drafting");

    await page.getByRole("button", { name: "Done" }).click();
    await expect.poll(() => mock.completedPipelineTasks).toContain("done");

    await page.getByLabel("New task title").fill("Confirm AV arrival");
    await page.getByTestId("opportunity-task-add").click();
    await expect.poll(() => mock.addedPipelineTasks).toContain("Confirm AV arrival");

    await page.getByLabel("Activity note").fill("Client prefers later speeches.");
    await page.getByRole("button", { name: "Add note" }).click();
    await expect.poll(() => mock.addedOpportunityNotes).toContain("Client prefers later speeches.");

    await page.getByRole("button", { name: "Create proposal draft" }).click();
    await expect.poll(() => mock.createdOpportunityProposalDrafts)
      .toContain(`${OPPORTUNITY_ID}|Reception Room wedding enquiry proposal`);
  });

  test("commercial pipeline load and detail failures expose recovery paths", async ({ page }) => {
    await seedAuthenticatedUser(page, "staff");
    await mockDashboardRoutes(page, { failPipelineOnce: true, failOpportunityDetailOnce: true });

    await page.goto("/dashboard?view=pipeline");
    await page.waitForSelector("#dashboard-main", { timeout: 15_000 });
    await expect(page.getByRole("alert")).toContainText("Could not load the commercial pipeline");
    await page.getByRole("button", { name: "Retry pipeline" }).click();
    await expect(page.getByTestId(`opportunity-${OPPORTUNITY_ID}`)).toBeVisible();

    await page.getByTestId(`opportunity-${OPPORTUNITY_ID}`).click();
    await expect(page.getByTestId("opportunity-detail-error")).toContainText("Could not load that opportunity");
    await page.getByTestId(`opportunity-${OPPORTUNITY_ID}`).click();
    await expect(page.getByLabel("Opportunity detail")).toBeVisible();
  });

  test("admin onboarding form enforces required fields and posts the rollout package", async ({ page }) => {
    await seedAuthenticatedUser(page, "platform-admin");
    const mock = await mockDashboardRoutes(page);

    await page.goto("/dashboard");
    await page.waitForSelector("#dashboard-main", { timeout: 15_000 });
    await page.getByRole("button", { name: "Onboarding" }).click();
    await expect(page.getByRole("heading", { name: "Workspace onboarding" })).toBeVisible();

    const create = page.getByTestId("create-onboarding-workspace");
    await expect(create).toBeDisabled();
    await page.getByTestId("organisation-name").fill("Trades Hall Trust");
    await page.getByTestId("venue-name").fill("Trades Hall Glasgow");
    await expect(page.getByTestId("venue-slug")).toHaveValue("trades-hall-glasgow");
    await page.getByTestId("venue-address").fill("85 Glassford Street, Glasgow G1 1UH");
    await page.getByTestId("owner-email").fill("owner@tradeshall.co.uk");
    await page.getByTestId("staff-emails").fill("events@tradeshall.co.uk\nops@tradeshall.co.uk");
    await expect(create).toBeEnabled();
    await create.click();

    await expect.poll(() => mock.createdOnboarding).toContain("Trades Hall Trust");
    await expect(page.getByText("Workspace onboarding created")).toBeVisible();
  });

  test("admin deployment controls invite staff and save reviewed rollout gates", async ({ page }) => {
    await seedAuthenticatedUser(page, "platform-admin");
    const mock = await mockDashboardRoutes(page, { onboardingPopulated: true });

    await page.goto("/dashboard");
    await page.waitForSelector("#dashboard-main", { timeout: 15_000 });
    await page.getByRole("button", { name: "Onboarding" }).click();
    await expect(page.getByRole("heading", { name: "Operator action board" })).toBeVisible();

    await page.getByLabel("Invite staff for Trades Hall deployment").fill("planner@tradeshall.co.uk\nops@tradeshall.co.uk\nplanner@tradeshall.co.uk");
    await page.getByRole("button", { name: "Send 2 invite(s)" }).click();
    await expect.poll(() => mock.invitedStaffEmails).toContain("planner@tradeshall.co.uk");
    await expect.poll(() => mock.invitedStaffEmails).toContain("ops@tradeshall.co.uk");
    await expect(page.getByText("2 staff invitation(s) recorded")).toBeVisible();

    await page.getByLabel("Project status for Trades Hall deployment").selectOption("ready");
    await page.getByLabel("Operator review for Trades Hall deployment").selectOption("approved");
    await page.getByLabel("Current step for Trades Hall deployment").fill("Ready for staff handoff.");
    await page.getByLabel("Evidence note for Trades Hall deployment").fill("Owner accepted and staff invite list reviewed.");
    await page.getByRole("button", { name: "Save project gate for Trades Hall deployment" }).click();
    await expect.poll(() => mock.savedProjectGates).toContain("ready|approved|Ready for staff handoff.");
    await expect(page.getByText("Deployment review gate updated")).toBeVisible();

    await page.getByLabel("Billing provider for Trades Hall deployment").selectOption("manual_invoice");
    await page.getByLabel("Provider status for Trades Hall deployment").selectOption("provider_verified");
    await page.getByLabel("Provider evidence reference for Trades Hall deployment").fill("invoice-2026-001");
    await page.getByLabel("Enforce managed access for Trades Hall deployment").check();
    await page.getByRole("button", { name: "Save provider gate for Trades Hall deployment" }).click();
    await expect.poll(() => mock.savedProviderGates).toContain("manual_invoice|provider_verified|true");
    await expect(page.getByText("Provider verification gate updated")).toBeVisible();
  });

  test("admin deployment project-gate failures keep the save control retryable", async ({ page }) => {
    await seedAuthenticatedUser(page, "platform-admin");
    const mock = await mockDashboardRoutes(page, { onboardingPopulated: true, failProjectGateOnce: true });

    await page.goto("/dashboard");
    await page.waitForSelector("#dashboard-main", { timeout: 15_000 });
    await page.getByRole("button", { name: "Onboarding" }).click();
    await expect(page.getByRole("heading", { name: "Operator action board" })).toBeVisible();

    const saveProjectGate = page.getByRole("button", { name: "Save project gate for Trades Hall deployment" });
    await saveProjectGate.click();
    await expect(page.getByRole("alert")).toContainText("button audit project gate failure");
    await expect(saveProjectGate).toBeEnabled();

    await saveProjectGate.click();
    await expect.poll(() => mock.savedProjectGates).toContain("admin_invite|pending_review|Workspace owner invitation is pending acceptance.");
    await expect(page.getByText("Deployment review gate updated")).toBeVisible();
  });
});
