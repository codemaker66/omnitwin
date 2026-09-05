import { randomUUID } from "node:crypto";
import { test, expect, type APIRequestContext, type Page } from "@playwright/test";
import { VenueInventoryListResponseSchema, VenueInventoryWriteResponseSchema } from "@omnitwin/types";

// Real local PostgreSQL + Fastify. Only identity uses the existing test-mode
// auth fixture; no successful inventory response is mocked. See the T-591 report.
const API = process.env["INVENTORY_LIVE_API_URL"] ?? "";
const enabled = /^http:\/\/127\.0\.0\.1:\d+$/u.test(API);
const venueId = "59100000-0000-4000-8000-000000000001";
const otherVenueId = "59100000-0000-4000-8000-000000000002";
const chairId = "59100000-0000-4000-8000-000000000021";
const tableId = "59100000-0000-4000-8000-000000000022";
const admin = { id: "59100000-0000-4000-8000-000000000011", name: "Elaine · local fixture",
  email: "elaine@inventory.local.test", role: "admin", platformRole: "none", venueId };
const headers = { authorization: `Bearer ${JSON.stringify(admin)}` };
test.skip(!enabled, "Requires the isolated inventory PostgreSQL/API fixture on loopback.");
test.describe.configure({ mode: "serial" });

async function identity(page: Page, role = "admin", platformRole = "none"): Promise<void> {
  await page.addInitScript((user) => {
    Object.defineProperty(window, "__OMNITWIN_E2E__", { value: true });
    Object.defineProperty(window, "__OMNITWIN_SEED_USER__", { value: user });
  }, { ...admin, role, platformRole });
}
async function inventory(request: APIRequestContext) {
  const response = await request.get(`${API}/venues/${venueId}/inventory`, { headers });
  expect(response.ok()).toBe(true);
  return VenueInventoryListResponseSchema.parse(await response.json()).data;
}
async function write(request: APIRequestContext, assetId: string, ownedQuantity: number, reason: string) {
  const data = await inventory(request);
  const stock = data.items.find((item) => item.catalogue.id === assetId)?.stock ?? null;
  const response = await request.post(`${API}/venues/${venueId}/inventory/${assetId}/adjustments`, {
    headers, data: { commandId: randomUUID(), expectedRevision: stock?.revision ?? null,
      ownedQuantity, damagedQuantity: assetId === chairId ? 20 : 0, unavailableQuantity: 0,
      storageLocation: assetId === chairId ? "East store" : "West store", status: "active", hires: [], reason },
  });
  expect(response.ok()).toBe(true);
  return VenueInventoryWriteResponseSchema.parse(await response.json()).data;
}
async function open(page: Page): Promise<void> {
  await identity(page);
  await page.goto("/dashboard?view=inventory");
  await expect(page.getByRole("heading", { name: "Inventory", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Adjust Chiavari chair", exact: true })).toBeVisible();
}

test.beforeAll(async ({ request }) => {
  await write(request, chairId, 200, "Local browser fixture baseline");
});

test("unrecorded stock can become an explicit zero and survives a new page load", async ({ page, request }) => {
  await open(page);
  const row = page.getByRole("row").filter({ has: page.getByText("Round table", { exact: true }) });
  await expect(row).toContainText("Not recorded");
  await page.getByRole("button", { name: "Record Round table", exact: true }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel("Owned", { exact: true }).fill("0");
  await dialog.getByLabel("Damaged", { exact: true }).fill("0");
  await dialog.getByLabel("Other unavailable", { exact: true }).fill("0");
  await dialog.getByLabel("Reason", { exact: true }).fill("Zero count verification");
  await dialog.getByRole("button", { name: "Save stock record", exact: true }).click();
  await expect(dialog.getByRole("heading", { name: "Stock saved" })).toBeVisible();
  await dialog.getByRole("button", { name: "Done", exact: true }).click();
  await page.reload();
  await expect(page.getByRole("button", { name: "Adjust Round table", exact: true })).toBeVisible();
  await expect(row).not.toContainText("Not recorded");
  const persisted = (await inventory(request)).items.find((item) => item.catalogue.id === tableId)?.stock;
  expect(persisted?.ownedQuantity).toBe(0);
  await write(request, tableId, 24, "Local browser table count");
});

test("count corrections persist with a readable audit receipt", async ({ page, request }) => {
  await open(page);
  await page.getByRole("button", { name: "Adjust Chiavari chair", exact: true }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel("Owned", { exact: true }).fill("190");
  await dialog.getByLabel("Reason", { exact: true }).fill("Ten chairs removed after the stock count");
  await dialog.getByRole("button", { name: "Save adjustment", exact: true }).click();
  await expect(dialog.getByRole("heading", { name: "Stock saved" })).toBeVisible();
  await dialog.locator(".inventory-success > .inventory-receipt > summary").click();
  await expect(dialog.locator(".inventory-success")).toContainText("200 → 190");
  await expect(dialog.locator(".inventory-success")).toContainText("Ten chairs removed after the stock count");
  await dialog.getByRole("button", { name: "Done", exact: true }).focus();
  await page.keyboard.press("Tab");
  await expect(dialog.locator(".inventory-history > summary")).toBeFocused();
  await dialog.getByRole("button", { name: "Done", exact: true }).click();
  await page.reload();
  await page.getByRole("button", { name: "Adjust Chiavari chair", exact: true }).click();
  await expect(page.getByRole("dialog").getByLabel("Owned", { exact: true })).toHaveValue("190");
  expect((await inventory(request)).items.find((item) => item.catalogue.id === chairId)?.stock?.ownedQuantity).toBe(190);
});

test("a concurrent update is shown and explicit review preserves the editor's intent", async ({ page, request }) => {
  await write(request, chairId, 200, "Concurrent test baseline");
  await open(page);
  await page.getByRole("button", { name: "Adjust Chiavari chair", exact: true }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel("Owned", { exact: true }).fill("220");
  await dialog.getByLabel("Reason", { exact: true }).fill("Reviewed count after concurrent correction");
  await write(request, chairId, 210, "Another administrator's correction");
  await dialog.getByRole("button", { name: "Save adjustment", exact: true }).click();
  await expect(dialog.getByRole("heading", { name: "This stock record changed" })).toBeVisible();
  await expect(dialog.getByLabel("Owned", { exact: true })).toHaveValue("220");
  await expect(dialog.getByText(/Latest: 210 owned/u)).toBeVisible();
  await dialog.getByRole("button", { name: "Keep my edits against latest record", exact: true }).click();
  await dialog.getByRole("button", { name: "Save adjustment", exact: true }).click();
  await expect(dialog.getByRole("heading", { name: "Stock saved" })).toBeVisible();
  expect((await inventory(request)).items.find((item) => item.catalogue.id === chairId)?.stock?.ownedQuantity).toBe(220);
});

test("a lost response can be closed and retried after reopening without another revision", async ({ page, request }) => {
  await write(request, chairId, 200, "Lost-response baseline");
  await open(page);
  await page.getByRole("button", { name: "Adjust Chiavari chair", exact: true }).click();
  const dialog = page.getByRole("dialog");
  const adjustmentUrl = `${API}/venues/${venueId}/inventory/${chairId}/adjustments`;
  // Fault injection only: the real server commits, then its response is lost.
  await page.route(adjustmentUrl, async (route) => {
    const response = await route.fetch();
    expect(response.ok()).toBe(true);
    await route.abort("failed");
  }, { times: 1 });
  await dialog.getByLabel("Owned", { exact: true }).fill("215");
  await dialog.getByLabel("Reason", { exact: true }).fill("Response-loss verification");
  await dialog.getByRole("button", { name: "Save adjustment", exact: true }).click();
  await expect(dialog.getByRole("button", { name: "Retry this save", exact: true })).toBeVisible();
  const committed = (await inventory(request)).items.find((item) => item.catalogue.id === chairId)?.stock;
  expect(committed?.ownedQuantity).toBe(215);
  await dialog.getByRole("button", { name: "Close and check later", exact: true }).click();
  await expect(dialog).toHaveCount(0);
  await page.getByRole("button", { name: "Adjust Chiavari chair", exact: true }).click();
  await expect(dialog.getByRole("button", { name: "Retry this save", exact: true })).toBeVisible();
  await dialog.getByRole("button", { name: "Retry this save", exact: true }).click();
  await expect(dialog.getByRole("heading", { name: "Stock saved" })).toBeVisible();
  const retried = (await inventory(request)).items.find((item) => item.catalogue.id === chairId)?.stock;
  expect(retried?.revision).toBe(committed?.revision);
});

test("venue isolation and platform-only authority are enforced by real HTTP", async ({ request, page }) => {
  const foreign = await request.get(`${API}/venues/${otherVenueId}/inventory`, { headers });
  expect(foreign.status()).toBe(403);
  for (const role of ["staff", "hallkeeper", "client", "planner"]) {
    const response = await request.get(`${API}/venues/${venueId}/inventory`, {
      headers: { authorization: `Bearer ${JSON.stringify({ ...admin, role, platformRole: "admin" })}` },
    });
    expect(response.status()).toBe(403);
  }
  await identity(page, "staff", "admin");
  await page.goto("/dashboard?view=inventory");
  await expect(page.getByRole("alert").filter({ hasText: "Role restricted" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Adjust Chiavari chair", exact: true })).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "Inventory", exact: true })).toHaveCount(0);
});

for (const viewport of [{ name: "desktop", width: 1600, height: 1000 },
  { name: "tablet", width: 1024, height: 1366 }, { name: "phone", width: 390, height: 844 }]) {
  test(`${viewport.name}: real stock and adjustment controls fit and remain keyboard-accessible`, async ({ page }) => {
    await page.setViewportSize(viewport);
    if (viewport.name === "phone") await page.emulateMedia({ reducedMotion: "reduce" });
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await open(page);
    await expect(page.getByText(/Booking availability is not connected/u)).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true);
    await page.screenshot({ path: test.info().outputPath(`${viewport.name}-inventory.png`), fullPage: true });
    const opener = page.getByRole("button", { name: "Adjust Chiavari chair", exact: true });
    await opener.click();
    const dialog = page.getByRole("dialog");
    await expect(dialog.getByLabel("Owned", { exact: true })).toBeVisible();
    await page.keyboard.press("Tab");
    expect(await dialog.evaluate((element) => element.contains(document.activeElement))).toBe(true);
    await dialog.getByRole("button", { name: "Cancel", exact: true }).focus();
    await page.keyboard.press("Tab");
    await expect(dialog.locator(".inventory-history > summary")).toBeFocused();
    await page.keyboard.press("Shift+Tab");
    await expect(dialog.getByRole("button", { name: "Cancel", exact: true })).toBeFocused();
    await page.keyboard.press("Tab");
    await page.keyboard.press("Enter");
    await expect(dialog.locator(".inventory-history")).toHaveAttribute("open", "");
    await page.keyboard.press("Tab");
    expect(await dialog.evaluate((element) => element.contains(document.activeElement))).toBe(true);
    const firstReceipt = dialog.locator(".inventory-history > .inventory-receipt").first();
    await expect(firstReceipt.locator(":scope > summary")).toBeFocused();
    await page.keyboard.press("Enter");
    await page.keyboard.press("Tab");
    await expect(firstReceipt.getByText("Audit identifiers", { exact: true })).toBeFocused();
    await page.keyboard.press("Enter");
    await expect(firstReceipt.locator("details")).toHaveAttribute("open", "");
    await page.keyboard.press("Tab");
    expect(await dialog.evaluate((element) => element.contains(document.activeElement))).toBe(true);
    const closeButton = dialog.getByRole("button", { name: "Close inventory adjustment", exact: true });
    await closeButton.focus();
    await page.keyboard.press("Shift+Tab");
    expect(await dialog.evaluate((element) => element.contains(document.activeElement))).toBe(true);
    await page.keyboard.press("Tab");
    await expect(closeButton).toBeFocused();
    await dialog.evaluate(async (element) => {
      await Promise.all(element.getAnimations({ subtree: true }).map(async (animation) => {
        await animation.finished.catch(() => undefined);
      }));
      element.scrollTop = 0;
    });
    expect(await dialog.evaluate((element) => getComputedStyle(element).opacity)).toBe("1");
    expect(await dialog.evaluate((element) => getComputedStyle(element).backgroundColor)).toBe("rgb(29, 32, 30)");
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true);
    await page.screenshot({ path: test.info().outputPath(`${viewport.name}-adjustment.png`), fullPage: false });
    await page.keyboard.press("Escape");
    await expect(dialog).toHaveCount(0);
    await expect(opener).toBeFocused();
    expect(errors).toEqual([]);
  });
}
