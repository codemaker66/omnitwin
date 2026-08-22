import { expect, test, type Page } from "@playwright/test";
import { TwinManifestSchema, type TwinManifest } from "@omnitwin/types";
import {
  TWIN_FIXTURE_MANIFEST_EQUIRECT,
  TWIN_FIXTURE_TILE_DATA_URI,
} from "../src/twin/__fixtures__/twin-fixture.js";
import { ROOM_DISPLAY_NAMES, VERIFIED_ROOM_NODES } from "../src/twin/shell/twin-rooms.js";
import {
  TWIN_MODE_DOLLHOUSE_LABEL,
  TWIN_MODE_PLAN_LABEL,
  TWIN_TITLE,
} from "../src/twin/twin-copy.js";

// ---------------------------------------------------------------------------
// The Twin — visual regression baselines for /tour (defect C2).
//
// WHY THIS FILE EXISTS. A fully green unit suite coexisted with a mobile sheet
// covering 40% of the viewport, a panel painted half its width off-anchor
// because an animation keyframe still ended on translate(-50%, 0) from an
// older slot, and the building's ground floor labelled "Floor -1" to every
// guest. jsdom has no layout engine and no GPU: those three are invisible to
// it by construction, and no amount of unit testing will ever see them. Only a
// pixel baseline of a real browser at a real viewport will.
//
// WHAT IS AND IS NOT IN THE BASELINE. The HUD is the point, so nothing in the
// HUD is masked — the dossier, the mode control, the quick actions, the rooms
// panel, the plan, the disclosure line and every level heading are all in the
// compared pixels. The live WebGL canvas is NOT: it is hidden with
// `visibility: hidden` (which keeps its layout box, so every HUD element sits
// exactly where it really sits) rather than covered.
//
// Playwright's `mask:` option is the wrong tool here, and that was measured,
// not assumed: the twin's canvas fills the viewport, so masking it paints one
// magenta rectangle over the whole page and the HUD — the only thing worth
// comparing — disappears from the shot. The reproduction is three lines
// (`page.screenshot({ mask: [page.locator("canvas")] })` on this route).
//
// DETERMINISM. Everything compared here is DOM. The residual sources of jitter
// are neutralised at the source rather than absorbed by a loose tolerance: the
// once-per-visitor coach hint is pre-latched in localStorage (it is
// timer-driven and would otherwise appear or not depending on how fast the
// machine booted the chunk), First Light is ineligible by construction because
// every URL here carries ?node= (an arrival with intent), and CSS animations
// are fast-forwarded to their end state by `animations: "disabled"` — which is
// precisely the setting that catches a keyframe whose END state is wrong.
//
// FIXTURE, NOT CAPTURE. packages/web/public/twin/ is gitignored: the real
// 149-scan bundle does not exist on a CI checkout, so every request the viewer
// makes is fulfilled from the twin fixture, exactly as e2e/twin-walk.spec.ts
// does. The node ids are the validated ones READ OUT OF twin-rooms.ts rather
// than typed here, so "a validated viewpoint" stays a fact this file joins
// instead of a claim it makes: if the five-entry oracle ever grows a sixth
// entry, this fixture grows with it and the baselines change on purpose.
// ---------------------------------------------------------------------------

// Headless Chromium needs a real GL path or the R3F canvas never initialises
// and the viewer never reaches its HUD. The repo's playwright.config.ts passes
// no launch args, so this spec supplies its own.
//
// The text-rasterisation flags pin glyph AA and advance rounding to one
// setting. They are cheap insurance rather than a proven fix: the run-to-run
// disagreements this spec actually hit (748 and 7,663 pixels) survived them,
// and were traced to a third-party webfont 404 — see the route handler below.
test.use({
  launchOptions: {
    args: [
      "--use-gl=angle",
      "--use-angle=gl",
      "--enable-unsafe-swiftshader",
      "--ignore-gpu-blocklist",
      "--disable-lcd-text",
      "--disable-font-subpixel-positioning",
      "--force-color-profile=srgb",
    ],
  },
});

// The repo config is fullyParallel, which would put four live WebGL contexts
// on one machine at once. Under that contention the viewer's own readiness
// waits started timing out — a measurement of the runner, not of the product.
// These twelve baselines take about twelve seconds sequentially; that is the
// better trade.
test.describe.configure({ mode: "default" });

