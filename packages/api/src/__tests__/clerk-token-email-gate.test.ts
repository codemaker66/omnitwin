import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { FastifyInstance } from "fastify";

const verifyTokenMock = vi.hoisted(() => vi.fn());

vi.mock("@clerk/backend", () => ({
  verifyToken: verifyTokenMock,
}));

async function buildFreshServer(): Promise<FastifyInstance> {
  vi.resetModules();
  process.env["DATABASE_URL"] = "postgresql://mock:mock@localhost/mock";
  process.env["JWT_SECRET"] = "test-jwt-secret-that-is-at-least-32-characters-long";
  process.env["CLERK_SECRET_KEY"] = "sk_test_dummy";
  const mod: typeof import("../index.js") = await import("../index.js");
  const server = await mod.buildServer();
  return server as FastifyInstance;
}

describe("Clerk token email gate", () => {
  let server: FastifyInstance | null = null;

  beforeEach(() => {
    verifyTokenMock.mockReset();
  });

  afterEach(async () => {
    if (server !== null) {
      await server.close();
      server = null;
    }
  });

  it("fails safely when Clerk token has no email", async () => {
    verifyTokenMock.mockResolvedValue({ sub: "clerk_missing_email" });
    server = await buildFreshServer();

    const res = await server.inject({
      method: "GET",
      url: "/enquiries",
      headers: { authorization: "Bearer clerk-token-without-email" },
    });

    expect(res.statusCode).toBe(403);
    expect(res.json()).toMatchObject({ code: "EMAIL_REQUIRED" });
  });

  it("fails safely when Clerk token email is not explicitly verified", async () => {
    verifyTokenMock.mockResolvedValue({
      sub: "clerk_unverified_email",
      email: "person@example.com",
    });
    server = await buildFreshServer();

    const res = await server.inject({
      method: "GET",
      url: "/enquiries",
      headers: { authorization: "Bearer clerk-token-unverified-email" },
    });

    expect(res.statusCode).toBe(403);
    expect(res.json()).toMatchObject({ code: "EMAIL_UNVERIFIED" });
  });
});
