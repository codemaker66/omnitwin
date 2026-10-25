import { expect, test, type Page } from "@playwright/test";
import { settleCockpit, stubPlannerBootstrap } from "./support/plan-bootstrap.js";

// ---------------------------------------------------------------------------
// The touch arbiter on a phone (spec-card-dock §10.1, Q-01).
//
// Real touches through CDP on a booted planner with the backend stubbed and
// an uncaptured room: a swipe with a piece in hand looks round and places
// nothing; a quick tap places exactly one; a hold, a slide and a lift place
// with the camera still to a millionth; a still finger on a placed piece
// lifts and carries it; two fingers walk and zoom. Pieces are armed and
// staged through the development bridges, not the catalogue sheet, so this
// evidence does not hang on the sheet's choreography.
//
// GPU e2e law: one file, serial with the others via the shared config.
// ---------------------------------------------------------------------------

interface PlannerTouchBridge {
  mode: () => string;
  placed: () => readonly { readonly id: string; readonly slug: string | null; readonly x: number; readonly z: number }[];
  arm: (slug: string) => boolean;
}

declare global {
  interface Window {
    /** The touch arbiter's development bridge (components/SelectionSystem.tsx). */
    __plannerTouch?: PlannerTouchBridge;
  }
}

type Point = readonly [number, number];

