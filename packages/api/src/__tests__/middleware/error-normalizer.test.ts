import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import Fastify, { type FastifyInstance } from "fastify";
import { ZodError, z } from "zod";
import { registerErrorNormalizer } from "../../middleware/error-normalizer.js";
import { apiError } from "../../lib/errors.js";

// ---------------------------------------------------------------------------
// Error-envelope normaliser — unit coverage.
//
// A fresh minimal Fastify instance per test group keeps the
// assertions focused on the normaliser's behaviour, independent of
// any real middleware ordering (request-id, security headers,
// rate-limit) that the full buildServer() pipeline composes.
//
// The shape the normaliser produces is the contract clients switch
// on: `{ error, code, details? }`. Every branch below locks one
// slice of that contract.
// ---------------------------------------------------------------------------

async function buildMinimal(
  options: Parameters<typeof registerErrorNormalizer>[1] = {},
): Promise<FastifyInstance> {
  const server = Fastify({ logger: false });
  registerErrorNormalizer(server, options);

  server.get("/throw/zod", () => {
    throw new ZodError([
      {
        code: "invalid_type",
        expected: "string",
        received: "number",
        path: ["name"],
        message: "Expected string",
      },
    ]);
  });

  server.get("/throw/envelope-401", () => {
    const envelope = apiError("UNAUTHORIZED", "Missing token.");
    const err = Object.assign(new Error(envelope.error), envelope, { statusCode: 401 });
    throw err;
  });

  server.get("/throw/plain-500", () => {
    throw new Error("kaboom");
  });

  server.get("/throw/status-409", () => {
    const err = new Error("Already claimed");
    (err as { statusCode?: number }).statusCode = 409;
    throw err;
  });

  server.get("/throw/status-429", () => {
    const err = new Error("Slow down");
    (err as { statusCode?: number }).statusCode = 429;
    throw err;
  });

  server.post("/validated", {
    schema: {
      body: {
        type: "object",
        required: ["name"],
        properties: { name: { type: "string" } },
      },
    },
  }, () => ({ ok: true }));

  const Body = z.object({ email: z.string().email() });
  server.post("/zod-validated", (request) => {
    Body.parse(request.body);
    return { ok: true };
  });

  await server.ready();
  return server;
}

describe("error-normalizer — envelope shape", () => {
  let server: FastifyInstance;
  beforeAll(async () => { server = await buildMinimal(); });
  afterAll(async () => { await server.close(); });

  it("reshapes a plain thrown Error into { error, code } with status 500", async () => {
    const res = await server.inject({ method: "GET", url: "/throw/plain-500" });
    expect(res.statusCode).toBe(500);
    const body = JSON.parse(res.body) as { error: string; code: string };
    expect(body.code).toBe("INTERNAL_ERROR");
    expect(body.error).toBe("Internal server error.");
    expect(body.error).not.toContain("kaboom");
  });

  it("passes an envelope-shaped throw through verbatim", async () => {
    const res = await server.inject({ method: "GET", url: "/throw/envelope-401" });
    expect(res.statusCode).toBe(401);
    const body = JSON.parse(res.body) as { error: string; code: string };
    expect(body.code).toBe("UNAUTHORIZED");
    expect(body.error).toBe("Missing token.");
  });

  it("maps a statusCode=409 throw to CONFLICT", async () => {
    const res = await server.inject({ method: "GET", url: "/throw/status-409" });
    expect(res.statusCode).toBe(409);
    const body = JSON.parse(res.body) as { error: string; code: string };
    expect(body.code).toBe("CONFLICT");
    expect(body.error).toBe("Already claimed");
  });

  it("maps a statusCode=429 throw to RATE_LIMITED", async () => {
    const res = await server.inject({ method: "GET", url: "/throw/status-429" });
    expect(res.statusCode).toBe(429);
    const body = JSON.parse(res.body) as { error: string; code: string };
    expect(body.code).toBe("RATE_LIMITED");
  });

  it("maps a bubbled ZodError to VALIDATION_ERROR with issues in details", async () => {
    const res = await server.inject({ method: "GET", url: "/throw/zod" });
    expect(res.statusCode).toBe(400);
    const body = JSON.parse(res.body) as { error: string; code: string; details: unknown[] };
    expect(body.code).toBe("VALIDATION_ERROR");
    expect(Array.isArray(body.details)).toBe(true);
    expect(body.details[0]).toMatchObject({ path: ["name"] });
  });

  it("maps Fastify built-in body validation to VALIDATION_ERROR", async () => {
    const res = await server.inject({
      method: "POST",
      url: "/validated",
      payload: { wrongKey: true },
    });
    expect(res.statusCode).toBe(400);
    const body = JSON.parse(res.body) as { error: string; code: string; details: unknown };
    expect(body.code).toBe("VALIDATION_ERROR");
    expect(Array.isArray(body.details)).toBe(true);
  });

  it("maps a Zod-parse throw to VALIDATION_ERROR", async () => {
    const res = await server.inject({
      method: "POST",
      url: "/zod-validated",
      payload: { email: "not-an-email" },
    });
    expect(res.statusCode).toBe(400);
    const body = JSON.parse(res.body) as { error: string; code: string; details: unknown[] };
    expect(body.code).toBe("VALIDATION_ERROR");
    expect(Array.isArray(body.details)).toBe(true);
  });
});

