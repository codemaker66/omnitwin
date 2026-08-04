import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import Fastify from "fastify";
import type { FastifyInstance } from "fastify";

const verifyTokenMock = vi.hoisted(() => vi.fn());

vi.mock("@clerk/backend", () => ({
  verifyToken: verifyTokenMock,
}));

async function buildAuthProbeServer(): Promise<FastifyInstance> {
  process.env["JWT_SECRET"] = "test-jwt-secret-that-is-at-least-32-characters-long";
  process.env["CLERK_SECRET_KEY"] = "sk_test_dummy";
  const { authenticate } = await import("../middleware/auth.js");
  const server = Fastify();
  server.get("/probe", { preHandler: [authenticate] }, () => ({ ok: true }));
  await server.ready();
  return server;
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
    server = await buildAuthProbeServer();

    const res = await server.inject({
      method: "GET",
      url: "/probe",
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
    server = await buildAuthProbeServer();

    const res = await server.inject({
      method: "GET",
      url: "/probe",
      headers: { authorization: "Bearer clerk-token-unverified-email" },
    });

    expect(res.statusCode).toBe(403);
    expect(res.json()).toMatchObject({ code: "EMAIL_UNVERIFIED" });
  });
});
