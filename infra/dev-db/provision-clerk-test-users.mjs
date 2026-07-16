// ---------------------------------------------------------------------------
// Provision the Diary e2e coordinators as Clerk TEST users (Slice 4, T-518).
//
// The live diary spec signs in through the real Clerk dev instance. Sign-UP
// through the UI is not automatable there (the bot-protection step wedges the
// form — by design, and automating around a CAPTCHA is off the table), so the
// fixtures are provisioned the sanctioned way: through Clerk's Backend API
// with the instance's own secret key. `+clerk_test` addresses are Clerk test
// identities — no real mail ever. Idempotent: existing users are left alone.
//
//   node infra/dev-db/provision-clerk-test-users.mjs
//
// Reads CLERK_SECRET_KEY from packages/api/.env (never printed). The fixture
// password is a committed constant in e2e/support/diary-live.ts — it guards
// nothing but a test-instance identity.
// ---------------------------------------------------------------------------

import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

const API = "https://api.clerk.com/v1";

const COORDINATORS = [
  { email: "fiona.coordinator+clerk_test@tradeshall.co.uk", username: "fiona-coordinator", first: "Fiona", last: "Coordinator" },
  { email: "graham.coordinator+clerk_test@tradeshall.co.uk", username: "graham-coordinator", first: "Graham", last: "Coordinator" },
];
const E2E_PASSWORD = "TradesHall-diary-e2e-2026!"; // must match e2e/support/diary-live.ts

const envPath = fileURLToPath(new URL("../../packages/api/.env", import.meta.url));
const envText = await readFile(envPath, "utf-8");
const secretKey = envText
  .split(/\r?\n/u)
  .map((line) => line.match(/^CLERK_SECRET_KEY=(.+)$/u))
  .find((match) => match !== null)?.[1]
  ?.trim();

if (secretKey === undefined || secretKey === "") {
  console.error("CLERK_SECRET_KEY not found in packages/api/.env");
  process.exit(1);
}
if (!secretKey.startsWith("sk_test_")) {
  console.error("Refusing to provision e2e fixtures against a non-test Clerk instance.");
  process.exit(1);
}

const headers = { Authorization: `Bearer ${secretKey}`, "Content-Type": "application/json" };

for (const coordinator of COORDINATORS) {
  const query = new URLSearchParams({ email_address: coordinator.email });
  const existing = await fetch(`${API}/users?${query.toString()}`, { headers });
  if (!existing.ok) {
    console.error(`lookup failed (${String(existing.status)}) for ${coordinator.email}`);
    process.exit(1);
  }
  const found = await existing.json();
  if (Array.isArray(found) && found.length > 0) {
    console.log(`exists:  ${coordinator.email}`);
    // Idempotence includes the verified flag — an unverified fixture forces
    // an email-code detour into every sign-in.
    const address = found[0]?.email_addresses?.find((entry) => entry.email_address === coordinator.email);
    if (address !== undefined && address.verification?.status !== "verified") {
      const verified = await fetch(`${API}/email_addresses/${address.id}`, {
        method: "PATCH",
        headers,
        body: JSON.stringify({ verified: true }),
      });
      console.log(verified.ok ? `verified: ${coordinator.email}` : `verify failed (${String(verified.status)})`);
    }
    continue;
  }

  const created = await fetch(`${API}/users`, {
    method: "POST",
    headers,
    body: JSON.stringify({
      email_address: [coordinator.email],
      username: coordinator.username,
      first_name: coordinator.first,
      last_name: coordinator.last,
      password: E2E_PASSWORD,
      skip_password_checks: true,
    }),
  });
  if (!created.ok) {
    console.error(`create failed (${String(created.status)}) for ${coordinator.email}:`);
    console.error((await created.text()).slice(0, 400));
    process.exit(1);
  }
  const user = await created.json();
  console.log(`created: ${coordinator.email}`);

  // Backend-created addresses start unverified, which makes every sign-in
  // detour through an email-code step — mark the fixture verified instead.
  const emailId = user?.email_addresses?.[0]?.id;
  if (typeof emailId === "string") {
    const verified = await fetch(`${API}/email_addresses/${emailId}`, {
      method: "PATCH",
      headers,
      body: JSON.stringify({ verified: true }),
    });
    console.log(verified.ok ? `verified: ${coordinator.email}` : `verify failed (${String(verified.status)})`);
  }
}

console.log("Clerk e2e coordinators ready.");
