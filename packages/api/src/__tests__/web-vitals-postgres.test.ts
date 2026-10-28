import type { FastifyInstance } from "fastify";
import { resolve } from "node:path";
import { Pool } from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { WEB_VITAL_RETENTION_DAYS } from "@omnitwin/types";
import * as schema from "../db/schema.js";
import type { Database } from "../db/client.js";
import { validateEnv } from "../env.js";
import { removeExpiredWebVitalSamples, webVitalsP75 } from "../services/web-vitals.js";
import { formatP75Line } from "../scripts/web-vitals-report.js";

// ---------------------------------------------------------------------------
// Field web vitals (goal 07) through the whole API, on a migrated database:
// off unless WEB_VITALS_COLLECTION=on, and then a report is a route pattern,
// a device class and four numbers, kept as four rows and nothing else; an
// address, a token or any other field is refused and nothing is kept; the
// database refuses a page that is not a pattern; the limiter bounds an
// address; samples go after 90 days; p75 is read by device and by page.
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
    { name: "LCP", value: 5234.5, rating: "poor", navigationType: "navigate" },
    { name: "INP", value: 184, rating: "good", navigationType: "navigate" },
    { name: "CLS", value: 0.04, rating: "good", navigationType: "navigate" },
    { name: "TTFB", value: 412.25, rating: "good", navigationType: "navigate" },
  ],
} as const;

interface SampleRow {
  readonly page: string;
  readonly device: string;
  readonly metric: string;
  readonly value: number;
  readonly rating: string;
  readonly navigation_type: string;
}

describe.skipIf(testUrl === undefined)("field web vitals on the whole API (migrated PostgreSQL)", () => {
  const savedSwitch = process.env["WEB_VITALS_COLLECTION"];
  let pool: Pool;
  let db: Database;
  let server: FastifyInstance;
  let address = 0;

  /** As navigator.sendBeacon sends a string: text/plain, from its own address. */
  function beacon(body: string, from?: string): ReturnType<FastifyInstance["inject"]> {
    address += 1;
    return server.inject({
      method: "POST", url: "/public/web-vitals",
      headers: { "content-type": "text/plain;charset=UTF-8", origin: "https://venviewer.com" },
      payload: body,
      remoteAddress: from ?? `10.9.${String((address >> 8) & 255)}.${String(address & 255)}`,
    });
  }

  async function rows(): Promise<SampleRow[]> {
    const { rows: found } = await pool.query<SampleRow>(
      "SELECT page, device, metric, value, rating, navigation_type FROM web_vital_samples ORDER BY metric",
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
    const { buildServer } = await import("../index.js");
    server = await buildServer(validateEnv({
      NODE_ENV: "test",
      DATABASE_URL: testUrl,
      JWT_SECRET: "test-jwt-secret-that-is-at-least-32-characters-long",
    }));
    await server.ready();
  }, 300_000);

  afterEach(async () => {
    if (savedSwitch === undefined) delete process.env["WEB_VITALS_COLLECTION"];
    else process.env["WEB_VITALS_COLLECTION"] = savedSwitch;
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
      { page: "/proposal-share/:token", device: "phone", metric: "CLS", value: 0.04, rating: "good", navigation_type: "navigate" },
      { page: "/proposal-share/:token", device: "phone", metric: "INP", value: 184, rating: "good", navigation_type: "navigate" },
      { page: "/proposal-share/:token", device: "phone", metric: "LCP", value: 5234.5, rating: "poor", navigation_type: "navigate" },
      { page: "/proposal-share/:token", device: "phone", metric: "TTFB", value: 412.25, rating: "good", navigation_type: "navigate" },
    ]);
    // The row holds nothing else: no address, no agent, no time but its own.
    const { rows: columns } = await pool.query<{ column_name: string }>(
      "SELECT column_name FROM information_schema.columns WHERE table_name = 'web_vital_samples' ORDER BY column_name",
    );
    expect(columns.map((column) => column.column_name))
      .toEqual(["device", "id", "metric", "navigation_type", "page", "rating", "recorded_at", "value"]);
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
      "INSERT INTO web_vital_samples (page, device, metric, value, rating, navigation_type) VALUES ($1, 'phone', 'LCP', 1, 'good', 'navigate')",
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

  it("removes samples past their retention and keeps the rest", async () => {
    await pool.query(
      `INSERT INTO web_vital_samples (page, device, metric, value, rating, navigation_type, recorded_at) VALUES
         ('/', 'desktop', 'LCP', 1, 'good', 'navigate', now() - make_interval(days => $1 + 1)),
         ('/', 'desktop', 'LCP', 2, 'good', 'navigate', now() - make_interval(days => $1 - 1))`,
      [WEB_VITAL_RETENTION_DAYS],
    );
    expect(await removeExpiredWebVitalSamples(db)).toBe(1);
    expect((await rows()).map((row) => row.value)).toEqual([2]);
  });

  it("reads each vital's p75 by device class, across every page and by page, beside goal 07's target", async () => {
    const insert = (page: string, device: string, metric: string, values: readonly number[], daysAgo = 1): Promise<unknown> => pool.query(
      `INSERT INTO web_vital_samples (page, device, metric, value, rating, navigation_type, recorded_at)
       SELECT $1, $2, $3, value, 'good', 'navigate', now() - make_interval(days => $5) FROM unnest($4::double precision[]) AS value`,
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
});
