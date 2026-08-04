import { chromium } from "@playwright/test";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

const BASE_URL = process.env.E2E_BASE_URL ?? "http://127.0.0.1:5173";
const API = process.env.VITE_API_URL ?? "http://localhost:3001";
const OUTPUT_FILE = process.env.FRAME_BUDGET_OUTPUT ?? "C:/tmp/venviewer-frame-budget-latest.json";
const TRACE_DIR = process.env.FRAME_BUDGET_TRACE_DIR ?? null;
const SAMPLE_MS = Number(process.env.FRAME_BUDGET_SAMPLE_MS ?? "1800");
const SETTLE_MS = Number(process.env.FRAME_BUDGET_SETTLE_MS ?? "1800");
const BUDGET_MS = 16.7;
const PASS_P95_MS = Number(process.env.FRAME_BUDGET_PASS_P95_MS ?? "18.5");
const FAIL_ON_BUDGET = process.env.FRAME_BUDGET_FAIL === "true";
const ROUTE_FILTER = process.env.FRAME_BUDGET_ROUTE ?? null;
const VIEWPORT_FILTER = process.env.FRAME_BUDGET_VIEWPORT ?? null;
const WARMUP_INTERACTION = process.env.FRAME_BUDGET_WARMUP_INTERACTION !== "false";
const CPU_PROFILE = process.env.FRAME_BUDGET_CPU_PROFILE === "true";

const NOW = "2026-06-18T12:00:00.000Z";
const VENUE_ID = "00000000-0000-4000-8000-000000004003";
const SPACE_ID = "e2e-space-grand";
const EVENT_ID = "00000000-0000-4000-8000-000000004001";
const TASK_ID = "00000000-0000-4000-8000-000000004002";
const PACK_ID = "00000000-0000-4000-8000-000000004004";
const HASH = "a".repeat(64);

const SPACE_FIXTURE = {
  id: SPACE_ID,
  venueId: VENUE_ID,
  name: "Grand Hall",
  slug: "grand-hall",
  widthM: "21",
  lengthM: "10.5",
  heightM: "7",
  floorPlanOutline: [
    { x: -10.5, y: -5.25 },
    { x: 10.5, y: -5.25 },
    { x: 10.5, y: 5.25 },
    { x: -10.5, y: 5.25 },
  ],
  loadoutCount: 0,
};

