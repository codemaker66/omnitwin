import { chromium } from "@playwright/test";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

const BASE_URL = process.env.E2E_BASE_URL ?? "http://127.0.0.1:5173";
const API = process.env.VITE_API_URL ?? "http://localhost:3001";
const OUTPUT_FILE = process.env.FRAME_BUDGET_OUTPUT ?? "C:/tmp/venviewer-frame-budget-latest.json";
const SAMPLE_MS = Number(process.env.FRAME_BUDGET_SAMPLE_MS ?? "1800");
const BUDGET_MS = 16.7;
const PASS_P95_MS = Number(process.env.FRAME_BUDGET_PASS_P95_MS ?? "18.5");
const FAIL_ON_BUDGET = process.env.FRAME_BUDGET_FAIL === "true";

const NOW = "2026-06-18T12:00:00.000Z";
const VENUE_ID = "00000000-0000-4000-8000-000000004003";
const EVENT_ID = "00000000-0000-4000-8000-000000004001";
const TASK_ID = "00000000-0000-4000-8000-000000004002";
const PACK_ID = "00000000-0000-4000-8000-000000004004";
const HASH = "a".repeat(64);

const viewports = [
  { name: "desktop", width: 1440, height: 900, deviceScaleFactor: 2, isMobile: false },
  { name: "tablet", width: 1024, height: 768, deviceScaleFactor: 2, isMobile: false },
  { name: "mobile", width: 390, height: 844, deviceScaleFactor: 3, isMobile: true },
];

const routes = [
  { name: "planner", path: "/plan/cfg-perf-grand-hall?space=grand-hall", waitFor: "canvas", seedRole: "staff" },
  { name: "internal-visual", path: "/dev/trades-hall-visual?venue=trades-hall&room=reception-room", waitFor: "canvas", seedRole: "staff" },
  { name: "public-room", path: "/venues/trades-hall/rooms/reception-room", waitFor: "main", seedRole: null },
  { name: "dashboard", path: "/dashboard", waitFor: "#dashboard-main", seedRole: "staff" },
  { name: "event-day-ops", path: `/ops/events/${EVENT_ID}`, waitFor: ".event-day-page", seedRole: "hallkeeper" },
  { name: "proposal-share", path: "/proposal-share/e2e-share-token", waitFor: "main", seedRole: null },
];

function seedUser(role) {
  if (role === null) return null;
  return {
    id: `e2e-${role}`,
    email: `${role}@e2e.test`,
    role,
    venueId: VENUE_ID,
    name: role === "hallkeeper" ? "E2E Hallkeeper" : "E2E Planner",
  };
}

