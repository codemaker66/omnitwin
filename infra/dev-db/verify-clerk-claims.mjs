// ---------------------------------------------------------------------------
// Verify a Clerk instance's session-token claims (Slice 5, T-520).
//
// The API's fail-closed email gate wants the session token itself to carry
// the user's email plus an explicit verified flag (middleware/auth-email.ts).
// Production's Clerk instance customises its session token to do that; a
// default token carries neither, and every request then leans on the
// Backend-API fallback (middleware/clerk-email.ts).
//
// This tool signs in as the e2e coordinator through a locally running web
// app, captures the exact bearer token the app sends the API, decodes it,
// and grades the claims:
//   PASS — claims satisfy the gate; the fallback is dormant. Done.
//   FAIL — default token; configure the Clerk dashboard and re-run.
//
// To configure: Clerk Dashboard → (dev instance) → Sessions → Customize
// session token → Claims. Copy the Claims JSON from the PRODUCTION
// instance's same page (it is the known-working template). At minimum the
// gate needs an "email" claim ({{user.primary_email_address}} — documented
// Clerk shortcode) plus ONE of the verified-flag claims listed below set to
// true/"true"/"verified".
//
// Usage (web app + API from the local dev stack must be running):
//   node infra/dev-db/verify-clerk-claims.mjs
//   VERIFY_BASE_URL=http://localhost:5174 node infra/dev-db/verify-clerk-claims.mjs
// ---------------------------------------------------------------------------

import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const webDir = fileURLToPath(new URL("../../packages/web/", import.meta.url));
const { chromium } = createRequire(webDir)("@playwright/test");

const BASE_URL = process.env.VERIFY_BASE_URL ?? "http://localhost:5174";
// Must match e2e/support/diary-live.ts + provision-clerk-test-users.mjs.
const EMAIL = "fiona.coordinator+clerk_test@tradeshall.co.uk";
const PASSWORD = "TradesHall-diary-e2e-2026!";
const CLERK_TEST_CODE = "424242";

// Must match middleware/auth-email.ts — the names the gate accepts as an
// explicit verified signal (value true / "true" / "verified").
const VERIFIED_CLAIM_NAMES = [
  "email_verified",
  "emailVerified",
  "email_verification_status",
  "emailVerificationStatus",
  "primary_email_verified",
  "primaryEmailVerified",
  "primary_email_verification_status",
  "primaryEmailVerificationStatus",
];

function isExplicitlyVerified(value) {
  return value === true || value === "true" || value === "verified";
}

const browser = await chromium.launch();
const page = await browser.newPage({ timezoneId: "Europe/London" });

console.log("=== Clerk session-token claims check (T-520) ===");
console.log(`web app: ${BASE_URL}   coordinator: ${EMAIL}\n`);

// --- Sign in (password; email-code second factor on a fresh browser) -------
await page.goto(`${BASE_URL}/login`, { waitUntil: "domcontentloaded" });
try {
  await page.waitForSelector("input[name=identifier]", { timeout: 30_000 });
} catch {
  console.error("The Clerk sign-in form never appeared. Is the web app running with the pk_test key?");
  console.error("(Start it per docs/reports/slice-4-report.md — and scrub pk_live env vars.)");
  await browser.close();
  process.exit(1);
}
await page.fill("input[name=identifier]", EMAIL);
await page.fill("input[name=password]", PASSWORD);
await page.getByRole("button", { name: /^continue$/i }).click();

const otp = page
  .locator("input[name=code], input[autocomplete=one-time-code], [data-otp-input]")
  .first();
try {
  await otp.waitFor({ state: "visible", timeout: 10_000 });
  await otp.click();
  await page.keyboard.type(CLERK_TEST_CODE, { delay: 40 });
} catch {
  // No second factor this time — fine.
}
try {
  await page.waitForURL((url) => !url.pathname.startsWith("/login"), { timeout: 25_000 });
} catch {
  console.error("Sign-in did not complete. Do the fixtures exist? Run:");
  console.error("  node infra/dev-db/provision-clerk-test-users.mjs");
  await browser.close();
  process.exit(1);
}

// --- Capture the bearer token the app actually sends the API ---------------
const tokenPromise = new Promise((resolveToken) => {
  page.on("request", (request) => {
    if (request.url().includes("/auth/me")) {
      const header = request.headers()["authorization"];
      if (header?.startsWith("Bearer ")) resolveToken(header.slice(7));
    }
  });
  setTimeout(() => { resolveToken(null); }, 30_000);
});
await page.goto(`${BASE_URL}/diary`);
const token = await tokenPromise;
await browser.close();

if (token === null) {
  console.error("Never saw an authenticated /auth/me request — cannot inspect the token.");
  process.exit(1);
}

const payload = JSON.parse(
  Buffer.from(token.split(".")[1].replace(/-/gu, "+").replace(/_/gu, "/"), "base64").toString(),
);

console.log(`claims present: ${Object.keys(payload).sort().join(", ")}\n`);

const email = typeof payload.email === "string" ? payload.email.trim() : "";
const verifiedName = VERIFIED_CLAIM_NAMES.find((name) => isExplicitlyVerified(payload[name]));

if (email !== "" && verifiedName !== undefined) {
  console.log(`PASS — email claim present (${email})`);
  console.log(`PASS — verified flag present (${verifiedName} = ${JSON.stringify(payload[verifiedName])})`);
  console.log("\nThe token satisfies the API's email gate directly.");
  console.log("The Backend-API fallback (middleware/clerk-email.ts) is dormant. Nothing to do.");
  process.exit(0);
}

console.log(email === "" ? "FAIL — no usable `email` claim in the session token." : `ok    — email claim present (${email})`);
if (verifiedName === undefined) {
  console.log("FAIL — none of the accepted verified-flag claims is present/verified:");
  console.log(`        ${VERIFIED_CLAIM_NAMES.join(", ")}`);
}
console.log("\nThis instance issues default session tokens; every API request currently");
console.log("uses the Backend-API fallback (works, but adds a Clerk lookup per cold cache).");
console.log("\nTO FIX: Clerk Dashboard → this instance → Sessions → Customize session token");
console.log("→ Claims. Copy the Claims JSON from the PRODUCTION instance's same page (the");
console.log('known-working template). Minimum shape: an "email" claim of');
console.log('{{user.primary_email_address}} plus one accepted verified-flag claim.');
console.log("Then re-run this script — it should print PASS.");
process.exit(2);
