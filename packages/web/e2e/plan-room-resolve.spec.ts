import { expect, type Page, type TestInfo } from "@playwright/test";
import type { Camera, Scene, WebGLRenderer } from "three";
import type { WebGPURenderer } from "three/webgpu";
import { captureLaunchOptions } from "./support/capture-launch.js";
import {
  API,
  settleCockpit,
  stubPlannerBootstrap,
} from "./support/plan-bootstrap.js";
import { test } from "./support/staged-reception.js";

test.use({ launchOptions: captureLaunchOptions });

// ---------------------------------------------------------------------------
// E2E: CARD A2 (G1b) — Resolve-over-blueprint load ("the room resolves")
//
// First paint is the architecture linework/proxy (procedural, no network);
// the captured splat streams in over it coarse-to-fine with a quiet caption.
// Shared Activity feedback stays honest; chrome remains usable during streaming.
// Network is throttled to 50 Mbps via CDP. The staged fixture serves real
// descriptor-verified Reception bytes over HTTP rather than bypassing transfer.
//
// The stage exposes `data-resolve-phase` (ink | developing | resolved |
// fallback) as the choreography's honesty surface — assertions key off it.
// ---------------------------------------------------------------------------

// Streaming + decoding the approximately 40 MB staged set is GPU/CPU-heavy; running
// these cases concurrently with other WebGL specs starves the renderers
// (same policy as public-config-flow.spec.ts).
test.describe.configure({ mode: "default" });

