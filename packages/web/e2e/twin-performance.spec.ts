import { expect, test, type Page, type Request } from "@playwright/test";
import { deflateSync } from "node:zlib";
import { TwinManifestSchema, type TwinManifest } from "@omnitwin/types";
import type { WebGLRenderer } from "three";
import { TWIN_FIXTURE_MANIFEST_EQUIRECT } from "../src/twin/__fixtures__/twin-fixture.js";
import { ROOM_DISPLAY_NAMES, VERIFIED_ROOM_NODES } from "../src/twin/shell/twin-rooms.js";
import { twinNodeLabel } from "../src/twin/twin-copy.js";

// ---------------------------------------------------------------------------
// The Twin — performance budgets for /tour (defect C3).
//
// WHY THIS FILE EXISTS. There was no performance budget on this route, which
// is how a ~33.5 MB synchronous texture upload per neighbour — unbounded, on
// every arrival — reached production undetected. A unit suite cannot see it:
// there is no GPU in jsdom, no compositor, and no clock that means anything.
//
// WHAT IS BUDGETED, AND WHY THOSE THINGS.
//
//   1. Bytes on arrival, and the number of pano requests behind them.
//      Machine-independent, and it is the lever the defect pulled: 33.5 MB
//      per neighbour only matters because the arrival fetches one pano PER
//      NEIGHBOUR with no cap. A budget on that fan-out fails the moment it
//      grows, on any machine, in any CI.
//   2. The same, at the moment the defect actually fired: one hop.
//   3. Main-thread block during that hop, and frame pacing while orbiting.
//      These are wall-clock and therefore machine-dependent; they are here
//      because a byte budget cannot see a decode or an upload, which is the
//      other half of what went wrong.
//
// THE IMAGERY IS FULL SIZE, ON PURPOSE. e2e/twin-walk.spec.ts serves a 1×1
// WebP for every tile, which is right for a behaviour test and useless for a
// performance one: a 1×1 pano uploads four bytes to the GPU and would have let
// B2 through untouched. This spec synthesises panos at the manifest's real LOD
// ladder — 512×256 and 4096×2048 — so one base pano decodes to exactly the
// 33,554,432 bytes of RGBA the real one does. The bytes are generated, never
// captured: packages/web/public/twin/ is gitignored and does not exist on a CI
// checkout.
//
// HOW THE NUMBERS WERE SET. Every default below was measured on this route
// first and given stated headroom; none is a round number chosen because it
// looked like a budget. The wall-clock budgets are overridable by environment
// variable — following the repo's existing frame-budget specs — so a different
// class of machine gets calibrated deliberately, in the open, rather than by
// quietly loosening this file.
// ---------------------------------------------------------------------------

test.use({
  launchOptions: {
    args: [
      "--use-gl=angle",
      "--use-angle=gl",
      "--enable-unsafe-swiftshader",
      "--ignore-gpu-blocklist",
    ],
  },
  viewport: { width: 1440, height: 900 },
});

// Two live WebGL contexts on one machine measure the runner, not the route.
test.describe.configure({ mode: "default" });

declare global {
  interface Window {
    /** Long-task durations (ms), collected from first paint by an init script. */
    __twinLongTasks?: number[];
    __twinLongTaskObserverReady?: boolean;
    __twinRenderProbe?: {
      arm: () => void;
      finish: () => RenderSample;
    };
  }
}

interface RenderFrame {
  readonly atMs: number;
  readonly frameAdvance: number;
  readonly drawCalls: number;
  readonly cameraWorldMatrix: readonly number[];
}

interface RenderSample {
  readonly startedAtMs: number;
  readonly endedAtMs: number;
  readonly rafTimesMs: readonly number[];
  readonly renders: readonly RenderFrame[];
  readonly trustedPointerMoveTimesMs: readonly number[];
  readonly renderer: string;
  readonly pixelRatio: number;
  readonly drawingBuffer: readonly [number, number];
  readonly contextLost: boolean;
  readonly canvasReplaced: boolean;
}

const MANIFEST_ROUTE = "**/twin/trades-hall/manifest.json";
const TILE_ROUTE = "**/twin/trades-hall/tiles/**";
const MESH_ROUTE = "**/twin/trades-hall/mesh/dollhouse.glb";
const TILE_PREFIX = "/twin/trades-hall/tiles/";

// --- the fixture bundle ----------------------------------------------------

const VALIDATED_IDS: readonly string[] = Object.keys(VERIFIED_ROOM_NODES).sort();
const ENTRY_ID = VALIDATED_IDS[0] ?? "scan_000";
const ENTRY_ROOM_SLUG = VERIFIED_ROOM_NODES[ENTRY_ID];