function taskFixture(status = "todo") {
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

function eventDayBoardFixture() {
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
    phases: [{
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
    }],
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
      supplierInstructions: [{
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
      }],
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
    setupProgress: { totalTasks: 1, doneTasks: 0, blockedTasks: 0, activeTasks: 1, percent: 0 },
    supplierArrivals: [{
      instructionId: "00000000-0000-4000-8000-000000004010",
      title: "Catering arrival",
      category: "catering",
      arrivalWindow: "16:00-16:30",
      detail: "Confirm arrival at staff entrance.",
      statusLabel: "Expected 16:00-16:30",
    }],
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

async function setupMocks(page, role) {
  const user = seedUser(role);
  if (user !== null) {
    await page.addInitScript((seed) => {
      Object.defineProperty(window, "__OMNITWIN_E2E__", { value: true, writable: false });
      Object.defineProperty(window, "__OMNITWIN_SEED_USER__", { value: seed, writable: false });
    }, user);
  }

  await page.route(`${API}/public/configurations/cfg-perf-grand-hall`, (route) => {
    void route.fulfill({
      json: {
        data: {
          id: "cfg-perf-grand-hall",
          spaceId: "e2e-space-grand",
          venueId: VENUE_ID,
          userId: null,
          name: "Frame budget Grand Hall",
          isPublicPreview: true,
          revision: 1,
          objects: [],
        },
      },
    });
  });

  await page.route(`${API}/assets/runtime-packages/latest?*`, (route) => {
    void route.fulfill({ json: { data: null } });
  });

  await page.route(`${API}/assets/runtime-packages/public-room-visual?*`, (route) => {
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

  await page.route(`${API}/notifications*`, (route) => {
    void route.fulfill({ json: { data: [] } });
  });
  await page.route(`${API}/enquiries*`, (route) => {
    void route.fulfill({ json: { data: [] } });
  });
  await page.route(`${API}/events/${EVENT_ID}/ops-board`, (route) => {
    void route.fulfill({ json: { data: eventDayBoardFixture() } });
  });
  await page.route(`${API}/events/${EVENT_ID}/change-feed*`, (route) => {
    void route.fulfill({ json: { data: [] } });
  });
  await page.route(`${API}/ops-tasks/${TASK_ID}/status`, (route) => {
    void route.fulfill({ json: { data: taskFixture("done") } });
  });
  await page.route(`${API}/proposal-share/e2e-share-token`, (route) => {
    void route.fulfill({
      json: {
        data: {
          title: "Reception Room wedding proposal",
          status: "sent",
          sentAt: NOW,
          venueName: "Trades Hall Glasgow",
          clientMessage: "Review the current proposal draft and request changes if needed.",
          capacityNote: "Human review required before final operational sign-off.",
          roomSummary: "Reception Room",
          layoutSummary: "Dinner layout with guest comfort protected.",
          packageSummary: ["Dinner package", "Late-night extension"],
          quote: null,
          version: 1,
          comments: [],
          packages: [],
          layoutSnapshot: null,
        },
      },
    });
  });
}

async function sampleFrames(page, durationMs) {
  return page.evaluate((sampleDuration) => new Promise((resolve) => {
    const deltas = [];
    let start = 0;
    let previous = 0;
    const tick = (now) => {
      if (start === 0) {
        start = now;
        previous = now;
      } else {
        deltas.push(now - previous);
        previous = now;
      }
      if (now - start >= sampleDuration) {
        resolve(deltas);
        return;
      }
      window.requestAnimationFrame(tick);
    };
    window.requestAnimationFrame(tick);
  }), durationMs);
}

function percentile(values, p) {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1);
  return sorted[index] ?? 0;
}

function sustainedOverBudget(values) {
  let current = 0;
  let longest = 0;
  for (const value of values) {
    if (value > BUDGET_MS) {
      current += 1;
      longest = Math.max(longest, current);
    } else {
      current = 0;
    }
  }
  return longest;
}

function summarize(values) {
  const average = values.length === 0 ? 0 : values.reduce((sum, value) => sum + value, 0) / values.length;
  return {
    samples: values.length,
    averageMs: Number(average.toFixed(2)),
    p95Ms: Number(percentile(values, 95).toFixed(2)),
    p99Ms: Number(percentile(values, 99).toFixed(2)),
    maxMs: Number(Math.max(0, ...values).toFixed(2)),
    fpsFromAverage: average === 0 ? 0 : Number((1000 / average).toFixed(1)),
    framesOverBudget: values.filter((value) => value > BUDGET_MS).length,
    longestSustainedOverBudget: sustainedOverBudget(values),
  };
}

async function interact(page) {
  const canvas = page.locator("canvas").first();
  if (await canvas.count() > 0) {
    const box = await canvas.boundingBox();
    if (box !== null) {
      const x = box.x + box.width * 0.5;
      const y = box.y + box.height * 0.5;
      await page.mouse.move(x, y);
      await page.mouse.down();
      await page.mouse.move(x + Math.min(180, box.width * 0.2), y + 30, { steps: 12 });
      await page.mouse.up();
      return;
    }
  }
  await page.mouse.wheel(0, 900);
  const button = page.locator("button,a").first();
  if (await button.count() > 0) {
    await button.hover().catch(() => undefined);
  }
}

function cdpMetricMap(metrics) {
  return Object.fromEntries(metrics.metrics.map((metric) => [metric.name, metric.value]));
}

async function run() {
  const browser = await chromium.launch({ headless: true });
  const results = [];
  try {
    for (const viewport of viewports) {
      for (const route of routes) {
        const context = await browser.newContext({
          viewport: { width: viewport.width, height: viewport.height },
          deviceScaleFactor: viewport.deviceScaleFactor,
          isMobile: viewport.isMobile,
        });
        const page = await context.newPage();
        await setupMocks(page, route.seedRole);
        const cdp = await context.newCDPSession(page);
        await cdp.send("Performance.enable");
        const pageErrors = [];
        page.on("pageerror", (error) => { pageErrors.push(error.message); });
        await page.goto(`${BASE_URL}${route.path}`, { waitUntil: "domcontentloaded", timeout: 30_000 });
        await page.waitForSelector(route.waitFor, { timeout: 20_000 }).catch(() => undefined);
        await page.waitForTimeout(700);
        const beforeMetrics = cdpMetricMap(await cdp.send("Performance.getMetrics"));
        const idleFrames = await sampleFrames(page, SAMPLE_MS);
        await interact(page);
        const interactionFrames = await sampleFrames(page, SAMPLE_MS);
        const afterMetrics = cdpMetricMap(await cdp.send("Performance.getMetrics"));
        const idle = summarize(idleFrames);
        const interaction = summarize(interactionFrames);
        const passed = idle.p95Ms <= PASS_P95_MS && interaction.p95Ms <= PASS_P95_MS && pageErrors.length === 0;
        results.push({
          route: route.name,
          path: route.path,
          viewport: viewport.name,
          width: viewport.width,
          height: viewport.height,
          deviceScaleFactor: viewport.deviceScaleFactor,
          targetBudgetMs: BUDGET_MS,
          passP95Ms: PASS_P95_MS,
          passed,
          idle,
          interaction,
          pageErrors,
          cdp: {
            jsHeapUsedDelta: Number(((afterMetrics.JSHeapUsedSize ?? 0) - (beforeMetrics.JSHeapUsedSize ?? 0)).toFixed(0)),
            taskDurationDelta: Number(((afterMetrics.TaskDuration ?? 0) - (beforeMetrics.TaskDuration ?? 0)).toFixed(4)),
          },
        });
        await cdp.detach();
        await context.close();
      }
    }
  } finally {
    await browser.close();
  }

  const report = {
    generatedAt: new Date().toISOString(),
    baseUrl: BASE_URL,
    mode: "playwright-raf-with-cdp-performance-metrics",
    note: "Protected routes use the existing dev-only E2E auth seed hook. Public Reception Room is mocked as no public runtime visual until T-453 exposure evidence exists.",
    routes: results,
  };

  await mkdir(dirname(OUTPUT_FILE), { recursive: true });
  await writeFile(OUTPUT_FILE, JSON.stringify(report, null, 2));

  const failed = results.filter((result) => !result.passed);
  console.log(JSON.stringify({
    outputFile: OUTPUT_FILE,
    routeCount: results.length,
    failed: failed.map((result) => ({
      route: result.route,
      viewport: result.viewport,
      idleP95Ms: result.idle.p95Ms,
      interactionP95Ms: result.interaction.p95Ms,
      pageErrors: result.pageErrors,
    })),
  }, null, 2));

  if (FAIL_ON_BUDGET && failed.length > 0) {
    process.exitCode = 1;
  }
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
