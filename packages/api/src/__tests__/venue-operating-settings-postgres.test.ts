import { randomUUID } from "node:crypto";
import { resolve } from "node:path";
import { Pool } from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { OPERATING_SETTINGS_DEFAULTS } from "@omnitwin/types";
import * as schema from "../db/schema.js";
import { readOperatingSettings, writeOperatingSettings } from "../services/venue-operating-settings.js";

// ---------------------------------------------------------------------------
// Migration 0092 and the operating-settings service on isolated PostgreSQL
// (goal 19 S7). Opt-in; never consults DATABASE_URL or .env.
// ---------------------------------------------------------------------------

const testUrl = process.env["VENVIEWER_OPERATING_SETTINGS_TEST_DATABASE_URL"];
if (testUrl !== undefined) {
  const parsed = new URL(testUrl);
  if (!["postgres:", "postgresql:"].includes(parsed.protocol)
    || parsed.hostname !== "127.0.0.1"
    || parsed.pathname !== "/venviewer_operating_settings_test"
    || parsed.search !== "" || parsed.hash !== "") {
    throw new Error("Operating settings tests require their explicit isolated loopback database");
  }
}

const VENUE = "78787878-7878-4787-8787-787878787801";
const OTHER_VENUE = "78787878-7878-4787-8787-787878787802";
const ADMIN = "78787878-7878-4787-8787-787878787811";
const HALLKEEPER = "78787878-7878-4787-8787-787878787812";
const OTHER_ADMIN = "78787878-7878-4787-8787-787878787813";

describe.skipIf(testUrl === undefined)("operating settings (0092)", () => {
  let pool: Pool;
  let db: ReturnType<typeof drizzle<typeof schema>>;

  beforeAll(async () => {
    pool = new Pool({ connectionString: testUrl, application_name: `operating_settings_${randomUUID().slice(0, 8)}`, max: 4 });
    await migrate(drizzle(pool), { migrationsFolder: resolve(import.meta.dirname, "../../drizzle") });
    db = drizzle(pool, { schema });
    for (const [id, slug] of [[VENUE, "s7-settings"], [OTHER_VENUE, "s7-settings-other"]] as const) {
      await pool.query(
        "INSERT INTO venues (id, name, slug, address) VALUES ($1, $2, $3, 'nowhere') ON CONFLICT (id) DO NOTHING",
        [id, `Venue ${slug}`, slug],
      );
    }
    for (const [id, venueId, role] of [[ADMIN, VENUE, "admin"], [HALLKEEPER, VENUE, "hallkeeper"], [OTHER_ADMIN, OTHER_VENUE, "admin"]] as const) {
      await pool.query(
        "INSERT INTO users (id, clerk_id, email, name, role, venue_id) VALUES ($1, $2, $3, $4, $5, $6) ON CONFLICT (id) DO NOTHING",
        [id, `clerk_${id}`, `${id}@s7.test`, `Person ${role}`, role, venueId],
      );
    }
  }, 300_000);

  beforeEach(async () => {
    await pool.query("DELETE FROM venue_settings WHERE venue_id IN ($1, $2)", [VENUE, OTHER_VENUE]);
  });

  afterAll(async () => {
    await pool.query("DELETE FROM venue_settings WHERE venue_id IN ($1, $2)", [VENUE, OTHER_VENUE]);
    await pool.query("DELETE FROM users WHERE id IN ($1, $2, $3)", [ADMIN, HALLKEEPER, OTHER_ADMIN]);
    await pool.query("DELETE FROM venues WHERE id IN ($1, $2)", [VENUE, OTHER_VENUE]);
    await pool.end();
  });

  it("reads null for a venue with no row, and the defaults with the change on top after the first write", async () => {
    expect(await readOperatingSettings(db, VENUE)).toBeNull();
    const written = await writeOperatingSettings(db, VENUE, { escalationSoonSeconds: 240 });
    expect(written).toEqual({ ok: true, settings: { ...OPERATING_SETTINGS_DEFAULTS, escalationSoonSeconds: 240 } });
    expect(await readOperatingSettings(db, VENUE)).toEqual({ ...OPERATING_SETTINGS_DEFAULTS, escalationSoonSeconds: 240 });
  });

  it("a row written the slice 10 way reads with the decided defaults, and the old column mirrors the now window on write", async () => {
    await pool.query("INSERT INTO venue_settings (venue_id, request_escalation_seconds) VALUES ($1, 180)", [VENUE]);
    expect(await readOperatingSettings(db, VENUE)).toEqual(OPERATING_SETTINGS_DEFAULTS);

    await writeOperatingSettings(db, VENUE, { escalationNowSeconds: 90, quietHoursStart: "21:30" });
    const { rows } = await pool.query<{ request_escalation_seconds: number; quiet_hours_start: string }>(
      "SELECT request_escalation_seconds, quiet_hours_start FROM venue_settings WHERE venue_id = $1", [VENUE],
    );
    expect(rows[0]).toEqual({ request_escalation_seconds: 90, quiet_hours_start: "21:30:00" });
    expect((await readOperatingSettings(db, VENUE))?.quietHoursStart).toBe("21:30");
  });

  it("names a duty admin only from this venue's administrators or managers", async () => {
    expect(await writeOperatingSettings(db, VENUE, { dutyAdminUserId: OTHER_ADMIN })).toEqual({ ok: false, code: "DUTY_ADMIN_NOT_IN_VENUE" });
    expect(await writeOperatingSettings(db, VENUE, { dutyAdminUserId: HALLKEEPER })).toEqual({ ok: false, code: "DUTY_ADMIN_NOT_IN_VENUE" });
    const ok = await writeOperatingSettings(db, VENUE, { dutyAdminUserId: ADMIN });
    expect(ok.ok && ok.settings.dutyAdminUserId).toBe(ADMIN);
    const cleared = await writeOperatingSettings(db, VENUE, { dutyAdminUserId: null });
    expect(cleared.ok && cleared.settings.dutyAdminUserId).toBeNull();
  });

  it("the database refuses a window outside 30 s to a day, as the schema does", async () => {
    await expect(pool.query(
      "INSERT INTO venue_settings (venue_id, request_escalation_seconds, escalation_routine_seconds) VALUES ($1, 120, 29)", [VENUE],
    )).rejects.toThrow(/venue_settings_operating_windows/u);
  });

  it("the push tables exist with their guards", async () => {
    await expect(pool.query(
      "INSERT INTO push_subscriptions (user_id, venue_id, endpoint, p256dh, auth, device_kind) VALUES ($1, $2, 'https://push.example/x', 'k', 'a', 'tablet')",
      [ADMIN, VENUE],
    )).rejects.toThrow(/push_subscriptions_device_kind/u);
    const { rows } = await pool.query<{ id: string }>(
      "INSERT INTO push_subscriptions (user_id, venue_id, endpoint, p256dh, auth, device_kind) VALUES ($1, $2, 'https://push.example/x', 'k', 'a', 'phone') RETURNING id",
      [ADMIN, VENUE],
    );
    await pool.query("INSERT INTO push_sends (subscription_id, event, idempotency_key, status) VALUES ($1, 'request.landed', 'k1', 'sent')", [rows[0]?.id]);
    await expect(pool.query(
      "INSERT INTO push_sends (subscription_id, event, idempotency_key, status) VALUES ($1, 'request.landed', 'k1', 'sent')", [rows[0]?.id],
    )).rejects.toThrow(/push_sends_idempotency_key/u);
    await pool.query("DELETE FROM push_subscriptions WHERE user_id = $1", [ADMIN]);
  });
});
