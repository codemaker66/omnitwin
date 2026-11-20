import { expect, test, type Page } from "@playwright/test";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import type {
  Notification,
  VenueDashboardAnalytics,
} from "@omnitwin/types";
import type { PublicProposalPayload } from "../src/api/proposals.js";
import type { SupplierSafePackView } from "../src/api/supplier-coordination.js";
import {
  collectAccessibilityAudit,
  expectAccessibilityAuditClean,
  watchPageProblems,
  type AccessibilityAuditResult,
  type AccessibilityViewport,
  type ContrastTarget,
} from "./support/accessibility-audit.js";

const API = "http://localhost:3001";
const NOW = "2026-06-20T09:00:00.000Z";
const VENUE_ID = "00000000-0000-4000-8000-000000004001";
const EVENT_ID = "00000000-0000-4000-8000-000000004003";
const CHANGE_ID = "00000000-0000-4000-8000-000000004006";
const NOTIFICATION_ID = "00000000-0000-4000-8000-000000004009";
const PROPOSAL_TOKEN = "t469-accessibility-proposal";
const SUPPLIER_TOKEN = "t469-accessibility-supplier";
const GUEST_LIST_PLAN_ID = "00000000-0000-4000-8000-000000004070";
const HASH = "b".repeat(64);

// Fresh fixtures per case; a failure must not skip other routes or viewports.
test.describe.configure({ mode: "default" });

type SeedRole = "staff" | "planner" | "hallkeeper" | "admin" | "platform-admin" | "manager" | "supplier";

