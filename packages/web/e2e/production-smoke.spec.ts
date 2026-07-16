import { test, expect, type Page } from "@playwright/test";

// ---------------------------------------------------------------------------
// Production smoke suite — the Diary's first live week (T-522).
// Runbook: docs/operations/diary-deploy-checklist.md §6.
//
// READ-ONLY by default. Self-gated: skips entirely unless PROD_SMOKE=1, so
// the default/CI e2e run never touches production.
//
//   PROD_SMOKE=1 SMOKE_BASE_URL=https://venviewer.com \
//   SMOKE_API_URL=https://api.venviewer.com \
//   SMOKE_EMAIL=... SMOKE_PASSWORD=... \
//   pnpm --filter @omnitwin/web exec playwright test e2e/production-smoke.spec.ts
//
// AUTH: use a DEDICATED smoke account — hallkeeper role for the read-only
// suite (it cannot write by design), staff only if you enable the write
// probe. Production sign-in may demand a new-device email code that no
// script should try to defeat; the robust path is a saved session:
//   1. npx playwright codegen --save-storage=.smoke/auth.json <SMOKE_BASE_URL>
//      (sign in once by hand in the window, then close it)
//   2. SMOKE_STORAGE_STATE=.smoke/auth.json  (path is gitignored)
// With a storage state present, SMOKE_EMAIL/PASSWORD are not needed.
//
// WRITE PROBE (optional, off by default): SMOKE_ALLOW_WRITE=1 creates one
// clearly-labelled house block tomorrow at 03:00 and immediately releases
// it — the only trace is a released row visible under "Show released &
// cancelled". Requires a staff-role smoke account.
// ---------------------------------------------------------------------------

const GATE = process.env["PROD_SMOKE"] === "1";
const BASE_URL = process.env["SMOKE_BASE_URL"] ?? "https://venviewer.com";
const API_URL = process.env["SMOKE_API_URL"] ?? "https://api.venviewer.com";
const STORAGE_STATE = process.env["SMOKE_STORAGE_STATE"];
const EMAIL = process.env["SMOKE_EMAIL"];
const PASSWORD = process.env["SMOKE_PASSWORD"];
const ALLOW_WRITE = process.env["SMOKE_ALLOW_WRITE"] === "1";
/** ONLY for dress rehearsals against a Clerk dev/test instance (424242).
 *  Never set against production — capture a storage state instead. */
const TEST_OTP = process.env["SMOKE_TEST_OTP"];

test.describe.configure({ mode: "serial" });

test.skip(!GATE, "Production smoke is opt-in — set PROD_SMOKE=1 (see diary-deploy-checklist.md §6).");

async function signIn(page: Page): Promise<void> {
  if (STORAGE_STATE !== undefined) return; // context already authenticated
  if (EMAIL === undefined || PASSWORD === undefined) {
    throw new Error(
      "Provide SMOKE_STORAGE_STATE (preferred — see the header) or SMOKE_EMAIL + SMOKE_PASSWORD.",
    );
  }
  await page.goto("/login");
  await page.waitForSelector("input[name=identifier]", { timeout: 30_000 });
  await page.fill("input[name=identifier]", EMAIL);
  await page.fill("input[name=password]", PASSWORD);
  await page.getByRole("button", { name: /^continue$/i }).click();
  const otp = page
    .locator("input[name=code], input[autocomplete=one-time-code], [data-otp-input]")
    .first();
  const outcome = await Promise.race([
    page
      .waitForURL((url) => !url.pathname.startsWith("/login"), { timeout: 25_000 })
      .then(() => "signed-in" as const),
    otp.waitFor({ state: "visible", timeout: 25_000 }).then(() => "challenged" as const),
  ]).catch(() => "stuck" as const);
  if (outcome === "challenged") {
    if (TEST_OTP !== undefined) {
      // Dress-rehearsal path (dev/test Clerk instance): answer the fixture code.
      await otp.click();
      await page.keyboard.type(TEST_OTP, { delay: 40 });
      await page.waitForURL((url) => !url.pathname.startsWith("/login"), { timeout: 25_000 });
      return;
    }
    throw new Error(
      "Production challenged this sign-in with an email code — capture a session once " +
        "with `npx playwright codegen --save-storage=.smoke/auth.json` and re-run with " +
        "SMOKE_STORAGE_STATE=.smoke/auth.json.",
    );
  }
  if (outcome === "stuck") throw new Error("Sign-in neither completed nor challenged in 25s.");
}

