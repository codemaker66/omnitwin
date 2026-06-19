import { expect, test, type Page } from "@playwright/test";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import type { VenueDashboardAnalytics } from "@omnitwin/types";
import type { PendingReviewEntry, ReviewHistoryEntry } from "../src/api/configuration-reviews.js";
import type { Loadout, LoadoutDetail, LoadoutPhoto } from "../src/api/loadouts.js";
import type { PricingRule } from "../src/api/pricing.js";
import type { Space } from "../src/api/spaces.js";

const API = "http://localhost:3001";
const NOW = "2026-06-18T12:00:00.000Z";
const VENUE_ID = "00000000-0000-4000-8000-000000004001";
const SPACE_ID = "00000000-0000-4000-8000-000000004002";
const EVENT_ID = "00000000-0000-4000-8000-000000004003";
const CONFIG_ID = "00000000-0000-4000-8000-000000004007";
const SNAPSHOT_ID = "00000000-0000-4000-8000-000000004008";
const NOTIFICATION_ID = "00000000-0000-4000-8000-000000004009";
const LOADOUT_ID = "00000000-0000-4000-8000-000000004019";
const LOADOUT_PHOTO_ID = "00000000-0000-4000-8000-000000004030";
const LOADOUT_SECOND_PHOTO_ID = "00000000-0000-4000-8000-000000004031";
const HASH = "b".repeat(64);

const SAMPLE_MS = Number.parseInt(process.env.FRAME_BUDGET_SAMPLE_MS ?? "1200", 10);
const TARGET_FRAME_MS = 16.7;
const PASS_P95_MS = Number.parseFloat(process.env.FRAME_BUDGET_PASS_P95_MS ?? "18.5");
const MAX_SUSTAINED_OVER_BUDGET = Number.parseInt(process.env.FRAME_BUDGET_MAX_SUSTAINED ?? "1", 10);
const ARTIFACT_DIR = "C:/Users/blake/omnitwin2/artifacts/t469-dashboard-drawer-frame-visual-2026-06-19";
const REPORT_PATH = `${ARTIFACT_DIR}/report.json`;

type SeedRole = "staff" | "planner" | "hallkeeper" | "admin" | "executive" | "supplier";
type DashboardViewportName = "desktop" | "mobile";

interface PageProblems {
  readonly pageErrors: readonly string[];
  readonly consoleErrors: readonly string[];
}

