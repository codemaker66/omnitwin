import { test, expect, type Page, type TestInfo } from "@playwright/test";
import {
  API,
  RECEPTION_SOG_CHUNKS,
  receptionRuntimePackage,
  settleCockpit,
  stubPlannerBootstrap,
} from "./support/plan-bootstrap.js";

// ---------------------------------------------------------------------------
// E2E: CARD A2 (G1b) — Resolve-over-blueprint load ("the room resolves")
//
// First paint is the architecture linework/proxy (procedural, no network);
// the captured splat streams in over it coarse-to-fine with a quiet caption.
// No spinner anywhere. Camera and chrome stay interactive during the stream.
// Network is throttled to 50 Mbps via CDP per the card's verification, so
// the 63 MB chunk set genuinely streams (~10 s) instead of arriving at once.
//
// The stage exposes `data-resolve-phase` (ink | developing | resolved |
// fallback) as the choreography's honesty surface — assertions key off it.
// ---------------------------------------------------------------------------

// Streaming + decoding the full 63 MB chunk set is GPU/CPU-heavy; running
// these cases concurrently with other WebGL specs starves the renderers
// (same policy as public-config-flow.spec.ts).
test.describe.configure({ mode: "serial" });

const FIFTY_MBPS_BYTES_PER_SECOND = (50 * 1000 * 1000) / 8;

async function throttleTo50Mbps(page: Page): Promise<void> {
  const session = await page.context().newCDPSession(page);
  await session.send("Network.enable");
  await session.send("Network.emulateNetworkConditions", {
    offline: false,
    latency: 20,
    downloadThroughput: FIFTY_MBPS_BYTES_PER_SECOND,
    uploadThroughput: FIFTY_MBPS_BYTES_PER_SECOND / 5,
  });
}

async function attachStageScreenshot(page: Page, testInfo: TestInfo, name: string): Promise<void> {
  const path = testInfo.outputPath(name);
  let screenshot = await page.screenshot({ path, fullPage: false });
  if (screenshot.byteLength <= 15_000) {
    // Blank frame = the capture raced the recovery remount; settle + reshoot
    // once. A persistently blank page still fails below. (No settleCockpit
    // BEFORE the first shot here — mid-develop captures are time-sensitive.)
    await settleCockpit(page);
    await page.waitForTimeout(1_000);
    screenshot = await page.screenshot({ path, fullPage: false });
  }
  expect(screenshot.byteLength).toBeGreaterThan(15_000);
  await testInfo.attach(name, { body: screenshot, contentType: "image/png" });
}

/**
 * Reads the live stage's resolve phase. The planner tree can remount once
 * (~15 s in on local preview: the Clerk-JS failure flip re-renders the
 * provider tree — pre-existing app behavior, tracked as a follow-up), which
 * transiently duplicates the stage and honestly re-develops from cache.
 * Reading the last stage + polling to the SETTLED state keeps the card's
 * assertions true without masking real regressions.
 */
async function readPhase(page: Page): Promise<string> {
  return page.evaluate(() => {
    const stages = document.querySelectorAll(".cockpit-stage");
    const last = stages[stages.length - 1];
    return last?.getAttribute("data-resolve-phase") ?? "absent";
  });
}

async function expectSettledPhase(page: Page, phase: string, timeoutMs: number): Promise<void> {
  await expect
    .poll(() => readPhase(page), { timeout: timeoutMs, message: `waiting for settled phase ${phase}` })
    .toBe(phase);
}

async function readCaptionVisible(page: Page): Promise<string> {
  return page.evaluate(() => {
    const captions = document.querySelectorAll('[data-testid="room-resolve-caption"]');
    const last = captions[captions.length - 1];
    return last?.getAttribute("data-visible") ?? "absent";
  });
}

