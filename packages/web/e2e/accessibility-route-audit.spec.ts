import { expect, test, type Page } from "@playwright/test";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import type {
  Notification,
  PublicRoomRuntimeVisual,
  VenueDashboardAnalytics,
} from "@omnitwin/types";
import type { PublicProposal } from "../src/api/proposals.js";
import type { SupplierSafePackView } from "../src/api/supplier-coordination.js";
import {
  collectAccessibilityAudit,
  expectAccessibilityAuditClean,
  watchPageProblems,
  type AccessibilityAuditResult,
  type AccessibilityViewport,
} from "./support/accessibility-audit.js";

const API = "http://localhost:3001";
const NOW = "2026-06-20T09:00:00.000Z";
const VENUE_ID = "00000000-0000-4000-8000-000000004001";
const EVENT_ID = "00000000-0000-4000-8000-000000004003";
const CHANGE_ID = "00000000-0000-4000-8000-000000004006";
const NOTIFICATION_ID = "00000000-0000-4000-8000-000000004009";
const PROPOSAL_TOKEN = "t469-accessibility-proposal";
const SUPPLIER_TOKEN = "t469-accessibility-supplier";
const HASH = "b".repeat(64);
const ARTIFACT_DIR = "C:/Users/blake/omnitwin2/artifacts/t469-accessibility-route-audit-2026-06-20";
const REPORT_PATH = `${ARTIFACT_DIR}/report.json`;

test.describe.configure({ mode: "serial" });

type SeedRole = "staff" | "planner" | "hallkeeper" | "admin" | "platform-admin" | "executive" | "supplier";

interface RouteSpec {
  readonly routeName: string;
  readonly path: string;
  readonly readyText: string | RegExp;
  readonly seedRole?: SeedRole;
  readonly mockRoutes: (page: Page) => Promise<void>;
}

const auditResults: AccessibilityAuditResult[] = [];

const accessibilityViewports: readonly AccessibilityViewport[] = [
  { name: "desktop", width: 1440, height: 900 },
  { name: "tablet", width: 1024, height: 768 },
  { name: "mobile", width: 390, height: 844 },
];

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
        email: `${seedRole}@t469-accessibility.test`,
        role: venueRole,
        platformRole: isPlatformAdmin ? "admin" : "none",
        venueId: isPlatformAdmin ? null : venueId,
        name: `${seedRole[0]?.toUpperCase() ?? "U"}${seedRole.slice(1)} Accessibility`,
      },
      writable: false,
    });
  }, { seedRole: role, venueId: VENUE_ID });
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

