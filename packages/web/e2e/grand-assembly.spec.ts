import { expect, test, type Page } from "@playwright/test";
import type { Camera, Scene, WebGLRenderer } from "three";
import type { WebGPURenderer } from "three/webgpu";
import { API, CONFIG_ID, GRAND_HALL_SPACE, PLAN_CONFIG, VENUE, stubPlannerBootstrap } from "./support/plan-bootstrap.js";
import { grandHallDinner180 } from "../src/floor/assembly/fixture.js";

// ---------------------------------------------------------------------------
// E2E: the Grand Assembly (goal 03, S5 Layout Recall + S6), on for everyone.
//
// A saved Grand Hall layout assembles itself the first time it opens on a
// device (`?assembly=accio`: every time), comes to rest as placed and hands
// the camera back on its final framing; Escape snaps it to the true state; the
// visible Skip plays it on at speed to its end, then fades and is gone; once
// seen, it opens as placed and Present replays it. Nothing is written back
// while it plays. The Skip's `data-playing` and `data-fast`, and whether it is
// mounted at all, are the honesty surface the assertions key off: only end
// states, never a frame of the show.
// ---------------------------------------------------------------------------

declare global {
  interface Window {
    __venPerf?: { gl: WebGLRenderer | WebGPURenderer; scene: Scene; camera: Camera };
    /** Every state the Assembly's control has shown since the test began watching it. */
    __assemblyControl?: string[];
    /** Whether the Skip has appeared at all since the page loaded. */
    __assemblySkipSeen?: boolean;
    /** How many Skips the room has been given since the test began watching the first. */
    __assemblySkipsAdded?: number;
  }
}

// Three rounds of ten from the 180-seat dinner, as saved objects.
const SEATED = new Set(["ga-group-01", "ga-group-02", "ga-group-03"]);
const OBJECTS = grandHallDinner180()
  .filter((item) => item.groupId !== null && SEATED.has(item.groupId))
  .map((item, index) => ({
    id: `00000000-0000-4000-8000-${(index + 1).toString(16).padStart(12, "0")}`,
    configurationId: CONFIG_ID,
    assetDefinitionId: item.catalogueItemId,
    positionX: item.x.toFixed(3),
    positionY: item.y.toFixed(3),
    positionZ: item.z.toFixed(3),
    rotationX: "0",
    rotationY: item.rotationY.toFixed(6),
    rotationZ: "0",
    scale: "1",
    sortOrder: index,
    metadata: { groupId: item.groupId, ...(item.label === undefined || item.label === "" ? {} : { displayLabel: item.label }) },
  }));

/** The Assembly's last framing on a landscape screen (floor/assembly/accio.ts). */
const FINAL_CAMERA = [-9.9, 3.3, 4.0] as const;

/** Stubs the planner with a saved Grand Hall layout; returns the layout writes it saw. */
async function openSavedGrandHallLayout(page: Page, query: string): Promise<string[]> {
  const writes: string[] = [];
  await stubPlannerBootstrap(page);
  await page.route(`${API}/public/configurations/${CONFIG_ID}**`, (route) => {
    if (route.request().method() !== "GET") {
      writes.push(`${route.request().method()} ${route.request().url()}`);
      void route.fulfill({ status: 409, json: { error: "read-only in this test" } });
      return;
    }
    void route.fulfill({ json: { data: { ...PLAN_CONFIG, spaceId: GRAND_HALL_SPACE.id, name: "Dinner for 30", objects: OBJECTS } } });
  });
  await page.route(`${API}/venues/${VENUE.id}/spaces/${GRAND_HALL_SPACE.id}`, (route) => {
    void route.fulfill({ json: { data: GRAND_HALL_SPACE } });
  });
  await page.route(`${API}/venues/${VENUE.id}`, (route) => {
    void route.fulfill({ json: { data: { ...VENUE, spaces: [GRAND_HALL_SPACE] } } });
  });
  await page.goto(`/plan/${CONFIG_ID}${query}`);
  await page.waitForSelector("canvas", { timeout: 30_000 });
  return writes;
}

async function cameraPosition(page: Page): Promise<number[] | null> {
  return page.evaluate(() => {
    const camera = window.__venPerf?.camera;
    return camera === undefined ? null : [camera.position.x, camera.position.y, camera.position.z];
  });
}

function nearFinalFraming(position: readonly number[] | null): boolean {
  return position !== null && FINAL_CAMERA.every((value, index) => Math.abs((position[index] ?? Number.NaN) - value) < 0.01);
}

// The drawn hall and the show are GPU and CPU heavy: one at a time.
test.describe.configure({ mode: "default" });

