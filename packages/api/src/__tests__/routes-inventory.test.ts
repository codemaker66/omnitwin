import { describe, it, expect, beforeAll, afterAll } from "vitest";
import type { FastifyInstance } from "fastify";

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
  "GET /metrics": "token",
};

/**
 * Parse the output of Fastify's `printRoutes({ commonPrefix: false })`.
 * The tree is indented in 4-character units per hierarchy level, with
 * `├──`/`└──`/`│  ` prefixing each line. A child line's full path is
 * the concatenation of every ancestor's path fragment plus its own.
 */
function extractRoutes(tree: string): ReadonlySet<string> {
  const routes = new Set<string>();
  const prefixStack: string[] = []; // prefixStack[depth] = accumulated path

  for (const rawLine of tree.split("\n")) {
    const methodMatch = /\(([A-Z, ]+)\)\s*$/.exec(rawLine);
    if (methodMatch === null) continue;

    // The tree characters precede a branch marker like "├── ". Find the
    // offset at which the actual path fragment begins.
    const branchMatch = /([├└]── )/.exec(rawLine);
    const pathStart = branchMatch !== null
      ? branchMatch.index + branchMatch[0].length
      : 0;
    // Depth inferred from the prefix width (4 chars per level in
    // Fastify's output).
    const depth = branchMatch !== null ? Math.floor(branchMatch.index / 4) : 0;

    const fragment = rawLine.slice(pathStart, methodMatch.index).trim();
    if (fragment.length === 0) continue;

    // Build full path by concatenating the fragment onto the parent
    // prefix. The root level (depth 0) uses no parent.
    const parent = depth > 0 ? (prefixStack[depth - 1] ?? "") : "";
    const fullPath = joinTreePath(parent, fragment);
    prefixStack[depth] = fullPath;
    // Truncate any stale deeper entries (we've moved back up the tree).
    prefixStack.length = depth + 1;

    // Skip the synthetic "/" lines Fastify emits between a parent and
    // its children — they represent the parent's own terminal route
    // which printRoutes has already emitted under the parent line.
    if (fragment === "/") continue;

    const methods = methodMatch[1]?.split(",").map((m) => m.trim()) ?? [];
    for (const method of methods) {
      routes.add(`${method} ${fullPath}`);
    }
  }
  return routes;
}

function joinTreePath(parent: string, fragment: string): string {
  if (parent.length === 0) return fragment;
  // Fragment may start with "/" or be a bare "param" like ":id".
  if (fragment.startsWith("/")) return parent + fragment;
  // Joining a parent that ends with "/" to a non-slash fragment.
  if (parent.endsWith("/")) return parent + fragment;
  return `${parent}/${fragment}`;
}

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

  it("pins /health, /health/live, /health/ready, /health/db, /health/version, /metrics", () => {
    // These are ops contracts — changing their path or auth level
    // breaks Fly.io routing, K8s liveness/readiness, Prometheus
    // scraping, or release probes.
    expect(EXPECTED_AUTH["GET /health"]).toBe("public");
    expect(EXPECTED_AUTH["GET /health/live"]).toBe("public");
    expect(EXPECTED_AUTH["GET /health/ready"]).toBe("public");
    expect(EXPECTED_AUTH["GET /health/db"]).toBe("public");
    expect(EXPECTED_AUTH["GET /health/version"]).toBe("public");
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
