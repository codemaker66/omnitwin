import { expect, test, type Page } from "@playwright/test";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import type {
  ChangeFeedItem,
  CreateManagedOnboardingResult,
  EventDayIssue,
  EventDayOpsBoard,
  OnboardingSummary,
  OpsHandoffPackBundle,
  OpsTask,
  RoomAssetStatus,
} from "@omnitwin/types";
import type { PublicProposal } from "../src/api/proposals.js";
import type { Space, Venue, VenueDetail } from "../src/api/spaces.js";
import type { SupplierSafePackView } from "../src/api/supplier-coordination.js";
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
const ISSUE_ID = "00000000-0000-4000-8000-000000004010";
const ONBOARDING_WORKSPACE_ID = "00000000-0000-4000-8000-000000004021";
const ONBOARDING_PROJECT_ID = "00000000-0000-4000-8000-000000004028";
const ONBOARDING_ENTITLEMENT_ID = "00000000-0000-4000-8000-000000004029";
const SUPPLIER_TOKEN = "t469-supplier-share";
const SHARE_TOKEN = "t469-proposal-share";
const HASH = "b".repeat(64);

const SAMPLE_MS = Number.parseInt(process.env.FRAME_BUDGET_SAMPLE_MS ?? "1200", 10);
const TARGET_FRAME_MS = 16.7;
const PASS_P95_MS = Number.parseFloat(process.env.FRAME_BUDGET_PASS_P95_MS ?? "18.5");
const MAX_SUSTAINED_OVER_BUDGET = Number.parseInt(process.env.FRAME_BUDGET_MAX_SUSTAINED ?? "1", 10);
const ARTIFACT_DIR = "C:/Users/blake/omnitwin2/artifacts/t469-operational-state-frame-visual-2026-06-19";
const REPORT_PATH = `${ARTIFACT_DIR}/report.json`;

type SeedRole = "staff" | "planner" | "hallkeeper" | "admin" | "platform-admin" | "executive" | "supplier";
type OperationalViewportName = "desktop" | "tablet" | "mobile";

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

interface StatePassResult {
  readonly name: string;
  readonly viewport: OperationalViewportName;
  readonly screenshotPath: string;
  readonly screenshotBytes: number;
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

const results: StatePassResult[] = [];
const accessibilityResults: AccessibilityAuditResult[] = [];

function accessibilityViewport(name: OperationalViewportName): AccessibilityViewport {
  if (name === "mobile") return { name: "mobile", width: 390, height: 844 };
  if (name === "tablet") return { name: "tablet", width: 900, height: 1180 };
  return { name: "desktop", width: 1280, height: 900 };
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
        email: `${seedRole}@t469-operational.test`,
        role: venueRole,
        platformRole: isPlatformAdmin ? "admin" : "none",
        venueId: isPlatformAdmin ? null : venueId,
        name: `${seedRole[0]?.toUpperCase() ?? "U"}${seedRole.slice(1)} Operational Budget`,
      },
      writable: false,
    });
  }, { seedRole: role, venueId: VENUE_ID });
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

function venueFixture(overrides: Partial<Venue> = {}): Venue {
  return {
    id: VENUE_ID,
    name: "Trades Hall Glasgow",
    slug: "trades-hall",
    address: "85 Glassford Street",
    logoUrl: null,
    brandColour: null,
    ...overrides,
  };
}

function venueDetailFixture(): VenueDetail {
  return {
    ...venueFixture(),
    spaces: [spaceFixture()],
  };
}

function roomAssetStatusFixture(overrides: Partial<RoomAssetStatus> = {}): RoomAssetStatus {
  return {
    venueSlug: "trades-hall",
    roomSlug: "grand-hall",
    displayName: "Grand Hall",
    roomGroup: "principal-room",
    defaultStatus: "needs_processing",
    captureStatus: "captured_needs_processing",
    registryRuntimeStatus: "not_registered",
    publicShowcaseEnabled: false,
    internalVisualEnabled: true,
    primaryCaptureSource: "xgrids",
    currentState: "captured_needs_processing",
    splatStatus: "captured / needs processing",
    splatExists: false,
    runtimePackageStatus: "no runtime package registered",
    runtimePackageExists: false,
    reviewedTransformStatus: "missing",
    reviewedTransformArtifactCount: 0,
    latestTransformArtifactId: null,
    reviewedTransformSafeCopy: "no reviewed runtime transform registered",
    reviewedQaStatus: "missing",
    latestQaRecordId: null,
    qaSignedTransformArtifactId: null,
    qaSignedTransformLinked: false,
    reviewedQaSafeCopy: "no runtime QA record registered",
    captureControlStatus: "missing",
    captureControlSourceCount: 0,
    latestCaptureControlSourceRecordId: null,
    latestCaptureControlSourceId: null,
    latestCaptureControlSourceClass: null,
    latestCaptureControlPoseAuthorityLevel: null,
    latestCaptureControlAlignmentMethods: [],
    latestCaptureControlStalenessTriggers: [],
    latestCaptureControlActiveStalenessTriggers: [],
    captureControlFreshnessStatus: "missing",
    latestCaptureControlQaStatus: null,
    captureControlLinkedTransformArtifactId: null,
    captureControlTransformLinked: false,
    captureControlAuthoritySafeCopy: "no capture-control authority recorded",
    captureControlStalenessSafeCopy: "no capture-control staleness policy recorded",
    captureControlSafeCopy: "no capture-control source registered",
    runtimeControlEvidenceChainStatus: "not_recorded",
    runtimeControlEvidenceChainRef: null,
    runtimeControlRequiredCoordinatePairCount: null,
    runtimeControlReviewedCoordinatePairCount: null,
    runtimeControlEvidenceChainSafeCopy: "runtime-control evidence chain not recorded for this room",
    runtimeControlEvidenceChainNextAction: "Create runtime-control source evidence before signed-transform review",
    evidenceStatus: null,
    runtimeStatus: null,
    nextAction: "Process captured room into a runtime splat",
    safeCopy: "captured / needs processing",
    ...overrides,
  };
}