/** A room to hop to that is not the room we start in — derived, never named. */
const HOP_SLUG = Object.values(VERIFIED_ROOM_NODES).find((slug) => slug !== ENTRY_ROOM_SLUG);

/**
 * The same validated-viewpoint bundle the visual spec uses. The nodes form a
 * chain, so the entry node has exactly ONE graph neighbour: that is the floor
 * of the prefetch fan-out, and it is what the byte budgets are measured
 * against — a change that widens the fan-out shows up immediately instead of
 * hiding inside a fixture that never had neighbours in the first place.
 */
const TOUR_MANIFEST: TwinManifest = TwinManifestSchema.parse({
  ...TWIN_FIXTURE_MANIFEST_EQUIRECT,
  nodes: VALIDATED_IDS.map((id, index) => ({
    id,
    index,
    floor: Math.floor(index / 3),
    pose: { q: [1, 0, 0, 0], t: [index * 2.5, 0, 1.5 + Math.floor(index / 3) * 4] },
    roomSlug: null,
  })),
  edges: VALIDATED_IDS.slice(1).map((id, index) => ({
    a: VALIDATED_IDS[index] ?? id,
    b: id,
    distanceM: 2.5,
  })),
  entryNodeId: ENTRY_ID,
});

// --- synthetic imagery at the real LOD ladder ------------------------------

const CRC_TABLE: readonly number[] = (() => {
  const table: number[] = [];
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) {
      c = (c & 1) === 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    table.push(c >>> 0);
  }
  return table;
})();

function crc32(bytes: Buffer): number {
  let c = 0xffffffff;
  for (const byte of bytes) {
    c = (CRC_TABLE[(c ^ byte) & 0xff] ?? 0) ^ (c >>> 8);
  }
  return (c ^ 0xffffffff) >>> 0;
}

function pngChunk(type: string, data: Buffer): Buffer {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.byteLength, 0);
  const typed = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(typed), 0);
  return Buffer.concat([length, typed, crc]);
}

/**
 * An 8-bit greyscale PNG of the given size, with a gradient so the deflate
 * stream is not degenerate. Greyscale keeps generation cheap; the browser
 * still decodes it to RGBA, so a 4096×2048 pano costs the GPU exactly what
 * the real one costs.
 */
function syntheticPano(width: number, height: number): Buffer {
  const raw = Buffer.alloc((width + 1) * height);
  for (let y = 0; y < height; y += 1) {
    const rowStart = y * (width + 1);
    raw[rowStart] = 0; // filter: none
    for (let x = 0; x < width; x += 1) {
      raw[rowStart + 1 + x] = (x + y) & 0xff;
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr.writeUInt8(8, 8); // bit depth
  ihdr.writeUInt8(0, 9); // colour type: greyscale
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    pngChunk("IHDR", ihdr),
    pngChunk("IDAT", deflateSync(raw, { level: 6 })),
    pngChunk("IEND", Buffer.alloc(0)),
  ]);
}

const PANO_PREVIEW = syntheticPano(512, 256);
const PANO_BASE = syntheticPano(4096, 2048);

/** A valid, empty GLB 2.0 scene — enough for the mesh modes to be offered. */
function minimalGlbBytes(): Buffer {
  const json = Buffer.from(
    JSON.stringify({ asset: { version: "2.0" }, scene: 0, scenes: [{}] }),
    "utf8",
  );
  const padding = (4 - (json.byteLength % 4)) % 4;
  const jsonChunk = Buffer.concat([json, Buffer.alloc(padding, 0x20)]);
  const header = Buffer.alloc(20);
  header.writeUInt32LE(0x46546c67, 0);
  header.writeUInt32LE(2, 4);
  header.writeUInt32LE(header.byteLength + jsonChunk.byteLength, 8);
  header.writeUInt32LE(jsonChunk.byteLength, 12);
  header.writeUInt32LE(0x4e4f534a, 16);
  return Buffer.concat([header, jsonChunk]);
}

const MESH_BYTES = minimalGlbBytes();

// --- the budgets -----------------------------------------------------------

function envNumber(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined) return fallback;
  const parsed = Number.parseFloat(raw);
  return Number.isFinite(parsed) ? parsed : fallback;
}

/**
 * The fixture's own pano sizes, which is what makes the byte budgets legible:
 * one 4096×2048 base is 38,807 bytes of IDAT on the wire and 33,554,432 bytes
 * of RGBA on the GPU; one 512×256 preview is 1,603. The wire figure is
 * fixture-relative — a smooth gradient deflates far better than a real
 * photograph would — so it is the REQUEST COUNT that carries the meaning, and
 * the byte budgets are set so that one extra BASE pano breaks them.
 */
