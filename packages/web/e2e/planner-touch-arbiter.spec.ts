import { expect, test, type Page } from "@playwright/test";
import type { BatchObjectInput } from "../src/api/configurations.js";
import { API, CONFIG_ID, GRAND_HALL_SPACE, RECEPTION_ROOM_SPACE, VENUE, settleCockpit, stubPlannerBootstrap } from "./support/plan-bootstrap.js";

// ---------------------------------------------------------------------------
// The touch arbiter on a phone (spec-card-dock §10.1, Q-01).
//
// Real touches through CDP on a booted planner with the backend stubbed and
// an uncaptured room: a swipe with a piece in hand looks round and places
// nothing; a quick tap places exactly one; a hold, a slide and a lift place
// with the camera still to a millionth; a still finger on a placed piece
// lifts and carries it; two fingers walk and zoom. Pieces are armed and
// staged through the development bridges, not the catalogue sheet, so this
// evidence does not hang on the sheet's choreography. The room's outline is
// centred on the origin the camera turns about, so a phone's first view is
// of its floor rather than into a corner.
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

/** The open part of a 393 x 852 phone's view: below the header and the provenance card, above the hint and the dock. */
const OPEN_TOP = 220;
const OPEN_BOTTOM = 590;

async function cameraAt(page: Page): Promise<readonly number[]> {
  return page.evaluate(() => {
    const position = window.__venPerf?.camera.position;
    return position === undefined ? [] : [position.x, position.y, position.z];
  });
}

function distance(a: readonly number[], b: readonly number[]): number {
  return Math.hypot((a[0] ?? 0) - (b[0] ?? 0), (a[1] ?? 0) - (b[1] ?? 0), (a[2] ?? 0) - (b[2] ?? 0));
}

/** Waits for the damped camera to come to rest, and returns where. */
async function stillCamera(page: Page): Promise<readonly number[]> {
  let previous = await cameraAt(page);
  for (let attempt = 0; attempt < 40; attempt++) {
    await page.waitForTimeout(150);
    const current = await cameraAt(page);
    if (distance(current, previous) < 1e-7) return current;
    previous = current;
  }
  throw new Error("The camera never came to rest");
}

/**
 * The floor point drawn nearest the middle of the open part of the view,
 * scanned over the planning floor every half metre, at least `clearOf`
 * metres from every point in `awayFrom` (pieces already set down there):
 * where it is on screen, and in the room.
 */
async function openFloor(page: Page, awayFrom: readonly Point[] = [], clearOf = 2): Promise<{ readonly screen: Point; readonly floor: Point }> {
  const found = await page.evaluate(([top, bottom, taken, clear]) => {
    const scene = window.__venPerf?.scene;
    const lens = window.__venPerf?.camera;
    const canvas = document.querySelector("canvas");
    const floor = scene?.getObjectByName("planner-interaction-floor");
    if (lens === undefined || canvas === null || floor === undefined || !("geometry" in floor)) return null;
    const geometry = (floor as { geometry: import("three").BufferGeometry }).geometry;
    geometry.computeBoundingBox();
    const box = geometry.boundingBox;
    if (box === null) return null;
    const rect = canvas.getBoundingClientRect();
    const low = floor.localToWorld(box.min.clone());
    const high = floor.localToWorld(box.max.clone());
    const goal = [rect.left + rect.width / 2, (top + bottom) / 2] as const;
    let best: { screen: readonly [number, number]; floor: readonly [number, number]; off: number } | null = null;
    for (let x = Math.min(low.x, high.x) + 0.5; x < Math.max(low.x, high.x) - 0.5; x += 0.5) {
      for (let z = Math.min(low.z, high.z) + 0.5; z < Math.max(low.z, high.z) - 0.5; z += 0.5) {
        const point = lens.position.clone().set(x, 0, z).project(lens);
        if (point.z > 1) continue;
        const sx = rect.left + (point.x * 0.5 + 0.5) * rect.width;
        const sy = rect.top + (-point.y * 0.5 + 0.5) * rect.height;
        if (sx < rect.left + 60 || sx > rect.right - 120 || sy < top || sy > bottom) continue;
        if (taken.some(([px, pz]) => Math.hypot(px - x, pz - z) < clear)) continue;
        const off = Math.hypot(sx - goal[0], sy - goal[1]);
        if (best === null || off < best.off) best = { screen: [sx, sy], floor: [x, z], off };
      }
    }
    return best;
  }, [OPEN_TOP, OPEN_BOTTOM, awayFrom, clearOf] as const);
  if (found === null) throw new Error("No floor in the open part of the view");
  return { screen: found.screen, floor: found.floor };
}

