import { chromium } from "@playwright/test";
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

// ---------------------------------------------------------------------------
// The planner device matrix: what moving furniture actually costs, per device.
//
// frame-budget-pass.mjs measures under SwiftShader with mocked APIs, which is
// right for a regression gate and blind to a real GPU. splat-drag-budget.mjs
// measures the walk route. Neither measures the thing this lane is about: a
// finger dragging a chair around a captured room with a hundred of them in it.
//
// So this drives /plan on the REAL GPU (headed Chromium, no software
// rendering) against a stubbed backend serving the Reception Room with a
// seeded hundred-chair layout, and reads the ?perf=1 frame-interval sampler
// this lane added to window.__venPerf. It measures phases separately — an idle
// demand loop, a camera orbit, a touch drag of one chair — because they cost
// very different things and one blended number would hide all three.
//
//   node scripts/planner-device-matrix.mjs
//   DEVICE_MATRIX_LABEL=rtx-4090 DEVICE_MATRIX_CHAIRS=100 node scripts/planner-device-matrix.mjs
//
// It records what it measured and nothing else. A device nobody has run this
// on stays out of the JSON: the roster of unmeasured devices is written by
// hand alongside it and never inferred from a machine that was not there.
// ---------------------------------------------------------------------------

const BASE_URL = process.env.DEVICE_MATRIX_BASE_URL ?? "http://127.0.0.1:5193";
const LABEL = process.env.DEVICE_MATRIX_LABEL ?? "unlabelled";
const GPU = process.env.DEVICE_MATRIX_GPU ?? "unknown";
const OUT_DIR = process.env.DEVICE_MATRIX_OUT_DIR ?? "D:/claude/device-matrix";
const CHAIRS = Number(process.env.DEVICE_MATRIX_CHAIRS ?? "100");
const WIDTH = Number(process.env.DEVICE_MATRIX_WIDTH ?? "1600");
const HEIGHT = Number(process.env.DEVICE_MATRIX_HEIGHT ?? "900");
const DPR = Number(process.env.DEVICE_MATRIX_DPR ?? "1");
const HEADLESS = process.env.DEVICE_MATRIX_HEADLESS === "true";
const LOAD_TIMEOUT_MS = Number(process.env.DEVICE_MATRIX_LOAD_TIMEOUT_MS ?? "180000");
const SETTLE_MS = Number(process.env.DEVICE_MATRIX_SETTLE_MS ?? "20000");
const PHASE_MS = Number(process.env.DEVICE_MATRIX_PHASE_MS ?? "4000");

const DESCRIPTOR = "src/data/generated/trades-hall-splat-bundles.ts";
const ROOM_SLUG = "reception-room";
const ASSET_PREFIX = `/splats/trades-hall/${ROOM_SLUG}/`;
const PUBLISHED_ORIGIN = "https://pub-2bf1ea54c4c642d3b19067b97c55dc5d.r2.dev";
const CAPTURE_CACHE = join(OUT_DIR, "capture-cache");

const API = "http://localhost:3001";
const VENUE_ID = "matrix-venue-trades";
const SPACE_ID = "matrix-space-reception";
const CONFIG_ID = "matrix-config-reception";
/** Checked-in canonical asset: packages/types/src/asset-catalogue.ts. */
const BANQUET_CHAIR = "4dfcae64-b6e3-54f8-817f-af041edab935";

const VENUE = {
  id: VENUE_ID, name: "Trades Hall", slug: "trades-hall-glasgow",
  address: "85 Glassford Street", logoUrl: null, brandColour: null,
};
const RECEPTION_ROOM = {
  id: SPACE_ID, venueId: VENUE_ID, name: "Reception Room", slug: "reception-room",
  widthM: "13.4", lengthM: "11.2", heightM: "3.2",
  floorPlanOutline: [{ x: 0, y: 0 }, { x: 13.4, y: 0 }, { x: 13.4, y: 11.2 }, { x: 0, y: 11.2 }],
};