const BASE_PANO_WIRE_BYTES = 38_807;

/**
 * Transferred bytes that are not twin imagery: the route's module graph.
 *
 * MEASURED (three runs, this machine): 19,885,627 / 19,886,375 / 19,886,375.
 * BUDGET 21,000,000 — 5.6% headroom over the worst of the three.
 *
 * This is the Vite DEV graph, because that is what CI serves
 * (.github/workflows/ci.yml runs `pnpm dev`), so it is a relative regression
 * guard on what /tour drags in — NOT a production bundle size. Webfont files
 * are excluded because they are blocked; see the route below.
 */
const APP_BYTES_BUDGET = envNumber("TWIN_APP_BYTES_BUDGET", 21_000_000);

/**
 * Twin imagery transferred by the initial arrival.
 * MEASURED: 121,935 bytes, identical on all three runs.
 * BUDGET 140,000 — 14.8% headroom, chosen so one extra base pano (which would
 * land at 160,812) fails while a stray preview-sized request does not.
 */
const ARRIVAL_IMAGERY_BYTES_BUDGET = envNumber("TWIN_ARRIVAL_IMAGERY_BYTES_BUDGET", 140_000);

/**
 * Pano requests the arrival may make.
 * MEASURED: 6, identical on all three runs (a preview and a base for the
 * arrival node and the nodes warmed around it).
 * BUDGET 7 — room for one retry, but not for another node's worth of warm-up,
 * which costs two. This is the tightest gate in the file and the one that
 * speaks directly to an unbounded per-neighbour fan-out.
 */
const ARRIVAL_PANO_REQUEST_BUDGET = envNumber("TWIN_ARRIVAL_PANO_REQUESTS", 7);

/**
 * Twin imagery transferred by one hop between rooms.
 * MEASURED: 325,160 bytes, identical on all three runs.
 * BUDGET 360,000 — 10.7% headroom; one extra base pano lands at 364,037 and
 * fails.
 */
const HOP_IMAGERY_BYTES_BUDGET = envNumber("TWIN_HOP_IMAGERY_BYTES_BUDGET", 360_000);

/**
 * Pano requests one hop may make.
 * MEASURED: 16, identical on all three runs — the hop walks the nav route, and
 * every node it passes through both loads its own pano and warms its
 * neighbours. Sixteen requests for one room change is a lot, and it is
 * recorded here as the CURRENT cost rather than endorsed as the right one.
 * BUDGET 18 — 12.5% headroom.
 */
const HOP_PANO_REQUEST_BUDGET = envNumber("TWIN_HOP_PANO_REQUESTS", 18);

/**
 * The longest single main-thread block a hop may cause, in milliseconds.
 *
 * MEASURED: zero long tasks during the hop, on all three runs. That zero was
 * checked against the instrument rather than trusted: the same observer
 * recorded 456, 267, 89 and 117 ms tasks during this route's initial load in
 * the same session, so it is live and the hop genuinely produces none.
 *
 * BUDGET 150 ms. Be clear about what this is: with a measured zero and a
 * Long Tasks API that cannot report anything below 50 ms, this is not a tight
 * budget — it is a STALL gate. 150 ms is inside RAIL's 100 ms "immediate"
 * boundary plus one frame of slack, it is nine frozen frames at 60 Hz, and it
 * is a third of the 456 ms class of task this route already produces at load,
 * so an unbounded synchronous upload of the B2 kind cannot hide under it. The
 * TIGHT gate on that same defect is the request/byte budget above.
 */
const HOP_LONG_TASK_BUDGET_MS = envNumber("TWIN_HOP_LONG_TASK_MS", 150);

/**
 * 95th-percentile interval while dragging. Retained for both RAF cadence and
 * returned renderer submissions; the latter is not GPU completion. Historical
 * measurements below used the old 24-event burst/RAF-only harness and are not
 * a baseline for the sustained-input measurement introduced here.
 * MEASURED: 16.7–16.8 ms across three runs of both drag tests, max 16.8, zero
 * dropped frames — the loop is sitting exactly on 60 Hz vsync.
 * BUDGET 20 ms — 19% headroom over vsync, which still fails the moment the
 * loop drops to 50 fps.
 */
const ORBIT_P95_FRAME_BUDGET_MS = envNumber("TWIN_ORBIT_P95_MS", 20);

/**
 * Consecutive frames allowed over two 60 Hz frames.
 * MEASURED: 0 on all three runs of both drag tests.
 * BUDGET 1 — one isolated late frame is a hiccup nobody sees; two in a row is
 * a stutter, and fails.
 */
