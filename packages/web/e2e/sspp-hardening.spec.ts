import { expect, test, type Page } from "@playwright/test";
import type {
  EventDayOpsBoard,
  OpsTask,
  VenueDashboardAnalytics,
} from "@omnitwin/types";
import type { PublicProposal } from "../src/api/proposals.js";

const API = "http://localhost:3001";
const NOW = "2026-06-12T09:00:00.000Z";
const CONFIG_ID = "e2e-hardening-plan";
const VENUE_ID = "00000000-0000-4000-8000-000000004001";
const SPACE_ID = "00000000-0000-4000-8000-000000004002";
const EVENT_ID = "00000000-0000-4000-8000-000000004003";
const PACK_ID = "00000000-0000-4000-8000-000000004004";
const TASK_ID = "00000000-0000-4000-8000-000000004005";
const HASH = "c".repeat(64);

function collectPageErrors(page: Page): readonly string[] {
  const errors: string[] = [];
  page.on("pageerror", (error) => {
    errors.push(error.message);
  });
  return errors;
}

async function attachScreenshotSmoke(page: Page, name: string): Promise<void> {
  const screenshot = await page.screenshot({ fullPage: false });
  expect(screenshot.byteLength).toBeGreaterThan(15_000);
  await test.info().attach(name, {
    body: screenshot,
    contentType: "image/png",
  });
}

async function seedAuthenticatedOpsUser(page: Page): Promise<void> {
  await page.addInitScript(({ venueId }) => {
    Object.defineProperty(window, "__OMNITWIN_E2E__", { value: true, writable: false });
    Object.defineProperty(window, "__OMNITWIN_SEED_USER__", {
      value: {
        id: "00000000-0000-4000-8000-000000004099",
        email: "ops@e2e.test",
        role: "staff",
        venueId,
        name: "Ops User",
      },
      writable: false,
    });
  }, { venueId: VENUE_ID });
}

async function seedAuthenticatedPlannerUser(page: Page): Promise<void> {
  await page.addInitScript(({ venueId }) => {
    Object.defineProperty(window, "__OMNITWIN_E2E__", { value: true, writable: false });
    Object.defineProperty(window, "__OMNITWIN_SEED_USER__", {
      value: {
        id: "00000000-0000-4000-8000-000000004098",
        email: "planner@e2e.test",
        role: "planner",
        venueId,
        name: "Planner User",
      },
      writable: false,
    });
  }, { venueId: VENUE_ID });
}

async function mockPlannerRoutes(page: Page): Promise<void> {
  await page.route(`${API}/public/configurations/${CONFIG_ID}`, (route) => {
    void route.fulfill({
      json: {
        data: {
          id: CONFIG_ID,
          spaceId: SPACE_ID,
          venueId: VENUE_ID,
          userId: null,
          name: "SS++ visual regression layout",
          isPublicPreview: true,
          revision: 1,
          objects: [],
        },
      },
    });
  });
  await page.route(`${API}/venues/${VENUE_ID}/spaces/${SPACE_ID}`, (route) => {
    void route.fulfill({
      json: {
        data: {
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
        },
      },
    });
  });
}

