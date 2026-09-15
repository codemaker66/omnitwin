import { test, expect, type Page, type TestInfo } from "@playwright/test";
import {
  API,
  ATELIER_FALLBACK_COPY,
  LOADED_EVIDENCE_COPY,
  RECEPTION_SOG_CHUNKS,
  receptionRuntimePackage,
  settleCockpit,
  seedRegistryAdmin,
  stubPlannerBootstrap,
} from "./support/plan-bootstrap.js";

// ---------------------------------------------------------------------------
// The planner keeps a usable procedural model for rooms without a capture.
// Anonymous users cannot query the internal runtime registry. The separate
// registered-asset case uses the supported platform-admin fixture and streams
// the real seven captured SOG files tracked under public/splats/reception/.
// Staged anonymous capture resolution is covered by plan-room-resolve.spec.ts.
// Cases share no mutable state; one worker avoids simultaneous WebGL contexts.
test.describe.configure({ mode: "default" });

async function attachCardScreenshot(page: Page, testInfo: TestInfo, name: string): Promise<void> {
  await settleCockpit(page);
  const path = testInfo.outputPath(name);
  let screenshot = await page.screenshot({ path, fullPage: false });
  if (screenshot.byteLength <= 15_000) {
    // A blank frame means the capture raced the recovery remount — settle
    // once more and reshoot; a persistently blank page still fails below.
    await settleCockpit(page);
    await page.waitForTimeout(1_000);
    screenshot = await page.screenshot({ path, fullPage: false });
  }
  expect(screenshot.byteLength).toBeGreaterThan(15_000);
  await testInfo.attach(name, { body: screenshot, contentType: "image/png" });
}

async function attachCanvasScreenshot(page: Page, testInfo: TestInfo, name: string): Promise<void> {
  // No settle/evaluate here: the preceding full-page capture's ReadPixels can
  // stall this GPU's driver for tens of seconds with 2M splats loaded, and
  // any injected JS (evaluate, attribute polls) hangs behind that GL call.
  // The locator's own long actionability timeout rides out the stall instead.
  const path = testInfo.outputPath(name);
  const screenshot = await page.locator("canvas").first().screenshot({ path, timeout: 120_000 });
  expect(screenshot.byteLength).toBeGreaterThan(10_000);
  await testInfo.attach(name, { body: screenshot, contentType: "image/png" });
}

