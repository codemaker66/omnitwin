import { expect, test, type Page } from "@playwright/test";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import {
  collectAccessibilityAudit,
  expectAccessibilityAuditClean,
  watchPageProblems,
  type AccessibilityAuditResult,
  type AccessibilityViewport,
} from "./support/accessibility-audit.js";

// T-616: the landing is the one front door at `/` (Blake, 26 September 2026).
// It opens on the Grand Hall, named in its h1.
const FRONT_DOOR_HEADING = "Grand Hall";

const SAMPLE_MS = Number.parseInt(process.env.FRAME_BUDGET_SAMPLE_MS ?? "1200", 10);
const TARGET_FRAME_MS = 16.7;
const PASS_P95_MS = Number.parseFloat(process.env.FRAME_BUDGET_PASS_P95_MS ?? "18.5");
const MAX_SUSTAINED_OVER_BUDGET = Number.parseInt(process.env.FRAME_BUDGET_MAX_SUSTAINED ?? "1", 10);
const artifactDir = (): string => test.info().outputPath("public-acquisition");

type PublicViewportName = "desktop" | "mobile";

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

interface PublicRouteResult {
  readonly name: string;
  readonly viewport: PublicViewportName;
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

const results: PublicRouteResult[] = [];
const accessibilityResults: AccessibilityAuditResult[] = [];

function accessibilityViewport(name: PublicViewportName): AccessibilityViewport {
  if (name === "mobile") return { name: "mobile", width: 390, height: 844 };
  return { name: "desktop", width: 1440, height: 900 };
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

async function sampleFrames(page: Page, durationMs: number): Promise<readonly number[]> {
  return page.evaluate((sampleDuration) => new Promise<readonly number[]>((resolve) => {
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
  expect(screenshot.byteLength, `${screenshotPath} should not be blank`).toBeGreaterThan(12_000);
  return screenshot.byteLength;
}

async function assertNoRuntimeBreakage(page: Page): Promise<void> {
  await expect(page.locator("vite-error-overlay")).toHaveCount(0);
  await expect(page.getByText(/Internal Server Error|Failed to fetch dynamically imported module/u)).toHaveCount(0);
}

async function recordAccessibilityState(
  page: Page,
  problems: ReturnType<typeof watchPageProblems>,
  name: string,
  path: string,
  viewport: PublicViewportName,
): Promise<void> {
  const result = await collectAccessibilityAudit(page, {
    name,
    path,
    problems,
    viewport: accessibilityViewport(viewport),
    maxFocusSteps: viewport === "mobile" ? 14 : 18,
  });
  accessibilityResults.push(result);
  expectAccessibilityAuditClean(result);
}

async function recordFrameAndVisualState(
  page: Page,
  name: string,
  viewport: PublicViewportName,
  interaction: () => Promise<void>,
): Promise<void> {
  const screenshotPath = `${artifactDir()}/${viewport}-${name}.png`;
  await page.waitForLoadState("networkidle").catch(() => undefined);
  await assertNoRuntimeBreakage(page);
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

/** The venue's own photographs, each from its display-sized WebP ladder. */
async function expectUpdatedPublicPhotoSet(page: Page): Promise<void> {
  const imageSources = await page.evaluate(() => Array.from(document.querySelectorAll("img"))
    .map((image) => image.getAttribute("src") ?? ""));

  expect(imageSources).toContain("/images/venue/ladder/grand-hall-room-1535.webp");
  expect(imageSources).toContain("/images/venue/ladder/reception-room-1536.webp");
  expect(imageSources).toContain("/images/venue/ladder/saloon-room-1535.webp");
  expect(imageSources).toContain("/images/rooms/supplied/ladder/robert-adam-room-1120.webp");
}

async function expectFrontDoorActionsInsideViewport(page: Page): Promise<void> {
  const escaped = await page.evaluate(() => Array.from(
    document.querySelectorAll<HTMLElement>(".rooms__primaryNav a, .rooms__heroName, .rooms__enter"),
  )
    .map((element) => {
      const rect = element.getBoundingClientRect();
      return {
        selector: element.className,
        left: rect.left,
        right: rect.right,
        width: rect.width,
      };
    })
    .filter((rect) => rect.width > 0 && (rect.left < -1 || rect.right > window.innerWidth + 1)));

  expect(escaped, "the front door's primary actions should stay inside the mobile viewport").toEqual([]);
}

async function seedAdmin(page: Page): Promise<void> {
  // The Venviewer subscription page is admin-only until billing exists
  // (Blake, 26 September 2026).
  await page.addInitScript(() => {
    Object.defineProperty(window, "__OMNITWIN_E2E__", { value: true, writable: false });
    Object.defineProperty(window, "__OMNITWIN_SEED_USER__", {
      value: {
        id: "00000000-0000-4000-8000-000000004094",
        email: "admin@public-acquisition.test",
        role: "admin",
        platformRole: "none",
        venueId: "00000000-0000-4000-8000-000000004001",
        name: "Admin Audit",
      },
      writable: false,
    });
  });
}

test.describe.configure({ mode: "default" });

test.afterAll(async () => {
  await mkdir(dirname(`${artifactDir()}/report.json`), { recursive: true });
  await writeFile(`${artifactDir()}/report.json`, `${JSON.stringify({
    generatedAt: new Date().toISOString(),
    targetFrameMs: TARGET_FRAME_MS,
    passP95Ms: PASS_P95_MS,
    maxSustainedOverBudget: MAX_SUSTAINED_OVER_BUDGET,
    sampleMs: SAMPLE_MS,
    results,
    accessibilityResults,
  }, null, 2)}\n`, "utf8");
});

test.describe("T-469 public acquisition visual and CDP frame-budget pass", () => {
  test("landing page renders updated venue photos and stays smooth on desktop", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.emulateMedia({ reducedMotion: "reduce" });
    const problems = watchPageProblems(page);

    await page.goto("/");
    await expect(page.getByRole("heading", { level: 1, name: FRONT_DOOR_HEADING, exact: true })).toBeVisible();
    await expectUpdatedPublicPhotoSet(page);

    await recordFrameAndVisualState(page, "landing-updated-photos", "desktop", async () => {
      await page.getByRole("heading", { name: "What each room holds", exact: true }).scrollIntoViewIfNeeded();
      await expect(page.getByRole("row", { name: /The Grand Hall/u })).toBeVisible();
      await page.mouse.wheel(0, 540);
      await page.mouse.wheel(0, -220);
    });
    await recordAccessibilityState(page, problems, "public landing updated photo route", "/", "desktop");
  });

  test("landing page remains contained and smooth on mobile", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.emulateMedia({ reducedMotion: "reduce" });
    const problems = watchPageProblems(page);

    await page.goto("/");
    await expect(page.getByRole("heading", { level: 1, name: FRONT_DOOR_HEADING, exact: true })).toBeVisible();
    await expectUpdatedPublicPhotoSet(page);

    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    expect(overflow, "public landing mobile should not horizontally overflow").toBeLessThanOrEqual(1);
    await expectFrontDoorActionsInsideViewport(page);

    await recordFrameAndVisualState(page, "landing-mobile-updated-photos", "mobile", async () => {
      await page.mouse.wheel(0, 620);
      await page.keyboard.press("Tab");
    });
    await recordAccessibilityState(page, problems, "public landing mobile route", "/", "mobile");
  });

  test("pricing route stays visually stable and smooth on desktop", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.emulateMedia({ reducedMotion: "reduce" });
    const problems = watchPageProblems(page);
    await seedAdmin(page);

    await page.goto("/pricing");
    await expect(page.getByRole("heading", { level: 1, name: "Pricing", exact: true })).toBeVisible();
    // No trial is offered: nothing exists to bill or onboard one. The page's
    // next action is the enquiry form that replaced the trial links.
    await expect(page.locator("a[href='/register?tier=pro&cycle=annual']")).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Send enquiry" })).toBeVisible();

    await recordFrameAndVisualState(page, "pricing-desktop", "desktop", async () => {
      await page.getByRole("button", { name: "Monthly" }).click();
      await expect(page.locator("a[href='/register?tier=pro&cycle=monthly']")).toHaveCount(0);
      await page.getByRole("button", { name: "Annual" }).click();
      await expect(page.locator("a[href='/register?tier=pro&cycle=annual']")).toHaveCount(0);
      await page.mouse.wheel(0, 560);
    });
    await recordAccessibilityState(page, problems, "public pricing route", "/pricing", "desktop");
  });

  test("pricing route remains contained and smooth on mobile", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.emulateMedia({ reducedMotion: "reduce" });
    const problems = watchPageProblems(page);
    await seedAdmin(page);

    await page.goto("/pricing");
    await expect(page.getByRole("heading", { level: 1, name: "Pricing", exact: true })).toBeVisible();

    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    expect(overflow, "pricing mobile should not horizontally overflow").toBeLessThanOrEqual(1);

    await recordFrameAndVisualState(page, "pricing-mobile", "mobile", async () => {
      await page.getByRole("button", { name: "Annual" }).click();
      await page.mouse.wheel(0, 620);
      await page.keyboard.press("Tab");
    });
    await recordAccessibilityState(page, problems, "public pricing mobile route", "/pricing", "mobile");
  });
});
