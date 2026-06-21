import { expect, test, type Page } from "@playwright/test";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import type { PublicProposal } from "../src/api/proposals.js";
import type { SupplierAcknowledgement, SupplierSafePackView } from "../src/api/supplier-coordination.js";
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
const ARTIFACT_DIR = "C:/Users/blake/omnitwin2/artifacts/t469-production-live-route-pass-2026-06-21";
const REPORT_PATH = `${ARTIFACT_DIR}/report.json`;
const NOW = "2026-06-21T15:00:00.000Z";
const HASH = "c".repeat(64);
const PROPOSAL_TOKEN = "t469-production-live-proposal";
const SUPPLIER_TOKEN = "t469-production-live-supplier";
const SUPPLIER_PACK_ID = "00000000-0000-4000-8000-000000004110";
const SUPPLIER_SHARE_TOKEN_ID = "00000000-0000-4000-8000-000000004111";
const SUPPLIER_ACKNOWLEDGEMENT_ID = "00000000-0000-4000-8000-000000004112";

type ViewportName = "desktop" | "tablet" | "mobile";
type SupplierSafeAcknowledgementView = SupplierSafePackView["acknowledgements"][number];

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

interface RoutePassResult {
  readonly name: string;
  readonly path: string;
  readonly viewport: ViewportName;
  readonly screenshotPath: string;
  readonly screenshotBytes: number;
  readonly idle: FrameSummary;
  readonly interaction: FrameSummary;
  readonly cdp: CdpDelta;
  readonly passed: boolean;
}

interface ControlIssue {
  readonly selector: string;
  readonly label: string;
  readonly reason: string;
}

interface ControlAuditResult {
  readonly name: string;
  readonly path: string;
  readonly visibleControlCount: number;
  readonly issues: readonly ControlIssue[];
}

interface CdpMetricsPayload {
  readonly metrics: readonly {
    readonly name: string;
    readonly value: number;
  }[];
}

const results: RoutePassResult[] = [];
const accessibilityResults: AccessibilityAuditResult[] = [];
const controlResults: ControlAuditResult[] = [];
const actionProofs: string[] = [];

test.describe.configure({ mode: "serial" });