declare global {
  interface Window {
    __venPerf?: { gl: WebGLRenderer | WebGPURenderer; scene: Scene; camera: Camera };
    __setWalkMode?: (value: boolean) => void;
    __walkDebug?: {
      walkMode: boolean;
      roomSlug: string | null;
      hasAsset: boolean;
      hasWalkData: boolean;
    };
    __roomCamera?: {
      position: [number, number, number];
      yaw: number;
      pitch: number;
      contained: boolean;
    };
  }
}

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
  const readNativeCanvas = async (): Promise<Buffer> => {
    const readback = page.evaluate(() => {
      const canvas = document.querySelector(".cockpit-stage canvas");
      const runtime = window.__venPerf;
      const renderer = runtime?.gl;
      if (!(canvas instanceof HTMLCanvasElement) || !canvas.isConnected
        || canvas.width <= 0 || canvas.height <= 0 || canvas.dataset["renderer"] !== "three-native"
        || runtime === undefined || renderer === undefined || renderer.domElement !== canvas
        || renderer.getRenderTarget() !== null) {
        throw new Error("Stage evidence requires the live application-owned native canvas");
      }
      // Linux software GL can stall Playwright's compositor screenshot while
      // this demand-loop canvas is idle. Redraw the actual application scene
      // and camera on its existing renderer, then synchronously encode its
      // canvas before the browser discards the presented buffer. No additional
      // graphics context, different camera or reduced scene is used. This
      // diagnostic readback is outside all first-paint/interaction timings.
      renderer.render(runtime.scene, runtime.camera);
      return canvas.toDataURL("image/png");
    });
    let readTimeout: ReturnType<typeof setTimeout> | undefined;
    const deadline = new Promise<never>((_resolve, reject) => {
      readTimeout = setTimeout(() => { reject(new Error("Native canvas readback exceeded 15000 ms")); }, 15_000);
    });
    const dataUrl = await Promise.race([readback, deadline]).finally(() => { clearTimeout(readTimeout); });
    expect(dataUrl).toMatch(/^data:image\/png;base64,/);
    return Buffer.from(dataUrl.slice("data:image/png;base64,".length), "base64");
  };
  // Preserve the existing pre-read wait and one blank-image recovery attempt.
  await page.waitForTimeout(400);
  let screenshot = await readNativeCanvas();
  const { writeFileSync } = await import("node:fs");
  writeFileSync(path, screenshot);
  if (screenshot.byteLength <= 15_000) {
    // Blank buffer may race a recovery remount; settle + reshoot once.
    // A persistently blank canvas still fails the existing evidence limit.
    await settleCockpit(page);
    await page.waitForTimeout(1_000);
    screenshot = await readNativeCanvas();
    writeFileSync(path, screenshot);
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

async function readCaptionVisible(page: Page): Promise<string> {
  return page.evaluate(() => {
    const captions = document.querySelectorAll('[data-testid="room-resolve-caption"]');
    const last = captions[captions.length - 1];
    return last?.getAttribute("data-visible") ?? "absent";
  });
}

async function assertCaptureStillLoading(page: Page, totalChunks: number): Promise<void> {
  const progress = await page.evaluate(() => {
    const stage = document.querySelector(".cockpit-stage");
    const caption = document.querySelector('[data-testid="room-resolve-caption"]');
    const counts = caption?.textContent?.match(/(\d+) of (\d+) chunks/);
    return {
      phase: stage?.getAttribute("data-resolve-phase"),
      loaded: counts === undefined || counts === null ? null : Number(counts[1]),
      total: counts === undefined || counts === null ? null : Number(counts[2]),
    };
  });
  expect(progress.phase).toBe("developing");
  expect(progress.total).toBe(totalChunks);
  expect(progress.loaded).not.toBeNull();
  expect(progress.loaded).toBeLessThan(totalChunks);
}

test.describe("CARD A2: the room resolves over the blueprint", () => {
  test.use({ viewport: { width: 1440, height: 900 } });

  test("linework first, accessible progress and controls work while capture chunks are pending", async ({ page, stagedReception }, testInfo) => {
    test.setTimeout(240_000);

    await stubPlannerBootstrap(page);
    await throttleTo50Mbps(page);

    const startedAt = Date.now();
    await page.goto("/plan?capture=1");

    // The canvas and pending resolve state must appear inside the existing
    // 15 s local limit. This does not claim that no capture bytes have arrived
    // or qualify the separate reference-device first-paint target.
    await expect(page.locator("canvas").first()).toBeVisible({ timeout: 15_000 });
    await expect
      .poll(() => readPhase(page), { timeout: 15_000, message: "waiting for first resolve attribute" })
      .toMatch(/ink|developing/);
    const firstPaintMs = Date.now() - startedAt;
    expect(firstPaintMs).toBeLessThan(15_000);
    // eslint-disable-next-line no-console -- deliberate: CARD-A2 timing evidence in the runner output
    console.log(`[CARD-A2] first paint (canvas + resolve attribute) in ${String(firstPaintMs)}ms`);

    // The develop begins: caption appears with honest chunk progress.
    await expect
      .poll(() => readPhase(page), { timeout: 90_000, message: "waiting for developing" })
      .toBe("developing");
    const caption = page.getByTestId("room-resolve-caption").last();
    await expect(caption).toBeVisible();
    await expect(caption).toContainText("Loading captured room · Reception Room ·");

    // Shared Activity motion accompanies the honest capture progress.
    await expect(caption).toHaveAttribute("role", "status");
    await expect(caption).toHaveAttribute("aria-live", "polite");

    // Interactive during the stream: chrome answers input while chunks land.
    // Check both sides of the input before any costly GPU screenshot readback.
    await assertCaptureStillLoading(page, stagedReception.files.length);
    const more = page.getByRole("button", { name: "More planner tools" });
    await more.click();
    await page.getByText("Scene overlays", { exact: true }).click();
    await expect(page.getByRole("checkbox", { name: "Guest flow" })).toBeVisible();
    await assertCaptureStillLoading(page, stagedReception.files.length);
    await more.click();
    await expect(page.getByTestId("planner-toolbar")).not.toBeVisible();

    // Retain a visual receipt after interaction. Readback can be slow, so this
    // screenshot is not used to establish a particular streaming milestone.
    await attachStageScreenshot(page, testInfo, "card-a2-after-controls.png");

    // The room resolves: every chunk arrives, the caption exits, the phase
    // settles. The CDP transfer limit is configured, not independently measured.
    // A recovery remount may
    // honestly re-develop once from cache — poll to the SETTLED state where
    // the phase is resolved AND the caption has exited.
    await expect
      .poll(async () => `${await readPhase(page)}|${await readCaptionVisible(page)}`, {
        timeout: 180_000,
        message: "waiting for resolved phase with the caption exited",
      })
      .toBe("resolved|false");
    // eslint-disable-next-line no-console -- deliberate: CARD-A2 timing evidence in the runner output
    console.log(`[CARD-A2] resolved ${String(stagedReception.files.length)} chunks in ${String(Date.now() - startedAt)}ms; 50 Mbps configured`);

    expect([...stagedReception.requestedFiles].sort()).toEqual([...stagedReception.files].sort());

    // Settle window for the demand-driven paint, then final evidence.
    await page.waitForTimeout(6_000);
    await attachStageScreenshot(page, testInfo, "card-a2-resolve-complete.png");
  });

  test("staged: no package → the room STILL resolves, from the staged capture, under its label", async ({ page, stagedReception }, testInfo) => {
    // Stage S1 rewrote what a missing registry row means. Before, no package
    // was the fallback path (blueprint stays, nothing streams); that atelier
    // state is still unit-pinned for rooms with no capture at all
    // (use-room-runtime-splat.test.tsx). For a captured room, the staged tiles
    // now stream exactly like a registered package — the difference the user
    // must see is the chip: staged, never reviewed.
    test.setTimeout(240_000);
    await stubPlannerBootstrap(page);
    // Give the pending-state assertion an explicit streaming workload. Waiting
    // for the full page load on unthrottled local files can miss that state.
    await throttleTo50Mbps(page);
    await page.route(`${API}/assets/runtime-packages/latest*`, (route) => {
      void route.fulfill({ status: 404, json: { error: "runtime package not found" } });
    });

    await page.goto("/plan?capture=1", { waitUntil: "domcontentloaded" });

    await expect(page.locator("canvas").first()).toBeVisible({ timeout: 60_000});
    await expect
      .poll(() => readPhase(page), { timeout: 60_000, message: "waiting for the staged develop" })
      .toBe("developing");
    await expect
      .poll(() => readPhase(page), { timeout: 180_000, message: "waiting for the staged resolve" })
      .toBe("resolved");
    await expect(
      page.getByText("Captured layer staged from source — not yet registered or alignment-reviewed"),
    ).toBeVisible();
    expect([...stagedReception.requestedFiles].sort()).toEqual([...stagedReception.files].sort());
    await attachStageScreenshot(page, testInfo, "stage-s1-staged-resolve.png");
  });

  test("walk: stand in the captured room at eye level", async ({ page, stagedReception }) => {
    test.setTimeout(240_000);
    await stubPlannerBootstrap(page);
    await page.route(`${API}/assets/runtime-packages/latest*`, (route) => {
      void route.fulfill({ status: 404, json: { error: "runtime package not found" } });
    });

    await page.goto("/plan");
    await page.waitForFunction(
      () => document.querySelector("[data-resolve-phase]")?.getAttribute("data-resolve-phase") === "resolved",
      undefined, { timeout: 180_000 },
    );
    await settleCockpit(page);

    // Walk entry goes through the dev store bridge, deliberately. The raw
    // click dispatches the identical store flip, but on some GPU/driver
    // combinations the FIRST frame rendered from inside the splat wedges the
    // GL thread for minutes (native hang, empty JS stack, starved evaluates),
    // non-deterministically. That is a driver-interaction investigation (see
    // docs/state/tasks.md T-560), not a behaviour this case can assert
    // through. The assertions below cover the resulting containment and eye
    // height; native entry and Escape exit remain separately unqualified.
    await page.evaluate(() => { window.__setWalkMode?.(true); });
    const walkToggle = page.getByTestId("planner-walk-toggle");
    await expect(walkToggle).toHaveAttribute("aria-pressed", "true", { timeout: 15_000 });

    let walkState = "";
    for (let sample = 0; sample < 20; sample += 1) {
      walkState = await page.evaluate(() => JSON.stringify({
        contained: window.__roomCamera?.contained ?? null,
        gates: window.__walkDebug ?? null,
      }));
      // eslint-disable-next-line no-console -- deliberate: walk-gate evidence in the runner output
      console.log(`[walk:${String(sample)}] ${walkState}`);
      if (walkState.includes('"contained":true')) break;
      await page.waitForTimeout(750);
    }
    expect(walkState).toContain('"contained":true');
    const eyeY = await page.evaluate(() => window.__roomCamera?.position[1] ?? 0);
    expect(eyeY).toBeGreaterThan(1);
    expect(eyeY).toBeLessThan(2.6);
    expect([...stagedReception.requestedFiles].sort()).toEqual([...stagedReception.files].sort());

  });

  // Quarantined under T-560: on this dev GPU class, ANY large camera teleport
  // across the full splat (walk entry by click, walk exit by Escape) can wedge
  // the GL thread natively and non-deterministically — empty JS stack, starved
  // evaluates, minutes-long. Production hardware performs the same teleports
  // fine (the live /room spawns are the standing proof). The exit's store
  // mechanics are unit-covered; this case re-arms when T-560 resolves.
  test.fixme("walk exit: Escape returns to plan view (T-560 GL teleport wedge)", async ({ page }) => {
    await stubPlannerBootstrap(page);
    await page.goto("/plan");
    await page.evaluate(() => { window.__setWalkMode?.(true); });
    await page.keyboard.press("Escape");
    await expect
      .poll(() => page.evaluate(() => window.__walkDebug?.walkMode ?? null), { timeout: 15_000 })
      .toBe(false);
  });

});
