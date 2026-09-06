import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { setTimeout as waitForQuota } from "node:timers/promises";
import { test, expect, type APIRequestContext, type Page } from "@playwright/test";
import { z } from "zod";
import { InventoryAssessmentResponseSchema, InventoryReservationHistoryResponseSchema,
  InventoryRemedyPrepareResponseSchema, VenueInventoryListResponseSchema, VenueInventoryWriteResponseSchema } from "@omnitwin/types";

// Real local API/PostgreSQL path. Fault injection below loses a response only
// after the server has executed it; no successful response is fabricated.
const apiUrl = process.env["INVENTORY_LIVE_API_URL"] ?? "";
const manifestPath = process.env["INVENTORY_RESERVATIONS_FIXTURE"];
const evidenceDir = process.env["INVENTORY_RESERVATIONS_EVIDENCE"];
const FixtureSchema = z.object({ venueId: z.string().uuid(), otherVenueId: z.string().uuid(), adminId: z.string().uuid(), secondAdminId: z.string().uuid(),
  chairId: z.string().uuid(), window: z.object({ startsAt: z.string(), endsAt: z.string() }),
  rooms: z.array(z.object({ eventId: z.string().uuid(), spaceId: z.string().uuid(), quantity: z.number() })) });
const fixture = manifestPath === undefined ? null : FixtureSchema.parse(JSON.parse(readFileSync(manifestPath, "utf8")));
test.skip(fixture === null || !/^http:\/\/127\.0\.0\.1:\d+$/u.test(apiUrl), "Requires the isolated reservations fixture/API on loopback");
test.describe.configure({ mode: "serial" });
const pageErrors = new WeakMap<Page, string[]>();
test.beforeEach(async ({ page, request }, testInfo) => {
  const errors: string[] = [];
  pageErrors.set(page, errors);
  page.on("pageerror", (error) => errors.push(error.message));
  // Respect the real shared loopback quota between workflows. Never retry a
  // mutation or weaken the API limiter to make the integration suite pass.
  const probe = await request.get(endpoint(""), { headers: headers() });
  expect([200, 429]).toContain(probe.status());
  const remaining = Number(probe.headers()["x-ratelimit-remaining"]);
  expect(Number.isInteger(remaining) && remaining >= 0).toBe(true);
  if (probe.status() === 429 || remaining < 50) {
    const resetSeconds = Number(probe.headers()[probe.status() === 429 ? "retry-after" : "x-ratelimit-reset"]);
    expect(Number.isInteger(resetSeconds) && resetSeconds >= 0 && resetSeconds <= 60).toBe(true);
    const waitMs = resetSeconds * 1000 + 500;
    testInfo.setTimeout(testInfo.timeout + waitMs + 5000);
    await testInfo.attach("quota-pacing", { body: JSON.stringify({ remaining, resetSeconds, waitMs }), contentType: "application/json" });
    await waitForQuota(waitMs);
    const refreshed = await request.get(endpoint(""), { headers: headers() });
    expect(refreshed.status(), await refreshed.text()).toBe(200);
    expect(Number(refreshed.headers()["x-ratelimit-remaining"])).toBeGreaterThanOrEqual(50);
  }
});
test.afterEach(({ page }) => {
  expect(pageErrors.get(page) ?? [], "Uncaught browser errors").toEqual([]);
});