function configurationFixture() {
  return {
    data: {
      id: "cfg-perf-grand-hall",
      spaceId: SPACE_ID,
      venueId: VENUE_ID,
      userId: null,
      name: "Frame budget Grand Hall",
      isPublicPreview: true,
      revision: 1,
      objects: [],
    },
  };
}

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
    void route.fulfill({ json: configurationFixture() });
  });

  await page.route(`${API}/configurations/cfg-perf-grand-hall`, (route) => {
    void route.fulfill({ json: configurationFixture() });
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
          spaces: [SPACE_FIXTURE],
        },
      },
    });
  });

  await page.route(`${API}/venues/${VENUE_ID}/spaces`, (route) => {
    void route.fulfill({ json: { data: [SPACE_FIXTURE] } });
  });

  await page.route(`${API}/venues/${VENUE_ID}/spaces/${SPACE_ID}`, (route) => {
    void route.fulfill({ json: { data: SPACE_FIXTURE } });
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

async function startLongTaskCollection(page) {
  await page.evaluate(() => {
    window.__VENVIEWER_FRAME_BUDGET_LONG_TASKS__ = [];
    window.__VENVIEWER_FRAME_BUDGET_LONG_TASK_START__ = performance.now();
    if (typeof PerformanceObserver === "undefined") return;
    try {
      const observer = new PerformanceObserver((list) => {
        const sink = window.__VENVIEWER_FRAME_BUDGET_LONG_TASKS__;
        if (!Array.isArray(sink)) return;
        const collectionStart = Number(window.__VENVIEWER_FRAME_BUDGET_LONG_TASK_START__ ?? 0);
        for (const entry of list.getEntries()) {
          if (entry.startTime < collectionStart - 1) continue;
          sink.push({
            name: entry.name,
            startTime: Math.round(entry.startTime),
            duration: Math.round(entry.duration),
            attribution: "attribution" in entry ? entry.attribution : [],
          });
        }
      });
      observer.observe({ type: "longtask", buffered: true });
      window.__VENVIEWER_FRAME_BUDGET_LONG_TASK_OBSERVER__ = observer;
    } catch {
      // Long Task API is optional in Chromium contexts.
    }
  });
}

async function stopLongTaskCollection(page) {
  return page.evaluate(() => {
    const observer = window.__VENVIEWER_FRAME_BUDGET_LONG_TASK_OBSERVER__;
    if (observer !== undefined && typeof observer.disconnect === "function") {
      observer.disconnect();
    }
    const tasks = window.__VENVIEWER_FRAME_BUDGET_LONG_TASKS__;
    if (!Array.isArray(tasks)) return [];
    return tasks
      .slice()
      .sort((a, b) => b.duration - a.duration)
      .slice(0, 12);
  });
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

async function dispatchTouchDrag(cdp, x, y, deltaX, deltaY) {
  const touchPoint = (step) => ({
    x: x + deltaX * step,
    y: y + deltaY * step,
    radiusX: 3,
    radiusY: 3,
    force: 0.8,
    id: 1,
  });

  await cdp.send("Input.dispatchTouchEvent", {
    type: "touchStart",
    touchPoints: [touchPoint(0)],
  });

  for (let step = 1; step <= 12; step += 1) {
    await cdp.send("Input.dispatchTouchEvent", {
      type: "touchMove",
      touchPoints: [touchPoint(step / 12)],
    });
    await new Promise((resolve) => { setTimeout(resolve, 16); });
  }

  await cdp.send("Input.dispatchTouchEvent", {
    type: "touchEnd",
    touchPoints: [],
  });
}

function mouseButtonBits(button) {
  if (button === "left") return 1;
  if (button === "right") return 2;
  if (button === "middle") return 4;
  return 0;
}

async function dispatchCdpMouseDrag(cdp, x, y, deltaX, deltaY, button) {
  const buttons = mouseButtonBits(button);
  await cdp.send("Input.dispatchMouseEvent", {
    type: "mouseMoved",
    x,
    y,
    button: "none",
    buttons: 0,
  });
  await cdp.send("Input.dispatchMouseEvent", {
    type: "mousePressed",
    x,
    y,
    button,
    buttons,
    clickCount: 1,
  });
  for (let step = 1; step <= 12; step += 1) {
    const progress = step / 12;
    await cdp.send("Input.dispatchMouseEvent", {
      type: "mouseMoved",
      x: x + deltaX * progress,
      y: y + deltaY * progress,
      button,
      buttons,
    });
    await new Promise((resolve) => { setTimeout(resolve, 16); });
  }
  await cdp.send("Input.dispatchMouseEvent", {
    type: "mouseReleased",
    x: x + deltaX,
    y: y + deltaY,
    button,
    buttons: 0,
    clickCount: 1,
  });
}

async function elementAtPoint(page, x, y) {
  return page.evaluate(({ pointX, pointY }) => {
    const element = document.elementFromPoint(pointX, pointY);
    if (element === null) {
      return { tagName: null, id: null, className: null, testId: null, floatingWidgetId: null, ariaLabel: null };
    }
    return {
      tagName: element.tagName.toLowerCase(),
      id: element.id || null,
      className: typeof element.className === "string" ? element.className : null,
      testId: element.getAttribute("data-testid"),
      floatingWidgetId: element.getAttribute("data-floating-widget-id"),
      ariaLabel: element.getAttribute("aria-label"),
    };
  }, { pointX: x, pointY: y });
}

async function pickCanvasPoint(page, box) {
  const candidates = [
    [0.5, 0.43],
    [0.44, 0.42],
    [0.58, 0.42],
    [0.66, 0.36],
    [0.36, 0.5],
    [0.5, 0.5],
  ];

  for (const [xRatio, yRatio] of candidates) {
    const x = box.x + box.width * xRatio;
    const y = box.y + box.height * yRatio;
    const target = await elementAtPoint(page, x, y);
    if (target.tagName === "canvas") {
      return { x, y, target, usedFallback: false };
    }
  }

  const fallbackX = box.x + box.width * 0.5;
  const fallbackY = box.y + box.height * 0.5;
  return {
    x: fallbackX,
    y: fallbackY,
    target: await elementAtPoint(page, fallbackX, fallbackY),
    usedFallback: true,
  };
}

async function interact(page, viewport, cdp) {
  const canvas = page.locator("canvas").first();
  if (await canvas.count() > 0) {
    const box = await canvas.boundingBox();
    if (box !== null) {
      const point = await pickCanvasPoint(page, box);
      if (viewport.isMobile) {
        await dispatchTouchDrag(cdp, point.x, point.y, Math.min(90, box.width * 0.18), 24);
        return {
          kind: "touch-camera-drag",
          x: Number(point.x.toFixed(1)),
          y: Number(point.y.toFixed(1)),
          target: point.target,
          usedFallback: point.usedFallback,
        };
      }
      await dispatchCdpMouseDrag(cdp, point.x, point.y, Math.min(180, box.width * 0.2), 30, "right");
      return {
        kind: "cdp-right-drag-camera-orbit",
        x: Number(point.x.toFixed(1)),
        y: Number(point.y.toFixed(1)),
        target: point.target,
        usedFallback: point.usedFallback,
      };
    }
  }
  await page.mouse.wheel(0, 900);
  const button = page.locator("button,a").first();
  if (await button.count() > 0) {
    await button.hover().catch(() => undefined);
  }
  return { kind: "scroll-and-hover", target: null, usedFallback: true };
}

function cdpMetricMap(metrics) {
  return Object.fromEntries(metrics.metrics.map((metric) => [metric.name, metric.value]));
}

function summarizeCpuProfile(profile) {
  if (!Array.isArray(profile.samples) || !Array.isArray(profile.timeDeltas)) return [];
  const nodes = new Map(profile.nodes.map((node) => [node.id, node]));
  const timeByNode = new Map();
  for (let index = 0; index < profile.samples.length; index += 1) {
    const nodeId = profile.samples[index];
    const deltaUs = profile.timeDeltas[index] ?? 0;
    timeByNode.set(nodeId, (timeByNode.get(nodeId) ?? 0) + deltaUs);
  }
  return [...timeByNode.entries()]
    .map(([nodeId, timeUs]) => {
      const node = nodes.get(nodeId);
      const frame = node?.callFrame ?? {};
      return {
        functionName: frame.functionName || "(anonymous)",
        url: frame.url || "(internal)",
        lineNumber: typeof frame.lineNumber === "number" ? frame.lineNumber + 1 : null,
        timeMs: Number((timeUs / 1000).toFixed(1)),
      };
    })
    .filter((entry) => entry.timeMs > 1)
    .sort((a, b) => b.timeMs - a.timeMs)
    .slice(0, 16);
}

async function readCdpStream(cdp, handle) {
  const chunks = [];
  let eof = false;
  while (!eof) {
    const chunk = await cdp.send("IO.read", { handle });
    if (chunk.base64Encoded === true) {
      chunks.push(Buffer.from(chunk.data, "base64").toString("utf8"));
    } else {
      chunks.push(chunk.data);
    }
    eof = chunk.eof === true;
  }
  await cdp.send("IO.close", { handle });
  return chunks.join("");
}

async function startTrace(cdp, outputPath) {
  const complete = new Promise((resolve) => {
    cdp.once("Tracing.tracingComplete", async (event) => {
      if (typeof event.stream !== "string") {
        resolve(null);
        return;
      }
      const trace = await readCdpStream(cdp, event.stream);
      await mkdir(dirname(outputPath), { recursive: true });
      await writeFile(outputPath, trace);
      resolve(outputPath);
    });
  });
  await cdp.send("Tracing.start", {
    transferMode: "ReturnAsStream",
    categories: [
      "devtools.timeline",
      "disabled-by-default-devtools.timeline",
      "blink.user_timing",
      "toplevel",
      "v8",
      "cc",
      "gpu",
    ].join(","),
  });
  return complete;
}

async function run() {
  const browser = await chromium.launch({
    headless: true,
    args: ["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"],
  });
  const results = [];
  const selectedViewports = VIEWPORT_FILTER === null
    ? viewports
    : viewports.filter((viewport) => viewport.name === VIEWPORT_FILTER);
  const selectedRoutes = ROUTE_FILTER === null
    ? routes
    : routes.filter((route) => route.name === ROUTE_FILTER);
  try {
    for (const viewport of selectedViewports) {
      for (const route of selectedRoutes) {
        const context = await browser.newContext({
          viewport: { width: viewport.width, height: viewport.height },
          deviceScaleFactor: viewport.deviceScaleFactor,
          isMobile: viewport.isMobile,
          hasTouch: viewport.isMobile,
        });
        const page = await context.newPage();
        await setupMocks(page, route.seedRole);
        const cdp = await context.newCDPSession(page);
        await cdp.send("Performance.enable");
        const pageErrors = [];
        page.on("pageerror", (error) => { pageErrors.push(error.message); });
        await page.goto(`${BASE_URL}${route.path}`, { waitUntil: "domcontentloaded", timeout: 30_000 });
        const waitForFound = await page.waitForSelector(route.waitFor, { timeout: 20_000 })
          .then(() => true)
          .catch(() => false);
        await page.waitForTimeout(SETTLE_MS);
        let warmupTarget = null;
        if (WARMUP_INTERACTION && waitForFound) {
          warmupTarget = await interact(page, viewport, cdp);
          await page.waitForTimeout(900);
        }
        if (CPU_PROFILE) {
          await cdp.send("Profiler.enable");
        }
        const beforeMetrics = cdpMetricMap(await cdp.send("Performance.getMetrics"));
        await startLongTaskCollection(page);
        if (CPU_PROFILE) {
          await cdp.send("Profiler.start");
        }
        const idleFrames = await sampleFrames(page, SAMPLE_MS);
        const idleCpuProfile = CPU_PROFILE
          ? summarizeCpuProfile((await cdp.send("Profiler.stop")).profile)
          : [];
        const idleLongTasks = await stopLongTaskCollection(page);
        const tracePath = TRACE_DIR === null
          ? null
          : `${TRACE_DIR.replace(/[\\/]$/u, "")}/${route.name}-${viewport.name}-interaction-trace.json`;
        const traceComplete = tracePath === null ? null : await startTrace(cdp, tracePath);
        await startLongTaskCollection(page);
        if (CPU_PROFILE) {
          await cdp.send("Profiler.start");
        }
        const interactionFramesPromise = sampleFrames(page, SAMPLE_MS);
        const interactionTarget = await interact(page, viewport, cdp);
        const interactionFrames = await interactionFramesPromise;
        const cpuProfile = CPU_PROFILE
          ? summarizeCpuProfile((await cdp.send("Profiler.stop")).profile)
          : [];
        if (CPU_PROFILE) {
          await cdp.send("Profiler.disable");
        }
        const longTasks = await stopLongTaskCollection(page);
        let traceFile = null;
        if (traceComplete !== null) {
          await cdp.send("Tracing.end");
          traceFile = await traceComplete;
        }
        const afterMetrics = cdpMetricMap(await cdp.send("Performance.getMetrics"));
        const idle = summarize(idleFrames);
        const interaction = summarize(interactionFrames);
        const waitForErrors = waitForFound ? [] : [`Missing expected selector: ${route.waitFor}`];
        const allPageErrors = [...pageErrors, ...waitForErrors];
        const passed = idle.p95Ms <= PASS_P95_MS && interaction.p95Ms <= PASS_P95_MS && allPageErrors.length === 0;
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
          warmupTarget,
          interactionTarget,
          idleLongTasks,
          longTasks,
          idleCpuProfile,
          cpuProfile,
          pageErrors: allPageErrors,
          traceFile,
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
    settleMs: SETTLE_MS,
    warmupInteraction: WARMUP_INTERACTION,
    routeFilter: ROUTE_FILTER,
    viewportFilter: VIEWPORT_FILTER,
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