const ORBIT_MAX_SUSTAINED_STALL = envNumber("TWIN_ORBIT_MAX_SUSTAINED_STALL", 1);

const ORBIT_SAMPLE_MS = 1200;
/** Two 60 Hz frames. One late frame is a hiccup; a run of them is a stutter. */
const DROPPED_FRAME_MS = 33.4;

// --- helpers ---------------------------------------------------------------

interface ByteLedger {
  readonly imageryBytes: number;
  readonly appBytes: number;
  readonly panoRequests: number;
}

/**
 * Counts response bytes off Playwright's own request sizes rather than the
 * Resource Timing API: cross-origin entries report a transferSize of zero
 * without Timing-Allow-Origin, which would silently under-count.
 */
class ByteMeter {
  private readonly pending: Promise<void>[] = [];
  private imageryBytes = 0;
  private appBytes = 0;
  private panoRequests = 0;

  constructor(page: Page) {
    page.on("response", (response) => {
      this.pending.push(this.record(response.request()));
    });
  }

  private async record(request: Request): Promise<void> {
    let bytes = 0;
    try {
      const sizes = await request.sizes();
      bytes = sizes.responseBodySize + sizes.responseHeadersSize;
    } catch {
      // A request torn down with the page has no sizes, and nothing it
      // transferred can be attributed; it contributes nothing.
      return;
    }
    if (request.url().includes(TILE_PREFIX)) {
      this.imageryBytes += bytes;
      this.panoRequests += 1;
      return;
    }
    this.appBytes += bytes;
  }

  reset(): void {
    this.imageryBytes = 0;
    this.appBytes = 0;
    this.panoRequests = 0;
  }

  async settle(): Promise<ByteLedger> {
    await Promise.all([...this.pending]);
    return {
      imageryBytes: this.imageryBytes,
      appBytes: this.appBytes,
      panoRequests: this.panoRequests,
    };
  }
}

function percentile(values: readonly number[], p: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1));
  return sorted[index] ?? 0;
}

function longestRun(values: readonly number[], thresholdMs: number): number {
  let current = 0;
  let longest = 0;
  for (const value of values) {
    current = value > thresholdMs ? current + 1 : 0;
    longest = Math.max(longest, current);
  }
  return longest;
}

/**
 * Three 0.180's existing devtools event exposes each constructed renderer.
 * Observe real render submissions without changing R3F's demand loop, camera,
 * effects or pixels. A returned render call is NOT GPU completion/presentation.
 * RAF cadence is recorded independently and both clocks retain their budgets.
 */