interface DashboardMockOptions {
  readonly failVenues?: boolean;
  readonly failAnalytics?: boolean;
  readonly failReviewApprove?: boolean;
  readonly failLoadoutCaption?: boolean;
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
  readonly viewport: DashboardViewportName;
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
      !text.includes("button audit") &&
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
      executive: "95",
      supplier: "96",
    };

    Object.defineProperty(window, "__OMNITWIN_E2E__", { value: true, writable: false });
    Object.defineProperty(window, "__OMNITWIN_SEED_USER__", {
      value: {
        id: `00000000-0000-4000-8000-0000000040${roleSuffix[seedRole] ?? "99"}`,
        email: `${seedRole}@t469-frame.test`,
        role: seedRole,
        venueId,
        name: `${seedRole[0]?.toUpperCase() ?? "U"}${seedRole.slice(1)} Frame Budget`,
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
    changedByName: "Planner Frame Budget",
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

function loadoutFixture(): Loadout {
  return {
    id: LOADOUT_ID,
    name: "Ceremony reference setup",
    description: "Room reference for a formal ceremony layout.",
    createdAt: NOW,
    photoCount: 2,
    coverFileKey: "loadouts/setup-entrance.jpg",
  };
}

function loadoutDetailFixture(): LoadoutDetail {
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

async function mockDashboardRoutes(page: Page, options: DashboardMockOptions = {}): Promise<void> {
  let failLoadoutCaption = options.failLoadoutCaption === true;
  let failReviewApprove = options.failReviewApprove === true;
  let remainingAnalyticsFailures = options.failAnalytics === true ? 2 : 0;

  await page.route(`${API}/venues`, (route) => {
    if (options.failVenues === true) {
      void route.fulfill({ status: 500, json: { error: "t469 venue registry failure" } });
      return;
    }
    void route.fulfill({ json: { data: [venueDetailFixture()] } });
  });
  await page.route(`${API}/venues/${VENUE_ID}`, (route) => {
    void route.fulfill({ json: { data: venueDetailFixture() } });
  });
  await page.route(`${API}/venues/${VENUE_ID}/spaces`, (route) => {
    void route.fulfill({ json: { data: [dashboardSpaceFixture()] } });
  });
  await page.route(`${API}/venues/${VENUE_ID}/spaces/${SPACE_ID}`, (route) => {
    void route.fulfill({ json: { data: spaceFixture() } });
  });
  await page.route(`${API}/venues/${VENUE_ID}/pricing`, (route) => {
    void route.fulfill({ json: { data: [pricingRuleFixture()] } });
  });
  await page.route(`${API}/enquiries**`, (route) => {
    void route.fulfill({ json: { data: [] } });
  });
  await page.route(`${API}/notifications**`, (route) => {
    void route.fulfill({
      json: {
        data: [
          {
            id: NOTIFICATION_ID,
            changeId: "00000000-0000-4000-8000-000000004006",
            eventId: EVENT_ID,
            venueId: VENUE_ID,
            audienceRole: "staff",
            recipientUserId: null,
            title: "Guest count updated",
            body: "The client updated the guest count. Review the plan before the handoff is used.",
            severity: "attention",
            actionPath: `/ops/events/${EVENT_ID}`,
            createdAt: NOW,
            readAt: null,
          },
        ],
      },
    });
  });
  await page.route(`${API}/analytics/venue-dashboard**`, (route) => {
    if (remainingAnalyticsFailures > 0) {
      remainingAnalyticsFailures -= 1;
      void route.fulfill({ status: 500, json: { error: "t469 analytics unavailable" } });
      return;
    }
    void route.fulfill({ json: { data: revenueAnalyticsFixture() } });
  });
  await page.route(`${API}/configurations/reviews/pending`, (route) => {
    void route.fulfill({ json: { data: { entries: [pendingReviewFixture()] } } });
  });
  await page.route(`${API}/configurations/${CONFIG_ID}/review/history`, (route) => {
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
  await page.route(`${API}/configurations/${CONFIG_ID}/review/approve`, (route) => {
    if (failReviewApprove) {
      failReviewApprove = false;
      void route.fulfill({ status: 500, json: { error: "Approval did not save" } });
      return;
    }
    void route.fulfill({ json: { data: { reviewStatus: "approved", snapshot: snapshotEnvelopeFixture() } } });
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
  await page.route(`${API}/venues/${VENUE_ID}/spaces/${SPACE_ID}/loadouts`, (route) => {
    void route.fulfill({ json: { data: [loadoutFixture()] } });
  });
  await page.route(`${API}/venues/${VENUE_ID}/spaces/${SPACE_ID}/loadouts/${LOADOUT_ID}`, (route) => {
    void route.fulfill({ json: { data: loadoutDetailFixture() } });
  });
  await page.route(`${API}/loadouts/${LOADOUT_ID}/photos/${LOADOUT_PHOTO_ID}`, (route) => {
    if (failLoadoutCaption) {
      failLoadoutCaption = false;
      void route.fulfill({ status: 500, json: { error: "t469 caption save failure" } });
      return;
    }
    void route.fulfill({ json: { data: loadoutPhotoFixture({ caption: "Main doors still clear" }) } });
  });
}

async function mockHallkeeperDeniedRoutes(page: Page): Promise<void> {
  await page.route(`${API}/hallkeeper/${CONFIG_ID}/v2`, (route) => {
    void route.fulfill({ status: 403, json: { error: "t469 hallkeeper denied" } });
  });
  await page.route(`${API}/hallkeeper/${CONFIG_ID}/progress`, (route) => {
    void route.fulfill({ json: { data: { configId: CONFIG_ID, checked: {} } } });
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
  viewport: DashboardViewportName,
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
  }, null, 2)}\n`, "utf8");
});

test.describe("T-469 dashboard drawer visual and frame-budget pass", () => {
  test("reviews drawer approval-error state stays visually stable and within frame budget", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    const problems = watchPageProblems(page);
    await seedAuthenticatedUser(page, "staff");
    await mockDashboardRoutes(page, { failReviewApprove: true });

    await page.goto("/dashboard?view=reviews");
    await page.waitForSelector("#dashboard-main", { timeout: 15_000 });
    await page.getByRole("button", { name: "Open review for Reception Room dinner review" }).click();
    await expect(page.getByRole("heading", { name: "Reception Room dinner review" })).toBeVisible();
    await page.getByRole("button", { name: "Approve" }).click();
    await expect(page.getByTestId("review-action-error")).toContainText("Approval did not save");

    await recordFrameAndVisualState(page, problems, "reviews-action-error", "desktop", async () => {
      await page.mouse.move(1100, 520);
      await page.mouse.wheel(0, 320);
      await page.mouse.wheel(0, -160);
    });
  });

  test("loadout drawer caption-error state stays visually stable and within frame budget", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    const problems = watchPageProblems(page);
    await seedAuthenticatedUser(page, "staff");
    await mockDashboardRoutes(page, { failLoadoutCaption: true });

    await page.goto("/dashboard?view=loadouts");
    await page.waitForSelector("#dashboard-main", { timeout: 15_000 });
    await page.getByRole("button", { name: "Open reference loadout Ceremony reference setup" }).click();
    await expect(page.getByRole("heading", { name: "Ceremony reference setup" })).toBeVisible();
    await page.getByRole("button", { name: "Room entrance" }).click();
    await page.getByLabel("Caption for setup-entrance.jpg").fill("Main doors still clear");
    await page.getByRole("button", { name: "Save" }).click();
    await expect(page.getByTestId("loadout-action-error")).toContainText("t469 caption save failure");

    await recordFrameAndVisualState(page, problems, "loadout-caption-error", "desktop", async () => {
      await page.mouse.move(1060, 650);
      await page.mouse.wheel(0, 360);
      await page.mouse.wheel(0, -220);
    });
  });

  test("executive analytics success and error surfaces stay within frame budget", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    const problems = watchPageProblems(page);
    await seedAuthenticatedUser(page, "executive");
    await mockDashboardRoutes(page);

    await page.goto("/dashboard");
    await page.waitForSelector("#dashboard-main", { timeout: 15_000 });
    await expect(page.getByRole("heading", { name: "Commercial planning dashboard" })).toBeVisible();

    await recordFrameAndVisualState(page, problems, "executive-analytics-success", "desktop", async () => {
      await page.mouse.move(760, 430);
      await page.mouse.wheel(0, 340);
      await page.mouse.wheel(0, -180);
    });
  });

  test("executive analytics API failure state stays readable and within frame budget", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    const problems = watchPageProblems(page);
    await seedAuthenticatedUser(page, "executive");
    await mockDashboardRoutes(page, { failAnalytics: true });

    await page.goto("/dashboard?view=analytics");
    await page.waitForSelector("#dashboard-main", { timeout: 15_000 });
    await expect(page.getByRole("heading", { name: "Analytics unavailable" })).toBeVisible();

    await recordFrameAndVisualState(page, problems, "executive-analytics-error", "desktop", async () => {
      await page.mouse.move(690, 400);
      await page.keyboard.press("Tab");
    });
  });

  test("supplier denied dashboard route stays polished and within frame budget", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    const problems = watchPageProblems(page);
    await seedAuthenticatedUser(page, "supplier");

    await page.goto("/dashboard");
    await expect(page.getByRole("heading", { level: 1, name: "This workspace is not available to your role" })).toBeVisible();

    await recordFrameAndVisualState(page, problems, "supplier-denied", "desktop", async () => {
      await page.mouse.move(720, 420);
      await page.keyboard.press("Tab");
    });
  });

  test("admin denied dashboard sub-route stays polished and within frame budget", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    const problems = watchPageProblems(page);
    await seedAuthenticatedUser(page, "hallkeeper");
    await mockDashboardRoutes(page);

    await page.goto("/dashboard?view=admin");
    await page.waitForSelector("#dashboard-main", { timeout: 15_000 });
    await expect(page.getByRole("heading", { level: 1, name: "That dashboard surface is not available for this role" })).toBeVisible();

    await recordFrameAndVisualState(page, problems, "admin-subroute-denied", "desktop", async () => {
      await page.mouse.move(780, 520);
      await page.keyboard.press("Tab");
    });
  });

  test("admin registry error state stays polished and within frame budget", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    const problems = watchPageProblems(page);
    await seedAuthenticatedUser(page, "admin");
    await mockDashboardRoutes(page, { failVenues: true });

    await page.goto("/dashboard?view=admin");
    await page.waitForSelector("#dashboard-main", { timeout: 15_000 });
    await expect(page.getByRole("heading", { name: "Venue registry unavailable" })).toBeVisible();

    await recordFrameAndVisualState(page, problems, "admin-registry-error", "desktop", async () => {
      await page.mouse.move(760, 500);
      await page.keyboard.press("Tab");
    });
  });

  test("hallkeeper mobile API-denied state remains readable, contained, and within frame budget", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    const problems = watchPageProblems(page);
    await seedAuthenticatedUser(page, "planner");
    await mockHallkeeperDeniedRoutes(page);

    await page.goto(`/hallkeeper/${CONFIG_ID}`);
    await expect(page.getByText("You don't have permission to view this events sheet.")).toBeVisible();

    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    expect(overflow, "hallkeeper denied mobile state should not horizontally overflow").toBeLessThanOrEqual(1);

    await recordFrameAndVisualState(page, problems, "hallkeeper-mobile-denied", "mobile", async () => {
      await page.mouse.wheel(0, 260);
      await page.keyboard.press("Tab");
    });
  });
});