async function mockPublicRoomVisualRoutes(page: Page): Promise<void> {
  await page.route(`${API}/assets/runtime-packages/public-room-visual*`, (route) => {
    void route.fulfill({
      json: {
        data: {
          venueSlug: "trades-hall",
          roomSlug: "grand-hall",
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

function publicProposalFixture(): PublicProposal {
  return {
    title: "North Gallery reception proposal",
    status: "sent",
    sentAt: NOW,
    venueName: "Trades Hall Glasgow",
    clientMessage: "This planning proposal is prepared for discussion with the venue team.",
    capacityNote: "Capacity guidance is a planning estimate from the current layout.",
    quote: {
      quoteId: null,
      currency: "GBP",
      lineItems: [
        {
          description: "Room hire planning line",
          quantity: 1,
          unitAmountMinor: 125_000,
          lineTotalMinor: 125_000,
        },
      ],
      subtotalMinor: 125_000,
      totalMinor: 125_000,
    },
    version: 1,
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
        id: "00000000-0000-4000-8000-000000004020",
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
        id: "00000000-0000-4000-8000-000000004006",
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
        configId: "00000000-0000-4000-8000-000000004007",
        snapshotId: "00000000-0000-4000-8000-000000004008",
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
        id: "00000000-0000-4000-8000-000000004009",
        handoffPackId: PACK_ID,
        title: "Pick list",
        totalItems: 12,
        createdAt: NOW,
      },
      pickListItems: [],
      supplierInstructions: [
        {
          id: "00000000-0000-4000-8000-000000004010",
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
        id: "00000000-0000-4000-8000-000000004011",
        handoffPackId: PACK_ID,
        title: "Internal BEO",
        body: "Internal operations handoff.",
        sourceSnapshotHash: HASH,
        safeStatus: "internal_operations_handoff",
        createdAt: NOW,
      },
      snapshotDiff: {
        id: "00000000-0000-4000-8000-000000004012",
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
      doneTasks: 0,
      blockedTasks: 0,
      activeTasks: 1,
      percent: 0,
    },
    supplierArrivals: [
      {
        instructionId: "00000000-0000-4000-8000-000000004010",
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
  await page.route(`${API}/enquiries*`, (route) => {
    void route.fulfill({ json: { data: [] } });
  });
  await page.route(`${API}/analytics/venue-dashboard*`, (route) => {
    void route.fulfill({ json: { data: revenueAnalyticsFixture() } });
  });
}

async function mockEventDayRoutes(page: Page): Promise<{ readonly statusUpdates: OpsTask["status"][] }> {
  const statusUpdates: OpsTask["status"][] = [];
  await page.route(`${API}/events/${EVENT_ID}/ops-board`, (route) => {
    void route.fulfill({ json: { data: eventDayBoardFixture() } });
  });
  await page.route(`${API}/ops-tasks/${TASK_ID}/status`, async (route) => {
    const body = route.request().postDataJSON() as { readonly status?: OpsTask["status"] };
    if (body.status !== undefined) statusUpdates.push(body.status);
    void route.fulfill({ json: { data: taskFixture(body.status ?? "todo") } });
  });
  return { statusUpdates };
}

async function mockHallkeeperRoutes(page: Page): Promise<void> {
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
          config: { id: CONFIG_ID, name: "SS++ hardening gala", layoutStyle: "dinner-banquet", guestCount: 120 },
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
                      notes: "",
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
          webViewUrl: "http://localhost:5173/hallkeeper/e2e-hardening-plan",
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
    void route.fulfill({ json: { data: { configId: CONFIG_ID, rowKey: "fixture", checked: true } } });
  });
}

test.describe("SS++ hardening visual regression", () => {
  test("captures deterministic planner screenshot for /plan", async ({ page }) => {
    const pageErrors = collectPageErrors(page);
    await mockPlannerRoutes(page);

    await page.goto(`/plan/${CONFIG_ID}`);
    await page.waitForSelector("canvas", { timeout: 15_000 });
    await expect(page.locator("canvas")).toBeVisible();
    await attachScreenshotSmoke(page, "sspp-plan.png");
    expect(pageErrors).toEqual([]);
  });

  test("captures deterministic Trades Hall visual route screenshot", async ({ page }) => {
    const pageErrors = collectPageErrors(page);
    await page.route(`${API}/assets/runtime-packages/latest*`, (route) => {
      void route.fulfill({ json: { data: null } });
    });

    await page.goto("/dev/trades-hall-visual");
    await expect(page.getByRole("heading", { name: "Truth Mode", exact: true })).toBeVisible({ timeout: 15_000 });
    await expect(page.getByRole("button", { name: /Guest Flow Replay \d+ agents/i })).toBeVisible();
    await attachScreenshotSmoke(page, "sspp-trades-hall-visual.png");
    expect(pageErrors).toEqual([]);
  });

  test("captures deterministic room showcase screenshot", async ({ page }) => {
    const pageErrors = collectPageErrors(page);
    await page.goto("/");
    await expect(page.getByRole("heading", { level: 1, name: /There is a hall in Glasgow/i })).toBeVisible();
    await expect(page.getByRole("heading", { name: /Eight rooms, each keeping its own hours/i })).toBeVisible();
    await expect(page.getByRole("link", { name: /Explore The Robert Adam Room/i })).toBeVisible();
    await expect(page.getByRole("link", { name: /Enquire about Deacon Convener's Room/i })).toBeVisible();
    await attachScreenshotSmoke(page, "sspp-room-showcase.png");
    expect(pageErrors).toEqual([]);
  });

  test("captures deterministic public room route screenshot", async ({ page }) => {
    const pageErrors = collectPageErrors(page);
    await mockPublicRoomVisualRoutes(page);

    await page.goto("/venues/trades-hall/rooms/grand-hall");
    await expect(page.getByRole("heading", { level: 1, name: "Grand Hall" })).toBeVisible();
    await expect(page.getByRole("heading", { name: /Eight room experiences/i })).toBeVisible();
    await expect(page.getByRole("link", { name: /Open The South Gallery room preview/i })).toBeVisible();
    await expect(page.getByText(/Human review is required/i)).toBeVisible();
    await attachScreenshotSmoke(page, "sspp-public-room-route.png");
    expect(pageErrors).toEqual([]);
  });

  test("captures deterministic pricing screenshot", async ({ page }) => {
    const pageErrors = collectPageErrors(page);

    await page.goto("/pricing");
    await expect(page.getByRole("heading", { level: 1, name: /Turn every enquiry/i })).toBeVisible();
    await expect(page.getByRole("group", { name: "Billing cycle" })).toBeVisible();
    await attachScreenshotSmoke(page, "sspp-pricing.png");
    expect(pageErrors).toEqual([]);
  });

  test("captures deterministic client proposal screenshot", async ({ page }) => {
    const pageErrors = collectPageErrors(page);
    await page.route(`${API}/public/proposals/hardening-share`, (route) => {
      void route.fulfill({ json: { data: publicProposalFixture() } });
    });

    await page.goto("/proposal/hardening-share");
    await expect(page.getByRole("heading", { level: 1, name: "North Gallery reception proposal" })).toBeVisible();
    await expect(page.getByText(/planning estimates for discussion/i)).toBeVisible();
    await attachScreenshotSmoke(page, "sspp-client-proposal.png");
    expect(pageErrors).toEqual([]);
  });

  test("captures deterministic dashboard pipeline screenshot", async ({ page }) => {
    const pageErrors = collectPageErrors(page);
    await seedAuthenticatedOpsUser(page);
    await mockDashboardRoutes(page);

    await page.goto("/dashboard");
    await page.getByRole("button", { name: "Executive Analytics" }).click();
    await expect(page.getByRole("heading", { name: "Commercial planning dashboard" })).toBeVisible();
    await expect(page.getByText("Pipeline value")).toBeVisible();
    await attachScreenshotSmoke(page, "sspp-dashboard-pipeline.png");
    expect(pageErrors).toEqual([]);
  });

  test("captures deterministic hallkeeper screenshot", async ({ page }) => {
    const pageErrors = collectPageErrors(page);
    await seedAuthenticatedPlannerUser(page);
    await mockHallkeeperRoutes(page);

    await page.goto(`/hallkeeper/${CONFIG_ID}`);
    await expect(page.getByRole("heading", { level: 1, name: "SS++ hardening gala" })).toBeVisible();
    await expect(page.getByRole("checkbox", { name: /Stage Platform/i })).toBeVisible();
    await attachScreenshotSmoke(page, "sspp-hallkeeper.png");
    expect(pageErrors).toEqual([]);
  });
});

test.describe("SS++ hardening keyboard and mobile operations", () => {
  test("landing CTA is reachable by keyboard", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByRole("heading", { name: /There is a hall in Glasgow/i })).toBeVisible();
    // The Rite's nav is visually withheld until Act II but stays in the tab
    // order (it reveals on :focus-within), so keyboard users reach the
    // planner CTA within the first few tabs.
    const primaryCta = page.getByRole("link", { name: /Open the planner/i });

    let focused = false;
    for (let i = 0; i < 12; i += 1) {
      await page.keyboard.press("Tab");
      focused = await primaryCta.evaluate((element) => element === document.activeElement);
      if (focused) break;
    }

    expect(focused).toBe(true);
    await expect(primaryCta).toBeVisible(); // focus-within reveals the nav
  });

  test("public room selector is keyboard reachable and mobile-safe", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await mockPublicRoomVisualRoutes(page);

    await page.goto("/venues/trades-hall/rooms/grand-hall");
    await expect(page.getByRole("heading", { name: /Eight room experiences/i })).toBeVisible();
    await expect(
      page.getByLabel("Grand Hall visual preview").getByText(/Final details are confirmed by the venue team/i),
    ).toBeVisible();

    const nextRoom = page.getByRole("link", { name: /Open Lady Convener's Room room preview/i });
    await nextRoom.focus();
    await expect(nextRoom).toBeFocused();

    const horizontalOverflow = await page.evaluate(() => (
      document.documentElement.scrollWidth > document.documentElement.clientWidth + 1
    ));
    expect(horizontalOverflow).toBe(false);
  });

  test("event-day mobile task status works from keyboard activation", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await seedAuthenticatedOpsUser(page);
    const mock = await mockEventDayRoutes(page);

    await page.goto(`/ops/events/${EVENT_ID}`);
    await expect(page.getByRole("heading", { level: 1, name: "Wilson wedding" })).toBeVisible();

    const doneButton = page.getByRole("button", { name: "Done" }).first();
    await doneButton.focus();
    await page.keyboard.press("Enter");

    await expect.poll(() => mock.statusUpdates.includes("done")).toBe(true);
    await expect(page.getByText("Task status updated.")).toBeVisible();
  });
});