async function installRenderProbe(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const existing: unknown = Reflect.get(window, "__THREE_DEVTOOLS__");
    if (existing !== undefined && !(existing instanceof EventTarget)) {
      throw new Error("Cannot observe Three renderer without replacing an existing devtools owner");
    }
    const devtools = existing instanceof EventTarget ? existing : new EventTarget();
    if (existing === undefined) Object.defineProperty(window, "__THREE_DEVTOOLS__", { value: devtools });
    const renderers = new Set<WebGLRenderer>();
    type Recording = {
      canvas: HTMLCanvasElement;
      renderer: WebGLRenderer;
      startedAtMs: number | null;
      endedAtMs: number | null;
      rafTimesMs: number[];
      renders: RenderFrame[];
      trustedPointerMoveTimesMs: number[];
      rafId: number;
      rendererName: string;
      pixelRatio: number;
      drawingBuffer: [number, number];
    };
    let recording: Recording | null = null;

    // The runtime marker is supplied by Three's renderer constructor. Its
    // @types interface omits that marker, so narrow through a checked predicate.
    const isRenderer = (value: unknown): value is WebGLRenderer => value !== null
      && typeof value === "object" && "isWebGLRenderer" in value && value.isWebGLRenderer === true;
    devtools.addEventListener("observe", (event) => {
      if (!(event instanceof CustomEvent)) return;
      const candidate: unknown = event.detail;
      if (!isRenderer(candidate)) return;
      const renderer = candidate;
      if (renderers.has(renderer)) return;
      renderers.add(renderer);
      const originalRender = renderer.render.bind(renderer);
      renderer.render = function (this: WebGLRenderer, scene, camera): void {
        const before = this.info.render.frame;
        originalRender(scene, camera);
        const active = recording;
        if (active === null || active.renderer !== this || active.startedAtMs === null
          || active.endedAtMs !== null) return;
        active.renders.push({
          atMs: performance.now(),
          frameAdvance: this.info.render.frame - before,
          drawCalls: this.info.render.calls,
          cameraWorldMatrix: camera.matrixWorld.elements.slice(),
        });
      };
    });

    const tick = (now: number): void => {
      const active = recording;
      if (active === null || active.startedAtMs === null || active.endedAtMs !== null) return;
      active.rafTimesMs.push(now);
      active.rafId = requestAnimationFrame(tick);
    };
    window.addEventListener("pointerdown", (event) => {
      const active = recording;
      if (active === null || active.startedAtMs !== null || !event.isTrusted
        || event.button !== 0 || event.target !== active.canvas) return;
      active.startedAtMs = performance.now();
      active.rafId = requestAnimationFrame(tick);
    }, true);
    window.addEventListener("pointermove", (event) => {
      const active = recording;
      if (active === null || active.startedAtMs === null || active.endedAtMs !== null
        || !event.isTrusted || (event.buttons & 1) === 0 || event.target !== active.canvas) return;
      active.trustedPointerMoveTimesMs.push(performance.now());
    }, true);
    window.addEventListener("pointerup", (event) => {
      const active = recording;
      if (active === null || active.startedAtMs === null || active.endedAtMs !== null
        || !event.isTrusted || event.button !== 0) return;
      active.endedAtMs = performance.now();
      cancelAnimationFrame(active.rafId);
    }, true);

    window.__twinRenderProbe = {
      arm: () => {
        if (recording !== null) throw new Error("Render probe is already armed");
        const canvas = document.querySelector<HTMLCanvasElement>(".vv-twin-viewer canvas");
        const matches = [...renderers].filter((renderer) => renderer.domElement === canvas);
        const renderer = matches[0];
        if (canvas === null || matches.length !== 1 || renderer === undefined) {
          throw new Error("Exactly one observed Twin WebGLRenderer is required");
        }
        if (!renderer.info.autoReset) {
          throw new Error("Render probe requires per-render draw counters, not cumulative multipass counters");
        }
        const gl = renderer.getContext();
        const debug = gl.getExtension("WEBGL_debug_renderer_info");
        recording = {
          canvas, renderer, startedAtMs: null, endedAtMs: null,
          rafTimesMs: [], renders: [], trustedPointerMoveTimesMs: [], rafId: 0,
          rendererName: String(gl.getParameter(debug?.UNMASKED_RENDERER_WEBGL ?? gl.RENDERER)),
          pixelRatio: renderer.getPixelRatio(),
          drawingBuffer: [gl.drawingBufferWidth, gl.drawingBufferHeight],
        };
      },
      finish: () => {
        const active = recording;
        if (active === null || active.startedAtMs === null || active.endedAtMs === null) {
          throw new Error("Native canvas pointerdown/pointerup did not delimit the render sample");
        }
        recording = null;
        cancelAnimationFrame(active.rafId);
        return {
          startedAtMs: active.startedAtMs, endedAtMs: active.endedAtMs,
          rafTimesMs: active.rafTimesMs, renders: active.renders,
          trustedPointerMoveTimesMs: active.trustedPointerMoveTimesMs,
          renderer: active.rendererName, pixelRatio: active.pixelRatio,
          drawingBuffer: active.drawingBuffer,
          contextLost: active.renderer.getContext().isContextLost(),
          canvasReplaced: document.querySelector(".vv-twin-viewer canvas") !== active.canvas,
        };
      },
    };
  });
}

async function takeLongTasks(page: Page): Promise<readonly number[]> {
  return page.evaluate(() => {
    if (window.__twinLongTaskObserverReady !== true || window.__twinLongTasks === undefined) {
      throw new Error("Long Tasks API observer is absent; hop blocking cannot be measured");
    }
    const tasks = window.__twinLongTasks;
    const copy = [...tasks];
    tasks.length = 0;
    return copy;
  });
}

test.beforeEach(async ({ page }) => {
  await installRenderProbe(page);
  await page.route(MANIFEST_ROUTE, (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(TOUR_MANIFEST),
    }),
  );
  await page.route(TILE_ROUTE, (route) => {
    // The viewer asks for `equirect_<width>.webp`; these bytes are PNG, and
    // image decoders sniff the signature, not the extension or the MIME type.
    const body = route.request().url().includes("equirect_512") ? PANO_PREVIEW : PANO_BASE;
    return route.fulfill({ status: 200, contentType: "image/png", body });
  });
  await page.route(MESH_ROUTE, (route) =>
    route.fulfill({ status: 200, contentType: "model/gltf-binary", body: MESH_BYTES }),
  );
  // Webfonts are blocked, exactly as in twin-visual.spec.ts. The byte budgets
  // were measured when they came from Google's CDN (whose bytes were not this
  // repo's regression signal, and one of whose woff2 URLs answered 404, which
  // made the byte ledger flap); they are now served from this origin, and
  // blocking them keeps the ledger measuring what the budgets were set on.
  await page.route(/\.woff2?(?:\?|$)/u, (route) => route.abort());
  await page.addInitScript(() => {
    window.localStorage.setItem("vv-twin-coach-seen", "1");
    const tasks: number[] = [];
    window.__twinLongTasks = tasks;
    try {
      new PerformanceObserver((list) => {
        for (const entry of list.getEntries()) tasks.push(entry.duration);
      }).observe({ type: "longtask", buffered: true });
      window.__twinLongTaskObserverReady = PerformanceObserver.supportedEntryTypes.includes("longtask");
    } catch {
      window.__twinLongTaskObserverReady = false;
    }
  });
});

