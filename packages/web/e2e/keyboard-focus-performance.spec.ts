import { expect, test, type Locator, type Page } from "@playwright/test";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
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
  VerifyWorkspaceEntitlement,
  WorkspaceEntitlement,
  WorkspaceMembership,
} from "@omnitwin/types";
import type { PendingReviewEntry, ReviewHistoryEntry } from "../src/api/configuration-reviews.js";
import type { Loadout, LoadoutDetail, LoadoutPhoto } from "../src/api/loadouts.js";
import type { PricingRule } from "../src/api/pricing.js";
import type {
  ProposalCommentRow,
  ProposalHistoryEntry,
  StaffProposal,
  StaffProposalVersion,
} from "../src/api/proposals.js";
import type { Space, Venue, VenueDetail } from "../src/api/spaces.js";
import {
  collectAccessibilityAudit,
  expectAccessibilityAuditClean,
  type AccessibilityAuditResult,
  type AccessibilityViewport,
} from "./support/accessibility-audit.js";

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
const ONBOARDING_PROJECT_ID = "00000000-0000-4000-8000-000000004028";
const ONBOARDING_ENTITLEMENT_ID = "00000000-0000-4000-8000-000000004029";
const LOADOUT_PHOTO_ID = "00000000-0000-4000-8000-000000004030";
const LOADOUT_SECOND_PHOTO_ID = "00000000-0000-4000-8000-000000004031";
const HASH = "b".repeat(64);

const SAMPLE_MS = Number.parseInt(process.env.FRAME_BUDGET_SAMPLE_MS ?? "900", 10);
const TARGET_FRAME_MS = 16.7;
const PASS_P95_MS = Number.parseFloat(process.env.FRAME_BUDGET_PASS_P95_MS ?? "18.5");
const MAX_SUSTAINED_OVER_BUDGET = Number.parseInt(process.env.FRAME_BUDGET_MAX_SUSTAINED ?? "1", 10);
const ARTIFACT_DIR = "C:/Users/blake/omnitwin2/artifacts/t469-keyboard-focus-frame-accessibility-2026-06-19";
const REPORT_PATH = `${ARTIFACT_DIR}/report.json`;

type SeedRole = "staff" | "planner" | "hallkeeper" | "admin" | "platform-admin" | "executive" | "supplier";
type FocusViewportName = "desktop" | "mobile";

interface PageProblems {
  readonly pageErrors: readonly string[];
  readonly consoleErrors: readonly string[];
}

interface FrameSummary {
  readonly count: number;
  readonly averageMs: number;
  readonly p95Ms: number;
  readonly maxMs: number;
  readonly overTargetCount: number;
  readonly sustainedOverTarget: number;
  readonly overPassBudgetCount: number;
  readonly sustainedOverPassBudget: number;
}

interface CdpDelta {
  readonly scriptDurationMs: number;
  readonly layoutDurationMs: number;
  readonly recalcStyleDurationMs: number;
  readonly taskDurationMs: number;
  readonly jsHeapUsedBytes: number;
}

interface FocusPassResult {
  readonly name: string;
  readonly viewport: FocusViewportName;
  readonly idle: FrameSummary;
  readonly interaction: FrameSummary;
  readonly cdp: CdpDelta;
  readonly passed: boolean;
}

interface CdpMetricsPayload {
  readonly metrics: readonly {
    readonly name: string;
    readonly value: number;
  }[];
}

interface MockState {
  readonly reviewNotes: string[];
  readonly createdLoadouts: string[];
  readonly proposalReplies: string[];
  readonly createdAdminVenues: string[];
  readonly deletedAdminVenues: string[];
  readonly createdAdminSpaces: string[];
  readonly editedAdminSpaces: string[];
  readonly deletedAdminSpaces: string[];
  readonly createdPricingRules: string[];
  readonly deletedPricingRules: string[];
  readonly invitedStaffEmails: string[];
  readonly savedProjectGates: string[];
  readonly savedProviderGates: string[];
  readonly acknowledgements: string[];
  readonly taskStatuses: OpsTask["status"][];
  readonly issueTitles: string[];
}

const results: FocusPassResult[] = [];
const accessibilityResults: AccessibilityAuditResult[] = [];

function accessibilityViewport(name: FocusViewportName): AccessibilityViewport {
  if (name === "mobile") {
    return { name: "mobile", width: 390, height: 844 };
  }
  return { name: "desktop", width: 1440, height: 900 };
}

