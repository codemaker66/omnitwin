import { expect, type Locator, type Page } from "@playwright/test";

// ---------------------------------------------------------------------------
// Live-diary e2e support (Slice 4, T-518). Unlike plan-bootstrap.ts (which
// STUBS the backend for the planner specs) and the __OMNITWIN_E2E__ bypass
// (which skips Clerk entirely), this helper drives the REAL stack: Vite +
// the API on the local dev database (infra/dev-db/) + the real Clerk dev
// instance. Bypassing auth here would fake the very layers this slice
// exists to prove (token verification, seed-user linking, ws auth).
//
// Coordinators are Clerk TEST users — `+clerk_test` addresses verify with
// Clerk's published test code 424242 and never receive real mail — whose
// emails match seeded rows (clerkId NULL), so the first sign-in links them
// to the seeded staff identity (middleware/auth.ts getUserByClerkId).
//
// Prerequisites (runbook in docs/reports/slice-4-report.md):
//   1. local Postgres + neon-ws-bridge up, migrations applied, db:seed run
//   2. API on :3001 with DATABASE_URL → the dev DB
//   3. Vite with the pk_test Clerk key (NOT pk_live_localbuildcheck)
//   4. E2E_BASE_URL pointing at that Vite; E2E_START_SERVER=false
// ---------------------------------------------------------------------------

export interface Coordinator {
  readonly email: string;
  readonly username: string;
  readonly name: string;
}

export const FIONA: Coordinator = {
  email: "fiona.coordinator+clerk_test@tradeshall.co.uk",
  username: "fiona-coordinator",
  name: "Fiona Coordinator",
};

export const GRAHAM: Coordinator = {
  email: "graham.coordinator+clerk_test@tradeshall.co.uk",
  username: "graham-coordinator",
  name: "Graham Coordinator",
};

/** Test-instance-only fixture credential — not a secret (it guards nothing
 *  but a `+clerk_test` identity). Must match provision-clerk-test-users.mjs. */
export const E2E_PASSWORD = "TradesHall-diary-e2e-2026!";

/** The seed writes the week of Mon 14 Sep 2026 (Europe/London). */
export const SEEDED_WEEK_URL = "/diary?view=week&date=2026-09-16";

/**
 * Signs the coordinator in through the real Clerk form. The fixtures are
 * pre-provisioned (UI sign-up is not automatable — Clerk's bot-protection
 * step is a deliberate wall, and automating around a CAPTCHA is off the
 * table); a missing account fails loudly with the provisioning step.
 */
export async function signInCoordinator(page: Page, coordinator: Coordinator): Promise<void> {
  await page.goto("/login");
  await page.waitForSelector("input[name=identifier]", { timeout: 30_000 });
  await page.fill("input[name=identifier]", coordinator.email);
  await page.fill("input[name=password]", E2E_PASSWORD);
  await page.getByRole("button", { name: /^continue$/i }).click();

  const missing = page.getByText("Couldn't find your account.");
  const otp = page
    .locator("input[name=code], input[autocomplete=one-time-code], [data-otp-input]")
    .first();
  const outcome = await Promise.race([
    page
      .waitForURL((url) => !url.pathname.startsWith("/login"), { timeout: 25_000 })
      .then(() => "signed-in" as const),
    missing.waitFor({ state: "visible", timeout: 25_000 }).then(() => "missing" as const),
    otp.waitFor({ state: "visible", timeout: 25_000 }).then(() => "otp" as const),
  ]).catch(() => "stuck" as const);

  if (outcome === "missing") {
    throw new Error(
      `Clerk test user ${coordinator.email} does not exist — run ` +
        "`node infra/dev-db/provision-clerk-test-users.mjs` first.",
    );
  }
  if (outcome === "otp") {
    // First-device email check: +clerk_test identities verify with Clerk's
    // published test code — never a real inbox.
    await otp.click();
    await page.keyboard.type("424242", { delay: 40 });
    await page.waitForURL((url) => !url.pathname.startsWith("/login"), { timeout: 25_000 });
    return;
  }
  if (outcome === "stuck") {
    throw new Error(`Sign-in for ${coordinator.email} neither completed nor errored in 25s.`);
  }
}

/** Opens the Board on the seeded week and waits for the live calendar. */
export async function openSeededWeek(page: Page): Promise<void> {
  await page.goto(SEEDED_WEEK_URL);
  // Lane headers come from GET /calendar — their presence proves the live
  // read model, not a fixture.
  await expect(page.getByText("Grand Hall").first()).toBeVisible({ timeout: 20_000 });
  // A fresh browser context is always a first visit, so the first-run
  // welcome (T-519) greets the coordinator — dismiss it exactly as a real
  // first-time user would before working the board.
  const welcomeDismiss = page.getByRole("button", { name: "Take me to the diary" });
  if (await welcomeDismiss.isVisible().catch(() => false)) {
    await welcomeDismiss.click();
    await expect(welcomeDismiss).toBeHidden();
  }
}

/** Drawer time fields — labels from board-copy.ts; datetime-local format.
 *  Field lookups are scoped to the drawer: board blocks carry room names in
 *  their aria-labels, so page-wide getByLabel("Room" etc.) is ambiguous. */
export async function fillDrawerTimes(
  drawer: Locator,
  startsAt: string,
  endsAt: string,
): Promise<void> {
  await drawer.getByLabel("Starts", { exact: true }).fill(startsAt);
  await drawer.getByLabel("Ends", { exact: true }).fill(endsAt);
}