function accessibilityViewport(name: ViewportName): AccessibilityViewport {
  if (name === "mobile") return { name: "mobile", width: 390, height: 844 };
  if (name === "tablet") return { name: "tablet", width: 1024, height: 768 };
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

async function assertNoRuntimeBreakage(page: Page): Promise<void> {
  await expect(page.locator("vite-error-overlay")).toHaveCount(0);
  await expect(page.getByText(/Internal Server Error|Failed to fetch dynamically imported module/u)).toHaveCount(0);
}

async function takeSmokeScreenshot(page: Page, screenshotPath: string): Promise<number> {
  await mkdir(dirname(screenshotPath), { recursive: true });
  const screenshot = await page.screenshot({ path: screenshotPath, fullPage: false });
  expect(screenshot.byteLength, `${screenshotPath} should not be blank`).toBeGreaterThan(12_000);
  return screenshot.byteLength;
}

async function recordAccessibilityState(
  page: Page,
  problems: ReturnType<typeof watchPageProblems>,
  name: string,
  path: string,
  viewport: ViewportName,
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

async function recordControlAudit(page: Page, name: string, path: string): Promise<void> {
  const result = await page.evaluate(({ auditName, auditPath }) => {
    interface BrowserControlIssue {
      readonly selector: string;
      readonly label: string;
      readonly reason: string;
    }

    function isVisible(element: Element): boolean {
      const rect = element.getBoundingClientRect();
      const style = window.getComputedStyle(element);
      return rect.width > 0 && rect.height > 0 && style.display !== "none" && style.visibility !== "hidden";
    }

    function labelText(element: Element): string {
      const ariaLabel = element.getAttribute("aria-label");
      if (ariaLabel !== null && ariaLabel.trim().length > 0) return ariaLabel.trim();

      const labelledBy = element.getAttribute("aria-labelledby");
      if (labelledBy !== null) {
        const text = labelledBy
          .split(/\s+/u)
          .map((id) => document.getElementById(id)?.textContent?.trim() ?? "")
          .filter((part) => part.length > 0)
          .join(" ");
        if (text.length > 0) return text;
      }

      if (element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement || element instanceof HTMLSelectElement) {
        if (element.labels !== null && element.labels.length > 0) {
          const label = Array.from(element.labels)
            .map((entry) => entry.textContent?.trim() ?? "")
            .filter((part) => part.length > 0)
            .join(" ");
          if (label.length > 0) return label;
        }
        if (element.placeholder.trim().length > 0) return element.placeholder.trim();
      }

      const title = element.getAttribute("title");
      if (title !== null && title.trim().length > 0) return title.trim();

      return element.textContent?.replace(/\s+/gu, " ").trim() ?? "";
    }

    function selectorFor(element: Element): string {
      const testId = element.getAttribute("data-testid");
      if (testId !== null) return `[data-testid="${testId}"]`;
      const ariaLabel = element.getAttribute("aria-label");
      if (ariaLabel !== null) return `${element.tagName.toLowerCase()}[aria-label="${ariaLabel}"]`;
      const id = element.getAttribute("id");
      if (id !== null) return `#${id}`;
      return element.tagName.toLowerCase();
    }

    const controls = Array.from(document.querySelectorAll<HTMLElement>(
      "button, a[href], input:not([type='hidden']), select, textarea, [role='button'], [role='tab'], [role='switch'], [role='checkbox'], [role='menuitem']",
    )).filter(isVisible);

    const issues: BrowserControlIssue[] = [];
    for (const control of controls) {
      const label = labelText(control);
      const selector = selectorFor(control);
      const rect = control.getBoundingClientRect();
      const disabled = control instanceof HTMLButtonElement ||
        control instanceof HTMLInputElement ||
        control instanceof HTMLTextAreaElement ||
        control instanceof HTMLSelectElement
        ? control.disabled
        : control.getAttribute("aria-disabled") === "true";

      if (!disabled && label.length === 0) {
        issues.push({ selector, label, reason: "visible enabled control has no accessible or visible name" });
      }
      if (control instanceof HTMLAnchorElement) {
        const href = control.getAttribute("href");
        if (!disabled && (href === null || href.trim().length === 0 || href.trim() === "#")) {
          issues.push({ selector, label, reason: "visible link has no concrete destination" });
        }
      }
      if (!disabled && (rect.width < 32 || rect.height < 28)) {
        issues.push({ selector, label, reason: `visible enabled control is very small (${Math.round(rect.width)}x${Math.round(rect.height)})` });
      }
    }

    return {
      name: auditName,
      path: auditPath,
      visibleControlCount: controls.length,
      issues,
    };
  }, { auditName: name, auditPath: path });

  controlResults.push(result);
  expect(result.issues, `${name}: visible control contract issues`).toEqual([]);
}

async function recordFrameAndVisualState(
  page: Page,
  name: string,
  path: string,
  viewport: ViewportName,
  interaction: () => Promise<void>,
): Promise<void> {
  const screenshotPath = `${ARTIFACT_DIR}/${viewport}-${name}.png`;
  await page.waitForLoadState("networkidle").catch(() => undefined);
  await assertNoRuntimeBreakage(page);
  const screenshotBytes = await takeSmokeScreenshot(page, screenshotPath);

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
    path,
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

function proposalFixture(status: PublicProposal["status"] = "sent", extraComment?: string): PublicProposal {
  const comments = [
    { kind: "comment" as const, authorName: "Venue team", body: "We can adjust the arrival time.", createdAt: NOW },
  ];
  if (extraComment !== undefined) {
    comments.push({ kind: "comment", authorName: "Client", body: extraComment, createdAt: NOW });
  }
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
      lineItems: [{
        description: "Reception Room hire",
        quantity: 1,
        unitAmountMinor: 125_000,
        lineTotalMinor: 125_000,
      }],
      subtotalMinor: 125_000,
      totalMinor: 125_000,
    },
    version: 1,
    comments,
    packages: [{ label: "Dinner package", quantity: 1, totalMinor: 125_000, status: "included" }],
    layoutSnapshot: null,
  };
}

function supplierPackFixture(acknowledgements: readonly SupplierSafeAcknowledgementView[] = []): SupplierSafePackView {
  return {
    title: "Florist coordination handoff",
    venueName: "Trades Hall Glasgow",
    supplierName: "Petal & Stem",
    contactName: "Venue Planner",
    contactEmail: "planner@tradeshall.test",
    contactPhone: null,
    status: acknowledgements.length > 0 ? "acknowledged" : "issued",
    safeStatus: "supplier_safe_operations_handoff",
    issuedAt: NOW,
    expiresAt: "2026-06-22T12:00:00.000Z",
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
    acknowledgements,
    supplierNotice: "Supplier-facing planning handoff from venue operations data. Confirm details with the venue team before arrival.",
  };
}

async function mockProposalShare(page: Page): Promise<void> {
  let latestComment: string | undefined;
  let status: PublicProposal["status"] = "sent";

  await page.route(`**/proposal-share/${PROPOSAL_TOKEN}`, (route) => {
    const request = route.request();
    if (request.resourceType() === "document" || request.method() !== "GET") {
      void route.fallback();
      return;
    }
    void route.fulfill({ json: { data: proposalFixture(status, latestComment) } });
  });
  await page.route(`**/proposal-share/${PROPOSAL_TOKEN}/comment`, async (route) => {
    const request = route.request();
    if (request.method() !== "POST") {
      void route.fallback();
      return;
    }
    const postData = request.postDataJSON() as { body?: unknown; kind?: unknown } | null;
    const body = typeof postData?.body === "string" ? postData.body : "Client comment";
    latestComment = body;
    if (postData?.kind === "request_changes") status = "changes_requested";
    void route.fulfill({
      json: {
        data: {
          id: "00000000-0000-4000-8000-000000004080",
          authorName: "Client",
          body,
          kind: postData?.kind === "request_changes" ? "request_changes" : "comment",
          createdAt: NOW,
        },
      },
    });
  });
  await page.route(`**/proposal-share/${PROPOSAL_TOKEN}/approve`, (route) => {
    status = "accepted";
    void route.fulfill({ json: { data: { status } } });
  });
}

async function mockSupplierShare(page: Page): Promise<void> {
  let acknowledgements: SupplierSafeAcknowledgementView[] = [];

  await page.route(`**/supplier-share/${SUPPLIER_TOKEN}`, (route) => {
    const request = route.request();
    if (request.resourceType() === "document" || request.method() !== "GET") {
      void route.fallback();
      return;
    }
    void route.fulfill({ json: { data: supplierPackFixture(acknowledgements) } });
  });
  await page.route(`**/supplier-share/${SUPPLIER_TOKEN}/acknowledge`, async (route) => {
    const request = route.request();
    if (request.method() !== "POST") {
      void route.fallback();
      return;
    }
    const postData = request.postDataJSON() as {
      status?: unknown;
      acknowledgedByName?: unknown;
      acknowledgedByEmail?: unknown;
      note?: unknown;
    } | null;
    const acknowledgement: SupplierAcknowledgement = {
      id: SUPPLIER_ACKNOWLEDGEMENT_ID,
      packId: SUPPLIER_PACK_ID,
      shareTokenId: SUPPLIER_SHARE_TOKEN_ID,
      status: postData?.status === "needs_clarification" ? "needs_clarification" : "acknowledged",
      acknowledgedByName: typeof postData?.acknowledgedByName === "string" ? postData.acknowledgedByName : null,
      acknowledgedByEmail: typeof postData?.acknowledgedByEmail === "string" ? postData.acknowledgedByEmail : null,
      note: typeof postData?.note === "string" ? postData.note : null,
      createdAt: NOW,
    };
    acknowledgements = [{
      status: acknowledgement.status,
      acknowledgedByName: acknowledgement.acknowledgedByName,
      note: acknowledgement.note,
      createdAt: acknowledgement.createdAt,
    }];
    void route.fulfill({ json: { data: acknowledgement } });
  });
}

test.afterAll(async () => {
  await mkdir(dirname(REPORT_PATH), { recursive: true });
  await writeFile(REPORT_PATH, `${JSON.stringify({
    generatedAt: new Date().toISOString(),
    targetFrameMs: TARGET_FRAME_MS,
    passP95Ms: PASS_P95_MS,
    maxSustainedOverBudget: MAX_SUSTAINED_OVER_BUDGET,
    sampleMs: SAMPLE_MS,
    liveBaseUrl: process.env.E2E_BASE_URL ?? null,
    protectedDashboardLiveScope: "unauthenticated auth-shell only; signed drawer internals require a production-safe staff/admin session or the production-preview e2e bypass build",
    results,
    accessibilityResults,
    controlResults,
    actionProofs,
  }, null, 2)}\n`, "utf8");
});

test.describe("T-469 production-live route pass", () => {
  test("public room pages stay live, accessible, controlled, and within frame budget", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.emulateMedia({ reducedMotion: "reduce" });
    const roomCases = [
      { slug: "grand-hall", heading: "Grand Hall", eventType: "Wedding dinner" },
      { slug: "reception-room", heading: "Reception Room", eventType: "Ceremony" },
      { slug: "robert-adam-room", heading: "Robert Adam Room", eventType: "Private dining" },
      { slug: "saloon", heading: "Saloon", eventType: "Dinner" },
    ] as const;

    for (const room of roomCases) {
      const path = `/venues/trades-hall/rooms/${room.slug}?live-route-pass=${Date.now()}`;
      const problems = watchPageProblems(page);
      await page.goto(path);
      await expect(page.getByRole("heading", { level: 1, name: room.heading })).toBeVisible();
      await expect(page.getByRole("link", { name: "Request layout" })).toHaveAttribute("href", `/plan?space=${room.slug}&intent=request-layout`);
      await page.getByRole("button", { name: room.eventType }).click();
      await expect(page.getByRole("button", { name: room.eventType })).toHaveClass(/selected/u);
      actionProofs.push(`${room.heading}: event type button selects ${room.eventType}; request layout link points to the room-specific planner intent.`);

      await recordControlAudit(page, `public room ${room.slug}`, path);
      await recordAccessibilityState(page, problems, `public room ${room.slug}`, path, "desktop", 16);
      await recordFrameAndVisualState(page, `public-room-${room.slug}`, path, "desktop", async () => {
        await page.mouse.move(990, 660);
        await page.mouse.wheel(0, 280);
        await page.mouse.wheel(0, -140);
      });
    }
  });

  test("proposal share full client controls work against the live frontend bundle without production mutation", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.emulateMedia({ reducedMotion: "reduce" });
    const path = `/proposal-share/${PROPOSAL_TOKEN}`;
    const problems = watchPageProblems(page);
    await mockProposalShare(page);

    await page.goto(path);
    await expect(page.getByRole("heading", { name: "Reception Room wedding proposal" })).toBeVisible();
    await page.getByRole("button", { name: "Request changes" }).click();
    await expect(page.getByLabel("Tell the venue team what you'd like changed")).toBeVisible();
    await page.getByTestId("comment-input").fill("Please keep the main-door route wider for older guests.");
    await page.getByTestId("comment-submit").click();
    await expect(page.getByText("Please keep the main-door route wider for older guests.")).toBeVisible();
    await page.getByRole("button", { name: "Approve proposal" }).click();
    await expect(page.getByText("Proposal accepted")).toBeVisible();
    actionProofs.push("Proposal share: request-changes form opens, standalone comment posts/reloads, and approve updates the visible terminal banner.");

    await recordControlAudit(page, "proposal share functional fixture", path);
    await recordAccessibilityState(page, problems, "proposal share functional fixture", path, "desktop", 16);
    await recordFrameAndVisualState(page, "proposal-share-functional", path, "desktop", async () => {
      await page.mouse.move(760, 690);
      await page.mouse.wheel(0, 360);
      await page.keyboard.press("Tab");
    });
  });

  test("supplier portal acknowledgement controls work against the live frontend bundle without production mutation", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.emulateMedia({ reducedMotion: "reduce" });
    const path = `/supplier-share/${SUPPLIER_TOKEN}`;
    const problems = watchPageProblems(page);
    await mockSupplierShare(page);

    await page.goto(path);
    await expect(page.getByRole("heading", { name: "Florist coordination handoff" })).toBeVisible();
    await page.getByLabel("Need clarification").check();
    await expect(page.getByLabel("Clarification needed")).toBeVisible();
    await page.getByLabel("Name").fill("Jordan Florist");
    await page.getByLabel("Email").fill("jordan@petal.example");
    await page.getByLabel("Clarification needed").fill("Please confirm the staff entrance load-in time.");
    await page.getByRole("button", { name: "Send clarification request" }).click();
    await expect(page.getByRole("heading", { name: "Latest response" })).toBeVisible();
    await expect(page.getByText("Please confirm the staff entrance load-in time.")).toBeVisible();
    actionProofs.push("Supplier portal: clarification radio changes the textarea label, submit persists to the refreshed response state, and the response form closes.");

    await recordControlAudit(page, "supplier portal functional fixture", path);
    await recordAccessibilityState(page, problems, "supplier portal functional fixture", path, "desktop", 16);
    await recordFrameAndVisualState(page, "supplier-portal-functional", path, "desktop", async () => {
      await page.mouse.move(930, 710);
      await page.mouse.wheel(0, 380);
      await page.keyboard.press("Tab");
    });
  });

  test("live unavailable share links stay polished, accessible, and smooth on mobile", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.emulateMedia({ reducedMotion: "reduce" });
    const cases = [
      {
        name: "proposal-share-unavailable",
        path: `/proposal-share/not-a-real-token-${Date.now()}`,
        heading: "This proposal link isn't available",
      },
      {
        name: "supplier-share-unavailable",
        path: `/supplier-share/not-a-real-token-${Date.now()}`,
        heading: "This supplier link is not available",
      },
    ] as const;

    for (const routeCase of cases) {
      const problems = watchPageProblems(page);
      await page.goto(routeCase.path);
      await expect(page.getByRole("heading", { name: routeCase.heading })).toBeVisible();
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
      expect(overflow, `${routeCase.name} should not horizontally overflow`).toBeLessThanOrEqual(1);
      await recordControlAudit(page, routeCase.name, routeCase.path);
      await recordAccessibilityState(page, problems, routeCase.name, routeCase.path, "mobile", 8);
      await recordFrameAndVisualState(page, routeCase.name, routeCase.path, "mobile", async () => {
        await page.mouse.wheel(0, 160);
        await page.keyboard.press("Tab");
      });
    }
  });

  test("live protected dashboard drawer routes fail closed to auth without console errors", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.emulateMedia({ reducedMotion: "reduce" });
    const protectedViews = ["reviews", "loadouts", "proposals", "admin", "analytics"] as const;

    for (const view of protectedViews) {
      const path = `/dashboard?view=${view}&live-route-pass=${Date.now()}`;
      const problems = watchPageProblems(page);
      await page.goto(path);
      await expect(page).toHaveURL(/\/login/u);
      await expect(page.getByRole("heading", { name: /Sign in/u }).first()).toBeVisible();
      actionProofs.push(`Protected dashboard ${view}: live production redirects unauthenticated traffic to /login before drawer data can load.`);
      await recordControlAudit(page, `protected dashboard auth ${view}`, path);
      await recordAccessibilityState(page, problems, `protected dashboard auth ${view}`, path, "desktop", 12);
      await recordFrameAndVisualState(page, `protected-dashboard-auth-${view}`, path, "desktop", async () => {
        await page.mouse.move(720, 420);
        await page.keyboard.press("Tab");
      });
    }
  });
});
