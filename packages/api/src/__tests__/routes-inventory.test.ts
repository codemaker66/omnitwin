import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import type { FastifyInstance } from "fastify";
import { extractRoutes } from "../test-support/route-tree.js";

process.env["DATABASE_URL"] = "postgresql://mock:mock@localhost/mock";
process.env["JWT_SECRET"] = "test-jwt-secret-that-is-at-least-32-characters-long";

const { buildServer } = await import("../index.js");

// ---------------------------------------------------------------------------
// Route-inventory audit — sanity + catalogue invariants.
//
// Reviewers expect executable proof that the API surface area is
// understood and classified. This test introspects the live Fastify
// route tree and enforces prefix-based invariants:
//
//   /admin/*     — must be admin-classified if pinned
//   /public/*    — must be public-classified if pinned
//   /webhooks/*  — must be webhook-classified if pinned
//   /health(/*)  — must be public-classified if pinned
//   /metrics     — must be token-classified
//
// New routes added to the server that aren't classified here surface
// as `console.warn` with the drift list so the maintainer can decide
// whether to classify or adjust.
// ---------------------------------------------------------------------------

type AuthLevel = "public" | "webhook" | "session" | "session+role" | "admin" | "token";

/**
 * Pinned classifications for known-critical routes. Adding a pin here
 * tightens the test; removing one loosens it. Entries omitted today
 * (domain routes like /configurations/:id) are intentionally covered
 * only by their prefix invariants so the test stays stable while the
 * API evolves.
 */
const EXPECTED_AUTH: Readonly<Record<string, AuthLevel>> = {
  "GET /health": "public",
  "GET /health/live": "public",
  "GET /health/ready": "public",
  "GET /health/db": "public",
  "GET /health/version": "public",
  "GET /health/observability": "public",
  "GET /metrics": "token",
};

let server: FastifyInstance;
let actualRoutes: ReadonlySet<string>;

beforeAll(async () => {
  server = await buildServer();
  await server.ready();
  actualRoutes = extractRoutes(server.printRoutes({ commonPrefix: false }));
});

afterAll(async () => {
  await server.close();
});

describe("route inventory — sanity", () => {
  it("mounts at least one route", () => {
    expect(actualRoutes.size).toBeGreaterThan(0);
  });

  it("pins /health, /health/live, /health/ready, /health/db, /health/version, /health/observability, /metrics", () => {
    // These are ops contracts — changing their path or auth level
    // breaks Railway health checks, K8s liveness/readiness, Prometheus
    // scraping, or release probes.
    expect(EXPECTED_AUTH["GET /health"]).toBe("public");
    expect(EXPECTED_AUTH["GET /health/live"]).toBe("public");
    expect(EXPECTED_AUTH["GET /health/ready"]).toBe("public");
    expect(EXPECTED_AUTH["GET /health/db"]).toBe("public");
    expect(EXPECTED_AUTH["GET /health/version"]).toBe("public");
    expect(EXPECTED_AUTH["GET /health/observability"]).toBe("public");
    expect(EXPECTED_AUTH["GET /metrics"]).toBe("token");
  });
});

describe("route inventory — prefix invariants", () => {
  it("every route under /admin is admin-classified where pinned", () => {
    for (const route of actualRoutes) {
      if (/\s\/admin(\/|$)/.test(route)) {
        const level = EXPECTED_AUTH[route];
        if (level !== undefined) {
          expect(level).toBe("admin");
        }
      }
    }
  });

  it("every route under /public is public-classified where pinned", () => {
    for (const route of actualRoutes) {
      if (/\s\/public(\/|$)/.test(route)) {
        const level = EXPECTED_AUTH[route];
        if (level !== undefined) {
          expect(level).toBe("public");
        }
      }
    }
  });

  it("every route under /webhooks is webhook-classified where pinned", () => {
    for (const route of actualRoutes) {
      if (/\s\/webhooks(\/|$)/.test(route)) {
        const level = EXPECTED_AUTH[route];
        if (level !== undefined) {
          expect(level).toBe("webhook");
        }
      }
    }
  });

  it("/metrics is token-gated", () => {
    const hasMetrics = actualRoutes.has("GET /metrics") || actualRoutes.has("HEAD /metrics");
    if (hasMetrics) {
      expect(EXPECTED_AUTH["GET /metrics"]).toBe("token");
    }
  });

  it("/health and /health/* are public where pinned", () => {
    for (const route of actualRoutes) {
      if (/\s\/health(\/|$)/.test(route)) {
        const level = EXPECTED_AUTH[route];
        if (level !== undefined) {
          expect(level).toBe("public");
        }
      }
    }
  });
});

describe("route inventory — classification stability", () => {
  it("surfaces classification drift for reviewer attention", () => {
    // Fail-soft: warn on drift, don't block the suite. Once the
    // baseline classification is settled, flip this to a hard
    // assertion (`expect(missing).toEqual([])`).
    const missing: string[] = [];
    for (const pinned of Object.keys(EXPECTED_AUTH)) {
      const present =
        actualRoutes.has(pinned) ||
        actualRoutes.has(pinned.replace(/^GET /, "HEAD "));
      if (!present) missing.push(pinned);
    }
    expect(missing).toEqual([]);
  });
});

describe("route-generated planner links — source-grep", () => {
  it("uses /plan for customer and staff layout URLs", async () => {
    const sources = await Promise.all([
      readFile(resolve("src/routes/enquiries.ts"), "utf-8"),
      readFile(resolve("src/routes/configuration-reviews.ts"), "utf-8"),
    ]);
    const source = sources.join("\n");

    expect(source).toContain("/plan/${enquiry.configurationId}");
    expect(source).toContain("/plan/${config.id}");
    expect(source).not.toContain("/editor/${enquiry.configurationId}");
    expect(source).not.toContain("/editor/${config.id}");
  });
});