test.describe("CARD A1: /plan Reception Room runtime default", () => {
  // Laptop-class evidence viewport. The runtime chip must be VISIBLE here,
  // not merely present in the DOM (it truncates, never hides — CARD A1).
  test.use({ viewport: { width: 1440, height: 900 } });

  test("uncaptured room: honest fallback over the procedural room", async ({ page }, testInfo) => {
    await stubPlannerBootstrap(page, true);
    let registryRequests = 0;
    await page.route(`${API}/assets/runtime-packages/latest*`, (route) => {
      registryRequests += 1;
      void route.fulfill({ status: 404, json: { error: "runtime package not found" } });
    });

    const startedAt = Date.now();
    await page.goto("/plan");

    const topbar = page.getByRole("banner", { name: "Room and save status" });
    await expect(topbar).toBeVisible({ timeout: 15_000 });
    const runtimeChip = page.getByTestId("reference-scene-outliner").locator(".reference-capture-label");
    await expect(runtimeChip).toBeVisible();
    await expect(runtimeChip).toContainText(ATELIER_FALLBACK_COPY);
    await expect(page.locator("canvas").first()).toBeVisible();
    const interactiveMs = Date.now() - startedAt;

    // 01 §17/§21.1 budget is < 1.5 s on the reference laptop with cached
    // manifests. This local gate is deliberately loose (bootstrap includes
    // anonymous draft creation + navigation); the measured figure is logged
    // for the card's DoD evidence rather than hard-gated here.
    expect(interactiveMs).toBeLessThan(15_000);
    // eslint-disable-next-line no-console -- deliberate: CARD-A1 timing evidence in the runner output
    console.log(`[CARD-A1] fallback: chip + interactive canvas in ${String(interactiveMs)}ms`);

    // Anonymous planning never reads the internal asset registry. A room
    // without a capture retains the usable model and honest evidence label.
    await expect(topbar).toContainText("Uncaptured room");
    await expect(topbar).not.toContainText(LOADED_EVIDENCE_COPY);
    expect(registryRequests).toBe(0);

    await attachCardScreenshot(page, testInfo, "card-a1-atelier-fallback.png");
    await attachCanvasScreenshot(page, testInfo, "card-a1-atelier-fallback-canvas.png");
  });

  test("failed staged capture retains its notice and leaves Model view usable", async ({ page }) => {
    await stubPlannerBootstrap(page);
    let registryRequests = 0;
    await page.route(`${API}/assets/runtime-packages/latest*`, (route) => {
      registryRequests += 1;
      return route.fulfill({ status: 403, json: { error: "internal registry is not public" } });
    });
    await page.route("**/splats/trades-hall/reception-room/*", (route) => route.fulfill({
      status: 503, contentType: "text/plain", body: "Capture temporarily unavailable",
    }));
    await page.goto("/plan", { waitUntil: "domcontentloaded" });
    await expect(page.locator(".cockpit-stage")).toHaveAttribute("data-resolve-phase", "unavailable");
    const caption = page.getByTestId("room-resolve-caption");
    await expect(caption).toHaveAttribute("data-visible", "true");
    await expect(caption).toContainText("Room capture could not load.");
    const model = page.getByRole("group", { name: "Room view" }).getByRole("button", { name: "Model", exact: true });
    await model.click();
    await expect(model).toHaveAttribute("aria-pressed", "true");
    await expect(page.locator("canvas")).toBeVisible();
    expect(registryRequests).toBe(0);
  });

  test("loaded: runtime package resolves → real captured chunks stream with the evidence chip", async ({ page, baseURL }, testInfo) => {
    // Worst honest case on a stalling GPU: 120 s chunk poll + decode + a
    // ReadPixels-stalled capture. 300 s keeps the budget above the sum of
    // the step timeouts instead of racing them.
    test.setTimeout(300_000);
    const origin = baseURL ?? "http://localhost:5173";
    const sogResponses = new Set<string>();
    page.on("response", (response) => {
      const url = response.url();
      if (url.includes("/splats/reception/") && response.status() === 200) {
        sogResponses.add(url);
      }
    });

    await seedRegistryAdmin(page);
    await stubPlannerBootstrap(page);
    await page.route(`${API}/assets/runtime-packages/latest*`, (route) => {
      void route.fulfill({ json: { data: receptionRuntimePackage(origin) } });
    });

    await page.goto("/plan");

    const topbar = page.getByRole("banner", { name: "Room and save status" });
    await expect(topbar).toBeVisible({ timeout: 15_000 });
    await expect(topbar).toContainText("Reception Room");
    // Chip flips to the evidence-state label as soon as the package resolves —
    // and it must be visible, not merely present in the DOM.
    const runtimeChip = page.getByTestId("reference-scene-outliner").locator(".reference-capture-label");
    await expect(runtimeChip).toBeVisible();
    await expect(runtimeChip).toContainText(LOADED_EVIDENCE_COPY, { timeout: 10_000 });

    // All seven real room chunks must actually stream (63 MB from the local
    // static server) — this is the built runtime, not a fixture.
    await expect
      .poll(() => sogResponses.size, { timeout: 120_000, message: "waiting for all Reception Room SOG chunks" })
      .toBeGreaterThanOrEqual(RECEPTION_SOG_CHUNKS.length);
    await expect(page.locator(".cockpit-stage")).toHaveAttribute("data-resolve-phase", "resolved", { timeout: 120_000 });

    // Give Spark a settle window to decode + paint the streamed gaussians
    // before capturing evidence (frameloop is demand-driven).
    await page.waitForTimeout(6_000);
    await expect(page.locator("canvas").first()).toBeVisible();

    // The card's evidence is the full-page loaded room + visible chip. A
    // second canvas-only readback here is deliberately omitted: with 2M
    // splats resident, back-to-back ReadPixels can kill this GPU's WebGL
    // context (driver: "GPU stall due to ReadPixels — High"). The loaded
    // canvas visuals are covered by plan-room-resolve.spec.ts's stage shots.
    await attachCardScreenshot(page, testInfo, "card-a1-loaded-room.png");
  });
});