/**
 * A hundred chairs as ten rows of ten, inset from the walls.
 *
 * Deliberately a grid rather than round tables: a grid is reproducible on any
 * device on any day, and the matrix exists to compare machines, not to flatter
 * the scene. Positions are metres in room space; the wire format is strings,
 * as the API sends them.
 */
function seededChairs(count) {
  const perRow = 10;
  const originX = 2.2;
  const originZ = 2.2;
  const pitch = 0.95;
  return Array.from({ length: count }, (_, index) => {
    const row = Math.floor(index / perRow);
    const column = index % perRow;
    return {
      id: `matrix-chair-${String(index).padStart(3, "0")}`,
      assetId: BANQUET_CHAIR,
      positionX: (originX + column * pitch).toFixed(3),
      positionY: "0",
      positionZ: (originZ + row * pitch).toFixed(3),
      rotationZ: "0",
      scale: "1",
      sortOrder: index,
      metadata: {},
    };
  });
}

const CONFIG = {
  id: CONFIG_ID, spaceId: SPACE_ID, venueId: VENUE_ID, userId: null,
  name: "Device matrix - 100 chairs", isPublicPreview: true, revision: 1,
  objects: seededChairs(CHAIRS),
};

/**
 * The room's real capture bytes, pinned to the checked-in descriptor.
 *
 * A production preview build has no `/splats` middleware — in production that
 * path is a same-origin rewrite to R2, and R2 sends no CORS headers, so the
 * page cannot be pointed straight at the bucket. These are fetched here once,
 * SHA-256 checked against the descriptor, cached, and fulfilled from memory.
 *
 * The delivery ladder (T-581) asks for three sets, so all three are staged:
 * the sky shell, the coarsest room level as the coarse cover, and the finest
 * level. Staging only two is exactly what makes the capture e2e fixture reject
 * `0_0.sog`, and a matrix that measured a room with no coarse cover would be
 * measuring a different load than the one a guest gets.
 */
async function captureTiles() {
  const source = await readFile(DESCRIPTOR, "utf8");
  const start = source.indexOf("[", source.indexOf("GENERATED_ROOM_SPLAT_BUNDLES"));
  const end = source.lastIndexOf("] as const;");
  if (start === -1 || end === -1) throw new Error(`Cannot read ${DESCRIPTOR}`);
  const bundles = JSON.parse(source.slice(start, end + 1));
  const bundle = bundles.find((room) => room.roomSlug === ROOM_SLUG);
  if (bundle === undefined) throw new Error(`${ROOM_SLUG} is not in the descriptor`);
  const roomLevels = bundle.tiles
    .filter((tile) => !tile.isEnvironment && tile.lodLevel !== null)
    .map((tile) => tile.lodLevel);
  const coarsest = Math.min(...roomLevels);
  const wanted = bundle.tiles.filter((tile) => tile.isEnvironment
    || tile.lodLevel === bundle.finestLevel
    || tile.lodLevel === coarsest);

  await mkdir(CAPTURE_CACHE, { recursive: true });
  const bytes = new Map();
  for (const tile of wanted) {
    const path = join(CAPTURE_CACHE, tile.sha256);
    const matches = (buffer) => buffer.length === tile.bytes
      && createHash("sha256").update(buffer).digest("hex") === tile.sha256;
    let buffer = null;
    try {
      const cached = await readFile(path);
      if (matches(cached)) buffer = cached;
    } catch (error) {
      if (error?.code !== "ENOENT") throw error;
    }
    if (buffer === null) {
      const response = await fetch(`${PUBLISHED_ORIGIN}${ASSET_PREFIX}${tile.file}`, {
        signal: AbortSignal.timeout(120_000),
      });
      if (!response.ok) throw new Error(`Capture tile ${tile.file}: HTTP ${String(response.status)}`);
      buffer = Buffer.from(await response.arrayBuffer());
      if (!matches(buffer)) throw new Error(`Capture tile ${tile.file} differs from its descriptor`);
      await writeFile(path, buffer);
    }
    bytes.set(tile.file, buffer);
  }
  return { bytes, files: wanted.map((tile) => tile.file), coarseLevel: coarsest, finestLevel: bundle.finestLevel };
}