/** Open /diary and settle it: lanes rendered, first-run welcome dismissed.
 *  Order matters — wait for the board FIRST, so the welcome (which renders
 *  after auth resolves) is deterministically present-or-absent when checked;
 *  probing it earlier races its mount and leaves an overlay eating clicks. */
async function openDiary(page: Page): Promise<void> {
  await page.goto("/diary");
  await expect(page.getByText("Grand Hall").first()).toBeVisible({ timeout: 25_000 });
  const welcomeDismiss = page.getByRole("button", { name: "Take me to the diary" });
  if (await welcomeDismiss.isVisible().catch(() => false)) {
    await welcomeDismiss.click();
    await expect(welcomeDismiss).toBeHidden();
  }
}

test.use({
  baseURL: BASE_URL,
  ...(STORAGE_STATE === undefined ? {} : { storageState: STORAGE_STATE }),
});

test("the API answers on every health surface", async ({ request }) => {
  for (const path of ["/health/live", "/health/ready", "/health"] as const) {
    const response = await request.get(`${API_URL}${path}`);
    expect(response.ok(), `${path} should be 200`).toBe(true);
  }
  const version = await request.get(`${API_URL}/health/version`);
  expect(version.ok()).toBe(true);
  console.log(`[smoke] /health/version → ${(await version.text()).slice(0, 200)}`);
});

test("the front door stands", async ({ page }) => {
  await page.goto("/");
  await expect(page).toHaveTitle(/Trades Hall/i);
  await expect(page.locator("main, [role=main]").first()).toBeVisible({ timeout: 20_000 });
});

test("a signed-in coordinator reaches the Diary: live calendar, presence, welcome", async ({ page }) => {
  await signIn(page);
  // Lanes come from GET /calendar over the venue's REAL spaces; the
  // first-run welcome greets this fresh context and is dismissed inside.
  await openDiary(page);
  // The live channel authenticates and reports presence (at least you).
  await expect(page.getByText(/Live · \d/)).toBeVisible({ timeout: 25_000 });
  // The claim-safe disclosure stands on the live board.
  await expect(page.getByText(/Planning support only/).first()).toBeVisible();
});

test("write probe: a labelled house block lands and is released (opt-in)", async ({ page }) => {
  test.skip(!ALLOW_WRITE, "Write probe is opt-in — set SMOKE_ALLOW_WRITE=1 (staff account required).");

  await signIn(page);
  await openDiary(page);

  const tomorrow = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  const title = `Smoke probe — ignore (${tomorrow})`;

  await page.getByRole("button", { name: "New booking" }).click();
  const drawer = page.getByRole("dialog", { name: "New booking" });
  await expect(drawer).toBeVisible();
  await drawer.getByLabel("Commitment").selectOption({ label: "House block" });
  await drawer.getByLabel("Title", { exact: true }).fill(title);
  await drawer.getByLabel("Event type").fill("smoke");
  await drawer.getByLabel("Starts", { exact: true }).fill(`${tomorrow}T03:00`);
  await drawer.getByLabel("Ends", { exact: true }).fill(`${tomorrow}T03:30`);
  await drawer.getByRole("button", { name: "Add to the diary" }).click();
  await expect(page.getByText(`Added ${title} to the diary.`)).toBeVisible({ timeout: 15_000 });

  // Release it through the shared lifecycle matrix, leaving only a released
  // row (visible under "Show released & cancelled"). The title carries
  // regex metacharacters (parentheses) — escape before matching.
  const escaped = title.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const block = page.getByRole("button", { name: new RegExp(escaped) }).first();
  await block.focus();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("dialog", { name: "Booking details" })).toBeVisible();
  await page.getByRole("button", { name: "Release" }).click();
  await expect(page.getByText(/^Release: /)).toBeVisible({ timeout: 15_000 });
});