// Since 26 Oct 2026 the Assembly is on for everyone: a layout plays the first time it opens on a device, and
// ?assembly=accio plays it on every open. The describe keeps its old title so the reviewed inventory's case
// identities stand.
test.describe("Grand Assembly behind ?assembly=accio", () => {
  // A cold first load also fetches the Assembly's code; the hold waits for it.
  test.setTimeout(210_000);

  test("a saved layout that opens assembles itself, rests as placed and hands the camera back where it ended", async ({ page }) => {
    const writes = await openSavedGrandHallLayout(page, "?assembly=accio");
    const skip = page.locator(".assembly-replay");
    await expect(skip).toHaveAttribute("data-playing", "true", { timeout: 90_000 });
    // At rest the Skip is gone: Present replays the show.
    await expect(skip).toHaveCount(0, { timeout: 90_000 });
    // Handed back on its final framing, and it stays there.
    expect(nearFinalFraming(await cameraPosition(page))).toBe(true);
    await page.waitForTimeout(1_000);
    expect(nearFinalFraming(await cameraPosition(page))).toBe(true);
    // No frame of the show was ever saved.
    expect(writes).toEqual([]);
  });

  test("Escape snaps it to the true state at once", async ({ page }) => {
    await openSavedGrandHallLayout(page, "?assembly=accio");
    const skip = page.locator(".assembly-replay");
    await expect(skip).toHaveAttribute("data-playing", "true", { timeout: 60_000 });
    await page.keyboard.press("Escape");
    // The room is given back at once; the Skip fades out over its settle and is gone (on CI's renderer a frame or
    // two later).
    await expect(skip).toHaveCount(0, { timeout: 10_000 });
    expect(nearFinalFraming(await cameraPosition(page))).toBe(true);
  });

  test("with no flag a layout plays the first time it opens, the Skip hurries it to its end, and it then opens as placed", async ({ page }) => {
    await openSavedGrandHallLayout(page, "");
    const control = page.locator(".assembly-replay");
    await expect(control).toHaveAttribute("data-playing", "true", { timeout: 90_000 });
    // Every state the control shows from here, and every Skip the room is given after it, read once the show is
    // over. On CI's software renderer a frame takes longer than the Skip's settle, so only end states are asserted.
    // (The Skip's second press, a press as the show comes to rest and the settle itself are stepped frame by frame
    // in GrandAssembly.test.tsx and AssemblyReplay.test.tsx.)
    await control.evaluate((element) => {
      const shown: string[] = [];
      const note = (): void => {
        shown.push(`${element.getAttribute("data-playing") ?? ""} ${element.getAttribute("data-fast") ?? ""} ${element.textContent ?? ""}`);
      };
      note();
      new MutationObserver(note).observe(element, { attributes: true, childList: true, characterData: true, subtree: true });
      window.__assemblyControl = shown;
      // A Skip mounted again after this one would be the show starting over.
      window.__assemblySkipsAdded = 0;
      const host = element.parentElement;
      if (host !== null) {
        new MutationObserver((records) => {
          for (const record of records) {
            for (const node of record.addedNodes) {
              if (node instanceof Element && node.matches(".assembly-replay")) window.__assemblySkipsAdded = (window.__assemblySkipsAdded ?? 0) + 1;
            }
          }
        }).observe(host, { childList: true });
      }
    });
    // The visible Skip: the show plays on at speed to its end, comes to rest as placed, and the Skip is gone.
    await control.click();
    await expect(control).toHaveCount(0, { timeout: 90_000 });
    await page.waitForTimeout(2_000);
    const shown = await page.evaluate(() => window.__assemblyControl ?? []);
    expect(shown).toContain("true true Skip to the end");
    // It never started the show again: no Skip came back once this one had gone.
    expect(await page.evaluate(() => window.__assemblySkipsAdded)).toBe(0);
    await expect(control).toHaveCount(0);
    // Seen on this device now: the next open is the layout as placed, and nothing plays. The Skip is watched for
    // from the reloaded page's first moment.
    await page.addInitScript(() => {
      window.__assemblySkipSeen = false;
      new MutationObserver(() => {
        if (document.querySelector(".assembly-replay") !== null) window.__assemblySkipSeen = true;
      }).observe(document, { childList: true, subtree: true });
    });
    await page.reload({ waitUntil: "domcontentloaded" });
    await page.waitForSelector("canvas", { timeout: 30_000 });
    // Present names the replay once the Assembly is on its stage over the layout: the planner is there to watch.
    const present = page.getByRole("button", { name: "Present: watch the room set itself" });
    await expect(present).toBeEnabled({ timeout: 60_000 });
    await page.waitForTimeout(3_000);
    expect(await page.evaluate(() => window.__assemblySkipSeen)).toBe(false);
    await expect(control).toHaveCount(0);
    // Present replays it, with the Skip for the show.
    await present.click();
    await expect(control).toHaveAttribute("data-playing", "true", { timeout: 30_000 });
    await page.keyboard.press("Escape");
    await expect(control).toHaveCount(0, { timeout: 10_000 });
  });
});