async function stubCaptureTiles(page, tiles, requested) {
  await page.route(`**${ASSET_PREFIX}*`, async (route) => {
    const file = new URL(route.request().url()).pathname.slice(ASSET_PREFIX.length);
    const body = tiles.bytes.get(file);
    if (body === undefined) {
      // Loud rather than silent: a 404 here means the ladder asked for a tile
      // this staging does not know about, which is a finding, not a fixture
      // detail to paper over.
      requested.push(`MISSING ${file}`);
      await route.fulfill({ status: 404, body: "" });
      return;
    }
    requested.push(file);
    await route.fulfill({
      status: 200,
      contentType: "application/octet-stream",
      headers: { "Cache-Control": "no-store" },
      body,
    });
  });
}

async function stubBackend(page) {
  const json = (data) => (route) => { void route.fulfill({ json: { data } }); };
  await page.route(`${API}/venues`, json([VENUE]));
  await page.route(`${API}/venues/${VENUE_ID}`, json({ ...VENUE, spaces: [RECEPTION_ROOM] }));
  await page.route(`${API}/venues/${VENUE_ID}/spaces`, json([RECEPTION_ROOM]));
  await page.route(`${API}/venues/${VENUE_ID}/spaces/${SPACE_ID}`, json(RECEPTION_ROOM));
  await page.route(`${API}/public/configurations`, json(CONFIG));
  await page.route(`${API}/public/configurations/${CONFIG_ID}`, json(CONFIG));
  await page.route(`${API}/public/configurations/${CONFIG_ID}/objects`, json(CONFIG.objects));
  // Anything else on the API origin gets an empty, successful envelope. A
  // failed request would put the planner into an error state, and then this
  // would be measuring the error state.
  await page.route(`${API}/**`, (route) => { void route.fulfill({ json: { data: null } }); });
}

/** Run one phase: reset the sampler, do something, read the distribution back. */
async function phase(page, name, body) {
  await page.evaluate(() => { window.__venPerf?.sample?.(); });
  await body();
  const summary = await page.evaluate(() => window.__venPerf?.summary?.() ?? null);
  if (summary === null) {
    throw new Error(`Phase ${name}: window.__venPerf.summary is absent - is ?perf=1 on the URL?`);
  }
  return summary;
}

