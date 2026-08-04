// Standalone visual-verification harness — drives its OWN headless Chromium via
// Playwright (no MCP extension, no permission popups), screenshots the cockpit
// lenses, and prints diagnostics. Run from repo root:
//   node packages/web/scripts/visual-check.mjs
// Env: OUT_DIR (screenshot dir), PLAN_URL (planner url).
import { chromium } from "@playwright/test";
import { ZipWriter, Uint8ArrayWriter, TextReader, configure } from "@zip.js/zip.js";
import { writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { Buffer } from "node:buffer";

configure({ useWebWorkers: false });

const OUT = process.env.OUT_DIR ?? join(process.cwd(), "visual-out");
const PLAN_URL = process.env.PLAN_URL ?? "http://localhost:5173/plan/46a90419-fc36-43b4-862e-8c90967e7515";
const VIEWPORT_WIDTH = Number(process.env.VISUAL_VIEWPORT_WIDTH ?? "1680");
const VIEWPORT_HEIGHT = Number(process.env.VISUAL_VIEWPORT_HEIGHT ?? "1050");
const DEVICE_SCALE_FACTOR = Number(process.env.VISUAL_DEVICE_SCALE_FACTOR ?? "2");
const VENUE_ID = "00000000-0000-4000-8000-000000004003";
const SPACE_ID = "e2e-space-grand";
mkdirSync(OUT, { recursive: true });

const LENSES = ["Lighting", "Power", "Rigging", "AV", "Guests", "Flow", "Evidence", "Ops", "Costs", "Share", "Design"];
const E2E_VENUE = {
  id: VENUE_ID,
  name: "Trades Hall Glasgow",
  slug: "trades-hall",
  address: "85 Glassford Street",
  logoUrl: null,
  brandColour: null,
};
const E2E_SPACE = {
  id: SPACE_ID,
  venueId: VENUE_ID,
  name: "Grand Hall",
  slug: "grand-hall",
  widthM: "21",
  lengthM: "31",
  heightM: "10",
  floorPlanOutline: [
    { x: -10.5, z: -15.5 },
    { x: 10.5, z: -15.5 },
    { x: 10.5, z: 15.5 },
    { x: -10.5, z: 15.5 },
  ],
  loadoutCount: 0,
};

const E2E_CONFIGURATION = {
  data: {
    id: "cfg-perf-grand-hall",
    spaceId: SPACE_ID,
    venueId: VENUE_ID,
    userId: null,
    name: "Visual verification Grand Hall",
    isPublicPreview: true,
    revision: 1,
    objects: [],
  },
};

async function installPlannerApiMocks(page) {
  await page.addInitScript((seed) => {
    Object.defineProperty(window, "__OMNITWIN_E2E__", { value: true, writable: false });
    Object.defineProperty(window, "__OMNITWIN_SEED_USER__", { value: seed, writable: false });
    window.localStorage.removeItem("omni-onboarding-dismissed");
    for (const key of Object.keys(window.localStorage)) {
      if (key.startsWith("venviewer:floating-widget:planner-onboarding")) {
        window.localStorage.removeItem(key);
      }
    }
  }, {
    id: "visual-staff",
    email: "visual-staff@e2e.test",
    role: "staff",
    venueId: VENUE_ID,
    name: "Visual Staff",
  });

  await page.route("**/public/configurations/cfg-perf-grand-hall", (route) => {
    void route.fulfill({ json: E2E_CONFIGURATION });
  });

  await page.route("**/configurations/cfg-perf-grand-hall", (route) => {
    void route.fulfill({ json: E2E_CONFIGURATION });
  });

  await page.route("**/assets/runtime-packages/latest?*", (route) => {
    void route.fulfill({ json: { data: null } });
  });

  await page.route("**/notifications*", (route) => {
    void route.fulfill({ json: { data: [] } });
  });

  await page.route("**/truth-mode/summary?*", (route) => {
    const url = new URL(route.request().url());
    void route.fulfill({
      json: {
        data: {
          targetType: url.searchParams.get("targetType") ?? "configuration",
          targetId: url.searchParams.get("targetId") ?? "cfg-perf-grand-hall",
          source: "Procedural planner preview with mocked visual verification data.",
          confidence: "unknown",
          assumption: "Visual verification data is a deterministic test fixture for screenshot review.",
          evidenceStatus: "not_checked",
          reviewGate: "Human review is required before operational use.",
          staleState: "unknown",
          safeWording: ["Runtime asset loaded, not yet verified or signed."],
          humanReviewRequired: true,
          counts: {
            evidenceItems: 0,
            checkResults: 0,
            assumptions: 1,
            reviewGates: 1,
            staleEvents: 0,
          },
        },
      },
    });
  });

  await page.route("**/public/configurations/cfg-perf-grand-hall/objects/batch", async (route) => {
    const rawPayload = route.request().postDataJSON();
    const payload = rawPayload !== null && typeof rawPayload === "object" ? rawPayload : {};
    const objects = Array.isArray(payload.objects) ? payload.objects : [];
    const revision = Number.isInteger(payload.expectedRevision) ? Number(payload.expectedRevision) + 1 : 2;
    void route.fulfill({
      json: {
        data: {
          revision,
          objects: objects.map((object, index) => ({
            id: typeof object.id === "string" ? object.id : `visual-object-${String(index + 1).padStart(3, "0")}`,
            configurationId: "cfg-perf-grand-hall",
            assetDefinitionId: String(object.assetDefinitionId),
            positionX: String(object.positionX),
            positionY: String(object.positionY),
            positionZ: String(object.positionZ),
            rotationX: String(object.rotationX),
            rotationY: String(object.rotationY),
            rotationZ: String(object.rotationZ),
            scale: String(object.scale),
            sortOrder: Number.isInteger(object.sortOrder) ? object.sortOrder : index,
            metadata: object.metadata ?? null,
          })),
        },
      },
    });
  });

  await page.route("**/configurations/cfg-perf-grand-hall/objects/batch", async (route) => {
    const rawPayload = route.request().postDataJSON();
    const payload = rawPayload !== null && typeof rawPayload === "object" ? rawPayload : {};
    const objects = Array.isArray(payload.objects) ? payload.objects : [];
    const revision = Number.isInteger(payload.expectedRevision) ? Number(payload.expectedRevision) + 1 : 2;
    void route.fulfill({
      json: {
        data: {
          revision,
          objects: objects.map((object, index) => ({
            id: typeof object.id === "string" ? object.id : `visual-object-${String(index + 1).padStart(3, "0")}`,
            configurationId: "cfg-perf-grand-hall",
            assetDefinitionId: String(object.assetDefinitionId),
            positionX: String(object.positionX),
            positionY: String(object.positionY),
            positionZ: String(object.positionZ),
            rotationX: String(object.rotationX),
            rotationY: String(object.rotationY),
            rotationZ: String(object.rotationZ),
            scale: String(object.scale),
            sortOrder: Number.isInteger(object.sortOrder) ? object.sortOrder : index,
            metadata: object.metadata ?? null,
          })),
        },
      },
    });
  });

  await page.route(`**/venues/${VENUE_ID}/spaces/${SPACE_ID}`, (route) => {
    void route.fulfill({ json: { data: E2E_SPACE } });
  });

  await page.route(`**/venues/${VENUE_ID}/spaces`, (route) => {
    void route.fulfill({ json: { data: [E2E_SPACE] } });
  });

  await page.route(`**/venues/${VENUE_ID}`, (route) => {
    void route.fulfill({ json: { data: { ...E2E_VENUE, spaces: [E2E_SPACE] } } });
  });

  await page.route("**/venues", (route) => {
    void route.fulfill({ json: { data: [E2E_VENUE] } });
  });
}

/** Build a minimal self-contained .gdtf: an 8-channel fixture + an embedded glTF triangle. */
async function buildGdtf() {
  const buf = Buffer.alloc(36);
  buf.writeFloatLE(1, 12); // v1.x = 1
  buf.writeFloatLE(1, 28); // v2.y = 1
  const gltf = JSON.stringify({
    asset: { version: "2.0" }, scene: 0, scenes: [{ nodes: [0] }], nodes: [{ mesh: 0 }],
    meshes: [{ primitives: [{ attributes: { POSITION: 0 } }] }],
    buffers: [{ uri: `data:application/octet-stream;base64,${buf.toString("base64")}`, byteLength: 36 }],
    bufferViews: [{ buffer: 0, byteOffset: 0, byteLength: 36, target: 34962 }],
    accessors: [{ bufferView: 0, byteOffset: 0, componentType: 5126, count: 3, type: "VEC3", min: [0, 0, 0], max: [1, 1, 0] }],
  });
  const chans = Array.from({ length: 8 }, (_, i) => `<DMXChannel Offset="${i + 1}"/>`).join("");
  const desc = `<?xml version="1.0"?><GDTF DataVersion="1.2"><FixtureType Name="Modeled Spot" LongName="Acme Modeled Spot" Manufacturer="Acme"><PhysicalDescriptions><Properties><Weight Value="7"/></Properties></PhysicalDescriptions><DMXModes><DMXMode Name="8ch"><DMXChannels>${chans}</DMXChannels></DMXMode></DMXModes></FixtureType></GDTF>`;
  const writer = new ZipWriter(new Uint8ArrayWriter());
  await writer.add("description.xml", new TextReader(desc));
  await writer.add("models/gltf/model.gltf", new TextReader(gltf));
  return Buffer.from(await writer.close());
}

async function clickLens(page, name) {
  await page.locator("button[aria-pressed]", { hasText: new RegExp(`^${name}$`) }).first().click();
}

function rectsOverlap(a, b) {
  if (a === null || b === null) return false;
  return a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top;
}

const browser = await chromium.launch({
  headless: true,
  args: ["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"],
});
const report = { ok: false, steps: [], errors: [] };
try {
  const page = await browser.newPage({
    viewport: { width: VIEWPORT_WIDTH, height: VIEWPORT_HEIGHT },
    deviceScaleFactor: DEVICE_SCALE_FACTOR,
  });
  page.on("console", (m) => { if (m.type() === "error") report.errors.push(m.text().slice(0, 200)); });
  page.on("pageerror", (e) => report.errors.push(`pageerror: ${String(e).slice(0, 200)}`));
  await installPlannerApiMocks(page);

  await page.goto(PLAN_URL, { waitUntil: "domcontentloaded", timeout: 60000 });
  // The cockpit nav rail (lens buttons) appears once a layout loads. If the config
  // isn't in this DB, fall back to "Start a fresh planner draft".
  const navRail = page.locator("button[aria-pressed]").first();
  try {
    await navRail.waitFor({ timeout: 12000 });
  } catch {
    report.steps.push("config not found — starting a fresh draft");
    const fresh = page.getByRole("button", { name: /fresh planner draft/i });
    if (await fresh.count()) {
      await fresh.first().click();
      await navRail.waitFor({ timeout: 60000 });
    } else {
      throw new Error("no nav rail and no fresh-draft button");
    }
  }
  report.steps.push("cockpit loaded");
  await page.waitForTimeout(4000); // let the 3D scene settle
  // The core product: the 3D venue + cockpit chrome.
  await page.screenshot({ path: join(OUT, "planner-3d.png") });
  report.cockpitChrome = await page.evaluate(() => {
    const snapshot = (selector) => {
      const element = document.querySelector(selector);
      if (element === null) return null;
      const rect = element.getBoundingClientRect();
      return {
        left: Math.round(rect.left),
        top: Math.round(rect.top),
        right: Math.round(rect.right),
        bottom: Math.round(rect.bottom),
        width: Math.round(rect.width),
        height: Math.round(rect.height),
      };
    };
    return {
      viewport: {
        left: 0,
        top: 0,
        right: document.documentElement.clientWidth,
        bottom: document.documentElement.clientHeight,
        width: document.documentElement.clientWidth,
        height: document.documentElement.clientHeight,
      },
      onboarding: snapshot("[data-floating-widget-id='planner-onboarding']"),
      topbar: snapshot("[data-testid='cockpit-topbar']"),
      layerControls: snapshot("[data-floating-widget-id='planner-layer-controls']"),
      commandDeck: snapshot("[data-testid='planner-command-deck']"),
      bottomGraph: snapshot("[data-testid='cockpit-bottom']"),
      leftToolbar: snapshot("[data-testid='planner-toolbar']"),
      minimap: snapshot("[data-floating-widget-id='cockpit-minimap']"),
      layoutIntelligence: snapshot("[data-floating-widget-id='planner-spatial-hud']"),
      truthRail: snapshot("[data-testid='cockpit-truth-rail']"),
    };
  });
  const onboarding = report.cockpitChrome.onboarding;
  if (onboarding !== null) {
    const viewport = report.cockpitChrome.viewport;
    if (
      onboarding.left < viewport.left
      || onboarding.top < viewport.top
      || onboarding.right > viewport.right
      || onboarding.bottom > viewport.bottom
    ) {
      report.errors.push("planner onboarding is clipped by the viewport");
    }
    const blockedSurfaces = [
      ["top bar", report.cockpitChrome.topbar],
      ["visual layer controls", report.cockpitChrome.layerControls],
      ["command deck", report.cockpitChrome.commandDeck],
      ["event phase graph", report.cockpitChrome.bottomGraph],
      ["toolbar", report.cockpitChrome.leftToolbar],
      ["plan view", report.cockpitChrome.minimap],
      ["layout intelligence", report.cockpitChrome.layoutIntelligence],
      ["truth rail", report.cockpitChrome.truthRail],
    ];
    for (const [name, rect] of blockedSurfaces) {
      if (rectsOverlap(onboarding, rect)) {
        report.errors.push(`planner onboarding overlaps ${name}`);
      }
    }
  }

  // --- Floating tool widget: Laser Diagram must be movable/minimizable and never sit on cockpit chrome. ---
  try {
    await page.getByRole("button", { name: "Laser Diagram" }).click();
    await page.getByTestId("markup-panel").waitFor({ timeout: 5000 });
    await page.waitForTimeout(600);
    await page.screenshot({ path: join(OUT, "planner-laser-widget.png") });
    report.markupChrome = await page.evaluate(() => {
      const snapshot = (selector) => {
        const element = document.querySelector(selector);
        if (element === null) return null;
        const rect = element.getBoundingClientRect();
        return {
          left: Math.round(rect.left),
          top: Math.round(rect.top),
          right: Math.round(rect.right),
          bottom: Math.round(rect.bottom),
          width: Math.round(rect.width),
          height: Math.round(rect.height),
        };
      };
      return {
        viewport: {
          left: 0,
          top: 0,
          right: document.documentElement.clientWidth,
          bottom: document.documentElement.clientHeight,
          width: document.documentElement.clientWidth,
          height: document.documentElement.clientHeight,
        },
        markup: snapshot("[data-floating-widget-id='planner-markup-panel']"),
        topbar: snapshot("[data-testid='cockpit-topbar']"),
        layerControls: snapshot("[data-floating-widget-id='planner-layer-controls']"),
        commandDeck: snapshot("[data-testid='planner-command-deck']"),
        toolbar: snapshot("[data-testid='planner-toolbar']"),
        minimap: snapshot("[data-floating-widget-id='cockpit-minimap']"),
        layoutIntelligence: snapshot("[data-floating-widget-id='planner-spatial-hud']"),
        saveSend: snapshot("[data-floating-widget-id='save-send-panel']"),
        truthRail: snapshot("[data-testid='cockpit-truth-rail']"),
        truthPopover: snapshot("[data-testid='truth-mode-popover']"),
        bottomGraph: snapshot("[data-testid='cockpit-bottom']"),
      };
    });
    const markup = report.markupChrome.markup;
    if (markup === null) {
      report.errors.push("laser diagram widget did not render as a floating widget");
    } else {
      const viewport = report.markupChrome.viewport;
      if (
        markup.left < viewport.left
        || markup.top < viewport.top
        || markup.right > viewport.right
        || markup.bottom > viewport.bottom
      ) {
        report.errors.push("laser diagram widget is clipped by the viewport");
      }
      const blockedSurfaces = [
        ["top bar", report.markupChrome.topbar],
        ["visual layer controls", report.markupChrome.layerControls],
        ["command deck", report.markupChrome.commandDeck],
        ["toolbar", report.markupChrome.toolbar],
        ["plan view", report.markupChrome.minimap],
        ["layout intelligence", report.markupChrome.layoutIntelligence],
        ["save/send", report.markupChrome.saveSend],
        ["truth rail", report.markupChrome.truthRail],
        ["truth popover", report.markupChrome.truthPopover],
        ["event phase graph", report.markupChrome.bottomGraph],
      ];
      for (const [name, rect] of blockedSurfaces) {
        if (rectsOverlap(markup, rect)) {
          report.errors.push(`laser diagram widget overlaps ${name}`);
        }
      }
    }
    report.steps.push("laser widget captured");
  } catch (e) {
    report.steps.push(`SKIP laser widget: ${String(e).slice(0, 120)}`);
  }

  // --- Slices 2/3/4/7: import a .gdtf, preview its 3D model, add it to the rig ---
  await clickLens(page, "Lighting");
  await page.getByTestId("lighting-lens-panel").waitFor({ timeout: 15000 });
  await page.getByTestId("rig-reset").click(); // starter rig (18 fixtures), so numbers are real
  const tmp = join(OUT, "modeled-spot.gdtf");
  writeFileSync(tmp, await buildGdtf());
  await page.getByTestId("gdtf-file").setInputFiles(tmp);
  await page.getByTestId("gdtf-name").waitFor({ timeout: 15000 });
  await page.getByTestId("fixture-model-preview").waitFor({ timeout: 15000 });
  await page.waitForTimeout(2000); // GLTFLoader.parse + a few auto-rotate frames
  // The model preview (before Add to rig clears it).
  await page.getByTestId("fixture-model-preview").scrollIntoViewIfNeeded();
  await page.waitForTimeout(800);
  await page.getByTestId("fixture-model-preview").screenshot({ path: join(OUT, "fixture-model.png") });
  // The clean import state (file loaded → "Loaded …" note + preview, no raw XML).
  await page.getByTestId("gdtf-file-name").scrollIntoViewIfNeeded();
  await page.waitForTimeout(300);
  await page.getByTestId("lighting-lens-panel").screenshot({ path: join(OUT, "lighting-import.png") });
  const preAdd = await page.evaluate(() => {
    const panel = document.querySelector('[data-testid="lighting-lens-panel"]');
    const canvas = panel.querySelector('[data-testid="fixture-model-preview"] canvas');
    return {
      name: panel.querySelector('[data-testid="gdtf-name"]')?.textContent?.trim() ?? null,
      hasCanvas: Boolean(canvas), canvasW: canvas?.width ?? 0, canvasH: canvas?.height ?? 0,
      modelError: Boolean(panel.querySelector('[data-testid="fixture-model-error"]')),
    };
  });
  await page.getByTestId("gdtf-add").click(); // rig now = starter (18) + imported
  await page.waitForTimeout(600);
  const postAdd = await page.evaluate(() => {
    const panel = document.querySelector('[data-testid="lighting-lens-panel"]');
    panel.scrollTop = 0;
    const metric = (l) => {
      const e = [...panel.querySelectorAll(".lens-panel__metric-label")].find((x) => x.textContent.trim() === l);
      return e?.nextElementSibling?.textContent?.trim() ?? null;
    };
    return { fixtures: metric("Fixtures"), channels: metric("DMX channels"), universes: metric("Universes") };
  });
  report.lighting = { ...preAdd, ...postAdd };
  report.steps.push("lighting imported + added");
  await page.waitForTimeout(300);
  await page.getByTestId("lighting-lens-panel").screenshot({ path: join(OUT, "lens-lighting.png") });

  // --- Screenshot every lens panel for a visual polish review ---
  for (const lens of LENSES) {
    try {
      await clickLens(page, lens);
      await page.waitForTimeout(700);
      const panel = page.locator(".lens-panel, .cockpit-truth").first();
      await panel.screenshot({ path: join(OUT, `lens-${lens.toLowerCase()}.png`) });
      report.steps.push(`shot ${lens}`);
    } catch (e) {
      report.steps.push(`SKIP ${lens}: ${String(e).slice(0, 120)}`);
    }
  }

  // --- Alert state: Rigging over-WLL (red meter + warnings) ---
  try {
    await clickLens(page, "Rigging");
    await page.getByTestId("rig-load").fill("600");
    await page.waitForTimeout(600);
    await page.locator(".lens-panel").first().screenshot({ path: join(OUT, "rigging-overwll.png") });
    report.steps.push("rigging over-wll captured");
  } catch (e) {
    report.steps.push(`SKIP overwll: ${String(e).slice(0, 90)}`);
  }

  // --- Feature: Room-by-style capacity with a live fit verdict ---
  try {
    await clickLens(page, "Guests");
    await page.getByTestId("guests-count").fill("150");
    await page.waitForTimeout(500);
    await page.getByTestId("guests-style-boardroom").scrollIntoViewIfNeeded();
    await page.waitForTimeout(300);
    await page.getByTestId("guests-lens-panel").screenshot({ path: join(OUT, "guests-room-by-style.png") });
    report.steps.push("guests room-by-style captured");
  } catch (e) {
    report.steps.push(`SKIP roombystyle: ${String(e).slice(0, 90)}`);
  }

  // --- Feature: one-click Theatre layout (blank floor + count 150 from above) ---
  try {
    await page.getByTestId("guests-build-theatre").click();
    await page.waitForTimeout(800);
    await clickLens(page, "Design");
    await page.waitForTimeout(3000);
    await page.screenshot({ path: join(OUT, "planner-theatre-150.png") });
    report.theatreChrome = await page.evaluate(() => {
      const snapshot = (selector) => {
        const element = document.querySelector(selector);
        if (element === null) return null;
        const rect = element.getBoundingClientRect();
        return {
          left: Math.round(rect.left),
          top: Math.round(rect.top),
          right: Math.round(rect.right),
          bottom: Math.round(rect.bottom),
          width: Math.round(rect.width),
          height: Math.round(rect.height),
        };
      };
      return {
        saveSend: snapshot("[data-floating-widget-id='save-send-panel']"),
        layoutIntelligence: snapshot("[data-floating-widget-id='planner-spatial-hud']"),
        truthMode: snapshot("[data-testid='truth-mode-indicator']"),
        bottomGraph: snapshot("[data-testid='cockpit-bottom']"),
      };
    });
    const saveSend = report.theatreChrome.saveSend;
    if (saveSend !== null) {
      const blockedSurfaces = [
        ["layout intelligence", report.theatreChrome.layoutIntelligence],
        ["truth mode", report.theatreChrome.truthMode],
        ["event phase graph", report.theatreChrome.bottomGraph],
      ];
      for (const [name, rect] of blockedSurfaces) {
        if (rectsOverlap(saveSend, rect)) {
          report.errors.push(`save/send widget overlaps ${name}`);
        }
      }
    }
    report.theatrePlaced = await page.evaluate(() => {
      const el = document.querySelector('[data-testid="planner-command-deck"]');
      return el?.textContent?.match(/(\d[\d,]*)\s+placed/)?.[1] ?? null;
    });
    report.steps.push("theatre build captured");
  } catch (e) {
    report.steps.push(`SKIP theatre: ${String(e).slice(0, 90)}`);
  }

  // --- Feature: guest-aware Auto-fill (guest count is 150 from the step above) ---
  try {
    await clickLens(page, "Design");
    await page.waitForTimeout(700);
    await page.getByTestId("planner-command-deck").screenshot({ path: join(OUT, "command-deck-autofill.png") });
    const autoFill = page.getByTestId("planner-command-action-auto-fill");
    report.autoFillLabel = (await autoFill.count()) ? (await autoFill.textContent()) : null;
    if (await autoFill.count()) {
      await autoFill.click();
      await page.waitForTimeout(2800);
      await page.screenshot({ path: join(OUT, "planner-autofill-150.png") });
      const placed = await page.evaluate(() => {
        const el = document.querySelector('[data-testid="planner-command-deck"]');
        return el?.textContent?.match(/(\d[\d,]*)\s+placed/)?.[1] ?? null;
      });
      report.autoFillPlaced = placed;
    }
    report.steps.push("auto-fill 150 captured");
  } catch (e) {
    report.steps.push(`SKIP autofill: ${String(e).slice(0, 90)}`);
  }

  // --- Public marketing pages (no auth) ---
  const origin = new URL(PLAN_URL).origin;
  for (const [name, path] of [["landing", "/"], ["pricing", "/pricing"]]) {
    try {
      await page.goto(origin + path, { waitUntil: "networkidle", timeout: 30000 });
      await page.waitForTimeout(1500);
      await page.screenshot({ path: join(OUT, `page-${name}.png`), fullPage: true });
      report.steps.push(`shot page ${name}`);
    } catch (e) {
      report.steps.push(`SKIP page ${name}: ${String(e).slice(0, 100)}`);
    }
  }

  report.ok = report.errors.length === 0;
} catch (e) {
  report.fatal = String(e).slice(0, 400);
} finally {
  try {
    const pages = browser.contexts().flatMap((c) => c.pages());
    if (pages[0]) await pages[0].screenshot({ path: join(OUT, "page-full.png"), fullPage: false });
  } catch { /* ignore */ }
  await browser.close();
}
console.log(JSON.stringify(report, null, 2));