async function openTour(page: Page, url: string): Promise<void> {
  await page.goto(url);
  await expect(page.getByTestId("twin-node-label")).toBeVisible({ timeout: 30_000 });
  await expect(page.getByTestId("twin-load-shimmer")).toHaveCount(0, { timeout: 30_000 });
}

test("the arrival at a validated viewpoint stays inside its byte budget", async ({
  page,
}, testInfo) => {
  const meter = new ByteMeter(page);
  await openTour(page, `/tour?node=${ENTRY_ID}`);
  await page.waitForLoadState("networkidle");
  const ledger = await meter.settle();

  await testInfo.attach("arrival-bytes.json", {
    body: JSON.stringify(ledger, null, 2),
    contentType: "application/json",
  });

  expect(
    ledger.panoRequests,
    "the arrival must not fan out beyond its own pano and its neighbours' warm-up",
  ).toBeLessThanOrEqual(ARRIVAL_PANO_REQUEST_BUDGET);
  expect(ledger.imageryBytes, "twin imagery transferred on arrival").toBeLessThanOrEqual(
    ARRIVAL_IMAGERY_BYTES_BUDGET,
  );
  expect(
    ledger.appBytes,
    "everything that is not twin imagery: the route's module graph",
  ).toBeLessThanOrEqual(APP_BYTES_BUDGET);
});

test("a hop between rooms neither floods the network nor blocks the main thread", async ({
  page,
}, testInfo) => {
  test.skip(HOP_SLUG === undefined, "needs a second validated room to hop to");
  const meter = new ByteMeter(page);
  await openTour(page, `/tour?node=${ENTRY_ID}`);
  await page.waitForLoadState("networkidle");

  // Everything above is arrival cost, budgeted by the test above.
  await meter.settle();
  meter.reset();
  await takeLongTasks(page);

  await page.getByTestId("twin-rooms-trigger").click();
  await expect(page.getByTestId("twin-rooms-panel")).toBeVisible();
  await page.getByTestId(`twin-rooms-row-${String(HOP_SLUG)}`).click();

  const targetName = HOP_SLUG === undefined ? "" : ROOM_DISPLAY_NAMES[HOP_SLUG];
  await expect(page.getByTestId("twin-room-dossier")).toContainText(targetName, {
    timeout: 30_000,
  });
  await page.waitForLoadState("networkidle");

  const ledger = await meter.settle();
  const longTasks = await takeLongTasks(page);
  const longestTask = longTasks.length === 0 ? 0 : Math.max(...longTasks);

  await testInfo.attach("hop.json", {
    body: JSON.stringify(
      { ...ledger, longTaskCount: longTasks.length, longestTaskMs: longestTask },
      null,
      2,
    ),
    contentType: "application/json",
  });

  expect(
    ledger.panoRequests,
    "panos one hop is allowed to fetch, warm-up of the new node's neighbours included",
  ).toBeLessThanOrEqual(HOP_PANO_REQUEST_BUDGET);
  expect(ledger.imageryBytes, "twin imagery transferred by one hop").toBeLessThanOrEqual(
    HOP_IMAGERY_BYTES_BUDGET,
  );
  expect(
    longestTask,
    "the longest single main-thread block a hop is allowed to cause",
  ).toBeLessThanOrEqual(HOP_LONG_TASK_BUDGET_MS);
});

/**
 * Drag the stage and sample the frame loop while it moves.
 *
 * Both callers matter and they measure different things. In WALK mode the
 * drag orbits the camera inside the pano sphere, drawing the full 4096×2048
 * texture every frame — that is the real product surface and the real GPU
 * load. In DOLLHOUSE mode it orbits the building mesh, which here is the
 * empty GLB fixture: that run measures the frame loop, the controls and the
 * spring, honestly and with the geometry cost missing. Stating which is
 * which is the point; a single number labelled "orbit" would have implied
 * geometry cost that this fixture does not carry.
 */