async function main() {
  const browser = await chromium.launch({
    headless: HEADLESS,
    // Real GPU. The whole measurement is void under SwiftShader.
    args: ["--ignore-gpu-blocklist", "--enable-gpu-rasterization", "--enable-zero-copy"],
  });
  const context = await browser.newContext({
    viewport: { width: WIDTH, height: HEIGHT },
    deviceScaleFactor: DPR,
  });
  const page = await context.newPage();
  const consoleErrors = [];
  page.on("console", (message) => {
    if (message.type() === "error") consoleErrors.push(message.text().slice(0, 300));
  });

  const tiles = await captureTiles();
  const requestedTiles = [];

  try {
    await stubBackend(page);
    await stubCaptureTiles(page, tiles, requestedTiles);
    await page.goto(`${BASE_URL}/plan?perf=1&capture=1`, { timeout: LOAD_TIMEOUT_MS });
    await page.waitForSelector("canvas", { timeout: LOAD_TIMEOUT_MS });
    // Wait for the room to actually resolve, then settle: the coarse-to-fine
    // develop is its own workload and would contaminate every phase below.
    // Waiting on the phase rather than a fixed sleep means a slow decode
    // delays the measurement instead of silently polluting it.
    const resolved = await page
      .waitForFunction(
        () => document.querySelector("[data-resolve-phase]")?.getAttribute("data-resolve-phase") === "resolved",
        undefined,
        { timeout: LOAD_TIMEOUT_MS },
      )
      .then(() => true)
      .catch(() => false);
    await page.waitForTimeout(SETTLE_MS);

    const box = await page.locator("canvas").first().boundingBox();
    if (box === null) throw new Error("The planner canvas has no box to drive");
    const centreX = box.x + box.width / 2;
    const centreY = box.y + box.height / 2;

    const phases = {};

    phases.idle = await phase(page, "idle", async () => {
      await page.waitForTimeout(PHASE_MS);
    });

    phases.cameraOrbit = await phase(page, "cameraOrbit", async () => {
      // Right button is the desktop orbit; LEFT is reserved for selection.
      await page.mouse.move(centreX, centreY);
      await page.mouse.down({ button: "right" });
      const steps = 60;
      for (let step = 0; step < steps; step += 1) {
        const angle = (step / steps) * Math.PI * 2;
        await page.mouse.move(centreX + Math.cos(angle) * 220, centreY + Math.sin(angle) * 90);
        await page.waitForTimeout(PHASE_MS / steps);
      }
      await page.mouse.up({ button: "right" });
    });

    phases.touchDragChair = await phase(page, "touchDragChair", async () => {
      // Tap once to select, then drag: the gesture this lane added. Driven
      // through CDP so the pointer really is a touch and not a mouse.
      const session = await context.newCDPSession(page);
      const touch = async (type, x, y) => {
        await session.send("Input.dispatchTouchEvent", {
          type,
          touchPoints: type === "touchEnd" ? [] : [{ x, y, id: 1 }],
        });
      };
      await touch("touchStart", centreX, centreY);
      await touch("touchEnd", centreX, centreY);
      await page.waitForTimeout(250);
      await touch("touchStart", centreX, centreY);
      const steps = 60;
      for (let step = 1; step <= steps; step += 1) {
        await touch("touchMove", centreX + step * 3, centreY + Math.sin(step / 6) * 40);
        await page.waitForTimeout(PHASE_MS / steps);
      }
      await touch("touchEnd", centreX, centreY);
      await session.detach();
    });

    const record = {
      schema: "venviewer.device-matrix/1",
      capturedAtIso: new Date().toISOString(),
      device: {
        label: LABEL,
        gpu: GPU,
        browser: `chromium ${browser.version()}`,
        headless: HEADLESS,
        viewport: { width: WIDTH, height: HEIGHT },
        deviceScaleFactor: DPR,
      },
      scene: {
        room: "Reception Room",
        chairs: CHAIRS,
        route: "/plan?perf=1&capture=1",
        backend: "stubbed (no live API)",
        capture: {
          resolved,
          coarseLevel: tiles.coarseLevel,
          finestLevel: tiles.finestLevel,
          staged: tiles.files,
          requested: [...new Set(requestedTiles)],
        },
      },
      phases,
      consoleErrors,
      notes: [
        "Frames are counted only while the demand loop drew. fpsFromMedian is the median frame interval expressed as a rate, not a refresh-rate claim.",
        "Measured on this machine only. Every other device stays unmeasured until someone runs this on it.",
        "Capture bytes are the published Reception Room tiles, SHA-256 checked against the checked-in descriptor and fulfilled from a local cache; no production service is written to.",
        resolved
          ? "The room reached data-resolve-phase=resolved before any phase was measured."
          : "WARNING: the room did NOT reach data-resolve-phase=resolved; these numbers do not describe a fully resolved room.",
      ],
    };

    await mkdir(OUT_DIR, { recursive: true });
    const path = join(OUT_DIR, `${LABEL}-reception-${String(CHAIRS)}chairs.json`);
    await writeFile(path, `${JSON.stringify(record, null, 2)}\n`, "utf8");
    // eslint-disable-next-line no-console
    console.log(`wrote ${path}`);
    // eslint-disable-next-line no-console
    console.log(JSON.stringify(phases, null, 2));
  } finally {
    await context.close();
    await browser.close();
  }
}

await main();