function watchPageProblems(page: Page): PageProblems {
  const pageErrors: string[] = [];
  const consoleErrors: string[] = [];

  page.on("pageerror", (error) => {
    pageErrors.push(error.message);
  });
  page.on("console", (message) => {
    const text = message.text();
    if (
      message.type() === "error" &&
      !text.startsWith("Failed to load resource:") &&
      !text.includes("t469")
    ) {
      consoleErrors.push(text);
    }
  });

  return { pageErrors, consoleErrors };
}

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
        email: `${seedRole}@t469-focus.test`,
        role: venueRole,
        platformRole: isPlatformAdmin ? "admin" : "none",
        venueId: isPlatformAdmin ? null : venueId,
        name: `${seedRole[0]?.toUpperCase() ?? "U"}${seedRole.slice(1)} Focus Budget`,
      },
      writable: false,
    });
  }, { seedRole: role, venueId: VENUE_ID });
}

function venueFixture(): Venue {
  return {
    id: VENUE_ID,
    name: "Trades Hall Glasgow",
    slug: "trades-hall",
    address: "85 Glassford Street",
    logoUrl: null,
    brandColour: null,
  };
}

function spaceFixture(): Space {
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

function venueDetailFixture(): VenueDetail {
  return {
    ...venueFixture(),
    spaces: [spaceFixture()],
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

function pendingReviewFixture(): PendingReviewEntry {
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
  };
}

function reviewHistoryFixture(): ReviewHistoryEntry {
  return {
    id: "00000000-0000-4000-8000-000000004024",
    configurationId: CONFIG_ID,
    fromStatus: "draft",
    toStatus: "submitted",
    changedByName: "Planner Focus Budget",
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

function loadoutFixture(): Loadout {
  return {
    id: LOADOUT_ID,
    name: "Ceremony reference setup",
    description: "Room reference for a formal ceremony layout.",
    createdAt: NOW,
    photoCount: 2,
    coverFileKey: null,
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

function loadoutDetailFixture(overrides: Partial<LoadoutDetail> = {}): LoadoutDetail {
  return {
    id: LOADOUT_ID,
    spaceId: SPACE_ID,
    venueId: VENUE_ID,
    name: "Ceremony reference setup",
    description: "Room reference for a formal ceremony layout.",
    createdAt: NOW,
    updatedAt: NOW,
    photos: [
      loadoutPhotoFixture(),
      loadoutPhotoFixture({
        id: LOADOUT_SECOND_PHOTO_ID,
        fileId: "00000000-0000-4000-8000-000000004033",
        caption: null,
        sortOrder: 1,
        fileKey: "loadouts/ceremony-platform.jpg",
        filename: "ceremony-platform.jpg",
      }),
    ],
    ...overrides,
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

function onboardingSummaryFixture(): OnboardingSummary {
  const result = onboardingCreateResultFixture();
  return {
    organisations: [result.organisation],
    workspaces: [result.workspace],
    venues: [result.venue],
    memberships: [result.ownerMembership],
    projects: [result.project],
    entitlements: [result.entitlement],
    auditEvents: [],
  };
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
    sourceId: "focus-budget-comment",
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

async function mockApiRoutes(page: Page): Promise<MockState> {
  const state: MockState = {
    reviewNotes: [],
    createdLoadouts: [],
    proposalReplies: [],
    createdAdminVenues: [],
    deletedAdminVenues: [],
    createdAdminSpaces: [],
    editedAdminSpaces: [],
    deletedAdminSpaces: [],
    createdPricingRules: [],
    deletedPricingRules: [],
    invitedStaffEmails: [],
    savedProjectGates: [],
    savedProviderGates: [],
    acknowledgements: [],
    taskStatuses: [],
    issueTitles: [],
  };

  let onboardingSummary = onboardingSummaryFixture();
  let taskStatus: OpsTask["status"] = "todo";

  await page.route(`${API}/**`, (route) => {
    const request = route.request();
    const method = request.method();
    const path = new URL(request.url()).pathname;

    if (path === "/venues" && method === "GET") {
      void route.fulfill({ json: { data: [venueFixture()] } });
      return;
    }
    if (path === "/venues" && method === "POST") {
      const body = request.postDataJSON() as {
        readonly name?: string;
        readonly slug?: string;
        readonly address?: string;
      };
      state.createdAdminVenues.push(`${body.name ?? ""}|${body.slug ?? ""}|${body.address ?? ""}`);
      void route.fulfill({ status: 201, json: { data: { ...venueFixture(), id: "00000000-0000-4000-8000-000000004039" } } });
      return;
    }
    if (path === `/venues/${VENUE_ID}`) {
      if (method === "DELETE") {
        state.deletedAdminVenues.push(VENUE_ID);
        void route.fulfill({ status: 204 });
        return;
      }
      void route.fulfill({ json: { data: venueDetailFixture() } });
      return;
    }
    if (path === `/venues/${VENUE_ID}/spaces` && method === "GET") {
      void route.fulfill({ json: { data: [dashboardSpaceFixture()] } });
      return;
    }
    if (path === `/venues/${VENUE_ID}/spaces` && method === "POST") {
      const body = request.postDataJSON() as {
        readonly name?: string;
        readonly slug?: string;
        readonly heightM?: number;
        readonly floorPlanOutline?: readonly unknown[];
      };
      state.createdAdminSpaces.push(`${body.name ?? ""}|${body.slug ?? ""}|${String(body.heightM ?? "")}|${String(body.floorPlanOutline?.length ?? 0)}`);
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
    if (path === `/venues/${VENUE_ID}/spaces/${SPACE_ID}`) {
      if (method === "PATCH") {
        const body = request.postDataJSON() as {
          readonly name?: string;
          readonly heightM?: number;
          readonly floorPlanOutline?: readonly unknown[];
        };
        state.editedAdminSpaces.push(`${body.name ?? ""}|${String(body.heightM ?? "")}|${String(body.floorPlanOutline?.length ?? 0)}`);
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
      if (method === "DELETE") {
        state.deletedAdminSpaces.push(SPACE_ID);
        void route.fulfill({ status: 204 });
        return;
      }
      void route.fulfill({ json: { data: spaceFixture() } });
      return;
    }
    if (path === `/venues/${VENUE_ID}/pricing` && method === "GET") {
      void route.fulfill({ json: { data: [pricingRuleFixture()] } });
      return;
    }
    if (path === `/venues/${VENUE_ID}/pricing` && method === "POST") {
      const body = request.postDataJSON() as {
        readonly name?: string;
        readonly type?: string;
        readonly amount?: number;
        readonly spaceId?: string | null;
      };
      state.createdPricingRules.push(`${body.name ?? ""}|${body.type ?? ""}|${String(body.amount ?? "")}|${body.spaceId ?? "venue-wide"}`);
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
    if (path === `/venues/${VENUE_ID}/pricing/${pricingRuleFixture().id}`) {
      state.deletedPricingRules.push(pricingRuleFixture().id);
      void route.fulfill({ status: 204 });
      return;
    }
    if (path === "/enquiries") {
      void route.fulfill({ json: { data: [] } });
      return;
    }
    if (path === "/notifications") {
      void route.fulfill({ json: { data: [notificationFixture()] } });
      return;
    }

    if (path === "/configurations/reviews/pending") {
      void route.fulfill({ json: { data: { entries: [pendingReviewFixture()] } } });
      return;
    }
    if (path === `/configurations/${CONFIG_ID}/review/history`) {
      void route.fulfill({ json: { data: { configurationId: CONFIG_ID, entries: [reviewHistoryFixture()] } } });
      return;
    }
    if (path === `/configurations/${CONFIG_ID}/review/available-transitions`) {
      void route.fulfill({
        json: {
          data: {
            configurationId: CONFIG_ID,
            currentStatus: "submitted",
            availableTransitions: ["under_review", "approved", "changes_requested", "rejected"],
          },
        },
      });
      return;
    }
    if (path === `/configurations/${CONFIG_ID}/review/request-changes`) {
      const body = request.postDataJSON() as { readonly note?: string };
      if (body.note !== undefined) state.reviewNotes.push(body.note);
      void route.fulfill({ json: { data: { reviewStatus: "changes_requested" } } });
      return;
    }
    if (path === `/configurations/${CONFIG_ID}/review/reject`) {
      const body = request.postDataJSON() as { readonly note?: string };
      if (body.note !== undefined) state.reviewNotes.push(body.note);
      void route.fulfill({ json: { data: { reviewStatus: "rejected" } } });
      return;
    }
    if (path === `/configurations/${CONFIG_ID}/review/viewers/heartbeat`) {
      void route.fulfill({ json: { data: { ok: true } } });
      return;
    }
    if (path === `/configurations/${CONFIG_ID}/review/viewers`) {
      void route.fulfill({ json: { data: { configurationId: CONFIG_ID, viewers: [] } } });
      return;
    }
    if (path === `/configurations/${CONFIG_ID}/review/viewers/self`) {
      void route.fulfill({ status: 204 });
      return;
    }

    if (path === `/venues/${VENUE_ID}/spaces/${SPACE_ID}/loadouts` && method === "GET") {
      void route.fulfill({ json: { data: [loadoutFixture()] } });
      return;
    }
    if (path === `/venues/${VENUE_ID}/spaces/${SPACE_ID}/loadouts` && method === "POST") {
      const body = request.postDataJSON() as { readonly name?: string; readonly description?: string };
      if (body.name !== undefined) state.createdLoadouts.push(body.name);
      void route.fulfill({
        status: 201,
        json: {
          data: loadoutDetailFixture({
            name: body.name ?? "New loadout",
            description: body.description ?? null,
          }),
        },
      });
      return;
    }
    if (path === `/venues/${VENUE_ID}/spaces/${SPACE_ID}/loadouts/${LOADOUT_ID}`) {
      if (method === "DELETE") {
        void route.fulfill({ status: 204 });
        return;
      }
      void route.fulfill({ json: { data: loadoutDetailFixture() } });
      return;
    }

    if (path === "/proposals" && method === "GET") {
      void route.fulfill({ json: { data: [staffProposalFixture()] } });
      return;
    }
    if (path === `/proposals/${PROPOSAL_ID}`) {
      void route.fulfill({ json: { data: staffProposalFixture({ currentVersion: 1 }) } });
      return;
    }
    if (path === `/proposals/${PROPOSAL_ID}/history`) {
      void route.fulfill({ json: { data: [proposalHistoryFixture()] } });
      return;
    }
    if (path === `/proposals/${PROPOSAL_ID}/comments` && method === "GET") {
      void route.fulfill({ json: { data: [proposalCommentFixture()] } });
      return;
    }
    if (path === `/proposals/${PROPOSAL_ID}/comments` && method === "POST") {
      const body = request.postDataJSON() as { readonly body?: string };
      if (body.body !== undefined) state.proposalReplies.push(body.body);
      void route.fulfill({ json: { data: proposalCommentFixture("staff") } });
      return;
    }
    if (path === `/proposals/${PROPOSAL_ID}/versions/latest`) {
      void route.fulfill({ json: { data: staffProposalVersionFixture() } });
      return;
    }

    if (path === "/onboarding/summary") {
      void route.fulfill({ json: { data: onboardingSummary } });
      return;
    }
    if (path === `/onboarding/workspaces/${ONBOARDING_WORKSPACE_ID}/invitations`) {
      const body = request.postDataJSON() as InviteWorkspaceMembers;
      const memberships: WorkspaceMembership[] = body.staffInvites.map((invite, index) => {
        state.invitedStaffEmails.push(invite.email);
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
      onboardingSummary = { ...onboardingSummary, memberships: [...onboardingSummary.memberships, ...memberships] };
      void route.fulfill({ status: 201, json: { data: { memberships } } });
      return;
    }
    if (path === `/onboarding/projects/${ONBOARDING_PROJECT_ID}`) {
      const body = request.postDataJSON() as UpdateOnboardingProject;
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
      state.savedProjectGates.push(`${updatedProject.status}|${updatedProject.operatorReviewState}|${updatedProject.currentStep}`);
      onboardingSummary = { ...onboardingSummary, projects: [updatedProject] };
      void route.fulfill({ json: { data: updatedProject } });
      return;
    }
    if (path === `/onboarding/entitlements/${ONBOARDING_ENTITLEMENT_ID}/provider-verification`) {
      const body = request.postDataJSON() as VerifyWorkspaceEntitlement;
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
      state.savedProviderGates.push(`${updatedEntitlement.billingProvider}|${updatedEntitlement.providerVerificationStatus}|${String(updatedEntitlement.accessEnforced)}`);
      onboardingSummary = { ...onboardingSummary, entitlements: [updatedEntitlement] };
      void route.fulfill({ json: { data: updatedEntitlement } });
      return;
    }

    if (path === `/events/${EVENT_ID}/ops-board`) {
      void route.fulfill({ json: { data: eventDayBoardFixture(taskStatus) } });
      return;
    }
    if (path === `/events/${EVENT_ID}/change-feed`) {
      void route.fulfill({ json: { data: [changeFeedFixture()] } });
      return;
    }
    if (path === `/events/${EVENT_ID}/change-acknowledgements`) {
      const body = request.postDataJSON() as { readonly changeId?: string };
      if (body.changeId !== undefined) state.acknowledgements.push(body.changeId);
      void route.fulfill({
        json: {
          data: {
            id: "00000000-0000-4000-8000-000000004017",
            changeId: body.changeId ?? CHANGE_ID,
            eventId: EVENT_ID,
            acknowledgedBy: "00000000-0000-4000-8000-000000004093",
            acknowledgedByRole: "hallkeeper",
            note: null,
            createdAt: NOW,
          },
        },
      });
      return;
    }
    if (path === `/ops-tasks/${TASK_ID}/status`) {
      const body = request.postDataJSON() as { readonly status?: OpsTask["status"] };
      taskStatus = body.status ?? "todo";
      state.taskStatuses.push(taskStatus);
      void route.fulfill({ json: { data: taskFixture(taskStatus) } });
      return;
    }
    if (path === `/events/${EVENT_ID}/issues`) {
      const body = request.postDataJSON() as { readonly title?: string };
      if (body.title !== undefined) state.issueTitles.push(body.title);
      void route.fulfill({ json: { data: eventDayIssueFixture() } });
      return;
    }

    void route.fulfill({ status: 404, json: { error: `Unhandled focus test route: ${method} ${path}` } });
  });

  return state;
}

function percentile(values: readonly number[], percentileValue: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.min(sorted.length - 1, Math.floor((percentileValue / 100) * sorted.length));
  return sorted[index] ?? 0;
}

function sustainedAbove(values: readonly number[], threshold: number): number {
  let current = 0;
  let max = 0;
  for (const value of values) {
    if (value > threshold) {
      current += 1;
      max = Math.max(max, current);
    } else {
      current = 0;
    }
  }
  return max;
}

function summarize(frames: readonly number[]): FrameSummary {
  const total = frames.reduce((sum, frame) => sum + frame, 0);
  return {
    count: frames.length,
    averageMs: frames.length === 0 ? 0 : total / frames.length,
    p95Ms: percentile(frames, 95),
    maxMs: frames.length === 0 ? 0 : Math.max(...frames),
    overTargetCount: frames.filter((frame) => frame > TARGET_FRAME_MS).length,
    sustainedOverTarget: sustainedAbove(frames, TARGET_FRAME_MS),
    overPassBudgetCount: frames.filter((frame) => frame > PASS_P95_MS).length,
    sustainedOverPassBudget: sustainedAbove(frames, PASS_P95_MS),
  };
}

async function sampleFrames(page: Page, durationMs: number): Promise<number[]> {
  return page.evaluate((sampleDuration) => new Promise<number[]>((resolve) => {
    const frames: number[] = [];
    let last = performance.now();
    const end = last + sampleDuration;

    function tick(now: number): void {
      frames.push(now - last);
      last = now;
      if (now >= end) {
        resolve(frames.slice(1));
        return;
      }
      requestAnimationFrame(tick);
    }

    requestAnimationFrame(tick);
  }), durationMs);
}

function cdpMetricMap(payload: CdpMetricsPayload): Record<string, number> {
  const out: Record<string, number> = {};
  for (const metric of payload.metrics) {
    out[metric.name] = metric.value;
  }
  return out;
}

function metricDeltaMs(after: Record<string, number>, before: Record<string, number>, name: string): number {
  return ((after[name] ?? 0) - (before[name] ?? 0)) * 1000;
}

async function assertNoRuntimeBreakage(page: Page, problems: PageProblems): Promise<void> {
  await expect(page.locator("vite-error-overlay")).toHaveCount(0);
  await expect(page.getByText(/Internal Server Error|Failed to fetch dynamically imported module/u)).toHaveCount(0);
  expect(problems.pageErrors).toEqual([]);
  expect(problems.consoleErrors).toEqual([]);
}

async function activeElementInside(page: Page, container: Locator): Promise<boolean> {
  const handle = await container.elementHandle();
  expect(handle).not.toBeNull();
  return page.evaluate((node) => {
    const active = document.activeElement;
    return active instanceof Element && node.contains(active);
  }, handle);
}

async function expectFocusInside(page: Page, container: Locator, label: string): Promise<void> {
  expect(await activeElementInside(page, container), `${label}: active element should remain inside the dialog`).toBe(true);
}

async function expectActiveElementVisible(page: Page, label: string): Promise<void> {
  const state = await page.evaluate(() => {
    const active = document.activeElement;
    if (!(active instanceof Element)) {
      return { ok: false, tag: "none", text: "" };
    }
    const rect = active.getBoundingClientRect();
    const style = window.getComputedStyle(active);
    return {
      ok: rect.width > 0 &&
        rect.height > 0 &&
        rect.bottom >= 0 &&
        rect.right >= 0 &&
        rect.top <= window.innerHeight &&
        rect.left <= window.innerWidth &&
        style.display !== "none" &&
        style.visibility !== "hidden",
      tag: active.tagName.toLowerCase(),
      text: active.textContent?.trim().slice(0, 80) ?? "",
    };
  });
  expect(state.ok, `${label}: active ${state.tag} ${state.text} should be visible`).toBe(true);
}

async function pressTabsInside(page: Page, container: Locator, label: string, count: number): Promise<void> {
  for (let index = 0; index < count; index += 1) {
    await page.keyboard.press("Tab");
    await expectFocusInside(page, container, `${label} Tab ${String(index + 1)}`);
  }
  await page.keyboard.press("Shift+Tab");
  await expectFocusInside(page, container, `${label} Shift+Tab`);
}

async function pressTabsAcrossPage(page: Page, label: string, count: number): Promise<void> {
  for (let index = 0; index < count; index += 1) {
    await page.keyboard.press("Tab");
    await expectActiveElementVisible(page, `${label} Tab ${String(index + 1)}`);
  }
}

async function recordKeyboardBudget(
  page: Page,
  problems: PageProblems,
  name: string,
  viewport: FocusViewportName,
  interaction: () => Promise<void>,
): Promise<void> {
  await page.waitForTimeout(200);
  await assertNoRuntimeBreakage(page, problems);

  const session = await page.context().newCDPSession(page);
  await session.send("Performance.enable");
  const before = cdpMetricMap(await session.send("Performance.getMetrics") as CdpMetricsPayload);

  const idleFrames = await sampleFrames(page, SAMPLE_MS);
  await interaction();
  const interactionFrames = await sampleFrames(page, SAMPLE_MS);

  const after = cdpMetricMap(await session.send("Performance.getMetrics") as CdpMetricsPayload);
  await session.detach();

  const idle = summarize(idleFrames);
  const interactionSummary = summarize(interactionFrames);
  const cdp: CdpDelta = {
    scriptDurationMs: metricDeltaMs(after, before, "ScriptDuration"),
    layoutDurationMs: metricDeltaMs(after, before, "LayoutDuration"),
    recalcStyleDurationMs: metricDeltaMs(after, before, "RecalcStyleDuration"),
    taskDurationMs: metricDeltaMs(after, before, "TaskDuration"),
    jsHeapUsedBytes: after.JSHeapUsedSize ?? 0,
  };

  const passed =
    idle.p95Ms <= PASS_P95_MS &&
    interactionSummary.p95Ms <= PASS_P95_MS &&
    idle.sustainedOverPassBudget <= MAX_SUSTAINED_OVER_BUDGET &&
    interactionSummary.sustainedOverPassBudget <= MAX_SUSTAINED_OVER_BUDGET;

  results.push({
    name,
    viewport,
    idle,
    interaction: interactionSummary,
    cdp,
    passed,
  });

  expect(idle.p95Ms, `${name} idle p95 frame budget`).toBeLessThanOrEqual(PASS_P95_MS);
  expect(interactionSummary.p95Ms, `${name} interaction p95 frame budget`).toBeLessThanOrEqual(PASS_P95_MS);
  expect(idle.sustainedOverPassBudget, `${name} idle sustained pass-budget misses`).toBeLessThanOrEqual(MAX_SUSTAINED_OVER_BUDGET);
  expect(interactionSummary.sustainedOverPassBudget, `${name} interaction sustained pass-budget misses`).toBeLessThanOrEqual(MAX_SUSTAINED_OVER_BUDGET);
}

async function recordAccessibilityState(
  page: Page,
  problems: PageProblems,
  name: string,
  path: string,
  viewport: FocusViewportName,
  maxFocusSteps = 14,
): Promise<void> {
  const result = await collectAccessibilityAudit(page, {
    name,
    path,
    problems,
    viewport: accessibilityViewport(viewport),
    maxFocusSteps,
  });
  accessibilityResults.push(result);
  expectAccessibilityAuditClean(result);
}

async function openDashboardView(page: Page, role: SeedRole, view: string): Promise<PageProblems> {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await seedAuthenticatedUser(page, role);
  await mockApiRoutes(page);
  const problems = watchPageProblems(page);
  await page.goto(`/dashboard?view=${view}`);
  await expect(page.locator("main")).toBeVisible();
  return problems;
}

test.describe.configure({ mode: "serial" });

test.afterAll(async () => {
  await mkdir(dirname(REPORT_PATH), { recursive: true });
  await writeFile(
    REPORT_PATH,
    `${JSON.stringify({
      generatedAt: new Date().toISOString(),
      sampleMs: SAMPLE_MS,
      passP95Ms: PASS_P95_MS,
      maxSustainedOverBudget: MAX_SUSTAINED_OVER_BUDGET,
      results,
      accessibilityResults,
    }, null, 2)}\n`,
    "utf8",
  );
});

test("admin create-venue dialog traps keyboard focus and stays within frame budget", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  const problems = await openDashboardView(page, "platform-admin", "admin");
  const opener = page.getByRole("button", { name: "New Venue" });
  await opener.click();
  const dialog = page.getByRole("dialog", { name: "New Venue" });
  await expect(dialog).toBeVisible();
  await expect(dialog).toHaveAttribute("aria-modal", "true");
  await page.waitForTimeout(50);
  await expectFocusInside(page, dialog, "admin create venue initial focus");
  await recordAccessibilityState(page, problems, "admin create venue dialog", "/dashboard?view=admin", "desktop", 10);

  await recordKeyboardBudget(page, problems, "admin-create-venue-focus-trap", "desktop", async () => {
    await pressTabsInside(page, dialog, "admin create venue", 7);
  });

  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
  await expect(opener).toBeFocused();
});

test("admin nested space, pricing, and destructive dialogs stay accessible and keyboard-contained", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.emulateMedia({ reducedMotion: "reduce" });
  await seedAuthenticatedUser(page, "platform-admin");
  const mockState = await mockApiRoutes(page);
  const problems = watchPageProblems(page);
  await page.goto("/dashboard?view=admin");
  await expect(page.locator("main")).toBeVisible();
  await page.getByRole("button", { name: /Trades Hall Glasgow/u }).click();
  await expect(page.getByRole("heading", { level: 2, name: "Trades Hall Glasgow" })).toBeVisible();

  await page.getByRole("button", { name: "New Space" }).click();
  const createSpaceDialog = page.getByRole("dialog", { name: "New Space" });
  await expect(createSpaceDialog).toBeVisible();
  await expect(createSpaceDialog).toHaveAttribute("aria-modal", "true");
  await recordAccessibilityState(page, problems, "admin create space dialog", "/dashboard?view=admin", "desktop", 14);
  await recordKeyboardBudget(page, problems, "admin-create-space-focus-trap", "desktop", async () => {
    await pressTabsInside(page, createSpaceDialog, "admin create space", 8);
  });
  await page.getByLabel("Space Name").fill("Reception Room");
  await page.getByLabel("Height (m)").fill("4.2");
  await page.getByRole("button", { name: "Reset to rectangle" }).click();
  await page.getByRole("button", { name: "Create Space" }).click();
  await expect(createSpaceDialog).toBeHidden();
  await expect.poll(() => mockState.createdAdminSpaces).toContain("Reception Room|reception-room|4.2|4");

  await page.getByRole("button", { name: "New Rule" }).click();
  const pricingDialog = page.getByRole("dialog", { name: "New Pricing Rule" });
  await expect(pricingDialog).toBeVisible();
  await expect(pricingDialog).toHaveAttribute("aria-modal", "true");
  await recordAccessibilityState(page, problems, "admin pricing rule dialog", "/dashboard?view=admin", "desktop", 12);
  await recordKeyboardBudget(page, problems, "admin-pricing-rule-focus-trap", "desktop", async () => {
    await pressTabsInside(page, pricingDialog, "admin pricing rule", 7);
  });
  await page.getByLabel("Rule Name").fill("Reception Room Evening");
  await page.getByLabel("Amount (GBP)").fill("500");
  await page.getByRole("button", { name: "Create Rule" }).click();
  await expect(pricingDialog).toBeHidden();
  await expect.poll(() => mockState.createdPricingRules).toContain("Reception Room Evening|flat_rate|500|venue-wide");

  await page.getByRole("button", { name: "Edit space Grand Hall" }).click();
  const editSpaceDialog = page.getByRole("dialog", { name: "Edit Space" });
  await expect(editSpaceDialog).toBeVisible();
  await expect(editSpaceDialog).toHaveAttribute("aria-modal", "true");
  await recordAccessibilityState(page, problems, "admin edit space dialog", "/dashboard?view=admin", "desktop", 14);
  await page.getByLabel("Height (m)").fill("7.8");
  await page.getByRole("button", { name: "Save Changes" }).click();
  await expect(editSpaceDialog).toBeHidden();
  await expect.poll(() => mockState.editedAdminSpaces).toContain("Grand Hall|7.8|0");

  await page.getByRole("button", { name: "Delete pricing rule Grand Hall Half Day" }).click();
  await expect.poll(() => mockState.deletedPricingRules).toContain("00000000-0000-4000-8000-000000004038");

  await page.getByRole("button", { name: "Delete space Grand Hall" }).click();
  const deleteSpaceDialog = page.getByRole("dialog", { name: "Delete Space" });
  await expect(deleteSpaceDialog).toBeVisible();
  await expect(deleteSpaceDialog).toHaveAttribute("aria-modal", "true");
  await recordAccessibilityState(page, problems, "admin delete space dialog", "/dashboard?view=admin", "desktop", 8);
  await pressTabsInside(page, deleteSpaceDialog, "admin delete space", 4);
  await page.keyboard.press("Escape");
  await expect(deleteSpaceDialog).toBeHidden();

  await page.getByRole("button", { name: "Delete Venue" }).click();
  const deleteVenueDialog = page.getByRole("dialog", { name: "Delete Venue" });
  await expect(deleteVenueDialog).toBeVisible();
  await expect(deleteVenueDialog).toHaveAttribute("aria-modal", "true");
  await recordAccessibilityState(page, problems, "admin delete venue dialog", "/dashboard?view=admin", "desktop", 8);
  await pressTabsInside(page, deleteVenueDialog, "admin delete venue", 4);
  await page.keyboard.press("Escape");
  await expect(deleteVenueDialog).toBeHidden();
});

test("review request-changes dialog traps keyboard focus and closes cleanly", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  const problems = await openDashboardView(page, "staff", "reviews");
  await page.getByRole("button", { name: "Open review for Reception Room dinner review" }).click();
  await expect(page.getByRole("button", { name: "Request Changes" })).toBeVisible();
  await page.getByRole("button", { name: "Request Changes" }).click();

  const dialog = page.getByRole("dialog", { name: "Request changes on this layout?" });
  await expect(dialog).toBeVisible();
  await expect(dialog).toHaveAttribute("aria-modal", "true");
  await page.waitForTimeout(50);
  await expectFocusInside(page, dialog, "review request changes initial focus");
  await recordAccessibilityState(page, problems, "reviews request-changes dialog", "/dashboard?view=reviews", "desktop", 10);

  await recordKeyboardBudget(page, problems, "reviews-request-changes-focus-trap", "desktop", async () => {
    await pressTabsInside(page, dialog, "review request changes", 6);
  });

  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
});

test("loadout create and delete dialogs trap focus without keyboard leaks", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  const problems = await openDashboardView(page, "staff", "loadouts");
  await page.getByRole("button", { name: "New Loadout" }).click();

  const createDialog = page.getByRole("dialog", { name: "New Reference Loadout" });
  await expect(createDialog).toBeVisible();
  await expect(createDialog).toHaveAttribute("aria-modal", "true");
  await page.waitForTimeout(50);
  await expectFocusInside(page, createDialog, "loadout create initial focus");
  await recordAccessibilityState(page, problems, "loadout create dialog", "/dashboard?view=loadouts", "desktop", 10);

  await recordKeyboardBudget(page, problems, "loadout-create-focus-trap", "desktop", async () => {
    await pressTabsInside(page, createDialog, "loadout create", 7);
  });
  await page.keyboard.press("Escape");
  await expect(createDialog).toBeHidden();

  await page.getByRole("button", { name: "Open reference loadout Ceremony reference setup" }).click();
  await page.getByRole("button", { name: "Delete Loadout" }).click();
  const deleteDialog = page.getByRole("dialog", { name: "Delete Loadout" });
  await expect(deleteDialog).toBeVisible();
  await expect(deleteDialog).toHaveAttribute("aria-modal", "true");
  await page.waitForTimeout(50);
  await expectFocusInside(page, deleteDialog, "loadout delete initial focus");
  await recordAccessibilityState(page, problems, "loadout delete dialog", "/dashboard?view=loadouts", "desktop", 8);
  await pressTabsInside(page, deleteDialog, "loadout delete", 4);
  await page.keyboard.press("Escape");
  await expect(deleteDialog).toBeHidden();
});

test("proposal drawer and composer controls remain keyboard reachable within frame budget", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  const problems = await openDashboardView(page, "staff", "proposals");
  await page.getByTestId(`proposal-row-${PROPOSAL_ID}`).click();

  const detail = page.getByLabel("Proposal detail");
  await expect(detail).toBeVisible();
  await expect(page.getByLabel("Compose version")).toBeVisible();
  await recordAccessibilityState(page, problems, "proposal detail drawer", "/dashboard?view=proposals", "desktop", 16);
  await page.locator("main").click({ position: { x: 24, y: 24 } });

  await recordKeyboardBudget(page, problems, "proposal-detail-keyboard-traversal", "desktop", async () => {
    await pressTabsAcrossPage(page, "proposal detail", 16);
    await page.getByTestId("reply-input").fill("We will review the arrival route and reply with the updated draft.");
    await page.getByTestId("reply-submit").click();
  });
});

test("onboarding admin action forms keep focus visible across seeded operator controls", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  const problems = await openDashboardView(page, "platform-admin", "onboarding");
  await expect(page.getByLabel("Trades Hall deployment deployment actions")).toBeVisible();
  await page.getByLabel("Invite staff for Trades Hall deployment").fill("planner@venue.example\nhallkeeper@venue.example");
  await recordAccessibilityState(page, problems, "onboarding operator action forms", "/dashboard?view=onboarding", "desktop", 14);

  await recordKeyboardBudget(page, problems, "onboarding-operator-form-keyboard-traversal", "desktop", async () => {
    await pressTabsAcrossPage(page, "onboarding operator", 12);
    await page.getByLabel("Current step for Trades Hall deployment").fill("Coordinate production readiness review.");
    await page.getByLabel("Save project gate for Trades Hall deployment").click();
  });
});

test("event-day mobile ops controls are keyboard reachable without horizontal overflow", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.emulateMedia({ reducedMotion: "reduce" });
  await seedAuthenticatedUser(page, "hallkeeper");
  const mockState = await mockApiRoutes(page);
  const problems = watchPageProblems(page);
  await page.goto(`/ops/events/${EVENT_ID}`);
  await expect(page.getByRole("heading", { name: "Wilson wedding" })).toBeVisible();

  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow, "event-day mobile should not horizontally overflow").toBeLessThanOrEqual(2);
  await recordAccessibilityState(page, problems, "event-day mobile ops board", `/ops/events/${EVENT_ID}`, "mobile", 14);

  await recordKeyboardBudget(page, problems, "event-day-mobile-keyboard-traversal", "mobile", async () => {
    await pressTabsAcrossPage(page, "event-day mobile", 14);
    await page.getByRole("button", { name: "Acknowledge change" }).click();
    await page.getByRole("button", { name: "Start" }).click();
    await page.getByLabel("Title").fill("Late linen arrival");
    await page.getByLabel("Detail").fill("Supplier is running fifteen minutes late.");
    await page.getByRole("button", { name: "Log issue" }).click();
  });

  expect(mockState.acknowledgements).toContain(CHANGE_ID);
  expect(mockState.taskStatuses).toContain("in_progress");
  expect(mockState.issueTitles).toContain("Late linen arrival");
});