describe("error-normalizer — 404 not-found handler", () => {
  let server: FastifyInstance;
  beforeAll(async () => { server = await buildMinimal(); });
  afterAll(async () => { await server.close(); });

  it("unmounted routes return the envelope with NOT_FOUND", async () => {
    const res = await server.inject({ method: "GET", url: "/this/does/not/exist" });
    expect(res.statusCode).toBe(404);
    const body = JSON.parse(res.body) as { error: string; code: string };
    expect(body.code).toBe("NOT_FOUND");
    expect(body.error).toContain("/this/does/not/exist");
  });
});

describe("error-normalizer — onServerError side channel", () => {
  it("fires for 5xx and receives the raw throwable", async () => {
    const captured: unknown[] = [];
    const server = await buildMinimal({
      onServerError: (err) => { captured.push(err); },
    });
    try {
      await server.inject({ method: "GET", url: "/throw/plain-500" });
      expect(captured).toHaveLength(1);
      expect(captured[0]).toBeInstanceOf(Error);
      expect((captured[0] as Error).message).toBe("kaboom");
    } finally {
      await server.close();
    }
  });

  it("does NOT fire for 4xx (client errors)", async () => {
    const cb = vi.fn();
    const server = await buildMinimal({ onServerError: cb });
    try {
      await server.inject({ method: "GET", url: "/throw/envelope-401" });
      await server.inject({ method: "GET", url: "/throw/status-409" });
      await server.inject({ method: "GET", url: "/throw/status-429" });
      await server.inject({ method: "GET", url: "/throw/zod" });
      await server.inject({ method: "POST", url: "/validated", payload: {} });
      expect(cb).not.toHaveBeenCalled();
    } finally {
      await server.close();
    }
  });

  it("swallows callback exceptions so observability cannot cascade", async () => {
    const server = await buildMinimal({
      onServerError: () => { throw new Error("sentry is down"); },
    });
    try {
      const res = await server.inject({ method: "GET", url: "/throw/plain-500" });
      expect(res.statusCode).toBe(500);
      const body = JSON.parse(res.body) as { error: string; code: string };
      expect(body.code).toBe("INTERNAL_ERROR");
    } finally {
      await server.close();
    }
  });
});

describe("error-normalizer — top-level key ordering", () => {
  let server: FastifyInstance;
  beforeAll(async () => { server = await buildMinimal(); });
  afterAll(async () => { await server.close(); });

  it("every response has `error` before `code`", async () => {
    const urls = [
      "/throw/plain-500",
      "/throw/envelope-401",
      "/throw/status-409",
      "/throw/status-429",
      "/throw/zod",
    ];
    for (const url of urls) {
      const res = await server.inject({ method: "GET", url });
      const keys = Object.keys(JSON.parse(res.body) as Record<string, unknown>);
      expect(keys[0]).toBe("error");
      expect(keys[1]).toBe("code");
    }
  });
});
