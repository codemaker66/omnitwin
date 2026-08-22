import { expect, test, type Page } from "@playwright/test";
import {
  TwinManifestSchema,
  type TwinManifest,
  type TwinNavEdge,
  type TwinScanNode,
} from "@omnitwin/types";
import {
  TWIN_FIXTURE_MANIFEST_EQUIRECT,
  TWIN_FIXTURE_TILE_DATA_URI,
} from "../src/twin/__fixtures__/twin-fixture.js";
import {
  TWIN_ENQUIRE_LABEL,
  TWIN_FULLSCREEN_ENTER,
  TWIN_MODE_DOLLHOUSE_LABEL,
  TWIN_MODE_PLAN_LABEL,
  TWIN_MODE_WALK_LABEL,
  TWIN_SHARE_LABEL,
  TWIN_SURFACE_LABEL,
  twinEnquireAria,
} from "../src/twin/twin-copy.js";

// ---------------------------------------------------------------------------
// /tour — responsive HUD audit.
//
// The walkthrough's chrome is nine absolutely-positioned panels floating over
// one canvas, and absolute positioning has no layout engine to stop two of them
// landing on the same pixels. That is not hypothetical: a shipped release put a
// panel over Share and Full screen, and another truncated a button mid-word.
// Neither is visible to a unit test, to a snapshot of one viewport, or to the
// horizontal-overflow check the other responsive specs run — a HUD can collide
// with itself without the document overflowing by a single pixel.
//
// So this file measures. Three viewports: the phone upright, the phone on its
// side — the short-viewport case that is half of why the 844×390 collision
// shipped — and a laptop. At each it takes the CROWDED state (a validated
// viewpoint, where the dossier is on screen alongside the rail, the Rooms pill,
// the mode control and the utility cluster) and asserts three separate things:
//
//   RECTS ARE DISJOINT. Every pair of HUD panels, enumerated, with the measured
//   overlap in the failure message, so a regression reads as "the dossier
//   covers the Rooms pill by 34×61 px" rather than "expected true".
//
//   CONTROLS ARE HITTABLE. Rect disjointness alone would pass a transparent
//   full-bleed panel sitting over everything, so each control is also hit-tested
//   at its own centre: elementFromPoint must return that control or something
//   inside it. This is the assertion that fails when Share is covered.
//
//   NOTHING IS TRUNCATED. The rail label and the Rooms pill label both carry
//   `text-overflow: ellipsis` as a CEILING documented never to engage (the slot
//   arithmetic in RoomSelector.tsx's ROOMS_SLOT). A label whose scrollWidth
//   exceeds its clientWidth is that ceiling engaging — a button truncated
//   mid-word. The viewpoint label is deliberately excluded: below 480px it is
//   capped at 38vw and an ellipsis there is the design, not a defect.
//
// Reduced motion is emulated so every rect is measured at rest rather than
// mid-arrival-spring. Fixtures and route mocks follow twin-tour.spec.ts.
// ---------------------------------------------------------------------------

const TOUR_PATH = "/tour";
const MANIFEST_ROUTE = "**/twin/trades-hall/manifest.json";
const TILE_ROUTE = "**/twin/trades-hall/tiles/**";
const MESH_ROUTE = "**/twin/trades-hall/mesh/dollhouse.glb";

const VENUE_NAME = TWIN_FIXTURE_MANIFEST_EQUIRECT.name;

const LEVEL: TwinScanNode["pose"]["q"] = [1, 0, 0, 0];

function node(
  id: string,
  index: number,
  t: TwinScanNode["pose"]["t"],
  floor: number,
): TwinScanNode {
  return { id, index, pose: { q: LEVEL, t }, floor, roomSlug: null };
}

/**
 * The five validated viewpoints, over two storeys — the crowded HUD.
 *
 * scan_028 leads, so the walk opens there and the dossier is on screen from the
 * first frame. scan_046 is the Grand Hall's far end (one room, two viewpoints),
 * and the basement pair puts a second level in the Rooms panel so its TALLEST
 * state is the one being measured. Poses are synthetic metres, never capture
 * data — real twin bundles are gitignored and absent from a clean checkout.
 */
