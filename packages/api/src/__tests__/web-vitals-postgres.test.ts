import Fastify, { type FastifyInstance, type LightMyRequestResponse } from "fastify";
import rateLimit from "@fastify/rate-limit";
import { randomInt } from "node:crypto";
import { resolve } from "node:path";
import { Pool } from "pg";
import { sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { WEB_VITAL_RETENTION_DAYS } from "@omnitwin/types";
import * as schema from "../db/schema.js";
import type { Database } from "../db/client.js";
import { validateEnv } from "../env.js";
import {
  createAddressKey, createDailyCeiling, createWebVitalsBatch, removeExpiredWebVitalSamples, shuffleInPlace, webVitalsP75, webVitalsWindowStart,
  type AddressKey, type WebVitalsBatch,
} from "../services/web-vitals.js";
import { publicWebVitalsRoutes } from "../routes/public-web-vitals.js";
import { formatP75Line } from "../scripts/web-vitals-report.js";

// ---------------------------------------------------------------------------
// Field web vitals (goal 07) through the whole API, on a migrated database:
// off unless WEB_VITALS_COLLECTION=on, and then a report is a route pattern,
// a device class and four numbers, kept as four rows and nothing else; an
// address, a token or any other field is refused and nothing is kept; the
// database refuses a page that is not a pattern; the limiter bounds an
// address and a daily ceiling everyone; no access line carries the address;
// samples go after 90 days; p75 is read by device and by page.
//
// Opt-in, disposable loopback PostgreSQL only; never reads DATABASE_URL/.env:
//   VENVIEWER_WEB_VITALS_TEST_DATABASE_URL=postgresql://postgres@127.0.0.1:<port>/venviewer_web_vitals_test
// ---------------------------------------------------------------------------

process.env["NODE_ENV"] = "test";
const testUrl = process.env["VENVIEWER_WEB_VITALS_TEST_DATABASE_URL"];

function assertTestTarget(raw: string): void {
  const url = new URL(raw);
  if (!["postgres:", "postgresql:"].includes(url.protocol) || url.hostname !== "127.0.0.1"
    || url.pathname !== "/venviewer_web_vitals_test" || url.search !== "" || url.hash !== "") {
    throw new Error("Web vitals tests require the explicit loopback venviewer_web_vitals_test database");
  }
}

describe("web vitals PostgreSQL target guard", () => {
  it.each([
    "postgresql://user@production.example/venviewer_web_vitals_test",
    "postgresql://postgres@127.0.0.1/production",
    "postgresql://postgres@127.0.0.1/venviewer_web_vitals_test?host=production.example",
  ])("rejects an unsafe target: %s", (url) => {
    expect(() => { assertTestTarget(url); }).toThrow();
  });
});

const REPORT = {
  v: 1,
  page: "/proposal-share/:token",
  device: "phone",
  metrics: [
    { name: "LCP", value: 5234.5, rating: "poor" },
    { name: "INP", value: 184, rating: "good" },
    { name: "CLS", value: 0.04, rating: "good" },
    { name: "TTFB", value: 412.25, rating: "good" },
  ],
} as const;

describe("the batch's shuffle", () => {
  it("draws once for every place from the last down, and keeps every row", () => {
    const draws: number[] = [];
    const rows = [1, 2, 3, 4, 5];
    shuffleInPlace(rows, (bound) => { draws.push(bound); return bound - 1; });
    expect(draws).toEqual([5, 4, 3, 2]);
    expect([...rows].sort((a, b) => a - b)).toEqual([1, 2, 3, 4, 5]);
  });

  it("makes every order about equally likely with the default draw from crypto", () => {
    const counts = new Map<string, number>();
    for (let run = 0; run < 6_000; run += 1) {
      const rows = ["a", "b", "c"];
      shuffleInPlace(rows, (bound) => randomInt(bound));
      const order = rows.join("");
      counts.set(order, (counts.get(order) ?? 0) + 1);
    }
    // Six orders, a thousand each on average; 800 to 1,200 is about seven
    // standard deviations either side, so a fair shuffle never misses it.
    expect(counts.size).toBe(6);
    for (const [order, count] of counts) expect(count, order).toBeGreaterThan(800);
    for (const [order, count] of counts) expect(count, order).toBeLessThan(1_200);
  });
});

describe("the per-address limiter's key", () => {
  it("is one key per address under one secret, and never holds the address itself", () => {
    const key = createAddressKey(() => Buffer.alloc(32, 7));
    expect(key.keyFor("203.0.113.7")).toBe(key.keyFor("203.0.113.7"));
    expect(key.keyFor("203.0.113.7")).not.toBe(key.keyFor("203.0.113.8"));
    for (const address of ["203.0.113.7", "2001:db8::7"]) {
      expect(key.keyFor(address)).not.toContain(address);
      expect(key.keyFor(address)).toMatch(/^web-vitals:[A-Za-z0-9_-]{43}$/u);
    }
  });

  it("cannot be traced back once its secret is replaced", () => {
    let secret = 0;
    const key = createAddressKey(() => Buffer.alloc(32, (secret += 1)));
    const before = key.keyFor("203.0.113.7");
    key.rotate();
    expect(key.keyFor("203.0.113.7")).not.toBe(before);
  });
});

interface SampleRow {
  readonly page: string;
  readonly device: string;
  readonly metric: string;
  readonly value: number;
  readonly rating: string;
}

describe.skipIf(testUrl === undefined)("field web vitals on the whole API (migrated PostgreSQL)", () => {
  const savedSwitch = process.env["WEB_VITALS_COLLECTION"];
  let pool: Pool;
  let db: Database;
  let server: FastifyInstance;
  /** The whole API's batch, written on demand: one report is enough here. */
  let batch: WebVitalsBatch;
  let address = 0;

  /** As navigator.sendBeacon sends a string: text/plain, from its own address. */
  function beacon(body: string, from?: string): Promise<LightMyRequestResponse> {
    address += 1;
    return server.inject({
      method: "POST", url: "/public/web-vitals",
      headers: { "content-type": "text/plain;charset=UTF-8", origin: "https://venviewer.com" },
      payload: body,
      remoteAddress: from ?? `10.9.${String((address >> 8) & 255)}.${String(address & 255)}`,
    });
  }

  /** What is stored, once the batch has written what it holds. */
  async function rows(): Promise<SampleRow[]> {
    await batch.flush();
    const { rows: found } = await pool.query<SampleRow>(
      "SELECT page, device, metric, value, rating FROM web_vital_samples ORDER BY metric",
    );
    return found;
  }

  beforeAll(async () => {
    if (testUrl === undefined) throw new Error("Explicit test URL required");
    assertTestTarget(testUrl);
    pool = new Pool({ connectionString: testUrl, application_name: "web_vitals_test", max: 4 });
    const target = await pool.query<{ database: string }>("SELECT current_database() AS database");
    expect(target.rows[0]?.database).toBe("venviewer_web_vitals_test");
    await migrate(drizzle(pool), { migrationsFolder: resolve(import.meta.dirname, "../../drizzle") });
    db = drizzle(pool, { schema });
    batch = createWebVitalsBatch(db, { minReports: 1 });
    const { buildServer } = await import("../index.js");
    server = await buildServer(validateEnv({
      NODE_ENV: "test",
      DATABASE_URL: testUrl,
      JWT_SECRET: "test-jwt-secret-that-is-at-least-32-characters-long",
    }), { webVitals: { batch } });
    await server.ready();
  }, 300_000);

  afterEach(async () => {
    if (savedSwitch === undefined) delete process.env["WEB_VITALS_COLLECTION"];
    else process.env["WEB_VITALS_COLLECTION"] = savedSwitch;
    // Nothing a test held may reach the next one.
    await batch.flush({ closing: true });
    await pool.query("DELETE FROM web_vital_samples");
  });

  afterAll(async () => {
    await server?.close();
    await pool?.end();
  }, 60_000);

  it("keeps nothing while collection is off, whatever a page sends", async () => {
    delete process.env["WEB_VITALS_COLLECTION"];
    const res = await beacon(JSON.stringify(REPORT));
    expect(res.statusCode).toBe(404);
    process.env["WEB_VITALS_COLLECTION"] = "yes";
    expect((await beacon(JSON.stringify(REPORT))).statusCode).toBe(404);
    expect(await rows()).toEqual([]);
  });

  it("keeps a beacon's four vitals as four rows of a pattern, a device class and the numbers", async () => {
    process.env["WEB_VITALS_COLLECTION"] = "on";
    const res = await beacon(JSON.stringify(REPORT));
    expect(res.statusCode).toBe(204);
    expect(res.headers["cache-control"]).toBe("no-store");
    expect(await rows()).toEqual([
      { page: "/proposal-share/:token", device: "phone", metric: "CLS", value: 0.04, rating: "good" },
      { page: "/proposal-share/:token", device: "phone", metric: "INP", value: 184, rating: "good" },
      { page: "/proposal-share/:token", device: "phone", metric: "LCP", value: 5234.5, rating: "poor" },
      { page: "/proposal-share/:token", device: "phone", metric: "TTFB", value: 412.25, rating: "good" },
    ]);
    // The row holds nothing else: no address, no agent, no time but its own,
    // and nothing the privacy page does not name.
    const { rows: columns } = await pool.query<{ column_name: string }>(
      "SELECT column_name FROM information_schema.columns WHERE table_name = 'web_vital_samples' ORDER BY column_name",
    );
    expect(columns.map((column) => column.column_name))
      .toEqual(["device", "id", "metric", "page", "rating", "recorded_at", "value"]);
  });

  it("keeps the day a report arrived, not the moment, so no row matches a request log by time", async () => {
    process.env["WEB_VITALS_COLLECTION"] = "on";
    const arrived = Math.floor(Date.now() / 86_400_000) * 86_400_000;
    expect((await beacon(JSON.stringify(REPORT))).statusCode).toBe(204);
    expect(await batch.flush()).toBe(1);
    // The writer's own day: the UTC midnight the report arrived on (or the
    // next one, if the run crosses midnight between the two clocks).
    const { rows: stamped } = await pool.query<{ ms: string }>(
      "SELECT (extract(epoch FROM recorded_at) * 1000)::bigint::text AS ms FROM web_vital_samples",
    );
    expect(stamped).toHaveLength(4);
    for (const { ms } of stamped) expect([arrived, arrived + 86_400_000]).toContain(Number(ms));
  });

  it("gives the column itself the UTC day, whatever the session's time zone (rows written by hand)", async () => {
    const client = await pool.connect();
    try {
      // UTC+14: this zone's midnight is never UTC's, so a day truncated in the
      // session's zone would not be a UTC day.
      await client.query("SET TIME ZONE 'Pacific/Kiritimati'");
      await client.query("INSERT INTO web_vital_samples (page, device, metric, value, rating) VALUES ('/', 'phone', 'LCP', 1, 'good')");
      const { rows: [kept] } = await client.query<{ utc_midnight: boolean }>(
        "SELECT recorded_at = date_trunc('day', recorded_at, 'UTC') AS utc_midnight FROM web_vital_samples",
      );
      expect(kept).toEqual({ utc_midnight: true });
    } finally {
      await client.query("RESET TIME ZONE");
      client.release();
    }
  });

  it("keeps nothing from a browser that sends Global Privacy Control or Do Not Track", async () => {
    process.env["WEB_VITALS_COLLECTION"] = "on";
    for (const objection of [{ "sec-gpc": "1" }, { dnt: "1" }]) {
      const res = await server.inject({
        method: "POST", url: "/public/web-vitals",
        headers: { "content-type": "text/plain;charset=UTF-8", origin: "https://venviewer.com", ...objection },
        payload: JSON.stringify(REPORT), remoteAddress: "10.6.6.6",
      });
      expect(res.statusCode, JSON.stringify(objection)).toBe(204);
    }
    expect(await rows()).toEqual([]);
  });

  it("reads a JSON body as well as a beacon's text", async () => {
    process.env["WEB_VITALS_COLLECTION"] = "on";
    const res = await server.inject({
      method: "POST", url: "/public/web-vitals", headers: { "content-type": "application/json" },
      payload: { ...REPORT, metrics: [REPORT.metrics[0]] }, remoteAddress: "10.8.0.1",
    });
    expect(res.statusCode).toBe(204);
    expect((await rows()).map((row) => row.metric)).toEqual(["LCP"]);
  });

  it("refuses an address, a token, another field or a broken body, and keeps nothing", async () => {
    process.env["WEB_VITALS_COLLECTION"] = "on";
    const refused = [
      JSON.stringify({ ...REPORT, page: "/proposal-share/tok_SECRET123" }),
      JSON.stringify({ ...REPORT, page: "/plan/2b9f1c3e-5d8a-4c1b-9e7f-0a1b2c3d4e5f" }),
      JSON.stringify({ ...REPORT, page: "https://venviewer.com/diary" }),
      JSON.stringify({ ...REPORT, url: "https://venviewer.com/proposal-share/tok_SECRET123" }),
      JSON.stringify({ ...REPORT, userAgent: "Mozilla/5.0" }),
      JSON.stringify({ ...REPORT, metrics: [{ ...REPORT.metrics[0], id: "v5-1690000000000-123" }] }),
      // How the page was reached: the privacy page names no such field.
      JSON.stringify({ ...REPORT, metrics: [{ ...REPORT.metrics[0], navigationType: "reload" }] }),
      JSON.stringify({ ...REPORT, device: "watch" }),
      "{not json",
      "",
    ];
    for (const body of refused) expect((await beacon(body)).statusCode, body).toBe(400);
    // Far beyond a report: refused before it is read.
    expect((await beacon(JSON.stringify({ ...REPORT, padding: "x".repeat(5_000) }))).statusCode).toBe(413);
    expect(await rows()).toEqual([]);
  });

  it("has the database refuse a page that is not a route pattern", async () => {
    const insert = (page: string): Promise<unknown> => pool.query(
      "INSERT INTO web_vital_samples (page, device, metric, value, rating) VALUES ($1, 'phone', 'LCP', 1, 'good')",
      [page],
    );
    for (const page of ["/proposal-share/tok_SECRET123", "/plan/2b9f1c3e-5d8a", "diary", "/Diary"]) {
      await expect(insert(page), page).rejects.toMatchObject({ code: "23514" });
    }
    await expect(insert("/v/:venueSlug/plan")).resolves.toBeDefined();
  });

  it("bounds what one address may send", async () => {
    process.env["WEB_VITALS_COLLECTION"] = "on";
    const statuses: number[] = [];
    for (let index = 0; index < 62; index += 1) {
      statuses.push((await beacon(JSON.stringify({ ...REPORT, metrics: [REPORT.metrics[1]] }), "10.7.7.7")).statusCode);
    }
    expect(statuses.slice(0, 60).every((status) => status === 204)).toBe(true);
    expect(statuses.slice(60)).toEqual([429, 429]);
  });

  it("keeps no more than the day's ceiling from everyone together, and starts again the next day", async () => {
    process.env["WEB_VITALS_COLLECTION"] = "on";
    const capped = Fastify();
    const cappedBatch = createWebVitalsBatch(db, { minReports: 1, ceiling: createDailyCeiling(2) });
    await capped.register(publicWebVitalsRoutes, { prefix: "/public", db, batch: cappedBatch });
    const post = (from: string): Promise<LightMyRequestResponse> => capped.inject({
      method: "POST", url: "/public/web-vitals", headers: { "content-type": "text/plain;charset=UTF-8" },
      payload: JSON.stringify({ ...REPORT, metrics: [REPORT.metrics[0]] }), remoteAddress: from,
    });
    try {
      // A body that is not a report is refused before it counts against the day.
      expect((await capped.inject({
        method: "POST", url: "/public/web-vitals", headers: { "content-type": "text/plain;charset=UTF-8" },
        payload: "{not json", remoteAddress: "10.5.0.9",
      })).statusCode).toBe(400);
      // Three addresses, each well inside its own limit.
      const statuses = [(await post("10.5.0.1")).statusCode, (await post("10.5.0.2")).statusCode];
      const third = await post("10.5.0.3");
      expect([...statuses, third.statusCode]).toEqual([204, 204, 429]);
      expect(third.json()).toMatchObject({ code: "WEB_VITALS_DAILY_CEILING" });
      expect(await cappedBatch.flush()).toBe(2);
      expect(await rows()).toHaveLength(2);
    } finally {
      await capped.close();
    }
    let clock = Date.UTC(2026, 9, 28, 23, 59);
    const ceiling = createDailyCeiling(1, () => clock);
    expect([ceiling.admit() !== null, ceiling.admit()]).toEqual([true, null]);
    clock = Date.UTC(2026, 9, 29, 0, 1);
    expect(ceiling.admit()).not.toBeNull();
  });

  it("writes no access line, which would carry the visitor's address", async () => {
    process.env["WEB_VITALS_COLLECTION"] = "on";
    const lines: string[] = [];
    const logged = Fastify({ logger: { level: "info", stream: { write: (line: string) => { lines.push(line); } } } });
    await logged.register(publicWebVitalsRoutes, { prefix: "/public", db });
    logged.get("/control", () => ({ ok: true }));
    try {
      expect((await logged.inject({
        method: "POST", url: "/public/web-vitals", headers: { "content-type": "text/plain;charset=UTF-8" },
        payload: JSON.stringify(REPORT), remoteAddress: "10.4.4.4",
      })).statusCode).toBe(204);
      expect(lines.filter((line) => line.includes("10.4.4.4"))).toEqual([]);
      // The same server logs an ordinary route's address, so the capture works.
      await logged.inject({ method: "GET", url: "/control", remoteAddress: "10.3.3.3" });
      expect(lines.some((line) => line.includes("10.3.3.3"))).toBe(true);
    } finally {
      await logged.close();
    }
  });

  it("logs no line holding the visitor's address on any answer (404, 204, 400, 415, 413, the limiter's 429) or a failed batch, through the whole server's production logger", async () => {
    const lines: string[] = [];
    const { buildServer } = await import("../index.js");
    // The route's own batch (ten of a device class) and its own timer, quickened.
    const whole: FastifyInstance = await buildServer(validateEnv({
      NODE_ENV: "test",
      DATABASE_URL: testUrl,
      JWT_SECRET: "test-jwt-secret-that-is-at-least-32-characters-long",
    }), { logStream: { write: (line) => { lines.push(line); } }, webVitals: { flushEveryMs: 50 } });
    await whole.ready();
    const visitor = "198.51.100.77";
    const post = (payload: string, headers: Record<string, string> = {}): Promise<LightMyRequestResponse> => whole.inject({
      method: "POST", url: "/public/web-vitals",
      headers: { "content-type": "text/plain;charset=UTF-8", origin: "https://venviewer.com", ...headers },
      payload, remoteAddress: visitor,
    });
    const report = JSON.stringify({ ...REPORT, metrics: [REPORT.metrics[1]] });
    try {
      delete process.env["WEB_VITALS_COLLECTION"];
      expect((await post(report)).statusCode).toBe(404);
      process.env["WEB_VITALS_COLLECTION"] = "on";
      expect((await post(report, { "sec-gpc": "1" })).statusCode).toBe(204);
      expect((await post("{not json")).statusCode).toBe(400);
      expect((await post("<report/>", { "content-type": "application/xml" })).statusCode).toBe(415);
      expect((await post(" ".repeat(5_000))).statusCode).toBe(413);
      // A database that fails when the batch is written: the error is logged,
      // with nothing of the visitor (the batch never held anything of them).
      await pool.query("ALTER TABLE web_vital_samples RENAME TO web_vital_samples_away");
      try {
        for (let held = 0; held < 10; held += 1) expect((await post(report)).statusCode).toBe(204);
        await vi.waitFor(() => { expect(lines.some((line) => line.includes("\"level\":50"))).toBe(true); }, { timeout: 5_000 });
      } finally {
        await pool.query("ALTER TABLE web_vital_samples_away RENAME TO web_vital_samples");
      }
      let status = 0;
      for (let sent = 0; sent < 61 && status !== 429; sent += 1) status = (await post(report)).statusCode;
      expect(status).toBe(429);

      expect(lines.filter((line) => line.includes(visitor))).toEqual([]);
      // The same logger writes an ordinary route's address, so the capture works.
      await whole.inject({ method: "GET", url: "/health/live", remoteAddress: visitor });
      expect(lines.some((line) => line.includes(visitor))).toBe(true);
    } finally {
      await whole.close();
    }
  }, 120_000);

  it("keys the per-address limit by the route's own key, never by the address", async () => {
    process.env["WEB_VITALS_COLLECTION"] = "on";
    const asked: string[] = [];
    // One key for every address: only the route's keyGenerator can join them.
    const oneBucket: AddressKey = { keyFor: (address) => { asked.push(address); return "web-vitals:one"; }, rotate: () => undefined };
    const limited = Fastify();
    await limited.register(rateLimit, { global: false });
    await limited.register(publicWebVitalsRoutes, { prefix: "/public", db, addressKey: oneBucket });
    try {
      const statuses: number[] = [];
      for (let index = 0; index < 61; index += 1) {
        statuses.push((await limited.inject({
          method: "POST", url: "/public/web-vitals", headers: { "content-type": "text/plain;charset=UTF-8" },
          payload: JSON.stringify({ ...REPORT, metrics: [REPORT.metrics[1]] }), remoteAddress: `10.8.0.${String(index)}`,
        })).statusCode);
      }
      // Sixty-one addresses, each far inside its own minute, share one limit.
      expect(statuses.slice(0, 60).every((status) => status === 204)).toBe(true);
      expect(statuses[60]).toBe(429);
      expect(new Set(asked)).toEqual(new Set(Array.from({ length: 61 }, (_, index) => `10.8.0.${String(index)}`)));
    } finally {
      await limited.close();
    }
  });

  it("gives a report's place under the day's ceiling back when its batch is not written", async () => {
    process.env["WEB_VITALS_COLLECTION"] = "on";
    const capped = Fastify();
    const cappedBatch = createWebVitalsBatch(db, { minReports: 1, ceiling: createDailyCeiling(1) });
    await capped.register(publicWebVitalsRoutes, { prefix: "/public", db, batch: cappedBatch });
    const post = (): Promise<LightMyRequestResponse> => capped.inject({
      method: "POST", url: "/public/web-vitals", headers: { "content-type": "text/plain;charset=UTF-8" },
      payload: JSON.stringify({ ...REPORT, metrics: [REPORT.metrics[0]] }), remoteAddress: "10.5.1.1",
    });
    try {
      expect((await post()).statusCode).toBe(204);
      await pool.query("ALTER TABLE web_vital_samples RENAME TO web_vital_samples_away");
      try {
        await expect(cappedBatch.flush()).rejects.toThrow();
      } finally {
        await pool.query("ALTER TABLE web_vital_samples_away RENAME TO web_vital_samples");
      }
      // The batch that was not written is gone, and used none of the day's one place.
      expect(cappedBatch.held()).toBe(0);
      expect([(await post()).statusCode, (await post()).statusCode]).toEqual([204, 429]);
      expect(await cappedBatch.flush()).toBe(1);
      expect(await rows()).toHaveLength(1);
    } finally {
      await capped.close();
    }
    // Across midnight: a report takes yesterday's last place, another takes
    // today's, and then the first one's insert fails. Giving yesterday's
    // place back frees none of today's.
    let clock = Date.UTC(2026, 10, 12, 23, 59, 59);
    const ceiling = createDailyCeiling(1, () => clock);
    const yesterdays = ceiling.admit();
    clock = Date.UTC(2026, 10, 13, 0, 0, 1);
    const todays = ceiling.admit();
    expect([yesterdays, todays].every((place) => place !== null)).toBe(true);
    if (yesterdays !== null) ceiling.release(yesterdays);
    expect(ceiling.admit()).toBeNull();
    // Today's own place, given back, is free again.
    if (todays !== null) ceiling.release(todays);
    expect(ceiling.admit()).not.toBeNull();
    expect(ceiling.admit()).toBeNull();
  });

  it("writes nothing of a device class until it holds ten, then every row of the batch in one transaction, in random order", async () => {
    await pool.query("TRUNCATE web_vital_samples");
    // A fixed draw, so the order is known (the default draws from crypto), and
    // three rows a statement, so the batch's one transaction spans four.
    const draws: number[] = [];
    const tenOfAClass = createWebVitalsBatch(db, { randomInt: (bound) => { draws.push(bound); return 0; }, rowsPerInsert: 3 });
    const reportOf = (device: "phone" | "desktop", value: number) => ({
      ...REPORT, device, metrics: [{ name: "INP" as const, value, rating: "good" as const }],
    });
    for (let value = 1; value <= 9; value += 1) expect(tenOfAClass.hold(reportOf("phone", value))).toBe(true);
    for (const value of [101, 102, 103]) expect(tenOfAClass.hold(reportOf("desktop", value))).toBe(true);
    expect(await tenOfAClass.flush()).toBe(0);
    expect(tenOfAClass.held()).toBe(12);
    expect(tenOfAClass.hold(reportOf("phone", 10))).toBe(true);
    expect(await tenOfAClass.flush()).toBe(10);
    // The three desktops wait: fewer than ten of their class.
    expect(tenOfAClass.held()).toBe(3);
    const { rows: stored } = await pool.query<{ value: number; xmin: string }>(
      "SELECT value, xmin::text AS xmin FROM web_vital_samples ORDER BY ctid",
    );
    const values = stored.map((row) => row.value);
    expect([...values].sort((a, b) => a - b)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
    // A whole Fisher-Yates over the batch's rows (a draw for each place from
    // the last down), so not the order they arrived; and all of one
    // transaction, across its four statements.
    expect(draws).toEqual([10, 9, 8, 7, 6, 5, 4, 3, 2]);
    expect(values).not.toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
    expect(new Set(stored.map((row) => row.xmin)).size).toBe(1);
    // Closing drops the class that never reached ten: nothing more is written.
    expect(await tenOfAClass.flush({ closing: true })).toBe(0);
    expect(tenOfAClass.held()).toBe(0);
    expect((await pool.query("SELECT 1 FROM web_vital_samples")).rowCount).toBe(10);
  });

  it("counts ten within one page: a share page opened once among nine visits to the front door waits", async () => {
    const paged = createWebVitalsBatch(db);
    const report = { ...REPORT, metrics: [REPORT.metrics[1]] };
    // The share page's own API call is logged with its token just before the
    // report, so its rows among nine front-door visits would be its own.
    for (let index = 0; index < 9; index += 1) expect(paged.hold({ ...report, page: "/" })).toBe(true);
    expect(paged.hold({ ...report, page: "/plan-view/:token" })).toBe(true);
    expect(await paged.flush()).toBe(0);
    expect(paged.held()).toBe(10);
    expect(paged.hold({ ...report, page: "/" })).toBe(true);
    expect(await paged.flush()).toBe(10);
    expect(paged.held()).toBe(1);
    expect((await pool.query("SELECT 1 FROM web_vital_samples WHERE page = '/plan-view/:token'")).rowCount).toBe(0);
  });

  it("counts ten within one set of vitals: a lone Android phone among iPhones waits", async () => {
    const grouped = createWebVitalsBatch(db);
    const inp = { name: "INP" as const, value: 100, rating: "good" as const };
    const cls = { name: "CLS" as const, value: 0.01, rating: "good" as const };
    // Ten phones: nine iPhones (no CLS) and an Android phone, whose CLS row
    // would be the batch's only one, and so its own.
    for (let index = 0; index < 9; index += 1) expect(grouped.hold({ ...REPORT, metrics: [inp] })).toBe(true);
    expect(grouped.hold({ ...REPORT, metrics: [inp, cls] })).toBe(true);
    expect(await grouped.flush()).toBe(0);
    expect(grouped.held()).toBe(10);
    expect(grouped.hold({ ...REPORT, metrics: [inp] })).toBe(true);
    expect(await grouped.flush()).toBe(10);
    expect(grouped.held()).toBe(1);
    expect((await pool.query("SELECT 1 FROM web_vital_samples WHERE metric = 'CLS'")).rowCount).toBe(0);
  });

  it("counts ten within one day: a group of an earlier day short of ten is dropped, and no batch mixes days", async () => {
    let clock = Date.UTC(2026, 10, 12, 23, 0);
    const daily = createWebVitalsBatch(db, { now: () => clock });
    const report = { ...REPORT, metrics: [REPORT.metrics[1]] };
    for (let index = 0; index < 5; index += 1) expect(daily.hold(report)).toBe(true);
    clock = Date.UTC(2026, 10, 13, 1, 0);
    for (let index = 0; index < 5; index += 1) expect(daily.hold(report)).toBe(true);
    // Ten phones, five of each day: each row keeps its day, so ten together
    // would be two groups of five. Yesterday's can no longer grow, and goes.
    expect(await daily.flush()).toBe(0);
    expect(daily.held()).toBe(5);
    for (let index = 0; index < 5; index += 1) expect(daily.hold(report)).toBe(true);
    expect(await daily.flush()).toBe(10);
    const { rows: days } = await pool.query<{ day: string }>(
      "SELECT DISTINCT (recorded_at AT TIME ZONE 'UTC')::date::text AS day FROM web_vital_samples",
    );
    expect(days).toEqual([{ day: "2026-11-13" }]);
  });

  it("writes one batch at a time: closing waits for the write under way, so the server never closes its pool beneath it", async () => {
    const once = createWebVitalsBatch(db, { minReports: 1 });
    expect(once.hold({ ...REPORT, metrics: [REPORT.metrics[1]] })).toBe(true);
    // Another connection holds the table, so the write stalls until it lets go.
    const blocker = await pool.connect();
    try {
      await blocker.query("BEGIN");
      await blocker.query("LOCK TABLE web_vital_samples IN ACCESS EXCLUSIVE MODE");
      const first = once.flush();
      let closed = false;
      const closing = once.flush({ closing: true }).then((written) => { closed = true; return written; });
      await new Promise((resolve) => { setTimeout(resolve, 300); });
      expect(closed).toBe(false);
      await blocker.query("COMMIT");
      expect([await first, await closing]).toEqual([1, 0]);
    } finally {
      await blocker.query("ROLLBACK").catch(() => undefined);
      blocker.release();
    }
    expect((await pool.query("SELECT 1 FROM web_vital_samples")).rowCount).toBe(1);
  });

  it("gives up a write that stalls past its bound: the batch is dropped and later writes go on", async () => {
    const bounded = createWebVitalsBatch(db, { minReports: 1, writeTimeoutMs: 200 });
    expect(bounded.hold({ ...REPORT, metrics: [REPORT.metrics[1]] })).toBe(true);
    const blocker = await pool.connect();
    try {
      await blocker.query("BEGIN");
      await blocker.query("LOCK TABLE web_vital_samples IN ACCESS EXCLUSIVE MODE");
      // The writer's timer or the database's own statement timeout, whichever comes first.
      await expect(bounded.flush()).rejects.toThrow(/took over 200 ms|statement timeout/u);
      // Hold the table until the database has cancelled the stalled insert too.
      await new Promise((resolve) => { setTimeout(resolve, 800); });
    } finally {
      await blocker.query("ROLLBACK");
      blocker.release();
    }
    // The stalled batch is gone, never written twice; the next one is written.
    expect(bounded.held()).toBe(0);
    expect(bounded.hold({ ...REPORT, metrics: [REPORT.metrics[2]] })).toBe(true);
    expect(await bounded.flush()).toBe(1);
    const { rows: written } = await pool.query<{ metric: string }>("SELECT metric FROM web_vital_samples");
    expect(written).toEqual([{ metric: "CLS" }]);
  });

  it("writes what its groups hold when the whole server closes, before its database pool goes", async () => {
    process.env["WEB_VITALS_COLLECTION"] = "on";
    const { buildServer } = await import("../index.js");
    // The route's own batch (ten a group) and its hourly timer, on the server's own pool.
    const whole: FastifyInstance = await buildServer(validateEnv({
      NODE_ENV: "test",
      DATABASE_URL: testUrl,
      JWT_SECRET: "test-jwt-secret-that-is-at-least-32-characters-long",
    }));
    await whole.ready();
    const post = (report: typeof REPORT | Record<string, unknown>, index: number): Promise<LightMyRequestResponse> => whole.inject({
      method: "POST", url: "/public/web-vitals", headers: { "content-type": "text/plain;charset=UTF-8" },
      payload: JSON.stringify(report), remoteAddress: `10.3.1.${String(index)}`,
    });
    for (let index = 0; index < 10; index += 1) expect((await post({ ...REPORT, metrics: [REPORT.metrics[1]] }, index)).statusCode).toBe(204);
    for (let index = 10; index < 12; index += 1) expect((await post({ ...REPORT, device: "desktop", metrics: [REPORT.metrics[1]] }, index)).statusCode).toBe(204);
    await whole.close();
    // The phones' group of ten is written as the server closes; the two desktops are not.
    const { rows: stored } = await pool.query<{ device: string }>("SELECT device FROM web_vital_samples");
    expect(stored).toHaveLength(10);
    expect(new Set(stored.map((row) => row.device))).toEqual(new Set(["phone"]));
  }, 120_000);

  it("writes the held reports on the route's own timer", async () => {
    process.env["WEB_VITALS_COLLECTION"] = "on";
    const timed = Fastify();
    await timed.register(publicWebVitalsRoutes, { prefix: "/public", db, flushEveryMs: 20 });
    try {
      for (let index = 0; index < 10; index += 1) {
        expect((await timed.inject({
          method: "POST", url: "/public/web-vitals", headers: { "content-type": "text/plain;charset=UTF-8" },
          payload: JSON.stringify({ ...REPORT, metrics: [REPORT.metrics[1]] }), remoteAddress: `10.4.0.${String(index)}`,
        })).statusCode).toBe(204);
      }
      await vi.waitFor(async () => {
        expect((await pool.query("SELECT 1 FROM web_vital_samples")).rowCount).toBe(10);
      }, { timeout: 5_000 });
    } finally {
      await timed.close();
    }
  });

  it("starts the report's window at a UTC midnight, whatever the session's time zone, across a change of clocks", async () => {
    const client = await pool.connect();
    try {
      // London's clocks went forward on 29 March 2026: 27 days of the
      // session's calendar before 10 April 00:00 UTC is 14 March 01:00 UTC,
      // an hour past that day's rows. The window must start at its midnight.
      await client.query("SET TIME ZONE 'Europe/London'");
      const start = webVitalsWindowStart(28, sql`'2026-04-10 12:00:00+00'::timestamptz`);
      const { rows: [found] } = await drizzle(client).execute<{ epoch: string }>(sql`SELECT extract(epoch FROM ${start})::text AS epoch`);
      expect(Number(found?.epoch)).toBe(Date.UTC(2026, 2, 14) / 1000);
    } finally {
      await client.query("RESET TIME ZONE");
      client.release();
    }
  });

  it("removes samples past their retention and keeps the rest", async () => {
    await pool.query(
      `INSERT INTO web_vital_samples (page, device, metric, value, rating, recorded_at) VALUES
         ('/', 'desktop', 'LCP', 1, 'good', now() - make_interval(days => $1 + 1)),
         ('/', 'desktop', 'LCP', 2, 'good', now() - make_interval(days => $1 - 1))`,
      [WEB_VITAL_RETENTION_DAYS],
    );
    expect(await removeExpiredWebVitalSamples(db)).toBe(1);
    expect((await rows()).map((row) => row.value)).toEqual([2]);
  });

  it("reads each vital's p75 by device class, across every page and by page, beside goal 07's target", async () => {
    const insert = (page: string, device: string, metric: string, values: readonly number[], daysAgo = 1): Promise<unknown> => pool.query(
      `INSERT INTO web_vital_samples (page, device, metric, value, rating, recorded_at)
       SELECT $1, $2, $3, value, 'good', now() - make_interval(days => $5) FROM unnest($4::double precision[]) AS value`,
      [page, device, metric, values, daysAgo],
    );
    await insert("/", "phone", "LCP", [1000, 2000, 3000, 4000, 5000]);
    await insert("/plan/:code", "phone", "LCP", [500, 600, 700]);
    await insert("/", "desktop", "CLS", [0.01, 0.02, 0.05, 0.3]);
    // Outside the window asked for.
    await insert("/", "phone", "LCP", [90_000], 40);

    const p75 = await webVitalsP75(db, 28);
    expect(p75).toEqual([
      { metric: "CLS", device: "desktop", page: null, samples: 4, p75: 0.1125, target: 0.1, meetsTarget: false },
      { metric: "CLS", device: "desktop", page: "/", samples: 4, p75: 0.1125, target: 0.1, meetsTarget: false },
      { metric: "LCP", device: "phone", page: null, samples: 8, p75: 3250, target: 2500, meetsTarget: false },
      { metric: "LCP", device: "phone", page: "/", samples: 5, p75: 4000, target: 2500, meetsTarget: false },
      { metric: "LCP", device: "phone", page: "/plan/:code", samples: 3, p75: 650, target: 2500, meetsTarget: true },
    ]);
    const plan = p75.find((row) => row.page === "/plan/:code");
    expect(plan === undefined ? null : formatP75Line(plan))
      .toBe("LCP  phone   /plan/:code                      p75    650 ms  target 2500 ms  meets  n=3");
  });

  it("reads the last N days as today and the N-1 whole UTC days before it", async () => {
    // Rows at UTC midnights, as the column's default stores them. Days counted
    // in hours: '27 days' would follow the session's time zone, and in a
    // zone that changed its clocks meanwhile land an hour off midnight.
    await pool.query(
      `INSERT INTO web_vital_samples (page, device, metric, value, rating, recorded_at) VALUES
         ('/', 'tablet', 'INP', 100, 'good', date_trunc('day', now(), 'UTC')),
         ('/', 'tablet', 'INP', 200, 'good', date_trunc('day', now(), 'UTC') - interval '648 hours'),
         ('/', 'tablet', 'INP', 900, 'poor', date_trunc('day', now(), 'UTC') - interval '672 hours')`,
    );
    const samples = async (days: number): Promise<number | undefined> =>
      (await webVitalsP75(db, days)).find((row) => row.metric === "INP" && row.page === null)?.samples;
    expect(await samples(28)).toBe(2);
    expect(await samples(1)).toBe(1);
  });
});
