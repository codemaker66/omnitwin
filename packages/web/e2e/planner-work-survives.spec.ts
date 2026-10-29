import { expect, test, type Browser, type BrowserContext, type Page } from "@playwright/test";
import {
  PlannerSaveServer,
  SAVE_GRAND_HALL,
  SAVE_VENUE,
  signInAs,
  type SeedUser,
} from "./support/planner-save-server.js";

// ---------------------------------------------------------------------------
// E2E: planner work survives leaving the page or the layout (QoL D-01, D-X3).
//
// D-01: edits wait 3 s for the autosave, and nothing sent them when the page
// hid or closed. Hiding now sends them at once; a close that cuts the request
// off leaves them on this device, and reopening restores them with a receipt.
// (A close cannot promise the server has the work: a closing tab cancels its
// requests and keepalive caps the body at 64 KB, so the two paths are tested
// separately.)
//
// D-X3: switching room or layout from the new chrome's slate kept the same
// page, so the outgoing layout's autosave found the next layout loaded and
// clean. Without an event the room switch did not even open the room. Here a
// planner moves a table, switches to the Saloon within a second, and a second
// browser opening the Grand Hall layout sees the move.
//
// Edits go through the planner's own store, by importing the module Vite
// serves to the app (one module instance per URL): the very gesture calls a
// drag ends in. The layouts live in an in-memory server the browsers share.
// ---------------------------------------------------------------------------

interface StoreApi<S> { getState(): S }
interface EditorObjectLike { readonly id: string; readonly positionX: number }
interface EditorStateLike {
  readonly configId: string | null;
  readonly objects: readonly EditorObjectLike[];
  beginHistoryGesture(): symbol | null;
  endHistoryGesture(token: symbol): void;
  updateObject(id: string, patch: { positionX: number }): void;
}
interface EditorModule { readonly useEditorStore: StoreApi<EditorStateLike> }

const PLANNER: SeedUser = {
  id: "00000000-0000-4000-8000-000000007001",
  email: "planner@fixture.test",
  role: "planner",
  platformRole: "none",
  venueId: SAVE_VENUE.id,
  name: "Fixture Planner",
};
const GRAND_HALL_LAYOUT = "e2e-save-grand-hall-layout";
const TABLE = `${GRAND_HALL_LAYOUT}-table-1`;

test.describe.configure({ timeout: 120_000 });

function newServer(): PlannerSaveServer {
  const server = new PlannerSaveServer();
  server.seedLayout({ id: GRAND_HALL_LAYOUT, spaceId: SAVE_GRAND_HALL.id, userId: PLANNER.id, name: "Wedding breakfast", tablesAtX: [5, 9] });
  return server;
}

async function signedInContext(browser: Browser, server: PlannerSaveServer): Promise<BrowserContext> {
  const context = await browser.newContext();
  await server.attach(context);
  await signInAs(context, PLANNER);
  return context;
}

/** Open the layout and wait until the planner holds it. */
async function openLayout(page: Page, configId: string, chrome: "v1" | "v2"): Promise<void> {
  await page.goto(`/plan/${configId}${chrome === "v2" ? "?chrome=v2" : "?chrome=v1"}`);
  await expect.poll(() => page.evaluate(async (id) => {
    const editor = await import("/src/stores/editor-store.ts") as EditorModule;
    const state = editor.useEditorStore.getState();
    return state.configId === id && state.objects.length > 0;
  }, configId), { timeout: 60_000 }).toBe(true);
}

async function tableX(page: Page): Promise<number | null> {
  return page.evaluate(async (tableId) => {
    const editor = await import("/src/stores/editor-store.ts") as EditorModule;
    return editor.useEditorStore.getState().objects.find((object) => object.id === tableId)?.positionX ?? null;
  }, TABLE);
}

/** The move a drag ends in: one gesture, released. */
async function moveTable(page: Page, x: number): Promise<void> {
  await page.evaluate(async ({ tableId, to }) => {
    const editor = await import("/src/stores/editor-store.ts") as EditorModule;
    const state = editor.useEditorStore.getState();
    const token = state.beginHistoryGesture();
    state.updateObject(tableId, { positionX: to });
    if (token !== null) editor.useEditorStore.getState().endHistoryGesture(token);
  }, { tableId: TABLE, to: x });
}

function storedTableX(server: PlannerSaveServer): string | undefined {
  return server.layout(GRAND_HALL_LAYOUT)?.objects.find((object) => object.id === TABLE)?.positionX;
}