const TOUR_NODES: readonly TwinScanNode[] = [
  node("scan_028", 0, [5, 0, 1.5], 0),
  node("scan_046", 1, [9, 0, 1.5], 0),
  node("scan_058", 2, [5, -3.5, 1.5], 0),
  node("scan_105", 3, [0, -3.5, -2], -1),
  node("scan_126", 4, [3, -3.5, -2], -1),
];

const TOUR_EDGES: readonly TwinNavEdge[] = [
  { a: "scan_028", b: "scan_046", distanceM: 4 },
  { a: "scan_028", b: "scan_058", distanceM: 3.5 },
  { a: "scan_058", b: "scan_105", distanceM: 5 },
  { a: "scan_105", b: "scan_126", distanceM: 3 },
];

const TOUR_MANIFEST: TwinManifest = TwinManifestSchema.parse({
  ...TWIN_FIXTURE_MANIFEST_EQUIRECT,
  capture: { kind: "matterport-e57", scanCount: TOUR_NODES.length },
  nodes: TOUR_NODES,
  edges: TOUR_EDGES,
});

const TILE_BYTES = Buffer.from(
  TWIN_FIXTURE_TILE_DATA_URI.slice(TWIN_FIXTURE_TILE_DATA_URI.indexOf(",") + 1),
  "base64",
);

/** See twin-tour.spec.ts — duplicated because spec files may not import one
 *  another, and e2e/support/ is not this task's to write. */
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

const READY_MS = 20_000;

interface ViewportSpec {
  readonly label: string;
  readonly width: number;
  readonly height: number;
}

const VIEWPORTS: readonly ViewportSpec[] = [
  { label: "390x844 phone upright", width: 390, height: 844 },
  { label: "844x390 phone on its side", width: 844, height: 390 },
  { label: "1440x900 laptop", width: 1440, height: 900 },
];

interface HudPanel {
  readonly label: string;
  readonly selector: string;
}

const COACH_SELECTOR = "[data-testid='twin-coach']";
const RAIL_SELECTOR = "[data-testid='twin-quick-actions']";

/**
 * The DURABLE chrome — the panels that are on the glass for as long as the
 * visitor is walking, and must never share a pixel with one another.
 *
 * The coach hint is deliberately NOT in this list, and that is a scoping call
 * worth stating rather than burying. It is a transient: `aria-hidden`,
 * pointer-transparent, latched to once per browser, and gone eight seconds in
 * or on the first interaction. Folding it into an all-pairs enumeration would
 * mean every future collision report had to be read twice to find out whether
 * it concerned real chrome or the pill. It gets two named tests of its own at
 * the bottom of this file instead — which is also where the two live defects it
 * currently has are recorded, with the pixels measured.
 */
const HUD_PANELS: readonly HudPanel[] = [
  { label: "the viewpoint label", selector: ".vv-twin-node-label" },
  { label: "the view-mode control", selector: "[data-testid='twin-mode-control']" },
  { label: "the utility cluster (Enquire · Share · Full screen)", selector: ".vv-twin-controls" },
  { label: "the Surface button", selector: ".vv-twin-surface" },
  { label: "the quick-action rail", selector: RAIL_SELECTOR },
  { label: "the room dossier", selector: ".vv-twin-dossier-card" },
  { label: "the Rooms pill", selector: "[data-testid='twin-rooms-trigger']" },
  { label: "the disclosure line", selector: ".vv-twin-disclosure" },
];

/** The panels whose absence would make the audit meaningless. */
const REQUIRED_PANELS: readonly string[] = [
  "the viewpoint label",
  "the view-mode control",
  "the utility cluster (Enquire · Share · Full screen)",
  "the quick-action rail",
  "the room dossier",
  "the Rooms pill",
];

/** Labels whose ellipsis is a ceiling that must never actually engage. */
const NEVER_TRUNCATED: readonly string[] = [
  ".vv-twin-quick-label",
  ".vv-twin-rooms-trigger-label",
  ".vv-twin-mode-option",
  ".vv-twin-dossier-room",
  ".vv-twin-dossier-stat-value",
];

/**
 * Sub-pixel slack. Two panels that merely touch measure 0 or a hair below;
 * anything a person would call a collision measures in tens of pixels, so one
 * pixel of tolerance costs nothing and silences fractional-DPR noise.
 */
