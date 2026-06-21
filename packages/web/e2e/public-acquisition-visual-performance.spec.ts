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

const SAMPLE_MS = Number.parseInt(process.env.FRAME_BUDGET_SAMPLE_MS ?? "1200", 10);
const TARGET_FRAME_MS = 16.7;
const PASS_P95_MS = Number.parseFloat(process.env.FRAME_BUDGET_PASS_P95_MS ?? "18.5");
const MAX_SUSTAINED_OVER_BUDGET = Number.parseInt(process.env.FRAME_BUDGET_MAX_SUSTAINED ?? "1", 10);
const ARTIFACT_DIR = "C:/Users/blake/omnitwin2/artifacts/t469-public-acquisition-frame-visual-2026-06-21";
const REPORT_PATH = `${ARTIFACT_DIR}/report.json`;

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
  const screenshotPath = `${ARTIFACT_DIR}/${viewport}-${name}.png`;
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

async function expectUpdatedPublicPhotoSet(page: Page): Promise<void> {
  const imageSources = await page.evaluate(() => Array.from(document.querySelectorAll("img"))
    .map((image) => image.getAttribute("src") ?? "")
    .filter((src) => src.startsWith("/images/venue/")));

  expect(imageSources).toContain("/images/venue/grand-hall-room.jpg");
  expect(imageSources).toContain("/images/venue/reception-room.jpg");
  expect(imageSources).toContain("/images/venue/robert-adam-room.jpg");
  expect(imageSources).toContain("/images/venue/saloon-room.jpg");
  expect(imageSources).toContain("/images/venue/trades-hall-exterior.jpg");
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

test.describe("T-469 public acquisition visual and CDP frame-budget pass", () => {
  test("landing page renders updated venue photos and stays smooth on desktop", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.emulateMedia({ reducedMotion: "reduce" });
    const problems = watchPageProblems(page);

    await page.goto("/");
    await expect(page.getByRole("heading", { name: "Design your event for the Grand Hall." })).toBeVisible();
    await expectUpdatedPublicPhotoSet(page);

    await recordFrameAndVisualState(page, "landing-updated-photos", "desktop", async () => {
      await page.getByLabel("Choose room").selectOption("reception-room");
      await expect(page.locator(".hero-media-photo img")).toHaveAttribute("src", "/images/venue/reception-room.jpg");
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
    await expect(page.getByRole("heading", { name: "Design your event for the Grand Hall." })).toBeVisible();
    await expectUpdatedPublicPhotoSet(page);

    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    expect(overflow, "public landing mobile should not horizontally overflow").toBeLessThanOrEqual(1);

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

    await page.goto("/pricing");
    await expect(page.getByRole("heading", { name: "Turn every enquiry into a yes." })).toBeVisible();
    await expect(page.locator("a[href='/register?tier=pro&cycle=annual']")).toHaveCount(2);

    await recordFrameAndVisualState(page, "pricing-desktop", "desktop", async () => {
      await page.getByRole("button", { name: "Monthly" }).click();
      await expect(page.locator("a[href='/register?tier=pro&cycle=monthly']")).toHaveCount(2);
      await page.getByRole("button", { name: "Annual" }).click();
      await expect(page.locator("a[href='/register?tier=pro&cycle=annual']")).toHaveCount(2);
      await page.mouse.wheel(0, 560);
    });
    await recordAccessibilityState(page, problems, "public pricing route", "/pricing", "desktop");
  });

  test("pricing route remains contained and smooth on mobile", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.emulateMedia({ reducedMotion: "reduce" });
    const problems = watchPageProblems(page);

    await page.goto("/pricing");
    await expect(page.getByRole("heading", { name: "Turn every enquiry into a yes." })).toBeVisible();

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
