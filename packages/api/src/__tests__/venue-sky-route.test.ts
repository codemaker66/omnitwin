import Fastify, { type FastifyInstance } from "fastify";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { VenueSkySchema } from "@omnitwin/types";
import { venueSkyRoutes, type VenueLocationRecord, type VenueLocationStore } from "../routes/venue-sky.js";
import { createVenueSkyService, type SkyLogger } from "../services/sky/sky-service.js";
import { SKY_NORMALS } from "../services/sky/normals-data.js";
import { collectionsBody, forecastTimes, instancesBody, percentilesBody, probabilitiesBody, routedFetch } from "./fixtures/met-office-bpf-v2.js";

// ---------------------------------------------------------------------------
// GET /venues/:venueId/sky (T-647): the route's promises at the HTTP
// boundary. The location store is a list; the sky service is the real one,
// fed documented-structure Met Office fixtures with synthetic numbers.
// ---------------------------------------------------------------------------

// The real server, built as the other route suites build it (venues.test.ts):
// a placeholder DATABASE_URL that no request in this file reaches.
process.env["DATABASE_URL"] = "postgresql://mock:mock@localhost/mock";
const { buildServer } = await import("../index.js");

const LOCATED = "8f6c2b1e-4d3a-4b5c-9e7f-0a1b2c3d4e5f";
const UNLOCATED = "1b2c3d4e-5f60-4718-8a9b-0c1d2e3f4a5b";
const MISSING = "0c1d2e3f-4a5b-4c6d-8e7f-8091a2b3c4d5";

const VENUES: readonly VenueLocationRecord[] = [
  { id: LOCATED, latitude: 55.8593, longitude: -4.2491, timezone: "Europe/London" },
  { id: UNLOCATED, latitude: null, longitude: null, timezone: "Europe/London" },
];

const store: VenueLocationStore = {
  find: (venueId) => Promise.resolve(VENUES.find((venue) => venue.id === venueId) ?? null),
};

const silent: SkyLogger = { warn: () => undefined, info: () => undefined };

async function serverWith(sky: ReturnType<typeof createVenueSkyService>): Promise<FastifyInstance> {
  const server = Fastify();
  await server.register(venueSkyRoutes, { store, sky, prefix: "/venues" });
  return server;
}

describe("GET /venues/:venueId/sky — requests", () => {
  let server: FastifyInstance;

  beforeEach(async () => {
    server = await serverWith(createVenueSkyService({ apiKey: undefined, normals: [], logger: silent }));
  });
  afterEach(async () => {
    await server.close();
  });

  it("refuses a malformed venue id", async () => {
    const response = await server.inject({ method: "GET", url: "/venues/not-a-uuid/sky" });
    expect(response.statusCode).toBe(400);
    expect(response.json()).toMatchObject({ code: "VALIDATION_ERROR" });
  });

  it.each(["tomorrow", "2026-12-12", "2026-12-12T18:00:00", "1999-12-31T23:00:00Z", "2100-01-01T00:00:00Z"])(
    "refuses at=%s",
    async (at) => {
      const response = await server.inject({ method: "GET", url: `/venues/${LOCATED}/sky?at=${encodeURIComponent(at)}` });
      expect(response.statusCode).toBe(400);
      expect(response.json()).toMatchObject({ code: "VALIDATION_ERROR" });
    },
  );

  it("answers 404 for a venue that does not exist", async () => {
    const response = await server.inject({ method: "GET", url: `/venues/${MISSING}/sky` });
    expect(response.statusCode).toBe(404);
    expect(response.json()).toEqual({ error: "Venue not found", code: "NOT_FOUND" });
  });

  it("answers 422 VENUE_NOT_LOCATED for a venue without a location, never a guess", async () => {
    const response = await server.inject({ method: "GET", url: `/venues/${UNLOCATED}/sky` });
    expect(response.statusCode).toBe(422);
    expect(response.json()).toMatchObject({ code: "VENUE_NOT_LOCATED" });
  });

  it("answers 503 SKY_UNAVAILABLE, uncached, when there is neither a forecast nor normals", async () => {
    const response = await server.inject({ method: "GET", url: `/venues/${LOCATED}/sky` });
    expect(response.statusCode).toBe(503);
    expect(response.headers["cache-control"]).toBe("no-store");
    expect(response.json()).toEqual({
      error: "No weather is available for this venue at this time",
      code: "SKY_UNAVAILABLE",
      details: { forecast: "forecast_not_configured", normals: "not_available" },
    });
  });
});

