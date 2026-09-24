import { describe, it, expect, beforeAll, afterAll } from "vitest";
import type { FastifyInstance, LightMyRequestResponse } from "fastify";
import { createRateLimitIdentity } from "../middleware/rate-limit-identity.js";
import type { JwtUser } from "../middleware/auth.js";

// ---------------------------------------------------------------------------
// Rate-limit identity. The limiter runs at onRequest, before authenticate(),
// so the old keyGenerator never saw request.user and every request shared its
// IP's bucket. These tests pin per-verified-user keys without opening a bypass.
// trustProxy is on, so x-forwarded-for supplies request.ip under inject().
// ---------------------------------------------------------------------------

process.env["DATABASE_URL"] = "postgresql://mock:mock@localhost/mock";
process.env["JWT_SECRET"] = "test-jwt-secret-that-is-at-least-32-characters-long";
delete process.env["CLERK_SECRET_KEY"];

const { buildServer } = await import("../index.js");

const GLOBAL_MAX = 100;

function user(id: string): JwtUser {
  return { id, email: `${id}@example.test`, name: "Fixture", role: "planner", platformRole: "none", venueId: null };
}

function bearer(id: string): string {
  return `Bearer ${JSON.stringify(user(id))}`;
}

/** Unsigned JWT-shaped token; learn() trusts that authenticate() verified it. */
function jwtExpiringAt(expSeconds: number, subject = "user_fixture"): string {
  const part = (value: object): string => Buffer.from(JSON.stringify(value)).toString("base64url");
  return `${part({ alg: "RS256", typ: "JWT" })}.${part({ sub: subject, exp: expSeconds })}.signature`;
}

describe("createRateLimitIdentity", () => {
  it("keys requests by IP until authenticate() has accepted their exact token", () => {
    const identity = createRateLimitIdentity();
    const request = { ip: "203.0.113.1", headers: { authorization: bearer("u1") } };
    expect(identity.keyFor({ ip: "203.0.113.1", headers: {} })).toBe("ip:203.0.113.1");
    expect(identity.keyFor(request)).toBe("ip:203.0.113.1");
    identity.learn({ headers: request.headers });
    expect(identity.keyFor(request)).toBe("ip:203.0.113.1");
    identity.learn({ headers: request.headers, user: user("u1") });
    expect(identity.keyFor(request)).toBe("user:u1");
    expect(identity.keyFor({ ...request, ip: "198.51.100.9" })).toBe("user:u1");
    expect(identity.keyFor({ ip: "203.0.113.1", headers: { authorization: bearer("u2") } })).toBe("ip:203.0.113.1");
    expect(identity.keyFor({ ip: "203.0.113.1", headers: { authorization: "Basic dTE6cGFzcw==" } })).toBe("ip:203.0.113.1");
  });

  it("forgets a token when its exp passes and never remembers one longer than ten minutes", () => {
    let nowMs = Date.parse("2026-09-24T12:00:00.000Z");
    const identity = createRateLimitIdentity(() => nowMs);
    const shortLived = `Bearer ${jwtExpiringAt(nowMs / 1000 + 60)}`;
    const longLived = `Bearer ${jwtExpiringAt(nowMs / 1000 + 86_400, "user_long")}`;
    const expired = `Bearer ${jwtExpiringAt(nowMs / 1000 - 1, "user_old")}`;
    for (const [authorization, id] of [[shortLived, "short"], [longLived, "long"], [expired, "old"]] as const) {
      identity.learn({ headers: { authorization }, user: user(id) });
    }
    const key = (authorization: string): string => identity.keyFor({ ip: "192.0.2.1", headers: { authorization } });
    expect([key(shortLived), key(longLived), key(expired)]).toEqual(["user:short", "user:long", "ip:192.0.2.1"]);
    nowMs += 60_000;
    expect(key(shortLived)).toBe("ip:192.0.2.1");
    expect(key(longLived)).toBe("user:long");
    nowMs += 9 * 60_000;
    expect(key(longLived)).toBe("ip:192.0.2.1");
  });

  it("bounds remembered tokens, dropping the oldest first", () => {
    const identity = createRateLimitIdentity();
    const key = (index: number): string =>
      identity.keyFor({ ip: "192.0.2.2", headers: { authorization: `Bearer token-${String(index)}` } });
    for (let index = 0; index <= 10_000; index += 1) {
      identity.learn({ headers: { authorization: `Bearer token-${String(index)}` }, user: user(`u${String(index)}`) });
    }
    expect(key(0)).toBe("ip:192.0.2.2");
    expect(key(1)).toBe("user:u1");
    expect(key(10_000)).toBe("user:u10000");
  });
});