const MANIFEST_ROUTE = "**/twin/trades-hall/manifest.json";
const TILE_ROUTE = "**/twin/trades-hall/tiles/**";
const MESH_ROUTE = "**/twin/trades-hall/mesh/dollhouse.glb";

/**
 * The validated viewpoints, in id order — derived from the room oracle, never
 * restated. Room identity exists for these and nowhere else.
 */
const VALIDATED_IDS: readonly string[] = Object.keys(VERIFIED_ROOM_NODES).sort();

/** The viewpoint every baseline opens on, and the room the oracle names there. */
const ENTRY_ID = VALIDATED_IDS[0] ?? "scan_000";
const ENTRY_ROOM_SLUG = VERIFIED_ROOM_NODES[ENTRY_ID];
const ENTRY_ROOM_NAME = ENTRY_ROOM_SLUG === undefined ? null : ROOM_DISPLAY_NAMES[ENTRY_ROOM_SLUG];

/**
 * A twin/0 bundle whose nodes ARE the validated viewpoints.
 *
 * Poses and storeys are synthetic — metre-round spacing along +X, three nodes
 * on one storey and the rest one storey up — chosen so the rooms panel renders
 * its multi-level grouping, which is the surface the "Floor -1" defect lived
 * on. They are fixture topology and make no claim about the building; the
 * fixture this derives from is synthetic for the same reason. `roomSlug` stays
 * null on every node exactly as the real manifest has it: room identity comes
 * from the oracle, never from the bundle.
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

const TILE_BYTES = Buffer.from(
  TWIN_FIXTURE_TILE_DATA_URI.slice(TWIN_FIXTURE_TILE_DATA_URI.indexOf(",") + 1),
  "base64",
);

/** A valid, empty GLB 2.0 scene — dollhouse and plan are offered only for a
 *  mesh-backed bundle, and this is the smallest honest mesh to offer. */
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

/**
 * Takes the live GL surface out of the compositor without moving a single HUD
 * pixel. `display: none` rather than `visibility: hidden`: R3F's canvas is
 * absolutely positioned inside its own wrapper, so removing it shifts no HUD
 * element, and a WebGL layer that is merely invisible still keeps the page on
 * the compositor's GPU raster path — which is where the run-to-run text
 * rasterisation differences came from.
 */
const HIDE_LIVE_CANVAS_CSS = "canvas { display: none !important; }";

interface ViewportSpec {
  readonly key: string;
  readonly width: number;
  readonly height: number;
}

/**
 * Desktop, phone portrait and phone landscape. The landscape entry is not
 * padding: a sheet that behaves at 390×844 can still eat a 390-pixel-tall
 * viewport whole, which is the shape the 40%-of-viewport defect took.
 */
const VIEWPORTS: readonly ViewportSpec[] = [
  { key: "desktop", width: 1440, height: 900 },
  { key: "mobile", width: 390, height: 844 },
  { key: "landscape", width: 844, height: 390 },
];

/**
 * The comparison tolerance, and why it is what it is.
 *
 * `threshold: 0.2` is per-pixel YIQ colour distance — the repo's standing
 * value across its other visual specs, kept so one project has one answer for
 * "how different is a different pixel".
 *
 * `maxDiffPixelRatio` is set from measurement, not from taste. Measured floor:
 * with the canvas out of the layer tree, animations settled and the webfont
 * CDN cut out, three consecutive comparison runs of all twelve baselines
 * produced ZERO differing pixels. There is no noise to absorb, so the budget
 * exists only to tolerate a handful of antialiasing pixels on a re-rasterised
 * glyph edge — 648 pixels at 1440×900, 164 at 390×844 and 844×390.
 *
 * Measured ceiling: nudging the rooms panel by ONE pixel
 * (`transform: translateY(1px)`) moves 3,498 / 4,679 / 1,750 pixels at
 * desktop / mobile / landscape — 5× to 28× over this budget, so it fails at
 * every viewport. Reproducing the historic defect shape itself,
 * `transform: translate(-50%, 0)` on that panel, moves 7,847 / 4,484 / 6,707.
 *
 * That second number is why this spec does not use the repo's usual 0.02.
 * Against 0.02, the off-anchor panel is 0.0061 of the desktop frame and 0.0136
 * of the mobile frame: BOTH UNDER BUDGET. The exact defect this file exists to
 * catch would have sailed through the house tolerance at two of three
 * viewports. 0.02 is right for a page whose photography re-encodes; here every
 * compared pixel is DOM, and 0.02 of a 1440×900 frame is 25,920 pixels —
 * enough to hide the entire rooms trigger.
 */