interface DragMeasurement {
  readonly frameCount: number;
  readonly p95Ms: number;
  readonly maxMs: number;
  readonly droppedFrames: number;
  readonly longestSustainedStall: number;
  readonly rafFrameCount: number;
  readonly rafP95Ms: number;
  readonly rafLongestSustainedStall: number;
  readonly activeDurationMs: number;
  readonly submittedRenderCount: number;
  readonly cameraChangeCount: number;
  readonly inputMovesPerQuarter: readonly number[];
  readonly drawsPerQuarter: readonly number[];
  readonly cameraChangesPerQuarter: readonly number[];
  readonly renderIntervalsMs: readonly number[];
  readonly rafIntervalsMs: readonly number[];
  readonly sample: RenderSample;
}

function intervals(times: readonly number[]): number[] {
  // The first timestamp starts a clock; it is not itself a frame interval.
  return times.slice(1).map((time, index) => time - (times[index] ?? time));
}

function quarters(times: readonly number[], start: number, duration: number): number[] {
  const counts = [0, 0, 0, 0];
  if (duration <= 0) return counts;
  for (const time of times) {
    if (time < start || time > start + duration) continue;
    const index = Math.min(3, Math.floor(((time - start) / duration) * 4));
    counts[index] = (counts[index] ?? 0) + 1;
  }
  return counts;
}

async function measureDragFrames(page: Page): Promise<DragMeasurement> {
  const canvas = page.locator(".vv-twin-viewer canvas");
  const box = await canvas.boundingBox();
  if (box === null) throw new Error("The Twin canvas is not visible");
  const centreX = box.x + box.width / 2;
  const centreY = box.y + box.height / 2;

  await page.mouse.move(centreX, centreY);
  // Await arming before the native pointerdown. The browser's trusted events
  // delimit both clocks, so a slow command cannot outrun or precede the sample.
  await page.evaluate(() => {
    if (window.__twinRenderProbe === undefined) throw new Error("Three render probe is absent");
    window.__twinRenderProbe.arm();
  });
  try {
    await page.mouse.down();
    const deadline = performance.now() + ORBIT_SAMPLE_MS;
    let step = 0;
    do {
      step += 1;
      // Repeat the original 144 px, +/-20 px drag path, reversing at its end.
      // Keep issuing native input for the FULL window, not a 24-event burst
      // followed by idle RAF callbacks. No synthetic events or forced renders.
      const cycle = step % 48;
      const offset = cycle <= 24 ? cycle : 48 - cycle;
      await page.mouse.move(centreX + offset * 6, centreY + Math.sin(offset / 3) * 20);
    } while (performance.now() < deadline);
  } finally {
    await page.mouse.up();
  }
  const sample = await page.evaluate(() => {
    if (window.__twinRenderProbe === undefined) throw new Error("Three render probe disappeared");
    return window.__twinRenderProbe.finish();
  });
  const rendered = sample.renders.filter((frame) => frame.frameAdvance > 0 && frame.drawCalls > 0);
  const renderTimes = rendered.map((frame) => frame.atMs);
  const cameraChangeTimes = rendered.flatMap((frame, index) => {
    const previous = rendered[index - 1];
    return previous !== undefined && frame.cameraWorldMatrix.some(
      (value, component) => Math.abs(value - (previous.cameraWorldMatrix[component] ?? value)) > 1e-7,
    ) ? [frame.atMs] : [];
  });
  const frames = intervals(renderTimes);
  const rafFrames = intervals(sample.rafTimesMs);
  const duration = sample.endedAtMs - sample.startedAtMs;
  return {
    frameCount: frames.length,
    p95Ms: percentile(frames, 95),
    maxMs: frames.length === 0 ? 0 : Math.max(...frames),
    droppedFrames: frames.filter((frame) => frame > DROPPED_FRAME_MS).length,
    longestSustainedStall: longestRun(frames, DROPPED_FRAME_MS),
    rafFrameCount: rafFrames.length,
    rafP95Ms: percentile(rafFrames, 95),
    rafLongestSustainedStall: longestRun(rafFrames, DROPPED_FRAME_MS),
    activeDurationMs: duration,
    submittedRenderCount: rendered.length,
    cameraChangeCount: cameraChangeTimes.length,
    inputMovesPerQuarter: quarters(sample.trustedPointerMoveTimesMs, sample.startedAtMs, duration),
    drawsPerQuarter: quarters(renderTimes, sample.startedAtMs, duration),
    cameraChangesPerQuarter: quarters(cameraChangeTimes, sample.startedAtMs, duration),
    renderIntervalsMs: frames, rafIntervalsMs: rafFrames, sample,
  };
}

