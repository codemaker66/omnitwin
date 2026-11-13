import Fastify, { type FastifyInstance, type LightMyRequestResponse } from "fastify";
import rateLimit from "@fastify/rate-limit";
import { randomInt } from "node:crypto";
import { resolve } from "node:path";
import { Pool, type PoolClient } from "pg";
import { sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { WEB_VITALS_REPORT_BYTES, WEB_VITAL_RETENTION_DAYS, padWebVitalsReport } from "@omnitwin/types";
import * as schema from "../db/schema.js";
import type { Database } from "../db/client.js";
import { validateEnv } from "../env.js";
import {
  WEB_VITALS_BATCH_WRITE_TIMEOUT_MS, createAddressKey, createDailyCeiling, createWebVitalsBatch, removeExpiredWebVitalSamples, shuffleInPlace,
  webVitalsP75, webVitalsWindowStart, type AddressKey, type WebVitalsBatch,
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

/** A body as the browser sends it: padded to the one size every report is
 *  sent at (WEB_VITALS_REPORT_BYTES), or as it is if it cannot be. */
function wire(body: unknown): string {
  const json = typeof body === "string" ? body : JSON.stringify(body);
  return padWebVitalsReport(json) ?? json;
}

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

  // A report's samples go to as many groups as it has vitals, and a batch
  // shuffles them all together: they land apart as often as chance says.
  it("leaves four given rows side by side among forty about as rarely as chance does", () => {
    let together = 0;
    const firstAt = new Array<number>(40).fill(0);
    for (let run = 0; run < 4_000; run += 1) {
      const rows = Array.from({ length: 40 }, (_, index) => index);
      shuffleInPlace(rows, (bound) => randomInt(bound));
      const at = [0, 1, 2, 3].map((row) => rows.indexOf(row)).sort((a, b) => a - b);
      if ((at[3] ?? 0) - (at[0] ?? 0) === 3) together += 1;
      const first = rows.indexOf(0);
      firstAt[first] = (firstAt[first] ?? 0) + 1;
    }
    // Chance puts four given rows of forty side by side 24 times in 59,280
    // (1.6 in 4,000); twelve or more would come about once in ten million runs.
    expect(together).toBeLessThan(12);
    // And a row is as likely to land anywhere: a hundred times each on average.
    for (const count of firstAt) {
      expect(count).toBeGreaterThan(50);
      expect(count).toBeLessThan(150);
    }
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
      payload: wire(body),
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
    batch = createWebVitalsBatch(db, { minSamples: 1 });
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
    // Each on its vital's step (10 ms; CLS in hundredths), rated from that.
    expect(await rows()).toEqual([
      { page: "/proposal-share/:token", device: "phone", metric: "CLS", value: 0.04, rating: "good" },
      { page: "/proposal-share/:token", device: "phone", metric: "INP", value: 180, rating: "good" },
      { page: "/proposal-share/:token", device: "phone", metric: "LCP", value: 5230, rating: "poor" },
      { page: "/proposal-share/:token", device: "phone", metric: "TTFB", value: 410, rating: "good" },
    ]);
    // The row holds nothing else: no address, no agent, no time but its own,
    // and nothing the privacy page does not name.
    const { rows: columns } = await pool.query<{ column_name: string }>(
      "SELECT column_name FROM information_schema.columns WHERE table_name = 'web_vital_samples' ORDER BY column_name",
    );
    expect(columns.map((column) => column.column_name))
      .toEqual(["device", "id", "metric", "page", "rating", "recorded_at", "value"]);
    // The id is a random UUID, not a sequence that would count arrivals, and
    // the insert never sets it: every stored id is version 4, with nothing in
    // it of when or where the report came from.
    const { rows: [id] } = await pool.query<{ column_default: string }>(
      "SELECT column_default FROM information_schema.columns WHERE table_name = 'web_vital_samples' AND column_name = 'id'",
    );
    expect(id?.column_default).toBe("gen_random_uuid()");
    const { rows: ids } = await pool.query<{ id: string }>("SELECT id::text AS id FROM web_vital_samples");
    expect(ids).toHaveLength(4);
    for (const stored of ids) expect(stored.id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u);
  });

  it("keeps the day a report arrived, not the moment, so no row matches a request log by time", async () => {
    process.env["WEB_VITALS_COLLECTION"] = "on";
    const arrived = Math.floor(Date.now() / 86_400_000) * 86_400_000;
    expect((await beacon(JSON.stringify(REPORT))).statusCode).toBe(204);
    expect(await batch.flush()).toBe(4);
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

  // The release lead's B1 (13 November 2026): a value's precision is its
  // browser's clock. TTFB alone is what iPhones before iOS 26.2, and visitors
  // who move on early, send; kept as sent, a fractional one among whole ones
  // would be the one Chromium report of its batch.
  it("keeps each value on its vital's step, rated from that value, so a clock's precision says nothing of the browser", async () => {
    process.env["WEB_VITALS_COLLECTION"] = "on";
    // Five from Chromium's clock (a tenth of a millisecond), five from WebKit's (a millisecond).
    const chromium = [312.30000001192093, 298.69999998807907, 455.1000000089407, 61.80000001192093, 1204.4000000059605];
    const webkit = [312, 299, 455, 62, 1204];
    for (const value of [...chromium, ...webkit]) {
      const report = { ...REPORT, page: "/", metrics: [{ name: "TTFB", value, rating: "good" }] };
      expect((await beacon(JSON.stringify(report))).statusCode).toBe(204);
    }
    const ttfbs = (await rows()).map((row) => row.value).sort((a, b) => a - b);
    // Each Chromium row equals a WebKit row: nothing tells the two apart.
    expect(ttfbs).toEqual([60, 60, 300, 300, 310, 310, 460, 460, 1200, 1200]);
    await pool.query("DELETE FROM web_vital_samples");
    // The browser's own rating of 2,504.9 ms is "needs-improvement"; kept as
    // 2,500 ms it is "good", so the rating says nothing below the step either.
    const rated = { ...REPORT, metrics: [
      { name: "LCP", value: 2_504.9, rating: "needs-improvement" },
      { name: "CLS", value: 0.0384615, rating: "good" },
    ] };
    expect((await beacon(JSON.stringify(rated))).statusCode).toBe(204);
    expect((await rows()).map(({ metric, value, rating }) => ({ metric, value, rating }))).toEqual([
      { metric: "CLS", value: 0.04, rating: "good" },
      { metric: "LCP", value: 2_500, rating: "good" },
    ]);
  });

  it("keeps nothing from a browser that sends Global Privacy Control or Do Not Track", async () => {
    process.env["WEB_VITALS_COLLECTION"] = "on";
    for (const objection of [{ "sec-gpc": "1" }, { dnt: "1" }]) {
      const res = await server.inject({
        method: "POST", url: "/public/web-vitals",
        headers: { "content-type": "text/plain;charset=UTF-8", origin: "https://venviewer.com", ...objection },
        payload: wire(REPORT), remoteAddress: "10.6.6.6",
      });
      expect(res.statusCode, JSON.stringify(objection)).toBe(204);
    }
    expect(await rows()).toEqual([]);
  });

  // #309's round-4 review (13 November 2026): the host's request log records
  // each request's size, which would follow what a report carries. Every
  // report is sent at one size, and one of any other length is refused.
  it("refuses a report that does not come at the one size every report is sent at, and keeps nothing", async () => {
    process.env["WEB_VITALS_COLLECTION"] = "on";
    const exact = wire(REPORT);
    expect(exact).toHaveLength(WEB_VITALS_REPORT_BYTES);
    for (const contentType of ["text/plain;charset=UTF-8", "application/json"]) {
      for (const body of [JSON.stringify(REPORT), `${exact} `, exact.slice(0, -1)]) {
        const res = await server.inject({
          method: "POST", url: "/public/web-vitals",
          headers: { "content-type": contentType, origin: "https://venviewer.com" },
          payload: body, remoteAddress: "10.6.7.7",
        });
        expect(res.statusCode, `${contentType} ${String(body.length)}`).toBe(400);
      }
    }
    expect(await rows()).toEqual([]);
    expect((await beacon(JSON.stringify(REPORT))).statusCode).toBe(204);
    expect(await rows()).toHaveLength(4);
  });

  it("reads a JSON body as well as a beacon's text", async () => {
    process.env["WEB_VITALS_COLLECTION"] = "on";
    const res = await server.inject({
      method: "POST", url: "/public/web-vitals", headers: { "content-type": "application/json" },
      payload: wire({ ...REPORT, metrics: [REPORT.metrics[0]] }), remoteAddress: "10.8.0.1",
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
    const cappedBatch = createWebVitalsBatch(db, { minSamples: 1, ceiling: createDailyCeiling(2) });
    await capped.register(publicWebVitalsRoutes, { prefix: "/public", db, batch: cappedBatch });
    const post = (from: string): Promise<LightMyRequestResponse> => capped.inject({
      method: "POST", url: "/public/web-vitals", headers: { "content-type": "text/plain;charset=UTF-8" },
      payload: wire({ ...REPORT, metrics: [REPORT.metrics[0]] }), remoteAddress: from,
    });
    try {
      // A body that is not a report is refused before it counts against the day.
      expect((await capped.inject({
        method: "POST", url: "/public/web-vitals", headers: { "content-type": "text/plain;charset=UTF-8" },
        payload: wire("{not json"), remoteAddress: "10.5.0.9",
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
        payload: wire(REPORT), remoteAddress: "10.4.4.4",
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
    // The route's own batch (ten samples of one vital a group) and its own timer, quickened.
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
      payload: wire(payload), remoteAddress: visitor,
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
          payload: wire({ ...REPORT, metrics: [REPORT.metrics[1]] }), remoteAddress: `10.8.0.${String(index)}`,
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
    const cappedBatch = createWebVitalsBatch(db, { minSamples: 1, ceiling: createDailyCeiling(1) });
    await capped.register(publicWebVitalsRoutes, { prefix: "/public", db, batch: cappedBatch });
    const post = (): Promise<LightMyRequestResponse> => capped.inject({
      method: "POST", url: "/public/web-vitals", headers: { "content-type": "text/plain;charset=UTF-8" },
      payload: wire({ ...REPORT, metrics: [REPORT.metrics[0]] }), remoteAddress: "10.5.1.1",
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
    // A report's samples may be written apart. Once one is written the report
    // keeps its place, though another's batch is refused; a report none of
    // whose samples was written gives its place back.
    await pool.query("DELETE FROM web_vital_samples");
    const split = createWebVitalsBatch(db, { minSamples: 2, ceiling: createDailyCeiling(3) });
    const lcp = REPORT.metrics[0];
    const cls = REPORT.metrics[2];
    expect(split.hold({ ...REPORT, metrics: [lcp, cls] })).toBe(true);
    expect(split.hold({ ...REPORT, metrics: [lcp] })).toBe(true);
    // The two LCP samples are written; the first report's CLS waits.
    expect(await split.flush()).toBe(2);
    expect(split.hold({ ...REPORT, metrics: [cls] })).toBe(true);
    await pool.query("ALTER TABLE web_vital_samples RENAME TO web_vital_samples_away");
    try {
      await expect(split.flush()).rejects.toThrow();
    } finally {
      await pool.query("ALTER TABLE web_vital_samples_away RENAME TO web_vital_samples");
    }
    // Of the day's three places, the first report keeps its own and the last
    // gives its back: one is free.
    expect([split.hold({ ...REPORT, metrics: [lcp] }), split.hold({ ...REPORT, metrics: [lcp] })]).toEqual([true, false]);
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
    // Whole steps, so each arrival keeps its own value and its place is known.
    const arrivals = [10, 20, 30, 40, 50, 60, 70, 80, 90, 100];
    for (const value of arrivals.slice(0, 9)) expect(tenOfAClass.hold(reportOf("phone", value))).toBe(true);
    for (const value of [1_010, 1_020, 1_030]) expect(tenOfAClass.hold(reportOf("desktop", value))).toBe(true);
    expect(await tenOfAClass.flush()).toBe(0);
    expect(tenOfAClass.held()).toBe(12);
    expect(tenOfAClass.hold(reportOf("phone", 100))).toBe(true);
    expect(await tenOfAClass.flush()).toBe(10);
    // The three desktops wait: fewer than ten of their class.
    expect(tenOfAClass.held()).toBe(3);
    const { rows: stored } = await pool.query<{ value: number; xmin: string }>(
      "SELECT value, xmin::text AS xmin FROM web_vital_samples ORDER BY ctid",
    );
    const values = stored.map((row) => row.value);
    expect([...values].sort((a, b) => a - b)).toEqual(arrivals);
    // A whole Fisher-Yates over the batch's rows (a draw for each place from
    // the last down), so not the order they arrived; and all of one
    // transaction, across its four statements.
    expect(draws).toEqual([10, 9, 8, 7, 6, 5, 4, 3, 2]);
    expect(values).not.toEqual(arrivals);
    expect(new Set(stored.map((row) => row.xmin)).size).toBe(1);
    // Closing drops the class that never reached ten: nothing more is written.
    expect(await tenOfAClass.flush({ closing: true })).toBe(0);
    expect(tenOfAClass.held()).toBe(0);
    expect((await pool.query("SELECT 1 FROM web_vital_samples")).rowCount).toBe(10);
  });

  // The release lead's B4 conditions (13 November 2026): a report's samples go
  // to four groups, so one shuffle must spread them through the whole batch.
  // Rows of one report then sit side by side only by chance, as any two rows
  // may, which says nothing of where they came from. Forbidding it would
  // itself mark rows side by side as two reports' (the second round-4 review),
  // so chance is the property: the shuffle unit tests above check it.
  it("shuffles every row of a batch at once, across its vitals, so the table's order keeps neither its groups nor its reports", async () => {
    await pool.query("TRUNCATE web_vital_samples");
    // A seeded draw (mulberry32, exact in 32 bits; the default draws from
    // crypto), so a failure repeats. Seeds 1, 2 and 3 give the same outcome.
    let seed = 0x5e_ed;
    const draws: number[] = [];
    const spread = createWebVitalsBatch(db, {
      randomInt: (bound) => {
        draws.push(bound);
        seed = (seed + 0x6d_2b_79_f5) >>> 0;
        let mixed = Math.imul(seed ^ (seed >>> 15), seed | 1);
        mixed ^= mixed + Math.imul(mixed ^ (mixed >>> 7), mixed | 61);
        return Math.floor((((mixed ^ (mixed >>> 14)) >>> 0) / 4_294_967_296) * bound);
      },
    });
    // Ten reports of four vitals, each report's values its own, so a row names its report.
    for (let report = 0; report < 10; report += 1) {
      expect(spread.hold({ ...REPORT, metrics: [
        { name: "LCP", value: 1_000 + report * 10, rating: "good" },
        { name: "INP", value: 100 + report * 10, rating: "good" },
        { name: "CLS", value: (report + 1) / 100, rating: "good" },
        { name: "TTFB", value: 300 + report * 10, rating: "good" },
      ] })).toBe(true);
    }
    expect(await spread.flush()).toBe(40);
    // One Fisher-Yates over all forty rows at once, across the four vitals' groups.
    expect(draws).toEqual(Array.from({ length: 39 }, (_, index) => 40 - index));
    const { rows: stored } = await pool.query<{ metric: string; value: number }>(
      "SELECT metric, value FROM web_vital_samples ORDER BY ctid",
    );
    const bases: Record<string, number> = { LCP: 1_000, INP: 100, TTFB: 300 };
    const reports = stored.map(({ metric, value }) => (metric === "CLS"
      ? Math.round(value * 100) - 1
      : Math.round((value - (bases[metric] ?? 0)) / 10)));
    expect([...reports].sort((a, b) => a - b)).toEqual(Array.from({ length: 40 }, (_, index) => Math.floor(index / 4)));
    // Held group by group (every LCP, then every INP...), the table keeps no
    // group together...
    let run = 1;
    let longest = 1;
    for (let index = 1; index < stored.length; index += 1) {
      run = stored[index]?.metric === stored[index - 1]?.metric ? run + 1 : 1;
      longest = Math.max(longest, run);
    }
    expect(longest).toBeLessThan(10);
    // ...and no report keeps its four rows together.
    for (let report = 0; report < 10; report += 1) {
      const at = reports.flatMap((row, index) => (row === report ? [index] : []));
      expect((at[3] ?? 0) - (at[0] ?? 0), `report ${String(report)}`).toBeGreaterThan(3);
    }
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

  it("counts ten within one vital: a lone Android phone's CLS waits, while its INP is written with the iPhones'", async () => {
    const grouped = createWebVitalsBatch(db);
    const inp = { name: "INP" as const, value: 100, rating: "good" as const };
    const cls = { name: "CLS" as const, value: 0.01, rating: "good" as const };
    // Ten phones: nine iPhones (no CLS) and an Android phone, whose CLS row
    // would be the batch's only one, and so its own. Its INP row is one of ten
    // on one step, and joins nothing else of its report.
    for (let index = 0; index < 9; index += 1) expect(grouped.hold({ ...REPORT, metrics: [inp] })).toBe(true);
    expect(grouped.hold({ ...REPORT, metrics: [inp, cls] })).toBe(true);
    expect(await grouped.flush()).toBe(10);
    expect(grouped.held()).toBe(1);
    expect((await pool.query("SELECT 1 FROM web_vital_samples WHERE metric = 'CLS'")).rowCount).toBe(0);
    // Nine more Android phones: ten CLS samples, a group of their own.
    for (let index = 0; index < 9; index += 1) expect(grouped.hold({ ...REPORT, metrics: [cls] })).toBe(true);
    expect(await grouped.flush()).toBe(10);
    expect((await pool.query("SELECT 1 FROM web_vital_samples WHERE metric = 'CLS'")).rowCount).toBe(10);
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
    const once = createWebVitalsBatch(db, { minSamples: 1 });
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

  it("gives up waiting for a write that stalls past its bound: the database cancels it, its place comes back, and later writes go on", async () => {
    const bounded = createWebVitalsBatch(db, { minSamples: 1, writeTimeoutMs: 500, ceiling: createDailyCeiling(1) });
    expect(bounded.hold({ ...REPORT, metrics: [REPORT.metrics[1]] })).toBe(true);
    const blocker = await pool.connect();
    try {
      await blocker.query("BEGIN");
      await blocker.query("LOCK TABLE web_vital_samples IN ACCESS EXCLUSIVE MODE");
      // The flush's own bound starts before the insert does, so it gives up
      // first; the database's cancel then shows in the place that comes back.
      await expect(bounded.flush()).rejects.toThrow(/unfinished after 500 ms/u);
      // The database cancels the stalled insert, the batch is rolled back, and
      // the day's one place is given back.
      await vi.waitFor(() => { expect(bounded.hold({ ...REPORT, metrics: [REPORT.metrics[2]] })).toBe(true); }, { timeout: 5_000 });
    } finally {
      await blocker.query("ROLLBACK");
      blocker.release();
    }
    // The stalled batch is gone, never written twice; the next one is written.
    expect(bounded.held()).toBe(1);
    expect(await bounded.flush()).toBe(1);
    const { rows: written } = await pool.query<{ metric: string }>("SELECT metric FROM web_vital_samples");
    expect(written).toEqual([{ metric: "CLS" }]);
  });

  // The release lead's F1, B2 and M3 (13 November 2026): a flush that stops
  // waiting has not stopped the transaction, which may still commit.
  it("keeps a write that commits after its bound, and keeps its places counted all along", async () => {
    // One connection, taken here: the batch's transaction waits for it past its bound.
    const narrowPool = new Pool({ connectionString: testUrl, application_name: "web_vitals_narrow", max: 1 });
    const narrowDb: Database = drizzle(narrowPool, { schema });
    const late = createWebVitalsBatch(narrowDb, { minSamples: 1, writeTimeoutMs: 500, ceiling: createDailyCeiling(1) });
    const taken = await narrowPool.connect();
    let released = false;
    try {
      expect(late.hold({ ...REPORT, metrics: [REPORT.metrics[1]] })).toBe(true);
      await expect(late.flush()).rejects.toThrow(/unfinished after 500 ms: it may still be stored, and is never tried again/u);
      // Unfinished is not refused: the day's one place stays taken.
      expect(late.hold({ ...REPORT, metrics: [REPORT.metrics[2]] })).toBe(false);
      taken.release();
      released = true;
      // Given its connection, the write goes on and commits, once.
      await vi.waitFor(async () => {
        const { rows: written } = await pool.query<{ metric: string }>("SELECT metric FROM web_vital_samples");
        expect(written).toEqual([{ metric: "INP" }]);
      }, { timeout: 5_000 });
      expect(late.hold({ ...REPORT, metrics: [REPORT.metrics[2]] })).toBe(false);
    } finally {
      if (!released) taken.release();
      await narrowPool.end();
    }
  });

  it("writes one batch at a time: an hourly write waits for the one under way within its bound, and writes nothing beside it", async () => {
    const narrowPool = new Pool({ connectionString: testUrl, application_name: "web_vitals_narrow", max: 1 });
    const narrowDb: Database = drizzle(narrowPool, { schema });
    const serial = createWebVitalsBatch(narrowDb, { minSamples: 1, writeTimeoutMs: 500 });
    const taken = await narrowPool.connect();
    let released = false;
    try {
      expect(serial.hold({ ...REPORT, metrics: [REPORT.metrics[1]] })).toBe(true);
      await expect(serial.flush()).rejects.toThrow(/unfinished after 500 ms/u);
      expect(serial.hold({ ...REPORT, metrics: [REPORT.metrics[2]] })).toBe(true);
      // The next write does not start beside the first: it waits within its
      // bound, then writes nothing this hour, and what it would write stays held.
      const waited = Date.now();
      await expect(serial.flush()).rejects.toThrow(/still being written after 500 ms: nothing is written this hour/u);
      expect(Date.now() - waited).toBeGreaterThanOrEqual(450);
      expect(serial.held()).toBe(1);
      taken.release();
      released = true;
      // Once the first has committed, a later flush writes what was held.
      await vi.waitFor(async () => { expect(await serial.flush()).toBe(1); }, { timeout: 5_000 });
      const { rows: written } = await pool.query<{ metric: string; xmin: string }>(
        "SELECT metric, xmin::text AS xmin FROM web_vital_samples ORDER BY metric",
      );
      expect(written.map((row) => row.metric)).toEqual(["CLS", "INP"]);
      // Two transactions, one after the other.
      expect(new Set(written.map((row) => row.xmin)).size).toBe(2);
    } finally {
      if (!released) taken.release();
      await narrowPool.end();
    }
  });

  // #309's round-4 review: a write that never settles must not stop the day's
  // housekeeping, or what is held would grow past a day's ceiling.
  it("while a write stays stuck, still drops an earlier day's groups each hour, so what is held stays within a day", async () => {
    let clock = Date.UTC(2026, 10, 12, 23, 0);
    const narrowPool = new Pool({ connectionString: testUrl, application_name: "web_vitals_narrow", max: 1 });
    const narrowDb: Database = drizzle(narrowPool, { schema });
    const stuck = createWebVitalsBatch(narrowDb, { minSamples: 1, writeTimeoutMs: 500, now: () => clock });
    const taken = await narrowPool.connect();
    let released = false;
    try {
      expect(stuck.hold({ ...REPORT, metrics: [REPORT.metrics[1]] })).toBe(true);
      await expect(stuck.flush()).rejects.toThrow(/unfinished after 500 ms/u);
      expect(stuck.hold({ ...REPORT, metrics: [REPORT.metrics[2]] })).toBe(true);
      clock = Date.UTC(2026, 10, 13, 1, 0);
      expect(stuck.hold({ ...REPORT, metrics: [REPORT.metrics[3]] })).toBe(true);
      expect(stuck.held()).toBe(2);
      await expect(stuck.flush()).rejects.toThrow(/nothing is written this hour/u);
      // Yesterday's CLS can no longer grow, and goes; today's TTFB waits.
      expect(stuck.held()).toBe(1);
      taken.release();
      released = true;
      await vi.waitFor(async () => { expect(await stuck.flush()).toBe(1); }, { timeout: 5_000 });
      const { rows: written } = await pool.query<{ metric: string }>("SELECT metric FROM web_vital_samples ORDER BY metric");
      expect(written.map((row) => row.metric)).toEqual(["INP", "TTFB"]);
    } finally {
      if (!released) taken.release();
      await narrowPool.end();
    }
  });

  it("closes without waiting past its bound for a write still stuck, and drops what it holds", async () => {
    const narrowPool = new Pool({ connectionString: testUrl, application_name: "web_vitals_narrow", max: 1 });
    const narrowDb: Database = drizzle(narrowPool, { schema });
    const stuck = createWebVitalsBatch(narrowDb, { minSamples: 1, writeTimeoutMs: 500 });
    const taken = await narrowPool.connect();
    let released = false;
    try {
      expect(stuck.hold({ ...REPORT, metrics: [REPORT.metrics[1]] })).toBe(true);
      await expect(stuck.flush()).rejects.toThrow(/unfinished after 500 ms/u);
      expect(stuck.hold({ ...REPORT, metrics: [REPORT.metrics[2]] })).toBe(true);
      // The first write still waits for its connection. Closing waits for it
      // only within its own bound, and then drops what it holds.
      const started = Date.now();
      await expect(stuck.flush({ closing: true })).rejects.toThrow(/still being written 500 ms into closing: what is held is dropped/u);
      expect(Date.now() - started).toBeLessThan(2_000);
      expect(stuck.held()).toBe(0);
      taken.release();
      released = true;
      // The stuck write commits once it has its connection; what closing dropped never does.
      await vi.waitFor(async () => {
        const { rows: written } = await pool.query<{ metric: string }>("SELECT metric FROM web_vital_samples");
        expect(written).toEqual([{ metric: "INP" }]);
      }, { timeout: 5_000 });
    } finally {
      if (!released) taken.release();
      await narrowPool.end();
    }
  });

  // #309's round-4 review: a closing flush has one bound for its waiting and
  // its write together, so the close as a whole stays within it.
  it("closes within one bound for its waiting and its write together", async () => {
    const narrowPool = new Pool({ connectionString: testUrl, application_name: "web_vitals_narrow", max: 1 });
    const narrowDb: Database = drizzle(narrowPool, { schema });
    const timed = createWebVitalsBatch(narrowDb, { minSamples: 1, writeTimeoutMs: 2_000 });
    const taken = await narrowPool.connect();
    let released = false;
    let next: PoolClient | undefined;
    try {
      expect(timed.hold({ ...REPORT, metrics: [REPORT.metrics[1]] })).toBe(true);
      await expect(timed.flush()).rejects.toThrow(/unfinished after 2000 ms/u);
      expect(timed.hold({ ...REPORT, metrics: [REPORT.metrics[2]] })).toBe(true);
      const started = Date.now();
      const closing = timed.flush({ closing: true });
      // In line behind the first write (the pool serves its queue in order),
      // so once that write is done the closing write waits for this connection.
      const queued = narrowPool.connect();
      await new Promise((resolve) => { setTimeout(resolve, 1_000); });
      taken.release();
      released = true;
      next = await queued;
      // The first write settled inside the close's wait, and the close's own
      // write then waited with only what was left of its one bound.
      await expect(closing).rejects.toThrow(/unfinished after \d+ ms/u);
      // Two bounds would have taken at least 1,000 ms more than one.
      expect(Date.now() - started).toBeLessThan(2_000 + 700);
    } finally {
      if (!released) taken.release();
      next?.release();
      await narrowPool.end();
    }
  }, 15_000);

  it("writes what its groups hold when the whole server closes, before its database pool goes", async () => {
    process.env["WEB_VITALS_COLLECTION"] = "on";
    const { buildServer } = await import("../index.js");
    // The route's own batch (ten samples of one vital a group) and its hourly timer, on the server's own pool.
    const whole: FastifyInstance = await buildServer(validateEnv({
      NODE_ENV: "test",
      DATABASE_URL: testUrl,
      JWT_SECRET: "test-jwt-secret-that-is-at-least-32-characters-long",
    }));
    await whole.ready();
    const post = (report: typeof REPORT | Record<string, unknown>, index: number): Promise<LightMyRequestResponse> => whole.inject({
      method: "POST", url: "/public/web-vitals", headers: { "content-type": "text/plain;charset=UTF-8" },
      payload: wire(report), remoteAddress: `10.3.1.${String(index)}`,
    });
    for (let index = 0; index < 10; index += 1) expect((await post({ ...REPORT, metrics: [REPORT.metrics[1]] }, index)).statusCode).toBe(204);
    for (let index = 10; index < 12; index += 1) expect((await post({ ...REPORT, device: "desktop", metrics: [REPORT.metrics[1]] }, index)).statusCode).toBe(204);
    await whole.close();
    // The phones' group of ten is written as the server closes; the two desktops are not.
    const { rows: stored } = await pool.query<{ device: string }>("SELECT device FROM web_vital_samples");
    expect(stored).toHaveLength(10);
    expect(new Set(stored.map((row) => row.device))).toEqual(new Set(["phone"]));
  }, 120_000);

  // #309's third round-4 review: a close with under a tenth of its bound left
  // drops what it holds rather than start a write it could not wait for.
  it("closes with what little of its bound is left by dropping what it holds, rather than starting a write it could not wait for", async () => {
    const narrowPool = new Pool({ connectionString: testUrl, application_name: "web_vitals_narrow", max: 1 });
    const narrowDb: Database = drizzle(narrowPool, { schema });
    // The close's bound is read on this clock, so the test, not the runner's
    // speed, decides how much of it is left (a fourth review's point: on real
    // time a slow commit reached the bound itself, not its last tenth).
    let clock = 0;
    const late = createWebVitalsBatch(narrowDb, { minSamples: 1, writeTimeoutMs: 2_000, ceiling: createDailyCeiling(2), monotonicNow: () => clock });
    const taken = await narrowPool.connect();
    let released = false;
    try {
      expect(late.hold({ ...REPORT, metrics: [REPORT.metrics[1]] })).toBe(true);
      await expect(late.flush()).rejects.toThrow(/unfinished after 2000 ms/u);
      expect(late.hold({ ...REPORT, metrics: [REPORT.metrics[2]] })).toBe(true);
      const closing = late.flush({ closing: true });
      // The first write gets its connection once 1,850 ms of the close's
      // 2,000 have passed: 150 ms is under the tenth a write needs, so the
      // close starts no write of its own.
      clock += 1_850;
      taken.release();
      released = true;
      await expect(closing).rejects.toThrow(/had 150 ms of its bound left: what it held is dropped/u);
      expect(late.held()).toBe(0);
      // The first write commits; the dropped CLS never is, and its place comes back.
      await vi.waitFor(async () => {
        const { rows: written } = await pool.query<{ metric: string }>("SELECT metric FROM web_vital_samples");
        expect(written).toEqual([{ metric: "INP" }]);
      }, { timeout: 5_000 });
      expect([late.hold({ ...REPORT, metrics: [REPORT.metrics[3]] }), late.hold({ ...REPORT, metrics: [REPORT.metrics[0]] })]).toEqual([true, false]);
    } finally {
      if (!released) taken.release();
      await narrowPool.end();
    }
  }, 15_000);

  // A close's bound is measured on a monotonic clock (performance.now): the
  // wall clock moved an hour on as the server closes (a time sync, say)
  // neither cuts the close short nor stretches it.
  it("measures a close's bound on a clock that a change of the wall clock cannot move", async () => {
    // The spy is in place before the batch is made: a batch whose bound read
    // the wall clock would hold the spy itself (as Date.now) and see the hour
    // move, so it could not pass here. Calls go through until it is moved.
    const wallClock = vi.spyOn(Date, "now");
    const narrowPool = new Pool({ connectionString: testUrl, application_name: "web_vitals_narrow", max: 1 });
    let taken: PoolClient | undefined;
    let released = false;
    try {
      const narrowDb: Database = drizzle(narrowPool, { schema });
      const steady = createWebVitalsBatch(narrowDb, { minSamples: 1, writeTimeoutMs: 2_000, ceiling: createDailyCeiling(2) });
      taken = await narrowPool.connect();
      expect(steady.hold({ ...REPORT, metrics: [REPORT.metrics[1]] })).toBe(true);
      await expect(steady.flush()).rejects.toThrow(/unfinished after 2000 ms/u);
      expect(steady.hold({ ...REPORT, metrics: [REPORT.metrics[2]] })).toBe(true);
      const closing = steady.flush({ closing: true });
      const hourOn = Date.now() + 3_600_000;
      wallClock.mockImplementation(() => hourOn);
      taken.release();
      released = true;
      // By the wall clock the close would be an hour past its bound and drop
      // the CLS; by the monotonic one nearly all of it is left, and it writes.
      await expect(closing).resolves.toBe(1);
      const { rows: written } = await pool.query<{ metric: string }>("SELECT metric FROM web_vital_samples ORDER BY metric");
      expect(written).toEqual([{ metric: "CLS" }, { metric: "INP" }]);
    } finally {
      wallClock.mockRestore();
      if (taken !== undefined && !released) taken.release();
      await narrowPool.end();
    }
  }, 15_000);

  // The release lead's condition on F1, B2 and M3: a write stuck as the API
  // stops (Railway's SIGTERM closes the server) is waited for only within its
  // bound, what is held is dropped, and the close goes on, well inside the
  // API's own 25-second stop (index.ts). The stuck write here holds a
  // connection of its own pool, so this shows the batch's close only. Stuck on
  // the server's own pool, it would hold that pool's close too, until the
  // 25-second stop ends the process (exit 1), as the doc says.
  it("closes the whole server past a write still stuck, within the batch's bound, dropping what is held", async () => {
    process.env["WEB_VITALS_COLLECTION"] = "on";
    const narrowPool = new Pool({ connectionString: testUrl, application_name: "web_vitals_narrow", max: 1 });
    const narrowDb: Database = drizzle(narrowPool, { schema });
    const stuckBatch = createWebVitalsBatch(narrowDb, { minSamples: 1, writeTimeoutMs: 500 });
    const { buildServer } = await import("../index.js");
    const whole: FastifyInstance = await buildServer(validateEnv({
      NODE_ENV: "test",
      DATABASE_URL: testUrl,
      JWT_SECRET: "test-jwt-secret-that-is-at-least-32-characters-long",
    }), { webVitals: { batch: stuckBatch } });
    await whole.ready();
    const post = (index: number): Promise<LightMyRequestResponse> => whole.inject({
      method: "POST", url: "/public/web-vitals", headers: { "content-type": "text/plain;charset=UTF-8" },
      payload: wire({ ...REPORT, metrics: [REPORT.metrics[1]] }), remoteAddress: `10.6.0.${String(index)}`,
    });
    const taken = await narrowPool.connect();
    try {
      expect((await post(1)).statusCode).toBe(204);
      // The hourly write starts and sticks: the batch's one connection is taken.
      await expect(stuckBatch.flush()).rejects.toThrow(/unfinished after 500 ms/u);
      expect((await post(2)).statusCode).toBe(204);
      const started = Date.now();
      await whole.close();
      // The close waited for the stuck write no longer than its bound, and
      // dropped what it held.
      expect(Date.now() - started).toBeLessThan(5_000);
      expect(stuckBatch.held()).toBe(0);
    } finally {
      taken.release();
    }
    try {
      // The stuck write commits once it has its connection; the dropped sample never does.
      await vi.waitFor(async () => {
        const { rows: written } = await pool.query<{ metric: string }>("SELECT metric FROM web_vital_samples");
        expect(written).toEqual([{ metric: "INP" }]);
      }, { timeout: 5_000 });
    } finally {
      await narrowPool.end();
    }
    // The batch's own bound sits well inside the API's 25-second stop.
    expect(WEB_VITALS_BATCH_WRITE_TIMEOUT_MS).toBeLessThan(25_000);
  }, 120_000);

  it("writes the held reports on the route's own timer", async () => {
    process.env["WEB_VITALS_COLLECTION"] = "on";
    const timed = Fastify();
    await timed.register(publicWebVitalsRoutes, { prefix: "/public", db, flushEveryMs: 20 });
    try {
      for (let index = 0; index < 10; index += 1) {
        expect((await timed.inject({
          method: "POST", url: "/public/web-vitals", headers: { "content-type": "text/plain;charset=UTF-8" },
          payload: wire({ ...REPORT, metrics: [REPORT.metrics[1]] }), remoteAddress: `10.4.0.${String(index)}`,
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