describe("API rate limiting by verified identity", () => {
  let server: FastifyInstance;

  beforeAll(async () => {
    server = await buildServer();
  });

  afterAll(async () => {
    await server.close();
  });

  function me(ip: string, authorization?: string): Promise<LightMyRequestResponse> {
    const headers: Record<string, string> = { "x-forwarded-for": ip };
    if (authorization !== undefined) headers["authorization"] = authorization;
    return server.inject({ method: "GET", url: "/auth/me", headers });
  }

  async function statuses(count: number, send: (index: number) => Promise<LightMyRequestResponse>): Promise<number[]> {
    const result: number[] = [];
    for (let index = 0; index < count; index += 1) result.push((await send(index)).statusCode);
    return result;
  }

  it("gives two verified users behind one office IP independent budgets", async () => {
    const office = "203.0.113.10";
    // A token's first request is charged to its IP; authenticate() then vouches for it.
    expect((await me(office, bearer("office-a"))).statusCode).toBe(200);
    expect(await statuses(GLOBAL_MAX, () => me(office, bearer("office-a")))).toEqual(Array(GLOBAL_MAX).fill(200));
    expect((await me(office, bearer("office-a"))).statusCode).toBe(429);

    expect((await me(office, bearer("office-b"))).statusCode).toBe(200);
    expect(await statuses(GLOBAL_MAX, () => me(office, bearer("office-b")))).toEqual(Array(GLOBAL_MAX).fill(200));
    expect((await me(office, bearer("office-b"))).statusCode).toBe(429);

    // Only the two first-use requests were charged to the office address.
    expect((await me(office)).statusCode).toBe(401);
    expect((await me(office)).headers["x-ratelimit-remaining"]).toBe(String(GLOBAL_MAX - 4));
  });

  it("keeps one budget for a user whose requests arrive from many IPs", async () => {
    expect((await me("198.51.100.1", bearer("roamer"))).statusCode).toBe(200);
    const spread = await statuses(GLOBAL_MAX, (index) => me(`198.51.100.${String(index + 2)}`, bearer("roamer")));
    expect(spread).toEqual(Array(GLOBAL_MAX).fill(200));
    expect((await me("198.51.100.250", bearer("roamer"))).statusCode).toBe(429);
  });

  it("charges forged and failed tokens to the client IP, never to a fresh or verified bucket", async () => {
    const victim = "verified-victim";
    expect((await me("192.0.2.40", bearer(victim))).statusCode).toBe(200);

    const attacker = "192.0.2.41";
    const forged = [
      (index: number) => `Bearer {"id":"${victim}","n":${String(index)}}`,
      (index: number) => `Bearer ${jwtExpiringAt(Math.floor(Date.now() / 1000) + 600, `${victim}-${String(index)}`)}`,
      (index: number) => `Bearer not-a-token-${String(index)}`,
    ];
    const attempts = await statuses(GLOBAL_MAX, (index) => me(attacker, forged[index % forged.length]?.(index)));
    expect(attempts.every((status) => status !== 200 && status !== 429)).toBe(true);
    expect((await me(attacker, forged[2]?.(GLOBAL_MAX))).statusCode).toBe(429);
    expect((await me(attacker)).statusCode).toBe(429);

    // Another address is a separate bucket; the victim's own budget is untouched,
    // even when the victim shares the exhausted address.
    expect((await me("192.0.2.42", "Bearer not-a-token")).statusCode).not.toBe(429);
    expect(await statuses(GLOBAL_MAX, () => me(attacker, bearer(victim)))).toEqual(Array(GLOBAL_MAX).fill(200));
    expect((await me(attacker, bearer(victim))).statusCode).toBe(429);
  });

  it("limits unauthenticated requests per IP", async () => {
    expect(await statuses(GLOBAL_MAX, () => me("192.0.2.60"))).toEqual(Array(GLOBAL_MAX).fill(401));
    expect((await me("192.0.2.60")).statusCode).toBe(429);
    expect((await me("192.0.2.61")).statusCode).toBe(401);
  });

  it("answers a limited request with 429, Retry-After and the RATE_LIMITED envelope", async () => {
    await statuses(GLOBAL_MAX, () => me("192.0.2.65"));
    const limited = await me("192.0.2.65");
    expect(limited.statusCode).toBe(429);
    expect(limited.json()).toEqual({ error: "Too many requests — please slow down.", code: "RATE_LIMITED" });
    expect(Number(limited.headers["retry-after"])).toBeGreaterThan(0);
    expect(limited.headers["x-ratelimit-remaining"]).toBe("0");
  });

  it("keeps route-level limits per IP for anonymous callers", async () => {
    const submit = (ip: string): Promise<LightMyRequestResponse> => server.inject({
      method: "POST", url: "/public/enquiries", headers: { "x-forwarded-for": ip }, payload: {},
    });
    expect(await statuses(10, () => submit("192.0.2.70"))).toEqual(Array(10).fill(400));
    expect((await submit("192.0.2.70")).statusCode).toBe(429);
    expect((await submit("192.0.2.71")).statusCode).toBe(400);
  });

  it("never rate-limits the health probes", async () => {
    // /health/db and /health/ready answer 503 here: the mock database is unreachable.
    for (const url of ["/health", "/health/live", "/health/version", "/health/observability", "/health/db", "/health/ready"]) {
      const results = await statuses(GLOBAL_MAX + 20, () => server.inject({
        method: "GET", url, headers: { "x-forwarded-for": "192.0.2.80", authorization: bearer("prober") },
      }));
      expect(results.every((status) => status === (url.endsWith("/db") || url.endsWith("/ready") ? 503 : 200)), url).toBe(true);
    }
  });
});
