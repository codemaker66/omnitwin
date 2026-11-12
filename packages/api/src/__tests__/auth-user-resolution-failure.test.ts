import { afterEach, describe, expect, it, vi } from "vitest";
import Fastify from "fastify";
import type { FastifyInstance } from "fastify";

// ---------------------------------------------------------------------------
// Whole-repository audit, api-platform-2. When the database could not be read
// while resolving the signed-in user, authenticate() answered 500 by itself:
// no log line carried the error and nothing reached the error handler, so an
// outage looked like a run of bare 500s with no cause and no report.
//
// The token check is stood in for; the database is a real client pointed at a
// port nothing listens on, so the failure is the driver's own.
// ---------------------------------------------------------------------------

const verifyTokenMock = vi.hoisted(() => vi.fn());

vi.mock("@clerk/backend", () => ({
  verifyToken: verifyTokenMock,
}));

interface LoggedLine {
  readonly level?: number;
  readonly msg?: string;
  readonly err?: { readonly message?: string; readonly code?: string };
}

describe("a sign-in whose user cannot be read from the database", () => {
  let server: FastifyInstance | null = null;
  let closeDatabase: (() => Promise<void>) | null = null;

  afterEach(async () => {
    if (server !== null) {
      await server.close();
      server = null;
    }
    if (closeDatabase !== null) {
      await closeDatabase();
      closeDatabase = null;
    }
  });

  it("is logged with the database's own error and reported, and tells the caller nothing of it", async () => {
    process.env["JWT_SECRET"] = "test-jwt-secret-that-is-at-least-32-characters-long";
    process.env["CLERK_SECRET_KEY"] = "sk_test_dummy";
    verifyTokenMock.mockResolvedValue({
      sub: "clerk_database_down",
      email: "person@example.com",
      email_verified: true,
    });

    const { authenticate, setAuthDb } = await import("../middleware/auth.js");
    const { registerErrorNormalizer } = await import("../middleware/error-normalizer.js");
    const { createDbConnection } = await import("../db/client.js");

    // Nothing listens on port 1: every query is refused, as when the database is down.
    const connection = createDbConnection("postgresql://nobody@127.0.0.1:1/nothing");
    closeDatabase = connection.close;
    setAuthDb(connection.db);

    const lines: string[] = [];
    const reported: unknown[] = [];
    server = Fastify({
      logger: { level: "error", stream: { write: (line: string) => { lines.push(line); } } },
    });
    registerErrorNormalizer(server, { onServerError: (error) => { reported.push(error); } });
    server.get("/probe", { preHandler: [authenticate] }, () => ({ ok: true }));
    await server.ready();

    const res = await server.inject({
      method: "GET",
      url: "/probe",
      headers: { authorization: "Bearer a-token-the-stand-in-accepts" },
    });

    expect(res.statusCode).toBe(500);

    // Whoever is on call can see what failed: the request log carries the error...
    const logged = lines.map((line) => JSON.parse(line) as LoggedLine);
    const withError = logged.filter((line) => line.err !== undefined);
    expect(withError).toHaveLength(1);
    expect(withError[0]?.msg).toBe("request errored");
    expect(String(withError[0]?.err?.message)).toMatch(/ECONNREFUSED|connect/i);

    // ...and the same error goes to the report hook (Sentry in production), once.
    expect(reported).toHaveLength(1);
    expect(reported[0]).toBeInstanceOf(Error);

    // The caller learns only that the server failed.
    expect(res.json()).toEqual({ error: "Internal server error.", code: "INTERNAL_ERROR" });
  });
});