const OVERLAP_TOLERANCE_PX = 1;

interface Rect {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

/**
 * Is this URL something the product serves, as opposed to somebody else's CDN?
 *
 * index.html pulls Geist and Fraunces from fonts.gstatic.com, and that host is
 * not always reachable — on this machine the woff2 answers 404 outright — at
 * which point Chromium logs "Failed to load resource: the server responded with
 * a status of 404 ()" with no URL in the text. That anonymous line is what
 * reddens twin-walk.spec.ts's viewport tests today, and it says nothing about
 * whether the tour works. Third-party failures are therefore excluded BY
 * ORIGIN; everything first-party is kept, URL and all. Uncaught exceptions are
 * never excluded — a thrown error is ours wherever the script came from.
 */
function isFirstParty(url: string, pageUrl: string): boolean {
  try {
    return new URL(url).origin === new URL(pageUrl).origin;
  } catch {
    return true;
  }
}

/** Runtime errors from the app itself, with any failed request NAMED. */
function collectRuntimeErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on("pageerror", (error) => {
    errors.push(error.message);
  });
  page.on("console", (message) => {
    if (message.type() !== "error") return;
    const source = message.location().url;
    if (source !== "" && !isFirstParty(source, page.url())) return;
    errors.push(message.text());
  });
  page.on("response", (response) => {
    if (response.status() < 400) return;
    if (!isFirstParty(response.url(), page.url())) return;
    errors.push(`${String(response.status())} ${response.url()}`);
  });
  return errors;
}

async function expectNoHorizontalOverflow(page: Page): Promise<void> {
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - window.innerWidth,
  );
  expect(overflow, "the tour must never overflow horizontally").toBeLessThanOrEqual(1);
}

/** Open the crowded walk state and wait for it to settle. */
async function openCrowdedTour(page: Page): Promise<void> {
  await page.goto(`${TOUR_PATH}?node=scan_028`);
  await expect(page.getByTestId("twin-stage")).toBeVisible({ timeout: READY_MS });
  await expect(page.getByTestId("twin-room-dossier")).toBeVisible({ timeout: READY_MS });
}

/** Every HUD panel currently on screen, with its rect. Absent panels simply are
 *  not in the map — a viewport that drops one is a layout decision, and the
 *  pairs it took part in stop existing with it. */
async function hudRects(page: Page): Promise<Map<string, Rect>> {
  const measured = new Map<string, Rect>();
  for (const panel of HUD_PANELS) {
    const locator = page.locator(panel.selector);
    if ((await locator.count()) !== 1) {
      continue;
    }
    const box = await locator.boundingBox();
    if (box === null || box.width === 0 || box.height === 0) {
      continue;
    }
    measured.set(panel.label, { x: box.x, y: box.y, width: box.width, height: box.height });
  }
  return measured;
}

/** Overlap extent per axis; the panels intersect only when BOTH are positive. */
function overlap(a: Rect, b: Rect): { readonly x: number; readonly y: number } {
  return {
    x: Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x),
    y: Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y),
  };
}

function describe(rect: Rect): string {
  const round = (value: number): string => String(Math.round(value));
  return `${round(rect.width)}×${round(rect.height)} at (${round(rect.x)}, ${round(rect.y)})`;
}

/**
 * Is this control the topmost thing at its own centre — or is it not laid out
 * at all? Null means "no box", which is `display: none`, which is a control
 * that was deliberately withdrawn at this breakpoint (Full screen below 480px:
 * iOS Safari has no element fullscreen for non-video). That is a different
 * finding from "something is sitting on top of it", so it is reported as one.
 */
async function hitTest(page: Page, selector: string): Promise<"hit" | "covered" | "unlaid"> {
  const box = await page.locator(selector).boundingBox();
  if (box === null) {
    return "unlaid";
  }
  const hit = await page.evaluate(
    ({ x, y, target }) => {
      const control = document.querySelector(target);
      const top = document.elementFromPoint(x, y);
      return control !== null && top !== null && (top === control || control.contains(top));
    },
    { x: box.x + box.width / 2, y: box.y + box.height / 2, target: selector },
  );
  return hit ? "hit" : "covered";
}