test.describe("the touch arbiter on a phone", () => {
  test.use({ viewport: { width: 393, height: 852 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });

  test("a swipe looks, a tap and a hold place, a hold lifts, two fingers walk", async ({ page }) => {
    test.setTimeout(180_000);
    await stubPlannerBootstrap(page, true);
    // The uncaptured room again, its outline centred (registered later, so these answers win).
    const room = {
      ...RECEPTION_ROOM_SPACE, name: "Uncaptured room", slug: "uncaptured-room",
      floorPlanOutline: [{ x: -6.7, y: -5.6 }, { x: 6.7, y: -5.6 }, { x: 6.7, y: 5.6 }, { x: -6.7, y: 5.6 }],
    };
    await page.route(`${API}/venues/${VENUE.id}`, (route) => { void route.fulfill({ json: { data: { ...VENUE, spaces: [GRAND_HALL_SPACE, room] } } }); });
    await page.route(`${API}/venues/${VENUE.id}/spaces`, (route) => { void route.fulfill({ json: { data: [GRAND_HALL_SPACE, room] } }); });
    await page.route(`${API}/venues/${VENUE.id}/spaces/${RECEPTION_ROOM_SPACE.id}`, (route) => { void route.fulfill({ json: { data: room } }); });
    // Saves succeed, as the API answers them, so no failure notice covers the room.
    await page.route(`${API}/public/configurations/${CONFIG_ID}/objects/batch`, (route) => {
      const body = route.request().postDataJSON() as { readonly expectedRevision: number; readonly objects: readonly BatchObjectInput[] };
      const objects = body.objects.map((object, index) => ({
        ...object, id: object.id ?? `e2e-touch-saved-${String(index)}`, configurationId: CONFIG_ID,
        positionX: String(object.positionX), positionY: String(object.positionY), positionZ: String(object.positionZ),
        rotationX: String(object.rotationX), rotationY: String(object.rotationY), rotationZ: String(object.rotationZ),
        scale: String(object.scale), metadata: object.metadata ?? null,
      }));
      void route.fulfill({ json: { data: { objects, revision: body.expectedRevision + 1 } } });
    });
    await page.route("**/splats/**", (route) => { void route.fulfill({ status: 404, body: "not in this spec" }); });
    await page.addInitScript(() => { window.localStorage.setItem("omnitwin_onboarding_seen", "1"); });
    await page.goto("/plan?pf=touchArbiter,seatsOnTheCard");
    await settleCockpit(page);
    await expect
      .poll(() => page.evaluate(() => document.querySelector(".cockpit-stage")?.getAttribute("data-resolve-phase") ?? "missing"),
        { timeout: 90_000, message: "waiting for the room resolve to settle" })
      .toBe("fallback");
    await expect
      .poll(() => page.evaluate(() => window.__plannerTouch !== undefined && window.__venPerf !== undefined && window.__plannerHands !== undefined),
        { timeout: 30_000 })
      .toBe(true);

    const cdp = await page.context().newCDPSession(page);
    type TouchType = "touchStart" | "touchMove" | "touchEnd";
    const touch = (type: TouchType, points: readonly Point[]): Promise<unknown> =>
      cdp.send("Input.dispatchTouchEvent", { type, touchPoints: points.map(([x, y], id) => ({ x, y, id })) });
    /**
     * A quick gesture as a finger makes it: every touch stamped with its own
     * time and all queued at once. Sent one by one, each would wait for the
     * page to handle the last, and on a slow page that wait reads as a hold
     * the finger never made.
     */
    const fingerSays = (events: readonly (readonly [TouchType, readonly Point[], number])[]): Promise<unknown> => {
      const base = Date.now() / 1000;
      return Promise.all(events.map(([type, points, atMs]) => cdp.send("Input.dispatchTouchEvent",
        { type, touchPoints: points.map(([x, y], id) => ({ x, y, id })), timestamp: base + atMs / 1000 })));
    };
    const canvas = await page.locator("canvas").first().boundingBox();
    if (canvas === null) throw new Error("No canvas");
    const middle: Point = [canvas.x + canvas.width / 2, canvas.y + (OPEN_TOP + OPEN_BOTTOM) / 2];
    const placed = (): Promise<readonly { readonly id: string; readonly slug: string | null; readonly x: number; readonly z: number }[]> =>
      page.evaluate(() => window.__plannerTouch?.placed() ?? []);
    const mode = (): Promise<string> => page.evaluate(() => window.__plannerTouch?.mode() ?? "missing");
    const poseurs = async (): Promise<number> => (await placed()).filter((item) => item.slug === "poseur-table").length;

    // In the room view, a swipe with a piece in hand looks round and places nothing.
    expect(await page.evaluate(() => window.__plannerTouch?.arm("poseur-table") ?? false)).toBe(true);
    const beforeSwipe = await stillCamera(page);
    await fingerSays([
      ["touchStart", [[middle[0] - 60, middle[1]]], 0],
      ...Array.from({ length: 10 }, (_, index) => ["touchMove", [[middle[0] - 48 + index * 12, middle[1]]], 16 * (index + 1)] as const),
      ["touchEnd", [], 180],
    ]);
    expect(distance(await stillCamera(page), beforeSwipe)).toBeGreaterThan(1e-3);
    expect(await poseurs()).toBe(0);

    const spot = await openFloor(page);

    // A quick tap with the piece in hand places exactly one, under the finger.
    await fingerSays([["touchStart", [spot.screen], 0], ["touchEnd", [], 40]]);
    await expect.poll(poseurs).toBe(1);
    const tapped = (await placed()).find((item) => item.slug === "poseur-table");
    expect(Math.hypot((tapped?.x ?? Infinity) - spot.floor[0], (tapped?.z ?? Infinity) - spot.floor[1])).toBeLessThan(0.6);

    // A hold, a slide and a lift place one at the ghost above the finger, and the view never moves.
    const restBeforeHold = await stillCamera(page);
    // The hold sets its piece down clear of the first: the finger starts below and left of where
    // the ghost should land, and slides right onto it.
    const second = await openFloor(page, [spot.floor]);
    const holdAt: Point = [second.screen[0] - 30, second.screen[1] + 64];
    await touch("touchStart", [holdAt]);
    // Held still: the ghost rises once the hold is judged (150 ms, then the next frame).
    await expect.poll(mode, { timeout: 5_000 }).toBe("place");
    for (let step = 1; step <= 12; step++) {
      await touch("touchMove", [[holdAt[0] + step * 5, holdAt[1]]]);
      await page.waitForTimeout(16);
    }
    await page.waitForTimeout(80);
    await touch("touchEnd", []);
    await expect.poll(poseurs).toBe(2);
    expect(distance(await cameraAt(page), restBeforeHold)).toBeLessThan(1e-6);

    // A still finger on a placed piece lifts it and carries it; the view stays still.
    await page.keyboard.press("Escape");
    const third = await openFloor(page, [spot.floor, second.floor], 2.2);
    const tableId = await page.evaluate(([x, z]) => window.__plannerHands?.placeTable(x, z) ?? null, third.floor);
    expect(tableId).not.toBeNull();
    // The staged round is the only one on the floor: found by kind, since a save gives it the server's id.
    const theRound = async (): Promise<{ readonly x: number; readonly z: number } | undefined> =>
      (await placed()).find((item) => item.slug === "round-table-6ft");
    const before = await theRound();
    if (before === undefined) throw new Error("The staged table is not placed");
    const onTable = await page.evaluate(([x, z]) => {
      const lens = window.__venPerf?.camera;
      const rect = document.querySelector("canvas")?.getBoundingClientRect();
      if (lens === undefined || rect === undefined) return null;
      const point = lens.position.clone().set(x, 0.4, z).project(lens);
      return [rect.left + (point.x * 0.5 + 0.5) * rect.width, rect.top + (-point.y * 0.5 + 0.5) * rect.height] as const;
    }, [before.x, before.z] as const);
    if (onTable === null) throw new Error("Cannot find the table on screen");
    const restBeforeLift = await stillCamera(page);
    await touch("touchStart", [onTable]);
    await expect.poll(mode, { timeout: 5_000 }).toBe("lift");
    for (let step = 1; step <= 10; step++) {
      await touch("touchMove", [[onTable[0] + step * 6, onTable[1] - step * 3]]);
      await page.waitForTimeout(16);
    }
    await touch("touchEnd", []);
    await expect.poll(async () => {
      const after = await theRound();
      return after === undefined ? 0 : Math.hypot(after.x - before.x, after.z - before.z);
    }).toBeGreaterThan(0.2);
    expect(distance(await cameraAt(page), restBeforeLift)).toBeLessThan(1e-6);

    // Two fingers spreading apart zoom: the view moves, nothing is placed or lifted.
    const beforePinch = await stillCamera(page);
    const placedBeforePinch = (await placed()).length;
    await touch("touchStart", [[middle[0] - 30, middle[1]], [middle[0] + 30, middle[1]]]);
    for (let step = 1; step <= 10; step++) {
      await touch("touchMove", [[middle[0] - 30 - step * 8, middle[1]], [middle[0] + 30 + step * 8, middle[1]]]);
      await page.waitForTimeout(16);
    }
    await touch("touchEnd", []);
    expect(distance(await stillCamera(page), beforePinch)).toBeGreaterThan(1e-3);
    expect((await placed()).length).toBe(placedBeforePinch);
    await expect.poll(mode).toBe("idle");
  });
});
