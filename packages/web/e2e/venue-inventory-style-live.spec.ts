import { readFileSync } from "node:fs";
import { test, expect, type Page } from "@playwright/test";
import { z } from "zod";

// Run after the reservations suite against its actual, disposable local API.
// These checks do not mutate stock; they exercise the real dashboard/router.
const manifestPath = process.env["INVENTORY_RESERVATIONS_FIXTURE"];
const api = process.env["INVENTORY_LIVE_API_URL"] ?? "";
const fixture = manifestPath === undefined ? null : z.object({
  venueId: z.string().uuid(), adminId: z.string().uuid(),
}).parse(JSON.parse(readFileSync(manifestPath, "utf8")));
test.skip(fixture === null || !/^http:\/\/127\.0\.0\.1:\d+$/u.test(api), "Requires the owned local inventory fixture");

async function open(page: Page): Promise<void> {
  if (fixture === null) throw new Error("Missing local inventory fixture");
  await page.addInitScript((user) => {
    Object.defineProperty(window, "__OMNITWIN_E2E__", { value: true });
    Object.defineProperty(window, "__OMNITWIN_SEED_USER__", { value: user });
  }, { id: fixture.adminId, venueId: fixture.venueId, role: "admin", platformRole: "none",
    name: "Elaine · local fixture", email: `${fixture.adminId}@inventory.local.test` });
  await page.goto("/dashboard?view=inventory");
  await expect(page.getByRole("heading", { name: "Inventory", exact: true })).toBeVisible();
  await expect(page.getByRole("region", { name: "Correct stock", exact: true })).toBeVisible();
}

test("More and Diary preserve a dirty correction until the chosen route is accepted", async ({ page }) => {
  await open(page);
  const editor = page.getByRole("region", { name: "Correct stock", exact: true });
  await editor.getByLabel("Owned", { exact: true }).fill("201");
  await editor.getByRole("textbox", { name: "Reason", exact: true }).fill("Unfinished physical count");
  await page.getByRole("button", { name: "More", exact: true }).click();
  await page.getByRole("button", { name: "Enquiries", exact: true }).click();
  const leave = page.getByRole("dialog", { name: "Leave this stock correction?", exact: true });
  await expect(leave).toBeVisible();
  await expect(page).toHaveURL(/\/dashboard\?view=inventory$/u);
  await leave.getByRole("button", { name: "Keep editing", exact: true }).click();
  await expect(editor.getByLabel("Owned", { exact: true })).toHaveValue("201");
  await expect(editor.getByRole("textbox", { name: "Reason", exact: true })).toHaveValue("Unfinished physical count");
  await expect(editor.getByLabel("Owned", { exact: true })).toBeFocused();
  await page.getByRole("link", { name: "Review decisions", exact: true }).click();
  await expect(page).toHaveURL(/#inventory-decisions$/u);
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(editor.getByLabel("Owned", { exact: true })).toHaveValue("201");
  await page.getByRole("link", { name: "Diary", exact: true }).click();
  await expect(leave).toBeVisible();
  await leave.getByRole("button", { name: "Discard and leave", exact: true }).click();
  await expect(page).toHaveURL(/\/diary$/u);
  // A lazy route may update the URL before committing its screen. Verify the
  // destination actually mounted before asking Back to re-enter inventory.
  await expect(page.locator(".diary-title")).toBeVisible();
  await expect(editor).toHaveCount(0);
  await page.goBack();
  await expect(page).toHaveURL(/\/dashboard\?view=inventory#inventory-decisions$/u);
  await expect(page.getByRole("region", { name: "Correct stock", exact: true }).getByLabel("Owned", { exact: true })).not.toHaveValue("201");
});

test("filtering retains the selected draft and changing equipment asks before discarding it", async ({ page }) => {
  await open(page);
  const editor = page.getByRole("region", { name: "Correct stock", exact: true });
  await editor.getByLabel("Owned", { exact: true }).fill("202");
  await editor.getByRole("textbox", { name: "Reason", exact: true }).fill("Count still underway");
  await page.getByRole("searchbox", { name: "Find furniture or equipment", exact: true }).fill("projector");
  await expect(editor.getByLabel("Owned", { exact: true })).toHaveValue("202");
  await page.locator("#inventory-catalogue").getByRole("button").first().click();
  await expect(page.getByText("Keep these changes?", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Keep editing", exact: true }).click();
  await expect(editor.getByRole("textbox", { name: "Reason", exact: true })).toHaveValue("Count still underway");
  await page.locator("#inventory-catalogue").getByRole("button").first().click();
  await page.getByRole("button", { name: "Discard changes", exact: true }).click();
  const unrecorded = page.getByRole("region", { name: "Record stock", exact: true });
  await expect(unrecorded).toBeVisible();
  await expect(unrecorded.getByLabel("Owned", { exact: true })).toHaveValue("");
  await page.getByRole("searchbox", { name: "Find furniture or equipment", exact: true }).fill("no matching equipment fixture");
  await expect(page.getByText("No matching items. Try another name, category or storage location.", { exact: true })).toBeVisible();
  await expect(unrecorded).toBeVisible();
});

test("sign out waits for an explicit discard and Keep editing retains counts and focus", async ({ page }) => {
  await open(page);
  const editor = page.getByRole("region", { name: "Correct stock", exact: true });
  await editor.getByLabel("Owned", { exact: true }).fill("203");
  await editor.getByRole("textbox", { name: "Reason", exact: true }).fill("Unfinished sign-out test count");
  await page.getByRole("button", { name: "Account: Elaine · local fixture", exact: true }).click();
  await page.getByRole("button", { name: "Sign Out", exact: true }).click();
  const question = page.getByRole("dialog", { name: "Sign out with an unfinished correction?", exact: true });
  await expect(question).toBeVisible();
  await question.getByRole("button", { name: "Keep editing", exact: true }).click();
  await expect(editor.getByLabel("Owned", { exact: true })).toHaveValue("203");
  await expect(editor.getByLabel("Owned", { exact: true })).toBeFocused();
  await page.getByRole("button", { name: "Account: Elaine · local fixture", exact: true }).click();
  await page.getByRole("button", { name: "Sign Out", exact: true }).click();
  await question.getByRole("button", { name: "Discard and sign out", exact: true }).click();
  await expect(editor).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Account: Elaine · local fixture", exact: true })).toHaveCount(0);
});