interface TruncatedLabel {
  readonly selector: string;
  readonly text: string;
  readonly scrollWidth: number;
  readonly clientWidth: number;
}

/** Labels rendering wider than the box they are given — a truncated button. */
async function truncatedLabels(
  page: Page,
  selectors: readonly string[],
): Promise<readonly TruncatedLabel[]> {
  return page.evaluate((list) => {
    const found: TruncatedLabel[] = [];
    for (const selector of list) {
      for (const element of document.querySelectorAll(selector)) {
        if (!(element instanceof HTMLElement)) continue;
        if (element.scrollWidth > element.clientWidth + 1) {
          found.push({
            selector,
            text: element.textContent ?? "",
            scrollWidth: element.scrollWidth,
            clientWidth: element.clientWidth,
          });
        }
      }
    }
    return found;
  }, selectors);
}

/** The coach pill's own centre must be the viewport's centre, within 2px. */
async function expectCoachCentred(page: Page, viewport: ViewportSpec): Promise<void> {
  const coach = page.locator(COACH_SELECTOR);
  await expect(coach).toBeVisible();
  const box = await coach.boundingBox();
  expect(box, "the coach hint must have a box").not.toBeNull();
  if (box === null) throw new Error("The coach hint has no geometry to measure.");
  expect(
    Math.abs(box.x + box.width / 2 - viewport.width / 2),
    `the coach hint sits ${describe(box)} in a ${String(viewport.width)}px viewport`,
  ).toBeLessThanOrEqual(2);
}

function reportTruncation(found: readonly TruncatedLabel[]): string[] {
  return found.map(
    (entry) =>
      `${entry.selector} "${entry.text}" needs ${String(entry.scrollWidth)}px, ` +
      `has ${String(entry.clientWidth)}px`,
  );
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
});