const MAX_DIFF_PIXEL_RATIO = 0.0005;
const PIXEL_THRESHOLD = 0.2;

function collectRuntimeErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on("pageerror", (error) => {
    errors.push(error.message);
  });
  page.on("console", (message) => {
    // Headless Chromium logs its software-WebGL fallback as a warning, never
    // an error — only real errors are collected. A failed subresource is
    // logged as `Failed to load resource: …` WITHOUT the URL, which is
    // useless to whoever has to fix it, so the response listener below names
    // it and this one drops the anonymous duplicate.
    if (message.type() !== "error") return;
    if (message.text().startsWith("Failed to load resource:")) return;
    errors.push(message.text());
  });
  page.on("response", (response) => {
    if (response.status() >= 400) {
      errors.push(`${String(response.status())} ${response.url()}`);
    }
  });
  return errors;
}

test.beforeEach(async ({ page }) => {
  await page.route(MANIFEST_ROUTE, (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(TOUR_MANIFEST),
    }),
  );
  await page.route(TILE_ROUTE, (route) =>
    route.fulfill({ status: 200, contentType: "image/webp", body: TILE_BYTES }),
  );
  await page.route(MESH_ROUTE, (route) =>
    route.fulfill({ status: 200, contentType: "model/gltf-binary", body: MESH_BYTES }),
  );
  // Cut the third-party webfont dependency. index.html and router.tsx pull
  // Geist / Geist Mono / Inter / Newsreader / Fraunces / Playfair from Google
  // Fonts over the public internet, and that traffic is NOT reliable: during
  // this spec's bring-up one woff2 came back 404
  // (…/s/geistmono/…-tkiS.woff2 — a plain curl from the shell reproduces the
  // 404 while the css2 stylesheet it is named in returns 200). A run that
  // gets the face and a run that falls back render every uppercase mono label
  // on the HUD differently: that is where a stable 7,663-pixel disagreement
  // between two identical runs came from.
  //
  // So the baselines are taken on the fallback stack, deliberately. The cost
  // is stated plainly: THIS SPEC CANNOT SEE A WEBFONT REGRESSION. What it can
  // see — panel geometry, sheet coverage, anchoring, level labels, the whole
  // HUD layout, offline and identically on every run — is what C2 is about,
  // and a baseline that flips with a CDN is worth less than no baseline.
  await page.route("https://fonts.googleapis.com/**", (route) => route.abort());
  await page.route("https://fonts.gstatic.com/**", (route) => route.abort());
  // Pre-latch the one-time coach hint. It is timer-driven (8 s, then a 500 ms
  // fade) and pointer-events-none decoration; leaving it live would make every
  // baseline a race between the machine and the clock.
  await page.addInitScript(() => {
    window.localStorage.setItem("vv-twin-coach-seen", "1");
  });
});

/**
 * Open a twin state and hold the page still enough to photograph: fonts
 * resolved (a fallback-metrics frame reflows every label), the load shimmer
 * retired, and the live GL surface hidden.
 */
async function openTwinState(page: Page, url: string): Promise<void> {
  await page.goto(url);
  await expect(page.getByTestId("twin-node-label")).toBeVisible({ timeout: 20_000 });
  await expect(page.getByTestId("twin-load-shimmer")).toHaveCount(0, { timeout: 20_000 });
  await page.waitForFunction(() => document.fonts.status === "loaded", null, {
    timeout: 10_000,
  });
  await page.addStyleTag({ content: HIDE_LIVE_CANVAS_CSS });
}

/** The segmented view-mode control is a WAI-ARIA radiogroup; the selected
 *  segment is the honest "this mode is live" signal in the DOM. */
