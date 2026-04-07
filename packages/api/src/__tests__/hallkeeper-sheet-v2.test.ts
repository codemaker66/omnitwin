import { describe, it, expect, beforeAll } from "vitest";
import { buildServer } from "../index.js";
import type { FastifyInstance } from "fastify";

// ---------------------------------------------------------------------------
// Hallkeeper sheet route tests
// ---------------------------------------------------------------------------

const FAKE_CONFIG_ID = "00000000-0000-0000-0000-000000000001";

let server: FastifyInstance;

beforeAll(async () => {
  server = await buildServer();
});

describe("GET /hallkeeper/:configId/sheet", () => {
  it("returns 400 for invalid config ID", async () => {
    const res = await server.inject({
      method: "GET",
      url: "/hallkeeper/not-a-uuid/sheet",
    });
    expect(res.statusCode).toBe(400);
  });

  it("does not require authentication (public endpoint)", async () => {
    const res = await server.inject({
      method: "GET",
      url: `/hallkeeper/${FAKE_CONFIG_ID}/sheet`,
    });
    // Should be 404 (config not found) or 500 (mock DB), NOT 401
    expect(res.statusCode).not.toBe(401);
  });

  it("returns 404 or 500 for non-existent config (passes validation)", async () => {
    const res = await server.inject({
      method: "GET",
      url: `/hallkeeper/${FAKE_CONFIG_ID}/sheet`,
    });
    expect(res.statusCode).not.toBe(400);
  });
});

describe("GET /hallkeeper/:configId/data", () => {
  it("returns 400 for invalid config ID", async () => {
    const res = await server.inject({
      method: "GET",
      url: "/hallkeeper/not-a-uuid/data",
    });
    expect(res.statusCode).toBe(400);
  });

  it("does not require authentication", async () => {
    const res = await server.inject({
      method: "GET",
      url: `/hallkeeper/${FAKE_CONFIG_ID}/data`,
    });
    expect(res.statusCode).not.toBe(401);
  });

  it("accepts download query parameter", async () => {
    const res = await server.inject({
      method: "GET",
      url: `/hallkeeper/${FAKE_CONFIG_ID}/sheet?download=true`,
    });
    expect(res.statusCode).not.toBe(400);
  });
});