function requiredFixture() {
  if (fixture === null) throw new Error("Reservation fixture manifest is missing");
  return fixture;
}
function admin() {
  const data = requiredFixture();
  return { id: data.adminId, name: "Elaine · local fixture", email: `${data.adminId}@inventory.local.test`,
    role: "admin", platformRole: "none", venueId: data.venueId };
}
function headers() { return { authorization: `Bearer ${JSON.stringify(admin())}` }; }
function endpoint(suffix: string): string { return `${apiUrl}/venues/${requiredFixture().venueId}/inventory${suffix}`; }
async function assessment(request: APIRequestContext) {
  const window = requiredFixture().window;
  const response = await request.get(endpoint(`/assessment?${new URLSearchParams({ from: window.startsAt, to: window.endsAt }).toString()}`), { headers: headers() });
  expect(response.status(), await response.text()).toBe(200);
  return InventoryAssessmentResponseSchema.parse(await response.json()).data;
}
function browserDate(value: string): string {
  const parts = new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/London", year: "numeric", month: "2-digit",
    day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(new Date(value));
  const part = (type: Intl.DateTimeFormatPartTypes): string => parts.find((entry) => entry.type === type)?.value ?? "";
  return `${part("year")}-${part("month")}-${part("day")}T${part("hour")}:${part("minute")}`;
}
async function open(page: Page): Promise<void> {
  await page.addInitScript((user) => {
    Object.defineProperty(window, "__OMNITWIN_E2E__", { value: true });
    Object.defineProperty(window, "__OMNITWIN_SEED_USER__", { value: user });
  }, admin());
  await page.goto("/dashboard?view=inventory");
  await expect(page.getByRole("heading", { name: "Inventory", exact: true })).toBeVisible();
  await page.getByText("Choose period", { exact: true }).click();
  await page.getByLabel("From", { exact: true }).fill(browserDate(requiredFixture().window.startsAt));
  await page.getByLabel("Until", { exact: true }).fill(browserDate(requiredFixture().window.endsAt));
  await page.getByRole("button", { name: "Assess demand", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Reservations and source layouts", exact: true })).toBeVisible();
}
async function beginReservation(page: Page, room: "Grand Hall" | "Saloon"): Promise<void> {
  const label = room === "Grand Hall" ? "Review reservation · Autumn dinner · fixture · Grand Hall · fixture"
    : "Review reservation · Client reception · fixture · Saloon · fixture";
  await page.getByRole("button", { name: label, exact: true }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog.getByRole("button", { name: "Approve reservation", exact: true })).toBeDisabled();
  await dialog.getByLabel("Reason for reservation decision", { exact: true }).fill("Reviewed exact layout and equipment setup through return");
  await dialog.getByLabel("I confirm these recorded times cover equipment setup through return.", { exact: true }).check();
}
async function recordedHistory(request: APIRequestContext, index: number) {
  const room = requiredFixture().rooms[index];
  if (room === undefined) throw new Error("Fixture room missing");
  const response = await request.get(endpoint(`/reservations/${room.eventId}/${room.spaceId}/history`), { headers: headers() });
  expect(response.status()).toBe(200);
  return InventoryReservationHistoryResponseSchema.parse(await response.json()).data;
}
async function correctStock(request: APIRequestContext, ownedQuantity: number) {
  const response = await request.get(endpoint(""), { headers: headers() });
  expect(response.status()).toBe(200);
  const stock = VenueInventoryListResponseSchema.parse(await response.json()).data.items.find((item) => item.catalogue.id === requiredFixture().chairId)?.stock;
  if (stock === undefined || stock === null) throw new Error("Fixture chair stock missing");
  const saved = await request.post(endpoint(`/${requiredFixture().chairId}/adjustments`), { headers: headers(),
    data: { commandId: randomUUID(), expectedRevision: stock.revision, ownedQuantity, damagedQuantity: 20,
      unavailableQuantity: 0, hires: [], storageLocation: "East store", status: "active", reason: "Concurrent local count verification" } });
  expect(saved.status(), await saved.text()).toBe(200);
  return VenueInventoryWriteResponseSchema.parse(await saved.json()).data;
}

test("admin reviews exact occupied demand and records the first reservation", async ({ page, request }) => {
  await open(page);
  await expect(page.getByRole("heading", { name: "Coverage gaps remain", exact: true })).toBeVisible();
  await beginReservation(page, "Grand Hall");
  const dialog = page.getByRole("dialog");
  await expect(dialog.getByText("120 × Chiavari chair", { exact: true })).toBeVisible();
  await expect(dialog.getByText(/does not acquire equipment or resolve shortages/u)).toBeVisible();
  await dialog.getByRole("button", { name: "Approve reservation", exact: true }).click();
  await expect(dialog.getByRole("heading", { name: "Reservation approved", exact: true })).toBeVisible();
  expect(await dialog.evaluate((element) => element.contains(document.activeElement))).toBe(true);
  expect(await recordedHistory(request, 0)).toHaveLength(1);
  await page.reload();
  await expect(page.locator(".inventory-source").filter({ hasText: "Autumn dinner · fixture" })).toContainText("Reservation approved");
});

test("the second approval shows its shortage and survives a committed-but-lost response", async ({ page, request }) => {
  await open(page);
  await beginReservation(page, "Saloon");
  const dialog = page.getByRole("dialog");
  await expect(dialog.locator(".inventory-shortage")).toHaveText("-10");
  await page.route(endpoint("/reservations/approve"), async (route) => {
    const response = await route.fetch();
    expect(response.status()).toBe(200);
    await route.abort("failed");
  }, { times: 1 });
  await dialog.getByRole("button", { name: "Approve reservation", exact: true }).click();
  await expect(dialog.getByRole("heading", { name: "Result not confirmed", exact: true })).toBeVisible();
  await expect(dialog.getByRole("button", { name: "Close and check later", exact: true })).toBeVisible();
  await dialog.getByRole("button", { name: "Close and check later", exact: true }).click();
  await page.reload();
  await page.getByRole("button", { name: "Check recorded result", exact: true }).click();
  await expect(page.getByRole("dialog").getByRole("heading", { name: "Reservation approved", exact: true })).toBeVisible();
  expect(await recordedHistory(request, 1)).toHaveLength(1);
  const current = await assessment(request);
  expect(current.items.find((item) => item.assetDefinitionId === requiredFixture().chairId)?.availability?.minimumRemainingQuantity).toBe(-10);
});

test("hire remedy is prepared then explicitly approved while the shortage stays visible", async ({ page, request }) => {
  await open(page);
  await page.getByRole("button", { name: "Prepare remedy · Chiavari chair", exact: true }).click();
  let dialog = page.getByRole("dialog");
  await dialog.getByLabel("Requested quantity", { exact: true }).fill("10");
  await dialog.getByLabel("Reason for request", { exact: true }).fill("Obtain a supplier quote for ten additional chairs");
  await dialog.getByRole("button", { name: "Prepare request", exact: true }).click();
  await expect(dialog.getByRole("button", { name: "Approve internal request", exact: true })).toBeVisible();
  expect((await assessment(request)).remedies.filter((remedy) => remedy.status === "approved")).toHaveLength(0);
  await dialog.getByRole("button", { name: "Approve internal request", exact: true }).click();
  dialog = page.getByRole("dialog");
  await expect(dialog.getByRole("heading", { name: "Internal request approved", exact: true })).toBeVisible();
  expect(await dialog.evaluate((element) => element.contains(document.activeElement))).toBe(true);
  const current = await assessment(request);
  expect(current.remedies.filter((remedy) => remedy.status === "approved")).toHaveLength(1);
  expect(current.items.find((item) => item.assetDefinitionId === requiredFixture().chairId)?.availability?.minimumRemainingQuantity).toBe(-10);
});

test("a prepared remedy cannot be approved after a concurrent stock revision", async ({ page, request }) => {
  await open(page);
  await page.getByRole("button", { name: "Prepare remedy · Chiavari chair", exact: true }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel("Requested quantity", { exact: true }).fill("10");
  await dialog.getByLabel("Reason for request", { exact: true }).fill("Review against the currently recorded stock");
  await dialog.getByRole("button", { name: "Prepare request", exact: true }).click();
  await expect(dialog.getByRole("button", { name: "Approve internal request", exact: true })).toBeVisible();
  await correctStock(request, 200);
  await dialog.getByRole("button", { name: "Approve internal request", exact: true }).click();
  await expect(page.getByText(/Facts changed. Review a fresh assessment/u)).toBeVisible();
  await expect(page.getByRole("button", { name: "Approve internal request", exact: true })).toHaveCount(0);
  expect((await assessment(request)).remedies.filter((remedy) => remedy.status === "approved")).toHaveLength(1);
});

test("an honest stock correction refreshes shortages without changing approved event instructions", async ({ page, request }) => {
  const before = await recordedHistory(request, 0);
  await open(page);
  await page.getByRole("button", { name: "Adjust Chiavari chair", exact: true }).click();
  const dialog = page.getByRole("region", { name: "Correct stock", exact: true });
  await dialog.getByLabel("Owned", { exact: true }).fill("190");
  await dialog.getByLabel("Reason", { exact: true }).fill("Ten chairs removed following physical inspection");
  await dialog.getByRole("button", { name: "Save stock correction", exact: true }).click();
  await expect(dialog.getByRole("heading", { name: "Stock saved", exact: true })).toBeVisible();
  await dialog.getByRole("button", { name: "Done", exact: true }).click();
  await expect(page.locator(".inventory-demand-item").filter({ has: page.getByRole("heading", { name: "Chiavari chair", exact: true }) }).locator(".inventory-shortage")).toHaveText("-20");
  expect(await recordedHistory(request, 0)).toEqual(before);
});

test("a lost prepare response recovers the current request approved meanwhile by another venue admin", async ({ page, request }) => {
  await open(page);
  let prepared: ReturnType<typeof InventoryRemedyPrepareResponseSchema.parse>["data"]["remedy"] | undefined;
  await page.route(endpoint("/remedies/prepare"), async (route) => {
    const response = await route.fetch();
    expect(response.status()).toBe(200);
    prepared = InventoryRemedyPrepareResponseSchema.parse(await response.json()).data.remedy;
    await route.abort("failed");
  }, { times: 1 });
  await page.getByRole("button", { name: "Prepare remedy · Chiavari chair", exact: true }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel("Requested quantity", { exact: true }).fill("20");
  await dialog.getByLabel("Reason for request", { exact: true }).fill("Another administrator will review this request");
  await dialog.getByRole("button", { name: "Prepare request", exact: true }).click();
  await expect(dialog.getByRole("heading", { name: "Result not confirmed", exact: true })).toBeVisible();
  await expect(dialog.getByRole("button", { name: "Close and check later", exact: true })).toBeVisible();
  if (prepared === undefined) throw new Error("The real server did not prepare a request");
  const secondAdmin = { ...admin(), id: requiredFixture().secondAdminId };
  const approved = await request.post(endpoint(`/remedies/${prepared.id}/approve`), {
    headers: { authorization: `Bearer ${JSON.stringify(secondAdmin)}` },
    data: { commandId: randomUUID(), expectedAssessmentDigest: prepared.assessmentDigest },
  });
  expect(approved.status(), await approved.text()).toBe(200);
  await dialog.getByRole("button", { name: "Close and check later", exact: true }).click();
  await page.reload();
  await page.getByRole("button", { name: "Check recorded result", exact: true }).click();
  await expect(page.getByRole("dialog").getByRole("heading", { name: "Internal request approved", exact: true })).toBeVisible();
  await expect(page.getByRole("dialog").getByRole("button", { name: "Approve internal request", exact: true })).toHaveCount(0);
  expect((await assessment(request)).remedies.find((remedy) => remedy.id === prepared?.id)?.approvedBy).toBe(secondAdmin.id);
});

for (const viewport of [{ name: "desktop", width: 1600, height: 1000 },
  { name: "tablet", width: 1024, height: 1366 }, { name: "phone", width: 390, height: 844 }]) {
  test(`${viewport.name}: demand and review stay usable with keyboard and reduced motion`, async ({ page }) => {
    await page.setViewportSize(viewport);
    await page.emulateMedia({ reducedMotion: "reduce" });
    await open(page);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    const review = page.getByRole("button", { name: "Review reservation · Autumn dinner · fixture · Grand Hall · fixture", exact: true });
    await expect(review).toBeEnabled();
    await review.focus(); await page.keyboard.press("Enter");
    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible();
    expect(await dialog.evaluate((element) => { const box = element.getBoundingClientRect(); return box.left >= 0 && box.right <= window.innerWidth; })).toBe(true);
    await page.keyboard.press("Tab");
    expect(await dialog.evaluate((element) => element.contains(document.activeElement))).toBe(true);
    if (evidenceDir !== undefined) await page.screenshot({ path: join(evidenceDir, `${viewport.name}-reservation-review.png`) });
    await page.keyboard.press("Escape");
    await expect(dialog).toHaveCount(0);
    await expect(review).toBeFocused();
    if (evidenceDir !== undefined) await page.screenshot({ path: join(evidenceDir, `${viewport.name}-demand.png`), fullPage: true });
  });
}