async function expectModeSelected(page: Page, label: string): Promise<void> {
  await expect(
    page.getByTestId("twin-mode-control").getByRole("radio", { name: label, exact: true }),
  ).toHaveAttribute("aria-checked", "true");
}

/**
 * Wait until every CSS animation on the page has finished, then let one more
 * frame paint.
 *
 * `animations: "disabled"` fast-forwards animations at screenshot time, which
 * settles the frame but not what came before it: the rooms panel rises over
 * 320 ms and its rows have their own transitions, and a capture taken during
 * that window is a capture of a page still moving. Waiting for the animations
 * to be genuinely finished means the baseline and every later comparison are
 * photographs of the same, settled page.
 */
async function settlePaint(page: Page): Promise<void> {
  await page.waitForFunction(
    () =>
      document
        .getAnimations()
        .every((animation) => animation.playState === "finished" || animation.playState === "idle"),
    null,
    { timeout: 10_000 },
  );
  await page.evaluate(
    () => new Promise<void>((resolve) => requestAnimationFrame(() => { resolve(); })),
  );
}

async function expectBaseline(page: Page, name: string): Promise<void> {
  await settlePaint(page);
  await expect(page).toHaveScreenshot(`${name}.png`, {
    animations: "disabled",
    fullPage: false,
    maxDiffPixelRatio: MAX_DIFF_PIXEL_RATIO,
    threshold: PIXEL_THRESHOLD,
  });
}

for (const viewport of VIEWPORTS) {
  test.describe(`${viewport.key} ${String(viewport.width)}x${String(viewport.height)}`, () => {
    test.use({ viewport: { width: viewport.width, height: viewport.height } });

    test("the walkthrough HUD at a validated viewpoint", async ({ page }) => {
      const errors = collectRuntimeErrors(page);
      await openTwinState(page, `/tour?node=${ENTRY_ID}`);

      await expect(page).toHaveTitle(TWIN_TITLE);
      // The dossier is why a validated viewpoint was chosen: it is the state
      // where the venue's own figures reach the guest, every one of them
      // joined from the pinned truth module at render time.
      await expect(page.getByTestId("twin-room-dossier")).toBeVisible();
      if (ENTRY_ROOM_NAME !== null) {
        await expect(page.getByTestId("twin-room-dossier")).toContainText(ENTRY_ROOM_NAME);
      }

      await expectBaseline(page, `${viewport.key}-walk`);
      expect(errors, "the walkthrough must reach its HUD with no runtime errors").toEqual([]);
    });

    test("the room selector open", async ({ page }) => {
      const errors = collectRuntimeErrors(page);
      await openTwinState(page, `/tour?node=${ENTRY_ID}`);

      await page.getByTestId("twin-rooms-trigger").click();
      await expect(page.getByTestId("twin-rooms-panel")).toBeVisible();
      // The panel is the surface both named layout defects lived on: the
      // mobile sheet that ate the viewport, and the off-anchor transform. Its
      // level headings are the surface the "Floor -1" defect lived on.
      await expect(page.getByTestId("twin-rooms-level").first()).toBeVisible();

      await expectBaseline(page, `${viewport.key}-rooms`);
      expect(errors, "opening the rooms panel must not error").toEqual([]);
    });

    test("dollhouse", async ({ page }) => {
      const errors = collectRuntimeErrors(page);
      await openTwinState(page, `/tour?node=${ENTRY_ID}&mode=dollhouse`);
      await expectModeSelected(page, TWIN_MODE_DOLLHOUSE_LABEL);

      await expectBaseline(page, `${viewport.key}-dollhouse`);
      expect(errors, "dollhouse mode must not error").toEqual([]);
    });

    test("plan", async ({ page }) => {
      const errors = collectRuntimeErrors(page);
      await openTwinState(page, `/tour?node=${ENTRY_ID}&mode=plan`);
      // Plan is the mode switcher's third segment over the real building mesh
      // — shell/ViewpointPlan.tsx is deliberately not mounted (TwinViewer's
      // own record of that decision), so the segmented control's selected
      // state is what says "this is plan mode", not a second overhead map.
      await expectModeSelected(page, TWIN_MODE_PLAN_LABEL);

      await expectBaseline(page, `${viewport.key}-plan`);
      expect(errors, "plan mode must not error").toEqual([]);
    });
  });
}