for (const viewport of VIEWPORTS) {
  test(`the tour HUD keeps its panels apart at ${viewport.label}`, async ({ page }) => {
    const errors = collectRuntimeErrors(page);
    await page.setViewportSize({ width: viewport.width, height: viewport.height });
    await page.emulateMedia({ reducedMotion: "reduce" });
    await openCrowdedTour(page);
    await expectNoHorizontalOverflow(page);

    // The crowded state is the state under test — if a panel silently stopped
    // rendering, the disjointness below would pass for the wrong reason.
    const rects = await hudRects(page);
    for (const required of REQUIRED_PANELS) {
      expect(
        rects.has(required),
        `${required} must be on screen at ${viewport.label} for this audit to mean anything`,
      ).toBe(true);
    }

    // Every panel is inside the viewport it was laid out for. A panel pushed
    // off the bottom collides with nothing, and is still broken.
    for (const [label, rect] of rects) {
      expect(rect.x, `${label} runs off the left edge (${describe(rect)})`).toBeGreaterThanOrEqual(
        -OVERLAP_TOLERANCE_PX,
      );
      expect(
        rect.x + rect.width,
        `${label} runs off the right edge (${describe(rect)})`,
      ).toBeLessThanOrEqual(viewport.width + OVERLAP_TOLERANCE_PX);
      expect(rect.y, `${label} runs off the top edge (${describe(rect)})`).toBeGreaterThanOrEqual(
        -OVERLAP_TOLERANCE_PX,
      );
      expect(
        rect.y + rect.height,
        `${label} runs off the bottom edge (${describe(rect)})`,
      ).toBeLessThanOrEqual(viewport.height + OVERLAP_TOLERANCE_PX);
    }

    // — the enumeration. Every unordered pair, once.
    const entries = [...rects.entries()];
    for (let i = 0; i < entries.length; i += 1) {
      for (let j = i + 1; j < entries.length; j += 1) {
        const left = entries[i];
        const right = entries[j];
        if (left === undefined || right === undefined) continue;
        const [leftLabel, leftRect] = left;
        const [rightLabel, rightRect] = right;
        const cover = overlap(leftRect, rightRect);
        expect(
          Math.min(cover.x, cover.y),
          `${leftLabel} (${describe(leftRect)}) overlaps ${rightLabel} ` +
            `(${describe(rightRect)}) by ${String(Math.round(cover.x))}×` +
            `${String(Math.round(cover.y))} px at ${viewport.label}`,
        ).toBeLessThanOrEqual(OVERLAP_TOLERANCE_PX);
      }
    }

    expect(errors, `the HUD must not log an error at ${viewport.label}`).toEqual([]);
  });

  test(`every tour control stays pressable at ${viewport.label}`, async ({ page }) => {
    const errors = collectRuntimeErrors(page);
    await page.setViewportSize({ width: viewport.width, height: viewport.height });
    await page.emulateMedia({ reducedMotion: "reduce" });
    await openCrowdedTour(page);

    // Share and Full screen lead the list because they are the two a shipped
    // panel actually covered.
    const controls: readonly HudPanel[] = [
      { label: TWIN_SHARE_LABEL, selector: `[aria-label="${TWIN_SHARE_LABEL}"]` },
      { label: TWIN_FULLSCREEN_ENTER, selector: `[aria-label="${TWIN_FULLSCREEN_ENTER}"]` },
      { label: TWIN_ENQUIRE_LABEL, selector: `[aria-label="${twinEnquireAria(VENUE_NAME)}"]` },
      { label: TWIN_MODE_WALK_LABEL, selector: `.vv-twin-mode-option:nth-of-type(1)` },
      { label: TWIN_MODE_DOLLHOUSE_LABEL, selector: `.vv-twin-mode-option:nth-of-type(2)` },
      { label: TWIN_MODE_PLAN_LABEL, selector: `.vv-twin-mode-option:nth-of-type(3)` },
      { label: TWIN_SURFACE_LABEL, selector: `.vv-twin-surface` },
      { label: "the Rooms pill", selector: `[data-testid='twin-rooms-trigger']` },
      { label: "the plan chip", selector: `[data-testid='twin-quick-plan']` },
      { label: "the dossier fold", selector: `.vv-twin-dossier-toggle` },
    ];

    const covered: string[] = [];
    const absent: string[] = [];
    for (const control of controls) {
      if ((await page.locator(control.selector).count()) !== 1) {
        absent.push(control.label);
        continue;
      }
      const verdict = await hitTest(page, control.selector);
      if (verdict === "covered") covered.push(control.label);
      if (verdict === "unlaid") absent.push(control.label);
    }

    expect(covered, `these controls are covered by something else at ${viewport.label}`).toEqual(
      [],
    );
    // Full screen is the only one allowed to be missing: twin.css withdraws it
    // below 480px because iOS Safari has no element fullscreen for non-video,
    // and a no-op toggle is worse than no toggle. Anything ELSE absent means
    // the HUD quietly lost a control at this size.
    expect(
      absent.filter((label) => label !== TWIN_FULLSCREEN_ENTER),
      `these controls vanished at ${viewport.label}`,
    ).toEqual([]);
    // …and above that breakpoint it must still be there.
    if (viewport.width > 480) {
      expect(absent, `Full screen must survive at ${viewport.label}`).toEqual([]);
    }

    expect(errors, `the controls must not log an error at ${viewport.label}`).toEqual([]);
  });

  test(`no tour button is truncated mid-word at ${viewport.label}`, async ({ page }) => {
    await page.setViewportSize({ width: viewport.width, height: viewport.height });
    await page.emulateMedia({ reducedMotion: "reduce" });
    await openCrowdedTour(page);
    await page.evaluate(async () => {
      await document.fonts.ready;
    });

    expect(
      reportTruncation(await truncatedLabels(page, NEVER_TRUNCATED)),
      `truncated labels at ${viewport.label} (walk, Rooms panel closed)`,
    ).toEqual([]);

    // Open the Rooms panel too: its rows carry the longest strings on the whole
    // surface — a room name plus three published figures — and they are the
    // ones a narrow column truncates first.
    await page.getByTestId("twin-rooms-trigger").click();
    await expect(page.getByTestId("twin-rooms-panel")).toBeVisible();
    expect(
      reportTruncation(
        await truncatedLabels(page, [
          ...NEVER_TRUNCATED,
          ".vv-twin-rooms-name",
          ".vv-twin-rooms-compare",
          ".vv-twin-rooms-mark",
        ]),
      ),
      `truncated labels at ${viewport.label} (Rooms panel open)`,
    ).toEqual([]);

    await expectNoHorizontalOverflow(page);
  });

  // — the coach hint, which is where the two live defects are. ————————————
  //
  // Its centring is a matched PAIR of tests, one per motion preference, because
  // the difference between them IS the first defect: the pill is `left: 50%`
  // and its `translateX(-50%)` lives only in the `vv-twin-coach-in` keyframes,
  // whose `both` fill holds it after the animation plays. With motion allowed
  // it is centred; under `animation: none` — what twin.css's reduced-motion
  // block sets — it is not. A single test emulating one preference would either
  // miss the defect or read as a flake.

  test(`the coach hint is centred at ${viewport.label} with motion allowed`, async ({ page }) => {
    await page.setViewportSize({ width: viewport.width, height: viewport.height });
    await page.emulateMedia({ reducedMotion: "no-preference" });
    await openCrowdedTour(page);
    await expectCoachCentred(page, viewport);
  });

  test(`the coach hint is centred at ${viewport.label} under reduced motion`, async ({ page }) => {
    // KNOWN DEFECT — expected to fail until twin.css is fixed. The assertion is
    // untouched and the outcome is inverted, not silenced: the moment someone
    // gives `.vv-twin-coach` a base transform this test goes RED for PASSING,
    // which is what forces the annotation off rather than letting it rot.
    //
    // Measured on the live bundle, `getComputedStyle(...).transform` = "none"
    // at every size, and the pill's left edge jumps by half its own width:
    // 390px → x 15.2 becomes 195.0 (right edge 554.6, i.e. 164.6px off-screen);
    // 844px → 242.2 becomes 422.0; 1440px → 540.2 becomes 720.0.
    test.fail(
      true,
      "twin.css centres .vv-twin-coach only inside its keyframes, and the " +
        "reduced-motion block sets `animation: none` — which removes the " +
        "translateX(-50%) along with the slide. Fix: put " +
        "`transform: translate(-50%, 0)` on the base .vv-twin-coach rule.",
    );
    await page.setViewportSize({ width: viewport.width, height: viewport.height });
    await page.emulateMedia({ reducedMotion: "reduce" });
    await openCrowdedTour(page);
    await expectCoachCentred(page, viewport);
  });

  test(`the coach hint clears the quick-action rail at ${viewport.label}`, async ({ page }) => {
    // KNOWN DEFECT at phone-portrait only, and independent of the one above —
    // it is present with motion ALLOWED, i.e. with the pill correctly centred.
    // The two bottom-anchored surfaces are stacked too close in the ≤700px
    // block: the rail bottoms out at y 756.0 and the pill's top edge is at
    // 743.5, so the hint prints across the "See the plan" chip by 216.8×12.5px
    // centred (37.0×12.5px in its mispositioned reduced-motion state). It
    // clears comfortably at the two larger sizes — by 83px at 844x390 and 381px
    // at 1440x900 — so the fix belongs in the phone block alone: lift
    // `.vv-twin-coach`'s bottom clear of the rail, or drop the rail below it.
    test.fail(
      viewport.width < 480,
      "the coach hint overlaps the quick-action rail by 216.8×12.5px at 390x844",
    );
    await page.setViewportSize({ width: viewport.width, height: viewport.height });
    await page.emulateMedia({ reducedMotion: "no-preference" });
    await openCrowdedTour(page);

    const coach = await page.locator(COACH_SELECTOR).boundingBox();
    const rail = await page.locator(RAIL_SELECTOR).boundingBox();
    expect(coach, "the coach hint must be on screen").not.toBeNull();
    expect(rail, "the quick-action rail must be on screen").not.toBeNull();
    if (coach === null || rail === null) throw new Error("The bottom HUD has no geometry.");
    const cover = overlap(coach, rail);
    expect(
      Math.min(cover.x, cover.y),
      `the coach hint (${describe(coach)}) overlaps the quick-action rail ` +
        `(${describe(rail)}) by ${String(Math.round(cover.x))}×` +
        `${String(Math.round(cover.y))} px at ${viewport.label}`,
    ).toBeLessThanOrEqual(OVERLAP_TOLERANCE_PX);
  });
}