function assertActiveRenderSample(measured: DragMeasurement): void {
  expect(measured.sample.contextLost, "the renderer must remain live").toBe(false);
  expect(measured.sample.canvasReplaced, "one canvas must own the entire sample").toBe(false);
  expect(measured.activeDurationMs, "native dragging must span the complete sample window")
    .toBeGreaterThanOrEqual(ORBIT_SAMPLE_MS);
  expect(measured.sample.renders.every((frame) => frame.frameAdvance === 1 && frame.drawCalls > 0),
    "each observed renderer submission must advance one frame and issue actual draw calls").toBe(true);
  expect(measured.cameraChangeCount, "actual rendered camera transforms must change, not just the input target")
    .toBeGreaterThan(20);
  for (const [name, counts] of [
    ["trusted native pointer input", measured.inputMovesPerQuarter],
    ["actual draw submissions", measured.drawsPerQuarter],
    ["rendered camera changes", measured.cameraChangesPerQuarter],
  ] as const) {
    expect(counts.every((count) => count > 0), `${name} must cover all four quarters of the sample`).toBe(true);
  }
  // Preserve the original RAF gate as well as the actual-submission gate below.
  // Neither clock measures GPU completion or promises physical-device 60 fps.
  expect(measured.rafFrameCount, "RAF instrumentation must also remain active").toBeGreaterThan(20);
  expect(measured.rafP95Ms, "RAF p95 during sustained native input").toBeLessThanOrEqual(ORBIT_P95_FRAME_BUDGET_MS);
  expect(measured.rafLongestSustainedStall, "RAF sustained-stall limit remains unchanged")
    .toBeLessThanOrEqual(ORBIT_MAX_SUSTAINED_STALL);
}

test("looking around the pano holds its frame pacing", async ({ page }, testInfo) => {
  await openTour(page, `/tour?node=${ENTRY_ID}`);
  await page.waitForLoadState("networkidle");

  const measured = await measureDragFrames(page);
  await testInfo.attach("walk-look-frames.json", {
    body: JSON.stringify(measured, null, 2),
    contentType: "application/json",
  });

  assertActiveRenderSample(measured);
  expect(measured.frameCount, "the drag must actually produce frames to measure").toBeGreaterThan(
    20,
  );
  expect(
    measured.p95Ms,
    "p95 interval between real draw submissions while looking around the full-size pano",
  ).toBeLessThanOrEqual(ORBIT_P95_FRAME_BUDGET_MS);
  expect(
    measured.longestSustainedStall,
    "consecutive frames over two 60 Hz frames — a visible stutter, not a single hiccup",
  ).toBeLessThanOrEqual(ORBIT_MAX_SUSTAINED_STALL);
});

test("orbiting the dollhouse holds its frame pacing", async ({ page }, testInfo) => {
  await openTour(page, `/tour?node=${ENTRY_ID}&mode=dollhouse`);
  await page.waitForLoadState("networkidle");

  const measured = await measureDragFrames(page);
  await testInfo.attach("orbit-frames.json", {
    body: JSON.stringify(measured, null, 2),
    contentType: "application/json",
  });

  assertActiveRenderSample(measured);
  expect(measured.frameCount, "the orbit must actually produce frames to measure").toBeGreaterThan(
    20,
  );
  expect(measured.p95Ms, "p95 interval between real draw submissions while orbiting").toBeLessThanOrEqual(
    ORBIT_P95_FRAME_BUDGET_MS,
  );
  expect(
    measured.longestSustainedStall,
    "consecutive frames over two 60 Hz frames — a visible stutter, not a single hiccup",
  ).toBeLessThanOrEqual(ORBIT_MAX_SUSTAINED_STALL);
});

// A guard on the fixture itself. Every budget above is stated in terms of two
// things: that the arrival is a viewpoint the oracle can name, and that one
// base pano weighs what the comments say it weighs. Let either drift and the
// budgets keep passing while measuring something else.
test("the fixture the budgets were measured against still holds", async ({ page }) => {
  expect(ENTRY_ROOM_SLUG, "the entry node must be a validated viewpoint").not.toBeUndefined();
  expect(
    PANO_BASE.byteLength,
    "the byte budgets are stated in terms of this pano's wire size",
  ).toBeGreaterThanOrEqual(BASE_PANO_WIRE_BYTES);
  expect(PANO_BASE.byteLength).toBeLessThan(BASE_PANO_WIRE_BYTES + 200);

  await openTour(page, `/tour?node=${ENTRY_ID}`);
  await expect(page.getByTestId("twin-node-label")).toHaveText(
    twinNodeLabel(ENTRY_ID, TOUR_MANIFEST.name),
  );
});