test.describe("the touch arbiter on a phone", () => {
  test.use({ viewport: { width: 393, height: 852 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });

  test("a swipe looks, a tap and a hold place, a hold lifts, two fingers walk", async ({ page }) => {
    test.setTimeout(180_000);
    await stubPlannerBootstrap(page, true);
    await page.route("**/splats/**", (route) => { void route.fulfill({ status: 404, body: "not in this spec" }); });
    await page.addInitScript(() => { window.localStorage.setItem("omnitwin_onboarding_seen", "1"); });
    await page.goto("/plan?pf=touchArbiter,seatsOnTheCard");
    await settleCockpit(page);
    await expect
      .poll(() => page.evaluate(() => document.querySelector(".cockpit-stage")?.getAttribute("data-resolve-phase") ?? "missing"),
        { timeout: 90_000, message: "waiting for the room resolve to settle" })
      .toBe("fallback");
    await expect
      .poll(() => page.evaluate(() => {
        return window.__plannerTouch !== undefined && window.__venPerf !== undefined && window.__plannerHands !== undefined;
      }), { timeout: 30_000 })
      .toBe(true);

    const cdp = await page.context().newCDPSession(page);
    const touch = (type: "touchStart" | "touchMove" | "touchEnd", points: readonly Point[]): Promise<unknown> =>
      cdp.send("Input.dispatchTouchEvent", { type, touchPoints: points.map(([x, y], id) => ({ x, y, id })) });
    const canvas = await page.locator("canvas").first().boundingBox();
    if (canvas === null) throw new Error("No canvas");
    const area: { readonly x: number; readonly y: number; readonly width: number } = canvas;
    const centre: Point = [canvas.x + canvas.width / 2, canvas.y + canvas.height * 0.55];
    /** Where a floor point (metres) is drawn on screen, CSS px. */
    const screenOf = (x: number, z: number): Promise<Point | null> => page.evaluate(([floorX, floorZ]) => {
      const lens = window.__venPerf?.camera;
      const rect = document.querySelector("canvas")?.getBoundingClientRect();
      if (lens === undefined || rect === undefined) return null;
      const point = lens.position.clone().set(floorX, 0, floorZ).project(lens);
      if (point.z > 1) return null;
      return [rect.left + (point.x * 0.5 + 0.5) * rect.width, rect.top + (-point.y * 0.5 + 0.5) * rect.height] as const;
    }, [x, z] as const);
    /**
     * A floor point drawn in the open part of the screen (clear of the chrome
     * above and the hint and dock below), with room above it for the ghost the
     * hold raises. Floor placement raycasts the floor alone, so a wall drawn
     * in front of the point does not matter.
     */
    // The planning floor's own centre: a room's outline need not be centred on the origin.
    const middle = await page.evaluate(() => {
        const floor = window.__venPerf?.scene.getObjectByName("planner-interaction-floor");
        if (floor === undefined || !("geometry" in floor)) return null;
        const geometry = (floor as { geometry: import("three").BufferGeometry }).geometry;
        geometry.computeBoundingBox();
        const box = geometry.boundingBox;
        if (box === null) return null;
        const centre = floor.localToWorld(box.getCenter(floor.position.clone()));
        return [centre.x, centre.z] as const;
      });
    if (middle === null) throw new Error("No planning floor");
    async function openFloor(): Promise<Point> {
      if (middle === null) throw new Error("No planning floor");
      for (const radius of [0, 1, 2, 3, 4]) {
        for (const [dx, dz] of [[0, 0], [radius, 0], [-radius, 0], [0, radius], [0, -radius], [radius, radius], [-radius, -radius]] as const) {
          const point = await screenOf(middle[0] + dx, middle[1] + dz);
          if (point !== null && point[0] > area.x + 60 && point[0] < area.x + area.width - 120
            && point[1] > area.y + 340 && point[1] < area.y + 640) return point;
        }
      }
      throw new Error("No floor in the open part of the screen");
    }
    const spot = await openFloor();
    const placed = (): Promise<readonly { readonly id: string; readonly slug: string | null; readonly x: number; readonly z: number }[]> =>
      page.evaluate(() => window.__plannerTouch?.placed() ?? []);
    const mode = (): Promise<string> => page.evaluate(() => window.__plannerTouch?.mode() ?? "missing");
    const camera = (): Promise<readonly number[]> => page.evaluate(() => {
      const position = window.__venPerf?.camera.position;
      return position === undefined ? [] : [position.x, position.y, position.z];
    });
    const distance = (a: readonly number[], b: readonly number[]): number =>
      Math.hypot((a[0] ?? 0) - (b[0] ?? 0), (a[1] ?? 0) - (b[1] ?? 0), (a[2] ?? 0) - (b[2] ?? 0));
    /** Waits for the damped camera to come to rest, and returns where. */
    async function stillCamera(): Promise<readonly number[]> {
      let previous = await camera();
      for (let attempt = 0; attempt < 40; attempt++) {
        await page.waitForTimeout(150);
        const current = await camera();
        if (distance(current, previous) < 1e-7) return current;
        previous = current;
      }
      throw new Error("The camera never came to rest");
    }

    // A quick tap with a piece in hand places exactly one.
    expect(await page.evaluate(() => window.__plannerTouch?.arm("poseur-table") ?? false)).toBe(true);
    const poseurs = async (): Promise<number> => (await placed()).filter((item) => item.slug === "poseur-table").length;
    await touch("touchStart", [spot]);
    await page.waitForTimeout(40);
    await touch("touchEnd", []);
    await expect.poll(poseurs).toBe(1);

    // A swipe with the piece still in hand looks round and places nothing.
    const beforeSwipe = await stillCamera();
    await touch("touchStart", [[centre[0] - 60, centre[1]]]);
    for (let step = 1; step <= 10; step++) await touch("touchMove", [[centre[0] - 60 + step * 12, centre[1]]]);
    await touch("touchEnd", []);
    const afterSwipe = await stillCamera();
    expect(distance(afterSwipe, beforeSwipe)).toBeGreaterThan(1e-3);
    expect(await poseurs()).toBe(1);

    // A hold, a slide and a lift place one at the ghost, and the room never moves.
    // Held below the spot, so the ghost the hold raises stands on it.
    await touch("touchStart", [[spot[0], spot[1] + 64]]);
    await page.waitForTimeout(260);
    expect(await mode()).toBe("place");
    for (let step = 1; step <= 12; step++) {
      await touch("touchMove", [[spot[0] + step * 5, spot[1] + 64]]);
      await page.waitForTimeout(16);
    }
    await page.waitForTimeout(80);
    await touch("touchEnd", []);
    await expect.poll(poseurs).toBe(2);
    expect(distance(await camera(), afterSwipe)).toBeLessThan(1e-6);

    // A still finger on a placed piece lifts it and carries it; the room stays still.
    await page.keyboard.press("Escape");
    const tableId = await page.evaluate(([x, z]) => window.__plannerHands?.placeTable(x, z) ?? null, [middle[0] - 2, middle[1] + 1.2] as const);
    expect(tableId).not.toBeNull();
    const before = (await placed()).find((item) => item.id === tableId);
    if (before === undefined) throw new Error("The staged table is not placed");
    const onTable = await page.evaluate(([x, z]) => {
      const lens = window.__venPerf?.camera;
      if (lens === undefined) return null;
      const point = lens.position.clone().set(x, 0.4, z).project(lens);
      const rect = document.querySelector("canvas")?.getBoundingClientRect();
      if (rect === undefined) return null;
      return [rect.left + (point.x * 0.5 + 0.5) * rect.width, rect.top + (-point.y * 0.5 + 0.5) * rect.height] as const;
    }, [before.x, before.z] as const);
    if (onTable === null) throw new Error("Cannot find the table on screen");
    const restBeforeLift = await stillCamera();
    await touch("touchStart", [onTable]);
    await page.waitForTimeout(420);
    expect(await mode()).toBe("lift");
    for (let step = 1; step <= 10; step++) {
      await touch("touchMove", [[onTable[0] + step * 6, onTable[1] - step * 3]]);
      await page.waitForTimeout(16);
    }
    await touch("touchEnd", []);
    await expect.poll(async () => {
      const after = (await placed()).find((item) => item.id === tableId);
      return after === undefined ? 0 : Math.hypot(after.x - before.x, after.z - before.z);
    }).toBeGreaterThan(0.2);
    expect(distance(await camera(), restBeforeLift)).toBeLessThan(1e-6);

    // Two fingers spreading apart zoom: the camera moves, and nothing is placed or lifted.
    const placedBeforePinch = (await placed()).length;
    await touch("touchStart", [[centre[0] - 30, centre[1]], [centre[0] + 30, centre[1]]]);
    for (let step = 1; step <= 10; step++) {
      await touch("touchMove", [[centre[0] - 30 - step * 8, centre[1]], [centre[0] + 30 + step * 8, centre[1]]]);
      await page.waitForTimeout(16);
    }
    await touch("touchEnd", []);
    const afterPinch = await stillCamera();
    expect(distance(afterPinch, restBeforeLift)).toBeGreaterThan(1e-3);
    expect((await placed()).length).toBe(placedBeforePinch);
    await expectNoArbiterLeft(page);
  });
});

async function expectNoArbiterLeft(page: Page): Promise<void> {
  await expect.poll(() => page.evaluate(() => window.__plannerTouch?.mode() ?? "missing")).toBe("idle");
}