function analyticsFixture(): VenueDashboardAnalytics {
  return {
    generatedAt: NOW,
    currency: "GBP",
    pipelineValueMinor: 1_250_000,
    enquiryConversionPercent: 42,
    proposalStatusCounts: {
      draft: 1,
      sent: 2,
      accepted: 1,
      changes_requested: 1,
    },
    roomUtilisation: [{
      spaceId: "00000000-0000-4000-8000-000000004002",
      roomName: "Grand Hall",
      bookedEvents: 2,
      proposedEvents: 5,
      utilisationPercent: 40,
      reviewBottlenecks: 3,
    }],
    revenueScenarios: [{
      id: "00000000-0000-4000-8000-000000004050",
      venueId: VENUE_ID,
      eventId: null,
      configurationId: null,
      quoteId: null,
      name: "Dinner upsell option",
      scenarioKind: "manual",
      status: "draft",
      currency: "GBP",
      plannedGuestCount: 120,
      estimatedRevenueMinor: 1_250_000,
      estimatedCostMinor: 420_000,
      estimatedMarginMinor: 830_000,
      comfortStatus: "warning",
      reviewGateCount: 2,
      createdBy: null,
      createdAt: NOW,
      updatedAt: NOW,
    }],
    comfortFloorWarnings: ["Aisle spacing needs review."],
    reviewBottlenecks: ["Dinner upsell option: 2 review gate(s)"],
    disclosure: "Commercial planning insight - review constraints preserved",
  };
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
    expiresAt: "2026-06-21T12:00:00.000Z",
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

function publicRoomVisualFixture(): PublicRoomRuntimeVisual {
  return {
    venueSlug: "trades-hall",
    roomSlug: "reception-room",
    runtimeVisualAvailable: false,
    visualUrl: null,
    visualLabel: "Runtime asset staged internally",
    safeCopy: "Runtime asset loaded, not yet verified/signed.",
    humanReviewRequired: true,
  };
}

async function mockDashboardRoutes(page: Page): Promise<void> {
  await page.route(`${API}/venues/${VENUE_ID}`, (route) => {
    void route.fulfill({
      json: {
        data: {
          id: VENUE_ID,
          name: "Trades Hall Glasgow",
          slug: "trades-hall",
          address: "85 Glassford Street",
          logoUrl: null,
          brandColour: null,
          spaces: [],
        },
      },
    });
  });
  await page.route(`${API}/notifications**`, (route) => {
    if (route.request().method() === "PATCH") {
      void route.fulfill({ json: { data: notificationFixture(NOW) } });
      return;
    }
    void route.fulfill({ json: { data: [notificationFixture()] } });
  });
  await page.route(`${API}/analytics/venue-dashboard**`, (route) => {
    void route.fulfill({ json: { data: analyticsFixture() } });
  });
}

async function mockDashboardErrorRoutes(page: Page): Promise<void> {
  await page.route(`${API}/venues/${VENUE_ID}`, (route) => {
    void route.fulfill({
      json: {
        data: {
          id: VENUE_ID,
          name: "Trades Hall Glasgow",
          slug: "trades-hall",
          address: "85 Glassford Street",
          logoUrl: null,
          brandColour: null,
          spaces: [],
        },
      },
    });
  });
  await page.route(`${API}/notifications**`, (route) => {
    void route.fulfill({ json: { data: [] } });
  });
  await page.route(`${API}/analytics/venue-dashboard**`, (route) => {
    void route.fulfill({ status: 500, json: { error: "t469 analytics unavailable" } });
  });
}

async function mockProposalRoutes(page: Page): Promise<void> {
  await page.route(`${API}/proposal-share/${PROPOSAL_TOKEN}`, (route) => {
    void route.fulfill({ json: { data: publicProposalFixture() } });
  });
  await page.route(`${API}/proposal-share/${PROPOSAL_TOKEN}/comment`, (route) => {
    void route.fulfill({ json: { data: { kind: "comment", authorName: "Client", body: "Please adjust timing.", createdAt: NOW } } });
  });
  await page.route(`${API}/proposal-share/${PROPOSAL_TOKEN}/approve`, (route) => {
    void route.fulfill({ json: { data: { status: "accepted" } } });
  });
}

async function mockProposalUnavailableRoutes(page: Page): Promise<void> {
  await page.route(`${API}/proposal-share/${PROPOSAL_TOKEN}-missing`, (route) => {
    void route.fulfill({ status: 404, json: { error: "proposal unavailable" } });
  });
}

async function mockSupplierRoutes(page: Page): Promise<void> {
  await page.route(`${API}/supplier-share/${SUPPLIER_TOKEN}`, (route) => {
    void route.fulfill({ json: { data: supplierPackFixture() } });
  });
  await page.route(`${API}/supplier-share/${SUPPLIER_TOKEN}/acknowledge`, (route) => {
    void route.fulfill({
      json: {
        data: {
          id: "00000000-0000-4000-8000-000000004060",
          supplierShareId: "00000000-0000-4000-8000-000000004061",
          status: "acknowledged",
          acknowledgedByName: "Supplier Contact",
          acknowledgedByEmail: "supplier@example.test",
          note: null,
          createdAt: NOW,
        },
      },
    });
  });
}

async function mockSupplierUnavailableRoutes(page: Page): Promise<void> {
  await page.route(`${API}/supplier-share/${SUPPLIER_TOKEN}-missing`, (route) => {
    void route.fulfill({ status: 404, json: { error: "supplier handoff unavailable" } });
  });
}

async function mockPublicRoomRoutes(page: Page): Promise<void> {
  await page.route(`${API}/assets/runtime-packages/public-room-visual**`, (route) => {
    void route.fulfill({ json: { data: publicRoomVisualFixture() } });
  });
}

function mockNoRoutes(_page: Page): Promise<void> {
  return Promise.resolve();
}

async function runRouteAudit(page: Page, spec: RouteSpec, viewport: AccessibilityViewport): Promise<AccessibilityAuditResult> {
  await page.setViewportSize({ width: viewport.width, height: viewport.height });
  const problems = watchPageProblems(page);
  await page.emulateMedia({ reducedMotion: "reduce" });
  await spec.mockRoutes(page);
  if (spec.seedRole !== undefined) {
    await seedAuthenticatedUser(page, spec.seedRole);
  }

  await page.goto(spec.path);
  await expect(page.getByText(spec.readyText).first()).toBeVisible({ timeout: 15_000 });
  await page.waitForLoadState("networkidle").catch(() => undefined);

  const result = await collectAccessibilityAudit(page, {
    name: spec.routeName,
    path: spec.path,
    problems,
    viewport,
    maxFocusSteps: viewport.name === "mobile" ? 14 : 18,
  });
  auditResults.push(result);
  expectAccessibilityAuditClean(result);

  return result;
}

const routeSpecs: readonly RouteSpec[] = [
  {
    routeName: "public landing",
    path: "/",
    readyText: "Design your event for the Grand Hall.",
    mockRoutes: mockNoRoutes,
  },
  {
    routeName: "public pricing",
    path: "/pricing",
    readyText: "Start your 14-day free trial",
    mockRoutes: mockNoRoutes,
  },
  {
    routeName: "dashboard executive analytics",
    path: "/dashboard?view=analytics",
    readyText: "Commercial planning dashboard",
    seedRole: "executive",
    mockRoutes: mockDashboardRoutes,
  },
  {
    routeName: "dashboard analytics error",
    path: "/dashboard?view=analytics",
    readyText: "Analytics unavailable",
    seedRole: "executive",
    mockRoutes: mockDashboardErrorRoutes,
  },
  {
    routeName: "proposal share",
    path: `/proposal-share/${PROPOSAL_TOKEN}`,
    readyText: "Reception Room wedding proposal",
    mockRoutes: mockProposalRoutes,
  },
  {
    routeName: "proposal share unavailable",
    path: `/proposal-share/${PROPOSAL_TOKEN}-missing`,
    readyText: "This proposal link isn't available",
    mockRoutes: mockProposalUnavailableRoutes,
  },
  {
    routeName: "supplier portal",
    path: `/supplier-share/${SUPPLIER_TOKEN}`,
    readyText: "Florist coordination handoff",
    mockRoutes: mockSupplierRoutes,
  },
  {
    routeName: "supplier portal unavailable",
    path: `/supplier-share/${SUPPLIER_TOKEN}-missing`,
    readyText: "This supplier link is not available",
    mockRoutes: mockSupplierUnavailableRoutes,
  },
  {
    routeName: "public Reception Room",
    path: "/venues/trades-hall/rooms/reception-room",
    readyText: "Reception Room",
    mockRoutes: mockPublicRoomRoutes,
  },
  {
    routeName: "public room unavailable",
    path: "/venues/trades-hall/rooms/not-a-room",
    readyText: "Room preview unavailable",
    mockRoutes: mockNoRoutes,
  },
];

for (const viewport of accessibilityViewports) {
  for (const spec of routeSpecs) {
    test(`${spec.routeName} has named controls, landmarks, reduced motion, contrast, and focus-visible at ${viewport.name}`, async ({ page }) => {
      await runRouteAudit(page, spec, viewport);
    });
  }
}

test.afterAll(async () => {
  await mkdir(dirname(REPORT_PATH), { recursive: true });
  await writeFile(
    REPORT_PATH,
    `${JSON.stringify({
      generatedAt: new Date().toISOString(),
      routeStateCount: routeSpecs.length,
      viewportCount: accessibilityViewports.length,
      sampleCount: auditResults.length,
      routes: auditResults,
    }, null, 2)}\n`,
    "utf8",
  );
});