test.describe("CARD A2: the room resolves over the blueprint", () => {
  test.use({ viewport: { width: 1440, height: 900 } });

  test("linework first, chunks develop with the quiet caption, no spinner, interactive throughout", async ({ page, baseURL }, testInfo) => {
    test.setTimeout(240_000);
    const origin = baseURL ?? "http://localhost:5173";

    await stubPlannerBootstrap(page);
    await page.route(`${API}/assets/runtime-packages/latest*`, (route) => {
      void route.fulfill({ json: { data: receptionRuntimePackage(origin) } });
    });
    await throttleTo50Mbps(page);

    const startedAt = Date.now();
    await page.goto("/plan");

    // First paint: the canvas (blueprint ink + clay proxy — both procedural,
    // zero network) must be up long before any splat byte lands. The 300 ms
    // warm / 1.5 s cold budget belongs to the reference laptop; the local
    // figure is logged as DoD evidence and loosely gated.
    await expect(page.locator("canvas").first()).toBeVisible({ timeout: 15_000 });
    await expect
      .poll(() => readPhase(page), { timeout: 15_000, message: "waiting for first resolve attribute" })
      .toMatch(/ink|developing/);
    const firstPaintMs = Date.now() - startedAt;
    expect(firstPaintMs).toBeLessThan(15_000);
    console.log(`[CARD-A2] first paint (canvas + resolve attribute) in ${String(firstPaintMs)}ms`);

    // The develop begins: caption appears with honest chunk progress.
    await expect
      .poll(() => readPhase(page), { timeout: 20_000, message: "waiting for developing" })
      .toBe("developing");
    const caption = page.getByTestId("room-resolve-caption").last();
    await expect(caption).toBeVisible();
    await expect(caption).toContainText("Loading captured room · Reception Room ·");
    await attachStageScreenshot(page, testInfo, "card-a2-resolve-early.png");

    // No spinner anywhere — the card's law. The room materializing is the
    // progress indicator.
    await expect(page.locator('[role="progressbar"]')).toHaveCount(0);
    await expect(page.locator(".spinner, [class*='spinner']")).toHaveCount(0);

    // Interactive during the stream: chrome answers input while chunks land.
    const layersButton = page.getByRole("button", { name: "Layers", exact: true });
    await layersButton.click();
    await expect(page.getByRole("menu", { name: "Layers" })).toBeVisible();
    await layersButton.click();
    await expect(page.getByRole("menu", { name: "Layers" })).toHaveCount(0);

    // Mid-stream evidence (~2 s into the develop window).
    const sinceStart = Date.now() - startedAt;
    if (sinceStart < 2_000) await page.waitForTimeout(2_000 - sinceStart);
    await attachStageScreenshot(page, testInfo, "card-a2-resolve-2s.png");

    // The room resolves: every chunk arrives, the caption exits, the phase
    // settles. 63 MB at 50 Mbps ≈ 10 s + decode. A recovery remount may
    // honestly re-develop once from cache — poll to the SETTLED state where
    // the phase is resolved AND the caption has exited.
    await expect
      .poll(async () => `${await readPhase(page)}|${await readCaptionVisible(page)}`, {
        timeout: 180_000,
        message: "waiting for resolved phase with the caption exited",
      })
      .toBe("resolved|false");
    console.log(`[CARD-A2] resolved ${String(RECEPTION_SOG_CHUNKS.length)} chunks in ${String(Date.now() - startedAt)}ms at 50 Mbps`);

    // Settle window for Spark's demand-driven paint, then final evidence.
    await page.waitForTimeout(6_000);
    await attachStageScreenshot(page, testInfo, "card-a2-resolve-complete.png");
  });

  test("fallback: no package → the blueprint stays, the caption never appears", async ({ page }, testInfo) => {
    await stubPlannerBootstrap(page);
    await page.route(`${API}/assets/runtime-packages/latest*`, (route) => {
      void route.fulfill({ status: 404, json: { error: "runtime package not found" } });
    });

    await page.goto("/plan");

    await expect(page.locator("canvas").first()).toBeVisible({ timeout: 15_000 });
    await expectSettledPhase(page, "fallback", 15_000);
    await expect
      .poll(() => readCaptionVisible(page), { timeout: 10_000 })
      .toBe("false");
    await expect(page.locator('[role="progressbar"]')).toHaveCount(0);
    await attachStageScreenshot(page, testInfo, "card-a2-fallback-blueprint.png");
  });

  test("reduced motion: the resolve still completes as a crossfade, no develop choreography required", async ({ page, baseURL }) => {
    test.setTimeout(240_000);
    const origin = baseURL ?? "http://localhost:5173";
    await page.emulateMedia({ reducedMotion: "reduce" });

    await stubPlannerBootstrap(page);
    await page.route(`${API}/assets/runtime-packages/latest*`, (route) => {
      void route.fulfill({ json: { data: receptionRuntimePackage(origin) } });
    });

    await page.goto("/plan");

    await expect
      .poll(() => readPhase(page), { timeout: 20_000, message: "waiting for developing" })
      .toBe("developing");
    await expect(page.getByTestId("room-resolve-caption").last()).toBeVisible();
    await expect
      .poll(async () => `${await readPhase(page)}|${await readCaptionVisible(page)}`, { timeout: 180_000 })
      .toBe("resolved|false");
  });
});
