import { expect, test, type Page } from "@playwright/test";
import type { Camera, Scene, WebGLRenderer } from "three";
import type { WebGPURenderer } from "three/webgpu";
import { API, CONFIG_ID, GRAND_HALL_SPACE, PLAN_CONFIG, VENUE, stubPlannerBootstrap } from "./support/plan-bootstrap.js";
import { grandHallDinner180 } from "../src/floor/assembly/fixture.js";

// ---------------------------------------------------------------------------
// E2E: the Grand Assembly (goal 03, S5 Layout Recall + S6) behind its flag.
//
// A saved Grand Hall layout opened with `?assembly=accio` assembles itself,
// comes to rest as placed and hands the camera back on its final framing;
// Escape snaps it to the true state; without the flag nothing assembles.
// Nothing is written back while it plays. The replay control's
// `data-playing` is the honesty surface the assertions key off.
// ---------------------------------------------------------------------------

declare global {
  interface Window {
    __venPerf?: { gl: WebGLRenderer | WebGPURenderer; scene: Scene; camera: Camera };
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

test.describe("Grand Assembly behind ?assembly=accio", () => {
  test.setTimeout(150_000);

  test("a saved layout that opens assembles itself, rests as placed and hands the camera back where it ended", async ({ page }) => {
    const writes = await openSavedGrandHallLayout(page, "?assembly=accio");
    const replay = page.locator(".assembly-replay");
    await expect(replay).toHaveAttribute("data-playing", "true", { timeout: 60_000 });
    await expect(replay).toHaveAttribute("data-playing", "false", { timeout: 90_000 });
    await expect(replay).toBeEnabled();
    // Handed back on its final framing, and it stays there.
    expect(nearFinalFraming(await cameraPosition(page))).toBe(true);
    await page.waitForTimeout(1_000);
    expect(nearFinalFraming(await cameraPosition(page))).toBe(true);
    // No frame of the show was ever saved.
    expect(writes).toEqual([]);
  });

  test("Escape snaps it to the true state at once", async ({ page }) => {
    await openSavedGrandHallLayout(page, "?assembly=accio");
    const replay = page.locator(".assembly-replay");
    await expect(replay).toHaveAttribute("data-playing", "true", { timeout: 60_000 });
    await page.keyboard.press("Escape");
    await expect(replay).toHaveAttribute("data-playing", "false", { timeout: 3_000 });
    expect(nearFinalFraming(await cameraPosition(page))).toBe(true);
  });

  test("without the flag the layout simply opens", async ({ page }) => {
    await openSavedGrandHallLayout(page, "");
    await page.waitForTimeout(3_000);
    await expect(page.locator(".assembly-replay")).toHaveCount(0);
  });
});