function roomAssetStatusFixtures(): readonly RoomAssetStatus[] {
  return [
    roomAssetStatusFixture(),
    roomAssetStatusFixture({
      roomSlug: "reception-room",
      displayName: "Reception Room",
      roomGroup: "support-room",
      defaultStatus: "needs_registration",
      captureStatus: "processed_needs_registration",
      currentState: "processed_output_found",
      splatStatus: "registered SPZ visual asset",
      splatExists: true,
      runtimePackageStatus: "runtime package staged for internal visual review",
      runtimePackageExists: true,
      reviewedTransformStatus: "missing",
      reviewedTransformArtifactCount: 0,
      reviewedTransformSafeCopy: "no signed transform registered for public exposure",
      reviewedQaStatus: "blocked_internal_only",
      latestQaRecordId: "reception-room-runtime-qa-2026-06-16",
      reviewedQaSafeCopy: "runtime asset loaded, not yet verified/signed",
      captureControlStatus: "source_registered",
      captureControlSourceCount: 1,
      latestCaptureControlSourceRecordId: "10000000-0000-4000-8000-000000000022",
      latestCaptureControlSourceId: "reception-room-approximate-view-transform-v0",
      latestCaptureControlSourceClass: "artist_blender_alignment_refs",
      latestCaptureControlPoseAuthorityLevel: "visual_alignment_only",
      latestCaptureControlAlignmentMethods: ["visual_alignment"],
      latestCaptureControlStalenessTriggers: ["runtime_package_changed", "scene_authority_map_changed"],
      latestCaptureControlActiveStalenessTriggers: ["runtime_package_changed"],
      captureControlFreshnessStatus: "stale_for_runtime_package",
      latestCaptureControlQaStatus: "requires_human_review",
      captureControlAuthoritySafeCopy: "visual-only alignment source recorded; not measurement control",
      captureControlStalenessSafeCopy: "capture-control source has 2 staleness triggers recorded",
      captureControlSafeCopy: "capture-control source registered; stale evidence review required",
      runtimeControlEvidenceChainStatus: "blocked_missing_coordinate_pair_intake",
      runtimeControlEvidenceChainRef: "docs/operations/reception-room-runtime-control-evidence-chain-status-2026-06-16.json",
      runtimeControlRequiredCoordinatePairCount: 4,
      runtimeControlReviewedCoordinatePairCount: 0,
      runtimeControlEvidenceChainSafeCopy: "runtime-control chain blocked because reviewed coordinate-pair intake is missing",
      runtimeControlEvidenceChainNextAction: "Collect the four reviewed ARF to CVF landmark measurements",
      evidenceStatus: "unverified",
      runtimeStatus: "internal_ready",
      nextAction: "Open the internal runtime view and collect reviewed coordinate-pair evidence",
      safeCopy: "Runtime asset loaded, not yet verified/signed.",
    }),
    roomAssetStatusFixture({
      roomSlug: "saloon",
      displayName: "Saloon",
      roomGroup: "support-room",
      defaultStatus: "needs_registration",
      captureStatus: "splat_exists_outside_repo_needs_registration",
      currentState: "splat_done_outside_repo",
      splatStatus: "splat exists outside repo / needs registration",
      nextAction: "Register external splat asset and runtime package",
      safeCopy: "splat exists outside repo / needs registration",
    }),
  ];
}

