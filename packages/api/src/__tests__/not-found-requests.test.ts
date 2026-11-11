import { randomUUID } from "node:crypto";
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import type { FastifyInstance, LightMyRequestResponse } from "fastify";

// ---------------------------------------------------------------------------
// Requests for a path no route matches. Fastify answers them from its
// not-found handler, which is not a route, so nothing a plugin attaches to
// each route as it is added ever reaches them. Built as the whole app, the way
// it runs in production; trustProxy is on, so x-forwarded-for sets request.ip.
// ---------------------------------------------------------------------------

const METRICS_TOKEN = "not-found-requests-metrics-token";

process.env["DATABASE_URL"] = "postgresql://mock:mock@localhost/mock";
process.env["JWT_SECRET"] = "test-jwt-secret-that-is-at-least-32-characters-long";
process.env["METRICS_TOKEN"] = METRICS_TOKEN;
delete process.env["CLERK_SECRET_KEY"];

const { buildServer } = await import("../index.js");

/** The global budget per client a minute, as index.ts registers it. */
const GLOBAL_MAX = 100;

describe("requests for a path no route matches", () => {
  let server: FastifyInstance;

  beforeAll(async () => {
    server = await buildServer();
  });

  afterAll(async () => {
    await server.close();
  });

  function get(url: string, ip: string): Promise<LightMyRequestResponse> {
    return server.inject({ method: "GET", url, headers: { "x-forwarded-for": ip } });
  }

  it("draw on the client's budget and are refused once it is spent, before any body is read", async () => {
    const client = "203.0.113.30";
    const answers: number[] = [];
    for (let index = 0; index < GLOBAL_MAX; index += 1) {
      answers.push((await get(`/wp-admin/probe-${String(index)}.php?id=${randomUUID()}`, client)).statusCode);
    }
    expect(answers).toEqual(Array<number>(GLOBAL_MAX).fill(404));

    const refused = await get(`/wp-admin/probe-${randomUUID()}.php`, client);
    expect(refused.statusCode).toBe(429);
    expect(refused.json()).toEqual({ error: "Too many requests — please slow down.", code: "RATE_LIMITED" });
    expect(Number(refused.headers["retry-after"])).toBeGreaterThan(0);

    // Refused before the body is parsed: a malformed body would otherwise be answered 400.
    const posted = await server.inject({
      method: "POST",
      url: "/no-such-route",
      payload: "{not json",
      headers: { "x-forwarded-for": client, "content-type": "application/json" },
    });
    expect(posted.statusCode).toBe(429);

    // One budget for everything the client sends.
    expect((await get("/auth/me", client)).statusCode).toBe(429);
  });

  it("leave other clients and the health probes alone", async () => {
    const client = "203.0.113.31";
    for (let index = 0; index < GLOBAL_MAX; index += 1) await get(`/no-such-route/${String(index)}`, client);
    expect((await get("/no-such-route/one-more", client)).statusCode).toBe(429);
    expect((await get("/no-such-route/one-more", "203.0.113.32")).statusCode).toBe(404);
    for (const url of ["/health", "/health/live", "/health/version"]) {
      expect((await get(url, client)).statusCode, url).toBe(200);
    }
  });

  it("are still answered with the not-found envelope", async () => {
    const response = await get("/no-such-route", "203.0.113.33");
    expect(response.statusCode).toBe(404);
    expect(response.json()).toEqual({ error: "Route GET /no-such-route not found.", code: "NOT_FOUND" });
  });

  /** The request counter's and duration histogram's series, as an
   *  authorised scrape of /metrics renders them. */
  async function requestSeries(): Promise<string[]> {
    const scrape = await server.inject({
      method: "GET",
      url: "/metrics",
      headers: { authorization: `Bearer ${METRICS_TOKEN}`, "x-forwarded-for": "198.51.100.200" },
    });
    expect(scrape.statusCode).toBe(200);
    return scrape.body.split("\n").filter((line) => line.startsWith("http_requests_total{") || line.startsWith("http_request_duration_seconds_count{"));
  }

  it("share one metrics series, however many distinct paths arrive", async () => {
    // The first unmatched path and the scrape itself add their own series.
    expect((await get(`/no-such-route/${randomUUID()}`, "198.18.0.1")).statusCode).toBe(404);
    await requestSeries();
    const before = await requestSeries();
    // Each from its own address, so every one is answered 404.
    for (let index = 0; index < 500; index += 1) {
      const address = `198.18.${String(1 + Math.floor(index / 200))}.${String(1 + (index % 200))}`;
      expect((await get(`/no-such-route/${randomUUID()}?q=${"x".repeat(200)}`, address)).statusCode).toBe(404);
    }
    const after = await requestSeries();
    expect(after.length).toBe(before.length);
    const rendered = after.join("\n");
    expect(rendered).not.toContain("/no-such-route");
    expect(rendered).toContain('http_requests_total{method="GET",route="<unmatched>",status="404"}');
  });

  it("leave a matched route labelled by its pattern, never by its path", async () => {
    const venueId = randomUUID();
    expect((await get(`/venues/${venueId}/operating-settings`, "198.51.100.201")).statusCode).toBe(401);
    expect((await get("/health", "198.51.100.201")).statusCode).toBe(200);
    const rendered = (await requestSeries()).join("\n");
    expect(rendered).toContain('http_requests_total{method="GET",route="/venues/:id/operating-settings",status="401"}');
    expect(rendered).toContain('http_requests_total{method="GET",route="/health",status="200"}');
    expect(rendered).not.toContain(venueId);
  });
});