interface RouteSpec {
  readonly routeName: string;
  readonly path: string;
  readonly readyText: string | RegExp;
  readonly readyRole?: "heading";
  readonly seedRole?: SeedRole;
  /** "client" holds body text to 7:1 (goals/01): every page a client, couple
   *  or supplier reads. Staff tools stay at the AA floor. */
  readonly contrastTarget?: ContrastTarget;
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
      manager: "95",
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

function publicProposalFixture(): PublicProposalPayload {
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
      { kind: "comment", authorName: "Venue team", body: "We can adjust the arrival time.", createdAt: NOW, from: "venue" },
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
    // The shell's nav chip reads /notifications/unread-count, as the API serves it.
    if (new URL(route.request().url()).pathname === "/notifications/unread-count") {
      void route.fulfill({ json: { data: { unread: 1 } } });
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
    // The shell's nav chip reads /notifications/unread-count, as the API serves it.
    if (new URL(route.request().url()).pathname === "/notifications/unread-count") {
      void route.fulfill({ json: { data: { unread: 0 } } });
      return;
    }
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

async function mockGuestListPlanRoutes(page: Page): Promise<void> {
  // The guest list's one request: the read of the plan, to count the room's tables.
  await page.route(`${API}/public/configurations/${GUEST_LIST_PLAN_ID}`, (route) => {
    void route.fulfill({
      json: {
        data: {
          id: GUEST_LIST_PLAN_ID,
          venueId: VENUE_ID,
          spaceId: "00000000-0000-4000-8000-000000004002",
          userId: null,
          name: "Grand Hall dinner",
          isPublicPreview: true,
          revision: 1,
          objects: [],
        },
      },
    });
  });
}

// The kit's own storage, as lib/idb-cache.ts and lib/guest-list/store.ts keep it: database
// "venviewer-guest-lists" at version 1, object store "lists" with out-of-line keys, the plan's id as the key, and
// the list wrapped as { storedAt, value }.
const GUEST_LIST_DB = "venviewer-guest-lists";
const GUEST_LIST_STORE = "lists";
const DAY_MS = 86_400_000;

function guestListId(n: number): string {
  return `00000000-0000-4000-8000-${String(4100 + n).padStart(12, "0")}`;
}

/** Invented guests: ten seated at two of three tables, two still to seat, printed once and changed since. */
function seatedGuestList(now: Date): Record<string, unknown> {
  const names = [
    "Ailsa Fraser", "Chidi Okafor", "Morag Kerr", "Ewan Shaw", "Iona Campbell", "Fergus Nowak",
    "Catriona Haddad", "Lachlan Murray", "Eilidh Baird", "Duncan Reid", "Brodie Lennox", "Isla Darroch",
  ];
  const tables = [
    { id: guestListId(1), number: 1, name: "Top table", seats: 10 },
    { id: guestListId(2), number: 2, name: "", seats: 10 },
    { id: guestListId(3), number: 3, name: "", seats: 8 },
  ];
  const guests = names.map((name, at) => {
    const tableId = at < 6 ? guestListId(1) : at < 10 ? guestListId(2) : null;
    const seat = at < 6 ? at + 1 : at < 10 ? at - 5 : null;
    return { id: guestListId(100 + at), name, party: at < 2 ? "Fraser and Okafor" : "", tableId, seat };
  });
  return {
    version: 1,
    planId: GUEST_LIST_PLAN_ID,
    title: "Fraser and Okafor wedding",
    eventDate: new Date(now.getTime() + 60 * DAY_MS).toISOString().slice(0, 10),
    sortBy: "last-word",
    guests,
    tables,
    paperVersion: 1,
    changedSincePrint: true,
    printedAt: new Date(now.getTime() - DAY_MS).toISOString(),
    updatedAt: now.toISOString(),
  };
}

/** Puts a seated list into the page's own storage before the app runs, as a planner's browser would hold it. */
async function seedSeatedGuestList(page: Page): Promise<void> {
  const now = new Date();
  await page.addInitScript(({ dbName, storeName, key, record }) => {
    const request = indexedDB.open(dbName, 1);
    request.onupgradeneeded = () => { request.result.createObjectStore(storeName); };
    request.onsuccess = () => {
      const db = request.result;
      const write = db.transaction(storeName, "readwrite");
      write.objectStore(storeName).put(record, key);
      write.oncomplete = () => { db.close(); };
    };
  }, {
    dbName: GUEST_LIST_DB,
    storeName: GUEST_LIST_STORE,
    key: GUEST_LIST_PLAN_ID,
    record: { storedAt: now.toISOString(), value: seatedGuestList(now) },
  });
}

async function mockSeatedGuestListRoutes(page: Page): Promise<void> {
  await mockGuestListPlanRoutes(page);
  await seedSeatedGuestList(page);
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
  const ready = spec.readyRole === "heading"
    ? page.getByRole("heading", { name: spec.readyText, exact: true })
    : page.getByText(spec.readyText).first();
  await expect(ready).toBeVisible({ timeout: 15_000 });
  await page.waitForLoadState("networkidle").catch(() => undefined);

  const result = await collectAccessibilityAudit(page, {
    name: spec.routeName,
    path: spec.path,
    problems,
    viewport,
    maxFocusSteps: viewport.name === "mobile" ? 14 : 18,
    contrastTarget: spec.contrastTarget ?? "standard",
  });
  auditResults.push(result);
  expectAccessibilityAuditClean(result);

  return result;
}

const routeSpecs: readonly RouteSpec[] = [
  {
    routeName: "public rooms home",
    contrastTarget: "client",
    path: "/",
    readyText: "Grand Hall",
    readyRole: "heading",
    mockRoutes: mockNoRoutes,
  },
  {
    // T-616: the Rite left its public address (Blake, 26 September 2026) and
    // /landing now forwards to the front door, which is what a stale link
    // reaches and what this audits. The name is kept: it names the address.
    routeName: "the rite (previous landing)",
    contrastTarget: "client",
    path: "/landing",
    readyText: "Grand Hall",
    readyRole: "heading",
    mockRoutes: mockNoRoutes,
  },
  {
    // Admin-only until billing exists (Blake, 26 September 2026), so the
    // audit reads it as an admin does. The name is kept: it names the page.
    routeName: "public pricing",
    path: "/pricing",
    // The trial CTA is gone by design (no billing exists to honour it); the
    // page's own heading is what says it is ready.
    readyText: "Pricing",
    readyRole: "heading",
    seedRole: "admin",
    mockRoutes: mockNoRoutes,
  },
  {
    routeName: "dashboard executive analytics",
    path: "/dashboard?view=analytics",
    readyText: "Executive analytics",
    readyRole: "heading",
    seedRole: "manager",
    mockRoutes: mockDashboardRoutes,
  },
  {
    routeName: "dashboard analytics error",
    path: "/dashboard?view=analytics",
    readyText: "Analytics unavailable",
    seedRole: "manager",
    mockRoutes: mockDashboardErrorRoutes,
  },
  {
    routeName: "proposal share",
    contrastTarget: "client",
    path: `/proposal-share/${PROPOSAL_TOKEN}`,
    readyText: "Reception Room wedding proposal",
    mockRoutes: mockProposalRoutes,
  },
  {
    routeName: "proposal share unavailable",
    contrastTarget: "client",
    path: `/proposal-share/${PROPOSAL_TOKEN}-missing`,
    readyText: "This proposal link isn't available",
    mockRoutes: mockProposalUnavailableRoutes,
  },
  {
    routeName: "supplier portal",
    contrastTarget: "client",
    path: `/supplier-share/${SUPPLIER_TOKEN}`,
    readyText: "Florist coordination handoff",
    mockRoutes: mockSupplierRoutes,
  },
  {
    routeName: "supplier portal unavailable",
    contrastTarget: "client",
    path: `/supplier-share/${SUPPLIER_TOKEN}-missing`,
    readyText: "This link no longer opens",
    mockRoutes: mockSupplierUnavailableRoutes,
  },
  {
    // T-616 retired the room showcase: its address forwards to the front
    // door, whose rail and capacity table now carry the Reception Room.
    routeName: "public Reception Room",
    contrastTarget: "client",
    path: "/venues/trades-hall/rooms/reception-room",
    readyText: "Grand Hall",
    readyRole: "heading",
    mockRoutes: mockNoRoutes,
  },
  {
    // A room address that does not exist meets the designed not-found page
    // (T-616) rather than silently becoming the homepage.
    routeName: "public room unavailable",
    contrastTarget: "client",
    path: "/rooms/not-a-room",
    readyText: "There is no page at this address",
    readyRole: "heading",
    mockRoutes: mockNoRoutes,
  },
  {
    // The planner's kit (stage 1a): a plan's guest list, kept only on this
    // device and answering only behind its switch. Audited as a planner first
    // meets it: an empty list, with the paste box open.
    routeName: "the planner's guest list",
    contrastTarget: "client",
    path: `/plan/${GUEST_LIST_PLAN_ID}/guests?kit=on`,
    readyText: "There are no guests on this list yet.",
    mockRoutes: mockGuestListPlanRoutes,
  },
  {
    // The same page holding a seated list, put in the page's own storage
    // before it opens: the counts, the tables, two guests still to seat and a
    // print that is out of date.
    routeName: "the planner's guest list, seated",
    contrastTarget: "client",
    path: `/plan/${GUEST_LIST_PLAN_ID}/guests?kit=on`,
    readyText: "10 of 12 guests have a seat.",
    mockRoutes: mockSeatedGuestListRoutes,
  },
  {
    // The paper for that list: the table plan sheet, with the tools above it
    // saying how many guests have no seat. It asks nothing of the server.
    routeName: "the planner's paper, a seated list's table plan",
    contrastTarget: "client",
    path: `/plan/${GUEST_LIST_PLAN_ID}/guests/paper?kit=on&sheet=table-plan`,
    readyText: "Please find your table",
    mockRoutes: seedSeatedGuestList,
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
  const reportPath = test.info().outputPath("accessibility-route-audit.json");
  await mkdir(dirname(reportPath), { recursive: true });
  await writeFile(
    reportPath,
    `${JSON.stringify({
      generatedAt: new Date().toISOString(),
      routeStateCount: routeSpecs.length,
      viewportCount: accessibilityViewports.length,
      sampleCount: auditResults.length,
      routes: auditResults,
    }, null, 2)}\n`,
    "utf8",
  );
  await test.info().attach("accessibility-route-audit", {
    path: reportPath,
    contentType: "application/json",
  });
});