function publicProposalFixture(): PublicProposal {
  return {
    title: "Reception Room wedding proposal",
    status: "sent",
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

function supplierPackFixture(): SupplierSafePackView {
  return {
    title: "Florist coordination handoff",
    venueName: "Trades Hall Glasgow",
    supplierName: "Petal & Stem",
    contactName: "Venue Planner",
    contactEmail: "planner@tradeshall.test",
    contactPhone: null,
    status: "issued",
    safeStatus: "supplier_safe_operations_handoff",
    issuedAt: NOW,
    expiresAt: "2026-06-19T12:00:00.000Z",
    source: {
      sourceLabel: "Approved configuration snapshot v3",
      handoffVersion: 3,
      compiledAt: NOW,
      snapshotHashPrefix: HASH.slice(0, 12),
      sourceDigest: HASH,
    },
    changesSincePreviousHandoff: {
      summary: "Two supplier-facing changes since the previous handoff.",
      addedCount: 1,
      removedCount: 0,
      changedCount: 1,
    },
    items: [
      {
        title: "Load-in arrival",
        detail: "Arrive at the staff entrance and wait for venue-team confirmation before unloading.",
        kind: "load_in_window",
        arrivalWindow: "15:00-15:30",
        sourceRef: "load-in sequence",
        sortOrder: 0,
      },
      {
        title: "Table centrepieces",
        detail: "Place classic florals on the listed dinner tables after linen inspection.",
        kind: "requirement",
        arrivalWindow: null,
        sourceRef: "supplier notes",
        sortOrder: 1,
      },
    ],
    acknowledgements: [],
    supplierNotice: "Supplier-facing planning handoff from venue operations data. Confirm details with the venue team before arrival.",
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
    sourceId: "t469-comment",
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

function eventDayBoardFixture(): EventDayOpsBoard {
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
      opsTasks: [taskFixture()],
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
    issues: [eventDayIssueFixture()],
    statusUpdates: [],
    setupProgress: {
      totalTasks: 1,
      doneTasks: 0,
      blockedTasks: 0,
      activeTasks: 1,
      percent: 0,
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

function opsHandoffBundleFixture(): OpsHandoffPackBundle {
  const setupGroupId = "00000000-0000-4000-8000-000000004071";
  const flipGroupId = "00000000-0000-4000-8000-000000004072";
  const supplierGroupId = "00000000-0000-4000-8000-000000004073";
  const breakdownGroupId = "00000000-0000-4000-8000-000000004074";
  const pickListId = "00000000-0000-4000-8000-000000004075";

  return {
    pack: {
      id: PACK_ID,
      eventId: EVENT_ID,
      configId: CONFIG_ID,
      snapshotId: SNAPSHOT_ID,
      snapshotHash: HASH,
      version: 4,
      status: "compiled",
      sourceLabel: "Approved configuration snapshot v4",
      summary: "Reception Room handoff compiled from approved snapshot v4: 3 pick-list lines, 5 tasks, 2 supplier notes.",
      createdBy: null,
      compiledAt: NOW,
      updatedAt: NOW,
    },
    taskGroups: [
      {
        id: setupGroupId,
        handoffPackId: PACK_ID,
        title: "Setup tasks",
        kind: "setup",
        sortOrder: 0,
        createdAt: NOW,
      },
      {
        id: flipGroupId,
        handoffPackId: PACK_ID,
        title: "Room flip tasks",
        kind: "room_flip",
        sortOrder: 1,
        createdAt: NOW,
      },
      {
        id: supplierGroupId,
        handoffPackId: PACK_ID,
        title: "Supplier notes",
        kind: "supplier",
        sortOrder: 2,
        createdAt: NOW,
      },
      {
        id: breakdownGroupId,
        handoffPackId: PACK_ID,
        title: "Breakdown tasks",
        kind: "breakdown",
        sortOrder: 3,
        createdAt: NOW,
      },
    ],
    opsTasks: [
      {
        id: "00000000-0000-4000-8000-000000004076",
        handoffPackId: PACK_ID,
        taskGroupId: setupGroupId,
        phaseId: null,
        kind: "setup",
        title: "Set 14 round tables",
        detail: "Place tables from the approved Reception Room dinner layout.",
        status: "todo",
        sortOrder: 0,
        dueLabel: "Before guest arrival",
        sourceRef: "handoff-pack-v4",
        createdAt: NOW,
        updatedAt: NOW,
      },
      {
        id: "00000000-0000-4000-8000-000000004077",
        handoffPackId: PACK_ID,
        taskGroupId: setupGroupId,
        phaseId: null,
        kind: "setup",
        title: "Check accessible route",
        detail: "Keep the main-door route clear for mobility access.",
        status: "todo",
        sortOrder: 1,
        dueLabel: "Before doors",
        sourceRef: "accessibility-note",
        createdAt: NOW,
        updatedAt: NOW,
      },
      {
        id: "00000000-0000-4000-8000-000000004078",
        handoffPackId: PACK_ID,
        taskGroupId: flipGroupId,
        phaseId: null,
        kind: "room_flip",
        title: "Flip ceremony to dinner",
        detail: "Target 45 minute room flip from ceremony rows to dinner rounds.",
        status: "todo",
        sortOrder: 2,
        dueLabel: "45 min planning window",
        sourceRef: "phase:room-flip",
        createdAt: NOW,
        updatedAt: NOW,
      },
      {
        id: "00000000-0000-4000-8000-000000004079",
        handoffPackId: PACK_ID,
        taskGroupId: supplierGroupId,
        phaseId: null,
        kind: "supplier",
        title: "Confirm florist arrival",
        detail: "Florist to arrive after linen inspection and before table centrepiece placement.",
        status: "todo",
        sortOrder: 3,
        dueLabel: "15:30",
        sourceRef: "supplier:floral",
        createdAt: NOW,
        updatedAt: NOW,
      },
      {
        id: "00000000-0000-4000-8000-000000004080",
        handoffPackId: PACK_ID,
        taskGroupId: breakdownGroupId,
        phaseId: null,
        kind: "breakdown",
        title: "Account for tables and linen",
        detail: "Reconcile table and linen counts against the handoff pick list before storage.",
        status: "todo",
        sortOrder: 4,
        dueLabel: "After event close",
        sourceRef: "pick-list",
        createdAt: NOW,
        updatedAt: NOW,
      },
    ],
    furniturePickList: {
      id: pickListId,
      handoffPackId: PACK_ID,
      title: "Reception Room furniture pick list",
      totalItems: 144,
      createdAt: NOW,
    },
    pickListItems: [
      {
        id: "00000000-0000-4000-8000-000000004081",
        pickListId,
        name: "Round Table",
        category: "table",
        quantity: 14,
        sourcePhase: null,
        sourceZone: "Reception Room",
        notes: "Dinner rounds from approved snapshot.",
        sortOrder: 0,
        createdAt: NOW,
      },
      {
        id: "00000000-0000-4000-8000-000000004082",
        pickListId,
        name: "Gold Chiavari Chair",
        category: "chair",
        quantity: 120,
        sourcePhase: null,
        sourceZone: "Reception Room",
        notes: "Includes guest seating only.",
        sortOrder: 1,
        createdAt: NOW,
      },
      {
        id: "00000000-0000-4000-8000-000000004083",
        pickListId,
        name: "Ivory Tablecloth",
        category: "linen",
        quantity: 10,
        sourcePhase: null,
        sourceZone: "Stores",
        notes: "Inspect before floral setup.",
        sortOrder: 2,
        createdAt: NOW,
      },
    ],
    supplierInstructions: [
      {
        id: "00000000-0000-4000-8000-000000004084",
        handoffPackId: PACK_ID,
        supplierId: null,
        category: "floral",
        title: "Florist load-in",
        detail: "Wait for linen inspection before placing centrepieces.",
        arrivalWindow: "15:30-16:00",
        sourceRef: "supplier notes",
        sortOrder: 0,
        createdAt: NOW,
      },
      {
        id: "00000000-0000-4000-8000-000000004085",
        handoffPackId: PACK_ID,
        supplierId: null,
        category: "catering",
        title: "Catering route",
        detail: "Use staff entrance only; keep main guest route clear.",
        arrivalWindow: "16:00-16:30",
        sourceRef: "service lane note",
        sortOrder: 1,
        createdAt: NOW,
      },
    ],
    loadInSequence: [
      {
        id: "00000000-0000-4000-8000-000000004086",
        handoffPackId: PACK_ID,
        kind: "load_in",
        stepNumber: 1,
        title: "Tables and linen",
        detail: "Stage tables before linen and florals.",
        sortOrder: 0,
        createdAt: NOW,
      },
    ],
    breakdownSequence: [
      {
        id: "00000000-0000-4000-8000-000000004087",
        handoffPackId: PACK_ID,
        kind: "breakdown",
        stepNumber: 1,
        title: "Clear centrepieces",
        detail: "Remove florals before linen count.",
        sortOrder: 0,
        createdAt: NOW,
      },
    ],
    roomFlipPlans: [
      {
        id: "00000000-0000-4000-8000-000000004088",
        handoffPackId: PACK_ID,
        phaseId: null,
        fromPhaseLabel: "Ceremony",
        toPhaseLabel: "Dinner",
        durationMinutes: 45,
        taskCount: 1,
        reviewGateCount: 1,
        notes: "Internal planning handoff only; live execution stays in event-day ops.",
        createdAt: NOW,
      },
    ],
    beoDocument: {
      id: "00000000-0000-4000-8000-000000004089",
      handoffPackId: PACK_ID,
      title: "Reception Room BEO internal handoff",
      body: "Internal BEO from approved planning snapshot. Guest routes, accessibility notes, supplier arrivals, and furniture counts require venue-team review before live execution.",
      sourceSnapshotHash: HASH,
      safeStatus: "internal_operations_handoff",
      createdAt: NOW,
    },
    snapshotDiff: {
      id: "00000000-0000-4000-8000-000000004090",
      handoffPackId: PACK_ID,
      previousSnapshotHash: null,
      currentSnapshotHash: HASH,
      addedCount: 2,
      removedCount: 0,
      changedCount: 1,
      summary: "Two setup rows added and chair quantity changed since the previous approved snapshot.",
      payload: {
        added: ["Accessible route check", "Florist arrival confirmation"],
        removed: [],
        changed: ["Gold Chiavari Chair: 112 -> 120"],
      },
      createdAt: NOW,
    },
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

async function mockSupplierShareRoutes(page: Page): Promise<void> {
  await page.route(`${API}/supplier-share/${SUPPLIER_TOKEN}`, (route) => {
    void route.fulfill({ json: { data: supplierPackFixture() } });
  });
  await page.route(`${API}/supplier-share/${SUPPLIER_TOKEN}/acknowledge`, (route) => {
    void route.fulfill({ status: 500, json: { error: "t469 supplier acknowledgement failure" } });
  });
}

async function mockProposalShareRoutes(page: Page): Promise<void> {
  await page.route(`${API}/proposal-share/${SHARE_TOKEN}`, (route) => {
    void route.fulfill({ json: { data: publicProposalFixture() } });
  });
  await page.route(`${API}/proposal-share/${SHARE_TOKEN}/comment`, (route) => {
    void route.fulfill({ status: 500, json: { error: "t469 proposal comment failure" } });
  });
  await page.route(`${API}/proposal-share/${SHARE_TOKEN}/approve`, (route) => {
    void route.fulfill({ status: 500, json: { error: "t469 proposal approval failure" } });
  });
}

async function mockEventDayRoutes(page: Page): Promise<void> {
  await page.route(`${API}/events/${EVENT_ID}/ops-board`, (route) => {
    void route.fulfill({ json: { data: eventDayBoardFixture() } });
  });
  await page.route(`${API}/events/${EVENT_ID}/change-feed**`, (route) => {
    void route.fulfill({ json: { data: [changeFeedFixture()] } });
  });
  await page.route(`${API}/events/${EVENT_ID}/change-acknowledgements`, (route) => {
    void route.fulfill({ status: 500, json: { error: "t469 change acknowledgement failure" } });
  });
  await page.route(`${API}/ops-tasks/${TASK_ID}/status`, (route) => {
    void route.fulfill({ json: { data: taskFixture("in_progress") } });
  });
  await page.route(`${API}/events/${EVENT_ID}/issues`, (route) => {
    void route.fulfill({ json: { data: eventDayIssueFixture() } });
  });
}

async function mockOnboardingRoutes(page: Page): Promise<void> {
  await page.route(`${API}/notifications**`, (route) => {
    void route.fulfill({ json: { data: [] } });
  });
  await page.route(`${API}/enquiries**`, (route) => {
    void route.fulfill({ json: { data: [] } });
  });
  await page.route(`${API}/venues/${VENUE_ID}`, (route) => {
    void route.fulfill({ json: { data: venueDetailFixture() } });
  });
  await page.route(`${API}/onboarding/summary`, (route) => {
    void route.fulfill({ json: { data: onboardingPopulatedSummaryFixture() } });
  });
  await page.route(`${API}/onboarding/projects/${ONBOARDING_PROJECT_ID}`, (route) => {
    void route.fulfill({ status: 500, json: { error: "t469 project gate failure" } });
  });
  await page.route(`${API}/onboarding/entitlements/${ONBOARDING_ENTITLEMENT_ID}/provider-verification`, (route) => {
    void route.fulfill({ status: 500, json: { error: "t469 provider gate failure" } });
  });
}

async function mockAdminRegistryRoutes(page: Page): Promise<void> {
  await page.route(`${API}/notifications**`, (route) => {
    void route.fulfill({ json: { data: [] } });
  });
  await page.route(`${API}/enquiries**`, (route) => {
    void route.fulfill({ json: { data: [] } });
  });
  await page.route(`${API}/venues`, (route) => {
    if (route.request().method() === "POST") {
      void route.fulfill({ status: 500, json: { error: "t469 create venue failure" } });
      return;
    }
    void route.fulfill({ json: { data: [venueFixture()] } });
  });
  await page.route(`${API}/venues/${VENUE_ID}`, (route) => {
    void route.fulfill({ json: { data: venueDetailFixture() } });
  });
}

interface AdminAssetRoomsRouteOptions {
  readonly failFirst?: boolean;
  readonly failAttempts?: number;
  readonly delayMs?: number;
  readonly gatedAttempts?: number;
  readonly firstResponseGate?: Promise<void>;
}

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

async function mockAdminAssetRoomsRoutes(page: Page, options: AdminAssetRoomsRouteOptions = {}): Promise<void> {
  let requestCount = 0;
  const failAttempts = options.failAttempts ?? (options.failFirst === true ? 1 : 0);
  const gatedAttempts = options.gatedAttempts ?? (options.firstResponseGate === undefined ? 0 : 1);
  await page.route(`${API}/admin/assets/rooms**`, async (route) => {
    requestCount += 1;
    if (requestCount <= gatedAttempts && options.firstResponseGate !== undefined) {
      await options.firstResponseGate;
    }
    if (options.delayMs !== undefined && options.delayMs > 0) {
      await wait(options.delayMs);
    }

    if (requestCount <= failAttempts) {
      await route.fulfill({ status: 500, json: { error: "t469 asset registry failure" } });
      return;
    }

    await route.fulfill({ json: { data: roomAssetStatusFixtures() } });
  });
}

async function mockOpsHandoffRoutes(page: Page, failPack = false): Promise<void> {
  await page.route(`${API}/ops/handoff-packs/${PACK_ID}`, (route) => {
    if (failPack) {
      void route.fulfill({ status: 500, json: { error: "t469 handoff unavailable" } });
      return;
    }
    void route.fulfill({ json: { data: opsHandoffBundleFixture() } });
  });
  await page.route(`${API}/ai/status`, (route) => {
    void route.fulfill({
      json: {
        data: {
          configured: false,
          provider: null,
          model: null,
          disabledReason: "AI drafts are disabled until provider environment is configured.",
        },
      },
    });
  });
}

function percentile(values: readonly number[], p: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1));
  return sorted[index] ?? 0;
}

function sustainedAbove(frames: readonly number[], thresholdMs: number): number {
  let current = 0;
  let max = 0;
  for (const frame of frames) {
    if (frame > thresholdMs) {
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

async function takeSmokeScreenshot(page: Page, screenshotPath: string): Promise<number> {
  await mkdir(dirname(screenshotPath), { recursive: true });
  const screenshot = await page.screenshot({ path: screenshotPath, fullPage: false });
  expect(screenshot.byteLength, `${screenshotPath} should not be a blank or tiny screenshot`).toBeGreaterThan(12_000);
  return screenshot.byteLength;
}

async function assertNoRuntimeBreakage(page: Page, problems: PageProblems): Promise<void> {
  await expect(page.locator("vite-error-overlay")).toHaveCount(0);
  await expect(page.getByText(/Internal Server Error|Failed to fetch dynamically imported module/u)).toHaveCount(0);
  expect(problems.pageErrors).toEqual([]);
  expect(problems.consoleErrors).toEqual([]);
}

async function recordFrameAndVisualState(
  page: Page,
  problems: PageProblems,
  name: string,
  viewport: OperationalViewportName,
  interaction: () => Promise<void>,
): Promise<void> {
  const screenshotPath = `${ARTIFACT_DIR}/${viewport}-${name}.png`;
  await page.waitForTimeout(250);
  await assertNoRuntimeBreakage(page, problems);
  const screenshotBytes = await takeSmokeScreenshot(page, screenshotPath);
  await expect(page).toHaveScreenshot(`${viewport}-${name}.png`, {
    animations: "disabled",
    fullPage: false,
    maxDiffPixelRatio: 0.02,
    threshold: 0.2,
  });

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
    screenshotPath,
    screenshotBytes,
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
  viewport: OperationalViewportName,
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
  await page.evaluate(() => {
    const active = document.activeElement;
    if (active instanceof HTMLElement || active instanceof SVGElement) active.blur();
  });
}

test.describe.configure({ mode: "serial" });

test.afterAll(async () => {
  await mkdir(dirname(REPORT_PATH), { recursive: true });
  await writeFile(REPORT_PATH, `${JSON.stringify({
    generatedAt: new Date().toISOString(),
    targetFrameMs: TARGET_FRAME_MS,
    passP95Ms: PASS_P95_MS,
    maxSustainedOverBudget: MAX_SUSTAINED_OVER_BUDGET,
    sampleMs: SAMPLE_MS,
    results,
    accessibilityResults,
  }, null, 2)}\n`, "utf8");
});

test.describe("T-469 operational route visual and CDP frame-budget pass", () => {
  test("supplier portal acknowledgement error stays visually stable and within frame budget", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.emulateMedia({ reducedMotion: "reduce" });
    const problems = watchPageProblems(page);
    await mockSupplierShareRoutes(page);

    await page.goto(`/supplier-share/${SUPPLIER_TOKEN}`);
    await expect(page.getByRole("heading", { name: "Florist coordination handoff" })).toBeVisible();
    await page.getByLabel("Name").fill("Jordan Florist");
    await page.getByLabel("Email").fill("jordan@petal.test");
    await page.getByRole("button", { name: "Acknowledge handoff" }).click();
    await expect(page.getByRole("alert")).toContainText("We could not send this supplier response");
    await recordAccessibilityState(page, problems, "supplier acknowledgement error", `/supplier-share/${SUPPLIER_TOKEN}`, "desktop", 16);

    await recordFrameAndVisualState(page, problems, "supplier-acknowledgement-error", "desktop", async () => {
      await page.mouse.move(1000, 640);
      await page.mouse.wheel(0, 360);
      await page.mouse.wheel(0, -180);
    });
  });

  test("proposal share comment error stays visually stable and within frame budget", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.emulateMedia({ reducedMotion: "reduce" });
    const problems = watchPageProblems(page);
    await mockProposalShareRoutes(page);

    await page.goto(`/proposal-share/${SHARE_TOKEN}`);
    await expect(page.getByRole("heading", { name: "Reception Room wedding proposal" })).toBeVisible();
    await page.getByTestId("comment-input").fill("Could we keep the main-door route wider for older guests?");
    await page.getByTestId("comment-submit").click();
    await expect(page.getByRole("alert")).toContainText("We couldn't post your comment");

    await recordFrameAndVisualState(page, problems, "proposal-share-comment-error", "desktop", async () => {
      await page.mouse.move(720, 730);
      await page.mouse.wheel(0, 260);
      await page.keyboard.press("Tab");
    });
    await recordAccessibilityState(page, problems, "proposal share comment error", `/proposal-share/${SHARE_TOKEN}`, "desktop", 16);
  });

  test("event-day ops acknowledgement failure stays mobile-stable and within frame budget", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.emulateMedia({ reducedMotion: "reduce" });
    const problems = watchPageProblems(page);
    await seedAuthenticatedUser(page, "hallkeeper");
    await mockEventDayRoutes(page);

    await page.goto(`/ops/events/${EVENT_ID}`);
    await expect(page.getByRole("heading", { name: "Wilson wedding" })).toBeVisible();
    await page.getByRole("button", { name: "Acknowledge change" }).click();
    await expect(page.getByText("Change acknowledgement could not be saved.")).toBeVisible();

    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    expect(overflow, "event-day mobile acknowledgement error should not horizontally overflow").toBeLessThanOrEqual(1);

    await recordFrameAndVisualState(page, problems, "event-day-acknowledgement-error", "mobile", async () => {
      await page.mouse.wheel(0, 320);
      await page.keyboard.press("Tab");
    });
    await recordAccessibilityState(page, problems, "event-day acknowledgement failure", `/ops/events/${EVENT_ID}`, "mobile", 14);
  });

  test("protected ops handoff pack stays visually stable and within frame budget", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.emulateMedia({ reducedMotion: "reduce" });
    const problems = watchPageProblems(page);
    await seedAuthenticatedUser(page, "staff");
    await mockOpsHandoffRoutes(page);

    await page.goto(`/ops/handoff/${PACK_ID}`);
    await expect(page.getByRole("heading", { name: "Ops handoff pack" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Print / export" })).toBeVisible();
    await expect(page.getByText("Runtime asset")).toHaveCount(0);

    await recordFrameAndVisualState(page, problems, "ops-handoff-ready", "desktop", async () => {
      await page.mouse.move(940, 690);
      await page.mouse.wheel(0, 440);
      await page.mouse.wheel(0, -220);
      await page.keyboard.press("Tab");
    });
    await recordAccessibilityState(page, problems, "ops handoff ready state", `/ops/handoff/${PACK_ID}`, "desktop", 18);
  });

  test("protected ops handoff unavailable state stays mobile-stable and within frame budget", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.emulateMedia({ reducedMotion: "reduce" });
    const problems = watchPageProblems(page);
    await seedAuthenticatedUser(page, "planner");
    await mockOpsHandoffRoutes(page, true);

    await page.goto(`/ops/handoff/${PACK_ID}`);
    await expect(page.getByRole("heading", { name: "Handoff pack unavailable" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Retry" })).toBeVisible();

    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    expect(overflow, "ops handoff mobile unavailable state should not horizontally overflow").toBeLessThanOrEqual(1);

    await recordFrameAndVisualState(page, problems, "ops-handoff-unavailable", "mobile", async () => {
      await page.mouse.wheel(0, 240);
      await page.keyboard.press("Tab");
    });
    await recordAccessibilityState(page, problems, "ops handoff unavailable state", `/ops/handoff/${PACK_ID}`, "mobile", 10);
  });

  test("protected asset room registry success state stays visually stable and within frame budget", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.emulateMedia({ reducedMotion: "reduce" });
    const problems = watchPageProblems(page);
    await seedAuthenticatedUser(page, "platform-admin");
    await mockAdminAssetRoomsRoutes(page);

    await page.goto("/dev/assets/rooms");
    await expect(page.getByRole("heading", { name: "Trades Hall runtime rooms" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Reception Room" })).toBeVisible();
    await expect(page.getByText("Runtime asset loaded, not yet verified/signed.")).toBeVisible();
    await expect(page.getByText("Coordinate pairs 0 / 4")).toBeVisible();
    await expect(page.getByText(/spz_with_mesh|textSplats|approved public/u)).toHaveCount(0);
    await expect(page.getByRole("link", { name: "Open room view for Reception Room" })).toHaveAttribute(
      "href",
      "/dev/trades-hall-visual?venue=trades-hall&room=reception-room",
    );

    await recordFrameAndVisualState(page, problems, "asset-rooms-success", "desktop", async () => {
      await page.mouse.move(940, 710);
      await page.mouse.wheel(0, 520);
      await page.mouse.wheel(0, -260);
      await page.keyboard.press("Tab");
    });
    await recordAccessibilityState(page, problems, "asset rooms success state", "/dev/assets/rooms", "desktop", 18);
  });

  test("protected asset room registry loading and error state stays tablet-stable and retryable", async ({ page }) => {
    await page.setViewportSize({ width: 900, height: 1180 });
    await page.emulateMedia({ reducedMotion: "reduce" });
    const problems = watchPageProblems(page);
    await seedAuthenticatedUser(page, "platform-admin");
    let releaseFirstResponse: () => void = () => undefined;
    const firstResponseGate = new Promise<void>((resolve) => {
      releaseFirstResponse = resolve;
    });
    await mockAdminAssetRoomsRoutes(page, {
      failAttempts: 2,
      gatedAttempts: 2,
      firstResponseGate,
    });

    const navigation = page.goto("/dev/assets/rooms");
    await expect(page.getByText("Loading room runtime status.")).toBeVisible();
    releaseFirstResponse();
    await navigation;
    await expect(page.getByRole("alert")).toContainText("Asset status unavailable.");
    await expect(page.getByRole("alert")).toContainText("t469 asset registry failure");
    await expect(page.getByRole("button", { name: "Retry asset registry" })).toBeVisible();

    await recordFrameAndVisualState(page, problems, "asset-rooms-error", "tablet", async () => {
      await page.mouse.move(520, 420);
      await page.keyboard.press("Tab");
    });
    await recordAccessibilityState(page, problems, "asset rooms loading and error state", "/dev/assets/rooms", "tablet", 10);

    await page.getByRole("button", { name: "Retry asset registry" }).click();
    await expect(page.getByRole("heading", { name: "Reception Room" })).toBeVisible();
    await expect(page.getByText("Runtime asset loaded, not yet verified/signed.")).toBeVisible();
  });

  test("protected asset room registry role-denied state stays mobile-stable and within frame budget", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.emulateMedia({ reducedMotion: "reduce" });
    const problems = watchPageProblems(page);
    await seedAuthenticatedUser(page, "planner");

    await page.goto("/dev/assets/rooms");
    await expect(page.getByRole("heading", { name: "This workspace is not available to your role" })).toBeVisible();
    await expect(page.getByText("You are signed in as planner.")).toBeVisible();

    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    expect(overflow, "asset registry mobile denied state should not horizontally overflow").toBeLessThanOrEqual(1);

    await recordFrameAndVisualState(page, problems, "asset-rooms-role-denied", "mobile", async () => {
      await page.mouse.wheel(0, 120);
      await page.keyboard.press("Tab");
    });
    await recordAccessibilityState(page, problems, "asset rooms role-denied state", "/dev/assets/rooms", "mobile", 8);
  });

  test("onboarding project-gate mutation failure stays tablet-stable and within frame budget", async ({ page }) => {
    await page.setViewportSize({ width: 900, height: 1180 });
    await page.emulateMedia({ reducedMotion: "reduce" });
    const problems = watchPageProblems(page);
    await seedAuthenticatedUser(page, "platform-admin");
    await mockOnboardingRoutes(page);

    await page.goto("/dashboard?view=onboarding");
    await page.waitForSelector("#dashboard-main", { timeout: 15_000 });
    await expect(page.getByRole("heading", { name: "Operator action board" })).toBeVisible();
    await page.getByRole("button", { name: "Save project gate for Trades Hall deployment" }).click();
    await expect(page.getByRole("alert")).toContainText("t469 project gate failure");

    await recordFrameAndVisualState(page, problems, "onboarding-project-gate-error", "tablet", async () => {
      await page.mouse.move(690, 920);
      await page.mouse.wheel(0, 420);
      await page.mouse.wheel(0, -210);
    });
    await recordAccessibilityState(page, problems, "onboarding project-gate mutation failure", "/dashboard?view=onboarding", "tablet", 16);
  });

  test("admin venue-create mutation failure stays visually stable and within frame budget", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.emulateMedia({ reducedMotion: "reduce" });
    const problems = watchPageProblems(page);
    await seedAuthenticatedUser(page, "platform-admin");
    await mockAdminRegistryRoutes(page);

    await page.goto("/dashboard?view=admin");
    await page.waitForSelector("#dashboard-main", { timeout: 15_000 });
    await page.getByRole("button", { name: "New Venue" }).click();
    await page.getByLabel("Venue Name").fill("Trades Hall Annex");
    await page.getByLabel("Address").fill("85 Glassford Street, Glasgow G1 1UH");
    await page.getByRole("button", { name: "Create Venue" }).click();
    await expect(page.getByText("t469 create venue failure")).toBeVisible();

    await recordFrameAndVisualState(page, problems, "admin-create-venue-error", "desktop", async () => {
      await page.mouse.move(740, 632);
      await page.mouse.move(855, 632);
    });
    await recordAccessibilityState(page, problems, "admin create-venue mutation failure", "/dashboard?view=admin", "desktop", 12);
  });
});