for (const chrome of ["v1", "v2"] as const) {
  test(`${chrome}: a move reaches the server as soon as the page is hidden, not 3 s later`, async ({ browser }) => {
    const server = newServer();
    const context = await signedInContext(browser, server);
    const page = await context.newPage();
    await openLayout(page, GRAND_HALL_LAYOUT, chrome);
    await moveTable(page, 7.25);
    const movedAt = Date.now();

    // The tab goes to the background (a phone switching apps, a hidden window).
    await page.evaluate(() => {
      Object.defineProperty(document, "visibilityState", { configurable: true, get: () => "hidden" });
      document.dispatchEvent(new Event("visibilitychange"));
    });
    await expect.poll(() => storedTableX(server), { timeout: 2_500 }).toBe("7.250");
    expect(Date.now() - movedAt).toBeLessThan(3_000);
    expect(server.saves.filter((save) => save.configId === GRAND_HALL_LAYOUT)).toHaveLength(1);
    await context.close();
  });

  test(`${chrome}: a move cut off by closing the tab comes back on this device, with a receipt, and saves`, async ({ browser }) => {
    const server = newServer();
    const context = await signedInContext(browser, server);
    const page = await context.newPage();
    await openLayout(page, GRAND_HALL_LAYOUT, chrome);

    // Closing the tab cancels the save: the server never hears of the move.
    server.dropSaves = true;
    await moveTable(page, 7.25);
    await page.close();
    expect(storedTableX(server)).toBe("5.000");
    server.dropSaves = false;

    const again = await context.newPage();
    await openLayout(again, GRAND_HALL_LAYOUT, chrome);
    expect(await tableX(again)).toBe(7.25);
    const receipt = chrome === "v2" ? again.locator(".pc-slate__notice") : again.getByTestId("planner-leaving-notes");
    await expect(receipt).toContainText(/Restored 1 change you made at \d\d:\d\d on this device/u);
    await expect.poll(() => storedTableX(server), { timeout: 10_000 }).toBe("7.250");
    await expect(receipt).toContainText(/Saved \d\d:\d\d/u);
    await context.close();
  });
}

test("v2: a move made just before switching to the Saloon reaches the server and another browser", async ({ browser }) => {
  const server = newServer();
  const first = await signedInContext(browser, server);
  const page = await first.newPage();
  await openLayout(page, GRAND_HALL_LAYOUT, "v2");
  expect(await tableX(page)).toBe(5);

  await moveTable(page, 7.25);
  expect(await tableX(page)).toBe(7.25);

  // Within a second of the move: the slate's menu, then the Saloon.
  await page.getByRole("button", { name: /Grand Hall/u }).first().click();
  await page.getByRole("button", { name: /^Saloon,/u }).click();

  // The Saloon opens in this page...
  await expect.poll(() => page.evaluate(async (grandHall) => {
    const editor = await import("/src/stores/editor-store.ts") as EditorModule;
    const id = editor.useEditorStore.getState().configId;
    return id !== null && id !== grandHall;
  }, GRAND_HALL_LAYOUT), { timeout: 30_000 }).toBe(true);
  await expect(page.getByRole("region", { name: /Saloon/u })).toBeVisible();

  // ...and the move went first, once.
  expect(storedTableX(server)).toBe("7.250");
  expect(server.saves.filter((save) => save.configId === GRAND_HALL_LAYOUT)).toHaveLength(1);

  // Another browser opening the Grand Hall layout sees the moved table.
  const second = await signedInContext(browser, server);
  const other = await second.newPage();
  await openLayout(other, GRAND_HALL_LAYOUT, "v2");
  expect(await tableX(other)).toBe(7.25);

  await first.close();
  await second.close();
});

test("v2: a switch the save cannot make in time still opens the Saloon, and says the move is kept here", async ({ browser }) => {
  const server = newServer();
  const context = await signedInContext(browser, server);
  const page = await context.newPage();
  await openLayout(page, GRAND_HALL_LAYOUT, "v2");

  server.dropSaves = true;
  await moveTable(page, 7.25);
  await page.getByRole("button", { name: /Grand Hall/u }).first().click();
  await page.getByRole("button", { name: /^Saloon,/u }).click();

  await expect(page.locator(".pc-slate__notice")).toContainText(
    "Your changes to the Grand Hall layout are kept on this device and save when you open it again.",
    { timeout: 30_000 },
  );
  await expect(page.getByRole("region", { name: /Saloon/u })).toBeVisible();
  expect(storedTableX(server)).toBe("5.000");

  // Opening the Grand Hall layout again sends it.
  server.dropSaves = false;
  await openLayout(page, GRAND_HALL_LAYOUT, "v2");
  expect(await tableX(page)).toBe(7.25);
  await expect.poll(() => storedTableX(server), { timeout: 10_000 }).toBe("7.250");
  await context.close();
});