describe("GET /venues/:venueId/sky — a forecast", () => {
  let server: FastifyInstance;
  const now = Date.now();
  const issued = Math.floor(now / 3_600_000) * 3_600_000;

  beforeAll(async () => {
    const times = forecastTimes(issued, 120, 22);
    const { fetch } = routedFetch((url) => {
      if (url.pathname.endsWith("/collections")) return { status: 200, body: collectionsBody() };
      if (url.pathname.endsWith("/instances")) return { status: 200, body: instancesBody([new Date(issued).toISOString()]) };
      if (url.pathname.includes("percentiles")) return { status: 200, body: percentilesBody(times) };
      return { status: 200, body: probabilitiesBody(times) };
    });
    server = await serverWith(createVenueSkyService({ apiKey: "test-key-not-a-real-key", normals: [], logger: silent, fetchImpl: fetch }));
  });
  afterAll(async () => {
    await server.close();
  });

  it("answers { data: VenueSky } with Cache-Control, provenance and attribution", async () => {
    const at = new Date(issued + 2 * 3_600_000).toISOString();
    const response = await server.inject({ method: "GET", url: `/venues/${LOCATED}/sky?at=${encodeURIComponent(at)}` });
    expect(response.statusCode).toBe(200);
    expect(response.headers["cache-control"]).toMatch(/^public, max-age=\d+$/u);
    const { data } = response.json<{ data: unknown }>();
    const sky = VenueSkySchema.parse(data);
    expect(sky.kind).toBe("forecast");
    expect(sky.venueId).toBe(LOCATED);
    expect(sky.at).toBe(at);
    expect(sky.provenance.upstreamRequestedAt).not.toBeNull();
    expect(sky.provenance.cacheAgeSeconds).toBeGreaterThanOrEqual(0);
    expect(sky.attribution[0]?.credit).toBe("Powered by Met Office data");
  });

  it("accepts an instant with an offset and answers it in UTC", async () => {
    const at = new Date(issued + 3 * 3_600_000);
    const local = `${at.toISOString().slice(0, 19)}+00:00`;
    const response = await server.inject({ method: "GET", url: `/venues/${LOCATED}/sky?at=${encodeURIComponent(local)}` });
    expect(response.statusCode).toBe(200);
    expect(response.json<{ data: { at: string } }>().data.at).toBe(at.toISOString());
  });

  it("answers 503 beyond the horizon when no normals cover the venue", async () => {
    const at = new Date(now + 40 * 24 * 3_600_000).toISOString();
    const response = await server.inject({ method: "GET", url: `/venues/${LOCATED}/sky?at=${encodeURIComponent(at)}` });
    expect(response.statusCode).toBe(503);
    expect(response.json()).toMatchObject({ details: { forecast: "beyond_forecast_horizon" } });
  });
});

describe("GET /venues/:venueId/sky — the committed normals", () => {
  let server: FastifyInstance;

  beforeAll(async () => {
    server = await serverWith(createVenueSkyService({ apiKey: undefined, normals: SKY_NORMALS, logger: silent }));
  });
  afterAll(async () => {
    await server.close();
  });

  it("answers a date beyond the horizon with the month's HadUK-Grid normals for the Trades Hall cell", async () => {
    const at = "2027-01-15T18:00:00Z";
    const response = await server.inject({ method: "GET", url: `/venues/${LOCATED}/sky?at=${encodeURIComponent(at)}` });
    expect(response.statusCode).toBe(200);
    expect(response.headers["cache-control"]).toBe("public, max-age=3600");
    const sky = VenueSkySchema.parse(response.json<{ data: unknown }>().data);
    expect(sky.kind).toBe("normals");
    expect(sky.degraded).toEqual({ reason: "beyond_forecast_horizon" });
    const january = SKY_NORMALS[0]?.months[0];
    expect(sky.climatology).toMatchObject({
      period: "1991-2020",
      month: 1,
      rainDaysAtLeast1mm: january?.rainDaysAtLeast1mm,
      snowLyingDays: january?.snowLyingDays,
      sunshineHours: january?.sunshineHours,
      meanTemperatureC: january?.meanTemperatureC,
      meanWindSpeedMs: january?.meanWindSpeedMs,
    });
    expect(sky.temperatureC).toBe(january?.meanTemperatureC);
    expect(sky.precipitation.probabilityDefinition).toBe("share_of_days_with_at_least_1_mm");
    expect(sky.attribution[0]?.licence).toBe("Open Government Licence v3.0");
    expect(sky.attribution[0]?.credit).toContain("Contains public sector information licensed under the Open Government Licence v3.0.");
    expect(sky.attribution[0]?.credit).toContain("doi:10.5285/789b3065d74a4c948ab05d33556c86d0");
  });

  it("answers now with normals marked forecast_not_configured while there is no key", async () => {
    const response = await server.inject({ method: "GET", url: `/venues/${LOCATED}/sky` });
    expect(response.statusCode).toBe(200);
    expect(response.json<{ data: { kind: string; degraded: unknown } }>().data).toMatchObject({ kind: "normals", degraded: { reason: "forecast_not_configured" } });
  });
});

describe("the sky route on the real server", () => {
  let server: FastifyInstance;

  beforeAll(async () => {
    server = await buildServer();
  });
  afterAll(async () => {
    await server.close();
  });

  it("is registered, public and validates before touching the database", async () => {
    const response = await server.inject({ method: "GET", url: "/venues/not-a-uuid/sky" });
    expect(response.statusCode).toBe(400);
    expect(response.json()).toMatchObject({ code: "VALIDATION_ERROR" });
  });
});
